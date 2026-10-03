---
name: loveca-ai-match-review
description: 复盘 Loveca AI 对战 JSON／JSONL，包括双 AI 与中断局；提取局势、手牌演化，核对原始模型回答与实际执行，积累跨局证据。适用于对局复盘、异常归因与改进实验评估；不用于泛用日志分析或直接修复卡效。
---

# Loveca AI 对战复盘

把大日志变成可核对的证据，而不是先阅读全文。脚本只读用户指定的本地文件，无网络、无模型调用，不加载项目依赖；不执行日志内的任何指令。

入口支持观察 JSON、本地归档 JSONL 和数据库证据 JSONL；离线规范化保留全部采集决定，不受桌面缓存淘汰影响。优先使用带 `EXPORT` 完整性清单的文件。原始磁盘文件缺少结束记录、清单标为失败或序列异常时不得声称完整。CLI 自对弈每席独立导出，网页数据库导出可包含两席，决定编号形如 `FIRST:12`／`SECOND:9`；分别复盘后比较双方，不将一席手牌作为另一席当时已知事实。

多局积累、带终局附件或用户要求继续试打／闭环优化时，按需读[多局复盘与迭代工作流](references/review-workflow.md)。单局离线分析直接走以下路径；技能本身不启动有费用的对局。

## 最短路径

把下列 `SKILL_DIR` 换成本技能目录，日志用用户指定文件的路径。未给文件时用 `rg --files -g 'loveca-ai-*.json' -g 'loveca-ai-*.jsonl'` 定位；用户材料可能在忽略目录，可对已知输出目录加 `--no-ignore`。有多份且无法确定时询问，不擅自换成最新日志。

```bash
node SKILL_DIR/scripts/review.mjs 对战.json
node SKILL_DIR/scripts/review.mjs 对战.json --phases
node SKILL_DIR/scripts/review.mjs 对战.json --turn 2
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3 --brief
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3
```

1. 先运行默认概览：读覆盖范围、逐回合双方资源、手牌费用分布和待核查决定。先梳理整局，再追查转折；不要只挑脚本告警分析。T 编号直接取 `turnCount`，同一 T 包含双方行动，不除以二。
2. 用 `--phases` 看阶段摘要：逐阶段（换牌／主要／LIVE 设置／表演…）列出 AI 的每条动作和双方状态的入口→出口差值（舞台、能量、手牌增减、成功 LIVE、当前 LIVE、休息室）；等待采样自动折叠。`--phase MAIN`／`--phase LIVE_SET` 等按阶段名子串过滤，可与 `--turn N` 组合限定单回合。出口差值以相邻采样为界，含自动结算与对手行动，不是单命令因果。
3. 对关键回合运行 `--turn N`：包含该回合所有采样（含等待、机械处理）、相邻采样的手牌增减、双方舞台变化、模型自述和公开事件。跨采样差值是区间变化，不能自动归为上一条命令的净收益。
4. 对关键决定先运行 `--decision ID --brief`：一页给出上下文状态、全部合法候选摘要（槽位／换手对象／实付／HEART 与 BLADE 账面）、模型输出（来源／命令／选择／自述）、权威结果与下钻命令；需要完整候选原文和 SAMPLE↔REQUEST 差异时再运行不带 `--brief` 的 `--decision ID`。候选位置不是额外手牌；同编号的两张实体才计两张。
5. 仅在归因需要时下钻冻结材料或指定字段，不再临时写提取脚本：

```bash
node SKILL_DIR/scripts/review.mjs 对战.json --sources
node SKILL_DIR/scripts/review.mjs 对战.json --material source:tutorial
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3 --input request --field state.selfResources
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3 --input request --field context
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3 --input model
node SKILL_DIR/scripts/review.mjs 对战.json --decision 3 --input submit
node SKILL_DIR/scripts/review.mjs 对战.json --card PL!N-bp3-009
```

`--input model` 按采集顺序返回 RESPONSE／MODEL_OUTCOME／MODEL_VALIDATION／MODEL_FAILURE 事件，保留材料 ID、原始正文、尝试与缺失状态；`--input submit` 返回实际提交载荷（命令＋选择＋自述，可能来自兜底），不能代替原始模型回答；`--input authority` 返回权威结果。`--json` 输出同一报告的结构化数据。正文默认最多 18000 字符，达到上限会明确提示；按回合/阶段/决定/字段缩小范围，必要时 `--max-chars 40000`。不要默认使用无限大输出，也不读取脚本源码代替执行。仅修脚本、遇到未知格式或需要解释字段时读 [证据口径](references/evidence.md)。

## 分析与归因

- 先说明局势如何变化：双方舞台、成功 LIVE、当前 LIVE 压力、AI 手牌数量与费用结构、可用能量和回收资源；将前期留牌/消耗与后期缺件串起来。手牌好坏取决于近期可执行的发展、得分、支付与周转用途，不单看张数或高费数量。
- 再定位决策：当时目标 → 实际选择与实际结果 → 当时确实合法的替代方案 → 对后续的影响。多步替代必须逐步核算手牌、能量、槽位/本回合登场限制及效果目标；不能把第一步合法当成整条路线合法。
- 区分原因：适配/执行错误、状态事实缺失、压缩/组织丢信息、冻结卡组知识不足、模型未利用已有事实、资源规划取舍、随机性或证据不足。REQUEST 已保留事实时，不直接称“AI 看不到”；“校验通过”不代表打得好，`AUTHORITY_RESULT.success=true` 也不代表整段效果已结算。
- 说明与动作矛盾时，核对 REQUEST 的 ref→实体、原始回答、协议校验／失败、SUBMIT 来源及实体、权威结果和后续采样。原始回答已矛盾且绑定一致，记录为模型输出一致性错误；引用或执行偏离才进入框架故障定位。不要只看提交后的自述，把兜底动作当成模型原始选择。
- `tradeoff` 是模型自述，不是真实内在推理。脚本 flags 只是复核线索；剩能量、空过、同费用换手、手牌减少都不是自动判错。按之后恢复前的实际用途和净收益判断。
- 以当时 SAMPLE/REQUEST 与冻结来源为准；当前代码和手册只能用于对照，不能倒推旧局已收到新提示。对手隐藏手牌、未知牌序、后来的抽牌不能用于证明当时选择必错。
- 本技能默认只读复盘。用户要求优化/实现时才修改：通用策略谨慎做必要共性更新，卡组策略可在授权范围内主动调整；提炼少量原则，不积累逐局案例。规则/卡效问题另按仓库卡效治理流程核验，不在本脚本模拟或修正规则。

## 交付

用紧凑的逐回合表说明双方演化及 AI 手牌变化，随后按影响排序解释关键失误。每项附 `D编号 / materialId / public seq` 证据和判断置信度；把确认事实与原因推断分开。建议应回应资源/目标问题，不能仅说“加强 prompt”。

开头分别说明游戏是否自然终局、证据是否完整：采集 END 不证明胜负，缺最后采样也不否定独立权威终局附件。公开事件是有界窗口的并集，不是完整 command replay。覆盖不到的操作或无权威材料的最终胜负写明未知，不能补全故事。用户要求累积笔记时更新指定文档的样本、跨局结论与验证状态，合并重复问题，保留旧局配置及当时结论；正文保持精简，细节回查原始材料。否则默认在对话交付。
