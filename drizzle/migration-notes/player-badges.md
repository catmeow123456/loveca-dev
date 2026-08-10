# 首届排位纪念徽章迁移说明

> 适用范围：`0019_add_player_badges.sql` 与首届排位三场资格补发

## 变更与边界

- `player_badge_rules` 将徽章永久绑定到明确的来源赛季与资格版本；运行时不会动态改认其他赛季。
- `player_badges` 保存玩家的幂等授予记录和当时的有效计分场次、赛季评分流水版本证据。
- 首届排位徽章门槛固定为 `rated_match_count >= 3`。`VOIDED` 对局不进入该投影；徽章授予后不因普通更正自动撤回。
- 玩家接口只允许登录用户读取自己的徽章，本次不公开他人徽章、不提供玩家或管理员写入接口。

## 停机补发

1. 停止 API、排位运行时结算与评分参数修订，完成并验证 PostgreSQL 备份。
2. 执行 `pnpm db:migrate`，确认 `player_badge_rules`、`player_badges` 及其约束已经建立。
3. 对生产首赛季的稳定 `seasonKey` 执行只读预览：

```bash
DATABASE_URL=... pnpm badges:first-ranked:backfill -- --season-key=<首赛季-key>
```

4. 审核 `season`、`earliestPublicSeasonKey`、`minimumRatedMatchCount=3`、`ledgerRevision`、候选玩家和 `blockers=[]`。
5. 保持停写，使用预览中的评分流水版本显式执行：

```bash
DATABASE_URL=... pnpm badges:first-ranked:backfill -- --season-key=<首赛季-key> \
  --apply --yes --expected-ledger-revision=<dry-run-ledgerRevision>
```

6. 再次 dry-run，预期 `wouldAwardCount=0`，且规则绑定、候选数和已授予数一致；随后部署同一版本的 API 与前端并恢复服务。

不得通过手工修改 `source_season_id`、门槛或 `criteria_version` 改认赛季。选错赛季、流水版本变化或既有规则不一致都会阻止 apply，应保持停写并重新核对，不要删除授予记录重试。
