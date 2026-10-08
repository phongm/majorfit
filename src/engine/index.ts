import {
  HARD_CONSTRAINTS,
  LOAD_LABELS,
  RIASEC_LABELS,
  VALUE_LABELS,
  type Confidence,
  type LoadDimension,
  type MajorProfile,
  type RIASEC,
  type Recommendation,
  type RecommendationResult,
  type UserProfile,
  type ValuePriorities,
} from '../domain/types';
import { subjectsUnconfirmed, type AssessmentOutput, type Contradiction } from '../assessment/scoring';
import { ITEMS_BY_ID } from '../assessment/items';
import { applyConstraints, relevanceOfExcluded } from './filters';
import { rerankForDiversity, score } from './rank';
import { buildNarrative } from './explain';

export interface RecommendOptions {
  topN?: number;
  /** 专业库由调用方注入，引擎不直接依赖数据模块，便于替换与测试 */
  majors: MajorProfile[];
}

/** 追问建议：把「哪个维度没测准」映射回题库里最能补齐它的题 */
const GAP_QUESTION: Partial<Record<LoadDimension, string>> = {
  math: 't_math',
  programming: 'e_code',
  abstraction: 't_proof',
  memorization: 't_memorize',
  lab: 't_lab',
  visual: 't_visual',
  writing: 't_write',
  quantitative: 't_data',
  interpersonal: 't_people_daily',
  fieldwork: 't_field',
  physical: 't_physical',
};

export function recommend(
  assessment: AssessmentOutput,
  options: RecommendOptions,
): RecommendationResult {
  const topN = options.topN ?? 5;
  const majors = options.majors;
  const { profile, diagnostics } = assessment;

  const { feasible, excluded, skippedRules, constraintGaps } = applyConstraints(majors, profile);

  const scored = feasible
    .map((m) => score(m, profile))
    .sort((a, b) => b.rawScore - a.rawScore);

  const picked = rerankForDiversity(scored, topN);

  const recommendations: Recommendation[] = picked.map((s, i) => {
    const n = buildNarrative(s, profile);
    return {
      major: s.major,
      score: s.score,
      rawScore: s.rawScore,
      breakdown: s.breakdown,
      rank: i + 1,
      matchedPoints: n.matchedPoints,
      costs: n.costs,
      conditionsToAccept: n.conditionsToAccept,
      disconfirmSignals: n.disconfirmSignals,
    };
  });

  // 只点名真的进了可行集的专业：已经被学制、深造门槛挡掉的，再提醒去核它的学费口径没有意义
  const feasibleIds = new Set(feasible.map((m) => m.id));
  const reportableGaps = constraintGaps.filter((g) => feasibleIds.has(g.id));
  const coverageNotes: string[] = [];
  if (reportableGaps.length) {
    const list = (xs: { name: string }[]) =>
      `${xs.slice(0, 3).map((g) => g.name).join('、')}${xs.length > 3 ? `等 ${xs.length} 个方向` : ''}`;
    const subject = reportableGaps.filter((g) => g.missing.includes('subject'));
    const health = reportableGaps.filter((g) => g.missing.includes('health'));
    const cost = reportableGaps.filter((g) => g.missing.includes('cost'));
    if (subject.length) coverageNotes.push(`${list(subject)}的选科口径本库还没核对：它们没有被选科规则排除，也不能当成不限。`);
    if (health.length) coverageNotes.push(`${list(health)}的体检限制（色觉或视力）本库还没核对：填报前按院校招生章程确认。`);
    if (cost.length) {
      coverageNotes.push(
        `学费是院校属性而不是专业属性：本库只有艺术类专业核过档位（而艺术类走统考通道、已被排除），${list(cost)}的档位都是按公办普通收费假定，没逐校核实。要报民办或中外合作，得按目标院校招生章程自己核对，这条规则挡不了你。`,
      );
    }
  }

  // 未生效的规则放在最前：少答题的人恰恰最需要看到「哪几条规则压根没跑」，
  // 而结果页有截断，放最后等于把它们截掉
  const gaps = [...skippedRules, ...collectGaps(profile, recommendations)];

  const confidence = buildConfidence(profile, diagnostics, recommendations, gaps);

  return {
    recommendations,
    excluded,
    excludedButRelevant: relevanceOfExcluded(excluded, new Map(majors.map((m) => [m.id, m])), profile),
    skippedRules,
    coverageNotes,
    alternatesConsidered: scored.length,
    confidence,
    feasibleSetTooSmall: scored.length < topN,
    generatedAt: new Date().toISOString(),
  };
}

const INTEREST_QUESTION: Record<keyof RIASEC, string> = {
  R: 'e_fix',
  I: 'e_why',
  A: 'e_show',
  S: 'e_teach',
  E: 'e_lead',
  C: 'e_system',
};

const VALUE_QUESTION: Record<keyof ValuePriorities, string> = {
  stability: 'v_stable_income',
  income: 'v_meaning_money',
  autonomy: 'v_prestige_free',
  meaning: 'v_meaning_money',
  prestige: 'v_prestige_free',
};

/** 把「哪个维度没测准」翻译成人话，并指回题库里最能补齐它的那道题 */
function collectGaps(profile: UserProfile, recommendations: Recommendation[]): string[] {
  const gaps: string[] = [];

  for (const s of recommendations.slice(0, 3)) {
    for (const d of s.breakdown.unmeasuredHighLoad) {
      const prompt = questionPrompt(GAP_QUESTION[d]);
      if (prompt) gaps.push(`「${LOAD_LABELS[d]}」没测准，而它在这个专业里要求很高。建议补答：${prompt}`);
    }
  }
  for (const d of profile.unmeasured.interests) {
    const prompt = questionPrompt(INTEREST_QUESTION[d]);
    if (prompt) gaps.push(`兴趣里的「${RIASEC_LABELS[d]}」还没有观测数据。建议补答：${prompt}`);
  }
  for (const v of profile.unmeasured.values) {
    const prompt = questionPrompt(VALUE_QUESTION[v]);
    if (prompt) gaps.push(`你没答自己在「${VALUE_LABELS[v]}」上的取舍。建议补答：${prompt}`);
  }
  if (profile.unmeasured.grit) gaps.push(`没答过长周期投入的经历。建议补答：${questionPrompt('e_grit')}`);
  /** 理论胃口现在直接参与排序，它没测到时这条规则等于没跑，得说而不是静默跳过 */
  if (profile.unmeasured.theoryVsApplied) {
    gaps.push(`没测出你要的是原理还是落地，而这一项现在会影响排序。建议补答：${questionPrompt('v_applied')}`);
  }
  /**
   * 明确答了「没确认过」的人是**有作答**，不会进 unmeasured，所以也就不会出现在
   * skippedRules 里 —— 少了这一句，这批最该被提醒的人只会看到「置信度中」，
   * 而选科排除仍以事实口径挡住了他们。没答的那种情况由 skippedRules 负责，不重复说。
   */
  if (subjectsUnconfirmed(profile) && !profile.unmeasured.constraints.includes('subjectChoicesConfirmed')) {
    gaps.push('你说了没核对过选科组合：上面所有「因选科被排除」的结论都还是按通用口径推的，填报前必须以省招办和目标院校章程再核一遍');
  }
  return gaps.filter(Boolean);
}

function questionPrompt(id: string | undefined) {
  return id ? ITEMS_BY_ID.get(id)?.prompt : undefined;
}

/**
 * 内部键与裸数值不能出现在界面上：`value.autonomy 上两个回答方向相反：v_family→0.05`
 * 这种文案对 18 岁的用户是噪音，且会直接摧毁对系统的信任。
 */
function formatContradiction(c: Contradiction): string {
  const [a, b] = c.observations;
  if (!a || !b) return c.label;
  if (c.dimension === 'constraint.postgrad') {
    return `${c.label}：你选了不读研，却能接受 ${b.value} 年的培养周期`;
  }
  return `${c.label}：两题回答对不上 ——「${truncate(a.prompt)}」与「${truncate(b.prompt)}」`;
}

function truncate(s: string, n = 24) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function buildConfidence(
  profile: AssessmentOutput['profile'],
  diagnostics: AssessmentOutput['diagnostics'],
  recommendations: Recommendation[],
  gaps: string[],
): Confidence {
  const contradictions = diagnostics.contradictions.map(formatContradiction);
  const unmeasuredInTop = new Set(recommendations.flatMap((r) => r.breakdown.unmeasuredHighLoad));
  const unconfirmedSubjects = subjectsUnconfirmed(profile);
  // 「确认标记」没答不算「硬条件没填」：它是核对动作，不是报考资格
  const missingConstraints = profile.unmeasured.constraints.filter((k) =>
    (HARD_CONSTRAINTS as readonly string[]).includes(k),
  ).length;

  // 有的维度只有一次观测（diagnostics.thin）是这套题库的粒度，不是某个用户的缺陷，
  // 所以它不进分档、也不许被写进「有多次观测支撑」这种没做过的校验里
  const reasons: string[] = [];
  if (diagnostics.completion < 0.8) reasons.push(`只答了 ${Math.round(diagnostics.completion * 100)}% 的题`);
  if (contradictions.length) reasons.push(`${contradictions.length} 处回答互相冲突`);
  if (unmeasuredInTop.size) reasons.push(`前几位里有 ${unmeasuredInTop.size} 个维度的耐受度没测到`);
  // 差一项也不能说「硬条件填全了」：少答色觉时色觉过滤压根没跑，几十个受限专业会被无条件放行
  if (missingConstraints >= 1) {
    reasons.push(`有 ${missingConstraints} 项硬条件没填`);
  }
  if (unconfirmedSubjects) reasons.push('选科组合还没跟招办确认过是否合规');

  let level: Confidence['level'] = 'high';
  if (diagnostics.completion < 0.5 || contradictions.length >= 3 || unmeasuredInTop.size >= 3) level = 'low';
  else if (reasons.length) level = 'medium';

  /**
   * 文案只描述真的做了的校验。多数负载维度只由一两道题测到，少于一题的就是没测到，
   * 所以任何版本都不许说「每个维度都有多次观测支撑」。
   * 同理：gaps 为空时不许说「把下面的追问补完」——那会让用户盯着一个空区块找东西。
   */
  const note =
    level === 'high'
      ? '回答之间没有冲突，硬条件填全了，前几位用得上的负载维度也都测到了，可以按这份排序参考。'
      : level === 'medium'
        ? `这份排序可用，但${reasons.slice(0, 3).join('；')}${gaps.length ? '。请把下面的追问补完再定' : ''}。`
        : `信息不足以支撑一份可靠的排序（${reasons.slice(0, 3).join('；')}）。这份结果只能当方向提示，不要拿它做决定。`;

  return { level, contradictions, gaps: [...new Set(gaps)], note };
}
