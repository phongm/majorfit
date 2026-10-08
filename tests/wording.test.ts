import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, PROPER_NOUNS } from '../src/ui/glossary';
import { ITEMS } from '../src/assessment/items';
import { SKIP_REASON } from '../src/engine/filters';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 只扫这些文件里的用户可见文案，代码标识符不在检查范围内 */
const SCANS = ['src/data/majors', 'src/assessment', 'src/engine', 'src/ui', 'src/data/profiles', 'src/wishlist', 'src/domain', 'src/analytics', 'src'];

/**
 * 剥掉注释再扫。
 * 不剥的话，代码注释里举的反例（比如「以前这里会输出 v_family→0.05」）
 * 会被当成用户可见文案，产生永久性的误报。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function chineseStrings(file: string): string[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const out: string[] = [];
  // 单引号与双引号字符串字面量，且含中文：界面代码里两种都在用
  for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
    const text = m[1] ?? m[2] ?? '';
    if (/[一-鿿]/.test(text)) out.push(text);
  }
  // JSX 文本节点（<p>这里</p>）：不扫的话，界面上最常见的一批文案根本没进检查范围
  for (const m of src.matchAll(/>([^<>{}]*[一-鿿][^<>{}]*)</g)) {
    out.push(m[1]!.trim());
  }
  // 模板字面量的静态部分
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    if (/[一-鿿]/.test(m[1]!)) out.push(m[1]!.replace(/\$\{[^}]*\}/g, ''));
  }
  return out;
}

function filesIn(rel: string): string[] {
  const abs = join(ROOT, rel);
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(abs, e.name));
}

const ACRONYM = /\b[A-Z][A-Za-z0-9+]{1,9}\b/g;

describe('文案：英文必须有中文解释', () => {
  const unexplained = new Map<string, string>();

  for (const rel of SCANS) {
    for (const file of filesIn(rel)) {
      for (const s of chineseStrings(file)) {
        for (const m of s.matchAll(ACRONYM)) {
          const t = m[0];
          if (t in GLOSSARY || PROPER_NOUNS.has(t)) continue;
          if (!unexplained.has(t)) unexplained.set(t, `${file.replace(ROOT, '.')}: ${s.slice(0, 60)}`);
        }
      }
    }
  }

  it('用户可见文案里不出现未登记的英文缩写', () => {
    expect(
      [...unexplained.entries()].map(([t, where]) => `${t} ← ${where}`),
      '把这些词加进 src/ui/glossary.ts 的 GLOSSARY（附中文解释）或 PROPER_NOUNS（专有名词）',
    ).toEqual([]);
  });

  it('术语表里的解释本身不能是空的或敷衍的', () => {
    for (const [term, text] of Object.entries(GLOSSARY)) {
      expect(text.length, term).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('文案：控制 AI 味', () => {
  /**
   * 「——」被大量用来制造戏剧停顿，是最典型的机器写作痕迹。
   * 口水话的定义：删掉之后，读者会做的决定没有任何变化。
   * 破折号不是判据（解释性用法是必要的），空断言才是。
   * 下面这些句式只会产出空断言，出现即拒。
   */
  const FILLER = [
    '真实存在', '确实存在', '这是事实', '不是玩笑', '不是段子', '没有正确答案',
    '不是走形式', '要注意：', '请务必', '本质上是一个', '因人而异', '这很重要',
    '值得想清楚', '需要重视', '行业行情变化快', '需要自己判断', '具体看个人',
  ];
  it('不出现空断言式的口水句式', () => {
    const hits: string[] = [];
    for (const rel of SCANS) {
      for (const file of filesIn(rel)) {
        for (const s of chineseStrings(file)) {
          for (const w of FILLER) if (s.includes(w)) hits.push(`${file.replace(ROOT, '.')}: ${w} ← ${s.slice(0, 40)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  /** 中英夹杂的填充词，不是术语，直接禁 */
  const BLOCKED = [
    'outdoors', 'increasingly', 'stage', 'review）', 'Prefer', 'actually', 'basically',
    'obviously', 'fine-grained', 'roughly', 'e.g.', 'i.e.', 'vs ',
  ];
  it('不出现中英夹杂的填充词', () => {
    const hits: string[] = [];
    for (const rel of SCANS) {
      for (const file of filesIn(rel)) {
        const s = chineseStrings(file).join('\n');
        for (const w of BLOCKED) if (s.includes(w)) hits.push(`${file.replace(ROOT, '.')}: ${w}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('界面文案不出现内部题号与字段名', () => {
    const internal = /\b(f|e|t|v)_[a-z_]+\b|\bpostgradNecessity\b|\bcivilServiceFit\b|\bundergradJobFit\b/g;
    const hits: string[] = [];
    for (const rel of ['src/ui', 'src/engine']) {
      for (const file of filesIn(rel)) {
        for (const s of chineseStrings(file)) {
          const m = s.match(internal);
          if (m) hits.push(`${file.replace(ROOT, '.')}: ${m.join(',')} ← ${s.slice(0, 40)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

/**
 * 「同类」是推断层最容易说漏的地方：按专业类聚合和按学科门类聚合是两个样本池，
 * 一律写成「同类」等于把 25 个工学专业说成 25 个海洋机器人的同行。
 * 要指样本池就说准（同专业类 / 同学科门类），否则别说。
 */
describe('文案：不许用「同类」糊弄样本池', () => {
  it('用户可见文案里不出现裸的「同类」', () => {
    const hits: string[] = [];
    for (const rel of SCANS) {
      for (const file of filesIn(rel)) {
        for (const s of chineseStrings(file)) {
          if (s.includes('同类')) hits.push(`${file.replace(ROOT, '.')}: ${s.slice(0, 46)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});


/**
 * 结果页那句「答了『不记得/没查过』也算没说」里的引号，必须逐字对上题库里真实存在的选项 label。
 * 这道门是因为一次真实串线：色觉题的选项是「不记得/没查过」，视力题的才是「不清楚」，
 * 统一措辞时两条对调了 —— 于是色觉用户看到一句指向视力题的话，而它读起来完全通顺。
 */
describe('文案：引用选项原文必须逐字来自题库', () => {
  it('每条未生效说明引号里的话，得是**那道题**的选项 label', () => {
    // 约束 → 采集它的题目选项 label。只查「是不是某个 label」抓不到串线：
    // 「不清楚」是视力题的真实选项，色觉题写成「不清楚」照样过。
    // 先找出「哪道题采集了这个约束」，再取那道题的全部选项 label ——
    // 「不记得/没查过」这类选项 delta 是空的，按写没写约束去找就永远找不到它们
    const owners = new Map<string, string[]>();
    for (const item of ITEMS) {
      if (!('options' in item)) continue;
      for (const key of new Set(item.options.flatMap((o) => Object.keys(o.delta.constraints ?? {})))) {
        owners.set(key, [...(owners.get(key) ?? []), item.id]);
      }
    }
    const byConstraint = new Map<string, Set<string>>();
    for (const [key, ids] of owners) {
      const labels = new Set<string>();
      for (const id of ids) {
        const item = ITEMS.find((i) => i.id === id);
        if (item && 'options' in item) for (const o of item.options) labels.add(o.label);
      }
      byConstraint.set(key, labels);
    }
    const bad: string[] = [];
    for (const [key, text] of Object.entries(SKIP_REASON)) {
      const owned = byConstraint.get(key);
      for (const m of text.matchAll(/「([^」]+)」/g)) {
        const quoted = m[1] ?? '';
        if (!owned?.has(quoted)) bad.push(`${key} 引了「${quoted}」，那道题的选项是 ${[...(owned ?? [])].join('/') || '（无归属题）'}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
