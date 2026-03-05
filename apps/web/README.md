## Link Monitor by Adler (Web)

Operational dashboard for backlink monitoring with queue-based checks, alerts, and billing limits.

## Core capabilities

- Auth with password + email 2FA.
- Multi-tenant organization/workspace model.
- Queue-driven backlink checks with lease recovery and dead-letter requeue.
- KPI/reporting endpoints (summary, KPI, CSV export, Telegram send).
- Plan limits and billing plan upgrade flow with audit trail (`BillingEvent`).

## Local run

```bash
npm run prisma:generate
npm run dev
```

## Required environment

- `DATABASE_URL`
- `SESSION_SECRET` (>=32 chars)
- `NEXT_PUBLIC_APP_URL`
- `AUTH_EMAIL_FROM`

Worker + queue auth:

- API side: `WORKER_RUN_DUE_TOKEN`
- Worker side: `LM_WORKER_TOKEN` (fallback to `WORKER_RUN_DUE_TOKEN`)

Optional (recommended in production):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `RESEND_API_KEY`
- `TELEGRAM_BOT_TOKEN`

## Worker

One-shot run:

```bash
node ../worker/run-due-worker.mjs --once
```

Continuous mode:

```bash
node ../worker/run-due-worker.mjs
```

Worker calls `GET /api/checks/run-due` and can authenticate via `x-worker-token`.

## Quality gates

```bash
npm run preflight
npm run preflight:worker
npm run lint && npm run typecheck && npm run build
```

Launch checklist lives in [docs/launch-readiness.md](./docs/launch-readiness.md).
Agent handoff context lives in [docs/agent-handoff.md](./docs/agent-handoff.md).

## Environment variables (local)

For authenticated sessions and Telegram report delivery set:

- `SESSION_SECRET` — secret used to sign session cookies.
- `AUTH_EMAIL_FROM` and `RESEND_API_KEY` — required in production for login email 2FA code delivery.
- `TELEGRAM_BOT_TOKEN` — bot token used by `POST /api/reports/send-telegram`.

Login flow includes email 2FA for sign-in (password + 6-digit verification code).

Security note: never commit bot tokens to repository; keep them only in local env / CI secrets and rotate if exposed.

`telegramChatId` is configured in the app Notifications block and may look like `-100...` for groups/channels (this is normal for Telegram).

## Launch readiness

Use the practical checklist in [`docs/launch-readiness.md`](./docs/launch-readiness.md).

Quick pre-launch commands:

```bash
npm run preflight
npm run preflight:worker
npm run qa:launch
npm run lint && npm run typecheck && npm run build
```

## CI

Repository includes GitHub Actions workflow at `.github/workflows/ci.yml` that runs:

- install dependencies
- prisma generate
- lint
- typecheck
- build
- api smoke (`GET /api/auth/session` expects `401` without auth)
- npm audit (non-blocking)

## Pre-commit checks

Repository includes hook script at `/.githooks/pre-commit` (runs `lint` + `typecheck` for `apps/web`).

If your local copy is a git repository, enable it with:

```bash
git config core.hooksPath .githooks
```

Optional pre-push hook is also available at `/.githooks/pre-push` and runs:

- lint
- typecheck
- build
- optional API smoke (`RUN_PREPUSH_SMOKE=1`)

If you need a faster local push check, skip build once:

```bash
SKIP_PREPUSH_BUILD=1 ./.githooks/pre-push
```

Run full check including API smoke:

```bash
RUN_PREPUSH_SMOKE=1 ./.githooks/pre-push
```

Smoke mode reuses an already running local app on `127.0.0.1:3000`/`3001` when available, otherwise starts a temporary dev server.
