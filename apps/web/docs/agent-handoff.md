# Agent Handoff (Single Source of Context)

Use this file as the first reference in every new Copilot chat for this project.

## Project
- Name: Link Monitor by Adler
- App: Next.js (`apps/web`)
- Worker: `worker/run-due-worker.mjs`
- DB: Prisma/PostgreSQL (`packages/db/prisma/schema.prisma`)

## Working rule
- Execute roadmap strictly in order: `P0 -> P1 -> P2`.
- Do not start a later phase until the current phase is fully done and verified.

## Current roadmap status

### P0 (Reliability/Security baseline)
- [x] Align `SESSION_SECRET` policy to >=32 and fail-fast in production.
- [x] Add worker service-token auth path for `run-due` endpoint.
- [x] Add distributed rate-limit backend (Upstash REST) with in-memory fallback.
- [x] Run and record validation (`lint`, `typecheck`, `build`, `preflight`, `preflight:worker`).
- [x] Update launch docs with P0 completion evidence.

### P1 (Queue/data correctness)
- [x] Persist `anchorOk` / `issueReason` into checks.
- [x] Make claim step atomic (`FOR UPDATE SKIP LOCKED`) to remove race.
- [x] Add correlation id in API/worker logs.

### P2 (Productization)
- [x] Add billing events / audit trail.
- [x] Replace template README with product-operational README.
- [x] Add integration tests for auth 2FA + queue dead-letter flows.

## Environment keys (important)
- Required core:
  - `DATABASE_URL`
  - `SESSION_SECRET` (>=32)
  - `NEXT_PUBLIC_APP_URL`
  - `AUTH_EMAIL_FROM`
- Worker auth:
  - API side: `WORKER_RUN_DUE_TOKEN`
  - Worker side: `LM_WORKER_TOKEN` (fallbacks to `WORKER_RUN_DUE_TOKEN`)
- Distributed rate-limit (optional but recommended for production):
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

  Integration smoke env:
  - `LM_TEST_EMAIL`
  - `LM_TEST_PASSWORD`
  - `LM_TEST_2FA_CODE` (optional if `devCode` is available in login response)
  - `LM_TEST_REQUEUE_JOB_ID` (optional, to test dead-letter POST)

## Notes for next chat
- Start by reading this file and `apps/web/docs/launch-readiness.md`.
- Continue from the first unchecked item in current phase.

## Last execution notes (2026-03-04)
- Build validation: `npm run lint && npm run typecheck && npm run build` -> PASS.
- Preflight without env -> expected fail due missing required variables.
- Preflight with temporary complete env -> PASS, including `--with-worker` mode.
- Prisma + build after P2 (`npm run prisma:generate && npm run lint && npm run typecheck && npm run build`) -> PASS.
- Integration smoke entrypoint added: `npm run test:integration`.

## Operation log (rolling)
- 2026-03-04: Started DB migration run via `npx prisma migrate deploy --schema ../../packages/db/prisma/schema.prisma`.
- 2026-03-04: Deploy failed on `20260303224500_add_check_job_queue` with `P3018` (`type "CheckJobStatus" already exists`).
- 2026-03-04: Inspected `_prisma_migrations`; found this migration in a failed/incomplete state (`finished_at = null`).
- 2026-03-04: Next step is migration state reconciliation (`migrate resolve`) then re-run deploy and continue with integration smoke.
- 2026-03-04: Verified DB objects; `CheckJob`, `LoginTwoFactorCode`, and `User.firstName` already existed, `BillingEvent` was missing.
- 2026-03-04: Reconciled migration history with:
  - `prisma migrate resolve --applied 20260303224500_add_check_job_queue`
  - `prisma migrate resolve --applied 20260304153000_add_login_two_factor_code`
  - `prisma migrate resolve --applied 20260304190000_add_user_profile_fields`
- 2026-03-04: Re-ran deploy successfully; applied `20260304232000_add_billing_event`.
- 2026-03-04: `prisma migrate status` now reports `Database schema is up to date!`.
- 2026-03-04: Provisioned test user via `node scripts/provision-user.mjs`.
- 2026-03-04: Integration smoke PASS:
  - command: `LM_API_BASE_URL=http://127.0.0.1:3000 LM_TEST_EMAIL=alex.bratkovsky@gmail.com LM_TEST_PASSWORD=admin npm run test:integration`
  - result: login ✅, verify-2fa ✅, dead-letter GET ✅.
- 2026-03-04: Login UI polish pass completed for Scandinavian style alignment:
  - file: `src/app/login/page.module.css`
  - updates: larger premium card proportions, cleaner spacing hierarchy, refined toggle/buttons, corrected input inner padding and placeholder readability.
  - validation: `npm run lint && npm run typecheck` -> PASS.
- 2026-03-04: Full-site cold premium scale unification completed:
  - global tokens/rhythm updated in `src/app/globals.css` (layout widths, gutters, radii, control heights, input padding).
  - modules aligned to same scale system: `src/app/page.module.css`, `src/app/dashboard/page.module.css`, `src/app/projects/[id]/page.module.css`, `src/app/billing/page.module.css`, `src/app/account/page.module.css`, `src/app/legal.module.css`, `src/app/login/page.module.css`.
  - hardcoded project badge/action colors replaced with theme-driven `color-mix` variants for consistent cold style.
  - validation: `npm run lint && npm run typecheck` -> PASS.
- 2026-03-04: Header/Footer micro-polish iteration completed (cold premium finish):
  - file: `src/app/globals.css`.
  - header: refined translucent layer (`backdrop-filter` + subtle shadow), tighter nav rhythm, premium active state, cleaner account chip/menu geometry.
  - footer: elevated muted surface, link chips with understated hover treatment.
  - validation: `npm run lint && npm run typecheck` -> PASS.
- 2026-03-04: Visual QA pass (landing/login/dashboard/project) + ugly Dashboard chip fix:
  - main issue fixed: bulky `Dashboard` nav chip in header (now compact, less button-like, cleaner active indicator) in `src/app/globals.css`.
  - responsive header behavior improved: keeps row layout on small screens, reduces awkward stacked nav look.
  - final rhythm polish in `src/app/page.module.css`, `src/app/dashboard/page.module.css`, `src/app/projects/[id]/page.module.css`.
  - validation: `npm run lint && npm run typecheck` -> PASS.
- 2026-03-04: Project base-domain governance + dashboard flow update completed:
  - DB schema updated with optional `Project.baseDomain` in both Prisma schemas.
  - migration added: `packages/db/prisma/migrations/20260305103000_add_project_base_domain/migration.sql`.
  - new server utility `src/lib/domain.ts` normalizes base domain input and target URL hostnames.
  - `POST /api/projects` now requires `baseDomain` and normalizes input (protocol/www stripped, lowercase).
  - `POST /api/backlinks` now enforces `targetUrl` hostname to match project base domain (same domain or subdomain).
  - dashboard UX changed: project creation moved under `Projects -> Manage`, and base domain shown next to project title.
  - project page hero now shows configured base domain beside project name.
  - header nav (Dashboard/Login) tuned to cleaner legacy-like button style with improved spacing.
  - validation: `npm run lint` -> PASS, `npm run prisma:generate` -> PASS, `npm run build` -> PASS.
- 2026-03-04: Follow-up execution on request (2 пункти + помилка на скріні):
  - DB migration applied successfully: `20260305103000_add_project_base_domain`.
  - migration status confirmed: `Database schema is up to date!`.
  - Prisma client regenerated again in `apps/web` and `next dev` restarted to drop stale runtime cache.
  - integration smoke re-run PASS: login ✅, verify2fa ✅, dead-letter GET ✅.
  - added friendly fallback in `POST /api/projects` for stale Prisma client error (`Unknown argument baseDomain`) to avoid dumping raw stack in UI.
- 2026-03-04: Additional focused smoke + UI alignment polish:
  - added focused script `scripts/smoke-project-domain.mjs` to validate create-project + backlink target domain guard.
  - smoke result PASS: invalid target domain -> 400 with expected error, valid subdomain target -> 200 backlink created.
  - script now handles project-plan limit fallback by reusing existing project with `baseDomain=freeslotshub.com`.
  - dashboard project card alignment fix in `src/app/dashboard/page.module.css` (title + domain badge baseline and spacing).
- 2026-03-04: Added tracked backlink deletion flow (`DELETED`):
  - DB: new enum status `DELETED` and `Backlink.deletedAt` field + index.
  - migration applied: `20260305113000_add_backlink_deleted_status`.
  - API: `/api/backlinks/status` now validates statuses and sets `deletedAt` for `DELETED`.
  - API list/filters: `/api/backlinks` and project dashboard endpoint now accept/return `DELETED`.
  - checks: deleted backlinks are excluded from enqueue and manual check endpoint rejects checks for deleted records.
  - project UI: added `Delete` action per backlink, `DELETED` filter option, deleted badge/count, and deleted timestamp display.
  - validation: `prisma migrate deploy` -> PASS, `npm run prisma:generate` -> PASS, `npm run lint && npm run build` -> PASS.
- 2026-03-04: Extended DELETED visibility into global KPI/Reports:
  - reports summary now returns `counts.DELETED`, currency-level `deleted` value, and includes deleted in `backlinksTotal`.
  - dashboard reports section shows `DELETED` stat and `Deleted` currency line.
  - KPI now returns `deletedBacklinks` (+ `monitoredBacklinks`) and computes rates over monitored (non-deleted) backlinks.
  - CSV export now includes `deletedAt` column.
  - Telegram report text now includes `DELETED` count and deleted value by currency.
  - validation: `npm run prisma:generate && npm run lint && npm run build` -> PASS.
- 2026-03-04: Current blocking issue before chat handoff (Telegram report send):
  - Reproduced with `scripts/debug-send-telegram.mjs` against local API.
  - Result: `POST /api/reports/send-telegram` -> `400`.
  - Response body: `{ "error": "Telegram bot token is not configured (replace 6666 placeholder in reports.ts or set TELEGRAM_BOT_TOKEN env)", "code": "TELEGRAM_TOKEN_MISSING" }`.
  - Verified org settings include chat id: `organization.telegramChatId = "679206296"`.
  - `src/lib/reports.ts` currently uses fallback token logic with literal `"6666"`; next chat should continue from this token-resolution path.

## Continuation protocol for next Copilot chat
- Start sequence (always):
  1) Read this file fully.
  2) Read `apps/web/docs/launch-readiness.md`.
  3) Open `apps/web/src/lib/reports.ts` (current active hotspot).
- Do-not-repeat checks (already green unless new changes break them):
  - `npm run lint && npm run typecheck && npm run build` in `apps/web` passed on 2026-03-04.
  - `npx prisma migrate status --schema ../../packages/db/prisma/schema.prisma` was up-to-date.
- Immediate task queue (current order):
  1) Fix Telegram token resolution path in `src/lib/reports.ts` (remove hardcoded placeholder dependency).
  2) Verify `/api/reports/send-telegram` returns success with valid env/config.
  3) Re-run `scripts/debug-send-telegram.mjs` and record exact response.
  4) Re-run `npm run lint && npm run build` in `apps/web`.
- Definition of done for current blocker:
  - No `TELEGRAM_TOKEN_MISSING` for configured runtime.
  - Report send endpoint returns `200`/success payload.
  - Handoff file updated with command, result, and follow-up risk if any.
- If token is still unresolved, check in this order:
  1) Runtime env in the process where Next API runs (`TELEGRAM_BOT_TOKEN`).
  2) Fallback precedence logic in `src/lib/reports.ts`.
  3) Whether token is filtered/trimmed/invalidated by guard clause.
  4) Local dev server restart after env changes (`next dev` cache/process state).

## Session update (2026-03-04, chat continuation)
- `agent-handoff.md` re-read and refreshed for continuity.
- Added explicit continuation protocol so next model/chat can resume without rediscovery.
- Current primary focus remains unchanged: Telegram token-resolution fix in `src/lib/reports.ts`.

- 2026-03-04: Telegram token-resolution path fixed in `src/lib/reports.ts`:
  - removed hardcoded fallback token `"6666"` from `sendReportToTelegram`.
  - added `resolveTelegramBotToken()` with env precedence:
    1) `TELEGRAM_BOT_TOKEN`
    2) `HEALTH_ALERT_TELEGRAM_BOT_TOKEN`
  - added trim/empty guard and legacy-placeholder skip for `"6666"`.
  - updated missing-token error text to env-based configuration guidance only.
- 2026-03-04: Telegram send debug verification (after fix):
  - without token in API runtime env: `scripts/debug-send-telegram.mjs` -> `400`, code `TELEGRAM_TOKEN_MISSING` (expected).
  - with dev server started using temporary invalid token env:
    - response changed to `502`, code `TELEGRAM_SEND_FAILED`, Telegram body `401 Unauthorized`.
    - confirms resolution path now reaches Telegram API call (token no longer blocked by placeholder logic).
- 2026-03-04: Post-fix validation:
  - `npm run lint && npm run build` in `apps/web` -> PASS.
- 2026-03-04: Final Telegram E2E verification with real env token:
  - restarted `next dev` to reload `.env/.env.local`.
  - ran `node scripts/debug-send-telegram.mjs`.
  - result: `200`, payload `{ ok: true, sent: true, ... }`.
  - blocker `TELEGRAM_TOKEN_MISSING` is resolved for current local runtime.
- 2026-03-04: Telegram report UX polish + daily schedule automation:
  - improved Telegram report text layout in `src/lib/reports.ts`:
    - clearer sections (scope/period/status/value/top lost),
    - cleaner bullets and numeric formatting,
    - readable UTC timestamps.
  - implemented daily scheduled organization-level Telegram reports in `src/lib/reports.ts`:
    - trigger time: 09:00 local with default `GMT+2` (`REPORTS_SCHEDULE_TZ_OFFSET_MINUTES=120`),
    - integrated into `/api/checks/run-due` execution path,
    - one send per org per local day + retry cooldown for failures.
  - schedule env knobs added:
    - `REPORTS_SCHEDULE_ENABLED` (default `1`)
    - `REPORTS_SCHEDULE_TZ_OFFSET_MINUTES` (default `120`)
    - `REPORTS_SCHEDULE_HOUR_LOCAL` (default `9`)
    - `REPORTS_SCHEDULE_MINUTE_LOCAL` (default `0`)
    - `REPORTS_SCHEDULE_PERIOD_DAYS` (default `30`)
    - `REPORTS_SCHEDULE_RETRY_COOLDOWN_MINUTES` (default `60`)
  - docs updated: `worker/README.md`.
- 2026-03-04: Validation after scheduler/report updates:
  - `npm run lint && npm run build` -> PASS.
  - `node scripts/debug-send-telegram.mjs` -> PASS (`200`, `sent: true`).
  - `npm run qa:launch` -> PASS (script updated for `baseDomain` project requirement).
  - authenticated `GET /api/checks/run-due?reports=1&cleanup=0` -> `200`, response contains:
    - `reports.due=true`, `reports.reason="executed"`, `reports.sentCount=1`.
