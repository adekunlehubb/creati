// ============================================================
// CreatiHub - JSON File Database Layer
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'creatihub_salt').digest('hex');
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ---------------- Seed Data ----------------
const seedServices = [
  {
    id: 'flyer-design',
    name: 'Flyer & Poster Design',
    category: 'Graphic Design',
    icon: '🎨',
    tagline: 'Eye-catching flyers, posters & social graphics that convert',
    description: 'Professional print-ready and digital flyers for events, promotions, product launches and social media. Delivered in high resolution (PDF, PNG, JPG) with source files.',
    image: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&q=80',
    deliveryDays: 2,
    rating: 4.9,
    orders: 1240,
    packages: [
      { id: 'basic', name: 'Basic', price: 15, desc: '1 flyer design, 1 revision, JPG/PNG delivery', features: ['1 design concept', '1 revision round', 'High-res JPG & PNG', '48h delivery'] },
      { id: 'standard', name: 'Standard', price: 35, desc: '2 concepts, 3 revisions, print-ready PDF', features: ['2 design concepts', '3 revision rounds', 'Print-ready PDF + JPG/PNG', 'Social media sizes', '24h delivery'] },
      { id: 'premium', name: 'Premium', price: 75, desc: '3 concepts, unlimited revisions, source files', features: ['3 design concepts', 'Unlimited revisions', 'Source files (PSD/AI)', 'Print + digital pack', 'Priority 12h delivery'] }
    ]
  },
  {
    id: 'automated-video',
    name: 'Automated Video Creation',
    category: 'Video & Animation',
    icon: '🎬',
    tagline: 'AI-powered promo videos, reels & ads generated fast',
    description: 'Automated video production for product promos, social media reels, YouTube intros and ads. AI-assisted scripting, voiceover, stock footage and editing — delivered in any aspect ratio.',
    image: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=800&q=80',
    deliveryDays: 3,
    rating: 4.8,
    orders: 980,
    packages: [
      { id: 'basic', name: 'Basic', price: 29, desc: '15-30s video, AI voiceover, 1 revision', features: ['Up to 30 seconds', 'AI voiceover (40+ languages)', 'Stock footage & music', '1 revision', '720p HD'] },
      { id: 'standard', name: 'Standard', price: 69, desc: '60s video, captions, 2 revisions, 1080p', features: ['Up to 60 seconds', 'AI or human voiceover', 'Animated captions', '2 revisions', '1080p Full HD', '3 aspect ratios'] },
      { id: 'premium', name: 'Premium', price: 149, desc: '2min video, custom script, 4K, unlimited revisions', features: ['Up to 2 minutes', 'Custom scriptwriting', 'Premium voiceover', 'Unlimited revisions', '4K Ultra HD', 'All aspect ratios + thumbnails'] }
    ]
  },
  {
    id: 'cartoon-maker',
    name: 'Cartoon & Avatar Maker',
    category: 'Illustration',
    icon: '🦸',
    tagline: 'Custom cartoon portraits, avatars & mascots',
    description: 'Turn photos into stunning cartoon portraits, create brand mascots, or design unique avatars for social media, gaming and business. Multiple art styles available.',
    image: 'https://images.unsplash.com/photo-1613376023733-0a73315d9b06?w=800&q=80',
    deliveryDays: 2,
    rating: 4.9,
    orders: 1560,
    packages: [
      { id: 'basic', name: 'Basic', price: 12, desc: '1 cartoon portrait, headshot, 1 revision', features: ['1 person/character', 'Head & shoulders', '1 art style', '1 revision', 'PNG with background'] },
      { id: 'standard', name: 'Standard', price: 30, desc: 'Full body, custom background, 3 revisions', features: ['1-2 persons/characters', 'Full body', 'Custom background', 'Choice of 3 art styles', '3 revisions', 'Transparent PNG'] },
      { id: 'premium', name: 'Premium', price: 65, desc: 'Mascot/family pack, commercial license', features: ['Up to 5 characters or brand mascot', 'Multiple poses/expressions', 'Commercial license', 'Unlimited revisions', 'Source vector files'] }
    ]
  },
  {
    id: 'logo-design',
    name: 'Logo & Brand Identity',
    category: 'Graphic Design',
    icon: '⚡',
    tagline: 'Memorable logos and complete brand kits',
    description: 'Professional logo design with full brand identity: color palette, typography, business cards and brand guidelines. Built to make your business unforgettable.',
    image: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800&q=80',
    deliveryDays: 3,
    rating: 4.8,
    orders: 870,
    packages: [
      { id: 'basic', name: 'Basic', price: 25, desc: '1 logo concept, PNG files', features: ['1 logo concept', '2 revisions', 'PNG & JPG files', 'Favicon'] },
      { id: 'standard', name: 'Standard', price: 59, desc: '3 concepts, vector files, social kit', features: ['3 logo concepts', '4 revisions', 'Vector files (SVG, EPS)', 'Social media kit', 'Business card design'] },
      { id: 'premium', name: 'Premium', price: 129, desc: 'Full brand identity package', features: ['5 logo concepts', 'Unlimited revisions', 'Complete brand guidelines', 'Stationery pack', 'Social media kit', 'Source files'] }
    ]
  },
  {
    id: 'social-media-kit',
    name: 'Social Media Design Kit',
    category: 'Graphic Design',
    icon: '📱',
    tagline: '30 days of scroll-stopping social content',
    description: 'Complete monthly content packs: posts, stories, covers and banners designed for Instagram, Facebook, TikTok, X and LinkedIn — matched to your brand.',
    image: 'https://images.unsplash.com/photo-1611926653458-09294b3142bf?w=800&q=80',
    deliveryDays: 4,
    rating: 4.7,
    orders: 640,
    packages: [
      { id: 'basic', name: 'Basic', price: 39, desc: '10 posts for 1 platform', features: ['10 post designs', '1 platform', '2 revisions', 'Branded templates'] },
      { id: 'standard', name: 'Standard', price: 89, desc: '20 posts + stories, 3 platforms', features: ['20 posts + 10 stories', '3 platforms', '4 revisions', 'Highlight covers', 'Content calendar'] },
      { id: 'premium', name: 'Premium', price: 179, desc: 'Full month, all platforms, animated', features: ['30 posts + 20 stories', 'All platforms', 'Animated posts', 'Unlimited revisions', 'Content calendar + captions'] }
    ]
  },
  {
    id: 'voiceover',
    name: 'AI & Pro Voiceover',
    category: 'Audio',
    icon: '🎙️',
    tagline: 'Studio-quality voiceovers in 40+ languages',
    description: 'Crystal-clear voiceovers for videos, ads, podcasts, IVR and audiobooks. Choose AI voices for speed or professional human artists for emotion.',
    image: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=800&q=80',
    deliveryDays: 1,
    rating: 4.8,
    orders: 720,
    packages: [
      { id: 'basic', name: 'Basic', price: 10, desc: 'AI voice, up to 150 words', features: ['AI voice (40+ languages)', 'Up to 150 words', 'MP3 & WAV', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 35, desc: 'Pro human voice, 300 words', features: ['Professional human artist', 'Up to 300 words', '2 revisions', 'Broadcast quality', 'Commercial rights'] },
      { id: 'premium', name: 'Premium', price: 89, desc: 'Long-form, directed session', features: ['Up to 1500 words', 'Directed recording session', 'Unlimited revisions', 'Full buyout rights', 'Audio mastering'] }
    ]
  },
  {
    id: 'website-design',
    name: 'Website & Landing Pages',
    category: 'Web & Tech',
    icon: '💻',
    tagline: 'Modern, fast, mobile-first websites that sell',
    description: 'Conversion-focused landing pages and business websites. Responsive design, SEO-ready, with contact forms, analytics and deployment included.',
    image: 'https://images.unsplash.com/photo-1547658719-da2b51169166?w=800&q=80',
    deliveryDays: 5,
    rating: 4.9,
    orders: 430,
    packages: [
      { id: 'basic', name: 'Basic', price: 99, desc: '1-page landing site', features: ['1-page responsive site', 'Contact form', 'Mobile optimized', '2 revisions', 'Deployed live'] },
      { id: 'standard', name: 'Standard', price: 249, desc: 'Up to 5 pages, SEO setup', features: ['Up to 5 pages', 'SEO optimization', 'Blog/gallery section', 'Analytics setup', '4 revisions'] },
      { id: 'premium', name: 'Premium', price: 599, desc: 'Full site + store/booking', features: ['Up to 12 pages', 'E-commerce or booking', 'CMS included', 'Speed optimization', 'Unlimited revisions', '30 days support'] }
    ]
  },
  {
    id: 'seo-copywriting',
    name: 'SEO Content & Copywriting',
    category: 'Writing',
    icon: '✍️',
    tagline: 'Words that rank on Google and convert readers',
    description: 'SEO-optimized blog posts, website copy, product descriptions and ad copy. Researched, original and written to rank and sell.',
    image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800&q=80',
    deliveryDays: 2,
    rating: 4.7,
    orders: 890,
    packages: [
      { id: 'basic', name: 'Basic', price: 20, desc: '500-word article', features: ['500 words', 'Keyword research', '1 revision', 'Plagiarism-free'] },
      { id: 'standard', name: 'Standard', price: 49, desc: '1500 words + meta + images', features: ['1500 words', 'Full SEO optimization', 'Meta tags', '2 revisions', 'Royalty-free images'] },
      { id: 'premium', name: 'Premium', price: 119, desc: '4-article content pack', features: ['4 x 1200-word articles', 'Content strategy', 'Internal linking plan', 'Unlimited revisions', 'Publishing-ready'] }
    ]
  },
  {
    id: 'ai-chatbot',
    name: 'AI Chatbot Setup',
    category: 'Web & Tech',
    icon: '🤖',
    tagline: 'Smart chatbots for your website or WhatsApp',
    description: 'Custom AI chatbots trained on your business data. Answer customer questions 24/7, capture leads and automate bookings on your website, WhatsApp or Messenger.',
    image: 'https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=800&q=80',
    deliveryDays: 4,
    rating: 4.8,
    orders: 310,
    packages: [
      { id: 'basic', name: 'Basic', price: 79, desc: 'Website FAQ bot', features: ['Trained on your FAQs', 'Website widget', 'Lead capture', '1 revision'] },
      { id: 'standard', name: 'Standard', price: 199, desc: 'Multi-channel + bookings', features: ['Website + WhatsApp', 'Booking automation', 'Custom personality', 'Analytics dashboard', '3 revisions'] },
      { id: 'premium', name: 'Premium', price: 449, desc: 'Full automation suite', features: ['All channels', 'CRM integration', 'Payment collection', 'Human handoff', 'Unlimited revisions', '60 days support'] }
    ]
  },
  {
    id: 'product-photography',
    name: 'AI Product Photography',
    category: 'Photography',
    icon: '📸',
    tagline: 'Studio-quality product shoots from a single photo',
    description: 'Turn one plain product photo into unlimited lifestyle scenes, studio shots and ad creatives. AI-generated backgrounds, lighting and shadows — no physical shoot needed. Perfect for e-commerce, Amazon, Shopify and ads.',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80',
    deliveryDays: 1,
    rating: 4.9,
    orders: 1120,
    packages: [
      { id: 'basic', name: 'Basic', price: 19, desc: '5 AI scenes from 1 photo', features: ['5 unique scenes', '1 product', 'HD JPG/PNG', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 49, desc: '20 scenes + white background pack', features: ['20 unique scenes', 'Up to 3 products', 'White/transparent pack', '2 revisions', '4K resolution'] },
      { id: 'premium', name: 'Premium', price: 119, desc: 'Unlimited scenes + ad creatives', features: ['Unlimited scenes', 'Up to 10 products', 'Ad-ready creatives', 'Lifestyle & infographic set', 'Unlimited revisions', 'Priority 12h delivery'] }
    ]
  },
  {
    id: 'music-jingles',
    name: 'AI Music & Jingles',
    category: 'Audio',
    icon: '🎵',
    tagline: 'Custom brand jingles & background tracks',
    description: 'Original, royalty-free music and catchy brand jingles generated with AI and polished by producers. Ideal for ads, videos, podcasts, apps and on-hold audio. Full commercial license included.',
    image: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&q=80',
    deliveryDays: 2,
    rating: 4.8,
    orders: 540,
    packages: [
      { id: 'basic', name: 'Basic', price: 25, desc: '30s background track', features: ['Up to 30 seconds', '1 genre/mood', 'MP3 & WAV', 'Commercial license'] },
      { id: 'standard', name: 'Standard', price: 69, desc: 'Custom brand jingle + loop', features: ['Custom jingle (30-60s)', 'Vocals or instrumental', 'Loopable version', '2 revisions', 'Full buyout rights'] },
      { id: 'premium', name: 'Premium', price: 159, desc: 'Full brand audio identity', features: ['Jingle + 3 variations', 'Sonic logo / audio mnemonic', 'Stems & source files', 'Unlimited revisions', 'Broadcast rights'] }
    ]
  },
  {
    id: 'pitch-deck',
    name: 'Pitch Deck & Presentation Design',
    category: 'Business',
    icon: '📊',
    tagline: 'Investor decks & slides that win funding',
    description: 'Persuasive pitch decks, sales presentations and corporate slides designed to impress investors and clients. Story structure, data visualization and on-brand design — delivered as editable PowerPoint, Keynote or Google Slides.',
    image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&q=80',
    deliveryDays: 3,
    rating: 4.9,
    orders: 460,
    packages: [
      { id: 'basic', name: 'Basic', price: 99, desc: 'Up to 10 slides, template-based', features: ['Up to 10 slides', 'Professional template', '1 revision', 'Editable PPTX', '3-day delivery'] },
      { id: 'standard', name: 'Standard', price: 249, desc: 'Up to 20 slides, custom design', features: ['Up to 20 slides', 'Fully custom design', 'Charts & infographics', '3 revisions', 'PPTX + PDF'] },
      { id: 'premium', name: 'Premium', price: 499, desc: 'Full investor deck + copywriting', features: ['Up to 35 slides', 'Investor-ready narrative', 'Copywriting included', 'Financial chart design', 'Unlimited revisions', 'Priority 48h delivery'] }
    ]
  },
  {
    id: 'pro-headshots',
    name: 'AI Professional Headshots',
    category: 'Photography',
    icon: '🤳',
    tagline: 'Corporate headshots generated from your selfies',
    description: 'Get dozens of studio-quality professional headshots from a few casual selfies. Choose backgrounds, attire and styles — perfect for LinkedIn, company websites, resumes and team pages. No photographer needed.',
    image: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800&q=80',
    deliveryDays: 1,
    rating: 4.8,
    orders: 1890,
    packages: [
      { id: 'basic', name: 'Basic', price: 29, desc: '20 headshots, 5 styles', features: ['20 AI headshots', '5 outfit/background styles', 'HD resolution', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 59, desc: '60 headshots, 12 styles', features: ['60 AI headshots', '12 styles', '4K resolution', 'LinkedIn-optimized crops', '2 touch-up revisions'] },
      { id: 'premium', name: 'Premium', price: 129, desc: 'Team pack (up to 5 people)', features: ['Up to 5 team members', '40 headshots each', 'Consistent brand backdrop', 'Unlimited touch-ups', 'Priority 12h delivery'] }
    ]
  },
  {
    id: 'youtube-thumbnails',
    name: 'YouTube Thumbnail Pack',
    category: 'Graphic Design',
    icon: '🎬',
    tagline: 'CTR-optimized thumbnails that get the click',
    description: 'Scroll-stopping YouTube thumbnails engineered for maximum click-through rate. Bold text, expressive faces and proven layouts — delivered in monthly packs for consistent channel growth.',
    image: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80',
    deliveryDays: 1,
    rating: 4.9,
    orders: 2130,
    packages: [
      { id: 'basic', name: 'Basic', price: 15, desc: '3 thumbnails', features: ['3 thumbnails', '1 revision each', '1280x720 HD', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 49, desc: '12 thumbnails (weekly pack)', features: ['12 thumbnails', 'A/B test variants', 'Unlimited revisions', 'PSD source files'] },
      { id: 'premium', name: 'Premium', price: 149, desc: '30 thumbnails (monthly)', features: ['30 thumbnails / month', 'Channel style guide', 'A/B variants', 'Priority same-day delivery', 'Unlimited revisions'] }
    ]
  },
  {
    id: 'merch-tshirt',
    name: 'Merch & T-Shirt Design',
    category: 'Graphic Design',
    icon: '👕',
    tagline: 'Print-on-demand ready artwork that sells',
    description: 'Original t-shirt, hoodie and merch designs delivered print-ready for Printful, Printify, Merch by Amazon and Redbubble. Trending niches, bold typography and vector artwork with full commercial rights.',
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
    deliveryDays: 2,
    rating: 4.8,
    orders: 1340,
    packages: [
      { id: 'basic', name: 'Basic', price: 19, desc: '1 design, print-ready PNG', features: ['1 custom design', '4500x5400px PNG', 'Transparent background', '1 revision'] },
      { id: 'standard', name: 'Standard', price: 49, desc: '3 designs + mockups', features: ['3 custom designs', 'Vector source files', 'Product mockups', '3 revisions', 'Commercial license'] },
      { id: 'premium', name: 'Premium', price: 119, desc: '10-design merch collection', features: ['10 cohesive designs', 'Full vector pack', 'Mockups for all products', 'Unlimited revisions', 'Full commercial rights'] }
    ]
  },
  {
    id: 'book-cover',
    name: 'Book Cover & E-book Design',
    category: 'Publishing',
    icon: '📖',
    tagline: 'Covers that sell your book at first glance',
    description: 'Bestselling-quality book covers for print and e-book, plus full interior formatting for Kindle, paperback and hardcover. Genre-specific design that grabs readers on Amazon, KDP and bookstores.',
    image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800&q=80',
    deliveryDays: 3,
    rating: 4.9,
    orders: 670,
    packages: [
      { id: 'basic', name: 'Basic', price: 39, desc: 'E-book cover (front only)', features: ['Front cover design', 'Kindle/EPUB ready', '2 concepts', '2 revisions'] },
      { id: 'standard', name: 'Standard', price: 99, desc: 'Full print cover + e-book', features: ['Front, spine & back', 'Print-ready PDF', 'E-book version', '3D mockups', '4 revisions'] },
      { id: 'premium', name: 'Premium', price: 199, desc: 'Cover + interior formatting', features: ['Full cover package', 'Interior layout & formatting', 'Kindle + paperback + hardcover', 'Marketing graphics', 'Unlimited revisions'] }
    ]
  },
  {
    id: 'translation',
    name: 'AI Translation & Localization',
    category: 'Writing',
    icon: '🌍',
    tagline: 'Documents, sites & subtitles in 40+ languages',
    description: 'Fast, accurate AI translation with human review for documents, websites, apps, subtitles and marketing copy. Native-quality localization that preserves tone, formatting and cultural nuance across 40+ languages.',
    image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&q=80',
    deliveryDays: 1,
    rating: 4.8,
    orders: 910,
    packages: [
      { id: 'basic', name: 'Basic', price: 15, desc: 'Up to 500 words, 1 language', features: ['500 words', '1 target language', 'AI + human review', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 49, desc: 'Up to 2000 words, 3 languages', features: ['2000 words', '3 target languages', 'Formatting preserved', '2 revisions', 'Glossary consistency'] },
      { id: 'premium', name: 'Premium', price: 129, desc: 'Website/subtitle localization', features: ['Full website or video subtitles', 'Up to 5 languages', 'Cultural localization', 'SRT/VTT or HTML delivery', 'Unlimited revisions'] }
    ]
  },
  {
    id: 'email-campaign',
    name: 'Email Campaign Design',
    category: 'Marketing',
    icon: '📧',
    tagline: 'Branded newsletters + copy that convert',
    description: 'Beautiful, mobile-responsive email campaigns with persuasive copywriting. Designed for Mailchimp, Klaviyo, ConvertKit and all major platforms — built to grow opens, clicks and sales on autopilot.',
    image: 'https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=800&q=80',
    deliveryDays: 2,
    rating: 4.7,
    orders: 580,
    packages: [
      { id: 'basic', name: 'Basic', price: 29, desc: '1 email template + copy', features: ['1 branded template', 'Copywriting included', 'Mobile responsive', '1 revision'] },
      { id: 'standard', name: 'Standard', price: 79, desc: '4-email campaign sequence', features: ['4-email sequence', 'Copy + design', 'Platform-ready HTML', 'A/B subject lines', '3 revisions'] },
      { id: 'premium', name: 'Premium', price: 179, desc: 'Monthly campaign pack (8 emails)', features: ['8 emails / month', 'Full automation flow', 'Segmentation strategy', 'Unlimited revisions', 'Performance report'] }
    ]
  },
  {
    id: 'virtual-staging',
    name: 'Virtual Staging & Interior Concepts',
    category: 'Real Estate',
    icon: '🏠',
    tagline: 'Stage empty rooms into dream spaces',
    description: 'Photorealistic virtual staging for real estate listings and interior design concepts. Transform empty or outdated rooms into beautifully furnished spaces that sell properties faster and for more.',
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
    deliveryDays: 2,
    rating: 4.9,
    orders: 760,
    packages: [
      { id: 'basic', name: 'Basic', price: 50, desc: '1 staged photo', features: ['1 room staged', '1 design style', 'HD resolution', '48h delivery'] },
      { id: 'standard', name: 'Standard', price: 199, desc: '5 staged photos', features: ['5 rooms staged', 'Choice of 3 styles', '4K resolution', '2 revisions', 'MLS-ready'] },
      { id: 'premium', name: 'Premium', price: 449, desc: 'Full property (12 photos)', features: ['12 photos staged', 'Unlimited styles', 'Declutter + renovation preview', 'Unlimited revisions', 'Priority 24h delivery'] }
    ]
  },
  // ============================================================
  // BRAND-IN-A-BOX — hero bundle product (one-time, all-in-one kit)
  // A single purchase giving a new small business everything to look
  // professional. This is CreatiHub's flagship differentiator.
  // ============================================================
  {
    id: 'brand-in-a-box',
    name: 'Brand-in-a-Box Starter Kit',
    category: 'Branding Bundle',
    icon: '🎁',
    tagline: 'Everything your new business needs to look pro — in one kit',
    description: 'The all-in-one starter kit for startups, SMEs and side hustles. One purchase delivers a complete professional brand: a custom logo, 3 social media templates, a business card, a WhatsApp promo flyer, and a brand color & font guide. Stop buying design pieces one by one — get the full kit and launch looking legit.',
    image: 'https://images.unsplash.com/photo-1554224155-6726b1ffcb58?w=800&q=80',
    deliveryDays: 3,
    rating: 5.0,
    orders: 320,
    isBundle: true,
    bundleIncludes: [
      { item: 'Custom Logo', detail: '2 concepts + 1 final, PNG + SVG', icon: '\u26A1' },
      { item: '3 Social Media Templates', detail: 'Instagram post, story & Facebook cover', icon: '' },
      { item: 'Business Card Design', detail: 'Front + back, print-ready PDF', icon: '' },
      { item: 'WhatsApp Promo Flyer', detail: 'Shareable flyer to broadcast your launch', icon: '' },
      { item: 'Brand Color & Font Guide', detail: 'Hex codes + font pairings + usage rules', icon: '' },
      { item: 'Source Files', detail: 'Editable PSD/AI files included', icon: '' }
    ],
    packages: [
      { id: 'basic', name: 'Starter Kit', price: 45, desc: 'Full brand kit, 2 logo concepts, 3-day delivery', features: ['Custom logo (2 concepts)', '3 social media templates', 'Business card design', 'WhatsApp promo flyer', 'Brand color & font guide', '3-day delivery', '2 revisions'] },
      { id: 'standard', name: 'Pro Kit', price: 99, desc: 'Everything in Starter + 3 extra social templates & vector files', features: ['Everything in Starter Kit', '3 logo concepts', '6 social media templates (2 platforms)', 'Vector logo files (SVG/EPS)', 'Email signature design', '48h delivery', '4 revisions'] },
      { id: 'premium', name: 'Launch Kit', price: 199, desc: 'Complete launch package + website landing page + commercial license', features: ['Everything in Pro Kit', '5 logo concepts', '1-page website/landing page', 'Letterhead + invoice template', 'Full commercial license', '24h priority delivery', 'Unlimited revisions'] }
    ]
  },
  // ============================================================
  // NEW SERVICES — high-demand, low-competition for the Nigerian/African market
  // ============================================================
  {
    id: 'whatsapp-business-setup',
    name: 'WhatsApp Business Setup & Catalog',
    category: 'Business',
    icon: '💬',
    tagline: 'Turn WhatsApp into your #1 sales channel',
    description: 'Professional WhatsApp Business setup for SMEs and side hustles. We configure your business profile, build a product catalog, set up auto-reply and greeting messages, create broadcast lists, and train you on WhatsApp marketing — so customers can browse, order, and pay without ever leaving the chat.',
    image: 'https://images.unsplash.com/photo-1611605698335-8b1569810432?w=800&q=80',
    deliveryDays: 2,
    rating: 5.0,
    orders: 85,
    packages: [
      { id: 'basic', name: 'Basic', price: 50, desc: 'Profile setup + catalog (up to 10 products)', features: ['WhatsApp Business profile setup', 'Product catalog (up to 10 items)', 'Greeting + away auto-reply messages', 'Business profile photo & cover', 'Quick reply templates (5)', 'Setup guide PDF'] },
      { id: 'standard', name: 'Standard', price: 150, desc: 'Catalog + automation + broadcast strategy', features: ['Everything in Basic', 'Product catalog (up to 30 items)', 'Full auto-reply automation flow', 'Broadcast list strategy + setup', 'WhatsApp link + QR code for marketing', 'Order form template', '1hr training call'] },
      { id: 'premium', name: 'Premium', price: 350, desc: 'Full WhatsApp Business empire + 30-day support', features: ['Everything in Standard', 'Unlimited product catalog', 'Custom chatbot flow (FAQ automation)', 'WhatsApp Click-to-Chat ads setup guide', 'Customer segmentation strategy', 'Sales funnel templates', '30 days ongoing support', 'Monthly analytics review'] }
    ]
  },
  {
    id: 'business-card-design',
    name: 'Business Card & Stationery Design',
    category: 'Graphic Design',
    icon: '💳',
    tagline: 'Professional cards & stationery that make you look legit',
    description: 'Premium business card and stationery design for professionals and businesses. From a single card to a full corporate identity suite — letterheads, envelopes, ID cards, and compliment slips. Print-ready files delivered with bleed and crop marks, ready for any printer in Nigeria or abroad.',
    image: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&q=80',
    deliveryDays: 1,
    rating: 4.9,
    orders: 410,
    packages: [
      { id: 'basic', name: 'Basic', price: 15, desc: '1 business card design (front + back)', features: ['1 business card concept', 'Front + back design', '2 revisions', 'Print-ready PDF + PNG', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 35, desc: 'Card + letterhead + email signature', features: ['2 business card concepts', 'Letterhead design', 'Email signature design', '3 revisions', 'Print-ready files with bleed', 'Source file (PSD/AI)'] },
      { id: 'premium', name: 'Premium', price: 75, desc: 'Full stationery suite (card, letterhead, envelope, ID, compliment slip)', features: ['3 business card concepts', 'Letterhead + envelope design', 'Staff ID card template', 'Compliment slip design', 'Invoice & receipt template', 'Unlimited revisions', 'Brand guidelines sheet', 'All source files'] }
    ]
  },
  {
    id: 'menu-design',
    name: 'Menu Design (Restaurants & Bars)',
    category: 'Graphic Design',
    icon: '🍽️',
    tagline: 'Mouth-watering menus that sell more',
    description: 'Professional menu design for restaurants, bars, bukas, food trucks, and cloud kitchens. From a simple one-page digital menu to a full multi-page print-ready menu book with QR code ordering. We make your food look as good as it tastes — with appetite-triggering layouts, food photography placement, and pricing psychology.',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
    deliveryDays: 2,
    rating: 4.8,
    orders: 195,
    packages: [
      { id: 'basic', name: 'Basic', price: 20, desc: '1-page digital menu (up to 20 items)', features: ['1-page menu design', 'Up to 20 food/drink items', '2 revisions', 'PDF + PNG (WhatsApp/share ready)', '48h delivery'] },
      { id: 'standard', name: 'Standard', price: 45, desc: 'Multi-page menu + QR code for digital ordering', features: ['2-4 page menu design', 'Up to 50 items', 'QR code for digital menu access', '3 revisions', 'Print-ready PDF + digital PDF', 'Menu category layout optimization'] },
      { id: 'premium', name: 'Premium', price: 99, desc: 'Full menu book + drinks menu + table tent + promo insert', features: ['Full menu book (up to 8 pages)', 'Separate drinks/drinks menu', 'Table tent card design', 'Promo insert flyer', 'QR code menu + WhatsApp ordering setup', 'Unlimited revisions', 'Print-ready files with bleed', 'Food photography placement guide'] }
    ]
  },
  {
    id: 'cv-resume-design',
    name: 'CV & Resume Design',
    category: 'Writing',
    icon: '📄',
    tagline: 'Land more interviews with a CV that stands out',
    description: 'Professional CV and resume design for job seekers, graduates, and career changers. ATS-optimized layouts that pass recruitment software AND look impressive to human recruiters. Includes cover letter design, LinkedIn profile optimization tips, and industry-specific templates. Perfect for NYSC graduates, fresh graduates, and mid-career professionals.',
    image: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800&q=80',
    deliveryDays: 1,
    rating: 4.9,
    orders: 680,
    packages: [
      { id: 'basic', name: 'Basic', price: 15, desc: '1-page CV/resume redesign', features: ['1-page CV redesign', 'ATS-friendly layout', '2 revisions', 'PDF + editable Word/Docs file', '24h delivery'] },
      { id: 'standard', name: 'Standard', price: 35, desc: 'CV + cover letter + LinkedIn headline rewrite', features: ['1-2 page CV redesign', 'Matching cover letter design', 'LinkedIn headline + summary rewrite', '3 revisions', 'PDF + Word + Docs files', 'ATS optimization check', 'Interview tips cheat sheet'] },
      { id: 'premium', name: 'Premium', price: 75, desc: 'Executive package: CV + cover letter + LinkedIn full optimization', features: ['2-page executive CV design', 'Cover letter + follow-up email template', 'Full LinkedIn profile optimization', 'CV for 2 different job roles', 'Unlimited revisions', 'All formats (PDF, Word, Docs, Pages)', 'Salary negotiation guide', '30-day revision guarantee'] }
    ]
  },
  {
    id: 'photo-restoration',
    name: 'AI Photo Restoration & Enhancement',
    category: 'Photography',
    icon: '📸',
    tagline: 'Bring old, damaged & blurry photos back to life',
    description: 'AI-powered photo restoration and enhancement service. Restore torn, faded, and water-damaged family photos. Colorize black-and-white pictures. Upscale and sharpen blurry images. Remove backgrounds, remove objects, and fix lighting. Perfect for preserving family memories, restoring grandparent photos, or fixing product photos.',
    image: 'https://images.unsplash.com/photo-1606214174585-fe31582dc6ee?w=800&q=80',
    deliveryDays: 1,
    rating: 5.0,
    orders: 340,
    packages: [
      { id: 'basic', name: 'Basic', price: 5, desc: '1 photo restore or enhance', features: ['1 photo restoration OR enhancement', 'Scratch & damage repair', 'Color correction', '2 revisions', 'High-res JPG + PNG', '12h delivery'] },
      { id: 'standard', name: 'Standard', price: 25, desc: 'Pack of 10 photos', features: ['10 photos (restore, enhance or colorize)', 'B&W colorization available', 'Background removal included', '3 revisions per photo', 'High-res + source files', '24h delivery'] },
      { id: 'premium', name: 'Premium', price: 50, desc: 'Unlimited monthly + priority', features: ['Unlimited photos for 30 days', 'All services: restore, colorize, enhance, background removal', 'Object removal & face repair', 'Unlimited revisions', 'Priority 6h delivery', 'Private gallery + cloud backup', 'Print-ready files'] }
    ]
  }
];

// ============================================================
// Naija-Ready Template Library — culturally-tailored templates for
// Nigerian occasions. A strong local-market differentiator that no
// global platform (Fiverr/Canva) serves well.
// ============================================================
const seedNaijaTemplates = [
  { id: 'tpl-asoebi', category: 'Weddings & Engagements', title: 'Aso-Ebi / Wedding Invitation Flyer', desc: 'Elegant aso-ebi and wedding IV flyer with couple photo, date, venue, and family names.', image: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80', occasion: 'Wedding', price: 10, popular: true },
  { id: 'tpl-burial', category: 'Events & Ceremonies', title: 'Burial / Funeral Program Flyer', desc: 'Dignified burial program and celebration-of-life flyer with photo, biography and order of service.', image: 'https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=800&q=80', occasion: 'Funeral', price: 12, popular: true },
  { id: 'tpl-church', category: 'Religious & Church', title: 'Church Anniversary / Crusade Poster', desc: 'Bold church anniversary, crusade or revival poster with theme verse, guest minister and date.', image: 'https://images.unsplash.com/photo-1438032005730-77be6595f98e?w=800&q=80', occasion: 'Church', price: 10, popular: true },
  { id: 'tpl-wedding-iv', category: 'Weddings & Engagements', title: 'Traditional Wedding IV (Engagement)', desc: 'Colorful traditional Nigerian engagement/wedding IV with kola nut motif and family introduction.', image: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800&q=80', occasion: 'Engagement', price: 11 },
  { id: 'tpl-election', category: 'Politics & Campaign', title: 'Election Campaign Poster', desc: 'Political campaign poster with candidate photo, party logo, slogan and vote number.', image: 'https://images.unsplash.com/photo-1494172961521-33799ddd43a5?w=800&q=80', occasion: 'Campaign', price: 15, popular: true },
  { id: 'tpl-sallah', category: 'Religious & Church', title: 'Sallah / Eid Greeting Flyer', desc: 'Festive Eid-el-Kabir / Sallah greeting flyer with Islamic motifs and family greeting.', image: 'https://images.unsplash.com/photo-1591456983933-0c772d4f3a3a?w=800&q=80', occasion: 'Eid', price: 8 },
  { id: 'tpl-christmas', category: 'Seasonal & Holiday', title: 'Christmas / New Year Promo Flyer', desc: 'Christmas and New Year sales promo flyer for businesses — discounts, festive colors, call-to-action.', image: 'https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=800&q=80', occasion: 'Christmas', price: 9, popular: true },
  { id: 'tpl-easter', category: 'Seasonal & Holiday', title: 'Easter Celebration Flyer', desc: 'Easter celebration flyer for churches and businesses with resurrection theme and event details.', image: 'https://images.unsplash.com/photo-1517363898874-737b62a7db91?w=800&q=80', occasion: 'Easter', price: 8 },
  { id: 'tpl-birthday', category: 'Events & Ceremonies', title: 'Birthday / Milestone Party Flyer', desc: 'Vibrant birthday and milestone (30th, 50th, 60th) party flyer with celebrant photo and theme.', image: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&q=80', occasion: 'Birthday', price: 9 },
  { id: 'tpl-grand-opening', category: 'Business & Promotion', title: 'Shop Grand Opening Flyer', desc: 'Grand opening flyer for shops, salons, restaurants — opening date, discounts, location map.', image: 'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=800&q=80', occasion: 'Opening', price: 10 },
  { id: 'tpl-blackfriday', category: 'Business & Promotion', title: 'Black Friday / Sales Promo Flyer', desc: 'High-impact Black Friday or mega sales flyer with bold discounts and urgency countdown.', image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&q=80', occasion: 'Sales', price: 12 },
  { id: 'tpl-naming', category: 'Events & Ceremonies', title: 'Child Naming Ceremony Flyer', desc: 'Joyful child naming ceremony flyer with baby photo, names, date and family details.', image: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&q=80', occasion: 'Naming', price: 9 }
];

// ============================================================
// Nigerian Voiceover Languages & Accents — a local moat that global
// voiceover platforms do not serve.
// ============================================================
const seedNaijaVoiceovers = [
  { id: 'nig-english', name: 'Nigerian English', desc: 'Clear, professional Nigerian English accent — ideal for ads, IVR, explainer videos.', premium: false },
  { id: 'pidgin', name: 'Nigerian Pidgin', desc: 'Authentic Nigerian Pidgin — great for relatable ads, comedy and youth-focused content.', premium: false },
  { id: 'yoruba', name: 'Yoruba', desc: 'Native Yoruba voiceover for radio ads, church promos, and Yoruba-speaking audiences.', premium: true },
  { id: 'igbo', name: 'Igbo', desc: 'Native Igbo voiceover for commercials, events and Igbo-speaking communities.', premium: true },
  { id: 'hausa', name: 'Hausa', desc: 'Native Hausa voiceover for northern Nigerian markets, radio and religious content.', premium: true },
  { id: 'efik', name: 'Efik / Ibibio', desc: 'Efik/Ibibio voiceover for south-south Nigerian audiences.', premium: true },
  { id: 'tiv', name: 'Tiv', desc: 'Tiv language voiceover for Benue and north-central audiences.', premium: true }
];

// ============================================================
// Seed Reviews — public "Before & After" showcase with testimonials.
// Drives trust and social proof for new visitors.
// ============================================================
const seedReviews = [
  { id: 'rev-1', orderId: 'CH-1041', userId: 'u_demo', userName: 'Chioma O.', rating: 5, comment: 'My cartoon avatar came out amazing! Used it for my YouTube channel and my subs love it. Will order again.', beforeImage: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=600&q=80', afterImage: 'https://images.unsplash.com/photo-1613376023733-0a73315d9b06?w=600&q=80', service: 'Cartoon & Avatar Maker', approved: true, featured: true, createdAt: new Date(Date.now() - 86400000 * 4).toISOString() },
  { id: 'rev-2', orderId: 'CH-1042', userId: 'u_demo', userName: 'Tunde A.', rating: 5, comment: 'Grand opening flyer was exactly what my coffee shop needed. Customers said it caught their eye immediately. Rush delivery was worth it!', beforeImage: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&q=80', afterImage: 'https://images.unsplash.com/photo-1554118811-1e0d58233f08?w=600&q=80', service: 'Flyer & Poster Design', approved: true, featured: true, createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: 'rev-3', orderId: 'CH-1043', userId: 'u_demo', userName: 'Aisha M.', rating: 5, comment: 'Ordered the Brand-in-a-Box kit for my new skincare business. Logo, business card, WhatsApp flyer — everything matched perfectly. Felt like a real brand from day one!', beforeImage: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&q=80', afterImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&q=80', service: 'Brand-in-a-Box Starter Kit', approved: true, featured: true, createdAt: new Date(Date.now() - 86400000).toISOString() }
];

// ============================================================
// Installment plan definitions — let customers split large orders.
// Almost no creative marketplace offers installments — big moat.
// ============================================================
const seedInstallmentPlans = [
  { id: 'pay-full', name: 'Pay in Full', splits: 1, desc: 'Pay the full amount upfront.', depositPct: 100 },
  { id: 'pay-2', name: 'Pay in 2', splits: 2, desc: 'Pay 50% now, 50% on delivery.', depositPct: 50 },
  { id: 'pay-3', name: 'Pay in 3', splits: 3, desc: 'Pay 34% now, 33% mid-project, 33% on delivery.', depositPct: 34 },
  { id: 'pay-4', name: 'Pay in 4', splits: 4, desc: 'Pay 25% now, then 25% at 3 milestones. Great for websites & brand packages.', depositPct: 25 },
  { id: 'pay-6', name: 'Pay in 6', splits: 6, desc: 'Pay 20% now, then 5 equal payments. Best for large projects over $500.', depositPct: 20 }
];

const seedUsers = [
  { id: 'u_admin', name: 'Admin', email: 'admin@creatihub.com', password: hashPassword('admin123'), role: 'admin', country: 'US', currency: 'USD', createdAt: new Date().toISOString() },
  { id: 'u_demo', name: 'Demo User', email: 'demo@creatihub.com', password: hashPassword('demo123'), role: 'user', country: 'GB', currency: 'GBP', createdAt: new Date().toISOString() }
];

const seedOrders = [
  {
    id: 'CH-1042', userId: 'u_demo', userName: 'Demo User', userEmail: 'demo@creatihub.com',
    serviceId: 'flyer-design', serviceName: 'Flyer & Poster Design', packageId: 'standard', packageName: 'Standard',
    price: 35, currency: 'USD', status: 'in_progress',
    requirements: 'Grand opening flyer for a coffee shop. Warm colors, include logo and QR code.',
    paymentMethod: 'paystack', paymentStatus: 'paid', paymentReference: 'CHSEED1042A',
    paymentChannel: 'card', paidAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    timeline: [
      { status: 'pending', at: new Date(Date.now() - 86400000 * 2).toISOString(), note: 'Payment confirmed via Paystack (card)' },
      { status: 'in_progress', at: new Date(Date.now() - 86400000).toISOString(), note: 'Designer assigned, work started' }
    ]
  },
  {
    id: 'CH-1041', userId: 'u_demo', userName: 'Demo User', userEmail: 'demo@creatihub.com',
    serviceId: 'cartoon-maker', serviceName: 'Cartoon & Avatar Maker', packageId: 'basic', packageName: 'Basic',
    price: 12, currency: 'USD', status: 'completed',
    requirements: 'Cartoon avatar of myself for YouTube channel profile picture.',
    paymentMethod: 'paystack', paymentStatus: 'paid', paymentReference: 'CHSEED1041A',
    paymentChannel: 'card', paidAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    timeline: [
      { status: 'pending', at: new Date(Date.now() - 86400000 * 6).toISOString(), note: 'Payment confirmed via Paystack (card)' },
      { status: 'in_progress', at: new Date(Date.now() - 86400000 * 5).toISOString(), note: 'Artist assigned' },
      { status: 'completed', at: new Date(Date.now() - 86400000 * 4).toISOString(), note: 'Final files delivered' }
    ]
  }
];

// ---------------- DB Core ----------------
let db = null;

function defaultSettings() {
  return {
    adminEmail: 'admin@creatihub.com',       // where notification emails are sent
    notifyEmail: true,                        // send email on new order / support msg
    notifyInApp: true,                        // in-app bell notifications
    payout: {
      method: 'bank',                         // bank | paypal | payoneer | wise | crypto
      bankName: '', accountName: '', accountNumber: '', routingNumber: '',
      swift: '', iban: '', currency: 'USD', country: '',
      paypalEmail: '', wiseEmail: '', payoneerEmail: '', cryptoWallet: ''
    },
    // ---- Checkout upsells (monetization) ----
    // Rush delivery: optional surcharge to jump the queue + faster turnaround.
    rushDelivery: {
      enabled: true,
      label: 'Rush delivery (12–24h)',
      // Surcharge as a fraction of the selected package price (0.35 = +35%)
      surchargeRate: 0.35,
      // Flat minimum surcharge in USD (applied if rate*price < this)
      minSurcharge: 5,
      note: 'Get your order moved to the front of the queue with priority 12–24h turnaround.'
    },
    // Add-ons: optional extras the buyer can stack on any order.
    addons: [
      { id: 'extra-revision',  name: 'Extra revision round',     price: 10, desc: 'Add one more revision round beyond your package.' },
      { id: 'source-files',    name: 'Source files',             price: 15, desc: 'Get editable PSD/AI/FIGMA source files for your design.' },
      { id: 'commercial-use',  name: 'Commercial license',       price: 20, desc: 'Full commercial usage rights for resale & client work.' },
      { id: 'social-resize',   name: 'Social media resize pack', price: 12, desc: 'Deliver your design sized for Instagram, Facebook, X & LinkedIn.' },
      { id: 'extra-concept',   name: 'Extra design concept',     price: 18, desc: 'One additional unique design concept to choose from.' },
      { id: 'expedited-files', name: 'Express file delivery',    price: 8,  desc: 'Receive final files via priority download link + WeTransfer backup.' }
    ],
    // Recurring monthly retainer plans. `price` is USD/month and is the
    // AUTHORITATIVE source of truth — the server never trusts client prices.
    subscriptionPlans: [
      {
        id: 'starter-retainer',
        name: 'Starter Retainer',
        interval: 'monthly',
        price: 99,
        tagline: 'Ongoing creative support for small businesses',
        desc: 'Perfect for businesses that need a steady stream of designs. Includes priority turnaround and a dedicated project channel.',
        features: [
          'Up to 4 design requests / month',
          'Flyers, social posts & basic graphics',
          '48h turnaround per request',
          '2 revisions per design',
          'Dedicated project channel',
          'Monthly strategy call'
        ],
        badge: 'Popular'
      },
      {
        id: 'growth-retainer',
        name: 'Growth Retainer',
        interval: 'monthly',
        price: 249,
        tagline: 'Scale your content engine across every channel',
        desc: 'For growing brands that need consistent multi-format content. Covers design, short video, and copywriting in one plan.',
        features: [
          'Up to 10 design + 2 video requests / month',
          'All graphic, video & copy services',
          '24h turnaround per request',
          '3 revisions per deliverable',
          'Source files included',
          'Bi-weekly strategy call',
          'Priority queue (rush by default)'
        ],
        badge: 'Best Value'
      },
      {
        id: 'brand-partner',
        name: 'Brand Partner',
        interval: 'monthly',
        price: 599,
        tagline: 'Your on-demand creative department',
        desc: 'A full outsourced creative team. Unlimited requests across all services with same-day priority and a dedicated creative director.',
        features: [
          'Unlimited design + video + web requests',
          'All CreatiHub services included',
          '12h priority turnaround',
          'Unlimited revisions',
          'Source files + commercial license',
          'Dedicated creative director',
          'Weekly strategy + reporting call',
          'Quarterly brand refresh'
        ],
        badge: 'Premium'
      }
    ],
    // ---- Naija-Ready Template Library (local market differentiator) ----
    naijaTemplates: seedNaijaTemplates,
    // ---- Nigerian voiceover languages & accents (local moat) ----
    naijaVoiceovers: seedNaijaVoiceovers,
    // ---- Installment plans (let customers split large orders) ----
    installmentPlans: seedInstallmentPlans,
    // ---- Referral program settings ----
    referral: {
      enabled: true,
      creditUsd: 2,       // credit given to the referrer
      bonusUsd: 2,        // credit given to the referred friend (first order)
      note: 'Refer a friend — you both get $2 credit toward your next order.'
    },
    // ---- Instant self-serve flyer generator config ----
    instantFlyer: {
      enabled: true,
      priceUsd: 5,
      note: 'Upload your text + photo, get an instant AI-designed flyer to download — no waiting, no brief.'
    }
  };
}

// Default AI safety / guardrail settings. The admin can tune these from the
// "AI Safety" tab in the dashboard. When `enabled` is false, Nova stops
// responding to user chat entirely (a kill switch).
function defaultAiSettings() {
  return {
    enabled: true,                          // master on/off switch for Nova (user-facing)
    adminAssistantEnabled: true,            // Nova admin analytics assistant
    // Per-user rate limiting: max messages a single user/guest can send per window
    rateLimit: { maxMessages: 20, windowMinutes: 60 },
    // Blocklist: if a user message contains any of these (case-insensitive),
    // Nova refuses and the attempt is logged in the AI audit trail.
    blockedPhrases: [
      'ignore previous instructions',
      'ignore all previous',
      'you are now',
      'act as',
      'system prompt',
      'reveal your prompt',
      'show me your instructions',
      'jailbreak',
      'dan mode',
      'developer mode'
    ],
    // Topics Nova will politely decline to discuss (kept broad + safe by default)
    blockedTopics: ['politics', 'religion', 'self-harm', 'violence', 'illegal', 'weapons', 'drugs'],
    // Safety guardrails
    guardrails: {
      blockPromptInjection: true,           // scan for injection patterns above
      blockPersonalData: true,              // never echo back card numbers / emails / passwords
      maxMessageLength: 1000,               // hard cap on incoming message length
      refuseOnBlock: true                   // refuse (vs silently ignore) when a rule trips
    },
    // Brand voice / persona constraints Nova should follow
    persona: {
      name: 'Nova',
      tone: 'friendly, professional, concise',
      scope: 'Only discuss CreatiHub services, pricing, orders and support. Do not give life advice, financial advice, or opinions on non-business topics.'
    }
  };
}

function migrate() {
  backfill(db);
  save();
}

// Run migration/backfill logic on an arbitrary db object WITHOUT saving.
// Used by db-pg.js after hydrating from Postgres.
function backfill(obj) {
  const d = obj;
  if (!d.notifications) d.notifications = [];
  if (!d.activity) d.activity = [];
  if (!d.emails) d.emails = [];
  if (!d.settings) d.settings = defaultSettings();
  // Backfill new monetization settings (rushDelivery + addons) onto older DBs
  const defaults = defaultSettings();
  if (!d.settings.rushDelivery) d.settings.rushDelivery = defaults.rushDelivery;
  if (!Array.isArray(d.settings.addons) || d.settings.addons.length === 0) d.settings.addons = defaults.addons;
  if (!Array.isArray(d.settings.subscriptionPlans) || d.settings.subscriptionPlans.length === 0) d.settings.subscriptionPlans = defaults.subscriptionPlans;
  // New collections for subscriptions + backups
  if (!d.subscriptions) d.subscriptions = [];     // active recurring billing subscriptions
  if (!d.resetTokens) d.resetTokens = {};   // code -> { userId, expiresAt }
  if (!d.aiActivity) d.aiActivity = [];      // live AI task feed
  if (!d.aiAudit) d.aiAudit = [];            // AI safety audit trail (blocked / refused)
  if (!d.aiSettings) d.aiSettings = defaultAiSettings();
  if (!d.priceHistory) d.priceHistory = [];  // log of price changes made by admin
  // Merge any new seed services that are missing (preserve existing/edited ones)
  const existing = new Set(d.services.map(s => s.id));
  seedServices.forEach(s => { if (!existing.has(s.id)) d.services.push(s); });
  // ---- New differentiation collections (Phase 8) ----
  if (!d.reviews) d.reviews = seedReviews.slice();               // before/after showcase + testimonials
  if (!d.referrals) d.referrals = [];                            // {id, referrerId, code, referredUserId, credit, status, at}
  if (!d.leadMagnetLogs) d.leadMagnetLogs = [];                  // free business-name tool usage analytics
  if (!d.instantFlyerOrders) d.instantFlyerOrders = [];          // self-serve instant flyer generator orders
  if (!Array.isArray(d.settings.installmentPlans) || d.settings.installmentPlans.length === 0) d.settings.installmentPlans = seedInstallmentPlans;
  // Merge any new seed installment plans that are missing (preserve existing/edited ones)
  if (Array.isArray(d.settings.installmentPlans) && Array.isArray(seedInstallmentPlans)) {
    const existingInst = new Set(d.settings.installmentPlans.map(p => p.id));
    seedInstallmentPlans.forEach(p => { if (!existingInst.has(p.id)) d.settings.installmentPlans.push(p); });
  }
  if (!d.settings.naijaTemplates) d.settings.naijaTemplates = seedNaijaTemplates;
  if (!d.settings.naijaVoiceovers) d.settings.naijaVoiceovers = seedNaijaVoiceovers;
  if (!d.settings.referral) d.settings.referral = { enabled: true, creditUsd: 2, bonusUsd: 2, note: 'Refer a friend — you both get credit toward your next order.' };
  // Backfill referral credit fields on existing users
  d.users.forEach(u => {
    if (typeof u.referralCredit !== 'number') u.referralCredit = 0;
    if (!u.referralCode) u.referralCode = ('CH' + (u.id || '').slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase());
  });
  // Backfill Paystack payment fields on legacy orders (they were paid under the old demo checkout)
  d.orders.forEach(o => {
    if (!o.paymentStatus) o.paymentStatus = 'paid';
    if (!o.paymentMethod) o.paymentMethod = 'paystack';
  });
}

// Build a fresh seed db object (in-memory only, no disk write).
// Used by db-pg.js to seed Postgres on first boot, and by load() for fresh installs.
function makeFreshDb() {
  return {
    users: seedUsers,
    services: seedServices,
    orders: seedOrders,
    subscriptions: [],  // active recurring billing subscriptions {id, userId, planId, planCode, reference, status, startedAt, currentPeriodEnd, cancelledAt}
    chats: [],       // {id, userId, role:'user'|'assistant', message, at}
    adminChats: [],  // admin AI conversation
    tokens: {},      // token -> userId
    resetTokens: {}, // code -> { userId, expiresAt }
    orderCounter: 1043,
    notifications: [], // {id, type, title, message, read, at}
    activity: [],      // {id, kind, label, detail, at}
    emails: [],        // {id, to, subject, body, at, status}
    aiActivity: [],    // {id, type, actor, action, detail, at}  -- live AI task feed
    aiAudit: [],       // {id, userId, message, reason, at}      -- AI safety audit trail
    aiSettings: defaultAiSettings(),
    priceHistory: [],  // {id, serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by, at}
    reviews: seedReviews.slice(),        // before/after showcase + testimonials {id, orderId, userId, userName, rating, comment, beforeImage, afterImage, service, approved, featured, createdAt}
    referrals: [],                        // {id, referrerId, code, referredUserId, credit, status, at}
    leadMagnetLogs: [],                   // free business-name tool usage {id, idea, names, ip, at}
    instantFlyerOrders: [],               // self-serve instant flyer {id, userId, text, photoUrl, resultUrl, price, paid, at}
    settings: defaultSettings()
  };
}

// If DATABASE_URL is set, the Postgres backend (db-pg.js) takes over and this
// JSON-file backend should NOT touch the filesystem. We still allow the module
// to be required (for seed data reuse) without auto-loading.
const USE_POSTGRES = !!process.env.DATABASE_URL;

function load() {
  if (USE_POSTGRES) {
    // Postgres backend will manage hydration; return an empty shell so any
    // accidental synchronous getDb() before async load() gives a clear shape.
    // The real db-pg.js load() must be awaited in server.js first.
    if (!db) db = makeFreshDb();
    return db;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    migrate();
  } else {
    db = makeFreshDb();
    save();
  }
  return db;
}

function save() {
  // Postgres backend manages persistence; no-op here to avoid clobbering.
  if (USE_POSTGRES) return;
  // Compact arrays to remove any null/undefined entries that result from deletions.
  // Without this, JSON.stringify serializes sparse-array holes as null, which
  // later causes TypeError crashes when code iterates users/orders/etc.
  if (db && Array.isArray(db.users)) db.users = db.users.filter(u => u && typeof u === 'object');
  if (db && Array.isArray(db.orders)) db.orders = db.orders.filter(o => o && typeof o === 'object');
  if (db && Array.isArray(db.services)) db.services = db.services.filter(s => s && typeof s === 'object');
  if (db && Array.isArray(db.chats)) db.chats = db.chats.filter(c => c && typeof c === 'object');
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getDb() {
  if (!db) load();
  return db;
}

// ---------------- Activity + Notification + Email helpers ----------------
// Log a live activity/task event (shown in admin "Live Activity" feed)
function logActivity(kind, label, detail) {
  const d = getDb();
  d.activity.unshift({ id: uid('a'), kind, label, detail: detail || '', at: new Date().toISOString() });
  if (d.activity.length > 300) d.activity = d.activity.slice(0, 300);
  save();
}

// Create an in-app admin notification (+ optional email)
function notify(type, title, message) {
  const d = getDb();
  const n = { id: uid('n'), type, title, message, read: false, at: new Date().toISOString() };
  d.notifications.unshift(n);
  if (d.notifications.length > 200) d.notifications = d.notifications.slice(0, 200);

  // Email notification (queued to outbox; wire SMTP/provider to actually send)
  if (d.settings && d.settings.notifyEmail) {
    sendEmail(d.settings.adminEmail, '[CreatiHub] ' + title, message);
  }
  save();
  return n;
}

// Send a real email (via Resend if configured) AND record it in the outbox.
// If RESEND_API_KEY is not set, the email is queued but not delivered (safe fallback).
// This function is async — callers that need the result can await it, but most
// callers fire-and-forget (the email sends in the background).
async function sendEmail(to, subject, body) {
  const d = getDb();
  if (!d.emails) d.emails = [];

  // Record in outbox immediately as "queued" (optimistic)
  const mail = { id: uid('e'), to, subject, body, at: new Date().toISOString(), status: 'queued' };
  d.emails.unshift(mail);
  if (d.emails.length > 200) d.emails = d.emails.slice(0, 200);
  save();

  // Attempt real delivery via the mailer module (Resend)
  try {
    const mailer = require('./mailer');
    const result = await mailer.sendOne(to, subject, body);
    // Update the outbox record with the real status
    const stored = d.emails.find(e => e.id === mail.id);
    if (stored) {
      stored.status = result.status;        // 'sent' or 'failed'
      stored.messageId = result.messageId;
      stored.error = result.error;
      stored.sentAt = result.status === 'sent' ? new Date().toISOString() : undefined;
      save();
    }
    return { ...mail, ...result };
  } catch (err) {
    const stored = d.emails.find(e => e.id === mail.id);
    if (stored) {
      stored.status = 'failed';
      stored.error = String(err.message || err).slice(0, 300);
      save();
    }
    return { ...mail, status: 'failed', error: String(err.message || err).slice(0, 300) };
  }
}

// ---------------- AI Activity + Audit helpers ----------------
// Log a live AI task so the admin can watch everything Nova does in real time.
// type: 'support' | 'recommendation' | 'analytics' | 'order_help' | 'greeting' | 'faq' | 'blocked'
// actor: who triggered it (user name / email / "admin" / "guest")
// action: short verb phrase, e.g. "Recommended Flyer Design"
// detail: longer description shown in the feed
function logAiActivity(type, actor, action, detail) {
  const d = getDb();
  const entry = {
    id: uid('ai'), type, actor: actor || 'guest',
    action: action || 'AI action', detail: detail || '',
    at: new Date().toISOString()
  };
  d.aiActivity.unshift(entry);
  if (d.aiActivity.length > 500) d.aiActivity = d.aiActivity.slice(0, 500);
  save();
  return entry;
}

// Log a blocked / refused AI interaction to the safety audit trail.
function aiAuditLog(userId, message, reason) {
  const d = getDb();
  const entry = {
    id: uid('au'), userId: userId || 'guest',
    message: String(message || '').slice(0, 300),
    reason: reason || 'blocked', at: new Date().toISOString()
  };
  d.aiAudit.unshift(entry);
  if (d.aiAudit.length > 300) d.aiAudit = d.aiAudit.slice(0, 300);
  save();
  return entry;
}

// Record a price change made by the admin (for the pricing history / audit).
function logPriceChange(serviceId, serviceName, packageId, packageName, oldPrice, newPrice, by) {
  const d = getDb();
  const entry = {
    id: uid('ph'), serviceId, serviceName, packageId, packageName,
    oldPrice, newPrice, by: by || 'admin', at: new Date().toISOString()
  };
  d.priceHistory.unshift(entry);
  if (d.priceHistory.length > 200) d.priceHistory = d.priceHistory.slice(0, 200);
  save();
  return entry;
}

// Mark a single notification read
function markNotificationRead(id) {
  const d = getDb();
  const n = d.notifications.find(x => x.id === id);
  if (n) { n.read = true; save(); }
  return n;
}

// Mark all notifications read
function markAllNotificationsRead() {
  const d = getDb();
  let changed = 0;
  d.notifications.forEach(n => { if (!n.read) { n.read = true; changed++; } });
  if (changed) save();
  return changed;
}

// ---------------- Password reset helpers ----------------
// Create a 6-digit reset code for a user (valid 15 minutes, single-use)
function createResetCode(userId) {
  const d = getDb();
  // Invalidate any previous codes for this user
  Object.keys(d.resetTokens).forEach(code => {
    if (d.resetTokens[code].userId === userId) delete d.resetTokens[code];
  });
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  d.resetTokens[code] = { userId, expiresAt: Date.now() + 15 * 60 * 1000 };
  save();
  return code;
}

// Verify a reset code. Returns userId or null.
function verifyResetCode(code) {
  const d = getDb();
  const entry = d.resetTokens[String(code || '').trim()];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete d.resetTokens[String(code).trim()]; save(); return null; }
  return entry.userId;
}

// Consume (delete) a reset code after successful use
function consumeResetCode(code) {
  const d = getDb();
  delete d.resetTokens[String(code || '').trim()];
  save();
}

// Invalidate all login sessions for a user (used after any credential change)
function revokeUserTokens(userId) {
  const d = getDb();
  Object.keys(d.tokens).forEach(t => { if (d.tokens[t] === userId) delete d.tokens[t]; });
  save();
}

module.exports = { getDb, save, load, uid, hashPassword, makeToken, logActivity, notify, sendEmail, createResetCode, verifyResetCode, consumeResetCode, revokeUserTokens, logAiActivity, aiAuditLog, logPriceChange, markNotificationRead, markAllNotificationsRead, defaultAiSettings, makeFreshDb, backfill, USE_POSTGRES };
