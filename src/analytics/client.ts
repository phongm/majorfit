import type { CompleteEvent, EventName, FeedbackEvent, PicksEvent, TrackedEvent, VisitEvent } from './events';

const SESSION_KEY = 'majorfit.session';

/** 随机会话号：只用于把同一人的漏斗步骤串起来，关页面即失效，不跨会话追踪 */
export function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // 隐私模式下 sessionStorage 不可用：退化成一次性随机数，宁可丢串联也不报错
    return crypto.randomUUID();
  }
}

const ENDPOINT = import.meta.env.VITE_STATS_ENDPOINT ?? '/api/events';
const ENABLED = import.meta.env.VITE_STATS_DISABLED !== '1';

/**
 * 发一次就完事，不重试、不入队。
 * 统计不该影响用户：网络不通、服务挂了、被广告拦截插件挡了，都静默失败。
 */
function send(event: TrackedEvent) {
  if (!ENABLED) return;
  const body = JSON.stringify(event);
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* 静默 */
  }
}

function base(name: EventName): { name: EventName; sid: string; at: string } {
  return { name, sid: sessionId(), at: new Date().toISOString() };
}

export const track = {
  visit(items: number): void {
    send({ ...base('visit'), name: 'visit', items } satisfies VisitEvent);
  },
  start(): void {
    send({ ...base('start'), name: 'start' });
  },
  complete(input: Omit<CompleteEvent, keyof ReturnType<typeof base> | 'name'>): void {
    send({ ...base('complete'), name: 'complete', ...input });
  },
  picks(input: Omit<PicksEvent, keyof ReturnType<typeof base> | 'name'>): void {
    send({ ...base('picks'), name: 'picks', ...input });
  },
  feedback(input: Omit<FeedbackEvent, keyof ReturnType<typeof base> | 'name'>): void {
    send({ ...base('feedback'), name: 'feedback', ...input });
  },
};
