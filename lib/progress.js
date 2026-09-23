/**
 * Live progress for a render in flight, streamed to the browser as server-sent events.
 *
 * The page picks an id, opens GET /api/progress/:id, then posts the render with that id. The render route
 * emits stages ("rendering", "checking", ...) as the provider reaches them, and closes the channel when done.
 * The last event is kept so a browser that connects a moment late still sees where things stand.
 */
const ID_RE = /^[a-z0-9]{8,40}$/;
const MAX_CHANNELS = 500;
const channels = new Map(); // id -> { subscribers: Set<res>, last: object|null, timer }

const valid = (id) => ID_RE.test(String(id || ''));

function channel(id) {
  let ch = channels.get(id);
  if (!ch) {
    if (channels.size >= MAX_CHANNELS) channels.delete(channels.keys().next().value);
    ch = { subscribers: new Set(), last: null, timer: null };
    channels.set(id, ch);
  }
  return ch;
}

const write = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

// Express handler for the event stream
function subscribe(req, res) {
  const id = req.params.id;
  if (!valid(id)) return res.status(400).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const ch = channel(id);
  ch.subscribers.add(res);
  if (ch.last) write(res, ch.last);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); ch.subscribers.delete(res); });
}

function emit(id, event) {
  if (!valid(id)) return;
  const ch = channel(id);
  ch.last = { ...event, at: Date.now() };
  for (const res of ch.subscribers) write(res, ch.last);
  // A channel nobody closed (a crash mid-render) is dropped after a while
  clearTimeout(ch.timer);
  ch.timer = setTimeout(() => close(id), 10 * 60 * 1000);
}

function close(id) {
  const ch = channels.get(id);
  if (!ch) return;
  clearTimeout(ch.timer);
  for (const res of ch.subscribers) { try { res.end(); } catch (_) {} }
  channels.delete(id);
}

module.exports = { subscribe, emit, close, valid };
