#!/usr/bin/env python3
import os
import sqlite3
from pathlib import Path

import psycopg

BASE_DIR = Path(__file__).resolve().parents[1]
SQLITE_PATH = BASE_DIR / "spend_records.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


def main() -> None:
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL is not set")
    if not SQLITE_PATH.exists():
        raise SystemExit(f"SQLite file not found: {SQLITE_PATH}")

    src = sqlite3.connect(SQLITE_PATH)
    src.row_factory = sqlite3.Row

    with psycopg.connect(DATABASE_URL, autocommit=True) as dst:
        dst.execute(
            """
            CREATE TABLE IF NOT EXISTS expenses (
                id BIGSERIAL PRIMARY KEY,
                room TEXT NOT NULL,
                date DATE NOT NULL,
                expense_type TEXT NOT NULL,
                category TEXT NOT NULL,
                amount NUMERIC(12,2) NOT NULL,
                payment_method TEXT,
                note TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        dst.execute("CREATE INDEX IF NOT EXISTS idx_expenses_room_date ON expenses(room, date)")

        rows = src.execute(
            """
            SELECT room, date, expense_type, category, amount, payment_method, note, created_at
            FROM expenses
            ORDER BY id ASC
            """
        ).fetchall()

        if not rows:
            print("No local rows to migrate.")
            return

        with dst.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO expenses (room, date, expense_type, category, amount, payment_method, note, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        r["room"],
                        r["date"],
                        r["expense_type"],
                        r["category"],
                        float(r["amount"]),
                        r["payment_method"],
                        r["note"],
                        r["created_at"],
                    )
                    for r in rows
                ],
            )

        print(f"Migrated {len(rows)} rows from SQLite to Postgres.")


if __name__ == "__main__":
    main()
