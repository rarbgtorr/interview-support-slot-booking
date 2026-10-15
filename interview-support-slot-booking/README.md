# Interview Slot Booking — Testing branch

The public page at `/` shows **Available** only when both places are free, and **Booked** whenever either place is booked or the administrator blocks the box. Capacity counts appear only in admin. Once a slot start time passes, the public calendar shows a neutral, disabled **Past slot**, without booking colors or status. Public API responses omit past booking/block occupancy; admin retains booking history. Public users cannot select a box once either place is booked. Only an authenticated admin can fill its second place. This rule is enforced in the database under the same transaction lock as reservations; public retries remain idempotent. Select one or two different 30-minute boxes, then enter member details once and save. Slots may be adjacent, non-adjacent, or on different operating dates. Every selected box creates its own 30-minute appointment; each box still accepts two independent bookings.

Public responses contain capacity and slot summaries only. Member names, email addresses, WhatsApp numbers, company, experience, interview stage, notes, booking identifiers and management actions are not exposed by public APIs. Visitors book without logging in and enter a required email address. They can optionally log in at `/member` using that email and an OTP to view and manage their own bookings.

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

Secrets stay in Netlify or local `.env`, never in Git or browser files. Enable **Testing** in Netlify branch deploys and use that branch's preview URL. Its `/admin` path is the administrator page. Keep the production branch as `main`. No booking-notification emails are sent; OTP emails are sent only when members request login.

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

## Member email login and booking management

Booking does not require login. Every new booking captures a required email address with a warning to enter it carefully. The email is normalized and attached to both slots in the same booking transaction. Existing records with no email remain admin-managed; they are not assigned to a guessed email. Booking email cannot change through rescheduling.

The `/member` page sends an email OTP through Supabase Auth, verifies the code, and stores the Supabase access token in a Secure, HttpOnly, SameSite=Strict cookie. No password, access token or refresh token is saved in browser storage. Every private request validates the token against Supabase `/auth/v1/user` and requires a confirmed email. User-editable metadata and client-supplied email are never used to authorize a booking. Sessions last at most the provider access-token lifetime or one hour, whichever is shorter; after expiry members request a new OTP. Logout clears the cookie and requests local Supabase sign-out.

Members see only bookings attached to their verified email, including history. Upcoming bookings can be cancelled or moved to a completely free, unblocked future slot. Member rescheduling checks ownership, revision and destination availability under the same transaction lock as bookings. It preserves documents and the other selected appointment, and releases the old reservation only after a successful save. Member APIs cannot block slots, fill a second place in an occupied box or access admin document download APIs.

### Enable real OTP email delivery in this interview project

The app includes the project's **public publishable key** as a fallback in `netlify/functions/_auth-config.json` (this is not a service key). No extra Netlify variables are needed for the current project. You can override it with `SUPABASE_PUBLISHABLE_KEY` or legacy `SUPABASE_ANON_KEY`, with Functions scope. All server secret keys remain in environment variables.

1. In the interview app project, open **Authentication → Email → SMTP Settings** and configure your SMTP sender. Supabase's default sender only delivers to organization team addresses and currently allows two messages per hour, so normal members require custom SMTP. Do not configure or change the reference project's settings.
2. In **Authentication → Email Templates**, put `{{ .Token }}` in the **Magic Link** template and **Confirm signup** template, so new and returning users receive a code. An example template is included at `supabase/templates/member-otp.html`. Use subject `Your interview booking login code`.
3. Keep email authentication and email confirmation enabled. Configure email OTP expiration and length, and review email rate limits to match your sender allowance. The UI accepts codes with 6–10 digits and waits 60 seconds before resending.
4. Test `/member` on the Testing deploy with a booking email you control. Confirm inbox delivery, enter the code, and check the dashboard. The implementation tests use a mocked Auth provider; no real OTP emails were sent during development. The connected Auth API was checked for email availability and invalid-token rejection, not SMTP deliverability.

Official setup: https://supabase.com/docs/guides/auth/auth-smtp and https://supabase.com/docs/guides/auth/auth-email-passwordless

## Admin Android appointment reminders (Testing)

The `/admin` page includes a compact **Appointment reminders** panel. Open it in Chrome on each of your two Android phones, log in as admin, tap **Enable on this phone**, allow notifications, then tap **Send test notification**. Repeat on the second phone. The two subscriptions are independent. **Manage devices** lets you disable a lost/replaced phone before enabling another; at most two are active. Logging out does not disable reminders. Browser or Android notification settings must permit delivery; private/incognito browsing is unsuitable. The website does not need to remain open. Installing a home-screen shortcut is optional.

Each phone receives an encrypted Web Push reminder about **45 minutes before** a booked demo or interview. A Supabase Cron job checks every minute, so normal scheduling can differ by up to a minute; network/Android delivery may add delay. Bookings saved inside that window are eligible on the next check. No reminder is sent for appointments that have already started, cancelled appointments, or blocked empty slots. Notifications display booking type, name and time in that phone's timezone. Tapping opens the matching appointment in `/admin`; an expired admin session requires login before private details appear.

Two consecutive slots from the same booking/document set produce one reminder before the first slot. Separate appointments, nonconsecutive selected slots and simultaneous bookings produce their own reminders. Each phone has its own delivery record. Rescheduling revalidates the original task and queues the new time. Cancellation or a move is checked again immediately before sending; a notification already delivered cannot be withdrawn from a phone. Temporary failures retry with backoff until the start time or the attempt limit. Expired subscriptions are disabled. Delivery records expire after seven days; appointment records are preserved.

The CLI-generated `testing_push_reminders` migration adds private, RLS-protected Testing tables and service-role-only RPCs. The `testing_push_reminder_schedule` migration adds Vault-backed credentials and the every-minute `testing-booking-push-reminders` job. Deploy `supabase/functions/testing-push-reminders/index.ts`, its `deno.json`, and the shared `push-reminders.mjs` module to the interview project's **testing-push-reminders** Edge Function. Deploy with JWT verification disabled only because this worker implements mandatory custom `x-reminder-token` authentication, verified against a private SHA-256 hash. Vault generates the scheduler token inside the database. The worker generates VAPID keys and stores the private key in Vault; only the public key reaches the browser. No new Netlify environment variables, sender email, Firebase account, or paid push service is required. Existing free hosting/database quotas still apply.

The Netlify `admin-push` API requires the existing administrator cookie and same-origin requests. It validates Chrome/FCM endpoints and subscription keys, limits test sending to once per device per minute, and never returns private push keys, worker credentials, or other phones' endpoints. The service worker has no offline page caching or private booking cache. Public and member pages do not register this worker or expose reminder controls. Production datasets and the reference app are untouched; promoting this feature requires a separately configured production worker, Vault keys and scheduler.

Verification: `npm test`, `npm run build`, `tests/browser-flow.cjs`, and `tests/push-browser.cjs`. Browser push tests mock Android's permission/subscription APIs; use the real test-notification button on both phones to verify actual delivery.

### New booking alerts, member edits and privacy footer

Enabled admin phones also receive an alert when a **public user successfully creates** a demo/interview booking. Existing subscriptions work automatically. All slots submitted in one booking produce one alert per enabled phone, including nonconsecutive selections. The alert shows booking type, name and selected times in the phone's timezone; tapping opens the booking in the admin page. Admin-created appointments, edits, reschedules and idempotent booking retries do not create new-booking alerts. Old bookings are not backfilled to newly registered phones.

New alerts enter a private, RLS-protected `testing_support_booking_alerts` queue within the same database transaction as the booking. A private statement trigger invokes the authenticated existing worker through `pg_net` after commit. Network enqueue failures do not fail a valid booking. The minute Cron schedule processes remaining work and retries with per-device leases/backoff. Alerts expire after 24 hours and are skipped if there are no remaining upcoming booked appointments in the submitted document set. Cancelled bookings and disabled phones are rechecked before delivery. Booking alerts use a different notification tag from the existing 45-minute reminders. No new credentials or device setup are needed.

Verified members can use **Edit details** on an upcoming appointment to change only its WhatsApp number and notes. Changes apply to that appointment, preserve the selected slot, booking email and documents, and use an ownership check plus revision check under the booking transaction lock. Both API and database validate phone/notes limits. Past or cancelled bookings cannot be edited. The public calendar continues to hide member information.

The admin client ignores stale session-check errors from before a successful login, preventing a delayed initial 401 from restoring a login warning. All main pages include **© 2026 Wingfactor IT Support** and a **Privacy Policy** link. `/privacy.html` describes the actual booking fields, member login, admin notifications, private uploads and retention behavior without adding a tracking service or changing access controls.
