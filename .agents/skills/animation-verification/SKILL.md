---
name: animation-verification
description: Verify Loveca battle animations and interactions against authoritative state, player visibility, and browser evidence. Use for battle motion, drag/drop, inspection/reveal, effect resolution, and board layout regressions; ordinary product-page styling does not require this skill.
---

# 对战动效与交互验证

默认开发者使用能力强的 agent 与 harness，自主选择验证方法与深度。本 skill 关注共享对战桌面的正确性与体验，不规定检查顺序、场景数量或工具组合。

## 验收判断

- **动作与状态一致**：玩家意图、提交命令、权威结果和最终画面应一致。动效结束不代表动作成功；卡牌区域、横置方向、选择状态与效果反馈不能脱离实际规则结果。
- **过程与终态完整**：既能理解正在发生什么，也能确认最后发生了什么。中断、取消、恢复或连续操作不应留下消失的卡牌、遮挡层或过期反馈；按当前改动判断相关风险。
- **玩家视角正确**：涉及 inspection、reveal 或私密区域时，以受影响玩家的实际授权投影为依据。隐藏信息泄漏属于正确性问题，不能靠视觉遮挡或单一玩家视角证明隔离有效。
- **任务持续可用**：适用模式、视口与减少动态设置下，关键状态和操作仍须清楚、可达。阻止玩家理解或完成动作的裁切、重叠、焦点丢失与错误终态应修复。

## 证据与范围

使用真实浏览器和实际运行组件检验相关过程与终态，证据应足以支持交付声明。静态截图、交互结果与规则测试各有边界，不能相互替代；验证规模由变更影响和剩余不确定性决定。

区分本地调试、正式联机、观战和回放的操作与可见性边界，按受影响范围验证。无法获得相关环境或玩家视角时，明确尚未验证的部分，不把局部通过扩展成全模式结论。

复用合适的运行环境，保护用户正在使用的对局；验证准备不构成推进、重置对局或修改账号数据的授权。临时证据放在 `output/playwright/`，提交范围遵守用户要求。

需要环境入口或测试物料时，参阅[本地验证资源](references/local-verification.md)。设计取舍见 [frontend-design](../frontend-design/SKILL.md)，实际截图的视觉评审见 [ui-screenshot-review](../ui-screenshot-review/SKILL.md)，按任务需要使用。
