import { describe, expect, it } from 'vitest';
import { sanitizeEvent, type TrackedEvent } from '../src/analytics/events';
import { aggregate, emptyStats } from '../server/stats';

const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const now = new Date().toISOString();

function evt(over: Record<string, unknown>) {
  return { name: 'visit', sid, at: now, ...over };
}

describe('事件校验：公开写接口的边界', () => {
  it('拒绝未知事件名与非对象输入', () => {
    expect(sanitizeEvent(null)).toBeNull();
    expect(sanitizeEvent('x')).toBeNull();
    expect(sanitizeEvent(evt({ name: 'drop_database' }))).toBeNull();
  });

  it('拒绝非法会话号，避免日志被灌成垃圾', () => {
    expect(sanitizeEvent(evt({ sid: '' }))).toBeNull();
    expect(sanitizeEvent(evt({ sid: '../../../etc/passwd' }))).toBeNull();
    expect(sanitizeEvent(evt({ sid: 'x'.repeat(200) }))).toBeNull();
  });

  it('拒绝伪造时间戳，但允许重放历史日志', () => {
    const old = evt({ at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() });
    expect(sanitizeEvent(old)).toBeNull();
    expect(sanitizeEvent(old, { ignoreAge: true })).not.toBeNull();
  });

  it('丢弃答题内容字段：服务端结构里根本没有装答案的地方', () => {
    const out = sanitizeEvent(evt({ name: 'complete', answered: 20, total: 39, answers: { t_math: 'hate' } })) as
      | Extract<TrackedEvent, { name: 'complete' }>
      | null;
    expect(out).not.toBeNull();
    expect(out && 'answers' in out).toBe(false);
    expect(out?.answered).toBe(20);
  });

  it('自选清单只收目录代码形状的 id，其余丢弃', () => {
    const out = sanitizeEvent(
      evt({ name: 'picks', picked: ['100201K', '0502100T', '<script>', 'x'.repeat(50), 7, '0809'] }),
    ) as Extract<TrackedEvent, { name: 'picks' }> | null;
    expect(out?.picked).toEqual(['100201K', '0502100T']);
  });

  it('picks 事件不给答题内容留位置', () => {
    const out = sanitizeEvent(evt({ name: 'picks', picked: ['080901'], answers: { t_math: 'hate' } }));
    expect(out).toEqual({ name: 'picks', sid, at: now, picked: ['080901'] });
  });

  it('数值越界被夹紧，不给注入面', () => {
    const out = sanitizeEvent(
      evt({ name: 'complete', answered: -5, total: 1e9, feasible: 99999, recommended: ['080901', '<script>', 'x'.repeat(50)] }),
    ) as Extract<TrackedEvent, { name: 'complete' }>;
    expect(out.answered).toBe(0);
    expect(out.total).toBe(0);
    expect(out.feasible).toBe(0);
    expect(out.recommended).toEqual(['080901']);
  });

  it('反馈正文被截断，未识别的原因被丢掉', () => {
    const out = sanitizeEvent(
      evt({ name: 'feedback', helpful: 'no', reasons: ['questions_off', 'rm -rf'], comment: '啊'.repeat(900) }),
    ) as Extract<TrackedEvent, { name: 'feedback' }>;
    expect(out.reasons).toEqual(['questions_off']);
    expect(out.comment?.length).toBe(500);
  });

  it('没给 helpful 的反馈被拒', () => {
    expect(sanitizeEvent(evt({ name: 'feedback' }))).toBeNull();
  });
});

function complete(sidN: string, day: string, over: Partial<Extract<TrackedEvent, { name: 'complete' }>> = {}): TrackedEvent {
  return {
    name: 'complete',
    sid: sidN,
    at: `${day}T08:00:00.000Z`,
    answered: 39,
    total: 39,
    confidence: 'medium',
    recommended: ['080901'],
    feasible: 40,
    ...over,
  };
}

describe('聚合口径', () => {
  it('空日志不炸', () => {
    expect(aggregate([]).totals.visits).toBe(0);
    expect(emptyStats().totals.completionRate).toBe(0);
  });

  it('同一会话的重复事件只算一次', () => {
    const s = aggregate([
      { name: 'visit', sid: 'a'.repeat(8), at: '2026-10-01T01:00:00Z', items: 39 },
      { name: 'visit', sid: 'a'.repeat(8), at: '2026-10-01T01:00:05Z', items: 39 },
      complete('a'.repeat(8), '2026-10-01'),
    ]);
    expect(s.totals.visits).toBe(1);
    expect(s.totals.completes).toBe(1);
  });

  it('完单率按会话算，误点进来就走的人拉低它', () => {
    const events: TrackedEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `s${i}`.padEnd(32, '0');
      events.push({ name: 'visit', sid: id, at: '2026-10-01T01:00:00Z', items: 39 });
      if (i < 2) events.push({ name: 'start', sid: id, at: '2026-10-01T01:01:00Z' });
      if (i < 1) events.push(complete(id, '2026-10-01'));
    }
    const s = aggregate(events);
    expect(s.totals.visits).toBe(4);
    expect(s.totals.starts).toBe(2);
    expect(s.totals.completes).toBe(1);
    expect(s.totals.bounceRate).toBeCloseTo(0.5);
    expect(s.totals.completionRate).toBeCloseTo(0.25);
  });

  it('把「觉得没帮助」的会话与它收到的推荐交叉出来', () => {
    const unhappy = 'u'.repeat(8) + '0'.repeat(24);
    const s = aggregate([
      complete('g'.repeat(8) + '0'.repeat(24), '2026-10-01', { recommended: ['080901', '080601'] }),
      complete(unhappy, '2026-10-01', { recommended: ['080901'] }),
      { name: 'feedback', sid: unhappy, at: '2026-10-01T09:00:00Z', helpful: 'no', reasons: ['recommended_uninteresting'] },
    ]);
    const cs = s.recommended.find((r) => r.id === '080901');
    expect(cs?.count).toBe(2);
    expect(cs?.unhappy).toBe(1);
    expect(s.reasons[0]?.count).toBe(1);
    expect(s.helpfulness.no).toBe(1);
  });

  it('有帮助率把「说不上」按半分计算', () => {
    const s = aggregate([
      { name: 'feedback', sid: 'a'.repeat(32), at: '2026-10-01T09:00:00Z', helpful: 'yes' },
      { name: 'feedback', sid: 'b'.repeat(32), at: '2026-10-01T09:00:00Z', helpful: 'partial' },
      { name: 'feedback', sid: 'c'.repeat(32), at: '2026-10-01T09:00:00Z', helpful: 'no' },
    ]);
    expect(s.helpfulRate).toBeCloseTo(0.5);
  });

  it('按天分行，能看出趋势而不是只有一个总数', () => {
    const s = aggregate([
      { name: 'visit', sid: 'a'.repeat(32), at: '2026-09-30T01:00:00Z', items: 39 },
      { name: 'visit', sid: 'b'.repeat(32), at: '2026-10-01T01:00:00Z', items: 39 },
    ]);
    expect(s.daily.map((d) => d.date)).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('自选清单的聚合', () => {
  const sidOf = (n: string) => `${n}-0000-0000-0000-000000000000`;
  const completeFor = (n: string, recommended: string[]): TrackedEvent => ({
    ...complete(sidOf(n), '2026-10-01'),
    recommended,
  } as TrackedEvent);
  const picks = (n: string, at: string, picked: string[]): TrackedEvent => ({
    name: 'picks',
    sid: sidOf(n),
    at: `2026-10-01T${at}:00.000Z`,
    picked,
  });

  it('算出「多少个会话挑了它」与「其中多少次没进 Top5」', () => {
    const stats = aggregate([
      completeFor('s1', ['080901']),
      picks('s1', '09', ['100201K']),
      completeFor('s2', ['080901']),
      picks('s2', '09', ['100201K', '080901']),
    ]);
    expect(stats.picks).toEqual([
      { id: '100201K', count: 2, notRecommended: 2 },
      { id: '080901', count: 1, notRecommended: 0 },
    ]);
  });

  it('同一会话反复勾选只算最后一次，不用操作次数冒充人数', () => {
    const stats = aggregate([
      completeFor('s1', ['080901']),
      picks('s1', '09', ['100201K', '080903']),
      picks('s1', '10', ['080903']),
    ]);
    expect(stats.picks).toEqual([{ id: '080903', count: 1, notRecommended: 1 }]);
  });

  it('没挑东西的会话不进 picks，不能凭空造出需求', () => {
    expect(aggregate([completeFor('s1', ['080901'])]).picks).toEqual([]);
    expect(emptyStats().picks).toEqual([]);
  });

  it('挑了但这一会话没完单时，仍算「没进 Top5」，因为没有推荐它', () => {
    const stats = aggregate([picks('s9', '09', ['080901'])]);
    expect(stats.picks).toEqual([{ id: '080901', count: 1, notRecommended: 1 }]);
  });
});
