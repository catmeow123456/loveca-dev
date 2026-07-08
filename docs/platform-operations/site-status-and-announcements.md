# 平台状态、维护开关与公告

> 文档类型：需求与设计现状
> 适用范围：平台维护开关、公开站点状态、首页公告、管理员公告管理、维护期间新对局限制
> 当前状态：2026-07-08 已落地；数据库配置优先，环境变量仅作为兜底

本文档是平台状态与公告能力的权威事实来源。该能力的目标是让管理员可以直接在平台内发布公告、打开维护开关，并在维护期间限制新的对局入口，同时让玩家在首页清楚看到公告与维护状态。

## 需求目标

- 管理员可以在平台内管理公告，支持编辑、发布、删除，不依赖部署人员改环境变量。
- 公告管理属于平台配置能力，不属于联机房间监控；房间监控只保留房间、对局、观战和回放相关操作。
- 公告类型只保留“维护 / 更新 / 动态”，对应数据枚举 `MAINTENANCE`、`UPDATE`、`NEWS`；旧的“卡效数据”“卡牌自动化”等细分类型不再兼容。
- 首页需要展示最近公告和维护状态；移动端顶栏提供公告入口，未看过当前公告集合时自动弹出公告抽屉。
- 管理员打开维护开关后，服务端必须限制新的对局流程，不能只依赖前端禁用按钮。
- 维护开关的当前语义是“限制新增对局，允许存量对局自然收尾”，不会主动中断已经进行中的对局。

## 角色与入口

| 角色     | 入口                                             | 当前能力                                                                                 |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 管理员   | 首页管理工具的“平台配置”                         | 配置维护开关、维护说明、时间窗口、影响范围、限制说明、行动提示；管理公告草稿、发布和删除 |
| 普通玩家 | 首页顶栏“公告栏”、桌面端首页公告摘要、维护提示条 | 查看维护、更新和动态公告；移动端未读公告集合会自动弹出一次                               |
| 服务端   | `/api/config` 返回的 `siteStatus`                | 为前端提供公开站点状态、维护信息和公告列表                                               |

当前前端内部仍复用 `announcement-admin` 页面标识，并提供 `platform-config` 别名入口。用户可见文案以“平台配置”为准。

## 数据来源与优先级

公开站点状态由 `siteAnnouncementService.getPublicSiteStatus` 组装，当前优先级如下：

1. `site_status_config` 表：维护生命周期、维护文案、时间窗口、影响范围和限制说明的首选来源。
2. `site_announcements` 表：公开首页公告的首选来源，只读取已发布且未过期的公告，按优先级和发布时间排序，最多返回 10 条。
3. `SITE_STATUS_*` 与 `SITE_STATUS_ANNOUNCEMENTS_JSON` 环境变量：仅作为迁移未执行、数据库不可用或表不存在时的兜底。
4. `assets/site-status.json`：前端配置接口加载失败时的静态兜底说明，不作为管理员配置主路径。

`site_status_config` 是单行配置表，固定 `id = 'default'`。`site_announcements` 保存公告生命周期，状态为 `DRAFT` 或 `PUBLISHED`。

## 维护生命周期

公开状态契约支持以下生命周期：

| 生命周期                | 含义                     | 当前限制新对局 |
| ----------------------- | ------------------------ | -------------- |
| `NORMAL`                | 正常运行                 | 否             |
| `SCHEDULED`             | 已计划维护，提前通知     | 否             |
| `RESTRICTING_NEW_GAMES` | 维护临近，开始限制新对局 | 是             |
| `MAINTENANCE`           | 维护中                   | 是             |
| `COMPLETED`             | 维护完成公告             | 否             |
| `POSTPONED`             | 维护延期公告             | 否             |
| `CANCELLED`             | 维护取消公告             | 否             |

当前管理员界面的维护开关是简化操作：

- 开启：保存为 `MAINTENANCE`，并发布维护标题、摘要、详情、开始时间、预计结束时间、影响范围、限制说明和行动提示。
- 关闭：保存为 `NORMAL`，并清空维护字段。

如果后续需要“今晚 23:00 先公告，22:50 开始限制新开局，23:00 进入维护中”的精细流程，应在平台配置中显式增加生命周期或计划维护表单，而不是重新使用环境变量。

## 维护期间限制范围

维护闸门由服务端 `requireGameplayAvailable` 执行。当前只有 `RESTRICTING_NEW_GAMES` 与 `MAINTENANCE` 会触发限制，接口返回 503，错误码为 `SITE_MAINTENANCE`。

当前会被拦截的入口：

- 新建联机房间：`POST /api/online/rooms`
- 加入联机房间：`POST /api/online/rooms/:roomCode/join`
- 锁定或更换准备阶段卡组：`POST /api/online/rooms/:roomCode/deck`
- 准备开始：`POST /api/online/rooms/:roomCode/ready-start`
- 开局猜拳与重猜：`POST /api/online/rooms/:roomCode/opening-rps`、`POST /api/online/rooms/:roomCode/opening-rps/replay`
- 选择先后手：`POST /api/online/rooms/:roomCode/opening-turn-order`
- 请求重开与接受重开：`POST /api/online/rooms/:roomCode/restart-request`、`POST /api/online/rooms/:roomCode/restart-request/:requestId/accept`
- 创建服务端对墙打：`POST /api/battle/solitaire-matches`

当前不会主动拦截的入口：

- 已经开始的正式联机对局快照、public-events、命令、阶段推进、撤销与撤销协商。
- 已经创建的服务端对墙打快照、public-events、命令、阶段推进、撤销和离开。
- 观战、历史记录、回放、管理员房间监控读取。
- 离开房间、拒绝重开等收尾操作。

这个边界是有意设计：维护开关用于避免维护窗口继续产生新局和新开局流程，不用于强制冻结、强制结束或回滚正在进行的对局。若未来需要“硬维护”模式，应作为新的独立策略设计，并明确对进行中对局、撤销、回放落库和用户提示的影响。

## 首页与移动端展示

首页消费 `/api/config` 中的 `siteStatus`：

- 维护状态为 `SCHEDULED`、`RESTRICTING_NEW_GAMES` 或 `MAINTENANCE` 时展示维护提示条。
- 桌面端首页保留右侧公告摘要。
- 移动端首页顶栏提供“公告栏”按钮，避免首屏被公告摘要挤占；公告详情以底部抽屉展示。
- 本机未看过当前公告集合时，移动端和桌面端都会自动打开公告抽屉一次。
- 应用启动后会在页面可见时后台刷新 `/api/config`：周期刷新带少量抖动，失败后逐步退避；窗口重新获得焦点时会节流触发刷新。后台刷新失败保留旧配置，不使用静态 fallback 覆盖当前页面状态。

已读状态存储在浏览器 `localStorage`，key 为 `loveca.home.announcements.seen.v1`。已读指纹由维护状态、维护详情、影响范围、限制说明、行动提示，以及公开公告的 id、类型、标题、摘要、详情、时间与影响范围生成；公告优先级只影响展示顺序，不单独制造未读。公告内容变化后会重新视为未读。当前没有服务端级别的已读状态，也没有推送通道；已经停留在页面内的用户依赖后台刷新看到最新公开状态。

## 管理员公告管理

公告管理支持：

- 创建草稿或直接发布。
- 编辑标题、摘要、详情、开始时间、结束时间、优先级和影响范围。
- 发布草稿。
- 删除公告。

公开首页只展示 `PUBLISHED` 且未过期的公告。公告类型固定为：

| 类型          | 中文展示 | 使用场景                                 |
| ------------- | -------- | ---------------------------------------- |
| `MAINTENANCE` | 维护     | 维护窗口、停机、限制开局、服务不可用说明 |
| `UPDATE`      | 更新     | 版本更新、功能发布、规则或体验调整       |
| `NEWS`        | 动态     | 普通站点动态、活动或非维护类通知         |

后台不保留旧类型映射，不做历史类型兼容。旧数据若使用不再支持的类型，应在迁移或清理时改写为上述三类之一。

## 关键代码路径

| 范围                           | 代码路径                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| 公开站点状态契约与环境变量兜底 | `src/server/site-status.ts`                                  |
| 公告与维护配置服务             | `src/server/services/site-announcement-service.ts`           |
| 管理员公告和维护配置 API       | `src/server/routes/site-announcements.ts`                    |
| 对局入口维护闸门               | `src/server/middleware/require-gameplay-available.ts`        |
| 公开配置 API                   | `src/server/routes/app-config.ts`                            |
| 联机房间限制接入               | `src/server/routes/online.ts`                                |
| 服务端对墙打限制接入           | `src/server/routes/battle.ts`                                |
| 数据库 schema                  | `src/server/db/schema.ts`                                    |
| 管理员平台配置页               | `client/src/components/admin/SiteAnnouncementsAdminPage.tsx` |
| 公开配置加载与指纹             | `client/src/lib/appConfig.ts`                                |
| 公开配置后台刷新调度           | `client/src/lib/publicConfigRefresh.ts`                      |
| 首页公告与维护提示             | `client/src/components/pages/HomePage.tsx`                   |
| 前端公告管理客户端             | `client/src/lib/siteAnnouncementClient.ts`                   |

相关迁移文件为 `drizzle/0006_add_site_announcements.sql` 与 `drizzle/0007_add_site_status_config.sql`。生产环境需要先执行数据库迁移，管理员平台配置才能正常写入数据库。迁移未完成时，公开配置仍可能通过环境变量兜底展示，但这不是常规运维路径。

## 已知边界

- 维护开关不会影响正在进行的正式联机或服务端对墙打对局；它只限制新对局和正式开局前流程。
- 当前管理员界面只提供立即维护开关，不提供计划维护、限制新开局、完成、延期和取消的完整状态编辑控件。
- 公告已读是浏览器本地状态，不跨设备同步。
- 当前没有对在线用户的实时推送；公开状态在应用加载或配置刷新后生效。
- 当前只有最近 10 条公开公告进入首页配置；长期公告归档、筛选和分页不在本能力范围内。
- 管理员操作审计仅记录 `created_by`、`updated_by` 与时间字段，未提供独立审计日志。
