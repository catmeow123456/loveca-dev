import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_BP1_021_LIVE_SUCCESS_HASUNOSORA_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLiveCard(cardCode: string, name = cardCode, groupName = '蓮ノ空'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function createMemberCard(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function setupHolidayHolidayScenario(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly validHasunosoraLiveId: string;
  readonly otherGroupLiveId: string;
  readonly hasunosoraMemberId: string;
  readonly staleHasunosoraLiveId: string;
  readonly unrevealedHasunosoraLiveId: string;
} {
  const session = createGameSession();
  session.createGame('hs-bp1-021-holiday-holiday-cheer', PLAYER1, 'P1', PLAYER2, 'P2');

  const sourceLive = createCardInstance(
    createLiveCard('PL!HS-bp1-021-L', 'Holiday∞Holiday'),
    PLAYER1,
    'hs-bp1-021-source'
  );
  const validHasunosoraLive = createCardInstance(
    createLiveCard('PL!HS-test-valid-hasunosora-live', 'Valid Hasunosora Live'),
    PLAYER1,
    'hs-valid-live'
  );
  const otherGroupLive = createCardInstance(
    createLiveCard('PL!HS-test-other-live', 'Other Live', 'Aqours'),
    PLAYER1,
    'hs-other-live'
  );
  const hasunosoraMember = createCardInstance(
    createMemberCard('PL!HS-test-hasunosora-member', 'Hasunosora Member'),
    PLAYER1,
    'hs-member'
  );
  const staleHasunosoraLive = createCardInstance(
    createLiveCard('PL!HS-test-stale-hasunosora-live', 'Stale Hasunosora Live'),
    PLAYER1,
    'hs-stale-live'
  );
  const unrevealedHasunosoraLive = createCardInstance(
    createLiveCard('PL!HS-test-unrevealed-hasunosora-live', 'Unrevealed Hasunosora Live'),
    PLAYER1,
    'hs-unrevealed-live'
  );

  let game = registerCards(session.state!, [
    sourceLive,
    validHasunosoraLive,
    otherGroupLive,
    hasunosoraMember,
    staleHasunosoraLive,
    unrevealedHasunosoraLive,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [sourceLive.instanceId],
      cardStates: new Map([
        [sourceLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));

  const currentProcessingCheerIds = [
    validHasunosoraLive.instanceId,
    otherGroupLive.instanceId,
    hasunosoraMember.instanceId,
    unrevealedHasunosoraLive.instanceId,
  ];
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentProcessingCheerIds,
      revealedCardIds: currentProcessingCheerIds.filter(
        (cardId) => cardId !== unrevealedHasunosoraLive.instanceId
      ),
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      firstPlayerCheerCardIds: [...currentProcessingCheerIds, staleHasunosoraLive.instanceId],
      performingPlayerId: PLAYER1,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  const checkResult = new GameService().executeCheckTiming(game, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(checkResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

  return {
    session,
    validHasunosoraLiveId: validHasunosoraLive.instanceId,
    otherGroupLiveId: otherGroupLive.instanceId,
    hasunosoraMemberId: hasunosoraMember.instanceId,
    staleHasunosoraLiveId: staleHasunosoraLive.instanceId,
    unrevealedHasunosoraLiveId: unrevealedHasunosoraLive.instanceId,
  };
}

describe('PL!HS-bp1-021-L Holiday Holiday revealed cheer selection', () => {
  it('moves one current revealed own Hasunosora LIVE card to hand', () => {
    const {
      session,
      validHasunosoraLiveId,
      otherGroupLiveId,
      hasunosoraMemberId,
      staleHasunosoraLiveId,
      unrevealedHasunosoraLiveId,
    } = setupHolidayHolidayScenario();

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_021_LIVE_SUCCESS_HASUNOSORA_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validHasunosoraLiveId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(otherGroupLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(hasunosoraMemberId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(staleHasunosoraLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(unrevealedHasunosoraLiveId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, validHasunosoraLiveId)
    );

    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [validHasunosoraLiveId],
    });
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toContain(validHasunosoraLiveId);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([validHasunosoraLiveId]);
    expect(session.state?.resolutionZone.cardIds).not.toContain(validHasunosoraLiveId);
    expect(session.state?.resolutionZone.revealedCardIds).not.toContain(validHasunosoraLiveId);
  });

  it('rejects stale revealed cheer cards that are no longer movable', () => {
    const { session, staleHasunosoraLiveId, validHasunosoraLiveId } =
      setupHolidayHolidayScenario();

    const rejectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        staleHasunosoraLiveId
      )
    );

    expect(rejectResult.success).toBe(false);
    expect(rejectResult.error).toBe('选择的卡牌不能用于当前效果');
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_021_LIVE_SUCCESS_HASUNOSORA_LIVE_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toContain(validHasunosoraLiveId);
  });
});
