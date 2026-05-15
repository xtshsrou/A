let stocks = [];
let alerts = [];
let autoRefreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    autoRefreshInterval = setInterval(loadData, 5 * 60 * 1000);
});

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

        const hasData = stocks.some(s => s.quote || s.indicators);
        if (!hasData) {
            setTimeout(loadData, 3000);
        }
    } catch (e) {
        console.error('Failed to load data:', e);
        setTimeout(loadData, 5000);
    }
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

    function fmt(v, d = '--') { return v != null && v !== undefined ? v : d; }

    const signals = (alert.signals || []).map(sig =>
        `<span class="signal-tag ${sig.includes('涨停') || sig.includes('超卖') ? 'strong' : sig.includes('回调') ? 'watch' : ''}">${sig}</span>`
    ).join('');

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
            showToast(`✅ 已添加 ${name}(${code})`, 'success');
            document.getElementById('searchInput').value = '';
            await loadData();
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

document.addEventListener('click', (e) => {
    const results = document.getElementById('searchResults');
    if (!e.target.closest('.search-bar')) {
        results.classList.remove('active');
    }
});
