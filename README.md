# Simple Stripe Invoice

A tiny self-hosted invoice generator for small businesses that sell through
Stripe. Stripe's emailed receipts don't carry your customer's company details,
so sooner or later a business customer asks for "a proper invoice with our
company name on it, for the tax office". This makes that a two-minute job.

Paste the receipt number from the customer's Stripe receipt, and the customer,
line items and real payment date fill themselves in. Add their company details,
export a PDF, done.

- One HTML file for the UI, one small [Bun](https://bun.sh) server behind it
- Invoice numbers and saved invoices persist in a plain JSON file on disk
- Multiple companies, each with its own details, logo and numbering sequence
- Pulls customer, amounts and the payment date straight from Stripe (read-only)
- No accounts, no database, no cloud. Your data stays in the folder

## Quick start

```sh
git clone https://github.com/darrylmorley/simple-stripe-invoice
cd simple-stripe-invoice
./serve.sh
```

That opens http://localhost:4321. Fill in **Your business** once (name, address,
logo, invoice number prefix), it's remembered. Fill in the customer and items,
click **Export PDF**, and save from the print dialog. Turn off headers and
footers in the print options for a clean sheet.

**Save** stores the invoice in the ledger. **New** clears the form and bumps
the number (INV-0007 becomes INV-0008). Multiple companies each keep their own
sequence: pick "+ Add a company" in the dropdown.

Bun is the only dependency (`brew install oven-sh/bun/bun` on a Mac). Opening
`index.html` straight from disk also works, but then everything lives in that
browser's localStorage instead of the ledger, and the Stripe pull is off.

## Pull from Stripe

Copy `.env.example` to `.env` and add a key per Stripe account:

```
STRIPE_KEY_MYCOMPANY=rk_live_...
```

Use a **restricted, read-only** key, not your live secret key: Stripe
dashboard, Developers, API keys, "Create restricted key", read access to
Charges and Checkout Sessions only. The key never leaves the server process on
your machine.

Restart `./serve.sh` and a "Pull from Stripe" box appears at the top of the
Customer section. It takes:

- the receipt number from the customer's receipt email (like `1234-5678`)
- or a `pi_` / `ch_` id from the Stripe dashboard

and fills in the customer's name, email, address, the line items from the
Checkout Session, and the date they actually paid. Every configured account is
searched, so one box covers all your products. Receipt-number lookups scan the
most recent ~300 charges per account; for older payments use the `pi_` id.

Give the pulled fields a once-over before exporting. Stripe only knows what the
customer typed at checkout, and the company name they want on the invoice
usually arrives by email instead.

## Where your data lives

`data/store.json`, next to the server: your company profiles, the invoice
ledger and the numbering. It is plain JSON, it is gitignored along with `.env`,
and backing it up is copying one file. The exported PDFs are the definitive
record of what you sent, so file those too.

## VAT / sales tax

The default footer states that no VAT was charged and the business is not VAT
registered, which suits small non-registered businesses issuing receipts for
already-paid Stripe charges. The statement is editable per company. If you are
tax registered, edit it accordingly, and note the totals have no tax line: this
tool records a payment that already happened, it does not calculate tax.
Anything beyond that is a question for your accountant, not a README.

## Licence

MIT. See [LICENSE](LICENSE).
