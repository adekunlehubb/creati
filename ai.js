// ============================================================
// CreatiHub AI Engine
// - User assistant: service recommendations, pricing, order help
// - Admin assistant: business analytics, insights, management
// - AI safety filter: blocks prompt injection, blocked topics, PII
// ============================================================
const { getDb, logAiActivity, aiAuditLog } = require('./db');

const CURRENCY_RATES = {
  USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, INR: 83.2, KES: 129,
  ZAR: 18.4, CAD: 1.36, AUD: 1.52, AED: 3.67, BRL: 5.05, PHP: 58.5
};
const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', NGN: '₦', INR: '₹', KES: 'KSh ',
  ZAR: 'R', CAD: 'C$', AUD: 'A$', AED: 'د.إ', BRL: 'R$', PHP: '₱'
};

function convertPrice(usd, currency) {
  const rate = CURRENCY_RATES[currency] || 1;
  const sym = CURRENCY_SYMBOLS[currency] || '$';
  const val = usd * rate;
  const rounded = val >= 100 ? Math.round(val) : Math.round(val * 100) / 100;
  return sym + rounded.toLocaleString();
}

function findServices(query) {
  const db = getDb();
  const q = query.toLowerCase();
  const keywords = {
    'flyer-design': ['flyer', 'poster', 'banner', 'brochure', 'leaflet', 'print'],
    'automated-video': ['video', 'reel', 'animation', 'promo', 'ad', 'youtube', 'tiktok', 'intro', 'edit'],
    'cartoon-maker': ['cartoon', 'avatar', 'caricature', 'mascot', 'portrait', 'character', 'drawing'],
    'logo-design': ['logo', 'brand', 'identity', 'branding'],
    'social-media-kit': ['social', 'instagram', 'facebook', 'post', 'story', 'content'],
    'voiceover': ['voice', 'voiceover', 'narration', 'audio', 'podcast', 'dubbing'],
    'website-design': ['website', 'web', 'landing', 'page', 'site'],
    'seo-copywriting': ['seo', 'blog', 'article', 'copy', 'writing', 'content writing'],
    'ai-chatbot': ['chatbot', 'bot', 'automation', 'whatsapp'],
    'product-photography': ['product photo', 'product photography', 'photography', 'photo shoot', 'ecommerce', 'amazon', 'shopify', 'product image'],
    'music-jingles': ['music', 'jingle', 'song', 'soundtrack', 'background music', 'audio branding', 'theme song'],
    'pitch-deck': ['pitch', 'deck', 'presentation', 'slides', 'investor', 'powerpoint', 'keynote'],
    'pro-headshots': ['headshot', 'professional photo', 'linkedin photo', 'corporate photo', 'portrait photo', 'profile photo'],
    'youtube-thumbnails': ['thumbnail', 'youtube thumbnail', 'ctr', 'click'],
    'merch-tshirt': ['tshirt', 't-shirt', 'merch', 'merchandise', 'print on demand', 'hoodie', 'apparel'],
    'book-cover': ['book', 'cover', 'ebook', 'e-book', 'kindle', 'kdp', 'paperback', 'author', 'publishing'],
    'translation': ['translate', 'translation', 'localization', 'language', 'subtitle', 'localize', 'spanish', 'french', 'arabic'],
    'email-campaign': ['email', 'newsletter', 'campaign', 'mailchimp', 'klaviyo', 'email marketing'],
    'virtual-staging': ['staging', 'real estate', 'interior', 'property', 'furniture', 'room', 'home']
  };
  const matches = [];
  for (const svc of db.services) {
    let score = 0;
    if (svc.name.toLowerCase().includes(q) || svc.category.toLowerCase().includes(q)) score += 3;
    for (const [id, words] of Object.entries(keywords)) {
      if (id === svc.id && words.some(w => q.includes(w))) score += 2;
    }
    if (score > 0) matches.push({ ...svc, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}

// ---------------- USER ASSISTANT ----------------
function userAssistant(message, user) {
  const db = getDb();
  const q = message.toLowerCase().trim();
  const cur = (user && user.currency) || 'USD';
  const name = user ? user.name.split(' ')[0] : 'there';

  // Greetings
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo|hola)\b/.test(q)) {
    return {
      reply: `Hello ${name}! 👋 I'm **Nova**, your CreatiHub AI assistant. I can help you:\n\n• Find the perfect service (flyers, videos, cartoons, logos & more)\n• Compare packages & prices in your currency\n• Track your orders\n• Answer questions about delivery & revisions\n\nWhat would you like to create today?`,
      suggestions: ['Show me all services', 'I need a flyer', 'How much is a video?', 'Track my order']
    };
  }

  // Track orders
  if (/track|order status|my order|where is my/.test(q)) {
    if (!user) return { reply: 'Please log in first so I can look up your orders. You can log in from the Account page.', suggestions: ['Show services'] };
    const orders = db.orders.filter(o => o.userId === user.id);
    if (!orders.length) return { reply: `You don't have any orders yet, ${name}. Would you like me to recommend a service to get started?`, suggestions: ['Show me all services', 'I need a logo'] };
    const lines = orders.slice(0, 5).map(o => {
      const emoji = { pending: '🕐', in_progress: '⚙️', completed: '✅', cancelled: '❌' }[o.status] || '📦';
      return `${emoji} **${o.id}** — ${o.serviceName} (${o.packageName}) — *${o.status.replace('_', ' ')}*`;
    });
    return { reply: `Here are your recent orders:\n\n${lines.join('\n')}\n\nYou can see full details in your Dashboard.`, suggestions: ['Show me all services', 'I need something else'] };
  }

  // Pricing questions
  const priceMatch = /price|cost|how much|cheap|expensive|pricing/.test(q);
  const matches = findServices(q);

  if (matches.length > 0) {
    const svc = matches[0];
    const pkgs = svc.packages.map(p => `• **${p.name}** — ${convertPrice(p.price, cur)}: ${p.desc}`).join('\n');
    if (priceMatch || matches.length === 1 || /need|want|looking|create|make|get/.test(q)) {
      return {
        reply: `Great choice! Here's **${svc.name}** ${svc.icon}\n\n${svc.tagline}.\n\n**Packages (in ${cur}):**\n${pkgs}\n\n⏱️ Average delivery: **${svc.deliveryDays} day(s)** • ⭐ Rated ${svc.rating}/5 (${svc.orders}+ orders)\n\nWould you like to order this service?`,
        suggestions: [`Order ${svc.name}`, 'Compare with other services', 'Show me all services'],
        serviceId: svc.id
      };
    }
  }

  // List all services
  if (/all services|show.*service|what.*(offer|do you)|list|catalog|everything/.test(q)) {
    const list = db.services.map(s => `${s.icon} **${s.name}** — from ${convertPrice(s.packages[0].price, cur)}`).join('\n');
    return {
      reply: `Here's everything CreatiHub offers worldwide 🌍\n\n${list}\n\nTell me which one interests you, or describe your project and I'll recommend the best fit!`,
      suggestions: ['I need a flyer', 'I need a video', 'I need a cartoon avatar', 'I need a website']
    };
  }

  // Delivery / revisions / payment FAQs
  if (/deliver|how long|turnaround|fast|deadline/.test(q)) {
    return { reply: `Delivery times depend on the service:\n\n• 🎙️ Voiceovers & 🌍 translations: ~24 hours\n• 📸 Product photos & 🤳 headshots: ~24 hours\n• 🎨 Flyers, cartoons & 👕 merch: ~2 days\n• 🎬 Videos & 📧 email campaigns: ~2-3 days\n• 📊 Pitch decks & 📖 book covers: ~3 days\n• 💻 Websites: ~5 days\n\nPremium packages include **priority delivery**. Every order shows a live status tracker in your dashboard!`, suggestions: ['Show me all services', 'Track my order'] };
  }
  if (/revision|change|edit|refund|guarantee/.test(q)) {
    return { reply: `Every package includes free revision rounds (Premium = unlimited!). If you're not happy after revisions, we offer a **satisfaction guarantee** — contact support from your dashboard and we'll make it right or refund you.`, suggestions: ['Show me all services'] };
  }
  if (/pay|payment|card|paypal|crypto|method/.test(q)) {
    return { reply: `We accept payments worldwide 🌍\n\n• 💳 Credit/Debit cards (Visa, Mastercard, Amex)\n• 🅿️ PayPal\n• 🏦 Bank transfer (selected regions)\n• ₿ Crypto (BTC, USDT)\n\nAll prices automatically convert to your local currency. Checkout is 100% secure.`, suggestions: ['Show me all services', 'What currencies do you support?'] };
  }
  if (/currenc|country|worldwide|international|global|language/.test(q)) {
    return { reply: `CreatiHub serves **every country worldwide**! 🌍\n\n• Prices shown in 12 currencies (USD, EUR, GBP, NGN, INR, KES, ZAR, CAD, AUD, AED, BRL, PHP)\n• AI voiceovers in 40+ languages\n• 24/7 support in English, Spanish, French, Arabic & Portuguese\n\nYour currency is currently set to **${cur}** — you can change it anytime from the top menu.`, suggestions: ['Show me all services'] };
  }
  if (/thank|thanks|great|awesome|cool/.test(q)) {
    return { reply: `You're very welcome, ${name}! 😊 I'm here 24/7 whenever you need help. Ready to create something amazing?`, suggestions: ['Show me all services', 'Track my order'] };
  }

  // Fallback — try to be helpful
  if (matches.length > 1) {
    const list = matches.slice(0, 3).map(s => `${s.icon} **${s.name}** — from ${convertPrice(s.packages[0].price, cur)}`).join('\n');
    return { reply: `Based on what you said, these services might fit:\n\n${list}\n\nWhich one would you like to explore?`, suggestions: matches.slice(0, 3).map(s => `Tell me about ${s.name}`) };
  }
  return {
    reply: `I want to make sure I help you right! I can assist with:\n\n• 🎨 **Design** — flyers, logos, social kits, thumbnails, merch\n• 🎬 **Video & Audio** — automated promos, voiceovers, music & jingles\n• 📸 **Photography** — product shoots, professional headshots, staging\n• 💻 **Web & AI** — websites, chatbots, translation\n• ✍️ **Writing & Business** — SEO content, pitch decks, email campaigns, book covers\n\nTry describing your project, e.g. *"I need a promo video for my restaurant"*`,
    suggestions: ['Show me all services', 'How much is a logo?', 'Track my order']
  };
}

// ---------------- ADMIN ASSISTANT ----------------
function adminAssistant(message) {
  const db = getDb();
  const q = message.toLowerCase().trim();
  const orders = db.orders;
  const users = db.users.filter(u => u && u.role !== 'admin');

  const revenue = orders.filter(o => o.paymentStatus === 'paid' && o.status !== 'cancelled').reduce((s, o) => s + o.price, 0);
  const pending = orders.filter(o => o.status === 'pending');
  const inProgress = orders.filter(o => o.status === 'in_progress');
  const completed = orders.filter(o => o.status === 'completed');

  // Greetings
  if (/^(hi|hello|hey)\b/.test(q)) {
    return {
      reply: `Hello Admin! 👋 I'm **Nova Admin**, your AI business analyst. I have live access to your store data. Ask me things like:\n\n• "How is business today?"\n• "Which service sells best?"\n• "Show pending orders"\n• "Give me growth insights"`,
      suggestions: ['Business summary', 'Show pending orders', 'Best selling services', 'Growth insights']
    };
  }

  // Summary / overview
  if (/summary|overview|how is business|report|stats|dashboard|today|performance/.test(q)) {
    return {
      reply: `📊 **Business Summary**\n\n• 💰 Total revenue: **$${revenue.toLocaleString()}**\n• 📦 Total orders: **${orders.length}** (${pending.length} pending, ${inProgress.length} in progress, ${completed.length} completed)\n• 👥 Registered customers: **${users.length}**\n• 🛠️ Active services: **${db.services.length}**\n\n${pending.length > 0 ? `⚠️ You have **${pending.length} pending order(s)** waiting to be processed — I recommend actioning those first.` : '✅ No pending orders — great job staying on top of things!'}`,
      suggestions: ['Show pending orders', 'Best selling services', 'Growth insights']
    };
  }

  // Pending orders
  if (/pending|new order|unprocessed|queue/.test(q)) {
    if (!pending.length) return { reply: '✅ No pending orders right now. Everything is being processed!', suggestions: ['Business summary'] };
    const lines = pending.map(o => `• **${o.id}** — ${o.serviceName} (${o.packageName}) — $${o.price} — by ${o.userName}`).join('\n');
    return { reply: `🕐 **Pending orders (${pending.length}):**\n\n${lines}\n\nYou can update their status from the Orders table in the dashboard.`, suggestions: ['Business summary', 'Growth insights'] };
  }

  // Best sellers
  if (/best|top|selling|popular|most/.test(q)) {
    const counts = {};
    orders.forEach(o => { counts[o.serviceName] = (counts[o.serviceName] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return { reply: 'No order data yet to analyze. Once orders come in, I can rank your best sellers!', suggestions: ['Business summary'] };
    const lines = sorted.map(([name, count], i) => `${['🥇', '🥈', '🥉'][i] || '•'} **${name}** — ${count} order(s)`).join('\n');
    return { reply: `🏆 **Best selling services:**\n\n${lines}\n\n💡 Consider promoting your top performers on the homepage hero section.`, suggestions: ['Business summary', 'Growth insights'] };
  }

  // Customers
  if (/customer|user|client|who/.test(q)) {
    const lines = users.slice(0, 8).map(u => `• **${u.name}** (${u.email}) — ${u.country || 'N/A'}`).join('\n');
    return { reply: `👥 **Registered customers (${users.length}):**\n\n${lines || 'No customers yet.'}`, suggestions: ['Business summary'] };
  }

  // Revenue
  if (/revenue|money|income|earn|profit|sales/.test(q)) {
    const byService = {};
    orders.filter(o => o.paymentStatus === 'paid' && o.status !== 'cancelled').forEach(o => { byService[o.serviceName] = (byService[o.serviceName] || 0) + o.price; });
    const lines = Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([n, v]) => `• **${n}**: $${v.toLocaleString()}`).join('\n');
    return { reply: `💰 **Revenue breakdown:**\n\nTotal: **$${revenue.toLocaleString()}**\n\n${lines || 'No revenue yet.'}\n\n💡 Average order value: **$${orders.length ? Math.round(revenue / orders.length) : 0}**`, suggestions: ['Best selling services', 'Growth insights'] };
  }

  // Growth insights
  if (/insight|growth|grow|improve|recommend|suggest|advice|strategy/.test(q)) {
    const completionRate = orders.length ? Math.round((completed.length / orders.length) * 100) : 0;
    return {
      reply: `🚀 **AI Growth Insights for CreatiHub:**\n\n1. **Order completion rate is ${completionRate}%** — ${completionRate < 70 ? 'focus on faster turnaround to boost reviews.' : 'excellent! Showcase this in marketing.'}\n2. **Bundle opportunity:** Customers who order flyers often need social media kits — create a "Launch Pack" bundle at 15% off.\n3. **Global reach:** Enable local payment methods (M-Pesa, UPI, Pix) to convert more visitors from Africa & Asia.\n4. **Upsell:** After video orders, automatically suggest voiceover add-ons at checkout.\n5. **Retention:** ${users.length} registered customers — send a re-engagement coupon to those inactive 30+ days.\n\nWant me to drill into any of these?`,
      suggestions: ['Business summary', 'Best selling services', 'Show pending orders']
    };
  }

  // Help
  if (/help|what can you/.test(q)) {
    return { reply: `I can analyze your live store data. Try asking:\n\n• "Business summary" — revenue, orders, customers\n• "Show pending orders" — orders needing action\n• "Best selling services" — ranked by orders\n• "Revenue breakdown" — earnings per service\n• "Growth insights" — AI recommendations`, suggestions: ['Business summary', 'Growth insights'] };
  }

  return {
    reply: `I can help you run your business with live data. Try:\n\n• 📊 "Business summary"\n• 🕐 "Show pending orders"\n• 🏆 "Best selling services"\n• 💰 "Revenue breakdown"\n• 🚀 "Growth insights"`,
    suggestions: ['Business summary', 'Show pending orders', 'Growth insights']
  };
}

// ============================================================
// AI SAFETY FILTER
// Runs BEFORE userAssistant(). Returns { blocked, reason } when a message
// trips a guardrail, otherwise { blocked: false }. All blocked attempts are
// written to the AI audit trail so the admin can review them.
// ============================================================
function filterMessage(rawMessage, user) {
  const d = getDb();
  const s = d.aiSettings || {};
  const g = s.guardrails || {};
  const msg = String(rawMessage || '');
  const who = user ? `${user.name} (${user.email})` : 'A guest visitor';
  const uidStr = user ? user.id : 'guest';

  // Master kill switch
  if (s.enabled === false) {
    aiAuditLog(uidStr, msg, 'AI disabled by admin');
    return { blocked: true, reason: 'Nova is currently offline. Our team will be with you soon — please email support@creatihub.com.' };
  }

  // Length cap
  const maxLen = g.maxMessageLength || 1000;
  if (msg.length > maxLen) {
    aiAuditLog(uidStr, msg.slice(0, 300), 'Message too long');
    return { blocked: true, reason: `Your message is a bit long (max ${maxLen} characters). Could you shorten it?` };
  }

  const lower = msg.toLowerCase();

  // Prompt-injection blocklist
  if (g.blockPromptInjection !== false && Array.isArray(s.blockedPhrases)) {
    const hit = s.blockedPhrases.find(p => lower.includes(p.toLowerCase()));
    if (hit) {
      aiAuditLog(uidStr, msg, 'Prompt injection attempt: "' + hit + '"');
      logAiActivity('blocked', who, 'Blocked a prompt-injection attempt',
        `Nova refused a message containing: "${hit}". The attempt was logged to the AI audit trail.`);
      return { blocked: true, reason: 'I can only help with CreatiHub services, orders and support. How can I assist you with your project today?' };
    }
  }

  // Blocked topics
  if (Array.isArray(s.blockedTopics) && s.blockedTopics.length) {
    const topic = s.blockedTopics.find(t => lower.includes(t.toLowerCase()));
    if (topic) {
      aiAuditLog(uidStr, msg, 'Blocked topic: ' + topic);
      logAiActivity('blocked', who, 'Declined an off-topic message',
        `Nova declined to discuss "${topic}" — outside its business scope. Logged to audit trail.`);
      return { blocked: true, reason: `I'm Nova, CreatiHub's creative-services assistant, so I can't help with that topic. I can help you with flyers, videos, logos, websites and more — what would you like to create?` };
    }
  }

  // Personal-data scrub: detect and block messages that look like they contain
  // card numbers, long digit sequences, or raw passwords being shared.
  if (g.blockPersonalData !== false) {
    if (/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(msg) || /\b\d{13,19}\b/.test(msg)) {
      aiAuditLog(uidStr, msg.slice(0, 300), 'Shared card number / PII');
      logAiActivity('blocked', who, 'Blocked a message containing card data',
        'Nova stopped a chat where the user appeared to share a card number. No payment data is accepted over chat.');
      return { blocked: true, reason: 'For your security, please never share card numbers or payment details in chat. All payments are handled securely through Paystack at checkout.' };
    }
  }

  return { blocked: false };
}

// ============================================================
// AI ACTION LOGGER (wraps userAssistant + adminAssistant)
// Logs every AI task to the live admin feed so the admin can see, in real
// time, exactly what Nova is doing for each visitor / customer.
// ============================================================
function classifyUserIntent(message, reply) {
  const q = (message || '').toLowerCase();
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo|hola)\b/.test(q)) return { type: 'greeting', action: 'Greeted a visitor' };
  if (/track|order status|my order|where is my/.test(q)) return { type: 'order_help', action: 'Looked up a customer\'s orders' };
  if (/price|cost|how much|cheap|expensive|pricing/.test(q)) return { type: 'faq', action: 'Answered a pricing question' };
  if (/deliver|how long|turnaround|fast|deadline/.test(q)) return { type: 'faq', action: 'Answered a delivery-time question' };
  if (/revision|change|edit|refund|guarantee/.test(q)) return { type: 'faq', action: 'Answered a revisions / refund question' };
  if (/pay|payment|card|paypal|crypto|method/.test(q)) return { type: 'faq', action: 'Answered a payment question' };
  if (/currenc|country|worldwide|international|global|language/.test(q)) return { type: 'faq', action: 'Answered a currency / reach question' };
  if (/thank|thanks|great|awesome|cool/.test(q)) return { type: 'greeting', action: 'Closed a conversation politely' };
  if (/all services|show.*service|what.*(offer|do you)|list|catalog|everything/.test(q)) return { type: 'recommendation', action: 'Listed all services' };
  return { type: 'recommendation', action: 'Recommended a service' };
}

// Safe wrapper around the user assistant that applies the safety filter first
// and logs the AI action afterwards. This is what /api/chat calls.
function safeUserAssistant(message, user) {
  const filter = filterMessage(message, user);
  if (filter.blocked) {
    const who = user ? `${user.name} (${user.email})` : 'A guest visitor';
    logAiActivity('blocked', who, 'Refused a message (safety filter)', filter.reason);
    return {
      reply: filter.reason,
      suggestions: ['Show me all services', 'I need a flyer', 'Track my order'],
      blocked: true,
      blockReason: filter.reason
    };
  }
  const result = userAssistant(message, user);
  const who = user ? `${user.name} (${user.email})` : 'A guest visitor';
  const intent = classifyUserIntent(message, result.reply);
  const detail = result.serviceId
    ? `${who} asked: "${String(message).slice(0, 100)}" → Nova ${intent.action.toLowerCase()} and suggested ordering "${result.serviceId}".`
    : `${who} asked: "${String(message).slice(0, 100)}" → Nova ${intent.action.toLowerCase()}.`;
  logAiActivity(intent.type, who, intent.action, detail);
  return result;
}

// Safe wrapper for the admin assistant — logs analytics tasks too.
function safeAdminAssistant(message, adminName) {
  const d = getDb();
  const s = d.aiSettings || {};
  if (s.adminAssistantEnabled === false) {
    return { reply: 'The Nova admin assistant is currently disabled by an administrator. Re-enable it from the AI Safety tab.', suggestions: [] };
  }
  const result = adminAssistant(message);
  const who = adminName || 'Admin';
  const q = (message || '').toLowerCase();
  let action = 'Ran a business analysis';
  if (/summary|overview|how is business|report|stats|today|performance/.test(q)) action = 'Generated a business summary';
  else if (/pending|new order|unprocessed|queue/.test(q)) action = 'Listed pending orders';
  else if (/best|top|selling|popular|most/.test(q)) action = 'Ranked best-selling services';
  else if (/revenue|money|income|earn|profit|sales/.test(q)) action = 'Broke down revenue by service';
  else if (/insight|growth|grow|improve|recommend|suggest|advice|strategy/.test(q)) action = 'Generated AI growth insights';
  else if (/customer|user|client|who/.test(q)) action = 'Listed registered customers';
  else if (/^(hi|hello|hey)\b/.test(q)) action = 'Greeted the admin';
  logAiActivity('analytics', who, action, `${who} asked Nova Admin: "${String(message).slice(0, 100)}"`);
  return result;
}

module.exports = { userAssistant, adminAssistant, convertPrice, CURRENCY_RATES, CURRENCY_SYMBOLS, filterMessage, safeUserAssistant, safeAdminAssistant };
