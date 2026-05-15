let stocks = [];
let alerts = [];
let autoRefreshInterval = null;

const LS_KEY = 'stock_kanban_watchlist';

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    autoRefreshInterval = setInterval(loadData, 5 * 60 * 1000);
});

function saveWatchlistToLS(codes) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(codes)); } catch (e) {}
}

function loadWatchlistFromLS() {
    try {
        const v = localStorage.getItem(LS_KEY);
        return v ? JSON.parse(v) : [];
    } catch (e) { return []; }
}

async function restoreWatchlistFromLS() {
    const saved = loadWatchlistFromLS();
    if (saved.length === 0) return;
    const backends = new Set((stocks || []).map(s => s.code));
    const missing = saved.filter(c => !backends.has(c));
    if (missing.length === 0) return;
    for (const code of missing) {
        try {
            await fetch(`/api/watchlist/add?code=${code}&name=${code}`, { method: 'POST' });
        } catch (e) {}
    }
    if (missing.length > 0) {
        const [res] = await Promise.all([fetch('/api/stocks')]);
        const d = await res.json();
        stocks = d.stocks;
        renderKanban();
    }
}

async function loadData() {
    try {
        const [stockRes, alertRes] = await Promise.all([
            fetch('/api/stocks'),
            fetch('/api/alerts'),
        ]);
        const stockData = await stockRes.json();
        const alertData = await alertRes.json();
        stocks = stockData.stocks;
        alerts = alertData.alerts;
        renderKanban();
        renderAlerts();
        updateLastRefresh(stockData.last_refresh);

        saveWatchlistToLS((stocks || []).map(s => s.code));
        restoreWatchlistFromLS();

        const hasData = stocks.some(s => s.quote || s.indicators);
        if (!hasData) {
            setTimeout(loadData, 3000);
        }
    } catch (e) {
        console.error('Failed to load data:', e);
        setTimeout(loadData, 5000);
    }
}

function generateAnalysis(s) {
    const ind = s.indicators || {};
    const alert = s.alert || {};
    const qq = s.quote || {};
    const ma = ind.ma || {};
    const retrace = ind.retracement || {};
    const vol = ind.volume || {};
    const boll = ind.bollinger || {};
    const kdj = ind.kdj || {};
    const rsi = ind.rsi;
    const price = qq.price || ind.price || 0;
    const patterns = ind.patterns || {};

    const maVals = [ma.ma5, ma.ma10, ma.ma20, ma.ma60].filter(v => v != null && v > 0);
    const sortedAsc = [...maVals].sort((a, b) => a - b);
    const allBearish = maVals.length >= 3 && sortedAsc.join(',') === maVals.join(',');
    const allBullish = maVals.length >= 3 && sortedAsc.reverse().join(',') === maVals.join(',');

    const level = alert.level || 'normal';
    const score = alert.score || 0;
    let levelLabel, levelIcon;
    if (level === 'strong') { levelLabel = '强信号'; levelIcon = '🔴'; }
    else if (level === 'watch') { levelLabel = '中等信号'; levelIcon = '🟡'; }
    else if (level === 'mild') { levelLabel = '弱信号'; levelIcon = '🟡'; }
    else { levelLabel = '无信号'; levelIcon = '⚪'; }

    let trendSummary = '';
    if (allBullish) trendSummary = '均线多头排列（MA5>MA10>MA20>MA60），趋势偏强';
    else if (allBearish) trendSummary = '均线空头排列（MA5<MA10<MA20<MA60），趋势偏弱';
    else if (ma.ma5 && ma.ma10) {
        const m5 = ma.ma5, m10 = ma.ma10;
        const gap = ((m5 - m10) / m10 * 100).toFixed(1);
        if (m5 > m10) trendSummary = `MA5(${m5})在MA10(${m10})上方（+${gap}%），短线企稳但中长期均线未形成多头`;
        else trendSummary = `MA5(${m5})在MA10(${m10})下方（${gap}%），短线承压，趋势偏弱`;
    } else {
        trendSummary = '均线数据不足，方向不明';
    }

    let bollComment = '';
    if (boll.upper && boll.lower) {
        const pct = ((price - boll.lower) / (boll.upper - boll.lower) * 100).toFixed(0);
        if (price >= boll.upper * 0.98) bollComment = `触及布林上轨（上轨${boll.upper}），超买区，回调风险较高`;
        else if (price <= boll.lower * 1.02) bollComment = `接近布林下轨（下轨${boll.lower}），处于相对低位，存在技术支撑`;
        else if (price <= boll.middle) bollComment = `运行于中轨下方（位置${pct}%分位），偏弱区域`;
        else bollComment = `运行于中轨上方（位置${pct}%分位），偏强区域`;
    }

    let rsiComment = '';
    if (rsi != null) {
        if (rsi <= 25) rsiComment = `RSI(${rsi.toFixed(1)})深度超卖，短期反弹概率较高`;
        else if (rsi <= 30) rsiComment = `RSI(${rsi.toFixed(1)})进入超卖区，空方力量释放，存在修复动能`;
        else if (rsi <= 40) rsiComment = `RSI(${rsi.toFixed(1)})接近超卖区，空方力量逐步衰竭，但尚未进入超卖极值`;
        else if (rsi >= 70) rsiComment = `RSI(${rsi.toFixed(1)})进入超买区，短期注意回调风险`;
        else if (rsi >= 60) rsiComment = `RSI(${rsi.toFixed(1)})偏强运行，短期多头占优`;
        else rsiComment = `RSI(${rsi.toFixed(1)})中性区域，方向不明`;
    }

    let kdjComment = '';
    const jVal = kdj.j;
    if (jVal != null) {
        if (jVal < 0) kdjComment = `KDJ(J=${jVal.toFixed(1)})严重超卖，短期存在技术性反弹需求`;
        else if (jVal < 20) kdjComment = `KDJ(J=${jVal.toFixed(1)})进入超卖区域，底部拐头信号`;
        else if (jVal > 100) kdjComment = `KDJ(J=${jVal.toFixed(1)})过高，超买风险，注意回调`;
        else if (jVal > 80) kdjComment = `KDJ(J=${jVal.toFixed(1)})偏高，短期偏强但需注意高位风险`;
        else kdjComment = `KDJ(J=${jVal.toFixed(1)})中性`;
    }

    const conflicts = [];
    const rsiLow = rsi != null && rsi <= 40;
    const kdjLow = jVal != null && jVal < 20;
    const rsiHigh = rsi != null && rsi >= 60;
    const kdjHigh = jVal != null && jVal > 80;

    if (rsiLow && !kdjLow && jVal != null) {
        conflicts.push(`RSI(${rsi.toFixed(1)})偏空但KDJ(J=${jVal.toFixed(1)})未确认超卖，指标间存在分歧，反弹力度可能有限`);
    }
    if (kdjLow && !rsiLow && rsi != null) {
        conflicts.push(`KDJ(J=${jVal.toFixed(1)})超卖但RSI(${rsi.toFixed(1)})仍处中性，该超卖信号在震荡市中可靠性较低，需等待RSI进入超卖区确认`);
    }
    if ((rsiLow || kdjLow) && boll.middle && price > boll.middle) {
        conflicts.push(`超卖信号与价格位置矛盾——价格仍在中轨(${boll.middle})之上运行，非绝对低位，超卖参考价值需打折`);
    }
    if ((rsiLow || kdjLow) && boll.upper && price >= boll.upper * 0.95) {
        conflicts.push(`价格处于布林上轨附近，与超卖信号严重矛盾，警惕假信号`);
    }
    if ((rsiHigh || kdjHigh) && boll.lower && price <= boll.lower * 1.05) {
        conflicts.push(`价格处于布林下轨附近但指标偏多，出现背离信号，关注价格能否企稳`);
    }

    let volComment = '';
    const volRatio = vol.vol_ratio;
    const isShrinking = vol.is_shrinking;
    const patLabel = patterns.label || '';
    const patSignal = patterns.signal || '';
    if (volRatio != null) {
        if (isShrinking && patSignal === '低吸信号') {
            volComment = `回调期间持续缩量（量比${volRatio}），抛压逐步释放，符合低吸策略的量能条件`;
        } else if (isShrinking) {
            volComment = `量能递减（量比${volRatio}），呈缩量整理态势，但当前未处于明确的回调-低吸形态中，需观察支撑位附近能否进一步缩量企稳`;
        } else if (volRatio < 0.8) {
            volComment = `当前量比${volRatio}，略低于均量，但回调未连续缩量，抛压未充分释放，不宜急于介入`;
        } else if (volRatio > 1.5) {
            volComment = `放量（量比${volRatio}），资金活跃度较高，若价格下跌则为放量下跌需警惕`;
        } else {
            volComment = `量比${volRatio}，量能正常，无明显缩量或放量特征，观望为主`;
        }
    }

    const retrace60d = retrace.retrace_60d;
    let retraceComment = '';
    if (retrace60d != null) {
        if (retrace60d >= 30) {
            retraceComment = `距60日高点已回撤${retrace60d}%，深度回调，超跌区，关注支撑确认后的反弹机会`;
        } else if (retrace60d >= 20) {
            retraceComment = `距60日高点回撤${retrace60d}%，中期回调幅度较深，关注关键支撑位的企稳信号`;
        } else if (retrace60d >= 10) {
            retraceComment = `距60日高点回撤${retrace60d}%，短线回调中，尚未进入深度超跌区`;
        } else {
            retraceComment = `距60日高点仅回撤${retrace60d}%，接近阶段高位，趋势偏强，不构成低吸条件`;
        }
    }

    let conclusion = '';
    if (patSignal === '低吸信号') {
        const cond = [];
        if (isShrinking) cond.push('✅ 回调缩量');
        else cond.push('❌ 量能未萎缩');
        if (allBullish || (ma.ma5 && ma.ma10 && ma.ma5 > ma.ma10)) cond.push('✅ 均线支撑');
        else cond.push('❌ 均线破位');
        if (rsiLow || kdjLow) cond.push('✅ 技术超卖');
        else cond.push('❌ 未超卖');
        if (boll.lower && price <= boll.lower * 1.03) cond.push('✅ 接近下轨');
        else if (boll.lower) cond.push('❌ 远离下轨');

        const pass = cond.filter(c => c.startsWith('✅')).length;
        if (pass >= 3) {
            conclusion = `触发「${patLabel}」低吸信号，条件验证（${pass}/4）：${cond.join(' | ')}。多数条件满足，可考虑分批介入，以支撑位下方${patLabel === '短线回调' ? '3%' : '5%'}设止损。`;
        } else {
            conclusion = `触发「${patLabel}」低吸信号但条件不完整（${pass}/4）：${cond.join(' | ')}。仅部分条件满足，建议等待更多确认信号再介入。`;
        }
    } else if (alert.score >= 60) {
        const features = [];
        if (isShrinking) features.push('量能偏弱');
        if (rsiLow || kdjLow) features.push('技术面偏空');
        if (boll.lower && price <= boll.lower * 1.05) features.push('价格低位');
        conclusion = `综合评分${score}，但缺乏明确的低吸形态触发。当前特征：${features.join('、') || '无明显特征'}。不满足「拉升-回调缩量-支撑位企稳」的完整条件链，建议继续观察。`;
    } else if (rsi != null && rsi <= 40) {
        conclusion = `仅RSI(${rsi.toFixed(1)})单一指标偏空，未形成多重确认。不符合策略要求的「缩量回调+回踩关键支撑+技术超卖」三重条件，反弹大概率是修复性脉冲，建议观望。`;
    } else if (rsi != null && rsi >= 60) {
        conclusion = 'RSI偏强运行，价格处于相对高位，不符合回调低吸策略的介入条件，等待回调后的机会。';
    } else if (allBearish) {
        conclusion = '均线空头排列，趋势偏弱，回调低吸策略不建议在下跌趋势中左侧抄底。等待底部放量企稳、短期均线拐头后再评估。';
    } else {
        conclusion = '当前无明确信号。等待「拉升—回调—缩量企稳」的完整形态形成后再评估低吸机会。';
    }

    return {
        levelLabel, levelIcon,
        trendSummary, bollComment,
        rsiComment, kdjComment,
        volComment, retraceComment,
        conclusion, conflicts,
        maShort: ma.ma5 != null && ma.ma10 != null,
    };
}

function updateLastRefresh(timestamp) {
    const el = document.getElementById('lastRefresh');
    if (timestamp) {
        const d = new Date(timestamp);
        el.textContent = `最后更新: ${d.toLocaleTimeString('zh-CN')}`;
    } else {
        el.textContent = '未更新';
    }
}

function renderKanban() {
    const container = document.getElementById('kanban');
    if (!stocks || stocks.length === 0) {
        container.innerHTML = '<div class="loading">暂无自选股，请在上方搜索添加</div>';
        return;
    }
    container.innerHTML = stocks.map(s => renderCard(s)).join('');
}

function renderCard(s) {
    const alert = s.alert || {};
    const ind = s.indicators || {};
    const quote = s.quote || {};
    const level = alert.level || 'normal';
    const score = alert.score || 0;

    const price = quote.price || ind.price || '--';
    const changePct = quote.change_pct != null ? quote.change_pct : (ind.today_change || 0);
    const changeClass = changePct > 0 ? 'up' : changePct < 0 ? 'down' : '';

    const ma = ind.ma || {};
    const retrace = ind.retracement || {};
    const vol = ind.volume || {};
    const rsi = ind.rsi;
    const kdj = ind.kdj || {};
    const patterns = ind.patterns || {};

    function fmt(v, d = '--') { return v != null && v !== undefined ? v : d; }

    const patLabel = patterns.label || '';
    const patSignal = patterns.signal || '';
    const support = patterns.support_level;
    const supportType = patterns.support_type || '';
    const patPct = patterns.retrace_pct || patterns.position_in_box;
    const patClass = patterns.pattern === 'short_term_pullback' ? 'pullback' : patterns.pattern === 'box_consolidation' ? 'consolidation' : '';

    let patHtml = '';
    if (patLabel && patClass) {
        const sigClass = patSignal === '低吸信号' ? ' signal-buy' : '';
        patHtml = `<div class="card-pattern ${patClass}${sigClass}">
            ${patLabel}${support ? ` · ${supportType}${support}` : ''}${patPct ? ` · ${patPct}%` : ''}
            ${patSignal ? `<span class="pat-signal">${patSignal}</span>` : ''}
        </div>`;
    }

    const signals = (alert.signals || []).map(sig => {
        let cls = '';
        if (sig.includes('低吸信号') || sig.includes('涨停') || sig.includes('触')) cls = 'buy';
        else if (sig.includes('关键均线') || sig.includes('抛压') || sig.includes('底部拐头')) cls = 'strong';
        else if (sig.includes('支撑') || sig.includes('企稳') || sig.includes('缩量')) cls = 'watch';
        else if (sig.includes('风险') || sig.includes('过高')) cls = '';
        return `<span class="signal-tag ${cls}">${sig}</span>`;
    }).join('');

    return `
        <div class="stock-card level-${level}" onclick="showDetail('${s.code}')">
            <button class="card-remove" onclick="event.stopPropagation(); removeStock('${s.code}')">✕</button>
            <div class="card-header">
                <div>
                    <span class="card-title">${s.name}</span>
                    <span class="card-code">${s.code}</span>
                </div>
                <div class="card-score ${level}">${score}</div>
            </div>
            ${patHtml}
            <div class="card-price">
                <span class="price">${fmt(price)}</span>
                <span class="change ${changeClass}">${changePct > 0 ? '+' : ''}${fmt(changePct)}%</span>
            </div>
            <div class="card-indicators">
                <span>MA5/10/20 <span class="val">${fmt(ma.ma5)} / ${fmt(ma.ma10)} / ${fmt(ma.ma20)}</span></span>
                <span>60日高点 <span class="val">${fmt(retrace.high_60d)}</span></span>
                <span>回撤60日 <span class="val">${fmt(retrace.retrace_60d)}%</span></span>
                <span>RSI <span class="val ${rsi && rsi < 40 ? 'green' : rsi && rsi > 70 ? 'red' : ''}">${fmt(rsi)}</span></span>
                <span>KDJ <span class="val">${fmt(kdj.k)} / ${fmt(kdj.d)} / ${fmt(kdj.j)}</span></span>
                <span>量比(20日) <span class="val ${vol.vol_ratio < 0.8 ? 'green' : vol.vol_ratio > 1.5 ? 'yellow' : ''}">${fmt(vol.vol_ratio)}</span></span>
            </div>
            <div class="card-signals">${signals}</div>
            <div class="card-sentiment">${cardSentimentLine(s)}</div>
        </div>
    `;
}

function cardSentimentLine(s) {
    const ind = s.indicators || {};
    const alert = s.alert || {};
    const qq = s.quote || {};
    const parts = [];
    if (ind.patterns && ind.patterns.signal === '低吸信号') parts.push('触发低吸');
    if (ind.rsi != null && ind.rsi <= 30) parts.push('RSI超卖区');
    if (qq.pe != null && qq.pe > 0 && qq.pe < 15) parts.push('低估值');
    else if (qq.pe != null && qq.pe > 60) parts.push('高估值');
    if (ind.recent_trend === 'down') parts.push('短线偏弱');
    else if (ind.recent_trend === 'up') parts.push('短线偏强');
    if (ind.ma && ind.ma.ma5 && ind.ma.ma10) {
        if (ind.ma.ma5 > ind.ma.ma10) parts.push('均线多头');
        else parts.push('均线空头');
    }
    const txt = parts.length ? parts.join('，') : '暂无明显信号';
    const label = (txt.includes('低吸') || txt.includes('超卖') || txt.includes('低估值') || txt.includes('多头')) ? '关注' : '中性';
    return `📰 简判 <span class="sent-${label}">${label}</span> ${txt}`;
}

function renderAlerts() {
    const container = document.getElementById('alertList');
    const badge = document.getElementById('alertBadge');
    badge.textContent = alerts.length;
    if (alerts.length === 0) {
        container.innerHTML = '<div style="color:#5a6a7a;text-align:center;padding:20px">暂无警报</div>';
        return;
    }
    container.innerHTML = alerts.slice().reverse().map(a => {
        const d = new Date(a.time);
        const timeStr = d.toLocaleString('zh-CN');
        return `
            <div class="alert-item ${a.level}">
                <div class="alert-time">${timeStr}</div>
                <div class="alert-name">${a.name} (${a.code})</div>
                <div class="alert-price">¥${a.price} · 评分 ${a.score}</div>
                <div class="alert-signal">${(a.signals || []).join(' · ')}</div>
            </div>
        `;
    }).join('');
}

async function searchStock() {
    const q = document.getElementById('searchInput').value.trim();
    if (!q) return;
    const results = document.getElementById('searchResults');
    results.innerHTML = '<div class="search-result-item" style="color:#5a6a7a;font-size:13px">搜索中...</div>';
    results.classList.add('active');

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items = data.results || [];

        if (items.length === 0) {
            results.innerHTML = '<div class="search-result-item" style="color:#e74c3c;font-size:13px">未找到匹配股票，试试输入完整代码</div>';
            results.classList.add('active');
            setTimeout(() => results.classList.remove('active'), 2000);
            return;
        }

        if (items.length === 1) {
            results.classList.remove('active');
            document.getElementById('searchInput').value = '';
            addToWatchlist(items[0].code, items[0].name);
            return;
        }

        results.innerHTML = items.slice(0, 10).map(item => `
            <div class="search-result-item" onclick="addToWatchlist('${item.code}', '${item.name.replace(/'/g, "\\'")}')">
                <span class="name">${item.name}</span>
                <span class="code">${item.code}</span>
            </div>
        `).join('');
        results.classList.add('active');
    } catch (e) {
        console.error('Search failed:', e);
        results.innerHTML = '<div class="search-result-item" style="color:#e74c3c;font-size:13px">搜索超时，请重试</div>';
        results.classList.add('active');
        setTimeout(() => results.classList.remove('active'), 2000);
    }
}

async function addToWatchlist(code, name) {
    document.getElementById('searchResults').classList.remove('active');
    try {
        const res = await fetch(`/api/watchlist/add?code=${code}&name=${encodeURIComponent(name)}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ 已添加 ${name}(${code})，等待数据加载...`, 'success');
            document.getElementById('searchInput').value = '';
            for (let i = 0; i < 20; i++) {
                await loadData();
                const stock = stocks.find(s => s.code === code);
                if (stock && (stock.quote || stock.indicators)) break;
                await new Promise(r => setTimeout(r, 2000));
            }
            showToast(`✅ ${name}(${code}) 数据已加载`, 'success');
        } else if (res.status === 400) {
            showToast(`⚠️ ${name} 已在自选股中`, 'error');
        } else {
            showToast(`❌ ${data.detail || '添加失败'}`, 'error');
        }
    } catch (e) {
        showToast('❌ 添加失败，请重试', 'error');
    }
}

async function removeStock(code) {
    if (!confirm('确定移除此自选股？')) return;
    try {
        const res = await fetch(`/api/watchlist/${code}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            await loadData();
        }
    } catch (e) {
        showToast('移除失败', 'error');
    }
}

async function showDetail(code) {
    try {
        const res = await fetch(`/api/stocks/${code}`);
        const s = await res.json();
        const ind = s.indicators || {};
        const alert = s.alert || {};
        const ma = ind.ma || {};
        const retrace = ind.retracement || {};
        const vol = ind.volume || {};
        const boll = ind.bollinger || {};
        const kdj = ind.kdj || {};
        const rsi = ind.rsi;
        const qq = s.quote || {};
        const price = qq.price || ind.price || '--';
        const todayChange = qq.change_pct != null ? qq.change_pct : (ind.today_change || 0);
        const changeClass = todayChange > 0 ? 'up' : todayChange < 0 ? 'down' : '';

        const a = generateAnalysis(s);
        const colors = {'🔴':'#e74c3c','🟡':'#f39c12','⚪':'#5a6a7a'};
        const ac = colors[a.levelIcon] || '#5a6a7a';

        const modal = document.getElementById('stockModal');
        document.getElementById('modalContent').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h2 style="font-size:20px">${s.name} <span style="color:#7a9abf;font-size:14px">${s.code}</span></h2>
                <button class="btn btn-small" onclick="closeModal()">✕</button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;margin-bottom:12px">
                <div><strong>当前价格:</strong> ¥${price}</div>
                <div><strong>今日涨幅:</strong> <span class="change ${changeClass}">${todayChange > 0 ? '+' : ''}${todayChange}%</span></div>
                <div><strong>综合评分:</strong> <span style="color:${alert.score >= 70 ? '#e74c3c' : alert.score >= 50 ? '#f39c12' : '#5a6a7a'}">${alert.score}</span></div>
                <div><strong>趋势:</strong> ${ind.recent_trend === 'up' ? '上涨' : ind.recent_trend === 'down' ? '下跌' : '震荡'}</div>
            </div>

            <div class="modal-tabs">
                <button class="tab-btn active" onclick="switchTab(event,'tech')">📊 技术面</button>
                <button class="tab-btn" onclick="switchTab(event,'news')">📰 消息面</button>
            </div>

            <div id="tabTech" class="tab-panel active">
                <h3 style="margin:12px 0 8px;font-size:14px;color:#7a9abf">均线</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;font-size:13px">
                    <div>MA5: ${ma.ma5 || '--'}</div>
                    <div>MA10: ${ma.ma10 || '--'}</div>
                    <div>MA20: ${ma.ma20 || '--'}</div>
                    <div>MA60: ${ma.ma60 || '--'}</div>
                </div>

                <h3 style="margin:12px 0 8px;font-size:14px;color:#7a9abf">技术指标</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                    <div>RSI(14): ${rsi ?? '--'}</div>
                    <div>KDJ: ${kdj.k ?? '--'} / ${kdj.d ?? '--'} / ${kdj.j ?? '--'}</div>
                    <div>布林上轨: ${boll.upper || '--'}</div>
                    <div>布林中轨: ${boll.middle || '--'}</div>
                    <div>布林下轨: ${boll.lower || '--'}</div>
                </div>

                <h3 style="margin:12px 0 8px;font-size:14px;color:#7a9abf">回调分析</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                    <div>60日高点: ¥${retrace.high_60d || '--'}</div>
                    <div>距高点回撤: ${retrace.retrace_60d || 0}%</div>
                    <div>20日高点: ¥${retrace.high_20d || '--'}</div>
                    <div>距20日高回撤: ${retrace.retrace_20d || 0}%</div>
                </div>

                <h3 style="margin:12px 0 8px;font-size:14px;color:#7a9abf">量能分析</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                    <div>量比(20日): ${vol.vol_ratio || '--'}</div>
                    <div>缩量趋势: ${vol.is_shrinking ? '✅ 是' : '❌ 否'}</div>
                </div>

                ${alert.signals && alert.signals.length > 0 ? `
                <h3 style="margin:12px 0 8px;font-size:14px;color:#7a9abf">信号</h3>
                <div style="display:flex;flex-wrap:wrap;gap:4px">
                    ${alert.signals.map(s => `<span class="signal-tag strong">${s}</span>`).join('')}
                </div>` : ''}

                <div style="margin-top:12px;padding:12px;background:#1a2332;border-radius:6px;border-left:3px solid ${ac}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <span style="font-size:14px;font-weight:600;color:#7a9abf">📋 综合解读</span>
                        <span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${ac}22;color:${ac}">${a.levelIcon} ${a.levelLabel}</span>
                    </div>
                    <div style="font-size:13px;line-height:1.8">
                        <div><strong>趋势:</strong> ${a.trendSummary}</div>
                        <div><strong>布林:</strong> ${a.bollComment}</div>
                        <div><strong>RSI:</strong> ${a.rsiComment}</div>
                        <div><strong>KDJ:</strong> ${a.kdjComment}</div>
                        <div><strong>量能:</strong> ${a.volComment}</div>
                        <div><strong>回撤:</strong> ${a.retraceComment}</div>
                    </div>
                    ${a.conflicts && a.conflicts.length > 0 ? `
                    <div style="margin-top:10px;padding:8px 10px;background:#2a1a1a;border-radius:4px;border-left:3px solid #e67e22;font-size:12px;line-height:1.7">
                        <div style="font-weight:600;color:#e67e22;margin-bottom:4px">⚠️ 信号矛盾点</div>
                        ${a.conflicts.map(c => `<div style="color:#dda">• ${c}</div>`).join('')}
                    </div>` : ''}
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3a4a;font-size:13px;color:#ccddee">
                        <strong>结论:</strong> ${a.conclusion}
                    </div>
                </div>

                <div style="margin-top:12px;text-align:right;color:#5a6a7a;font-size:11px">
                    ${s.updated_at ? new Date(s.updated_at).toLocaleString('zh-CN') : ''}
                </div>
            </div>

            <div id="tabNews" class="tab-panel">
                <div class="tab-loading">⏳ 加载消息面数据...</div>
            </div>
        `;
        modal.classList.remove('hidden');
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        loadNewsData(code, s.name);
    } catch (e) {
        console.error('Failed to load detail:', e);
    }
}

function closeModal() {
    document.getElementById('stockModal').classList.add('hidden');
}

function switchTab(event, tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

async function loadNewsData(code, name) {
    const el = document.getElementById('tabNews');
    try {
        const res = await fetch(`/api/stocks/${code}/news`);
        if (!res.ok) { el.innerHTML = '<div class="tab-loading" style="color:#e74c3c">消息面数据加载失败</div>'; return; }
        const data = await res.json();
        el.innerHTML = renderNewsTab(data, name);
    } catch (e) {
        el.innerHTML = '<div class="tab-loading" style="color:#e74c3c">消息面数据加载失败: ' + e.message + '</div>';
    }
}

function renderNewsTab(data, name) {
    const sentLabel = data.sentiment_label || '中性';
    const sentSummary = data.sentiment_summary || '';
    const sentColor = sentLabel === '利好' ? '#2ecc71' : sentLabel === '利空' ? '#e74c3c' : '#7a9abf';

    const hasNews = data.news && data.news.length > 0;
    const hasDividend = data.dividend && data.dividend.per_10;
    const hasConcepts = data.concepts && (data.concepts.industry || data.concepts.concepts?.length);
    const hasLhb = data.lhb && data.lhb.length > 0;
    const hasNorthFlow = data.north_flow;
    const hasLockup = data.lockup && data.lockup.next_releases?.length > 0;

    const sections = [];

    sections.push(`<div class="news-summary">消息面研判 <span style="color:${sentColor};font-weight:600">${sentLabel}</span> ${sentSummary}</div>`);

    if (hasNews) {
        sections.push('<div class="news-section"><div class="news-section-title">📄 近期公告新闻</div>');
        for (const a of data.news.slice(0, 10)) {
            const d = a.date || '';
            const t = a.title || '';
            const src = a.source || '';
            const url = a.url || '';
            const kw = ['业绩', '涨停', '中标', '合同', '增持', '回购', '分红', '送转', '减产', '预增', '预减', '亏损', '减持', '处罚', '监管', '解禁'];
            let tag = '';
            for (const k of kw) { if (t.includes(k)) { tag = k; break; } }
            const tagHtml = tag ? `<span class="news-tag">${tag}</span>` : '';
            sections.push(`<div class="news-item">${tagHtml}<span class="news-date">${d}</span><span class="news-title">${t}</span></div>`);
        }
        sections.push('</div>');
    }

    if (hasDividend) {
        const d = data.dividend;
        sections.push(`<div class="news-section"><div class="news-section-title">💰 分红股息</div>
            <div class="news-grid">
                <div><strong>最新分红:</strong> 10派${d.per_10}元</div>
                ${d.ex_date ? `<div><strong>除权日:</strong> ${d.ex_date}</div>` : ''}
                ${d.pay_date ? `<div><strong>派息日:</strong> ${d.pay_date}</div>` : ''}
            </div></div>`);
    }

    if (hasConcepts) {
        const c = data.concepts;
        sections.push(`<div class="news-section"><div class="news-section-title">🏷️ 概念板块</div>
            <div class="news-grid">${c.industry ? `<div><strong>行业:</strong> ${c.industry}</div>` : ''}
            ${c.concepts && c.concepts.length ? `<div><strong>概念:</strong> ${c.concepts.join('、')}</div>` : ''}
            </div></div>`);
    }

    if (hasLhb) {
        sections.push('<div class="news-section"><div class="news-section-title">📊 龙虎榜</div>');
        for (const l of data.lhb.slice(0, 3)) {
            sections.push(`<div class="news-item"><span class="news-date">${l.date}</span>${l.reason ? l.reason : ''} 净买入: ¥${l.net_buy?.toFixed(2) || '--'}万</div>`);
        }
        sections.push('</div>');
    }

    if (hasNorthFlow) {
        sections.push(`<div class="news-section"><div class="news-section-title">🌊 北向资金</div>
            <div class="news-grid">
                <div><strong>近5日净流入:</strong> ¥${data.north_flow.net_flow_5d?.toFixed(2) || '--'}万</div>
                <div><strong>最新日:</strong> ¥${data.north_flow.latest?.toFixed(2) || '--'}万</div>
            </div></div>`);
    }

    if (hasLockup) {
        sections.push('<div class="news-section"><div class="news-section-title">🔒 限售解禁</div>');
        for (const l of data.lockup.next_releases) {
            sections.push(`<div class="news-item">${l.date || '待定'} 解禁 ${l.shares || '--'}股 占比${l.pct || '--'}</div>`);
        }
        sections.push('</div>');
    }

    if (!hasNews && !hasDividend && !hasConcepts && !hasLhb && !hasNorthFlow && !hasLockup) {
        sections.push('<div class="tab-loading">暂无消息面数据，数据源可能暂时不可用</div>');
    }

    return sections.join('');
}

function toggleAlerts() {
    document.getElementById('alertPanel').classList.toggle('hidden');
}

async function clearAlerts() {
    await fetch('/api/alerts/clear');
    alerts = [];
    renderAlerts();
    showToast('警报已清空', 'success');
}

async function manualRefresh() {
    showToast('正在刷新数据...', 'success');
    await fetch('/api/refresh');
    await loadData();
    showToast('刷新完成', 'success');
}

function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        const s = data.settings || {};
        const map = {
            s_rally_lookback: 'rally_lookback',
            s_rally_min_single: 'rally_min_single_gain',
            s_rally_min_cumulative: 'rally_min_cumulative_gain',
            s_rally_volume_increase: 'rally_volume_increase',
            s_pullback_min_days: 'pullback_min_days',
            s_pullback_max_days: 'pullback_max_days',
            s_pullback_ma_proximity: 'pullback_ma_proximity',
            s_consolidation_min_days: 'consolidation_min_days',
            s_consolidation_max_days: 'consolidation_max_days',
            s_consolidation_box_position: 'consolidation_box_position',
            s_volume_shrink_threshold: 'volume_shrink_threshold',
        };
        for (const [elId, key] of Object.entries(map)) {
            const el = document.getElementById(elId);
            if (el && s[key] != null) el.value = s[key];
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    const map = {
        rally_lookback: 's_rally_lookback',
        rally_min_single_gain: 's_rally_min_single',
        rally_min_cumulative_gain: 's_rally_min_cumulative',
        rally_volume_increase: 's_rally_volume_increase',
        pullback_min_days: 's_pullback_min_days',
        pullback_max_days: 's_pullback_max_days',
        pullback_ma_proximity: 's_pullback_ma_proximity',
        consolidation_min_days: 's_consolidation_min_days',
        consolidation_max_days: 's_consolidation_max_days',
        consolidation_box_position: 's_consolidation_box_position',
        volume_shrink_threshold: 's_volume_shrink_threshold',
    };
    const settings = {};
    for (const [key, elId] of Object.entries(map)) {
        const el = document.getElementById(elId);
        if (el) settings[key] = parseFloat(el.value);
    }
    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings }),
        });
        const data = await res.json();
        if (data.success) {
            const status = document.getElementById('settingsStatus');
            status.style.display = 'inline';
            setTimeout(() => { status.style.display = 'none'; }, 2000);
            manualRefresh();
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function toggleSettings() {
    document.getElementById('settingsPanel').classList.toggle('hidden');
    if (!document.getElementById('settingsPanel').classList.contains('hidden')) {
        loadSettings();
    }
}

document.addEventListener('click', (e) => {
    const results = document.getElementById('searchResults');
    if (!e.target.closest('.search-bar')) {
        results.classList.remove('active');
    }
});
