import io
import json
import os
import hashlib
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import requests
import torch
from PIL import Image
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from ultralytics import YOLO

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
TEXT_MODEL_DIR = BASE_DIR / "models" / "text_model"
YOLO_MODEL_PATH = BASE_DIR / "models" / "yolo" / "best.pt"
TEXT_META_PATH = TEXT_MODEL_DIR / "meta.json"
YOLO_DATA_PATH = BASE_DIR / "models" / "yolo" / "data.yaml"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_SENDER_NAME = os.getenv("GMAIL_SENDER_NAME", "CivicAI")

INFERENCE_IMAGE_BUCKET = os.getenv("SUPABASE_INFERENCE_IMAGE_BUCKET", "complaint-images")

OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5

TEXT_TOKENIZER = None
TEXT_MODEL = None
TEXT_META: dict[str, Any] | None = None
YOLO_MODEL = None
YOLO_CLASS_NAMES: list[str] = []

TEXT_TO_PRIORITY_WEIGHT = {
    "Crime and Safety": 30,
    "Electricity and Power Supply": 28,
    "Streetlights": 25,
    "Traffic and Road Safety": 24,
    "Storm Water Drains": 22,
    "Water Supply and Services": 20,
    "Garbage and Unsanitary Practices": 18,
    "Sewerage Systems": 18,
    "Trees and Saplings": 14,
    "Pollution": 16,
}

IMAGE_TO_CIVIC_LABEL = {
    "Damaged Road issues": "Mobility - Roads, Footpaths and Infrastructure",
    "Pothole Issues": "Mobility - Roads, Footpaths and Infrastructure",
    "Illegal Parking Issues": "Traffic and Road Safety",
    "Broken Road Sign Issues": "Traffic and Road Safety",
    "Fallen trees": "Trees and Saplings",
    "Littering/Garbage on Public Places": "Garbage and Unsanitary Practices",
    "Vandalism Issues": "Crime and Safety",
    "Dead Animal Pollution": "Pollution",
    "Damaged concrete structures": "Community Infrastructure and Services",
    "Damaged Electric wires and poles": "Electricity and Power Supply",
}

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


def supabase_rest_headers(prefer: str | None = None, content_type: str = "application/json"):
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
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


def rest_get(path: str, params: Optional[dict] = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    return requests.get(url, headers=supabase_rest_headers(), params=params, timeout=30)


def rest_post(path: str, payload: Any, prefer: str | None = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    return requests.post(
        url,
        headers=supabase_rest_headers(prefer=prefer),
        json=payload,
        timeout=30,
    )


def rest_patch(path: str, payload: Any, params: Optional[dict] = None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    return requests.patch(
        url,
        headers=supabase_rest_headers(),
        params=params,
        json=payload,
        timeout=30,
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


# ---------- supabase otp ----------
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


# ---------- complaint + inference helpers ----------
def get_complaint_row(complaint_id: str) -> Dict[str, Any]:
    params = {
        "id": f"eq.{complaint_id}",
        "select": "id,title,description,status,created_at",
        "limit": "1",
    }
    r = rest_get("complaints", params=params)
    if r.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load complaint: {r.status_code} {r.text}"
        )

    rows = r.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found.")

    return rows[0]


def get_complaint_image_row(complaint_id: str) -> Optional[Dict[str, Any]]:
    params = {
        "complaint_id": f"eq.{complaint_id}",
        "media_type": "eq.image",
        "select": "public_url,storage_path,created_at",
        "order": "created_at.asc",
        "limit": "1",
    }
    r = rest_get("complaint_media", params=params)
    if r.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load complaint image: {r.status_code} {r.text}"
        )

    rows = r.json()
    return rows[0] if rows else None


def get_existing_inference_result(complaint_id: str) -> Optional[Dict[str, Any]]:
    params = {
        "complaint_id": f"eq.{complaint_id}",
        "select": "complaint_id",
        "limit": "1",
    }
    r = rest_get("inference_results", params=params)
    if r.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check inference result: {r.status_code} {r.text}"
        )

    rows = r.json()
    return rows[0] if rows else None


def upsert_inference_result(complaint_id: str, payload: Dict[str, Any]):
    existing = get_existing_inference_result(complaint_id)

    if existing:
        params = {"complaint_id": f"eq.{complaint_id}"}
        r = rest_patch("inference_results", payload, params=params)
        if r.status_code not in (200, 204):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to update inference result: {r.status_code} {r.text}"
            )
        return

    insert_payload = {
        "complaint_id": complaint_id,
        **payload,
    }
    r = rest_post("inference_results", insert_payload)
    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to insert inference result: {r.status_code} {r.text}"
        )


def upload_detected_image(complaint_id: str, image_bytes: bytes) -> tuple[str, str]:
    file_name = f"ai-detections/{complaint_id}/detected-{int(datetime.now().timestamp())}.jpg"
    url = f"{SUPABASE_URL}/storage/v1/object/{INFERENCE_IMAGE_BUCKET}/{file_name}"

    headers = supabase_rest_headers(content_type="image/jpeg")
    headers["x-upsert"] = "true"

    r = requests.post(url, headers=headers, data=image_bytes, timeout=60)
    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload detected image: {r.status_code} {r.text}"
        )

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{INFERENCE_IMAGE_BUCKET}/{file_name}"
    return file_name, public_url


# ---------- real model helpers ----------
def load_text_assets():
    global TEXT_TOKENIZER, TEXT_MODEL, TEXT_META

    if TEXT_TOKENIZER is not None and TEXT_MODEL is not None and TEXT_META is not None:
        return TEXT_TOKENIZER, TEXT_MODEL, TEXT_META

    if not TEXT_MODEL_DIR.exists():
        raise HTTPException(status_code=500, detail=f"Text model directory not found: {TEXT_MODEL_DIR}")

    if not TEXT_META_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Text model meta file not found: {TEXT_META_PATH}")

    with open(TEXT_META_PATH, "r", encoding="utf-8") as f:
        TEXT_META = json.load(f)

    try:
        TEXT_TOKENIZER = AutoTokenizer.from_pretrained(str(TEXT_MODEL_DIR), local_files_only=True)
        TEXT_MODEL = AutoModelForSequenceClassification.from_pretrained(str(TEXT_MODEL_DIR), local_files_only=True)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        TEXT_MODEL.to(device)
        TEXT_MODEL.eval()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load text model: {str(e)}")

    return TEXT_TOKENIZER, TEXT_MODEL, TEXT_META


def load_yolo_assets():
    global YOLO_MODEL, YOLO_CLASS_NAMES

    if YOLO_MODEL is not None:
        return YOLO_MODEL, YOLO_CLASS_NAMES

    if not YOLO_MODEL_PATH.exists():
        raise HTTPException(status_code=500, detail=f"YOLO model file not found: {YOLO_MODEL_PATH}")

    try:
        YOLO_MODEL = YOLO(str(YOLO_MODEL_PATH))
        names = YOLO_MODEL.names
        if isinstance(names, dict):
            YOLO_CLASS_NAMES = [names[k] for k in sorted(names.keys())]
        else:
            YOLO_CLASS_NAMES = list(names)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load YOLO model: {str(e)}")

    return YOLO_MODEL, YOLO_CLASS_NAMES


def normalize_text(text: str) -> str:
    return " ".join((text or "").strip().split())


def run_text_inference(title: str, description: str) -> Dict[str, Any]:
    tokenizer, model, meta = load_text_assets()

    text = normalize_text(f"{title}. {description}")
    if not text:
        return {"label": "Uncategorized", "confidence": 0.0}

    max_len = int(meta.get("max_len", 256))
    id2label = meta.get("id2label", {})

    try:
        encoded = tokenizer(
            text,
            truncation=True,
            padding="max_length",
            max_length=max_len,
            return_tensors="pt",
        )

        device = next(model.parameters()).device
        encoded = {k: v.to(device) for k, v in encoded.items()}

        with torch.no_grad():
            outputs = model(**encoded)
            probs = torch.softmax(outputs.logits, dim=1)[0].detach().cpu().numpy()

        best_idx = int(np.argmax(probs))
        confidence = float(probs[best_idx])
        label = id2label.get(str(best_idx), f"class_{best_idx}")

        return {
            "label": label,
            "confidence": confidence,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text inference failed: {str(e)}")


def run_image_inference(public_url: Optional[str]) -> Dict[str, Any]:
    if not public_url:
        return {
            "labels": [],
            "confidences": [],
            "boxes": [],
            "detected_image_bytes": None,
            "top_civic_label": None,
        }

    model, _ = load_yolo_assets()

    try:
        img_res = requests.get(public_url, timeout=60)
        img_res.raise_for_status()

        image = Image.open(io.BytesIO(img_res.content)).convert("RGB")
        image_np = np.array(image)

        results = model.predict(source=image_np, verbose=False)
        if not results:
            return {
                "labels": [],
                "confidences": [],
                "boxes": [],
                "detected_image_bytes": None,
                "top_civic_label": None,
            }

        result = results[0]
        labels: list[str] = []
        confidences: list[float] = []
        boxes: list[list[float]] = []

        if result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                cls_idx = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].tolist()
                raw_label = result.names.get(cls_idx, f"class_{cls_idx}")
                labels.append(raw_label)
                confidences.append(conf)
                boxes.append([float(v) for v in xyxy])

            plotted = result.plot()
            plotted_rgb = plotted[:, :, ::-1]
            annotated_image = Image.fromarray(plotted_rgb)
            buffer = io.BytesIO()
            annotated_image.save(buffer, format="JPEG", quality=92)
            detected_bytes = buffer.getvalue()

            top_civic_label = IMAGE_TO_CIVIC_LABEL.get(labels[0], labels[0])

            return {
                "labels": labels,
                "confidences": confidences,
                "boxes": boxes,
                "detected_image_bytes": detected_bytes,
                "top_civic_label": top_civic_label,
            }

        return {
            "labels": [],
            "confidences": [],
            "boxes": [],
            "detected_image_bytes": None,
            "top_civic_label": None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image inference failed: {str(e)}")


def fuse_results(text_result: Dict[str, Any], image_result: Dict[str, Any]) -> Dict[str, Any]:
    image_labels = image_result.get("labels") or []
    image_confidences = image_result.get("confidences") or []
    image_civic_label = image_result.get("top_civic_label")

    text_label = text_result.get("label")
    text_conf = float(text_result.get("confidence") or 0.0)

    if image_labels and image_civic_label:
        top_image_conf = float(image_confidences[0] or 0.0)
        conflict_flag = bool(text_label and text_label != image_civic_label)

        if top_image_conf >= text_conf:
            return {
                "fusion_label": image_civic_label,
                "fusion_confidence": max(top_image_conf, text_conf),
                "conflict_flag": conflict_flag,
            }

        return {
            "fusion_label": text_label or image_civic_label,
            "fusion_confidence": max(text_conf, top_image_conf),
            "conflict_flag": conflict_flag,
        }

    return {
        "fusion_label": text_label or "Uncategorized",
        "fusion_confidence": text_conf,
        "conflict_flag": False,
    }


def simple_summary(title: str, description: str, fusion_label: str, image_labels: list[str]) -> str:
    clean_title = (title or "").strip()
    clean_desc = (description or "").strip()

    if image_labels:
        image_part = f" Image detections: {', '.join(image_labels[:3])}."
    else:
        image_part = ""

    if clean_title:
        return f"{fusion_label}: {clean_title}. {clean_desc}{image_part}".strip()

    if clean_desc:
        return f"{fusion_label}: {clean_desc}{image_part}".strip()

    return f"{fusion_label}: Complaint submitted without sufficient text details.{image_part}".strip()


def calculate_priority(
    fusion_label: Optional[str],
    fusion_conf: Optional[float],
    conflict_flag: bool,
    image_labels: list[str],
):
    score = 35.0
    score += float(TEXT_TO_PRIORITY_WEIGHT.get(fusion_label or "", 10))
    score += float(fusion_conf or 0.0) * 25.0

    if image_labels:
      score += 10.0

    if conflict_flag:
        score -= 8.0

    score = max(0.0, min(100.0, score))

    if score >= 75:
        priority = "high"
    elif score >= 45:
        priority = "medium"
    else:
        priority = "low"

    return score, priority


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

    sb_deactivate_active_otps(body.user_id)

    otp = generate_otp()
    otp_h = hash_otp(body.user_id, otp)

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

    sb_update_otp_row(row["id"], {"used_at": iso(now)})
    sb_upsert_profile_verified(body.user_id)

    return {
        "ok": True,
        "message": "Email verification completed successfully.",
        "verified_at": iso(now),
    }


@app.post("/ai/run/{complaint_id}")
def run_ai_for_complaint(complaint_id: str):
    require_backend_env()

    complaint = get_complaint_row(complaint_id)
    media = get_complaint_image_row(complaint_id)

    text_result = run_text_inference(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
    )

    image_result = run_image_inference(
        public_url=media.get("public_url") if media else None
    )

    fusion_result = fuse_results(text_result, image_result)

    summary = simple_summary(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
        fusion_label=fusion_result["fusion_label"],
        image_labels=image_result.get("labels") or [],
    )

    priority_score, priority = calculate_priority(
        fusion_label=fusion_result["fusion_label"],
        fusion_conf=fusion_result.get("fusion_confidence"),
        conflict_flag=fusion_result["conflict_flag"],
        image_labels=image_result.get("labels") or [],
    )

    detected_image_path = None
    detected_image_url = None
    detected_bytes = image_result.get("detected_image_bytes")

    if detected_bytes:
        detected_image_path, detected_image_url = upload_detected_image(
            complaint_id=complaint_id,
            image_bytes=detected_bytes,
        )

    save_payload = {
        "text_label": text_result.get("label"),
        "text_confidence": text_result.get("confidence"),
        "image_labels": image_result.get("labels"),
        "image_confidences": image_result.get("confidences"),
        "image_boxes": image_result.get("boxes"),
        "fusion_label": fusion_result.get("fusion_label"),
        "fusion_confidence": fusion_result.get("fusion_confidence"),
        "conflict_flag": fusion_result.get("conflict_flag"),
        "priority_score": priority_score,
        "priority": priority,
        "summary": summary,
        "detected_image_url": detected_image_url,
        "detected_image_path": detected_image_path,
        "model_versions": {
            "text_model": "roberta-base-local-finetuned",
            "image_model": "yolo-best-pt-local",
        },
        "updated_at": iso(utc_now()),
    }

    upsert_inference_result(complaint_id, save_payload)

    return {
        "ok": True,
        "complaint_id": complaint_id,
        "text_result": text_result,
        "image_result": {
            "labels": image_result.get("labels"),
            "confidences": image_result.get("confidences"),
            "boxes": image_result.get("boxes"),
            "detected_image_url": detected_image_url,
        },
        "fusion_result": fusion_result,
        "priority_score": priority_score,
        "priority": priority,
        "summary": summary,
    }