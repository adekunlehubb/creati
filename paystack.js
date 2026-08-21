// ============================================================
// CreatiHub Paystack Integration
// ------------------------------------------------------------
// Wraps the Paystack REST API:
//   - initializeTransaction()  -> POST /transaction/initialize
//   - verifyTransaction()      -> GET  /transaction/verify/:ref
//   - verifyWebhookSignature() -> HMAC SHA512 check
//
// CONFIG (environment variables):
//   PAYSTACK_SECRET_KEY   - sk_test_... / sk_live_...  (required for live charges)
//   PAYSTACK_PUBLIC_KEY   - pk_test_... / pk_live_...  (exposed to frontend via /api/config)
//   PAYSTACK_CALLBACK_URL - optional override for the payment callback URL
//
// DEMO MODE: when PAYSTACK_SECRET_KEY is not set, the module simulates
// Paystack responses so the full checkout flow still works end-to-end
// without real keys. Payments are auto-"verified" in demo mode.
// ============================================================
const crypto = require('crypto');
const https = require('https');

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const DEMO_MODE = !SECRET_KEY;

// Paystack charges in the smallest currency unit (kobo/pesewas/cents)
// and natively supports these currencies. Others are converted to USD
// before charging (Paystack accepts USD for international cards).
const PAYSTACK_SUPPORTED = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'];
const ZERO_DECIMAL = []; // currencies without minor units (none of ours)

function isDemo() { return DEMO_MODE; }
function publicKey() { return PUBLIC_KEY; }

// Convert a USD amount + display currency into a Paystack-chargeable amount
function toChargeAmount(usdAmount, currency, rates) {
  let chargeCurrency = (currency || 'USD').toUpperCase();
  if (!PAYSTACK_SUPPORTED.includes(chargeCurrency)) chargeCurrency = 'USD';
  const rate = rates[chargeCurrency] || 1;
  const major = usdAmount * rate;
  const minor = ZERO_DECIMAL.includes(chargeCurrency)
    ? Math.round(major)
    : Math.round(major * 100);
  return { amount: minor, currency: chargeCurrency };
}

// ---------------- Low-level HTTPS helper (no external deps) ----------------
function paystackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: 'Bearer ' + SECRET_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && json.status) resolve(json);
          else reject(new Error(json.message || `Paystack error (HTTP ${res.statusCode})`));
        } catch (e) {
          reject(new Error('Invalid response from Paystack'));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Paystack request timed out')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------- Initialize a transaction ----------------
// Returns { authorization_url, access_code, reference, demo }
async function initializeTransaction({ email, amount, currency, reference, callbackUrl, metadata }) {
  if (DEMO_MODE) {
    // Simulated Paystack response — lets the whole flow run without keys
    return {
      demo: true,
      status: true,
      message: 'Authorization URL created (DEMO MODE)',
      data: {
        authorization_url: (callbackUrl || '/order') + (callbackUrl && callbackUrl.includes('?') ? '&' : '?') + 'reference=' + reference + '&demo=1',
        access_code: 'demo_' + reference,
        reference
      }
    };
  }
  const res = await paystackRequest('POST', '/transaction/initialize', {
    email,
    amount,                 // already in kobo/cents
    currency,               // NGN, GHS, ZAR, KES or USD
    reference,
    callback_url: callbackUrl,
    metadata: metadata || {}
  });
  return { demo: false, ...res };
}

// ---------------- Verify a transaction ----------------
// Returns { paid: bool, status, reference, amount, currency, channel, paidAt, customerEmail, raw }
async function verifyTransaction(reference) {
  if (DEMO_MODE) {
    return {
      demo: true,
      paid: true,
      status: 'success',
      reference,
      amount: null,
      currency: null,
      channel: 'demo',
      paidAt: new Date().toISOString(),
      customerEmail: null,
      raw: { demo: true }
    };
  }
  const res = await paystackRequest('GET', '/transaction/verify/' + encodeURIComponent(reference));
  const d = res.data || {};
  return {
    demo: false,
    paid: d.status === 'success',
    status: d.status,
    reference: d.reference,
    amount: d.amount,
    currency: d.currency,
    channel: d.channel,
    paidAt: d.paid_at || d.transaction_date,
    customerEmail: d.customer && d.customer.email,
    raw: d
  };
}

// ---------------- Webhook signature verification ----------------
// Paystack signs the RAW request body with HMAC-SHA512 using your secret key.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (DEMO_MODE) return false; // webhooks disabled in demo mode
  if (!signatureHeader) return false;
  const hash = crypto.createHmac('sha512', SECRET_KEY).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(signatureHeader)));
  } catch {
    return false;
  }
}

// ---------------- Create a recurring billing Plan ----------------
// Paystack Plans define a recurring amount + interval. A subscription links
// a customer to a plan. Returns { plan_code, ... } in live mode.
// interval: 'daily' | 'weekly' | 'monthly' | 'biannually' | 'annually'
async function createPlan({ name, amount, currency, interval, description }) {
  if (DEMO_MODE) {
    return {
      demo: true,
      status: true,
      message: 'Plan created (DEMO MODE)',
      data: { name, amount, currency, interval, plan_code: 'demo_plan_' + Date.now(), description }
    };
  }
  const res = await paystackRequest('POST', '/plan', {
    name, amount, currency, interval, description: description || ''
  });
  return res;
}

// ---------------- List all plans ----------------
async function listPlans() {
  if (DEMO_MODE) {
    return { demo: true, status: true, data: [] };
  }
  return paystackRequest('GET', '/plan');
}

// ---------------- Initialize a subscription transaction ----------------
// To start a subscription, you initialize a transaction with a `plan` code.
// Paystack charges the customer recurring amounts automatically afterwards.
async function initializeSubscription({ email, planCode, reference, callbackUrl, metadata }) {
  if (DEMO_MODE) {
    return {
      demo: true,
      status: true,
      message: 'Subscription initialized (DEMO MODE)',
      data: {
        authorization_url: (callbackUrl || '/order') + (callbackUrl && callbackUrl.includes('?') ? '&' : '?') + 'reference=' + reference + '&demo=1',
        access_code: 'demo_sub_' + reference,
        reference
      }
    };
  }
  const res = await paystackRequest('POST', '/transaction/initialize', {
    email,
    reference,
    plan: planCode,            // this makes it a subscription charge
    callback_url: callbackUrl,
    metadata: metadata || {}
  });
  return res;
}

module.exports = {
  isDemo,
  publicKey,
  toChargeAmount,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  createPlan,
  listPlans,
  initializeSubscription,
  PAYSTACK_SUPPORTED
};
