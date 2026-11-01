import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DiscardPresentationBatch } from '@/components/game/BattleAnimationLayer';
import { CareCardFlight } from '@/components/game/kotori-ayumu-effects/CareCardFlight';
import {
  collectBattleAnimationAnchors,
  type BattleAnimationEvent,
} from '@/lib/battleAnimationEvents';
import type { CareEffectCue } from '@/lib/kotoriAyumuEffects';
import { ZoneType } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { imageFor } from './fixture';

/** QA controls replay the same physical-card renderers used by the live board. */
export function MovementPreview({
  cue,
  reduced,
  holdAt,
  timeScale = 1,
  onDone,
}: {
  cue: CareEffectCue;
  reduced: boolean;
  holdAt?: number;
  timeScale?: number;
  onDone: () => void;
}) {
  const events = useMemo(() => {
    const anchors = collectBattleAnimationAnchors(),
      view = useGameStore.getState().playerViewState;
    if (!view) return [];
    const zone = (name: string) => anchors.zones.get(`seat-${cue.ownerSeat}::${name}`);
    const hand =
      Object.values(view.table.zones).find(
        (z) => z.ownerSeat === cue.ownerSeat && z.zone === ZoneType.HAND
      )?.objectIds ?? [];
    const render = (id: string) => {
      const front = view.objects[id]?.surface === 'FRONT' ? view.objects[id].frontInfo : undefined;
      const surface = front ? ('FRONT' as const) : ('BACK' as const);
      return {
        objectId: id,
        cardId: '',
        surface,
        fromSurface: surface,
        toSurface: surface,
        cardCode: front?.cardCode,
      };
    };
    const movements: BattleAnimationEvent[] = [];
    if (cue.kind === 'KOTORI_INSPECT') {
      const id = hand[0],
        fromRect = anchors.cards.get(id) ?? zone('hand'),
        toRect = zone('waiting-room');
      if (id && fromRect && toRect)
        movements.push({
          id: 'preview-discard',
          kind: 'DISCARD_PRESENTATION_BATCH',
          cards: [{ render: render(id), fromRect }],
          toSeat: cue.ownerSeat,
          toZoneKey: `${cue.ownerSeat}_WAITING_ROOM`,
          toRect,
          kotoriCare: true,
        });
    } else if (cue.kind === 'KOTORI_KEEP') {
      const id = hand[0],
        fromRect = zone('inspection-zone') ?? zone('main-deck'),
        toRect = anchors.cards.get(id) ?? zone('hand');
      if (fromRect && toRect)
        movements.push({
          id: 'preview-keep',
          kind: 'CARD_MOVE',
          render: render(id ?? 'back'),
          fromRect,
          toRect,
          fromZoneType: ZoneType.INSPECTION_ZONE,
          toZoneType: ZoneType.HAND,
          careMovement: { kind: 'KOTORI_KEEP', delayMs: 0 },
        });
    } else
      for (const target of cue.targets) {
        const member = anchors.cards.get(target.memberId),
          energy = zone('energy-zone');
        if (member && energy)
          movements.push({
            id: `preview-${target.memberId}`,
            kind: 'CARD_MOVE',
            render: render(target.energyId),
            fromRect: cue.kind === 'AYUMU_GIVE' ? energy : member,
            toRect:
              cue.kind === 'AYUMU_GIVE'
                ? ((Object.values(view.table.zones).some((z) =>
                    Object.values(z.overlays ?? {})
                      .flat()
                      .includes(target.energyId)
                  )
                    ? anchors.cards.get(target.energyId)
                    : undefined) ?? {
                    ...member,
                    left: member.left - member.width * 0.1,
                    top: member.top + member.height * 0.1,
                  })
                : energy,
            fromZoneType: ZoneType.ENERGY_ZONE,
            toZoneType: ZoneType.MEMBER_SLOT,
            careMovement: {
              kind: cue.kind,
              delayMs: 0,
              receiver:
                cue.kind === 'AYUMU_GIVE' ? { objectId: target.memberId, rect: member } : undefined,
            },
          });
      }
    return movements;
  }, [cue]);
  useLayoutEffect(() => {
    const owned = events.filter(
      (e) => e.kind === 'CARD_MOVE' && e.careMovement?.kind === 'AYUMU_GIVE'
    );
    const store = useGameStore.getState();
    store.addBattleAnimationOcclusions(
      owned.map((e) => ({
        eventId: `care-preview:${e.id}`,
        objectId: e.kind === 'CARD_MOVE' ? e.render.objectId : '',
      }))
    );
    return () => owned.forEach((e) => store.removeBattleAnimationOcclusion(`care-preview:${e.id}`));
  }, [events]);
  const [finished, setFinished] = useState<string[]>([]),
    done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!events.length || finished.length === events.length) done.current();
  }, [events, finished]);
  useEffect(() => {
    if (!reduced || holdAt !== undefined) return;
    const id = window.setTimeout(() => done.current(), 800 / timeScale);
    return () => clearTimeout(id);
  }, [reduced, holdAt, timeScale]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[97]" aria-hidden="true">
      {events
        .filter((e) => !finished.includes(e.id))
        .map((e) =>
          e.kind === 'DISCARD_PRESENTATION_BATCH' ? (
            <DiscardPresentationBatch
              key={e.id}
              event={e}
              getCardImagePath={imageFor}
              reduceMotion={reduced}
              holdAt={holdAt}
              timeScale={timeScale}
              onDone={() => setFinished((x) => [...x, e.id])}
            />
          ) : e.kind === 'CARD_MOVE' ? (
            reduced ? (
              <div
                key={e.id}
                style={{
                  position: 'fixed',
                  left: e.toRect.left,
                  top: e.toRect.top,
                  width: e.toRect.width,
                  height: e.toRect.height,
                  border: '2px solid #d6b5cc',
                  borderRadius: 8,
                }}
              />
            ) : (
              <CareCardFlight
                key={e.id}
                event={e}
                imagePath={e.render.cardCode ? imageFor(e.render.cardCode) : '/back.jpg'}
                holdAt={holdAt}
                timeScale={timeScale}
                onDone={() => setFinished((x) => [...x, e.id])}
              />
            )
          ) : null
        )}
    </div>
  );
}
