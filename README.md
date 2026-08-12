# Simple Stripe Invoice

Invoicing for small and local businesses that take payments through Stripe.
No subscription, no signup, no cloud. It runs on your own computer and your
customer data stays there.

If you run a shop, a trade, a studio or a one-person software business, you
have probably hit both of these:

- **You need to invoice someone for work.** A customer books a job, you want
  a clean PDF with your logo, an invoice number and a due date on it. Most
  tools that do this want a monthly fee for what is essentially one page.
- **A customer asks for a proper receipt.** Stripe's emailed receipts don't
  show the customer's company name, so sooner or later a business customer
  asks for "an invoice with our details on it, for the tax office".

This does both, in about two minutes each, and remembers your invoice
numbering so the next invoice is always numbered correctly.

## What it does

- Clean A4 invoice with your business details and logo, exported to PDF
- Unpaid invoices with a due date, or paid-in-full receipts for money already
  taken
- Pulls your customer's details straight out of Stripe by email or name, or an
  entire payment (customer, items, the date they actually paid) from a receipt
  number
- VAT support if you're registered, a "no VAT charged" statement if you're not
- More than one business? Each keeps its own details, logo, VAT setup and
  numbering
- Everything is saved in one plain file on your machine. Backing up your
  invoicing is copying that file

## Getting started

You need [Bun](https://bun.sh), a free tool that runs the little server behind
the page (on a Mac: `brew install oven-sh/bun/bun`). Then:

```sh
git clone https://github.com/darrylmorley/simple-stripe-invoice
cd simple-stripe-invoice
./serve.sh
```

That opens the invoice editor in your browser at http://localhost:4321.

1. Fill in **Your business** once: name, address, logo, invoice number prefix.
   It's remembered.
2. Fill in the customer and the line items. Set a due date, or mark it paid.
3. Click **Export PDF** and save from the print dialog. Turn off headers and
   footers in the print options for a clean sheet.

**Save** files the invoice in the ledger. **New** clears the form and moves to
the next number (INV-0007 becomes INV-0008). Running more than one business?
Pick "+ Add a company" in the dropdown, each has its own numbering.

## Connecting Stripe

Optional, but it's the good part: stop retyping customer details.

Copy `.env.example` to `.env` and add a key per Stripe account:

```
STRIPE_KEY_MYCOMPANY=rk_live_...
```

Use a **restricted, read-only** key, not your main secret key: Stripe
dashboard, Developers, API keys, "Create restricted key", read access to
Charges, Checkout Sessions and Customers only. The key stays in a file on
your machine and is only used to read, never to charge anyone.

Restart `./serve.sh` and a "Pull from Stripe" box appears above the customer
fields. Type:

- **an email address or part of a name**: fills in that customer's details
  from Stripe, ready for a brand-new invoice
- **a receipt number** (like `1234-5678`, from the customer's Stripe receipt
  email) **or a `pi_` id** from the dashboard: fills in the customer, the
  items and the date they actually paid, and marks the invoice paid in full

If you run several Stripe accounts, every key is searched, so one box covers
all of them. Receipt-number lookups cover roughly the last 300 payments per
account; for anything older use the `pi_` id from the dashboard.

Whatever gets pulled, give the fields a once-over before exporting. Stripe
only knows what the customer typed at checkout, and the company name they
want on the invoice usually arrives by email instead.

## VAT

Each business has a **VAT registered** switch.

Off (the default), invoices carry a "no VAT charged, not VAT registered"
statement, which is what a small non-registered business needs. The wording
is editable.

On, you set your VAT number (printed with your details) and rate, and choose
what your prices mean:

- **VAT-inclusive**: prices are what the customer pays. Totals show
  "Includes VAT (20%)", the right way round for already-taken Stripe payments.
- **VAT-exclusive**: prices are net and VAT is added on top as its own line.

Reverse charge wording, per-line rates and the rest of the tax rulebook are
between you and your accountant.

## Where your data lives

`data/store.json`, next to the server: your business profiles, every saved
invoice and the numbering. Plain JSON, never uploaded anywhere, kept out of
git along with your `.env`. The exported PDFs are the definitive record of
what you sent, so file those too.

## Licence

MIT. See [LICENSE](LICENSE).
