# AI 对战 Phase 3 数据库迁移说明

适用迁移：`drizzle/0010_simple_the_leader.sql`

## 变更范围

- `match_records.origin_kind` 增加 `AI_BATTLE`。
- `match_deck_snapshots.source` 增加 `AI_CERTIFIED_DECK`。
- `match_participants.system_identity_snapshot` 保存不可登录 SYSTEM v1 身份、精确卡组内容哈希、Phase 0 认证版本和策略版本绑定。
- `match_decision_records.strategy_record` 保存脱敏后的 `ai-battle.strategy-decision-record/v2`。
- `match_decision_records.decision_type` 增加 `AI_STRATEGY_SUBMITTED`。

策略记录和对应命令记录由同一次 `appendMatchRecordFrame` 数据库事务写入。普通玩家回放读取路径不选择 `strategy_record`，该字段只作为受限 SYSTEM/private 审计数据保留。

## 停机迁移步骤

1. 停止 API、后台清理任务和全部对局写入。
2. 完成 PostgreSQL 全量备份。
3. 在备份副本执行迁移，确认新增列、约束和既有对局数量。
4. 执行下列校验。
5. 部署只写新结构的服务版本，不保留旧约束或双写分支。

```sql
SELECT count(*) FROM match_records;
SELECT count(*) FROM match_participants;
SELECT count(*) FROM match_decision_records;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'match_records_origin_kind_check',
  'match_deck_snapshots_source_check',
  'match_decision_records_type_check'
)
ORDER BY conname;

SELECT count(*) AS invalid_system_snapshots
FROM match_participants
WHERE system_identity_snapshot IS NOT NULL
  AND participant_kind <> 'SYSTEM';

SELECT count(*) AS invalid_strategy_records
FROM match_decision_records
WHERE strategy_record IS NOT NULL
  AND decision_type <> 'AI_STRATEGY_SUBMITTED';
```

两个 invalid 结果必须为 0。迁移不会改写既有对局；旧记录的新增列保持 `NULL`。

## 回滚

尚未产生 `AI_BATTLE` 对局、`AI_CERTIFIED_DECK` 快照或 `AI_STRATEGY_SUBMITTED` 记录时，可以停机后删除两个新增列并恢复旧约束。一旦新类型已经写入，禁止直接恢复旧约束；应从迁移前备份恢复，或先明确这些记录的归档/失效策略后再执行停机转换。
