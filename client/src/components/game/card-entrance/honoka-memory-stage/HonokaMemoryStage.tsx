import { CardEffectText } from '@/components/card/CardEffectText';
import { MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';
import {
  center,
  hasMemoryPresentation,
  memoryDuration,
  mix,
  progress,
  smooth,
  type HonokaMemoryCue,
  type MemoryLayout,
  type MemoryCardFace,
} from './honokaMemoryTimeline';
import './honokaMemoryStage.css';

function CardFace({
  face,
  x,
  y,
  width,
  opacity,
  tilt = 0,
  turn = 0,
  rotation = 0,
  projection = false,
}: {
  face: MemoryCardFace;
  x: number;
  y: number;
  width: number;
  opacity: number;
  tilt?: number;
  turn?: number;
  rotation?: number;
  projection?: boolean;
}) {
  return (
    <div
      className={`honoka-memory-card${projection ? ' honoka-memory-card--projection' : ''}`}
      style={{
        left: x,
        top: y,
        width,
        height: width * (face.landscape ? 0.7142857 : 1.4),
        opacity,
        transform: `translate(-50%, -50%) perspective(700px) rotateZ(${rotation}deg) rotateX(${tilt}deg) rotateY(${turn}deg)`,
      }}
    >
      <img src={face.image} alt={face.name} />
      <span className="honoka-memory-card-sheen" />
    </div>
  );
}

/** Same score token and ALL-heart bitmap as the normal effect feedback. */
function Rewards({ cue }: { cue: HonokaMemoryCue }) {
  return (
    <>
      {cue.scoreGranted && (
        <div className="honoka-memory-reward" aria-label="LIVE 分数 +1">
          <small>LIVE</small>
          <CardEffectText as="span" text="[スコア]" />
          <b>+1</b>
        </div>
      )}
      {cue.heartGranted && (
        <div className="honoka-memory-reward" aria-label="此成员 ALL 心 +1">
          <small>此成员</small>
          <img src={MODIFIER_ICON_SOURCE.heart_all} alt="ALL 心" />
          <b>+1</b>
        </div>
      )}
    </>
  );
}

/** A seekable cosmetic renderer. It never reads game state, chooses targets, or resolves effects. */
export function HonokaMemoryStage({
  cue,
  elapsed,
  reduced,
  layout,
}: {
  cue: HonokaMemoryCue;
  elapsed: number;
  reduced: boolean;
  layout: MemoryLayout;
}) {
  if (!hasMemoryPresentation(cue) || elapsed >= memoryDuration(cue, reduced)) return null;
  const member = center(layout.member),
    success = center(layout.success);
  const bounds = layout.board;
  const narrow = bounds.width < 700;
  const presentationWidth = Math.min(narrow ? 260 : 360, bounds.width * 0.72, bounds.height * 0.5);
  const sx = Math.max(
    bounds.x + presentationWidth / 2 + 8,
    Math.min(bounds.x + bounds.width - presentationWidth / 2 - 8, member.x)
  );
  // On the far side, leave space below the member toward the table's center.
  // The narrow layout displays only the selected player's side.
  const rewardY =
    layout.sourceSide === 'opponent' && !narrow
      ? Math.min(bounds.y + bounds.height - 64, layout.member.y + layout.member.height + 153)
      : Math.max(bounds.y + 145, layout.member.y - (narrow ? 44 : 53));
  const rewardX = Math.max(bounds.x + 145, Math.min(bounds.x + bounds.width - 145, member.x));
  const build = smooth(progress(elapsed, 0, cue.part === 'recovery' ? 400 : 350));
  const exit = smooth(
    progress(elapsed, cue.part === 'recovery' ? 770 : 1160, cue.part === 'recovery' ? 230 : 240)
  );
  const opacity = build * (1 - exit);
  const light = smooth(progress(elapsed, 650, 380));
  const recovered = cue.recovered;
  const onlyRecovery = cue.recoveryReady && !cue.scoreGranted && !cue.heartGranted;

  if (reduced)
    return (
      <div className="honoka-memory-presentation" aria-label="穗乃果回忆舞台">
        <div className="honoka-memory-reduced" style={{ left: rewardX, top: rewardY }}>
          <div className="honoka-memory-reward-row">
            <Rewards cue={cue} />
          </div>
          {recovered && <span>{recovered.name} → 手牌</span>}
          {onlyRecovery && !recovered && <span>选择回收 μ’s 卡</span>}
        </div>
      </div>
    );

  const cards = cue.memories.slice(0, 3);
  // Reserve the same clear strip above the member for both grants. A portrait memory
  // grows upward, so its lower edge never falls into the reward row or the source face.
  const memoryBottom = rewardY - 12;
  const maxFaceRatio = Math.max(
    0.7142857,
    ...cards.map((face) => (face.landscape ? 0.7142857 : 1.4))
  );
  const cardWidth = Math.min(
    presentationWidth * (cards.length > 2 ? 0.29 : 0.44),
    Math.max(24, memoryBottom - bounds.y - 116) / maxFaceRatio
  );
  const fanSpacing = Math.min(
    presentationWidth * (cards.length > 2 ? 0.29 : 0.46),
    cardWidth * 1.06
  );
  const travel = smooth(progress(elapsed, 120, 740));
  const from = center(layout.waiting),
    to = center(layout.hand);
  const mid = { x: member.x, y: member.y - layout.member.height * 0.45 };
  const rx = (1 - travel) ** 2 * from.x + 2 * (1 - travel) * travel * mid.x + travel ** 2 * to.x;
  const ry = (1 - travel) ** 2 * from.y + 2 * (1 - travel) * travel * mid.y + travel ** 2 * to.y;
  return (
    <div className="honoka-memory-presentation" aria-label="穗乃果回忆舞台" data-part={cue.part}>
      {cue.part === 'rewards' && (
        <>
          {cards.map((face, i) => {
            const p = smooth(progress(elapsed, 35 + i * 55, 490));
            const spread = smooth(progress(elapsed, 240, 410));
            const offset = i - (cards.length - 1) / 2;
            const height = cardWidth * (face.landscape ? 0.7142857 : 1.4);
            const endX = sx + offset * fanSpacing * spread;
            const endY = Math.max(
              bounds.y + 110 + height / 2,
              memoryBottom - height / 2 - Math.abs(offset) * 4
            );
            return (
              <CardFace
                key={face.objectId}
                face={face}
                projection
                x={mix(success.x, endX, p)}
                y={mix(success.y, endY, p) - Math.sin(p * Math.PI) * presentationWidth * 0.08}
                width={mix(Math.min(layout.success.width, cardWidth), cardWidth, p)}
                opacity={progress(elapsed, 35 + i * 55, 150) * (1 - exit) * 0.88}
                tilt={mix(58, 4, p)}
                turn={mix(-65, offset * -12, p)}
                rotation={offset * -5 * spread}
              />
            );
          })}
          <div
            className="honoka-memory-source-light"
            aria-hidden="true"
            style={{
              left: layout.member.x - 2,
              top: layout.member.y - 2,
              width: layout.member.width + 4,
              height: layout.member.height + 4,
              opacity:
                cue.scoreGranted || cue.heartGranted
                  ? Math.sin(light * Math.PI) * (1 - exit) * 0.45
                  : 0,
            }}
          />
          {(cue.scoreGranted || cue.heartGranted) && (
            <div
              className="honoka-memory-reward-row honoka-memory-reward-row--floating"
              style={{
                left: rewardX,
                top: rewardY,
                opacity: smooth(progress(elapsed, 650, 140)) * (1 - exit),
              }}
            >
              <Rewards cue={cue} />
            </div>
          )}
          {onlyRecovery && (
            <div
              className="honoka-memory-recovery-cue"
              style={{
                left: rewardX,
                top: rewardY + 18,
                opacity: progress(elapsed, 700, 140) * (1 - exit),
              }}
            >
              选择 1 张 μ’s 卡回到手牌
            </div>
          )}
        </>
      )}
      {cue.part === 'recovery' && recovered && (
        <>
          <div
            className="honoka-memory-passage"
            style={{
              left: (from.x + 2 * mid.x + to.x) / 4,
              top: (from.y + 2 * mid.y + to.y) / 4,
              width: presentationWidth * 0.4,
              height: presentationWidth * 0.46,
              opacity,
            }}
          >
            <i style={{ transform: `perspective(300px) rotateY(${-70 * build}deg)` }} />
            <i style={{ transform: `perspective(300px) rotateY(${70 * build}deg)` }} />
          </div>
          <CardFace
            face={recovered}
            x={rx}
            y={ry}
            width={
              mix(
                Math.min(100, presentationWidth * 0.32),
                Math.min(82, layout.hand.width),
                travel
              ) *
              (1 + Math.sin(travel * Math.PI) * 0.2)
            }
            tilt={-12 * Math.sin(travel * Math.PI)}
            turn={18 * Math.sin(travel * Math.PI)}
            opacity={progress(elapsed, 0, 100) * (1 - progress(elapsed, 850, 150))}
          />
          <div
            className="honoka-memory-recovery-label"
            style={{
              left: rx,
              top: ry + 55,
              opacity: progress(elapsed, 100, 100) * (1 - progress(elapsed, 720, 180)),
            }}
          >
            回到手牌
          </div>
        </>
      )}
    </div>
  );
}
