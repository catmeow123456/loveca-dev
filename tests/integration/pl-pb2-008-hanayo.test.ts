import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
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
  PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const EFFECT_TEXT =
  '【登场】可以将此成员变为待机状态：检视自己的卡组顶的4张卡片。可以将其中的1张需求HEART的合计大于等于8的『μ’s』的LIVE卡公开并加入手牌。其余的放置入休息室。';

function member(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ["μ's"]
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: cardCode.startsWith('PL!-pb2-008') ? 2 : 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(
  cardCode: string,
  totalRequired: number,
  groupNames: readonly string[] = ["μ's"]
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: totalRequired }, totalRequired),
  };
}

function pending(sourceCardId: string, id = 'pl-pb2-008-pending'): PendingAbilityState {
  return {
    id,
    abilityId: PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`${id}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function baseGame(): GameState {
  return {
    ...createGameState('pl-pb2-008-hanayo', PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

describe('PL!-pb2-008 小泉花阳', () => {
  it('registers one base-code ON_ENTER definition with the corrected full player text', () => {
    for (const cardCode of ['PL!-pb2-008-PP', 'PL!-pb2-008-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
        baseCardCodes: ['PL!-pb2-008'],
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
        delegatedOnEnterFromWaitingRoomPolicy: {
          decision: 'DENY',
          reason: 'SOURCE_MEMBER_COST_UNPAYABLE',
        },
      });
      expect(definitions[0]?.cardCodes).toBeUndefined();
    }
  });

  it('uses one positive option plus skip, and declining neither waits the source nor inspects the deck', () => {
    const source = createCardInstance(member('PL!-pb2-008-PP', '小泉花阳'), PLAYER1, 'hanayo');
    const top = createCardInstance(live('PL!-test-live', 8), PLAYER1, 'top');
    let game = registerCards(baseGame(), [source, top]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [top.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(declined.players[0].mainDeck.cardIds).toEqual([top.instanceId]);
    expect(declined.inspectionZone.cardIds).toEqual([]);
    expect(
      declined.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
  });

  it('pays ACTIVE-to-WAITING first, filters the inspected cards, publicly reveals the choice, then continues queued WAIT observers', () => {
    const source = createCardInstance(member('PL!-pb2-008-PP', '小泉花阳'), PLAYER1, 'hanayo');
    const observer = createCardInstance(member('PL!-PR-023-PR', '绚濑绘里'), PLAYER1, 'observer');
    const target = createCardInstance(live('PL!-valid-muse-live', 8), PLAYER1, 'target');
    const low = createCardInstance(live('PL!-low-muse-live', 7), PLAYER1, 'low');
    const otherGroup = createCardInstance(
      live('PL!S-high-aqours-live', 8, ['Aqours']),
      PLAYER1,
      'other-group'
    );
    const nonLive = createCardInstance(member('PL!-muse-member'), PLAYER1, 'non-live');
    const bottom = createCardInstance(member('PL!-bottom'), PLAYER1, 'bottom');
    let game = registerCards(baseGame(), [
      source,
      observer,
      target,
      low,
      otherGroup,
      nonLive,
      bottom,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [
          target.instanceId,
          low.instanceId,
          otherGroup.instanceId,
          nonLive.instanceId,
          bottom.instanceId,
        ],
      },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        observer.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    const started = resolvePendingCardEffects(game).gameState;
    const paid = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    expect(paid.activeEffect).toMatchObject({
      abilityId: PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      inspectionCardIds: [
        target.instanceId,
        low.instanceId,
        otherGroup.instanceId,
        nonLive.instanceId,
      ],
      confirmSelectionLabel: '公开并加入手牌',
      canSkipSelection: true,
      skipSelectionLabel: '全部放置入休息室',
    });
    expect(paid.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    const stateEvent = paid.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === source.instanceId
    )?.event;
    expect(stateEvent).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        abilityId: PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID,
        pendingAbilityId: 'pl-pb2-008-pending',
      },
    });
    expect(
      paid.pendingAbilities.some(
        (ability) =>
          ability.abilityId === PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);

    const forgedSelection = confirmActiveEffectStep(
      paid,
      PLAYER1,
      paid.activeEffect!.id,
      low.instanceId
    );
    expect(forgedSelection).toBe(paid);

    const revealing = confirmActiveEffectStep(
      paid,
      PLAYER1,
      paid.activeEffect!.id,
      target.instanceId
    );
    expect(revealing.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(revealing.inspectionZone.revealedCardIds).toContain(target.instanceId);
    expect(revealing.players[0].hand.cardIds).not.toContain(target.instanceId);
    expect(revealing.inspectionZone.cardIds).toEqual(paid.inspectionZone.cardIds);

    const continued = confirmActiveEffectStep(revealing, PLAYER1, revealing.activeEffect!.id);
    expect(continued.players[0].hand.cardIds).toContain(target.instanceId);
    expect(continued.players[0].waitingRoom.cardIds).toEqual([
      low.instanceId,
      otherGroup.instanceId,
      nonLive.instanceId,
    ]);
    expect(continued.players[0].mainDeck.cardIds).toEqual([bottom.instanceId]);
    expect(continued.activeEffect).toBeNull();
    expect(continued.pendingAbilities).toEqual([]);
    const inspectionFinishedAt = continued.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId ===
          PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID &&
        action.payload.step === 'FINISH'
    );
    const observerResolvedAt = continued.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId ===
          PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID &&
        action.payload.step === 'MEMBER_WAITED_GAIN_ONE_BLADE'
    );
    expect(inspectionFinishedAt).toBeGreaterThanOrEqual(0);
    expect(observerResolvedAt).toBeGreaterThan(inspectionFinishedAt);
    const groupedWaitingEvent = continued.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    )?.event;
    expect(groupedWaitingEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceIds: [low.instanceId, otherGroup.instanceId, nonLive.instanceId],
      fromZone: 'MAIN_DECK',
    });
  });

  it('keeps the paid WAITING cost with a short deck and no legal target, moving all inspected cards together to the waiting room', () => {
    const source = createCardInstance(member('PL!-pb2-008-PP', '小泉花阳'), PLAYER1, 'hanayo');
    const low = createCardInstance(live('PL!-low-live', 7), PLAYER1, 'low');
    const nonLive = createCardInstance(member('PL!-member'), PLAYER1, 'member');
    let game = registerCards(baseGame(), [source, low, nonLive]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [low.instanceId, nonLive.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    const started = resolvePendingCardEffects(game).gameState;
    const paid = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    expect(paid.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(paid.activeEffect).toMatchObject({
      inspectionCardIds: [low.instanceId, nonLive.instanceId],
      selectableCardIds: [],
      canSkipSelection: true,
      skipSelectionLabel: '全部放置入休息室',
    });

    const done = confirmActiveEffectStep(paid, PLAYER1, paid.activeEffect!.id, null);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toEqual([low.instanceId, nonLive.instanceId]);
    expect(done.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
  });

  it('offers only skip when the cost is unpayable and safely consumes a source that leaves after opening', () => {
    const source = createCardInstance(member('PL!-pb2-008-PP', '小泉花阳'), PLAYER1, 'hanayo');
    let game = registerCards(baseGame(), [source]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };
    const unpayable = resolvePendingCardEffects(game).gameState;
    expect(unpayable.activeEffect).toMatchObject({
      selectableOptions: [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(
      confirmActiveEffectStep(unpayable, PLAYER1, unpayable.activeEffect!.id).activeEffect
    ).toBeNull();

    let activeGame = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    activeGame = { ...activeGame, pendingAbilities: [pending(source.instanceId, 'stale-source')] };
    const started = resolvePendingCardEffects(activeGame).gameState;
    const sourceLeft = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const staleDone = confirmActiveEffectStep(
      sourceLeft,
      PLAYER1,
      sourceLeft.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    expect(staleDone.activeEffect).toBeNull();
    expect(staleDone.pendingAbilities).toEqual([]);
    expect(
      staleDone.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            PL_PB2_008_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_MUSE_LIVE_ABILITY_ID &&
          action.payload.step === 'SOURCE_NOT_ACTIVE_OWN_STAGE_MEMBER_AFTER_SELECTION'
      )
    ).toBe(true);
  });
});
