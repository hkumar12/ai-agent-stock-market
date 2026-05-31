/**
 * 🤖 AI Ecosystem Signal Engine — Pro Investor Edition
 * Profile: Aggressive | Medium-term (1-3 months)
 *
 * Signal sources:
 *  1. Trump statements (Truth Social, X, news)
 *  2. NVDA / chip news
 *  3. Cloud & hyperscaler capex
 *  4. Power & energy demand
 *  5. AI policy & regulation
 *  6. Earnings calendar & whisper numbers   ← NEW
 *  7. Macro signals (Fed, CPI, jobs, VIX)   ← NEW
 *  8. Reddit sentiment (WSB, r/stocks)       ← NEW
 *  9. Unusual options activity               ← NEW
 *
 * Analysis layers:
 *  - Full article reading
 *  - Peer comparison
 *  - Market context (SPY/VIX/sector ETFs)
 *  - Supply chain ripple mapping             ← NEW
 *  - Multi-factor conviction score
 *  - Gmail + Telegram alerts
 */

const nodemailer = require("nodemailer");
const Anthropic  = require("@anthropic-ai/sdk");

// ── Config ─────────────────────────────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY,
  GMAIL_USER:           process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD:   process.env.GMAIL_APP_PASSWORD,
  ALERT_EMAIL:          process.env.ALERT_EMAIL || process.env.GMAIL_USER,
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD) || 60,
  POLL_INTERVAL_MIN:    Number(process.env.POLL_INTERVAL_MIN)    || 15,
  TELEGRAM_BOT_TOKEN:   process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS:    (process.env.TELEGRAM_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
};

const INVESTOR_PROFILE = {
  risk:    "aggressive",
  horizon: "medium-term (1–3 months)",
  style:   "high growth, comfortable with volatility, looking for asymmetric upside",
};

function validateConfig() {
  if (!CONFIG.ANTHROPIC_API_KEY) { console.error("❌ Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!CONFIG.TELEGRAM_BOT_TOKEN && !CONFIG.GMAIL_USER) {
    console.error("❌ Need TELEGRAM_BOT_TOKEN or GMAIL_USER"); process.exit(1);
  }
}

// ── Supply chain dependency map ────────────────────────────────────────────
// When a parent fires a signal, these dependents get flagged too
const SUPPLY_CHAIN_MAP = {
  NVDA: {
    suppliers:    [{ ticker:"ASML",  reason:"makes EUV machines that print NVDA chips" },
                   { ticker:"TSM",   reason:"foundry that manufactures all NVDA GPUs" },
                   { ticker:"AMAT",  reason:"chip equipment supplier to TSMC fabs" },
                   { ticker:"LRCX",  reason:"etch equipment used in NVDA chip production" },
                   { ticker:"COHR",  reason:"optical components for NVDA InfiniBand networking" }],
    customers:    [{ ticker:"MSFT",  reason:"largest Azure GPU customer, buys billions in NVDA chips" },
                   { ticker:"GOOGL", reason:"uses NVDA for Google Cloud TPU/GPU clusters" },
                   { ticker:"META",  reason:"building 350k GPU cluster for Llama training" },
                   { ticker:"AMZN",  reason:"AWS largest cloud GPU fleet globally" }],
    beneficiaries:[{ ticker:"VRT",   reason:"Vertiv makes cooling systems for NVDA GPU clusters" },
                   { ticker:"CEG",   reason:"Constellation Energy powers NVDA data centers" },
                   { ticker:"EQIX",  reason:"Equinix colocates NVDA-powered AI infrastructure" }],
  },
  MSFT: {
    suppliers:    [{ ticker:"NVDA",  reason:"GPU supplier for Azure AI" },
                   { ticker:"AMZN",  reason:"AWS competes but also partners on cloud interop" }],
    customers:    [{ ticker:"NOW",   reason:"ServiceNow deeply integrated with Azure AI" },
                   { ticker:"CRM",   reason:"Salesforce Einstein runs on Azure" }],
    beneficiaries:[{ ticker:"PLTR",  reason:"Palantir AIP runs on Azure infrastructure" }],
  },
  GOOGL: {
    suppliers:    [{ ticker:"NVDA",  reason:"GPU supplier" },
                   { ticker:"TSM",   reason:"manufactures Google TPU chips" }],
    customers:    [{ ticker:"SNAP",  reason:"Snapchat runs largely on Google Cloud" },
                   { ticker:"SPOT",  reason:"Spotify uses GCP for music ML" }],
    beneficiaries:[{ ticker:"ANET",  reason:"Arista powers Google data center networking" }],
  },
  AMD: {
    suppliers:    [{ ticker:"TSM",   reason:"sole manufacturer of AMD CPUs and GPUs" },
                   { ticker:"ASML",  reason:"EUV lithography for AMD process nodes" }],
    customers:    [{ ticker:"META",  reason:"AMD MI300X competitor to NVDA for training" },
                   { ticker:"MSFT",  reason:"Azure uses AMD CPUs in cloud servers" }],
    beneficiaries:[{ ticker:"SMCI",  reason:"SuperMicro builds AMD GPU servers" }],
  },
  TSM: {
    suppliers:    [{ ticker:"ASML",  reason:"sole supplier of EUV lithography machines" },
                   { ticker:"AMAT",  reason:"deposition and etch equipment" }],
    customers:    [{ ticker:"NVDA",  reason:"100% of NVDA chips made at TSMC" },
                   { ticker:"AMD",   reason:"all AMD chips fabbed at TSMC" },
                   { ticker:"AAPL",  reason:"iPhone chips exclusively at TSMC" }],
    beneficiaries:[],
  },
  NEE: {
    suppliers:    [{ ticker:"GE",    reason:"GE Vernova makes wind turbines for NEE" }],
    customers:    [{ ticker:"MSFT",  reason:"Microsoft signed 10yr PPA with NextEra" },
                   { ticker:"AMZN",  reason:"Amazon largest renewable energy buyer globally" }],
    beneficiaries:[{ ticker:"AWK",   reason:"American Water Works supplies water to same data center corridors" }],
  },
  EQIX: {
    suppliers:    [{ ticker:"VRT",   reason:"Vertiv supplies cooling to Equinix data centers" },
                   { ticker:"CEG",   reason:"nuclear power contracts for Equinix campuses" }],
    customers:    [{ ticker:"NVDA",  reason:"NVDA uses Equinix for edge AI deployments" }],
    beneficiaries:[{ ticker:"DLR",   reason:"Digital Realty competes/benefits from same demand" }],
  },
};

// ── Sector / layer definitions ─────────────────────────────────────────────
const LAYERS = {
  power:         { label:"Power & utilities",  emoji:"⚡", tickers:["NEE","CEG","VST","DUK","AES"],          etf:"XLU",  peers:["NEE","CEG","VST"] },
  water:         { label:"Water & cooling",    emoji:"💧", tickers:["AWK","WTRG","VRT","SMCI"],              etf:"PHO",  peers:["AWK","VRT","SMCI"] },
  datacenter:    { label:"Data center REITs",  emoji:"🏢", tickers:["EQIX","DLR","IRM","AMT"],              etf:"XLRE", peers:["EQIX","DLR","IRM"] },
  chips:         { label:"Chips & semis",      emoji:"🔬", tickers:["NVDA","AMD","AVGO","AMAT","ASML","TSM"],etf:"SOXX", peers:["NVDA","AMD","AVGO"] },
  networking:    { label:"Networking & fiber", emoji:"🌐", tickers:["CSCO","ANET","LITE","CIEN"],            etf:"IGN",  peers:["CSCO","ANET","CIEN"] },
  cloud:         { label:"Cloud & data",       emoji:"☁️", tickers:["AMZN","MSFT","GOOGL","SNOW","MDB","NET","DDOG"], etf:"WCLD", peers:["AMZN","MSFT","GOOGL"] },
  aimodels:      { label:"AI models",          emoji:"🤖", tickers:["MSFT","GOOGL","META","PLTR","AI"],      etf:"AIQ",  peers:["MSFT","GOOGL","META"] },
  applications:  { label:"AI software",        emoji:"💻", tickers:["NOW","PLTR","PATH","DDOG","ZS","CRWD"], etf:"IGV",  peers:["NOW","PLTR","CRWD"] },
  energy:        { label:"Energy & oil",       emoji:"⛽", tickers:["XOM","CVX","OXY","COP"],               etf:"XLE",  peers:["XOM","CVX","OXY"] },
  defense:       { label:"Defense",            emoji:"🛡️", tickers:["LMT","RTX","NOC","GD"],               etf:"ITA",  peers:["LMT","RTX","NOC"] },
  manufacturing: { label:"Manufacturing",      emoji:"🏭", tickers:["CAT","DE","NUE","STLD"],               etf:"XLI",  peers:["CAT","DE","NUE"] },
  crypto:        { label:"Crypto",             emoji:"₿",  tickers:["COIN","MSTR","IBIT"],                 etf:"BITO", peers:["COIN","MSTR","IBIT"] },
  macro:         { label:"Macro / rates",      emoji:"📊", tickers:["TLT","GLD","DXY","SPY","QQQ"],        etf:"SPY",  peers:["SPY","QQQ","TLT"] },
};

const SIGNAL_KW = {
  bullish: {
    power:         ["power purchase","data center power","electricity demand","nuclear","clean energy deal","grid expansion","gigawatt","energy contract"],
    water:         ["data center cooling","liquid cooling","thermal management","cooling infrastructure","vertiv"],
    datacenter:    ["data center","colocation","hyperscale lease","new campus","capacity expansion","new facility"],
    chips:         ["gpu","chip","semiconductor","nvidia","ai accelerator","h100","b200","blackwell","wafer","foundry","ai chip","inference","training","beats estimates","raised guidance","record revenue"],
    networking:    ["400g","800g","optical","fiber","interconnect","infiniband","spectrum-x","network upgrade"],
    cloud:         ["cloud revenue","aws","azure","google cloud","cloud ai","snowflake","data warehouse","cloud contract","beats","raised"],
    aimodels:      ["gpt","gemini","llama","claude","foundation model","openai","anthropic","ai partnership","copilot","ai agent"],
    applications:  ["enterprise ai","ai adoption","ai workflow","ai contract","digital transformation","ai platform"],
    energy:        ["drill","oil","lng","energy independence","pipeline","fracking","natural gas"],
    defense:       ["military","nato","defense spending","pentagon","strong military","weapons"],
    manufacturing: ["tariffs","made in america","reshoring","buy american","steel tariffs"],
    crypto:        ["bitcoin","crypto","blockchain","pro-crypto","strategic reserve","digital currency"],
    macro:         ["rate cut","fed pivot","dovish","strong jobs","soft landing","inflation cooling","gdp beat"],
  },
  bearish: {
    chips:         ["chip export ban","semiconductor restriction","export control","china chip ban","chip tariff","misses estimates","lowered guidance"],
    cloud:         ["cloud spending cut","cloud churn","cloud outage","misses","lowered"],
    aimodels:      ["ai regulation","ai ban","ai moratorium","ai safety law"],
    applications:  ["enterprise spending cut","saas slowdown","it budget cut"],
    energy:        ["green new deal","climate regulation","ev mandate"],
    manufacturing: ["tariff retaliation","trade war"],
    crypto:        ["crypto ban","crypto regulation","sec crypto"],
    macro:         ["rate hike","hawkish","inflation surge","recession","gdp miss","jobs miss","fed tightening","stagflation"],
  },
};

function scoreStatement(text) {
  const lower = text.toLowerCase();
  const signals = {};
  Object.entries(LAYERS).forEach(([layer]) => {
    let score = 0;
    (SIGNAL_KW.bullish[layer] || []).forEach(kw => { if (lower.includes(kw)) score += 2; });
    (SIGNAL_KW.bearish[layer]  || []).forEach(kw => { if (lower.includes(kw)) score -= 2; });
    if (score !== 0) signals[layer] = { direction: score > 0 ? "BUY" : "SELL", strength: Math.min(Math.abs(score)*20,100), score };
  });
  const bull    = Object.values(signals).filter(s => s.direction==="BUY").length;
  const bear    = Object.values(signals).filter(s => s.direction==="SELL").length;
  const urgency = ["record","historic","beats","misses","raises","lowers","billions","trillion","massive","emergency","surprise","unexpected","shock"]
    .filter(w => lower.includes(w)).length;
  const confidence = Math.min((Math.max(bull,bear)*16) + urgency*5, 95);
  return { signals, sentiment: bull>bear?"bullish":bear>bull?"bearish":"neutral", confidence, bull, bear };
}

// ── Supply chain ripple finder ─────────────────────────────────────────────
function findSupplyChainRipple(signals) {
  const ripples = [];
  const triggeredTickers = Object.entries(signals)
    .filter(([,d]) => d.direction === "BUY")
    .flatMap(([s]) => LAYERS[s]?.tickers || []);

  for (const ticker of triggeredTickers) {
    const map = SUPPLY_CHAIN_MAP[ticker];
    if (!map) continue;
    const all = [
      ...(map.suppliers     || []).map(d => ({ ...d, relationship: "supplier to" })),
      ...(map.customers     || []).map(d => ({ ...d, relationship: "customer of" })),
      ...(map.beneficiaries || []).map(d => ({ ...d, relationship: "beneficiary of" })),
    ];
    for (const dep of all) {
      if (!ripples.find(r => r.ticker === dep.ticker)) {
        ripples.push({ ...dep, parent: ticker });
      }
    }
  }
  return ripples.slice(0, 8);
}

// ── Signal sources ─────────────────────────────────────────────────────────
const SIGNAL_SOURCES = [
  {
    id:"trump", label:"Trump statements", emoji:"🦅",
    searchQuery:"Donald Trump latest statements today Truth Social Twitter 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for Donald Trump latest statements today and return up to 4 items:
[{"source":"Truth Social","time":"1 hour ago","headline":"summary","quote":"quote max 150 chars","url":"","signalType":"trump"}]
If nothing found return: []`
  },
  {
    id:"chips", label:"NVDA / chip news", emoji:"🔬",
    searchQuery:"Nvidia AMD semiconductor AI chip earnings announcement news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Nvidia AMD chip AI news and return up to 3 items:
[{"source":"CNBC","time":"1 hour ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"chips"}]
If nothing found return: []`
  },
  {
    id:"hyperscalers", label:"Cloud & capex news", emoji:"☁️",
    searchQuery:"Microsoft Google Amazon Meta AI data center investment capex announcement today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Microsoft Google Amazon Meta AI cloud news and return up to 3 items:
[{"source":"Bloomberg","time":"2 hours ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"cloud"}]
If nothing found return: []`
  },
  {
    id:"power", label:"Power & energy news", emoji:"⚡",
    searchQuery:"data center power electricity nuclear energy AI demand news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest power energy AI demand news and return up to 3 items:
[{"source":"CNBC","time":"2 hours ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"power"}]
If nothing found return: []`
  },
  {
    id:"policy", label:"AI policy & regulation", emoji:"⚖️",
    searchQuery:"AI regulation policy export controls chips law news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest AI regulation chip export control policy news and return up to 3 items:
[{"source":"WSJ","time":"3 hours ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"policy"}]
If nothing found return: []`
  },
  {
    id:"earnings", label:"Earnings & whisper numbers", emoji:"📅",
    searchQuery:"earnings today this week results beats misses guidance raised lowered AI tech stocks 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest earnings reports, beats, misses, and guidance changes for tech and AI stocks and return up to 4 items:
[{"source":"Earnings","time":"30 minutes ago","headline":"NVDA beats Q2 estimates by 18%","quote":"Revenue $30B vs $25.5B expected, raised FY guidance to $120B","url":"","signalType":"earnings","ticker":"NVDA","beat_miss":"beat","guidance":"raised"}]
If nothing found return: []`
  },
  {
    id:"macro", label:"Macro signals", emoji:"📊",
    searchQuery:"Federal Reserve CPI inflation jobs report GDP VIX market macro news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Fed, CPI, jobs, GDP, or major macro events and return up to 3 items:
[{"source":"Fed","time":"1 hour ago","headline":"Fed holds rates, signals 2 cuts in 2025","quote":"key quote max 150 chars","url":"","signalType":"macro","macro_type":"fed_decision","market_impact":"bullish"}]
If nothing found return: []`
  },
  {
    id:"reddit", label:"Reddit sentiment", emoji:"💬",
    searchQuery:"wallstreetbets stocks trending most mentioned discussed bullish bearish today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for stocks trending on Reddit WallStreetBets r/stocks today and return up to 4 items:
[{"source":"r/wallstreetbets","time":"2 hours ago","headline":"NVDA most mentioned stock today","quote":"brief description of community sentiment max 150 chars","url":"","signalType":"reddit","ticker":"NVDA","sentiment":"bullish","mention_count":"high"}]
If nothing found return: []`
  },
  {
    id:"options", label:"Unusual options activity", emoji:"🐳",
    searchQuery:"unusual options activity large call sweep institutional buying today stocks 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for unusual options activity, large call sweeps, or institutional options buying today and return up to 3 items:
[{"source":"Options Flow","time":"1 hour ago","headline":"Large call sweep on NVDA $900 strike","quote":"brief description max 150 chars","url":"","signalType":"options","ticker":"NVDA","type":"call","sentiment":"bullish"}]
If nothing found return: []`
  },
];

// ── Anthropic client ───────────────────────────────────────────────────────
let anthropic;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
  return anthropic;
}

async function withRetry(fn, retries=3, delayMs=15000) {
  for (let i=0; i<retries; i++) {
    try { return await fn(); }
    catch (err) {
      const retry = (err.message?.includes("429") || err.message?.includes("rate_limit")) && i<retries-1;
      if (retry) { const w=delayMs*(i+1); console.log(`  ⏳ Rate limited — waiting ${w/1000}s...`); await sleep(w); }
      else throw err;
    }
  }
}

async function fetchSourceStatements(source) {
  const response = await withRetry(() => getClient().messages.create({
    model:"claude-sonnet-4-6", max_tokens:1000,
    tools:[{ type:"web_search_20250305", name:"web_search" }],
    system:[{
      type:"text",
      text: source.systemPrompt,
      cache_control:{ type:"ephemeral" },  // cache system prompt — 90% cheaper on repeat calls
    }],
    messages:[{ role:"user", content: source.searchQuery }],
  }));
  trackCacheUsage(response);
  const text = response.content.find(c=>c.type==="text")?.text || "";
  if (!text) { console.log("     ⚠️  No text block"); return []; }
  console.log("     📝 Raw (first 200): " + text.slice(0,200));
  try {
    // Strategy 1: find JSON array anywhere in response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const items = JSON.parse(match[0]);
      if (Array.isArray(items) && items.length > 0) {
        console.log("     ✅ Parsed " + items.length + " item(s)");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
      if (Array.isArray(items) && items.length === 0) {
        console.log("     ✅ Empty array — no new items");
        return [];
      }
    }
    // Strategy 2: strip markdown and re-extract
    const cleaned = text.replace(/```json|```/g,"").trim();
    const match2 = cleaned.match(/\[[\s\S]*\]/);
    if (match2) {
      const items = JSON.parse(match2[0]);
      if (Array.isArray(items)) {
        console.log("     ✅ Parsed " + items.length + " item(s) via strategy 2");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
    }
    // Strategy 3: ask Haiku to reformat
    console.log("     🔄 Asking Haiku to reformat...");
    const retry = await getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:800,
      system:[{ type:"text", text:"Extract news items from the text and return ONLY a raw JSON array starting with [ and ending with ]. Each item needs: source, time, headline, quote, url, signalType. No other text.", cache_control:{ type:"ephemeral" } }],
      messages:[{ role:"user", content: text.slice(0,2000) }],
    });
    trackCacheUsage(retry);
    const retryText = retry.content.find(c=>c.type==="text")?.text || "";
    const match3 = retryText.match(/\[[\s\S]*\]/);
    if (match3) {
      const items = JSON.parse(match3[0]);
      if (Array.isArray(items)) {
        console.log("     ✅ Parsed " + items.length + " item(s) via Haiku reformat");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
    }
    console.log("     ⚠️  All parse strategies failed");
    return [];
  } catch(e) {
    console.log("     ❌ Parse error: " + e.message);
    return [];
  }
}

// ── Market context ─────────────────────────────────────────────────────────
// Cache market context for 10 minutes — it barely changes between polls
let marketCtxCache = null;
let marketCtxTime  = 0;

async function fetchMarketContext(topSectors) {
  // Return cached value if fetched within last 10 minutes
  if (marketCtxCache && (Date.now() - marketCtxTime) < 10 * 60 * 1000) {
    console.log("     💾 Market context from local cache (10min TTL)");
    return marketCtxCache;
  }
  const etfs = [...new Set(topSectors.map(s => LAYERS[s]?.etf).filter(Boolean))].slice(0,3);
  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:400,
      tools:[{ type:"web_search_20250305", name:"web_search" }],
      system:[{
        type:"text",
        text:`Search for current market data and return ONLY a JSON object (no markdown):
{"spy":"% change today","vix":"current value","market_mood":"risk-on|risk-off|neutral","sector_etfs":{"XLK":"+1.2%"},"fed_note":"any Fed/rate news this week or empty","upcoming_events":"earnings or macro events in next 48hrs or empty"}`,
        cache_control:{ type:"ephemeral" },
      }],
      messages:[{ role:"user", content:`Current price SPY VIX ${etfs.join(" ")} market mood today 2025` }],
    }));
    trackCacheUsage(response);
    const text = response.content.find(c=>c.type==="text")?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : null;
    if (result) { marketCtxCache = result; marketCtxTime = Date.now(); }
    return result;
  } catch { return null; }
}

// ── Peer comparison ────────────────────────────────────────────────────────
async function fetchPeerComparison(topSectors) {
  const peers = [...new Set(topSectors.flatMap(s => LAYERS[s]?.peers || []))].slice(0,6);
  if (!peers.length) return null;
  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:600,
      tools:[{ type:"web_search_20250305", name:"web_search" }],
      system:[{
        type:"text",
        text:`Search for current stock data and return ONLY a JSON array (no markdown):
[{"ticker":"NVDA","price":"$X","change":"+2.3%","pe":"35","analyst":"Buy","momentum":"strong|weak|neutral","note":"1 sentence insight"}]`,
        cache_control:{ type:"ephemeral" },
      }],
      messages:[{ role:"user", content:`Stock price PE analyst rating momentum for ${peers.join(", ")} today 2025` }],
    }));
    trackCacheUsage(response);
    const text = response.content.find(c=>c.type==="text")?.text || "";
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// ── Full article fetch ─────────────────────────────────────────────────────
async function fetchArticleText(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, { headers:{"User-Agent":"Mozilla/5.0"}, signal:AbortSignal.timeout(8000) });
    const html = await res.text();
    return html.replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,3000);
  } catch { return ""; }
}

// ── Deep investment analysis ───────────────────────────────────────────────
async function getDeepAnalysis(item, scored, articleText, marketCtx, peerData, ripples) {
  const sectorSignals = Object.entries(scored.signals)
    .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,5)
    .map(([s,d])=>`${LAYERS[s]?.label}: ${d.direction} (${d.strength}%)`).join(", ");

  const marketSummary = marketCtx
    ? `SPY: ${marketCtx.spy} | VIX: ${marketCtx.vix} | Mood: ${marketCtx.market_mood}${marketCtx.fed_note?" | "+marketCtx.fed_note:""}${marketCtx.upcoming_events?" | Upcoming: "+marketCtx.upcoming_events:""}`
    : "Market context unavailable";

  const peerSummary = peerData
    ? peerData.slice(0,5).map(p=>`${p.ticker}: ${p.price} (${p.change}) P/E:${p.pe} ${p.analyst} momentum:${p.momentum} — ${p.note}`).join("\n")
    : "Peer data unavailable";

  const rippleSummary = ripples.length
    ? ripples.map(r=>`${r.ticker} (${r.relationship} ${r.parent}): ${r.reason}`).join("\n")
    : "No supply chain ripple identified";

  const earningsContext = item.signalType==="earnings"
    ? `\nEARNINGS DETAIL: ${item.ticker||""} ${item.beat_miss||""} estimates. Guidance ${item.guidance||"unchanged"}.`
    : "";

  const redditContext = item.signalType==="reddit"
    ? `\nREDDIT SENTIMENT: ${item.ticker||""} trending with ${item.mention_count||"high"} mentions, community is ${item.sentiment||"bullish"}.`
    : "";

  const optionsContext = item.signalType==="options"
    ? `\nOPTIONS FLOW: ${item.ticker||""} showing unusual ${item.type||"call"} activity — institutional signal.`
    : "";

  const macroContext = item.signalType==="macro"
    ? `\nMACRO EVENT: ${item.macro_type||""} — market impact expected: ${item.market_impact||"unknown"}.`
    : "";

  const prompt = `
INVESTOR PROFILE: ${INVESTOR_PROFILE.risk} | ${INVESTOR_PROFILE.horizon} | ${INVESTOR_PROFILE.style}

SOURCE: ${item.sourceLabel} (${item.signalType}) — ${item.time}
HEADLINE: ${item.headline}
QUOTE: "${item.quote}"
${articleText ? `\nARTICLE EXCERPT:\n${articleText.slice(0,1200)}` : ""}
${earningsContext}${redditContext}${optionsContext}${macroContext}

SECTOR SIGNALS: ${sectorSignals}

MARKET CONTEXT: ${marketSummary}

PEER COMPARISON:
${peerSummary}

SUPPLY CHAIN RIPPLE (companies that will also be affected):
${rippleSummary}

Provide a smart aggressive investor analysis with these exact sections:
1. SUMMARY (2 sentences — what happened and why it matters for markets)
2. MARKET CONTEXT (1 sentence — is timing good given SPY/VIX/upcoming events?)
3. BEST PLAY (specific ticker + entry strategy + 1-3 month price target + why)
4. SUPPLY CHAIN PLAY (best ripple/dependent company to buy, less obvious, higher upside %)
5. SECONDARY PLAY (another ticker, brief reason)
6. RISK (single biggest risk to this thesis)
7. CONVICTION: [score 1-100] — reason in 1 sentence

Be aggressive, specific, name prices and % targets. Assume the reader will act on this today.`;

  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-sonnet-4-6", max_tokens:800,
      system:[{
        type:"text",
        text:"You are an aggressive growth investor analyst. Profile: high risk tolerance, 1-3 month horizon, looking for asymmetric upside. Give specific, actionable, data-driven analysis. Name exact tickers, prices, and % targets. Always suggest a supply chain / dependent company play as a less-obvious high-upside idea.",
        cache_control:{ type:"ephemeral" },  // cache analyst persona — same every call
      }],
      messages:[{ role:"user", content: prompt }],
    }));
    trackCacheUsage(response);
    return response.content.find(c=>c.type==="text")?.text || "";
  } catch { return ""; }
}

function extractConviction(text) {
  const match = text.match(/CONVICTION[:\s*]*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

// ── Telegram alert ─────────────────────────────────────────────────────────
async function sendTelegramAlert(item, scored, analysis, ripples) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_IDS.length) return;
  const se = { bullish:"📈", bearish:"📉", neutral:"➡️" }[scored.sentiment] || "➡️";
  const conviction = extractConviction(analysis);

  const rippleText = ripples.length
    ? `\n🔗 *Supply Chain Plays:* ${ripples.slice(0,3).map(r=>`${r.ticker}`).join(" · ")}`
    : "";

  const lines = analysis.split("\n").filter(l=>l.trim()).slice(0,14);

  const msg = [
    `${item.sourceEmoji} *${item.sourceLabel.toUpperCase()}* ${se}`,
    `📊 *${scored.sentiment.toUpperCase()}* | Confidence: *${scored.confidence}%*${conviction?` | Conviction: *${conviction}/100*`:""}`,
    `🕐 ${item.time}${item.ticker ? ` | $${item.ticker}` : ""}`,
    ``,
    `💬 _"${(item.quote||"").slice(0,180)}"_`,
    rippleText,
    ``,
    `📋 *Analysis:*`,
    ...lines,
    ``,
    item.url ? `🔗 [Source](${item.url})` : "",
    `⚠️ _Not financial advice. Aggressive | 1-3mo horizon._`,
  ].filter(l=>l!==undefined).join("\n");

  for (const chatId of CONFIG.TELEGRAM_CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ chat_id:chatId, text:msg, parse_mode:"Markdown", disable_web_page_preview:false }),
      });
      const data = await res.json();
      if (data.ok) console.log(`📲 Telegram → ${chatId} ✅`);
      else {
        // Fallback: send without markdown if parse error
        console.log(`📲 Telegram markdown failed, retrying plain...`);
        await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ chat_id:chatId, text:msg.replace(/[*_`\[\]]/g,""), disable_web_page_preview:true }),
        });
      }
    } catch(e) { console.error(`📲 Telegram failed:`, e.message); }
  }
}

// ── Gmail alert ────────────────────────────────────────────────────────────
async function sendGmailAlert(item, scored, analysis, ripples) {
  if (!CONFIG.GMAIL_USER || !CONFIG.GMAIL_APP_PASSWORD) return;
  const se = { bullish:"📈", bearish:"📉", neutral:"➡️" }[scored.sentiment] || "➡️";
  const conviction = extractConviction(analysis);

  const topSignalsHtml = Object.entries(scored.signals)
    .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,5)
    .map(([s,d])=>`<tr>
      <td style="padding:7px 0;border-bottom:1px solid #1a1a2a;">${LAYERS[s]?.emoji} <strong style="color:#ccc">${LAYERS[s]?.label}</strong> <span style="color:#445;font-size:11px;">${(LAYERS[s]?.tickers||[]).slice(0,3).join(" · ")}</span></td>
      <td style="padding:7px 0;border-bottom:1px solid #1a1a2a;text-align:right;"><span style="padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;background:${d.direction==="BUY"?"rgba(0,208,132,0.18)":"rgba(255,71,87,0.18)"};color:${d.direction==="BUY"?"#00d084":"#ff4757"}">${d.direction}</span></td>
    </tr>`).join("");

  const ripplesHtml = ripples.length ? ripples.slice(0,5).map(r=>`
    <div style="padding:7px 0;border-bottom:1px solid #1a1a2a;">
      <strong style="color:#c8960a">${r.ticker}</strong>
      <span style="color:#888;font-size:11px;margin-left:6px;">${r.relationship} ${r.parent}</span>
      <div style="color:#aaa;font-size:12px;margin-top:2px;">${r.reason}</div>
    </div>`).join("") : "";

  const analysisHtml = analysis.split("\n")
    .map(l => l.startsWith("1.")||l.startsWith("2.")||l.startsWith("3.")||l.startsWith("4.")||l.startsWith("5.")||l.startsWith("6.")||l.startsWith("7.")
      ? `<p style="margin:8px 0;color:#f5e6b0;font-size:13px;font-weight:700;">${l}</p>`
      : `<p style="margin:3px 0;color:#bbb;font-size:13px;line-height:1.6;">${l}</p>`)
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Georgia,serif;color:#dde;">
<div style="max-width:620px;margin:0 auto;padding:20px 16px;">
  <div style="background:linear-gradient(135deg,#0a0a18,#001209);border:1px solid #2a2a3a;border-radius:12px;padding:18px;margin-bottom:14px;text-align:center;">
    <div style="font-size:28px;">${item.sourceEmoji}</div>
    <div style="font-size:17px;font-weight:700;color:#f5e6b0;">AI ECOSYSTEM SIGNAL ENGINE</div>
    <div style="font-size:10px;color:#556;letter-spacing:2px;">PRO INVESTOR · AGGRESSIVE · 1–3 MONTH</div>
  </div>
  <div style="background:${scored.sentiment==="bullish"?"rgba(0,208,132,0.1)":"rgba(255,71,87,0.1)"};border-left:4px solid ${scored.sentiment==="bullish"?"#00d084":"#ff4757"};border-radius:8px;padding:14px 18px;margin-bottom:14px;">
    <div style="font-size:18px;font-weight:700;color:${scored.sentiment==="bullish"?"#00d084":"#ff4757"}">${se} ${scored.sentiment.toUpperCase()} — Confidence ${scored.confidence}%${conviction?` · Conviction ${conviction}/100`:""}</div>
    <div style="font-size:12px;color:#888;margin-top:3px;">${item.time} · ${item.sourceLabel}${item.ticker?` · $${item.ticker}`:""}</div>
  </div>
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;">
    <div style="font-size:11px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Signal</div>
    <div style="font-size:14px;color:#ccd;font-style:italic;">"${item.quote}"</div>
    ${item.url?`<a href="${item.url}" style="font-size:11px;color:#556;display:inline-block;margin-top:8px;">🔗 Source →</a>`:""}
  </div>
  ${topSignalsHtml?`<div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;">${topSignalsHtml}</table></div>`:""}
  ${ripplesHtml?`<div style="background:rgba(200,150,10,0.07);border:1px solid #c8960a30;border-radius:10px;padding:14px 18px;margin-bottom:14px;"><div style="font-size:11px;color:#c8960a;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🔗 Supply Chain Ripple Plays</div>${ripplesHtml}</div>`:""}
  <div style="background:rgba(20,10,40,0.9);border:1px solid #2a1a5a;border-radius:10px;padding:16px 18px;margin-bottom:14px;">
    <div style="font-size:11px;color:#9b5de5;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🤖 Smart Investor Analysis</div>
    ${analysisHtml}
  </div>
  <div style="font-size:11px;color:#554433;padding:10px 14px;background:rgba(255,165,2,0.05);border-radius:6px;">⚠️ Not financial advice. Educational only. Always consult a licensed advisor before investing.</div>
</div></body></html>`;

  const transporter = nodemailer.createTransport({service:"gmail",auth:{user:CONFIG.GMAIL_USER,pass:CONFIG.GMAIL_APP_PASSWORD}});
  await transporter.sendMail({
    from:`"AI Signal Engine" <${CONFIG.GMAIL_USER}>`,
    to:CONFIG.ALERT_EMAIL,
    subject:`${item.sourceEmoji} ${scored.sentiment.toUpperCase()} ${scored.confidence}%${conviction?` · ${conviction}/100`:""} — ${item.sourceLabel}${item.ticker?` $${item.ticker}`:""}`,
    html,
  });
  console.log(`📧 Gmail → ${CONFIG.ALERT_EMAIL} ✅`);
}

async function sendAllAlerts(item, scored, analysis, ripples) {
  await Promise.all([
    sendTelegramAlert(item, scored, analysis, ripples).catch(e=>console.error("Telegram:",e.message)),
    sendGmailAlert(item, scored, analysis, ripples).catch(e=>console.error("Gmail:",e.message)),
  ]);
}

// ── Main poll ──────────────────────────────────────────────────────────────
const seenQuotes = new Set();
let lastPollTime = null;
let nextPollTime = null;
const cacheStats = { hits: 0, writes: 0, tokensSaved: 0 };

function trackCacheUsage(response) {
  if (!response?.usage) return;
  const hit   = response.usage.cache_read_input_tokens   || 0;
  const write = response.usage.cache_creation_input_tokens || 0;
  if (hit)   { cacheStats.hits++;   cacheStats.tokensSaved += hit; }
  if (write) { cacheStats.writes++; }
  if (hit || write) {
    console.log(`     💾 Cache: ${hit ? "HIT "+hit+" tokens saved (90% off)" : ""} ${write ? "WRITE "+write+" tokens" : ""}`);
  }
}

async function poll() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🔄 Polling ${SIGNAL_SOURCES.length} sources...`);

  for (const source of SIGNAL_SOURCES) {
    console.log(`  ${source.emoji} Fetching ${source.label}...`);
    let items = [];
    try { items = await fetchSourceStatements(source); }
    catch(err) { console.error(`  ❌ ${source.label} failed:`, err.message); await sleep(25000); continue; }
    console.log(`  → ${items.length} item(s)`);

    for (const item of items) {
      const key = (item.quote||item.headline||"").slice(0,50);
      if (seenQuotes.has(key)) { console.log(`     ↩  Already seen`); continue; }
      seenQuotes.add(key);
      if (seenQuotes.size > 1000) seenQuotes.delete(seenQuotes.values().next().value);

      const scored = scoreStatement(item.quote||item.headline||"");
      console.log(`     "${key.slice(0,45)}…" → ${scored.sentiment} ${scored.confidence}%`);

      if (scored.confidence < CONFIG.CONFIDENCE_THRESHOLD || !Object.keys(scored.signals).length) {
        console.log(`     ↩  Below threshold (${CONFIG.CONFIDENCE_THRESHOLD}%)`); continue;
      }

      const topSectors = Object.entries(scored.signals)
        .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,3).map(([s])=>s);

      // Find supply chain ripples immediately
      const ripples = findSupplyChainRipple(scored.signals);
      if (ripples.length) console.log(`     🔗 Ripple: ${ripples.map(r=>r.ticker).join(", ")}`);

      // Fetch context in parallel — skip peer comparison for low-mid confidence to save tokens
      const highConfidence = scored.confidence >= 75;
      console.log(`     🔍 Fetching context... ${highConfidence ? "(full)" : "(market only — confidence <75%)"}`);
      const [articleText, marketCtx, peerData] = await Promise.allSettled([
        fetchArticleText(item.url),
        fetchMarketContext(topSectors),
        highConfidence ? fetchPeerComparison(topSectors) : Promise.resolve(null),
      ]).then(results => results.map(r => r.status==="fulfilled" ? r.value : null));

      console.log(`     🤖 Running deep analysis...`);
      const analysis = await getDeepAnalysis(item, scored, articleText, marketCtx, peerData, ripples);
      const conviction = extractConviction(analysis);
      console.log(`     💡 Conviction: ${conviction??""}/100`);

      await sendAllAlerts(item, scored, analysis, ripples);
      await sleep(5000);
    }

    await sleep(25000); // rate limit buffer between sources
  }

  lastPollTime = new Date().toISOString();
  console.log(`  💾 Session cache stats: ${cacheStats.hits} hits | ${cacheStats.tokensSaved.toLocaleString()} tokens saved | ${cacheStats.writes} writes`);
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function startHealthServer() {
  const http = require("http");
  const port = process.env.PORT || 3000;
  http.createServer((req,res) => {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({ status:"running", service:"AI Signal Engine Pro", profile:"aggressive|1-3mo", uptime:Math.floor(process.uptime())+"s", sources:SIGNAL_SOURCES.length, layers:Object.keys(LAYERS).length, lastPoll:lastPollTime, nextPoll:nextPollTime, cacheHits:cacheStats.hits, tokensSaved:cacheStats.tokensSaved, cacheWrites:cacheStats.writes }));
  }).listen(port, ()=>console.log(`🌐 Health check on port ${port}`));
}

async function main() {
  validateConfig();
  console.log("🤖 AI Ecosystem Signal Engine — Pro Investor Edition");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`👤 Profile: ${INVESTOR_PROFILE.risk} | ${INVESTOR_PROFILE.horizon}`);
  console.log(`📧 Gmail  → ${CONFIG.GMAIL_USER ? CONFIG.ALERT_EMAIL : "disabled"}`);
  console.log(`📲 Telegram → ${CONFIG.TELEGRAM_BOT_TOKEN ? CONFIG.TELEGRAM_CHAT_IDS.length+" recipient(s)" : "disabled"}`);
  console.log(`🎯 Threshold: ${CONFIG.CONFIDENCE_THRESHOLD}% | Poll: every ${CONFIG.POLL_INTERVAL_MIN}min`);
  console.log(`📡 Sources: ${SIGNAL_SOURCES.map(s=>s.emoji+s.label).join(" | ")}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  startHealthServer();
  await poll();

  const intervalMs = CONFIG.POLL_INTERVAL_MIN * 60 * 1000;
  setInterval(async () => { await poll(); nextPollTime = new Date(Date.now()+intervalMs).toISOString(); }, intervalMs);
  nextPollTime = new Date(Date.now()+intervalMs).toISOString();
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
