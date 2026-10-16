# 社区对战大厅：休闲准备模型

> 对应迁移：`0042_add_casual_tables.sql`
> 当前交付：B／C／D 本地实现、清理脚本与验证；未执行生产迁移
> 业务依据：[社区对战大厅设计](../../docs/online-mode/community-lobby-design.md)

## 本次结构变化

新增 `casual_tables`、`casual_table_seats`，并为 `gameplay_participations` 增加 `CASUAL_TABLE` kind 和可空的 `casual_table_id`。准备占用在绑定时转为 `ONLINE_ROOM`，正式开局继续转为 `ONLINE_MATCH`，全过程保留同一休闲房间关联与用户唯一约束。其他模式的既有数据符合新增约束，不需要补写该关联。

迁移不读取、转换或删除旧 CASUAL 票据、预留、普通房间及历史对局；也不将旧手建房解释为已同意公开。`runtime_deck` 使用现有 transport 格式，关闭时置空；成员关系、创建幂等键与关闭原因在运行表保留 24 小时，用于重试和本人失败结果读取，随后清理，不形成另一份长期战绩库。

C 阶段已挂载 `/api/casual-tables`、本人协调器和周期清理。D 阶段已退出旧 CASUAL 读写入口、客户端保活和后台匹配；旧接口返回 410。排位／主题仍使用原队列服务，后台清理仅处理 RANKED／THEME。

## 本地验证

按 [Drizzle 规范](../README.md)在独立本地数据库迁移。真实 PostgreSQL 行为测试使用显式提供的本地连接串，并在随机 schema 内建立前置测试结构和应用同一迁移 SQL；结束后删除该 schema，不使用账号卡组或业务表。

```bash
CASUAL_TABLE_TEST_DATABASE_URL=postgres://user:password@127.0.0.1:port/test_database \
  pnpm test:run tests/integration/casual-table-postgres.test.ts
pnpm test:run tests/unit/casual-table-runtime.test.ts
pnpm typecheck
```

测试包含同池认领、并发找人、争席、确认与取消竞争、旧轮次拒绝、超时恢复、跨模式占用、卡组快照、租约围栏、绑定回滚、提交响应丢失、有限重试和运行态丢失。提供测试连接串时只接受本机地址；未提供时跳过 PostgreSQL 测试，普通运行态边界测试仍执行。

## 公开切换步骤

1. 按[发布 Runbook](../../docs/production-release-runbook.md)先限制旧休闲与普通房间新准入，停止外部续入，让候场、预留、普通房间和进行中对局排空。数据库不能证明进程内房间已排空；先核对旧进程状态与历史封存，再停写并保留备份。不要用删除占用行替代结束进行中对局。
2. 在停写窗口应用 `0042`，运行默认预演。仅输出数量与阻断项，不写数据、不输出账号或卡组快照：

   ```bash
   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/retire-legacy-casual.ts
   ```

3. 核对预演的 `live_tickets`、`live_reservations`、`live_matches`、`foreign_references` 全部为零。旧心跳须超过 45 秒，未到期确认和 bootstrap 租约需排空；旧普通房间／公共对局若仍有 `IN_PROGRESS` 记录，先查明并经原权威流程封存。RANKED、THEME 和新休闲运行态不计为旧休闲阻断。
4. 确认旧进程及所有旧写入者确已停止，再执行：

   ```bash
   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/retire-legacy-casual.ts --apply --writers-stopped
   ```

   脚本在一个事务内锁定相关表、重新核对阻断并删除旧 CASUAL 票据／预留及遗留普通房间占用。它不会伪造运行态恢复、转换旧手建房的公开意图、删除 match 历史或改写 RANKED／THEME 分配。显式停写声明不能代替前两步的人工运行态核对。

5. 重跑预演，确认旧候场、预留和占用均为零；核对排位／主题数量、分配和历史记录与备份一致。启动新版本，验证旧读写接口为 410、旧页面链接到新大厅、token 观战仍可用，再做新建→加入→确认→权威终局→离房验收后恢复准入。

本地仅在测试数据库预演过，未执行生产脚本。随机隔离 schema 的迁移测试覆盖只读预演、重复执行、拒绝活跃数据、事务回滚及其他模式／历史保留。

## 回退边界

新服务未承载玩家时，确认新表为空且旧版本数据未清理后可退回旧入口。旧数据已清理或新服务已承载玩家后，先排空新房间与对局并保留历史，再按备份和经过预演的数据方案回退；不得仅退代码，让旧版本解释新准备状态。`BOUND` 数据不能用于重造一局并宣称恢复。
