---
name: prepare-for-release
description: 发布前准备，包括确认并同步 VERSION、运行构建与验证检查、构建 Android（PWA/TWA）发布材料、整理发布 tag 与发布清单
---

把当前代码准备成一次可发布的版本。本技能只负责“发布前准备与产物构建”，正式部署、迁移、健康检查和回滚以权威 runbook 为准，不在此重复实现。

## 权威文档（先读，不要凭记忆）

- `docs/production-release-runbook.md`：版本与 tag 规则、发布前检查、构建、迁移、部署、发布后检查、回滚边界。
- `docs/android-app-packaging-guide-draft.md` 与 `android/twa/README.md`：PWA/TWA 打包前置、候选包名、Bubblewrap 构建命令、Digital Asset Links 与签名要求。
- 如果上述文档与本技能步骤冲突，以文档为准，并提示需要同步更新本技能。

## 前置确认

1. 先和用户确认本次发布的目标版本号 `X.Y.Z`（语义化版本）。如果用户没给，根据改动性质给出建议（修复=patch、向后兼容功能=minor、破坏性变更=major），但不要擅自决定后直接改文件。
2. 确认当前分支与工作树状态：`git status --short`、`git diff --stat main...HEAD`，判断是否还有未提交或不该进入发布的改动。
3. 本技能涉及的对外/不可逆动作（推送 tag、构建并分发安装包）必须先暂停并向用户确认，不要自动执行 `git push` 或推送 `git tag`。

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
- 如确认要构建 API 镜像：`docker compose build api`（仅构建 `dist/server/index.js` runtime 镜像，前端 `client/dist` 单独部署）。
- 不要用 `pnpm db:push` 代替生产迁移；迁移属于部署阶段，按 runbook 在具备源码、devDependencies 和生产 `DATABASE_URL` 的环境执行 `pnpm db:migrate`，本技能不直接对生产库执行迁移。

## 三、Android（PWA/TWA）发布材料

仅在本次需要产出/更新 Android 包时执行；否则跳过并在清单中标注「本次不含 Android 包」。

1. 工具链前置检查：

   ```bash
   pnpm android:twa:doctor
   ```

   需要 Node 20+、pnpm、JDK 17+、Android SDK env、`sdkmanager`；`adb`、`gradle` 为可选。前置不满足先补齐再继续。
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

## 四、发布 tag

确认前述检查全部通过、版本号已同步后，准备 annotated tag（按 runbook，tag 必须等于 `v${VERSION}`）。先向用户展示命令并确认，再由用户决定是否推送，不要自动推送：

```bash
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push origin vX.Y.Z
```

## 五、输出发布清单

最后用中文汇总一份发布准备结论，至少包含：

1. 目标版本号，以及 `VERSION` / 根 `package.json` / `client/package.json`（必要时 TWA `versionCode`）是否已同步。
2. 第二节各检查命令的实际结果（通过 / 失败 / 跳过及原因），失败项必须显式标出，不得隐瞒或淡化。
3. Android 材料：是否构建、产物路径、是否使用正式签名与 assetlinks，或本次不含 Android 包。
4. 工作树与发布差异是否干净，是否存在不该进入发布的临时图片或过程文档。
5. 待用户确认的对外动作（打/推 tag、分发安装包），以及后续部署须走 `docs/production-release-runbook.md`（迁移、部署、发布后检查、回滚）的提示。
6. 如发现代码或流程与权威文档不一致，指出差异并建议先更新文档或修复实现，再发布。
