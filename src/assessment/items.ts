import type { Item } from './schema';
import type { Answers } from './scoring';

/**
 * 题库。tolerance / interests 的取值一律是「该选项对应的绝对水平」，
 * 同一维度被多题测到时由 scoring 取平均并记录样本数，
 * 只被一题测到的维度记进 diagnostics.thin 供排查，不参与排序与置信度分档。
 */
export const ITEMS: Item[] = [
  // ────────────────────────────── facts ──────────────────────────────
  {
    id: 'f_subjects',
    section: 'facts',
    kind: 'multi',
    measuring: '选科组合（决定你能报什么）',
    prompt: '你在高考中选考/必考的非语数外科目是哪些？',
    help: '3+1+2 省份：物理/历史二选一，再从化学生物政治地理技术中任选两门。临床医学多数要求物理加化学，没选化学就直接出局。',
    maxSelections: 3,
    options: [
      { id: 'physics', label: '物理', delta: { constraints: { subjectChoices: ['physics'] } } },
      { id: 'chemistry', label: '化学', delta: { constraints: { subjectChoices: ['chemistry'] } } },
      { id: 'biology', label: '生物', delta: { constraints: { subjectChoices: ['biology'] } } },
      { id: 'history', label: '历史', delta: { constraints: { subjectChoices: ['history'] } } },
      { id: 'politics', label: '政治', delta: { constraints: { subjectChoices: ['politics'] } } },
      { id: 'geography', label: '地理', delta: { constraints: { subjectChoices: ['geography'] } } },
      { id: 'technology', label: '技术', delta: { constraints: { subjectChoices: ['technology'] } } },
    ],
  },
  {
    id: 'f_subject_confirmed',
    section: 'facts',
    kind: 'fact',
    measuring: '选科组合的合规性',
    prompt: '上面这个组合，是你所在省份招办确认可以报考理工医类专业的吗？',
    options: [
      { id: 'yes', label: '是，确认过（问了招办/老师，或查过目标专业要求）', delta: { constraints: { subjectChoicesConfirmed: true } } },
      { id: 'no', label: '没确认过，只是我自己选的', delta: { constraints: { subjectChoicesConfirmed: false } } },
    ],
  },
  {
    id: 'f_color',
    section: 'facts',
    kind: 'fact',
    measuring: '色觉（大量专业有硬性限制）',
    prompt: '高考体检的色觉结论是什么？',
    help: '色弱/色盲在化学、医学、药学、生物、环境、农学、美术、公安技术类是不予录取的，这不是努力能绕过去的。',
    options: [
      { id: 'normal', label: '正常', delta: { constraints: { colorVision: 'normal' } } },
      { id: 'weak', label: '色弱', delta: { constraints: { colorVision: 'colorWeak' } } },
      { id: 'blind', label: '色盲（单色识别不全）', delta: { constraints: { colorVision: 'colorBlind' } } },
      { id: 'unknown', label: '不记得/没查过', delta: {} },
    ],
  },
  {
    id: 'f_vision',
    section: 'facts',
    kind: 'fact',
    measuring: '裸眼视力',
    prompt: '裸眼视力（不戴眼镜）任意一眼是否低于 4.8？',
    options: [
      { id: 'ok', label: '不低于 4.8', delta: { constraints: { poorVision: false } } },
      { id: 'low', label: '低于 4.8', delta: { constraints: { poorVision: true } } },
      { id: 'unknown', label: '不清楚', delta: {} },
    ],
  },
  {
    id: 'f_years',
    section: 'facts',
    kind: 'fact',
    measuring: '可接受的最长培养周期',
    prompt: '为了一个方向，你最长愿意读到几年？',
    help:
      '这一条管两件事：学制比它长的专业直接排除，以及「几年才有稳定收入」超出多少就扣多少分。'
      + '别把选 5 年当成 5 年能挣钱：医科五年制之后还有 3 年规培，那段算在收入兑现年限里，结果页会写明约几年。',
    options: [
      {
        id: 'y4',
        label: '4 年，只考虑标准学制',
        sub: '五年制的临床、口腔、中医学、建筑学都会被排除',
        delta: { constraints: { maxProgramYears: 4 } },
      },
      {
        id: 'y5',
        label: '5 年',
        sub: '本库最长的一档学制，五年制医学类、建筑类都留下',
        delta: { constraints: { maxProgramYears: 5 } },
      },
      {
        id: 'y8',
        label: '7-8 年也可以，值得就行',
        sub: '本库最长的学制是 5 年，所以这一档不排除任何方向，只把「几年才有稳定收入」的扣分基线抬高',
        delta: { constraints: { maxProgramYears: 8 } },
      },
      {
        id: 'unknown',
        label: '没算过这个',
        sub: '不做学制排除，也不按回本快慢扣分，结果页会说明这一项没生效',
        delta: {},
      },
    ],
  },
  {
    id: 'f_tuition',
    section: 'facts',
    kind: 'fact',
    measuring: '家庭学费承受档位',
    prompt: '家里对你每年学费的承受范围大概是？',
    help:
      '学费是院校属性：同一个专业在公办、民办、中外合作办学里能差十倍（中外合作常 3 万以上/年）。' +
      '本系统只在专业档位已核实时才用它做排除 —— 目前只有艺术类专业核过档位，所以这题现在主要用于结果页的提醒，报民办或中外合作前仍要按目标院校招生章程自己确认。',
    options: [
      { id: 'public', label: '普通公办水平（5-6 千/年）没问题，更高要慎重', delta: { constraints: { maxAnnualTuition: 'public' } } },
      { id: 'ok', label: '每年 1.5-3 万可以接受（部分民办、艺术类）', delta: { constraints: { maxAnnualTuition: 'elevated' } } },
      { id: 'rich', label: '每年 3 万以上也能接受（中外合作、民办高收费都算）', delta: { constraints: { maxAnnualTuition: 'costly' } } },
    ],
  },
  {
    id: 'f_postgrad',
    section: 'facts',
    kind: 'fact',
    measuring: '深造意愿',
    prompt: '你打算读研吗？',
    help: '这决定了很多专业的成立与否。生物、材料、化学、基础医学、心理学本科出口和读研后几乎是两个行业。',
    options: [
      { id: 'yes', label: '会读，直博也可以考虑', delta: { constraints: { postgradIntent: 'yes' } } },
      { id: 'probably', label: '大概率读，但没想清楚', delta: { constraints: { postgradIntent: 'undecided' } } },
      { id: 'no', label: '不想读，本科毕业就想工作', delta: { constraints: { postgradIntent: 'no' } } },
      { id: 'depends', label: '看专业，如果这个专业不读研就没出路那我就读', delta: { constraints: { postgradIntent: 'yes' } } },
    ],
  },
  {
    id: 'f_exclude',
    section: 'facts',
    kind: 'multi',
    measuring: '明确排斥的方向',
    prompt: '下面这些方向，哪些是你绝对不会考虑的？（选了就一定会被排除，不会推给你）',
    options: [
      { id: 'engineering', label: '工学（各种工程、制造、工地、车间）', delta: { constraints: { excludedCategories: ['engineering'] } } },
      { id: 'science', label: '理学（数学物理化学生物等基础研究）', delta: { constraints: { excludedCategories: ['science'] } } },
      { id: 'medicine', label: '医学', delta: { constraints: { excludedCategories: ['medicine'] } } },
      { id: 'agriculture', label: '农学（涉农、畜牧、林业）', delta: { constraints: { excludedCategories: ['agriculture'] } } },
      { id: 'arts', label: '艺术学', delta: { constraints: { excludedCategories: ['arts'] } } },
      { id: 'law', label: '法学', delta: { constraints: { excludedCategories: ['law'] } } },
      { id: 'economics', label: '经济学', delta: { constraints: { excludedCategories: ['economics'] } } },
      { id: 'management', label: '管理学（会计、工商管理、物流等）', delta: { constraints: { excludedCategories: ['management'] } } },
      { id: 'literature', label: '文学（中文、外语、新闻）', delta: { constraints: { excludedCategories: ['literature'] } } },
      { id: 'history', label: '历史学（历史、考古、文博）', delta: { constraints: { excludedCategories: ['history'] } } },
      { id: 'education', label: '教育学（含师范）', delta: { constraints: { excludedCategories: ['education'] } } },
      { id: 'philosophy', label: '哲学', delta: { constraints: { excludedCategories: ['philosophy'] } } },
      {
        id: 'interdisciplinary',
        label: '交叉学科（未来机器人、具身智能、脑机科学与技术这类 2026 年新设专业）',
        delta: { constraints: { excludedCategories: ['interdisciplinary'] } },
      },
    ],
  },

  // ───────────────────────────── evidence：RIASEC 行为锚定 ─────────────────────────────
  {
    id: 'e_fix',
    section: 'evidence',
    kind: 'behavior',
    measuring: '现实型（R）：动手操作物理事物的真实历史',
    prompt: '有没有一次，你自己把某个东西修好、装好或做出来，而且它最后真的能用了？',
    help: '不是实验课按要求做的，是你自己想做的。',
    options: [
      { id: 'many', label: '有过好几次，机器、电路、木工、改装、硬件这类东西我做得出来也用得住', delta: { interests: { R: 0.95 }, tolerance: { lab: 0.9 } } },
      { id: 'once', label: '有过一两次', delta: { interests: { R: 0.6 }, tolerance: { lab: 0.6 } } },
      { id: 'class', label: '只有实验课/通用技术课上按要求做过', delta: { interests: { R: 0.3 }, tolerance: { lab: 0.4 } } },
      { id: 'none', label: '没做过，也不想去碰', delta: { interests: { R: 0.05 }, tolerance: { lab: 0.1 } } },
    ],
  },
  {
    id: 'e_why',
    section: 'evidence',
    kind: 'behavior',
    measuring: '研究型（I）：不为考试而追问的习惯',
    prompt: '最近一次，你为了一个「没用但好奇」的问题连续查资料超过两小时，是什么时候、查的是什么？',
    options: [
      { id: 'recent', label: '几个月内就有过，而且查到我看的东西基本看完了', delta: { interests: { I: 0.95 }, theoryVsApplied: 0.6 } },
      { id: 'before', label: '以前有过，最近少了', delta: { interests: { I: 0.65 }, theoryVsApplied: 0.3 } },
      { id: 'exam_only', label: '只有为考试才查那么久', delta: { interests: { I: 0.3 }, theoryVsApplied: -0.2 } },
      { id: 'never', label: '没有过，我更喜欢直接上手做', delta: { interests: { I: 0.1 }, theoryVsApplied: -0.6 } },
    ],
  },
  {
    id: 'e_show',
    section: 'evidence',
    kind: 'behavior',
    measuring: '艺术型（A）：创作并公开过的作品',
    prompt: '你有没有自己做的作品（写作、画、影像、音乐、设计、剪辑）发给别人看过？',
    options: [
      { id: 'series', label: '有，而且是成系列的，还有人主动来催更', delta: { interests: { A: 0.95 }, tolerance: { visual: 0.85, writing: 0.7 } } },
      { id: 'few', label: '发过几件', delta: { interests: { A: 0.6 }, tolerance: { visual: 0.55 } } },
      { id: 'private', label: '做过但没给别人看过', delta: { interests: { A: 0.45 } } },
      { id: 'none', label: '没做过', delta: { interests: { A: 0.05 }, tolerance: { visual: 0.15 } } },
    ],
  },
  {
    id: 'e_teach',
    section: 'evidence',
    kind: 'behavior',
    measuring: '社会型（S）：持续付出型的助人经历',
    prompt: '有没有一段超过一个月的时间里，你在持续教别人、照顾别人或者为别人负责？',
    help: '给同学讲过一道题不算，那是单次。',
    options: [
      { id: 'long', label: '有，而且是固定的（带社团、长期辅导、照顾家人、志愿者、陪护）', delta: { interests: { S: 0.95 }, tolerance: { interpersonal: 0.85 } } },
      { id: 'mid', label: '有，但只有几周', delta: { interests: { S: 0.6 }, tolerance: { interpersonal: 0.6 } } },
      { id: 'ad_hoc', label: '只有同学来问我时才帮', delta: { interests: { S: 0.35 } } },
      { id: 'avoid', label: '没有，我基本不主动介入别人的事', delta: { interests: { S: 0.08 } } },
    ],
  },
  {
    id: 'e_lead',
    section: 'evidence',
    kind: 'behavior',
    measuring: '企业型（E）：把一群人说服并带走的结果',
    prompt: '你有没有成功让一批本来不想动的人跟你一起做一件事？（活动、项目、生意都行）',
    options: [
      { id: 'repeated', label: '有过不止一次，而且我知道怎么做到的', delta: { interests: { E: 0.95 } } },
      { id: 'once', label: '有过一次', delta: { interests: { E: 0.65 } } },
      { id: 'tried', label: '试过，没成，我很累', delta: { interests: { E: 0.3 } } },
      { id: 'never', label: '没兴趣干这事', delta: { interests: { E: 0.05 } } },
    ],
  },
  {
    id: 'e_system',
    section: 'evidence',
    kind: 'behavior',
    measuring: '常规型（C）：自发维护秩序、扛得住不能出错的事务',
    prompt: '你自己主动维护过一套长期使用的记录系统，或者坚持做过一件错一点就得重来的精确活儿？（记账、库存、待办、归档、实验记录、校对）',
    options: [
      { id: 'real', label: '有，用了一年以上，而且它救过我；对上的那一刻我是舒服的', delta: { interests: { C: 0.95 }, tolerance: { quantitative: 0.7 } } },
      { id: 'some', label: '记过一阵，后来断了', delta: { interests: { C: 0.55 } } },
      { id: 'tried', label: '试过很多方法，都坚持不下来', delta: { interests: { C: 0.25 } } },
      { id: 'chaos', label: '我生活很混乱，也觉得无所谓', delta: { interests: { C: 0.05 }, tolerance: { quantitative: 0.2 } } },
    ],
  },
  {
    id: 'e_money',
    section: 'evidence',
    kind: 'behavior',
    measuring: '把能力换成钱的主动性',
    prompt: '你有没有自己挣到过钱（不 counting 压岁钱和生活费）？',
    options: [
      { id: 'ongoing', label: '有稳定收入来源，哪怕很小', delta: { interests: { E: 0.8 }, values: { income: 0.9, autonomy: 0.6 } } },
      { id: 'once', label: '挣到过，一次性的（接单、卖东西、摆摊）', delta: { interests: { E: 0.6 }, values: { income: 0.7 } } },
      { id: 'none', label: '没有，但我在想怎么挣', delta: { values: { income: 0.5 } } },
      { id: 'dontcare', label: '没有，也基本没想过这件事', delta: { values: { income: 0.1 } } },
    ],
  },
  {
    id: 'e_emotion',
    section: 'evidence',
    kind: 'behavior',
    measuring: '承接他人情绪的成本',
    prompt: '身边人反复向你倾诉负面情绪时，你通常是？',
    help: '临床、心理、教育、社工、护理这些专业每天都在干这件事，且持续几十年。',
    options: [
      { id: 'hold', label: '我能接住，而且对方通常会好起来，我不太被消耗', delta: { interests: { S: 0.9 }, tolerance: { interpersonal: 0.9 } } },
      { id: 'help_but_tired', label: '会认真帮，但之后我很累，需要恢复', delta: { interests: { S: 0.7 }, tolerance: { interpersonal: 0.55 } } },
      { id: 'distract', label: '听着听着就想走神或找借口离开', delta: { interests: { S: 0.25 }, tolerance: { interpersonal: 0.25 } } },
      { id: 'irritated', label: '我会烦，觉得这是对方的问题', delta: { interests: { S: 0.05 }, tolerance: { interpersonal: 0.1 } } },
    ],
  },
  {
    id: 'e_code',
    section: 'evidence',
    kind: 'behavior',
    measuring: '编程的真实经历（不是想象）',
    prompt: '你自己写过代码吗？',
    help: '很多人喜欢的是「用代码做出来的东西」，不是「写代码」。这两者在大学里会分别折磨你两年。',
    options: [
      { id: 'own', label: '写过自己的东西，调试到半夜也继续，做出来那一刻很爽', delta: { tolerance: { programming: 0.95, abstraction: 0.7 }, interests: { I: 0.7 } } },
      { id: 'course', label: '上过课/自学过，能跑通作业，但不会主动写', delta: { tolerance: { programming: 0.55, abstraction: 0.45 } } },
      { id: 'tried_quit', label: '试过，卡在报错上就放弃了', delta: { tolerance: { programming: 0.2, abstraction: 0.3 } } },
      { id: 'hate', label: '没写过，也不想写', delta: { tolerance: { programming: 0.05, abstraction: 0.2 } } },
    ],
  },
  {
    id: 'e_grit',
    section: 'evidence',
    kind: 'behavior',
    measuring: '长周期投入的实际记录（不是决心）',
    prompt: '过去一年里，有没有一件事你每天或几乎每天都做、连续超过三个月？',
    options: [
      { id: 'several', label: '不止一件', delta: { grit: 0.95 } },
      { id: 'one', label: '有一件', delta: { grit: 0.75 } },
      { id: 'close', label: '有过，但中途断过几次', delta: { grit: 0.45 } },
      { id: 'none', label: '一件都没有', delta: { grit: 0.15 } },
    ],
    help: '这题不用美化。医学 5+3、建筑 5 年、博士 5 年，靠的是这个，不是热情。',
  },

  // ───────────────────────────── tolerance：各负载维度 ─────────────────────────────
  {
    id: 't_math',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '数学密度耐受',
    prompt: '高中数学里，哪一类你的真实状态是「虽然不轻松但我愿意跟它耗」？',
    help: '工科前两年是四门数学（高数、线代、概率、复变/场论），物理系是四门数学加四门物理。跟不动的话，绩点会一路压着你。',
    options: [
      { id: 'hard', label: '导数、圆锥曲线、数列压轴这类，我会主动找难题做', delta: { tolerance: { math: 0.95, abstraction: 0.7 } } },
      { id: 'ok', label: '中等题能拿分，压轴题放弃，但我不排斥继续学', delta: { tolerance: { math: 0.6, abstraction: 0.4 } } },
      { id: 'struggle', label: '基础题勉强，一看到复杂公式就想跳过', delta: { tolerance: { math: 0.25, abstraction: 0.2 } } },
      { id: 'hate', label: '数学是我高中最大的痛苦，我不想再碰它', delta: { tolerance: { math: 0.05, abstraction: 0.05 } } },
    ],
  },
  {
    id: 't_formula',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '数学课程的真实成绩单',
    prompt: '一门课每周四次推导课、作业二十道计算题、期末一张卷子定成绩——你高中里最像它的那门课，最后怎么样？',
    help: '大学里这种课不止一门，而保研和考研的线都是从绩点上过的。',
    options: [
      { id: 'often', label: '那就是我的优势科目，我做得比多数人快', delta: { tolerance: { math: 0.95 } } },
      { id: 'once', label: '一直中游，吃力但每次都过了', delta: { tolerance: { math: 0.65 } } },
      { id: 'give_up', label: '作业应付过，靠别科拉分才没被拖死', delta: { tolerance: { math: 0.3 } } },
      { id: 'never', label: '直接躺平，那门课我几乎是最低的一档', delta: { tolerance: { math: 0.1 } } },
    ],
  },
  {
    id: 't_proof',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '抽象理论与证明',
    prompt: '一个定理的推导你能看懂每一步，但整页全是符号，你的感受是？',
    options: [
      { id: 'enjoy', label: '看懂的那一下很爽，我会上瘾', delta: { tolerance: { abstraction: 0.95 }, theoryVsApplied: 0.7 } },
      { id: 'patient', label: '能耐心看完，就是谈不上喜欢', delta: { tolerance: { abstraction: 0.6 }, theoryVsApplied: 0.1 } },
      { id: 'skim', label: '会跳过去直接看结论和例题', delta: { tolerance: { abstraction: 0.3 }, theoryVsApplied: -0.5 } },
      { id: 'shutdown', label: '看两行就关了', delta: { tolerance: { abstraction: 0.08 }, theoryVsApplied: -0.7 } },
    ],
  },
  {
    id: 't_memorize',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '大体量记忆',
    prompt: '有没有一次，你背完了体量极大且需要长期记住的内容（超过 200 页的量）？',
    help: '医学是解剖、组胚、病理、药理内外妇儿十几本书，法学是整套部门法，都是一遍过不完就要滚第二遍的。',
    options: [
      { id: 'done', label: '有过，而且我有一套自己的记忆方法', delta: { tolerance: { memorization: 0.95 } } },
      { id: 'once_hard', label: '为了考试硬背过，很痛苦但我扛下来了', delta: { tolerance: { memorization: 0.6 } } },
      { id: 'short', label: '只能背短时间的量，长期记不住', delta: { tolerance: { memorization: 0.3 } } },
      { id: 'no', label: '完全不行，我一背就忘', delta: { tolerance: { memorization: 0.08 } } },
    ],
  },
  {
    id: 't_cram',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '反复回看旧内容的耐受',
    prompt: '背过的东西第二天忘了一半，得从头再滚一遍——这种循环你实际经历过几次，结果如何？',
    help: '文科法条、医学的书、语言的词汇都是滚第二遍第三遍，一遍过的人极少。',
    options: [
      { id: 'twice', label: '滚过三轮以上，最后记住了，我知道怎么让自己记住', delta: { tolerance: { memorization: 0.95 } } },
      { id: 'cram_ok', label: '考前滚过两遍，能及格，考完就忘', delta: { tolerance: { memorization: 0.6 } } },
      { id: 'cram_fail', label: '滚过，但越滚越乱，最后还是没记住', delta: { tolerance: { memorization: 0.3 } } },
      { id: 'avoid', label: '从没滚过第二遍，我受不了这种重复', delta: { tolerance: { memorization: 0.12 } } },
    ],
  },
  {
    id: 't_lab',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '实验与动手操作',
    prompt: '以下哪种劳动，你能接受它成为你未来三到四年的日常？',
    options: [
      { id: 'wet', label: '在实验室处理样品、养细胞、洗器皿，或闻到试剂味道也无所谓', delta: { tolerance: { lab: 0.9 }, interests: { R: 0.5 } } },
      { id: 'build', label: '在车间/工坊/机房做实物，一站几小时、手上沾油污', delta: { tolerance: { lab: 0.9 }, interests: { R: 0.85 } } },
      { id: 'desk', label: '桌面工作，电脑、图纸、书、数据', delta: { tolerance: { lab: 0.3 }, interests: { R: 0.15 } } },
      { id: 'none', label: '都不想，我更喜欢跟人说话', delta: { tolerance: { lab: 0.1 }, interests: { S: 0.6, E: 0.5 } } },
    ],
  },
  {
    id: 't_visual',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '图形表达与反复修改',
    prompt: '一张图/一个模型改到第十二版，还被告知要推翻，你的真实反应？',
    help: '建筑学和design类专业大学五年有一半时间是在改图和熬夜做模型。',
    options: [
      { id: 'ok', label: '我会继续改，我本来就会自己推翻重来', delta: { tolerance: { visual: 0.95 }, interests: { A: 0.8 } } },
      { id: 'tolerate', label: '能接受，但要有个明确的理由', delta: { tolerance: { visual: 0.6 }, interests: { A: 0.5 } } },
      { id: 'annoyed', label: '我会很烦，觉得对方在浪费我时间', delta: { tolerance: { visual: 0.25 } } },
      { id: 'no', label: '我不做图形类的东西，我连画图都讨厌', delta: { tolerance: { visual: 0.05 }, interests: { A: 0.15 } } },
    ],
  },
  {
    id: 't_write',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '高强度阅读与长文写作',
    prompt: '一周内读完 8 篇（或 300 页）不感兴趣的文献，再写出 6000 字自己的分析——',
    options: [
      { id: 'can', label: '我能做到，而且写得出来', delta: { tolerance: { writing: 0.95 } } },
      { id: 'with_effort', label: '咬咬牙能做，做完很累', delta: { tolerance: { writing: 0.55 } } },
      { id: 'partial', label: '读不完，只能挑重点读，写 6000 字很难', delta: { tolerance: { writing: 0.3 } } },
      { id: 'cannot', label: '做不到，我一读长文就走神', delta: { tolerance: { writing: 0.08 } } },
    ],
  },
  {
    id: 't_data',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '统计与数据分析',
    prompt: '给你一万行数据和一个问题，让你找规律并给出结论，你？',
    options: [
      { id: 'love', label: '这正是我喜欢干的事', delta: { tolerance: { quantitative: 0.95 }, interests: { I: 0.7, C: 0.6 } } },
      { id: 'fine', label: '能做完，需要工具帮我把计算部分吃掉', delta: { tolerance: { quantitative: 0.6 }, interests: { C: 0.5 } } },
      { id: 'boring', label: '能做但极其无聊，我不想干一辈子', delta: { tolerance: { quantitative: 0.3 } } },
      { id: 'no', label: '看到一堆数字就头疼', delta: { tolerance: { quantitative: 0.08 } } },
    ],
  },
  {
    id: 't_people_daily',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '每天高频面对陌生人',
    prompt: '连续每一天、一天几十次地面对陌生人的请求或情绪（门诊、柜台、课堂、客户会议），你的判断是？',
    options: [
      { id: 'energize', label: '我可以，见人让我更有劲', delta: { tolerance: { interpersonal: 0.95 } } },
      { id: 'manageable', label: '能做到，但每天下班需要独处恢复', delta: { tolerance: { interpersonal: 0.6 } } },
      { id: 'drain', label: '少量可以，多了我会崩溃', delta: { tolerance: { interpersonal: 0.3 } } },
      { id: 'impossible', label: '绝对不行，我要的是不需要一直说话的工作', delta: { tolerance: { interpersonal: 0.05 } } },
    ],
  },
  {
    id: 't_field',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '现场、外勤与非常规环境',
    prompt: '以下哪些工作环境你能常年接受？（这是长期状态，不是一次实习）',
    options: [
      { id: 'site', label: '工地、厂房、矿山、田间、野外勘测，风吹日晒', delta: { tolerance: { fieldwork: 0.95 }, interests: { R: 0.7 } } },
      { id: 'travel', label: '频繁出差跑客户或跑项目现场', delta: { tolerance: { fieldwork: 0.75 }, interests: { E: 0.6 } } },
      { id: 'hospital', label: '医院、学校、机关等固定场所，但要轮班或坐不住', delta: { tolerance: { fieldwork: 0.5, interpersonal: 0.6 } } },
      { id: 'office', label: '都要在室内，最好固定工位固定时间', delta: { tolerance: { fieldwork: 0.1 } } },
    ],
  },
  {
    id: 't_physical',
    section: 'tolerance',
    kind: 'behavior',
    measuring: '体力耐受',
    prompt: '连续几天做体力活：搬仪器、站着测量、下田、跟着手术台站到腿没知觉——',
    help: '土木、测绘、地质、农学、海洋、护理和外科都是这种日常，不是偶尔一次。',
    options: [
      { id: 'like', label: '这种活我愿意天天干，身体累了心不累', delta: { tolerance: { physical: 0.9 }, interests: { R: 0.7 } } },
      { id: 'endure', label: '能扛，需要钱或者需要学分的时候我会扛', delta: { tolerance: { physical: 0.6 } } },
      { id: 'break', label: '干一两天还行，长期我会垮', delta: { tolerance: { physical: 0.25 } } },
      { id: 'no', label: '完全不考虑，我体力差，也不想靠体力吃饭', delta: { tolerance: { physical: 0.08 } } },
    ],
  },

  // ───────────────────────────── tradeoff：forced-choice ─────────────────────────────
  {
    id: 'v_stable_income',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '稳定与收入只能选一个',
    prompt: '两个offer，只能选一个：',
    options: [
      { id: 'stable', label: '编制内或类编制，收入中等，几乎不会失业，天花板看得到', sub: '典型对应：师范、定向医学、烟草电网对口专业、公务员可报专业', delta: { values: { stability: 0.95, income: 0.3 } } },
      { id: 'high', label: '收入明显更高，但 35 岁以后不确定性很大', sub: '典型对应：计算机、金融、部分销售与乙方设计', delta: { values: { stability: 0.1, income: 0.95 } } },
    ],
  },
  {
    id: 'v_meaning_money',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '意义与钱只能选一个',
    prompt: '一份工作很被社会需要、你也觉得值得，但收入只能维持普通生活；另一份你没什么感觉，但收入能让全家生活水平明显提升。',
    options: [
      { id: 'meaning', label: '选被需要的那个', delta: { values: { meaning: 0.95, income: 0.2 } } },
      { id: 'money', label: '选让家里过得好的那个', delta: { values: { meaning: 0.15, income: 0.9 } } },
    ],
  },
  {
    id: 'v_prestige_free',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '声望与自主',
    prompt: '你更难受哪种？',
    options: [
      { id: 'unknown', label: '别人问你在做什么，你说出来时对方完全没反应', delta: { values: { prestige: 0.9, autonomy: 0.3 } } },
      { id: 'controlled', label: '职业听起来体面，但每天做什么完全由别人定', delta: { values: { autonomy: 0.95, prestige: 0.2 } } },
    ],
  },
  {
    id: 'v_delay',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '延迟兑现的意愿',
    prompt: 'A：本科毕业就能挣钱，但行业上限一般。B：要多花 5-8 年读书才能兑现，之后上限明显更高、更受尊重，但这几年你要一直靠家里。',
    options: [
      { id: 'a', label: '选 A，我要早点独立', delta: { constraints: { postgradIntent: 'no' }, values: { autonomy: 0.6 } } },
      { id: 'b', label: '选 B，前面积累我不在乎', delta: { constraints: { postgradIntent: 'yes' }, values: { prestige: 0.7, stability: 0.5 } } },
      { id: 'depends', label: '看具体是什么领域，说不准', delta: { constraints: { postgradIntent: 'undecided' } } },
    ],
  },
  {
    id: 'v_shrink',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '兴趣优先还是行情优先',
    prompt: '有一个方向你确实喜欢，但它所在行业这几年在收缩、招人变少、薪资下降。你？',
    options: [
      { id: 'follow', label: '还是选它，我喜欢，我会自己找路', delta: { values: { autonomy: 0.8, meaning: 0.7, stability: 0.15 }, grit: 0.7 } },
      { id: 'pragmatic', label: '不选，把喜欢留作爱好', delta: { values: { stability: 0.85, income: 0.7, meaning: 0.15 } } },
      { id: 'hedge', label: '选它，但同时准备第二条路（跨考、辅修、考公）', delta: { values: { stability: 0.55, autonomy: 0.5 } } },
    ],
  },
  {
    id: 'v_depth',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '深度专精还是跨界综合',
    prompt: '十年后你更可能因为什么被需要？',
    options: [
      { id: 'deep', label: '在很窄的一个问题上比 99% 的人懂', delta: { theoryVsApplied: 0.5, interests: { I: 0.8 } } },
      { id: 'broad', label: '懂好几块，能把不同的人和资源接到一起', delta: { interests: { E: 0.8, S: 0.6 } } },
    ],
  },
  {
    id: 'v_solved',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '兴趣：在规范内做对，还是自己定义问题',
    prompt: '你更愿意每天处理哪种问题？',
    options: [
      { id: 'defined', label: '有明确规范和正确答案，把它做到又快又不出错', delta: { interests: { C: 0.85 } } },
      { id: 'open', label: '问题本身要我自己定义，做成什么样没人能保证', delta: { interests: { A: 0.7, I: 0.7 } } },
    ],
  },
  {
    id: 'v_applied',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '偏理论还是偏落地',
    prompt: '学一个东西，让你更满足的是？',
    options: [
      { id: 'why', label: '搞明白它为什么成立，即使暂时没用处', delta: { theoryVsApplied: 0.9, interests: { I: 0.85 } } },
      { id: 'use', label: '立刻能用它做出一个真东西', delta: { theoryVsApplied: -0.9, interests: { R: 0.7 } } },
    ],
  },
  {
    id: 'v_family',
    section: 'tradeoff',
    kind: 'forced',
    measuring: '家庭意志与自我意志',
    prompt: '如果家里强烈反对你选的专业（他们出学费），你实际会？',
    help: '这条会直接影响推荐里「考公对口度」和「稳定」的权重。',
    options: [
      { id: 'obey', label: '听家里的', delta: { values: { stability: 0.85, autonomy: 0.05 } } },
      { id: 'argue', label: '争一次，争不赢就听', delta: { values: { stability: 0.6, autonomy: 0.35 } } },
      { id: 'own', label: '自己定，代价自己承担', delta: { values: { autonomy: 0.95, stability: 0.3 } } },
    ],
  },
];

export const ITEMS_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/**
 * 把浏览器里的旧存档按当前题库过滤。
 *
 * 题库会改（门类增删、选项改名、题目下线），而 localStorage 里的值不会跟着变。
 * 不过滤就会出现「进度条说这题答了，界面一个勾都没有」——
 * 用户看到的是系统吞掉了他的回答。
 */
export function pruneAnswers(raw: unknown): Answers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Answers = {};
  for (const [id, value] of Object.entries(raw)) {
    const item = ITEMS_BY_ID.get(id);
    if (!item) continue;

    const valid = new Set(item.options.map((o) => o.id));
    if (Array.isArray(value)) {
      const kept = value.filter((v): v is string => typeof v === 'string' && valid.has(v));
      // 题目声明了上限就按上限截断：越界的选科组合会造出现实中不存在的志愿组合
      const capped = item.kind === 'multi' && item.maxSelections ? kept.slice(0, item.maxSelections) : kept;
      if (item.kind === 'multi' && capped.length) out[id] = capped;
    } else if (typeof value === 'string' && valid.has(value) && item.kind !== 'multi') {
      out[id] = value;
    }
  }
  return out;
}
