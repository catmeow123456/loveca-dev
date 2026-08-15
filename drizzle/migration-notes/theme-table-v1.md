# 轮换主题牌桌第一版迁移说明

对应迁移：`0026_add_theme_table_v1.sql`。

本迁移新增主题活动版本、服务端预组版本、已批准对局组合与不可变分配记录四张表，并让既有公共牌桌票据/预留支持独立 `THEME` 队列上下文。`gameplay_participations` 同步增加 `THEME_QUEUE`。

迁移只建立数据边界，不创建默认活动，也不会自动开放候场。活动必须通过受管理员权限保护的编排工作台/API 以 `DRAFT` 创建，冻结通过构筑校验的云端卡组或 YAML 卡组快照，登记至少一个可用组合后才能发布。每副卡组加入未结束赛季的当前卡组池时会自动生成同卡组内战组合，并与池内其他当前卡组组成等权组合。运行期编辑会将旧预组写入 `retired_at`、创建同一 `deck_key` 的新版本并重建其未来组合；移出卡组只退休版本并停用相关组合，已经冻结的分配和锁组仍引用旧版本。当前版本的 `deck_key` 与内容哈希分别由部分唯一索引约束。数据库只允许一个 `ACTIVE` 版本；移出最后一副可分配卡组会原子暂停活动。

开局前一方离开或到场超时后，无过错方会在同一事务中取得新的主题票据，保留原 `joined_at` 并通过 `requeued_from_ticket_id` 关联旧票据；责任方不会自动回队。若活动已经暂停、结束或离开开放时段，双方都终止参与而不生成新票据。

执行前检查：

- 应用 `0026` 前已按顺序完成 `0001` 至 `0025`；
- 当前没有旧版本进程继续写入 `public_table_tickets`、`public_table_reservations` 或 `gameplay_participations`；
- 已备份上述三张运行表。

执行后检查：

- 既有 `CASUAL` / `RANKED` 票据的 `theme_table_version_id` 均为 `NULL`；
- 新增 check constraint 接受 `THEME + theme_table_version_id + season_id NULL`，并拒绝混合环境身份；
- `uq_theme_table_versions_single_active` 阻止两个活动版本同时开放，组合的规范顺序约束阻止 A×B / B×A 重复登记；
- 通过编排工作台加入预组后，该预组存在一个已启用的 A×A 组合；
- 普通公共牌桌与排位 focused tests 继续通过；
- 数据库中不存在自动生成的 `ACTIVE` 主题版本。
