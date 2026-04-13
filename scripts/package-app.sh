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

Package the current project for the current platform and copy the runnable app
artifact into a stable output directory.

Options:
  --out-dir <path>      Override the output directory. Default: ./release-app
  --skip-install        Do not auto-run npm install when node_modules is missing
  --skip-typecheck      Skip npm run typecheck before packaging
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

copy_artifact() {
  local source_path="$1"
  local target_path="$2"

  rm -rf "$target_path"

  if [[ -d "$source_path" ]]; then
    cp -R "$source_path" "$target_path"
  else
    cp "$source_path" "$target_path"
  fi
}

resolve_product_name() {
  (
    cd "$ROOT_DIR"
    node -p "JSON.parse(require('node:fs').readFileSync('src-tauri/tauri.conf.json','utf8')).productName"
  )
}

find_built_artifact() {
  local platform="$1"
  local product_name="$2"
  local bundle_root="$ROOT_DIR/src-tauri/target/release/bundle"

  case "$platform" in
    darwin)
      local app_path="$bundle_root/macos/$product_name.app"
      [[ -d "$app_path" ]] || fail "Expected macOS app not found at $app_path"
      printf '%s\n' "$app_path"
      ;;
    linux)
      local appimage_path
      appimage_path="$(find "$bundle_root" -type f -name '*.AppImage' | head -n 1 || true)"
      [[ -n "$appimage_path" ]] || fail "Expected Linux AppImage not found under $bundle_root"
      printf '%s\n' "$appimage_path"
      ;;
    *)
      fail "Unsupported platform: $platform"
      ;;
  esac
}

platform_name() {
  case "$(uname -s)" in
    Darwin) printf 'darwin\n' ;;
    Linux) printf 'linux\n' ;;
    *)
      fail "This packaging script currently supports macOS and Linux only"
      ;;
  esac
}

bundle_target() {
  case "$1" in
    darwin) printf 'app\n' ;;
    linux) printf 'appimage\n' ;;
    *)
      fail "Unsupported platform: $1"
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

require_command node
require_command npm
require_command cargo
require_command rustc

if [[ "$(platform_name)" == "darwin" ]]; then
  require_command xcodebuild
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  if [[ "$SKIP_INSTALL" -eq 1 ]]; then
    fail "node_modules is missing and --skip-install was set"
  fi

  log "node_modules is missing, running npm install"
  (cd "$ROOT_DIR" && npm install)
fi

if [[ "$SKIP_TYPECHECK" -eq 0 ]]; then
  log "Running typecheck"
  (cd "$ROOT_DIR" && npm run typecheck)
fi

log "Packaging desktop app with Tauri"
PLATFORM="$(platform_name)"
BUNDLE_TARGET="$(bundle_target "$PLATFORM")"
TAURI_CLI="$ROOT_DIR/node_modules/.bin/tauri"
[[ -x "$TAURI_CLI" ]] || fail "Missing local Tauri CLI at $TAURI_CLI"

(
  cd "$ROOT_DIR"
  "$TAURI_CLI" build --bundles "$BUNDLE_TARGET"
)

PRODUCT_NAME="$(resolve_product_name)"
ARTIFACT_SOURCE="$(find_built_artifact "$PLATFORM" "$PRODUCT_NAME")"

mkdir -p "$OUT_DIR"

case "$PLATFORM" in
  darwin)
    ARTIFACT_TARGET="$OUT_DIR/$PRODUCT_NAME.app"
    ;;
  linux)
    ARTIFACT_TARGET="$OUT_DIR/$(basename "$ARTIFACT_SOURCE")"
    ;;
esac

copy_artifact "$ARTIFACT_SOURCE" "$ARTIFACT_TARGET"

log "Packaged artifact copied to:"
printf '%s\n' "$ARTIFACT_TARGET"

if [[ "$OPEN_RESULT" -eq 1 ]]; then
  if [[ "$PLATFORM" == "darwin" ]]; then
    open -R "$ARTIFACT_TARGET"
  else
    log "--open is only supported on macOS; skipping"
  fi
fi
