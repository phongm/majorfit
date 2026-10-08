import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assess, type Answers, type AnswerValue } from '../src/assessment/scoring';
import { ITEMS_BY_ID } from '../src/assessment/items';
import Question from '../src/ui/Question';
import { recommend } from '../src/engine';
import { ALL_MAJORS, MAJORS_BY_ID } from '../src/data/majors';
import { CATALOG_MAJORS } from '../src/data/catalog/2026';
import { resolveMajor, type ResolvedMajor } from '../src/data/profiles/derive';
import PickedMajors from '../src/ui/Picked';
import Results from '../src/ui/Results';
import { sourceOf, uncheckedHealthDims } from '../src/ui/provenance';
import { makeAnswers, neutralAnswers } from './helpers';

/**
 * 自选对照区的渲染门。
 * 这个组件同时踩在目录层、推断层和引擎上，最容易出「数字都对但话说错了」的问题：
 * 比如把推断值写成核对值，或者把「没资格推荐」讲成「你条件不够」。
 */
function render(codes: string[], overrides: [string, AnswerValue][] = []) {
  const a = assess(neutralAnswers(overrides));
  const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });
  const html = renderToStaticMarkup(
    <PickedMajors
      codes={codes}
      profile={a.profile}
      recommendations={result.recommendations}
      onBrowse={() => undefined}
    />,
  );
  return { html, result };
}

describe('自选对照区', () => {
  it('已入选的自选专业直接报出排名，不再重复打分', () => {
    const top = recommend(assess(neutralAnswers()), { majors: ALL_MAJORS, topN: 5 }).recommendations[0];
    const { html } = render([top!.major.id]);
    expect(html).toContain('你自己挑的 1 个专业');
    expect(html).toContain(`推荐第 ${top!.rank} 位`);
    // 当前库里的手核条目都还有未核对维度，所以只会亮「已录入，待复核」；
    // 「已逐条核对」那一档由下面的单测专门钉住，不让它变成永不相交的或关系
    expect(html).toContain('已录入，待复核');
  });

  it('能报但没进推荐时，给分数和具体代价，而不是空泛评价', () => {
    const { result } = render([]);
    const recIds = new Set(result.recommendations.map((r) => r.major.id));
    const pick = ALL_MAJORS.find((m) => m.recommendable && !m.channelBlocked && !recIds.has(m.id));
    expect(pick, '应存在一个可行但没进 Top5 的已核对专业').toBeDefined();
    const { html } = render([pick!.id]);
    expect(html).toContain('按你现在填的条件能报，评分');
    expect(html).toContain('代价');
  });

  it('被硬约束挡掉时说清是哪一条，且不与「没资格推荐」混为一谈', () => {
    // 只选历史 → 需要物理的计算机类应被选科规则挡掉
    const { html } = render(['080903'], [['f_subjects', ['history']]]);
    expect(html).toContain('被条件挡掉');
    expect(html).toMatch(/首选科目/);
    expect(html).toContain('按专业类推断');
  });

  it('交叉学科门类没有可比样本，明确说给不出对比', () => {
    const { html } = render(['140012TK']);
    expect(html).toContain('给不出负载对比');
    expect(html).toContain('暂无可比数据');
    // 说明行和来源行各说一次同一件事，读起来像坏了
    expect(html.match(/给不出负载对比/g)?.length, html).toBe(1);
  });

  it('挑了艺考通道的专业时，说清这条路走不进去，而不是「能报，评分 X」', () => {
    const arts = ALL_MAJORS.find((m) => m.category === 'arts')!;
    const { html } = render([arts.id]);
    expect(html).toContain('被条件挡掉');
    expect(html).toContain('统考');
    expect(html).not.toContain('按你的条件能报');
  });

  it('目录里还没画像的艺术类同样被通道闸挡住，不因推断层而绕过', () => {
    // 手核艺术类之外的 64 条艺术学专业走的是推断画像，早期版本把 recommendable 一刀切抬掉，
    // 会让「舞蹈表演」这类方向显示成「按你的条件能报」
    const derivedArts = CATALOG_MAJORS.find((e) => e.fieldCode === '13' && !MAJORS_BY_ID.has(e.code));
    expect(derivedArts, '目录里应有尚未录画像的艺术类专业').toBeDefined();
    const { html } = render([derivedArts!.code]);
    expect(html).toContain('被条件挡掉');
    expect(html).toContain('统考');
  });

  it('口径没核对的可行项必须把「没核对」说出来，不能只给一句「能报」', () => {
    // 单样本类目的推断项拿不到选科口径，是最常见的一种「本库没核对」
    const target = CATALOG_MAJORS.map((e) => resolveMajor(e.code))
      .filter((r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived')
      .find((r) => !r.major.subjectRequirementsKnown);
    expect(target, '应该存在口径未核对的推断项').toBeDefined();
    const { html } = render([target!.major.id]);
    expect(html).toContain('你自己挑的 1 个专业');
    expect(html).toContain('本库没核对');
    expect(html).toContain('能报不等于确定能报');
  });

  it('条件没答完时，对照区要说明「能报」只是按已答部分判的', () => {
    const a = assess(makeAnswers([['f_subjects', ['physics']]]));
    const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });
    const html = renderToStaticMarkup(
      <PickedMajors
        codes={['080901']}
        profile={a.profile}
        recommendations={result.recommendations}
        onBrowse={() => undefined}
      />,
    );
    expect(html).toMatch(/还有 \d+ 项硬条件没说过/);
  });

  it('目录里已不存在的旧选择会被列出并说明，不会悄悄少一行', () => {
    const { html } = render(['080901', '999999']);
    expect(html).toContain('已忽略 1 个不在当前专业目录里的旧选择');
    expect(html).toContain('999999');
  });

  it('推断画像的分数必须带着「没核对」字样出现，不许伪装成核对过的结论', () => {
    const { html } = render(['080903']);
    expect(html).toContain('没有逐条核对');
    expect(html).not.toMatch(/已逐条核对|已录入，待复核/);
  });

  it('三区之外没有第四种状态：任何有效代码都要落进某一类', () => {
    const codes = ['080901', '080903', '140012TK'];
    const { html } = render(codes);
    expect((html.match(/class="picked-row /g) ?? []).length).toBe(codes.length);
  });
});

describe('来源徽章的分档', () => {
  const base = ALL_MAJORS[0]!;
  const checkedAll = {
    ...base,
    quality: { verified: true, lastReviewed: '2026-10-02', confidence: 'high' as const, todo: [] },
    healthRestrictions: { colorWeak: false, colorBlind: false, poorVision: false },
  };

  it('三个体检维度都写过、字段也核对过，才允许说「已逐条核对」', () => {
    const src = sourceOf({ kind: 'hand_verified', major: checkedAll });
    expect(src.label).toBe('已逐条核对');
    expect(uncheckedHealthDims(checkedAll.healthRestrictions)).toEqual([]);
  });

  it('verified 但体检维度缺键时，仍要说「未核对」，不许发绿标', () => {
    const partial = sourceOf({ kind: 'hand_verified', major: { ...base, quality: checkedAll.quality } });
    expect(partial.label).toBe('已录入，待复核');
    expect(partial.note).toContain('未核对');
  });

  it('没有待复核项时，来源句不许留一个挂空的逗号', () => {
    const clean = sourceOf({
      kind: 'hand_verified',
      major: {
        ...base,
        quality: { verified: false, lastReviewed: '2026-10-02', confidence: 'low' as const, todo: [] },
        healthRestrictions: { colorWeak: false, colorBlind: false, poorVision: false },
      },
    });
    expect(clean.note).toBe('人工录入（2026-10-02）');
  });

  it('推断项不许借用任何「核对」措辞', () => {
    const derived = CATALOG_MAJORS.map((e) => resolveMajor(e.code)).find(
      (r): r is Extract<ResolvedMajor, { kind: 'derived' }> => r?.kind === 'derived',
    );
    expect(derived, '应存在推断项').toBeDefined();
    const src = sourceOf(derived!);
    expect(src.note).toContain('没有逐条核对');
    expect(src.label).toMatch(/推断/);
  });
});

/**
 * 键盘可达性。单选组按原生 radio 的规矩只留一个 Tab 停靠点，
 * 否则一道 13 个选项的题要把 Tab 按 13 次才穿得过去。
 */
describe('单选组的键盘行为', () => {
  function renderYears(answers: Answers) {
    const item = ITEMS_BY_ID.get('f_years');
    if (item === undefined) throw new Error('f_years 不在了');
    return renderToStaticMarkup(
      <Question item={item} index={0} total={39} answers={answers} onChange={() => undefined} />,
    );
  }

  it('整组只有一个 tabIndex=0，其余是 -1', () => {
    const html = renderYears({ f_years: 'y5' });
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(3);
  });

  it('停靠点跟着被选中的那一项走，没选过时落在第一项', () => {
    const stopOf = (html: string) => html.split('<button').findIndex((b) => b.includes('tabindex="0"'));
    expect(stopOf(renderYears({ f_years: 'y5' })), 'y5 是第二个选项').toBe(2);
    expect(stopOf(renderYears({ f_years: 'y8' })), 'y8 是第三个选项').toBe(3);
    expect(stopOf(renderYears({})), '一题都没答时停在第一项').toBe(1);
  });
});

describe('结果页骨架', () => {
  const a = assess(neutralAnswers());
  const result = recommend(a, { majors: ALL_MAJORS, topN: 5 });

  const renderResults = (wishlist: string[]) =>
    renderToStaticMarkup(
      <Results
        result={result}
        profile={a.profile}
        wishlist={wishlist}
        onBrowse={() => undefined}
        onContinue={() => undefined}
        onRestart={() => undefined}
      />,
    );

  it('界面上说「去补答」，就必须真有一个不清存档的入口', () => {
    const html = renderResults([]);
    // 头部按钮单独渲染这四个字，所以只断 toContain 是恒真的：
    // 要断的是「正文里也真的指向它」，出现次数必须 ≥2
    expect((html.match(/继续补答/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('「继续补答」改');
  });

  it('可行集被压空时，必须点名是谁挡的，并把人导向「继续补答」而不是清档重做', () => {
    // 只答历史 + 把剩下的门类全排除 → 真实可行集为 0
    const answers = makeAnswers([
      ['f_subjects', ['history']],
      ['f_exclude', ['law', 'literature', 'education', 'philosophy', 'history', 'economics', 'management']],
      ['f_subject_confirmed', 'yes'],
      ['f_color', 'normal'],
      ['f_vision', 'ok'],
      ['f_years', 'y8'],
      ['f_tuition', 'ok'],
      ['f_postgrad', 'no'],
    ]);
    const blocked = recommend(assess(answers), { majors: ALL_MAJORS, topN: 5 });
    expect(blocked.recommendations.length, '这道用例的前提是可行集真的为空').toBe(0);
    const html = renderToStaticMarkup(
      <Results
        result={blocked}
        profile={assess(answers).profile}
        wishlist={[]}
        onBrowse={() => undefined}
        onContinue={() => undefined}
        onRestart={() => undefined}
      />,
    );
    expect(html).toMatch(/点右上角「继续补答」回来改/);
    expect(html).toMatch(/最多的一类原因是「/);
    // 最高频不是唯一原因时不许说「改这一项就行」
    expect(html).toMatch(/另有 \d+ 个是别的原因挡的/);
    // 头部按钮本来就有「重做」二字，所以「不许把人赶去清档重做」只能靠正文措辞钉住
    expect(html).not.toContain('请重做');
  });

  it('挑过的专业数量必须在头部可见', () => {
    expect(renderResults(['080901', '080902'])).toContain('已挑 2');
  });
});

/**
 * 中文句子里的空格只能在**渲染之后**查。
 * 源码里扫不出来：JSX 换行会折成一个空格，而 `${x} 的` 对不对取决于 x 是数字还是汉字。
 * 首屏那三段是全站文案最密的地方，之前整页有 11 处这种空格，全靠真浏览器截图才看见。
 */
describe('界面文案：渲染出来不夹多余空格', () => {
  const CJK = '\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
  const SPAN = new RegExp(`[${CJK}][ \\u00a0][${CJK}]`, 'g');

  const memory = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return memory.size;
    },
    key: (i) => [...memory.keys()][i] ?? null,
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, String(v)),
    removeItem: (k) => void memory.delete(k),
    clear: () => memory.clear(),
  };
  // App 在模块加载时就读存档，SSR 环境里没有这两个对象会直接抛
  Object.assign(globalThis, { localStorage: fake, sessionStorage: fake });

  function visible(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function check(label: string, html: string) {
    const text = visible(html);
    const hits: string[] = [];
    SPAN.lastIndex = 0;
    for (const m of text.matchAll(SPAN)) {
      hits.push(`…${text.slice(Math.max(0, m.index! - 10), m.index! + 12)}…`);
    }
    expect(hits, `${label} 里有 ${hits.length} 处「中文 空格 中文」`).toEqual([]);
  }

  it('首屏', async () => {
    const App = (await import('../src/App')).default;
    check('首屏', renderToStaticMarkup(<App />));
  });

  it('结果页（含推荐卡与数据缺口说明）', () => {
    const a = assess(neutralAnswers());
    check(
      '结果页',
      renderToStaticMarkup(
        <Results
          result={recommend(a, { majors: ALL_MAJORS, topN: 5 })}
          profile={a.profile}
          wishlist={[]}
          onBrowse={() => undefined}
          onContinue={() => undefined}
          onRestart={() => undefined}
        />,
      ),
    );
  });

  it('自选对照区（四种状态各一条）', () => {
    check('自选对照区', render(['020101', '010102', '020201K', '040201', '140001TK']).html);
  });
});
