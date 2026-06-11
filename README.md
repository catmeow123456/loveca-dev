# Loveca

> 文档类型：总览文档
> 适用范围：项目入口、主要模块、运行与部署入口、主阅读路径
> 当前状态：现行入口；详细文档导航见 `docs/README.md`

Love Live 卡牌游戏的开源实现，包含游戏引擎、自托管 API 服务器和 Web 客户端。

## 项目结构

- `src/application`、`src/domain`、`src/shared`：共享对局引擎、规则、阶段配置与领域模型
- `src/server`：Express API、JWT 鉴权、PostgreSQL/Drizzle schema、MinIO 图片服务、正式联机房间与对局服务
- `src/online`：联机玩家视图投影、可见性和远程对局类型
- `client/src`：React/Vite 客户端、牌桌、卡组、管理后台与正式联机页面
- `assets/decks`：示例/预设卡组
- `docs`：需求、设计、编码标准和专题说明

## 文档入口

- [文档地图](docs/README.md)
- [项目总体需求](docs/PROJECT_REQUIREMENTS.md)
- [官方规则参考](detail_rules.md)
- [系统设计](game_system_design.md)
- [当前实现限制](docs/current-limitations.md)
- [联机模式总览](docs/online-mode-preparation.md)
- [卡组管理设计](docs/deck-management/design.md)
- [卡牌数据管理设计](docs/card-data-management/design.md)
- [Web 客户端说明](client/README.md)
- [后端开发规范](docs/coding-standard/dev-standard.md)
- [UI 规范](docs/coding-standard/ui-standard.md)
- [文档编写规范](docs/doc_writing_guide.md)

## 环境要求

- Node.js >= 20
- pnpm 10.x
- PostgreSQL，用于账号、卡组、卡牌和 token 数据
- MinIO 或兼容 S3 对象存储，用于卡牌图片；本地开发可用 `docker-compose.dev.yml`

## 常用命令

```bash
pnpm install
pnpm test:run
pnpm build
pnpm lint
pnpm typecheck
pnpm --dir client dev
pnpm --dir client build
```

## 本地开发入口

后端 TypeScript 监听编译：

```bash
pnpm dev
```

服务端运行入口依赖已编译的 `dist/` 和 `.env`：

```bash
pnpm build:server
pnpm dev:server
```

客户端开发服务器：

```bash
pnpm --dir client dev
```

本地 PostgreSQL / MinIO 可通过开发 compose 启动：

```bash
docker compose -f docker-compose.dev.yml up -d
```

## 数据库初始化

当前表字段的代码侧来源是 `src/server/db/schema.ts` 和 `drizzle.config.ts`，运行时代码也按该 schema 访问数据库。`docker/init.sql` 是本地开发和新库初始化的基线启动脚本；数据库存在后，后续结构变化应通过 `drizzle/` 下的 Drizzle 迁移文件进入。

```bash
pnpm db:migrate
```

首次接入迁移时会登记 `drizzle/0000_baseline_current_schema.sql` 这个 no-op 基线；后续新增迁移会继续按顺序执行。详细流程见 [Drizzle 数据库迁移](drizzle/README.md)。

早期外部托管方案仅作为历史参考，见 [历史迁移说明](docs/historical-migrations.md)，不作为当前部署脚本。

## 数据库可视化（Drizzle Studio）

项目已接入 Drizzle ORM 的 schema 映射，可直接使用 Studio 管理 PostgreSQL。

```bash
pnpm run db:studio
```

启动前请确保 `.env` 中存在可用的 `DATABASE_URL`，并且目标数据库已按当前 schema 和必要数据库函数完成初始化。

## 致谢

- [llocg_db](https://github.com/wlt233/llocg_db) — 本项目重要的卡牌数据源，提供了完整的 Love Live 卡牌游戏数据库（日文/中文）。感谢 [wlt233](https://github.com/wlt233) 的维护与贡献。
