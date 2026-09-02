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
  addHeartLiveModifierForSourceMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_006_ACTIVATED_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID as ACTIVATED_ABILITY_ID,
  PL_PB2_006_LIVE_START_WAIT_SELF_DISCARD_WAIT_LOW_ORIGINAL_HEART_OPPONENT_ABILITY_ID as LIVE_START_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfig } from '../../src/application/card-effects/runtime/activated-ability-ui';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ACTIVATED_EFFECT_TEXT =
  '【起动】【1回合1次】将此成员变为待机状态，将1张手牌放置入休息室：将存在于对方的舞台的1名原本持有的HEART的数量小于等于1的成员变为待机状态。';
const LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】将此成员变为待机状态，将1张手牌放置入休息室：将存在于对方的舞台的1名原本持有的HEART的数量小于等于1的成员变为待机状态。';

function member(
  code: string,
  id: string,
  ownerId: string,
  heartCount = 1
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode: code,
      name: code,
      groupNames: code.startsWith('PL!-') ? ["μ's"] : ['test'],
      cardType: CardType.MEMBER,
      cost: code.startsWith('PL!-pb2-006') ? 2 : 4,
      blade: 1,
      hearts: heartCount > 0 ? [createHeartIcon(HeartColor.PINK, heartCount)] : [],
    },
    ownerId,
    id
  );
}

interface Scenario {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly hand: CardInstance<MemberCardData>;
  readonly lowHeartTarget: CardInstance<MemberCardData>;
  readonly highHeartTarget: CardInstance<MemberCardData>;
  readonly waitingLowHeartTarget: CardInstance<MemberCardData>;
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceOrientation?: OrientationState;
    readonly sourceOnStage?: boolean;
    readonly handCount?: number;
    readonly includeEligibleTarget?: boolean;
    readonly lowHeartCount?: number;
    readonly highHeartCount?: number;
  } = {}
): Scenario {
  const source = member(options.sourceCode ?? 'PL!-pb2-006-PP', 'source', P1);
  const hand = member('P1-HAND', 'hand', P1);
  const lowHeartTarget = member('P2-LOW-HEART', 'low-heart-target', P2, options.lowHeartCount ?? 1);
  const highHeartTarget = member(
    'P2-HIGH-HEART',
    'high-heart-target',
    P2,
    options.highHeartCount ?? 2
  );
  const waitingLowHeartTarget = member('P2-WAITING-LOW-HEART', 'waiting-low-heart-target', P2, 0);
  let game = registerCards(createGameState('pl-pb2-006-maki', P1, 'P1', P2, 'P2'), [
    source,
    hand,
    lowHeartTarget,
    highHeartTarget,
    waitingLowHeartTarget,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: {
      ...player.hand,
      cardIds: (options.handCount ?? 1) > 0 ? [hand.instanceId] : [],
    },
  }));
  game = updatePlayer(game, P2, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      highHeartTarget.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (options.includeEligibleTarget !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, lowHeartTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    memberSlots = placeCardInSlot(
      memberSlots,
      SlotPosition.RIGHT,
      waitingLowHeartTarget.instanceId,
      { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
    );
    return { ...player, memberSlots };
  });
  return {
    game: { ...game, currentPhase: GamePhase.MAIN_PHASE },
    source,
    hand,
    lowHeartTarget,
    highHeartTarget,
    waitingLowHeartTarget,
  };
}

function queueLiveStart(scenario: Scenario): GameState {
  const ability: PendingAbilityState = {
    id: 'pb2-006-live-start',
    abilityId: LIVE_START_ABILITY_ID,
    sourceCardId: scenario.source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
  return { ...scenario.game, pendingAbilities: [ability] };
}

function chooseOption(game: GameState, optionId?: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, null, null, undefined, optionId);
}

function chooseCard(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function orientation(game: GameState, playerId: string, cardId: string) {
  return game.players.find((player) => player.id === playerId)?.memberSlots.cardStates.get(cardId)
    ?.orientation;
}

function replaceOriginalHearts(
  game: GameState,
  cardId: string,
  count: number,
  abilityId: string
): GameState {
  return addLiveModifier(game, {
    kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
    playerId: P2,
    memberCardId: cardId,
    hearts: count > 0 ? [createHeartIcon(HeartColor.BLUE, count)] : [],
    sourceCardId: cardId,
    abilityId,
  });
}

function openTargetWindow(
  scenario: Scenario,
  abilityId: typeof ACTIVATED_ABILITY_ID | typeof LIVE_START_ABILITY_ID
): GameState {
  if (abilityId === ACTIVATED_ABILITY_ID) {
    return chooseCard(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED_ABILITY_ID),
      scenario.hand.instanceId
    );
  }
  const optionalWindow = resolvePendingCardEffects(queueLiveStart(scenario)).gameState;
  const discardWindow = chooseOption(optionalWindow, 'activate');
  return chooseCard(discardWindow, scenario.hand.instanceId);
}

describe('PL!-pb2-006 西木野真姬', () => {
  it('registers two independent base-scoped abilities with exact player text', () => {
    for (const cardCode of ['PL!-pb2-006-PP', 'PL!-pb2-006-R', 'PL!-pb2-006-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(2);
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            abilityId: ACTIVATED_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-006'],
            category: CardAbilityCategory.ACTIVATED,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            queued: false,
            implemented: true,
            perTurnLimit: 1,
            requiredSourceOrientation: OrientationState.ACTIVE,
            effectText: ACTIVATED_EFFECT_TEXT,
          }),
          expect.objectContaining({
            abilityId: LIVE_START_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-006'],
            category: CardAbilityCategory.LIVE_START,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            triggerCondition: TriggerCondition.ON_LIVE_START,
            queued: true,
            implemented: true,
            effectText: LIVE_START_EFFECT_TEXT,
          }),
        ])
      );
      expect(definitions.every((definition) => definition.cardCodes === undefined)).toBe(true);
    }
    const activated = getCardAbilityDefinitionsForCardCode('PL!-pb2-006-PP').find(
      (definition) => definition.abilityId === ACTIVATED_ABILITY_ID
    );
    expect(activated?.effectText).toBe(ACTIVATED_EFFECT_TEXT);
    expect(activated?.activatedUi?.text).toBe(ACTIVATED_EFFECT_TEXT);
    expect(getActivatedAbilityUiConfig('PL!-pb2-006-PP')?.text).toBe(ACTIVATED_EFFECT_TEXT);
  });

  it('activated ability pays both costs, privately discards, then waits one eligible opponent member', () => {
    const scenario = setup();
    const discardWindow = activateCardAbility(
      scenario.game,
      P1,
      scenario.source.instanceId,
      ACTIVATED_ABILITY_ID
    );
    expect(orientation(discardWindow, P1, scenario.source.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(discardWindow.activeEffect).toMatchObject({
      abilityId: ACTIVATED_ABILITY_ID,
      selectableCardIds: [scenario.hand.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
    });
    expect(
      discardWindow.actionHistory.some(
        (action) =>
          action.payload.abilityId === ACTIVATED_ABILITY_ID && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);

    const targetWindow = chooseCard(discardWindow, scenario.hand.instanceId);
    expect(targetWindow.players[0].waitingRoom.cardIds).toContain(scenario.hand.instanceId);
    expect(targetWindow.activeEffect).toMatchObject({
      selectableCardIds: [scenario.lowHeartTarget.instanceId],
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
    });
    expect(
      targetWindow.actionHistory.some(
        (action) =>
          action.payload.abilityId === ACTIVATED_ABILITY_ID && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);

    const done = chooseCard(targetWindow, scenario.lowHeartTarget.instanceId);
    expect(orientation(done, P2, scenario.lowHeartTarget.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'WAIT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
      targetCardId: scenario.lowHeartTarget.instanceId,
      targetOriginalHeartCount: 1,
    });
  });

  it.each([ACTIVATED_ABILITY_ID, LIVE_START_ABILITY_ID] as const)(
    'uses replacement-aware original HEART targets for %s and ignores ordinary HEART bonuses',
    (abilityId) => {
      const scenario = setup({ lowHeartCount: 0, highHeartCount: 2 });
      let game = replaceOriginalHearts(
        scenario.game,
        scenario.lowHeartTarget.instanceId,
        4,
        'test:replace-printed-zero-with-four'
      );
      game = replaceOriginalHearts(
        game,
        scenario.highHeartTarget.instanceId,
        1,
        'test:replace-printed-two-with-one'
      );
      const bonus = addHeartLiveModifierForSourceMember(game, {
        playerId: P2,
        sourceCardId: scenario.highHeartTarget.instanceId,
        abilityId: 'test:ordinary-heart-bonus-does-not-change-original',
        hearts: [createHeartIcon(HeartColor.PURPLE, 4)],
      });
      expect(bonus).not.toBeNull();

      const targetWindow = openTargetWindow({ ...scenario, game: bonus!.gameState }, abilityId);
      expect(targetWindow.activeEffect?.selectableCardIds).toEqual([
        scenario.highHeartTarget.instanceId,
      ]);
      expect(targetWindow.activeEffect?.selectableCardIds).not.toContain(
        scenario.lowHeartTarget.instanceId
      );

      const done = chooseCard(targetWindow, scenario.highHeartTarget.instanceId);
      expect(orientation(done, P2, scenario.highHeartTarget.instanceId)).toBe(
        OrientationState.WAITING
      );
      expect(done.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'WAIT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
        targetCardId: scenario.highHeartTarget.instanceId,
        targetOriginalHeartCount: 1,
      });
    }
  );

  it.each([ACTIVATED_ABILITY_ID, LIVE_START_ABILITY_ID] as const)(
    'revalidates a changed original HEART replacement at confirmation for %s',
    (abilityId) => {
      const scenario = setup();
      const targetWindow = openTargetWindow(scenario, abilityId);
      const stale = replaceOriginalHearts(
        targetWindow,
        scenario.lowHeartTarget.instanceId,
        4,
        'test:stale-original-heart-replacement'
      );

      const done = chooseCard(stale, scenario.lowHeartTarget.instanceId);
      expect(done.activeEffect).toBeNull();
      expect(orientation(done, P2, scenario.lowHeartTarget.instanceId)).toBe(
        OrientationState.ACTIVE
      );
      expect(done.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'STALE_TARGET_NO_TARGET',
        staleTargetCardId: scenario.lowHeartTarget.instanceId,
      });
    }
  );

  it('does not activate without the complete costs and enforces once per turn after discard', () => {
    const noHand = setup({ handCount: 0 });
    expect(
      activateCardAbility(noHand.game, P1, noHand.source.instanceId, ACTIVATED_ABILITY_ID)
    ).toBe(noHand.game);
    expect(orientation(noHand.game, P1, noHand.source.instanceId)).toBe(OrientationState.ACTIVE);

    const scenario = setup();
    const targetWindow = chooseCard(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED_ABILITY_ID),
      scenario.hand.instanceId
    );
    let sourceReactivated = updatePlayer(targetWindow, P1, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.set(scenario.source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      return {
        ...player,
        hand: { ...player.hand, cardIds: [scenario.hand.instanceId] },
        memberSlots: { ...player.memberSlots, cardStates },
      };
    });
    sourceReactivated = { ...sourceReactivated, activeEffect: null };
    expect(
      activateCardAbility(sourceReactivated, P1, scenario.source.instanceId, ACTIVATED_ABILITY_ID)
    ).toBe(sourceReactivated);
  });

  it('consumes a stale empty-hand discard window without refunding WAIT or recording turn use', () => {
    const scenario = setup();
    const discardWindow = activateCardAbility(
      scenario.game,
      P1,
      scenario.source.instanceId,
      ACTIVATED_ABILITY_ID
    );
    const staleEmptyHand = updatePlayer(discardWindow, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const done = chooseCard(staleEmptyHand, scenario.hand.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(orientation(done, P1, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ACTIVATED_ABILITY_ID,
      step: 'DISCARD_COST_BECAME_UNPAYABLE_AFTER_SOURCE_WAIT',
      staleDiscardCardId: scenario.hand.instanceId,
      partialCostPaid: true,
    });
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === ACTIVATED_ABILITY_ID && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('keeps both paid costs when no opponent target exists', () => {
    const scenario = setup({ includeEligibleTarget: false });
    const done = chooseCard(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED_ABILITY_ID),
      scenario.hand.instanceId
    );
    expect(done.activeEffect).toBeNull();
    expect(orientation(done, P1, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(done.players[0].waitingRoom.cardIds).toContain(scenario.hand.instanceId);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ACTIVATED_ABILITY_ID,
      step: 'PAID_COST_NO_TARGET',
    });
  });

  it('rejects illegal target and safely consumes a stale final target without rolling back costs', () => {
    const scenario = setup();
    const targetWindow = chooseCard(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED_ABILITY_ID),
      scenario.hand.instanceId
    );
    expect(chooseCard(targetWindow, scenario.highHeartTarget.instanceId)).toBe(targetWindow);

    const stale = updatePlayer(targetWindow, P2, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.set(scenario.lowHeartTarget.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
      return { ...player, memberSlots: { ...player.memberSlots, cardStates } };
    });
    const done = chooseCard(stale, scenario.lowHeartTarget.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'STALE_TARGET_NO_TARGET',
      staleTargetCardId: scenario.lowHeartTarget.instanceId,
    });
  });

  it('LIVE-start uses a real 发动/不发动 window, then resolves the same cost and target flow', () => {
    const scenario = setup();
    const optionalWindow = resolvePendingCardEffects(queueLiveStart(scenario)).gameState;
    expect(optionalWindow.activeEffect).toMatchObject({
      abilityId: LIVE_START_ABILITY_ID,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(optionalWindow.activeEffect?.selectableCardIds).toBeUndefined();
    expect(optionalWindow.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(optionalWindow.pendingAbilities).toEqual([]);

    const discardWindow = chooseOption(optionalWindow, 'activate');
    expect(orientation(discardWindow, P1, scenario.source.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(discardWindow.activeEffect).toMatchObject({
      stepId: 'PL_PB2_006_SELECT_HAND_CARD_TO_DISCARD',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    const targetWindow = chooseCard(discardWindow, scenario.hand.instanceId);
    const done = chooseCard(targetWindow, scenario.lowHeartTarget.instanceId);
    expect(orientation(done, P2, scenario.lowHeartTarget.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it('LIVE-start decline and source invalidation consume pending without paying costs', () => {
    const scenario = setup();
    const optionalWindow = resolvePendingCardEffects(queueLiveStart(scenario)).gameState;
    const declined = chooseOption(optionalWindow);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(orientation(declined, P1, scenario.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(declined.players[0].hand.cardIds).toContain(scenario.hand.instanceId);

    const sourceLeft = updatePlayer(optionalWindow, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const invalidated = chooseOption(sourceLeft, 'activate');
    expect(invalidated.activeEffect).toBeNull();
    expect(invalidated.pendingAbilities).toEqual([]);
    expect(invalidated.players[0].hand.cardIds).toContain(scenario.hand.instanceId);
    expect(
      invalidated.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
  });

  it('LIVE-start consumes immediately when either mandatory cost is unavailable', () => {
    const noHand = setup({ handCount: 0 });
    const withoutHand = resolvePendingCardEffects(queueLiveStart(noHand)).gameState;
    expect(withoutHand.activeEffect).toBeNull();
    expect(withoutHand.pendingAbilities).toEqual([]);
    expect(orientation(withoutHand, P1, noHand.source.instanceId)).toBe(OrientationState.ACTIVE);

    const waiting = setup({ sourceOrientation: OrientationState.WAITING });
    const waitingSource = resolvePendingCardEffects(queueLiveStart(waiting)).gameState;
    expect(waitingSource.activeEffect).toBeNull();
    expect(waitingSource.pendingAbilities).toEqual([]);
  });
});
