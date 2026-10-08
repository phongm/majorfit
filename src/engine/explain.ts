import {
  LOAD_EXPLAIN,
  LOAD_LABELS,
  RIASEC_LABELS,
  type LoadDimension,
  type MajorProfile,
  type MarketTrend,
  type RIASEC,
  type UserProfile,
  type ValuePriorities,
} from '../domain/types';
import type { Scored } from './rank';

const TREND_LABEL: Record<MarketTrend, string> = {
  rising: '需求在上升',
  stable: '需求平稳',
  cooling: '需求在降温',
  contracting: '行业在收缩',
};

export interface Narrative {
  matchedPoints: string[];
  costs: string[];
  conditionsToAccept: string[];
  disconfirmSignals: string[];
}

function topInterest(profile: UserProfile, n: number) {
  return (Object.keys(profile.interests) as (keyof RIASEC)[])
    .filter((k) => !profile.unmeasured.interests.includes(k))
    .sort((a, b) => profile.interests[b] - profile.interests[a])
    .slice(0, n);
}

/** 只有真正测出来的价值取向才能拿来做匹配陈述 */
function wants(profile: UserProfile, key: keyof ValuePriorities, atLeast: number) {
  return !profile.unmeasured.values.includes(key) && profile.values[key] >= atLeast;
}

function intentKnown(profile: UserProfile) {
  return !profile.unmeasured.constraints.includes('postgradIntent');
}

export function buildNarrative(s: Scored, profile: UserProfile): Narrative {
  const m = s.major;
  const matched: string[] = [];
  const costs: string[] = [];
  const conditions: string[] = [];
  const signals: string[] = [];

  // 匹配点：只讲拿得出依据的
  for (const dim of topInterest(profile, 2)) {
    if (m.riasec[dim] >= 0.7 && profile.interests[dim] >= 0.6) {
      matched.push(
        `你最突出的是「${RIASEC_LABELS[dim]}」（${Math.round(profile.interests[dim] * 100)}%），而这个专业日常里这一项占比 ${Math.round(m.riasec[dim] * 100)}%`,
      );
    }
  }
  for (const dim of measuredStrengths(m, profile)) {
    matched.push(
      `它的强度压在「${LOAD_LABELS[dim]}」（${Math.round(m.load[dim] * 100)}%）上，而这一项恰好是你受得住的`,
    );
  }
  if (intentKnown(profile) && profile.constraints.postgradIntent === 'yes' && m.postgradNecessity >= 0.7) {
    matched.push('你愿意继续读书，而这个专业的价值正是在读研之后才兑现');
  }
  if (intentKnown(profile) && profile.constraints.postgradIntent === 'no' && m.undergradJobFit >= 0.75) {
    matched.push('你不想读研，而它本科毕业就能直接对口就业');
  }
  /** 胃口项生效的正面一侧：课程真的压在原理上，而这个人就是要原理 */
  if (!profile.unmeasured.theoryVsApplied && profile.theoryVsApplied >= 0.5 && m.load.abstraction >= 0.7) {
    matched.push('它的核心课真的停在推导和证明上，而你要的就是这个');
  }
  if (wants(profile, 'stability', 0.7) && m.civilServiceFit >= 0.7) {
    matched.push('你看重稳定，它在考公与事业编的可报口径里属于岗位多的一类');
  }
  if (wants(profile, 'income', 0.7) && (m.incomeRealism === 'high' || m.incomeRealism === 'medium-high')) {
    matched.push('你把收入排在前面，本库把它的收入兑现归在偏高的一档');
  }
  if (!matched.length) {
    matched.push('没有一项强匹配。它进这份名单，只是因为你的约束条件把别的选择都排除了');
  }

  // 代价：负载缺口、负面清单、行情与延迟兑现
  for (const g of s.breakdown.loadGaps.slice(0, 3)) {
    costs.push(
      `它要求「${LOAD_LABELS[g.dim]}」${Math.round(g.load * 100)}%，你能接受的是 ${Math.round(g.tolerance * 100)}%。这一项指的是${LOAD_EXPLAIN[g.dim]}`,
    );
  }
  for (const dim of s.breakdown.unmeasuredHighLoad.slice(0, 2)) {
    costs.push(
      `「${LOAD_LABELS[dim]}」是它的高强度项（${Math.round(m.load[dim] * 100)}%），但问卷没测出你的耐受度，这一条要你自己确认`,
    );
  }
  costs.push(...m.honestDrawbacks.slice(0, 3));
  /**
   * 胃口错配的负面一侧。抽象理论的耐受度已经出现在上面的负载缺口里时不再重复一次，
   * 否则同一张卡片会连着两句「它太理论了」，一句说扛不住、一句说不要。
   */
  if (s.breakdown.theorySide === 'starved') {
    costs.push('它的课基本停在「会用就行」，不会带你往下追问为什么');
  } else if (s.breakdown.theorySide === 'swamped' && !s.breakdown.loadGaps.some((g) => g.dim === 'abstraction')) {
    costs.push('它的核心课大量停在推导与证明上，而你要的是尽快拿它做出东西');
  }
  if (m.marketTrend === 'contracting' || m.marketTrend === 'cooling') {
    costs.push(`行业${TREND_LABEL[m.marketTrend]}：${m.marketNote}`);
  }
  if (m.timeToStableIncomeYears > 5) {
    costs.push(`要 ${m.timeToStableIncomeYears} 年才真正开始挣钱，这期间需要家庭持续支撑`);
  }

  // ── 接受条件：把「什么人别报」翻成可自检的门槛 ──
  if (m.gatekeeperCourses.length) {
    conditions.push(`扛得住「${m.gatekeeperCourses.slice(0, 2).join('」和「')}」，否则绩点会一路压制你后面的选择权`);
  }
  if (m.postgradNecessity >= 0.7) conditions.push('把读到硕士甚至博士当成职业入场券，而不是「多余的学历」');
  if (m.healthRestrictions.colorWeak || m.healthRestrictions.colorBlind) {
    conditions.push('先确认高考体检的色觉结论，这个专业在受限清单里');
  }
  if (m.degreeYears > 4) conditions.push(`接受 ${m.degreeYears} 年制${m.longProgramNote ? `：${m.longProgramNote}` : ''}`);
  if (m.subjectRequirements.length) conditions.push('以所在省招办口径确认选科组合在允许范围内');
  if (m.careerPaths.some((p) => p.entryBarrier === 'license')) {
    conditions.push('接受有一条必须通过的执业或资格考试，未通过则多数对口路径直接关闭');
  }
  if (m.commonlyConfusedWith.length) {
    conditions.push(`和「${m.commonlyConfusedWith.slice(0, 2).join('、')}」不是一回事，填报前把课程表调出来对比`);
  }

  // ── 反例信号：出现这些情况说明选错了，用于入学后止损 ──
  if (m.load.math >= 0.8) signals.push('高数与线代开始靠抄笔记过关');
  if (m.load.programming >= 0.8) signals.push('只完成作业要求，从没自己想把一个东西做出来');
  if (m.load.memorization >= 0.85) signals.push('背书依赖考前突击，滚到第二遍时前面已经忘完');
  if (m.load.interpersonal >= 0.85) signals.push('每次面对真实的人之后需要很长时间恢复，且持续一学期以上');
  if (m.load.fieldwork >= 0.7) signals.push('开始找任何理由回避外业与现场任务');
  if (m.load.visual >= 0.8) signals.push('改到第三版时已经没有耐心，只剩下「随便吧」');
  if (m.load.abstraction >= 0.85) signals.push('能背下推导步骤但说不清定理在解决什么问题');
  if (m.postgradNecessity >= 0.8) signals.push('大一大二就去找与本专业无关的实习，理由是「这行出不去」');
  if (!signals.length) signals.push('连续两个学期对核心课毫无想深入的念头');

  return {
    matchedPoints: dedupe(matched),
    costs: dedupe(costs),
    conditionsToAccept: dedupe(conditions),
    disconfirmSignals: dedupe(signals).slice(0, 4),
  };
}

/** 专业的高强度项中，用户也明确测出高耐受的那几项 */
function measuredStrengths(m: MajorProfile, profile: UserProfile): LoadDimension[] {
  const out: LoadDimension[] = [];
  for (const [dim, load] of Object.entries(m.load) as [LoadDimension, number][]) {
    if (load < 0.75) continue;
    const tol = profile.tolerance[dim];
    // 必须 tol >= load 才叫受得住。只比阈值不比缺口时，同一张卡片会一边说
    // 「这一项恰好是你受得住的」，一边在代价里写「要求 1.00，你能接受 0.95」
    if (tol !== null && tol >= 0.7 && tol >= load - 1e-9) out.push(dim);
  }
  return out;
}

function dedupe(list: string[]) {
  return [...new Set(list.filter(Boolean))];
}
