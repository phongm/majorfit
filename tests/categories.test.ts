import { describe, expect, it } from 'vitest';
import { FIELD_CATEGORIES, FIELD_CATEGORY_LABELS, type FieldCategory } from '../src/domain/types';
import { ITEMS_BY_ID } from '../src/assessment/items';

/**
 * 锚点：《普通高等学校本科专业目录（2026年）》（教高函〔2026〕2号）里的 13 个学科门类。
 * 目录代码 11 军事学是空缺的 —— 军事类专业不走普通本科招生渠道，不在目录内。
 * 这里把代码写死，是为了让「本项目的门类表和官方目录漂移」成为可测故障：
 * 上一版把军事学当成一个可选门类放进问卷，用户排除的是一个不存在的东西。
 */
const OFFICIAL: [string, FieldCategory][] = [
  ['01', 'philosophy'],
  ['02', 'economics'],
  ['03', 'law'],
  ['04', 'education'],
  ['05', 'literature'],
  ['06', 'history'],
  ['07', 'science'],
  ['08', 'engineering'],
  ['09', 'agriculture'],
  ['10', 'medicine'],
  ['12', 'management'],
  ['13', 'arts'],
  ['14', 'interdisciplinary'],
];

describe('学科门类表对齐教育部目录', () => {
  it('门类数量与官方目录一致', () => {
    expect(FIELD_CATEGORIES.length).toBe(OFFICIAL.length);
  });

  it('顺序与门类代码一致，且不含目录里没有的军事学', () => {
    expect([...FIELD_CATEGORIES]).toEqual(OFFICIAL.map(([, key]) => key));
    expect(FIELD_CATEGORIES as readonly string[]).not.toContain('military');
  });

  it('每个门类都有中文名，且与官方门类名逐字对上', () => {
    const officialLabels: Record<string, string> = {
      '01': '哲学',
      '02': '经济学',
      '03': '法学',
      '04': '教育学',
      '05': '文学',
      '06': '历史学',
      '07': '理学',
      '08': '工学',
      '09': '农学',
      '10': '医学',
      '12': '管理学',
      '13': '艺术学',
      '14': '交叉学科',
    };
    for (const [code, key] of OFFICIAL) {
      expect(FIELD_CATEGORY_LABELS[key], key).toBe(officialLabels[code]);
    }
  });
});

describe('排除门类这道题与门类表不漂移', () => {
  const raw = ITEMS_BY_ID.get('f_exclude');
  if (!raw || raw.kind !== 'multi') throw new Error('题库里 f_exclude 必须存在且是多选题');
  const item = raw;
  const optionIds = item.options.map((o) => o.id);
  /** 每个选项 delta 里真正写进约束的门类 */
  const targets = item.options.flatMap((o) => o.delta.constraints?.excludedCategories ?? []);

  it('13 个门类都能被排除，不多不少不重复', () => {
    expect(new Set(optionIds).size, '选项 id 有重复').toBe(optionIds.length);
    expect([...new Set(targets)].sort()).toEqual([...FIELD_CATEGORIES].sort());
    expect(targets.length, '某个选项没把门类写进 delta，或一个选项动了多个门类').toBe(FIELD_CATEGORIES.length);
  });

  it('选项 id 与它要排除的门类同名，否则存档里的勾选会对不上', () => {
    item.options.forEach((o) => {
      expect(targets.filter((t) => t === o.id).length, o.id).toBe(1);
    });
  });
});
