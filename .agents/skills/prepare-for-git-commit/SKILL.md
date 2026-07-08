---
name: prepare-for-git-commit
description: git commit操作的前期准备，包括代码规范检查，以及commit message编写
---

提示：需要启动开发测试环境时，使用 `bash scripts/start-test-env.sh` 来干净地启动开发测试。

提示：运行全量 unit / integration 测试时，`pnpm test:run` 需要显式传测试环境变量，否则部分服务端路由测试会因缺少 `DATABASE_URL` 等配置失败：

```bash
env DATABASE_URL=postgres://loveca:loveca_dev@localhost:5432/loveca JWT_SECRET=test JWT_REFRESH_SECRET=test MINIO_ENDPOINT=localhost MINIO_ACCESS_KEY=test MINIO_SECRET_KEY=test FRONTEND_URL=http://localhost:5173 pnpm test:run
```

步骤：

1. 检查代码、文档和配置是否引入 bug，整体实现是否合理无误。
2. 分析git暂存区的代码和文档修改是否符合 `docs/coding-standard/` 和 `docs/doc_writing_guide.md`，并给出结论；具体审查细则以这些规范文档为准。
3. 无论是否引入了bug/是否合理/是否符合规范，都根据git暂存区的代码修改编写commit message
4. 如果代码有发生变化，那么检查 `CLAUDE.md`, `AGENTS.md` 和游戏系统设计文档 `docs/system-design.md`, `docs/PROJECT_REQUIREMENTS.md` 或者其他文档是否需要更新保持与最新的项目代码一致，如果不一致，则修改、更新这些文档以反映最新的代码架构和实现细节。
5. 进行 unit test 和 integration test，确保代码修改没有引入新的问题，并且现有的功能仍然正常工作。如果测试失败，需要修复代码直到测试通过；无需进行 eslint 测试。
6. 如果业务逻辑有发生变化，那么检查相关的需求文档和设计文档和相关的代码是否逻辑一致。如果不一致，则修改、更新文档。
7. 最后输出准备提交的commit message，用中文表达。commit message 的 title 需要表达修改的具体内容，需要通俗易懂。
