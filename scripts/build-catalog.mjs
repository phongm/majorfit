/**
 * 从教育部《普通高等学校本科专业目录》官方文本生成机器可读目录。
 *
 * 输入是 scripts/source/ 里存档的官方 PDF 提取文本（见同目录 SOURCE.md），
 * 输出 src/data/catalog/<年份>.ts。目录每年更新发布，换掉存档文件重跑本脚本即可，
 * 生成物不要手改 —— 手改的一次性修正会在下一年整批失效。
 *
 * 用法：npm run build:catalog
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_TXT = join(ROOT, 'scripts/source/catalog-2026.txt');
const OUT = join(ROOT, 'src/data/catalog/2026.ts');

/** 门类代码 → 本项目 FieldCategory；必须与 src/domain/types.ts 的门类表逐字对齐 */
const FIELD_KEYS = {
  '01': 'philosophy',
  '02': 'economics',
  '03': 'law',
  '04': 'education',
  '05': 'literature',
  '06': 'history',
  '07': 'science',
  '08': 'engineering',
  '09': 'agriculture',
  '10': 'medicine',
  '12': 'management',
  '13': 'arts',
  '14': 'interdisciplinary',
};

const METADATA = {
  year: 2026,
  title: '普通高等学校本科专业目录（2026年）',
  docNumber: '教高函〔2026〕2号',
  issuedAt: '2026-04-07',
  noticeUrl: 'http://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/t20260427_1434931.html',
  pdfUrl: 'http://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/W020260427440749576927.pdf',
  pdfSha256: '51026248004546171620678895e991a6f0ada1ebf0de6498fe8c563873b43f11',
  fetchedAt: '2026-10-02',
};

/**
 * 代码形态：门类 2 位、专业类 4 位、专业 6 位 + T/K 后缀。
 * 例外：0502 外国语言文学类的特设专业是 7 位（0502100T 起共 8 条），
 * 因为该类 6 位序号已用尽 —— 883 = 875 条六位 + 8 条七位，不是解析噪声。
 */
const CODE_RE = /(?<=^|[\s　])(\d{6,7}(?:TK|T|K)?|\d{4}|\d{2})(?=[\s　])/g;

/** 名称换行会在中文字符之间留下空格，如「授予工学学 士学位」，必须去掉 */
const joinWraps = (s) =>
  s.replace(/(?<=[\u4e00-\u9fff（）：，。、])[ \t\n\u3000]+(?=[\u4e00-\u9fff（）：，、])/g, '').trim();

/** 每页页脚是「— 5 —」这种独立行，不去掉会被当成名称的一部分 */
function stripPageMarkers(text) {
  const out = text.replace(/\x0c/g, '').replace(/^\s*[—–-]\s*\d+\s*[—–-]\s*$/gm, '');
  if (/^\s*[—–-]\s*\d+\s*[—–-]\s*$/m.test(out)) throw new Error('页码行没清干净');
  return out;
}

/**
 * 拆「（注：…）」里的两件事：改代码前的旧代码，以及学位授予门类说明。
 * 旧代码必须单独存字段 —— 交叉学科门类那 15 条里有 11 条是从工学、医学类整体迁过来的，
 * 只留一句中文说明的话，本项目里按旧代码写的专业画像会变成查不出原因的悬空 id。
 */
function parseNote(note) {
  if (!note) return {};
  const former = /原专业代码为(\d{6,7}(?:TK|T|K)?)/.exec(note)?.[1];
  const degreeNote = note
    .replace(/原专业代码为\d{6,7}(?:TK|T|K)?。?/, '')
    .replace(/^[。；\s]+/, '')
    .trim();
  return { formerCode: former, degreeNote: degreeNote || undefined };
}

function tokenize(text) {
  const tokens = [];
  for (const m of text.matchAll(CODE_RE)) {
    tokens.push({ raw: m[1], digits: m[1].replace(/\D.*$/, '').length, start: m.index, end: m.index + m[1].length });
  }
  return tokens;
}

function parse(source) {
  const text = stripPageMarkers(source);
  const start = text.search(/01[\s　]+学科门类：/);
  if (start < 0) throw new Error('没找到门类正文起点「01 学科门类：」，存档文本可能被截断');
  const body = text.slice(start);
  const tokens = tokenize(body);

  const fields = new Map();
  const classes = new Map();
  const majors = [];
  /** 按文档顺序追当前所属门类/专业类，用来独立验证「代码前缀 == 原文分节」 */
  let orderField = null;
  let orderClass = null;

  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    const label = joinWraps(body.slice(t.end, next ? next.start : body.length));
    if (!label) return;

    if (t.digits === 2 && /^学科门类：/.test(label)) {
      orderField = t.raw;
      orderClass = null;
      fields.set(t.raw, label.replace(/^学科门类：/, '').replace(/（.*?）/, ''));
      return;
    }
    if (t.digits === 4 && /^[\u4e00-\u9fff]{2,20}类$/.test(label)) {
      orderClass = t.raw;
      classes.set(t.raw, label);
      return;
    }
    if (t.digits >= 6) {
      const noteMatch = label.match(/（注：(.+)）$/s);
      const name = (noteMatch ? label.slice(0, noteMatch.index) : label).trim();
      // 官方专业名里只可能出现顿号（政治学、经济学与哲学）和间隔号；
      // 出现括号或页码残留都说明切分错位了
      if (!/^[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9、·]*$/.test(name)) {
        throw new Error(`${t.raw} 的专业名称解析异常：「${label}」`);
      }
      const { formerCode, degreeNote } = parseNote(noteMatch?.[1] ?? '');
      majors.push({
        code: t.raw,
        name,
        // 交叉学科门类的专业直接挂门类，目录里没有给它划分专业类
        classCode: classes.has(t.raw.slice(0, 4)) ? t.raw.slice(0, 4) : undefined,
        fieldCode: t.raw.slice(0, 2),
        orderFieldCode: orderField,
        orderClassCode: orderClass,
        formerCode,
        degreeNote,
      });
    }
  });

  return { fields, classes, majors };
}

function assertGates({ fields, classes, majors }) {
  const fail = (msg) => {
    throw new Error(`数据门未通过：${msg}`);
  };

  const expected = { fields: 13, classes: 92, majors: 883 };
  if (fields.size !== expected.fields) fail(`门类数 ${fields.size}，官方发布为 ${expected.fields}`);
  if (classes.size !== expected.classes) fail(`专业类数 ${classes.size}，官方发布为 ${expected.classes}`);
  if (majors.length !== expected.majors) fail(`专业数 ${majors.length}，官方发布为 ${expected.majors}`);

  const codes = majors.map((m) => m.code);
  if (new Set(codes).size !== codes.length) {
    fail(`专业代码重复：${codes.filter((c, i) => codes.indexOf(c) !== i).join('、')}`);
  }

  for (const m of majors) {
    if (!/^\d{6,7}(TK|T|K)?$/.test(m.code)) fail(`${m.code} 代码形态不符合目录规则`);
    if (m.orderFieldCode !== m.fieldCode) {
      fail(`${m.code} ${m.name} 的代码前缀门类 ${m.fieldCode} 与原文分节 ${m.orderFieldCode} 不一致`);
    }
    if (m.classCode && m.orderClassCode !== m.classCode) {
      fail(`${m.code} ${m.name} 的代码前缀专业类 ${m.classCode} 与原文分节 ${m.orderClassCode} 不一致`);
    }
    if (!fields.has(m.fieldCode)) fail(`${m.code} ${m.name} 所属门类 ${m.fieldCode} 不在门类表里`);
    if (!FIELD_KEYS[m.fieldCode]) fail(`门类 ${m.fieldCode} 没有对应的 FieldCategory 键`);
    if (m.classCode) {
      if (!classes.has(m.classCode)) fail(`${m.code} ${m.name} 找不到所属专业类 ${m.classCode}`);
      if (m.classCode.slice(0, 2) !== m.fieldCode) {
        fail(`${m.code} 的门类 ${m.fieldCode} 与专业类 ${m.classCode} 不一致`);
      }
    } else if (m.fieldCode !== '14') {
      // 目录里只有交叉学科门类不给专业划类；别处出现无类条目就是解析漏了类标题
      fail(`${m.code} ${m.name} 没有所属专业类，但它不在交叉学科门类下`);
    }
  }

  for (const [code, name] of classes) {
    if (!codes.some((c) => c.startsWith(code))) fail(`专业类 ${code} ${name} 下面一个专业都没有`);
  }

  for (const m of majors) {
    // 名称里不该残留括号说明；出现说明解析没切干净
    if (/[（(]/.test(m.name)) fail(`${m.code} 的名称残留了括号内容：${m.name}`);
    if (m.degreeNote && !/学位$/.test(m.degreeNote)) fail(`${m.code} 的学位说明异常：「${m.degreeNote}」`);
  }

  const suffixOf = (c) => /^(\d{6,7})(TK|T|K)?$/.exec(c)?.[2] ?? '';
  const counts = majors.reduce((a, m) => {
    a[suffixOf(m.code) || '基本'] = (a[suffixOf(m.code) || '基本'] ?? 0) + 1;
    return a;
  }, {});

  return { counts, majorsWithNote: majors.filter((m) => m.degreeNote).length };
}

function tsList(name, type, rows, shape) {
  const body = rows.map((r) => `  { ${shape(r)} },`).join('\n');
  return `export const ${name}: ${type}[] = [\n${body}\n];`;
}

function render({ fields, classes, majors }, stats) {
  const fieldRows = [...fields.entries()].map(([code, label]) => ({
    code,
    category: FIELD_KEYS[code],
    name: label,
  }));
  const classRows = [...classes.entries()].map(([code, name]) => ({ code, fieldCode: code.slice(0, 2), name }));
  const majorRows = majors.map((m) => ({
    code: m.code,
    name: m.name,
    fieldCode: m.fieldCode,
    classCode: m.classCode,
    formerCode: m.formerCode,
    degreeNote: m.degreeNote,
  }));

  // 用 JSON 字面量而不是手写单引号：专业名里出现引号、反斜杠或换行时不能生成半个坏文件
  const q = (s) => JSON.stringify(String(s));

  return `/**
 * 由 scripts/build-catalog.mjs 生成，不要手改。
 * 来源：${METADATA.title}，${METADATA.docNumber}，${METADATA.issuedAt} 印发。
 * 存档与校验值见 scripts/source/SOURCE.md。重新生成：npm run build:catalog
 *
 * 只含官方目录里的事实字段（代码、名称、所属专业类、学位授予注记）。
 * 负载向量、RIASEC、负面清单这些判断值在 src/data/ 的画像层，不在这里。
 * 专业代码后缀：T 特设专业，K 国家控制布点，TK 两者皆是。
 */
import type { CatalogClass, CatalogEntry, CatalogField } from '../../domain/types';

export const CATALOG_SOURCE = ${JSON.stringify(METADATA, null, 2)};

${tsList('CATALOG_FIELDS', 'CatalogField', fieldRows, (r) => `code: ${q(r.code)}, category: ${q(r.category)}, name: ${q(r.name)}`)}

${tsList('CATALOG_CLASSES', 'CatalogClass', classRows, (r) => `code: ${q(r.code)}, fieldCode: ${q(r.fieldCode)}, name: ${q(r.name)}`)}

${tsList(
  'CATALOG_MAJORS',
  'CatalogEntry',
  majorRows,
  (r) => {
    const parts = [`code: ${q(r.code)}`, `name: ${q(r.name)}`, `fieldCode: ${q(r.fieldCode)}`];
    if (r.classCode) parts.push(`classCode: ${q(r.classCode)}`);
    if (r.formerCode) parts.push(`formerCode: ${q(r.formerCode)}`);
    if (r.degreeNote) parts.push(`degreeNote: ${q(r.degreeNote)}`);
    return parts.join(', ');
  },
)}

/** 官方目录的规模，写在这里是为了让「导入丢行」变成可测故障 */
export const CATALOG_COUNTS = { fields: ${fieldRows.length}, classes: ${classRows.length}, majors: ${majorRows.length} };

/** 带 T/K 后缀的条目分布，用来核对解析没有把后缀吃掉 */
export const CATALOG_SUFFIX_COUNTS = ${JSON.stringify(stats.counts)};
`;
}

/**
 * 命令行执行时才写盘；被测试 import 时只提供纯函数 ——
 * 「重放原文、与仓库里的生成物逐字比对」这条测试就是靠这个才能存在。
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = readFileSync(SOURCE_TXT, 'utf8');
  const parsed = parse(text);
  const stats = assertGates(parsed);
  writeFileSync(OUT, render(parsed, stats), 'utf8');
  console.log(
    `目录已生成：${OUT}\n  门类 ${parsed.fields.size} / 专业类 ${parsed.classes.size} / 专业 ${parsed.majors.length}`,
    `\n  后缀分布 ${JSON.stringify(stats.counts)}，带学位注记 ${stats.majorsWithNote} 条`,
  );
}

export { parse as parseCatalog, assertGates, render as renderCatalog, SOURCE_TXT, OUT };
