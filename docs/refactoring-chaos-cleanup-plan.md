# 重构方案：混乱源排查与治理计划

> 日期：2026-03-26  
> 输入基线：`docs/PROJECT_REQUIREMENTS.md`、`docs/refactoring-notes.md`

## 1. 排查结论（混乱源清单）

### P0. Live Set 存在“双路径并行”与重复副作用

**现象**
- `SKIP_LIVE_SET` 路径会做“完成标记 + 抽卡”。
- `CONFIRM_SUB_PHASE -> LIVE_SET_*_DRAW` 路径也做“完成标记 + 抽卡”。
- `GameService.processAction` 还对 `SKIP_LIVE_SET` 做额外推进阶段特殊处理。

**代码证据**
- `src/application/action-handlers/live-set.handler.ts:71`（`handleSkipLiveSet` 标记完成+抽卡）
- `src/application/action-handlers/phase-ten.handler.ts:116`（`DRAW_CARDS_FOR_LIVE_SET` 标记完成+抽卡）
- `src/application/game-service.ts:302`（`SKIP_LIVE_SET` 专用 bothCompleted 后处理）

**风险**
- 同一规则多处实现，修一个漏一个。
- solitaire 自动跳过依赖路径差异，容易出现“某一条流程卡住”。

---

### P0. “当前行动玩家”存在双真相（`activePlayerIndex` vs sub-phase 推导）

**现象**
- `shared/phase-config` 已支持 `DERIVE_FROM_SUB_PHASE`，可从子阶段推导行动玩家。
- `game-session` 仍通过 domain 的 `getActivePlayer()` 读取 `activePlayerIndex` 判定是否对手回合。
- `applySubPhaseTransition` 仅更新 `currentSubPhase`，不更新 `activePlayerIndex`。

**代码证据**
- `src/shared/phase-config/active-player.ts:24`（统一判定入口）
- `src/application/game-session.ts:254`、`src/application/game-session.ts:264`（仍用 `getActivePlayer`）
- `src/application/phase-manager.ts:371`（子阶段切换不更新 activePlayer）
- `src/domain/entities/game.ts:456`（`getActivePlayer` 只依赖 activePlayerIndex）

**风险**
- 同一时刻不同模块看到的“当前玩家”不一致，导致权限判断和自动流程不稳定。

---

### P1. solitaire 自动跳过为硬编码分支链（脆弱且不可扩展）

**现象**
- `handleSolitaireAutoSkip` 采用固定 if/switch 链，按动作和阶段逐条匹配。
- 同时混用 `SKIP_LIVE_SET` 与 `CONFIRM_SUB_PHASE` 两种触发方式。

**代码证据**
- `src/application/game-session.ts:277`（入口）
- `src/application/game-session.ts:300`（`SKIP_LIVE_SET` 分支）
- `src/application/game-session.ts:362`（`LIVE_SET_SECOND_PLAYER` 的 `CONFIRM_SUB_PHASE` 分支）

**风险**
- 新增阶段/子阶段时容易遗漏分支。
- 顺序耦合强，行为依赖“先命中哪个 if”。

---

### P1. `processAction` 后处理职责过重，成为隐式流程总线

**现象**
- `processAction` 内包含多类后处理：
  - `END_PHASE` 特判
  - `SKIP_LIVE_SET` 特判
  - `FINALIZE_LIVE_RESULT` 特判
  - `SHOULD_ADVANCE_PHASE` 特判
  - `executeCheckTiming`

**代码证据**
- `src/application/game-service.ts:288`
- `src/application/game-service.ts:302`
- `src/application/game-service.ts:334`
- `src/application/game-service.ts:347`

**风险**
- 新机制接入必须改核心入口，回归面扩大。
- handler 与 service 的职责边界持续模糊。

---

### P2. “配置化阶段系统”未完全落地，存在配置与执行双写

**现象**
- 阶段配置里存在 `initialSubPhase`，但没有被执行路径消费。
- `GameService.advancePhase` 仍手动写死多个阶段的子阶段初始化与特殊流程。

**代码证据**
- `src/shared/phase-config/phase-registry.ts:372`（`getInitialSubPhase` 仅定义）
- `src/application/game-service.ts:443`（手工设置 LIVE_SET 子阶段）
- `src/application/game-service.ts:466`（手工设置 PERFORMANCE 子阶段并立即跳到 JUDGMENT）
- `src/application/game-service.ts:486`（手工设置 RESULT 子阶段）

**风险**
- 配置不是单一事实来源，维护者难以判断“应该改配置还是改 service 代码”。

---

### P2. 遗留状态机函数未移除，增加认知噪音

**现象**
- domain 仍保留旧式 `getNextPhase` switch 状态机，但主流程已用 `PhaseManager`。

**代码证据**
- `src/domain/entities/game.ts:916`（遗留 `getNextPhase`）
- 主流程入口为 `src/application/phase-manager.ts:84` + `src/application/game-service.ts:404`

**风险**
- 新人容易误用遗留 API，造成“同名不同机制”。

---

### P0. 缺失 solitaire 模式测试护栏

**现象**
- `tests/` 中无 `SOLITAIRE` 关键字覆盖。
- 现有集成/模拟测试未覆盖“玩家操作后对手自动跳过”主链路。

**代码证据**
- 全局检索：`rg -n "GameMode\\.SOLITAIRE|SOLITAIRE" tests` 无结果。

**风险**
- 该模式未来仍会出现“测试全绿但线上卡住”的回归。

---

## 2. 重构目标（本轮）

1. 建立单一路径：Live Set 只保留 `CONFIRM_SUB_PHASE` 机制。  
2. 建立单一行动玩家真相：所有“可行动玩家”判断统一走 phase-config。  
3. 将 solitaire 自动跳过从硬编码改为声明式。  
4. 将 `processAction` 降级为通用事件调度器，移除动作特判。  
5. 先补测试再重构，确保每一步可验证。

## 3. 分期实施方案

### Phase 0（先做，1 天）：测试护栏

**任务**
- 新增 `tests/integration/solitaire-flow.test.ts`，覆盖：
  - Mulligan 自动跳过
  - 对手通常阶段自动推进+自动结束主要阶段
  - Live Set（`CONFIRM_SUB_PHASE`）后对手自动跳过
  - Performance 对手自动跳过
  - Live Result 对手效果窗口自动跳过
- 新增“多回合不卡死”断言（迭代上限、阶段可继续推进）。

**验收标准**
- 能稳定复现并防止“后攻盖牌卡住”类问题。

### Phase 1（P0，1-2 天）：消除 Live Set 双路径

**任务**
- 废弃 `SKIP_LIVE_SET` 主路径：
  - UI（`PhaseIndicator`/`gameStore`）统一只发 `CONFIRM_SUB_PHASE`。
  - `game-session` 的 live set 自动跳过统一使用 `CONFIRM_SUB_PHASE`。
- 删除 `processAction` 对 `SKIP_LIVE_SET` 的 bothCompleted 特判。
- 删除 `handleSkipLiveSet` 中“完成标记+抽卡”副作用（可先保留兼容壳，仅转发为 sub-phase confirm）。

**验收标准**
- Live Set 抽卡、完成标记、阶段推进只在一条链路发生。

### Phase 2（P0，1-2 天）：统一行动玩家判定

**任务**
- `GameSession.isActivePlayer()` 改为调用 `shared/phase-config/isPlayerActive`。
- `PhaseManager.applySubPhaseTransition()` 同步更新 `activePlayerIndex`，或引入显式 `deriveActivePlayerIndexFromSubPhase`。
- 清理直接依赖 `getActivePlayer()` 的判定路径，仅在展示用途读取。

**验收标准**
- 所有权限判断/自动跳过/按钮可用性在同一状态下结论一致。

### Phase 3（P1，2 天）：重构 `processAction` 为事件管线

**任务**
- 定义统一事件类型（如 `ADVANCE_PHASE`、`FINALIZE_LIVE_RESULT`、`RUN_CHECK_TIMING`）。
- handler 只负责“状态变更 + 事件发射”；`processAction` 统一按顺序执行事件。
- 移除动作名驱动特判分支（`END_PHASE` 除外也建议转事件化）。

**验收标准**
- 新增阶段后处理无需修改 `processAction` 主干。

### Phase 4（P2，2 天）：收口配置与执行双写

**任务**
- 让 `initialSubPhase` 真正生效（由 `advancePhase` 统一读取配置初始化）。
- 将 `PERFORMANCE` / `LIVE_RESULT` 的子阶段入口逻辑迁移到子阶段 auto-action/事件中，减少 `game-service` 内硬编码。
- 删除或明确标记遗留 API：`domain/entities/game.ts#getNextPhase`。

**验收标准**
- 阶段入口行为主要由 `phase-config` + `sub-phase-registry` 驱动。

## 4. 变更影响面（文件级）

- 核心：
  - `src/application/game-service.ts`
  - `src/application/game-session.ts`
  - `src/application/phase-manager.ts`
  - `src/application/action-handlers/live-set.handler.ts`
  - `src/application/action-handlers/phase-ten.handler.ts`
- 配置层：
  - `src/shared/phase-config/active-player.ts`
  - `src/shared/phase-config/phase-registry.ts`
  - `src/shared/phase-config/sub-phase-registry.ts`
- 前端：
  - `client/src/store/gameStore.ts`
  - `client/src/components/game/PhaseIndicator.tsx`
- 测试：
  - `tests/integration/`（新增 solitaire flow）
  - `tests/unit/`（补 action/event 管线单测）

## 5. 风险与回滚策略

- 风险 1：行动玩家统一后，历史依赖 `activePlayerIndex` 的 UI 细节可能变化。  
  - 应对：先加断言测试，再分模块切换。  
- 风险 2：去除 `SKIP_LIVE_SET` 后老入口失效。  
  - 应对：保留 1 个版本兼容 shim（日志告警+内部转发）。  
- 风险 3：事件管线改造影响面广。  
  - 应对：按事件类型逐个迁移，每步运行单测+集成测试。

## 6. 建议执行顺序

1. 先补 solitaire 集成测试（Phase 0）。  
2. 再砍 Live Set 双路径（Phase 1）。  
3. 统一行动玩家判定（Phase 2）。  
4. 最后做事件管线和配置收口（Phase 3/4）。

