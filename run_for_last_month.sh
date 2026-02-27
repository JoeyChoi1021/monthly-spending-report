#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAST_MONTH="$(date -v-1m +%Y-%m)"

python3 "$SCRIPT_DIR/spending_report.py" \
  --csv "$SCRIPT_DIR/data/transactions.csv" \
  --month "$LAST_MONTH" \
  --outdir "$SCRIPT_DIR/reports"
