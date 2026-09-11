# 真实模型验收记录

> 文档类型：历史/计划文档
> 适用范围：2026-09-09 当时冻结输入的模型实验与问题分析
> 当前状态：历史证据，保留用于解释输入设计与策略限制；不代表当前代码或生产验收
> 当前事实由[运行与观测说明](runtime-and-observation.md)和[支持矩阵](support-matrix.md)维护，待修项以项目待办为准。下文“当前”仅指该次实验版本。

2026-09-09，P4 真实模型页面链路与 P6 首轮开发验收已完成。模型为作者提供的 alibaba-cn / `qwen3.8-max`；专用配置保存于被 Git 忽略的根 `.env`，文档和产物不包含密钥。验收证明原始 μ's 预组镜像的管理员调试流程可运行，不代表真人竞技强度或生产开放。

## 实际模型与 P4 页面

端点：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。所有正式组使用相同参数：`temperature=0.2`、`max_tokens=2048`、`enable_thinking=false`、`response_format={type:json_object}`、`stream=false`。接口依据 [Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) 与 [结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)，实际支持由此次 HTTP 200 / stop 响应确认。客户端取消不保证上游停止生成；过期结果仍须经权威队列拒绝。

`ai-battle-real-model.spec.ts` 已通过：测试管理员正常认证后从页面创建真人后手对局，模型完成换牌；页面选中决定、展开实际六条请求消息、查看 AI 当时局面并导出，核对原始响应、MODEL 提交、权威 ACCEPTED command record，最后通过页面结束并允许新建。该次请求 2333 ms、HTTP 200、finish_reason=stop，没有重试，材料均 COMPLETE、缺失引用为空。1600×900 的请求与视图截图已查看，正文可读。

对局 `5ae1c1b5-4368-4eb5-9c26-22f2eed4c94a`；产物为 `output/playwright/ai-battle/real-model-decision.json`、`real-model-request-1600.png`、`real-model-view-1600.png`。该局中打开过 AI 私密材料，只用于调试。小型连通探针单独保存，不能替代页面验证。

## 六局固定开局基线

使用当前发布卡库、PT、正常 AiBattleService / DashScope 客户端 / 异步驱动 / PostgreSQL recorder。USER 席位由固定 `chooseAiTestSelection` 策略操作，只消费自身当前可见输入；这是自动化对手，不是作者手动操作。局中自动归档不反馈给任一策略，复盘在各局结束后进行。

每局重新使用 `ai-real-muse-v1-seed-12345678` 随机带。初始牌区内容 SHA-256 全部为 `bb6b155b8eee458c845ccfb380eadcff0e548f800009e71aa5330f457041ccac`，随机带初始游标 236、最终 342。这只是该样本的实测事实，不表示不同选择后的牌序继续一致。固定开局严重限制胜率外推；本组六局均由 SECOND 获胜，即 AI 后手三胜、AI 先手三负，不能推断一般先后手优势或模型强度。

六局全部自然结束为 `VICTORY_CONDITION / COMPLETED / FULL`，没有服务重试、非法模型选择、错误兜底、连续失败停止或人为终止替代。187 次模型选择与 189 次机械处理均通过权威执行。HTTP 等待中位数 2501 ms、P95 3970 ms、范围 1334–8354 ms；这些是开发机实测，部分调用与离线对照重叠，不是隔离负载性能基准。

| 局  | 真人席位 | 回合 | 模型 / 机械接受 | 总用时  | HTTP 中位 / 最大 | 淘汰决定 |
| --- | -------- | ---- | --------------- | ------- | ---------------- | -------- |
| 1   | FIRST    | 5    | 22 / 34         | 90.7 s  | 2376.5 / 4382 ms | 0        |
| 2   | FIRST    | 7    | 45 / 43         | 186.3 s | 2574 / 6191 ms   | 57       |
| 3   | FIRST    | 6    | 45 / 43         | 176.7 s | 2541 / 8354 ms   | 53       |
| 4   | SECOND   | 6    | 22 / 21         | 106.6 s | 2410.0 / 3965 ms | 0        |
| 5   | SECOND   | 6    | 28 / 29         | 118.4 s | 2380.0 / 5268 ms | 22       |
| 6   | SECOND   | 5    | 25 / 19         | 106.9 s | 2503 / 4569 ms   | 0        |

完整结果、对局 ID、command 类型、随机带和数据库封存事实保存在 `real-games/game-N-result.json`，汇总为 `real-games/summary.json`。观察存储仍遵守 16 MiB / 128 决定等生产上限；表中长局淘汰属于预期。所有仍保留材料引用完整，捕获失败、遗漏决定和迟到丢弃均为 0。`game-N-events.jsonl` 是测试独立自动归档，不能据此声称页面有限导出保存了整个历史。

USER 脚本共出现 2 次公共步骤确认竞态：另一参与者先推进，旧确认被权威拒绝。脚本只在确认版本确实变化后重新采样，未对相同状态盲目重试；这两次单独记录，不计入模型错误。此前两次脚本试跑分别因未等待阶段门禁、未处理公共确认竞态中止，均保留在 `real-games-pilot*`，不计入六局通过数。

## 固定局面对照与问题复盘

从第一局真实模型导出选择决定 2（换牌）、67（主要阶段）、83（临胜 LIVE 设置），每种 RULES / TUTORIAL / HANDBOOK_A / HANDBOOK_B 各重复 3 次，交错条件顺序。初始事实、完整候选及顺序、协议、AI 自身构筑和模型参数在同组保持相同。预期条件先记录于 `p6-real-comparison-expectations.json`。

- 换牌局面有两名费用 4 成员、低需求 LIVE 和三张高费成员。期望保留早期登场与 LIVE 选择。
- 主要阶段已具备 6 HEART / 3 BLADE 和可靠的低需求 LIVE。`PL!-sd1-004` 费用 11「园田海未」可按候选支付 7 能量换手，替换 `PL!-sd1-012` 费用 4「南琴梨（南小鸟）」后净增 2 HEART、2 BLADE，指定色不减少。A 允许保留稳定场面；B 的显式条件优先执行这种提升，即使支付全部剩余活跃能量。
- 临胜局面已有两张成功 LIVE，己方舞台 6 HEART / 3 BLADE；`PL!-sd1-020` 分数 2「终将听到青春的声音」需求总量 5，当前颜色足够；`PL!-sd1-022` 分数 4「如今的我们」因成功区减少无色需求后总量为 8，仍依赖未知声援并有指定色缺口。

三组实验各 36 次请求全部通过纯协议校验，无重试，均未向旧对局提交命令。不能把它们标为权威接受，也不能把三组不同输入/规则材料混作同一统计组。

| 组       | 改动                             | MAIN：A 保留 / B 提升 | 临胜 LIVE：A 低需求 / B 高需求 | HTTP 中位数 |
| -------- | -------------------------------- | --------------------- | ------------------------------ | ----------- |
| 原材料   | 捕获输入原文，B 增加明确换手条件 | 3/3、3/3              | 2/3、3/3                       | 2298 ms     |
| 文字澄清 | 只替换规则中的区域读取说明       | 2/3、3/3              | 0/3、3/3                       | 2341.5 ms   |
| 己方摘要 | 当前规则说明 + 即时可见资源摘要  | 2/3、3/3              | 3/3、3/3                       | 2207 ms     |

原材料暴露了显著的模型说明错误：将占用槽位说成空位、将己方 6 HEART 说成 14/16/18、混用同名不同费用成员的能力。对照实际候选、顶层槽位及冻结卡文后，未发现这些案例存在引擎候选缺失或投影数值错误。单纯增加文字说明未解决问题，故加入 `state.selfResources`：只从合法可见视图即时汇总己方顶层成员、颜色 HEART、总 HEART、活跃成员 BLADE、活跃能量和成功 LIVE 数，不持久化，不试执行未来命令，不新增 AI 单卡分支。完整输入仍保留原桌面。

摘要组的临胜 12 次回答都正确读取 6 HEART / 3 BLADE，均衡手册稳定选择较可靠的低需求 LIVE；B 在主要阶段三次遵循显式提升条件。仍有短说明把声援机会写成足够达标，或把换手后的 8 HEART 算成 9；短说明是模型自述，不是规则结果。样本量小、固定开局和固定对手均限制结论，不作竞技强度或稳定胜率承诺。

复盘同时确认：高费换牌保留了可登场成员和 LIVE；登场、可选弃手、检视回收以及自送后补回舞台由真实命令分步处理；两局通过起动回收解决后续资源短缺。没有发现同一窗口反复撤回/重盖 LIVE，六局均无 UNSET_LIVE_CARD；一张实体 LIVE 在不同回合回收后再次设置，属于合法再利用。样本中没有模型处理多 pending 顺序的决定，该选择类型仍由 P2/P3 focused tests 验证，不能声称本批实测已覆盖所有效果顺序策略。

产物分别为 `p6-real-*`、`p6-resource-clarification*` 和 `p6-visible-resources*`。后两组计划显式标注 intervention、原输入/规则哈希及新材料；资源摘要组同时记录实现哈希，不伪称新增字段存在于原始 REQUEST。正文与当前模型配置以每个样本实际发送的 body 为准。

## 当前输入的整局回归

文字澄清阶段另有两局自然终局，共 39 次模型选择；其规则 SHA 为 `03bd8c1633afdab56a21fbf9c3a41709474bbbda96aa3c63badba788c6e4c89e`，保留为中间实验。

最终 `selfResources` 版本又交换先后手各跑一局，分别为 `44a8ae1e-4b7b-4edb-8e9e-afdf647505a7` 与 `2a00655c-f7ed-4904-a031-5ada8de16293`：5 / 6 回合自然结束，21 / 24 次模型选择、32 / 22 次机械处理全部接受，HTTP 中位数 2776 / 2899.5 ms，无重试或兜底，记录均 COMPLETED / FULL。后手样本淘汰 4 个旧决定，仍保留材料引用完整。两局数据在 `real-games-resources/`，规则 SHA 为 `9b09ee8b29be2d7098ff91ad38ce79f4dfc3044384328906410d543bbaeee119`。当前输入的这两局与早期六局分组报告，不宣称十局使用同一材料版本。

固定教程 SHA：`59dea6e4135e621c04784b5b492f6cb907633799ebd5ded8fd3d01d6d568c7f9`；均衡手册 SHA：`ae1bc46ab11b4ea7f13755f1df66310417e63d5d5c93ad2525531ed48c1f885d`；卡牌参考 SHA：`ee7df599e719637de9f9a67cd4d5d00d49219f1bd4276a6709b8ec897d714c80`。模型配置 SHA：`481b0d4fb5576c9b089d241f6d936ad92cac8a30ab3164c6c36063b816edfba2`。各请求还保留自身 body 哈希与来源组装引用。

## 真人复盘后的提示修正

作者提供的 `d0f78580` 对局复盘后，通用能量/换手/盖牌知识、卡组路线与过牌建议、候选卡文和当前手牌摘要已补充。三轮共 87 次固定局面真实请求观察到关键行动改善，但仍有 HEART 增量、条件抽牌和说明与选择不一致的问题；最终材料尚未再做人机完整对局。当前结果及材料哈希见[复测报告](reviews/2026-09-09-d0f78580-retest.md)。本页上文的 P6 统计和哈希仍属于其当时的冻结版本。

随后真人体验的 `995a9195` 第 77 次决定，在已有最新规则的情况下仍于 T4 空过。54 次追加固定局面请求中，原材料重复三次均结束；更新手册后开始换手，补充候选静态数值差后部分算术更准确，但仍持续选择较小收益的位置，没有选中已合法可支付的更大提升。共 53 次选择协议合法，一次返回不完整 JSON；策略质量没有判通过。当前保留第二轮材料，未保留没有收益且出现开局说明退化的第三轮额外段落。具体候选、权威规则测试、各轮边界与材料哈希见[第 77 次决定调查](reviews/2026-09-09-995a9195-77.md)。

作者又完成了 `316b7939` 真人对战。导出已淘汰前 75 个决定，仅保留 T3 结算末尾至 T6；保留的 16 次模型选择均被接受，但 T5、T6 的分数竞争分别以真人 5:3、7:4 告负。T6 检视时明确漏选当前舞台可直接满足的 4 分 LIVE，却自称所选 3 分牌为最高分；更早还存在未评估的 LIVE 回收与检视路线。此次只读调查及离线规则核算没有新增模型请求、没有修改提示词，逐回合判断、16 条原始输出及完整性边界见[整局中后期抽样报告](reviews/2026-09-09-316b7939.md)。

随后按作者提出的手牌质量、费用衔接与重整资源需求，通用教程和两份 μ's 手册补充了近期计划、起手换牌、功能冗余、检视／回收入口、已盖 LIVE 后的成员过牌、高分／多 LIVE 准备和声援可达上限。60次真实固定输入请求均协议合法；最终材料在所测均衡样本中保持4费开局、选择可唱4分 LIVE，但仍误换衔接成员、不愿额外过牌，并存在费用与取舍说明错误，策略质量未判通过。当前材料、新旧条件与追测边界见[手牌规划复测](reviews/2026-09-09-hand-planning.md)，不与上文历史版本合并作强度结论。

## 绿莲空费与回合规划实现复测

`f978d81a` 的 T5/T6 复盘后，已加入共享能力费用/目标事实、有限登场收益与 LIVE 基础缺口、接受动作后的有界上下文、合法已知顶牌记忆及输入无损去重。最后版本 12 次固定首步均发动原先被忽略的能力，三个连续主阶段用 11 次模型选择完成规则路线；但两局自然绿莲镜像测试均告负，83 次整局模型选择虽全部接受，能力来源绑定、取舍说明和分数竞争判断仍不准确，策略质量未通过。夹具范围、各版本区别、完整结果及材料哈希见[空费与回合规划复测](reviews/2026-09-10-f978-planning.md)。本轮独立 `GameSession` 实验不替代先前 HTTP/recorder/页面验证。

随后作者的 `188ba3ad` 第 146 次决定引出 T6 的 9 能量空过调查，真正结束主要阶段的是 141。新能力事实与上下文已进入请求，但模型忽略已列出的自送回收成员及后续跨槽登场路线，T6 实际为 5:5 并进入 T7。离线正常命令证明可确定形成 13 HEART / 11 BLADE、剩余 6 能量，并准备基础 6 分的双 LIVE，合计仍只缺 2 泛用 HEART；不能据此断言反事实必胜。本轮没有策略改动或追加模型调用，见[回收腾位与空过调查](reviews/2026-09-10-188ba3ad-141.md)。

后续按作者要求，把自送回收、腾位补条件和跨位置换手补入所有构筑共用的教程与控制提示。三版共 90 次固定局面真实请求均协议合法，但早期的换手改善没有在最终措辞中复现：最终第 141 次决定仍 3/3 空过，完整组合、能力来源与分数判断仍未通过策略验收。μ's 的直接回收 LIVE 样本保持原有首步，不能据此宣称通用强度通过。版本区别、材料哈希与最终五个局面结果见[通用自送回收提示复测](reviews/2026-09-10-general-self-recovery-prompt.md)。

## 复现与代码验证

先按[完整环境验证](full-environment-validation.md)准备已迁移的本地 `loveca_ai_qa_*` 副本，载入正常服务环境变量与专用 `AI_BATTLE_*` 配置。原业务库与生产库不在此次执行范围。工具拒绝非本地或未明确命名的 QA 数据库；以下写入仅用于测试。harness 的 REAL 模式直接使用正常应用 singleton，没有假模型路由。

```bash
AI_BATTLE_QA_MODEL_MODE=REAL DATABASE_URL="$AI_BATTLE_QA_DATABASE_URL" \
pnpm exec tsx tests/helpers/ai-battle-http-harness.ts
```

将其端口设为 `AI_BATTLE_QA_API_URL` 后运行真实页面测试：

```bash
AI_BATTLE_QA_MODEL_MODE=REAL AI_BATTLE_MODEL=qwen3.8-max \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
pnpm --dir client exec playwright test tests/e2e/ai-battle-real-model.spec.ts --project=tablet-1024x768 --workers=1
```

完整采样使用正常命令与封存。`randomInt` 只作为受信任的服务构造依赖注入，普通服务保留安全默认源。10 分钟 / 1500 条 USER 命令是测试脚本超时，不是运行时回合或模型预算。

```bash
AI_BATTLE_QA_MODEL_MODE=REAL DATABASE_URL="$AI_BATTLE_QA_DATABASE_URL" \
pnpm exec tsx tests/helpers/ai-battle-real-games.ts --start 0 --games 6 --out output/playwright/ai-battle/new-sampling

pnpm exec tsx scripts/prepare-ai-battle-evaluation.ts \
  --export output/playwright/ai-battle/real-games/game-1-export.json \
  --decisions 2,67,83 \
  --alternate-handbook assets/ai-battle/handbooks/muse-tempo.md \
  --out output/playwright/ai-battle/new-plan.json

AI_BATTLE_QA_MODEL_MODE=REAL \
pnpm exec tsx tests/helpers/ai-battle-real-comparison.ts \
  output/playwright/ai-battle/new-plan.json output/playwright/ai-battle/new-comparison.jsonl
```

输出拒绝覆盖已有结果。准备工具核对完整来源及六条消息绑定，保持输入 JSON 和候选顺序；示例决定 ID 仅属于指定导出，其他对局从观察框选择其实际保留的编号。当前代码的新对局会直接捕获带资源摘要的输入，通常无需历史实验的 intervention。早期 P5 假模型计划只作为准备工具验证，未计入真实请求结果。

新增资源汇总测试覆盖己方顶层/手牌/对手/成员下方的边界、活跃能量、待机成员 BLADE、有效修正不重复累加和输入不变。构筑扩展测试在临时目录中将 `PL!-sd1-001` 费用 11「高坂穗乃果」从 4 张减到 3 张，将 `PL!-sd1-005` 费用 2「星空凛」从 2 张增到 3 张，注册新 YAML 哈希和手册后，使用既有选择类型完成真实规则自然终局；没有改生产精选构筑或增加 AI 单卡分支。这是配置扩展的开发证明，不是新构筑真实模型验收。

最终 focused 回归为 38 + 53 项通过，固定实验准备工具另 3 项已通过；shared/server/client 类型检查及新增测试独立类型检查通过。定向 lint、代码格式与 diff 检查通过；既有 OnlineMatchService 的 4 项 lint 基线问题不在此宣称修复。收尾时隔离库没有进行中的 AI 记录，本次临时 HTTP 服务已关闭。未执行生产迁移、发布、部署或作者真人体验验收。
