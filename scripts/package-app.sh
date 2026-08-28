#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/release-app}"
SKIP_INSTALL=0
SKIP_TYPECHECK=0
OPEN_RESULT=0

usage() {
  cat <<'EOF'
Usage: scripts/package-app.sh [options]

Package the current project for the current platform and produce the runnable app artifact.

Options:
  --out-dir <path>      Override the output directory. Default: ./release-app
  --skip-install        Do not auto-run bun install when node_modules is missing
  --skip-typecheck      Skip bun run typecheck before packaging
  --open                Open the packaged app location after success (macOS only)
  --help                Show this help text

Environment:
  OUT_DIR               Same as --out-dir
EOF
}

log() {
  printf '[package-app] %s\n' "$1"
}

fail() {
  printf '[package-app] ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

platform_name() {
  case "$(uname -s)" in
    Darwin) printf 'darwin\n' ;;
    *)
      fail "This packaging script currently supports macOS only"
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir)
      [[ $# -ge 2 ]] || fail "--out-dir requires a path"
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-typecheck)
      SKIP_TYPECHECK=1
      shift
      ;;
    --open)
      OPEN_RESULT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

require_command bun

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  if [[ "$SKIP_INSTALL" -eq 1 ]]; then
    fail "node_modules is missing and --skip-install was set"
  fi

  log "node_modules is missing, running bun install"
  (cd "$ROOT_DIR" && bun install)
fi

if [[ "$SKIP_TYPECHECK" -eq 0 ]]; then
  log "Running typecheck"
  (cd "$ROOT_DIR" && bun run typecheck)
fi

log "Building frontend bundle and electron main/preload"
(cd "$ROOT_DIR" && bun run build)

log "Packaging desktop app with electron-builder"
mkdir -p "$OUT_DIR"
(cd "$ROOT_DIR" && ./node_modules/.bin/electron-builder --mac --dir -c.directories.output="$OUT_DIR")

log "Packaging completed successfully."

if [[ "$OPEN_RESULT" -eq 1 && "$(platform_name)" == "darwin" ]]; then
  open -R "$OUT_DIR/mac-arm64/TokenLedger.app" 2>/dev/null || open -R "$OUT_DIR/mac/TokenLedger.app" 2>/dev/null || open "$OUT_DIR"
fi
