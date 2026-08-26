# Loveca 游戏系统设计文档

> 文档类型：设计文档  
> 适用范围：Loveca 当前代码架构与关键流程设计（基于现状实现）  
> 当前状态：现行系统设计；字段级 schema 以 `src/server/db/schema.ts` 和 `drizzle/` 增量迁移为准，初始化函数与触发器以 `docker/init.sql` 为准
> 最后更新：2026-08-26

---

## 1. 设计目标与范围

本文档用于描述 Loveca 的系统设计方案，重点覆盖：

- 对局引擎分层与状态机设计
- 规则处理与动作执行链路
- 前后端边界与数据流
- 持久化与资源服务设计
- 已实现功能对应的代码路径

运行时数据结构、算法链路、卡效/LIVE/recorder 热路径和跨模块不变量的横向说明，见 [运行时数据结构与算法链路](runtime-data-flow-and-algorithm-chain.md)。本文档维护系统全景和模块职责，不重复维护逐条运行时链路。

不包含内容：

- 具体实现代码
- 逐行算法说明
- 逐条运行时数据结构关系和热路径分析
- 历史旧版 OOP 伪模型

---

## 2. 总体架构设计

```mermaid
graph TB
    subgraph Client[前端应用]
        UI[页面与组件]
        GS[gameStore/deckStore/authStore/rankedStore/themeTableStore]
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
        Routes[Auth/Cards/Decks/Profiles/Images/Online/Battle/Ranked/Theme Table/Admin Users]
        Middleware[鉴权、Permission 与校验中间件]
        OnlineSvc[OnlineRoomService + OnlineMatchService + SolitaireMatchService]
        RankedSvc[Ranked Season/Queue/Rating/Admin Services]
        ThemeSvc[Theme Table Player/Admin/Allocation/Recovery Services]
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
    Routes --> OnlineSvc
    Routes --> RankedSvc
    Routes --> ThemeSvc
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
- 处理自动推进与规则自动化策略差异（`GameMode.DEBUG` / `GameMode.SOLITAIRE`）；正式联机由服务端房间/对局服务持有会话并通过座位映射驱动同一个 `GameSession`
- 提供玩家视角状态读取接口；联机快照通过 `PlayerViewState` 投影输出，不直接暴露权威状态

代码路径：

- `src/application/game-session.ts`
- `src/online/projector.ts`
- `src/online/visibility.ts`

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

- 处理规则动作（刷新、胜利检测、非法状态清理）
- 提供 Live/Heart 相关领域计算能力
- 提供费用与卡组校验能力

当前实现说明：

- 运行时主链路中的检查时机由 `GameService.executeCheckTiming()` 直接驱动 `rule-actions`
- `src/domain/rules/check-timing.ts` 保留了更完整的检查时机/自动能力处理模型，但当前未接入主流程
- `src/domain/rules/live-resolver.ts` 目前主要作为领域计算模块与测试覆盖对象，未作为对局主链路唯一入口

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
    Performance2 --> Success1[LIVE_RESULT_PHASE\n先攻成功效果]
    Success1 --> Success2[LIVE_RESULT_PHASE\n后攻成功效果]
    Success2 --> LiveResult[LIVE_RESULT_PHASE\n分数确认与结算]
    LiveResult --> Active1
```

子阶段设计原则：

- 主阶段下沉到可观察子阶段，支持 UI 精细控制
- 子阶段标注是否需要玩家确认
- 自动子阶段用于抽牌、推进与清理
- Live 成功效果在双方表演完成后依次处理，顺序为先攻成功效果、后攻成功效果，再进入分数确认与结算

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

## 6. 规则校正与操作模式设计

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

- 新对局默认 `RULES`，玩家输入先经过中央命令政策，只允许当前阶段、pending 和卡效流程明确开放的语义化命令
- `FREE` 在安全时点显式开启，保留己方区域的兼容移动与人工规则处理；正式联机开启需要对方同意，任意一方可单方恢复 `RULES`
- 系统规则处理负责客观状态纠偏，但不以“先接受非法命令、再自动清理”替代命令入口校验
- 胜利检测由规则层统一处理
- 已登记卡效进入自动能力队列；未登记或未接线卡效需要人工处理时，应先进入 `FREE`

代码路径：

- `src/application/manual-operation-mode.ts`（权威模式读取、切换安全点与命令重写）
- `src/application/player-command-policy.ts`（`RULES` / `FREE` 中央玩家命令政策）
- `src/application/game-session.ts`（权威状态、命令校验与模式切换）
- `src/application/game-service.ts`
- `src/domain/rules/rule-actions.ts`
- `src/domain/rules/check-timing.ts`（当前为未接线的完整模型实现）
- `src/online/projector.ts`（玩家视图、权限与模式投影）
- `src/server/services/online-match-service.ts`（正式联机协商、席位校验与服务端权威执行）
- `src/server/services/replay-payload-serialization.ts`（历史 authority checkpoint 的窄复水兼容边界）

---

## 7. 前端架构设计

```mermaid
graph TB
    App[App.tsx] --> Auth[authStore]
    App --> Deck[deckStore]
    App --> Game[gameStore]
    App --> Update[UpdateCoordinator]
    App --> MatchAudio[MatchmakingAudioLayer]

    Update --> Manifest[version.json]
    Update --> SW[Service Worker registration]

    MatchAudio --> DeckQueue[Public/Ranked/Theme queue stores]

    Game --> SetupPage[GameSetupPage]
    Game --> Board[GameBoard]

    Board --> PhaseUI[PhaseIndicator/PhaseBanner]
    Board --> Panels[Mulligan/Judgment/Score/Effect]
    Board --> Areas[PlayerArea/Card/DnD Zone]
    Board --> Logs[GameLog]
```

职责划分：

- `gameStore`：对局状态桥接与动作封装
- `deckStore`：卡组编辑、浏览器本地卡组持久化与云端卡组管理；云端列表按登录用户隔离当前会话快照，以 30 秒 freshness 区分 `ensureCloudDecks` 的按需读取和 `refreshCloudDecks` 的强制确认读取，同用户并发请求共享同一 Promise，后台刷新失败时继续保留旧快照
- `authStore`：认证、会话恢复、个人资料与凭据更新、离线模式
- `rankedStore`：赛季总览与跨页面排位候场、确认和取消状态
- `themeTableStore`：主题活动总览与跨页面候场、确认、分配和开局前恢复状态
- `MatchmakingAudioLayer`：统一订阅公共牌桌、赛季排位和娱乐模式候场状态；候场时由 `MatchmakingAudioPlayer` 随机循环一首等待音乐，形成配对后按预留身份只播放一次提示音。音频在用户加入候场的操作中主动启动，以满足浏览器播放授权；候场音乐自动播放被拒绝时只等待后续用户操作重试，任何音频失败都不改变候场、确认或进房状态
- `UpdateCoordinator`：在应用渲染后统一接收 `version.json` 与 prompt 型 Service Worker 的更新信号；版本发现只产生非阻断提示，进行中的本地/远程对局不提供更新入口，玩家在安全页面确认后才激活 waiting worker 并执行单次刷新
- `GameBoard`：拖拽与对局主交互容器

代码路径：

- `client/src/store/gameStore.ts`
- `client/src/store/deckStore.ts`
- `client/src/store/authStore.ts`
- `client/src/store/rankedStore.ts`
- `client/src/store/themeTableStore.ts`
- `client/src/lib/matchmakingAudio.ts`
- `client/src/components/matchmaking/MatchmakingAudioLayer.tsx`
- `client/src/lib/appUpdateCoordinator.ts`
- `client/src/lib/appUpdateRegistration.ts`
- `client/src/components/common/AppUpdateNotice.tsx`
- `client/src/components/pages/ThemeTablePage.tsx`
- `client/src/components/theme-table/ThemeTableGlobalLayer.tsx`
- `client/src/components/pages/AccountCenterPage.tsx`
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
    App --> ConfigR[App Config Route]
    App --> SiteAnnouncementsR[Site Announcements Route]
    App --> OnlineR[Online Route]
    App --> BattleR[Battle Route]
    App --> RankedR[Ranked Route]
    App --> RankedAdminR[Ranked Admin Route]
    App --> PlayerBadgesR[Player Badges Route]
    App --> ThemeR[Theme Table Route]
    App --> ThemeAdminR[Theme Table Admin Route]
    App --> AdminUsersR[Admin Users Route]

    AuthR --> AuthSvc[auth-service + mail-service]
    DecksR --> Scraper[decklog-scraper]
    ImagesR --> MinioSvc[minio-service]
    ConfigR --> OpsSvc[site-announcement-service + site-status]
    SiteAnnouncementsR --> OpsSvc
    OnlineR --> OnlineSvc[online-room-service + online-match-service]
    BattleR --> OnlineSvc
    RankedR --> RankedSvc[ranked-player-service + ranked-runtime-service]
    RankedAdminR --> RankedAdminSvc[ranked-admin-service + ranked-season-service + ranked-rating-service]
    PlayerBadgesR --> PlayerBadgeSvc[player-badge-service]
    ThemeR --> ThemeSvc[theme-table-player-service + public-table-service]
    ThemeAdminR --> ThemeAdminSvc[theme-table-admin-service]
    AdminUsersR --> AdminUsersSvc[admin-user-service]
```

代码路径：

- `src/server/app.ts`
- `src/server/routes/auth.ts`
- `src/server/routes/cards.ts`
- `src/server/routes/decks.ts`
- `src/server/routes/profiles.ts`
- `src/server/routes/images.ts`
- `src/server/routes/app-config.ts`
- `src/server/routes/match-emotes.ts`
- `src/server/routes/ai-effect-extraction.ts`
- `src/server/routes/site-announcements.ts`
- `src/server/routes/online.ts`
- `src/server/routes/battle.ts`
- `src/server/routes/ranked.ts`
- `src/server/routes/ranked-admin.ts`
- `src/server/routes/player-badges.ts`
- `src/server/routes/theme-table.ts`
- `src/server/routes/theme-table-admin.ts`
- `src/server/routes/admin-users.ts`
- `src/server/routes/platform-operations.ts`
- `src/server/site-status.ts`
- `src/server/services/site-announcement-service.ts`
- `src/server/services/admin-user-service.ts`
- `src/server/services/platform-operations-service.ts`
- `src/server/services/replay-retention.ts`
- `src/server/middleware/require-permission.ts`
- `src/server/middleware/require-gameplay-available.ts`
- `src/server/services/`

认证与会话链路：

- 访问令牌固定使用带 issuer、audience、subject 与角色约束的 HS256 JWT；浏览器只在内存中保存访问令牌。
- 账号角色固定为 `user / season_admin / admin`，共享 permission 允许列表位于 `src/shared/auth/permissions.ts`。排位、主题赛季和赛季入口使用各自的赛季权限；平台、卡牌、构筑规则和用户管理使用独立权限，只有平台管理员拥有完整集合。
- 特权中间件先校验令牌角色，再读取 `profiles.role` 复核当前授权。角色不一致时返回稳定的 `AUTHORIZATION_STALE`，前端清除内存令牌并返回登录页；权限提升也必须通过新会话取得包含新角色的令牌。
- 刷新令牌通过 HttpOnly Cookie 传递，Cookie 保存令牌定位符与随机 secret，数据库只保存 secret 预哈希后的 bcrypt 摘要；刷新和当前设备登出分别在数据库事务中锁定、校验并轮换或撤销目标令牌。
- 平台管理员通过独立用户管理服务分页读取账号摘要，并在角色下拉菜单中直接修改角色。角色变更事务锁定平台管理员集合与目标账号，使用 `expectedRole` 防止并发覆盖，阻止最后一个平台管理员被降级，并在同一事务内撤销目标全部刷新令牌；角色修改不要求原因，也不写入持久审计。
- 启用 `EMAIL_ENABLED` 后，注册邮箱和登录前验证成为强制门禁，服务启动时校验完整 SMTP 配置。邮箱验证、密码重置与邮箱换绑只保存带密钥摘要；邮箱换绑先校验当前密码并向新邮箱发送一次性链接，确认时在同一事务中更新邮箱、撤销刷新令牌并清理其他认证 token。邮件链接通过 URL fragment 交给前端并在页面初始化时清理。
- 认证端点统一返回不可缓存响应，并使用按 IP 与账号标识组合的有界限流；当前部署边界见 `docs/current-limitations.md`。
- 运行时只接受 v2 刷新 Cookie 和一次性 token 格式；维护窗口中的认证切换将可识别的旧 bcrypt 密码封装成显式兼容状态，成功登录后原子升级为当前 v2 预哈希格式。原始旧 Cookie 和一次性 token 统一失效；已标记重置或未知密码格式会阻断迁移，不以运行时兜底伪装为可登录账号。

认证关键代码路径：

- `src/server/config.ts`
- `src/server/middleware/authenticate.ts`
- `src/server/middleware/require-permission.ts`
- `src/server/middleware/auth-rate-limit.ts`
- `src/server/routes/auth.ts`
- `src/server/routes/admin-users.ts`
- `src/server/services/auth-service.ts`
- `src/server/services/admin-user-service.ts`
- `src/shared/auth/permissions.ts`
- `src/server/services/mail-service.ts`
- `client/src/lib/apiClient.ts`
- `client/src/store/authStore.ts`
- `client/src/components/pages/AccountCenterPage.tsx`
- `drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts`

### 8.2 数据模型设计

```mermaid
erDiagram
    USERS ||--|| PROFILES : has
    USERS ||--o{ REFRESH_TOKENS : owns
    USERS ||--o{ EMAIL_VERIFICATION_TOKENS : receives
    USERS ||--o| EMAIL_CHANGE_TOKENS : requests
    USERS ||--o{ PASSWORD_RESET_TOKENS : receives
    USERS ||--o{ MANAGEMENT_AUDIT_LOGS : acts_in
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
    MANAGEMENT_AUDIT_LOGS {
      uuid id
      uuid actor_user_id
      text actor_role
      text scope
      text action
      text target_type
      text target_id
      text request_id
      text result
      text reason
    }
```

字段级数据库定义不在本文档重复维护；当前代码侧 schema 见 `src/server/db/schema.ts`，物理变更顺序见 `drizzle/` 增量迁移，基础初始化结构和数据库函数/触发器见 `docker/init.sql`。新库必须先执行初始化脚本，再执行全部增量迁移。

赛季排位在公共牌桌的持久票据/预留状态机上增加独立 `RANKED` 队列上下文，并以赛季、
排位对局、追加式评分事件、物化步骤、当前积分投影和跨赛季种子组成可审计结算模型。
候场与配对按赛季冻结的竞技环境隔离；权威对局封存后由评分服务幂等结算，迟到结果或
管理员更正按稳定顺序重建派生投影。字段、事务和更正链细节见
[赛季排位数据与结算设计](matchmaking-and-ladder/RANKED_R2_DATA_AND_SETTLEMENT_DESIGN.md)。

玩家徽章以持久规则和幂等授予记录分离徽章定义、资格来源与玩家所有权。首届排位徽章由
规则固定绑定来源赛季，评分结算在更新 ledger revision 后以同一事务检查有效计分场次；达到
3 场时保存第 3 场对局与当时 revision 作为证据。个人中心只通过本人端点读取；历史补发使用
显式赛季、默认 dry-run 且要求 ledger revision 的停机数据迁移脚本。

轮换主题牌桌在同一持久票据/预留状态机上增加独立 `THEME` 队列与活动环境身份。网站与管理界面统一把该玩法呈现为非计分“娱乐模式”，内部继续保留主题牌桌技术命名，并复用排位的周期、开放窗口、生命周期和管理页结构；管理员可将合法云端卡组或 YAML 复制为不可变服务端预组，并在未结束活动中继续新增、编辑或移出卡组。每副当前预组自动形成同卡组内战，并与池内既有卡组形成等权组合；编辑以退休旧预组、创建同 `deckKey` 新版本和重建未来组合实现，删除以退休版本和停用组合实现，不回写不可变分配记录或票据锁组。玩家页将服务端公开卡表投影为“卡组选择栏 + 当前卡组卡册”，按成员、LIVE、能量显示唯一卡图、名称和数量，并复用全站只读卡牌详情抽屉；该浏览投影不参与权威分配，后台难度枚举也不投影为玩家标签。冻结组合在双方确认后于事务内完成组合抽取、座位交换、分配记录和票据锁组。玩家本期战绩与当前卡组版本的两两对阵胜负由 `theme_table_assignments` 关联 `match_records` 的权威终局实时聚合；对阵关系图以预组为节点、以两端着色连线和胜局比标签表达关系，按真实分配座位还原卡组胜负，不新增评分投影、结算流水或排行榜。自组对局不绘制为自环，平局计入完成局数，中断与损坏记录不计入，退休卡组版本不混入当前卡组池图。主题房间禁用原房再战，赛后返回娱乐模式入口重新候场，确保每局都有新的分配事实。开局前责任方离场或未到场时，恢复服务终结旧预留，并在活动仍开放时为无过错方创建保留原 `joinedAt` 的新票据。详细边界见[轮换主题牌桌策划与设计](matchmaking-and-ladder/ROTATING_THEME_TABLE_DESIGN.md)。

代码路径：

- `src/server/db/schema.ts`
- `src/server/db/drizzle.ts`
- `src/server/db/pool.ts`
- `src/server/services/ranked-season-service.ts`
- `src/server/services/ranked-player-service.ts`
- `src/server/services/ranked-rating-service.ts`
- `src/server/services/ranked-runtime-service.ts`
- `src/server/services/ranked-admin-service.ts`
- `src/server/services/ranked-v3-migration-service.ts`
- `src/server/services/player-badge-service.ts`
- `src/server/player-badges/award.ts`
- `src/server/services/theme-table-player-service.ts`
- `src/server/services/theme-table-admin-service.ts`
- `src/server/services/theme-table-allocation-service.ts`
- `src/server/services/theme-table-recovery-service.ts`
- `src/server/rating/ranked-ledger.ts`
- `src/server/rating/glicko.ts`
- `scripts/migrate-ranked-season-v3.ts`
- `drizzle/0010_add_ranked_system.sql`
- `drizzle/0019_add_player_badges.sql`
- `drizzle/0026_add_theme_table_v1.sql`

---

## 9. 测试设计与覆盖结构

```mermaid
graph TD
    Tests[测试体系] --> Unit[Unit]
    Tests --> Integration[Integration]
    Tests --> Simulation[Simulation]
    Tests --> Performance[Performance\n按需运行]
    Tests --> E2E[Client E2E\n移动端与局部 UI 回归]
```

代码路径：

- 单元与集成：`tests/unit/`、`tests/integration/`
- 流程仿真：`tests/simulation/`
- 性能基准：`tests/performance/`
- 前端 E2E：`client/tests/e2e/`，覆盖移动端、响应式布局、局部 UI 回归，以及排位玩家/管理员真实 API 流程；`client/test-results/` 或根目录 `test-results/` 仅为运行产物，不作为测试入口

---

## 10. 当前落地边界（设计视角）

### 10.1 已落地

- 配置化阶段/子阶段驱动的主流程
- 动作处理器体系与规则动作校正链路
- Live 结算主流程、手动判定确认与分数确认链路
- 本地双人调试模式与对墙打模式：`client/src/components/pages/GameSetupPage.tsx` 按快速匹配、活动对战和其他对战组织公共牌桌、赛季排位、娱乐模式、房间联机、对墙打和双人调试入口，并保留本地模式的分步选组；`client/src/lib/debugPerspective.ts` 与 `client/src/store/gameStore.ts` 在本地双人调试的 `RULES` 模式下按玩家视图权限自动跟随当前操作方，`client/src/components/game/GameBoard.tsx` 同时为桌面和移动端保留显式视角切换与确认式重开入口
- 认证、卡组、卡牌、图片管理 API
- 版本化 PT 限制表：`src/domain/rules/deck-point-table.ts` 定义显式规则快照，`src/server/services/deck-point-table-service.ts` 以 PostgreSQL 事务维护 `DRAFT / SCHEDULED / ACTIVE / RETIRED` 状态、revision 乐观锁和审计日志。定时版本以 `Asia/Shanghai` 解析精确到秒的本地时间；排期改到当前/过去、立即发布及 ACTIVE 废弃替换都在单事务中切换，且任何成功操作提交前强制校验有且仅有一张 ACTIVE 表。`/api/deck-point-tables/current` 仅暴露玩家校验所需字段，卡组保存和对局准入始终以服务端 ACTIVE 表为权威；`client/src/store/deckPointTableStore.ts` 只将内置的已确认表用作离线/启动失败展示回退。管理员通过 `DeckPointTablesAdminPage` 完成任意状态表的编辑、差异预览、发布、取消排期、废弃/替换、删除已退役表和历史复制。
- 平台状态、公告与玩家入口配置：`src/server/site-status.ts` 定义 `NORMAL / RESTRICTING_NEW_GAMES / MAINTENANCE` 三态公开契约，`src/server/services/site-announcement-service.ts` 以数据库为权威协调状态、公告与独立公开快照，`src/server/services/public-site-status-snapshot-service.ts` 将维护门禁原子写入前端版本目录之外的持久文件，`src/server/services/readiness-service.ts` 在恢复开放前检查数据库与必要表。`src/server/services/battle-timeout-config-service.ts` 在同一平台单例行维护玩家操作超时与断线重连期限；`src/server/routes/site-announcements.ts` 提供管理员状态、公告、入口和对战时限 API，`src/server/routes/app-config.ts` 通过 `/api/config` 暴露公开 `siteStatus`、`features.battleEntries` 与 `features.battleTimeouts`。新联机对局在 `src/server/services/online-room-service.ts` 开局时冻结当时配置，进行中对局继续使用自身快照；入口位只控制 `HomePage` 和 `GameSetupPage` 的导航发现，不改变赛季生命周期、队列运行态，也不卸载跨页面候场层。相关数据库增量由 `drizzle/0027_add_player_battle_entry_visibility.sql`、`drizzle/0029_maintenance_mode_three_state.sql` 与 `drizzle/0030_add_global_battle_timeout_config.sql` 提供
- 云端卡组与离线模式并存：已登录玩家使用服务端卡组记录；离线访客通过 `client/src/lib/localDeckStorage.ts` 把版本化 `LocalDeck` 列表保存到当前浏览器，并在 `DeckManager` / `DeckSelector` 中复用同一构筑校验与对局加载链路
- 正式联机房间闭环：创建/加入、云端卡组锁定、双方准备开始、开局猜拳与胜者决定先后手、服务端权威对局、轮询同步、请求式重开、主动认输、房间号只读观战、离开/短暂恢复与管理员房间观测。认输由 `GameSession` 以 `OPPONENT_SURRENDER` 结束权威对局，公开投影仅暴露终局原因与胜负席位，记录服务封存为 `SURRENDERED`；赛后离开会释放真人对局占用。普通玩家专用观战链接已完整移除。房间号观战默认开放双方玩家视角，观战会话可在当前已授权视角间切换；preferred 目标按玩家身份保存，授权 fallback 只改变 effective 目标。普通观战资格和会话绑定不可复用的房间代际，当前 match/席位只是可替换单局绑定：双方接受重开后返回结构化局间等待，新局创建后按原玩家身份重新解析席位并自动续看；房间关闭、等待期间参赛成员变化、会话过期或全部授权关闭会稳定终止旧资格。同一房间最多 10 个活跃普通观战会话，等待会话继续占名额，管理员单局观战不占公开名额且不跨局；恢复会话、快照、公开日志与视角切换共享服务端请求限流。普通观战采用请求完成后再计时的串行轮询与会话级退避，频率保护或短暂网络中断时保留最后有效桌面并自动恢复；跨局时以房间/绑定代际隔离响应，客户端等待时清空旧单局 store 与日志，新局完整投影到达后再建立桌面
- 单局文字与快捷表情通信：`src/online/chat-types.ts` 以 `TEXT | EMOTE` 判别联合维护共享条目契约和表情资源快照；`src/server/services/match-emote-catalog-service.ts` 通过数据库不可变版本和 active pointer 管理 1–12 项运营目录，重编码后的内容寻址 WebP 由对象存储提供，管理员可在 `MatchEmotesAdminPage` 排序、改名、停用和替换资源，`/api/config` 公开当前启用目录。`src/server/services/online-match-chat-runtime.ts` 维护按 `matchId` 隔离的有界内存消息、幂等标识、游标分页、文本校验、综合限频和表情冷却；新表情发送直接校验目录版本与启用状态并固化资源快照。`src/server/services/online-match-service.ts` 复用参与者身份与观战会话/代际授权，`src/server/services/online-room-service.ts` 阻止已退出成员被迟到轮询重新激活，`src/server/routes/online.ts` 提供当前房间成员读写和观战只读 REST 入口。前端由 `client/src/components/game/MatchChat.tsx` 独立轮询并渲染共同时间流，`client/src/components/game/MatchEmoteVisual.tsx` 按 reduced-motion、页面可见性与视口状态选择静态或动画资源，`GameBoard` / `PlayerArea` 只声明席位身份锚点。目录与资源元数据持久化；局内消息不写入 `GameState`、公共事件、历史记录或回放，重开、双方离开销毁旧对局运行态或 API 服务重启后不恢复
- 运营角色与管理中心开发基线：`src/shared/auth/permissions.ts` 定义 `user / season_admin / admin` 和显式权限矩阵，`src/server/middleware/require-permission.ts` 为特权请求复核数据库当前角色。`client/src/components/admin/AdminCenterPage.tsx` 按权限投影平台运营中心或赛季运营中心，平台管理员可通过 `client/src/components/admin/UserAdminPage.tsx` 分页检索账号，并在角色下拉菜单中直接保存变更。赛季管理员复用平台管理员历史页查看全部历史记录及双方玩家视角的只读回放，列表可按排位赛季或娱乐模式活动筛选，但原始回放包导出继续要求 `platform.manage`。`src/server/services/admin-user-service.ts` 负责角色并发保护、最后管理员保护和刷新令牌撤销；角色修改不要求原因或持久审计。数据库增量由 `drizzle/0028_add_season_admin_role.sql` 提供赛季管理审计表骨架。排位、主题赛季和入口权限已经下放，但全部赛季写操作持久审计、破坏性操作原因与完整 E2E 尚未完成，因此当前不得向真实运营账号分配 `season_admin`
- AI 私密配置：`src/server/services/ai-effect-extraction-service.ts` 以 PostgreSQL 单例和 revision 事务审计保存运行时配置，使用部署主密钥加密 API Key，并在每次候选测试或提取时执行上游允许列表、DNS 私网阻断、HTTPS、禁重定向、超时、大小、并发和管理员级限频。浏览器只向 `/api/ai-effect-extraction/admin/extract` 提交 `cardCode`，服务端读取 `cards` 与 MinIO 卡图，返回文本只进入 `CardEditModal` 待确认状态；旧 Vite DashScope 代理已经移除
- 公共牌桌 Beta：`src/server/services/public-table-service.ts` 以 PostgreSQL 候场票据和配对预留实现 FIFO 候场、双方确认、锁定卡组快照与超时清理；房间创建使用带代际校验的短租约和有限重试，旧创建者不能覆盖接管后的房间。`src/server/services/gameplay-participation-service.ts` 约束用户不能同时处于候场、房间或对局；确认成功后由 `src/server/services/online-room-service.ts` 创建封闭的公共牌桌房间，双方需在 60 秒内到场才进入猜拳，超时则结束本次开局，并复用正式联机认输、观战和记录链路。`client/src/components/public-table/PublicTableGlobalLayer.tsx` 和 `client/src/components/pages/PublicTablePage.tsx` 负责跨页面候场状态、确认及单次自动进入房间，持久化 schema 由 `src/server/db/schema.ts` 与 `drizzle/0008_add_public_table_beta.sql`、`drizzle/0010_add_ranked_system.sql` 对齐
- 赛季排位首版：`src/server/services/public-table-service.ts` 复用票据/预留状态机并以 `queueKind + seasonId + competitiveEnvironmentId` 隔离休闲与排位候场；`src/server/services/online-room-service.ts` 按房间代际去重开局并补偿预留、赛季、占用和票据绑定，断线裁定以持久状态和在线代际共同防止重连竞态。`src/server/services/ranked-player-service.ts` 提供赛季总览、固定窗口准入、个人战绩和排行榜，`src/server/services/ranked-rating-service.ts`、`src/server/rating/ranked-rating.ts` 与 `src/server/rating/ranked-ledger.ts` 负责权威结果幂等结算、版本化积分调度、迟到结果重建和追加式更正，`src/server/services/ranked-runtime-service.ts` 先排空可靠结算，再终止到期运行态并执行平台无结果收口。前端由 `client/src/store/rankedStore.ts`、`client/src/components/pages/RankedPage.tsx` 和 `client/src/components/ranked/RankedGlobalLayer.tsx` 提供跨页面候场闭环；管理员由 `client/src/components/admin/RankedAdminPage.tsx` 管理赛季及纯文本公告、查看候场/运行/结算健康与赛季经营分布、按用户查询当前评分、RD、场数与独立定级/参榜进度，并在排名上下文表中为目标及上下各最多 3 名逐行展示胜负与当前 `ACTIVE` 发布口径下的最常用卡组分类、按状态分页检索排位对局并核对双方加减分，以及执行带签名预览的异常结算和参数回算，聚合读取由 `src/server/services/ranked-admin-service.ts` 提供。玩家上下文以单条 SQL 读取当前 `ledgerRevision`、榜单窗口中每名玩家的有效排位结果与当前分类发布/assignment，在 API 层分别聚合胜负与最常用分类，不创建额外排名、胜负或最常用投影副本。排位基线、评分修订和赛季公告数据库结构分别由 `drizzle/0010_add_ranked_system.sql`、`drizzle/0017_add_ranked_rating_revisions.sql`、`drizzle/0018_add_ranked_season_announcement.sql` 提供。名为 V1 的首个生产赛季当前使用 `GLICKO1_PER_MATCH_V3`；未来新赛季默认 V4，使用 `ratingScale=800 / minimumRD=100 / 5 场定级 / 1800 中心成长池`，详见 [V4 评分设计](matchmaking-and-ladder/RANKED_V4_RATING_DESIGN.md)。V2→V3 停机迁移文档保留为历史运维与审计资料
- 排位单方操作超时：`src/online/ranked-stall.ts` 从权威 `GameState` 识别当前唯一责任玩家和稳定等待键；`src/server/services/online-match-service.ts` 按对局冻结的 `battleTimeouts` 维护不进入 checkpoint/回放的窗口开始时间、截止时间与代际，只有责任玩家成功命令才复位；`src/server/services/online-room-service.ts` 复用排位持久裁定权并在数据库等待后复核等待键、责任玩家、代际和截止时间，再执行权威判负。玩家快照只增加责任席位、窗口开始时间、截止时间和终局判负原因，`client/src/components/game/RankedStallNotice.tsx` 最多在最后 1 分钟提供非阻塞提示；非排位、观战和历史回放不启用该计时
- 轮换主题牌桌第一版：`src/server/services/theme-table-admin-service.ts` 冻结主题赛季和服务端预组，支持未结束赛季的云端卡组/YAML 加入、版本化编辑和移出卡组池，并自动生成同卡组内战及不同当前预组间的等权组合；旧预组通过 `retired_at` 留存供既有分配审计。`src/server/services/theme-table-allocation-service.ts` 在双方确认后的事务内冻结组合、座位和票据卡组，`src/server/services/theme-table-recovery-service.ts` 处理开局前责任方离场或未到场后的无过错回队。`src/server/services/theme-table-player-service.ts` 按主题分配与权威终局聚合本人胜负，不建立主题积分或榜单。玩家入口由 `client/src/store/themeTableStore.ts`、`client/src/components/pages/ThemeTablePage.tsx` 和 `client/src/components/theme-table/ThemeTableGlobalLayer.tsx` 提供；卡组池使用响应式卡图卡册并复用 `CardDetailDrawer`，抽屉统一通过 `useDialogAccessibility` 约束焦点、关闭和滚动。管理员界面复用 `AdminPageHeader`、`AdminViewTabs`、`SeasonOpenWindowsFields` 和共享 `CardEditor`，主页面位于 `client/src/components/admin/ThemeTableAdminPage.tsx`。数据库结构由 `drizzle/0026_add_theme_table_v1.sql` 提供；当前仅为开发/内测基线
- 赛季环境卡牌与卡组统计：`src/server/services/ranked-deck-observation-service.ts` 在排位注册的可串行化事务中原子保存双方主卡组最小事实，以基础卡号合并罕度并生成稳定构筑指纹；`src/server/services/ranked-environment-service.ts` 只聚合最终 `SETTLED` 且两席事实完整的对局，目标接口在不读取卡组分类发布/assignment 的前提下，为使用占比、胜者构成和高排名玩家三个 TAB 各自独立计算 Top 30。使用占比和胜者构成支持卡牌板块自身的玩家等权/对局等权设置，高排名玩家固定先归一化每名玩家后再玩家等权；胜者构成表达胜方卡组包含了哪些卡，不是卡牌胜率。其上的 `deck-classifier-engine / release / admin-service / worker` 以人工覆盖、精确样板、严格规则、加权相似度的顺序生成版本化派生结果，新发布只有全量成功才原子替换旧 `ACTIVE`；`ranked-deck-archetype-environment-service.ts` 通过 `/api/ranked/environment/decks` 提供玩家等权、对局等权、胜者构成、胜率、非镜像胜率及当前排行榜前 N 名玩家的等权赛季卡组构成。单例展示设置为卡组与卡牌分别保存展示内容/基础计权，只共享 N；任一板块全部关闭时只在自身聚合前返回空结果。`client/src/components/pages/RankedPage.tsx` 分别按两组启用内容展示最多三个 TAB、样本量、覆盖率和明细表格；管理员可从排位对局详情将同一长期事实直接导入分类样板。长期事实由 `drizzle/0020_add_ranked_deck_observations.sql` 提供，开发分支分类结构最终由单一 `0032_add_deck_classifier.sql` 提供；能量卡组与逐张实例不属于长期事实。详见[赛季排位卡组分类与环境饼图](matchmaking-and-ladder/RANKED_DECK_CLASSIFIER.md)
- 玩家徽章：`src/server/player-badges/award.ts` 在正常结算、迟到结果重建和追加式更正的评分事务中按持久规则幂等授予首届排位 3 场纪念徽章，并将第 3 场有效对局作为证据；`src/server/services/player-badge-service.ts` 与 `/api/player-badges/me` 只提供本人读取。`client/src/components/player-badges/BadgeShelf.tsx` 在个人中心展示可扩展徽章栏；历史补发由 `drizzle/data-migrations/award-first-ranked-season-badge.ts` 在显式校验赛季和 ledger revision 后执行
- 玩家游戏桌壁纸：`src/server/services/player-wallpaper-service.ts`、`src/server/routes/player-wallpapers.ts` 与 `drizzle/0024_add_player_wallpapers.sql` 在独立私有 MinIO bucket 和 PostgreSQL 中维护本人壁纸、北京时间每日发布额度、幂等结果与管理员移除审计；`client/src/store/playerWallpaperStore.ts` 只在当前账号会话内加载鉴权 Blob，`client/src/components/game/BoardBackground.tsx` 为个人中心预览和所有共享 `GameBoard` 提供同一背景层。壁纸不进入权威对局、玩家投影、checkpoint、历史或回放；详细边界见[玩家游戏桌壁纸设计](player-wallpaper/design.md)
- 赛季活动大封面：`src/server/services/activity-cover-service.ts` 与 `drizzle/0034_add_activity_covers.sql` 以 `activityType + activityId` 保存排位／娱乐模式的单行当前配置、revision、最后一次幂等和公共不可变对象引用；发布先写入规范化母图及宽屏／紧凑成品，再在同一 PostgreSQL 事务中切换引用并写入 `management_audit_logs`。`src/server/services/static-image-processing-service.ts` 为活动封面与玩家壁纸提供无业务归属的图片校验、规范化、裁切和共享处理并发底座；`src/server/routes/activity-covers.ts` 按活动类型复核当前权限。玩家主投影只返回当前布局资源与显示参数，`client/src/components/activity-cover/ActivityCoverHero.tsx` 负责响应式切槽和默认视觉降级，管理页共用 `ActivityCoverEditor.tsx`。封面不进入赛季竞技环境、候场、房间、对局、历史或回放；孤立对象扫描、真实对象存储集成和完整视觉／E2E 仍是生产上线前边界，详见[活动大封面需求与设计](matchmaking-and-ladder/SEASON_ACTIVITY_COVER_REQUIREMENTS_AND_DESIGN.md)
- 赛季内评分参数修订：`src/server/services/ranked-rating-revision-service.ts` 以受限白名单从 V3/V4 当前冻结 config 构造唯一新修订，签名 dry-run 绑定 config 哈希、流水 revision、原因和操作人；应用在暂停排位且运行态/冻结环境校验通过后，以可串行化事务追加每场最新指令、重建玩家投影和单局 before/after 快照，并将完整新旧 config 与预览摘要保存在 `ranked_rating_revisions`。详见[参数修订与全量回算](matchmaking-and-ladder/RANKED_RATING_PARAMETER_REVISION.md)。
- 维护期间新对局限制：`src/server/middleware/require-gameplay-available.ts` 会在维护或限制新开局状态下拦截新建/加入房间、准备开局、开局流程、重开接受和服务端对墙打创建/重开；进行中对局的快照、命令、观战、回放和离开入口不被主动中断
- 服务端可记录对墙打：`src/server/services/solitaire-match-service.ts` 复用 recorded match 链路创建 `GameMode.SOLITAIRE` 权威对局，并在重开时封存旧局、沿用锁定卡组快照创建新的 `matchId`；`client/src/lib/solitaireMatchRecovery.ts` 在同一浏览器标签页保存当前对墙打 matchId 并在刷新或重开后同步恢复目标，`src/server/services/solitaire-runtime-recovery-service.ts` 可在运行态缺失时从最新 authority checkpoint 和公共事件尾部恢复运行中对墙打，`src/server/routes/battle.ts` 提供对墙打创建、重开、运行中快照/命令/推进/离开、公共事件增量读取，以及中性历史读取入口
- 面向联机的 `PlayerViewState` 脱敏投影、可见性策略和命令权限投影
- 运行中对局公共日志：`src/application/game-session.ts` 维护 `PublicEvent` 序列；正式联机 `/api/online/matches/:matchId/public-events`、正式联机观战 `/api/online/spectator-links/:token/public-events` 与对墙打 `/api/battle/solitaire-matches/:matchId/public-events` 按 `afterSeq` 返回公共事件增量，单次响应受 `ONLINE_PUBLIC_EVENTS_MAX_BATCH` 保护并在截断时返回 `truncated/droppedEventCount`，运行中 snapshot 继续只承载当前玩家视图，并以 `currentPublicSeq` 暴露公共日志增量水位
- 对局记录与回放阶段性闭环：`src/server/services/match-recorder-service.ts` 写入历史根记录、卡组快照、timeline、authority checkpoint、public/private event 与部分 decision record；`src/server/services/match-replay-read-service.ts` 按参与者玩家视角读取正式联机与服务端可记录对墙打的历史列表、详情、timeline 与只读 checkpoint 投影；完整回放默认保留 10 天，`src/server/services/replay-retention.ts` 统一停机脚本与管理员页面使用的候选统计、排位观察阻断、批量行锁和元数据降级语义，`drizzle/data-migrations/purge-expired-match-replay-data.ts` 保留默认 dry-run 的停机入口。`src/server/services/platform-operations-service.ts`、`ranked-analysis-export.ts` 与 `client/src/components/admin/PlatformOperationsPage.tsx` 提供平台管理员预览、显式确认清理和赛季匿名原始分析 ZIP 下载；导出查询边界只包含 `ranked_*` 规范化事实，卡组来自长期 `ranked_deck_observations`，不触及 checkpoint、完整对局记录或回放数据。`client/src/components/pages/MatchRecordsPage.tsx` 可打开只读 `GameBoard` 回放节点，并为已清理记录只展示元信息

### 10.2 规划中

- WebSocket/SSE 等实时传输增强（当前正式联机使用短间隔 HTTP 轮询）
- 对局记录与回放后续增强：正式联机进程重启后恢复运行中对局、对墙打恢复后的更细粒度追赶、完整随机记录、完整决策覆盖、自由拖拽/手动处理原因结构化、确定性重演、逐命令动画、公开分享回放与长期兼容策略
- 更完整的自动能力编排与检查时机接线
- 更高覆盖的性能与稳定性专项测试
- V4 新赛季上线前的历史对局回放验证、外部告警渠道和跨日运营趋势
- 轮换主题牌桌的真实预组试打、完整组合指标与告警、进行中房间跨进程恢复、双浏览器验收和生产开放

---

## 11. 文档维护约定

- 本文档为“设计文档”，新增已实现模块时需补充对应代码路径
- 本文档维护系统全景、分层职责、状态机和模块入口；运行时数据结构关系、命令/卡效/LIVE/recorder 链路和跨模块不变量维护在 `docs/runtime-data-flow-and-algorithm-chain.md`
- 架构和流程图统一使用 Mermaid
- 需求变更先更新需求文档，再同步更新本设计文档
- 与外部系统强耦合时，需在相关模块文档中补充原始链接
