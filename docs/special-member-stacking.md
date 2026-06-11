# 特殊成员卡「夹」成员卡功能设计文档

> 文档类型：功能设计文档
> 适用范围：特殊成员卡下方堆叠成员卡的实现方案
> 当前状态：当前实现支持 memberBelow 堆叠、跟随移动和信任玩家撤回；不会自动把 memberBelow 移入休息室
> 最后更新：2026-04-29

## 1. 概述

官方规则中，成员区域支持在成员卡下方重叠能量卡（规则 4.5.5）。部分特殊成员卡拥有「可以将成员卡放在自己下方」的效果。本文档描述如何在系统中实现这种「成员卡下方再夹成员卡」的机制（以下简称 `memberBelow`）。

相关代码路径：

- `src/domain/entities/zone.ts` — 区域实体与操作函数
- `src/application/action-handlers/zone-operations.ts` — 区域操作辅助函数
- `src/application/action-handlers/phase-ten.handler.ts` — 手动移动卡牌处理器
- `src/application/game-session.ts` — 游戏会话与命令处理
- `src/online/projector.ts` — 联机视图投影
- `client/src/components/game/PlayerArea.tsx` — 前端成员区域渲染
- `client/src/components/game/GameBoard.tsx` — 前端拖拽处理

## 2. 涉及的特殊卡牌

以下卡号模式的成员卡支持在其下方堆叠成员卡：

| 卡号模式          | 说明                      |
| ----------------- | ------------------------- |
| `PL!-bp6-003-*`   | 特殊成员卡（bp6 系列）    |
| `PL!HS-pb1-002-*` | 特殊成员卡（HS pb1 系列） |
| `PL!N-PR-026-*`   | 特殊成员卡（N PR 系列）   |

其中 `*` 为通配符，代表最终编号段。检测函数 `isSpecialMemberCard(cardCode)` 用正则匹配上述模式。

## 3. 功能需求

### 3.1 堆叠行为

- **来源区域**：手牌（HAND）或休息室（WAITING_ROOM）
- **目标区域**：已有特殊成员卡的成员槽位（MEMBER_SLOT）
- **堆叠层数**：不限制
- **可用窗口**：所有允许己方桌面自由拖拽的窗口（与 energyBelow 相同的时机）
- **拖动权限**：与 energyBelow 一致——所有己方桌面自由拖拽窗口可操作，具体窗口以 `isOwnDeskFreeDragWindow()` / `requiresUserAction` 为准

### 3.2 信任玩家：撤回误操作

「信任玩家」原则下，memberBelow 中的成员卡可以拖回手牌。这是一种适当的规则边界跨越——玩家在彼此信任的基础上，通过自由拖拽撤回误操作。

| 操作                          | 说明                                       |
| ----------------------------- | ------------------------------------------ |
| memberBelow 中的成员卡 → 手牌 | 自由拖拽窗口可成功，用于撤回误堆叠的成员卡 |

这不同于标准的规则流程，但符合当前「信任玩家」的设计哲学：系统在自由拖拽窗口内接受这类操作，不强制阻止玩家自行纠正误操作。

### 3.3 跟随与清理规则（对齐当前 energyBelow 跟随模型）

| 场景                                      | memberBelow 行为                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 特殊成员从槽位 A 移到槽位 B               | memberBelow 跟随成员一起移动                                                                                     |
| 特殊成员从槽位 A 换到槽位 B（B 也有成员） | 双方 memberBelow 随各自成员交换                                                                                  |
| 特殊成员离开成员区（到休息室等）          | memberBelow 卡牌留在槽位，不随主成员移走；玩家可手动拖回手牌或休息室；若新成员占据该槽位则继承已有的 memberBelow |
| memberBelow 中的成员卡被拖走              | 从 memberBelow 中移除，进入目标区域                                                                              |

### 3.4 渲染

- 堆叠成员卡以偏移方式显示在特殊成员卡下方
- 偏移方向为右下方（与 energyBelow 的左下方区分）
- 使用 amber 色边框（与 energyBelow 的 indigo 色区分）
- 显示堆叠数量指示器

## 4. 数据结构变更

### 4.1 `MemberSlotZoneState`（`src/domain/entities/zone.ts`）

新增字段，与 `energyBelow` 并行：

```typescript
readonly memberBelow: Readonly<Record<SlotPosition, readonly string[]>>;
```

### 4.2 `ViewZoneState`（`src/online/types.ts`）

新增可选字段：

```typescript
readonly memberBelow?: Readonly<Record<string, readonly string[]>>;
```

### 4.3 `ZoneAddOptions`（`src/application/action-handlers/zone-operations.ts`）

新增可选标志：

```typescript
asMemberBelow?: boolean;
```

### 4.4 `MoveOwnedCardToZoneCommand`（`src/application/game-commands.ts`）

新增可选字段：

```typescript
readonly asMemberBelow?: boolean;
```

## 5. 新增函数

### 5.1 区域操作函数（`src/domain/entities/zone.ts`）

| 函数名                                            | 作用                                        |
| ------------------------------------------------- | ------------------------------------------- |
| `addMemberBelowMember(zone, position, cardId)`    | 向指定槽位下方添加成员卡                    |
| `removeMemberBelowMember(zone, position, cardId)` | 从指定槽位下方移除成员卡                    |
| `getMemberBelowMember(zone, position)`            | 获取指定槽位下方的成员卡列表                |
| `findMemberBelowSlot(zone, cardId)`               | 查找成员卡在哪个槽位的 memberBelow 中       |
| `moveMemberBelowWithMember(zone, from, to)`       | 成员移动时同步移动 memberBelow              |
| `popMemberBelowMember(zone, position)`            | 清空并返回 memberBelow 卡牌列表             |
| `getAllMemberBelowIds(zone)`                      | 获取所有槽位的 memberBelow 卡牌（扁平列表） |

### 5.2 共享工具函数（`src/shared/utils/card-code.ts`，新建）

| 函数名                          | 作用                       |
| ------------------------------- | -------------------------- |
| `isSpecialMemberCard(cardCode)` | 判断卡号是否属于特殊成员卡 |

## 6. 操作流程

### 6.1 拖拽堆叠成员卡

```
用户拖拽（手牌/休息室中的成员卡）
  → 落到已有特殊成员卡的成员槽位
    → GameBoard.tsx 检测目标槽位成员卡号
      → 匹配特殊卡号模式 → 走 asMemberBelow 路径
      → 不匹配 → 走正常的 playMemberToSlot（换手）
    → GameSession 收到命令 → validate → apply → emit events → project view
```

### 6.2 特殊成员换位（携带 memberBelow）

```
用户拖拽（特殊成员卡从槽位A → 槽位B）
  → moveCardUniversal 检测 MEMBER_SLOT → MEMBER_SLOT 移动
    → 同步移动 energyBelow（已有逻辑）
    → 同步移动 memberBelow（新增逻辑）
```

### 6.3 特殊成员被换手

```
用户将普通成员卡拖到已有特殊成员（及其 memberBelow）的槽位
  → 特殊成员被移至休息室
  → memberBelow 卡牌留在槽位（不跟随被换走的成员）
  → 新成员卡占据槽位，memberBelow 现在位于新成员下方
```

### 6.4 堆叠成员卡拖回手牌（信任玩家）

```
用户拖拽（memberBelow 中的成员卡）
  → 落到己方手牌区
    → GameBoard.tsx 检测来源为 memberBelow、目标为 HAND
    → 走 movePublicCardToHand 路径 → 服务端接受
```

## 7. 联机投影

`addMemberSlotZones`（`src/online/projector.ts`）在投影成员槽位时，需要将 `memberBelow` 卡牌作为独立对象投影：

- 在 `ViewZoneState` 中添加 `memberBelow` 字段
- 为每张 memberBelow 卡牌创建 `ViewCardObject`（与 energyBelow 卡牌相同的方式）
- 双方玩家均可看到 memberBelow 卡牌（公开区域）

## 8. 撤销支持

现有的 `handleUndoOperation` 逻辑不需要额外修改：

- 反向移动时，`removeCardFromPlayerZone` 的 `MEMBER_SLOT_ACCESSOR.remove` 会从 `memberBelow` 中找到并移除卡牌
- `addCardToPlayerZone` 会将卡牌加回原区域（HAND 或 WAITING_ROOM）

## 9. 自由拖拽权限表更新

在 `docs/online-mode-free-drag-checklist.md` 中新增：

| 编号 | 操作                                    | 当前预期                               |
| ---- | --------------------------------------- | -------------------------------------- |
| D-20 | 己方手牌/休息室成员卡 → 特殊成员卡下方  | 自由拖拽窗口可成功，正式堆叠           |
| D-21 | 成员下方堆叠成员卡 → 另一个成员槽位下方 | 自由拖拽窗口可成功，正式重附着         |
| D-22 | 成员下方堆叠成员卡 → 休息室             | 自由拖拽窗口可成功，正式进入休息室     |
| D-23 | 成员下方堆叠成员卡 → 手牌               | 自由拖拽窗口可成功，信任玩家撤回误操作 |

对应的最小回归集新增：

| 编号 | 场景                             | 期望                           |
| ---- | -------------------------------- | ------------------------------ |
| R-18 | 手牌成员卡拖到特殊成员下方       | 当前允许窗口可成功堆叠         |
| R-19 | 堆叠成员卡拖到另一个成员槽位下方 | 当前允许窗口可成功重附着       |
| R-20 | 堆叠成员卡拖到休息室             | 当前允许窗口可成功             |
| R-21 | 堆叠成员卡拖回手牌               | 当前允许窗口可成功（信任玩家） |

## 10. 与 energyBelow 的对比

| 维度                   | energyBelow                 | memberBelow                  |
| ---------------------- | --------------------------- | ---------------------------- |
| 可堆叠卡牌类型         | 仅能量卡                    | 仅成员卡                     |
| 来源区域               | 能量区、能量卡组            | 手牌、休息室                 |
| 目标要求               | 槽位有任意成员卡            | 槽位有特殊成员卡             |
| 跟随移动               | 是                          | 是                           |
| 离开成员区时的处理     | 主成员离槽位时当前通用移动会留在槽位；规则自动清理不作为主流程强制事实 | 留在槽位，不会自动移入休息室 |
| 可拖回手牌（信任玩家） | 否                          | 是                           |
| 堆叠层数限制           | 无                          | 无                           |
| UI 颜色                | indigo 色边框               | amber 色边框                 |
| UI 偏移方向            | 左下方                      | 右下方                       |

## 11. 实现步骤概要

1. **Domain 层** — `zone.ts` 新增 `memberBelow` 字段及操作函数
2. **共享工具** — `card-code.ts` 新建 `isSpecialMemberCard`
3. **联机投影** — `types.ts` + `projector.ts` 投影 memberBelow 数据
4. **区域操作** — `zone-operations.ts` 新增 `asMemberBelow` 选项
5. **手动移动** — `phase-ten.handler.ts` 检测特殊成员
6. **游戏命令** — `game-commands.ts` 新增字段
7. **游戏会话** — `game-session.ts` 跟随事件
8. **客户端 store** — `gameStore.ts` 新增 selector
9. **前端拖拽** — `GameBoard.tsx` 特殊成员检测
10. **前端渲染** — `PlayerArea.tsx` 渲染 memberBelow 卡牌
