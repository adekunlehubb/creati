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
      reply: `👋 Welcome back, Admin! I'm **Nova**, your AI Co-Founder and business analyst. I have live access to your store data AND I can help you grow this platform.\n\nI can do TWO things for you:\n\n📊 **Business Analytics** — revenue, orders, best sellers, growth insights\n🧠 **Co-Founder Strategy** — brainstorm growth ideas, discuss features, plan scaling\n🎨 **Content Generation** — I can write promo video scripts, flyer copy, social media posts, cartoon ad concepts, WhatsApp broadcasts, email campaigns, and ad copy for you RIGHT NOW\n\nType "help" to see everything I can do, or pick a suggestion below! ↓`,
      suggestions: ['Let\'s discuss growth', 'Generate a promo video script', 'Write social media posts', 'Create a cartoon ad concept', 'Business summary', 'How do we get more traffic?']
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
  if (/revenue breakdown|how.*revenue|revenue|income|earn|profit|sales/.test(q)) {
    const byService = {};
    orders.filter(o => o.paymentStatus === 'paid' && o.status !== 'cancelled').forEach(o => { byService[o.serviceName] = (byService[o.serviceName] || 0) + o.price; });
    const lines = Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([n, v]) => `• **${n}**: $${v.toLocaleString()}`).join('\n');
    return { reply: `💰 **Revenue breakdown:**\n\nTotal: **$${revenue.toLocaleString()}**\n\n${lines || 'No revenue yet.'}\n\n💡 Average order value: **$${orders.length ? Math.round(revenue / orders.length) : 0}**`, suggestions: ['Best selling services', 'Growth insights'] };
  }

  // Growth insights
  if (/insight|how.*grow|grow.*insight|improve|recommend|suggest|advice|strategy/.test(q)) {
    const completionRate = orders.length ? Math.round((completed.length / orders.length) * 100) : 0;
    return {
      reply: `🚀 **AI Growth Insights for CreatiHub:**\n\n1. **Order completion rate is ${completionRate}%** — ${completionRate < 70 ? 'focus on faster turnaround to boost reviews.' : 'excellent! Showcase this in marketing.'}\n2. **Bundle opportunity:** Customers who order flyers often need social media kits — create a "Launch Pack" bundle at 15% off.\n3. **Global reach:** Enable local payment methods (M-Pesa, UPI, Pix) to convert more visitors from Africa & Asia.\n4. **Upsell:** After video orders, automatically suggest voiceover add-ons at checkout.\n5. **Retention:** ${users.length} registered customers — send a re-engagement coupon to those inactive 30+ days.\n\nWant me to drill into any of these?`,
      suggestions: ['Business summary', 'Best selling services', 'Show pending orders']
    };
  }

  // ============================================================
  // AI CO-FOUNDER MODE — strategy, brainstorming, growth ideas
  // ============================================================

  // Co-founder greeting / intro
  if (/co.?founder|partner|brainstorm|let.s talk|let.s discuss|exchange.*idea|discuss.*growth|talk.*about.*grow/.test(q)) {
    return {
      reply: `🧠 **Co-Founder Mode activated.**\n\nAlright, let's roll up our sleeves. I'm not just your analyst anymore \u2014 I'm your thought partner. Here's how I see CreatiHub right now based on the live data:\n\n📊 **Where we stand:**\n\u2022 Revenue: **$${revenue.toLocaleString()}** across ${orders.length} orders\n\u2022 ${users.length} registered customers\n\u2022 ${db.services.length} active services + ${db.naijaTemplates ? db.naijaTemplates.length : 12} Naija templates\n\u2022 We have bundles, installments, referrals, reviews, and a free lead-magnet funnel\n\n🔥 **My honest take:** The product is strong. The differentiators (Brand-in-a-Box, Naija templates, instant flyer tool, business name generator) are genuinely unique \u2014 most competitors don't have these. The bottleneck now isn't features, it's **traffic and trust**.\n\nHere's what I'd prioritize as your co-founder:\n\n1. **Content marketing engine** \u2014 Let me generate promo videos, flyers, and ad copy for you to post daily on Instagram, TikTok, and WhatsApp Status. Consistency beats perfection.\n2. **WhatsApp community** \u2014 Start a "CreatiHub Design Tips" broadcast list. Free value \u2192 trust \u2192 orders.\n3. **Referral flywheel** \u2014 Your referral program exists but needs promotion. Let's craft the messaging.\n4. **Local SEO** \u2014 "flyer designer in Nigeria," "logo design Lagos," etc.\n\nWhat do you want to tackle first? I can generate actual marketing content right now \u2014 just say the word.`,
      suggestions: ['Generate a promo video script', 'Create a flyer for our platform', 'Write social media posts', 'Create a cartoon ad concept', 'How do we get more traffic?', 'What features should we add next?']
    };
  }

  // Traffic / customer acquisition strategy
  if (/traffic|get.*more.*customer|acquire|marketing|promote|advertise|ads|how.*get.*user|how.*get.*order|bring.*customer|attract/.test(q)) {
    return {
      reply: `📈 **Customer Acquisition Strategy \u2014 7 Channels Ranked by ROI for CreatiHub:**\n\n**1. 📱 WhatsApp Marketing (HIGHEST ROI in Nigeria/Africa)**\n\u2022 Create a CreatiHub WhatsApp broadcast list \u2014 share daily design tips + before/after showcases\n\u2022 Post your reviews carousel screenshots in WhatsApp groups\n\u2022 Offer "WhatsApp-exclusive" 10% discount codes\n\u2022 Cost: FREE. Effort: 30 min/day.\n\n**2. 🎬 Short-Form Video (Instagram Reels + TikTok)**\n\u2022 Post "speed design" videos \u2014 screen-record yourself making a flyer in 60 seconds\n\u2022 Before/after transformations get massive engagement\n\u2022 Use trending Nigerian audio (Afrobeats)\n\u2022 I can write the video scripts for you \u2014 just ask!\n\n**3. 🗣\ufe0f Word of Mouth + Referrals**\n\u2022 Your referral program gives $2 credit to both sides \u2014 push it harder\n\u2022 DM every completed-order customer: "Enjoyed working on your project! Here's your referral code for $2 off next time"\n\n**4. 📞 Local Networking**\n\u2022 Print sample flyers, approach churches, event planners, restaurants, small businesses\n\u2022 Offer one free sample flyer to get your foot in the door\n\n**5. 🔍 Local SEO + Google Business Profile**\n\u2022 Register "CreatiHub" on Google Business (free)\n\u2022 Target keywords: "flyer designer Nigeria," "logo design Lagos," "affordable flyer design"\n\n**6. 📧 Email marketing**\n\u2022 Collect emails from every visitor (lead magnet: free business name tool already does this)\n\u2022 Weekly newsletter with design tips + special offers\n\n**7. 💰 Paid Ads (later, once organic works)**\n\u2022 Facebook/Instagram ads targeting Nigerian small business owners, $5-10/day\n\u2022 WhatsApp click-to-chat ads\n\n**My recommendation:** Start with channels 1, 2, and 3 THIS WEEK. They're free and high-impact. Want me to generate the content for any of these?`,
      suggestions: ['Generate a promo video script', 'Write social media posts', 'Create a flyer for our platform', 'Write WhatsApp broadcast messages']
    };
  }

  // Feature ideas / what to add next / platform improvement
  if (/what.*add|what.*build|what.*feature|new feature|improve.*platform|next feature|should we add|platform.*improve|what.*next|roadmap/.test(q)) {
    return {
      reply: `🚀 **Feature Roadmap \u2014 10 Ideas Ranked by Impact:**\n\n**TIER 1 \u2014 High Impact, Easy to Build:**\n1. **📅 Booking/Calendar System** \u2014 Let clients book design consultations or pick delivery dates. Reduces back-and-forth messaging.\n2. **💬 In-app Messaging** \u2014 Clients chat with you directly in the platform instead of WhatsApp/email. Keeps everything organized.\n3. **🎨 Design Request Forms** \u2014 Structured forms (color preferences, style, inspiration links) so clients give you everything upfront.\n4. **\u2b50 Automated Review Requests** \u2014 Auto-DM/email customers 24h after delivery asking for a review. Feeds your reviews carousel.\n\n**TIER 2 \u2014 Medium Impact, Medium Effort:**\n5. **🎁 Loyalty Program** \u2014 Points per order, redeem for discounts. Complements referrals.\n6. **📊 Client Dashboard Analytics** \u2014 Show clients their own order history, spend, and saved designs.\n7. **🗂\ufe0f Design Portfolio/Gallery** \u2014 Public gallery of your best work (beyond reviews). Like a Behance/Dribbble for CreatiHub.\n8. **🔄 Revision Tracking** \u2014 Let clients request revisions through the platform with specific feedback annotations.\n\n**TIER 3 \u2014 Big Bets (Later):**\n9. **🤝 Designer Marketplace** \u2014 Let other Nigerian designers join CreatiHub as freelancers. You take a commission. Scales beyond your personal capacity.\n10. **🎓 Design Courses** \u2014 Sell "How to design flyers in Canva" courses. New revenue stream + positions you as an expert.\n\n**My co-founder pick:** Start with #3 (design request forms) and #4 (automated review requests) \u2014 they directly increase conversion and social proof with minimal build effort. Want me to think through any of these in detail?`,
      suggestions: ['Tell me about the designer marketplace', 'How would loyalty points work?', 'What about the booking system?', 'Generate a promo video script']
    };
  }

  // Monetization / revenue ideas
  if (/monetiz|more.*revenue|more.*money|make.*money|earn more|income stream|subscription|recurring/.test(q)) {
    return {
      reply: `💰 **Monetization Expansion \u2014 8 Revenue Streams for CreatiHub:**\n\n**Already active:**\n\u2705 Per-project service sales\n\u2705 Bundle pricing (Brand-in-a-Box)\n\u2705 Rush delivery upsell\n\u2705 WhatsApp delivery upsell\n\u2705 Installment billing\n\u2705 Instant flyer tool ($5 micro-sales)\n\u2705 Subscription billing (Paystack recurring)\n\n**New streams to add:**\n\n1. **📈 Premium Membership ($15-25/month)** \u2014 Clients get: 10% off all orders, priority delivery, unlimited revisions, free monthly mini-design (social post). Predictable recurring revenue.\n\n2. **🎓 Digital Products (one-time)** \u2014 Sell pre-made template packs: "50 Naija Party Flyer Templates" for $20. Build once, sell forever. Zero marginal cost.\n\n3. **🤝 Commission Marketplace** \u2014 Other designers sell through CreatiHub, you take 15-20% commission. Infinite scaling.\n\n4. **📋 Design Retainers** \u2014 Monthly contracts with businesses: "4 social posts + 1 flyer + 1 video per month for $150." Stable income.\n\n5. **🎓 Courses & Tutorials** \u2014 "Design Your Own Flyer in 7 Days" course for $30-50. Leverages your expertise.\n\n6. **🖼\ufe0f Stock Asset Store** \u2014 Sell Nigerian-themed design assets (fonts, graphics, textures) that other designers need.\n\n**My recommendation:** #1 (premium membership) is the fastest win \u2014 you already have subscription billing via Paystack. We'd just need to add a membership tier page. #2 (template packs) is also low-hanging fruit. Want me to plan the membership feature?`,
      suggestions: ['Plan the premium membership feature', 'How would template packs work?', 'What about design retainers?', 'Generate a promo video script']
    };
  }

  // Scaling / growth at scale
  if (/scale|grow.*big|expand|take.*to.*next.*level|million|huge growth|massive/.test(q)) {
    return {
      reply: `🎯 **Scaling CreatiHub \u2014 From Side Hustle to Agency:**\n\n**Phase 1: Solo Pro (Now \u2192 50 orders/month)**\n\u2022 You handle all design work\n\u2022 Focus: consistent marketing, build reviews, refine process\n\u2022 Goal: $2,000-3,000/month\n\u2022 Tools: You + Nova AI for content generation\n\n**Phase 2: Small Team (50-150 orders/month)**\n\u2022 Hire 1-2 junior designers (or partner with design students)\n\u2022 You become creative director \u2014 review their work, handle client relationships\n\u2022 Implement the designer marketplace so freelancers can join\n\u2022 Goal: $5,000-8,000/month\n\u2022 Key hire: A social media manager (or use Nova AI to generate daily content)\n\n**Phase 3: Agency (150+ orders/month)**\n\u2022 Team of 3-5 designers + project manager + social media person\n\u2022 CreatiHub becomes a brand, not just your personal service\n\u2022 Launch design courses as a secondary revenue stream\n\u2022 Goal: $15,000-25,000/month\n\u2022 Focus: Operations, quality control, brand partnerships\n\n**Phase 4: Platform (The big vision)**\n\u2022 CreatiHub becomes the go-to marketplace connecting Nigerian/African creatives with clients globally\n\u2022 You earn from commissions, premium listings, courses, and your own design work\n\u2022 Goal: $50,000+/month\n\n**The critical bottleneck at each phase is NOT design skill \u2014 it's lead generation and operations.** That's why I keep pushing the content marketing + automation angle. The businesses that win are the ones that show up every single day.\n\nWhat phase are you targeting, and what's your timeline? I'll help you reverse-engineer the steps.`,
      suggestions: ['Generate a promo video script', 'Write social media posts', 'How do we get more traffic?', 'What features should we add next?']
    };
  }

  // Competitive analysis / standing out
  if (/competitor|competition|stand out|differentiat|fiverr|upwork|canva|vs other|unique.*selling/.test(q)) {
    return {
      reply: `🏆 **Competitive Analysis \u2014 How CreatiHub Wins:**\n\n**The landscape:**\n\u2022 **Fiverr/Upwork** \u2014 Huge but generic, quality inconsistent, feels impersonal, hard to stand out as a seller\n\u2022 **Canva** \u2014 DIY tool, but most people DON'T want to design \u2014 they want it DONE. Canva users are a different market.\n\u2022 **Local Nigerian designers** \u2014 Good but hard to find, no online ordering, no reviews, no automated process\n\n**CreatiHub's unfair advantages (what they can't easily copy):**\n\n1. **🇳🇬 Naija Templates** \u2014 Burial programs, Aso Ebi flyers, church crusade posters. Fiverr designers don't understand these cultural occasions. YOU DO.\n\n2. **🗣\ufe0f Nigerian Voiceover Languages** \u2014 Yoruba, Igbo, Hausa, Pidgin. Global platforms don't offer this.\n\n3. **🧠 AI Co-Founder (me!)** \u2014 You're not just a designer, you're running a tech-enabled studio. The AI business name generator + instant flyer tool make CreatiHub feel like a premium platform, not a freelancer page.\n\n4. **💳 Installment Billing** \u2014 Big selling point in Nigeria where cash flow is tight. Fiverr doesn't offer this.\n\n5. **📱 WhatsApp Delivery** \u2014 Nigerians LIVE on WhatsApp. Meeting them where they are is a massive advantage.\n\n6. **📦 Brand-in-a-Box** \u2014 One purchase, complete brand identity. Most competitors sell piece by piece.\n\n**Your positioning statement:**\n*"CreatiHub is Nigeria's AI-powered creative studio \u2014 we design flyers, videos, brands, and ads with cultural understanding that global platforms can't match. Premium quality, flexible payments, WhatsApp delivery."*\n\n**Don't compete on price with Fiverr. Compete on cultural fluency, convenience, and the complete brand experience.** That's your moat.\n\nWant me to turn this positioning into marketing copy?`,
      suggestions: ['Write our positioning as ad copy', 'Generate a promo video script', 'Create a flyer for our platform', 'Write social media posts']
    };
  }

  // ============================================================
  // CONTENT GENERATORS \u2014 actual marketing content creation
  // ============================================================

  // Video promo script generator
  if (/video.*script|promo.*video|script.*video|advert.*video|video.*ad|reel.*script|tiktok.*script|generate.*video/.test(q)) {
    const serviceMatch = db.services.find(s => q.includes(s.name.toLowerCase()) || q.includes(s.id));
    const target = serviceMatch ? serviceMatch.name : 'CreatiHub';
    return {
      reply: `🎬 **Promo Video Script \u2014 30-Second Instagram Reel / TikTok**\n\n**Title:** "Stop Struggling with Canva"\n**Music:** Trending Afrobeats instrumental\n**Vibe:** Energetic, relatable, fast-paced\n\n---\n\n**[0:00-0:03] HOOK**\n*Visual: Split screen \u2014 frustrated person staring at Canva on left, stunning flyer on right*\n*Text overlay: "POV: You spent 3 hours making a flyer that still looks basic 😩"*\n*Voiceover: "Stop struggling with Canva at 2 AM."*\n\n**[0:03-0:08] PROBLEM**\n*Visual: Quick cuts of messy amateur designs*\n*Voiceover: "You know your business deserves professional branding. But you're not a designer, and hiring one seems complicated."*\n\n**[0:08-0:15] SOLUTION**\n*Visual: Smooth transition to CreatiHub website \u2014 scroll through services, show Naija templates, show before/after*\n*Text overlay: "CreatiHub \u2014 Nigeria's AI Creative Studio"*\n*Voiceover: "Enter CreatiHub. Nigeria's AI-powered creative studio. Flyers, logos, videos, voiceovers \u2014 designed by professionals who actually understand your culture."*\n\n**[0:15-0:22] PROOF**\n*Visual: Carousel of reviews + before/after showcases*\n*Text overlay: 5-star reviews scrolling*\n*Voiceover: "Join hundreds of happy business owners. Aso Ebi flyers, church programs, brand kits \u2014 we've got you. Pay in installments. Get delivery on WhatsApp."*\n\n**[0:22-0:30] CTA**\n*Visual: Logo + website URL + "First order 10% off"*\n*Voiceover: "Visit CreatiHub today. Use code CREATI10 for 10% off your first order. Your brand deserves better."*\n*Text overlay: "Link in bio 👆 | CREATI10 = 10% off"*\n\n---\n\n**📋 Production Notes:**\n\u2022 Film with phone in vertical 9:16 format\n\u2022 Use CapCut or InShot for editing (free)\n\u2022 Record voiceover yourself or use our voiceover service\n\u2022 Post at 6-8 PM Nigerian time (peak engagement)\n\u2022 Caption: "Tag a business owner who needs this 👇 #CreatiHub #NaijaDesign #FlyerDesign #SmallBusinessNigeria"\n\nWant me to create a 60-second version, or scripts for other platforms?`,
      suggestions: ['Create a 60-second video script', 'Create a flyer for our platform', 'Write social media posts', 'Create a cartoon ad concept']
    };
  }

  // Flyer copy generator (for promoting CreatiHub itself)
  if (/flyer.*copy|flyer.*for.*platform|create.*flyer|design.*flyer|flyer.*text|flyer.*content|promo.*flyer/.test(q)) {
    return {
      reply: `🎨 **Flyer Copy for CreatiHub \u2014 Ready to Design**\n\n**Option A: "Launch Your Brand" Flyer**\n\n**Headline:** LAUNCH YOUR BRAND WITH CREATIHUB\n**Sub-headline:** Nigeria's AI-Powered Creative Studio\n**Body:**\nFlyers \u2022 Logos \u2022 Videos \u2022 Voiceovers \u2022 Brand Kits\n\n**Trust signals:**\n\u2705 Naija Templates\n\u2705 Pay in Installments\n\u2705 WhatsApp Delivery\n\u2705 7 Nigerian Languages\n\n**Offer:** Starting at just $5 \u2014 First order 10% OFF\n**Promo Code:** CREATI10\n**Contact:** WhatsApp + website + Instagram\n**Color suggestion:** Purple gradient (your brand) with gold accents\n\n---\n\n**Option B: "Before & After" Flyer**\n\n**Headline:** THIS is what CreatiHub does for YOUR business\n**Visual concept:** Side-by-side amateur design \u2192 professional design\n**Body:** Don't settle for basic. Get professional design that actually converts.\n\n**Pricing:**\n🎯 Flyers from $5\n🎯 Logos from $15\n🎯 Videos from $20\n\n**CTA:** Order now at creatihub.com.ng | WhatsApp: [your number]\n\n---\n\n**Pro tip:** Use the before/after reviews from your /reviews page as the visual! Take screenshots and place them side by side. Real proof beats any marketing copy.\n\nYou can actually generate this flyer right now using your own Instant Flyer Tool at /instant-flyer! Want me to help with anything else?`,
      suggestions: ['Write social media posts', 'Create a cartoon ad concept', 'Generate a promo video script', 'Write WhatsApp broadcast messages']
    };
  }

  // Social media posts / write-ups
  if (/social.*media.*post|write.*post|instagram.*post|facebook.*post|write.*up|writeup|write-ups|caption|social.*content/.test(q)) {
    return {
      reply: `📝 **Social Media Posts \u2014 5 Ready-to-Post Captions**\n\n---\n\n**Post 1: VALUE POST (Educational)**\n*Image: Carousel \u2014 "5 Design Tips for Small Businesses"*\n\nCaption:\n5 design tips every small business owner needs to know 🧵\n\n1\ufe0f\u20e3 Less is more \u2014 one clear message beats five cluttered ones\n2\ufe0f\u20e3 Your logo should work in black AND white\n3\ufe0f\u20e3 Always design for your customer, not yourself\n4\ufe0f\u20e3 Consistent colors = instant brand recognition\n5\ufe0f\u20e3 High-quality images > stock photos that look fake\n\nWant professional designs without the headache? CreatiHub has you covered. From $5. Link in bio 🔗\n\n#SmallBusinessNigeria #DesignTips #CreatiHub #NaijaBusiness #FlyerDesign #Branding\n\n---\n\n**Post 2: SHOWCASE POST (Before/After)**\n*Image: Before/after side by side*\n\nCaption:\nSwipe to see the transformation 👉\n\nThis client came to us with a DIY flyer that wasn't getting attention. We redesigned it with proper hierarchy, brand colors, and a clear call-to-action.\n\nResult? 3x more engagement on their WhatsApp status. 📈\n\nThis is what professional design does. It's not just "making it pretty" \u2014 it's making it WORK.\n\nReady to upgrade your brand? Visit creatihub.com.ng 💜\n\n#BeforeAfter #DesignTransformation #CreatiHub #NaijaDesign #SmallBusinessTips\n\n---\n\n**Post 3: TESTIMONIAL POST (Social Proof)**\n*Image: Screenshot of customer review*\n\nCaption:\n"I needed a burial program flyer in 24 hours and CreatiHub delivered. The quality was amazing and they understood exactly what I needed. Highly recommend!" \u2b50\u2b50\u2b50\u2b50\u2b50\n\nThis is why we do what we do. Every order isn't just a transaction \u2014 it's someone's important moment.\n\nThank you for trusting CreatiHub with your special occasions 🙏\n\nNeed a design? We deliver on WhatsApp. Link in bio.\n\n#CustomerLove #CreatiHub #Testimonial #NaijaDesign #FlyerDesign\n\n---\n\n**Post 4: PROMO POST (Offer)**\n*Image: Bold promotional graphic*\n\nCaption:\n🚨 FIRST ORDER? GET 10% OFF! 🚨\n\nUse code CREATI10 at checkout\n\n\u2705 Flyers from $5\n\u2705 Logos from $15\n\u2705 Videos from $20\n\u2705 Brand-in-a-Box from $45\n\u2705 Pay in installments available\n\u2705 WhatsApp delivery\n\nYour brand deserves professional design. Don't settle for basic.\n\nLink in bio to order 👆 Offer ends soon!\n\n#CreatiHub #DesignDiscount #NaijaBusiness #SmallBusinessNigeria #BrandDesign\n\n---\n\n**Post 5: BEHIND-THE-SCENES (Connection)**\n*Image: You working / screen recording of design process*\n\nCaption:\nBehind every CreatiHub design is a real person who cares about your brand 💜\n\nNo AI shortcuts. No templates. Just genuine craft and cultural understanding.\n\nEvery flyer, every logo, every video \u2014 made with intention.\n\nThis is what sets us apart from the Fiverrs and Canvas of the world. We GET it. Because we're from here.\n\nSupport local. Choose CreatiHub. Link in bio.\n\n#BehindTheScenes #CreatiHub #NaijaDesigner #MadeInNigeria #DesignProcess\n\n---\n\n**📋 Posting Schedule:**\n\u2022 Monday: Value post (tips)\n\u2022 Wednesday: Showcase (before/after)\n\u2022 Friday: Testimonial\n\u2022 Sunday: Promo/offer\n\u2022 Random: Behind-the-scenes\n\nConsistency > perfection. Post 5x/week minimum. Want me to generate more posts or write for a specific platform?`,
      suggestions: ['Write WhatsApp broadcast messages', 'Generate a promo video script', 'Create a cartoon ad concept', 'Create a flyer for our platform']
    };
  }

  // Cartoon ad concept generator
  if (/cartoon.*ad|cartoon.*advert|animated.*ad|cartoon.*concept|character.*ad|mascot.*ad|cartoon.*video/.test(q)) {
    return {
      reply: `🎭 **Cartoon Ad Concept \u2014 "The CreatiHub Hero"**\n\n**Concept:** A relatable animated short showing a Nigerian small business owner's journey from frustration to success with CreatiHub.\n\n---\n\n**🎬 STORYBOARD (60-second cartoon ad):**\n\n**Scene 1: The Struggle (0:00-0:15)**\n*Visual: Cartoon character "Ade" (a young Nigerian entrepreneur) sitting at his desk at midnight, surrounded by crumpled paper. His phone shows a half-done flyer in Canva that looks terrible.*\n*ADE:* "I just need ONE good flyer for my restaurant opening... why is this so hard?!"\n*Ade's inner voice appears as a thought bubble: "I'm a chef, not a designer!"*\n\n**Scene 2: The Discovery (0:15-0:25)**\n*Visual: Ade's friend "Bola" video-calls him on WhatsApp. Bola is relaxed, sipping zobo, looking confident.*\n*BOLA:* "Bro, you're still doing this yourself? Use CreatiHub na!"\n*ADE:* "Creati-what?"\n*BOLA:* "CreatiHub! They design everything \u2014 flyers, logos, videos. And they understand Naija occasions. My aso ebi flyer? Them design am!"\n*A thought bubble appears over Ade: a beautiful flyer floating with sparkles \u2728*\n\n**Scene 3: The Experience (0:25-0:45)**\n*Visual: Split screen showing Ade on creatihub.com.ng \u2014 browsing Naija templates, picking a restaurant flyer template, paying in installments, getting the delivery on WhatsApp.*\n*Quick montage: Ade smiling at each step. A cartoon Nova AI mascot (sparkly star character) guides him through.*\n*NOVA MASCOT:* "Welcome to CreatiHub! Pick your template, customize, and pay in installments. Easy!"\n*Visual: The flyer transforms from template to Ade's custom restaurant flyer \u2014 "Ade's Jollof Palace \u2014 Grand Opening!"*\n\n**Scene 4: The Result (0:45-0:55)**\n*Visual: Ade's restaurant opening day \u2014 packed crowd, people taking photos of the beautiful flyers, Ade looking proud and happy.*\n*ADE:* "CreatiHub changed everything o! My flyer fine well well!"\n*Cartoon money and stars fly around Ade's head 💫💰*\n\n**Scene 5: CTA (0:55-1:00)**\n*Visual: CreatiHub logo appears with Nova mascot waving.*\n*VOICEOVER:* "CreatiHub \u2014 Nigeria's AI Creative Studio. From idea to reality. Visit creatihub.com.ng today!"\n*Text: "10% off first order \u2014 Code: CREATI10"*\n\n---\n\n**🎨 CHARACTER DESIGN GUIDE:**\n\u2022 **Ade:** Young Nigerian man, chef outfit, expressive face, relatable "everyman"\n\u2022 **Bola:** Ade's friend, confident, stylish, the "trendsetter"\n\u2022 **Nova Mascot:** A friendly star/sparkle character (matches your brand \u2726), helpful guide\n\n**🎨 VISUAL STYLE:**\n\u2022 Flat design animation (like Nigerian cartoon channels)\n\u2022 Bold, bright colors matching CreatiHub brand (purple gradient, gold accents)\n\u2022 Nigerian cultural details: ankara patterns in background, Nigerian food, Lagos scenery\n\n**🎵 AUDIO:**\n\u2022 Upbeat Afrobeats background music\n\u2022 Nigerian English voice acting (can use your voiceover service!)\n\u2022 Sound effects: phone notification, cash register, sparkle sounds\n\n**📋 HOW TO PRODUCE THIS:**\n1. **DIY (Free):** Use Canva's animation tools or FlipaClip (mobile app)\n2. **Freelancer ($50-200):** Hire an animator on Fiverr/Behance\n3. **AI Tools ($10-30):** Use tools like Animaker, Vyond, or AI animation platforms\n4. **Full Studio ($500+):** Professional Nigerian animation studio\n\n**My recommendation:** Start with option 2 \u2014 a simple 30-60 second animated ad costs $50-150 and can be used across ALL your marketing for months. The ROI is massive.\n\nWant me to create a shorter 15-second version for TikTok, or develop the character designs further?`,
      suggestions: ['Create a 15-second version', 'Generate a promo video script', 'Write social media posts', 'Create a flyer for our platform']
    };
  }

  // WhatsApp broadcast / marketing messages
  if (/whatsapp.*broadcast|whatsapp.*message|whatsapp.*marketing|broadcast.*message|whatsapp.*promo|wa.*message/.test(q)) {
    return {
      reply: `📱 **WhatsApp Broadcast Messages \u2014 Ready to Send**\n\n---\n\n**Message 1: Welcome/Introduction**\n🚀 Welcome to CreatiHub Design Tips!\n\nYou're now on the list for:\n\u2705 Weekly design tips for your business\n\u2705 Exclusive discount codes\n\u2705 Before/after design showcases\n\u2705 Free design resources\n\nWe post 2-3x/week. No spam, just value. 💜\n\nNeed a design RIGHT NOW?\nVisit creatihub.com.ng\nFirst order 10% OFF \u2014 code: CREATI10\n\nGot questions? Just reply to this message! 👇\n\n---\n\n**Message 2: Weekly Value Tip**\n💡 DESIGN TIP OF THE WEEK\n\nDid you know? Flyers with ONE clear call-to-action convert 3x better than flyers with multiple messages.\n\nBefore you design your next flyer, ask yourself:\n"What is the ONE thing I want people to do?"\n\n\u2192 Call this number?\n\u2192 Visit this website?\n\u2192 Attend this event?\n\nPick ONE. Make it bold. Make it clear.\n\nNeed help? CreatiHub designs flyers that CONVERT.\nFrom $5 \u2192 creatihub.com.ng 💜\n\n---\n\n**Message 3: Showcase/Proof**\n🎨 THIS WEEK'S TRANSFORMATION\n\nClient: Mama Nkechi Catering\nNeed: Birthday party flyer (urgent!)\n\nResult: Delivered in 18 hours.\nMama Nkechi said: "I no believe say my flyer fit fine like this! Thank you CreatiHub!" \u2b50\u2b50\u2b50\u2b50\u2b50\n\nThis is what we do. We turn your vision into reality.\nFast. Professional. WhatsApp delivery.\n\nWant yours? creatihub.com.ng\nCode CREATI10 = 10% off 🎁\n\n---\n\n**Message 4: Special Offer**\n🎁 WEEKEND SPECIAL!\n\nThis weekend only:\n\n📦 Brand-in-a-Box\n(Logo + Flyer + Business Card + Social Kit + Brand Guide)\n\nNormally $65 \u2192 THIS WEEKEND $50\n\nSave $15 on a complete brand identity!\n\nOffer ends Sunday 11:59 PM \u23f0\n\nOrder now: creatihub.com.ng\nWhatsApp us to claim: [your number]\n\n---\n\n**Message 5: Re-engagement**\n👋 Hey! It's been a minute.\n\nWe miss you at CreatiHub! 💜\n\nHere's a special welcome-back gift:\n15% OFF your next order\nCode: WELCOMEBACK\n\nValid for 7 days only.\n\nNew services available:\n🎬 Promo videos\n🎭 Cartoon ads\n🗣\ufe0f Voiceovers in 7 Naija languages\n\nVisit creatihub.com.ng to explore! 🚀\n\n---\n\n**📋 WhatsApp Strategy:**\n\u2022 Send 2-3 messages per week (don't overdo it)\n\u2022 Always include value, not just promotion\n\u2022 Best times: 10 AM and 7 PM Nigerian time\n\u2022 Encourage forwards: "Share with a business owner who needs this"\n\u2022 Use WhatsApp Business for broadcast lists (free, up to 256 contacts per list)\n\nWant me to create more messages or a specific campaign?`,
      suggestions: ['Write social media posts', 'Generate a promo video script', 'Create a cartoon ad concept', 'Create a flyer for our platform']
    };
  }

  // Email campaign copy
  if (/email.*campaign|email.*copy|newsletter|email.*marketing|email.*template/.test(q)) {
    return {
      reply: `📧 **Email Campaign \u2014 3 Ready-to-Send Templates**\n\n---\n\n**Email 1: Welcome Sequence (sent after signup)**\nSubject: Welcome to CreatiHub! Here's 10% off your first design 🎁\n\nHi [Name],\n\nWelcome to CreatiHub! We're thrilled to have you. 💜\n\nYou've just joined Nigeria's AI-powered creative studio \u2014 where professional design meets cultural understanding.\n\nHere's what you can do now:\n\u2705 Browse 20+ design services\n\u2705 Explore Naija templates for any occasion\n\u2705 Use our FREE business name generator\n\u2705 Order with installment payments\n\u2705 Get delivery right on WhatsApp\n\nTo celebrate your joining, here's 10% off your first order:\n\n🎁 Code: CREATI10\n\n👉 Visit creatihub.com.ng to start\n\nQuestions? Just reply to this email. We're here to help.\n\n\u2014 The CreatiHub Team\n\n---\n\n**Email 2: Weekly Newsletter**\nSubject: This week at CreatiHub: Design tips + new templates + special offer\n\nHi [Name],\n\nHere's your weekly dose of design inspiration! 🎨\n\n📐 DESIGN TIP OF THE WEEK\n"The best designs don't just look good \u2014 they make people ACT."\nBefore your next flyer, ask: what's the ONE action I want?\n\n🆕 NEW TEMPLATES ADDED\n\u2022 Wedding IV (Yoruba traditional)\n\u2022 Church Crusade poster\n\u2022 Restaurant menu flyer\nBrowse all at creatihub.com.ng/naija-templates\n\n\u2b50 CUSTOMER SPOTLIGHT\n"This week we designed a brand kit for [Business Name] \u2014 logo, flyer, and social posts. Their Instagram engagement went up 40%!"\n\n🎁 THIS WEEK'S OFFER\nRefer a friend \u2192 you BOTH get $2 credit.\nShare your referral code in your dashboard!\n\nHave a great week,\n\u2014 The CreatiHub Team\n\n---\n\n**Email 3: Win-back (inactive customers)**\nSubject: We miss you! Here's 15% off to come back 💜\n\nHi [Name],\n\nIt's been a while since your last CreatiHub order, and we miss working with you!\n\nA lot has changed since you last visited:\n🎬 NEW: Promo video production\n🎭 NEW: Cartoon ad creation\n🗣\ufe0f NEW: Voiceovers in 7 Nigerian languages\n📦 NEW: Brand-in-a-Box complete bundle\n\nTo welcome you back, here's 15% off your next order:\n\n🎁 Code: WELCOMEBACK15\n\nValid for 7 days. Don't miss out!\n\n👉 Visit creatihub.com.ng\n\nCan't wait to create something amazing with you again.\n\n\u2014 The CreatiHub Team\n\n---\n\n**📋 Email Strategy:**\n\u2022 Use a free tool: Mailchimp (free up to 500 contacts) or Brevo (free up to 300/day)\n\u2022 Welcome email: send immediately after signup\n\u2022 Newsletter: weekly (same day/time each week)\n\u2022 Win-back: send after 30 days of inactivity\n\u2022 Always include one clear CTA per email\n\nWant me to write more email templates or a specific campaign?`,
      suggestions: ['Write social media posts', 'Write WhatsApp broadcast messages', 'Generate a promo video script', 'Create a cartoon ad concept']
    };
  }

  // Ad copy (Facebook/Instagram ads)
  if (/ad.*copy|facebook.*ad|instagram.*ad|paid.*ad|advert.*copy|ad.*text/.test(q)) {
    return {
      reply: `📊 **Paid Ad Copy \u2014 Facebook & Instagram**\n\n---\n\n**Ad 1: Problem/Solution (Best for cold audience)**\n[HEADLINE] Stop Wasting Hours on Canva\n[PRIMARY TEXT]\nYou're a business owner, not a designer.\n\nYet you spend hours trying to make flyers that still look... amateur.\n\nMeanwhile, your competitors are posting professional designs and getting all the customers.\n\nIt doesn't have to be this way.\n\nCreatiHub designs professional flyers, logos, and videos FOR YOU.\n\u2705 Starting at just $5\n\u2705 Naija templates for every occasion\n\u2705 Pay in installments\n\u2705 Delivery on WhatsApp\n\nStop struggling. Start selling.\n👉 Visit creatihub.com.ng\n[CTA] Shop Now\n[DESCRIPTION] Professional design from $5. First order 10% off.\n\n---\n\n**Ad 2: Social Proof (Best for warm audience)**\n[HEADLINE] See why 500+ businesses choose CreatiHub\n[PRIMARY TEXT]\n"I needed a burial program flyer in 24 hours. CreatiHub delivered something beautiful. They understood exactly what I needed." \u2014 Mama T., Lagos \u2b50\u2b50\u2b50\u2b50\u2b50\n\nThis is what we do every day at CreatiHub.\n\nWe're not just designers. We're Nigerians who understand your culture, your occasions, and your needs.\n\nAso Ebi flyers? Done.\nChurch programs? Done.\nRestaurant branding? Done.\nBusiness logos? Done.\n\nJoin hundreds of happy customers.\n👉 creatihub.com.ng\n[CTA] Learn More\n[DESCRIPTION] Nigeria's AI creative studio. 5-star rated.\n\n---\n\n**Ad 3: Offer/Promotion (Best for retargeting)**\n[HEADLINE] 10% OFF Your First Design 🎁\n[PRIMARY TEXT]\nYou've been thinking about it.\nNow's the time.\n\nFor a limited time, get 10% off your first CreatiHub order.\n\nCode: CREATI10\n\nWhat can you get?\n🎨 Flyers from $5 (now $4.50)\n\u270f\ufe0f Logos from $15 (now $13.50)\n🎬 Videos from $20 (now $18)\n📦 Brand-in-a-Box from $45 (now $40.50)\n\nProfessional design. Nigerian understanding. WhatsApp delivery.\n\nDon't wait \u2014 this won't last forever.\n👉 creatihub.com.ng\n[CTA] Get Offer\n[DESCRIPTION] 10% off first order. Code: CREATI10. Limited time.\n\n---\n\n**📋 Ad Targeting Suggestions (Facebook/Instagram):**\n\u2022 Location: Nigeria (or specific cities: Lagos, Abuja, Port Harcourt)\n\u2022 Age: 22-55\n\u2022 Interests: Small business, entrepreneurship, Canva, graphic design, event planning, catering, church activities\n\u2022 Behaviors: Small business owners, engaged shoppers\n\u2022 Budget: Start with $5-10/day, test for 7 days, then scale winners\n\n**Pro tip:** Run Ad 1 to cold audience, Ad 2 to website visitors, Ad 3 to people who visited but didn't order. This "funnel" approach maximizes ROI.\n\nWant me to create video ad scripts or more ad variations?`,
      suggestions: ['Generate a promo video script', 'Create a cartoon ad concept', 'Write social media posts', 'Write WhatsApp broadcast messages']
    };
  }

  // Help / what can you do
  if (/help|what can you|what.*do|menu|options|capabilities|commands/.test(q)) {
    return {
      reply: `🧠 **I'm your AI Co-Founder \u2014 here's everything I can do:**\n\n📊 **BUSINESS ANALYTICS (live data):**\n\u2022 "Business summary" \u2014 revenue, orders, customers\n\u2022 "Show pending orders" \u2014 orders needing action\n\u2022 "Best selling services" \u2014 ranked by orders\n\u2022 "Revenue breakdown" \u2014 earnings per service\n\n🚀 **STRATEGY & GROWTH (co-founder mode):**\n\u2022 "Let's discuss growth" \u2014 enter co-founder brainstorming mode\n\u2022 "How do we get more traffic?" \u2014 customer acquisition strategy\n\u2022 "What features should we add next?" \u2014 product roadmap\n\u2022 "How can we make more money?" \u2014 monetization ideas\n\u2022 "How do we scale?" \u2014 growth phases plan\n\u2022 "How do we stand out?" \u2014 competitive analysis\n\n🎨 **CONTENT GENERATION (I write it for you):**\n\u2022 "Generate a promo video script" \u2014 30-second Reel/TikTok script\n\u2022 "Create a flyer for our platform" \u2014 flyer copy + layout\n\u2022 "Write social media posts" \u2014 5 ready-to-post captions\n\u2022 "Create a cartoon ad concept" \u2014 animated ad storyboard\n\u2022 "Write WhatsApp broadcast messages" \u2014 5 broadcast templates\n\u2022 "Write email campaigns" \u2014 3 email templates\n\u2022 "Write ad copy" \u2014 Facebook/Instagram ad variations\n\nJust tell me what you need, or pick a suggestion below!`,
      suggestions: ['Let\'s discuss growth', 'Generate a promo video script', 'Write social media posts', 'Create a cartoon ad concept', 'How do we get more traffic?', 'Business summary']
    };
  }

  // Fallback \u2014 much more helpful now
  return {
    reply: `I'm your AI Co-Founder \u2014 I can help with strategy AND generate marketing content for you.\n\nTry one of these:\n\n📊 **Analytics:** "Business summary" or "Revenue breakdown"\n🚀 **Strategy:** "Let's discuss growth" or "How do we get more traffic?"\n🎨 **Content:** "Generate a promo video script" or "Write social media posts"\n\nOr type "help" to see everything I can do.`,
    suggestions: ['Help', 'Let\'s discuss growth', 'Generate a promo video script', 'Write social media posts', 'Business summary']
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
  // Co-founder & strategy actions
  if (/co.?founder|brainstorm|let.s discuss|exchange.*idea/.test(q)) action = 'Entered Co-Founder brainstorming mode';
  else if (/traffic|get.*more.*customer|acquire|marketing|promote|advertise|how.*get.*user|how.*get.*order/.test(q)) action = 'Generated customer acquisition strategy';
  else if (/what.*add|what.*build|what.*feature|new feature|roadmap/.test(q)) action = 'Generated feature roadmap ideas';
  else if (/monetiz|more.*revenue|more.*money|make.*money|earn more|income stream/.test(q)) action = 'Generated monetization ideas';
  else if (/scale|expand|take.*to.*next.*level/.test(q)) action = 'Generated scaling strategy';
  else if (/competitor|stand out|differentiat|fiverr|canva/.test(q)) action = 'Generated competitive analysis';
  // Content generation actions
  else if (/video.*script|promo.*video|reel.*script|tiktok.*script|generate.*video/.test(q)) action = 'Generated a promo video script';
  else if (/flyer.*copy|create.*flyer|design.*flyer|flyer.*content|promo.*flyer/.test(q)) action = 'Generated platform flyer copy';
  else if (/social.*media.*post|write.*post|instagram.*post|caption|social.*content/.test(q)) action = 'Generated social media posts';
  else if (/cartoon.*ad|animated.*ad|cartoon.*concept|mascot.*ad/.test(q)) action = 'Generated a cartoon ad concept';
  else if (/whatsapp.*broadcast|whatsapp.*message|broadcast.*message/.test(q)) action = 'Generated WhatsApp broadcast messages';
  else if (/email.*campaign|newsletter|email.*marketing|email.*template/.test(q)) action = 'Generated email campaign templates';
  else if (/ad.*copy|facebook.*ad|instagram.*ad|paid.*ad|advert.*copy/.test(q)) action = 'Generated paid ad copy';
  // Analytics actions (existing)
  else if (/summary|overview|how is business|report|stats|today|performance/.test(q)) action = 'Generated a business summary';
  else if (/pending|new order|unprocessed|queue/.test(q)) action = 'Listed pending orders';
  else if (/best|top|selling|popular|most/.test(q)) action = 'Ranked best-selling services';
  else if (/revenue|money|income|earn|profit|sales/.test(q)) action = 'Broke down revenue by service';
  else if (/insight|how.*grow|grow.*insight|improve|recommend|suggest|advice|strategy/.test(q)) action = 'Generated AI growth insights';
  else if (/customer|user|client|who/.test(q)) action = 'Listed registered customers';
  else if (/help|what can you|menu|options|capabilities/.test(q)) action = 'Showed co-founder help menu';
  else if (/^(hi|hello|hey)\b/.test(q)) action = 'Greeted the admin';
  logAiActivity('analytics', who, action, `${who} asked Nova Admin: "${String(message).slice(0, 100)}"`);
  return result;
}

module.exports = { userAssistant, adminAssistant, convertPrice, CURRENCY_RATES, CURRENCY_SYMBOLS, filterMessage, safeUserAssistant, safeAdminAssistant };
