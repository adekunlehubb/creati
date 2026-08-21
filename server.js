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
  if (order.paymentStatus === 'paid') return order; // idempotent
  order.paymentStatus = 'paid';
  order.paidAt = info.paidAt || new Date().toISOString();
  order.paymentChannel = info.channel || 'card';
  if (info.amount != null) order.paidAmount = info.amount;
  if (info.currency) order.paidCurrency = info.currency;
  order.timeline.push({
    status: 'pending',
    at: new Date().toISOString(),
    note: `Payment confirmed via Paystack${info.channel ? ' (' + info.channel + ')' : ''}${info.source === 'webhook' ? ' [webhook]' : ''}`
  });
  save();
  logActivity('payment', `Payment received for ${order.id}`,
    `${order.userName} paid $${order.price} for ${order.serviceName} (${order.packageName}) via Paystack${info.channel ? ' / ' + info.channel : ''}`);
  notify('payment', `💳 Payment confirmed — ${order.id}`,
    `${order.userName} (${order.userEmail}) paid for:\n\n• Service: ${order.serviceName}\n• Package: ${order.packageName}\n• Amount: $${order.price}\n• Reference: ${order.paymentReference}\n• Channel: ${order.paymentChannel}\n\nThe order is now in your queue.`);
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
  const charge = paystack.toChargeAmount(extras.totalUsd, displayCurrency, CURRENCY_RATES);
  const reference = 'CH' + Date.now().toString(36).toUpperCase() + uid('p').slice(2, 8).toUpperCase();

  const order = {
    id: 'CH-' + (db.orderCounter++),
    userId: req.user.id, userName: req.user.name, userEmail: req.user.email,
    serviceId: svc.id, serviceName: svc.name,
    packageId: pkg.id, packageName: pkg.name,
    price: extras.totalUsd,                 // total charged (incl. upsells)
    basePrice: extras.basePrice,            // package base price (for analytics)
    currency: 'USD',
    rushDelivery: extras.rush,
    rushSurcharge: extras.rushSurcharge,
    addons: extras.addons,                  // [{id,name,price}]
    addonsTotal: extras.addonsTotal,
    status: 'awaiting_payment',
    requirements: requirements || '',
    paymentMethod: 'paystack',
    paymentReference: reference,
    paymentStatus: 'unpaid',
    chargeCurrency: charge.currency,
    chargeAmount: charge.amount,
    createdAt: new Date().toISOString(),
    timeline: [{ status: 'awaiting_payment', at: new Date().toISOString(), note: 'Order created — awaiting Paystack payment' }]
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
    subscriptionPlans: Array.isArray(settings.subscriptionPlans) ? settings.subscriptionPlans : []
  });
});

// Payment callback page (Paystack redirects here after checkout)
app.get('/payment/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-callback.html'));
});

// SPA-ish fallback for known pages
const pages = ['', 'services', 'order', 'auth', 'dashboard', 'admin'];
pages.forEach(p => {
  app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, 'public', (p || 'index') + '.html')));
});

// ============================================================
// Boot — hydrate the database (async for Postgres) then start listening
// ============================================================
async function start() {
  if (USE_POSTGRES) {
    // Await the PostgreSQL load so `db` is fully hydrated before serving.
    db = await dbBackend.load();
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
  process.exit(1);
});
