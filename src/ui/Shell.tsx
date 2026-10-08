import { useEffect, useRef, type ReactNode, type Ref } from 'react';

interface Props {
  /** 固定头部条里的内容：品牌 + 动作按钮 */
  top: ReactNode;
  /** 固定脚部。不传就没有脚部这一条 */
  foot?: ReactNode;
  /** 中间滚动区，切题/换搜索词时要归零用 */
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * 三段式骨架：头部和脚部固定，只有中间滚动。
 *
 * 中间必须是**一个**可滚动元素，所以内容得包进 <main> —— 纯 CSS 没法让
 * 「header 和 footer 之间的那堆兄弟节点」共同成为一个滚动容器。
 * 顺带补上 banner / main / contentinfo 三个地标，读屏可以直接跳。
 */
export default function Shell({ top, foot, bodyRef, children }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = root.current;
    if (!vv || !el) return;
    // dvh 不随软键盘变化，iOS 上脚部会被键盘盖住、列表底部划不到。
    // 可视高度变了就把 --shell-h 钉成实际值，CSS 里的 100dvh 退化成兜底。
    const sync = () => el.style.setProperty('--shell-h', `${Math.round(vv.height)}px`);
    sync();
    vv.addEventListener('resize', sync);
    return () => vv.removeEventListener('resize', sync);
  }, []);

  return (
    <div className="shell" ref={root}>
      <header className="shell-top">
        <div className="top shell-line">{top}</div>
      </header>
      <div className="shell-body" ref={bodyRef}>
        <main className="wrap">{children}</main>
      </div>
      {foot && (
        <footer className="shell-foot">
          <div className="shell-line">{foot}</div>
        </footer>
      )}
    </div>
  );
}
