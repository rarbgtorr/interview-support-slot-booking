# Interview Support Slot Booking

A separate app based on the UI of `rarbgtorr/slot-booking-app`. The reference repository is not modified. The original calendar, palette, rounded cards, timezone picker and member/admin page layouts are retained.

## Booking rules

- Operating day: 7:00 AM IST through 2:00 AM IST on the following calendar date.
- 38 half-hour slots, with a choice of 30 minutes or two consecutive slots (60 minutes).
- Morning 7 AM–noon, Afternoon noon–5 PM, Evening 5–9 PM, Night 9 PM–2 AM.
- Each time group displays only its slots and the count of available start times for the chosen duration.
- Groups/calendar refer to the IST operating day. Each slot shows its actual date and times in the selected customer timezone, including different start/end dates when needed.
- The last 30-minute booking starts at 1:30 AM; the last 60-minute booking starts at 1 AM.
- Each time supports one booking. Past slots and unavailable pairs cannot be booked.
- Both halves of a 60-minute booking are reserved or released together.
- Rescheduling preserves the booking ID and original reservation until the replacement is successfully committed. A conflict rolls back the change.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Public booking calendar and timezone selection |
| `/member` | Email OTP login, upcoming/history bookings, cancellation and rescheduling |
| `/admin` | Password login, booking details, block/unblock, whole-day blocking and release |

`/member.html` and `/admin.html` work too. Netlify rewrites provide the clean endpoints. `/member/` and `/admin/` are supported.

## Setup

1. Use a **new Supabase project** for this app. Run `supabase-schema.sql` in its SQL Editor. Tables and RPCs are named `interview_*`; no reference-app tables are modified.
2. Enable email authentication. For a six-digit email OTP, edit the Supabase **Magic Link email template** to include `{{ .Token }}`:

   ```html
   <h2>Your login code</h2>
   <p>Enter this code to manage your interview support bookings: {{ .Token }}</p>
   ```

   Configure an SMTP sender for production OTP delivery. Set the Site URL to the new website URL.
3. Connect this repository to a **new Netlify site**. The checked-in `netlify.toml` sets publish directory `public`, functions directory `netlify/functions` and the build command.
4. Set server environment variables from `.env.example`:

   | Variable | Purpose |
   | --- | --- |
   | `SUPABASE_URL` | New project's API URL |
   | `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | Server-only database key |
   | `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` | Public key for member authentication |
   | `ADMIN_PASSWORD` | Admin password, at least 12 characters |
   | `ADMIN_JWT_SECRET` | Random signing secret, at least 32 characters |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Confirmation/cancellation/reschedule/reminder sender |
   | `OWNER_EMAIL` | Administrator notification recipient |
   | `APP_URL` | New website's HTTPS URL for links in emails |

   Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never commit real secrets.
5. Deploy, then test a real booking, OTP sign-in, reschedule and cancellation using the same customer email.

The database and sender are intentionally not preconfigured with reference-app credentials. Until configured, the UI reports unavailable services instead of treating failed availability requests as open slots.

## Local development and checks

Requires Node.js 20+; Netlify uses Node.js 22.

```bash
npm ci
cp .env.example .env
# Fill .env with the new project's settings.
npm run dev
```

Open `http://localhost:3000`. The local server invokes the real handlers; it does not provide simulated production bookings.

```bash
npm run build
npm test
```

Tests cover the full 38-slot schedule, DST conversion, next-day timestamps, invalid/past selections, API access controls, verified-email ownership, and SQL reservation transactions. SQL tests execute the actual schema/RPCs against an isolated PostgreSQL-compatible PGlite instance. The competing-request test uses PGlite's single-connection queue, so it does not replace a multi-connection production load test.

## Access controls and reservation integrity

- Public availability returns only dates, half-hour positions and statuses, never customer details.
- Member endpoints validate the access token through Supabase Auth and require a verified email. Queries/mutations use that email from the server, not a client-supplied owner.
- Admin endpoints require an HMAC-signed, expiring admin token with the app's admin audience and scope.
- Browser keys cannot access the private booking tables or mutation RPCs directly. RLS is enabled; explicit table/function grants go only to `service_role`.
- Reserve, block, cancel and reschedule use one shared transaction lock plus a primary-key slot ledger. An occupied half-hour cannot belong to two bookings or be overwritten by an admin block.
- Booking request IDs prevent duplicate reservations on request retries.
- Netlify function configuration limits admin login and public booking request rates per IP/domain. Verify the accepted rules in deploy logs before opening production traffic.
- Frontend Supabase and npm dependency versions are pinned. Runtime secrets live only in server environment variables; Netlify publishes only `public/`.

## Notifications and reminders

Gmail SMTP sends plain-text emails, preventing customer input from being interpreted as HTML. SMTP setup for Supabase OTP delivery is configured separately in the Supabase dashboard.

Email failure does not undo a saved reservation. The confirmation UI reports delivery status accurately and shows the booking reference. `/member` provides access even when the confirmation email is delayed.

The scheduled reminder runs every five minutes, looking for bookings starting about one hour later. Member and owner delivery markers are tracked independently. A successful reschedule clears those markers and increments the booking revision. Scheduled execution and real email delivery must be checked on the deployed site.

## Visitor statistics

The admin view keeps the reference's visit counters. These count browser visits, not verified unique people: local storage avoids repeat counting on the same browser/IST day, and the database stores only aggregate date/count values. They are not intended as fraud-resistant analytics.

## Reference

Original UI: https://github.com/rarbgtorr/slot-booking-app

Relevant setup documentation:
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/database/functions
- https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/
- https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
