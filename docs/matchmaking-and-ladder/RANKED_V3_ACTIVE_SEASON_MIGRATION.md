# 活动排位赛季 V2→V3 停机迁移

> 文档类型：专题说明 / 运维 runbook
> 适用范围：当前活动排位赛季从 `GLICKO1_PER_MATCH_V2` 停机迁移至 V3
> 当前状态：迁移代码与工具已实现；生产 V2→V3 迁移尚未执行，默认只 dry-run
> 最后更新：2026-08-02

本文档只说明同一赛季的算法迁移；本次代码修改不执行、也不授权执行生产操作。

V3 保持初始 1500、RD 300、定级/参榜参数和软重置选择，只把 `ratingScale` 从 400 调为 800。迁移不新建赛季、不删除或改写 `ranked_rating_events / ranked_rating_event_steps`；工具为每个已有评分指令链追加同结果 V3 `REPLACEMENT`（最终为平台无结果时追加 `VOID`），用 V3 从赛季种子重放全部有效结果，将完整步骤快照挂到本批最后一条迁移指令，再原子替换玩家积分投影、对局算法标记和赛季冻结配置/竞技环境。迁移后玩家最近对局 delta、后续更正和全流水重放均以最新 V3 指令为准，老 V2 事件/步骤仍可审计。

## 停机、备份与 dry-run

1. 停止旧版应用、排位运行时清理任务和其他写入者，取完整数据库备份；通过既有管理操作将赛季候场设为 `PAUSED`，等待已配对/已开局对局结束并排空可靠结算。
2. 使用与目标数据库和当前发布卡池一致的环境变量运行：`pnpm ranked:v3:migrate -- --season-id=<uuid> --report=/安全路径/v3-dry-run.json`。`--report` 拒绝覆盖既有文件；不传 `--apply` 时不执行数据写入。
3. dry-run 会阻断：非 `ACTIVE/FINALIZING`、候场未暂停、任何 `PENDING` 排位对局、活动 WAITING/RESERVED 票据、待确认/建房中/未绑局预留、排位候场或对局占用；任一 `ranked_matches` 的 `rating_algorithm_version / rules_version / card_catalog_version / card_catalog_hash / deck_policy_version` 与所属赛季不一致，或 `match_records.rules_version` 与赛季不一致；当前发布卡池身份不同、V2 参数偏离发布值、revision/流水/当前投影无法一致重放。报告分别以 `rankedMatchEnvironmentMismatches` 和 `matchRecordRulesMismatches` 暴露环境漂移。已上线 V2 冻结 JSON 可缺少后加的 `ratingScale`，但只有此迁移边界会严格补为 400；正常运行时不做 fallback。
4. 审核报告的 `sourceLedgerRevision / targetLedgerRevision`、`appendedDirectiveCount`、`materializedMatchCount`、`playerChanges`和全部 blocker=0；另存备份编号、dry-run 报告和待执行 commit/image 身份。

## apply、验证与恢复入口

维持停机和 `PAUSED`，使用 dry-run 报告的 revision 显式执行：

```bash
pnpm ranked:v3:migrate -- --season-id=<uuid> --apply \
  --expected-ledger-revision=<dry-run sourceLedgerRevision> \
  --admin-user-id=<uuid> --report=/安全路径/v3-apply.json
```

apply 使用 `SERIALIZABLE` 单事务并重新加锁/检查前置；revision 变化或赛季条件更新不到唯一行时全部回滚。成功后在仍停机状态再运行一次 dry-run，必须返回 `alreadyApplied=true`、追加数 0，且 V3 重放与投影一致；同时核对赛季/所有 `ranked_matches` 的算法为 V3、每个有流水对局的最新指令为 V3、旧事件与旧步骤数量未减少、玩家积分/排名/最近 delta 与 apply 报告一致，然后部署只接受完整 `ratingScale` 配置的新版应用。恢复候场是独立管理操作，迁移工具不会自动 `OPEN`。

失败时不要手改积分或删除迁移事件：事务内失败可修复 blocker 后重新 dry-run；事务已成功但应用未能恢复时保持停机，以 apply 报告修复部署；只有经单独回滚决策才能从迁移前整库备份恢复，并明确接受备份后新增数据丢失。
