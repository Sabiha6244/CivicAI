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

GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_SENDER_NAME = os.getenv("GMAIL_SENDER_NAME", "CivicAI")

OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- helpers ----------
def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(user_id: str, otp: str) -> str:
    raw = f"{user_id}:{otp}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def supabase_rest_headers(prefer: str | None = None):
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def require_backend_env():
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Backend environment variables are missing."
        )


# ---------- email ----------
def send_email_gmail(to_email: str, subject: str, html_content: str, text_content: str):
    if not GMAIL_SENDER_EMAIL or not GMAIL_APP_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Gmail environment variables are not configured."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{GMAIL_SENDER_NAME} <{GMAIL_SENDER_EMAIL}>"
    msg["To"] = to_email

    msg.set_content(text_content)
    msg.add_alternative(html_content, subtype="html")

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as server:
            server.starttls()
            server.login(GMAIL_SENDER_EMAIL, GMAIL_APP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Email delivery failed: {str(e)}"
        )


# ---------- supabase ----------
def sb_deactivate_active_otps(user_id: str):
    url = f"{SUPABASE_URL}/rest/v1/email_otps"
    params = {
        "user_id": f"eq.{user_id}",
        "used_at": "is.null",
    }
    patch = {"used_at": iso(utc_now())}
    r = requests.patch(url, headers=supabase_rest_headers(), params=params, json=patch, timeout=20)
    if r.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deactivate previous OTPs: {r.status_code} {r.text}"
        )


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
        raise HTTPException(
            status_code=500,
            detail=f"Failed to store OTP: {r.status_code} {r.text}"
        )


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
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read OTP: {r.status_code} {r.text}"
        )

    rows = r.json()
    return rows[0] if rows else None


def sb_update_otp_row(otp_id: str, patch: dict):
    url = f"{SUPABASE_URL}/rest/v1/email_otps"
    params = {"id": f"eq.{otp_id}"}
    r = requests.patch(url, headers=supabase_rest_headers(), params=params, json=patch, timeout=20)
    if r.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update OTP row: {r.status_code} {r.text}"
        )


def sb_upsert_profile_verified(user_id: str):
    url = f"{SUPABASE_URL}/rest/v1/profiles"
    payload = {
        "id": user_id,
        "is_verified": True,
    }
    r = requests.post(
        url,
        headers=supabase_rest_headers(prefer="resolution=merge-duplicates"),
        json=payload,
        timeout=20,
    )
    if r.status_code not in (200, 201, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update verification status: {r.status_code} {r.text}"
        )


# ---------- models ----------
class SendOtpReq(BaseModel):
    user_id: str
    email: EmailStr


class VerifyOtpReq(BaseModel):
    user_id: str
    email: EmailStr
    otp: str


# ---------- routes ----------
@app.post("/otp/send")
def otp_send(body: SendOtpReq):
    require_backend_env()

    now = utc_now()
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)

    # invalidate all previous active OTPs first
    sb_deactivate_active_otps(body.user_id)

    otp = generate_otp()
    otp_h = hash_otp(body.user_id, otp)

    # store newest OTP
    sb_insert_email_otp(body.user_id, otp_h, iso(expires_at))

    subject = "Your CivicAI verification code"

    text = (
        f"Hello,\n\n"
        f"Your CivicAI verification code is: {otp}\n\n"
        f"This code will expire in {OTP_TTL_MINUTES} minutes.\n"
        f"Please use the most recent code only.\n\n"
        f"If you did not request this code, you may ignore this email.\n\n"
        f"Regards,\n"
        f"{GMAIL_SENDER_NAME}"
    )

    html = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hello,</p>
      <p>Your CivicAI verification code is:</p>
      <div style="margin: 16px 0; font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #2563eb;">
        {otp}
      </div>
      <p>This code will expire in <strong>{OTP_TTL_MINUTES} minutes</strong>.</p>
      <p>Please use the <strong>most recent code only</strong>.</p>
      <p>If you did not request this code, you may safely ignore this email.</p>
      <p>Regards,<br>{GMAIL_SENDER_NAME}</p>
    </div>
    """

    try:
        send_email_gmail(body.email, subject, html, text)
    except HTTPException:
        # if sending fails, invalidate the OTP so user doesn't get stuck with a "latest active" code
        latest_row = sb_get_latest_active_otp(body.user_id)
        if latest_row:
            sb_update_otp_row(latest_row["id"], {"used_at": iso(utc_now())})
        raise

    return {
        "ok": True,
        "message": "Verification code sent successfully.",
        "sent_at": iso(now),
        "expires_at": iso(expires_at),
        "cooldown_seconds": OTP_COOLDOWN_SECONDS,
    }


@app.post("/otp/verify")
def otp_verify(body: VerifyOtpReq):
    require_backend_env()

    otp_clean = body.otp.strip()

    if not otp_clean.isdigit() or len(otp_clean) != 6:
        raise HTTPException(status_code=400, detail="OTP must be exactly 6 digits.")

    row = sb_get_latest_active_otp(body.user_id)
    if not row:
        raise HTTPException(status_code=400, detail="No active OTP found. Please request a new code.")

    now = utc_now()
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))

    if now > expires_at:
        sb_update_otp_row(row["id"], {"used_at": iso(now)})
        raise HTTPException(status_code=400, detail="This code has expired. Please request a new one.")

    attempts = int(row.get("attempts", 0))
    if attempts >= MAX_ATTEMPTS:
        sb_update_otp_row(row["id"], {"used_at": iso(now)})
        raise HTTPException(status_code=400, detail="Too many failed attempts. Please request a new code.")

    if hash_otp(body.user_id, otp_clean) != row["otp_hash"]:
        sb_update_otp_row(row["id"], {"attempts": attempts + 1})
        raise HTTPException(status_code=400, detail="The verification code is invalid.")

    # success
    sb_update_otp_row(row["id"], {"used_at": iso(now)})
    sb_upsert_profile_verified(body.user_id)

    return {
        "ok": True,
        "message": "Email verification completed successfully.",
        "verified_at": iso(now),
    }