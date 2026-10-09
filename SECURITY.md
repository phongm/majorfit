# 安全策略

这个项目的攻击面不在前端（推荐全部在浏览器本地算完，没有任何用户内容上传），而在自架的统计服务上。

## 怎么报

用 GitHub 的私密安全报告：**Security → Report a vulnerability**（[新建](https://github.com/phongm/majorfit/security/advisories/new)）。
 issue 会公开可见，漏洞也一样，所以别开 issue。

也可以提普通 issue 说一句「有安全问题，请开私密通道」，我会回你私密报告的入口。

## 值得报的几类

统计服务是可选组件，很多人部署时不会开。开了的话，下面这些是真问题：

| 面 | 该守住的性质 | 在哪 |
|---|---|---|
| `/api/events` | 公开写接口。限流（`RATE_PER_MIN`）与请求体上限必须生效，否则日志能被任何人灌满 | `server/index.ts`、`deploy/nginx.conf`、`worker/index.ts` |
| `/api/stats` | 未设 `STATS_TOKEN` 时应返回 503 而不是无鉴权返回数据 | `server/index.ts`、`worker/index.ts` |
| `TRUST_PROXY=1` | 开了之后 `X-Forwarded-For` 可被伪造，绕过限流。只有确实在可信反代后面才开 | `server/index.ts` |
| 上报字段 | 白名单校验，`sanitizeEvent` 之外的键必须被丢掉而不是落盘 | `src/analytics/events.ts` |
| 反馈正文 | 用户会自行写入姓名、学校、考号。日志备份到对象存储后即为个人数据处理范围 | `src/ui/Feedback.tsx`、`deploy/backup-logs.sh` |

## 不算漏洞的

- 推荐结果不准、专业判断有争议 —— 这是数据问题，走 issue。
- 用户能篡改自己浏览器里的本地答案 —— 本地计算的代价，本来就没有服务端权威状态可保护。
- 未鉴权地直接访问你的 `/api/stats`，如果你自己没设 `STATS_TOKEN` 或没限制来源 IP —— 这是部署配置，先看上面的表。

## 响应预期

非营利个人项目，我按能不能被真实利用排优先级，不承诺时限。确认后会致谢，除非你要求匿名。
