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

## 认证与会话

当前认证限流使用 API 进程内的有界内存桶，适合当前单 API 进程部署，但存在以下边界：

- 限流状态会在进程重启后清空，也不会在多个 API 实例间共享；横向扩容前需要迁移到共享限流存储或由可信反向代理统一执行等价限制。
- 修改或重置密码会在同一事务中撤销刷新令牌，但已经签发的访问令牌不会进入服务端黑名单，最长仍可使用至 15 分钟自然过期。
- 前端在支持 Web Locks 的浏览器中会跨标签页串行刷新令牌；不支持该 API 的浏览器只具备单标签页内的并发去重保障。
- 认证 v1 -> v2 切换无法无损转换旧 bcrypt 密码；迁移会要求受影响用户重置密码，并使全部旧会话和未完成的一次性链接失效。占位邮箱账号必须在发布前安排人工恢复。

相关代码路径：

- `src/server/middleware/auth-rate-limit.ts`
- `src/server/routes/auth.ts`
- `src/server/services/auth-service.ts`
- `client/src/lib/apiClient.ts`
- `drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md`

## 联机模式

当前正式联机已经具备基础闭环：房间创建/加入、云端卡组锁定、双方准备开始、开局猜拳与胜者决定先后手、服务端权威对局、轮询同步、房间号观战跨重开等待与自动续看、离开/短暂恢复和管理员房间观测。

仍未落地或未完整闭环：

- WebSocket/SSE 等实时传输增强；当前正式联机使用短间隔 HTTP 轮询。
- 房间号观战的跨重开资格、局间等待和单局重新绑定当前只保存在服务进程内存中；服务进程重启后恢复观战会话尚未落地。
- 远程撤销已具备首版能力：服务端可记录对墙打支持 FIRST 真实用户即时撤销；正式联机支持请求式撤销，由对手接受后服务端回滚权威状态。远程调试联机的撤销策略、回放时间线撤销节点增强展示和更完整的撤销体验提示仍未收束。
- 对局记录与回放仍处于阶段性闭环：已接入正式联机与服务端可记录对墙打的历史根记录、卡组快照、timeline、authority checkpoint、public/private event 明细、普通玩家历史列表/详情/timeline/checkpoint 投影读取、前端历史入口、历史 checkpoint 只读 GameBoard 桌面展示，以及部分语义化 decision record。对墙打第一版会将对手自动流程压缩在玩家命令后的 checkpoint 中；对墙打运行态缺失时可从最新 authority checkpoint 和公共事件尾部恢复，但可能回退到最近保存点且撤销历史会重置。本地 / 离线对墙打仍不保存历史。正式联机进程重启后恢复运行中对局、完整随机记录、完整决策覆盖、自由拖拽/手动处理原因结构化、确定性重演、逐命令动画播放、公开分享回放和长期兼容策略仍未完整闭环。
- 全卡池完整自动裁判、声明式卡文解释器、自动能力全事件编排和完整回放语义。当前已接入的卡效自动化属于第一阶段白名单能力，覆盖范围以卡效登记册为准。

相关文档：

- [联机模式准备文档](online-mode/preparation.md)
- [联机模式边界规范](online-mode/boundary-standard.md)
- [对局记录与回放需求](match-replay/requirements.md)
- [对局记录与回放设计](match-replay/design.md)
- [对局记录与回放第一阶段实施计划](match-replay/phase1-implementation-plan.md)
- [对局回放 checkpoint / bundle 序列化与复水契约](match-replay/serialization-contract.md)

## 对局规则自动化

当前主流程已经支持配置化阶段/子阶段、主要动作处理、Live 判定与结算、基础检查时机纠偏，并已接入卡效自动化第一阶段能力：普通成员登场/换手费用计算与支付、登场费用修正、活跃阶段自动恢复当前玩家成员与能量、Live 判定建议与成功/失败结算、Live modifier，以及第一批已登记真实卡效。

仍需区分：

- 运行时主链路由 `GameSession`、`GameService.executeCheckTiming()` 和卡效 runner 共同驱动。已接线时点包括基础检查时机、登场、起动、LIVE 开始、LIVE 成功、声援和部分 AUTO proving path。
- `src/domain/rules/check-timing.ts` 保留更完整的检查时机/自动能力处理模型，但当前未作为主流程完整接线入口。
- 已实现卡效范围以 [卡效完成状态登记册](card-effect-reuse-audit/existing_module_map.md) 为准。未登记卡、未覆盖效果段和未接线复杂时点仍应按“信任玩家 + 命令校验 + 审计式流程”处理，不应写成当前自动执行能力。
- 普通手牌成员登场的费用、接力减费和活跃能量支付已进入语义化命令链路；由卡效从非手牌区域登场的成员，是否支付普通登场费用取决于对应卡效实现和登记册说明。
- 卡效内部移动与支付已能通过权威状态、玩家视图投影和审计信息表达，但尚未全部统一成标准 `GameEvent` / `PublicEvent` 语义；这属于 snapshot/audit 过渡边界。需要事件持久化、回放、观战增量同步或未来监听自动能力时，应优先补齐事件边界。

相关文档：

- [系统设计](system-design.md)
- [开发规范](coding-standard/dev-standard.md)
- [联机模式准备文档](online-mode/preparation.md)
- [卡效框架设计](card-effect-framework/card_effect_framework_design.md)
- [卡效完成状态登记册](card-effect-reuse-audit/existing_module_map.md)

## 前端与移动端

当前游戏桌已经具备第一版手机竖屏主战场结构、对手/日志任务层入口和手机化判定面板，但核心交互仍偏桌面/调试型模型。移动端需求文档用于定义目标状态，当前差距以移动端现状差距清单为准。

仍未落地：

- 面向手机竖屏的完整触屏操作路径与主视角战斗桌精修。
- 稳定的移动端底部流程条、全屏资源浏览和卡牌详情任务层。
- 完整前端 E2E specs；历史 Playwright 输出可能存在于 `client/test-results/` 或根目录 `test-results/`，不作为现行测试入口。

相关文档：

- [游戏桌 UI 现状](ui-design/game-table/current-state.md)
- [移动端适配需求](ui-design/mobile-adaptation-requirements.md)
- [移动端现状差距清单](ui-design/mobile-adaptation-gap-analysis.md)
- [移动端改进方向](ui-design/game-table/mobile-improvement-directions.md)

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
- 当前仓库中可能存在为本地测试服务器临时补齐的 `assets/card/` 原图与 `assets/images/{thumb,medium,large}/` WebP。它们只用于本机测试显示，不是生产图片资产来源；生产环境已有独立图片服务器/对象存储。上线前应检查并清理不需要提交的临时补图，避免仓库体积膨胀或误导后续部署判断。

相关文档：

- [MinIO 需求与设计](minio-requirements.md)
- [图片优化方案](image_optimization.md)
