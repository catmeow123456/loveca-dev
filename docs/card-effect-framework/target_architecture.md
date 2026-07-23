# Card Effect Target Architecture

> 文档类型：设计文档
> 适用范围：卡效系统最终目标态、目录结构、runner 去中心化边界
> 当前状态：目标架构；当前实现差距见 `migration_roadmap.md`

本文描述卡效系统的目标形态。它不表示全部能力已经落地；当前实现状态以真实代码、测试和 `migration_roadmap.md` 为准。

## Architecture Goal

目标是把卡效执行拆成四层：

1. **definition layer**：登记能力事实。
2. **runtime layer**：提供稳定原子动作、pending / activeEffect 运行时和 step handler registry。
3. **workflow layer**：承载具体卡效流程或同型 workflow family。
4. **runner layer**：只做调度，不承载卡牌专属流程。

`card-effect-runner.ts` 的目标职责：

- 读取 ability definition。
- 根据事件或玩家起动请求创建 pending / activeEffect。
- 调用 workflow starter。
- 调用 activeEffect step handler registry。
- 继续 pending 队列。

它不应继续承担：

- 单张卡的完整 start / finish 流程。
- 手写抽牌、弃牌、回收、看顶、公开、移动等原子动作。
- 大量 `abilityId + stepId` 的内联 `if` 分发。
- 卡文条件和目标选择的重复扫描。

## Target Directory Shape

```text
src/application/card-effects/
  ability-ids.ts
  ability-definition-types.ts
  definitions/
    index.ts
    shared-abilities.ts

  runtime/
    actions.ts
    active-effect.ts
    pending.ts
    step-registry.ts
    trigger-sources.ts

  workflows/
    cards/
    shared/

src/application/effects/
  card-selectors.ts
  conditions.ts
  stage-targets.ts
  energy.ts
  member-state.ts
  zone-selection.ts
  look-top.ts
  cheer-selection.ts

src/domain/rules/
  live-modifiers.ts
  live-requirement-modifiers.ts
  success-live-score.ts
  cost-calculator.ts
```

## Layer Responsibilities

### Definition Layer

Location:

- `src/application/card-effects/ability-ids.ts`
- `src/application/card-effects/ability-definition-types.ts`
- `src/application/card-effects/definitions/index.ts`

Responsibilities:

- ability id、基础编号、分类、来源区域、触发条件、次数限制、展示文本。
- 同基础编号不同罕度优先用 `baseCardCodes`。
- 不写 workflow。
- 不写 pending / activeEffect 结算。

### Runtime Layer

Location:

- `src/application/card-effects/runtime/`

Responsibilities:

- 原子动作：抽牌、弃牌、移动、回收、看顶清理等。
- pending / activeEffect 创建、推进和清理。
- step handler registry。
- trigger source 构造与 eventLog 读取辅助。

Current start:

- `runtime/actions.ts` 已开始承接 `drawCardsForPlayer`、`drawCardsForEachPlayer`、`discardHandCardsToWaitingRoomForPlayer`、`discardOneHandCardToWaitingRoomForPlayer`。

Runtime helper 不应知道完整卡文流程。它只表达一个稳定动作或运行时机制。

### Workflow Layer

Location:

- `src/application/card-effects/workflows/`

Responsibilities:

- 表达一张卡或一类同型卡的流程。
- 组合 runtime action、selector/query、zone selection、live modifier 等底座。
- 导出 starter 与 step handler。

同型效果放 `shared/` family 文件。例如：

```text
workflows/shared/self-sacrifice-waiting-room-to-hand.ts
workflows/shared/look-top-select-to-hand.ts
workflows/shared/pay-energy-gain-blade.ts
```

特殊效果放 `cards/`，可一张卡一个文件。例如：

```text
workflows/cards/hs-bp5-003-rurino.ts
workflows/cards/pl-bp6-024-sakkaku-crossroads.ts
```

### Runner Layer

Location:

- `src/application/card-effect-runner.ts`

Target responsibilities:

- ability definition 查询。
- trigger enqueue 入口。
- activated ability 入口。
- pending / activeEffect 生命周期入口。
- workflow starter / step handler registry dispatch。

Target non-responsibilities:

- 不手写卡牌专属 workflow。
- 不内联大量 stepId 分支。
- 不重复实现 runtime action。
- 不承载 single-card 复杂流程。

## Dispatch Model

目标启动分发：

```ts
const PENDING_EFFECT_STARTERS = {
  [HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID]:
    startHsBp5003RurinoLiveStart,
};
```

目标 step 分发：

```ts
registerActiveEffectStepHandler(
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP5_003_SELECT_DISCARD_STEP_ID,
  finishHsBp5003RurinoDiscard
);
```

目标 runner 形态：

```ts
export function confirmActiveEffectStep(game, input) {
  return resolveActiveEffectStepWithRegistry(game, input);
}
```

## Template vs Special Card

Loveca 后续卡效不应假设全部能模板化。

- 能归类的效果：做 workflow family，用参数覆盖差异轴。
- 不能归类的复杂效果：做 card-specific workflow 文件。
- 无论是否同型，完整流程都不继续留在 runner。

目标不是消灭单卡逻辑，而是让单卡逻辑站在标准 runtime 之上，并从 runner 中移出。
