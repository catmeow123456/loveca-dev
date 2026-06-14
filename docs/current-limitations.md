# Loveca 当前实现限制

> 文档类型：专题说明
> 适用范围：跨模块的当前实现限制、部署差异、已知偏差和未落地能力
> 当前状态：现行限制清单；修复代码或变更部署方案后需同步更新

本文档集中记录容易在多个专题中重复出现的当前限制。具体实现仍以代码和测试为准；本文档用于避免把未落地能力误读为当前事实。

## 数据库初始化与 schema 边界

当前表结构的代码侧来源是：

- `src/server/db/schema.ts`
- `drizzle.config.ts`

生产 `docker-compose.yml` 和开发 `docker-compose.dev.yml` 都会挂载 `docker/init.sql` 初始化 PostgreSQL。该脚本包含 `cleanup_expired_tokens()`、`update_deck_count()`、`update_deck_timestamp()` 等 Drizzle schema 不表达的函数/触发器，因此不能简单认为 Drizzle schema 与初始化脚本完全等价。

当前维护边界：

- `docker/init.sql` 已包含当前运行时代码使用的卡组分享字段。
- 卡组路由自身不手动维护 `profiles.deck_count` 或 `decks.updated_at`。如果数据库由 `docker/init.sql` 初始化，这两个字段由触发器维护；如果只按 Drizzle schema 建库，则不会自动具备这些触发器。
- 早期外部托管方案只作历史参考，不作为当前部署脚本。

相关文档：

- [README 数据库初始化](../README.md#数据库初始化)
- [历史迁移说明](historical-migrations.md)
- [卡组管理设计](deck-management/design.md)

## 联机模式

当前正式联机已经具备基础闭环：房间创建/加入、云端卡组锁定、先后手确认、服务端权威对局、轮询同步、离开/短暂恢复和管理员房间观测。

仍未落地：

- WebSocket/SSE 等实时传输增强；当前正式联机使用短间隔 HTTP 轮询。
- 对局事件持久化、快照持久化、进程重启后的恢复和回放。
- 完整自动裁判、自动能力编排和复杂卡文连锁。

相关文档：

- [联机模式准备文档](online-mode-preparation.md)
- [联机模式边界规范](coding-standard/online-mode-boundary.md)

## 对局规则自动化

当前主流程已经支持配置化阶段/子阶段、主要动作处理、Live 判定与结算、基础检查时机纠偏。

仍需区分：

- 运行时主链路由 `GameService.executeCheckTiming()` 驱动基础规则处理。
- `src/domain/rules/check-timing.ts` 保留更完整的检查时机/自动能力处理模型，但当前未作为主流程完整接线入口。
- 复杂卡牌效果主要依赖玩家显式桌面操作和审计式流程，不应写成当前自动执行能力。
- 成员登场费用、接力减费和能量横置当前由玩家显式桌面操作处理；`PLAY_MEMBER` 不会隐式校验或代扣能量。

相关文档：

- [系统设计](../game_system_design.md)
- [开发规范](coding-standard/dev-standard.md)
- [联机模式准备文档](online-mode-preparation.md)

## 前端与移动端

当前游戏桌已经具备第一版手机竖屏主战场结构、对手/日志任务层入口和手机化判定面板，但核心交互仍偏桌面/调试型模型。移动端需求文档用于定义目标状态，当前差距以移动端现状差距清单为准。

仍未落地：

- 面向手机竖屏的完整触屏操作路径与主视角战斗桌精修。
- 稳定的移动端底部流程条、全屏资源浏览和卡牌详情任务层。
- 完整前端 E2E specs；历史 Playwright 输出可能存在于 `client/test-results/` 或根目录 `test-results/`，不作为现行测试入口。

相关文档：

- [游戏桌 UI 现状](game-table-design/game-table-ui-current-state.md)
- [移动端适配需求](UI_MOBILE_ADAPTATION_REQUIREMENTS.md)
- [移动端现状差距清单](UI_MOBILE_ADAPTATION_GAP_ANALYSIS.md)
- [移动端改进方向](game-table-ui-mobile-improvement-directions.md)

## Android App 打包

当前仓库已落地 Web/PWA 与 TWA 前置项：`client/vite.config.ts` 生成 Web App Manifest、Service Worker 与 PWA 图标声明，`android/twa/loveca/` 保存 Bubblewrap 生成的 TWA Android 工程，根 `package.json` 提供 Android 打包相关脚本。

仍未完成正式发布闭环：

- 线上 `https://loveca.lovelivefun.xyz/manifest.webmanifest` 仍需部署更新后的 manifest、PWA 图标和 Service Worker 产物，并通过 PWA 检查。
- `assets/.well-known/assetlinks.json` 当前对应本地测试签名包；换正式 release / upload signing key 后必须重新生成并发布。
- Docker Bubblewrap 本地构建仍默认跳过线上 PWA 校验；正式发布前应关闭该跳过项并完成真机验证。
- 当前 TWA 路线只打开线上 Web 站点，不把 `client/dist` 作为离线本地资源包发布。
- Capacitor 本地包路线仍需要先设计 CORS、refresh cookie / token、图片 URL 和深链策略。

相关文档：

- [Android App 打包指南草稿](android-app-packaging-guide-draft.md)
- [Web 客户端说明](../client/README.md)

## 图片与对象存储

当前服务端通过 `MINIO_*` 环境变量连接 MinIO 或兼容 S3 对象存储，开发环境可用 `docker-compose.dev.yml` 启动本地 MinIO。

需要注意：

- 生产 `docker-compose.yml` 不启动 MinIO，生产环境需要外部对象存储或兼容服务。
- 前端图片 URL 优先走同源或 `VITE_API_BASE_URL` 指向源下的 `/images/{size}/{name}.webp`。
- 代码中保留本地静态图片兜底分支，但当前配置下不会因为远程图片请求失败自动切换到本地图片。

相关文档：

- [MinIO 需求与设计](minio-requirements.md)
- [图片优化方案](image_optimization.md)
