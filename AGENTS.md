# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the Vite + TypeScript desktop UI. Keep Tauri bridge calls in `src/api/`, shared DTOs in `src/dto/`, and UI/i18n logic close to `src/main.ts` and `src/i18n.ts`. Rust backend code lives in `src-tauri/src/` with modules such as `commands.rs`, `repository.rs`, `parser.rs`, and `store.rs`. User-facing docs are in `docs/howto/`; build and packaging helpers live in `scripts/`. Generated output in `dist/`, `release-app/`, `src-tauri/target/`, and `src-tauri/gen/` should not be committed.

## Build, Test, and Development Commands

Use Node `>=25` and a stable Rust toolchain.

- `npm ci`: install frontend and Tauri CLI dependencies.
- `npm run dev`: run the Vite frontend only.
- `npm run desktop -- dev`: launch the full desktop app in Tauri dev mode.
- `npm run typecheck`: run the frontend TypeScript check used in CI.
- `cd src-tauri && cargo test`: run the Rust test suite.
- `npm run build`: compile TypeScript and produce the frontend bundle.
- `npm run package:app`: package the current platform app into `release-app/`.

## Coding Style & Naming Conventions

Match the existing file style instead of reformatting unrelated code. TypeScript uses ES modules, `camelCase` for variables/functions, and `PascalCase` for DTO and type names. Source files under `src/` use 2-space indentation. Rust follows standard `rustfmt` layout, `snake_case` for modules/functions, and focused modules rather than large mixed files. No dedicated ESLint or Prettier config is checked in, so keep edits small and consistent with adjacent code.

## Testing Guidelines

Automated tests currently live on the Rust side as inline `#[cfg(test)]` modules, especially in `src-tauri/src/app_state.rs`, `parser.rs`, `repository.rs`, and `store.rs`. Add or extend those tests when changing parsing, storage, or aggregation behavior. Frontend changes should at minimum pass `npm run typecheck` and be manually checked in `npm run desktop -- dev`.

macOS packaged builds are not yet signed with an Apple Developer ID certificate or notarized by Apple. Update checks can still work in packaged builds, but replacement apps may be blocked by Gatekeeper on first launch. For local testing, prefer the GitHub Release install package over a manually copied `.app`, and expect quarantine removal to be necessary in some cases.

## Commit & Pull Request Guidelines

Recent history mostly uses conventional-style subjects such as `perf(scan): ...`, `build(packaging): ...`, and `docs(user): ...`. Prefer `<type>(<scope>): <summary>` and avoid vague messages like `ok`. Pull requests should explain user-visible impact, list verification commands, link the related issue when available, and include screenshots or short recordings for UI changes.

## Configuration Notes

The app reads Codex session data from `CODEX_HOME` and can pin the SQLite path with `CODEX_USAGE_DATABASE`. When changing path handling or sync behavior, document the user impact in `docs/howto/`.

Desktop releases are tag-driven. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`, then verify whether `src-tauri/Cargo.lock` changed as a side effect of the version bump. Pushing a tag like `v0.3.0` triggers the release workflow that uploads platform bundles and regenerates `latest.json`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **token-ledger** (1053 symbols, 2212 relationships, 92 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/token-ledger/context` | Codebase overview, check index freshness |
| `gitnexus://repo/token-ledger/clusters` | All functional areas |
| `gitnexus://repo/token-ledger/processes` | All execution flows |
| `gitnexus://repo/token-ledger/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
