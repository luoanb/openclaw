# 项目空间分析报告

> 最后更新：2026-06-13

## 概述

本文档分析 OpenClaw 项目的磁盘空间占用情况，帮助开发者了解项目结构并进行空间优化。

## 项目总览

| 指标                   | 大小   |
| ---------------------- | ------ |
| **项目总大小**         | 1.7 GB |
| **源代码 (src/)**      | 101 MB |
| **扩展 (extensions/)** | 66 MB  |
| **应用 (apps/)**       | 18 MB  |
| **文档 (docs/)**       | 17 MB  |
| **Git 仓库 (.git/)**   | 1.5 GB |

## 目录结构分析

### src/ 目录 (101 MB)

| 模块          | 大小   | 说明                                                           |
| ------------- | ------ | -------------------------------------------------------------- |
| `agents/`     | 24 MB  | Agent 核心模块，包含 embedded-agent-runner、tools、sessions 等 |
| `gateway/`    | 11 MB  | Gateway 网关模块                                               |
| `plugins/`    | 8.3 MB | 插件系统                                                       |
| `infra/`      | 8.3 MB | 基础设施                                                       |
| `commands/`   | 8.1 MB | 命令模块                                                       |
| `auto-reply/` | 7.3 MB | 自动回复                                                       |
| `cli/`        | 5.1 MB | CLI 工具                                                       |
| `config/`     | 4.1 MB | 配置模块                                                       |
| `plugin-sdk/` | 3.8 MB | 插件 SDK                                                       |
| `channels/`   | 3.0 MB | 频道模块                                                       |
| `cron/`       | 2.1 MB | 定时任务                                                       |
| 其他 40+ 模块 | < 2 MB | 各功能模块                                                     |

### extensions/ 目录 (66 MB)

#### Top 10 扩展

| 扩展        | 大小   | 说明              |
| ----------- | ------ | ----------------- |
| discord     | 4.9 MB | Discord 平台集成  |
| telegram    | 4.2 MB | Telegram 平台集成 |
| codex       | 4.1 MB | Codex 集成        |
| qa-lab      | 3.6 MB | QA 实验室         |
| matrix      | 3.6 MB | Matrix 协议支持   |
| browser     | 3.1 MB | 浏览器自动化      |
| whatsapp    | 2.8 MB | WhatsApp 集成     |
| slack       | 2.7 MB | Slack 集成        |
| memory-core | 2.4 MB | 记忆核心模块      |
| feishu      | 2.3 MB | 飞书集成          |

**扩展总数：100+**，覆盖主流通讯平台和 AI 提供商。

### apps/ 目录 (18 MB)

| 应用  | 大小   | 说明           |
| ----- | ------ | -------------- |
| macOS | ~10 MB | macOS 客户端   |
| iOS   | ~5 MB  | iOS 客户端     |
| 其他  | ~3 MB  | 其他平台客户端 |

## Git 仓库分析

### 空间占用

Git 仓库（`.git/`）占用 **1.5 GB**，占项目总大小的 88%。

### 历史大文件

以下大文件已从工作目录删除，但仍存在于 Git 历史中：

| 文件                                                | 大小             | 来源            |
| --------------------------------------------------- | ---------------- | --------------- |
| `.serena/cache/typescript/document_symbols.pkl`     | 87 MB            | Serena IDE 缓存 |
| `.serena/cache/typescript/raw_document_symbols.pkl` | 27 MB            | Serena IDE 缓存 |
| `ClawdisKit/.build/ModuleCache/*.pcm`               | ~40 MB           | macOS 编译缓存  |
| `mantis/telegram-desktop/*/proof.gif`               | ~30 MB           | 测试截图        |
| `extensions/diffs/assets/viewer-runtime.js`         | ~100 MB (多版本) | diff 扩展运行时 |

### .gitignore 检查

当前已排除的关键目录/文件：

- ✅ `.serena/` - IDE 缓存
- ✅ `**/ModuleCache/` - macOS 模块缓存
- ✅ `.build/` - 构建产物
- ✅ `extensions/diffs/assets/viewer-runtime.js`
- ❌ `*.pkl` - **未排除**（建议添加）

## 优化建议

### 1. 添加 .pkl 到 .gitignore

```gitignore
# 添加此行以防止 Serena 缓存再次进入 Git
*.pkl
```

### 2. 清理 Git 历史

使用 `git filter-branch` 或 `git gc` 可以从历史中移除大文件：

```bash
# 清理未引用对象
git gc --aggressive --prune=now

# 或使用 BFG Repo-Cleaner
bfg --delete-files "*.pkl"
```

预计可减小 **500 MB - 1 GB**。

### 3. 启用 Git LFS

对大二进制文件使用 Git LFS：

```bash
# 初始化 Git LFS
git lfs install

# 跟踪大文件类型
git lfs track "*.png"
git lfs track "*.icns"
git lfs track "*.gif"
git lfs track "*.psd"
```

### 4. 定期清理

- 删除本地构建产物：`rm -rf .build/ dist/ node_modules/`
- 清理包管理器缓存：`pnpm store prune` / `npm cache clean --force`

## 总结

项目主要空间占用：

1. **Git 历史** (1.5 GB) - 最大占用，主要来自历史大文件
2. **源代码** (101 MB) - 合理的代码量
3. **扩展** (66 MB) - 100+ 插件的正常体积

优化优先级：

1. **高** - 添加 `*.pkl` 到 .gitignore
2. **中** - 清理 Git 历史释放 500MB-1GB
3. **低** - 启用 Git LFS（预防性措施）
