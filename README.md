# CampusBite

Campus surplus food announcements for MHacks 2026.

## Run locally

Requires Python 3.9+; no Python packages required.

```sh
python3 server.py
```

Open http://localhost:3000. For local network demos, change the bind address deliberately; the default is local-only.

## Features

- Food map and list (Leaflet / OpenStreetMap; no Google key required).
- Publish organizer-confirmed food, location, optional quantity and pickup deadline.
- Private management link closes an announcement early. Save this link; it grants edit access.
- Deadline expiration enforced by server on every listing; browser refreshes every five seconds.
- Shared SQLite persistence, including across browser sessions using the same server.
- Official UMich Food-tag event feed, original evidence and optional server-side IFM AI review.
- Analytics distinguish offered portions from actual pickups. No unsupported carbon savings claims.

## Environment

Store `IFM_API_KEY` in `.env`; never commit it. API keys never reach browser JavaScript. No emails are sent automatically. Photo recognition is not enabled: the configured model's vision capabilities have not been verified.

## Limitations

This is a hackathon prototype, not a production authentication system. Management links are bearer credentials. Event discovery is fetched on demand, not scheduled, and currently reads only the first 100 Food-tag occurrences. This differs from a full keyword search. No organizer contact inference or automated outreach. Map tiles require internet connectivity. SQLite requires a persistent server: GitHub Pages cannot host it, and ephemeral serverless storage is unsuitable. Choose persistent hosting before deploying publicly.

## Demo

Publish a clearly labeled test announcement, open another browser to observe it, close it using its private management link, and verify it disappears. Public records are distinct from unconfirmed event candidates.

## Food search homepage
The homepage automatically loads the official food keyword search. The server discovers its search_link and follows every JSON feed page, deduplicating by occurrence ID. Results cache for five minutes. If the source rejects requests, a visible error is shown; no fabricated results or Food-tag substitutions are used. Candidates remain separate from surplus announcements. Known campus buildings use approximate map markers; other locations remain in the list.

Current source: https://events.umich.edu/list?filter=tags:Food . All JSON feed pages are loaded (500 occurrences per page), cached for five minutes and displayed automatically. This is the Food-tag list, not full-text keyword search. Public feed retrieval requires system curl with normal TLS verification.

## Google Maps and building search
Add GOOGLE_MAPS_BROWSER_KEY to .env, enable Maps JavaScript API and Places API (New) in the same billed Google Cloud project, and restart server.py. Restrict this browser key to your website HTTP referrers and these two APIs; this key is intentionally visible to browsers. Do not reuse a private server key. With no key, the existing OpenStreetMap preview remains.

Google Places Text Search automatically searches unique event location names in Ann Arbor. Unique local matches appear as amber Google map markers; confirmed surplus is green. Multiple events in the same building share a marker. Ambiguous or virtual locations remain list-only. Search results are reused in memory for this browser session, not written to SQLite or localStorage. Google-derived positions are displayed only on the Google map.

## Automatic campus coordinates (no Google key required)
CampusBite includes an automatically downloaded 2026-10-03 snapshot of the public UMich Campus Map building dataset in campus-buildings.json. Activity building IDs, map IDs and slugs are matched first; unique exact normalized names are a fallback. Coordinates appear automatically on the existing Leaflet/OpenStreetMap map. Multiple events in one building share an amber marker. Unknown, ambiguous, virtual and non-campus locations remain list-only. Coordinates represent buildings, not pickup rooms. Google APIs are optional. Dataset source is recorded in the snapshot.

## User accounts

Use “Log in / Sign up” to register with a name, email and password (10–128 characters). Registration signs you in; the session lasts seven days and survives refreshes. Log out revokes the session. Browsing and posting retain their existing behavior.

SQLite `data/campusbite.sqlite` now contains `users` (id, name, unique normalized email, password_hash, password_salt, created) and `sessions` (hashed session token, user_id, expires). Passwords use salted PBKDF2-HMAC-SHA256 with 600,000 iterations; raw passwords and session tokens are never stored in the database. Cookies are HttpOnly and SameSite=Lax.

For an HTTPS deployment, set `COOKIE_SECURE=1`. This hackathon version does not include email verification or password recovery.

## Event registration

Today's event cards start collapsed; expanding shows details and Register. Registration requires a signed-in user and is stored in `event_registrations` (user_id, event_id, event_title, event_date, created), unique per user/event. Login or signup returns you to the event; press Register again to confirm. Refreshing preserves the registered state and expanded cards. These are CampusBite registrations, not submissions to the organizer's external registration system or reservations for surplus food.

## Pickup demo layout

Five clearly labelled sample pickups are seeded once per Ann Arbor date in `sample_events`. Their deadlines are fixed when seeded and do not reset with refresh. Samples expire like real announcements; the Show samples checkbox hides them. Food photos are illustrative Unsplash images, with local vector fallbacks.

Map labels show remaining time until the organizer's `deadline` and actual counts from `event_registrations`; counts refresh every five seconds. Organizer announcements also appear as registrable pickups (`pickup:<post id>`). Expired or closed pickups cannot be registered. Unconfirmed UMich events show no pickup countdown. Search, category filters and urgency sorting are available.

## Personal tree and food reports

Visitors see the main page; signed-in users also see Personal. Signup awards a tree with a short animation (respects reduced-motion preferences). Existing accounts start with the same level-one tree. Registered users can report “Just get it” (collected food) or “It has been running out” (found no food left).

`food_reports` stores user_id, event_id, status, created and updated, unique per user/event. The first report per registered event gives one watering; editing a report does not give extra waterings. Tree level is derived from saved report count: one level per three waterings, capped at level five. The API checks authentication and registration before accepting a report. Reports remain available after an event expires. Community reports do not automatically close an organizer announcement.

## Main-page impact dashboard

The dashboard uses the supplied `public/food_factors.csv` and `public/impact.js` conversion engine. Its item weights are generated from the CSV, rather than inferred from event names. Clicking Just get it opens a form for food type and actual quantity collected. Only quantified pickup reports feed GET `/api/impact`; registering or listing portions is not a pickup. Old reports without quantities are excluded and counted in the dashboard note. Editing a report updates a single record; changing it to ran out removes its impact.

Charts and cards support this week, this month and all time, with an Ann Arbor reporting date. Sample pickup reports are excluded by default and can be included explicitly with an INCLUDES DEMO label. The CSV weights and supplied emission factors are estimates, not measured emissions; projections are labelled separately. Drinks are counted in units (cups or cartons) without carbon claims. Chart.js is loaded from a CDN; numbers remain available if charts cannot load.

## Community events and current test mode

Anyone can use Add event without signing in. Events persist in `user_events`; campus building coordinates come from the official building snapshot. Event cards follow the selected Ann Arbor date (today). Pickup deadlines and food quantities are optional; an event with no deadline is unconfirmed surplus. The private management link can remove the event.

The current `.env` sets DATA_MODE=demo: five sample pickups, community events and organizer pickups are shown without fetching the UMich feed. Set DATA_MODE=live and restart to combine today's UMich events with local data. Sample deadlines were refreshed for this test session, but do not reset on page refresh.

## Off-campus event locations

Add event supports campus buildings or off-campus places. Off-campus users explicitly click Find location; the server searches Photon (OpenStreetMap), caches results in `place_cache`, permits only one outbound search at a time and spaces searches at least one second apart. There is no polling or automatic search while typing. Select a returned location and verify the preview pin before posting. The server resolves the saved result ID to coordinates. No Google API or browser key is needed. PHOTON_URL can point to another compatible provider/self-hosted instance. Public Photon is a limited demo service with no availability guarantee: https://github.com/komoot/photon#demo-server.

## Organizer invitation emails

`organizer_mail.py` retrieves a specific official UMich event page and extracts published @umich.edu email candidates. Candidate extraction does not prove an address is the office's shared inbox; verify that before choosing the recipient. Missing addresses are never guessed. This tool is separate from public endpoints, so visitors cannot trigger outgoing emails.

List candidates: `python3 organizer_mail.py --event-url https://events.umich.edu/event/EVENT_ID`

Preview: add `--recipient OFFICE@umich.edu --public-inbox-verified`. Configure PUBLIC_SITE_URL to the public HTTPS website first. The invitation includes the event source, website URL and steps for adding details without login and removing food announcements.

Send the reviewed invitation: additionally pass `--send` after configuring SMTP_HOST, SMTP_PORT, SMTP_SECURITY (starttls or ssl), SMTP_FROM and credentials in .env. Email is never sent on page refresh or during event scraping. SQLite organizer_invitations tracks sending/sent/failed and blocks duplicate event+recipient messages. An ambiguous failure or interrupted sending status needs review before any retry; SMTP acceptance is not proof of delivery.

## Private organizer keys and confirmation emails

New community events receive a unique `cb_org_` key with 256 bits of cryptographic randomness. The user_events organizer_key column stores its SHA-256 digest with a unique index; the plaintext key is returned only on creation and included in the private email outbox until SMTP accepts the message. Public feeds never return keys. Keep access to the local database private.

Paste the full key in the main search bar to see only the associated event (even if expired or closed). It permits only closing that event. The server sets status=0 (False) and closed=1 and excludes it from public feeds and new registrations. Existing private management links also set status=False.

When an email is supplied, an event_notification_outbox message records successful creation, private key and update steps. Without PUBLIC_SITE_URL and SMTP configuration it remains pending_configuration; the creation screen shows the key and does not claim email was sent. Once configured, run `python3 event_notifications.py` to deliver pending messages. New creations then send automatically. Sent payloads are cleared; failed or interrupted messages need review before retry to avoid duplicate delivery.

## School mailbox setup

Confirm the school and its approved SMTP/OAuth policy first. For UMich ITS Authenticated SMTP, registration is required: https://documentation.its.umich.edu/authenticated-smtp. The UMich preset uses smtp.mail.umich.edu, port 465, SSL and uniqname as username.

Run `python3 school_mail_setup.py --configure --umich` only after ITS enables this service. For another school-approved SMTP service use `python3 school_mail_setup.py --configure`. The terminal prompts for the password without displaying it; settings are saved in ignored .env with owner-only permissions. Never paste credentials in the chat or README. OAuth-only school accounts require another authentication integration; this helper does not bypass school policies.

Run `python3 school_mail_setup.py --verify-connection` to verify encrypted SMTP authentication without sending any mail. After success, restart the server; new event confirmations send using the school mailbox. Run `python3 event_notifications.py` to send previously queued pending_configuration confirmations. Do not blindly retry failed/sending notifications, as SMTP delivery may be ambiguous. A public HTTPS website URL is required so organizers can open their event management instructions.

## Local-only email demo

Current setup uses MAIL_DEMO_MODE=1 and PUBLIC_SITE_URL=http://localhost:3000. Confirmation emails explicitly state that the link only works on the computer running CampusBite. Encrypted Gmail SMTP still requires the account's app password and Internet access. New confirmations can send once the app password is configured and the server restarted. Public organizer outreach still requires a public HTTPS URL; do not send localhost invitations to external organizers. Set MAIL_DEMO_MODE=0 and a public HTTPS URL for deployment.

## Organizer notification channel
Add event supports Email or SMS. SMS uses Twilio's Messages API. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in private .env, then restart. Phone numbers must include country code (E.164). You need an SMS-capable Twilio sender and any account/destination authorization Twilio requires. Missing settings leave the notification pending; provider acceptance is not confirmed delivery. The organizer key copy dialog is always shown. Pending entries are not automatically sent on startup.

## Opt-in free-food SMS alerts
Signup supports an optional phone/SMS checkbox. Only new confirmed, active, non-sample food pickups with a deadline trigger alerts. Users can turn alerts off in Personal. A background thread polls ingestion every 60 seconds while server.py runs; live UMich ingestion retains its five-minute cache. DATA_MODE=demo leaves UMich paused. Twilio credentials are required for actual SMS. Outbox entries are deduplicated per user/event, skipped after expiry/closure/opt-out, and never blindly retried after ambiguous send failures. Existing active listings at signup do not trigger backdated alerts. Stop the local server to stop processing.
