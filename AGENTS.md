# Loveca Battle Agent Guide

本文件保留全仓库适用的约束。按当前任务定位代码与文档；不要求每次开发先通读进度、卡牌登记册或框架手册。

## 工作范围与边界

- 本项目实现 Loveca 的共享规则引擎、本地调试与对墙打、正式联机、观战、历史回放及赛季玩法；以规则正确、玩家可测为完成目标，线上能力实现与生产验收分别确认。本地调试、对墙打与正式网页共用 `GameBoard` / `PlayerArea` 和命令路径，不另造测试 UI。
- 按用户请求工作：审查保持只读；明确要求实现或修复时，完成范围内修改、相关验证和必要文档，不停在首版代码或重复索取已有授权。会改变规则解释、任务范围或外部状态且无法由上下文确定的决定才询问。
- AI 对战策略维护：通用策略谨慎更新，只做必要的共性修正；用户未另行限定时，可以主动调整卡组策略。优先提炼核心原则、构筑事实与关键联动，避免将 prompt 扩展成逐局案例或细碎的局面分支。
- 不访问或探测生产管理员入口、卡牌管理、平台配置、房间监控页面及相关 API；不以页面脚本或直接请求绕过限制。具体生产动作需要当前对话的明确授权，普通开发或浏览器授权不包含它们。意外进入管理区域时停止、不读正文并报告。
- 不自动保存、创建、删除、导入账号卡组；这些账号写操作需说明具体影响并取得明确授权。本地导出只授权读取，不代表生产写入许可。
- 保留用户已有改动，不主动清理、更新、纳入提交 `llocg_db`、`assets/card/`、`assets/images/` 或 `trigger`。卡效开发不拉取子模块。Git 提交、推送、PR 与发布按用户请求的具体范围处理，不由“实现卡效”自动推导。

## 代码与数据约束

- 权威状态通过 `GameSession` / `GameService` / command 层改变；React 只展示投影并提交命令。隐藏信息通过 projector、visibility 与 inspection context 隔离，不能将对手私密数据传给前端再隐藏。
- 只增加当前需求所需的模型和状态。新增持久字段应有实际读取者和无法从既有权威状态推导的理由；临时弹窗候选、展示顺序等默认属于 UI 状态。输入、权限、并发、持久化及领域不变量处做必要校验，避免假设性兼容层、缓存和审计表。
- 运行时默认只读当前格式，旧数据通过迁移处理；涉及持久格式、checkpoint 复水或公开协议兼容时读取[兼容边界](.agents/skills/prepare-for-pr/references/compatibility-boundaries.md)中的流程与既有窄例外，不扩散 dual-read。新的兼容需求由用户明确决定。

## 按任务定位

- 仓库路径使用当前 checkout 根目录（`git rev-parse --show-toplevel`），不依赖作者机器的绝对路径。模块当前边界以 [文档导航](docs/README.md) 与 [项目待办](PROJECT_PROGRESS_TODO.md) 所列专题文档为准。
- 当前进度与下一步：检索 [PROJECT_PROGRESS_TODO.md](PROJECT_PROGRESS_TODO.md) 的相关章节，不把整份进度作为所有任务的前置阅读。
- 权威状态与规则：`src/application/game-session.ts`、`src/application/game-service.ts`、`src/domain/entities/game.ts`、`src/domain/entities/zone.ts`；登场费用由 `src/domain/rules/cost-calculator.ts` 计算。
- 玩家视图与桌面：`src/online/projector.ts`、`client/src/store/gameStore.ts`、`client/src/components/game/GameBoard.tsx`、`client/src/components/game/PlayerArea.tsx`。对战模式、观战与回放只读边界见 [模式说明](docs/battle-mode-purpose-and-boundaries.md)。

专用约定按任务加载，不把表内 skill 全部作为前置阅读：

| 任务 | 入口与专用约定 |
| --- | --- |
| 卡效实现、审查、卡文治理或卡效提交说明 | [loveca-card-effect-governance](.agents/skills/loveca-card-effect-governance/SKILL.md)：指定导出、全罕度覆盖、workflow 归属、主登记册与卡文工具；纯非卡效任务无需加载 |
| 对战交互、区域展示与撤销 | [battle-interaction-design](.agents/skills/battle-interaction-design/SKILL.md)：横置、orientation、效果选择、撤销窗口及模式边界；新增动画时再用 motion-system-design |
| 桌面浏览器验证、测试卡组与补图 | [animation-verification](.agents/skills/animation-verification/SKILL.md)：按需检查实际环境、玩家视图、测试资产和视觉证据 |
| 提交检查或 commit message | [prepare-for-git-commit](.agents/skills/prepare-for-git-commit/SKILL.md)：暂存范围、相关验证与中文提交说明 |
| PR 检查、准备或分支同步 | [prepare-for-pr](.agents/skills/prepare-for-pr/SKILL.md)：审查基线、作者 main 独立副本、冲突处理与中文 PR 文案 |
| 正式版本发布 | [prepare-for-release](.agents/skills/prepare-for-release/SKILL.md)：发布授权、版本／SHA／CI／镜像／tag；不包含生产部署 |

## 验证与交付

- 测试验证规则不变量、权威状态、接口契约与完整操作结果；不要用覆盖数字或普通提示文案代替行为。可访问名称可用于定位；完整卡文、关键规则按钮和错误指引属于契约时保留窄文本断言。
- 按变更影响选择 focused tests；共享调度、事件或规则修改覆盖相关回归。涉及类型或编译链路再做对应 TypeScript 检查；全量测试、前端 build 和 E2E 仅在影响面需要时运行。纯文档改动检查格式、链接与声明的一致性即可。
- 常用命令：`pnpm test:run <相关测试路径>`、`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b`、`git diff --check`。通过后只因新修改、失败或未解决风险扩大或重跑；修复本次引入的失败，既有失败明确报告。
- 文档只更新受影响的权威说明；进度文件仅在当前基线或下一步变化时更新，不为普通局部修改刷新整套文档。历史过程由 Git 追溯。
- 聊天提及卡号时同时写费用/分数与卡名，例如 `PL!SP-bp4-008-P` 费用 13「若菜四季」、`PL!-sd1-019-SD` 分数 4「START:DASH!!」。
- commit message 与 PR title 使用中文，具体检查与文案流程见对应 skill。
- 完成意味着请求范围内工作落地、相关检查通过、登记与说明准确；交付说明行为变化、验证和仍未解决的问题，不把局部实现写成全框架完成。
