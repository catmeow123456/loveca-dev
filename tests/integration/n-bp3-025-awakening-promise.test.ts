import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  addCardToStatefulZone,
  addEnergyBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
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

function member(cardCode = 'target-member'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(): LiveCardData {
  return {
    cardCode: 'PL!N-bp3-025-L',
    name: 'Awakening Promise',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'pending-awakening-promise',
    abilityId: PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['event-awakening-promise'],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('n-bp3-025-awakening-promise', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmSelectedCard(session: GameSession, selectedCardId: string | null) {
  const effect = session.state!.activeEffect!;
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, selectedCardId)
  );
}

function confirmSelectedCards(session: GameSession, selectedCardIds: readonly string[]) {
  const effect = session.state!.activeEffect!;
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function setup(energyBelowCount: number) {
  const liveCard = createCardInstance(live(), PLAYER1, 'awakening-promise');
  const target = createCardInstance(member(), PLAYER1, 'target-member');
  const otherTarget = createCardInstance(member('other-member'), PLAYER1, 'other-member');
  const energyCards = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(energy(`energy-${index + 1}`), PLAYER1, `energy-${index + 1}`)
  );
  let game = registerCards(createGameState('n-bp3-025', PLAYER1, 'P1', PLAYER2, 'P2'), [
    liveCard,
    target,
    otherTarget,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, otherTarget.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const energyCard of energyCards.slice(0, energyBelowCount)) {
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energyCard.instanceId);
    }
    memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energyCards[3]!.instanceId);
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, liveCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
    };
  });

  return {
    game: {
      ...game,
      pendingAbilities: [pending(liveCard.instanceId)],
    },
    liveCard,
    target,
    otherTarget,
    energyCards,
  };
}

describe('PL!N-bp3-025 Awakening Promise', () => {
  it('returns selected energy below a member to energy deck and grants three red Hearts per card', () => {
    const { game, target, energyCards } = setup(3);
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID,
      canSkipSelection: true,
    });
    expect(started.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([target.instanceId, 'other-member'])
    );

    const session = sessionWithState(started);
    const chooseMember = confirmSelectedCard(session, target.instanceId);
    expect(chooseMember.success, chooseMember.error).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardIds: energyCards.slice(0, 3).map((card) => card.instanceId),
      minSelectableCards: 1,
      maxSelectableCards: 3,
    });

    const returned = [energyCards[0]!.instanceId, energyCards[2]!.instanceId];
    const finish = confirmSelectedCards(session, returned);
    expect(finish.success, finish.error).toBe(true);

    const player = finish.gameState.players[0]!;
    expect(player.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([energyCards[1]!.instanceId]);
    expect(player.energyDeck.cardIds).toEqual(returned);
    const redHeart = getMemberEffectiveHeartIcons(finish.gameState, PLAYER1, target.instanceId)
      .filter((heart) => heart.color === HeartColor.RED)
      .reduce((total, heart) => total + heart.count, 0);
    expect(redHeart).toBe(6);
  });

  it('can decline, and consumes pending as no-op when no member has energy below', () => {
    const declinedSetup = setup(1);
    const started = resolvePendingCardEffects(declinedSetup.game).gameState;
    const declined = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, null)
    );
    expect(declined.success, declined.error).toBe(true);
    expect(declined.gameState.activeEffect).toBeNull();
    expect(declined.gameState.players[0]!.energyDeck.cardIds).toEqual([]);

    const noTargetSetup = setup(0);
    const noEnergyOnAnyMember = updatePlayer(noTargetSetup.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        energyBelow: {
          [SlotPosition.LEFT]: [],
          [SlotPosition.CENTER]: [],
          [SlotPosition.RIGHT]: [],
        },
      },
    }));
    const resolved = resolvePendingCardEffects(noEnergyOnAnyMember).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('rejects non-target energy, duplicate selections, and stale energy without moving cards', () => {
    const { game, target, energyCards } = setup(2);
    const started = resolvePendingCardEffects(game).gameState;
    const session = sessionWithState(started);
    expect(confirmSelectedCard(session, target.instanceId).success).toBe(true);

    const otherSlotEnergy = energyCards[3]!.instanceId;
    const invalidOtherEnergy = confirmSelectedCards(sessionWithState(session.state!), [otherSlotEnergy]);
    expect(invalidOtherEnergy.success).toBe(false);
    expect(invalidOtherEnergy.error).toBe('选择的卡牌不能用于当前效果');

    const duplicate = confirmSelectedCards(sessionWithState(session.state!), [
      energyCards[0]!.instanceId,
      energyCards[0]!.instanceId,
    ]);
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toBe('不能重复选择同一张卡牌');

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        energyBelow: {
          ...player.memberSlots.energyBelow,
          [SlotPosition.CENTER]: [energyCards[1]!.instanceId],
        },
      },
      energyDeck: {
        ...player.energyDeck,
        cardIds: [energyCards[0]!.instanceId],
      },
    }));
    const staleSession = sessionWithState(staleState);
    const stale = confirmSelectedCards(staleSession, [energyCards[0]!.instanceId]);
    expect(stale.success).toBe(false);
    expect(stale.error).toBe('卡牌效果步骤确认失败');
    expect(staleSession.state!.players[0]!.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energyCards[1]!.instanceId,
    ]);
    expect(staleSession.state!.players[0]!.energyDeck.cardIds).toEqual([energyCards[0]!.instanceId]);
    expect(staleSession.state!.activeEffect).not.toBeNull();
  });

  it('does not move energy when the target member leaves before energy selection resolves', () => {
    const { game, target, energyCards } = setup(2);
    const started = resolvePendingCardEffects(game).gameState;
    const session = sessionWithState(started);
    expect(confirmSelectedCard(session, target.instanceId).success).toBe(true);

    const targetLeft = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const targetLeftSession = sessionWithState(targetLeft);
    const result = confirmSelectedCards(targetLeftSession, [energyCards[0]!.instanceId]);

    expect(result.success, result.error).toBe(true);
    expect(result.gameState.activeEffect).toBeNull();
    expect(result.gameState.players[0]!.energyDeck.cardIds).toEqual([]);
    expect(result.gameState.players[0]!.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energyCards[0]!.instanceId,
      energyCards[1]!.instanceId,
    ]);
  });

  it('locks the exact L rarity definition and base card code', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!N-bp3-025-L');
    expect(
      definitions.some(
        (ability: { abilityId: string; cardCodes?: readonly string[]; baseCardCodes?: readonly string[] }) =>
          ability.abilityId ===
            PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID &&
          ability.cardCodes?.includes('PL!N-bp3-025-L') === true &&
          ability.baseCardCodes?.includes('PL!N-bp3-025') === true
      )
    ).toBe(true);
  });
});
