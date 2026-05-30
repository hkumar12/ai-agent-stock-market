/**
 * 🦅 Trump Market Oracle — Background Alert Service
 * Polls for Trump statements every 5 minutes, analyses for market signals,
 * and sends Gmail alerts for high-confidence hits.
 *
 * Deploy on Railway / Render / Fly.io — runs 24/7, no browser needed.
 */

const nodemailer = require("nodemailer");
const Anthropic  = require("@anthropic-ai/sdk");

// ── Config (set via environment variables) ─────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY:   process.env.ANTHROPIC_API_KEY,
  GMAIL_USER:          process.env.GMAIL_USER,          // your Gmail address
  GMAIL_APP_PASSWORD:  process.env.GMAIL_APP_PASSWORD,  // Gmail App Password (not your login pw)
  ALERT_EMAIL:         process.env.ALERT_EMAIL || process.env.GMAIL_USER,
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD) || 60,
  POLL_INTERVAL_MIN:   Number(process.env.POLL_INTERVAL_MIN)    || 5,
};

// ── Validate config on startup ─────────────────────────────────────────────
function validateConfig() {
  const missing = ["ANTHROPIC_API_KEY","GMAIL_USER","GMAIL_APP_PASSWORD"].filter(k => !CONFIG[k]);
  if (missing.length) {
    console.error("❌ Missing required env vars:", missing.join(", "));
    console.error("   See README.md for setup instructions.");
    process.exit(1);
  }
}

// ── Sector + keyword definitions ───────────────────────────────────────────
const SECTORS = {
  energy:        { label: "Energy & Oil",   emoji: "⛽", tickers: ["XOM","CVX","OXY","XLE"] },
  defense:       { label: "Defense",        emoji: "🛡️", tickers: ["LMT","RTX","NOC","GD"] },
  tech:          { label: "Big Tech",       emoji: "💻", tickers: ["AAPL","MSFT","GOOGL","META"] },
  finance:       { label: "Financials",     emoji: "🏦", tickers: ["JPM","GS","BAC","XLF"] },
  pharma:        { label: "Pharma",         emoji: "💊", tickers: ["JNJ","PFE","MRK","XPH"] },
  manufacturing: { label: "Manufacturing",  emoji: "🏭", tickers: ["CAT","DE","MMM","XLI"] },
  crypto:        { label: "Crypto",         emoji: "₿",  tickers: ["COIN","MSTR","IBIT"] },
  realestate:    { label: "Real Estate",    emoji: "🏢", tickers: ["SPG","AMT","PLD","IYR"] },
  steel:         { label: "Steel & Metals", emoji: "⚙️", tickers: ["NUE","STLD","CLF","X"] },
  media:         { label: "Media",          emoji: "📺", tickers: ["DJT","NWSA","FOX","PARA"] },
};

const SIGNAL_KW = {
  bullish: {
    energy:        ["drill","oil","lng","energy independence","fossil fuel","pipeline","fracking","natural gas"],
    defense:       ["military","nato","army","weapons","defense spending","pentagon","strong military","rebuild military"],
    tech:          ["silicon valley","innovation","ai","elon","spacex","technology"],
    finance:       ["deregulation","banks","wall street","tax cuts","economy booming","cut regulations"],
    pharma:        ["right to try","cut drug regulations","fda reform","biotech"],
    manufacturing: ["tariffs","made in america","steel","factories","jobs","reshoring","buy american"],
    crypto:        ["bitcoin","crypto","digital currency","blockchain","pro-crypto","strategic reserve"],
    realestate:    ["real estate","housing","construction","build","infrastructure"],
    steel:         ["steel tariffs","metal tariffs","protect steel","american steel"],
    media:         ["truth social","real news"],
  },
  bearish: {
    tech:          ["china ban","antitrust","break up big tech","regulate tech","ban tiktok"],
    pharma:        ["drug prices too high","negotiate drug prices","price gouging pharma"],
    finance:       ["too big to fail","bail out","bad banks"],
    energy:        ["green new deal","solar mandate","climate regulation","ev mandate"],
    manufacturing: ["tariff retaliation","trade war"],
    media:         ["fake news","enemy of the people","corrupt media"],
  },
};

function scoreStatement(text) {
  const lower = text.toLowerCase();
  const signals = {};
  Object.entries(SECTORS).forEach(([sector]) => {
    let score = 0;
    (SIGNAL_KW.bullish[sector] || []).forEach(kw => { if (lower.includes(kw)) score += 2; });
    (SIGNAL_KW.bearish[sector]  || []).forEach(kw => { if (lower.includes(kw)) score -= 2; });
    if (score !== 0) signals[sector] = {
      direction: score > 0 ? "BUY" : "SELL",
      strength:  Math.min(Math.abs(score) * 20, 100),
      score,
    };
  });
  const bull    = Object.values(signals).filter(s => s.direction === "BUY").length;
  const bear    = Object.values(signals).filter(s => s.direction === "SELL").length;
  const urgency = ["tremendous","massive","incredible","disaster","catastrophic","greatest","worst ever","emergency"]
    .filter(w => lower.includes(w)).length;
  const confidence = Math.min((Math.max(bull, bear) * 18) + urgency * 4, 95);
  const sentiment  = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  return { signals, sentiment, confidence, bull, bear };
}

// ── Anthropic client ───────────────────────────────────────────────────────
let anthropic;
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
  return anthropic;
}

// ── Step 1: Fetch latest Trump statements via web search ───────────────────
async function fetchLatestStatements() {
  console.log("🔍 Searching for latest Trump statements...");
  const client = getClient();

  const response = await client.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are a real-time political statement monitor. Search the web for Donald Trump's LATEST statements, posts, or speeches from the last 6 hours across Truth Social, X (Twitter), and major news sources.

Return ONLY a valid JSON array (no markdown fences, no preamble) of up to 5 items:
[{"source":"Truth Social"|"X / Twitter"|"Speech"|"Press Conference"|"News","time":"e.g. 30 minutes ago","headline":"8-word summary","quote":"actual quote max 150 chars","url":"source url or empty string"}]

If no new statements found in last 6 hours, return an empty array: []`,
    messages: [{ role: "user", content: "Search Donald Trump latest statements today Truth Social Twitter news 2025" }],
  });

  const textBlock = response.content.find(c => c.type === "text");
  if (!textBlock?.text) return [];

  try {
    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    const items = JSON.parse(clean);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.warn("⚠️  Could not parse statements JSON:", err.message);
    return [];
  }
}

// ── Step 2: Get AI investment insight for a statement ──────────────────────
async function getInvestmentInsight(item, signals) {
  const client     = getClient();
  const topSignals = Object.entries(signals)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
    .slice(0, 3)
    .map(([s, d]) => `${SECTORS[s]?.label} ${d.direction}`)
    .join(", ") || "none";

  try {
    const response = await client.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 300,
      system:     `You are a razor-sharp political-market analyst. Given a Trump statement, give ONE specific investment action in 2 sentences max. Be concrete: name tickers, entry timing, catalyst. No fluff, no disclaimers.`,
      messages:   [{ role: "user", content: `Trump said on ${item.source}: "${item.quote}"\nTop signals: ${topSignals}. What's the investment action?` }],
    });
    return response.content.find(c => c.type === "text")?.text || "";
  } catch {
    return "";
  }
}

// ── Step 3: Send Gmail alert ───────────────────────────────────────────────
async function sendGmailAlert(item, analysis) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: CONFIG.GMAIL_USER,
      pass: CONFIG.GMAIL_APP_PASSWORD,
    },
  });

  const sentimentEmoji = { bullish: "📈", bearish: "📉", neutral: "➡️" }[analysis.sentiment] || "➡️";

  const topSignalsText = Object.entries(analysis.signals)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
    .slice(0, 5)
    .map(([s, d]) => `  ${SECTORS[s]?.emoji}  ${SECTORS[s]?.label.padEnd(16)} ${d.direction}  (${d.strength}% strength)`)
    .join("\n");

  const subject = `🦅 Trump Signal: ${analysis.sentiment.toUpperCase()} ${analysis.confidence}% — ${item.source}`;

  const textBody = `
🦅 TRUMP MARKET ORACLE — SIGNAL ALERT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${sentimentEmoji} SIGNAL:  ${analysis.sentiment.toUpperCase()}
📊 CONFIDENCE:  ${analysis.confidence}%
📣 SOURCE:      ${item.source}
🕐 TIME:        ${item.time}

💬 STATEMENT:
"${item.quote}"

🎯 SECTOR SIGNALS:
${topSignalsText || "  No strong sector signals detected"}

🤖 AI INVESTMENT ACTION:
${analysis.insight || "No AI insight available"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${item.url ? `🔗 Source: ${item.url}\n` : ""}
⚠️  NOT FINANCIAL ADVICE. Educational purposes only.
    Always consult a licensed financial advisor.
  `.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080f;font-family:Georgia,serif;color:#dde;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#130900,#0a0a18);border:1px solid #2a2a3a;border-radius:12px;padding:20px 24px;margin-bottom:16px;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🦅</div>
    <div style="font-size:20px;font-weight:700;color:#f5e6b0;letter-spacing:1px;">TRUMP MARKET ORACLE</div>
    <div style="font-size:11px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Signal Alert</div>
  </div>

  <!-- Signal badge -->
  <div style="background:${analysis.sentiment==="bullish"?"rgba(0,208,132,0.12)":analysis.sentiment==="bearish"?"rgba(255,71,87,0.12)":"rgba(255,165,2,0.12)"};border:1px solid ${analysis.sentiment==="bullish"?"#00d08440":analysis.sentiment==="bearish"?"#ff475740":"#ffa50240"};border-left:4px solid ${analysis.sentiment==="bullish"?"#00d084":analysis.sentiment==="bearish"?"#ff4757":"#ffa502"};border-radius:10px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:16px;">
    <div style="font-size:32px;">${sentimentEmoji}</div>
    <div>
      <div style="font-size:18px;font-weight:700;color:${analysis.sentiment==="bullish"?"#00d084":analysis.sentiment==="bearish"?"#ff4757":"#ffa502"};">${analysis.sentiment.toUpperCase()} SIGNAL</div>
      <div style="font-size:13px;color:#888;margin-top:2px;">${analysis.confidence}% confidence &nbsp;·&nbsp; ${item.source} &nbsp;·&nbsp; ${item.time}</div>
    </div>
  </div>

  <!-- Quote -->
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Statement</div>
    <div style="font-size:15px;color:#ccd;line-height:1.6;font-style:italic;">"${item.quote}"</div>
    ${item.url ? `<a href="${item.url}" style="display:inline-block;margin-top:10px;font-size:11px;color:#556;text-decoration:none;">🔗 View source →</a>` : ""}
  </div>

  <!-- Sector signals -->
  ${Object.keys(analysis.signals).length > 0 ? `
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Sector Signals</div>
    ${Object.entries(analysis.signals).sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).map(([s,d])=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a2a;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">${SECTORS[s]?.emoji}</span>
          <span style="font-size:13px;color:#ccc;">${SECTORS[s]?.label}</span>
          <span style="font-size:10px;color:#556;">${SECTORS[s]?.tickers.join(" · ")}</span>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;background:${d.direction==="BUY"?"rgba(0,208,132,0.18)":"rgba(255,71,87,0.18)"};color:${d.direction==="BUY"?"#00d084":"#ff4757"};">${d.direction}</span>
      </div>
    `).join("")}
  </div>` : ""}

  <!-- AI Insight -->
  ${analysis.insight ? `
  <div style="background:rgba(20,10,40,0.8);border:1px solid #2a1a5a;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:10px;color:#9b5de5;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🤖 AI Investment Action</div>
    <div style="font-size:14px;color:#bbb;line-height:1.7;">${analysis.insight}</div>
  </div>` : ""}

  <!-- Disclaimer -->
  <div style="font-size:11px;color:#554433;line-height:1.5;padding:12px 16px;background:rgba(255,165,2,0.05);border:1px solid #ffa50220;border-radius:8px;">
    ⚠️ <strong>NOT FINANCIAL ADVICE.</strong> For educational purposes only. Always consult a licensed financial advisor before making investment decisions.
  </div>

</div>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from:    `"🦅 Trump Market Oracle" <${CONFIG.GMAIL_USER}>`,
    to:      CONFIG.ALERT_EMAIL,
    subject,
    text:    textBody,
    html:    htmlBody,
  });

  console.log(`📧 Alert sent → ${CONFIG.ALERT_EMAIL} | ${analysis.sentiment.toUpperCase()} ${analysis.confidence}%`);
}

// ── Main polling loop ──────────────────────────────────────────────────────
const seenQuotes = new Set();

async function poll() {
  const now = new Date().toLocaleTimeString();
  console.log(`\n[${now}] 🔄 Polling...`);

  let statements;
  try {
    statements = await fetchLatestStatements();
  } catch (err) {
    console.error("❌ Failed to fetch statements:", err.message);
    return;
  }

  if (!statements.length) {
    console.log("   No new statements found.");
    return;
  }

  console.log(`   Found ${statements.length} statement(s).`);

  for (const item of statements) {
    const key = (item.quote || item.headline || "").slice(0, 50);
    if (seenQuotes.has(key)) {
      console.log(`   ↩  Already seen: "${key.slice(0,40)}…"`);
      continue;
    }
    seenQuotes.add(key);
    // Keep memory bounded
    if (seenQuotes.size > 500) {
      const first = seenQuotes.values().next().value;
      seenQuotes.delete(first);
    }

    const analysis = scoreStatement(item.quote || item.headline || "");

    console.log(`   📣 [${item.source}] "${(item.quote||"").slice(0,60)}…"`);
    console.log(`      → ${analysis.sentiment.toUpperCase()} | confidence: ${analysis.confidence}% | sectors: ${Object.keys(analysis.signals).length}`);

    if (analysis.confidence < CONFIG.CONFIDENCE_THRESHOLD || !Object.keys(analysis.signals).length) {
      console.log(`      ↩  Below threshold (${CONFIG.CONFIDENCE_THRESHOLD}%), skipping alert.`);
      continue;
    }

    // Get AI insight
    analysis.insight = await getInvestmentInsight(item, analysis.signals);

    // Send Gmail
    try {
      await sendGmailAlert(item, analysis);
    } catch (err) {
      console.error("❌ Gmail send failed:", err.message);
    }

    // Avoid rate-limiting between items
    await sleep(2000);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Health check HTTP server (required by Railway/Render/Fly) ──────────────
function startHealthServer() {
  const http = require("http");
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:    "running",
      service:   "Trump Market Oracle",
      uptime:    Math.floor(process.uptime()) + "s",
      seenCount: seenQuotes.size,
      lastPoll:  lastPollTime,
      nextPoll:  nextPollTime,
    }));
  }).listen(port, () => console.log(`🌐 Health check running on port ${port}`));
}

// ── Entry point ────────────────────────────────────────────────────────────
let lastPollTime = null;
let nextPollTime = null;

async function main() {
  validateConfig();

  console.log("🦅 Trump Market Oracle — Background Service");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📧 Alerts → ${CONFIG.ALERT_EMAIL}`);
  console.log(`🎯 Threshold: ${CONFIG.CONFIDENCE_THRESHOLD}% confidence`);
  console.log(`⏱  Poll every: ${CONFIG.POLL_INTERVAL_MIN} minutes`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  startHealthServer();

  // First poll immediately
  await poll();
  lastPollTime = new Date().toISOString();

  const intervalMs = CONFIG.POLL_INTERVAL_MIN * 60 * 1000;
  setInterval(async () => {
    await poll();
    lastPollTime = new Date().toISOString();
    nextPollTime = new Date(Date.now() + intervalMs).toISOString();
  }, intervalMs);

  nextPollTime = new Date(Date.now() + intervalMs).toISOString();
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
