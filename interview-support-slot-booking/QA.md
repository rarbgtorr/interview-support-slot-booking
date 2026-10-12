# Verification — admin-only customer manager

Completed locally on 12 October 2026:

- `npm test`: **28 passing tests**.
- `npm run build`: JavaScript syntax and public asset checks passed.
- `git diff --check`: no whitespace errors.
- `tests/browser-flow.cjs`: full Chromium workflow passed with the real handlers and actual schema/RPCs in isolated PGlite. Only the Supabase REST transport was adapted for the test database.
- Browser flow covers adding/editing/searching a customer, one-hour demo creation, interest gating, separate 30-minute interview, unavailable demo halves, rescheduling to 60 minutes, timezone conversion, latest start ending at 3 AM, whole-day block/unblock, cancellation, follow-up completion, history, and clearing private UI on logout.
- Layout checked at **390 × 844** and **1440 × 1100**, including screenshot inspection and no horizontal overflow.
- Browser flow reported no JavaScript page errors.
- API tests verify administrator authentication before database access, valid/expired/tampered tokens, input validation, private records, no email path, and paging past the default 1000-row response cap.
- SQL tests cover duplicate formatted phones, interest eligibility, fixed demo duration, shared demo/interview capacity, conflict rollback, stale revisions, status transitions, idempotent retries, 3 AM closing, and next-day dates.

Limits: no live Supabase project was configured or changed, and no live Netlify deployment was exercised. PGlite queues requests on a single connection; the competing-request test does not substitute for a production multi-connection load test. Netlify's admin-login rate-limit acceptance should be verified in deployment logs.

The new `support_*` tables do not import older `interview_*` records automatically. Reconcile any real earlier bookings before switching the live app.
