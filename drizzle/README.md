# Drizzle 数据库迁移

> 文档类型：专题说明
> 适用范围：`drizzle/` 迁移目录、数据库结构变更流程、本地开发和部署前迁移检查
> 当前状态：现行迁移规范；`0000` 为当前 schema 的 no-op 基线

本目录保存 Drizzle Kit 生成的迁移 SQL 与 schema 快照。`src/server/db/schema.ts` 是结构变更的代码侧来源；`drizzle/meta/` 记录 Drizzle 用于计算后续 diff 的快照，不应手工改动。当前完整物理 schema 由 `docker/init.sql` 的基础结构与本目录全部增量迁移共同形成。

`migration-notes/` 保存人工发布迁移说明，用来记录特定版本升级时的生产执行顺序、数据同步注意事项、验证 SQL 和回滚边界。这里的文档不是 Drizzle 可执行迁移，不会被 `pnpm db:migrate` 自动读取。

`data-migrations/` 保存版本绑定的一次性数据迁移脚本，例如旧数据格式转换或生产数据修复。这里的脚本也不会被 `pnpm db:migrate` 自动执行；必须按对应 `migration-notes/` 文档在维护窗口手动运行，并保留 dry-run、报告和验证 SQL。

## 当前基线

- `0000_baseline_current_schema.sql` 是 no-op 基线，只用于登记接入 Drizzle 时已经存在的基础结构。
- `meta/0000_snapshot.json` 是生成 `0000` 时的完整 schema 快照，后续迁移会基于它继续生成 diff。
- `0001` 及其后的迁移是当前 schema 的有序组成部分，新库和已有库都必须按迁移记录顺序执行。
- `docker/init.sql` 是本地开发和新库初始化的基础启动脚本，并承载 Drizzle schema 不表达的函数与触发器。它不得提前创建由非幂等增量迁移拥有的表，否则新库首次迁移会发生重复建表冲突。

## 本地新库

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

第一条命令会通过 `docker/init.sql` 初始化基础结构。第二条命令会登记 `0000` 基线，并按顺序执行仓库中现有的全部增量迁移。

## 现有数据库

在确认目标数据库已完成备份、满足对应 migration notes 前提且迁移记录与实际结构一致后，执行：

```bash
pnpm db:migrate
```

命令会跳过已登记迁移，并按顺序应用尚未执行的增量迁移。不要通过手工预建迁移拥有的表来伪造完成状态。

## 修改数据库结构

1. 修改 `src/server/db/schema.ts`。
2. 生成迁移：

   ```bash
   pnpm db:generate --name add_example_field
   ```

3. 审查新生成的 `drizzle/*.sql`，确认没有无关字段、重复约束或危险数据操作。
4. 在本地数据库执行：

   ```bash
   pnpm db:migrate
   ```

5. 运行相关测试，并同步更新受影响的需求、设计或运行文档。

共享变更不要用 `pnpm db:push` 代替迁移文件；`db:push` 适合临时本地试验，容易让数据库状态绕过仓库中的迁移历史。

## 维护规则

- 迁移 SQL 需要提交到仓库；`.gitignore` 只保留普通 SQL dump 为本地文件。
- 迁移文件按顺序追加，已经进入共享分支的迁移不要改写。
- 包含数据修复的迁移要写清楚前提、回滚风险和是否可重复执行。
- 一次性数据迁移脚本放在 `data-migrations/`，文件名带版本范围和动作，例如 `3.5.0-to-3.6.0-compress-match-replay-checkpoints.ts`。
- 如果确实需要重建基线，应单独评估现有环境的迁移记录和部署流程，不要只替换 `0000` 文件。
