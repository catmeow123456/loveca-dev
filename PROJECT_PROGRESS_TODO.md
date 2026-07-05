# Loveca 项目进度及待办

更新时间：2026-07-05

## 本次 2026-07-05 休息室判心统计入口

- 休息室展开浮窗标题栏新增判心统计入口：桌面端显示简版 chip，并支持 hover/focus 或点击统计按钮查看完整统计；移动端点击统计按钮在标题栏下方展开完整统计。
- 统计仅基于当前投影可见的休息室正面卡牌数据推导，不新增规则命令；只统计成员/LIVE 的 `bladeHearts` 彩心、加分判与抽卡标，不计入成员卡自身持有心 `hearts`。
- 新增 `tests/unit/waiting-room-judgment-stats.test.ts` 锁定统计口径，防止成员持有心被误计入休息室判心统计。
- 验证：`pnpm --dir client exec tsc -b` passed；`pnpm test:run` passed（289 files / 2347 tests，3 performance tests skipped）；`git diff --check` passed。

## 本次 2026-07-02 莲之空 CL1 002 卡效补充

- 已实现 `PL!HS-cl1-002-CL` 费用 5「村野さやか」：登场时可支付 1 张 ACTIVE 能量；如此做时，从自己的休息室将 1 张 DOLLCHESTRA 卡片加入手牌。
- 按 `cards.json` rare_list 仅 CL 窄登记 exact `cardCodes: ['PL!HS-cl1-002-CL']`；不覆盖未知 rarity。
- 新增单卡 workflow `workflows/cards/hs-cl1-002-sayaka.ts`；启动时检查来源仍在己方舞台、ACTIVE 能量与 DOLLCHESTRA 目标，支付后重新扫描目标，目标消失时保留费用并 no-op。
- 复用 `payImmediateEffectCosts` / `recordPayCostAction` 与 `zone-selection` 的 WAITING_ROOM -> HAND 流程；目标用 `unitAliasIs('DOLLCHESTRA')`，成员与 LIVE 均可回收。
- 本卡是 ON_ENTER 且有真实可选支付/选择窗口，不属于 LIVE_START / LIVE_SUCCESS confirm-only 效果。

## 本次 2026-07-02 莲之空 BP6 014 卡效补充

- 已实现 `PL!HS-bp6-014-R` 费用 2「安養寺 姫芽」：手牌来源起动，将本卡从手牌放置入休息室后抽 1，再选择己方舞台「藤島慈」或「大沢瑠璃乃」获得 BLADE +1。
- 通用更新：新增 `CardAbilitySourceZone.HAND`，命令校验和手牌 UI 均按 sourceZone 分流；本卡不是舞台成员来源起动。
- FAQ Q258 已落实：没有合法目标时仍可发动，保留本卡入休息室与抽 1，后续 no-op。
- 新增单卡 workflow `workflows/cards/hs-bp6-014-hime.ts`；弃手成本使用 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`，runner 仅增加 workflow import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、HAND source 与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补 HAND activated source 边界。

## 本次 2026-07-02 莲之空 BP6 008/016 卡效补充

- 已实现 `PL!HS-bp6-008-R/P` 费用 11「桂城 泉」：登场时先将来源成员变为 WAITING，再从休息室回收 1 张分数 4 以下的莲之空 LIVE；无回收目标也保留 WAITING，符合 FAQ Q257。
- 已实现 `PL!HS-bp6-008-R/P` LIVE 开始段：自己的 LIVE 中存在分数 2 以下 LIVE 时将来源成员变为 ACTIVE；无交互 confirm-only 文本追加当前低分 LIVE 数、来源姿态与实际结算结果。
- 已实现 `PL!HS-bp6-016-R` 费用 9「桂城 泉」：起动 1 回合 1 次支付 4 张 ACTIVE 能量，从休息室选择费用 4 以下莲之空成员登场到空成员区，并以 WAITING_ROOM 来源入队 ON_ENTER_STAGE。
- 新增单卡 workflow `workflows/cards/hs-bp6-008-izumi.ts` 与 `workflows/cards/hs-bp6-016-izumi.ts`；本批未新增 shared helper 或扩大 shared 配置轴，runner 仅增加 workflow import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、复用模块与测试入口；`tests/integration/hs-bp6-008-016-effects.test.ts` 覆盖 008 登场/LIVE_START 与 016 起动支付/筛选/入队登场触发。

## 本次 2026-07-02 莲之空 BP6 015 卡效补充

- 已实现 `PL!HS-bp6-015-R` 费用 4「セラス 柳田 リリエンフェルト」：登场来源明确为手牌以外时抽 2 弃 2；手牌来源或缺少来源 metadata 时消费 pending no-op。
- 新增单卡 workflow `workflows/cards/hs-bp6-015-seras.ts`，复用 `draw-then-discard` shared workflow；弃手继续走 `discardHandCardsToWaitingRoomAndEnqueueTriggers`，手牌不足 2 张时沿用 shared workflow 的实际可弃数量语义。
- 通用更新：普通 ON_ENTER source / EnterStageEvent 路径传播 `metadata.fromZone`，保留既有 relay metadata；runner 未加入 015 专属 gate/predicate/pending 分支。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、复用模块与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补 ON_ENTER event metadata 边界说明。

## 本次 2026-07-02 莲之空 BP6 012/013 卡效补充

- 已实现 `PL!HS-bp6-012-R` 费用 2「百生 吟子」：登场时己方主舞台存在其他 Cerise Bouquet 成员才活跃至多 1 张 WAITING 能量；无其他成员或无 WAITING 能量消费 pending no-op。
- 已实现 `PL!HS-bp6-013-R` 费用 15「徒町 小鈴」：登场与 LIVE 开始两段分别登记 abilityId，选择对方舞台原本 BLADE <= 3 且非 DOLLCHESTRA、当前非 WAITING 的成员变为待机状态，并保留成员状态变化触发 wrapper。
- `opponent-wait-target` 仅新增 `confirmNoTargetWithRealtimeText` 小型配置轴，用于本卡 LIVE_START 无目标 no-op 时展示当前对方舞台成员数、合法目标数与实际不会 WAITING 的结果；真实目标选择窗口不额外套 confirm-only。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态、覆盖 rarity、复用模块与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补充 shared workflow 配置轴边界。

## 本次 2026-07-02 莲之空 BP6 010/018/025 卡效补充

- 已实现 `PL!HS-bp6-010-R` 费用 4「村野さやか」：LIVE 开始可弃 1 张 DOLLCHESTRA 手牌，抽 1 后选择己方舞台 DOLLCHESTRA 成员费用 +5；弃手/抽牌后无目标保留已发生动作并 no-op。
- 已实现 `PL!HS-bp6-018-N` 费用 7「村野さやか」：舞台到休息室时可弃 1 手牌，选择己方舞台成员获得蓝 Heart +1 与 BLADE +1；弃手使用进休息室触发安全 wrapper。
- 已实现 `PL!HS-bp6-025-L` 分数 4「ツバサ・ラ・リベルテ」：LIVE 开始可弃手给莲之空成员蓝 Heart +1；LIVE 成功在己方舞台 2 名以上时强制从休息室回收 1 张分数 3 以下 LIVE。
- LIVE_SUCCESS 无交互 no-op 分支已按治理规则在 confirm-only 文本追加实时舞台人数、合法目标数与实际不回收结果；有等待室选择窗口时不额外套 confirm-only。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态、覆盖 rarity、复用模块与测试入口；本批未新增 shared helper 或扩大 shared 配置轴。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run tests/unit/card-effect-classification.test.ts tests/integration/hs-bp6-010-018-025-effects.test.ts` passed（2 files / 16 tests）；`git diff --check` passed。

## 本次 2026-07-01 莲之空 BP6 零散卡效补充

- 已实现 `PL!HS-bp6-002-R/P` 费用 9「村野さやか」：常时，自己舞台无其他成员时来源成员获得 BLADE +2，进入 `live-modifiers` continuous registry。
- 已实现 `PL!HS-bp6-009-R` 费用 7「日野下花帆」：LIVE 开始时卡组顶 4 张放置入休息室，实际满 4 张且全为『莲之空』卡时获得 BLADE +1，复用 `mill-top-gain-live-modifier`。
- 已实现 `PL!HS-bp6-028-L` 分数 2「ブルウモーメント」：LIVE 成功且余剩 Heart >=1 时检视顶 2，任意张按顺序回顶，其余入休息室，不消耗余剩 Heart，复用 `arrange-inspected-deck-top`。
- 已实现 `PL!HS-bp6-030-L` 分数 1「Very! Very! COCO夏っ」：LIVE 开始抽 1 弃 1，复用 `draw-then-discard` 与手牌进休息室触发安全 wrapper。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态与复用模块；本批仅扩 shared workflow 小型配置轴，未扩 framework/gap 文档。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run tests/unit/card-effect-classification.test.ts tests/unit/live-modifiers.test.ts tests/integration/mill-top-gain-live-modifier.test.ts tests/integration/draw-then-discard.test.ts tests/integration/hs-bp6-028-blue-moment.test.ts` passed（5 files / 133 tests）；`git diff --check` passed。

## 本次 2026-06-30 CloudBase 新卡导入脚本

- 新增 `src/scripts/sync-cards-cloudbase-new.ts`：只从 CloudBase 卡牌集合插入 DB 不存在的新卡，支持 `--dry-run`、`--report`、重复卡号跳过、缺规则字段 source flag、默认 `DRAFT`、正式导入交互确认或 `--yes`。
- 新脚本正式运行必须显式选择 `--upload-images` 或 `--skip-images`；`--upload-images` 会通过 CloudBase 临时下载 URL / HTTPS 下载卡图，使用 `sharp` 生成 `thumb/medium/large` WebP 并上传 MinIO，默认不覆盖已有对象，图片失败默认不插入该卡。
- 风险处理：DB 已存在卡不更新；候选内部或 DB 已有图片 basename 冲突会跳过；`--allow-missing-images` 才允许缺图卡入库并写入 `missingImage` / `imageDownloadFailed` 等 source flag。已确认当前可读取卡牌集合是 `loveca`，`real_card` 不存在；仍需用更完整数据确认图片字段形态和 CloudBase 云存储权限。
- 文档同步：新增 `docs/card-data-sync/cloudbase-new-card-sync.md` 作为 CloudBase 新卡专题说明；`docs/card-data-sync/README.md`、`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md` 已纳入新脚本职责边界与运行要求。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --help` passed；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --cloudbase-limit=5 --dry-run --report=tmp/card-sync/cloudbase-loveca-dry-run.json` passed（5 条均可转换，均因 DB 已存在跳过）；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --cloudbase-limit=100 --dry-run --report=tmp/card-sync/cloudbase-loveca-100-dry-run.json` passed（100 条转换无 warning，均因 DB 已存在跳过）。

## 本次 2026-06-29 Loveca Excel Heart 字段同步

- `src/scripts/sync-cards-loveca-excel.ts` 现在会从 Loveca Excel 的 `基本ハート` / `必要ハート` 加载结构化 Heart：`基本ハート` 只写入 MEMBER `hearts`，`必要ハート` 只写入 LIVE `requirements`；`any` / `all` 映射为 `RAINBOW`，字段为空或解析失败时保留数据库现值。
- 该脚本继续同步既有中日文本、真实团体/小队、BLADE Heart、商品与来源字段；仍不插入 Excel-only 卡，不删除 DB-only 卡，不覆盖费用、BLADE、LIVE 分数和 `work_names`。
- 文档同步：`docs/card-data-sync/README.md`、`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md` 已更新 Loveca Excel 同步职责边界。
- 验证：`pnpm exec tsx src/scripts/sync-cards-loveca-excel.ts --dry-run` passed（parse-only，2303 行，2 组重复卡号，2299 个可用卡号）；`pnpm exec tsc --noEmit` passed。

## 接续方式

新窗口建议先读：

1. `AGENTS.md`
2. 本文件 `PROJECT_PROGRESS_TODO.md`

当前分支基线：

- `effect_new_card` @ `4aabb3b feat(effect): 修正效果显示并更新en卡组卡效-1`

当前本地测试页面：

- `http://localhost:5173/`

当前分支：

- `effect_new_card`

## 本次 2026-06-27 3.4.3 发布准备

- 已将产品版本同步到 `3.4.3`：`VERSION`、根 `package.json`、`client/package.json` 三处一致；`client/dist/version.json` 构建产物显示 `version: 3.4.3`。
- 发布差异基准为 `v3.4.2..HEAD`，主要包含星团 / Aqours / 莲之空新卡效批次、卡牌多语言字段与 Loveca Excel 同步、卡效站位变换 UI、LIVE 结算/触发边界修复；`assets/card` 与 `assets/images` 无 diff。
- 新增 `drizzle/migration-notes/3.4.2-to-3.4.3.md` 记录本次生产迁移注意事项：先备份并执行 `pnpm db:migrate`，再按 `sync-cards-llocg.ts` -> `sync-cards-loveca-excel.ts` 顺序同步卡牌数据，并列出验证 SQL、人工 smoke 和回滚边界；`drizzle/README.md` 已补充迁移说明目录职责。
- 更新 `.agents/skills/prepare-for-release/SKILL.md`：后续发版流程必须检查/编写 migration note，并且无论是否发现 bug 都要产出 release description / release message。
- 验证：`pnpm install --frozen-lockfile` passed；`pnpm --dir client install --frozen-lockfile` passed；`pnpm version:check` passed；`pnpm typecheck:all` passed；`pnpm test:run` passed（189 files / 1562 tests，3 performance tests skipped）；`pnpm build:server` passed；`pnpm --dir client build` passed（保留 chunk size / browserslist 提示）；`git diff --check` passed。
- 风险/待办：本次包含 `drizzle/0005_add_card_multilingual_excel_fields.sql` 数据库迁移，发布时须按 `docs/production-release-runbook.md` 先备份并执行 `pnpm db:migrate`，前后端需同版部署；本次未构建 Android TWA 包、未打/推 `v3.4.3` tag。

## 本次 2026-06-27 卡牌同步文档职责边界整理

- 新增 `docs/card-data-sync/README.md` 作为专题索引，明确 `design.md` 是两个同步脚本职责边界、字段覆盖范围和运行顺序的主文档。
- 更新 `docs/card-data-sync/design.md`：补充 `sync-cards-llocg.ts` 与 `sync-cards-loveca-excel.ts` 的上游来源、核心职责、不负责字段，以及推荐先 llocg 后 Excel 的运行顺序。
- 同步收口 `docs/card-data-sync/requirements.md`、`docs/card-data-sync/llocg-db-requirements.md` 与 `docs/README.md` 的入口和旧字段口径；`sync-cards-loveca-excel.ts` 明确只补强已有卡牌展示/来源字段，不插入 Excel-only 卡，也不覆盖规则字段。
- 验证：`git diff --check docs/card-data-sync docs/README.md PROJECT_PROGRESS_TODO.md` passed。

## 本次 2026-06-26 Loveca Excel 多语言卡牌字段同步

- `cards` 表改为无重复多语言结构：旧 `name` -> `name_cn`、旧 `card_text` -> `card_text_cn`，新增 `name_jp` / `card_text_jp`、`work_names`、`group_names`、`unit_name_raw`、`product_code`、`source_external_id`、`image_source_uri`、`source_flags`；迁移会把旧 `group_name` 拆入 `work_names` 后删除旧列，并释放旧 `name` 带来的 `name_cn NOT NULL`，改由 `name_jp` / `name_cn` 至少一个非空的 check 约束表达。
- 新增迁移 `drizzle/0005_add_card_multilingual_excel_fields.sql` 与 Drizzle snapshot；同步更新 `src/server/db/schema.ts`、卡牌 API create/update/import/export、服务端 card registry、前端 `cardService`、管理页表单/YAML 模式与 E2E mock。运行时仍派生 `card.data.name` / `card.data.cardText` / `card.data.groupName` 供 UI 和规则读取，但 DB 不再存重复列。
- 新增 `src/scripts/sync-cards-loveca-excel.ts`：解析 `docs/card-data-sync/sources/loveca_20260626015115.xlsx`，用 Loveca Excel 优先更新 `name_jp` / `name_cn`、`card_text_jp` / `card_text_cn`、`group_names`、`unit_name_raw` / `unit_name`、收录商品和来源字段；不读取 Excel 官方 `作品名` / `参加ユニット`，归属信息只使用修正后的 `真实团体` / `真实小队`；不覆盖费用、Heart、分数等规则字段；重复标准化卡号跳过并 warning；无 `DATABASE_URL` 时支持 parse-only dry-run。
- 同步调整 `src/scripts/sync-cards-llocg.ts`、`validate-group.ts`、`normalize-group.ts` 以读写新字段结构；文档同步：`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md`、`docs/card-data-sync/llocg-vs-xlsx-format-audit-20260626.md` 与卡牌管理字段文档已更新为无重复 schema 口径。
- 前端卡牌信息展示补齐双语：对战卡牌详情浮窗、卡组编辑详情抽屉、卡牌图片 fallback/hover、卡组浏览/侧栏、管理页列表、判定面板与对局记录可见卡摘要均显示或使用中文/日文名称；详情效果区显示中文与日文效果。`ViewFrontCardInfo` 投影直接携带 `nameJp/nameCn/cardTextJp/cardTextCn`，不再暴露单一 `name/text` 字段；前端展示/搜索链路直接读取新字段，不使用旧派生字段做兼容；运行时 `groupName` 与团体筛选改由 `group_names` 派生。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm exec tsc -p tsconfig.server.json --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/unit/battle-animation-events.test.ts tests/integration/online-command-pipeline.test.ts` passed（79 tests）；`pnpm exec tsx src/scripts/sync-cards-loveca-excel.ts --dry-run` passed（parse-only，2274 行，3 组重复卡号，2268 个可用卡号）；`pnpm exec tsx src/scripts/sync-cards-llocg.ts --dry-run` passed（2285 张转换记录）；`git diff --check` passed。

## 本次 2026-06-24 PR review feedback 处理

- 修复 LIVE 放置阶段选中手牌时，Live 区 “里侧放置” 标签作为普通 flex 子元素把 Live 区容器拉高、影响下方布局的问题；该标签现改为 Live 区右上角绝对定位角标，不参与布局高度计算。
- 修复检视区打开时，手牌右侧抽牌/回顶快捷箭头层级高于检视面板的问题；检视区面板提升到 `z-[60]`，高于桌面普通快捷控件，仍低于动画/反馈/全屏弹窗层。
- 修复连续快速点击手牌右侧“放回顶部”箭头时，组件闭包重复使用旧最右手牌 id，导致第二次命令报“卡牌当前不在手牌”的问题；点击时改为读取 store 最新手牌，并进入 pending 到手牌列表 / match seq 变化后解除，带超时兜底，防止本地重渲染窗口或远程响应延迟期间重复提交。
- 修正卡组与手牌之间的飞行动画尺寸：动画层对 `MAIN_DECK / ENERGY_DECK <-> HAND` 移动使用标准竖卡比例代理 rect，避免手牌扇形旋转/缩放后的 DOM bounding box 让飞行卡片看起来被拉宽或压扁。
- 已处理 `PR_REVIEW_FEEDBACK_DRAFT.md` 中两项建议优先修复问题：`GameBoard` 拖拽开始时预计算并缓存 battle action intents，hover/drop 复用同一批 intents，状态 key 失效时兜底重算；`BattleAnimationLayer` delayed animation timeout 增加 view diff generation 防护，过期 delayed event 不再插入当前动画队列，并清理其尚未播放的移动遮挡。
- 后续补强：`PlayerArea` 普通 droppable 统一禁用检视区来源 hover/drop 高亮，检视区内部排序与右侧目标按钮保持可用；`tests/unit/battle-animation-events.test.ts` 补 DOM `data-object-id` 与投影 public object id 对齐测试。
- PR review 后续修复：检视区 / 解决区拖拽 intent 未命中时补明确错误反馈，避免静默失败；检视区因入场动画暂时隐藏时显示轻量等待提示；`DroppableZone` 仅在需要按拖拽来源禁用时订阅 dnd context，降低普通 drop zone 拖拽重渲染面；动画事件测试补充无 DOM 锚点、检视区新增卡自动滚动与跨 match 不滚动覆盖。
- 非代码确认项保留：仓库本地 skills 是否进入 `skills-lock.json`、联机调试离开房间是否需要服务端离开语义、active effect 初始挂载/重连 fallback、`suppressActiveEffectVisuals` 全局 suppression 设计、`LiveResultAnimation` 文案仍需维护者/产品确认；当前未强行改变这些语义。组件级 React smoke tests 暂因现有 Vitest node 环境无 React DOM 测试栈，记录为后续测试基建事项。
- 验证：`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/unit/battle-action-executor.test.ts tests/unit/battle-action-feedback.test.ts tests/unit/battle-action-intent.test.ts tests/unit/battle-animation-events.test.ts tests/unit/battle-drag-action.test.ts tests/unit/battle-animation-sequencing.test.ts` passed（当前匹配 5 个测试文件，32 tests）；`git diff --check` passed；`pnpm --dir client build` passed（保留既有 chunk size / browserslist 提示）。

## 本次 2026-06-24 休息室入场动画初版

- 按 `BATTLE_WAITING_ROOM_ENTRY_ANIMATION_DRAFT.md` 初版硬约束实现单张正面 `HAND -> WAITING_ROOM` 专用 `WAITING_ROOM_REVEAL`：事件层只从 `PlayerViewState` diff 判定，不进入规则/卡效 workflow；检视区清理、堆叠/下方卡移动和多张同 diff 仍保留默认移动或既有 `ZONE_PULSE`。
- `BattleAnimationLayer` 新增三段休息室 reveal 动画：飞到休息室上方可读展示点、停留、再缩入小叠牌；遮挡生命周期改为使用 per-event duration，避免 reveal 期间终点休息室提前露出同一对象。reduced-motion 下仍降级为短 pulse。
- 隐藏信息边界同步收口：移动代理只在当前投影 `surface === FRONT` 时携带/使用 `cardCode`、卡名与正面图片；背面对象进入休息室不生成 reveal，也不在动画 alt/imageSrc 泄露正面信息。对手手牌背面区域补 scoped animation anchor，用于对方弃手时提供区域起点，不暴露具体手牌对象。
- 验证：`pnpm exec vitest run tests/unit/battle-animation-events.test.ts` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。Playwright 已登录 5173 测试环境并进入对墙打桌面：桌面普通动效拖 1 张手牌进休息室，截图覆盖 during/after，最终显示己方休息室从 0 到 1；reduced-motion 下同路径最终状态正确；390x844 窄屏可进入主要阶段并截图确认桌面加载。

## 本次 2026-06-23 第四批新卡/补全卡效

- 已完成 `PL!HS-cl1-010-CL` 分数 3「AWOKE」：LIVE 开始时选择自己舞台有效费用 10 以上的『莲之空』成员，LIVE 结束时为止获得 BLADE +2。
- 候选读取 `getMemberEffectiveCost`，可吃 `MEMBER_COST` live modifier；非莲之空、对方成员、有效费用不足成员不进候选。BLADE modifier 以被选择目标成员作为 `sourceCardId`。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-cl1-010-awoke.test.ts`。

## 本次 2026-06-23 第三批新卡/补全卡效

- 已完成 `PL!HS-bp5-022-L` 分数 4「Retrofuture」：LIVE 开始可支付 2 活跃能量；支付后重新扫描己方舞台有效费用 9 以上 EdelNote 条件，满足时选择低费 EdelNote 从休息室登场，或使此 LIVE 紫色必要 Heart -1。
- 登场分支会从等待室选择费用 4 以下 EdelNote 成员并选择空成员区，随后入队本次 `ON_ENTER_STAGE`；无高费 EdelNote 时费用保留并 no-effect，低费候选或空位不足时只提供 requirement 模式。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-bp5-022-retrofuture.test.ts`。

## 本次 2026-06-23 第二批新卡/补全卡效

- 已完成 `PL!HS-pb1-030-L` 分数 7「Edelied」：LIVE 开始时先选择己方舞台 1 名 EdelNote 成员获得 BLADE +2，再选择 1 名与其卡名不同的 EdelNote 成员获得紫 Heart +2。
- 第一段无 EdelNote 目标时 no-target 结算；第二段无不同卡名目标时保留第一段 BLADE，并 no-target 继续结算。第二段目标在确认时重新扫描，同名 EdelNote 不可作为目标。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-pb1-030-edelied.test.ts`。

## 本次 2026-06-23 第一批新卡/补全卡效

- 已完成 `PL!HS-bp6-007-P / R` 费用 15「セラス 柳田 リリエンフェルト」：自动 / 1 回合 1 次，己方 EdelNote 成员登场时，对方自己选择自身舞台 1 名 active 成员变 WAITING；自身登场也触发。非 EdelNote 登场只 no-op，不消耗 turn1。
- 已补全 `PL!-pb1-015-P＋ / R` 费用 11「西木野真姫」一效果：中心位登场 / LIVE 开始时，可将己方 BiBi 成员变 WAITING；费用成功后，对方自己选择自身 active 成员变 WAITING。保留并验证既有二效果：该等待低费对方成员时抽 1。
- 新增窄 helper `workflows/shared/target-player-wait-own-active-member.ts`，只负责“指定玩家选择自己 active 成员变 WAITING”；BiBi 费用、EdelNote 触发检查、turn1 判断仍留在单卡 workflow。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-bp6-007-seras.test.ts`、`tests/integration/pb1-015-maki.test.ts`。

## 本次 2026-06-21 正式联机请求重开

- 正式联机房间新增请求式重开流程：进行中对局里玩家可发起“请求重开”，对手可同意/拒绝，发起者可取消，请求会超时或在参与者离开时失效。
- 服务端在 `OnlineRoomService` 保存 `restartRequest` 房间状态；对手同意后先创建新 match，再封存旧 match 为 `ROOM_RESTART_ACCEPTED`，最后把房间指向新 `matchId`，避免原地抹除当前对局。
- 前端 `OnlineRoomPage` 左上角房间操作区现在把“请求重开/取消重开”和“离开房间”放在同一组；有待处理请求时显示协商条，并通过现有房间轮询同步状态。
- 文档同步：`docs/battle-mode-purpose-and-boundaries.md` 已补充正式联机重开边界，明确重开是双方协商的房间级操作，离开房间仍是单方退出；`docs/PROJECT_REQUIREMENTS.md` 与 `game_system_design.md` 已同步高层联机能力口径。
- 验证：`pnpm exec vitest run tests/integration/online-room-service.test.ts tests/integration/online-route-error-handling.test.ts` passed；`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`git diff --check` passed。

## 本次 2026-06-17 对墙打退出按钮点击命中修复

- 修复对墙打桌面左上角“离开房间”偶发点击无反应：`DebugControl` 顶部透明 fixed 外层原本横跨近全屏且 z-index 高于离开按钮，会在按钮上方区域吃掉点击。
- 修复方式：`DebugControl` 外层改为 `pointer-events-none`，实际控制条保留 `pointer-events-auto`，不改变布局与控制条自身交互。
- 验证：`pnpm --dir client exec tsc -b` passed；Playwright 临时脚本进入对墙打桌面后，左上角按钮上半区/中心/下半区/右侧 `elementFromPoint` 均命中按钮本身，点击按钮左上角内部位置可返回“游戏准备”页。

## 本次 2026-06-15 `ON_MEMBER_STATE_CHANGED` 事件日志消费

- `MemberStateChangedEvent` 现在可携带状态变化来源 `cause`，区分玩家操作、规则处理与卡片效果；普通 `TAP_MEMBER` 会写入 `PLAYER_ACTION`，活跃阶段将待机成员重置为活跃会写入 `RULE_ACTION`，卡效目标选择与自身方向费用会写入 `CARD_EFFECT`。
- `enqueueTriggeredCardEffects(ON_MEMBER_STATE_CHANGED)` 已开始逐类型消费成员状态变化事件：默认取最近事件，卡效结算会显式传入本次新产生的状态变化事件。当前仍不是完整通用 `GameEvent -> trigger matcher`。
- 已完成 `PL!N-bp4-018-N`：自己主要阶段中，此成员自身 `ACTIVE -> WAITING` 时抽 1 弃 1；通过手动 `TAP_MEMBER` 事件验证。
- 已完成 `PL!-pb1-015-P＋ / R`：1 回合 1 次，因自己的卡片效果使对方舞台费用 <= 4 成员 `ACTIVE -> WAITING` 时抽 1；通过 `PL!HS-bp6-004-R` 让对方成员变待机验证 `CARD_EFFECT cause`。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/effect-costs.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 156 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LIVE_START` 事件日志消费

- 已先 `git fetch upstream` 并 fast-forward `effect_refactor_20260615` 到 `upstream/main` 的 `3abcb97`；确认 `6837c82ff3af6b34e4bd552c8d46fdae1fdc3ea4` 已在作者 `main` 中。
- PERFORMANCE 阶段翻开 LIVE 卡并进入 LIVE 开始检查时机前，现在会写入 `LiveStartEvent(ON_LIVE_START)`，记录表演玩家与本次 LIVE 区卡牌 ID 列表。
- `enqueueTriggeredCardEffects(ON_LIVE_START)` 改为优先消费 `eventLog` 中最近的 `LiveStartEvent` / 显式 `liveStartEvents`，并把 `PendingAbilityState.eventIds` 绑定真实 `eventId`；无事件时继续保留旧 synthetic `live-start:turn:player` fallback。
- 回归覆盖 LIVE 卡来源 `PL!HS-bp5-019-L` 分数 6「花结」与舞台成员来源 `PL!HS-bp6-004-R` 费用 13「百生 吟子」：前者确认 LIVE 开始事件包含两张 LIVE 卡，后者确认同源双 LIVE 开始 pending ability 共享本次 `LiveStartEvent.eventId`。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 147 tests passed；同步前基线同套件 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LIVE_SUCCESS` 事件日志消费

- LIVE 结果阶段进入某玩家成功效果窗口时，现在会写入 `LiveSuccessEvent(ON_LIVE_SUCCESS)`，记录成功玩家、本次成功 LIVE 卡列表与当前分数草案；同一玩家同一组成功 LIVE 已写过事件时不会重复写入。
- `enqueueTriggeredCardEffects(ON_LIVE_SUCCESS)` 改为优先消费 `eventLog` 中最近的 `LiveSuccessEvent` / 显式 `liveSuccessEvents`，并把 `PendingAbilityState.eventIds` 绑定真实 `eventId`；无事件时继续保留旧 `liveResults` 推导与 synthetic fallback，兼容直接 `executeCheckTiming` 的测试/旧路径。
- 回归覆盖 `LiveSuccessEvent` 工厂、真实阶段推进中二号玩家成功时的事件写入，以及只依赖 `LiveSuccessEvent`、不依赖 `liveResolution.liveResults` 时同时入队舞台成员来源 `PL!HS-bp6-001` 费用 4「日野下花帆」与 LIVE 卡来源 `PL!HS-cl1-009` 分数 1「水彩世界」。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 149 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_ENTER_STAGE` 事件日志消费

- 普通 `PLAY_MEMBER` 手牌登场现在写入 `EnterStageEvent(fromZone=HAND)`；卡效 `playMembersFromWaitingRoomToEmptySlots` 从休息室登场现在写入 `EnterStageEvent(fromZone=WAITING_ROOM)`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 路径改为优先消费 `eventLog` / 显式 `EnterStageEvent`，并继续保留旧 `PLAY_MEMBER` action-history fallback。
- 默认检查时机只消费最近一次登场事件，避免旧登场历史被后上场的舞台监听 AUTO 误触发；卡效登场会显式传入本次新产生的 `EnterStageEvent` 列表。
- 回归覆盖 `PL!HS-bp6-004-R` 费用 13「百生 吟子」手牌登场、`PL!S-bp2-006-P` 费用 11「津岛善子」从休息室登场后触发 `PL!-sd1-004-SD` 费用 11「南小鸟」登场能力，以及 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」登场段。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LEAVE_STAGE` 事件日志消费

- `LeaveStageEvent` 现在可携带 `replacingCardId`；普通舞台成员移动进休息室、换手替换离场、以及 `SEND_SOURCE_MEMBER_TO_WAITING_ROOM` 自送费用都会写入 `GameState.eventLog`。
- `enqueueTriggeredCardEffects` 的 `ON_LEAVE_STAGE` 路径改为优先消费 `eventLog` / 显式 `LeaveStageEvent`，并继续保留旧 `actionHistory` 来源推断作为兼容回退。
- 换手离场与新成员登场的顺序选择窗口改为识别 `replacingCardId` 关系；因此登场事件和离场事件不需要共享同一个 `eventId`，仍会让玩家选择先后。
- 回归覆盖 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」、`PL!HS-bp6-017-N` 费用 11「日野下花帆」与 `PL!HS-sd1-001-SD` 费用 9「日野下花帆」三条离场 AUTO proving path。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 成员移动事件消费与 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」

- `enqueueTriggeredCardEffects` 已开始消费 `ON_MEMBER_SLOT_MOVED` eventLog：按事件中的移动成员作为 AUTO 来源、用 `eventId` 写入 `PendingAbilityState.eventIds` 并防重复入队。
- 普通 `MOVE_MEMBER_TO_SLOT` 现在也会写入 `ON_MEMBER_SLOT_MOVED`，并在命令提交时入队/启动对应 AUTO；卡效 helper 的站位变换路径在结算后同样消费新产生的成员移动事件。
- 已完成 `PL!SP-bp4-011-P`（基础编号 `PL!SP-bp4-011`，费用 7「鬼冢冬毬」）：自身登场或成员区槽位移动/交换时，选择对方舞台原本 BLADE <= 3 的成员变为待机；无合法目标时能力仍入队并以 `SKIP_NO_TARGET` 结算。
- 边界：登场只走 `ON_ENTER_STAGE`，不额外当作成员区移动重复触发；当前只消费成员槽位移动事件，完整区域移动/支付/状态变化 trigger matcher 仍后续推进。
- 验证：`tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 134 tests passed；`pnpm exec tsc --noEmit` passed。

## 本次 2026-06-15 事件日志与成员事件底座

- 新增 `GameState.eventLog` / `eventSequence` 与纯函数 `emitGameEvent`，作为后续 AUTO / trigger matcher 的不可变权威事件流；`actionHistory` 继续保留给审计、UI 与既有流程。
- `src/domain/events/game-events.ts` 新增 `ON_MEMBER_STATE_CHANGED` / `ON_MEMBER_SLOT_MOVED` 事件类型与工厂函数；`EventBus` 已标注为非权威运行时工具，不接入规则触发。
- `src/application/effects/member-state.ts` 已在成员待机/活跃、批量方向变更、站位变换/交换成功后写入 `eventLog`。交换会为主动移动成员和被交换成员各记录一条 `ON_MEMBER_SLOT_MOVED`。
- 当前边界：本批第一步只写事件事实；随后已用上方 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」完成成员移动事件消费 proving path。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` 共 10 tests passed；`tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 131 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 快速卡效批处理：`PL!HS-pb1-012-R` 费用 13「百生吟子」

- 已完成 `PL!HS-pb1-012-R / P+` 登场效果：自己和对方各自将休息室所有成员卡洗牌放到自身卡组底；若双方因此合计放到底部的卡片大于等于 20 张，则从自己的休息室回收 1 张 LIVE，并通过 `BLADE` live modifier 获得 BLADE +2。
- 规则细节：中文/日文同编号文本一致，按基础编号 `PL!HS-pb1-012` 登记；FAQ 路径已覆盖“没有可回收 LIVE 时仍获得 BLADE”。
- 复用范围：继续沿用 `shuffleZone`、`WAITING_ROOM -> HAND` zone-selection、`addLiveModifier(BLADE)` 与现有登场队列；未新增 resolver / cost calculator / live modifier registry 结构。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖同编号 `R / P+` 基础编号登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖双方合计 20 张且回收 LIVE、合计 20 张但无 LIVE 仍加 BLADE、合计不足 20 时不回收不加 BLADE。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。

## 本次 2026-06-14 低风险同型 LIVE 开始扩样本（基于 `PL!-bp4-010-N`）

- 收束范围：
  - `PL!HS-PR-018-PR` / `PL!HS-PR-018-RM`（基础编号 `PL!HS-PR-018`，费用 4「大泽瑠璃乃」）
  - `PL!HS-cl1-005-CL`（基础编号 `PL!HS-cl1-005`，费用 4「徒町 小鈴」）
  - `PL!N-bp4-013-N`（基础编号 `PL!N-bp4-013`，费用 4「上原步梦」）
  - `PL!S-pb1-016-N`（基础编号 `PL!S-pb1-016`，费用 4「国木田花丸」）
  - `PL!S-pb1-017-N`（基础编号 `PL!S-pb1-017`，费用 4「小原鞠莉」）
  - `PL!S-pb1-018-N`（基础编号 `PL!S-pb1-018`，费用 4「黑泽露比」）
  - `PL!SP-bp1-006-R`（基础编号 `PL!SP-bp1-006`，费用 9「樱小路 希奈子」）
  - `PL!SP-bp2-019-N`（基础编号 `PL!SP-bp2-019`，费用 4「若菜四季」）
  - `PL!SP-bp2-022-N`（基础编号 `PL!SP-bp2-022`，费用 4「鬼冢冬毬」）
- 本窗口实现：
  - 复用现有 `BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID`，保持 `start/finishLiveStartPayEnergyGainFixedBlade`，仅扩展同一能力的 `baseCardCodes` 覆盖范围。
  - 更新测试：`tests/unit/card-effect-classification.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`（新增 `PL!HS-PR-018-RM` 代表卡样例）并保留 `tests/unit/card-effect-rarity-sync.test.ts` 的全量防线。
  - 本窗口文档增量：`docs/card-effect-reuse-audit/existing_module_map.md`（新增 9 条基础编号同型已实现）。
- 下窗口建议：
  - 维持低风险同构策略，优先开新 LIVE 开始样例前验证同基础编号文本一致性。

## 本次 2026-06-14 低风险同型 ON_ENTER 扩样本（基于 `PL!SP-PR-004-PR`）

- 收束范围：
  - `PL!SP-PR-006-PR`（基础编号 `PL!SP-PR-006`，费用 4「平安名堇」）
  - `PL!SP-PR-013-PR`（基础编号 `PL!SP-PR-013`，费用 4「鬼冢冬毬」）
  - `PL!SP-bp1-021-N`（基础编号 `PL!SP-bp1-021`，费用 4「薇恩・玛格丽特」）
  - `PL!SP-sd1-014-SD`（基础编号 `PL!SP-sd1-014`，费用 4「岚 千砂都」）
  - `PL!SP-sd1-016-SD`（基础编号 `PL!SP-sd1-016`，费用 4「叶月 恋」）
- 本窗口实现：
  - 保持 `KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID` 与 `start/finishKekeOnEnterPlaceWaitingEnergy` 复用，仅扩展 `baseCardCodes`。
  - 更新 `tests/unit/card-effect-classification.test.ts`：增加上述 5 个基础编号的 ON_ENTER 注册校验。
  - 更新 `tests/integration/sample-card-effect-runner.test.ts`：新增 `PL!SP-PR-013-PR` 同壳登场 + 弃 1 发动样例。
- 本窗口文档增量：`docs/card-effect-reuse-audit/existing_module_map.md` 新增 5 条基础编号同型已实现记录。

## 本次 2026-06-14 抽弃壳参数化扩展

- 目标：把 `DRAW->DISCARD` 同构壳从“抽X弃1”改造为 `drawCount / discardCount` 可配置，避免下一批同型扩展时继续新增壳。
- 变更：新增 `discardCount` 配置项，`start/finish` helper 改名为 `startDrawThenDiscardCardsEffect` 与 `finishDrawThenDiscardCardsEffect`；支持 `selectedCardIds` 批量弃牌移动（仍兼容现有单卡 `selectedCardId`）。
- 兼容：保留原 `HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID` / `HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID` 导出入口，并补充 `MEMBER_ON_ENTER_DRAW_DISCARD_ABILITY_ID` / `MEMBER_ON_ENTER_DRAW_DISCARD_ONE_ABILITY_ID` 作为泛化命名。
- 校验：`tests/unit/card-effect-classification.test.ts` 与 `tests/integration/sample-card-effect-runner.test.ts` 的覆盖点保持不变（当前仅 1/1 场景）；参数化行为以后可直接扩展。
- 文件：`src/application/card-effect-runner.ts`、`docs/card-effect-reuse-audit/existing_module_map.md`。
- 下一步建议：将 `discardCount >1` 场景补一个参数化回归（含 `selectedCardIds` 路径）验证。

## 本次 2026-06-14 LIVE 合计分数失败结算修复

- 修复 `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」这类 LIVE 合计分数修正的失败结算边界：玩家没有成功 LIVE 时，`SCORE` live modifier 不再让最终分数草案从 0 增加。
- 修复范围覆盖两条读路径：判定阶段自动生成 `playerScores` 草案，以及进入 LIVE 结算阶段时的 `calculateLiveScore` 兜底计算。
- 新增 focused 回归：`tests/unit/live-judgment-settlement.test.ts` 覆盖失败 LIVE + 玩家合计分数修正仍为 0；同步修正 `tests/integration/sample-card-effect-runner.test.ts` 中 `PL!-bp3-014-N` 费用 4「星空 凛」样例的测试局面写回与登场支付前置。

## 本次 2026-06-14 Live 卡 BLADE 心同编号继承修复

- 修复 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」原始数据 `blade_heart` 为空时，判定区不会把同编号 `PL!HS-bp2-022-L` 的 `b_all` 计入 ALL 心的问题。
- 新增 `inheritMissingBladeHeartsByBase` 数据规范化 helper，并接入 `sync-cards-llocg.ts`、服务端 `CardDataRegistry`、`/api/cards` 与 `/api/cards/export`；前端 `cardService` 也在整表缓存入口做同样防御，避免旧 API 列表导致本地判定遗漏。
- 新增 focused 回归：`tests/unit/blade-heart-inheritance.test.ts` 覆盖同编号同类型继承、不覆盖已有 BLADE 心、不跨卡种继承；`tests/unit/heart-live.test.ts` 补充 `HEART + RAINBOW` 声援处理。

## 本次 2026-06-14 `PL!HS-pb1-020-N` 多步骤多选状态修复

- 修复 `PL!HS-pb1-020-N` 费用 9「百生吟子」登场效果中，弃 2 张手牌后进入休息室分组回收步骤时，前一步多选状态被前端沿用，导致不可见旧手牌 id 占满选择数量并卡住效果处理的问题。
- `GameBoard` 现在会在 active effect 的步骤、选择模式或候选卡集合变化时清空 ordered multi selection；确认按钮也会校验所有已选 id 仍属于当前候选，点击候选时会先过滤掉旧候选残留。
- 新增 focused 回归：`tests/integration/sample-card-effect-runner.test.ts` 覆盖弃手进入回收后旧手牌 id 不在新候选中，误传旧选择会被拒绝且效果仍可继续。

## 本次 2026-06-14 处理中的效果窗口折叠 UI

- `GameBoard` 的“处理中的效果”窗口新增“隐藏”按钮，折叠后显示右下角小浮条，保留当前效果来源与步骤摘要，并可用“展开”恢复窗口。
- 折叠只属于前端本地 UI 状态，不改变 `activeEffect`、不写对局 action；当 active effect id 或 stepId 变化时自动展开，避免玩家错过新步骤。

## 本地测试卡组与卡图资产

当前事实：

- 测试卡组 YAML 位于 `assets/decks/`，当前有 `缪预组.yaml`、`绿莲-6弹ver.yaml`、`蓝紫.yaml` 与 `系统边界混合.yaml`；这些 YAML 仍可供预设卡组、对墙打默认对手或后续测试资产参考。
- `绿莲-6弹ver.yaml` 已作为新人推荐卡组与 μ's 预组并列接入前端预设；`pnpm test-env:start` 会创建/提权 `test_admin` 管理员账号，并把该卡组以公开卡组写入管理员名下。
- 首页独立“本地测试对局”入口已于 2026-06-14 移除；后续卡效验证优先使用作者提供的 `pnpm test-env:start` 完整测试环境和云端卡组。
- 卡图下载脚本为 `scripts/download-local-test-card-images.mjs`。脚本已改为自动扫描 `assets/decks/*.yaml` / `*.yml`，不再硬编码两副卡组。
- 当前 `--dry-run --exact-only` 结果：四副测试卡组引用 99 张精确卡图；实际下载、同编号罕度展开与 WebP 别名数量以脚本输出为准。
- 当前测试服务器仍依赖 `assets/images/` 的本地图片 fallback；未明确切换到完整对象存储图片前，不要删除 `assets/images/`。

2026-06-14 临时测试服务器补图记录：

- 作者提供的一键测试环境可用云端卡组测试，但本机没有完整生产卡图对象存储；为了改善本地测试体验，临时从 `/Users/meiyikai/Desktop/文件/个人/codex/loveca/deck` 下的两副外部 YAML 卡组补齐所需卡图到 `assets/card/` 与 `assets/images/{thumb,medium,large}/`。
- `scripts/download-local-test-card-images.mjs` 已补充 `--deck-dir=...`，并默认按同基础编号展开全部罕度。例如 deck 中出现 `PL!HS-pb1-009-R` 时，会同时尝试补 `PL!HS-pb1-009-P+` 等同编号变体。
- 为兼容数据库 `image_filename` 与中文卡图路径的命名差异，脚本会为同一源图生成多个 WebP 别名，例如 `P+` / `P2` / `Pplus`、`L+` / `L2` / `Lplus`。这属于本地显示兼容层，不代表生产文件命名规范。
- 这些临时图片只影响卡图显示，不参与规则引擎、费用计算、卡效触发、对局状态或测试服务器数据库逻辑。卡效开发仍应以卡牌数据和对局行为验证为准。
- 生产环境已有正常图片服务器/对象存储。上线或发正式 PR 前，应重点检查 `assets/card/` 与 `assets/images/` 中由本次补图产生的大量临时文件，不要把它们当作生产资产提交；生产图片链路确认正常后，可以清理这些临时图片，不会影响已实现卡效。

常用命令：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs --dry-run
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs
```

## 当前状态

本地测试桌面已经进入“LIVE 自动判定 + 卡效分类底座”阶段。

## 本次 2026-06-16 condition/query 第二批小收束

- `src/application/effects/conditions.ts` 继续扩展纯函数 query：新增按 cardIds 返回 selector 命中 id、舞台成员存在性、来源以外其他舞台成员等查询。
- 小范围迁移 runner 内联条件/计数：`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」登场相关成员存在条件、`PL!HS-bp6-001` 费用 4「日野下花帆」登场动态舞台成员数、`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」等待室成员与 `みらくらぱーく！` 成员计数、`PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始“其他成员”条件。
- 补 `tests/unit/conditions.test.ts`，覆盖 selector 计数/阈值、区域与成功 LIVE 计数、舞台成员条件、LIVE 区排除来源计数、来源有效 BLADE 阈值查询；文档口径仍保持“第一版 helper 起步”，不提前纳入 frozen baseline。
- 本次仍不改变事件层、不改变 pending 顺序、不改变费用模块；`PL!HS-bp1-003` 常时三面不同名条件位于 `domain/rules/live-modifiers.ts`，为避免 domain 反向依赖 application，本批暂不迁移。

## 本次 2026-06-15 condition/query 第一版

- 新增 `src/application/effects/conditions.ts`，作为第一版纯函数 query/condition 模块；当前只提供区域计数、selector 计数/阈值、成功 LIVE 数、舞台成员数、LIVE 区排除来源卡计数、来源成员有效 BLADE 阈值查询，不做 AST、不做声明式 steps。
- 小范围迁移 runner 内联条件/计数：`PL!-sd1-009-SD` 费用 11「矢泽妮可」、`PL!-sd1-022-SD` 分数 4「僕らは今のなかで」、`PL!HS-bp5-019-L` 分数 6「花结」、`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」、`PL!HS-pb1-009-R` 费用 15「日野下花帆」，并顺手复用到 `PL!-sd1-001-SD` 费用 7「高坂穗乃果」成功 LIVE 条件与 `PL!HS-pb1-020-N` 费用 9「百生吟子」休息室 LIVE 数条件。
- 本次不改变事件层、不改变 pending 顺序、不改变费用模块、不拆 `definitions/index.ts`，只把少量 inline 计数替换为可复用 query 函数。
- 验证：`tests/unit/card-effect-classification.test.ts` 5 tests passed；`tests/integration/sample-card-effect-runner.test.ts` 133 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 卡效定义层拆文件

- `CARD_ABILITY_DEFINITIONS`、卡面效果文本、能力 id 与 definition 类型已从 `src/application/card-effect-runner.ts` 拆到 `src/application/card-effects/` 下。
- `card-effect-runner.ts` 继续保留入队、pending、resolver dispatch、执行流程与步骤解释逻辑；行为预期不变。
- 本次未做声明式 steps 迁移，也未调整费用期间事件消费时机。

目前已完成的核心方向：

- 对局前端已新增可剥离的卡效自动化视觉标记：正面已自动化卡牌在卡顶中间显示约 4px 小点与 1px 圆角外描边，当前正在处理/可发动时变亮；标记只在 `PlayerArea` 等对局组件中通过 `Card.effectVisualState` 传入，不进入卡牌数据库。控制入口为 `client/src/lib/cardEffectAutomationVisuals.ts`，默认开启，可用 `VITE_CARD_EFFECT_VISUAL_MARKERS=false` / `0` / `off` 关闭；后续若全卡效完成后想剥离，删除该 helper、`CardEffectMarker`、`Card.effectVisualState` prop 和 `PlayerArea` 传参即可。
- 活跃阶段规则自动化已补齐：进入某玩家活跃阶段时，`GameService` 的 `UNTAP_ALL` 会将该玩家舞台成员和能量全部恢复为活跃状态；不会同时重置非当前玩家。
- LIVE 判定区会按当前光棒数自动翻推荐应援牌。
- 玩家仍可手动调整判定区，然后选择接受自动判定。
- 接受后系统会生成 Live 成功/失败、抽卡、分数草案，玩家仍保留强制成功/失败等人工修正入口。
- 多首 Live 判定已按规则改为“全部 Live 成功才算整个 Live 成功”；任一 Live 失败时总分为 0。
- Live 失败与 Live 成功但分数为 0 在状态中保持区分。
- 多首 Live 会先合并需求再判定，避免按单首贪心消耗 Heart 导致误判。

## 卡效分类与底座

`src/application/card-effects/definitions/index.ts` 已建立 `CARD_ABILITY_DEFINITIONS` 登记入口。新增卡效前先登记分类，不要直接写单卡散逻辑；`card-effect-runner.ts` 仍负责执行与 resolver dispatch。

2026-06-14 起，连续新增多张卡效时采用“快速卡效批处理模式”：每张卡/每个效果段实时更新 `docs/card-effect-reuse-audit/existing_module_map.md`、focused tests 与本 progress 的短记录；`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档默认不随每张卡更新。若引入新抽象、新模块、新事件边界，或改变 resolver / cost calculator / live modifier registry / 同编号罕度同步机制，则仍需在同一批内同步更新相关文档。若只是复用既有模块追加同构卡效，即使连续做 5-10 张，也先保持主登记册、progress 与测试准确；等用户明确要求“这批收束/提交”时，再做一次批末摘要式收束，避免全文扫描式重写。

当前分类约定：

- `CONTINUOUS`：常时，不进队列，由计算层读取。
- `ON_ENTER`：登场，触发后进入待处理效果队列。
- `ACTIVATED`：起动，由玩家合法时点主动发动。
- `LIVE_START`：LIVE 开始，同一时点多效果必须进 LIVE 开始队列，由玩家选择顺序。
- `LIVE_SUCCESS`：LIVE 成功，只有对应 Live 成功后才能入队。
- `AUTO`：其他自动诱发，后续按具体触发条件入队。

已抽出的通用能力/步骤：

- 手牌放置入休息室作为通用发动代价，当前 N=1 使用 `createDiscardHandToWaitingRoomActivationEffect` / `moveHandCardToWaitingRoomForEffect`。
- UI 文案统一为“请选择要放置入休息室的卡牌”，跳过按钮为“不发动”。
- 检视卡组顶 N 张、选择目标、公开被选牌、加入手牌、其余入休息室已开始共用流程；基础检视/清理/移动原语已落在 `src/application/effects/look-top.ts`。
- “公开并加入手牌”必须先公开被选牌，再由玩家确认后移动。
- 必要 Heart 增减使用 `applyHeartRequirementModifiers`，支持指定颜色、泛用/All、增加和减少。
- “1回合 N 次”作为能力定义通用特征，使用 `perTurnLimit` 登记；通用 `ABILITY_USE` 按 `playerId + abilityId + sourceCardId + turnCount` 记录和校验，限制的是此来源卡实例，不是同名卡或同一玩家同能力总次数。
- 卡效发动费用已开始收口为 `src/application/effects/effect-costs.ts` 中的通用 `EffectCostDefinition` / `payImmediateEffectCosts` / `paySelectedDiscardHandCost` 底座。当前已覆盖弃 1 手牌、支付活跃能量、将来源成员从舞台放置入休息室、将来源成员变为指定方向四类；`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `SET_SOURCE_MEMBER_ORIENTATION` 验证“自身待机作为费用”。
- 区域目标选择/移动已开始收口为 `src/application/effects/zone-selection.ts` 中的 `ZoneCardSelectionConfig` / `createWaitingRoomToHandEffectState` / `moveSelectedCardsFromZone`。当前覆盖 `WAITING_ROOM -> HAND` 单选路径，`001` / `003` / `002` / `005` 的“从休息室加入手牌”已走统一完成逻辑。
- 最小 selector API 已落在 `src/application/effects/card-selectors.ts`，当前提供 `typeIs` / `groupIs` / `unitIs` / `unitAliasIs` / `unitAliasOrTextAliasIs` / `costLte` / `costGte` / `cardNameIs` / `cardNameAliasIs` / `and` / `or` / `not`，`001` / `003` / `002` / `005` 已用组合 selector 表达 LIVE、成员、低费 μ's 等候选条件；`PL!HS-bp6-004-R` 费用 13「百生 吟子」已用 `cardNameIs` 处理弃置「百生吟子」成员判断；`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已用 `unitAliasIs` 识别真实导入数据中的 `unitName=スリーズブーケ`；`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」已用 `cardNameAliasIs` 判断舞台中是否有大泽瑠璃乃/百生吟子/徒町小铃，`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `costGte(9)` 筛选看顶候选。小组名别名当前覆盖 `Cerise Bouquet`/`スリーズブーケ`、`DOLLCHESTRA`、`Mira-Cra Park!`/`みらくらぱーく！`/`みらくらぱーく!`、`EdelNote`；普通小组条件只看 `unitName`，需要“此卡视为某小组”等文本身份时才显式使用 `unitAliasOrTextAliasIs`。成员名别名当前按卡库常见角色覆盖中日名、空白/中点差异与组合卡 `&` 分隔组件，并额外覆盖早期中文误译/异体：`澁谷かのん`/`渋谷かのん`/`涩谷香音`/`涉谷香音`、`大沢瑠璃乃`/`大泽瑠璃乃`/`大泽琉璃乃`、`セラス柳田リリエンフェルト`/`セラス 柳田 リリエンフェルト`/`赛拉丝柳田利林费尔德`/`赛拉丝·柳田·利林费尔德`；严格卡面名才继续使用 `cardNameIs`。
- 舞台成员目标选择 active effect 已由 `src/application/effects/stage-member-target-selection.ts` 起步：按 `targetPlayerId + CardSelector` 生成可选舞台成员，并在确认后调用 `setMemberOrientation`；`PL!HS-bp6-004-R` 费用 13「百生 吟子」对手低费成员待机段已迁入该入口。
- Live 修正已进入 Stage 1D 主写入路径：`domain/rules/live-modifiers.ts` 提供 `addLiveModifier` / `replaceLiveModifier` / `projectLiveModifierCompatibility`，临时修正统一写入 `liveResolution.liveModifiers` 的 `SCORE`、`HEART`、`BLADE`、`REQUIREMENT` modifier；旧的 `playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` 由 `liveModifiers` 投影，仅作为 UI/在线投影兼容层保留。常时修正已整理为 continuous modifier registry，`001` 常时 BLADE 与 `PL!N-pb1-004` 费用 11「朝香果林」未进行成员区位置移动时 BLADE +2 均由 `collectLiveModifiers` 动态收集。
- 状态与站位变换 Stage 1E 已起步：`src/application/effects/member-state.ts` 提供 `setMemberOrientation` / `moveMemberBetweenSlots`，覆盖卡效里的成员待机/活跃基础原语与站位变换。当前 `PL!N-pb1-004-P+` 的站位变换已改为调用 `moveMemberBetweenSlots`；新增 `positionMovedThisTurn` 只记录成员区槽位间移动/交换，登场不计入“移动”。普通规则 TAP_MEMBER、自由拖拽和手动移动仍归规则/桌面流程，不反向塞进 card effects。
- 抽牌 Stage 1F 已对当前 μ's 预组验证集收口：`src/application/effects/draw.ts` 提供 `drawCardsFromMainDeckToHand`，表达卡效步骤中的主卡组顶抽牌到手牌。当前 `007` 的额外抽 1 已迁入该 helper，并覆盖“翻到 Live 抽 1 / 未翻到 Live 不抽”的 focused tests；开局/阶段/LIVE 判定等规则流程抽牌仍归 `GameService`，不由该 helper 接管。F02 已由 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场起步为抽 2 弃 1 壳；F12/刷新语义继续等真实样例。

## 当前已实现/登记的 PL!-sd1 效果要点

- `001`：登场按成功 Live 区条件回收 Live；常时按成功 Live 数增加光棒，已由 `collectLiveModifiers` 动态收集为 `BLADE` modifier。
- `002`：起动，此成员进休息室，从休息室回收成员。
- `003`：登场回收低费 μ's 成员；LIVE 开始可弃 1 手牌并选择粉/黄/紫 Heart，已通过 `addLiveModifier` 写入统一 `HEART` modifier。
- `004`：登场检视顶 5，可选 μ's Live 公开并加入手牌，其余入休息室。
- `005`：起动，此成员进休息室，从休息室回收 Live。
- `006`：登场可公开手牌 Live，与成功 Live 区 Live 交换。
- `007`：登场公开顶 5 入休息室，其中有 Live 则抽 1。Step 8 closure check 已确认 golden 行为稳定；当前看顶/堆墓走 look-top 底座，额外抽 1 走 `drawCardsFromMainDeckToHand`。
- `008`：起动 `[1回合1次][E][E]`，公开/处理卡组顶 10。
- `009`：LIVE 开始，休息室 μ's 达 25 张时分数 +1，已进 LIVE 开始队列，并显示当前张数，已通过 `addLiveModifier` 写入统一 `SCORE` modifier。
- `011` / `012` / `016`：登场可弃 1 手牌；若弃了，检视顶 3，必须选 1 张加入手牌，其余入休息室。
- `015`：登场可弃 1 手牌；检视顶 5，可选成员公开并加入手牌，其余入休息室。
- `019 START:DASH!!`：已实现为 `LIVE_SUCCESS`。Live 成功后进入成功时效果队列，检视顶 3，支持选择任意张并按选择顺序放回卡组顶，其余入休息室。
- `022`：LIVE 开始，根据成功 Live 区数量减少此 Live 必要 Heart，已通过 `replaceLiveModifier` 写入统一 `REQUIREMENT` modifier，并同步兼容投影字段。
- `PL!N-pb1-004-P+`：测试用果林 LIVE 开始效果，公开顶 1，符合条件加入手牌并站位变换。
  - 站位变换当前通过 `member-state.ts` 的 `moveMemberBetweenSlots` 执行，会携带来源槽位下方的能量/成员，并可与目标槽位成员交换。
- `PL!SP-PR-004-PR`：登场可弃 1 手牌；如此做时，从能量卡组顶放置 1 张待机能量到能量区。
  - 当前实现复用 C01 弃手选择步骤，并通过 `src/application/effects/energy.ts` 的 `placeEnergyFromDeckToZone` 明确放置为等待状态。普通能量阶段默认放置为活跃状态的行为不变。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」：左侧登场时抽 2 弃 1；右侧登场时，将最多 2 张待机能量变为活跃；LIVE 开始时可以进行站位变换。
  - 当前实现通过 `requiredSourceSlots: [LEFT/RIGHT]` 做登场来源槽位条件过滤；左侧复用抽牌 helper 与手牌进休息室 helper，右侧通过 `src/application/effects/energy.ts` 的 `setFirstEnergyCardsOrientation` 执行能量方向变更。LIVE 开始段登记为 `LIVE_START` 队列能力，使用可选 slot-selection，并通过 `src/application/effects/member-state.ts` 的 `moveMemberBetweenSlots` 完成站位变换/交换。

## 全量卡池统计结论

已只读参考 `/llocg_db/json/cards_cn.json` 全量 2032 张卡，其中 1381 张有中文效果文本。

高频场景包括：

- 手牌放置入休息室
- 检视自己卡组顶
- 公开并加入手牌
- 加入手牌
- 其余卡片放置入休息室
- 从休息室加入手牌
- 将此成员从舞台放置入休息室
- `[E]` 费用
- LIVE 开始时
- LIVE 成功时
- 分数 +1
- 必要 Heart 增加/减少
- 1 回合 N 次

后续新增卡效时，应优先判断是否属于这些通用场景，先扩底座，再接具体卡号。

## 当前验证

最近已通过：

本次 2026-06-13 μ's 预组休息室回收 Stage 1A 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次未改前端交互，未启动 `5173` 做浏览器验证。

本次 2026-06-13 selector / zone-selection 单测与费用底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 look-top 底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 top-deck-to-waiting-room 底座补齐后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 `019 START:DASH!!` 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次卡效费用底座更新后同样已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次区域选择/移动底座更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 Live 临时修正流水线更新后已通过：

```bash
pnpm test:run tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1D Live modifier 主写入路径更新后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1E member-state / position-change 底座起步后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1F draw 底座收口后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

结果：11 files passed，99 tests passed，server/client TypeScript 均通过。

本次未改前端交互；开发服务器按需打开 `5173` 后，建议优先手测 `PL!-sd1-007-SD`。

本次 2026-06-13 Step 13 / Stage 1H catalog 回扫已完成文档侧收口：

- 用 `loveca_effect_fragments_catalog.json` 回扫当前已登记/实现卡牌，共覆盖当前样例集 19 个 catalog segments。
- 已刷新 `docs/card-effect-reuse-audit/existing_module_map.md`、`module_gap_list.md`、`safe_refactor_plan.md`，标出 Stage 1A-1F 已落地模块、仍 inline 的效果、当时暂缓模块与下一批非 `PL!-sd1` proving candidates。后续 Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」把 AUTO / S08 最小路径起步。
- 本次只改文档，不改业务代码；focused tests 仍为 11 files passed / 99 tests passed，`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!-sd1-022-SD` 必要 Heart 减少 UI 回归修复：

- 根因：后端 `REQUIREMENT` liveModifier 与判定读取链路正常，但前端 `JudgmentPanel` 用 raw `cardId` 查 `requirementModifiers` / `requirementReductions`；投影层字段当前以 `obj_<cardId>` 为 key，导致 022 结算后 UI 仍按原始 `6 ALL` 预览。
- 修复：`JudgmentPanel` 读取必要 Heart 修正时同时兼容 raw `cardId` 与 public object id。
- 新增 focused 回归：`tests/unit/live-judgment-settlement.test.ts` 覆盖 022 结算后进入判定立即使用减少后的必要无色 Heart。
- 验证：022 focused tests 4 passed；整组 focused tests 11 files passed / 100 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

历史浏览器检查：

- `http://localhost:5173/`
- 页面标题正常
- 控制台错误数为 0

本次 2026-06-13 新测试卡组与卡图资产收口：

- 新增 `assets/decks/系统边界混合.yaml`：48 张成员、12 张 LIVE、12 张能量，混合“现有模块非预组扩样本”和“费用/能量/登场/AUTO 等新系统边界”样例。
- 默认本地测试入口已切为 `系统边界混合` vs `缪预组`，`蓝紫.yaml` 保留为非默认测试资产。
- 新增 `scripts/generate-local-test-card-sources.mjs`，从所有 `assets/decks/*.yaml` / `*.yml` 生成 `client/src/lib/localTestCardSources.generated.ts`。
- `scripts/download-local-test-card-images.mjs` 已实际跑通：三套测试卡组共 79 张唯一卡图，本次新增下载 28 张 PNG，79 张均已生成 `thumb/medium/large` WebP。
- 用户已在 `http://localhost:5173/` 初步测试，反馈测试卡组看起来没有问题。
- 验证：`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!SP-PR-004-PR` / E03 能量放置底座起步：

- 新增 `src/application/effects/energy.ts`，提供 `placeEnergyFromDeckToZone`，用于卡效步骤从能量卡组顶放置能量到能量区，并显式指定放置后的活跃/待机状态。
- `PL!SP-PR-004-PR` 已登记为 `ON_ENTER` 队列能力：可弃 1 手牌；若弃牌成功，则从能量卡组顶放置 1 张待机能量。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量放置 helper；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 PR-004 不发动与发动两条路径。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，104 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」右侧 E02 与来源槽位条件起步：

- `CARD_ABILITY_DEFINITIONS` 新增 `requiredSourceSlots`，`PendingAbilityState` 新增 `sourceSlot`。登场触发从 `PLAY_MEMBER.targetSlot` 记录来源槽位；LIVE 开始触发从舞台槽位收集来源槽位。能力入队前统一检查来源槽位条件，避免在单卡 resolver 里硬写右侧判断。
- `src/application/effects/energy.ts` 扩展 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`，用于卡效步骤把能量区指定卡或前 N 张符合方向条件的能量设为目标方向。
- `PL!SP-bp4-008-P` 已登记右侧登场能力：仅在登场到 `RIGHT` 槽位时入队；确认后将最多 2 张待机能量变为活跃。此批当时仅接右侧 E02；后续批次已接左侧 F02，并已在 S05 批次补完 LIVE 开始站位变换。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量方向 helper；`tests/unit/card-effect-classification.test.ts` 覆盖 `requiredSourceSlots` 注册；`tests/integration/sample-card-effect-runner.test.ts` 覆盖右侧触发与中心不触发。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，108 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧 F02 抽弃起步：

- `PL!SP-bp4-008-P` 新增左侧登场能力：仅在登场到 `LEFT` 槽位时入队；处理时先抽 2 张卡，再选择 1 张手牌放置入休息室。
- 新增 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 抽弃壳，组合 `drawCardsFromMainDeckToHand` 与 `moveHandCardToWaitingRoomForEffect`；当前先覆盖抽 N 后弃 1，后续遇到弃 M 张再扩多选。
- focused tests 新增左侧触发路径，并扩展中心登场不触发左/右任一段。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，109 tests passed，server/client TypeScript passed。

本次 2026-06-13 低风险复用扩样本收口：

- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」已完成两段：登场抽 2 张卡后将 1 张手牌放置入休息室，复用 draw helper + hand discard 壳；LIVE 开始可弃 1 手牌，若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色并通过 `addLiveModifier` 写入 `HEART` modifier。无其他成员时只支付费用并结束。
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」已完成起动：自送休息室，从休息室回收 1 张成员卡。复用 effect-costs 自送 + zone-selection/member selector。
- `PL!-bp4-003-P` 费用 2「南琴梨」已完成起动：自送休息室，从休息室回收 1 张 LIVE 卡。复用 effect-costs 自送 + zone-selection/live selector。
- focused tests 已补 `tests/integration/sample-card-effect-runner.test.ts` 与 `tests/unit/card-effect-classification.test.ts` 覆盖。
- 验证：focused 2 files / 28 tests passed；相关 12 files / 112 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-14 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始段补齐：

- 新增 LIVE 开始能力登记：可弃 1 手牌；若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色，LIVE 结束时为止获得 1 个该颜色 Heart。
- 复用 `createDiscardHandToWaitingRoomActivationEffect`、Heart option active effect 与 `addLiveModifier` 主写入路径；未引入新的 UI 特例。
- 新增 focused 覆盖：有其他成员时弃手后可选 Heart 并写入 `liveModifiers`；无其他成员时只支付费用并结束，不写入 Heart modifier。
- 验证：focused 4 files / 94 tests passed。

本次 2026-06-14 `PL!HS-bp1-004-P` 费用 15「夕雾缀理」两段补齐：

- 起动段登记为 `ACTIVATED` / `STAGE_MEMBER` / 每回合 1 次：支付 3 张活跃能量，从自己的休息室选择 1 张『莲之空』LIVE 卡加入手牌。
- LIVE 开始段登记为 `LIVE_START` / `STAGE_MEMBER`：可支付 1 张活跃能量；LIVE 结束时为止，按自己的 LIVE 区卡牌数量获得 BLADE。
- 复用 `perTurnLimit`、`payImmediateEffectCosts(TAP_ACTIVE_ENERGY)`、`zone-selection`、`groupIs('莲之空')` / `groupIs('蓮ノ空')`、`addLiveModifier`；未新增 UI 特例。
- 新增 focused 覆盖：无合法目标时起动不支付也不占次数；起动支付 3 能量只筛选莲之空 LIVE 并验证每来源卡每回合 1 次；LIVE 开始支付 1 能量后按 LIVE 区 2 张写入 BLADE +2。
- 验证：focused 4 files / 105 tests passed。

本次 2026-06-14 `PL!HS-bp1-010-N` 到 `PL!N-sd1-022-SD` 登场抽1弃1同形批次：

- `src/application/card-effect-runner.ts` 新增 `HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID`，复用既有 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect`；将 `baseCardCodes` 覆盖到 9 个基础编号（`PL!HS-bp1-010` / `PL!HS-bp1-014` / `PL!HS-bp6-020` / `PL!N-bp1-014` / `PL!N-bp1-015` / `PL!N-bp1-019` / `PL!N-sd1-013` / `PL!N-sd1-021` / `PL!N-sd1-022`）。
- `tests/unit/card-effect-classification.test.ts` 增加 9 个基础编号 on-enter 登场抽1弃1能力分类断言，确保各基础编号都可命中新 ability。
- `tests/integration/sample-card-effect-runner.test.ts` 增加 `PL!HS-bp1-010-N` 代表卡 on-enter 抽1弃1落地验证。
- `docs/card-effect-reuse-audit/existing_module_map.md` 更新 `PL!HS-bp1-006` 及其同型批次登记。

本次 2026-06-14 同编号罕度同步与卡效登记册重整：

- `CardAbilityDefinition` 新增 `baseCardCodes`，`getCardAbilityDefinitions` 统一支持 exact `cardCodes` 与基础编号匹配；`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!SP-bp4-008` 费用 13「若菜四季」等已同步同编号多罕度。
- resolver / generic look-top 参数判断 / continuous live modifier registry / cost calculator 已改用基础编号判断；`PL!-bp4-003` 费用 2「南琴梨」的 `P/R` 不再分散为两套起动登记。
- 新增 `tests/unit/card-effect-rarity-sync.test.ts`，从 `llocg_db/json/cards_cn.json` 扫描同基础编号族群，防止后续 exact `cardCodes` 漏同步其他罕度。
- `docs/card-effect-reuse-audit/existing_module_map.md` 已重写为按基础编号的卡效完成状态登记册；模块覆盖拆到 `effect_module_coverage.md`，同构批量扩样本拆到 `card_effect_batch_expansions.md`。
- 当前已验证：`tests/unit/card-code.test.ts`、`tests/unit/card-effect-classification.test.ts`、`tests/unit/card-effect-rarity-sync.test.ts`、`tests/unit/cost-calculator.test.ts`、`tests/unit/stage-member-target-selection.test.ts`、`tests/unit/card-selectors.test.ts`、`tests/integration/member-cost-payment.test.ts`、`tests/integration/sample-card-effect-runner.test.ts` 共 8 files / 163 tests passed。

本次 2026-06-13 低风险同构扩样本收口：

- `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」：登场段已完成，复用 `zone-selection + card-selectors`（从休息室回收 1 张成员入手）；LIVE 开始段已完成，可弃合计 3 张指定姓名手牌并通过 `addLiveModifier(SCORE)` 获得 LIVE 合计分数 +3。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶3选1入手）。
- `PL!-bp3-010-N` 费用 9「高坂穗乃果」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶5公开可选1张 LIVE 入手）。
- `PL!HS-bp2-002-P` 费用 13「村野沙耶香」：登场段已完成，复用 `zone-selection + card-selectors`（休息室最多2张费用≤2成员入手）。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」、`PL!HS-bp2-002-P` 费用 13「村野沙耶香」的未做段：分别为 live-only 段，均明确记录为后续分批。
- focused tests 已补：
  - `tests/integration/sample-card-effect-runner.test.ts`
  - `tests/unit/card-effect-classification.test.ts`
- 验证：`tests/unit/card-effect-classification.test.ts` 与 `tests/integration/sample-card-effect-runner.test.ts` 已通过；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 已通过。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始 S05 站位变换收口：

- 新增 `SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID`，登记为 `LIVE_START` / `STAGE_MEMBER` / `ON_LIVE_START` 队列能力。
- 新增通用 `startMemberPositionChangeEffect` / `finishMemberPositionChangeEffect` 壳，四季 LIVE 开始段使用可选站位变换；不选择槽位时可跳过，选择槽位时复用 `moveMemberBetweenSlots`，支持空槽移动与成员交换。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖四季 LIVE 开始能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 开始触发、可选 slot-selection、从中间移动到右侧并与右侧成员交换。
- 验证：focused 2 files / 33 tests passed；相关完整验证 12 files / 117 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」X11 费用修正底座起步：

- `src/domain/rules/cost-calculator.ts` 新增登场费用修正明细：保留印刷基础费用、修正后费用、修正来源与合计减费，再与换手减免一起生成支付方案。
- `GameSession.preparePlayMemberCostPayment` 现在向 `costCalculator` 传入正在登场的来源卡 ID、当前手牌列表与舞台成员状态，普通登场仍自动扣费；支付说明会显示基础费用、费用减少、换手减免与最终支付。
- `LL-bp2-001-R+` 已完成手牌中的常时费用减少段：此卡以外的其他手牌每有 1 张，登场费用减少 1；此卡本身不计入数量，手牌只有此卡时仍是 20 费，最低可降到 0 费。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中的常时费用减少段：只要自己的舞台存在待机状态的『虹咲』成员，登场费用减少 2；活跃虹咲成员或待机非虹咲成员均不会触发减费。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已完成舞台来源常时费用减少段：手牌中费用 10 的『Liella!』成员登场费用减少 2；换手登场时先应用此费用修正，再计算换手减免。当前本地 `系统边界混合` 测试卡组缺少合适的 10 费 Liella! 目标，先以构造数据 focused tests 固定规则路径。
- 同卡其他段已在 2026-06-14 补齐：`此成员无法因换手放置入休息室` 由费用方案与实际登场 action 层拦截；LIVE 开始可弃任意张指定姓名手牌，并按弃置张数通过 `addLiveModifier(BLADE)` 获得 BLADE。
- focused tests 已补：
  - `tests/unit/cost-calculator.test.ts` 覆盖三人卡不计自身、按其他手牌减费、最低 0 费、与换手减免叠加；艾玛无待机虹咲成员不减费、有待机虹咲成员减 2；千砂都只对 10 费 Liella! 成员减 2，非 10 费或非 Liella! 不误伤，并验证先减费再换手。
  - `tests/integration/member-cost-payment.test.ts` 覆盖真实 `PLAY_MEMBER_TO_SLOT` 路径中三人卡 20 费按 17 张其他手牌降为 3 费并自动扣费；艾玛在舞台待机虹咲成员条件满足时可自动按减后费用登场；千砂都作为目标槽位换手来源时仍能先修正 10 费 Liella! 成员费用再自动扣费。
- 验证：focused cost tests 2 files / 30 tests passed；相关完整验证 14 files / 147 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始段与 `PL!S-bp2-006-P` 费用 11「津岛善子」S07 卡效登场起步：

- `src/application/effects/member-state.ts` 新增批量成员方向 helper `setMembersOrientation`，以及 `playMembersFromWaitingRoomToEmptySlots` 卡效登场原语。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已补完 LIVE 开始段：中心位来源进入 LIVE 开始队列，确认后将自己舞台上全部 Liella! 成员与全部能量变为活跃状态；非 Liella! 成员不受影响。
- `PL!S-bp2-006-P` 费用 11「津岛善子」已完成登场段：可以支付 4 张活跃能量，从休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。
- 当前 S07 边界：卡效登场只进入空槽，不走普通登场费用、不计算换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 S07 移动原语。
- focused tests 已补：
  - `tests/unit/member-state.test.ts` 覆盖批量设置成员方向、从休息室登场到空槽。
  - `tests/unit/card-effect-classification.test.ts` 覆盖千砂都 LIVE 开始与善子登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖千砂都批量活跃 Liella! 成员/能量、善子支付 4 能量后从休息室登场 2 名成员，以及 `PL!-sd1-003-SD` 费用 13「南 ことり」被效果登场后继续触发自己的登场能力。
- 验证：focused 3 files / 41 tests passed；相关完整验证 14 files / 152 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场段收口：

- 新增 `EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID`，登记为 `ON_ENTER` / `PLAYED_MEMBER` / `ON_ENTER_STAGE` 队列能力。
- 登场段先通过 `selectableOptions` 选择“成员”或“能量”分支；进入后续选择步骤时会清空旧选项按钮，避免重复点击旧分支。
- 成员分支选择 1 名待机舞台成员并复用 `setMembersOrientation(..., ACTIVE)`；能量分支不要求玩家选择具体能量卡，而是按能量区顺序自动取至多 2 张待机能量并复用 `setEnergyOrientation(..., ACTIVE)`。普通登场费用、换手与能量支付路径保持不变。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖艾玛登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场后选择待机成员变活跃，以及选择能量分支后自动将由登场支付横置的 2 张能量变活跃。
- 验证：focused 4 files / 47 tests passed；能量分支免手选修正 focused 3 files / 42 tests passed；修正后相关完整验证 14 files / 154 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」AUTO proving 收口：

- 新增 `HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- `enqueueTriggeredCardEffects` 新增 `ON_LEAVE_STAGE` 入队路径；2026-06-15 起优先消费 `eventLog` 中的 `LeaveStageEvent`，仍兼容最近 `PLAY_MEMBER` 替换来源、`MOVE_CARD` 从成员区到休息室来源等旧 action-history 回退。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」解析复用 look-top：检视顶 5，选择成员后先公开，确认后该成员入手，其余检视牌进休息室。
- 待处理效果顺序选择从“同一 timingId”扩为“同一 controller 且同 timingId、共享 eventId，或换手离场 `replacingCardId` 指向新登场成员”。因此当 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」被普通登场换手替换时，其离场 AUTO 与新登场成员的登场能力会进入同一个顺序选择窗口，由玩家选择先后。
- 当前仍不是完整 `GameEvent -> trigger matcher` 层；`S08` 只先覆盖舞台成员进入休息室的 proving 路径。更多移动事件、状态变化、每回合限制、when-if 等 AUTO 边界后续继续扩。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 AUTO 能力登记与队列 metadata。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖从舞台移动到休息室触发 AUTO、公开并入手 1 张成员、其余进休息室，以及被换手替换时与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场能力同窗排序。
- 验证：focused 2 files / 40 tests passed；相关完整验证 14 files / 156 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-bp6-017-N` 费用 11「日野下花帆」AUTO proving 收口：

- 新增 `HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- 继续复用 `ON_LEAVE_STAGE` 离场 AUTO 入队路径；2026-06-15 起主流程优先从 `eventLog` 的 `LeaveStageEvent` 转换离场来源，并兼容 action-history / explicit-source。
- 效果流程复用现有弃手费用与 `WAITING_ROOM -> HAND` 移动原语：离场后可选择 1 张手牌放置入休息室；如此做时，从休息室选择 LIVE 卡和成员卡至多各 1 张加入手牌。来源成员自身已进入休息室，因此也会成为合法成员候选。
- 新增 grouped recovery 校验：多选最多 2 张，但 LIVE 不超过 1 张、成员不超过 1 张；尝试选择两张 LIVE 会被权威层拒绝。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖第二张离场 AUTO 能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖离场触发、跳过弃手、弃手后回收 LIVE/成员各 1 张，以及同类双选被拒绝。
- 验证：focused 2 files / 42 tests passed；相关完整验证 14 files / 158 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO proving 收口：

- 新增 `HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_ENTER_STAGE` 队列能力，`requiredSourceSlots: [CENTER]`，`perTurnLimit: 2`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 现在同时支持登场者自己的 `ON_ENTER` 能力与舞台成员监听登场事件的 AUTO；2026-06-15 起主流程优先消费 `eventLog` / 显式 `EnterStageEvent`，仍兼容最近 `PLAY_MEMBER` action fallback。
- “1回合 N 次”限制改为通用实例级底座：`ABILITY_USE` 按来源卡实例计数；同步修正 `PL!-sd1-008-SD` 费用未登记「小泉 花陽」的旧行为，同一实例本回合第二次会被拒绝，另一张同名实例可以发动。
- 效果段写入 `liveResolution.liveModifiers` 的 `BLADE` modifier：己方「莲之空」成员登场至自己舞台时，来源为中央的此成员获得 BLADE +2。FAQ 覆盖“此成员自己登场到中央也会触发”。
- 同卡第二段登记为 `LIVE_START` / `STAGE_MEMBER` 队列能力：LIVE 开始时统计此成员有效 BLADE，若大于等于 8，则复用 F02 抽 2 弃 1 流程。
- `domain/rules/live-modifiers.ts` 新增 `getMemberEffectiveBladeCount`：以印刷 BLADE 加上同 `playerId + sourceCardId` 的 BLADE modifier 统计成员当前有效 BLADE；非成员或找不到来源时返回 0。
- 新增通用 confirm-only active effect：玩家从顺序选择窗口手动点选无输入 pending ability 时，先显示来源卡、效果文本与“继续处理”按钮；点击后才真正 resolve。`PL!HS-pb1-009-R` 费用 15「日野下花帆」第一段已接入该壳；“顺序发动”仍按队列自动处理，不逐个弹确认。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO 登记、中心位与每回合 2 次限制。
  - `tests/unit/live-modifiers.test.ts` 覆盖成员有效 BLADE 只统计同玩家、同来源成员的 BLADE modifier。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖自己登场触发、非「莲之空」不触发、同一来源实例每回合只触发 2 次、`PL!-sd1-008-SD` 费用未登记「小泉 花陽」同名不同实例可分别发动，LIVE 开始 BLADE 阈值未满足时跳过、满足时抽 2 弃 1，以及手动点选无输入 AUTO 先进入 confirm-only、顺序发动不弹 confirm-only。
- 验证：第一段 focused 2 files / 44 tests passed；第二段 focused 3 files / 49 tests passed；confirm-only 后 focused 3 files / 51 tests passed；相关完整验证 14 files / 165 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `PL!HS-bp6-004-R` 费用 13「百生 吟子」组合效果 proving 收口：

- 新增三条能力登记：
  - 登场段 `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：对方舞台费用小于等于 9 的 1 名成员变为待机状态。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：同一对手低费成员待机效果。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID`：可弃 1 张手牌，LIVE 结束时为止获得 BLADE；若弃置的是姓名归一化后为「百生吟子」的成员卡，则共获得 BLADE +2。
- 顺序选择窗口补通用同源多能力区分：同一窗口若存在重复 `sourceCardId`，不再用卡图 ID 选择，而切到 `selectableOptions` 展示具体效果文本；不同来源卡的普通队列仍保持卡图选择。
- 新增舞台成员目标 helper：按 `playerId + predicate` 扫描成员区槽位，供对手目标/费用筛选复用；实际方向变更继续调用 `member-state.ts` 的 `setMemberOrientation`。
- 该舞台成员目标 helper 已从 runner 下沉到 `src/application/effects/stage-targets.ts`，并改为接收 `card-selectors.ts` 的组合 selector；舞台成员单选并改方向的 active effect 已继续抽为 `src/application/effects/stage-member-target-selection.ts`；弃置「百生吟子」判断也改为复用 `cardNameIs`。
- 弃手加 BLADE 段复用现有可选弃手 active effect 与 `moveHandCardToWaitingRoomForEffect`，并通过 `addLiveModifier` 写入 BLADE modifier。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-bp6-004-R` 费用 13「百生 吟子」三条能力登记。
  - `tests/unit/stage-member-target-selection.test.ts` 覆盖舞台成员目标 active effect 的候选生成、无目标结果与方向结算。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场时只能选择对方费用小于等于 9 的成员、同一张来源卡两条 LIVE 开始能力使用 option 区分、弃置同名「百生吟子」成员获得 BLADE +2。
- 验证：stage member target selection 抽取后 focused 4 files / 58 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」LIVE 卡来源 modifier 扩样本：

- `PL!HS-bp5-019-L` 分数 6「花结」已登记为 LIVE 卡来源的 `LIVE_START` 队列能力：LIVE 开始时按自己的 LIVE 卡区中此卡以外的「莲之空」卡数量，每张使此卡必要绿色 Heart 减少 2 个。
- `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已按基础编号 `PL!HS-bp2-022` 覆盖 `L / L+`：LIVE 开始时若自己的休息室存在大于等于 3 张『Cerise Bouquet』LIVE 卡，则此卡分数 +1。
- 两张卡都复用现有 LIVE 开始队列、confirm active effect 与 `liveModifiers` 主写入路径；`花结` 使用 `replaceLiveModifier(REQUIREMENT)` 写入绿色必要 Heart 修正，`アオクハルカ` 使用带 `liveCardId` 的 `addLiveModifier(SCORE)` 写入“此 Live 卡分数 +1”修正。
- 手测反馈修正：本地导入数据中 `Cerise Bouquet` / `スリーズブーケ` 是 `unitName`，而不是 `groupName`；已为 `card-selectors.ts` 增加 `unitIs`、`unitAliasIs` 与 `unitAliasOrTextAliasIs`，并让 `アオクハルカ` 的休息室 LIVE 计数通过 `unitAliasIs('Cerise Bouquet')` 识别 `unitName=スリーズブーケ`。默认小组条件只看 `unitName`；“此卡视为……”等文本身份保留给显式的 `unitAliasOrTextAliasIs`。
- 判定窗口修正：`SCORE` modifier 现在区分不带 `liveCardId` 的“LIVE 合计分数 +1”和带 `liveCardId` 的“此 Live 卡分数 +1”。`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」的 +1 会同时体现在“Live 卡判定结果”单卡分数与“接受后预计结果”；`PL!-sd1-009-SD` 费用 11「矢泽妮可」这类合计分数修正仍只进入预计结果的“卡牌效果 +1”。
- 新增 focused 覆盖：
  - `tests/unit/card-effect-classification.test.ts` 覆盖两张 LIVE 卡能力登记与 `PL!HS-bp2-022-L+` 半角 `+` 归一化匹配。
  - `tests/unit/card-selectors.test.ts` 覆盖 `unitIs` 对 `unitName=スリーズブーケ` 的小队识别、`unitAliasIs` 的英日别名匹配，以及 `unitAliasOrTextAliasIs` 与纯 `unitAliasIs` 的文本身份边界。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 卡来源入队、确认后写入绿色 `REQUIREMENT` modifier、休息室 3 张 `unitName=スリーズブーケ` LIVE 条件满足后写入 `SCORE` modifier。
- 2026-06-14 追加验证：`tests/unit/live-modifiers.test.ts` 覆盖合计分数与此 Live 卡分数 target 分离；`tests/unit/live-judgment-settlement.test.ts` 覆盖此 Live 卡分数修正不会被合计分数重复计算；`tests/unit/player-view-state.test.ts` 覆盖 `liveCardScoreModifiers` 投影。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-code.test.ts tests/unit/card-selectors.test.ts tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/unit/live-modifiers.test.ts tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts`，7 files / 159 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-pb1-004-R` 费用 4「百生吟子」与 `PL!HS-PR-019-RM` 费用 2「百生吟子」登场效果扩样本：

- `PL!HS-pb1-004-R` 费用 4「百生吟子」已按基础编号 `PL!HS-pb1-004` 覆盖 `R / P+`：登场可支付 1 能量并弃 1 手牌，堆顶 3 入休息室后，从休息室回收 1 张 Cerise Bouquet LIVE。
- `PL!HS-PR-019-RM` 费用 2「百生吟子」已按基础编号 `PL!HS-PR-019` 覆盖 `PR / RM`：登场公开检视卡组顶 3 张，点击继续处理后放置入休息室；若均为持有绿色 Heart 的成员，则 LIVE 结束前获得绿色 Heart；PR/RM 中文措辞不同但实际效果相同。
- 角色名归一化额外加入早期中文误译/异体：`澁谷かのん = 渋谷かのん = 涩谷香音 = 涉谷香音`、`大沢瑠璃乃 = 大泽瑠璃乃 = 大泽琉璃乃`、`セラス柳田リリエンフェルト = セラス 柳田 リリエンフェルト = 赛拉丝柳田利林费尔德 = 赛拉丝·柳田·利林费尔德`。
- 本批已在收束时同步 `existing_module_map.md`、`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档；后续继续维持“每张实时登记、5-10 张或批末统一收束设计文档”的节奏。
- 最终验证：focused suite 12 files / 210 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-bp5-001-SEC` / `PL!HS-bp1-003-SEC` / `PL!HS-bp1-002-RM`：

- `PL!HS-bp5-001-SEC` 费用 11「日野下花帆」已按基础编号 `PL!HS-bp5-001` 覆盖 `AR / P / R+ / SEC`：登场公开检视卡组顶 4 张，点击继续处理后放置入休息室；其中存在 LIVE 卡时，通过 `addLiveModifier(BLADE)` 获得 BLADE +2。起动 `[1回合1次][E][E]` 公开 1 张手牌 LIVE，并从休息室回收 1 张同名 LIVE。
  - 修正：该段不再静默堆墓，已与 `PL!-sd1-007-SD` / `PL!HS-PR-019` 的公开检视 -> 继续处理流程对齐。
  - 起动段：以 bespoke C07 手札公开步骤衔接 `WAITING_ROOM -> HAND`，未抽新公开手牌模块；公开的手牌 LIVE 保留在手牌，休息室候选按公开卡卡名过滤。
  - 投影隐私修正：`activeEffect.selectableCardVisibility = AWAITING_PLAYER_ONLY` 已用于公开手牌、弃手、私有检视区选择等隐藏区候选；投影层同时按候选牌是否正面可见兜底，非等待玩家不再看到隐藏候选区占位数量。已补 `tests/unit/player-view-state.test.ts` 覆盖私有候选、漏标兜底与公开候选三种路径。
  - 公开确认窗口：起动段现在在选择手牌 LIVE 后进入 `HS_BP5_001_REVEAL_HAND_LIVE`，通过 `activeEffect.revealedCardIds` / `revealedObjectIds` 向双方正面展示公开卡，点击“继续处理”后再进入休息室同名 LIVE 选择。
- `PL!HS-bp1-003-SEC` 费用 13「乙宗梢」已按基础编号 `PL!HS-bp1-003` 覆盖 `P / P+ / R+ / SEC`：起动 `[1回合1次][E]` 从休息室回收 1 张费用小于等于 4 的「莲之空」成员；常时三面均有不同名「莲之空」成员时，LIVE 合计分数 +1。常时段由 `collectLiveModifiers` 动态收集为不带 `liveCardId` 的 `SCORE` modifier，判定窗口已改为通用投影玩家 LIVE 合计分数修正。
- `PL!HS-bp1-002-RM` 费用 11「村野沙耶香」已按基础编号 `PL!HS-bp1-002` 覆盖 `P / R / RM`：支付 2 能量并自送，从休息室将 1 张费用小于等于 15 的「莲之空」成员登场至原区域；`P/R` 的“所在的区域”与 `RM` 的“曾存在的区域”当前按等价规则行为同步。此段复用 `TAP_ACTIVE_ENERGY`、`SEND_SOURCE_MEMBER_TO_WAITING_ROOM` 与 `playMembersFromWaitingRoomToEmptySlots`，并继续触发被登场成员的登场能力。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：`PL!HS-bp5-001` 公开检视窗口修正后复跑 focused 3 files / 109 tests passed；相关模块套件 13 files / 202 tests passed；server TypeScript passed；`git diff --check` passed。起动段追加后已复跑 focused 3 files / 110 tests passed；相关模块套件 13 files / 203 tests passed；server TypeScript passed；`git diff --check` passed。
隐私投影修正后已复跑 `tests/unit/player-view-state.test.ts` 20 tests passed；相关模块套件 14 files / 223 tests passed；server TypeScript passed；client TypeScript passed；`git diff --check` passed。
公开确认窗口追加后已复跑 focused 4 files / 131 tests passed；相关模块套件 14 files / 224 tests passed；server TypeScript passed；client TypeScript passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-sd1-001-SD` / `PL!HS-pb1-020-N`：

- `PL!HS-sd1-001-SD` 费用 9「日野下花帆」已完成离场 AUTO：此成员被费用大于等于 10 的「莲之空」成员换手放置入休息室时，将 2 张能量变为活跃。
  - 为 relay 来源条件补了薄元数据：`OnLeaveStageAbilitySource.replacingCardId` 与 `PendingAbilityState.metadata.replacingCardId`，从 `PLAY_MEMBER` 的 `isRelay/replacedCardId/cardId` 记录判断换上成员。
  - 入队阶段先校验换上成员为成员卡、莲之空、费用 >= 10，普通离场或低费换手不会排入该能力。
  - 交互优化：当含登场效果的费用 >= 10「莲之空」成员换手登场并与此离场 AUTO 同时进入顺序选择窗口时，手动点选 `PL!HS-sd1-001-SD` 会先进入 confirm-only 无输入确认壳，点击“继续处理”后才活跃能量并继续处理登场效果；点“顺序发动”时仍自动连续处理，不弹确认壳。
- `PL!HS-pb1-020-N` 费用 9「百生吟子」已完成登场段：自己的休息室 LIVE >= 3 时，可弃 2 手牌；如此做时从休息室回收 1 张 Cerise Bouquet 成员与 1 张「莲之空」LIVE。
  - 复用 `paySelectedDiscardHandCost` 与 `WAITING_ROOM -> HAND`，弃 2 手牌候选对非等待玩家隐藏。
  - 休息室回收使用 `ORDERED_MULTI` 分组校验，两个分组都有目标时必须各选 1；若某分组无目标，则按可用分组数继续。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因 relay 来源元数据扩展，已同步 `docs/card-effect-framework/card_effect_framework_design.md` 的 Stage 1O 短记录。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：focused 2 files / 111 tests passed；server TypeScript passed。confirm-only 优化后追加复跑 `tests/integration/sample-card-effect-runner.test.ts -t "PL!HS-sd1-001"`：3 passed / 106 skipped；server TypeScript passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-bp6-001-R＋` / `PL!HS-cl1-009-CL`：

- `PL!HS-bp6-001-R＋` 费用 4「日野下花帆」已按基础编号 `PL!HS-bp6-001` 覆盖 `P / P+ / R+ / SEC`，本地卡库全角 `R＋` 通过 card-code normalize 命中：
  - 登场段：结算时按己方舞台成员数 + 2 动态检视卡组顶，选择 1 张放回卡组顶，其余放置入休息室。复用 `startArrangeInspectedDeckTopEffect` ordered workflow。
  - LIVE 成功段：若自己的 LIVE 成功，可从因声援公开且仍在处理区的自己的卡中选择 1 张放回卡组顶；该段是首个舞台成员来源 `LIVE_SUCCESS` 样例。
- `PL!HS-cl1-009-CL` 分数 1「水彩世界」已完成 LIVE 成功段：从因声援公开且仍在处理区的自己的卡中，将 1 张费用 4-9 的成员卡加入手牌。
- 新增可复用底座：`src/application/effects/cheer-selection.ts` 用 `liveResolution.first/secondPlayerCheerCardIds + resolutionZone.revealedCardIds` 选取“本次声援公开卡”，再按卡效配置移动到手牌或卡组顶；后续 DOLLCHESTRA 成员入手、莲之空 LIVE 入手、任意声援卡回顶等可以复用同一 helper。
- 事件边界更新：`enqueueLiveSuccessCardEffects` 现在在存在成功 LIVE 时同时扫描成功 LIVE 卡来源与表演玩家舞台成员来源。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因新增声援公开卡 helper 与 LIVE_SUCCESS 舞台成员来源边界，已同步 `docs/card-effect-framework/card_effect_framework_design.md` 与 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：focused 2 files / 116 tests passed；server TypeScript passed。

本批 2026-06-14 莲之空卡效批末收束：

- 收束范围：`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」，以及 `PL!HS-bp2-022` 分数 2「アオクハルカ」此 Live 卡分数投影修正。
- 文档收束：保持 `docs/card-effect-reuse-audit/existing_module_map.md` 为主登记册；同步整理 `AGENTS.md`、`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md`。未重写无关表格，只补本批新增边界：公开手牌隐私/确认窗口、continuous SCORE、此 Live 卡分数 vs LIVE 合计分数投影、relay `replacingCardId`、分组回收、动态控顶、LIVE 成功舞台成员来源与 `effects/cheer-selection.ts`。
- 后续更新：`PL!HS-bp6-027-L` 分数 5「月夜見海月」已在 2026-06-15 完成追加声援边界；重做声援继续等待后续真实样例。
- 最终验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts tests/unit/live-modifiers.test.ts tests/unit/player-view-state.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
git diff --check
```

结果：focused 5 files / 168 tests passed；server TypeScript passed；client TypeScript passed；`git diff --check` passed。

本次 2026-06-14 快速卡效批处理：`PL!-bp4-010-N` 费用 15「高坂穗乃果」：

- `PL!-bp4-010-N` 费用 15「高坂穗乃果」已完成 LIVE 开始段：可以支付 1 张活跃能量；LIVE 结束时为止获得 BLADE +2。
- 实现复用 `TAP_ACTIVE_ENERGY` 支付与 `addLiveModifier(BLADE)` 主写入路径；`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」与该卡共享固定 BLADE 支付结算 helper，未新增事件边界或设计文档变更。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-rarity-sync.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
git diff --check
```

结果：focused 2 files / 117 tests passed；rarity sync 1 test passed；server/client TypeScript passed；`git diff --check` passed。

本次 2026-06-14 三张 partial 卡效补齐：

- `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」已补齐 LIVE 开始段：可以弃合计 3 张指定姓名手牌，LIVE 结束时为止 LIVE 合计分数 +3。候选使用 `cardNameAliasIs`，组合名卡本身可作为费用候选；结算复用 `paySelectedDiscardHandCost` 与 `addLiveModifier(SCORE)`。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已补齐剩余两段：此成员无法因换手放置入休息室；LIVE 开始可弃任意张指定姓名手牌，并按弃置张数获得 BLADE。换手禁止在 `cost-calculator.ts` 的支付方案与 `play-member.handler.ts` 的实际登场动作双重拦截；LIVE 开始段复用同一指定姓名手牌弃置流程与 `addLiveModifier(BLADE)`。
- `PL!N-pb1-004-P+ / R` 费用 11「朝香果林」已补齐 catalog 常时段：此回合中此成员未进行成员区位置移动时，通过 continuous modifier registry 获得 BLADE +2。规则口径为登场不算移动；站位变换、普通成员区移动与交换会写入 `positionMovedThisTurn`。
- 文档同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`、`docs/card-effect-framework/card_effect_framework_design.md`、`docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`、`docs/card-effect-reuse-audit/effect_module_coverage.md`、`docs/card-effect-reuse-audit/module_gap_list.md` 与 `docs/card-effect-reuse-audit/safe_refactor_plan.md`。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts`
  - `tests/integration/sample-card-effect-runner.test.ts`
  - `tests/unit/cost-calculator.test.ts`
  - `tests/integration/member-cost-payment.test.ts`
  - `tests/unit/live-modifiers.test.ts`
  - `tests/unit/member-state.test.ts`
  - `tests/unit/member-slot-swap.test.ts`
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/cost-calculator.test.ts tests/integration/member-cost-payment.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/member-slot-swap.test.ts`，7 files / 168 tests passed。

## 下一步建议

本次 2026-06-14 快速卡效批处理：`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」：

- 新增 `HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID`，登记为 LIVE 卡来源的 `LIVE_START` / `ON_LIVE_START` 队列能力，按基础编号 `PL!HS-bp6-031` 覆盖当前 `L`。
- 结算流程：玩家可选择是否发动；发动时将自己休息室全部成员卡洗牌后放到主卡组底，非成员等待室卡保留。若因此放到底部的 `みらくらぱーく！` 成员大于等于 15 张，则选择自己舞台 1 名「安养寺姬芽」并通过 `BLADE` live modifier 获得 BLADE +3。
- 复用范围：LIVE 开始队列、`shuffleZone`、`unitAliasIs('みらくらぱーく！')`、`cardNameAliasIs('安養寺姫芽')` 与 `addLiveModifier`；本段未新增 resolver / cost calculator / live modifier registry 结构。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖 LIVE 卡来源登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 15 张以上时选姬芽加 BLADE、不足 15 张时只洗回且不加 BLADE。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。

本次 2026-06-15 快速卡效批处理：`PL!HS-bp6-027-L` 分数 5「月夜見海月」：

- 已完成 `ON_CHEER` 自动能力：自己进行声援时，可将至多 3 张因声援公开且仍在处理区的自己的无 BLADE HEART「莲之空」卡放置入休息室；如此做时追加等量声援。
- 后续事件层更新：自动/手动/追加声援现在都会写入 `CheerEvent`；`enqueueTriggeredCardEffects(ON_CHEER)` 优先消费 eventLog 中最新非追加 `CheerEvent`，保留旧 LIVE 区推导 fallback。追加声援仍写事件用于审计，但 `additional=true` 不再二次触发 `ON_CHEER`。
- 新增/扩展底座：
  - `src/application/effects/cheer.ts`：抽出声援公开到解决区、登记 `liveResolution.*CheerCardIds`、写入 `CheerEvent` 与即时 refresh 检查的共享 helper。
  - `src/application/effects/cheer-selection.ts`：声援公开卡移动目的地新增 `WAITING_ROOM`。
  - `card-effect-runner` 新增 `ON_CHEER` 入队，当前优先消费 `CheerEvent`，旧扫描表演玩家 LIVE 区来源只作 fallback；追加声援不二次触发 `ON_CHEER`。
  - 声援公开卡选择支持 `ORDERED_MULTI` 多选配置，本卡使用 `selectMin=0/selectMax=3`。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖 `AUTO / LIVE_CARD / ON_CHEER` 登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖排除持有 BLADE HEART 与非莲之空公开卡、移动入休息室、追加等量声援。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因新增 `ON_CHEER` 事件边界、声援 helper 与追加声援，已同步 `card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`module_gap_list.md` 与 `safe_refactor_plan.md`。

`绿莲-6弹ver.yaml` 第一批最后一张 `PL!HS-bp6-027-L` 已完成；本批后续按用户确认再进入批末提交/摘要收束。

本次 2026-06-14 低风险同构扩样本（与 `PL!-sd1-002-SD` 对齐）已完成 17 张卡：

- `PL!-pb1-025-N` 费用 2「東條 希」
- `PL!HS-PR-014-PR` 费用 2「日野下花帆」
- `PL!HS-pb1-019-N` 费用 2「大沢 瑠璃乃」
- `PL!HS-sd1-015-SD` 费用 2「セラス 柳田 リリエンフェルト」
- `PL!N-bp4-017-N` 费用 2「宮下 愛」
- `PL!N-bp4-020-N` 费用 2「エマ・ヴェルデ」
- `PL!N-sd1-006-SD` 费用 2「近江 彼方」
- `PL!S-PR-025-PR` 费用 2「高海 千歌」
- `PL!S-PR-027-PR` 费用 2「松浦 果南」
- `PL!S-bp2-016-N` 费用 2「国木田 花丸」
- `PL!S-bp6-014-N` 费用 2「渡辺 曜」
- `PL!S-sd1-008-SD` 费用 2「小原 鞠莉」
- `PL!SP-bp4-015-N` 费用 2「平安名 すみれ」
- `PL!SP-bp4-019-N` 费用 2「若菜 四季」
- `PL!SP-pb1-021-N` 费用 2「ウィーン・マルガレーテ」
- `PL!SP-sd2-014-SD2` 费用 2「嵐 千砂都」
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」

- 已同步文档：`docs/card-effect-reuse-audit/existing_module_map.md`（`PL!-pb1-019-N` 同型批次 17 卡）、`docs/card-effect-reuse-audit/module_gap_list.md`（`F07,F08,F09` 闭环更新为 35 张同型）与 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。
- 本次焦点验证通过：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b`。

优先级 1：基于 `系统边界混合` 测试卡组开始实现新效果，优先打开新系统边界，同时保留少量现有模块扩样本。

推荐下一批 proving cards：

- `PL!HS-bp6-004-R` 费用 13「百生 吟子」已完成登场/LIVE 开始对手低费成员待机、LIVE 开始可弃手加 BLADE、同源双 LIVE 开始顺序选择区分，并已抽出舞台成员目标选择 active effect 配置入口。下一批建议继续真实 AUTO / LIVE 开始 proving set，优先选择能推进 when-if、名称/费用 selector 配置化或更多状态事件的卡；若先做低风险复用验证，可找第二张“选择自己/对方舞台成员并改变状态”的同型卡接 `stage-member-target-selection.ts`。
- `PL!S-bp2-006-P` 费用 11「津岛善子」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」当前目标段已完成，后续保留为 S07/S02/E02/X11 回归样例。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」费用减少与登场二选一活跃段已完成，后续保留为 X11/X03/S02/E02 回归样例。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」与 `PL!SP-PR-004-PR` 费用 4「唐 可可」当前已完成目标段，后续保留为 F02/E02/E03/S05 回归样例。
- `PL!HS-bp1-004-P` 费用 15「夕雾缀理」已完成起动支付能量回收莲之空 LIVE 与 LIVE 开始支付能量按 LIVE 区数量得 BLADE，后续保留为 C03/F08/B01 回归样例。
- `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已完成 LIVE 卡来源的 LIVE 开始必要 Heart / 此 Live 卡分数 modifier，后续保留为 B07/B06 回归样例。

优先级 1.5：旧建议中的非 `PL!-sd1` 低风险扩样本中，`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」、`PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」已收口完成登场段；下一个推荐是 `PL!HS-PR-002-PR` 费用 10「村野さやか」。

- `PL!HS-PR-002-PR` 费用 10「村野さやか」：登场看顶3选1，优先作为同构下一步。

优先级 1.5：继续减少 runner inline orchestration，但不要做大型 resolver DSL。

- `PL!-sd1-006-SD` 的公开手牌 + 成功区交换仍 inline，等需要 C07/交换效果时再抽。
- 003 / `PL!HS-bp1-006-P` 费用 11「藤岛 慈」Heart 颜色选择仍是专用步骤；已有第二张 Heart 样例，下一张选择颜色/模式卡出现时可抽 generic option-choice。
- 009/022/001 的条件/倍率仍在 resolver，等非预组样例重复后再抽 condition AST。
- F12、抽牌刷新语义继续等待真实样例；F02 当前已有登场抽弃与 BLADE 阈值 LIVE 开始抽弃样例；`PL!HS-bp1-006-P` 费用 11「藤岛 慈」已补齐 LIVE 开始弃手后按条件选择 Heart 的 B03 扩样本。

优先级 2：Step 12 / Stage 1G 自动能力框架已最小起步。

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已证明 `ON_LEAVE_STAGE` 入队、look-top 解析与同事件顺序选择；`PL!HS-bp6-017-N` 费用 11「日野下花帆」已证明同一离场 AUTO 底座可接弃手后分组回收；`PL!HS-pb1-009-R` 费用 15「日野下花帆」已证明 `ON_ENTER_STAGE` 可被舞台成员监听并接实例级每回合限制，且 LIVE 开始段可复用成员有效 BLADE helper 与 F02 抽弃流程。
- 保留 AUTO 待办：后续继续推进标准 `GameEvent`、trigger matcher、when-if 与更广泛移动/状态事件，并用真实自动能力样例验证。

优先级 3：继续完善 LIVE 自动判定。

- 保持“系统预判 + 玩家确认/修正”的当前策略。
- 所有加棒、加心、加分、必要 Heart 增减都应进入统一预判。
- 后续卡效覆盖足够后，再考虑取消人工确认。

优先级 4：继续补测试。

- LIVE 开始多效果顺序对结果的影响。
- LIVE 成功时效果只在成功后触发。
- 起动次数限制跨回合重置。
- 必要 Heart 增加/减少同时存在时的合并。
- 效果处理中撤销的边界。

优先级 5：费用修正器后续扩展。

费用修正器已由 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」起步。后续同类卡继续扩展 `cost-calculator.ts` 的 cost modifier 条件与来源，不要写 UI 层特例。

## 已知注意点

- 子模块 `llocg_db` 里可能有本地未跟踪 `.DS_Store`，不要提交。
- 旧日期进度文档只作为 git 历史中的施工日志保留；新窗口应以本文件为当前事实。
- 本地测试端口目前按 `5173` 使用；如果页面没热更新，先确认实际 Vite 端口。
