# 公共牌桌 Beta 一期结构迁移说明

适用迁移：`drizzle/0008_add_public_table_beta.sql`

## 变更内容

- 新增公共牌桌候场票据表，锁定卡组直接内嵌在票据中；
- 新增配对预留表；
- 新增跨公共候场、普通在线房间和正式对局的玩家占用表；
- 生命周期事件使用结构化应用日志，不新增事件明细表；
- 将对局记录 `origin_kind` 允许值扩展为 `ONLINE_ROOM / PUBLIC_TABLE / SOLITAIRE`。

## 执行

本迁移只新增三张表、索引、外键和检查约束，并替换 `match_records_origin_kind_check`；不转换已有对局记录。

```bash
pnpm db:migrate
```

上线时仍按停机迁移原则暂停旧版本和新对局写入。旧版本不知道 `PUBLIC_TABLE` 来源，迁移完成后应直接部署包含新枚举的新版本，不保留 dual-read。

## 验证

```sql
SELECT conname
FROM pg_constraint
WHERE conname IN (
  'gameplay_participations_kind_check',
  'public_table_reservations_state_check',
  'match_records_origin_kind_check'
)
ORDER BY conname;

SELECT indexname
FROM pg_indexes
WHERE indexname IN (
  'uq_public_table_tickets_active_user',
  'uq_public_table_tickets_requeued_from',
  'uq_public_table_reservation_ticket_pair'
)
ORDER BY indexname;
```

预期分别返回 3 条约束和 3 条唯一索引。

## 回滚边界

如果尚未产生 `PUBLIC_TABLE` 对局记录，可以停止服务后删除新增表，并把 `match_records_origin_kind_check` 恢复为只允许 `ONLINE_ROOM / SOLITAIRE`。一旦已经存在 `PUBLIC_TABLE` 记录，不得直接恢复旧约束；需要先保留备份并明确这些记录的迁移或失效策略。
