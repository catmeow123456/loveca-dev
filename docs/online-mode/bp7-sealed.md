# 开盒战 · 七弹

> 类型：专题说明。范围：娱乐模式的七弹（BP7）模拟开盒、房间组牌、半副规则与迁移。
> 状态：本地实现与验证；生产迁移、发布和部署需另行执行。

## 玩家流程

在对战大厅选择「娱乐模式 → 开盒战」，当前卡池以独立标签「七弹」显示，可以随机找对手、创建房间或输入房间码。与自由构筑分开匹配，不需要账号卡组，不使用 PT 上限。双方确认入桌后开始共用的 15 分钟倒计时，服务端同时生成两盒并保存。

玩法名称固定为「开盒战」，卡池标签按商品命名：普通 BP 扩展包使用中文序号加「弹」（如 BP7 → 七弹）；团体高级包使用「团体简称＋高＋阿拉伯数字序号」（如 μ's 的 PL!-pb2 → 缪高2）。显示名称集中于 `src/shared/sealed-format.ts`，内部格式标识、商品归属和卡号保持原编码；目前仅支持七弹卡池。

每盒 10 包，每包 5 张。逐包打开和全部打开只揭示既有结果；刷新、断线或重复请求不会重抽。选出 24 张成员，盒内 6 张 Live 全部固定加入，1～2 张能量加基础能量补足 12 张。同卡号成员可以超过 4 张，但不能超过本盒实际数量。草稿自动保存在房间中；准备后锁定自己的构筑，对手尚未准备时可取消准备。双方准备后进入猜拳、先后手和原有对战流程。

成员牌池和已选成员共用团体、费用、罕度筛选与排序。默认按费用升序，可切换费用降序、卡号顺序或原开盒顺序；同费用保持开盒先后顺序，缺失费用排在最后。排序只调整展示，不改变卡牌身份、已选内容或服务端分包结果。

倒计时到期仍未全部准备，或任一玩家主动退出组牌，本轮取消并释放双方占位，不记败北。短暂断线可以在原期限内恢复。对战结束后，双方可以协商「原牌池再战」或「邀请重新开盒」：前者保留牌池和上一局成员选择，后者同时换新牌池；两者均开启新轮次和新的 15 分钟期限。邀请有效期为 60 秒，双方同意前不会换牌池。牌池不进入账号卡组，也不能携带到新对手的房间。

## 模拟盒配

[BP7 官方商品规格](https://llofficial-cardgame.com/products/bp07_mellowmoment/)为 10 包 × 5 张。以下盒配是本项目的模拟参数，**不是官方封入概率**。参数集中于 `src/domain/rules/sealed-box.ts`，当前配置版本为 `BP7_SIMULATED_V1`。

基础配置为 N×20、R×10、P×9、R+×4、L×6、PE×1，即 43 成员、6 Live、1 能量。

| 独立类别 | 每盒互斥概率 | 替换位置 |
| --- | --- | --- |
| 成员高罕 | P+ 15%、SEC 5%、无 80% | 一个 R+ 位 |
| Live 高罕 | SECL 5%、无 95% | 一个 L 位 |
| 额外能量 | PE+ 8%、SECE 1.5%、LLE 0.5%、无 90% | 另一个 R+ 位，普通 PE 保留 |

出现额外能量时为 42 成员、6 Live、2 能量，总数始终 50。每包固定 2 个 N 位、1 个 R 位，其余槽位随机分配剩余卡牌，不模拟整包高罕等特殊配置。

候选池来自已发布卡牌，按 BP7 商品归属、牌型和罕度筛选；商品代码 BP07/BP7 或 MELLOW MOMENT 商品名均可识别，包含沿用旧弹卡号的 BP7 再录卡。每种罕度先等概率选基础卡号，再选印刷版本，成员允许重复，Live 基础卡号每盒至多 4 张。不保证团体或费用分布。任何必需罕度或基础能量缺失都会明确报错，不跨弹补卡。随机源仅在服务端使用，房间保存冻结后的卡牌数据、图片文件名、分包顺序和配置版本。

## 对战规则与隐私

权威状态使用 `SEALED_HALF_GRAY_V1` 规则集，普通对局使用 `STANDARD`。开盒战以成功区 2 张 Live 获胜；同分时已经有 1 张成功 Live 的玩家不能借同分取得第二张，普通对局保持原来的三首门槛。

先将 Live 印刷必要心按原总数转为灰心，再应用通常的卡效增减。卡效额外增加的彩色需求保留颜色，按[官方 1BOX 规则说明](https://llofficial-cardgame.com/news/1box-0712/)处理。权威判定、共享卡效条件、玩家投影和判定预览读取该规则；全局卡牌原始数据与原始卡面不改写。其余起手、换牌、能量、回收等继续使用现有引擎。

`CasualFormat` 独立于 PT 规则参数。持久化环境 ID 为 `CASUAL_SEALED_BP7_V1`，既有 `CASUAL_TABLE_V1` / `CASUAL_UNLIMITED_PT_V1` 明确映射为自由构筑。组牌状态为 `BUILDING`，数据库事务沿用大厅 admission 锁；轮次、草稿版本、持有数量与准备状态均由服务端检查。重复确认不重复开盒，重复准备不重复启动比赛。

只有本人房间响应包含本人的完整牌池和草稿；大厅、对手及观战投影不包含这些私密字段。历史冻结实际使用的 30＋12 张卡组和权威规则集，不附带未入选牌池。准备中的数据库记录可恢复原池与剩余期限；进入对局后的恢复继续遵循现有联机运行时与 checkpoint 生命周期。

## 数据迁移

升级必须使用显式迁移，不能依赖运行时补规则字段。普通旧房间保留原环境 ID，迁移扩展状态约束并增加私有牌池、草稿版本和再战邀请字段。

1. 备份目标数据库，停止旧服务写入；按既有流程停止/完成活跃对局，避免旧进程继续生成 V2 checkpoint。
2. 执行常规 `pnpm db:migrate`，应用 `0045_add_bp7_sealed.sql`。
3. 对历史 checkpoint 运行 dry-run，审查扫描数和变更数：

   ```bash
   DATABASE_URL='<明确的目标数据库>' pnpm exec tsx drizzle/data-migrations/add-bp7-ruleset-checkpoints.ts --dry-run
   ```

4. 确认备份、停写和 dry-run 结果后显式应用：

   ```bash
   DATABASE_URL='<同一目标数据库>' pnpm exec tsx drizzle/data-migrations/add-bp7-ruleset-checkpoints.ts --apply --yes
   ```

5. 再次 dry-run 应显示 `changed: 0`，随后启动新服务，验证普通历史回放与新开盒对局。

脚本在单个事务中逐批校验 payload 哈希及元数据，将旧权威快照显式标记为 `STANDARD`，重写为 `GAME_STATE_V3` 并更新 schema、哈希和压缩信息；已有开盒快照保持原规则。旧玩家/公开视图 checkpoint 同样补入普通规则并提升视图版本。发现损坏或未知结构时整体回滚；默认 dry-run 只读，不执行写入。运行时拒绝缺失规则字段的旧权威快照。外部导出的旧调试包不由数据库迁移自动更新，需从迁移后的记录重新导出。

迁移不提供反向转换。新开盒记录不能伪装成旧普通规则；回滚应恢复升级前备份并恢复对应旧服务版本。

## 验证入口

单元测试覆盖盒配、概率边界、合法构筑、灰心与彩色增减的实际结算、两首胜利、同分及 checkpoint。PostgreSQL 集成测试使用随机独立 schema，覆盖匹配隔离、重复请求、并发准备、重连、超时、退出、再战、私密投影以及迁移 dry-run / 原子回滚。

```bash
pnpm test:run tests/unit/bp7-sealed-box.test.ts tests/unit/bp7-sealed-rules.test.ts tests/unit/live-judgment-settlement.test.ts tests/unit/live-judgment-preview.test.ts tests/unit/replay-payload-serialization.test.ts tests/unit/casual-table-runtime.test.ts
CASUAL_TABLE_TEST_DATABASE_URL='<仅本地测试 PostgreSQL>' pnpm test:run tests/integration/casual-table-postgres.test.ts tests/integration/casual-tables-route.test.ts tests/integration/bp7-checkpoint-migration-postgres.test.ts
```

真实双浏览器测试为 `client/tests/e2e/bp7-sealed-real.spec.ts`。仅对独立本地测试库启用；需已执行完整结构迁移、装载 BP7 测试卡池及基础能量，并有当前积分表供平台公共初始化使用。测试会通过普通注册接口创建 `bp7_browser_1/2` 测试玩家，无账号卡组写入。使用独立端口启动前后端后：

```bash
RUN_BP7_REAL=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5187 BP7_TEST_API_URL=http://127.0.0.1:3019 pnpm --dir client exec playwright test tests/e2e/bp7-sealed-real.spec.ts --project=tablet-1024x768 --workers=1
```

设置 `BP7_TEST_DATABASE_URL` 为同一独立本地测试库（库名必须以 `bp7_browser_` 开头），还可运行随机匹配与期限取消的浏览器测试；测试仅提前该测试房间的截止时间，并检查没有新增对局记录。

同一测试使用 1440×1000 桌面和 390×844 手机会话，验证房间码、逐包/全部打开、组牌、取消准备、刷新恢复、猜拳、换牌、原池再战及重开。图片与交互截图属于本地验证证据，不纳入提交；生产卡牌/图片是否齐全及生产发布不在此测试授权范围内。
