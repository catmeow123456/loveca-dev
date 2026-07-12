import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { clearLiveStartSuppressionsUntilLiveEnd } from '../../src/domain/rules/live-start-suppressions';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCardData(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly groupNames?: readonly string[];
  readonly cost?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createKanon(): CardInstance {
  return createCardInstance(
    createMemberCardData({
      cardCode: 'PL!SP-bp2-001-P＋',
      name: '澁谷かのん',
      groupNames: ['Liella!'],
      cost: 13,
    }),
    PLAYER1,
    'kanon'
  );
}

function createNatsumi(id: string): CardInstance {
  return createCardInstance(
    createMemberCardData({
      cardCode: 'PL!SP-bp2-009-P',
      name: '鬼塚夏美',
      groupNames: ['Liella!'],
      cost: 13,
    }),
    PLAYER1,
    id
  );
}

function createPlainLiella(id: string): CardInstance {
  return createCardInstance(
    createMemberCardData({
      cardCode: 'PL!SP-test-plain-liella',
      name: 'Plain Liella member',
      groupNames: ['Liella!'],
    }),
    PLAYER1,
    id
  );
}

function createNonLiellaLiveStartMember(id: string): CardInstance {
  return createCardInstance(
    createMemberCardData({
      cardCode: 'PL!SP-bp2-009-P',
      name: 'Non Liella Natsumi shape',
      groupNames: ['Aqours'],
      cost: 13,
    }),
    PLAYER1,
    id
  );
}

function setupGame(options: {
  readonly target?: CardInstance;
  readonly other?: CardInstance;
  readonly waitingCards?: readonly CardInstance[];
}): {
  readonly game: GameState;
  readonly kanon: CardInstance;
  readonly target: CardInstance | null;
  readonly other: CardInstance | null;
  readonly waitingCards: readonly CardInstance[];
} {
  const kanon = createKanon();
  const target = options.target ?? null;
  const other = options.other ?? null;
  const waitingCards = options.waitingCards ?? [];
  const cards = [kanon, ...(target ? [target] : []), ...(other ? [other] : []), ...waitingCards];

  let game = createGameState('sp-bp2-001-kanon', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, kanon.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (target) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (other) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, other.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      memberSlots,
      waitingRoom: waitingCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
    };
  });
  game = queueKanonOnEnter(game, kanon.instanceId);

  return { game, kanon, target, other, waitingCards };
}

function queueKanonOnEnter(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'pending-sp-bp2-001-kanon',
    abilityId: SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-kanon'],
    sourceSlot: SlotPosition.RIGHT,
  };
  return {
    ...game,
    pendingAbilities: [pendingAbility],
  };
}

function startKanonEffect(game: GameState): GameState {
  const state = resolvePendingCardEffects(game).gameState;
  expect(state.activeEffect).not.toBeNull();
  expect(state.activeEffect?.abilityId).toBe(
    SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID
  );
  return state;
}

function suppressTargetWithoutRecovery(game: GameState, targetCardId: string): GameState {
  let state = startKanonEffect(game);
  state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, targetCardId);
  expect(state.activeEffect).toBeNull();
  return state;
}

function enqueueLiveStart(game: GameState): GameState {
  return enqueueTriggeredCardEffects(
    {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    [TriggerCondition.ON_LIVE_START]
  );
}

function liveStartPendingFor(game: GameState, sourceCardId: string): readonly PendingAbilityState[] {
  return game.pendingAbilities.filter(
    (ability) =>
      ability.abilityId === SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID &&
      ability.sourceCardId === sourceCardId
  );
}

describe('PL!SP-bp2-001-P＋ Kanon on-enter live-start suppression workflow', () => {
  it('selects a Liella stage member, writes suppression, and recovers one Liella card', () => {
    const target = createNatsumi('target-natsumi');
    const waitingCard = createPlainLiella('waiting-liella');
    let state = startKanonEffect(setupGame({ target, waitingCards: [waitingCard] }).game);

    expect(state.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, target.instanceId);
    expect(state.liveStartSuppressions).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        suppressedMemberCardId: target.instanceId,
        abilityId:
          SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
        expiresAt: 'LIVE_END',
      }),
    ]);
    expect(state.activeEffect?.selectableCardIds).toEqual([waitingCard.instanceId]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, waitingCard.instanceId);
    const player = getPlayerById(state, PLAYER1)!;
    expect(player.hand.cardIds).toContain(waitingCard.instanceId);
    expect(player.waitingRoom.cardIds).not.toContain(waitingCard.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('does not enqueue the selected member live-start ability at the next live start', () => {
    const target = createNatsumi('target-natsumi');
    let state = suppressTargetWithoutRecovery(setupGame({ target }).game, target.instanceId);

    state = enqueueLiveStart(state);

    expect(liveStartPendingFor(state, target.instanceId)).toEqual([]);
  });

  it('does not affect another member live-start ability', () => {
    const target = createNatsumi('target-natsumi');
    const other = createNatsumi('other-natsumi');
    let state = suppressTargetWithoutRecovery(setupGame({ target, other }).game, target.instanceId);

    state = enqueueLiveStart(state);

    expect(liveStartPendingFor(state, target.instanceId)).toEqual([]);
    expect(liveStartPendingFor(state, other.instanceId)).toHaveLength(1);
  });

  it('declines without suppression or recovery', () => {
    const target = createNatsumi('target-natsumi');
    const waitingCard = createPlainLiella('waiting-liella');
    let state = startKanonEffect(setupGame({ target, waitingCards: [waitingCard] }).game);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, null);

    const player = getPlayerById(state, PLAYER1)!;
    expect(state.liveStartSuppressions).toEqual([]);
    expect(player.hand.cardIds).not.toContain(waitingCard.instanceId);
    expect(player.waitingRoom.cardIds).toContain(waitingCard.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('no-ops when there is no legal Liella target with implemented live-start ability', () => {
    const plainLiella = createPlainLiella('plain-liella');
    const nonLiella = createNonLiellaLiveStartMember('non-liella');
    const waitingCard = createPlainLiella('waiting-liella');
    const state = resolvePendingCardEffects(
      setupGame({ target: plainLiella, other: nonLiella, waitingCards: [waitingCard] }).game
    ).gameState;

    const player = getPlayerById(state, PLAYER1)!;
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveStartSuppressions).toEqual([]);
    expect(player.hand.cardIds).not.toContain(waitingCard.instanceId);
    expect(player.waitingRoom.cardIds).toContain(waitingCard.instanceId);
  });

  it('keeps suppression when no Liella card can be recovered from waiting room', () => {
    const target = createNatsumi('target-natsumi');
    const state = suppressTargetWithoutRecovery(setupGame({ target }).game, target.instanceId);

    expect(state.liveStartSuppressions).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        suppressedMemberCardId: target.instanceId,
        expiresAt: 'LIVE_END',
      }),
    ]);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('clears the suppression at live end so the member can trigger in a later live', () => {
    const target = createNatsumi('target-natsumi');
    let state = suppressTargetWithoutRecovery(setupGame({ target }).game, target.instanceId);

    state = clearLiveStartSuppressionsUntilLiveEnd(state);
    state = enqueueLiveStart(state);

    expect(state.liveStartSuppressions).toEqual([]);
    expect(liveStartPendingFor(state, target.instanceId)).toHaveLength(1);
  });
});
