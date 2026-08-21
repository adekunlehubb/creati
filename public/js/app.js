// ============================================================
// CreatiHub Shared JS — auth, currency, navbar, AI chat widget
// ============================================================
const API = {
  token: () => localStorage.getItem('ch_token'),
  user: () => JSON.parse(localStorage.getItem('ch_user') || 'null'),
  setSession(token, user) {
    localStorage.setItem('ch_token', token);
    localStorage.setItem('ch_user', JSON.stringify(user));
  },
  clear() { localStorage.removeItem('ch_token'); localStorage.removeItem('ch_user'); },
  async req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (API.token()) headers['x-token'] = API.token();
    const res = await fetch('/api' + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get: (p) => API.req(p),
  post: (p, body) => API.req(p, { method: 'POST', body: JSON.stringify(body) }),
  put: (p, body) => API.req(p, { method: 'PUT', body: JSON.stringify(body) })
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'INR', 'KES', 'ZAR', 'CAD', 'AUD', 'AED', 'BRL', 'PHP'];
const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, INR: 83.2, KES: 129, ZAR: 18.4, CAD: 1.36, AUD: 1.52, AED: 3.67, BRL: 5.05, PHP: 58.5 };
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', NGN: '₦', INR: '₹', KES: 'KSh ', ZAR: 'R', CAD: 'C$', AUD: 'A$', AED: 'د.إ', BRL: 'R$', PHP: '₱' };

function getCurrency() {
  const u = API.user();
  return localStorage.getItem('ch_currency') || (u && u.currency) || 'USD';
}
function setCurrency(c) { localStorage.setItem('ch_currency', c); }
function fmt(usd) {
  const c = getCurrency();
  const val = usd * (RATES[c] || 1);
  const rounded = val >= 100 ? Math.round(val) : Math.round(val * 100) / 100;
  return (SYMBOLS[c] || '$') + rounded.toLocaleString();
}
// Dual-currency formatter: shows USD and NGN side by side
// e.g. fmtDual(45) => "$45 / ₦69,750"
function fmtDual(usd) {
  const usdStr = '$' + (usd >= 100 ? Math.round(usd) : Math.round(usd * 100) / 100).toLocaleString();
  const ngnVal = Math.round(usd * (RATES.NGN || 1550));
  const ngnStr = '\u20a6' + ngnVal.toLocaleString();
  return '<span class="dual-price"><span class="dual-usd">' + usdStr + '</span><span class="dual-sep"> / </span><span class="dual-ngn">' + ngnStr + '</span></span>';
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ---------------- Navbar ----------------
function renderNav(active) {
  const user = API.user();
  const cur = getCurrency();
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="logo">✦ <span>CreatiHub</span></a>
      <button class="hamburger" onclick="document.querySelector('.nav-links').classList.toggle('open')">☰</button>
      <div class="nav-links">
        <a href="/" class="${active === 'home' ? 'active' : ''}">Home</a>
        <a href="/services" class="${active === 'services' ? 'active' : ''}">Services</a>
        ${user && user.role === 'admin' ? `<a href="/admin" class="${active === 'admin' ? 'active' : ''}">Admin</a>` : ''}
        ${user && user.role !== 'admin' ? `<a href="/dashboard" class="${active === 'dashboard' ? 'active' : ''}">Dashboard</a>` : ''}
      </div>
      <div class="nav-right">
        <select class="currency-select" id="curSel" title="Currency">
          ${CURRENCIES.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        ${user
          ? `<span style="font-size:.9rem;color:var(--muted)">Hi, <b style="color:var(--text)">${esc(user.name.split(' ')[0])}</b></span>
             <button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button>`
          : `<a href="/auth" class="btn btn-ghost btn-sm">Log in</a>
             <a href="/auth?mode=register" class="btn btn-primary btn-sm">Get Started</a>`}
      </div>
    </div>`;
  document.body.prepend(nav);
  document.getElementById('curSel').addEventListener('change', async e => {
    setCurrency(e.target.value);
    if (API.user()) { try { await API.put('/me/currency', { currency: e.target.value }); } catch {} }
    toast('Currency set to ' + e.target.value);
    setTimeout(() => location.reload(), 400);
  });
  const lb = document.getElementById('logoutBtn');
  if (lb) lb.addEventListener('click', async () => {
    try { await API.post('/logout'); } catch {}
    API.clear();
    location.href = '/';
  });
}

// ---------------- AI Chat Widget (Nova) ----------------
function initChatWidget() {
  const fab = document.createElement('button');
  fab.className = 'chat-fab';
  fab.innerHTML = '🤖';
  fab.title = 'Chat with Nova AI';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'chat-panel';
  panel.innerHTML = `
    <div class="chat-head">
      <div class="nova">✦</div>
      <div><b>Nova AI</b><small>Online • replies instantly</small></div>
    </div>
    <div class="chat-body" id="chatBody"></div>
    <div class="chat-sugg" id="chatSugg"></div>
    <div class="chat-input">
      <input id="chatIn" placeholder="Ask me anything..." maxlength="500" />
      <button id="chatSend">➤</button>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('#chatBody');
  const sugg = panel.querySelector('#chatSugg');
  const input = panel.querySelector('#chatIn');
  let greeted = false;

  fab.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !greeted) {
      greeted = true;
      sendMsg('hello', true);
    }
    if (panel.classList.contains('open')) input.focus();
  });

  function addMsg(text, who) {
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (who === 'me' ? 'me' : 'bot');
    d.innerHTML = mdLite(text);
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }
  function setSuggestions(list) {
    sugg.innerHTML = '';
    (list || []).forEach(s => {
      const b = document.createElement('button');
      b.textContent = s;
      b.addEventListener('click', () => sendMsg(s));
      sugg.appendChild(b);
    });
  }
  async function sendMsg(text, silent) {
    if (!text.trim()) return;
    if (!silent) addMsg(text, 'me');
    input.value = '';
    setSuggestions([]);
    const typing = document.createElement('div');
    typing.className = 'chat-msg bot typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    try {
      const res = await API.post('/chat', { message: text });
      typing.remove();
      addMsg(res.reply, 'bot');
      setSuggestions(res.suggestions);
      if (res.serviceId) {
        const b = document.createElement('button');
        b.textContent = '→ Order ' + res.serviceId.replace(/-/g, ' ');
        b.addEventListener('click', () => location.href = '/order?service=' + res.serviceId);
        sugg.appendChild(b);
      }
    } catch (e) {
      typing.remove();
      addMsg('Sorry, I had trouble responding. Please try again!', 'bot');
    }
  }
  document.getElementById('chatSend').addEventListener('click', () => sendMsg(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(input.value); });
}

// ---------------- Footer ----------------
function renderFooter() {
  const f = document.createElement('footer');
  f.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="logo" style="margin-bottom:14px">✦ <span>CreatiHub</span></div>
          <p style="color:var(--muted);font-size:.88rem;line-height:1.6">Your global creative services marketplace. Flyers, videos, cartoons, websites & more — delivered worldwide, powered by AI.</p>
        </div>
        <div>
          <h5>Services</h5>
          <a href="/order?service=flyer-design">Flyer Design</a>
          <a href="/order?service=automated-video">Automated Videos</a>
          <a href="/order?service=cartoon-maker">Cartoon Maker</a>
          <a href="/order?service=logo-design">Logo Design</a>
        </div>
        <div>
          <h5>Company</h5>
          <a href="/services">All Services</a>
          <a href="/dashboard">My Dashboard</a>
          <a href="/auth">Create Account</a>
        </div>
        <div>
          <h5>Support</h5>
          <a href="#" onclick="document.querySelector('.chat-fab').click();return false;">24/7 AI Support</a>
          <a href="/#faq">FAQ</a>
          <a href="/#how">How It Works</a>
        </div>
      </div>
      <div class="footer-bottom">© ${new Date().getFullYear()} CreatiHub — Serving creators in 190+ countries 🌍</div>
    </div>`;
  document.body.appendChild(f);
}
