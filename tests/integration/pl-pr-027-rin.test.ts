import { describe, expect, it } from 'vitest';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID as DIVE_ABILITY,
  PL_PR_027_ON_ENTER_RECOVER_CARD_IF_SUCCESS_SCORE_ELEVEN_ABILITY_ID as RIN_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../src/application/card-effects/runtime/enter-waiting-room-triggers';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { sumSuccessfulLiveScore } from '../../src/domain/rules/success-live-score';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const EFFECT_TEXT =
  '【登场】存在于自己的成功LIVE卡区的卡片的分数合计大于等于１１的场合，从自己的休息室将１张卡片加入手牌。';

function scoreCard(id: string, score: number, owner = P1) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({}),
  };
  return createCardInstance(data, owner, id);
}

function setup({
  ownScores = [5, 6],
  hasTargets = true,
  hasUmi = false,
}: {
  readonly ownScores?: readonly number[];
  readonly hasTargets?: boolean;
  readonly hasUmi?: boolean;
} = {}) {
  const rin = createCardInstance(getNovember20MemberData('PL!-PR-027-PR'), P1, 'rin');
  const memberData: MemberCardData = {
    cardCode: 'TEST-AQOURS-MEMBER',
    name: 'Aqours member',
    cardType: CardType.MEMBER,
    groupNames: ['Aqours'],
    cost: 3,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
  const memberTarget = createCardInstance(memberData, P1, 'member-target');
  const diveData: LiveCardData = {
    cardCode: 'PL!N-bp4-026-L',
    name: 'DIVE!',
    cardType: CardType.LIVE,
    groupNames: ['虹ヶ咲'],
    score: 5,
    requirements: createHeartRequirement({
      [HeartColor.RED]: 4,
      [HeartColor.BLUE]: 3,
      [HeartColor.RAINBOW]: 5,
    }),
  };
  const dive = createCardInstance(diveData, P1, 'dive');
  const opponentScore = scoreCard('opponent-success', 11, P2);
  const opponentTarget = scoreCard('opponent-target', 4, P2);
  const ownDeckCard = scoreCard('own-deck-card', 2);
  const opponentDeckCard = scoreCard('opponent-deck-card', 2, P2);
  const ownSuccess = ownScores.map((score, index) => scoreCard(`own-success-${index}`, score));
  const umi = hasUmi
    ? createCardInstance(getNovember20MemberData('PL!-bp8-013-N'), P1, 'umi')
    : null;
  let game = registerCards(createGameState('pl-pr-027-rin', P1, 'P1', P2, 'P2'), [
    rin,
    memberTarget,
    dive,
    opponentScore,
    opponentTarget,
    ownDeckCard,
    opponentDeckCard,
    ...ownSuccess,
    ...(umi ? [umi] : []),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [rin.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [ownDeckCard.instanceId] },
    successZone: { ...player.successZone, cardIds: ownSuccess.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: hasTargets ? [memberTarget.instanceId, dive.instanceId] : [],
    },
    memberSlots: umi
      ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, umi.instanceId, {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        })
      : player.memberSlots,
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [opponentDeckCard.instanceId] },
    successZone: { ...player.successZone, cardIds: [opponentScore.instanceId] },
    waitingRoom: { ...player.waitingRoom, cardIds: [opponentTarget.instanceId] },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
  };
  const placement = playMemberFromZoneToEmptySlot(game, P1, {
    cardId: rin.instanceId,
    toSlot: SlotPosition.CENTER,
    sourceZone: ZoneType.HAND,
  })!;
  const queued = enqueueTriggeredCardEffects(
    placement.gameState,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: [placement.enterStageEvent],
    }
  );
  expect(queued.pendingAbilities).toMatchObject([
    {
      abilityId: RIN_ABILITY,
      sourceCardId: rin.instanceId,
      controllerId: P1,
      eventIds: [placement.enterStageEvent.eventId],
    },
  ]);
  return { game: queued, rin, memberTarget, dive, opponentTarget };
}

function openSession(game: GameState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  const restoreState = (state: GameState) => {
    session.restoreRuntimeState({
      authorityState: state,
      currentPublicSeq: session.getRuntimeCaptureCursor().publicSeq,
    });
  };
  restoreState(resolvePendingCardEffects(game).gameState);
  return {
    session,
    restoreState,
    setNow: (time: number) => {
      now = time;
    },
  };
}

function recoveryEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_HAND &&
        event.fromZone === ZoneType.WAITING_ROOM
    );
}

describe('PL!-PR-027 费用13「星空凛」', () => {
  it.each([
    { ownScores: [5, 5], hasTargets: true, step: 'SUCCESS_SCORE_BELOW_ELEVEN' },
    { ownScores: [5, 6], hasTargets: false, step: 'NO_WAITING_ROOM_CARD_TARGET' },
  ])('consumes empty resolution with $step even with a qualifying opponent and targets', (test) => {
    const { game, opponentTarget } = setup(test);
    const done = resolvePendingCardEffects(game).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[1].waitingRoom.cardIds).toEqual([opponentTarget.instanceId]);
    expect(recoveryEvents(done)).toEqual([]);
    expect(done.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        payload: expect.objectContaining({ step: test.step, abilityId: RIN_ABILITY }),
      })
    );
  });

  it('at exactly 11 requires one owned card, publicly displays it, then performs the actual recovery and its hand trigger', () => {
    const { game, memberTarget, dive, opponentTarget } = setup();
    expect(sumSuccessfulLiveScore(game, P1)).toBe(11);
    const { session, setNow } = openSession(game);
    const selection = session.state!.activeEffect!;
    expect(selection).toMatchObject({
      abilityId: RIN_ABILITY,
      effectText: EFFECT_TEXT,
      selectableCardIds: [memberTarget.instanceId, dive.instanceId],
      canSkipSelection: false,
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
    });
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, selection.id, null)).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, selection.id, opponentTarget.instanceId)
      ).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          selection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [memberTarget.instanceId, dive.instanceId]
        )
      ).success
    ).toBe(false);
    expect(recoveryEvents(session.state!)).toEqual([]);

    const selected = session.executeCommand(
      createConfirmEffectStepCommand(P1, selection.id, dive.instanceId)
    );
    expect(selected.success, selected.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [dive.instanceId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    for (const viewer of [P1, P2]) {
      expect(session.getPlayerViewState(viewer)?.activeEffect).toMatchObject({
        revealedObjectIds: [createPublicObjectId(dive.instanceId)],
        publicCardSelectionAutoAdvanceAt: 12_000,
      });
    }
    const advance = createAutoAdvancePublicCardSelectionCommand(P2, selection.id, 12_000);
    expect(session.executeCommand(advance).success).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(dive.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(recoveryEvents(session.state!)).toEqual([]);

    setNow(12_000);
    expect(session.executeCommand(advance).success).toBe(true);
    expect(session.executeCommand(advance).success).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([memberTarget.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([dive.instanceId]);
    const [enteredHand] = recoveryEvents(session.state!);
    expect(recoveryEvents(session.state!)).toMatchObject([
      {
        cardInstanceIds: [dive.instanceId],
        fromZone: ZoneType.WAITING_ROOM,
        toZone: ZoneType.HAND,
        ownerId: P1,
        controllerId: P1,
      },
    ]);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: DIVE_ABILITY,
      sourceCardId: dive.instanceId,
      selectableCardIds: [dive.instanceId],
    });
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'TRIGGER_ABILITY',
        payload: expect.objectContaining({ abilityId: DIVE_ABILITY, eventId: enteredHand.eventId }),
      })
    );
  });

  it('uses Umi’s effect-adjusted total with Rin’s actual source after Rin leaves the stage', () => {
    const { game, rin, memberTarget, dive } = setup({ ownScores: [4, 5], hasUmi: true });
    const sourceLeft = moveCardUniversal(
      game,
      P1,
      rin.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.WAITING_ROOM,
      { sourceSlot: SlotPosition.CENTER }
    );
    expect(sumSuccessfulLiveScore(sourceLeft, P1)).toBe(9);
    expect(sourceLeft.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    const { session, setNow } = openSession(sourceLeft);
    const selection = session.state!.activeEffect!;
    expect(selection).toMatchObject({
      abilityId: RIN_ABILITY,
      sourceCardId: rin.instanceId,
      selectableCardIds: [memberTarget.instanceId, dive.instanceId, rin.instanceId],
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, selection.id, memberTarget.instanceId)
      ).success
    ).toBe(true);
    setNow(12_000);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, selection.id, 12_000))
        .success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([memberTarget.instanceId]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it.each(['left', 're-entered'] as const)(
    'does not recover a displayed card that %s the waiting room',
    (change) => {
      const { game, memberTarget } = setup();
      const { session, restoreState, setNow } = openSession(game);
      const effectId = session.state!.activeEffect!.id;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, effectId, memberTarget.instanceId)
        ).success
      ).toBe(true);
      const otherMove = moveCardUniversal(
        session.state!,
        P1,
        memberTarget.instanceId,
        ZoneType.WAITING_ROOM,
        ZoneType.HAND
      );
      const changed =
        change === 're-entered'
          ? discardOneHandCardToWaitingRoomAndEnqueueTriggers(
              otherMove,
              P1,
              memberTarget.instanceId,
              {},
              enqueueTriggeredCardEffects
            )!.gameState
          : otherMove;
      restoreState(changed);
      expect(session.state?.activeEffect).toMatchObject({
        id: effectId,
        stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
        publicCardSelectionAutoAdvanceAt: 12_000,
      });
      const advance = createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000);
      expect(session.executeCommand(advance).success).toBe(false);
      setNow(12_000);
      expect(session.executeCommand(advance).success).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.pendingAbilities).toEqual([]);
      expect(session.state?.players[0].waitingRoom.cardIds.includes(memberTarget.instanceId)).toBe(
        change === 're-entered'
      );
      expect(session.state?.players[0].hand.cardIds).toEqual(changed.players[0].hand.cardIds);
      expect(recoveryEvents(session.state!)).toEqual([]);
      expect(session.state?.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'RESOLVE_ABILITY',
          payload: expect.objectContaining({
            abilityId: RIN_ABILITY,
            step: 'STALE_SELECTION_NO_LONGER_ELIGIBLE',
          }),
        })
      );
    }
  );
});
