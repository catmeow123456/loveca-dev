---
name: loveca-card-effect-governance
description: Use for Loveca battle card-effect architecture review and new card-effect development governance. 适用于 Loveca 卡效总审查、新卡效候选审查、执行窗口提示词、卡效开发规范、卡效提交说明生成、runner 回流检查、helper/workflow/query 复用与晋升审查、只读审查窗口、focused validation、文档诚实性检查。
---

# Loveca Card Effect Governance

本 skill 是 Loveca Battle 卡效开发和审查的入口流程。它不替代仓库文档；它负责让 Codex 进入正确工作姿势，并把细节指向当前代码和权威文档。

## 工作模式

- 默认从当前仓库根目录运行；若用户给出仓库路径，先进入该路径再执行校准。
- 默认身份是“项目作者兼卡效框架规范审查者”：先审查架构和复用路径，不默认直接实现。
- 默认只读，不 stage、不 commit、不 push；只有用户明确要求实现、修正、提交或推送时才切换模式。
- 如需联网、`fetch`、`pull`、`rebase` 或安装依赖，先征求用户确认。
- 不主动处理、清理、纳入 `llocg_db`、`assets/card/`、`assets/images/`、`trigger`。
- 遇到已有脏工作树时，保留用户改动；只在明确授权的范围内新增或修改文件。

## 启动校准

任何卡效总审查、新卡效批次审查或架构把关窗口开始前，先执行并在结论中体现：

```bash
git status --short --branch
git log --oneline -8
wc -l src/application/card-effect-runner.ts
```

审查执行窗口结果时，还必须检查：

```bash
git diff -- src/application/card-effect-runner.ts
```

不要只凭 runner 行数或“只增加必要胶水”的描述判断；必须看 diff 性质。

如用户指定从某个 commit、分支或 PR 开始审查，先用本地 git 信息确认真实范围；不要凭提示词假设。

## 权威顺序

- 判断当前阶段时，以真实代码、当前 diff、`docs/card-effect-framework/migration_roadmap.md` 为准。
- `docs/card-effect-framework/README.md` 是入口，但 `Current Goal` 可能滞后；不要单独把它当最终状态。
- 本地卡文以 `llocg_db/json/cards.json` 为主要事实来源；`cards_cn.json` 可做翻译或漂移参照。
- `docs/card-data-sync/sources/loveca_*.xlsx` 是本地私有同步源，可能比 `cards.json` 更新。若新卡在 `cards.json` 缺失、卡文明显滞后，或用户明确说 Excel 已有，应读取最新 Excel 作为兜底事实来源，并在结论中说明来源。
- 规则实现以日文卡文为准：优先 `cards.json` 的日文 `ability`，兜底用 Excel 的 `多行日文效果`。前台展示文本优先使用 Excel 的 `多行中文效果`。
- 卡牌完成状态优先查 `docs/card-effect-reuse-audit/existing_module_map.md`，再查 `ability-ids.ts`、`definitions/index.ts` 和最近 workflow/test。

## 本地环境与卡文读取注意事项

- 本机 shell 里 `node` 可能不在 `PATH`；需要脚本化读取 JSON 时，优先使用 Codex bundled Node 或把其 `bin` 目录临时加入 `PATH`。这只是本地只读解析，不代表要下载、安装或修改依赖。
- `llocg_db/json/cards.json` 当前是以 `card_no` 为 key 的对象，不是数组；不要直接 `data.filter(...)`。按 exact `card_no`、base card code、`rare_list` 做结构化查询比裸 `rg` 更可靠。
- 卡号和稀有度存在全角符号差异，例如 `R＋`、`P＋`，不能把 ASCII `R+` / `P+` 查不到误判为缺卡。遇到未命中时，先按 base card code 和 DB 里的真实 `rare_list` 复核。
- `cards.json` 里同一卡号可能在 FAQ relation、rare_list 等字段重复出现；抽取真实卡文时应读取顶层卡牌对象的 `cost`、`score`、`name`、`ability` 等字段，并在输出中列基础编号、费用/分数、卡名和原文。
- Excel 兜底优先读取最新 `docs/card-data-sync/sources/loveca_YYYYMMDDHHMMSS.xlsx`；关键列为 `カード番号`、`カード名`、`卡牌中文名`、`多行日文效果`、`多行中文效果`、`真实团体`、`真实小队`。这是私有/gitignored 输入，不要为同步它而 stage 文件或改 submodule。
- 读取 Excel 时按 exact card number 匹配，再按 base card code 聚合同文 rarity；不要只凭中文译名或裸文本搜索判断是否同卡。

## 必读路线

总审查或架构把关窗口读：

1. `AGENTS.md`
2. `docs/card-effect-framework/README.md`
3. `docs/card-effect-framework/target_architecture.md`
4. `docs/card-effect-framework/module_boundaries.md`
5. `docs/card-effect-framework/new_card_effect_cookbook.md`
6. `docs/card-effect-framework/runtime_action_helpers.md`
7. `docs/card-effect-framework/active_effect_runtime.md`
8. `docs/card-effect-framework/workflow_module_guide.md`
9. `docs/card-effect-framework/migration_roadmap.md`
10. `docs/card-effect-framework/trigger_matcher_plan.md`
11. `docs/card-effect-framework/steps_lite_plan.md`
12. `docs/card-effect-framework/steps_promotion_queue.md`
13. `docs/card-effect-reuse-audit/existing_module_map.md`
14. `docs/card-effect-reuse-audit/effect_module_coverage.md`
15. `docs/card-effect-reuse-audit/module_gap_list.md`
16. `docs/card-effect-reuse-audit/condition_query_remaining_inventory.md`

普通新卡效开发可先读精简集合：`AGENTS.md`、`README.md`、`new_card_effect_cookbook.md`、`module_boundaries.md`、`runtime_action_helpers.md`、`active_effect_runtime.md`、`workflow_module_guide.md`、`existing_module_map.md`，再按效果形状补读最近代码和测试。

凡新增或修改 `activeEffect` 的按钮、选项、步骤提示或选择说明，必须同时阅读 [`references/player-visible-action-copy.md`](references/player-visible-action-copy.md)，并先搜索同类既有 workflow 的稳定文案。

## 只读开发工具

从仓库根目录使用 bundled/local Node 运行以下脚本；脚本只读取当前 checkout，不 stage、不 commit、不修改卡牌数据：

```bash
# AST + registry 玩家文案审计；加 --list-energy 可列出所有含“能量”或 [E] 的候选文本
node --import tsx .agents/skills/loveca-card-effect-governance/scripts/audit-player-visible-copy.ts

# 按基础编号、完整卡号或前缀盘点 DB、definition、ownership、runner 与 existing_module_map
node --import tsx .agents/skills/loveca-card-effect-governance/scripts/inventory-card-effect-batch.ts PL!SP-pb1 --ability-only

# 从当前前端卡牌 API 的 card_text 生成提交说明骨架；同文卡自动合并一行
node --import tsx .agents/skills/loveca-card-effect-governance/scripts/draft-card-effect-commit-message.ts PL!SP-pb1-002 PL!SP-pb1-004 --title "feat(effect): 更新星团SP-pb1卡效"
```

- 批次盘点可加 `--unimplemented-only` 筛未实现卡，或加 `--json` 输出结构化结果；不要用脚本输出替代人工复用、FAQ 和规则语义审查。
- 用户要求起草 Loveca 卡效提交说明时，必须先运行 `draft-card-effect-commit-message.ts`，不得只凭实现汇报或人工转抄卡文。脚本逐卡读取当前前端公开 `/api/cards/:code`，按前端相同规则使用 `card_text_cn ?? card_text_jp`；同一基础编号的罕度版本先合并，多个基础编号仅在标准化换行并去除首尾空白后卡文仍完全相同时合并为一行，不做语义、标点或 token 近似合并。默认读取生产同源 API；本地或其他环境可通过 `LOVECA_CARD_API_BASE_URL` 或 `--api-base-url` 覆盖。
- 提交说明脚本是只读联网工具；运行环境没有网络权限时应先申请只读访问，或将 `--api-base-url` 指向可信的当前本地 API。API 不可用时直接报告阻塞，不得回退到已停止更新的 `cards_cn.json`。
- 若同一基础编号的不同罕度在前端 API 中存在不同展示卡文，或没有可用 `card_text_cn` / `card_text_jp`，脚本必须报错并停止，不能静默回退到 definition `effectText`、`cards_cn.json` 或人工翻译。
- 提交说明脚本只生成 `新增卡效` 的事实行与其余章节占位；必须逐行对照脚本输出，按真实 diff 人工补充 `修复bug`、`通用更新` 和验证结果，并在用户确认前保持不提交。

## 当前框架立场

- `card-effect-runner.ts` 去中心化的主要迁移已经完成，完整卡效 fallback 不应回流。
- runner 可保留 workflow handler import/register、pending/activeEffect 生命周期入口、trigger/activated 调度入口、`enqueueTriggeredCardEffects` 及尚未迁出的 trigger/relay/matcher 胶水。
- 新卡效不应把完整流程写回 runner。按当前模式需要在 runner 做薄注册可以接受，但 diff 应限于 import/register/极薄 dispatch。
- runner 中不应出现新卡专属的长段 gate、predicate、pending 构造、observer 主体或结算逻辑。resolved-ability observer 也必须通过 workflow/runtime registry 注册；runner 只允许调用通用 hook。
- trigger matcher 仍是纯 matcher；除非用户明确开启 T-2，不接 runner、不替换生产 enqueue 路径、不改变 pending 创建。
- steps-lite 只用于真实重复 workflow family 稳定后的 typed builder，不做完整 DSL 或解释器。

## 新卡效开发流程

1. 确认卡牌范围：来自用户列表、commit message、diff 或 registry 时，都要反查 `definitions/index.ts`、`ability-ids.ts`、`existing_module_map.md` 并按 base card code 去重。
2. 核对真实卡文：从 `llocg_db/json/cards.json` 读取日文原始卡文；若缺失或疑似滞后，读取最新 `docs/card-data-sync/sources/loveca_*.xlsx` 兜底，并报告采用了哪个来源。必要时用 `cards_cn.json` 检查翻译漂移。
3. 先审查复用路径，再写代码：优先复用已有 query、selector、runtime helper、event wrapper、activeEffect shell、shared workflow。
4. 只有没有稳定 family 时，才写 `src/application/card-effects/workflows/cards/<card>.ts` 单卡 workflow。
5. 单卡 workflow 可以存在，但要复用稳定底层动作，不复制裸事件入队、抽弃、activeEffect 构造、成员移动、状态变化等胶水。
6. 新增 helper/shared workflow 必须说明真实卡样本、稳定参数轴、不纳入的差异和测试覆盖。

## Workflow 文件命名与目录归属

- `src/application/card-effects/workflows/cards/` 只放“卡牌维度”的 workflow 文件。文件名必须体现基础编号 + 卡名英文字符/罗马字 slug，不用效果描述、批次名或作者临时命名。
  - 基础编号取去掉稀有度后的 base card code，统一小写 kebab，并保留系列前缀，例如 `PL!-bp6-003` -> `pl-bp6-003`，`PL!N-bp3-030` -> `n-bp3-030`，`PL!SP-pr-018` -> `sp-pr-018`。
  - 卡名部分使用英文字符或罗马字，按 lower-kebab 写入文件名，例如 `pl-bp6-020-dancing-stars-on-me.ts`、`n-bp3-030-love-u-my-friends.ts`、`sp-pr-018-kanon.ts`。
  - 同基础编号、同文不同 rarity 可共用同一个 `cards/<base>-<name>.ts`，并通过 definition 的 `baseCardCodes` / rarity 覆盖表达；不要为每个 rarity 拆文件。
- `cards/` 文件原则上只承载该基础编号/同文 rarity 的卡效。若一个文件开始服务多个基础编号，即使它们来自同一执行批次，也不能继续留在 `cards/` 下，除非其中一个基础编号只是同文/同 base 的覆盖。
- 多基础编号的同型家族必须迁入 `src/application/card-effects/workflows/shared/`，并以可复用行为命名，而不是卡号或卡名命名。示例形态：`moved-side-blade.ts`、`live-start-score-bonuses.ts`、`discard-cost-recover-live-or-gain-blade.ts`、`aqours-live-start-effects.ts`。
- 从单卡 workflow 扩展出第二个真实样本时，必须重新判断：
  1. 该 workflow 是否已经成为稳定 family，若是，先迁入 `workflows/shared/` 再扩配置；
  2. 若只是同批实现但规则流程无关，应拆成多个 `cards/<base>-<name>.ts`；
  3. 若只有局部动作重复，应抽 helper/query/event wrapper，而不是把多个基础编号塞进同一个 `cards/` 文件。
- 测试文件名也要跟随 ownership：
  - 单卡 focused test 优先使用对应 `cards/<base>-<name>.test.ts`；
  - shared family test 优先使用 `shared` workflow 的行为名；
  - 若历史测试确实同时覆盖两张无直接规则关系的卡，文件名要明确组合范围或后续拆分计划，不保留批次名/旧临时名造成误导。
- 重命名 workflow 时必须同步更新 runner/import、workflow 内部 import、`definitions/index.ts` note、`existing_module_map.md` 和相关测试路径；提交前用 `rg` 确认旧路径没有残留。

## Queued LIVE pending / manual confirmation

- 对 `TriggerCondition.ON_LIVE_START`、`TriggerCondition.ON_LIVE_SUCCESS` 等 queued pending ability，先区分“真实交互效果”和“无交互结算效果”。
- 无交互效果包括：starter/resolver 直接删除 pending、写 modifier、移动、抽牌、加状态、`addAction RESOLVE_ABILITY`、`continuePendingCardEffects` 等，不需要玩家选择、支付或确认规则分支的效果。
- 无交互 queued pending 的统一语义：
  - 单个 `LIVE开始` / `LIVE成功` pending：默认先开 confirm-only `activeEffect` 展示将要结算的效果，确认后再结算。
  - 多个 pending 点“顺序发动”：只有剩余候选仍全部属于玩家本次确认的同一 ordered batch 时，才按顺序自动结算且不逐个开 confirm-only；任一能力结算中新产生 pending 后必须停止旧 batch 的自动续跑并重新开放排序。
  - 多个 pending 中用户手动点选某一个无交互效果：只在此时先开 confirm-only pending bridge，让玩家知道点到了哪个效果；确认后再用 `skipManualConfirmation` 回到真实 resolver。
- 已有真实交互窗口的效果不要额外套 confirm-only，例如选择卡、弃手、支付费用、选择颜色、可选发动、查看、揭示、排序等 `activeEffect` workflow。
- 新增或迁移无交互 queued pending 时，优先复用 `manualConfirmation` / `confirmBeforeResolution` / `skipManualConfirmation` 语义，或使用薄包装 helper；不要把卡牌专属条件、modifier、费用、区域移动、抽牌等结算逻辑放入 runner 或通用 helper。
- legacy always-confirm-only workflow 不应作为新实现模板；如果语义上无交互，应迁移为自动 resolver + 手动队列点选时的 confirm-only bridge。
- 需要动态展示文本的 confirm-only bridge，应在 manual confirmation 分支实时计算 `effectText` / `stepText`，避免展示过期条件。
- 无交互且有条件触发、条件分支或动态计数影响结算结果的 `LIVE开始` / `LIVE成功` 效果，必须在 confirm-only 展示的 `effectText` 后追加实时条件说明，例如当前计数、关键布尔条件、满足/未满足以及实际结算结果。若评估后决定不追加，必须在审查结论、执行窗口提示词或收尾说明中明确写出原因；不要默默省略。

## 统一检查时点与动态待机池

- 自动能力满足诱发条件后只进入待机状态；当前能力必须完整结算，不能在效果步骤中间直接调用新能力 resolver 或插入另一个 activeEffect。
- 当前能力结算完成后必须回到同一个检查时点，先执行规则处理，再收集本次新事件产生的触发，并从实时 pending 池重新生成玩家候选。`timingId` 是触发事件事实，不是队列批次边界；不得按 `LIVE_START`、`LIVE_SUCCESS`、初始 pending 快照或阶段专属数组隔离新旧能力。
- 主动玩家从自己当前全部待机自动能力中选择 1 个完整处理；每个能力完成后重新回到规则处理。主动玩家待机能力为空后才处理非主动玩家；非主动玩家能力结算中新产生主动玩家能力时，重新进入规则处理后再次按主动玩家优先检查。
- workflow 只通过统一 continuation 返回调度器，不得维护私有 pending 队列、复制固定候选列表、直接启动“原队列下一项”或在阶段结束时才批量 flush 新触发能力。
- `orderedResolution` 只是玩家对当次候选池的便捷排序承诺。只有剩余候选全部携带同一个 ordered batch token 时才能自动续跑；新入队能力没有该 token，必须与旧 pending 一起重新开放选择。
- 检查时点必须持续到规则处理、主动玩家 pending、非主动玩家 pending、activeEffect、pendingChoice 与 pendingCostPayment 都为空；循环保护必须显式报错或保留可诊断状态，不得静默丢弃未处理能力。

## 玩家可见确认文案

- 按钮与操作文本的分类词表、字段职责和禁用写法见 [`references/player-visible-action-copy.md`](references/player-visible-action-copy.md)。涉及 `confirmSelectionLabel`、`skipSelectionLabel`、`selectableOptions`、`selectionLabel` 或 `stepText` 时必须读取并遵循，不要临时发明“确定分配”“选择”“继续处理”等机械文案。
- 玩家可见文本中的能量费用必须使用 `[E]` token；固定数量按实际数量重复 `[E]`，动态费用、0 费用和特殊能量选择窗口的标准写法统一遵循 `player-visible-action-copy.md`。不要把“支付费用”和“将实体能量卡变为活跃/待机、放置或计数”等规则动作混为一类。

- `activeEffect.effectText` 默认只展示卡文；不要为了 confirm-only 额外追加运行时资源数量、结算预告或调试说明。
- 只有卡文本身存在条件，且无交互 confirm-only 结算时结果可能因当前状态不同而变化时，才允许在 `effectText` 后追加括号说明。说明应使用玩家语言，包含与卡文条件直接相关的当前计数/状态、满足或未满足、实际结算结果。
  - 合适示例：`（当前休息室不同名『虹ヶ咲』LIVE 5种，满足条件，实际[スコア]+1。）`
  - 不合适示例：无条件放置能量效果后追加 `（当前能量卡组：自己7张，对方5张；确认后自己和对方各放置1张待机状态能量。）`
- 无条件强制效果、固定写入 modifier、固定移动/抽牌/放置等效果，不应在 `effectText` 后追加“当前...”或“确认后...”括号；如需按钮或步骤提示，`stepText` 可用简短玩家语言，例如 `确认后结算此效果。`
- “来源卡是否仍在舞台 / LIVE 区 / CENTER / 原区域”等是引擎安全检查，默认不属于玩家可见卡效文本，禁止出现在 `effectText`、`stepText`、按钮文案或选择说明中。
  - 禁止短语示例：`来源在舞台`、`来源不在舞台`、`来源在LIVE区`、`来源不在LIVE区`、`来源LIVE不在LIVE区`、`source`、`pending`、`payload`、`stale`、`eventId`、`trigger`。
  - 这些信息可以保留在 `actionPayload`、内部变量、测试 helper 或开发日志中；玩家文案若必须表达 no-op，应改写成规则语言，例如 `没有可选择的目标。`
- 编写或审查 confirm-only 文案时，应同时检查同批同型卡和刚抽出的 shared workflow；如果同型卡只改一张，容易在下一批复发。

## 新卡审查窗口协议

用户给候选卡、要求筛选下一批、或要求写执行窗口提示词时，保持只读审查，除非用户明确要求实现。必须先完成启动校准，再按真实卡文和当前实现状态判断。

单张或小批候选卡审查必须输出：

1. 基线确认结果：分支、最新提交、runner 行数、工作树状态。
2. 候选卡真实文本确认：从 `llocg_db/json/cards.json` 核对，列卡号、费用/分数、卡名、原文。
3. 是否已有实现：查 `definitions/index.ts`、workflow、tests、`existing_module_map.md`；已覆盖则跳过并说明来源。
4. 游戏语言：用中文概括每段效果。
5. 代码语言：建议 abilityId、definition、workflow/helper，是扩 `baseCardCodes` 还是新增 abilityId/workflow。
6. 可复用 helper/workflow：明确复用项，也明确不复用或不扩展项及原因。
7. 风险点：pending 顺序、费用支付、skip/decline、公开/手牌隐私、HEART/BLADE modifier、事件消费、测试覆盖。
8. 测试建议：classification 锁什么，focused integration 放哪里，是否需要 sample 大测试。
9. 文档同步建议：必须考虑 `existing_module_map.md`；runtime/cookbook/migration roadmap 按是否新增 helper 或边界判断。
10. 判断是否适合直接开执行窗口。
11. 如用户要求，最后给完整执行窗口提示词；未要求时先停在审查和批次建议。

如果卡文与用户描述不一致，先报告差异，不继续产出实现提示词。如果已有实现覆盖，报告覆盖来源，不建议重复注册。如果单卡 workflow 预计超过 250 行，解释为什么不抽 helper/shared family/steps-lite。需要新增 shared family 时，说明真实配置轴来自哪些卡。

## 候选批次筛选协议

用户一次给多张卡时，先筛掉已实现卡，再按真实效果形状分组和排序。优先推荐同一批内能共享 workflow/helper、测试夹具、触发时点或目标选择形状的卡；不要为了凑批次把语义相近但 pending/费用/事件时机不同的卡混成一个 family。

批次建议默认输出表格，每行一张卡，列为：

| 序号 | 卡牌 | 效果 | 是否计划增加卡牌维度 ts | 计划复用 helper / workflow | 当前 helper 不足从而必须单写的部分 |
| ---- | ---- | ---- | ----------------------- | -------------------------- | ---------------------------------- |

表格之后给出建议第一批开发卡牌和理由。若用户确认批次，再输出执行窗口提示词；不要提前要求执行窗口实现未确认的卡。

## Reuse And Promotion Pass

每次实现或批准新卡效前，强制做一轮复用与晋升检查：

1. 查 `existing_module_map.md`：同基础编号同文优先扩 `baseCardCodes` 或现有 definition。
2. 查 `workflows/shared/`：已有稳定 family 时扩配置，不新增单卡 workflow。
3. 查 `workflows/cards/`：如果新增卡与旧单卡 workflow 的操作顺序相同，判断旧单卡是否应晋升为 shared workflow 或窄 helper。
4. 判断能否晋升时，看真实流程而不是只看文案相似：
   - 费用支付时机一致；
   - pending / skip / continuation 语义一致；
   - 目标选择结构一致；
   - 事件入队时机一致；
   - modifier target 语义一致；
   - 差异能被少量稳定参数表达。
5. 如果只是局部原子动作重复，优先抽 runtime helper 或 query，不急着抽 workflow family。
6. 如果轴不稳定或卡文流程特殊，保留单卡 workflow，并在底层复用 wrapper/query/helper；不要伪装成通用模块。
7. 不把 shared workflow 扩成半个 DSL；不为了“看起来可复用”牺牲可读性和规则时机。

## 审查检查表

### Runner 边界

- 新增卡效是否只在 runner 做薄注册或极薄 dispatch。
- 是否新增完整 start/finish/step 业务流程到 runner。
- 是否新增大块 abilityId / stepId if/else。
- 是否新增卡牌专属 gate、predicate、pending 构造、observer 主体或结算逻辑到 runner。
- 是否改了 pending 顺序、pending continuation、事件消费时机、费用语义或费用支付时机。
- runner 行数增长是否合理；注册增长可接受，业务逻辑增长要阻止。
- 审查执行窗口结果时必须查看 `git diff -- src/application/card-effect-runner.ts`，并将 runner 改动分类：
  1. import/register 胶水；
  2. 通用 runtime/registry hook；
  3. 薄 exact-observer hook 调用；
  4. 卡牌专属 gate / predicate / pending 构造 / observer 主体 / effect body。
- 只有 1/2 默认可接受；3 只有在卡牌专属 observer 主体已注册在 runner 外部时可接受；4 默认是阻塞问题，提交或 PR 前必须迁出 runner。
- 单批 runner 净增超过约 25 行时，要解释每个非 import/register 新增；超过约 50 行且 diff 含具体 abilityId、cardCode、团体名、位置门禁或 pending 构造时，默认按 runner 回流处理。
- resolved-ability observer 允许存在，但必须是窄注册式 observer。runner 可以调用类似 `enqueueResolvedAbilityObserverCardEffects(game)` 的通用 hook，不应直接包含具体卡牌、团体、中心位置或 abilityId 的判断。
- 执行窗口收尾不能只写“runner 只增加必要胶水”；必须报告 runner 行数变化和 runner diff 分类。

### Workflow 边界

- 新卡效是否放入 `src/application/card-effects/workflows/`。
- 同型效果是否优先进入 `workflows/shared/`。
- 特殊复杂卡是否进入 `workflows/cards/<card>.ts`。
- `workflows/cards/` 下新增或改名文件是否符合“基础编号 + 卡名英文字符/罗马字 slug”命名；是否错误使用效果描述、批次名、省略系列前缀或旧临时名。
- `workflows/cards/` 下是否存在服务多个基础编号的同型家族。若有，应默认迁入 `workflows/shared/` 并以行为命名；只有同 base / 同文 rarity 覆盖可保留在 cards。
- 同一执行批次不等于同一 workflow 文件。若以卡牌编号命名 `workflows/cards/<card>.ts`，该文件原则上只承载该基础编号/同文 rarity 的卡效。多个基础编号共用同一文件时，必须是同型效果或稳定 reusable family，并以复用形状命名；否则应拆成多个单卡 workflow。不要用 `<cardA>-<cardB>.ts` 表示仅因同批实现而放在一起的不相关卡牌。
- 如果多个基础编号共用同一稳定 family，但文件还在 `workflows/cards/` 下，即使文件名已是行为名，也视为目录归属错误；提交前应移到 `workflows/shared/`。
- 单卡 workflow 扩展第二个样本时，是否已重新评估晋升 shared、拆文件或抽 helper，而不是继续沿用旧 `cards/` 归属。
- 测试文件名是否随 workflow ownership 同步：单卡测试用基础编号 + 卡名；shared family 测试用行为名；历史组合测试要明确组合范围。
- workflow 内重复小胶水是否应该抽到 runtime、active-effect、workflow helpers 或 events。
- 不强行抽象没有足够真实样本的复杂卡。

### Runtime helper / event wrapper

- 支付、活跃、放置于成员下方、返回能量卡组等效果统一通过通用能量操作底座处理，并保持各自动作的资源合法性与数量语义：支付候选仅为 ACTIVE 且必须足额；活跃候选仅为 WAITING，至多活跃按实际可处理数量结算；放置于成员下方与返回能量卡组的候选为能量区全部能量，自动处理时固定按 WAITING 优先、ACTIVE 其次。只有候选超出处理数量且至少一张合法候选带特殊 marker 时，才打开通用能量选择窗口并要求精确选择；候选恰好等于处理数量或没有特殊能量时按上述顺序自动处理。单卡 workflow 不得自行复制或绕过这套判断，不得使用 `energyZone.cardIds[0]`、`.slice(...)` 等存储顺序选择，也不得因文案治理改变候选、顺序、数量、非法输入或 continuation 语义。
- 卡牌效果将能量区能量放回能量卡组时，选择完成后的执行必须统一调用 `runtime/energy-return.ts` 的 `resolveEnergyReturnByCardEffect`；card workflow、optional window helper 及其他 card-effect runtime 不得直接调用底层 `moveEnergyZoneCardsToEnergyDeckByCardEffect`。公共 helper 必须保持“移动指定卡牌、清除离区 marker、一次写入一个批量 `ON_ENERGY_MOVED_TO_DECK`、将本次精确事件传给触发入队”的原子边界；可选/强制发动、按钮文案和返回后的回收或奖励仍由各自 workflow 管理。
- 触及上述能量操作时，focused test 至少覆盖候选不足/恰好、普通能量超额按规定顺序自动处理、特殊能量超额精确选择，以及重复、非法、stale ID 不推进；断言必须包含实际处理的 energyCardIds，不能只检查数量。返回能量卡组还要覆盖批量移动只产生一个标准事件、事件 cause/来源正确及对应 trigger 只入队一次；支付窗口还要精确断言按实际数量展开的 `[E]` 文案。
- 玩家从休息室自由选择具体卡牌，随后将其加入手牌、放置于主卡组顶/底或其他指定主卡组位置时，移动前必须走 shared public-card-selection confirmation 两阶段生命周期：首次提交只通过 `revealedCardIds` 向双方公开“本次具体选择了哪些卡”，不移动、不发奖励、不推进 pending；服务端按 `min(3500ms, 2000ms + (公开卡牌数 - 1) * 300ms)` 写入权威 deadline，到期后由任意对局参与者请求自动恢复原 workflow step/input，由原 workflow 重新校验当前目标、执行移动/奖励/continuation。不得用客户端 command timestamp 或单方手动确认作为权威判断，也不得用服务进程内长驻 `setTimeout`。
- 普通 `WAITING_ROOM -> HAND` 选择优先且默认使用 `createWaitingRoomToHandEffectState`；组合/grouped/custom workflow 以及休息室到主卡组顶/底/指定位置的 workflow，必须显式写入 `publicCardSelectionConfirmation` metadata 并复用 `runtime/public-card-selection-confirmation.ts`；不得在单卡 workflow 复制暂停、公开、恢复弹窗流程。
- 固定目标移动、将整个休息室/整类对象洗回主卡组，以及玩家只选择目的地而不选择休息室具体卡牌的效果，不接入该公开确认生命周期。
- 上述休息室自由选卡路径的 focused 测试至少锁定：双方 projector 看到相同选择结果与 deadline；首次提交前后卡仍在休息室且奖励/pending 未推进；deadline 前不结算，到期后双方均可请求且重复请求只结算一次；到期时 stale target 不得被移动；可选 0 张/空选择路径按适用性确认不创建空的额外公开窗口；前端不显示普通确认按钮，到期自动请求只发送一次，旧 effect 的 timer 在状态切换时取消；自动推进不得新建一条只恢复过期展示窗口的撤销记录，应合并回原选卡撤销条目，并覆盖撤销后不会立即再次自动结算。
- 玩家从当前声援处理区确定具体卡牌，随后加入手牌、放置于主卡组顶/底或放置入休息室时，移动前同样必须使用 shared public-card-selection confirmation；即使来源和目的地都公开，也不得省略“本次具体移动了哪些卡”的双方展示。metadata 显式使用 `source: 'REVEALED_CHEER'`；缺省 source 只用于向后兼容 `WAITING_ROOM`。
- 声援可移动目标必须同时属于当前玩家本次声援 ID、仍在 `resolutionZone.cardIds`、仍在 `resolutionZone.revealedCardIds` 且 owner 正确。不得用 event-inclusive `CheerEvent.revealedCardIds` 历史条件事实作为可移动集合；卡移出处理区后，原 CheerEvent 事实仍必须保留供后续条件计数。
- 声援选卡公开的 focused 测试至少覆盖 HAND/卡组顶/卡组底/WAITING_ROOM，首次提交不移动、不记录 turn1、不追加声援、不推进 pending，双方可见与动态时长，到期只结算一次，0 张不弹窗，移出 resolution/失去 revealed/不再属于当前声援时不移动，以及自动推进撤销回到原选择前。服务端确定全部卡的路径（如 `PL!S-bp2-004`）必须在展示后走独立结算 step，并在展示集合与最终可移动集合不完全一致时整体不移动，不得悄悄移动剩余子集。
- 手牌进休息室默认使用 `discardHandCardsToWaitingRoomAndEnqueueTriggers` 或 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`。
- 检视 / 查看 / 公开卡组顶后，inspected cards 从检视区进入休息室必须走统一 inspection-to-waiting helper；事件事实按卡组顶移动处理，`fromZone` 为 `MAIN_DECK`、`toZone` 为 `WAITING_ROOM`，同一次检视进入休息室的一组卡作为同一个 `movedCardIds`。
- workflow 不允许裸写 `waitingRoom.cardIds` + `clearInspectionCards` 来处理 inspected remainder；若只是 direct mill 或不进入休息室，应在实现/审查中明确说明不属于 inspection-to-waiting helper 范围。
- 牌组顶直接进入休息室（不经过检视区的 direct mill）默认使用 `moveTopDeckCardsToWaitingRoomAndEnqueueTriggers` / `moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers` 或 `enqueueMainDeckCardsEnteredWaitingRoom`；事件事实为 `MAIN_DECK -> WAITING_ROOM`，同一次实际进入休息室的顶牌作为同一个 `movedCardIds`。`WithRefresh` 只记录实际从刷新后的主卡组顶进入休息室的卡，不把 refresh 洗回卡组的牌算入本次事件；无刷新费用路径不能偷偷改成 refresh 语义。
- 声援公开卡相关效果要区分“条件计数”和“目标移动”。凡是卡文写“エールにより公開されたカードの中に/中から N 张/以上/有某类卡”这类条件，条件计数默认基于本次声援公开事件事实，已被前序效果从 `resolutionZone` / 声援公开区移走的卡仍要计入；优先使用 `selectCurrentLiveRevealedCheerCardIds` 或等价 event-inclusive query。实际把声援公开卡加入手牌、回顶或入休息室时，目标集合才应限制为当前仍在 `resolutionZone` 且 revealed、可被 `moveRevealedCheerCards` 移动的卡。不要用只检查当前可移动区域的 `selectRevealedCheerCardIds` 来判断“曾经因本次声援公开”的条件是否满足。
- 成员区移动默认使用 `moveMemberBetweenSlotsAndEnqueueTriggers` 或当前 stage-formation wrapper。
- 成员状态变化默认使用 state-change trigger wrapper。
- 来源成员自送或离场费用默认使用 leave-stage trigger wrapper。
- workflow 不应裸调 raw helper；特殊底层路径必须注释原因并有测试。

### Query / selector

- 条件判断优先下沉到纯 query / selector。
- query 只读 `GameState`，不创建 activeEffect、不移动卡、不推进 pending。
- domain query 不依赖 application。
- application/effects/conditions.ts 可 re-export domain query 作为卡效入口。
- 不让各卡自己读 `positionMovedThisTurn`、`groupName`、`eventLog` 等底层字段解释规则。
- 团体判断优先用 `cardBelongsToGroup`、`groupAliasIs` 等既有身份 helper。
- 卡名条件必须按卡牌拥有的全部结构化名称身份判断；三人卡等多名称卡同时拥有卡面列出的每个成员名称，不能退化为只比较主显示名。优先复用 `src/shared/utils/card-identity.ts` 的共享名称 matcher 或其 selector 薄包装，不在 `live-modifiers.ts`、workflow 或单卡 query 中复制名称别名表和匹配逻辑。不同名计数与“是否命中某个名称”是两种语义，分别使用对应的 identity helper。
- 声援公开条件 query 必须说明自己读取的是“本次已公开事实”还是“当前仍可移动目标”。前者应包含匹配的 `CheerEvent.revealedCardIds`，用于数量、不同名、颜色、类型等条件；后者用于实际选择/移动，不能反过来驱动条件成立与否。

### Ability definition

- 同基础编号同文优先 `baseCardCodes`。
- 多段效果拆独立 `abilityId`。
- `category`、`sourceZone`、`triggerCondition`、`queued`、`implemented` 要准确。
- 不混淆 `AUTO`、`ON_ENTER`、`ACTIVATED`、`CONTINUOUS`。
- 编写或审查 `effectText` 时必须核对 `client/src/lib/cardEffectTokens.ts` 的 token 映射。
- 不为了整理拆 `definitions/index.ts`。

### Effect text / icon token

- `client/src/lib/cardEffectTokens.ts` 会把效果文本里的 `【...】` 与 `[...]` 占位文本转换为前端图标或样式。卡效定义里的 `effectText` 必须使用该文件已支持的字面量，不要随手发明新的括号文本。
- “效果文本用中文”只要求自然语言规则说明使用中文；不要翻译已经由 `cardEffectTokens.ts` 映射的 token。正确示例：`[桃ハート]`、`[赤ハート]`、`[BLADE]`、`[スコア]`。错误示例：`[桃Heart]`、`[红Heart]`、`[blade]`、`[score]`。
- 前台卡牌详情的效果文本应走卡牌数据本身的 `cardTextCn` / `cardTextJp`，而不是从 `definitions/index.ts` 反推。同步源优先使用 Excel `多行中文效果` -> `card_text_cn`，中文存在时应作为卡牌详情的第一展示文本。
- `definitions/index.ts` 的 `effectText` 用于 pending / activeEffect / 处理窗口展示。新增或修正卡效时，优先直接采用 Excel `多行中文效果` 的卡牌效果描述，只做已支持 token 的等价替换；不要自行总结、缩写或改写成规则摘要。Excel 中文缺失时，才用日文原文或当前最可靠来源兜底，并在审查/收尾中说明。
- 对无交互、有条件触发的 `LIVE开始` / `LIVE成功` 处理窗口，`definitions/index.ts` 的原始效果文本只负责说明卡牌效果本体；manual confirmation 的 `effectText` 必须在其后追加实时条件状态和实际结果，避免玩家只能看到“可以/如果”的卡文却不知道当前是否满足。若不追加，必须明确说明例外理由。
- `activeEffect` 的前端可见操作文案也按中文处理，包括 `stepText`、`selectionLabel`、`confirmSelectionLabel`、`skipSelectionLabel`、`selectableOptions[].label`、`numericInput.confirmLabel` 等。除“查看原卡文”等明确展示日文原文的入口外，不要把日文按钮或日文步骤提示混入中文 UI。
- `selectableOptions[].label` 可以使用 `client/src/lib/cardEffectTokens.ts` 已支持的 token（如 `[E]`、`[BLADE]`、`[桃ハート]`、`[赤ハート]`、`[紫ハート]`），由前端统一渲染成图标；不要用 emoji 或手写图片替代，也不要写未映射 token。
- 可选发动窗口若使用 `selectableOptions` 展示“支付/放置/选择能力”等正向选项，跳过动作应建模为 `canSkipSelection: true` + 明确的 `skipSelectionLabel`（例如 `不发动`、`不放置`），不要同时在 `selectableOptions` 里放 `不发动` / `不处理`，否则前端会同时出现两个跳过按钮；也不要依赖默认 `不加入`，除非真实语义就是“不加入手牌”。
- 可选效果的成本或动作若固定指向来源自身（例如“可以将此成员变为待机状态”），来源成员不是玩家要选择的对象，禁止用 `selectableCardIds: [sourceCardId]` 制造单卡选择窗口。应使用正向 `selectableOptions`（按钮文案通常为 `发动`）配合 `canSkipSelection: true` + `skipSelectionLabel: '不发动'`；玩家选择发动后，再按 `activeEffect.sourceCardId` 重新校验来源并直接支付。focused 测试必须断言该窗口没有 `selectableCardIds`、存在正向发动选项，并覆盖发动、不发动和确认时来源失效。
- 多步骤 activeEffect 从“选择”进入“公开/确认/继续处理”阶段时，必须清理上一阶段专属字段（例如 `selectableCardMode`、`minSelectableCards`、`maxSelectableCards`、`confirmSelectionLabel`、`canSkipSelection`），避免前端同时渲染旧按钮和新步骤按钮。
- 遇到 BLADE、Heart、费用、分数等会显示为图标的内容时，先查现有映射。例如 BLADE 应使用已映射的 `[BLADE]` / `[ブレード]` 等形式，Heart 应使用已映射的 `[赤ハート]`、`[黄ハート]`、`[紫HEART]` 等形式；不要把应图标化的文本写成未映射的 `[红Heart]`、`[blade]`、`[heart]` 或混用大小写/语言导致前端无法识别。
- 如果真实新卡需要的图标 token 当前没有映射，先明确这是前端 token 覆盖缺口：要么改用已有等价 token，要么在同一执行窗口同步扩展 `cardEffectTokens.ts` 与对应 token 测试；不要只在 `definitions/index.ts` 写一个无法转换的临时文本。
- 文档说明可以用自然语言描述 Heart / BLADE，但面向 UI 渲染的 `effectText` 必须保持 token 兼容。审查收尾时若本批触及 Heart/BLADE/COST/score 文本，需要报告已核对 token 映射。
- 对动态 `activeEffect.effectText` / `stepText` / `selectionLabel` 等前台文案，同样适用中文自然语言 + 映射 token 原样保留的规则；新增动态窗口测试时应断言关键文案不含未映射 token 和明显日文规则句式。

### Trigger matcher

- matcher 只判断事件事实是否匹配 ability/source，不处理目标、费用、结算、perTurnLimit 消耗或 pending 顺序。
- 未明确开启 T-2 前，不接 runner、不替换 `enqueueTriggeredCardEffects`、不改变 pending 创建。
- 允许审查或推进已明确范围的 shadow：`ON_ENTER_WAITING_ROOM`、`ON_MEMBER_SLOT_MOVED`、`ON_MEMBER_STATE_CHANGED`、`ON_LEAVE_STAGE`。

### Steps-lite

- 不做完整 steps DSL。
- 只有真实重复 workflow family 稳定后，才考虑 typed builder。
- steps-lite 是减少稳定 family 样板，不是替代所有 workflow。
- 复杂单卡 workflow 不强行 steps 化。

### Modifier / effective value

- HEART / BLADE / SCORE / requirement modifier 要确认 target 语义。
- 成员获得 Heart 应使用 `SOURCE_MEMBER` / `TARGET_MEMBER`，不用 legacy `PLAYER` Heart 表达真实成员 Heart。
- effective Heart / effective cost / effective Blade 读取应走 query。
- 扩展 `live-modifiers.ts` 时说明来源卡、来源区域、target、叠加/不叠加边界。

### Cost calculator

- 默认不改 `cost-calculator.ts`。
- 如用户明确授权，变更必须绑定真实卡规则、给出规则理由和 focused 测试。
- 如果当前 WIP 已碰 `cost-calculator.ts`，审查其必要性、影响面和测试，不把例外扩大为通用 refactor。

### 测试

- 分类测试：`tests/unit/card-effect-classification.test.ts`。
- workflow integration 覆盖正常结算、skip、无目标、非法选择、pending continuation。
- 对无交互 queued LIVE pending，focused integration 至少覆盖：
  1. 单 pending 先开 confirm-only `activeEffect`，确认前不结算，确认后才结算；
  2. 多 pending 点“顺序发动”且没有新增能力时，同一 ordered batch 自动连续结算且不弹 confirm-only；
  3. 多 pending 手动点选该效果时先弹 confirm-only，确认前不应用效果，确认后才结算；
  4. 已有真实交互 workflow 不出现双弹窗。
- 检查时点调度 focused integration 至少覆盖：
  1. 初始 A、B 待机，A 完整结算后产生 X，下一次候选同时包含 B、X 并允许先选择 X；
  2. X 不得插入 A 的多步骤效果文字中间；
  3. A 产生 X、X 再产生 Y 时保持同一检查时点，直到规则处理与双方 pending 真正清空；
  4. 主动/非主动玩家优先级，以及 ordered batch 在新增 X 后必须失效并重新选择。
- domain query/helper unit 覆盖纯函数正反例。
- event wrapper 覆盖事件产生、事件入队、0 张/无事件不触发。
- 声援公开条件测试必须覆盖“本次声援公开过的卡已被前序效果移出 `resolutionZone` 但仍应计入条件”的回归；若同一效果还要移动声援公开卡，另测 stale target 不能被移动。
- 高风险旧路径补 regression。

常用验证：

```bash
./node_modules/.bin/vitest run <focused tests>
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -b client
git diff --check
```

触及 `definitions/index.ts` 的 `effectText` / `activatedUi`，或触及动态 `activeEffect.effectText` / `stepText` / `selectionLabel` / `selectableOptions` / 按钮文案时，除 focused workflow 测试外必须补跑：

```bash
./node_modules/.bin/vitest run tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts
```

如本机需要指定 Node runtime，可在执行时自行把对应 `bin` 目录加入 `PATH`；不要在 skill 中写死个人机器路径。

### 文档

- 新增或完成卡效同步 `existing_module_map.md`。
- 新增或扩展 helper / shared workflow 时，同步相关 cookbook、runtime helper、workflow guide、migration roadmap、coverage/gap docs。
- README 等文档若滞后，可建议另开 docs cleanup 窄窗口，不在卡效审查里顺手大改。
- 文档不能夸大：shadow 不是接线，局部 helper 不是全局完成，单卡 workflow 不是 shared family。

## 审查输出格式

按这个顺序输出：

1. 阻塞问题，按严重程度排序。
2. 没有阻塞时明确写“未发现阻塞问题”。
3. 非阻塞建议。
4. 架构判断：
   - 是否符合当前完成态框架；
   - 是否有 runner 回流；
   - 是否有 helper/query/selector 应抽未抽；
   - 是否有旧单卡 workflow 因新增样本应晋升；
   - 是否有过度抽象；
   - 是否有文档过度宣传。
5. 下一步：
   - 可过则给 commit message、PR 回复或下一批提示词；
   - 不可过则给修正提示词；
   - 无审查对象则给符合当前规范的新卡开发提示词。

## 启动提示词示例

新卡候选审查窗口：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，作为 Loveca 新卡卡效审查窗口。默认只读，不改代码、不 stage、不 commit、不 push。请先执行基线校准，核对 llocg_db/json/cards.json 真实卡文，检查 existing_module_map.md、ability-ids.ts、definitions/index.ts、相关 workflow/helper/tests 是否已有实现，再按 skill 的“新卡审查窗口协议”审查以下候选卡并给出批次建议；暂时不要写执行窗口提示词，等我确认批次后再写：<卡号列表>
```

总审查：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，作为 Loveca 新卡卡效开发架构把关窗口。默认只读不改代码。请审查从 <commit> 开始往后的 <N> 个 commit message 中提到的所有新增卡效卡牌是否符合规范。
```

新卡效开发：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，然后按当前卡效框架规范为以下卡牌做新卡效开发。先核对 cards.json 卡文、existing_module_map.md 和复用路径，再实现。默认不 commit、不 push。
```

卡效提交说明：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，并使用 draft-card-effect-commit-message.ts 为本批卡效生成提交说明骨架。新增卡效必须使用当前前端 `/api/cards` 实际返回的展示 card_text（中文优先、日文兜底）；同文卡合并一行，其余卡牌一张一行。请结合真实 diff 补齐其他章节，先把完整 commit message 给我确认，不要 commit、不要 push。卡牌范围：<卡号列表或明确的 diff/commit 范围>
```

修正审查发现的问题：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，然后只修正上一轮审查列出的阻塞问题。保持 runner 薄调度边界，不扩大到未授权的 trigger matcher、steps-lite 或 cost 规则改动。
```
