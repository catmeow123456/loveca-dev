# AI 对战运行与观测说明

> 文档类型：设计文档
> 适用范围：管理员 AI 对战的权威命令、模型输入、权限与观察界面
> 当前状态：开发基线；生产开放和模型策略质量尚待验收

平台管理员可通过精选构筑和共享真人牌桌进行 AI 调试对战，并查看有界决定材料。构筑与窗口覆盖见[支持矩阵](support-matrix.md)，环境复现见[完整环境验证](full-environment-validation.md)，历史模型实验见[模型验证](model-validation.md)。

## 权威命令与调度

`src/server/services/online-match-service.ts` 在已有单场命令队列内采样权威快照、AI 玩家投影、规则查询、revision 与窗口身份。`src/server/ai-battle/decision.ts` 和 `effect-decision.ts` 只生成当前输入空间与服务端命令映射，不试执行候选。普通登场复用 `src/application/normal-member-play.ts`，效果步骤由 workflow 注册的只读选择查询提供。

`src/server/ai-battle/runtime.ts` 持有任务身份、取消句柄、已选结果与失败计数；`driver.ts` 在队列外请求模型。回包先在同一队列校验任务、attempt、revision 和窗口，再解析并通过正常命令入口提交。旧结果不重试、不增加当前失败计数。权威变更使在途任务失效并唤醒驱动；普通快照和观测读取不驱动游戏。

公开展示与阶段完成仍使用服务端 deadline。已选结果等待门禁后再次校验才能执行。删除对局先取消任务，再沿既有 recorder 封存；失败时保留结束重试入口，已经成立的权威胜负不改写。

## 当前资源输入

`state.selfResources` 从本次合法可见视图即时汇总己方顶层成员、逐色/总 HEART、活跃成员 BLADE、活跃能量与成功 LIVE 数，以及当前可见己方手牌 `handCards` 和其中的 `handLiveCount`。手牌条目只携带实例身份、卡号、名称、类型、费用/分数及 LIVE 需求，避免模型把构筑参考或其他区域的 LIVE 当成当前手牌。它不写入权威状态或数据库，不模拟候选后续效果，不替代 LIVE 规则计算；玩家级修正和未知声援不重复混入成员小计。原始桌面与完整候选仍保留。

普通登场候选就近展示对应实例的完整可见卡文；缺文本时只说明未提供，不暗示必有登场能力。盖牌候选说明从手牌移入 LIVE 区，完成设置候选复用权威查询显示当前盖牌数和确认后抽牌数。这些描述不改变候选集合或命令，原有零费替换、直接结束等合法选择仍完整保留。

普通登场同时展示新成员印刷 HEART / BLADE、旧成员当前有效值及逐色静态差值，便于比较同一手牌的不同换手位置。差值只来自本次可见正面，不叠加 `modifierDelta`，不预结算登场效果、常时条件或朝向变化，也不等同于完整舞台预测。策略效果的历史证据见[模型验证](model-validation.md)。

## 固定材料与模型配置

`assets/ai-battle/catalog.json` 只登记原始 μ's 预组镜像，沿用已核对的 YAML SHA。创建前用当前发布卡库及当前 PT 规则加载双方构筑，再冻结规则、教程、AI 手册与 AI 自身完整卡牌数量/卡文。真人的隐藏构筑不会发送给 AI。均衡与积极争取 LIVE 两份手册表达能量、换手、盖牌、近期手牌用途和过牌偏好，不替代规则查询或承诺模型强度。整副卡组参考通过 `src/online/serde.ts` 的 `toTransport` 再写入 JSON，保留 LIVE `requirements.colorRequirements` 中的逐色需求和 `totalRequired`；不会把 Map 变成空对象。

模型客户端读取服务端独立配置；卡效提取服务配置、旧 DashScope 变量与开发者 Codex 凭据都不作为运行时 fallback。

| 环境变量 | 用途 |
| --- | --- |
| `AI_BATTLE_BASE_URL` | 必填，所用 DashScope 地域/工作空间的 HTTPS `compatible-mode/v1` 地址，不带 URL 凭据或查询参数 |
| `AI_BATTLE_MODEL` | 必填，该账号/端点实际可调用的模型标识 |
| `AI_BATTLE_API_KEY` | 必填，仅保留在服务端，不进入观测材料或普通应用日志 |
| `AI_BATTLE_TEMPERATURE` | 默认 0.2，允许 0–2 |
| `AI_BATTLE_MAX_TOKENS` | 单次输出长度参数，默认 2048，允许 128–4096；不建立计费或预算统计 |

应用使用 `src/server/ai-battle/service.ts` 的独立 `AiBattleService` 实例；其 `createModel(knowledge, traces)` 在创建每局时使用 `readAiModelConfig()` 与 `DashScopeAiBattleClient`，冻结配置后才注册和启动驱动。未配置专用变量时创建失败，浏览器不会提供密钥或上游地址。

一键测试环境的 API 启动命令使用 `node --env-file-if-exists=.env` 读取根目录中的专用模型配置；已有显式测试环境覆盖仍优先。密钥不进入前端启动参数或新增的 tmux 命令文本。补充或修改配置后需重启 API。需要重启整套测试环境时使用 `pnpm test-env:start --no-db-rebuild` 保留现有数据。

当前客户端按 [DashScope 结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output) 使用 `response_format: {type: 'json_object'}`，提示中包含 JSON；`enable_thinking: false`，不请求逐步推理。字段与引用仍由本地闭合协议验证。接口结构参考 [Chat Completions 文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。具体配置模型是否支持这些参数、取消是否及时和真实等待时间，必须在实际端点复测；HTTP `AbortSignal` 只取消客户端等待，不能替代队列内的过期校验，也不保证上游已经停止生成。

每决定超时 30 秒；可重试服务错误最多原输入再试一次。HTTP 408/429/5xx 与非取消网络故障可重试，鉴权/参数/响应协议错误不盲目重试。空模型输出、非法 JSON、错误引用及上游 `finish_reason=length` 进入输出失败政策。上下文超出支持大小作为适配错误停止，不计为一次模型选择失败。连续失败三次停止，第三次不兜底；只有模型选择被权威接受才清零。

输入以当前 AI 可见桌面、完整候选和约束为主，同队列选取最后 12 条公开事件，保留采样截止序号与未纳入数量。当前不选更早历史或私有事件历史，也不回灌失败输出、`tradeoff` 或计划文本。舞台成员 `frontInfo.blade/hearts` 沿用可见性过滤后的有效值；`cost` 仍是印刷费用，`costDelta` 是当前舞台费用差，候选 `energyCost` 表达实际登场支付。

## 证据与容量

固定知识总正文最多 256 KiB；HTTP 请求正文最多 512 KiB，HTTP 响应读取最多 256 KiB。证据存储另设每材料 256 KiB、每局 16 MiB、进程 64 MiB，最多 32 局、每局 128 个决定、每决定 32 个事件、每局 8 份固定来源；内存计数同时为元数据预留空间。当前管理员服务最多四局活动对局、每管理员一局，结束材料保留一小时。这些限制不停止正常游戏回合，也不是模型调用次数预算。

`trace-store.ts` 只保存脱敏后的有限正文与元数据。固定材料每局一份，决定按引用复用。旧的已完成/失效记录优先淘汰；未结束请求不会因新决定静默失去引用。容量不足时记录缺失/裁剪或省略计数。被淘汰决定的迟到更新只增加丢弃计数，不重新创建旧记录。未淘汰的迟到响应更新原条目并增加观测 revision，列表读取不能只按新增决定 ID 判断变化。

导出采用 `loveca-ai-observation-v1`：决定、事件、来源材料一并快照，所有保留引用均可解析；`incompleteMaterialIds` 和各项缺失/淘汰计数说明不完整性。材料的 SHA 与原始大小针对脱敏后、容量裁剪前的正文。列表中的窗口键是简短展示值，完整采样身份保存在 `SAMPLE` 材料。需要 Map 的命令使用既有 `__transportType` 格式，不能把判定结果序列化为 `{}`。

`SAMPLE`、模型输出/校验、失败、准备的机械/兜底选择、等待、`SUBMIT`、`AUTHORITY_RESULT` 与结束状态分别记录。实际命令带既有 command record 引用。记录追加异常不重复执行命令。HTTP 元数据和原始正文分开采集，因此正文达到观测上限时，仍可区分上游长度截断、HTTP 读取上限、观测容量裁剪与 UI 折叠。凭据字段、错误中反射的实际 Key、URL/JSON 编码和读取边缘的 Key 前缀均在采集时脱敏；不保存 Authorization 请求头。

## 当前路由工厂

`createAiBattleRouter(service)` 挂在 `/api/admin/ai-battle`，整个路由树经过私密不缓存、登录与当前数据库 `rules.manage` 校验；服务再检查自身会话归属，包括已结束材料。通用 online 对局及管理员调试导出入口对 AI_DEBUG 同样检查当前权限和真人归属；AI_DEBUG 不生成管理员或房间号观战链接。

| 相对路径 | 用途 |
| --- | --- |
| `GET /presets`、`GET /sessions` | 允许的构筑/手册及自己的会话 |
| `POST /sessions` | 按构筑 ID、手册 ID、真人先后手创建 |
| `GET /sessions/:matchId` | 会话状态 |
| `GET /sessions/:matchId/snapshot`、`/public-events` | 真人正常可见桌面和公开事件 |
| `POST /sessions/:matchId/command`、`/advance`、`/end` | 真人命令、普通阶段推进与可重试的结束封存 |
| `GET /sessions/:matchId/decisions` | 有修订号的简短列表 |
| `GET /sessions/:matchId/decisions/:decisionId` | 某决定及其引用材料 |
| `GET /sessions/:matchId/export` | 可独立读取的当前保留会话 JSON |

观测读取只克隆保留证据，不读取新的权威快照、不执行命令、不唤醒 AI。完整验证范围见[支持矩阵](support-matrix.md)。数据库迁移只增加既有来源 CHECK 值，见[迁移说明](../../drizzle/migration-notes/ai-debug-match-origin.md)。

## 管理员页面

平台管理员从首页“运营工具 → AI 对战”直达；运营管理中心的“AI 对战调试”入口仍可使用，也可打开 `/?page=ai-battle-admin`。选择目录提供的真人构筑、AI 构筑、对应手册与真人先后手后创建。只有已验证的原始预组可选。已有活动对局时，可继续或结束该局；返回列表、离开页面或关闭观察框不会结束服务端对局。

牌桌继续复用 `GameBoard / PlayerArea`，通过 `AI_DEBUG` 远程传输接入正常真人命令与快照同步。能力配置禁止自由模式、切换视角、撤销和重开；外层工具栏显示等待、请求中、停止或结束状态。结束失败会保留牌桌与重试入口，成功后返回列表并允许新建。

观察框独立轮询保留证据，打开和关闭不控制 AI 调度。默认跟随最新，手选历史后保持编号；旧决定收到迟到材料会更新原详情，被淘汰则提示所选编号失效，必须由用户返回最新。历史 AI 局面是采样材料的只读摘录，不切换当前牌桌视角。

模型选择、提交来源及权威执行结果分开显示；只有 `AUTHORITY_RESULT.success` 为真才显示执行成功。真实请求按原消息顺序展开 role/content，采集元数据仍保留来源映射；原始响应单独显示。材料支持查找、折叠、复制保留正文、导出本决定和保留会话。折叠不裁剪内容；采集层裁剪/缺失仍明确标示。内容仅作为文本渲染。

浏览器夹具 `client/tests/e2e/ai-battle-ui.spec.ts` 覆盖宽屏／窄屏、日夜主题、键盘、观察导出、恢复和结束失败重试。完整数据库、HTTP、真实模型及截图的验证边界与复现步骤统一见[完整环境验证](full-environment-validation.md)。
