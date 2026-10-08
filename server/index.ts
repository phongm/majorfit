/**
 * 访问量统计服务。没有数据库：事件按天追加成 JSONL，统计时现读现算。
 *
 * 为什么够用：日活几千量级下，一天的日志是几 MB 文本，全量扫一遍几十毫秒。
 * 上数据库换来的是查询速度，付出的是备份、迁移、连接池和一套运维。
 * 等日志大到扫不动了再换，届时的迁移只是把 JSONL 灌进去。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeEvent, type TrackedEvent } from '../src/analytics/events.ts';
import { aggregate, emptyStats } from './stats.ts';

const PORT = Number(process.env.PORT ?? 8787);
const LOG_DIR = process.env.LOG_DIR ?? 'logs';
const STATS_TOKEN = process.env.STATS_TOKEN ?? '';
const MAX_BODY = 4 * 1024;
/** 单 IP 每分钟事件上限。公开写接口不设限，日志很快就会被灌满 */
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN ?? 30);

const buckets = new Map<string, { windowStart: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > 60_000) {
    buckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_PER_MIN;
}

// 长时间运行会让这张表只增不减
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ip, b] of buckets) if (b.windowStart < cutoff) buckets.delete(ip);
}, 60_000).unref();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function clientIp(req: IncomingMessage): string {
  // 只有确认前面是自己人的 Nginx 时才信任 XFF，否则它就是伪造的
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && process.env.TRUST_PROXY === '1') {
    return forwarded.split(',')[0]!.trim() || 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function dayOf(iso: string) {
  return iso.slice(0, 10);
}

async function appendEvent(event: TrackedEvent) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(join(LOG_DIR, `events-${dayOf(event.at)}.jsonl`), `${JSON.stringify(event)}\n`);
}

async function loadEvents(days: number): Promise<TrackedEvent[]> {
  let files: string[] = [];
  try {
    files = (await readdir(LOG_DIR)).filter((f) => f.endsWith('.jsonl')).sort().reverse();
  } catch {
    return [];
  }
  const wanted = files.slice(0, Math.max(1, days));
  const out: TrackedEvent[] = [];
  for (const f of wanted) {
    const text = await readFile(join(LOG_DIR, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = sanitizeEvent(JSON.parse(line), { ignoreAge: true });
        if (parsed) out.push(parsed);
      } catch {
        /* 单行损坏不影响整体统计 */
      }
    }
  }
  return out;
}

const server = createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    console.error('[stats] 未处理异常', err);
    if (!res.headersSent) json(res, 500, { error: 'internal' });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/events') {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      json(res, 413, { error: 'too_large' });
      return;
    }
    if (rateLimited(clientIp(req))) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      json(res, 400, { error: 'bad_json' });
      return;
    }
    const event = sanitizeEvent(parsed);
    if (!event) {
      json(res, 422, { error: 'invalid_event' });
      return;
    }
    await appendEvent(event);
    json(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    if (!STATS_TOKEN) {
      json(res, 503, { error: 'stats_disabled_until_token_configured' });
      return;
    }
    const token = url.searchParams.get('token') ?? req.headers['x-stats-token'];
    if (token !== STATS_TOKEN) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14));
    const events = await loadEvents(days);
    json(res, 200, events.length ? aggregate(events) : emptyStats());
    return;
  }

  json(res, 404, { error: 'not_found' });
}

await mkdir(LOG_DIR, { recursive: true });
// DEPLOY.md 写明「只绑 127.0.0.1 由 Nginx 对外」：默认就得真绑回环，
// 否则统计服务的写接口和口令都白设。要用 BIND 显式放开。
server.listen(PORT, process.env.BIND ?? '127.0.0.1', () => {
  console.log(`[stats] 监听 ${PORT}，日志目录 ${LOG_DIR}`);
  if (!STATS_TOKEN) console.log('[stats] 未设置 STATS_TOKEN，统计查询接口关闭（上报不受影响）');
});
