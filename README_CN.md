# TokenLedger

[English README](./README.md)

`TokenLedger` 是一个基于 Tauri 的桌面看板，用于读取 Codex 会话数据并统计 token 与成本变化趋势。

## 功能特性

- **数据读取**：从 `CODEX_HOME/sessions/*.jsonl` 读取会话数据。
- **本地存储**：将聚合结果写入本地 SQLite 数据库（默认路径为 `CODEX_HOME/.codex-usage/usage.sqlite`）。
- **多维视图**：支持按今日、近 7 日、本月、每日和每月等维度查看用量。
- **版本更新**：支持检查 GitHub Releases 并在线安装更新。
- **国际化**：内置中英文界面。

## 快速开始

### 运行开发版本

```bash
npm ci
npm run desktop -- dev
```

### 运行测试与校验

```bash
npm run typecheck
cd src-tauri && cargo test
```

### 打包应用

```bash
npm run package:app
```
打包后的可运行文件将输出至 `release-app/` 目录。

## 项目结构

```text
src/             前端 UI 及逻辑 (Vite + TypeScript)
src-tauri/       后端逻辑及数据库 (Rust + SQLite)
scripts/         打包与对比辅助脚本
release-app/     打包输出目录
```
