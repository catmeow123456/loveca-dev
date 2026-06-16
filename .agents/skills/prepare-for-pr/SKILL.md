---
name: prepare-for-pr
description: github pr操作的前期准备，包括通过git rebase引入main的commit，以及代码、文档规范检查
---

把当前分支合入 main 分支的前期准备，需要分析当前分支和 main 分支的差异，对于当前分支相对于main分支的修改：
1. 确认git版本号等于 2.54.0，不等于则中止任务
2. 使用命令 `git merge-tree --write-tree main HEAD > /dev/null 2>&1 && echo "无冲突" || echo "有冲突"` 判断当前分支是否和main分支有冲突；如果有冲突则提示用户进行rebase main操作，并中止任务；如果无冲突则继续分析。

一些实用的操作如下：
```bash
# 更新本地的main分支
git checkout main
git pull origin main
git checkout <当前分支>
# stash未stage的修改
git stash push -m "wip before rebase main"
git rebase main

# 如果 rebase 过程中出现冲突，Git 会暂停并提示：
# CONFLICT (content): Merge conflict in src/xxx.py

# 1. 查看哪些文件有冲突
git status

# 2. 打开冲突文件，手动解决冲突
#    冲突标记如下：
#    <<<<<<< HEAD
#    （main 分支的代码）
#    =======
#    （你的代码）
#    >>>>>>> your commit message

# 3. 编辑文件，保留正确的代码，删除冲突标记

# 4. 标记冲突已解决
git add <冲突文件>
# 例如:
git add src/xxx.py

# 5. 继续 rebase
git rebase --continue

# 如果还有下一个提交的冲突，重复步骤 1-5

# Rebase 完成后推送, 要特别注意不要对main分支执行
git push origin <当前分支> --force-with-lease

git stash pop
```

3. 对当前分支相对 main 的差异执行代码与文档静态检查，并给出结论。
   - 先阅读 `docs/README.md` 标出的主阅读路径和当前权威文档，再对照本 PR 改动判断代码、需求、设计、限制说明是否一致。
   - 检查代码、文档和配置是否引入 bug，是否符合当前系统设计，是否存在不合理实现、弱类型、妥协降级或静默吞错。
   - 重点检查代码行为是否仍符合 `docs/PROJECT_REQUIREMENTS.md`、`docs/current-limitations.md`、`docs/coding-standard/`、相关专题需求/设计文档，以及 PR 新增的长期文档。
   - 如果 PR 的核心目标合理但现有文档滞后，应先指出“文档滞后/规范需演进”和“实现确实有问题”的区别；需要时先修正文档，再列剩余真实矛盾点。
   - 如果代码引入新语义、命令、投影、卡牌数据字段、规则自动化或 UI 模式边界，应检查对应需求/设计/限制/文档地图是否同步更新。
   - 对新增长期文档，检查是否按 `docs/doc_writing_guide.md` 登记到 `docs/README.md`，并检查是否存在与旧权威文档重复或冲突的事实描述。
   - 检查差异中是否新增或修改 `PROJECT_PROGRESS_TODO_*.md`、临时 TODO、临时 PLAN、一次性 checklist 或只记录“本次/本阶段做了什么”的过程日志；除非用户明确要求或当前任务正式流程指定必须更新，否则应作为 PR 前阻塞项。已经废弃或被替代的旧方案若没有说明状态、背景、替代方案和保留原因，也应拦截。
   - 检查测试是否覆盖本 PR 的关键行为和风险边界；如果只补文档，也应至少执行合适的静态检查。
4. 无论是否引入了bug/是否合理/是否符合规范，都为pr编写description
5. 展示上述所有内容
