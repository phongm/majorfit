/**
 * 领域模型。
 * 所有向量分量统一归一到 0..1，便于评分引擎做非对称惩罚；
 * -1..1 的轴显式命名，避免和 0..1 强度混淆。
 */

/**
 * 教育部《普通高等学校本科专业目录（2026年）》的 13 个学科门类，按目录代码 01-14 排列。
 * 代码 11 军事学不在本科目录内（军事类专业走军校单独渠道），2026 年新增 14 交叉学科。
 */
export const FIELD_CATEGORIES = [
  'philosophy',
  'economics',
  'law',
  'education',
  'literature',
  'history',
  'science',
  'engineering',
  'agriculture',
  'medicine',
  'management',
  'arts',
  'interdisciplinary',
] as const;
export type FieldCategory = (typeof FIELD_CATEGORIES)[number];

export const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  philosophy: '哲学',
  economics: '经济学',
  law: '法学',
  education: '教育学',
  literature: '文学',
  history: '历史学',
  science: '理学',
  engineering: '工学',
  agriculture: '农学',
  medicine: '医学',
  management: '管理学',
  arts: '艺术学',
  interdisciplinary: '交叉学科',
};

/**
 * 教育部目录条目（由 scripts/build-catalog.mjs 从官方文本生成）。
 * 只有官方给出的事实字段，不含任何判断值 —— 画像在 门类/专业类/专业 三层里。
 */
export interface CatalogField {
  /** 目录里的 2 位门类代码，如 '08' */
  code: string;
  category: FieldCategory;
  name: string;
}

export interface CatalogClass {
  /** 4 位专业类代码，如 '0809' */
  code: string;
  fieldCode: string;
  name: string;
}

export interface CatalogEntry {
  /** 6 位专业代码 + 后缀：T 特设，K 国控，与 MajorProfile.id 同一写法；
   *  0502 外国语言文学类的特设专业是 7 位（0502100T 起） */
  code: string;
  name: string;
  fieldCode: string;
  /** 交叉学科门类（14）在目录里不划分专业类，该门类的条目省略此字段 */
  classCode?: string;
  /** 迁入交叉学科门类前的原专业代码 */
  formerCode?: string;
  /** 目录原文「（注：…）」里的学位授予说明，没有则省略 */
  degreeNote?: string;
}

/** 霍兰德六型，中文标签见 RIASEC_LABELS */
export interface RIASEC {
  R: number;
  I: number;
  A: number;
  S: number;
  E: number;
  C: number;
}

export const RIASEC_LABELS: Record<keyof RIASEC, string> = {
  R: '动手做出实物',
  I: '把问题研究透',
  A: '创造与表达',
  S: '帮人成长和解决问题',
  E: '说服、组织、担责任',
  C: '按规则把事做精确',
};

/**
 * 课程与训练负载。
 * 同一套 key 复用在「专业负载」和「用户耐受度」上，
 * 评分引擎按维度做 (load - tolerance) 的非对称惩罚。
 */
export const LOAD_DIMENSIONS = [
  'math',
  'programming',
  'abstraction',
  'memorization',
  'lab',
  'visual',
  'writing',
  'quantitative',
  'interpersonal',
  'fieldwork',
  'physical',
] as const;
export type LoadDimension = (typeof LOAD_DIMENSIONS)[number];

export const LOAD_LABELS: Record<LoadDimension, string> = {
  math: '数学密度',
  programming: '编程与算法',
  abstraction: '理论推导',
  memorization: '记忆量',
  lab: '实验与动手',
  visual: '图形与审美',
  writing: '阅读与写作',
  quantitative: '统计与数据',
  interpersonal: '与人打交道',
  fieldwork: '外勤与现场',
  physical: '体力投入',
};

/** 一句话说明该维度对用户的含义，用于结果页解释「为什么扣分」 */
export const LOAD_EXPLAIN: Record<LoadDimension, string> = {
  math: '要学多少门数学课、推多少公式',
  programming: '要写多少代码、做多少项目',
  abstraction: '理论证明和抽象模型的占比',
  memorization: '需要死记的知识点体量（法条、解剖、史实、药理）',
  lab: '实验室、工坊、田间、车间里的时间',
  visual: '制图、建模、构图与审美判断的占比',
  writing: '长文写作、文献阅读与表达的强度',
  quantitative: '统计、计量与数据分析的强度',
  interpersonal: '需要持续面对真实的人（临床、咨询、课堂、客户）',
  fieldwork: '离开桌面的程度（勘测、取景、工地、下乡、出海）',
  physical: '对体能和身体的消耗',
};

export type LoadVector = Record<LoadDimension, number>;

/**
 * 用户耐受度。null = 问卷没测到这个维度，与 0（明确受不了）语义完全不同：
 * null 不产生惩罚但会压低置信度并生成追问，0 会产生满额惩罚。
 */
export type ToleranceVector = Record<LoadDimension, number | null>;

/** 数据可信度标注。人没核对过的条目一律标 false，不允许冒充已验证 */
export interface DataQuality {
  verified: boolean;
  lastReviewed: string; // YYYY-MM-DD
  confidence: 'high' | 'medium' | 'low';
  todo?: string[];
}

/** 体检受限条件（依教育部《普通高等学校招生体检工作指导意见》口径） */
export interface HealthRestriction {
  colorWeak?: boolean;
  colorBlind?: boolean;
  /** 裸眼视力不足 4.8 不予录取 */
  poorVision?: boolean;
  /** 身高受限说明，仅少数专业适用 */
  heightNote?: string;
}

/**
 * 一条真实去向。fit 说的是「这个专业在这条路上占不占正门」，不是这个岗位好不好：
 * main  正门 —— 这条路的主流入口就是它，招聘方认
 * side  侧门 —— 进得去，但同一条路上更多人是从别的专业进来的，得自己补证据
 * weak  顺路 —— 岗位真实存在，但和本专业的课程关系弱，实质是转行
 */
export interface CareerPath {
  name: string;
  /** 达到该路径的最低学历门槛 */
  entryBarrier: 'bachelor' | 'master' | 'doctor' | 'license' | 'portfolio' | 'exam';
  note?: string;
  fit: CareerFit;
}

export type CareerFit = 'main' | 'side' | 'weak';

/** 界面上的说法。宁可口语，也不要让人以为在给岗位排好坏 */
export const CAREER_FIT_LABEL: Record<CareerFit, string> = {
  main: '正门',
  side: '侧门',
  weak: '顺路',
};

/**
 * 最低学历门槛的说法。放在 domain 层是因为卡片正文与折叠区都要用，
 * 而它必须按 entryBarrier 的联合类型取值 —— 用 Record<string, string> 的话，
 * 将来加一档就会渲染出一个空胶囊，还不报错。
 */
export const CAREER_BARRIER_LABEL: Record<CareerPath['entryBarrier'], string> = {
  bachelor: '本科可入',
  master: '需硕士',
  doctor: '需博士',
  license: '需执业资格',
  portfolio: '看作品集',
  exam: '需考公/考编',
};

export type IncomeRealism = 'low' | 'medium' | 'medium-high' | 'high';
export type MarketTrend = 'rising' | 'stable' | 'cooling' | 'contracting';
/** 学费量级：public 公办普通，costly 中外合作/艺术/民办高收费 */
export type CostTier = 'public' | 'elevated' | 'costly';
/** 家庭能承受学费的档位上限，与 CostTier 同一把尺子 */
export type TuitionTier = CostTier;

/** 学费档位排序，用于「这个专业比你能接受的更贵吗」 */
export const COST_RANK: Record<CostTier, number> = { public: 0, elevated: 1, costly: 2 };

/** 专业侧录取口径的类型：没核对过的维度既不挡人也不承诺 */
export type ConstraintKind = 'subject' | 'health' | 'cost';

/**
 * 画像来源层级。推断出来的分数不能伪装成核对过的分数 —— 结果页必须显示它是哪一层推出来的。
 * hand_verified  人工逐条核对，可进推荐
 * class_derived  由同一专业类里已核对的专业聚合，只能对比诊断
 * field_derived  由同一学科门类里已核对的专业聚合，粒度更粗，误差更大
 */
export type ProfileProvenance = 'hand_verified' | 'class_derived' | 'field_derived';

/**
 * 推断样本池的口径。按类聚合和按门类聚合不是一回事，
 * 一律说「同类」会把 25 个工学专业说成 25 个海洋机器人的同行。
 * 放 domain 层是因为推断层和界面层都要用，而这里不能有运行时依赖 —— 否则 75 kB 的目录会被拽进首屏 chunk。
 */
export const DERIVED_SCOPE: Record<'class_derived' | 'field_derived', string> = {
  class_derived: '同专业类',
  field_derived: '同学科门类',
};

/** 专业侧的身份与可见性 */
export interface MajorBasics {
  /** 稳定 id，用专业代码；无代码的自建条目用 kebab-case */
  id: string;
  /** 教育部专业代码，如 080901 */
  code?: string;
  name: string;
  category: FieldCategory;
  /** 专业类，如「计算机类」 */
  subCategory: string;
  degreeYears: number;
  degreeName: string;
  /** 有没有资格被系统推荐。false 的专业仍可浏览与自选诊断，但绝不进 Top5 */
  recommendable: boolean;
  /** 不参与推荐的原因。与 channelBlocked 是两件事：一个讲招录通道，一个讲我们的数据够不够 */
  notRecommendableReason?: string;
  /** 普通高考统招报不进去（艺考、体育单招等）。这条在任何路径上都不能被绕过 */
  channelBlocked: boolean;
  provenance: ProfileProvenance;
}

/** 评分引擎要用的量化判断 */
export interface ScoreableMajor extends MajorBasics {
  load: LoadVector;
  /** 该专业对从业者各型格的真实要求，不是「听起来酷不酷」 */
  riasec: RIASEC;
  /** 本科毕业直接就业的对口兑现度 0..1 */
  undergradJobFit: number;
  /** 读研/读博才能兑现专业价值的程度 0..1 */
  postgradNecessity: number;
  /** 考公可报岗位的对口程度 0..1 */
  civilServiceFit: number;
  /** 收入天花板由高到低的真实分布判断，不用顶尖个案 */
  incomeRealism: IncomeRealism;
  /** 起薪到中位的年数，负数表示需要读研前置 */
  timeToStableIncomeYears: number;
  marketTrend: MarketTrend;
}

/** 硬约束筛选要用的全部字段 */
export interface FilterableMajor extends ScoreableMajor {
  subjectRequirements: SubjectCode[];
  /** false = 这个专业的选科口径还没录进来。不能当成「不限」放过 */
  subjectRequirementsKnown: boolean;
  /**
   * 体检限制。某个维度**只有作为键出现**才算核对过（显式写 false 也算核对）；
   * 缺键就是「没查」，既不能据此排除人，也不能承诺没有限制。
   * 早先用一个 healthRestrictionsKnown 布尔代表整个对象，
   * 结果写了 colorBlind 的专业被当成色弱口径也核对过，色弱用户于是被无声放行。
   */
  healthRestrictions: HealthRestriction;
  costTier: CostTier;
  /** false = 学费档位是按公办普通收费假定的，没逐校核实 */
  costTierKnown: boolean;
  quality: DataQuality;
  /** 长学制（5 年以上）的说明，用于「为什么被学制约束挡掉」的完整回答 */
  longProgramNote?: string;
}

export interface MajorProfile extends FilterableMajor {
  coreCourses: string[];
  /** 挂科率/劝退感最强的那几门课，用来做真实的难度预警 */
  gatekeeperCourses: string[];

  marketNote: string;

  careerPaths: CareerPath[];
  /** 名字像但完全是两回事的专业 */
  commonlyConfusedWith: string[];
  clarification?: string;

  /** 诚实的负面清单。空数组视为数据缺失，不是「这个专业没有缺点」 */
  honestDrawbacks: string[];
  idealFitNote: string;
  poorFitNote: string;
}

/** 3+1+2 / 3+3 选科代码 */
export const SUBJECT_CODES = [
  'physics',
  'chemistry',
  'biology',
  'history',
  'politics',
  'geography',
  'technology',
] as const;
export type SubjectCode = (typeof SUBJECT_CODES)[number];

export const SUBJECT_LABELS: Record<SubjectCode, string> = {
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  history: '历史',
  politics: '政治',
  geography: '地理',
  technology: '技术',
};

export interface UserConstraints {
  subjectChoices: SubjectCode[];
  /** 是否已确认自己所在省份允许该组合；未确认时引擎降置信度而不是假设合规 */
  subjectChoicesConfirmed: boolean;
  colorVision: 'normal' | 'colorWeak' | 'colorBlind';
  /** 裸眼视力是否低于 4.8 */
  poorVision: boolean;
  /** 能接受的最长学制；null＝没答或答了「没算过」。写成可空而不是兜底 4，是为了让
   * 任何新读取点都必须先处理「没说过」，否则编译不过 */
  maxProgramYears: number | null;
  maxAnnualTuition: TuitionTier;
  postgradIntent: 'yes' | 'no' | 'undecided';
  excludedCategories: FieldCategory[];
}

/** 价值取向：不是「你是什么人」，而是「你愿意为什么牺牲什么」 */
export interface ValuePriorities {
  stability: number;
  income: number;
  autonomy: number;
  meaning: number;
  prestige: number;
}

export const VALUE_LABELS: Record<keyof ValuePriorities, string> = {
  stability: '稳定',
  income: '收入',
  autonomy: '自己做主',
  meaning: '有意义',
  prestige: '别人怎么看',
};

/** 可以「没被采集到」的约束项。未采集不等于取默认值 */
export const MEASURABLE_CONSTRAINTS = [
  'subjectChoices',
  'subjectChoicesConfirmed',
  'colorVision',
  'poorVision',
  'maxProgramYears',
  'maxAnnualTuition',
  'postgradIntent',
] as const;
export type MeasurableConstraint = (typeof MEASURABLE_CONSTRAINTS)[number];

/**
 * 真正决定能不能报的硬条件。
 * subjectChoicesConfirmed 是「你有没有去核对」这个动作，答没答都不改变资格，
 * 所以不能和用户说的「能接受几年、能不能负担学费」混进同一个计数 ——
 * 否则只缺这一项的用户会被界面说成「有一项硬条件没答」，
 * 而反过来，少答了色觉却被算进「已核对」会让 high 置信度说出「硬条件填全了」这种假话。
 */
export const HARD_CONSTRAINTS: readonly MeasurableConstraint[] = MEASURABLE_CONSTRAINTS.filter(
  (k) => k !== 'subjectChoicesConfirmed',
);

/**
 * 哪些字段其实没被测到。
 *
 * 引擎对「没测」和「测出中间值」必须区别对待：把未作答的深造意愿当成
 * 「未定」去罚分、把没填的学制上限当成「4 年」去算延迟兑现，
 * 会让一份没答完的问卷得到一份看起来很确定、实际是猜出来的排序。
 */
export interface UnmeasuredFlags {
  interests: (keyof RIASEC)[];
  values: (keyof ValuePriorities)[];
  theoryVsApplied: boolean;
  convergentVsOpen: boolean;
  solitudeVsPeople: boolean;
  grit: boolean;
  constraints: MeasurableConstraint[];
}

export interface UserProfile {
  interests: RIASEC;
  /** 各负载维度的耐受度，与 MajorProfile.load 同 key 对齐；null 表示未测 */
  tolerance: ToleranceVector;
  /** -1 偏向具体应用 / +1 偏向抽象理论 */
  theoryVsApplied: number;
  /** -1 偏向有唯一解 / +1 偏向开放式探索 */
  convergentVsOpen: number;
  /** -1 独处深耕 / +1 高频人际 */
  solitudeVsPeople: number;
  /** 学习耐力：能否维持长周期高强度投入 0..1 */
  grit: number;
  values: ValuePriorities;
  constraints: UserConstraints;
  unmeasured: UnmeasuredFlags;
}

export interface ExcludedMajor {
  majorId: string;
  reasonCode:
    | 'channel'
    | 'subject'
    | 'health'
    | 'years'
    | 'tuition'
    | 'category'
    | 'postgrad'
    /** 不是报不进去，是这个专业只有推断值、没有核对过的画像，没资格被推荐 */
    | 'no_profile';
  reason: string;
}

/** 一处具体的负载缺口：专业要求高于用户耐受 */
export interface LoadGap {
  dim: LoadDimension;
  load: number;
  tolerance: number;
  gap: number;
}

export interface ScoreBreakdown {
  /** 兴趣与专业要求的契合（只做门槛，不做主加分） */
  interestFit: number;
  /** 负载超出耐受度造成的损失，负值 */
  loadPenalty: number;
  valueAlignment: number;
  /** 学历投入与深造意愿的错配，负值 */
  educationMismatch: number;
  /** 就业兑现与收入预期的错配，负值 */
  rewardMismatch: number;
  /** 想不想碰原理与这个专业教不教原理的错配，负值。那边是扛不扛得住，这一项是要不要 */
  theoryMismatch: number;
  /** 错配方向：starved 是想搞原理而这里不教，swamped 是想落地而这里全是推导 */
  theorySide: 'starved' | 'swamped' | null;
  /** 具体超出耐受度的负载维度，供结果页逐条说明代价 */
  loadGaps: LoadGap[];
  /** 专业要求高、但用户该维度未测出的项 —— 不能假设他受得了 */
  unmeasuredHighLoad: LoadDimension[];
  /** 用户自述耐受度低、但被推荐项该维度很高 —— 需人确认的红旗 */
  riskFlags: string[];
}

export interface Recommendation {
  major: MajorProfile;
  /** 0..100 归一后的可比较分数 */
  score: number;
  rawScore: number;
  breakdown: ScoreBreakdown;
  matchedPoints: string[];
  costs: string[];
  conditionsToAccept: string[];
  disconfirmSignals: string[];
  rank: number;
}

export interface Confidence {
  level: 'high' | 'medium' | 'low';
  contradictions: string[];
  gaps: string[];
  note: string;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  /** 被硬约束挡掉的全部专业及原因，用于「为什么没有 X」的完整回答 */
  excluded: ExcludedMajor[];
  /** 被硬约束挡掉但兴趣匹配度确实高的专业，优先级最高的解释项 */
  excludedButRelevant: ExcludedMajor[];
  /** 因用户未作答而未生效的规则，必须显式告知而不是静默跳过 */
  skippedRules: string[];
  /** 数据本身的缺口导致的规则失效（例如某专业没录选科口径），与用户是否作答无关 */
  coverageNotes: string[];
  alternatesConsidered: number;
  confidence: Confidence;
  /** 若 < recommendations 的请求数量，说明可行集本身不足 */
  feasibleSetTooSmall: boolean;
  generatedAt: string;
}
