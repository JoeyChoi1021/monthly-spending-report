#!/usr/bin/env python3
"""Generate monthly spending reports from a transaction CSV."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple


DATE_FMT = "%Y-%m-%d"


class Txn(dict):
    date: dt.date
    description: str
    amount: float
    kind: str
    category: str


def parse_date(value: str) -> dt.date:
    try:
        return dt.datetime.strptime(value.strip(), DATE_FMT).date()
    except ValueError as exc:
        raise ValueError(f"Invalid date '{value}'. Expected YYYY-MM-DD.") from exc


def normalize_kind_and_amount(raw_amount: str, raw_type: str) -> Tuple[str, float]:
    amount = float(raw_amount)
    txn_type = (raw_type or "").strip().lower()

    if txn_type == "expense":
        return "expense", abs(amount)
    if txn_type == "income":
        return "income", abs(amount)

    if amount < 0:
        return "expense", abs(amount)
    return "income", abs(amount)


def load_transactions(csv_path: Path) -> List[Txn]:
    required = {"date", "description", "amount"}
    txns: List[Txn] = []

    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row.")

        fields = {name.strip().lower() for name in reader.fieldnames}
        missing = required - fields
        if missing:
            raise ValueError(
                "CSV missing required columns: " + ", ".join(sorted(missing))
            )

        for i, row in enumerate(reader, start=2):
            try:
                date = parse_date(row.get("date", ""))
                description = (row.get("description", "") or "").strip()
                raw_amount = (row.get("amount", "") or "").strip()
                raw_type = (row.get("type", "") or "").strip()
                category = (row.get("category", "") or "").strip() or "Uncategorized"

                if not description:
                    description = "(No description)"

                kind, amount = normalize_kind_and_amount(raw_amount, raw_type)

                txns.append(
                    Txn(
                        date=date,
                        description=description,
                        amount=amount,
                        kind=kind,
                        category=category,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"Failed parsing line {i}: {exc}") from exc

    return txns


def month_key(date_obj: dt.date) -> str:
    return date_obj.strftime("%Y-%m")


def pick_target_month(transactions: List[Txn], requested: str | None) -> str:
    months = sorted({month_key(t["date"]) for t in transactions})
    if not months:
        raise ValueError("No transactions found.")

    if requested:
        if requested not in months:
            raise ValueError(
                f"Month {requested} has no records. Available months: {', '.join(months)}"
            )
        return requested

    return months[-1]


def render_report(month: str, transactions: List[Txn]) -> str:
    expenses = [t for t in transactions if t["kind"] == "expense"]
    incomes = [t for t in transactions if t["kind"] == "income"]

    total_expense = sum(t["amount"] for t in expenses)
    total_income = sum(t["amount"] for t in incomes)
    savings = total_income - total_expense

    by_category: Dict[str, float] = defaultdict(float)
    for t in expenses:
        by_category[t["category"]] += t["amount"]

    top_categories = sorted(by_category.items(), key=lambda x: x[1], reverse=True)
    biggest_expenses = sorted(expenses, key=lambda x: x["amount"], reverse=True)[:10]

    daily_expense: Dict[dt.date, float] = defaultdict(float)
    for t in expenses:
        daily_expense[t["date"]] += t["amount"]

    active_days = len(daily_expense)
    avg_daily = total_expense / active_days if active_days else 0.0

    lines = []
    lines.append(f"# Monthly Spending Report - {month}")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Total income: ${total_income:,.2f}")
    lines.append(f"- Total spending: ${total_expense:,.2f}")
    lines.append(f"- Net savings: ${savings:,.2f}")
    lines.append(f"- Expense transactions: {len(expenses)}")
    lines.append(f"- Average spending per active day: ${avg_daily:,.2f}")
    lines.append("")

    lines.append("## Spending by Category")
    if top_categories:
        lines.append("| Category | Amount | Share |")
        lines.append("|---|---:|---:|")
        for category, amount in top_categories:
            share = (amount / total_expense * 100.0) if total_expense else 0.0
            lines.append(f"| {category} | ${amount:,.2f} | {share:.1f}% |")
    else:
        lines.append("No expense records this month.")
    lines.append("")

    lines.append("## Biggest Expenses")
    if biggest_expenses:
        lines.append("| Date | Description | Category | Amount |")
        lines.append("|---|---|---|---:|")
        for t in biggest_expenses:
            lines.append(
                f"| {t['date']} | {t['description']} | {t['category']} | ${t['amount']:,.2f} |"
            )
    else:
        lines.append("No expense records this month.")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate monthly spending report")
    parser.add_argument(
        "--csv",
        default="data/transactions.csv",
        help="Path to CSV with columns date,description,amount[,category,type]",
    )
    parser.add_argument(
        "--month",
        default=None,
        help="Target month in YYYY-MM (default: latest available month in CSV)",
    )
    parser.add_argument(
        "--outdir",
        default="reports",
        help="Output directory for report files",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv)
    outdir = Path(args.outdir)

    if not csv_path.exists():
        raise SystemExit(f"Input CSV not found: {csv_path}")

    transactions = load_transactions(csv_path)
    target_month = pick_target_month(transactions, args.month)
    month_txns = [t for t in transactions if month_key(t["date"]) == target_month]

    outdir.mkdir(parents=True, exist_ok=True)
    output_path = outdir / f"spending-report-{target_month}.md"
    output_path.write_text(render_report(target_month, month_txns), encoding="utf-8")

    print(f"Report generated: {output_path.resolve()}")


if __name__ == "__main__":
    main()
