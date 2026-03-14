# Loveca 游戏系统设计文档

---

## 第一部分：游戏规则逻辑整理

### 1. 游戏概述 (Game Overview)

| 属性       | 描述                                                   |
| ---------- | ------------------------------------------------------ |
| **游戏名称** | Loveca                                                 |
| **对战人数** | 2 人                                                   |
| **胜利条件** | 率先使"成功 Live 放置区"达到 **3 张卡牌**的玩家获胜      |
| **核心主题** | 偶像 Live 表演竞技                                       |

---

### 2. 卡牌系统 (Card System)

游戏中有三种基本卡牌类型，各司其职：

| 卡牌类型   | 功能                         | 关键属性                                   |
| ---------- | ---------------------------- | ------------------------------------------ |
| **成员卡** | 部署至舞台，提供 Heart 资源    | `费用 (Cost)`, `Heart`, `Blade`, `Blade Heart` |
| **Live 卡** | Live 目标，判定成功后计分     | `分数 (Score)`, `所需 Heart (Required Hearts)` |
| **能量卡** | 资源卡，用于支付成员费用       | —                                          |

#### 2.1 Heart 图标详解

Heart 是 Live 成功判定的核心资源。

*   **六色 Heart**: 桃、红、黄、绿、蓝、紫。
*   **万能 Heart (Rainbow)**: 可视为任意颜色。

#### 2.2 Blade 与 Cheer 机制

*   **Blade**: 成员卡上的数值，决定 Cheer 时从卡组顶端公开多少张卡。
*   **Blade Heart**: 公开卡牌上的图标，提供额外 Heart 资源或抽牌效果。

---

### 3. 区域系统 (Zone System)

游戏设定了多个功能区域，分为**公开区域**和**非公开区域**。

| 区域名称           | 可见性   | 顺序管理 | 描述                                       |
| ------------------ | -------- | -------- | ------------------------------------------ |
| **成员区域 (Stage)** | 公开     | 否       | 包含 3 个槽位：左、中、右。放置出战成员。     |
| **Live 放置区**      | 公开/隐藏 | 否       | 本回合正在进行判定的 Live 卡。              |
| **成功 Live 放置区** | 公开     | 是       | 成功 Live 的记录堆，达到 3 张即获胜。        |
| **能量放置区**       | 公开     | 否       | 能量卡资源池，卡牌有 活跃/待机 两种状态。     |
| **主卡组放置区**     | 非公开   | 是       | 成员卡 + Live 卡的抽卡堆。                   |
| **能量卡组放置区**   | 非公开   | 否       | 能量卡的补充堆。                             |
| **手牌**           | 非公开   | 否       | 玩家持有的卡牌，仅自己可见。                 |
| **休息室**         | 公开     | 否       | 弃牌堆 / 墓地。                              |
| **除外区域**       | 公开     | 否       | 从游戏中移除的卡牌。                         |
| **解决区域**       | 公开     | 否       | 临时区域，用于 Cheer 结算和能力解决。         |

---

### 4. 回合结构与流程 (Game Loop)

每回合由两个**通常阶段** (先攻 + 后攻) 和一个共享的 **Live 阶段**组成。

```
回合开始
├── 先攻通常阶段
│   ├── 活跃阶段: 恢复所有能量至活跃状态
│   ├── 能量阶段: 从能量卡组补充 1 张能量
│   ├── 抽卡阶段: 抽 1 张卡
│   └── 主要阶段: 部署成员 / 发动触发能力 (可多次)
│
├── 后攻通常阶段 (同上)
│
└── Live 阶段
    ├── Live 卡放置阶段: 双方秘密埋伏 Live 卡
    ├── 先攻表演阶段: 揭示 Live 卡 → Cheer → 判定
    ├── 后攻表演阶段 (同上)
    └── Live 胜负判定阶段: 比较分数，移动成功卡牌
```

---

### 5. Live 判定核心逻辑 (Live Resolution)

#### 5.1 Heart 计算

`Live 所有 Heart` = Σ(成员 Heart) + Σ(Cheer 公开卡的 Blade Heart)

#### 5.2 成功判定

对于每张 Live 卡的 `所需 Heart`：
1.  检查是否有足够数量的**对应颜色** Heart。
2.  检查 Heart **总数**是否满足要求。
3.  满足条件时，从 `Live 所有 Heart` 中扣除消耗。

> **Rainbow Heart** 可在此过程中动态指派为任意颜色。

#### 5.3 分数计算与胜负

*   `Live 分数` = Σ(成功 Live 卡的分数) + Cheer 加成
*   分数高者获得本回合 **Live 胜利**，可将一张 Live 卡移入成功区。

---

### 6. 能力与效果系统 (Ability & Effect)

| 能力类型     | 触发方式                         | 示例                           |
| ------------ | -------------------------------- | ------------------------------ |
| **触发能力** | 玩家在"播放时机"主动支付成本发动   | `[支付1]: 抽1张卡`              |
| **自动能力** | 满足特定条件时自动进入待命状态     | `【登场】当该卡进入舞台时...`   |
| **常驻能力** | 持续生效，无需播放               | `你的其他成员 Blade +1`         |

#### 6.1 检查时机 (Check Timing)

在游戏关键点（阶段切换、动作完成后）触发：
1.  处理所有**规则处理** (如卡组刷新、非法卡牌清理)。
2.  按优先级解决**自动能力** (主动玩家优先)。

---

### 7. 特殊规则与处理

*   **刷新 (Refresh)**: 当卡组为空时，将休息室洗回卡组。
*   **接力传递 (Relay)**: 部署成员时，可将同一区域的旧成员送入休息室以减少费用。
*   **无限循环处理**: 若游戏陷入无法打破的循环，判定为平局。

---

---

## 第二部分：面向对象系统架构设计 (OOP Architecture)

本节以面向对象编程思想，将游戏系统抽象为可复用的类与模块。

---

### 1. 卡牌抽象层 (Card Abstraction Layer)

```
┌───────────────────────────────────────────────────────┐
│                      <<abstract>>                     │
│                        BaseCard                       │
├───────────────────────────────────────────────────────┤
│ - id: String                                          │
│ - name: String                                        │
│ - groupName: String (组合名)                           │
│ - unitName: String (小组名)                            │
│ - cardText: String                                    │
│ - cardType: CardType (Enum: MEMBER, LIVE, ENERGY)     │
│ - abilities: List<Ability>                            │
├───────────────────────────────────────────────────────┤
│ + getAbilities(): List<Ability>                       │
│ + isType(CardType): Boolean                           │
└───────────────────────────────────────────────────────┘
             ▲                  ▲                  ▲
             │                  │                  │
    ┌────────┴────────┐ ┌──────┴──────┐ ┌─────────┴─────────┐
    │   MemberCard    │ │  LiveCard   │ │    EnergyCard     │
    ├─────────────────┤ ├─────────────┤ ├───────────────────┤
    │ - cost: Int     │ │ - score: Int│ │ (无额外属性)       │
    │ - blade: Int    │ │ - required  │ │                   │
    │ - hearts: List  │ │   Hearts:   │ │                   │
    │   <HeartIcon>   │ │   HeartReq  │ │                   │
    │ - bladeHeart:   │ │             │ │                   │
    │   BladeHeart    │ │             │ │                   │
    └─────────────────┘ └─────────────┘ └───────────────────┘
```

#### 支撑类型

```typescript
enum HeartColor { PINK, RED, YELLOW, GREEN, BLUE, PURPLE, RAINBOW }

class HeartIcon {
    color: HeartColor
    count: Int
}

class HeartRequirement {
    conditions: List<HeartIcon>  // 各颜色需求
    totalRequired: Int           // 总数需求
    
    isSatisfiedBy(pool: HeartPool): Boolean
}

enum BladeHeartEffect { DRAW, ADD_HEART_PINK, ADD_HEART_RED, ... }
```

---

### 2. 区域与容器层 (Zone & Container Layer)

```
┌─────────────────────────────────────────────────┐
│                  <<abstract>>                   │
│                      Zone                       │
├─────────────────────────────────────────────────┤
│ - cards: List<Card>                             │
│ - owner: Player                                 │
│ - visibility: Visibility (PUBLIC / PRIVATE)    │
│ - isOrdered: Boolean                            │
├─────────────────────────────────────────────────┤
│ + add(card: Card, position?: Int): void         │
│ + remove(card: Card): Card                      │
│ + getCount(): Int                               │
│ + peek(count: Int): List<Card>                  │
│ + shuffle(): void                               │
└─────────────────────────────────────────────────┘
                     ▲
      ┌──────────────┼──────────────┬────────────────┐
      │              │              │                │
┌─────┴─────┐ ┌──────┴─────┐ ┌──────┴──────┐ ┌───────┴───────┐
│ DeckZone  │ │ HandZone   │ │ SlotZone    │ │ EnergyZone    │
│ (ordered) │ │ (private)  │ │ (3 slots)   │ │ (with state)  │
└───────────┘ └────────────┘ └─────────────┘ └───────────────┘
```

#### SlotZone 特化 (成员区域)

```typescript
enum SlotPosition { LEFT, CENTER, RIGHT }

class MemberSlotZone extends Zone {
    slots: Map<SlotPosition, MemberCard | null>
    
    placeAt(position: SlotPosition, card: MemberCard): void
    removeAt(position: SlotPosition): MemberCard
    getAdjacent(position: SlotPosition): List<SlotPosition>
}
```

#### EnergyZone 特化

```typescript
enum EnergyState { ACTIVE, WAITING }

class EnergyZone extends Zone {
    cardStates: Map<EnergyCard, EnergyState>
    
    tap(card: EnergyCard): void        // 切换至 WAITING
    untapAll(): void                    // 全部恢复至 ACTIVE
    getActiveCount(): Int
}
```

---

### 3. 玩家状态层 (Player State Layer)

```typescript
class Player {
    id: String
    name: String
    isFirstPlayer: Boolean  // 先攻/后攻标识
    
    // 区域容器
    deck: DeckZone
    energyDeck: DeckZone
    hand: HandZone
    memberZone: MemberSlotZone
    energyZone: EnergyZone
    liveZone: Zone
    successZone: Zone
    waitingRoom: Zone
    exileZone: Zone
    
    // 核心方法
    draw(count: Int): List<Card>
    shuffleDeck(): void
    payCost(amount: Int): Boolean
    performRelay(slot: SlotPosition, newCard: MemberCard): Int  // 返回减免费用
    
    // 状态查询
    getSuccessLiveCount(): Int
    hasWon(): Boolean { return getSuccessLiveCount() >= 3 }
}
```

---

### 4. 游戏引擎与流程控制层 (Game Engine)

```typescript
enum GamePhase {
    // 通常阶段
    ACTIVE_PHASE,
    ENERGY_PHASE,
    DRAW_PHASE,
    MAIN_PHASE,
    // Live 阶段
    LIVE_SET_PHASE,
    PERFORMANCE_PHASE,
    LIVE_RESULT_PHASE
}

class GameManager {
    players: [Player, Player]
    activePlayerIndex: Int
    currentPhase: GamePhase
    turnCount: Int
    
    // 流程控制
    startGame(): void
    nextPhase(): void
    endTurn(): void
    
    // 核心逻辑
    getActivePlayer(): Player
    getNonActivePlayer(): Player
    switchFirstPlayer(): void
    
    // 检查时机处理器
    handleCheckTiming(): void {
        processRuleActions()
        while (hasPendingAutoAbilities()) {
            resolveAutoAbilities()
            processRuleActions()
        }
    }
    
    // 规则处理
    processRuleActions(): void {
        checkRefresh()
        checkVictory()
        checkIllegalCards()
    }
}
```

---

### 5. 能力与效果系统 (Ability & Effect System)

```
┌────────────────────────────────────────────────────────┐
│                    <<interface>>                       │
│                       Ability                          │
├────────────────────────────────────────────────────────┤
│ + getSource(): Card                                    │
│ + canActivate(context: GameContext): Boolean           │
│ + resolve(context: GameContext): void                  │
└────────────────────────────────────────────────────────┘
                        ▲
         ┌──────────────┼──────────────┐
         │              │              │
┌────────┴───────┐ ┌────┴────┐ ┌───────┴───────┐
│ ActivatedAbility│ │AutoAbility│ │ StaticAbility │
│ (触发能力)      │ │ (自动能力) │ │ (常驻能力)    │
├────────────────┤ ├──────────┤ ├───────────────┤
│ - cost: Cost   │ │ - trigger│ │ - effect:     │
│ - effect:      │ │   Cond.  │ │   Continuous  │
│   Effect       │ │ - effect │ │   Effect      │
└────────────────┘ └──────────┘ └───────────────┘
```

#### 自动能力触发系统

```typescript
enum TriggerCondition {
    ON_ENTER_STAGE,       // 登场
    ON_LIVE_START,        // Live 开始时
    ON_LIVE_SUCCESS,      // Live 成功时
    ON_TURN_START,        // 回合开始时
    ON_TURN_END,          // 回合结束时
    ON_CHEER,             // Cheer 时
    // ...
}

class AutoAbility implements Ability {
    triggerCondition: TriggerCondition
    effect: Effect
    isPending: Boolean = false  // 待命状态
    
    checkTrigger(event: GameEvent): void {
        if (event.matches(triggerCondition)) {
            isPending = true
        }
    }
}
```

#### 效果类型

```typescript
abstract class Effect {
    abstract apply(context: GameContext): void
}

class OneTimeEffect extends Effect {
    // 一次性效果：抽卡、移动卡牌等
}

class ContinuousEffect extends Effect {
    duration: Duration (TURN_END | GAME_END | UNTIL_LEAVE)
    modifiers: List<Modifier>
}

class ReplacementEffect extends Effect {
    originalEvent: EventType
    replacementAction: () => void
}
```

---

### 6. Live 判定模块 (Live Resolution Module)

```typescript
class HeartPool {
    hearts: Map<HeartColor, Int>
    rainbowCount: Int
    
    addHeart(color: HeartColor, count: Int): void
    getTotalCount(): Int
    canSatisfy(requirement: HeartRequirement): Boolean
    consume(requirement: HeartRequirement): Boolean  // 满足并扣除
}

class LiveResolver {
    performCheer(player: Player): CheerResult {
        totalBlade = player.memberZone.slots.values()
            .filter(c => c != null)
            .map(c => c.blade)
            .sum()
        
        revealedCards = player.deck.peek(totalBlade)
        // 移动至解决区域，处理 BladeHeart 效果
        return CheerResult(revealedCards, heartGained, cardsDrawn)
    }
    
    calculateLiveHearts(player: Player, cheerResult: CheerResult): HeartPool {
        pool = new HeartPool()
        // 合计成员 Heart
        for (member in player.memberZone.getAll()) {
            pool.addHearts(member.hearts)
        }
        // 合计 Cheer Heart
        pool.addHearts(cheerResult.heartGained)
        return pool
    }
    
    judgeLive(liveCard: LiveCard, pool: HeartPool): Boolean {
        return pool.canSatisfy(liveCard.requiredHearts)
    }
    
    calculateScore(player: Player, successCards: List<LiveCard>, cheerBonus: Int): Int {
        return successCards.map(c => c.score).sum() + cheerBonus
    }
}
```

---

### 7. 系统交互示意图 (System Interaction)

```
┌───────────────────────────────────────────────────────────────────┐
│                          GameManager                              │
│   (状态机驱动回合流程, 调度 CheckTiming)                            │
└───────────────────────────────────┬───────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌─────────────────┐      ┌──────────────────┐       ┌─────────────────┐
│     Player      │      │   AbilitySystem  │       │  LiveResolver   │
│ (状态 + 区域)    │◄────►│ (能力触发与解决)  │◄─────►│ (Live 判定逻辑) │
└─────────────────┘      └──────────────────┘       └─────────────────┘
         │                                                   │
         └───────────────────────┬───────────────────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │    Zone / Card Layer  │
                     │  (数据模型 + 容器操作)  │
                     └───────────────────────┘
```

---

## 附录

### A. 枚举汇总

```typescript
enum CardType { MEMBER, LIVE, ENERGY }
enum HeartColor { PINK, RED, YELLOW, GREEN, BLUE, PURPLE, RAINBOW }
enum SlotPosition { LEFT, CENTER, RIGHT }
enum EnergyState { ACTIVE, WAITING }
enum Visibility { PUBLIC, PRIVATE }
enum GamePhase { ACTIVE_PHASE, ENERGY_PHASE, DRAW_PHASE, MAIN_PHASE, LIVE_SET_PHASE, PERFORMANCE_PHASE, LIVE_RESULT_PHASE }
enum TriggerCondition { ON_ENTER_STAGE, ON_LIVE_START, ON_LIVE_SUCCESS, ON_TURN_START, ON_TURN_END, ... }
```

### B. 卡组构筑规则

| 卡组类型   | 数量 | 内容                     |
| ---------- | ---- | ------------------------ |
| **主卡组** | 60张 | 48 张成员卡 + 12 张 Live 卡 |
| **能量卡组** | 12张 | 12 张能量卡               |

---

*文档版本: 1.0*
*基于 detail_rules.md 整理*
