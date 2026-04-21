# Loveca 联机首版公共事件最小模型

> 文档类型：联机设计草案
> 适用范围：定义联机首版可安全下发给双方客户端、可直接驱动公共日志、基础动画和流程提示的最小公共事件集合。
> 最后更新：2026-04-02

---

## 1. 文档目标

本文档只定义：

- 双方都可以收到的 `Public Event`
- 首版最少需要哪些事件类型
- 这些事件的最小字段

本文档不定义：

- 私密事件字段
- 密封审计字段
- 服务端完整内部事件分类

它们分别由：

- [docs/online-mode-event-classification-draft.md](/root/loveca/docs/online-mode-event-classification-draft.md)
- [docs/online-mode-visibility-matrix.md](/root/loveca/docs/online-mode-visibility-matrix.md)

补充说明。

---

## 2. 设计原则

### 2.1 公共事件只描述公共可观察事实

公共事件应回答：

- 双方都看到了什么。
- 这个过程应如何进入公共日志和公共动画。

公共事件不应承担：

- 还原私密候选集
- 解释复杂卡文语义
- 替客户端重建完整权威状态

### 2.2 公共事件和快照分工明确

- 公共事件负责“发生了什么”。
- 玩家视角快照负责“现在公开世界长什么样”。

因此单条公共事件不必塞入过多静态牌面细节。

### 2.3 共享牌桌对象统一使用 `publicObjectId`

本轮整理后：

- 不再混用 `publicOccupantId`、`publicCardId`
- 公共事件中统一使用 `publicObjectId`

解释：

- 当对象只是一个可追踪的背面占位时，只带 `publicObjectId`
- 当对象已经公开到可识别牌面时，再额外附带公开牌面信息

补充约束：

- 在本轮讨论后的共享牌桌模型下，`publicObjectId` 不再只服务于“公开区特例”。
- 检视区、解决区、Live 放置区和各类公开区中的连续桌面对象，应优先使用稳定的共享对象标识。
- `publicObjectId` 可在服务端和公共链路中保持稳定；对象位于隐藏区期间，对非持有者可以暂时不投影该对象。
- 对象进入手牌、主卡组、能量卡组等隐藏混淆区后，对非持有者通常不持续显示该对象；对象之后重新进入公开链路时，首版可继续沿用同一个 `publicObjectId`。

---

## 3. 最小公共事件集合

联机首版建议先收口到以下 8 类公共事件：

1. `PhaseStarted`
2. `SubPhaseStarted`
3. `WindowStatusChanged`
4. `CardMovedPublic`
5. `CardsInspectedSummary`
6. `CardRevealed`
7. `CardRevealedAndMoved`
8. `PlayerDeclared`

这 8 类事件已经足够覆盖：

- 阶段切换
- 当前等待状态
- 共享牌桌对象移动
- 检视开始/进行中的公共摘要
- 公开展示
- 公开展示并移动
- 公开声明和流程确认

规则自动处理若会影响公共世界，应体现在上述事件流中，而不是额外先发明一整套新的公共事件家族。

补充说明：

- 在共享牌桌模型下，许多原本只想用摘要表达的流程，现在也会通过 `CardMovedPublic` 逐步表达对象移动过程。
- `CardsInspectedSummary` 应理解为日志友好的补充事件，而不应再承担“检视类流程唯一公共事实来源”的职责。

---

## 4. 通用字段

每个公共事件至少应带以下元数据：

- `eventId`
- `matchId`
- `seq`
- `timestamp`

必要时可补：

- `source`
  `PLAYER | SYSTEM`
- `actorSeat`

建议含义：

- `eventId`
  服务端生成的稳定事件 ID。
- `matchId`
  所属对局 ID。
- `seq`
  对局内严格递增的公共事件序号。
- `timestamp`
  服务端生成时间。
- `source`
  该事件由玩家动作直接产生，还是由系统规则处理产生。
- `actorSeat`
  对应的玩家座位；若是纯系统事件，可为空。

---

## 5. 公共字段片段

### 5.1 `PublicCardInfo`

```ts
type PublicCardInfo = {
  publicObjectId: string;
  cardCode?: string;
  name?: string;
  cardType?: string;
};
```

规则：

- 背面对象只要求 `publicObjectId`
- 正面公开对象可以补 `cardCode`、`name`、`cardType`

### 5.2 `PublicZoneRef`

```ts
type PublicZoneRef = {
  zone: string;
  ownerSeat?: 'FIRST' | 'SECOND';
  slot?: string;
  index?: number;
  overlayIndex?: number;
};
```

用途：

- 表达公共世界可见的位置来源和目标。
- 不要求在首版就和当前内部 `ZoneType` 一一对应，只需保持可映射。

补充约束：

- 检视区在公共事件中统一使用 `zone = INSPECTION_ZONE`。
- 若需要区分检视区属于哪一侧，则通过 `ownerSeat` 表达，而不是改用 `FIRST_INSPECTION_ZONE` / `SECOND_INSPECTION_ZONE` 这类视图层键名。
- 成员下方能量不单独编码为新的顶层 `zone`；统一表达为成员区槽位上的 overlay。
- 当目标位置是某个成员槽位下方的叠放位置时，使用 `zone = MEMBER_ZONE` + `slot` + `overlayIndex`。
- `index` 优先用于线性区域内的位置；`overlayIndex` 优先用于槽位下附着叠放的位置。

---

## 6. 各事件最小字段

### 6.1 `PhaseStarted`

用途：

- 通知主阶段变化。
- 作为公共时间轴锚点。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `phase`
- `activeSeat`
- `timestamp`

### 6.2 `SubPhaseStarted`

用途：

- 通知更细粒度的流程推进。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `subPhase`
- `activeSeat`
- `timestamp`

### 6.3 `WindowStatusChanged`

用途：

- 表达当前窗口类型和当前等待状态。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `windowType`
- `status`
- `actingSeat`
- `waitingSeats`
- `timestamp`

首版建议：

- `windowType` 收口为 `SERIAL_PRIORITY | INSPECTION | SIMULTANEOUS_COMMIT | SHARED_CONFIRM`
- `status` 收口为 `OPENED | UPDATED | CLOSED`

### 6.4 `CardMovedPublic`

用途：

- 表达公共世界里对象的出现、移动、同区换位或离场。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `source`
- `actorSeat`
- `card`
- `from`
- `to`
- `count`
- `timestamp`

字段说明：

- `card`
  当有单个共享牌桌对象可追踪时，使用 `PublicCardInfo`
- `count`
  当只需要摘要，不需要单卡对象时使用

约束：

- `card` 和 `count` 至少应有一个
- 在共享牌桌模型下，检视区、解决区、Live 放置区和各类公开区中的单卡移动，应优先带 `card.publicObjectId`
- 手牌、主卡组、能量卡组等隐藏混淆区相关移动，若对对手不需要保留对象级连续性，可只带 `count` 或更弱摘要
- 若某个已公开对象从公开区进入手牌、主卡组、能量卡组等私有或隐藏混淆区，则“进入目标区”这一步的 `CardMovedPublic` 首版仍可继续带原 `card.publicObjectId`；对象是在该事件之后，才从对手后续快照中消失
- 若移动的是背面对象，`card` 只带 `publicObjectId`
- `from.zone` 与 `to.zone` 可以相同；此时表示对象在同一区域内的顺序位置变化
- 当表达同区换位时，应优先使用 `from.index` 与 `to.index`

### 6.5 `CardsInspectedSummary`

用途：

- 表达“发生了私密检视”这一公共摘要。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `actorSeat`
- `sourceZone`
- `count`
- `timestamp`

说明：

- 不包含具体牌面
- 不包含候选顺序
- 不替代检视区对象进入、离开、重排等逐步公共移动事件
- 它是可选的日志友好补充事件，不是检视流程成立的必要条件，也不是首版必发事件

### 6.6 `CardRevealed`

用途：

- 某张牌被公开给双方看到，但不要求同时发生移动。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `source`
- `actorSeat`
- `card`
- `from`
- `reason`
- `timestamp`

### 6.7 `CardRevealedAndMoved`

用途：

- 某张牌被公开给双方看到，并在同一步里完成移动。

使用原则：

- 首版默认优先拆成 `CardMovedPublic` + `CardRevealed` 两步。
- 只有当“公开”和“移动”在规则语义与前端表现上都不需要区分先后时，才使用 `CardRevealedAndMoved`。
- 若该过程存在明确的中间公开状态、可被单独日志化的翻牌步骤，或前端需要区分“先进入某区、再翻开”，则不应使用复合事件。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `source`
- `actorSeat`
- `card`
- `from`
- `to`
- `reason`
- `timestamp`

适用示例：

- 公开加入手牌
- 翻开后进入公开区

不适用示例：

- 应援牌先以 `BACK` 进入解决区、再翻开
- Live 先盖放到公开占位、再翻开

### 6.8 `PlayerDeclared`

用途：

- 记录玩家的公开声明、确认和提交流程。

最少字段：

- `eventId`
- `matchId`
- `seq`
- `actorSeat`
- `declarationType`
- `publicValue`
- `timestamp`

适用示例：

- `MULLIGAN_SUBMITTED`
- `JUDGMENT_CONFIRMED`
- `SCORE_SUBMITTED`
- `STEP_CONFIRMED`
- `ENERGY_STATE_TOGGLED`

---

## 7. 示例：公开代价 + 检视区即时移动 + 公开加入手牌 + 其余入休息室

效果示例：

> 将 1 张手牌放入休息室：检视自己卡组顶 5 张牌。可将其中至多 1 张符合条件的牌公开并加入手牌，其余放入休息室。

若某玩家执行该流程，对手视角中的公共事件可以是：

1. `CardMovedPublic`
   - 从 `HAND` 到 `WAITING_ROOM`
   - 该牌已公开，因此 `card` 可带牌面信息

2. 可选：`CardsInspectedSummary`
   - `sourceZone = MAIN_DECK_TOP`
   - `count = 5`

3. `CardMovedPublic`
   - 5 个对象逐步从 `MAIN_DECK` 进入 `INSPECTION_ZONE`
   - 对手通常看到这些对象为 `BACK`

4. `CardRevealedAndMoved`
   - 从 `INSPECTION_ZONE` 到 `HAND`
   - `reason = REVEAL_AND_ADD_TO_HAND`

5. `CardMovedPublic`
   - 其余 4 个对象逐步从 `INSPECTION_ZONE` 到 `WAITING_ROOM`

这里公共事件表达的是逐步发生的牌桌过程事实。
当对象进入手牌时，“进入手牌”这一步的 `CardMovedPublic` 首版仍可继续带原 `publicObjectId`；在该事件之后，对非持有者可以不再持续看到该对象。若该牌之后重新进入公开链路，首版可继续沿用同一个 `publicObjectId`。

若该流程中玩家还在 `INSPECTION_ZONE` 内调整顺序，则也继续使用 `CardMovedPublic` 表达：

- `from.zone = INSPECTION_ZONE`
- `to.zone = INSPECTION_ZONE`
- `from.index` 与 `to.index` 不同

## 7.1 示例：应援翻牌进入解决区，再翻开

若某次应援处理要求逐张从主卡组顶抽出并公开，对手视角中的公共事件可以是：

1. `CardMovedPublic`
   - 从 `MAIN_DECK` 到 `RESOLUTION_ZONE`
   - `card` 只带 `publicObjectId`
   - 该对象此时通常为 `BACK`

2. `CardRevealed`
   - `from = RESOLUTION_ZONE`
   - 同一个 `publicObjectId`
   - `reason = CHEER_REVEAL`

3. 若后续该牌从解决区进入公开区，则继续用 `CardMovedPublic` 或 `CardRevealedAndMoved`

4. 若后续该牌从解决区进入手牌，则该次移动仍可带同一个 `publicObjectId`；在该事件之后，对非持有者可以不再持续看到该对象

5. 若后续该牌从解决区回到主卡组或能量卡组，则“进入目标区”这一步仍可带同一个 `publicObjectId`；在该事件之后，对非持有者可不再持续投影。若之后重新进入公开链路，首版可继续沿用同一个 `publicObjectId`

补充约束：

- 解决区内仅为阅读和排布的本地拖拽，不属于正式事件，不进入公共日志。

---

## 8. 与当前代码形状的差距

当前引擎更像“输入动作，返回新状态”。
联机公共日志需要的是“输入动作，返回新状态 + 公共事件流”。

因此首版落地公共事件的关键改造不是网络层，而是引擎输出层。

目标输出形状应逐步演进为：

```ts
type EngineResult = {
  authorityState: GameState;
  publicEvents: PublicEvent[];
  privateEventsBySeat: Partial<Record<'FIRST' | 'SECOND', unknown[]>>;
};
```

---

## 9. 本轮整理中解决掉的冲突

本轮已统一：

- `publicOccupantId` / `publicCardId` -> `publicObjectId`
- 公共世界主移动事件统一叫 `CardMovedPublic`
- “事件分类”和“公共事件 schema”不再写在同一份文档里

---

## 10. 仍待确认的问题

1. 是否需要在公共事件里统一保留 `source = SYSTEM`，用于前端明确标注系统自动处理。
2. 某些复合过程是否要坚持拆成多条公共事件，还是允许 `CardRevealedAndMoved` 这类复合事件存在。
3. 若未来支持观战，观战端是否复用同一套公共事件，还是额外补充裁判级公共摘要。

这些问题不会阻碍首版最小集合先落地。
