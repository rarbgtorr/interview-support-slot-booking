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

## Testing: private booking documents (2026-10-14)

- `npm test`: 59 tests pass. Document coverage includes shared upload attachment, atomic two-slot conflict rollback, exact retries, token ownership, required JD, reschedule retention, expiry boundary, server-only permissions, actual file size/MIME checks, admin download authorization, deadline-limited signed links, and deletion failure retries.
- Mobile/desktop Chromium flow passes at 320/390/1440 px in light/dark modes. Both JD text and JD file bookings are exercised. Two slots use one resume upload. Admin sees pasted JD and three download buttons across the demo/interview bookings. Rescheduling needs no second upload. Existing bulk blocking, capacity, timezone, privacy, cancellation and past-slot rules still pass. Storage/REST are adapted in this local browser test; handlers and SQL are real.
- Connected Testing database rollback verification confirms shared attachment and expiry following a reschedule. No verification appointments are retained.
- Actual Supabase Storage check passes for signed PUT upload, stored metadata, signed download, rejection of public access, unsupported MIME rejection, and Storage API deletion. Test files removed. The actual info endpoint returns `content_type`; the backend accepts this form and SDK-normalized/legacy forms.
- Private `testing-booking-documents` bucket enforces 2 MiB. New metadata/config tables have RLS and no anon/authenticated grants. Security advisor reports only informational no-policy findings, consistent with service-only access.
- Testing cleanup Edge Function deployed with custom token authentication; unauthenticated POST returns 401. Vault-backed authenticated invocation returns 200. Cron is active every five minutes. Testing scheduler is independent of Netlify branch-deploy scheduling.
- No extra Netlify variables, paid project or paid branch created. Production tables, main branch and reference repository unchanged.

## Testing: additional files and simpler labels (2026-10-14)

- 61 automated tests pass, including optional additional PDF/DOCX/TXT metadata, three-file limit, shared attachment, cleanup of all files, unsupported format rejection and unauthorized downloads.
- Chromium flow uploads two additional files, checks admin download controls, retains existing slot/reschedule behavior, and verifies 320/390/1440 px light/dark layouts. Admin identification appears under the title.
- Labels changed to Documents, Name, Interviewing company name, Overall Experience, Your timezone and Selected time. The requested timezone/group/retention helper text is removed. Resume remains mandatory PDF/DOCX. JD remains file or pasted text.
- Testing bucket allows text/plain while keeping private access and 2 MiB limits. The private cleanup worker includes additional files. No production dataset or main branch changes.
