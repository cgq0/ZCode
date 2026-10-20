#!/usr/bin/env sh
# ai-commit.sh — commit with an X-AI attribution trailer, in ONE step, no git hooks.
#
# 为什么是包装器而不是 hook（决策见 cgq0/README.md）：上游 husky 独占 core.hooksPath
# 且每次 `pnpm install` 都会重置；往 .husky/ 加文件会污染上游文件树。本脚本把
# 既有 ai-attribution + prepare-commit-msg 两段机制收进一次调用：
# 解析身份 → 组装带 trailer 的消息 → git commit → 回读校验。
#
# Usage:
#   cgq0/scripts/ai-commit.sh -F <消息文件> [其他 git commit 参数...]
#   cgq0/scripts/ai-commit.sh -m "标题" [更多 -m 段落...] [其他参数...]
#   cgq0/scripts/ai-commit.sh --amend -F <消息文件>
#
# 身份解析（优先级从高到低，显式传入可覆盖，例如非 pi harness 时）：
#   MODEL   : $MODEL   → $PI_MODEL
#   HARNESS : $HARNESS → "pi"（当 $PI_CODING_AGENT 已设置）
#   VERSION : $VERSION → $(pi --version) → $PI_VERSION
#
# Trailer 格式：`X-AI: <model> @ <harness>/<version>`
#   - merge commit（MERGE_HEAD 存在）不署名：合流是管道操作，不进 AI 占比统计（沿袭 2026-09-19 决策）
#   - 消息里已有 X-AI:（amend、cherry-pick 重放）不重复追加
#   - 身份解析不出非 human 值 → 拒绝提交（退出码 2），宁可失败不可错标
#
# Exit codes: 2 = 身份不全（未提交）；其他沿用 git commit 的退出码。

set -eu

gd="$(git rev-parse --git-dir)"

# ── merge commit：直接透传，不署名 ──────────────────────────────────────────
if [ -f "$gd/MERGE_HEAD" ]; then
  echo "ai-commit: merge in progress — committing without X-AI trailer (per cgq0/README.md decision)."
  exec git commit "$@"
fi

# ── 身份解析 ────────────────────────────────────────────────────────────────
model="${MODEL:-${PI_MODEL:-}}"
harness="${HARNESS:-}"
if [ -z "$harness" ] && [ -n "${PI_CODING_AGENT:-}" ]; then
  harness="pi"
fi
version="${VERSION:-${PI_VERSION:-}}"
if [ -z "$version" ] && command -v pi >/dev/null 2>&1; then
  version="$(pi --version 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$model" ] || [ -z "$harness" ] || [ -z "$version" ] || [ "$model" = "human" ]; then
  echo "ai-commit: cannot determine MODEL/HARNESS/VERSION — refusing to commit unattributed." >&2
  echo "  set them explicitly, e.g.:" >&2
  echo "  MODEL=glm-5.3-flash HARNESS=pi VERSION=1.3.0 cgq0/scripts/ai-commit.sh -F msg.txt" >&2
  exit 2
fi
case "$model$harness$version" in
  *"<"*) echo "ai-commit: placeholder value in identity (<...>), refusing." >&2; exit 2 ;;
esac

trailer="X-AI: ${model} @ ${harness}/${version}"

# ── 组装消息：把 -F/-m 替换成带 trailer 的临时文件 ──────────────────────────
tmp="$(mktemp "$gd/ai-commit-msg.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

append_trailer() {
  # $1 = 源消息文件。已署名则原样返回（amend / cherry-pick 重放场景）。
  if grep -q '^X-AI:' "$1"; then
    cp "$1" "$tmp"
    return
  fi
  cp "$1" "$tmp"
  # 保证 trailer 是独立段落：消息不以空行结尾就补一个，再追加 trailer 行。
  [ "$(tail -n 1 "$tmp" | wc -l)" -eq 1 ] && [ -n "$(tail -n 1 "$tmp")" ] && printf '\n' >> "$tmp"
  printf '%s\n' "$trailer" >> "$tmp"
}

newargv=""
body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -F|--file)
      [ $# -ge 2 ] || { echo "ai-commit: $1 needs a value" >&2; exit 2; }
      append_trailer "$2"
      newargv="$newargv -F \$tmp"
      shift 2
      ;;
    -F=*|--file=*)
      append_trailer "${1#*=}"
      newargv="$newargv -F \$tmp"
      shift
      ;;
    -m|--message)
      [ $# -ge 2 ] || { echo "ai-commit: $1 needs a value" >&2; exit 2; }
      [ -n "$body" ] && body="$body
"
      body="$body$2"
      shift 2
      ;;
    -m=*|--message=*)
      [ -n "$body" ] && body="$body
"
      body="$body${1#*=}"
      shift
      ;;
    *)
      # shellcheck disable=SC2086 位置参数原样透传（--amend、路径限定的 git add 已由调用方完成等）
      newargv="$newargv \"$1\""
      shift
      ;;
  esac
done

if [ -n "$body" ]; then
  printf '%s\n' "$body" > "$tmp.body"
  append_trailer "$tmp.body"
  rm -f "$tmp.body"
  newargv="$newargv -F \$tmp"
fi

if [ -z "$newargv" ]; then
  echo "ai-commit: no -F/-m message given — refusing (use -F <file> or -m <msg>)." >&2
  exit 2
fi

# ── 提交 + 回读校验（错标在这里就可见，不用等事后翻 log）────────────────────
eval "git commit $newargv"

echo "ai-commit: $(git log -1 --format='%h %s | %(trailers:key=X-AI)')"
