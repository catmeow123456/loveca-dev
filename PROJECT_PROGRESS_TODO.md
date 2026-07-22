# Loveca 项目进度及待办

更新时间：2026-07-22

## 2026-07-22：BP7 double 无色判心数据同步与 LIVE 判定支持（未提交）

- `sync-cards-loveca-excel.ts` 的 XLSX / CloudBase 已有卡同步与 `sync-cards-cloudbase-new.ts` 的新卡导入均识别 `double`，每个 token 展开为两个独立 `HEART + GRAY` 判心项；最新 `loveca_20260722221351.xlsx` 中 `PL!SP-bp7-028-L` 分数8「未来の音が聴こえる」、`PL!S-bp7-022-SECL` 分数8「恋になりたいAQUARIUM」、`PL!N-bp7-030-L` 分数0「Cheer Mode」已确认使用该数据形态。
- 新增独立 `GRAY` Heart：只补 LIVE 必要 Heart 总数，不可替代彩色需求；保留 `RAINBOW` 作为可替代任意颜色的 All Heart。服务端 `HeartPool`、真实 `LiveResolver` 与客户端判定预览沿用同一分配顺序；“还差”计算统一复用该分配规则，会先用 All Heart 补指定颜色，灰心只计入泛用总数缺口。
- 判定区、修正图标、休息室统计和卡组统计已支持灰心展示；成员卡与 LIVE 卡的共用详情窗现在会展示结构化判心，`double` 显示为两枚灰心，并同时支持抽卡/分数判心。
- 卡组编辑器的判心筛选和分析统计已新增独立“无色”项，不与 All/Rainbow 混用；成员持有 Heart、LIVE 必要 Heart 与判心 Heart 使用独立选项语义。卡牌数据管理的 BladeHeart 表单可新增/显示 `GRAY`，YAML 编辑和保存往返保留 `double` 展开后的两条灰心记录。
- 全量 Vitest 543 files / 5396 tests 通过，3 个 performance tests 按默认配置跳过；shared/server/client TypeScript 与前端生产构建通过。最新 XLSX `--dry-run` 读取 2333 行、2329 个可用编号，只报告 2 组已知重复号；三张 BP7 `double` LIVE 目前均属本地库尚未插入的 source-only 卡。Playwright 实测 1600×900 桌面与 390×844 窄屏详情抽屉，`double` 均渲染两枚灰心且无横向溢出。未执行数据库写入或 CloudBase 正式同步。

## 2026-07-22：认证凭据兼容停机切换修复（未提交）

- `auth-v1-to-v2-credential-cutover.ts` 改为将可识别 v1 bcrypt 摘要包裹为 `$loveca-bcrypt-raw$`，不再覆盖为必须重置；新版认证会在用户以原密码首次成功登录后，原子改写为当前 SHA-256 预哈希 bcrypt 格式。
- apply 继续撤销全局刷新令牌、邮箱验证 token 与密码重置 token；dry-run 发现 reset-required 或未知格式凭据会阻断，不能用参数绕过。当前 v2、兼容旧 bcrypt、原始旧 bcrypt、reset-required 与未知格式均进入报告。
- 修复位于 `fix/auth-v2-compatible-cutover` 隔离工作树，基于 `v3.7.2` 后的提交；`v3.7.2` tag 本身保持 reset-only 行为，正式发布需使用后续版本镜像。focused 认证 3 files / 25 tests、`pnpm typecheck`、Prettier 与 `git diff --check` 均通过。

## 2026-07-22：发布技能补充 loveca-api 镜像发布链路（未提交）

- `prepare-for-release` 新增 loveca-api Docker 镜像构建与发布步骤：本地候选检查后推送 `vX.Y.Z` / `sha-<commit>`，验证版本镜像后再提升 `latest`，发布清单记录平台与 digest；所有 registry 推送动作仍须用户确认。
- 生产 compose 增加 `LOVECA_API_IMAGE` 镜像入口，release runbook 改为生产机 `pull` 后以 `--no-build` 启动，并明确版本标签/digest 回滚与 GHCR 权限边界。验证仅覆盖技能格式、compose 展开、文档 diff 与命令静态检查；未构建或推送真实镜像，未操作生产环境。
- `v3.7.2` 发布准备已同步 `VERSION`、根/客户端 package 版本，补充 `3.7.1-to-3.7.2` 停机迁移说明；全量 540 files / 5379 tests、TypeScript 与服务端构建通过。前端主 chunk 增长到 4.48 MB 后触发 Workbox 4 MiB 上限，已按既有预缓存策略提高到 5 MiB 并重跑构建通过；仍保留大 chunk 性能告警，后续单独做代码分包。API 候选镜像等待发布准备提交后构建，未推送镜像、未提升 `latest`、未打 tag、未构建 Android 包。

## 2026-07-21：手动声援公开事件与旧回放兼容修正（未提交）

- 手动声援的联机公开事件改为先发送仅含数量的隐藏移动，再单独发送 `CardRevealed`，避免移动事件从已公开的最终状态提前带出卡面。来源区域同步读取实际声援方向，`PL!S-bp7-022-SECL` 分数8「想在水族馆恋爱」从卡组底声援不再被记录为卡组顶。
- 真实旧回放增加严格的声援事实兼容分类：仅接受同一 CHEER action 的 `deckEdge` 从缺失补为 `TOP`、`revealedCardIds` 补为当次 `cheerCardIds`，以及对应 CheerEvent 的 `deckEdge` 从缺失补为 `TOP`。`BOTTOM`、错误卡牌 ID 或其他字段差异仍会失败；历史夹具与新字段均保留。
- 全量 Vitest 534 files / 5341 tests 通过，3 个 performance tests 按默认配置跳过；服务端与客户端 TypeScript、`git diff --check` 通过。Prettier 按本 PR 既定豁免不做全仓格式化。

## 2026-07-21：盖放 LIVE 隐藏信息 continuous modifier 投影收口（已提交：`80c2b77`）

- Continuous modifier definition/factory 现必须显式声明 `PUBLIC` 或 `PLAYER_LIVE_ZONE_CONTENTS / SELF|OPPONENT`，统一 collector 将 SELF/OPPONENT 解析为真实 LIVE 区拥有者，并自动给同一 definition 产生的全部 modifier 附加投影依赖。权威 `collectLiveModifiers` 仍保留完整修正，只在玩家视图过滤。
- 修复 7 张遗漏：`PL!-bp4-002` 费用15「绚濑绘里」、`PL!N-pb1-007` 费用15「优木雪菜」、`PL!SP-bp5-012-N` 费用2「涩谷香音」、`PL!-bp6-022-L` 分数9「Dreamin' Go! Go!!」依赖 SELF；`PL!SP-bp2-010` 费用15「薇恩・玛格丽特」、`PL!S-bp5-010-N` 费用4「高海千歌」、`PL!S-bp5-011-N` 费用4「樱内梨子」依赖对方 LIVE 区。既有 `PL!N-bp1-012` 费用15「钟岚珠」与 `PL!N-pb1-001` 费用11「上原步梦」迁入同一机制。
- focused 覆盖区域拥有者可见、非拥有者盖牌时隐藏、部分公开仍隐藏、全公开后恢复、公开 modifier 并存，以及成员 `frontInfo` 和 requirement maps 两种泄露面；增加完整隐藏依赖清单治理测试。

## 2026-07-20：LL-bp2-001-R+ 非换手全额登场修正

- 修正 `LL-bp2-001-R+` 费用20「渡边 曜&鬼冢夏美&大泽瑠璃乃」所在成员区的普通登场：此成员仍不能因换手进入休息室；来牌能支付完整当前费用时，改走非换手直接登场，并在新成员登场后按重复成员规则将旧成员与 `memberBelow` 放入休息室、将 `energyBelow` 返回能量卡组。
- `GameSession` 不再丢弃费用方案的 `isRelay` 事实；直接登场不写 relay metadata、`replacingCardId` 或 `ON_RELAY`，并记录 `DUPLICATE_MEMBER` 规则动作。普通可换手成员在实际能量消耗相同时仍优先自动换手；同一通用回退也覆盖不满足换手条件的 `PL!HS-bp6-006`。
- focused 费用、登场与真实换手 metadata 卡效回归共8文件/114项通过，shared/server TypeScript 通过；非法操作收紧规划文档已记录严格模式下仍需验证的槽位锁、费用不足、触发、投影与回放边界。未修改 Runner、卡牌 definition、卡牌数据或 `llocg_db`。

## 2026-07-20：选择性能量活跃分支修正（已提交：`d52d12e`、`15d20e2`）

- 修正 `PL!N-bp7-005-P` 费用11「宫下爱」：“将2张能量变为活跃状态”分支的可选性改为检查能量区是否有卡，不再错误要求存在 WAITING 能量；能量全部已 ACTIVE 时仍可选该分支，并以0张实际变化正常结束。只有展示后能量区真实变空才记录 stale no-op。
- 盘点全部四条已实现的“多选一中活跃能量”路径：`PL!N-pb1-008-P+` 费用17「艾玛·维尔德」存在同类 WAITING 过滤并已同步修正；`PL!N-bp7-006-SEC` 费用17「近江彼方」与 `PL!N-pb1-010` 费用4「三船栞子」原本就允许0张实际变化，本轮只补全部 ACTIVE 回归。支付 `[E]` 的活跃能量门禁与无选择的自动活跃效果均未改动。
- 追加修正 `PL!N-bp4-008-R / P` 费用5「艾玛·维尔德」：能量区有卡时，弃1手起动能力的“将1张能量变为活跃状态”处理方向不再因全部 ACTIVE 而消失；若没有 WAITING 能量，选择该方向后直接以0张实际状态变化结束，不展示 ACTIVE 能量目标。能量与待机虹咲成员方向同时存在时先选方向，只有确有 WAITING 能量时才进入具体能量选择。
- 四条分支、能量 runtime 与卡效 runtime 定向6文件/97项通过；追加艾玛修正后的 focused、classification、runtime、energy 与 `sample-card-effect-runner` 共5文件/508项通过，服务端/客户端 TypeScript 通过。相关修正分布于提交 `d52d12e` 与 `15d20e2`。

## 2026-07-20：BP7 公开窗口与多效果 UI 修正（已提交：`d52d12e`）

- `PL!N-bp7-009-P` 费用4「天王寺璃奈」保持双方顶7各自移动、独立 owner 事件与统一 continuation，仅将公开展示改为“效果控制者（发动方）结果 -> 对方结果”至多两个连续窗口；两个窗口均固定由效果控制者确认，空结果不建空窗口，最后一个非空结果确认前不推进后续 waiting-room pending。
- 起动能力菜单移入全局 portal 图层，保留卡牌锚点并限制在视口可用高度内滚动，不再被对方半场的 overflow / stacking context 裁切或遮挡。同时点多效果顺序窗口改为纵向整行选项和左对齐文字，长卡文自然换行。
- focused N009/S003/N006/runtime 与 projector/replay/direct-mill 两批定向回归共161项通过（含 N009 重复验证）；服务端与客户端 TypeScript 通过。未修改其他 BP7 卡效逻辑；已提交为 `d52d12e`。

## 2026-07-19：BP7 费用4「松浦果南」三段卡效（已提交：`d52d12e`）

- exact 实现 `PL!S-bp7-003-SEC` 三条独立 queued ability identity：登场检视顶1可置底、LIVE 开始检视顶1可置底、登场在“本次 LIVE 结束前的成员待机保护”与“自身移动到 Aqours / Saint Snow 成员所在区域”之间强制选择。两条登场能力保持统一 ordered pending，由玩家决定结算顺序。
- 检视段复用私密 inspection 与标准 continuation；保留时回到刷新后主卡组顶，置底时只在 `MAIN_DECK` 内重排，不公开、不写 `revealedCardIds`、不产生休息室事件。空主卡组沿用标准 refresh，双方牌库均空则不建立空窗口。
- 待机保护落在 `member-state` 状态变化规则边界：动态检查当前顶层 Aqours 与印刷 BLADE <=3，不过滤候选；`CARD_EFFECT` 的控制者与实际选择玩家分别记录。对方决定的待机变化被阻止，受影响玩家自己选择时不阻止，因此费用15「セラス 柳田 リリエンフェルト」真实 AUTO 路径可正常待机并记录两项事实。保护不随来源离场，真实 `LIVE_END` 清理。
- 站位目标区域复用从 `PL!S-bp5-111 / 222` 既有支付能量站位流程抽出的纯 query，并用标准交换/移动事件 wrapper；没有建立任意免疫、保护、数值比较或站位 DSL。本轮未修改其他 BP7 单卡、卡牌数据或 `llocg_db`。

## 2026-07-19：BP7 第二批单卡 PL!N-bp7-027-L（已提交：`d52d12e`）

- exact 实现 `PL!N-bp7-027-L` 分数2「オードリー / 奥黛丽」：LIVE 成功时只从己方三个主舞台顶层选择结构化虹咲成员；0目标安全结束、1目标自动结算、多目标打开公开且不可跳过的真实单选窗口。
- 结算时用同一个 `collectLiveModifiers` snapshot 计算所选成员与双方全部其他顶层成员的 `getMemberEffectiveBladeCount`；ACTIVE/WAITING、临时 BLADE 与原本 BLADE replacement 均计入，memberBelow 不计，严格大于且空比较集合成立。
- 条件成立时以来源 LIVE 实例和独立 ability identity replacement 写 SCORE +1，并按旧新差值同步 `liveResolution.playerScores`；来源/目标 stale 安全 no-op，目标同实例移槽继续跟随，action payload 保存目标、双方比较事实、条件与加分结果。
- 本轮只新增单卡 workflow 与 focused test，不新增 runtime helper/shared family，不修改其他 BP7 卡牌、卡牌数据或 `llocg_db`。

## 2026-07-19：BP7 七弹第一批公开展示审查修正（已提交：`d52d12e`）

- 修正 exact `PL!N-bp7-006-SEC` 费用17「近江彼方」顶3费用的公开结果：命中继续由强制二选一窗口同时展示实际 `movedCardIds`，未命中则打开单一“确认公开结果”窗口；恰好3张且支付后刷新时也只读取费用事件保存的原始移动事实，确认前不 continuation。
- 修正 exact `PL!N-bp7-009-P` 费用4「天王寺璃奈」双方顶7：移除移动前 confirm-only，双方 refresh-aware 移动和两个独立 owner grouped event 全部建立后，按“效果控制者（发动方）结果 → 对方结果”至多打开两个连续真实公开结果窗口；均由效果控制者确认，空结果跳过，最后一个非空结果确认前不推进 continuation，双方均无实际移动时直接结束。
- 两个窄 runtime 边界不变：006 仍是“足额主卡组精确顶牌费用 + 移动后规则刷新”，009 仍是“多 owner 同一效果全部移动后统一 enqueue”。009 每个公开窗口只展示对应 owner 的结果，metadata/action/event 中每位玩家的原始顺序与重复事实完整保留；未扩成 direct-mill DSL。
- 本轮 focused + 相关 direct-mill/projector/pending 回归：11 files / 369 tests passed；本批四个 workflow/test 文件 ESLint 通过，`tsc --noEmit` 与 `tsc -b client` 通过；已提交为 `d52d12e`。

## 2026-07-19：联机观战 429 轮询与自动恢复闭环（未提交）

- 修复观战未修改快照仍重建 `remoteSession`、进而让依赖整个会话对象的 effect 反复重启并立即请求的问题；页面改用只依赖 `matchId + token + sessionId` 的串行 `SpectatorPollingScheduler`，常规 800ms 间隔从上次请求完成后计算，慢请求不重入。
- 未变化的视角、授权集合与授权提示保持原会话对象引用；主动切换视角会暂停轮询、递增客户端同步 generation 使旧在途响应失效，并保留公开日志与最后一份已验证桌面。观战连接不再无条件并行拉取公开日志，日志继续只按快照公开水位增量同步。
- 服务端 `ONLINE_SPECTATOR_RATE_LIMITED` 新增精确 `retryAfterMs` 与 `Retry-After`，默认单会话窗口由 10 秒 40 次提高到 10 秒 60 次；容量 429 仍使用独立 `ONLINE_SPECTATOR_CAPACITY_REACHED`。客户端 API 保留 HTTP 状态、结构化错误码和等待时间，并以 `token + sessionId` 在快照、公开日志和切换间共享退避窗口。
- 已进入桌面的频率保护不再向用户显示“请求过于频繁 / 请重试”，而是保留桌面并提示“观战同步暂时繁忙，正在自动恢复”；普通网络失败提示“观战同步中断，正在重新连接”。新会话容量已满仍作为入口阻断，提示稍后再进入。
- focused 验证覆盖静止 10 秒请求预算、慢请求不重入、429 等待后单次探测、视角切换旧响应丢弃、未修改会话引用稳定、同会话快照/日志共享退避、快照与按水位日志串行、服务端等待时间与路由响应，共 7 files / 78 tests 通过；shared/server/client TypeScript 与客户端相关文件 ESLint 通过；全仓 `pnpm test:run` 505 files / 5008 tests 通过，3 个 performance 文件 / 3 项测试按默认配置跳过。提交前审查补充视角切换会话代际校验与 token 变化初始化清理，并同步联机需求和设计文档；待生产环境复验，未 commit、未 push。

## 2026-07-19：BP7 energyBelow 第三批（未提交）

- 审查反馈修正完成并通过指定回归：范围仍仅为 exact `PL!N-bp7-004-P` 朝香果林、`PL!N-bp7-005-P` 宫下爱、`PL!N-bp7-007-SEC` 优木雪菜三段、`PL!N-bp7-019-N` 优木雪菜；不外推其他罕贵度或新增其他 BP7 卡效。
- 005 权威卡文修正为“将2张能量变为活跃状态”，WAITING 不足2张时才尽可能处理实际数量；已展示分支/目标确认时 stale 会审计 no-op、消费 pending 并继续，伪造输入仍拒绝。
- SP-PB2-022 的 5yncri5e!/CENTER observer gate 已从 runner 迁入单卡 workflow，通过通用 member-slot-moved observer registry 调度；runner 不再持有该卡专属判断。
- 新增窄 `placeEnergyFromEnergyDeckBelowStageMember`，只处理自己 ENERGY_DECK 顶 → 当前己方顶层成员 energyBelow；旧 `stackEnergyFromEnergyZoneBelowMember` 继续只处理 ENERGY_ZONE → energyBelow。
- 004 按日文采用“能量区”费用；007 差值固定为 `max(0, own energy zone count - 6)`。below 放置不发仅表示进入能量区的 `ON_ENERGY_PLACED_BY_CARD_EFFECT`。
- 本轮 focused + 指定 regression：20 files / 396 tests passed；`tsc --noEmit`、`tsc -b client`、玩家可见文案审计（3758 条候选文本）与 `git diff --check` 均通过。当前全量 Vitest：523 files（518 passed / 2 failed / 3 skipped）、5192 tests（5187 passed / 2 failed / 3 skipped）；仅保留既知 online cheer `CardMovedPublic` 严格投影断言与 real-data replay `deckEdge/revealedCardIds` 漂移两类非本批失败。

## 2026-07-19：BP7 第二批两张卡效（未提交）

- exact 实现 `PL!S-bp7-019-L`、`PL!SP-bp7-004-P`，不使用 `baseCardCodes` 外推未知罕贵度。019 依日文权威卡文的「2枚まで」实现为休息室 Aqours 任意卡 0～2 张有序置底，明确不采用中文公开 API 漏译后的“恰好2张”语义。
- 004 是整体可选发动，但发动时必须恰好选3张自己休息室的结构化 Liella! 成员；只在三张完整实际移动后检查 `movedCardIds`，其中至少1张不持有 BLADE HEART 时才给当前舞台堇 BLADE +2。堇在移动完成前失效不回滚三张置底，只安全跳过奖励。
- 两条休息室置底都复用 `moveWaitingRoomCardsToDeckBottomForPlayer` 和 shared `public-card-selection-confirmation`；非空首次提交只公开顺序，权威 deadline 后完整重验，任一 stale 则整组不移动。0张不建空公开确认。没有新建任意 source/destination 区域 DSL。
- shared 目标 BLADE family 已改用 target-aware 入口：`sourceCardId` 始终是真实发动实例，受益对象不同时写 `targetMemberCardId`。已结算 modifier 不随 LIVE 来源离区清除，但随目标离场、替换或实例重登清除；`PL!S-bp2-025-L`、`PL!-bp4-014`、`PL!-bp4-024` 保留原候选、数值、来源门禁与 continuation。

## 2026-07-18：BP7 memberBelow 第一批（未提交）

- exact 实现 `PL!SP-bp7-001-P` 香音、`PL!N-bp7-003-SEC` 雫、`PL!S-bp7-005-SEC` 曜的 2/2/3 段能力，不外推其他罕贵度或 BP7 卡。
- 退役手动压人命令链与 host 卡号白名单；`memberBelow` 新堆叠只能由卡效 runtime 创建。原 helper 泛化为 `stackMemberCardBelowStageMember`，并迁移 Ren / Rina / Kotori / Kinako / Sayaka 五个旧 workflow，未增加任意区域 DSL。
- BLADE modifier 支持真实 source 与 target member 分离：有 target 只随 target 离场清理，旧无 target 仍 source-bound，写入目标必须是当前己方顶层成员。Heart replacement 支持完整印刷 `HeartIcon[]` 快照并按来源实例离场/重登清理。下方 continuous 扫描仅登记 exact 香音，不开启其他 memberBelow continuous。
- 曜的两个 ON_ENTER 委托由窄 `delegated-ability-sequence` 连续调度：舞台查询兼容历史 `PLAYED_MEMBER / STAGE_MEMBER` definition，三个历史 workflow 已有经曜真实 runner 委托样本。选定 definition 与顺序后逐个完成；只有真实交互、终局或 sequence 实际推进才算进展，仅新增 action/pending 引用会按无进展安全跳过；pending ID/abilityId 分栏审计。子能力间不返回全局 check timing，不创建假 EnterStageEvent、不扩展成任意卡效解释器。

## 2026-07-18：bp7 第四批成员卡效与 shared family 晋升（未提交）

- 完成 exact `PL!S-bp7-002-P` 费用4「樱内梨子」：扩展 `member-on-enter-draw.ts` 的主舞台有效费用门槛/可选团体配置，以 `getMemberEffectiveCost` + `cardBelongsToGroup` 实时重扫己方三个顶层成员，满足 Aqours 有效费用>=9时抽1；confirm-only 显示当前数量/条件/实际抽牌。
- `PL!-bp3-009-R＋ / P / P＋ / SEC` 费用2「矢澤にこ」ON_ENTER 段晋升到同一 shared family，保留费用13、独立 abilityId、实时文案、来源离场后结算与抽牌刷新语义；`pl-bp3-009-nico.ts` 只保留起动 Heart 能力。
- 完成 exact `PL!S-bp7-016-N` 费用15「国木田花丸」 continuous registry 三成员条件下 SOURCE_MEMBER 红/绿/蓝 Heart 各1；完成 exact `PL!SP-bp7-014-N` 费用4「岚千砂都」on-move BLADE +2。on-move family 同时修正来源 stale/null 时遗留 pending：改为 no-op action + 统一 continuation，旧两张 +1 卡保持。
- Focused/classification 共 538 项已通过；token/text 16 项、server/client TypeScript、玩家文案审计与 `git diff --check` 均通过。Runner 本批不新增 register/import，仍为 3760 行；不建立 ON_ENTER/持续 Heart/移动奖励 DSL，未 stage/commit/push。

## 2026-07-18：Aqours bp7 第二批 bottom direct-mill 卡效（未提交）

- 修正 `PL!S-bp7-006-P` 费用2「津岛善子」、`PL!S-bp7-015-N` 费用5「津岛善子」、`PL!S-bp7-020-SECL` 分数3「快乐派对火车」与 `PL!S-bp7-021-L` 分数5「我们的旅程永不落幕」的底牌展示时序：实际移动入休息室后先用 `revealedCardIds` 向双方展示，公开窗口确认前不写 Heart/必要 Heart、抽牌或 SCORE modifier，确认后才按实际移动集合判定并继续待机池；真实公开窗口取代满足舞台条件时的纯 confirm-only，不产生双弹窗。
- 完成 exact `PL!S-bp7-020-SECL` 分数3「快乐派对火车」两段独立 LIVE_START：公开的全舞台顶层成员 ACTIVE 条件复用 `conditional-live-modifier`，底1结构化 Aqours MEMBER 条件复用第一批 bottom helper；两条来源 LIVE requirement modifier 可叠加且各自 replacement 幂等。
- 完成 exact `PL!S-bp7-021-L` 分数5「我们的旅程永不落幕」：舞台3名门槛后 refresh-aware 底5，实际5张中 MEMBER 3～4张抽1、5张抽1且来源 LIVE SCORE +1；完整 action 后才入队分组等待室事件。未扩 gain-heart family、未建立 reward DSL、未实现底部声援或其他 bp7；未 stage/commit/push。
- 完成 exact `PL!S-bp7-022-SECL` 分数8「想在水族馆恋爱」：统一普通/手动/自动/追加/重做声援的 TOP/BOTTOM 纯 query 与 `CheerEvent`/action 审计事实；LIVE 成功段按 event-inclusive 当前声援事实做三张不同 Aqours 成员印刷红绿蓝 Heart 匹配，以来源 LIVE SCORE replacement 和差值刷新结算。未与 bottom direct-mill 合并，未建立方向/Heart DSL，未实现其他 bp7。

## 2026-07-18：费用11「葉月 恋」卡组顶放置费用/效果边界修正（未提交）

- 修正 `PL!SP-bp5-005-P / R＋ / AR / SEC` 费用 11「葉月 恋」第一条起动能力误沿用 `PL!SP-bp5-006` 费用 11「桜小路希奈子」 FAQ Q234 费用门禁的问题；叶月恋的卡组顶放置改为 refresh-aware 效果处理，主卡组不足3张仍可发动，卡组耗尽时将休息室洗回后继续放置，按本次放置的卡中 Liella! 成员数获得 BLADE，且不记录 `PAY_COST`。
- 桜小路希奈子仍保持主卡组至少3张才能发动、精确将顶3张作为费用且后续非法站位选择不回滚费用的已有语义。本修正不修改 Runner、trigger matcher、卡牌数据或 cost-calculator，未 stage/commit/push。

## 2026-07-18：本回合事件边界修正（未提交）

- `GameService.advancePhase` 在真实新回合切换时写入权威 `ON_TURN_END`（首回合前不写）和 `ON_TURN_START` 事件；不改变既有 phase trigger 入队，只为 `eventLog` 的“本回合”查询建立可靠边界。
- 修正 `PL!N-bp1-006-P / P＋ / R＋ / SEC` 费用 13「近江彼方」第一条起动能力会错误继承上回合虹咲成员登场事实的问题；跨回合弃1手仍照常支付与消耗次数，但不再活跃能量。
- 同一边界覆盖 `PL!N-bp3-005` 费用 15「宮下 愛」的本回合成员登场次数/第3次登场判断，以及 `PL!S-bp3-019-L` 分数 7「MIRACLE WAVE」的本回合声援公开统计。未修改 Runner、卡牌 definition、trigger matcher 或卡牌数据；未 stage、commit、push。

## 2026-07-17：虹咲预组1 费用7「天王寺璃奈」与复合费用回收 LIVE shared 晋升（未提交）

- `PL!N-sd1-009-SD` 费用 7「天王寺璃奈」新增独立起动每回合1次 ability identity；definition/activatedUi 使用 Excel `sheet1!B911` 精确中文展示文本，支付 `[E][E]` 并弃1手后回收1张虹咲 LIVE。
- 旧 `PL!N-bp5-014-N` 费用 4「中須かすみ」与 `PL!SP-sd2-006-SD2` 费用 7「桜小路きな子」单卡 ownership 晋升为 `workflows/shared/activated-pay-two-energy-discard-recover-group-live.ts`；三张各自保留 ability identity、旧玩家文本、turn1 identity 与持久 stepId。family 只配置 ability/source/group/显示名与 step/action 名，不开放固定费用、弃牌数、卡种或区域。
- 复合费用原子重验来源、手牌与 ACTIVE 能量；能量支付复用 marker-aware 通用选择并精确记录 ID，弃手复用标准 enter-waiting-room wrapper。支付后重扫，刚弃置的合法 LIVE 可回收；无目标保留费用/turn1，公开确认 deadline 后重验并移动，最后经统一 continuation 处理弃手产生的 pending。
- 两份旧单卡 focused test 已迁入 `tests/integration/activated-pay-two-energy-discard-recover-group-live.test.ts`；Runner 仅把两组旧 import/register ownership 合并为一组 shared import/register。未 stage、未 commit、未 push。

## 2026-07-17：虹咲预组1 费用13「上原歩夢」两段能力（未提交）

- `PL!N-sd1-001-SD` 费用 13「上原歩夢」新增两个独立 queued ability identity：登场检视顶5并至多公开加入1张虹咲 LIVE；LIVE 开始可支付 `[E]`，使己方主舞台其他虹咲成员各获得本次 LIVE 的 `[BLADE]+1`。definition 使用 `baseCardCodes: ['PL!N-sd1-001']`，中文 `effectText` 采用本地同步 Excel 展示文本并仅将 `[ブレード]` 等价替换为 `[BLADE]`。
- 登场段只扩展 `workflows/shared/look-top-select-to-hand.ts` 的有限配置，复用短牌库 clamp、0–1 私密选择、公开确认、inspection-to-waiting grouped event、`ON_ENTER_WAITING_ROOM` 入队与统一 continuation；不新增单卡登场 workflow。
- LIVE 开始段新增窄单卡 `workflows/cards/n-sd1-001-ayumu.ts`，复用 marker-aware 标准能量支付、舞台 selector、成员 BLADE modifier 与 continuation。启动时来源/能量/其他虹咲目标不足均安全 no-op；确认发动重新校验来源与能量，支付后重扫己方三个主舞台顶层目标，排除来源、对方、非虹咲、memberBelow 与其他区域。支付后目标全失效时费用与 `PAY_COST` 保留，记录 no-target 后继续。
- Runner 本批只新增 `n-sd1-001-ayumu.ts` 的 import/register 胶水；focused/classification、token/text governance、server/client TypeScript、玩家文案审计与 Git 边界验证结果见本窗口收尾。未 stage、未 commit、未 push。

## 2026-07-17：虹咲预组1 分数4「Dream with You」（未提交）

- `PL!N-sd1-028-SD` 分数 4「Dream with You」只实现 LIVE 开始时己方主舞台顶层成员实时有效 BLADE 合计至少10时，此来源 LIVE SCORE +1；括号 DRAW 保持由全局声援结算处理，不新增第二个 ability。
- 扩展 `workflows/shared/conditional-live-modifier.ts`：旧 `PL!-bp3-023` 卡号命名 context 晋升为有限的舞台有效 BLADE 合计行为查询；旧必要 Heart -2 wrapper 保持，新卡通过 SCORE replacement 幂等写入并以旧新差值刷新 `liveResolution.playerScores`。FAQ Q116 锁定 LIVE_START 结算时间边界，后续 CHEER_COUNT 变化不撤销既得分数。
- focused/classification、token/text governance、server/client TypeScript、玩家文案审计与 `git diff --check` 结果见本窗口收尾；Runner 本批不修改，未 stage/commit/push。

## 2026-07-17：虹咲预组1弃二手回收成员 / LIVE（未提交）

- `PL!N-sd1-005-SD / PR` 费用 11「宮下 愛」与 `PL!N-sd1-007-SD` 费用 13「優木せつ菜」新增各自独立的起动每回合1次 ability identity；强制弃2手后分别回收1张虹咲成员 / 虹咲LIVE。
- 两张卡均只扩展 `workflows/shared/discard-cost-waiting-room-to-hand.ts` 的窄静态 selector 配置，复用标准手牌进休息室 trigger wrapper、支付后重扫、waiting-room-to-hand 两阶段公开确认与统一 continuation；无合法目标时费用保留并直接 no-op 完成。
- 本批未新增单卡 workflow，也未修改 Runner。
- focused/classification 共 217 个测试、token/text governance 共 16 个测试、玩家文案审计与 `git diff --check` 已通过；server/client TypeScript 均被既有 `on-enter-pay-two-play-low-cost-hand-member.ts:532` 类型错误阻断；未 stage/commit/push。

## 2026-07-17：虹ヶ咲 bp1 费用13「近江彼方」与费用9「艾玛·维尔德」（未提交）

- `PL!N-bp1-006-P / P＋ / R＋ / SEC` 费用 13「近江彼方」两条独立起动能力完整实现：弃1手并按本回合权威 `ON_ENTER_STAGE` 事件事实判断虹咲成员登场的第一条保留窄单卡 workflow；支付 `[E][E]` 抽1的第二条扩展既有 `activated-pay-energy-draw` definition `baseCardCodes`，不新增 abilityId 或 Runner 注册。
- `PL!N-bp1-008-P / R` 费用 9「艾玛·维尔德」新增独立起动 abilityId，并扩展 `discard-cost-waiting-room-to-hand` shared family。新增有限规则轴只表达“弃置成员的印刷费用”与“回收费用严格更低的成员”；支付后重扫休息室，无目标直接结束，有目标继续使用 public-card-selection confirmation 并在 deadline 恢复时动态重算。
- 新增 `hasMemberEnteredStageThisTurnMatching` 纯 query，只读取当前回合 `ON_ENTER_STAGE` 事件事实并按 selector 匹配，不读取 `movedToStageThisTurn` / `positionMovedThisTurn`，不扩成事件 DSL。未实现 `PL!N-bp1-025-L` 的 ALL BLADE 全局规则提醒，未推进 steps-lite、trigger matcher、cost-calculator 或通用费用 DSL。
- focused/classification、既有 shared family、public confirmation、sample runner、token/text governance 与玩家文案审计已通过；Runner 本批仅增加彼方第一条的一组 import/register，未 stage/commit/push。

## 2026-07-16：虹ヶ咲 bp1 费用9璃奈 / 米娅登场卡效（未提交）

- `PL!N-bp1-009-P / R` 费用 9「天王寺璃奈」按 cards.json 日文规则与 Excel 中文原文完整实现；旧 `PL!-bp5-010-N` 费用 5「高坂穂乃果」单卡 ownership 晋升为 `discard-mill-top-recover-member` 窄 shared family，旧 LIVE_START 来源校验、mill 3、A-RISE selector、事件与 continuation 保持。
- `PL!N-bp1-011-P / R` 费用 9「ミア・テイラー／米娅·泰勒」保持单卡 workflow；可选弃手后逐张公开至首张 LIVE，公开确认前不移动，确认后命中 LIVE 入手且其余牌作为一个 inspection 批次入休息室。ON_ENTER pending 成立后两张新卡都不因来源离场取消。
- `effects/look-top.ts` 新增原子 `inspectTopCardsUntilMatch`，并迁移费用 13「高坂穂乃果」`PL!-pb1-001` 的既有局部循环；它不是 reveal DSL，也未推进 steps-lite、trigger matcher 或通用卡效解释器。Runner 仅 shared import/register 替换与米娅单卡 import/register。

## 2026-07-16：虹ヶ咲 bp1 费用10「桜坂しずく」与分数5「Butterfly」（未提交）

- `PL!N-bp1-003-P / P＋ / R＋ / SEC` 费用 10「桜坂しずく」两段完整实现：登场段复用既有同文 shared ability 与公开回收流程；LIVE 开始段以窄单卡 workflow 支付 `[E]` 后强制选择普通六色 Heart，写来源成员 `SOURCE_MEMBER` Heart +1。
- `PL!N-bp1-028-L` 分数 5「Butterfly」只登记 LIVE 开始支付主效果：支付 `[E][E]` 后用结构化虹ヶ咲成员查询决定来源 LIVE SCORE +1，并同步 `playerScores`；括号 DRAW 保持由全局 LIVE/声援结算处理。
- 两张卡均复用 marker-aware 精确能量选择、真实支付 action 与统一 continuation；Runner 仅加各自 import/register。同步 focused/classification、ownership 登记及 `actionStep / noOtherMemberStep` 仅为内部 `RESOLVE_ABILITY` 标签的文档修正。

## 2026-07-16：虹ヶ咲 bp1 两张卡效与身份条件能量 family 晋升（未提交）

- 完成 `PL!N-bp1-001-P / R` 费用 9「上原歩夢」：扩展 `pay-energy-gain-blade`，LIVE 开始可支付 `[E]`，支付成功后只给来源成员 `[BLADE]`；共享 family 统一为 `支付[E]` 与单一 `不发动` 跳过入口。
- 完成 `PL!N-bp1-004-P / R` 费用 4「朝香果林」：登场结算时检查来源以外的其他虹ヶ咲舞台成员，满足时活跃至多 1 张 WAITING 能量。旧 `PL!HS-bp6-012-R` 费用 2「百生 吟子」单卡流程晋升为 `on-enter-other-identity-activate-energy` 窄 shared family，配置轴仅保留 GROUP / UNIT identity 等真实差异。
- focused、classification、token/governance、玩家文案审计、server/client TypeScript 与 `git diff --check` 均通过；下一步仅需按批次边界审阅并提交，当前未 stage/commit/push。

## 2026-07-16：PL!S-bp2-007 追加声援触发顺序修正（未提交）

- 修正 `PL!S-bp2-007-P / P＋ / R＋ / SEC` 费用 4「国木田花丸」第一段自动能力：最初普通声援仍负责创建待机能力，追加声援不会再次触发 ON_CHEER；能力结算时改为读取当前 LIVE 已产生的普通与追加声援公开卡。
- 因此最初普通声援没有 LIVE、玩家先结算 `MIRAI TICKET` 并由追加声援公开 LIVE 时，本能力随后结算可以抽1；若玩家先结算本能力，则当下无 LIVE 时安全结束，后续追加声援不会追溯补发。手牌 <=7 条件继续按 FAQ Q120 在结算时实时检查。
- focused 使用真实 ON_CHEER 入队路径覆盖两种顺序，并保留 additional-only 事件不产生新 pending、对方声援不命中、历史 LIVE 不混入当前 LIVE、已移出 resolution 但仍属于当前声援事实的既有回归。runner 不修改。

## 2026-07-16：PL!N-bp5-001 追加声援结算时点修正（未提交）

- 修正 `PL!N-bp5-001-R＋ / P / AR / SEC` 费用 5「上原歩夢」的声援颜色统计：普通声援事件仍作为本次自动能力的诱发事实，追加声援不会再次触发 ON_CHEER；能力实际结算时改为统计当前 LIVE 已产生的普通与追加声援公开卡。
- action payload 的 `cheerEventId` 继续记录最初普通声援，`revealedCardIds` 改为记录实际参与本次结算统计的当前 LIVE 声援卡。颜色筛选仍只统计自己的 `BladeHeartEffect.HEART`，不计 DRAW / SCORE BLADE HEART、基础 Heart、LIVE 必要 Heart 或对方卡。
- focused 覆盖玩家先结算追加声援再结算本能力时 2→3 色获得[桃ハート]、5→6 色进一步获得[スコア]+1；也覆盖先结算本能力时后续追加声援不会追溯补发效果。`PL!S-bp2-007` 保持未修改，等待单独确认。

## 2026-07-16：PL!S-bp6-009 LIVE 成功声援条件修正（未提交）

- 修正 `PL!S-bp6-009-P / R+ / P+ / SEC` 费用 9「黒澤ルビィ」第二段卡文误读：真实语义为「【LIVE成功时】【中央】因声援公开…」，不是「中央声援」。definition 补上 `requiredSourceSlots: [SlotPosition.CENTER]`，玩家文本分开中央来源限定与声援条件。
- LIVE_SUCCESS 条件改为读取本次 LIVE event-inclusive 声援事实，普通与 `MIRAI TICKET` 等效果产生的追加声援均计入；仍排除上一次 LIVE 的历史声援。局部 action payload 从误导的 center-cheer 命名改为普通 cheer 命名，ability identity 保持不变。
- focused 补齐左/中/右真实 LIVE_SUCCESS 入队限定，并将旧「忽略追加声援」断言改为「普通声援未命中、追加声援命中 SCORE Aqours LIVE 时加分」。`PL!S-bp2-007` 的同时自动能力时序仍待单独确认。

## 本次 2026-07-16 联机观战入口、视角与容量收口

- 产品入口收敛为“输入房间号观战”：玩家房间面板只提示分享房间号；普通玩家专用观战链接的 UI、客户端调用、服务端接口与运行态类型已完整移除，不保留停机更新后无意义的兼容入口。
- 观战会话改为“授权视角集合 + 当前视角 + `viewVersion`”：房间号入口按双方开关授权，管理员入口授权先攻 / 后攻；同一会话可切换视角，并始终只返回一个玩家投影。
- 房间号一侧关闭时，已有会话在下次快照收到结构化提示；当前视角被关闭时自动切到仍开放视角，双方均关闭时会话永久失效；重复提交相同开关状态不会递增视角版本或覆盖未读提示。客户端按视角版本清理旧桌面并丢弃旧版本在途响应。
- 只读与安全边界收口：快照、公开日志和切换均校验 `token + sessionId`；观战投影不提供可用命令，共享桌面隐藏卡效、费用、撤销、成功 LIVE 选择和判定控件。观战响应禁止缓存、引用与索引，客户端网络错误地址脱敏 token / sessionId。
- 展示名由服务端决定，登录用户读取账号资料，未登录用户分配稳定游客名；本局参赛账号不能通过房间号进入观战。每个对局固定最多 10 个活跃普通观战会话，管理员不占公开名额；会话恢复、快照、公开日志与视角切换共享默认 10 秒 40 次的频率窗口。
- `docs/PROJECT_REQUIREMENTS.md`、`docs/system-design.md` 与 `docs/online-mode/preparation.md` 已同步当前产品行为；对局结束后最终只读桌面保留 1 分钟仍未实现，持久化观战审计不在当前范围。
- 验证：focused suite `tests/integration/online-room-service.test.ts`、`tests/integration/online-route-error-handling.test.ts`、`tests/unit/game-store-remote-sync.test.ts`、`tests/unit/battle-surface-capabilities.test.ts`、`tests/unit/api-client-redaction.test.ts` passed（5 files / 68 tests）；rebase 最新 `origin/main` 后 `pnpm test:run` passed（462 files / 3955 tests，3 performance tests skipped）；shared / server / client TypeScript 与 `git diff --check` passed。

## 2026-07-16：Liella! SP-sd1 最后一批登场卡效（未提交）

- `PL!SP-sd1-002-SD` 费用 11「唐 可可」新增独立 queued ON_ENTER identity；日文逐字核对 `llocg_db/json/cards.json`，definition 中文逐字采用 Excel `loveca_20260626015115.xlsx` `sheet1!A866:X866`，保留空行与括号说明。当前只有真实 SD 印刷，definition 仅登记 `baseCardCodes: ['PL!SP-sd1-002']`。
- 新增窄单卡 workflow `workflows/cards/sp-sd1-002-keke.ts`：私密选择自己当前手牌中印刷费用 <=4 的 Liella! MEMBER，不支付该成员登场费用；选择目标与区域两步均按当前权威状态重验。区域限制读取当前槽内成员实例：空区域合法；已有成员仅在其不属于 `movedToStageThisTurn` 且 `canMemberBeRelayedAway` 允许时合法；仅 `positionMovedThisTurn` 不锁区域，限制会随本回合登场成员移动并在其离场后解除。
- `runtime/play-member-to-stage.ts` 新增 `playMemberFromZoneToStageSlotWithReplacement`，只负责 HAND / WAITING_ROOM 到指定成员区的单成员原子移动与完整替换生命周期：energyBelow 返回能量卡组、原成员与 memberBelow 进入休息室、标准 LeaveStage / EnterWaitingRoom / EnterStage 事件及单 replacement 有效费用快照。helper 不判断卡牌费用/团体/区域规则，不创建窗口、不支付费用、不推进 pending。`n-bp1-002-kasumi.ts` 已迁移到该 helper，原费用、弃手、候选区域、action payload 与触发顺序保持。
- 本卡先完成父 `RESOLVE_ABILITY`，再统一入队本次 LeaveStage / EnterWaitingRoom / EnterStage 触发并通过 shared continuation 返回检查时点；来源入队后离场仍继续。无合法“手牌目标 + 区域”组合直接消费 pending，不打开空窗口；stale 手牌或区域事实会刷新当前步骤或安全结束，不移动其他卡，不创建 `PendingCostPayment`。
- focused 新增 `tests/integration/sp-sd1-002-keke.test.ts` 12 项并扩展 classification；`n-bp1-002-kasumi.test.ts` 原 5 项迁移回归通过。最终指定验证结果见本窗口收尾；累计 001/003/004/005/007/009/011、shared 晋升、stale 能量修正及 `llocg_db` 本地状态全部保留，未 stage、未 commit、未 push。

## 2026-07-16：Liella! SP-sd1 第五批登场卡效（未提交）

- `PL!SP-sd1-007-SD` 费用 7「米女メイ」新增独立 queued ON_ENTER ability identity；日文核对 `llocg_db/json/cards.json`，definition 中文逐字采用 Excel `loveca_20260626015115.xlsx` 多行中文效果。当前卡库与 Excel 只有真实 SD 印刷，definition 仅登记基础编号 `PL!SP-sd1-007`。
- 扩展 `workflows/shared/pay-energy-waiting-room-to-hand.ts`，但将既有 ACTIVATED / STAGE_MEMBER family 与本卡 queued ON_ENTER / optional-payment 生命周期分成两套 starter/step 路径；只共享目标 selector、`payImmediateEffectCosts`、`createWaitingRoomToHandEffectState`、`finishWaitingRoomToHandWorkflow` 与 public-card-selection confirmation。本卡不增加 perTurnLimit，不记录 ACTIVATED `ABILITY_USE`，来源成员在入队后离场不取消已发生的登场能力。
- 启动时无合法 Liella! MEMBER 目标直接消费当前 pending；不足2张 ACTIVE 能量时只允许“不发动”。支付普通能量按稳定顺序自动选择，特殊能量走通用精确选择并在恢复时重验方向与能量区归属；`PAY_COST` 记录实际能量 ID。支付后重扫目标，目标消失时保留费用并安全继续。
- 回收阶段强制单选自己当前休息室、owner 正确且属于 Liella! 的 MEMBER；首次提交只向双方公开相同选择与权威 deadline，卡仍留在休息室且 pending 不推进。到期由任一参与者恢复，原 workflow 重验初始候选与当前 owner/区域/类型/团体，stale 目标不替换、不退费，只在最终移动或 stale 安全结束后统一 continuation。runner 本批零修改；`effect_module_coverage.md` 与 `module_gap_list.md` 的既有 family/gap 陈述仍准确，未改。
- 用户指定回归与 token/text governance 共13文件642 tests 通过，Type Errors 0；服务端 `tsc --noEmit` 与客户端 `tsc -b client` 通过。

## 2026-07-16：Liella! SP-sd1 第四批登场卡效（未提交）

- `PL!SP-sd1-009-SD` 费用 13「鬼塚夏美」新增独立 queued ON_ENTER ability identity；日文逐字核对 `llocg_db/json/cards.json` 顶层对象与 Excel `loveca_20260626015115.xlsx`，definition 中文逐字采用 Excel 多行中文效果。
- 作为第二种真实配置扩展 `workflows/shared/optional-pay-energy-look-top-select-to-hand.ts`：固定可选支付1张 ACTIVE 能量，支付成功后才按当前能量区总张数检查9张门槛；不足时保留实际 `PAY_COST` 并安全结束，达标时委托 `look-top-select-to-hand` 完成顶5 refresh、私密强制单选与 grouped remainder。特殊能量恢复后重读当前门槛，stale 选择原子拒绝。
- shared 配置只增加 abilityId、支付/选择 stepId、topCount 3/5、可选支付后能量门槛与 action/玩家步骤文案；不增加任意费用/条件/selector DSL，不接 public-card-selection confirmation，不修改 runner。既有 012/008/017 的顶3行为与原玩家文案保持。
- focused 覆盖真实 PLAY_MEMBER 入队、支付/跳过、无 ACTIVE、8/9张、ACTIVE/WAITING/marker 混合、特殊能量精确选择与 stale/恢复、0至5张、refresh、非法/重复/窗口外/stale 卡选择、私密投影、grouped 事件/新 pending、来源离场及旧同文组回归。指定11文件共611 tests 通过，Type Errors 0；server/client TypeScript、inventory（1个基础编号、1/1 implemented）、玩家文案3495条审计与 `git diff --check` 均通过。

## 2026-07-15：Liella! SP-sd1 第三批 LIVE 开始卡效（未提交）

- `PL!SP-sd1-003-P / SD / SD2` 费用 15「嵐 千砂都」通过基础编号共用独立 LIVE_START ability identity；日文逐印刷核对 `llocg_db/json/cards.json`，日中多行效果逐印刷核对 `loveca_20260626015115.xlsx`，三种印刷全文一致。definition 中文采用 Excel 原文，仅将五个 `[ブレード]` 等价替换为现有 `[BLADE]` token。
- 扩展 `workflows/shared/live-start-discard-gain-blade.ts`：奖励配置收窄为 `PER_DISCARD / FIXED_TOTAL` discriminated union；003 使用恰好2张与固定 BLADE +5，不按弃置张数缩放且不附带抽牌。既有 `PL!SP-PR-009/011/012` 的弃1、+1、弃 LIVE 抽1与 `PL!S-bp3-003` 的0至2张、每张+2保持。
- 手牌不足2张时在开窗前消费 pending；足额时窗口固定 min/max 2，并在提交时原子重验数量、重复、初始候选与当前手牌。成功弃置走一次 grouped HAND -> WAITING_ROOM trigger wrapper；新 pending 会使 ordered shortcut 失效并回到统一选择，不丢失、抢跑或重复结算。
- BLADE modifier 精确绑定受益成员实例，站位移动保留、LIVE结束统一清理。本批补齐标准 LeaveStage 的窄生命周期缺口：除既有显式 target-member modifier 外，同一离场实例的 BLADE `sourceCardId` 绑定也会清理；不影响未绑定的玩家 SCORE 或其他成员 BLADE。
- focused 回归覆盖真实 LIVE_START 入队、ACTIVE/WAITING、0/1/2/3 手牌、跳过、混合弃牌不抽牌、固定 +5、非法/重复/窗口外/stale 原子拒绝、来源两种离场时机、移动/离场/LIVE结束、ordered 新 pending、旧 SP-PR/S-bp3-003 兼容与三印刷 classification。指定10文件共580 tests 通过；服务端 `tsc --noEmit`、客户端 `tsc -b client`、inventory（三印刷1/1 implemented）、玩家文案审计3496条与 `git diff --check` 均通过。runner 保持3762行且本批零修改。

## 2026-07-15：Liella! SP-sd1 第二批登场卡效（未提交）

- `PL!SP-sd1-001-SD` 费用 11「澁谷かのん」新增独立 ON_ENTER ability identity；扩展 `member-on-enter-draw.ts` 的有限 `energyPerDraw=6` 动态抽牌轴。结算时按当前能量区卡牌张数整除6请求抽牌，ACTIVE、WAITING 与特殊 marker 均按一张计数；0张仍消费 pending，正数抽牌复用 `drawCardsForPlayer` 的刷新与实际数量语义。触发后来源离场不取消已发生的登场效果。
- `PL!SP-sd1-004-SD` 费用 11「平安名すみれ」新增独立 ON_ENTER ability identity；作为第二个真实样本，将 `PL!-bp4-007` 旧单卡 workflow 晋升为 `workflows/shared/on-enter-gain-live-total-score.ts`。shared 只保留 abilityId、expectedBaseCardCodes、countDelta、`SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE / ALWAYS` 与 action/no-op step 有限轴；004 不读取成功 LIVE，但在结算时重验来源仍是控制者自己主舞台的正确成员实例。
- 004/007 都复用 `addPlayerScoreLiveModifierForTargetMember`；playerId 为来源控制者，source/target 均绑定来源成员实例。不直接预写 `playerScores`；不同实例可叠加，同来源/同 ability 重复结算幂等，站位移动保留，标准离场只清理该实例，LIVE 结束由统一 modifier 生命周期清理。007 既有“成功 LIVE 至少1张且当前有效分数<=1”条件及授予后不动态撤销语义保持不变。
- focused 回归已覆盖真实 PLAY_MEMBER 入队、001 能量边界/牌库不足/来源离场/ordered continuation，以及004 来源校验、modifier 叠加/幂等/移动/离场/真实 LIVE 计分/LIVE 结束清理与007旧条件回归。runner 只将旧单卡 import/register 等价替换为 shared 命名，3762 行且 0 行净增。
- 第一批 005/011、通用 stale 能量选择修正与 `llocg_db` 本地状态保持未动；本窗口未 stage、未 commit、未 push。

## 2026-07-15：Liella! SP-sd1 第一批起动卡效（未提交）

- `PL!SP-sd1-005-SD` 费用 9「葉月 恋」新增独立起动 ability identity；扩展 `pay-energy-waiting-room-to-hand.ts`，自己主要阶段每回合1次支付 `[E][E][E]` 后强制选择自己休息室1张任意 LIVE。普通能量按稳定顺序自动支付，存在特殊能量且候选超额时精确选择3张；`PAY_COST` 保留实际能量卡 ID。
- 005 的休息室选择复用 shared public-card-selection confirmation：首次提交只向双方公开相同卡牌和权威 deadline，不移动、不额外奖励；到期后由原 workflow 重验并回手。stale 目标不替换，费用与本次使用不回退；选择与支付窗口使用治理要求的精确玩家文案。
- `PL!SP-sd1-011-P / SD / SD2` 费用 7「鬼塚冬毬」通过基础编号共用独立起动 definition；扩展 `stage-member-waiting-energy-placement.ts` 的窄 handler，自己主要阶段每回合1次支付 `[E][E]` 后调用标准卡效能量放置 helper 放置1张 WAITING 能量。来源无需待机；标准 `ON_ENERGY_PLACED_BY_CARD_EFFECT` 事件携带完整 cause。能量卡组为空时费用与 turn1 保留，放置0张并安全结束。
- 两张卡均使用 `ACTIVATED / STAGE_MEMBER / queued: false / perTurnLimit: 1 / baseCardCodes`；runner 保持既有 shared 注册，3762 行且零 diff。`PL!SP-sd1-023 / 025` 经 Excel 复核效果栏为空，继续永久排除；未处理其他 SP-sd1 候选。
- focused 验证：`pay-energy-waiting-room-to-hand.test.ts`、`stage-member-waiting-energy-placement.test.ts`、`card-effect-classification.test.ts` 共3文件185项通过；token/text governance 共2文件15项通过；服务端 `tsc --noEmit` 与客户端 `tsc -b client` 通过；inventory 显示005与011全部印刷已实现，玩家文案审计3492条通过。

## 2026-07-15：Liella! SP-bp1 候选卡最终独立批次（未提交）

- `PL!SP-bp1-003-P / P＋ / R＋ / SEC` 费用 10「嵐 千砂都」完成每回合1次起动能力；日文规则与 FAQ 核对 `llocg_db/json/cards.json`，玩家中文采用 Excel `sheet1!A121:X124` 多行中文效果，并只把“分数”替换为 `[スコア]` token。
- 新增窄单卡 workflow `workflows/cards/sp-bp1-003-chisato.ts`：只允许当前玩家自己的主阶段从己方 LEFT/CENTER/RIGHT 顶层来源发动，ACTIVE / WAITING 均可；候选只含自己当前手牌 MEMBER，提交前只对等待玩家可见，支持 0 至全部 `ORDERED_MULTI`，但结算不使用选择顺序。合法提交先公开所选手牌且不移动，进入同一 activeEffect 的公开结果确认；0 张是合法公开、合计 0、不获得 SCORE，但仍记录本回合使用。
- Q129 费用口径由新只读边界 `effects/play-member-cost.ts` 统一：`GameSession.preparePlayMemberCostPayment` 与本 workflow 共享同一 stage/success LIVE/完整手牌快照资源构造，并逐张调用 `costCalculator.calculateModifiedPlayCost`。公开提交时保存每张 `effectiveCost`、合计与条件事实，最终确认不重算。
- 合计恰为 10 / 20 / 30 / 40 / 50 时，通过 `addPlayerScoreLiveModifierForTargetMember` 给 003 来源实例写玩家总 SCORE +1；不写 `liveCardId`，不直接改主阶段 `playerScores`。Q78 继续由标准 ON_LEAVE_STAGE 的 target-member-bound 清理处理，槽位移动保留、来源离场或成为 memberBelow 后移除；Q171 继续由 LIVE 结果结算统一清空 `liveModifiers`，没有进行 LIVE 也相同。
- 本批新增 1 个生产卡牌维度 `.ts`；runner 只增加 003 workflow 的一个 import 与一个 register 调用。`PL!SP-bp1-025` 仍只是 ALL BLADE 规则提醒，不登记 ability；前五批与历史“当时未实现”记录保持原样。

## 2026-07-15：Liella! SP-bp1 新卡卡效第五批（已提交：`d5d50ee`；不能 LIVE 时序修正：`80c2b77`）

- `PL!SP-bp1-001-P / R` 费用 9「澁谷かのん」完成非 queued `CONTINUOUS` ability；玩家文本逐字采用 Excel `sheet1!A115:X116` 的「【常时】自己的舞台上不存在其他的成员的场合，自己无法进行LIVE。」。
- `src/domain/rules/live-prohibitions.ts` 新增窄的动态 continuous 查询：只在合法 001 来源是控制者 LEFT/CENTER/RIGHT 主舞台顶层 MEMBER，且己方没有来源以外的其他合法顶层成员时禁止 LIVE。对方成员与 memberBelow 不计入；两张 001 同时在场会互相视为其他成员，因此不禁止。
- 该限制不写入 `game.liveProhibitions`，不调用 `addLiveProhibitionUntilLiveEnd`；来源离场、成为 memberBelow、失去正确 owner/type，或己方出现其他顶层成员时即时失效，其他成员离场后即时恢复。`isPlayerLiveProhibited` 统一合并临时状态与实时 continuous 查询，Live Set 仍可盖牌并正常抽牌，随后复用既有 phase-ten 检查点把 LIVE 区全部卡移入休息室。
- `PL!HS-bp2-014-N` 费用 4「大沢瑠璃乃」继续使用写入状态、直到 LIVE 结束清理的临时禁止；清理临时状态不影响当前场面仍满足的 001，001 场面变化也不清理临时状态。
- 本批没有新增生产卡牌维度 `.ts`，没有 workflow、pending、activeEffect 或 runner 接线。`PL!SP-bp1-003` 仍未实现并留到最后一个独立执行窗口；`PL!SP-bp1-025` 仍只视为规则提醒，不登记 ability。历史批次中的「当时未实现 001」记录保持原样。

## 2026-07-15：Liella! SP-bp1 新卡卡效第四批（未提交）

- `PL!SP-bp1-002-P / P＋ / R＋ / SEC` 费用 4「唐 可可」完成 queued ON_ENTER；左侧条件只读本次登场事件的 `sourceSlot=LEFT` 快照，后续移动或离场不改判。窄单卡 workflow 复用 `payImmediateEffectCosts` 固定支付两张 ACTIVE 能量，再用 `drawCardsForPlayer` 抽 2；非 LEFT、能量不足或拒绝不产生部分修改。
- `PL!SP-bp1-010-P / R` 费用 11「ウィーン・マルガレーテ」完成每回合1次起动能力。窄单卡 workflow 预验证两张 ACTIVE 能量与恰好1张手牌，复用标准费用/弃手 trigger wrapper；两项费用全部成功后才记录每回合次数。后续委托 `look-top-select-to-hand` core 完成顶5检视、可选0至1张结构化『Liella!』MEMBER/LIVE 公开入手、余牌 grouped 事件与 refresh；未选 inspection 内容保持私密，弃手产生的 pending 在当前能力完整结束后再统一调度。
- `PL!SP-sd1-026-SD / SRL` 分数 4「私のSymphony 〜澁谷かのんVer.〜」复用 `live-start-score-bonuses.ts`，只增加 `minEnergyCount=9 / scoreBonus=1` 配置。能量区按 `cardIds.length` 统计 ACTIVE、WAITING 与特殊能量；modifier 按来源 LIVE 实例与 abilityId replacement，重入不累加、不覆盖其他来源，并与 `PL!SP-bp1-027` 的 12 能量阈值隔离。卡面括号抽牌提醒未登记为额外 ability。
- runner 第四批只新增 002 / 010 两个 workflow 的 import/register 接线，分类为薄边界类别1；没有卡牌 gate、复合费用、pending 构造或 effect body 回流。本批新增 2 个生产卡牌维度 `.ts` workflow。
- 仍未实现 `PL!SP-bp1-001 / 003`；`PL!SP-bp1-025` 的 ALL BLADE 括号文本继续视为规则提醒，不登记 ability。历史批次中的「当时未实现」记录保持不回写。

## 2026-07-15：Liella! SP-bp1 新卡卡效第三批（未提交）

- `PL!SP-bp1-012-N` 费用 4「澁谷かのん」、`PL!SP-sd1-008-SD` 费用 4「若菜四季」、`PL!SP-sd1-017-SD` 费用 4「桜小路きな子」完成同文 ON_ENTER family：可选支付 `[E]` 后检视卡组顶 3 张，实际有卡时强制私密选择 1 张加入手牌，其余成组进入休息室。
- 三张 Excel 多行中文效果规范化后完全一致，共用一个 ability identity；Excel 的 012 日文 `[E][E]` 与 `cards.json` 及另两张 `[E]` 不一致，规则实现以 `cards.json` 的固定 `[E]` 为准。支付复用 `payImmediateEffectCosts`，检视/refresh/余牌事件/continuation 复用 `look-top-select-to-hand` 核心。
- `PL!SP-bp1-023-L / SRL` 分数 1「START!! True dreams」完成 LIVE_SUCCESS：实时分数严格高于对方时放置 1 张待机能量；括号 SCORE 规则提醒未登记为额外 ability。
- 原 `PL!HS-bp1-023-L` 分数 2「ド！ド！ド！」单卡 workflow 晋升为 `higher-score-place-waiting-energy` shared ownership；保留旧 abilityId/action 行为，HS 继续要求己方主舞台顶层结构化莲之空成员，SP 不带团体条件。
- runner 本批只把旧 HS 单卡 import/register 替换为 shared 注册，并增加 012 shared family 的 import/register；没有卡牌 gate、费用、pending 或 effect body 回流。
- 已新增 focused tests：`tests/integration/optional-pay-energy-look-top-select-to-hand.test.ts`、`tests/integration/higher-score-place-waiting-energy.test.ts`；同步 `tests/unit/card-effect-classification.test.ts`。最终相关回归共 12 files / 266 tests passed，Type Errors 0；server/client TypeScript、玩家文案 3452 条审计、局部 Prettier、`git diff --check` 与暂存区检查均通过。
- 明确未处理：`PL!SP-bp1-001 / 002 / 003 / 010 / 025`、`PL!SP-sd1-026`，以及既有第一/第二批和其他脏树。

## 本次 2026-07-15 `PL!SP-bp1-007 / 008 / 009` 第二批卡效

- 完成费用 13「米女メイ」P/P＋/R＋/SEC、费用 13「若菜四季」P/R、费用 9「鬼塚夏美」P/R；日文规则核对 `llocg_db/json/cards.json`，玩家中文逐字采用 `loveca_20260626015115.xlsx` 的多行中文效果。
- 007 扩展 shared `waiting-room-to-hand.ts`：pending 结算时读取控制者全部能量区卡牌数，至少 11 张才强制选择恰好 1 张 LIVE；条件不足或无合法目标安全 no-op。真实选卡沿用 public-card-selection confirmation，第一次提交只公开；初次 selector 显式校验 owner，权威 deadline 后恢复时重新运行当前 `candidateBuilder` 并与原候选取交集，从而重验 owner、区域和 LIVE 类型，失效目标 no-op 后统一 continuation。
- 008 扩展 shared `member-on-enter-draw.ts` 的有限“指定舞台成员姓名 + 追加抽牌数”配置轴：固定先抽 1，结算时自己的 LEFT/CENTER/RIGHT 顶层成员具有「米女メイ」身份时再抽 1；复用 `cardNameAliasIs`，支持日中别名、空白与多名称身份，不统计对方、memberBelow 或其他区域。
- 009 新增本批唯一卡牌维度薄 wrapper `workflows/cards/sp-bp1-009-natsumi.ts`：自己的主阶段支付 1 张 ACTIVE 能量并记录标准 `PAY_COST`，随后委托 `draw-then-discard` core 抽 1 弃 1；弃手走标准 HAND -> WAITING_ROOM 事件 wrapper，新 pending 在当前能力完整结算后由统一检查时点调度。回合次数只在支付成功后记录。
- 本批没有引入任意 predicate、任意费用或通用 steps DSL；`PL!SP-bp1-001 / 002 / 003 / 010 / 012 / 023 / 025` 与 `PL!SP-sd1-026` 仍未登记、未实现。runner 只为 009 增加一个 import 与一个 register 调用。

## 本次 2026-07-15 `PL!SP-bp1-004 / 026 / 027` 第一批卡效

- 完成费用 15「平安名すみれ」P/PR/R、分数 3「未来予報ハレルヤ！」L/SECL/SRL、分数 6「Sing！Shine！Smile！」L/SRL；日文规则核对 `llocg_db/json/cards.json`，玩家中文采用 `loveca_20260626015115.xlsx` 多行中文效果。`PL!SP-bp1-025` 与阈值9同型 `PL!SP-sd1-026` 均未登记、未实现。
- 004 复用 `live-modifiers.ts` 固定槽位 BLADE continuous 配置，CENTER 顶层来源动态获得 SOURCE_MEMBER BLADE +5；026 将 HS-pb1-026 的硬编码跨区不同名判断收窄为团体、阈值、减少量等有限配置轴，结构化匹配 Liella! 并写来源 LIVE `REQUIREMENT RAINBOW -2`；027 只为 `live-start-score-bonuses.ts` 增加 `minEnergyCount=12` 配置，来源绑定 SCORE +1 使用 replacement 差值刷新，重入不累计。
- focused classification / continuous / conditional modifier / score bonus 4 文件 441 tests 与 token/text governance 15 tests 通过；玩家文案审计检查 3433 条候选文本通过，服务端 `tsc --noEmit`、客户端 `tsc -b client`、`git diff --check` 通过。runner 3752 行、零 diff；未 stage、未 commit、未 push，既有 `llocg_db` 脏状态保持未动。

## 本次 2026-07-15 `PL!-bp4-020-L` Love wing bell（PL!-bp4 候选收尾）

- 完成分数 3「Love wing bell」两段独立能力；日文核对 `llocg_db/json/cards.json`，中日文、团体、类型、分数、必要 Heart 与 token 核对 `loveca_20260626015115.xlsx` `sheet1!A1526:X1526`，两条 definition 分别逐字使用对应中文段落，`[ブレード]` 复用现有 BLADE token。
- LIVE_START 新增窄单卡 `workflows/cards/pl-bp4-020-love-wing-bell.ts`；只读己方 LEFT/CENTER/RIGHT 顶层成员，用结构化 `groupAliasIs("μ's")` 判定全员团体。第一步可选成员或「不发动」，第二步强制选择其他两槽；移动/交换复用 `moveMemberBetweenSlotsAndEnqueueTriggers`，保留真实 `MEMBER_SLOT_MOVED` 事件与统一 continuation。开窗、选成员、确认槽位均实时重验；illegal input 刷新强制窗，stale 清窗 no-op，目标槽变化时以权威槽位刷新。未扩展 `stage-formation-change.ts` 或建立站位变换 DSL。
- CONTINUOUS 只扩成功区 continuous registry；每张合法 020 实例每次收集时独立为己方 CENTER 顶层结构化 μ's 成员产生 BLADE +1，modifier `sourceCardId` 使用获得 BLADE 的中央成员实例。多张020可叠加，来源离成功区、中央成员移动/离场/非 μ's 时即时减少、转移或消失；不改印刷 BLADE，不写 `liveResolution.liveModifiers`。
- focused integration 22 tests 与 `live-modifiers` full 230 tests 覆盖 definition/真实触发/团体判定/两步交互/移动交换事件/manual bridge/ordered continuation/stale/动态 BLADE/叠加；classification、rarity、token/text governance 同步通过。runner 本窗只inport/register 两行，3750 → 3752。PL!-bp4 候选卡效至此全部完成。

## 本次 2026-07-15 `PL!-bp4-007-P / R` 登场授予来源成员 LIVE 合计分数

- 实现费用 11「東條 希」两种罕贵度的同基础编号 ON_ENTER 卡效；日文规则逐卡核对 `llocg_db/json/cards.json`，玩家中文逐字采用 `loveca_20260626015115.xlsx` `sheet1` 第1510行（R）与第1511行（P），两行名称、费用、团体、小队、token 和卡文一致。
- 当时以窄单卡形状落地；当前已在 `PL!SP-sd1-004` 成为第二个真实样本后迁入 `workflows/shared/on-enter-gain-live-total-score.ts`。007 仍在结算时分别调用 `countSuccessfulLiveCards` 与 `sumSuccessfulLiveScore`，成功区至少1张且当前有效分数合计 <=1 才授予，空成功区即使合计0也不满足。`PL!-bp4-019-L` 在007这个 μ's 舞台成员存在时按有效9分读取并使条件失败。
- 满足时复用 `addPlayerScoreLiveModifierForTargetMember`，写 `SCORE / playerId / countDelta:1`，source/target 均绑定007来源实例。授予后成功区变化不动态撤销；站位移动保留，来源离场由标准 target-bound 清理，LIVE结束走统一 modifier 生命周期。不修改 continuous registry 或直接写 `playerScores`。
- focused 覆盖真实 PLAY_MEMBER -> ON_ENTER_STAGE、0/1/2分与多卡边界、019有效分数、ACTIVE/WAITING、来源 stale/owner/type/base/memberBelow/区域过滤、精确 modifier、移动/离场/条件冻结、双实例叠加、continuation、P/R definition 与真实 LIVE 计分消费者。当时 runner 仅新增一个 import/register；当前路径和注册已随 shared ownership 等价重命名。

## 本次 2026-07-14 `PL!-bp4-006-P / R` 成功分数门槛检视

- 实现费用 4「西木野真姫」两种罕贵度的同基础编号 ON_ENTER 卡效；日文规则逐卡核对 `llocg_db/json/cards.json`，玩家中文逐字采用 `loveca_20260626015115.xlsx` `sheet1` 第1508行（R）与第1509行（P），两行完全一致。
- 扩展 `workflows/shared/look-top-select-to-hand.ts` 的有限 `minSuccessfulLiveScore=3` 配置轴；门槛在任何检视前调用 `sumSuccessfulLiveScore`，不足时消费当前 pending、记录条件未满足且不建立 inspection/activeEffect，达标后才进入原有 top5 私密检视流程。
- selector 复用 `typeIs(CardType.MEMBER) + groupAliasIs("μ's")`，仅允许结构化 μ's 成员且兼容直/弯引号别名；选择0张时全部 inspected cards 入休息室，选择1张时先双方公开、确认后入手，其余统一走 inspection-to-waiting 事件 wrapper并保留新 pending。来源在触发后离场不取消已触发效果。
- focused 覆盖真实 ON_ENTER、门槛2/3、P/R definition、别名与类型过滤、0/1选择、公开与隐私、非法/stale、短/空牌库、来源离场、waiting-room 事件与动态 pending；runner 本批零增量。

## 本次 2026-07-14 `PL!-bp4-013-N` 固定桃 Heart 目标成员

- 实现费用 4「園田海未」queued LIVE_START 卡效；日文规则核对 `llocg_db/json/cards.json`，玩家中文逐字采用 `loveca_20260626015115.xlsx` 精确卡号行 `sheet1!A1519:X1519` 的多行中文效果，并确认 `[桃ハート]` token 已映射。
- 扩展 `workflows/shared/live-start-discard-gain-heart.ts` 的有限 Heart 选择轴与 recipient `groupAlias` 可选轴：013 固定桃 Heart，弃手后直接进入任意其他己方主舞台成员选择，不打开单选项颜色窗口；既有 Kotori、HS-bp1-006 与虹咲样本保持原交互。
- 弃手继续走 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`；目标只取 LEFT/CENTER/RIGHT 顶层 ACTIVE/WAITING 成员，确认时实时重扫，成功后写来源/目标分离的 `TARGET_MEMBER` 桃 Heart +1。来源/目标 stale 与支付后无目标均不回滚费用，目标离场复用通用 target-bound modifier 清理。
- focused 覆盖真实 ON_LIVE_START、发动/不发动/无手牌、弃手事件与动态 pending、固定桃目标窗口、跨团体与目标过滤、非法/stale、费用不回滚、精确 modifier、continuation 和离场清理；无 runner 修改。

## 本次 2026-07-14 `PL!-bp4-019-L` 成功区有效分数

- 实现分数 4「Angelic Angel」常时效果：来源实例仍在拥有者成功 LIVE 区且己方主舞台存在结构化 μ's 成员时，该卡当前有效分数 +5；ACTIVE / WAITING 均满足，排除 memberBelow 与对方舞台，多张019分别叠加。
- 将 `sumSuccessfulLiveScore` 统一升级为成功区合法 LIVE 单卡有效分数求和；019 的窄收集只读取成功区、卡牌身份与主舞台事实，不调用 `collectLiveModifiers`，既有门槛/比较消费者自动继承有效分数语义。
- 新增 `tests/unit/success-live-score.test.ts` 领域矩阵并补 classification；无 workflow、activeEffect、pending、持久 modifier 或 runner 修改。
- 验证：成功区 query / conditions / live-modifiers / 登场抽牌共 280 tests、classification 101 tests、token/text governance 13 tests、PR-017 / S-bp3-008 shared family 回归 232 tests 通过；服务端 `tsc --noEmit` 与客户端 `tsc -b client` 通过。

## 本次 2026-07-14 换牌规则顺序与实例完整性修复

- 按细则 6.2.1.6 将换牌顺序修正为“暂放手牌→从原主卡组顶抽取同数量→暂放牌放回主卡组→洗牌”，避免玩家立即抽回刚换掉的同一卡牌实例；不修改 Fisher–Yates 洗牌实现。
- 补上重复换牌实例 ID 的原子拒绝，并移除换牌阶段的双方时机豁免，让底层 `GameService` 与联机命令层一致按先攻/后攻子阶段校验。
- 新增 `tests/unit/mulligan.test.ts`，覆盖换1/3/6张、0张、重复/非手牌 ID、越序与双方阶段推进；换牌、子阶段、整体流程、单人模式与联机命令共 129 tests 通过，`tsc --noEmit` 通过。

## 本次 2026-07-14 第三批 PL!-bp4 条件抽1

- 实现 `PL!-bp4-001-P / R` 费用 9「高坂穂乃果」与 `PL!-bp4-023-L` 分数 3「もぎゅっと\"love\"で接近中！」；两项玩家中文分别逐字采用 Excel `sheet1!B1494:B1495` 与 `sheet1!B1529`。
- 将既有 shared family 晋升并重命名为 `conditional-live-draw-one.ts`，以显式联合类型承载 LIVE_START/LIVE_SUCCESS、STAGE_MEMBER/LIVE_CARD、有效舞台费用比较与指定颜色剩余 HEART 条件；保留费用 4「桜坂しずく」与费用 7「渡辺 曜」既有 action/payload、实时条件与 pending 行为。
- 001 复用有效费用 query，严格比较双方三个主舞台槽并排除 memberBelow；023 复用 remaining-hearts 的粉色指定颜色 rebalance，预览不改状态，正式结算且来源有效时才应用合法还原。两者统一复用 `drawCardsForPlayer`，单 pending confirm-only、ordered batch 自动处理与多 pending 手动点选均由 shared family 承载。
- 验证：指定 shared/既有回归/remaining-hearts/classification/rarity/token/text 共 8 个文件 183 tests 通过；服务端 `tsc --noEmit`、客户端 `tsc -b client`、批次 inventory、玩家文案审计、旧路径 `rg` 与 staged/unstaged diff check 均通过。runner 本批仅替换 shared import/register 两行，行数保持 3748；未 stage、未 commit、未 push。

## 本次 2026-07-14 第二批 PL!-bp4 自待机 BLADE / 中央 BLADE 分数

- 实现 `PL!-bp4-011-N` 费用 4「絢瀬絵里」：将 `PL!-bp4-017-N` 费用 2「小泉花陽」旧单卡 workflow 晋升为 shared `live-start-wait-self-center-muse-gain-blade.ts`；稳定轴仅 abilityId、bladeAmount 与兼容 action step，两张卡分别获得两个/一个 BLADE。
- 两张成员卡都使用“发动 / 不发动”且不生成固定来源的单卡选择；打开与确认时重查 ACTIVE 舞台来源，支付走标准成员状态事件 wrapper，支付后重读中央结构化 μ's 目标。来源自身在中央并变 WAITING 后仍可获益；中央无合法目标时费用保留并继续 pending。
- 实现 `PL!-bp4-022-L / SECL` 分数 7「No brand girls」：扩展 `conditional-live-modifier.ts`，以中央 μ's 成员实时有效 BLADE >=9 为条件写来源 LIVE SCORE +2。有效值包含印刷、临时 modifier 与 replacement；SCORE 使用 replacement 与差值刷新 `playerScores`，重入不重复、条件失效清理旧状态。
- confirm-only 动态文案显示中央是否为 μ's、有效 BLADE、满足/未满足与实际 `[スコア]+2/+0`；规则日文采用 `cards.json`，玩家中文分别核对 Excel `sheet1!B1517 / B1528 / B1839`。
- 验证：指定 7 个 vitest 文件共 382 tests 通过；服务端 `tsc --noEmit`、客户端 `tsc -b client`、批次 inventory、玩家文案审计与 staged/unstaged diff check 均通过。runner 本批只替换旧 workflow import/register 名称，0 行净增，总行数 3748；本窗口未 stage、未 commit、未 push。

## 本次 2026-07-14 第一批 PL!-bp4 成功 LIVE 分数条件登场效果

- 完成 `PL!-bp4-004-P / PL!-bp4-004-R` 费用 2「園田海未」与 `PL!-bp4-016-N` 费用 4「東條 希」：均按基础编号登记独立 ON_ENTER / PLAYED_MEMBER / ON_ENTER_STAGE / queued definition，effectText 逐字采用最新 Excel `loveca_20260626015115.xlsx` 的多行中文效果。
- `PL!-bp4-016` 仅扩展 `member-on-enter-draw.ts` 的既有 `minSuccessLiveScore=3` 配置；`PL!-bp4-004` 将 `on-enter-activate-waiting-energy.ts` 整理为窄配置数组并新增 `minSuccessLiveScore=6 / activationCount=2`，继续复用成功 LIVE 分数 query、抽牌 runtime 与通用特殊能量精确选择。
- 验证：指定 7 个 vitest 文件共 170 tests 通过；`tsc --noEmit` 通过；runner 本批 0 行、0 diff。
- 本窗口改动保持未 stage、未 commit、未 push；进入窗口前的既有 dirty WIP 与 `llocg_db` 均未清理、回退或纳入。

## 本次 2026-07-14 第五批 -PR- 选择玩家休息室 LIVE 置底抽1

- 实现 `PL!S-PR-041-PR` 费用 15「黒澤ルビィ」：新增独立 ON_ENTER / PLAYED_MEMBER / ON_ENTER_STAGE / queued definition，effectText 逐字采用 Excel `sheet1!A1818:X1818` 中文，无费用、无每回合次数限制。
- 将 `PL!S-bp3-007` 旧单卡 workflow 晋升为行为命名 `choose-player-bottom-waiting-live-draw-one.ts`，只共享“选择玩家→强制选择1张 LIVE→公开截止时间确认→恢复重验→放置于所选玩家卡组底→效果控制者抽1”的稳定核心。007 保留主要阶段、主动玩家、来源舞台、`[E]`/特殊能量、turn1、activatedUi、action/payload 与 persisted step ID；041 从生产 ON_ENTER pending 进入，保留 orderedResolution 与统一 continuation。
- 公开确认继续复用既有服务端 deadline runtime；首次提交不移动、不抽牌、不推进 pending，双方看到同一选择与截止时间。恢复时重验 owner、休息室、LIVE 与原候选，stale 时只消费041 pending 并继续。`PL!N-bp3-010` 与 `PL!S-bp2-008` 因数量、目标范围和奖励不同，不并入本 shared family。

## 本次 2026-07-14 第四批 -PR- 换手登场抽1

- 实现 `PL!N-PR-025-PR` 费用 15「優木せつ菜」：独立 AUTO / STAGE_MEMBER / ON_ENTER_STAGE / queued / turn2 definition 精确采用 Excel `sheet1` 第 1940 行中文。
- 通用 `OnEnterStageTriggerFilter` 增加 `enteredViaRelay` 轴；ON_ENTER_STAGE AUTO source 传递 `enteredFromZone` 与从 `relayReplacements` / legacy `replacedMemberCardId` 得出的换手事实，并通用应用 definition `triggerFromZones`。本卡只匹配从 HAND 走真实规则换手的己方成员，不把卡效替换或普通空槽登场当成换手。
- 新增窄单卡 `n-pr-025-setsuna.ts`：pending 默认预占每回合两次上限，每来源实例独立记录；结算抽1后回到统一 continuation。单 pending 和 ordered batch 自动结算，仅手动点选多 pending 时显示精确 confirm-only 文案。

## 本次 2026-07-13 第三批 -PR- 弃2后抽至5

- 实现 `PL!N-PR-028-PR` 费用 11「宮下 愛」：与 `PL!HS-PR-031-PR` 费用 11「日野下花帆」在 `cards.json` 及 Excel 的中日文完全一致，因此不新增 abilityId，扩展既有 `HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID` 的基础编号覆盖。
- 两张卡继续共用 `discard-then-draw.ts` 的 exactly 2、可选“不发动”、私密有序手牌选择与 `UNTIL_HAND_SIZE(5)` 配置；抽牌数在成功弃置2张后按当前手牌计算，手牌已达到或超过5张时不抽。
- 未新增 workflow/helper/DSL，也未修改 runner；focused classification/integration 覆盖真实登场入队、精确文案、边界抽牌、原子失败、来源离场、批量 HAND -> WAITING_ROOM 事件与双 pending continuation。

## 本次 2026-07-13 第二批 -PR- ON_CHEER 同团成员 Heart

- 实现 `PL!N-PR-023-PR` 费用 9「上原歩夢」与 `PL!S-PR-040-PR` 费用 9「国木田花丸」：因 Excel 精确中文不同保留两个独立 ability identity/definition，执行共用 `on-cheer-same-group-member-triple-gain-hearts.ts`。
- shared workflow 只读取 pending 关联的自己普通 `CheerEvent.revealedCardIds` 历史事实；对不同 card ID 去重后，通过结构化 canonical group key 构造成员集合，要求某一具体团体桶至少 3 张。成功为来源写一个 `SOURCE_MEMBER` 桃＋绿 Heart modifier；条件失败仍消费 turn1，additional、对方事件与 stale 来源不记录使用。
- runner 仅新增 import/register 胶水；focused integration/classification 覆盖真实声援入队、WAITING 来源、多团体/三角反例、重复、非成员/对手、历史事件、移出处理区、pending turn1 占用、来源离场/memberBelow、双来源 continuation 与独立 identity。

## 本次 2026-07-13 Aqours S-PR-029 / 030 / 031 同文常时 BLADE

- 实现 `PL!S-PR-029-PR` 费用 9「渡辺 曜」、`PL!S-PR-030-PR` 费用 9「津島善子」与 `PL!S-PR-031-PR` 费用 9「国木田花丸」：三张共用 `S_PR_030_031_CONTINUOUS_ANY_STAGE_COST_THIRTEEN_GAIN_TWO_BLADE_ABILITY_ID` 与一条 `CONTINUOUS / STAGE_MEMBER / queued: false` definition，effectText 使用用户指定的精确中文。
- 扩展 `domain/rules/live-modifiers.ts` continuous registry：来源仍在己方三个主舞台槽时，动态扫描双方三个主舞台槽并按各自 playerId 调用 `getMemberEffectiveCost`；任一有效费用 >=13 即为该来源固定收集 BLADE +2。来源自身与 WAITING 舞台成员可满足；memberBelow、手牌、休息室和其他非舞台区域不计入；多名合法成员不按数量叠加，条件失效后重新收集即消失。
- 按用户已确认的 cards.json【常时】权威结论，将 `PL!S-PR-029-PR` 加入同一 definition 与 modifier 配置，保留原 runtime ability ID；不采用 stale Excel/cards_cn【登场】。Focused classification 与 live-modifier 测试覆盖 029/030/031 独立、有效费用升降、双方/来源自身/WAITING、区域排除、实时失效及 029 印刷 BLADE 3 到有效 BLADE 5。

## 本次 2026-07-13 PL!-PR-015 换手登场低费成员

- 实现 `PL!-PR-015-PR` 费用 17「西木野真姫」：新增独立 `PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID` 与 `PLAYED_MEMBER / ON_ENTER_STAGE / queued` definition，effectText 逐字采用 `loveca_20260626015115.xlsx` `sheet1!A1414:B1414` 中文，不补入中文原文没有的“可以”。
- 将 `PL!SP-PR-020` 旧单卡 workflow 晋升为 `workflows/shared/low-cost-relay-play-hand-member.ts`。换手来源费用使用生产 relay action 捕获的有效费用快照，来源成员使用结算时有效费用；手牌费用<=4继续按印刷费用 selector，独立的手牌登场 play-cost 减费不改变目标资格。
- 两步玩家文案固定为“选择要登场的成员 / 登场 / 不登场”和“选择登场区域 / 登场”；stale 手牌目标或区域会刷新当前候选，候选耗尽时安全结束。效果登场继续走 `playMemberFromZoneToEmptySlot`，父能力 resolve action 后再入队新成员 ON_ENTER 并回到统一 continuation。
- runner 仅把原 `sp-pr-020-kinako` import/register 等价替换为 shared import/register，没有卡号门禁、目标查询、pending 构造或 effect body。Focused 覆盖真实换手命令低/等/高费用、普通登场、印刷费用3/4/5、可选跳过、无目标/无区域、stale/伪造/重复输入、来源离场与子 ON_ENTER 顺序。

## 本次 2026-07-13 PL!-PR-005 / 006 / 008 同文登场二选一

- 实现 `PL!-PR-005-PR` 费用 9「星空 凛」、`PL!-PR-006-PR` 费用 9「西木野真姫」、`PL!-PR-008-PR` 费用 9「小泉花陽」；三张共用一个 ON_ENTER abilityId、完整基础编号集合与 Excel 中文原文。
- 新增 shared `on-enter-choose-draw-discard-or-wait-opponent-low-cost.ts`：首步始终显示强制二选一；抽弃分支委托 `draw-then-discard` core，使用私密手牌选择和标准 HAND -> WAITING_ROOM 事件；批量待机分支只扫描对方三个主舞台槽，以印刷费用 <=2 过滤，通过 `setMembersOrientation` 与标准事件 wrapper 在本能力 resolve action 后入队真实状态变化。
- 未扩 `opponent-wait-target.ts`（其为单目标选择 family），未扩 `hs-pb1-008-izumi.ts`；runner 仅新增一个 shared import 与一次 register 调用。Focused integration 通过真实登场覆盖三张卡、非法 option、来源离场、两分支 continuation、memberBelow/已 WAITING/无目标及状态触发时序。

## 本次 2026-07-13 PL!-PR-001 / 002 同文离场活跃成员

- 实现费用4「高坂穂乃果」/「绚濑绘里」同文离场 AUTO：仅从舞台进入休息室时，可选双方主舞台 WAITING 成员变为 ACTIVE。
- 新增 shared workflow、稳定 abilityId、definition 与 focused 覆盖；runner 仅 import/register 胶水。

## 本次 2026-07-13 Aqours S-PR-028 / 032 / 033 同文登场控顶

- 实现 `PL!S-PR-028-PR` 费用 4「黒澤ダイヤ」、`PL!S-PR-032-PR` 费用 4「小原鞠莉」、`PL!S-PR-033-PR` 费用 4「黒澤ルビィ」：使用独立 `S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID` / definition 保留 Excel“卡牌”原文，并恢复霞 definition 的“卡片”原文与单基础编号边界。
- 三张执行仍复用 `workflows/shared/arrange-inspected-deck-top.ts` 的 top3 / 0..3 ordered 配置，余牌保持 inspection-to-waiting 单组事件与统一 pending continuation；focused integration 通过真实登场命令与 ON_ENTER_STAGE definition lookup 入队。未扩霞的休息室来源起动能力，未新增 workflow/helper，runner 不变。
- focused classification/integration、霞回归、rarity、token/text governance、服务端/客户端类型检查与 diff check 的实际结果见本窗口收尾；下一步仅在用户确认后进入提交窗口。

## 本次 2026-07-12 Aqours bp3-001 / 002 收束卡效

- 实现 `PL!S-bp3-001-P / P＋ / R＋ / SEC` 费用15「高海千歌」：单卡 activated workflow 只允许中央来源选择自己舞台 ACTIVE 成员作为待机费用；成功后才记录 turn1 use，并为实际目标成员实例写入 `SCORE +1`。
- 新增目标成员绑定的临时玩家 SCORE 形状：`targetMemberCardId` 与 `sourceCardId` 分离。来源离场不删除；目标离场经通用 `LeaveStageEvent` hook 删除全部绑定 modifier 并重建兼容投影；LIVE_END 仍由统一 resolution 清理。
- 实现 `PL!S-bp3-002-P / R` 费用11「樱内梨子」：新增精确 `REVEALED_CHEER_CARD` LIVE_SUCCESS 来源区，只从控制者当前声援、仍在 resolutionZone 且仍公开的卡收集。领先时显示“加入手牌 / 不加入”真实交互，固定移动来源自身，不进入 public-card-selection confirmation。
- runner 仅增加两个 workflow 注册及两个通用 hook：目标成员绑定 modifier 的 LeaveStage 清理、当前公开声援 LIVE_SUCCESS 来源收集；未接 trigger matcher T-2 或 steps-lite。

## 本次 2026-07-12 Aqours bp3-005 / N-bp4-003 shared LIVE成功抽牌

- 实现 `PL!S-bp3-005-P / R` 费用7「渡辺 曜」：新增 `S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID`，P/R 由一个 definition 覆盖，effectText 逐字采用本地 Excel 中文卡文。
- 将既有 `PL!N-bp4-003` 费用4「桜坂しずく」从卡牌维度 workflow 晋升为当前 `workflows/shared/conditional-live-draw-one.ts`；仅配置 abilityId、预期基础编号、`HIGHER_LIVE_SCORE` / `OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT`、精确 action/no-op step，保留003旧 action payload/确认语义。
- 005 使用 event-inclusive `selectCurrentLiveRevealedCheerCardIds` 统计本次 LIVE 所有声援公开事实，包含普通/追加声援与已移出 resolutionZone 的卡；确认时重算 own/opponent，条件严格 ownCount < opponentCount，抽牌复用 `drawCardsForPlayer`，动态确认文案显示双方数量、条件状态和实际抽牌张数。
- 新增当前 `tests/integration/conditional-live-draw-one.test.ts`，并加强 `tests/integration/n-bp4-001-003-028-effects.test.ts` 的003旧 payload 回归；focused、token/text governance、classification、server/client tsc、玩家可见文案审计与 diff check 结果见本窗口收尾。

## 本次 2026-07-12 Aqours bp3-007 / 008 卡效

- 实现 `PL!S-bp3-007-P / R` 与 `PL!S-bp3-008-P / R`，均按基础编号覆盖；007 支付 `[E]` 后选择自己或对方的休息室 LIVE，经公开确认放置于该玩家卡组底，成功移动后抽1。
- 008 复用并扩展 `self-sacrifice-waiting-room-to-hand`：来源经统一离场 wrapper 支付费用，公开确认回收 LIVE；仅当本次实际回收卡为印刷分数至少6的 Aqours LIVE 时，复用通用能量操作活跃至多4张能量。
- 将 `PL!-PR-017` 纳入同一 shared family 的有限条件联合类型，保留其成功 LIVE 区印刷总分条件、既有 action step 与 payload；007 保持单卡 workflow，不与 N-bp3-010 的不同流程过度合并。

## 本次 2026-07-12 Aqours bp3-003 / 009 卡效

- 实现 `PL!S-bp3-003-P / P＋ / R＋ / SEC` 费用11「松浦果南」两段能力与 `PL!S-bp3-009-P / R` 费用9「黒澤ルビィ」登场能力，definition 使用最新本地 Excel 中文原文并按基础编号覆盖。
- 003 登场段扩 `discard-then-draw` 的 LIVE selector 与固定抽3策略；LIVE 开始段将旧 shared workflow 晋升为 `live-start-discard-gain-blade.ts`，支持0至2张、每张使此成员获得 BLADE +2，并保留旧卡弃 LIVE 抽1语义及 action history 单数字段。
- 009 仅扩 `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` / `discard-look-top-select-to-hand` 的 top6 + Aqours MEMBER 配置；先公开再入手，余牌继续走 inspection-to-waiting 事件 wrapper。runner 仅同步 shared import/register 重命名。
- 修正验证：focused classification / discard-then-draw / live-start-discard-gain-blade / discard-look-top 共147项通过；token/text governance 13项通过；server `tsc --noEmit`、client `tsc -b client`、玩家文案审计（3261条候选文本）与 `git diff --check` 均通过。

## 本次 2026-07-12 Liella! SP-bp2-005「葉月 恋」

- 实现 `PL!SP-bp2-005-P / R` 费用 4「葉月 恋」同文登场能力；一个 `baseCardCodes: ['PL!SP-bp2-005']` definition 覆盖两种罕度，前台 effectText 逐字使用本地 Excel 中文原文。
- 新增单卡薄 wrapper `workflows/cards/sp-bp2-005-ren.ts`；可选支付 `[E][E]` 复用 `payImmediateEffectCosts` / `recordPayCostAction`，支付后委托 shared `look-top-select-to-hand` 处理检视、私密候选、公开、入手与 remainder 进休息室事件。
- 不扩展 `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` / `discard-look-top-select-to-hand`，因为本卡是可选两活跃能量费用，与既有弃置1张手牌费用 family 的支付窗口、事件和无资源分支不同；runner 仅新增一条 import/register 薄胶水。

## 本次 2026-07-12 Liella! SP-bp2 无 BLADE HEART 声援三色 Heart

- 实现 `PL!SP-bp2-015-N` 费用 4「平安名すみれ」、`PL!SP-bp2-020-N` 费用 4「鬼塚夏美」、`PL!SP-bp2-021-N` 费用 4「ウィーン・マルガレーテ」；三条独立 AUTO / STAGE_MEMBER / ON_CHEER / queued / turn1 definition 使用 Excel 中文原文。
- 新增 shared `on-cheer-no-blade-heart-gain-heart.ts`，稳定配置轴仅为 abilityId、紫/红/黄 Heart 与 action step；按 pending-linked `CheerEvent.revealedCardIds` 事实判断并复用 `hasBladeHeart()` 落实 FAQ Q112/Q113，写来源实例绑定的 `SOURCE_MEMBER` modifier。
- 有效普通自己声援即使因存在任意 BLADE HEART 失败仍消费 turn1；无匹配声援、实际公开0张自己的卡、additional 或来源离场不消费。无玩家输入，不创建 activeEffect/confirm-only；focused、治理、类型与 diff 验证结果见本窗口收尾。

## 本次 2026-07-12 Liella! SP-bp2-025「Bubble Rise」

- 实现 `PL!SP-bp2-025-L / SRL` 分数 4「Bubble Rise」同文 LIVE 成功能力；一个 `baseCardCodes: ['PL!SP-bp2-025']` definition 覆盖两种罕度，前台效果文本采用本地 Excel 中文原文。
- 扩展 shared `revealed-cheer-selection` 的可选 pre-queue availability gate 配置：只扫描控制者 LEFT / CENTER / RIGHT 主成员实体，以结构化卡名别名将两个不同 cardId 分配给「澁谷かのん」「ウィーン・マルガレーテ」「鬼塚冬毬」中的两个不同名字；条件在 pending 入队前判断，结算不重查舞台。
- 结算复用当前可移动声援公开卡选择与 `moveRevealedCheerCards(..., HAND)`；强制公开单选任意卡牌类型，无目标时 single pending confirm-only、ordered resolution 自动继续。focused、token/text governance、类型与 diff 验证结果见本窗口收尾。

## 本次 2026-07-12 Liella! SP-bp2-004 中央最高有效费用常时 Heart

- 实现 `PL!SP-bp2-004-P / R` 费用 9「平安名すみれ」同文常时能力；用一个 `baseCardCodes: ['PL!SP-bp2-004']` definition 覆盖两种罕度，前台文本采用最新本地 Excel 中文同步文本。
- 仅扩展 `live-modifiers.ts` continuous registry：来源仍在己方主舞台且中央成员有效费用等于己方三个主成员槽最高值时，为该来源动态收集 `SOURCE_MEMBER` 黄 Heart +1；平手成立，不计对方舞台或 memberBelow，不进 pending，runner 不变。
- focused classification / live-modifier、token / text governance、TypeScript 与 diff 验证结果见本窗口收尾。

## 本次 2026-07-12 Liella! SP-bp2 同文登场置顶

- 实现 `PL!SP-bp2-013-N` 费用 9「唐 可可」、`PL!SP-bp2-014-N` 费用 9「嵐 千砂都」、`PL!SP-bp2-018-N` 费用 9「米女メイ」：扩展 `PL!N-bp4-021-N` 费用 9「天王寺璃奈」既有同文 definition/baseCardCodes。
- 将原卡牌维度 workflow 晋升为行为命名的 shared workflow；保留可选 0～1 张、公开选卡权威 deadline 两阶段确认、到期重校验、置顶与 pending continuation，runner 仅调整 import/register 路径。
- focused classification/integration、token/text governance、类型检查与 diff 检查结果见本窗口收尾。

## 本次 2026-07-11 Liella! bp7 能量机制与 005 / 006 / 007

- 基于公开 API / CloudBase 日文卡文实现当前公开 exact SEC：`PL!SP-bp7-005-SEC` 费用 9「叶月恋」、`PL!SP-bp7-006-SEC` 费用 15「樱小路希奈子」、`PL!SP-bp7-007-SEC` 费用 17「米女芽衣」；本地 `cards.json` 尚未收录，未虚构其他罕度。
- 新增能量区到能量卡组批量事件、幂等入队、能量下次活跃阶段 skip marker、离区清理、公开投影警示、回合条件 query 和四类能量操作候选 query；006/007 复用可选返回能量窄runtime helper，既有 `sp-bp5-111`、`sp-pb2-010` 返回路径接入统一事件。
- focused 覆盖批量事件单次触发、005 turn1/turn2、006 可选支付/混合 marker 选择/回收/本回合 query、007 批量放置/marker/最多5张主动活跃、对方活跃阶段不消费、旧状态缺字段、双方投影及旧卡无额外弹窗；完整验证结果见本窗口收尾。

## 本次 2026-07-11 虹咲 bp3 第四批卡效

- 实现 `PL!N-bp3-009-R＋ / P / P＋ / SEC` 费用 10「天王寺璃奈」与 `PL!N-bp3-028-L / SECL` 分数 1「ツナガルコネクト」，definition 使用最新本地 Excel 中文原文并按同基础编号覆盖。
- 009 为薄单卡有序置底 workflow：己方休息室恰好2张成员，按印刷费用 exact 6/8/25 互斥结算抽牌、SOURCE_MEMBER ALL Heart 或不带 liveCardId 的玩家 LIVE 总分 SCORE。
- 028 为薄单卡 inspection/reveal workflow：动态虹咲舞台计数、至多1张回顶、余牌走 inspection-to-waiting 事件 wrapper，随后公开顶卡确认并以来源 LIVE SCORE modifier 加分；未扩 arrange shared family。
- runner 仅新增两条 import/register；focused、classification、rarity、token/text、inspection/modifier 与类型验证结果见本窗口收尾，未触碰三份启动前已有框架文档 WIP。

## 本次 2026-07-11 虹咲 bp3 第三批卡效

- 实现 `PL!N-bp3-002-R / P` 费用 4「中須かすみ」与 `PL!N-bp3-011-R / P` 费用 7「ミア・テイラー」同文能力；definition 前台文本采用最新本地 Excel 中文。
- 002 扩展 `live-start-discard-gain-heart.ts` 的判别式 recipient 轴，仅表达来源成员与“其他指定团体主舞台成员”两种稳定模式；弃手、六色选择、虹咲目标选择、`TARGET_MEMBER` Heart 与下游 pending continuation 保持 shared family 边界。
- 011 保留薄单卡 compare workflow：有效 Heart 精确同色、双方上下文 effective cost、original Blade 三项各贡献 BLADE +1；未抽比较 DSL，runner 仅新增该 workflow 的 import/register。
- focused、classification、same-base rarity、token/text、modifier 与 server/client typecheck 的真实结果见本窗口收尾；未触碰三份启动前已有框架文档 WIP，也未清理其他脏树。

## 本次 2026-07-11 虹咲 bp3-012 卡效

- 实现 `PL!N-bp3-012-R / P` 费用 4「鐘 嵐珠」同文 ON_ENTER；独立 abilityId / definition 使处理窗口精确使用 Excel 中文原文。
- 仅扩展 `workflows/shared/discard-look-top-select-to-hand.ts`：弃1手后检视顶4，可选0～1张结构化『虹ヶ咲』成员或LIVE，先公开再入手，其余继续走 inspection-to-waiting 事件 wrapper；未新增单卡 workflow，runner 不变。
- 按 Q85/Q73 现有 refresh-aware 语义覆盖牌库不足：先检视剩余牌，再用休息室更新后补足，已支付的弃牌可被洗回并再次检视。同时补齐 shared stale 合同：选择时重查当前 inspectionZone，跳过时不为 stale 牌伪造公开、入手或入休息室事件。
- focused classification / shared workflow 及 token/text/rarity/type/diff 验证结果见本窗口收尾；未处理或改写既有 017/023、001/013、WAITING-first energy-below 及其他脏树内容。

## 本次 2026-07-11 虹咲 bp3-001 / 013 卡效与 energy-below 选择规则

- 实现 `PL!N-bp3-001-R＋ / P / P＋ / SEC` 费用 15「上原歩夢」LIVE_START 与 `PL!N-bp3-013-N` 费用 9「上原歩夢」ON_ENTER：分别保留单卡 workflow，共用既有 energy-below / draw 原子动作；001 另复用舞台 selector 与 BLADE helper 给当前己方主舞台成员（含来源）各加 BLADE +2。
- `stackEnergyFromEnergyZoneBelowMember` 从单纯能量区顺序改为统一 WAITING-first 自动选择；仍不让玩家选择具体能量，数量不足不部分移动，既有调用点自然继承。
- 验证：focused 001/013、energy-below 与 classification 已通过；rarity/token-text、server/client tsc 与 diff-check 结果见本窗口收尾。未改上一批 017/023 workflow、测试或登记语义。

## 本次 2026-07-11 虹咲 bp3-017 / 023 卡效

- 实现 `PL!N-bp3-017-N` 费用 4「宮下 愛」与 `PL!N-bp3-023-N` 费用 4「ミア・テイラー」的同文 ON_ENTER / LIVE_START 卡效；两张共用同一组 abilityId、definition 与 baseCardCodes，目标使用印刷费用 <=4。
- 原 `n-bp5-004-karin.ts` 晋升为 `workflows/shared/wait-self-opponent-wait.ts`；保留来源 WAITING 可选费用、支付后重扫、无目标不退款、成员状态变化事件与 pending continuation，未扩 `opponent-wait-target.ts` 或 cost DSL。
- 验证：focused shared workflow / classification / rarity / token-text governance、服务端与客户端 tsc、diff-check；真实结果见本窗口收尾。下一步仅在用户确认后进入提交窗口。

## 本次 2026-07-11 莲之空 PR-035 卡效

- 实现 `PL!HS-PR-035-PR` 费用 11「百生吟子」的单卡 ON_ENTER workflow：第一段以 PUBLIC `ORDERED_MULTI` 可选对方休息室恰好3张成员，按提交顺序置于对方卡组底；只有实际成功移动3张才进入第二段。
- 第二段复用舞台成员方向目标 helper、`memberPrintedBladeLte(3)` 与成员状态变化事件 wrapper，按 printed/original BLADE 选择对方非待机成员；无合法目标时保留第一段移动并安全继续 pending。
- 最新本地 `loveca_20260626015115.xlsx` 与 `cards_cn.json` 均无此卡，definition 前台文本采用基于 `cards.json` 日文权威卡文的忠实中文翻译；未新建 shared family，runner 仅 import/register。

## 本次 2026-07-11 莲之空 bp1-007 / PR-028 卡效

- `PL!HS-bp1-007-P / R` 费用 2「百生吟子」不新增 abilityId，复用 `SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID`；原 SP 起动段晋升 `workflows/shared/activated-pay-energy-draw.ts`，SP 的 LIVE_SUCCESS 可选支付段继续留在单卡 workflow。
- `PL!HS-PR-028-PR` 分数 5「Echoes Beyond」新增单卡 LIVE_SUCCESS workflow；通过纯 domain query `memberHasMoreEffectiveHeartsThanPrinted` 判断己方舞台成员有效 Heart 总数是否高于印刷总数，满足时抽1。旧 `PL!HS-pb1-029-L` 分数 6「全方位キュン♡」保留 Mira-Cra 过滤并改为复用该 query。
- PR-028 单 pending 使用实时 confirm-only，ordered resolution 自动连续；focused classification、Heart query、activated/旧 SP、PR-028 与旧 pb1-029 测试及类型检查结果见本窗口收尾。
- 修正 PR-028 来源 LIVE 已失效但舞台条件成立时的实时文案：保留“满足条件”，实际结果改为“不抽牌”，确认文案与 resolver 共用同一最小判断，且不暴露内部来源校验。

## 本次 2026-07-11 莲之空弃手后抽牌 shared family

- 实现 `PL!HS-bp1-005-P / R / PR` 费用 9「大沢瑠璃乃」与 `PL!HS-PR-031-PR` 费用 11「日野下花帆」；前者弃至多3张后等量抽牌，后者可弃恰好2张后按弃置后的手牌数抽至5张，未登记同文范围外 `PL!N-PR-028-PR`。
- 新增 `workflows/shared/discard-then-draw.ts`，稳定轴为 selector、选择上下限/跳过文案与 `discarded count + offset` / `until hand size` draw policy；多张弃手统一走 trigger-safe wrapper。`PL!HS-pb1-003` 费用 15「大沢瑠璃乃」仅将登场段晋升 shared，AUTO 段继续留在原单卡 workflow。
- 验证：focused shared/旧卡/classification/rarity/token/text/hand-discard trigger、服务端与客户端 tsc、`git diff --check`；结果见本窗口收尾。下一步仅在用户确认后进入提交窗口。

## 本次 2026-07-11 莲之空 PR 027 / 029 卡效

- `PL!HS-PR-027-PR` 费用 7「徒町小鈴」通过既有 N_PR_021 ability definition 的 `baseCardCodes` 共用 LIVE 成功弃1手回收低费用成员/低分 LIVE 的 shared workflow；`PL!HS-PR-029-PR` 费用 5「大沢瑠璃乃」扩展 `pay-energy-gain-heart.ts`，支付1能量后写 `SOURCE_MEMBER` 桃 Heart +1。
- `pay-energy-gain-heart.ts` 的“不发动”从 selectable option 收敛为唯一 skip 入口，保留正向支付选项，并覆盖既有 `PL!N-sd1-010` / `PL!SP-bp4-012` 回归。
- 验证：focused classification / 同文 shared / Heart family / token / text governance 共 7 个文件、86 tests 通过；`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均通过。下一步仅在用户确认后进入提交窗口。
- 后续补齐双 pending continuation / ordered-resolution 覆盖：2 个 focused 文件、14 tests 通过；两项均在第一项结算后停留于第二项真实交互窗口，不插入 confirm-only。

## 本次 2026-07-11 缪斯 PB1 第四批卡效

- 新增 `PL!-pb1-008-R / P＋` 费用 11「小泉花陽」：自己的主舞台成员可选0至3名变为 WAITING，逐名通过成员状态变化 wrapper 入队，并按实际成功人数抽牌。
- 新增 `PL!-pb1-017-R / P＋` 费用 7「小泉花陽」：可选自身 WAITING 后抽1；只读取本次 relayReplacements 的 Printemps 身份，Printemps 换手免弃，其他情况抽后弃1并保留状态变化/弃手触发 continuation。
- 验证：focused classification/008/017 共58 tests、003/relay/弃手 trigger/runtime/text/token regression 共72 tests、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均通过。

## 本次 2026-07-11 缪斯 PB1 第三批卡效

- 已实现 `PL!-pb1-006-R / P＋` 费用 11「西木野真姫」与 `PL!-pb1-007-R / P＋` 费用 13「東條 希」：006 为可选休息室 μ's LIVE 置顶后实时检查对方 WAITING 并抽1；007 为按成功 LIVE 张数动态减免弃手、0费用直达、支付后重查其他 lily white 与 μ's LIVE 回收。
- 两者均为独立窄单卡 workflow，只复用既有 selector/runtime/activeEffect helper；runner 仅新增 import/register。focused classification/integration 共 62 tests 通过，完整 regression 与类型检查结果见本窗口收尾。

## 本次 2026-07-11 缪斯 PB1 第二批卡效

- 已实现 `PL!-pb1-003-R / P＋` 费用 13「南ことり」与 `PL!-pb1-012-R / P＋` 费用 2「南ことり」：分别为可选自身待机后按 Printemps 舞台人数活跃能量，以及可选活跃自己舞台至多1名 WAITING Printemps 成员；均为窄单卡 workflow，复用成员状态变化 trigger wrapper，012 同时复用舞台成员目标选择。

## 本次 2026-07-11 缪斯 PB1 第一批卡效

- 已实现 `PL!-pb1-005-R / P＋` 费用 2「星空 凛」与 `PL!-pb1-032-L` 分数 2「SENTIMENTAL StepS」：前者扩展 shared `member-on-enter-draw` 的成功LIVE卡区张数条件轴；后者扩展 `success-zone-conditional-recovery-draw` 的条件抽牌结果配置，未满足时抽0。
- `PL!-pb1-032-L` 沿用无交互 LIVE_SUCCESS 的 confirm-only / 顺序发动桥接，确认窗口实时显示自己的成功LIVE卡区 μ's 卡数量、条件和实际抽牌结果；runner 无改动。focused classification/integration、token/text governance、`tsc --noEmit`、`tsc -b client` 与 diff check 已通过。

## 本次 2026-07-11 缪斯 BP3 第九批卡效

- 已实现 `PL!-bp3-007-P / R` 费用 9「東條 希」：LIVE 开始时可选弃2手，之后检视自己卡组顶3张，并强制分配为入手1张、回顶1张、入休息室1张。
- 新增窄单卡 `pl-bp3-007-nozomi.ts`；弃手复用 hand-to-waiting trigger wrapper，检视复用 refresh-aware `inspectTopCards`。新增通用原子 `partitionInspectedCardsToHandDeckTopWaitingRoomAndEnqueueTriggers`，只负责校验 inspected 全量分区、一次性更新 HAND / MAIN_DECK_TOP / WAITING_ROOM 与清理 inspection，并仅为 waiting 子集发 `MAIN_DECK -> WAITING_ROOM` 事件，不承载007的1/1/1卡文规则。runner 仅增加 import/register 薄胶水。
- focused classification/workflow/runtime-helper/boundary、token/text governance、rarity sync（7 files / 116 tests）、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第八批卡效

- 已实现 `PL!-bp3-024-L` 分数 2「夏色えがおで1,2,Jump!」两段能力：成功 LIVE 卡区有卡时，强制选择桃/黄/紫 Heart 之一，再选择自己舞台1名结构化 μ's 成员，使其至 LIVE 结束获得所选 Heart +1；成功 LIVE 卡区至少2张时，此 LIVE 分数 +1。
- 第一段新增窄单卡 `pl-bp3-024-natsuiro-egao-de-1-2-jump.ts`，复用 stage target selector 与 `addHeartLiveModifierForMember` 写 `TARGET_MEMBER` modifier，并在颜色、目标两步实时重查来源 LIVE、成功区与目标；第二段扩展 shared `live-start-score-bonuses.ts`，沿用实时 manual confirm-only / ordered 语义。runner 仅增加 import/register 薄胶水。
- focused classification/integration、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第七批卡效

- 已实现 `PL!-bp3-009-R＋ / P / P＋ / SEC` 费用 2「矢澤にこ」两段能力：登场结算时自己当前主舞台存在有效费用大于等于13的成员则抽1；起动每回合1次将此成员 ACTIVE -> WAITING，强制选择桃/黄/紫 Heart 之一，LIVE结束时为止此成员获得所选 Heart +1。
- 新增窄单卡 `pl-bp3-009-nico.ts`。登场段复用 `getMemberEffectiveCost`、manual confirm-only 与 `drawCardsForPlayer`，已入队后来源离场不取消；起动段复用成员状态变化 helper/wrapper，支付成功后才记录次数，并通过 `addHeartLiveModifierForMember` 写 `SOURCE_MEMBER` modifier。runner 仅增加 import/register 薄胶水。
- focused classification/integration（含四罕度、有效费用升降、来源离场、手动确认实时重查、三色、非法/陈旧选择、状态事件及 turn1）、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第六批卡效

- 已实现 `PL!-bp3-004-R＋ / P / P＋ / SEC` 费用 11「園田海未」两段能力：登场时按结算当下自己主舞台成员数抽牌，之后有手牌时强制放置1张入休息室；LIVE 开始时若自己成功 LIVE 卡区有卡，可选弃1手，再从休息室强制回收1张结构化 μ's LIVE。
- 新增窄单卡 `pl-bp3-004-umi.ts`。登场段复用 `countStageMembers`、`drawCardsForPlayer` 与 hand-to-waiting trigger wrapper；FAQ Q146 的来源仍在场时计入，pending 入队后来源离场仍按当前舞台结算。LIVE_START 段复用 optional-discard activeEffect、waiting-room-to-hand zone selection 与 recovery helper；刚弃置的合法 μ's LIVE 可被选回，无目标时保留费用并安全结束。runner 仅增加 import/register 薄胶水。
- focused classification/integration（含刷新、稀有度、来源离场、stale 与事件不重复）、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第五批卡效

- 已实现 `PL!-bp3-002-P / R` 费用 9「絢瀬絵里」两段能力：登场可选弃1手，支付后实时扫描对方舞台费用4以下且非 WAITING 的成员，并按 FAQ Q144 可选0至2名变 WAITING；登场 pending 已入队后来源离场仍继续结算。
- 登场段新增窄单卡 `pl-bp3-002-eli.ts`，复用 optional discard activeEffect、hand-to-waiting trigger wrapper、有效费用 query、`setMembersOrientation` 与 member-state trigger wrapper；不迁移 `n-bp4-005-ai.ts`，避免改变其来源仍在场门槛。常时段扩展 continuous live modifier registry，按对方主舞台 WAITING 成员数实时给来源成员 BLADE +N，0名、来源离场或 memberBelow 时即时失效。runner 仅增加 import/register 薄胶水。
- focused classification/integration/live-modifiers、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 已通过。

## 本次 2026-07-11 缪斯 BP3 第四批卡效

- 已实现 `PL!-bp3-003-P / R` 费用 11「南ことり」：登场后可选将仍在己方舞台且为 ACTIVE 的来源成员变为 WAITING；支付后重扫自己休息室，有结构化 μ's MEMBER 时必须选1张加入手牌，无合法目标时按 FAQ Q145 保留费用并安全结束。
- 新增窄单卡 `pl-bp3-003-kotori.ts`；自身待机费用窗口直接提供“发动 / 不发动”动作，不重复展示来源成员作为可选目标。状态费用复用 `setMemberOrientation` 与 member-state trigger wrapper，先记录 PAY_COST 再入队真实 ACTIVE -> WAITING 事件。回收复用 waiting-room-to-hand activeEffect/zone selection 与 `recoverCardsFromWaitingRoomToHandForPlayer`；来源离场/已 WAITING、拒绝费用、非法/陈旧动作或目标、手动与 ordered 多 pending 均有 focused 覆盖。runner 仅增加 import/register 薄胶水。
- focused classification/integration、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 已通过。

## 本次 2026-07-11 缪斯 BP3 第三批卡效

- 已实现 `PL!-bp3-025-L` 分数 4「タカラモノズ」：新增窄单卡 `pl-bp3-025-takaramonozu.ts`，LIVE 成功结算时读取当前 `playerRemainingHearts` 总数；0个且来源仍在自己的 LIVE 区时，为来源 LIVE 写 SCORE +1 并刷新 `playerScores`，RAINBOW 计入余 Heart 且能力不消费余 Heart。
- 无交互 queued pending 沿用 manual confirm-only / ordered bridge，动态文案展示当前余 Heart 数、满足/未满足与实际 `[スコア]` 结果；同 ability/source 的重复 pending 保持幂等，不错误叠加 modifier。runner 仅增加 import/register 薄胶水。
- focused classification/integration、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第二批卡效

- 已实现 `PL!-bp3-005-P / R` 费用 4「星空 凛」：新增窄单卡 `pl-bp3-005-rin.ts`，登场 pending 结算时将控制者当前舞台所有主成员（包含来源）变为 ACTIVE；已排队后来源离场不阻断效果，仍按当前舞台结算。
- 状态变化复用 `setMembersOrientation` 与 `enqueueMemberStateChangedTriggersFromOrientationResult`，只为真实 WAITING -> ACTIVE 变化生成并入队 `ON_MEMBER_STATE_CHANGED`。本能力 RESOLVE 事实先记录，随后入队下游状态变化能力，再继续 pending；全员已 ACTIVE 时无伪事件，多 pending 不丢失或重复。
- workflow 保持单卡 ownership，未因单一样本扩 shared family/DSL；runner 仅增加 import/register 薄胶水。focused classification/integration、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 缪斯 BP3 第一批卡效

- 已实现 `PL!-bp3-019-L` 分数 0「僕らのLIVE 君とのLIFE」：扩展 shared `live-start-score-bonuses.ts`，实时统计自己 LIVE 中结构化身份为 μ's 的卡片（包含来源自身），达到2张时为来源 LIVE 写 SCORE +1 并刷新 `playerScores`。
- 已实现 `PL!-bp3-023-L` 分数 3「ミはμ'sicのミ」：扩展 shared `conditional-live-modifier.ts`，通过 `getMemberEffectiveBladeCount` 汇总自己舞台成员实时有效 BLADE，达到10时为来源 LIVE 写必要 `[無ハート]` -2，并在条件变化时替换或清理同源 modifier。
- 两张均沿用无交互 queued pending 的 manual-confirm / ordered 语义，手动确认文本实时展示当前计数、条件与实际结果，顺序发动自动连续结算；runner 零改动。focused classification/integration、token/text governance、rarity sync、`tsc --noEmit`、`tsc -b client` 与 `git diff --check` 均已通过。

## 本次 2026-07-11 水团 BP2 声援重做收尾

- `PL!S-bp2-004-R / P` 费用 11「黒澤ダイヤ」完成 P/R 收束：无 LIVE 的原普通声援可选移动原公开卡后，先记录 turn1、按原 BLADE 重做 normal `CheerEvent` 并显式重新入队；`replaceCurrentCheerCards` 仅替换当前玩家 current cheer IDs，满足 Q107，未扩成通用 cheer loop。
- 新增窄只读 `runtime/cheer-events.ts` query，供 004、`PL!S-bp2-003` 费用 9「松浦果南」与 `PL!SP-PR-024-PR` 费用 4「平安名すみれ」按 pending eventIds 读取最后一个己方普通 CheerEvent。
- focused 验证覆盖真实多 pending 的手动选择与顺序发动：第一次 003/004 同时入队，004 重做后旧 003 条件失败不占 turn1，第二次普通声援的新 003 正常结算；并覆盖 query 单测与既有三调用方回归。

## 本次 2026-07-10 莲 HS-bp2 018 休息室 LIVE 正面放置

- 已实现 `PL!HS-bp2-018-N` 费用 7「安養寺 姫芽」：自己的主要阶段登场时，存在2张 ACTIVE 能量和休息室 LIVE 目标才打开可选支付窗口；不发动、费用不足、无目标或非己方主要阶段均不支付并安全 no-op。
- 支付后强制选择1张当前仍在自己休息室的 LIVE 卡，通过 `placeWaitingRoomLiveCardInLiveZoneForPlayer` 正面放入 LIVE 区并记录 `WAITING_ROOM -> LIVE_ZONE` 的 `ON_ENTER_LIVE_ZONE` 事件；非法或陈旧选择由命令/动作层拒绝，不移动卡也不登记跨阶段限制。
- 成功放置后复用既有 `liveSetLimitReductions`：下一次自己的 LIVE 卡设置阶段上限 -1，对手完成阶段不消费，自己完成该阶段时消费一次，之后恢复。单卡 workflow `hs-bp2-018-hime.ts`；runner 仅新增1组 import/register 薄胶水。

## 本次 2026-07-10 莲 HS-bp2 019 必要 Heart 三选一

- 已实现 `PL!HS-bp2-019-L` 分数 1「Bloom the smile, Bloom the dream!」：来源仍在自己的 LIVE 区且己方舞台存在莲之空成员时，打开桃2+无1、绿2+无1、蓝2+无1三种必要 Heart 形状的真实选择窗口，并可选择不改变。
- 单卡 workflow `hs-bp2-019-bloom-the-smile-bloom-the-dream.ts` 通过印刷必要 Heart 计算自身 REQUIREMENT delta，并用 `replaceLiveModifier` 只替换本 ability/source 的 modifier；`getLiveCardRequirementModifiers` + `applyHeartRequirementModifiers` 验证最终形状。FAQ Q127 等外部无色 +1 modifier 保留叠加，选择形状后会得到选中色2+无色2。
- 本批不扩无输入 `conditional-live-modifier`，不新增 helper/DSL；runner 仅新增1组 import/register 薄胶水。

## 本次 2026-07-10 莲 HS-bp2 007 换手回收与同名成员强化

- 已实现 `PL!HS-bp2-007-R＋ / P / P＋ / SEC` 费用 11「百生 吟子」两段能力：从费用严格更低的 Cerise Bouquet 成员换手登场时，强制从休息室回收1张莲之空 LIVE；LIVE开始时可弃1手，若弃置成员卡则选择己方舞台持有相同名称的1名成员，获得绿色 Heart +1 与 BLADE +1。
- 登场段复用 `relay-enter-lower-cost-unit` 与 `waiting-room-to-hand`；LIVE开始段复用 optional discard shell 与 HAND -> WAITING_ROOM trigger wrapper，支付后通过共享 `getCardNameCandidates` / `cardNameAliasAny` 识别多名称成员。`LL-bp1-001-R＋`「上原歩夢&澁谷かのん&日野下花帆」可因弃置「日野下花帆」成为目标，目标 Heart 写 `TARGET_MEMBER`，BLADE 沿用目标成员 cardId 约定。
- 本批新增单卡 workflow `hs-bp2-007-ginko.ts`，runner 仅新增1组 import/register 薄胶水；未修改 trigger matcher、cost calculator、steps DSL 或共享 identity/helper 语义。

## 本次 2026-07-10 莲 HS-bp2 003 可选弃手控顶

- 已实现 `PL!HS-bp2-003-R / P` 费用 7「乙宗 梢」：LIVE开始时可弃1手；支付后检视卡组顶3张，将任意张按任意顺序放回卡组顶，其余放置入休息室。
- 新增单卡薄 wrapper `hs-bp2-003-kozue.ts`；弃手选择复用 optional discard activeEffect shell，弃手移动走 HAND -> WAITING_ROOM trigger wrapper，随后委托 shared `arrange-inspected-deck-top` 处理私密检视、有序回顶、余牌入休息室、refresh 与 pending continuation。
- shared arrange public summary 新增可选 `discardedCostCardIds` 上下文：003 的 STARTED/COMPLETED summary 均携带真实费用卡；旧无费用调用保持空数组。本批 runner 仅新增1组 import/register 薄胶水。

## 本次 2026-07-10 莲 HS-bp2 换手登场奖励

- 已实现 `PL!HS-bp2-008-R / P` 费用 4「徒町 小鈴」：从费用严格更低的 DOLLCHESTRA 成员换手登场时，来源成员获得 BLADE +2。
- 已实现 `PL!HS-bp2-009-R / P` 费用 13「安養寺 姫芽」：登场可支付1张 ACTIVE 能量；支付后若从费用严格更低的 Mira-Cra Park! 成员换手登场，来源成员获得2个桃 Heart。支付选项不按换手条件前置隐藏，条件失败时保留已支付费用。
- 两张保持独立 card workflow，只共用窄纯条件 helper `relay-enter-lower-cost-unit.ts`：replacement 费用读取本次事件捕获 `relayReplacements.effectiveCost`，来源费用读取结算时有效费用，并以结构化小队 alias 判断；不扩成 relay DSL。本批 runner 只新增两组 import/register 薄胶水。

## 本次 2026-07-10 莲 HS-bp2 起动回收与登场抽卡

- 已实现 `PL!HS-bp2-001-R / P` 费用 13「日野下花帆」：扩展 shared `pay-energy-waiting-room-to-hand`，起动1回合1次支付 [E][E]，强制回收1张印刷分数小于等于3的莲之空 LIVE；无合法目标或活跃能量不足时不支付也不消耗次数。Excel 中文源将「分数」误译为「费用」，实现与 definition 按 `cards.json` / Excel 日文权威文本修正为分数。
- 已实现 `PL!HS-bp2-017-N` 费用 7「徒町 小鈴」：扩展 shared `member-on-enter-draw` 的休息室数量阈值配置，登场 pending 结算时重算己方休息室，10张以上抽1，否则 no-op 并继续后续 pending。
- 本批未新增卡牌维度 workflow、未修改 runner。focused integration 覆盖 R/P、费用/目标门禁、合法筛选、turn1、非法/陈旧选择、休息室9/10张、结算时重算与 pending continuation。

## 本次 2026-07-10 莲 HS-bp2 LIVE 开始分数修正

- 已实现 `PL!HS-bp2-020-L` 分数 0「Link to the FUTURE」的 LIVE 开始段：保留既有 exact-code 三小队常时身份 definition，扩展 `live-start-score-bonuses`，以 `cardBelongsToGroup` 与 `selectDifferentNamedCards` 统计自己主舞台不同名『莲之空』成员，每名使来源 LIVE [スコア]+2。
- 已实现 `PL!HS-bp2-026-L / L＋` 分数 5「みらくりえーしょん」：通过 `baseCardCodes` 同步 L / L＋，以 `cardNameAliasIs` 复核自己的右侧大沢瑠璃乃、左侧安養寺姫芽、中央藤島慈；三槽均符合时来源 LIVE [スコア]+2。
- 两张均复用 shared 无交互 manual-confirmation 路径：单 pending/手动点选先确认，顺序发动自动连续结算；确认文案实时显示不同名数量或三槽条件与实际分数结果。本批未修改 runner、未新增 helper 或卡牌 workflow。

## 本次 2026-07-10 莲 HS-bp2 第一批卡效

- 已实现 `PL!HS-bp2-011-N / PR` 费用 2「村野さやか」：扩展 shared `direct-mill-top`，登场将卡组顶5张放置入休息室，继续使用 refresh-aware main-deck-to-waiting trigger wrapper，refresh 洗回卡组的牌不计入本次 movedCardIds。
- 已实现 `PL!HS-bp2-016-N` 费用 4「百生 吟子」：与 `PL!HS-pb1-024-N` 同型，复用 `HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID` 与 `arrange-inspected-deck-top`，通过 baseCardCodes 同时覆盖；未选择的 inspected cards 继续走 inspection-to-waiting wrapper。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录 direct mill 与 inspection-to-waiting 两种事件边界。本批未新增卡牌维度 workflow、未新增 helper、未修改 runner。

## 本次 2026-07-09 余Heart实时口径修正

- 修正 `PL!S-pb1-021-L` 分数 1「Strawberry Trapper」：对方“无余Heart成功LIVE”条件改为读取当前 `playerRemainingHearts`，不再回看 `LIVE_JUDGMENT.remainingHeartTotalCount`；因此 `PL!S-bp6-024-L`「コワレヤスキ」等效果先清空对方余Heart后，本卡可正常满足条件。其余已实现余Heart相关卡效仍保持当前余Heart口径，无需迁移。

## 本次 2026-07-09 水团 sd1 第一批卡效

- 已实现 `PL!S-sd1-001-SD` 费用 17「高海千歌」：现由 shared `on-cheer-live-count-gain-heart.ts` 处理，ON_CHEER / turn1 按 pending 绑定的普通自己声援 `CheerEvent.revealedCardIds` 事实统计自己公开 LIVE 卡，最多获得 3 个 [赤ハート]，不依赖当前 `resolutionZone`；0 张也记录使用，来源离场安全 no-op，additional cheer 不二次触发。
- 已实现 `PL!S-sd1-006-SD` 费用 5「津島善子」：新增窄 workflow `s-sd1-006-yoshiko.ts`，ON_ENTER queued 真实可选弃 1 手牌交互不套 confirm-only；弃手走 hand -> waiting room trigger wrapper，支付后重扫休息室与空成员区，刚弃置的费用 2 以下 Aqours 成员可登场，休息室登场显式入队 `ON_ENTER_STAGE`。括号文“该区域本回合不能登场成员”暂按底层通用规则治理，单卡 workflow 不写静态锁、不记录特殊 `movedToStageThisTurn`。
- 已实现 `PL!S-sd1-003-SD` 费用 11「松浦果南」：扩展 shared `look-top-select-to-hand`，查看顶 5，selector 为 Aqours LIVE，公开后入手，其余 inspected cards 通过 inspection-to-waiting wrapper 进入休息室并保留 `MAIN_DECK -> WAITING_ROOM` 事件语义。
- 已实现 `PL!S-sd1-013-SD` 费用 4「黒澤ダイヤ」：扩展 shared `direct-mill-top`，`topCount=5`，继续使用 `moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers`，refresh 洗回卡组的牌不计入本次 `movedCardIds`。
- 已实现 `PL!S-sd1-019-SD` 分数 1「未来の僕らは知ってるよ」：扩展 shared `revealed-cheer-selection`，LIVE 成功时强制选择本次自己声援公开、仍在处理区且 revealed 的 Aqours LIVE 加入手牌，移动复用 `moveRevealedCheerCards(..., HAND)`，保留真实选择窗口。
- 已实现 `PL!S-sd1-022-SD` 分数 6「Jump up HIGH!!」：扩展 shared `aqours-live-start-success-effects.ts` 的 Aqours LIVE_START BLADE 路径；无交互 queued pending 走 confirm-only / manual confirmation，动态文案展示当前自己舞台 Aqours 成员数与实际获得 [BLADE] 的成员数，结算时重查来源 LIVE 仍在自己的 LIVE 区并只给自己舞台 Aqours 成员逐个写 BLADE +1。
- 已实现 `PL!S-sd1-002-SD` 费用 15「桜内梨子」：扩展 shared `on-enter-discard-recover-unit-card`，登场 queued 真实交互可不发动；弃 1 手牌走 hand -> waiting room trigger wrapper，支付后重扫休息室并强制回收 1 张 Aqours 任意类型卡，刚弃置的 Aqours 卡可回收。
- 已实现 `PL!S-sd1-005-SD` 费用 5「渡辺 曜」：新增窄 workflow `s-sd1-005-you.ts`，起动 turn1 支付 2 活跃能量并弃 1 手牌，弃手走 wrapper；支付后重扫休息室强制回收 1 张 Aqours LIVE，刚弃置的 Aqours LIVE 可回收，支付后无目标费用保留 no-op。
- 已实现 `PL!S-sd1-004-SD` 费用 13「黒澤ダイヤ」：新增窄 workflow `s-sd1-004-dia.ts`，LIVE_START 真实可选交互不套 confirm-only；来源成员开始结算与回顶选择时均重查仍在己方舞台，选择发动后抽 1，再按当前手牌 ordered multi 选择正好 2 张按顺序放到卡组顶，抽到的卡可回顶；无法抽、手牌不足、陈旧/非法选择均安全继续 pending，回顶不触发进休息室事件。
- 已实现 `PL!S-sd1-020-SD` 分数 2「JIMO-AI Dash!」：新增窄 workflow `s-sd1-020-jimo-ai-dash.ts`，LIVE_SUCCESS 真实弃手交互不套 confirm-only；结算时重查来源 LIVE 仍在自己的 LIVE 区与当前己方舞台 Aqours 成员数，按成员数抽牌，弃手数量等于实际因此抽到的张数，0 抽不弹弃手选择；弃手走 hand -> waiting room trigger wrapper，陈旧/非法弃手选择安全继续 pending。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录上述 sd1 卡的实现状态、复用 workflow/helper 与 focused tests。
- 验证：前 3 张的既有记录为 `vitest run tests/unit/card-effect-classification.test.ts tests/integration/look-top-select-to-hand.test.ts tests/integration/direct-mill-top.test.ts tests/integration/s-sd1-019-revealed-cheer-selection.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（6 files / 26 tests）、`tsc --noEmit` passed、`git diff --check` passed。本次追加 `PL!S-sd1-002-SD` / `PL!S-sd1-005-SD` 后，已验证 `vitest run tests/unit/card-effect-classification.test.ts tests/integration/s-sd1-002-005-aqours-recovery.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（4 files / 26 tests）、`tsc --noEmit` passed、`git diff --check` passed。本次追加 `PL!S-sd1-001-SD` / `PL!S-sd1-022-SD` 后，已验证 `vitest run tests/unit/card-effect-classification.test.ts tests/integration/on-cheer-live-count-gain-heart.test.ts tests/integration/aqours-live-start-success-effects.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（5 files / 35 tests）、`tsc --noEmit` passed、`git diff --check` passed。本次追加 `PL!S-sd1-004-SD` / `PL!S-sd1-020-SD` 后，已验证 `vitest run tests/unit/card-effect-classification.test.ts tests/integration/s-sd1-004-dia.test.ts tests/integration/s-sd1-020-jimo-ai-dash.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（5 files / 22 tests）、`tsc --noEmit` passed、`git diff --check` passed。本次追加 `PL!S-sd1-006-SD` 后，已验证 `vitest run tests/unit/card-effect-classification.test.ts tests/integration/s-sd1-006-yoshiko.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（4 files / 24 tests）、`tsc --noEmit` passed、`git diff --check` passed。

## 本次 2026-07-08 3.7.1 发布准备

- 产品版本已同步到 `3.7.1`：`VERSION`、根 `package.json`、`client/package.json` 三处一致；`client/dist/version.json` 构建产物显示 `version: 3.7.1`。
- 新增 `drizzle/migration-notes/3.7.0-to-3.7.1.md`：本次无 Drizzle schema migration、不重跑卡牌同步；发布注意点集中在 API 运行态 cleanup/stats、对墙打运行态恢复、public-events 截断、历史回放读取上限及新增可调环境变量。
- 发布检查中首次 `pnpm test:run` 暴露 `tests/integration/online-command-pipeline.test.ts` 的随机手牌 fixture 不稳定；已修正该用例显式从主卡组补足 3 张成员，再复跑 focused 与全量测试通过。
- 验证：`pnpm install --frozen-lockfile` passed；`pnpm --dir client install --frozen-lockfile` passed；`pnpm version:check` passed；`pnpm typecheck:all` passed；`pnpm exec vitest run tests/integration/online-command-pipeline.test.ts` passed（68 tests）；`pnpm test:run` passed（344 files / 2768 tests，3 performance tests skipped）；`pnpm build:server` passed；`pnpm --dir client build` passed（保留既有 chunk size warning）；`git diff --check` passed。
- 收尾检查：`assets/card` 与 `assets/images` 无 diff；本次未构建 Android TWA 包、未构建 Docker API 镜像、未打/推 `v3.7.1` tag。工作树仍有用户已有未跟踪草稿/计划文档，发布提交前需确认是否纳入或保持未跟踪。

## 本次 2026-07-08 生产 API OOM P0 运行态治理

- `GameSession` 运行态新增 stats，并将 `authoritySnapshots` / `snapshotHistory` 改为最近 64 个 public seq 有界保留；极旧恢复 seq 不再回退到最早保留快照，避免为了旧 cursor 常驻完整历史。
- 撤销快照不再复制 `publicEvents`、`privateEventsBySeat`、`sealedAuditRecords`、`commandLog`、`snapshotHistory` 与整张 `authoritySnapshots` Map；现在只保存撤销所需权威状态与日志游标，恢复时按游标截断运行态数组并重建当前恢复快照。
- `OnlineMatchService` 新增运行态 stats 与 cleanup summary；`OnlineRoomService` 暴露全局 runtime cleanup 入口；API 进程启动后每分钟执行房间/对墙打共用 cleanup，并输出 `api-runtime-cleanup` 摘要与 `api-runtime-stats` 内存 / match 摘要日志。
- public-events 增加 `ONLINE_PUBLIC_EVENTS_MAX_BATCH` 截断保护，参与者与观战者旧 cursor 只返回最近尾部事件并输出 `online-public-events-truncated`；前端 public battle log 收到 `truncated` 后重置本地旧事件，避免展示不连续历史。
- 历史读取增加 `MATCH_REPLAY_TIMELINE_ROW_LIMIT` / `MATCH_REPLAY_VISIBLE_ROW_LIMIT` / `MATCH_REPLAY_EXPORT_ROW_LIMIT` 保护；timeline、replay 节点、admin export 在全量读取前按记录 seq 估算规模，超限直接 413 并输出 `match-replay-read-blocked`。
- 新增 `src/server/services/solitaire-runtime-recovery-service.ts`：对墙打运行态缺失时可从最新 AUTHORITY checkpoint + public-events 尾部重建 `GameSession`；`SolitaireMatchService` 读路径会自动恢复并重新注册运行态，写路径在 checkpoint 已回退时返回恢复快照并拒绝旧操作；撤销路径即使未回退也会提示恢复后撤销历史已重置。
- `OnlineMatchService` 快照新增一次性 `recovery/publicEvents/truncated/droppedEventCount` 恢复载荷；前端 `gameStore` 收到恢复快照会先清空旧 public battle log，再合并恢复尾部事件；若远程 command / advance / undo 失败但附带恢复快照，也会先落本地状态再提示错误。
- 提交前补修恢复快照边界：恢复通知待发送时服务端不再因 `sinceSeq >= currentSeq` 返回未修改；前端允许带 `recovery` 的权威恢复快照穿过普通 seq 去重，避免恢复 revision 与旧客户端 revision 持平时丢失恢复载荷；若 `public-events` 先触发对墙打回退恢复，后续写操作仍会读取待发送 recovery notice 并拒绝旧操作。
- 联机房间与对墙打新增离开确认提示：准备阶段提示可重新加入，联机进行中提示“稍后可回来继续 / 双方离开太久会结束本局”，对墙打提示离开后本局直接结束，避免用户误以为所有离开都能无损恢复。
- 前端补齐对墙打刷新恢复入口：创建服务端可记录对墙打后在同一标签页 `sessionStorage` 保存 matchId；应用启动完成认证与卡牌数据加载后自动拉取 snapshot、接回远程 session 并进入桌面；用户明确离开对墙打时清理该恢复记录。
- 验证：`pnpm exec vitest run tests/integration/online-session-bridge.test.ts tests/unit/solitaire-match-service.test.ts` passed；`pnpm exec vitest run tests/integration/online-session-bridge.test.ts tests/unit/solitaire-match-service.test.ts tests/integration/online-room-service.test.ts tests/integration/online-route-error-handling.test.ts` passed；`pnpm exec tsc --noEmit` passed；`pnpm exec tsc -p tsconfig.server.json --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/integration/online-session-bridge.test.ts tests/unit/game-store-remote-sync.test.ts tests/unit/match-replay-read-service.test.ts tests/unit/solitaire-match-service.test.ts tests/integration/online-route-error-handling.test.ts` passed；`pnpm exec vitest run tests/unit/solitaire-match-service.test.ts tests/unit/game-store-remote-sync.test.ts tests/integration/online-session-bridge.test.ts` passed；`pnpm exec vitest run tests/unit/solitaire-match-service.test.ts tests/unit/game-store-remote-sync.test.ts` passed；`pnpm exec vitest run tests/integration/online-room-service.test.ts tests/unit/solitaire-match-service.test.ts tests/unit/game-store-remote-sync.test.ts tests/integration/online-session-bridge.test.ts tests/unit/match-replay-read-service.test.ts` passed；`pnpm test:run` passed（320 files / 2576 tests，3 performance tests skipped）；`git diff --check` passed。
- 追加验证：`pnpm exec vitest run tests/unit/solitaire-match-service.test.ts` passed；`pnpm exec vitest run tests/unit/solitaire-match-recovery.test.ts tests/unit/game-store-remote-sync.test.ts tests/unit/solitaire-match-service.test.ts` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec tsc --noEmit` passed；`pnpm exec tsc -p tsconfig.server.json --noEmit` passed；`pnpm test:run` passed（321 files / 2581 tests，3 performance tests skipped）；Playwright smoke 在已运行的 `http://localhost:5173/` 登录测试账号创建对墙打，刷新后仍回到同一 matchId 桌面，并已调用离开接口清理测试局；`git diff --check` passed。
- 后续：public-events 真分页协议与历史回放分页 UI 仍属于下一批 P1 follow-up；若生产还存在 checkpoint 间隔过大导致恢复回退过多，再评估缩短 authority checkpoint 周期。

## 本次 2026-07-07 水团 bp5 第一批卡效

- 已实现 `PL!S-bp5-015-N` 费用 9「津島善子」：扩展 shared `direct-mill-top`，新增 `topCount=10` 配置，direct mill 继续走 refresh-aware `moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers`，只将实际从主卡组顶进入休息室的卡写入本次 `ON_ENTER_WAITING_ROOM` 事件与 `movedCardIds`。
- 已实现 `PL!S-bp5-016-N` 费用 9「国木田花丸」：新增窄 LIVE_START workflow，使用 `getMemberEffectiveCost` 比较己方舞台最高有效费用是否严格高于对方舞台所有成员有效费用；对方舞台为空时按条件满足处理，费用相等不满足，来源离场 no-op，满足时写 SOURCE_MEMBER `[BLADE][BLADE]`。
- 已实现 `PL!S-bp5-017-N` 费用 4「小原鞠莉」：新增窄 LIVE_START workflow，只统计己方 LIVE 卡区卡牌印刷必要 `[青ハート]` 合计，满足 >=4 且来源仍在舞台时写 SOURCE_MEMBER `[青ハート]` +1，不统计成员持有 Heart 或临时 Heart modifier。
- 已实现 `PL!S-bp5-222-R / P＋` 费用 11「鹿角理亞」：起动段与 `PL!S-bp5-111` 抽到 shared `pay-energy-position-change-to-group-member-area`，支付 `[E]` 后强制移动到已有『Aqours』或『SaintSnow』成员的其他区域并保留 `ON_MEMBER_SLOT_MOVED`；自动段保留单卡 workflow，自身移动后活跃至多 2 张 WAITING 能量，0/1 张也安全消费 pending，并显式记录 once-per-turn use。
- 016/017 均为无交互 queued pending：单 pending 与手动点选多 pending 时打开 confirm-only 并追加实时条件说明；顺序发动多 pending 时自动连续结算，不逐个弹确认。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录 4 张卡的实现状态、复用模块和 focused tests；222 新增一个窄 shared 起动 workflow，不改变 runner 业务边界。
- 验证：`vitest run tests/unit/card-effect-classification.test.ts tests/integration/direct-mill-top.test.ts tests/integration/s-bp5-016-hanamaru.test.ts tests/integration/s-bp5-017-mari.test.ts` passed（4 files / 22 tests）；`vitest run tests/unit/card-effect-classification.test.ts tests/integration/s-bp5-222-ria.test.ts tests/integration/s-bp5-111-seira.test.ts tests/unit/card-effect-tokens.test.ts tests/unit/card-effect-text-governance.test.ts` passed（5 files / 28 tests）；`git diff --check` passed。

## 本次 2026-07-07 移动端对局 viewport 命中兜底

- 新增 `BattleViewportShell` 与 `battleViewport` helper：本地对局、正式联机、联机调试、玩家视角观战进行中页面统一写入 `--battle-viewport-height` / fraction / offset 变量；移动端 bottom sheet、判定面板、卡牌详情、active effect 与成功 LIVE 选择面板改读同一高度事实。
- 拖拽开始记录 viewport signature；visual viewport / window resize / orientation 变化后清理拖拽提示，drop 前直接拒绝并提示“视口已变化，请重新拖拽”，不提交任何规则命令。`CardDetailPressTarget` 与 `MulliganPanel` 长按计时也会在 viewport 变化时取消并只 suppress 当前 click 流程。
- 开发期诊断：`BattleViewportShell` 在 DEV 下暴露 `window.__lovecaBattleViewport()` 与 `window.__lovecaBattleHitTest(x, y)`，只返回 viewport、DOM 命中栈、几何与层级摘要，不输出卡名/卡图 URL/私有手牌文本。
- 同步修复 `mobile-layout.spec.ts` 中登录页与首页的过期 ready 文案断言，改为等待当前页面 `h1`，避免移动端布局回归被旧入口文案误报。
- 验证：`pnpm exec vitest run tests/unit/battle-viewport.test.ts` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec playwright test client/tests/e2e/mobile-layout.spec.ts --project=mobile-390x844 -g "game-setup|online-room"` passed；`pnpm --dir client exec playwright test client/tests/e2e/mobile-layout.spec.ts --project=mobile-390x844` passed（11/11）；`git diff --check` passed。
- 浏览器 smoke：`pnpm test-env:start --no-db-rebuild` 后在 390x844 移动视口登录 `test_admin`，进入对墙打桌面；确认 shell 高度变量为 844px，`__lovecaBattleHitTest` 可返回命中栈；对手 bottom sheet top 358 / bottom 844，`maxHeight` 692.08px、`minHeight` 438.88px，来自新 viewport fraction 变量。

## 本次 2026-07-06 联机重开后换卡组

- 修复正式联机“请求重开”同意后直接进入开局猜拳、导致无法换卡组的问题：服务端现在封存旧 match 后回到准备阶段，保留双方已锁定卡组但清空开始准备状态。
- 准备页在玩家已锁组时，若选择了另一副合法云端卡组，会显示“更换为这副卡组”，方便重开后或开局前重新锁组；重开协商条与联机提示文案同步为“回到准备页重新锁组或直接准备”。
- 验证：`pnpm exec vitest run tests/integration/online-room-service.test.ts` passed；`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`git diff --check` passed。

## 本次 2026-07-06 主卡组/手牌飞行动画修正

- 修复 `PL!S-sd1-018-SD` 费用 4「黑泽露比」这类“抽 1 张，再将 1 张手牌放置到卡组底”效果的桌面飞行动画表现：卡组顶牌提供真实动画锚点，卡效/成功 LIVE 选择面板不再污染移动锚点，飞行动画层高于卡效面板避免被遮挡，进入主卡组/能量卡组时强制使用牌库区域锚点而不是下一帧对象锚点。
- 补充 `battle-animation-events` 单测覆盖面板锚点忽略、`MAIN_DECK -> HAND` 与 `HAND -> MAIN_DECK` 的 scoped deck anchor 路径，并锁定“下一帧同一张牌存在对象锚点时也不能抢占卡组底终点”；浏览器验证对墙打桌面 1600x900 下己方主卡组锚点、顶牌对象锚点、动画层 z-index 与普通抽牌移动代理出现/清理。
- 验证：`pnpm exec vitest run tests/unit/battle-animation-events.test.ts` passed；`pnpm exec vitest run tests/integration/draw-then-discard.test.ts` passed；`pnpm exec vitest run tests/integration/live-start-discard-gain-blade.test.ts` passed；`pnpm exec vitest run tests/integration/s-future-water-batch1.test.ts` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-07-06 卡效框架文档一致性修正

- 修正卡效框架与审计文档中已过期的 runner fallback / runner orchestration 表述：当前 registry 未命中不再 fallback 旧完整卡效分支，runner 仍只保留 pending、trigger、relay 等胶水。
- 同步 `PL!-sd1-003` 费用 7「南琴梨」、`PL!-sd1-004` 费用 11「园田海未」、`PL!-sd1-007` 费用 7「东条希」、`PL!-sd1-019` 分数 4「START:DASH!!」、`PL!-bp5-007` 费用 13「东条希」等已迁 workflow 的登记、coverage、gap 与 condition inventory 口径。
- 验证：`git diff --check` passed。本窗口仅改文档，未运行测试。

## 本次 2026-07-06 管理员联机房间玩家视角观战入口

- 联机房间监控页在已开始对局的“观战 / 回放”列新增先攻/后攻玩家视角快捷入口，点击后以新标签页打开现有 `/online/spectate/:token` 只读观战页。
- 服务端新增 admin-only 玩家视角观战链接创建路径，复用现有 `PlayerViewState` 脱敏投影；管理员链接与 session 标记为不计入公开观战人数。
- 房间桌面观战信息文案收敛为“公开观战”：顶部房间胶囊保留眼睛图标与公开观战人数，展开面板不再重复显示同一数字，只保留公开观战列表。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/integration/online-room-service.test.ts` passed（1 file / 32 tests）；`pnpm exec vitest run tests/integration/online-route-error-handling.test.ts` passed（1 file / 11 tests）；`pnpm test:run` passed（289 files / 2350 tests，3 performance tests skipped）；`git diff --check` passed。

## 本次 2026-07-05 正式联机玩家视角观战初版

- `草稿需求文档.md` 的玩家视角观战方向合理：以现有 `PlayerViewState` 投影作为隐藏信息边界，观战者只读，先不实现上帝视角。
- 服务端新增玩家视角观战链接与观战 session：参赛玩家只能生成自己 seat 的 PLAYER 视角链接；未登录观战者通过 token 加入，只能读取 snapshot / public-events，不能提交 command / advance / undo；观战快照将 undo 降为 `NONE`。
- 房间视图新增活跃观战者摘要，正式联机桌面新增“复制观战链接”和观战者列表；新增 `/online/spectate/:token` 观战页，复用同一套 `GameBoard`，battle surface 新增 `SPECTATOR_READONLY`。
- 正式联机桌面顶部控件压缩为“房间”胶囊 + 公共日志入口；复制观战链接、观战者列表、请求重开、离开房间收进房间面板，待处理重开请求仍保留独立协商条。
- 修复默认观战昵称/人数虚高：观战页为同一标签页生成稳定 clientId，服务端同一 clientId 重复加入复用原 session；默认“游客 N”按当前活跃观战者分配，过期 session 清理后重新从可用编号开始。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/integration/online-room-service.test.ts` passed（1 file / 32 tests）；`pnpm exec vitest run tests/integration/online-route-error-handling.test.ts tests/unit/battle-surface-capabilities.test.ts tests/unit/game-store-remote-sync.test.ts` passed（3 files / 25 tests）；`git diff --check` passed。

## 本次 2026-07-05 休息室判心统计入口

- 休息室展开浮窗标题栏新增判心统计入口：桌面端显示简版 chip，并支持 hover/focus 或点击统计按钮查看完整统计；移动端点击统计按钮在标题栏下方展开完整统计。
- 统计仅基于当前投影可见的休息室正面卡牌数据推导，不新增规则命令；只统计成员/LIVE 的 `bladeHearts` 彩心、加分判与抽卡标，不计入成员卡自身持有心 `hearts`。
- 新增 `tests/unit/waiting-room-judgment-stats.test.ts` 锁定统计口径，防止成员持有心被误计入休息室判心统计。
- 验证：`pnpm --dir client exec tsc -b` passed；`pnpm test:run` passed（289 files / 2347 tests，3 performance tests skipped）；`git diff --check` passed。

## 本次 2026-07-04 Liella SD2 / PR 剩余卡效补充

- 已实现 `PL!SP-PR-024-PR` 费用 4「平安名すみれ」：自己普通声援时读取本次 `CheerEvent.revealedCardIds`，若公开的自己的卡中存在持有 SCORE 图标的 Liella! LIVE，来源成员获得紫 Heart +1；来源离场、非自己普通声援安全消费 pending 且不记录 turn1。
- 已实现 `PL!SP-sd2-006-SD2` 费用 7「桜小路きな子」：起动 1 回合 1 次，支付 2 张活跃能量并弃 1 手牌后，从休息室回收 1 张 Liella! LIVE；弃手走 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`，费用后重扫目标，刚弃置的 Liella! LIVE 可被选回，无目标时费用保留 no-op。
- 当时两张均以窄单卡 workflow 落地；其中 `PL!SP-sd2-006` 后续已晋升为 `workflows/shared/activated-pay-two-energy-discard-recover-group-live.ts`，`PL!SP-PR-024` 仍由 `workflows/cards/sp-pr-024-sumire.ts` 持有。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录真实卡文形状、workflow 入口与测试入口；本批未新增 shared helper 或 framework 边界。

## 本次 2026-07-04 Liella SD2 modifier 系列补充

- 已实现 `PL!SP-sd2-004-SD2` 费用 11「平安名すみれ」：常时 / CENTER 时来源成员获得 BLADE +4；离场、非 CENTER、memberBelow 不生效。
- 已实现 `PL!SP-sd2-008-SD2` 费用 5「若菜四季」：常时动态检查自己舞台存在 effective cost >=13 的成员时，来源成员获得黄 Heart +1；费用判断沿用 `getMemberEffectiveCost`。
- 已实现 `PL!SP-sd2-020-SD2` 费用 7「鬼塚夏美」：LIVE 开始结算时重查能量 >=7，来源成员和自己舞台上来源以外 1 名 Liella! 成员获得 BLADE +1；单目标自动、多目标选择、无其他 Liella! 目标时部分结算来源 BLADE 并消费 pending。
- 常时两段进入 `domain/rules/live-modifiers.ts` continuous registry，不进队列；020 新增窄 workflow `workflows/cards/sp-sd2-020-natsumi.ts`，runner 仅增加 import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录 3 张 SD2 卡的真实卡文形状、workflow / registry 入口与测试入口；本批未新增 framework 边界。

## 本次 2026-07-04 Liella PR 同文卡效补充

- 已实现 `PL!SP-PR-003-PR` 费用 2「澁谷かのん」、`PL!SP-PR-007-PR` 费用 2「葉月 恋」、`PL!SP-PR-010-PR` 费用 2「若菜四季」：登场时自己能量区 7 张以上则抽 1；能量不足消费 pending no-op。
- 已实现 `PL!SP-PR-009-PR` 费用 9「米女メイ」、`PL!SP-PR-011-PR` 费用 9「鬼塚夏美」、`PL!SP-PR-012-PR` 费用 9「ウィーン・マルガレーテ」：LIVE 开始可弃 1 手牌，获得 BLADE；弃置 LIVE 卡时再抽 1。
- 登场段扩展 shared `member-on-enter-draw.ts` 的能量阈值配置轴；LIVE 开始段新增 shared `live-start-discard-gain-blade.ts`，弃手走 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`，runner 仅新增 import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录 6 张 PR 卡的真实卡文形状、shared workflow 和测试入口；本批未新增更通用 framework 边界。

## 本次 2026-07-02 莲之空 CL1 002 卡效补充

- 已实现 `PL!HS-cl1-002-CL` 费用 5「村野さやか」：登场时可支付 1 张 ACTIVE 能量；如此做时，从自己的休息室将 1 张 DOLLCHESTRA 卡片加入手牌。
- 按 `cards.json` rare_list 仅 CL 窄登记 exact `cardCodes: ['PL!HS-cl1-002-CL']`；不覆盖未知 rarity。
- 新增单卡 workflow `workflows/cards/hs-cl1-002-sayaka.ts`；启动时检查来源仍在己方舞台、ACTIVE 能量与 DOLLCHESTRA 目标，支付后重新扫描目标，目标消失时保留费用并 no-op。
- 复用 `payImmediateEffectCosts` / `recordPayCostAction` 与 `zone-selection` 的 WAITING_ROOM -> HAND 流程；目标用 `unitAliasIs('DOLLCHESTRA')`，成员与 LIVE 均可回收。
- 本卡是 ON_ENTER 且有真实可选支付/选择窗口，不属于 LIVE_START / LIVE_SUCCESS confirm-only 效果。

## 本次 2026-07-02 莲之空 BP6 014 卡效补充

- 已实现 `PL!HS-bp6-014-R` 费用 2「安養寺 姫芽」：手牌来源起动，将本卡从手牌放置入休息室后抽 1，再选择己方舞台「藤島慈」或「大沢瑠璃乃」获得 BLADE +1。
- 通用更新：新增 `CardAbilitySourceZone.HAND`，命令校验和手牌 UI 均按 sourceZone 分流；本卡不是舞台成员来源起动。
- FAQ Q258 已落实：没有合法目标时仍可发动，保留本卡入休息室与抽 1，后续 no-op。
- 新增单卡 workflow `workflows/cards/hs-bp6-014-hime.ts`；弃手成本使用 `discardOneHandCardToWaitingRoomAndEnqueueTriggers`，runner 仅增加 workflow import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、HAND source 与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补 HAND activated source 边界。

## 本次 2026-07-02 莲之空 BP6 008/016 卡效补充

- 已实现 `PL!HS-bp6-008-R/P` 费用 11「桂城 泉」：登场时先将来源成员变为 WAITING，再从休息室回收 1 张分数 4 以下的莲之空 LIVE；无回收目标也保留 WAITING，符合 FAQ Q257。
- 已实现 `PL!HS-bp6-008-R/P` LIVE 开始段：自己的 LIVE 中存在分数 2 以下 LIVE 时将来源成员变为 ACTIVE；无交互 confirm-only 文本追加当前低分 LIVE 数、来源姿态与实际结算结果。
- 已实现 `PL!HS-bp6-016-R` 费用 9「桂城 泉」：起动 1 回合 1 次支付 4 张 ACTIVE 能量，从休息室选择费用 4 以下莲之空成员登场到空成员区，并以 WAITING_ROOM 来源入队 ON_ENTER_STAGE。
- 新增单卡 workflow `workflows/cards/hs-bp6-008-izumi.ts` 与 `workflows/cards/hs-bp6-016-izumi.ts`；本批未新增 shared helper 或扩大 shared 配置轴，runner 仅增加 workflow import/register 胶水。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、复用模块与测试入口；`tests/integration/hs-bp6-008-016-effects.test.ts` 覆盖 008 登场/LIVE_START 与 016 起动支付/筛选/入队登场触发。

## 本次 2026-07-02 莲之空 BP6 015 卡效补充

- 已实现 `PL!HS-bp6-015-R` 费用 4「セラス 柳田 リリエンフェルト」：登场来源明确为手牌以外时抽 2 弃 2；手牌来源或缺少来源 metadata 时消费 pending no-op。
- 新增单卡 workflow `workflows/cards/hs-bp6-015-seras.ts`，复用 `draw-then-discard` shared workflow；弃手继续走 `discardHandCardsToWaitingRoomAndEnqueueTriggers`，手牌不足 2 张时沿用 shared workflow 的实际可弃数量语义。
- 通用更新：普通 ON_ENTER source / EnterStageEvent 路径传播 `metadata.fromZone`，保留既有 relay metadata；runner 未加入 015 专属 gate/predicate/pending 分支。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已记录基础编号、rarity、复用模块与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补 ON_ENTER event metadata 边界说明。

## 本次 2026-07-02 莲之空 BP6 012/013 卡效补充

- 已实现 `PL!HS-bp6-012-R` 费用 2「百生 吟子」：登场时己方主舞台存在其他 Cerise Bouquet 成员才活跃至多 1 张 WAITING 能量；无其他成员或无 WAITING 能量消费 pending no-op。
- 已实现 `PL!HS-bp6-013-R` 费用 15「徒町 小鈴」：登场与 LIVE 开始两段分别登记 abilityId，选择对方舞台原本 BLADE <= 3 且非 DOLLCHESTRA、当前非 WAITING 的成员变为待机状态，并保留成员状态变化触发 wrapper。
- `opponent-wait-target` 仅新增 `confirmNoTargetWithRealtimeText` 小型配置轴，用于本卡 LIVE_START 无目标 no-op 时展示当前对方舞台成员数、合法目标数与实际不会 WAITING 的结果；真实目标选择窗口不额外套 confirm-only。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态、覆盖 rarity、复用模块与测试入口；`docs/card-effect-framework/workflow_module_guide.md` 已补充 shared workflow 配置轴边界。

## 本次 2026-07-02 莲之空 BP6 010/018/025 卡效补充

- 已实现 `PL!HS-bp6-010-R` 费用 4「村野さやか」：LIVE 开始可弃 1 张 DOLLCHESTRA 手牌，抽 1 后选择己方舞台 DOLLCHESTRA 成员费用 +5；弃手/抽牌后无目标保留已发生动作并 no-op。
- 已实现 `PL!HS-bp6-018-N` 费用 7「村野さやか」：舞台到休息室时可弃 1 手牌，选择己方舞台成员获得蓝 Heart +1 与 BLADE +1；弃手使用进休息室触发安全 wrapper。
- 已实现 `PL!HS-bp6-025-L` 分数 4「ツバサ・ラ・リベルテ」：LIVE 开始可弃手给莲之空成员蓝 Heart +1；LIVE 成功在己方舞台 2 名以上时强制从休息室回收 1 张分数 3 以下 LIVE。
- LIVE_SUCCESS 无交互 no-op 分支已按治理规则在 confirm-only 文本追加实时舞台人数、合法目标数与实际不回收结果；有等待室选择窗口时不额外套 confirm-only。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态、覆盖 rarity、复用模块与测试入口；本批未新增 shared helper 或扩大 shared 配置轴。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run tests/unit/card-effect-classification.test.ts tests/integration/hs-bp6-010-018-025-effects.test.ts` passed（2 files / 16 tests）；`git diff --check` passed。

## 本次 2026-07-01 莲之空 BP6 零散卡效补充

- 已实现 `PL!HS-bp6-002-R/P` 费用 9「村野さやか」：常时，自己舞台无其他成员时来源成员获得 BLADE +2，进入 `live-modifiers` continuous registry。
- 已实现 `PL!HS-bp6-009-R` 费用 7「日野下花帆」：LIVE 开始时卡组顶 4 张放置入休息室，实际满 4 张且全为『莲之空』卡时获得 BLADE +1，复用 `mill-top-gain-live-modifier`。
- 已实现 `PL!HS-bp6-028-L` 分数 2「ブルウモーメント」：LIVE 成功且余剩 Heart >=1 时检视顶 2，任意张按顺序回顶，其余入休息室，不消耗余剩 Heart，复用 `arrange-inspected-deck-top`。
- 已实现 `PL!HS-bp6-030-L` 分数 1「Very! Very! COCO夏っ」：LIVE 开始抽 1 弃 1，复用 `draw-then-discard` 与手牌进休息室触发安全 wrapper。
- 文档同步：`docs/card-effect-reuse-audit/existing_module_map.md` 已按基础编号记录完成状态与复用模块；本批仅扩 shared workflow 小型配置轴，未扩 framework/gap 文档。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run tests/unit/card-effect-classification.test.ts tests/unit/live-modifiers.test.ts tests/integration/mill-top-gain-live-modifier.test.ts tests/integration/draw-then-discard.test.ts tests/integration/hs-bp6-028-blue-moment.test.ts` passed（5 files / 133 tests）；`git diff --check` passed。

## 本次 2026-06-30 CloudBase 新卡导入脚本

- 新增 `src/scripts/sync-cards-cloudbase-new.ts`：只从 CloudBase 卡牌集合插入 DB 不存在的新卡，支持 `--dry-run`、`--report`、重复卡号跳过、缺规则字段 source flag、默认 `DRAFT`、正式导入交互确认或 `--yes`。
- 新脚本正式运行必须显式选择 `--upload-images` 或 `--skip-images`；`--upload-images` 会通过 CloudBase 临时下载 URL / HTTPS 下载卡图，使用 `sharp` 生成 `thumb/medium/large` WebP 并上传 MinIO，默认不覆盖已有对象，图片失败默认不插入该卡。
- 风险处理：DB 已存在卡不更新；候选内部或 DB 已有图片 basename 冲突会跳过；`--allow-missing-images` 才允许缺图卡入库并写入 `missingImage` / `imageDownloadFailed` 等 source flag。已确认当前可读取卡牌集合是 `loveca`，`real_card` 不存在；仍需用更完整数据确认图片字段形态和 CloudBase 云存储权限。
- 文档同步：新增 `docs/card-data-sync/cloudbase-new-card-sync.md` 作为 CloudBase 新卡专题说明；`docs/card-data-sync/README.md`、`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md` 已纳入新脚本职责边界与运行要求。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --help` passed；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --cloudbase-limit=5 --dry-run --report=tmp/card-sync/cloudbase-loveca-dry-run.json` passed（5 条均可转换，均因 DB 已存在跳过）；`pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --cloudbase-limit=100 --dry-run --report=tmp/card-sync/cloudbase-loveca-100-dry-run.json` passed（100 条转换无 warning，均因 DB 已存在跳过）。

## 本次 2026-06-29 Loveca Excel Heart 字段同步

- `src/scripts/sync-cards-loveca-excel.ts` 现在会从 Loveca Excel 的 `基本ハート` / `必要ハート` 加载结构化 Heart：`基本ハート` 只写入 MEMBER `hearts`，`必要ハート` 只写入 LIVE `requirements`；`any` / `all` 映射为 `RAINBOW`，字段为空或解析失败时保留数据库现值。
- 该脚本继续同步既有中日文本、真实团体/小队、BLADE Heart、商品与来源字段；仍不插入 Excel-only 卡，不删除 DB-only 卡，不覆盖费用、BLADE、LIVE 分数和 `work_names`。
- 文档同步：`docs/card-data-sync/README.md`、`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md` 已更新 Loveca Excel 同步职责边界。
- 验证：`pnpm exec tsx src/scripts/sync-cards-loveca-excel.ts --dry-run` passed（parse-only，2303 行，2 组重复卡号，2299 个可用卡号）；`pnpm exec tsc --noEmit` passed。

## 接续方式

新窗口建议先读：

1. `AGENTS.md`
2. 本文件 `PROJECT_PROGRESS_TODO.md`

当前分支基线：

- `main` @ `d573c59 优化移动端对局与游戏准备页布局`

当前本地测试页面：

- `http://localhost:5173/`

当前分支：

- `main`

## 本次 2026-06-27 3.4.3 发布准备

- 已将产品版本同步到 `3.4.3`：`VERSION`、根 `package.json`、`client/package.json` 三处一致；`client/dist/version.json` 构建产物显示 `version: 3.4.3`。
- 发布差异基准为 `v3.4.2..HEAD`，主要包含星团 / Aqours / 莲之空新卡效批次、卡牌多语言字段与 Loveca Excel 同步、卡效站位变换 UI、LIVE 结算/触发边界修复；`assets/card` 与 `assets/images` 无 diff。
- 新增 `drizzle/migration-notes/3.4.2-to-3.4.3.md` 记录本次生产迁移注意事项：先备份并执行 `pnpm db:migrate`，再按 `sync-cards-llocg.ts` -> `sync-cards-loveca-excel.ts` 顺序同步卡牌数据，并列出验证 SQL、人工 smoke 和回滚边界；`drizzle/README.md` 已补充迁移说明目录职责。
- 更新 `.agents/skills/prepare-for-release/SKILL.md`：后续发版流程必须检查/编写 migration note，并且无论是否发现 bug 都要产出 release description / release message。
- 验证：`pnpm install --frozen-lockfile` passed；`pnpm --dir client install --frozen-lockfile` passed；`pnpm version:check` passed；`pnpm typecheck:all` passed；`pnpm test:run` passed（189 files / 1562 tests，3 performance tests skipped）；`pnpm build:server` passed；`pnpm --dir client build` passed（保留 chunk size / browserslist 提示）；`git diff --check` passed。
- 风险/待办：本次包含 `drizzle/0005_add_card_multilingual_excel_fields.sql` 数据库迁移，发布时须按 `docs/production-release-runbook.md` 先备份并执行 `pnpm db:migrate`，前后端需同版部署；本次未构建 Android TWA 包、未打/推 `v3.4.3` tag。

## 本次 2026-06-27 卡牌同步文档职责边界整理

- 新增 `docs/card-data-sync/README.md` 作为专题索引，明确 `design.md` 是两个同步脚本职责边界、字段覆盖范围和运行顺序的主文档。
- 更新 `docs/card-data-sync/design.md`：补充 `sync-cards-llocg.ts` 与 `sync-cards-loveca-excel.ts` 的上游来源、核心职责、不负责字段，以及推荐先 llocg 后 Excel 的运行顺序。
- 同步收口 `docs/card-data-sync/requirements.md`、`docs/card-data-sync/llocg-db-requirements.md` 与 `docs/README.md` 的入口和旧字段口径；`sync-cards-loveca-excel.ts` 明确只补强已有卡牌展示/来源字段，不插入 Excel-only 卡，也不覆盖规则字段。
- 验证：`git diff --check docs/card-data-sync docs/README.md PROJECT_PROGRESS_TODO.md` passed。

## 本次 2026-06-26 Loveca Excel 多语言卡牌字段同步

- `cards` 表改为无重复多语言结构：旧 `name` -> `name_cn`、旧 `card_text` -> `card_text_cn`，新增 `name_jp` / `card_text_jp`、`work_names`、`group_names`、`unit_name_raw`、`product_code`、`source_external_id`、`image_source_uri`、`source_flags`；迁移会把旧 `group_name` 拆入 `work_names` 后删除旧列，并释放旧 `name` 带来的 `name_cn NOT NULL`，改由 `name_jp` / `name_cn` 至少一个非空的 check 约束表达。
- 新增迁移 `drizzle/0005_add_card_multilingual_excel_fields.sql` 与 Drizzle snapshot；同步更新 `src/server/db/schema.ts`、卡牌 API create/update/import/export、服务端 card registry、前端 `cardService`、管理页表单/YAML 模式与 E2E mock。运行时仍派生 `card.data.name` / `card.data.cardText` / `card.data.groupName` 供 UI 和规则读取，但 DB 不再存重复列。
- 新增 `src/scripts/sync-cards-loveca-excel.ts`：解析 `docs/card-data-sync/sources/loveca_20260626015115.xlsx`，用 Loveca Excel 优先更新 `name_jp` / `name_cn`、`card_text_jp` / `card_text_cn`、`group_names`、`unit_name_raw` / `unit_name`、收录商品和来源字段；不读取 Excel 官方 `作品名` / `参加ユニット`，归属信息只使用修正后的 `真实团体` / `真实小队`；不覆盖费用、Heart、分数等规则字段；重复标准化卡号跳过并 warning；无 `DATABASE_URL` 时支持 parse-only dry-run。
- 同步调整 `src/scripts/sync-cards-llocg.ts`、`validate-group.ts`、`normalize-group.ts` 以读写新字段结构；文档同步：`docs/card-data-sync/design.md`、`docs/card-data-sync/requirements.md`、`docs/card-data-sync/llocg-vs-xlsx-format-audit-20260626.md` 与卡牌管理字段文档已更新为无重复 schema 口径。
- 前端卡牌信息展示补齐双语：对战卡牌详情浮窗、卡组编辑详情抽屉、卡牌图片 fallback/hover、卡组浏览/侧栏、管理页列表、判定面板与对局记录可见卡摘要均显示或使用中文/日文名称；详情效果区显示中文与日文效果。`ViewFrontCardInfo` 投影直接携带 `nameJp/nameCn/cardTextJp/cardTextCn`，不再暴露单一 `name/text` 字段；前端展示/搜索链路直接读取新字段，不使用旧派生字段做兼容；运行时 `groupName` 与团体筛选改由 `group_names` 派生。
- 验证：`pnpm exec tsc --noEmit` passed；`pnpm exec tsc -p tsconfig.server.json --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/unit/battle-animation-events.test.ts tests/integration/online-command-pipeline.test.ts` passed（79 tests）；`pnpm exec tsx src/scripts/sync-cards-loveca-excel.ts --dry-run` passed（parse-only，2274 行，3 组重复卡号，2268 个可用卡号）；`pnpm exec tsx src/scripts/sync-cards-llocg.ts --dry-run` passed（2285 张转换记录）；`git diff --check` passed。

## 本次 2026-06-24 PR review feedback 处理

- 修复 LIVE 放置阶段选中手牌时，Live 区 “里侧放置” 标签作为普通 flex 子元素把 Live 区容器拉高、影响下方布局的问题；该标签现改为 Live 区右上角绝对定位角标，不参与布局高度计算。
- 修复检视区打开时，手牌右侧抽牌/回顶快捷箭头层级高于检视面板的问题；检视区面板提升到 `z-[60]`，高于桌面普通快捷控件，仍低于动画/反馈/全屏弹窗层。
- 修复连续快速点击手牌右侧“放回顶部”箭头时，组件闭包重复使用旧最右手牌 id，导致第二次命令报“卡牌当前不在手牌”的问题；点击时改为读取 store 最新手牌，并进入 pending 到手牌列表 / match seq 变化后解除，带超时兜底，防止本地重渲染窗口或远程响应延迟期间重复提交。
- 修正卡组与手牌之间的飞行动画尺寸：动画层对 `MAIN_DECK / ENERGY_DECK <-> HAND` 移动使用标准竖卡比例代理 rect，避免手牌扇形旋转/缩放后的 DOM bounding box 让飞行卡片看起来被拉宽或压扁。
- 已处理 `PR_REVIEW_FEEDBACK_DRAFT.md` 中两项建议优先修复问题：`GameBoard` 拖拽开始时预计算并缓存 battle action intents，hover/drop 复用同一批 intents，状态 key 失效时兜底重算；`BattleAnimationLayer` delayed animation timeout 增加 view diff generation 防护，过期 delayed event 不再插入当前动画队列，并清理其尚未播放的移动遮挡。
- 后续补强：`PlayerArea` 普通 droppable 统一禁用检视区来源 hover/drop 高亮，检视区内部排序与右侧目标按钮保持可用；`tests/unit/battle-animation-events.test.ts` 补 DOM `data-object-id` 与投影 public object id 对齐测试。
- PR review 后续修复：检视区 / 解决区拖拽 intent 未命中时补明确错误反馈，避免静默失败；检视区因入场动画暂时隐藏时显示轻量等待提示；`DroppableZone` 仅在需要按拖拽来源禁用时订阅 dnd context，降低普通 drop zone 拖拽重渲染面；动画事件测试补充无 DOM 锚点、检视区新增卡自动滚动与跨 match 不滚动覆盖。
- 非代码确认项保留：仓库本地 skills 是否进入 `skills-lock.json`、联机调试离开房间是否需要服务端离开语义、active effect 初始挂载/重连 fallback、`suppressActiveEffectVisuals` 全局 suppression 设计、`LiveResultAnimation` 文案仍需维护者/产品确认；当前未强行改变这些语义。组件级 React smoke tests 暂因现有 Vitest node 环境无 React DOM 测试栈，记录为后续测试基建事项。
- 验证：`pnpm --dir client exec tsc -b` passed；`pnpm exec vitest run tests/unit/battle-action-executor.test.ts tests/unit/battle-action-feedback.test.ts tests/unit/battle-action-intent.test.ts tests/unit/battle-animation-events.test.ts tests/unit/battle-drag-action.test.ts tests/unit/battle-animation-sequencing.test.ts` passed（当前匹配 5 个测试文件，32 tests）；`git diff --check` passed；`pnpm --dir client build` passed（保留既有 chunk size / browserslist 提示）。

## 本次 2026-06-24 休息室入场动画初版

- 按 `BATTLE_WAITING_ROOM_ENTRY_ANIMATION_DRAFT.md` 初版硬约束实现单张正面 `HAND -> WAITING_ROOM` 专用 `WAITING_ROOM_REVEAL`：事件层只从 `PlayerViewState` diff 判定，不进入规则/卡效 workflow；检视区清理、堆叠/下方卡移动和多张同 diff 仍保留默认移动或既有 `ZONE_PULSE`。
- `BattleAnimationLayer` 新增三段休息室 reveal 动画：飞到休息室上方可读展示点、停留、再缩入小叠牌；遮挡生命周期改为使用 per-event duration，避免 reveal 期间终点休息室提前露出同一对象。reduced-motion 下仍降级为短 pulse。
- 隐藏信息边界同步收口：移动代理只在当前投影 `surface === FRONT` 时携带/使用 `cardCode`、卡名与正面图片；背面对象进入休息室不生成 reveal，也不在动画 alt/imageSrc 泄露正面信息。对手手牌背面区域补 scoped animation anchor，用于对方弃手时提供区域起点，不暴露具体手牌对象。
- 验证：`pnpm exec vitest run tests/unit/battle-animation-events.test.ts` passed；`pnpm --dir client exec tsc -b` passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。Playwright 已登录 5173 测试环境并进入对墙打桌面：桌面普通动效拖 1 张手牌进休息室，截图覆盖 during/after，最终显示己方休息室从 0 到 1；reduced-motion 下同路径最终状态正确；390x844 窄屏可进入主要阶段并截图确认桌面加载。

## 本次 2026-06-23 第四批新卡/补全卡效

- 已完成 `PL!HS-cl1-010-CL` 分数 3「AWOKE」：LIVE 开始时选择自己舞台有效费用 10 以上的『莲之空』成员，LIVE 结束时为止获得 BLADE +2。
- 候选读取 `getMemberEffectiveCost`，可吃 `MEMBER_COST` live modifier；非莲之空、对方成员、有效费用不足成员不进候选。BLADE modifier 以被选择目标成员作为 `sourceCardId`。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-cl1-010-awoke.test.ts`。

## 本次 2026-06-23 第三批新卡/补全卡效

- 已完成 `PL!HS-bp5-022-L` 分数 4「Retrofuture」：LIVE 开始可支付 2 活跃能量；支付后重新扫描己方舞台有效费用 9 以上 EdelNote 条件，满足时选择低费 EdelNote 从休息室登场，或使此 LIVE 紫色必要 Heart -1。
- 登场分支会从等待室选择费用 4 以下 EdelNote 成员并选择空成员区，随后入队本次 `ON_ENTER_STAGE`；无高费 EdelNote 时费用保留并 no-effect，低费候选或空位不足时只提供 requirement 模式。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-bp5-022-retrofuture.test.ts`。

## 本次 2026-06-23 第二批新卡/补全卡效

- 已完成 `PL!HS-pb1-030-L` 分数 7「Edelied」：LIVE 开始时先选择己方舞台 1 名 EdelNote 成员获得 BLADE +2，再选择 1 名与其卡名不同的 EdelNote 成员获得紫 Heart +2。
- 第一段无 EdelNote 目标时 no-target 结算；第二段无不同卡名目标时保留第一段 BLADE，并 no-target 继续结算。第二段目标在确认时重新扫描，同名 EdelNote 不可作为目标。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-pb1-030-edelied.test.ts`。

## 本次 2026-06-23 第一批新卡/补全卡效

- 已完成 `PL!HS-bp6-007-P / R` 费用 15「セラス 柳田 リリエンフェルト」：自动 / 1 回合 1 次，己方 EdelNote 成员登场时，对方自己选择自身舞台 1 名 active 成员变 WAITING；自身登场也触发。非 EdelNote 登场只 no-op，不消耗 turn1。
- 已补全 `PL!-pb1-015-P＋ / R` 费用 11「西木野真姫」一效果：中心位登场 / LIVE 开始时，可将己方 BiBi 成员变 WAITING；费用成功后，对方自己选择自身 active 成员变 WAITING。保留并验证既有二效果：该等待低费对方成员时抽 1。
- 新增窄 helper `workflows/shared/target-player-wait-own-active-member.ts`，只负责“指定玩家选择自己 active 成员变 WAITING”；BiBi 费用、EdelNote 触发检查、turn1 判断仍留在单卡 workflow。
- Focused 验证：`tests/unit/card-effect-classification.test.ts`、`tests/integration/hs-bp6-007-seras.test.ts`、`tests/integration/pb1-015-maki.test.ts`。

## 本次 2026-06-21 正式联机请求重开

- 正式联机房间新增请求式重开流程：进行中对局里玩家可发起“请求重开”，对手可同意/拒绝，发起者可取消，请求会超时或在参与者离开时失效。
- 服务端在 `OnlineRoomService` 保存 `restartRequest` 房间状态；对手同意后先创建新 match，再封存旧 match 为 `ROOM_RESTART_ACCEPTED`，最后把房间指向新 `matchId`，避免原地抹除当前对局。
- 前端 `OnlineRoomPage` 左上角房间操作区现在把“请求重开/取消重开”和“离开房间”放在同一组；有待处理请求时显示协商条，并通过现有房间轮询同步状态。
- 文档同步：`docs/battle-mode-purpose-and-boundaries.md` 已补充正式联机重开边界，明确重开是双方协商的房间级操作，离开房间仍是单方退出；`docs/PROJECT_REQUIREMENTS.md` 与 `game_system_design.md` 已同步高层联机能力口径。
- 验证：`pnpm exec vitest run tests/integration/online-room-service.test.ts tests/integration/online-route-error-handling.test.ts` passed；`pnpm exec tsc --noEmit` passed；`pnpm --dir client exec tsc -b` passed；`git diff --check` passed。

## 本次 2026-06-17 对墙打退出按钮点击命中修复

- 修复对墙打桌面左上角“离开房间”偶发点击无反应：`DebugControl` 顶部透明 fixed 外层原本横跨近全屏且 z-index 高于离开按钮，会在按钮上方区域吃掉点击。
- 修复方式：`DebugControl` 外层改为 `pointer-events-none`，实际控制条保留 `pointer-events-auto`，不改变布局与控制条自身交互。
- 验证：`pnpm --dir client exec tsc -b` passed；Playwright 临时脚本进入对墙打桌面后，左上角按钮上半区/中心/下半区/右侧 `elementFromPoint` 均命中按钮本身，点击按钮左上角内部位置可返回“游戏准备”页。

## 本次 2026-06-15 `ON_MEMBER_STATE_CHANGED` 事件日志消费

- `MemberStateChangedEvent` 现在可携带状态变化来源 `cause`，区分玩家操作、规则处理与卡片效果；普通 `TAP_MEMBER` 会写入 `PLAYER_ACTION`，活跃阶段将待机成员重置为活跃会写入 `RULE_ACTION`，卡效目标选择与自身方向费用会写入 `CARD_EFFECT`。
- `enqueueTriggeredCardEffects(ON_MEMBER_STATE_CHANGED)` 已开始逐类型消费成员状态变化事件：默认取最近事件，卡效结算会显式传入本次新产生的状态变化事件。当前仍不是完整通用 `GameEvent -> trigger matcher`。
- 已完成 `PL!N-bp4-018-N`：自己主要阶段中，此成员自身 `ACTIVE -> WAITING` 时抽 1 弃 1；通过手动 `TAP_MEMBER` 事件验证。
- 已完成 `PL!-pb1-015-P＋ / R`：1 回合 1 次，因自己的卡片效果使对方舞台费用 <= 4 成员 `ACTIVE -> WAITING` 时抽 1；通过 `PL!HS-bp6-004-R` 让对方成员变待机验证 `CARD_EFFECT cause`。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/effect-costs.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 156 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LIVE_START` 事件日志消费

- 已先 `git fetch upstream` 并 fast-forward `effect_refactor_20260615` 到 `upstream/main` 的 `3abcb97`；确认 `6837c82ff3af6b34e4bd552c8d46fdae1fdc3ea4` 已在作者 `main` 中。
- PERFORMANCE 阶段翻开 LIVE 卡并进入 LIVE 开始检查时机前，现在会写入 `LiveStartEvent(ON_LIVE_START)`，记录表演玩家与本次 LIVE 区卡牌 ID 列表。
- `enqueueTriggeredCardEffects(ON_LIVE_START)` 改为优先消费 `eventLog` 中最近的 `LiveStartEvent` / 显式 `liveStartEvents`，并把 `PendingAbilityState.eventIds` 绑定真实 `eventId`；无事件时继续保留旧 synthetic `live-start:turn:player` fallback。
- 回归覆盖 LIVE 卡来源 `PL!HS-bp5-019-L` 分数 6「花结」与舞台成员来源 `PL!HS-bp6-004-R` 费用 13「百生 吟子」：前者确认 LIVE 开始事件包含两张 LIVE 卡，后者确认同源双 LIVE 开始 pending ability 共享本次 `LiveStartEvent.eventId`。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 147 tests passed；同步前基线同套件 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LIVE_SUCCESS` 事件日志消费

- LIVE 结果阶段进入某玩家成功效果窗口时，现在会写入 `LiveSuccessEvent(ON_LIVE_SUCCESS)`，记录成功玩家、本次成功 LIVE 卡列表与当前分数草案；同一玩家同一组成功 LIVE 已写过事件时不会重复写入。
- `enqueueTriggeredCardEffects(ON_LIVE_SUCCESS)` 改为优先消费 `eventLog` 中最近的 `LiveSuccessEvent` / 显式 `liveSuccessEvents`，并把 `PendingAbilityState.eventIds` 绑定真实 `eventId`；无事件时继续保留旧 `liveResults` 推导与 synthetic fallback，兼容直接 `executeCheckTiming` 的测试/旧路径。
- 回归覆盖 `LiveSuccessEvent` 工厂、真实阶段推进中二号玩家成功时的事件写入，以及只依赖 `LiveSuccessEvent`、不依赖 `liveResolution.liveResults` 时同时入队舞台成员来源 `PL!HS-bp6-001` 费用 4「日野下花帆」与 LIVE 卡来源 `PL!HS-cl1-009` 分数 1「水彩世界」。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 149 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_ENTER_STAGE` 事件日志消费

- 普通 `PLAY_MEMBER` 手牌登场现在写入 `EnterStageEvent(fromZone=HAND)`；卡效 `playMembersFromWaitingRoomToEmptySlots` 从休息室登场现在写入 `EnterStageEvent(fromZone=WAITING_ROOM)`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 路径改为优先消费 `eventLog` / 显式 `EnterStageEvent`，并继续保留旧 `PLAY_MEMBER` action-history fallback。
- 默认检查时机只消费最近一次登场事件，避免旧登场历史被后上场的舞台监听 AUTO 误触发；卡效登场会显式传入本次新产生的 `EnterStageEvent` 列表。
- 回归覆盖 `PL!HS-bp6-004-R` 费用 13「百生 吟子」手牌登场、`PL!S-bp2-006-P` 费用 11「津岛善子」从休息室登场后触发 `PL!-sd1-004-SD` 费用 11「南小鸟」登场能力，以及 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」登场段。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 `ON_LEAVE_STAGE` 事件日志消费

- `LeaveStageEvent` 现在可携带 `replacingCardId`；普通舞台成员移动进休息室、换手替换离场、以及 `SEND_SOURCE_MEMBER_TO_WAITING_ROOM` 自送费用都会写入 `GameState.eventLog`。
- `enqueueTriggeredCardEffects` 的 `ON_LEAVE_STAGE` 路径改为优先消费 `eventLog` / 显式 `LeaveStageEvent`，并继续保留旧 `actionHistory` 来源推断作为兼容回退。
- 换手离场与新成员登场的顺序选择窗口改为识别 `replacingCardId` 关系；因此登场事件和离场事件不需要共享同一个 `eventId`，仍会让玩家选择先后。
- 回归覆盖 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」、`PL!HS-bp6-017-N` 费用 11「日野下花帆」与 `PL!HS-sd1-001-SD` 费用 9「日野下花帆」三条离场 AUTO proving path。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` + `tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 146 tests passed；`tests/integration/online-command-pipeline.test.ts` 56 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 成员移动事件消费与 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」

- `enqueueTriggeredCardEffects` 已开始消费 `ON_MEMBER_SLOT_MOVED` eventLog：按事件中的移动成员作为 AUTO 来源、用 `eventId` 写入 `PendingAbilityState.eventIds` 并防重复入队。
- 普通 `MOVE_MEMBER_TO_SLOT` 现在也会写入 `ON_MEMBER_SLOT_MOVED`，并在命令提交时入队/启动对应 AUTO；卡效 helper 的站位变换路径在结算后同样消费新产生的成员移动事件。
- 已完成 `PL!SP-bp4-011-P`（基础编号 `PL!SP-bp4-011`，费用 7「鬼冢冬毬」）：自身登场或成员区槽位移动/交换时，选择对方舞台原本 BLADE <= 3 的成员变为待机；无合法目标时能力仍入队并以 `SKIP_NO_TARGET` 结算。
- 边界：登场只走 `ON_ENTER_STAGE`，不额外当作成员区移动重复触发；当前只消费成员槽位移动事件，完整区域移动/支付/状态变化 trigger matcher 仍后续推进。
- 验证：`tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 134 tests passed；`pnpm exec tsc --noEmit` passed。

## 本次 2026-06-15 事件日志与成员事件底座

- 新增 `GameState.eventLog` / `eventSequence` 与纯函数 `emitGameEvent`，作为后续 AUTO / trigger matcher 的不可变权威事件流；`actionHistory` 继续保留给审计、UI 与既有流程。
- `src/domain/events/game-events.ts` 新增 `ON_MEMBER_STATE_CHANGED` / `ON_MEMBER_SLOT_MOVED` 事件类型与工厂函数；`EventBus` 已标注为非权威运行时工具，不接入规则触发。
- `src/application/effects/member-state.ts` 已在成员待机/活跃、批量方向变更、站位变换/交换成功后写入 `eventLog`。交换会为主动移动成员和被交换成员各记录一条 `ON_MEMBER_SLOT_MOVED`。
- 当前边界：本批第一步只写事件事实；随后已用上方 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」完成成员移动事件消费 proving path。
- 验证：`tests/unit/game-events.test.ts` + `tests/unit/member-state.test.ts` 共 10 tests passed；`tests/unit/card-effect-classification.test.ts` + `tests/integration/sample-card-effect-runner.test.ts` 共 131 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 快速卡效批处理：`PL!HS-pb1-012-R` 费用 13「百生吟子」

- 已完成 `PL!HS-pb1-012-R / P+` 登场效果：自己和对方各自将休息室所有成员卡洗牌放到自身卡组底；若双方因此合计放到底部的卡片大于等于 20 张，则从自己的休息室回收 1 张 LIVE，并通过 `BLADE` live modifier 获得 BLADE +2。
- 规则细节：中文/日文同编号文本一致，按基础编号 `PL!HS-pb1-012` 登记；FAQ 路径已覆盖“没有可回收 LIVE 时仍获得 BLADE”。
- 复用范围：继续沿用 `shuffleZone`、`WAITING_ROOM -> HAND` zone-selection、`addLiveModifier(BLADE)` 与现有登场队列；未新增 resolver / cost calculator / live modifier registry 结构。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖同编号 `R / P+` 基础编号登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖双方合计 20 张且回收 LIVE、合计 20 张但无 LIVE 仍加 BLADE、合计不足 20 时不回收不加 BLADE。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。

## 本次 2026-06-14 低风险同型 LIVE 开始扩样本（基于 `PL!-bp4-010-N`）

- 收束范围：
  - `PL!HS-PR-018-PR` / `PL!HS-PR-018-RM`（基础编号 `PL!HS-PR-018`，费用 4「大泽瑠璃乃」）
  - `PL!HS-cl1-005-CL`（基础编号 `PL!HS-cl1-005`，费用 4「徒町 小鈴」）
  - `PL!N-bp4-013-N`（基础编号 `PL!N-bp4-013`，费用 4「上原步梦」）
  - `PL!S-pb1-016-N`（基础编号 `PL!S-pb1-016`，费用 4「国木田花丸」）
  - `PL!S-pb1-017-N`（基础编号 `PL!S-pb1-017`，费用 4「小原鞠莉」）
  - `PL!S-pb1-018-N`（基础编号 `PL!S-pb1-018`，费用 4「黑泽露比」）
  - `PL!SP-bp1-006-R`（基础编号 `PL!SP-bp1-006`，费用 9「樱小路 希奈子」）
  - `PL!SP-bp2-019-N`（基础编号 `PL!SP-bp2-019`，费用 4「若菜四季」）
  - `PL!SP-bp2-022-N`（基础编号 `PL!SP-bp2-022`，费用 4「鬼冢冬毬」）
- 本窗口实现：
  - 复用现有 `BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID`，保持 `start/finishLiveStartPayEnergyGainFixedBlade`，仅扩展同一能力的 `baseCardCodes` 覆盖范围。
  - 更新测试：`tests/unit/card-effect-classification.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`（新增 `PL!HS-PR-018-RM` 代表卡样例）并保留 `tests/unit/card-effect-rarity-sync.test.ts` 的全量防线。
  - 本窗口文档增量：`docs/card-effect-reuse-audit/existing_module_map.md`（新增 9 条基础编号同型已实现）。
- 下窗口建议：
  - 维持低风险同构策略，优先开新 LIVE 开始样例前验证同基础编号文本一致性。

## 本次 2026-06-14 低风险同型 ON_ENTER 扩样本（基于 `PL!SP-PR-004-PR`）

- 收束范围：
  - `PL!SP-PR-006-PR`（基础编号 `PL!SP-PR-006`，费用 4「平安名堇」）
  - `PL!SP-PR-013-PR`（基础编号 `PL!SP-PR-013`，费用 4「鬼冢冬毬」）
  - `PL!SP-bp1-021-N`（基础编号 `PL!SP-bp1-021`，费用 4「薇恩・玛格丽特」）
  - `PL!SP-sd1-014-SD`（基础编号 `PL!SP-sd1-014`，费用 4「岚 千砂都」）
  - `PL!SP-sd1-016-SD`（基础编号 `PL!SP-sd1-016`，费用 4「叶月 恋」）
- 本窗口实现：
  - 保持 `KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID` 与 `start/finishKekeOnEnterPlaceWaitingEnergy` 复用，仅扩展 `baseCardCodes`。
  - 更新 `tests/unit/card-effect-classification.test.ts`：增加上述 5 个基础编号的 ON_ENTER 注册校验。
  - 更新 `tests/integration/sample-card-effect-runner.test.ts`：新增 `PL!SP-PR-013-PR` 同壳登场 + 弃 1 发动样例。
- 本窗口文档增量：`docs/card-effect-reuse-audit/existing_module_map.md` 新增 5 条基础编号同型已实现记录。

## 本次 2026-06-14 抽弃壳参数化扩展

- 目标：把 `DRAW->DISCARD` 同构壳从“抽X弃1”改造为 `drawCount / discardCount` 可配置，避免下一批同型扩展时继续新增壳。
- 变更：新增 `discardCount` 配置项，`start/finish` helper 改名为 `startDrawThenDiscardCardsEffect` 与 `finishDrawThenDiscardCardsEffect`；支持 `selectedCardIds` 批量弃牌移动（仍兼容现有单卡 `selectedCardId`）。
- 兼容：保留原 `HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID` / `HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID` 导出入口，并补充 `MEMBER_ON_ENTER_DRAW_DISCARD_ABILITY_ID` / `MEMBER_ON_ENTER_DRAW_DISCARD_ONE_ABILITY_ID` 作为泛化命名。
- 校验：`tests/unit/card-effect-classification.test.ts` 与 `tests/integration/sample-card-effect-runner.test.ts` 的覆盖点保持不变（当前仅 1/1 场景）；参数化行为以后可直接扩展。
- 文件：`src/application/card-effect-runner.ts`、`docs/card-effect-reuse-audit/existing_module_map.md`。
- 下一步建议：将 `discardCount >1` 场景补一个参数化回归（含 `selectedCardIds` 路径）验证。

## 本次 2026-06-14 LIVE 合计分数失败结算修复

- 修复 `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」这类 LIVE 合计分数修正的失败结算边界：玩家没有成功 LIVE 时，`SCORE` live modifier 不再让最终分数草案从 0 增加。
- 修复范围覆盖两条读路径：判定阶段自动生成 `playerScores` 草案，以及进入 LIVE 结算阶段时的 `calculateLiveScore` 兜底计算。
- 新增 focused 回归：`tests/unit/live-judgment-settlement.test.ts` 覆盖失败 LIVE + 玩家合计分数修正仍为 0；同步修正 `tests/integration/sample-card-effect-runner.test.ts` 中 `PL!-bp3-014-N` 费用 4「星空 凛」样例的测试局面写回与登场支付前置。

## 本次 2026-06-14 Live 卡 BLADE 心同编号继承修复

- 修复 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」原始数据 `blade_heart` 为空时，判定区不会把同编号 `PL!HS-bp2-022-L` 的 `b_all` 计入 ALL 心的问题。
- 新增 `inheritMissingBladeHeartsByBase` 数据规范化 helper，并接入 `sync-cards-llocg.ts`、服务端 `CardDataRegistry`、`/api/cards` 与 `/api/cards/export`；前端 `cardService` 也在整表缓存入口做同样防御，避免旧 API 列表导致本地判定遗漏。
- 新增 focused 回归：`tests/unit/blade-heart-inheritance.test.ts` 覆盖同编号同类型继承、不覆盖已有 BLADE 心、不跨卡种继承；`tests/unit/heart-live.test.ts` 补充 `HEART + RAINBOW` 声援处理。

## 本次 2026-06-14 `PL!HS-pb1-020-N` 多步骤多选状态修复

- 修复 `PL!HS-pb1-020-N` 费用 9「百生吟子」登场效果中，弃 2 张手牌后进入休息室分组回收步骤时，前一步多选状态被前端沿用，导致不可见旧手牌 id 占满选择数量并卡住效果处理的问题。
- `GameBoard` 现在会在 active effect 的步骤、选择模式或候选卡集合变化时清空 ordered multi selection；确认按钮也会校验所有已选 id 仍属于当前候选，点击候选时会先过滤掉旧候选残留。
- 新增 focused 回归：`tests/integration/sample-card-effect-runner.test.ts` 覆盖弃手进入回收后旧手牌 id 不在新候选中，误传旧选择会被拒绝且效果仍可继续。

## 本次 2026-06-14 处理中的效果窗口折叠 UI

- `GameBoard` 的“处理中的效果”窗口新增“隐藏”按钮，折叠后显示右下角小浮条，保留当前效果来源与步骤摘要，并可用“展开”恢复窗口。
- 折叠只属于前端本地 UI 状态，不改变 `activeEffect`、不写对局 action；当 active effect id 或 stepId 变化时自动展开，避免玩家错过新步骤。

## 本地测试卡组与卡图资产

当前事实：

- 测试卡组 YAML 位于 `assets/decks/`，当前有 `缪预组.yaml`、`绿莲-6弹ver.yaml`、`蓝紫.yaml` 与 `系统边界混合.yaml`；这些 YAML 仍可供预设卡组、对墙打默认对手或后续测试资产参考。
- `绿莲-6弹ver.yaml` 已作为新人推荐卡组与 μ's 预组并列接入前端预设；`pnpm test-env:start` 会创建/提权 `test_admin` 管理员账号，并把该卡组以公开卡组写入管理员名下。
- 首页独立“本地测试对局”入口已于 2026-06-14 移除；后续卡效验证优先使用作者提供的 `pnpm test-env:start` 完整测试环境和云端卡组。
- 卡图下载脚本为 `scripts/download-local-test-card-images.mjs`。脚本已改为自动扫描 `assets/decks/*.yaml` / `*.yml`，不再硬编码两副卡组。
- 当前 `--dry-run --exact-only` 结果：四副测试卡组引用 99 张精确卡图；实际下载、同编号罕度展开与 WebP 别名数量以脚本输出为准。
- 当前测试服务器仍依赖 `assets/images/` 的本地图片 fallback；未明确切换到完整对象存储图片前，不要删除 `assets/images/`。

2026-06-14 临时测试服务器补图记录：

- 作者提供的一键测试环境可用云端卡组测试，但本机没有完整生产卡图对象存储；为了改善本地测试体验，临时从 `/Users/meiyikai/Desktop/文件/个人/codex/loveca/deck` 下的两副外部 YAML 卡组补齐所需卡图到 `assets/card/` 与 `assets/images/{thumb,medium,large}/`。
- `scripts/download-local-test-card-images.mjs` 已补充 `--deck-dir=...`，并默认按同基础编号展开全部罕度。例如 deck 中出现 `PL!HS-pb1-009-R` 时，会同时尝试补 `PL!HS-pb1-009-P+` 等同编号变体。
- 为兼容数据库 `image_filename` 与中文卡图路径的命名差异，脚本会为同一源图生成多个 WebP 别名，例如 `P+` / `P2` / `Pplus`、`L+` / `L2` / `Lplus`。这属于本地显示兼容层，不代表生产文件命名规范。
- 这些临时图片只影响卡图显示，不参与规则引擎、费用计算、卡效触发、对局状态或测试服务器数据库逻辑。卡效开发仍应以卡牌数据和对局行为验证为准。
- 生产环境已有正常图片服务器/对象存储。上线或发正式 PR 前，应重点检查 `assets/card/` 与 `assets/images/` 中由本次补图产生的大量临时文件，不要把它们当作生产资产提交；生产图片链路确认正常后，可以清理这些临时图片，不会影响已实现卡效。

常用命令：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs --dry-run
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs
```

## 当前状态

本地测试桌面已经进入“LIVE 自动判定 + 卡效分类底座”阶段。

## 本次 2026-06-16 condition/query 第二批小收束

- `src/application/effects/conditions.ts` 继续扩展纯函数 query：新增按 cardIds 返回 selector 命中 id、舞台成员存在性、来源以外其他舞台成员等查询。
- 小范围迁移 runner 内联条件/计数：`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」登场相关成员存在条件、`PL!HS-bp6-001` 费用 4「日野下花帆」登场动态舞台成员数、`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」等待室成员与 `みらくらぱーく！` 成员计数、`PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始“其他成员”条件。
- 补 `tests/unit/conditions.test.ts`，覆盖 selector 计数/阈值、区域与成功 LIVE 计数、舞台成员条件、LIVE 区排除来源计数、来源有效 BLADE 阈值查询；文档口径仍保持“第一版 helper 起步”，不提前纳入 frozen baseline。
- 本次仍不改变事件层、不改变 pending 顺序、不改变费用模块；`PL!HS-bp1-003` 常时三面不同名条件位于 `domain/rules/live-modifiers.ts`，为避免 domain 反向依赖 application，本批暂不迁移。

## 本次 2026-06-15 condition/query 第一版

- 新增 `src/application/effects/conditions.ts`，作为第一版纯函数 query/condition 模块；当前只提供区域计数、selector 计数/阈值、成功 LIVE 数、舞台成员数、LIVE 区排除来源卡计数、来源成员有效 BLADE 阈值查询，不做 AST、不做声明式 steps。
- 小范围迁移 runner 内联条件/计数：`PL!-sd1-009-SD` 费用 11「矢泽妮可」、`PL!-sd1-022-SD` 分数 4「僕らは今のなかで」、`PL!HS-bp5-019-L` 分数 6「花结」、`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」、`PL!HS-pb1-009-R` 费用 15「日野下花帆」，并顺手复用到 `PL!-sd1-001-SD` 费用 7「高坂穗乃果」成功 LIVE 条件与 `PL!HS-pb1-020-N` 费用 9「百生吟子」休息室 LIVE 数条件。
- 本次不改变事件层、不改变 pending 顺序、不改变费用模块、不拆 `definitions/index.ts`，只把少量 inline 计数替换为可复用 query 函数。
- 验证：`tests/unit/card-effect-classification.test.ts` 5 tests passed；`tests/integration/sample-card-effect-runner.test.ts` 133 tests passed；`pnpm exec tsc --noEmit` passed；`git diff --check` passed。

## 本次 2026-06-15 卡效定义层拆文件

- `CARD_ABILITY_DEFINITIONS`、卡面效果文本、能力 id 与 definition 类型已从 `src/application/card-effect-runner.ts` 拆到 `src/application/card-effects/` 下。
- `card-effect-runner.ts` 继续保留入队、pending、resolver dispatch、执行流程与步骤解释逻辑；行为预期不变。
- 本次未做声明式 steps 迁移，也未调整费用期间事件消费时机。

目前已完成的核心方向：

- 对局前端已新增可剥离的卡效自动化视觉标记：正面已自动化卡牌在卡顶中间显示约 4px 小点与 1px 圆角外描边，当前正在处理/可发动时变亮；标记只在 `PlayerArea` 等对局组件中通过 `Card.effectVisualState` 传入，不进入卡牌数据库。控制入口为 `client/src/lib/cardEffectAutomationVisuals.ts`，默认开启，可用 `VITE_CARD_EFFECT_VISUAL_MARKERS=false` / `0` / `off` 关闭；后续若全卡效完成后想剥离，删除该 helper、`CardEffectMarker`、`Card.effectVisualState` prop 和 `PlayerArea` 传参即可。
- 活跃阶段规则自动化已补齐：进入某玩家活跃阶段时，`GameService` 的 `UNTAP_ALL` 会将该玩家舞台成员和能量全部恢复为活跃状态；不会同时重置非当前玩家。
- LIVE 判定区会按当前光棒数自动翻推荐应援牌。
- 玩家仍可手动调整判定区，然后选择接受自动判定。
- 接受后系统会生成 Live 成功/失败、抽卡、分数草案，玩家仍保留强制成功/失败等人工修正入口。
- 多首 Live 判定已按规则改为“全部 Live 成功才算整个 Live 成功”；任一 Live 失败时总分为 0。
- Live 失败与 Live 成功但分数为 0 在状态中保持区分。
- 多首 Live 会先合并需求再判定，避免按单首贪心消耗 Heart 导致误判。

## 卡效分类与底座

`src/application/card-effects/definitions/index.ts` 已建立 `CARD_ABILITY_DEFINITIONS` 登记入口。新增卡效前先登记分类，不要直接写单卡散逻辑；`card-effect-runner.ts` 仍负责执行与 resolver dispatch。

2026-06-14 起，连续新增多张卡效时采用“快速卡效批处理模式”：每张卡/每个效果段实时更新 `docs/card-effect-reuse-audit/existing_module_map.md`、focused tests 与本 progress 的短记录；`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档默认不随每张卡更新。若引入新抽象、新模块、新事件边界，或改变 resolver / cost calculator / live modifier registry / 同编号罕度同步机制，则仍需在同一批内同步更新相关文档。若只是复用既有模块追加同构卡效，即使连续做 5-10 张，也先保持主登记册、progress 与测试准确；等用户明确要求“这批收束/提交”时，再做一次批末摘要式收束，避免全文扫描式重写。

当前分类约定：

- `CONTINUOUS`：常时，不进队列，由计算层读取。
- `ON_ENTER`：登场，触发后进入待处理效果队列。
- `ACTIVATED`：起动，由玩家合法时点主动发动。
- `LIVE_START`：LIVE 开始，同一时点多效果必须进 LIVE 开始队列，由玩家选择顺序。
- `LIVE_SUCCESS`：LIVE 成功，只有对应 Live 成功后才能入队。
- `AUTO`：其他自动诱发，后续按具体触发条件入队。

已抽出的通用能力/步骤：

- 手牌放置入休息室作为通用发动代价，当前 N=1 使用 `createDiscardHandToWaitingRoomActivationEffect` / `moveHandCardToWaitingRoomForEffect`。
- UI 文案统一为“请选择要放置入休息室的卡牌”，跳过按钮为“不发动”。
- 检视卡组顶 N 张、选择目标、公开被选牌、加入手牌、其余入休息室已开始共用流程；基础检视/清理/移动原语已落在 `src/application/effects/look-top.ts`。
- “公开并加入手牌”必须先公开被选牌，再由玩家确认后移动。
- 必要 Heart 增减使用 `applyHeartRequirementModifiers`，支持指定颜色、泛用/All、增加和减少。
- “1回合 N 次”作为能力定义通用特征，使用 `perTurnLimit` 登记；通用 `ABILITY_USE` 按 `playerId + abilityId + sourceCardId + turnCount` 记录和校验，限制的是此来源卡实例，不是同名卡或同一玩家同能力总次数。
- 卡效发动费用已开始收口为 `src/application/effects/effect-costs.ts` 中的通用 `EffectCostDefinition` / `payImmediateEffectCosts` / `paySelectedDiscardHandCost` 底座。当前已覆盖弃 1 手牌、支付活跃能量、将来源成员从舞台放置入休息室、将来源成员变为指定方向四类；`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `SET_SOURCE_MEMBER_ORIENTATION` 验证“自身待机作为费用”。
- 区域目标选择/移动已开始收口为 `src/application/effects/zone-selection.ts` 中的 `ZoneCardSelectionConfig` / `createWaitingRoomToHandEffectState` / `moveSelectedCardsFromZone`。当前覆盖 `WAITING_ROOM -> HAND` 单选路径，`001` / `003` / `002` / `005` 的“从休息室加入手牌”已走统一完成逻辑。
- 最小 selector API 已落在 `src/application/effects/card-selectors.ts`，当前提供 `typeIs` / `groupIs` / `unitIs` / `unitAliasIs` / `unitAliasOrTextAliasIs` / `costLte` / `costGte` / `cardNameIs` / `cardNameAliasIs` / `and` / `or` / `not`，`001` / `003` / `002` / `005` 已用组合 selector 表达 LIVE、成员、低费 μ's 等候选条件；`PL!HS-bp6-004-R` 费用 13「百生 吟子」已用 `cardNameIs` 处理弃置「百生吟子」成员判断；`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已用 `unitAliasIs` 识别真实导入数据中的 `unitName=スリーズブーケ`；`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」已用 `cardNameAliasIs` 判断舞台中是否有大泽瑠璃乃/百生吟子/徒町小铃，`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `costGte(9)` 筛选看顶候选。小组名别名当前覆盖 `Cerise Bouquet`/`スリーズブーケ`、`DOLLCHESTRA`、`Mira-Cra Park!`/`みらくらぱーく！`/`みらくらぱーく!`、`EdelNote`；普通小组条件只看 `unitName`，需要“此卡视为某小组”等文本身份时才显式使用 `unitAliasOrTextAliasIs`。成员名别名当前按卡库常见角色覆盖中日名、空白/中点差异与组合卡 `&` 分隔组件，并额外覆盖早期中文误译/异体：`澁谷かのん`/`渋谷かのん`/`涩谷香音`/`涉谷香音`、`大沢瑠璃乃`/`大泽瑠璃乃`/`大泽琉璃乃`、`セラス柳田リリエンフェルト`/`セラス 柳田 リリエンフェルト`/`赛拉丝柳田利林费尔德`/`赛拉丝·柳田·利林费尔德`；严格卡面名才继续使用 `cardNameIs`。
- 舞台成员目标选择 active effect 已由 `src/application/effects/stage-member-target-selection.ts` 起步：按 `targetPlayerId + CardSelector` 生成可选舞台成员，并在确认后调用 `setMemberOrientation`；`PL!HS-bp6-004-R` 费用 13「百生 吟子」对手低费成员待机段已迁入该入口。
- Live 修正已进入 Stage 1D 主写入路径：`domain/rules/live-modifiers.ts` 提供 `addLiveModifier` / `replaceLiveModifier` / `projectLiveModifierCompatibility`，临时修正统一写入 `liveResolution.liveModifiers` 的 `SCORE`、`HEART`、`BLADE`、`REQUIREMENT` modifier；旧的 `playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` 由 `liveModifiers` 投影，仅作为 UI/在线投影兼容层保留。常时修正已整理为 continuous modifier registry，`001` 常时 BLADE 与 `PL!N-pb1-004` 费用 11「朝香果林」未进行成员区位置移动时 BLADE +2 均由 `collectLiveModifiers` 动态收集。
- 状态与站位变换 Stage 1E 已起步：`src/application/effects/member-state.ts` 提供 `setMemberOrientation` / `moveMemberBetweenSlots`，覆盖卡效里的成员待机/活跃基础原语与站位变换。当前 `PL!N-pb1-004-P+` 的站位变换已改为调用 `moveMemberBetweenSlots`；新增 `positionMovedThisTurn` 只记录成员区槽位间移动/交换，登场不计入“移动”。普通规则 TAP_MEMBER、自由拖拽和手动移动仍归规则/桌面流程，不反向塞进 card effects。
- 抽牌 Stage 1F 已对当前 μ's 预组验证集收口：`src/application/effects/draw.ts` 提供 `drawCardsFromMainDeckToHand`，表达卡效步骤中的主卡组顶抽牌到手牌。当前 `007` 的额外抽 1 已迁入该 helper，并覆盖“翻到 Live 抽 1 / 未翻到 Live 不抽”的 focused tests；开局/阶段/LIVE 判定等规则流程抽牌仍归 `GameService`，不由该 helper 接管。F02 已由 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场起步为抽 2 弃 1 壳；F12/刷新语义继续等真实样例。

## 当前已实现/登记的 PL!-sd1 效果要点

- `001`：登场按成功 Live 区条件回收 Live；常时按成功 Live 数增加光棒，已由 `collectLiveModifiers` 动态收集为 `BLADE` modifier。
- `002`：起动，此成员进休息室，从休息室回收成员。
- `003`：登场回收低费 μ's 成员；LIVE 开始可弃 1 手牌并选择粉/黄/紫 Heart，已通过 `addLiveModifier` 写入统一 `HEART` modifier。
- `004`：登场检视顶 5，可选 μ's Live 公开并加入手牌，其余入休息室。
- `005`：起动，此成员进休息室，从休息室回收 Live。
- `006`：登场可公开手牌 Live，与成功 Live 区 Live 交换。
- `007`：登场公开顶 5 入休息室，其中有 Live 则抽 1。Step 8 closure check 已确认 golden 行为稳定；当前看顶/堆墓走 look-top 底座，额外抽 1 走 `drawCardsFromMainDeckToHand`。
- `008`：起动 `[1回合1次][E][E]`，公开/处理卡组顶 10。
- `009`：LIVE 开始，休息室 μ's 达 25 张时分数 +1，已进 LIVE 开始队列，并显示当前张数，已通过 `addLiveModifier` 写入统一 `SCORE` modifier。
- `011` / `012` / `016`：登场可弃 1 手牌；若弃了，检视顶 3，必须选 1 张加入手牌，其余入休息室。
- `015`：登场可弃 1 手牌；检视顶 5，可选成员公开并加入手牌，其余入休息室。
- `019 START:DASH!!`：已实现为 `LIVE_SUCCESS`。Live 成功后进入成功时效果队列，检视顶 3，支持选择任意张并按选择顺序放回卡组顶，其余入休息室。
- `022`：LIVE 开始，根据成功 Live 区数量减少此 Live 必要 Heart，已通过 `replaceLiveModifier` 写入统一 `REQUIREMENT` modifier，并同步兼容投影字段。
- `PL!N-pb1-004-P+`：测试用果林 LIVE 开始效果，公开顶 1，符合条件加入手牌并站位变换。
  - 站位变换当前通过 `member-state.ts` 的 `moveMemberBetweenSlots` 执行，会携带来源槽位下方的能量/成员，并可与目标槽位成员交换。
- `PL!SP-PR-004-PR`：登场可弃 1 手牌；如此做时，从能量卡组顶放置 1 张待机能量到能量区。
  - 当前实现复用 C01 弃手选择步骤，并通过 `src/application/effects/energy.ts` 的 `placeEnergyFromDeckToZone` 明确放置为等待状态。普通能量阶段默认放置为活跃状态的行为不变。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」：左侧登场时抽 2 弃 1；右侧登场时，将最多 2 张待机能量变为活跃；LIVE 开始时可以进行站位变换。
  - 当前实现通过 `requiredSourceSlots: [LEFT/RIGHT]` 做登场来源槽位条件过滤；左侧复用抽牌 helper 与手牌进休息室 helper，右侧通过 `src/application/effects/energy.ts` 的 `setFirstEnergyCardsOrientation` 执行能量方向变更。LIVE 开始段登记为 `LIVE_START` 队列能力，使用可选 slot-selection，并通过 `src/application/effects/member-state.ts` 的 `moveMemberBetweenSlots` 完成站位变换/交换。

## 全量卡池统计结论

已只读参考 `/llocg_db/json/cards_cn.json` 全量 2032 张卡，其中 1381 张有中文效果文本。

高频场景包括：

- 手牌放置入休息室
- 检视自己卡组顶
- 公开并加入手牌
- 加入手牌
- 其余卡片放置入休息室
- 从休息室加入手牌
- 将此成员从舞台放置入休息室
- `[E]` 费用
- LIVE 开始时
- LIVE 成功时
- 分数 +1
- 必要 Heart 增加/减少
- 1 回合 N 次

后续新增卡效时，应优先判断是否属于这些通用场景，先扩底座，再接具体卡号。

## 当前验证

最近已通过：

本次 2026-06-13 μ's 预组休息室回收 Stage 1A 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次未改前端交互，未启动 `5173` 做浏览器验证。

本次 2026-06-13 selector / zone-selection 单测与费用底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 look-top 底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 top-deck-to-waiting-room 底座补齐后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 `019 START:DASH!!` 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次卡效费用底座更新后同样已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次区域选择/移动底座更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 Live 临时修正流水线更新后已通过：

```bash
pnpm test:run tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1D Live modifier 主写入路径更新后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1E member-state / position-change 底座起步后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1F draw 底座收口后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

结果：11 files passed，99 tests passed，server/client TypeScript 均通过。

本次未改前端交互；开发服务器按需打开 `5173` 后，建议优先手测 `PL!-sd1-007-SD`。

本次 2026-06-13 Step 13 / Stage 1H catalog 回扫已完成文档侧收口：

- 用 `loveca_effect_fragments_catalog.json` 回扫当前已登记/实现卡牌，共覆盖当前样例集 19 个 catalog segments。
- 已刷新 `docs/card-effect-reuse-audit/existing_module_map.md`、`module_gap_list.md`、`safe_refactor_plan.md`，标出 Stage 1A-1F 已落地模块、仍 inline 的效果、当时暂缓模块与下一批非 `PL!-sd1` proving candidates。后续 Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」把 AUTO / S08 最小路径起步。
- 本次只改文档，不改业务代码；focused tests 仍为 11 files passed / 99 tests passed，`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!-sd1-022-SD` 必要 Heart 减少 UI 回归修复：

- 根因：后端 `REQUIREMENT` liveModifier 与判定读取链路正常，但前端 `JudgmentPanel` 用 raw `cardId` 查 `requirementModifiers` / `requirementReductions`；投影层字段当前以 `obj_<cardId>` 为 key，导致 022 结算后 UI 仍按原始 `6 ALL` 预览。
- 修复：`JudgmentPanel` 读取必要 Heart 修正时同时兼容 raw `cardId` 与 public object id。
- 新增 focused 回归：`tests/unit/live-judgment-settlement.test.ts` 覆盖 022 结算后进入判定立即使用减少后的必要无色 Heart。
- 验证：022 focused tests 4 passed；整组 focused tests 11 files passed / 100 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

历史浏览器检查：

- `http://localhost:5173/`
- 页面标题正常
- 控制台错误数为 0

本次 2026-06-13 新测试卡组与卡图资产收口：

- 新增 `assets/decks/系统边界混合.yaml`：48 张成员、12 张 LIVE、12 张能量，混合“现有模块非预组扩样本”和“费用/能量/登场/AUTO 等新系统边界”样例。
- 默认本地测试入口已切为 `系统边界混合` vs `缪预组`，`蓝紫.yaml` 保留为非默认测试资产。
- 新增 `scripts/generate-local-test-card-sources.mjs`，从所有 `assets/decks/*.yaml` / `*.yml` 生成 `client/src/lib/localTestCardSources.generated.ts`。
- `scripts/download-local-test-card-images.mjs` 已实际跑通：三套测试卡组共 79 张唯一卡图，本次新增下载 28 张 PNG，79 张均已生成 `thumb/medium/large` WebP。
- 用户已在 `http://localhost:5173/` 初步测试，反馈测试卡组看起来没有问题。
- 验证：`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!SP-PR-004-PR` / E03 能量放置底座起步：

- 新增 `src/application/effects/energy.ts`，提供 `placeEnergyFromDeckToZone`，用于卡效步骤从能量卡组顶放置能量到能量区，并显式指定放置后的活跃/待机状态。
- `PL!SP-PR-004-PR` 已登记为 `ON_ENTER` 队列能力：可弃 1 手牌；若弃牌成功，则从能量卡组顶放置 1 张待机能量。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量放置 helper；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 PR-004 不发动与发动两条路径。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，104 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」右侧 E02 与来源槽位条件起步：

- `CARD_ABILITY_DEFINITIONS` 新增 `requiredSourceSlots`，`PendingAbilityState` 新增 `sourceSlot`。登场触发从 `PLAY_MEMBER.targetSlot` 记录来源槽位；LIVE 开始触发从舞台槽位收集来源槽位。能力入队前统一检查来源槽位条件，避免在单卡 resolver 里硬写右侧判断。
- `src/application/effects/energy.ts` 扩展 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`，用于卡效步骤把能量区指定卡或前 N 张符合方向条件的能量设为目标方向。
- `PL!SP-bp4-008-P` 已登记右侧登场能力：仅在登场到 `RIGHT` 槽位时入队；确认后将最多 2 张待机能量变为活跃。此批当时仅接右侧 E02；后续批次已接左侧 F02，并已在 S05 批次补完 LIVE 开始站位变换。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量方向 helper；`tests/unit/card-effect-classification.test.ts` 覆盖 `requiredSourceSlots` 注册；`tests/integration/sample-card-effect-runner.test.ts` 覆盖右侧触发与中心不触发。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，108 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧 F02 抽弃起步：

- `PL!SP-bp4-008-P` 新增左侧登场能力：仅在登场到 `LEFT` 槽位时入队；处理时先抽 2 张卡，再选择 1 张手牌放置入休息室。
- 新增 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 抽弃壳，组合 `drawCardsFromMainDeckToHand` 与 `moveHandCardToWaitingRoomForEffect`；当前先覆盖抽 N 后弃 1，后续遇到弃 M 张再扩多选。
- focused tests 新增左侧触发路径，并扩展中心登场不触发左/右任一段。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，109 tests passed，server/client TypeScript passed。

本次 2026-06-13 低风险复用扩样本收口：

- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」已完成两段：登场抽 2 张卡后将 1 张手牌放置入休息室，复用 draw helper + hand discard 壳；LIVE 开始可弃 1 手牌，若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色并通过 `addLiveModifier` 写入 `HEART` modifier。无其他成员时只支付费用并结束。
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」已完成起动：自送休息室，从休息室回收 1 张成员卡。复用 effect-costs 自送 + zone-selection/member selector。
- `PL!-bp4-003-P` 费用 2「南琴梨」已完成起动：自送休息室，从休息室回收 1 张 LIVE 卡。复用 effect-costs 自送 + zone-selection/live selector。
- focused tests 已补 `tests/integration/sample-card-effect-runner.test.ts` 与 `tests/unit/card-effect-classification.test.ts` 覆盖。
- 验证：focused 2 files / 28 tests passed；相关 12 files / 112 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-14 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始段补齐：

- 新增 LIVE 开始能力登记：可弃 1 手牌；若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色，LIVE 结束时为止获得 1 个该颜色 Heart。
- 复用 `createDiscardHandToWaitingRoomActivationEffect`、Heart option active effect 与 `addLiveModifier` 主写入路径；未引入新的 UI 特例。
- 新增 focused 覆盖：有其他成员时弃手后可选 Heart 并写入 `liveModifiers`；无其他成员时只支付费用并结束，不写入 Heart modifier。
- 验证：focused 4 files / 94 tests passed。

本次 2026-06-14 `PL!HS-bp1-004-P` 费用 15「夕雾缀理」两段补齐：

- 起动段登记为 `ACTIVATED` / `STAGE_MEMBER` / 每回合 1 次：支付 3 张活跃能量，从自己的休息室选择 1 张『莲之空』LIVE 卡加入手牌。
- LIVE 开始段登记为 `LIVE_START` / `STAGE_MEMBER`：可支付 1 张活跃能量；LIVE 结束时为止，按自己的 LIVE 区卡牌数量获得 BLADE。
- 复用 `perTurnLimit`、`payImmediateEffectCosts(TAP_ACTIVE_ENERGY)`、`zone-selection`、`groupIs('莲之空')` / `groupIs('蓮ノ空')`、`addLiveModifier`；未新增 UI 特例。
- 新增 focused 覆盖：无合法目标时起动不支付也不占次数；起动支付 3 能量只筛选莲之空 LIVE 并验证每来源卡每回合 1 次；LIVE 开始支付 1 能量后按 LIVE 区 2 张写入 BLADE +2。
- 验证：focused 4 files / 105 tests passed。

本次 2026-06-14 `PL!HS-bp1-010-N` 到 `PL!N-sd1-022-SD` 登场抽1弃1同形批次：

- `src/application/card-effect-runner.ts` 新增 `HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID`，复用既有 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect`；将 `baseCardCodes` 覆盖到 9 个基础编号（`PL!HS-bp1-010` / `PL!HS-bp1-014` / `PL!HS-bp6-020` / `PL!N-bp1-014` / `PL!N-bp1-015` / `PL!N-bp1-019` / `PL!N-sd1-013` / `PL!N-sd1-021` / `PL!N-sd1-022`）。
- `tests/unit/card-effect-classification.test.ts` 增加 9 个基础编号 on-enter 登场抽1弃1能力分类断言，确保各基础编号都可命中新 ability。
- `tests/integration/sample-card-effect-runner.test.ts` 增加 `PL!HS-bp1-010-N` 代表卡 on-enter 抽1弃1落地验证。
- `docs/card-effect-reuse-audit/existing_module_map.md` 更新 `PL!HS-bp1-006` 及其同型批次登记。

本次 2026-06-14 同编号罕度同步与卡效登记册重整：

- `CardAbilityDefinition` 新增 `baseCardCodes`，`getCardAbilityDefinitions` 统一支持 exact `cardCodes` 与基础编号匹配；`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!SP-bp4-008` 费用 13「若菜四季」等已同步同编号多罕度。
- resolver / generic look-top 参数判断 / continuous live modifier registry / cost calculator 已改用基础编号判断；`PL!-bp4-003` 费用 2「南琴梨」的 `P/R` 不再分散为两套起动登记。
- 新增 `tests/unit/card-effect-rarity-sync.test.ts`，从 `llocg_db/json/cards_cn.json` 扫描同基础编号族群，防止后续 exact `cardCodes` 漏同步其他罕度。
- `docs/card-effect-reuse-audit/existing_module_map.md` 已重写为按基础编号的卡效完成状态登记册；模块覆盖拆到 `effect_module_coverage.md`，同构批量扩样本拆到 `card_effect_batch_expansions.md`。
- 当前已验证：`tests/unit/card-code.test.ts`、`tests/unit/card-effect-classification.test.ts`、`tests/unit/card-effect-rarity-sync.test.ts`、`tests/unit/cost-calculator.test.ts`、`tests/unit/stage-member-target-selection.test.ts`、`tests/unit/card-selectors.test.ts`、`tests/integration/member-cost-payment.test.ts`、`tests/integration/sample-card-effect-runner.test.ts` 共 8 files / 163 tests passed。

本次 2026-06-13 低风险同构扩样本收口：

- `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」：登场段已完成，复用 `zone-selection + card-selectors`（从休息室回收 1 张成员入手）；LIVE 开始段已完成，可弃合计 3 张指定姓名手牌并通过 `addLiveModifier(SCORE)` 获得 LIVE 合计分数 +3。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶3选1入手）。
- `PL!-bp3-010-N` 费用 9「高坂穗乃果」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶5公开可选1张 LIVE 入手）。
- `PL!HS-bp2-002-P` 费用 13「村野沙耶香」：登场段已完成，复用 `zone-selection + card-selectors`（休息室最多2张费用≤2成员入手）。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」、`PL!HS-bp2-002-P` 费用 13「村野沙耶香」的未做段：分别为 live-only 段，均明确记录为后续分批。
- focused tests 已补：
  - `tests/integration/sample-card-effect-runner.test.ts`
  - `tests/unit/card-effect-classification.test.ts`
- 验证：`tests/unit/card-effect-classification.test.ts` 与 `tests/integration/sample-card-effect-runner.test.ts` 已通过；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 已通过。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始 S05 站位变换收口：

- 新增 `SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID`，登记为 `LIVE_START` / `STAGE_MEMBER` / `ON_LIVE_START` 队列能力。
- 新增通用 `startMemberPositionChangeEffect` / `finishMemberPositionChangeEffect` 壳，四季 LIVE 开始段使用可选站位变换；不选择槽位时可跳过，选择槽位时复用 `moveMemberBetweenSlots`，支持空槽移动与成员交换。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖四季 LIVE 开始能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 开始触发、可选 slot-selection、从中间移动到右侧并与右侧成员交换。
- 验证：focused 2 files / 33 tests passed；相关完整验证 12 files / 117 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」X11 费用修正底座起步：

- `src/domain/rules/cost-calculator.ts` 新增登场费用修正明细：保留印刷基础费用、修正后费用、修正来源与合计减费，再与换手减免一起生成支付方案。
- `GameSession.preparePlayMemberCostPayment` 现在向 `costCalculator` 传入正在登场的来源卡 ID、当前手牌列表与舞台成员状态，普通登场仍自动扣费；支付说明会显示基础费用、费用减少、换手减免与最终支付。
- `LL-bp2-001-R+` 已完成手牌中的常时费用减少段：此卡以外的其他手牌每有 1 张，登场费用减少 1；此卡本身不计入数量，手牌只有此卡时仍是 20 费，最低可降到 0 费。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中的常时费用减少段：只要自己的舞台存在待机状态的『虹咲』成员，登场费用减少 2；活跃虹咲成员或待机非虹咲成员均不会触发减费。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已完成舞台来源常时费用减少段：手牌中费用 10 的『Liella!』成员登场费用减少 2；换手登场时先应用此费用修正，再计算换手减免。当前本地 `系统边界混合` 测试卡组缺少合适的 10 费 Liella! 目标，先以构造数据 focused tests 固定规则路径。
- 同卡其他段已在 2026-06-14 补齐：`此成员无法因换手放置入休息室` 由费用方案与实际登场 action 层拦截；LIVE 开始可弃任意张指定姓名手牌，并按弃置张数通过 `addLiveModifier(BLADE)` 获得 BLADE。
- focused tests 已补：
  - `tests/unit/cost-calculator.test.ts` 覆盖三人卡不计自身、按其他手牌减费、最低 0 费、与换手减免叠加；艾玛无待机虹咲成员不减费、有待机虹咲成员减 2；千砂都只对 10 费 Liella! 成员减 2，非 10 费或非 Liella! 不误伤，并验证先减费再换手。
  - `tests/integration/member-cost-payment.test.ts` 覆盖真实 `PLAY_MEMBER_TO_SLOT` 路径中三人卡 20 费按 17 张其他手牌降为 3 费并自动扣费；艾玛在舞台待机虹咲成员条件满足时可自动按减后费用登场；千砂都作为目标槽位换手来源时仍能先修正 10 费 Liella! 成员费用再自动扣费。
- 验证：focused cost tests 2 files / 30 tests passed；相关完整验证 14 files / 147 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始段与 `PL!S-bp2-006-P` 费用 11「津岛善子」S07 卡效登场起步：

- `src/application/effects/member-state.ts` 新增批量成员方向 helper `setMembersOrientation`，以及 `playMembersFromWaitingRoomToEmptySlots` 卡效登场原语。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已补完 LIVE 开始段：中心位来源进入 LIVE 开始队列，确认后将自己舞台上全部 Liella! 成员与全部能量变为活跃状态；非 Liella! 成员不受影响。
- `PL!S-bp2-006-P` 费用 11「津岛善子」已完成登场段：可以支付 4 张活跃能量，从休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。
- 当前 S07 边界：卡效登场只进入空槽，不走普通登场费用、不计算换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 S07 移动原语。
- focused tests 已补：
  - `tests/unit/member-state.test.ts` 覆盖批量设置成员方向、从休息室登场到空槽。
  - `tests/unit/card-effect-classification.test.ts` 覆盖千砂都 LIVE 开始与善子登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖千砂都批量活跃 Liella! 成员/能量、善子支付 4 能量后从休息室登场 2 名成员，以及 `PL!-sd1-003-SD` 费用 13「南 ことり」被效果登场后继续触发自己的登场能力。
- 验证：focused 3 files / 41 tests passed；相关完整验证 14 files / 152 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场段收口：

- 新增 `EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID`，登记为 `ON_ENTER` / `PLAYED_MEMBER` / `ON_ENTER_STAGE` 队列能力。
- 登场段先通过 `selectableOptions` 选择“成员”或“能量”分支；进入后续选择步骤时会清空旧选项按钮，避免重复点击旧分支。
- 成员分支选择 1 名待机舞台成员并复用 `setMembersOrientation(..., ACTIVE)`；能量分支不要求玩家选择具体能量卡，而是按能量区顺序自动取至多 2 张待机能量并复用 `setEnergyOrientation(..., ACTIVE)`。普通登场费用、换手与能量支付路径保持不变。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖艾玛登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场后选择待机成员变活跃，以及选择能量分支后自动将由登场支付横置的 2 张能量变活跃。
- 验证：focused 4 files / 47 tests passed；能量分支免手选修正 focused 3 files / 42 tests passed；修正后相关完整验证 14 files / 154 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」AUTO proving 收口：

- 新增 `HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- `enqueueTriggeredCardEffects` 新增 `ON_LEAVE_STAGE` 入队路径；2026-06-15 起优先消费 `eventLog` 中的 `LeaveStageEvent`，仍兼容最近 `PLAY_MEMBER` 替换来源、`MOVE_CARD` 从成员区到休息室来源等旧 action-history 回退。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」解析复用 look-top：检视顶 5，选择成员后先公开，确认后该成员入手，其余检视牌进休息室。
- 待处理效果顺序选择从“同一 timingId”扩为“同一 controller 且同 timingId、共享 eventId，或换手离场 `replacingCardId` 指向新登场成员”。因此当 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」被普通登场换手替换时，其离场 AUTO 与新登场成员的登场能力会进入同一个顺序选择窗口，由玩家选择先后。
- 当前仍不是完整 `GameEvent -> trigger matcher` 层；`S08` 只先覆盖舞台成员进入休息室的 proving 路径。更多移动事件、状态变化、每回合限制、when-if 等 AUTO 边界后续继续扩。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 AUTO 能力登记与队列 metadata。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖从舞台移动到休息室触发 AUTO、公开并入手 1 张成员、其余进休息室，以及被换手替换时与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场能力同窗排序。
- 验证：focused 2 files / 40 tests passed；相关完整验证 14 files / 156 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-bp6-017-N` 费用 11「日野下花帆」AUTO proving 收口：

- 新增 `HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- 继续复用 `ON_LEAVE_STAGE` 离场 AUTO 入队路径；2026-06-15 起主流程优先从 `eventLog` 的 `LeaveStageEvent` 转换离场来源，并兼容 action-history / explicit-source。
- 效果流程复用现有弃手费用与 `WAITING_ROOM -> HAND` 移动原语：离场后可选择 1 张手牌放置入休息室；如此做时，从休息室选择 LIVE 卡和成员卡至多各 1 张加入手牌。来源成员自身已进入休息室，因此也会成为合法成员候选。
- 新增 grouped recovery 校验：多选最多 2 张，但 LIVE 不超过 1 张、成员不超过 1 张；尝试选择两张 LIVE 会被权威层拒绝。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖第二张离场 AUTO 能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖离场触发、跳过弃手、弃手后回收 LIVE/成员各 1 张，以及同类双选被拒绝。
- 验证：focused 2 files / 42 tests passed；相关完整验证 14 files / 158 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO proving 收口：

- 新增 `HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_ENTER_STAGE` 队列能力，`requiredSourceSlots: [CENTER]`，`perTurnLimit: 2`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 现在同时支持登场者自己的 `ON_ENTER` 能力与舞台成员监听登场事件的 AUTO；2026-06-15 起主流程优先消费 `eventLog` / 显式 `EnterStageEvent`，仍兼容最近 `PLAY_MEMBER` action fallback。
- “1回合 N 次”限制改为通用实例级底座：`ABILITY_USE` 按来源卡实例计数；同步修正 `PL!-sd1-008-SD` 费用未登记「小泉 花陽」的旧行为，同一实例本回合第二次会被拒绝，另一张同名实例可以发动。
- 效果段写入 `liveResolution.liveModifiers` 的 `BLADE` modifier：己方「莲之空」成员登场至自己舞台时，来源为中央的此成员获得 BLADE +2。FAQ 覆盖“此成员自己登场到中央也会触发”。
- 同卡第二段登记为 `LIVE_START` / `STAGE_MEMBER` 队列能力：LIVE 开始时统计此成员有效 BLADE，若大于等于 8，则复用 F02 抽 2 弃 1 流程。
- `domain/rules/live-modifiers.ts` 新增 `getMemberEffectiveBladeCount`：以印刷 BLADE 加上同 `playerId + sourceCardId` 的 BLADE modifier 统计成员当前有效 BLADE；非成员或找不到来源时返回 0。
- 新增通用 confirm-only active effect：玩家从顺序选择窗口手动点选无输入 pending ability 时，先显示来源卡、效果文本与“继续处理”按钮；点击后才真正 resolve。`PL!HS-pb1-009-R` 费用 15「日野下花帆」第一段已接入该壳；“顺序发动”仍按队列自动处理，不逐个弹确认。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO 登记、中心位与每回合 2 次限制。
  - `tests/unit/live-modifiers.test.ts` 覆盖成员有效 BLADE 只统计同玩家、同来源成员的 BLADE modifier。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖自己登场触发、非「莲之空」不触发、同一来源实例每回合只触发 2 次、`PL!-sd1-008-SD` 费用未登记「小泉 花陽」同名不同实例可分别发动，LIVE 开始 BLADE 阈值未满足时跳过、满足时抽 2 弃 1，以及手动点选无输入 AUTO 先进入 confirm-only、顺序发动不弹 confirm-only。
- 验证：第一段 focused 2 files / 44 tests passed；第二段 focused 3 files / 49 tests passed；confirm-only 后 focused 3 files / 51 tests passed；相关完整验证 14 files / 165 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `PL!HS-bp6-004-R` 费用 13「百生 吟子」组合效果 proving 收口：

- 新增三条能力登记：
  - 登场段 `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：对方舞台费用小于等于 9 的 1 名成员变为待机状态。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：同一对手低费成员待机效果。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID`：可弃 1 张手牌，LIVE 结束时为止获得 BLADE；若弃置的是姓名归一化后为「百生吟子」的成员卡，则共获得 BLADE +2。
- 顺序选择窗口补通用同源多能力区分：同一窗口若存在重复 `sourceCardId`，不再用卡图 ID 选择，而切到 `selectableOptions` 展示具体效果文本；不同来源卡的普通队列仍保持卡图选择。
- 新增舞台成员目标 helper：按 `playerId + predicate` 扫描成员区槽位，供对手目标/费用筛选复用；实际方向变更继续调用 `member-state.ts` 的 `setMemberOrientation`。
- 该舞台成员目标 helper 已从 runner 下沉到 `src/application/effects/stage-targets.ts`，并改为接收 `card-selectors.ts` 的组合 selector；舞台成员单选并改方向的 active effect 已继续抽为 `src/application/effects/stage-member-target-selection.ts`；弃置「百生吟子」判断也改为复用 `cardNameIs`。
- 弃手加 BLADE 段复用现有可选弃手 active effect 与 `moveHandCardToWaitingRoomForEffect`，并通过 `addLiveModifier` 写入 BLADE modifier。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-bp6-004-R` 费用 13「百生 吟子」三条能力登记。
  - `tests/unit/stage-member-target-selection.test.ts` 覆盖舞台成员目标 active effect 的候选生成、无目标结果与方向结算。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场时只能选择对方费用小于等于 9 的成员、同一张来源卡两条 LIVE 开始能力使用 option 区分、弃置同名「百生吟子」成员获得 BLADE +2。
- 验证：stage member target selection 抽取后 focused 4 files / 58 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」LIVE 卡来源 modifier 扩样本：

- `PL!HS-bp5-019-L` 分数 6「花结」已登记为 LIVE 卡来源的 `LIVE_START` 队列能力：LIVE 开始时按自己的 LIVE 卡区中此卡以外的「莲之空」卡数量，每张使此卡必要绿色 Heart 减少 2 个。
- `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已按基础编号 `PL!HS-bp2-022` 覆盖 `L / L+`：LIVE 开始时若自己的休息室存在大于等于 3 张『Cerise Bouquet』LIVE 卡，则此卡分数 +1。
- 两张卡都复用现有 LIVE 开始队列、confirm active effect 与 `liveModifiers` 主写入路径；`花结` 使用 `replaceLiveModifier(REQUIREMENT)` 写入绿色必要 Heart 修正，`アオクハルカ` 使用带 `liveCardId` 的 `addLiveModifier(SCORE)` 写入“此 Live 卡分数 +1”修正。
- 手测反馈修正：本地导入数据中 `Cerise Bouquet` / `スリーズブーケ` 是 `unitName`，而不是 `groupName`；已为 `card-selectors.ts` 增加 `unitIs`、`unitAliasIs` 与 `unitAliasOrTextAliasIs`，并让 `アオクハルカ` 的休息室 LIVE 计数通过 `unitAliasIs('Cerise Bouquet')` 识别 `unitName=スリーズブーケ`。默认小组条件只看 `unitName`；“此卡视为……”等文本身份保留给显式的 `unitAliasOrTextAliasIs`。
- 判定窗口修正：`SCORE` modifier 现在区分不带 `liveCardId` 的“LIVE 合计分数 +1”和带 `liveCardId` 的“此 Live 卡分数 +1”。`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」的 +1 会同时体现在“Live 卡判定结果”单卡分数与“接受后预计结果”；`PL!-sd1-009-SD` 费用 11「矢泽妮可」这类合计分数修正仍只进入预计结果的“卡牌效果 +1”。
- 新增 focused 覆盖：
  - `tests/unit/card-effect-classification.test.ts` 覆盖两张 LIVE 卡能力登记与 `PL!HS-bp2-022-L+` 半角 `+` 归一化匹配。
  - `tests/unit/card-selectors.test.ts` 覆盖 `unitIs` 对 `unitName=スリーズブーケ` 的小队识别、`unitAliasIs` 的英日别名匹配，以及 `unitAliasOrTextAliasIs` 与纯 `unitAliasIs` 的文本身份边界。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 卡来源入队、确认后写入绿色 `REQUIREMENT` modifier、休息室 3 张 `unitName=スリーズブーケ` LIVE 条件满足后写入 `SCORE` modifier。
- 2026-06-14 追加验证：`tests/unit/live-modifiers.test.ts` 覆盖合计分数与此 Live 卡分数 target 分离；`tests/unit/live-judgment-settlement.test.ts` 覆盖此 Live 卡分数修正不会被合计分数重复计算；`tests/unit/player-view-state.test.ts` 覆盖 `liveCardScoreModifiers` 投影。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-code.test.ts tests/unit/card-selectors.test.ts tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/unit/live-modifiers.test.ts tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts`，7 files / 159 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-pb1-004-R` 费用 4「百生吟子」与 `PL!HS-PR-019-RM` 费用 2「百生吟子」登场效果扩样本：

- `PL!HS-pb1-004-R` 费用 4「百生吟子」已按基础编号 `PL!HS-pb1-004` 覆盖 `R / P+`：登场可支付 1 能量并弃 1 手牌，堆顶 3 入休息室后，从休息室回收 1 张 Cerise Bouquet LIVE。
- `PL!HS-PR-019-RM` 费用 2「百生吟子」已按基础编号 `PL!HS-PR-019` 覆盖 `PR / RM`：登场公开检视卡组顶 3 张，点击继续处理后放置入休息室；若均为持有绿色 Heart 的成员，则 LIVE 结束前获得绿色 Heart；PR/RM 中文措辞不同但实际效果相同。
- 角色名归一化额外加入早期中文误译/异体：`澁谷かのん = 渋谷かのん = 涩谷香音 = 涉谷香音`、`大沢瑠璃乃 = 大泽瑠璃乃 = 大泽琉璃乃`、`セラス柳田リリエンフェルト = セラス 柳田 リリエンフェルト = 赛拉丝柳田利林费尔德 = 赛拉丝·柳田·利林费尔德`。
- 本批已在收束时同步 `existing_module_map.md`、`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档；后续继续维持“每张实时登记、5-10 张或批末统一收束设计文档”的节奏。
- 最终验证：focused suite 12 files / 210 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-bp5-001-SEC` / `PL!HS-bp1-003-SEC` / `PL!HS-bp1-002-RM`：

- `PL!HS-bp5-001-SEC` 费用 11「日野下花帆」已按基础编号 `PL!HS-bp5-001` 覆盖 `AR / P / R+ / SEC`：登场公开检视卡组顶 4 张，点击继续处理后放置入休息室；其中存在 LIVE 卡时，通过 `addLiveModifier(BLADE)` 获得 BLADE +2。起动 `[1回合1次][E][E]` 公开 1 张手牌 LIVE，并从休息室回收 1 张同名 LIVE。
  - 修正：该段不再静默堆墓，已与 `PL!-sd1-007-SD` / `PL!HS-PR-019` 的公开检视 -> 继续处理流程对齐。
  - 起动段：以 bespoke C07 手札公开步骤衔接 `WAITING_ROOM -> HAND`，未抽新公开手牌模块；公开的手牌 LIVE 保留在手牌，休息室候选按公开卡卡名过滤。
  - 投影隐私修正：`activeEffect.selectableCardVisibility = AWAITING_PLAYER_ONLY` 已用于公开手牌、弃手、私有检视区选择等隐藏区候选；投影层同时按候选牌是否正面可见兜底，非等待玩家不再看到隐藏候选区占位数量。已补 `tests/unit/player-view-state.test.ts` 覆盖私有候选、漏标兜底与公开候选三种路径。
  - 公开确认窗口：起动段现在在选择手牌 LIVE 后进入 `HS_BP5_001_REVEAL_HAND_LIVE`，通过 `activeEffect.revealedCardIds` / `revealedObjectIds` 向双方正面展示公开卡，点击“继续处理”后再进入休息室同名 LIVE 选择。
- `PL!HS-bp1-003-SEC` 费用 13「乙宗梢」已按基础编号 `PL!HS-bp1-003` 覆盖 `P / P+ / R+ / SEC`：起动 `[1回合1次][E]` 从休息室回收 1 张费用小于等于 4 的「莲之空」成员；常时三面均有不同名「莲之空」成员时，LIVE 合计分数 +1。常时段由 `collectLiveModifiers` 动态收集为不带 `liveCardId` 的 `SCORE` modifier，判定窗口已改为通用投影玩家 LIVE 合计分数修正。
- `PL!HS-bp1-002-RM` 费用 11「村野沙耶香」已按基础编号 `PL!HS-bp1-002` 覆盖 `P / R / RM`：支付 2 能量并自送，从休息室将 1 张费用小于等于 15 的「莲之空」成员登场至原区域；`P/R` 的“所在的区域”与 `RM` 的“曾存在的区域”当前按等价规则行为同步。此段复用 `TAP_ACTIVE_ENERGY`、`SEND_SOURCE_MEMBER_TO_WAITING_ROOM` 与 `playMembersFromWaitingRoomToEmptySlots`，并继续触发被登场成员的登场能力。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：`PL!HS-bp5-001` 公开检视窗口修正后复跑 focused 3 files / 109 tests passed；相关模块套件 13 files / 202 tests passed；server TypeScript passed；`git diff --check` passed。起动段追加后已复跑 focused 3 files / 110 tests passed；相关模块套件 13 files / 203 tests passed；server TypeScript passed；`git diff --check` passed。
隐私投影修正后已复跑 `tests/unit/player-view-state.test.ts` 20 tests passed；相关模块套件 14 files / 223 tests passed；server TypeScript passed；client TypeScript passed；`git diff --check` passed。
公开确认窗口追加后已复跑 focused 4 files / 131 tests passed；相关模块套件 14 files / 224 tests passed；server TypeScript passed；client TypeScript passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-sd1-001-SD` / `PL!HS-pb1-020-N`：

- `PL!HS-sd1-001-SD` 费用 9「日野下花帆」已完成离场 AUTO：此成员被费用大于等于 10 的「莲之空」成员换手放置入休息室时，将 2 张能量变为活跃。
  - 为 relay 来源条件补了薄元数据：`OnLeaveStageAbilitySource.replacingCardId` 与 `PendingAbilityState.metadata.replacingCardId`，从 `PLAY_MEMBER` 的 `isRelay/replacedCardId/cardId` 记录判断换上成员。
  - 入队阶段先校验换上成员为成员卡、莲之空、费用 >= 10，普通离场或低费换手不会排入该能力。
  - 交互优化：当含登场效果的费用 >= 10「莲之空」成员换手登场并与此离场 AUTO 同时进入顺序选择窗口时，手动点选 `PL!HS-sd1-001-SD` 会先进入 confirm-only 无输入确认壳，点击“继续处理”后才活跃能量并继续处理登场效果；点“顺序发动”时仍自动连续处理，不弹确认壳。
- `PL!HS-pb1-020-N` 费用 9「百生吟子」已完成登场段：自己的休息室 LIVE >= 3 时，可弃 2 手牌；如此做时从休息室回收 1 张 Cerise Bouquet 成员与 1 张「莲之空」LIVE。
  - 复用 `paySelectedDiscardHandCost` 与 `WAITING_ROOM -> HAND`，弃 2 手牌候选对非等待玩家隐藏。
  - 休息室回收使用 `ORDERED_MULTI` 分组校验，两个分组都有目标时必须各选 1；若某分组无目标，则按可用分组数继续。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因 relay 来源元数据扩展，已同步 `docs/card-effect-framework/card_effect_framework_design.md` 的 Stage 1O 短记录。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：focused 2 files / 111 tests passed；server TypeScript passed。confirm-only 优化后追加复跑 `tests/integration/sample-card-effect-runner.test.ts -t "PL!HS-sd1-001"`：3 passed / 106 skipped；server TypeScript passed。

本次 2026-06-14 快速卡效批处理：`PL!HS-bp6-001-R＋` / `PL!HS-cl1-009-CL`：

- `PL!HS-bp6-001-R＋` 费用 4「日野下花帆」已按基础编号 `PL!HS-bp6-001` 覆盖 `P / P+ / R+ / SEC`，本地卡库全角 `R＋` 通过 card-code normalize 命中：
  - 登场段：结算时按己方舞台成员数 + 2 动态检视卡组顶，选择 1 张放回卡组顶，其余放置入休息室。复用 `startArrangeInspectedDeckTopEffect` ordered workflow。
  - LIVE 成功段：若自己的 LIVE 成功，可从因声援公开且仍在处理区的自己的卡中选择 1 张放回卡组顶；该段是首个舞台成员来源 `LIVE_SUCCESS` 样例。
- `PL!HS-cl1-009-CL` 分数 1「水彩世界」已完成 LIVE 成功段：从因声援公开且仍在处理区的自己的卡中，将 1 张费用 4-9 的成员卡加入手牌。
- 新增可复用底座：`src/application/effects/cheer-selection.ts` 用 `liveResolution.first/secondPlayerCheerCardIds + resolutionZone.revealedCardIds` 选取“本次声援公开卡”，再按卡效配置移动到手牌或卡组顶；后续 DOLLCHESTRA 成员入手、莲之空 LIVE 入手、任意声援卡回顶等可以复用同一 helper。
- 事件边界更新：`enqueueLiveSuccessCardEffects` 现在在存在成功 LIVE 时同时扫描成功 LIVE 卡来源与表演玩家舞台成员来源。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因新增声援公开卡 helper 与 LIVE_SUCCESS 舞台成员来源边界，已同步 `docs/card-effect-framework/card_effect_framework_design.md` 与 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
```

结果：focused 2 files / 116 tests passed；server TypeScript passed。

本批 2026-06-14 莲之空卡效批末收束：

- 收束范围：`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」，以及 `PL!HS-bp2-022` 分数 2「アオクハルカ」此 Live 卡分数投影修正。
- 文档收束：保持 `docs/card-effect-reuse-audit/existing_module_map.md` 为主登记册；同步整理 `AGENTS.md`、`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md`。未重写无关表格，只补本批新增边界：公开手牌隐私/确认窗口、continuous SCORE、此 Live 卡分数 vs LIVE 合计分数投影、relay `replacingCardId`、分组回收、动态控顶、LIVE 成功舞台成员来源与 `effects/cheer-selection.ts`。
- 后续更新：`PL!HS-bp6-027-L` 分数 5「月夜見海月」已在 2026-06-15 完成追加声援边界；重做声援继续等待后续真实样例。
- 最终验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts tests/unit/live-modifiers.test.ts tests/unit/player-view-state.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
git diff --check
```

结果：focused 5 files / 168 tests passed；server TypeScript passed；client TypeScript passed；`git diff --check` passed。

本次 2026-06-14 快速卡效批处理：`PL!-bp4-010-N` 费用 15「高坂穗乃果」：

- `PL!-bp4-010-N` 费用 15「高坂穗乃果」已完成 LIVE 开始段：可以支付 1 张活跃能量；LIVE 结束时为止获得 BLADE +2。
- 实现复用 `TAP_ACTIVE_ENERGY` 支付与 `addLiveModifier(BLADE)` 主写入路径；`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」与该卡共享固定 BLADE 支付结算 helper，未新增事件边界或设计文档变更。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-rarity-sync.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
git diff --check
```

结果：focused 2 files / 117 tests passed；rarity sync 1 test passed；server/client TypeScript passed；`git diff --check` passed。

本次 2026-06-14 三张 partial 卡效补齐：

- `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」已补齐 LIVE 开始段：可以弃合计 3 张指定姓名手牌，LIVE 结束时为止 LIVE 合计分数 +3。候选使用 `cardNameAliasIs`，组合名卡本身可作为费用候选；结算复用 `paySelectedDiscardHandCost` 与 `addLiveModifier(SCORE)`。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已补齐剩余两段：此成员无法因换手放置入休息室；LIVE 开始可弃任意张指定姓名手牌，并按弃置张数获得 BLADE。换手禁止在 `cost-calculator.ts` 的支付方案与 `play-member.handler.ts` 的实际登场动作双重拦截；LIVE 开始段复用同一指定姓名手牌弃置流程与 `addLiveModifier(BLADE)`。
- `PL!N-pb1-004-P+ / R` 费用 11「朝香果林」已补齐 catalog 常时段：此回合中此成员未进行成员区位置移动时，通过 continuous modifier registry 获得 BLADE +2。规则口径为登场不算移动；站位变换、普通成员区移动与交换会写入 `positionMovedThisTurn`。
- 文档同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`、`docs/card-effect-framework/card_effect_framework_design.md`、`docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`、`docs/card-effect-reuse-audit/effect_module_coverage.md`、`docs/card-effect-reuse-audit/module_gap_list.md` 与 `docs/card-effect-reuse-audit/safe_refactor_plan.md`。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts`
  - `tests/integration/sample-card-effect-runner.test.ts`
  - `tests/unit/cost-calculator.test.ts`
  - `tests/integration/member-cost-payment.test.ts`
  - `tests/unit/live-modifiers.test.ts`
  - `tests/unit/member-state.test.ts`
  - `tests/unit/member-slot-swap.test.ts`
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/cost-calculator.test.ts tests/integration/member-cost-payment.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/member-slot-swap.test.ts`，7 files / 168 tests passed。

## 下一步建议

本次 2026-06-14 快速卡效批处理：`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」：

- 新增 `HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID`，登记为 LIVE 卡来源的 `LIVE_START` / `ON_LIVE_START` 队列能力，按基础编号 `PL!HS-bp6-031` 覆盖当前 `L`。
- 结算流程：玩家可选择是否发动；发动时将自己休息室全部成员卡洗牌后放到主卡组底，非成员等待室卡保留。若因此放到底部的 `みらくらぱーく！` 成员大于等于 15 张，则选择自己舞台 1 名「安养寺姬芽」并通过 `BLADE` live modifier 获得 BLADE +3。
- 复用范围：LIVE 开始队列、`shuffleZone`、`unitAliasIs('みらくらぱーく！')`、`cardNameAliasIs('安養寺姫芽')` 与 `addLiveModifier`；本段未新增 resolver / cost calculator / live modifier registry 结构。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖 LIVE 卡来源登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 15 张以上时选姬芽加 BLADE、不足 15 张时只洗回且不加 BLADE。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；按快速批处理节奏，本窗口未改设计/覆盖/gap 大文档。

本次 2026-06-15 快速卡效批处理：`PL!HS-bp6-027-L` 分数 5「月夜見海月」：

- 已完成 `ON_CHEER` 自动能力：自己进行声援时，可将至多 3 张因声援公开且仍在处理区的自己的无 BLADE HEART「莲之空」卡放置入休息室；如此做时追加等量声援。
- 后续事件层更新：自动/手动/追加声援现在都会写入 `CheerEvent`；`enqueueTriggeredCardEffects(ON_CHEER)` 优先消费 eventLog 中最新非追加 `CheerEvent`，保留旧 LIVE 区推导 fallback。追加声援仍写事件用于审计，但 `additional=true` 不再二次触发 `ON_CHEER`。
- 新增/扩展底座：
  - `src/application/effects/cheer.ts`：抽出声援公开到解决区、登记 `liveResolution.*CheerCardIds`、写入 `CheerEvent` 与即时 refresh 检查的共享 helper。
  - `src/application/effects/cheer-selection.ts`：声援公开卡移动目的地新增 `WAITING_ROOM`。
  - `card-effect-runner` 新增 `ON_CHEER` 入队，当前优先消费 `CheerEvent`，旧扫描表演玩家 LIVE 区来源只作 fallback；追加声援不二次触发 `ON_CHEER`。
  - 声援公开卡选择支持 `ORDERED_MULTI` 多选配置，本卡使用 `selectMin=0/selectMax=3`。
- Focused 验证：`tests/unit/card-effect-classification.test.ts` 覆盖 `AUTO / LIVE_CARD / ON_CHEER` 登记；`tests/integration/sample-card-effect-runner.test.ts` 覆盖排除持有 BLADE HEART 与非莲之空公开卡、移动入休息室、追加等量声援。
- 实时同步：已更新 `docs/card-effect-reuse-audit/existing_module_map.md`；因新增 `ON_CHEER` 事件边界、声援 helper 与追加声援，已同步 `card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`module_gap_list.md` 与 `safe_refactor_plan.md`。

`绿莲-6弹ver.yaml` 第一批最后一张 `PL!HS-bp6-027-L` 已完成；本批后续按用户确认再进入批末提交/摘要收束。

本次 2026-06-14 低风险同构扩样本（与 `PL!-sd1-002-SD` 对齐）已完成 17 张卡：

- `PL!-pb1-025-N` 费用 2「東條 希」
- `PL!HS-PR-014-PR` 费用 2「日野下花帆」
- `PL!HS-pb1-019-N` 费用 2「大沢 瑠璃乃」
- `PL!HS-sd1-015-SD` 费用 2「セラス 柳田 リリエンフェルト」
- `PL!N-bp4-017-N` 费用 2「宮下 愛」
- `PL!N-bp4-020-N` 费用 2「エマ・ヴェルデ」
- `PL!N-sd1-006-SD` 费用 2「近江 彼方」
- `PL!S-PR-025-PR` 费用 2「高海 千歌」
- `PL!S-PR-027-PR` 费用 2「松浦 果南」
- `PL!S-bp2-016-N` 费用 2「国木田 花丸」
- `PL!S-bp6-014-N` 费用 2「渡辺 曜」
- `PL!S-sd1-008-SD` 费用 2「小原 鞠莉」
- `PL!SP-bp4-015-N` 费用 2「平安名 すみれ」
- `PL!SP-bp4-019-N` 费用 2「若菜 四季」
- `PL!SP-pb1-021-N` 费用 2「ウィーン・マルガレーテ」
- `PL!SP-sd2-014-SD2` 费用 2「嵐 千砂都」
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」

- 已同步文档：`docs/card-effect-reuse-audit/existing_module_map.md`（`PL!-pb1-019-N` 同型批次 17 卡）、`docs/card-effect-reuse-audit/module_gap_list.md`（`F07,F08,F09` 闭环更新为 35 张同型）与 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。
- 本次焦点验证通过：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b`。

优先级 1：基于 `系统边界混合` 测试卡组开始实现新效果，优先打开新系统边界，同时保留少量现有模块扩样本。

推荐下一批 proving cards：

- `PL!HS-bp6-004-R` 费用 13「百生 吟子」已完成登场/LIVE 开始对手低费成员待机、LIVE 开始可弃手加 BLADE、同源双 LIVE 开始顺序选择区分，并已抽出舞台成员目标选择 active effect 配置入口。下一批建议继续真实 AUTO / LIVE 开始 proving set，优先选择能推进 when-if、名称/费用 selector 配置化或更多状态事件的卡；若先做低风险复用验证，可找第二张“选择自己/对方舞台成员并改变状态”的同型卡接 `stage-member-target-selection.ts`。
- `PL!S-bp2-006-P` 费用 11「津岛善子」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」当前目标段已完成，后续保留为 S07/S02/E02/X11 回归样例。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」费用减少与登场二选一活跃段已完成，后续保留为 X11/X03/S02/E02 回归样例。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」与 `PL!SP-PR-004-PR` 费用 4「唐 可可」当前已完成目标段，后续保留为 F02/E02/E03/S05 回归样例。
- `PL!HS-bp1-004-P` 费用 15「夕雾缀理」已完成起动支付能量回收莲之空 LIVE 与 LIVE 开始支付能量按 LIVE 区数量得 BLADE，后续保留为 C03/F08/B01 回归样例。
- `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已完成 LIVE 卡来源的 LIVE 开始必要 Heart / 此 Live 卡分数 modifier，后续保留为 B07/B06 回归样例。

优先级 1.5：旧建议中的非 `PL!-sd1` 低风险扩样本中，`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」、`PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」已收口完成登场段；下一个推荐是 `PL!HS-PR-002-PR` 费用 10「村野さやか」。

- `PL!HS-PR-002-PR` 费用 10「村野さやか」：登场看顶3选1，优先作为同构下一步。

优先级 1.5：继续减少 runner inline orchestration，但不要做大型 resolver DSL。

- `PL!-sd1-006-SD` 的公开手牌 + 成功区交换仍 inline，等需要 C07/交换效果时再抽。
- 003 / `PL!HS-bp1-006-P` 费用 11「藤岛 慈」Heart 颜色选择仍是专用步骤；已有第二张 Heart 样例，下一张选择颜色/模式卡出现时可抽 generic option-choice。
- 009/022/001 的条件/倍率仍在 resolver，等非预组样例重复后再抽 condition AST。
- F12、抽牌刷新语义继续等待真实样例；F02 当前已有登场抽弃与 BLADE 阈值 LIVE 开始抽弃样例；`PL!HS-bp1-006-P` 费用 11「藤岛 慈」已补齐 LIVE 开始弃手后按条件选择 Heart 的 B03 扩样本。

优先级 2：Step 12 / Stage 1G 自动能力框架已最小起步。

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已证明 `ON_LEAVE_STAGE` 入队、look-top 解析与同事件顺序选择；`PL!HS-bp6-017-N` 费用 11「日野下花帆」已证明同一离场 AUTO 底座可接弃手后分组回收；`PL!HS-pb1-009-R` 费用 15「日野下花帆」已证明 `ON_ENTER_STAGE` 可被舞台成员监听并接实例级每回合限制，且 LIVE 开始段可复用成员有效 BLADE helper 与 F02 抽弃流程。
- 保留 AUTO 待办：后续继续推进标准 `GameEvent`、trigger matcher、when-if 与更广泛移动/状态事件，并用真实自动能力样例验证。

优先级 3：继续完善 LIVE 自动判定。

- 保持“系统预判 + 玩家确认/修正”的当前策略。
- 所有加棒、加心、加分、必要 Heart 增减都应进入统一预判。
- 后续卡效覆盖足够后，再考虑取消人工确认。

优先级 4：继续补测试。

- LIVE 开始多效果顺序对结果的影响。
- LIVE 成功时效果只在成功后触发。
- 起动次数限制跨回合重置。
- 必要 Heart 增加/减少同时存在时的合并。
- 效果处理中撤销的边界。

优先级 5：费用修正器后续扩展。

费用修正器已由 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」起步。后续同类卡继续扩展 `cost-calculator.ts` 的 cost modifier 条件与来源，不要写 UI 层特例。

## 已知注意点

### 2026-07-14 μ's bp4 014 / 024 目标成员 BLADE shared family

- 完成 `PL!-bp4-014-N` 费用9「星空 凛」与 `PL!-bp4-024-L` 分数2「小夜啼鳥恋詩」两张 queued LIVE_START 卡效；definition 使用 `loveca_20260626015115.xlsx` 精确中文与已映射 `[ブレード]` token。
- 原 `PL!S-bp2-025-L` 分数1「青空Jumping Heart」单卡 workflow 晋升为 `workflows/shared/live-start-target-member-gain-blade.ts`；有限配置覆盖来源区域、BLADE 数量、目标团体、排除来源与三种条件，不扩为 callback / DSL。
- `live-modifiers.ts` 中 `PL!-bp4-002` 的私有印刷时点判断晋升为 `domain/rules/live-zone-ability.ts` 纯 query，并由 002 与 014 共用；按合法 LIVE 实例与印刷卡文判断，不依赖 definition 实现状态。
- focused 覆盖真实 ON_LIVE_START 入队、0/1/多目标、强制非法输入、ACTIVE/WAITING、memberBelow/对方/错误团体过滤、来源/条件/目标 stale、ordered continuation、精确 BLADE modifier 与 effectText token。runner 仅替换 shared import/register ownership。

### 2026-07-13 第一批 -PR- 常时卡效

- 完成 `PL!S-PR-029-PR`、`PL!N-PR-020-PR`、`PL!S-PR-037-PR`、`PL!N-PR-027-PR`、`PL!S-PR-042-PR` 五张纯常时卡效；029 扩入既有 030/031 同文 ability identity，020/037 共用新 identity，027/042 与既有 022 仅共享双方舞台合计6名的窄配置工厂。
- 实现只触及 ability ID、definition、continuous modifier registry、focused unit tests 与本批登记文档；未新增 workflow、交互或 runner 逻辑。

### 2026-07-13 μ's PR-014 匿名盲选对方手牌公开

- 完成 `PL!-PR-014-PR` 费用 2「園田海未」：独立 queued ON_ENTER abilityId 与单卡 `pl-pr-014-umi.ts` workflow，definition 使用 `loveca_20260626015115.xlsx` `sheet1!B2260` 精确中文。
- 强制选择数量为 `min(3, 对方当前手牌数)`；权威状态保留真实候选，选择者只收到版本化匿名牌背 token，候选变化时完整刷新并使旧 token 失效。多张手牌通过复数 activeEffect helper 在同一窗口一次公开并清理旧选择字段，卡牌仍留在对方手牌。
- LIVE 条件只读取本效果公开时保存的集合事实；公开后目标变 stale 不改变结论。无 LIVE 时复用 `drawCardsForPlayer` 抽1，完整 `RESOLVE_ABILITY` 后统一 continuation。runner 仅新增一个 import 与一次 register；focused 入口为 `tests/integration/pl-pr-014-umi.test.ts`、blind token 与 runtime action 单测。

### 2026-07-13 μ's PR-007 / PR-009 自身待机后使对方低费成员待机

- 完成 `PL!-PR-007-PR` 费用4「東條 希」与 `PL!-PR-009-PR` 费用4「矢澤にこ」：两张仅 PR、印刷 BLADE 2、中日文完全同文，共用独立 PR ON_ENTER / LIVE_START abilityId 与 `baseCardCodes: ['PL!-PR-007', 'PL!-PR-009']`。
- 两张执行复用 shared `wait-self-opponent-wait.ts` 的印刷费用 <=4 配置；因 Excel 中文提醒句与现有 N/S-bp3 family 不同，不共享 ability identity。来源/目标均走成员状态事件 wrapper，支付后无目标、stale、ordered continuation 与重复确认保持既有安全语义；family 目标确认按钮窄统一为“变为待机状态”。
- 未新增卡牌维度 workflow/helper，未修改 runner；focused classification/integration 覆盖两张真实 ON_ENTER、真实 LIVE_START、玩家文案、skip、来源失效、目标过滤、无目标、stale、事件顺序、ordered 与重复确认。

### 2026-07-13 μ's PR-003 / PR-004 弃2回收 LIVE

- 完成 `PL!-PR-003-PR` 费用 15「南ことり」与 `PL!-PR-004-PR` 费用 15「園田海未」：分别登记独立起动 abilityId，并扩展 shared `discard-cost-waiting-room-to-hand.ts`。
- 两张均在标准弃手事件 wrapper 支付2张手牌后重扫自己的休息室，分别只接受 LIVE 自身印刷必要黄 Heart >=3 / 桃 Heart >=3；回收继续走 public-card-selection confirmation，费用牌自身可成为目标。
- 未新增 workflow/helper，未修改 runner；focused integration 覆盖生产起动、selector 正反例、非法/stale 输入、无目标、公开确认、每回合限制与发动门禁。

### 2026-07-12 星团 bp2「Go!! リスタート」

- 完成 `PL!SP-bp2-023-L / SRL` 分数 1「Go!! リスタート」：按基础编号登记同文罕度，扩展 shared `live-start-score-bonuses.ts`，实时比较双方成功 LIVE 卡区数量。
- 单 pending 与手动点选使用动态 confirm-only，顺序发动自动连续；满足时写来源绑定 SCORE +1 并同步刷新 `playerScores`，focused classification/integration 与 token/text governance 覆盖本窗口验证。

### 2026-07-11 虹咲三弹 LIVE 卡第一批

- 完成 `PL!N-bp3-026-L` 分数 3「サイコーハート」与 `PL!N-bp3-031-L` 分数 6「MONSTER GIRLS」：分别扩展 shared LIVE_START 分数 workflow 与新增薄 LIVE_SUCCESS 单卡 workflow。
- 两张均接入 confirm-only / ordered resolution / manual point 三态，SCORE modifier 使用来源与 ability 维度替换并同步刷新 `playerScores`。
- focused classification/integration、effectText token/governance、服务端与客户端类型检查及 `git diff --check` 结果见本窗口验证记录；下一步按确认继续后续批次。

### 2026-07-11 虹咲三弹新卡第二批

- 完成 `PL!N-bp3-006-R / P` 费用 9「近江彼方」与 `PL!N-bp3-004-R / P` 费用 13「朝香果林」；前者强制来源 WAITING 并写入成员状态事件，后者依次支付 WAITING、强制弃1手牌，弃置成功后记录 turn1，再强制回收1张虹咲 LIVE。
- 两张均保留独立单卡 workflow，只复用既有状态变化、弃手与休息室回收底层；未新增 shared family，未改变通用声援 BLADE 规则或框架边界。
- focused classification/integration、rarity、token/text governance、服务端与客户端类型检查及 `git diff --check` 结果见本窗口收尾；下一步候选继续按虹咲三弹既定批次筛选。

- 子模块 `llocg_db` 里可能有本地未跟踪 `.DS_Store`，不要提交。
- 旧日期进度文档只作为 git 历史中的施工日志保留；新窗口应以本文件为当前事实。
- 本地测试端口目前按 `5173` 使用；如果页面没热更新，先确认实际 Vite 端口。

## 2026-07-20 LL-bp7-001-R+ 收口

- exact 三条 definition、可复水 `pendingSpecialMemberPlay` 与 begin/confirm/cancel 命令已落地；区域选定后才建私密选卡窗口，对手只见等待态，旧 checkpoint 缺字段安全默认为无窗口。
- 确认时重验 exact 来源、目标、三姓名最大分配、弃置后手牌和费用方案，再原子完成 grouped 弃手、10费正常支付、普通单换手与登场；登场后无其他修正时有效费用为15。
- 两段回收只扩展既有 `waiting-room-to-hand` family。本批不宣称通用替代费用、任意姓名支付或特殊登场 DSL 已完成。
- 审查收紧：BEGIN 权威端现拒绝未结算 effect/pending/check timing/inspection/delegated sequence；已占区域的费用查询显式绑定普通 `SINGLE` 换手，并以0费换手目标回归锁定移动、PAY_COST、公开事件与 sealed audit 一致。
