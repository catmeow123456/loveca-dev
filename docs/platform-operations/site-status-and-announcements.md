# 平台状态、整站维护与公告

> 文档类型：需求与设计现状
> 适用范围：平台运行状态、公开维护快照、维护页、公告、对局排空和恢复
> 当前状态：2026-08-21 三态模型与应用级维护门禁已落地；生产反向代理仍需按本文接线

本文档是平台状态与公告能力的权威事实来源。平台运行状态只描述用户当前允许做什么；维护计划、延期、取消、完成和版本说明由公告表达，二者不共用生命周期。

## 平台运行状态

运行状态固定为三个值：

| 状态                    | 普通页面               | 新对局                                                     | 已开始对局     |
| ----------------------- | ---------------------- | ---------------------------------------------------------- | -------------- |
| `NORMAL`                | 正常访问               | 允许                                                       | 正常进行       |
| `RESTRICTING_NEW_GAMES` | 正常访问并显示维护提示 | 服务端拒绝创建、加入、锁定卡组、准备、开局、重开和候场确认 | 允许自然收尾   |
| `MAINTENANCE`           | 统一显示系统维护页     | 不可用                                                     | 进入前应已排空 |

常规转换为 `NORMAL → RESTRICTING_NEW_GAMES → MAINTENANCE → NORMAL`。紧急情况下允许从 `NORMAL` 直接进入 `MAINTENANCE`，管理员仍必须二次确认普通用户将只能看到维护页。状态不会按预计时间自动切换。

迁移 `0029_maintenance_mode_three_state.sql` 会把旧 `SCHEDULED`、`COMPLETED`、`POSTPONED`、`CANCELLED` 状态转换为 `NORMAL` 并清空旧维护字段；运行时不读取或映射旧值。

## 公告边界

公告类型固定为 `MAINTENANCE`、`UPDATE`、`NEWS`，状态为 `DRAFT` 或 `PUBLISHED`。计划维护时平台可保持 `NORMAL` 并发布维护公告；延期、取消和完成通过修改、撤下或重新发布公告表达。

公开首页只读取已发布且未过期的最近 10 条公告，按优先级和发布时间排序。公告已读指纹只保存在浏览器 `localStorage`，不跨设备同步，也不承担平台访问控制。

## 独立公开维护快照

整站门禁使用独立于 API 和数据库的公开 JSON 快照。快照协议版本为 `1`，只表达访问门禁所需的二态：

- `OPEN`：独立门禁允许继续检查 API；最终仍以 API 的三态状态为准。
- `MAINTENANCE`：普通用户立即进入维护页，并使用快照中的标题、摘要、时间与影响范围。

快照由 API 通过 `PUBLIC_SITE_STATUS_SNAPSHOT_PATH` 原子写入。生产 compose 将宿主机 `PUBLIC_SITE_STATUS_SNAPSHOT_DIR` 挂载到 API 容器；该目录必须独立于 `client/dist`，前端替换不能覆盖它。反向代理必须把同一文件作为 `/site-status.json` 提供，并设置 `Cache-Control: no-store, max-age=0`。Service Worker 不预缓存 JSON，客户端请求也附带时间参数并使用 `no-store`。

客户端冷启动先读取快照，同时请求 `/api/config`：

- 快照或 API 任一明确为 `MAINTENANCE`，显示维护页。
- 快照为 `OPEN`、API 可用且返回 `NORMAL` 或 `RESTRICTING_NEW_GAMES`，进入普通应用。
- 快照缺失、不可解析或不可达，且 API 没有明确返回 `MAINTENANCE`，显示“暂时无法入场”。
- API 不可达而快照为 `OPEN`，显示“暂时无法入场”，不得宣称计划维护。

维护页不依赖认证、卡牌数据、卡图、对象存储或远程字体，保留当前 URL。解除维护后，用户检查状态或重新加载即可回到原目标；停机前未完成的写操作不会自动重放。

## 一致性与恢复

管理员进入 `MAINTENANCE` 时先写维护快照，再更新数据库，数据库成功后再以数据库返回值刷新快照。任一步骤失败都不会向管理员报告成功；失败边界保持维护或更严格的一侧。

从 `MAINTENANCE` 恢复到 `NORMAL` 或 `RESTRICTING_NEW_GAMES` 前，服务端先调用应用就绪检查。当前 `/api/ready` 检查数据库连接与当前版本必需的 `cards`、`profiles`、`site_status_config` 表；仅 `/api/health` 进程存活不足以开放。数据库更新后才写 `OPEN` 快照，因此快照写入失败时普通用户仍被旧维护快照挡住，可在修复路径后重试相同状态。

API 无法启动时，运维人员可直接写公开快照：

```bash
pnpm site-status:snapshot \
  --status=MAINTENANCE \
  --path=/srv/loveca/site-status/site-status.json \
  --title='舞台正在整备' \
  --summary='稍后再见，下一场 LIVE 很快开始。'
```

恢复开放快照：

```bash
pnpm site-status:snapshot \
  --status=OPEN \
  --path=/srv/loveca/site-status/site-status.json
```

离线命令只操作公开门禁快照，不替代数据库状态变更。常规恢复必须先启动 API、通过 `/api/ready`、使用管理员恢复入口把数据库状态恢复为 `NORMAL`，并确认公开快照显示“已同步（开放）”。

## 管理员与运行记录

平台配置页提供三态单选，逐项说明普通页面、新对局和存量对局的影响。进入整站维护需要二次确认。页面核验公开快照并区分已同步、同步失败和无法核验。

维护页的“运营入口”按钮先检查 `/api/ready`，就绪后只进入登录与平台配置恢复流程。特殊查询参数只负责前端体验；服务端仍由认证与平台管理员权限控制。非管理员认证后不能借此绕过维护门禁。

`site_status_config.updated_by / updated_at` 保留最后修改人和时间；状态切换及快照同步成功或失败写入结构化服务日志。当前单一运维人员、单一平台管理员的规模不设置专用状态审计表。玩家页面不显示快照路径、接口地址、数据库状态或内部错误细节。

## 对局限制

`RESTRICTING_NEW_GAMES` 与 `MAINTENANCE` 均由 `requireGameplayAvailable` 在服务端返回 503 和稳定错误码 `SITE_MAINTENANCE`。闸门覆盖联机房间创建/加入、准备阶段卡组锁定、准备与开局、猜拳与先后手、重开、公共/排位/主题候场加入与确认，以及服务端对墙打创建和重开。

`RESTRICTING_NEW_GAMES` 不拦截已经开始的正式联机或对墙打命令、快照、事件同步、合法离开、认输、撤销协商和收尾。`MAINTENANCE` 不承诺普通业务 API 可用，发布流程可以在排空后停止 API。

## 关键实现

| 范围                 | 路径                                                         |
| -------------------- | ------------------------------------------------------------ |
| 三态与公开状态契约   | `src/server/site-status.ts`                                  |
| 状态、公告与快照协调 | `src/server/services/site-announcement-service.ts`           |
| 独立快照原子写入     | `src/server/services/public-site-status-snapshot-service.ts` |
| 就绪检查             | `src/server/services/readiness-service.ts`                   |
| 管理 API             | `src/server/routes/site-announcements.ts`                    |
| 新对局服务端闸门     | `src/server/middleware/require-gameplay-available.ts`        |
| 前端快照校验         | `client/src/lib/publicSiteStatusSnapshot.ts`                 |
| 应用级门禁           | `client/src/App.tsx`                                         |
| 维护与故障页         | `client/src/components/pages/ServiceStatusPage.tsx`          |
| 管理员三态控制       | `client/src/components/admin/SiteAnnouncementsAdminPage.tsx` |
| 离线快照工具         | `scripts/manage-public-site-status-snapshot.mjs`             |
| 数据迁移             | `drizzle/0029_maintenance_mode_three_state.sql`              |

## 生产接线与剩余验收

- 生产反向代理配置不在仓库中；部署前必须确认 `/site-status.json` 指向持久快照目录，而不是前端版本目录，并验证禁止缓存响应头。
- 首次部署本协议前必须先用离线命令创建 `OPEN` 快照，否则新前端会按故障安全策略显示“暂时无法入场”。
- 仍需在真实生产拓扑完成未登录、已登录、无痕窗口、已安装 PWA、API 停止、数据库未就绪、快照冲突、日夜主题和移动端的完整 smoke/E2E。
- 公告仍无实时推送和跨设备已读同步；页面内状态依赖后台配置刷新，停机访问门禁依赖冷启动或手动检查。
