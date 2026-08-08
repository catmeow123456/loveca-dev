# 排位评分参数修订迁移说明

> 文档类型：迁移运行说明
> 适用范围：`0017_add_ranked_rating_revisions.sql` 的停机执行、校验与回滚边界
> 当前状态：迁移已生成，尚未在生产执行
> 发布边界：先停止旧版服务和排位写入，完成备份与 schema 迁移后再部署新代码
> 最后更新：2026-08-09

## 变更

迁移新增 `ranked_rating_revisions`，用于保存每次全赛季回算的新旧完整 config、哈希、流水 revision、竞技环境、原因、操作人和预览摘要；`ranked_seasons.active_rating_revision_id` 指向当前已应用修订。现有赛季该字段保持 `NULL`，表示仍使用原始正式算法配置，不需要数据回填。

## 执行与验证

1. 停止应用服务、结算 worker 和排位写入，备份数据库。
2. 执行 `pnpm db:migrate`，确认 `0017` 成功登记。
3. 验证 `ranked_rating_revisions` 为空、现有 `ranked_seasons.active_rating_revision_id` 全为 `NULL`，原赛季 config、积分流水和投影没有变化。
4. 部署新代码后，先只调用修订历史读取和 dry-run 预览；不在排位开放期直接应用。

```sql
SELECT COUNT(*) FROM ranked_rating_revisions;
SELECT COUNT(*) FROM ranked_seasons WHERE active_rating_revision_id IS NOT NULL;
SELECT id, rating_algorithm_version, ledger_revision FROM ranked_seasons ORDER BY created_at;
```

## 回滚边界

在尚未应用任何修订时，可停机删除新外键/字段与空表后回退代码。一旦已生成修订记录和新积分事件，不得通过删表或回写原 config 回滚；必须保留追加式审计历史，选择旧 config 再执行一次受保护的全量回算。
