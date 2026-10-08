-- 事件表：存储所有上报的统计事件
-- D1 是 Cloudflare 的 SQLite 数据库，免费额度 5GB
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sid TEXT NOT NULL,
  at TEXT NOT NULL,
  payload TEXT NOT NULL
);

-- 按日期查询的索引，stats 接口按 at 范围查询
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);

-- 按会话查询的索引（可选，用于调试）
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid);
