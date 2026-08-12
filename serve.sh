#!/usr/bin/env bash
# Serve the invoice generator on http://localhost:4321 via the Bun server.
# The server persists the ledger to data/store.json and (with STRIPE_KEY_*
# entries in .env) enables the "Pull from Stripe" box.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
    echo "bun is required (brew install oven-sh/bun/bun)." >&2
    exit 1
fi

PORT="${1:-4321}"
open "http://localhost:${PORT}" 2>/dev/null || true
PORT="${PORT}" exec bun server.ts
