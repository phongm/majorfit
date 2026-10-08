import {
  LOAD_DIMENSIONS,
  LOAD_LABELS,
  MEASURABLE_CONSTRAINTS,
  RIASEC_LABELS,
  type FieldCategory,
  type LoadDimension,
  type RIASEC,
  type SubjectCode,
  type ToleranceVector,
  type UnmeasuredFlags,
  type UserProfile,
} from '../domain/types';
import { ITEMS, ITEMS_BY_ID } from './items';
import type { Item, ProfileDelta, SectionId } from './schema';

/** 只能是选项 id 或 id 数组：滑块题型已删除，数字答案一律视为不认识的旧数据 */
export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

/** 一个维度的原始观测：值 + 贡献它的题。保留原始观测才能做矛盾检测和溯源 */
export interface Observation {
  value: number;
  item: string;
}

export interface DimensionSample {
  value: number;
  observations: Observation[];
}

export interface Measurement {
  interests: Record<keyof RIASEC, DimensionSample | null>;
  tolerance: Record<LoadDimension, DimensionSample | null>;
  theoryVsApplied: DimensionSample | null;
  grit: DimensionSample | null;
  values: Record<keyof UserProfile['values'], DimensionSample | null>;
}

export interface Contradiction {
  /** 内部键，供测试与调试定位 */
  dimension: string;
  /** 给用户看的维度名 */
  label: string;
  /** 互相冲突的两个观测 */
  observations: { item: string; prompt: string; value: number }[];
}

export interface Diagnostics {
  contradictions: Contradiction[];
  unanswered: string[];
  /** 只被一道题测到的维度：值可用，但不足以支撑硬结论 */
  thin: string[];
  completion: number;
}

export interface AssessmentOutput {
  profile: UserProfile;
  measurement: Measurement;
  diagnostics: Diagnostics;
}

const INTEREST_KEYS: (keyof RIASEC)[] = ['R', 'I', 'A', 'S', 'E', 'C'];
const VALUE_KEYS = ['stability', 'income', 'autonomy', 'meaning', 'prestige'] as const;

/** 同维度上两个观测差距超过此值即判为自报矛盾 */
const SPAN_01 = 0.72;
/** 有符号轴取 1.2 而不是 1.3：题库里唯一成对的反向答案是 ±0.6 对 ±0.7，差值恰好 1.3，写在边界上会被浮点误差判成不矛盾 */
const SPAN_SIGNED = 1.2;

/**
 * 约束写入优先级：直接自述（facts 段）高于情景推断（tradeoff 段）。
 * 没有这个规则时，v_delay 一道情景题会覆盖 f_postgrad 的明确回答，
 * 学生说「不读研」却被引擎记成「未定」，深造门槛整套硬过滤随之失效。
 */
const CONSTRAINT_RANK: Record<SectionId, number> = { facts: 3, evidence: 2, tolerance: 2, tradeoff: 1 };

const FACT_KEYS = [
  'postgradIntent',
  'maxProgramYears',
  'colorVision',
  'poorVision',
  'maxAnnualTuition',
  'subjectChoicesConfirmed',
] as const;

interface FactSlot {
  value: unknown;
  item: string;
  rank: number;
}

type Store = Map<string, Observation[]>;

function observe(store: Store, key: string, value: number, item: string) {
  const list = store.get(key);
  if (list) list.push({ value, item });
  else store.set(key, [{ value, item }]);
}

function summarize(store: Store): Record<string, DimensionSample | null> {
  const out: Record<string, DimensionSample | null> = {};
  for (const [key, obs] of store) {
    out[key] = { value: obs.reduce((s, o) => s + o.value, 0) / obs.length, observations: obs };
  }
  return out;
}

function collectDeltas(item: Item, answer: AnswerValue): ProfileDelta[] {
  switch (item.kind) {
    case 'multi': {
      const picked = new Set(Array.isArray(answer) ? answer : []);
      return item.options.filter((o) => picked.has(o.id)).map((o) => o.delta);
    }
    default: {
      const hit = item.options.find((o) => o.id === answer);
      return hit ? [hit.delta] : [];
    }
  }
}

function isEmptyAnswer(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v === '';
  return v.length === 0;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function assess(answers: Answers): AssessmentOutput {
  const interests: Store = new Map();
  const tolerance: Store = new Map();
  const values: Store = new Map();
  const axes: Store = new Map();

  /** 单选事实题：高优先级来源覆盖低优先级，同级后者覆盖前者 */
  const facts: Record<string, FactSlot> = {};
  const subjectChoices = new Set<SubjectCode>();
  const excludedCategories = new Set<FieldCategory>();
  const answeredItems = new Set<string>();

  for (const item of ITEMS) {
    const raw = answers[item.id];
    if (raw === undefined || isEmptyAnswer(raw)) continue;
    answeredItems.add(item.id);

    for (const delta of collectDeltas(item, raw)) {
      if (delta.interests) {
        for (const k of INTEREST_KEYS) {
          const v = delta.interests[k];
          if (v !== undefined) observe(interests, k, v, item.id);
        }
      }
      if (delta.tolerance) {
        for (const k of LOAD_DIMENSIONS) {
          const v = delta.tolerance[k];
          if (v !== undefined) observe(tolerance, k, v, item.id);
        }
      }
      if (delta.values) {
        for (const k of VALUE_KEYS) {
          const v = delta.values[k];
          if (v !== undefined) observe(values, k, v, item.id);
        }
      }
      if (delta.theoryVsApplied !== undefined) observe(axes, 'theoryVsApplied', delta.theoryVsApplied, item.id);
      if (delta.grit !== undefined) observe(axes, 'grit', delta.grit, item.id);

      const c = delta.constraints;
      if (!c) continue;
      for (const s of c.subjectChoices ?? []) subjectChoices.add(s);
      for (const cat of c.excludedCategories ?? []) excludedCategories.add(cat);
      for (const k of FACT_KEYS) {
        if (c[k] === undefined) continue;
        const prev = facts[k];
        const rank = CONSTRAINT_RANK[item.section] ?? 0;
        if (!prev || rank >= prev.rank) facts[k] = { value: c[k], item: item.id, rank };
      }
    }
  }

  const iMeas = summarize(interests);
  const tMeas = summarize(tolerance);
  const vMeas = summarize(values);
  const aMeas = summarize(axes);

  const sample = (store: Record<string, DimensionSample | null>, key: string) => store[key] ?? null;
  const axis = (k: string, fallback = 0) => sample(aMeas, k)?.value ?? fallback;
  const fact = <T>(k: string, fallback: T): T => {
    const hit = facts[k];
    return hit === undefined ? fallback : (hit.value as T);
  };

  const interestsVec = {} as RIASEC;
  for (const k of INTEREST_KEYS) {
    const s = sample(iMeas, k);
    interestsVec[k] = s ? clamp01(s.value) : 0.5;
  }

  /**
   * 未测到 = null，不是 0.5。
   * 引擎把 null 当作「不可判定」：不加分也不扣分，但压低置信度并生成追问。
   * 若填 0.5，等于凭空假设用户「勉强受得了」，会静默降质。
   */
  const toleranceVec = {} as ToleranceVector;
  for (const d of LOAD_DIMENSIONS) {
    const s = sample(tMeas, d);
    toleranceVec[d] = s ? clamp01(s.value) : null;
  }

  const valuesVec = {} as UserProfile['values'];
  for (const k of VALUE_KEYS) {
    const s = sample(vMeas, k);
    valuesVec[k] = s ? clamp01(s.value) : 0.5;
  }

  const gritSample = sample(aMeas, 'grit');

  /**
   * 约束项只有「真的被采集到」才算已测。
   * 题库里「不记得 / 没查过」这类选项故意不写 delta，
   * 于是色觉会退回默认值「正常」—— 此时绝不能拿它去排除体检受限的专业。
   */
  const unmeasuredConstraints = MEASURABLE_CONSTRAINTS.filter((key) =>
    key === 'subjectChoices' ? subjectChoices.size === 0 : !(key in facts),
  );

  const unmeasured: UnmeasuredFlags = {
    interests: INTEREST_KEYS.filter((k) => !sample(iMeas, k)),
    values: VALUE_KEYS.filter((k) => !sample(vMeas, k)),
    theoryVsApplied: !sample(aMeas, 'theoryVsApplied'),
    grit: !gritSample,
    constraints: [...unmeasuredConstraints],
  };

  const profile: UserProfile = {
    interests: interestsVec,
    tolerance: toleranceVec,
    theoryVsApplied: Math.max(-1, Math.min(1, axis('theoryVsApplied'))),
    grit: gritSample ? clamp01(gritSample.value) : 0.5,
    values: valuesVec,
    constraints: {
      subjectChoices: [...subjectChoices],
      subjectChoicesConfirmed: fact('subjectChoicesConfirmed', false),
      colorVision: fact('colorVision', 'normal' as UserProfile['constraints']['colorVision']),
      poorVision: fact('poorVision', false),
      maxProgramYears: fact<number | null>('maxProgramYears', null),
      maxAnnualTuition: fact('maxAnnualTuition', 'public'),
      postgradIntent: fact('postgradIntent', 'undecided' as UserProfile['constraints']['postgradIntent']),
      excludedCategories: [...excludedCategories],
    },
    unmeasured,
  };

  const contradictions = [
    ...detectSpanContradictions('interest', interests, SPAN_01),
    ...detectSpanContradictions('tolerance', tolerance, SPAN_01),
    ...detectSpanContradictions('value', values, SPAN_01),
    ...detectSpanContradictions('axis', axes, SPAN_SIGNED),
    ...detectFactConflicts(facts),
  ];

  const thin: string[] = [];
  for (const [group, store] of [
    ['interest', interests],
    ['tolerance', tolerance],
    ['value', values],
    ['axis', axes],
  ] as const) {
    for (const [dim, obs] of store) if (obs.length === 1) thin.push(`${group}.${dim}`);
  }

  const unanswered = ITEMS.filter((i) => !answeredItems.has(i.id)).map((i) => i.id);

  const measurement: Measurement = {
    interests: pickKeys(iMeas, INTEREST_KEYS),
    tolerance: pickKeys(tMeas, LOAD_DIMENSIONS),
    values: pickKeys(vMeas, VALUE_KEYS),
    theoryVsApplied: sample(aMeas, 'theoryVsApplied'),
    grit: gritSample,
  };

  return {
    profile,
    measurement,
    diagnostics: {
      contradictions,
      unanswered,
      thin,
      completion: answeredItems.size / ITEMS.length,
    },
  };
}

/** 把稀疏的观测表补齐成完整键集，未观测的显式为 null，避免调用方拿到 undefined */
function pickKeys<K extends string>(store: Record<string, DimensionSample | null>, keys: readonly K[]) {
  const out = {} as Record<K, DimensionSample | null>;
  for (const k of keys) out[k] = store[k] ?? null;
  return out;
}

/** 维度键 → 给用户看的说法。内部键只用于测试与调试，不允许出现在界面上 */
const DIMENSION_LABELS: Record<string, string> = {
  'value.stability': '把稳定排在收入前面',
  'value.income': '把收入排在稳定前面',
  'value.autonomy': '要自己说了算',
  'value.meaning': '要这件事有意义',
  'value.prestige': '要在乎别人怎么看',
  'axis.theoryVsApplied': '偏理论还是偏落地',
  'constraint.postgrad': '读研意愿与培养周期',
  'constraint.subjects': '选科组合是否核实过',
};

function dimensionLabel(dimension: string) {
  if (DIMENSION_LABELS[dimension]) return DIMENSION_LABELS[dimension];
  const group = dimension.slice(0, dimension.indexOf('.'));
  const dim = dimension.slice(dimension.indexOf('.') + 1) as LoadDimension;
  if (group === 'tolerance') return `对「${LOAD_LABELS[dim] ?? dim}」的耐受度`;
  if (group === 'interest') {
    const key = dim as unknown as keyof typeof RIASEC_LABELS;
    return `兴趣里的「${RIASEC_LABELS[key] ?? dim}」`;
  }
  return dim;
}

export function promptOf(itemId: string) {
  return ITEMS_BY_ID.get(itemId)?.prompt ?? itemId;
}

/**
 * forced 题写的是「同一情景里两个好东西只能选一个」，delta 是那个情景内的相对取舍，
 * 不是这个价值的绝对水平。不同题的情景不同，同一维度上一高一低完全正常：
 * v_stable_income 选编制（stability 0.95）与 v_shrink 选追热爱（0.15）不构成自相矛盾，
 * 把它们判成冲突会让每个答完题的人都背上「你在自相矛盾」，并永久压住置信度。
 */
const isForcedChoice = (itemId: string) => ITEMS_BY_ID.get(itemId)?.kind === 'forced';

function detectSpanContradictions(group: string, store: Store, span: number): Contradiction[] {
  const out: Contradiction[] = [];
  for (const [dim, obs] of store) {
    // 先把 forced 题摘掉再取极差：它只是同一情景里的相对取舍，不能当自报矛盾。
    // 但也不能让它占住极值 —— 一旦它站在端点上，整维度被跳过，
    // 「主动深挖过原理」(+0.6) 对上「看两行推导就关」(-0.7) 这种真矛盾就被藏掉了。
    const comparable = obs.filter((o) => !isForcedChoice(o.item));
    if (comparable.length < 2) continue;
    const sorted = [...comparable].sort((a, b) => a.value - b.value);
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    if (hi.value - lo.value < span) continue;
    // 两个观测来自同一题的不同选项时不算矛盾（那是多选的正常分布）
    if (lo.item === hi.item) continue;
    const dimension = `${group}.${dim}`;
    out.push({
      dimension,
      label: dimensionLabel(dimension),
      observations: [
        { ...lo, prompt: promptOf(lo.item) },
        { ...hi, prompt: promptOf(hi.item) },
      ],
    });
  }
  return out;
}

function detectFactConflicts(facts: Record<string, FactSlot>): Contradiction[] {
  const out: Contradiction[] = [];
  const pg = facts.postgradIntent;
  const years = facts.maxProgramYears;
  if (pg?.value === 'no' && typeof years?.value === 'number' && years.value >= 6) {
    out.push({
      dimension: 'constraint.postgrad',
      label: dimensionLabel('constraint.postgrad'),
      observations: [
        { item: pg.item, prompt: promptOf(pg.item), value: 0 },
        { item: years.item, prompt: promptOf(years.item), value: years.value },
      ],
    });
  }
  return out;
}

/**
 * 选科组合的确认状态。答「没确认过」和压根没答这一题，在结论上是同一个状态：
 * 都不能把选科排除当成已核实的事实。没填选考科目时不存在选科排除，所以也不算。
 * 三处判断（追问、置信度原因、skip 文案）共用这一个谓词，避免各自漂移。
 */
export function subjectsUnconfirmed(profile: UserProfile): boolean {
  return profile.constraints.subjectChoices.length > 0 && !profile.constraints.subjectChoicesConfirmed;
}
