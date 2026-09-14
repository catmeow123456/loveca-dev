import { createHash } from 'node:crypto';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createGameSession } from '../../src/application/game-session';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { toTransport } from '../../src/online/serde';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { placeEnergyFromDeckToZone } from '../../src/application/effects/energy';
import { readFrozenBluePurpleDeck } from './ai-curated-decks';

/** Visible-resource fixtures, not reconstructed checkpoints or original hidden draw order. */
export function createLiveSetFixture(kind: 'T1' | 'T2' | 'KEEP_BRIDGES' | 'CHEER_POSSIBLE' = 'T1') {
  const deck = readFrozenBluePurpleDeck().deck;
  let randomCalls = 0;
  const session = createGameSession({
    now: () => 1000,
    randomInt: (max) => {
      randomCalls++;
      return max - 1;
    },
  });
  session.createGame('live-set-fixture', 'ai', 'AI', 'human', '真人');
  session.initializeGame(deck, deck);
  const card = (code: string) => {
    const value = deck.mainDeck.find((item) => item.cardCode === code);
    if (!value) throw new Error(`Missing frozen test card ${code}`);
    return value;
  };
  const hand =
    kind === 'KEEP_BRIDGES'
      ? ['PL!N-bp4-013-N', 'PL!N-bp3-009-R+']
      : kind === 'CHEER_POSSIBLE'
        ? ['PL!N-bp4-029-L']
        : [
            ...(kind === 'T1' ? ['PL!N-bp4-030-L'] : ['PL!N-bp4-004-P+']),
            'PL!N-bp4-013-N',
            'PL!N-bp3-020-N',
            'PL!N-bp3-020-N',
            'PL!N-bp4-004-P+',
            'PL!HS-PR-023-PR',
          ];
  const game = session.state!;
  const player = game.players[0];
  const pool = [...player.hand.cardIds, ...player.mainDeck.cardIds];
  Object.assign(player.hand, { cardIds: pool.slice(0, hand.length) });
  Object.assign(player.mainDeck, { cardIds: pool.slice(hand.length) });
  hand.forEach((code, index) => {
    const id = player.hand.cardIds[index]!;
    (game.cardRegistry as Map<string, CardInstance>).set(id, {
      ...game.cardRegistry.get(id)!,
      data: card(code),
    });
  });
  const stage = (data: MemberCardData, slot: SlotPosition) => {
    const id = player.mainDeck.cardIds[0]!;
    Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
    (game.cardRegistry as Map<string, CardInstance>).set(id, {
      ...game.cardRegistry.get(id)!,
      data,
    });
    Object.assign(player, {
      memberSlots: placeCardInSlot(player.memberSlots, slot, id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    });
  };
  stage(card('PL!-pb1-020-N') as MemberCardData, SlotPosition.LEFT);
  if (kind === 'T2' || kind === 'CHEER_POSSIBLE')
    stage(card('PL!SP-sd1-019-SD') as MemberCardData, SlotPosition.CENTER);
  Object.assign(
    session.state!,
    placeEnergyFromDeckToZone(session.state!, 'ai', kind === 'T2' ? 2 : 1, OrientationState.ACTIVE)!
      .gameState
  );
  const updatedPlayer = session.state!.players[0];
  for (const [index, id] of updatedPlayer.energyZone.cardIds.entries())
    (updatedPlayer.energyZone.cardStates as Map<string, unknown>).set(id, {
      ...updatedPlayer.energyZone.cardStates.get(id),
      orientation: kind === 'T2' && index < 3 ? OrientationState.ACTIVE : OrientationState.WAITING,
    });
  Object.assign(session.state!, {
    turnCount: kind === 'T2' ? 2 : 1,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  });
  const counts = new Map<string, { count: number; card: (typeof deck.mainDeck)[number] }>();
  for (const value of [...deck.mainDeck, ...deck.energyDeck])
    counts.set(value.cardCode, {
      card: value,
      count: (counts.get(value.cardCode)?.count ?? 0) + 1,
    });
  const content = JSON.stringify(toTransport({ cards: [...counts.values()] }));
  return {
    session,
    randomCalls: () => randomCalls,
    ownDeck: {
      id: 'deck:blue-purple-fixture',
      title: '蓝紫固定局面卡牌参考',
      source: 'FROZEN_LOCAL_TEST_CARD_FACTS',
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  };
}
