# 打包桌面应用

这份说明介绍如何把当前项目打包成一个可运行的桌面应用，并把最终产物整理到固定目录。

如果你只是想使用已经打好的应用，请看 [桌面看板使用指南](./use-desktop-dashboard.md)。

## 目录

- [快速开始](#快速开始)
- [脚本会做什么](#脚本会做什么)
- [输出位置](#输出位置)
- [可选参数](#可选参数)
- [常见问题](#常见问题)

## 快速开始

在仓库根目录执行：

```bash
npm run package:app
```

脚本会自动：

1. 检查 `node`、`npm`、`cargo`、`rustc`
2. 在 macOS 上额外检查 `xcodebuild`
3. 如果 `node_modules/` 不存在，自动执行 `npm install`
4. 执行 `npm run typecheck`
5. 执行 macOS 所需的 Tauri build，只打 `app`
6. 把可运行应用复制到固定输出目录

## 脚本会做什么

脚本文件位置：

```bash
scripts/package-app.sh
```

它会调用当前项目已经存在的 Tauri 打包链路，然后把真正需要交付的结果整理到一个更稳定的位置，避免你每次都去 `src-tauri/target/release/bundle/` 里手动找产物。

当前支持平台：

- macOS：复制 `.app`

当前脚本没有原生支持 Windows 的 `.bat` 或 PowerShell 版本。

## 输出位置

默认输出目录：

```bash
release-app/
```

例如在 macOS 上，成功后你会得到：

```bash
release-app/TokenLedger.app
```

## 可选参数

直接执行脚本时可用这些参数：

```bash
bash scripts/package-app.sh --help
```

常用参数：

- `--out-dir <path>`：自定义输出目录
- `--skip-install`：如果 `node_modules/` 缺失，不自动执行 `npm install`
- `--skip-typecheck`：跳过 `npm run typecheck`
- `--open`：打包成功后在 macOS 中定位产物

示例：

```bash
bash scripts/package-app.sh --out-dir ./artifacts --open
```

也可以用环境变量：

```bash
OUT_DIR=./artifacts npm run package:app
```

## 常见问题

### 找不到 `xcodebuild`

这通常说明 macOS 开发环境不完整。请安装完整 Xcode，而不只是 Command Line Tools。

### 为什么脚本没有直接输出 `.dmg`

这份脚本优先整理“可运行的 app”。在 macOS 上，这意味着复制 `.app` 到固定目录。`.dmg` 仍然会由 Tauri 正常产出，但不作为脚本主输出。

### 为什么脚本没有支持 Windows

当前仓库的脚本实现是 Bash 版本，当前只覆盖 macOS。Windows 侧如果需要一键打包，建议后续补一个 `.ps1` 包装层。
