import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GENERIC_DISCARD_LOOK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  name = cardCode,
  groupName = 'Liella!',
  unitName = '5yncri5e!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, name = cardCode, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function pendingAbility(sourceId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-017-pending',
    abilityId: GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupState(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly discardId: string;
  readonly liellaMemberId: string;
  readonly liellaLiveId: string;
  readonly nonLiellaMemberId: string;
  readonly otherLiellaMemberId: string;
  readonly fifthId: string;
  readonly sixthId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-017-R', '桜小路きな子'),
    PLAYER1,
    'sp-pb2-017-source'
  );
  const discard = createCardInstance(
    createMember('PL!SP-pb2-017-discard', 'Discard'),
    PLAYER1,
    'sp-pb2-017-discard'
  );
  const liellaMember = createCardInstance(
    createMember('PL!SP-pb2-017-liella-member', 'Liella member'),
    PLAYER1,
    'sp-pb2-017-liella-member'
  );
  const liellaLive = createCardInstance(
    createLive('PL!SP-pb2-017-liella-live', 'Liella live'),
    PLAYER1,
    'sp-pb2-017-liella-live'
  );
  const nonLiellaMember = createCardInstance(
    createMember('PL!N-pb2-017-non-liella-member', 'Non Liella', '虹咲学园学园偶像同好会', 'A・ZU・NA'),
    PLAYER1,
    'sp-pb2-017-non-liella-member'
  );
  const otherLiellaMember = createCardInstance(
    createMember('PL!SP-pb2-017-other-liella-member', 'Other Liella', 'Liella!', 'CatChu!'),
    PLAYER1,
    'sp-pb2-017-other-liella-member'
  );
  const fifth = createCardInstance(
    createLive('PL!N-pb2-017-non-liella-live', 'Non Liella live', '虹咲学园学园偶像同好会'),
    PLAYER1,
    'sp-pb2-017-fifth'
  );
  const sixth = createCardInstance(
    createMember('PL!SP-pb2-017-sixth', 'Sixth'),
    PLAYER1,
    'sp-pb2-017-sixth'
  );

  let game = createGameState('sp-pb2-017-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    discard,
    liellaMember,
    liellaLive,
    nonLiellaMember,
    otherLiellaMember,
    fifth,
    sixth,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [discard.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        liellaMember.instanceId,
        liellaLive.instanceId,
        nonLiellaMember.instanceId,
        otherLiellaMember.instanceId,
        fifth.instanceId,
        sixth.instanceId,
      ],
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));

  return {
    game,
    sourceId: source.instanceId,
    discardId: discard.instanceId,
    liellaMemberId: liellaMember.instanceId,
    liellaLiveId: liellaLive.instanceId,
    nonLiellaMemberId: nonLiellaMember.instanceId,
    otherLiellaMemberId: otherLiellaMember.instanceId,
    fifthId: fifth.instanceId,
    sixthId: sixth.instanceId,
  };
}

function startAbility(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceId)],
  }).gameState;
}

describe('PL!SP-pb2-017 Kinako discard look top', () => {
  it('takes only a Liella! member from top five and puts the rest into waiting room', () => {
    const scenario = setupState();
    let state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.discardId);

    expect(state.activeEffect?.inspectionCardIds).toEqual([
      scenario.liellaMemberId,
      scenario.liellaLiveId,
      scenario.nonLiellaMemberId,
      scenario.otherLiellaMemberId,
      scenario.fifthId,
    ]);
    expect(state.activeEffect?.selectableCardIds).toEqual([
      scenario.liellaMemberId,
      scenario.otherLiellaMemberId,
    ]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.liellaMemberId);
    expect(state.inspectionZone.revealedCardIds).toContain(scenario.liellaMemberId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.liellaMemberId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardId,
      scenario.liellaLiveId,
      scenario.nonLiellaMemberId,
      scenario.otherLiellaMemberId,
      scenario.fifthId,
    ]);
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.sixthId]);
  });

  it('can decline without discarding or inspecting', () => {
    const scenario = setupState();
    let state = startAbility(scenario.game, scenario.sourceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, null);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.discardId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([
      scenario.liellaMemberId,
      scenario.liellaLiveId,
      scenario.nonLiellaMemberId,
      scenario.otherLiellaMemberId,
      scenario.fifthId,
      scenario.sixthId,
    ]);
  });
});
