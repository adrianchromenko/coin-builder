# Coin Builder

A chat-style web app that turns an uploaded image into an AI-rendered custom coin.

The bot asks for an image, lets the customer pick a metal finish, takes optional notes, generates the coin, and then offers to order it or edit it. Ordering collects quantity and size, then a single in-chat form for contact, billing and shipping details, saves the order under `orders/`, and hands off to Stripe Checkout when pricing and a Stripe key are configured.

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
| `OPENAI_IMAGE_MODEL` | newest available (`gpt-image-2.5-sunburst`) | Image model; steps down to older models only if the API rejects a request |
| `OPENAI_IMAGE_SIZE` | `1024x1024` | Output size |
| `OPENAI_IMAGE_QUALITY` | `high` | Lettering accuracy drops noticeably below `high` |
| `REFERENCE_COUNT` | `2` | Reference coin photos sent per render, 3 at most (see `references/`) |
| `AI_MAX_ATTEMPTS` | `2` | Renders per request: a render that fails proofreading is redone with a note about what to fix |
| `AI_VERIFY` | on | `0` turns proofreading off |
| `OPENAI_VERIFY_MODEL` | `gpt-5.4-mini` | Vision model that proofreads each render |
| `PRICE_TABLE` | | JSON price list by size; enables quotes (see `.env.example`) |
| `STRIPE_SECRET_KEY` | | Enables Pay Now via Stripe Checkout (needs `PRICE_TABLE`) |
| `PUBLIC_URL` | | Deployed URL, used for Stripe return links |
| `ORDER_WEBHOOK_URL` | | Every order is POSTed here as JSON |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | | Enables **Email Me This Design**: the watermarked design is emailed and the address saved as a lead in `leads/` |
| `MAIL_REPLY_TO` | From address | Where customers' replies go |
| `LEAD_WEBHOOK_URL` | | Every lead is POSTed here as JSON |
| `MAIL_PREVIEW_DIR` | | Testing: write emails to `.eml` files here instead of sending |
| `TEST_MODE` | | `1` forces test mode for everyone (see below) |
| `RENDERS_PER_HOUR`, `RENDERS_PER_DAY` | `6`, `15` | AI renders one visitor (IP) may make |
| `RENDERS_PER_DAY_TOTAL` | `300` | AI renders the whole site may make per day (ET); the team is emailed at 80% and 100% |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | | Cloudflare Turnstile: every render must come from a real browser (recommended in production) |
| `ORDER_LIMIT_PER_HOUR` | `20` | Order submissions per IP per hour |
| `PORT` | `3000` | HTTP port |
| `RATE_LIMIT_PER_HOUR` | `20` | Generations per IP per hour |

## How a render is made

Image models are good at metal and bad at spelling, so the pipeline is built around not trusting them:

1. The browser draws a clean **art proof** of the layout (solid, high-contrast lettering) and sends that, not the soft on-screen preview.
   The layout includes the optional **center background**: an enamel color, a struck texture (sandblast, sunburst, diamond cut), or both, which renders as translucent enamel over the texture.
2. `lib/prompt.js` builds the prompt on the server from the customer's actual choices. Each line of lettering is quoted, counted and spelled out letter by letter, and the logo is declared off-limits for restyling.
3. `lib/providers.js` renders with the best model available, plus a couple of photos from `references/` for style. Only photos of finished coins belong in that folder; anything else is shown to the model as "a coin we made".
4. `lib/verify.js` **proofreads the result**: a vision model reads the lettering off the render alone, character by character, twice, and a second pass compares the logo with the art proof. A wrong render is redone once with specific feedback; the better attempt is returned with its report.
5. The customer sees a green "Wording checked" or an amber "not quite right" note that quotes what the AI actually wrote. Every render is kept as a **version** under the coin; picking an older version also brings back the design it was made from, so the picture and the order always match.

6. **Nothing clean leaves the server.** `lib/watermark.js` keeps the original in `renders/` (git-ignored, swept after `RENDER_KEEP_DAYS`) and gives the browser only a small, lightly watermarked preview. The Download button fetches a full-size, heavily watermarked copy. When a customer orders an AI version, the order gets the clean original from the server's own copy. Right-click, long-press and drag are blocked on coin images, but that only stops casual saving; the watermark is what actually protects the artwork, because a screenshot is always possible.

### Keeping the OpenAI bill in check

Each render costs real money whether or not the visitor orders, so `lib/guard.js` sits in front of `/api/generate`:

1. One render at a time per visitor, and per-visitor hourly and daily caps (`RENDERS_PER_HOUR`, `RENDERS_PER_DAY`).
2. A site-wide daily budget (`RENDERS_PER_DAY_TOTAL`). When it is spent, rendering pauses for everyone until midnight ET and the team is emailed (at 80% and at 100%). The count lives in `DATA_DIR/render-count.json` so a restart does not reset it.
3. Repeats are free: the exact same art proof with the exact same options within 24 hours gets the earlier render back.
4. Optional Cloudflare Turnstile (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`): each render carries a token proving it came from a real browser, which is what stops scripted abuse from many IP addresses. Test mode never renders, so it is not affected by any of this.

The proofreader reads the render without seeing the art proof on purpose. When it could see the intended wording it "corrected" typos in its head and passed misspelled coins.

## Test mode

Click the **Test Mode** switch in the header (it turns yellow when on) to walk through the order flow without rendering a coin or taking payment. You can also open `/test` or `/?test=1`, or type **test mode** into the chat. Switching it does not clear the chat, so you can flip it on right before placing an order. It stays on for that browser tab until you switch it off, open `/test/off`, or type **test mode off**.

In test mode:

- The image upload is optional (a **Skip Image** button goes straight to the finish picker).
- No image is sent to the AI provider; a placeholder coin marked TEST is shown instead.
- The order flow runs as normal: quantity, size, then one form for contact details, billing address and shipping address, then review.
- Orders are saved to `orders/` with a `TEST-` id and `"status": "test"`. Stripe Checkout and `ORDER_WEBHOOK_URL` are never called.
- After the order is saved a **test checkout popup** opens: order summary, card form, Pay button, success screen. Use `4242 4242 4242 4242`, any future expiry, any CVC. Nothing is charged and the card number never leaves the browser; only the last four digits are saved with the order, which moves to `"status": "test_paid"`. When no `PRICE_TABLE` is set a sample price is shown.

Set `TEST_MODE=1` in `.env` to force test mode for every visitor, for example on a staging server.

## Deploy

Any Node host works (Render, Railway, Fly). Set the environment variables above and use `npm start`.

## Structure

```
server.js          Express server, upload handling, rate limit
lib/prompt.js      Finish, color, shape and add-on options (matching the coinsforanything.com quote form) and the coin prompt
lib/providers.js   OpenAI image-edit provider (model fallback, render -> proofread -> retry) + demo provider
lib/mailer.js      Emails the watermarked design to the customer, saves leads to ./leads
lib/watermark.js   Watermarks everything sent to the browser; stores clean originals in ./renders
lib/verify.js      Proofreads each render: lettering read back letter by letter, logo compared with the art proof
public/            Chat UI (index.html, style.css, app.js)
references/        Photos of real coins used as style references
lib/pricing.js     Optional price tiers from PRICE_TABLE
lib/orders.js      Saves orders to ./orders, webhook + Stripe Checkout
orders/            Saved orders (JSON + coin image), git-ignored
renders/           Clean AI renders, never served; git-ignored
```
