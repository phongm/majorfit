import { useEffect, useRef, useState } from 'react';
import {
  FEEDBACK_REASONS,
  REASON_LABELS,
  type FeedbackReason,
  type Helpfulness,
} from '../analytics/events';
import { track } from '../analytics/client';

const DISMISS_KEY = 'majorfit.feedback.dismissed';

/**
 * 反馈浮层。
 *
 * 触发条件是「最后一张推荐卡真的进过视口」，用 IntersectionObserver 判断，
 * 不用定时器猜秒数：猜的秒数会骚扰快速划走的人，又打断慢慢看的人。
 *
 * 三条硬要求：可以为空提交、随时可关、关掉后不再弹。
 */
export default function FeedbackPrompt({ hasRecommendations = true }: { hasRecommendations?: boolean } = {}) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<'ask' | 'detail'>('ask');
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState('');
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (readStored(DISMISS_KEY)) return;
    const el = anchor.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // 零面积的目标元素算不出 intersectionRatio，用 threshold 0 配一个有高度的锚点。
      // 之前写 0.6 导致浮层永远不触发。
      { threshold: 0, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function dismiss() {
    writeStored(DISMISS_KEY, '1');
    setVisible(false);
  }

  function submit(helpful: Helpfulness) {
    track.feedback({
      helpful,
      reasons: reasons.length ? reasons : undefined,
      comment: comment.trim() ? comment.trim().slice(0, 500) : undefined,
    });
    dismiss();
  }

  if (!visible) return <div ref={anchor} aria-hidden style={{ height: 1 }} />;

  return (
    <div className="floater" role="dialog" aria-label="反馈">
      <div className="floater-head">
        <h3>
          {step === 'ask'
            ? hasRecommendations
              ? '这几个专业，你觉得合理吗？'
              : '这份结果没给出专业，你觉得是哪里卡住了？'
            : hasRecommendations
              ? '哪里不合理？'
              : '是哪里把你卡住了？'}
        </h3>
        <button className="close" onClick={dismiss} aria-label="关闭">
          ×
        </button>
      </div>

      {step === 'ask' ? (
        <>
          <div className="options">
            <button className="opt" onClick={() => submit('yes')}>
              <span className="dot" />
              <span className="opt-body">
                <span className="opt-label">{hasRecommendations ? '合理' : '知道哪里卡住了'}</span>
              </span>
            </button>
            {/* DEPLOY.md 说 helpfulRate 里 partial 按半分计 —— 那就必须有发 partial 的入口 */}
            <button className="opt" onClick={() => submit('partial')}>
              <span className="dot" />
              <span className="opt-body">
                <span className="opt-label">说不上</span>
                <span className="opt-sub">有点用，但没解决我的问题</span>
              </span>
            </button>
            <button className="opt" onClick={() => setStep('detail')}>
              <span className="dot" />
              <span className="opt-body">
                <span className="opt-label">{hasRecommendations ? '不太合理' : '还是不知道'}</span>
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="options">
            {(hasRecommendations
              ? FEEDBACK_REASONS
              : // 一个专业都没推出来时，「推荐的我没兴趣」「代价我不认同」是无意义选项
                FEEDBACK_REASONS.filter((r) => r !== 'recommended_uninteresting' && r !== 'costs_not_agreed')
            ).map((r) => {
              const picked = reasons.includes(r);
              return (
                <button
                  key={r}
                  className="opt"
                  role="checkbox"
                  aria-checked={picked}
                  onClick={() => setReasons(picked ? reasons.filter((x) => x !== r) : [...reasons, r])}
                >
                  <span className="dot sq" />
                  <span className="opt-body">
                    <span className="opt-label">{REASON_LABELS[r]}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={2}
            className="field"
            placeholder="具体说说是哪里不对（选填）。别写姓名、学校、考号。"
          />
          <div className="nav">
            <button className="btn ghost" onClick={() => setStep('ask')}>
              返回
            </button>
            <div className="nav-spacer" />
            {/* 允许空提交：愿意点一下的人比被逼着填完的人多，数据也更真实 */}
            <button className="btn primary" onClick={() => submit('no')}>
              提交
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function readStored(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* 隐私模式下存不住，最坏结果是下次还弹一次 */
  }
}
