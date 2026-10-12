# Verification: simple 30-minute slot manager

- Automated SQL/API/scheduling tests pass, including selecting 10 AM without touching 9:30, demo/interview durations, two independent places, rejection of a third, idempotent retries, failed-move rollback, release of only the moved/cancelled booking, last 2:30 AM start, stale revisions, private permissions, and preservation of existing one-hour demos.
- Chromium flow uses the real handlers and actual SQL in isolated PGlite. Only the Supabase REST transport is adapted. It creates a demo at 10 AM, books an interview in the same box, reschedules the first member to 10:30, reuses the freed place, cancels one booking, checks member timezone and all six fields, and verifies removed pages return 404.
- Responsive layouts checked at 320, 390, and 1440 pixels wide without horizontal overflow. Browser flow reports no JavaScript errors.
- JavaScript syntax, assets, and whitespace checks pass.
- PGlite serializes requests on one connection; tests do not replace a multi-connection production load test.
- Existing one-hour demos are preserved, rather than silently shortened.

- `npm test`: 28 passing tests. `npm run build` and `git diff --check` pass.
- Applied `simple_half_hour_slots_two_places` to the connected interview-support database. A service-role rollback transaction verified two bookings in one half-hour, rejection of a third, release of one place on reschedule, and no reservation in the earlier 9:30 box. The two existing one-hour demos remain reserved and no temporary test records were retained.

- Member-only save verified in the live database: the booking has a null legacy profile ID and creates no profile row. Verification was rolled back.
- Cleared the previous testing bookings, reservations, request records, and legacy profile rows in the connected app project, as explicitly requested.
- New page heading is INTERVIEW SLOT BOOKING; the promotional banner and customer-management fields are absent.
