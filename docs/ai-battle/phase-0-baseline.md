# AI 对战 Phase 0 验收基线

> 基线版本：`ai-battle.phase-zero/v1`
>
> 状态：**COMPLETE**；内容身份、卡组规则认证、场景矩阵、保守窗口政策和数值门槛均已冻结
>
> 日期：2026-07-27

## 已冻结内容

卡组内容统一使用 `loveca.deck-content/v1` canonical schema 和 SHA-256。规范化会保留标准化后的精确印刷编号与罕度，分别处理成员、LIVE、能量分区；同分区重复条目先合并数量，再按不依赖系统 locale 的字符串 code-unit 升序排列；`player_name`、`description` 和 YAML 书写顺序不参与哈希。

唯一实现入口：

- canonical 结构与序列化：[`src/domain/card-data/deck-canonical.ts`](../../src/domain/card-data/deck-canonical.ts)
- 内容身份：[`src/server/services/deck-content-hash.ts`](../../src/server/services/deck-content-hash.ts)
- 机器可读 Phase 0 基线：[`src/server/ai-battle/phase-zero-baseline.ts`](../../src/server/ai-battle/phase-zero-baseline.ts)
- 逐能力段行为证据：[`src/server/ai-battle/phase-zero-ability-evidence.ts`](../../src/server/ai-battle/phase-zero-ability-evidence.ts)
- 卡文逐段认证：[`tests/unit/ai-battle-phase-zero-card-effect-registration.test.ts`](../../tests/unit/ai-battle-phase-zero-card-effect-registration.test.ts)
- 八单元 RULES 基线：[`tests/integration/ai-battle-phase-zero-rules-baseline.test.ts`](../../tests/integration/ai-battle-phase-zero-rules-baseline.test.ts)

冻结身份：

| 卡组键                | 资产                                                                   | 内容哈希                                                                  |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `MUSE_STARTER`        | [`assets/decks/缪预组.yaml`](../../assets/decks/缪预组.yaml)           | `sha256:e81261ca02cfff6a7b8b010c3c0738d2127cbd6d782ed91568ac825d883d4095` |
| `GREEN_HASUNOSORA_B6` | [`assets/decks/绿莲-6弹ver.yaml`](../../assets/decks/绿莲-6弹ver.yaml) | `sha256:6faaac83a8205280eb1066d44f524da9838e5fcb3023f431d629e4979895f118` |

固定机器参赛者技术身份意图为 `loveca-ai-standard-v1`，类型为 `SYSTEM`，不可登录。本阶段只冻结该身份契约，不声称已经实现正式联机的 SYSTEM 授权或登录隔离；对应运行时边界仍是 Phase 3 门槛。本基线不冻结展示名称、美术或 Persona。

## 认证版本键

认证不是永久布尔值。`ai-battle.phase-zero/v1` 当前绑定：

| 维度             | 冻结值                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| 规则引擎版本     | `3.9.1`                                                                   |
| 日文权威卡牌数据 | `sha256:4b7f3abc93ec10ba86a2bf0090c9b3475a0846b52075728d545f55a168ef353d` |
| 场景矩阵         | `ai-battle.phase-zero-matchups/v1`                                        |
| 验证配置         | `ai-battle.phase-zero-validation/v1`                                      |
| 能力证据         | `ai-battle.phase-zero-ability-evidence/v1`                                |
| typed 决策契约   | `NOT_IMPLEMENTED_PHASE_ZERO`                                              |

规则版本、权威卡牌数据、卡组内容、definition 集合、能力证据、场景矩阵或验证配置任一变化，都必须提升对应版本或更新冻结 hash，并重新运行 Phase 0 gate。Phase 1A 落地后才以真实契约/适配器版本替换 `NOT_IMPLEMENTED_PHASE_ZERO`。

## 首批八个基础单元

所有单元均使用 `RULES`，玩家卡组和 AI 卡组的角色不可互换省略：

| 场景 ID                    | 玩家卡组  | AI 卡组   | AI 顺序 |
| -------------------------- | --------- | --------- | ------- |
| `muse-vs-muse-ai-first`    | μ's 预组  | μ's 预组  | 先手    |
| `muse-vs-muse-ai-second`   | μ's 预组  | μ's 预组  | 后手    |
| `muse-vs-green-ai-first`   | μ's 预组  | 绿莲 6 弹 | 先手    |
| `muse-vs-green-ai-second`  | μ's 预组  | 绿莲 6 弹 | 后手    |
| `green-vs-muse-ai-first`   | 绿莲 6 弹 | μ's 预组  | 先手    |
| `green-vs-muse-ai-second`  | 绿莲 6 弹 | μ's 预组  | 后手    |
| `green-vs-green-ai-first`  | 绿莲 6 弹 | 绿莲 6 弹 | 先手    |
| `green-vs-green-ai-second` | 绿莲 6 弹 | 绿莲 6 弹 | 后手    |

八个单元均已通过可重复执行的权威流程基线：从日文权威卡牌数据建立 `CardDataRegistry`，由正式 `DeckLoader` 使用精确 YAML 内容构造两侧 runtime deck，在默认 `RULES` 中完成双方不换牌、先手主要阶段结束、后手主要阶段结束并进入 LIVE 设置阶段。该基线验证真实卡组资产、卡牌类型/数值装载、AI 席位顺序和共享 `GameSession` 流程；它不验证尚未实现的正式 SYSTEM participant 授权。完整机器整局已在 Phase 1C 以相同八单元和冻结边界完成独立认证。

## 卡组规则认证

认证以日文 [`llocg_db/json/cards.json`](../../llocg_db/json/cards.json) 卡文为权威输入，以 [`existing_module_map.md`](../card-effect-reuse-audit/existing_module_map.md) 为完成状态真值。自动认证会对两套卡组逐张执行：

- 从卡文行首标记提取登场、常时、起动、LIVE 开始、LIVE 成功和自动能力段，能力段多重集必须与 definitions 完全相同。
- 卡组中的精确印刷编号必须存在；同基础编号各公开罕度的完整日文卡文在规范化标点/空白后必须等价。整份权威日文卡牌数据由认证版本键中的 SHA-256 锁定，因此同类别内的卡文语义变化也会使 gate 失效。
- 每个 definition 必须为 `implemented`，具有非空效果文本，并按类别声明正确的队列/权威事件/起动输入元数据。
- definition 的来源区域必须与成员/LIVE 卡类型及能力类别一致；卡面上的中央位与每回合次数限制必须存在对应结构化元数据。
- definition 必须通过 `baseCardCodes` 覆盖基础编号，不允许用 exact `cardCodes` 缩窄同编号罕度。
- 对应基础编号必须在主登记册标为“完整已实现”或“同型已实现”。
- 每个 `baseCardCode + abilityId` 必须在能力证据清单中精确出现一次，并绑定至少一个实际存在的行为测试文件；其中至少一个文件必须直接包含该基础编号或 ability ID 作为可审计锚点，不能只指向未覆盖该卡的同族通用测试。definition 或认证卡组变化后，不允许保留遗漏或 stale 证据。

行为证据复用既有 focused suites，包括 `card-effect-classification`、`card-effect-rarity-sync`、`sample-card-effect-runner`、`discard-look-top-select-to-hand`、`live-start-discard-gain-heart`、`mill-top-gain-live-modifier`、`conditional-live-modifier`、`live-modifiers` 和 `live-judgment-settlement`。能力证据清单只记录测试依赖，不登记“完整/部分”状态；Phase 0 没有新增卡效 resolver，也没有把机器认证变成第二份卡效完成登记册。

逐段窗口映射不复制成另一张容易漂移的单卡表，而由以下权威来源组合得到：

| 维度        | 权威来源                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| 触发/来源区 | definition 的 `category`、`sourceZone`、`triggerCondition` 与槽位/方向过滤           |
| 费用        | definition 对应 workflow 使用的 `EffectCostDefinition`、费用 helper 或明确的可选步骤 |
| 候选        | workflow 使用的 selector、zone/stage selection helper 与结算时重验                   |
| 输入        | `queued`、`activatedUi`、pending ability、active effect 和对应 focused test          |
| 结算        | 主登记册记录的 card/shared workflow、runtime/effect helper 与 focused test           |

Phase 1A 已把这些已有规则能力投影为 typed 决策契约；Phase 0 只证明认证范围内不存在未登记、未实现或只能靠 `FREE` 补做的卡文段。

## 保守策略窗口冻结

本阶段只负责冻结策略选择；对应 typed contract 与策略执行器已分别由 Phase 1A/1B 实现：

| 窗口                             | 冻结选择                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 换牌                             | 不换牌                                                                                                                                                              |
| 主要阶段                         | 依次尝试 `PLAY_AFFORDABLE_MEMBER -> END_MAIN_PHASE`；成员按“可支付费用升序、投影手牌位置升序、lease 内候选 ID 升序”排序，槽位按左/中/右；起动能力按可选项默认不发动 |
| LIVE 设置                        | 合法 LIVE 按“投影手牌位置升序、lease 内候选 ID 升序”选择；仅在无合法候选且规则允许时确认空设置                                                                      |
| 可选效果/费用                    | 默认不发动                                                                                                                                                          |
| 纯确认                           | 继续处理                                                                                                                                                            |
| 强制单选、多选、排序、数字、站位 | 使用 typed contract 提供的稳定合法 witness                                                                                                                          |
| 分数确认                         | 提交 authority 计算值                                                                                                                                               |
| 成功 LIVE 选择                   | 按“投影 LIVE 区位置升序、lease 内候选 ID 升序”选择                                                                                                                  |
| 达到无进展边界                   | SYSTEM 认输并记录独立终局原因                                                                                                                                       |

活性政策区分两种进展。单窗口 watchdog 使用 `authorityStateProgress`：忽略 revision、日志和时间戳噪音，但纳入 phase/window/pending/active-effect step、区域、状态、资源、modifier、分数和终局变化。连续 AI 回合降级政策使用 `strategicRuleProgress`：只把区域/卡牌状态、资源、LIVE、成功区、牌库/休息室、分数或终局变化视为进展；单纯切换回合、纯确认、空换牌/空 LIVE 设置或只增长 revision 不算战略进展。冻结字段见 `AI_BATTLE_RULE_PROGRESS_POLICY`。

## 数值化验收门槛

阶段 1C 的普通 PR smoke 在每个基础单元运行 1 个固定成功种子，共 8 局；完整回归在 dedicated CI 中为每个基础单元运行 32 个确定性种子，共至少 256 局。不能用 PR smoke 代替完整认证。每局边界：

- 最多 80 回合、5,000 个决策。
- 单窗口最多 2 次结构修复重试。
- 最多 128 个连续无 `authorityStateProgress` 决策；不能把 revision 单独增长视为进展。
- 测试墙钟最多 30 秒。
- 接受非法命令、接受过期 lease、未捕获异常、watchdog/墙钟超限均要求为 0。

失败种子必须连同策略选择与规则随机事实进入永久回归语料；每个基础单元至少保留一个固定成功种子作为普通 PR smoke。

模型一次调用经过有限修复仍失败后，本局立即永久切换到保守策略。连续 3 个 AI 回合无规则进展、累计 256 个保守决策或降级持续 5 分钟任一先到时，由 SYSTEM 认输，并记录区别于玩家认输和基础设施崩溃的终局原因。

## Phase 0 gate 结论

Phase 0 已通过。完成判据是可在 CI 重复验证的内容身份、逐卡文能力段认证、主登记册完成状态、八单元 `RULES` 权威流程基线和冻结策略/数值矩阵。

早期草稿中的“真人在八个单元分别完成整局”不再作为 Phase 0 gate。它无法自动复验，而且完整机器整局依赖 Phase 1A 的 typed contract、Phase 1B 的调度/保守策略和 Phase 1C 的随机机器人；继续保留会形成阶段依赖倒置。真人整局仍可作为产品探索性验证，但不能替代上述自动认证，也不能用来宣称 Phase 1C 已通过。

后续阶段状态：

- Phase 1A：已完成 typed 决策契约、共源 validator、witness 与 sampler。
- Phase 1B：已完成单局串行调度、authority revision/lease、可执行保守策略与 SYSTEM 终局。
- Phase 1C：已完成规则随机事实边界、确定性种子、严格回放和 256 局 headless playout。
- Phase 2：已完成 allowlist observation、压缩规则、固定卡组 playbook、strategy context、无 LLM 可解释策略、`selected-history/v2` 精选可见历史、受限测试审计 artifact、策略质量指标和八单元各八个种子的 64 局专用回归。
- Phase 3：正式 SYSTEM 产品席位、内部受控接入与玩家入口仍待实现。
