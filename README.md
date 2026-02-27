# Monthly Spending Report System

This tool generates a monthly spending report from your transaction CSV.

## What you get
- Monthly totals: income, spending, net savings
- Category breakdown with percentage share
- Top expense transactions
- Markdown report file you can keep or send

## Files
- `spending_report.py`: main report generator
- `data/transactions.csv`: input transactions
- `reports/`: generated reports
- `run_for_last_month.sh`: helper script for monthly automation

## CSV format
Required columns:
- `date` in `YYYY-MM-DD`
- `description`
- `amount`

Optional columns:
- `category` (defaults to `Uncategorized`)
- `type` (`expense` or `income`)

Notes:
- If `type` is omitted, negative `amount` is treated as expense, positive as income.

## Run it
From `/Users/yolo/monthly-spending-report`:

```bash
python3 spending_report.py --csv data/transactions.csv --month 2026-02 --outdir reports
```

Or generate report for latest month in the CSV:

```bash
python3 spending_report.py --csv data/transactions.csv --outdir reports
```

Or generate for last calendar month:

```bash
./run_for_last_month.sh
```

## Monthly automation with cron (optional)
Open crontab:

```bash
crontab -e
```

Run at 9:00 AM on day 1 of each month:

```cron
0 9 1 * * /Users/yolo/monthly-spending-report/run_for_last_month.sh >> /Users/yolo/monthly-spending-report/reports/cron.log 2>&1
```

This creates files like:
- `reports/spending-report-2026-02.md`

## Shared Interactive Web App (No Login)
A real-time shared GUI is available in `webapp/`.

### Features
- Shared room (you and your wife use the same `room` value in URL)
- Month-by-month tracking
- Fixed vs non-fixed category validation
- Live table updates
- Live bar chart by category
- Prev/next month buttons
- CSV export for the selected month
- Fixed expense monthly template (save once, apply each month)
- Optional AI monthly summary
- Monthly spend forecast and pattern analysis

### Run
From `/Users/yolo/monthly-spending-report/webapp`:

```bash
python3 app.py --host 0.0.0.0 --port 8080
```

Open:
- `http://localhost:8080/?room=home`

For sharing on local network, replace `localhost` with your Mac IP:
- `http://YOUR_LOCAL_IP:8080/?room=home`

Tip: use one room name for both users, for example `?room=joey-family`.

### Optional: enable AI Summary button
Set your API key in shell before running server:

```bash
export OPENAI_API_KEY="your_api_key_here"
python3 app.py --host 0.0.0.0 --port 8080
```

AI summary uses OpenAI `gpt-4o-mini` from the backend endpoint `POST /api/ai-summary`.

### Forecast and pattern analysis
Use `Run Forecast` in the web UI to estimate next-month total spend and category-level spend.

Backend endpoint:
- `GET /api/forecast?room=...&month=YYYY-MM`

It returns:
- next-month predicted total (trend + moving average model)
- confidence level based on history depth
- category forecast
- pattern stats (fixed/non-fixed ratio, weekday/weekend transaction averages, daily volatility)

## Deploy Globally (Render + Supabase)
Use this when you want a public URL that works anywhere.

### 1. Push project to GitHub
Push `/Users/yolo/monthly-spending-report` to a GitHub repo.

### 2. Create cloud Postgres (Supabase)
- Create a project in Supabase.
- Go to project settings and copy the Postgres connection string.
- Use that value as `DATABASE_URL` in Render.

### 3. Create Render Web Service
- In Render, create a new service from your GitHub repo.
- Render blueprint file is already included: [`render.yaml`](/Users/yolo/monthly-spending-report/render.yaml)
- Service root is `webapp/`.

### 4. Set environment variables in Render
- `DATABASE_URL` = your Supabase Postgres URL
- `OPENAI_API_KEY` = your OpenAI key (optional, needed for AI Summary)

### 5. Deploy and share URL
After deploy completes, share:
- `https://<your-render-service>.onrender.com/?room=home`

## Database Modes
The app supports two storage modes automatically:
- If `DATABASE_URL` is set to Postgres: cloud mode (global)
- If `DATABASE_URL` is not set: local SQLite at [`/Users/yolo/monthly-spending-report/webapp/spend_records.db`](/Users/yolo/monthly-spending-report/webapp/spend_records.db)
