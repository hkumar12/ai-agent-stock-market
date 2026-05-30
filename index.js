/**
 * 🤖 AI Ecosystem Signal Engine — Smart Investor Edition
 * Profile: Aggressive | Medium-term (1-3 months) | Full context
 * - Full article reading
 * - Peer comparison
 * - Market context (VIX, SPY, sector ETFs)
 * - Multi-factor conviction scoring
 * - Gmail + Telegram alerts
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

// Investor profile baked in — used in every AI prompt
const INVESTOR_PROFILE = {
  risk:      "aggressive",
  horizon:   "medium-term (1–3 months)",
  style:     "high growth, comfortable with volatility, looking for asymmetric upside",
  avoid:     "slow dividend plays, ultra-defensive positions",
};

function validateConfig() {
  if (!CONFIG.ANTHROPIC_API_KEY) { console.error("❌ Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!CONFIG.TELEGRAM_BOT_TOKEN && !CONFIG.GMAIL_USER) {
    console.error("❌ Need TELEGRAM_BOT_TOKEN or GMAIL_USER"); process.exit(1);
  }
}

// ── Sector / layer definitions ─────────────────────────────────────────────
const LAYERS = {
  power:         { label:"Power & utilities",   emoji:"⚡", tickers:["NEE","CEG","VST","DUK","AES"], etf:"XLU",  peers:["NEE","CEG","VST"] },
  water:         { label:"Water & cooling",     emoji:"💧", tickers:["AWK","WTRG","VRT","SMCI"],     etf:"PHO",  peers:["AWK","VRT","SMCI"] },
  datacenter:    { label:"Data center REITs",   emoji:"🏢", tickers:["EQIX","DLR","IRM","AMT"],      etf:"XLRE", peers:["EQIX","DLR","IRM"] },
  chips:         { label:"Chips & semis",       emoji:"🔬", tickers:["NVDA","AMD","AVGO","AMAT","ASML","TSM"], etf:"SOXX", peers:["NVDA","AMD","AVGO"] },
  networking:    { label:"Networking & fiber",  emoji:"🌐", tickers:["CSCO","ANET","LITE","CIEN"],   etf:"IGN",  peers:["CSCO","ANET","CIEN"] },
  cloud:         { label:"Cloud & data",        emoji:"☁️", tickers:["AMZN","MSFT","GOOGL","SNOW","MDB","NET","DDOG"], etf:"WCLD", peers:["AMZN","MSFT","GOOGL"] },
  aimodels:      { label:"AI models",           emoji:"🤖", tickers:["MSFT","GOOGL","META","PLTR","AI"], etf:"AIQ", peers:["MSFT","GOOGL","META"] },
  applications:  { label:"AI software",        emoji:"💻", tickers:["NOW","PLTR","PATH","DDOG","ZS","CRWD"], etf:"IGV", peers:["NOW","PLTR","CRWD"] },
  energy:        { label:"Energy & oil",        emoji:"⛽", tickers:["XOM","CVX","OXY","COP"],       etf:"XLE",  peers:["XOM","CVX","OXY"] },
  defense:       { label:"Defense",             emoji:"🛡️", tickers:["LMT","RTX","NOC","GD"],        etf:"ITA",  peers:["LMT","RTX","NOC"] },
  manufacturing: { label:"Manufacturing",       emoji:"🏭", tickers:["CAT","DE","NUE","STLD"],       etf:"XLI",  peers:["CAT","DE","NUE"] },
  crypto:        { label:"Crypto",              emoji:"₿",  tickers:["COIN","MSTR","IBIT"],          etf:"BITO", peers:["COIN","MSTR","IBIT"] },
};

const SIGNAL_KW = {
  bullish: {
    power:         ["power purchase","data center power","electricity demand","nuclear","clean energy deal","grid expansion","gigawatt","energy contract"],
    water:         ["data center cooling","liquid cooling","thermal management","cooling infrastructure"],
    datacenter:    ["data center","colocation","hyperscale lease","new campus","capacity expansion"],
    chips:         ["gpu","chip","semiconductor","nvidia","ai accelerator","h100","b200","blackwell","wafer","foundry","ai chip","inference","training"],
    networking:    ["400g","800g","optical","fiber","interconnect","infiniband","spectrum-x","network upgrade"],
    cloud:         ["cloud revenue","aws","azure","google cloud","cloud ai","snowflake","data warehouse","cloud contract"],
    aimodels:      ["gpt","gemini","llama","claude","foundation model","openai","anthropic","ai partnership","copilot","ai agent"],
    applications:  ["enterprise ai","ai adoption","ai workflow","ai contract","digital transformation","ai platform"],
    energy:        ["drill","oil","lng","energy independence","pipeline","fracking","natural gas"],
    defense:       ["military","nato","defense spending","pentagon","strong military","weapons"],
    manufacturing: ["tariffs","made in america","reshoring","buy american","steel tariffs"],
    crypto:        ["bitcoin","crypto","blockchain","pro-crypto","strategic reserve","digital currency"],
  },
  bearish: {
    chips:         ["chip export ban","semiconductor restriction","export control","china chip ban","chip tariff"],
    cloud:         ["cloud spending cut","cloud churn","cloud outage"],
    aimodels:      ["ai regulation","ai ban","ai moratorium","ai safety law"],
    applications:  ["enterprise spending cut","saas slowdown","it budget cut"],
    energy:        ["green new deal","climate regulation","ev mandate"],
    manufacturing: ["tariff retaliation","trade war"],
    crypto:        ["crypto ban","crypto regulation","sec crypto"],
  },
};

function scoreStatement(text) {
  const lower = text.toLowerCase();
  const signals = {};
  Object.entries(LAYERS).forEach(([layer, def]) => {
    let score = 0;
    (SIGNAL_KW.bullish[layer] || []).forEach(kw => { if (lower.includes(kw)) score += 2; });
    (SIGNAL_KW.bearish[layer]  || []).forEach(kw => { if (lower.includes(kw)) score -= 2; });
    if (score !== 0) signals[layer] = { direction: score > 0 ? "BUY" : "SELL", strength: Math.min(Math.abs(score)*20,100), score };
  });
  const bull    = Object.values(signals).filter(s => s.direction==="BUY").length;
  const bear    = Object.values(signals).filter(s => s.direction==="SELL").length;
  const urgency = ["record","historic","beats","misses","raises","lowers","billions","trillion","massive","emergency","tremendous","incredible"]
    .filter(w => lower.includes(w)).length;
  const confidence = Math.min((Math.max(bull,bear)*16) + urgency*5, 95);
  return { signals, sentiment: bull>bear?"bullish":bear>bull?"bearish":"neutral", confidence, bull, bear };
}

// ── Signal sources ─────────────────────────────────────────────────────────
const SIGNAL_SOURCES = [
  {
    id:"trump", label:"Trump statements", emoji:"🦅",
    searchQuery:"Donald Trump latest statements today Truth Social Twitter 2025",
    systemPrompt:`Respond with ONLY a raw JSON array, starting with [ and ending with ]. No headings, no markdown, no explanation. Search for Donald Trump latest statements today and return up to 4 items:
[{"source":"Truth Social","time":"1 hour ago","headline":"summary","quote":"quote max 150 chars","url":"","signalType":"trump"}]
If nothing found return: []`
  },
  {
    id:"chips", label:"NVDA / chip news", emoji:"🔬",
    searchQuery:"Nvidia AMD semiconductor AI chip earnings announcement news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array, starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Nvidia AMD chip AI news and return up to 3 items:
[{"source":"CNBC","time":"1 hour ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"chips"}]
If nothing found return: []`
  },
  {
    id:"hyperscalers", label:"Cloud & capex news", emoji:"☁️",
    searchQuery:"Microsoft Google Amazon Meta AI data center investment capex announcement today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array, starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Microsoft Google Amazon Meta AI cloud news and return up to 3 items:
[{"source":"Bloomberg","time":"2 hours ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"cloud"}]
If nothing found return: []`
  },
  {
    id:"power", label:"Power & energy news", emoji:"⚡",
    searchQuery:"data center power electricity nuclear energy AI demand news today 2025",
    systemPrompt:`You must respond with ONLY a raw JSON array. No headings, no markdown, no explanation, no preamble. Start your response with [ and end with ]. Search for latest power/energy/AI demand news and return this exact structure:
[{"source":"CNBC","time":"2 hours ago","headline":"summary here","quote":"key quote here","url":"","signalType":"power"}]
If nothing found return: []`
  },
  {
    id:"policy", label:"AI policy & regulation", emoji:"⚖️",
    searchQuery:"AI regulation policy export controls chips law news today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array, starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest AI regulation chip export control policy news and return up to 3 items:
[{"source":"WSJ","time":"3 hours ago","headline":"summary","quote":"key detail max 150 chars","url":"","signalType":"policy"}]
If nothing found return: []`
  },
];

// ── Anthropic helpers ──────────────────────────────────────────────────────
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

// ── Fetch full article text ────────────────────────────────────────────────
async function fetchArticleText(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, { headers:{ "User-Agent":"Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    // Strip tags, get first 3000 chars of readable text
    return html.replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,3000);
  } catch { return ""; }
}

// ── Market context (SPY, VIX, sector ETFs) via web search ─────────────────
async function fetchMarketContext(topSectors) {
  const etfs = [...new Set(topSectors.map(s => LAYERS[s]?.etf).filter(Boolean))].slice(0,3);
  const query = `SPY VIX ${etfs.join(" ")} stock price today market open 2025`;
  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:400,
      tools:[{ type:"web_search_20250305", name:"web_search" }],
      system:`Search for current market data and return ONLY a JSON object (no markdown):
{"spy":"price or % change","vix":"current value","market_mood":"risk-on|risk-off|neutral","sector_etfs":{"TICKER":"% change"},"fed_note":"any Fed meeting or rate news this week or empty string"}`,
      messages:[{ role:"user", content: query }],
    }));
    const text = response.content.find(c=>c.type==="text")?.text || "";
    return JSON.parse(text.replace(/```json|```/g,"").trim());
  } catch { return null; }
}

// ── Peer comparison ────────────────────────────────────────────────────────
async function fetchPeerComparison(topSectors) {
  const peers = [...new Set(topSectors.flatMap(s => LAYERS[s]?.peers || []))].slice(0,6);
  if (!peers.length) return null;
  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:500,
      tools:[{ type:"web_search_20250305", name:"web_search" }],
      system:`Search for current stock data for these tickers and return ONLY a JSON array (no markdown):
[{"ticker":"NVDA","price":"$X","change":"+2.3%","pe":"35","week52":"low $X high $X","analyst":"Buy/Hold/Sell","note":"1 sentence why it's interesting or risky right now"}]`,
      messages:[{ role:"user", content:`Current stock data PE ratio analyst rating for: ${peers.join(", ")} today 2025` }],
    }));
    const text = response.content.find(c=>c.type==="text")?.text || "";
    return JSON.parse(text.replace(/```json|```/g,"").trim());
  } catch { return null; }
}

// ── Deep investment analysis ───────────────────────────────────────────────
async function getDeepAnalysis(item, scored, articleText, marketCtx, peerData) {
  const topSectors = Object.entries(scored.signals)
    .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score))
    .slice(0,4).map(([s])=>s);

  const marketSummary = marketCtx
    ? `SPY: ${marketCtx.spy} | VIX: ${marketCtx.vix} | Mood: ${marketCtx.market_mood}${marketCtx.fed_note ? " | Fed: "+marketCtx.fed_note : ""}`
    : "Market context unavailable";

  const peerSummary = peerData
    ? peerData.slice(0,5).map(p=>`${p.ticker}: ${p.price} (${p.change}) P/E ${p.pe} — ${p.analyst} — ${p.note}`).join("\n")
    : "Peer data unavailable";

  const sectorSignals = Object.entries(scored.signals)
    .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score))
    .slice(0,5)
    .map(([s,d])=>`${LAYERS[s]?.label}: ${d.direction} (${d.strength}% strength)`)
    .join(", ");

  const prompt = `
INVESTOR PROFILE: ${INVESTOR_PROFILE.risk} risk | ${INVESTOR_PROFILE.horizon} horizon | ${INVESTOR_PROFILE.style}

NEWS SOURCE: ${item.sourceLabel} — ${item.time}
HEADLINE: ${item.headline}
QUOTE: "${item.quote}"
${articleText ? `\nFULL ARTICLE EXCERPT:\n${articleText.slice(0,1500)}` : ""}

SECTOR SIGNALS: ${sectorSignals}

MARKET CONTEXT: ${marketSummary}

PEER DATA:
${peerSummary}

Based on ALL of the above, provide a smart investor analysis with these exact sections:
1. SUMMARY (2 sentences — what happened and why it matters)
2. MARKET CONTEXT (1 sentence — is now a good time to act given SPY/VIX?)
3. BEST PLAY (specific ticker, entry strategy, and 1-3 month price target)
4. SECONDARY PLAY (runner-up ticker from peer data, brief reason)
5. RISK (biggest risk to this thesis in 1 sentence)
6. CONVICTION (score 1-100 based on signal strength + fundamentals + market context, with brief reason)

Be direct, aggressive, specific. Name exact prices and percentages where possible. No generic advice.`;

  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-sonnet-4-6", max_tokens:700,
      system:`You are a sharp, aggressive growth investor analyst managing a portfolio for someone with high risk tolerance and a 1-3 month horizon. You give specific, actionable, data-driven analysis. Never hedge excessively. Name tickers and numbers.`,
      messages:[{ role:"user", content: prompt }],
    }));
    return response.content.find(c=>c.type==="text")?.text || "";
  } catch { return ""; }
}

// ── Conviction score extractor ─────────────────────────────────────────────
function extractConviction(analysisText) {
  const match = analysisText.match(/CONVICTION[:\s]+(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

// ── Telegram alert ─────────────────────────────────────────────────────────
async function sendTelegramAlert(item, scored, analysis) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_IDS.length) return;
  const se = { bullish:"📈", bearish:"📉", neutral:"➡️" }[scored.sentiment] || "➡️";
  const conviction = extractConviction(analysis);

  // Parse sections from analysis for clean formatting
  const lines = analysis.split("\n").filter(l=>l.trim());

  const msg = [
    `${item.sourceEmoji} *${item.sourceLabel.toUpperCase()} SIGNAL* ${se}`,
    `📊 *${scored.sentiment.toUpperCase()}* | Confidence: *${scored.confidence}%*${conviction ? ` | Conviction: *${conviction}/100*` : ""}`,
    `🕐 ${item.time}`,
    ``,
    `💬 _"${(item.quote||"").slice(0,180)}"_`,
    ``,
    `📋 *Analysis:*`,
    ...lines.slice(0, 12),
    ``,
    item.url ? `🔗 [Read full article](${item.url})` : "",
    ``,
    `⚠️ _Not financial advice. Aggressive profile | 1-3 month horizon._`,
  ].filter(l=>l!==undefined).join("\n");

  for (const chatId of CONFIG.TELEGRAM_CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ chat_id:chatId, text:msg, parse_mode:"Markdown", disable_web_page_preview:false }),
      });
      const data = await res.json();
      if (data.ok) console.log(`📲 Telegram → ${chatId} ✅`);
      else console.error(`📲 Telegram → ${chatId} ❌`, data.description);
    } catch (err) { console.error(`📲 Telegram failed:`, err.message); }
  }
}

// ── Gmail alert ────────────────────────────────────────────────────────────
async function sendGmailAlert(item, scored, analysis) {
  if (!CONFIG.GMAIL_USER || !CONFIG.GMAIL_APP_PASSWORD) return;
  const se = { bullish:"📈", bearish:"📉", neutral:"➡️" }[scored.sentiment] || "➡️";
  const conviction = extractConviction(analysis);

  const topSignalsHtml = Object.entries(scored.signals)
    .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,5)
    .map(([s,d])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1a1a2a;">
      <span>${LAYERS[s]?.emoji} <strong style="color:#ccc">${LAYERS[s]?.label}</strong> <span style="color:#445;font-size:11px;">${(LAYERS[s]?.tickers||[]).slice(0,3).join(" · ")}</span></span>
      <span style="padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;background:${d.direction==="BUY"?"rgba(0,208,132,0.18)":"rgba(255,71,87,0.18)"};color:${d.direction==="BUY"?"#00d084":"#ff4757"}">${d.direction}</span>
    </div>`).join("");

  const analysisHtml = analysis
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .split("\n").map(l=>`<p style="margin:4px 0;color:#bbb;font-size:13px;line-height:1.6">${l}</p>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Georgia,serif;color:#dde;">
<div style="max-width:600px;margin:0 auto;padding:20px 16px;">
  <div style="background:linear-gradient(135deg,#0a0a18,#001209);border:1px solid #2a2a3a;border-radius:12px;padding:18px;margin-bottom:14px;text-align:center;">
    <div style="font-size:28px;">${item.sourceEmoji}</div>
    <div style="font-size:17px;font-weight:700;color:#f5e6b0;margin-top:4px;">AI ECOSYSTEM SIGNAL ENGINE</div>
    <div style="font-size:10px;color:#556;letter-spacing:2px;margin-top:2px;">SMART INVESTOR EDITION · AGGRESSIVE · 1–3 MONTH</div>
  </div>
  <div style="background:${scored.sentiment==="bullish"?"rgba(0,208,132,0.1)":"rgba(255,71,87,0.1)"};border-left:4px solid ${scored.sentiment==="bullish"?"#00d084":"#ff4757"};border-radius:8px;padding:14px 18px;margin-bottom:14px;">
    <div style="font-size:18px;font-weight:700;color:${scored.sentiment==="bullish"?"#00d084":"#ff4757"}">${se} ${scored.sentiment.toUpperCase()} — ${scored.confidence}% confidence${conviction?` · Conviction ${conviction}/100`:""}</div>
    <div style="font-size:12px;color:#888;margin-top:3px;">${item.time} · ${item.source}</div>
  </div>
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;">
    <div style="font-size:10px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Statement</div>
    <div style="font-size:14px;color:#ccd;line-height:1.6;font-style:italic;">"${item.quote}"</div>
    ${item.url?`<a href="${item.url}" style="font-size:11px;color:#556;display:inline-block;margin-top:8px;">🔗 Full article →</a>`:""}
  </div>
  ${topSignalsHtml?`<div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;">${topSignalsHtml}</div>`:""}
  <div style="background:rgba(20,10,40,0.9);border:1px solid #2a1a5a;border-radius:10px;padding:16px 18px;margin-bottom:14px;">
    <div style="font-size:10px;color:#9b5de5;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🤖 Smart Investor Analysis</div>
    ${analysisHtml}
  </div>
  <div style="font-size:11px;color:#554433;padding:10px 14px;background:rgba(255,165,2,0.05);border-radius:6px;">⚠️ Not financial advice. Educational only. Always consult a licensed advisor.</div>
</div></body></html>`;

  const transporter = nodemailer.createTransport({ service:"gmail", auth:{ user:CONFIG.GMAIL_USER, pass:CONFIG.GMAIL_APP_PASSWORD }});
  await transporter.sendMail({
    from:`"AI Signal Engine" <${CONFIG.GMAIL_USER}>`,
    to: CONFIG.ALERT_EMAIL,
    subject:`${item.sourceEmoji} ${scored.sentiment.toUpperCase()} ${scored.confidence}%${conviction?` · Conviction ${conviction}/100`:""} — ${item.sourceLabel}`,
    html,
  });
  console.log(`📧 Gmail → ${CONFIG.ALERT_EMAIL} ✅`);
}

async function sendAllAlerts(item, scored, analysis) {
  await Promise.all([
    sendTelegramAlert(item, scored, analysis).catch(e=>console.error("Telegram failed:",e.message)),
    sendGmailAlert(item, scored, analysis).catch(e=>console.error("Gmail failed:",e.message)),
  ]);
}

// ── Source fetcher ─────────────────────────────────────────────────────────
async function fetchSourceStatements(source) {
  const response = await withRetry(() => getClient().messages.create({
    model:"claude-sonnet-4-6", max_tokens:1000,
    tools:[{ type:"web_search_20250305", name:"web_search" }],
    system: source.systemPrompt,
    messages:[{ role:"user", content: source.searchQuery }],
  }));
  const text = response.content.find(c=>c.type==="text")?.text || "";
  if (!text) { console.log("     ⚠️  No text block in response"); return []; }
  console.log("     📝 Raw (first 200): " + text.slice(0,200));
  try {
    // Strategy 1: find a JSON array anywhere in the response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const items = JSON.parse(match[0]);
      if (Array.isArray(items) && items.length > 0) {
        console.log("     ✅ Extracted " + items.length + " item(s) via array match");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
    }
    // Strategy 2: strip markdown fences and try full parse
    const cleaned = text.replace(/```json|```/g,"").replace(/^[^\[]*/, "").replace(/[^\]]*$/, "").trim();
    if (cleaned.startsWith("[")) {
      const items = JSON.parse(cleaned);
      if (Array.isArray(items)) {
        console.log("     ✅ Extracted " + items.length + " item(s) via cleaned parse");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
    }
    // Strategy 3: ask Claude to reformat as JSON (1 retry)
    console.log("     🔄 Asking Claude to reformat as JSON...");
    const retry = await getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:800,
      system:"Extract the news items from the text below and return ONLY a raw JSON array starting with [ and ending with ]. No other text. Each item must have: source, time, headline, quote, url, signalType fields.",
      messages:[{ role:"user", content: text.slice(0,2000) }],
    });
    const retryText = retry.content.find(c=>c.type==="text")?.text || "";
    const retryMatch = retryText.match(/\[[\s\S]*?\]/);
    if (retryMatch) {
      const items = JSON.parse(retryMatch[0]);
      if (Array.isArray(items)) {
        console.log("     ✅ Extracted " + items.length + " item(s) via Claude reformat");
        return items.map(i=>({...i, sourceId:source.id, sourceLabel:source.label, sourceEmoji:source.emoji}));
      }
    }
    console.log("     ⚠️  All parse strategies failed, returning []");
    return [];
  } catch(e) {
    console.log("     ❌ Parse error: " + e.message);
    return [];
  }
}

// ── Main poll ──────────────────────────────────────────────────────────────
const seenQuotes = new Set();
let lastPollTime = null;
let nextPollTime = null;

async function poll() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🔄 Polling ${SIGNAL_SOURCES.length} sources...`);

  for (const source of SIGNAL_SOURCES) {
    console.log(`  ${source.emoji} Fetching ${source.label}...`);
    let items = [];
    try { items = await fetchSourceStatements(source); }
    catch (err) { console.error(`  ❌ ${source.label} failed:`, err.message); await sleep(25000); continue; }
    console.log(`  → ${items.length} item(s)`);

    for (const item of items) {
      const key = (item.quote||item.headline||"").slice(0,50);
      if (seenQuotes.has(key)) continue;
      seenQuotes.add(key);
      if (seenQuotes.size > 1000) seenQuotes.delete(seenQuotes.values().next().value);

      const scored = scoreStatement(item.quote||item.headline||"");
      console.log(`     "${key.slice(0,45)}…" → ${scored.sentiment} ${scored.confidence}%`);

      if (scored.confidence < CONFIG.CONFIDENCE_THRESHOLD || !Object.keys(scored.signals).length) {
        console.log(`     ↩  Below threshold`); continue;
      }

      const topSectors = Object.entries(scored.signals).sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,3).map(([s])=>s);

      // Fetch all context in parallel
      console.log(`     🔍 Fetching article, market context, peer data...`);
      const [articleText, marketCtx, peerData] = await Promise.allSettled([
        fetchArticleText(item.url),
        fetchMarketContext(topSectors),
        fetchPeerComparison(topSectors),
      ]).then(results => results.map(r => r.status==="fulfilled" ? r.value : null));

      console.log(`     🤖 Running deep analysis...`);
      const analysis = await getDeepAnalysis(item, scored, articleText, marketCtx, peerData);
      const conviction = extractConviction(analysis);
      console.log(`     💡 Conviction: ${conviction ?? "N/A"}/100`);

      await sendAllAlerts(item, scored, analysis);
      await sleep(5000);
    }

    await sleep(25000); // rate limit buffer between sources
  }

  lastPollTime = new Date().toISOString();
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function startHealthServer() {
  const http = require("http");
  const port = process.env.PORT || 3000;
  http.createServer((req,res) => {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({ status:"running", service:"AI Smart Investor Engine", profile:"aggressive|1-3mo", uptime:Math.floor(process.uptime())+"s", seenCount:seenQuotes.size, lastPoll:lastPollTime, nextPoll:nextPollTime }));
  }).listen(port, ()=>console.log(`🌐 Health check on port ${port}`));
}

async function main() {
  validateConfig();
  console.log("🤖 AI Ecosystem Signal Engine — Smart Investor Edition");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`👤 Profile: ${INVESTOR_PROFILE.risk} | ${INVESTOR_PROFILE.horizon}`);
  console.log(`📧 Gmail  → ${CONFIG.GMAIL_USER ? CONFIG.ALERT_EMAIL : "disabled"}`);
  console.log(`📲 Telegram → ${CONFIG.TELEGRAM_BOT_TOKEN ? CONFIG.TELEGRAM_CHAT_IDS.length+" recipient(s)" : "disabled"}`);
  console.log(`🎯 Threshold: ${CONFIG.CONFIDENCE_THRESHOLD}% | Poll: every ${CONFIG.POLL_INTERVAL_MIN}min`);
  console.log(`📡 Sources: ${SIGNAL_SOURCES.length} | Layers: ${Object.keys(LAYERS).length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  startHealthServer();
  await poll();

  const intervalMs = CONFIG.POLL_INTERVAL_MIN * 60 * 1000;
  setInterval(async () => { await poll(); nextPollTime = new Date(Date.now()+intervalMs).toISOString(); }, intervalMs);
  nextPollTime = new Date(Date.now()+intervalMs).toISOString();
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
