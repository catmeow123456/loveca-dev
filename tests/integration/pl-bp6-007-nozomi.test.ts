import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  options: { readonly bladeHeart?: boolean } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: "μ's",
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: "μ's",
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolveNozomi(topCardData: MemberCardData | LiveCardData | null): {
  readonly state: GameState;
  readonly sourceCardId: string;
  readonly topCardId: string | null;
} {
  const source = createCardInstance(createMember('PL!-bp6-007-P'), PLAYER1, 'nozomi');
  const topCard = topCardData
    ? createCardInstance(topCardData, PLAYER1, 'top-card')
    : null;

  let game = createGameState('pl-bp6-007-nozomi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, topCard ? [source, topCard] : [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: topCard
      ? {
          ...player.mainDeck,
          cardIds: [topCard.instanceId],
        }
      : player.mainDeck,
  }));

  const state = resolvePendingCardEffects({
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, 0]]),
    },
    pendingAbilities: [createPendingAbility(source.instanceId)],
  }).gameState;

  return {
    state,
    sourceCardId: source.instanceId,
    topCardId: topCard?.instanceId ?? null,
  };
}

describe('PL!-bp6-007 Nozomi LIVE success reveal top to hand', () => {
  it('reveals a no-BLADE-HEART member, moves it to hand, and adds SCORE +1', () => {
    const { state, sourceCardId, topCardId } = resolveNozomi(
      createMember('PL!-test-no-blade-member')
    );

    expect(state.players[0]?.mainDeck.cardIds).toEqual([]);
    expect(state.players[0]?.hand.cardIds).toContain(topCardId);
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(state.inspectionZone.revealedCardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId,
      abilityId: BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });

  it('moves a BLADE HEART member to hand without adding score', () => {
    const { state, topCardId } = resolveNozomi(
      createMember('PL!-test-blade-member', { bladeHeart: true })
    );

    expect(state.players[0]?.hand.cardIds).toContain(topCardId);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(0);
  });

  it('moves a LIVE card to hand without adding score', () => {
    const { state, topCardId } = resolveNozomi(createLive('PL!-test-live-L'));

    expect(state.players[0]?.hand.cardIds).toContain(topCardId);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(0);
  });

  it('consumes pending as a no-op when the main deck has no top card', () => {
    const { state } = resolveNozomi(null);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0]?.hand.cardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NO_TOP_CARD' &&
          action.payload.revealedCardId === null &&
          action.payload.movedToHand === false
      )
    ).toBe(true);
  });
});
