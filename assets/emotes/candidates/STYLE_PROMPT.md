# Loveca 蓝发角色快捷表情统一风格提示词

## Shared master prompt

```text
Use case: style-transfer
Asset type: square in-game Loveca chat sticker/emote, displayed at 72–192 px

Create one sticker from the Loveca blue-haired chibi emote set. Treat the supplied sketch as the pose/expression reference and preserve the same recurring character model in every asset:
- dark cobalt-blue chin-length bob, one round hair bun on viewer-left, five chunky straight bang sections;
- exactly four small hair highlights: two electric-blue and two hot-pink;
- pale skin, oversized head, tiny upper body, white sailor-style top, gray collar, one small gold bow;
- thick rounded near-black outer line, thinner rounded inner lines, simple geometric hands, no detailed fingers.

Unified rendering rules:
- polished 2D hand-drawn meme sticker; flat cel colors with at most one simple shadow tone per shape;
- no glossy rendering, painterly texture, airbrush gradient, 3D lighting, photorealism, or fine hatching;
- stable palette: near-black #171329, cobalt #173F8F, blue highlight #1265E8, hot pink #F0278A, warm gold #FFC53D, warm white #FFFDF7, blush #FF8C9D;
- one continuous warm-white sticker keyline around the complete character/action silhouette, followed by a thin near-black edge so it works on light and dark themes;
- use only the set's shared comic marks: four-point sparkles, short tapered impact lines, round sweat drops, heart or music-note silhouettes. Use no more than six supporting marks total;
- square centered composition, headline in the top 24% and character/action in the lower 76%; keep at least 5% clear padding on every edge; no cropped text, hair, hands, or important props;
- prioritize one readable silhouette and one action. Avoid scattered decoration and tiny detail that disappears at 192 px.

Unified headline typography:
- exact requested phrase, large hand-lettered display type across the top;
- hot-pink fill #F0278A, thick warm-white outer stroke, thin near-black final edge;
- same visual height, weight, spacing, and slight upward arc across every sticker;
- no speech bubble and no other readable text.

Output background:
- perfectly flat solid #00ff00 chroma-key background, uniform edge-to-edge, with no shadow, gradient, texture, floor plane, reflection, or lighting variation;
- do not use #00ff00 anywhere in the sticker subject;
- no watermark, border, logo, official character art, or copied official card artwork.
```

## Per-emote scene blocks

### 跟你爆了！

```text
The character makes a reckless but deliberate Loveca LIVE setup decision: she leans forward with a fierce grin and one sweat drop while decisively slapping exactly three face-down LIVE cards into three separate placement slots. The three portrait card backs face the viewer in one clear row and use an original simplified hot-pink/white sparkle, heart, and music-note design. Add one gold impact burst and short downward motion lines. The action must read as committing this turn to three hidden LIVE cards. No chips, coins, money, dice, poker suits, casino table, betting pile, monocle, magnifying glass, or extra cards.
Text (verbatim): “跟你爆了！” — exactly 跟、你、爆、了 and one full-width exclamation mark.
```

### Oh no!

```text
The character faces forward and grabs both sides of her head. Use huge blank white oval eyes, a small rectangular open mouth, raised shoulders, one round sweat drop, and three short shock lines. The expression is immediate comic panic. Keep the hands, eyes, and mouth large enough to read at 192 px; no props.
Text (verbatim): “Oh no!” — capital O, lowercase h, one space, lowercase n, lowercase o, one exclamation mark.
```

### 我 LIVE 呢

```text
The character faces forward in exaggerated frustrated disbelief: red-flushed face, two stylized yellow flame eyes, a small fang-shaped open mouth, clenched tiny fists, two red anger marks, and two white steam puffs. The emotion is comic complaint, not threatening violence. Keep the same normal cobalt hair and white outfit; do not recolor the whole sticker red.
Text (verbatim): “我 LIVE 呢” — Chinese character 我, one space, uppercase L I V E, one space, Chinese character 呢; no punctuation.
```
