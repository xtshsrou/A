import logging
from datetime import datetime
from config import INDICATOR_WEIGHTS, RETRACEMENT_THRESHOLDS
import json
import os
from config import ALERTS_FILE, MAX_ALERTS

logger = logging.getLogger(__name__)


def score_pullback_opportunity(indicators: dict) -> dict:
    score = 0.0
    signals = []
    details = {}

    ma = indicators.get("ma", {})
    price = indicators.get("price", 0)
    rsi_val = indicators.get("rsi")
    kdj = indicators.get("kdj", {})
    retracement = indicators.get("retracement", {})
    volume = indicators.get("volume", {})

    retrace_60d = retracement.get("retrace_60d", 0)

    has_ma_signal = False
    ma_support_score = 0
    ma_support_count = 0
    for period, label in [(5, "MA5"), (10, "MA10"), (20, "MA20"), (60, "MA60")]:
        ma_val = ma.get(f"ma{period}")
        if ma_val and ma_val > 0:
            deviation = (price - ma_val) / ma_val * 100
            if -3 <= deviation <= 1:
                ma_support_score += 0.25
                ma_support_count += 1
                has_ma_signal = True
    details["ma_support_score"] = ma_support_score

    retrace_score = 0
    has_retrace_signal = False
    if retrace_60d >= RETRACEMENT_THRESHOLDS["strong"] * 100:
        retrace_score = 1.0
        signals.append(f"深度回撤{retrace_60d:.1f}% 超跌区")
        has_retrace_signal = True
    elif retrace_60d >= RETRACEMENT_THRESHOLDS["moderate"] * 100:
        retrace_score = 0.7
        signals.append(f"回撤{retrace_60d:.1f}% 支撑区")
        has_retrace_signal = True
    elif retrace_60d >= RETRACEMENT_THRESHOLDS["mild"] * 100:
        retrace_score = 0.4
        signals.append(f"回撤{retrace_60d:.1f}% 关注企稳")
        has_retrace_signal = True
    else:
        retrace_score = 0.1
    details["retrace_score"] = retrace_score

    has_rsi_signal = False
    rsi_score = 0
    if rsi_val is not None:
        if rsi_val <= 30:
            rsi_score = 1.0
            has_rsi_signal = True
        elif rsi_val <= 40:
            rsi_score = 0.7
            has_rsi_signal = True
        elif rsi_val <= 50:
            rsi_score = 0.4
        elif rsi_val >= 80:
            rsi_score = 0
            signals.append(f"RSI过高({rsi_val:.1f})注意风险")
        else:
            rsi_score = 0.2
    details["rsi_score"] = rsi_score

    has_kdj_signal = False
    kdj_score = 0
    k_val = kdj.get("k")
    j_val = kdj.get("j")
    if k_val is not None and j_val is not None:
        if j_val < 0:
            kdj_score = 1.0
            has_kdj_signal = True
        elif j_val < 20:
            kdj_score = 0.7
            has_kdj_signal = True
        elif j_val < 50:
            kdj_score = 0.4
        elif j_val > 100:
            kdj_score = 0
            signals.append(f"KDJ过高(J={j_val:.1f})注意风险")
        else:
            kdj_score = 0.2
    details["kdj_score"] = kdj_score

    vol_score = 0
    vol_ratio = volume.get("vol_ratio", 1)
    is_shrinking = volume.get("is_shrinking", False)
    if is_shrinking and vol_ratio < 0.8:
        vol_score = 0.8
        signals.append("缩量回调")
    elif is_shrinking:
        vol_score = 0.5
        signals.append("量能递减")
    elif vol_ratio < 1:
        vol_score = 0.3
    else:
        vol_score = 0.2
    details["vol_score"] = vol_score

    score = (
        ma_support_score * INDICATOR_WEIGHTS["ma_support"]
        + retrace_score * INDICATOR_WEIGHTS["retracement"]
        + rsi_score * INDICATOR_WEIGHTS["rsi"]
        + kdj_score * INDICATOR_WEIGHTS["kdj"]
        + vol_score * INDICATOR_WEIGHTS["volume"]
    )

    score = round(score * 100, 1)

    level = "normal"
    if score >= 70:
        level = "strong"
    elif score >= 50:
        level = "watch"
    elif score >= 30:
        level = "mild"
    else:
        level = "normal"

    buy_conditions = []
    if has_ma_signal:
        buy_conditions.append("ma")
    if has_rsi_signal:
        buy_conditions.append("rsi")
    if has_kdj_signal:
        buy_conditions.append("kdj")

    if len(buy_conditions) >= 2 and has_retrace_signal:
        signals.clear()
        signals.append("✅ 回调企稳，触发低吸信号")
        score = max(score, 60.0)
    else:
        if has_ma_signal:
            signals.append("回踩关键均线")
        if has_rsi_signal:
            signals.append(f"抛压释放 RSI({rsi_val:.1f})" if rsi_val else "抛压释放")
        if has_kdj_signal:
            signals.append(f"底部拐头信号 KDJ(J={j_val:.1f})" if j_val else "底部拐头信号")

    patterns = indicators.get("patterns", {})
    pattern = patterns.get("pattern", "none")
    if pattern in ("short_term_pullback", "box_consolidation"):
        pat_label = patterns.get("label", "")
        pat_signal = patterns.get("signal", "")
        pat_strength = patterns.get("signal_strength", "normal")
        support = patterns.get("support_level")
        support_type = patterns.get("support_type", "")
        pct = patterns.get("retrace_pct") or patterns.get("position_in_box")

        if pat_signal == "低吸信号":
            signals.append(f"{pat_label}·{support_type}{support}低吸")
            if pat_strength == "strong":
                score = max(score, 70.0)
                level = "strong"
            else:
                score = max(score, 55.0)
                if level == "normal":
                    level = "watch"
        elif pat_signal == "等待缩量":
            signals.append(f"{pat_label}·回踩{support_type}{support}")
            score = max(score, 35.0)
            if level == "normal":
                level = "mild"
        else:
            signals.append(f"{pat_label}·{pat_signal}")
    elif pattern == "monitoring":
        pass

    today_change = indicators.get("today_change", 0)
    if today_change >= 9.5:
        if level != "strong":
            signals.append(f"⚠涨停({today_change:+.2f}%)")
    elif today_change >= 7:
        signals.append(f"大涨({today_change:+.2f}%)")

    score = min(round(score, 1), 100.0)

    return {
        "score": score,
        "level": level,
        "signals": signals[:5],
        "details": details,
    }


def load_alerts():
    if not os.path.exists(ALERTS_FILE):
        return []
    try:
        with open(ALERTS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_alerts(alerts: list):
    os.makedirs(os.path.dirname(ALERTS_FILE), exist_ok=True)
    with open(ALERTS_FILE, "w") as f:
        json.dump(alerts[-MAX_ALERTS:], f, ensure_ascii=False, indent=2)


def add_alert(code: str, name: str, alert_info: dict):
    alerts = load_alerts()
    alert = {
        "code": code,
        "name": name,
        "score": alert_info.get("score", 0),
        "level": alert_info.get("level", "normal"),
        "signals": alert_info.get("signals", []),
        "price": alert_info.get("price", 0),
        "time": datetime.now().isoformat(),
    }
    last = alerts[-1] if alerts else {}
    if last.get("code") == code and last.get("level") == alert.get("level"):
        return
    alerts.append(alert)
    save_alerts(alerts)
    logger.info(f"Alert for {name}({code}): score={alert_info['score']}, level={alert_info['level']}")
