import logging
import numpy as np
import pandas as pd

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
