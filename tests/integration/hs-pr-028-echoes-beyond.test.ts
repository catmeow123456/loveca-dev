import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { HS_PR_028_LIVE_SUCCESS_EXTRA_EFFECTIVE_HEART_MEMBER_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, ownerId = PLAYER1): ReturnType<typeof createCardInstance<MemberCardData>> {
  return createCardInstance({
    cardCode,
    name: cardCode,
    groupNames: ['任意团体'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  }, ownerId, cardCode);
}

function live(): ReturnType<typeof createCardInstance<LiveCardData>> {
  return createCardInstance({
    cardCode: 'PL!HS-PR-028-PR',
    name: 'Echoes Beyond',
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  }, PLAYER1, 'echoes-live');
}

function pending(sourceCardId: string, id = 'echoes-pending'): PendingAbilityState {
  return {
    id,
    abilityId: HS_PR_028_LIVE_SUCCESS_EXTRA_EFFECTIVE_HEART_MEMBER_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function setup(extraHeart = true): { game: GameState; sourceId: string; memberId: string; drawId: string } {
  const source = live();
  const stageMember = member('arbitrary-member');
  const drawCard = member('draw-card');
  let game = createGameState('hs-pr-028', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, stageMember, drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
  }));
  if (extraHeart) {
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: stageMember.instanceId,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: 'heart-source',
      abilityId: 'heart-source-ability',
    });
  }
  return { game, sourceId: source.instanceId, memberId: stageMember.instanceId, drawId: drawCard.instanceId };
}

function confirm(started: GameState): GameState {
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

describe('PL!HS-PR-028 Echoes Beyond', () => {
  it('single pending confirms before drawing and shows real-time matching result', () => {
    const { game, sourceId, memberId, drawId } = setup(true);
    const started = resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceId)] }).gameState;
    expect(started.activeEffect?.effectText).toContain('当前舞台有1名成员');
    expect(started.activeEffect?.effectText).toContain('满足条件，实际抽1张');
    expect(started.players[0].hand.cardIds).not.toContain(drawId);

    const resolved = confirm(started);
    expect(resolved.players[0].hand.cardIds).toContain(drawId);
    expect(resolved.actionHistory).toContainEqual(expect.objectContaining({
      type: 'RESOLVE_ABILITY',
      payload: expect.objectContaining({ matchingMemberIds: [memberId], matchingMemberCount: 1, conditionMet: true, drawnCardIds: [drawId] }),
    }));
  });

  it('does not draw for equal Heart count or a stale LIVE source, without exposing internal source text', () => {
    const noExtra = setup(false);
    const started = resolvePendingCardEffects({ ...noExtra.game, pendingAbilities: [pending(noExtra.sourceId)] }).gameState;
    expect(started.activeEffect?.effectText).toContain('未满足条件，实际不抽牌');
    expect(confirm(started).players[0].hand.cardIds).toEqual([]);

    const extra = setup(true);
    const stale = updatePlayer(extra.game, PLAYER1, (player) => ({ ...player, liveZone: { ...player.liveZone, cardIds: [] } }));
    const staleStarted = resolvePendingCardEffects({ ...stale, pendingAbilities: [pending(extra.sourceId)] }).gameState;
    expect(staleStarted.activeEffect?.effectText).toContain('满足条件');
    expect(staleStarted.activeEffect?.effectText).not.toContain('实际抽1张');
    expect(staleStarted.activeEffect?.effectText).toContain('实际不抽牌');
    expect(staleStarted.activeEffect?.effectText).not.toMatch(/source|pending|payload|stale|eventId|trigger|LIVE区/);
    const staleResolved = confirm(staleStarted);
    expect(staleResolved.players[0].hand.cardIds).toEqual([]);
    expect(staleResolved.players[0].mainDeck.cardIds).toContain(extra.drawId);
  });

  it('counts SOURCE_MEMBER bonuses but not opponent members', () => {
    const base = setup(false);
    let game = addLiveModifier(base.game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: base.memberId,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      abilityId: 'self-heart',
    });
    expect(confirm(resolvePendingCardEffects({ ...game, pendingAbilities: [pending(base.sourceId)] }).gameState).players[0].hand.cardIds).toContain(base.drawId);

    const opponent = member('opponent-member', PLAYER2);
    game = registerCards(base.game, [opponent]);
    game = updatePlayer(game, PLAYER2, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
    game = addLiveModifier(game, { kind: 'HEART', target: 'TARGET_MEMBER', playerId: PLAYER2, targetMemberCardId: opponent.instanceId, hearts: [createHeartIcon(HeartColor.GREEN, 1)], sourceCardId: 'opponent-source', abilityId: 'opponent-heart' });
    expect(confirm(resolvePendingCardEffects({ ...game, pendingAbilities: [pending(base.sourceId)] }).gameState).players[0].hand.cardIds).toEqual([]);
  });

  it('ordered resolution consumes two pending effects without confirm-only windows', () => {
    const { game, sourceId } = setup(true);
    const selection = resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceId, 'first'), pending(sourceId, 'second')] }).gameState;
    const result = confirmActiveEffectStep(selection, PLAYER1, selection.activeEffect!.id, undefined, undefined, true);
    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
  });

  it('manual selection opens one confirmation bridge and returns to the real resolver', () => {
    const { game, sourceId } = setup(true);
    const selection = resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceId, 'first'), pending(sourceId, 'second')] }).gameState;
    const bridge = confirmActiveEffectStep(selection, PLAYER1, selection.activeEffect!.id, undefined, undefined, undefined, 'first');
    expect(bridge.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    const afterConfirm = confirm(bridge);
    expect(afterConfirm.activeEffect?.id).toBe('second');
    expect(afterConfirm.pendingAbilities.map((ability) => ability.id)).toEqual(['second']);
    expect(afterConfirm.actionHistory.filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.pendingAbilityId === 'first')).toHaveLength(1);
  });
});
