# Loveca Battle Agent Guide

本文件保留全仓库适用的约束。按当前任务定位代码与文档；不要求每次开发先通读进度、卡牌登记册或框架手册。

## 工作范围与边界

- 本项目实现 Loveca 的共享规则引擎、本地调试与对墙打、正式联机、观战、历史回放及赛季玩法；以规则正确、玩家可测为完成目标，线上能力实现与生产验收分别确认。本地调试、对墙打与正式网页共用 `GameBoard` / `PlayerArea` 和命令路径，不另造测试 UI。
- 按用户请求工作：审查保持只读；明确要求实现或修复时，完成范围内修改、相关验证和必要文档，不停在首版代码或重复索取已有授权。会改变规则解释、任务范围或外部状态且无法由上下文确定的决定才询问。
- AI 对战策略维护：通用策略谨慎更新，只做必要的共性修正；用户未另行限定时，可以主动调整卡组策略。优先提炼核心原则、构筑事实与关键联动，避免将 prompt 扩展成逐局案例或细碎的局面分支。
- 不访问或探测生产管理员入口、卡牌管理、平台配置、房间监控页面及相关 API；不以页面脚本或直接请求绕过限制。具体生产动作需要当前对话的明确授权，普通开发或浏览器授权不包含它们。意外进入管理区域时停止、不读正文并报告。
- 不自动保存、创建、删除、导入账号卡组；这些账号写操作需说明具体影响并取得明确授权。本地导出只授权读取，不代表生产写入许可。
- 保留用户已有改动，不主动清理、更新、纳入提交 `llocg_db`、`assets/card/`、`assets/images/` 或 `trigger`。卡效开发不拉取子模块。Git 提交、推送、PR 与发布按用户请求的具体范围处理，不由“实现卡效”自动推导。
- 作者远端 main 的独立副本复用上级目录的 `loveca_main`，未经要求不另建 checkout；更新时禁用子模块递归，保持其中 `llocg_db` 未初始化。

## 代码与数据约束

- 权威状态通过 `GameSession` / `GameService` / command 层改变；React 只展示投影并提交命令。隐藏信息通过 projector、visibility 与 inspection context 隔离，不能将对手私密数据传给前端再隐藏。
- 只增加当前需求所需的模型和状态。新增持久字段应有实际读取者和无法从既有权威状态推导的理由；临时弹窗候选、展示顺序等默认属于 UI 状态。输入、权限、并发、持久化及领域不变量处做必要校验，避免假设性兼容层、缓存和审计表。
- 运行时默认只读当前格式，旧数据通过停机迁移处理：停止旧写入、备份、dry-run、迁移、校验后部署。无法无损转换时报告失效、重置或人工恢复策略。窄例外：早期 checkpoint 缺 `manualOperationMode` 仅在历史回放/服务端可记录对墙打复水时补 `FREE`；旧 BLADE/HEART 仅在 checkpoint 复水按冻结 abilityId 表迁移，未知、缺字段或冲突形状拒绝；旧 `/api/online/match-records...` 仅为规范 `/api/battle/match-records...` 的临时公开协议 alias。不扩散到 live session/command 的 dual-read，新的历史归档或公开协议兼容需求由用户明确决定。
- 卡效实现、审查、卡文治理或提交说明使用 [loveca-card-effect-governance](.agents/skills/loveca-card-effect-governance/SKILL.md)，再按其路由读取相关参考。纯非卡效任务无需加载。
- 卡效定义在 `src/application/card-effects/definitions/index.ts`；单卡流程在 `workflows/cards/`，稳定同型 family 在 `workflows/shared/`，动作与生命周期 helper 在 `runtime/`。这些目录均位于 `src/application/card-effects/`。runner 保持调度、生命周期和注册边界，不回填单卡结算逻辑，不在 React 或 action handler 实现卡效。
- 同一基础编号的所有罕度共享类型与完整卡效；definition、workflow gate、continuous registry、费用及 modifier 查询按基础编号覆盖。必须使用 `baseCardCodes`，不能用导出仅出现某一罕度为 exact `cardCodes` 限制辩护。
- 新卡规则核对用户指定导出 JSON 的 `cardTextJp`，玩家正文使用同记录 `cardTextCn`；不自动换用 API、旧卡库、Excel、人工翻译或“最新”文件。缺失或歧义只阻塞相关项，详情见 skill 的数据参考。

## 按任务定位

- 仓库路径使用当前 checkout 根目录（`git rev-parse --show-toplevel`），不依赖作者机器的绝对路径。模块当前边界以 [文档导航](docs/README.md) 与 [项目待办](PROJECT_PROGRESS_TODO.md) 所列专题文档为准。
- 当前进度与下一步：检索 [PROJECT_PROGRESS_TODO.md](PROJECT_PROGRESS_TODO.md) 的相关章节。卡效完成状态唯一主登记册是 [existing_module_map.md](docs/card-effect-reuse-audit/existing_module_map.md)，按基础编号查条目，不全文加载。
- 权威状态与规则：`src/application/game-session.ts`、`src/application/game-service.ts`、`src/domain/entities/game.ts`、`src/domain/entities/zone.ts`；登场费用由 `src/domain/rules/cost-calculator.ts` 计算。
- 玩家视图与桌面：`src/online/projector.ts`、`client/src/store/gameStore.ts`、`client/src/components/game/GameBoard.tsx`、`client/src/components/game/PlayerArea.tsx`。对战模式、观战与回放只读边界见 [模式说明](docs/battle-mode-purpose-and-boundaries.md)。
- 桌面约定：LIVE 与成功 LIVE 横置；能量和成员通过 `orientation` 表示活跃/待机。撤销入口在右下阶段工具条，不可用时显示规则层原因；同一操作窗口内保存至多 50 步，阶段、子阶段、活跃或等待玩家变化后清空。正式联机由对手同意并由服务端校验回滚；观战和回放无撤销。
- 效果选择优先使用可 hover 查看详情的卡图网格，起动正文完整显示。自动化标记、次数高亮及卡文/按钮细节见 skill 的玩家文案参考。
- 需要完整测试环境时检查仓库 `pnpm test-env:start` 配置与实际环境，不假定旧 localhost 端口或历史首页入口仍有效；不擅自推进用户复杂对局。
- 测试卡组在 `assets/decks/`。`scripts/download-local-test-card-images.mjs` 支持 `--dry-run`、`--deck-dir=...`、基础编号罕度展开及 P+/L+ 别名；补图前预览范围。`assets/images/` 仍用于本地 fallback，未明确替换前不删除。临时图片不作为卡效规则依赖，提交前检查图片 diff，不能混入生产资产。

## 验证与交付

- 测试验证规则不变量、权威状态、接口契约与完整操作结果；不要用覆盖数字或普通提示文案代替行为。可访问名称可用于定位；完整卡文、关键规则按钮和错误指引属于契约时保留窄文本断言。
- 按变更影响选择 focused tests；共享调度、事件或规则修改覆盖相关回归。涉及类型或编译链路再做对应 TypeScript 检查；全量测试、前端 build 和 E2E 仅在影响面需要时运行。纯文档改动检查格式、链接与声明的一致性即可。
- 常用命令：`pnpm test:run <相关测试路径>`、`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b`、`git diff --check`。通过后只因新修改、失败或未解决风险扩大或重跑；修复本次引入的失败，既有失败明确报告。
- 每张卡或效果段落地时更新主登记册：基础编号、费用/分数、卡名、全罕度覆盖、完整/部分实现、复用模块及测试。进度文件仅在当前基线或下一步变化时更新；新增抽象或事件边界时同步对应设计/覆盖/gap 文档，普通同构追加不逐卡刷新整套文档。批末按实际变化收束，历史过程由 Git 追溯。
- 聊天提及卡号时同时写费用/分数与卡名，例如 `PL!SP-bp4-008-P` 费用 13「若菜四季」、`PL!-sd1-019-SD` 分数 4「START:DASH!!」。
- commit message 与 PR title 使用中文。非平凡提交用标题加正文说明范围、关键实现、验证与必要遗留事项；卡效提交说明由 skill 的导出 JSON 工具生成事实骨架，再核对真实 diff。
- 完成意味着请求范围内工作落地、相关检查通过、登记与说明准确；交付说明行为变化、验证和仍未解决的问题，不把局部实现写成全框架完成。
