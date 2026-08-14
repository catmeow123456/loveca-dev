# Loveca 生产发布 Runbook

> 文档类型：专题说明
> 适用范围：当前自托管生产发布、部署前检查、部署步骤、健康检查和回滚
> 当前状态：2026-08-09 现行发布 runbook；生产 Nginx、TLS、对象存储和备份实现仍由部署环境维护

本文记录当前仓库能够稳定承接的生产发布步骤。它不是完整 IaC 方案，也不表示生产 `docker-compose.yml` 已覆盖前端、Nginx、MinIO、TLS 或自动迁移任务。

## 1. 当前生产边界

- `Dockerfile` 只构建 API runtime 镜像，运行入口为 `dist/server/index.js`。
- 生产 `docker-compose.yml` 只包含 Postgres 和 API；API 镜像由 `LOVECA_API_IMAGE` 指定，默认拉取 `ghcr.io/catmeow123456/loveca-api:latest`。
- 当前生产 API 镜像平台固定为 `linux/amd64`，这是部署契约而不是示例值。未来如需改变架构，必须先同步修改本 runbook 和发布 skill，并在展示新旧平台差异后取得单独明确授权。
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

- 独立的 `Release Tag Integrity` workflow 只做轻量完整性校验：不初始化子模块、不安装依赖，只检查 tag 与三处版本一致、tag commit 位于作者仓库 `main`，并再次确认该 SHA 已通过作者 `main` 的完整 `Quality Gates`。它不替代发布前门禁；必须先完成第 3 节检查，再推 tag。tag 守卫失败时不得创建 GitHub Release 或提升 `latest`；此前已推送的不可变版本/提交镜像可以保留核查，但不能推广为当前版本。

- API 镜像使用 `vX.Y.Z` 与 `sha-<12位提交>` 作为可追溯标签；`latest` 只在版本镜像验证通过后提升。生产部署可以拉取 `latest`，但必须记录实际 digest，回滚使用上一版版本标签或 digest。

## 3. 发布前检查

1. 先完成版本号、migration note、release description 和 release commit 的审查。这里仅审查相对于发布前作者 `main` 新增的 release-only diff，不重复审查已经通过 PR 合并的业务代码；发布提交通常只包含版本字段和必要发布文档，不得夹带新的业务代码、依赖、迁移 SQL 或 workflow。经授权推送到作者仓库 `main` 后，禁用子模块递归地 fetch 作者远端，要求远端 `main` 精确等于当前 HEAD。随后固定完整 `RELEASE_SHA`，并复用这个**同一 SHA** 的 GitHub Actions `Quality Gates`。仓库脚本会限定作者仓库、`main` push、完整 commit SHA 和 workflow，并进一步检查 run 内名为 `Quality Gates` 的 job；成功输出的 run ID 与 URL 必须进入发布记录：

   ```bash
   RELEASE_SHA="$(git rev-parse HEAD)"
   pnpm version:check
   node scripts/check-release-ci.mjs \
     --repo catmeow123456/loveca-dev \
     --sha "${RELEASE_SHA}"
   ```

   父提交、PR head、fork、tag run 或其他 SHA 的成功结果都不能复用。run 尚未完成时继续等待；缺失、失败、取消、超时、job 缺失、SHA 不同或查询失败时保持发布阻塞。用户在看到实际状态后可以明确授权执行下列本地完整检查，用于诊断或提前验证：

   ```bash
   pnpm install --frozen-lockfile
   pnpm version:check
   pnpm typecheck:all
   pnpm test:run
   pnpm build:server
   pnpm --dir client build
   ```

   本地检查结果必须逐项记录，但不会使远端 exact-SHA CI 变成成功，也不能解锁镜像推送、tag、GitHub Release、`latest` 或安装包分发。最终仍须等待远端 CI 成功。CI 因临时基础设施问题失败或取消时，可以核查后重跑同一 SHA；若需要修改代码或发布文件，则形成新的 release SHA，并从推送与 CI 门禁重新开始。若 exact-SHA CI 已成功，则跳过上述本地依赖安装、类型检查、测试和普通代码构建，避免重复执行同一质量门禁。

   等待 CI 时可以并行校对不写入 git 的 Release 文案、准备发布命令，并按第 4 节构建和检查不对外发布的 API、前端或 Android 候选产物。每个产物必须来自同一 `RELEASE_SHA`，且构建时不得存在会影响产物的未提交文件。版本字段、migration note 或其他跟踪文件一旦改变，原 SHA 与候选产物立即失效，必须形成新提交、重新推送、重新等待 CI，并重建受影响产物。CI 失败时，并行生成的候选产物不得发布。

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
   - `MINIO_WALLPAPER_BUCKET`（必须与公开 `MINIO_BUCKET` 不同，且不得允许匿名读取）
   - `MINIO_USE_SSL`
   - `FRONTEND_URL`

   玩家壁纸处理参数 `PLAYER_WALLPAPER_PROCESSING_CONCURRENCY`、
   `PLAYER_WALLPAPER_PROCESSING_TIMEOUT_SECONDS` 与
   `PLAYER_WALLPAPER_RETIRED_RETENTION_HOURS` 可以使用仓库默认值，但发布前必须结合生产
   API 的 CPU、内存、对象存储容量和保留政策完成核对。若启用管理员 AI 卡效提取，还必须配置
   `AI_EFFECT_EXTRACTION_ENCRYPTION_KEY` 与 `AI_EFFECT_EXTRACTION_ALLOWED_HOSTS`；主密钥必须是独立的
   32 字节随机值，不能使用示例或其他环境的密钥，上游只允许白名单中的公开 HTTPS 地址。请求超时、
   响应、卡图和并发上限是代码中的固定安全边界。AI 功能保持禁用时可以暂不配置主密钥，但不得保存或
   启用生产 AI 配置。

   如启用 `EMAIL_ENABLED=true`，还必须配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、
   `SMTP_PASS` 与 `SMTP_FROM`；启用后注册邮箱必填且登录前必须完成验证。生产环境的
   `JWT_SECRET` 与 `JWT_REFRESH_SECRET` 必须分别使用不同的 32 字节以上随机值。

5. 确认备份可用：

   - Postgres 已完成发布前 dump，且记录了恢复命令和备份文件位置。
   - 公开卡图 bucket 与玩家壁纸私有 bucket 均已有独立备份或快照；首次启用玩家壁纸时，
     还要验证私有 bucket 不存在匿名读取策略，并记录容量告警和孤立对象清理边界。
   - 如果本次包含数据库迁移，确认迁移 SQL 已审查，并明确是否可逆。

## 4. 发布产物构建

第 3 节的 CI 是质量门禁，不等于发布机已经取得可部署产物。所有产物必须来自同一个 `RELEASE_SHA` 并记录来源；不要为了“再检查一次”重复构建，但本次确实需要交付的产物仍必须生成。本地候选产物可以在 exact-SHA CI 运行期间并行构建和检查，以缩短等待时间；只有 CI 与候选产物检查都成功后，才可推送镜像、推 tag 或分发产物。GitHub Release 与 `latest` 还必须等待 `Release Tag Integrity` 成功。

前端 `client/dist` 若由本机交付，执行：

```bash
test "$(git rev-parse HEAD)" = "${RELEASE_SHA}"
pnpm install --frozen-lockfile
pnpm --dir client build
```

若前端由部署环境或独立产物 workflow 基于同一 SHA 构建，则不在本机重复构建，并在发布记录中保存构建来源。Android/PWA 产物按 Android 打包文档单独生成。

构建并发布 API 镜像。下面的本地候选构建、runtime 检查和 registry 只读查询可以与 CI 并行；推送镜像和提升 `latest` 必须等待 exact-SHA CI 与候选镜像检查成功，并在执行前展示目标仓库、固定生产平台 `linux/amd64` 和待执行动作以取得用户授权。常规发布不再单独询问架构；但检查发现已有镜像不是 `linux/amd64` 时必须阻断，不得自动沿用或改写目标平台。

```bash
API_IMAGE_REPOSITORY=ghcr.io/catmeow123456/loveca-api
RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
RELEASE_TAG="v${RELEASE_VERSION}"
GIT_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=12 HEAD)"
TARGET_PLATFORMS=linux/amd64
LOCAL_IMAGE="loveca-api:release-candidate-${SHORT_SHA}"
```

在开始本地候选构建或等待 exact-SHA CI 前，仅从 registry 读取并保存 `latest` 的发布起始快照。快照必须能区分“标签不存在”和“查询失败”，并记录引用、digest、平台集合、revision、version 与查询时间；它不是生产环境实际运行镜像，也不能充当部署回滚基线：

```bash
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:latest"
```

若 `latest` 不存在，将 `ABSENT` 作为有效起始状态记录。若因权限、网络或 registry 异常无法取得可靠快照，可以继续本地候选构建、CI 和不可变 `vX.Y.Z` / `sha-*` 镜像流程，但不得提升 `latest`；恢复查询能力后必须重新建立起始快照，再继续等待与提升流程。构建和推送不可变镜像均不要求访问生产机或读取生产环境当前镜像。

显式使用固定生产平台构建本地候选镜像，检查 runtime 入口和镜像实际平台：

```bash
docker build --pull --platform "${TARGET_PLATFORMS}" -t "${LOCAL_IMAGE}" .
docker run --rm --entrypoint node "${LOCAL_IMAGE}" --check dist/server/index.js
CANDIDATE_PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${LOCAL_IMAGE}")"
test "${CANDIDATE_PLATFORM}" = "${TARGET_PLATFORMS}"
docker image inspect "${LOCAL_IMAGE}"
```

推送前分别查询 `vX.Y.Z` 和 `sha-*` 两个不可变标签，不要把检查与推送合并执行：

```bash
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}"
```

两个标签都不存在时，才使用已通过候选检查的固定平台推送。如任一标签已存在，不得覆盖：只有两个标签都存在、指向相同 digest、平台集合均为 `linux/amd64`、revision 等于完整 `GIT_SHA` 且 version 等于 `RELEASE_VERSION` 时，才可复用既有镜像；其他情况一律阻断。

```bash
docker buildx build --pull \
  --platform "${TARGET_PLATFORMS}" \
  --label "org.opencontainers.image.source=https://github.com/catmeow123456/loveca-dev" \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --label "org.opencontainers.image.version=${RELEASE_VERSION}" \
  --tag "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}" \
  --tag "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}" \
  --push .

docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}"
```

推送后必须从 registry 返回值确认两个不可变标签指向相同 digest，平台集合均为 `linux/amd64`，revision 为完整 `GIT_SHA`，version 为 `RELEASE_VERSION`。任一项不符时停止，不得继续推 tag、创建 GitHub Release 或提升 `latest`。

推送 tag 并等待 `Release Tag Integrity` 成功后，才可提升 `latest`。提升前再次取得授权并重新查询 registry 的 `latest`，将此时的引用、digest、平台集合、revision、version 或 `ABSENT` 与发布起始快照逐项比较。任何变化都表示等待期间可能已有另一版完成提升：必须停止本次提升，展示差异并核对发布顺序；只有明确确认本版本仍应成为 `latest`、重新取得提升授权并以当前状态建立新的起始快照后才能继续。若当前 `latest` 存在但平台集合不是 `linux/amd64`，还必须单独取得针对架构变化的明确授权。

先完成查询与比较，不要把它和写入命令合并成一段无条件执行：

```bash
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:latest"
```

确认结果与起始快照一致后，才执行提升并复核：

```bash
docker buildx imagetools create \
  --tag "${API_IMAGE_REPOSITORY}:latest" \
  "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:latest"
```

提升后确认 `latest` 与不可变版本标签指向相同 digest，平台集合、revision 和 version 也完全一致；否则发布未完成，应停止部署并使用事前记录的旧 digest 回滚 `latest`。

若 GHCR package 为 private，发布机需要 package write 权限，生产机需要 package read 权限；token 只通过安全凭据注入，不写入仓库、命令参数或日志。发布记录必须保存：固定生产平台契约；候选平台/runtime 校验结果；`latest` 的发布起始快照与提升前复核结果；版本标签、提交标签和提升后 `latest` 各自的引用、digest、平台集合、revision 和 version；等待期间是否发现并处理并发变化；以及是否发生并获准架构变化。registry 的旧 `latest` 只用于回滚 `latest` 指针，不能代替第 6 节记录的生产部署回滚基线。

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
- 如果发布包含认证凭据 v1 -> v2 切换，必须在停机窗口按 `drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md` 先执行 dry-run；仅当报告中不存在 reset-required 或未知密码格式时才能 apply。部署必须包含兼容封装验证与首次登录自动升级，不能使用原 `v3.7.2` 的 reset-only 认证镜像。
- 如果发布包含赛季环境卡牌使用率，必须先停止 API、排位开局/结算、评分参数修订和回放清理，完成备份及 `0020_add_ranked_deck_observations.sql` 后，按 `drizzle/migration-notes/ranked-season-environment.md` 对当前赛季执行 dry-run。默认分支要求 `blockers=[]`、`irrecoverableMatchCount=0`；若已清理的 `METADATA_ONLY` 历史无法从备份恢复，只能在 `blockers=[]`、逐项审核并书面接受永久覆盖缺口后，使用同时固定缺口数量与 SHA-256 的受保护例外分支。apply 后必须确认所有可恢复对局均有双方观察，缺口集合与批准记录一致，再部署同一版本 API 与前端并恢复服务；不得用例外参数绕过玩家错配、非法卡组或既有事实冲突。
- 如果发布包含首届排位纪念徽章，必须保持 API、排位结算和评分参数修订停写，在结构迁移完成后按 `drizzle/migration-notes/player-badges.md` 使用显式首赛季 key 执行 dry-run；审核最早公开赛季、候选玩家和 ledger revision 后才能 apply。再次 dry-run 确认 `wouldAwardCount=0`，并部署同一版本的 API 与前端后，才可恢复服务。
- `docker/init.sql` 包含部分 Drizzle schema 不表达的函数和触发器；新库初始化与已有库迁移不能混为一谈。

## 6. 部署

1. 部署 API。只有进入实际生产部署时，才要求访问生产机并捕获当前 API 容器的镜像；这项读取不属于第 4 节构建、不可变镜像推送或 `latest` 提升的前置门禁。在修改 `LOVECA_API_IMAGE`、拉取新镜像或重建容器之前，先记录现有容器及其实际镜像：

   ```bash
   docker compose ps -a api
   CURRENT_API_CONTAINER_ID="$(docker compose ps -a -q api)"
   test -n "${CURRENT_API_CONTAINER_ID}"
   PREVIOUS_PRODUCTION_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "${CURRENT_API_CONTAINER_ID}")"
   PREVIOUS_PRODUCTION_IMAGE_ID="$(docker inspect --format '{{.Image}}' "${CURRENT_API_CONTAINER_ID}")"
   docker image inspect --format '{{json .RepoDigests}} {{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}' "${PREVIOUS_PRODUCTION_IMAGE_ID}"
   ```

   部署记录必须保存 `CURRENT_API_CONTAINER_ID`、`PREVIOUS_PRODUCTION_IMAGE_REF`、实际 image ID、与该镜像匹配的不可变 RepoDigest、平台、revision、version 和查询时间。若已有生产 API，但无法访问生产机、无法唯一确定现有容器，或无法把实际 image ID 对应到可重新拉取的不可变 RepoDigest，则停止部署并先恢复可靠回滚目标；这只阻塞本节部署，不否定此前已完成的候选构建、CI、不可变镜像或 `latest` 发布。首次部署确实不存在旧 API 容器时，须明确记录 `NONE` 并说明没有 API 镜像回滚目标。不得用 registry 的旧 `latest` 猜测当前生产版本。

   完成上述记录后，才将 `LOVECA_API_IMAGE` 设为要部署的版本标签或 digest；紧急验证 `latest` 时也必须先解析并记录其实际 digest。生产机不得重新构建 API：

   ```bash
   export LOVECA_API_IMAGE=ghcr.io/catmeow123456/loveca-api:vX.Y.Z
   docker compose up -d postgres
   docker compose pull api
   docker compose up -d --no-build --no-deps api
   docker compose images api
   docker image inspect --format '{{json .RepoDigests}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}' "${LOVECA_API_IMAGE}"
   test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${LOVECA_API_IMAGE}")" = "linux/amd64"
   ```

   部署后将本机镜像的 RepoDigest、平台、revision 和 version 与发布记录逐项核对；任一项不符时停止后续发布并按第 8 节回滚。

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
   export LOVECA_API_IMAGE='<第 6 节部署前记录的 PREVIOUS_PRODUCTION_REPO_DIGEST>'
   docker compose pull api
   docker compose up -d --no-build --no-deps api
   ```

   优先使用第 6 节从实际生产容器捕获的上一版不可变 RepoDigest。只有该 digest 确实不可用时，才可使用已经核对为同一镜像的不可变版本标签；不要用 registry 的旧 `latest` 猜测上一版，也不要仅凭计划部署版本推断生产实际运行版。

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
