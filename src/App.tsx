import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ITEMS, pruneAnswers } from './assessment/items';
import { SECTION_META, type Item, type SectionId } from './assessment/schema';
import { assess, type Answers } from './assessment/scoring';
import { recommend } from './engine';
import { ALL_MAJORS } from './data/majors';
import { MAX_PICKS, loadWishlist, saveWishlist } from './wishlist/store';
import { track } from './analytics/client';
import Browse from './ui/Browse';
import Question from './ui/Question';
import Shell from './ui/Shell';
import Results from './ui/Results';

// 学制那题从滑块改成档位，旧的裸数字（如 6）不再是合法选项。
// 与其把它夹回范围（等于替用户承认他说过 6 年）或直接丢掉（等于对填过的人说「你没填」），
// 不如换 key 重开 —— 存档格式变了就换代，别假装读得懂旧数据。
const STORAGE_KEY = 'majorfit.answers.v2';

type View = 'intro' | 'quiz' | 'results' | 'browse';

// 约束题永远在最前：它们决定后面所有推荐是否成立。
// 段内顺序直接采用题库声明顺序 —— 那是人工定的、有意图的顺序。
const SECTION_RANK: Record<SectionId, number> = { facts: 0, evidence: 1, tolerance: 2, tradeoff: 3 };
const ORDERED = [...ITEMS].sort((a, b) => SECTION_RANK[a.section] - SECTION_RANK[b.section]);

/**
 * 整页只读一次存档。
 * 之前在两个 useState 初始化器里各调一次 load()，首帧的写入 effect 又可能在其间回写空值，
 * 导致 answers 有数据而 view 仍停在 intro —— 存档「存在但进不去」。
 */
const BOOT: Answers = load();

export default function App() {
  const [answers, setAnswers] = useState<Answers>(BOOT);
  const [view, setView] = useState<View>(() => (Object.keys(BOOT).length ? 'quiz' : 'intro'));
  const [cursor, setCursor] = useState(0);
  const [wishlist, setWishlist] = useState<string[]>(() => loadWishlist());
  const [browseBack, setBrowseBack] = useState<'intro' | 'results'>('intro');
  /** 中间滚动区归 Shell 持有；切题要把视口拉回题目顶部，而不是停在上一题的底部 */
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [cursor, view]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      /* 隐私模式下写失败不影响使用 */
    }
  }, [answers]);

  const setAnswer = useCallback((id: string, value: Answers[string]) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  // cursor 始终被 clamp 在 [0, len-1]，ORDERED 由题库保证非空
  const index = Math.max(0, Math.min(cursor, ORDERED.length - 1));
  const item = ORDERED[index] as Item;
  const answeredCount = ORDERED.filter((i) => !isEmpty(answers[i.id])).length;
  const isAnswered = !isEmpty(answers[item.id]);

  const assessment = useMemo(() => assess(answers), [answers]);
  const result = useMemo(
    () => (view === 'results' ? recommend(assessment, { majors: ALL_MAJORS, topN: 5 }) : null),
    [view, assessment],
  );

  const togglePick = useCallback((code: string) => {
    setWishlist((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : prev.length >= MAX_PICKS ? prev : [...prev, code],
    );
  }, []);

  useEffect(() => saveWishlist(wishlist), [wishlist]);

  const openBrowse = (from: 'intro' | 'results') => {
    setBrowseBack(from);
    setView('browse');
  };

  /**
   * 自选清单在离开浏览页时报一次，装目录代码。
   * 挂在 complete 上没用：真实路径是先看结果、再去挑、回来对比，
   * 那时 complete 早就发完了，picked 永远是空数组。
   */
  const lastSentPicks = useRef('');
  /** 只在清单真的变过时上报，服务端按会话取最后一次 */
  const sendPicks = useCallback(() => {
    const signature = wishlist.join(',');
    if (signature === lastSentPicks.current) return;
    lastSentPicks.current = signature;
    track.picks({ picked: wishlist });
  }, [wishlist]);

  const closeBrowse = () => {
    setView(browseBack);
    sendPicks();
  };

  /** 在浏览页直接关标签或按浏览器返回时，这条路径上没有 closeBrowse，得补一次 */
  useEffect(() => {
    if (view !== 'browse') return;
    window.addEventListener('pagehide', sendPicks);
    return () => window.removeEventListener('pagehide', sendPicks);
  }, [view, sendPicks]);

  // 访问：每次进入页面记一次，服务端按会话去重
  useEffect(() => {
    track.visit(ORDERED.length);
  }, []);

  // 开始：第一次真正作答时记一次。会话号是每次打开页面新随机数，
  // 所以回访的这次会话也必须有自己的 start，否则它只会被算成「打开就走」的人
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !answeredCount) return;
    startedRef.current = true;
    track.start();
  }, [answeredCount]);

  // 完单：按「答了几题 + 置信度 + 可行集大小 + 推荐出哪几个」签名去重，覆盖上报的每个可变字段。
  // 用一次性布尔的话，「继续补答 → 改答案 → 再看结果」这条路上就不会再上报，
  // 落库的 recommended 会永远停在补答前那一版，而用户接着写的反馈针对的是新 Top5
  const lastCompleteSig = useRef('');
  useEffect(() => {
    // 一题没答就点「先看结果」不算完单：报出去会把完单率和平均答题数都拉歪
    if (!result || !answeredCount) return;
    // 签名必须覆盖上报里的每一个字段：只比「题数 + Top5」的话，
    // 改学制档位这类改动会让 feasible 与置信度变了样，却仍被判成「已经报过」
    const signature = [
      answeredCount,
      result.confidence.level,
      result.alternatesConsidered,
      result.recommendations.map((r) => r.major.id).join(','),
    ].join('|');
    if (signature === lastCompleteSig.current) return;
    lastCompleteSig.current = signature;
    track.complete({
      answered: answeredCount,
      total: ORDERED.length,
      confidence: result.confidence.level,
      recommended: result.recommendations.map((r) => r.major.id),
      feasible: result.alternatesConsidered,
    });
  }, [result, answeredCount]);

  if (view === 'intro') {
    return (
      <Shell
        top={<div className="brand">专业适配</div>}
        foot={
          <div className="center">
            <button
              className="btn primary"
              onClick={() => {
                setView('quiz');
                setCursor(0);
              }}
            >
              开始
            </button>
            <p className="note" style={{ margin: '8px 0 0' }}>
              <button className="btn link" onClick={() => openBrowse('intro')}>
                先浏览全部专业方向
              </button>
            </p>
          </div>
        }
      >
        <h1>不看你想成为谁，看你受得了哪种辛苦</h1>
        <div className="card">
          <p className="lede">
            {`多数专业测评的逻辑是「你喜欢与人打交道，所以推荐社会学」。这份系统不这么算。它按三条规则工作：`}
          </p>
          <ol className="list">
            <li>
              {`先问硬事实。选科组合、体检色觉、能接受的学制决定你能报什么。跳过这一步，推荐出来的专业你可能连报名资格都没有。`}
              {`学费这一维本库只对艺术类专业核过档位，而艺术类走统考通道、不在推荐范围内，所以它目前用于提醒而不是用来排除 —— 报民办或中外合作要自己按院校章程核。`}
            </li>
            <li>{`问做过什么，不问觉得自己是什么。选项都是「有没有连续坚持过三个月」这类能拿出证据的事实。`}</li>
            <li>
              {`兴趣几乎不加分，代价才是主变量。算下来兴趣契合最多给 8 分，而课程负载超出你能忍的程度最多扣 45 分。`}
              {`决定排序的是你受不受得了它的苦，不是你觉得它酷不酷。兴趣很高但耐受不够的专业会被压下去，并告诉你为什么。`}
            </li>
          </ol>
          <p className="note" style={{ marginTop: 14 }}>
            {`${ORDERED.length} 题，约 12 分钟。中途关掉会保留进度。`}
          </p>
        </div>

        <div className="card tight">
          <h3>关于你的数据</h3>
          <p className="note" style={{ margin: 0 }}>
            {`你的答题内容只存在这台设备的浏览器里，不会上传。服务器只收到几个数字：有人打开了、有人开始答了、有人答完了、答了几题、这份结果的置信度等级、推荐了哪几个专业、你挑进自选清单的是哪几个专业、以及你愿不愿意给一句反馈。`}
            {`每次打开页面会生成一个随机会话号，用来把这几步串成一条漏斗，关掉页面即失效，不跨会话追踪。没有姓名、学校、分数，也没有任何一题的选择。`}
            {`两句实话：可行专业的`}
            <b>数量</b>
            {`会被一起上报，它间接反映了几道约束题的答案；而反馈里你自愿写的那段文字会`}
            <b>原样存到服务器</b>
            {`，所以别在里面写自己的信息。`}
          </p>
        </div>

        <div className="card tight">
          <p className="note" style={{ margin: 0 }}>
            这里推荐的是专业方向，不是志愿表。院校、分数位次和省份录取规则不在处理范围内。
          </p>
        </div>

      </Shell>
    );
  }

  if (view === 'results' && result) {
    return (
      <Results
          result={result}
          profile={assessment.profile}
          wishlist={wishlist}
          onBrowse={() => openBrowse('results')}
          onContinue={() => setView('quiz')}
          onRestart={() => {
            // 「重做」必须清空存档，否则回到 intro 后点开始会直接恢复旧答案
            lastCompleteSig.current = '';
            setAnswers({});
            setCursor(0);
            setView('intro');
          }}
        />
    );
  }

  if (view === 'browse') {
    return (
      <Browse
        selected={wishlist}
        onToggle={togglePick}
        onBack={closeBrowse}
        from={browseBack}
      />
    );
  }

  return (
    <Shell
      bodyRef={bodyRef}
      top={
        <>
          <div className="brand">
            专业适配<span>{SECTION_META[item.section].title}</span>
          </div>
          <button className="btn ghost" onClick={() => setView('results')}>
            先看结果
          </button>
        </>
      }
      foot={
        <>
          {/* 常驻占位、只切 visibility：条件渲染会让脚部瞬间长高 26px，
              内容区跟着变矮，正滚到底的人看到画面跳一下 */}
          <p
            className="note"
            style={{
              margin: '0 0 6px',
              textAlign: 'right',
              visibility: isAnswered && cursor < ORDERED.length - 1 ? 'visible' : 'hidden',
            }}
          >
            已记录，可随时改
          </p>
          <div className="nav">
            <button className="btn" disabled={cursor === 0} onClick={() => setCursor((c) => c - 1)}>
              上一题
            </button>
            <button className="btn ghost" onClick={() => setCursor((c) => Math.min(c + 1, ORDERED.length - 1))}>
              跳过
            </button>
            <div className="nav-spacer" />
            {cursor === ORDERED.length - 1 ? (
              <button className="btn primary" onClick={() => setView('results')}>
                生成推荐
              </button>
            ) : (
              <button
                className="btn primary"
                disabled={!isAnswered}
                onClick={() => setCursor((c) => Math.min(c + 1, ORDERED.length - 1))}
              >
                下一题
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${(answeredCount / ORDERED.length) * 100}%` }} />
        </div>
        <div className="progress-meta">
          <span>已答 {answeredCount} / {ORDERED.length}</span>
          <span>{SECTION_META[item.section].blurb}</span>
        </div>
      </div>

      <Question
        key={item.id}
        item={item}
        index={cursor}
        total={ORDERED.length}
        answers={answers}
        onChange={setAnswer}
      />

    </Shell>
  );
}

function isEmpty(v: unknown) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function load(): Answers {
  try {
    // 换代后旧 key 不会再被读，但也没人删；留着就是浏览器里一份永远用不到的答题原文
    localStorage.removeItem('majorfit.answers.v1');
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? pruneAnswers(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}
