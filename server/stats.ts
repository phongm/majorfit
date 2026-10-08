import type { CompleteEvent, PicksEvent, TrackedEvent } from '../src/analytics/events.ts';
import { REASON_LABELS } from '../src/analytics/events.ts';

export interface DailyRow {
  date: string;
  visits: number;
  starts: number;
  completes: number;
  feedbacks: number;
  /** 完单率：完成人数 / 访问人数 */
  completionRate: number;
}

export interface Stats {
  generatedAt: string;
  totals: {
    visits: number;
    starts: number;
    completes: number;
    feedbacks: number;
    /** 打开却没开始答题的人占比，用来判断首屏有没有劝退 */
    bounceRate: number;
    completionRate: number;
    /** 答完的人平均答了几题 */
    avgAnswered: number;
    /** 答完但没答全的比例，反映题目太长 */
    partialCompletes: number;
  };
  confidence: Record<'high' | 'medium' | 'low', number>;
  helpfulness: Record<'yes' | 'partial' | 'no', number>;
  /** 觉得有帮助的人数 / 给了反馈的人数 */
  helpfulRate: number;
  reasons: { key: string; label: string; count: number }[];
  comments: { at: string; helpful: string; comment: string }[];
  /** 各专业被推荐的次数，与反馈交叉才能判断「推荐得准不准」 */
  recommended: { id: string; count: number; unhappy: number }[];
  /**
   * 用户自己挑的专业：被挑次数 × 其中多少次没进 Top5。
   * 注意 notRecommended 只说明「系统没把它排进前 5」，不等于「我们没画像」——
   * 可行但排在第 6 也算进去了。它是指引录哪批专业的信号，不是结论。
   */
  picks: { id: string; count: number; notRecommended: number }[];
  daily: DailyRow[];
}

export function emptyStats(): Stats {
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

const uniq = <T>(list: T[]) => new Set(list).size;

export function aggregate(events: TrackedEvent[]): Stats {
  const base = emptyStats();
  base.generatedAt = new Date().toISOString();

  const visits = events.filter((e) => e.name === 'visit');
  const starts = events.filter((e) => e.name === 'start');
  const completesRaw = events.filter((e) => e.name === 'complete');
  const feedbacks = events.filter((e) => e.name === 'feedback');

  /**
   * 一个会话只认最后一次完单。
   * 「重做」会再报一次 complete，逐事件累加的话一个人会被算成几个人，
   * avgAnswered、置信度分布、各专业被推次数全都会被同一个人灌水。
   */
  const latestComplete = new Map<string, CompleteEvent>();
  for (const e of completesRaw) {
    const prev = latestComplete.get(e.sid);
    if (!prev || prev.at <= e.at) latestComplete.set(e.sid, e);
  }
  const completes = [...latestComplete.values()];

  const visitSids = new Set(visits.map((e) => e.sid));
  const startSids = new Set(starts.map((e) => e.sid));
  const completeSids = new Set(latestComplete.keys());

  base.totals.visits = uniq([...visitSids]);
  base.totals.starts = uniq([...startSids]);
  base.totals.completes = uniq([...completeSids]);
  base.totals.feedbacks = uniq(feedbacks.map((e) => e.sid));

  // 只算真正开始过的会话，避免把误点进来的人算成流失
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
  base.helpfulRate = rated ? (base.helpfulness.yes + base.helpfulness.partial * 0.5) / rated : 0;

  const reasonCount = new Map<string, number>();
  for (const e of feedbacks) {
    for (const r of e.reasons ?? []) reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1);
  }
  base.reasons = [...reasonCount.entries()]
    .map(([key, count]) => ({ key, label: REASON_LABELS[key as keyof typeof REASON_LABELS] ?? key, count }))
    .sort((a, b) => b.count - a.count);

  base.comments = feedbacks
    .filter((e) => e.comment)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50)
    .map((e) => ({ at: e.at, helpful: e.helpful, comment: e.comment! }));

  /**
   * 推荐次数 × 不满意度交叉。
   * 这是唯一能回答「哪些专业的推荐经常不被认账」的视角，
   * 也是后面校准专业画像数据的输入。
   */
  const rec = new Map<string, { count: number; unhappy: number }>();
  const unhappySids = new Set(feedbacks.filter((e) => e.helpful === 'no').map((e) => e.sid));
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

  /**
   * 自选清单来自 picks 事件，且**每个会话只取最后一次**：
   * 反复勾选会报多条，全算进去等于用操作次数冒充人数。
   */
  const latestPicks = new Map<string, PicksEvent>();
  for (const e of events) {
    if (e.name !== 'picks') continue;
    const prev = latestPicks.get(e.sid);
    if (!prev || prev.at <= e.at) latestPicks.set(e.sid, e);
  }
  const recommendedBySid = new Map(completes.map((e) => [e.sid, e.recommended]));

  const pick = new Map<string, { count: number; notRecommended: number }>();
  for (const [sid, e] of latestPicks) {
    const rec = recommendedBySid.get(sid) ?? [];
    for (const id of e.picked) {
      const cur = pick.get(id) ?? { count: 0, notRecommended: 0 };
      cur.count += 1;
      if (!rec.includes(id)) cur.notRecommended += 1;
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
      const of = (name: TrackedEvent['name']) =>
        new Set(events.filter((e) => e.name === name && e.at.slice(0, 10) === date).map((e) => e.sid)).size;
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
