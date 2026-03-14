# Loveca 后端开发规范文档

> 版本: 1.0.0  
> 基于 detail_rules.md 与 game_system_design.md 编制

---

## 1. 项目概述

本项目旨在实现 Loveca 卡牌游戏的后端逻辑，支持双人对战。后端需要精确实现游戏规则中的所有机制，包括卡牌播放、能力触发、Live 判定等核心系统。

### 1.1 技术栈

| 类别 | 技术选型 | 说明 |
|------|----------|------|
| 语言 | TypeScript 5.x | 强类型保证游戏逻辑的严密性 |
| 运行时 | Node.js 20+ | LTS 版本 |
| 包管理 | pnpm | 高效的依赖管理 |
| 测试框架 | Vitest | 快速的单元测试 |
| 代码规范 | ESLint + Prettier | 统一代码风格 |
| 数据验证 | Zod | 运行时类型验证 |

### 1.2 项目结构

```
loveca/
├── docs/                          # 文档目录
│   ├── development_specification.md
│   └── api/                       # API 文档
├── src/
│   ├── domain/                    # 领域层（核心业务逻辑）
│   │   ├── entities/              # 实体定义
│   │   │   ├── card.ts            # 卡牌抽象
│   │   │   ├── player.ts          # 玩家状态
│   │   │   ├── game.ts            # 游戏状态
│   │   │   └── zone.ts            # 区域定义
│   │   ├── value-objects/         # 值对象
│   │   │   ├── heart.ts           # Heart 图标
│   │   │   └── ability.ts         # 能力定义 (旧版)
│   │   ├── rules/                 # 规则逻辑
│   │   │   ├── live-resolver.ts   # Live 判定
│   │   │   ├── cost-calculator.ts # 费用计算
│   │   │   └── check-timing.ts    # 检查时机
│   │   └── events/                # 游戏事件
│   │       └── game-events.ts
│   ├── application/               # 应用层
│   │   ├── game-service.ts        # 游戏服务
│   │   └── action-handlers/       # 动作处理器
│   ├── infrastructure/            # 基础设施层
│   │   ├── repositories/          # 数据存储
│   │   └── networking/            # 网络通信
│   └── shared/                    # 共享模块
│       ├── types/                 # 类型定义
│       │   └── enums.ts
│       ├── phase-config/          # 阶段配置系统 (单一数据源)
│       │   ├── index.ts           # 导出入口
│       │   ├── types.ts           # 配置类型定义
│       │   ├── phase-registry.ts  # 主阶段配置 (10 个 GamePhase)
│       │   ├── sub-phase-registry.ts # 子阶段配置 (23 个 SubPhase)
│       │   └── active-player.ts   # 统一的当前行动玩家判断
│       └── utils/                 # 工具函数
├── tests/                         # 测试目录
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. 核心设计原则

### 2.1 不可变状态 (Immutable State)

所有游戏状态的变更必须通过创建新对象实现，禁止直接修改现有对象。

```typescript
// ❌ 错误示例
player.hand.push(card);

// ✅ 正确示例
const newHand = [...player.hand, card];
const newPlayer = { ...player, hand: newHand };
```

**理由**：
- 便于实现悔棋/回放功能
- 简化断线重连的状态同步
- 避免意外的状态污染

### 2.2 原子化动作 (Atomic Actions)

所有游戏操作必须拆解为最小粒度的原子动作。

```typescript
// 原子动作类型示例
type AtomicAction =
  | { type: 'MOVE_CARD'; from: ZoneRef; to: ZoneRef; cardId: string }
  | { type: 'CHANGE_CARD_STATE'; cardId: string; state: CardState }
  | { type: 'SET_PLAYER_FLAG'; playerId: string; flag: string; value: boolean }
  | { type: 'INCREMENT_COUNTER'; target: string; amount: number };
```

### 2.3 事件驱动的能力系统

使用发布-订阅模式处理能力触发：

```typescript
// 事件定义
interface GameEvent {
  type: EventType;
  payload: unknown;
  timestamp: number;
}

// 能力监听器
interface AbilityListener {
  condition: TriggerCondition;
  handler: (event: GameEvent, context: GameContext) => void;
}
```

### 2.4 阶段配置注册表 (Phase Config Registry)

为解决阶段/子阶段元数据分散的问题，项目采用**单一数据源**的配置系统。

#### 2.4.1 设计目标

- **集中管理**：所有阶段元数据（名称、图标、颜色、行为）定义在一处
- **类型安全**：使用 `Record<GamePhase, PhaseConfig>` 确保 TypeScript 检查完整性
- **扩展简单**：添加新阶段只需在注册表中添加配置对象

#### 2.4.2 核心类型定义

```typescript
// src/shared/phase-config/types.ts

/** 主阶段配置 */
interface PhaseConfig {
  phase: GamePhase;
  display: {
    name: string;        // 短名称 "换牌"
    fullName: string;    // 完整名称 "换牌阶段"
    colorClass: string;  // Tailwind 类 "bg-indigo-500"
    icon?: string;       // emoji "🔄"
  };
  behavior: {
    canPlayerEndPhase: boolean;
    isSharedPhase: boolean;
    activePlayerStrategy: ActivePlayerStrategy;
    initialSubPhase?: SubPhase;
  };
}

/** 子阶段配置 */
interface SubPhaseConfig {
  subPhase: SubPhase;
  display: {
    name: string;
    icon: string;
    requiresUserAction: boolean;
  };
  behavior: {
    activePlayer: 'FIRST' | 'SECOND' | 'CURRENT_ACTIVE' | 'BOTH';
    isEffectWindow: boolean;
    nextSubPhase?: SubPhase;
  };
}

/** 当前行动玩家判断策略 */
type ActivePlayerStrategy =
  | 'USE_ACTIVE_PLAYER_INDEX'  // 使用 game.activePlayerIndex
  | 'USE_FIRST_PLAYER'         // 始终是先攻玩家
  | 'BOTH_PLAYERS'             // 双方都可行动
  | 'DERIVE_FROM_SUB_PHASE';   // 根据子阶段推断
```

#### 2.4.3 使用方法

```typescript
// 获取阶段配置
import { getPhaseConfig, getPhaseName, getPhaseColorClass } from '@game/shared/phase-config';

const config = getPhaseConfig(GamePhase.MULLIGAN_PHASE);
const name = getPhaseName(GamePhase.MAIN_PHASE);  // "主要阶段"

// 获取子阶段配置
import { getSubPhaseConfig, isUserActionRequired } from '@game/shared/phase-config';

const subConfig = getSubPhaseConfig(SubPhase.LIVE_SET_FIRST_PLAYER);
const needsAction = isUserActionRequired(SubPhase.PERFORMANCE_CHEER);  // true

// 统一判断当前行动玩家
import { isPlayerActive } from '@game/shared/phase-config';

const canAct = isPlayerActive(gameState, playerId);
```

#### 2.4.4 添加新阶段的步骤

**之前 (8 步)：**
1. `enums.ts` - 添加枚举值
2. `actions.ts` - 添加 Action 类型
3. `game.ts` - 添加状态字段
4. `game-service.ts` - 添加处理逻辑
5. `phase-manager.ts` - 更新 `getPhaseName()` 和 `getNextPhase()` switch-case
6. `gameStore.ts` - 更新 `getPhaseDisplayName()`
7. `game-visualizer.ts` - 更新 `getPhaseName()`
8. `PhaseIndicator.tsx` - 更新 `phaseInfo` 对象

**之后 (2-3 步)：**
1. `enums.ts` - 添加枚举值
2. `phase-registry.ts` - 添加配置对象（包含 display、behavior、transitions、autoActions、triggerConditions）
3. (可选) `game-service.ts` - 添加特殊处理逻辑

#### 2.4.5 阶段流转配置 (2025-01-20 新增)

阶段流转规则现在定义在 `phase-registry.ts` 中，而非 `phase-manager.ts` 的 switch-case：

```typescript
// phase-registry.ts 中的流转配置示例
[GamePhase.MAIN_PHASE]: {
  // ...display 配置
  behavior: {
    canPlayerEndPhase: true,
    // ...
    transitions: [
      // 先攻主要阶段结束 → 后攻活跃阶段
      {
        whenTurnType: TurnType.FIRST_PLAYER_TURN,
        nextPhase: GamePhase.ACTIVE_PHASE,
        nextTurnType: TurnType.SECOND_PLAYER_TURN,
        nextActivePlayer: 'SECOND',
        isNewTurn: false,
      },
      // 后攻主要阶段结束 → Live 设置阶段
      {
        whenTurnType: TurnType.SECOND_PLAYER_TURN,
        nextPhase: GamePhase.LIVE_SET_PHASE,
        nextTurnType: TurnType.LIVE_PHASE,
        nextActivePlayer: 'FIRST',
        isNewTurn: false,
      },
    ],
    autoActions: [],  // 进入阶段时的自动处理
    triggerConditions: [TriggerCondition.ON_MAIN_PHASE_START],
  },
},
```

**流转规则类型：**
```typescript
interface PhaseTransitionRule {
  whenTurnType?: TurnType;           // 条件：当前回合类型
  whenCondition?: PhaseTransitionCondition;  // 条件：特殊状态检查
  nextPhase: GamePhase;              // 下一个阶段
  nextTurnType: TurnType | 'SAME';   // 下一个回合类型
  nextActivePlayer: 'SAME' | 'FIRST' | 'SECOND' | 'SWITCH';
  isNewTurn: boolean;                // 是否是新回合
}
```

**PhaseManager 的新角色：**
- 不再包含硬编码的阶段流转 switch-case
- 从配置中读取流转规则并执行
- 只负责解释配置和计算状态

---

## 3. 检查时机 (Check Timing) 实现规范

这是游戏逻辑的核心，必须严格按照规则 9.5.3 实现。

### 3.1 检查时机流程

```typescript
/**
 * 检查时机的标准实现
 * 参考规则 9.5.3
 */
function executeCheckTiming(game: GameState): GameState {
  let currentState = game;
  
  // 步骤 1: 处理规则处理，直到没有新的规则处理产生
  do {
    currentState = processAllRuleActions(currentState);
  } while (hasNewRuleActions(currentState));
  
  // 步骤 2: 主动玩家的待命自动能力
  while (hasPendingAutoAbilities(currentState, getActivePlayer(currentState))) {
    const ability = selectAutoAbility(currentState, getActivePlayer(currentState));
    currentState = resolveAutoAbility(currentState, ability);
    
    // 解决后重新处理规则处理
    do {
      currentState = processAllRuleActions(currentState);
    } while (hasNewRuleActions(currentState));
  }
  
  // 步骤 3: 非主动玩家的待命自动能力
  while (hasPendingAutoAbilities(currentState, getNonActivePlayer(currentState))) {
    const ability = selectAutoAbility(currentState, getNonActivePlayer(currentState));
    currentState = resolveAutoAbility(currentState, ability);
    
    do {
      currentState = processAllRuleActions(currentState);
    } while (hasNewRuleActions(currentState));
  }
  
  return currentState;
}
```

### 3.2 规则处理优先级

按照规则第 10 章，规则处理的执行顺序：

1. **刷新 (Refresh)** - 规则 10.2
   - 条件：主卡组为空且控备室有卡
   - 动作：控备室所有卡移入主卡组并洗牌
   
2. **胜利处理** - 规则 10.3
   - 条件：成功 Live 区达到 3 张
   
3. **重复成员处理** - 规则 10.4
   - 条件：同一成员区域有 2+ 张卡
   - 动作：保留最新的，其余送入控备室
   
4. **非法卡牌处理** - 规则 10.5
   - Live 区的非 Live 卡 → 控备室
   - 能量区的非能量卡 → 控备室

---

## 4. 卡牌系统规范

### 4.1 卡牌标识

每张卡牌需要两种 ID：

```typescript
interface CardIdentifier {
  /** 卡牌编号 - 用于卡组构筑检查，同名卡共享 */
  cardCode: string;  // 例如: "LL-001"
  
  /** 实例 ID - 游戏内唯一，用于追踪具体卡牌 */
  instanceId: string;  // 例如: "uuid-xxxx-xxxx"
}
```

### 4.2 Heart 图标处理

```typescript
interface HeartIcon {
  color: HeartColor;
  count: number;
}

// Rainbow Heart 的特殊处理
// 在 Live 判定时动态分配颜色
function allocateRainbowHearts(
  pool: HeartPool,
  requirements: HeartRequirement[]
): AllocationResult {
  // 优先满足特定颜色需求
  // 使用贪心算法或回溯算法
}
```

### 4.3 能力文本解析

能力格式遵循规则 9.1：

| 能力类型 | 格式 | 示例 |
|----------|------|------|
| 触发能力 | `(条件)：(效果)` | `[支付1]：抽1张卡` |
| 自动能力 | `【触发条件】(效果)` | `【登场】抽1张卡` |
| 常驻能力 | `(效果)` | `你的其他成员 Blade +1` |

### 4.4 效果原语系统 (Effect Primitives System)

> ⚠️ **重要变更 (2025-01-20)**：
> 采用"信任玩家"新方案后，效果执行引擎 (`effect-executor.ts`) 和卡牌配置 (`card-configs.ts`) 已被移除。
> 保留 `primitives.ts` 类型定义以供未来参考。
> 
> **新方案核心理念**：
> - 系统只负责规则处理（第10章），不自动执行卡牌效果
> - 玩家通过手动拖拽执行效果
> - UI 提供效果发动窗口作为提示，不强制执行
> 
> 详见 `docs/PROJECT_REQUIREMENTS.md` 第 7 章「能力与效果系统」

---

## 5. Live 判定算法规范

### 5.1 判定流程

```typescript
function performLiveJudgment(
  liveCards: LiveCard[],
  heartPool: HeartPool
): LiveJudgmentResult {
  const results: Map<string, boolean> = new Map();
  let remainingPool = { ...heartPool };
  
  for (const liveCard of liveCards) {
    const canSatisfy = checkRequirements(liveCard.requirements, remainingPool);
    
    if (canSatisfy) {
      // 从池中扣除消耗的 Heart
      remainingPool = consumeHearts(remainingPool, liveCard.requirements);
      results.set(liveCard.instanceId, true);
    } else {
      results.set(liveCard.instanceId, false);
    }
  }
  
  return { results, remainingPool };
}
```

### 5.2 Heart 需求检查

根据规则 2.11.3：

```typescript
function checkRequirements(
  requirements: HeartRequirement,
  pool: HeartPool
): boolean {
  // 条件 1: 各颜色需求
  for (const [color, required] of requirements.colorRequirements) {
    const available = pool.getCount(color) + pool.getRainbowCount();
    if (available < required) return false;
  }
  
  // 条件 2: 总数需求
  const totalRequired = requirements.totalRequired;
  const totalAvailable = pool.getTotalCount();
  
  return totalAvailable >= totalRequired;
}
```

---

## 6. 测试规范

### 6.1 测试覆盖要求

| 模块 | 最低覆盖率 |
|------|-----------|
| 规则处理 | 95% |
| Live 判定 | 95% |
| 能力系统 | 90% |
| 区域操作 | 90% |

### 6.2 测试用例规范

每个测试用例应包含：

```typescript
describe('Live 判定', () => {
  it('should succeed when hearts exactly match requirements', () => {
    // Given: 准备初始状态
    const pool = createHeartPool({ PINK: 3, RED: 2 });
    const liveCard = createLiveCard({
      requirements: { colorRequirements: { PINK: 3, RED: 2 }, totalRequired: 5 }
    });
    
    // When: 执行判定
    const result = performLiveJudgment([liveCard], pool);
    
    // Then: 验证结果
    expect(result.results.get(liveCard.instanceId)).toBe(true);
  });
});
```

### 6.3 边界条件测试

必须覆盖的边界条件：

- 卡组为空时抽卡（触发刷新）
- Rainbow Heart 的多种分配方式
- 同一回合多次触发同一自动能力
- 接力传递的费用减免计算
- 无限循环检测

---

## 7. 错误处理规范

### 7.1 错误类型

```typescript
enum GameErrorCode {
  // 非法操作
  INVALID_ACTION = 'INVALID_ACTION',
  INSUFFICIENT_COST = 'INSUFFICIENT_COST',
  INVALID_TARGET = 'INVALID_TARGET',
  
  // 状态错误
  WRONG_PHASE = 'WRONG_PHASE',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  
  // 系统错误
  STATE_CORRUPTED = 'STATE_CORRUPTED',
  INFINITE_LOOP_DETECTED = 'INFINITE_LOOP_DETECTED',
}

class GameError extends Error {
  constructor(
    public code: GameErrorCode,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
  }
}
```

### 7.2 无限循环处理

根据规则 12.1：

```typescript
const MAX_LOOP_ITERATIONS = 1000;

function detectInfiniteLoop(history: GameAction[]): boolean {
  // 检测游戏状态是否回到完全相同的状态
  // 如果是，则判定为无限循环
}
```

---

## 8. 版本控制与发布规范

### 8.1 分支策略

- `main`: 稳定版本
- `develop`: 开发版本
- `feature/*`: 功能分支
- `bugfix/*`: 修复分支

### 8.2 提交信息格式

```
<type>(<scope>): <subject>

类型:
- feat: 新功能
- fix: 修复
- docs: 文档
- refactor: 重构
- test: 测试
- chore: 构建/工具

示例:
feat(live): implement heart requirement checking
fix(ability): correct auto ability trigger order
```

---

## 9. ESLint 与代码风格例外

### 9.1 测试文件的特殊规则

测试文件 (`tests/**/*.ts`) 中允许以下通常被禁止的用法：

| 规则 | 例外说明 |
|------|----------|
| `no-console` | 测试中允许使用 `console.log` 输出调试信息 |
| `@typescript-eslint/no-unsafe-assignment` | JSON 解析结果可以直接使用 |
| Node.js 全局变量 | 允许直接使用 `process`, `__dirname` 等 |

### 9.2 忽略规则的方式

当必须违反 ESLint 规则时，使用行内注释明确标注：

```typescript
// 单行禁用
// eslint-disable-next-line no-console
console.log('调试输出');

// 多行禁用（仅在必要时使用）
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
const data = JSON.parse(jsonString);
/* eslint-enable @typescript-eslint/no-unsafe-assignment */
```

### 9.3 推荐做法

- **优先修复**：先尝试用类型安全的方式解决问题
- **最小范围**：只禁用必要的规则，避免 `eslint-disable` 整个文件
- **添加注释**：说明为什么需要禁用该规则

---

## 附录 A: 枚举定义

```typescript
// 卡牌类型
enum CardType {
  MEMBER = 'MEMBER',
  LIVE = 'LIVE',
  ENERGY = 'ENERGY',
}

// Heart 颜色
enum HeartColor {
  PINK = 'PINK',
  RED = 'RED',
  YELLOW = 'YELLOW',
  GREEN = 'GREEN',
  BLUE = 'BLUE',
  PURPLE = 'PURPLE',
  RAINBOW = 'RAINBOW',  // 万能色
}

// 游戏阶段
enum GamePhase {
  // 通常阶段
  ACTIVE_PHASE = 'ACTIVE_PHASE',
  ENERGY_PHASE = 'ENERGY_PHASE',
  DRAW_PHASE = 'DRAW_PHASE',
  MAIN_PHASE = 'MAIN_PHASE',
  // Live 阶段
  LIVE_SET_PHASE = 'LIVE_SET_PHASE',
  PERFORMANCE_PHASE = 'PERFORMANCE_PHASE',
  LIVE_RESULT_PHASE = 'LIVE_RESULT_PHASE',
}

// 区域类型
enum ZoneType {
  HAND = 'HAND',
  MAIN_DECK = 'MAIN_DECK',
  ENERGY_DECK = 'ENERGY_DECK',
  MEMBER_SLOT = 'MEMBER_SLOT',
  ENERGY_ZONE = 'ENERGY_ZONE',
  LIVE_ZONE = 'LIVE_ZONE',
  SUCCESS_ZONE = 'SUCCESS_ZONE',
  WAITING_ROOM = 'WAITING_ROOM',
  EXILE_ZONE = 'EXILE_ZONE',
  RESOLUTION_ZONE = 'RESOLUTION_ZONE',
}

// 成员区域位置
enum SlotPosition {
  LEFT = 'LEFT',
  CENTER = 'CENTER',
  RIGHT = 'RIGHT',
}

// 能量状态
enum EnergyState {
  ACTIVE = 'ACTIVE',
  WAITING = 'WAITING',
}

// 触发条件
enum TriggerCondition {
  ON_ENTER_STAGE = 'ON_ENTER_STAGE',
  ON_LIVE_START = 'ON_LIVE_START',
  ON_LIVE_SUCCESS = 'ON_LIVE_SUCCESS',
  ON_TURN_START = 'ON_TURN_START',
  ON_TURN_END = 'ON_TURN_END',
  ON_CHEER = 'ON_CHEER',
  ON_RELAY = 'ON_RELAY',
  ON_DRAW = 'ON_DRAW',
}
```

---

- `docs/PROJECT_REQUIREMENTS.md` - 项目总体需求文档
- `docs/doc_writing_guide.md` - 文档编写规范

---

*文档最后更新: 2026-03-09*
