# 设计目标与研究依据

用于澄清设计目标、处理冲突或开展进一步调研。以下包含学术研究、标准与工业经验；主 skill 的目标是结合这些材料和项目工程约束形成的设计判断，不是某篇论文给出的统一评分公式。

## 可用性与评价目标

- **任务结果依赖使用情境。** ISO 9241-11 将可用性联系到特定用户、目标和情境中的有效性、效率与满意度。有效性关心是否正确完成，效率关心投入的时间与精力，满意度包含使用感受。应用时明确谁在什么条件下做什么，而不是为所有页面使用同一套权重。[ISO 9241-220 官方术语页，引用 9241-11 的定义](https://www.iso.org/obp/ui?_escaped_fragment_=iso%3Astd%3Aiso%3A9241%3A-220%3Aed-1%3Av1%3Aen)

- **UI 优化涉及多个相互关联的目标。** Oulasvirta 等在 _Combinatorial Optimization of Graphical User Interface Designs_（Proceedings of the IEEE, 2020）中综述了利用人类感知、行为和体验模型优化 GUI 的方法。对本 skill 的启发是把任务表现、体验与技术约束一起考虑；模型预测只覆盖其假设，不能替代真实使用评价，也不意味着日常设计需要实现优化求解器。[作者机构的论文页面](https://research.aalto.fi/en/publications/combinatorial-optimization-of-graphical-user-interface-designs/)

- **从目标选择信号与指标。** Rodden、Hutchinson 与 Fu 的 HEART（CHI 2010）区分满意感受、参与、采用、留存和任务成功，并强调从目标选择指标。可按任务选择完成率、错误、耗时和主观反馈；框架不要求每类都测量。点击量、访问量或停留时长可能有多种解释，大规模行为数据也不能替代形成性研究。[论文与作者版入口](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/)

## 视觉、理解与交互

- **审美与实际使用需要分别评价。** Hassenzahl 的 _The Interplay of Beauty, Goodness, and Usability in Interactive Products_（Human–Computer Interaction, 2004）用四种 MP3 播放器皮肤研究实用、享乐与审美评价，发现总体评价与感知可用性、享乐属性有关，美感与实际使用的关系也不相同。这支持把愉悦、认同与可用性同时纳入考虑；实验不支持某种配色、极简程度或装饰量普遍最优。[作者上传的论文](https://www.researchgate.net/publication/233864402_The_Interplay_of_Beauty_Goodness_and_Usability_in_Interactive_Products)

- **可理解、可预测、可恢复。** Nielsen 的启发式关注状态可见、用户语言、一致性、识别而非记忆、用户控制、错误预防与恢复，以及内容相关性。可据此检查当前任务哪里需要猜测、记忆或重复操作。这些是诊断方向，不是规定组件外观的规范；精简的依据是信息与任务的关系。[NN/g：10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)

## 无障碍与工程

- **无障碍有可检验的要求。** WCAG 2.2 从可感知、可操作、可理解和健壮性组织要求；涉及对比度、键盘、焦点、目标尺寸、重排、状态消息与输入错误时，查对应条款及适用条件。满足标准仍需结合实际用户与任务判断体验。[W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

- **性能应对应用户感受到的结果。** Web Vitals 分别关注加载、交互与视觉稳定性，可作为排查等待、卡顿和页面跳动的入口。按目标设备与实际使用测量，并结合应用内长时交互判断；网站性能分数不能独立代表整体 UX。[Google：Web Vitals](https://web.dev/articles/vitals)

组件复用、状态归属、权限、异步正确性、可维护性和验证成本是项目工程约束，按仓库架构与实际风险判断；不要把它们包装成某项 HCI 实验已经证明的结论。进一步调研应围绕当前未知问题选择资料，并核对研究对象、任务、设备和测量方式能否迁移到本项目。
