# 部署方案

本项目提供两种部署方式：

- **方案一：自有服务器**（下文一至九节）—— Nginx + Node.js，适合有备案域名、需要完全控制数据的场景
- **方案二：Cloudflare Pages + Cloudflare Worker**（文末新增）—— 零服务器成本，适合快速上线、日活几千量级

---

目标机器：你自己的服务器（域名已备案）+ 腾讯云对象存储（COS）做日志备份。

## 一、要不要数据库：现在不要

这套系统在服务端只需要回答四个问题：今天多少人打开、多少人开始答、多少人答完、反馈里说有帮助的比例是多少。

这类数据的特征是**只追加、不改、不关联查询**。用追加写入的按天日志文件（JSONL）就够了：

| | 现在的方案（JSONL 日志） | 上数据库 |
| --- | --- | --- |
| 日活几千量级下查一次统计 | 全量扫 30 天，几十毫秒 | 毫秒级 |
| 运维负担 | 备份一个目录 | 实例、连接池、慢查询、迁移、权限 |
| 加字段 | 改代码，老数据自动按新规则解析 | 写迁移脚本 |
| 数据被写坏的风险 | 只追加，最坏是丢几行 | 误删表、锁、事务 |

**什么时候该换**：出现下面任一条，再把日志灌进 PostgreSQL，一周内能迁完。

1. 要做用户级回访（比如「半年后问你最终录了哪个专业」），需要保存可关联的答卷标识；
2. 反馈量大到需要按专业、按省份做多维交叉筛选；
3. 单日事件数超过几十万，全量扫描的耗时开始影响你打开统计页。

## 二、组成

```
浏览器（静态站点）  ──POST /api/events──►  统计服务（Node，127.0.0.1:8787）
        │                                        │
        └──GET /api/stats?token=…────────────────┘
                                                 ▼
                                        logs/events-YYYY-MM-DD.jsonl
                                                 │
                                                 ▼ 每日凌晨
                                        腾讯云 COS 备份
```

只有两个进程：Nginx 托管静态文件并反代 `/api`，Node 跑统计服务。

## 三、构建与发布

```bash
npm ci
npm run build          # 产物在 dist/，纯静态
```

把 `dist/` 同步到服务器（示例用 rsync）：

```bash
rsync -avz --delete dist/ user@your-server:/var/www/majorfit/
```

统计服务单独同步 `server/` 与 `src/analytics/`（它直接以 TypeScript 运行，由 Node 原生剥离类型，要求 **Node 23.6 以上**；建议 24 LTS 或更高）：

```bash
rsync -avz server/ src/analytics/ user@your-server:/opt/majorfit/
```

## 四、统计服务

用 systemd 托管，配置见 `deploy/majorfit-stats.service`。关键环境变量：

| 变量 | 说明 | 建议值 |
| --- | --- | --- |
| `PORT` | 监听端口 | `8787` |
| `BIND` | 监听地址 | 默认 `127.0.0.1`，只由 Nginx 反代对外；要公网监听必须自己加防火墙与口令 |
| `LOG_DIR` | 日志目录 | `/var/log/majorfit` |
| `STATS_TOKEN` | 查询统计的口令 | 自己生成一段长随机串。**不设这个变量，查询接口直接返回 503** |
| `RATE_PER_MIN` | 单 IP 每分钟上报上限 | `30` |
| `TRUST_PROXY` | 是否信任 Nginx 传来的真实 IP | Nginx 反代后面设 `1`，否则设 `0` |

`TRUST_PROXY` 这条别随手开：一旦为 1，任何人都能伪造 `X-Forwarded-For` 绕过限流，把日志灌满。

## 五、Nginx

见 `deploy/nginx.conf`。要点：

- `/api/events` 限流 + 限制请求体，公开写接口不设这两条迟早被刷；
- `/api/stats` 只允许你自己的 IP 访问，双保险（口令之外再加一层）；
- 静态资源长缓存，`index.html` 不缓存。

## 六、日志备份到 COS

见 `deploy/backup-logs.sh`。每天凌晨把 7 天前的日志传到 COS 后从本地删除，保持服务器磁盘占用可控。

用 `coscli`（腾讯云官方命令行）或 `rclone` 都可以，脚本里两种都给了写法，取消注释其中一个。

## 七、可选：把反馈转发到飞书多维表格

`deploy/feishu-forward.md` 说明了接入点和为什么我没有直接把代码写完：
它需要你的应用凭证，我拿不到就没法实测，而不实测就写进主链路是不负责任的。
按那份说明改十几行即可，且默认关闭。

## 八、看数据

```bash
curl -s "https://你的域名/api/stats?token=你的口令&days=14"
```

返回的字段含义：

- `totals.visits / starts / completes`：按会话去重后的访问、开始作答、完成人数；
- `totals.bounceRate`：打开却没开始答的比例，高说明首屏没讲清这是个什么东西；
- `totals.completionRate`：完单率，这是你最关心的那个指标；
- `totals.partialCompletes`：答完的人里有多少是没答全就出结果的，高说明题太长；
- `helpfulRate`：「有帮助」占比，选「说不上」的按半分计入；
- `reasons`：觉得不对的人勾选的具体原因，按次数排序；
- `recommended`：每个专业被推荐的次数，以及其中有多少来自「觉得没帮助」的会话。
- `picks`：用户自己挑进自选清单的专业被挑了几次、其中多少次没进推荐。
  这是比「我感兴趣的方向没出现」更精确的数据需求信号 —— 两个数都高的方向，就是下一个该录画像的专业类。
  内容只有专业目录代码（`sanitizeEvent` 收紧成 `^\d{6,7}(TK|T|K)?$`），不含专业名称之外的任何用户输入，也不含答题明细。
  这一列是唯一能告诉你**哪些专业的画像判断错了**的数据来源；
- `comments`：最近 50 条自愿填写的文字。

## 九、隐私边界（部署前确认一遍）

代码层面已经做到的：

1. 上报字段是白名单校验的，答题内容在服务端数据结构里根本没有对应字段，不是「我们承诺不存」而是「存不进去」；
2. 会话号是随机 UUID，存 sessionStorage，关页面即失效，不落 cookie、不做设备指纹；
3. 体检色觉、视力这类敏感字段只参与本地计算，永不上传；
4. 反馈正文有 500 字上限，界面上明确提示不要写姓名学校考号。

需要你自己确认的：

- 网站页脚是否需要挂隐私政策与备案编号（面向中国大陆公开服务通常要）；
- `comments` 里用户可能自行写入个人信息，日志备份到 COS 后属于你的存储范围，需要设定保留期限并支持删除请求。

---

## 方案二：Cloudflare Pages + Cloudflare Worker（零服务器）

完全免费（在额度内），无需维护服务器。**本仓库线上用的就是这一套。**

```
Cloudflare Pages (静态站点)  ──POST https://worker/api/events──►  Cloudflare Worker
         │                                                              │
         └──GET https://worker/api/stats?token=…────────────────────────┘
                                                                        ▼
                                                               Cloudflare D1 (SQLite)
```

### 架构说明

| 组件 | 服务 | 免费额度 |
|------|------|----------|
| 前端托管 | Cloudflare Pages | 无限带宽、500 次构建/月 |
| 统计服务 | Cloudflare Workers | 10 万次请求/天 |
| 数据存储 | Cloudflare D1 (SQLite) | 5GB 存储、50 亿行读取/天 |

日活几千完全够用。

### 前置条件

1. 一个 GitHub 账号
2. 一个 Cloudflare 账号（免费注册）
3. 安装 [wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：`npm install -g wrangler`
4. 登录 Cloudflare：`wrangler login`

### 步骤一：创建 D1 数据库

```bash
cd worker
wrangler d1 create majorfit-events
```

输出会显示一个 `database_id`，把它填入 `worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "majorfit-events"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # 填入这里
```

然后初始化表结构：

```bash
wrangler d1 execute majorfit-events --file=schema.sql
```

### 步骤二：设置 STATS_TOKEN

生成一个随机口令：

```bash
openssl rand -hex 24
```

设置为 Worker 的 secret：

```bash
echo "你生成的口令" | wrangler secret put STATS_TOKEN
```

### 步骤三：部署 Worker

```bash
cd worker
wrangler deploy
```

部署成功后会显示 Worker URL，格式如：
`https://majorfit-stats.your-subdomain.workers.dev`

测试健康检查：

```bash
curl https://majorfit-stats.your-subdomain.workers.dev/api/health
# 应返回 {"ok":true}
```

测试统计查询：

```bash
curl "https://majorfit-stats.your-subdomain.workers.dev/api/stats?token=你的口令&days=7"
```

### 步骤四：配置前端 API 地址

编辑 `public/config.js`，填入 Worker URL：

```javascript
window.__MAJORFIT_CONFIG__ = {
  statsEndpoint: 'https://majorfit-stats.your-subdomain.workers.dev/api/events',
};
```

### 步骤五：连接 Cloudflare Pages

1. Cloudflare 控制台 → Workers & Pages → Create application → **Pages** → Connect to Git，选本仓库
2. Build settings：

| 项 | 值 |
|---|---|
| Production branch | `main` |
| Build command | `npm run build`（用 pnpm 就写 `pnpm run build`） |
| Build output directory | `dist` |

3. 保存后首次构建，之后每次推 main 自动重新构建。**这一步不经过 GitHub Actions**，仓库里没有发布 workflow。

包管理器由 lockfile 自动识别，仓库里同时有 `package-lock.json` 和 `pnpm-lock.yaml` 时 Pages 会选 **pnpm**。
`pnpm-lock.yaml` 是 `6167e50` 迁移到 Cloudflare Pages 时特意加进来的，别顺手删——删掉构建管线会静默切到 npm，
线上和本地装出的依赖树就不再是同一套了。

base path 规则（`vite.config.ts` 读 `VITE_BASE_PATH`，缺省 `/`）：

| 访问方式 | 需要设置 |
|---|---|
| 独立域名或子域名根路径（`majorfit.你的域名.com`） | 不设置，保持 `/` |
| 挂在某条路径下（`你的域名.com/majorfit`） | 构建时 `VITE_BASE_PATH=/majorfit/` |

环境变量在 Pages 项目的 Settings → Environment variables 里加，不要在 GitHub 那边配。

> **线上现状**：`public/config.js` 的 `statsEndpoint` 是空值，而 `worker/wrangler.toml` 里 `database_id` 还是注释掉的占位——
> Worker 从没部署过。空值意味着前端上报走同源 `/api/events`，Pages 不执行任何后端，
> 所以**统计目前一个都收不到**。前端功能不受影响，推荐全部在浏览器本地算完。
> 要收数据就回到步骤一到步骤三把 D1 和 Worker 建起来，再把 URL 填进 `public/config.js` 重新构建。

### 步骤六：配置 GitHub Secrets（可选：用 Actions 部署 Worker）

仓库里没有发布 workflow（`6167e50` 删掉了原先推 `gh-pages` 的 `deploy.yml`）。
如果想自己补一条自动部署 Worker 的 workflow，需要这些：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，需要 `Workers Scripts:Edit` 和 `D1:Edit` 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID，在控制台首页右侧 |
| `STATS_TOKEN` | 统计查询口令 |

### 部署流程

推送代码到 main 分支后：

1. **前端**：Cloudflare Pages 检测到 push 后自动构建部署（平台侧触发）
2. **Worker**：不会自动部署，改完在 `worker/` 目录跑 `wrangler deploy`
3. **GitHub Actions**：只跑 typecheck、测试、构建（`.github/workflows/ci.yml`），不发布任何东西

> **GitHub Pages 已停用**：构建方式是 `workflow`，而仓库里没有发布 workflow，所以推 main 不会再触发 Pages 发布。
> 前端只由 Cloudflare Pages 从 `main` 构建。这条写在这里是为了防止有人误把 GitHub Pages 重新打开——
> 它与本方案共存会让同一个站在两处构建，而 `main` 根目录里的 `index.html` 是 Vite 开发入口，直接发布出去是白屏。
> 老的 `github.io` 地址上残留的页面不会自己消失，需要在仓库 Settings → Pages 里 Unpublish（REST API 删不掉，GitHub 返回 422）。
> 原来的 `gh-pages` 分支带着 GitHub Pages 时代的 `CNAME`，已经删除。

### 自定义域名（可选）

**Pages**：Pages 项目 → Custom domains → 填 `majorfit.你的域名.com`。域名托管在 Cloudflare 的，按提示加 CNAME 指向 `<项目>.pages.dev`；
域名不在 Cloudflare 也能用，在自己的 DNS 建同样的 CNAME，回 Pages 点验证。

**Cloudflare Worker**：在 Cloudflare 控制台 → Workers → 你的 Worker → Triggers → Add，绑定自定义路由或域名。

### 与方案一的对比

| | 方案一：自有服务器 | 方案二：Serverless |
|---|---|---|
| 成本 | VPS ~30-50 元/月 | 免费（额度内） |
| 运维 | 需要管理服务器、Nginx、systemd | 零运维 |
| 域名备案 | 需要（大陆服务） | 不需要（境外节点） |
| 数据控制 | 完全控制，日志在本地 | 数据在 Cloudflare |
| 访问速度 | 取决于服务器位置 | 全球 CDN，大陆速度看节点与网络 |
| 扩展性 | 受限于单机配置 | 自动扩展 |
| 适用场景 | 面向大陆用户、需要备案 | 快速上线、海外用户、内部使用 |
