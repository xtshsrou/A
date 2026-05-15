import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
WATCHLIST_FILE = os.path.join(DATA_DIR, "watchlist.json")
ALERTS_FILE = os.path.join(DATA_DIR, "alerts.json")

MARKET_OPEN = (9, 30)
MARKET_CLOSE = (15, 0)

FETCH_INTERVAL_MINUTES = 5
CHECK_INTERVAL_MINUTES = 5

PULLBACK_LOOKBACK_DAYS = 60
MAX_ALERTS = 200

_ENV_WATCHLIST = os.environ.get("WATCHLIST_DEFAULT", "")
ENV_WATCHLIST: list[dict] = []
if _ENV_WATCHLIST:
    for pair in _ENV_WATCHLIST.split(","):
        pair = pair.strip()
        if "=" in pair:
            code, name = pair.split("=", 1)
            ENV_WATCHLIST.append({"code": code.strip(), "name": name.strip()})
        elif pair:
            ENV_WATCHLIST.append({"code": pair, "name": ""})

INDICATOR_WEIGHTS = {
    "ma_support": 0.25,
    "retracement": 0.30,
    "rsi": 0.20,
    "kdj": 0.15,
    "volume": 0.10,
}

RETRACEMENT_THRESHOLDS = {
    "strong": 0.30,
    "moderate": 0.20,
    "mild": 0.10,
}

SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

DEFAULT_SETTINGS = {
    "rally_lookback": 20,
    "rally_min_single_gain": 6.0,
    "rally_min_cumulative_gain": 12.0,
    "rally_volume_increase": 1.3,
    "pullback_min_days": 2,
    "pullback_max_days": 5,
    "pullback_ma_proximity": 3.0,
    "consolidation_min_days": 5,
    "consolidation_max_days": 15,
    "consolidation_box_position": 20.0,
    "volume_shrink_threshold": 0.8,
}

PATTERN_LABELS = {
    "short_term_pullback": "短线回调",
    "box_consolidation": "横盘洗盘",
    "monitoring": "待确认",
    "none": "无信号",
}

PATTERN_LEVELS = {
    "short_term_pullback": "watch",
    "box_consolidation": "watch",
}
