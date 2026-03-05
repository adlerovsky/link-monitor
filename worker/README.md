# Link Monitor Worker

Lightweight background worker for processing due backlink checks without blocking request/response flows.

## Run once

```bash
node worker/run-due-worker.mjs --once
```

## Run continuously

```bash
node worker/run-due-worker.mjs
```

## Configuration

Environment variables:

- `LM_API_BASE_URL` (default: `http://localhost:3000`)
- `LM_WORKER_INTERVAL_MS` (default: `15000`)
- `LM_WORKER_ENQUEUE_LIMIT` (default: `50`)
- `LM_WORKER_CLAIM_LIMIT` (default: `20`)
- `LM_WORKER_CONCURRENCY` (default: `4`)
- `LM_WORKER_LEASE_SECONDS` (default: `120`)
- `LM_WORKER_MAX_ATTEMPTS` (default: `3`)
- `LM_WORKER_MAX_RETRIES` (default: `1`)
- `LM_WORKER_BASE_BACKOFF_MS` (default: `3000`)
- `LM_WORKER_RETENTION_DAYS` (default: `7`)
- `REPORTS_SCHEDULE_ENABLED` (default: `1`)
- `REPORTS_SCHEDULE_TZ_OFFSET_MINUTES` (default: `120` for GMT+2)
- `REPORTS_SCHEDULE_HOUR_LOCAL` (default: `9`)
- `REPORTS_SCHEDULE_MINUTE_LOCAL` (default: `0`)
- `REPORTS_SCHEDULE_PERIOD_DAYS` (default: `30`)
- `REPORTS_SCHEDULE_RETRY_COOLDOWN_MINUTES` (default: `60`)

The worker calls `GET /api/checks/run-due` with enqueue/claim limits, concurrency, lease, retries, and retention parameters.

`/api/checks/run-due` now also evaluates scheduled Telegram reports:
- daily at `09:00` local time (`GMT+2` by default),
- one organization-level report per day,
- retries failed sends after cooldown (`REPORTS_SCHEDULE_RETRY_COOLDOWN_MINUTES`).
