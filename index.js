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
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD) || 70,  // default 70 — fewer but stronger alerts
  POLL_INTERVAL_MIN:    Number(process.env.POLL_INTERVAL_MIN)    || 30,  // default 30min — set env var to override
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
// Each layer has a hiddenGems array — less-covered tickers with higher upside
// These are specifically surfaced in alerts as the "non-obvious" plays
const LAYERS = {
  power: {
    label:"Power & utilities", emoji:"⚡", etf:"XLU",
    tickers:   ["NEE","CEG","VST","DUK","AES","ETN","GEV"],
    peers:     ["NEE","CEG","VST"],
    hiddenGems:[
      { ticker:"TLN",  why:"Talen Energy — pure-play nuclear power selling directly to data centers, less-covered than CEG" },
      { ticker:"GEV",  why:"GE Vernova — wind/gas turbines, $200B backlog by 2028, only ~2 years old as standalone stock" },
      { ticker:"POWL", why:"Powell Industries — electrical switchgear for data centers and grid, tiny cap, massive order book" },
      { ticker:"WATT", why:"Energous — wireless charging tech for AI edge devices, early stage but strategic" },
      { ticker:"SMR",  why:"NuScale Power — small modular reactor play, Microsoft signed LOI for SMR power supply" },
    ],
  },
  water: {
    label:"Water & cooling", emoji:"💧", etf:"PHO",
    tickers:   ["AWK","WTRG","VRT","SMCI","LIQT"],
    peers:     ["AWK","VRT","SMCI"],
    hiddenGems:[
      { ticker:"ITRI", why:"Itron — smart water meters for data center campuses, barely covered vs VRT" },
      { ticker:"PUMP", why:"ProPetro — liquid cooling infrastructure play, pivoting to data center cooling" },
      { ticker:"CLFD", why:"Clearfield — fiber and thermal management for edge AI deployments" },
      { ticker:"XPEL", why:"Surface protection films used in liquid cooling systems, niche but growing fast" },
    ],
  },
  datacenter: {
    label:"Data center REITs", emoji:"🏢", etf:"XLRE",
    tickers:   ["EQIX","DLR","IRM","AMT","CONE"],
    peers:     ["EQIX","DLR","IRM"],
    hiddenGems:[
      { ticker:"SBAC", why:"SBA Communications — tower REIT pivoting to edge AI compute nodes, undervalued vs peers" },
      { ticker:"UNIT", why:"Uniti Group — fiber network owner, data center connectivity play, deeply undervalued" },
      { ticker:"IIPR", why:"Innovative Industrial — pivoting facilities toward AI compute colocation" },
      { ticker:"RXST", why:"RxSight — occupies a niche in specialized data facilities, small float" },
    ],
  },
  chips: {
    label:"Chips & semis", emoji:"🔬", etf:"SOXX",
    tickers:   ["NVDA","AMD","AVGO","AMAT","ASML","TSM","MRVL","MU"],
    peers:     ["NVDA","AMD","AVGO"],
    hiddenGems:[
      { ticker:"PLAB", why:"Photronics — makes photomasks for AI chips, P/E 14 vs sector avg 35, revenues beat by 5.5% Q3 2025" },
      { ticker:"SKYT", why:"SkyWater Technology — US-based quantum/AI chip foundry, only domestic advanced fab play" },
      { ticker:"AEHR", why:"AEHR Test Systems — wafer-level burn-in testing for AI chips, every NVDA chip goes through testing" },
      { ticker:"CRDO", why:"Credo Technology — high-speed connectivity chips for AI clusters, outperforming but still cheap" },
      { ticker:"SMTC", why:"Semtech — analog chips for data center optical interconnects, trading below historical multiples" },
      { ticker:"ENTG", why:"Entegris — chip materials/chemicals supplier, high quality at average multiples per Fabricated Knowledge" },
      { ticker:"TSEM", why:"Tower Semiconductor — specialty foundry for analog AI chips, NVDA-like demand but fraction of valuation" },
    ],
  },
  networking: {
    label:"Networking & fiber", emoji:"🌐", etf:"IGN",
    tickers:   ["CSCO","ANET","LITE","CIEN","MRVL","COHR"],
    peers:     ["CSCO","ANET","CIEN"],
    hiddenGems:[
      { ticker:"COHR", why:"Coherent — optical transceivers for 400G/800G AI clusters, analysts call it best optics play for 2026" },
      { ticker:"LITE", why:"Lumentum — optical components, trading cheap vs COHR despite similar exposure" },
      { ticker:"IIVI", why:"II-VI / Coherent merger play — laser components inside every AI interconnect" },
      { ticker:"CALX", why:"Calix — AI-powered broadband platforms, strong Q4 2025, Zacks Strong Buy, overlooked vs bigger names" },
      { ticker:"LUMN", why:"Lumen Technologies — massive fiber network, debt restructured, AI backbone demand tailwind" },
      { ticker:"FN",   why:"Fabrinet — contract manufacturer for optical networking, makes COHR and LITE components" },
    ],
  },
  cloud: {
    label:"Cloud & data", emoji:"☁️", etf:"WCLD",
    tickers:   ["AMZN","MSFT","GOOGL","SNOW","MDB","NET","DDOG"],
    peers:     ["AMZN","MSFT","GOOGL"],
    hiddenGems:[
      { ticker:"ESTC", why:"Elastic NV — vector search database, every AI app needs it, less covered than SNOW/MDB" },
      { ticker:"CFLT", why:"Confluent — real-time data streaming, critical AI pipeline plumbing, down 40% from highs" },
      { ticker:"SMAR", why:"Smartsheet — AI workflow automation, enterprise, trades at massive discount to NOW" },
      { ticker:"TDC",  why:"Teradata — legacy data warehouse pivoting to AI, strong Q4 2025 earnings, Zacks Buy" },
      { ticker:"INOD", why:"Innodata — AI data services for Big Tech GenAI training, small cap, 51% revenue growth in 2025" },
    ],
  },
  aimodels: {
    label:"AI models", emoji:"🤖", etf:"AIQ",
    tickers:   ["MSFT","GOOGL","META","PLTR","AI","BBAI"],
    peers:     ["MSFT","GOOGL","META"],
    hiddenGems:[
      { ticker:"BBAI", why:"BigBear.ai — defense AI analytics, tiny float, government contracts, asymmetric upside" },
      { ticker:"RDNT", why:"RadNet — AI medical imaging analysis, healthcare AI is under-owned vs enterprise AI" },
      { ticker:"RXRX", why:"Recursion Pharma — AI drug discovery, NVDA invested directly, high risk/reward" },
      { ticker:"GFAI", why:"Guardforce AI — AI security robotics, tiny cap, growing Asia contracts" },
      { ticker:"SOUN", why:"SoundHound AI — voice AI, automotive + food service, small float = volatile but high upside" },
    ],
  },
  applications: {
    label:"AI software", emoji:"💻", etf:"IGV",
    tickers:   ["NOW","PLTR","PATH","DDOG","ZS","CRWD"],
    peers:     ["NOW","PLTR","CRWD"],
    hiddenGems:[
      { ticker:"FIVN", why:"Five9 — cloud contact center, 100% AI attach rate on enterprise deals, single-digit P/E after selloff" },
      { ticker:"JAMF", why:"JAMF — Apple device management + AI security, IPO overvaluation gone, now trading below growth rate" },
      { ticker:"ASAN", why:"Asana — AI project management, deeply discounted vs NOW despite similar AI workflow exposure" },
      { ticker:"PATH", why:"UiPath — RPA automation, P/E 30 vs NOW at 60, same enterprise AI story at half the price" },
      { ticker:"RDVT", why:"Red Violet — AI-powered identity verification, tiny cap, profitable, under the radar" },
    ],
  },
  energy: {
    label:"Energy & oil", emoji:"⛽", etf:"XLE",
    tickers:   ["XOM","CVX","OXY","COP"],
    peers:     ["XOM","CVX","OXY"],
    hiddenGems:[
      { ticker:"DINO", why:"HF Sinclair — refining + renewables, AI-driven logistics optimization, cheap vs majors" },
      { ticker:"BATL", why:"Battalion Oil — small independent, high leverage to oil price moves" },
      { ticker:"KRP",  why:"Kimbell Royalty — royalty play on AI data center energy demand, no capex risk" },
    ],
  },
  defense: {
    label:"Defense", emoji:"🛡️", etf:"ITA",
    tickers:   ["LMT","RTX","NOC","GD","HII"],
    peers:     ["LMT","RTX","NOC"],
    hiddenGems:[
      { ticker:"KTOS", why:"Kratos Defense — drone AI and autonomous systems, small cap, massive DoD contract pipeline" },
      { ticker:"RCAT", why:"Red Cat Holdings — military drone swarms, tiny float, high risk/reward on defense AI" },
      { ticker:"AJRD", why:"Aerojet Rocketdyne — rocket propulsion for hypersonics, sole-source DoD contracts" },
      { ticker:"CACI", why:"CACI International — government AI analytics, steady grower, under-covered vs big primes" },
    ],
  },
  manufacturing: {
    label:"Manufacturing", emoji:"🏭", etf:"XLI",
    tickers:   ["CAT","DE","NUE","STLD","ETN"],
    peers:     ["CAT","DE","NUE"],
    hiddenGems:[
      { ticker:"IESC", why:"IES Holdings — electrical contractors building AI data centers, tiny float, explosive backlog" },
      { ticker:"MYRG", why:"MYR Group — electrical construction for data centers and grid, small cap, order book surging" },
      { ticker:"PRIM", why:"Primoris Services — infrastructure construction, data center grid connections, cheap valuation" },
      { ticker:"PLFL", why:"Preformed Line Products — grid modernization hardware, 21% YoY revenue growth, expanding in Europe" },
    ],
  },
  crypto: {
    label:"Crypto", emoji:"₿", etf:"BITO",
    tickers:   ["COIN","MSTR","IBIT","CLSK"],
    peers:     ["COIN","MSTR","IBIT"],
    hiddenGems:[
      { ticker:"CLSK", why:"CleanSpark — Bitcoin miner pivoting to AI-ready data center provider, cheap power PPAs" },
      { ticker:"RIOT", why:"Riot Platforms — largest US Bitcoin miner, converting mining sites to AI compute" },
      { ticker:"HUT",  why:"Hut 8 — Canadian miner with US data center expansion, lower profile than MSTR" },
      { ticker:"IREN", why:"Iris Energy — Australian miner building high-performance AI compute clusters" },
    ],
  },
  nuclear: {
    label:"Nuclear & uranium", emoji:"☢️", etf:"NLR",
    tickers:   ["CEG","CCJ","UEC","UUUU","NNE"],
    peers:     ["CEG","CCJ","NNE"],
    hiddenGems:[
      { ticker:"UUUU", why:"Energy Fuels — only US rare earth + uranium producer, SMR fuel supply play" },
      { ticker:"UEC",  why:"Uranium Energy Corp — search interest +174% YoY, pure-play US uranium, no debt" },
      { ticker:"NNE",  why:"Nano Nuclear Energy — micro nuclear reactor designer, early stage, Microsoft/Google PPA tailwind" },
      { ticker:"OKLO", why:"Oklo — Sam Altman-backed micro nuclear, OpenAI data center power deal rumors, high risk/reward" },
      { ticker:"BWXT", why:"BWX Technologies — makes nuclear components for US Navy and commercial reactors, steady compounder" },
    ],
  },
  macro: {
    label:"Macro / rates", emoji:"📊", etf:"SPY",
    tickers:   ["TLT","GLD","DXY","SPY","QQQ"],
    peers:     ["SPY","QQQ","TLT"],
    hiddenGems:[
      { ticker:"BITX", why:"2x Bitcoin ETF — for macro risk-on signals with high risk tolerance" },
      { ticker:"TQQQ", why:"3x QQQ — aggressive leveraged play on AI/tech macro tailwinds" },
      { ticker:"SOXL", why:"3x Semiconductor ETF — leveraged chip play for high-confidence chip signals" },
    ],
  },
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

// ── Negation detector ─────────────────────────────────────────────────────
// Returns true if a keyword appears right after a negation word in the text
function isNegated(text, keyword) {
  const negations = ["not","no","never","without","unlikely","fails","failed","missed","below","despite","against","halt","ban","blocked","rejected","cancelled"];
  const idx = text.indexOf(keyword);
  if (idx === -1) return false;
  const before = text.slice(Math.max(0, idx - 40), idx).toLowerCase();
  return negations.some(n => before.includes(n));
}

// ── Keyword density scorer ─────────────────────────────────────────────────
// More matches = exponentially stronger signal, negations cancel hits
function densityScore(text, keywords) {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw) && !isNegated(lower, kw)) hits++;
  }
  // Exponential: 1 hit=1, 2 hits=3, 3 hits=6, 4 hits=10 (triangular numbers)
  return hits * (hits + 1) / 2;
}

// ── Source credibility weight ──────────────────────────────────────────────
function sourceWeight(signalType) {
  const weights = {
    earnings: 1.4,   // official earnings = highest credibility
    macro:    1.3,   // Fed/CPI = market-moving by definition
    options:  1.2,   // institutional money talking
    chips:    1.1,   // direct sector news
    cloud:    1.1,
    power:    1.0,
    policy:   1.0,
    trump:    0.9,   // political rhetoric — real but noisier
    reddit:   0.7,   // sentiment signal, not fundamental
  };
  return weights[signalType] || 1.0;
}

// ── Cross-sector confirmation bonus ───────────────────────────────────────
// When multiple DIFFERENT sectors all point the same direction, confidence rises sharply
function crossSectorBonus(sectorCount) {
  if (sectorCount >= 4) return 25;
  if (sectorCount === 3) return 15;
  if (sectorCount === 2) return 7;
  return 0;
}

// ── Magnitude detector ────────────────────────────────────────────────────
// Looks for numbers that imply large financial scale
function magnitudeBonus(text) {
  const lower = text.toLowerCase();
  let bonus = 0;
  // Dollar amounts in billions/trillions
  if (/\$[\d.]+\s*(billion|trillion|b\b|t\b)/i.test(text)) bonus += 8;
  // % beats/misses
  const pctMatch = text.match(/(\d+)%/g);
  if (pctMatch) {
    const maxPct = Math.max(...pctMatch.map(p => parseInt(p)));
    if (maxPct >= 20) bonus += 10;
    else if (maxPct >= 10) bonus += 6;
    else if (maxPct >= 5)  bonus += 3;
  }
  // Explicit magnitude words with context
  const magnitudeWords = {
    "record":12, "historic":10, "all-time":12, "largest ever":14,
    "beats":8, "misses":8, "raised guidance":12, "lowered guidance":12,
    "surprise":7, "unexpected":7, "shock":8, "emergency":6,
    "billion":5, "trillion":8, "massive":4, "unprecedented":8,
  };
  for (const [word, pts] of Object.entries(magnitudeWords)) {
    if (lower.includes(word) && !isNegated(lower, word)) bonus += pts;
  }
  return Math.min(bonus, 30); // cap magnitude bonus at 30pts
}

// ── Main scoring function ──────────────────────────────────────────────────
function scoreStatement(text, signalType = "news") {
  const lower = text.toLowerCase();
  const signals = {};

  // Score each sector with density (not flat +2 per keyword)
  Object.entries(LAYERS).forEach(([layer]) => {
    const bullScore = densityScore(text, SIGNAL_KW.bullish[layer] || []);
    const bearScore = densityScore(text, SIGNAL_KW.bearish[layer] || []);
    const netScore  = bullScore - bearScore;
    if (netScore !== 0) {
      // Strength = how many keywords fired relative to total available (capped 100)
      const totalKw  = (SIGNAL_KW.bullish[layer]||[]).length + (SIGNAL_KW.bearish[layer]||[]).length;
      const strength = Math.min(Math.round((Math.abs(netScore) / Math.max(totalKw * 0.3, 1)) * 100), 100);
      signals[layer] = { direction: netScore > 0 ? "BUY" : "SELL", strength, score: netScore };
    }
  });

  const bull = Object.values(signals).filter(s => s.direction==="BUY").length;
  const bear = Object.values(signals).filter(s => s.direction==="SELL").length;
  const dominant = Math.max(bull, bear);
  const sentiment = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";

  // ── Multi-factor confidence calculation ──────────────────────────────────
  //
  // Factor 1: Keyword density (0-40pts)
  //   Based on strongest single sector score, scaled to 40
  const topSectorScore = Object.values(signals).reduce((max, s) => Math.max(max, Math.abs(s.score)), 0);
  const densityPts = Math.min(topSectorScore * 6, 40);

  // Factor 2: Cross-sector confirmation (0-25pts)
  //   Multiple sectors aligning = much stronger signal
  const crossPts = crossSectorBonus(dominant);

  // Factor 3: Magnitude of the news (0-30pts)
  //   Dollar amounts, % beats, magnitude words
  const magnitudePts = magnitudeBonus(text);

  // Factor 4: Source credibility weight (multiplier 0.7x-1.4x)
  const weight = sourceWeight(signalType);

  // Factor 5: Penalty for mixed signals (bull AND bear sectors firing)
  const mixPenalty = (bull > 0 && bear > 0) ? Math.min(bull, bear) * 5 : 0;

  const rawScore   = (densityPts + crossPts + magnitudePts - mixPenalty) * weight;
  const confidence = Math.min(Math.round(rawScore), 95);

  // Debug breakdown
  const breakdown = {
    densityPts: Math.round(densityPts),
    crossPts,
    magnitudePts,
    mixPenalty,
    sourceWeight: weight,
    rawBeforeWeight: Math.round(densityPts + crossPts + magnitudePts - mixPenalty),
  };

  return { signals, sentiment, confidence, bull, bear, breakdown };
}

// ── Supply chain ripple finder ─────────────────────────────────────────────
// Returns hardcoded supply chain plays + hidden gems from triggered layers
function findSupplyChainRipple(signals) {
  const ripples = [];
  const seen = new Set();

  const triggeredTickers = Object.entries(signals)
    .filter(([,d]) => d.direction === "BUY")
    .flatMap(([s]) => LAYERS[s]?.tickers || []);

  // Hardcoded supply chain relationships
  for (const ticker of triggeredTickers) {
    const map = SUPPLY_CHAIN_MAP[ticker];
    if (!map) continue;
    const all = [
      ...(map.suppliers     || []).map(d => ({ ...d, relationship: "supplier to" })),
      ...(map.customers     || []).map(d => ({ ...d, relationship: "customer of" })),
      ...(map.beneficiaries || []).map(d => ({ ...d, relationship: "beneficiary of" })),
    ];
    for (const dep of all) {
      if (!seen.has(dep.ticker)) {
        seen.add(dep.ticker);
        ripples.push({ ...dep, parent: ticker });
      }
    }
  }

  // Add hidden gems from triggered layers (these are the less-obvious plays)
  const triggeredLayers = Object.entries(signals)
    .filter(([,d]) => d.direction === "BUY")
    .map(([s]) => s);

  for (const layer of triggeredLayers) {
    for (const gem of (LAYERS[layer]?.hiddenGems || [])) {
      if (!seen.has(gem.ticker)) {
        seen.add(gem.ticker);
        ripples.push({
          ticker: gem.ticker,
          reason: gem.why,
          relationship: "hidden gem in",
          parent: layer,
          isHiddenGem: true,
        });
      }
    }
  }

  return ripples.slice(0, 10);
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
  {
    id:"congress", label:"Congress trades", emoji:"🏛️",
    searchQuery:"Congress stock trade disclosure STOCK Act purchase sale today 2025 Pelosi senator representative",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for the latest US Congress member stock trade disclosures (STOCK Act filings) and return up to 4 items:
[{"source":"STOCK Act","time":"1 day ago","headline":"Nancy Pelosi buys NVDA calls","quote":"brief description of trade max 150 chars","url":"","signalType":"congress","ticker":"NVDA","member":"Nancy Pelosi","party":"D","transaction":"purchase","amount":"$250k-$500k","committee":"relevant committee if known"}]
If nothing found return: []`
  },
  {
    id:"insiders", label:"CEO/insider buying", emoji:"👔",
    searchQuery:"CEO CFO insider buying SEC Form 4 stock purchase exec buy own shares today 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest SEC Form 4 insider purchases where executives are buying their OWN company stock (not sales) and return up to 4 items:
[{"source":"SEC Form 4","time":"2 hours ago","headline":"NVDA CEO Jensen Huang buys $5M stock","quote":"brief description max 150 chars","url":"","signalType":"insider","ticker":"NVDA","insider":"Jensen Huang","role":"CEO","transaction":"purchase","value":"$5M","shares":"12,500"}]
Only include purchases not sales. If nothing found return: []`
  },
  {
    id:"smartmoney", label:"Hedge fund & 13F signals", emoji:"🦈",
    searchQuery:"Warren Buffett Berkshire 13F hedge fund Ackman Burry Druckenmiller ARK Cathie Wood buy position 2025",
    systemPrompt:`Respond with ONLY a raw JSON array starting with [ and ending with ]. No headings, no markdown, no explanation. Search for latest Buffett/Berkshire, Bill Ackman, Michael Burry, Stanley Druckenmiller, David Tepper, or ARK Invest position changes or 13F filings and return up to 4 items:
[{"source":"13F Filing","time":"2 days ago","headline":"Buffett adds $2B Apple position","quote":"brief description max 150 chars","url":"","signalType":"smartmoney","ticker":"AAPL","investor":"Warren Buffett","fund":"Berkshire Hathaway","action":"added","value":"$2B","conviction":"high"}]
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
    model:"claude-haiku-4-5", max_tokens:500,  // Haiku = 20x cheaper than Sonnet for fetching
    tools:[{ type:"web_search_20250305", name:"web_search" }],
    system:[{
      type:"text",
      text: source.systemPrompt,
      cache_control:{ type:"ephemeral" },
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
      model:"claude-haiku-4-5", max_tokens:300,
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
  if (marketCtxCache && (Date.now() - marketCtxTime) < 60 * 60 * 1000) {
    console.log("     💾 Market context from local cache (60min TTL)");
    return marketCtxCache;
  }
  const etfs = [...new Set(topSectors.map(s => LAYERS[s]?.etf).filter(Boolean))].slice(0,3);
  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-haiku-4-5", max_tokens:150,
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
      model:"claude-haiku-4-5", max_tokens:200,
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

  const smartMoneyCtx = item.smartMoneyContext
    ? `\nSMART MONEY DETAIL: ${item.smartMoneyContext}`
    : "";

  const convergenceCtx = scored.convergence
    ? `\nCONVERGENCE ALERT: ${scored.convergence.summary}. Multiple smart money sources aligning is one of the rarest and strongest signals. Add +${scored.convergence.convergenceBonus} to conviction score.`
    : "";

  const prompt = `
INVESTOR PROFILE: ${INVESTOR_PROFILE.risk} | ${INVESTOR_PROFILE.horizon} | ${INVESTOR_PROFILE.style}

SOURCE: ${item.sourceLabel} (${item.signalType}) — ${item.time}
HEADLINE: ${item.headline}
QUOTE: "${item.quote}"
${articleText ? `\nARTICLE EXCERPT:\n${articleText.slice(0,1200)}` : ""}
${earningsContext}${redditContext}${optionsContext}${macroContext}${smartMoneyCtx}${convergenceCtx}

SECTOR SIGNALS: ${sectorSignals}

MARKET CONTEXT: ${marketSummary}

PEER COMPARISON:
${peerSummary}

SUPPLY CHAIN RIPPLE (companies that will also be affected):
${rippleSummary}

Provide a smart aggressive investor analysis with these exact sections:
1. SUMMARY (2 sentences — what happened and why it matters, include WHO made the trade if smart money source)
2. SMART MONEY CONTEXT (1 sentence — what does this tell us about what insiders/congress/funds know?)
3. MARKET CONTEXT (1 sentence — is timing good given SPY/VIX/upcoming events?)
4. OBVIOUS PLAY (large cap play — name it, give target, keep brief — everyone already knows this)
5. HIDDEN GEM (small/mid-cap most investors miss — ticker, why it benefits MORE on % basis, price target, specific catalyst)
6. SUPPLY CHAIN PLAY (2nd/3rd order company in dependency chain, even less obvious than hidden gem)
7. RISK (single biggest risk to this thesis)
8. CONVICTION: [score 1-100] — include convergence bonus if multiple smart money sources aligned

Spend most analysis on sections 5 and 6. Smart money signals (insider buys, congress trades, hedge fund moves) are the most powerful inputs — prioritise them. Be specific: exact tickers, price targets, % upside.`;

  try {
    const response = await withRetry(() => getClient().messages.create({
      model:"claude-sonnet-4-6", max_tokens:350,  // was 800 — cut verbosity in half
      system:[{
        type:"text",
        text:`You are an aggressive growth investor analyst. Profile: high risk tolerance, 1-3 month horizon, looking for asymmetric upside.

CORE RULE: Never just recommend NVDA, MSFT, AMZN, GOOGL as your primary play. Everyone knows those. Your job is to find the NON-OBVIOUS plays with higher % upside.

Hidden gem framework (use these when relevant signals fire):
- NVDA/chip signal: PLAB (photomasks P/E 14), AEHR (chip testing), CRDO (connectivity), TSEM (specialty foundry), FN (Fabrinet), ENTG (materials)
- Data center signal: POWL (switchgear tiny cap), IESC (electrical contractors), MYRG (grid construction), PLFL (grid hardware 21% YoY growth)
- Power/nuclear signal: UEC (uranium +174% search interest), GEV (GE Vernova turbines $200B backlog), NNE (micro nuclear), OKLO (Sam Altman SMR), BWXT (naval nuclear compounder)
- Networking signal: FN (Fabrinet makes the components), COHR (optics), SMTC (analog cheap), CALX (broadband AI Zacks Strong Buy), LUMN (fiber backbone restructured)
- Defense signal: KTOS (drone AI small cap), RCAT (military drones tiny float), CACI (gov analytics steady), AJRD (propulsion sole-source)
- Cloud/AI signal: INOD (AI data services 51% revenue growth), CFLT (streaming pipeline), ESTC (vector search), FIVN (contact center AI single-digit PE)
- Crypto signal: CLSK (CleanSpark pivoting to AI data centers), IREN (Iris Energy compute), HUT (Hut 8 US expansion)

Give specific, actionable analysis. Name exact tickers, price targets, % upside. Be concrete.`,
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

  // ── Extract just the key sections from analysis ───────────────────────
  const lines = analysis.split("\n").filter(l => l.trim());
  const getSection = (num) => {
    const idx = lines.findIndex(l => l.match(new RegExp(`^${num}\.`)));
    if (idx === -1) return "";
    // grab up to 2 lines after the header
    return lines.slice(idx, idx+3).join(" ").replace(/^\d+\.\s*/,"").slice(0,200);
  };

  const hiddenGem   = getSection(5) || getSection(4);
  const supplyChain = getSection(6) || getSection(5);
  const risk        = getSection(7) || getSection(6);

  // Hidden gems and supply chain tickers (3 max each)
  const gems  = ripples.filter(r =>  r.isHiddenGem).slice(0,3).map(r=>r.ticker).join(" · ");
  const chain = ripples.filter(r => !r.isHiddenGem).slice(0,3).map(r=>r.ticker).join(" · ");

  // ── Build clean, scannable message ───────────────────────────────────
  const parts = [
    `${se} *${scored.sentiment.toUpperCase()}* — ${scored.confidence}%${conviction ? ` · ${conviction}/100` : ""} ${item.sourceEmoji}`,
    `*${item.sourceLabel}* · ${item.time}${item.ticker ? ` · $${item.ticker}` : ""}`,
    ``,
    `_"${(item.quote||"").slice(0,160)}"_`,
    ``,
  ];

  if (scored.convergence) {
    parts.push(`🎯 *Convergence:* ${scored.convergence.uniqueSources.join(" + ")} all bullish`);
    parts.push(``);
  }

  if (scored.aiScreen?.reasoning) {
    parts.push(`💡 ${scored.aiScreen.reasoning}`);
    parts.push(``);
  }

  if (hiddenGem)   parts.push(`💎 *Hidden gem:* ${hiddenGem}`);
  if (supplyChain) parts.push(`🔗 *Supply chain:* ${supplyChain}`);
  if (risk)        parts.push(`⚠️ *Risk:* ${risk}`);

  parts.push(``);

  if (gems)  parts.push(`💎 ${gems}`);
  if (chain) parts.push(`🔗 ${chain}`);

  if (item.url) parts.push(`\n🔗 [Source](${item.url})`);
  parts.push(`_Not financial advice_`);

  const msg = parts.filter(p => p !== undefined).join("\n");

  for (const chatId of CONFIG.TELEGRAM_CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ chat_id:chatId, text:msg, parse_mode:"Markdown", disable_web_page_preview:true }),
      });
      const data = await res.json();
      if (data.ok) console.log(`📲 Telegram → ${chatId} ✅`);
      else {
        // Fallback without markdown
        await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ chat_id:chatId, text:msg.replace(/[*_`\[\]]/g,""), disable_web_page_preview:true }),
        });
        console.log(`📲 Telegram → ${chatId} ✅ (plain text fallback)`);
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

  const regularRipplesList = ripples.filter(r => !r.isHiddenGem).slice(0,4);
  const hiddenGemsList     = ripples.filter(r =>  r.isHiddenGem).slice(0,5);
  const ripplesHtml = regularRipplesList.length ? regularRipplesList.map(r=>`
    <div style="padding:7px 0;border-bottom:1px solid #1a1a2a;">
      <strong style="color:#c8960a">${r.ticker}</strong>
      <span style="color:#888;font-size:11px;margin-left:6px;">${r.relationship} ${r.parent}</span>
      <div style="color:#aaa;font-size:12px;margin-top:2px;">${r.reason}</div>
    </div>`).join("") : "";
  const hiddenGemsHtml = hiddenGemsList.length ? hiddenGemsList.map(r=>`
    <div style="padding:7px 0;border-bottom:1px solid #1a1a2a;">
      <strong style="color:#00d084">${r.ticker}</strong>
      <span style="color:#888;font-size:11px;margin-left:6px;">💎 non-obvious play</span>
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
    ${scored.convergence?`<div style="margin-top:8px;padding:6px 10px;background:rgba(200,150,10,0.15);border-radius:6px;font-size:12px;color:#c8960a;">🎯 CONVERGENCE: ${scored.convergence.summary}</div>`:""}
  </div>
  <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;">
    <div style="font-size:11px;color:#556;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Signal</div>
    <div style="font-size:14px;color:#ccd;font-style:italic;">"${item.quote}"</div>
    ${item.url?`<a href="${item.url}" style="font-size:11px;color:#556;display:inline-block;margin-top:8px;">🔗 Source →</a>`:""}
  </div>
  ${topSignalsHtml?`<div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a3a;border-radius:10px;padding:14px 18px;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;">${topSignalsHtml}</table></div>`:""}
  ${ripplesHtml?`<div style="background:rgba(200,150,10,0.07);border:1px solid #c8960a30;border-radius:10px;padding:14px 18px;margin-bottom:14px;"><div style="font-size:11px;color:#c8960a;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🔗 Supply Chain Plays</div>${ripplesHtml}</div>`:""}
  ${hiddenGemsHtml?`<div style="background:rgba(0,208,132,0.06);border:1px solid #00d08430;border-radius:10px;padding:14px 18px;margin-bottom:14px;"><div style="font-size:11px;color:#00d084;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">💎 Hidden Gem Plays — Less Obvious, Higher % Upside</div>${hiddenGemsHtml}</div>`:""}
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

// ── Smart money convergence tracker ───────────────────────────────────────
// Tracks when multiple "smart money" sources pile into the same ticker.
// Congress + insider + hedge fund all buying = extremely high conviction.
const convergenceMap = new Map(); // ticker -> {sources, timestamps, signals}

function recordSmartMoneySignal(ticker, sourceType, sentiment, item) {
  if (!ticker) return;
  const key = ticker.toUpperCase();
  if (!convergenceMap.has(key)) {
    convergenceMap.set(key, { ticker: key, sources: [], signals: [], firstSeen: Date.now() });
  }
  const entry = convergenceMap.get(key);
  // Only keep last 7 days worth of signals
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  entry.sources = entry.sources.filter(s => s.ts > cutoff);

  const sourceLabel = {
    congress:   "Congress member",
    insider:    "Company insider",
    smartmoney: "Hedge fund",
    options:    "Options flow",
  }[sourceType] || sourceType;

  entry.sources.push({
    type: sourceType, label: sourceLabel,
    member: item.member || item.insider || item.investor || "",
    sentiment, ts: Date.now(),
  });
  entry.signals.push({ sourceType, sentiment, time: new Date().toISOString() });
}

function checkConvergence(ticker) {
  if (!ticker) return null;
  const entry = convergenceMap.get(ticker.toUpperCase());
  if (!entry) return null;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = entry.sources.filter(s => s.ts > cutoff);
  const bullish = recent.filter(s => s.sentiment === "bullish");
  const bearish = recent.filter(s => s.sentiment === "bearish");

  const uniqueBullSources = [...new Set(bullish.map(s => s.type))];
  const uniqueBearSources = [...new Set(bearish.map(s => s.type))];

  // Convergence requires at least 2 different smart money source types
  if (uniqueBullSources.length >= 2) {
    const bonus = uniqueBullSources.length >= 3 ? 20 : 10;
    return {
      direction: "bullish",
      sources: bullish,
      uniqueSources: uniqueBullSources,
      convergenceBonus: bonus,
      summary: `${uniqueBullSources.length} smart money sources bullish on ${ticker}: ${bullish.map(s=>`${s.label}${s.member?" ("+s.member+")":""}`).join(", ")}`,
    };
  }
  if (uniqueBearSources.length >= 2) {
    return {
      direction: "bearish",
      sources: bearish,
      uniqueSources: uniqueBearSources,
      convergenceBonus: 10,
      summary: `${uniqueBearSources.length} smart money sources bearish on ${ticker}: ${bearish.map(s=>`${s.label}${s.member?" ("+s.member+")":""}`).join(", ")}`,
    };
  }
  return null;
}

// ── Smarter analysis additions ─────────────────────────────────────────────
// Extra context builders used in getDeepAnalysis

function buildSmartMoneyContext(item) {
  const lines = [];

  if (item.signalType === "congress") {
    lines.push(`CONGRESS TRADE: ${item.member||"Unknown"} (${item.party||"?"}) ${item.transaction||"traded"} ${item.ticker||""} worth ${item.amount||"unknown amount"}.`);
    if (item.committee) lines.push(`Committee assignment: ${item.committee} — potential insider knowledge angle.`);
    lines.push(`Historical context: Congress members outperform S&P 500 by avg 6-12% annually. Pelosi portfolio up 18% in 2025.`);
  }

  if (item.signalType === "insider") {
    lines.push(`INSIDER BUY: ${item.insider||"Executive"} (${item.role||"insider"}) purchased ${item.shares||""} shares of ${item.ticker||""} worth ${item.value||"unknown"}.`);
    lines.push(`Insider buys are one of the strongest bullish signals — executives rarely buy their own stock unless they expect it to rise.`);
  }

  if (item.signalType === "smartmoney") {
    lines.push(`SMART MONEY: ${item.investor||"Hedge fund"} (${item.fund||""}) ${item.action||"changed position"} in ${item.ticker||""} worth ${item.value||"unknown"}.`);
    lines.push(`Conviction level: ${item.conviction||"unknown"}. 13F filings are 45-day lagged — price may have already moved, look for entry on dips.`);
  }

  return lines.join(" ");
}

// ── AI Pre-screener ───────────────────────────────────────────────────────
// Replaces keyword gating. Haiku reads the statement and returns a structured
// assessment — catches things keywords never could (Dell example, negations,
// unknown companies, implicit sector plays, presidential endorsements etc.)
async function aiPreScreen(item) {
  const fullText = [item.headline, item.quote].filter(Boolean).join(" — ");
  try {
    const response = await withRetry(() => getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,  // was 400 — JSON response only needs ~150 tokens
      system: [{
        type: "text",
        cache_control: { type: "ephemeral" },
        text: `You are a financial signal pre-screener for an aggressive growth investor (1-3 month horizon).

Analyse the news item and return ONLY a raw JSON object (no markdown, no preamble):
{
  "is_market_moving": true|false,
  "confidence": 0-100,
  "sentiment": "bullish"|"bearish"|"neutral",
  "reasoning": "1 sentence why",
  "primary_tickers": ["TICK1","TICK2"],
  "hidden_gem_tickers": ["TICK3","TICK4"],
  "ripple_tickers": ["TICK5","TICK6"],
  "sectors": ["chips","cloud","energy","defense","crypto","manufacturing","datacenter","power","aimodels","applications","networking","water","nuclear","macro"],
  "signal_type_boost": "earnings"|"presidential_endorsement"|"policy"|"options_flow"|"guidance"|"contract"|"regulation"|"none",
  "negated": true|false
}

Confidence scoring guide:
- 90-100: Presidential endorsement of specific stock, earnings beat >15%, Fed pivot announcement
- 75-89:  Earnings beat 5-15%, major contract win, guidance raise, large options sweep
- 60-74:  Sector news with clear winner, policy change affecting specific companies
- 40-59:  General industry news, weak signals, ambiguous impact
- 0-39:   Not market moving, irrelevant, or negated signal

CRITICAL rules:
- "go out and buy Dell" from a president = 92+ confidence, presidential_endorsement, tickers [DELL,INTC,MSFT]
- "chip demand not as strong" = negated:true, bearish, lower confidence
- Unknown company names: look them up mentally and include their ticker
- primary_tickers: the obvious large-cap plays EVERYONE will think of
- hidden_gem_tickers: small/mid-cap names most investors MISS that will benefit MORE on % basis
  Examples: NVDA signal → hidden gems: PLAB (photomasks), AEHR (chip testing), CRDO (connectivity), TSEM (specialty foundry)
  Data center signal → hidden gems: POWL (switchgear), IESC (electrical contractors), MYRG (grid construction)
  Nuclear/power signal → hidden gems: UEC (uranium), NNE (micro nuclear), OKLO (Sam Altman's SMR), GEV (turbines)
  Networking signal → hidden gems: FN (Fabrinet makes the components), SMTC (analog chips), CALX (broadband AI)
  Defense signal → hidden gems: KTOS (drone AI), RCAT (military drones), CACI (gov AI analytics)
- ripple_tickers: 2nd/3rd order companies affected (suppliers, customers, competitors)
- Always prioritise hidden gems — they have more upside than obvious picks

SMART MONEY SOURCE RULES:
- congress trade: confidence boost +15 if large purchase (>$250k), flag if committee assignment relates to sector
- insider buy (Form 4): confidence boost +20 — this is the STRONGEST signal, execs rarely buy unless bullish
- hedge fund 13F: confidence boost +10 but note 45-day lag, look for entry on dips post-disclosure
- Options sweep: confidence boost +12 if large notional value, implies institutional positioning`
      }],
      messages: [{ role: "user", content: `Source: ${item.sourceLabel} (${item.signalType||"news"})\nText: ${fullText.slice(0,400)}` }],
    }));
    trackCacheUsage(response);
    const text = response.content.find(c=>c.type==="text")?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch(e) {
    console.log(`     ⚠️  AI pre-screen failed: ${e.message} — falling back to keyword score`);
    return null;
  }
}

// Merge AI pre-screen result with keyword scored signals
// AI score is authoritative for confidence/sentiment/tickers
// Keyword signals fill in sector details
function mergeScores(keywordScored, aiScreen) {
  if (!aiScreen) return keywordScored; // fallback to keyword if AI failed

  // Build signals from AI-identified sectors + keyword details
  const mergedSignals = { ...keywordScored.signals };

  // Add any sectors AI found that keywords missed
  (aiScreen.sectors || []).forEach(sector => {
    if (!mergedSignals[sector]) {
      mergedSignals[sector] = {
        direction: aiScreen.sentiment === "bullish" ? "BUY" : "SELL",
        strength: Math.round(aiScreen.confidence * 0.8),
        score: aiScreen.sentiment === "bullish" ? 3 : -3,
        aiDetected: true,   // flag: AI found this, keywords didn't
      };
    }
  });

  // If negated, flip or zero out keyword signals
  if (aiScreen.negated) {
    Object.keys(mergedSignals).forEach(s => {
      mergedSignals[s].direction = mergedSignals[s].direction === "BUY" ? "SELL" : "BUY";
      mergedSignals[s].negated = true;
    });
  }

  // Add AI-found tickers to the ripple map dynamically
  const dynamicRipples = (aiScreen.ripple_tickers || [])
    .filter(t => t && t.length <= 5)
    .map(t => ({ ticker: t, reason: "AI-identified supply chain play", relationship: "related to", parent: (aiScreen.primary_tickers||[])[0] || "signal" }));

  // Signal type boost to confidence
  const boosts = {
    presidential_endorsement: 15,
    earnings: 10,
    guidance: 12,
    contract: 8,
    options_flow: 8,
    policy: 6,
    regulation: 6,
    none: 0,
  };
  const boost = boosts[aiScreen.signal_type_boost] || 0;
  const finalConfidence = Math.min(aiScreen.confidence + boost, 95);

  return {
    signals: mergedSignals,
    sentiment: aiScreen.sentiment,
    confidence: finalConfidence,
    bull: Object.values(mergedSignals).filter(s=>s.direction==="BUY").length,
    bear: Object.values(mergedSignals).filter(s=>s.direction==="SELL").length,
    aiScreen,           // attach full AI assessment for logging + alerts
    dynamicRipples,     // extra ripple tickers AI found
    breakdown: {
      ...keywordScored.breakdown,
      aiConfidence: aiScreen.confidence,
      signalTypeBoost: boost,
      negated: aiScreen.negated,
      aiReasoning: aiScreen.reasoning,
    },
  };
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

      // ── Step 1: fast keyword pre-score (cheap, no API call) ──────────────
      const keywordScored = scoreStatement(item.quote||item.headline||"", item.signalType||"news");
      const b = keywordScored.breakdown;
      console.log(`     "${key.slice(0,45)}…"`);
      console.log(`     → Keyword score: ${keywordScored.sentiment.toUpperCase()} ${keywordScored.confidence}% (density=${b.densityPts} cross=${b.crossPts} magnitude=${b.magnitudePts} weight=${b.sourceWeight})`);

      // ── Step 2: AI pre-screen — skip if keyword score is 0 AND source is
      // low-priority (reddit/options) to avoid wasting tokens on pure noise
      const lowPriority = ["reddit"].includes(item.signalType||"");
      const skipScreen  = keywordScored.confidence === 0 && lowPriority;
      let aiScreen = null;
      if (!skipScreen) {
        console.log(`     🧠 AI pre-screening...`);
        aiScreen = await aiPreScreen(item);
      } else {
        console.log(`     ⏭️  Skipping AI pre-screen (low priority + no keywords)`);
      }
      const scored   = mergeScores(keywordScored, aiScreen);

      if (aiScreen) {
        console.log(`     → AI score: ${aiScreen.sentiment.toUpperCase()} ${aiScreen.confidence}% | ${aiScreen.reasoning}`);
        console.log(`     → Signal type: ${aiScreen.signal_type_boost} | Negated: ${aiScreen.negated} | Tickers: ${(aiScreen.primary_tickers||[]).join(", ")}`);
        console.log(`     → FINAL confidence: ${scored.confidence}% (AI ${aiScreen.confidence}% + boost ${scored.breakdown.signalTypeBoost}pts)`);
      }

      if (scored.confidence < CONFIG.CONFIDENCE_THRESHOLD) {
        console.log(`     ↩  Below threshold (${CONFIG.CONFIDENCE_THRESHOLD}%)`); continue;
      }
      if (aiScreen?.is_market_moving === false) {
        console.log(`     ↩  AI says not market-moving, skipping`); continue;
      }
      if (aiScreen?.negated) {
        console.log(`     ↩  AI detected negation — signal is ${scored.sentiment}`);
        // Still continue if bearish signal above threshold
        if (scored.confidence < CONFIG.CONFIDENCE_THRESHOLD) continue;
      }

      const topSectors = Object.entries(scored.signals)
        .sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,3).map(([s])=>s);

      // Supply chain ripples: hardcoded map + AI-detected dynamic ripples
      const ripples = [
        ...findSupplyChainRipple(scored.signals),
        ...(scored.dynamicRipples||[]),
      ].filter((r,i,arr) => arr.findIndex(x=>x.ticker===r.ticker)===i).slice(0,8);
      if (ripples.length) console.log(`     🔗 Ripple plays: ${ripples.map(r=>r.ticker).join(", ")}`);

      // Inject AI-found primary tickers into item for alerts
      if (aiScreen?.primary_tickers?.length) {
        item.ticker = item.ticker || aiScreen.primary_tickers[0];
        item.allTickers = aiScreen.primary_tickers;
      }

      // Record smart money signals for convergence tracking
      const smartMoneyTypes = ["congress","insider","smartmoney","options"];
      if (smartMoneyTypes.includes(item.signalType)) {
        const tickers = [...(aiScreen?.primary_tickers||[]), item.ticker].filter(Boolean);
        for (const t of tickers) {
          recordSmartMoneySignal(t, item.signalType, scored.sentiment, item);
        }
      }

      // Check convergence for triggered tickers
      const convergence = item.ticker ? checkConvergence(item.ticker) : null;
      if (convergence) {
        console.log(`     🎯 CONVERGENCE: ${convergence.summary}`);
        scored.confidence = Math.min(scored.confidence + convergence.convergenceBonus, 95);
        scored.convergence = convergence;
      }

      // Build smart money context for deep analysis
      item.smartMoneyContext = buildSmartMoneyContext(item);

      // Fetch context in parallel — skip peer comparison for low-mid confidence to save tokens
      const highConfidence = scored.confidence >= 80;  // only fetch peers for very high confidence
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
  console.log(`📡 Sources: ${SIGNAL_SOURCES.length} total`);
  SIGNAL_SOURCES.forEach(s => console.log(`   ${s.emoji} ${s.label}`));
  console.log(`🎯 Convergence engine: tracks when Congress + insider + hedge fund align on same ticker`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  startHealthServer();

  // Use a setTimeout chain instead of setInterval — guarantees the next poll
  // only starts AFTER the current one fully completes, preventing overlap.
  // With 9 sources x 25s gaps a poll can easily exceed a short interval.
  async function scheduledPoll() {
    const pollStart = Date.now();
    await poll();
    const pollDurationMs = Date.now() - pollStart;
    const intervalMs     = CONFIG.POLL_INTERVAL_MIN * 60 * 1000;

    // Wait the configured interval AFTER poll finishes.
    // If poll itself ran longer, wait at least 30s before next cycle.
    const waitMs = Math.max(intervalMs - pollDurationMs, 30000);
    nextPollTime = new Date(Date.now() + waitMs).toISOString();

    const waitMin = Math.round(waitMs / 60000 * 10) / 10;
    console.log(`\n⏱  Poll took ${Math.round(pollDurationMs/1000)}s. Next poll in ${waitMin}min at ${new Date(nextPollTime).toLocaleTimeString()}`);
    setTimeout(scheduledPoll, waitMs);
  }

  scheduledPoll();
}

main().catch(err => { console.error("\ud83d\udca5 Fatal:", err); process.exit(1); });
