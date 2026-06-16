---
name: prepare-for-git-commit
description: git commit操作的前期准备，包括代码规范检查，以及commit message编写
---

步骤：
1. 检查代码、文档和配置是否引入 bug，是否符合当前系统设计，是否存在不合理实现、弱类型、妥协降级或静默吞错。
2. 分析git暂存区的代码修改是否符合 `docs/coding-standard/` 和 `docs/doc_writing_guide.md`，并给出结论。
   - 检查暂存区是否新增或修改 `PROJECT_PROGRESS_TODO_*.md`、临时 TODO、临时 PLAN、一次性 checklist 或只记录“本次/本阶段做了什么”的过程日志；除非用户明确要求或当前任务的正式流程指定必须更新，否则这类内容应作为提交前阻塞项，不能为了说明本次改动而追补。
   - 检查是否提交已经废弃、被替代或只剩参考价值的旧方案；若没有说明当前状态、背景、替代方案和保留原因，应拦截并要求移除或改写成权威文档中的背景/限制说明。
   - 不要自动 `git add` 未跟踪的临时计划、TODO 或草稿文件；如果发现这类文件，只报告风险和建议处理方式。
3. 无论是否引入了bug/是否合理/是否符合规范，都根据git暂存区的代码修改编写commit message
4. 如果代码有发生变化，那么检查 `CLAUDE.md`, `AGENTS.md` 和游戏系统设计文档 `game_system_design.md`, `docs/PROJECT_REQUIREMENTS.md` 或者其他文档是否需要更新保持与最新的项目代码一致，如果不一致，则修改、更新这些文档以反映最新的代码架构和实现细节。
5. 进行 unit test 和 integration test，确保代码修改没有引入新的问题，并且现有的功能仍然正常工作。如果测试失败，需要修复代码直到测试通过；无需进行 eslint 测试。
6. 如果业务逻辑有发生变化，那么检查相关的需求文档和设计文档和相关的代码是否逻辑一致。如果不一致，则修改、更新文档。
7. 最后输出准备提交的commit message，用中文表达。commit message 的 title 需要表达修改的具体内容，需要通俗易懂。
