# 历史迁移说明

> 文档类型：历史参考
> 适用范围：早期外部托管方案的迁移背景与当前替代来源
> 当前状态：已过时，不作为当前部署或迁移来源

Loveca 早期曾使用外部托管数据库、鉴权和对象存储方案。当前项目已经迁移到自托管 Express API、JWT 鉴权、PostgreSQL/Drizzle schema 和 MinIO 对象存储。

当前项目事实：

- 数据库 schema 以 `src/server/db/schema.ts` 和 `drizzle.config.ts` 为代码侧来源。
- API 读写权限由 Express 路由、JWT、`requireAuth` 和 `requireAdmin` 控制，不依赖数据库行级安全策略。
- 用户表是自托管 `users`。
- 图片存储使用 MinIO，并通过 `/images/*` 代理访问。
- `profiles.deck_count` 和 `decks.updated_at` 不由卡组路由手动维护；若数据库由根目录 `docker/init.sql` 初始化，则会由该脚本中的 PostgreSQL 触发器维护。Drizzle schema 本身不表达这些触发器。
- 当前 `docker/init.sql` 已包含运行时代码使用的卡组分享字段。

如果需要生成新的正式迁移，请基于当前 Drizzle schema 和 `docker/init.sql` 中仍被运行时依赖的函数/触发器重新整理，不要沿用早期历史迁移方案。
