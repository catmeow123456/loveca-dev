# 本地验证资源

按实际需要查阅，工具与资源入口不构成固定验收流程。

- 环境入口：[package.json](../../../../package.json) 的 `test-env:start` 与 [scripts/start-test-env.sh](../../../../scripts/start-test-env.sh)。实际地址、端口与配置以当前运行环境为准，已有服务优先复用。
- 模式语义：[对战模式与边界](../../../../docs/battle-mode-purpose-and-boundaries.md)。本地调试、联机、观战与回放共用桌面组件，不另造验收 UI。
- 本地卡组：[assets/decks/](../../../../assets/decks/)。账号卡组操作的授权边界见根 [AGENTS.md](../../../../AGENTS.md)。
- 卡图工具：[scripts/download-local-test-card-images.mjs](../../../../scripts/download-local-test-card-images.mjs) 支持 `--dry-run`、`--deck-dir=...` 与同基础卡号的罕度扩展。工具会写入 `assets/card/` 与 `assets/images/`，使用范围遵守根 AGENTS.md 的素材约束。
- 浏览器证据：`output/playwright/`；按需保留能解释问题的截图、录屏或 trace。代码检查与提交约定沿用根 AGENTS.md。
