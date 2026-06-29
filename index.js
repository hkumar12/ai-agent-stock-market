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

// ── Job seeker profile ─────────────────────────────────────────────────────
const JOB_PROFILE = {
  name:         "Harsh Kumar",
  title:        "Staff Software Engineer",
  targetLevels: ["Staff","Principal","Senior Staff","Distinguished","L6","L7","E6","E7","IC5","IC6"],
  locations:    ["Seattle","Bellevue","Redmond","Kirkland","Remote"],
  minComp:      400000,
  visa:         "H-1B — requires sponsorship",
  skills:       ["distributed systems","backend systems","microservices","event-driven","Temporal","DynamoDB","Aurora","AWS","platform engineering","ad-tech","advertising","high-throughput","low-latency","Java","Python","CI/CD","Kafka"],
  domains:      ["advertising technology","e-commerce","cloud infrastructure","platform engineering","fulfillment","data platforms"],
  experience:   ["Microsoft Staff SWE","Amazon SDE2 9yrs","Coupang Staff SWE"],
  education:    "MS Computer Science Arizona State University",
  queries: [
    "Staff Software Engineer distributed systems Seattle remote H1B sponsorship 2026",
    "Principal Engineer backend platform Seattle remote 400k+ H1B sponsorship 2026",
    "Staff Engineer ad tech advertising distributed systems remote Seattle sponsorship 2026",
    "L6 L7 software engineer backend AWS DynamoDB Seattle remote 2026 sponsorship",
    "Staff Principal engineer event-driven microservices remote Seattle H1B 2026",
  ],
};

function validateConfig() {
  if (!CONFIG.ANTHROPIC_API_KEY) { console.error("❌ Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!CONFIG.TELEGRAM_BOT_TOKEN && !CONFIG.GMAIL_USER) {
    console.error("❌ Need TELEGRAM_BOT_TOKEN or GMAIL_USER"); process.exit(1);
  }
}

// ── Job search signal source (added separately from SIGNAL_SOURCES) ─────────
const JOB_SOURCES = JOB_PROFILE.queries.map((q, i) => ({
  id: "jobs_" + i,
  label: "Job search",
  emoji: "💼",
  searchQuery: q,
  systemPrompt: `YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for Staff or Principal Software Engineer job postings matching this query. Prefer recent postings. Return up to 4 jobs, all fields under 120 chars:
[{"source":"LinkedIn","time":"today","headline":"Staff SWE @ Google — Remote","quote":"Distributed systems, 400k+, H1B sponsorship","url":"https://linkedin.com/jobs/view/1234567","signalType":"job","company":"Google","role":"Staff Software Engineer","location":"Remote","comp":"$400k-$500k","sponsorship":true,"posted":"today"}]
Rules: Include real job URLs when found. Set sponsorship:true only if explicitly mentioned. Return [] if truly nothing found.`
}));

// ── Direct LinkedIn job URL fetcher ───────────────────────────────────────
// Fetches actual LinkedIn search pages for more reliable results
const LINKEDIN_JOB_URLS = [
  "https://www.linkedin.com/jobs/search/?keywords=Staff%20Software%20Engineer%20distributed%20systems&location=Seattle%2C%20WA&f_TPR=r86400&f_E=5%2C6",
  "https://www.linkedin.com/jobs/search/?keywords=Principal%20Engineer%20backend%20platform&location=Seattle%2C%20WA&f_TPR=r86400&f_E=5%2C6",
  "https://www.linkedin.com/jobs/search/?keywords=Staff%20Software%20Engineer%20remote%20H1B%20sponsorship&f_TPR=r86400&f_E=5%2C6",
  "https://www.linkedin.com/jobs/search/?keywords=Staff%20Engineer%20ad%20tech%20advertising%20platform&f_TPR=r86400",
  "https://www.linkedin.com/jobs/search/?keywords=Principal%20Software%20Engineer%20AWS%20DynamoDB%20remote&f_TPR=r86400",
];

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
  quantum: {
    label:"Quantum computing", emoji:"⚛️",
    tickers:["IONQ","IBM","GOOGL","RGTI","QBTS","IFNQ","QUBT"],
    etf:"QTUM", peers:["IONQ","IBM","GOOGL"],
    hiddenGems:[
      { ticker:"RGTI",  why:"Rigetti — cheapest pure-play, high risk/reward" },
      { ticker:"QUBT",  why:"Quantum Computing Inc — tiny float, explosive on news" },
      { ticker:"GFS",   why:"GlobalFoundries — $375M quantum fab investment" },
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
  emerging: {
    label:"Emerging tech catch-all", emoji:"🚀", etf:"ARKK",
    tickers:["ARKG","ARKQ","ARKW","PRNT","IZRL"],
    peers:["ARKG","ARKQ","ARKW"],
    hiddenGems:[
      { ticker:"ARKG", why:"ARK Genomics — biotech/gene editing catch-all ETF" },
      { ticker:"ARKQ", why:"ARK Autonomous — robotics/AI/space catch-all ETF" },
    ],
  },
  quantum: {
    label:"Quantum computing", emoji:"⚛️", etf:"QTUM",
    tickers:   ["IONQ","IBM","GOOGL","RGTI","QBTS","IFNQ","QUBT"],
    peers:     ["IONQ","IBM","RGTI"],
    hiddenGems:[
      { ticker:"IONQ", why:"IonQ — pure-play quantum networking, EO directly benefits, still early innings" },
      { ticker:"RGTI", why:"Rigetti Computing — cheapest pure-play after selloff, high risk/reward on 2028 timeline" },
      { ticker:"QBTS", why:"D-Wave Quantum — optimization focus, government contracts, more upside post-EO" },
      { ticker:"IFNQ", why:"Infleqtion — quantum sensing/atomic clocks, NASA contracts, direct EO beneficiary" },
      { ticker:"QUBT", why:"Quantum Computing Inc — tiny cap, explosive on any quantum news, micro-cap play" },
      { ticker:"GFS",  why:"GlobalFoundries — $375M CHIPS Act quantum fab, manufacturing play" },
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
    quantum:       ["quantum computing","quantum computer","quantum cryptography","post-quantum","quantum sensing","quantum network","qubit","infleqtion","ionq","rigetti","d-wave","quantum executive order","quantum chips"],
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
    quantum:       ["quantum delay","quantum setback","quantum ban","quantum restriction","quantum bubble"],
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
// Hidden gems are collected FIRST and separately to guarantee they appear
function findSupplyChainRipple(signals) {
  const chainRipples = [];
  const gemRipples   = [];
  const seen = new Set();

  const triggeredTickers = Object.entries(signals)
    .filter(([,d]) => d.direction === "BUY")
    .flatMap(([s]) => LAYERS[s]?.tickers || []);

  const triggeredLayers = Object.entries(signals)
    .filter(([,d]) => d.direction === "BUY")
    .map(([s]) => s);

  // ── Hidden gems first (guaranteed slots) ─────────────────────────────
  // Pick top 2 gems from each triggered layer (up to 6 gems total)
  for (const layer of triggeredLayers) {
    let layerGems = 0;
    for (const gem of (LAYERS[layer]?.hiddenGems || [])) {
      if (layerGems >= 2) break;
      if (!seen.has(gem.ticker)) {
        seen.add(gem.ticker);
        gemRipples.push({
          ticker: gem.ticker,
          reason: gem.why,
          relationship: "hidden gem in",
          parent: layer,
          isHiddenGem: true,
        });
        layerGems++;
      }
    }
    if (gemRipples.length >= 6) break;
  }

  // ── Supply chain relationships second ─────────────────────────────────
  for (const ticker of triggeredTickers) {
    const map = SUPPLY_CHAIN_MAP[ticker];
    if (!map) continue;
    const all = [
      ...(map.suppliers     || []).map(d => ({ ...d, relationship: "supplier to" })),
      ...(map.customers     || []).map(d => ({ ...d, relationship: "customer of" })),
      ...(map.beneficiaries || []).map(d => ({ ...d, relationship: "beneficiary of" })),
    ];
    for (const dep of all) {
      if (!seen.has(dep.ticker) && chainRipples.length < 5) {
        seen.add(dep.ticker);
        chainRipples.push({ ...dep, parent: ticker, isHiddenGem: false });
      }
    }
  }

  // Return gems first so they're never sliced out
  return [...gemRipples, ...chainRipples];
}

// ── Signal sources ─────────────────────────────────────────────────────────
const SIGNAL_SOURCES = [
  {
    id:"trump", label:"Trump statements", emoji:"🦅",
    searchQuery:"Donald Trump speech executive order signing White House announcement today 2026",
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
    searchQuery:"wallstreetbets top stocks mentioned trending today 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for top stocks being discussed on Reddit WallStreetBets today. Return max 3 items, keep quotes under 80 chars:
[{"source":"WSB","time":"today","headline":"NVDA bullish","quote":"community buying the dip","url":"","signalType":"reddit","ticker":"NVDA","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"analysts", label:"Analyst upgrades & price targets", emoji:"🎯",
    searchQuery:"analyst upgrade downgrade price target raised lowered today 2025 AI tech stocks",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for latest analyst upgrades, downgrades, or price target changes for stocks today. Return max 3 items, quotes under 80 chars:
[{"source":"Goldman Sachs","time":"today","headline":"Goldman upgrades NVDA to Buy","quote":"raises target to $1200 from $950","url":"","signalType":"analyst","ticker":"NVDA","action":"upgrade","target":"$1200","from_target":"$950","rating":"Buy"}]
Empty result: []`
  },
  {
    id:"congress", label:"Congress trades", emoji:"🏛️",
    searchQuery:"Congress stock trade disclosure STOCK Act purchase sale today 2025 Pelosi senator representative",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT WHATSOEVER.
Search web for latest Congress STOCK Act stock trade disclosures today 2025.
Return JSON array only:
[{"source":"STOCK Act","time":"1 day ago","headline":"Pelosi buys NVDA","quote":"trade detail max 100 chars","url":"","signalType":"congress","ticker":"NVDA","member":"Nancy Pelosi","party":"D","transaction":"purchase","amount":"$250k"}]
Empty result: []`
  },
  {
    id:"insiders", label:"CEO/insider buying", emoji:"👔",
    searchQuery:"CEO CFO insider buying SEC Form 4 stock purchase exec buy own shares today 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT WHATSOEVER.
Search web for latest SEC Form 4 insider stock purchases by executives today 2025. Only purchases, not sales.
Return JSON array only:
[{"source":"SEC Form 4","time":"2 hours ago","headline":"CEO buys $5M stock","quote":"detail max 100 chars","url":"","signalType":"insider","ticker":"NVDA","insider":"Jensen Huang","role":"CEO","transaction":"purchase","value":"$5M"}]
Empty result: []`
  },
  {
    id:"smartmoney", label:"Hedge fund & 13F signals", emoji:"🦈",
    searchQuery:"Warren Buffett Berkshire 13F hedge fund Ackman Burry Druckenmiller ARK Cathie Wood buy position 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT WHATSOEVER.
Search web for latest Buffett Berkshire Ackman Burry Druckenmiller ARK Invest stock moves 2025.
Return JSON array only:
[{"source":"13F Filing","time":"2 days ago","headline":"Buffett adds Apple","quote":"detail max 100 chars","url":"","signalType":"smartmoney","ticker":"AAPL","investor":"Warren Buffett","fund":"Berkshire","action":"added","value":"$2B"}]
Empty result: []`
  },
  {
    id:"whitehouse", label:"White House & executive orders", emoji:"🏛️",
    searchQuery:"Trump executive order signed White House announcement policy today 2026",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for ANY Trump executive order, White House announcement, or major policy signing today. Catch EVERYTHING — not just known sectors. Return max 4 items:
[{"source":"White House","time":"today","headline":"Trump signs quantum computing EO","quote":"detail max 80 chars","url":"","signalType":"policy","topic":"quantum computing","companies_mentioned":"IBM, Google, Infleqtion","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"quantum", label:"Quantum computing news", emoji:"⚛️",
    searchQuery:"quantum computing news executive order investment IBM Google Infleqtion IonQ Rigetti 2026",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for latest quantum computing news, executive orders, government investments, or company announcements today. Return max 3 items, quotes under 80 chars:
[{"source":"Reuters","time":"today","headline":"Trump signs quantum EO with IBM Google","quote":"detail max 80 chars","url":"","signalType":"quantum","ticker":"IONQ","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"fda", label:"FDA calendar & biotech", emoji:"💊",
    searchQuery:"FDA PDUFA drug approval rejection Phase 3 trial results biotech today week 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for FDA drug approvals, rejections, or Phase 3 trial results this week. Return max 3 items, quotes under 80 chars:
[{"source":"FDA","time":"today","headline":"FDA approves Moderna drug","quote":"detail max 80 chars","url":"","signalType":"fda","ticker":"MRNA","action":"approved","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"shortsqueeze", label:"Short squeeze candidates", emoji:"🚀",
    searchQuery:"high short interest stocks squeeze catalyst bullish news 2025 most shorted",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for heavily shorted stocks with a fresh bullish catalyst today. Return max 3 items, quotes under 80 chars:
[{"source":"Short Interest","time":"today","headline":"GME 40% short float beats earnings","quote":"detail max 80 chars","url":"","signalType":"shortsqueeze","ticker":"GME","short_float":"40%","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"govcontracts", label:"Govt contract awards", emoji:"📜",
    searchQuery:"government contract awarded DoD Pentagon AI technology defense billion million 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for major US government DoD contract awards for tech AI defense companies today. Return max 3 items, quotes under 80 chars:
[{"source":"DoD","time":"today","headline":"Palantir wins $500M Army AI contract","quote":"detail max 80 chars","url":"","signalType":"govcontract","ticker":"PLTR","value":"$500M","sentiment":"bullish"}]
Empty result: []`
  },
  {
    id:"jobpostings", label:"Job posting intelligence", emoji:"📋",
    searchQuery:"tech AI company massive hiring surge layoffs job cuts expansion announced 2025",
    systemPrompt:`YOUR RESPONSE MUST START WITH [ AND END WITH ]. NO OTHER TEXT.
Search for significant hiring surges or mass layoffs at major tech/AI companies today. Return max 3 items, quotes under 80 chars:
[{"source":"LinkedIn","time":"today","headline":"Nvidia hiring 2000 AI engineers","quote":"detail max 80 chars","url":"","signalType":"jobpostings","ticker":"NVDA","direction":"hiring","sentiment":"bullish"}]
Empty result: []`
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

// ── Sanitize parsed items — strip XML/cite tags from all string fields ────
function sanitizeItem(item) {
  const strip = s => typeof s === "string"
    ? s.replace(/<[^>]+>/g,"").replace(/[
