import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfigContext, useReducedMotion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { useBattleEffectsEnabled } from '@/lib/battleEffects';
import { canPresentCardEntrance } from '@/lib/cardEntrancePolicy';
import {
  collectBattleAnimationAnchors,
  type BattleAnimationRect,
} from '@/lib/battleAnimationEvents';
import {
  getNicoEvidencePresentation,
  isNicoEvidenceCurrent,
  type NicoEvidencePresentation,
} from '@/lib/nicoEvidence';
import { NicoEvidencePlayback } from './NicoEvidencePlayback';

type Flight = NicoEvidencePresentation & { from?: BattleAnimationRect };

/** Cosmetic view diff only: selection, payment, stacking and modifiers remain in the rule engine. */
export function NicoEffectsLayer() {
  const view = useGameStore((s) => s.playerViewState);
  const epoch = useGameStore((s) => s.publicBattleLog.presentationEpoch);
  const eligible = useGameStore((s) => canPresentCardEntrance(s.getBattleSurfaceCapabilities()));
  const enabled = useBattleEffectsEnabled() && eligible;
  const config = useContext(MotionConfigContext);
  const osReduced = useReducedMotion();
  const reduced =
    config.reducedMotion === 'always' || (config.reducedMotion !== 'never' && !!osReduced);
  const previous = useRef({ view, epoch, enabled, anchors: collectBattleAnimationAnchors() });
  const [flights, setFlights] = useState<Flight[]>([]);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { view, epoch, enabled, anchors: collectBattleAnimationAnchors() };
    if (
      !view ||
      !before.view ||
      !enabled ||
      !before.enabled ||
      before.epoch !== epoch ||
      view.match.matchId !== before.view.match.matchId ||
      view.match.viewerSeat !== before.view.match.viewerSeat ||
      view.match.seq < before.view.match.seq
    ) {
      setFlights([]);
      return;
    }
    const cue = getNicoEvidencePresentation(before.view, view);
    setFlights((current) => [
      ...current.filter((item) => isNicoEvidenceCurrent(view, item)),
      ...(cue
        ? [
            {
              ...cue,
              // The opponent only has an anonymous hand anchor. Identity comes exclusively from
              // the successful public stack in the NEXT view, never from hidden hand data.
              from:
                before.anchors.cards.get(cue.cardId) ??
                before.anchors.zones.get(`seat-${cue.ownerSeat}::hand`),
            },
          ]
        : []),
    ]);
  }, [view, epoch, enabled]);
  if (!enabled) return null;
  return (
    <>
      {flights.map((cue) => (
        <NicoEvidencePlayback
          key={cue.key}
          cue={cue}
          from={cue.from}
          reduced={reduced}
          onDone={() => setFlights((current) => current.filter((item) => item.key !== cue.key))}
        />
      ))}
    </>
  );
}
