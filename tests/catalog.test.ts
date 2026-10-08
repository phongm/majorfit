import { describe, expect, it } from 'vitest';
import {
  CATALOG_CLASSES,
  CATALOG_COUNTS,
  CATALOG_FIELDS,
  CATALOG_MAJORS,
  CATALOG_SOURCE,
} from '../src/data/catalog/2026';
import { ALL_MAJORS } from '../src/data/majors';
import { FIELD_CATEGORIES, FIELD_CATEGORY_LABELS } from '../src/domain/types';

/**
 * 目录导入的完整性门。
 * 挡住的是最安静的一类故障：解析器少收一批条目、把后缀吃掉、把专业挂错类，
 * 而界面上一切正常 —— 只是某些专业从此永远不会被推荐到。
 */
describe('官方目录导入', () => {
  it('条目数与官方发布口径一致', () => {
    expect(CATALOG_FIELDS.length).toBe(13);
    expect(CATALOG_CLASSES.length).toBe(92);
    expect(CATALOG_MAJORS.length).toBe(883);
  });

  it('来源元信息齐备，能追溯到文号与校验值', () => {
    expect(CATALOG_SOURCE.docNumber).toBe('教高函〔2026〕2号');
    expect(CATALOG_SOURCE.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(CATALOG_SOURCE.noticeUrl).toContain('moe.gov.cn');
  });

  it('专业代码唯一且符合目录编码规则', () => {
    const codes = CATALOG_MAJORS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c, c).toMatch(/^\d{6,7}(TK|T|K)?$/);
  });

  it('每条专业都挂在真实存在的专业类上，类别与门类一致', () => {
    const classByCode = new Map(CATALOG_CLASSES.map((c) => [c.code, c]));
    const fieldByCode = new Map(CATALOG_FIELDS.map((f) => [f.code, f]));
    for (const m of CATALOG_MAJORS) {
      expect(fieldByCode.has(m.fieldCode), `${m.code} 的门类不存在`).toBe(true);
      if (!m.classCode) {
        // 目录里只有交叉学科门类不给专业划类
        expect(m.fieldCode, `${m.code} 无专业类却不在交叉学科门类下`).toBe('14');
        continue;
      }
      const cls = classByCode.get(m.classCode);
      expect(cls, `${m.code} 找不到专业类 ${m.classCode}`).toBeDefined();
      expect(cls!.fieldCode, `${m.code} 专业类与门类对不上`).toBe(m.fieldCode);
      expect(m.classCode, `${m.code} 专业类应取代码前 4 位`).toBe(m.code.slice(0, 4));
    }
  });

  it('专业名称里没有残留的说明与页码', () => {
    for (const m of CATALOG_MAJORS) {
      expect(m.name, `${m.code} 名称异常`).not.toMatch(/[（）—\s]/);
      expect(m.name.length, `${m.code} 名称过短`).toBeGreaterThan(1);
    }
  });

  it('每个专业类下都至少有一个专业', () => {
    const used = new Set(CATALOG_MAJORS.map((m) => m.classCode));
    const empty = CATALOG_CLASSES.filter((c) => !used.has(c.code));
    expect(empty.map((c) => `${c.code} ${c.name}`)).toEqual([]);
  });

  it('门类表与领域模型的 FieldCategory 双向对齐', () => {
    expect(CATALOG_FIELDS.map((f) => f.category)).toEqual([...FIELD_CATEGORIES]);
    for (const f of CATALOG_FIELDS) {
      expect(f.name, f.code).toBe(FIELD_CATEGORY_LABELS[f.category]);
    }
  });

  it('交叉学科门类的专业保留了原专业代码', () => {
    const moved = CATALOG_MAJORS.filter((m) => m.formerCode);
    expect(moved.length, '目录里 15 条交叉学科专业有 11 条是从工学、医学类迁来的').toBe(11);
    for (const m of moved) {
      expect(m.fieldCode).toBe('14');
      expect(m.formerCode).toMatch(/^\d{6}(TK|T|K)?$/);
      expect(m.formerCode).not.toBe(m.code);
    }
  });
});

describe('画像层与目录层不脱节', () => {
  const catalogById = new Map(CATALOG_MAJORS.map((m) => [m.code, m]));
  const formerById = new Map(CATALOG_MAJORS.filter((m) => m.formerCode).map((m) => [m.formerCode!, m]));

  /**
   * 现有 67 条专业画像的 id 就是专业代码。
   * 它们必须仍能在官方目录里找到，否则这份画像是给一个已不存在的专业写的。
   */
  it('每条已有画像都命中当前目录', () => {
    const missing = ALL_MAJORS.filter((m) => !catalogById.has(m.id) && !formerById.has(m.id));
    expect(missing.map((m) => `${m.id} ${m.name}`), '这些画像对应的专业不在 2026 目录里').toEqual([]);
  });

  /**
   * 目录改写过代码的专业（交叉学科门类那 11 条）必须被画像层跟上。
   * 直接断言「不许有」而不是遍历命中项：没有反例时这条同样是有效门。
   */
  it('画像代码不许停留在已被目录改写的旧代码上', () => {
    const stale = ALL_MAJORS.filter((m) => !catalogById.has(m.id) && formerById.has(m.id));
    expect(
      stale.map((m) => `${m.name} 仍写 ${m.id}，目录已改为 ${formerById.get(m.id)!.code}`),
    ).toEqual([]);
  });

  it('画像名称与目录名称一致', () => {
    const wrong = ALL_MAJORS.flatMap((m) => {
      const entry = catalogById.get(m.id);
      return entry && entry.name !== m.name ? [`${m.id}：画像写「${m.name}」，目录是「${entry.name}」`] : [];
    });
    expect(wrong).toEqual([]);
  });

  /**
   * subCategory 参与结果页的多样性重排（rank.ts 按它限制同类数量），
   * 门类决定排除规则。写错会让同一个类的专业被当成不同类，或排除规则失效。
   */
  it('画像的门类与专业类归属和目录一致', () => {
    const classByName = new Map(CATALOG_CLASSES.map((c) => [c.name, c]));
    const fieldByCode = new Map(CATALOG_FIELDS.map((f) => [f.code, f]));
    const wrong = ALL_MAJORS.flatMap((m) => {
      const entry = catalogById.get(m.id);
      if (!entry) return [];
      const out: string[] = [];
      const field = fieldByCode.get(entry.fieldCode)!;
      if (field.category !== m.category) {
        out.push(`${m.name}：画像门类是 ${m.category}，目录代码 ${entry.fieldCode} 属于 ${field.name}`);
      }
      if (entry.classCode) {
        const cls = CATALOG_CLASSES.find((c) => c.code === entry.classCode)!;
        if (cls.name !== m.subCategory) {
          out.push(`${m.name}：画像写「${m.subCategory}」，目录里 ${entry.classCode} 是「${cls.name}」`);
        }
        expect(classByName.has(m.subCategory), m.subCategory).toBe(true);
      }
      return out;
    });
    expect(wrong).toEqual([]);
  });

  it('degreeYears 与目录口径不冲突（目录不给学制，只校验它在合理区间）', () => {
    for (const m of ALL_MAJORS) {
      expect([4, 5, 6, 7, 8], `${m.name} 学制异常`).toContain(m.degreeYears);
    }
  });
});

/**
 * 生成物不许与存档原文脱节。
 * 「不要手改」写在文件头里不构成约束，能构成约束的是这条重放比对。
 */
describe('生成物可重放', () => {
  it('用同一份官方文本重跑解析器，结果与仓库里的生成物逐字一致', async () => {
    // 生成脚本是 .mjs、不在 tsconfig include 内，因此这里没有类型声明；
    // 用 expect-error 而不是 ignore：一旦将来有了类型，这行会反过来报错提醒
    // @ts-expect-error 无类型声明的构建脚本
    const { parseCatalog, renderCatalog, assertGates, SOURCE_TXT, OUT } = await import('../scripts/build-catalog.mjs');
    const { readFileSync } = await import('node:fs');
    const parsed = parseCatalog(readFileSync(SOURCE_TXT, 'utf8'));
    const stats = assertGates(parsed);
    expect(renderCatalog(parsed, stats)).toBe(readFileSync(OUT, 'utf8'));
  });

  it('条目数写死成官方发布的绝对值，不用生成物自己核对生成物', () => {
    expect(CATALOG_COUNTS).toEqual({ fields: 13, classes: 92, majors: 883 });
  });

  it('门类与专业类的归属符合目录编码规则', () => {
    // 分节顺序与代码前缀是否一致，由 build-catalog 的 assertGates 在重放时把关；
    // 这里钉的是能被独立核对的绝对事实：前缀关系 + 几个公认归属
    for (const c of CATALOG_CLASSES) {
      expect(c.code.slice(0, 2), c.name).toBe(c.fieldCode);
    }
    for (const m of CATALOG_MAJORS) {
      if (m.classCode) expect(m.code.slice(0, 4), `${m.name} 代码与所属类不符`).toBe(m.classCode);
    }
    const known: [string, string][] = [
      ['0809', '08'], // 计算机类 → 工学
      ['0402', '04'], // 体育学类 → 教育学
      ['1007', '10'], // 药学类 → 医学
      ['1305', '13'], // 设计学类 → 艺术学
      ['0705', '07'], // 地理科学类 → 理学
    ];
    const classByCode = new Map(CATALOG_CLASSES.map((c) => [c.code, c]));
    for (const [classCode, fieldCode] of known) {
      expect(classByCode.get(classCode)?.fieldCode, classCode).toBe(fieldCode);
    }
  });
});
