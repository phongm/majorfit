# 可选：把反馈转发到飞书多维表格

## 为什么代码没直接写完

飞书写入需要你的应用凭证（`app_id` / `app_secret`）或多维表格的自定义机器人 webhook 地址。
我拿不到这些，就无法实测。把一段没跑通过的网络代码塞进上报主链路，
等于让「用户点提交」这件事依赖一个我没验证过的外部服务 —— 一旦它超时或返回非 200，
你会先发现的是「反馈收不到了」，而不是「转发配置错了」。

所以：**主链路只写本地日志，转发是旁路，默认关闭。**

## 接入点

`server/index.ts` 里 `appendEvent(event)` 成功之后加一段：

```ts
if (process.env.FEISHU_WEBHOOK && event.name === 'feedback') {
  // 异步、失败只记日志，绝不影响返回给浏览器的状态码
  void forwardToFeishu(event).catch((err) => console.error('[feishu] 转发失败', err));
}
```

`forwardToFeishu` 用 `fetch` POST 到你的多维表格自动化流程入口，
把 `helpful`、`reasons`、`comment`、`at` 四个字段带过去。

## 该转哪些数据

只转 `feedback` 事件。理由：

- 漏斗计数在 `/api/stats` 里已经能算，没必要每条都推；
- `comment` 是你真正需要**用人眼读**的东西，进表格比躺在 JSONL 里好处理；
- 转得越少，外部服务挂了的影响面越小。

## 多维表格建议的列

| 列名 | 类型 | 来源 |
| --- | --- | --- |
| 时间 | 日期 | `at` |
| 是否有帮助 | 单选 | `helpful`：有帮助 / 说不上 / 没帮助 |
| 问题类型 | 多选 | `reasons`，用 `REASON_LABELS` 的中文 |
| 原话 | 文本 | `comment` |
| 处理状态 | 单选 | 空 / 已看过 / 已改数据 —— 这列手工填，是你跟进的抓手 |

最后一列是这份表的价值所在：没有它，反馈收下来就再也不会被打开。
