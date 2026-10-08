/**
 * Cloudflare Worker · 统计服务
 *
 * 替代原 Node.js 统计服务，部署在 Cloudflare Workers 上，使用 D1 (SQLite) 存储事件。
 * 免费额度：10 万次请求/天、5GB D1 存储，日活几千完全够用。
 *
 * API 与原服务一致：
 *   POST /api/events  — 上报事件（浏览器 sendBeacon / fetch）
 *   GET  /api/stats   — 查询统计（需 token）
 *   GET  /api/health  — 健康检查
 */

// ── 类型 ──────────────────────────────────────────────────

type EventName = 'visit' | 'start' | 'complete' | 'picks' | 'feedback';
type Helpfulness = 'yes' | 'partial' | 'no';
type FeedbackReason =
  | 'recommended_uninteresting'
  | 'missing_direction'
  | 'costs_not_agreed'
  | 'questions_off'
  | 'too_cautious'
  | 'other';

const EVENT_NAMES: EventName[] = ['visit', 'start', 'complete', 'picks', 'feedback'];
const FEEDBACK_REASONS: FeedbackReason[] = [
  'recommended_uninteresting',
  'missing_direction',
  'costs_not_agreed',
  'questions_off',
  'too_cautious',
  'other',
];

interface BaseEvent {
  name: EventName;
  sid: string;
  at: string;
}
interface VisitEvent extends BaseEvent {
  name: 'visit';
  items: number;
}
interface StartEvent extends BaseEvent {
  name: 'start';
}
interface CompleteEvent extends BaseEvent {
  name: 'complete';
  answered: number;
  total: number;
  confidence: 'high' | 'medium' | 'low';
  recommended: string[];
  feasible: number;
}
interface PicksEvent extends BaseEvent {
  name: 'picks';
  picked: string[];
}
interface FeedbackEvent extends BaseEvent {
  name: 'feedback';
  helpful: Helpfulness;
  reasons?: FeedbackReason[];
  comment?: string;
}
type TrackedEvent = VisitEvent | StartEvent | CompleteEvent | PicksEvent | FeedbackEvent;

interface DbRow {
  name: string;
  sid: string;
  at: string;
  payload: string;
}

interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
}

// ── 事件校验（与 src/analytics/events.ts 保持一致）──────────

function idList(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && /^\d{6,7}(TK|T|K)?$/.test(x))
        .slice(0, max)
    : [];
}

function sanitizeEvent(raw: unknown): TrackedEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;

  if (!EVENT_NAMES.includes(e.name as EventName)) return null;
  if (typeof e.sid !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(e.sid)) return null;
  if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) return null;

  const age = Math.abs(Date.now() - Date.parse(e.at));
  if (age > 1000 * 60 * 60 * 24) return null;

  const num = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : undefined;

  switch (e.name) {
    case 'visit':
      return { name: 'visit', sid: e.sid, at: e.at, items: num(e.items, 200) ?? 0 };
    case 'start':
      return { name: 'start', sid: e.sid, at: e.at };
    case 'complete': {
      const recommended = idList(e.recommended, 10);
      return {
        name: 'complete',
        sid: e.sid,
        at: e.at,
        answered: num(e.answered, 200) ?? 0,
        total: num(e.total, 200) ?? 0,
        confidence:
          e.confidence === 'high' || e.confidence === 'low'
            ? (e.confidence as 'high' | 'low')
            : 'medium',
        recommended,
        feasible: num(e.feasible, 500) ?? 0,
      };
    }
    case 'picks':
      return { name: 'picks', sid: e.sid, at: e.at, picked: idList(e.picked, 12) };
    case 'feedback': {
      const helpful =
        e.helpful === 'yes' || e.helpful === 'no' || e.helpful === 'partial'
          ? (e.helpful as Helpfulness)
          : null;
      if (!helpful) return null;
      const reasons = Array.isArray(e.reasons)
        ? (e.reasons.filter(
            (x) => typeof x === 'string' && FEEDBACK_REASONS.includes(x as FeedbackReason),
          ) as FeedbackReason[])
        : undefined;
      const comment =
        typeof e.comment === 'string' && e.comment.trim()
          ? e.comment.trim().slice(0, 500)
          : undefined;
      return { name: 'feedback', sid: e.sid, at: e.at, helpful, reasons, comment };
    }
    default:
      return null;
  }
}

// ── 统计聚合（与 server/stats.ts 保持一致）──────────────────

interface DailyRow {
  date: string;
  visits: number;
  starts: number;
  completes: number;
  feedbacks: number;
  completionRate: number;
}

interface Stats {
  generatedAt: string;
  totals: {
    visits: number;
    starts: number;
    completes: number;
    feedbacks: number;
    bounceRate: number;
    completionRate: number;
    avgAnswered: number;
    partialCompletes: number;
  };
  confidence: Record<'high' | 'medium' | 'low', number>;
  helpfulness: Record<'yes' | 'partial' | 'no', number>;
  helpfulRate: number;
  reasons: { key: string; label: string; count: number }[];
  comments: { at: string; helpful: string; comment: string }[];
  recommended: { id: string; count: number; unhappy: number }[];
  picks: { id: string; count: number; notRecommended: number }[];
  daily: DailyRow[];
}

const REASON_LABELS: Record<FeedbackReason, string> = {
  recommended_uninteresting: '推荐的专业我根本不感兴趣',
  missing_direction: '我感兴趣的方向没出现',
  costs_not_agreed: '它说的代价我不认同',
  questions_off: '问题问得不对，测不出我',
  too_cautious: '结论太保守，等于没说',
  other: '其他',
};

function emptyStats(): Stats {
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      visits: 0,
      starts: 0,
      completes: 0,
      feedbacks: 0,
      bounceRate: 0,
      completionRate: 0,
      avgAnswered: 0,
      partialCompletes: 0,
    },
    confidence: { high: 0, medium: 0, low: 0 },
    helpfulness: { yes: 0, partial: 0, no: 0 },
    helpfulRate: 0,
    reasons: [],
    comments: [],
    recommended: [],
    picks: [],
    daily: [],
  };
}

function aggregate(events: TrackedEvent[]): Stats {
  const base = emptyStats();
  base.generatedAt = new Date().toISOString();

  const visits = events.filter((e) => e.name === 'visit');
  const starts = events.filter((e) => e.name === 'start');
  const completesRaw = events.filter((e) => e.name === 'complete');
  const feedbacks = events.filter((e) => e.name === 'feedback');

  const latestComplete = new Map<string, CompleteEvent>();
  for (const e of completesRaw) {
    const prev = latestComplete.get(e.sid);
    if (!prev || prev.at <= e.at) latestComplete.set(e.sid, e);
  }
  const completes = [...latestComplete.values()];

  const visitSids = new Set(visits.map((e) => e.sid));
  const startSids = new Set(starts.map((e) => e.sid));
  const completeSids = new Set(latestComplete.keys());

  base.totals.visits = visitSids.size;
  base.totals.starts = startSids.size;
  base.totals.completes = completeSids.size;
  base.totals.feedbacks = new Set(feedbacks.map((e) => e.sid)).size;

  base.totals.bounceRate = visitSids.size ? 1 - startSids.size / visitSids.size : 0;
  base.totals.completionRate = visitSids.size ? completeSids.size / visitSids.size : 0;

  const answeredList = completes.map((e) => e.answered);
  base.totals.avgAnswered = answeredList.length
    ? Math.round((answeredList.reduce((s, n) => s + n, 0) / answeredList.length) * 10) / 10
    : 0;
  base.totals.partialCompletes = completes.length
    ? completes.filter((e) => e.total > 0 && e.answered < e.total).length / completes.length
    : 0;

  for (const e of completes) base.confidence[e.confidence] += 1;
  for (const e of feedbacks) base.helpfulness[e.helpful] += 1;

  const rated = feedbacks.length;
  base.helpfulRate = rated
    ? (base.helpfulness.yes + base.helpfulness.partial * 0.5) / rated
    : 0;

  const reasonCount = new Map<string, number>();
  for (const e of feedbacks) {
    for (const r of e.reasons ?? []) reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1);
  }
  base.reasons = [...reasonCount.entries()]
    .map(([key, count]) => ({
      key,
      label: REASON_LABELS[key as FeedbackReason] ?? key,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  base.comments = feedbacks
    .filter((e) => e.comment)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50)
    .map((e) => ({ at: e.at, helpful: e.helpful, comment: e.comment! }));

  const unhappySids = new Set(feedbacks.filter((e) => e.helpful === 'no').map((e) => e.sid));
  const rec = new Map<string, { count: number; unhappy: number }>();
  for (const e of completes) {
    const unhappy = unhappySids.has(e.sid);
    for (const id of e.recommended) {
      const cur = rec.get(id) ?? { count: 0, unhappy: 0 };
      cur.count += 1;
      if (unhappy) cur.unhappy += 1;
      rec.set(id, cur);
    }
  }
  base.recommended = [...rec.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const latestPicks = new Map<string, PicksEvent>();
  for (const e of events) {
    if (e.name !== 'picks') continue;
    const prev = latestPicks.get(e.sid);
    if (!prev || prev.at <= e.at) latestPicks.set(e.sid, e);
  }
  const recommendedBySid = new Map(completes.map((e) => [e.sid, e.recommended]));
  const pick = new Map<string, { count: number; notRecommended: number }>();
  for (const [sid, e] of latestPicks) {
    const recList = recommendedBySid.get(sid) ?? [];
    for (const id of e.picked) {
      const cur = pick.get(id) ?? { count: 0, notRecommended: 0 };
      cur.count += 1;
      if (!recList.includes(id)) cur.notRecommended += 1;
      pick.set(id, cur);
    }
  }
  base.picks = [...pick.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.notRecommended - a.notRecommended || b.count - a.count)
    .slice(0, 30);

  const days = new Set<string>();
  for (const e of events) days.add(e.at.slice(0, 10));
  base.daily = [...days]
    .sort()
    .slice(-30)
    .map((date) => {
      const of = (name: EventName) =>
        new Set(events.filter((e) => e.name === name && e.at.slice(0, 10) === date).map((e) => e.sid))
          .size;
      const v = of('visit');
      const c = of('complete');
      return {
        date,
        visits: v,
        starts: of('start'),
        completes: c,
        feedbacks: of('feedback'),
        completionRate: v ? c / v : 0,
      };
    });

  return base;
}

// ── CORS ──────────────────────────────────────────────────

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-stats-token',
  'access-control-max-age': '86400',
};

function corsHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...CORS_HEADERS, ...extra };
}

// ── Worker ────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === '/api/health' && request.method === 'GET') {
      return Response.json({ ok: true }, { headers: corsHeaders() });
    }

    if (path === '/api/events' && request.method === 'POST') {
      const text = await request.text();
      if (text.length > 4 * 1024) {
        return Response.json(
          { error: 'too_large' },
          { status: 413, headers: corsHeaders() },
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return Response.json(
          { error: 'bad_json' },
          { status: 400, headers: corsHeaders() },
        );
      }

      const event = sanitizeEvent(parsed);
      if (!event) {
        return Response.json(
          { error: 'invalid_event' },
          { status: 422, headers: corsHeaders() },
        );
      }

      await env.DB.prepare(
        'INSERT INTO events (name, sid, at, payload) VALUES (?, ?, ?, ?)',
      )
        .bind(event.name, event.sid, event.at, JSON.stringify(event))
        .run();

      return new Response(null, {
        status: 204,
        headers: corsHeaders({ 'cache-control': 'no-store' }),
      });
    }

    if (path === '/api/stats' && request.method === 'GET') {
      if (!env.STATS_TOKEN) {
        return Response.json(
          { error: 'stats_disabled_until_token_configured' },
          { status: 503, headers: corsHeaders() },
        );
      }

      const token = url.searchParams.get('token') ?? request.headers.get('x-stats-token');
      if (token !== env.STATS_TOKEN) {
        return Response.json(
          { error: 'unauthorized' },
          { status: 401, headers: corsHeaders() },
        );
      }

      const days = Math.min(
        90,
        Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14),
      );
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      const { results } = await env.DB.prepare(
        'SELECT name, sid, at, payload FROM events WHERE at >= ? ORDER BY at',
      )
        .bind(since)
        .all<DbRow>();

      const events: TrackedEvent[] = [];
      for (const row of results) {
        try {
          events.push(JSON.parse(row.payload));
        } catch {
          // 单行损坏不影响整体统计
        }
      }

      const stats = events.length ? aggregate(events) : emptyStats();
      return Response.json(stats, {
        headers: corsHeaders({ 'cache-control': 'no-store' }),
      });
    }

    return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders() });
  },
};
