---
name: loveca-card-effect-governance
description: Use for Loveca battle card-effect architecture review and new card-effect development governance. 适用于 Loveca 卡效总审查、新卡效候选审查、执行窗口提示词、卡效开发规范、runner 回流检查、helper/workflow/query 复用与晋升审查、只读审查窗口、focused validation、文档诚实性检查。
---

# Loveca Card Effect Governance

本 skill 是 Loveca Battle 卡效开发和审查的入口流程。它不替代仓库文档；它负责让 Codex 进入正确工作姿势，并把细节指向当前代码和权威文档。

## 工作模式

- 默认仓库为 `/Users/meiyikai/Desktop/文件/个人/codex/loveca/loveca_battle`。
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

如用户指定从某个 commit、分支或 PR 开始审查，先用本地 git 信息确认真实范围；不要凭提示词假设。

## 权威顺序

- 判断当前阶段时，以真实代码、当前 diff、`docs/card-effect-framework/migration_roadmap.md` 为准。
- `docs/card-effect-framework/README.md` 是入口，但 `Current Goal` 可能滞后；不要单独把它当最终状态。
- 本地卡文以 `llocg_db/json/cards.json` 为主要事实来源；`cards_cn.json` 可做翻译或漂移参照。
- 卡牌完成状态优先查 `docs/card-effect-reuse-audit/existing_module_map.md`，再查 `ability-ids.ts`、`definitions/index.ts` 和最近 workflow/test。

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

## 当前框架立场

- `card-effect-runner.ts` 去中心化的主要迁移已经完成，完整卡效 fallback 不应回流。
- runner 可保留 workflow handler import/register、pending/activeEffect 生命周期入口、trigger/activated 调度入口、`enqueueTriggeredCardEffects` 及尚未迁出的 trigger/relay/matcher 胶水。
- 新卡效不应把完整流程写回 runner。按当前模式需要在 runner 做薄注册可以接受，但 diff 应限于 import/register/极薄 dispatch。
- trigger matcher 仍是纯 matcher；除非用户明确开启 T-2，不接 runner、不替换生产 enqueue 路径、不改变 pending 创建。
- steps-lite 只用于真实重复 workflow family 稳定后的 typed builder，不做完整 DSL 或解释器。

## 新卡效开发流程

1. 确认卡牌范围：来自用户列表、commit message、diff 或 registry 时，都要反查 `definitions/index.ts`、`ability-ids.ts`、`existing_module_map.md` 并按 base card code 去重。
2. 核对真实卡文：从 `llocg_db/json/cards.json` 读取日文原始卡文；必要时用 `cards_cn.json` 检查翻译漂移。
3. 先审查复用路径，再写代码：优先复用已有 query、selector、runtime helper、event wrapper、activeEffect shell、shared workflow。
4. 只有没有稳定 family 时，才写 `src/application/card-effects/workflows/cards/<card>.ts` 单卡 workflow。
5. 单卡 workflow 可以存在，但要复用稳定底层动作，不复制裸事件入队、抽弃、activeEffect 构造、成员移动、状态变化等胶水。
6. 新增 helper/shared workflow 必须说明真实卡样本、稳定参数轴、不纳入的差异和测试覆盖。

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
| --- | --- | --- | --- | --- | --- |

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
- 是否改了 pending 顺序、pending continuation、事件消费时机、费用语义或费用支付时机。
- runner 行数增长是否合理；注册增长可接受，业务逻辑增长要阻止。

### Workflow 边界

- 新卡效是否放入 `src/application/card-effects/workflows/`。
- 同型效果是否优先进入 `workflows/shared/`。
- 特殊复杂卡是否进入 `workflows/cards/<card>.ts`。
- workflow 内重复小胶水是否应该抽到 runtime、active-effect、workflow helpers 或 events。
- 不强行抽象没有足够真实样本的复杂卡。

### Runtime helper / event wrapper

- 手牌进休息室默认使用 `discardHandCardsToWaitingRoomAndEnqueueTriggers` 或 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`。
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

### Ability definition

- 同基础编号同文优先 `baseCardCodes`。
- 多段效果拆独立 `abilityId`。
- `category`、`sourceZone`、`triggerCondition`、`queued`、`implemented` 要准确。
- 不混淆 `AUTO`、`ON_ENTER`、`ACTIVATED`、`CONTINUOUS`。
- 不为了整理拆 `definitions/index.ts`。

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
- domain query/helper unit 覆盖纯函数正反例。
- event wrapper 覆盖事件产生、事件入队、0 张/无事件不触发。
- 高风险旧路径补 regression。

常用验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run <focused tests>
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/tsc -b client
git diff --check
```

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

修正审查发现的问题：

```text
请先阅读 .agents/skills/loveca-card-effect-governance/SKILL.md，然后只修正上一轮审查列出的阻塞问题。保持 runner 薄调度边界，不扩大到未授权的 trigger matcher、steps-lite 或 cost 规则改动。
```
