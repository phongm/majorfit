import { describe, expect, it } from 'vitest';
import { assess, type AssessmentOutput } from '../src/assessment/scoring';
import { ITEMS, ITEMS_BY_ID, pruneAnswers } from '../src/assessment/items';
import { SECTIONS } from '../src/assessment/schema';
import { LOAD_DIMENSIONS, MEASURABLE_CONSTRAINTS } from '../src/domain/types';
import { neutralAnswers } from './helpers';

/** thin 记的是 `group.dim` 字符串，这里按分组回到 measurement 取原始观测 */
function lookupSample(a: AssessmentOutput, entry: string) {
  const sep = entry.indexOf('.');
  const group = entry.slice(0, sep);
  const dim = entry.slice(sep + 1);
  if (group === 'interest') return a.measurement.interests[dim as keyof typeof a.measurement.interests];
  if (group === 'tolerance') return a.measurement.tolerance[dim as keyof typeof a.measurement.tolerance];
  if (group === 'value') return a.measurement.values[dim as keyof typeof a.measurement.values];
  if (group === 'axis') {
    return a.measurement[dim as 'theoryVsApplied' | 'grit'];
  }
  throw new Error(`未知的 thin 分组：${entry}`);
}

describe('约束采集的优先级', () => {
  /**
   * 回归：情景权衡题（tradeoff 段）一度覆盖了直接自述（facts 段），
   * 导致明确「不读研」的学生被记成「未定」，深造硬过滤随之全线失效。
   */
  it('直接自述的深造意愿不被情景题覆盖', () => {
    const a = assess(neutralAnswers([['f_postgrad', 'no']]));
    expect(a.profile.constraints.postgradIntent).toBe('no');

    // v_delay 的每个选项都会写 postgradIntent，无论它选什么都不得改写上面那个答案
    for (const opt of ['a', 'b', 'depends']) {
      const b = assess(neutralAnswers([['f_postgrad', 'no'], ['v_delay', opt]]));
      expect(b.profile.constraints.postgradIntent, `v_delay=${opt}`).toBe('no');
    }
  });

  it('只答情景题时，仍能从情景题推断出深造意愿', () => {
    const answers = neutralAnswers();
    delete answers.f_postgrad;
    answers.v_delay = 'b';
    expect(assess(answers).profile.constraints.postgradIntent).toBe('yes');
  });

  it('学制档位选到哪一档就取哪个数，不被别的事实题覆盖掉', () => {
    expect(assess(neutralAnswers([['f_years', 'y4']])).profile.constraints.maxProgramYears).toBe(4);
    expect(assess(neutralAnswers([['f_years', 'y8']])).profile.constraints.maxProgramYears).toBe(8);
  });
});

describe('题库结构本身', () => {
  it('每道题都归在已定义的段里', () => {
    for (const item of ITEMS) expect(SECTIONS).toContain(item.section);
  });

  it('每题都有 measuring 说明，结果页要能回答「这题在测什么」', () => {
    for (const item of ITEMS) expect(item.measuring.length).toBeGreaterThan(3);
  });

  it('题 id 唯一', () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每一项硬约束都有 facts 题在采集', () => {
    /**
     * 断的是「哪一项硬约束没有任何 facts 题会写它」——
     * 只数题目数量的话，删掉学费题或视力题照样全绿，而引擎会静默退化成默认值。
     */
    const written = new Set<string>();
    const collect = (c: Record<string, unknown> | undefined) => {
      for (const k of Object.keys(c ?? {})) written.add(k);
    };
    for (const item of ITEMS.filter((i) => i.section === 'facts')) {
      for (const o of item.options) collect(o.delta.constraints);
    }
    const missing = MEASURABLE_CONSTRAINTS.filter((k) => !written.has(k));
    expect(missing, `这些硬约束没被任何事实题采集：${missing.join(', ')}`).toEqual([]);
  });

  /**
   * 基准答卷的每个值都必须命中题库里真实存在的 option id。
   * 之前 e_fix/e_why 写着不存在的 'mid'：不报错、不产生观测，却照样计入 completion，
   * 于是「中性人」少了两个兴趣观测，一堆以它为基线的断言其实在测别的东西。
   */
  it('基准答卷里每个答案都能在题库里找到对应选项', () => {
    const bad: string[] = [];
    for (const item of ITEMS) {
      const v = neutralAnswers()[item.id];
      // 有些题故意留空（如 f_exclude），用来验「没答」这条语义
      // 注意这里必须是 continue：写成 return 会让整道门在后半段题库上直接空转
      if (v === undefined) continue;
      const ids = item.options.map((o) => o.id);
      for (const x of Array.isArray(v) ? v : [v]) {
        if (!ids.includes(x as string)) bad.push(`${item.id}=${x}`);
      }
    }
    // 键也得是真的题号：打错一个 key 会静默变成「这题没答」，而覆盖率阈值容得下 5 个空洞
    const ids = new Set(ITEMS.map((i) => i.id));
    expect(Object.keys(neutralAnswers()).filter((k) => !ids.has(k))).toEqual([]);
    expect(bad).toEqual([]);
    // 也不能空到失去「中性人」的意义：绝大多数题必须有值
    const covered = ITEMS.filter((i) => neutralAnswers()[i.id] !== undefined).length;
    expect(covered / ITEMS.length).toBeGreaterThan(0.85);
  });

  it('每个负载维度至少被一题观测到', () => {
    const covered = new Set<string>();
    for (const item of ITEMS) {
      for (const o of item.options) {
        for (const d of Object.keys(o.delta.tolerance ?? {})) covered.add(d);
      }
    }
    const missing = LOAD_DIMENSIONS.filter((d) => !covered.has(d));
    expect(missing).toEqual([]);
  });
});

describe('观测与诊断', () => {
  it('空白问卷 completion 为 0 且所有维度都未测到', () => {
    const a = assess({});
    expect(a.diagnostics.completion).toBe(0);
    expect(a.diagnostics.unanswered.length).toBe(ITEMS.length);
    expect(a.profile.tolerance.math).toBeNull();
    expect(a.profile.tolerance.visual).toBeNull();
  });

  it('只被一道题测到的维度进 thin，且 thin 里的观测数确实为 1', () => {
    const a = assess(neutralAnswers());
    expect(a.diagnostics.thin.length).toBeGreaterThan(0);
    for (const entry of a.diagnostics.thin) {
      const sample = lookupSample(a, entry);
      expect(sample, `${entry} 应能在 measurement 里找到`).not.toBeNull();
      expect(sample!.observations.length, `${entry} 被标为 thin 但观测数不是 1`).toBe(1);
    }
  });

  it('多选题把每个勾选都聚合进来，不会只取第一个', () => {
    const a = assess(neutralAnswers([['f_subjects', ['physics', 'chemistry', 'biology']]]));
    expect(new Set(a.profile.constraints.subjectChoices)).toEqual(
      new Set(['physics', 'chemistry', 'biology']),
    );
  });

  it('排除门类多选生效', () => {
    const a = assess(neutralAnswers([['f_exclude', ['engineering', 'arts']]]));
    expect(a.profile.constraints.excludedCategories).toContain('engineering');
    expect(a.profile.constraints.excludedCategories).toContain('arts');
  });

  it('未回答的题被完整记录，供引擎判断哪些规则无法生效', () => {
    const answers = neutralAnswers();
    delete answers.f_color;
    delete answers.f_years;
    const a = assess(answers);
    expect(a.diagnostics.unanswered).toContain('f_color');
    expect(a.diagnostics.unanswered).toContain('f_years');
  });

  /**
   * forced 题既不算自报矛盾（那是同一情景里的相对取舍），也不许因为它站在极值上
   * 就把整个维度跳过：这份答卷里 v_applied=-0.9 与 v_depth=+0.5 都占着端点，
   * 若先取极值再排除 forced，e_why 与 t_proof 这对真矛盾永远报不出来。
   */
  it('同一维度的两个观测差距过大时判为矛盾，且不依赖人工配对表', () => {
    const a = assess(
      neutralAnswers([
        ['e_why', 'recent'],
        ['t_proof', 'shutdown'],
        ['e_emotion', 'hold'],
        ['t_people_daily', 'impossible'],
      ]),
    );
    const pairs = new Map(
      a.diagnostics.contradictions.map((c) => [c.dimension, c.observations.map((o) => o.item).sort()]),
    );
    // 有符号轴走 SPAN_SIGNED、0..1 维度走 SPAN_01，两条阈值都得真的跑到
    expect(pairs.get('axis.theoryVsApplied')).toEqual(['e_why', 't_proof']);
    expect(pairs.get('tolerance.interpersonal')).toEqual(['e_emotion', 't_people_daily']);
  });

  it('全部按同一方向作答时不应产生矛盾', () => {
    const a = assess(neutralAnswers());
    const bad = a.diagnostics.contradictions.filter((c) => c.dimension.startsWith('tolerance'));
    expect(bad).toEqual([]);
  });
});

describe('存档过滤：题库改过之后旧答案不能冒充已答', () => {
  it('多选题里已不存在的选项 id 被剔除，全部失效则整题视为未答', () => {
    // military 是 2026 目录里不存在的门类，老存档可能带着它
    expect(pruneAnswers({ f_exclude: ['military'] })).toEqual({});
    expect(pruneAnswers({ f_exclude: ['military', 'arts'] })).toEqual({ f_exclude: ['arts'] });
  });

  it('单选题按当前题库校验，不认识的选项值一律丢弃', () => {
    expect(pruneAnswers({ f_color: 'normal' })).toEqual({ f_color: 'normal' });
    expect(pruneAnswers({ f_color: 'protanopia' })).toEqual({});
    // 旧版这题是 4-12 的滑块，存档里躺着的是裸数字；它们不再是合法选项，
    // 夹回范围等于替用户承认「他说过 6 年」，所以必须丢
    expect(pruneAnswers({ f_years: 6 })).toEqual({});
    expect(pruneAnswers({ f_years: 'y5' })).toEqual({ f_years: 'y5' });
  });

  it('多选题的勾选数按题目声明的上限截断', () => {
    const multi = ITEMS_BY_ID.get('f_subjects');
    if (multi?.kind !== 'multi' || !multi.maxSelections) throw new Error('f_subjects 应该是有限选的多选题');
    const over = multi.options.map((o) => o.id);
    const pruned = pruneAnswers({ f_subjects: over });
    expect((pruned.f_subjects as string[]).length).toBe(multi.maxSelections);
  });

  it('题目本身被删掉时整条丢弃，未知结构一律不接受', () => {
    expect(pruneAnswers({ e_非exists: 'many' })).toEqual({});
    expect(pruneAnswers(null)).toEqual({});
    expect(pruneAnswers('nonsense')).toEqual({});
  });

  it('过滤后的存档喂给评分时，那题确实算未答', () => {
    const pruned = pruneAnswers({ f_exclude: ['military'], f_subjects: ['physics'] });
    const a = assess(pruned);
    expect(a.diagnostics.unanswered).toContain('f_exclude');
    expect(a.profile.constraints.excludedCategories).toEqual([]);
  });
});
