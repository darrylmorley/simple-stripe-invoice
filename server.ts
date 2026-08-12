// Local server for the invoice generator.
//
// Adds two things over plain static serving:
//   1. A ledger on disk (data/store.json) so invoice numbers and saved
//      invoices survive browsers, site-data clears, and file:// vs localhost.
//   2. A read-only Stripe lookup so customer name, email, amount and the real
//      payment date come from the payment record instead of being retyped.
//
// Run with: bun server.ts   (or ./serve.sh)
//
// Stripe keys are read from .env: any variable named STRIPE_KEY_<LABEL>
// (e.g. STRIPE_KEY_MYCOMPANY) is tried in order. Use restricted read-only
// keys (Developers > API keys > Create restricted key, read access to
// Charges, Checkout Sessions and Customers only).

import { mkdirSync, renameSync, existsSync } from "node:fs";

const PORT = Number(process.env.PORT || 4321);
const ROOT = import.meta.dir;
const DATA_DIR = `${ROOT}/data`;
const STORE_PATH = `${DATA_DIR}/store.json`;

interface Store {
  settings: unknown; // the client's company profiles blob, opaque to us
  saved: unknown[];  // saved invoices, shape owned by the client
}

async function loadStore(): Promise<Store> {
  if (!existsSync(STORE_PATH)) return { settings: null, saved: [] };
  const parsed = await Bun.file(STORE_PATH).json();
  return {
    settings: parsed.settings ?? null,
    saved: Array.isArray(parsed.saved) ? parsed.saved : [],
  };
}

// Write via a temp file + rename so a crash mid-write can't corrupt the ledger.
async function saveStore(store: Store): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await Bun.write(tmp, JSON.stringify(store, null, 2) + "\n");
  renameSync(tmp, STORE_PATH);
}

/* ---------------- Stripe ---------------- */

const STRIPE_ACCOUNTS: { account: string; key: string }[] = Object.entries(process.env)
  .filter(([name, value]) => name.startsWith("STRIPE_KEY_") && value)
  .map(([name, value]) => ({ account: name.slice("STRIPE_KEY_".length).toLowerCase(), key: value as string }));

async function stripeGET(key: string, path: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

// Find a charge by receipt number (#1234-5678), payment intent id, or charge id.
async function findCharge(key: string, q: string): Promise<any | null> {
  if (/^pi_/.test(q)) {
    const r = await stripeGET(key, `/v1/charges?payment_intent=${encodeURIComponent(q)}&limit=1`);
    return r.ok ? (r.body.data?.[0] ?? null) : null;
  }
  if (/^(ch|py)_/.test(q)) {
    const r = await stripeGET(key, `/v1/charges/${encodeURIComponent(q)}`);
    return r.ok ? r.body : null;
  }

  // Receipt number. The search API doesn't index receipt_number, so page
  // through recent charges and match. Requests are volumes of ~a few a month,
  // and receipts people ask about are recent, so 3 pages of 100 is plenty.
  let startingAfter = "";
  for (let page = 0; page < 3; page++) {
    const r = await stripeGET(key, `/v1/charges?limit=100${startingAfter ? `&starting_after=${startingAfter}` : ""}`);
    if (!r.ok) return null;
    const charges = r.body.data ?? [];
    const hit = charges.find((c: any) => c.receipt_number === q);
    if (hit) return hit;
    if (!r.body.has_more || charges.length === 0) return null;
    startingAfter = charges[charges.length - 1].id;
  }
  return null;
}

// Try to recover the real line items (product name, unit price) from the
// Checkout Session behind the charge. Best effort; a null means fall back to
// the charge amount as a single line.
async function lineItems(key: string, charge: any): Promise<{ desc: string; qty: number; price: number }[] | null> {
  if (!charge.payment_intent) return null;
  const sess = await stripeGET(key, `/v1/checkout/sessions?payment_intent=${encodeURIComponent(charge.payment_intent)}&limit=1`);
  const session = sess.ok ? sess.body.data?.[0] : null;
  if (!session) return null;
  const li = await stripeGET(key, `/v1/checkout/sessions/${session.id}/line_items`);
  if (!li.ok || !li.body.data?.length) return null;
  return li.body.data.map((item: any) => {
    const qty = item.quantity || 1;
    return {
      desc: item.description || "",
      qty,
      price: Math.round(item.amount_total / qty) / 100,
    };
  });
}

function formatAddress(source: any): string {
  const a = source?.address;
  if (!a) return "";
  return [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state, a.country]
    .filter(Boolean)
    .join("\n");
}

// Look up a customer by email (exact) or name (substring) for invoices that
// have no payment yet.
async function findCustomers(key: string, q: string): Promise<any[]> {
  const query = q.includes("@") ? `email:'${q.replace(/'/g, "")}'` : `name~'${q.replace(/'/g, "")}'`;
  const r = await stripeGET(key, `/v1/customers/search?query=${encodeURIComponent(query)}&limit=5`);
  return r.ok ? (r.body.data ?? []) : [];
}

async function stripeLookup(q: string): Promise<Response> {
  if (STRIPE_ACCOUNTS.length === 0) {
    return json({ error: "No Stripe keys configured. Add STRIPE_KEY_<NAME> entries to .env (see .env.example)." }, 400);
  }
  const cleaned = q.trim().replace(/^#/, "");
  if (!cleaned) return json({ error: "Empty query." }, 400);

  // Payment-shaped queries (receipt number, pi_/ch_ id) resolve to a charge:
  // customer + items + the real payment date. Anything else (an email or a
  // name) resolves to a Stripe Customer, for raising a fresh invoice that has
  // no payment behind it yet.
  const isPaymentQuery = /^(pi|ch|py)_/.test(cleaned) || /^[\d-]+$/.test(cleaned);

  for (const { account, key } of STRIPE_ACCOUNTS) {
    try {
      if (isPaymentQuery) {
        const charge = await findCharge(key, cleaned);
        if (!charge) continue;
        const items = await lineItems(key, charge).catch(() => null);
        const billing = charge.billing_details || {};
        const amount = (charge.amount_captured ?? charge.amount) / 100;
        return json({
          kind: "charge",
          account,
          receiptNumber: charge.receipt_number || "",
          reference: charge.payment_intent || charge.id,
          name: billing.name || "",
          email: billing.email || charge.receipt_email || "",
          address: formatAddress(billing),
          paidDate: new Date(charge.created * 1000).toISOString().slice(0, 10),
          currency: (charge.currency || "gbp").toUpperCase(),
          amount,
          items: items ?? [{ desc: charge.description || "", qty: 1, price: amount }],
        });
      }

      const customers = await findCustomers(key, cleaned);
      if (!customers.length) continue;
      const c = customers[0];
      return json({
        kind: "customer",
        account,
        matchCount: customers.length,
        name: c.name || "",
        email: c.email || "",
        address: formatAddress(c) || formatAddress(c.shipping),
      });
    } catch (e) {
      console.error(`Stripe lookup failed on account ${account}:`, e);
      continue;
    }
  }
  const hint = isPaymentQuery
    ? "Receipt numbers only cover the most recent ~300 charges per account; try the pi_/ch_ id from the Stripe dashboard."
    : "Customer search needs the exact email, or part of the name.";
  return json({ error: `No match for "${cleaned}" in ${STRIPE_ACCOUNTS.length} account(s). ${hint}` }, 404);
}

/* ---------------- HTTP ---------------- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(Bun.file(`${ROOT}/index.html`));
    }
    if (path.startsWith("/assets/") && !path.includes("..")) {
      const f = Bun.file(`${ROOT}${path}`);
      return (await f.exists()) ? new Response(f) : new Response("Not found", { status: 404 });
    }

    if (path === "/api/kv" && req.method === "GET") {
      return json(await loadStore());
    }
    if ((path === "/api/kv/settings" || path === "/api/kv/saved") && req.method === "PUT") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Body must be JSON." }, 400);
      }
      const store = await loadStore();
      if (path.endsWith("/saved")) {
        if (!Array.isArray(body)) return json({ error: "saved must be an array." }, 400);
        store.saved = body;
      } else {
        store.settings = body;
      }
      await saveStore(store);
      return json({ ok: true });
    }

    if (path === "/api/stripe/lookup" && req.method === "GET") {
      return stripeLookup(url.searchParams.get("q") || "");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Invoice generator: http://localhost:${server.port}`);
console.log(`Ledger: ${STORE_PATH}`);
console.log(
  STRIPE_ACCOUNTS.length
    ? `Stripe lookup enabled for: ${STRIPE_ACCOUNTS.map((a) => a.account).join(", ")}`
    : "Stripe lookup disabled (no STRIPE_KEY_* in .env)",
);
