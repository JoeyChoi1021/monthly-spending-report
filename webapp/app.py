#!/usr/bin/env python3
import argparse
import collections
import datetime as dt
import json
import math
import os
import sqlite3
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "spend_records.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")

if USE_POSTGRES:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except Exception as exc:
        raise RuntimeError("DATABASE_URL is set but psycopg is not installed. Install dependencies first.") from exc

FIXED_CATEGORIES = [
    "House",
    "Car",
    "Car Insurance",
    "Cat",
    "Loan",
    "Telecom",
    "Internet",
    "House Insurance",
    "Car Subscription",
    "Spotify Subscription",
    "Hulu Subscription",
    "Netflix Subscription",
    "Viki Subscription",
    "iPhone Insurance",
    "iCloud+",
]

NON_FIXED_CATEGORIES = [
    "Medical Fee",
    "Therapy Fee",
    "House Utility",
    "Eating",
]

ALLOWED_TYPES = {
    "Fixed Expense": FIXED_CATEGORIES,
    "Non-Fixed Expense": NON_FIXED_CATEGORIES,
}


def db_mode() -> str:
    return "postgres" if USE_POSTGRES else "sqlite"


def connect_db():
    if USE_POSTGRES:
        return psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def adapt_sql(sql: str) -> str:
    if USE_POSTGRES:
        return sql.replace("?", "%s")
    return sql


def fetch_all(sql: str, params=()) -> list[dict]:
    with connect_db() as conn:
        cur = conn.execute(adapt_sql(sql), params)
        rows = cur.fetchall()
    out = []
    for row in rows:
        if isinstance(row, dict):
            out.append(row)
        else:
            out.append(dict(row))
    return out


def fetch_one(sql: str, params=()):
    with connect_db() as conn:
        cur = conn.execute(adapt_sql(sql), params)
        row = cur.fetchone()
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    return dict(row)


def execute_sql(sql: str, params=()) -> int:
    with connect_db() as conn:
        cur = conn.execute(adapt_sql(sql), params)
        if not USE_POSTGRES:
            conn.commit()
        return cur.rowcount


def insert_and_get_id(sql: str, params=()) -> int:
    with connect_db() as conn:
        cur = conn.execute(adapt_sql(sql), params)
        if USE_POSTGRES:
            row = cur.fetchone()
            return int(row["id"])
        conn.commit()
        return int(cur.lastrowid)


def init_db() -> None:
    if USE_POSTGRES:
        execute_sql(
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
        execute_sql("CREATE INDEX IF NOT EXISTS idx_expenses_room_date ON expenses(room, date)")
        return

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                date TEXT NOT NULL,
                expense_type TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                payment_method TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expenses_room_date ON expenses(room, date)")


def validate_date(date_str: str) -> bool:
    try:
        dt.date.fromisoformat(date_str)
        return True
    except ValueError:
        return False


def month_bounds(month: str) -> tuple[str, str]:
    if len(month) != 7 or month[4] != "-":
        raise ValueError("Invalid month format. Expected YYYY-MM")

    year = int(month[:4])
    mon = int(month[5:7])
    start = dt.date(year, mon, 1)
    if mon == 12:
        end = dt.date(year + 1, 1, 1)
    else:
        end = dt.date(year, mon + 1, 1)
    return start.isoformat(), end.isoformat()


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    raw = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


def parse_amount(value) -> float:
    try:
        amount = float(Decimal(str(value)))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Amount must be a number")
    if amount < 0:
        raise ValueError("Amount must be >= 0")
    return round(amount, 2)


def create_expense(payload: dict) -> int:
    room = (payload.get("room") or "home").strip()[:50]
    date = (payload.get("date") or "").strip()
    expense_type = (payload.get("expense_type") or "").strip()
    category = (payload.get("category") or "").strip()
    payment_method = (payload.get("payment_method") or "").strip()[:50]
    note = (payload.get("note") or "").strip()[:300]
    amount = parse_amount(payload.get("amount"))

    if not validate_date(date):
        raise ValueError("Date must be YYYY-MM-DD")
    if expense_type not in ALLOWED_TYPES:
        raise ValueError("Invalid expense type")
    if category not in ALLOWED_TYPES[expense_type]:
        raise ValueError("Category does not match expense type")

    insert_sql = (
        """
        INSERT INTO expenses (room, date, expense_type, category, amount, payment_method, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
    )
    if USE_POSTGRES:
        insert_sql += " RETURNING id"

    return insert_and_get_id(
        insert_sql,
        (room or "home", date, expense_type, category, amount, payment_method, note),
    )


def summarize_with_openai(month: str, room: str, lines: list[dict], totals: dict) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    prompt = {
        "month": month,
        "room": room,
        "totals": totals,
        "top_categories": lines[:8],
        "instructions": [
            "Write a concise monthly spending summary for a family.",
            "Use plain English, max 120 words.",
            "Mention biggest category and one practical action.",
        ],
    }
    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are a concise household finance assistant."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.3,
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"OpenAI request failed: {exc.code} {details}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OpenAI request failed: {exc.reason}")

    parsed = json.loads(raw)
    try:
        return parsed["choices"][0]["message"]["content"].strip()
    except Exception:
        raise RuntimeError("OpenAI response parsing failed")


def month_start_to_yyyymm(start: dt.date) -> str:
    return f"{start.year:04d}-{start.month:02d}"


def add_months(start: dt.date, delta: int) -> dt.date:
    y = start.year
    m = start.month + delta
    while m > 12:
        y += 1
        m -= 12
    while m < 1:
        y -= 1
        m += 12
    return dt.date(y, m, 1)


def safe_div(n: float, d: float) -> float:
    if d == 0:
        return 0.0
    return n / d


def analyze_spend_forecast(room: str, month: str) -> dict:
    try:
        current_start = dt.date.fromisoformat(month + "-01")
    except Exception:
        raise ValueError("Month must be YYYY-MM")

    history_start = add_months(current_start, -12).isoformat()
    next_month = month_start_to_yyyymm(add_months(current_start, 1))

    rows = fetch_all(
        """
        SELECT date, expense_type, category, amount
        FROM expenses
        WHERE room = ? AND date >= ?
        ORDER BY date ASC, id ASC
        """,
        (room, history_start),
    )

    if not rows:
        return {
            "room": room,
            "month": month,
            "next_month": next_month,
            "prediction_total": 0.0,
            "confidence": "low",
            "history_months_used": 0,
            "message": "Need at least 1 month of data to estimate forecast.",
            "category_forecast": [],
            "patterns": {},
        }

    monthly_totals = collections.defaultdict(float)
    category_by_month = collections.defaultdict(lambda: collections.defaultdict(float))
    daily_totals = collections.defaultdict(float)
    weekday_sum = 0.0
    weekday_count = 0
    weekend_sum = 0.0
    weekend_count = 0

    for row in rows:
        d = dt.date.fromisoformat(str(row["date"]))
        ym = d.strftime("%Y-%m")
        amt = float(row["amount"] or 0.0)
        monthly_totals[ym] += amt
        category_by_month[ym][row["category"]] += amt
        daily_totals[str(row["date"])] += amt
        if d.weekday() >= 5:
            weekend_sum += amt
            weekend_count += 1
        else:
            weekday_sum += amt
            weekday_count += 1

    months_sorted = sorted(monthly_totals.keys())
    y = [monthly_totals[m] for m in months_sorted]
    n = len(y)

    if n == 1:
        trend_pred = y[-1]
    else:
        x = list(range(n))
        mean_x = sum(x) / n
        mean_y = sum(y) / n
        num = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
        den = sum((x[i] - mean_x) ** 2 for i in range(n))
        slope = safe_div(num, den)
        intercept = mean_y - slope * mean_x
        trend_pred = intercept + slope * n

    ma_window = y[-3:] if n >= 3 else y
    ma_pred = sum(ma_window) / max(1, len(ma_window))
    pred_total = max(0.0, round(0.55 * trend_pred + 0.45 * ma_pred, 2))

    if n >= 9:
        confidence = "high"
    elif n >= 4:
        confidence = "medium"
    else:
        confidence = "low"

    recent_months = months_sorted[-3:] if n >= 3 else months_sorted
    recent_category_totals = collections.defaultdict(float)
    recent_total = 0.0
    for m in recent_months:
        for cat, amt in category_by_month[m].items():
            recent_category_totals[cat] += amt
            recent_total += amt

    category_forecast = []
    for cat, cat_total in sorted(recent_category_totals.items(), key=lambda x: x[1], reverse=True):
        share = safe_div(cat_total, recent_total)
        category_forecast.append(
            {"category": cat, "share": round(share, 4), "predicted_amount": round(pred_total * share, 2)}
        )

    fixed_total = 0.0
    non_fixed_total = 0.0
    for row in rows:
        amt = float(row["amount"] or 0.0)
        if row["expense_type"] == "Fixed Expense":
            fixed_total += amt
        else:
            non_fixed_total += amt
    grand_total = fixed_total + non_fixed_total

    daily_values = list(daily_totals.values())
    mean_daily = safe_div(sum(daily_values), len(daily_values))
    variance = safe_div(sum((v - mean_daily) ** 2 for v in daily_values), len(daily_values))
    std_daily = math.sqrt(max(0.0, variance))
    cv = safe_div(std_daily, mean_daily)

    top3 = category_forecast[:3]
    patterns = {
        "fixed_ratio": round(safe_div(fixed_total, grand_total), 4),
        "non_fixed_ratio": round(safe_div(non_fixed_total, grand_total), 4),
        "weekday_avg_transaction": round(safe_div(weekday_sum, weekday_count), 2),
        "weekend_avg_transaction": round(safe_div(weekend_sum, weekend_count), 2),
        "daily_volatility_cv": round(cv, 4),
        "top_categories_recent": top3,
    }

    return {
        "room": room,
        "month": month,
        "next_month": next_month,
        "prediction_total": pred_total,
        "confidence": confidence,
        "history_months_used": n,
        "message": "Forecast uses trend + moving average from up to last 12 months.",
        "category_forecast": category_forecast[:8],
        "patterns": patterns,
    }


def sync_fixed_template(room: str, month: str, template: dict) -> dict:
    if not room:
        room = "home"
    start, end = month_bounds(month)
    normalized = {}
    for cat, raw in template.items():
        if cat not in FIXED_CATEGORIES:
            continue
        amt = parse_amount(raw)
        if amt > 0:
            normalized[cat] = amt

    inserted = 0
    updated = 0
    removed_duplicates = 0

    with connect_db() as conn:
        for cat, amount in normalized.items():
            cur = conn.execute(
                adapt_sql(
                    """
                    SELECT id
                    FROM expenses
                    WHERE room = ? AND date >= ? AND date < ?
                      AND expense_type = 'Fixed Expense' AND category = ?
                    ORDER BY id ASC
                    """
                ),
                (room, start, end, cat),
            )
            rows = cur.fetchall()
            ids = []
            for row in rows:
                if isinstance(row, dict):
                    ids.append(int(row["id"]))
                else:
                    ids.append(int(row["id"]))

            if not ids:
                insert_sql = (
                    """
                    INSERT INTO expenses (room, date, expense_type, category, amount, payment_method, note)
                    VALUES (?, ?, 'Fixed Expense', ?, ?, '', 'Monthly fixed template')
                    """
                )
                if USE_POSTGRES:
                    insert_sql += " RETURNING id"
                conn.execute(adapt_sql(insert_sql), (room, f"{month}-01", cat, amount))
                inserted += 1
                continue

            keep_id = ids[0]
            conn.execute(
                adapt_sql("UPDATE expenses SET amount = ?, note = 'Monthly fixed template' WHERE id = ? AND room = ?"),
                (amount, keep_id, room),
            )
            updated += 1

            for dup_id in ids[1:]:
                conn.execute(adapt_sql("DELETE FROM expenses WHERE id = ? AND room = ?"), (dup_id, room))
                removed_duplicates += 1

        if not USE_POSTGRES:
            conn.commit()

    return {
        "inserted": inserted,
        "updated": updated,
        "removed_duplicates": removed_duplicates,
        "categories_synced": len(normalized),
    }


class SpendHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return

        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/expenses":
            self.create_single_expense()
            return
        if parsed.path == "/api/expenses/bulk":
            self.create_bulk_expenses()
            return
        if parsed.path == "/api/template/sync":
            self.apply_template_sync()
            return
        if parsed.path == "/api/ai-summary":
            self.generate_ai_summary()
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def create_single_expense(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return
        try:
            expense_id = create_expense(payload)
        except ValueError as err:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(err)})
            return
        json_response(self, HTTPStatus.CREATED, {"ok": True, "id": expense_id})

    def create_bulk_expenses(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return

        items = payload.get("items") or []
        if not isinstance(items, list) or not items:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "items must be a non-empty list"})
            return

        inserted = []
        for item in items:
            if not isinstance(item, dict):
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Each item must be an object"})
                return
            try:
                inserted.append(create_expense(item))
            except ValueError as err:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(err)})
                return

        json_response(self, HTTPStatus.CREATED, {"ok": True, "ids": inserted})

    def apply_template_sync(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return

        room = (payload.get("room") or "home").strip()[:50]
        month = (payload.get("month") or "").strip()
        template = payload.get("template") or {}
        if not month:
            month = dt.date.today().strftime("%Y-%m")
        if not isinstance(template, dict):
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "template must be an object"})
            return

        try:
            result = sync_fixed_template(room=room, month=month, template=template)
        except ValueError as err:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(err)})
            return

        json_response(self, HTTPStatus.OK, {"ok": True, **result, "room": room, "month": month})

    def generate_ai_summary(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return

        room = (payload.get("room") or "home").strip()[:50]
        month = (payload.get("month") or "").strip() or dt.date.today().strftime("%Y-%m")
        try:
            start, end = month_bounds(month)
        except Exception:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Month must be YYYY-MM"})
            return

        by_category = fetch_all(
            """
            SELECT category, SUM(amount) AS total
            FROM expenses
            WHERE room = ? AND date >= ? AND date < ?
            GROUP BY category
            ORDER BY total DESC
            """,
            (room, start, end),
        )

        totals_row = fetch_one(
            """
            SELECT
              SUM(CASE WHEN expense_type = 'Fixed Expense' THEN amount ELSE 0 END) AS fixed_total,
              SUM(CASE WHEN expense_type = 'Non-Fixed Expense' THEN amount ELSE 0 END) AS non_fixed_total,
              SUM(amount) AS grand_total
            FROM expenses
            WHERE room = ? AND date >= ? AND date < ?
            """,
            (room, start, end),
        ) or {}

        totals = {
            "fixed_total": round(float(totals_row.get("fixed_total") or 0.0), 2),
            "non_fixed_total": round(float(totals_row.get("non_fixed_total") or 0.0), 2),
            "grand_total": round(float(totals_row.get("grand_total") or 0.0), 2),
        }

        try:
            text = summarize_with_openai(month=month, room=room, lines=by_category, totals=totals)
        except RuntimeError as err:
            json_response(self, HTTPStatus.BAD_GATEWAY, {"error": str(err)})
            return

        json_response(self, HTTPStatus.OK, {"summary": text, "month": month, "room": room})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/expenses/"):
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        expense_id = parsed.path.split("/")[-1]
        if not expense_id.isdigit():
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Invalid id"})
            return

        query = parse_qs(parsed.query)
        room = (query.get("room", ["home"])[0] or "home").strip()[:50]

        deleted = execute_sql("DELETE FROM expenses WHERE id = ? AND room = ?", (int(expense_id), room))
        if deleted == 0:
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "Record not found"})
            return

        json_response(self, HTTPStatus.OK, {"ok": True})

    def handle_api_get(self, parsed) -> None:
        query = parse_qs(parsed.query)
        room = (query.get("room", ["home"])[0] or "home").strip()[:50]

        if parsed.path == "/api/meta":
            payload = {
                "fixed_categories": FIXED_CATEGORIES,
                "non_fixed_categories": NON_FIXED_CATEGORIES,
                "expense_types": list(ALLOWED_TYPES.keys()),
                "db_mode": db_mode(),
            }
            json_response(self, HTTPStatus.OK, payload)
            return

        month = query.get("month", [None])[0] or dt.date.today().strftime("%Y-%m")
        try:
            start, end = month_bounds(month)
        except Exception:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "Month must be YYYY-MM"})
            return

        if parsed.path == "/api/expenses":
            rows = fetch_all(
                """
                SELECT id, room, date, expense_type, category, amount, payment_method, note, created_at
                FROM expenses
                WHERE room = ? AND date >= ? AND date < ?
                ORDER BY date DESC, id DESC
                """,
                (room, start, end),
            )
            for row in rows:
                row["date"] = str(row["date"])
                row["amount"] = float(row["amount"])
                row["created_at"] = str(row["created_at"])
            json_response(self, HTTPStatus.OK, {"items": rows, "room": room, "month": month})
            return

        if parsed.path == "/api/export.csv":
            rows = fetch_all(
                """
                SELECT date, expense_type, category, amount, payment_method, note, created_at
                FROM expenses
                WHERE room = ? AND date >= ? AND date < ?
                ORDER BY date ASC, id ASC
                """,
                (room, start, end),
            )
            lines = ["date,expense_type,category,amount,payment_method,note,created_at"]
            for row in rows:
                fields = [
                    str(row["date"]),
                    str(row["expense_type"]),
                    str(row["category"]),
                    f"{float(row['amount']):.2f}",
                    str(row.get("payment_method") or ""),
                    str(row.get("note") or ""),
                    str(row.get("created_at") or ""),
                ]
                escaped = []
                for field in fields:
                    escaped.append(f'"{field.replace("\"", "\"\"")}"')
                lines.append(",".join(escaped))

            data = "\n".join(lines).encode("utf-8")
            filename = f"spend-{room}-{month}.csv"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return

        if parsed.path == "/api/summary":
            by_category = fetch_all(
                """
                SELECT category, SUM(amount) AS total
                FROM expenses
                WHERE room = ? AND date >= ? AND date < ?
                GROUP BY category
                ORDER BY total DESC
                """,
                (room, start, end),
            )

            totals = fetch_one(
                """
                SELECT
                  SUM(CASE WHEN expense_type = 'Fixed Expense' THEN amount ELSE 0 END) AS fixed_total,
                  SUM(CASE WHEN expense_type = 'Non-Fixed Expense' THEN amount ELSE 0 END) AS non_fixed_total,
                  SUM(amount) AS grand_total
                FROM expenses
                WHERE room = ? AND date >= ? AND date < ?
                """,
                (room, start, end),
            ) or {}

            json_response(
                self,
                HTTPStatus.OK,
                {
                    "by_category": [
                        {"category": row["category"], "total": float(row["total"] or 0.0)} for row in by_category
                    ],
                    "totals": {
                        "fixed_total": round(float(totals.get("fixed_total") or 0.0), 2),
                        "non_fixed_total": round(float(totals.get("non_fixed_total") or 0.0), 2),
                        "grand_total": round(float(totals.get("grand_total") or 0.0), 2),
                    },
                    "room": room,
                    "month": month,
                },
            )
            return

        if parsed.path == "/api/forecast":
            try:
                payload = analyze_spend_forecast(room=room, month=month)
            except ValueError as err:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(err)})
                return
            json_response(self, HTTPStatus.OK, payload)
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def serve_static(self, path: str) -> None:
        rel_path = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC_DIR / rel_path).resolve()

        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        ctype = "text/plain; charset=utf-8"
        if target.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        elif target.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif target.suffix == ".js":
            ctype = "application/javascript; charset=utf-8"

        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        timestamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.address_string()} - {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Shared monthly spend tracker")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    args = parser.parse_args()

    os.makedirs(STATIC_DIR, exist_ok=True)
    init_db()

    server = ThreadingHTTPServer((args.host, args.port), SpendHandler)
    print(f"Server running on http://{args.host}:{args.port}")
    print(f"DB mode: {db_mode()}")
    print("Open in browser. Use ?room=your-shared-name to share the same data.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
