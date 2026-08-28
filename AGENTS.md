# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React 19 + TypeScript + Tailwind CSS desktop UI. Keep Electron bridge calls in `src/api/`, shared DTOs in `src/dto/`, React state in `src/context/`, views in `src/views/`, reusable components in `src/components/`, and UI/i18n logic close to `src/main.tsx`, `src/App.tsx`, and `src/i18n.ts`. Electron main process and background services live in `electron/` with modules such as `electron/main.ts`, `electron/preload.ts`, and services in `electron/services/` (`store.ts`, `parser.ts`, `repository.ts`, `pricing.ts`, `pluginManager.ts`, `appState.ts`). Build and packaging helpers live in `scripts/`. Generated output in `dist/`, `dist-electron/`, and `release-app/` should not be committed.

## Build, Test, and Development Commands

Use Bun `>=1.0` and Node.js `>=20.0`.

- `bun install`: install frontend and Electron dependencies.
- `bun run dev`: launch the desktop app in Vite + Electron development mode.
- `bun run typecheck`: run the TypeScript type check.
- `bun test`: run the unit test suite.
- `bun run build`: compile TypeScript and produce the frontend and electron bundles.
- `bun run package:app`: package the current platform app into `release-app/`.
- `bun run package:mac`: package macOS bundles (.dmg / .zip).
- `bun run package:win`: package Windows bundles (.exe / .zip).

## Coding Style & Naming Conventions

Match the existing file style instead of reformatting unrelated code. TypeScript uses ES modules, `camelCase` for variables/functions, and `PascalCase` for DTO and type names. Source files under `src/` and `electron/` use 2-space indentation. Keep edits small and consistent with adjacent code.

## Testing Guidelines

Automated unit tests live under `tests/` and can be run with `bun test`. Add or extend those tests when changing parsing, storage, pricing, or aggregation behavior. Changes should pass `bun test` and `bun run typecheck`.

## Commit & Pull Request Guidelines

Prefer `<type>(<scope>): <summary>` and avoid vague messages like `ok`. Pull requests should explain user-visible impact, list verification commands, link the related issue when available, and include screenshots or short recordings for UI changes.

## Configuration Notes

The app reads Codex session data from `CODEX_HOME` and can pin the SQLite path with `CODEX_USAGE_DATABASE`.

Desktop releases are tag-driven. Update the version in `package.json`. Pushing a tag like `v0.3.0` triggers the release workflow that uploads platform bundles.
