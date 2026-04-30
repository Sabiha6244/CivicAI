import os
from pathlib import Path
from huggingface_hub import snapshot_download


def get_hf_model_paths() -> tuple[str, str]:
    hf_model_repo_id = os.getenv("HF_MODEL_REPO_ID")
    hf_token = os.getenv("HF_TOKEN")
    hf_text_model_dir = os.getenv("HF_TEXT_MODEL_DIR", "text")
    hf_yolo_model_file = os.getenv("HF_YOLO_MODEL_FILE", "yolo/best.pt")
    hf_cache_dir = Path(os.getenv("HF_CACHE_DIR", "./hf_cache"))

    if not hf_model_repo_id:
        raise RuntimeError("HF_MODEL_REPO_ID is missing in .env")

    if not hf_token:
        raise RuntimeError("HF_TOKEN is missing in .env")

    local_repo_dir = hf_cache_dir / hf_model_repo_id.replace("/", "__")
    local_repo_dir.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=hf_model_repo_id,
        token=hf_token,
        local_dir=str(local_repo_dir),
        allow_patterns=[
            f"{hf_text_model_dir}/*",
            hf_yolo_model_file,
        ],
    )

    text_model_path = local_repo_dir / hf_text_model_dir
    yolo_model_path = local_repo_dir / hf_yolo_model_file

    if not text_model_path.exists():
        raise FileNotFoundError(f"Text model folder not found: {text_model_path}")

    if not yolo_model_path.exists():
        raise FileNotFoundError(f"YOLO model file not found: {yolo_model_path}")

    return str(text_model_path), str(yolo_model_path)