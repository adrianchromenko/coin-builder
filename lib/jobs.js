/**
 * Renders in flight, kept so the browser can pick the result up over a fresh connection.
 *
 * A render takes a minute or more. A phone drops a request that long the moment the screen locks, the visitor
 * switches apps, or the network changes hands (Safari calls it "Load failed"). So the page no longer waits on the
 * request that started the render: that one answers at once with the job id, the render carries on here, and the
 * page polls for the result with short requests that can be retried as often as needed.
 *
 * The id is chosen by the page (it is the progress-stream id, see lib/progress.js), so a request that reaches
 * the server twice because the first answer was lost starts one render, not two.
 */
const ID_RE = /^[a-z0-9]{8,40}$/;
const MAX_JOBS = 500;
const KEEP_MS = 15 * 60 * 1000; // a finished result waits this long to be collected
const jobs = new Map(); // id -> { status: 'running'|'done', at, code, body }

const valid = (id) => ID_RE.test(String(id || ''));

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.status === 'done' && now - job.at > KEEP_MS) jobs.delete(id);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
}

// Start a job unless one with this id is already known. Returns false when it is (the caller answers with the id).
function start(id) {
  sweep();
  if (jobs.has(id)) return false;
  jobs.set(id, { status: 'running', at: Date.now(), code: 0, body: null });
  return true;
}

// The job's answer: the status code and JSON body the render route would have sent
function finish(id, code, body) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, { status: 'done', at: Date.now(), code, body });
}

const get = (id) => jobs.get(id) || null;

// Express handler: GET /api/generate/:id. 202 while the render runs, the render's own answer once it is done,
// 404 when the id is unknown (never started, or finished and collected long ago).
function poll(req, res) {
  const id = req.params.id;
  if (!valid(id)) return res.status(400).json({ error: 'Bad job id' });
  const job = jobs.get(id);
  res.set('Cache-Control', 'no-store');
  if (!job) return res.status(404).json({ error: 'That render is no longer on our side. Please generate it again.' });
  if (job.status !== 'done') return res.status(202).json({ status: 'running', since: job.at });
  return res.status(job.code).json(job.body);
}

module.exports = { valid, start, finish, get, poll };
