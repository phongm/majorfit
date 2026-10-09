# 怎么参与

这个项目最需要的是**专业判断**，不是代码。67 条人工画像对着官方目录里的 988 个专业，覆盖不到 7%。
代码部分已经很稳（195 个测试），数据部分远没有。

先读一眼 [README 的设计前提](./README.md#为什么和多数测评不一样)，那三条规则是这套系统的全部差异所在，绕开它们的 PR 我没法合。

## 环境

```bash
npm ci
npm run dev         # http://localhost:5173
npm test            # vitest
npm run typecheck
npm run build       # tsc --noEmit && vite build
```

Node 22 足够跑前端与测试。**只有跑统计服务（`npm run stats`）需要 Node 23.6+**，因为 `server/index.ts` 直接以 TypeScript 运行，靠 Node 原生的类型剥离。

仓库里有两把锁：`package-lock.json` 给本地与 CI（npm），`pnpm-lock.yaml` 是 Cloudflare Pages 用来识别包管理器的（`6167e50` 迁移时特意加的）。**两把都要留着**，删掉任何一把都会让线上构建和本地装出不同的依赖树。用 pnpm 开发就 `pnpm install`，脚本和测试完全共用。

## 新增或修改一个专业画像

改 `src/data/majors/` 下对应门类的文件。构造器 `mk()` 在 `src/data/majors/_helpers.ts`。

**23 个字段是必填的**，包括 11 个负载维度全部给值。这不是形式主义：评分引擎把缺失当 0，
一个漏填 `memorization` 的高记忆量专业，会被静默推给完全背不动的学生。

`todo` 字段的语义要搞清：非空即 `quality.verified = false`，界面会照着承认「这条没核完」；
超过 3 条则置信度降为 `low`。**没查过的东西写进 `todo`，不要用默认值冒充结论**——
`costTier` 缺省是 `'public'`，它会参与硬过滤，所以 `mk()` 会替你补一条学费待核实的 `todo`。

`id` 必须是六位专业代码（可带 T/K 后缀），且与 `code` 一致。目录层只按 `id` 命中画像，
两者不一致就会有一条专业出现两个身份。

`category` 必须是 13 个学科门类之一。艺术类和体育学类走的是艺考、体考通道，`channelBlock`
（`src/domain/admission.ts`）会把它们置为 `recommendable: false`，不用你管，也别绕开这条规则。

写完跑：

```bash
npm test
```

数据门会当场拦下这些问题（`tests/data.test.ts`）：id 重复、`id` 与 `code` 不一致、负载维度越出
0..1、RIASEC 缺项、`honestDrawbacks` 为空、劝退条目短于 12 字（空值意味着没录，不是「这个专业没有缺点」）、
核心课少于 3 门、`gatekeeperCourses` 为空。

### 判断值怎么给

负载向量的 11 个维度：`math / programming / abstraction / memorization / lab / visual / writing / quantitative / interpersonal / fieldwork / physical`。

这些数字要和 `src/engine/rank.ts` 里的常量配套。`LOAD_K = 19.6`、`LOAD_EXPONENT = 1.7` 是照着现有分布标定的，
**批量挪动某一维会让惩罚曲线整体漂移**，所以改单条欢迎，改口径请先开 issue 说理由。

`honestDrawbacks` / `marketNote` / `clarification` / `idealFitNote` / `poorFitNote` 这几栏是这个项目的价值所在，
也是唯一有著作权的部分（课程列表接近事实，事实不受保护）。写的时候请具体到可以被反驳：

- 能用：「普通院校本科的校招出口明显低于名校，学历在这个行业的筛选作用强于多数工科」
- 不能用：「这个行业变化快，需要自己判断」——后者会被文案测试直接拦下

`incomeRealism` / `marketTrend` / `civilServiceFit` 这三个字段现在的依据最薄，全部挂着 `todo`。
你要是拿得出校招报告、国考职位表、薪酬数据这类真凭据，这是当前最高价值的贡献。

## 新增或修改题目

改 `src/assessment/items.ts`。设计约束只有一条：**问做过什么，不问觉得自己是什么**。

每题带 `measuring`（在测什么）和选项级 `delta`（这题把哪个向量推到哪里）。加题优先于改题干措辞——
如果一道题的两种读法给出相反答案，那是题型问题，不是文案问题。

题库只有 39 题（事实 8 / 行为证据 10 / 耐受 12 / 取舍 9），**加题请同时考虑删题**：
完单率是这里最在意指标，题数的边际收益在十几题之后就开始倒挂。

文案测试（`tests/wording.test.ts`）会拦：

- 英文术语没有中文解释
- 空断言式口水句（「真实存在」「值得想清楚」「因人而异」「行业行情变化快」等，删掉后读者决定不变的话）
- 中英夹杂填充词
- 界面文案泄漏内部题号或字段名（`f_subjects`、`postgradNecessity` 这类只能出现在代码里）
- 解释文字里引用选项原文时，必须逐字来自题库
- 用「同类」糊弄样本池口径（按类聚合和按门类聚合不是一回事）

## 提交与 PR

commit 用中文 Conventional Commits，带作用域，写清楚**为什么**：

```
fix(engine): 理论胃口那两句文案不再在同一张卡片上互相打脸
refactor(assessment): 停采两条不参与排序的方向轴，换成数学/记忆/体力的第二观测
```

PR 里请说明：改的是判断还是实现；判断的话，依据是什么。
我会看 diff 里的措辞有没有变成空话——数据可信度是逐条攒下来的，一条糊弄的话就少一分。

不要提的：加 UI 依赖、加埋点字段（隐私边界见 README，上报是白名单校验，服务端数据结构里没有存答题内容的字段）、
把兴趣权重调高（除非你能说明为什么代价错配比兴趣错配更容易纠正）。

## 不会合的 PR

- 增加自评特质题（「你觉得自己有毅力吗」）
- 用「AI 建议」批量生成的画像条目——没有依据来源的一律当没录
- 把服务端改成存答题内容
- 与 67 条画像以外的专业相关的**批量**推断改动（`src/data/profiles/derive.ts` 那层的聚合值没有资格进推荐，
  这是设计约束，不是待办）
