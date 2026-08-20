# 回放保留策略紧急数据库重建 Runbook

> 文档类型：专题说明 / 运维 runbook
> 适用范围：PostgreSQL 数据卷空间不足，无法在源库执行回放保留期清理与物理重整时，将 Loveca 生产数据库在外部暂存库清理后重建回生产库
> 当前状态：现行应急预案；只在明确授权的停机窗口使用，不是日常回放清理的替代方案

## 1. 目的与边界

当生产 PostgreSQL 所在数据卷接近写满时，不能在源库直接运行大批量 `DELETE`、`VACUUM FULL` 或 `pg_repack`：前者会产生 WAL 和死元组，后两者会建立新表副本并需要额外空间。本 runbook 的目标是把重整工作转移到有足够容量的隔离暂存库，再将**已经按保留策略清理的逻辑备份**恢复到生产库。

这不是“导出原库、删除、再原样导回”。原样恢复会重新占用几乎同样的空间。正确结果是：完整历史根记录、参与者、卡组来源元信息和独立的排位卡组观察仍存在；超过保留期的 timeline、checkpoint、公开/私密事件、决策记录和卡组明细不再存在，根记录为 `METADATA_ONLY`。

本 runbook 只处理 PostgreSQL 数据库。MinIO/S3 对象、Nginx 配置、TLS、应用镜像和宿主机日志另行备份并核对。生产发布的共同行为仍以[生产发布 Runbook](../production-release-runbook.md)为准。

## 2. 禁止使用 Drizzle Studio 作为迁移工具

不要通过 `pnpm db:studio` 在浏览器逐表导出，再手动删除和上传表数据。

- Studio 是数据库浏览和 CRUD 工具；官方文档说明本地 Studio 面向本地开发，默认只监听 `127.0.0.1`，不适合直接部署到远程 VPS。[Drizzle Studio 文档](https://orm.drizzle.team/docs/drizzle-kit-studio)
- 即使所用 Studio 版本提供 XLSX/表数据导出，它也不是 PostgreSQL 逻辑备份：不会作为一个原子一致性快照保存 schema、扩展、索引、约束、序列、权限、触发器和跨表引用。
- 本项目的回放数据分散在 `match_records`、`match_participants`、`match_deck_snapshots`、`match_timeline_entries`、`match_checkpoints`、`match_record_public_events`、`match_record_private_events` 和 `match_decision_records`；浏览器分批导出会在导出期间失去一致性，且手动导回的顺序和序列值极易出错。
- 禁止在 Studio 或 SQL 控制台中临时 `DROP`、`TRUNCATE` 或强制删除单张对局表来“腾空间”。这会绕过 `purge-expired-match-replay-data.ts` 对排位卡组观察的保护，也可能破坏仍需保留的元数据与外键关系。

使用 PostgreSQL 的 `pg_dump` / `pg_restore` 进行整库逻辑备份和恢复。`pg_dump` 可生成一致性快照；custom archive 支持内容核对与恢复选择。[PostgreSQL `pg_dump` 文档](https://www.postgresql.org/docs/current/app-pgdump.html) [PostgreSQL `pg_restore` 文档](https://www.postgresql.org/docs/current/app-pgrestore.html)

## 3. 角色、容量与停机前置条件

| 项目     | 必须满足的条件                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 授权     | 由有生产数据库删除权限的负责人明确批准；记录维护窗口、负责人和回滚联系人。                                                            |
| 生产状态 | 先将站点设为 `MAINTENANCE`，停止 API、定时任务和所有其他写入者；不允许仍有对局、候场、评分或管理员写操作。                            |
| 暂存库   | 独立 PostgreSQL 实例，版本、locale、encoding 与所需扩展兼容，容量至少容纳当前完整库、清理处理和最终备份。不可与生产近满的数据卷共用。 |
| 备份位置 | dump 只写入加密的远端存储或暂存机，不落在生产近满的数据卷；访问权限仅限运维人员。                                                     |
| 恢复通路 | 暂存机能直接连接生产 PostgreSQL，或有等价的安全传输通道；这样最终 `pg_restore` 不需要先把 archive 拷回生产宿主机。                    |
| 工具     | `pg_dump` / `pg_restore` 客户端版本不低于源 PostgreSQL 主版本；暂存库已验证 `pg_isready`。                                            |
| 容量门槛 | 在执行源库删除前，确认“最终紧凑库大小 + WAL + 索引恢复峰值 + 至少 20% 余量”小于生产卷可用容量。若不满足，停止，不删除源库。           |

逻辑恢复不迁移 cluster 级角色和 tablespace；需要时另以 `pg_dumpall --globals-only` 备份，并按最小权限在目标恢复。不要把含口令的 globals 文件放到工作树、聊天记录或公开对象存储。

## 4. 标准流程

以下变量仅表示概念；实际连接串通过受控密钥、`.pgpass` 或部署密钥提供，绝不回显到日志：

- `SOURCE_DATABASE_URL`：当前生产业务数据库。
- `STAGING_DATABASE_URL`：隔离暂存数据库。
- `PRODUCTION_RESTORE_URL`：重建后生产空数据库的连接串。
- `BACKUP_HOST` / `ARCHIVE_DIR`：有加密存储与严格访问控制的暂存位置。
- `CUTOFF`：本次固定的 ISO 截止时间。所有 dry-run、apply 和验收均使用同一个值，避免跨日漂移。

### 4.1 盘点并冻结写入

1. 在维护公告中说明数据库维护，不接受新对局和写入。
2. 依照生产发布 Runbook 停止 API 与所有独立 worker；保留 PostgreSQL 本身运行以供导出。
3. 确认没有业务连接和进行中的写事务。连接无法清空时，保持停机并处理连接来源；不要先使用强制删库。
4. 记录 PostgreSQL server/client 版本、数据库总大小、最大表、当前 schema migration 状态，以及源库 `match_records` 汇总。
5. 在**源库**运行清理脚本 dry-run，固定并保存 `CUTOFF`、候选局数、各类子记录行数和排位 blocker 数。若 `blockedRankedMatchCount > 0`，先完成排位卡组观察回填或修复，严禁跳过保护。

建议盘点 SQL（只读）如下：

```sql
SELECT
  n.nspname AS schema_name,
  c.relname,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_total_relation_size(c.oid) AS total_size_bytes
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'm', 't')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 30;

SELECT completeness, count(*)
FROM match_records
GROUP BY completeness
ORDER BY completeness;
```

### 4.2 建立并验证不可变源备份

1. 在源库已停写的状态下，导出 cluster globals（如适用）和业务数据库 custom archive 到 `BACKUP_HOST`。导出客户端可以在受控运维机运行，archive 输出经受控通道直接写入远端；生产宿主机不得产生完整本地文件。
2. 为每个 archive 写入 SHA-256、文件长度、创建时间、源 PostgreSQL 版本和对应 git SHA。
3. 在远端执行 `pg_restore --list`，确认 archive 可读；再在暂存库恢复该 archive。
4. 核对暂存库与源库的数据库大小、关键表行数、`match_records` 状态/完整度汇总、排位 ledger/观察记录总数。任一不一致即停止，不得继续清理源库。

custom archive 的恢复可在有多核和足够 I/O 的暂存机并行运行；并行恢复的 archive 必须是常规文件或目录，不能依赖 stdin 管道。[PostgreSQL `pg_restore` 文档](https://www.postgresql.org/docs/current/app-pgrestore.html)

### 4.3 仅在暂存库执行回放保留清理

1. 在与源库相同的已审查代码版本中，对 `STAGING_DATABASE_URL` 先运行：

   ```bash
   pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts \
     --dry-run --cutoff="$CUTOFF"
   ```

2. 比较报告与源库的 dry-run；候选数和 blocker 结论必须一致。若不一致，停止并查明原因。
3. 明确授权后才在暂存库执行：

   ```bash
   pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts \
     --apply --yes --cutoff="$CUTOFF" --batch-size=100
   ```

4. 立即对暂存库以相同 `CUTOFF` 再跑一次 dry-run。它必须报告 `candidateMatchCount=0`、`metadataRowsUpdated=0`，且没有排位 blocker。
5. 验证最近 10 天可读取回放，过期封存记录均为 `METADATA_ONLY`，以及 `ranked_deck_observations` 与评分相关表未被删除。

本阶段不需要 `VACUUM FULL`。从已清理的暂存库重新做一次逻辑 dump 时，dump 只包含存活数据，不包含死元组，因此最终 archive 已完成逻辑压缩。

### 4.4 生成、验证最终紧凑备份

1. 从清理后的暂存库生成新的 custom archive，命名为 `loveca-replay-retention-<CUTOFF>-compact`，并保存 SHA-256、字节数和清理报告。
2. 用 `pg_restore --list` 验证 archive；在独立可丢弃数据库或另一台验证机完成一次实际恢复和上述关键汇总核对。仅有 archive 列表或 checksum 不能替代实际恢复验证。
3. 记录最终 archive 大小，并依据第 3 节容量门槛确认生产卷恢复后仍有余量。未满足时保持原生产库停机，不进行删除；改为扩容或使用容量更大的生产数据卷。

### 4.5 删除源库并恢复紧凑库

这是唯一不可逆阶段。开始前必须同时具备：源 archive、已清理 compact archive、两者 SHA-256、暂存恢复验证记录，以及明确的删除授权。

1. 再次确认 API/worker 未启动、没有活动连接，并记录源库名称和目标实例。`DROP DATABASE` 必须从其他 maintenance 数据库连接执行，不能连接到目标数据库本身。
2. 使用 PostgreSQL 官方 `dropdb` / `DROP DATABASE` 删除**确认无误的业务数据库**，而不是手动删除容器卷、`PGDATA`、Docker volume 或宿主机目录。`DROP DATABASE` 会删除该数据库的数据目录且不可撤销。[PostgreSQL `DROP DATABASE` 文档](https://www.postgresql.org/docs/current/sql-dropdatabase.html)
3. 在同一 production PostgreSQL cluster 创建空业务数据库，按前置决策恢复必要角色、权限和扩展。
4. 由暂存机或受控运维机直接对 `PRODUCTION_RESTORE_URL` 执行 `pg_restore`，读取仍在远端的 compact archive；不要先把 archive 复制回生产宿主机。
5. 恢复后执行应用 schema migration 检查。若 archive 的 migration journal 与待部署代码一致，迁移应为 no-op；如本次发布另有 schema 迁移，仍按生产发布 Runbook 的顺序执行，不得混入本预案。

### 4.6 恢复服务与验收

在重新开放站点前，至少验证：

- 数据库可连接，应用 `/api/health` 可响应；
- schema migration 状态与待启动 API 一致；
- `match_records` 总数、按 `completeness` 汇总、参与者数、排位 ledger 与 `ranked_deck_observations` 汇总符合暂存验证记录；
- 使用固定 `CUTOFF` 查询时，没有仍为完整回放的过期封存记录；
- 近 10 天历史可以打开，过期历史只显示元数据，不会造成回放读取错误；
- 新建一局非排位和一局排位的关键读写流程在受控验证中正常；
- 生产卷剩余空间达到预设余量，WAL 目录没有异常增长。

完成验收才启动 API/worker、解除 `MAINTENANCE`，并在操作记录中写入 archive 位置、hash、实际恢复时间、空间前后值、异常与负责人。

## 5. 失败处理与回滚

| 阶段                                   | 处理                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 源 archive 无法验证或暂存恢复不一致    | 源库尚未删除：保持停机，修复导出/网络/权限后重新导出。                                         |
| 暂存清理被排位观察 blocker 阻断        | 不删除源库；先按既有停机工具完成观察回填并重新 dry-run。                                       |
| compact archive 不可恢复或容量门槛不足 | 不删除源库；保留源 archive，改为增加暂存/生产容量。                                            |
| 源库删除后 compact restore 失败        | 保持生产停机，从远端已验证的**源 archive**恢复原始库；明确接受维护开始后没有新增写入这一前提。 |
| 服务恢复后业务校验失败                 | 立即重新设为维护；若可定位为配置/权限问题先修复；数据不可信时从源 archive 恢复，不手改单表。   |

逻辑备份只保证其快照时刻的数据。为保证回滚不会丢失维护窗口前后写入，本 runbook 要求在源导出前先停止所有写入者，并在最终验收完成前不重新开放服务。

## 6. 后续防复发

- 平台管理员“数据维护”页已提供 10 天回放清理预览与显式确认执行，以及赛季积分波动 JSON/Markdown 下载；它不调用 shell，也不把报告写入 API 容器。自动低峰调度与持久化操作审计仍是后续工作。日常任务只应做保留期逻辑清理和 `VACUUM (ANALYZE)`，不在网页中执行 `VACUUM FULL`。
- 为 `match_records` 和回放子表建立容量、WAL、autovacuum、死元组和增长率告警；在剩余空间仍充足时处理异常。
- 长期评估按保留时间分区回放数据，使过期数据可通过删除分区回收空间，而非在大表中持续 `DELETE`。
- 本预案完成后，将实际数据库规模、保留期吞吐与所需空间余量反馈到生产容量预算，但不要把任何生产连接串、用户数据或 archive 路径提交到仓库。
