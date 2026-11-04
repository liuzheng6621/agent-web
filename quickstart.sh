#!/usr/bin/env bash
# 一键：给一个网址，看看这台站点能被测成什么样。
#
#   ./quickstart.sh http://127.0.0.1:8080
#
# 它做的事：探测接口 → 生成一个只读适配器 → 把只读接口真的打一遍 → 生成草稿案例。
# 它不做的事：猜你的写操作该保证什么（那需要你告诉它）。
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "用法：./quickstart.sh <网址>       例：./quickstart.sh http://127.0.0.1:8080"
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没找到 node。这个项目只依赖 Node 20 以上，不装任何第三方包。"
  exit 2
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "node 版本是 $(node -v)，需要 20 以上。"
  exit 2
fi

OUT="./agent-web-site"
echo "目标：$URL"
echo "输出：$OUT"
echo

node bin/agent-web.mjs discover "$URL" --out="$OUT" --run --detail
STATUS=$?

echo
if [ -d "$OUT/cases" ]; then
  echo "接下来三步："
  echo "  1. 看一眼生成的适配器和案例（生成的东西都标了 inferred，别当事实）"
  echo "       ls $OUT/cases"
  echo "  2. 确认案例（不确认不出判决）"
  echo "       node bin/agent-web.mjs accept $OUT/cases/<某个>.json --by=<你的名字>"
  echo "  3. 跑判决"
  echo "       node bin/agent-web.mjs verify $OUT/cases --adapter=$OUT/adapter.mjs"
fi

exit $STATUS
