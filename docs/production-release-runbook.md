# Loveca 生产发布 Runbook

> 文档类型：专题说明
> 适用范围：当前自托管生产发布、部署前检查、部署步骤、健康检查和回滚
> 当前状态：2026-06-15 最小发布 runbook；生产 Nginx、TLS、对象存储和备份实现仍由部署环境维护

本文记录当前仓库能够稳定承接的生产发布步骤。它不是完整 IaC 方案，也不表示生产 `docker-compose.yml` 已覆盖前端、Nginx、MinIO、TLS 或自动迁移任务。

## 1. 当前生产边界

- `Dockerfile` 只构建 API runtime 镜像，运行入口为 `dist/server/index.js`。
- 生产 `docker-compose.yml` 只包含 Postgres 和 API。
- 前端 `client/dist` 需要部署到独立静态服务或 Nginx 管理的目录。
- 生产图片访问应由 Nginx 或其他反向代理将 `/images/*` 转发到外部 MinIO / S3 兼容对象存储；生产 API 不直接提供 `/images` 静态兜底。
- `/api/health` 当前只表示 API 进程可响应。数据库、对象存储和必要函数的 ready check 尚未独立落地。
- `pnpm db:migrate` 需要在有源码、devDependencies 和生产 `DATABASE_URL` 的发布环境中执行；不要假设 API runtime 镜像内可以执行 Drizzle CLI。

## 2. 版本与 tag

- 产品版本以根目录 `VERSION` 为准。
- 根 `package.json` 与 `client/package.json` 的 `version` 必须和 `VERSION` 保持一致。
- 前端构建产物中的 `version.json` 使用 `VERSION` 作为 `version`，使用提交 SHA 或 `VITE_APP_BUILD_ID` 作为 `buildId`。
- 发布 tag 使用 `vX.Y.Z` 格式，并且必须等于 `v${VERSION}`。
- 正式发布建议使用 annotated tag：

  ```bash
  git tag -a v3.3.0 -m "发布 v3.3.0"
  git push origin v3.3.0
  ```

## 3. 发布前检查

1. 确认 CI 或本地等价命令通过：

   ```bash
   pnpm install --frozen-lockfile
   pnpm version:check
   pnpm typecheck:all
   pnpm test:run
   pnpm build:server
   pnpm --dir client build
   ```

2. 检查工作树和发布差异：

   ```bash
   git status --short
   git diff --stat main...HEAD
   ```

3. 检查临时本地补图不要进入发布提交：

   ```bash
   git status --short assets/card assets/images
   git diff --stat -- assets/card assets/images
   ```

4. 确认生产环境变量已准备，且没有使用示例密钥或占位值：

   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `DATABASE_URL`（迁移环境使用）
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `MINIO_ENDPOINT`
   - `MINIO_PORT`
   - `MINIO_ACCESS_KEY`
   - `MINIO_SECRET_KEY`
   - `MINIO_BUCKET`
   - `MINIO_USE_SSL`
   - `FRONTEND_URL`

5. 确认备份可用：

   - Postgres 已完成发布前 dump，且记录了恢复命令和备份文件位置。
   - 对象存储 bucket 已有独立备份或快照。
   - 如果本次包含数据库迁移，确认迁移 SQL 已审查，并明确是否可逆。

## 4. 构建

在发布机或 CI 构建环境执行：

```bash
pnpm install --frozen-lockfile
pnpm version:check
pnpm build:server
pnpm --dir client build
docker compose build api
```

构建产物：

- API：Docker image 中的 `dist/server/index.js`
- 前端：`client/dist`

## 5. 数据库迁移

在生产数据库连接确认无误后执行：

```bash
DATABASE_URL='postgres://...' pnpm db:migrate
```

注意事项：

- 迁移前必须有 Postgres 备份。
- 不要用 `pnpm db:push` 代替生产迁移。
- 如果迁移包含数据修复，先在测试数据库验证可重复执行性和失败后的处理方式。
- `docker/init.sql` 包含部分 Drizzle schema 不表达的函数和触发器；新库初始化与已有库迁移不能混为一谈。

## 6. 部署

1. 部署 API：

   ```bash
   docker compose up -d postgres
   docker compose up -d --build api
   ```

2. 部署前端：

   - 将 `client/dist` 发布到生产静态目录或静态服务。
   - 确认 `manifest.webmanifest`、Service Worker 和 PWA 图标随前端产物一并更新。

3. 确认 Nginx / 反向代理路由：

   - `/`：前端静态资源。
   - `/api/`：转发到 API 的 `127.0.0.1:3007` 或对应内网地址。
   - `/images/`：转发到对象存储或图片代理，并设置适合静态图片的缓存策略。
   - `/.well-known/assetlinks.json`：如发布 Android TWA，必须指向当前签名对应的文件。

4. 确认 TLS、Host、上传体积限制和代理超时符合生产域名配置。

## 7. 发布后检查

1. 检查容器状态：

   ```bash
   docker compose ps
   docker compose logs --tail=120 api
   ```

2. 检查 API health：

   ```bash
   curl -fsS https://<domain>/api/health
   ```

3. 检查前端和核心静态资源：

   ```bash
   curl -fsS https://<domain>/
   curl -fsS https://<domain>/manifest.webmanifest
   ```

4. 检查图片代理：

   ```bash
   curl -I https://<domain>/images/static/deck.png
   ```

5. 做最小人工 smoke：

   - 登录或注册测试账号。
   - 打开卡组列表和卡牌图片。
   - 创建或进入联机房间。
   - 打开一局对战并确认基础同步正常。

## 8. 回滚

1. 前端回滚：

   - 将静态目录切回上一版 `client/dist`。
   - 清理或刷新 CDN / Nginx 缓存。
   - 确认 Service Worker 不再继续提供错误版本。

2. API 回滚：

   ```bash
   docker compose up -d --no-deps api
   ```

   回滚前需要将 compose 或镜像 tag 指回上一版 API image。

3. 数据库回滚：

   - 如果本次没有迁移，通常不需要恢复数据库。
   - 如果迁移可逆，按已审查的回滚 SQL 执行。
   - 如果迁移不可逆或数据已损坏，停止 API 写入后从发布前 Postgres dump 恢复。

4. 对象存储回滚：

   - 如果本次修改了图片或静态对象，按对象存储备份恢复对应 key。
   - 如果文件名未变化，恢复后刷新代理或 CDN 缓存。

5. 回滚后重新执行发布后检查，并记录失败原因、恢复步骤和是否需要补测试或脚本。

## 9. 后续改进

- 增加 `/api/ready`，检查 DB、必要数据库函数、对象存储和关键配置。
- 为生产 compose 增加 API healthcheck 和可选 migration job。
- 固化 Nginx 示例或部署 overlay。
- 补 Postgres / MinIO 备份恢复脚本或独立运维 runbook。
- 增加结构化日志、请求耗时日志、前端错误上报和告警入口。
