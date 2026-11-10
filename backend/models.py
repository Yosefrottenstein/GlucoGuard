from datetime import datetime
from typing import Annotated, Literal, Optional

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

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


class ChannelSchedule(BaseModel):
    enabled: bool = True
    # "default" (contacts only) follows the global hours for this channel
    mode: Literal["default", "always", "hours"] = "default"
    start: str = Field(default="00:00", pattern=HHMM)
    end: str = Field(default="06:00", pattern=HHMM)


class Contact(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^\+\d{7,15}$")
    sms: ChannelSchedule = ChannelSchedule()
    call: ChannelSchedule = ChannelSchedule()


SECRET_FIELDS = ("ns_secret", "dexcom_password", "libre_password", "tp_password")


class AppSettings(BaseModel):
    unit: Literal["mgdl", "mmol"] = "mgdl"
    source: Literal["demo", "manual", "bluetooth", "nightscout", "dexcom", "libre"] = "demo"
    # Master mode: direct Bluetooth sensor
    bt_sensor: Literal["dexcom_g6", "dexcom_g7", "libre2", "libre3"] = "dexcom_g6"
    bt_transmitter_id: str = ""
    bt_device_id: str = ""
    bt_device_name: str = ""
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
    # LibreLinkUp
    libre_email: str = ""
    libre_password: str = ""
    # Tidepool
    tp_email: str = ""
    tp_password: str = ""
    tp_upload: bool = False
    tp_env: Literal["production", "integration"] = "production"
    # Emergency messages
    em_enabled: bool = False
    em_name: str = ""
    em_contacts: list[Contact] = []
    em_sms: bool = True
    em_call: bool = False
    em_sms_schedule: ChannelSchedule = ChannelSchedule(mode="always")
    em_call_schedule: ChannelSchedule = ChannelSchedule(mode="hours", start="00:00", end="07:00")
    tz: str = "UTC"
    em_triggers: list[Literal["urgent_low", "low", "high", "urgent_high"]] = ["urgent_low"]
    em_delay_minutes: int = Field(default=15, ge=0, le=240)
    em_sms_repeat_minutes: int = Field(default=5, ge=1, le=720)
    em_call_repeat_minutes: int = Field(default=5, ge=1, le=720)
    em_location: bool = True

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


class TreatmentIn(BaseModel):
    kind: Literal["insulin", "carbs", "note"]
    insulin: Optional[float] = Field(default=None, ge=0, le=100)
    carbs: Optional[float] = Field(default=None, ge=0, le=500)
    note: Optional[str] = Field(default=None, max_length=500)
    ts: Optional[datetime] = None


class LocationIn(BaseModel):
    lat: float
    lon: float


class AckIn(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=5, le=720)


class SummaryIn(BaseModel):
    start: datetime
    end: datetime
    label: str
