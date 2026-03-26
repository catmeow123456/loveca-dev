# Loveca 游戏系统设计文档（重构版）

> 文档类型：设计文档  
> 适用范围：Loveca 当前代码架构与关键流程设计（基于现状实现）  
> 最后更新：2026-03-27

---

## 1. 设计目标与范围

本文档用于描述 Loveca 的系统设计方案，重点覆盖：

- 对局引擎分层与状态机设计
- 规则处理与动作执行链路
- 前后端边界与数据流
- 持久化与资源服务设计
- 已实现功能对应的代码路径

不包含内容：

- 具体实现代码
- 逐行算法说明
- 历史旧版 OOP 伪模型

---

## 2. 总体架构设计

```mermaid
graph TB
    subgraph Client[前端应用]
        UI[页面与组件]
        GS[gameStore/deckStore/authStore]
        APIClient[API 客户端]
    end

    subgraph Engine[共享对局引擎]
        Session[GameSession]
        Service[GameService]
        Phase[PhaseManager + PhaseConfig]
        Handlers[Action Handlers]
        Rules[RuleActions + LiveResolver + Cost/Deck 校验]
        Domain[Game/Player/Card/Zone 实体]
    end

    subgraph Server[服务端 API]
        App[Express App]
        Routes[Auth/Cards/Decks/Profiles/Images]
        Middleware[鉴权与校验中间件]
    end

    subgraph Infra[基础设施]
        PG[(PostgreSQL)]
        MinIO[(MinIO)]
    end

    UI --> GS
    GS --> Session
    Session --> Service
    Service --> Phase
    Service --> Handlers
    Service --> Rules
    Handlers --> Domain
    Rules --> Domain

    GS --> APIClient
    APIClient --> App
    App --> Middleware
    Middleware --> Routes
    Routes --> PG
    Routes --> MinIO
```

设计原则：

- 对局规则与 UI 展示解耦
- 阶段规则配置化，减少硬编码
- 动作处理器按职责拆分，便于扩展
- 本地离线可运行，在线能力通过 API 增强

---

## 3. 对局引擎分层设计

```mermaid
graph LR
    Session[会话层\nGameSession] --> Service[应用服务层\nGameService]
    Service --> Handlers[动作处理层\nAction Handlers]
    Service --> PhaseCfg[阶段配置层\nphase-registry/sub-phase-registry]
    Service --> RuleLayer[规则层\nRuleActions/LiveResolver]
    Handlers --> Domain[领域实体层\nGame/Player/Card/Zone]
    RuleLayer --> Domain
```

### 3.1 会话层

职责：

- 维护权威状态
- 接收并派发玩家动作
- 处理自动推进与模式差异（DEBUG/SOLITAIRE）
- 提供玩家视角状态读取接口

代码路径：

- `src/application/game-session.ts`

### 3.2 应用服务层

职责：

- 初始化对局
- 统一动作执行与结果返回
- 驱动阶段流转
- 触发检查时机与规则处理

代码路径：

- `src/application/game-service.ts`

### 3.3 阶段配置层

职责：

- 统一定义主阶段行为、转换条件、自动动作
- 统一定义子阶段顺序与是否需要用户操作
- 提供活跃玩家判定策略

代码路径：

- `src/shared/phase-config/phase-registry.ts`
- `src/shared/phase-config/sub-phase-registry.ts`
- `src/shared/phase-config/active-player.ts`
- `src/application/phase-manager.ts`

### 3.4 动作处理层

职责：

- 按动作类型分发处理器
- 落地卡牌移动、子阶段确认、分数确认、撤销、应援等动作
- 统一动作成功/失败结果语义

代码路径：

- `src/application/action-handlers/index.ts`
- `src/application/action-handlers/play-member.handler.ts`
- `src/application/action-handlers/live-set.handler.ts`
- `src/application/action-handlers/mulligan.handler.ts`
- `src/application/action-handlers/tap-member.handler.ts`
- `src/application/action-handlers/phase-ten.handler.ts`
- `src/application/action-handlers/zone-operations.ts`
- `src/application/actions.ts`

### 3.5 规则层

职责：

- 处理 Live 判定、应援、胜负结果
- 处理规则动作（刷新、胜利检测、非法状态清理）
- 提供费用与卡组校验能力

代码路径：

- `src/domain/rules/live-resolver.ts`
- `src/domain/rules/rule-actions.ts`
- `src/domain/rules/check-timing.ts`
- `src/domain/rules/cost-calculator.ts`
- `src/domain/rules/deck-validator.ts`
- `src/domain/value-objects/heart.ts`

### 3.6 领域实体层

职责：

- 承载对局状态结构与不可变更新语义
- 管理玩家、区域、卡牌实例与历史记录

代码路径：

- `src/domain/entities/game.ts`
- `src/domain/entities/player.ts`
- `src/domain/entities/zone.ts`
- `src/domain/entities/card.ts`

---

## 4. 对局流程状态机设计

```mermaid
flowchart TD
    Setup[SETUP] --> Mulligan[MULLIGAN_PHASE]
    Mulligan --> Active1[ACTIVE_PHASE\n先攻]
    Active1 --> Energy1[ENERGY_PHASE\n先攻]
    Energy1 --> Draw1[DRAW_PHASE\n先攻]
    Draw1 --> Main1[MAIN_PHASE\n先攻]

    Main1 --> Active2[ACTIVE_PHASE\n后攻]
    Active2 --> Energy2[ENERGY_PHASE\n后攻]
    Energy2 --> Draw2[DRAW_PHASE\n后攻]
    Draw2 --> Main2[MAIN_PHASE\n后攻]

    Main2 --> LiveSet[LIVE_SET_PHASE]
    LiveSet --> Performance1[PERFORMANCE_PHASE\n先攻演出]
    Performance1 --> Performance2[PERFORMANCE_PHASE\n后攻演出]
    Performance2 --> LiveResult[LIVE_RESULT_PHASE]
    LiveResult --> Active1
```

子阶段设计原则：

- 主阶段下沉到可观察子阶段，支持 UI 精细控制
- 子阶段标注是否需要玩家确认
- 自动子阶段用于抽牌、推进与清理

代码路径：

- `src/shared/types/enums.ts`
- `src/shared/phase-config/sub-phase-registry.ts`

---

## 5. 动作执行链路设计

```mermaid
sequenceDiagram
    participant UI as 前端组件
    participant Store as gameStore
    participant Session as GameSession
    participant Service as GameService
    participant Handler as ActionHandler
    participant Rule as RuleActions

    UI->>Store: 发起动作
    Store->>Session: dispatch(action)
    Session->>Service: processAction
    Service->>Handler: 执行对应处理器
    Handler-->>Service: 返回新状态
    Service->>Rule: 执行检查时机与规则处理
    Rule-->>Service: 返回修正后状态
    Service-->>Session: 操作结果
    Session-->>Store: 更新权威状态快照
    Store-->>UI: 重渲染
```

关键设计点：

- 动作是唯一状态入口，避免绕过规则层改状态
- 规则处理在动作后统一执行，保障状态一致性
- 会话层负责自动推进，不把流程控制分散到组件层

代码路径：

- `client/src/store/gameStore.ts`
- `src/application/game-session.ts`
- `src/application/game-service.ts`
- `src/application/action-handlers/`

---

## 6. 规则校正与“信任玩家”设计

```mermaid
flowchart TD
    ActionDone[动作执行完成] --> CheckLoop[进入检查时机循环]
    CheckLoop --> Collect[收集待执行规则动作]
    Collect --> HasPending{是否存在规则动作}
    HasPending -- 是 --> Apply[批量应用规则动作]
    Apply --> Victory{是否触发胜利/平局}
    Victory -- 是 --> End[结束对局]
    Victory -- 否 --> Collect
    HasPending -- 否 --> Stable[状态稳定，返回]
```

设计说明：

- 用户可在特定窗口进行自由移动与确认
- 系统负责兜底纠偏，清理非法或不完整状态
- 胜利检测由规则层统一处理

代码路径：

- `src/application/game-service.ts`
- `src/domain/rules/rule-actions.ts`
- `src/domain/rules/check-timing.ts`

---

## 7. 前端架构设计

```mermaid
graph TB
    App[App.tsx] --> Auth[authStore]
    App --> Deck[deckStore]
    App --> Game[gameStore]

    Game --> SetupPage[GameSetupPage]
    Game --> Board[GameBoard]

    Board --> PhaseUI[PhaseIndicator/PhaseBanner]
    Board --> Panels[Mulligan/Judgment/Score/Effect]
    Board --> Areas[PlayerArea/Card/DnD Zone]
    Board --> Logs[GameLog]
```

职责划分：

- `gameStore`：对局状态桥接与动作封装
- `deckStore`：卡组编辑与云端卡组管理
- `authStore`：认证、会话恢复、离线模式
- `GameBoard`：拖拽与对局主交互容器

代码路径：

- `client/src/store/gameStore.ts`
- `client/src/store/deckStore.ts`
- `client/src/store/authStore.ts`
- `client/src/components/game/`
- `client/src/components/pages/GameSetupPage.tsx`

---

## 8. 服务端与数据设计

### 8.1 API 模块设计

```mermaid
graph LR
    App[Express App] --> AuthR[Auth Route]
    App --> CardsR[Cards Route]
    App --> DecksR[Decks Route]
    App --> ProfilesR[Profiles Route]
    App --> ImagesR[Images Route]

    AuthR --> AuthSvc[auth-service + mail-service]
    DecksR --> Scraper[decklog-scraper]
    ImagesR --> MinioSvc[minio-service]
```

代码路径：

- `src/server/app.ts`
- `src/server/routes/auth.ts`
- `src/server/routes/cards.ts`
- `src/server/routes/decks.ts`
- `src/server/routes/profiles.ts`
- `src/server/routes/images.ts`
- `src/server/services/`

### 8.2 数据模型设计

```mermaid
erDiagram
    USERS ||--|| PROFILES : has
    USERS ||--o{ REFRESH_TOKENS : owns
    USERS ||--o{ EMAIL_VERIFICATION_TOKENS : receives
    USERS ||--o{ PASSWORD_RESET_TOKENS : receives
    PROFILES ||--o{ DECKS : owns
    USERS ||--o{ CARDS : updates

    USERS {
      uuid id
      text email
      text password_hash
      bool email_verified
    }
    PROFILES {
      uuid id
      text username
      text display_name
      text role
    }
    DECKS {
      uuid id
      uuid user_id
      jsonb main_deck
      jsonb energy_deck
      bool is_valid
    }
    CARDS {
      uuid id
      text card_code
      text card_type
      text status
      jsonb hearts
      jsonb blade_hearts
      jsonb requirements
    }
```

代码路径：

- `src/server/db/schema.ts`
- `src/server/db/drizzle.ts`
- `src/server/db/pool.ts`

---

## 9. 测试设计与覆盖结构

```mermaid
graph TD
    Tests[测试体系] --> Unit[Unit]
    Tests --> Integration[Integration]
    Tests --> Simulation[Simulation]
    Tests --> E2E[Client E2E]
```

代码路径：

- 单元与集成：`tests/unit/`、`tests/integration/`
- 流程仿真：`tests/simulation/`
- 前端端到端：`client/e2e/specs/`

---

## 10. 当前落地边界（设计视角）

### 10.1 已落地

- 配置化阶段/子阶段驱动的主流程
- 动作处理器体系与检查时机校正
- Live 判定、应援与结算链路
- 本地双人调试模式与对墙打模式
- 认证、卡组、卡牌、图片管理 API
- 云端卡组与离线模式并存

### 10.2 规划中

- 实时联机对战（房间/同步/重连）
- 对局持久化与回放
- 更完整的自动能力编排
- 更高覆盖的性能与稳定性专项测试

---

## 11. 文档维护约定

- 本文档为“设计文档”，新增已实现模块时需补充对应代码路径
- 架构和流程图统一使用 Mermaid
- 需求变更先更新需求文档，再同步更新本设计文档
- 与外部系统强耦合时，需在相关模块文档中补充原始链接
