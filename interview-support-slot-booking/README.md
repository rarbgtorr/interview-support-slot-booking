# Interview Slot Booking — Testing branch

The public page at `/` shows availability only. Select one or two different 30-minute boxes, then enter member details once and save. Slots may be adjacent, non-adjacent, or on different operating dates. Every selected box creates its own 30-minute appointment; each box still accepts two independent bookings.

Public responses contain capacity and slot summaries only. Member names, WhatsApp numbers, company, experience, interview stage, notes, booking identifiers and management actions are not exposed by public APIs. Visitors have no login and cannot cancel or reschedule existing appointments.

At `/admin`, sign in with the administrator password to view bookings and details, reschedule or cancel individual appointments, and block/unblock empty future boxes. Existing bookings cannot be overwritten by blocking. Cancelling or moving one booking releases only its place. The administrator session uses a signed, expiring HttpOnly, Secure, SameSite=Strict cookie; all management APIs require it.

The display timezone selector and optional Notes remain available. Operating dates and Morning / Afternoon / Evening / Night groups use IST, with hours 7 AM to 3 AM the following day. Display conversion does not change the reserved instant. Demo and interview colors remain visible in light and dark themes for administrators; the public calendar shows availability without exposing booking types or members.

## Testing deployment and database

This commit belongs on **Testing** only. Do not publish it to the production domain or merge it to `main` until reviewed.

The Testing branch defaults to `BOOKING_DATASET=testing`, using isolated `testing_support_*` tables and RPCs in the existing Supabase project. It never reads or changes the production `support_*` bookings. The isolated Testing dataset has been initialized in the connected interview project. For a fresh setup, run the SQL migration under `supabase/migrations/*_testing_private_admin_batch_booking.sql` against the app project. It creates the isolated dataset and atomic batch RPC with RLS and server-only grants. No production data is copied, deleted, or modified.

Configure these Netlify variables for the **Testing branch / branch deploy** context with Functions scope:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Existing interview app project URL |
| `SUPABASE_SECRET_KEY` | Server secret key (legacy `SUPABASE_SERVICE_ROLE_KEY` also works) |
| `BOOKING_DATASET` | `testing` (also the default for this branch's code) |
| `ADMIN_PASSWORD` | Your administrator password, at least 12 characters |
| `ADMIN_JWT_SECRET` | Random signing secret, at least 32 characters |

Secrets stay in Netlify or local `.env`, never in Git or browser files. Enable **Testing** in Netlify branch deploys and use that branch's preview URL. Its `/admin` path is the administrator page. Keep the production branch as `main`. No emails are sent.

If this feature is later promoted to production, apply `batch-booking-update.sql` to the production `support_*` dataset and explicitly set `BOOKING_DATASET=production` for the production deploy. Review that promotion separately; this Testing task does not change main or the current live site.

## Transaction guarantees

The public booking function calls one `support_book_slots` RPC, not two independent HTTP writes. The RPC calls reservation logic inside one database statement and shared transaction lock. A conflict in either box rolls back all new appointments and reservations. Request UUIDs make retries idempotent and reject reused IDs with different details. Public input cannot include an existing appointment ID or revision.

## Local checks

```bash
npm ci
cp .env.example .env
# Fill the server-only settings.
npm run dev
```

Open `/` for public booking or `/admin` for administrator management.

```bash
npm test
npm run build
```

Tests cover actual SQL and RPC behavior using isolated PGlite, privacy, signed sessions, batch rollback and retries, capacity, notes, timezone conversion and blocking. The optional `tests/browser-flow.cjs` requires Playwright/Chromium and tests real handlers and SQL with only the Supabase HTTP transport adapted. Set `QA_CHROMIUM_EXECUTABLE` if needed; `QA_SCREENSHOT_DIR` enables screenshots.

Reference repository is unchanged: https://github.com/rarbgtorr/slot-booking-app
