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
    const allBullish = maVals.length >= 3 && sortedAsc.join(',') === maVals.join(',');
    const allBearish = maVals.length >= 3 && sortedAsc.reverse().join(',') === maVals.join(',');
    const nearBollLower = boll.lower ? (price - boll.lower) / boll.lower * 100 : null;

    const parts = [];

    const level = alert.level || 'normal';
    const score = alert.score || 0;
    let levelLabel, levelIcon;
    if (level === 'strong') { levelLabel = '强信号'; levelIcon = '🔴'; }
    else if (level === 'watch') { levelLabel = '中等信号'; levelIcon = '🟡'; }
    else if (level === 'mild') { levelLabel = '弱信号'; levelIcon = '🟡'; }
    else { levelLabel = '无信号'; levelIcon = '⚪'; }

    let trendSummary = '';
    if (allBullish) trendSummary = '完全多头排列（均线向上发散，趋势强势）';
    else if (allBearish) trendSummary = '完全空头排列（跌破所有均线，趋势向下）';
    else if (ma.ma5 && ma.ma10 && ma.ma5 > ma.ma10) trendSummary = '短多长空（MA5在MA10上方，短线企稳但中长期仍承压）';
    else if (ma.ma5 && ma.ma10 && ma.ma5 < ma.ma10) trendSummary = '短空长多（MA5在MA10下方，短线偏弱）';
    else trendSummary = '均线交织，方向不明';

    let bollComment = '';
    if (boll.upper && boll.lower) {
        if (price >= boll.upper * 0.98) bollComment = '逼近布林上轨，超买区';
        else if (price <= boll.lower * 1.02) bollComment = '接近布林下轨，处于相对低位';
        else if (price <= boll.middle) bollComment = '运行于中轨下方，偏弱';
        else bollComment = '运行于中轨上方，偏强';
    }

    let rsiComment = '';
    if (rsi != null) {
        if (rsi <= 30) rsiComment = '进入超卖区，存在反弹修复动能';
        else if (rsi <= 40) rsiComment = '接近超卖区，空方力量逐步衰竭';
        else if (rsi >= 70) rsiComment = '进入超买区，注意回调风险';
        else if (rsi >= 60) rsiComment = '偏强运行';
        else rsiComment = '中性区域';
    }

    let kdjComment = '';
    const jVal = kdj.j;
    if (jVal != null) {
        if (jVal < 0) kdjComment = 'J值严重超卖，短期空方力量释放';
        else if (jVal < 20) kdjComment = 'J值偏低，超卖区域';
        else if (jVal > 100) kdjComment = 'J值过高，超买风险';
        else if (jVal > 80) kdjComment = 'J值偏高';
        else kdjComment = '中性';
    }

    let volComment = '';
    const volRatio = vol.vol_ratio;
    if (volRatio != null) {
        if (vol.is_shrinking) volComment = `量能递减中（量比${volRatio}），缩量整理`;
        else if (volRatio < 0.8) volComment = `缩量（量比${volRatio}），抛压减弱`;
        else if (volRatio > 1.5) volComment = `放量（量比${volRatio}），资金活跃`;
        else volComment = `量能正常（量比${volRatio}）`;
    }

    const retrace60d = retrace.retrace_60d;
    let retraceComment = '';
    if (retrace60d != null) {
        if (retrace60d >= 30) retraceComment = '深度回撤，超跌反弹预期较强';
        else if (retrace60d >= 20) retraceComment = '中期回调中，关注支撑确认';
        else if (retrace60d >= 10) retraceComment = '小幅回调，趋势尚可';
        else retraceComment = '接近60日高点，趋势偏强';
    }

    const patLabel = patterns.label || '';
    const patSignal = patterns.signal || '';
    let conclusion = '';
    if (patSignal === '低吸信号') {
        conclusion = `当前触发「${patLabel}」低吸信号，支撑位附近缩量企稳，符合买入条件。建议分仓介入，以支撑位下方${patLabel === '短线回调' ? '3%' : '5%'}设止损。`;
    } else if (alert.score >= 60) {
        conclusion = '多项技术指标共振，回调进入价值区域，但缺乏「量能验证」。建议等待缩量企稳信号确认后再评估。';
    } else if (rsi != null && rsi <= 40) {
        conclusion = '当前仅满足"技术超卖"条件，不符合「缩量回调+回踩关键支撑」的强信号标准。反弹大概率为修复性脉冲，非趋势低吸机会，建议观望。';
    } else if (allBearish) {
        conclusion = '均线空头排列，趋势偏弱，不建议左侧抄底。等待底部放量企稳信号出现后再评估。';
    } else {
        conclusion = '当前无明确信号。等待拉升-回调形态形成后再评估低吸机会。';
    }

    return {
        levelLabel, levelIcon,
        trendSummary, bollComment,
        rsiComment, kdjComment,
        volComment, retraceComment,
        conclusion,
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
        </div>
    `;
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

        const modal = document.getElementById('stockModal');
        document.getElementById('modalContent').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:20px">${s.name} <span style="color:#7a9abf;font-size:14px">${s.code}</span></h2>
                <button class="btn btn-small" onclick="document.getElementById('stockModal').classList.add('hidden')">✕</button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">
                <div><strong>当前价格:</strong> ¥${price}</div>
                <div><strong>今日涨幅:</strong> <span class="change ${changeClass}">${todayChange > 0 ? '+' : ''}${todayChange}%</span></div>
                <div><strong>综合评分:</strong> <span style="color:${alert.score >= 70 ? '#e74c3c' : alert.score >= 50 ? '#f39c12' : '#5a6a7a'}">${alert.score}</span></div>
                <div><strong>趋势:</strong> ${ind.recent_trend === 'up' ? '上涨' : ind.recent_trend === 'down' ? '下跌' : '震荡'}</div>
            </div>

            <h3 style="margin:16px 0 8px;font-size:14px;color:#7a9abf">均线</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;font-size:13px">
                <div>MA5: ${ma.ma5 || '--'}</div>
                <div>MA10: ${ma.ma10 || '--'}</div>
                <div>MA20: ${ma.ma20 || '--'}</div>
                <div>MA60: ${ma.ma60 || '--'}</div>
            </div>

            <h3 style="margin:16px 0 8px;font-size:14px;color:#7a9abf">技术指标</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                <div>RSI(14): ${rsi ?? '--'}</div>
                <div>KDJ: ${kdj.k ?? '--'} / ${kdj.d ?? '--'} / ${kdj.j ?? '--'}</div>
                <div>布林上轨: ${boll.upper || '--'}</div>
                <div>布林中轨: ${boll.middle || '--'}</div>
                <div>布林下轨: ${boll.lower || '--'}</div>
            </div>

            <h3 style="margin:16px 0 8px;font-size:14px;color:#7a9abf">回调分析</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                <div>60日高点: ¥${retrace.high_60d || '--'}</div>
                <div>距高点回撤: ${retrace.retrace_60d || 0}%</div>
                <div>20日高点: ¥${retrace.high_20d || '--'}</div>
                <div>距20日高回撤: ${retrace.retrace_20d || 0}%</div>
            </div>

            <h3 style="margin:16px 0 8px;font-size:14px;color:#7a9abf">量能分析</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                <div>量比(20日): ${vol.vol_ratio || '--'}</div>
                <div>缩量趋势: ${vol.is_shrinking ? '✅ 是' : '❌ 否'}</div>
            </div>

            ${alert.signals && alert.signals.length > 0 ? `
            <h3 style="margin:16px 0 8px;font-size:14px;color:#7a9abf">信号</h3>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
                ${alert.signals.map(s => `<span class="signal-tag strong">${s}</span>`).join('')}
            </div>` : ''}

            ${(() => {
                const a = generateAnalysis(s);
                const colors = {'🔴':'#e74c3c','🟡':'#f39c12','⚪':'#5a6a7a'};
                return `
            <div style="margin-top:16px;padding:12px;background:#1a2332;border-radius:6px;border-left:3px solid ${colors[a.levelIcon] || '#5a6a7a'}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <span style="font-size:14px;font-weight:600;color:#7a9abf">📋 综合解读</span>
                    <span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${colors[a.levelIcon] || '#5a6a7a'}22;color:${colors[a.levelIcon] || '#5a6a7a'}">${a.levelIcon} ${a.levelLabel}</span>
                </div>
                <div style="font-size:13px;line-height:1.8">
                    <div><strong>趋势:</strong> ${a.trendSummary}</div>
                    <div><strong>布林:</strong> ${a.bollComment}</div>
                    <div><strong>RSI:</strong> ${a.rsiComment}</div>
                    <div><strong>KDJ:</strong> ${a.kdjComment}</div>
                    <div><strong>量能:</strong> ${a.volComment}</div>
                    <div><strong>回撤:</strong> ${a.retraceComment}</div>
                </div>
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3a4a;font-size:13px;color:#ccddee">
                    <strong>结论:</strong> ${a.conclusion}
                </div>
            </div>`;})()}

            <div style="margin-top:16px;text-align:right;color:#5a6a7a;font-size:11px">
                ${s.updated_at ? new Date(s.updated_at).toLocaleString('zh-CN') : ''}
            </div>
        `;
        modal.classList.remove('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    } catch (e) {
        console.error('Failed to load detail:', e);
    }
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
