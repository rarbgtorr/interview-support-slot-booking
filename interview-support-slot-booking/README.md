# Interview Slot Booking — Testing branch

The public page at `/` shows **Available** only when both places are free, and **Booked** whenever either place is booked or the administrator blocks the box. Capacity counts appear only in admin. Once a slot start time passes, the public calendar shows a neutral, disabled **Past slot**, without booking colors or status. Public API responses omit past booking/block occupancy; admin retains booking history. Public users cannot select a box once either place is booked. Only an authenticated admin can fill its second place. This rule is enforced in the database under the same transaction lock as reservations; public retries remain idempotent. Select one or two different 30-minute boxes, then enter member details once and save. Slots may be adjacent, non-adjacent, or on different operating dates. Every selected box creates its own 30-minute appointment; each box still accepts two independent bookings.

Public responses contain capacity and slot summaries only. Member names, WhatsApp numbers, company, experience, interview stage, notes, booking identifiers and management actions are not exposed by public APIs. Visitors have no login and cannot cancel or reschedule existing appointments.

At `/admin`, sign in with the administrator password to view bookings and details, reschedule or cancel individual appointments, and block/unblock empty future boxes. Tap empty or blocked boxes directly, then **Block selected** or **Unblock selected** (up to 200 per action, across periods or dates). Bulk operations are atomic and reject conflicts without partially changing availability. Booked boxes remain clickable to manage their details while a block selection is active. With one empty box selected, **Book selected slot** opens the booking form. Existing bookings cannot be overwritten by blocking. Cancelling or moving one booking releases only its place. The administrator session uses a signed, expiring HttpOnly, Secure, SameSite=Strict cookie; all management APIs require it.

The display timezone selector and optional Notes remain available. Operating dates and service hours remain 7 AM to 3 AM the following day in IST. Morning (6 AM–noon), Afternoon (noon–5 PM), Evening (5 PM–9 PM) and Night (9 PM–6 AM) follow the selected display timezone. Every operating slot appears in exactly one group; local date changes are shown on boxes. Display conversion does not change the reserved instant. Demo and interview colors remain visible in light and dark themes for administrators; the public calendar shows availability without exposing booking types or members.

## Testing deployment and database

This commit belongs on **Testing** only. Do not publish it to the production domain or merge it to `main` until reviewed.

The Testing branch defaults to `BOOKING_DATASET=testing`, using isolated `testing_support_*` tables and RPCs in the existing Supabase project. It never reads or changes the production `support_*` bookings. The isolated Testing dataset has been initialized in the connected interview project. For a fresh setup, run all SQL files under `supabase/migrations/` in filename order against the app project. It creates the isolated dataset and atomic batch RPC with RLS and server-only grants. No production data is copied, deleted, or modified.

Configure these Netlify variables for the **Testing branch / branch deploy** context with Functions scope:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Existing interview app project URL |
| `SUPABASE_SECRET_KEY` | Server secret key (legacy `SUPABASE_SERVICE_ROLE_KEY` also works) |
| `BOOKING_DATASET` | `testing` (also the default for this branch's code) |
| `ADMIN_PASSWORD` | Your administrator password, at least 12 characters |
| `ADMIN_JWT_SECRET` | Random signing secret, at least 32 characters |

Secrets stay in Netlify or local `.env`, never in Git or browser files. Enable **Testing** in Netlify branch deploys and use that branch's preview URL. Its `/admin` path is the administrator page. Keep the production branch as `main`. No emails are sent.

If this feature is later promoted to production, apply `batch-booking-update.sql`, `bulk-blocking-update.sql` and `public-booking-policy-update.sql` to the production `support_*` dataset and explicitly set `BOOKING_DATASET=production` for the production deploy. Review that promotion separately; this Testing task does not change main or the current live site.

## Transaction guarantees

The public booking function calls one `support_book_with_documents` RPC, which wraps `support_book_public_slots` and attaches the shared documents in the same transaction, not two independent HTTP writes. The RPC calls reservation logic inside one database statement and shared transaction lock. A conflict in either box rolls back all new appointments and reservations. Request UUIDs make retries idempotent and reject reused IDs with different details. Public input cannot include an existing appointment ID or revision.

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

## Resume and job description documents

Every new public or admin booking requires one resume (PDF/DOCX). JD is optional: leave it blank, paste JD text (up to 10,000 characters), or upload a JD file (PDF/DOCX/JPG/PNG). Up to three optional Additional Documents (PDF/DOCX/TXT) can accompany the same booking. Files are limited to **2 MiB each**. Documents upload directly from the browser to private Supabase Storage using one-use object paths and signed upload URLs. No service key reaches the browser. The browser shows progress and retains completed uploads for retrying a failed booking. Booking APIs verify actual stored size and MIME before atomically linking the documents to appointments.

Two selected slots share one document set. Rescheduling preserves the documents and computes retention from the latest associated appointment end, including appointments on different days. Existing appointments without attachments can still be rescheduled. New appointments require attachments. Admin booking cards show pasted JD text and authenticated **Download resume / Download JD** buttons, plus a download button for each additional document. Links are created only on click, expire within 60 seconds, and cannot outlive the document deadline. Public calendar responses still expose no member details, files, filenames, document IDs, or JD text.

Uploads become unavailable **24 hours after the final associated appointment ends**. The private Supabase `testing-document-cleanup` Edge Function runs through an authenticated Cron invocation every five minutes when there is work. Physical deletion occurs on the next successful cleanup run; failed Storage deletions retry. The cleanup worker marks records deleted only after the Storage API succeeds. It never deletes Storage objects by SQL. Abandoned uploads expire after 24 hours, well after their upload URLs expire. Appointment details and pasted JD text are retained. The document creation and cleanup claim RPCs share the same lock as booking and rescheduling.

Testing uses the isolated private **testing-booking-documents** bucket and `testing_support_document_sets`. The bucket enforces 2 MiB and MIME limits. A conservative **64 MiB allocation cap** reserves 2 MiB for each pending/retained file, regardless of declared file size, to limit anonymous upload usage while testing. This accommodates at most 32 one-file sets or 16 two-file sets at once. Additional files also reserve 2 MiB each against this cap. Deleted files release that allocation. This is an application guard, not Supabase's full free quota. Do not enable paid upgrades or disable spending controls as part of setup.

For a fresh Testing setup, apply both new document migrations after the existing migrations, and deploy the cleanup function:

```bash
supabase functions deploy testing-document-cleanup --project-ref YOUR_INTERVIEW_PROJECT_REF --no-verify-jwt
```

`--no-verify-jwt` is intentional here: the function implements custom authentication using a private token generated inside Supabase Vault. Cron supplies that token; the function hashes it and checks the server-only configuration before touching files. It does not accept anonymous callers. No extra Netlify environment variables are required. The scheduler runs independently of Netlify previews, which do not execute Netlify scheduled functions. Cron/Vault/network extensions are enabled by the Testing cleanup migration. Keep the Vault token private.

Production promotion requires a separately reviewed storage bucket, document migration and production cleanup scheduler/function. The included cleanup deployment is **Testing only**; setting `BOOKING_DATASET=production` without that setup does not enable production uploads.

Public bookings show a **Booking successful!** confirmation immediately after the server saves the appointment(s), including each booked time in the member’s timezone. Resume-only submissions are supported; resume validation remains required.
