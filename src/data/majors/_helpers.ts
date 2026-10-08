import { channelBlock } from '../../domain/admission';
import type { LoadVector, MajorProfile, RIASEC } from '../../domain/types';

export const REVIEW_DATE = '2026-10-02';

/**
 * 专业条目构造器。
 *
 * `load` 的 11 个维度全部必填 —— 不是为了填满表格，
 * 而是逼着录入时对每一项做出判断。留空会让评分引擎把缺失当 0，
 * 静默地把一个高记忆量专业推给完全背不动的学生。
 */
type Required =
  | 'id'
  | 'name'
  | 'category'
  | 'subCategory'
  | 'degreeYears'
  | 'degreeName'
  | 'load'
  | 'riasec'
  | 'coreCourses'
  | 'gatekeeperCourses'
  | 'undergradJobFit'
  | 'postgradNecessity'
  | 'civilServiceFit'
  | 'incomeRealism'
  | 'timeToStableIncomeYears'
  | 'marketTrend'
  | 'marketNote'
  | 'subjectRequirements'
  | 'careerPaths'
  | 'honestDrawbacks'
  | 'idealFitNote'
  | 'poorFitNote';

export type MajorInput = Pick<MajorProfile, Required> &
  Partial<Omit<MajorProfile, Required>> & {
    /** 未经人工核对的字段列表；非空即 quality.verified = false */
    todo?: string[];
  };

const COST_NOTE = '学费档位未逐校核实（暂按公办普通收费计，中外合作与民办另计）';

export function mk(raw: MajorInput): MajorProfile {
  // todo 只是录入期的记账，不该作为多余键被带进运行时的 MajorProfile
  const { todo: declared, ...input } = raw;
  /**
   * 学费档位和体检口径是同一类问题：缺省值 'public' 会被当成「家里负担得起」参与硬过滤。
   * 既然没逐校核实，就必须写进 todo 让界面自己承认，而不是让默认值冒充结论。
   */
  const todo = [...(declared ?? [])];
  if (!('costTier' in input) && !todo.some((t) => t.includes('学费'))) todo.push(COST_NOTE);
  return {
    code: undefined,
    commonlyConfusedWith: [],
    clarification: undefined,
    healthRestrictions: {},
    costTier: 'public',
    longProgramNote: undefined,
    /**
     * 选科要求是必填字段（`Required` 里列着），所以手核条目一律算已核对；
     * 空数组是作者明确写的「不限」。体检限制不同：靠键是否存在来判断，
     * 没写的维度就是没查过，所以这里不碰 healthRestrictions。
     */
    subjectRequirementsKnown: true,
    costTierKnown: 'costTier' in input,
    provenance: 'hand_verified',
    ...(() => {
      const block = channelBlock(input.category, input.subCategory);
      return block
        ? { recommendable: false, channelBlocked: true, notRecommendableReason: block.reason }
        : { recommendable: true, channelBlocked: false };
    })(),
    ...input,
    quality: {
      verified: todo.length === 0,
      lastReviewed: REVIEW_DATE,
      confidence: todo.length === 0 ? 'high' : todo.length > 3 ? 'low' : 'medium',
      todo,
    },
  };
}

export const R = (R_: number, I: number, A: number, S: number, E: number, C: number): RIASEC => ({
  R: R_,
  I,
  A,
  S,
  E,
  C,
});

export const L = (
  math: number,
  programming: number,
  abstraction: number,
  memorization: number,
  lab: number,
  visual: number,
  writing: number,
  quantitative: number,
  interpersonal: number,
  fieldwork: number,
  physical: number,
): LoadVector => ({
  math,
  programming,
  abstraction,
  memorization,
  lab,
  visual,
  writing,
  quantitative,
  interpersonal,
  fieldwork,
  physical,
});
