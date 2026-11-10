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
