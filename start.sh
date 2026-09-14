#!/bin/sh
# 一键启动 OpenCode Message Editor。支持从任意目录调用。
set -eu

if ! command -v node >/dev/null 2>&1; then
  printf '错误：未安装 Node.js，或 node 不在 PATH 中。请安装 Node.js 22 或更新版本后重试。\n' >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec node "$SCRIPT_DIR/scripts/start.mjs" "$@"
