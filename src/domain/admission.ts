import type { FieldCategory } from './types';

/**
 * 招录通道：这个方向能不能通过普通高考统一招生报进去。
 *
 * 单独成一个模块，是因为人工画像层和推断层必须用同一条规则判断 ——
 * 不能一个看门类、另一个靠样本传染，否则同一件事在两条路径上结论相反，
 * 而且「通道走不进去」会被误当成「我们的数据不够」处理掉。
 */
export function channelBlock(category: FieldCategory, subCategory: string): { reason: string } | null {
  if (category === 'arts') {
    return { reason: '要参加艺术类省级统考或校考，不在本系统的覆盖范围内' };
  }
  if (subCategory === '体育学类') {
    return { reason: '要参加体育单招或体育统考，不在本系统的覆盖范围内' };
  }
  return null;
}
