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

## Code Search & Intelligence

- **Prioritize using CodeGraph**: For codebase navigation, symbol reference lookups, and relationship analysis, prioritize using `codegraph` tools and the `.codegraph/` database over generic text search commands like `grep`.


