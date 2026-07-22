# Loveca 生产发布 Runbook

> 文档类型：专题说明
> 适用范围：当前自托管生产发布、部署前检查、部署步骤、健康检查和回滚
> 当前状态：2026-07-22 现行发布 runbook；生产 Nginx、TLS、对象存储和备份实现仍由部署环境维护

本文记录当前仓库能够稳定承接的生产发布步骤。它不是完整 IaC 方案，也不表示生产 `docker-compose.yml` 已覆盖前端、Nginx、MinIO、TLS 或自动迁移任务。

## 1. 当前生产边界

- `Dockerfile` 只构建 API runtime 镜像，运行入口为 `dist/server/index.js`。
- 生产 `docker-compose.yml` 只包含 Postgres 和 API；API 镜像由 `LOVECA_API_IMAGE` 指定，默认拉取 `ghcr.io/catmeow123456/loveca-api:latest`。
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

- API 镜像使用 `vX.Y.Z` 与 `sha-<12位提交>` 作为可追溯标签；`latest` 只在版本镜像验证通过后提升。生产部署可以拉取 `latest`，但必须记录实际 digest，回滚使用上一版版本标签或 digest。

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

   如启用 `EMAIL_ENABLED=true`，还必须配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、
   `SMTP_PASS` 与 `SMTP_FROM`；启用后注册邮箱必填且登录前必须完成验证。生产环境的
   `JWT_SECRET` 与 `JWT_REFRESH_SECRET` 必须分别使用不同的 32 字节以上随机值。

5. 确认备份可用：

   - Postgres 已完成发布前 dump，且记录了恢复命令和备份文件位置。
   - 对象存储 bucket 已有独立备份或快照。
   - 如果本次包含数据库迁移，确认迁移 SQL 已审查，并明确是否可逆。

## 4. 构建

在发布机或 CI 构建环境执行代码构建：

```bash
pnpm install --frozen-lockfile
pnpm version:check
pnpm build:server
pnpm --dir client build
```

构建并发布 API 镜像。推送 registry 与提升 `latest` 都是对外动作，执行前必须确认目标仓库、生产平台与用户授权；以下以 `linux/amd64` 为例，实际值必须与生产机一致。推送前分别检查版本标签与提交标签，不要把检查命令和推送命令合并成一段直接执行。任一标签已存在时不得覆盖：两个标签必须都存在、指向相同 digest，且 revision 与当前 `GIT_SHA` 一致，才能复用既有镜像；其他情况一律停止发布并核查。

```bash
API_IMAGE_REPOSITORY=ghcr.io/catmeow123456/loveca-api
RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
RELEASE_TAG="v${RELEASE_VERSION}"
GIT_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=12 HEAD)"
TARGET_PLATFORMS=linux/amd64

docker build --pull -t "loveca-api:release-candidate-${SHORT_SHA}" .
docker run --rm --entrypoint node "loveca-api:release-candidate-${SHORT_SHA}" --check dist/server/index.js
```

先分别执行并人工核对两个不可变标签；确认两个标签都不存在后，才执行后续推送：

```bash
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}"
```

两个标签都不存在时，再使用已确认的平台推送：

```bash
docker buildx build --pull \
  --platform "${TARGET_PLATFORMS}" \
  --label "org.opencontainers.image.source=https://github.com/catmeow123456/loveca-dev" \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --label "org.opencontainers.image.version=${RELEASE_VERSION}" \
  --tag "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}" \
  --tag "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}" \
  --push .

docker buildx imagetools inspect "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools create \
  --tag "${API_IMAGE_REPOSITORY}:latest" \
  "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect "${API_IMAGE_REPOSITORY}:latest"
```

若 GHCR package 为 private，发布机需要 package write 权限，生产机需要 package read 权限；token 只通过安全凭据注入，不写入仓库、命令参数或日志。发布记录必须保存版本标签、提交标签、平台与 digest。

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
- 如果发布包含认证凭据 v1 -> v2 切换，必须在停机窗口按 `drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md` 先执行 dry-run、处理占位邮箱账号并应用数据迁移，再部署只接受 v2 格式的 API。
- `docker/init.sql` 包含部分 Drizzle schema 不表达的函数和触发器；新库初始化与已有库迁移不能混为一谈。

## 6. 部署

1. 部署 API。先将 `LOVECA_API_IMAGE` 设为要部署的版本标签或 digest；紧急验证 `latest` 时也必须记录其实际 digest。生产机不得重新构建 API：

   ```bash
   export LOVECA_API_IMAGE=ghcr.io/catmeow123456/loveca-api:vX.Y.Z
   docker compose up -d postgres
   docker compose pull api
   docker compose up -d --no-build --no-deps api
   docker compose images api
   docker image inspect --format '{{json .RepoDigests}}' "${LOVECA_API_IMAGE}"
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
   export LOVECA_API_IMAGE=ghcr.io/catmeow123456/loveca-api:v上一版本
   docker compose pull api
   docker compose up -d --no-build --no-deps api
   ```

   优先使用发布记录中的上一版 digest；至少要使用不可变版本标签，不要用 `latest` 猜测上一版。

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
