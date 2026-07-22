---
name: prepare-for-release
description: 发布前准备，包括确认并同步 VERSION、运行构建与验证检查、构建并发布 loveca-api Docker 镜像、构建 Android（PWA/TWA）发布材料、整理发布 tag 与发布清单
---

把当前代码准备成一次可发布的版本。本技能只负责“发布前准备与产物构建”，正式部署、迁移、健康检查和回滚以权威 runbook 为准，不在此重复实现。

## 权威文档（先读，不要凭记忆）

- `docs/production-release-runbook.md`：版本与 tag 规则、发布前检查、构建、迁移、部署、发布后检查、回滚边界。
- `docs/android-app-packaging-guide-draft.md` 与 `android/twa/README.md`：PWA/TWA 打包前置、候选包名、Bubblewrap 构建命令、Digital Asset Links 与签名要求。
- 如果上述文档与本技能步骤冲突，以文档为准，并提示需要同步更新本技能。

## 前置确认

1. 先和用户确认本次发布的目标版本号 `X.Y.Z`（语义化版本）。如果用户没给，根据改动性质给出建议（修复=patch、向后兼容功能=minor、破坏性变更=major），但不要擅自决定后直接改文件。
2. 确认当前分支与工作树状态：`git status --short`、`git diff --stat main...HEAD`，判断是否还有未提交或不该进入发布的改动。
3. 本技能涉及的对外动作（推送 tag、推送/提升 Docker 镜像、构建并分发安装包）必须先暂停并向用户确认；不要自动执行 `git push`、推送 `git tag`、`docker push` 或带 `--push` 的 `docker buildx build`。

## 一、版本号同步

产品版本以根目录 `VERSION` 为准，`version:check` 会强制三处一致，发布 tag 必须等于 `v${VERSION}`。

1. 更新版本号到目标值，并保持三处一致：
   - `VERSION`
   - 根 `package.json` 的 `version`
   - `client/package.json` 的 `version`
2. 运行一致性校验：

   ```bash
   pnpm version:check
   ```

   该脚本同时校验：版本是语义化版本、三处 `version` 一致、HEAD 上的 `v*` tag（或 CI 注入的 tag）等于 `v${VERSION}`。校验不通过必须先修复再继续。
3. Android `versionCode` 单独管理：`android/twa/loveca/twa-manifest.json` 的 `appVersionName` / `appVersionCode` / `appVersion` 与产品 `VERSION` 解耦。只有在本次要出新的 Android 包时才更新，且 `appVersionCode` 必须单调递增（参见 runbook「发布与运维」）；不要为了对齐产品版本而回退 `versionCode`。

## 二、发布前构建与验证检查

按 runbook「发布前检查 / 构建」执行等价命令，任一失败都视为阻塞项，必须修复后重跑：

```bash
pnpm install --frozen-lockfile
pnpm --dir client install --frozen-lockfile
pnpm version:check
pnpm typecheck:all
pnpm test:run
pnpm build:server
pnpm --dir client build
```

补充检查：

- `git status --short` 工作树是否干净。
- `git status --short assets/card assets/images` 与 `git diff --stat -- assets/card assets/images`：临时本地补图不要进入发布提交。
- 本地验证 API runtime 镜像时按第三节构建候选镜像；它只包含 `dist/server/index.js` runtime，前端 `client/dist` 仍单独部署。
- 不要用 `pnpm db:push` 代替生产迁移；迁移属于部署阶段，按 runbook 在具备源码、devDependencies 和生产 `DATABASE_URL` 的环境执行 `pnpm db:migrate`，本技能不直接对生产库执行迁移。

## 三、构建并发布 loveca-api Docker 镜像

正式发布默认产出 API 镜像；若本次明确不发布 API，跳过并在发布清单写明原因。先从 `docs/production-release-runbook.md` 确认镜像仓库、生产平台与登录方式；当前约定仓库为 `ghcr.io/catmeow123456/loveca-api`。不要把 registry token 写入仓库、命令参数或聊天输出。

1. 构建前确认：
   - `VERSION`、发布 tag 与当前提交一致，工作树没有会影响镜像但尚未提交的文件。
   - 明确目标平台；不要根据开发机架构猜测生产架构。单一 x86_64 生产机通常使用 `linux/amd64`，多架构才使用逗号分隔的平台列表。
   - 发布者已经以具备 package write 权限的账号登录 registry。
2. 先构建本地候选镜像并检查 runtime 入口，不推送：

   ```bash
   API_IMAGE_REPOSITORY=ghcr.io/catmeow123456/loveca-api
   RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
   RELEASE_TAG="v${RELEASE_VERSION}"
   GIT_SHA="$(git rev-parse HEAD)"
   SHORT_SHA="$(git rev-parse --short=12 HEAD)"
   LOCAL_IMAGE="loveca-api:release-candidate-${SHORT_SHA}"

   docker build --pull -t "${LOCAL_IMAGE}" .
   docker run --rm --entrypoint node "${LOCAL_IMAGE}" --check dist/server/index.js
   docker image inspect "${LOCAL_IMAGE}"
   ```

3. 展示将推送的仓库、平台和三个标签，并取得用户确认。确认后先推送不可变版本标签与提交标签；将 `<生产平台>` 替换为已确认值：

   推送前分别检查版本标签与提交标签，不要把检查命令和推送命令合并成一段直接执行。任一标签已存在时不得覆盖：两个标签必须都存在、指向相同 digest，且 revision 与当前 `GIT_SHA` 一致，才能复用既有镜像；其他情况一律停止发布并核查。

   ```bash
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}"
   ```

   确认两个标签都不存在后，才执行推送：

   ```bash
   TARGET_PLATFORMS='<已确认的生产平台，例如 linux/amd64>'

   docker buildx build --pull \
     --platform "${TARGET_PLATFORMS}" \
     --label "org.opencontainers.image.source=https://github.com/catmeow123456/loveca-dev" \
     --label "org.opencontainers.image.revision=${GIT_SHA}" \
     --label "org.opencontainers.image.version=${RELEASE_VERSION}" \
     --tag "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}" \
     --tag "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}" \
     --push .

   docker buildx imagetools inspect "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
   ```

4. 只有版本镜像检查通过后，才把 `latest` 提升到该版本；提升前再次取得用户确认：

   ```bash
   docker buildx imagetools create \
     --tag "${API_IMAGE_REPOSITORY}:latest" \
     "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
   docker buildx imagetools inspect "${API_IMAGE_REPOSITORY}:latest"
   ```

5. 在发布清单记录版本标签、提交标签、目标平台与 registry 返回的 digest。生产环境按 runbook 设置 `LOVECA_API_IMAGE` 后执行 `docker compose pull api` 和 `docker compose up -d --no-build api`；不得在生产机重新 `docker compose build api`。`latest` 只用于方便拉取，回滚必须改回上一版 `vX.Y.Z` 标签或已记录 digest。

## 四、迁移说明与发布文案

每次发布都要判断是否需要新增或更新人工迁移说明，并且无论是否有 bug 或迁移，都要产出 release description / release message。

1. 检查本次发布是否包含数据库迁移、同步脚本字段口径变化、生产环境变量变化、对象存储/图片链路变化、需要重跑数据同步脚本、或部署顺序限制：

   ```bash
   git diff --name-status v上一版本..HEAD -- drizzle src/scripts docs/card-data-sync src/server/db src/server/routes src/server/services client/src/lib
   ```

2. 如果包含上述任一情况，必须在 `drizzle/migration-notes/` 下新增或更新版本迁移说明，例如：

   ```text
   drizzle/migration-notes/X.Y.Z-previous-to-X.Y.Z.md
   ```

   文档至少写清：
   - 本次 schema / 数据 / 同步口径改变了什么。
   - 发布前备份、维护窗口、生产环境变量与源文件前置要求。
   - `pnpm db:migrate` 前后的验证 SQL 或等价检查。
   - 是否需要重跑同步脚本；如果需要，写清推荐顺序、dry-run 命令、正式命令、人工审核/`--yes` 风险和源文件路径。
   - 前后端/API 是否必须同版部署，是否允许旧 API 连接新 schema。
   - 发布后 smoke 项。
   - 回滚边界：哪些情况可只回滚前端/API，哪些情况必须从发布前 DB dump 恢复。

   迁移说明是人工 runbook，不是 Drizzle 可执行迁移；不要把它写进 `drizzle/meta/`，也不要修改已经共享的历史 SQL。
3. 如果确认本次没有生产迁移或数据同步动作，也要在发布清单中明确写「本次无需新增 migration note」及原因。
4. 编写 release description / release message。无论是否发现 bug，都必须输出一份可直接用于 GitHub Release / 发布公告的中文文案，至少包含：
   - 版本号。
   - 新功能。
   - 新增/补全卡效（提到具体卡牌编号时按项目聊天约定写费用/分数与卡名）。
   - 修复与改进。
   - 迁移/部署注意事项。
   - 已知风险或不包含项。

## 五、Android（PWA/TWA）发布材料

仅在本次需要产出/更新 Android 包时执行；否则跳过并在清单中标注「本次不含 Android 包」。

1. 工具链前置检查：

   ```bash
   pnpm android:twa:doctor
   ```

   需要 Node 22+、pnpm、JDK 17+、Android SDK env、`sdkmanager`；`adb`、`gradle` 为可选。前置不满足先补齐再继续。
2. 构建 Web/PWA 产物（即 `client/dist`，应包含 `manifest.webmanifest`、`/pwa/*` 图标、`sw.js`、`version.json`）：

   ```bash
   pnpm android:pwa:build
   ```

3. Digital Asset Links：只有在已知正式 release / upload key 的 SHA-256 指纹时才生成，并确认 `ANDROID_PACKAGE_NAME`、`ANDROID_SHA256_FINGERPRINT` 为正式值（可参考 `android/twa/loveca.twa.env.example`，但不要使用示例占位指纹）：

   ```bash
   ANDROID_PACKAGE_NAME=xyz.lovelivefun.loveca \
   ANDROID_SHA256_FINGERPRINT=<正式签名指纹> \
   pnpm android:assetlinks
   ```

   换正式签名后必须重新生成，并确保生产站点 `/.well-known/assetlinks.json` 与之一致。
4. 用 Docker Bubblewrap 生成 TWA 包（需要 keystore 口令，APK/AAB 与本地 keystore 不进 git）：

   ```bash
   BUBBLEWRAP_KEYSTORE_PASSWORD=<keystore-password> \
   BUBBLEWRAP_KEY_PASSWORD=<key-password> \
   pnpm android:twa:build:docker
   ```

   产物在 `android/twa/loveca/app-release-signed.apk` 与 `app-release-bundle.aab`。
   - 默认带 `--skipPwaValidation`，是因为线上 manifest 可能滞后；在确认生产 `https://<域名>/manifest.webmanifest` 与 `/pwa/*` 图标已更新后，应改用 `ANDROID_TWA_SKIP_PWA_VALIDATION=false` 正式校验。
   - 网络慢时按 `android/twa/README.md` 传入 `http_proxy` / `https_proxy`。

## 六、发布 tag

确认前述检查全部通过、版本号已同步后，准备 annotated tag（按 runbook，tag 必须等于 `v${VERSION}`）。先向用户展示命令并确认，再由用户决定是否推送，不要自动推送：

```bash
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push origin vX.Y.Z
```

## 七、输出发布清单

最后用中文汇总一份发布准备结论，至少包含：

1. 目标版本号，以及 `VERSION` / 根 `package.json` / `client/package.json`（必要时 TWA `versionCode`）是否已同步。
2. 第二节各检查命令的实际结果（通过 / 失败 / 跳过及原因），失败项必须显式标出，不得隐瞒或淡化。
3. loveca-api 镜像：是否构建/推送，版本与提交标签、目标平台、digest、`latest` 是否已提升；若跳过，写清原因。
4. Migration note：文件路径、覆盖范围、是否需要生产迁移/数据同步；如果未新增，写清无需新增的理由。
5. Release description / release message：给出完整中文文案。
6. Android 材料：是否构建、产物路径、是否使用正式签名与 assetlinks，或本次不含 Android 包。
7. 工作树与发布差异是否干净，是否存在不该进入发布的临时图片或过程文档。
8. 待用户确认的对外动作（推送镜像/提升 `latest`、打/推 tag、分发安装包），以及后续部署须走 `docs/production-release-runbook.md`（迁移、拉取镜像、部署、发布后检查、回滚）的提示。
9. 如发现代码或流程与权威文档不一致，指出差异并建议先更新文档或修复实现，再发布。
