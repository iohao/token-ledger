#!/usr/bin/env bash
# ==============================================================================
# TokenLedger - Desktop App Packaging Script
#
# Packages the desktop application specifically for the current host machine
# as an unpacked app (e.g. TokenLedger.app on macOS) into the "release-app/" directory.
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
Packages the application (TokenLedger.app) directly into '${BOLD}release-app/${NC}'.

${BOLD}USAGE:${NC}
  bash scripts/package-app.sh [OPTIONS] [-- <electron-builder-args>]

${BOLD}OPTIONS:${NC}
  -c, --clean              Clean dist/, dist-electron/, and release-app/ before building
  -s, --skip-build         Skip frontend/electron compilation (tsc && vite build)
  --skip-test              Skip running unit tests
  --skip-typecheck         Skip TypeScript typecheck
  --sign                   Enable code signing discovery (disabled by default for fast local builds)
  -h, --help               Display this help text

${BOLD}EXAMPLES:${NC}
  # Default: package TokenLedger.app into release-app/
  bun run package:app
  bash scripts/package-app.sh

  # Clean build skipping tests
  bash scripts/package-app.sh --clean --skip-test"
}

# Configuration flags
CLEAN=false
SKIP_BUILD=false
SKIP_TEST=false
SKIP_TYPECHECK=false
ENABLE_SIGN=false

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
    --sign)
      ENABLE_SIGN=true
      shift
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
      # Pass any extra builder arguments directly
      EXTRA_BUILDER_ARGS+=("$1")
      shift
      ;;
  esac
done

START_TIME=$(date +%s)

# Step 0: Detect host platform & CPU architecture
OS_TYPE="$(uname -s)"
case "${OS_TYPE}" in
  Darwin)
    HOST_OS="macOS"
    PLATFORM_FLAG="--mac"
    ;;
  Linux)
    HOST_OS="Linux"
    PLATFORM_FLAG="--linux"
    ;;
  CYGWIN*|MINGW*|MSYS*|Windows_NT)
    HOST_OS="Windows"
    PLATFORM_FLAG="--win"
    ;;
  *)
    HOST_OS="Unknown (${OS_TYPE})"
    PLATFORM_FLAG="--dir"
    ;;
esac

ARCH_TYPE="$(uname -m)"
case "${ARCH_TYPE}" in
  arm64|aarch64)
    HOST_ARCH="arm64"
    ARCH_FLAG="--arm64"
    ;;
  x86_64|amd64|x64)
    HOST_ARCH="x64"
    ARCH_FLAG="--x64"
    ;;
  armv7l|armhf)
    HOST_ARCH="armv7l"
    ARCH_FLAG="--armv7l"
    ;;
  *)
    HOST_ARCH="${ARCH_TYPE}"
    ARCH_FLAG=""
    ;;
esac

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

# Disable signing auto-discovery for fast local builds unless explicitly enabled
if [[ "${ENABLE_SIGN}" == false && -z "${CSC_IDENTITY_AUTO_DISCOVERY:-}" && -z "${CSC_LINK:-}" && -z "${CSC_NAME:-}" ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

echo -e "${BOLD}======================================================${NC}"
echo -e "${BOLD}         TokenLedger Desktop App Packager             ${NC}"
echo -e "${BOLD}======================================================${NC}"
info "Host Platform   : ${HOST_OS} (${OS_TYPE})"
info "Host Arch       : ${HOST_ARCH} (${ARCH_TYPE})"
info "Target Flag     : ${PLATFORM_FLAG} ${ARCH_FLAG} --dir"
info "Package Manager : ${PM}"
info "Output Directory: ${PROJECT_ROOT}/release-app"

# Step 1: Clean build directories if requested
if [[ "${CLEAN}" == true ]]; then
  step "Step 1/5: Cleaning previous build outputs..."
  rm -rf "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}/dist-electron" "${PROJECT_ROOT}/release-app"
  success "Clean completed."
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

# Step 5: Package the desktop app for the current host machine (unpacked app only)
step "Step 5/5: Packaging desktop app for current machine..."
mkdir -p "${PROJECT_ROOT}/release-app"

BUILD_CMD=(
  ${ELECTRON_BUILDER}
  "${PLATFORM_FLAG}"
)

if [[ -n "${ARCH_FLAG}" ]]; then
  BUILD_CMD+=("${ARCH_FLAG}")
fi

BUILD_CMD+=(
  --dir
  --publish never
  -c.directories.output=release-app
)

if [[ ${#EXTRA_BUILDER_ARGS[@]} -gt 0 ]]; then
  BUILD_CMD+=("${EXTRA_BUILDER_ARGS[@]}")
fi

info "Executing: ${BUILD_CMD[*]}"
"${BUILD_CMD[@]}"

# Organize artifacts: Move TokenLedger.app to release-app/ directly and clean temp folders
step "Organizing release artifacts into release-app/..."
for mac_dir in "${PROJECT_ROOT}/release-app/mac" "${PROJECT_ROOT}/release-app/mac-arm64" "${PROJECT_ROOT}/release-app/mac-universal"; do
  if [[ -d "${mac_dir}/TokenLedger.app" ]]; then
    rm -rf "${PROJECT_ROOT}/release-app/TokenLedger.app"
    mv "${mac_dir}/TokenLedger.app" "${PROJECT_ROOT}/release-app/TokenLedger.app"
    rm -rf "${mac_dir}"
    break
  fi
done

# Clean up builder metadata / config files
rm -f "${PROJECT_ROOT}/release-app/builder-debug.yml" \
      "${PROJECT_ROOT}/release-app/builder-effective-config.yaml" \
      "${PROJECT_ROOT}/release-app/"*.blockmap \
      "${PROJECT_ROOT}/release-app/"*.yml \
      "${PROJECT_ROOT}/release-app/"*.yaml \
      "${PROJECT_ROOT}/release-app/"*.zip \
      "${PROJECT_ROOT}/release-app/"*.dmg

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}             Packaging Completed Successfully!         ${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
info "Total time elapsed: ${DURATION}s"
info "Artifact location : ${PROJECT_ROOT}/release-app/TokenLedger.app"

if [[ -d "${PROJECT_ROOT}/release-app" ]]; then
  echo -e "\n${BOLD}Generated in release-app/:${NC}"
  ls -ld "${PROJECT_ROOT}/release-app/TokenLedger.app" | awk '{printf "  %s\n", $9}'
fi

echo -e "\n${GREEN}Done!${NC}\n"
