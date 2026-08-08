---
name: prepare-for-release
description: 准备并发布 Loveca 版本，包括同步 VERSION、形成并推送发布提交、复用作者 main 上 exact-SHA 的 GitHub CI、构建并发布 loveca-api 镜像、按需构建 Android（PWA/TWA）材料，以及整理 tag、GitHub Release 文案与发布清单。用于正式发版或核验发布准备状态。
---

把当前代码准备并公开成一个可追溯版本。本技能负责 release commit、质量门禁、发布产物、tag 与 GitHub Release；正式部署、迁移、健康检查和回滚以权威 runbook 为准，不在此重复实现。

## 权威文档（先读，不要凭记忆）

- `docs/production-release-runbook.md`：版本与 tag 规则、发布前检查、构建、迁移、部署、发布后检查、回滚边界。
- `docs/android-app-packaging-guide-draft.md` 与 `android/twa/README.md`：PWA/TWA 打包前置、候选包名、Bubblewrap 构建命令、Digital Asset Links 与签名要求。
- 如果上述文档与本技能步骤冲突，以文档为准，并提示需要同步更新本技能。

## 前置确认

1. 先和用户确认本次发布的目标版本号 `X.Y.Z`（语义化版本）。如果用户没给，根据改动性质给出建议（修复=patch、向后兼容功能=minor、破坏性变更=major），但不要擅自决定后直接改文件。
2. 确认当前分支与工作树状态：`git status --short`、`git diff --stat main...HEAD`，判断是否还有未提交或不该进入发布的改动。
3. 发布 API 镜像时，必须独立确认准确的生产平台值，例如 `linux/amd64`。平台事实只能来自当前生产部署配置/主机、已记录的生产镜像 digest，或用户在看到准确平台值后的明确指定；`uname -m`、`docker info`、本地候选镜像和开发机架构都不能作为生产平台依据。把确认来源和 `TARGET_PLATFORMS` 写入发布记录。只说“继续”“确认发布”不等于确认平台，除非待确认内容明确列出了准确的平台值。
4. 本技能涉及的对外动作（将版本提交推送到作者 `main`、推送 tag、创建 GitHub Release、推送/提升 Docker 镜像、构建并分发安装包）必须先暂停并向用户确认；不要自动执行 `git push`、推送 `git tag`、`gh release create`、`docker push` 或带 `--push` 的 `docker buildx build`。

## 一、准备发布提交

先把版本号、迁移说明和发布文案准备完整，再形成 release commit。CI 门禁只能核验已经提交并推送的最终 SHA，不能在这些文件仍未提交时提前执行。已经通过 PR 合并的业务代码不在这里重复逐行审查；这里只审查相对于发布前作者 `main` 新增的 release-only diff。

1. 识别实际指向 `catmeow123456/loveca-dev` 的作者 remote，不要假定它一定名为 `origin`。在隔离的发布 checkout 中禁用子模块递归地 fetch 作者 `main`，确认当前 HEAD 与作者 `main` 完全一致，再记录发布基线；不要在仍含未合并业务提交的功能分支上直接形成 release commit：

   ```bash
   git fetch --recurse-submodules=no <作者远端> main
   RELEASE_BASE_SHA="$(git rev-parse HEAD)"
   test "${RELEASE_BASE_SHA}" = "$(git rev-parse <作者远端>/main)"
   ```

2. 产品版本以根目录 `VERSION` 为准。更新目标版本并保持三处一致：
   - `VERSION`
   - 根 `package.json` 的 `version`
   - `client/package.json` 的 `version`
3. Android `versionCode` 单独管理：`android/twa/loveca/twa-manifest.json` 的 `appVersionName` / `appVersionCode` / `appVersion` 与产品 `VERSION` 解耦。只有本次要出新 Android 包时才更新，且 `appVersionCode` 必须单调递增；不要为了对齐产品版本而回退。
4. 比较上一版本 tag 到当前代码，判断是否包含数据库迁移、同步字段口径、生产环境变量、对象存储/图片链路、数据重同步或部署顺序变化：

   ```bash
   git diff --name-status v上一版本..HEAD -- drizzle src/scripts docs/card-data-sync src/server/db src/server/routes src/server/services client/src/lib
   ```

   如有任何一项，在 `drizzle/migration-notes/` 新增或更新本版本说明。至少写清变更、备份和维护窗口、环境与源文件前置、迁移前后验证、同步 dry-run/apply 顺序、前后端同版要求、smoke 与回滚边界。迁移说明是人工 runbook，不写入 `drizzle/meta/`，也不修改已共享的历史 SQL。若无需迁移或同步，也要在发布清单中写明原因。

5. 编写可直接用于 GitHub Release / 发布公告的中文 release description，至少包含版本号、新功能、新增或补全卡效、修复与改进、迁移/部署注意事项、已知风险或不包含项。提到卡牌编号时继续遵守项目聊天约定。
6. 只显式 stage 本次发布文件，不要使用 `git add -A`。审查待提交的 release-only diff、临时图片和工作树；它通常只包含三处版本号、按需更新的 Android 版本字段和必要发布文档，不得夹带新的业务代码、依赖、迁移 SQL、workflow 或未审查文件：

   ```bash
   git diff --cached --name-status
   git diff --cached --check
   git status --short
   ```

   上一版本 tag 到当前 HEAD 的大范围 diff 只用于整理 release description 和识别迁移影响，不在这里重新执行 PR 代码审查。经用户授权后，用 `准备 vX.Y.Z 版本发布` 作为提交标题创建本地 release commit，再校验该提交相对于发布基线的全部变化：

   ```bash
   RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
   git commit -m "准备 v${RELEASE_VERSION} 版本发布"
   pnpm version:check
   git diff --name-status "${RELEASE_BASE_SHA}" HEAD
   git diff --check "${RELEASE_BASE_SHA}" HEAD
   git status --short
   ```

   `version:check` 会校验语义化版本、三处版本一致，以及 HEAD 上已有 `v*` tag 与 `v${VERSION}` 一致。失败时修正 release commit，不能继续。

7. 展示 release SHA 和将推送的作者仓库 `main`，取得明确授权后再推送。推送前再次禁用子模块递归地 fetch，要求作者 `main` 仍等于 release commit 的父提交；如果远端已前进则停止，不能覆盖。推送后再次 fetch，并要求作者 `main` 精确等于当前 SHA：

   ```bash
   RELEASE_SHA="$(git rev-parse HEAD)"
   git fetch --recurse-submodules=no <作者远端> main
   test "$(git rev-parse <作者远端>/main)" = "$(git rev-parse HEAD^)"
   git push <作者远端> HEAD:main
   git fetch --recurse-submodules=no <作者远端> main
   test "$(git rev-parse <作者远端>/main)" = "${RELEASE_SHA}"
   ```

   若作者 `main` 已前进、当前 checkout 改变或工作树出现新的发布相关改动，停止并重新确定最终 release SHA。

## 二、并行等待 exact-SHA CI 与准备本地产物

版本号通常在功能 PR 合并后单独提交，因此前一节的 release commit 会形成一个尚未被原 PR CI 验证的新 SHA。必须等待该**同一完整 SHA** 在作者仓库 `main` 的 GitHub Actions `Quality Gates` 成功；父提交、PR head、tag run、fork 仓库或其他 SHA 的成功结果都不能复用。

推送 release commit 后固定 `RELEASE_SHA`，并同时启动两个分支：等待远端 exact-SHA CI；准备不会改变远端状态的本地文案、命令与候选产物。两条分支都完成后才能执行后续镜像、tag、GitHub Release、`latest` 或安装包的对外写入与分发动作。

CI 分支运行仓库内的窄校验脚本。脚本通过 `gh` 查询作者仓库 `main` 的 push run，同时核验 workflow run 和其中名为 `Quality Gates` 的 job，成功时会输出必须写入发布清单的 run ID 与 URL：

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
pnpm version:check
node scripts/check-release-ci.mjs \
  --repo catmeow123456/loveca-dev \
  --sha "${RELEASE_SHA}"
```

运行中的 CI 尚不能解锁发布，应在保持用户可见进度的前提下稍后重新查询。只有脚本成功时，才可把该 run 作为发布质量门禁，并跳过以下本地重复质量检查：依赖安装、`typecheck:all`、`test:run`、`build:server`、普通 `client build`。查不到 run、SHA 不同、job 缺失、失败、取消、超时或 `gh` 查询失败时一律保持发布阻塞，不能拿父提交已通过来解释。

如果用户在看到具体状态后明确要求本地完整检查，可以执行下列命令用于诊断或提前验证：

```bash
pnpm install --frozen-lockfile
pnpm version:check
pnpm typecheck:all
pnpm test:run
pnpm build:server
pnpm --dir client build
```

本地结果必须逐项记录；本地通过不会改变远端 CI 的实际状态，也不能解锁镜像推送、tag、GitHub Release、`latest` 或安装包分发。当前 `Release Tag Integrity` 同样要求 exact-SHA CI，因此最终仍须等待远端 CI 成功。CI 因临时基础设施问题失败或取消时，可以核查后重跑同一 SHA；若需要修改代码或发布文件，则形成新的 release SHA，并从推送与 CI 门禁重新开始。

与 CI 并行的本地分支可以执行：继续校对尚未公开且不写入 git 的 Release 文案、准备命令、按第三节构建并检查不推送的 API 候选镜像，以及按实际发布范围生成本机前端或 Android 候选产物。并行期间遵守以下边界：

- 每个产物开始前确认 `git rev-parse HEAD` 仍等于 `RELEASE_SHA`，且没有会影响产物的未提交文件；所有产物必须可追溯到同一 SHA。
- 可以构建、检查和记录本地产物，但不得推送镜像、推 tag、创建 GitHub Release、提升 `latest` 或分发安装包。
- 可以修改仅保存在外部草稿中的 Release 文案；若修改版本字段、migration note 或其他已跟踪文件，原 SHA 与候选产物立即失效，必须形成新提交、重新推送、重新等待 CI，并重建受影响产物。
- CI 失败时不得发布并行生成的候选产物；保留它们仅用于诊断，或明确标记为失效。

汇合门禁为：exact-SHA CI 成功，并且本次所需候选产物检查成功。满足后才可推送不可变 `vX.Y.Z` / `sha-*` 镜像并进入 tag 流程；GitHub Release 与 `latest` 还必须继续等待第五节 `Release Tag Integrity` 成功。

无论等待 CI 期间是否执行补充本地检查，都继续执行这些发布专属检查：

- `git status --short` 工作树是否干净。
- `git status --short assets/card assets/images` 与 `git diff --stat -- assets/card assets/images`：临时本地补图不要进入发布提交。
- 检查版本提交确实位于作者 `main`，且当前 checkout 仍是脚本核验的 `RELEASE_SHA`。
- 本地验证 API runtime 镜像时可与 CI 并行按第三节构建候选镜像；这是发布产物构建，不是重复 CI。它只包含 `dist/server/index.js` runtime。
- exact-SHA CI 不会把 `client/dist` 自动带回发布机。若本次需要从本机交付前端静态产物，仍须按 runbook 单独安装依赖并构建，记录为产物构建；若由部署环境按同一 SHA 构建，则在清单中记录产物来源。Android/PWA 产物继续按第四节构建。
- 不要用 `pnpm db:push` 代替生产迁移；迁移属于部署阶段，按 runbook 在具备源码、devDependencies 和生产 `DATABASE_URL` 的环境执行 `pnpm db:migrate`，本技能不直接对生产库执行迁移。

## 三、构建并发布 loveca-api Docker 镜像

正式发布默认产出 API 镜像；若本次明确不发布 API，跳过并在发布清单写明原因。先从 `docs/production-release-runbook.md` 确认镜像仓库、生产平台与登录方式；当前约定仓库为 `ghcr.io/catmeow123456/loveca-api`。不要把 registry token 写入仓库、命令参数或聊天输出。第 2 步的本地候选构建，以及第 3 步所需仓库、平台、标签和命令的准备，可与第二节 CI 并行；实际 registry 推送必须等待第二节汇合门禁成功。

1. 构建前确认：
   - `VERSION`、发布 tag 与当前提交一致，工作树没有会影响镜像但尚未提交的文件。
   - 按“前置确认”独立取得并记录 `TARGET_PLATFORMS` 和事实来源；不要根据开发机、本地 Docker daemon 或候选镜像架构猜测生产架构。单一 x86_64 生产机使用 `linux/amd64`，单一 ARM64 生产机使用 `linux/arm64`，多架构才使用逗号分隔的平台列表。
   - 在构建前检查当前生产实际使用的镜像引用与 digest，并查询 registry 当前 `latest` 的 digest、平台集合、revision 和 version 作为交叉核对。生产实际镜像优先于 `latest`；无法取得生产事实时不能用开发机架构补空，保持阻塞并向用户说明缺失信息。
   - 如果当前生产镜像或 `latest` 的平台集合与 `TARGET_PLATFORMS` 不同，把它视为架构迁移或架构纠错：展示旧引用、旧 digest、旧平台和新平台，停止流程，并在差异被发现后重新取得用户对这次平台变化的明确授权。此前对“继续发布”的笼统授权不能复用。
   - 发布者已经以具备 package write 权限的账号登录 registry。
2. 先针对已确认的生产平台构建本地候选镜像并检查 runtime 入口，不推送。下面的候选路径只支持单一平台；多架构发布必须为列表中的每个平台分别构建、运行和检查候选镜像，不能用开发机原生候选替代：

   ```bash
   API_IMAGE_REPOSITORY=ghcr.io/catmeow123456/loveca-api
   RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
   RELEASE_TAG="v${RELEASE_VERSION}"
   GIT_SHA="$(git rev-parse HEAD)"
   SHORT_SHA="$(git rev-parse --short=12 HEAD)"
   TARGET_PLATFORMS='<前置确认得到的单一生产平台，例如 linux/amd64>'
   LOCAL_IMAGE="loveca-api:release-candidate-${SHORT_SHA}"

   case "${TARGET_PLATFORMS}" in *,*) echo '多架构发布需逐平台构建候选镜像'; exit 1;; esac
   docker build --pull --platform "${TARGET_PLATFORMS}" -t "${LOCAL_IMAGE}" .
   docker run --rm --entrypoint node "${LOCAL_IMAGE}" --check dist/server/index.js
   CANDIDATE_PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${LOCAL_IMAGE}")"
   test "${CANDIDATE_PLATFORM}" = "${TARGET_PLATFORMS}"
   docker image inspect "${LOCAL_IMAGE}"
   ```

3. CI 运行期间可以先展示拟推送的仓库、平台和三个标签，但不得执行推送。exact-SHA CI 和本地候选检查都成功后，立即在推送前重新核对目标仓库、不可变标签、`TARGET_PLATFORMS`、当前生产/`latest` 的平台与 digest，并用包含准确平台值的确认问题取得用户授权，再先推送不可变版本标签与提交标签。不能沿用未展示平台值时取得的授权：

   推送前分别检查版本标签与提交标签，不要把检查命令和推送命令合并成一段直接执行。任一标签已存在时不得覆盖：两个标签必须都存在、指向相同 digest，平台集合与 `TARGET_PLATFORMS` 完全一致，且 revision 与当前 `GIT_SHA`、version 与 `RELEASE_VERSION` 一致，才能复用既有镜像；其他情况一律停止发布并核查。

   ```bash
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:sha-${SHORT_SHA}"
   ```

   确认两个标签都不存在后，才执行推送；这里必须复用候选构建前已经确认并校验过的 `TARGET_PLATFORMS`，不得在此根据本机架构重新赋值：

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

   推送后必须从 registry 返回值逐项确认两个不可变标签指向同一 digest，平台集合与 `TARGET_PLATFORMS` 完全一致，revision 为完整 `GIT_SHA`，version 为 `RELEASE_VERSION`；任一项不符就停止，不得继续推 tag、创建 GitHub Release 或提升 `latest`。Release 文案中的镜像平台只能引用这次 registry 验证结果，不能引用本地候选镜像。

4. 只有版本镜像检查通过并且第五节 `Release Tag Integrity` 成功后，才把 `latest` 提升到该版本；提升前必须重新查询当时的 `latest`，记录可回滚的旧 digest 和平台集合，并再次与 `TARGET_PLATFORMS` 比较。若平台集合发生变化或与构建前记录不同，停止并在展示差异后重新取得一次针对架构变化的明确授权。可以先完成不可变 `vX.Y.Z` / `sha-*` 镜像并在第五节后回来执行本步，但不能提前提升 `latest`：

   ```bash
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:latest"
   docker buildx imagetools create \
     --tag "${API_IMAGE_REPOSITORY}:latest" \
     "${API_IMAGE_REPOSITORY}:${RELEASE_TAG}"
   docker buildx imagetools inspect --format '{{json .}}' "${API_IMAGE_REPOSITORY}:latest"
   ```

   提升后确认 `latest` 与不可变版本标签指向同一 digest，平台集合、revision 和 version 也完全一致；否则发布未完成，应停止部署并按记录的旧 digest 回滚 `latest`。

5. 在发布清单记录平台事实来源、当前生产/旧 `latest` 的引用、digest 与平台集合、目标平台、候选校验结果、版本/提交标签的 registry digest，以及是否发生并获准架构变化。生产环境按 runbook 设置 `LOVECA_API_IMAGE` 后执行 `docker compose pull api` 和 `docker compose up -d --no-build api`；不得在生产机重新 `docker compose build api`。`latest` 只用于方便拉取，回滚必须改回上一版 `vX.Y.Z` 标签或已记录 digest。

## 四、Android（PWA/TWA）发布材料

仅在本次需要产出/更新 Android 包时执行；否则跳过并在清单中标注「本次不含 Android 包」。本地候选包可以与第二节 CI 并行生成，但 CI 成功前不得分发；若 CI 失败或 release SHA 改变，候选包失效并须基于新 SHA 重建。

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

## 五、发布 tag 与 GitHub Release

exact-SHA CI 和候选产物检查成功后，准备 annotated tag（tag 必须等于 `v${VERSION}`）。先展示目标 remote、SHA 与命令并取得用户确认；不要假定作者 remote 名为 `origin`：

```bash
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push <作者远端> vX.Y.Z
```

tag 推送后等待独立的 `Release Tag Integrity` workflow 成功。它会再次检查版本、作者 `main` 祖先关系和 exact-SHA `Quality Gates`，但不会初始化子模块、安装依赖或重跑完整 CI。守卫失败时停止，不得创建 GitHub Release 或提升 `latest`；不要覆盖或静默重建已经公开的 tag。此前已推送的不可变 `vX.Y.Z` / `sha-*` 镜像可以保留用于核查，但不能推广为当前版本。

守卫成功后，使用第一节准备的完整中文文案创建 GitHub Release，并按第三节提升 `latest`。创建或公开 Release 与提升 `latest` 都是对外动作，分别执行前取得用户确认，并记录 Release URL。

## 六、输出发布清单

最后用中文汇总一份发布准备结论，至少包含：

1. 目标版本号，以及 `VERSION` / 根 `package.json` / `client/package.json`（必要时 TWA `versionCode`）是否已同步。
2. 第二节 exact-SHA CI 的目标 SHA、作者仓库、`Quality Gates` run ID/URL 与结果；哪些本地候选产物与 CI 并行构建，以及用户授权的补充本地检查结果。失败项必须显式标出，不得把本地通过表述为远端门禁通过。
3. loveca-api 镜像：是否构建/推送，生产平台事实来源、旧生产/`latest` 的引用、digest 与平台集合、目标平台、候选平台校验结果、版本与提交标签、registry digest、`latest` 是否已提升；如果平台发生变化，附上用户明确授权；若跳过，写清原因。
4. Migration note：文件路径、覆盖范围、是否需要生产迁移/数据同步；如果未新增，写清无需新增的理由。
5. Release description / release message：给出完整中文文案。
6. Android 材料：是否构建、产物路径、是否使用正式签名与 assetlinks，或本次不含 Android 包。
7. 工作树与发布差异是否干净，是否存在不该进入发布的临时图片或过程文档。
8. tag integrity 与 GitHub Release URL，以及待用户确认的对外动作（创建 Release、推送镜像/提升 `latest`、打/推 tag、分发安装包）；后续部署仍须走 `docs/production-release-runbook.md`（迁移、拉取镜像、部署、发布后检查、回滚）。
9. 如发现代码或流程与权威文档不一致，指出差异并建议先更新文档或修复实现，再发布。
