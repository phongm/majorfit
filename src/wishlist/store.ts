/**
 * 自选清单。
 *
 * 刻意与答题存档分开放，也**不写进 UserProfile**：
 * 系统的立场是「兴趣只当门槛，不当加分」，自选不能参与排序；
 * 它换来的是另一件有用的事 —— 在结果页和自己挑的专业面对面看代价。
 */
export const WISHLIST_KEY = 'majorfit.wishlist.v1';

/** 上限防止有人把整个门类勾进来，那样对比就没有意义了 */
export const MAX_PICKS = 12;

// 代码是否仍在目录里，交给拿着目录的界面层判（Browse 勾选、Picked 对照）。
// 这里不 import 目录：这个模块被首屏引用，静态依赖会把 883 条目录拖进答题首屏的 chunk。
// {6,7}：目录里 0502 外国语言文学类有 8 个七位代码（0502100T 起），漏了会把有效选择静默丢掉
const CODE_SHAPE = /^[0-9]{6,7}(TK|T|K)?$/;

/** 只校验形状：去重、去非法 id、限上限 */
export function pruneWishlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && CODE_SHAPE.test(v) && !seen.includes(v)) seen.push(v);
  }
  return seen.slice(0, MAX_PICKS);
}

export function loadWishlist(storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const raw = storage.getItem(WISHLIST_KEY);
    return raw ? pruneWishlist(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveWishlist(ids: string[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(WISHLIST_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式下写失败不阻塞使用 */
  }
}
