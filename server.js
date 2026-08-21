// ============================================================
// CreatiHub Server - Global Creative Services Marketplace
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');

// --- Database backend selection -------------------------------------
// If DATABASE_URL is set, use the PostgreSQL adapter (db-pg.js) for
// bulletproof persistence. Otherwise use the JSON-file backend (db.js).
// Both export the same function surface so the rest of the server is
// identical regardless of backend.
const USE_POSTGRES = !!process.env.DATABASE_URL;
const dbBackend = USE_POSTGRES ? require('./db-pg') : require('./db');
const { getDb, save, uid, hashPassword, makeToken, logActivity, notify, sendEmail, createResetCode, verifyResetCode, consumeResetCode, revokeUserTokens, logAiActivity, aiAuditLog, logPriceChange, markNotificationRead, markAllNotificationsRead } = dbBackend;
if (USE_POSTGRES) console.log('🐘 Using PostgreSQL backend (DATABASE_URL detected)');
else console.log('📄 Using JSON-file backend (set DATABASE_URL to enable PostgreSQL)');

const { userAssistant, adminAssistant, safeUserAssistant, safeAdminAssistant, convertPrice, CURRENCY_RATES } = require('./ai');
const paystack = require('./paystack');
const backup = require('./backup');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Paystack webhook (needs RAW body for signature check) ----------------
// Must be registered BEFORE express.json() so we can verify the HMAC signature.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!paystack.verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad payload' }); }

  if (event.event === 'charge.success') {
    const ref = event.data && event.data.reference;
    const order = ref && db.orders.find(o => o.paymentReference === ref);
    if (order && order.paymentStatus !== 'paid') {
      markOrderPaid(order, {
        channel: event.data.channel,
        paidAt: event.data.paid_at,
        amount: event.data.amount,
        currency: event.data.currency,
        source: 'webhook'
      });
    }
    // Recurring subscription charge: Paystack sends charge.success with a
    // subscription code on each billing cycle. Update the subscription record.
    const subCode = event.data && event.data.subscription && event.data.subscription.subscription_code;
    if (subCode) {
      const sub = db.subscriptions.find(s => s.subscriptionCode === subCode);
      if (sub) {
        sub.status = 'active';
        sub.lastChargeAt = event.data.paid_at || new Date().toISOString();
        sub.lastChargeReference = ref;
        // Paystack bills monthly in advance; push the period end forward ~30d
        const next = new Date();
        next.setMonth(next.getMonth() + 1);
        sub.currentPeriodEnd = next.toISOString();
        save();
        logActivity('payment', `Recurring charge for ${sub.planName}`,
          `Subscription ${sub.id} (${sub.planName}) charged successfully — ref ${ref}`);
      }
    }
  }

  // A new subscription was created (first successful authorization charge)
  if (event.event === 'subscription.create') {
    const data = event.data || {};
    const subCode = data.subscription_code;
    const ref = data.reference;
    const sub = ref && db.subscriptions.find(s => s.reference === ref);
    if (sub) {
      sub.subscriptionCode = subCode;
      sub.status = 'active';
      sub.activatedAt = new Date().toISOString();
      const next = new Date(); next.setMonth(next.getMonth() + 1);
      sub.currentPeriodEnd = next.toISOString();
      save();
      logActivity('payment', `Subscription activated: ${sub.planName}`,
        `Subscription ${sub.id} activated on Paystack — code ${subCode}`);
    }
  }

  // Subscription cancelled / disabled
  if (event.event === 'subscription.disable' || event.event === 'subscription.not_active') {
    const data = event.data || {};
    const subCode = data.subscription_code;
    const sub = db.subscriptions.find(s => s.subscriptionCode === subCode);
    if (sub && sub.status !== 'cancelled') {
      sub.status = 'cancelled';
      sub.cancelledAt = new Date().toISOString();
      save();
      logActivity('payment', `Subscription cancelled: ${sub.planName}`,
        `Subscription ${sub.id} was cancelled — code ${subCode}`);
    }
  }

  res.sendStatus(200); // always ack quickly so Paystack doesn't retry
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// The in-memory db object. For the JSON backend this is populated synchronously
// via getDb(). For the PostgreSQL backend it is hydrated asynchronously by
// dbBackend.load() during boot (see the async start() at the bottom).
let db;
if (!USE_POSTGRES) db = getDb();

// ---------------- Auth helpers ----------------
function auth(req, res, next) {
  const token = req.headers['x-token'];
  const userId = token && db.tokens[token];
  const user = userId && db.users.find(u => u && u.id === userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}

// ---------------- Payment helpers ----------------
// Marks an order as paid (idempotent) and fires notifications/activity.
function markOrderPaid(order, info = {}) {
  if (order.paymentStatus === 'paid' && !info.installment) return order; // idempotent
  // ---- Installment tracking ----
  if (order.installmentSplits > 1 && info.installment) {
    // A subsequent installment payment
    order.installments = order.installments || [];
    order.installments.push({ index: order.installments.length + 1, amountUsd: info.amountUsd, reference: info.reference, status: 'paid', paidAt: info.paidAt || new Date().toISOString() });
    order.installmentPaidUsd = (order.installmentPaidUsd || 0) + (info.amountUsd || 0);
    const fullyPaid = order.installmentPaidUsd >= (order.price - (order.referralDiscountUsd || 0) - (order.creditAppliedUsd || 0)) - 0.01;
    if (fullyPaid) {
      order.paymentStatus = 'paid';
      order.paidAt = info.paidAt || new Date().toISOString();
    }
    order.timeline.push({ status: fullyPaid ? 'pending' : 'in_progress', at: new Date().toISOString(), note: `Installment ${order.installments.length} paid ($${info.amountUsd})${fullyPaid ? ' — order fully paid' : ' — balance pending'}` });
    save();
    logActivity('payment', `Installment received for ${order.id}`, `${order.userName} paid installment ${order.installments.length} ($${info.amountUsd}) for ${order.serviceName}.`);
    notify('payment', `Installment received — ${order.id}`, `${order.userName} paid installment ${order.installments.length} of ${order.installmentSplits} ($${info.amountUsd}).${fullyPaid ? ' Order is now fully paid.' : ' Balance still pending.'}`);
    return order;
  }
  order.paymentStatus = 'paid';
  order.paidAt = info.paidAt || new Date().toISOString();
  order.paymentChannel = info.channel || 'card';
  if (info.amount != null) order.paidAmount = info.amount;
  if (info.currency) order.paidCurrency = info.currency;

  // ---- Track first installment deposit ----
  if (order.installmentSplits > 1) {
    const plans = Array.isArray(db.settings.installmentPlans) ? db.settings.installmentPlans : [];
    const plan = plans.find(p => p.id === order.installmentPlan) || {};
    const depositPct = typeof plan.depositPct === 'number' ? plan.depositPct : 100;
    const netTotal = order.price - (order.referralDiscountUsd || 0) - (order.creditAppliedUsd || 0);
    const depositUsd = Math.round(netTotal * depositPct) / 100;
    order.installmentPaidUsd = (order.installmentPaidUsd || 0) + depositUsd;
    order.installments = order.installments || [];
    if (!order.installments.find(it => it.reference === order.paymentReference)) {
      order.installments.push({ index: 1, amountUsd: depositUsd, reference: order.paymentReference, status: 'paid', paidAt: order.paidAt });
    }
    order.status = 'in_progress'; // work can start on deposit for installment orders
  } else {
    order.status = 'pending';
  }

  order.timeline.push({
    status: order.status,
    at: new Date().toISOString(),
    note: `Payment confirmed via Paystack${info.channel ? ' (' + info.channel + ')' : ''}${info.source === 'webhook' ? ' [webhook]' : ''}${order.installmentSplits > 1 ? ' — deposit received, balance pending' : ''}`
  });

  // ---- Award referral credit to the referrer (on first paid payment) ----
  if (order.referralApplied && order.referralApplied.referrerId) {
    const referrer = db.users.find(u => u.id === order.referralApplied.referrerId);
    if (referrer) {
      const refCfg = db.settings.referral || { creditUsd: 2 };
      const credit = refCfg.creditUsd || 0;
      referrer.referralCredit = (typeof referrer.referralCredit === 'number' ? referrer.referralCredit : 0) + credit;
      db.referrals = db.referrals || [];
      if (!db.referrals.find(r => r.orderId === order.id)) {
        db.referrals.push({ id: uid('ref'), referrerId: referrer.id, referrerName: referrer.name, code: order.referralApplied.code, referredUserId: order.userId, referredName: order.userName, orderId: order.id, credit, status: 'credited', at: new Date().toISOString() });
      }
      logActivity('referral', `Referral credit awarded to ${referrer.name}`, `${referrer.name} earned $${credit} credit — referred ${order.userName} (order ${order.id}).`);
    }
  }

  // ---- Deduct applied user credit (referral balance) ----
  if (order.creditAppliedUsd > 0) {
    const buyer = db.users.find(u => u.id === order.userId);
    if (buyer) {
      buyer.referralCredit = Math.max(0, (typeof buyer.referralCredit === 'number' ? buyer.referralCredit : 0) - order.creditAppliedUsd);
    }
  }

  save();
  logActivity('payment', `Payment received for ${order.id}`,
    `${order.userName} paid for ${order.serviceName} (${order.packageName}) — $${order.price}${order.installmentSplits > 1 ? ' (installment: deposit paid)' : ''} via Paystack${info.channel ? ' / ' + info.channel : ''}`);
  notify('payment', `Payment confirmed — ${order.id}`,
    `${order.userName} (${order.userEmail}) paid for:\n\n• Service: ${order.serviceName}\n• Package: ${order.packageName}\n• Amount: $${order.price}${order.installmentSplits > 1 ? ' (installment plan)' : ''}\n• Reference: ${order.paymentReference}\n• Channel: ${order.paymentChannel}\n• Delivery: ${order.whatsappDelivery ? 'WhatsApp ' + (order.whatsappNumber || '') : 'Email'}\n\nThe order is now in your queue.`);

  // Email the buyer a payment confirmation (fire-and-forget, non-blocking)
  const _fullyPaidNow = order.installmentSplits > 1
    ? (order.installmentPaidUsd >= order.price)
    : true;
  sendEmail(order.userEmail, 'Payment confirmed — ' + order.id,
    'Hi ' + order.userName + ',\n\n' +
    'We have received your payment! Here is your receipt:\n\n' +
    '• Order ID: ' + order.id + '\n' +
    '• Service: ' + order.serviceName + '\n' +
    '• Package: ' + order.packageName + '\n' +
    '• Amount paid: $' + order.price + (order.installmentSplits > 1 ? (_fullyPaidNow ? ' (fully paid)' : ' (installment — deposit received)') : '') + '\n' +
    '• Payment reference: ' + order.paymentReference + '\n' +
    '• Payment channel: ' + (order.paymentChannel || 'Paystack') + '\n\n' +
    (order.installmentSplits > 1 && !_fullyPaidNow ? 'Your remaining installments can be paid from your dashboard anytime.\n\n' : '') +
    'Your order is now in our creative queue. Our team will start working on it right away. You will receive email updates as your order progresses through each stage.\n\n' +
    (order.whatsappDelivery ? 'Delivery method: WhatsApp (' + (order.whatsappNumber || '') + ')' : 'Delivery method: Email') + '\n\n' +
    'Track your order in real-time from your dashboard: https://creatihub.com.ng\n\n' +
    '— The CreatiHub Team').catch(() => {});

  return order;
}

// ---------------- Auth routes ----------------
app.post('/api/register', (req, res) => {
  const { name, email, password, country, currency } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const emailLower = email.toLowerCase().trim();
  if (db.users.some(u => u && u.email === emailLower)) return res.status(409).json({ error: 'Email already registered' });
  const user = {
    id: uid('u'), name: name.trim(), email: emailLower,
    password: hashPassword(password), role: 'user',
    country: country || 'US', currency: currency || 'USD',
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  const token = makeToken();
  db.tokens[token] = user.id;
  save();

  // Send a welcome email to the new user (fire-and-forget, non-blocking)
  sendEmail(user.email, 'Welcome to CreatiHub!',
    'Hi ' + user.name + ',\n\n' +
    'Welcome to CreatiHub — Nigeria\'s creative services marketplace!\n\n' +
    'Your account is ready. Here\'s what you can do next:\n\n' +
    '• Browse our creative services (logos, social media, websites, branding & more)\n' +
    '• Place an order in just a few clicks with secure Paystack payment\n' +
    '• Track your order progress in real-time from your dashboard\n' +
    '• Chat with Nova, our AI assistant, for instant help 24/7\n\n' +
    'If you have any questions, just reply to this email or use the support chat on the website.\n\n' +
    'We\'re excited to create something amazing with you!\n\n' +
    '— The CreatiHub Team\nhttps://creatihub.com.ng').catch(() => {});

  res.json({ token, user: publicUser(user) });
});

// ---------------------------------------------------------------------------
// Auth rate limiter — prevents brute-force attacks on login / forgot / reset.
// Tracks attempts per IP address in memory. 10 attempts per 15-minute window.
// Resets on successful login. Does NOT block the admin dashboard from working.
// ---------------------------------------------------------------------------
const authAttempts = new Map(); // ip -> { count, firstAt }
const AUTH_RATE_LIMIT_MAX = 15;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function authRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now - entry.firstAt > AUTH_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, firstAt: now };
    authAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > AUTH_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.firstAt + AUTH_RATE_LIMIT_WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
  }
  next();
}

// Clear rate-limit counter on successful login
function clearAuthRateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  authAttempts.delete(ip);
}

app.post('/api/login', authRateLimit, (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find(u => u && u.email === (email || '').toLowerCase().trim());
  if (!user || user.password !== hashPassword(password || '')) {
    // Only FAILED login attempts count toward rate limit
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = makeToken();
  db.tokens[token] = user.id;
  save();
  clearAuthRateLimit(req);  // successful login clears the counter
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers['x-token'];
  delete db.tokens[token];
  save();
  res.json({ ok: true });
});

// ---------------- Password reset (works for BOTH users and admins) ----------------
// Step 1: request a reset code. In production this is emailed; in demo mode the
// code is returned in the response so the flow can be completed end-to-end.
app.post('/api/forgot-password', authRateLimit, (req, res) => {
  const { email } = req.body || {};
  const emailLower = (email || '').toLowerCase().trim();
  const user = db.users.find(u => u && u.email === emailLower);
  // Always respond the same way so the endpoint can't be used to enumerate accounts
  if (!user) {
    return res.json({ ok: true, message: 'If that email is registered, a reset code has been sent.' });
  }
  const code = createResetCode(user.id);
  // Queue a real email (wire SMTP/provider in db.js -> sendEmail to actually deliver)
  sendEmail(user.email, '[CreatiHub] Your password reset code',
    `Hi ${user.name},\n\nYour CreatiHub password reset code is: ${code}\n\nIt expires in 15 minutes. If you did not request this, you can ignore this email.\n\n— CreatiHub Security`);
  logActivity('security', 'Password reset requested', `${user.name} (${user.email}) requested a reset code`);
  // Only expose the reset code in the API response when running in demo mode
  // (no Paystack secret key configured). In production with live keys, the code
  // is only delivered via email and NEVER returned by the API.
  const isProduction = !!process.env.PAYSTACK_SECRET_KEY;
  const response = {
    ok: true,
    message: 'If that email is registered, a reset code has been sent.'
  };
  if (!isProduction) {
    response.demoCode = code;
    response.role = user.role;
  }
  res.json(response);
});

// Step 2: submit code + new password
app.post('/api/reset-password', authRateLimit, (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) return res.status(400).json({ error: 'Email, code and new password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = db.users.find(u => u && u.email === email.toLowerCase().trim());
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset code' });
  const userId = verifyResetCode(code);
  if (!userId || userId !== user.id) return res.status(400).json({ error: 'Invalid or expired reset code' });
  user.password = hashPassword(password);
  consumeResetCode(code);
  revokeUserTokens(user.id);           // force re-login everywhere with new password
  save();
  logActivity('security', 'Password reset completed', `${user.name} (${user.email}) reset their password`);
  res.json({ ok: true, message: 'Password updated. Please log in with your new password.' });
});

// ---------------- Logged-in credential changes (users AND admins) ----------------
// Change password while logged in (requires current password)
app.put('/api/me/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  if (req.user.password !== hashPassword(currentPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  req.user.password = hashPassword(newPassword);
  // Keep the current session alive, revoke all other sessions
  const currentToken = req.headers['x-token'];
  Object.keys(db.tokens).forEach(t => { if (db.tokens[t] === req.user.id && t !== currentToken) delete db.tokens[t]; });
  save();
  logActivity('security', 'Password changed', `${req.user.name} (${req.user.email}) changed their password`);
  res.json({ ok: true, message: 'Password updated successfully' });
});

// Change login email (requires password confirmation)
app.put('/api/me/email', auth, (req, res) => {
  const { newEmail, password } = req.body || {};
  const emailLower = (newEmail || '').toLowerCase().trim();
  if (!emailLower || !password) return res.status(400).json({ error: 'New email and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (req.user.password !== hashPassword(password)) return res.status(401).json({ error: 'Password is incorrect' });
  if (db.users.some(u => u && u.email === emailLower && u.id !== req.user.id)) {
    return res.status(409).json({ error: 'That email is already in use by another account' });
  }
  const old = req.user.email;
  req.user.email = emailLower;
  save();
  logActivity('security', 'Login email changed', `${req.user.name} changed email from ${old} to ${emailLower}`);
  res.json({ ok: true, message: 'Login email updated', user: publicUser(req.user) });
});

app.put('/api/me/currency', auth, (req, res) => {
  const { currency } = req.body || {};
  if (!CURRENCY_RATES[currency]) return res.status(400).json({ error: 'Unsupported currency' });
  req.user.currency = currency;
  save();
  res.json({ user: publicUser(req.user) });
});

// ---------------- Services ----------------
app.get('/api/services', (req, res) => {
  const cur = req.query.currency || 'USD';
  const services = db.services.map(s => ({
    ...s,
    packages: s.packages.map(p => ({ ...p, localPrice: convertPrice(p.price, cur) }))
  }));
  res.json({ services });
});

app.get('/api/services/:id', (req, res) => {
  const svc = db.services.find(s => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const cur = req.query.currency || 'USD';
  res.json({ service: { ...svc, packages: svc.packages.map(p => ({ ...p, localPrice: convertPrice(p.price, cur) })) } });
});

// ---------------- Orders & Paystack Payments ----------------
// Step 1: create the order (status: awaiting_payment) + initialize a Paystack
// transaction. The frontend then opens the Paystack checkout (popup or redirect).
// Compute order add-ons + rush surcharge. Returns { addons, rushSurcharge, totalUsd, breakdown }
function computeOrderExtras(pkg, body) {
  const settings = db.settings || {};
  const rushCfg = settings.rushDelivery || { enabled: false };
  const addonCatalog = Array.isArray(settings.addons) ? settings.addons : [];

  // Rush delivery surcharge
  let rushSurcharge = 0;
  const rush = !!body.rushDelivery && rushCfg.enabled;
  if (rush) {
    const rate = typeof rushCfg.surchargeRate === 'number' ? rushCfg.surchargeRate : 0.35;
    const min = typeof rushCfg.minSurcharge === 'number' ? rushCfg.minSurcharge : 5;
    rushSurcharge = Math.max(pkg.price * rate, min);
  }

  // Selected add-ons (validate against catalog to prevent price tampering)
  const requested = Array.isArray(body.addons) ? body.addons : [];
  const byId = new Map(addonCatalog.map(a => [a.id, a]));
  const addons = requested
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(a => ({ id: a.id, name: a.name, price: a.price }));

  const addonsTotal = addons.reduce((s, a) => s + a.price, 0);
  const basePrice = pkg.price;
  const totalUsd = Math.round((basePrice + rushSurcharge + addonsTotal) * 100) / 100;

  return { rush, rushSurcharge, addons, addonsTotal, basePrice, totalUsd };
}

app.post('/api/orders', auth, async (req, res) => {
  const { serviceId, packageId, requirements } = req.body || {};
  const svc = db.services.find(s => s.id === serviceId);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const pkg = svc.packages.find(p => p.id === packageId);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });

  // Compute upsells (rush + add-ons) server-side so prices can't be tampered with
  const extras = computeOrderExtras(pkg, req.body);

  const displayCurrency = req.user.currency || 'USD';

  // ---- Installment plan selection (Phase 8) ----
  // If the buyer chose an installment plan, only charge the deposit now.
  // The remainder is tracked on the order and charged via /api/installments/:id/pay.
  const installmentPlans = Array.isArray(db.settings.installmentPlans) ? db.settings.installmentPlans : [];
  const installPlanId = req.body.installmentPlan || 'pay-full';
  const installPlan = installmentPlans.find(p => p.id === installPlanId) || installmentPlans[0] || { id: 'pay-full', splits: 1, depositPct: 100 };
  const isInstallment = installPlan.splits > 1;
  const depositPct = typeof installPlan.depositPct === 'number' ? installPlan.depositPct : 100;
  const dueNowUsd = isInstallment
    ? Math.round(extras.totalUsd * depositPct) / 100
    : extras.totalUsd;

  // ---- Referral code application (Phase 8) ----
  // If the buyer supplied a referral code, validate it and award credit.
  // The referred (new) buyer gets a discount on this order; the referrer gets
  // credit after the order is paid (handled in payment verification).
  let referralApplied = null;
  let referralDiscountUsd = 0;
  const refCfg = db.settings.referral || { enabled: false };
  if (refCfg.enabled && req.body.referralCode) {
    const code = String(req.body.referralCode).trim().toUpperCase();
    const referrer = db.users.find(u => (u.referralCode || '').toUpperCase() === code && u.id !== req.user.id);
    if (referrer) {
      referralDiscountUsd = Math.min(refCfg.bonusUsd || 0, dueNowUsd);
      referralApplied = { referrerId: referrer.id, referrerName: referrer.name, code, discountUsd: referralDiscountUsd };
    }
  }

  // ---- Existing user credit (referral credit balance) ----
  const userCredit = typeof req.user.referralCredit === 'number' ? req.user.referralCredit : 0;
  const creditApplied = Math.min(userCredit, dueNowUsd - referralDiscountUsd);

  const chargeableUsd = Math.max(0, Math.round((dueNowUsd - referralDiscountUsd - creditApplied) * 100) / 100);
  const charge = paystack.toChargeAmount(chargeableUsd, displayCurrency, CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();

  const order = {
    id: 'CH-' + (db.orderCounter++),
    userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
    serviceId: svc.id, serviceName: svc.name,
    packageId: pkg.id, packageName: pkg.name,
    price: extras.totalUsd,                 // total order value (incl. upsells)
    basePrice: extras.basePrice,            // package base price (for analytics)
    currency: 'USD',
    rushDelivery: extras.rush,
    rushSurcharge: extras.rushSurcharge,
    addons: extras.addons,                  // [{id,name,price}]
    addonsTotal: extras.addonsTotal,
    // ---- Installments ----
    installmentPlan: installPlan.id,
    installmentSplits: installPlan.splits,
    installmentPaidUsd: 0,                  // accumulates as installments are paid
    installments: [],                       // [{index, amountUsd, reference, status, paidAt}]
    // ---- WhatsApp delivery preference ----
    whatsappDelivery: !!req.body.whatsappDelivery,
    whatsappNumber: req.body.whatsappNumber || '',
    // ---- Referral + credit ----
    referralApplied,
    referralDiscountUsd,
    creditAppliedUsd: creditApplied,
    status: 'awaiting_payment',
    requirements: requirements || '',
    paymentMethod: 'paystack',
    paymentReference: reference,
    paymentStatus: 'unpaid',
    chargeCurrency: charge.currency,
    chargeAmount: charge.amount,
    createdAt: new Date().toISOString(),
    timeline: [{ status: 'awaiting_payment', at: new Date().toISOString(), note: 'Order created — awaiting Paystack payment' + (isInstallment ? ` (${installPlan.name}: ${depositPct}% deposit)` : '') }]
  };

  const baseUrl = process.env.PAYSTACK_CALLBACK_URL ||
    (req.protocol + '://' + req.get('host') + '/payment/callback');

  try {
    const init = await paystack.initializeTransaction({
      email: req.user.email,
      amount: charge.amount,
      currency: charge.currency,
      reference,
      callbackUrl: baseUrl,
      metadata: {
        order_id: order.id,
        service: svc.name,
        package: pkg.name,

        customer_name: req.user.name,
        custom_fields: [
          { display_name: 'Order ID', variable_name: 'order_id', value: order.id },
          { display_name: 'Service', variable_name: 'service', value: svc.name },
          { display_name: 'Rush', variable_name: 'rush', value: extras.rush ? 'Yes (+' + extras.rushSurcharge + ' USD)' : 'No' },
          { display_name: 'Add-ons', variable_name: 'addons', value: extras.addons.map(a => a.name).join(', ') || 'None' }
        ]
      }
    });

    order.paymentAccessCode = init.data.access_code;
    db.orders.push(order);
    save();
    logActivity('order', `New order ${order.id} (awaiting payment)`,
      `${req.user.name} ordered ${svc.name} (${pkg.name}) — $${extras.totalUsd}${extras.rush ? ' [RUSH]' : ''}${extras.addons.length ? ' + addons' : ''} — ref ${reference}`);

    // Email the buyer an order confirmation (fire-and-forget, non-blocking)
    sendEmail(req.user.email, 'Order placed — ' + order.id,
      'Hi ' + req.user.name + ',\n\n' +
      'Thank you for your order! Here are the details:\n\n' +
      '• Order ID: ' + order.id + '\n' +
      '• Service: ' + svc.name + '\n' +
      '• Package: ' + pkg.name + '\n' +
      '• Total: $' + extras.totalUsd + (isInstallment ? ' (Installment plan — $' + dueNowUsd + ' deposit due now)' : '') + '\n' +
      '• Rush delivery: ' + (extras.rush ? 'Yes' : 'No') + '\n' +
      '• Add-ons: ' + (extras.addons.map(a => a.name).join(', ') || 'None') + '\n' +
      '• Payment reference: ' + reference + '\n\n' +
      'Next step: Complete your payment via Paystack. Once payment is confirmed, your order moves into our creative queue and you will receive another email update.\n\n' +
      'You can track your order anytime from your CreatiHub dashboard.\n\n' +
      '— The CreatiHub Team\nhttps://creatihub.com.ng').catch(() => {});

    res.json({
      order,
      payment: {
        reference,
        accessCode: init.data.access_code,
        authorizationUrl: init.data.authorization_url,
        amount: charge.amount,
        currency: charge.currency,
        publicKey: paystack.publicKey(),
        demo: paystack.isDemo()
      }
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not initialize payment: ' + e.message });
  }
});

// Step 2: verify payment after the customer returns from Paystack.
// Called by the payment callback page (and as a fallback from the popup flow).
app.get('/api/payments/verify/:reference', auth, async (req, res) => {
  const order = db.orders.find(o => o.paymentReference === req.params.reference);
  if (!order) return res.status(404).json({ error: 'Order not found for this reference' });
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'This payment belongs to another account' });
  }
  if (order.paymentStatus === 'paid') return res.json({ order, alreadyPaid: true });

  try {
    const v = await paystack.verifyTransaction(order.paymentReference);
    if (v.paid) {
      markOrderPaid(order, { channel: v.channel, paidAt: v.paidAt, amount: v.amount, currency: v.currency });
      return res.json({ order, paid: true });
    }
    order.timeline.push({ status: 'awaiting_payment', at: new Date().toISOString(), note: 'Payment not completed (status: ' + v.status + ')' });
    save();
    res.status(402).json({ error: 'Payment not completed', status: v.status, order });
  } catch (e) {
    res.status(502).json({ error: 'Could not verify payment: ' + e.message });
  }
});

// Let a logged-in user re-try payment for an unpaid order
app.post('/api/orders/:id/repay', auth, async (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentStatus === 'paid') return res.status(400).json({ error: 'This order is already paid' });

  const charge = paystack.toChargeAmount(order.price, req.user.currency || 'USD', CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();
  const baseUrl = process.env.PAYSTACK_CALLBACK_URL ||
    (req.protocol + '://' + req.get('host') + '/payment/callback');

  try {
    const init = await paystack.initializeTransaction({
      email: req.user.email, amount: charge.amount, currency: charge.currency,
      reference, callbackUrl: baseUrl,
      metadata: { order_id: order.id, service: order.serviceName, package: order.packageName, retry: true }
    });
    order.paymentReference = reference;
    order.paymentAccessCode = init.data.access_code;
    order.chargeCurrency = charge.currency;
    order.chargeAmount = charge.amount;
    order.timeline.push({ status: 'awaiting_payment', at: new Date().toISOString(), note: 'Payment retried — new reference ' + reference });
    save();
    res.json({
      order,
      payment: {
        reference, accessCode: init.data.access_code, authorizationUrl: init.data.authorization_url,
        amount: charge.amount, currency: charge.currency, publicKey: paystack.publicKey(), demo: paystack.isDemo()
      }
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not initialize payment: ' + e.message });
  }
});

app.get('/api/orders', auth, (req, res) => {
  const orders = db.orders.filter(o => o.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders });
});

app.get('/api/orders/:id', auth, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id && (o.userId === req.user.id || req.user.role === 'admin'));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// ===================================================================
// SUBSCRIPTIONS (recurring monthly retainers via Paystack Plans)
// ===================================================================

// List the current user's subscriptions (admin sees all)
app.get('/api/subscriptions', auth, (req, res) => {
  const subs = req.user.role === 'admin'
    ? db.subscriptions
    : db.subscriptions.filter(s => s.userId === req.user.id);
  res.json({ subscriptions: subs });
});

// Start a new subscription. Creates (or reuses) a Paystack Plan for the
// chosen retainer tier, initializes a subscription transaction, and stores
// a pending subscription record keyed by reference.
app.post('/api/subscriptions', auth, async (req, res) => {
  const { planId } = req.body || {};
  const plan = (db.settings.subscriptionPlans || []).find(p => p.id === planId);
  if (!plan) return res.status(404).json({ error: 'Subscription plan not found' });

  const displayCurrency = req.user.currency || 'USD';
  const charge = paystack.toChargeAmount(plan.price, displayCurrency, CURRENCY_RATES);
  const reference = 'SUB' + Date.now().toString(36).toUpperCase() + uid('s').slice(2, 8).toUpperCase();

  // Ensure a Paystack Plan exists for this tier. We cache the plan_code on the
  // plan definition so we only create it once per tier.
  let planCode = plan.paystackPlanCode;
  if (!planCode) {
    try {
      const created = await paystack.createPlan({
        name: 'CreatiHub — ' + plan.name,
        amount: charge.amount,
        currency: charge.currency,
        interval: plan.interval || 'monthly',
        description: plan.desc || plan.tagline || ''
      });
      if (created && created.data && created.data.plan_code) {
        planCode = created.data.plan_code;
        plan.paystackPlanCode = planCode;   // cache for reuse
        save();
      }
    } catch (e) {
      return res.status(502).json({ error: 'Could not create subscription plan: ' + e.message });
    }
  }

  const baseUrl = process.env.PAYSTACK_CALLBACK_URL ||
    (req.protocol + '://' + req.get('host') + '/payment/callback');

  const sub = {
    id: 'SUB-' + (db.orderCounter++),
    userId: req.user.id,
    userName: req.user.name,
    userEmail: req.user.email,
    planId: plan.id,
    planName: plan.name,
    planPrice: plan.price,            // USD/month (authoritative)
    interval: plan.interval || 'monthly',
    status: 'pending',                // pending -> active (on webhook/verify) -> cancelled
    reference,
    subscriptionCode: null,           // filled by Paystack webhook (subscription.create)
    chargeCurrency: charge.currency,
    chargeAmount: charge.amount,
    startedAt: new Date().toISOString(),
    activatedAt: null,
    currentPeriodEnd: null,
    lastChargeAt: null,
    lastChargeReference: null,
    cancelledAt: null
  };

  try {
    const init = await paystack.initializeSubscription({
      email: req.user.email,
      planCode,
      reference,
      callbackUrl: baseUrl + '?subscription=1',
      metadata: {
        subscription_id: sub.id,
        plan: plan.name,
        customer_name: req.user.name,
        custom_fields: [
          { display_name: 'Subscription', variable_name: 'sub_id', value: sub.id },
          { display_name: 'Plan', variable_name: 'plan', value: plan.name }
        ]
      }
    });

    db.subscriptions.push(sub);
    save();
    logActivity('order', `New subscription ${sub.id} (pending)`,
      `${req.user.name} subscribed to ${plan.name} — $${plan.price}/mo — ref ${reference}`);

    res.json({
      subscription: sub,
      payment: {
        reference,
        accessCode: init.data.access_code,
        authorizationUrl: init.data.authorization_url,
        publicKey: paystack.publicKey(),
        demo: paystack.isDemo()
      }
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not initialize subscription payment: ' + e.message });
  }
});

// Verify a subscription payment after the customer returns from Paystack
// (mirrors the one-off order verify flow).
app.get('/api/subscriptions/verify/:reference', auth, async (req, res) => {
  const sub = db.subscriptions.find(s => s.reference === req.params.reference);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });
  if (sub.userId !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  if (sub.status === 'active') return res.json({ subscription: sub, active: true });

  try {
    const v = await paystack.verifyTransaction(sub.reference);
    if (v.paid) {
      sub.status = 'active';
      sub.activatedAt = new Date().toISOString();
      const next = new Date(); next.setMonth(next.getMonth() + 1);
      sub.currentPeriodEnd = next.toISOString();
      sub.lastChargeAt = v.paidAt || new Date().toISOString();
      save();
      logActivity('payment', `Subscription active: ${sub.planName}`,
        `${sub.userName}'s subscription ${sub.id} is now active — ref ${sub.reference}`);
      return res.json({ subscription: sub, active: true });
    }
    res.status(402).json({ error: 'Subscription payment not completed', status: v.status, subscription: sub });
  } catch (e) {
    res.status(502).json({ error: 'Could not verify subscription: ' + e.message });
  }
});

// Cancel a subscription (user cancels their own; admin can cancel any)
app.post('/api/subscriptions/:id/cancel', auth, (req, res) => {
  const sub = db.subscriptions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });
  if (sub.userId !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  if (sub.status === 'cancelled') return res.json({ subscription: sub });

  sub.status = 'cancelled';
  sub.cancelledAt = new Date().toISOString();
  save();
  logActivity('order', `Subscription cancelled: ${sub.planName}`,
    `${sub.userName} cancelled subscription ${sub.id}`);
  // NOTE: In live Paystack mode you'd also call Paystack's /subscription/:code/disable
  // endpoint here. In demo mode we just mark it locally.
  res.json({ subscription: sub });
});

// Admin: list all subscriptions (summary for the admin dashboard)
app.get('/api/admin/subscriptions', auth, adminOnly, (req, res) => {
  const active = db.subscriptions.filter(s => s.status === 'active');
  const monthlyRevenue = active.reduce((sum, s) => sum + (s.planPrice || 0), 0);
  res.json({
    subscriptions: db.subscriptions,
    stats: {
      total: db.subscriptions.length,
      active: active.length,
      cancelled: db.subscriptions.filter(s => s.status === 'cancelled').length,
      pending: db.subscriptions.filter(s => s.status === 'pending').length,
      monthlyRecurringRevenue: Math.round(monthlyRevenue * 100) / 100
    }
  });
});

// ---------------- AI Chat (users) ----------------
app.post('/api/chat', (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  // Optional auth — chat works for guests too
  const token = req.headers['x-token'];
  const userId = token && db.tokens[token];
  const user = userId ? db.users.find(u => u && u.id === userId) : null;
  // safeUserAssistant applies the safety filter, runs the assistant, and logs
  // the AI task to the live admin activity feed automatically.
  const result = safeUserAssistant(message, user);
  db.chats.push({ id: uid('c'), userId: user ? user.id : 'guest', role: 'user', message, at: new Date().toISOString() });
  db.chats.push({ id: uid('c'), userId: user ? user.id : 'guest', role: 'assistant', message: result.reply, at: new Date().toISOString() });
  save();
  // Only notify admin of support activity when Nova actually handled a real
  // question (not when it refused a blocked message — those are already logged).
  if (!result.blocked) {
    const who = user ? `${user.name} (${user.email})` : 'A guest visitor';
    logActivity('chat', 'Nova handling support chat', `${who}: "${message.slice(0, 120)}"`);
    notify('support', '💬 Nova is attending to a support message', `${who} sent a message to support:\n\n"${message}"\n\nNova replied instantly. Open the admin dashboard to review the conversation.`);
  }
  res.json(result);
});

// ---------------- Admin routes ----------------
app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const orders = db.orders;
  const isPaid = o => o.paymentStatus === 'paid' && o.status !== 'cancelled';
  const revenue = orders.filter(isPaid).reduce((s, o) => s + o.price, 0);
  const byStatus = { awaiting_payment: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  orders.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
  const byService = {};
  orders.forEach(o => {
    if (!byService[o.serviceName]) byService[o.serviceName] = { orders: 0, revenue: 0 };
    byService[o.serviceName].orders++;
    if (isPaid(o)) byService[o.serviceName].revenue += o.price;
  });
  // Revenue by day (last 7 days)
  const byDay = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    byDay[d.toISOString().slice(0, 10)] = 0;
  }
  orders.filter(isPaid).forEach(o => {
    const day = o.createdAt.slice(0, 10);
    if (day in byDay) byDay[day] += o.price;
  });
  res.json({
    revenue, totalOrders: orders.length, byStatus, byService, byDay,
    unpaidOrders: orders.filter(o => o.paymentStatus !== 'paid' && o.status !== 'cancelled').length,
    customers: db.users.filter(u => u && u.role !== 'admin').length,
    services: db.services.length,
    chats: db.chats.length
  });
});

app.get('/api/admin/orders', auth, adminOnly, (req, res) => {
  const orders = [...db.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders });
});

app.put('/api/admin/orders/:id', auth, adminOnly, (req, res) => {
  const { status, note } = req.body || {};
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (order.paymentStatus !== 'paid' && status !== 'cancelled') {
    return res.status(400).json({ error: 'This order has not been paid yet. Only cancel unpaid orders.' });
  }
  order.status = status;
  order.timeline.push({ status, at: new Date().toISOString(), note: note || 'Status updated by admin' });
  save();

  // Email the buyer about the status change (fire-and-forget)
  const statusMessages = {
    pending: 'Your order has been confirmed and is now in our creative queue. Our team will start working on it shortly.',
    in_progress: 'Great news! Our creative team has started working on your order. You will receive another update when it is ready for delivery.',
    completed: 'Your order is now complete! The final deliverables are ready. Please check your dashboard to review the work. If you have any issues or need revisions, just let us know. We would love it if you could leave a review for the service you received.',
    cancelled: 'Your order has been cancelled. ' + (note ? 'Reason: ' + note : 'If you believe this was a mistake, please contact our support team.')
  };
  const statusBody = statusMessages[status];
  if (statusBody && order.userEmail) {
    sendEmail(order.userEmail, 'Order update — ' + order.id,
      'Hi ' + order.userName + ',\n\n' +
      statusBody + '\n\n' +
      '• Order ID: ' + order.id + '\n' +
      '• Service: ' + order.serviceName + '\n' +
      '• Package: ' + order.packageName + '\n' +
      (note ? '\nNote from CreatiHub: ' + note + '\n' : '') +
      '\nTrack your order: https://creatihub.com.ng\n\n' +
      '— The CreatiHub Team').catch(() => {});
  }

  res.json({ order });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json({ users: db.users.map(u => u ? publicUser(u) : null).filter(Boolean) });
});

// Admin can reset ANY account's password (users and other admins).
// Sets a temporary password and revokes all sessions for that account.
app.put('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const target = db.users.find(u => u && u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  target.password = hashPassword(newPassword);
  revokeUserTokens(target.id);
  save();
  logActivity('security', 'Admin reset password', `${req.user.name} reset the password for ${target.name} (${target.email})`);
  notify('security', '🔐 Password reset by admin', `${req.user.name} reset the login password for ${target.name} (${target.email}).`);
  res.json({ ok: true, message: `Password reset for ${target.email}` });
});

app.post('/api/admin/chat', auth, adminOnly, (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  const result = safeAdminAssistant(message, req.user.name);
  db.adminChats.push({ id: uid('ac'), role: 'admin', message, at: new Date().toISOString() });
  db.adminChats.push({ id: uid('ac'), role: 'assistant', message: result.reply, at: new Date().toISOString() });
  save();
  res.json(result);
});

// Admin: Get chat history (for Co-Founder conversation persistence)
app.get('/api/admin/chat/history', auth, adminOnly, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const messages = (db.adminChats || []).slice(-limit);
  res.json({ messages });
});

// ---------------- Admin: Live AI Activity feed ----------------
// Returns the most recent AI tasks so the admin can watch Nova work in real
// time. Supports a `since` param (ISO date) so the client can poll for only
// new entries since its last fetch.
app.get('/api/admin/ai-activity', auth, adminOnly, (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  let items = db.aiActivity;
  if (since) items = items.filter(a => new Date(a.at) > since);
  res.json({ activity: items.slice(0, 100), total: db.aiActivity.length, serverTime: new Date().toISOString() });
});

// ---------------- Admin: Notifications ----------------
app.get('/api/admin/notifications', auth, adminOnly, (req, res) => {
  const unread = db.notifications.filter(n => !n.read).length;
  res.json({ notifications: db.notifications.slice(0, 50), unread });
});

app.put('/api/admin/notifications/:id/read', auth, adminOnly, (req, res) => {
  const n = markNotificationRead(req.params.id);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
});

app.post('/api/admin/notifications/read-all', auth, adminOnly, (req, res) => {
  const changed = markAllNotificationsRead();
  res.json({ ok: true, cleared: changed });
});

// ---------------- Admin: Email outbox + Broadcast ----------------
// View the email outbox (sent, failed, and queued emails)
app.get('/api/admin/emails', auth, adminOnly, (req, res) => {
  const emails = (db.emails || []).slice(0, 100);
  const mailer = require('./mailer');
  res.json({
    emails,
    configured: mailer.isConfigured(),
    fromEmail: mailer.FROM_EMAIL,
    total: (db.emails || []).length
  });
});

// Check email service status (is Resend configured?)
app.get('/api/admin/emails/status', auth, adminOnly, (req, res) => {
  const mailer = require('./mailer');
  const emails = db.emails || [];
  const sent = emails.filter(e => e.status === 'sent').length;
  const failed = emails.filter(e => e.status === 'failed').length;
  const queued = emails.filter(e => e.status === 'queued').length;
  res.json({
    configured: mailer.isConfigured(),
    fromEmail: mailer.FROM_EMAIL,
    replyTo: mailer.REPLY_TO,
    stats: { sent, failed, queued, total: emails.length }
  });
});

// Broadcast / marketing email to all users (or a specific segment)
// Body: { subject, body, segment?: 'all' | 'paid' | 'unpaid' }
// This sends ONE batch email to all matching recipients via Resend.
app.post('/api/admin/broadcast', auth, adminOnly, async (req, res) => {
  const { subject, body, segment } = req.body || {};
  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required' });
  }
  if (subject.length > 200) {
    return res.status(400).json({ error: 'Subject must be 200 characters or less' });
  }

  // Build recipient list based on segment
  let recipients = db.users.filter(u => u && u.email && u.role !== 'admin');
  if (segment === 'paid') {
    const paidUserIds = new Set(db.orders.filter(o => o.paymentStatus === 'paid').map(o => o.userId));
    recipients = recipients.filter(u => paidUserIds.has(u.id));
  } else if (segment === 'unpaid') {
    const paidUserIds = new Set(db.orders.filter(o => o.paymentStatus === 'paid').map(o => o.userId));
    recipients = recipients.filter(u => !paidUserIds.has(u.id));
  }
  // segment === 'all' or undefined → all non-admin users

  const emails = recipients.map(u => u.email);
  if (emails.length === 0) {
    return res.json({ ok: true, sent: 0, failed: 0, message: 'No recipients found for this segment' });
  }

  // Log the broadcast
  logActivity('email', `Broadcast sent by ${req.user.name}`,
    `Subject: "${subject}" | Recipients: ${emails.length} (${segment || 'all'})`);

  // Record a copy in the outbox
  const mailer = require('./mailer');
  const broadcastRecord = {
    id: uid('e'),
    to: `${emails.length} recipients (${segment || 'all'})`,
    subject: '[BROADCAST] ' + subject,
    body,
    at: new Date().toISOString(),
    status: 'sending',
    broadcast: true,
    recipientCount: emails.length
  };
  if (!db.emails) db.emails = [];
  db.emails.unshift(broadcastRecord);
  if (db.emails.length > 200) db.emails = db.emails.slice(0, 200);
  save();

  // Send the broadcast via Resend (batch send)
  try {
    const result = await mailer.sendBroadcast(emails, subject, body);
    broadcastRecord.status = result.sent > 0 ? 'sent' : 'failed';
    broadcastRecord.sentAt = new Date().toISOString();
    broadcastRecord.sentCount = result.sent;
    broadcastRecord.failedCount = result.failed;
    if (result.errors.length) broadcastRecord.error = result.errors.join('; ').slice(0, 300);
    save();

    res.json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      total: emails.length,
      errors: result.errors,
      message: result.sent > 0
        ? `Broadcast sent to ${result.sent} user(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}`
        : 'No emails were sent. Check if RESEND_API_KEY is configured.'
    });
  } catch (err) {
    broadcastRecord.status = 'failed';
    broadcastRecord.error = String(err.message || err).slice(0, 300);
    save();
    res.status(500).json({ error: 'Broadcast failed: ' + err.message, sent: 0, failed: emails.length });
  }
});

// Send a test email (admin can verify email setup is working)
app.post('/api/admin/emails/test', auth, adminOnly, async (req, res) => {
  const { to } = req.body || {};
  const target = to || req.user.email;
  if (!target) return res.status(400).json({ error: 'No email address to send to' });

  try {
    const result = await sendEmail(target, 'CreatiHub — Test Email',
      'This is a test email from CreatiHub.\n\nIf you received this, your email system is working correctly!\n\n— The CreatiHub Team');
    res.json({
      ok: result.status === 'sent',
      status: result.status,
      error: result.error,
      message: result.status === 'sent'
        ? 'Test email sent successfully! Check your inbox.'
        : 'Email was queued but not sent. Make sure RESEND_API_KEY is set in Railway Variables.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Test email failed: ' + err.message });
  }
});

// ---------------- Admin: General live activity feed ----------------
app.get('/api/admin/activity', auth, adminOnly, (req, res) => {
  res.json({ activity: db.activity.slice(0, 100), total: db.activity.length, serverTime: new Date().toISOString() });
});

// ---------------- Admin: Service & Pricing management ----------------
// Full service list for the pricing editor (raw prices, no currency conversion).
app.get('/api/admin/services', auth, adminOnly, (req, res) => {
  res.json({ services: db.services });
});

// Edit a whole service (name, tagline, etc.). Used by the pricing panel.
app.put('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const svc = db.services.find(s => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const { name, tagline, category, deliveryDays } = req.body || {};
  if (name) svc.name = name.trim();
  if (tagline) svc.tagline = tagline.trim();
  if (category) svc.category = category.trim();
  if (deliveryDays != null) svc.deliveryDays = Math.max(1, parseInt(deliveryDays, 10) || svc.deliveryDays);
  save();
  logActivity('pricing', `Edited service ${svc.id}`, `Admin updated ${svc.name} details.`);
  res.json({ service: svc });
});

// Edit a single package's price (and optionally its name/description).
// This is the core "reduce service prices" action.
app.put('/api/admin/services/:id/packages/:pkgId', auth, adminOnly, (req, res) => {
  const svc = db.services.find(s => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const pkg = svc.packages.find(p => p.id === req.params.pkgId);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const { price, name, desc } = req.body || {};
  const oldPrice = pkg.price;
  let changed = false;
  if (price != null) {
    const newPrice = Math.round(parseFloat(price) * 100) / 100;
    if (isNaN(newPrice) || newPrice < 0) return res.status(400).json({ error: 'Price must be a positive number' });
    if (newPrice > 10000) return res.status(400).json({ error: 'Price seems too high (max $10,000)' });
    pkg.price = newPrice;
    changed = true;
    logPriceChange(svc.id, svc.name, pkg.id, pkg.name, oldPrice, newPrice, req.user.name);
  }
  if (name) { pkg.name = name.trim(); changed = true; }
  if (desc) { pkg.desc = desc.trim(); changed = true; }
  if (!changed) return res.status(400).json({ error: 'No changes provided' });
  save();
  const dir = pkg.price < oldPrice ? 'reduced' : (pkg.price > oldPrice ? 'increased' : 'changed');
  logActivity('pricing', `Price ${dir} for ${svc.name} (${pkg.name})`,
    `${req.user.name} ${dir} ${svc.name} / ${pkg.name} from $${oldPrice} to $${pkg.price}.`);
  notify('pricing', `💲 Price ${dir} — ${svc.name}`,
    `${pkg.name} package for ${svc.name} was ${dir} from $${oldPrice} to $${pkg.price} by ${req.user.name}.`);
  res.json({ service: svc, package: pkg, oldPrice });
});

// Apply a percentage discount across ALL packages of a service at once.
app.post('/api/admin/services/:id/discount', auth, adminOnly, (req, res) => {
  const svc = db.services.find(s => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const { percent } = req.body || {};
  const pct = parseFloat(percent);
  if (isNaN(pct) || pct <= 0 || pct > 90) {
    return res.status(400).json({ error: 'Discount must be between 1% and 90%' });
  }
  const changes = [];
  svc.packages.forEach(pkg => {
    const oldPrice = pkg.price;
    const newPrice = Math.round((oldPrice * (1 - pct / 100)) * 100) / 100;
    pkg.price = newPrice;
    logPriceChange(svc.id, svc.name, pkg.id, pkg.name, oldPrice, newPrice, req.user.name);
    changes.push({ package: pkg.name, oldPrice, newPrice });
  });
  save();
  logActivity('pricing', `Applied ${pct}% discount to ${svc.name}`,
    `${req.user.name} applied a ${pct}% discount across all packages of ${svc.name}.`);
  notify('pricing', `💲 ${pct}% discount applied — ${svc.name}`,
    `A ${pct}% discount was applied to all packages of ${svc.name} by ${req.user.name}.\n\n${changes.map(c => `• ${c.package}: $${c.oldPrice} → $${c.newPrice}`).join('\n')}`);
  res.json({ service: svc, changes });
});

// Price change history (audit log).
app.get('/api/admin/price-history', auth, adminOnly, (req, res) => {
  res.json({ history: db.priceHistory.slice(0, 50) });
});

// ---------------- Admin: AI Safety & Security ----------------
app.get('/api/admin/ai-settings', auth, adminOnly, (req, res) => {
  res.json({ settings: db.aiSettings });
});

app.put('/api/admin/ai-settings', auth, adminOnly, (req, res) => {
  const s = req.body && req.body.settings;
  if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Settings object required' });
  const cur = db.aiSettings;
  // Merge allowed fields only (never blindly replace to avoid corrupting shape)
  if (typeof s.enabled === 'boolean') cur.enabled = s.enabled;
  if (typeof s.adminAssistantEnabled === 'boolean') cur.adminAssistantEnabled = s.adminAssistantEnabled;
  if (s.rateLimit && typeof s.rateLimit === 'object') {
    cur.rateLimit = {
      maxMessages: Math.max(1, parseInt(s.rateLimit.maxMessages, 10) || cur.rateLimit.maxMessages),
      windowMinutes: Math.max(1, parseInt(s.rateLimit.windowMinutes, 10) || cur.rateLimit.windowMinutes)
    };
  }
  if (Array.isArray(s.blockedPhrases)) cur.blockedPhrases = s.blockedPhrases.map(String).filter(Boolean);
  if (Array.isArray(s.blockedTopics)) cur.blockedTopics = s.blockedTopics.map(String).filter(Boolean);
  if (s.guardrails && typeof s.guardrails === 'object') {
    const g = cur.guardrails;
    if (typeof s.guardrails.blockPromptInjection === 'boolean') g.blockPromptInjection = s.guardrails.blockPromptInjection;
    if (typeof s.guardrails.blockPersonalData === 'boolean') g.blockPersonalData = s.guardrails.blockPersonalData;
    if (s.guardrails.maxMessageLength != null) g.maxMessageLength = Math.max(100, parseInt(s.guardrails.maxMessageLength, 10) || g.maxMessageLength);
    if (typeof s.guardrails.refuseOnBlock === 'boolean') g.refuseOnBlock = s.guardrails.refuseOnBlock;
  }
  if (s.persona && typeof s.persona === 'object') {
    if (s.persona.name) cur.persona.name = String(s.persona.name).slice(0, 40);
    if (s.persona.tone) cur.persona.tone = String(s.persona.tone).slice(0, 200);
    if (s.persona.scope) cur.persona.scope = String(s.persona.scope).slice(0, 500);
  }
  save();
  logActivity('security', 'AI safety settings updated', `${req.user.name} updated Nova's safety / guardrail settings.`);
  notify('security', '🛡️ AI safety settings changed', `${req.user.name} updated Nova's safety configuration. Nova is currently ${cur.enabled ? 'ENABLED' : 'DISABLED'}.`);
  res.json({ settings: cur });
});

// AI safety audit trail (blocked / refused interactions).
app.get('/api/admin/ai-audit', auth, adminOnly, (req, res) => {
  res.json({ audit: db.aiAudit.slice(0, 50) });
});

// ---------------- Config ----------------
// ---------------- Admin: Database Backups ----------------
// Export the entire database as a downloadable JSON snapshot (instant backup)
app.get('/api/admin/export', auth, adminOnly, (req, res) => {
  const snap = JSON.stringify(db, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="creatihub-export-${stamp}.json"`);
  logActivity('backup', `Data exported by admin`, `Admin downloaded a full database snapshot (${(snap.length / 1024).toFixed(1)} KB)`);
  res.send(snap);
});

// List available backups
app.get('/api/admin/backups', auth, adminOnly, (req, res) => {
  res.json({ backups: backup.listBackups(), maxFiles: parseInt(process.env.BACKUP_MAX_FILES || '30', 10) });
});

// Trigger a manual backup right now
app.post('/api/admin/backups', auth, adminOnly, (req, res) => {
  const r = backup.backupNow();
  if (r.ok) {
    logActivity('backup', `Manual backup created: ${r.file}`, `Admin triggered a database snapshot (${(r.size / 1024).toFixed(1)} KB)`);
    res.json(r);
  } else {
    res.status(400).json(r);
  }
});

// Download a specific backup file
app.get('/api/admin/backups/:file', auth, adminOnly, (req, res) => {
  const p = backup.getBackupPath(req.params.file);
  if (!p) return res.status(404).json({ error: 'Backup not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`);
  fs.createReadStream(p).pipe(res);
});

// ============================================================
// PHASE 8 — Differentiation feature endpoints
// Brand-in-a-Box bundles, Naija templates, reviews, referrals,
// lead magnet (business name generator), instant flyer,
// Nigerian voiceover languages, installment payments.
// ============================================================

// ---- Brand-in-a-Box bundles (hero product) ----
app.get('/api/bundles', (req, res) => {
  const bundles = (db.services || []).filter(s => s && s.isBundle);
  res.json({ bundles });
});

// ---- Naija-Ready Template Library ----
app.get('/api/naija-templates', (req, res) => {
  const templates = (db.settings.naijaTemplates) || [];
  const cat = req.query.category;
  const filtered = cat ? templates.filter(t => t.category === cat) : templates;
  const categories = [...new Set(templates.map(t => t.category))];
  res.json({ templates: filtered, categories, total: templates.length });
});

// Order a Naija template (creates a real order for customization)
app.post('/api/naija-templates/order', auth, async (req, res) => {
  const { templateId, requirements } = req.body || {};
  const tpl = (db.settings.naijaTemplates || []).find(t => t.id === templateId);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const displayCurrency = req.user.currency || 'USD';
  const priceUsd = tpl.price || 10;
  const charge = paystack.toChargeAmount(priceUsd, displayCurrency, CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();
  const order = {
    id: 'CH-' + (db.orderCounter++), userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
    serviceId: 'flyer-design', serviceName: 'Naija Template: ' + tpl.title, packageId: 'template', packageName: tpl.category,
    price: priceUsd, basePrice: priceUsd, currency: 'USD',
    installmentSplits: 1, installmentPaidUsd: 0, installments: [],
    whatsappDelivery: !!req.body.whatsappDelivery, whatsappNumber: req.body.whatsappNumber || '',
    status: 'awaiting_payment', requirements: requirements || tpl.title,
    paymentMethod: 'paystack', paymentReference: reference, paymentStatus: 'unpaid',
    chargeCurrency: charge.currency, chargeAmount: charge.amount,
    naijaTemplateId: templateId, createdAt: new Date().toISOString(),
    timeline: [{ status: 'awaiting_payment', at: new Date().toISOString(), note: 'Naija template order created — awaiting payment' }]
  };
  const baseUrl = process.env.PAYSTACK_CALLBACK_URL || (req.protocol + '://' + req.get('host') + '/payment/callback');
  try {
    const init = await paystack.initializeTransaction({
      email: req.user.email, amount: charge.amount, currency: charge.currency, reference, callbackUrl: baseUrl,
      metadata: { order_id: order.id, template: tpl.title, custom_fields: [{ display_name: 'Template', variable_name: 'template', value: tpl.title }] }
    });
    order.paymentAccessCode = init.data.access_code;
    db.orders.push(order); save();
    logActivity('order', `Naija template order ${order.id}`, `${req.user.name} ordered template "${tpl.title}" — $${priceUsd}`);
    res.json({ order, payment: { reference, accessCode: init.data.access_code, authorizationUrl: init.data.authorization_url, amount: charge.amount, currency: charge.currency, publicKey: paystack.publicKey(), demo: paystack.isDemo() } });
  } catch (e) { res.status(502).json({ error: 'Could not initialize payment: ' + e.message }); }
});

// ---- Nigerian Voiceover Languages ----
app.get('/api/voiceover/languages', (req, res) => {
  res.json({ languages: db.settings.naijaVoiceovers || [] });
});

// ---- Reviews (public before/after showcase + testimonials) ----
app.get('/api/reviews', (req, res) => {
  const all = (db.reviews || []).filter(r => r && r.approved);
  const featured = req.query.featured ? all.filter(r => r.featured) : all;
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({ reviews: featured.slice(0, limit), total: all.length });
});

// Submit a review (must own a completed order)
app.post('/api/reviews', auth, (req, res) => {
  const { orderId, rating, comment, beforeImage, afterImage } = req.body || {};
  if (!orderId || !rating) return res.status(400).json({ error: 'Order ID and rating are required' });
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user.id) return res.status(403).json({ error: 'You can only review your own orders' });
  if (order.status !== 'completed') return res.status(400).json({ error: 'You can only review completed orders' });
  if ((db.reviews || []).some(r => r.orderId === orderId)) return res.status(409).json({ error: 'You already reviewed this order' });
  const review = {
    id: uid('rev'), orderId, userId: req.user.id, userName: req.user.name,
    rating: Math.max(1, Math.min(5, parseInt(rating, 10) || 5)),
    comment: String(comment || '').slice(0, 1000),
    beforeImage: beforeImage || '', afterImage: afterImage || '',
    service: order.serviceName, approved: false, featured: false,
    createdAt: new Date().toISOString()
  };
  db.reviews = db.reviews || [];
  db.reviews.push(review); save();
  logActivity('review', `New review submitted for ${orderId}`, `${req.user.name} rated ${order.serviceName} ${review.rating}/5 — pending approval.`);
  notify('review', `New review pending approval — ${orderId}`, `${req.user.name} submitted a ${review.rating}-star review for ${order.serviceName}.`);
  res.json({ review, message: 'Review submitted! It will appear publicly once approved.' });
});

// Admin: list all reviews (including unapproved)
app.get('/api/admin/reviews', auth, adminOnly, (req, res) => {
  res.json({ reviews: db.reviews || [] });
});

// Admin: approve / reject / feature a review
app.put('/api/admin/reviews/:id', auth, adminOnly, (req, res) => {
  const review = (db.reviews || []).find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (typeof req.body.approved === 'boolean') review.approved = req.body.approved;
  if (typeof req.body.featured === 'boolean') review.featured = req.body.featured;
  save();
  logActivity('review', `Review ${req.params.id} updated`, `approved=${review.approved}, featured=${review.featured}`);
  res.json({ review });
});

// ---- Referral program ----
// Get my referral code + stats
app.get('/api/referrals', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.referralCode) {
    user.referralCode = ('CH' + (user.id || '').slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase());
    save();
  }
  const myReferrals = (db.referrals || []).filter(r => r.referrerId === req.user.id);
  const credit = typeof user.referralCredit === 'number' ? user.referralCredit : 0;
  res.json({
    referralCode: user.referralCode,
    referralCredit: credit,
    referrals: myReferrals,
    totalReferred: myReferrals.length,
    totalEarned: myReferrals.reduce((s, r) => s + (r.credit || 0), 0),
    config: db.settings.referral || { enabled: false }
  });
});

// Validate a referral code (used at checkout to preview discount)
app.post('/api/referrals/validate', auth, (req, res) => {
  const refCfg = db.settings.referral || { enabled: false };
  if (!refCfg.enabled) return res.json({ valid: false, message: 'Referral program is not active.' });
  const code = String(req.body.referralCode || '').trim().toUpperCase();
  if (!code) return res.json({ valid: false });
  const referrer = db.users.find(u => (u.referralCode || '').toUpperCase() === code && u.id !== req.user.id);
  if (!referrer) return res.json({ valid: false, message: 'Invalid referral code.' });
  res.json({ valid: true, referrerName: referrer.name.split(' ')[0], discountUsd: refCfg.bonusUsd || 0, creditUsd: refCfg.creditUsd || 0 });
});

// Admin: overview of all referrals
app.get('/api/admin/referrals', auth, adminOnly, (req, res) => {
  res.json({ referrals: db.referrals || [], config: db.settings.referral || { enabled: false } });
});

// ---- Lead magnet: free Business Name + Slogan generator ----
app.post('/api/lead-magnet/business-name', (req, res) => {
  const idea = String((req.body || {}).idea || '').trim();
  if (!idea || idea.length < 3) return res.status(400).json({ error: 'Please describe your business idea (at least a few words).' });
  if (idea.length > 200) return res.status(400).json({ error: 'Please keep your description under 200 characters.' });

  // Lightweight local generator (no external API needed) — builds names from
  // keywords in the idea + curated suffixes/prefixes. Fast, free, reliable.
  const words = idea.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the','and','for','with','that','this','from','your','business','company','service','services','provide','offering','sell','selling','buy','buying','want','need','looking'].includes(w));
  const core = words.slice(0, 4);
  const prefixes = ['Nova', 'Lumina', 'Apex', 'Prime', 'Elite', 'Vivid', 'Bold', 'Bright', 'True', 'Pure', 'Sky', 'Urban', 'Pixel', 'Craft', 'Spark'];
  const suffixes = ['Hub', 'Lab', 'Works', 'Studio', 'Co', 'Nest', 'Forge', 'Verse', 'Loop', 'Bay', 'Edge', 'Point', 'Zone', 'Space', 'Base'];
  const naijaSuffixes = ['9ja', 'Naija', 'Afri', 'Naij'];
  const ideas = idea.toLowerCase();
  const names = new Set();
  // Pattern 1: Prefix + core word
  if (core[0]) { prefixes.slice(0, 6).forEach(p => names.add(p + cap(core[0]))); }
  // Pattern 2: core word + suffix
  if (core[0]) { suffixes.slice(0, 6).forEach(s => names.add(cap(core[0]) + s)); }
  // Pattern 3: two core words combined
  if (core[1]) { names.add(cap(core[0]) + cap(core[1])); names.add(cap(core[0]) + '&' + cap(core[1])); }
  // Pattern 4: Naija-flavored
  if (core[0]) { naijaSuffixes.forEach(s => names.add(cap(core[0]) + s)); }
  // Pattern 5: pure creative combos
  for (let i = 0; i < 5; i++) { names.add(prefixes[Math.floor(Math.random()*prefixes.length)] + suffixes[Math.floor(Math.random()*suffixes.length)]); }
  const nameList = [...names].slice(0, 10).map(name => ({
    name,
    slogan: makeSlogan(name, idea)
  }));

  // Log usage for analytics (no PII — just the idea text)
  db.leadMagnetLogs = db.leadMagnetLogs || [];
  db.leadMagnetLogs.push({ id: uid('lm'), idea: idea.slice(0, 200), nameCount: nameList.length, at: new Date().toISOString() });
  if (db.leadMagnetLogs.length > 500) db.leadMagnetLogs = db.leadMagnetLogs.slice(-500); // cap storage
  save();

  res.json({ idea, names: nameList, note: 'Love a name? Order a custom logo to make it official — your brand starts here.' });
});

function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }
function makeSlogan(name, idea) {
  const templates = [
    `${name} — where ${idea.toLowerCase().slice(0, 30)} meets excellence.`,
    `${name}: Crafted for ${idea.toLowerCase().slice(0, 30)}.`,
    `${name} — your trusted partner in ${idea.toLowerCase().slice(0, 25)}.`,
    `${name}. Built different. Built for you.`,
    `${name} — quality you can feel, service you can trust.`,
    `${name}: Small steps. Big impact.`,
    `${name} — turning ideas into reality, every day.`
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

// ---- Instant Flyer generator (self-serve, low-cost) ----
app.get('/api/instant-flyer/config', (req, res) => {
  res.json({ config: db.settings.instantFlyer || { enabled: false } });
});

// Create an instant flyer order (user pays a small flat fee)
app.post('/api/instant-flyer', auth, async (req, res) => {
  const cfg = db.settings.instantFlyer || { enabled: false };
  if (!cfg.enabled) return res.status(400).json({ error: 'Instant flyer generator is not available right now.' });
  const { headline, subtext, phone, bgColor } = req.body || {};
  if (!headline) return res.status(400).json({ error: 'A headline is required.' });
  const priceUsd = cfg.priceUsd || 5;
  const displayCurrency = req.user.currency || 'USD';
  const charge = paystack.toChargeAmount(priceUsd, displayCurrency, CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();
  const flyer = {
    id: uid('if'), userId: req.user.id, userName: req.user.name,
    headline: String(headline).slice(0, 80), subtext: String(subtext || '').slice(0, 200),
    phone: String(phone || '').slice(0, 20), bgColor: bgColor || '#6c5ce7',
    price: priceUsd, paid: false, reference, createdAt: new Date().toISOString()
  };
  const baseUrl = process.env.PAYSTACK_CALLBACK_URL || (req.protocol + '://' + req.get('host') + '/payment/callback');
  try {
    const init = await paystack.initializeTransaction({
      email: req.user.email, amount: charge.amount, currency: charge.currency, reference, callbackUrl: baseUrl,
      metadata: { type: 'instant_flyer', headline: flyer.headline }
    });
    flyer.accessCode = init.data.access_code;
    db.instantFlyerOrders = db.instantFlyerOrders || [];
    db.instantFlyerOrders.push(flyer); save();
    logActivity('instant-flyer', `Instant flyer order by ${req.user.name}`, `Headline: "${flyer.headline}" — $${priceUsd}`);
    res.json({ flyer, payment: { reference, accessCode: init.data.access_code, authorizationUrl: init.data.authorization_url, amount: charge.amount, currency: charge.currency, publicKey: paystack.publicKey(), demo: paystack.isDemo() } });
  } catch (e) { res.status(502).json({ error: 'Could not initialize payment: ' + e.message }); }
});

// Verify instant flyer payment and return a downloadable flyer (HTML rendered)
app.get('/api/instant-flyer/:reference', auth, (req, res) => {
  const flyer = (db.instantFlyerOrders || []).find(f => f.reference === req.params.reference && f.userId === req.user.id);
  if (!flyer) return res.status(404).json({ error: 'Flyer not found' });
  if (!flyer.paid) {
    // In demo mode auto-mark paid; in live mode verify with Paystack
    if (paystack.isDemo()) { flyer.paid = true; save(); }
    else { return res.status(402).json({ error: 'Payment not completed yet. Please complete checkout first.' }); }
  }
  res.json({ flyer, downloadUrl: `/api/instant-flyer/${flyer.reference}/download` });
});

// Download the flyer as a self-contained HTML file (printable / saveable)
app.get('/api/instant-flyer/:reference/download', auth, (req, res) => {
  const flyer = (db.instantFlyerOrders || []).find(f => f.reference === req.params.reference && f.userId === req.user.id);
  if (!flyer || !flyer.paid) return res.status(404).send('Flyer not found or not paid');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(flyer.headline)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif}
.flyer{width:800px;height:1000px;background:linear-gradient(135deg,${esc(flyer.bgColor)},#2d3436);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;position:relative;overflow:hidden}
.flyer::before{content:'';position:absolute;top:-50px;left:-50px;width:300px;height:300px;background:rgba(255,255,255,.08);border-radius:50%}
.flyer::after{content:'';position:absolute;bottom:-80px;right:-80px;width:400px;height:400px;background:rgba(255,255,255,.06);border-radius:50%}
.badge{background:rgba(255,255,255,.2);padding:8px 24px;border-radius:30px;font-size:18px;letter-spacing:2px;margin-bottom:40px;text-transform:uppercase}
h1{font-size:72px;line-height:1.1;margin-bottom:30px;font-weight:800;text-shadow:0 4px 20px rgba(0,0,0,.3)}
.sub{font-size:28px;opacity:.95;margin-bottom:50px;max-width:600px;line-height:1.4}
.phone{font-size:32px;font-weight:700;background:rgba(255,255,255,.15);padding:16px 40px;border-radius:12px;letter-spacing:1px}
.brand{position:absolute;bottom:30px;font-size:20px;opacity:.7;letter-spacing:3px;text-transform:uppercase}</style></head>
<body><div class="flyer"><div class="badge">✦ CreatiHub ✦</div><h1>${esc(flyer.headline)}</h1><p class="sub">${esc(flyer.subtext)}</p><div class="phone">${esc(flyer.phone)}</div><div class="brand">Made with CreatiHub</div></div></body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `attachment; filename="creatihub-flyer-${flyer.reference}.html"`);
  res.send(html);
});

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- Installment payments: charge the next installment ----
app.post('/api/installments/:orderId/pay', auth, async (req, res) => {
  const order = db.orders.find(o => o.id === req.params.orderId && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.installmentSplits <= 1) return res.status(400).json({ error: 'This order is not on an installment plan.' });
  const netTotal = order.price - (order.referralDiscountUsd || 0) - (order.creditAppliedUsd || 0);
  const paidSoFar = order.installmentPaidUsd || 0;
  const remaining = Math.max(0, Math.round((netTotal - paidSoFar) * 100) / 100);
  if (remaining <= 0.01) return res.status(400).json({ error: 'This order is already fully paid.' });
  const displayCurrency = req.user.currency || 'USD';
  const charge = paystack.toChargeAmount(remaining, displayCurrency, CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();
  const baseUrl = process.env.PAYSTACK_CALLBACK_URL || (req.protocol + '://' + req.get('host') + '/payment/callback');
  try {
    const init = await paystack.initializeTransaction({
      email: req.user.email, amount: charge.amount, currency: charge.currency, reference, callbackUrl: baseUrl,
      metadata: { order_id: order.id, installment: (order.installments || []).length + 1, custom_fields: [{ display_name: 'Installment', variable_name: 'installment', value: `Payment ${((order.installments||[]).length+1)} of ${order.installmentSplits}` }] }
    });
    // Stash the pending installment reference so the webhook/verify can apply it
    order.pendingInstallment = { reference, amountUsd: remaining, index: (order.installments || []).length + 1 };
    save();
    res.json({ order, payment: { reference, accessCode: init.data.access_code, authorizationUrl: init.data.authorization_url, amount: charge.amount, currency: charge.currency, publicKey: paystack.publicKey(), demo: paystack.isDemo(), remainingUsd: remaining } });
  } catch (e) { res.status(502).json({ error: 'Could not initialize payment: ' + e.message }); }
});

// Verify an installment payment
app.get('/api/installments/:orderId/verify/:reference', auth, async (req, res) => {
  const order = db.orders.find(o => o.id === req.params.orderId && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  try {
    const v = await paystack.verifyTransaction(req.params.reference);
    if (v.paid) {
      const pend = order.pendingInstallment;
      if (pend && pend.reference === req.params.reference) {
        markOrderPaid(order, { installment: true, amountUsd: pend.amountUsd, reference: pend.reference, channel: v.channel, paidAt: v.paidAt });
        order.pendingInstallment = null; save();
      }
      return res.json({ order, paid: true });
    }
    res.status(402).json({ error: 'Installment payment not completed', status: v.status });
  } catch (e) { res.status(502).json({ error: 'Could not verify payment: ' + e.message }); }
});


app.get('/api/config', (req, res) => {
  const settings = db.settings || {};
  res.json({
    currencies: Object.keys(CURRENCY_RATES),
    paystack: {
      publicKey: paystack.publicKey(),
      demo: paystack.isDemo()
    },
    // Checkout upsells (exposed so the order page can render them)
    rushDelivery: settings.rushDelivery || { enabled: false },
    addons: Array.isArray(settings.addons) ? settings.addons : [],
    // Recurring monthly retainer plans
    subscriptionPlans: Array.isArray(settings.subscriptionPlans) ? settings.subscriptionPlans : [],
    // ---- New differentiation features (Phase 8) ----
    installmentPlans: Array.isArray(settings.installmentPlans) ? settings.installmentPlans : [],
    naijaTemplates: Array.isArray(settings.naijaTemplates) ? settings.naijaTemplates : [],
    naijaVoiceovers: Array.isArray(settings.naijaVoiceovers) ? settings.naijaVoiceovers : [],
    referral: settings.referral || { enabled: false },
    instantFlyer: settings.instantFlyer || { enabled: false },
    bundles: db.services.filter(s => s.isBundle)
  });
});

// Payment callback page (Paystack redirects here after checkout)
app.get('/payment/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-callback.html'));
});

// SPA-ish fallback for known pages
const pages = ['', 'services', 'order', 'auth', 'dashboard', 'admin', 'naija-templates', 'reviews', 'business-name-tool', 'instant-flyer'];
pages.forEach(p => {
  app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, 'public', (p || 'index') + '.html')));
});

// Instant flyer download route (direct browser access, no auth header)
app.get('/instant-flyer/:reference/download', (req, res) => {
  const flyer = (db.instantFlyerOrders || []).find(f => f.reference === req.params.reference);
  if (!flyer || !flyer.paid) return res.status(404).send('Flyer not found or not paid');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(flyer.headline)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif}
.flyer{width:800px;height:1000px;background:linear-gradient(135deg,${esc(flyer.bgColor || '#6c5ce7')},#2d3436);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;position:relative;overflow:hidden}
.flyer::before{content:'';position:absolute;top:-50px;left:-50px;width:300px;height:300px;background:rgba(255,255,255,.08);border-radius:50%}
.flyer::after{content:'';position:absolute;bottom:-80px;right:-80px;width:400px;height:400px;background:rgba(255,255,255,.06);border-radius:50%}
.badge{background:rgba(255,255,255,.2);padding:8px 24px;border-radius:30px;font-size:18px;letter-spacing:2px;margin-bottom:40px;text-transform:uppercase}
h1{font-size:72px;line-height:1.1;margin-bottom:30px;font-weight:800;text-shadow:0 4px 20px rgba(0,0,0,.3)}
.sub{font-size:28px;opacity:.95;margin-bottom:50px;max-width:600px;line-height:1.4}
.phone{font-size:32px;font-weight:700;background:rgba(255,255,255,.15);padding:16px 40px;border-radius:12px;letter-spacing:1px}
.brand{position:absolute;bottom:30px;font-size:20px;opacity:.7;letter-spacing:3px;text-transform:uppercase}</style></head>
<body><div class="flyer"><div class="badge">✦ CreatiHub ✦</div><h1>${esc(flyer.headline)}</h1><p class="sub">${esc(flyer.subtext)}</p><div class="phone">${esc(flyer.phone)}</div><div class="brand">Made with CreatiHub</div></div></body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `attachment; filename="creatihub-flyer-${flyer.reference}.html"`);
  res.send(html);
});

// ============================================================
// Boot — hydrate the database (async for Postgres) then start listening
// ============================================================
async function start() {
  if (USE_POSTGRES) {
    // Await the PostgreSQL load so `db` is fully hydrated before serving.
    try {
      db = await dbBackend.load();
      console.log('✅ PostgreSQL connected successfully — data is now persistent!');
    } catch (pgErr) {
      console.error('⚠️  PostgreSQL connection failed:', pgErr.message);
      console.error('⚠️  Falling back to JSON-file backend (data will NOT persist across redeploys).');
      console.error('⚠️  Please check your DATABASE_URL variable in Railway.');
      // Fall back to JSON file backend — also switch dbBackend so sendEmail/notify
      // use the JSON versions (otherwise db-pg.js getDb() throws "not yet loaded")
      const jsonDb = require('./db');
      db = jsonDb.getDb();
      // Re-bind the helper functions to the JSON backend
      Object.assign(dbBackend, {
        sendEmail: jsonDb.sendEmail,
        notify: jsonDb.notify,
        logActivity: jsonDb.logActivity,
        getDb: jsonDb.getDb,
        save: jsonDb.save
      });
    }
  }
  app.listen(PORT, () => {
    console.log(`✅ CreatiHub running on http://localhost:${PORT}`);
    // Start automatic daily database backups (protects user data).
    // Backups are most valuable for the JSON-file backend; with Postgres the
    // database is already durable, but local snapshots remain a useful export.
    try { backup.startScheduler(); } catch (e) { console.error('Backup scheduler failed:', e.message); }
  });
}

start().catch(err => {
  console.error('❌ Failed to start CreatiHub:', err.message);
  // Don't immediately exit — try one more time with JSON fallback
  console.error('⚠️  Attempting emergency JSON-file fallback...');
  try {
    const jsonDb = require('./db');
    db = jsonDb.getDb();
    app.listen(PORT, () => {
      console.log(`✅ CreatiHub running (JSON fallback) on http://localhost:${PORT}`);
    });
  } catch (e2) {
    console.error('❌ Emergency fallback also failed:', e2.message);
    process.exit(1);
  }
});
