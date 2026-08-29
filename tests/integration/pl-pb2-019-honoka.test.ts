import { describe, expect, it } from 'vitest';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
  PL_PB2_019_LIVE_START_WAIT_SELF_DISCARD_CENTER_MUSE_GAIN_BLADE_ABILITY_ID as ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const EFFECT_TEXT =
  '【LIVE开始时】可以将此成员变为待机状态，并将1张手牌放置入休息室：LIVE结束时为止，存在于自己的中央区域的『μ’s』的成员，获得[ブレード]。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）';

function member(
  cardCode: string,
  instanceId: string,
  ownerId = P1,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: options.name ?? cardCode,
      groupNames: options.groupNames ?? ["μ's"],
      cardType: CardType.MEMBER,
      cost: options.cost ?? 2,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    instanceId
  );
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id = 'pb2-019-live-start',
  sourceSlot = SlotPosition.LEFT
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot,
  };
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceAtCenter?: boolean;
    readonly handCount?: number;
    readonly includeCenter?: boolean;
  } = {}
) {
  const source = member(options.sourceCode ?? 'PL!-pb2-019-N', 'honoka-source', P1, {
    name: '高坂穗乃果',
    cost: 4,
  });
  const center = member('PL!-test-center', 'muse-center', P1, { name: '园田海未' });
  const handCards = [member('PL!-test-hand-1', 'hand-1'), member('PL!-test-hand-2', 'hand-2')];
  let game = registerCards(createGameState('pl-pb2-019-honoka', P1, 'P1', P2, 'P2'), [
    source,
    center,
    ...handCards,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.sourceAtCenter ? SlotPosition.CENTER : SlotPosition.LEFT,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (!options.sourceAtCenter && options.includeCenter !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, center.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      hand: {
        ...player.hand,
        cardIds: handCards.slice(0, options.handCount ?? 1).map((card) => card.instanceId),
      },
    };
  });
  return { game, source, center, handCards };
}

function start(game: GameState, sourceCardId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(ABILITY_ID, sourceCardId)],
  }).gameState;
}

function activate(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    'activate'
  );
}

function chooseCard(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function orientation(game: GameState, cardId: string) {
  return game.players[0].memberSlots.cardStates.get(cardId)?.orientation;
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
  );
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!-pb2-019 高坂穗乃果', () => {
  it('registers one implemented base-scoped LIVE_START ability for every rarity with corrected exact text', () => {
    for (const cardCode of ['PL!-pb2-019-N', 'PL!-pb2-019-R', 'PL!-pb2-019-UNSEEN']) {
      expect(getCardAbilityDefinitionsForCardCode(cardCode)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY_ID,
          baseCardCodes: ['PL!-pb2-019'],
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_LIVE_START,
          queued: true,
          implemented: true,
          effectText: EFFECT_TEXT,
        }),
      ]);
    }
  });

  it('uses 发动 / 不发动, pays WAIT then discard through both event wrappers, and grants center BLADE', () => {
    const scenario = setup({ sourceCode: 'PL!-pb2-019-UNSEEN' });
    const activationWindow = start(scenario.game, scenario.source.instanceId);
    expect(activationWindow.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const discardWindow = activate(activationWindow);
    expect(orientation(discardWindow, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(discardWindow.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableCardIds: [scenario.handCards[0]!.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
    });
    const memberStateEvent = discardWindow.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.source.instanceId
    )?.event;
    expect(memberStateEvent).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: { kind: 'CARD_EFFECT', abilityId: ABILITY_ID },
    });

    const done = chooseCard(discardWindow, scenario.handCards[0]!.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toContain(scenario.handCards[0]!.instanceId);
    const enterWaitingRoomEvent = done.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    )?.event;
    expect(enterWaitingRoomEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceIds: [scenario.handCards[0]!.instanceId],
    });
    expect(bladeModifiers(done)).toEqual([
      {
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        targetMemberCardId: scenario.center.instanceId,
        countDelta: 1,
        abilityId: ABILITY_ID,
      },
    ]);
    expect(latestPayload(done)).toMatchObject({
      step: 'WAIT_SELF_DISCARD_CENTER_MUSE_GAIN_BLADE',
      discardedCardIds: [scenario.handCards[0]!.instanceId],
      enterWaitingRoomEventId: enterWaitingRoomEvent?.eventId,
      targetMemberCardId: scenario.center.instanceId,
      bladeBonus: 1,
    });
  });

  it('declines without paying either cost', () => {
    const scenario = setup();
    const activationWindow = start(scenario.game, scenario.source.instanceId);
    const done = confirmActiveEffectStep(
      activationWindow,
      P1,
      activationWindow.activeEffect!.id,
      null
    );
    expect(done.activeEffect).toBeNull();
    expect(orientation(done, scenario.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(done.players[0].hand.cardIds).toContain(scenario.handCards[0]!.instanceId);
    expect(bladeModifiers(done)).toHaveLength(0);
    expect(latestPayload(done)).toMatchObject({ step: 'DECLINE_WAIT_SELF_COST' });
  });

  it('does not offer or partially pay the effect when the complete cost is unavailable', () => {
    const noHand = setup({ handCount: 0 });
    const noHandDone = start(noHand.game, noHand.source.instanceId);
    expect(noHandDone.activeEffect).toBeNull();
    expect(orientation(noHandDone, noHand.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(latestPayload(noHandDone)).toMatchObject({ step: 'COST_NOT_PAYABLE', handCount: 0 });

    const scenario = setup();
    const activationWindow = start(scenario.game, scenario.source.instanceId);
    const emptiedBeforeConfirmation = updatePlayer(activationWindow, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const confirmDone = activate(emptiedBeforeConfirmation);
    expect(confirmDone.activeEffect).toBeNull();
    expect(orientation(confirmDone, scenario.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(latestPayload(confirmDone)).toMatchObject({
      step: 'COST_NOT_PAYABLE_AT_CONFIRMATION',
      handCount: 0,
    });
  });

  it('keeps both paid costs when the center target disappears after the WAIT cost', () => {
    const scenario = setup();
    const discardWindow = activate(start(scenario.game, scenario.source.instanceId));
    const withoutCenter = updatePlayer(discardWindow, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const done = chooseCard(withoutCenter, scenario.handCards[0]!.instanceId);
    expect(orientation(done, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(done.players[0].waitingRoom.cardIds).toContain(scenario.handCards[0]!.instanceId);
    expect(bladeModifiers(done)).toHaveLength(0);
    expect(latestPayload(done)).toMatchObject({
      step: 'NO_OP_NO_CENTER_MUSE_MEMBER_AFTER_COST',
      discardedCardIds: [scenario.handCards[0]!.instanceId],
    });
  });

  it('allows the paid source itself to remain the center target while WAITING', () => {
    const scenario = setup({ sourceAtCenter: true });
    const done = chooseCard(
      activate(start(scenario.game, scenario.source.instanceId)),
      scenario.handCards[0]!.instanceId
    );
    expect(orientation(done, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(bladeModifiers(done)[0]).toMatchObject({
      targetMemberCardId: scenario.source.instanceId,
      countDelta: 1,
    });
  });

  it('refreshes a stale discard candidate while another hand card exists', () => {
    const scenario = setup({ handCount: 2 });
    const discardWindow = activate(start(scenario.game, scenario.source.instanceId));
    const stale = updatePlayer(discardWindow, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [scenario.handCards[1]!.instanceId] },
    }));
    const refreshed = chooseCard(stale, scenario.handCards[0]!.instanceId);
    expect(orientation(refreshed, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([scenario.handCards[1]!.instanceId]);
    expect(bladeModifiers(refreshed)).toHaveLength(0);
  });

  it('consumes a stale empty-hand discard window without refunding WAIT and continues pending resolution', () => {
    const scenario = setup();
    const laterSource = member('PL!-bp4-017-N', 'later-hanayo', P1, {
      name: '小泉花阳',
      cost: 2,
    });
    let discardWindow = activate(start(scenario.game, scenario.source.instanceId));
    discardWindow = registerCards(discardWindow, [laterSource]);
    discardWindow = updatePlayer(discardWindow, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, laterSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    discardWindow = {
      ...discardWindow,
      pendingAbilities: [
        pending(
          BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
          laterSource.instanceId,
          'later-pending',
          SlotPosition.RIGHT
        ),
      ],
    };

    const continued = chooseCard(discardWindow, scenario.handCards[0]!.instanceId);
    expect(orientation(continued, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(bladeModifiers(continued)).toHaveLength(0);
    expect(continued.activeEffect).toMatchObject({
      id: 'later-pending',
      abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    });
    expect(latestPayload(continued)).toMatchObject({
      step: 'DISCARD_COST_BECAME_UNPAYABLE_AFTER_SOURCE_WAIT',
      staleDiscardCardId: scenario.handCards[0]!.instanceId,
      partialCostPaid: true,
    });
  });
});
