import json
import os
from config import SETTINGS_FILE, DEFAULT_SETTINGS


def load_settings() -> dict:
    if not os.path.exists(SETTINGS_FILE):
        save_settings(DEFAULT_SETTINGS)
        return dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_FILE, "r") as f:
            data = json.load(f)
            merged = dict(DEFAULT_SETTINGS)
            merged.update(data)
            return merged
    except (json.JSONDecodeError, IOError):
        return dict(DEFAULT_SETTINGS)


def save_settings(settings: dict) -> dict:
    merged = dict(DEFAULT_SETTINGS)
    merged.update(settings)
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged
