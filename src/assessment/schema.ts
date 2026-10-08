import type { FieldCategory, LoadDimension, RIASEC, SubjectCode, TuitionTier } from '../domain/types';

/**
 * 题库结构。
 *
 * 两类题型，刻意不用「非常不同意 → 非常同意」的李克特量表：
 * 1. behavior-anchor —— 选项是具体可核查的行为事实（做过没有、做了多久）。
 *    最高档必须拿得出证据，社会赞许性偏差在这里失效：
 *    想装的人也编不出「持续一年并做出结果」。
 * 2. forced-choice —— 两个都想要的好东西里只能选一个，逼出真实取舍。
 *    问「你在不在乎收入」没人会说不在乎；问「稳定但天花板可见 vs
 *    收入更高但 35 岁后不确定」才有信息量。
 *
 * 硬事实也用选项而不是滑块：滑块停在哪儿就像已经选了哪儿，
 * 「懒得拖」和「就要这个数」这两种完全不同的意思会被压成同一个答案。
 */

export interface ProfileDelta {
  interests?: Partial<RIASEC>;
  tolerance?: Partial<Record<LoadDimension, number>>;
  theoryVsApplied?: number;
  grit?: number;
  values?: Partial<{
    stability: number;
    income: number;
    autonomy: number;
    meaning: number;
    prestige: number;
  }>;
  constraints?: Partial<{
    postgradIntent: 'yes' | 'no' | 'undecided';
    maxProgramYears: number;
    colorVision: 'normal' | 'colorWeak' | 'colorBlind';
    poorVision: boolean;
    maxAnnualTuition: TuitionTier;
    subjectChoices: SubjectCode[];
    subjectChoicesConfirmed: boolean;
    excludedCategories: FieldCategory[];
  }>;
}

/** 所有题型共用的选项形状；sub 是给用户的补充说明，不是数据字段 */
export interface Option {
  id: string;
  label: string;
  sub?: string;
  delta: ProfileDelta;
}

interface BaseItem {
  id: string;
  section: SectionId;
  prompt: string;
  /** 结果页展示的「我们在测什么」，用于建立信任 */
  measuring: string;
  help?: string;
}

export interface BehaviorItem extends BaseItem {
  kind: 'behavior';
  options: Option[];
}

export interface ForcedChoiceItem extends BaseItem {
  kind: 'forced';
  options: Option[];
}

export interface SingleFactItem extends BaseItem {
  kind: 'fact';
  options: Option[];
}

/** 用于选科和排斥门类 */
export interface MultiFactItem extends BaseItem {
  kind: 'multi';
  options: Option[];
  maxSelections?: number;
}

export type Item =
  | BehaviorItem
  | ForcedChoiceItem
  | SingleFactItem
  | MultiFactItem;

export const SECTIONS = ['facts', 'evidence', 'tolerance', 'tradeoff'] as const;
export type SectionId = (typeof SECTIONS)[number];

export const SECTION_META: Record<SectionId, { title: string; blurb: string }> = {
  facts: {
    title: '先确认几件硬事实',
    blurb: '选科和身体条件会直接决定你能报什么。这部分不填，推荐出来的东西可能你根本报不了。',
  },
  evidence: {
    title: '做过什么，比觉得自己是什么更重要',
    blurb: '下面的选项都是具体事实，没做过就选没做过。',
  },
  tolerance: {
    title: '你能长期忍受哪种辛苦',
    blurb: '专业适配的真相是「你受得了它的苦」。兴趣会让你选，耐受度决定你能不能读完并靠它吃饭。',
  },
  tradeoff: {
    title: '两个都想要，只能挑一个',
    blurb: '每一组的两个选项真的互斥，只能选一个。',
  },
};
