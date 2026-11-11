# xDrip for iPhone — PRD

## Original problem
"Can you build me the same app as xdrp for Apple device?" → clarified as xDrip+ (CGM glucose app) for iPhone.
User requirements: unit selection, current number, trend arrow, chart 3h/6h/12h/24h, history of last 90 days, statistics (TIR, median…),
adjustable alarms, Nightscout + Tidepool upload, emergency SMS/phone call with location, AI daily summary, log insulin/carbs/notes,
tap a dot on the chart to see value + time, compatible with as many sensors as possible (Dexcom, Libre, Medtronic…).

## Architecture
- Expo Router app, 4 tabs (Home, History, Stats, Settings); NativeTabs on iOS 26+.
- FastAPI + MongoDB. Background loop (60s): pulls from source, uploads to Nightscout/Tidepool, checks alarms, sends emergency messages server-side.
- Sources: demo (90 days generated), manual, Nightscout (Medtronic/any uploader), Dexcom Share, LibreLinkUp.
- AI recap: Claude Sonnet 5.5 via Emergent LLM key, streamed via SSE.
- Emergency: Twilio SMS + voice call (keys NOT yet provided: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).

## Implemented (2026-11-10)
- All screens above; 27/27 backend tests pass; frontend flows verified.
- Data source split into Follower (Dexcom Share, LibreLinkUp, Nightscout) and Master (Bluetooth sensor, manual, demo).
  Master/Bluetooth: sensor type (Dexcom G6/ONE, G7/ONE+, Libre 2, Libre 3), transmitter ID, pair screen (/sensor) with
  BLE permission flow + scan (react-native-ble-plx, installed build only), POST /api/readings/batch for phone-collected readings.
  Sensor glucose decoding drivers NOT yet written (need user's sensor model).

## Backlog
- P0: Add Twilio keys to activate emergency texts/calls
- P1: Alarm sounds + local notifications when app is in background (native build)
- P1: Direct Bluetooth sensor connection (native build only; proprietary protocols)
- P2: Apple Health sync, home-screen widget, calibration entries, app passcode lock
- Emergency messages v2: separate SMS / call toggles, default hours per channel (Always / Night 00-07 / Custom),
  per-contact editor (nickname, phone, pick from phone contacts, SMS + call each on/off with Default/Always/custom hours),
  separate resend interval in minutes for SMS and calls while glucose stays at the same alarm level,
  triggers selectable: urgent low / low / high / urgent high. Server uses user's time zone (tz saved from phone).
- Dexcom G7 direct Bluetooth (Master > Bluetooth > G7): src/g7.ts listens alongside the official Dexcom G7 app
  (shared iOS connection, like LoopKit G7SensorKit / xDrip4iOS). Parses 0x4E glucose message (verified against Loop sample bytes),
  posts to /api/readings/batch with offline queue. SensorCollector mounted in root layout. Needs TestFlight build to test.
- Backlog: G7 backfill (missed readings), Libre 2 direct (NFC unlock + decryption), Dexcom Share upload.
- Separate target range (target_low/high, unit-aware) for graph dot colours + TIR; colours red low / sky blue in range / yellow high (2026-11-10)
- Sensor session (start/length, local-notification reminders 24h/12h/6h/1h/30m, Home notice, Stats card; G7 auto-detects start).
- Alarm sounds: 6 bundled sounds, per preset alarm style/sound/repeat/snooze; extreme low (<50 mg/dL) sound-only.
- Custom reminders (daily/once) and custom glucose alarms (below/above value) with own sound/repeat/snooze.
- Iteration 2 tests: 45/45 backend, frontend flows pass.
- Multi-user: username+password sign-in (JWT 60d, bcrypt, 5-try lockout), all data scoped by uid via Scoped collection wrapper (backend/auth.py), sync loop per user. Sign-out in Settings. Iteration 3: 61/61 backend tests.
- Backlog: password change, G7 backfill.

## Iteration 4–5 (2026-11-10)
- Emergency texts/calls are configured PER CONTACT only (contact sheet): text on/off, how texts go (Android: phone SIM vs Twilio cloud),
  when to text (Any time / Only at set hours with multiple windows, weekday circles, tap hour/minute grid), text-again interval;
  same for voice calls. Global SMS/call settings removed; legacy saves auto-migrate into contacts. Duplicate phone numbers rejected.
- Android SIM texting: local Expo module modules/direct-sms (SmsManager), server queues /api/sms/outbox, phone drains + reports;
  unpicked texts expire after 30 min with a log line. Needs installed Android build.
- Dexcom Share upload (Master mode, user's own Dexcom login, receiver serial, demo data never uploaded).
- Libre 2 / EU Libre 2 Plus direct: NFC scan (react-native-nfc-manager) reads FRAM calibration + enables streaming, BLE decrypt
  (port of DiaBLE Libre2.swift) + factory calibration (src/libre2.ts, libreNfc.ts). Libre 3 / Gen2 2 Plus: explained not possible.
- Nightscout/Tidepool/Dexcom upload sections: toggle first, fields appear when on. Settings split into src/components/settings/*.
- Iteration 5: 91/91 backend tests, frontend flows pass.

## Iteration 6 (2026-11-10)
- Renamed to GlucoGuard; soft cream + teal palette (design_guidelines.json palette_v2 → src/theme.ts).
- Change password: POST /api/auth/change-password (current + new), Settings > Account sheet (PasswordSheet.tsx).
- Per-contact test: POST /api/emergency/test?phone=&channel=sms|call; buttons in contact sheet. Duplicate contact phones rejected (backend + UI).
- G7 backfill: listens on BACKFILL characteristic (LoopKit G7BackfillMessage layout) to fill gaps; native build only.
- AI recap card can be closed (✕) and reopened ("Show daily recap").
- 107/107 backend tests. Twilio keys requested (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).

## Iteration 7
- New usernames: 6+ chars, no spaces (login still accepts older short names).
- Recovery email (Emergent managed Resend, email_service.py): asked right after sign-up (skippable with warning that password can't be recovered without it), editable in Settings > Account.
- Forgot password: 6-digit code (bcrypt-hashed, 15 min, 5 attempts, 60 s resend limit) → /api/auth/forgot + /api/auth/reset.
- Stats: Glycemia Risk Index card (GRI = 3.0·VLow + 2.4·Low + 1.6·VHigh + 0.8·High, zones A–E); time-in-range bands no longer overlap when targets are beyond 54/250.
- AI recap open/closed state remembered (AsyncStorage).

## Iteration 8
- Usernames 5+ chars. Emergency: Android contacts always text from the phone's own number (sms_via=phone); iPhone always via
  the user's OWN Twilio account (AppSettings.twilio_sid/twilio_token(secret)/twilio_from; env TWILIO_* only fallback).
  Turning on Emergency messages on iPhone without Twilio opens TwilioSheet. Android needs Twilio only for voice calls.
- Location reports include a reverse-geocoded street address; SMS shows address + map link, voice call speaks the address.
- Stats bands clamped so they never cross. Duplicate /auth/me removed. 126/126 backend tests.
- Open question from user: "companion app" mode (read glucose from other apps on the same phone).

## Iteration 9
- Android Companion mode: local Expo module modules/companion-glucose (NotificationListenerService reads glucose from
  Dexcom/Libre/Omnipod/CamAPS/Eversense/Medtrum/Beta Bionics/twiist/Tandem notifications incl. custom RemoteViews) →
  SharedPreferences queue → src/companion.ts drains every minute → /api/readings/batch {source:"companion"}. Source option
  "Companion app" (Android only) + CompanionCard (notification access status/button). Native build only.
- iPhone "Upload to Apple Health" (@kingstinct/react-native-healthkit + nitro-modules): writes Blood Glucose every 5 min
  (src/health.ts, HealthCard). Device-level toggle in AsyncStorage. Native build only.
- Recovery email reminder sheet on each app start if no email (EmailReminder.tsx), not right after skipping at sign-up.
- Disconnect Twilio: DELETE /api/twilio + button in TwilioSheet.

## Iteration 10
- Register asks for a name (3+ chars) → settings.em_name (used in emergency texts/calls). Profile tab (app/(tabs)/profile.tsx):
  initial-letter avatar, name edit, username, recovery email, change password, sign out. Account card removed from Settings.
- Dark mode: themes.dark palette in src/theme.ts + Appearance pref (Match phone / Light / Dark) in Settings, saved via src/appearance.ts.
- Companion background uploads: Kotlin service posts directly to /api/readings/batch with base URL + JWT handed over via
  CompanionGlucose.configure(); queue kept on failure.
- iPhone "Apple Health" data source (source="health"): reads Blood Glucose from HealthKit every 5 min, skipping GlucoGuard's own samples.
- History: periods "Day to Date" (step back 89 days), "By 7 days" (12 periods), "By 30 days" (3 periods), "By 90 days" (fixed). 3-day view removed.
- Register name now required (validate_default). 158/158 backend tests.
- Open: user asked for follower sources twiist Insight, Medtronic CareLink, Omnipod Discover/Glooko — explained (no public APIs; CareLink unofficial).

## Iteration 11
- New follower sources (backend/cloud_followers.py, ported from nightscout/nocturne connectors):
  - twiist Insight: AWS Cognito follower login → follower-service.mytwiistportal.com /pwd/overviews + /pwd/{id}/package (glucose blob: base64 raw-deflate, 8-byte LE records since 2008-01-01, mg/dL×100).
  - Medtronic CareLink (EU/US, country code, optional patient): password Auth0 login (usually CAPTCHA-blocked) or in-app Medtronic sign-in WebView
    (POST /api/carelink/start → WebView intercepts com.medtronic.carepartner:/sso?code= → POST /api/carelink/finish), refresh token kept server-side (cl_refresh_token secret), DELETE /api/carelink signs out.
  - Glooko / Omnipod DISCOVER (US/EU/CA/DE-FR): v2 sign_in session cookie → /api/v2/cgm/readings (wall-clock times converted with user tz).
- Settings > Follower lists twiist, CareLink, Omnipod DISCOVER/Glooko with their own login cards (src/components/settings/CloudFollowerFields.tsx, CareLinkLogin.tsx).
