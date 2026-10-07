# Validation

Validated on 7 October 2026.

- `npm run build`: passed JavaScript syntax and public asset checks.
- `npm test`: 25 passing tests, including actual SQL/RPC execution in isolated PGlite PostgreSQL.
- Runtime dependency audit: no reported vulnerabilities.
- Chromium UI checks: passed at 390px mobile and 1440px desktop widths with mock API/auth responses. No page JavaScript errors were observed.

The UI checks covered grouped slot counts, 30/60-minute selection, next-day dates, timezone conversion, booking submission, disabled conflicting pairs, member OTP interface, rescheduling with prefilled fields, and administrator counts that count a 60-minute booking once.

The SQL tests covered unavailable second halves, rollback after failed rescheduling, overlap with a booking's own old slots, cancellation/rebooking, whole-day blocking without overwriting bookings, idempotent request retries, competing reservations, past/closing-time validation and private table/function grants.

Not yet verified against live services: a newly configured Supabase project, real OTP emails, Gmail confirmation/reminder delivery, Netlify deployment and deployed rate-limit acceptance. Those checks require the new app's configuration. The reference repository and its live services were not changed.
