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


class Contact(BaseModel):
    name: str
    phone: str


SECRET_FIELDS = ("ns_secret", "dexcom_password", "libre_password", "tp_password")


class AppSettings(BaseModel):
    unit: Literal["mgdl", "mmol"] = "mgdl"
    source: Literal["demo", "manual", "nightscout", "dexcom", "libre"] = "demo"
    # thresholds, always mg/dL
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
    em_trigger: Literal["urgent_low", "low"] = "urgent_low"
    em_delay_minutes: int = 15
    em_repeat_minutes: int = 30
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
