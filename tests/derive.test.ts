import { describe, expect, it } from 'vitest';
import { assess } from '../src/assessment/scoring';
import { CATALOG_MAJORS } from '../src/data/catalog/2026';
import { ALL_MAJORS, MAJORS_BY_ID } from '../src/data/majors';
import { coverage, resolveMajor, type ResolvedMajor } from '../src/data/profiles/derive';
import { DERIVED_SCOPE } from '../src/domain/types';
import { score } from '../src/engine/rank';
import { LOAD_DIMENSIONS, HARD_CONSTRAINTS } from '../src/domain/types';
import { neutralAnswers } from './helpers';

/**
 * 推断层的纪律：它可以粗，但不能谎。
 * 每个推断值都要能报出样本、要标注自己没被核对过、而且绝不能进推荐。
 */
describe('硬约束计数的口径', () => {
  /**
   * 「还有 N 项硬条件没答」这句在三处界面出现。subjectChoicesConfirmed 是核对动作，
   * 不是报考资格；把它算进去，只缺这一项的用户会看到一条不存在的缺口。
   * 这里钉死成员，避免将来有人顺手加回去而测试仍全绿。
   */
  it('HARD_CONSTRAINTS 恰好等于「全部可采集约束减去核对动作」', () => {
    // 逐个点名会漏掉后加的那一项（漏掉 maxAnnualTuition 时，界面会少报一项硬条件，
    // high 档就能说出「硬条件填全了」这种假话）。整表比对才钉得住。
    // 显式清单：新增一项可采集约束时这里会失败，逼一次人工分类判断
    // （它算「报考资格」还是「核对动作」？后者不该进「硬条件没填」的计数）
    expect([...HARD_CONSTRAINTS].sort()).toEqual(
      ['colorVision', 'maxProgramYears', 'postgradIntent', 'poorVision', 'subjectChoices', 'maxAnnualTuition'].sort(),
    );
    expect(HARD_CONSTRAINTS).not.toContain('subjectChoicesConfirmed');
    expect(new Set(HARD_CONSTRAINTS).size).toBe(HARD_CONSTRAINTS.length);
  });
});

describe('专业类 / 门类推断层', () => {
  it('已人工核对的专业优先按人工画像返回，不被推断值覆盖', () => {
    for (const m of ALL_MAJORS.slice(0, 10)) {
      const r = resolveMajor(m.id);
      expect(r?.kind, m.name).toBe('hand_verified');
      if (r?.kind === 'hand_verified') expect(r.major).toBe(m);
    }
  });

  it('同类里有已核对专业时，能拿到类级推断画像', () => {
    // 网络空间安全已核对，同类的 080912T 这类新专业应能推断
    const entry = CATALOG_MAJORS.find((e) => e.classCode === '0809' && !MAJORS_BY_ID.has(e.code));
    expect(entry, '计算机类里应有尚未录画像的专业').toBeDefined();
    const r = resolveMajor(entry!.code);
    expect(r?.kind, entry!.name).toBe('derived');
    if (r?.kind !== 'derived') return;
    expect(r.major.provenance).toBe('class_derived');
    expect(r.major.derivedFrom.length, '推断必须能报出样本').toBeGreaterThan(0);
    expect(r.major.quality.verified).toBe(false);
    expect(r.major.recommendable, '推断画像没有资格进推荐').toBe(false);
    expect(r.major.notRecommendableReason).toContain('不参与推荐');
  });

  /**
   * 「同类」是个会骗人的词：按门类推断时样本横跨好几个专业类，
   * 说「同类」等于把 25 个工学专业说成 25 个海洋机器人的同行。
   */
  it('推断层的用户可见文案报得准样本池层级', () => {
    const derived = CATALOG_MAJORS.map((e) => resolveMajor(e.code)).filter(
      (r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived',
    );
    expect(derived.length).toBeGreaterThan(50);
    for (const r of derived) {
      const text = [...r.major.derivedCaveats, ...(r.major.quality.todo ?? []), r.major.notRecommendableReason ?? ''].join(
        ' ',
      );
      const want = DERIVED_SCOPE[r.major.provenance];
      const other = want === '同专业类' ? '同学科门类' : '同专业类';
      expect(text, `${r.major.name}：笼统地说「同类」`).not.toContain('同类');
      expect(text, `${r.major.name}（${r.major.provenance}）`).not.toContain(other);
    }
  });

  it('推断值都落在评分引擎要求的区间里', () => {
    const derived = CATALOG_MAJORS.map((e) => resolveMajor(e.code))
      .filter((r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived')
      .map((r) => r.major);
    expect(derived.length).toBeGreaterThan(50);
    for (const d of derived) {
      for (const dim of LOAD_DIMENSIONS) {
        expect(d.load[dim], `${d.name}.${dim} 下界`).toBeGreaterThanOrEqual(0);
        expect(d.load[dim], `${d.name}.${dim} 上界`).toBeLessThanOrEqual(1);
      }
      for (const k of ['R', 'I', 'A', 'S', 'E', 'C'] as const) {
        expect(d.riasec[k], `${d.name}.${k} 下界`).toBeGreaterThanOrEqual(0);
        expect(d.riasec[k], `${d.name}.${k} 上界`).toBeLessThanOrEqual(1);
      }
      expect(d.timeToStableIncomeYears, d.name).toBeGreaterThanOrEqual(d.degreeYears - 1);
    }
  });

  /** 属性断言而不是「找到一条才检」：没有反例时必须全量通过，有反例时也必须被抓住 */
  it('选科口径：要么有两条以上一致的样本，要么不设限并说明', () => {
    const derived = CATALOG_MAJORS.map((e) => resolveMajor(e.code))
      .filter((r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived')
      .map((r) => r.major);
    expect(derived.length).toBeGreaterThan(50);
    for (const d of derived) {
      if (d.subjectRequirementsKnown) {
        expect(d.derivedFrom.length, `${d.name} 单样本不得外推选科口径`).toBeGreaterThanOrEqual(2);
      } else {
        expect(
          d.derivedCaveats.join(' '),
          `${d.name} 放弃选科规则却没说明原因`,
        ).toMatch(/选科口径不一致|只有 1 个已核对样本/);
      }
    }
  });

  it('交叉学科门类还没有已核对样本，因此不给推断值', () => {
    const cross = CATALOG_MAJORS.filter((e) => e.fieldCode === '14');
    expect(cross.length).toBe(15);
    for (const e of cross) {
      expect(resolveMajor(e.code), `${e.code} ${e.name}`).toBeNull();
    }
  });

  it('目录里每条专业都能算出覆盖度，三个桶加起来不少数', () => {
    const c = coverage();
    expect(c.catalog).toBe(CATALOG_MAJORS.length);
    expect(c.handVerified + c.derived + c.none).toBe(c.catalog);
    expect(c.handVerified).toBe(ALL_MAJORS.length);
    expect(c.derived, '推断层应该显著扩大可诊断范围').toBeGreaterThan(300);
  });

  it('推断画像可以直接喂给评分函数，不需要完整叙述字段', () => {
    const r = resolveMajor(CATALOG_MAJORS.find((e) => e.classCode === '0809' && !MAJORS_BY_ID.has(e.code))!.code);
    if (r?.kind !== 'derived') throw new Error('前置用例已失败');
    const a = assess(neutralAnswers());
    const s = score(r.major, a.profile);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.major.id).toBe(r.major.id);
  });
});

describe('推断层的学位与录取口径', () => {
  /**
   * 目录原文写的是「授予X学士学位」。早先按「X学位」匹配，108 条注记一条都不命中，
   * 全部静默走门类兜底，把 药物制剂（目录：授予理学学士）显示成「医学学士」。
   */
  it('学位授予门类按目录原文取，不拿门类名猜', () => {
    const cases: [string, string][] = [
      ['100702', '理学学士'], // 药物制剂：授予理学学士学位（门类是医学）
      ['020110TK', '管理学学士'], // 低空经济与管理：授予管理学学士学位（门类是经济学）
      ['090116TK', '理学学士'], // 生物育种科学：门类农学，学位是理学
    ];
    for (const [code, expected] of cases) {
      const r = resolveMajor(code);
      if (r?.kind !== 'derived') throw new Error(`${code} 应该走推断层`);
      expect(r.major.degreeName, r.major.name).toBe(expected);
    }
  });

  it('目录允许两个学位门类时，按原文顺序取第一个并说明', () => {
    const multi = CATALOG_MAJORS.filter((e) => /可授.+或.+学士学位/.test(e.degreeNote ?? ''))
      .map((e) => resolveMajor(e.code))
      .filter((r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived');
    expect(multi.length, '目录里应有「可授两种学位」的专业，且它们落在推断层').toBeGreaterThan(0);
    for (const r of multi) {
      const note = CATALOG_MAJORS.find((e) => e.code === r.major.code)!.degreeNote!;
      const first = /可授(.+?)或/.exec(note)?.[1];
      expect(r.major.degreeName, `${r.major.name} 取错了学位门类`).toBe(`${first}学士`);
      expect(r.major.derivedCaveats.join(' '), `${r.major.name} 没说清并列学位`).toContain('可授');
    }
  });

  it('推断层不声明任何体检限制：一个键都不写，才算「没核对」', () => {
    for (const e of CATALOG_MAJORS) {
      const r = resolveMajor(e.code);
      if (r?.kind !== 'derived') continue;
      // 键存在与否就是 filters 判断「核对过没有」的唯一依据（显式 false 也算核对过）
      expect(Object.keys(r.major.healthRestrictions), `${e.name} 传染了样本的体检限制`).toEqual([]);
    }
  });
});
