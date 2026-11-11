# helper: print demo_user's saved twilio fields (used during iteration 8 UI checks)
from dotenv import dotenv_values
from pymongo import MongoClient

e = dotenv_values("/app/backend/.env")
db = MongoClient(e["MONGO_URL"])[e["DB_NAME"]]
u = db.users.find_one({"username": "demo_user"})
s = db.settings.find_one({"_id": str(u["_id"])}) or {}
print({k: s.get(k) for k in ("em_enabled", "twilio_sid", "twilio_from", "twilio_token", "em_contacts")})
