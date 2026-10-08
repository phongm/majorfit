import { lazy, Suspense } from 'react';
import {
  CAREER_BARRIER_LABEL,
  CAREER_FIT_LABEL,
  FIELD_CATEGORY_LABELS,
  type RecommendationResult,
  type UserProfile,
} from '../domain/types';
import { ALL_MAJORS, MAJORS_BY_ID } from '../data/majors';
import { uncheckedHealthDims } from './provenance';
import { GLOSSARY } from './glossary';
import FeedbackPrompt from './Feedback';
import Shell from './Shell';
import CareerPaths from './CareerPaths';
// 目录 + 推断层只服务于「我自己挑的这几个」，不该让答题首屏为它付流量
const PickedMajors = lazy(() => import('./Picked'));

const LEVEL_BADGE: Record<string, string> = {
  high: 'ok',
  medium: 'warn',
  low: 'bad',
};

const LEVEL_TEXT: Record<string, string> = {
  high: '置信度高',
  medium: '置信度中',
  low: '置信度低',
};

/** 空可行集时要说清是谁挡的，而不是猜用户填错了 */
const REASON_LABELS: Record<string, string> = {
  subject: '选科组合不符',
  health: '体检限制',
  years: '学制超出你能接受的年限',
  tuition: '学费档位',
  postgrad: '不读研就无法兑现',
  category: '你明确排除的门类',
};

const TREND_TEXT: Record<string, string> = {
  rising: '需求上升',
  stable: '需求平稳',
  cooling: '需求降温',
  contracting: '行业收缩',
};

interface Props {
  result: RecommendationResult;
  profile: UserProfile;
  wishlist: string[];
  onBrowse: () => void;
  /** 带着已答的内容回答题页继续补答，不清存档 */
  onContinue: () => void;
  onRestart: () => void;
}

export default function Results({ result, profile, wishlist, onBrowse, onContinue, onRestart }: Props) {
  const { confidence, recommendations } = result;
  /**
   * 分数掉到第一名之后一大截的，不是「推荐」，是「勉强没被排除」。
   * 五六个并列的卡片会让人以为它们的可信度相同。
   */
  const best = recommendations[0]?.score ?? 0;
  /** 通道受限的画像（艺考、体育）从不参与排序，所以不能把它们算进「参与排序的有多少个」 */
  const POOL = ALL_MAJORS.filter((m) => m.recommendable).length;
  const weakFrom = recommendations.findIndex((r) => best - r.score > 15);
  /** 卡里只要有一条侧门/顺路，图例就值得占一行；全是正门时它就是 78 个字的噪声。自选区也用同一套标记，所以挑过专业就得显示 */
  const anyOffDoor = recommendations.some((r) => r.major.careerPaths.some((p) => p.fit !== 'main')) || wishlist.length > 0;

  return (
    <Shell
      top={
        <>
          <div className="brand">
            专业适配<span>结果</span>
          </div>
          <div className="top-actions">
            <button className="btn ghost" onClick={onContinue}>
              继续补答
            </button>
            <button className="btn ghost" onClick={onBrowse}>
              挑专业{wishlist.length ? `（已挑 ${wishlist.length}）` : ''}
            </button>
            <button className="btn ghost" onClick={onRestart}>
              重做
            </button>
          </div>
        </>
      }
    >
      <h1>
        {recommendations.length
          ? `相对更匹配的 ${recommendations.length} 个专业`
          : '没有专业能通过你的约束条件'}
      </h1>

      <div className="card tight">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${LEVEL_BADGE[confidence.level]}`}>{LEVEL_TEXT[confidence.level]}</span>
          <span className="note">
            在 {result.alternatesConsidered} 个可通过你硬性约束的专业里排序（本库可推荐 {POOL} 个）
          </span>
          {result.feasibleSetTooSmall && <span className="badge warn">可行集偏小</span>}
        </div>
        <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
          {confidence.note}
        </p>
        {anyOffDoor && (
          <p className="note" style={{ margin: '10px 0 0' }}>
            下面每张卡的「读完大概做什么」都标了这条路占不占正门。正门＝这条路的主流入口就是它；侧门＝进得去，但同一条路上更多人是从别的专业进来的；顺路＝岗位真的在，但和本专业的课程关系弱，实质是转行。三档说的是入口，不是岗位好坏。
          </p>
        )}
      </div>

      {(confidence.contradictions.length > 0 || confidence.gaps.length > 0 || result.coverageNotes.length > 0) && (
        <div className="card">
          <h3>这份结果的不确定来自哪里</h3>
          {result.coverageNotes.length > 0 && (
            <>
              <p className="note" style={{ marginBottom: 6 }}>本库的数据缺口（不是你没答，是我们没录）：</p>
              <ul className="list cost">
                {result.coverageNotes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {confidence.contradictions.length > 0 && (
            <>
              <p className="note" style={{ marginBottom: 6 }}>回答之间有冲突（点右上角「继续补答」改）：</p>
              <ul className="list risk">
                {confidence.contradictions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {confidence.gaps.length > 0 && (
            <>
              <p className="note" style={{ margin: '12px 0 6px' }}>信息缺口（建议补答后再看）：</p>
              <ul className="list cost">
                {confidence.gaps.slice(0, 8).map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              {confidence.gaps.length > 8 && <li>还有 {confidence.gaps.length - 8} 条没列出来</li>}
              </ul>
            </>
          )}
        </div>
      )}

      {result.excludedButRelevant.length > 0 && (
        <div className="card">
          <h3>你兴趣最匹配、却被条件挡掉的方向</h3>
          <ul className="list">
            {result.excludedButRelevant.slice(0, 6).map((e) => (
              <li key={e.majorId}>
                <strong>{MAJORS_BY_ID.get(e.majorId)?.name}</strong> · {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.map((r) => (
        <RecCard key={r.major.id} r={r} weak={weakFrom > 0 && r.rank > weakFrom} best={best} />
      ))}

      {!recommendations.length && (
        <div className="card">
          <p style={{ marginBottom: 0 }}>
            {(() => {
              const byUser = result.excluded.filter(
                (e) => e.reasonCode !== 'channel' && e.reasonCode !== 'no_profile',
              );
              if (!byUser.length) {
                return '这次一个都没排出来，不是因为你的条件 —— 是当前专业库里的方向都不在系统可推荐的范围内（招录通道受限或只有推断值）。';
              }
              // 直说「选科或学制填错」是猜的：真正挡人的常常是用户自己排除的门类
              const count = new Map<string, number>();
              for (const e of byUser) count.set(e.reasonCode, (count.get(e.reasonCode) ?? 0) + 1);
              const [topCode, topCount] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]!;
              const rest = byUser.length - topCount;
              // 最高频不等于唯一原因：说「改这一项就行」是过承诺
              return `你的条件把库里剩下的 ${byUser.length} 个专业全部排除了，最多的一类原因是「${REASON_LABELS[topCode] ?? topCode}」（${topCount} 个）${
                rest ? `，另有 ${rest} 个是别的原因挡的，得逐项看` : ''
              }。点右上角「继续补答」回来改，不用重做、不会丢已答的内容。`;
            })()}
          </p>
        </div>
      )}

      {/* 看完推荐才浮出，锚点必须紧跟在推荐列表后面；
          但 0 推荐时解释卡要在它之前，否则浮层盖在「为什么一个都没有」上面 */}
      <FeedbackPrompt hasRecommendations={recommendations.length > 0} />

      {wishlist.length > 0 && (
        <Suspense fallback={<p className="note">正在给你挑的专业算对照……</p>}>
          <PickedMajors
            codes={wishlist}
            profile={profile}
            recommendations={recommendations}
            onBrowse={onBrowse}
          />
        </Suspense>
      )}

      <div className="card">
        <h3>怎么用这份结果</h3>
        <ol className="list">
          <li>去目标院校官网下载该专业的<b>培养方案</b>，对照这里列的核心课程看一遍。</li>
          <li>最终填报前，用省招办的官方目录核对选科要求与体检限制。这一步本系统不代替你。</li>
        </ol>
        <p className="note" style={{ marginTop: 14 }}>
          专业数据为人工整理的判断值，含未核对项（每张卡片底部标注）。收缩类专业的行情请以近一年的招聘信息为准。
        </p>
      </div>

      <details className="card" style={{ padding: 0 }}>
        <summary>专业文案里会出现的英文缩写是什么意思</summary>
        <div className="inner">
          <dl className="kv">
            {Object.entries(GLOSSARY)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([term, text]) => (
                <div key={term} style={{ display: 'contents' }}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
          </dl>
        </div>
      </details>
      {/* 反馈浮层 fixed 在视口底部，给它让出一条，否则滚到底也划不过去最后几行字 */}
      <div className="floater-space" aria-hidden="true" />
    </Shell>
  );
}

function RecCard({ r, weak, best }: { r: import('../domain/types').Recommendation; weak: boolean; best: number }) {
  const m = r.major;
  return (
    <div className="card">
      <div className="rec-head">
        <div>
          <div className="rec-rank">
            第 {r.rank} 位{weak && <span className="badge warn" style={{ marginLeft: 8 }}>勉强可行，不是推荐</span>}
          </div>
          <div className="rec-name">{m.name}</div>
          <div className="rec-meta">
            {FIELD_CATEGORY_LABELS[m.category]} · {m.subCategory} · {m.degreeYears} 年 · {m.degreeName}
          </div>
        </div>
        <div className="score-wrap">
          <div className="score-num">{Math.round(r.score)}</div>
          <div className="score-bar">
            <i style={{ width: `${Math.round((r.score / Math.max(best, 1)) * 100)}%` }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className={`badge ${m.marketTrend === 'contracting' || m.marketTrend === 'cooling' ? 'warn' : 'ok'}`}>
          {TREND_TEXT[m.marketTrend]}
        </span>
        <span className="badge">本科直接就业兑现 {Math.round(m.undergradJobFit * 100)}%</span>
        <span className="badge">读研才能兑现 {Math.round(m.postgradNecessity * 100)}%</span>
        <span className="badge">考公对口 {Math.round(m.civilServiceFit * 100)}%</span>
        <span className="badge">约 {m.timeToStableIncomeYears} 年开始稳定收入</span>
      </div>

      {r.matchedPoints.length > 0 && (
        <div className="block match">
          <h3>匹配在哪</h3>
          <ul className="list">
            {r.matchedPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="block cost">
        <h3>真实代价</h3>
        <ul className="list cost">
          {r.costs.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      {m.careerPaths.length > 0 && (
        <div className="block">
          <h3>读完大概做什么</h3>
          <CareerPaths paths={m.careerPaths} withBarrier where="下方「课程链、职业路径与数据出处」" />
        </div>
      )}

      <div className="block">
        <h3>要选它，你得接受</h3>
        <ul className="list">
          {r.conditionsToAccept.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="block risk">
        <h3>入学后如果出现这些信号，说明选错了</h3>
        <ul className="list">
          {r.disconfirmSignals.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      {m.clarification && (
        <div className="tagline">
          <b>容易搞错的地方：</b>
          {m.clarification}
        </div>
      )}

      <details>
        <summary>课程链、职业路径与数据出处</summary>
        <div className="inner">
          <dl className="kv">
            <dt>核心课</dt>
            <dd>{m.coreCourses.join('；')}</dd>
            <dt>最劝退</dt>
            <dd>{m.gatekeeperCourses.join('、')}</dd>
            <dt>典型去向</dt>
            <dd>
              <ul className="list" style={{ margin: 0 }}>
                {m.careerPaths.map((p) => (
                  <li key={p.name}>
                    {p.name}
                    ［{CAREER_FIT_LABEL[p.fit]}］（{CAREER_BARRIER_LABEL[p.entryBarrier]}）
                    {p.note ? ` — ${p.note}` : ''}
                  </li>
                ))}
              </ul>
            </dd>
            {m.commonlyConfusedWith.length > 0 && (
              <>
                <dt>别混淆</dt>
                <dd>{m.commonlyConfusedWith.join('、')}</dd>
              </>
            )}
            <dt>适合谁</dt>
            <dd>{m.idealFitNote}</dd>
            <dt>谁会很苦</dt>
            <dd>{m.poorFitNote}</dd>
          </dl>
          <p className="quality" style={{ marginBottom: 0 }}>
            数据核对状态：
            {(() => {
              const dims = uncheckedHealthDims(m.healthRestrictions);
              const pending = [
                ...(m.quality.verified ? [] : [`待人工核对 ${m.quality.todo?.length ?? 0} 项`]),
                ...(dims.length ? [`${dims.join('、')}未核对`] : []),
              ].join('，');
              return pending
                ? `${pending}（${m.quality.lastReviewed} 录入）${m.quality.todo?.length ? `：${m.quality.todo.join('；')}` : ''}`
                : `已人工核对（${m.quality.lastReviewed}）`;
            })()}
          </p>
        </div>
      </details>
    </div>
  );
}

