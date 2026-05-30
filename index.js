/**
 * AI Ecosystem Signal Engine + Trump Market Oracle
 * Monitors 7 layers of the AI supply chain + Trump statements
 * Sends Gmail alerts for high-confidence investment signals
 */

const nodemailer = require("nodemailer");
const Anthropic  = require("@anthropic-ai/sdk");

const CONFIG = {
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY,
  GMAIL_USER:           process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD:   process.env.GMAIL_APP_PASSWORD,
  ALERT_EMAIL:          process.env.ALERT_EMAIL || process.env.GMAIL_USER,
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD) || 60,
  POLL_INTERVAL_MIN:    Number(process.env.POLL_INTERVAL_MIN)    || 5,
};

function validateConfig() {
  const missing = ["ANTHROPIC_API_KEY","GMAIL_USER","GMAIL_APP_PASSWORD"].filter(k => !CONFIG[k]);
  if (missing.length) { console.error("❌ Missing env vars:", missing.join(", ")); process.exit(1); }
}

// ── AI Ecosystem layers ───────────────────────────────────────────────────
const LAYERS = {
  power: {
    label: "Power & utilities",
    emoji: "⚡",
    tickers: ["NEE","CEG","VST","DUK","AES","ETR"],
    keywords: {
      bullish: ["power purchase","data center power","electricity demand","nuclear energy","clean energy deal","grid expansion","energy contract","hyperscaler power","gigawatt"],
      bearish: ["power outage","grid failure","energy regulation","electricity price cap","utility rate cut"]
    }
  },
  water: {
    label: "Water & cooling",
    emoji: "💧",
    tickers: ["AWK","WTRG","VRT","SMCI","CLS"],
    keywords: {
      bullish: ["data center cooling","liquid cooling","water usage","thermal management","cooling infrastructure","vertiv","data center water"],
      bearish: ["water shortage","cooling failure","environmental water restriction"]
    }
  },
  datacenter: {
    label: "Data center REITs",
    emoji: "🏢",
    tickers: ["EQIX","DLR","IRM","AMT","CONE","QTS"],
    keywords: {
      bullish: ["data center","colocation","new campus","hyperscale lease","server farm","data center expansion","capacity expansion","new facility"],
      bearish: ["data center oversupply","vacancy rate","lease cancellation","data center slowdown"]
    }
  },
  chips: {
    label: "Chips & semiconductors",
    emoji: "🔬",
    tickers: ["NVDA","AMD","INTC","ARM","AVGO","AMAT","ASML","TSM","QCOM","MRVL"],
    keywords: {
      bullish: ["gpu","chip","semiconductor","nvidia","ai accelerator","wafer","chip demand","fab","foundry","ai chip","inference","training cluster","h100","b200","blackwell"],
      bearish: ["chip export ban","semiconductor restriction","chip tariff","export control","chip oversupply","inventory glut","china chip ban"]
    }
  },
  networking: {
    label: "Networking & fiber",
    emoji: "🌐",
    tickers: ["CSCO","ANET","LITE","CIEN","JNPR","FFIV","INFN"],
    keywords: {
      bullish: ["network upgrade","400g","800g","optical","fiber","interconnect","switching","network infrastructure","bandwidth","infiniband","spectrum-x"],
      bearish: ["network slowdown","fiber glut","bandwidth oversupply","network spending cut"]
    }
  },
  cloud: {
    label: "Cloud & data platforms",
    emoji: "☁️",
    tickers: ["AMZN","MSFT","GOOGL","SNOW","MDB","NET","DDOG","ESTC","CRM"],
    keywords: {
      bullish: ["cloud revenue","aws","azure","google cloud","data warehouse","cloud ai","cloud contract","cloud migration","snowflake","databricks","s3","gcp"],
      bearish: ["cloud spending cut","cloud churn","data breach","cloud outage","aws outage","azure outage"]
    }
  },
  aimodels: {
    label: "AI models & platforms",
    emoji: "🤖",
    tickers: ["MSFT","GOOGL","META","AMZN","SOUN","AI","BBAI","PLTR","OPENAI"],
    keywords: {
      bullish: ["gpt","gemini","llama","claude","ai model","foundation model","ai investment","openai","anthropic","ai partnership","ai revenue","copilot","ai agent","agentic"],
      bearish: ["ai bubble","ai regulation","ai ban","model recall","ai safety law","ai moratorium"]
    }
  },
  applications: {
    label: "AI software & apps",
    emoji: "💻",
    tickers: ["NOW","PLTR","PATH","ASAN","HUBS","ADSK","VEEV","DDOG","ZS","CRWD"],
    keywords: {
      bullish: ["ai software","enterprise ai","ai adoption","ai workflow","automation","ai productivity","ai contract","digital transformation","ai platform deal"],
      bearish: ["enterprise spending cut","software churn","saas slowdown","it budget cut"]
    }
  },
  // Trump-specific sectors kept from original
  energy: {
    label: "Energy & oil",
    emoji: "⛽",
    tickers: ["XOM","CVX","OXY","XLE","COP"],
    keywords: {
      bullish: ["drill","oil","lng","energy independence","fossil fuel","pipeline","fracking","natural gas","unleash energy"],
      bearish: ["green new deal","solar mandate","climate regulation","ev mandate"]
    }
  },
  defense: {
    label: "Defense",
    emoji: "🛡️",
    tickers: ["LMT","RTX","NOC","GD","HII"],
    keywords: {
      bullish: ["military","nato","defense spending","pentagon","strong military","weapons","rebuild military"],
      bearish: ["defense cut","military spending reduction","pentagon budget cut"]
    }
  },
  manufacturing: {
    label: "Manufacturing",
    emoji: "🏭",
    tickers: ["CAT","DE","MMM","XLI","NUE","STLD"],
    keywords: {
      bullish: ["tariffs","made in america","factories","reshoring","buy american","steel tariffs","bring back manufacturing"],
      bearish: ["tariff retaliation","trade war","outsourcing"]
    }
  },
  crypto: {
    label: "Crypto",
    emoji: "₿",
    tickers: ["COIN","MSTR","IBIT","BITO"],
    keywords: {
      bullish: ["bitcoin","crypto","digital currency","blockchain","pro-crypto","strategic reserve","crypto capital"],
      bearish: ["crypto ban","bitcoin crash","crypto regulation","sec crypto"]
    }
  },
};

// ── Signal sources ─────────────────────────────────────────────────────────
const SIGNAL_SOURCES = [
  {
    id: "trump",
    label: "Trump statements",
    emoji: "🦅",
    searchQuery: "Donald Trump latest statements today Truth Social Twitter 2025",
    systemPrompt: `Search for Donald Trump's LATEST statements from the last 6 hours on Truth Social, X, and news. Return ONLY a JSON array of up to 5 items:
[{"source":"Truth Social"|"X / Twitter"|"Speech"|"News","time":"e.g. 2 hours ago","headline":"8-word summary","quote":"actual quote max 150 chars","url":"source url or empty","signalType":"trump"}]
Only return the JSON array.`
  },
  {
    id: "nvidia",
    label: "NVDA / chip news",
    emoji: "🔬",
    searchQuery: "Nvidia AMD semiconductor AI chip news today 2025",
    systemPrompt: `Search for the LATEST Nvidia, AMD, semiconductor, or AI chip news from the last 6 hours. Return ONLY a JSON array of up to 4 items:
[{"source":"Reuters"|"Bloomberg"|"CNBC"|"Earnings"|"News","time":"e.g. 1 hour ago","headline":"8-word summary","quote":"key quote or paraphrase max 150 chars","url":"source url or empty","signalType":"chips"}]
Only return the JSON array.`
  },
  {
    id: "hyperscalers",
    label: "Cloud & capex news",
    emoji: "☁️",
    searchQuery: "Microsoft Google Amazon Meta AI capex data center investment announcement today 2025",
    systemPrompt: `Search for the LATEST Microsoft, Google, Amazon, or Meta AI investment, data center, or cloud news from the last 6 hours. Return ONLY a JSON array of up to 4 items:
[{"source":"Reuters"|"Bloomberg"|"CNBC"|"Earnings"|"News","time":"e.g. 3 hours ago","headline":"8-word summary","quote":"key quote or paraphrase max 150 chars","url":"source url or empty","signalType":"cloud"}]
Only return the JSON array.`
  },
  {
    id: "power",
    label: "Power & energy news",
    emoji: "⚡",
    searchQuery: "data center power electricity nuclear energy grid AI demand news today 2025",
    systemPrompt: `Search for the LATEST news about power, electricity, or energy demand driven by AI and data centers from the last 6 hours. Return ONLY a JSON array of up to 3 items:
[{"source":"Reuters"|"Bloomberg"|"CNBC"|"News","time":"e.g. 4 hours ago","headline":"8-word summary","quote":"key quote or paraphrase max 150 chars","url":"source url or empty","signalType":"power"}]
Only return the JSON array.`
  },
  {
    id: "policy",
    label: "AI policy & regulation",
    emoji: "⚖️",
    searchQuery: "AI regulation policy export controls chips semiconductor law news today 2025",
    systemPrompt: `Search for the LATEST AI regulation, policy, or chip export control news from the last 6 hours. Return ONLY a JSON array of up to 3 items:
[{"source":"Reuters"|"Bloomberg"|"WSJ"|"Gov"|"News","time":"e.g. 5 hours ago","headline":"8-word summary","quote":"key quote or paraphrase max 150 chars","url":"source url or empty","signalType":"policy"}]
Only return the JSON array.`
  },
];

function scoreStatement(text, signalType) {
  const lower = text.toLowerCase();
  const signals = {};

  // Score all layers
  Object.entries(LAYERS).forEach(([layer, def]) => {
    let score = 0;
    (def.keywords.bullish || []).forEach(kw => { if (lower.includes(kw)) score += 2; });
    (def.keywords.bearish  || []).forEach(kw => { if (lower.includes(kw)) score -= 2; });
    if (score !== 0) signals[layer] = {
      direction: score > 0 ? "BUY" : "SELL",
      strength:  Math.min(Math.abs(score) * 20, 100),
      score,
    };
  });

  // Boost confidence for high-urgency words
  const urgency = ["tremendous","massive","incredible","disaster","record","historic","emergency","immediately","billions","trillion","beats","misses","raises","lowers","guidance"]
    .filter(w => lower.includes(w)).length;

  const bull = Object.values(signals).filter(s => s.direction === "BUY").length;
  const bear = Object.values(signals).filter(s => s.direction === "SELL").length;
  const confidence = Math.min((Math.max(bull, bear) * 16) + urgency * 5, 95);
  const sentiment  = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";

  return { signals, sentiment, confidence, bull, bear };
}

// ── Anthropic client ───────────────────────────────────────────────────────
let anthropic;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
  return anthropic;
}

// Retry wrapper with exponential backoff for 429s
async function withRetry(fn, retries = 3, delayMs = 15000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes("429") || err.message?.includes("rate_limit");
      if (is429 && i < retries - 1) {
        const wait = delayMs * (i + 1);
        console.log(`  ⏳ Rate limited — waiting ${wait/1000}s before retry ${i+1}/${retries-1}...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

async function fetchSourceStatements(source) {
  const client = getClient();
  const response = await withRetry(() => client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 1000,
    tools:      [{ type: "web_search_20250305", name: "web_search" }],
    system:     source.systemPrompt,
    messages:   [{ role: "user", content: source.searchQuery }],
  }));
  const textBlock = response.content.find(c => c.type === "text");
  if (!textBlock?.text) return [];
  try {
    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    const items = JSON.parse(clean);
    return Array.isArray(items) ? items.map(i => ({ ...i, sourceId: source.id, sourceLabel: source.label, sourceEmoji: source.emoji })) : [];
  } catch { return []; }
}

async function getInvestmentInsight(item, signals) {
  const client     = getClient();
  const topSignals = Object.entries(signals)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
    .slice(0, 3)
    .map(([s, d]) => `${LAYERS[s]?.label} ${d.direction}`)
    .join(", ") || "none";

  try {
    const response = await withRetry(() => client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 250,
      system:     `You are a razor-sharp AI sector analyst. Given a news item, give ONE specific investment action in 2-3 sentences. Name exact tickers, entry timing (pre-market / at open / wait for dip), and the catalyst. Be concrete. No disclaimers.`,
      messages:   [{ role: "user", content: `Source: ${item.sourceLabel}\nHeadline: "${item.headline}"\nQuote: "${item.quote}"\nTop signals: ${topSignals}.\nWhat is the investment action?` }],
    }));
    return response.content.find(c => c.type === "text")?.text || "";
  } catch { return ""; }
}

async function sendGmailAlert(item, analysis) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: CONFIG.GMAIL_USER, pass: CONFIG.GMAIL_APP_PASSWORD },
  });

  const sentimentEmoji = { bullish: "📈", bearish: "📉", neutral: "➡️" }[analysis.sentiment] || "➡️";

  const topSignalsText = Object.entries(analysis.signals)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
    .slice(0, 5)
    .map(([s, d]) => `  ${LAYERS[s]?.emoji}  ${(LAYERS[s]?.label||s).padEnd(22)} ${d.direction}  (${d.strength}% · ${LAYERS[s]?.tickers.slice(0,3).join(", ")})`)
    .join("\n");

  const subject = `${item.sourceEmoji} AI Signal: ${analysis.sentiment.toUpperCase()} ${analysis.confidence}% — ${item.sourceLabel}`;

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Georgia,serif;color:#dde;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:linear-gradient(135deg,#0a0a18,#001209);border:1px solid #2a2a3a;border-radius:12px;padding:20px 24px;margin-bottom:16px;text-align:center;">
    <div style="font-size:32px;margin-bottom:6px;">${item.sourceEmoji}</div>
    <div style="font-size:18px;font-weight:700;color:#f5e6b0;">AI ECOSYSTEM SIGNAL ENGINE</div>
    <div style="font-size:11px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">${item.sourceLabel}</div>
  </div>
  <div style="background:${analysis.sentiment==="bullish"?"rgba(0,208,132,0.1)":analysis.sentiment==="bearish"?"rgba(255,71,87,0.1)":"rgba(255,165,2,0.1)"};border-left:4px solid ${analysis.sentiment==="bullish"?"#00d084":analysis.sentiment==="bearish"?"#ff4757":"#ffa502"};border-radius:8px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:20px;font-weight:700;color:${analysis.sentiment==="bullish"?"#00d084":analysis.sentiment==="bearish"?"#ff4757":"#ffa502"};">${sentimentEmoji} ${analysis.sentiment.toUpperCase()} — ${analysis.confidence}% confidence</div>
    <div style="font-size:12px;color:#888;margin-top:4px;">${item.time} · ${item.source}</div>
  </div>
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Headline</div>
    <div style="font-size:15px;color:#ccd;line-height:1.6;font-style:italic;">"${item.quote}"</div>
    ${item.url ? `<a href="${item.url}" style="display:inline-block;margin-top:10px;font-size:11px;color:#556;">🔗 Source →</a>` : ""}
  </div>
  ${Object.keys(analysis.signals).length > 0 ? `
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Sector signals</div>
    ${Object.entries(analysis.signals).sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,6).map(([s,d])=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1a1a2a;">
      <div><span style="font-size:15px;">${LAYERS[s]?.emoji}</span> <span style="font-size:13px;color:#ccc;margin-left:6px;">${LAYERS[s]?.label||s}</span> <span style="font-size:10px;color:#556;margin-left:8px;">${(LAYERS[s]?.tickers||[]).slice(0,3).join(" · ")}</span></div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;background:${d.direction==="BUY"?"rgba(0,208,132,0.18)":"rgba(255,71,87,0.18)"};color:${d.direction==="BUY"?"#00d084":"#ff4757"};">${d.direction}</span>
    </div>`).join("")}
  </div>` : ""}
  ${analysis.insight ? `
  <div style="background:rgba(20,10,40,0.8);border:1px solid #2a1a5a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#9b5de5;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">🤖 AI investment action</div>
    <div style="font-size:14px;color:#bbb;line-height:1.7;">${analysis.insight}</div>
  </div>` : ""}
  <div style="font-size:11px;color:#554433;padding:10px 14px;background:rgba(255,165,2,0.05);border-radius:6px;">
    ⚠️ Not financial advice. Educational purposes only. Consult a licensed advisor.
  </div>
</div></body></html>`;

  await transporter.sendMail({
    from:    `"AI Signal Engine" <${CONFIG.GMAIL_USER}>`,
    to:      CONFIG.ALERT_EMAIL,
    subject,
    html:    htmlBody,
  });
  console.log(`📧 Alert → ${CONFIG.ALERT_EMAIL} | ${analysis.sentiment.toUpperCase()} ${analysis.confidence}% | ${item.sourceLabel}`);
}

// ── Main poll ──────────────────────────────────────────────────────────────
const seenQuotes = new Set();
let lastPollTime = null;
let nextPollTime = null;

async function poll() {
  const now = new Date().toLocaleTimeString();
  console.log(`\n[${now}] 🔄 Polling all ${SIGNAL_SOURCES.length} sources...`);

  for (const source of SIGNAL_SOURCES) {
    console.log(`  ${source.emoji} Fetching ${source.label}...`);
    let items = [];
    try {
      items = await fetchSourceStatements(source);
    } catch (err) {
      console.error(`  ❌ ${source.label} failed:`, err.message);
      continue;
    }

    console.log(`  → ${items.length} item(s) found`);

    for (const item of items) {
      const key = (item.quote || item.headline || "").slice(0, 50);
      if (seenQuotes.has(key)) continue;
      seenQuotes.add(key);
      if (seenQuotes.size > 1000) { const first = seenQuotes.values().next().value; seenQuotes.delete(first); }

      const analysis = scoreStatement(item.quote || item.headline || "", item.signalType);
      console.log(`     "${key.slice(0,50)}…" → ${analysis.sentiment} ${analysis.confidence}%`);

      if (analysis.confidence < CONFIG.CONFIDENCE_THRESHOLD || !Object.keys(analysis.signals).length) {
        console.log(`     ↩  Below threshold, skipping.`);
        continue;
      }

      analysis.insight = await getInvestmentInsight(item, analysis.signals);

      try {
        await sendGmailAlert(item, analysis);
      } catch (err) {
        console.error(`  ❌ Gmail send failed:`, err.message);
      }

      await sleep(5000); // gap between insight calls
    }

    await sleep(25000); // 25s gap between sources to stay under token/min limit
  }

  lastPollTime = new Date().toISOString();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startHealthServer() {
  const http = require("http");
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "running", service: "AI Ecosystem Signal Engine", uptime: Math.floor(process.uptime()) + "s", seenCount: seenQuotes.size, sources: SIGNAL_SOURCES.length, layers: Object.keys(LAYERS).length, lastPoll: lastPollTime, nextPoll: nextPollTime }));
  }).listen(port, () => console.log(`🌐 Health check on port ${port}`));
}

async function main() {
  validateConfig();
  console.log("🤖 AI Ecosystem Signal Engine");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📧 Alerts → ${CONFIG.ALERT_EMAIL}`);
  console.log(`🎯 Threshold: ${CONFIG.CONFIDENCE_THRESHOLD}%`);
  console.log(`⏱  Poll every: ${CONFIG.POLL_INTERVAL_MIN} min`);
  console.log(`📡 Sources: ${SIGNAL_SOURCES.map(s=>s.label).join(", ")}`);
  console.log(`📊 Layers: ${Object.keys(LAYERS).length} sectors tracked`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  startHealthServer();
  await poll();

  const intervalMs = CONFIG.POLL_INTERVAL_MIN * 60 * 1000;
  setInterval(async () => {
    await poll();
    nextPollTime = new Date(Date.now() + intervalMs).toISOString();
  }, intervalMs);
  nextPollTime = new Date(Date.now() + intervalMs).toISOString();
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
