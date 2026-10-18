export interface CardSurfacePose {
  /** Degrees, with the same signs as CSS rotateX / rotateY. */
  tiltX: number;
  tiltY: number;
  /** Normalized distance above the tabletop, from 0 to 1. */
  lift: number;
}

export interface CardSurfacePoseFrame {
  offset: number;
  pose: CardSurfacePose;
  easing?: string;
}

export interface CardSurfaceLighting {
  setPose(pose: CardSurfacePose): void;
  animatePoses(
    frames: readonly CardSurfacePoseFrame[],
    options: KeyframeAnimationOptions
  ): Animation[];
  dispose(): void;
}

const bounded = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));

/**
 * A restrained paper/coating response for a positioned card wrapper.
 * The host owns all geometry, transforms and tabletop shadows. This helper only
 * appends its own non-interactive layers; it never changes the host's styles.
 * The resting rotation keeps the light fixed above the table's upper-left side,
 * including when a card is turned sideways. No textures or external code are used.
 */
export function attachCardSurfaceLighting(
  host: HTMLElement,
  { restingRotation = 0 }: { restingRotation?: number } = {}
): CardSurfaceLighting {
  const rotation = ((Number.isFinite(restingRotation) ? restingRotation : 0) * Math.PI) / 180;
  // Rotate the tabletop light into the card's resting local axes.
  const lightX = -0.6 * Math.cos(rotation) - 0.8 * Math.sin(rotation);
  const lightY = 0.6 * Math.sin(rotation) - 0.8 * Math.cos(rotation);
  const gradientAngle = (Math.atan2(-lightX, lightY) * 180) / Math.PI;
  const overlay = host.ownerDocument.createElement('div');
  overlay.dataset.cardSurfaceLighting = '';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: 'inherit',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '1',
  });

  const backgrounds = [
    // A soft coating reflection moves with the surface normal, not a separate sweep clock.
    `linear-gradient(${gradientAngle}deg, transparent 32%, rgba(245,248,255,.07) 42%, rgba(255,255,255,.46) 49%, rgba(245,248,255,.13) 55%, transparent 66%)`,
    `linear-gradient(${gradientAngle}deg, transparent 64%, rgba(18,21,26,.18) 100%)`,
    'none',
  ];
  const layers = backgrounds.map((background) => {
    const layer = host.ownerDocument.createElement('div');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: 'inherit',
      pointerEvents: 'none',
      background,
      opacity: '0',
    });
    overlay.append(layer);
    return layer;
  });
  layers[0].style.backgroundSize = '200% 200%';
  layers[2].style.boxShadow =
    `inset ${-lightX}px ${-lightY}px 0 rgba(255,255,255,.55), ` +
    `inset ${lightX}px ${lightY}px 0 rgba(18,21,26,.25)`;
  host.append(overlay);

  let disposed = false;
  let animations: Animation[] = [];
  const cancelAnimations = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
  };
  const appearance = ({ tiltX, tiltY, lift }: CardSurfacePose) => {
    const pitch = (bounded(tiltX, -75, 75) * Math.PI) / 180;
    const yaw = (bounded(tiltY, -75, 75) * Math.PI) / 180;
    const normalX = Math.sin(yaw);
    const normalY = -Math.sin(pitch) * Math.cos(yaw);
    const normalZ = Math.cos(pitch) * Math.cos(yaw);
    const facingChange = (normalX * lightX + normalY * lightY) * 0.5 + (normalZ - 1) * 0.866;
    const lean = Math.min(1, Math.hypot(pitch, yaw) / (Math.PI / 6));
    const exposure = lean * (0.85 + 0.15 * bounded(lift, 0, 1));
    // Flat cards remain completely unchanged, even when their wrapper is elevated.
    return {
      reflectionPosition: `${50 + normalX * 70}% ${50 + normalY * 70}%`,
      opacities: [
        exposure * bounded(0.58 + facingChange * 1.3, 0.12, 0.9),
        exposure * bounded(0.42 - facingChange, 0.12, 0.85),
        exposure * 0.72,
      ],
    };
  };

  return {
    setPose(pose) {
      if (disposed) return;
      cancelAnimations();
      const values = appearance(pose);
      layers[0].style.backgroundPosition = values.reflectionPosition;
      layers.forEach((layer, index) => {
        layer.style.opacity = String(values.opacities[index]);
      });
    },
    animatePoses(frames, options) {
      if (disposed) return [];
      cancelAnimations();
      if (!frames.length) return [];
      const values = frames.map(({ pose }) => appearance(pose));
      animations = layers.map((layer, layerIndex) =>
        layer.animate(
          frames.map(({ offset, easing }, frameIndex) => ({
            offset,
            ...(easing ? { easing } : {}),
            opacity: values[frameIndex].opacities[layerIndex],
            ...(layerIndex === 0
              ? { backgroundPosition: values[frameIndex].reflectionPosition }
              : {}),
          })),
          { fill: 'both', ...options }
        )
      );
      return [...animations];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimations();
      overlay.remove();
    },
  };
}
