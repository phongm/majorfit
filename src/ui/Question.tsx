import { useRef, useState, type KeyboardEvent } from 'react';
import type { Item } from '../assessment/schema';
import type { Answers } from '../assessment/scoring';

interface Props {
  item: Item;
  index: number;
  total: number;
  answers: Answers;
  onChange: (itemId: string, value: Answers[string]) => void;
}

export default function Question({ item, index, total, answers, onChange }: Props) {
  const value = answers[item.id];
  const [note, setNote] = useState('');
  const promptId = `prompt-${item.id}`;
  const max = item.kind === 'multi' ? item.maxSelections : undefined;

  return (
    <div className="card" data-item={item.id}>
      <div className="qhead">
        <div className="qindex">
          {index + 1}/{total}
        </div>
        <div>
          <div className="qprompt" id={promptId}>
            {item.prompt}
          </div>
          <div className="qmeasuring">测量：{item.measuring}</div>
        </div>
      </div>

      {item.help && <div className="qhelp">{item.help}</div>}

      {item.kind === 'multi' ? (
        <div className="options" role="group" aria-labelledby={promptId}>
          {max && (
            <p className="note" role="status">
              最多选 {max} 项{Array.isArray(value) ? `，已选 ${value.length}` : ''}
              {note ? ` —— ${note}` : ''}
            </p>
          )}
          {item.options.map((o) => {
            const picked = Array.isArray(value) ? value.includes(o.id) : false;
            return (
              <button
                key={o.id}
                type="button"
                className="opt"
                role="checkbox"
                aria-checked={picked}
                onClick={() => {
                  const cur = Array.isArray(value) ? [...value] : [];
                  if (!picked && max && cur.length >= max) {
                    // 静默丢掉最早那个勾是最坏的一种「吞回答」：用户以为选了三个，实际只剩后两个
                    setNote(`已经选满 ${max} 项，先取消一个再选「${o.label}」`);
                    return;
                  }
                  setNote('');
                  onChange(item.id, picked ? cur.filter((x) => x !== o.id) : [...cur, o.id]);
                }}
              >
                <span className="dot sq" />
                <span className="opt-body">
                  <span className="opt-label">{o.label}</span>
                  {o.sub && <span className="opt-sub">{o.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <RadioGroup
          options={item.options}
          value={typeof value === 'string' ? value : undefined}
          onPick={(id) => onChange(item.id, id)}
          labelledBy={promptId}
        />
      )}
    </div>
  );
}

/**
 * 单选组只占**一个** Tab 停靠点，方向键在选项间移动并直接选中 —— 原生 radio 就是这个行为。
 * 之前每个选项都能 Tab 到，一门 13 个选项的题要按 13 次 Tab 才穿过去。
 */
function RadioGroup({
  options,
  value,
  onPick,
  labelledBy,
}: {
  options: { id: string; label: string; sub?: string }[];
  value: string | undefined;
  onPick: (id: string) => void;
  labelledBy: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((o) => o.id === value);
  // 没选过时停在第一项；选中后停靠点跟着走，Tab 回来能听见当前值
  const tabStop = checked >= 0 ? checked : 0;
  if (!options.length) return null;

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onPick(options[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="options" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className="opt"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={i === tabStop ? 0 : -1}
          onClick={() => onPick(o.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="dot" />
          <span className="opt-body">
            <span className="opt-label">{o.label}</span>
            {o.sub && <span className="opt-sub">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
