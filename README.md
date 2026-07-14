# Leverage Report Dashboard

Upload a monthly **Leverage Report** `.xlsx` (Apurva.ai chatbot usage) and explore
it through an interactive dashboard: Overview trends + leaderboard with
month-over-month deltas, per-instance drill-down (top documents, top questions,
feedback/dislikes, a searchable paginated Q&A log), a multi-instance **Compare**
view, a narrative-style **Report** tab (programme overview, instance comparison
with rule-based status classification, knowledge leverage citations, feedback
analysis, cumulative performance, curation next-steps, key insights —
downloadable as a self-contained HTML file or printed to PDF), CSV export on
every table, a month selector, and light/dark mode.

## Stack
- **FastAPI** (Python) backend — parses the xlsx and serves the API
- **SQLite** (local dev) / **Turso — libSQL** (production) storage — normalized
  relational schema, not JSON blobs
- **Next.js + Tailwind CSS + Recharts** frontend
- Deploys as a single **Vercel** project (Vercel Services: one Next.js
  frontend service + one FastAPI backend service, same domain)

## Project layout
```
backend/     FastAPI app, parser, DB layer, requirements.txt, tests/
frontend/    Next.js app (App Router), Tailwind, Recharts
vercel.json  Vercel Services config (routes /api/* to backend, else frontend)
```

## Run it locally

### 1. Backend (terminal A)
```bash
cd backend
python3 -m venv ../.venv && source ../.venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
With no `TURSO_DATABASE_URL` set, this uses a local SQLite file at
`data/leverage.db` (created automatically), and retains uploaded raw workbooks
under `data/uploads/` for traceability. The CORS allowance defaults to
`http://localhost:3000`.

### 2. Frontend (terminal B)
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:3000. Click **Upload .xlsx** and pick a Leverage Report
file; the dashboard updates. (The project DB is already seeded with the
April/May/June 2026 reports if you just want to look.)

## How the data is modeled
The workbook comes in **two real layouts**, both handled by `backend/parser.py`:
- **New format** (May/June 2026): instance sheets with a two-row block header
  (`Top Documents Sourced | Top Questions Asked | Feedback Data | Total Questions
  Asked`). The `Total Questions Asked` block is the full Q&A log.
- **Old format** (April 2026): instance sheets with a single header row of
  concrete column names; one wide table; no separate Q&A-log block (question/
  answer pairs live in the feedback columns).

The Summary sheet's display names (e.g. `MILLET`) are reconciled to instance
sheet tabs (e.g. `SELCO_MILLET`) so Overview and drill-down share one identity.
Months are ordered **chronologically** (a `sort_key` derived from the label at
ingest time), not alphabetically.

## API
| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | backend + storage status |
| POST | `/api/upload` | multipart `.xlsx` → parse + idempotent ingest |
| GET  | `/api/months` | loaded months (selector) |
| GET  | `/api/instances?month_id=` | instance names for a month (drill-down dropdown) |
| GET  | `/api/all-instances` | every instance ever seen (Compare picker) |
| GET  | `/api/overview?month_id=` | cross-month trend + leaderboard + previous month's leaderboard (for MoM deltas) |
| GET  | `/api/instance?month_id=&name=` | documents / questions / feedback / dislikes |
| GET  | `/api/qa?month_id=&instance=&q=&source=&page=&page_size=` | paginated, searchable Q&A log |
| GET  | `/api/compare?instances=a,b,c` | per-month series for 2+ instances |
| GET  | `/api/report?month_id=` | programme-level report: comparison + status classification, knowledge leverage, feedback, cumulative performance, curation next-steps, key insights |

Re-uploading a month **replaces** its data (delete child rows, same `month_id`)
rather than duplicating. No LLM call touches the render path — the Report tab's
narrative (status labels, next-steps, insights) is entirely rule/threshold-based
over real stored data (see `get_report` in `backend/db.py`), and every
document/question/feedback quote it shows is copied verbatim from the workbook,
never generated. It intentionally omits a "Partner Utilisation Summary" section
(assets uploaded / shared to the collective) since that data isn't captured by
the current parser.

## Tests
```bash
source .venv/bin/activate
cd backend
python -m pytest tests/test_db.py tests/test_parser.py   # schema, idempotency, search, pagination, block-splitting
python tests/verify_api.py                                # end-to-end through the real upload endpoint; also re-seeds data/leverage.db
```

---

## Deploying (Vercel + Turso, both free)

GitHub Pages only serves static files — it can't run the FastAPI backend or
persist a SQLite file — so this deploys as a single **Vercel** project instead:
one [Vercel Service](https://vercel.com/docs/services) for the Next.js
frontend, one for the FastAPI backend, both on the same domain (no CORS to
configure in production), and [Turso](https://turso.tech) as the free,
serverless, SQLite-compatible database that replaces the local `.db` file so
uploads persist for every visitor.

### 1. Create a Turso database
```bash
brew install tursodatabase/tap/turso   # or see https://docs.turso.tech/cli/installation
turso auth login
turso db create leverage-dashboard
turso db show leverage-dashboard --url          # -> TURSO_DATABASE_URL
turso db tokens create leverage-dashboard        # -> TURSO_AUTH_TOKEN
```

### 2. Push this repo to GitHub
```bash
git add -A
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 3. Import the repo on Vercel
1. [vercel.com/new](https://vercel.com/new) → import the GitHub repo. Vercel
   reads the root `vercel.json` and provisions both services automatically.
2. In **Project Settings → Environment Variables**, add (for Production and
   Preview):
   - `TURSO_DATABASE_URL` = the URL from step 1
   - `TURSO_AUTH_TOKEN` = the token from step 1
3. Deploy. On first boot the backend creates the schema in Turso automatically
   (`db.init_db()`), and `/api/upload` starts writing straight to it.
4. Upload your monthly reports from the deployed site — they're now shared and
   persistent for every visitor, not just your browser.

That's it — no separate hosting for the backend, no server to keep warm, no
30-day-expiring free databases. Both Vercel and Turso's free tiers are
indefinite for a workload this size.

### Notes
- Locally (no `TURSO_*` env vars set), the app keeps using a local SQLite file
  — nothing about local dev changes.
- Full-text search (FTS5) is used when the connected engine supports it and
  transparently falls back to a `LIKE`-based search otherwise, so Turso works
  either way.
- Raw uploaded workbooks are only archived to local disk in local dev
  (`data/uploads/`); Vercel's filesystem is ephemeral, so in production only
  the parsed, normalized data is persisted (to Turso).
