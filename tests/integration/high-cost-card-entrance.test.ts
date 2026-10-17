import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { isEntranceCard } from '../../src/shared/card-entrance';
import rows from '../helpers/high-cost-entrance-cards.json';

// The 13 printed records are copied from the user-authorized 2026-10-17 export.
// Keep real groups, units, costs and Chinese text: on-entry abilities must run after the barrier.
function fixture(row: (typeof rows)[number], energyCount = row.cost) {
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => 1000 });
  const filler: MemberCardData = {
    cardCode: 'FILLER',
    name: '测试成员',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [],
  };
  const deck = {
    mainDeck: Array.from({ length: 60 }, () => filler),
    energyDeck: Array.from({ length: 20 }, () => ({
      cardCode: 'ENERGY',
      name: '能量',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.createGame('high-cost-entrance', 'p1', '己方', 'p2', '对方');
  session.initializeGame(deck, deck);
  const source = { ...row, unitName: row.unitName ?? undefined } as unknown as MemberCardData;
  let state = registerCards(session.state!, [
    createCardInstance(source, 'p1', 'source'),
    createCardInstance(filler, 'p1', 'discard'),
  ]);
  const energy = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .slice(0, energyCount)
    .map((c) => c.instanceId);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['source', 'discard'] },
    energyZone: {
      ...p.energyZone,
      cardIds: energy,
      cardStates: new Map(
        energy.map((id) => [id, { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }])
      ),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return {
    session,
    play: () =>
      session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER)),
    ack: (playerId: string, entranceId: string) =>
      session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId,
        timestamp: 1000,
      }),
  };
}

describe('2026-10-18 high-cost entrance batch', () => {
  for (const row of rows) {
    it(`${row.cardCode}: pays the real cost and waits for both public seats`, () => {
      const f = fixture(row);
      expect(getCardEntranceProfile(row.cardCode)?.id).toBe(row.id);
      const played = f.play();
      expect(played.success, played.error).toBe(true);
      const pending = f.session.state!.entranceRuntime!.pending!;
      expect(pending.cardIds).toEqual(['source']);
      expect(f.session.state!.activeEffect).toBeNull();
      const p = f.session.state!.players[0];
      expect(
        p.energyZone.cardIds.filter(
          (id) => p.energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
        )
      ).toHaveLength(row.cost);
      const views = ['p1', 'p2'].map((id) => f.session.getPlayerViewState(id)!);
      expect(views[0]!.match.entrance).toEqual(views[1]!.match.entrance);
      for (const view of views) {
        expect(view.objects.obj_source?.frontInfo?.cardCode).toBe(row.cardCode);
        expect(view.match.entranceAssetIds).toContain(row.id);
      }
      expect(f.ack('p1', pending.id).success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending?.waitingPlayerIds).toEqual(['p2']);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.ack('p2', pending.id).success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.session.state!.players[0].memberSlots.slots.CENTER).toBe('source');
      expect(f.ack('p2', pending.id).success).toBe(false);
    });
  }
  for (const row of rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i)) {
    it(`${row.id}: failed payment does not enter, and all rarities share the identity`, () => {
      const f = fixture(row, row.cost - 1);
      expect(f.play().success).toBe(false);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.session.state!.players[0].hand.cardIds).toContain('source');
      const base = row.cardCode.slice(0, row.cardCode.lastIndexOf('-'));
      expect(getCardEntranceProfile(`${base}-FUTURE`)?.id).toBe(row.id);
      expect(isEntranceCard(`${base}-EXTRA-SEGMENT`)).toBe(false);
    });
  }
  it.each(['kanon', 'nico-ai-seras'])(
    '%s resumes its actual on-entry choice only after both acknowledgements',
    (id) => {
      const f = fixture(rows.find((r) => r.id === id)!);
      const deckBefore = [...f.session.state!.players[0].mainDeck.cardIds];
      expect(f.play().success).toBe(true);
      const pending = f.session.state!.entranceRuntime!.pending!;
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.session.state!.players[0].mainDeck.cardIds).toEqual(deckBefore);
      expect(f.ack('p1', pending.id).success).toBe(true);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.ack('p2', pending.id).success).toBe(true);
      expect(f.session.state!.activeEffect).not.toBeNull();
      expect(f.session.state!.activeEffect!.sourceCardId).toBe('source');
    }
  );
});
