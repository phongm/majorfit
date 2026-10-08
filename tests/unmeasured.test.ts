import { describe, expect, it } from 'vitest';
import { assess, type AnswerValue } from '../src/assessment/scoring';
import { recommend } from '../src/engine';
import { score } from '../src/engine/rank';
import { ALL_MAJORS, MAJORS_BY_ID } from '../src/data/majors';
import { neutralAnswers } from './helpers';

/**
 * 这组测试守的是同一条原则：没答的题不能替用户做假设。
 * 引擎早期版本把未作答的深造意愿当成「未定」罚分、把没填的学制上限当成 4 年，
 * 等于用一份没答完的问卷产出一份看起来很确定的排序。
 */

const bio = MAJORS_BY_ID.get('071001')!; // 生物科学：深造依赖 0.95，本科兑现 0.15

function runWith(overrides: [string, AnswerValue][], drops: string[] = []) {
  const answers = neutralAnswers(overrides);
  for (const d of drops) delete answers[d];
  const a = assess(answers);
  return { a, s: score(bio, a.profile) };
}

describe('未作答不参与罚分', () => {
  it('没答「是否读研」也没答学制时，深造与延迟兑现都不罚分', () => {
    const unknown = runWith([], ['f_postgrad', 'v_delay', 'f_years']);
    expect(unknown.a.profile.unmeasured.constraints).toContain('postgradIntent');
    expect(unknown.s.breakdown.educationMismatch).toBe(0);

    const refuses = runWith([['f_postgrad', 'no']]);
    expect(refuses.s.breakdown.educationMismatch).toBeLessThan(-10);

    const accepts = runWith([['f_postgrad', 'yes']]);
    expect(accepts.s.breakdown.educationMismatch).toBeGreaterThanOrEqual(0);
  });

  it('没答学制上限时，延迟兑现不产生罚分', () => {
    // 用「不读研」把深造加分通道关掉，两次分差就只剩延迟兑现这一项
    const unknown = runWith([['f_postgrad', 'no']], ['f_years']);
    const known = runWith([['f_postgrad', 'no'], ['f_years', 'y4']]);
    expect(unknown.a.profile.unmeasured.constraints).toContain('maxProgramYears');
    expect(known.a.profile.unmeasured.constraints).not.toContain('maxProgramYears');
    // 生物科学要 9 年才稳定收入：上限填 4 年要吃满 10 分延迟罚分，未答则一分不罚
    expect(unknown.s.breakdown.educationMismatch - known.s.breakdown.educationMismatch).toBeGreaterThanOrEqual(9);
  });

  /**
   * 这题原来是滑块，「不拖」和「就要 4 年」会被压成同一个答案。
   * 改成档位后必须保证：明确说「没算过」＝ 没答（不产生假设），但不等于没答（算完成度）。
   */
  it('选「没算过这个」等价于没答这题，却仍然算答过', () => {
    const silent = runWith([['f_postgrad', 'no']], ['f_years']);
    const saysUnknown = runWith([['f_postgrad', 'no'], ['f_years', 'unknown']]);
    expect(saysUnknown.a.profile.unmeasured.constraints).toContain('maxProgramYears');
    expect(saysUnknown.s.breakdown.educationMismatch).toBe(silent.s.breakdown.educationMismatch);
    expect(saysUnknown.a.diagnostics.completion).toBeGreaterThan(silent.a.diagnostics.completion);
  });

  it('兴趣题全部未答时不产生假缺口，并明确说明排序只反映约束条件', () => {
    const all = neutralAnswers();
    const factsOnly: Record<string, AnswerValue> = {};
    for (const k of Object.keys(all)) if (k.startsWith('f_')) factsOnly[k] = all[k]!;
    const a = assess(factsOnly);
    expect(a.profile.unmeasured.interests.length).toBe(6);
    const s = score(bio, a.profile);
    expect(s.breakdown.interestFit).toBe(0);
    expect(s.breakdown.riskFlags.join('')).toContain('只反映了你的约束条件');
  });

  it('价值取向未答的项不罚分，答了的项才罚', () => {
    const answers = neutralAnswers();
    delete answers.v_stable_income;
    delete answers.v_meaning_money;
    delete answers.v_prestige_free;
    delete answers.v_family;
    delete answers.v_shrink;
    delete answers.v_delay;
    // e_money 也在观测 income，留着它就没有「五个取向全未答」的状态可验
    delete answers.e_money;
    const a = assess(answers);
    expect(a.profile.unmeasured.values.length).toBeGreaterThan(0);
    const full = assess(neutralAnswers());
    // 没有观测就没有错配：未答的那些取向必须一点分都不动，
    // 留 8 分余量等于允许「没答」被当成中间值去参与
    expect(new Set(a.profile.unmeasured.values)).toEqual(
      new Set(['stability', 'income', 'autonomy', 'meaning', 'prestige']),
    );
    // 一个观测都没有 → 这一项必须是 0 分，不能拿中间值当「没答」
    expect(score(bio, a.profile).breakdown.valueAlignment).toBe(0);
    expect(score(bio, full.profile).breakdown.valueAlignment).not.toBe(0);
  });

  it('色觉选「不记得」时不得按「正常」去排除医学专业', () => {
    const a = assess(neutralAnswers([['f_color', 'unknown']]));
    expect(a.profile.unmeasured.constraints).toContain('colorVision');
    const result = recommend(a, { majors: ALL_MAJORS });
    expect(result.excluded.find((e) => e.majorId === '100201K' && e.reasonCode === 'health')).toBeUndefined();
    expect(result.skippedRules.join('')).toContain('色觉限制未生效');
  });

  it('只填视力不填色觉时，色觉规则仍未生效', () => {
    const answers = neutralAnswers();
    delete answers.f_color;
    const a = assess(answers);
    expect(a.profile.unmeasured.constraints).toContain('colorVision');
    expect(a.profile.unmeasured.constraints).not.toContain('poorVision');
  });
});

describe('排除原因的呈现', () => {
  it('用户主动排除的门类不算「被条件挡掉的机会」', () => {
    const a = assess(neutralAnswers([['f_exclude', ['science']], ['e_why', 'recent'], ['e_precise', 'yes']]));
    const result = recommend(a, { majors: ALL_MAJORS });
    const scienceIds = new Set(ALL_MAJORS.filter((m) => m.category === 'science').map((m) => m.id));
    for (const e of result.excludedButRelevant) {
      // 单独断「理学的一条都不该出现在这里」，否则被上一行的 not.toBe('category') 完全蕴含、永不失败
      expect(scienceIds.has(e.majorId), `主动排除的理学被当成「被挡掉的机会」：${e.majorId}`).toBe(false);
    }
  });

  it('被挡掉的方向按兴趣强度排序，不按行情', () => {
    const a = assess(
      neutralAnswers([
        ['f_subjects', ['physics', 'chemistry']],
        ['f_postgrad', 'no'],
        ['e_why', 'recent'],
        ['e_precise', 'yes'],
      ]),
    );
    const result = recommend(a, { majors: ALL_MAJORS });
    expect(result.excludedButRelevant.length).toBeGreaterThan(0);
    const first = MAJORS_BY_ID.get(result.excludedButRelevant[0]!.majorId)!;
    // 强 I 兴趣的人，排在最前面的应当是高研究强度的理学/医学方向
    expect(first.riasec.I).toBeGreaterThanOrEqual(0.8);
  });
});

describe('重排的完整性', () => {
  const cases: [string, [string, AnswerValue][]][] = [
    ['中性答卷', []],
    ['不读研', [['f_postgrad', 'no']]],
    ['排除工学', [['f_exclude', ['engineering']]]],
    ['爱写代码且数学扛得住', [['e_code', 'own'], ['t_math', 'hard'], ['t_data', 'love']]],
  ];

  it('Top5 不含重复专业', () => {
    for (const [label, overrides] of cases) {
      const result = recommend(assess(neutralAnswers(overrides)), { majors: ALL_MAJORS, topN: 5 });
      const ids = result.recommendations.map((r) => r.major.id);
      expect(new Set(ids).size, `${label}: ${ids.join('/')}`).toBe(ids.length);
    }
  });

  /**
   * 门类覆盖度换入不能造成名次与分数倒挂：结果页按 rank 从前往后展示，
   * 一旦第 5 位的原始分高于第 3 位，「第 3 位」这个说法就是在骗人。
   */
  it('名次必须与原始分同向，换入门类不许把它抬到前面', () => {
    for (const [label, overrides] of cases) {
      const result = recommend(assess(neutralAnswers(overrides)), { majors: ALL_MAJORS, topN: 5 });
      const raws = result.recommendations.map((r) => r.rawScore);
      for (let i = 1; i < raws.length; i++) {
        expect(raws[i], `${label}: 第 ${i + 1} 位分数高于第 ${i} 位（${raws.map((n) => n.toFixed(1)).join(',')}）`).toBeLessThanOrEqual(
          raws[i - 1]!,
        );
      }
      expect(result.recommendations.map((r) => r.rank)).toEqual(
        result.recommendations.map((_, i) => i + 1),
      );
    }
  });
});
