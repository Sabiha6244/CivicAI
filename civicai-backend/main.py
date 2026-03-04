import os
import hashlib
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ---- Gmail SMTP env ----
GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_SENDER_NAME = os.getenv("GMAIL_SENDER_NAME", "CivicAI")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# ---------- OTP helpers ----------
OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5

def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"

def hash_otp(user_id: str, otp: str) -> str:
    raw = f"{user_id}:{otp}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def supabase_rest_headers():
    return {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

# ---------- Gmail email ----------
def send_email_gmail(to_email: str, subject: str, html_content: str):
    if not GMAIL_SENDER_EMAIL or not GMAIL_APP_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Gmail env not set (GMAIL_SENDER_EMAIL / GMAIL_APP_PASSWORD)."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{GMAIL_SENDER_NAME} <{GMAIL_SENDER_EMAIL}>"
    msg["To"] = to_email

    # fallback text + html
    msg.set_content("Your email client does not support HTML.")
    msg.add_alternative(html_content, subtype="html")

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(GMAIL_SENDER_EMAIL, GMAIL_APP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gmail SMTP send failed: {str(e)}")

# ---------- Supabase helpers ----------
def sb_insert_email_otp(user_id: str, otp_hash: str, expires_at_iso: str):
    url = f"{SUPABASE_URL}/rest/v1/email_otps"
    payload = {
        "user_id": user_id,
        "otp_hash": otp_hash,
        "expires_at": expires_at_iso,
        "attempts": 0,
        "used_at": None,
    }
    r = requests.post(url, headers=supabase_rest_headers(), json=payload, timeout=20)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"DB insert failed: {r.status_code} {r.text}")

def sb_get_latest_active_otp(user_id: str):
    url = f"{SUPABASE_URL}/rest/v1/email_otps"
    params = {
        "user_id": f"eq.{user_id}",
        "used_at": "is.null",
        "order": "created_at.desc",
        "limit": "1",
    }
    r = requests.get(url, headers=supabase_rest_headers(), params=params, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"DB read failed: {r.status_code} {r.text}")
    rows = r.json()
    return rows[0] if rows else None

def sb_update_otp_row(otp_id: str, patch: dict):
    url = f"{SUPABASE_URL}/rest/v1/email_otps"
    params = {"id": f"eq.{otp_id}"}
    r = requests.patch(url, headers=supabase_rest_headers(), params=params, json=patch, timeout=20)
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"DB update failed: {r.status_code} {r.text}")

def sb_mark_profile_verified(user_id: str):
    url = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {"id": f"eq.{user_id}"}
    patch = {"is_verified": True}
    r = requests.patch(url, headers=supabase_rest_headers(), params=params, json=patch, timeout=20)
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"Profile update failed: {r.status_code} {r.text}")

def sb_find_user_id_by_email(email: str) -> str | None:
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    params = {"email": email}
    r = requests.get(url, headers=supabase_rest_headers(), params=params, timeout=20)
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Auth admin query failed: {r.status_code} {r.text}")
    data = r.json()
    users = data.get("users") if isinstance(data, dict) else data
    if not users:
        return None
    return users[0]["id"]

# ---------- API models ----------
class SendOtpReq(BaseModel):
    user_id: str
    email: EmailStr

class VerifyOtpReq(BaseModel):
    email: EmailStr
    otp: str

@app.post("/otp/send")
def otp_send(body: SendOtpReq):
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Backend env not set (SUPABASE_URL / SERVICE ROLE KEY).")

    otp = generate_otp()
    otp_h = hash_otp(body.user_id, otp)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()

    # 1) Store hashed OTP in DB
    sb_insert_email_otp(body.user_id, otp_h, expires_at)

    # 2) Send OTP email via Gmail SMTP
    subject = "Your CivicAI OTP Code"
    html = f"""
    <p>Hi,</p>
    <p>Your OTP verification code is: <strong>{otp}</strong></p>
    <p>This code is valid for <strong>{OTP_TTL_MINUTES} minutes</strong>.</p>
    <p>Thank you,<br>{GMAIL_SENDER_NAME} Team</p>
    """
    send_email_gmail(body.email, subject, html)

    # Production mode: do NOT return OTP
    return {"ok": True, "message": "OTP sent to email"}

@app.post("/otp/verify")
def otp_verify(body: VerifyOtpReq):
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Backend env not set (SUPABASE_URL / SERVICE ROLE KEY).")

    if not body.otp.isdigit() or len(body.otp) != 6:
        raise HTTPException(status_code=400, detail="OTP must be exactly 6 digits.")

    user_id = sb_find_user_id_by_email(body.email)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found for this email.")

    row = sb_get_latest_active_otp(user_id)
    if not row:
        raise HTTPException(status_code=400, detail="No active OTP found. Please request a new OTP.")

    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)

    if now > expires_at:
        sb_update_otp_row(row["id"], {"used_at": now.isoformat()})
        raise HTTPException(status_code=400, detail="OTP expired. Please request a new OTP.")

    attempts = int(row.get("attempts", 0))
    if attempts >= MAX_ATTEMPTS:
        sb_update_otp_row(row["id"], {"used_at": now.isoformat()})
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new OTP.")

    expected_hash = row["otp_hash"]
    if hash_otp(user_id, body.otp) != expected_hash:
        sb_update_otp_row(row["id"], {"attempts": attempts + 1})
        raise HTTPException(status_code=400, detail="Invalid OTP.")

    # success
    sb_update_otp_row(row["id"], {"used_at": now.isoformat()})
    sb_mark_profile_verified(user_id)

    return {"ok": True, "message": "Email verified"}