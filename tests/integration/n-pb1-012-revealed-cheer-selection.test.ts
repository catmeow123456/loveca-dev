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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_N_PB1_012_LIVE_SUCCESS_NIJIGASAKI_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PL_N_PB1_012_SELECT_NIJIGASAKI_MEMBER_CHEER_TO_HAND_STEP_ID } from '../../src/application/card-effects/workflows/shared/revealed-cheer-selection';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = PL_N_PB1_012_LIVE_SUCCESS_NIJIGASAKI_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID;
const EFFECT_TEXT = '【LIVE成功时】从因声援被公开的自己的卡片中，将1张『虹咲』的成员卡加入手牌。';

function member(
  cardCode: string,
  id: string,
  groupName = '虹ヶ咲',
  ownerId = P1
): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode,
    name: id,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

function live(cardCode: string, id: string, groupName = '虹ヶ咲') {
  const data: LiveCardData = {
    cardCode,
    name: id,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function pending(sourceCardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    sourceSlot: SlotPosition.CENTER,
    eventIds: [`event-${id}`],
  };
}

function buildScenario(validCount = 2) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('n-pb1-012-live-success', P1, 'P1', P2, 'P2');
  const source = member('PL!N-pb1-012-R', 'source-lanzhu');
  const performedLive = live('TEST-PERFORMED-LIVE', 'performed-live');
  const valid = Array.from({ length: validCount }, (_, index) =>
    member(`TEST-VALID-${index}`, `valid-${index}`)
  );
  const otherGroup = member('TEST-OTHER-GROUP', 'other-group', 'Aqours');
  const nijiLive = live('TEST-NIJI-LIVE', 'niji-live');
  const opponent = member('TEST-OPPONENT', 'opponent-niji', '虹ヶ咲', P2);
  const outsideCheer = member('TEST-OUTSIDE-CHEER', 'outside-cheer');
  const stale = member('TEST-STALE', 'stale-niji');
  const unrevealed = member('TEST-UNREVEALED', 'unrevealed-niji');
  const followupSource = member('TEST-FOLLOWUP-SOURCE', 'followup-source');
  const followupDraw = member('TEST-FOLLOWUP-DRAW', 'followup-draw');
  const currentCheerIds = [
    ...valid.map((card) => card.instanceId),
    otherGroup.instanceId,
    nijiLive.instanceId,
    opponent.instanceId,
    unrevealed.instanceId,
  ];
  let game = registerCards(session.state!, [
    source,
    performedLive,
    ...valid,
    otherGroup,
    nijiLive,
    opponent,
    outsideCheer,
    stale,
    unrevealed,
    followupSource,
    followupDraw,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: addCardToZone({ ...player.mainDeck, cardIds: [] }, followupDraw.instanceId),
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [performedLive.instanceId],
      cardStates: new Map([
        [
          performedLive.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ],
      ]),
    },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      followupSource.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentCheerIds,
      revealedCardIds: currentCheerIds.filter((cardId) => cardId !== unrevealed.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[performedLive.instanceId, true]]),
      firstPlayerCheerCardIds: [...currentCheerIds, stale.instanceId],
      performingPlayerId: P1,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    source,
    valid,
    otherGroup,
    nijiLive,
    opponent,
    outsideCheer,
    stale,
    unrevealed,
    followupSource,
    followupDraw,
    setNow(value: number) {
      now = value;
    },
  };
}

function startLiveSuccess(scenario: ReturnType<typeof buildScenario>): void {
  const checked = new GameService().executeCheckTiming(scenario.session.state!, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(checked.success).toBe(true);
  (scenario.session as unknown as { authorityState: GameState }).authorityState = checked.gameState;
}

function advancePublicSelection(scenario: ReturnType<typeof buildScenario>, playerId = P1): void {
  const effect = scenario.session.state!.activeEffect!;
  const deadline = effect.publicCardSelectionAutoAdvanceAt!;
  scenario.setNow(deadline);
  const result = scenario.session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(playerId, effect.id, deadline)
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!N-pb1-012-P＋ / R 费用11「鐘 嵐珠」 LIVE_SUCCESS', () => {
  it('uses the real ON_LIVE_SUCCESS check timing and exposes only current movable own Nijigasaki members', () => {
    const scenario = buildScenario(2);
    startLiveSuccess(scenario);
    const effect = scenario.session.state?.activeEffect;
    expect(effect).toMatchObject({
      abilityId: ABILITY_ID,
      stepId: PL_N_PB1_012_SELECT_NIJIGASAKI_MEMBER_CHEER_TO_HAND_STEP_ID,
      effectText: EFFECT_TEXT,
      stepText: '请选择1张因声援被公开的『虹咲』成员卡加入手牌。',
      selectionLabel: '选择要加入手牌的声援公开虹咲成员',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      selectableCardVisibility: 'PUBLIC',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'REVEALED_CHEER',
          destination: 'HAND',
        },
      },
    });
    expect(effect?.skipSelectionLabel).toBeUndefined();
    expect(effect?.selectableCardIds).toEqual(scenario.valid.map((card) => card.instanceId));
    for (const excluded of [
      scenario.otherGroup,
      scenario.nijiLive,
      scenario.opponent,
      scenario.outsideCheer,
      scenario.stale,
      scenario.unrevealed,
    ]) {
      expect(effect?.selectableCardIds).not.toContain(excluded.instanceId);
    }
    expect(
      scenario.session.state?.actionHistory.some(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY_ID
      )
    ).toBe(true);
  });

  it('requires exactly one target when one or many are legal and has no pre-selection confirm-only', () => {
    for (const validCount of [1, 2]) {
      const scenario = buildScenario(validCount);
      startLiveSuccess(scenario);
      expect(scenario.session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(
        true
      );
      const empty = scenario.session.executeCommand(
        createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id)
      );
      expect(empty.success).toBe(false);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    }
  });

  it('first publicly confirms the selected object to both players, then moves and cleans both resolution lists', () => {
    const scenario = buildScenario(2);
    startLiveSuccess(scenario);
    const selectedId = scenario.valid[1]!.instanceId;
    const submitted = scenario.session.executeCommand(
      createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, selectedId)
    );
    expect(submitted.success, submitted.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [selectedId],
    });
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.resolutionZone.cardIds).toContain(selectedId);

    const expectedPublicId = createPublicObjectId(selectedId);
    for (const viewerId of [P1, P2]) {
      const view = projectPlayerViewState(scenario.session.state!, viewerId, { now: 10_000 });
      expect(view.activeEffect?.revealedObjectIds).toEqual([expectedPublicId]);
      expect(view.activeEffect?.revealedObjectIds).not.toContain(selectedId);
    }

    advancePublicSelection(scenario, P2);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([selectedId]);
    expect(scenario.session.state?.resolutionZone.cardIds).not.toContain(selectedId);
    expect(scenario.session.state?.resolutionZone.revealedCardIds).not.toContain(selectedId);
    expect(scenario.session.state?.activeEffect).toBeNull();
  });

  it.each([P1, P2])(
    'allows participant %s to resume at the deadline and is idempotent',
    (participantId) => {
      const scenario = buildScenario(1);
      startLiveSuccess(scenario);
      const selectedId = scenario.valid[0]!.instanceId;
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, selectedId)
        ).success
      ).toBe(true);
      const effectId = scenario.session.state!.activeEffect!.id;
      advancePublicSelection(scenario, participantId);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([selectedId]);
      const repeated = scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(participantId, effectId, 12_000)
      );
      expect(repeated.success).toBe(false);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([selectedId]);
    }
  );

  it('does not move a target that becomes stale during display and restores a retryable selection', () => {
    const scenario = buildScenario(2);
    startLiveSuccess(scenario);
    const staleId = scenario.valid[0]!.instanceId;
    const remainingId = scenario.valid[1]!.instanceId;
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, staleId)
      ).success
    ).toBe(true);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = {
      ...scenario.session.state!,
      resolutionZone: {
        ...scenario.session.state!.resolutionZone,
        cardIds: scenario.session.state!.resolutionZone.cardIds.filter((id) => id !== staleId),
        revealedCardIds: scenario.session.state!.resolutionZone.revealedCardIds.filter(
          (id) => id !== staleId
        ),
      },
    };
    advancePublicSelection(scenario, P2);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(staleId);
    expect(scenario.session.state?.activeEffect?.stepId).toBe(
      PL_N_PB1_012_SELECT_NIJIGASAKI_MEMBER_CHEER_TO_HAND_STEP_ID
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toContain(remainingId);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(staleId);
  });

  it('returns to unified continuation and resolves a later pending ability', () => {
    const scenario = buildScenario(1);
    startLiveSuccess(scenario);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = {
      ...scenario.session.state!,
      pendingAbilities: [
        {
          id: 'followup-draw',
          abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
          sourceCardId: scenario.followupSource.instanceId,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.RIGHT,
        },
      ],
    };
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          scenario.session.state!.activeEffect!.id,
          scenario.valid[0]!.instanceId
        )
      ).success
    ).toBe(true);
    advancePublicSelection(scenario);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(
      scenario.followupDraw.instanceId
    );
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('uses one confirm-only for a no-target single pending and consumes it after confirmation', () => {
    const scenario = buildScenario(0);
    startLiveSuccess(scenario);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EFFECT_TEXT,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(scenario.session.state?.activeEffect?.stepId).not.toBe(
      PL_N_PB1_012_SELECT_NIJIGASAKI_MEMBER_CHEER_TO_HAND_STEP_ID
    );
    const confirmed = scenario.session.executeCommand(
      createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id)
    );
    expect(confirmed.success, confirmed.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('automatically consumes a no-target ordered batch without empty selection windows', () => {
    const scenario = buildScenario(0);
    const state = {
      ...scenario.session.state!,
      pendingAbilities: [
        pending(scenario.source.instanceId, 'ordered-no-target-1'),
        pending(scenario.source.instanceId, 'ordered-no-target-2'),
      ],
    };
    const order = resolvePendingCardEffects(state).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY_ID &&
          action.payload.step === 'NO_REVEALED_CHEER_TARGET'
      )
    ).toHaveLength(2);
  });
});
