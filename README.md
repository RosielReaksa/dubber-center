# Dubber Center

A central website and API that stores many **dubber models** in one place. Each model is a
complete dubbing system (video in, dubbed video out). Callers pick a model by name, like
OpenRouter does for LLMs:

```bash
curl -X POST http://localhost:8000/v1/dub \
  -H "Authorization: Bearer dk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"paidv1","video_url":"https://example.com/video.mp4","source_lang":"en","target_lang":"km"}'
```

Specs:

- [`DUBBER_CENTER_PROJECT.md`](DUBBER_CENTER_PROJECT.md) — backend plan (steps 0–24)
- [`DUBBER_CENTER_FRONTEND.md`](DUBBER_CENTER_FRONTEND.md) — frontend plan (steps F0–F15)

## Stack

Python 3.12 · FastAPI · SQLAlchemy 2 (async) · Alembic · PostgreSQL · Redis + Arq ·
S3/MinIO · Next.js 15 (App Router) · Tailwind · TanStack Query.

## What is built

**Backend** — `src/dubber_center/`

| Area | Status |
|---|---|
| App skeleton, structured JSON logs, request ids, error envelope | ✅ |
| Full schema (17 tables) + Alembic migration | ✅ |
| Model registry: YAML manifests, upsert, language + price checks | ✅ |
| API keys (bearer) **and** browser session login | ✅ |
| Presigned uploads (S3/MinIO) + local-disk dev storage | ✅ |
| Jobs API: create, poll, list, cancel, idempotency, usage | ✅ |
| Worker: `queued → running → done/failed/canceled`, events, retries, fallback, timeout, sweep | ✅ |
| Adapters: `fake`, `http` runner, `cli` runner, `paidv1`, `localv1` | ✅ |
| Credits through a ledger, cost estimates, usage rollups | ✅ |
| Signed webhooks with retries (`X-Signature: sha256=…`) | ✅ |
| Admin API: overview, models, jobs, users, keys, usage, queue, workers, alerts, settings, audit | ✅ |
| RBAC (`user`/`support`/`admin`/`owner`), audit on every write, dry-run/confirm | ✅ |
| Health: ping + canary + real-traffic evaluator, 2-pass recovery, alerts, public `/v1/status` | ✅ |
| Rate limiting, file retention cleanup, daily stats rollups | ✅ |
| 110 tests (unit + API + admin role matrix + health rules) | ✅ |

**Frontend** — `frontend/`

| Area | Routes |
|---|---|
| Marketing | `/`, `/models`, `/models/[id]`, `/docs`, `/status` |
| Customer | `/dub`, `/jobs`, `/jobs/[id]`, `/keys`, `/credits`, `/usage`, `/settings` |
| Admin | `/admin`, `/admin/models`, `/admin/models/[id]`, `/admin/jobs`, `/admin/jobs/[id]`, `/admin/users`, `/admin/users/[id]`, `/admin/usage`, `/admin/queue`, `/admin/alerts`, `/admin/settings`, `/admin/audit` |
| Auth | `/login`, `/signup` |

Design: warm-neutral tokens, serif headings, light + dark with no flash, status shown as
text + icon (never colour alone), skeletons everywhere, English and Khmer.

## Local setup

### 1. Infrastructure

```bash
docker compose up -d      # postgres, redis, minio (+ creates the bucket)
cp .env.example .env
```

> On Windows Python/Node may not be on PATH. They live at
> `C:\Users\<you>\AppData\Local\Programs\Python\Python312\` and `C:\Program Files\nodejs\`.

### 2. Backend

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -e ".[dev]"

alembic upgrade head
uvicorn dubber_center.main:app --reload --port 8000
```

- API docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>

### 3. Create users

```bash
python -m dubber_center.cli create-user --email you@example.com
python -m dubber_center.cli create-user --email admin@example.com --role admin
python -m dubber_center.cli list-users
```

The key is printed once. Sign in on the website with the same email after adding a password
(via `/signup`), or use the key as a bearer token.

### 4. Worker

```bash
arq dubber_center.worker.settings.WorkerSettings
```

The worker runs user jobs on one queue and health checks, stats, and cleanup cron tasks on
a separate path so monitoring never waits behind a busy GPU.

### 5. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL` if the API is not on `http://localhost:8000`.

## Development without Docker

Every external dependency has a dev fallback, so the whole stack runs and tests with
nothing installed:

| Service | Dev fallback |
|---|---|
| PostgreSQL | `DATABASE_URL=sqlite+aiosqlite:///./dubber.db` (tables auto-create) |
| Redis | `REDIS_URL=` — jobs run in-process; `/workers` falls back to the DB |
| S3/MinIO | `STORAGE_BACKEND=local` — files go to `LOCAL_STORAGE_DIR` |

The test suite uses SQLite and local storage, so `pytest` needs no services:

```bash
pytest                 # 110 tests
ruff check src tests
cd frontend && npm run typecheck && npm run build
```

## Adding a model

Create `models/<id>.yaml` using the shape in
[`DUBBER_CENTER_PROJECT.md` §7](DUBBER_CENTER_PROJECT.md). That is the whole change if an
existing runner fits (`http`, `cli` or `python`). Restart the API or run
`python -m dubber_center.cli sync-models`, or save it from the admin model editor
(`/admin/models/new`), which validates the manifest before saving.

The canary check needs a short sample video:

```bash
python scripts/make_canary.py    # writes canary/sample_en_10s.mp4 (needs FFmpeg)
```

## Repository layout

```
src/dubber_center/
  api/          FastAPI routers: public, account, admin, status
  registry/     manifest schema, loading, lookup, pricing
  adapters/     adapter contract + fake/http/cli runners, paidv1, localv1
  worker/       job runner, health checks, cron settings
  services/     storage, usage, jobs, webhooks, audit, alerts, stats, maintenance
  db/           engine, session, SQLAlchemy tables
  schemas/      Pydantic request/response models
models/         one YAML manifest per model
canary/         tiny sample video for canary checks
migrations/     Alembic
tests/          unit, API, admin, health
frontend/       Next.js app (marketing, customer, admin)
```

## Notes and limits

- `paidv1` and `localv1` point at example internal hosts. Edit the `runner` block in
  their manifests to your real endpoints/commands before relying on them.
- Card payments are not wired: `POST /v1/credits/checkout` returns `501
  payments_not_enabled` and the UI says top-ups are handled by an admin.
- Canary output validation uses `ffprobe`/`ffmpeg` when present; without them the check
  records that it could not verify audio instead of failing the model.