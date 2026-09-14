---
name: loveca-card-effect-governance
description: Implement, review, or fix Loveca Battle card effects; audit card text and draft card-effect commit messages from a specified export JSON. Use for card-effect work, not unrelated UI or release tasks.
---

# Loveca Card Effect Governance

按任务定位所需代码、卡牌记录与参考；本入口不要求通读框架手册。源码和测试说明当前实现，导出卡文决定规则与展示，主登记册记录完成状态。

## 任务模式与完成条件

- 审查、候选筛选和执行提示词请求保持只读；实现或修复请求完成范围内代码、相关验证与登记，不增加“先审查再等批准”的默认阶段。提交说明请求只生成并核对说明；stage、commit、push、PR、发布按已有具体授权执行。
- 开始时确认任务仓库和必要的工作树/审查范围；指定 commit、分支或 PR 时核实实际 diff。只在判断依赖历史或 runner 变化时读对应历史/diff，不固定执行 git log、统计行数或反复校准。
- 保留已有脏状态，不主动处理 `llocg_db`、临时卡图或 `trigger`；不访问生产管理员页面及相关 API。任务中的普通只读查询和本地验证无需重复确认；联网查询不代表允许换用卡牌数据源。fetch、pull、rebase、依赖变更及外部写操作仍须在具体任务授权范围内。
- 已授权卡效实现包含必需的局部费用计算修改和相关测试，不包含无关费用重构、整套 trigger matcher 接线或大型 steps DSL。明确要求框架变更时按该范围处理；T-2 未开启时保持 matcher 的纯函数/shadow 边界。
- 实现完成：卡效行为与卡文一致、相关测试通过、主登记册准确，必要的新架构边界已记载。审查完成：说明有依据的问题、影响与修正建议，或明确未发现阻塞；未验证项如实列出。无需固定报告模板或额外生成未要求的 PR 回复/下一批提示词。

## 必要约束

- 使用用户指定导出 JSON；路径先查任务上下文，仍不明确才询问。日文 `cardTextJp` 用于规则，中文 `cardTextCn` 用于展示，同记录核对类型、名称与费用/分数。不自动选择最新文件，不回退 API、旧卡库、Excel 或翻译。
- 同一基础编号的所有罕度共享类型与完整卡效。按该编号读取范围内全部印刷，definition、workflow gate、continuous registry、费用及 modifier 查询均使用 `baseCardCodes` 覆盖全罕度，不能因导出只有某一罕度而改用 exact `cardCodes` 限制。文件/字段缺失、同编号冲突或能力段落映射不明时，停止相关卡牌或生成项并继续独立可完成部分。
- `definition.effectText` 保留完整中文能力段落与 token，`activatedUi.text` 直接复用同一常量；标题可以概括。只规范化换行和段落首尾空白。token 缺映射时补前端映射与测试，不擅自改导出正文。
- 按真实能力时点登记 definition；常时由计算层收集，诱发能力进统一 pending 调度，起动能力走合法时点/费用/次数校验。共享流程优先复用，单卡逻辑留在 workflow，runner 只做薄调度与注册。
- 使用事件安全的动作 helper、统一 continuation 和玩家视图投影。不能在多步骤效果中插入新能力，不能用旧 pending 快照隔离新触发，也不能泄漏未公开卡牌。

## 按需读取

以下是条件路由，不是阅读顺序。只读命中主题的参考和对应章节；已读且未变化的内容不重复加载。参考中的源码/测试路径相对仓库根目录。

| 当前任务或效果涉及 | 读取 |
| --- | --- |
| 解析导出 JSON、处理印刷冲突、卡文三层审计、生成提交说明或选择工具 | [数据与工具](references/data-and-tooling.md) |
| 新建/晋升 workflow、审查 runner 边界、筛选候选批次或设计抽象 | [架构与复用](references/architecture-and-reuse.md) |
| 能力分类、queued 确认、pending 顺序、次数/来源生命周期、授予起动能力 | [调度与来源](references/timing-and-sources.md) |
| 能量、费用、抽弃、成员/区域移动、事件批次或牌库刷新 | [能量与移动](references/energy-and-movement.md) |
| 检视、公开、休息室/声援选卡、定时展示、重连或撤销 | [公开与可见性](references/reveal-and-visibility.md) |
| Heart/BLADE/分数/必要 Heart、登场费用、名称或声援条件查询 | [修正值与查询](references/modifiers-and-queries.md) |
| 卡文、token、按钮/选项/步骤提示、卡效标记或起动次数高亮 | [玩家文案与显示](references/player-visible-action-copy.md) |

查已有实现时，先在 [主登记册](../../../docs/card-effect-reuse-audit/existing_module_map.md) 按基础编号定位条目，再查 definition、workflow 与相关测试；不要全文读取大型登记册。需要框架设计依据时从 [框架导航](../../../docs/card-effect-framework/README.md) 进入具体主题，不把整个设计目录作为前置阅读。

以下目录均相对 `src/application/card-effects/`：`definitions/index.ts` 是定义入口，`workflows/cards/` 承载单卡，`workflows/shared/` 承载稳定同型 family，`runtime/` 承载动作与生命周期 helper。runner 保留调度、生命周期和注册边界，不回填单卡结算，也不在 React 或 action handler 实现卡效。详细归属见“架构与复用”。

普通新卡从目标卡文、现有实现及同型 workflow 入手；上表按实际费用、触发、公开和 modifier 形状补读。只起草提交说明通常只需“数据与工具”和指定 diff；只审查架构则无需读取未涉及的卡文/交互参考。

## 验证与文档

- 对本次行为变化运行 focused tests，覆盖适用的正常结算、可选不发动/跳过、无目标、非法或 stale 输入及 continuation。条件参考中的回归仅在触及对应契约时适用；普通卡效复用不要求重跑全部底座测试。
- 涉及卡文或操作字段时，保留完整卡文/关键规则动作的精确契约断言，并运行 `tests/unit/card-effect-tokens.test.ts`、`tests/unit/card-effect-text-governance.test.ts`。不要为普通装饰文案添加重复测试。
- 使用 `pnpm test:run <相关测试>`；必要时做根或 client TypeScript 检查，最后检查 `git diff --check`。不固定要求全量 build/E2E，检查通过后只因新变更、失败或未解决风险扩大验证。
- 每张卡/效果段落地后更新唯一主登记册：基础编号、费用/分数、卡名、全罕度覆盖、完整/部分实现、复用模块与测试。新增 helper、family 或事件边界只更新受影响的设计/覆盖/gap 章节；同构追加不触发全套文档刷新。进度文件仅反映当前基线、缺口与下一步。
- 交付聚焦请求的结果、验证和未解决项。卡号同时附费用/分数与卡名；引用实际代码或记录作为证据。不要以 runner 行数、shadow 结果或单卡成功宣称全局框架完成。
