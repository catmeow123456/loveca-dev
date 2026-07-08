import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  S_BP5_022_LIVE_START_MOVED_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function selfControl(cardCode = 'PL!S-bp5-022-L'): LiveCardData {
  return {
    cardCode,
    name: 'SELF CONTROL!!',
    groupNames: ['SaintSnow'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function live(cardCode: string, ownerGroup = 'SaintSnow'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [ownerGroup],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['SaintSnow'],
    cardType: CardType.MEMBER,
    cost: 6,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function setupLiveStart(options: {
  readonly sources?: readonly ReturnType<typeof createCardInstance>[];
  readonly members?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
} = {}): {
  readonly game: GameState;
  readonly sources: readonly ReturnType<typeof createCardInstance>[];
} {
  const sources =
    options.sources ??
    [createCardInstance(selfControl(), PLAYER1, 'self-control-live')];
  const members =
    options.members ??
    [
      { card: createCardInstance(member('PL!S-moved'), PLAYER1, 'moved-member'), slot: SlotPosition.LEFT },
      { card: createCardInstance(member('PL!S-unmoved'), PLAYER1, 'unmoved-member'), slot: SlotPosition.RIGHT },
    ];
  let game = createGameState('s-bp5-022-self-control-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, ...members.map((entry) => entry.card)]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of members) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone: sources.reduce(
        (zone, source) => addCardToStatefulZone(zone, source.instanceId),
        player.liveZone
      ),
    };
  });
  return { game, sources };
}

function moveMember(game: GameState, cardId: string, toSlot: SlotPosition): GameState {
  const result = moveMemberBetweenSlots(game, PLAYER1, cardId, toSlot);
  expect(result).not.toBeNull();
  return result!.gameState;
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function pendingLiveSuccess(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-success-${sourceCardId}`,
    abilityId: S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
  };
}

function setupLiveSuccess(options: {
  readonly ownCheerLives?: number;
  readonly opponentCheerLives?: number;
  readonly ownCheerMembers?: number;
  readonly initialScore?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceLiveId: string;
} {
  const sourceLive = createCardInstance(selfControl(), PLAYER1, 'self-control-success-live');
  const ownLives = Array.from({ length: options.ownCheerLives ?? 0 }, (_, index) =>
    createCardInstance(live(`PL!S-own-cheer-live-${index}`), PLAYER1, `own-live-${index}`)
  );
  const ownMembers = Array.from({ length: options.ownCheerMembers ?? 0 }, (_, index) =>
    createCardInstance(member(`PL!S-own-cheer-member-${index}`), PLAYER1, `own-member-${index}`)
  );
  const opponentLives = Array.from({ length: options.opponentCheerLives ?? 0 }, (_, index) =>
    createCardInstance(live(`PL!S-opponent-cheer-live-${index}`), PLAYER2, `opponent-live-${index}`)
  );
  const cheerCards = [...ownLives, ...ownMembers, ...opponentLives];
  let game = createGameState('s-bp5-022-self-control-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId),
  }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: cheerCards.map((card) => card.instanceId),
    revealedCardIds: cheerCards.map((card) => card.instanceId),
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        playerScores: new Map([[PLAYER1, options.initialScore ?? 3]]),
        firstPlayerCheerCardIds: [...ownLives, ...ownMembers].map((card) => card.instanceId),
        secondPlayerCheerCardIds: opponentLives.map((card) => card.instanceId),
      },
      pendingAbilities: [pendingLiveSuccess(sourceLive.instanceId)],
    },
    sourceLiveId: sourceLive.instanceId,
  };
}

function startLiveSuccess(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function selfControlScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID
  );
}

describe('PL!S-bp5-022-L SELF CONTROL!!', () => {
  it('LIVE_START confirms before giving BLADE only to members moved this turn and still on own stage', () => {
    const { game } = setupLiveStart();
    const moved = moveMember(game, 'moved-member', SlotPosition.CENTER);
    const preview = runLiveStart(moved);

    expect(preview.activeEffect).toMatchObject({
      abilityId: S_BP5_022_LIVE_START_MOVED_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('移动过且仍在自己舞台的成员 1名');
    expect(getMemberEffectiveBladeCount(preview, PLAYER1, 'moved-member')).toBe(1);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, 'moved-member')).toBe(2);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, 'unmoved-member')).toBe(1);
  });

  it('LIVE_START ignores moved members that have left the stage', () => {
    const { game } = setupLiveStart();
    const moved = moveMember(game, 'moved-member', SlotPosition.CENTER);
    const leftStage = updatePlayer(moved, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const preview = runLiveStart(leftStage);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, 'moved-member')).toBe(1);
  });

  it('LIVE_START auto-resolves ordered resolution and shows confirm-only when manually selecting from multiple pending abilities', () => {
    const sources = [
      createCardInstance(selfControl(), PLAYER1, 'self-control-live-a'),
      createCardInstance(selfControl(), PLAYER1, 'self-control-live-b'),
    ];
    const { game } = setupLiveStart({ sources });
    const moved = moveMember(game, 'moved-member', SlotPosition.CENTER);
    const orderSelection = runLiveStart(moved);

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(ordered, PLAYER1, 'moved-member')).toBe(3);

    const manualSelection = runLiveStart(moved);
    const preview = confirmActiveEffectStep(
      manualSelection,
      PLAYER1,
      manualSelection.activeEffect!.id,
      sources[1]!.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      sourceCardId: sources[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(getMemberEffectiveBladeCount(preview, PLAYER1, 'moved-member')).toBe(1);
  });

  it('LIVE_SUCCESS confirms realtime cheer LIVE counts, writes a liveCardId SCORE modifier, and refreshes playerScores', () => {
    const { game, sourceLiveId } = setupLiveSuccess({
      ownCheerLives: 2,
      opponentCheerLives: 1,
      initialScore: 3,
    });
    const preview = startLiveSuccess(game);

    expect(preview.activeEffect).toMatchObject({
      abilityId: S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('自己声援公开LIVE 2张');
    expect(preview.activeEffect?.effectText).toContain('对方声援公开LIVE 1张');
    expect(preview.activeEffect?.effectText).toContain('满足条件，分数+1');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(selfControlScoreModifiers(resolved)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLiveId,
      sourceCardId: sourceLiveId,
      abilityId: S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('LIVE_SUCCESS is no-op when own revealed LIVE count is equal or lower and ignores non-LIVE cheer cards', () => {
    const equalPreview = startLiveSuccess(
      setupLiveSuccess({ ownCheerLives: 1, opponentCheerLives: 1, initialScore: 3 }).game
    );
    const equalResolved = confirmActiveEffectStep(equalPreview, PLAYER1, equalPreview.activeEffect!.id);
    expect(selfControlScoreModifiers(equalResolved)).toEqual([]);
    expect(equalResolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);

    const lowerPreview = startLiveSuccess(
      setupLiveSuccess({
        ownCheerLives: 1,
        ownCheerMembers: 3,
        opponentCheerLives: 2,
        initialScore: 3,
      }).game
    );
    expect(lowerPreview.activeEffect?.effectText).toContain('自己声援公开LIVE 1张');
    expect(lowerPreview.activeEffect?.effectText).toContain('对方声援公开LIVE 2张');
    const lowerResolved = confirmActiveEffectStep(lowerPreview, PLAYER1, lowerPreview.activeEffect!.id);
    expect(selfControlScoreModifiers(lowerResolved)).toEqual([]);
    expect(lowerResolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });
});
