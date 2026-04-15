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
from typing import Any, Dict, Optional, Literal, TypedDict

import requests
import torch
from PIL import Image
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from ultralytics import YOLO
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

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

SENTIMENT_ANALYZER = SentimentIntensityAnalyzer()

HOTSPOT_EPS_METERS = float(os.getenv("HOTSPOT_EPS_METERS", "100"))
HOTSPOT_MIN_SAMPLES = int(os.getenv("HOTSPOT_MIN_SAMPLES", "3"))

DUPLICATE_TEXT_THRESHOLD = float(os.getenv("DUPLICATE_TEXT_THRESHOLD", "0.85"))
DUPLICATE_LOCATION_RADIUS_M = float(os.getenv("DUPLICATE_LOCATION_RADIUS_M", "50"))
DUPLICATE_TIME_WINDOW_HOURS = float(os.getenv("DUPLICATE_TIME_WINDOW_HOURS", "24"))

FREQUENCY_RADIUS_M = float(os.getenv("FREQUENCY_RADIUS_M", "500"))
FREQUENCY_TIME_WINDOW_DAYS = float(os.getenv("FREQUENCY_TIME_WINDOW_DAYS", "7"))

OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5

EPSILON = 1e-8

TEXT_TOKENIZER = None
TEXT_MODEL = None
TEXT_META: dict[str, Any] | None = None
YOLO_MODEL = None
YOLO_CLASS_NAMES: list[str] = []

# -----------------------------
# Shared fusion space
# -----------------------------
SHARED_FUSION_LABELS = [
    "Community Infrastructure and Services",
    "Crime and Safety",
    "Electricity and Power Supply",
    "Garbage and Unsanitary Practices",
    "Mobility - Roads, Footpaths and Infrastructure",
    "Pollution",
    "Traffic and Road Safety",
    "Trees and Saplings",
]

IMAGE_TO_SHARED_LABEL = {
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

TEXT18_TO_SHARED_LABEL = {
    "Animal Husbandry": None,
    "Certificates": None,
    "Community Infrastructure and Services": "Community Infrastructure and Services",
    "Crime and Safety": "Crime and Safety",
    "Electricity and Power Supply": "Electricity and Power Supply",
    "Garbage and Unsanitary Practices": "Garbage and Unsanitary Practices",
    "Lakes": None,
    "Mobility - Roads, Footpaths and Infrastructure": "Mobility - Roads, Footpaths and Infrastructure",
    "Mobility - Roads, Public transport": None,
    "Parks & Recreation": None,
    "Pollution": "Pollution",
    "Public Toilets": None,
    "Sewerage Systems": None,
    "Storm Water Drains": None,
    "Streetlights": None,
    "Traffic and Road Safety": "Traffic and Road Safety",
    "Trees and Saplings": "Trees and Saplings",
    "Water Supply and Services": None,
}

TEXT_ONLY_LABELS = [
    label for label, mapped in TEXT18_TO_SHARED_LABEL.items() if mapped is None
]

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


CriterionType = Literal["benefit", "cost"]


class SawCriterion(TypedDict):
    name: str
    field: str
    type: CriterionType
    weight: float


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

@app.on_event("startup")
def preload_ai_models():
    try:
        load_text_assets()
        print("Text model preloaded.")
    except Exception as e:
        print(f"Text model preload skipped: {e}")

    try:
        load_yolo_assets()
        print("YOLO model preloaded.")
    except Exception as e:
        print(f"YOLO model preload skipped: {e}")

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


def get_required_float_env(name: str) -> float:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variable: {name}"
        )
    try:
        return float(raw)
    except ValueError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Environment variable {name} must be a float."
        ) from e


def get_required_json_env(name: str) -> Any:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variable: {name}"
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Environment variable {name} must contain valid JSON."
        ) from e


def get_fusion_weights() -> tuple[float, float]:
    text_weight = get_required_float_env("CIVICAI_FUSION_TEXT_WEIGHT")
    image_weight = get_required_float_env("CIVICAI_FUSION_IMAGE_WEIGHT")
    denom = text_weight + image_weight
    if denom <= EPSILON:
        raise HTTPException(
            status_code=500,
            detail="CIVICAI_FUSION_TEXT_WEIGHT + CIVICAI_FUSION_IMAGE_WEIGHT must be positive."
        )
    return text_weight, image_weight


def get_escalation_threshold_hours() -> float:
    threshold = get_required_float_env("CIVICAI_ESCALATION_THRESHOLD_HOURS")
    if threshold <= 0:
        raise HTTPException(
            status_code=500,
            detail="CIVICAI_ESCALATION_THRESHOLD_HOURS must be positive."
        )
    return threshold


def get_saw_criteria() -> list[SawCriterion]:
    criteria = get_required_json_env("CIVICAI_SAW_CRITERIA_JSON")
    if not isinstance(criteria, list) or not criteria:
        raise HTTPException(
            status_code=500,
            detail="CIVICAI_SAW_CRITERIA_JSON must be a non-empty JSON list."
        )

    total_weight = 0.0
    normalized_criteria: list[SawCriterion] = []
    for item in criteria:
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=500,
                detail="Each SAW criterion must be a JSON object."
            )
        if item.get("type") not in {"benefit", "cost"}:
            raise HTTPException(
                status_code=500,
                detail="SAW criterion type must be 'benefit' or 'cost'."
            )
        criterion: SawCriterion = {
            "name": str(item["name"]),
            "field": str(item["field"]),
            "type": item["type"],
            "weight": float(item["weight"]),
        }
        total_weight += float(criterion["weight"])
        normalized_criteria.append(criterion)

    if total_weight <= EPSILON:
        raise HTTPException(
            status_code=500,
            detail="Sum of SAW criterion weights must be positive."
        )

    return normalized_criteria


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
        "select": "*",
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


def fetch_existing_inference_results_for_complaints(complaint_ids: list[str]) -> dict[str, Dict[str, Any]]:
    if not complaint_ids:
        return {}

    params = {
        "complaint_id": build_in_filter(complaint_ids),
        "select": "complaint_id,fusion_confidence,fusion_label,model_versions",
        "limit": "500",
    }
    r = rest_get("inference_results", params=params)
    if r.status_code != 200:
        return {}

    rows = r.json() or []
    return {str(row.get("complaint_id")): row for row in rows if row.get("complaint_id")}


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


def project_text_distribution_to_shared_space(
    full_text_distribution: Dict[str, float]
) -> Dict[str, float]:
    shared_scores = {label: 0.0 for label in SHARED_FUSION_LABELS}

    for text_label, probability in full_text_distribution.items():
        shared_label = TEXT18_TO_SHARED_LABEL.get(text_label)
        if shared_label is None:
            continue
        shared_scores[shared_label] += float(probability)

    return normalize_score_dict(
        shared_scores,
        SHARED_FUSION_LABELS,
        fallback_uniform=False,
    )


def get_top_label_and_confidence(distribution: Dict[str, float]) -> tuple[Optional[str], float]:
    if not distribution:
        return None, 0.0
    label = max(distribution, key=distribution.get)
    confidence = float(distribution.get(label, 0.0))
    return label, confidence


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
            "shared_distribution": {},
            "shared_label": None,
            "shared_confidence": 0.0,
            "is_text_only_label": False,
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

        shared_distribution = project_text_distribution_to_shared_space(distribution)
        shared_label, shared_confidence = get_top_label_and_confidence(shared_distribution)

        return {
            "label": best_label,
            "confidence": safe_float(best_confidence),
            "distribution": distribution,
            "shared_distribution": shared_distribution,
            "shared_label": shared_label,
            "shared_confidence": safe_float(shared_confidence),
            "is_text_only_label": best_label in TEXT_ONLY_LABELS,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text inference failed: {str(e)}")


def run_image_inference(public_url: Optional[str]) -> Dict[str, Any]:
    empty_distribution = normalize_score_dict({}, SHARED_FUSION_LABELS, fallback_uniform=False)
    empty_result = {
        "labels": [],
        "confidences": [],
        "boxes": [],
        "detected_image_bytes": None,
        "top_shared_label": None,
        "top_shared_probability": 0.0,
        "has_shared_signal": False,
        "distribution": empty_distribution,
    }

    if not public_url:
        return empty_result

    model, _ = load_yolo_assets()

    try:
        img_res = requests.get(public_url, timeout=60)
        img_res.raise_for_status()

        image = Image.open(io.BytesIO(img_res.content)).convert("RGB")

        results = model.predict(source=image, verbose=False)
        if not results:
            return empty_result

        result = results[0]
        labels: list[str] = []
        confidences: list[float] = []
        boxes: list[list[float]] = []

        shared_scores = {label: 0.0 for label in SHARED_FUSION_LABELS}

        if result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                cls_idx = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].tolist()
                raw_label = result.names.get(cls_idx, f"class_{cls_idx}")

                labels.append(raw_label)
                confidences.append(conf)
                boxes.append([float(v) for v in xyxy])

                shared_label = IMAGE_TO_SHARED_LABEL.get(raw_label)
                if shared_label:
                    # Projection layer from detector labels to shared complaint labels.
                    # Required because the trained image model has 10 detector classes
                    # while multimodal fusion is performed in the shared complaint space.
                    shared_scores[shared_label] += conf

            plotted = result.plot()
            plotted_rgb = plotted[:, :, ::-1]
            annotated_image = Image.fromarray(plotted_rgb)
            buffer = io.BytesIO()
            annotated_image.save(buffer, format="JPEG", quality=92)
            detected_bytes = buffer.getvalue()

            distribution = normalize_score_dict(shared_scores, SHARED_FUSION_LABELS, fallback_uniform=False)
            has_shared_signal = any(value > 0.0 for value in shared_scores.values())
            top_shared_label = max(distribution, key=distribution.get) if has_shared_signal else None
            top_shared_probability = float(distribution.get(top_shared_label, 0.0)) if top_shared_label else 0.0

            return {
                "labels": labels,
                "confidences": [safe_float(v) for v in confidences],
                "boxes": boxes,
                "detected_image_bytes": detected_bytes,
                "top_shared_label": top_shared_label,
                "top_shared_probability": safe_float(top_shared_probability),
                "has_shared_signal": has_shared_signal,
                "distribution": distribution,
            }

        return empty_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image inference failed: {str(e)}")


def weighted_late_fusion_exact(
    text_distribution: dict[str, float],
    image_distribution: dict[str, float],
    text_weight: float,
    image_weight: float,
) -> Dict[str, Any]:
    """
    Exact weighted late fusion:
        y_hat = (w_text * p_text + w_image * p_image) / (w_text + w_image)
    """
    label_order = sorted(set(text_distribution.keys()) | set(image_distribution.keys()))
    if not label_order:
        return {
            "fusion_label": "Uncategorized",
            "fusion_confidence": 0.0,
            "distribution": {},
            "weights": {
                "text": 0.0,
                "image": 0.0,
            },
        }

    denom = float(text_weight) + float(image_weight)
    if denom <= EPSILON:
        raise HTTPException(
            status_code=500,
            detail="Fusion weight denominator must be positive."
        )

    fused_distribution: dict[str, float] = {}
    for label in label_order:
        p_text = float(text_distribution.get(label, 0.0))
        p_image = float(image_distribution.get(label, 0.0))
        fused_distribution[label] = (
            (float(text_weight) * p_text) + (float(image_weight) * p_image)
        ) / denom

    fused_distribution = normalize_score_dict(
        fused_distribution,
        label_order,
        fallback_uniform=False,
    )

    fusion_label = max(fused_distribution, key=fused_distribution.get)
    fusion_confidence = float(fused_distribution[fusion_label])

    return {
        "fusion_label": fusion_label,
        "fusion_confidence": safe_float(fusion_confidence),
        "distribution": fused_distribution,
        "weights": {
            "text": safe_float(float(text_weight)),
            "image": safe_float(float(image_weight)),
        },
    }


def resolve_final_prediction(
    text_result: Dict[str, Any],
    image_result: Dict[str, Any],
) -> Dict[str, Any]:
    text_weight, image_weight = get_fusion_weights()

    if text_result.get("is_text_only_label"):
        return {
            "final_label": text_result.get("label"),
            "final_confidence": float(text_result.get("confidence") or 0.0),
            "final_distribution": text_result.get("distribution") or {},
            "weights": {"text": 1.0, "image": 0.0},
            "decision_mode": "text_only_nonvisual_label",
            "used_exact_multimodal_fusion": False,
            "shared_fusion_result": None,
        }

    shared_text_distribution = text_result.get("shared_distribution") or {}
    shared_image_distribution = image_result.get("distribution") or {}
    image_has_signal = bool(image_result.get("has_shared_signal"))
    text_has_shared_signal = bool(shared_text_distribution)

    if text_has_shared_signal and image_has_signal:
        shared_fusion_result = weighted_late_fusion_exact(
            text_distribution=shared_text_distribution,
            image_distribution=shared_image_distribution,
            text_weight=text_weight,
            image_weight=image_weight,
        )
        return {
            "final_label": shared_fusion_result["fusion_label"],
            "final_confidence": shared_fusion_result["fusion_confidence"],
            "final_distribution": shared_fusion_result["distribution"],
            "weights": shared_fusion_result["weights"],
            "decision_mode": "exact_weighted_late_fusion_shared_8",
            "used_exact_multimodal_fusion": True,
            "shared_fusion_result": shared_fusion_result,
        }

    if text_has_shared_signal:
        return {
            "final_label": text_result.get("shared_label"),
            "final_confidence": float(text_result.get("shared_confidence") or 0.0),
            "final_distribution": shared_text_distribution,
            "weights": {"text": 1.0, "image": 0.0},
            "decision_mode": "text_only_shared_visual_label",
            "used_exact_multimodal_fusion": False,
            "shared_fusion_result": None,
        }

    return {
        "final_label": text_result.get("label"),
        "final_confidence": float(text_result.get("confidence") or 0.0),
        "final_distribution": text_result.get("distribution") or {},
        "weights": {"text": 1.0, "image": 0.0},
        "decision_mode": "text_only_fallback",
        "used_exact_multimodal_fusion": False,
        "shared_fusion_result": None,
    }


def action_hint_for_category(final_label: str) -> str:
    action_map = {
        "Garbage and Unsanitary Practices": "Send the sanitation team to inspect and clear the waste.",
        "Trees and Saplings": "Inspect the tree-related obstruction and remove any danger to the public.",
        "Traffic and Road Safety": "Inspect the road safety issue and take immediate traffic-control action if needed.",
        "Electricity and Power Supply": "Inspect the electrical hazard and secure the area if there is public risk.",
        "Crime and Safety": "Review the safety concern and coordinate field verification.",
        "Community Infrastructure and Services": "Inspect the damaged public structure and assess repair needs.",
        "Mobility - Roads, Footpaths and Infrastructure": "Inspect the road or footpath issue and assess whether repair is needed.",
        "Pollution": "Inspect the pollution source and take corrective action if confirmed.",
    }
    return action_map.get(final_label, "Inspect the site and verify the reported issue.")


def shorten_text(text: str, max_chars: int = 180) -> str:
    clean = normalize_text(text)
    if not clean:
        return ""
    if len(clean) <= max_chars:
        return clean
    shortened = clean[:max_chars].rsplit(" ", 1)[0]
    return f"{shortened}..."


def simple_summary(title: str, description: str, final_label: str, image_labels: list[str], decision_mode: str) -> str:
    clean_title = normalize_text(title or "")
    clean_desc = normalize_text(description or "")

    main_text = clean_desc or clean_title
    main_text = shorten_text(main_text, 180)

    if not main_text:
        main_text = "The complaint describes a public issue that should be verified on site."

    if image_labels:
        unique_labels = list(dict.fromkeys(image_labels))
        evidence_text = f"Visual evidence suggests: {', '.join(unique_labels[:2])}."
    else:
        evidence_text = "No strong visual evidence was detected from the uploaded image."

    action_text = action_hint_for_category(final_label)

    return (
        f"Reported issue: {main_text} "
        f"Suggested category: {final_label}. "
        f"{evidence_text} "
        f"Recommended first step: {action_text}"
    ).strip()

def compute_sentiment_score(title: str, description: str) -> float:
    """
    Returns a per-complaint sentiment score in [-1, 1].
    Uses VADER compound sentiment on complaint title + description.
    """
    text = normalize_text(f"{title}. {description}")
    if not text:
      return 0.0

    scores = SENTIMENT_ANALYZER.polarity_scores(text)
    compound = float(scores.get("compound", 0.0))
    return safe_float(max(-1.0, min(1.0, compound)))


def update_complaint_sentiment_score(complaint_id: str, sentiment_score: float):
    payload = {
        "sentiment_score": float(sentiment_score),
        "sentiment_scored_at": iso(utc_now()),
    }
    params = {"id": f"eq.{complaint_id}"}

    r = rest_patch("complaints", payload, params=params)
    if r.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update complaint sentiment score: {r.status_code} {r.text}"
        )
    
def urgency_from_sentiment_exact(sentiment_score: float) -> float:
    """
    Urgency normalization used for CivicAI deployment:
        U_i = (1 - s_i) / 2
    where s_i in [-1, 1].

    Interpretation:
    - very negative complaint text  -> urgency close to 1
    - neutral complaint text        -> urgency around 0.5
    - very positive complaint text  -> urgency close to 0
    """
    s_i = float(sentiment_score)
    if s_i < -1.0 or s_i > 1.0:
        raise HTTPException(
            status_code=500,
            detail="Sentiment score must be in [-1, 1]."
        )
    return safe_float((1.0 - s_i) / 2.0)


def calculate_elapsed_hours(created_at_iso: str) -> float:
    created_dt = datetime.fromisoformat(str(created_at_iso).replace("Z", "+00:00"))
    return safe_float((utc_now() - created_dt).total_seconds() / 3600.0)


def should_escalate_exact(
    created_at_iso: str,
    current_status: str,
    escalation_threshold_hours: float,
) -> dict[str, Any]:
    """
    Exact Rajkumar escalation condition:
        t_c - t_s > T and status != Resolved
    """
    if not created_at_iso:
        raise HTTPException(status_code=500, detail="created_at is required.")

    elapsed_hours = calculate_elapsed_hours(created_at_iso)
    status_clean = normalize_text(current_status or "").lower()

    escalated = bool(
        elapsed_hours > float(escalation_threshold_hours)
        and status_clean != "resolved"
    )

    return {
        "elapsed_hours": safe_float(elapsed_hours),
        "threshold_hours": safe_float(escalation_threshold_hours),
        "should_escalate": escalated,
    }


def normalize_saw_column_exact(values: list[float], criterion_type: CriterionType) -> list[float]:
    if not values:
        return []

    if criterion_type == "benefit":
        max_value = max(values)
        if max_value <= 0:
            return [0.0 for _ in values]
        return [safe_float(v / max_value) for v in values]

    if criterion_type == "cost":
        positive_values = [v for v in values if v > 0]
        if not positive_values:
            return [0.0 for _ in values]
        min_value = min(positive_values)
        return [safe_float(min_value / v) if v > 0 else 0.0 for v in values]

    raise HTTPException(status_code=500, detail=f"Unsupported criterion type: {criterion_type}")


def compute_saw_scores_exact(
    alternatives: list[dict[str, Any]],
    criteria: list[SawCriterion],
) -> list[dict[str, Any]]:
    """
    Exact SAW implementation:
      benefit: r_ij = x_ij / max_i x_ij
      cost:    r_ij = min_i x_ij / x_ij
      score:   V_i  = sum_j w_j * r_ij
    """
    if not alternatives:
        return []

    result_rows = [
        {
            "id": alt["id"],
            "raw": {},
            "normalized": {},
            "score": 0.0,
        }
        for alt in alternatives
    ]

    for criterion in criteria:
        field = criterion["field"]
        ctype = criterion["type"]
        weight = float(criterion["weight"])

        column_values: list[float] = []
        for alt in alternatives:
            raw_value = alt.get(field)
            if raw_value is None:
                raise HTTPException(
                    status_code=500,
                    detail=f"Missing SAW field '{field}' for complaint {alt.get('id')}"
                )
            column_values.append(float(raw_value))

        normalized_values = normalize_saw_column_exact(column_values, ctype)

        for idx, _ in enumerate(alternatives):
            result_rows[idx]["raw"][field] = safe_float(column_values[idx])
            result_rows[idx]["normalized"][field] = safe_float(normalized_values[idx])
            result_rows[idx]["score"] += weight * normalized_values[idx]

    for row in result_rows:
        row["score"] = safe_float(row["score"])

    result_rows.sort(key=lambda x: x["score"], reverse=True)

    for rank, row in enumerate(result_rows, start=1):
        row["rank"] = rank

    return result_rows


def get_all_complaint_rows(limit: int = 500) -> list[Dict[str, Any]]:
    params = {
        "select": "*",
        "order": "created_at.asc",
        "limit": str(limit),
    }
    r = rest_get("complaints", params=params)
    if r.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load complaint pool: {r.status_code} {r.text}"
        )
    return r.json() or []


def get_open_complaint_rows(
    limit: int = 500,
    active_statuses: Optional[list[str]] = None,
) -> list[Dict[str, Any]]:
    status_list = active_statuses or ["submitted", "processing"]
    status_set = {
        normalize_text(status).lower()
        for status in status_list
        if normalize_text(status)
    }

    rows = get_all_complaint_rows(limit=limit)
    return [
        row
        for row in rows
        if normalize_text(row.get("status") or "").lower() in status_set
    ]


def sort_scored_rows_for_queue(
    scored_rows: list[dict[str, Any]],
    complaint_lookup: dict[str, Dict[str, Any]],
) -> list[dict[str, Any]]:
    def tie_key(row: dict[str, Any]) -> tuple[float, float, str]:
        complaint_id = str(row.get("id") or "")
        complaint = complaint_lookup.get(complaint_id, {})
        created_at = complaint.get("created_at")
        created_ts = (
            parse_iso_datetime(created_at).timestamp()
            if created_at
            else float("inf")
        )
        return (
            -float(row.get("score") or 0.0),
            created_ts,
            complaint_id,
        )

    sorted_rows = sorted(scored_rows, key=tie_key)

    for rank, row in enumerate(sorted_rows, start=1):
        row["rank"] = rank

    return sorted_rows


def update_priority_fields_in_model_versions(
    complaint_id: str,
    existing_model_versions: Optional[Dict[str, Any]],
    *,
    priority_status: str,
    priority_rank: Optional[int],
    priority_reason: Optional[str],
    priority_normalized: Optional[Dict[str, Any]],
    priority_raw: Optional[Dict[str, Any]],
    urgency_score: Optional[float],
    frequency_score: Optional[int],
    priority_score: Optional[float],
):
    merged_model_versions = dict(existing_model_versions or {})

    merged_model_versions["priority_status"] = priority_status
    merged_model_versions["priority_rank"] = priority_rank if priority_rank is not None else ""
    merged_model_versions["priority_reason"] = priority_reason or ""
    merged_model_versions["priority_normalized"] = priority_normalized or {}
    merged_model_versions["priority_raw"] = priority_raw or {}
    merged_model_versions["urgency_score"] = urgency_score if urgency_score is not None else ""
    merged_model_versions["frequency_score"] = frequency_score if frequency_score is not None else ""

    payload = {
        "model_versions": serialize_model_versions(merged_model_versions),
        "priority_score": priority_score,
        "updated_at": iso(utc_now()),
    }

    params = {"complaint_id": f"eq.{complaint_id}"}
    r = rest_patch("inference_results", payload, params=params)
    if r.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update priority metadata for complaint {complaint_id}: {r.status_code} {r.text}"
        )


def recompute_priority_ranks_for_queue(limit: int = 500) -> Dict[str, Any]:
    criteria = get_saw_criteria()
    needs_frequency = any(
        criterion["field"] == "complaint_frequency"
        for criterion in criteria
    )

    all_rows = get_all_complaint_rows(limit=limit)
    submitted_pool = [
        row
        for row in all_rows
        if normalize_text(row.get("status") or "").lower() == "submitted"
    ]
    active_pool = [
        row
        for row in all_rows
        if normalize_text(row.get("status") or "").lower() in {"submitted", "processing"}
    ]

    complaint_lookup = {
        str(row.get("id")): row
        for row in all_rows
        if row.get("id")
    }

    complaint_ids = [str(row.get("id")) for row in all_rows if row.get("id")]
    inference_map = fetch_existing_inference_results_for_complaints(complaint_ids)

    frequency_cache: dict[str, int] = {}
    if needs_frequency:
        for row in submitted_pool:
            complaint_id = str(row.get("id") or "")
            frequency_cache[complaint_id] = compute_frequency_score(
                complaint=row,
                all_open_complaints=active_pool,
                inference_map=inference_map,
                radius_m=FREQUENCY_RADIUS_M,
                days=FREQUENCY_TIME_WINDOW_DAYS,
            )

    required_fields = {criterion["field"] for criterion in criteria}
    alternatives: list[dict[str, Any]] = []

    for row in submitted_pool:
        complaint_id = str(row.get("id") or "")
        sentiment_score = row.get("sentiment_score")
        existing_inf = inference_map.get(complaint_id) or {}
        fusion_conf_raw = existing_inf.get("fusion_confidence")

        if sentiment_score is None or fusion_conf_raw is None:
            continue

        try:
            urgency_score = urgency_from_sentiment_exact(float(sentiment_score))
            elapsed_hours = calculate_elapsed_hours(str(row.get("created_at")))
        except Exception:
            continue

        alternative = {
            "id": complaint_id,
            "urgency_score": safe_float(urgency_score),
            "fusion_confidence": safe_float(float(fusion_conf_raw)),
            "elapsed_hours": safe_float(elapsed_hours),
        }

        if needs_frequency:
            alternative["complaint_frequency"] = int(frequency_cache.get(complaint_id, 0))

        if all(alternative.get(field) is not None for field in required_fields):
            alternatives.append(alternative)

    ranked_rows: list[dict[str, Any]] = []
    if alternatives:
        ranked_rows = compute_saw_scores_exact(alternatives, criteria)
        ranked_rows = sort_scored_rows_for_queue(ranked_rows, complaint_lookup)

    ranked_map = {
        str(row.get("id")): row
        for row in ranked_rows
        if row.get("id")
    }

    updated_count = 0
    cleared_count = 0

    # Write unique ranks for all submitted complaints that are rankable.
    for row in submitted_pool:
        complaint_id = str(row.get("id") or "")
        existing_inf = inference_map.get(complaint_id)

        if not existing_inf:
            continue

        if complaint_id in ranked_map:
            ranked = ranked_map[complaint_id]
            update_priority_fields_in_model_versions(
                complaint_id=complaint_id,
                existing_model_versions=existing_inf.get("model_versions"),
                priority_status="computed",
                priority_rank=int(ranked["rank"]),
                priority_reason="Complaint ranked in submitted first-review queue.",
                priority_normalized=dict(ranked.get("normalized") or {}),
                priority_raw=dict(ranked.get("raw") or {}),
                urgency_score=safe_float(float(ranked["raw"].get("urgency_score", 0.0))),
                frequency_score=(
                    int(ranked["raw"].get("complaint_frequency", 0))
                    if "complaint_frequency" in (ranked.get("raw") or {})
                    else None
                ),
                priority_score=safe_float(float(ranked.get("score") or 0.0)),
            )
            updated_count += 1
        else:
            urgency_score = None
            try:
                if row.get("sentiment_score") is not None:
                    urgency_score = urgency_from_sentiment_exact(float(row.get("sentiment_score")))
            except Exception:
                urgency_score = None

            update_priority_fields_in_model_versions(
                complaint_id=complaint_id,
                existing_model_versions=existing_inf.get("model_versions"),
                priority_status="not_computed",
                priority_rank=None,
                priority_reason="Complaint could not be ranked in the submitted first-review queue.",
                priority_normalized={},
                priority_raw={},
                urgency_score=urgency_score,
                frequency_score=frequency_cache.get(complaint_id) if needs_frequency else None,
                priority_score=None,
            )
            cleared_count += 1

    # Clear stale queue metadata from complaints that are no longer in the submitted queue.
    for row in all_rows:
        status_clean = normalize_text(row.get("status") or "").lower()
        if status_clean == "submitted":
            continue

        complaint_id = str(row.get("id") or "")
        existing_inf = inference_map.get(complaint_id)
        if not existing_inf:
            continue

        update_priority_fields_in_model_versions(
            complaint_id=complaint_id,
            existing_model_versions=existing_inf.get("model_versions"),
            priority_status="not_in_queue",
            priority_rank=None,
            priority_reason="Complaint is not in the submitted first-review queue.",
            priority_normalized={},
            priority_raw={},
            urgency_score=None,
            frequency_score=None,
            priority_score=None,
        )
        cleared_count += 1

    return {
        "ranked_count": len(ranked_rows),
        "submitted_count": len(submitted_pool),
        "cleared_count": cleared_count,
        "updated_count": updated_count,
    }


def parse_iso_datetime(value: Any) -> datetime:
    if value is None or str(value).strip() == "":
        raise HTTPException(status_code=500, detail="Datetime value is required.")
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def get_complaint_coordinates(complaint: Dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    lat_raw = complaint.get("lat")
    lng_raw = complaint.get("lng")

    if lat_raw is None and "latitude" in complaint:
        lat_raw = complaint.get("latitude")
    if lng_raw is None and "longitude" in complaint:
        lng_raw = complaint.get("longitude")

    if lat_raw is None or lng_raw is None:
        return None, None

    try:
        return float(lat_raw), float(lng_raw)
    except (TypeError, ValueError):
        return None, None


def build_complaint_text(title: str, description: str) -> str:
    return normalize_text(f"{title}. {description}")


def get_effective_final_category(
    complaint: Dict[str, Any],
    inference_row: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    final_category = complaint.get("final_category")
    if final_category:
        return str(final_category)

    if inference_row and inference_row.get("fusion_label"):
        return str(inference_row.get("fusion_label"))

    return map_citizen_category_to_internal(complaint.get("user_category"))


def upsert_current_complaint_into_pool(
    pool: list[Dict[str, Any]],
    current_complaint: Dict[str, Any],
) -> list[Dict[str, Any]]:
    current_id = str(current_complaint.get("id") or "")
    updated_pool: list[Dict[str, Any]] = []
    replaced = False

    for row in pool:
        if str(row.get("id") or "") == current_id:
            updated_pool.append(current_complaint)
            replaced = True
        else:
            updated_pool.append(row)

    if not replaced:
        updated_pool.append(current_complaint)

    return updated_pool


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6371000.0

    phi1 = np.radians(lat1)
    phi2 = np.radians(lat2)
    delta_phi = np.radians(lat2 - lat1)
    delta_lambda = np.radians(lon2 - lon1)

    a = (
        np.sin(delta_phi / 2.0) ** 2
        + np.cos(phi1) * np.cos(phi2) * np.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))
    return float(earth_radius_m * c)

TEXT_EMBED_CACHE: dict[str, np.ndarray] = {}
MAX_TEXT_EMBED_CACHE = 1000


def parse_string_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, list):
                return [str(v).strip() for v in decoded if str(v).strip()]
        except json.JSONDecodeError:
            pass

        return [raw] if raw else []

    return []

def get_saved_duplicate_ids_from_inference(
    inference_row: Optional[Dict[str, Any]],
) -> list[str]:
    if not inference_row:
        return []

    model_versions = inference_row.get("model_versions") or {}
    return parse_string_list(model_versions.get("duplicate_ids"))

def patch_inference_model_versions(complaint_id: str, patch_data: Dict[str, Any]):
    existing_map = fetch_existing_inference_results_for_complaints([complaint_id])
    existing_inf = existing_map.get(complaint_id)

    merged_model_versions = dict((existing_inf or {}).get("model_versions") or {})
    merged_model_versions.update(patch_data)

    payload = {
        "model_versions": serialize_model_versions(merged_model_versions),
        "updated_at": iso(utc_now()),
    }

    if existing_inf:
        params = {"complaint_id": f"eq.{complaint_id}"}
        r = rest_patch("inference_results", payload, params=params)
        if r.status_code not in (200, 204):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to patch inference model_versions for complaint {complaint_id}: {r.status_code} {r.text}"
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
            detail=f"Failed to create inference row for complaint {complaint_id}: {r.status_code} {r.text}"
        )


def persist_duplicate_links_symmetrically(
    complaint_id: str,
    duplicate_ids: list[str],
):
    target_id = str(complaint_id)
    clean_duplicate_ids = sorted({str(v) for v in duplicate_ids if str(v).strip() and str(v) != target_id})

    patch_inference_model_versions(
        target_id,
        {
            "duplicate_ids": clean_duplicate_ids,
            "duplicate_count": len(clean_duplicate_ids),
            "duplicate_text_threshold": DUPLICATE_TEXT_THRESHOLD,
            "duplicate_location_radius_m": DUPLICATE_LOCATION_RADIUS_M,
            "duplicate_time_window_hours": DUPLICATE_TIME_WINDOW_HOURS,
            "duplicate_saved_at": iso(utc_now()),
        },
    )

    for other_id in clean_duplicate_ids:
        other_map = fetch_existing_inference_results_for_complaints([other_id])
        other_inf = other_map.get(other_id)
        other_saved_ids = get_saved_duplicate_ids_from_inference(other_inf)

        merged_other_ids = sorted({*other_saved_ids, target_id})
        patch_inference_model_versions(
            other_id,
            {
                "duplicate_ids": merged_other_ids,
                "duplicate_count": len(merged_other_ids),
                "duplicate_text_threshold": DUPLICATE_TEXT_THRESHOLD,
                "duplicate_location_radius_m": DUPLICATE_LOCATION_RADIUS_M,
                "duplicate_time_window_hours": DUPLICATE_TIME_WINDOW_HOURS,
                "duplicate_saved_at": iso(utc_now()),
            },
        )

def get_text_embedding_cached(text: str) -> np.ndarray:
    clean = normalize_text(text)
    if not clean:
        return np.array([], dtype=np.float32)

    cache_key = hashlib.sha1(clean.encode("utf-8")).hexdigest()

    cached = TEXT_EMBED_CACHE.get(cache_key)
    if cached is not None:
        return cached

    embedding = get_text_embedding(clean)

    if len(TEXT_EMBED_CACHE) >= MAX_TEXT_EMBED_CACHE:
        TEXT_EMBED_CACHE.clear()

    TEXT_EMBED_CACHE[cache_key] = embedding
    return embedding

def get_text_embedding(text: str) -> np.ndarray:
    tokenizer, model, _ = load_text_assets()
    device = next(model.parameters()).device

    encoded = tokenizer(
        text,
        truncation=True,
        padding="max_length",
        max_length=256,
        return_tensors="pt",
    )
    encoded = {k: v.to(device) for k, v in encoded.items()}

    with torch.no_grad():
        outputs = model(**encoded, output_hidden_states=True)
        cls_embedding = outputs.hidden_states[-1][:, 0, :].detach().cpu().numpy()

    return cls_embedding[0]


def detect_duplicates_for_complaint(
    target_complaint: Dict[str, Any],
    all_open_complaints: list[Dict[str, Any]],
    text_threshold: float,
    location_radius_m: float,
    time_window_hours: float,
) -> list[str]:
    target_lat, target_lng = get_complaint_coordinates(target_complaint)
    if target_lat is None or target_lng is None:
        return []

    target_text = build_complaint_text(
        target_complaint.get("title") or "",
        target_complaint.get("description") or "",
    )
    if not target_text:
        return []

    target_embedding = get_text_embedding_cached(target_text)
    if target_embedding.size == 0:
        return []

    target_embedding = target_embedding.reshape(1, -1)
    target_time = parse_iso_datetime(target_complaint.get("created_at"))
    max_time_delta_seconds = float(time_window_hours) * 3600.0

    duplicates: list[str] = []

    for other in all_open_complaints:
        other_id = str(other.get("id") or "")
        if other_id == str(target_complaint.get("id") or ""):
            continue

        other_lat, other_lng = get_complaint_coordinates(other)
        if other_lat is None or other_lng is None:
            continue

        distance_m = haversine_distance(target_lat, target_lng, other_lat, other_lng)
        if distance_m > float(location_radius_m):
            continue

        try:
            other_time = parse_iso_datetime(other.get("created_at"))
        except Exception:
            continue

        if abs((target_time - other_time).total_seconds()) > max_time_delta_seconds:
            continue

        other_text = build_complaint_text(
            other.get("title") or "",
            other.get("description") or "",
        )
        if not other_text:
            continue

        other_embedding = get_text_embedding_cached(other_text)
        if other_embedding.size == 0:
            continue

        similarity = float(
            cosine_similarity(
                target_embedding,
                other_embedding.reshape(1, -1),
            )[0][0]
        )

        if similarity > float(text_threshold):
            duplicates.append(other_id)

    return duplicates


def compute_frequency_score(
    complaint: Dict[str, Any],
    all_open_complaints: list[Dict[str, Any]],
    inference_map: Optional[dict[str, Dict[str, Any]]] = None,
    radius_m: float = FREQUENCY_RADIUS_M,
    days: float = FREQUENCY_TIME_WINDOW_DAYS,
) -> int:
    inference_map = inference_map or {}

    target_id = str(complaint.get("id") or "")
    target_lat, target_lng = get_complaint_coordinates(complaint)
    if target_lat is None or target_lng is None:
        return 0

    target_category = get_effective_final_category(
        complaint,
        inference_map.get(target_id),
    )
    if not target_category:
        return 0

    try:
        target_time = parse_iso_datetime(complaint.get("created_at"))
    except Exception:
        return 0

    max_age_seconds = float(days) * 86400.0
    count = 0

    for other in all_open_complaints:
        other_id = str(other.get("id") or "")
        if other_id == target_id:
            continue

        other_lat, other_lng = get_complaint_coordinates(other)
        if other_lat is None or other_lng is None:
            continue

        other_category = get_effective_final_category(
            other,
            inference_map.get(other_id),
        )
        if other_category != target_category:
            continue

        distance_m = haversine_distance(target_lat, target_lng, other_lat, other_lng)
        if distance_m > float(radius_m):
            continue

        try:
            other_time = parse_iso_datetime(other.get("created_at"))
        except Exception:
            continue

        if other_time > target_time:
            continue

        if (target_time - other_time).total_seconds() > max_age_seconds:
            continue

        count += 1

    return count


def find_hotspots(
    complaints: list[Dict[str, Any]],
    inference_map: Optional[dict[str, Dict[str, Any]]] = None,
    eps_meters: float = HOTSPOT_EPS_METERS,
    min_samples: int = HOTSPOT_MIN_SAMPLES,
) -> Dict[str, Any]:
    inference_map = inference_map or {}

    valid_complaints: list[Dict[str, Any]] = []
    coords: list[tuple[float, float]] = []

    for complaint in complaints:
        lat, lng = get_complaint_coordinates(complaint)
        if lat is None or lng is None:
            continue
        valid_complaints.append(complaint)
        coords.append((lat, lng))

    if len(valid_complaints) < int(min_samples):
        return {"type": "FeatureCollection", "features": []}

    n = len(coords)
    distance_matrix = np.zeros((n, n), dtype=float)

    for i in range(n):
        lat_i, lng_i = coords[i]
        for j in range(i + 1, n):
            lat_j, lng_j = coords[j]
            distance_m = haversine_distance(lat_i, lng_i, lat_j, lng_j)
            distance_matrix[i, j] = distance_m
            distance_matrix[j, i] = distance_m

    clustering = DBSCAN(
        eps=float(eps_meters),
        min_samples=int(min_samples),
        metric="precomputed",
    )
    labels = clustering.fit_predict(distance_matrix)

    features: list[Dict[str, Any]] = []
    for cluster_id in sorted(set(labels)):
        if int(cluster_id) == -1:
            continue

        member_indices = [idx for idx, label in enumerate(labels) if int(label) == int(cluster_id)]
        cluster_rows = [valid_complaints[idx] for idx in member_indices]
        cluster_lats = [coords[idx][0] for idx in member_indices]
        cluster_lngs = [coords[idx][1] for idx in member_indices]

        categories = sorted(
            {
                cat
                for cat in (
                    get_effective_final_category(
                        row,
                        inference_map.get(str(row.get("id") or "")),
                    )
                    for row in cluster_rows
                )
                if cat
            }
        )

        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        safe_float(float(np.mean(cluster_lngs))),
                        safe_float(float(np.mean(cluster_lats))),
                    ],
                },
                "properties": {
                    "cluster_id": int(cluster_id),
                    "count": len(cluster_rows),
                    "complaint_ids": [str(row.get("id")) for row in cluster_rows if row.get("id")],
                    "categories": categories,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }



def calculate_priority_exact(
    current_complaint: Dict[str, Any],
    current_fusion_confidence: float,
) -> Dict[str, Any]:
    """
    Exact-priority path:
    1) urgency from sentiment: U_i = (1 - s_i) / 2
    2) SAW normalization and ranking over the submitted first-review queue
    3) exact escalation condition based on elapsed time and unresolved status
    4) frequency is included when CIVICAI_SAW_CRITERIA_JSON contains complaint_frequency
    """
    try:
        criteria = get_saw_criteria()
        escalation_threshold_hours = get_escalation_threshold_hours()
    except HTTPException as e:
        return {
            "status": "not_computed",
            "reason": str(e.detail),
            "score": None,
            "rank": None,
            "urgency_score": None,
            "frequency_score": None,
            "normalized": {},
            "raw": {},
            "escalation": None,
            "escalation_status": None,
            "escalation_reason": None,
        }

    current_status = normalize_text(current_complaint.get("status") or "").lower()

    current_sentiment = current_complaint.get("sentiment_score")
    if current_sentiment is None:
        return {
            "status": "not_computed",
            "reason": "sentiment_score is required on complaints for the exact urgency formula.",
            "score": None,
            "rank": None,
            "urgency_score": None,
            "frequency_score": None,
            "normalized": {},
            "raw": {},
            "escalation": None,
            "escalation_status": None,
            "escalation_reason": None,
        }

    try:
        current_urgency = urgency_from_sentiment_exact(float(current_sentiment))
    except Exception:
        return {
            "status": "not_computed",
            "reason": "Current complaint sentiment_score is invalid.",
            "score": None,
            "rank": None,
            "urgency_score": None,
            "frequency_score": None,
            "normalized": {},
            "raw": {},
            "escalation": None,
            "escalation_status": None,
            "escalation_reason": None,
        }

    escalation = should_escalate_exact(
        created_at_iso=str(current_complaint.get("created_at")),
        current_status=str(current_complaint.get("status") or ""),
        escalation_threshold_hours=escalation_threshold_hours,
    )

    escalation_status = (
        "escalate_now"
        if escalation.get("should_escalate")
        else "within_threshold"
    )

    escalation_reason = (
        f"Elapsed hours: {escalation.get('elapsed_hours')} | "
        f"Threshold: {escalation.get('threshold_hours')} | "
        f"Status: {current_complaint.get('status') or 'unknown'}"
    )

    if current_status != "submitted":
        return {
            "status": "not_in_queue",
            "reason": "Complaint is not in the submitted first-review queue.",
            "score": None,
            "rank": None,
            "urgency_score": safe_float(current_urgency),
            "frequency_score": None,
            "normalized": {},
            "raw": {},
            "escalation": escalation,
            "escalation_status": escalation_status,
            "escalation_reason": escalation_reason,
        }

    current_id = str(current_complaint.get("id") or "")

    submitted_pool = get_open_complaint_rows(limit=500, active_statuses=["submitted"])
    active_pool = get_open_complaint_rows(limit=500, active_statuses=["submitted", "processing"])

    submitted_pool = upsert_current_complaint_into_pool(submitted_pool, current_complaint)
    active_pool = upsert_current_complaint_into_pool(active_pool, current_complaint)

    complaint_lookup = {
        str(row.get("id")): row
        for row in (submitted_pool + active_pool + [current_complaint])
        if row.get("id")
    }

    complaint_ids = list(complaint_lookup.keys())
    inference_map = fetch_existing_inference_results_for_complaints(complaint_ids)

    needs_frequency = any(criterion["field"] == "complaint_frequency" for criterion in criteria)
    frequency_cache: dict[str, int] = {}

    if needs_frequency:
        for row in submitted_pool:
            row_id = str(row.get("id") or "")
            frequency_cache[row_id] = compute_frequency_score(
                complaint=row,
                all_open_complaints=active_pool,
                inference_map=inference_map,
                radius_m=FREQUENCY_RADIUS_M,
                days=FREQUENCY_TIME_WINDOW_DAYS,
            )

    required_fields = {criterion["field"] for criterion in criteria}
    alternatives: list[dict[str, Any]] = []

    for row in submitted_pool:
        complaint_id = str(row.get("id") or "")
        sentiment_score = row.get("sentiment_score")

        if sentiment_score is None:
            continue

        try:
            urgency_score = urgency_from_sentiment_exact(float(sentiment_score))
            elapsed_hours = calculate_elapsed_hours(str(row.get("created_at")))
        except Exception:
            continue

        if complaint_id == current_id:
            fusion_confidence = float(current_fusion_confidence)
        else:
            existing_inf = inference_map.get(complaint_id) or {}
            fusion_conf_raw = existing_inf.get("fusion_confidence")
            if fusion_conf_raw is None:
                continue
            fusion_confidence = float(fusion_conf_raw)

        alternative = {
            "id": complaint_id,
            "urgency_score": safe_float(urgency_score),
            "fusion_confidence": safe_float(fusion_confidence),
            "elapsed_hours": safe_float(elapsed_hours),
        }

        if needs_frequency:
            alternative["complaint_frequency"] = int(frequency_cache.get(complaint_id, 0))

        if all(alternative.get(field) is not None for field in required_fields):
            alternatives.append(alternative)

    current_frequency_score = frequency_cache.get(current_id) if needs_frequency else None

    if not alternatives:
        return {
            "status": "not_computed",
            "reason": "No valid submitted complaint pool available for exact SAW ranking.",
            "score": None,
            "rank": None,
            "urgency_score": safe_float(current_urgency),
            "frequency_score": current_frequency_score,
            "normalized": {},
            "raw": {},
            "escalation": escalation,
            "escalation_status": escalation_status,
            "escalation_reason": escalation_reason,
        }

    scored_rows = compute_saw_scores_exact(alternatives, criteria)
    scored_rows = sort_scored_rows_for_queue(scored_rows, complaint_lookup)

    current_row = next((row for row in scored_rows if row["id"] == current_id), None)

    if current_row is None:
        return {
            "status": "not_computed",
            "reason": "Current complaint could not be ranked in the submitted first-review queue.",
            "score": None,
            "rank": None,
            "urgency_score": safe_float(current_urgency),
            "frequency_score": current_frequency_score,
            "normalized": {},
            "raw": {},
            "escalation": escalation,
            "escalation_status": escalation_status,
            "escalation_reason": escalation_reason,
        }

    raw_values = dict(current_row["raw"])
    normalized_values = dict(current_row["normalized"])

    if needs_frequency and current_frequency_score is None:
        current_frequency_score = int(raw_values.get("complaint_frequency", 0))

    return {
        "status": "computed",
        "reason": None,
        "score": safe_float(current_row["score"]),
        "rank": int(current_row["rank"]),
        "urgency_score": safe_float(current_urgency),
        "frequency_score": current_frequency_score,
        "normalized": normalized_values,
        "raw": raw_values,
        "escalation": escalation,
        "escalation_status": escalation_status,
        "escalation_reason": escalation_reason,
    }


def build_quality_flags(
    text_result: Dict[str, Any],
    image_result: Dict[str, Any],
    decision_result: Dict[str, Any],
    priority_result: Dict[str, Any],
    citizen_ai_conflict: bool,
) -> list[str]:
    flags: list[str] = []

    if text_result.get("is_text_only_label"):
        flags.append("text_only_category")

    if not image_result.get("labels"):
        flags.append("no_image_detection")

    if not image_result.get("has_shared_signal"):
        flags.append("no_shared_image_signal")

    if decision_result.get("used_exact_multimodal_fusion"):
        flags.append("exact_shared_fusion_applied")
    else:
        flags.append("exact_shared_fusion_not_applied")

    if priority_result.get("status") != "computed":
        flags.append("exact_priority_not_computed")

    if citizen_ai_conflict:
        flags.append("citizen_ai_mismatch")

    return flags


def assess_ai_reliability(
    text_result: Dict[str, Any],
    image_result: Dict[str, Any],
    decision_result: Dict[str, Any],
    priority_result: Dict[str, Any],
    citizen_ai_conflict: bool,
) -> Dict[str, Any]:
    quality_flags = build_quality_flags(
        text_result=text_result,
        image_result=image_result,
        decision_result=decision_result,
        priority_result=priority_result,
        citizen_ai_conflict=citizen_ai_conflict,
    )

    has_exact_fusion = bool(decision_result.get("used_exact_multimodal_fusion"))
    is_text_only_label = bool(text_result.get("is_text_only_label"))
    has_shared_image_signal = bool(image_result.get("has_shared_signal"))
    has_text_label = bool(text_result.get("label"))

    if not has_text_label and not has_shared_image_signal:
        reliability_status = "insufficient_evidence"
        manual_review_required = True
    elif citizen_ai_conflict:
        reliability_status = "manual_review_needed"
        manual_review_required = True
    elif has_exact_fusion:
        reliability_status = "reliable"
        manual_review_required = False
    elif is_text_only_label:
        reliability_status = "reliable"
        manual_review_required = False
    else:
        reliability_status = "manual_review_needed"
        manual_review_required = True

    return {
        "reliability_status": reliability_status,
        "manual_review_required": manual_review_required,
        "quality_flags": quality_flags,
    }
    


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

    sentiment_score = compute_sentiment_score(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
    )
    update_complaint_sentiment_score(complaint_id, sentiment_score)
    complaint["sentiment_score"] = sentiment_score

    citizen_category_raw = complaint.get("user_category")
    citizen_category_internal = map_citizen_category_to_internal(citizen_category_raw)

    text_result = run_text_inference(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
    )

    image_result = run_image_inference(
        public_url=media.get("public_url") if media else None
    )

    decision_result = resolve_final_prediction(text_result, image_result)
    complaint["final_category"] = decision_result.get("final_label")

    summary = simple_summary(
        title=complaint.get("title") or "",
        description=complaint.get("description") or "",
        final_label=decision_result["final_label"],
        image_labels=image_result.get("labels") or [],
        decision_mode=decision_result["decision_mode"],
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
        and decision_result.get("final_label")
        and citizen_category_internal != decision_result.get("final_label")
    )

    # Build the active pool once.
    pool = get_open_complaint_rows(limit=500)
    pool = upsert_current_complaint_into_pool(pool, complaint)
    complaint_ids = [str(row.get("id")) for row in pool if row.get("id")]
    inference_map = fetch_existing_inference_results_for_complaints(complaint_ids)

    duplicate_ids = detect_duplicates_for_complaint(
    target_complaint=complaint,
    all_open_complaints=pool,
    text_threshold=DUPLICATE_TEXT_THRESHOLD,
    location_radius_m=DUPLICATE_LOCATION_RADIUS_M,
    time_window_hours=DUPLICATE_TIME_WINDOW_HOURS,
    )
    duplicate_count = len(duplicate_ids)

    persist_duplicate_links_symmetrically(
    complaint_id=complaint_id,
    duplicate_ids=duplicate_ids,
    )

    # Keep frequency + current complaint ranking, but do not do live duplicate
    # detection or global queue recompute inside the blocking AI request.
    frequency_score = compute_frequency_score(
        complaint=complaint,
        all_open_complaints=pool,
        inference_map=inference_map,
        radius_m=FREQUENCY_RADIUS_M,
        days=FREQUENCY_TIME_WINDOW_DAYS,
    )

    priority_result = calculate_priority_exact(
        current_complaint=complaint,
        current_fusion_confidence=float(decision_result.get("final_confidence") or 0.0),
    )

    reliability = assess_ai_reliability(
        text_result=text_result,
        image_result=image_result,
        decision_result=decision_result,
        priority_result=priority_result,
        citizen_ai_conflict=citizen_ai_conflict,
    )

    # Preserve already-saved duplicate IDs instead of recomputing them live here.
    existing_current_inference = inference_map.get(complaint_id)
    duplicate_ids = get_saved_duplicate_ids_from_inference(existing_current_inference)
    duplicate_count = len(duplicate_ids)

    model_versions_payload = serialize_model_versions({
        "text_model": "roberta-base-local-finetuned",
        "image_model": "yolo-best-pt-local",
        "shared_fusion_space_size": len(SHARED_FUSION_LABELS),
        "shared_fusion_labels": SHARED_FUSION_LABELS,
        "fusion_strategy": "exact_weighted_late_fusion_shared_8",
        "priority_strategy": "exact_urgency_plus_saw_ranking",
        "decision_mode": decision_result.get("decision_mode"),
        "used_exact_multimodal_fusion": decision_result.get("used_exact_multimodal_fusion"),
        "reliability_status": reliability["reliability_status"],
        "manual_review_required": reliability["manual_review_required"],
        "quality_flags": ", ".join(reliability["quality_flags"]) if reliability["quality_flags"] else "none",
        "citizen_ai_conflict": citizen_ai_conflict,
        "text_label_full_18": text_result.get("label"),
        "text_confidence_full_18": text_result.get("confidence") or 0.0,
        "text_shared_label": text_result.get("shared_label") or "",
        "text_shared_confidence": text_result.get("shared_confidence") or 0.0,
        "image_top_shared_label": image_result.get("top_shared_label") or "",
        "image_top_shared_probability": image_result.get("top_shared_probability") or 0.0,
        "text_weight": decision_result.get("weights", {}).get("text", 1.0),
        "image_weight": decision_result.get("weights", {}).get("image", 0.0),
        "priority_status": priority_result.get("status"),
        "priority_rank": priority_result.get("rank"),
        "priority_reason": priority_result.get("reason"),
        "priority_normalized": priority_result.get("normalized"),
        "priority_raw": priority_result.get("raw"),
        "urgency_score": priority_result.get("urgency_score"),
        "frequency_score": priority_result.get("frequency_score", frequency_score),
        "duplicate_count": duplicate_count,
        "duplicate_ids": duplicate_ids,
        "duplicate_mode": "saved_cache_only",
        "duplicate_text_threshold": DUPLICATE_TEXT_THRESHOLD,
        "duplicate_location_radius_m": DUPLICATE_LOCATION_RADIUS_M,
        "duplicate_time_window_hours": DUPLICATE_TIME_WINDOW_HOURS,
        "frequency_radius_m": FREQUENCY_RADIUS_M,
        "frequency_time_window_days": FREQUENCY_TIME_WINDOW_DAYS,
        "escalation": priority_result.get("escalation"),
        "escalation_status": priority_result.get("escalation_status"),
        "escalation_reason": priority_result.get("escalation_reason"),
    })

    save_payload = {
        "text_label": text_result.get("label"),
        "text_confidence": text_result.get("confidence"),
        "image_labels": image_result.get("labels"),
        "image_confidences": image_result.get("confidences"),
        "image_boxes": image_result.get("boxes"),
        "fusion_label": decision_result.get("final_label"),
        "fusion_confidence": decision_result.get("final_confidence"),
        "conflict_flag": False,
        "priority_score": priority_result.get("score"),
        "priority": None,
        "summary": summary,
        "detected_image_url": detected_image_url,
        "detected_image_path": detected_image_path,
        "updated_at": iso(utc_now()),
        "model_versions": model_versions_payload,
    }

    upsert_inference_result(complaint_id, save_payload)

    update_complaint_category_if_empty(
        complaint_id=complaint_id,
        final_category=decision_result.get("final_label"),
        category_source="ai",
    )

    return {
        "ok": True,
        "complaint_id": complaint_id,
        "citizen_category": citizen_category_raw,
        "citizen_category_internal": citizen_category_internal,
        "citizen_ai_conflict": citizen_ai_conflict,
        "duplicate_ids": duplicate_ids,
        "duplicate_count": duplicate_count,
        "duplicate_mode": "saved_cache_only",
        "frequency_score": frequency_score,
        "text_result": {
            "label_full_18": text_result.get("label"),
            "confidence_full_18": text_result.get("confidence"),
            "shared_label": text_result.get("shared_label"),
            "shared_confidence": text_result.get("shared_confidence"),
            "is_text_only_label": text_result.get("is_text_only_label"),
        },
        "image_result": {
            "labels": image_result.get("labels"),
            "confidences": image_result.get("confidences"),
            "boxes": image_result.get("boxes"),
            "top_shared_label": image_result.get("top_shared_label"),
            "top_shared_probability": image_result.get("top_shared_probability"),
            "has_shared_signal": image_result.get("has_shared_signal"),
            "detected_image_url": detected_image_url,
        },
        "decision_result": decision_result,
        "priority_result": priority_result,
        "queue_recompute": {
            "ok": False,
            "skipped": True,
            "reason": "Global queue recompute is skipped during AI run for speed. Queue recompute still runs on authority save and can be triggered manually via /priority/recompute.",
        },
        "summary": summary,
        "reliability_status": reliability["reliability_status"],
        "manual_review_required": reliability["manual_review_required"],
        "quality_flags": reliability["quality_flags"],
    }

@app.post("/priority/recompute")
def recompute_priority_queue():
    require_backend_env()
    result = recompute_priority_ranks_for_queue(limit=500)
    return {
        "ok": True,
        **result,
    }

@app.get("/analytics/hotspots")
def get_hotspots(
    eps: Optional[float] = Query(None, description="Cluster radius in meters. Defaults to HOTSPOT_EPS_METERS."),
    min_samples: Optional[int] = Query(None, description="Minimum points per cluster. Defaults to HOTSPOT_MIN_SAMPLES."),
):
    require_backend_env()

    pool = get_open_complaint_rows(limit=500)
    complaint_ids = [str(row.get("id")) for row in pool if row.get("id")]
    inference_map = fetch_existing_inference_results_for_complaints(complaint_ids)

    return find_hotspots(
        complaints=pool,
        inference_map=inference_map,
        eps_meters=eps if eps is not None else HOTSPOT_EPS_METERS,
        min_samples=min_samples if min_samples is not None else HOTSPOT_MIN_SAMPLES,
    )


@app.get("/complaints/{complaint_id}/duplicates")
def get_duplicates_for_complaint(
    complaint_id: str,
    refresh: bool = Query(
        False,
        description="If true, recompute duplicates live and save them back into inference_results. Otherwise return saved duplicate IDs from inference_results."
    ),
):
    require_backend_env()

    complaint = get_complaint_row(complaint_id)

    existing_map = fetch_existing_inference_results_for_complaints([complaint_id])
    existing_inf = existing_map.get(complaint_id)

    saved_duplicate_ids: list[str] = []
    if existing_inf:
        model_versions = existing_inf.get("model_versions") or {}
        saved_duplicate_ids = parse_string_list(model_versions.get("duplicate_ids"))

    if not refresh:
        return {
            "complaint_id": complaint_id,
            "duplicate_count": len(saved_duplicate_ids),
            "duplicate_ids": saved_duplicate_ids,
            "text_threshold": DUPLICATE_TEXT_THRESHOLD,
            "location_radius_m": DUPLICATE_LOCATION_RADIUS_M,
            "time_window_hours": DUPLICATE_TIME_WINDOW_HOURS,
            "source": "saved_inference",
        }

    pool = get_open_complaint_rows(limit=500)
    pool = upsert_current_complaint_into_pool(pool, complaint)

    live_duplicate_ids = detect_duplicates_for_complaint(
        target_complaint=complaint,
        all_open_complaints=pool,
        text_threshold=DUPLICATE_TEXT_THRESHOLD,
        location_radius_m=DUPLICATE_LOCATION_RADIUS_M,
        time_window_hours=DUPLICATE_TIME_WINDOW_HOURS,
    )

    persist_duplicate_links_symmetrically(
        complaint_id=complaint_id,
        duplicate_ids=live_duplicate_ids,
    )

    return {
        "complaint_id": complaint_id,
        "duplicate_count": len(live_duplicate_ids),
        "duplicate_ids": live_duplicate_ids,
        "text_threshold": DUPLICATE_TEXT_THRESHOLD,
        "location_radius_m": DUPLICATE_LOCATION_RADIUS_M,
        "time_window_hours": DUPLICATE_TIME_WINDOW_HOURS,
        "source": "live_refresh_saved",
    }