# 框架重构备忘录

> 在修复对墙打模式"后攻盖牌卡住"bug 过程中发现的架构问题。按严重程度排序。

---

## 1. 阶段推进存在两套并行机制，职责不清

**现状**：LIVE_SET_PHASE 的完成有两条完全独立的代码路径：

| 路径 | 触发方式 | 标记完成 | 抽卡 | 推进阶段 |
|------|----------|----------|------|----------|
| `SKIP_LIVE_SET` handler | action handler 内部 | `liveSetCompletedPlayers.push` | handler 内循环抽卡 | `processAction` 特殊处理 `bothCompleted` |
| `CONFIRM_SUB_PHASE` → `LIVE_SET_*_DRAW` auto-action | sub-phase 自动链推进 | `executeSubPhaseAutoAction` 中标记 | auto-action 中抽卡 | `SHOULD_ADVANCE_PHASE` 事件驱动 |

**问题**：
- 两条路径做了完全相同的事情（标记完成 + 抽卡），但实现分散在不同文件
- `processAction` 里有一段 `SKIP_LIVE_SET` 的硬编码特殊处理（检查 `bothCompleted` 后手动调 `advancePhase`），这段逻辑与 sub-phase 系统的 `SHOULD_ADVANCE_PHASE` 事件机制完全重复
- UI 实际走的是 `CONFIRM_SUB_PHASE` 路径，`SKIP_LIVE_SET` 路径可能已经是死代码
- 本次 bug 就是因为 solitaire 跳过逻辑只处理了路径 A，没处理路径 B

**建议**：选定一条路径作为唯一正统机制。推荐保留 sub-phase 路径（`CONFIRM_SUB_PHASE`），因为它是更通用的声明式机制。然后：
- 将 `SKIP_LIVE_SET` 改为仅放置卡牌的辅助动作（或直接删除，用 `CONFIRM_SUB_PHASE` 替代）
- 移除 `processAction` 中 `SKIP_LIVE_SET` 的 `bothCompleted` 特殊分支

---

## 2. `activePlayerIndex` 与子阶段的活跃玩家不同步

**现状**：`GameState.activePlayerIndex` 只在主阶段转换（`applyTransition`）时更新。子阶段转换（`applySubPhaseTransition`）只更新 `currentSubPhase`，不更新 `activePlayerIndex`。

导致两套"谁是当前活跃玩家"的判断：
- `getActivePlayer(game)` → 用 `game.activePlayerIndex`（domain 层）
- `isPlayerActive(game, id)` → 用 sub-phase config 推导（phase-config 层）

**问题**：
- `game-session.ts` 的 `isActivePlayer()` 用的是 `getActivePlayer()`（基于 `activePlayerIndex`），在 `DERIVE_FROM_SUB_PHASE` 策略的阶段中结果是错的
- 不同调用方拿到的"活跃玩家"可能不一致，极易引发 bug
- 本次 bug 中，即使加了"对手是否活跃"的通用检查也不会生效，因为 `activePlayerIndex` 没反映子阶段的玩家切换

**建议**：`applySubPhaseTransition` 应同步更新 `activePlayerIndex`；或者废弃 `activePlayerIndex` 字段，全部统一走 `isPlayerActive()` 推导。

---

## 3. `handleSolitaireAutoSkip` 是脆弱的 switch-case 枚举

**现状**：每个需要跳过的对手阶段/子阶段都是一个硬编码的 `if` 分支（目前 6 个 case）。新增阶段或子阶段时必须手动在此处加 case，否则就会卡住。

**问题**：
- 违反开闭原则：新增子阶段需要改两个地方（sub-phase-registry + handleSolitaireAutoSkip）
- 容易遗漏：开发者加了新的需要对手操作的子阶段，不一定记得更新 solitaire 跳过逻辑
- Case 之间有隐含的执行顺序依赖

**建议**：改为声明式/通用机制。例如：

```typescript
// 每次 dispatch 后，检查结果状态：如果对手是活跃玩家且需要操作，自动跳过
private autoSkipOpponentIfNeeded(): void {
  while (this.isOpponentActive() && this.currentPhaseRequiresAction()) {
    this.dispatchSkipForCurrentPhase();
  }
}
```

Sub-phase config 中可以增加一个 `solitaireAction` 字段声明跳过方式，而非在 session 层硬编码。

---

## 4. `processAction` 承担了过多的阶段推进职责

**现状**：`game-service.ts` 的 `processAction` 在执行 action handler 之后，有大段的 post-processing：

```
handler 返回 → 检查 SKIP_LIVE_SET bothCompleted → 检查 FINALIZE_LIVE_RESULT →
检查 SHOULD_ADVANCE_PHASE → executeCheckTiming → 返回
```

**问题**：
- 每种需要"动作后推进阶段"的 action 都要在 `processAction` 里加特殊分支
- `SKIP_LIVE_SET` 有专门的 `bothCompleted` 检查，`END_PHASE` 有专门的 `advancePhase` 调用，`CONFIRM_SUB_PHASE` 通过事件间接推进——三种不同的推进触发方式
- 新增类似的"完成条件达成后推进"逻辑时，开发者需要在 handler、processAction、phase-registry 三处协调

**建议**：统一为事件驱动模式。Handler 只返回状态 + 事件列表，`processAction` 统一遍历事件列表执行后处理。`SKIP_LIVE_SET` 的 `bothCompleted` 检查应移入 handler 内部，由 handler 决定是否发出 `SHOULD_ADVANCE_PHASE` 事件。

---

## 5. 缺少 solitaire 模式的集成测试

**现状**：现有的 146 个测试全部通过，但没有一个测试覆盖 solitaire 模式的完整流程。本次 bug 在测试中完全不可见。

**建议**：在 `tests/integration/` 或 `tests/simulation/` 中增加 solitaire 模式的 game flow 测试，至少覆盖：
- 换牌阶段：玩家换牌后对手自动跳过
- 通常阶段：对手的 ACTIVE → MAIN 自动跳过
- **Live 设置阶段：玩家 CONFIRM_SUB_PHASE 后对手自动跳过**（本次 bug 场景）
- 演出阶段：对手演出自动跳过
- Live 结算阶段：对手效果子阶段自动跳过
- 连续多回合不卡死

---

## 优先级建议

| 优先级 | 项目 | 理由 |
|--------|------|------|
| P0 | #5 Solitaire 集成测试 | 成本低、立刻能防止回归 |
| P1 | #1 消除双重路径 | 当前最大的混乱源，下次改动还会踩坑 |
| P1 | #2 activePlayerIndex 同步 | 逻辑炸弹，随时可能在其他地方触发 |
| P2 | #3 声明式跳过机制 | 依赖 #1 #2 先完成 |
| P2 | #4 processAction 后处理统一 | 长期维护性问题 |
