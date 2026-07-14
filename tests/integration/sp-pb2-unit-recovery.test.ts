import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
  SP_PB2_019_ON_ENTER_DISCARD_RECOVER_FIVEYNCRISE_CARD_ABILITY_ID,
  SP_PB2_021_ON_ENTER_DISCARD_RECOVER_KALEIDOSCORE_CARD_ABILITY_ID,
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

function createMember(cardCode: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, unitName: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function setupState(options: {
  readonly sourceCardCode: string;
  readonly handCards: readonly CardInstance[];
  readonly waitingCards?: readonly CardInstance[];
}): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode, 'Liella!'),
    PLAYER1,
    'source'
  );
  let game = createGameState('sp-pb2-unit-recovery', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.handCards, ...(options.waitingCards ?? [])]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    hand: options.handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    waitingRoom: (options.waitingCards ?? []).reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));

  return { game, sourceId: source.instanceId };
}

function startAbility(game: GameState, abilityId: string, sourceCardId: string): GameState {
  const pending: PendingAbilityState = {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
}

function selectDiscard(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, cardId);
}

function selectRecovery(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, cardId);
}

function skipEffect(game: GameState): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id);
}

describe('PL!SP-pb2 on-enter discard recover unit card workflows', () => {
  it('PL!SP-pb2-015 recovers a CatChu! card from waiting room', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', '5yncri5e!'), PLAYER1, 'discard');
    const target = createCardInstance(createMember('PL!SP-test-catchu', 'CatChu!'), PLAYER1, 'catchu');
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-015-R',
      handCards: [discard],
      waitingCards: [target],
    });
    const afterDiscard = selectDiscard(
      startAbility(
        scenario.game,
        SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
        scenario.sourceId
      ),
      discard.instanceId
    );

    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    const state = selectRecovery(afterDiscard, target.instanceId);
    expect(state.players[0].hand.cardIds).toContain(target.instanceId);
    expect(state.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });

  it('PL!SP-pb2-019 recovers a 5yncri5e! card from waiting room', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', 'CatChu!'), PLAYER1, 'discard');
    const target = createCardInstance(
      createMember('PL!SP-test-fiveyncrise', '5yncri5e!'),
      PLAYER1,
      'fiveyncrise'
    );
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-019-P＋',
      handCards: [discard],
      waitingCards: [target],
    });
    const state = selectRecovery(
      selectDiscard(
        startAbility(
          scenario.game,
          SP_PB2_019_ON_ENTER_DISCARD_RECOVER_FIVEYNCRISE_CARD_ABILITY_ID,
          scenario.sourceId
        ),
        discard.instanceId
      ),
      target.instanceId
    );

    expect(state.players[0].hand.cardIds).toContain(target.instanceId);
  });

  it('PL!SP-pb2-021 recovers a KALEIDOSCORE card without restricting card type', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', 'CatChu!'), PLAYER1, 'discard');
    const liveTarget = createCardInstance(
      createLive('PL!SP-test-kaleidoscore-live', 'KALEIDOSCORE'),
      PLAYER1,
      'ks-live'
    );
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-021-R',
      handCards: [discard],
      waitingCards: [liveTarget],
    });
    const state = selectRecovery(
      selectDiscard(
        startAbility(
          scenario.game,
          SP_PB2_021_ON_ENTER_DISCARD_RECOVER_KALEIDOSCORE_CARD_ABILITY_ID,
          scenario.sourceId
        ),
        discard.instanceId
      ),
      liveTarget.instanceId
    );

    expect(state.players[0].hand.cardIds).toContain(liveTarget.instanceId);
  });

  it('can recover the just-discarded matching unit card', () => {
    const discardTarget = createCardInstance(
      createMember('PL!SP-test-discard-catchu', 'CatChu!'),
      PLAYER1,
      'discard-catchu'
    );
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-015-P＋',
      handCards: [discardTarget],
    });
    const afterDiscard = selectDiscard(
      startAbility(
        scenario.game,
        SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
        scenario.sourceId
      ),
      discardTarget.instanceId
    );

    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([discardTarget.instanceId]);
    const state = selectRecovery(afterDiscard, discardTarget.instanceId);
    expect(state.players[0].hand.cardIds).toEqual([discardTarget.instanceId]);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(discardTarget.instanceId);
  });

  it('does not allow non-matching unit cards as recovery targets', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', 'Liella!'), PLAYER1, 'discard');
    const nonTarget = createCardInstance(
      createMember('PL!SP-test-non-target', '5yncri5e!'),
      PLAYER1,
      'non-target'
    );
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-015-R',
      handCards: [discard],
      waitingCards: [nonTarget],
    });
    const state = selectDiscard(
      startAbility(
        scenario.game,
        SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
        scenario.sourceId
      ),
      discard.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(state.players[0].waitingRoom.cardIds).toContain(nonTarget.instanceId);
    expect(latestPayload(state, SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID)).toMatchObject({
      step: 'DISCARD_RECOVER_UNIT_CARD_NO_TARGET',
      selectedCardIds: [],
    });
  });

  it('keeps the discard cost when no target exists after discard', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', 'Liella!'), PLAYER1, 'discard');
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-019-R',
      handCards: [discard],
    });
    const state = selectDiscard(
      startAbility(
        scenario.game,
        SP_PB2_019_ON_ENTER_DISCARD_RECOVER_FIVEYNCRISE_CARD_ABILITY_ID,
        scenario.sourceId
      ),
      discard.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(state.players[0].hand.cardIds).toEqual([]);
  });

  it('can decline without discarding or recovering', () => {
    const discard = createCardInstance(createMember('PL!SP-test-discard', 'CatChu!'), PLAYER1, 'discard');
    const target = createCardInstance(createMember('PL!SP-test-catchu', 'CatChu!'), PLAYER1, 'catchu');
    const scenario = setupState({
      sourceCardCode: 'PL!SP-pb2-015-R',
      handCards: [discard],
      waitingCards: [target],
    });
    const state = skipEffect(
      startAbility(
        scenario.game,
        SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
        scenario.sourceId
      )
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
  });
});

function latestPayload(game: GameState, abilityId: string): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}
