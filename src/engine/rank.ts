import {
  LOAD_DIMENSIONS,
  LOAD_LABELS,
  type LoadDimension,
  type IncomeRealism,
  type MarketTrend,
  type LoadGap,
  type MajorProfile,
  type ScoreableMajor,
  type RIASEC,
  type ScoreBreakdown,
  type ValuePriorities,
  type UserProfile,
} from '../domain/types';

/** 兴趣只罚「你的强兴趣在这里得不到满足」，不给「兴趣碰巧像」大额加分 */
const INTEREST_TOP1_W = 9;
const INTEREST_TOP2_W = 6;
const INTEREST_TOLERANCE = 0.1;
const INTEREST_CAP = 30;
const INTEREST_BONUS = 8;

/**
 * 负载超出的非对称惩罚，是引擎的核心。
 * gap = 专业要求 - 用户耐受，只罚正缺口。
 * 指数大于 1，让「勉强超一点」代价小、「差得很远」代价陡增。
 */
const LOAD_IMPACT: Record<LoadDimension, number> = {
  math: 1.0,
  programming: 0.95,
  abstraction: 0.8,
  memorization: 0.85,
  lab: 0.7,
  visual: 0.7,
  writing: 0.6,
  quantitative: 0.55,
  interpersonal: 0.8,
  fieldwork: 0.6,
  physical: 0.5,
};
const LOAD_EXPONENT = 1.7;
const LOAD_K = 19.6;
const LOAD_CAP = 45;
/** 专业在该项要求高、而用户没测出耐受度时，必须显式标红旗 */
const HIGH_LOAD_THRESHOLD = 0.7;

const VALUE_W: Record<keyof ValuePriorities, number> = {
  stability: 3.0,
  income: 3.0,
  meaning: 2.5,
  autonomy: 2.5,
  prestige: 2.0,
};
/** 对齐加分相对错配罚分的比例。奖励弱于惩罚，否则等于用加分掩盖错配 */
const BONUS_RATIO = 0.4;
const VALUE_PENALTY_CAP = 15;
const VALUE_BONUS_CAP = 6;

const TREND_SCORE: Record<MarketTrend, number> = {
  rising: 1,
  stable: 0.8,
  cooling: 0.45,
  contracting: 0.15,
};

const INCOME_PROXY: Record<IncomeRealism, number> = {
  low: 0.2,
  medium: 0.45,
  'medium-high': 0.7,
  high: 0.95,
};

/** 默认参数保持 MajorProfile，浏览与自选诊断传 lighter 的 ScoreableMajor */
export interface Scored<M extends ScoreableMajor = MajorProfile> {
  major: M;
  rawScore: number;
  score: number;
  breakdown: ScoreBreakdown;
}

/**
 * 基准 82 而不是 100：三项加分上限合计 18（兴趣 8 + 价值 6 + 深造 4）。
 * 以 100 为基准再叠加加分，会让多个专业一起撞顶被截断，Top5 出现一片满分。
 */
const BASE_SCORE = 82;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 只排真正被测到的兴趣维度。未作答留下的 0.5 默认值参与排序会造出假缺口 */
function measuredInterests(profile: UserProfile): (keyof RIASEC)[] {
  return (Object.keys(profile.interests) as (keyof RIASEC)[])
    .filter((k) => !profile.unmeasured.interests.includes(k))
    .sort((a, b) => profile.interests[b] - profile.interests[a]);
}

function interestFit(major: ScoreableMajor, profile: UserProfile) {
  const top = measuredInterests(profile).slice(0, 2);
  let penalty = 0;
  top.forEach((dim, i) => {
    const w = i === 0 ? INTEREST_TOP1_W : INTEREST_TOP2_W;
    penalty += Math.max(0, profile.interests[dim] - major.riasec[dim] - INTEREST_TOLERANCE) * w;
  });

  let bonus = 0;
  const first = top[0];
  if (first) {
    const mine = profile.interests[first];
    const theirs = major.riasec[first];
    if (mine >= 0.75 && theirs >= 0.75) bonus = INTEREST_BONUS;
    else if (mine >= 0.6 && theirs >= 0.7) bonus = 4;
  }

  const weakest = first && profile.interests[first] - major.riasec[first] > 0.4 ? first : null;
  return { penalty: Math.min(INTEREST_CAP, penalty), bonus, weakest, measuredCount: top.length };
}

export function loadFit(major: ScoreableMajor, profile: UserProfile) {
  let penalty = 0;
  const gaps: LoadGap[] = [];
  const unmeasuredHighLoad: LoadDimension[] = [];

  for (const dim of LOAD_DIMENSIONS) {
    const tolerance = profile.tolerance[dim];
    const load = major.load[dim];
    if (tolerance === null) {
      if (load >= HIGH_LOAD_THRESHOLD) unmeasuredHighLoad.push(dim);
      continue;
    }
    const gap = load - tolerance;
    if (gap <= 0) continue;
    gaps.push({ dim, load, tolerance, gap });
    penalty += LOAD_IMPACT[dim] * Math.pow(gap, LOAD_EXPONENT) * LOAD_K;
  }
  gaps.sort((a, b) => b.gap - a.gap);
  return { penalty: Math.min(LOAD_CAP, penalty), gaps, unmeasuredHighLoad };
}

/** 每个价值取向对应的专业侧代理指标，0..1，越高表示越能满足该取向 */
function valueProxies(major: ScoreableMajor) {
  const income = INCOME_PROXY[major.incomeRealism];
  const trend = TREND_SCORE[major.marketTrend];
  return {
    stability: clamp(0.45 * major.civilServiceFit + 0.35 * trend + 0.2 * major.undergradJobFit, 0, 1),
    income,
    meaning: clamp(0.6 * major.load.interpersonal + 0.4 * major.riasec.S, 0, 1),
    autonomy: clamp(1 - (0.5 * major.civilServiceFit + 0.3 * major.riasec.C), 0, 1),
    prestige: clamp(0.5 * income + 0.3 * major.postgradNecessity + 0.2 * trend, 0, 1),
  };
}

function valueFit(major: ScoreableMajor, profile: UserProfile) {
  const proxies = valueProxies(major);
  let misalign = 0;
  let align = 0;
  let measuredCount = 0;

  for (const key of Object.keys(proxies) as (keyof ValuePriorities)[]) {
    // 未作答的价值取向不参与罚分：否则「没答」被当成「不在乎」，是凭空假设
    if (profile.unmeasured.values.includes(key)) continue;
    measuredCount += 1;
    const w = VALUE_W[key];
    const v = profile.values[key];
    const p = proxies[key];
    misalign += v * (1 - p) * w;
    align += v * p * w * BONUS_RATIO;
  }

  return {
    penalty: clamp(misalign, 0, VALUE_PENALTY_CAP),
    bonus: clamp(align, 0, VALUE_BONUS_CAP),
    measuredCount,
  };
}

/**
 * 三笔教育相关罚分各自设上限，再给一个合计上限。
 * 早期版本只有一道 18 分总闸：深造必要性先吃满，延迟兑现和长学制就罚不动了，
 * 结果是「学制最多 4 年」和「压根没答学制」得到几乎一样的分数。
 */
const EDU_NECESSITY_CAP = 16;
const EDU_DELAY_CAP = 10;
const EDU_LONG_PROGRAM_CAP = 6;
const EDU_TOTAL_CAP = 26;

function educationFit(major: ScoreableMajor, profile: UserProfile) {
  const intentKnown = !profile.unmeasured.constraints.includes('postgradIntent');
  // 可空值自己就是「有没有说过」的判断，不再去查 unmeasured 列表 —— 两处各查一次迟早会不一致
  const yearsCap = profile.constraints.maxProgramYears;
  const gritKnown = !profile.unmeasured.grit;
  const notes: string[] = [];

  let necessity = 0;
  let delay = 0;
  let longProgram = 0;
  let bonus = 0;

  if (!intentKnown) {
    notes.push('没说过是否读研，深造依赖这一项没有参与计算');
  } else if (profile.constraints.postgradIntent === 'no') {
    necessity = Math.min(EDU_NECESSITY_CAP, major.postgradNecessity * 16);
  } else if (profile.constraints.postgradIntent === 'undecided') {
    necessity = Math.min(EDU_NECESSITY_CAP, major.postgradNecessity * 6);
  } else if (major.postgradNecessity >= 0.7) {
    bonus += 4;
  }

  if (yearsCap !== null) {
    const extra = intentKnown && profile.constraints.postgradIntent === 'yes' ? 5 : 0;
    const over = major.timeToStableIncomeYears - (yearsCap + extra);
    if (over > 0) delay = Math.min(EDU_DELAY_CAP, over * 2.5);
  } else if (major.timeToStableIncomeYears > 5) {
    notes.push(
      `这个专业约 ${major.timeToStableIncomeYears} 年才开始有稳定收入，但你没说过能接受的周期，所以没有据此扣分`,
    );
  }

  // 长学制本身不是问题，没有长周期投入的记录才是
  if (gritKnown && major.degreeYears > 4) {
    longProgram = Math.min(EDU_LONG_PROGRAM_CAP, (major.degreeYears - 4) * 4 * (1 - profile.grit));
  }

  return {
    penalty: Math.min(EDU_TOTAL_CAP, necessity + delay + longProgram),
    bonus,
    notes,
  };
}

function rewardFit(major: ScoreableMajor, profile: UserProfile) {
  let penalty = 0;
  if (major.marketTrend === 'contracting') penalty += 10;
  else if (major.marketTrend === 'cooling') penalty += 4;
  if (
    !profile.unmeasured.constraints.includes('postgradIntent') &&
    profile.constraints.postgradIntent === 'no' &&
    major.undergradJobFit < 0.3
  ) {
    penalty += 6;
  }
  return { penalty: clamp(penalty, 0, 15) };
}

/**
 * 胃口错配：负载维度只问「你受不受得了」，是天花板；这一项问「你想不想」。
 * 一个什么都扛得住的人，全部负载罚分趋近于 0，此时区分专业的是供给与需求的错位，
 * 而不是他能不能读完。两个方向都罚：想搞原理的专业不教原理，想落地的专业全是推导。
 * 与 abstraction 的负载罚分不重复 —— 那一项在「要求高于耐受」时才触发，方向相反。
 */
const THEORY_K = 22;
const THEORY_CAP = 10;
/** 胃口落在中区间时不罚：±0.2 以内说明这个人自己也没表态 */
const THEORY_DEADZONE = 0.2;

type Appetite = 'starved' | 'swamped' | null;

function theoryFit(major: ScoreableMajor, profile: UserProfile): { penalty: number; side: Appetite } {
  if (profile.unmeasured.theoryVsApplied) return { penalty: 0, side: null };
  const want = profile.theoryVsApplied;
  const supply = major.load.abstraction;
  const starved = Math.max(0, want - THEORY_DEADZONE) * (1 - supply);
  const swamped = Math.max(0, -want - THEORY_DEADZONE) * supply;
  const side: Appetite = starved >= swamped ? (starved > 0 ? 'starved' : null) : 'swamped';
  return { penalty: clamp(Math.max(starved, swamped) * THEORY_K, 0, THEORY_CAP), side };
}

/**
 * 门类覆盖度交换的下限。
 * 不设下限时会拿一个六十来分的专业换掉八十多分的第 5 名，
 * 用户看到的是「85、84、83、82、56」这种列表，第 5 行毫无说服力。
 */
const COVERAGE_MIN_SCORE = 70;

export function score<M extends ScoreableMajor>(major: M, profile: UserProfile): Scored<M> {
  const interest = interestFit(major, profile);
  const load = loadFit(major, profile);
  const value = valueFit(major, profile);
  const edu = educationFit(major, profile);
  const reward = rewardFit(major, profile);
  const theory = theoryFit(major, profile);

  const raw =
    BASE_SCORE -
    interest.penalty -
    load.penalty -
    value.penalty -
    edu.penalty -
    reward.penalty -
    theory.penalty +
    interest.bonus +
    value.bonus +
    edu.bonus;

  const riskFlags: string[] = load.unmeasuredHighLoad.map(
    (d) => `没测出你对「${LOAD_LABELS[d]}」的耐受度，但这个专业在这一项要求很高`,
  );
  if (load.gaps.some((g) => g.gap >= 0.5)) {
    riskFlags.push('有一项课程负载远超你自述能接受的程度，建议先确认再决定');
  }
  if (interest.weakest) riskFlags.push('你最突出的兴趣，在这个专业里得到的满足偏低');
  riskFlags.push(...edu.notes);
  if (interest.measuredCount === 0) riskFlags.push('兴趣题全部没答，这份排序只反映了你的约束条件');
  if (value.measuredCount === 0) riskFlags.push('价值取向题全部没答，排序没有考虑你要什么');

  return {
    major,
    rawScore: raw,
    score: clamp(raw, 0, 100),
    breakdown: {
      interestFit: -interest.penalty + interest.bonus,
      loadPenalty: -load.penalty,
      valueAlignment: -value.penalty + value.bonus,
      educationMismatch: -edu.penalty + edu.bonus,
      rewardMismatch: -reward.penalty,
      theoryMismatch: -theory.penalty,
      theorySide: theory.side,
      loadGaps: load.gaps,
      unmeasuredHighLoad: load.unmeasuredHighLoad,
      riskFlags,
    },
  };
}

/**
 * 多样性重排。
 * 不做这一步，Top5 会是同一专业类的五个变体，
 * 等于把选择权交还给「计算机 还是 软件工程」这种无意义的比较。
 */
export function rerankForDiversity<M extends ScoreableMajor>(scored: Scored<M>[], topN: number): Scored<M>[] {
  const picked: Scored<M>[] = [];
  const taken = new Set<string>();
  const subCount = new Map<string, number>();
  const deferred: Scored<M>[] = [];

  const accept = (s: Scored<M>) => {
    picked.push(s);
    taken.add(s.major.id);
    subCount.set(s.major.subCategory, (subCount.get(s.major.subCategory) ?? 0) + 1);
  };

  for (const s of scored) {
    if (picked.length >= topN) break;
    if ((subCount.get(s.major.subCategory) ?? 0) >= 2) {
      deferred.push(s);
      continue;
    }
    accept(s);
  }

  // 同类上限放宽后才补足名额
  for (const s of deferred) {
    if (picked.length >= topN) break;
    accept(s);
  }

  // 门类覆盖度：不足 3 个门类时，用次优的其他门类换掉末位。
  // 交换对象必须自己还站得住：宁可前五位都是工学，也不塞一个六十分的进来充门面
  const categoriesOf = () => new Set(picked.map((p) => p.major.category));
  if (picked.length >= 3 && categoriesOf().size < 3) {
    for (const s of scored) {
      if (picked.length < 3 || categoriesOf().size >= 3) break;
      if (taken.has(s.major.id) || categoriesOf().has(s.major.category)) continue;
      if (s.score < COVERAGE_MIN_SCORE) break;
      const dropped = picked.pop();
      if (dropped) taken.delete(dropped.major.id);
      accept(s);
    }
  }

  return picked;
}
