import type { ResolvedMajor } from '../data/profiles/derive';
import { DERIVED_SCOPE, type HealthRestriction, type ProfileProvenance } from '../domain/types';

/** 画像来源在界面上的说法。推断值必须一眼看出是推断值 */
export const PROVENANCE_LABEL: Record<ProfileProvenance, string> = {
  hand_verified: '人工录入',
  class_derived: '按专业类推断',
  field_derived: '按学科门类推断',
};

export const PROVENANCE_CLASS: Record<ProfileProvenance, string> = {
  hand_verified: 'warn',
  class_derived: 'warn',
  field_derived: 'bad',
};

/**
 * 体检口径里哪些维度没核对过，按**单个维度**算：键不存在＝没查过，显式 false 才算查过并确认没限制。
 * 不能把「色盲、色弱两个键都写齐」当作核对过 —— 库里 12 条画像只写了一个维度，
 * 那种整对象判法会把「只录了色盲限制」的土木工程说成色觉口径全没核对，
 * 而它的色盲口径明明是核对过的、并且正在挡人。
 */
export function uncheckedHealthDims(h: HealthRestriction): string[] {
  const out: string[] = [];
  if (!('colorWeak' in h)) out.push('色弱限制');
  if (!('colorBlind' in h)) out.push('色盲限制');
  if (!('poorVision' in h)) out.push('视力限制');
  return out;
}

/** 来源徽章 + 一句话说明它意味着什么 */
export function sourceOf(resolved: ResolvedMajor): { label: string; cls: string; note: string } {
  if (!resolved) {
    return {
      label: '暂无可比数据',
      cls: 'bad',
      note: '本库还没有这个方向任何已核对的样本，给不出负载对比。',
    };
  }
  if (resolved.kind === 'hand_verified') {
    const m = resolved.major;
    const dims = uncheckedHealthDims(m.healthRestrictions);
    /**
     * 「人工录入」不等于「已核对」：库里 67 条里绝大多数还带着待核对字段，
     * 而体检口径没查过的更要直说 —— 徽章写「已逐条核对」、别处写「色觉限制没核对」，
     * 这种自相矛盾会直接摧毁对整份结果的信任。
     */
    if (m.quality.verified && !dims.length) {
      return { label: '已逐条核对', cls: 'ok', note: `人工核对完成（${m.quality.lastReviewed}）` };
    }
    const pending = [
      ...(m.quality.todo?.length ? [`${m.quality.todo.length} 项字段待复核`] : []),
      ...(dims.length ? [`${dims.join('、')}未核对`] : []),
    ].join('；');
    return {
      label: '已录入，待复核',
      cls: 'warn',
      note: `人工录入（${m.quality.lastReviewed}）${pending ? `，${pending}` : ''}`,
    };
  }
  const m = resolved.major;
  /**
   * 「同类」不能一概而论：按门类推断时样本跨了好几个专业类，
   * 说「同类」会把 25 个工学专业说成 25 个海洋机器人同行。
   */
  const reach = m.provenance === 'field_derived' ? '（跨专业类）' : '';
  return {
    label: PROVENANCE_LABEL[m.provenance],
    cls: PROVENANCE_CLASS[m.provenance],
    note: `由 ${m.derivedFrom.length} 个${DERIVED_SCOPE[m.provenance]}${reach}已核对专业聚合出来（负载与兑现度取中位数，学制/学费/行情/收入取保守值），没有逐条核对这一个专业`,
  };
}
