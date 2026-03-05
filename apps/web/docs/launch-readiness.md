# Launch Readiness (Points 1–4)

This is the practical rollout checklist for Link Monitor by Adler.

## 1) Critical UX polish

Status: ✅ Done (current cycle)

Implemented:
- Explicit `loading / error / retry` states for project list in dashboard.
- Explicit `error / retry` states for alerts, summary, and backlinks list on project page.
- Better empty-state message when filters/search return no backlink matches.
- Removed Dense mode and aligned filter controls for cleaner readability.

Validation:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## 2) Pre-launch QA scenarios

Run this exact scenario in browser (single-user happy path):

- [x] Open `/login`, sign in with password.
- [x] Enter email 2FA code (or use resend once).
- [x] Confirm redirect to `/dashboard`.
- [x] Create project from dashboard.
- [x] Open project page.
- [x] Add backlink with source/target URL.
- [x] Trigger `Check now` for the backlink.
- [x] Confirm status/meta updates in list.
- [x] Confirm alerts appear and `Mark all read` works.
- [x] Open `/billing` and verify plan/checkout flow.
- [x] Return to `/dashboard`, verify KPI/reports/notifications blocks render without errors.

Latest run (2026-03-04):
- Command: `npm run qa:launch`
- Result: PASS (11/11 steps)
- Evidence highlights: 2FA verify successful, alert created then marked read, billing upgraded FREE → STARTER in manual checkout flow.

Failure policy:
- Any hard failure in auth, backlink create/check, or billing blocks launch.
- Visual-only issues can ship only if they do not hide controls or data.

## 3) Production operations hardening

Minimum operational gate:

- [ ] Required env present (`DATABASE_URL`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `AUTH_EMAIL_FROM`).
- [ ] `SESSION_SECRET` is long enough (>=32 chars).
- [ ] Prisma client resolves and app builds.
- [ ] Worker one-shot run succeeds.

Commands:

```bash
npm run preflight
npm run preflight:worker
npm run lint && npm run typecheck && npm run build
```

Notes:
- For production 2FA delivery, set `RESEND_API_KEY`.
- For Telegram delivery/reporting, set `TELEGRAM_BOT_TOKEN` and chat settings in UI.

P0 implementation status (2026-03-04):
- ✅ `SESSION_SECRET` policy aligned to `>=32` chars and fail-fast in production (`src/lib/auth.ts`, `src/lib/twoFactor.ts`).
- ✅ Worker service-token auth added for `GET/POST /api/checks/run-due` via `x-worker-token` and `WORKER_RUN_DUE_TOKEN`.
- ✅ Distributed rate-limit backend added (Upstash REST) with in-memory fallback (`src/lib/rateLimit.ts`).

P0 validation evidence (2026-03-04):
- `npm run lint && npm run typecheck && npm run build` → PASS.
- `npm run preflight` with complete env set → PASS.
- `npm run preflight:worker` with token env set → PASS (worker one-shot executed).

Additional env for P0:
- `WORKER_RUN_DUE_TOKEN` (API side)
- `LM_WORKER_TOKEN` (worker side, fallback to `WORKER_RUN_DUE_TOKEN`)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (optional but recommended for multi-instance prod)

P1 implementation status (2026-03-04):
- ✅ `Check` records now persist `anchorOk` and `issueReason` in check engine.
- ✅ Queue claim made atomic with SQL `FOR UPDATE SKIP LOCKED` to reduce cross-worker race conditions.
- ✅ Correlation/request id added across worker and `/api/checks/run-due` logs.
- ✅ Validation: `npm run lint && npm run typecheck && npm run build` → PASS.

P2 implementation status (2026-03-04):
- ✅ Added billing audit trail model `BillingEvent` and migration (`packages/db/prisma/migrations/20260304232000_add_billing_event`).
- ✅ Billing checkout now writes audit event and billing snapshot returns recent events.
- ✅ Replaced template README with product/operations README.
- ✅ Added integration smoke script: `npm run test:integration` (`scripts/integration-auth-queue.mjs`).
- ✅ Validation: `npm run prisma:generate && npm run lint && npm run typecheck && npm run build` → PASS.

## 4) Public launch package

Use this baseline copy set:

### Onboarding copy (dashboard)
- “Create your first project and add backlinks to start automated monitoring.”
- “Use priority to control check cadence and risk visibility.”

### Pricing/limits copy (billing)
- “Upgrade for higher project/backlink limits and priority support.”
- “Billing is workspace-level and shared across your team.”

### FAQ starter
- What does ACTIVE / ISSUE / LOST mean?
- How often are checks run?
- Why does Telegram chat ID look like `-100...`?
- What happens if a link is temporarily unavailable?

### Launch day sequence
1. Run preflight and full build checks.
2. Run browser QA flow above end-to-end.
3. Verify legal pages + metadata + public landing.
4. Enable production env/secrets and deploy.
