# Interview Support Customer Manager

An admin-only customer manager using the reference slot-booking visual style: navy header, white rounded cards, green available slots, and red reservations. Customers have no accounts or self-service screens. The app sends no emails, OTPs, or reminders.

## Daily workflow

1. Sign in at `/` with the administrator password. The mobile-first calendar is the default view.
2. Select an operating date, a demo/interview type, and an available slot.
3. Enter name, phone/WhatsApp number, service interest, and optional interview details in the appointment form. No prior customer creation is needed.
4. Save once. The server creates or reuses the customer by normalized phone number and reserves the appointment in one transaction. If unavailable, the whole transaction rolls back.
5. Open profiles/history from Customers or a booked slot. Manage status, notes, follow-ups, cancellation, and rescheduling there.

You can optionally select an existing customer in the appointment form. Interview booking itself marks the customer interested as needed; there is no separate stage-setting prerequisite. Matching phone numbers reuse the existing profile without overwriting its contact details.

`/booking` is a **password-free, read-only calendar**, with different colours for demos and interviews. Selecting an appointment shows the full customer contact details, service information, appointment details, and notes, as explicitly requested by the owner. Anyone with the URL can read these details. Creation and all changes remain administrator-only at `/` and `/admin`.

## Views

- **Today:** demos and interviews for the current operating day, quick appointment actions, and due follow-ups.
- **Customers:** searchable profiles, customer stage filters, notes, and appointment history.
- **Calendar:** mobile-first month view, grouped slots, direct appointment creation, block/unblock individual half-hours or a day, and history for the selected operating date.
- **Follow-ups:** due/overdue, upcoming, interested customers awaiting interviews, and follow-up customers without a date. Clear the follow-up date and save after completing it.

Both `/` and `/admin` open the password-protected management application. `/booking` is public read-only. There is no `/member` route or public mutation API.

## Booking rules

The shared schedule runs **7 AM IST to 3 AM IST the following day**, in 40 half-hour positions.

| Group | IST start times |
|---|---|
| Morning | 7 AM to 11:30 AM |
| Afternoon | Noon to 4:30 PM |
| Evening | 5 PM to 8:30 PM |
| Night | 9 PM to 2:30 AM the following day |

- Demo: exactly 60 consecutive minutes; latest start **2 AM**.
- Interview: 30 or 60 consecutive minutes; latest start **2:30 AM** or **2 AM** respectively.
- Groups follow IST; the chosen timezone converts labels and shows actual local dates, including daylight-saving differences.
- Operating dates are IST dates. After midnight, the previous operating day remains selectable until 3 AM IST. Follow-up dates are also IST calendar dates.
- A demo and interview cannot overlap. One unavailable half disables the entire hour.
- Future booked appointments can be rescheduled. The old reservation remains until the replacement succeeds. Appointment type and customer cannot be changed during rescheduling.
- Completion is available after the end time; no-show is available after the start time. Cancellation releases all reserved halves while retaining history.
- Booked times are preserved when blocking a whole day. Unblocking removes only blocks.

## Database update for existing installations

The `direct_admin_slot_booking` migration has been applied to the connected interview-support project. Other installations can run `direct-booking-update.sql` in SQL Editor. Fresh installations should run the full `supabase-schema.sql` instead.

## Database setup

Use the Supabase project for this **new app**, not the reference app's project.

1. Run the entire `supabase-schema.sql` in Supabase **SQL Editor**.
2. Confirm `support_customers`, `support_appointments`, `support_slot_reservations`, and `support_booking_requests` exist.
3. Copy the project URL and a server `sb_secret_...` key from the Supabase dashboard. A legacy `service_role` key is supported as an alternative.
4. Keep Row Level Security enabled. The script grants table/RPC access only to `service_role`; direct browser database roles cannot read customer records; the public calendar reads through the server.

**Updating from the earlier version:** this script creates separate `support_*` tables. Existing `interview_*` records are left intact but are not imported or shown automatically. No destructive cleanup is performed. If the earlier app contains real bookings, reconcile/import them before using the new shared schedule, because the old and new ledgers are separate.

## Netlify setup

This GitHub repository currently contains the app in the `interview-support-slot-booking` subfolder. The root `netlify.toml` selects `interview-support-slot-booking` as the base directory. Deploy through the Git build pipeline; uploading the entire repository as static files will not deploy the APIs. The configuration supplies:

- Build command: `npm run build`
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Node.js: 22

Set the following in Netlify **Project configuration → Environment variables**, with Functions scope (or default all scopes) for the production deploy context:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://your-project-ref.supabase.co` |
| `SUPABASE_SECRET_KEY` | Server `sb_secret_...` key |
| `ADMIN_PASSWORD` | Strong private password, at least 12 characters |
| `ADMIN_JWT_SECRET` | Random signing secret, at least 32 characters |

If using the legacy server key, set `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_SECRET_KEY`.

Generate a signing secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Redeploy after setting/changing variables. Open `/admin` and sign in with `ADMIN_PASSWORD`. Real customer data never belongs in GitHub. Email settings, Supabase browser keys, and Supabase email authentication are unnecessary for this version. Existing Gmail/owner-email variables can be removed from this app's Netlify project.

## Local development

Requires Node.js 20+.

```bash
npm ci
cp .env.example .env
# Fill .env with your app's server settings.
npm run dev
```

Open `http://localhost:3000/admin`. The local development server invokes the real handlers and Supabase project; it is not a mock database. Never commit `.env`.

## Validation

```bash
npm run build
npm test
```

The tests run the real SQL/RPCs in isolated PGlite and cover scheduling, shared demo/interview capacity, atomic rescheduling, full cancellation, customer stages, stale-edit protection, idempotency, and private data access. Production Supabase and Netlify integration must still be checked after configuration.

An optional `tests/browser-flow.cjs` check requires Playwright and a Chromium installation. It runs the UI and real handlers against an isolated PGlite database, adapting only the Supabase REST transport. It does not use real customer data. Set `QA_CHROMIUM_EXECUTABLE` if using a custom Chromium path; `QA_SCREENSHOT_DIR` is optional.

## Security and data consistency

- Every read/write API except password login requires a signed, expiring admin token. The token stays in tab-scoped session storage and is removed on logout.
- The signing key remains server-only. Login compares password hashes with a constant-time comparison and has a Netlify rate-limit configuration. Verify the accepted rate-limit rule in deploy logs.
- Database tables have RLS enabled, with no public/member grants. RPCs are `SECURITY INVOKER`, explicitly executable only by the service role.
- All reservation, block, status, and customer mutations use the same transaction advisory lock. The half-hour ledger's primary key prevents duplicate occupancy. Status and reschedule actions use optimistic revisions to avoid overwriting a changed record.
- Reservation request IDs make uncertain network retries idempotent, including after subsequent reschedules. A reused request ID with different input is rejected.
- Reads page through the database response cap rather than silently losing large lists or a fully reserved 31-day month.
- If availability cannot be loaded, the UI disables booking instead of showing free slots.

Reference UI: https://github.com/rarbgtorr/slot-booking-app (unchanged).
