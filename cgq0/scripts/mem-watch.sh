#!/bin/sh
# mem-watch.sh — 采样 zcode-cli 进程内存（RSS + macOS phys_footprint），append 到日志。
# 用法: sh cgq0/scripts/mem-watch.sh <pid> [间隔秒，默认10]
# 下次 zcode-cli 变卡时立刻启动本脚本（进程别退），跑几分钟 Ctrl-C 停止即可。
set -u
pid="${1:?usage: mem-watch.sh <pid> [interval-sec]}"
interval="${2:-10}"
log="cgq0/tmp/mem-watch-${pid}.log"
echo "# ts iso rss_kb vsz_kb phys_footprint_kb" >> "$log"
while kill -0 "$pid" 2>/dev/null; do
  rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
  vsz=$(ps -o vsz= -p "$pid" 2>/dev/null | tr -d ' ')
  fp=""
  if command -v footprint >/dev/null 2>&1; then
    fp=$(footprint "$pid" 2>/dev/null | awk '/phys_footprint:/{gsub(",","",$2); print $2}' | head -1)
  fi
  echo "$(date +%s) $(date '+%F %T') rss=${rss:-?} vsz=${vsz:-?} fp=${fp:-?}" >> "$log"
  sleep "$interval"
done
echo "# process $pid exited" >> "$log"
