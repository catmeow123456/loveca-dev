import { describe, expect, it } from 'vitest';
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
import { S_BP2_021_LIVE_SUCCESS_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function live(cardCode: string, groupNames: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setup(
  options: { readonly includeMovableLive?: boolean; readonly additionalSource?: boolean } = {}
) {
  const session = createGameSession();
  session.createGame('revealed-cheer-selection-bp2-021', PLAYER1, 'P1', PLAYER2, 'P2');
  const source = createCardInstance(live('PL!S-bp2-021-L'), PLAYER1, 'bp2-021-source');
  const additionalSource = options.additionalSource
    ? createCardInstance(live('PL!S-bp2-021-L'), PLAYER1, 'bp2-021-additional-source')
    : null;
  const deckTop = createCardInstance(live('PL!S-test-deck-top'), PLAYER1, 'deck-top');
  const deckBottom = createCardInstance(live('PL!S-test-deck-bottom'), PLAYER1, 'deck-bottom');
  const movableLive = createCardInstance(live('PL!S-test-movable-live'), PLAYER1, 'movable-live');
  const ownMember = createCardInstance(member('PL!S-test-member'), PLAYER1, 'own-member');
  const opponentLive = createCardInstance(live('PL!S-test-opponent-live'), PLAYER2, 'opponent-live');
  const staleLive = createCardInstance(live('PL!S-test-stale-live'), PLAYER1, 'stale-live');
  const unrevealedLive = createCardInstance(live('PL!S-test-unrevealed-live'), PLAYER1, 'unrevealed-live');
  let game = registerCards(session.state!, [
    source,
    ...(additionalSource ? [additionalSource] : []),
    deckTop,
    deckBottom,
    movableLive,
    ownMember,
    opponentLive,
    staleLive,
    unrevealedLive,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId, deckBottom.instanceId] },
    liveZone: {
      ...player.liveZone,
      cardIds: [source.instanceId, ...(additionalSource ? [additionalSource.instanceId] : [])],
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ...(additionalSource
          ? [[additionalSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]
          : []),
      ]),
    },
  }));
  const currentProcessingIds = [
    ...(options.includeMovableLive === false ? [] : [movableLive.instanceId]),
    ownMember.instanceId,
    opponentLive.instanceId,
    unrevealedLive.instanceId,
  ];
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentProcessingIds,
      revealedCardIds: currentProcessingIds.filter((cardId) => cardId !== unrevealedLive.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([
        [source.instanceId, true],
        ...(additionalSource ? [[additionalSource.instanceId, true]] : []),
      ]),
      firstPlayerCheerCardIds: [...currentProcessingIds, staleLive.instanceId],
      performingPlayerId: PLAYER1,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return {
    session,
    deckTopId: deckTop.instanceId,
    deckBottomId: deckBottom.instanceId,
    movableLiveId: movableLive.instanceId,
    ownMemberId: ownMember.instanceId,
    opponentLiveId: opponentLive.instanceId,
    staleLiveId: staleLive.instanceId,
    unrevealedLiveId: unrevealedLive.instanceId,
  };
}

describe('revealed cheer selection: PL!S-bp2-021-L 未体験HORIZON', () => {
  it('offers only current own revealed LIVE cards in one optional selection window', () => {
    const { session, movableLiveId, ownMemberId, opponentLiveId, staleLiveId, unrevealedLiveId } = setup();

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: S_BP2_021_LIVE_SUCCESS_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
      stepId: 'S_BP2_021_SELECT_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM',
      selectableCardIds: [movableLiveId],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      confirmSelectionLabel: '放置于入卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(ownMemberId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(opponentLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(staleLiveId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(unrevealedLiveId);
  });

  it('moves the selected LIVE to the bottom without disturbing existing deck order and continues pending', () => {
    const { session, deckTopId, deckBottomId, movableLiveId } = setup();
    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null,
        null,
        false,
        null,
        [movableLiveId]
      )
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      deckTopId,
      deckBottomId,
      movableLiveId,
    ]);
    expect(session.state?.resolutionZone.cardIds).not.toContain(movableLiveId);
    expect(session.state?.resolutionZone.revealedCardIds).not.toContain(movableLiveId);
  });

  it('skips without moving any card and does not add a confirm-only step', () => {
    const { session, deckTopId, deckBottomId, movableLiveId } = setup();
    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null,
        null,
        false,
        null,
        []
      )
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTopId, deckBottomId]);
    expect(session.state?.resolutionZone.cardIds).toContain(movableLiveId);
  });

  it('opens confirm-only for a single no-target pending, then consumes it after confirmation', () => {
    const { session } = setup({ includeMovableLive: false });
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: S_BP2_021_LIVE_SUCCESS_REVEALED_CHEER_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('automatically consumes no-target pending abilities during ordered resolution without confirm-only', () => {
    const { session } = setup({ includeMovableLive: false, additionalSource: true });
    const orderEffect = session.state?.activeEffect;
    expect(orderEffect?.metadata?.pendingAbilityIds).toHaveLength(2);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        orderEffect!.id,
        orderEffect!.selectableCardIds![0],
        null,
        true
      )
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
  });
});
