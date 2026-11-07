# 0047：近期分类窗口与历史结果保留

本迁移新增 `deck_classification_runs.scope_mode` 和 `deck_classification_assignments.is_current`。应用只读取迁移后的格式，前端的预览、发布、重分类请求须明确发送 `scopeMode: RECENT | FULL`。`RECENT` 固定为最近 200 场完整对局，日常自动任务和人工覆盖采用近期范围。

## 迁移与部署

按[生产部署 Runbook](../../docs/production-release-runbook.md)停机、备份、验证迁移并部署前后端；本说明不授权执行生产操作。停止全部旧 API 实例及分类进程后，通过 `pnpm db:migrate` 执行 `0047_deck_classifier_recent_window.sql`，不使用 `db:push`。

- 既有任务的范围初始化为 `FULL`，保留历史语义；尚在排队的自动补分类与人工覆盖任务改为 `RECENT`，新任务默认近期。
- 只从曾经成功服务的 `ACTIVE / SUPERSEDED` 发布及 `SUCCEEDED` 任务中，为每个席位选择版本最新的结果设置 `is_current=true`；不重写原来源版本、任务、证据或分类时间。失败/构建中的结果不成为当前结果。
- 部分唯一索引确保一个席位至多一条当前结果。后续分类在单个事务内切换所选席位的当前结果并完成任务；较久历史继续保留原判断。
- API 通过 `fork` 启动编译产物 `dist/server/deck-classifier-process.js`，无需增加 Compose 服务。候选镜像须包含该文件及其生产依赖；分类连接池最多 4 条，需计入每个 API 实例的数据库连接预算。进程退出自动重启，父进程退出时子进程关闭。

## 校验

在迁移演练库中检查当前结果数量、来源版本和唯一性；下列查询为只读：

```sql
SELECT scope_mode, status, count(*) FROM deck_classification_runs GROUP BY scope_mode, status;
SELECT release_id, count(*) FROM deck_classification_assignments WHERE is_current GROUP BY release_id;
SELECT match_id, seat, count(*) FROM deck_classification_assignments
WHERE is_current GROUP BY match_id, seat HAVING count(*) > 1;
```

运行 `tests/integration/deck-classification-window.test.ts` 可在独立内存 PostgreSQL 中验证实际迁移、200 场与全量结果一致、跨版本统计、发布幂等性和整批回滚；该测试不连接外部数据库。子进程生命周期由 `tests/unit/deck-classifier-process-runtime.test.ts` 验证，本地模拟界面用 `client/tests/e2e/deck-classifier-workflow.spec.ts` 验证范围选择。

部署验收关注分类子进程是否存活、自动任务是否只在近期存在缺失时入队、任务 `total_count` 是否符合范围，以及窗口外历史是否仍计入统计。全量任务与普通请求同时进行时，仍需观察宿主机 CPU、数据库负载和 API 事件循环延迟。

## 回滚边界

近期发布后，当前结果可能来自多个历史版本。旧应用只读取唯一 `ACTIVE` 版本，直接回滚旧镜像会漏掉窗口外历史，旧 worker 的写入也不会维护当前结果标记。需要回滚时，应在新程序下先完成全量统一，或在停机状态恢复迁移前数据库备份，并同步回滚前后端；不要让旧、新写入程序同时运行。
