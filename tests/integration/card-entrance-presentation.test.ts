import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  CardType,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { collectCardEntrances, emptyEntranceCursor } from '../../client/src/lib/cardEntranceEvents';

import {
  getEntranceStageTarget,
  sameEntranceTarget,
} from '../../client/src/lib/cardEntranceLanding';

const member: MemberCardData = {
  cardCode: 'PL!N-bp7-006-SEC',
  name: '近江彼方',
  cardType: CardType.MEMBER,
  cost: 17,
  blade: 5,
  hearts: [],
};
describe('entrance consumes authoritative public member entry', () => {
  it.each([
    ['PL!N-bp7-006-R+', '近江彼方', 17, 5],
    ['PL!N-bp7-006-SEC', '近江彼方', 17, 5],
    ['PL!SP-pb2-005-R', '叶月恋', 20, 6],
    ['PL!SP-pb2-005-PP', '叶月恋', 20, 6],
    ['PL!SP-pb2-008-R', '若菜四季', 17, 7],
    ['PL!SP-pb2-008-PP', '若菜四季', 17, 7],
  ] as const)(
    'uses real command events and public object IDs for %s',
    (cardCode, name, cost, blade) => {
      const session = createGameSession();
      const deck: DeckConfig = {
        mainDeck: Array.from({ length: 60 }, (_, i) => ({
          ...member,
          cardCode: `FILLER-${i}`,
          cost: 1,
        })),
        energyDeck: Array.from({ length: 12 }, (_, i) => ({
          cardCode: `E-${i}`,
          name: 'Energy',
          cardType: CardType.ENERGY,
        })),
      };
      session.createGame('entrance', 'p1', 'P1', 'p2', 'P2');
      session.initializeGame(deck, deck);
      const card = createCardInstance(
        { ...member, cardCode, name, cost, blade },
        'p1',
        'entrance-test'
      );
      let state = registerCards(session.state!, [card]);
      state = updatePlayer(state, 'p1', (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [card.instanceId] },
        energyZone: { ...p.energyZone, cardIds: [] },
      }));
      state = {
        ...state,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.MAIN_FREE,
        currentTurnType: TurnType.NORMAL,
        activePlayerIndex: 0,
        waitingPlayerId: null,
        waitingForInput: false,
      };
      (session as unknown as { authorityState: typeof state }).authorityState = state;
      const read = () => ({
        matchId: session.getPlayerViewState('p1')!.match.matchId,
        epoch: 0,
        seq: session.getCurrentPublicEventSeq(),
        events: session.getPublicEventsSince(0),
      });
      let cursor = collectCardEntrances(emptyEntranceCursor(), read()).cursor;
      const rejected = session.executeCommand(
        createPlayMemberToSlotCommand('p1', card.instanceId, SlotPosition.CENTER)
      );
      expect(rejected.success).toBe(false);
      const afterRejected = collectCardEntrances(cursor, read());
      expect(afterRejected.entrances).toEqual([]);
      cursor = afterRejected.cursor;
      session.setManualOperationMode('FREE');
      const played = session.executeCommand(
        createPlayMemberToSlotCommand('p1', card.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      );
      expect(played.success, played.error).toBe(true);
      const result = collectCardEntrances(cursor, read());
      expect(result.entrances).toHaveLength(1);
      for (const player of ['p1', 'p2']) {
        const view = session.getPlayerViewState(player)!;
        const id = result.entrances[0]!.objectId;
        expect(view.objects[id]?.frontInfo?.cardCode).toBe(cardCode);
        const target = getEntranceStageTarget(view, id)!;
        expect(target).toMatchObject({
          objectId: id,
          cardCode: cardCode,
          orientation: OrientationState.ACTIVE,
        });
        expect(sameEntranceTarget(target, getEntranceStageTarget(view, id))).toBe(true);
        const hidden = {
          ...view,
          objects: { ...view.objects, [id]: { ...view.objects[id]!, surface: 'BACK' as const } },
        };
        expect(getEntranceStageTarget(hidden, id)).toBeNull();
        const waiting = {
          ...view,
          objects: {
            ...view.objects,
            [id]: { ...view.objects[id]!, orientation: OrientationState.WAITING },
          },
        };
        expect(sameEntranceTarget(target, getEntranceStageTarget(waiting, id))).toBe(false);
        const below = {
          ...view,
          table: {
            ...view.table,
            zones: Object.fromEntries(
              Object.entries(view.table.zones).map(([key, z]) => [
                key,
                {
                  ...z,
                  slotMap: Object.fromEntries(
                    Object.entries(z.slotMap ?? {}).map(([slot, occupant]) => [
                      slot,
                      occupant === id ? null : occupant,
                    ])
                  ),
                  memberBelow: { CENTER: [id] },
                },
              ])
            ),
          },
        };
        expect(getEntranceStageTarget(below, id)).toBeNull();
        expect(
          Object.values(view.table.zones).some((z) => Object.values(z.slotMap ?? {}).includes(id))
        ).toBe(true);
      }
      expect(collectCardEntrances(result.cursor, read()).entrances).toEqual([]);
    }
  );
});
