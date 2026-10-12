# Simple Interview Support Slot Manager

One mobile-first page at `/`, headed **INTERVIEW SLOT BOOKING**, with a simple calendar and 30-minute boxes. The calendar opens immediately without a password. Anyone with the link can view and manage bookings. Separate member, booking, customer, and follow-up pages are removed. No emails are sent.

## How to use it

1. Select an operating date and Morning, Afternoon, Evening, or Night.
2. Tap a **30-minute box**. Choose **Demo** or **Interview** and enter:
   - Member name
   - WhatsApp number with country code
   - Company name
   - Experience
   - Interview stage (enter Demo where applicable)
   - Member timezone
3. Save once. Calendar labels always use **IST**, so selecting a member timezone never shifts the selected start time.
4. A booked box shows its type and count: **1/2** is booked with one more place available; **2/2** is full. Demo is purple; interview is orange. A box containing both uses both colours.
5. Tap a booked box to see either member's details. Use **Book second appointment** while it has one booking.
6. To reschedule, open the member's booking, choose **Reschedule**, then tap the destination box. Review the prefilled six fields and save. The original place is released only when the new reservation succeeds. Any other booking in the original box remains.
7. Cancel a booking from its details to release only that member's reservation.

Hours: **7 AM IST to 3 AM IST the following day**, with 40 distinct half-hours. Latest start: **2:30 AM**. Groups follow IST. Actual next-day dates are displayed for late-night boxes. Member time is shown separately in the form and booking details.

## Capacity and existing data

- Every new demo or interview is exactly **30 minutes**.
- Each half-hour accepts a maximum of **two** independent bookings. A third is rejected by the database.
- Request retries do not consume a second place.
- The previous bookings identified by the owner as test data have been cleared. All new demos and interviews are 30 minutes.
- Member name, WhatsApp number, company, experience, interview stage, and timezone are stored directly in each appointment. No customer profile, service interest, follow-up, or member-status record is created.
- Existing blocked slots remain unavailable.

## Database

For a fresh app project, run the full `supabase-schema.sql` in Supabase SQL Editor.

For an existing installation, run `simple-booking-update.sql`, then `member-only-booking-update.sql`. Both updates have already been applied to the connected interview-support project. It adds the capacity places and appointment fields, preserves existing reservations, and replaces the reservation RPC. It does not alter the reference app's project.

## Netlify

The repository-root `netlify.toml` selects `interview-support-slot-booking` as the base directory. The app config publishes only `public`, runs `npm run build`, bundles the private server functions, and uses Node.js 22. Deploy the latest `main` through Netlify's Git build pipeline.

Set server variables in Netlify, available to Functions in the Production deploy context:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your app project's HTTPS URL |
| `SUPABASE_SECRET_KEY` | Server `sb_secret_...` key |

Legacy `SUPABASE_SERVICE_ROLE_KEY` is supported instead of the modern secret. Never commit real credentials. Redeploy after variable changes. No email or Supabase browser-auth configuration is needed.

## Local development and validation

```bash
npm ci
cp .env.example .env
# Fill server settings in .env.
npm run dev
```

Open `http://localhost:3000/`.

```bash
npm test
npm run build
```

The test suite runs actual SQL/RPCs against isolated PGlite and tests capacity, idempotency, exact selected minutes, member fields, cancellation/rescheduling isolation, stale edits, permissions, and preservation of older bookings. `tests/browser-flow.cjs` additionally requires Playwright and Chromium and tests the UI with real handlers and SQL while adapting only the Supabase REST transport. Set `QA_CHROMIUM_EXECUTABLE` for a custom browser; screenshots are optional with `QA_SCREENSHOT_DIR`.

The booking HTTP functions allow public reads and writes, as requested. Database credentials remain server-only. Database roles `anon` and `authenticated` have no booking-table access; RLS is enabled. Private server functions use explicitly granted service-role access. A shared transaction lock serializes reservation changes, and the date/minute/place primary key enforces two-place capacity. Booking history is retained on cancellation.

Reference UI (unchanged): https://github.com/rarbgtorr/slot-booking-app
