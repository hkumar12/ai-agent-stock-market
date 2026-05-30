# 🦅 Trump Market Oracle — Background Alert Service

Runs **24/7 in the cloud**. Polls Trump's statements from Truth Social, X, and news sources every 5 minutes. Sends you a Gmail alert the moment a high-confidence stock signal fires — no browser needed.

---

## What you'll receive in your inbox

```
Subject: 🦅 Trump Signal: BULLISH 72% — Truth Social

📈 BULLISH SIGNAL  |  72% confidence
📣 Truth Social  |  10 minutes ago

💬 "We're going to drill baby drill, more oil than this
    country has ever seen..."

🎯 SECTOR SIGNALS:
  ⛽  Energy & Oil     BUY   (80% strength)  → XOM, CVX, OXY
  🏭  Manufacturing    BUY   (60% strength)  → CAT, DE, MMM

🤖 AI ACTION:
  Go long XOM before market open — energy rhetoric
  historically pops XLE 2-4% intraday. Set limit at open +0.5%.
```

---

## Prerequisites

- Node.js 18+ installed (https://nodejs.org)
- A **Gmail account** with 2-Step Verification enabled
- An **Anthropic API key** (https://console.anthropic.com)
- A free account on Railway, Render, or Fly.io

---

## Step 1 — Get your Gmail App Password

> ⚠️ You must use an App Password, NOT your regular Gmail login password.

1. Go to https://myaccount.google.com/security
2. Make sure **2-Step Verification** is turned ON
3. Go to https://myaccount.google.com/apppasswords
4. Click **Create** → name it "Trump Oracle"
5. Copy the 16-character password (e.g. `abcd efgh ijkl mnop`)

---

## Step 2 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Click **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-...`)

> Note: The service uses Claude Sonnet. Typical usage costs ~$2–5/month depending on poll frequency.

---

## Step 3 — Deploy (choose one option)

### Option A: Railway ⭐ Recommended (free tier available)

**Easiest deployment — takes ~3 minutes.**

1. Go to https://railway.app and sign up (free)
2. Click **New Project** → **Deploy from GitHub repo**
   - Or: **New Project** → **Empty Project** → drag-and-drop this folder
3. Once deployed, click your service → **Variables** tab
4. Add these environment variables one by one:

   | Variable | Value |
   |----------|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` |
   | `GMAIL_USER` | `you@gmail.com` |
   | `GMAIL_APP_PASSWORD` | `abcd efgh ijkl mnop` |
   | `ALERT_EMAIL` | `you@gmail.com` |
   | `CONFIDENCE_THRESHOLD` | `60` |
   | `POLL_INTERVAL_MIN` | `5` |

5. Click **Deploy** — done! ✅

**Cost:** Free tier gives $5/month credit — more than enough for this service.

---

### Option B: Render (free tier, may sleep after inactivity)

1. Go to https://render.com and sign up
2. Click **New** → **Background Worker**
3. Connect your GitHub repo (or upload files)
4. Set **Build Command:** `npm install`
5. Set **Start Command:** `npm start`
6. Add environment variables (same as Railway table above)
7. Click **Create Background Worker**

> ⚠️ Free tier on Render spins down after inactivity. Use the $7/month plan for always-on.

---

### Option C: Fly.io (more technical, very reliable)

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly auth login`
3. In this folder: `fly launch` (follow prompts)
4. Set secrets:
   ```bash
   fly secrets set ANTHROPIC_API_KEY=sk-ant-...
   fly secrets set GMAIL_USER=you@gmail.com
   fly secrets set GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
   fly secrets set ALERT_EMAIL=you@gmail.com
   ```
5. Deploy: `fly deploy`

---

### Option D: Run locally (testing only)

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and fill in your values

# 3. Start the service
npm start
```

---

## Step 4 — Verify it's working

After deploying, check the logs. You should see:

```
🦅 Trump Market Oracle — Background Service
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Alerts → you@gmail.com
🎯 Threshold: 60% confidence
⏱  Poll every: 5 minutes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Health check running on port 3000
[10:32:01] 🔄 Polling...
   Found 3 statement(s).
   📣 [Truth Social] "We're going to drill baby drill..."
      → BULLISH | confidence: 72% | sectors: 2
📧 Alert sent → you@gmail.com | BULLISH 72%
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIDENCE_THRESHOLD` | `60` | Minimum % to trigger alert. Lower = more alerts. |
| `POLL_INTERVAL_MIN` | `5` | Minutes between polls. Don't go below 3. |
| `ALERT_EMAIL` | same as `GMAIL_USER` | Where to send alerts (can be different email) |

### SMS via email gateway
Want texts instead of email? Set `ALERT_EMAIL` to your carrier's SMS gateway:
- AT&T: `1234567890@txt.att.net`
- T-Mobile: `1234567890@tmomail.net`
- Verizon: `1234567890@vtext.com`

---

## Estimated costs

| Service | Cost |
|---------|------|
| Railway hosting | Free ($5/mo credit) |
| Anthropic API (5-min polls) | ~$3–6/month |
| Gmail | Free |
| **Total** | **~$3–6/month** |

---

## Troubleshooting

**"Gmail authentication failed"**
→ Make sure you're using an App Password, not your regular password.
→ Ensure 2-Step Verification is enabled on your Google account.

**"No statements found" every poll**
→ Normal during quiet periods. The service will catch the next statement.

**Not receiving emails**
→ Check your spam folder and mark as "Not Spam".
→ Verify `ALERT_EMAIL` is correct in your environment variables.

**High API costs**
→ Increase `POLL_INTERVAL_MIN` to `15` or `30` to reduce usage.

---

## ⚠️ Disclaimer

For educational and entertainment purposes only. Not financial advice. Always consult a licensed financial advisor before making investment decisions.
