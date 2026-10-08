import { describe, expect, it } from 'vitest';
import { assess, type AnswerValue } from '../src/assessment/scoring';
import { recommend } from '../src/engine';
import { score } from '../src/engine/rank';
import { ALL_MAJORS } from '../src/data/majors';
import { MAJORS_BY_ID } from '../src/data/majors';
import { LOAD_LABELS, type MajorProfile } from '../src/domain/types';
import { uncheckedHealthDims } from '../src/ui/provenance';
import { buildNarrative } from '../src/engine/explain';
import { makeAnswers, neutralAnswers } from './helpers';

function run(overrides: [string, AnswerValue][] = [], topN = 5) {
  const a = assess(neutralAnswers(overrides));
  return { assessment: a, result: recommend(a, { topN, majors: ALL_MAJORS }) };
}

const names = (r: ReturnType<typeof run>['result']) => r.recommendations.map((x) => x.major.name);

describe('硬性约束层', () => {
  it('明确不读研时，深造依赖极高的专业被排除，且理由可展示', () => {
    const { result } = run([
      ['f_postgrad', 'no'],
      ['f_subjects', ['physics', 'chemistry', 'biology']],
    ]);
    for (const id of ['071001', '070201', '080401']) {
      const hit = result.excluded.find((e) => e.majorId === id);
      expect(hit, `${MAJORS_BY_ID.get(id)!.name} 应被排除`).toBeDefined();
      expect(hit!.reasonCode).toBe('postgrad');
      expect(hit!.reason).toContain('读研');
    }
    expect(result.excluded.length).toBeGreaterThan(0);
  });

  it('选科没填时不静默放行，必须报告规则未生效', () => {
    const answers = neutralAnswers();
    delete answers.f_subjects;
    const result = recommend(assess(answers), { majors: ALL_MAJORS });
    expect(result.confidence.gaps.some((g) => g.includes('选科'))).toBe(true);
  });

  it('色盲学生拿不到医学与化学类推荐', () => {
    const { result } = run([['f_color', 'blind']]);
    const got = names(result);
    for (const banned of ['临床医学', '化学', '口腔医学', '护理学', '化学工程与工艺']) {
      expect(got, `${banned} 不应出现在色盲学生的推荐里`).not.toContain(banned);
    }
  });

  /**
   * 只断「Top5 里没有它」的话，把整条学制规则删掉也能通过 ——
   * 所以要钉住排除原因，以及放开年限后必须真的放回来。
   */
  it('只接受四年制时，五年制专业是被学制这条规则挡掉的，放开年限又会回来', () => {
    const nameOf = (id: string) => MAJORS_BY_ID.get(id)?.name ?? id;
    const blocked = run([['f_years', 'y4']]).result.excluded;
    for (const id of ['100201K', '082801']) {
      const hit = blocked.find((e) => e.majorId === id);
      expect(hit, `${nameOf(id)} 应该被排除`).toBeDefined();
      expect(hit!.reasonCode, `${nameOf(id)} 不是被学制挡的`).toBe('years');
    }
    const loose = run([['f_years', 'y5']]).result;
    expect(
      loose.excluded.filter((e) => e.reasonCode === 'years').map((e) => nameOf(e.majorId)),
      '放开到五年制之后还在按学制排除人',
    ).toEqual([]);
  });

  it('用户明确排除的门类不会以任何形式回流', () => {
    const { result } = run([['f_exclude', ['engineering']]]);
    for (const r of result.recommendations) expect(r.major.category).not.toBe('engineering');
  });
});

describe('非对称负载惩罚（引擎的核心主张）', () => {
  it('数学耐受最低的学生，数学密集型专业必须被压到后面', () => {
    const low = run([
      ['t_math', 'hate'],
      ['t_proof', 'shutdown'],
      ['e_why', 'never'],
      ['e_code', 'hate'],
    ]);
    const topNames = names(low.result);
    for (const banned of ['数学与应用数学', '物理学', '统计学', '人工智能']) {
      expect(topNames, `${banned} 不该推给自述数学是最大痛苦的人`).not.toContain(banned);
    }

    const high = run([['t_math', 'hard'], ['t_proof', 'enjoy']]);
    const highTop = names(high.result);
    const mathMajors = ['数学与应用数学', '物理学', '统计学', '计算机科学与技术', '人工智能'];
    expect(
      mathMajors.some((n) => highTop.includes(n)),
      `数学耐受高时至少应有一个数学密集型专业进入 Top5，实际是 ${highTop.join('/')}`,
    ).toBe(true);
  });

  it('兴趣高但耐受低，不能靠兴趣加分把专业顶进 Top3', () => {
    // 强 I 兴趣 + 明确受不了数学与抽象
    const { result } = run([
      ['e_why', 'recent'],
      ['t_math', 'hate'],
      ['t_formula', 'never'],
      ['t_proof', 'shutdown'],
      ['v_applied', 'use'],
    ]);
    const top3 = names(result).slice(0, 3);
    expect(top3).not.toContain('数学与应用数学');
    expect(top3).not.toContain('物理学');
    const mathHeavy = result.recommendations.filter((r) => r.major.load.math >= 0.9);
    for (const r of mathHeavy) {
      expect(r.breakdown.loadPenalty, `${r.major.name} 必须带显著负载惩罚`).toBeLessThan(-10);
    }
  });

  it('耐受度未测出时不扣分，但必须标红旗；明确低耐受时要重罚', () => {
    const visualMajor = MAJORS_BY_ID.get('130502')!; // 视觉传达设计，visual 负载 1.0

    const unknown = neutralAnswers();
    delete unknown.t_visual;
    delete unknown.e_show;
    const pUnknown = assess(unknown).profile;
    expect(pUnknown.tolerance.visual).toBeNull();
    const sUnknown = score(visualMajor, pUnknown);
    expect(sUnknown.breakdown.loadGaps.map((g) => g.dim)).not.toContain('visual');
    expect(sUnknown.breakdown.unmeasuredHighLoad).toContain('visual');

    const averse = assess(neutralAnswers([['t_visual', 'no'], ['e_show', 'none']])).profile;
    expect(averse.tolerance.visual).toBeTypeOf('number');
    const sAverse = score(visualMajor, averse);
    expect(sAverse.breakdown.loadGaps.map((g) => g.dim)).toContain('visual');
    expect(sAverse.score).toBeLessThan(sUnknown.score);

    // 未测出既不当作「受得了」也不当作「受不了」：它应介于两者之间
    const fine = assess(neutralAnswers([['t_visual', 'ok'], ['e_show', 'series']])).profile;
    expect(score(visualMajor, fine).score).toBeGreaterThan(sUnknown.score);
  });

  it('未测出耐受度会压低整体置信度并产出追问', () => {
    const answers = neutralAnswers();
    delete answers.t_visual;
    delete answers.e_show;
    delete answers.t_math;
    delete answers.t_formula;
    const result = recommend(assess(answers), { majors: ALL_MAJORS });
    expect(result.confidence.level).not.toBe('high');
    expect(result.confidence.gaps.length).toBeGreaterThan(0);
  });
});

describe('多样性重排', () => {
  it('Top5 不得被同一专业类占满', () => {
    const { result } = run([['e_code', 'own'], ['t_math', 'hard'], ['t_data', 'love']]);
    const bySub = new Map<string, number>();
    for (const r of result.recommendations) {
      bySub.set(r.major.subCategory, (bySub.get(r.major.subCategory) ?? 0) + 1);
    }
    const max = Math.max(...[...bySub.values()]);
    expect(max).toBeLessThanOrEqual(3);
    const categories = new Set(result.recommendations.map((r) => r.major.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  /**
   * 回归：门类覆盖度交换一度没有下限，于是「前四位 82-87 分、第五位 56 分的哲学」
   * 这种列表真的出现过 —— 用户看得见的不是覆盖度，是一个凑数的推荐。
   */
  it('为了门类覆盖换进来的专业必须自己站得住', () => {
    const { result } = run([
      ['e_fix', 'many'],
      ['e_code', 'own'],
      ['e_grit', 'several'],
      ['t_math', 'hard'],
      ['t_formula', 'often'],
      ['t_memorize', 'done'],
      ['t_cram', 'twice'],
      ['t_lab', 'build'],
      ['t_field', 'site'],
      ['t_physical', 'like'],
      ['v_depth', 'broad'],
      ['v_applied', 'use'],
      ['v_family', 'obey'],
    ]);
    expect(result.recommendations).toHaveLength(5);
    for (const r of result.recommendations) {
      expect(r.major.name, `凑数进来的 ${r.major.name}`).not.toBe('哲学');
      expect(r.score).toBeGreaterThanOrEqual(70);
    }
  });
});

describe('理论胃口与落地胃口', () => {
  const byName = (name: string) => ALL_MAJORS.find((m) => m.name === name)!;
  const profileOf = (overrides: [string, AnswerValue][]) => assess(neutralAnswers(overrides)).profile;

  /** 只答「我扛得住」没答「我要不要」时，这条规则等于没跑，不能凭空罚 */
  it('没测出胃口时这一项必须是零', () => {
    const p = profileOf([]);
    p.unmeasured.theoryVsApplied = true;
    expect(score(byName('数学与应用数学'), p).breakdown.theoryMismatch).toBeCloseTo(0);
    expect(score(byName('财务管理'), p).breakdown.theoryMismatch).toBeCloseTo(0);
  });

  it('想搞原理的人，喂不饱他的专业要吃罚分；想落地的人反方向同样', () => {
    const theory = profileOf([['v_applied', 'why'], ['t_proof', 'enjoy'], ['e_why', 'recent']]);
    // 满供给的专业一分不扣，低供给的按缺口扣
    expect(score(byName('数学与应用数学'), theory).breakdown.theoryMismatch).toBeCloseTo(0);
    expect(score(byName('财务管理'), theory).breakdown.theoryMismatch).toBeLessThan(-5);

    const applied = profileOf([['v_applied', 'use'], ['t_proof', 'shutdown'], ['e_why', 'never']]);
    const light = score(byName('财务管理'), applied).breakdown.theoryMismatch;
    const heavy = score(byName('数学与应用数学'), applied).breakdown.theoryMismatch;
    expect(heavy).toBeLessThan(-4);
    // 供给低不等于没供给，所以这一侧只该是很小的一笔
    expect(light).toBeGreaterThan(-3);
    expect(light).toBeGreaterThan(heavy);
  });

  /**
   * 产品口径：一个什么都扛得住、又要原理的人，不该被「轻松且不要求任何东西」的管理类专业顶到前面。
   * 负载罚分在他身上接近零，区分只能来自胃口。
   */
  it('全耐受但追求原理的人，前五位是给得出原理的方向，不是低要求的管理类', () => {
    const a = assess(
      neutralAnswers([
        ['e_fix', 'many'],
        ['e_why', 'recent'],
        ['e_system', 'real'],
        ['e_code', 'own'],
        ['e_grit', 'several'],
        ['e_emotion', 'distract'],
        ['t_math', 'hard'],
        ['t_formula', 'often'],
        ['t_proof', 'enjoy'],
        ['t_memorize', 'done'],
        ['t_cram', 'twice'],
        ['t_lab', 'wet'],
        ['t_write', 'can'],
        ['t_data', 'love'],
        ['t_physical', 'like'],
        ['v_depth', 'deep'],
        ['v_solved', 'open'],
        ['v_applied', 'why'],
        ['f_postgrad', 'yes'],
        ['v_delay', 'b'],
      ]),
    );
    const result = recommend(a, { topN: 5, majors: ALL_MAJORS });
    const picked = result.recommendations.map((r) => r.major.name);
    expect(picked).not.toContain('财务管理');
    expect(picked).not.toContain('物流管理');
    expect(picked).toContain('数学与应用数学');
  });

  it('错配要在代价里说人话，不能只是一个负数', () => {
    const theoryProfile = profileOf([['v_applied', 'why'], ['t_proof', 'enjoy'], ['e_why', 'recent']]);
    const s = score(byName('财务管理'), theoryProfile);
    const n = buildNarrative(s, theoryProfile);
    expect(s.breakdown.theorySide).toBe('starved');
    expect(n.costs.join('\n')).toContain('会用就行');
  });
});

describe('不确定时必须降级，而不是硬给一份好看的排序', () => {
  it('空白问卷不产生高置信度结果', () => {
    const a = assess({});
    const result = recommend(a, { majors: ALL_MAJORS });
    expect(a.diagnostics.completion).toBe(0);
    expect(result.confidence.level).toBe('low');
    expect(result.confidence.gaps.length).toBeGreaterThan(0);
  });

  it('只答约束题不答测评题时，排序仍给出但置信度为低', () => {
    const all = neutralAnswers();
    const factsOnly: Record<string, AnswerValue> = {};
    for (const k of ['f_subjects', 'f_subject_confirmed', 'f_color', 'f_vision', 'f_years', 'f_tuition', 'f_postgrad']) {
      factsOnly[k] = all[k]!;
    }
    const result = recommend(assess(factsOnly), { majors: ALL_MAJORS });
    expect(result.confidence.level).toBe('low');
  });

  it('自相矛盾的回答会被检出并降低置信度', () => {
    const { assessment, result } = run([
      ['t_math', 'hard'],
      ['t_formula', 'never'],
      ['t_people_daily', 'impossible'],
      ['e_emotion', 'hold'],
      ['t_proof', 'shutdown'],
    ]);
    expect(assessment.diagnostics.contradictions.length).toBeGreaterThan(0);
    expect(result.confidence.level).not.toBe('high');
    expect(result.confidence.contradictions.length).toBeGreaterThan(0);
  });

  /**
   * 回归：矛盾文案一度直接输出 `value.autonomy … v_family→0.05`，
   * 内部键和裸数值对 18 岁的用户是噪音，也会摧毁对系统的信任。
   */
  it('面向用户的文案里不出现内部题号与裸数值', () => {
    const { result } = run([
      ['t_math', 'hard'],
      ['t_formula', 'never'],
      ['t_people_daily', 'impossible'],
      ['e_emotion', 'hold'],
      ['t_proof', 'shutdown'],
    ]);
    const userFacing = [
      ...result.confidence.contradictions,
      ...result.confidence.gaps,
      ...result.recommendations.flatMap((r) => [...r.costs, ...r.matchedPoints, ...r.conditionsToAccept]),
    ].join('\n');

    for (const id of ['v_family', 'v_prestige_free', 't_people_daily', 't_formula', 't_cram', 't_physical', 't_proof', 'f_subject_confirmed']) {
      expect(userFacing, `文案泄漏了题号 ${id}`).not.toContain(id);
    }
    for (const key of ['value.', 'axis.', 'tolerance.', 'interest.']) {
      expect(userFacing, `文案泄漏了内部键前缀 ${key}`).not.toContain(key);
    }
    // 至少有一条矛盾被翻译成了人话
    expect(result.confidence.contradictions.length, '这道用例依赖「存在矛盾答卷」，没有就该换构造').toBeGreaterThan(0);
    if (result.confidence.contradictions.length) {
      expect(result.confidence.contradictions[0]).toContain('对不上');
    }
  });

  it('约束把可行集压得太小时显式承认，而不是凑满 5 个', () => {
    const { result } = run([
      ['f_exclude', ['engineering', 'science', 'medicine', 'agriculture', 'arts', 'management', 'economics', 'law', 'literature', 'education', 'philosophy', 'history']],
    ]);
    expect(result.feasibleSetTooSmall).toBe(true);
  });
});

describe('确定性', () => {
  /**
   * 基准分写在测试里是故意的：新增一项罚分却没进 ScoreBreakdown 时，
   * 分项加起来不等于总分，结果页的解释就成了一句假话。这条负责响。
   */
  it('分项必须加总等于总分', () => {
    const BASE = 82;
    const cases: [string, AnswerValue][][] = [
      [],
      [['v_applied', 'why'], ['t_proof', 'enjoy']],
      [['t_math', 'hate'], ['e_code', 'hate']],
    ];
    for (const overrides of cases) {
      const profile = assess(neutralAnswers(overrides)).profile;
      for (const m of ALL_MAJORS) {
        const s = score(m, profile);
        const b = s.breakdown;
        const sum =
          BASE +
          b.interestFit +
          b.loadPenalty +
          b.valueAlignment +
          b.educationMismatch +
          b.rewardMismatch +
          b.theoryMismatch;
        expect(sum, m.name).toBeCloseTo(s.rawScore, 8);
      }
    }
  });

  it('同一份输入两次运行结果完全一致', () => {
    const a = neutralAnswers([['t_math', 'hard'], ['e_code', 'own']]);
    const first = recommend(assess(a), { majors: ALL_MAJORS });
    const second = recommend(assess(a), { majors: ALL_MAJORS });
    expect(names(first)).toEqual(names(second));
    expect(first.recommendations.map((r) => Math.round(r.rawScore))).toEqual(
      second.recommendations.map((r) => Math.round(r.rawScore)),
    );
  });

  it('分数按降序排列且归一在 0..100', () => {
    const { result } = run();
    const scores = result.recommendations.map((r) => r.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe('结果的可解释性', () => {
  it('每条推荐都带代价、接受条件与反例信号，不能只有优点', () => {
    const { result } = run();
    for (const r of result.recommendations) {
      expect(r.costs.length, `${r.major.name} 缺代价`).toBeGreaterThan(0);
      expect(r.conditionsToAccept.length, `${r.major.name} 缺接受条件`).toBeGreaterThan(0);
      expect(r.disconfirmSignals.length, `${r.major.name} 缺反例信号`).toBeGreaterThan(0);
    }
  });

  it('易混专业在结果里会主动提示对比课程表', () => {
    const { result } = run([['e_code', 'own'], ['t_math', 'hard'], ['t_data', 'love']]);
    const withConfusion = result.recommendations.filter((r) => r.major.commonlyConfusedWith.length > 0);
    expect(withConfusion.length, '这道用例依赖「有易混专业被推荐」，没有就该换构造').toBeGreaterThan(0);
    if (withConfusion.length) {
      for (const r of withConfusion) {
        expect(
          r.conditionsToAccept.some((c) => c.includes('课程表')),
          `${r.major.name} 应提示易混专业`,
        ).toBe(true);
      }
    }
  });
});

describe('排除理由的归属：用户说的话优先于系统的分类', () => {
  it('用户明确排除艺术学时，记成他自己排除的，不再拿通道理由回来提醒', () => {
    const a = assess(neutralAnswers([['f_exclude', ['arts']], ['e_show', 'series'], ['t_visual', 'tolerate']]));
    const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });
    const artsIds = new Set(ALL_MAJORS.filter((m) => m.category === 'arts').map((m) => m.id));
    const reasons = result.excluded.filter((e) => artsIds.has(e.majorId)).map((e) => e.reasonCode);
    expect(reasons.length, '艺术学专业应全部被排除').toBe(artsIds.size);
    expect(reasons.every((r) => r === 'category')).toBe(true);
    // 自己说不要的方向不该出现在「兴趣匹配却被挡掉」里，那是话不投机
    expect(result.excludedButRelevant.some((e) => artsIds.has(e.majorId))).toBe(false);
  });
});

describe('选科组合没核对时的提醒', () => {
  it('明确答了「没确认过」，必须拿到一条追问，而不是只降置信度', () => {
    const result = recommend(assess(neutralAnswers([['f_subject_confirmed', 'no']])), {
      majors: ALL_MAJORS,
      topN: 5,
    });
    expect(result.confidence.gaps.join(' ')).toMatch(/省招办|招生章程/);
    expect(result.confidence.level).not.toBe('high');
  });

  it('压根没答这题时，按「规则未生效」提醒，两种情况不该同时出现两条重复话', () => {
    const answers = neutralAnswers();
    delete answers.f_subject_confirmed;
    const result = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    expect(result.confidence.gaps.filter((g) => g.includes('选科组合')).length).toBe(1);
    // 答了选考科目 → 确实存在「因选科被排除」，这句提醒是成立的
    expect(result.skippedRules.join(' ')).toContain('未经招办口径确认');
  });

  it('连选考科目都没填时，不能说「下面的排除结果可能有偏差」—— 根本没有选科排除', () => {
    const answers = neutralAnswers();
    delete answers.f_subject_confirmed;
    delete answers.f_subjects;
    const result = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    expect(result.skippedRules.join(' ')).not.toContain('未经招办口径确认');
    expect(result.skippedRules.join(' ')).toContain('选科限制未生效');
    expect(result.confidence.gaps.some((g) => g.includes('因选科被排除'))).toBe(false);
  });
});

describe('学费档位：没核实的不能用来挡人，核实了的必须生效', () => {
  it('按公办假定值录入的专业不因学费被排除，但要说明这条没核实', () => {
    // 库里所有未核实条目的 costTier 都是默认 public，光用真实数据这条断言不可能为假，
    // 所以补一个「未核实但档位很贵」的合成条目：它必须不被排除、并被点名
    const assumed: MajorProfile = {
      ...ALL_MAJORS[0]!,
      id: 'cost-unknown',
      name: '未核实高收费替身',
      costTier: 'costly',
      costTierKnown: false,
    };
    const result = recommend(assess(neutralAnswers([['f_tuition', 'public']])), {
      majors: [assumed, ...ALL_MAJORS],
      topN: 20,
    });
    expect(result.excluded.some((e) => e.majorId === assumed.id && e.reasonCode === 'tuition')).toBe(false);
    expect(result.coverageNotes.join(' ')).toContain(assumed.name);
    expect(result.coverageNotes.join(' ')).toMatch(/学费是院校属性|学费档位/);
  });

  it('学费三档是有序的：答 2-3 万要挡住十万档，答十万以上就不该挡', () => {
    const costly: MajorProfile = {
      ...ALL_MAJORS[0]!,
      id: 'costly-case',
      name: '十万档替身',
      costTier: 'costly',
      costTierKnown: true,
    };
    const mid = recommend(assess(neutralAnswers([['f_tuition', 'ok']])), { majors: [costly, ...ALL_MAJORS], topN: 20 });
    expect(mid.excluded.find((e) => e.majorId === costly.id)?.reasonCode).toBe('tuition');
    const rich = recommend(assess(neutralAnswers([['f_tuition', 'rich']])), { majors: [costly, ...ALL_MAJORS], topN: 20 });
    expect(rich.excluded.some((e) => e.majorId === costly.id)).toBe(false);
  });

  it('核实过高收费的专业，对负担不起的家庭要直接排除', () => {
    const costly: MajorProfile = {
      ...ALL_MAJORS[0]!,
      id: 'cost-case',
      name: '高收费替身',
      costTier: 'elevated',
      costTierKnown: true,
    };
    const result = recommend(assess(neutralAnswers([['f_tuition', 'public']])), {
      majors: [costly, ...ALL_MAJORS],
      topN: 20,
    });
    expect(result.excluded.find((e) => e.majorId === costly.id)?.reasonCode).toBe('tuition');
    // 愿意接受 2-3 万一年时不该被挡
    const ok = recommend(assess(neutralAnswers([['f_tuition', 'ok']])), { majors: [costly, ...ALL_MAJORS], topN: 20 });
    expect(ok.excluded.some((e) => e.majorId === costly.id)).toBe(false);
  });
});

describe('少答题时先看哪几条规则压根没跑', () => {
  it('未生效的规则排在追问列表最前，不会被结果页的截断吃掉', () => {
    const answers = makeAnswers([['e_fix', 'once'], ['t_math', 'ok']]);
    const result = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    expect(result.skippedRules.length).toBeGreaterThan(0);
    expect(result.confidence.gaps[0]).toBe(result.skippedRules[0]);
  });

  it('没填选考科目时，不该说「上面因选科被排除的结论」这种不存在的话', () => {
    const answers = neutralAnswers();
    delete answers.f_subjects;
    answers.f_subject_confirmed = 'no';
    const result = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    const line = result.confidence.gaps.filter((g) => g.includes('没核对过选科组合'));
    expect(line).toEqual([]);
    expect(result.skippedRules.join(' ')).toContain('选科限制未生效');
  });
});

describe('招录通道闸：不在覆盖范围的专业可看见、但不推给你', () => {
  const arts = ALL_MAJORS.filter((m) => m.category === 'arts');
  const blocked = ALL_MAJORS.filter((m) => !m.recommendable);

  it('被通道闸挡下的画像确实只有艺考和体育两类，且都写了原因', () => {
    expect(arts.length, '库里应该仍有艺术类专业，否则谈不上「可浏览」').toBeGreaterThan(0);
    expect(blocked.some((m) => m.subCategory === '体育学类'), '体育学类也该被通道闸挡住').toBe(true);
    // 断言「不可推荐的都是哪些」而不是「筛出来的都不可推荐」，后者是恒真的循环
    for (const m of blocked) {
      expect(m.category === 'arts' || m.subCategory === '体育学类', `${m.name} 被挡却没有通道理由`).toBe(true);
      expect(m.channelBlocked, m.name).toBe(true);
      expect(m.notRecommendableReason, m.name).toMatch(/统考|单招/);
    }
  });

  it('推荐结果里绝不出现不可推荐的专业，但它们进 excluded 并写明原因', () => {
    const result = recommend(assess(neutralAnswers([['e_show', 'series'], ['t_visual', 'tolerate']])), {
      majors: ALL_MAJORS,
      topN: 5,
    });
    expect(result.recommendations.some((r) => !r.major.recommendable)).toBe(false);
    const channelExcluded = result.excluded.filter((e) => e.reasonCode === 'channel');
    expect(channelExcluded.map((e) => e.majorId).sort()).toEqual(blocked.map((m) => m.id).sort());
    expect(channelExcluded.every((e) => /统考|单招/.test(e.reason))).toBe(true);
  });

  it('强创造兴趣的用户会看到「被通道挡掉但兴趣匹配」，而不是静默失去这些方向', () => {
    const a = assess(neutralAnswers([['e_show', 'series'], ['t_visual', 'tolerate']]));
    const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });
    const artsIds = new Set(arts.map((m) => m.id));
    expect(result.excludedButRelevant.some((e) => artsIds.has(e.majorId))).toBe(true);
  });
});

describe('数据缺口与用户条件是两件事', () => {
  it('只有推断值的专业被打成 no_profile，且不回来冒充「被挡掉的机会」', () => {
    const target: MajorProfile = {
      ...ALL_MAJORS[0]!,
      id: 'no-profile-case',
      name: '仅推断专业的替身',
      recommendable: false,
      channelBlocked: false,
      notRecommendableReason: '只有同专业类的推断值，没有逐条核对的画像',
    };
    const result = recommend(assess(neutralAnswers()), { majors: [target, ...ALL_MAJORS], topN: 5 });
    const hit = result.excluded.find((e) => e.majorId === target.id);
    expect(hit?.reasonCode).toBe('no_profile');
    expect(result.recommendations.some((r) => r.major.id === target.id)).toBe(false);
    expect(result.excludedButRelevant.some((e) => e.majorId === target.id)).toBe(false);
  });

  it('只录了色盲限制的专业，对色盲用户必须照常挡住', () => {
    // 第四轮的回归：把「色弱+色盲两个键都在」当总闸时，
    // 土木工程这类只写了 colorBlind 的画像会在色盲用户面前被当成可以报
    const blindOnly = ALL_MAJORS.filter(
      (m) => m.healthRestrictions.colorBlind && !('colorWeak' in m.healthRestrictions) && !m.channelBlocked,
    );
    expect(blindOnly.length, '库里应该有只写了色盲限制的画像').toBeGreaterThan(0);
    const result = recommend(assess(neutralAnswers([['f_color', 'blind']])), { majors: ALL_MAJORS, topN: 100 });
    const feasibleIds = new Set(result.recommendations.map((r) => r.major.id));
    for (const m of blindOnly) expect(feasibleIds.has(m.id), `${m.name} 被放行了`).toBe(false);
    // 选科口径更严的先挡；只有没被别的规则挡掉的才轮到 health，这才是真实的判定链
    const healthBlocked = result.excluded.filter((e) => e.reasonCode === 'health').map((e) => e.majorId);
    // 选科口径更严的先挡，所以只有没被别的规则截胡的才该出现在 health 名单里
    expect(
      blindOnly.filter((m) => m.subjectRequirements.length === 0).map((m) => m.id).every((id) => healthBlocked.includes(id)),
      '没有选科限制的单色盲画像必须被色盲口径挡住',
    ).toBe(true);
  });

  it('色弱口径没核对时既不挡人，也要在结果里说明', () => {
    const weakUnchecked = ALL_MAJORS.filter((m) => !('colorWeak' in m.healthRestrictions));
    expect(weakUnchecked.length, '没写色弱口径的画像应该存在').toBeGreaterThan(0);
    const declared = ALL_MAJORS.filter((m) => m.healthRestrictions.colorWeak);
    expect(declared.length, '应该仍有明确写了色弱限制的专业用来对照').toBeGreaterThan(0);

    const result = recommend(assess(neutralAnswers([['f_color', 'weak']])), { majors: ALL_MAJORS, topN: 5 });
    const uncheckedIds = new Set(weakUnchecked.map((m) => m.id));
    expect(result.excluded.filter((e) => e.reasonCode === 'health' && uncheckedIds.has(e.majorId))).toEqual([]);
    expect(result.excluded.some((e) => e.reasonCode === 'health' && !uncheckedIds.has(e.majorId))).toBe(true);
    expect(result.coverageNotes.join(' ')).toMatch(/体检限制.*没核对/);

    // 核对过的那一半不能被说成「全没核对」，否则是在贬低自己的数据
    const blindOnly = ALL_MAJORS.filter(
      (m) => m.healthRestrictions.colorBlind && !('colorWeak' in m.healthRestrictions),
    );
    for (const m of blindOnly) {
      const dims = uncheckedHealthDims(m.healthRestrictions);
      expect(dims, m.name).toContain('色弱限制');
      expect(dims, `${m.name} 的色盲口径其实核对过`).not.toContain('色盲限制');
    }
  });

  it('视力受限但没有核对过口径的专业，不能既说不知道又照样挡掉', () => {
    const unknownIds = new Set(
      ALL_MAJORS.filter((m) => !('poorVision' in m.healthRestrictions)).map((m) => m.id),
    );
    // 库里唯一写了视力限制的体育教育走通道排除，所以「声明了限制就要挡人」这半边用合成条目验
    const withLimit: MajorProfile = {
      ...ALL_MAJORS[0]!,
      id: 'vision-case',
      name: '视力限制替身',
      healthRestrictions: { poorVision: true },
      subjectRequirements: [],
    };
    const result = recommend(assess(neutralAnswers([['f_vision', 'low']])), {
      majors: [withLimit, ...ALL_MAJORS],
      topN: 20,
    });
    expect(result.excluded.find((e) => e.majorId === withLimit.id)?.reasonCode, '写了视力限制的必须被挡').toBe('health');
    // 没写视力键的专业不能既说「没核对」又照样挡人
    expect(result.excluded.filter((e) => e.reasonCode === 'health' && unknownIds.has(e.majorId))).toEqual([]);
    expect(result.coverageNotes.join(' ')).toMatch(/体检限制/);
  });
});

describe('选科口径缺失时不假装「不限」', () => {
  it('没录选科口径的专业不被选科规则排除，但要产出核对提示', () => {
    const target: MajorProfile = { ...ALL_MAJORS[0]!, subjectRequirements: ['physics'], subjectRequirementsKnown: false };
    const result = recommend(assess(neutralAnswers([['f_subjects', ['history']] ])), {
      majors: [target, ...ALL_MAJORS.slice(1)],
      topN: 5,
    });
    expect(result.excluded.some((e) => e.majorId === target.id && e.reasonCode === 'subject')).toBe(false);
    expect(result.coverageNotes.join(' ')).toContain(target.name);
  });

  it('录了口径时选科规则照常生效', () => {
    const target: MajorProfile = { ...ALL_MAJORS[0]!, subjectRequirements: ['physics'], subjectRequirementsKnown: true };
    const result = recommend(assess(neutralAnswers([['f_subjects', ['history']]])), {
      majors: [target, ...ALL_MAJORS.slice(1)],
      topN: 5,
    });
    expect(result.excluded.some((e) => e.majorId === target.id && e.reasonCode === 'subject')).toBe(true);
  });
});

describe('文案不许自相矛盾', () => {
  it('同一张卡片不能既说「这一项你受得住」又说它超出了你的耐受', () => {
    const labels = Object.values(LOAD_LABELS);
    for (const overrides of [[], [['t_math', 'hard']], [['e_code', 'own'], ['t_data', 'love']]] as [string, AnswerValue][][]) {
      const result = recommend(assess(neutralAnswers(overrides)), { majors: ALL_MAJORS, topN: 5 });
      for (const r of result.recommendations) {
        const praised = r.matchedPoints.filter((t) => t.includes('受得住'));
        for (const line of praised) {
          const dim = labels.find((l) => line.includes(`「${l}」`));
          expect(dim, line).toBeDefined();
          expect(
            r.costs.some((c) => c.includes(dim!)),
            `${r.major.name}：「受得住」与代价里的「${dim}」同时出现`,
          ).toBe(false);
        }
      }
    }
  });

  it('置信度文案不许声称做过多次观测交叉验证 —— 题库结构上就没做', () => {
    const a = assess(neutralAnswers());
    expect(a.diagnostics.thin.length, '这套题库里必然存在单次观测的维度').toBeGreaterThan(0);
    // 夹具必须带一条真冲突，否则这条用例验不到「说中真实原因」
    const conflict = assess(neutralAnswers([['e_teach', 'long'], ['t_people_daily', 'impossible']]));
    const result = recommend(conflict, { majors: ALL_MAJORS, topN: 5 });
    expect(result.confidence.note).not.toMatch(/多次观测|两道题测到/);
    // 但必须说中真实原因
    expect(result.confidence.note).toContain('回答互相冲突');
    expect(result.confidence.contradictions.length).toBeGreaterThan(0);
  });

  it('两道 forced 题在同一价值上取向相反，不算用户自相矛盾', () => {
    // forced 题写的是各自情景里的取舍：选编制稳定 + 行业收缩时仍追热爱，是两个独立决定
    const a = assess(neutralAnswers([['v_stable_income', 'stable'], ['v_shrink', 'follow']]));
    const stability = a.measurement.values.stability!;
    expect(stability.observations.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...stability.observations.map((o) => o.value)) - Math.min(...stability.observations.map((o) => o.value))).toBeGreaterThan(0.72);
    expect(a.diagnostics.contradictions.filter((c) => c.dimension === 'value.stability')).toEqual([]);
  });

  it('没有追问可补时，文案不许让用户去补一个不存在的追问', () => {
    const result = recommend(assess(neutralAnswers([['e_teach', 'long'], ['t_people_daily', 'impossible']])), {
      majors: ALL_MAJORS,
      topN: 5,
    });
    expect(result.confidence.gaps.length).toBe(0);
    expect(result.confidence.level).toBe('medium');
    expect(result.confidence.note).not.toContain('追问');
  });

  it('少答一项硬条件就不许说「硬条件填全了」并亮 high 徽章', () => {
    // 色觉没答 → 色觉过滤压根没跑 → 受限专业被无条件放行，此时 high + 「填全了」是假话
    const answers = neutralAnswers([['v_depth', 'broad']]);
    delete answers.f_color;
    const result = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    expect(result.confidence.level).not.toBe('high');
    expect(result.confidence.note).not.toContain('硬条件填全');
    expect(result.confidence.gaps.join(' ')).toContain('色觉限制未生效');
  });

  it('coverageNotes 不许点名已经被别的硬条件挡掉的专业', () => {
    const blocked = recommend(assess(neutralAnswers([['f_years', 'y4'], ['f_color', 'blind']])), {
      majors: ALL_MAJORS,
      topN: 5,
    });
    const excludedIds = new Set(blocked.excluded.map((e) => e.majorId));
    const named = blocked.coverageNotes.join(' ');
    for (const m of ALL_MAJORS) {
      if (!excludedIds.has(m.id)) continue;
      if (named.includes(`${m.name} 的`) || new RegExp(`${m.name}、`).test(named)) {
        throw new Error(`${m.name} 已被排除，coverageNotes 不该再点名它：${named}`);
      }
    }
    // 这条测的就是「过滤会不会把披露整个掏空」，所以必须断非空
    expect(blocked.coverageNotes.length).toBeGreaterThan(0);
  });

  it('high 档必须真的可达，否则徽章是死代码', () => {
    // v_applied=use 与 v_depth=deep 是中性答卷里唯一的一处 axis 冲突；
    // 换成 broad 之后应当得到一份内部一致、硬条件填全的答卷
    const answers = neutralAnswers([['v_depth', 'broad']]);
    const a = assess(answers);
    const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });
    if (a.diagnostics.contradictions.length === 0) {
      expect(result.confidence.level, result.confidence.note).toBe('high');
      expect(result.confidence.note).toContain('没有冲突');
    } else {
      throw new Error('构造不出无矛盾答卷：high 档仍然不可达，需要重做置信度规则');
    }
  });
});
