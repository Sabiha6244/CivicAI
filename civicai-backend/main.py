import io
import json
import os
import re
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

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

GMAIL_SENDER_EMAIL = os.getenv("GMAIL_SENDER_EMAIL", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_SENDER_NAME = os.getenv("GMAIL_SENDER_NAME", "CivicAI")

INFERENCE_IMAGE_BUCKET = os.getenv("SUPABASE_INFERENCE_IMAGE_BUCKET", "complaint-images")

OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5

# Neutral adaptive-fusion defaults.
# These do not hard-code a preferred modality the way 0.6 / 0.4 did.
FUSION_ALPHA_TEXT = 1.0
FUSION_ALPHA_IMAGE = 1.0

# Conservative disagreement thresholds.
# Tune these later on a validation split for the paper.
CONFLICT_TEXT_THRESHOLD = 0.55
CONFLICT_IMAGE_THRESHOLD = 0.35

# Priority-scoring defaults aligned with the methodology.
RECENCY_BETA = 0.08
AREA_FREQUENCY_WINDOW_DAYS = 30
AREA_FREQUENCY_SATURATION_COUNT = 5

# Reliability / review thresholds.
LOW_TEXT_CONFIDENCE_THRESHOLD = 0.45
LOW_IMAGE_CONFIDENCE_THRESHOLD = 0.30
LOW_FUSION_CONFIDENCE_THRESHOLD = 0.45
NEEDS_REVIEW_FUSION_THRESHOLD = 0.75

EPSILON = 1e-8

TEXT_TOKENIZER = None
TEXT_MODEL = None
TEXT_META: dict[str, Any] | None = None
YOLO_MODEL = None
YOLO_CLASS_NAMES: list[str] = []

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

CITIZEN_TO_INTERNAL_CATEGORY = {
    "Garbage / Waste": "Garbage and Unsanitary Practices",
    "Streetlights": "Streetlights",
    "Roads / Footpaths": "Mobility - Roads, Footpaths and Infrastructure",
    "Traffic / Road Safety": "Traffic and Road Safety",
    "Water Supply": "Water Supply and Services",
    "Sewerage / Drainage": "Sewerage Systems",
    "Electricity": "Electricity and Power Supply",
    "Public Toilets": "Public Toilets",
    "Parks / Trees / Lakes": "Parks & Recreation",
    "Crime / Safety": "Crime and Safety",
    "Community Services": "Community Infrastructure and Services",
    "Other": "Other",
}

CATEGORY_SEVERITY = {
    "Crime and Safety": 1.00,
    "Electricity and Power Supply": 0.95,
    "Streetlights": 0.85,
    "Traffic and Road Safety": 0.85,
    "Storm Water Drains": 0.80,
    "Water Supply and Services": 0.78,
    "Garbage and Unsanitary Practices": 0.72,
    "Sewerage Systems": 0.72,
    "Pollution": 0.70,
    "Mobility - Roads, Footpaths and Infrastructure": 0.68,
    "Mobility - Roads, Public transport": 0.62,
    "Community Infrastructure and Services": 0.58,
    "Public Toilets": 0.52,
    "Trees and Saplings": 0.45,
    "Parks & Recreation": 0.40,
    "Lakes": 0.40,
    "Animal Husbandry": 0.35,
    "Certificates": 0.20,
    "Other": 0.25,
    "Uncategorized": 0.20,
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


def normalize_text(text: str) -> str:
    return " ".join((text or "").strip().split())


def safe_float(value: Any, digits: int = 6) -> float:
    return round(float(value), digits)


def format_metric(value: Any, digits: int = 4) -> str:
    return f"{float(value):.{digits}f}"


def build_in_filter(values: list[str]) -> str:
    clean_values = [str(v).strip() for v in values if str(v).strip()]
    if not clean_values:
        return "in.()"
    return f"in.({','.join(clean_values)})"


def get_primary_area_field_and_value(complaint: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    for field in ("city_area", "upazila", "district", "address_label"):
        raw = complaint.get(field)
        value = normalize_text(raw or "")
        if value:
            return field, value
    return None, None


def serialize_model_versions(data: Dict[str, Any]) -> Dict[str, str]:
    serialized: Dict[str, str] = {}
    for key, value in data.items():
        if value is None:
            serialized[key] = ""
        elif isinstance(value, bool):
            serialized[key] = str(value).lower()
        elif isinstance(value, float):
            serialized[key] = format_metric(value, digits=6)
        elif isinstance(value, (dict, list)):
            serialized[key] = json.dumps(value, ensure_ascii=False)
        else:
            serialized[key] = str(value)
    return serialized


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
        "select": (
            "id,title,description,status,created_at,"
            "user_category,final_category,category_source,"
            "division,district,upazila,city_area,address_label,"
            "lat,lng,location_details"
        ),
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


def get_text_label_order(meta: dict[str, Any]) -> list[str]:
    id2label = meta.get("id2label", {})
    if not id2label:
        return []

    max_idx = max(int(k) for k in id2label.keys())
    ordered = []
    for idx in range(max_idx + 1):
        ordered.append(id2label.get(str(idx), f"class_{idx}"))
    return ordered


def normalize_score_dict(
    score_dict: dict[str, float],
    label_order: list[str],
    fallback_uniform: bool = True,
) -> dict[str, float]:
    clean_scores = {label: max(0.0, float(score_dict.get(label, 0.0))) for label in label_order}
    total = sum(clean_scores.values())

    if total <= 0:
        if not label_order:
            return {}
        if fallback_uniform:
            uniform = 1.0 / len(label_order)
            return {label: uniform for label in label_order}
        return {label: 0.0 for label in label_order}

    return {label: value / total for label, value in clean_scores.items()}


def recency_score(created_at_value: Optional[str]) -> float:
    if not created_at_value:
        return 0.5

    try:
        created_dt = datetime.fromisoformat(created_at_value.replace("Z", "+00:00"))
        days_old = max(0.0, (utc_now() - created_dt).total_seconds() / 86400.0)
    except Exception:
        return 0.5

    return safe_float(np.exp(-RECENCY_BETA * days_old), digits=6)


def fetch_inference_label_map(complaint_ids: list[str]) -> dict[str, Optional[str]]:
    if not complaint_ids:
        return {}

    params = {
        "complaint_id": build_in_filter(complaint_ids),
        "select": "complaint_id,fusion_label",
    }
    r = rest_get("inference_results", params=params)
    if r.status_code != 200:
        return {}

    rows = r.json()
    return {str(row.get("complaint_id")): row.get("fusion_label") for row in rows}


def infer_existing_category(
    complaint_row: Dict[str, Any],
    inference_label_map: dict[str, Optional[str]],
) -> Optional[str]:
    final_category = complaint_row.get("final_category")
    if final_category:
        return normalize_text(final_category)

    user_category = complaint_row.get("user_category")
    mapped_user_category = map_citizen_category_to_internal(user_category)
    if mapped_user_category:
        return normalize_text(mapped_user_category)

    complaint_id = str(complaint_row.get("id") or "")
    inferred = inference_label_map.get(complaint_id)
    if inferred:
        return normalize_text(inferred)

    return None


def area_frequency_score(
    complaint: Dict[str, Any],
    target_category: Optional[str],
) -> Dict[str, Any]:
    area_field, area_value = get_primary_area_field_and_value(complaint)
    if not area_field or not area_value or not target_category:
        return {
            "score": 0.0,
            "matching_count": 0,
            "repeat_count": 0,
            "window_days": AREA_FREQUENCY_WINDOW_DAYS,
            "saturation_count": AREA_FREQUENCY_SATURATION_COUNT,
            "area_field": area_field,
            "area_value": area_value,
        }

    cutoff = iso(utc_now() - timedelta(days=AREA_FREQUENCY_WINDOW_DAYS))
    params = {
        "select": "id,user_category,final_category,created_at",
        area_field: f"eq.{area_value}",
        "created_at": f"gte.{cutoff}",
        "order": "created_at.desc",
        "limit": "250",
    }
    r = rest_get("complaints", params=params)
    if r.status_code != 200:
        return {
            "score": 0.0,
            "matching_count": 0,
            "repeat_count": 0,
            "window_days": AREA_FREQUENCY_WINDOW_DAYS,
            "saturation_count": AREA_FREQUENCY_SATURATION_COUNT,
            "area_field": area_field,
            "area_value": area_value,
        }

    rows = r.json() or []
    related_ids = [str(row.get("id")) for row in rows if row.get("id")]
    inference_label_map = fetch_inference_label_map(related_ids)

    matching_count = 0
    for row in rows:
        existing_category = infer_existing_category(row, inference_label_map)
        if existing_category == target_category:
            matching_count += 1

    current_id = str(complaint.get("id") or "")
    current_present = any(str(row.get("id") or "") == current_id for row in rows)
    repeat_count = max(0, matching_count - (1 if current_present else 0))
    score = min(1.0, repeat_count / AREA_FREQUENCY_SATURATION_COUNT)

    return {
        "score": safe_float(score),
        "matching_count": int(matching_count),
        "repeat_count": int(repeat_count),
        "window_days": AREA_FREQUENCY_WINDOW_DAYS,
        "saturation_count": AREA_FREQUENCY_SATURATION_COUNT,
        "area_field": area_field,
        "area_value": area_value,
    }


def looks_like_low_quality_text(text: str) -> bool:
    clean = normalize_text(text)
    if not clean:
        return True

    lowered = clean.lower()
    letters_only = re.sub(r"[^a-zA-Z]", "", lowered)

    if len(clean) < 8:
        return True

    if letters_only and len(set(letters_only)) <= 2:
        return True

    if re.fullmatch(r"[a-zA-Z]{1,8}", clean.replace(" ", "")):
        return True

    words = [w for w in re.split(r"\s+", lowered) if w]
    if len(words) == 1 and len(words[0]) <= 8:
        return True

    unique_words = len(set(words))
    if len(words) >= 4 and unique_words / max(len(words), 1) < 0.45:
        return True

    return False


def build_quality_flags(
    title: str,
    description: str,
    text_result: Dict[str, Any],
    image_result: Dict[str, Any],
    fusion_result: Dict[str, Any],
    citizen_ai_conflict: bool,
) -> list[str]:
    flags: list[str] = []

    combined_text = f"{title or ''} {description or ''}".strip()

    if looks_like_low_quality_text(combined_text):
        flags.append("low_quality_text")

    text_conf = float(text_result.get("confidence") or 0.0)
    if text_conf < LOW_TEXT_CONFIDENCE_THRESHOLD:
        flags.append("low_text_confidence")

    raw_image_labels = image_result.get("labels") or []
    if not raw_image_labels:
        flags.append("no_image_detection")

    if raw_image_labels and not image_result.get("has_mapped_signal"):
        flags.append("no_mapped_image_signal")

    image_branch_conf = float(image_result.get("branch_confidence") or 0.0)
    if image_result.get("has_mapped_signal") and image_branch_conf < LOW_IMAGE_CONFIDENCE_THRESHOLD:
        flags.append("low_image_confidence")

    if not image_result.get("has_mapped_signal"):
        flags.append("text_only_fallback")

    fusion_conf = float(fusion_result.get("fusion_confidence") or 0.0)
    if fusion_conf < LOW_FUSION_CONFIDENCE_THRESHOLD:
        flags.append("low_fusion_confidence")

    if fusion_result.get("conflict_flag"):
        flags.append("text_image_conflict")

    if citizen_ai_conflict:
        flags.append("citizen_ai_mismatch")

    return flags


def assess_ai_reliability(
    title: str,
    description: str,
    text_result: Dict[str, Any],
    image_result: Dict[str, Any],
    fusion_result: Dict[str, Any],
    citizen_ai_conflict: bool,
) -> Dict[str, Any]:
    quality_flags = build_quality_flags(
        title=title,
        description=description,
        text_result=text_result,
        image_result=image_result,
        fusion_result=fusion_result,
        citizen_ai_conflict=citizen_ai_conflict,
    )

    fusion_conf = float(fusion_result.get("fusion_confidence") or 0.0)
    has_image_signal = bool(image_result.get("has_mapped_signal"))
    text_conf = float(text_result.get("confidence") or 0.0)
    image_conf = float(image_result.get("branch_confidence") or 0.0)

    if "low_quality_text" in quality_flags and not has_image_signal:
        reliability_status = "insufficient_evidence"
    elif fusion_result.get("conflict_flag") or citizen_ai_conflict:
        reliability_status = "conflict_detected"
    elif fusion_conf < LOW_FUSION_CONFIDENCE_THRESHOLD:
        reliability_status = "low_confidence"
    elif text_conf < LOW_TEXT_CONFIDENCE_THRESHOLD and (not has_image_signal or image_conf < LOW_IMAGE_CONFIDENCE_THRESHOLD):
        reliability_status = "low_confidence"
    elif fusion_conf < NEEDS_REVIEW_FUSION_THRESHOLD or "low_text_confidence" in quality_flags or "low_image_confidence" in quality_flags:
        reliability_status = "needs_review"
    else:
        reliability_status = "reliable"

    manual_review_required = reliability_status in {
        "insufficient_evidence",
        "conflict_detected",
        "low_confidence",
        "needs_review",
    }

    return {
        "reliability_status": reliability_status,
        "manual_review_required": manual_review_required,
        "quality_flags": quality_flags,
    }


def map_citizen_category_to_internal(user_category: Optional[str]) -> Optional[str]:
    if not user_category:
        return None
    return CITIZEN_TO_INTERNAL_CATEGORY.get(user_category.strip(), user_category.strip())


def update_complaint_category_if_empty(
    complaint_id: str,
    final_category: Optional[str],
    category_source: str = "ai",
):
    if not final_category:
        return

    params = {
        "id": f"eq.{complaint_id}",
        "final_category": "is.null",
    }
    payload = {
        "final_category": final_category,
        "category_source": category_source,
    }

    r = rest_patch("complaints", payload, params=params)
    if r.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update complaint category: {r.status_code} {r.text}"
        )


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


def run_text_inference(title: str, description: str) -> Dict[str, Any]:
    tokenizer, model, meta = load_text_assets()

    text = normalize_text(f"{title}. {description}")
    if not text:
        return {
            "label": "Uncategorized",
            "confidence": 0.0,
            "distribution": {},
        }

    max_len = int(meta.get("max_len", 256))
    label_order = get_text_label_order(meta)

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

        distribution = {
            label_order[idx]: float(probs[idx])
            for idx in range(min(len(label_order), len(probs)))
        }

        best_label = max(distribution, key=distribution.get) if distribution else "Uncategorized"
        best_confidence = float(distribution.get(best_label, 0.0))

        return {
            "label": best_label,
            "confidence": safe_float(best_confidence),
            "distribution": distribution,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text inference failed: {str(e)}")


def run_image_inference(public_url: Optional[str]) -> Dict[str, Any]:
    _, _, meta = load_text_assets()
    label_order = get_text_label_order(meta)

    empty_distribution = normalize_score_dict({}, label_order, fallback_uniform=False)
    empty_result = {
        "labels": [],
        "confidences": [],
        "boxes": [],
        "detected_image_bytes": None,
        "top_civic_label": None,
        "top_civic_probability": 0.0,
        "branch_confidence": 0.0,
        "mapped_evidence_total": 0.0,
        "has_mapped_signal": False,
        "distribution": empty_distribution,
    }

    if not public_url:
        return empty_result

    model, _ = load_yolo_assets()

    try:
        img_res = requests.get(public_url, timeout=60)
        img_res.raise_for_status()

        image = Image.open(io.BytesIO(img_res.content)).convert("RGB")
        image_np = np.array(image)

        results = model.predict(source=image_np, verbose=False)
        if not results:
            return empty_result

        result = results[0]
        labels: list[str] = []
        confidences: list[float] = []
        boxes: list[list[float]] = []

        civic_scores = {label: 0.0 for label in label_order}
        mapped_detection_confidences: list[float] = []

        if result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                cls_idx = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].tolist()
                raw_label = result.names.get(cls_idx, f"class_{cls_idx}")

                labels.append(raw_label)
                confidences.append(conf)
                boxes.append([float(v) for v in xyxy])

                mapped_label = IMAGE_TO_CIVIC_LABEL.get(raw_label)
                if mapped_label:
                    civic_scores[mapped_label] = civic_scores.get(mapped_label, 0.0) + conf
                    mapped_detection_confidences.append(conf)

            plotted = result.plot()
            plotted_rgb = plotted[:, :, ::-1]
            annotated_image = Image.fromarray(plotted_rgb)
            buffer = io.BytesIO()
            annotated_image.save(buffer, format="JPEG", quality=92)
            detected_bytes = buffer.getvalue()

            distribution = normalize_score_dict(civic_scores, label_order, fallback_uniform=False)
            has_mapped_signal = any(value > 0.0 for value in civic_scores.values())
            top_civic_label = max(distribution, key=distribution.get) if has_mapped_signal else None
            top_civic_probability = float(distribution.get(top_civic_label, 0.0)) if top_civic_label else 0.0
            branch_confidence = max(mapped_detection_confidences, default=0.0)
            mapped_evidence_total = sum(mapped_detection_confidences)

            return {
                "labels": labels,
                "confidences": [safe_float(v) for v in confidences],
                "boxes": boxes,
                "detected_image_bytes": detected_bytes,
                "top_civic_label": top_civic_label,
                "top_civic_probability": safe_float(top_civic_probability),
                "branch_confidence": safe_float(branch_confidence),
                "mapped_evidence_total": safe_float(mapped_evidence_total),
                "has_mapped_signal": has_mapped_signal,
                "distribution": distribution,
            }

        return empty_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image inference failed: {str(e)}")


def fuse_results(text_result: Dict[str, Any], image_result: Dict[str, Any]) -> Dict[str, Any]:
    text_dist = text_result.get("distribution") or {}
    image_dist = image_result.get("distribution") or {}

    label_order = sorted(set(text_dist.keys()) | set(image_dist.keys()))
    if not label_order:
        return {
            "fusion_label": "Uncategorized",
            "fusion_confidence": 0.0,
            "conflict_flag": False,
            "distribution": {},
            "weights": {"text": 1.0, "image": 0.0},
            "branch_confidences": {"text": 0.0, "image": 0.0},
            "conflict_thresholds": {
                "text": CONFLICT_TEXT_THRESHOLD,
                "image": CONFLICT_IMAGE_THRESHOLD,
            },
        }

    text_available = bool(text_dist)
    image_available = bool(image_result.get("has_mapped_signal"))
    text_conf = float(text_result.get("confidence") or 0.0)
    image_conf = float(image_result.get("branch_confidence") or 0.0)

    if text_available and not image_available:
        text_weight = 1.0
        image_weight = 0.0
    elif image_available and not text_available:
        text_weight = 0.0
        image_weight = 1.0
    else:
        text_reliability = FUSION_ALPHA_TEXT * text_conf
        image_reliability = FUSION_ALPHA_IMAGE * image_conf
        denom = text_reliability + image_reliability
        if denom <= EPSILON:
            text_weight = 0.5
            image_weight = 0.5
        else:
            text_weight = text_reliability / denom
            image_weight = image_reliability / denom

    fused_distribution: dict[str, float] = {}
    for label in label_order:
        t_score = float(text_dist.get(label, 0.0))
        i_score = float(image_dist.get(label, 0.0))
        fused_distribution[label] = (text_weight * t_score) + (image_weight * i_score)

    fused_distribution = normalize_score_dict(fused_distribution, label_order, fallback_uniform=True)
    fusion_label = max(fused_distribution, key=fused_distribution.get)
    fusion_confidence = float(fused_distribution[fusion_label])

    text_label = text_result.get("label")
    image_label = image_result.get("top_civic_label")

    conflict_flag = bool(
        image_available
        and text_label
        and image_label
        and text_label != image_label
        and text_conf >= CONFLICT_TEXT_THRESHOLD
        and image_conf >= CONFLICT_IMAGE_THRESHOLD
    )

    return {
        "fusion_label": fusion_label,
        "fusion_confidence": safe_float(fusion_confidence),
        "conflict_flag": conflict_flag,
        "distribution": fused_distribution,
        "weights": {
            "text": safe_float(text_weight),
            "image": safe_float(image_weight),
        },
        "branch_confidences": {
            "text": safe_float(text_conf),
            "image": safe_float(image_conf),
        },
        "conflict_thresholds": {
            "text": CONFLICT_TEXT_THRESHOLD,
            "image": CONFLICT_IMAGE_THRESHOLD,
        },
        "used_text_only": bool(text_available and not image_available),
        "used_image_only": bool(image_available and not text_available),
    }


def simple_summary(title: str, description: str, fusion_label: str, image_labels: list[str]) -> str:
    clean_title = normalize_text(title or "")
    clean_desc = normalize_text(description or "")

    text_low_quality = looks_like_low_quality_text(f"{clean_title} {clean_desc}".strip())

    if image_labels:
        image_part = f" Image detections: {', '.join(image_labels[:3])}."
    else:
        image_part = " No image detections available."

    if text_low_quality and image_labels:
        return (
            f"{fusion_label}: Complaint text is unclear or low-quality, so the result relies more on image evidence."
            f"{image_part}"
        ).strip()

    if text_low_quality and not image_labels:
        return (
            f"{fusion_label}: Complaint text is unclear or low-quality and the image model found no usable detections."
            f" Manual authority review is recommended."
        ).strip()

    if clean_title:
        return f"{fusion_label}: {clean_title}. {clean_desc}{image_part}".strip()

    if clean_desc:
        return f"{fusion_label}: {clean_desc}{image_part}".strip()

    return f"{fusion_label}: Complaint submitted without sufficient text details.{image_part}".strip()


def calculate_priority(
    complaint: Dict[str, Any],
    fusion_label: Optional[str],
    fusion_conf: Optional[float],
    conflict_flag: bool,
):
    severity_component = float(CATEGORY_SEVERITY.get(fusion_label or "Uncategorized", 0.2))
    area_info = area_frequency_score(complaint=complaint, target_category=fusion_label)
    frequency_component = float(area_info.get("score") or 0.0)
    recency_component = recency_score(complaint.get("created_at"))
    confidence_component = float(fusion_conf or 0.0)
    conflict_component = 1.0 if conflict_flag else 0.0

    priority_norm = (
        0.35 * severity_component
        + 0.20 * confidence_component
        + 0.20 * frequency_component
        + 0.15 * recency_component
        - 0.10 * conflict_component
    )

    priority_norm = max(0.0, min(1.0, priority_norm))
    priority_score = round(priority_norm * 100.0, 2)

    if priority_score >= 75:
        priority = "high"
    elif priority_score >= 45:
        priority = "medium"
    else:
        priority = "low"

    components = {
        "severity": round(severity_component, 4),
        "fusion_confidence": round(confidence_component, 4),
        "area_frequency": round(frequency_component, 4),
        "recency": round(recency_component, 4),
        "conflict_penalty": round(conflict_component, 4),
    }

    return priority_score, priority, components, area_info


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

    citizen_category_raw = complaint.get("user_category")
    citizen_category_internal = map_citizen_category_to_internal(citizen_category_raw)

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

    priority_score, priority, priority_components, area_info = calculate_priority(
        complaint=complaint,
        fusion_label=fusion_result["fusion_label"],
        fusion_conf=fusion_result.get("fusion_confidence"),
        conflict_flag=fusion_result["conflict_flag"],
    )

    detected_image_path = None
    detected_image_url = None
    detected_bytes = image_result.get("detected_image_bytes")

    if detected_bytes:
        detected_image_path, detected_image_url = upload_detected_image(
            complaint_id=complaint_id,
            image_bytes=detected_bytes,
        )

    citizen_ai_conflict = bool(
        citizen_category_internal
        and fusion_result.get("fusion_label")
        and citizen_category_internal != fusion_result.get("fusion_label")
    )

    reliability = assess_ai_reliability(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
        text_result=text_result,
        image_result=image_result,
        fusion_result=fusion_result,
        citizen_ai_conflict=citizen_ai_conflict,
    )

    model_versions_payload = serialize_model_versions({
        "text_model": "roberta-base-local-finetuned",
        "image_model": "yolo-best-pt-local",
        "fusion_strategy": "adaptive-reliability-late-fusion-v3",
        "priority_strategy": "severity-confidence-frequency-recency-conflict-v3",
        "reliability_status": reliability["reliability_status"],
        "manual_review_required": reliability["manual_review_required"],
        "quality_flags": ", ".join(reliability["quality_flags"]) if reliability["quality_flags"] else "none",
        "citizen_ai_conflict": citizen_ai_conflict,
        "text_branch_confidence": text_result.get("confidence") or 0.0,
        "image_branch_confidence": image_result.get("branch_confidence") or 0.0,
        "image_top_civic_probability": image_result.get("top_civic_probability") or 0.0,
        "image_mapped_evidence_total": image_result.get("mapped_evidence_total") or 0.0,
        "text_weight": fusion_result.get("weights", {}).get("text", 1.0),
        "image_weight": fusion_result.get("weights", {}).get("image", 0.0),
        "used_text_only": fusion_result.get("used_text_only", False),
        "used_image_only": fusion_result.get("used_image_only", False),
        "conflict_threshold_text": CONFLICT_TEXT_THRESHOLD,
        "conflict_threshold_image": CONFLICT_IMAGE_THRESHOLD,
        "area_frequency_score": area_info.get("score", 0.0),
        "area_frequency_repeat_count": area_info.get("repeat_count", 0),
        "area_frequency_matching_count": area_info.get("matching_count", 0),
        "area_frequency_window_days": area_info.get("window_days", AREA_FREQUENCY_WINDOW_DAYS),
        "area_frequency_area_field": area_info.get("area_field") or "",
        "area_frequency_area_value": area_info.get("area_value") or "",
        "severity_score": priority_components.get("severity", 0.0),
        "recency_score": priority_components.get("recency", 0.0),
        "priority_components": priority_components,
    })

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
        "updated_at": iso(utc_now()),
        "model_versions": model_versions_payload,
    }

    upsert_inference_result(complaint_id, save_payload)

    update_complaint_category_if_empty(
        complaint_id=complaint_id,
        final_category=fusion_result.get("fusion_label"),
        category_source="ai",
    )

    return {
        "ok": True,
        "complaint_id": complaint_id,
        "citizen_category": citizen_category_raw,
        "citizen_category_internal": citizen_category_internal,
        "citizen_ai_conflict": citizen_ai_conflict,
        "text_result": text_result,
        "image_result": {
            "labels": image_result.get("labels"),
            "confidences": image_result.get("confidences"),
            "boxes": image_result.get("boxes"),
            "top_civic_label": image_result.get("top_civic_label"),
            "top_civic_probability": image_result.get("top_civic_probability"),
            "branch_confidence": image_result.get("branch_confidence"),
            "mapped_evidence_total": image_result.get("mapped_evidence_total"),
            "has_mapped_signal": image_result.get("has_mapped_signal"),
            "detected_image_url": detected_image_url,
        },
        "fusion_result": fusion_result,
        "priority_score": priority_score,
        "priority": priority,
        "summary": summary,
        "priority_components": priority_components,
        "area_frequency": area_info,
        "reliability_status": reliability["reliability_status"],
        "manual_review_required": reliability["manual_review_required"],
        "quality_flags": reliability["quality_flags"],
    }
