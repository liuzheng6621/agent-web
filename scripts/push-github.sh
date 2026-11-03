#!/usr/bin/env bash
# 把本仓库推到 GitHub（liuzheng6621/agent-web），并校验两端 sha 一致。
#
# 需要一个有 repo 权限的 Personal Access Token：
#   https://github.com/settings/tokens/new   （勾 repo 即可，fine-grained 也行）
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx ./scripts/push-github.sh
#
# 可选：
#   GITHUB_USER=liuzheng6621     默认值
#   GITHUB_REPO=agent-web        默认值
#   AW_GIT_SSLVERIFY=false       本机走 MITM 代理时用（证书链不完整）
#   PRIVATE=1                    建成私有仓库
#
# 幂等：仓库已存在就跳过创建，remote 已存在就改地址，重复跑不会出问题。

set -euo pipefail

GITHUB_USER="${GITHUB_USER:-liuzheng6621}"
GITHUB_REPO="${GITHUB_REPO:-agent-web}"
TOKEN="${GITHUB_TOKEN:-}"
SSLVERIFY="${AW_GIT_SSLVERIFY:-true}"
API="https://api.github.com"
CURL=(curl -sS)
GIT_OPTS=(-c "http.sslVerify=${SSLVERIFY}")

# 代理环境下 GitHub 的证书链常被拦，curl 也跟着关掉校验，否则第一步就失败。
if [ "$SSLVERIFY" = "false" ]; then
  CURL+=(-k)
fi

if [ -z "$TOKEN" ]; then
  cat >&2 <<'EOF'
缺少 GITHUB_TOKEN。

生成一个：https://github.com/settings/tokens/new （勾 repo）
然后：
  GITHUB_TOKEN=ghp_xxx ./scripts/push-github.sh

本机如果走代理、git 报 CRYPT_E_NO_REVOCATION_CHECK 或
"unable to get local issuer certificate"，加一个变量：
  AW_GIT_SSLVERIFY=false GITHUB_TOKEN=ghp_xxx ./scripts/push-github.sh
EOF
  exit 2
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "仓库：$ROOT"
echo "目标：https://github.com/$GITHUB_USER/$GITHUB_REPO"

# ---------------------------------------------------------------- 1. 建仓库
status=$("${CURL[@]}" -o /tmp/aw-repo.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/repos/$GITHUB_USER/$GITHUB_REPO")

if [ "$status" = "200" ]; then
  echo "仓库已存在，跳过创建"
elif [ "$status" = "404" ]; then
  private_flag=false
  [ "${PRIVATE:-0}" = "1" ] && private_flag=true
  echo "创建仓库（private=$private_flag）…"
  status=$("${CURL[@]}" -o /tmp/aw-repo.json -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$GITHUB_REPO\",\"description\":\"给 Agent 写机器可判的集成测试：一份案例，多个实现，判决必须一致。\",\"private\":$private_flag,\"has_issues\":true,\"has_wiki\":false}" \
    "$API/user/repos")
  if [ "$status" != "201" ]; then
    echo "创建失败（HTTP $status）：" >&2
    cat /tmp/aw-repo.json >&2
    exit 1
  fi
  echo "已创建"
else
  echo "查询仓库失败（HTTP $status）：" >&2
  cat /tmp/aw-repo.json >&2
  exit 1
fi

# ---------------------------------------------------------------- 2. 配 remote
URL="https://$GITHUB_USER:$TOKEN@github.com/$GITHUB_USER/$GITHUB_REPO.git"
CLEAN_URL="https://github.com/$GITHUB_USER/$GITHUB_REPO.git"

if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$CLEAN_URL"
  echo "remote github 已更新"
else
  git remote add github "$CLEAN_URL"
  echo "remote github 已添加"
fi

# token 只在这一条命令里出现，不落进 .git/config
# ---------------------------------------------------------------- 3. 推
echo "推送 main…"
git "${GIT_OPTS[@]}" -c "url.$URL.insteadOf=$CLEAN_URL" push -u github main

if git tag | grep -q .; then
  echo "推送 tags…"
  git "${GIT_OPTS[@]}" -c "url.$URL.insteadOf=$CLEAN_URL" push github --tags
fi

# ---------------------------------------------------------------- 4. 校验
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git "${GIT_OPTS[@]}" -c "url.$URL.insteadOf=$CLEAN_URL" ls-remote github refs/heads/main | cut -f1)"

echo
if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "两端一致：${LOCAL_SHA:0:7}"
  echo "https://github.com/$GITHUB_USER/$GITHUB_REPO"
else
  echo "sha 不一致，推送可能没生效：" >&2
  echo "  local  = $LOCAL_SHA" >&2
  echo "  remote = $REMOTE_SHA" >&2
  exit 1
fi
