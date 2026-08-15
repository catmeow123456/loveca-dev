# Loveca

> 文档类型：总览文档
> 适用范围：项目入口、主要模块、运行与部署入口、主阅读路径
> 当前状态：现行入口；详细文档导航见 `docs/README.md`

Love Live 卡牌游戏的开源实现，包含游戏引擎、自托管 API 服务器和 Web 客户端。

## 公网服务

当前可直接访问公网游戏服务：[loveca.lovelivefun.xyz](https://loveca.lovelivefun.xyz/)。

## 项目结构

- `src/application`、`src/domain`、`src/shared`：共享对局引擎、规则、阶段配置与领域模型
- `src/server`：Express API、JWT 鉴权、PostgreSQL/Drizzle schema、MinIO 图片服务、正式联机房间与对局服务
- `src/online`：联机玩家视图投影、可见性和远程对局类型
- `client/src`：React/Vite 客户端、牌桌、卡组、管理后台与正式联机页面
- `assets/decks`：示例/预设卡组
- `assets/.well-known`、`assets/pwa`：Digital Asset Links 输出与 PWA 安装图标
- `android/twa`：Android TWA 打包说明和 Bubblewrap 生成工程
- `docs`：需求、设计、编码标准和专题说明

## 文档入口

- [文档地图](docs/README.md)
- [项目总体需求](docs/PROJECT_REQUIREMENTS.md)
- [官方规则参考](detail_rules.md)
- [系统设计](docs/system-design.md)
- [当前实现限制](docs/current-limitations.md)
- [联机模式文档索引](docs/online-mode/README.md)
- [卡组管理设计](docs/deck-management/design.md)
- [卡牌数据管理设计](docs/card-data-management/design.md)
- [Android App 打包指南草稿](docs/android-app-packaging-guide-draft.md)
- [Web 客户端说明](client/README.md)
- [后端开发规范](docs/coding-standard/dev-standard.md)
- [UI 设计文档索引](docs/ui-design/README.md)
- [文档编写规范](docs/doc_writing_guide.md)

## 环境要求

- Node.js >= 20
- pnpm 10.x
- PostgreSQL，用于账号、卡组、卡牌和 token 数据
- MinIO 或兼容 S3 对象存储，用于卡牌图片和玩家私有壁纸；本地开发可用 `docker-compose.dev.yml`

## 常用命令

```bash
pnpm install
pnpm test:run
pnpm build
pnpm lint
pnpm typecheck
pnpm --dir client dev
pnpm --dir client build
pnpm android:pwa:build
pnpm android:twa:doctor
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

## 测试服务器一键重置

测试服务器可使用脚本清空测试数据库 volume，并在 tmux 中启动完整测试环境。脚本内置本地测试默认值，`.env` 只用于覆盖默认配置；不测试卡图上传时，无需额外配置 MinIO 访问密钥。

```bash
pnpm test-env:start
```

脚本会先加载本地测试默认值并校验对局启动必需配置，停止同名 tmux session，默认使用 compose project `loveca` 执行 `down -v` 清理数据库 volume，确认 `3007`、`5173`、`5432` 端口空闲后启动 Postgres。若配置指向本地 MinIO，也会启动并检查本地 MinIO；若指向远端 MinIO，则只检查远端 bucket 可读。数据库迁移完成后会从 `llocg_db` 同步卡牌数据，执行 card code / group name 标准化与校验，然后启动 API 和前端。API 健康检查通过后会自动注册默认测试用户，创建、激活且开放一个全年有效的“测试赛季”，并初始化一个全天开放的“测试主题赛季”。主题赛季卡组池使用 `assets/decks/` 中四副 DeckLog 示例卡组，自动形成 6 个等权组合：

- `decklog-1Y9J3S.yaml`：Liella! 加分星
- `decklog-222H9S.yaml`：Liella! 可香三神
- `decklog-1YWYS4.yaml`：μ's DGG混合
- `decklog-N33A0.yaml`：彩虹混合

两个测试赛季的时区均为 `Asia/Shanghai`，每天全天开放：

```text
test_player_1 / test_password_1
test_player_2 / test_password_2
```

需要保留现有测试数据库 volume 时，使用：

```bash
bash scripts/start-test-env.sh --no-db-rebuild
# 或：
pnpm test-env:start -- --no-db-rebuild
```

可通过环境变量覆盖脚本行为：

```bash
TEST_TMUX_SESSION=loveca-test \
TEST_COMPOSE_PROJECT=loveca \
TEST_FRONTEND_PORT=5173 \
TEST_RESET_DATA=0 \
TEST_USERS='alice:password123:Alice,bob:password123:Bob' \
pnpm test-env:start
```

可通过 `TEST_SEED_ADMIN_DECKS=0`、`TEST_SEED_RANKED_SEASON=0` 或 `TEST_SEED_THEME_SEASON=0` 分别跳过普通管理员卡组、测试排位赛季或测试主题赛季；主题赛季启用时仍会创建它依赖的四副 DeckLog 管理员卡组。排位赛季的标识、名称和时区可由 `TEST_RANKED_SEASON_KEY`、`TEST_RANKED_SEASON_NAME`、`TEST_RANKED_SEASON_TIME_ZONE` 覆盖；主题赛季对应使用 `TEST_THEME_SEASON_KEY`、`TEST_THEME_SEASON_NAME`、`TEST_THEME_SEASON_TIME_ZONE`。

启动后进入 tmux 查看日志：

```bash
tmux attach -t loveca-test
```

## 数据库初始化

当前表字段的代码侧来源是 `src/server/db/schema.ts` 和 `drizzle.config.ts`，运行时代码也按该 schema 访问数据库。`docker/init.sql` 负责本地开发和新库的基础结构、数据库函数与触发器；新库初始化后仍必须执行 `drizzle/` 下的全部增量迁移。由非幂等增量迁移创建的表不会提前放入 `docker/init.sql`，避免首次迁移时发生重复建表冲突。

```bash
pnpm db:migrate
```

迁移命令会先登记 `drizzle/0000_baseline_current_schema.sql` 这个 no-op 基线，再按顺序执行后续增量迁移。详细流程见 [Drizzle 数据库迁移](drizzle/README.md)。

早期外部托管方案仅作为历史参考，见 [历史迁移说明](docs/historical-migrations.md)，不作为当前部署脚本。

## 数据库可视化（Drizzle Studio）

项目已接入 Drizzle ORM 的 schema 映射，可直接使用 Studio 管理 PostgreSQL。

```bash
pnpm run db:studio
```

启动前请确保 `.env` 中存在可用的 `DATABASE_URL`，并且目标数据库已按当前 schema 和必要数据库函数完成初始化。

## 贡献者

- 开发者：[Eden](https://github.com/catmeow123456)、[aya](https://github.com/meiyikai001)
- 卡牌数据源：[wlt233 / llocg_db](https://github.com/wlt233/llocg_db)、鬼箱（小能苗）
