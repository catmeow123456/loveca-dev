# Loveca

Love Live 卡牌游戏的开源实现，包含游戏引擎、自托管 API 服务器和 Web 客户端。

## 项目结构

- `src/application`、`src/domain`、`src/shared`：共享对局引擎、规则、阶段配置与领域模型
- `src/server`：Express API、JWT 鉴权、PostgreSQL/Drizzle schema、MinIO 图片服务、正式联机房间与对局服务
- `src/online`：联机玩家视图投影、可见性和远程对局类型
- `client/src`：React/Vite 客户端、牌桌、卡组、管理后台与正式联机页面
- `assets/decks`：示例/预设卡组
- `docs`：需求、设计、编码标准和专题说明

## 文档入口

- [项目总体需求](docs/PROJECT_REQUIREMENTS.md)
- [系统设计](game_system_design.md)
- [联机模式总览](docs/online-mode-preparation.md)
- [卡组管理设计](docs/deck-management/design.md)
- [卡牌数据管理设计](docs/card-data-management/design.md)
- [后端开发规范](docs/coding-standard/dev-standard.md)
- [UI 规范](docs/coding-standard/ui-standard.md)
- [文档编写规范](docs/doc_writing_guide.md)

## 数据库初始化

当前表字段的代码侧来源是 `src/server/db/schema.ts` 和 `drizzle.config.ts`，运行时代码也按该 schema 访问数据库。生产 `docker-compose.yml` 会挂载 `docker/init.sql` 作为自托管 PostgreSQL 初始化脚本；该脚本还包含 `cleanup_expired_tokens()` 等 Drizzle schema 不表达的数据库函数/触发器，因此新建部署前需要确认初始化脚本已与当前 schema 同步。

`docs/migrations/*.sql` 是早期 Supabase/RLS/Storage 方案的历史参考，不作为当前部署脚本。

## 数据库可视化（Drizzle Studio）

项目已接入 Drizzle ORM 的 schema 映射，可直接使用 Studio 管理 PostgreSQL。

```bash
pnpm run db:studio
```

启动前请确保 `.env` 中存在可用的 `DATABASE_URL`，并且目标数据库已按当前 schema 和必要数据库函数完成初始化。

## 致谢

- [llocg_db](https://github.com/wlt233/llocg_db) — 本项目重要的卡牌数据源，提供了完整的 Love Live 卡牌游戏数据库（日文/中文）。感谢 [wlt233](https://github.com/wlt233) 的维护与贡献。
