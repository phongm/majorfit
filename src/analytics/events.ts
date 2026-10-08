/**
 * 埋点事件定义。
 *
 * 边界：服务端只收计数与系统输出，不收任何答题明细。
 * 用户是准大学生，多数未满 18 岁，问卷里还含体检色觉、视力这类敏感个人信息，
 * 一旦落库就是未成年人敏感信息存储，合规成本完全不同。
 * 因此这里刻意不导出任何「答案」类型，只导出题数、置信度和推荐结果 id。
 */

export const EVENT_NAMES = ['visit', 'start', 'complete', 'picks', 'feedback'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export type Helpfulness = 'yes' | 'partial' | 'no';

/** 反馈里可勾选的问题类型，用于定位是哪一类失准 */
export const FEEDBACK_REASONS = [
  'recommended_uninteresting',
  'missing_direction',
  'costs_not_agreed',
  'questions_off',
  'too_cautious',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const REASON_LABELS: Record<FeedbackReason, string> = {
  recommended_uninteresting: '推荐的专业我根本不感兴趣',
  missing_direction: '我感兴趣的方向没出现',
  costs_not_agreed: '它说的代价我不认同',
  questions_off: '问题问得不对，测不出我',
  too_cautious: '结论太保守，等于没说',
  other: '其他',
};

export interface BaseEvent {
  name: EventName;
  /** 会话标识：随机数，存在 sessionStorage，关页面即失效，不用于识别个人 */
  sid: string;
  at: string;
}

export interface VisitEvent extends BaseEvent {
  name: 'visit';
  /** 题库总题数，用来发现「打开就退出」的比例 */
  items: number;
}

export interface StartEvent extends BaseEvent {
  name: 'start';
}

export interface CompleteEvent extends BaseEvent {
  name: 'complete';
  answered: number;
  total: number;
  confidence: 'high' | 'medium' | 'low';
  /** 系统给出的前几个专业 id。这是判断「推荐是否合理」的锚点，不含用户信息 */
  recommended: string[];
  /** 可行集大小，用于发现约束把所有人都挡干净了的场景 */
  feasible: number;
}

/**
 * 自选清单：离开浏览页回到结果页时报一次，装的是目录代码。
 *
 * 单独成事件而不是挂在 complete 上，因为真实路径是「先看结果 → 再去挑 → 回来对比」，
 * 挂在 complete 上永远只会是空数组，那 DEPLOY.md 里对 picks 的承诺就是空的。
 * 服务端按会话取最后一次，避免反复勾选把计数灌水。
 */
export interface PicksEvent extends BaseEvent {
  name: 'picks';
  picked: string[];
}

export interface FeedbackEvent extends BaseEvent {
  name: 'feedback';
  helpful: Helpfulness;
  reasons?: FeedbackReason[];
  /** 用户自愿填写的建议。允许为空，界面上会说明这是选填 */
  comment?: string;
}

export type TrackedEvent = VisitEvent | StartEvent | CompleteEvent | PicksEvent | FeedbackEvent;

const MAX_COMMENT = 500;

/**
 * 专业 id 白名单：只收教育部目录代码的形状（6-7 位数字 + 可选 T/K）。
 * 早先放宽到 [0-9A-Za-z+-]{2,16}，等于给了一个每会话 12 条、每条 16 字符的自由文本通道 ——
 * 公开写接口不该接受任何能被当成昵称或短句的东西。
 */
function idList(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && /^[0-9]{6,7}(TK|T|K)?$/.test(x)).slice(0, max)
    : [];
}

/**
 * 上报前的字段白名单校验。
 * 公开接口必须假设有人会往里塞东西：不校验就写盘，等于把磁盘当垃圾场。
 *
 * ignoreAge 供读取历史日志时使用：接收新事件时要求时间戳在 24 小时内，
 * 但重放昨天的日志时必须放开这条，否则历史数据永远读不出来。
 */
export function sanitizeEvent(raw: unknown, options: { ignoreAge?: boolean } = {}): TrackedEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;

  if (!EVENT_NAMES.includes(e.name as EventName)) return null;
  if (typeof e.sid !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(e.sid)) return null;
  if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) return null;
  if (!options.ignoreAge) {
    const age = Math.abs(Date.now() - Date.parse(e.at));
    if (age > 1000 * 60 * 60 * 24) return null;
  }

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
        confidence: e.confidence === 'high' || e.confidence === 'low' ? e.confidence : 'medium',
        recommended,
        feasible: num(e.feasible, 500) ?? 0,
      };
    }
    case 'picks':
      return { name: 'picks', sid: e.sid, at: e.at, picked: idList(e.picked, 12) };
    case 'feedback': {
      const helpful = e.helpful === 'yes' || e.helpful === 'no' || e.helpful === 'partial' ? e.helpful : null;
      if (!helpful) return null;
      const reasons = Array.isArray(e.reasons)
        ? e.reasons.filter((x): x is FeedbackReason => FEEDBACK_REASONS.includes(x as FeedbackReason))
        : undefined;
      const comment =
        typeof e.comment === 'string' && e.comment.trim()
          ? e.comment.trim().slice(0, MAX_COMMENT)
          : undefined;
      return { name: 'feedback', sid: e.sid, at: e.at, helpful, reasons, comment };
    }
    default:
      return null;
  }
}
