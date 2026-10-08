import {
  COST_RANK,
  FIELD_CATEGORY_LABELS,
  SUBJECT_LABELS,
  type ConstraintKind,
  type CostTier,
  type ExcludedMajor,
  type FilterableMajor,
  type MeasurableConstraint,
  type RIASEC,
  type ScoreableMajor,
  type UserProfile,
} from '../domain/types';

export interface FilterOutcome<M extends FilterableMajor = FilterableMajor> {
  feasible: M[];
  excluded: ExcludedMajor[];
  /** 因为用户没填而未能生效的规则，界面必须显示，不能静默跳过 */
  skippedRules: string[];
  /** 专业侧的口径缺失：不能当成「没有限制」，也不能据此排除 */
  constraintGaps: { id: string; name: string; missing: ConstraintKind[] }[];
}

/** 导出只为让测试能核对：里面引号引用的选项原文必须真的存在于题库 */
export const SKIP_REASON: Record<MeasurableConstraint, string> = {
  subjectChoices: '选科限制未生效：你没说过选考科目',
  subjectChoicesConfirmed: '选科组合未经招办口径确认，下面的排除结果可能有偏差',
  colorVision: '色觉限制未生效：你没说过体检色觉结论（答了「不记得/没查过」也算没说）',
  poorVision: '视力限制未生效：你没说过裸眼视力（答了「不清楚」也算没说）',
  maxProgramYears: '学制限制未生效：你没说过能接受的培养周期（答了「没算过这个」也算没说）',
  maxAnnualTuition: '学费限制未生效：你没说过家庭学费承受范围',
  postgradIntent: '深造门槛未生效：你没说过是否读研',
};

/**
 * 首选科目（物理、历史）与再选科目要分开判断：3+1+2 下两者规则不同。
 * 把「物理或历史均可」当成「两门都要选」会得出永远为空的可行集。
 */
function checkSubjects(major: FilterableMajor, chosen: string[]): { ok: boolean; why?: string } {
  const required = major.subjectRequirements;
  const firstChoice = required.filter((s) => s === 'physics' || s === 'history');
  const repeats = required.filter((s) => s !== 'physics' && s !== 'history');

  // 同时列出物理与历史 → 首选科目不限
  if (firstChoice.length > 1) return { ok: true };

  const must = firstChoice[0];
  if (must && !chosen.includes(must)) {
    return { ok: false, why: `要求首选科目为${SUBJECT_LABELS[must]}，你的组合里没有` };
  }
  const missing = repeats.filter((r) => !chosen.includes(r));
  if (missing.length) {
    return { ok: false, why: `要求再选科目含${missing.map((s) => SUBJECT_LABELS[s]).join('、')}，你没选` };
  }
  return { ok: true };
}

/**
 * 深造依赖度是可行性问题，不是兴趣问题：
 * 明确不读研的人被推荐本科无法兑现的专业，等于推荐了一条不存在的出路。
 */
const POSTGRAD_BLOCK = { necessity: 0.85, undergradJobFit: 0.35 };

export const COST_TIER_LABEL: Record<CostTier, string> = {
  public: '公办普通（约 5-6 千/年）',
  elevated: '1.5-3 万/年（部分民办、艺术类）',
  costly: '3 万以上/年（多数中外合作办学）',
};

export function applyConstraints<M extends FilterableMajor>(
  majors: M[],
  profile: UserProfile,
): FilterOutcome<M> {
  const feasible: M[] = [];
  const excluded: ExcludedMajor[] = [];
  const c = profile.constraints;
  const lacks = (key: MeasurableConstraint) => profile.unmeasured.constraints.includes(key);

  const gaps = new Map<string, { id: string; name: string; missing: ConstraintKind[] }>();
  const gap = (m: M, kind: ConstraintKind) => {
    const cur = gaps.get(m.id) ?? { id: m.id, name: m.name, missing: [] };
    if (!cur.missing.includes(kind)) cur.missing.push(kind);
    gaps.set(m.id, cur);
  };
  const subjectAnswered = !lacks('subjectChoices');
  const skippedRules = (Object.keys(SKIP_REASON) as MeasurableConstraint[])
    .filter(lacks)
    // 「组合未经确认，下面的排除结果可能有偏差」只有在确实跑过选科排除时才是真话
    .filter((key) => key !== 'subjectChoicesConfirmed' || subjectAnswered)
    .map((key) => SKIP_REASON[key]);

  const subjectKnown = !lacks('subjectChoices');
  const colorKnown = !lacks('colorVision');
  const visionKnown = !lacks('poorVision');
  // 规则本身看可空值，不看 unmeasured 列表：漏查一次就会把「没答」当成「只接受 4 年」
  const yearsCap = c.maxProgramYears;
  const tuitionKnown = !lacks('maxAnnualTuition');
  const intentKnown = !lacks('postgradIntent');

  for (const m of majors) {
    const hit = (reasonCode: ExcludedMajor['reasonCode'], reason: string) =>
      excluded.push({ majorId: m.id, reasonCode, reason });

    /** 用户自己排除掉的方向先记，理由才是「他说了不要」，而不是「这条路走不进去」 */
    if (c.excludedCategories.includes(m.category)) {
      hit('category', `你明确排除了「${FIELD_CATEGORY_LABELS[m.category]}」这个门类`);
      continue;
    }
    if (m.channelBlocked) {
      hit('channel', m.notRecommendableReason ?? '这个专业的招录通道不在本系统覆盖范围内');
      continue;
    }
    if (!m.recommendable) {
      hit('no_profile', m.notRecommendableReason ?? '这个专业只有推断值，没有核对过的画像');
      continue;
    }
    if (subjectKnown) {
      if (!m.subjectRequirementsKnown) {
        gap(m, 'subject');
      } else {
        const r = checkSubjects(m, c.subjectChoices);
        if (!r.ok) {
          hit('subject', r.why!);
          continue;
        }
      }
    }
    /**
     * 体检口径按**单个维度**判定：那个键写过（哪怕是 false）才算核对过。
     * 用「色弱+色盲两个键都在」当总闸是错的 —— 库里 12 条画像只声明了一个维度
     * （土木工程、法学 等只写了色盲），总闸会让它们在色盲用户面前直接被当成「可以报」。
     */
    const h = m.healthRestrictions;
    const weakChecked = 'colorWeak' in h;
    const blindChecked = 'colorBlind' in h;
    if (colorKnown && c.colorVision === 'colorBlind') {
      // 色盲同样过不了「色弱不予录取」那一档，所以两个维度都要看
      if (h.colorBlind || h.colorWeak) {
        hit('health', '色盲不予录取');
        continue;
      }
      if (!weakChecked || !blindChecked) gap(m, 'health');
    } else if (colorKnown && c.colorVision === 'colorWeak') {
      if (h.colorWeak) {
        hit('health', '色弱不予录取');
        continue;
      }
      if (!weakChecked) gap(m, 'health');
    }
    if (visionKnown && c.poorVision) {
      if (h.poorVision) {
        hit('health', '裸眼视力低于 4.8 受限');
        continue;
      }
      if (!('poorVision' in h)) gap(m, 'health');
    }
    if (yearsCap !== null && m.degreeYears > yearsCap) {
      const note = m.longProgramNote ? `（${m.longProgramNote}）` : '';
      hit('years', `是 ${m.degreeYears} 年制，超出你能接受的 ${yearsCap} 年${note}`);
      continue;
    }
    // 只有核过学费档位的才许用它做排除；按公办假定值挡人等于拿猜测当资格
    if (tuitionKnown) {
      if (!m.costTierKnown) gap(m, 'cost');
      else if (COST_RANK[m.costTier] > COST_RANK[c.maxAnnualTuition]) {
        hit('tuition', `学费${COST_TIER_LABEL[m.costTier]}，超出你能接受的${COST_TIER_LABEL[c.maxAnnualTuition]}`);
        continue;
      }
    }
    if (
      intentKnown &&
      c.postgradIntent === 'no' &&
      m.postgradNecessity >= POSTGRAD_BLOCK.necessity &&
      m.undergradJobFit <= POSTGRAD_BLOCK.undergradJobFit
    ) {
      hit(
        'postgrad',
        `你明确表示不读研，而它 ${Math.round(m.postgradNecessity * 100)}% 的价值要读到研究生才能兑现`,
      );
      continue;
    }

    feasible.push(m);
  }

  return { feasible, excluded, skippedRules, constraintGaps: [...gaps.values()] };
}

/** 用户自己排除掉、或我们数据不够的方向，不需要被当成「被挡掉的机会」再来提醒 */
const NOT_OPPORTUNITY: ExcludedMajor['reasonCode'][] = ['category', 'no_profile'];

/**
 * 被条件挡掉、但兴趣确实匹配的方向。
 * 按兴趣强度排序：这一节的价值是「你的兴趣和现实条件不在同一条线上」，
 * 跟行业行情无关。
 */
export function relevanceOfExcluded(
  excluded: ExcludedMajor[],
  majors: Map<string, ScoreableMajor>,
  profile: UserProfile,
): ExcludedMajor[] {
  const top = measuredTopInterests(profile, 2);
  /** 匹配强度 = 用户有多想要这个维度 × 这个专业在这个维度上有多重 */
  const strengthOf = (m: ScoreableMajor) => Math.max(0, ...top.map((d) => profile.interests[d] * m.riasec[d]));

  return excluded
    .filter((e) => !NOT_OPPORTUNITY.includes(e.reasonCode))
    .map((e) => ({ e, m: majors.get(e.majorId) }))
    .filter((x): x is { e: ExcludedMajor; m: ScoreableMajor } => Boolean(x.m))
    .filter(({ m }) => top.some((d) => m.riasec[d] >= 0.75))
    .sort((a, b) => strengthOf(b.m) - strengthOf(a.m))
    .map((x) => x.e);
}

function measuredTopInterests(profile: UserProfile, n: number): (keyof RIASEC)[] {
  return (Object.keys(profile.interests) as (keyof RIASEC)[])
    .filter((k) => !profile.unmeasured.interests.includes(k))
    .sort((a, b) => profile.interests[b] - profile.interests[a])
    .slice(0, n);
}
