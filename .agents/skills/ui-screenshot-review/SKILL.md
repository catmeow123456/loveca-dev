---
name: ui-screenshot-review
description: Read and review actual UI screenshots after designing or refactoring an interface, then feed findings back into the current implementation. Also use for direct screenshot review requests. Applies once screenshots are available; ordinary frontend changes without screenshots do not trigger this skill.
---

# UI 截图评审

实际打开并阅读截图，不以截图文件存在、DOM 摘要或代码推测代替读图。先确认页面面向谁、要完成什么、截图的角色与状态，再按这些目标评审。

- **任务与下一步**：主要动作是否清楚、相关信息是否足以支持决定；首页、列表、详情等页面各有职责，不要求所有信息都挤在当前画面。
- **交互与预期**：看起来可操作的区域是否有对应动作、反馈与可访问入口。静态截图不能证明可点击或可用；影响判断时再查 DOM 或实际操作。
- **信息价值**：检查重复数据、没有动作的大块展示、挤占任务空间的诊断或说明。细节已能通过合理入口查看时，不一律判为缺失；数量增加时仍应保持主要入口稳定。
- **视觉与适配**：检查主次、分组、产品身份、文字对比和可读性，以及窄屏、滚动、长名称和内容增长的影响；不用固定配色、卡片风格或某次方案作为通用标准。

依据实际画面区分可见事实、对玩家影响的推断与审美选择。管理员视图或测试数据造成的现象，不直接泛化给普通用户。证据不足时，按当前问题补最少的状态、滚动位置或手机截图，无需固定全套。

仅报告值得处理的问题，简写“位置／事实／影响／建议”，按影响排序，不强凑条数；没有阻塞项就明确说明。实施任务中修正范围内问题后，再阅读新截图；纯评审保持只读。无法确认的行为或未覆盖状态应说明边界，不因评审擅自扩展任务。

需要确认项目风格时，参阅[产品视觉系统](../../../docs/ui-design/product-visual-system.md)与[前端规范](../../../docs/ui-design/standard.md)。
