// App State
let currentScenarios = null;
let currentKpis = null;
let currentScope = "";
let chatHistory = [];

// Helper
const formatMoney = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
const formatNumber = (val) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);

// DOM LOAD
document.addEventListener('DOMContentLoaded', () => {
    // Load all base filter options on startup
    fetch('/api/filters')
        .then(r => r.json())
        .then(data => {
            populateSelect('sel-country',  data.countries);
            populateSelect('sel-store',    data.stores);
            populateSelect('sel-category', data.categories);
            populateSelect('sel-product',  data.products);
            attachCascadeListeners();
        });

    const vmult = document.getElementById('sel-vmult');
    vmult.addEventListener('input', e => {
        document.getElementById('vmult-val').innerText = parseFloat(e.target.value).toFixed(1);
    });
    vmult.addEventListener('change', loadDashboardData);

    document.getElementById('btn-send-chat').addEventListener('click', sendChat);
    document.getElementById('btn-clear-chat').addEventListener('click', () => {
        chatHistory = [];
        document.getElementById('chat-messages').innerHTML = '<div class="chat-msg chat-bot">History cleared. How can I help you today?</div>';
    });
    document.getElementById('btn-run-forecast').addEventListener('click', runForecast);
    document.getElementById('btn-export-pdf').addEventListener('click', downloadPDF);

    initResizers();
    loadDashboardData();
});

// ── CASCADING FILTER LOGIC ──────────────────────────────────────────
function attachCascadeListeners() {
    // Country → refresh stores, categories, products
    document.getElementById('sel-country').addEventListener('change', () => {
        refreshCascade().then(loadDashboardData);
    });
    // Store → refresh categories, products
    document.getElementById('sel-store').addEventListener('change', () => {
        refreshCascade().then(loadDashboardData);
    });
    // Category → refresh products only
    document.getElementById('sel-category').addEventListener('change', () => {
        refreshCascade().then(loadDashboardData);
    });
    // Product → just reload dashboard
    document.getElementById('sel-product').addEventListener('change', loadDashboardData);
}

function refreshCascade() {
    const state = getFilterState();
    return fetch('/api/filters/cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    })
    .then(r => r.json())
    .then(data => {
        const curStore    = document.getElementById('sel-store').value;
        const curCat      = document.getElementById('sel-category').value;
        const curProduct  = document.getElementById('sel-product').value;

        populateSelect('sel-store',    data.stores,     curStore);
        populateSelect('sel-category', data.categories, curCat);
        populateSelect('sel-product',  data.products,   curProduct);
    })
    .catch(err => {
        console.error("Cascade Error:", err);
    });
}


// launchApp is defined in index.html (handles welcome screen)
// Tab Switching
function switchTab(tabId) {
    ['overview', 'dashboard', 'assistant', 'team'].forEach(t => {
        document.getElementById(`page-${t}`).classList.remove('active');
        document.getElementById(`tab-${t}`).classList.remove('active');
    });
    document.getElementById(`page-${tabId}`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if (tabId === 'dashboard') window.dispatchEvent(new Event('resize'));
}

// Helpers
function populateSelect(id, options, preserveValue = null) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="All">All</option>';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.innerText = opt;
        sel.appendChild(o);
    });
    if (preserveValue && options.includes(preserveValue)) {
        sel.value = preserveValue;
    } else {
        sel.value = "All";
    }
}

function getFilterState() {
    return {
        country: document.getElementById('sel-country').value,
        store: document.getElementById('sel-store').value,
        category: document.getElementById('sel-category').value,
        product: document.getElementById('sel-product').value,
        v_mult: parseFloat(document.getElementById('sel-vmult').value)
    };
}

// Fetch Dashboard Data
function loadDashboardData() {
    const filters = getFilterState();
    currentScope = `${filters.country} | ${filters.store} | ${filters.category}`;

    fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters)
    })
    .then(r => r.json())
    .then(data => {
        // Update KPIs
        currentKpis = data.kpis;
        document.getElementById('kpi-rev').innerText = formatMoney(data.kpis.total_sales);
        document.getElementById('kpi-units').innerText = formatNumber(data.kpis.units_sold);
        document.getElementById('kpi-demand').innerText = formatNumber(data.kpis.target_demand);
        
        const riskEl = document.getElementById('kpi-risk');
        const riskCard = document.getElementById('kpi-risk-card');
        riskEl.innerText = data.kpis.risk;
        if (data.kpis.risk === 'CRITICAL') {
            riskEl.style.color = '#DC2626';
            riskCard.style.borderLeftColor = '#DC2626';
            riskCard.classList.add('critical');
        } else {
            riskEl.style.color = '#16A34A';
            riskCard.style.borderLeftColor = '#16A34A';
            riskCard.classList.remove('critical');
        }

        // Update History Line Chart
        renderLineChart(data.charts.history.dates, data.charts.history.values);

        // Update Bar Chart
        renderBarChart(data.charts.bar.x, data.charts.bar.y);

        // Update Pie Chart
        renderPieChart(data.charts.pie.labels, data.charts.pie.values);
        
        // Update Map Chart
        renderMapChart(data.charts.map.locations, data.charts.map.values);
        
        // Reset forecast data
        currentScenarios = null;
    })
    .catch(err => {
        console.error("Dashboard Load Error:", err);
        document.getElementById('kpi-rev').innerText = "Error";
    });
}

// Chart theme helper — adapts to dark/light mode
function getChartTheme() {
    const dark = document.getElementById('html-root').classList.contains('dark');
    return {
        paper: 'rgba(0,0,0,0)',
        plot:  'rgba(0,0,0,0)',
        grid:  dark ? '#334155' : '#E2E8F0',
        tick:  dark ? '#94A3B8' : '#64748B',
        font:  dark ? '#F1F5F9' : '#1E293B',
    };
}

// Plotly Renderers
function getPlotlyLayout(yTitle, margin={l:40, r:10, t:10, b:20}) {
    const t = getChartTheme();
    return {
        paper_bgcolor: t.paper, plot_bgcolor: t.plot,
        font: { family: 'Inter, sans-serif', color: t.tick },
        xaxis: { gridcolor: t.grid },
        yaxis: { gridcolor: t.grid, title: yTitle, titlefont: { size: 10 } },
        margin: margin
    };
}

function renderLineChart(x, y) {
    const t = getChartTheme();
    const trace = {
        x: x, y: y, type: 'scatter', mode: 'lines',
        name: 'Historical Sales',
        line: { color: '#2563EB', width: 2.5 },
        fill: 'tozeroy', fillcolor: 'rgba(37,99,235,0.07)'
    };
    const layout = {
        paper_bgcolor: t.paper, plot_bgcolor: t.plot,
        font: { family: 'Inter, sans-serif', color: t.tick, size: 11 },
        xaxis: { gridcolor: t.grid, tickfont: { size: 10, color: t.tick }, zeroline: false },
        yaxis: { gridcolor: t.grid, tickfont: { size: 10, color: t.tick }, tickformat: '$,.0f', zeroline: false },
        margin: { l: 62, r: 14, t: 34, b: 38 },
        legend: { orientation: 'h', y: 1.15, font: { size: 11, color: t.tick }, bgcolor: 'transparent' },
        showlegend: true
    };
    Plotly.newPlot('chart-forecast', [trace], layout, { responsive: true, displayModeBar: false });
}

function renderBarChart(x, y) {
    const t = getChartTheme();
    const maxV = Math.max(...y);
    const trace = {
        x: x, y: y, type: 'bar',
        marker: {
            color: y.map(v => `rgba(37,99,235,${0.35 + 0.65*(v/maxV)})`),
            line: { color: '#2563EB', width: 0.5 }
        },
        text: y.map(v => '$'+(v/1000).toFixed(0)+'K'),
        textposition: 'outside',
        textfont: { size: 9, color: t.tick }
    };
    const layout = {
        paper_bgcolor: t.paper, plot_bgcolor: t.plot,
        font: { family: 'Inter, sans-serif', color: t.tick, size: 10 },
        xaxis: { gridcolor: t.grid, tickfont: { size: 9, color: t.tick }, tickangle: -30, zeroline: false },
        yaxis: { gridcolor: t.grid, tickfont: { size: 9, color: t.tick }, tickformat: '$,.0f', zeroline: false },
        margin: { l: 62, r: 14, t: 38, b: 46 }
    };
    Plotly.newPlot('chart-bar', [trace], layout, { responsive: true, displayModeBar: false });
}

function renderPieChart(labels, values) {
    const t = getChartTheme();
    const colors = ['#2563EB','#0D9488','#D97706','#7C3AED','#DC2626','#0891B2'];
    const trace = {
        labels: labels, values: values, type: 'pie', hole: 0.55,
        marker: { colors: colors, line: { color: '#fff', width: 2 } },
        textinfo: 'percent',
        textfont: { size: 10, color: '#fff' },
        textposition: 'inside'
    };
    const layout = {
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
        font: { family: 'Inter, sans-serif', color: t.tick, size: 11 },
        margin: { l: 10, r: 10, t: 10, b: 40 },
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.1, font: { size: 10, color: t.tick } }
    };
    Plotly.newPlot('chart-pie', [trace], layout, { responsive: true, displayModeBar: false });
}

function renderMapChart(locations, values) {
    const t = getChartTheme();
    const dark = document.getElementById('html-root').classList.contains('dark');
    const trace = {
        type: 'choropleth', locationmode: 'country names',
        locations: locations, z: values,
        colorscale: [
            [0.0,  '#FFF7ED'],
            [0.25, '#FED7AA'],
            [0.5,  '#FB923C'],
            [0.75, '#EA580C'],
            [1.0,  '#9A3412']
        ],
        showscale: true,
        colorbar: {
            thickness: 10, len: 0.65, x: 1.01,
            title: { text: 'Revenue', font: { size: 9, color: t.tick } },
            tickfont: { color: t.tick, size: 9, family: 'Inter' },
            tickformat: '$,.0f'
        },
        hovertemplate: '<b>%{location}</b><br>Revenue: $%{z:,.0f}<extra></extra>'
    };
    const layout = {
        geo: {
            projection: { type: 'orthographic', scale: 1.0 },
            bgcolor: 'rgba(0,0,0,0)',
            showcoastlines: true,  coastlinecolor: dark ? '#475569' : '#94A3B8',
            showland: true,        landcolor:      dark ? '#1E293B' : '#E8ECF0',
            showocean: true,       oceancolor:     dark ? '#0C1A2E' : '#93C5FD',
            showframe: false,
            showlakes: true,       lakecolor:      dark ? '#0C1A2E' : '#BFDBFE',
            showcountries: true,   countrycolor:   dark ? '#334155' : '#CBD5E1',
            showrivers: false
        },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
        margin: { l: 0, r: 0, t: 0, b: 0 }
    };
    Plotly.newPlot('chart-map', [trace], layout, { responsive: true, displayModeBar: false });
}

// Run Models
function runForecast() {
    const status = document.getElementById('forecast-status');
    const btn = document.getElementById('btn-run-forecast');
    if (btn) btn.disabled = true;
    if (status) {
        status.style.display = 'inline-block';
        status.innerText = 'Calculating...';
    }

    return fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getFilterState())
    })
    .then(r => r.json())
    .then(data => {
        if (btn) btn.disabled = false;
        if (status) status.style.display = 'none';
        
        if(data.error) { throw new Error(data.error); }

        currentScenarios = {
            optimistic: data.optimistic.reduce((a,b)=>a+b,0),
            realistic: data.most_likely.reduce((a,b)=>a+b,0),
            pessimistic: data.pessimistic.reduce((a,b)=>a+b,0),
            confidence: data.confidence
        };

        // Update scenario boxes
        const optEl = document.getElementById('scenario-opt');
        const baseEl = document.getElementById('scenario-base');
        const pessEl = document.getElementById('scenario-pess');
        if (optEl) optEl.innerText = formatMoney(currentScenarios.optimistic);
        if (baseEl) baseEl.innerText = formatMoney(currentScenarios.realistic);
        if (pessEl) pessEl.innerText = formatMoney(currentScenarios.pessimistic);

        // Add forecast traces to chart
        const datesRev = [...data.dates].reverse();
        const pesRev = [...data.pessimistic].reverse();
        
        Plotly.addTraces('chart-forecast', [
            {
                x: data.dates.concat(datesRev),
                y: data.optimistic.concat(pesRev),
                fill: 'toself', fillcolor: 'rgba(37,99,235,0.08)',
                line: { color: 'transparent' }, name: 'Confidence Band', showlegend: false, hoverinfo: 'skip'
            },
            { x: data.dates, y: data.most_likely,  type: 'scatter', mode: 'lines', name: 'Baseline (Expected)',  line: { color: '#2563EB', width: 2.5 } },
            { x: data.dates, y: data.optimistic,   type: 'scatter', mode: 'lines', name: 'Optimistic',          line: { color: '#16A34A', width: 1.5, dash: 'dot' } },
            { x: data.dates, y: data.pessimistic,  type: 'scatter', mode: 'lines', name: 'Pessimistic',         line: { color: '#DC2626', width: 1.5, dash: 'dot' } }
        ]);
    })
    .catch(err => {
        btn.disabled = false;
        status.style.display = 'inline-block';
        status.innerText = 'Error: ' + err.message;
        console.error(err);
    });
}

// PDF Export
async function downloadPDF() {
    const btn = document.getElementById('btn-export-pdf');
    const oldText = btn.innerHTML;

    if(!currentScenarios) {
        // Instead of alerting, let's try to run forecast first
        btn.innerHTML = "Calculating Forecast...";
        btn.disabled = true;
        try {
            await runForecast();
            // runForecast sets currentScenarios globally
        } catch (e) {
            alert("Could not generate forecast data for PDF. Please try running it manually.");
            btn.innerHTML = oldText;
            btn.disabled = false;
            return;
        }
    }

    const payload = {
        scope: currentScope,
        kpis: {
            revenue: currentKpis.total_sales,
            units: currentKpis.units_sold,
            risk: currentKpis.risk
        },
        scenarios: currentScenarios
    };

    btn.innerHTML = "Generating PDF...";
    btn.disabled = true;

    fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.blob())
    .then(blob => {
        btn.innerHTML = oldText;
        btn.disabled = false;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; a.download = 'Nila_Strategy.pdf'; 
        document.body.appendChild(a); a.click(); a.remove();
    })
    .catch(err => { 
        btn.innerHTML = "Export Error";
        btn.disabled = false;
    });
}

// Chat UI
function handleChatKey(e) {
    if(e.key === 'Enter') sendChat();
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const val = input.value.trim();
    if (!val) return;

    const chatWindow = document.getElementById('chat-messages');
    chatWindow.innerHTML += `<div class="chat-msg chat-user">${val}</div>`;
    input.value = '';
    chatWindow.scrollTop = chatWindow.scrollHeight;

    fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: val, history: chatHistory })
    })
    .then(r => r.json())
    .then(data => {
        chatHistory.push({ role: 'user', content: val });
        chatHistory.push({ role: 'assistant', content: data.response });
        chatWindow.innerHTML += `<div class="chat-msg chat-bot">${data.response}</div>`;
        chatWindow.scrollTop = chatWindow.scrollHeight;
    });
}

// ── RESIZING LOGIC ──
function initResizers() {
    const main = document.getElementById('chart-main');
    const canvas = document.getElementById('db-canvas');
    const resV = document.getElementById('resizer-v');
    const resH = document.getElementById('resizer-h');

    if (resV) {
        let isDraggingV = false;
        resV.addEventListener('mousedown', () => isDraggingV = true);
        document.addEventListener('mousemove', (e) => {
            if (!isDraggingV) return;
            const rect = main.getBoundingClientRect();
            const offset = e.clientX - rect.left;
            const percentage = (offset / rect.width) * 100;
            if (percentage > 20 && percentage < 80) {
                main.style.setProperty('--main-cols', `${percentage}% 10px 1fr`);
                window.dispatchEvent(new Event('resize'));
            }
        });
        document.addEventListener('mouseup', () => isDraggingV = false);
    }

    if (resH) {
        let isDraggingH = false;
        resH.addEventListener('mousedown', () => isDraggingH = true);
        document.addEventListener('mousemove', (e) => {
            if (!isDraggingH) return;
            const rect = canvas.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            const percentage = (offset / rect.height) * 100;
            // Row order: KPI(82px) + Gap(12px) + R2(Main) + Resizer(10px) + R3(Bottom)
            if (percentage > 30 && percentage < 85) {
                canvas.style.setProperty('--db-rows', `82px 12px ${percentage - 15}% 10px 1fr`);
                window.dispatchEvent(new Event('resize'));
            }
        });
        document.addEventListener('mouseup', () => isDraggingH = false);
    }
}
