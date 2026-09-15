# 持久格式与兼容边界

适用：实现或审查持久格式变更、checkpoint 复水、历史归档及公开协议兼容；普通提交／PR 无需读取。以下记录既有例外，不授权新增兼容或执行生产迁移。

运行时默认只读当前格式。旧数据通过停机迁移处理：停止旧写入、备份、dry-run、迁移、校验后部署；无法无损转换时说明失效、重置或人工恢复策略。生产动作仍按当前会话授权与部署 runbook 执行。

现有窄例外：

- 早期 checkpoint 缺 `manualOperationMode`，仅在历史回放／服务端可记录对墙打复水时补 `FREE`。
- 旧 BLADE／HEART 仅在 checkpoint 复水时按冻结 abilityId 表迁移；未知、缺字段或冲突形状拒绝。
- 旧 `/api/online/match-records...` 仅作为规范 `/api/battle/match-records...` 的临时公开协议 alias。

不将这些例外扩散到 live session／command 的 dual-read。新的历史归档或公开协议兼容需求由用户明确决定；规则已由上下文确定时不重复请求确认。检查迁移和运行时读取边界分别成立，不用单条历史样本通过宣称全面兼容。
