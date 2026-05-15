import logging
import numpy as np
import pandas as pd
from typing import Optional

logger = logging.getLogger(__name__)


def calc_ma(df: pd.DataFrame, periods: list[int] = [5, 10, 20, 60]) -> dict:
    result = {}
    for p in periods:
        col = f"ma{p}"
        if len(df) >= p:
            result[col] = round(df["close"].rolling(p).mean().iloc[-1], 2)
        else:
            result[col] = None
    return result


def calc_rsi(df: pd.DataFrame, period: int = 14):
    if len(df) < period + 1:
        return None
    delta = df["close"].diff()
    gain = delta.where(delta > 0, 0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return round(rsi.iloc[-1], 2) if not pd.isna(rsi.iloc[-1]) else None


def calc_kdj(df: pd.DataFrame, period: int = 9) -> dict:
    if len(df) < period:
        return {"k": None, "d": None, "j": None}
    low_min = df["low"].rolling(period).min()
    high_max = df["high"].rolling(period).max()
    rsv = (df["close"] - low_min) / (high_max - low_min).replace(0, np.nan) * 100
    k = rsv.ewm(com=2).mean()
    d = k.ewm(com=2).mean()
    j = 3 * k - 2 * d
    return {
        "k": round(k.iloc[-1], 2) if not pd.isna(k.iloc[-1]) else None,
        "d": round(d.iloc[-1], 2) if not pd.isna(d.iloc[-1]) else None,
        "j": round(j.iloc[-1], 2) if not pd.isna(j.iloc[-1]) else None,
    }


def calc_bollinger(df: pd.DataFrame, period: int = 20) -> dict:
    if len(df) < period:
        return {"upper": None, "middle": None, "lower": None}
    sma = df["close"].rolling(period).mean()
    std = df["close"].rolling(period).std()
    return {
        "upper": round((sma + 2 * std).iloc[-1], 2),
        "middle": round(sma.iloc[-1], 2),
        "lower": round((sma - 2 * std).iloc[-1], 2),
    }


def calc_retracement(df: pd.DataFrame, lookback: int = 60) -> dict:
    recent = df.tail(lookback)
    high_60d = recent["high"].max()
    current = df["close"].iloc[-1]
    retrace_pct = round((high_60d - current) / high_60d * 100, 2) if high_60d > 0 else 0
    near_high_pct = round((current / high_60d - 1) * 100, 2)

    high_20d = recent.tail(20)["high"].max()
    retrace_20d = round((high_20d - current) / high_20d * 100, 2) if high_20d > 0 else 0

    return {
        "high_60d": round(high_60d, 2),
        "retrace_60d": retrace_pct,
        "near_high_pct": near_high_pct,
        "high_20d": round(high_20d, 2) if not pd.isna(high_20d) else None,
        "retrace_20d": retrace_20d,
    }


def calc_volume_analysis(df: pd.DataFrame) -> dict:
    if len(df) < 20:
        return {"vol_ma5": None, "vol_ma20": None, "vol_ratio": None, "is_shrinking": False}
    vol_ma5 = df["volume"].tail(5).mean()
    vol_ma20 = df["volume"].tail(20).mean()
    current_vol = df["volume"].iloc[-1]
    vol_ratio = round(current_vol / vol_ma20, 2) if vol_ma20 > 0 else 0

    recent_5 = df["volume"].tail(5).tolist()
    is_shrinking = all(recent_5[i] < recent_5[i - 1] for i in range(1, len(recent_5))) if len(recent_5) >= 2 else False

    return {
        "vol_ma5": round(vol_ma5, 0),
        "vol_ma20": round(vol_ma20, 0),
        "vol_ratio": vol_ratio,
        "is_shrinking": is_shrinking,
    }


def calc_all_indicators(df: pd.DataFrame, lookback: int = 60) -> dict:
    ma = calc_ma(df)
    rsi = calc_rsi(df)
    kdj = calc_kdj(df)
    bollinger = calc_bollinger(df)
    retracement = calc_retracement(df, lookback)
    volume = calc_volume_analysis(df)

    current_price = df["close"].iloc[-1]
    today_change = round((df["close"].iloc[-1] - df["close"].iloc[-2]) / df["close"].iloc[-2] * 100, 2) if len(df) >= 2 else 0

    recent_5d = df.tail(5)
    gains = recent_5d["close"].diff().dropna()
    recent_trend = "up" if gains.sum() > 0 else "down" if gains.sum() < 0 else "flat"

    recent_high_5d = recent_5d["high"].max()
    recent_low_5d = recent_5d["low"].min()

    return {
        "price": round(current_price, 2),
        "today_change": today_change,
        "ma": ma,
        "rsi": rsi,
        "kdj": kdj,
        "bollinger": bollinger,
        "retracement": retracement,
        "volume": volume,
        "recent_trend": recent_trend,
        "recent_high_5d": round(recent_high_5d, 2),
        "recent_low_5d": round(recent_low_5d, 2),
    }


def detect_rally(df: pd.DataFrame, settings: dict) -> Optional[dict]:
    lookback = int(settings.get("rally_lookback", 20))
    min_single = float(settings.get("rally_min_single_gain", 6.0))
    min_cumulative = float(settings.get("rally_min_cumulative_gain", 12.0))
    vol_increase = float(settings.get("rally_volume_increase", 1.3))

    if len(df) < lookback:
        return None
    recent = df.tail(lookback).copy()
    daily_returns = recent["close"].pct_change() * 100

    peak_idx = recent["close"].idxmax()
    peak_pos = recent.index.get_loc(peak_idx)
    peak_price = recent.loc[peak_idx, "close"]

    valley_pos = peak_pos
    for i in range(peak_pos - 1, -1, -1):
        if recent.iloc[i]["close"] < recent.iloc[valley_pos]["close"]:
            valley_pos = i
        elif recent.iloc[i]["close"] > recent.iloc[valley_pos]["close"]:
            if valley_pos != peak_pos:
                search_start = max(0, valley_pos - 3)
                valley_pos = recent.iloc[search_start:valley_pos + 1]["close"].idxmin()
                valley_pos = recent.index.get_loc(valley_pos)
            break

    if valley_pos == peak_pos:
        valley_pos = max(0, peak_pos - 5)

    start_price = recent.iloc[valley_pos]["close"]
    cumulative_gain = (peak_price - start_price) / start_price * 100 if start_price > 0 else 0

    has_limit_up = (daily_returns >= 9.5).any()
    max_single = daily_returns.max()

    pre_vol = recent.iloc[:valley_pos]["volume"].mean() if valley_pos > 2 else 0
    rally_vol = recent.iloc[valley_pos:peak_pos + 1]["volume"].mean()
    vol_ratio = rally_vol / pre_vol if pre_vol > 0 else 1

    if not (cumulative_gain >= min_cumulative and (has_limit_up or max_single >= min_single) and vol_ratio >= vol_increase):
        return None

    return {
        "rally_start_idx": int(valley_pos),
        "rally_end_idx": int(peak_pos),
        "rally_start_price": round(start_price, 2),
        "rally_peak_price": round(peak_price, 2),
        "cumulative_gain": round(cumulative_gain, 2),
        "has_limit_up": bool(has_limit_up),
        "max_single_day_gain": round(float(max_single), 2),
        "avg_volume_rally": round(float(rally_vol), 0),
        "avg_volume_pre_rally": round(float(pre_vol), 0),
        "volume_ratio": round(float(vol_ratio), 2),
    }


def detect_patterns(df: pd.DataFrame, rally: Optional[dict], settings: dict) -> dict:
    if rally is None:
        return {"pattern": "none", "label": "无信号", "signal": "", "signal_strength": "normal"}

    lookback = int(settings.get("rally_lookback", 20))
    vol_shrink = float(settings.get("volume_shrink_threshold", 0.8))
    pullback_min = int(settings.get("pullback_min_days", 2))
    pullback_max = int(settings.get("pullback_max_days", 5))
    ma_proximity = float(settings.get("pullback_ma_proximity", 3.0))
    cons_min = int(settings.get("consolidation_min_days", 5))
    cons_max = int(settings.get("consolidation_max_days", 15))
    box_pos = float(settings.get("consolidation_box_position", 20.0))

    recent = df.tail(lookback).copy()
    rally_end = rally["rally_end_idx"]
    if rally_end >= len(recent) - 1:
        return {"pattern": "monitoring", "label": "待确认", "signal": "拉升进行中", "signal_strength": "normal"}

    post = recent.iloc[rally_end + 1:].copy()
    if len(post) < 2:
        return {"pattern": "monitoring", "label": "待确认", "signal": "等待回调", "signal_strength": "normal"}

    current_price = recent.iloc[-1]["close"]
    current_vol = recent.iloc[-1]["volume"]
    rally_peak = rally["rally_peak_price"]
    rally_avg_vol = rally["avg_volume_rally"]
    post_days = len(post)

    vol_vs_rally = current_vol / rally_avg_vol if rally_avg_vol > 0 else 1

    # --- Pattern 1: Short-term pullback ---
    if pullback_min <= post_days <= pullback_max:
        retrace_pct = (rally_peak - current_price) / rally_peak * 100
        if retrace_pct > 1:
            ma5 = recent["close"].rolling(5).mean().iloc[-1]
            ma10 = recent["close"].rolling(10).mean().iloc[-1]
            dist_to_ma5 = abs(current_price - ma5) / ma5 * 100 if ma5 > 0 else 999
            dist_to_ma10 = abs(current_price - ma10) / ma10 * 100 if ma10 > 0 else 999

            near_ma = dist_to_ma5 <= ma_proximity or dist_to_ma10 <= ma_proximity
            vol_shrinking = vol_vs_rally <= vol_shrink
            recent_lows = post["low"].tail(min(3, len(post)))
            no_new_low = recent_lows.iloc[-1] >= recent_lows.min()

            if near_ma and vol_shrinking and no_new_low and retrace_pct >= 2:
                support = ma5 if dist_to_ma5 <= ma_proximity else ma10
                support_type = "MA5" if dist_to_ma5 <= ma_proximity else "MA10"
                strength = "strong" if (vol_vs_rally < 0.5 and retrace_pct >= 5) else "watch"
                return {
                    "pattern": "short_term_pullback",
                    "label": "短线回调",
                    "pullback_days": post_days,
                    "retrace_pct": round(retrace_pct, 2),
                    "support_level": round(support, 2),
                    "support_type": support_type,
                    "volume_shrink_ratio": round(vol_vs_rally, 2),
                    "signal": "低吸信号",
                    "signal_strength": strength,
                }

    # --- Pattern 2: Box consolidation ---
    if cons_min <= post_days <= cons_max:
        retrace_pct = (rally_peak - current_price) / rally_peak * 100
        box_high = post["high"].max()
        box_low = post["low"].min()
        box_range = (box_high - box_low) / box_low * 100 if box_low > 0 else 0

        if box_range < 25 and retrace_pct > 0:
            pos_in_box = (current_price - box_low) / (box_high - box_low) * 100 if box_high > box_low else 50
            near_bottom = pos_in_box <= box_pos
            post_avg_vol = post["volume"].mean()
            vol_shrinking = post_avg_vol / rally_avg_vol <= vol_shrink if rally_avg_vol > 0 else False
            recent_lows = post["low"].tail(min(4, len(post)))
            no_new_low = recent_lows.iloc[-1] >= recent_lows.min()

            if near_bottom and vol_shrinking and no_new_low:
                strength = "strong" if (vol_vs_rally < 0.4 and near_bottom and retrace_pct >= 5) else "watch"
                return {
                    "pattern": "box_consolidation",
                    "label": "横盘洗盘",
                    "consolidation_days": post_days,
                    "box_high": round(box_high, 2),
                    "box_low": round(box_low, 2),
                    "box_range_pct": round(box_range, 2),
                    "position_in_box": round(pos_in_box, 1),
                    "retrace_pct": round(retrace_pct, 2),
                    "support_level": round(box_low, 2),
                    "support_type": "箱体下沿",
                    "volume_shrink_ratio": round(vol_vs_rally, 2),
                    "signal": "低吸信号",
                    "signal_strength": strength,
                }
            if near_bottom and not vol_shrinking:
                return {
                    "pattern": "box_consolidation",
                    "label": "横盘洗盘",
                    "consolidation_days": post_days,
                    "box_high": round(box_high, 2),
                    "box_low": round(box_low, 2),
                    "box_range_pct": round(box_range, 2),
                    "position_in_box": round(pos_in_box, 1),
                    "support_level": round(box_low, 2),
                    "support_type": "箱体下沿",
                    "signal": "等待缩量",
                    "signal_strength": "normal",
                }

    # --- Monitoring (rally detected, waiting for pattern) ---
    return {
        "pattern": "monitoring",
        "label": "待确认",
        "pullback_days": post_days,
        "signal": f"拉升后第{post_days}天",
        "signal_strength": "normal",
    }
