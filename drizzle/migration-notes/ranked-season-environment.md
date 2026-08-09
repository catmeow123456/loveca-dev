# 赛季环境卡牌使用率迁移说明

> 适用范围：`0020_add_ranked_deck_observations.sql`、当前赛季历史卡组观察事实回填

## 统计口径与数据边界

- 运行时在排位对局注册事务内，从双方已锁定的卡组快照保存长期观察事实；只保存主卡组的基础编号、代表卡名/图片、卡牌类型和张数，不保存卡文、能量卡、卡组名或来源卡组 ID。
- 同一基础编号的不同罕度合并计算。公开榜单只统计最终 `SETTLED` 且双方观察完整、身份一致的对局；`PENDING`、`VOIDED` 和平台无结果不计入。
- 卡牌使用率先计算每名玩家使用该卡的对局占比，再对全部参赛玩家等权平均，避免高频玩家主导结果。页面只展示前 30 张；原始卡组搭载率、搭载玩家数和平均张数保留在接口中但暂不展示。
- 10 天保留策略继续清理原始回放：时间线、检查点、事件和决策记录会删除，`match_deck_snapshots.main_deck`、`energy_deck`、`card_summaries` 会清空，对局变为 `METADATA_ONLY`。长期保留的只有每场双方各一条精简观察事实，以及原有对局/卡组来源元信息；观察中的主卡组按基础编号聚合为 `{ baseCardCode, cardCode, name, cardType, count, imageFilename? }`，不保留逐张实例或能量卡组。
- `ranked_deck_observations` 当前不参与 10 天清理，用于跨赛季统计和管理员历史对局主卡组核查，并会随排位场次增长。清理脚本发现任一过期排位候选尚未保存双方完整且身份一致的事实时，会报告 `blockedRankedMatchCount` 并在 apply 前整体阻断；不能跳过该对局继续清理，也不能伪造缺失事实。

## 当前赛季停机回填

1. 停止 API、排位开局、结算和评分参数修订，完成并验证 PostgreSQL 备份。
2. 执行 `pnpm db:migrate`，确认 `ranked_deck_observations` 及其约束和索引已经建立。
3. 对目标赛季的稳定 `seasonKey` 执行只读预览：

```bash
DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<赛季-key>
```

4. 核对 `matchCount`、`backfillableMatchCount`、`wouldInsertObservationCount`、`earliestObservedAt` 和 `ledgerRevision`，并确认 `blockers=[]`。任何 `METADATA_ONLY`、缺席卡组快照、玩家不一致、非 60 张主卡组或无效卡牌摘要都会阻止完整回填；不得伪造缺失事实。
5. 保持停写，使用预览中的评分流水版本显式执行：

```bash
DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<赛季-key> \
  --apply --yes --expected-ledger-revision=<dry-run-ledgerRevision>
```

6. 再次 dry-run，预期 `wouldInsertObservationCount=0`、`alreadyCompleteMatchCount=matchCount`、`blockers=[]`。随后部署同一版本的 API 与前端，检查目标赛季 `/api/ranked/environment?seasonId=<uuid>` 的覆盖率，并在管理端抽查已回填对局的双方主卡组后再恢复服务。

脚本默认 dry-run，正式执行必须同时提供 `--apply --yes` 和核对过的 ledger revision；重复执行不会覆盖既有事实，若既有记录与当前快照冲突则事务回滚。已被 10 天任务清空的卡组快照无法从现有元数据恢复，应保留 blocker 报告并接受覆盖率不足，或在仍可恢复的备份上完成回填。

`0020` 只创建持久表和约束，不会自动回填历史数据；新版运行时只负责捕获部署后的新排位对局。因此当前赛季必须在原始卡组明细仍处于 10 天窗口内时单独执行上述回填。回填与新版运行时均就绪后，继续执行原有 10 天清理即可释放完整回放占用的空间，精简观察事实不会阻止已完整留存的排位对局被清理。
