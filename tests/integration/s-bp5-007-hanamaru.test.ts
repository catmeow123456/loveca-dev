import { describe, expect, it } from 'vitest';
import type { CardInstance, MemberCardData, LiveCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
  type LookTopSelectToHandWorkflowConfig,
} from '../../src/application/card-effects/workflows/shared/look-top-select-to-hand';
import { PL_S_BP5_007_LIVE_SUCCESS_LOOK_TOP_GREEN_HEART_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { memberHasPrintedHeartColorAtLeast, typeIs, and } from '../../src/application/effects/card-selectors';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = PL_S_BP5_007_LIVE_SUCCESS_LOOK_TOP_GREEN_HEART_MEMBER_ABILITY_ID;

function createMember(
  cardCode: string,
  name: string,
  hearts = [createHeartIcon(HeartColor.PINK, 1)]
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts,
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 2 }),
  };
}

const config: LookTopSelectToHandWorkflowConfig = {
  effectText:
    '【LIVE成功时】检视自己卡组顶的4张卡。可以从其中将1张持有2个以上[緑ハート]的成员卡公开并加入手牌。其余的卡片放置入休息室。',
  topCount: 4,
  selector: and(typeIs(CardType.MEMBER), memberHasPrintedHeartColorAtLeast(HeartColor.GREEN, 2)),
  countRule: { minCount: 0, maxCount: 1 },
  revealSelectedBeforeHand: true,
  selectStepId: 'PL_S_BP5_007_SELECT_GREEN_HEART_MEMBER_FROM_TOP_FOUR',
  revealStepId: 'PL_S_BP5_007_REVEAL_SELECTED_GREEN_HEART_MEMBER',
  selectStepText: '请选择至多1张持有2个以上[緑ハート]的成员卡公开并加入手牌。也可以不加入。',
  noTargetStepText:
    '没有可加入手牌的持有2个以上[緑ハート]的成员卡。确认后其余卡片放置入休息室。',
  revealStepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
  revealActionStep: 'REVEAL_SELECTED_GREEN_HEART_MEMBER',
  publicEffectSummaryContext: {
    effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
    sourceActionLabel: 'LIVE成功',
    inspectSourceZone: ZoneType.MAIN_DECK,
    requestedInspectCount: 4,
  },
};

function setup(topCards: readonly CardInstance[]) {
  const source = createCardInstance(
    createMember('PL!S-bp5-007-R', '国木田花丸', [createHeartIcon(HeartColor.GREEN, 2)]),
    PLAYER1,
    's-bp5-007-source'
  );
  let game = createGameState('s-bp5-007-hanamaru', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...topCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: {
      ...player.mainDeck,
      cardIds: topCards.map((card) => card.instanceId),
    },
  }));

  let continued = false;
  const options = {
    continuePendingCardEffects: (nextGame: typeof game) => {
      continued = true;
      return nextGame;
    },
    enqueueTriggeredCardEffects: (nextGame: typeof game) => nextGame,
  };

  const ability = {
    id: 'pending-s-bp5-007',
    abilityId: ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: PLAYER1,
  };

  return { game, source, ability, options, wasContinued: () => continued };
}

describe('PL!S-bp5-007 国木田花丸 LIVE_SUCCESS look-top workflow', () => {
  it('reveals a green Heart 2+ member to hand and moves the inspected remainder to waiting room', () => {
    const topCards = [
      createCardInstance(
        createMember('PL!S-bp5-007-green-two', 'Green two', [
          createHeartIcon(HeartColor.GREEN, 2),
        ]),
        PLAYER1,
        's-bp5-007-green-two'
      ),
      createCardInstance(
        createMember('PL!S-bp5-007-green-one', 'Green one', [
          createHeartIcon(HeartColor.GREEN, 1),
        ]),
        PLAYER1,
        's-bp5-007-green-one'
      ),
      createCardInstance(createLive('PL!S-bp5-007-green-live'), PLAYER1, 's-bp5-007-green-live'),
      createCardInstance(
        createMember('PL!S-bp5-007-red-two', 'Red two', [createHeartIcon(HeartColor.RED, 2)]),
        PLAYER1,
        's-bp5-007-red-two'
      ),
      createCardInstance(createMember('PL!S-bp5-007-extra', 'Extra'), PLAYER1, 's-bp5-007-extra'),
    ];
    const scenario = setup(topCards);

    let state = startLookTopSelectToHandWorkflow(scenario.game, scenario.ability, config, {
      ...scenario.options,
      orderedResolution: true,
    });
    expect(state.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([topCards[0]!.instanceId]);

    state = resolveLookTopSelectToHandSelection(
      state,
      topCards[0]!.instanceId,
      undefined,
      scenario.options
    );
    expect(state.inspectionZone.revealedCardIds).toContain(topCards[0]!.instanceId);

    state = finishRevealedLookTopSelectToHandWorkflow(state, scenario.options);

    expect(state.players[0]!.hand.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual(
      topCards.slice(1, 4).map((card) => card.instanceId)
    );
    expect(state.players[0]!.mainDeck.cardIds).toEqual([topCards[4]!.instanceId]);
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(scenario.wasContinued()).toBe(true);

    const enterWaitingEvent = state.eventLog.at(-1)?.event;
    expect(enterWaitingEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: topCards.slice(1, 4).map((card) => card.instanceId),
    });
  });

  it('moves all inspected cards to waiting room when there is no legal target', () => {
    const topCards = [
      createCardInstance(
        createMember('PL!S-bp5-007-green-one', 'Green one', [
          createHeartIcon(HeartColor.GREEN, 1),
        ]),
        PLAYER1,
        's-bp5-007-no-target-green-one'
      ),
      createCardInstance(createLive('PL!S-bp5-007-green-live'), PLAYER1, 's-bp5-007-no-target-live'),
      createCardInstance(
        createMember('PL!S-bp5-007-red-two', 'Red two', [createHeartIcon(HeartColor.RED, 2)]),
        PLAYER1,
        's-bp5-007-no-target-red-two'
      ),
      createCardInstance(createMember('PL!S-bp5-007-extra-a', 'Extra A'), PLAYER1, 'extra-a'),
    ];
    const scenario = setup(topCards);

    let state = startLookTopSelectToHandWorkflow(scenario.game, scenario.ability, config, {
      ...scenario.options,
      orderedResolution: true,
    });
    expect(state.activeEffect?.selectableCardIds).toEqual([]);

    state = resolveLookTopSelectToHandSelection(state, null, undefined, scenario.options);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual(topCards.map((card) => card.instanceId));
    expect(scenario.wasContinued()).toBe(true);
  });

  it('lets the player choose not to add a legal target', () => {
    const topCards = [
      createCardInstance(
        createMember('PL!S-bp5-007-green-two', 'Green two', [
          createHeartIcon(HeartColor.GREEN, 2),
        ]),
        PLAYER1,
        's-bp5-007-decline-green-two'
      ),
      createCardInstance(createMember('PL!S-bp5-007-other', 'Other'), PLAYER1, 'decline-other'),
    ];
    const scenario = setup(topCards);

    let state = startLookTopSelectToHandWorkflow(scenario.game, scenario.ability, config, {
      ...scenario.options,
      orderedResolution: true,
    });
    expect(state.activeEffect?.selectableCardIds).toEqual([topCards[0]!.instanceId]);

    state = resolveLookTopSelectToHandSelection(state, null, undefined, scenario.options);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0]!.hand.cardIds).toEqual([]);
    expect(state.players[0]!.waitingRoom.cardIds).toEqual(topCards.map((card) => card.instanceId));
    expect(scenario.wasContinued()).toBe(true);
  });
});
