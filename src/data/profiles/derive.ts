import { channelBlock } from '../../domain/admission';
import {
  DERIVED_SCOPE,
  FIELD_CATEGORY_LABELS,
  LOAD_DIMENSIONS,
  type CatalogEntry,
  type CostTier,
  type FieldCategory,
  type FilterableMajor,
  type HealthRestriction,
  type IncomeRealism,
  type LoadVector,
  type MajorProfile,
  type MarketTrend,
  type ProfileProvenance,
  type RIASEC,
  type SubjectCode,
} from '../../domain/types';
import { CATALOG_CLASSES, CATALOG_FIELDS, CATALOG_MAJORS } from '../catalog/2026';
import { ALL_MAJORS } from '../majors';

/**
 * 从已人工核对的专业画像聚合出「专业类 / 学科门类」级别的判断值。
 *
 * 这一层不发明判断：每个推断值都来自库里已核对的样本，并且必须报得出样本是谁。
 * 因此它**只服务浏览与自选诊断，没有资格进推荐** —— 进推荐的是人工核对过的条目，
 * 或者日后逐条录入并核对过的专业类画像。
 */
export interface DerivedMajor extends FilterableMajor {
  provenance: Extract<ProfileProvenance, 'class_derived' | 'field_derived'>;
  /** 推断依据的已核对专业 id，界面用它回答「凭什么这么说」 */
  derivedFrom: string[];
  /** 推断过程中主动放弃的规则，例如同类样本的选科口径不一致 */
  derivedCaveats: string[];
}

export type ResolvedMajor =
  | { kind: 'hand_verified'; major: MajorProfile }
  | { kind: 'derived'; major: DerivedMajor }
  | null;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** 取众数；并列时取 prefer 顺序里第一个命中的，用来把「不承诺」的一侧放前面 */
function modeAll<T extends string>(xs: T[]): Map<T, number> {
  const count = new Map<T, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return count;
}

/**
 * 画像的 id 就是专业代码（tests/data.test.ts 有门），所以这里只按 id 建索引。
 * 曾经额外用 code 建一份冗余索引，但 67 条画像 code 全部等于 id，那条索引永不产生新键，
 * 是一段没有反例能证明它有用的代码 —— 要放宽成 id≠code，先改那道数据门。
 */
const verifiedById = new Map(ALL_MAJORS.map((m) => [m.id, m]));
const entryByCode = new Map(CATALOG_MAJORS.map((e) => [e.code, e]));
const classByCode = new Map(CATALOG_CLASSES.map((c) => [c.code, c]));
const categoryByField = new Map(CATALOG_FIELDS.map((f) => [f.code, f.category]));

const classSamples = new Map<string, MajorProfile[]>();
const fieldSamples = new Map<FieldCategory, MajorProfile[]>();

for (const m of ALL_MAJORS) {
  const code = m.code ?? m.id;
  // 没有目录代码的自建条目不进任何样本池：门类侧同理，否则基线里混进目录外的专业
  if (!entryByCode.has(code)) continue;
  const cls = classByCode.get(code.slice(0, 4));
  if (cls) {
    const list = classSamples.get(cls.code) ?? [];
    if (!list.includes(m)) list.push(m);
    classSamples.set(cls.code, list);
  }
  const byField = fieldSamples.get(m.category) ?? [];
  if (!byField.includes(m)) byField.push(m);
  fieldSamples.set(m.category, byField);
}

const DEGREE_NAMES = [
  '哲学',
  '经济学',
  '法学',
  '教育学',
  '文学',
  '历史学',
  '理学',
  '工学',
  '农学',
  '医学',
  '管理学',
  '艺术学',
  '交叉学科',
] as const;

/**
 * 学位授予门类按目录原文的结构解析：「授予X学士学位」「可授X或Y学士学位」。
 * 不能拿正则找 `X学士学位` —— 「可授经济学或管理学学士学位」里只有最后一项后面跟着
 * 「学士学位」，那样会把经济学整个丢掉，替专业承诺一个错的学位门类。
 * 目录说明第四条：可授两种以上学位时由院校确定，所以这里取原文第一项并写明并列。
 */
function degreeNamesFromNote(note: string | undefined): string[] {
  // 「授予」「可授」都要能吃掉：漏掉「予」会让捕获组变成「予理学」，
  // 于是这一条永远匹配不上任何学位门类名
  const body = /(?:可)?授(?:予)?(.+?)学士学位/.exec(note ?? '')?.[1];
  if (!body) return [];
  return body.split('或').filter((n) => (DEGREE_NAMES as readonly string[]).includes(n));
}

function degreeNameOf(entry: CatalogEntry, category: FieldCategory, caveats: string[]): string {
  const hits = degreeNamesFromNote(entry.degreeNote);
  if (hits.length === 1) return `${hits[0]}学士`;
  if (hits.length > 1) {
    caveats.push(`可授${hits.join('或')}，这里取原文第一项（${hits[0]}学士），授予哪个门类由院校确定`);
    return `${hits[0]}学士`;
  }
  return `${FIELD_CATEGORY_LABELS[category]}学士`;
}

/**
 * 体检限制**不从样本传染**。
 * 早期版本按「同类里有人记了色弱限制就算有」推断，实测让 216 个方向在色弱用户面前被判死，
 * 其中 监狱学、社区矫正 是被 法学 的体检记录连累的 —— 那是编造出来的录取规则。
 * 没依据就说没依据，既不挡人也不承诺。
 */
function mergeHealth(samples: MajorProfile[], scope: string): { health: HealthRestriction; caveat?: string } {
  const flagged = samples.some(
    (m) => m.healthRestrictions.colorWeak || m.healthRestrictions.colorBlind || m.healthRestrictions.poorVision,
  );
  return {
    health: {},
    caveat: flagged
      ? `${scope}里有专业设了体检限制，这个方向自己的口径没核对，体检前必须查院校招生章程`
      : undefined,
  };
}

/**
 * 选科口径要么有两条以上一致的样本，要么就不设限。
 * 单条样本的「不限」推给整类，等于用一个人的核对结果替 8 个专业承诺资格。
 */
function mergeSubjects(samples: MajorProfile[], scope: string): { list: SubjectCode[]; known: boolean; caveat?: string } {
  const key = (s: SubjectCode[]) => [...s].sort().join('+') || '不限';
  const keys = new Set(samples.map((m) => key(m.subjectRequirements)));
  if (keys.size > 1) {
    return {
      list: [],
      known: false,
      caveat: `${scope}已核对专业的选科口径不一致（${[...keys].join(' / ')}），没有据此设限`,
    };
  }
  if (samples.length < 2) {
    return { list: [], known: false, caveat: `${scope}只有 1 个已核对样本，选科口径没有外推依据` };
  }
  const first = samples[0]!;
  return { list: [...first.subjectRequirements], known: true };
}

/** 众数；并列时按 prefer 指定的顺序取，并把并列记进 caveat —— 静默选一个等于假装确定 */
function modePrefer<T extends string>(xs: T[], prefer: readonly T[], label: string, caveats: string[], scope: string): T {
  const count = modeAll(xs);
  const top = Math.max(...count.values());
  const tied = [...count.entries()].filter(([, n]) => n === top).map(([v]) => v);
  const picked = prefer.find((p) => tied.includes(p)) ?? tied[0]!;
  if (tied.length > 1) {
    caveats.push(`${label}在${scope}样本里并列（${tied.join(' / ')}），保守取了 ${picked}`);
  }
  return picked;
}

/** 并列时一律往「不承诺」的一侧靠 */
const COST_CONSERVATIVE: readonly CostTier[] = ['costly', 'elevated', 'public'];
const TREND_CONSERVATIVE: readonly MarketTrend[] = ['contracting', 'cooling', 'stable', 'rising'];
const INCOME_CONSERVATIVE: readonly IncomeRealism[] = ['low', 'medium', 'medium-high', 'high'];

function derive(entry: CatalogEntry, samples: MajorProfile[], provenance: DerivedMajor['provenance']): DerivedMajor | null {
  if (!samples.length) return null;
  const category = categoryByField.get(entry.fieldCode);
  if (!category) return null;
  const cls = entry.classCode ? classByCode.get(entry.classCode) : undefined;

  const load = {} as LoadVector;
  for (const d of LOAD_DIMENSIONS) load[d] = Math.round(median(samples.map((m) => m.load[d])) * 100) / 100;
  const riasec = {} as RIASEC;
  for (const k of ['R', 'I', 'A', 'S', 'E', 'C'] as const) {
    riasec[k] = Math.round(median(samples.map((m) => m.riasec[k])) * 100) / 100;
  }

  const caveats: string[] = [];
  const scope = DERIVED_SCOPE[provenance];
  const { health, caveat: healthCaveat } = mergeHealth(samples, scope);
  if (healthCaveat) caveats.push(healthCaveat);
  const subjects = mergeSubjects(samples, scope);
  if (subjects.caveat) caveats.push(subjects.caveat);

  // 并列时一律往「不承诺」的方向靠：学制取长、学费取贵、行情取差、收入取低
  const yearPrefer = [...new Set(samples.map((m) => String(m.degreeYears)))].sort((a, b) => Number(b) - Number(a));
  const years = modePrefer(samples.map((m) => String(m.degreeYears)), yearPrefer, '学制', caveats, scope);
  const cost = modePrefer(samples.map((m) => m.costTier), COST_CONSERVATIVE, '学费档位', caveats, scope);
  const trend = modePrefer(samples.map((m) => m.marketTrend), TREND_CONSERVATIVE, '行业行情', caveats, scope);
  const income = modePrefer(samples.map((m) => m.incomeRealism), INCOME_CONSERVATIVE, '收入量级', caveats, scope);

  const subCategory = cls?.name ?? `${FIELD_CATEGORY_LABELS[category]}（目录未划类）`;
  const block = channelBlock(category, subCategory);

  return {
    id: entry.code,
    code: entry.code,
    name: entry.name,
    category,
    subCategory,
    degreeYears: Number(years),
    degreeName: degreeNameOf(entry, category, caveats),
    // 推断值没有资格进推荐；通道走不进去则是另一件事，两条都必须显示
    recommendable: false,
    channelBlocked: !!block,
    notRecommendableReason: block?.reason ?? `只有${scope}的推断值，没有逐条核对的画像：可以对比诊断，但不参与推荐`,
    provenance,
    load,
    riasec,
    undergradJobFit: Math.round(median(samples.map((m) => m.undergradJobFit)) * 100) / 100,
    postgradNecessity: Math.round(median(samples.map((m) => m.postgradNecessity)) * 100) / 100,
    civilServiceFit: Math.round(median(samples.map((m) => m.civilServiceFit)) * 100) / 100,
    incomeRealism: income,
    timeToStableIncomeYears: Math.round(median(samples.map((m) => m.timeToStableIncomeYears))),
    marketTrend: trend,
    subjectRequirements: subjects.list,
    subjectRequirementsKnown: subjects.known,
    // 空对象 = 三个维度都没核对过（filters 按键是否存在判断），既不挡人也不承诺
    healthRestrictions: health,
    costTier: cost,
    // 学费档位是同类样本的保守众数，不是这个专业自己的核实值
    costTierKnown: false,
    quality: {
      verified: false,
      lastReviewed: samples.map((m) => m.quality.lastReviewed).sort()[0]!,
      confidence: 'low',
      todo: [`由 ${samples.length} 个${scope}已核对专业推断，未逐条核对`],
    },
    derivedFrom: samples.map((m) => m.id),
    derivedCaveats: caveats,
  };
}

const cache = new Map<string, ResolvedMajor>();

/**
 * 给定目录代码，返回它的画像来源：
 * 人工核对 > 专业类推断 > 学科门类推断 > 无数据。
 */
export function resolveMajor(code: string): ResolvedMajor {
  if (cache.has(code)) return cache.get(code)!;

  const hand = verifiedById.get(code);
  const out: ResolvedMajor = (() => {
    if (hand) return { kind: 'hand_verified', major: hand };
    const entry = entryByCode.get(code);
    if (!entry) return null;
    const classSampleList = entry.classCode ? classSamples.get(entry.classCode) : undefined;
    if (classSampleList?.length) {
      const d = derive(entry, classSampleList, 'class_derived');
      if (d) return { kind: 'derived', major: d };
    }
    const field = categoryByField.get(entry.fieldCode);
    const fieldSampleList = field ? fieldSamples.get(field) : undefined;
    if (fieldSampleList?.length) {
      const d = derive(entry, fieldSampleList, 'field_derived');
      if (d) return { kind: 'derived', major: d };
    }
    return null;
  })();

  cache.set(code, out);
  return out;
}

/** 目录里有多少条目前能拿到推断画像，用来在界面上说清覆盖度 */
export function coverage(): { catalog: number; handVerified: number; derived: number; none: number } {
  let hand = 0;
  let derived = 0;
  for (const e of CATALOG_MAJORS) {
    const r = resolveMajor(e.code);
    if (r?.kind === 'hand_verified') hand += 1;
    else if (r?.kind === 'derived') derived += 1;
  }
  return { catalog: CATALOG_MAJORS.length, handVerified: hand, derived, none: CATALOG_MAJORS.length - hand - derived };
}
