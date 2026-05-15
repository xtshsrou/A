import asyncio
import logging
from datetime import datetime
from typing import Optional

import akshare as ak

logger = logging.getLogger(__name__)

_SEM = asyncio.Semaphore(4)

_ADD_PREFIX = lambda c: f"sh{c}" if c.startswith(("6", "9")) else f"sz{c}" if c.startswith(("0", "3", "2")) else c


async def _run_ak(func, *args, timeout=12, **kwargs):
    async with _SEM:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, lambda: func(*args, **kwargs)),
                timeout=timeout,
            )
        except (asyncio.TimeoutError, Exception) as e:
            logger.debug(f"akshare {func.__name__} error: {e}")
            return None


async def fetch_dividend(name: str) -> Optional[dict]:
    try:
        df = await _run_ak(ak.stock_dividents, name=name)
        if df is not None and not df.empty:
            latest = df.iloc[-1]
            per_10 = None
            try:
                import re
                text = str(latest.iloc[1])
                m = re.search(r'[\d.]+', text)
                if m:
                    per_10 = float(m.group())
            except (ValueError, IndexError):
                pass
            ex_date = None
            try:
                d = str(latest.iloc[2])
                if d and d != "nan":
                    ex_date = d[:10]
            except (IndexError, ValueError):
                pass
            pay_date = None
            try:
                d = str(latest.iloc[3])
                if d and d != "nan":
                    pay_date = d[:10]
            except (IndexError, ValueError):
                pass
            return {"per_10": per_10, "ex_date": ex_date, "pay_date": pay_date}
    except Exception as e:
        logger.debug(f"fetch_dividend error: {e}")
    return None


async def fetch_stock_info(code: str) -> dict:
    """Fetch fundamental data from Tencent quote API (field-verified)."""
    import aiohttp
    symbol = _ADD_PREFIX(code)
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://qt.gtimg.cn/q={symbol}", timeout=aiohttp.ClientTimeout(total=6)) as r:
                text = await r.text(encoding="gbk")
        data = text.split("=\"")[1].split("\"")[0].split("~")
        if len(data) < 50:
            return {}
        return {
            "price": float(data[3]) if data[3] else 0,
            "change_pct": float(data[32]) if len(data) > 32 and data[32] else None,
            "high": float(data[33]) if len(data) > 33 and data[33] else None,
            "low": float(data[34]) if len(data) > 34 and data[34] else None,
            "turnover_rate": float(data[38]) if len(data) > 38 and data[38] else None,
            "pe": float(data[39]) if len(data) > 39 and data[39] else None,
            "total_mv": float(data[44]) if len(data) > 44 and data[44] else None,
            "circulating_mv": float(data[45]) if len(data) > 45 and data[45] else None,
            "pb": float(data[49]) if len(data) > 49 and data[49] else None,
            "industry": data[42] if len(data) > 42 and data[42] else None,
            "concept": data[43] if len(data) > 43 and data[43] else None,
        }
    except Exception as e:
        logger.debug(f"fetch_stock_info error: {e}")
        return {}


def compute_analysis(name: str, fin: dict, ind: dict = None, alert: dict = None) -> dict:
    """Generate comprehensive analysis + sentiment from available data (no external news needed)."""
    lines = []
    factors = {"positive": 0, "negative": 0, "neutral": 0}

    pe = fin.get("pe")
    pb = fin.get("pb")
    mv = fin.get("total_mv")
    turnover = fin.get("turnover_rate")
    change = fin.get("change_pct")

    # 行业概念
    industry = fin.get("industry") or ""
    concept = fin.get("concept") or ""
    if industry or concept:
        parts = [industry] if industry else []
        if concept:
            parts.append(concept)
        lines.append(f"所属{' / '.join(parts)}")

    # PE估值分析
    if pe is not None and pe > 0:
        if pe < 15:
            lines.append(f"PE({pe})偏低，估值处于历史低位区间，具备安全边际")
            factors["positive"] += 2
        elif pe < 30:
            lines.append(f"PE({pe})处于合理估值区间")
            factors["neutral"] += 1
        elif pe < 60:
            lines.append(f"PE({pe})偏高，关注业绩增速能否匹配估值")
            factors["negative"] += 1
        else:
            lines.append(f"PE({pe})显著偏高，估值压力较大，需警惕回调风险")
            factors["negative"] += 2

    # PB分析
    if pb is not None and pb > 0:
        if pb < 1:
            lines.append(f"PB({pb})破净，极端低估，可能存在价值修复机会")
            factors["positive"] += 2
        elif pb < 2:
            lines.append(f"PB({pb})处于低位，估值安全")
            factors["positive"] += 1
        elif pb > 10:
            lines.append(f"PB({pb})极高，轻资产高溢价特征")
            factors["neutral"] += 1

    # 市值
    if mv and mv > 0:
        mv_label = "大盘" if mv > 1000 else "中盘" if mv > 200 else "小盘"
        lines.append(f"总市值{mv:.1f}亿（{mv_label}股）")

    # 基本面指标组合
    if pe is not None and pe > 0 and pb is not None and pb > 0:
        if pe < 20 and pb < 2:
            lines.append("PE+PB双低组合，典型低估价值股特征")
            factors["positive"] += 1
        elif pe > 50 and pb > 5:
            lines.append("PE+PB双高，成长股特征，波动风险较大")
            factors["negative"] += 1

    # 技术面整合
    if ind:
        rsi = ind.get("rsi")
        trend = ind.get("recent_trend")
        vol = ind.get("volume", {})
        vol_ratio = vol.get("vol_ratio")
        retrace = ind.get("retracement", {})
        retrace_60d = retrace.get("retrace_60d")

        if trend == "up":
            lines.append("短线趋势向上，处于上升通道")
            factors["positive"] += 1
        elif trend == "down":
            lines.append("短线趋势向下，处于回调阶段")
            factors["negative"] += 1

        if rsi is not None and rsi <= 30:
            lines.append(f"RSI({rsi})深度超卖，技术性反弹需求较强")
            factors["positive"] += 1
        elif rsi is not None and rsi >= 70:
            lines.append(f"RSI({rsi})超买，短期注意回调")
            factors["negative"] += 1

        if vol_ratio and vol.get("is_shrinking"):
            lines.append(f"缩量回调（量比{vol_ratio}），抛压减弱")
            factors["positive"] += 1
        elif vol_ratio and vol_ratio > 2:
            lines.append(f"放量（量比{vol_ratio}），资金活跃")
            factors["neutral"] += 1

        if retrace_60d and retrace_60d >= 20:
            lines.append(f"距60日高点回撤{retrace_60d}%，深度回调区间")
            factors["positive"] += 1

    # 信号
    if alert:
        signals = alert.get("signals", [])
        if alert.get("score", 0) >= 70:
            lines.append("综合技术评分较高，多指标共振")
            factors["positive"] += 2
        for sig in signals:
            if "低吸信号" in sig:
                lines.append(f"触发「{sig}」")
                factors["positive"] += 2

    # 最终研判
    net = factors["positive"] - factors["negative"]
    if net >= 3:
        label = "利好"
        summary = "综合研判偏正面，估值合理偏低+技术面企稳，具备低吸条件"
    elif net >= 1:
        label = "偏多"
        summary = "综合研判中性偏正面，部分指标支撑但需等待进一步确认"
    elif net <= -3:
        label = "利空"
        summary = "综合研判偏负面，估值偏高+技术面走弱，建议观望"
    elif net <= -1:
        label = "偏空"
        summary = "综合研判中性偏负面，风险因素较多，谨慎参与"
    else:
        label = "中性"
        summary = "综合研判中性，多空因素均衡，等待方向选择"

    return {
        "sentiment_label": label,
        "sentiment_summary": summary,
        "analysis_items": lines,
        "score": net,
        "factors": factors,
    }


async def fetch_analysis(code: str, name: str, indicators: dict = None, alert_info: dict = None) -> dict:
    fin, dividend = await asyncio.gather(
        fetch_stock_info(code),
        fetch_dividend(name),
        return_exceptions=True,
    )
    if isinstance(fin, Exception):
        fin = {}
    if isinstance(dividend, Exception):
        dividend = None

    analysis = compute_analysis(name, fin, indicators, alert_info)

    return {
        "dividend": dividend,
        "financial": fin if fin else None,
        "analysis_items": analysis["analysis_items"],
        "sentiment_label": analysis["sentiment_label"],
        "sentiment_summary": analysis["sentiment_summary"],
        "score": analysis["score"],
        "factors": analysis["factors"],
        "news_unavailable": True,
    }
