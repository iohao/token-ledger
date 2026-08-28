#!/usr/bin/env bash
# ==============================================================================
# TokenLedger - Desktop App Packaging Script
#
# Builds frontend & Electron assets and packages the app for distribution.
# ==============================================================================

set -euo pipefail

# Ensure script runs from the repository root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Color codes for formatted terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper logging functions
info() {
  echo -e "${BLUE}${BOLD}[INFO]${NC} $*"
}

step() {
  echo -e "\n${CYAN}${BOLD}==>${NC} ${BOLD}$*${NC}"
}

success() {
  echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $*"
}

warn() {
  echo -e "${YELLOW}${BOLD}[WARN]${NC} $*"
}

error() {
  echo -e "${RED}${BOLD}[ERROR]${NC} $*" >&2
}

# Display help information
show_help() {
  echo -e "${BOLD}TokenLedger Desktop App Packaging Tool${NC}

${BOLD}USAGE:${NC}
  bash scripts/package-app.sh [OPTIONS] [-- <electron-builder-args>]

${BOLD}OPTIONS:${NC}
  -m, --mac, --macos       Package for macOS (.dmg, .zip)
  -w, --win, --windows     Package for Windows (.exe NSIS, .zip)
  -l, --linux              Package for Linux
  -a, --all                Package for all supported platforms (macOS, Windows)
  -d, --dir                Build unpacked directory (fast local preview)
  --x64                    Build for x64 architecture
  --arm64                  Build for arm64 architecture
  --universal              Build universal binary (macOS)
  -c, --clean              Clean dist/, dist-electron/, and release-app/ before building
  -s, --skip-build         Skip frontend/electron compile (tsc && vite build)
  --skip-test              Skip running unit tests
  --skip-typecheck         Skip TypeScript typecheck
  --no-sign                Disable code signing discovery (faster local macOS builds)
  --publish <mode>         Set publish mode (default: never)
  -h, --help               Display this help text

${BOLD}EXAMPLES:${NC}
  # Default: auto-detect current platform, run checks, build, and package
  bun run package:app
  bash scripts/package-app.sh

  # Package for macOS (DMG & ZIP)
  bash scripts/package-app.sh --mac

  # Package for Windows (NSIS & ZIP)
  bash scripts/package-app.sh --win

  # Fast local unpacked build (no installer compression)
  bash scripts/package-app.sh --dir

  # Clean build skipping tests
  bash scripts/package-app.sh --clean --skip-test"
}

# Configuration flags
CLEAN=false
SKIP_BUILD=false
SKIP_TEST=false
SKIP_TYPECHECK=false
NO_SIGN=false
PUBLISH_MODE="never"

TARGET_FLAGS=()
EXTRA_BUILDER_ARGS=()

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    -c|--clean)
      CLEAN=true
      shift
      ;;
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-test)
      SKIP_TEST=true
      shift
      ;;
    --skip-typecheck)
      SKIP_TYPECHECK=true
      shift
      ;;
    --no-sign)
      NO_SIGN=true
      shift
      ;;
    -m|--mac|--macos)
      TARGET_FLAGS+=("--mac")
      shift
      ;;
    -w|--win|--windows)
      TARGET_FLAGS+=("--win")
      shift
      ;;
    -l|--linux)
      TARGET_FLAGS+=("--linux")
      shift
      ;;
    -a|--all)
      TARGET_FLAGS+=("--mac" "--win")
      shift
      ;;
    -d|--dir)
      TARGET_FLAGS+=("--dir")
      shift
      ;;
    --x64|--arm64|--universal)
      TARGET_FLAGS+=("$1")
      shift
      ;;
    --publish)
      if [[ -n "${2:-}" ]]; then
        PUBLISH_MODE="$2"
        shift 2
      else
        error "Option --publish requires an argument (onTag|onTagOrDraft|always|never)"
        exit 1
      fi
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        EXTRA_BUILDER_ARGS+=("$1")
        shift
      done
      break
      ;;
    *)
      # Pass unknown arguments directly to electron-builder
      EXTRA_BUILDER_ARGS+=("$1")
      shift
      ;;
  esac
done

START_TIME=$(date +%s)

# Auto-detect default target platform if none specified
if [[ ${#TARGET_FLAGS[@]} -eq 0 ]]; then
  OS_TYPE="$(uname -s)"
  case "${OS_TYPE}" in
    Darwin)
      info "Host platform detected: macOS (Darwin)"
      TARGET_FLAGS+=("--mac")
      ;;
    Linux)
      info "Host platform detected: Linux"
      TARGET_FLAGS+=("--linux")
      ;;
    CYGWIN*|MINGW*|MSYS*|Windows_NT)
      info "Host platform detected: Windows"
      TARGET_FLAGS+=("--win")
      ;;
    *)
      warn "Unknown host platform '${OS_TYPE}', defaulting to --dir"
      TARGET_FLAGS+=("--dir")
      ;;
  esac
fi

# Detect package manager (bun preferred)
if command -v bun >/dev/null 2>&1; then
  PM="bun"
  RUN_CMD="bun run"
  TEST_CMD="bun test"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
  RUN_CMD="npm run"
  TEST_CMD="npm test"
else
  error "Neither 'bun' nor 'npm' was found in PATH. Please install Bun (>=1.0) or Node.js."
  exit 1
fi

# Locate electron-builder executable
if [[ -x "${PROJECT_ROOT}/node_modules/.bin/electron-builder" ]]; then
  ELECTRON_BUILDER="${PROJECT_ROOT}/node_modules/.bin/electron-builder"
elif command -v bunx >/dev/null 2>&1; then
  ELECTRON_BUILDER="bunx electron-builder"
elif command -v npx >/dev/null 2>&1; then
  ELECTRON_BUILDER="npx electron-builder"
else
  ELECTRON_BUILDER="electron-builder"
fi

# Handle code signing override if requested
if [[ "${NO_SIGN}" == true ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  info "Code signing identity discovery disabled (--no-sign)"
fi

echo -e "${BOLD}======================================================${NC}"
echo -e "${BOLD}         TokenLedger Desktop App Packager             ${NC}"
echo -e "${BOLD}======================================================${NC}"
info "Package Manager : ${PM}"
info "Target Flags    : ${TARGET_FLAGS[*]}"
info "Publish Mode    : ${PUBLISH_MODE}"
info "Output Directory: ${PROJECT_ROOT}/release-app"

# Step 1: Clean build directories if requested
if [[ "${CLEAN}" == true ]]; then
  step "Step 1/5: Cleaning build outputs..."
  rm -rf "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}/dist-electron" "${PROJECT_ROOT}/release-app"
  success "Clean completed."
else
  info "Skipping clean (use --clean or -c to clean previous builds)"
fi

# Step 2: Ensure node_modules dependencies are installed
if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
  step "Step 2/5: Installing dependencies (${PM})..."
  if [[ "${PM}" == "bun" ]]; then
    bun install
  else
    npm install
  fi
  success "Dependencies installed."
else
  info "Dependencies already present in node_modules."
fi

# Step 3: Typecheck & Tests
if [[ "${SKIP_BUILD}" == false ]]; then
  if [[ "${SKIP_TYPECHECK}" == false ]]; then
    step "Step 3a/5: Running TypeScript typecheck..."
    ${RUN_CMD} typecheck
    success "Typecheck passed."
  else
    info "Skipping typecheck (--skip-typecheck)"
  fi

  if [[ "${SKIP_TEST}" == false ]]; then
    step "Step 3b/5: Running unit tests..."
    ${TEST_CMD}
    success "All tests passed."
  else
    info "Skipping unit tests (--skip-test)"
  fi

  # Step 4: Build frontend and electron main/preload bundles
  step "Step 4/5: Building frontend & Electron bundle..."
  ${RUN_CMD} build
  success "Build artifacts generated in dist/ and dist-electron/."
else
  info "Skipping build steps (--skip-build)"
fi

# Step 5: Package the desktop app with electron-builder
step "Step 5/5: Packaging desktop app with electron-builder..."
mkdir -p "${PROJECT_ROOT}/release-app"

BUILD_CMD=(
  ${ELECTRON_BUILDER}
  "${TARGET_FLAGS[@]}"
  --publish "${PUBLISH_MODE}"
)

if [[ ${#EXTRA_BUILDER_ARGS[@]} -gt 0 ]]; then
  BUILD_CMD+=("${EXTRA_BUILDER_ARGS[@]}")
fi

info "Executing: ${BUILD_CMD[*]}"
"${BUILD_CMD[@]}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}             Packaging Completed Successfully!         ${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
info "Total time elapsed: ${DURATION}s"
info "Artifacts generated in: ${PROJECT_ROOT}/release-app/"

if [[ -d "${PROJECT_ROOT}/release-app" ]]; then
  echo -e "\n${BOLD}Generated Packages:${NC}"
  ls -lh "${PROJECT_ROOT}/release-app" | awk 'NR>1 {printf "  %-10s %s\n", $5, $9}'
fi

echo -e "\n${GREEN}Done!${NC}\n"
