# GlucoGuard — Full Build Specification

A glucose-monitoring app for iPhone and Android, modelled on xDrip+ (Android) / xDrip4iOS.
Use this document to rebuild, continue or review the app. Everything below exists and works in the current version.

> Safety note for any builder: this is a health-safety app. Missed or late alarms can hurt someone.
> Every alarm, threshold, schedule and emergency rule below must be tested on real devices before release.
> The app does not give medical or dosing advice.

---

## 1. Tech stack (keep this exact stack to stay compatible)

| Part | Technology |
|---|---|
| Phone app | Expo (React Native, TypeScript), Expo Router file-based navigation |
| Backend | Python FastAPI, all routes start with `/api` |
| Database | MongoDB (motor async driver) |
| Auth | Own username + password, bcrypt hashing, JWT valid 60 days |
| AI recap | Claude Sonnet (Anthropic), streamed to the app |
| Email | Resend (password-reset codes) |
| Texts / calls | Twilio (user's own account), plus Android native SMS from the phone's SIM |
| Native libraries | react-native-ble-plx (Bluetooth), react-native-nfc-manager (Libre NFC), @kingstinct/react-native-healthkit (Apple Health), react-native-webview (CareLink sign-in), expo-audio (alarm sounds), expo-notifications (local alerts), expo-location, expo-contacts |
| Custom native modules (Kotlin, Android) | `modules/direct-sms` (send SMS via SmsManager), `modules/companion-glucose` (NotificationListenerService reading other glucose apps) |

App name: **GlucoGuard**. Bundle ID / package: `com.emergent.iphoneappguide.chhlza` (do not change).

---

## 2. Navigation

Bottom tabs: **Home · History · Stats · Settings · Profile**. Extra screen: `/sensor` (Bluetooth pairing).
Login / registration screen shown when signed out. Bottom sheets are used for editors (contacts, treatments, password, Twilio, alarms).

---

## 3. Accounts (multi-user)

- **Register:** name (3+ chars, required), username (5+ chars, no spaces, unique), password, confirm password.
- Right after sign-up, ask for a **recovery email** (can skip, with a warning that the password can't be recovered without it).
  If skipped, a reminder sheet appears on each app start until an email is added.
- **Login:** username + password. 5 wrong tries → temporary lockout.
- **Forgot password:** 6-digit code emailed, valid 15 minutes, 5 attempts, 60 s between resends; code stored hashed.
- **Change password:** current + new password (Profile tab).
- **Profile tab:** letter avatar, editable name (used in emergency messages), username, recovery email, change password, sign out.
- Every piece of data (readings, settings, logs, treatments) belongs to one user only.

---

## 4. Glucose data sources

All values are stored in **mg/dL**; shown in mg/dL or mmol/L (÷ 18.0182) depending on the user's choice.
A background loop on the server runs every 60 s per user: fetch new readings, upload to linked services, check alarms, send emergency messages.
Cloud sources are pulled every 2 minutes; after a failed login it backs off 2 → 4 → 8 → 16 → 30 minutes to avoid account lockouts.

### Follower mode (reads from a cloud account)
| Source | Login | Notes |
|---|---|---|
| Dexcom Share | Dexcom username/password, region US / outside US / Japan | Same unofficial API as xDrip/Nightscout |
| LibreLinkUp | Email/password | Follows the first linked patient |
| Nightscout | Site URL + API secret | Covers Eversense, Medtrum, AAPS, Loop and any uploader |
| twiist Insight | twiist **follower** account (made at mytwiistportal.com, invited from the twiist app) | AWS Cognito login → follower-service.mytwiistportal.com `/pwd/overviews` and `/pwd/{id}/package`; glucose history is base64 raw-deflate, 8-byte little-endian records (seconds since 2008-01-01, mg/dL×100). Ported from nightscout/nocturne |
| Medtronic CareLink | Username/password, region EU / US, 2-letter country, optional patient username | Auth0 login. Medtronic usually shows a CAPTCHA, so an in-app WebView sign-in page catches the `com.medtronic.carepartner:/sso?code=` redirect and the server exchanges the code (PKCE) and keeps the refresh token. Supports care-partner and patient accounts. Ported from nightscout/nocturne |
| Omnipod DISCOVER / Glooko | Email/password, region US / EU / CA / DE-FR | Glooko v2 sign-in cookie → `/api/v2/cgm/readings`; Glooko times are local wall-clock, converted with the user's time zone. Data is only as fresh as the pump app's last sync |

### Master mode (the phone collects the data)
- **Bluetooth sensor:** Dexcom G6/ONE, Dexcom G7/ONE+, Libre 2 / EU Libre 2 Plus. (Libre 3 shown as not possible.)
  - G7: listens alongside the official Dexcom app (shared connection), parses the 0x4E glucose message, fills gaps from the backfill characteristic.
  - Libre 2: NFC scan to read calibration and enable streaming, then BLE decrypt + factory calibration (port of DiaBLE).
  - Readings posted to `POST /api/readings/batch`, with an offline queue.
- **Companion app (Android only):** reads glucose from the notifications of Dexcom, Libre, Omnipod, CamAPS, Eversense, Medtrum, Beta Bionics, twiist and Tandem apps on the same phone, including when GlucoGuard is closed. Needs notification access (status card + button to open the setting).
- **Apple Health (iPhone only):** reads blood glucose from Health every 5 minutes, skipping GlucoGuard's own samples.
- **Manual:** type in a value.
- **Demo:** generated realistic data for 90 days (default for new users; never uploaded or used for emergency messages).

### Uploads (optional, toggle first, fields appear when on)
- Nightscout upload (readings + treatments)
- Tidepool upload (production / integration)
- Dexcom Share upload (Master mode, user's own Dexcom login + receiver serial)
- Apple Health write (iPhone, every 5 minutes, device-level toggle)

---

## 5. Home tab
- Big current value, unit, trend arrow (DoubleUp, SingleUp, FortyFiveUp, Flat, FortyFiveDown, SingleDown, DoubleDown), change since last reading, minutes ago.
- Interactive graph: 3h / 6h / 12h / 24h. Tap a dot to see value and time. Dots coloured: red below target, green in target, amber above target. Target band shaded.
- Treatments on the graph: insulin (units), carbs (grams), notes. Add via a bottom sheet; delete from the list.
- Active alarm banner with Snooze.
- Sensor session notice (days left).
- **AI daily recap** card: 4–6 plain sentences about today (time in range, highest/lowest periods with times, patterns around meals/insulin, no medical advice). Streams in live. Can be closed (✕) and reopened ("Show daily recap"); open/closed state remembered.
- Pull to refresh / "Sync now".

## 6. History tab (last 90 days)
- Period picker: **Day to Date** (step back day by day, up to 89 days), **By 7 days** (12 periods), **By 30 days** (3 periods), **By 90 days** (one period).
- Back / forward arrows, date label, graph for the period, mini stats (average, time in range, lows), treatments list.

## 7. Stats tab
For a chosen period: average, median, standard deviation, CV %, GMI, estimated A1c, min, max, data capture %.
- **Time in range bands** (never overlap): very low <54, low 54–target low, in range, high target high–250, very high >250 mg/dL.
- **Glycemia Risk Index (GRI):** hypo = %<54 + 0.8 × %54–69; hyper = %>250 + 0.5 × %181–250; GRI = min(100, 3.0 × hypo + 1.6 × hyper); zones A (0–20) … E (80–100).
- Sensor session card.
- Formulas: GMI = 3.31 + 0.02392 × average; A1c = (average + 46.7) / 28.7.

---

## 8. Alarms

### Preset levels (all thresholds editable, stored in mg/dL)
| Level | Default | Rule | Default style / sound |
|---|---|---|---|
| Extreme low | < 50 mg/dL | fixed, sound only (can't be vibrate-only) | sound / siren |
| Urgent low | ≤ 55 | | sound+vibrate / siren |
| Low | < 70 | | sound+vibrate / classic |
| High | > 180 | | sound+vibrate / chime |
| Urgent high | ≥ 250 | | sound+vibrate / alert |
| Missed readings | no data for 20 min (editable) | not for manual source | vibrate / gentle |

Each level: on/off, style (sound / vibrate / both), sound (classic, chime, siren, pulse, gentle, alert), repeat every N minutes (default 1), snooze length (default 30 min).
Separate **target range** (default 70–180) used for graph colours and time in range.

### Custom glucose alarms (up to 30)
Title, below/above, value (40–400 mg/dL), on/off, style, sound, repeat (default 5 min), snooze. Checked after the presets.

### Custom reminders (up to 50)
Title, time, daily or once (with date), on/off, style, sound.

### Sensor end-of-life
Sensor start time + length in days (default 10.5; G7 detects start automatically). Local notifications 24 h, 12 h, 6 h, 1 h and 30 min before the end (editable), with own style/sound.

Alarm state is kept on the server (current level, start time, snoozed until). Snooze/acknowledge from the app.
Alarms must also sound with the app in the background (native build).

---

## 9. Emergency messages (texts and voice calls)

- Master switch, name of the person (from Profile), triggers (urgent low / low / high / urgent high; extreme low counts as low),
  **delay**: send only if the alarm stays unacknowledged for N minutes (default 15, 0–240).
- Optional location: the phone reports GPS + reverse-geocoded street address; texts include the address + Google Maps link, calls speak the address.
- **Contacts** (each with its own settings, phone numbers must be unique, pick from phone contacts or type, format +countrycode):
  - Text on/off, when: any time OR only at set hours (multiple time windows, weekday selection, overnight windows allowed), resend every N minutes while glucose stays at that level.
  - Voice call on/off, same schedule options and its own resend interval.
  - "Test text" and "Test call" buttons per contact.
- **How it sends:**
  - Android: texts go from the phone's own SIM (server queues the text, phone sends it via the direct-sms module and reports back; unsent texts expire after 30 min). Voice calls use Twilio.
  - iPhone: texts and calls use the user's **own Twilio account** (Account SID, Auth Token, From number entered in a sheet; can disconnect).
- Never sends for demo data. Sends a log entry for every attempt (emergency log visible in Settings).

**Text wording**
`EMERGENCY: {Name}'s glucose is {value} {unit}, {trend words} ({N} min ago). The {level word} glucose alarm was not acknowledged. Location ({N} min ago): {address} - https://maps.google.com/?q={lat},{lon}`
(Test messages start with `TEST - `.)

**Voice call wording (repeated 3 times)**
`Emergency alert. {Name}'s glucose is {value} milligrams per deciliter, {trend words} ({N} minutes ago). The {level word} glucose alarm was not acknowledged. Their last known location, {N} minutes ago, was {address}. Please check on them now.`

Level words: extremely low, very low, low, high, very high. Trend words: rising fast, rising, rising slowly, steady, falling slowly, falling, falling fast.

---

## 10. Settings tab
Sections: Units (mg/dL / mmol/L) · Data source (Follower / Master with the sources above and their login cards) · Target range ·
Alarms (presets, custom alarms, reminders, sensor session) · Emergency messages (contacts, triggers, delay, location, Twilio) ·
Uploads (Nightscout, Tidepool, Dexcom Share, Apple Health) · Appearance (Match phone / Light / Dark) · Emergency log.
Passwords and tokens are never sent back to the phone (only "is set" flags); leaving a password field empty keeps the saved one.

---

## 11. Design
- Style: soft cream + teal, calm and medical-friendly, rounded cards, 8-pt spacing, 44-pt touch targets, light and dark themes.
- Light palette: background #FDFBF7, text #1C2B2D, card #FFFFFF, muted #748C8E, brand teal #2B7A78, soft teal #E2F1F0, border #E9E3D9, success #4E9F76, warning #D97706, error #D32F2F.
- Fonts: Space Grotesk (headings / big numbers), Plus Jakarta Sans (body).

---

## 12. Backend API (all under `/api`, JWT bearer token except auth)
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register, /auth/login | Create account / sign in |
| GET | /auth/me | Current user |
| PUT | /auth/email | Set recovery email |
| POST | /auth/change-password | Change password |
| POST | /auth/forgot, /auth/reset | Email code, reset password |
| GET / PUT | /settings | Read / save settings (partial updates) |
| GET | /status | Latest reading, delta, alarm state, sync status |
| GET / POST | /readings | List (start, end, bucket) / add manual |
| POST | /readings/batch | Phone-collected readings (bluetooth, companion, health) |
| GET / POST / DELETE | /treatments | Insulin, carbs, notes |
| GET | /stats | Stats for a period |
| POST | /sync | Sync now |
| POST | /nightscout/upload, /tidepool/upload, /dexcom/upload | Upload now |
| POST | /alarm/ack | Snooze / acknowledge |
| POST | /location | Phone reports location |
| POST | /emergency/test | Test (optionally one contact + sms/call) |
| GET | /emergency/log | Emergency history |
| GET / POST | /sms/outbox, /sms/outbox/{id} | Android SIM texts queue + result |
| DELETE | /twilio | Disconnect Twilio |
| POST | /carelink/start, /carelink/finish; DELETE /carelink | CareLink in-app sign-in / sign out |
| GET / POST | /ai/summary | Saved recap / generate (streamed) |

## 13. Database (MongoDB)
- `users`: username, hashed password, name, email, lockout + reset-code fields
- `settings` (one per user): everything in sections 4, 8, 9, 10
- `readings`: user, ts, sgv (mg/dL), direction, source, uploaded flags
- `treatments`: user, ts, kind (insulin/carbs/note), amount, note
- `state`: per user sync status, alarm state, location, CareLink sign-in
- `emergency_log`, `sms_outbox`

## 14. Phone permissions (with user-friendly reasons)
Bluetooth ("Connect to your glucose sensor for live readings"), Location ("Send your location to emergency contacts during lows"),
Contacts ("Pick emergency contacts from your address book"), Health read/write, Notifications, Android SEND_SMS and notification access.
Ask each only when the user taps the related feature, explain first, and offer "Open Settings" if denied.

## 15. What needs a real build (won't work in Expo Go)
Bluetooth sensors, Libre NFC, Apple Health, Android SIM texts, Android companion mode, alarm sounds in the background.
