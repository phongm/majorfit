import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogClass, CatalogEntry, CatalogField } from '../domain/types';
import { ALL_MAJORS } from '../data/majors';
import type { ResolvedMajor } from '../data/profiles/derive';
import { MAX_PICKS } from '../wishlist/store';
import { sourceOf } from './provenance';
import Shell from './Shell';

/** 有去向数据的方向个数。写出来而不是写死数字，免得扩了画像后这句话变成假话 */
const CAREER_COVERED = ALL_MAJORS.filter((m) => m.careerPaths.length > 0).length;

interface Props {
  selected: string[];
  onToggle: (code: string) => void;
  onBack: () => void;
  /** 决定按钮文案 —— 必须与 onBack 真正回到的界面一致，首屏不是答题页 */
  from?: 'intro' | 'results';
}

interface Bundle {
  fields: CatalogField[];
  classes: CatalogClass[];
  majors: CatalogEntry[];
  resolve: (code: string) => ResolvedMajor;
}

/**
 * 全部专业浏览页。
 *
 * 883 条目录与推断层用 dynamic import 拿，答题首屏不为它付流量。
 * 加载失败必须能重试：站点重新部署后，旧页面手里的 chunk 文件名已经失效。
 */
export default function Browse({ selected, onToggle, onBack, from = 'intro' }: Props) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  /** 883 行全表重渲染实测 1.35 秒（dev），所以过滤用的是防抖后的值，不是输入框本身的值 */
  const [q, setQ] = useState('');
  const [field, setField] = useState('all');
  const [hint, setHint] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  /** 换搜索词或换门类时把列表滚回顶部，否则人停在第 600 行看新结果的前几条 */
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [q, field]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([import('../data/catalog/2026'), import('../data/profiles/derive')])
      .then(([cat, der]) => {
        if (!alive) return;
        setBundle({
          fields: cat.CATALOG_FIELDS,
          classes: cat.CATALOG_CLASSES,
          majors: cat.CATALOG_MAJORS,
          resolve: der.resolveMajor,
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  /** 每行都 classes.find() 的话，883 行会在每次按键时重算几百次线性查找 */
  const index = useMemo(() => {
    if (!bundle) return null;
    const classByCode = new Map(bundle.classes.map((c) => [c.code, c]));
    const fieldByCode = new Map(bundle.fields.map((f) => [f.code, f]));
    const rowsByClass = new Map<string, CatalogEntry[]>();
    for (const m of bundle.majors) {
      const key = m.classCode ?? `${m.fieldCode}__unclassified`;
      const list = rowsByClass.get(key) ?? [];
      list.push(m);
      rowsByClass.set(key, list);
    }
    const titleOf = (classCode: string) =>
      classByCode.get(classCode)?.name ?? `${fieldByCode.get(classCode.slice(0, 2))?.name ?? ''}（目录未划类）`;
    return { rowsByClass, titleOf };
  }, [bundle]);

  const groups = useMemo(() => {
    if (!index) return [];
    const out: { classCode: string; title: string; list: CatalogEntry[] }[] = [];
    for (const [classCode, all] of index.rowsByClass) {
      if (field !== 'all' && classCode.slice(0, 2) !== field) continue;
      const title = index.titleOf(classCode);
      // 类名或代码命中就整类留下；否则只留命中名称/代码的专业
      const list =
        !q || title.includes(q) || classCode.includes(q)
          ? all
          : all.filter((m) => m.name.includes(q) || m.code.includes(q));
      if (list.length) out.push({ classCode, title, list });
    }
    return out.sort((a, b) => a.classCode.localeCompare(b.classCode));
  }, [index, q, field]);

  /**
   * 必须排在两个提前 return 之前：Hook 的调用顺序一旦随分支变化，
   * React 会直接报错并整页白屏（这个组件有 failed / loading 两条早退路径）。
   *
   * 稳定身份也很重要：selected / hint 若直接进 useCallback 依赖，
   * 勾一次选就换一次函数身份，883 行的 memo 全部失效。
   */
  const live = useRef({ selected, onToggle });
  live.current = { selected, onToggle };
  const toggle = useCallback((code: string) => {
    const { selected: cur, onToggle: commit } = live.current;
    if (!cur.includes(code) && cur.length >= MAX_PICKS) {
      setHint(`最多挑 ${MAX_PICKS} 个，先去掉一个再挑这个`);
      return;
    }
    setHint('');
    commit(code);
  }, []);

  if (failed) {
    return (
      <Shell
        top={
          <>
            <div className="brand">
              全部专业<span>没载入</span>
            </div>
            <button className="btn ghost" onClick={onBack}>
              返回
            </button>
          </>
        }
    >
        <div className="card">
          <p className="note" style={{ margin: 0 }}>
            专业目录这一块没能下载下来，多半是站点刚重新部署、你手上这个页面的旧引用已经失效。
            <button className="btn link" onClick={() => setAttempt((n) => n + 1)}>
              再试一次
            </button>
          </p>
        </div>
      </Shell>
    );
  }

  if (!bundle || !index) {
    return (
      <Shell
        top={
          <>
            <div className="brand">
              全部专业<span>正在载入</span>
            </div>
            <button className="btn ghost" onClick={onBack}>
              返回
            </button>
          </>
        }
    >
        <p className="note">正在载入专业目录……</p>
      </Shell>
    );
  }

  const picked = new Set(selected);
  const shown = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <Shell
      bodyRef={bodyRef}
      top={
        <>
          <div className="brand">
            全部专业<span>教育部 2026 目录，共 {bundle.majors.length} 个</span>
          </div>
          <button className="btn ghost" onClick={onBack}>
            返回
          </button>
        </>
      }
      foot={
        <div className="center">
          <button className="btn primary" onClick={onBack}>
            {from === 'results' ? '挑好了，回到结果' : '挑好了，回首页'}
          </button>
        </div>
      }
    >

      <div className="card tight">
        <p className="note" style={{ margin: 0 }}>
          挑几个你正在看的方向，结果页会把它们和你的作答放在一起比 ——
          <b> 挑了不会让它们排到前面</b>，这个系统的立场是兴趣只当门槛，不当加分。
        </p>
        <p className="note" style={{ margin: '8px 0 0' }}>
          {`去向（读完大概做什么、占不占正门）只给了人工核对过的 ${CAREER_COVERED} 个方向；其余方向只有推断出来的画像，没有这项数据，挑进清单后会直接说明。`}
        </p>
      </div>

      <div className="browse-tools">
        <label className="sr-only" htmlFor="major-search">
          搜索专业
        </label>
        <input
          id="major-search"
          className="browse-search"
          type="search"
          value={query}
          placeholder="名称、专业类或代码，比如 0809"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="group" aria-label="按学科门类过滤">
          <button
            className={`chip${field === 'all' ? ' on' : ''}`}
            aria-pressed={field === 'all'}
            onClick={() => setField('all')}
          >
            全部
          </button>
          {bundle.fields.map((f) => (
            <button
              key={f.code}
              className={`chip${field === f.code ? ' on' : ''}`}
              aria-pressed={field === f.code}
              onClick={() => setField(f.code)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <p className="note" role="status">
        列出 {shown} 个专业 · 已挑 {picked.size} / {MAX_PICKS}
        {hint ? ` —— ${hint}` : ''}
      </p>

      {q
        ? // 搜索时平铺：用 details 承载结果的话，清空搜索词会把用户手动折叠过的组一并弹开
          <div className="class flat">
            {groups.flatMap((g) =>
              g.list.map((m) => (
                <PickRow
                  key={m.code}
                  entry={m}
                  groupTitle={g.title}
                  on={picked.has(m.code)}
                  resolve={bundle.resolve}
                  onToggle={toggle}
                />
              )),
            )}
          </div>
        : groups.map((g) => (
            <details className="class" key={g.classCode}>
              <summary>
                {g.title}
                <span className="count">{g.list.length}</span>
              </summary>
              {g.list.map((m) => (
                <PickRow
                  key={m.code}
                  entry={m}
                  groupTitle=""
                  on={picked.has(m.code)}
                  resolve={bundle.resolve}
                  onToggle={toggle}
                />
              ))}
            </details>
          ))}

    </Shell>
  );
}

/** 平铺态要额外显示所属专业类，折叠态由分组标题代劳 */
const PickRow = memo(function PickRow({
  entry,
  groupTitle,
  on,
  resolve,
  onToggle,
}: {
  entry: CatalogEntry;
  groupTitle: string;
  on: boolean;
  resolve: (code: string) => ResolvedMajor;
  onToggle: (code: string) => void;
}) {
  const src = sourceOf(resolve(entry.code));
  return (
    <div className={`pick-row${on ? ' on' : ''}`}>
      <button className="pick-btn" onClick={() => onToggle(entry.code)} aria-pressed={on}>
        {on ? '已挑' : '挑它'}
      </button>
      <div className="pick-body">
        <div className="pick-name">
          {entry.name}
          <span className="pick-code">{entry.code}</span>
          {groupTitle && <span className="pick-class">{groupTitle}</span>}
        </div>
        <div className="pick-meta">
          <span className={`badge ${src.cls}`}>{src.label}</span>
          <span className="note">{src.note}</span>
          {entry.degreeNote && <span className="note">学位：{entry.degreeNote}</span>}
        </div>
      </div>
    </div>
  );
});
