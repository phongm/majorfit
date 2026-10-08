import { describe, expect, it } from 'vitest';
import { ALL_MAJORS } from '../src/data/majors';
import {
  CAREER_BARRIER_LABEL,
  CAREER_FIT_LABEL,
  FIELD_CATEGORIES,
  LOAD_DIMENSIONS,
  type CareerFit,
  type LoadDimension,
} from '../src/domain/types';

/**
 * 数据完整性门。
 * 这些断言看着像样板，但它们挡住的是最坏的一类故障：
 * 字段缺一个值，评分引擎就把它当 0，然后静默地把高记忆量专业推给背不动的学生。
 */
describe('专业画像数据完整性', () => {
  it('至少覆盖首批目标数量', () => {
    expect(ALL_MAJORS.length).toBeGreaterThanOrEqual(40);
  });

  it('id 唯一', () => {
    const ids = ALL_MAJORS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * 画像层只按 id 命中目录，所以 code 与 id 不一致就是给自己埋雷：
   * 要么目录代码查不到画像，要么同一条专业有两个身份。
   * 与其在代码里加一份 code 索引的冗余分支（永远没有数据会走到），不如把约定钉在门上。
   */
  it('code 与 id 不一致的情况不允许存在', () => {
    const split = ALL_MAJORS.filter((m) => m.code !== undefined && m.code !== m.id);
    expect(split.map((m) => `${m.name}: id=${m.id} code=${m.code}`)).toEqual([]);
  });

  it('每个专业都归在 13 个学科门类之一', () => {
    for (const m of ALL_MAJORS) {
      expect(FIELD_CATEGORIES).toContain(m.category);
    }
  });

  it('11 个负载维度全部存在且落在 0..1', () => {
    for (const m of ALL_MAJORS) {
      for (const d of LOAD_DIMENSIONS) {
        const v = m.load[d as LoadDimension];
        expect(v, `${m.name}.${d}`).toBeTypeOf('number');
        expect(v, `${m.name}.${d} 越界`).toBeGreaterThanOrEqual(0);
        expect(v, `${m.name}.${d} 越界`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('RIASEC 需求向量完整且在 0..1', () => {
    for (const m of ALL_MAJORS) {
      for (const k of ['R', 'I', 'A', 'S', 'E', 'C'] as const) {
        expect(m.riasec[k], `${m.name}.${k}`).toBeTypeOf('number');
        expect(m.riasec[k]).toBeGreaterThanOrEqual(0);
        expect(m.riasec[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('honestDrawbacks 非空：空值意味着没录，不是「这个专业没有缺点」', () => {
    const empty = ALL_MAJORS.filter((m) => m.honestDrawbacks.length === 0);
    expect(empty.map((m) => m.name)).toEqual([]);
  });

  it('每条负面清单都得是有信息量的句子，不能是占位', () => {
    for (const m of ALL_MAJORS) {
      for (const d of m.honestDrawbacks) {
        expect(d.length, `${m.name} 有过短的劝退条目`).toBeGreaterThan(12);
      }
    }
  });

  it('核心课与拦路虎课都存在', () => {
    for (const m of ALL_MAJORS) {
      expect(m.coreCourses.length, m.name).toBeGreaterThan(2);
      expect(m.gatekeeperCourses.length, m.name).toBeGreaterThan(0);
    }
  });

  it('careerPaths 非空且门槛合法', () => {
    // 合法值集合从界面标签表取：加了新档位却忘了写中文说法，这里会一起红
    const barriers = new Set(Object.keys(CAREER_BARRIER_LABEL));
    for (const m of ALL_MAJORS) {
      expect(m.careerPaths.length, m.name).toBeGreaterThan(1);
      for (const p of m.careerPaths) expect(barriers.has(p.entryBarrier), `${m.name}/${p.name}`).toBe(true);
    }
  });

  /**
   * 一条去向必须判过占不占正门。
   * 注意 fit 在类型上就是必填的，所以「值对不对得上枚举」那种断言是恒真的 ——
   * 这里钉的是语义：漏标、全标正门、把「转行」那类标成正门，都是这几种断言在管。
   */
  it('每条去向都判过正门/侧门/顺路', () => {
    const fits = new Set<CareerFit>(Object.keys(CAREER_FIT_LABEL) as CareerFit[]);
    for (const m of ALL_MAJORS) {
      for (const p of m.careerPaths) expect(fits.has(p.fit), `${m.name}/${p.name} 的 fit 不是合法档位`).toBe(true);
    }
  });

  it('去向名在同一专业内不许重复', () => {
    // 列表拿名字当 key，重名会让 React 静默复用错行
    for (const m of ALL_MAJORS) {
      const names = m.careerPaths.map((p) => p.name);
      expect(new Set(names).size, `${m.name} 的去向有重名：${names.join(' / ')}`).toBe(names.length);
    }
  });

  it('名字里写着「转」「改行」的去向不许标成正门', () => {
    const hits = ALL_MAJORS.flatMap((m) =>
      m.careerPaths
        .filter((p) => p.fit === 'main' && /转|改行/.test(p.name))
        .map((p) => `${m.name}/${p.name}`),
    );
    expect(hits).toEqual([]);
  });

  /**
   * 把一条去向判成侧门/顺路，理由必须是「入口被别人占了」，不能是「要读研」。
   * 学历门槛已经由 entryBarrier 单独表达了，两件事混在一起，fit 就退化成了
   * 「这个专业要不要读研」的重复陈述 —— 本轮就有 3 条是这么误判的。
   */
  it('高学历门槛的侧门必须说清入口为什么不在自己手里', () => {
    const reason = /入口|主流|更认|优先|背景|还太新|科班|转|课程|别人|绕|出口|资格|不能考/;
    const hits: string[] = [];
    for (const m of ALL_MAJORS) {
      for (const p of m.careerPaths) {
        if (p.entryBarrier !== 'master' && p.entryBarrier !== 'doctor') continue;
        if (p.fit === 'main') continue;
        if (!reason.test(`${p.name}${p.note ?? ''}`)) hits.push(`${m.name}/${p.name}`);
      }
    }
    expect(hits, `这些行只写了门槛，没写入口理由：${hits.join('、')}`).toEqual([]);
  });

  /**
   * 正文只显示前几条，所以取行规则必须保证两类都在：
   * 少了侧门/顺路，最有决策价值的那行没人看得到（心理学「精神科医师［顺路］」）；
   * 少了正门，一张卡会给人「这专业没有对口出路」的假象（工商管理只剩三条侧门）。
   * 这两种错都被实测抓到过，所以钉的是「各至少一条」，不是「全部显示」。
   */
  it('卡片正文既不许藏掉侧门，也不许藏掉正门', async () => {
    const { pickPaths } = await import('../src/ui/CareerPaths');
    for (const m of ALL_MAJORS) {
      const shown = pickPaths(m.careerPaths);
      const has = (want: (f: string) => boolean) => shown.some((p) => want(p.fit));
      const any = (want: (f: string) => boolean) => m.careerPaths.some((p) => want(p.fit));
      expect(has((f) => f === 'main'), `${m.name}：数据里有正门，正文却一条没显示`).toBe(any((f) => f === 'main'));
      expect(has((f) => f !== 'main'), `${m.name}：数据里有侧门/顺路，正文却一条没显示`).toBe(
        any((f) => f !== 'main'),
      );
      // 输出顺序必须仍是数据原顺序，兜底补进来的行不许插到最前面
      expect(shown.map((p) => p.name), m.name).toEqual(
        m.careerPaths.filter((p) => shown.includes(p)).map((p) => p.name),
      );
    }
  });

  it('深造依赖与本科兑现度不能同时虚高', () => {
    const liars = ALL_MAJORS.filter((m) => m.postgradNecessity > 0.7 && m.undergradJobFit > 0.7);
    expect(liars.map((m) => m.name)).toEqual([]);
  });

  it('选科要求里不应同时列出物理与历史（首选科目是二选一，同时列出等于「不限」，该写空数组）', () => {
    const ambiguous = ALL_MAJORS.filter(
      (m) => m.subjectRequirements.includes('physics') && m.subjectRequirements.includes('history'),
    );
    expect(
      ambiguous.map((m) => m.name),
      '这类条目应改成 subjectRequirements: []，让「不限」在数据里显式表达',
    ).toEqual([]);
  });

  it('时间到稳定收入不小于学制', () => {
    for (const m of ALL_MAJORS) {
      expect(m.timeToStableIncomeYears, m.name).toBeGreaterThanOrEqual(m.degreeYears - 1);
    }
  });

  it('marketNote 对收缩类专业必须给出理由', () => {
    const weak = ALL_MAJORS.filter((m) => m.marketTrend === 'contracting' || m.marketTrend === 'cooling');
    for (const m of weak) {
      expect(m.marketNote.length, m.name).toBeGreaterThan(20);
    }
  });

  it('名称易混的专业必须给出澄清说明', () => {
    const confused = ALL_MAJORS.filter((m) => m.commonlyConfusedWith.length > 0);
    for (const m of confused) {
      expect(m.clarification, `${m.name} 列了易混专业却没写澄清`).toBeTruthy();
    }
  });

  it('未人工核对的条目一律标 verified=false', () => {
    for (const m of ALL_MAJORS) {
      const todo = m.quality.todo ?? [];
      if (todo.length > 0) expect(m.quality.verified, m.name).toBe(false);
    }
  });

  it('每条专业都标注了核对状态，不允许无主数据', () => {
    for (const m of ALL_MAJORS) {
      expect(m.quality.lastReviewed, m.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 断的是 mk 的映射规则，而不是「它是这三个字面量之一」（那由类型系统保证，恒真）
      const todo = m.quality.todo ?? [];
      const expected = todo.length === 0 ? 'high' : todo.length > 3 ? 'low' : 'medium';
      expect(m.quality.confidence, `${m.name}（todo ${todo.length} 项）`).toBe(expected);
    }
  });

  /**
   * costTier 缺省是 'public'，会被学费硬过滤当成「家里负担得起」。
   * 没逐校核实的就必须自己承认 —— 挡的是「默认值冒充结论」，不是挡人。
   */
  it('学费档位没核实的，必须在 todo 里写明', () => {
    // 断言的是「没核实就要自认」，不是「值等于公办」——
    // 否则将来真录进一条核实过的公办档位，会和另一道门互锁、录不进去
    const silent = ALL_MAJORS.filter(
      (m) => !m.costTierKnown && !(m.quality.todo ?? []).some((t) => t.includes('学费')),
    );
    expect(silent.map((m) => m.name)).toEqual([]);
  });

  /**
   * 既然写了 costTier 就算已核实，那 todo 里就不该同时留着「学费待核」。
   * 反向的门（按公办假定必须自认）上面已有，这里挡的是自相矛盾的那一半。
   */
  it('声称学费档位已核实的条目，不许同时留着学费待核的记账', () => {
    const lying = ALL_MAJORS.filter(
      (m) => m.costTierKnown && (m.quality.todo ?? []).some((t) => t.includes('学费')),
    );
    expect(lying.map((m) => m.name)).toEqual([]);
  });

  /**
   * 界面在三处硬写了「本库只有艺术类专业核过学费档位」
   * （engine/index.ts 的 coverageNotes、items.ts 的 help、App.tsx 首屏）。
   * 这道门保证那句话是真的：一旦录进非艺术的已核实档位，三处文案必须同时改。
   */
  it('已核实学费档位的条目只有艺术学门类', () => {
    const known = ALL_MAJORS.filter((m) => m.costTierKnown);
    expect(known.length, '库里应该有核实过档位的条目').toBeGreaterThan(0);
    // 判据必须和文案同一口径：channelBlocked 还包含体育学类，
    // 用「都被通道挡」当断言的话，给体育教育补一个已核实档位仍能全绿，而三句文案同时变假话
    expect(known.every((m) => m.category === 'arts'), known.map((m) => `${m.name}(${m.category})`).join('、')).toBe(true);
  });

  it('门类覆盖度不能只堆工科', () => {
    const categories = new Set(ALL_MAJORS.map((m) => m.category));
    expect(categories.size).toBeGreaterThanOrEqual(8);
  });
});
