# Drizzle 数据库迁移

> 文档类型：专题说明
> 适用范围：`drizzle/` 迁移目录、数据库结构变更流程、本地开发和部署前迁移检查
> 当前状态：现行迁移规范；`0000` 为当前 schema 的 no-op 基线

本目录保存 Drizzle Kit 生成的迁移 SQL 与 schema 快照。`src/server/db/schema.ts` 是结构变更的代码侧来源；`drizzle/meta/` 记录 Drizzle 用于计算后续 diff 的快照，不应手工改动。

## 当前基线

- `0000_baseline_current_schema.sql` 是 no-op 基线，只用于让 Drizzle 在现有数据库上登记“当前 schema 已存在”。
- `meta/0000_snapshot.json` 是生成 `0000` 时的完整 schema 快照，后续迁移会基于它继续生成 diff。
- `docker/init.sql` 是本地开发和新库初始化的基线启动脚本；数据库存在后，后续结构变化应通过 `drizzle/` 迁移进入。

## 本地新库

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

第一条命令会通过 `docker/init.sql` 初始化基线结构。第二条命令会登记 `0000` 基线，并在未来存在新增迁移时继续执行它们。

## 现有数据库

在确认目标数据库已经是当前基线结构后，执行：

```bash
pnpm db:migrate
```

当前只会执行 no-op 基线并写入 Drizzle 迁移记录。之后的 schema 变更会按新增迁移顺序继续应用。

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
- 如果确实需要重建基线，应单独评估现有环境的迁移记录和部署流程，不要只替换 `0000` 文件。
