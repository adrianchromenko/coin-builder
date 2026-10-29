# Coin Builder

A web app where a customer describes a custom coin in plain words, sees it AI-rendered, and orders it.

Two stages. **Design:** the customer uploads reference files (a logo or seal, which goes on the coin exactly as uploaded, and any photos, sketches or examples; or a link to their website, from which the server pulls the logo, see `lib/fetchimage.js`), describes the front and the back in their own words, adds style notes and picks round or odd shaped. One **Generate This Coin** renders both faces: the front first, then the back with the finished front as the AI's reference so shape, rim, border and finish match (the back can instead be the same design again, or blank; neither needs a render). Both faces are shown side by side with their versions, the wording of each is proofread, and a standing note says AI can misspell things with a **Contact Us to Fix My Design** popup that emails the designers. **Submit for quote:** a short form with the quantity (typed in) and the size (a list from 1" to 4" by quarter inch, or "Other" written in), then name, email, phone, company, the shipping address and notes. The finish, enamel color and add-ons are read from the design by the AI (see "Pricing" below), and an **estimate** priced from the company price chart shows the total, what it was priced as, and the lines behind it folded away. It saves the order under `orders/` with the quote the customer saw, and hands off to Stripe Checkout when a Stripe key is configured.

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
| `OPENAI_IMAGE_QUALITY` | `medium` | `medium` renders a face in about 25 to 35 seconds with clean lettering; `high` adds 15 to 25 seconds for a little more relief detail; `low` loses lettering accuracy |
| `REFERENCE_COUNT` | `2` | Reference coin photos sent per render, 3 at most (see `references/`) |
| `AI_MAX_ATTEMPTS` | `2` | Renders per request: a render that fails proofreading is redone with a note about what to fix |
| `AI_VERIFY` | on | `0` turns proofreading off |
| `MODERATE_UPLOADS` | on | Every logo and reference image is screened for sexual content, gore and self-harm before it reaches the image model (see `lib/moderate.js`); `0` turns that off |
| `OPENAI_VERIFY_MODEL` | `gpt-5.4-mini` | Vision model that proofreads each render and reads the design for the quote |
| `AI_READ_DESIGN` | on | `0` stops the quote step reading the design (finish, color sides, add-ons) from the renders |
| `PRICING` | on | `0` turns the estimate off: orders are saved as plain quote requests with no price shown |
| `STRIPE_SECRET_KEY` | | Enables Pay Now via Stripe Checkout, charging the quoted total line by line |
| `PUBLIC_URL` | | Deployed URL, used for Stripe return links |
| `ORDER_WEBHOOK_URL` | | Every order is POSTed here as JSON |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | | Every quote request becomes a Lead in Zoho CRM, render attached (`lib/zoho.js`; get the token with `scripts/zoho-token.js`) |
| `ZOHO_LEAD_SOURCE` | `Coin Builder` | Lead Source stamped on those leads |
| `ZOHO_OWNERS` | | The sales reps' CRM user ids, comma separated: the leads are dealt out to them in turn |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | | Enables email: order confirmations, design-fix requests and lead alerts; leads are saved in `leads/` |
| `MAIL_REPLY_TO` | From address | Where customers' replies go |
| `LEAD_WEBHOOK_URL` | | Every lead is POSTed here as JSON |
| `MAIL_PREVIEW_DIR` | | Testing: write emails to `.eml` files here instead of sending |
| `FETCH_LIMIT_PER_HOUR` | `40` | How many "paste a link" logo fetches one visitor may ask for in an hour |
| `TEST_MODE` | | `1` forces test mode for everyone (see below) |
| `RENDERS_PER_HOUR`, `RENDERS_PER_DAY` | `10`, `25` | AI renders one visitor (IP) may make |
| `RENDERS_PER_DAY_TOTAL` | `300` | AI renders the whole site may make per day (ET); the team is emailed at 80% and 100% |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | | Cloudflare Turnstile: every render must come from a real browser (recommended in production) |
| `ORDER_LIMIT_PER_HOUR` | `20` | Order submissions per IP per hour |
| `PORT` | `3000` | HTTP port |

## How a render is made

Image models are good at metal and bad at spelling, so the pipeline is built around not trusting them:

1. The customer's answers (front and back descriptions, style notes, shape) become the prompt in `lib/prompt.js` (`buildDescribedPrompt`). Anything the customer put in **double quotes** is treated as exact lettering: it is quoted, counted and spelled out letter by letter, and the prompt forbids any other wording. The logo, when given, is the first input image and declared off-limits for restyling. A metal finish named in the style notes also picks matching factory photos from `references/` for realism. An odd-shaped coin is shown only the odd-shaped factory photos in `references/coins/odd-shaped/`, and the prompt tells the model to cut the coin to whatever outline the customer described (or to the artwork when they named none).
2. Each face is one request to `/api/generate` (`side=front` or `side=back`); the page makes the two requests one after the other from a single Generate, with one progress ring across both. A **back** described by the customer is rendered after the front, with the front's clean render as the first input image and the same factory photos, so it comes out as the same coin turned over; it has its own proofreading and its own versions in the page. **Make Another Version** asks which side to redraw (both, the front, or the back); a redrawn front has the back drawn again to match it. The order route composes the two clean originals side by side (`lib/composite.js`), front on the left, or the front twice when the back is "same as the front". A two-sided coin spends two renders of the daily budget.
3. `lib/providers.js` renders with the best model available (image edits when there is a logo or reference photos, plain generation otherwise).
4. `lib/verify.js` **proofreads the result**: a vision model reads the lettering off the render alone, character by character, twice, and every quoted phrase must come back in both readings; a second pass compares the logo with the uploaded artwork. A wrong render is redone once with specific feedback; the better attempt is returned with its report.
5. The customer sees a green "Wording checked" or an amber "not quite right" note that quotes what the AI actually wrote, always followed by the note that AI can misspell wording and the **Contact Us to Fix My Design** button (`/api/contact`: the message, the design in their words and the latest render go to `ORDER_NOTIFY_TO`, and the lead is saved). Every render is kept as a **version** under the coin; picking an older version also brings back the description it was made from, so the picture and the order always match.
6. **Nothing clean leaves the server.** `lib/watermark.js` keeps the original in `renders/` (git-ignored, swept after `RENDER_KEEP_DAYS`) and gives the browser only a small, lightly watermarked preview. When a customer orders an AI version, the order gets the clean original from the server's own copy. Right-click, long-press and drag are blocked on coin images, but that only stops casual saving; the watermark is what actually protects the artwork, because a screenshot is always possible.

The earlier option-based builder (finish, color, shape, rim, background, per-side layout engine) is in git history up to commit `17bc279` if it is ever wanted back.

### Keeping the OpenAI bill in check

Each render costs real money whether or not the visitor orders, so `lib/guard.js` sits in front of `/api/generate`:

1. One render at a time per visitor, and per-visitor hourly and daily caps (`RENDERS_PER_HOUR`, `RENDERS_PER_DAY`).
2. A site-wide daily budget (`RENDERS_PER_DAY_TOTAL`). When it is spent, rendering pauses for everyone until midnight ET and the team is emailed (at 80% and at 100%). The count lives in `DATA_DIR/render-count.json` so a restart does not reset it.
3. Repeats are free: the exact same art proof with the exact same options within 24 hours gets the earlier render back.
4. Optional Cloudflare Turnstile (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`): each render carries a token proving it came from a real browser, which is what stops scripted abuse from many IP addresses. Test mode never renders, so it is not affected by any of this.

The proofreader reads the render without seeing the art proof on purpose. When it could see the intended wording it "corrected" typos in its head and passed misspelled coins.

## Pricing

Quotes are priced from `lib/price-chart.json`, which is the company's **Expanded Pricing Chart** spreadsheet turned into data. When the chart changes, re-import it (the sheet layout is described at the top of the script):

```bash
pip install openpyxl
python scripts/import-pricing.py "C:/Users/User/Downloads/Expanded Pricing Chart 2026 Oct 29.xlsx"
```

`lib/pricing.js` prices an order the way the chart does:

- **Coins.** Each size (1" to 4" by quarter inch) has a per-coin price per finish group (antique brass; shiny nickel / shiny silver; copper; antique or satin silver; gold; black) by quantity tier. Up to 50 coins there is one price with any enamel color included; from 51 coins the price depends on color on no side, one side or both. The chart stops at 1,200 coins: above that, and for a size written in words, no estimate is shown and the team quotes by hand.
- **Mold and set-up.** One mold fee per order, by size ($140 for 1" up to $379 for 4").
- **Add-ons.** Per coin, some with a one-time setup fee (stamped edge, reeded edge, keychain, picture insert, custom ribbons, screen print).
- **Packaging.** Per coin, cheaper from 75 coins; each piece adds a little to shipping.
- **Rush** (under 10 business days). $75 up to 50 coins, $80 for 51 to 99, 20% of the coin cost from 100.
- **Shipping.** The chart's ground-shipping guide by size and quantity, from a few dollars for a handful of coins up; 1" to 2.25" coins ship free from 300 coins, larger coins at so much per coin.

The estimate updates as the customer changes the quantity or size, and the order record keeps the lines they saw (`quote`), so the team's email and the Zoho lead show the same numbers. Sales tax is not included. Packaging and rush are not asked for on the form (they go in the notes for the team to quote), so `quote()` is called without them from the builder; the pricing still supports them for the team's own use.

**The design is read before it is priced** (`lib/analyze.js`). On the way to the quote, the finished front and back renders and the customer's words go to the vision model, which answers a fixed set of questions: the plating metal, which faces carry enamel color, whether a face shows two different platings, the edge treatment, a keychain loop, a printed photo, and whether the words ask for edge lettering, numbering or engraved names. The answers are the spec: the finish, color sides and add-ons are set from the design and nothing is charged that the picture or the words do not clearly call for. The estimate waits ("Reading your design to price it…") until the answer is in, then says in one line what the coin was priced as (per-coin price, finish, color, add-ons). The customer does not pick plating or add-ons themselves; anything else (a keychain, numbering, a different metal, packaging, rush) goes in the notes for the team to quote. The order record keeps the reading (`analysis`), and the team's email and the Zoho lead show it beside the quote. Only when the design could not be read, or reading is off (`AI_READ_DESIGN=0`), do the finish and color controls appear, with the finish guessed from the style notes.

## Test mode

Open `/test` or `/?test=1` to turn test mode on for that browser tab (the header switch then appears; `/test/off` turns it off). Switching it does not clear the form, so you can flip it on right before placing an order.

In test mode:

- Nothing is sent to the AI provider; a placeholder coin marked TEST RENDER is shown instead.
- The design email and the "fix my design" message are saved as leads but not sent.
- The quote form runs as normal: quantity, size, contact details and shipping address, sent as one request (the shipping address stands as the billing address too).
- Orders are saved to `orders/` with a `TEST-` id and `"status": "test"`. Stripe Checkout and `ORDER_WEBHOOK_URL` are never called.
- After the order is saved a **test checkout popup** opens: the quote line by line, card form, Pay button, success screen. Use `4242 4242 4242 4242`, any future expiry, any CVC. Nothing is charged and the card number never leaves the browser; only the last four digits are saved with the order, which moves to `"status": "test_paid"`. When the chart cannot price the order a sample price is shown.

Set `TEST_MODE=1` in `.env` to force test mode for every visitor, for example on a staging server.

## Deploy

Any Node host works (Render, Railway, Fly). Set the environment variables above and use `npm start`.

Set `PUBLIC_URL` to the real address (for example `https://builder.coinsforanything.com`, no trailing slash). It is used in the share-preview tags, the canonical link, the sitemap, Stripe return links and the "Order your coins" button in design emails. Without it the server falls back to the address each request arrived on, which is fine locally but wrong behind some proxies.

## Share link and SEO

`public/index.html` is served as a template: the server fills in `{{SITE_URL}}` so every absolute URL matches the deployment.

- **Link previews.** Open Graph and Twitter tags point at `public/share.jpg` (1200 x 630), so a pasted link shows a branded card in Facebook, LinkedIn, X, iMessage, WhatsApp, Slack and Teams. The image URL carries a version hash, so networks pick up a new card after `npm run share-image` (which rebuilds the card and the icons from the logo and a coin photo in `references/coins/`). After deploying a new card, refresh Facebook's cache at https://developers.facebook.com/tools/debug/ and LinkedIn's at https://www.linkedin.com/post-inspector/.
- **Search.** Title, meta description, canonical link, `robots.txt`, `sitemap.xml` and JSON-LD (Organization, WebApplication, WebPage) are all served. Only the builder page is indexable; `/api`, `/mail-img`, `/signups.csv`, `/healthz` and `/test` answer with `X-Robots-Tag: noindex` and are disallowed in `robots.txt`. Submit `PUBLIC_URL/sitemap.xml` in Google Search Console once deployed.
- **Icons.** `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `site.webmanifest` cover browser tabs, bookmarks and home-screen shortcuts.

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
lib/analyze.js     Reads the finished design with the vision model: finish, color sides and add-ons, with reasons
lib/pricing.js     Prices a quote from the price chart (coins, mold, add-ons, packaging, rush, shipping)
lib/price-chart.json  The Expanded Pricing Chart spreadsheet as data (scripts/import-pricing.py rebuilds it)
lib/orders.js      Saves orders to ./orders, webhook + Stripe Checkout
orders/            Saved orders (JSON + coin image), git-ignored
renders/           Clean AI renders, never served; git-ignored
```
