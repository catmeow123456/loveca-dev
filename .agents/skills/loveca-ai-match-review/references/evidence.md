# 证据口径与维护入口

## 支持的导出

仅识别 `format: loveca-ai-observation-v1`，读取 `decisions[]` 与 `materials[]`，材料正文为字符串。缺失/裁剪材料不得当作空对象或零资源。未知格式报错，不猜字段，不扫描其他日志补洞。这是离线诊断工具，不给运行时增加历史格式兼容层。

| 证据 | 用法 | 不能证明 |
| --- | --- | --- |
| `SAMPLE.view` | 所有采样含等待窗口；`match` 定位 T、阶段、席位、public seq，`table.zones/objects` 给双方可见资源 | 模型已收到整个 view |
| `SAMPLE.input` | 适配器生成的状态、候选、历史、上下文 | HTTP 实际正文完全相同 |
| `REQUEST.body.messages` | 反序定位含 `state/space` 的动态 JSON；展开词典/分组；固定材料看 assembly 与来源 SHA | 后来的本地手册已应用于本局 |
| `MODEL_VALIDATION` | 模型选择/自述通过协议校验 | 命令已执行、选择合理 |
| `SUBMIT` | 实际命令及 `selection.source`，含 MODEL/MECHANICAL/FALLBACK | 权威接受 |
| `AUTHORITY_RESULT` | `success/error/afterRevision/commandRecords` | 完整效果已结算、后续抽到什么 |
| 后续 `SAMPLE` | 双方场面和 AI 手牌的真实后续可见状态 | 与上一采样之间只有一条命令 |
| `input.context` | 已接受动作的有界记录及 `resourcesBefore/After/resultSummary` | 永久历史、当前手牌、真实模型内在推理 |
| `input.history.events` | 去重后的 public seq 及具体移动/完成卡效 | 完整人类命令、缺口中发生的操作 |

## 压缩协议

`cardFactsRef` 引用根 `cardFacts`；`textRef` 引用根 `texts`。MAIN `space.memberPlays` 按同一手牌实体分组：将 `common` 与 candidate 合并，`descriptionPrefix + candidate.description` 恢复描述；平铺 actionRefs 和先后顺序必须保留。`context.lastAction.recentDecisionIndex` 是 `recentDecisions` 的零基引用。`decisionBrief` 是附加摘要，不应作为原始输入被删掉的证据。引用不存在/循环报错；不按卡号猜有效数值。

`--decision` 比较解码后的全部动态输入与 SAMPLE（忽略编码词典、分组和新增 decisionBrief 的外形），给差异路径，不全文重复两份输入；显式 `--input request --field ...` 可查看实际请求中的事实，包括尚未去除的 decisionBrief。请求缺失与“没有发模型请求”分别报告；多个请求按事件列出，不将重试混成独立选择。

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
- 模型动态输入/上下文：`src/server/ai-battle/model-input.ts`、`decision-context.ts`、`visible-resources.ts`。
- 候选与执行：`decision.ts`、`effect-decision.ts`、`runtime.ts`，以及 `src/server/services/online-match-service.ts` 的 SUBMIT/AUTHORITY_RESULT。
- 当前冻结规则、教程、构筑手册入口：`assets/ai-battle/catalog.json`；先看日志 source materials，再与当前文件比。

脚本自测：`node --test SKILL_DIR/scripts/review.test.mjs`。真实日志验证默认概览、关键回合/阶段/决定模式（`--turn`、`--phases`/`--phase`、`--decision` 含 `--brief` 与 `--input request|sample|submit|authority`）；不要把用户日志复制进技能，也不要以本技能修改生产服务或重新跑有费用的模型请求。
