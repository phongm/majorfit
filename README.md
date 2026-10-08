# 专业适配

不看你想成为谁，看你受得了哪种辛苦。

一个面向中国高中生的本科专业适配推荐系统。不同于多数测评用「你喜欢什么」来推荐专业，这套系统按三条规则工作：

1. **先问硬事实** — 选科组合、体检色觉、能接受的学制决定你能报什么
2. **问做过什么，不问觉得自己是什么** — 选项都是能拿出证据的事实
3. **兴趣几乎不加分，代价才是主变量** — 课程负载超出你能忍的程度最多扣 45 分，兴趣契合最多给 8 分

## 在线体验

https://majorfit.app（示例地址，请替换为实际部署地址）

## 技术栈

- **前端**: React 19 + TypeScript + Vite 7
- **统计服务**: Cloudflare Workers + D1 (SQLite)
- **部署**: GitHub Pages（前端）+ Cloudflare Worker（统计）
- **测试**: Vitest

## 本地开发

```bash
# 需要 Node.js 22+
nvm use 22
npm install
npm run dev        # 启动开发服务器 http://localhost:5173
npm test           # 运行测试
npm run build      # 构建生产版本
```

## 隐私设计

- 答题内容只存在浏览器本地，**不上传**
- 服务器只收到几个数字：有人打开了、有人开始答了、有人答完了、推荐了哪几个专业
- 会话号是随机 UUID，存 sessionStorage，关页面即失效
- 体检色觉、视力等敏感字段只参与本地计算，永不上传
- 上报字段白名单校验，答题内容在服务端数据结构里根本没有对应字段

## 部署

详见 [DEPLOY.md](./DEPLOY.md)，提供两种方案：

| | 方案一：自有服务器 | 方案二：Serverless |
|---|---|---|
| 成本 | VPS ~30-50 元/月 | 免费（额度内） |
| 运维 | 需要管理服务器 | 零运维 |
| 域名备案 | 需要 | 不需要 |
| 适用场景 | 面向大陆用户 | 快速上线、海外用户 |

## 项目结构

```
src/
├── analytics/       # 埋点客户端与事件定义
├── assessment/      # 题库与评分逻辑
├── data/            # 专业目录与画像数据
├── engine/          # 推荐引擎（过滤、排序、解释）
├── domain/          # 领域类型定义
├── ui/              # React 组件
└── wishlist/        # 自选清单管理

server/              # Node.js 统计服务（方案一）
worker/              # Cloudflare Worker 统计服务（方案二）
deploy/              # 部署配置（Nginx、systemd、备份脚本）
```

## License

MIT
