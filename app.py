import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from config import FETCH_INTERVAL_MINUTES, CHECK_INTERVAL_MINUTES, BASE_DIR
from services.data_service import (
    fetch_all_quotes, fetch_realtime_quote, fetch_kline, search_stock
)
from services.indicator_service import calc_all_indicators
from services.alert_service import score_pullback_opportunity, add_alert, load_alerts
from services.watchlist_service import load_watchlist, add_stock, remove_stock

DEFAULT_WATCHLIST = [
    {"code": "601872", "name": "招商轮船"},
    {"code": "600519", "name": "贵州茅台"},
    {"code": "000880", "name": "潍柴重机"},
    {"code": "603598", "name": "引力传媒"},
    {"code": "605086", "name": "龙高股份"},
    {"code": "002352", "name": "顺丰控股"},
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

cached_data = {}
last_refresh = None
_refresh_lock = asyncio.Lock()


async def refresh_all_stocks():
    global cached_data, last_refresh
    if _refresh_lock.locked():
        logger.info("Refresh already in progress, skipping")
        return
    async with _refresh_lock:
        watchlist = load_watchlist()
        if not watchlist:
            logger.info("Watchlist is empty, skipping refresh")
            return

        codes = [s["code"] for s in watchlist]
        logger.info(f"Refreshing {len(codes)} stocks: {codes}")

        all_quotes = await fetch_all_quotes()

        for s in watchlist:
            code = s["code"]
            try:
                quote = all_quotes.get(code)
                kline = await fetch_kline(code, 120)

                if kline is not None and not kline.empty:
                    indicators = calc_all_indicators(kline)
                    alert_info = score_pullback_opportunity(indicators)

                    stock_data = {
                        **s,
                        "quote": quote,
                        "indicators": indicators,
                        "alert": alert_info,
                        "updated_at": datetime.now().isoformat(),
                    }
                    cached_data[code] = stock_data

                    if alert_info["score"] >= 30:
                        add_alert(code, s["name"], {
                            "score": alert_info["score"],
                            "level": alert_info["level"],
                            "signals": alert_info["signals"],
                            "price": indicators.get("price", 0),
                        })
                else:
                    if quote:
                        cached_data[code] = {
                            **s,
                            "quote": quote,
                            "indicators": None,
                            "alert": None,
                            "updated_at": datetime.now().isoformat(),
                        }
            except Exception as e:
                logger.error(f"Error refreshing {code}: {e}")

        last_refresh = datetime.now().isoformat()
        logger.info(f"Refresh complete at {last_refresh}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    watchlist = load_watchlist()
    if not watchlist:
        logger.info("Seeding default watchlist")
        for s in DEFAULT_WATCHLIST:
            add_stock(s["code"], s["name"])
    logger.info("Starting scheduler...")

    scheduler.add_job(
        refresh_all_stocks,
        IntervalTrigger(minutes=FETCH_INTERVAL_MINUTES),
        id="refresh_stocks",
        replace_existing=True,
    )
    scheduler.add_job(
        refresh_all_stocks,
        CronTrigger(hour=9, minute=31),
        id="market_open",
        replace_existing=True,
    )
    scheduler.start()

    asyncio.create_task(refresh_all_stocks())

    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="A股回调监控看板", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=f"{BASE_DIR}/static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(Path(f"{BASE_DIR}/templates/index.html").read_text(encoding="utf-8"))


@app.get("/api/stocks")
async def get_stocks():
    watchlist = load_watchlist()
    results = []
    for s in watchlist:
        code = s["code"]
        if code in cached_data:
            results.append(cached_data[code])
        else:
            results.append({**s, "quote": None, "indicators": None, "alert": None, "updated_at": None})
    return {
        "stocks": results,
        "total": len(results),
        "last_refresh": last_refresh,
    }


@app.get("/api/stocks/{code}")
async def get_stock_detail(code: str):
    if code not in cached_data:
        raise HTTPException(status_code=404, detail="Stock not found or not yet loaded")
    return cached_data[code]


@app.post("/api/watchlist/add")
async def api_add_stock(code: str, name: str):
    success = add_stock(code, name)
    if not success:
        raise HTTPException(status_code=400, detail="Stock already in watchlist")

    async def _fetch_new_stock():
        try:
            quote = await fetch_realtime_quote(code)
            kline = await fetch_kline(code, 120)
            if kline is not None and not kline.empty:
                indicators = calc_all_indicators(kline)
                alert_info = score_pullback_opportunity(indicators)
                cached_data[code] = {
                    "code": code, "name": name,
                    "quote": quote, "indicators": indicators,
                    "alert": alert_info,
                    "updated_at": datetime.now().isoformat(),
                }
        except Exception as e:
            logger.error(f"Error fetching data for new stock {code}: {e}")

    asyncio.create_task(_fetch_new_stock())
    return {"success": True, "message": f"Added {name}({code})"}


@app.delete("/api/watchlist/{code}")
async def api_remove_stock(code: str):
    success = remove_stock(code)
    if not success:
        raise HTTPException(status_code=404, detail="Stock not found in watchlist")
    cached_data.pop(code, None)
    return {"success": True, "message": f"Removed {code}"}


@app.get("/api/alerts")
async def get_alerts():
    alerts = load_alerts()
    return {"alerts": alerts[-50:]}


@app.get("/api/alerts/clear")
async def clear_alerts():
    from services.alert_service import save_alerts
    save_alerts([])
    return {"success": True, "message": "Alerts cleared"}


@app.get("/api/search")
async def search(q: str):
    results = await search_stock(q)
    return {"results": results}


@app.get("/api/refresh")
async def trigger_refresh():
    await refresh_all_stocks()
    return {"success": True, "last_refresh": last_refresh}


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
