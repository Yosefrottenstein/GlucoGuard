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

## Backlog
- P0: Add Twilio keys to activate emergency texts/calls
- P1: Alarm sounds + local notifications when app is in background (native build)
- P1: Direct Bluetooth sensor connection (native build only; proprietary protocols)
- P2: Apple Health sync, home-screen widget, calibration entries, app passcode lock
