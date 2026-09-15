# AI 完整环境验证

> 文档类型：专题说明
> 适用范围：AI 对战浏览器、真实 HTTP、隔离数据库和真实模型的复现条件
> 当前状态：现行验证入口；执行通过不等于生产迁移或模型强度验收

## 验证层次

- `client/tests/e2e/ai-battle-ui.spec.ts`：复用运行中的前端与卡图，测试进程注入规则服务、记录观察和假模型，检查四个模型选项、思考开关、单步/整局金额、hover/点击统计、恢复、只读观察、完整复制/导出、键盘与结束失败重试；内部覆盖 1600×900 / 390×844 和日夜主题，不写业务记录。
- `client/tests/e2e/ai-battle-full-env.spec.ts` 与 `tests/integration/ai-battle-full-env.test.ts`：完整 Express 应用、真实认证/发布卡库/PT/recorder，通过隔离 PostgreSQL 副本验证命令、费用、效果、LIVE、封存、普通回放、角色撤销、归属和来源 CHECK；仅模型响应使用固定测试策略。
- `client/tests/e2e/ai-battle-real-model.spec.ts` 与 `tests/helpers/ai-battle-real-games.ts`：使用专用真实模型配置和正常服务，分别验证页面请求/证据与连续规则对局。历史实验结果见[模型验证](model-validation.md)，不把假模型结果计入策略质量结论。

## 浏览器夹具

已有前端可直接复用；需要完整环境时使用 `bash scripts/start-test-env.sh`，保留现有数据时传 `--no-db-rebuild`。

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 pnpm --dir client exec playwright test tests/e2e/ai-battle-ui.spec.ts --project=tablet-1024x768 --workers=1
```

## 隔离数据库与真实 HTTP

先以一致性备份准备完整本地测试库副本，命名为 `loveca_ai_qa_*`，配置 `AI_BATTLE_QA_DATABASE_URL` 及该环境的 JWT、MinIO 和测试账号。角色测试会写入并恢复测试角色，只能指向副本。harness 拒绝非本地或不符合命名的库，不暴露权威状态改写接口。

```bash
DATABASE_URL="$AI_BATTLE_QA_DATABASE_URL" pnpm db:migrate
DATABASE_URL="$AI_BATTLE_QA_DATABASE_URL" pnpm exec tsx tests/helpers/ai-battle-http-harness.ts
```

将 harness 输出的本地端口设为 `AI_BATTLE_QA_API_URL`。下面两项按顺序执行，避免竞争同一管理员会话：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 pnpm --dir client exec playwright test tests/e2e/ai-battle-full-env.spec.ts --project=tablet-1024x768 --workers=1
pnpm exec vitest run tests/integration/ai-battle-full-env.test.ts tests/integration/ai-battle-billing-postgres.test.ts --no-file-parallelism
```

浏览器需要 `AI_BATTLE_QA_API_URL`；权限测试还需要 `AI_BATTLE_QA_DATABASE_URL`。缺少配置时显式跳过，普通 unit/integration 测试通过不能替代这两项。结果以实际命令成功、区域状态、持久封存/回放和权限拒绝为准，不以界面提示出现代替。

## 真实模型

使用同一隔离库，在该库的平台 AI 配置中保存上游与 Key，配置对应部署主密钥/白名单及 `AI_BATTLE_*` 行为参数，以 `AI_BATTLE_QA_MODEL_MODE=REAL` 启动 harness，再运行对应真实模型脚本。固定局面对照工具为 `scripts/prepare-ai-battle-evaluation.ts` 和 `tests/helpers/ai-battle-real-comparison.ts`；它们保留本次输入、候选顺序与材料哈希，拒绝覆盖已有结果。端点取消、响应格式、连续回合策略和完整证据覆盖必须分别核对，不能仅以 HTTP 200 判定通过。

`scripts/evaluate-ai-live-set.ts` 保留旧版逐步 ACTION 协议的 D11／D12／D25／D26 固定输入实验，仅用于解释历史策略结论，不再作为当前批量 LIVE 设置协议的验收入口。当前协议要求一次 `CARDS` 选择表达最终盖牌完整集合；真实模型复测时须从当前版本新建对局并导出材料，不能把旧脚本的单步通过率当作当前行为通过。

当前批量协议的固定输入验证应检查完整最终集合，并分别覆盖撤回错误设置、保留必要费用衔接、声援有机会时设置 LIVE，以及说明中的未来能量、替换费用和实际盖牌数；仍不能替代整局策略验收。反例的预期集合只针对该局面预先登记的路线条件，不能据此把无 LIVE 时的所有其他换牌方案一概判错。当前策略待验收项统一见[项目待办](../../PROJECT_PROGRESS_TODO.md)，逐次请求、回复、计划哈希和观察统计保留在本地输出中。

浏览器材料保存在 `output/playwright/ai-battle/`，离线实验材料保存在 `output/ai-battle-review/`。这些是本地产物，不能随代码自动纳入提交。生产迁移以[来源迁移说明](../../drizzle/migration-notes/ai-debug-match-origin.md)及发布流程为准；当前待验收事项见[项目待办](../../PROJECT_PROGRESS_TODO.md)。

费用的最小浏览器闭环可在同一隔离 FAKE harness 上运行 `ai-battle-full-env.spec.ts --grep 计费`：创建 Flash、一次真实 HTTP 回包、结束与历史页读取同一累计。该固定回包为 47,205 总输入、17,408 缓存命中、81 输出，Flash 预估 ¥0.02579710；它不用于验证模型策略或供应商实际现金账单。
