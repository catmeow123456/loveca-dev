import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode: string, name = cardCode, groupName = "μ's"): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function member(cardCode: string, groupName = "μ's"): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function card<T extends LiveCardData | MemberCardData>(
  data: T,
  instanceId: string,
  ownerId = PLAYER1
): CardInstance<T> {
  return createCardInstance(data, ownerId, instanceId);
}

function pending(
  sourceCardId: string,
  id = 'pending-kaguya'
): PendingAbilityState {
  return {
    id,
    abilityId: PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${id}`],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-pb1-031-kaguya', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmActiveEffect(session: GameSession, selectedCardId?: string | null): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function choosePendingAbilityBySource(session: GameSession, sourceCardId: string): GameState {
  return confirmActiveEffect(session, sourceCardId);
}

function actionPayload(game: GameState, step: string) {
  return [...game.actionHistory].reverse().find((action) => action.payload?.step === step)?.payload;
}

function setup031(options: {
  readonly handCards?: readonly CardInstance<MemberCardData>[];
  readonly cheerCards?: readonly CardInstance[];
  readonly revealedCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly includeSourceInLiveZone?: boolean;
  readonly extraPending?: readonly PendingAbilityState[];
} = {}): {
  readonly game: GameState;
  readonly sourceLive: CardInstance<LiveCardData>;
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly cheerCards: readonly CardInstance[];
} {
  const sourceLive = card(live('PL!-pb1-031-L', '輝夜の城で踊りたい'), 'kaguya-live');
  const handCards =
    options.handCards ?? [card(member('PL!-test-discard-hand'), 'discard-hand')];
  const cheerCards =
    options.cheerCards ?? [card(member('PL!-test-muse-cheer'), 'muse-cheer')];
  let game = createGameState('pl-pb1-031-kaguya', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, ...handCards, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.includeSourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: handCards.reduce((zone, entry) => addCardToZone(zone, entry.instanceId), player.hand),
  }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: [...(options.resolutionCardIds ?? cheerCards.map((entry) => entry.instanceId))],
    revealedCardIds: [
      ...(options.revealedCardIds ?? cheerCards.map((entry) => entry.instanceId)),
    ],
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
        firstPlayerCheerCardIds: [
          ...(options.firstPlayerCheerCardIds ?? cheerCards.map((entry) => entry.instanceId)),
        ],
        secondPlayerCheerCardIds: [],
        liveResults: new Map([[sourceLive.instanceId, true]]),
      },
      pendingAbilities: [pending(sourceLive.instanceId), ...(options.extraPending ?? [])],
    },
    sourceLive,
    handCards,
    cheerCards,
  };
}

describe('PL!-pb1-031-L 輝夜の城で踊りたい', () => {
  it("discards one hand card, enqueues discard triggers, then recovers an own revealed μ's member cheer card", () => {
    const { game, handCards, cheerCards } = setup031();
    const targetCardId = cheerCards[0]!.instanceId;
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB1_031_LIVE_SUCCESS_DISCARD_HAND_RECOVER_MUSE_MEMBER_CHEER_ABILITY_ID,
      stepText:
        "可以将1张手牌放置入休息室。支付后选择1张因声援公开的自己的『μ's』成员卡加入手牌。",
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });
    expect(started.activeEffect?.effectText).toContain('当前手牌 1张');
    expect(started.activeEffect?.effectText).toContain("声援公开『μ's』成员卡 1张");

    const afterDiscard = confirmActiveEffect(sessionWithState(started), handCards[0]!.instanceId);
    expect(afterDiscard.players[0].hand.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toContain(handCards[0]!.instanceId);
    expect(
      afterDiscard.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(handCards[0]!.instanceId) === true
      )
    ).toBe(true);
    expect(afterDiscard.activeEffect).toMatchObject({
      stepText: "请选择1张因声援公开的自己的『μ's』成员卡加入手牌。",
      selectionLabel: "选择声援公开的『μ's』成员卡",
      confirmSelectionLabel: '加入手牌',
      selectableCardIds: [targetCardId],
    });

    const resolved = confirmActiveEffect(sessionWithState(afterDiscard), targetCardId);
    expect(resolved.players[0].hand.cardIds).toEqual([targetCardId]);
    expect(resolved.resolutionZone.cardIds).not.toContain(targetCardId);
    expect(resolved.resolutionZone.revealedCardIds).not.toContain(targetCardId);
    expect(actionPayload(resolved, 'DISCARD_HAND_CARD_MOVE_MUSE_MEMBER_CHEER_TO_HAND')).toMatchObject({
      selectedCardId: targetCardId,
      movedCardIds: [targetCardId],
    });
  });

  it('declines without discarding or moving cheer cards', () => {
    const { game, handCards, cheerCards } = setup031();
    const started = resolvePendingCardEffects(game).gameState;
    const declined = confirmActiveEffect(sessionWithState(started), null);

    expect(declined.players[0].hand.cardIds).toContain(handCards[0]!.instanceId);
    expect(declined.players[0].waitingRoom.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(declined.resolutionZone.cardIds).toContain(cheerCards[0]!.instanceId);
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.activeEffect).toBeNull();
  });

  it('safely consumes when there is no hand card or the source LIVE has left liveZone', () => {
    const noHand = resolvePendingCardEffects(setup031({ handCards: [] }).game).gameState;
    expect(noHand.activeEffect).toBeNull();
    expect(actionPayload(noHand, 'NO_HAND_TO_DISCARD')).toBeTruthy();

    const sourceLeft = resolvePendingCardEffects(
      setup031({ includeSourceInLiveZone: false }).game
    ).gameState;
    expect(sourceLeft.activeEffect).toBeNull();
    expect(actionPayload(sourceLeft, 'SOURCE_NOT_IN_LIVE_ZONE')).toBeTruthy();
  });

  it("keeps the discard cost when no legal μ's member cheer target remains after payment", () => {
    const nonMuse = card(member('PL!-test-liella-cheer', 'Liella!'), 'non-muse-cheer');
    const liveCheer = card(live('PL!-test-muse-live'), 'muse-live-cheer');
    const { game, handCards } = setup031({ cheerCards: [nonMuse, liveCheer] });
    const started = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffect(sessionWithState(started), handCards[0]!.instanceId);

    expect(resolved.players[0].waitingRoom.cardIds).toContain(handCards[0]!.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(actionPayload(resolved, 'DISCARD_HAND_CARD_NO_MUSE_MEMBER_CHEER_TARGET')).toMatchObject({
      discardedCardId: handCards[0]!.instanceId,
      movedCardIds: [],
    });
  });

  it("filters out non-μ's, LIVE, opponent, unrevealed, and stale cheer cards", () => {
    const legal = card(member('PL!-test-legal-muse'), 'legal-muse');
    const nonMuse = card(member('PL!-test-non-muse', 'Liella!'), 'non-muse');
    const liveCard = card(live('PL!-test-live-cheer'), 'live-cheer');
    const opponent = card(member('PL!-test-opponent-muse'), 'opponent-muse', PLAYER2);
    const unrevealed = card(member('PL!-test-unrevealed'), 'unrevealed-muse');
    const stale = card(member('PL!-test-stale'), 'stale-muse');
    const { game, handCards } = setup031({
      cheerCards: [legal, nonMuse, liveCard, opponent, unrevealed, stale],
      resolutionCardIds: [
        legal.instanceId,
        nonMuse.instanceId,
        liveCard.instanceId,
        opponent.instanceId,
        unrevealed.instanceId,
      ],
      revealedCardIds: [
        legal.instanceId,
        nonMuse.instanceId,
        liveCard.instanceId,
        opponent.instanceId,
        stale.instanceId,
      ],
      firstPlayerCheerCardIds: [
        legal.instanceId,
        nonMuse.instanceId,
        liveCard.instanceId,
        opponent.instanceId,
        unrevealed.instanceId,
        stale.instanceId,
      ],
    });
    const afterDiscard = confirmActiveEffect(
      sessionWithState(resolvePendingCardEffects(game).gameState),
      handCards[0]!.instanceId
    );

    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([legal.instanceId]);

    const illegalSession = sessionWithState(afterDiscard);
    const illegalResult = illegalSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, afterDiscard.activeEffect!.id, nonMuse.instanceId)
    );
    expect(illegalResult.success).toBe(false);
    expect(illegalSession.state?.activeEffect?.id).toBe(afterDiscard.activeEffect!.id);
    expect(illegalSession.state?.players[0].hand.cardIds).not.toContain(nonMuse.instanceId);
  });

  it('does not move a target that disappears after the selection window opens', () => {
    const { game, handCards, cheerCards } = setup031();
    const targetCardId = cheerCards[0]!.instanceId;
    const afterDiscard = confirmActiveEffect(
      sessionWithState(resolvePendingCardEffects(game).gameState),
      handCards[0]!.instanceId
    );
    const staleState = updateResolutionZone(afterDiscard, (zone) => ({
      ...zone,
      cardIds: zone.cardIds.filter((cardId) => cardId !== targetCardId),
      revealedCardIds: zone.revealedCardIds.filter((cardId) => cardId !== targetCardId),
    }));
    const staleSession = sessionWithState(staleState);
    const result = staleSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, staleState.activeEffect!.id, targetCardId)
    );

    expect(result.success).toBe(false);
    expect(staleSession.state?.activeEffect?.id).toBe(staleState.activeEffect!.id);
    expect(staleSession.state?.players[0].hand.cardIds).not.toContain(targetCardId);
  });

  it('continues later pending abilities after recovering the cheer card', () => {
    const { game, sourceLive, handCards, cheerCards } = setup031({
      extraPending: [pending('missing-live', 'pending-missing-source')],
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const started = choosePendingAbilityBySource(sessionWithState(orderSelection), sourceLive.instanceId);
    const afterDiscard = confirmActiveEffect(sessionWithState(started), handCards[0]!.instanceId);
    const resolved = confirmActiveEffect(sessionWithState(afterDiscard), cheerCards[0]!.instanceId);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(actionPayload(resolved, 'SOURCE_NOT_IN_LIVE_ZONE')).toMatchObject({
      pendingAbilityId: 'pending-missing-source',
      sourceCardId: 'missing-live',
    });
  });
});
