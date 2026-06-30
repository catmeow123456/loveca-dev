# Loveca 卡效底层重构审查接棒手册

> 文档类型：历史/计划文档
> 适用范围：卡效底层重构审查窗口的延续、边界回顾与后续窗口启动
> 当前状态：历史交接参考；不作为当前实现事实的权威来源，当前实现以代码、`card_effect_implementation_guide.md` 与 reuse audit 文档为准

本文档用于新窗口继承当前窗口的“卡效底层审查/把关”职能。它不是替代 `PROJECT_PROGRESS_TODO.md`、`existing_module_map.md` 或框架设计文档，而是记录当前重构的判断框架、阶段边界、已知坑点和审查清单。

## 当前工作流

- 做卡效底层改动时，默认先读真实代码和相关文档，再给简短计划；如果只是审查隔壁窗口结果，优先看 diff 形状、行为边界和测试结果。
- 本文中的阶段描述反映 2026-06-16 时的重构交接判断；若与当前代码或权威文档不一致，以当前代码和权威文档为准。

## 总体路线

当前认可的长期顺序是：

1. 事件层：把“刚刚发生了什么”写成 `GameState.eventLog` 中的标准事件，再由触发器消费。
2. condition/query：把 resolver 里散落的区域计数、阈值判断、来源状态查询抽成可复用纯函数。
3. 通用 trigger matcher：把“哪个事件会触发哪个能力”的匹配逻辑从逐能力 if 判断收束成统一 matcher。
4. steps 配置化：最后再把稳定套路迁成声明式 steps，runner 才逐步变成解释器。

不要跳过前面的基础层直接做 steps 解释器。steps 依赖事件事实、条件查询和触发匹配，否则只会把命令式 resolver 包一层配置外壳。

## 已完成的关键边界

### 事件层主干

已将以下触发路径接入事件流或完成事件消费 proving path：

- `ON_ENTER_STAGE`
- `ON_LEAVE_STAGE`
- `ON_MEMBER_SLOT_MOVED`
- `ON_LIVE_START`
- `ON_LIVE_SUCCESS`
- `ON_MEMBER_STATE_CHANGED`
- `ON_CHEER`

事件层原则：

- `emitGameEvent` 记录的是规则事实。
- pending ability 的 `eventIds` 应绑定真实事件 ID，而不是只靠 synthetic ID。
- 旧 fallback 可以保留，用于降低迁移风险，但新路径应优先消费 `eventLog` 或显式传入的新事件。
- 追加声援事件不二次触发 `ON_CHEER`，避免递归触发。

### 暂不处理的事件风险

“费用支付期间产生事件后，是否立刻消费触发”的问题暂不做。当前没有真实卡依赖“支付费用导致状态变化，再触发另一个 AUTO”的场景。不要为了理论完整性提前改 pending 顺序。

正确态度：

- 事件可以先被记录。
- 是否消费、何时消费，需要由真实卡样例驱动。
- 未来若出现相关卡，再专门设计“费用支付后收集新事件并按规则时机入队”的小专题。

### 定义层拆分

`card-effect-runner.ts` 中的定义层已经拆到 `src/application/card-effects/`：

- `ability-ids.ts`：ability id 常量。
- `ability-definition-types.ts`：`CardAbilityCategory`、`CardAbilitySourceZone`、`CardAbilityDefinition` 等类型。
- `definitions/index.ts`：effect text 与 `CARD_ABILITY_DEFINITIONS`。
- `definitions/shared-abilities.ts`：同型能力共用 base-card 列表。

当前不急着继续把 `definitions/index.ts` 按卡包拆小。单文件可以先接受。等定义变厚、并行冲突变多，或引入 `steps/condition/target` 后，再按系列或卡包拆会更自然。

注意：同一个 `abilityId` 可能因为多个 trigger 重复登记，例如“登场或移动区域时”。不要做“abilityId 全局唯一”的断言；可以要求重复登记的文本和 baseCardCodes 保持一致。

### 严格 definition 查询

runner 中查 effect text / baseCardCodes 时应使用严格 helper。找不到 ability definition 应直接抛错，不要静默返回空字符串或空数组。这样新增 ability 时，如果忘登记 registry，测试会早失败。

### condition/query 第一版

`src/application/effects/conditions.ts` 已起步为纯 query/helper 层，提供：

- 区域卡牌计数。
- 按 `CardSelector` 计数。
- 按 selector 做阈值判断。
- 成功 LIVE 数。
- 舞台成员数。
- LIVE 区排除来源卡后的 selector 计数。
- 来源成员有效 BLADE 数和阈值判断。

当前它不是 AST，不是声明式 steps，也不是公式 builder。它只是将 runner 内联条件逐步替换为可复用 query。

已迁移或开始复用的典型条件包括：

- `PL!-sd1-001-SD`：成功 LIVE 数。
- `PL!-sd1-009-SD`：休息室 `μ's` 数量。
- `PL!-sd1-022-SD`：成功 LIVE 数量影响必要 HEART 减少。
- `PL!HS-bp5-019-L`：LIVE 区其他莲之空卡数量。
- `PL!HS-bp2-022-L+`：休息室 Cerise Bouquet LIVE 数。
- `PL!HS-pb1-009-R`：来源成员有效 BLADE >= 8。
- `PL!HS-pb1-020-N`：休息室 LIVE >= 3。

## 审查隔壁窗口结果时的重点

当用户贴出“隔壁窗口做完了”的结果时，不要只看测试通过。按以下顺序把关：

1. 看 git 状态：确认分支、未纳入项、新增文件是否被遗漏。
2. 看 diff 形状：是否只动了宣称范围内的文件。
3. 看 runner diff：是否偷改 pending 顺序、事件消费时机、resolver 流程或费用语义。
4. 看新增模块：是否是纯函数/低耦合，是否没有反向依赖 runner。
5. 看行为等价：内联逻辑替换成 helper 后，selector/条件是否真的等价。
6. 看文档：是否窄同步，是否把“第一版 helper”夸成“完整 AST/完整框架”。
7. 看测试：核心至少应覆盖相关单测、`sample-card-effect-runner.test.ts`、`tsc --noEmit`、`git diff --check`。
8. 看未跟踪文件：新增源码文件不要漏提交，本地素材和 `llocg_db` 不要混入。

## 常见坑点

### 事件 emit 不等于触发已消费

写入 `eventLog` 只是记录事实。触发能力还需要明确在合适时机扫描这些事件并入队。审查事件相关改动时，要看：

- 事件是否在状态变化后、check timing 前写入。
- 入队函数是否优先消费新事件。
- pending ability 是否绑定真实 `eventId`。
- 是否错误扫描旧事件，造成重复触发。

### 不要提前设计无样例规则

费用期间事件消费、完整 condition AST、通用 steps 解释器，都需要真实卡驱动。没有样例时，优先记录风险，不要为了架构完整性改执行顺序。

### selector 替换要核对等价性

例如 `isMuseCard` 替换为 `groupIs("μ's")` 时，要确认旧逻辑是否依赖过 `PL!-` 卡号 fallback 或文本字段；2026-06-30 起 `groupIs` 只基于结构化 `groupNames` 与别名归一化。不能因为名字看起来一样就默认行为相同。

### docs 要诚实

如果只是第一版 query helper，就写“第一版纯函数 helper”。不要写成“condition AST 已完成”或“DSL 已落地”。

### runner 变小不是唯一目标

当前目标是减少重复、提高可验证性，并为后续 matcher/steps 铺路。不要为了减少行数把逻辑搬到另一个同样命令式的大文件里。

## 建议验证命令

基础验证：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts
pnpm test:run tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
git diff --check
```

事件层或费用模块相关改动额外跑：

```bash
pnpm test:run tests/unit/game-events.test.ts tests/unit/member-state.test.ts tests/unit/effect-costs.test.ts
pnpm test:run tests/integration/online-command-pipeline.test.ts
```

如果本窗口里 `pnpm` 不在 PATH，可使用 bundled pnpm：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
```

## 下一步建议

在 condition/query 第一版之后，短期建议不是马上做 steps，而是继续小步推进：

1. 给 `conditions.ts` 补独立单测，尤其是 zone query、selector count、source BLADE query。
2. 继续迁移 2-4 个低风险内联条件，但只在出现明显复用价值时做。
3. 开始设计通用 trigger matcher 的最小形态，先覆盖已事件化的 AUTO，不改 resolver 行为。
4. 等 matcher 和 condition/query 稳定后，再挑最规整的效果流程做 steps 配置化试点。

## 给新窗口的角色定位

新窗口要承担“项目作者兼底层重构审查者”的角色，而不是只执行任务的实现窗口。它应该：

- 对隔壁窗口结果做批判性核对。
- 明确哪些问题是 blocker，哪些只是 backlog。
- 优先维护行为不变和测试可证明性。
- 不默认认同外部审阅或其他窗口的判断。
- 对用户解释技术风险时尽量通俗，但落到代码时要严格。
