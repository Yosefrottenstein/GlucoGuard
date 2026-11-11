from datetime import datetime
from typing import Annotated, Literal, Optional

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: Optional[dict]):
        return cls.model_validate(doc) if doc else None

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True)
        if data.get("_id") is None:
            data.pop("_id", None)
        else:
            data["_id"] = ObjectId(data["_id"])
        return data


class Reading(BaseDocument):
    ts: datetime
    sgv: int  # always mg/dL
    direction: str = "NONE"
    source: str
    ns_uploaded: bool = False
    tp_uploaded: bool = False
    dx_uploaded: bool = False


class Treatment(BaseDocument):
    ts: datetime
    kind: Literal["insulin", "carbs", "note"]
    insulin: Optional[float] = None
    carbs: Optional[float] = None
    note: Optional[str] = None
    ns_uploaded: bool = False
    tp_uploaded: bool = False


class EmergencyLog(BaseDocument):
    ts: datetime
    test: bool
    message: str
    results: list[str]


HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]  # Monday = 0


class TimeWindow(BaseModel):
    days: list[int] = Field(default_factory=lambda: list(ALL_DAYS), min_length=1, max_length=7)
    start: str = Field(default="00:00", pattern=HHMM)
    end: str = Field(default="07:00", pattern=HHMM)

    @model_validator(mode="after")
    def _days(self):
        if any(d < 0 or d > 6 for d in self.days):
            raise ValueError("days must be 0 (Monday) to 6 (Sunday)")
        self.days = sorted(set(self.days))
        return self


class ChannelSchedule(BaseModel):
    enabled: bool = True
    # "default" is from older saves and follows the global hours; the app now always saves always/hours per contact
    mode: Literal["default", "always", "hours"] = "always"
    windows: list[TimeWindow] = Field(default=[], max_length=10)
    repeat_minutes: int = Field(default=5, ge=1, le=720)  # resend while glucose stays at the same alarm level

    @model_validator(mode="before")
    @classmethod
    def _migrate(cls, data):
        # older saves had a single start/end every day
        if isinstance(data, dict) and not data.get("windows") and data.get("start"):
            data = {**data, "windows": [{"days": ALL_DAYS, "start": data["start"], "end": data.get("end", "07:00")}]}
        return data

    @model_validator(mode="after")
    def _need_window(self):
        if self.mode == "hours" and not self.windows:
            self.windows = [TimeWindow()]
        return self


class Contact(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^\+\d{7,15}$")
    sms: ChannelSchedule = ChannelSchedule()
    call: ChannelSchedule = ChannelSchedule()
    # "cloud" = Twilio; "phone" = the user's Android phone sends it from its own SIM card
    sms_via: Literal["cloud", "phone"] = "cloud"


class AlarmSound(BaseModel):
    style: Literal["sound", "vibrate", "both"] = "both"
    sound: Literal["classic", "chime", "siren", "pulse", "gentle", "alert"] = "classic"
    repeat_minutes: int = Field(default=1, ge=1, le=120)  # re-alert interval while the alarm is active
    snooze_minutes: int = Field(default=30, ge=1, le=720)


class GlucoseAlarm(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=60)
    direction: Literal["below", "above"] = "below"
    value: int = Field(ge=40, le=400)  # mg/dL
    enabled: bool = True
    style: Literal["sound", "vibrate", "both"] = "both"
    sound: Literal["classic", "chime", "siren", "pulse", "gentle", "alert"] = "classic"
    repeat_minutes: int = Field(default=5, ge=1, le=120)
    snooze_minutes: int = Field(default=30, ge=1, le=720)


class Reminder(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=80)
    time: str = Field(pattern=HHMM)
    repeat: Literal["daily", "once"] = "daily"
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    enabled: bool = True
    style: Literal["sound", "vibrate", "both"] = "both"
    sound: Literal["classic", "chime", "siren", "pulse", "gentle", "alert"] = "chime"


def default_alarm_sounds() -> dict:
    return {
        "extreme_low": AlarmSound(style="sound", sound="siren"),
        "urgent_low": AlarmSound(style="both", sound="siren"),
        "low": AlarmSound(style="both", sound="classic"),
        "high": AlarmSound(style="both", sound="chime"),
        "urgent_high": AlarmSound(style="both", sound="alert"),
        "missed": AlarmSound(style="vibrate", sound="gentle"),
    }


SECRET_FIELDS = ("ns_secret", "dexcom_password", "libre_password", "tp_password", "twilio_token")


class AppSettings(BaseModel):
    unit: Literal["mgdl", "mmol"] = "mgdl"
    source: Literal["demo", "manual", "bluetooth", "companion", "nightscout", "dexcom", "libre"] = "demo"
    # Master mode: direct Bluetooth sensor
    bt_sensor: Literal["dexcom_g6", "dexcom_g7", "libre2", "libre3"] = "dexcom_g6"
    bt_transmitter_id: str = ""
    bt_device_id: str = ""
    bt_device_name: str = ""
    # sensor session
    sensor_started_at: Optional[datetime] = None
    sensor_days: float = Field(default=10.5, gt=0, le=30)
    sensor_warn_enabled: bool = True
    sensor_warn_offsets: list[int] = [1440, 720, 360, 60, 30]  # minutes before the end
    sensor_warn_style: Literal["sound", "vibrate", "both"] = "both"
    sensor_warn_sound: Literal["classic", "chime", "siren", "pulse", "gentle", "alert"] = "chime"
    # alarm sounds per level; extreme low (< 50 mg/dL) is always sound only
    alarm_extreme_low: bool = True
    alarm_sounds: dict[str, AlarmSound] = Field(default_factory=default_alarm_sounds)
    reminders: list[Reminder] = Field(default=[], max_length=50)
    glucose_alarms: list[GlucoseAlarm] = Field(default=[], max_length=30)

    @model_validator(mode="after")
    def _fill_sounds(self):
        merged = {**default_alarm_sounds(), **self.alarm_sounds}
        merged["extreme_low"] = merged["extreme_low"].model_copy(update={"style": "sound"})
        self.alarm_sounds = merged
        return self
    # target range for graph colours and time-in-range, always mg/dL
    target_low: int = 70
    target_high: int = 180
    # alarm thresholds, always mg/dL
    urgent_low: int = 55
    low: int = 70
    high: int = 180
    urgent_high: int = 250
    alarm_urgent_low: bool = True
    alarm_low: bool = True
    alarm_high: bool = True
    alarm_urgent_high: bool = True
    alarm_missed: bool = True
    missed_minutes: int = 20
    snooze_minutes: int = 30
    # Nightscout
    ns_url: str = ""
    ns_secret: str = ""
    ns_upload: bool = False
    # Dexcom Share
    dexcom_username: str = ""
    dexcom_password: str = ""
    dexcom_region: Literal["us", "ous", "jp"] = "us"
    # Dexcom Share upload (Master mode), uses the Dexcom login above
    dx_upload: bool = False
    dx_serial: str = Field(default="SM00000000", pattern=r"^[A-Z0-9]{4,16}$")
    # LibreLinkUp
    libre_email: str = ""
    libre_password: str = ""
    # Tidepool
    tp_email: str = ""
    tp_password: str = ""
    tp_upload: bool = False
    tp_env: Literal["production", "integration"] = "production"
    # Emergency messages: texts and calls are set up per contact (on/off, hours, resend interval, how texts go)
    em_enabled: bool = False
    em_name: str = ""
    em_contacts: list[Contact] = []
    tz: str = "UTC"
    em_triggers: list[Literal["urgent_low", "low", "high", "urgent_high"]] = ["urgent_low"]
    em_delay_minutes: int = Field(default=15, ge=0, le=240)
    em_location: bool = True
    # The user's own Twilio account (iPhone texts + calls, Android calls)
    twilio_sid: str = Field(default="", pattern=r"^(AC[0-9a-fA-F]{32})?$")
    twilio_token: str = Field(default="", max_length=64)
    twilio_from: str = Field(default="", pattern=r"^(\+\d{7,15})?$")
    @model_validator(mode="after")
    def _unique_contacts(self):
        phones = [c.phone for c in self.em_contacts]
        if len(phones) != len(set(phones)):
            raise ValueError("Each emergency contact needs a different phone number")
        return self
    @model_validator(mode="before")
    @classmethod
    def _contacts_own_channels(cls, data):
        # Older saves kept on/off, hours and resend for texts/calls globally; move them into each contact.
        if not isinstance(data, dict) or "em_sms_schedule" not in data:
            return data
        data = dict(data)
        contacts = []
        for c in data.get("em_contacts") or []:
            c = dict(c)
            for ch in ("sms", "call"):
                own = dict(c.get(ch) or {})
                glob = dict(data.get(f"em_{ch}_schedule") or {})
                if own.get("mode", "default") == "default":
                    own.update({k: glob[k] for k in ("mode", "windows", "start", "end") if k in glob})
                    if own.get("mode") == "default":
                        own["mode"] = "always"
                if data.get(f"em_{ch}") is False:
                    own["enabled"] = False
                own.setdefault("repeat_minutes", data.get(f"em_{ch}_repeat_minutes", 5))
                c[ch] = own
            c.setdefault("sms_via", data.get("em_sms_via", "cloud"))
            contacts.append(c)
        data["em_contacts"] = contacts
        for k in ("em_sms", "em_call", "em_sms_via", "em_sms_schedule", "em_call_schedule", "em_sms_repeat_minutes", "em_call_repeat_minutes"):
            data.pop(k, None)
        return data

    def public(self) -> dict:
        data = self.model_dump()
        for f in SECRET_FIELDS:
            data[f + "_set"] = bool(data[f])
            data[f] = ""
        return data


class ReadingIn(BaseModel):
    sgv: int = Field(ge=20, le=600)
    ts: Optional[datetime] = None


class ReadingBatchItem(BaseModel):
    ts: datetime
    sgv: int = Field(ge=20, le=600)
    direction: str = "NONE"


class ReadingBatchIn(BaseModel):
    readings: list[ReadingBatchItem] = Field(max_length=2000)
    source: Literal["bluetooth", "companion"] = "bluetooth"


class TreatmentIn(BaseModel):
    kind: Literal["insulin", "carbs", "note"]
    insulin: Optional[float] = Field(default=None, ge=0, le=100)
    carbs: Optional[float] = Field(default=None, ge=0, le=500)
    note: Optional[str] = Field(default=None, max_length=500)
    ts: Optional[datetime] = None


class LocationIn(BaseModel):
    lat: float
    lon: float
    address: str = Field(default="", max_length=200)


class SmsResultIn(BaseModel):
    ok: bool
    error: Optional[str] = Field(default=None, max_length=200)


class AckIn(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=5, le=720)


class SummaryIn(BaseModel):
    start: datetime
    end: datetime
    label: str
