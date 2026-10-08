#!/usr/bin/env bash
# 把 7 天前的统计日志备份到腾讯云 COS，成功后从本地删除。
# crontab 示例（每天 03:40）：
#   40 3 * * * /opt/majorfit/deploy/backup-logs.sh >> /var/log/majorfit/backup.log 2>&1

set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/log/majorfit}"
BUCKET="${COS_BUCKET:-majorfit-logs}"
REGION="${COS_REGION:-ap-shanghai}"
KEEP_DAYS="${KEEP_DAYS:-7}"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "日志目录不存在：$LOG_DIR" >&2
  exit 1
fi

# 只处理 7 天前的文件，最近一周留在本地方便直接查
mapfile -t OLD < <(find "$LOG_DIR" -name 'events-*.jsonl' -mtime +"$KEEP_DAYS")

if [[ ${#OLD[@]} -eq 0 ]]; then
  echo "没有需要归档的日志"
  exit 0
fi

for f in "${OLD[@]}"; do
  name="$(basename "$f")"
  echo "归档 $name"

  # 二选一，另一个注释掉。上传成功后才删本地，避免传一半丢数据。

  # 方式 A：coscli（腾讯云官方命令行，需先 coscli config 配好密钥）
  coscli cp "$f" "cos://$BUCKET/events/$name" --region "$REGION"

  # 方式 B：rclone（先 rclone config 配一个名为 cos 的 remote）
  # rclone copy "$f" "cos:$BUCKET/events/"

  rm -f "$f"
done

echo "完成，归档 ${#OLD[@]} 个文件"
