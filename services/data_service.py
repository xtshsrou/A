import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional

import akshare as ak
import pandas as pd
import aiohttp

logger = logging.getLogger(__name__)

_RATE_LIMIT_SEMAPHORE = asyncio.Semaphore(1)
_MAX_RETRIES = 2
_KLINE_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "kline_cache")
os.makedirs(_KLINE_CACHE_DIR, exist_ok=True)


async def _run_with_retry(fn, *args, **kwargs):
    for attempt in range(_MAX_RETRIES):
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: fn(*args, **kwargs))
            return result
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.warning(f"Attempt {attempt + 1}/{_MAX_RETRIES} failed: {e}")
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(1.5 ** attempt)
            else:
                raise


def _extract_quote_row(row, code):
    return {
        "code": str(row.get("代码", code)),
        "name": str(row.get("名称", "")),
        "price": round(float(row.get("最新价", 0)), 2),
        "open": round(float(row.get("今开", 0)), 2),
        "high": round(float(row.get("最高", 0)), 2),
        "low": round(float(row.get("最低", 0)), 2),
        "prev_close": round(float(row.get("昨收", 0)), 2),
        "volume": int(row.get("成交量", 0)),
        "amount": float(row.get("成交额", 0)),
        "change_pct": round(float(row.get("涨跌幅", 0)), 2),
        "turnover_rate": round(float(row.get("换手率", 0)), 2),
        "amplitude": round(float(row.get("振幅", 0)), 2),
        "pe": round(float(row.get("市盈率-动态", 0)), 2),
        "total_mv": float(row.get("总市值", 0)),
        "update_time": datetime.now().isoformat(),
    }


def _add_prefix(code: str) -> str:
    if code.startswith(("sh", "sz", "bj")):
        return code
    if code.startswith(("6", "9")):
        return f"sh{code}"
    if code.startswith(("0", "3", "2")):
        return f"sz{code}"
    return f"bj{code}"


def _strip_prefix(code: str) -> str:
    return code[2:] if code[:2] in ("sh", "sz", "bj") else code


def _parse_tencent_quote(code: str, text: str):
    try:
        data = text.split("=\"")[1].split("\"")[0].split("~")
        if len(data) < 10:
            return None
        name = data[1]
        price = float(data[3]) if data[3] else 0
        prev_close = float(data[4]) if data[4] else 0
        change_pct = round((price - prev_close) / prev_close * 100, 2) if prev_close > 0 else 0
        return {
            "code": code,
            "name": name,
            "price": price,
            "open": float(data[5]) if data[5] else 0,
            "high": float(data[7]) if data[7] else 0,
            "low": float(data[8]) if data[8] else 0,
            "prev_close": prev_close,
            "volume": int(data[6]) * 100 if data[6] else 0,
            "amount": float(data[9]) * 10000 if data[9] else 0,
            "change_pct": change_pct,
            "turnover_rate": 0,
            "amplitude": 0,
            "pe": 0,
            "total_mv": 0,
            "update_time": datetime.now().isoformat(),
        }
    except (IndexError, ValueError, KeyError):
        return None


async def fetch_realtime_quote(code: str):
    symbol = _add_prefix(code)
    url = f"http://qt.gtimg.cn/q={symbol}"
    for attempt in range(_MAX_RETRIES):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    text = await resp.text(encoding="gbk")
                    result = _parse_tencent_quote(code, text)
                    if result:
                        return result
                    logger.warning(f"Empty result for {code} (attempt {attempt+1})")
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.warning(f"Attempt {attempt+1}/{_MAX_RETRIES} failed for {code}: {e}")
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(1.5 ** attempt)
            else:
                logger.error(f"Failed to fetch quote for {code}: {e}")
                return None
        except Exception as e:
            logger.error(f"Failed to fetch quote for {code}: {e}")
            return None
    return None


async def fetch_all_quotes() -> dict:
    async with _RATE_LIMIT_SEMAPHORE:
        try:
            df = await _run_with_retry(ak.stock_zh_a_spot)
            if df is None or df.empty:
                return {}
            result = {}
            for _, row in df.iterrows():
                raw = str(row.get("代码", ""))
                code = _strip_prefix(raw)
                if code:
                    result[code] = _extract_quote_row(row, code)
            return result
        except Exception as e:
            logger.error(f"Failed to fetch all quotes: {e}")
            return {}


_KLINE_SEMAPHORE = asyncio.Semaphore(6)


def _kline_cache_path(code: str) -> str:
    return os.path.join(_KLINE_CACHE_DIR, f"{code}.json")


def save_kline_cache(code: str, df: pd.DataFrame):
    path = _kline_cache_path(code)
    try:
        data = df.to_dict(orient="records")
        with open(path, "w") as f:
            json.dump(data, f, default=str)
    except Exception as e:
        logger.warning(f"Failed to save kline cache for {code}: {e}")


def load_kline_cache(code: str) -> Optional[pd.DataFrame]:
    path = _kline_cache_path(code)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            data = json.load(f)
        df = pd.DataFrame(data)
        df["date"] = pd.to_datetime(df["date"])
        for c in ["open", "close", "high", "low"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
        df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
        return df
    except Exception as e:
        logger.warning(f"Failed to load kline cache for {code}: {e}")
        return None


async def fetch_kline(code: str, days: int = 120):
    async with _KLINE_SEMAPHORE:
        try:
            symbol = _add_prefix(code)
            df = await _run_with_retry(
                ak.stock_zh_a_hist_tx,
                symbol=symbol,
                start_date="20200101", end_date="20500101",
                adjust="qfq",
            )
            if df is None or df.empty:
                return None
            df = df.tail(days).copy()
            df["date"] = pd.to_datetime(df["date"])
            for c in ["open", "close", "high", "low"]:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
            df["volume"] = (df["amount"] / ((df["open"] + df["close"]) / 2)).fillna(0).astype("int64")
            result = df[["date", "open", "close", "high", "low", "volume", "amount"]]
            save_kline_cache(code, result)
            return result
        except Exception as e:
            logger.error(f"Failed to fetch kline for {code}: {e}")
            return None


_STATIC_STOCK_LIST = None
_STATIC_STOCK_LIST_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "stock_list.json")


def _load_stock_list() -> list[dict]:
    global _STATIC_STOCK_LIST
    if _STATIC_STOCK_LIST is not None:
        return _STATIC_STOCK_LIST
    try:
        with open(_STATIC_STOCK_LIST_FILE, "r") as f:
            _STATIC_STOCK_LIST = json.load(f)
            return _STATIC_STOCK_LIST
    except Exception as e:
        logger.error(f"Failed to load stock list: {e}")
        return []


async def search_stock(keyword: str) -> list[dict]:
    stock_list = await asyncio.get_event_loop().run_in_executor(None, _load_stock_list)
    if not stock_list:
        return []
    matches = [
        s for s in stock_list
        if keyword in s["code"] or keyword in s["name"]
    ]
    return matches[:10]
