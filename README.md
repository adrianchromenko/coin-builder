# Coin Builder

A chat-style web app that turns an uploaded image into an AI-rendered custom coin.

The bot asks for an image, lets the customer pick a metal finish, takes optional notes, generates the coin, and then offers to order it or edit it. Ordering collects quantity, size, and contact details, saves the order under `orders/`, and hands off to Stripe Checkout when pricing and a Stripe key are configured.

## Run locally

```bash
npm install
cp .env.example .env   # add your OPENAI_API_KEY
npm start
```

Open http://localhost:3000.

Without an API key the server runs in **demo mode** and returns a local SVG mockup, so the whole chat flow can be tested for free.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_PROVIDER` | `openai` | `openai` or `demo` |
| `OPENAI_API_KEY` | | Required for real renders |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | Image model |
| `OPENAI_IMAGE_SIZE` | `1024x1024` | Output size |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low`, `medium`, or `high` |
| `REFERENCE_COUNT` | `4` | Reference coin photos sent per render (see `references/`) |
| `PRICE_TABLE` | | JSON price list by size; enables quotes (see `.env.example`) |
| `STRIPE_SECRET_KEY` | | Enables Pay Now via Stripe Checkout (needs `PRICE_TABLE`) |
| `PUBLIC_URL` | | Deployed URL, used for Stripe return links |
| `ORDER_WEBHOOK_URL` | | Every order is POSTed here as JSON |
| `PORT` | `3000` | HTTP port |
| `RATE_LIMIT_PER_HOUR` | `20` | Generations per IP per hour |

## Deploy

Any Node host works (Render, Railway, Fly). Set the environment variables above and use `npm start`.

## Structure

```
server.js          Express server, upload handling, rate limit
lib/prompt.js      Finish list and the coin prompt
lib/providers.js   OpenAI image-edit provider + demo provider
public/            Chat UI (index.html, style.css, app.js)
references/        Photos of real coins used as style references
lib/pricing.js     Optional price tiers from PRICE_TABLE
lib/orders.js      Saves orders to ./orders, webhook + Stripe Checkout
orders/            Saved orders (JSON + coin image), git-ignored
```
