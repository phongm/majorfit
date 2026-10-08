import { describe, expect, it } from 'vitest';
import { MAX_PICKS, pruneWishlist } from '../src/wishlist/store';

/**
 * 自选清单的存档校验。
 * 这一层不 import 专业目录（否则 883 条会被拖进首屏 chunk），
 * 所以代码形状的校验规则必须自己写对 —— 目录里 0502 类有 8 个七位代码，
 * 早前用「恰好 6 位」的规则会把 0502100T 这类有效勾选静默丢掉。
 */
describe('自选清单校验', () => {
  it('接受 6 位与 7 位目录代码，含 T/K 后缀', () => {
    expect(pruneWishlist(['080901', '100201K', '0502100T', '0502107TK'])).toEqual([
      '080901',
      '100201K',
      '0502100T',
      '0502107TK',
    ]);
  });

  it('丢弃形状不对的值，且去重保序', () => {
    expect(pruneWishlist(['080901', '080901', '中文', '08090', '080901TKK', '', 7, null])).toEqual(['080901']);
  });

  it('非数组一律当空', () => {
    expect(pruneWishlist('080901')).toEqual([]);
    expect(pruneWishlist({ 0: '080901' })).toEqual([]);
  });

  it('超过上限截断，避免勾进整个门类让对比失去意义', () => {
    const many = Array.from({ length: 30 }, (_, i) => `08${String(i).padStart(4, '0')}`);
    expect(pruneWishlist(many).length).toBe(MAX_PICKS);
  });
});
