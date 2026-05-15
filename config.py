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
