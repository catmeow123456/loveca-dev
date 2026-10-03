# 本地 AI 自对弈与策略迭代

> 文档类型：运行说明
> 适用范围：本地双 AI、完整归档、共享费用预算与 Codex 复盘迭代
> 当前状态：共享规则路径和本地 CLI 已实现；网页建局仍用于真人对 AI，策略强度需用户验收

## 架构与证据

入口为 `scripts/run-ai-self-play.ts`，运行器为 `src/server/ai-battle/self-play.ts`。两席都是 `SYSTEM`，分别持有独立模型客户端、冻结资料、运行时、玩家投影和归档；同场仅一个模型请求在途。调度、窗口校验和动作提交复用 `OnlineMatchService` 的权威队列，不复制规则引擎。决定编号带 `FIRST:`／`SECOND:` 前缀，重复、过期或另一席任务的回答不能执行。

两席按 AI 构筑规则分别加载，支持 AI 专用蓝紫；豁免的只有 PT 总数上限。模型只接收本席可见信息和本席冻结构筑参考，另一席手牌不会送入其请求。完整归档分别包含冻结资料、SAMPLE、实际 REQUEST、响应、权威结果、累计用量和终局玩家投影。停止后先完成驱动及对局清理，再封存归档，导出附完整性清单的 JSONL。`result.json` 区分自然结束、胜者与停止原因；归档 `ENDED` 本身只表示采集封存，不代表自然终局。

CLI 限定 development、loopback API／前端和本地数据库，输出目录必须在仓库外且尚不存在。发布卡库及配置只读；实验对局和计费不写业务数据库、账号卡组或历史对战。前端和生产 API 不接受实验手册路径。

## 配置与运行

先建立仓库外的实验父目录。配置不含 Key，例如：

```json
{
  "upstreamSource": "platform",
  "FIRST": {
    "presetId": "blue-purple-nijigasaki",
    "handbookId": "blue-purple-nijigasaki-tempo",
    "model": "glm-5.2",
    "enableThinking": false
  },
  "SECOND": {
    "presetId": "blue-purple-nijigasaki",
    "handbookId": "blue-purple-nijigasaki-tempo",
    "handbookPath": "/outside/repo/experiment/baseline-handbook.md",
    "model": "glm-5.2",
    "enableThinking": false
  },
  "maxCny": "200",
  "maxRequests": 360,
  "maxOutputTokens": 8192,
  "maxDurationMs": 1800000,
  "maxCommands": 2000,
  "seed": 305419896
}
```

`handbookPath` 可选；未提供时使用登记手册。每席开局冻结内容与 SHA256，此后修改文件不影响在途局。`seed` 生成可追溯的规则随机带；模型非确定性、双方不同动作消耗随机数，使相同种子不能保证完全相同的后续牌序。

```bash
pnpm exec tsx --env-file=.env scripts/run-ai-self-play.ts \
  --config /outside/repo/experiment/config-r1.json \
  --out /outside/repo/experiment/round-1

pnpm exec tsx --env-file=.env scripts/run-ai-self-play.ts \
  --config /outside/repo/experiment/config-r2.json \
  --out /outside/repo/experiment/round-2 \
  --previous /outside/repo/experiment/round-1/result.json
```

默认 `upstreamSource: "platform"` 使用现有平台配置，配置缺失则失败。本地已有 API 凭据可显式选 `"local-env"`，只读取 `AI_BATTLE_BASE_URL`／`AI_BATTLE_API_KEY`，沿用 HTTPS／精确主机白名单／DNS 校验，不构成网页或生产模型工厂的备用来源。实验计价限定北京 `dashscope.aliyuncs.com`，不会把任意兼容供应商套用北京价格。凭据不写配置、结果或归档。

GLM-5.3 只支持思考模式，服务端会按模型能力冻结为开启；CLI 可选 `apiReasoningEffort: "low"`／`"high"`／`"max"`。需要关闭思考时使用支持该模式的模型，例如 GLM-5.2。[供应商说明](https://help.aliyun.com/zh/model-studio/glm)

## 费用与停止

- 费用和请求数在双方间共享。`--previous` 带入所有前轮累计值，费用上限必须相同；追加轮次可在配置中提高 `maxRequests`，不能降低既有上限，历史调用与费用不重置。不要省略它重置一次实验的账本。
- 每次 HTTP 请求发送前检查额度，包括一次 LIVE 概率查询后的最终回答。按 UTF-8 请求字节保守估输入 token，按未缓存价格和显式输出上限预留本次费用；实际累计以返回用量及冻结价格为准。这是列表价估算，账单以供应商为准。
- 固定规则、手册与构筑放在请求前缀，使用供应商隐式缓存；机械步骤不请求模型，概率基线不增加调用，可选查询增加一次调用。
- 用量未知、适配／服务错误、超时、归档失败、请求／费用／时间／命令上限均停止实验，不自动重试或重开。模型非法输出仍沿用既有输出失败政策并保留兜底证据；复盘需区分模型与兜底动作。
- 新的未知用量默认阻止下一轮。核查失败请求后，可用 `--reserve-unknown-cny 金额` 为前轮未知尝试显式预留保守费用；预留持续计入以后预算，不将未知费用记为零。
- SIGINT／SIGTERM 取消本局、等待请求收尾并导出结果。取消客户端等待不保证供应商已经停止计费。

## 复盘与下一轮

每轮保留 `config.json`、`result.json` 和两席的 `*.export.jsonl`。用复盘技能分别读双方：

```bash
node .agents/skills/loveca-ai-match-review/scripts/review.mjs /round/FIRST/loveca-ai-MATCH.jsonl.export.jsonl
node .agents/skills/loveca-ai-match-review/scripts/review.mjs /round/FIRST/loveca-ai-MATCH.jsonl.export.jsonl --phases
node .agents/skills/loveca-ai-match-review/scripts/review.mjs /round/FIRST/loveca-ai-MATCH.jsonl.export.jsonl --decision FIRST:12 --brief
```

Codex 先看整局资源与阶段演化，再以当时 REQUEST、合法候选、模型输出和实际结果定位原因；不使用另一席隐藏信息倒推最优动作。区分事实缺失、资料组织、模型忽略事实、规划取舍与随机失败。只把有证据的共性原则写回通用资料，蓝紫改进优先写构筑手册，不累积逐局分支。

冻结原手册作为对照，每轮候选对原版或上一版，后续交换先后手；记录变更、来源哈希和前轮结果哈希。模型配置尽量保持一致，换模型时单独注明；少量对局和一次胜负不证明强度提升。保留候选后交给用户熟悉的卡组实测。这是基于自对弈的 prompt／框架迭代，不会训练模型权重；CLI 执行对局和证据导出，复盘、改动与启动下一轮由当前 Codex 任务驱动，不从模型回复执行代码或自动发布。
