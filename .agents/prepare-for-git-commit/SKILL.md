---
name: prepare-for-git-commit
description: git commit操作的前期准备，包括代码规范检查，以及commit message编写
---

步骤：
1. 检查代码是否引入了bug，是否合理
2. 分析git暂存区的代码修改是否符合 docs/coding-standard 文件夹中的规范，并给出结论
3. 无论是否引入了bug/是否合理/是否符合规范，都根据git暂存区的代码修改编写commit message
4. 如果代码有发生变化，那么检查代码架构文档 CLAUDE.md 和游戏系统设计文档 docs/PROJECT_REQUIREMENTS.md 或者其他文档是否需要更新保持与最新的项目代码一致，如果不一致，则修改、更新这些文档以反映最新的代码架构和实现细节。
5. 如果业务逻辑有发生变化，那么检查相关的需求文档和设计文档和相关的代码是否逻辑一致。如果不一致，则修改、更新文档。
6. 最后输出准备提交的commit message
