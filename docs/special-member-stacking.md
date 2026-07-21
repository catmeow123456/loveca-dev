# 成员下方堆叠（memberBelow）

> 适用范围：卡牌效果创建的成员下方堆叠、生命周期、联机投影与 UI
> 最后更新：2026-07-18

`memberBelow` 记录每个成员槽位的顶层成员下方放置的成员卡实例。它不是可任意写入的通用区域，也不依赖 host 卡号白名单。

## 创建边界

- 新的 `memberBelow` 只能由已登记卡效 workflow 调用 `stackMemberCardBelowStageMember` 创建。
- helper 只允许 `HAND / WAITING_ROOM -> memberBelow`，每次移动 1 张成员卡。
- host 必须是该玩家舞台顶层 MEMBER，`hostCardId` 必须与 `targetSlot` 当前值匹配。
- moved card 必须属于该玩家、仍在声明来源区，且未位于任一 `memberBelow`。
- 不走普通登场、换手或费用支付，不创建 `ON_ENTER_STAGE` 或其他假触发。
- 手动压人命令链和 host 白名单已退役；普通 `MOVE_TABLE_CARD` / `MOVE_OWNED_CARD_TO_ZONE` 不能创建堆叠。
- 手牌成员拖到已有成员的槽位仍走 `PLAY_MEMBER_TO_SLOT` 的正常换手，舞台成员间仍走正常移动/交换。

这个 helper 不是任意区域移动 DSL；候选扫描、公开、交互、action audit 与 pending continuation 仍由各 workflow 负责。

## 生命周期

| 场景 | 行为 |
| --- | --- |
| 主成员移到其他槽位或交换 | `memberBelow` 跟随各自主成员 |
| 主成员离场或被换手替换 | 下方成员与主成员一并进入休息室 |
| 同槽位 `energyBelow` 随主成员离场 | 按原有规则返回能量卡组 |
| 卡效从下方将成员登场 | 只有明确 workflow 可调用窄 helper，并写真实登场事件 |
| 公开桌面自由拖出 | 保留现有从槽位状态移除的自由桌面行为 |

`memberBelow` 卡不计作舞台顶层成员，放入时不触发普通登场。

## 联机投影与 UI

- `memberBelow` 是公开桌面状态，projector 向双方投影真实卡牌与稳定公开标识。
- UI 只渲染权威投影，不提供创建 `memberBelow` 的拖拽提示或命令。
- 堆叠展示与 `energyBelow` 保持可视区分；不读取未投影隐藏信息。

## 连续能力扫描边界

普通 continuous collector 仍只扫描舞台顶层成员。只有明确登记为下方来源的 exact ability 才额外扫描 `memberBelow`；首个样本是 `PL!SP-bp7-001-P`，且只在 host 属于 Liella! 时为该 host 提供 BLADE。这不会自动开启其他下方卡的 continuous 能力。
