# Loveca 联机模式 PlayerViewState 草案

> 文档类型：联机设计草案
> 适用范围：定义联机首版中面向单一座位投影后的 `PlayerViewState` 目标形状，以及它与权威状态、公共事件、共享牌桌对象模型之间的关系。
> 最后更新：2026-04-02

---

## 1. 文档目标

本文档用于回答以下问题：

- 联机首版中的 `PlayerViewState` 不应只是“删敏后的 `GameState`”，那它应该长什么样。
- 在共享牌桌对象模型下，客户端最适合接收怎样的数据结构。
- `PlayerViewState` 应负责哪些内容，哪些内容应继续留在 `AuthoritativeGameState`。
- `PlayerViewState` 与公共事件流、窗口状态、可用命令之间应如何分工。

本文档不定义最终数据库结构，不替代：

- `docs/online-mode-preparation.md`
- `docs/online-mode-visibility-matrix.md`
- `docs/online-mode-public-event-minimum-schema.md`
- `docs/online-mode-inspection-command-draft.md`

它只聚焦“面向某一 seat 的视图快照”。

---

## 2. 设计背景

结合 [detail_rules.md](/root/loveca/detail_rules.md) 与当前联机文档，本轮已经确定以下前提：

- 所有卡牌对象都属于共享牌桌模型的一部分。
- 每张牌在一局对战中都持有全局稳定的 `publicObjectId`。
- 首版采用“局部强跟踪，进入混淆态后断跟踪”。
- 检视区、解决区、Live 放置区和各类公开区中的对象，更适合作为可持续投影的共享对象。
- 手牌、主卡组、能量卡组等隐藏混淆区，对非持有者通常不投影为可持续跟踪的单卡对象。
- 检视区是正式区域，区内原子操作即时生效。
- 检视流程在视图层中使用独立窗口类型表达。

这意味着：

- `getStateForPlayer()` 不能继续返回权威状态副本。
- `PlayerViewState` 也不应只是“把私密信息删掉”的结构化副本。

它应是一个真正面向观察者、面向渲染、面向交互的投影视图。

---

## 3. `PlayerViewState` 的职责

`PlayerViewState` 应至少回答以下问题：

1. 当前对局进行到哪里了。
2. 当前谁可以操作、系统在等谁。
3. 当前牌桌上有哪些对象。
4. 这些对象在本 seat 眼里位于哪里、按什么顺序摆放。
5. 这些对象在本 seat 眼里是 `BACK` 还是 `FRONT`。
6. 若为 `FRONT`，本 seat 可以读取哪些正面信息。
7. 当前本 seat 可以发送哪些命令。

换句话说：

- `AuthoritativeGameState` 负责“规则执行真实世界”
- `PlayerViewState` 负责“某一观察者眼中的当前牌桌”

---

## 4. 总体结构建议

联机首版建议将 `PlayerViewState` 拆成五块：

1. `match`
2. `table`
3. `objects`
4. `permissions`
5. `uiHints`

示意类型：

```ts
type PlayerViewState = {
  match: MatchViewState;
  table: TableViewState;
  objects: Record<string, ViewCardObject>;
  permissions: PermissionViewState;
  uiHints?: UiHintViewState;
};
```

---

## 5. `match` 部分

`match` 用于表达当前对局时机、窗口和全局上下文。

建议类型：

```ts
type MatchViewState = {
  matchId: string;
  viewerSeat: 'FIRST' | 'SECOND';
  turnCount: number;
  phase: string;
  subPhase: string;
  activeSeat: 'FIRST' | 'SECOND' | null;
  prioritySeat?: 'FIRST' | 'SECOND' | null;
  window?: ViewWindowState | null;
  seq: number;
};
```

字段说明：

- `viewerSeat`
  当前这份视图属于哪个 seat。
- `phase`
  当前主阶段。
- `subPhase`
  当前子阶段。
- `activeSeat`
  当前流程上的活跃 seat。
- `prioritySeat`
  若当前有显式优先权含义，可给出当前持优先权一方。
- `window`
  当前窗口状态。
- `seq`
  当前视图基于哪一个服务端事件序号。

补充约束：

- `seq` 应与公共事件流的递增序号对齐，便于断线恢复和补快照。

---

## 6. `table` 部分

`table` 用于描述牌桌上的区域结构和对象占位。

建议类型：

```ts
type TableViewState = {
  zones: Record<ViewZoneKey, ViewZoneState>;
};
```

这里的核心原则是：

- 区域只描述“对象在哪里、顺序如何、槽位如何”
- 区域不直接重复存储完整牌面信息

这样可以把“位置”和“信息可读性”解耦。

### 6.1 `ViewZoneState`

建议类型：

```ts
type ViewZoneState = {
  zone: string;
  ownerSeat?: 'FIRST' | 'SECOND';
  count: number;
  ordered: boolean;
  objectIds?: string[];
  slotMap?: Record<string, string | null>;
  overlays?: Record<string, string[]>;
};
```

说明：

- `count`
  当前 viewer 可见的该容器张数。即使该区不投影 `objectIds`，也应能独立表达张数。
- `objectIds`
  适合检视区、Live 区、成功区、休息室、除外区、解决区等可投影为对象级连续观察链的线性容器。
- `slotMap`
  适合成员区这类槽位型区域。
- `overlays`
  适合成员下方能量等附着在槽位对象上的叠放结构。

补充说明：

- `ordered`
  表示当前这份 `PlayerViewState` 是否按顺序渲染该区域，而不是 authority 是否在内部维护顺序真值。
- 对手视角中的手牌、主卡组、能量卡组，首版通常不必强行投影为 `objectIds` 列表；只要有足够的容器摘要即可。
- 因此一个区域完全可能同时满足：
  - `count > 0`
  - `objectIds` 缺省
  - authority 内部仍维护稳定顺序真值

### 6.2 区域建模建议

结合当前规则与实现，首版建议至少包含：

- `FIRST_MAIN_DECK`
- `FIRST_ENERGY_DECK`
- `FIRST_HAND`
- `FIRST_LIVE_ZONE`
- `FIRST_SUCCESS_ZONE`
- `FIRST_WAITING_ROOM`
- `FIRST_EXILE_ZONE`
- `FIRST_MEMBER_LEFT`
- `FIRST_MEMBER_CENTER`
- `FIRST_MEMBER_RIGHT`
- `SECOND_*` 对应区域
- `SHARED_RESOLUTION_ZONE`
- `FIRST_INSPECTION_ZONE`
- `SECOND_INSPECTION_ZONE`

说明：

- 即使某些流程下只允许当前 seat 使用检视区，也建议在视图模型上把它当作正式区域。
- 成员下方能量建议通过对应成员槽位的 `overlays` 表达，而不是再单独建一套 `*_MEMBER_UNDER_*` 顶层区域。
- 这里的 `FIRST_INSPECTION_ZONE` / `SECOND_INSPECTION_ZONE` 主要是视图层键名约定；在命令层、事件层和公共位置引用里，检视区仍统一按 `INSPECTION_ZONE + ownerSeat` 理解。
- 与公共事件中的 `PublicZoneRef` 对齐时，成员下方能量应理解为“成员槽位上的 overlay”，而不是独立 zone；也就是公共层更接近 `MEMBER_ZONE + slot + overlayIndex`，视图层再把它展开为 `overlays[slot]`。

---

## 7. `objects` 部分

`objects` 是 `PlayerViewState` 的核心。

建议类型：

```ts
type ViewCardObject = {
  publicObjectId: string;
  ownerSeat: 'FIRST' | 'SECOND';
  controllerSeat: 'FIRST' | 'SECOND';
  cardType?: 'LIVE' | 'MEMBER' | 'ENERGY';
  surface: 'NONE' | 'BACK' | 'FRONT';
  orientation?: 'ACTIVE' | 'WAITING';
  faceState?: 'FACE_UP' | 'FACE_DOWN';
  frontInfo?: ViewFrontCardInfo;
};

type ViewFrontCardInfo = {
  cardCode: string;
  name: string;
  cardType: string;
  cost?: number;
  score?: number;
  requiredHearts?: unknown;
  hearts?: unknown;
  text?: string;
};
```

### 7.1 为什么需要对象表

因为在当前联机模型下：

- 每张牌有整局稳定的 `publicObjectId`
- 同一个对象会在公共连续观察链中跨多个区域移动
- 同一个对象对不同 seat 的信息可读性不同

所以最自然的结构是：

- 区域持有对象 ID
- 对象表持有该 seat 看到的对象信息

### 7.2 `surface` 与 `frontInfo` 的关系

建议理解为：

- `surface = BACK`
  表示对象存在，但该 seat 不能读取正面信息
- `surface = FRONT`
  表示对象正面可见，且该 seat 可以读取这张牌的完整正面信息

因此：

- `surface`
  解决“看到背面还是正面”
- `frontInfo`
  解决“正面可见时，前端应拿到的完整牌面信息”

首版按实体牌桌直觉处理：

- 看到正面，就等于看到了该卡牌的全部信息。
- 不在 `PlayerViewState` 中为 `FRONT` 再做字段级可读权限拆分。

---

## 8. `permissions` 部分

联机首版不应要求前端自行从阶段和区状态推导“能做什么”。

建议 `PlayerViewState` 显式给出当前 seat 可用命令提示。

```ts
type PermissionViewState = {
  availableCommands: ViewCommandHint[];
};

type ViewCommandHint = {
  command: string;
  enabled: boolean;
  reason?: string;
  scope?: {
    zoneKeys?: string[];
    objectIds?: string[];
  };
  params?: Record<string, unknown>;
};
```

示例：

- 当前可 `OpenInspection`
- 当前可 `MoveInspectedCardToBottom`
- 当前只可 `FinishInspection`
- 当前可 `SubmitScore`
- 当前不可 `SetLiveCard`，原因是“不是你的操作窗口”

这样可以避免前端再复制一遍服务端的规则判断。

### 8.1 设计建议

首版建议采用中间复杂度方案：

- 不只返回命令名
- 也不直接返回所有可执行实例的完整展开列表
- 由服务端返回“命令名 + 当前作用范围 + 少量必要上下文参数”
- 这里的作用范围主要描述流程和桌面事实边界，不负责替玩家判断复杂卡文条件是否成立

因此：

- `command`
  表示当前命令类型
- `enabled`
  表示当前是否允许发送
- `reason`
  在禁用时给出简短原因
- `scope`
  表示这条命令当前可作用的区域或对象范围
- `params`
  表示当前窗口下命令所需的少量附加上下文

### 8.2 为什么不建议只给命令名

如果只给：

```ts
{ command: 'MoveInspectedCardToBottom', enabled: true }
```

前端仍需自行推导：

- 哪些对象当前可以执行该命令
- 命令是否只适用于某个区域

这会把大量规则判断重新推回前端。

### 8.3 为什么不建议首版过度展开

如果首版直接把所有可执行实例全部展开成详细动作列表，例如：

```ts
{
  command: 'MoveInspectedCardToBottom',
  enabled: true,
  actions: [
    { objectId: 'o12', sourceZone: 'FIRST_INSPECTION_ZONE', targetZone: 'FIRST_MAIN_DECK' }
  ]
}
```

则会出现以下问题：

- 结构过重
- 与真实命令 schema 过度耦合
- 容易把视图层做成“规则引擎镜像”

首版没有必要走到这一步。

### 8.4 推荐方案

首版推荐维持以下平衡点：

```ts
type ViewCommandHint = {
  command: string;
  enabled: boolean;
  reason?: string;
  scope?: {
    zoneKeys?: string[];
    objectIds?: string[];
  };
  params?: Record<string, unknown>;
};
```

设计结论：

- `scope.zoneKeys`
  用于说明命令当前作用在哪些区域
- `scope.objectIds`
  仅在需要对象级限制时返回
- `params`
  仅放少量当前窗口上下文，不放复杂规则树，也不承诺表达复杂效果条件的自动裁定结果

### 8.5 典型示例

#### Live 设置阶段

```ts
{
  command: 'SetLiveCard',
  enabled: true,
  scope: {
    zoneKeys: ['FIRST_HAND']
  }
}
```

表示：

- 当前允许盖放 Live
- 可操作对象来源于先攻手牌区

#### 检视区处理中

```ts
{
  command: 'MoveInspectedCardToBottom',
  enabled: true,
  scope: {
    zoneKeys: ['FIRST_INSPECTION_ZONE'],
    objectIds: ['o21', 'o22']
  }
}
```

```ts
{
  command: 'MoveInspectedCardToZone',
  enabled: true,
  scope: {
    zoneKeys: ['FIRST_INSPECTION_ZONE']
  }
}
```

```ts
{
  command: 'FinishInspection',
  enabled: false,
  reason: '仍有未处理的检视区卡牌'
}
```

#### 不是你操作的时候

```ts
{
  command: 'SetLiveCard',
  enabled: false,
  reason: '不是你的操作窗口'
}
```

### 8.6 首版建议约束

- 服务端只返回“当前相关的命令”，不必返回完整命令全集
- 对禁用命令，只需返回当前 UI 需要解释的关键项
- `scope.objectIds` 只在真的需要对象级限制时返回
- `params` 只放当前窗口必须知道的少量附加信息
- 首版不要求通过 `availableCommands` 自动表达“哪张牌符合复杂效果条件”或“某张牌能否因卡文理由进入某目标区”

---

## 9. `uiHints` 部分

`uiHints` 不是规则真值，但可用于降低前端拼装成本。

建议只放轻量辅助信息，例如：

```ts
type UiHintViewState = {
  pendingDeclarations?: ViewPendingDeclaration[];
  lastPublicEvents?: ViewPublicEventRef[];
};
```

适合放的内容：

- 最近几条公共事件引用
- 当前有哪些确认型动作还未完成
- 某些日志或按钮文案可直接使用的提示

不建议放的内容：

- 会和权威状态重复的结构化真值

---

## 10. `ViewWindowState` 建议

由于联机首版已引入窗口模型，`PlayerViewState` 应直接包含窗口状态。

```ts
type ViewWindowState = {
  windowType:
    | 'SERIAL_PRIORITY'
    | 'INSPECTION'
    | 'SIMULTANEOUS_COMMIT'
    | 'SHARED_CONFIRM';
  status: 'OPENED' | 'UPDATED' | 'CLOSED';
  actingSeat?: 'FIRST' | 'SECOND';
  waitingSeats: ('FIRST' | 'SECOND')[];
  context?: {
    inspectionId?: string;
    sourceZone?: string;
    sourceCount?: number;
  };
};
```

这里尤其重要的是：

- 前端不需要自己猜当前是否正处于检视流程中
- 当前检视窗口是否还未结束，应直接由服务端视图给出

补充约束：

- 检视流程使用独立的 `INSPECTION` 窗口类型。
- 若当前处于检视流程，`context.inspectionId/sourceZone/sourceCount` 可作为检视窗口补充上下文。
- 这样前端不需要从其它窗口类型中再额外猜测“当前是不是检视流程”。

---

## 11. 与当前 `GameState` 的关系

当前 [game.ts](/root/loveca/src/domain/entities/game.ts)、[player.ts](/root/loveca/src/domain/entities/player.ts)、[zone.ts](/root/loveca/src/domain/entities/zone.ts) 的结构，更适合服务端规则执行与持久化。

它们的特点是：

- 按玩家分组区域
- 区域结构偏权威存储
- 没有显式观察者投影层
- 没有共享对象表
- 没有视图级窗口与权限结构

因此：

- `AuthoritativeGameState` 可以继续保持偏规则执行结构
- `PlayerViewState` 不建议强行与当前 `GameState` 同构

更准确的关系应是：

`AuthoritativeGameState -> ProjectBySeat -> PlayerViewState`

而不是：

`GameState minus hidden fields = PlayerViewState`

---

## 12. 与 `detail_rules.md` 的关系

### 12.1 可直接对应的规则点

以下规则点可直接映射到视图模型：

- 4.1.2.2 各领域卡牌数量始终公开
- 4.1.3 某些领域有顺序管理
- 4.3.2 / 4.3.3 卡牌有方向状态和展示面状态
- 4.5 成员区为槽位型公开区
- 4.6 Live 放置区为公开区，但可临时里侧
- 4.8 主卡组为非公开领域且有顺序管理

### 12.2 与联机实现约定存在偏差的规则点

以下规则原文与当前联机实现约定存在差异，需要显式记为“联机建模约定”：

- 4.9.2 原文写能量卡组不进行顺序管理
- 4.11.2 原文写手牌不进行顺序管理

但当前联机设计为了：

- 保持共享牌桌对象模型一致
- 在服务端内部保留稳定对象真值
- 降低事件流和恢复逻辑复杂度

建议在实现层仍给这些区域维护稳定的对象序列和索引。

这并不意味着规则层面强制玩家“宣告手牌顺序有额外意义”，而是：

- 联机实现层允许其存在稳定位置真值，但该真值不必对非持有者投影为可持续跟踪的公共对象身份

---

## 13. 建议的最小类型草图

```ts
type PlayerViewState = {
  match: {
    matchId: string;
    viewerSeat: 'FIRST' | 'SECOND';
    turnCount: number;
    phase: string;
    subPhase: string;
    activeSeat: 'FIRST' | 'SECOND' | null;
    prioritySeat?: 'FIRST' | 'SECOND' | null;
    window?: ViewWindowState | null;
    seq: number;
  };
  table: {
    zones: Record<string, ViewZoneState>;
  };
  objects: Record<string, ViewCardObject>;
  permissions: {
    availableCommands: ViewCommandHint[];
  };
  uiHints?: UiHintViewState;
};
```

这版草图的重点不是字段名最终锁死，而是结构关系：

- 区域表
- 对象表
- 窗口状态
- 命令权限

这四个部分缺一不可。

---

## 14. 当前建议的实现方向

联机首版建议按以下方式演进：

1. 保持 `AuthoritativeGameState` 服务端优先，不强行改成前端友好结构。
2. 新增按 seat 投影的 `PlayerViewState` 构造层。
3. 先让 `PlayerViewState` 稳定覆盖：
   - 区域占位
   - `surface`
   - `frontInfo`
   - 窗口
   - 可用命令
4. 再让前端逐步从“本地规则推断”切换到“服务端视图驱动”。

---

## 15. 当前仍待讨论的问题

1. 检视窗口中的“还有哪些牌未处理”是否应显式放进 `window.context`。
2. `uiHints` 是否首版就需要，还是先完全依赖 `match + table + objects + permissions`。
