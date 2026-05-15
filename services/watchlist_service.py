import json
import os
from datetime import datetime
from config import WATCHLIST_FILE


def load_watchlist() -> list[dict]:
    if not os.path.exists(WATCHLIST_FILE):
        return []
    try:
        with open(WATCHLIST_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_watchlist(watchlist: list[dict]):
    os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
    with open(WATCHLIST_FILE, "w") as f:
        json.dump(watchlist, f, ensure_ascii=False, indent=2)


def add_stock(code: str, name: str) -> bool:
    watchlist = load_watchlist()
    if any(s["code"] == code for s in watchlist):
        return False
    watchlist.append({
        "code": code,
        "name": name,
        "added_at": datetime.now().isoformat(),
    })
    save_watchlist(watchlist)
    return True


def remove_stock(code: str) -> bool:
    watchlist = load_watchlist()
    new_watchlist = [s for s in watchlist if s["code"] != code]
    if len(new_watchlist) == len(watchlist):
        return False
    save_watchlist(new_watchlist)
    return True
