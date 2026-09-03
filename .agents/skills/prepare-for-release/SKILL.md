---
name: prepare-for-release
description: 准备并公开 Loveca 正式版本：同步版本、提交并推送作者 main、等待 exact-SHA CI、发布 loveca-api 镜像、tag 与 GitHub Release；仅在明确要求时构建 Android 材料。生产部署不属于本技能。
---

你是一个很强的模型。独立推进发布，避免重复检查、重复解释和无意义的用户确认。

把当前代码公开成一个可追溯版本。版本、发布提交、CI、镜像、tag 和 GitHub Release 属于本技能；生产迁移、部署、健康检查和回滚按 `docs/production-release-runbook.md` 执行。

## 授权与停止条件

- 用户明确调用 `$prepare-for-release X.Y.Z`，即已授权该版本的一整套常规发布动作：修改版本、提交、推送作者 `main`、构建并推送 API 镜像、推送 tag、创建 GitHub Release、提升 `latest`。不要为这些动作逐项再次询问。
- 若用户只要求“检查/准备”、明确排除某类产物，或未给版本号，则按其范围执行；缺少版本号时给出建议并只问一次。
- 只在继续操作会改变用户给定范围或无法安全恢复时暂停：作者 `main` 出现非预期前进；已有公开 tag/Release 指向其他 SHA；tracked 工作树含来源不明改动；exact-SHA CI 或 tag integrity 确定失败；镜像仓库、生产平台或 Android 发布范围需要改变；缺少凭据或必须由用户提供的秘密。
- 保留用户的未跟踪文件，不批量 stage，不覆盖公开 tag。可安全重试的查询、构建、推送和 CI 等待直接重试；同一阻塞不要反复向用户提问。
- 常规 API 平台固定为 `linux/amd64`。改变平台不是常规发布的一部分。

## 先读与范围

先读 `AGENTS.md`、`PROJECT_PROGRESS_TODO.md` 和 `docs/production-release-runbook.md`。仅当本次明确包含 Android 包时，再读 `docs/android-app-packaging-guide-draft.md` 与 `android/twa/README.md`；Android 未被提及时默认不构建。

识别实际指向 `catmeow123456/loveca-dev` 的作者 remote，不假定名为 `origin`。fetch 作者 `main` 与 tags，确认当前 HEAD 等于作者 `main`。检查 tracked diff、未跟踪文件、临时卡图和 Docker build context；无关未跟踪文件可以保留，但不得进入提交或发布产物。

## 发布流程

1. **准备最终提交**
   - 根 `VERSION`、根 `package.json`、`client/package.json` 同步为目标语义化版本。
   - 比较上一 tag 到 HEAD 的数据库、同步、环境、对象存储和部署相关变化。需要人工迁移步骤时新增或更新 `drizzle/migration-notes/`；无需时在发布清单说明理由。不要改已共享历史 SQL，也不要执行生产迁移。
   - 根据上一 tag 到 HEAD 的真实提交整理中文 Release 文案，覆盖主要功能、卡效、修复、迁移/部署注意和已知限制；具体卡牌遵守 `AGENTS.md` 的编号、费用/分数与卡名格式。
   - 只 stage 本次明确发布文件。用中文多行提交 `准备 vX.Y.Z 版本发布`，正文记录范围与验证；运行 `pnpm version:check`、`git diff --cached --check`/`git diff --check` 和必要的发布专属检查。

2. **推送与 exact-SHA CI**
   - 推送前 fetch，要求作者 `main` 仍是 release commit 的父提交；随后推送 `HEAD:main`，再次 fetch 并确认远端精确等于 `RELEASE_SHA`。
   - 用 `node scripts/check-release-ci.mjs --repo catmeow123456/loveca-dev --sha "$RELEASE_SHA"` 等待作者 `main` 上同一 SHA 的 `Quality Gates` 成功。父提交、PR SHA、fork 或本地测试不能替代。运行中继续等待；确定失败则停止，代码变化后必须产生新 SHA 并重新走门禁。
   - 不默认重复执行 CI 已覆盖的全量本地安装、typecheck、测试和构建。只在诊断失败或用户明确要求时补跑。

3. **API 镜像**
   - 默认发布 `ghcr.io/catmeow123456/loveca-api`；用户明确排除 API 时跳过并记录原因。
   - 基于同一干净 SHA 构建 `linux/amd64` 本地候选，验证 `dist/server/index.js` 语法和 runbook 要求的 runtime import，并检查镜像平台。
   - exact-SHA CI 与候选验证都成功后，推送 `${RELEASE_TAG}` 与 `sha-${SHORT_SHA}`。从 registry 核验两者 digest 一致、平台仅为 `linux/amd64`，revision 为完整 SHA，version 为目标版本；不符即停止。

4. **Tag、Release 与 latest**
   - 创建并推送 annotated `vX.Y.Z` tag，等待 `Release Tag Integrity` 成功。失败时不覆盖 tag、不创建 Release、不提升 `latest`。
   - 守卫成功后用完整中文文案创建 GitHub Release。
   - 提升 `latest` 前记录旧指针的 digest、平台、revision、version 或 `ABSENT`；将 `latest` 指向已验证版本镜像，再核验其与版本 tag 完全一致。查询旧指针失败时不提升。

5. **Android（仅明确要求时）**
   - Android `versionCode` 单调递增且与产品版本解耦。按 Android 文档检查工具链、PWA、正式签名和 assetlinks 后构建；CI 成功前不分发，release SHA 改变后重建。

## 完成标准

最终用中文给出简洁发布清单：版本与 exact SHA；Quality Gates run/URL；迁移说明；API 各标签的 digest/平台/revision/version 与旧 `latest`；tag integrity；GitHub Release URL；Android 是否包含；工作树和临时图片状态；尚待 runbook 执行的生产迁移/部署事项。只报告实际完成或真实阻塞，不把本地验证说成远端门禁。
