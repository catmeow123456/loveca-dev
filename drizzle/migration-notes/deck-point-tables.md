# 版本化 PT 限制表迁移说明

## 变更范围

- `0012_add_deck_point_tables.sql` 新增 PT 表、条目和审计日志，为旧卡组回填最近校验版本。
- `0013_add_deck_point_snapshot_facts.sql` 为公共牌桌票据和对局卡组快照回填 PT 版本、总点数和上限。
- 后续小迁移扩展审计动作，区分“被新版本替代”、“排期被取消”与“管理员手动废弃”。`0016_allow_deck_point_table_admin_control.sql` 允许废弃未发布草稿、删除已退役表及其审计记录，并补齐通用编辑/原子替换的审计动作。

## 初始版本

- 旧表版本 `2026-04-03`，生效时间 `2026-04-03 00:00:00 Asia/Shanghai`（UTC `2026-04-02 16:00:00`）。
- 新表版本 `2026-08-08`，生效时间 `2026-08-08 00:00:00 Asia/Shanghai`（UTC `2026-08-07 16:00:00`）。
- 若迁移在新表生效时刻前执行，旧表为 ACTIVE、新表为 SCHEDULED；若在该时刻后执行，则直接以新表为 ACTIVE。

## 部署与校验

1. 在应用代码切换前执行 Drizzle 迁移；新列经回填后才设为 NOT NULL。
2. 确认 `deck_point_tables` 有且仅有一条 ACTIVE，同时最多一条 SCHEDULED，两张初始表条目数与已确认源一致。
3. 在北京时间边界前后分别读取公开 current 接口，并用同一卡组核对服务端保存/对局准入使用的版本。
4. 抽查旧 `decks`、`public_table_tickets`、`match_deck_snapshots` 的回填事实，再解除维护窗口。

迁移不修改卡牌基础数据，也不要求在 `docker/init.sql` 预创建由 Drizzle 拥有的表。
