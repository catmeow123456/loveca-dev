# 落场冲击纹理

四张 PNG 原字节取自 tktk 的 **Effects vol.2**：

- 官方下载：https://effekseer.github.io/contributes/tktk02.zip
- 官方样例与使用说明：https://effekseer.github.io/en/contributes/tktk02/index.html
- 授权依据：https://effekseer.github.io/en/contribute.html 的 **Sample Effects / CC-0 License** 区域，列有 tktk Effects vol.2。
- CC0 1.0：https://creativecommons.org/publicdomain/zero/1.0/

| 文件 | 字节数 | 原包路径 / 实际引用示例 |
| --- | ---: | --- |
| Particle02.png | 3253 | Parts/Particle02.png；Blow3.efkproj → impactNull2 → Glow |
| Line6.png | 1030 | Parts/Line6.png；Blow3.efkproj → impactNull → Angle → Move → LineMain |
| Particle01.png | 2982 | Parts/Particle01.png；Blow3.efkproj → BlowNull → Move → particleNull → Angle → Move → particleMain |
| Shock_wave_ring0011.png | 6811 | Parts/Shock_wave_ring0011.png；Blow2.efkproj → impactNull → RIngNull → Angle → giza_uti |

合计 14,076 字节，保留原始黑底亮度贴图；运行时转换为透明度并染成冰蓝白，供局部 Canvas 加法叠加。没有导入 Effekseer 引擎、完整工程或未使用素材。环形纹理由原始条状纹理在加载时作一次极坐标采样，原PNG不变。本项目自行编排平面扩散环、短促中心光、长短不一的射线与少量碎光，并按真实场上卡牌四角遮挡；并非完整移植官方演示，也未确认预览 01.gif 对应哪份 Blow 工程。

卡面角度受光的视觉参考为 https://poke-holo.simey.me/#%E2%9A%93-common 的普通卡示例；实现为本项目自行编写，不使用该 GPL 项目的代码、样式或宝可梦图像。
