import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

import akshare as ak

logger = logging.getLogger(__name__)

_SEM = asyncio.Semaphore(4)

async def _run_ak(func, *args, timeout=12, **kwargs):
    async with _SEM:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, lambda: func(*args, **kwargs)),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(f"akshare timeout: {func.__name__}")
            return None
        except Exception as e:
            logger.debug(f"akshare error {func.__name__}: {e}")
            return None


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


async def fetch_news_articles(code: str) -> list:
    try:
        df = await _run_ak(ak.stock_news_report, symbol=code, timeout=10)
        if df is not None and not df.empty:
            articles = []
            today = datetime.now().strftime("%Y-%m-%d")
            for _, row in df.head(15).iterrows():
                title = str(row.get("新闻标题", row.get("title", "")))
                date = str(row.get("发布时间", row.get("date", "")))[:10]
                source = str(row.get("文章来源", row.get("source", "")))
                url = str(row.get("新闻网址", row.get("url", "")))
                articles.append({"title": title, "date": date, "source": source, "url": url})
            return articles
    except Exception as e:
        logger.debug(f"fetch_news_articles error: {e}")
    try:
        df = await _run_ak(ak.stock_info_news, symbol=code, timeout=10)
        if df is not None and not df.empty:
            articles = []
            for _, row in df.head(15).iterrows():
                title = str(row.get("title", ""))
                date = str(row.get("date", ""))[:10] if row.get("date") else ""
                url = str(row.get("url", ""))
                articles.append({"title": title, "date": date, "source": "", "url": url})
            return articles
    except Exception as e:
        logger.debug(f"fetch_news_articles fallback error: {e}")
    return []


async def fetch_concepts(code: str) -> Optional[dict]:
    try:
        df = await _run_ak(ak.stock_board_concept_name_em, timeout=10)
        if df is not None and not df.empty:
            industry = None
            concepts = []
            try:
                ind_df = await _run_ak(ak.stock_board_industry_name_em, timeout=8)
                if ind_df is not None and not ind_df.empty:
                    industry = str(ind_df.columns[0])
            except Exception:
                pass
            return {"industry": industry, "concepts": concepts[:8]}
    except Exception as e:
        logger.debug(f"fetch_concepts error: {e}")
    return None


async def fetch_lhb(code: str) -> list:
    try:
        df = await _run_ak(ak.stock_lhb_detail_em, date=datetime.now().strftime("%Y-%m-%d"), timeout=10)
        if df is not None and not df.empty:

            matches = df[df["代码"].astype(str).str.contains(code)]
            results = []
            for _, row in matches.head(5).iterrows():
                results.append({
                    "date": str(row.get("日期", ""))[:10],
                    "reason": str(row.get("上榜原因", "")),
                    "net_buy": float(row.get("龙虎榜净买额", 0)),
                    "total_buy": float(row.get("龙虎榜买入额", 0)),
                })
            return results
    except Exception as e:
        logger.debug(f"fetch_lhb error: {e}")
    return []


async def fetch_north_flow(code: str) -> Optional[dict]:
    try:
        df = await _run_ak(ak.stock_hsgt_north_net_flow_in_em, symbol=code, timeout=10)
        if df is not None and not df.empty:
            recent = df.tail(5)
            return {
                "net_flow_5d": round(float(recent["value"].sum()), 2),
                "latest": round(float(recent.iloc[-1]["value"]), 2) if not recent.empty else 0,
            }
    except Exception as e:
        logger.debug(f"fetch_north_flow error: {e}")
    return None


async def fetch_lockup_shares(code: str) -> Optional[dict]:
    try:
        df = await _run_ak(ak.stock_restricted_release_queue_szsh, timeout=10)
        if df is not None and not df.empty:
            if "股票代码" in df.columns:
                matches = df[df["股票代码"].astype(str).str.contains(code)]
            elif "代码" in df.columns:
                matches = df[df["代码"].astype(str).str.contains(code)]
            else:
                return None
            results = []
            for _, row in matches.head(3).iterrows():
                results.append({
                    "date": str(row.iloc[2])[:10] if len(row) > 2 else "",
                    "shares": str(row.iloc[3]) if len(row) > 3 else "",
                    "pct": str(row.iloc[4]) if len(row) > 4 else "",
                })
            return {"next_releases": results}
    except Exception as e:
        logger.debug(f"fetch_lockup error: {e}")
    return None


def _compute_sentiment(news: list, dividend: Optional[dict], price_change: Optional[float]) -> tuple:
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
        for kw in keywords_positive:
            if kw in t:
                pos_count += 1
                break
        for kw in keywords_negative:
            if kw in t:
                neg_count += 1
                break

    if pos_count > neg_count * 2 and pos_count >= 2:
        label = "利好"
        summary_parts.append(f"近期消息偏正面，含{pos_count}条利好")
    elif neg_count > pos_count * 2 and neg_count >= 2:
        label = "利空"
        summary_parts.append(f"近期消息偏负面，含{neg_count}条利空")
    else:
        summary_parts.append("近期消息面中性，无重大利好或利空")

    if dividend and dividend.get("per_10"):
        summary_parts.append(f"最新分红10派{dividend['per_10']}元")

    return label, "；".join(summary_parts)


async def fetch_news_sentiment(code: str, name: str) -> dict:
    results = {"dividend": None, "news": [], "concepts": None,
               "lhb": [], "north_flow": None, "lockup": None,
               "sentiment_label": "中性", "sentiment_summary": ""}

    tasks = [
        fetch_dividend(name),
        fetch_news_articles(code),
        fetch_concepts(code),
        fetch_lhb(code),
        fetch_north_flow(code),
        fetch_lockup_shares(code),
    ]
    outputs = await asyncio.gather(*tasks, return_exceptions=True)

    for i, key in enumerate(["dividend", "news", "concepts", "lhb", "north_flow", "lockup"]):
        val = outputs[i]
        if isinstance(val, Exception):
            logger.debug(f"news_service.{key} failed: {val}")
        elif val is not None:
            results[key] = val

    if isinstance(results["news"], list):
        news_list = results["news"]
    else:
        news_list = []
    div = results["dividend"] if not isinstance(results["dividend"], Exception) else None
    label, summary = _compute_sentiment(news_list, div, None)
    results["sentiment_label"] = label
    results["sentiment_summary"] = summary

    return results
