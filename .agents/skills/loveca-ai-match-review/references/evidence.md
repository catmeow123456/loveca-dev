# 证据口径与维护入口

## 支持的导出

支持观察 JSON、本地完整 JSONL 与数据库决定 JSONL，先规范化为 `format: loveca-ai-observation-v1`，再读取 `decisions[]` 与 `materials[]`，材料正文为字符串。缺失/裁剪材料不得当作空对象或零资源。未知格式报错，不猜字段，不扫描其他日志补洞。这是离线诊断工具，不给运行时增加历史格式兼容层。

| 证据 | 用法 | 不能证明 |
| --- | --- | --- |
| `SAMPLE.view` | 所有采样含等待窗口；`match` 定位 T、阶段、席位、public seq，`table.zones/objects` 给双方可见资源 | 模型已收到整个 view |
| `SAMPLE.input` | 适配器生成的状态、候选、历史、上下文 | HTTP 实际正文完全相同 |
| `REQUEST.body.messages`／Codex `REQUEST.prompt` | 反序定位含 `state/space` 的动态 JSON；Codex 从实际 prompt 的 JSON 行读取，保留是否包含固定知识、线程代次与续轮编号；展开词典/分组；固定材料看 assembly 与来源 SHA | 后来的本地手册已应用于本局 |
| `MODEL_VALIDATION` | 模型选择/自述通过协议校验 | 命令已执行、选择合理 |
| `RESPONSE`／`MODEL_OUTCOME` | 原始模型正文及尝试结果；`--input model` 保留各次响应、校验、失败的采集顺序 | 最终必定执行该次回答、自述代表内在意图 |
| `SUBMIT` | 实际命令及 `selection.source`，含 MODEL/MECHANICAL/FALLBACK | 权威接受 |
| `AUTHORITY_RESULT` | `success/error/afterRevision/commandRecords` | 完整效果已结算、后续抽到什么 |
| 后续 `SAMPLE` | 双方场面和 AI 手牌的真实后续可见状态 | 与上一采样之间只有一条命令 |
| `input.context` | 已接受动作的有界记录及 `resourcesBefore/After/resultSummary` | 永久历史、当前手牌、真实模型内在推理 |
| `input.history.events` | 去重后的 public seq 及具体移动/完成卡效 | 完整人类命令、缺口中发生的操作 |
| 同局最终投影／权威记录／CLI `result.json` | 独立确认自然结束、胜者或停止原因；先核对 matchId | JSONL 清单完整、全部中间操作可重放 |

## 压缩协议

`cardFactsRef` 引用根 `cardFacts`；`textRef` 引用根 `texts`。MAIN `space.memberPlays` 按同一手牌实体分组：将 `common` 与 candidate 合并，`descriptionPrefix + candidate.description` 恢复描述；平铺 actionRefs 和先后顺序必须保留。`context.lastAction.recentDecisionIndex` 是 `recentDecisions` 的零基引用。`decisionBrief` 是附加摘要，不应作为原始输入被删掉的证据。引用不存在/循环报错；不按卡号猜有效数值。

`--decision` 比较解码后的全部动态输入与 SAMPLE（忽略编码词典、分组和新增 decisionBrief 的外形），给差异路径，不全文重复两份输入；显式 `--input request --field ...` 可查看实际请求中的事实，包括尚未去除的 decisionBrief。请求缺失与“没有发模型请求”分别报告；多个请求按事件列出，不将重试混成独立选择。

`--input model` 是事件数组，包含 `stage/materialId/timestamp/status/payload`；正文按各事件载荷保留，不规范化或纠正模型选择。缺失／截断材料的 payload 为 null；没有事件则返回空数组，不借 SUBMIT 补原始响应。`--input submit` 是最终提交包装，包含兜底来源，不能称为原始模型输出。

当前 LIVE_SET 最终回答要求 `liveSetPlan` 声明全部歌曲、成员引用及歌曲基础总需求；`MODEL_VALIDATION.liveSetPlan` 是服务端已核对的声明，兜底 `PREPARED.liveSetPlan` 则由实际兜底集合生成。两者均不证明后续卡效、声援或竞争胜率，也不校验自由文本的全部语义；历史回答没有此字段时按当时协议分析，不倒推为旧局非法。查询回复可用 `liveSetPlan=null`，不代表最终盖牌。

## 资源与时间

- T 直接使用 `match.turnCount` / `state.turn`；双方在同一 T 行动。`activeSeat` 不是始终等于 AI 的 `viewerSeat/selfSeat`。
- 手牌按本次 HAND 的实际 objectIds 统计；隐藏或缺正面计 unknown，不从冻卡组、历史 selectedCards 或别的区域补全。相同卡号可有多个实体；人类隐藏手牌只报告张数，不跟踪背面 ID。对象退回隐藏区域后不沿用旧正面身份。
- 舞台仅 `MEMBER_SLOT.slotMap` 顶层成员，不把下方成员计作额外槽位；保留 `costDelta`、朝向和有效 HEART/BLADE。费用轴的 `cost` 是印刷费用；实际登场支付取 candidate.energyCost。
- 成功 LIVE 区张数是胜利进度；`liveResult.scores` 是当前 LIVE 分数，不是累计胜场。缺失区域记 unknown，不记 0。活跃能量数不跨回合累加；仅统计确有 ACTIVE 朝向的能量。
- HAND 增减按相邻可见快照实体比较；跨换牌/抽牌可以看到结果，但不把新身份当作预先已知。差值注明前后 D/seq，包含自动动作或对手操作；最后一个采样后没有快照时不虚构后续结果。
- 公开事件以 `seq` 去重；同 seq 内容冲突告警。各窗口 `omittedEventCount` 不能求和当作整局缺事件数，必须看并集序列缺口。末尾 beyond 最后采样的事件没有可知上界。

## 故障定位（只在需要时读取仓库代码）

从当前 checkout 的 `git rev-parse --show-toplevel` 解析路径，不依赖固定工作目录：

- 导出与容量：`src/online/ai-battle-observation-types.ts`、`src/server/ai-battle/trace-store.ts`。
- 网页持久证据及完整性清单：`src/server/ai-battle/evidence-repository.ts`；局末附件与多局口径见[复盘工作流](review-workflow.md)。
- 模型动态输入/上下文：`src/server/ai-battle/model-input.ts`、`decision-context.ts`、`visible-resources.ts`。
- 候选与执行：`decision.ts`、`effect-decision.ts`、`runtime.ts`，以及 `src/server/services/online-match-service.ts` 的 SUBMIT/AUTHORITY_RESULT。
- 当前冻结规则、教程、构筑手册入口：`assets/ai-battle/catalog.json`；先看日志 source materials，再与当前文件比。

脚本自测：`node --test SKILL_DIR/scripts/review.test.mjs`。真实日志验证默认概览、关键回合/阶段/决定模式（`--turn`、`--phases`/`--phase`、`--decision` 含 `--brief` 与 `--input request|sample|model|submit|authority`）；不要把用户日志复制进技能，也不要以本技能修改生产服务或重新跑有费用的模型请求。
