# Loveca

Love Live 卡牌游戏的开源实现，包含游戏引擎、自托管 API 服务器和 Web 客户端。

## 数据库可视化（Drizzle Studio）

项目已接入 Drizzle ORM 的 schema 映射，可直接使用 Studio 管理 PostgreSQL。

```bash
pnpm run db:studio
```

启动前请确保 `.env` 中存在可用的 `DATABASE_URL`，并且数据库已按 `docker/init.sql` 初始化。

## 致谢

- [llocg_db](https://github.com/wlt233/llocg_db) — 本项目重要的卡牌数据源，提供了完整的 Love Live 卡牌游戏数据库（日文/中文）。感谢 [wlt233](https://github.com/wlt233) 的维护与贡献。
