# 赛季环境卡牌使用率迁移说明

> 适用范围：`0020_add_ranked_deck_observations.sql`、当前赛季历史卡组观察事实回填

## 统计口径与数据边界

- 运行时在排位对局注册事务内，从双方已锁定的卡组快照保存长期观察事实；只保存主卡组的基础编号、代表卡名/图片、卡牌类型和张数，不保存卡文、能量卡、卡组名或来源卡组 ID。
- 同一基础编号的不同罕度合并计算。公开榜单只统计最终 `SETTLED` 且双方观察完整、身份一致的对局；`PENDING`、`VOIDED` 和平台无结果不计入。
- 卡牌使用率先计算每名玩家使用该卡的对局占比，再对全部参赛玩家等权平均，避免高频玩家主导结果。页面只展示前 30 张；原始卡组搭载率、搭载玩家数和平均张数保留在接口中但暂不展示。
- 已结算场数和可分析观察由同一条 PostgreSQL 语句、同一语句快照计算；服务端会拒绝可分析场数大于已结算场数的异常结果，不通过覆盖率截断隐藏不一致。
- 10 天保留策略继续清理原始回放：时间线、检查点、事件和决策记录会删除，`match_deck_snapshots.main_deck`、`energy_deck`、`card_summaries` 会清空，对局变为 `METADATA_ONLY`。长期保留的只有每场双方各一条精简观察事实，以及原有对局/卡组来源元信息；观察中的主卡组按基础编号聚合为 `{ baseCardCode, cardCode, name, cardType, count, imageFilename? }`，不保留逐张实例或能量卡组。
- `ranked_deck_observations` 当前不参与 10 天清理，用于跨赛季统计和管理员历史对局主卡组核查，并会随排位场次增长。清理脚本发现任一尚未清理的过期排位候选缺少双方完整且身份一致的事实时，会报告 `blockedRankedMatchCount` 并在 apply 前整体阻断；不能跳过该对局继续清理，也不能伪造缺失事实。

## 当前赛季停机回填

1. 停止 API、排位开局、结算和评分参数修订，并暂停回放清理，完成并验证 PostgreSQL 备份。
2. 执行 `pnpm db:migrate`，确认 `ranked_deck_observations` 及其约束和索引已经建立。
3. 对目标赛季的稳定 `seasonKey` 执行只读预览：

```bash
DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<赛季-key>
```

4. 核对 `season`、`matchCount`、`settledMatchCount`、`backfillableMatchCount`、`wouldInsertObservationCount`、`projectedAnalyzedMatchCount`、`projectedCoverageRate`、`earliestObservedAt` 和 `ledgerRevision`。`blockers` 与 `irrecoverableGaps` 的处理方式不同：
   - `blockers` 包含缺席快照、玩家不一致、非 60 张主卡组、无效卡牌摘要、既有事实冲突或赛季/流水不一致；任何模式都不得绕过。
   - `irrecoverableGaps` 只包含已经变为 `METADATA_ONLY`、原始卡组明细无法从现有数据库恢复且尚无双方完整观察的对局。优先从已验证备份恢复；不能把其他数据错误归入此类。

### 分支 A：完整历史回填（默认且推荐）

5. 确认 `blockers=[]`、`irrecoverableMatchCount=0` 后，保持停写并使用预览中的评分流水版本执行：

```bash
DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<赛季-key> \
  --apply --yes --expected-ledger-revision=<dry-run-ledgerRevision>
```

6. 再次 dry-run，预期 `blockers=[]`、`irrecoverableMatchCount=0`、`wouldInsertObservationCount=0`、`alreadyCompleteMatchCount=matchCount`。随后部署同一版本的 API 与前端，检查目标赛季 `/api/ranked/environment?seasonId=<uuid>` 的样本量和覆盖率，并在管理端抽查已回填对局的双方主卡组后再恢复服务。

### 分支 B：接受不可恢复的历史缺口（例外）

只有同时满足以下条件时才能使用此分支：可验证备份也无法恢复卡组明细；`blockers=[]`；维护者已经逐项审核 `irrecoverableGaps`，书面接受对应的永久覆盖率缺口；本次批准的对局集合由 dry-run 中的 `irrecoverableMatchCount` 和 `irrecoverableMatchHash` 精确固定。

保持停写，原样复制 dry-run 的数量、哈希和 ledger revision：

```bash
DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<赛季-key> \
  --apply --yes \
  --expected-ledger-revision=<dry-run-ledgerRevision> \
  --allow-incomplete-history \
  --expected-irrecoverable-match-count=<dry-run-irrecoverableMatchCount> \
  --expected-irrecoverable-match-hash=<dry-run-irrecoverableMatchHash>
```

脚本仍会回填其余所有可恢复对局，并在同一可串行化事务中重新检查硬阻塞、缺口数量和缺口集合哈希。任一项变化都会整体回滚；`--allow-incomplete-history` 不能绕过玩家错配、非法卡组、既有事实冲突或其他 `blockers`。

成功报告应满足 `incompleteHistoryAccepted=true`、`wouldInsertObservationCount=0`，且 `alreadyCompleteMatchCount + irrecoverableMatchCount = matchCount`。普通 dry-run 仍会报告这组永久缺口并以非零状态退出，这是预期的审计信号；其 `irrecoverableMatchCount`、`irrecoverableMatchHash` 和 `projectedCoverageRate` 必须与批准记录一致。部署后检查环境接口的实际覆盖率，不得将其描述为全量历史。

脚本默认 dry-run；正式执行必须提供 `--apply --yes` 和核对过的 ledger revision。重复执行不会覆盖既有事实，若既有记录与当前快照冲突则事务回滚。例外分支只批准已经清理且无法重建的确定历史集合，不会放宽未来排位对局的运行时捕获或 10 天清理保护。

`0020` 只创建持久表和约束，不会自动回填历史数据；新版运行时只负责捕获部署后的新排位对局。因此当前赛季应在原始卡组明细仍处于 10 天窗口内时优先完成分支 A。回填与新版运行时均就绪后，继续执行原有 10 天清理即可释放完整回放占用的空间，精简观察事实不会阻止已完整留存的排位对局被清理。
