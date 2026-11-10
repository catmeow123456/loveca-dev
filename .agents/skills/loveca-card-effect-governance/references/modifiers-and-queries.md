# 修正值与查询

适用：HEART、BLADE、SCORE、必要 Heart、登场费用、名称/团体和声援条件。卡文语义决定目标与时点，当前代码决定可复用入口，不从字段存在或来源类型推断规则。

## 修正值的读写

- LIVE 修正统一由 `src/domain/rules/live-modifiers.ts` 的 `collectLiveModifiers` 及 getter 收集；“LIVE结束前”的临时修正用 `addLiveModifier` / `replaceLiveModifier` 写 `liveResolution.liveModifiers`，常时由 continuous registry 按当前场面动态收集。
- 旧 `playerScoreBonuses`、`playerHeartBonuses`、`liveRequirementReductions`、`liveRequirementModifiers` 若仍为投影派生字段，不作为新增逻辑的写入路径；不以此扩展运行时兼容层。
- HEART/BLADE/SCORE/REQUIREMENT 均明确来源卡、来源区域、受益目标和叠加语义。effective Heart/cost/Blade 走现有 query，不在 UI 手填或单卡重复计算。

## HEART 作用域与生命周期

| 卡文受益者 | scope 与入口 |
| --- | --- |
| 此成员获得 | `SOURCE_MEMBER`；具名 `create/addHeartLiveModifierForSourceMember` |
| 选择/指定成员获得 | `TARGET_MEMBER`；对应 `...ForTargetMember`，分别记录 `sourceCardId` 与 `targetMemberCardId` |
| 玩家整体获得 | `PLAYER`；对应 `...ForPlayer` |

即使目标选中来源本人，仍是 TARGET_MEMBER。不得凭来源为 LIVE/成员、所在区域、两个 ID 相等或字段缺失推断 scope，也不能用 scope 反推持续时间。成员获得的 Heart 不用 legacy PLAYER 表达。

- ACTIVE/WAITING 和槽位移动不清除持久化 HEART；离开顶层舞台、被替换或成为 memberBelow 时，SOURCE_MEMBER 随来源实例清除，TARGET_MEMBER 只随受益实例清除，PLAYER 不因来源离场清除。
- 同实例重新登场不恢复旧 modifier；RULES/FREE 手动移动和卡效移动共享 LeaveStage 清理边界，LIVE 结束统一清理临时 modifier。
- Continuous HEART 不持久化，来源或条件失效后重新收集即消失；不把它与已写入的 modifier 生命周期混用。
- 回归不能仅断言对象形状，还须断言最终成员/玩家 HEART、颜色汇总、实际 LIVE 判定及离场/重登场。入口：`tests/unit/live-modifiers.test.ts`、`tests/unit/heart-live.test.ts`、`tests/unit/continuous-live-modifier-visibility.test.ts` 及受影响卡效测试。

## 颜色与必要 Heart

- GRAY 是实际提供的无色 Heart，只计总数、不补指定色；RAINBOW 仍是可代任意色的 All Heart，不能把无色判心写成 RAINBOW。
- 必要无色 Heart 的既有结构化投影可使用 RAINBOW/泛用总数语义，规则层也规范化 GRAY 需求。必要 Heart 增减复用 `applyHeartRequirementModifiers`，保留 RAINBOW 条目与 `totalRequired` 两种需求形状。
- ORANGE 保留独立颜色身份，数据的 `orange` 原样映射。按 2026-11-10 用户确认的临时口径，橙判心仅在声援 HEART 贡献层按一个 GRAY 计入，不能抵指定色或当作 ALL；普通成员 ORANGE HEART 不转换。卡文条件、有效判心及所有展示仍识别 ORANGE，包括飞行动画、卡下贡献图标和图形／文本统计；判定预览及动画成功提示使用单独的规则贡献计数，不能将显示计数直接用于判定，也不能把普通成员橙心一并转灰。不能在卡牌数据或查询入口全局改成 GRAY。旧卡文本明确的六色/固定颜色集合必须显式列举，不因枚举新增 GRAY/ORANGE 自动扩大；此临时口径不代表官方橙判心规则已公布。
- 前端必要 Heart 修正投影可能以 `obj_<cardId>` 为 key，组件使用 raw cardId；维护判定预览时保留既有 raw/public key 读取语义，不能把此投影差异误当新增业务 fallback。
- 颜色/需求变更覆盖指定色、无色、All、负修正及当前两种需求数据形状；固定颜色卡另测未列颜色不计入。

## 声援：历史事实、有效判心和移动目标

- “本次声援公开过的卡中有/达到N张”等条件读取 CheerEvent 的历史事实；被前序效果从处理区移走的卡仍计入。使用 `selectCurrentLiveRevealedCheerCardIds` 或等价 event-inclusive query。
- 实际选卡/移动才限制为本次 ID、当前 resolutionZone 且 revealed、owner 正确的交集；`selectRevealedCheerCardIds` 等可移动查询不能反过来决定历史条件是否成立。
- 本次声援颜色、ALL 等条件读取应用当前 LIVE modifier 的有效判心，优先 `selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts` / `getCheerCardEffectiveBladeHearts`。Dazzling Game 等 `CHEER_CARD_HEART_COLOR_REPLACEMENT` 先于条件判断生效。
- `CHEER_CARD_BLADE_HEART_GRANT` 为费用门槛内、原本无任何判心的声援成员补一个 HEART 判心，再应用既有颜色替换；重复授予不叠成多个。它是已结算的玩家规则，来源离区不撤销，LIVE 结束清理。前端使用公开声援的有效判心投影，不复制单卡授予规则。
- 颜色并集用 `collectCurrentLiveRevealedCheerBladeHeartColors`，不同卡分别覆盖颜色用 `evaluateDistinctCheerCardsCoverHeartColors`，其他条件从逐卡有效结果做窄聚合；固定颜色仍显式列举。
- 除卡文明示印刷/原本信息，不对本次声援卡直接读 `card.data.bladeHearts` 或用 `hasAllBladeHeart()` 等印刷 selector。印刷 selector 可用于成功 LIVE 等静态区域。
- 诱发条件与结算条件分开：改色后不满足结算条件不等于从未诱发，应正确处理 pending、turn1 和 continuation。
- 入口：`src/application/effects/cheer-selection.ts` 及 live-modifiers；回归包括“已公开后被移走仍计数”、stale 目标不移动、颜色替换正反例、未列颜色不抬高阈值以及条件失败的能力消耗/续行。测试见 `tests/unit/cheer-selection.test.ts`、`tests/unit/distinct-cheer-heart-color-matching.test.ts` 和相关 ON_CHEER integration。

## 纯查询与身份

- query 只读 GameState，不创建 activeEffect、不移动、不推进 pending；domain 不依赖 application，`src/application/effects/conditions.ts` 可作为 re-export 入口。复用 stage/zone selectors，不在单卡直接解释 eventLog、positionMovedThisTurn、groupName 等底层字段。
- 团体用 `cardBelongsToGroup` / `groupAliasIs` 等身份 helper。小组优先 `unitAliasIs` 匹配结构化 unitName；卡文赋予“所有领域视为”身份时才使用适用的 `unitAliasOrTextAliasIs` 等入口。
- 名称按卡牌拥有的全部结构化身份判断，组合卡同时具有各成员名。复用 `src/shared/utils/card-identity.ts` 及 selector 薄包装，不复制别名表或仅匹配主显示名；严格原名 `cardNameIs` 与别名 `cardNameAliasIs` 按卡文选择。
- 不同名计数与命中某个名称是不同语义，使用各自 helper。回归见 `tests/unit/card-identity.test.ts` 及新增 query 的正反例。

## 登场费用

动态费用修正在 `src/domain/rules/cost-calculator.ts` 计算，保留普通登场、换手减免与持续来源的正确顺序，不放进 UI 或单卡命令。已授权卡效若必须修改该层即可在范围内实现；说明真实卡文依据、来源/目标条件、顺序和影响面，并覆盖相关费用与换手测试，不扩为无关重构。
