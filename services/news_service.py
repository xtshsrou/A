import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

import akshare as ak
import aiohttp

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


async def _http_get(url: str, timeout: int = 8) -> Optional[str]:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                return await r.text()
    except Exception as e:
        logger.debug(f"HTTP error {url[:60]}: {e}")
        return None


async def fetch_news_articles(code: str) -> list:
    symbol = _ADD_PREFIX(code).upper()

    _NAV = {"财经首页", "股票", "基金", "港股", "美股", "期货", "外汇", "贵金属", "债券", "大盘",
            "新闻", "行情", "数据", "板块", "个股", "自选股", "更多", "返回", "首页", "财经"}

    urls = [
        f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/NewsCNService.getStockNews?code={symbol}&num=10",
        f"https://vip.stock.finance.sina.com.cn/corp/go.php/vCB_AllNewsStock/symbol/{symbol}.phtml",
    ]

    for url in urls:
        text = await _http_get(url)
        if not text:
            continue

        if "json_v2" in url:
            try:
                raw = text.strip()
                if raw.startswith("["):
                    data = json.loads(raw)
                    articles = []
                    for item in data[:15]:
                        t = (item.get("title", "") or item.get("text", "") or "").strip()
                        if not t or t in _NAV:
                            continue
                        d = str(item.get("date", ""))[:10]
                        articles.append({"title": t, "date": d, "source": "新浪财经"})
                    if articles:
                        return articles
            except (json.JSONDecodeError, Exception):
                continue
        else:
            titles = re.findall(r'<a[^>]*target="_blank"[^>]*>([^<]+)</a>', text)
            dates = re.findall(r'(\d{4}-\d{2}-\d{2})', text)
            articles = []
            for i, t in enumerate(titles):
                t = t.strip()
                if not t or t in _NAV:
                    continue
                d = dates[i] if i < len(dates) else ""
                articles.append({"title": t, "date": d, "source": "新浪财经"})
            if articles:
                return articles[:15]

    return []


async def fetch_dividend(name: str) -> Optional[dict]:
    try:
        df = await _run_ak(ak.stock_dividents, name=name)
        if df is not None and not df.empty:
            latest = df.iloc[-1]
            per_10 = None
            try:
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


async def fetch_tencent_financial(code: str) -> Optional[dict]:
    symbol = _ADD_PREFIX(code)
    text = await _http_get(f"http://qt.gtimg.cn/q={symbol}", timeout=6)
    if not text:
        return None
    try:
        data = text.split("=\"")[1].split("\"")[0].split("~")
        if len(data) < 40:
            return None
        result = {
            "name": data[1] if len(data) > 1 else "",
            "price": float(data[3]) if data[3] else 0,
            "pe": float(data[39]) if len(data) > 39 and data[39] else None,
            "pb": float(data[49]) if len(data) > 49 and data[49] else None,
            "amplitude": float(data[38]) if len(data) > 38 and data[38] else None,
            "total_mv": float(data[44]) if len(data) > 44 and data[44] else None,
            "circulating_mv": float(data[45]) if len(data) > 45 and data[45] else None,
            "industry": data[42] if len(data) > 42 and data[42] else None,
            "concept": data[43] if len(data) > 43 and data[43] else None,
            "high": float(data[33]) if len(data) > 33 and data[33] else None,
            "low": float(data[34]) if len(data) > 34 and data[34] else None,
        }
        return result
    except (IndexError, ValueError, KeyError) as e:
        logger.debug(f"parse tencent financial error: {e}")
        return None


def _compute_sentiment(news: list, financial: Optional[dict]) -> tuple:
    label = "中性"
    summary_parts = []

    keywords_positive = ["业绩预增", "扭亏", "涨停", "中标", "合同", "增持", "回购",
                         "分红", "送转", "产能", "扩产", "新品", "量产", "突破",
                         "政策扶持", "利好", "补贴", "减税"]
    keywords_negative = ["业绩预亏", "预减", "减持", "立案", "处罚", "监管",
                         "跌停", "解禁", "下调", "亏损", "风险提示"]

    pos_count = 0
    neg_count = 0
    for a in news[:10]:
        t = a.get("title", "")
        if not t:
            continue
        for kw in keywords_positive:
            if kw in t:
                pos_count += 1
                break
        for kw in keywords_negative:
            if kw in t:
                neg_count += 1
                break

    if news:
        if pos_count > neg_count and pos_count >= 2:
            label = "利好"
            summary_parts.append(f"含{pos_count}条利好公告")
        elif neg_count > pos_count and neg_count >= 2:
            label = "利空"
            summary_parts.append(f"含{neg_count}条利空公告")
        else:
            summary_parts.append(f"近期{len(news)}条公告，无明显倾向")
    else:
        summary_parts.append("暂无实时新闻数据")

    if financial:
        pe = financial.get("pe")
        if pe is not None and pe > 0:
            if pe < 15:
                summary_parts.append(f"PE={pe} 估值偏低")
                if label == "中性":
                    label = "利好"
            elif pe > 50:
                summary_parts.append(f"PE={pe} 估值偏高")
            else:
                summary_parts.append(f"PE={pe}")

        pb = financial.get("pb")
        if pb is not None and pb > 0 and pb < 1.5:
            summary_parts.append("破净/低市净率")

        industry = financial.get("industry")
        concept = financial.get("concept")
        if industry and concept:
            summary_parts.append(f"{industry}")
        elif industry:
            summary_parts.append(industry)

    return label, "；".join(summary_parts)


async def fetch_news_sentiment(code: str, name: str) -> dict:
    tasks = [
        fetch_news_articles(code),
        fetch_dividend(name),
        fetch_tencent_financial(code),
    ]
    outputs = await asyncio.gather(*tasks, return_exceptions=True)

    news = outputs[0] if not isinstance(outputs[0], Exception) and outputs[0] else []
    dividend = outputs[1] if not isinstance(outputs[1], Exception) and outputs[1] else None
    financial = outputs[2] if not isinstance(outputs[2], Exception) and outputs[2] else None

    label, summary = _compute_sentiment(news, financial)

    concepts = None
    if financial and (financial.get("industry") or financial.get("concept")):
        concepts = {"industry": financial.get("industry"), "concepts": [financial.get("concept")] if financial.get("concept") else []}

    return {
        "dividend": dividend,
        "news": news,
        "concepts": concepts,
        "financial": financial,
        "sentiment_label": label,
        "sentiment_summary": summary,
    }
