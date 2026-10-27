# Dubber Center — Project Plan (Backend First)

A central website and API that stores many "dubber models" in one place. Each model is a **complete dubbing system** (video in, dubbed video out). The caller picks a model by name, like OpenRouter does for LLMs, but here the model is a whole dubbing pipeline.

```
POST /v1/dub   { "model": "paidv1", "video_url": "...", "source_lang": "en", "target_lang": "km" }
```

---

## 1. Core concepts

| Term | Meaning |
|---|---|
| **Model** | One complete dubbing system, for example `paidv1` (full pipeline through paid APIs) or `localv1` (full pipeline on local models). Identified by a model ID. |
| **Registry** | The list of all models, with languages, price, status and how to run each one. Adding a model means adding one manifest. |
| **Adapter** | The small piece of code that connects the center to one model. All adapters have the same interface. |
| **Job** | One dubbing request. It is async: the API returns a `job_id`, and the caller polls or gets a webhook. |
| **Runner** | The way an adapter runs a model: `http` (calls a service), `cli` (runs a script or container), or `python` (a class in this codebase). |

**The one rule:** every model takes the same input and returns the same output, whatever it does inside.

- Input: video + source language + target language + options
- Output: dubbed video (+ optional audio track, subtitles, timing JSON)

## 2. Decisions and assumptions

These are the defaults. Change them if they do not fit.

- Language: **Python 3.12**, framework **FastAPI**
- Database: **PostgreSQL**, with **SQLAlchemy 2** and **Alembic** migrations
- Queue: **Redis** with **Arq** (async worker)
- File storage: **S3-compatible** (MinIO locally, S3 on AWS)
- Auth: **API keys** (hashed in the database)
- Local run: **Docker Compose**
- Existing systems (`paidv1`, `localv1`) are wrapped, not rewritten

## 3. Architecture

```
Clients (website, customer apps)
        │  HTTPS + API key
        ▼
┌─────────────────────────────┐
│  API (FastAPI)              │  auth, validation, create job, read status
└──────┬───────────────┬──────┘
       │               │
       ▼               ▼
  PostgreSQL        Redis queue
  (jobs, models,        │
   users, usage)        ▼
                 ┌──────────────┐
                 │  Worker(s)   │  picks job → resolves adapter → runs model
                 └──────┬───────┘
                        │ adapter interface
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   paidv1 adapter   localv1 adapter   future adapters
   (http runner)    (cli runner)
        │
        ▼
  Object storage (input and output files)
```

The API never runs a model. It only creates jobs. Workers do all the long work.

## 4. Repository structure

```
dubber-center/
├── README.md
├── DUBBER_CENTER_PROJECT.md
├── docker-compose.yml
├── pyproject.toml
├── .env.example
├── alembic.ini
├── migrations/
├── models/                     # model manifests (one YAML per model)
│   ├── paidv1.yaml
│   └── localv1.yaml
├── canary/                     # tiny sample videos used by canary checks
│   └── sample_en_10s.mp4
├── src/dubber_center/
│   ├── main.py                 # FastAPI app
│   ├── config.py               # settings from env
│   ├── db/
│   │   ├── base.py             # engine, session
│   │   └── tables.py           # SQLAlchemy tables
│   ├── schemas/                # Pydantic request/response models
│   ├── api/
│   │   ├── deps.py             # auth dependency
│   │   ├── models.py           # GET /v1/models
│   │   ├── jobs.py             # POST /v1/dub, GET /v1/jobs
│   │   ├── files.py            # upload URLs
│   │   └── admin/              # admin only (see section 14)
│   │       ├── overview.py
│   │       ├── models.py
│   │       ├── jobs.py
│   │       ├── users.py
│   │       ├── usage.py
│   │       ├── queue.py
│   │       └── settings.py
│   ├── registry/
│   │   ├── manifest.py         # manifest schema + loader
│   │   └── service.py          # lookup, language check, price estimate
│   ├── adapters/
│   │   ├── base.py             # DubberAdapter interface
│   │   ├── fake.py             # test adapter
│   │   ├── http_runner.py
│   │   ├── cli_runner.py
│   │   ├── paidv1.py
│   │   └── localv1.py
│   ├── worker/
│   │   ├── tasks.py            # run_job task
│   │   ├── health_tasks.py     # ping, canary, status evaluator (section 15)
│   │   └── settings.py         # Arq settings
│   ├── services/
│   │   ├── storage.py          # S3/MinIO helper
│   │   ├── webhooks.py
│   │   ├── usage.py            # cost + ledger
│   │   ├── audit.py            # write audit_log rows
│   │   ├── alerts.py           # alert rules + cron
│   │   ├── stats.py            # daily_stats rollup
│   │   └── health.py           # status rules, canary checks, notifications
│   └── core/
│       ├── security.py         # API key hashing
│       └── errors.py
└── tests/
```

---

## 5. Build steps (backend)

Do the steps in order. Each step ends with **Done when**, a check you can run before moving on.

### Step 0 — Project setup
- Create the repo and virtual environment.
- Add `pyproject.toml` with: `fastapi`, `uvicorn`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pydantic-settings`, `arq`, `redis`, `boto3`, `httpx`, `pyyaml`, `pytest`, `pytest-asyncio`, `ruff`.
- Write `docker-compose.yml` with `postgres`, `redis` and `minio`.
- Write `.env.example` (see section 9).

**Done when:** `docker compose up -d` starts all three services and you can connect to each.

### Step 1 — API skeleton
- `config.py` loads settings from environment variables.
- `main.py` creates the FastAPI app with `GET /health` returning `{"status": "ok"}`.
- Add structured logging with a request ID on each request.

**Done when:** `uvicorn` runs and `GET /health` returns ok. `/docs` shows the OpenAPI page.

### Step 2 — Database and migrations
- Create the tables in section 6 with SQLAlchemy.
- Set up Alembic and generate the first migration.
- Create an async session dependency.

**Done when:** `alembic upgrade head` creates all tables in Postgres.

### Step 3 — Model registry
- Define the manifest schema (section 7) with Pydantic.
- Load every `models/*.yaml` file at startup and upsert into the `models` table.
- Endpoints: `GET /v1/models` and `GET /v1/models/{id}`.
- Add `registry/service.py` with `get_model(id)`, `supports(model, source, target)` and `estimate_cost(model, minutes)`.

**Done when:** `GET /v1/models` lists `paidv1` and `localv1` with languages, price and status.

### Step 4 — Auth and users
- Tables: `users`, `api_keys`.
- Create keys as `dk_live_<random>`. Show the key once, store only its hash (SHA-256 or Argon2).
- `deps.py`: a dependency that reads `Authorization: Bearer <key>`, finds the user, and rejects revoked or missing keys.
- Add a script `python -m dubber_center.cli create-user --email ...` that creates a user and prints a key.

**Done when:** a request without a key returns 401, and with a valid key returns 200.

### Step 5 — File storage
- `services/storage.py` with: `presign_upload(key)`, `presign_download(key)`, `copy_from_url(url, key)`.
- Endpoint `POST /v1/files` returns an upload URL and a `file_id`.
- Accept either `file_id` or `video_url` when a job is created.
- Add a size limit and an allowed-type check (`mp4`, `mov`, `mkv`, `webm`).

**Done when:** you can upload a test video to MinIO through the presigned URL and download it back.

### Step 6 — Jobs API
- `POST /v1/dub` validates the request:
  - the model exists and is `active`
  - source and target languages are supported by that model
  - the video is within the model's max length
  - the user has enough credits (if billing is on)
- It creates a `jobs` row with status `queued`, pushes the `job_id` into the Arq queue, and returns `{ "job_id", "status": "queued" }`.
- `GET /v1/jobs/{id}` returns status, progress, output URLs, cost and error.
- `GET /v1/jobs` lists the user's jobs (paged).
- `POST /v1/jobs/{id}/cancel` sets a cancel flag.
- Users can only see their own jobs.

**Done when:** you can create a job and see it in `queued` state (no worker yet).

### Step 7 — Worker and job runner
- `worker/tasks.py` has `run_job(job_id)`:
  1. Load the job and mark it `running`.
  2. Resolve the adapter from the model's manifest.
  3. `external_id = await adapter.submit(job_input)`
  4. Loop: `await adapter.status(external_id)` every few seconds, write progress to the job, check the cancel flag.
  5. On finish: `await adapter.result(external_id)`, save the output files, mark `done`.
  6. On error: save the error, mark `failed`.
- Write a `job_events` row for each status change.

**Done when:** with the `fake` adapter, a job moves `queued → running → done` and has an output file.

### Step 8 — Adapters
- `adapters/base.py` defines the interface (section 8).
- `fake.py` sleeps and returns a copy of the input video. Use it for tests.
- `http_runner.py` is a reusable adapter for models that are already web services (submit URL, status URL, result URL from the manifest).
- `cli_runner.py` is a reusable adapter for scripts or containers. It starts a subprocess with a working folder, reads progress from stdout or a `progress.json` file, and returns the output file path.
- `paidv1.py` and `localv1.py` wrap your real systems using the runner that matches each one.

**Done when:** a real short video dubs end to end through `paidv1`, and again through `localv1`.

### Step 9 — Reliability
- **Timeouts:** per-model max runtime from the manifest.
- **Retries:** retry transient errors (network, 5xx) with backoff, up to N times. Do not retry validation errors.
- **Fallback (optional):** if the manifest lists `fallback: localv1`, run it when the first model fails. Record this in `job_events`.
- **Concurrency limits:** each model has `max_concurrent`. Local models are GPU-limited, so extra jobs wait in the queue.
- **Stuck-job sweeper:** a cron task marks jobs `failed` if they are `running` past their timeout with no progress.
- **Idempotency:** an `Idempotency-Key` header on `POST /v1/dub` prevents duplicate jobs on retry.

**Done when:** you can kill a worker mid-job and the job is retried or failed cleanly, never stuck forever.

### Step 10 — Webhooks and events
- A user can set a `webhook_url` per job (or per account).
- On `done` or `failed`, send a signed POST (`X-Signature` HMAC) with retries.
- Store each delivery attempt in `webhook_deliveries`.

**Done when:** a test receiver gets a signed webhook when a job finishes.

### Step 11 — Usage and cost
- `estimate_cost` runs before the job starts and is returned in the `POST /v1/dub` response.
- When a job finishes, write a `usage_ledger` row with the real cost, the model and the video minutes.
- If credits are enabled, deduct them at job completion and refuse new jobs at zero.
- `GET /v1/usage` returns totals per day and per model.

**Done when:** after a job, the ledger row exists and the credit balance went down.

### Step 12 — Admin and health
- Admin-only endpoints: register or update a model, enable or disable it, set price, create users and keys. (This is the minimum. The full admin dashboard backend is in section 14, Steps 14 to 19.)
- Health checks: a basic version is enough here (call `adapter.health()` every minute and store the result). The full design (ping, canary jobs, rolling stats, status rules, notifications) is in section 15, Steps 20 to 24.
- Disabling a model stops new jobs but lets running ones finish.

**Done when:** you can disable `localv1` and new jobs for it are rejected with a clear error.

### Step 13 — Tests, docs and hardening
- Unit tests: manifest loading, language check, cost estimate, key hashing.
- API tests with the `fake` adapter: create, poll, cancel, auth failure.
- Rate limiting per API key (Redis counter).
- Clean the OpenAPI docs: descriptions and examples on each endpoint.
- Auto-delete input and output files after N days.

**Done when:** `pytest` passes and a new developer can run the project from the README in under 10 minutes.

---

## 6. Data model

| Table | Main columns |
|---|---|
| `users` | id, email, plan, credits, is_admin, created_at |
| `api_keys` | id, user_id, key_hash, prefix, name, revoked_at, last_used_at |
| `models` | id (e.g. `paidv1`), name, type (`api`/`local`/`hybrid`), status, manifest (JSON), price_per_min, version, health_state, health_since, health_checked_at, last_ok_at (health columns: see section 15) |
| `files` | id, user_id, storage_key, size, content_type, expires_at |
| `jobs` | id, user_id, model_id, status, progress, input_file_id, source_lang, target_lang, options (JSON), external_id, output (JSON), error, cost, attempts, cancel_requested, created_at, started_at, finished_at |
| `job_events` | id, job_id, status, message, created_at |
| `usage_ledger` | id, user_id, job_id, model_id, minutes, cost, created_at |
| `webhook_deliveries` | id, job_id, url, status_code, attempt, created_at |
| `model_health` | id, model_id, check_type (`ping`/`canary`), ok, latency_ms, error_code, detail (JSON), checked_at |
| `model_status_events` | id, model_id, old_state, new_state, reason, created_at |
| `model_daily_uptime` | date, model_id, up_minutes, degraded_minutes, down_minutes, jobs, success_rate |

## 7. Model manifest format

One YAML file per model in `models/`.

```yaml
id: paidv1
name: Paid V1
description: Full dubbing pipeline through paid APIs
type: api                  # api | local | hybrid
status: active             # active | beta | disabled
version: 1
languages:
  source: [en, zh, th]
  target: [km, en]
price_per_minute: 0.40     # what you charge
max_video_minutes: 60
max_concurrent: 10
timeout_minutes: 45
features: [subtitles, multi_speaker]
fallback: localv1          # optional
health:                    # see section 15
  ping_interval_sec: 60
  canary:
    enabled: true
    interval_minutes: 60   # paid models: keep this long, each canary costs money
    sample: canary/sample_en_10s.mp4
    source_lang: en
    target_lang: km
runner:
  kind: http               # http | cli | python
  http:
    submit_url: http://paid-system.internal/dub
    status_url: http://paid-system.internal/jobs/{external_id}
    result_url: http://paid-system.internal/jobs/{external_id}/result
```

```yaml
id: localv1
name: Local V1
type: local
status: active
version: 1
languages:
  source: [en, zh]
  target: [en, km]
price_per_minute: 0.05
max_video_minutes: 30
max_concurrent: 1          # one GPU
timeout_minutes: 120
health:
  ping_interval_sec: 60
  canary:
    enabled: true
    interval_minutes: 30
    sample: canary/sample_en_10s.mp4
    source_lang: en
    target_lang: km
runner:
  kind: cli
  cli:
    command: "python /opt/localv1/dub.py --input {input} --out {outdir} --src {source_lang} --tgt {target_lang}"
    progress_file: "{outdir}/progress.json"
    output_file: "{outdir}/dubbed.mp4"
```

## 8. Adapter contract

```python
from abc import ABC, abstractmethod
from pydantic import BaseModel

class JobInput(BaseModel):
    job_id: str
    input_path_or_url: str
    source_lang: str
    target_lang: str
    options: dict = {}
    workdir: str

class AdapterStatus(BaseModel):
    state: str            # "running" | "done" | "failed"
    progress: float = 0   # 0.0 to 1.0
    message: str = ""

class JobOutput(BaseModel):
    video_path: str
    audio_path: str | None = None
    subtitles_path: str | None = None
    timing_json_path: str | None = None
    minutes: float

class DubberAdapter(ABC):
    @abstractmethod
    async def submit(self, job: JobInput) -> str: ...        # returns external_id

    @abstractmethod
    async def status(self, external_id: str) -> AdapterStatus: ...

    @abstractmethod
    async def result(self, external_id: str) -> JobOutput: ...

    @abstractmethod
    async def cancel(self, external_id: str) -> None: ...

    async def health(self) -> bool:
        return True
```

Adding a new model = a manifest file + (only if no existing runner fits) one new adapter class.

## 9. Environment variables (`.env.example`)

```
APP_ENV=dev
DATABASE_URL=postgresql+asyncpg://dubber:dubber@localhost:5432/dubber
REDIS_URL=redis://localhost:6379/0
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=dubber-files
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
FILE_RETENTION_DAYS=7
WEBHOOK_SECRET=change-me
ADMIN_BOOTSTRAP_EMAIL=you@example.com
MAX_UPLOAD_MB=2000
```

## 10. API reference (v1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/v1/models` | List models (languages, price, status, health) |
| GET | `/v1/models/{id}` | One model |
| GET | `/v1/models/{id}/status` | Health state, 30-day uptime, recent incidents |
| GET | `/v1/status` | Health state of all models (public status page) |
| POST | `/v1/files` | Get an upload URL |
| POST | `/v1/dub` | Create a dubbing job |
| GET | `/v1/jobs` | List my jobs |
| GET | `/v1/jobs/{id}` | Job status and result |
| POST | `/v1/jobs/{id}/cancel` | Cancel a job |
| GET | `/v1/usage` | Usage and cost |
| POST | `/v1/admin/models` | Register or update a model (admin) |
| POST | `/v1/admin/models/{id}/disable` | Disable a model (admin) |
| POST | `/v1/admin/users` | Create a user and key (admin) |

**Create job**

```json
POST /v1/dub
{
  "model": "paidv1",
  "video_url": "https://example.com/video.mp4",
  "source_lang": "en",
  "target_lang": "km",
  "webhook_url": "https://my.site/hooks/dub",
  "options": { "subtitles": true }
}
```
```json
201
{ "job_id": "job_01H...", "status": "queued", "model": "paidv1", "estimated_cost": 2.0 }
```

**Job status**

```json
GET /v1/jobs/job_01H...
{
  "job_id": "job_01H...",
  "status": "done",
  "progress": 1.0,
  "model": "paidv1",
  "output": {
    "video_url": "https://.../dubbed.mp4",
    "subtitles_url": "https://.../subs.srt"
  },
  "cost": 2.0,
  "error": null
}
```

**Error format (all endpoints)**

```json
{ "error": { "code": "language_not_supported", "message": "paidv1 does not support target 'xx'" } }
```

## 11. Job lifecycle

```
queued → running → done
            │
            ├→ failed      (error saved; retry or fallback may start a new attempt)
            └→ canceled    (user cancelled)
```

Every change writes a row to `job_events`, which gives a full timeline per job.

## 12. Definition of done for the backend

- [ ] Two real models (`paidv1`, `localv1`) work end to end through the same API
- [ ] A third model can be added with only a manifest (and an adapter if needed), without changing core code
- [ ] Jobs never get stuck: timeouts, retries and sweeper work
- [ ] API keys, ownership checks and rate limits work
- [ ] Cost estimate, usage ledger and credits work
- [ ] Webhooks are signed and retried
- [ ] Admin can enable or disable a model without a deploy
- [ ] Admin dashboard APIs (section 14) work: overview, models, jobs, users, usage, queue, settings
- [ ] Every admin write action is role-checked and written to the audit log
- [ ] Model health works (section 15): ping, canary and real-traffic checks produce `healthy`, `degraded`, `down` or `unknown`
- [ ] A `down` model rejects new jobs (or falls back), and every state change creates an event, an alert and a notification
- [ ] Canary jobs never appear in user lists, usage, billing or success-rate stats
- [ ] Tests pass and the README explains local setup

## 13. After the backend

1. **Frontend:** model catalog page, upload and job form, job page with progress, download, API keys, usage.
2. **Billing:** payments, plans, credit top-ups.
3. **Deploy:** move to AWS (API on ECS Fargate or Lambda, queue on SQS or Redis, files on S3, GPU workers on AWS Batch).
4. **More models:** `awsv1` (Transcribe, Translate or Bedrock, Polly, MediaConvert), `hybridv1`, `newv1`.
5. **Smart routing:** `model: "auto"` chooses by price, speed, quality and language support.

## 14. Admin dashboard (backend)

The dashboard screens are built in a separate frontend file. This section covers everything the backend must provide for them. All routes live under `/v1/admin` and need an admin-level role.

### 14.1 Roles

Replace the `is_admin` flag with a `role` column on `users`: `user`, `support`, `admin`, `owner`. Add a `status` column: `active` or `suspended`.

| Action | support | admin | owner |
|---|---|---|---|
| View overview, jobs, users, usage, queue | yes | yes | yes |
| Retry or cancel a job | yes | yes | yes |
| Manage users, credits, API keys | no | yes | yes |
| Add, edit, enable or disable models | no | yes | yes |
| Pause or resume a model queue | no | yes | yes |
| Change settings, manage admins | no | no | yes |

### 14.2 New tables and columns

| Table | Main columns |
|---|---|
| `audit_log` | id, actor_user_id, action, target_type, target_id, before (JSON), after (JSON), ip, created_at |
| `settings` | key, value (JSON), updated_by, updated_at |
| `credit_transactions` | id, user_id, amount, reason, actor_user_id, job_id (nullable), created_at |
| `daily_stats` | date, model_id, jobs_total, jobs_done, jobs_failed, minutes, revenue, cost, avg_duration_sec |
| `alerts` | id, type, severity, subject_type, subject_id, message, created_at, resolved_at |

New columns:

- `models.queue_paused` (bool, default false)
- `jobs.admin_notes` (text)
- `jobs.retried_from_job_id` (nullable)
- `users.role`, `users.status`

### 14.3 Endpoints per dashboard page

| Page | Endpoints |
|---|---|
| **Overview** | `GET /v1/admin/overview` returns jobs today, success rate, active jobs, queue length, revenue and cost today, models down, open alerts. `GET /v1/admin/stats/timeseries?metric=jobs\|revenue\|cost&group_by=day\|model&from=&to=` returns chart data. |
| **Models** | `GET /v1/admin/models` (with health, success rate, average time). `POST /v1/admin/models` (create from manifest). `PUT /v1/admin/models/{id}`. `POST /v1/admin/models/{id}/enable` and `/disable`. `POST /v1/admin/models/validate-manifest` (live preview, no save). `POST /v1/admin/models/{id}/test` (runs a small sample job). `POST /v1/admin/models/{id}/check-now` (ping and canary immediately). `GET /v1/admin/models/{id}/health-history` (check log and state changes). |
| **Jobs** | `GET /v1/admin/jobs?status=&model=&user=&from=&to=&q=&page=&size=&sort=`. `GET /v1/admin/jobs/{id}` (full detail with events, files, cost, error). `GET /v1/admin/jobs/{id}/logs`. `GET /v1/admin/jobs/{id}/files` (presigned URLs). `POST /v1/admin/jobs/{id}/retry`. `POST /v1/admin/jobs/{id}/cancel`. `PATCH /v1/admin/jobs/{id}` (admin notes). |
| **Users and keys** | `GET /v1/admin/users`. `POST /v1/admin/users`. `GET /v1/admin/users/{id}`. `PATCH /v1/admin/users/{id}` (plan, role, status). `POST /v1/admin/users/{id}/credits` with `{amount, reason}`. `GET` and `POST /v1/admin/users/{id}/keys`. `DELETE /v1/admin/keys/{key_id}`. |
| **Usage and billing** | `GET /v1/admin/usage?group_by=model\|user\|day&from=&to=`. `GET /v1/admin/usage/export.csv`. |
| **Queue and workers** | `GET /v1/admin/queue` (waiting and running per model). `POST /v1/admin/models/{id}/pause-queue` and `/resume-queue`. `GET /v1/admin/workers` (heartbeats). `POST /v1/admin/jobs/sweep-stuck`. |
| **Settings and audit** | `GET` and `PUT /v1/admin/settings`. `GET /v1/admin/audit-log?actor=&action=&target=&from=&to=`. |
| **Alerts** | `GET /v1/admin/alerts?status=open\|resolved`. `POST /v1/admin/alerts/{id}/resolve`. |

### 14.4 Rules the backend must follow

- **RBAC on every route.** Check the role from the table in 14.1 in a shared dependency, not inside each handler.
- **Audit every write.** Each admin write action stores an `audit_log` row (with `before` and `after`) in the same database transaction as the change.
- **Dry run for dangerous actions.** Disabling a model, revoking a key, suspending a user, and sweeping stuck jobs accept `?dry_run=true` and return the impact, for example `{"will_affect": {"running_jobs": 3, "queued_jobs": 12}}`. The real call needs `confirm=true`.
- **Credits only through the ledger.** Never edit a balance directly. Insert a `credit_transactions` row and update the balance in one transaction.
- **Never return secrets.** API keys are shown once at creation, then only the prefix. Never return hashes or the webhook secret.
- **Pagination.** Every list endpoint takes `page` and `size` (max 100) and returns the total count.
- **Worker heartbeats.** Each worker writes a Redis key `worker:{id}` every 10 seconds with a 30 second expiry, holding its current model and job. `GET /v1/admin/workers` reads these keys. A missing key means the worker is offline.
- **Queue pause.** Workers check `models.queue_paused` before taking a job for that model. Paused jobs stay `queued`.
- **Stats rollup.** A cron task every 5 minutes updates `daily_stats`. The overview reads from it plus live counters, so the dashboard stays fast on large job tables.
- **Alert rules** (a cron task every minute, with de-duplication so one problem makes one alert):
  - a model changes to `degraded` or `down`, and again when it recovers (see section 15)
  - failure rate for a model is above a set limit in the last hour
  - the oldest queued job has waited longer than a set time
  - a worker is offline while its model has queued jobs
  - a user's credits fall below a set limit

### 14.5 Build steps (continue after Step 13)

**Step 14 — Roles and audit log**
- Add `role` and `status` to `users`, create `audit_log` and `settings`.
- Write the RBAC dependency (`require_role("admin")`) and the `audit.py` helper.
- Replace every earlier `is_admin` check.

**Done when:** a `support` user gets 403 on a model edit, and an `admin` edit writes an audit row.

**Step 15 — Read APIs: overview, stats, jobs, usage**
- Create `daily_stats` and the rollup cron task.
- Build `overview`, `stats/timeseries`, the admin jobs list with filters, job detail, and usage grouped by model, user and day.
- Add indexes for the filters you use (`jobs(status)`, `jobs(model_id)`, `jobs(user_id)`, `jobs(created_at)`).

**Done when:** the overview returns correct numbers for a seeded set of 1,000 jobs in under 300 ms.

**Step 16 — Write APIs: models, users, credits, jobs**
- Models: create, update, enable or disable, validate manifest, test run.
- Users: create, edit, suspend, credits (through `credit_transactions`), key create and revoke.
- Jobs: retry (creates a new job with `retried_from_job_id`), cancel, edit notes.
- Add `dry_run` and `confirm` to the dangerous actions.

**Done when:** every write action works, writes an audit row, and the dry run reports the right counts.

**Step 17 — Queue and workers**
- Add worker heartbeats, the `queue_paused` flag, `GET /queue`, `GET /workers`.
- Add the stuck-job sweep endpoint (uses the same logic as the cron sweeper from Step 9).

**Done when:** you can pause `localv1`, see its queue grow, then resume and watch it drain.

**Step 18 — Alerts and settings**
- Add the alert rules and the cron task.
- Add settings (rate limits, file retention days, alert thresholds) and let workers read them without a restart (cache for 30 seconds).

**Done when:** forcing a model health failure creates one alert, and fixing it lets you resolve it.

**Step 19 — Admin tests**
- Test the full role matrix (every route against every role).
- Test that every write route creates an audit row.
- Test dry run versus confirm.
- Test that no response contains a key hash or secret.

**Done when:** the admin test suite passes and covers every route in 14.3.

## 15. Model health and status

This section defines how the center knows whether each model is working, what it does about it, and what users and admins see.

### 15.1 Two separate ideas

| Idea | Values | Set by |
|---|---|---|
| **Configured status** (`models.status`) | `active`, `beta`, `disabled` | An admin decides |
| **Health state** (`models.health_state`) | `healthy`, `degraded`, `down`, `unknown` | The system measures |

Example: `localv1` can be `active` and `down` at the same time (the GPU server crashed). The catalog shows both.

### 15.2 Three kinds of checks

| Check | How often | What it does | What it catches |
|---|---|---|---|
| **Ping** | Every 60 s (per manifest) | Calls `adapter.health()` with a 5 s timeout | Service off, GPU missing, disk full, provider key expired |
| **Canary job** | Every 30 to 60 min (per manifest) | Runs a 10 second sample video through the whole pipeline and validates the output | A model that answers ping but produces empty or bad results |
| **Real traffic** | Continuous, 60 minute rolling window | Success rate, p50 and p95 time, queue wait, error reasons from real user jobs | Problems that only show up under real load |

**What `health()` checks, by runner type**

| Runner | Checks |
|---|---|
| `http` | `GET /health` on the service returns 200 within the timeout |
| `cli` / local | Script and model files exist, GPU visible (for example `nvidia-smi` works), free disk above a limit, no crashed lock file |
| paid API | Provider key is valid and the provider endpoint answers a cheap call (not a full job) |

**Canary output validation** (all must pass):
1. The output video file exists and opens.
2. Its length is within 5% of the input length.
3. It has an audio track.
4. The audio is not silent (mean volume above -50 dB, for example with FFmpeg `volumedetect`).
5. The job finished within the model's canary time limit.

**Canary rules**
- Canary jobs are normal jobs with `is_canary = true`, run by a system user.
- They are **excluded** from user job lists, usage, billing, credits, and the success-rate stats. Their cost goes to the ledger as an internal cost so you can see what monitoring costs.
- For models with `max_concurrent: 1` (one GPU), run the canary at low priority and skip it if a user job is running. If skipped twice in a row, run it anyway.
- Paid models: keep the interval long (60 min or more) and the sample short, because each canary costs money.
- Later improvement: one canary per important language pair (for example `en→km`), not just one per model.

### 15.3 Status rules

A status evaluator runs every 60 seconds per model. The values below are starting points. Store them in `settings` so they can change without a deploy.

| State | When (any one is true) |
|---|---|
| **down** | 3 failed pings in a row, **or** the last 2 canaries failed, **or** at least 20 jobs in the last 60 min and under 50% succeeded |
| **degraded** (and not down) | At least 10 jobs in the last 60 min and under 90% succeeded, **or** p95 time above 2x the model's baseline, **or** the oldest queued job waited longer than the limit, **or** the last canary failed |
| **healthy** | None of the above |
| **unknown** | No checks yet (new model) |

Rules for the numbers:
- Count only **system** failures in the success rate. Add `jobs.error_kind` (`user` or `system`). Bad input, user cancel and "not enough credits" are `user` and never hurt the model's health.
- Baseline p95 is the median of the model's daily p95 over the last 7 days (or the manifest value for a new model).
- **Recovery needs 2 passes.** To move to a better state (down to degraded, degraded to healthy), the better condition must hold for 2 evaluations in a row. This stops the status from flickering.
- Moving to a worse state happens immediately.

### 15.4 What each state does

| State | New jobs | Users see | Admins get |
|---|---|---|---|
| **healthy** | Accepted | Green dot | Nothing |
| **degraded** | Accepted | Amber dot, warning text, longer time estimate | Alert and notification |
| **down** | Rejected with `model_unavailable`, **or** sent to the manifest's `fallback` when the user chose `auto` | Red dot, "Unavailable right now", other models suggested | Alert and notification |
| **unknown** | Accepted (admin can limit this with a setting) | Gray dot | Nothing |
| configured `disabled` | Rejected with `model_disabled` | "Disabled" | Nothing |

Running jobs always continue, whatever the state changes to.

`model: "auto"` routing skips `down` models and ranks `degraded` models lower.

### 15.5 Data

New or changed fields (full table list is in section 6):

- `models`: `health_state`, `health_since`, `health_checked_at`, `last_ok_at`
- `model_health`: one row per ping or canary result (`check_type`, `ok`, `latency_ms`, `error_code`, `detail`)
- `model_status_events`: one row per state change, with the reason (for example `3 failed pings in a row`)
- `model_daily_uptime`: filled by a daily rollup from `model_status_events`, feeds the 30-day uptime bar
- `jobs`: `is_canary` (bool), `error_kind` (`user` or `system`)

Keep `model_health` rows for 30 days (cleanup cron), keep `model_status_events` and `model_daily_uptime` for at least 1 year.

**Error codes** used in checks and job failures (so grouping and alerts are readable):
`provider_auth`, `provider_unavailable`, `provider_rate_limited`, `gpu_unavailable`, `disk_full`, `service_unreachable`, `timeout`, `output_invalid`, `output_silent`, `unknown`.

### 15.6 Settings keys

| Key | Default | Meaning |
|---|---|---|
| `health.ping_timeout_sec` | 5 | Ping timeout |
| `health.down_ping_failures` | 3 | Failed pings in a row that mean `down` |
| `health.down_canary_failures` | 2 | Failed canaries in a row that mean `down` |
| `health.window_minutes` | 60 | Rolling window for real-traffic stats |
| `health.down_success_rate` | 0.50 | Below this (with enough jobs) means `down` |
| `health.down_min_jobs` | 20 | Minimum jobs for the rule above |
| `health.degraded_success_rate` | 0.90 | Below this (with enough jobs) means `degraded` |
| `health.degraded_min_jobs` | 10 | Minimum jobs for the rule above |
| `health.p95_multiplier` | 2.0 | p95 above baseline times this means `degraded` |
| `health.max_queue_wait_minutes` | 15 | Oldest queued wait that means `degraded` |
| `health.recover_passes` | 2 | Passing evaluations needed to improve state |
| `health.notify_channels` | `["email"]` | Where state-change messages go (`email`, `slack`, `webhook`) |

A model manifest may override any of these for that model (a slow local model needs a larger `max_queue_wait_minutes`).

### 15.7 Endpoints

**Public and user**

`GET /v1/models` adds to each model: `health_state`, `health_since`, `success_rate_24h`, `avg_duration_sec`, `uptime_30d`.

`GET /v1/models/{id}/status`

```json
{
  "model": "paidv1",
  "configured_status": "active",
  "health_state": "degraded",
  "health_since": "2026-10-27T05:10:00Z",
  "checked_at": "2026-10-27T07:31:00Z",
  "last_24h": { "success_rate": 0.93, "avg_duration_sec": 370, "p95_duration_sec": 710, "jobs": 148 },
  "uptime_30d": 0.992,
  "daily": [
    { "date": "2026-10-26", "state": "healthy", "uptime": 1.0 },
    { "date": "2026-10-27", "state": "degraded", "uptime": 0.91 }
  ],
  "incidents": [
    { "started_at": "2026-10-27T05:10:00Z", "ended_at": null, "state": "degraded", "summary": "Slower than usual" }
  ]
}
```

`GET /v1/status` returns the same short form for all models (state, uptime, active incident). Public status responses never include internal error details, hostnames or job IDs.

**Admin** (see section 14.3)

- `POST /v1/admin/models/{id}/check-now` runs a ping and a canary right away and returns both results.
- `GET /v1/admin/models/{id}/health-history?type=&from=&to=` returns the check log and the state changes, including `error_code` and `detail`.
- Per-model threshold overrides are part of the model manifest (`PUT /v1/admin/models/{id}`).

### 15.8 Notifications

- On every state change, send one message to the channels in `health.notify_channels`: model, old state, new state, reason, link to the admin model page.
- Send a **recovery** message when the model returns to `healthy`.
- De-duplicate: one message per state change, never one per failed check.
- Each state change also creates or updates an `alerts` row (section 14), and closes it on recovery.

### 15.9 Implementation notes

- Run health tasks in a **separate worker queue** from user jobs, so a busy GPU queue never blocks monitoring.
- Use a Redis lock per model (`health:lock:{model_id}`) so only one check per model runs at a time, even with several workers.
- Ping and canary results are written first; the evaluator reads them. Keep the evaluator a pure function (inputs in, state out) so it is easy to unit test.
- When a model moves to `down`, do not cancel running jobs. Their own timeouts handle them.
- Never let a monitoring failure break the API: if the evaluator crashes, keep the old state and raise an alert about the monitor itself.

### 15.10 Build steps (continue after Step 19)

**Step 20 — Health data model and pings**
- Add the new tables and columns from 15.5 with a migration.
- Add `health()` to each adapter (and to the runners) following the table in 15.2.
- Add the ping cron task with the per-model interval, timeout, and Redis lock. Write each result to `model_health`.

**Done when:** stopping the `localv1` service makes its pings fail and the results appear in `model_health` with an `error_code`.

**Step 21 — Real-traffic stats and the status evaluator**
- Add `jobs.error_kind` and set it wherever a job fails.
- Write the evaluator (15.3) as a pure function with a rolling-window query that excludes canary and user-caused failures.
- Run it every 60 s, write `models.health_state`, and create `model_status_events` rows with a reason.
- Add the 2-pass recovery rule.

**Done when:** unit tests cover every rule and the recovery rule, and a seeded set of failed jobs moves a model to `degraded` and then `down`.

**Step 22 — Canary checks**
- Add `jobs.is_canary`, the system user, and the sample video in `canary/`.
- Run the canary on its interval, validate the output (15.2), and write the result to `model_health`.
- Exclude canary jobs from user lists, usage, billing and stats. Record their cost as internal.
- Add low-priority scheduling and the skip rule for single-GPU models.

**Done when:** a canary runs for `paidv1` and `localv1`, a deliberately broken output (silent audio) fails the check, and no canary shows up in any user-facing list or in the usage totals.

**Step 23 — Behavior by state and status endpoints**
- Reject new jobs for `down` models with `model_unavailable`, use `fallback` for `auto`, and rank `degraded` models lower in `auto` routing.
- Add `GET /v1/models/{id}/status`, `GET /v1/status`, the extra fields in `GET /v1/models`, and the daily uptime rollup.
- Add `check-now` and `health-history` for admins.

**Done when:** a `down` model rejects new jobs and keeps running jobs going, and the status endpoint returns a correct 30-day bar after a simulated outage.

**Step 24 — Notifications, alerts and tests**
- Send state-change and recovery messages to the configured channels with de-duplication.
- Link state changes to the `alerts` table and close the alert on recovery.
- Add tests for the status rules, notifications, canary exclusion from billing, and the public status response (no internal details).

**Done when:** one outage produces one alert, one notification and one recovery message, and the test suite passes.

## 16. Open questions (answer before Step 8, Step 14 and Step 20)

1. Is `paidv1` already a web service (URL) or a script? This decides `http` or `cli` runner.
2. Is `localv1` a script, a Docker image, or a service? How does it report progress?
3. Which languages does each model support (source and target)?
4. Will you sell API access to other people (billing and credits in Phase 1), or is it for your own site only?
5. Where will the backend run first: your own server, or AWS from day one?
6. Who will use the admin dashboard: only you, or a team? (decides if `support` and `admin` roles are needed now)
7. Should the admin dashboard be part of the same website as the customer pages, or a separate app on its own address?
8. Where should model state-change messages go: email, Slack, a webhook, or all of them?
9. How much can monitoring cost per month? This sets the canary interval for the paid models.
10. Should the public status page be visible without login?
