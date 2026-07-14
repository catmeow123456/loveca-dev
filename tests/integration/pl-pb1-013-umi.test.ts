import { describe, expect, it } from 'vitest';
import { activateCardAbility, confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID as A } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon, createHeartRequirement, type EnergyCardData, type LiveCardData, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, type GameState } from '../../src/domain/entities/game';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (code: string): MemberCardData => ({ cardCode: code, name: code, cardType: CardType.MEMBER, cost: 9, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)], groupNames: ["μ's"] });
const live = (code: string): LiveCardData => ({ cardCode: code, name: code, cardType: CardType.LIVE, score: 3, requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }), groupNames: ["μ's"] });
const energy = (code: string): EnergyCardData => ({ cardCode: code, name: code, cardType: CardType.ENERGY });

function setup(options: { code?: string; energyCount?: number; handKind?: 'LIVE' | 'MEMBER' | 'EMPTY'; handCount?: number; phase?: GamePhase; sourceOnStage?: boolean } = {}) {
  const source = createCardInstance(member(options.code ?? 'PL!-pb1-013-R'), P1, 'source');
  const hand = options.handKind === 'EMPTY' ? null : createCardInstance(options.handKind === 'MEMBER' ? member('hand-member') : live('hand-live'), P1, 'hand');
  const extraHandCards = hand
    ? Array.from({ length: Math.max(0, (options.handCount ?? 1) - 1) }, (_, index) =>
        createCardInstance(member(`extra-hand-${index}`), P1, `extra-hand-${index}`)
      )
    : [];
  const opponentHand = createCardInstance(live('opponent-hand-live'), P2, 'opponent-hand');
  const energies = Array.from({ length: options.energyCount ?? 2 }, (_, i) => createCardInstance(energy(`energy-${i}`), P1, `energy-${i}`));
  let game = registerCards(createGameState('013', P1, 'P1', P2, 'P2'), [source, opponentHand, ...energies, ...(hand ? [hand, ...extraHandCards] : [])]);
  game = { ...game, currentPhase: options.phase ?? GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, liveResolution: { ...game.liveResolution, playerScores: new Map([[P1, 4]]) } };
  const p1 = game.players[0] as unknown as { hand: { cardIds: string[] }; energyZone: { cardIds: string[]; cardStates: Map<string, { orientation: OrientationState; face: FaceState }> }; memberSlots: { slots: Record<SlotPosition, string | null>; cardStates: Map<string, { orientation: OrientationState; face: FaceState }> } };
  p1.hand.cardIds = hand ? [hand.instanceId, ...extraHandCards.map((card) => card.instanceId)] : [];
  p1.energyZone.cardIds = energies.map((card) => card.instanceId);
  p1.energyZone.cardStates = new Map(energies.map((card) => [card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]));
  p1.memberSlots.slots = { [SlotPosition.LEFT]: null, [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId, [SlotPosition.RIGHT]: null };
  p1.memberSlots.cardStates = options.sourceOnStage === false ? new Map() : new Map([[source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]);
  (game.players[1] as unknown as { hand: { cardIds: string[] } }).hand.cardIds = [opponentHand.instanceId];
  return { game, source, hand, extraHandCards, opponentHand, energies };
}

function getBlindSelectionToken(game: GameState, index = 0): string {
  const objectId = projectPlayerViewState(game, P2).activeEffect?.selectableObjectIds?.[index];
  if (!objectId) throw new Error(`missing blind selection token at index ${index}`);
  return objectId.replace(/^obj_/, '');
}

function select(game: GameState, selectionToken = getBlindSelectionToken(game)) { return confirmActiveEffectStep(game, P2, game.activeEffect!.id, selectionToken); }
function confirm(game: GameState) { return confirmActiveEffectStep(game, P2, game.activeEffect!.id); }

describe('PL!-pb1-013 園田海未', () => {
  it.each(['PL!-pb1-013-R', 'PL!-pb1-013-P＋'])('pays before letting the opponent blindly select one of the controller hand cards for %s', (code) => {
    const s = setup({ code, handCount: 2 });
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    expect([...started.players[0].energyZone.cardStates.values()].every((state) => state.orientation === OrientationState.WAITING)).toBe(true);
    expect(started.activeEffect).toMatchObject({ awaitingPlayerId: P2, selectableCardIds: [s.hand!.instanceId, s.extraHandCards[0].instanceId], selectableCardVisibility: 'AWAITING_PLAYER_BLIND', minSelectableCards: 1, maxSelectableCards: 1, canSkipSelection: false });
    const payIndex = started.actionHistory.findIndex((action) => action.type === 'PAY_COST');
    const useIndex = started.actionHistory.findIndex((action) => action.payload.abilityId === A && action.payload.step === 'ABILITY_USE');
    expect(payIndex).toBeGreaterThanOrEqual(0); expect(useIndex).toBeGreaterThan(payIndex);
    const own = projectPlayerViewState(started, P1); const opponent = projectPlayerViewState(started, P2);
    expect(own.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(opponent.activeEffect?.selectableObjectsFaceDown).toBe(true);
    expect(opponent.activeEffect?.selectableObjectIds).toHaveLength(2);
    expect(opponent.activeEffect?.selectableObjectIds).not.toContain(createPublicObjectId(s.hand!.instanceId));
    for (const objectId of opponent.activeEffect?.selectableObjectIds ?? []) {
      expect(objectId).not.toContain(s.hand!.instanceId);
      expect(opponent.objects[objectId]).toMatchObject({ surface: 'BACK' });
      expect(opponent.objects[objectId]?.frontInfo).toBeUndefined();
      expect(opponent.objects[objectId]?.cardType).toBeUndefined();
    }
  });

  it('reveals a LIVE to both players, keeps it in hand, then adds SCORE +1 and cleans up', () => {
    const s = setup(); const started = activateCardAbility(s.game, P1, s.source.instanceId, A); const revealed = select(started);
    expect(revealed.activeEffect?.revealedCardIds).toEqual([s.hand!.instanceId]);
    expect(revealed.activeEffect?.selectableCardIds).toEqual([]);
    expect(revealed.activeEffect?.minSelectableCards).toBeUndefined();
    expect(revealed.activeEffect?.maxSelectableCards).toBeUndefined();
    expect(revealed.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(projectPlayerViewState(revealed, P1).objects[createPublicObjectId(s.hand!.instanceId)]?.surface).toBe('FRONT');
    expect(projectPlayerViewState(revealed, P2).objects[createPublicObjectId(s.hand!.instanceId)]?.surface).toBe('FRONT');
    expect(revealed.players[0].hand.cardIds).toContain(s.hand!.instanceId);
    const resolved = confirm(revealed);
    expect(resolved.activeEffect).toBeNull(); expect(resolved.liveResolution.playerScores.get(P1)).toBe(5);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({ kind: 'SCORE', playerId: P1, countDelta: 1, sourceCardId: s.source.instanceId, abilityId: A }));
    expect(resolved.players[0].hand.cardIds).toContain(s.hand!.instanceId);
    expect(resolved.actionHistory.some((action) => action.payload.step === 'REVEAL_HAND')).toBe(true);
    expect(resolved.actionHistory.map((action) => action.type)).toContain('PAY_COST');
    expect(resolved.actionHistory.filter((action) => action.payload.abilityId === A).map((action) => action.payload.step)).toEqual(expect.arrayContaining(['ABILITY_USE', 'REVEAL_HAND', 'RESOLVE_REVEALED_HAND_CARD']));
  });

  it('accepts the anonymous blind token through the authoritative GameSession command boundary', () => {
    const s = setup({ handCount: 2 });
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const token = getBlindSelectionToken(started, 1);
    const session = createGameSession();
    session.restoreRuntimeState({ authorityState: started, currentPublicSeq: 0 });

    const leakedRealId = session.executeCommand(
      createConfirmEffectStepCommand(P2, started.activeEffect!.id, s.hand!.instanceId)
    );
    expect(leakedRealId.success).toBe(false);
    expect(leakedRealId.error).toBe('选择的卡牌不能用于当前效果');

    const selected = session.executeCommand(
      createConfirmEffectStepCommand(P2, started.activeEffect!.id, token)
    );

    expect(selected.success).toBe(true);
    expect(selected.gameState.activeEffect?.revealedCardIds).toEqual([
      s.extraHandCards[0].instanceId,
    ]);
    expect(selected.gameState.activeEffect?.selectableCardIds).toEqual([]);
  });

  it('does not score for a non-LIVE and keeps an earned modifier after the source leaves', () => {
    const nonLive = setup({ handKind: 'MEMBER' });
    const noScore = confirm(select(activateCardAbility(nonLive.game, P1, nonLive.source.instanceId, A)));
    expect(noScore.liveResolution.playerScores.get(P1)).toBe(4); expect(noScore.liveResolution.liveModifiers).toEqual([]);
    const s = setup(); const scored = confirm(select(activateCardAbility(s.game, P1, s.source.instanceId, A)));
    const p1 = scored.players[0] as unknown as { memberSlots: { slots: Record<SlotPosition, string | null> } }; p1.memberSlots.slots[SlotPosition.CENTER] = null;
    expect(scored.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({ abilityId: A, sourceCardId: s.source.instanceId }));
  });

  it('rejects invalid starts, stale/forged selections, and a second use in the same turn', () => {
    for (const s of [setup({ energyCount: 1 }), setup({ handKind: 'EMPTY' }), setup({ phase: GamePhase.ENERGY_PHASE }), setup({ sourceOnStage: false }), setup({ code: 'PL!-pb1-012-R' })]) {
      const result = activateCardAbility(s.game, P1, s.source.instanceId, A); expect(result).toBe(s.game);
      expect(result.actionHistory.some((action) => action.payload.step === 'ABILITY_USE')).toBe(false);
    }
    const s = setup(); const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const token = getBlindSelectionToken(started);
    expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id, token)).toBe(started);
    expect(select(started, 'forged')).toBe(started);
    expect(select(started, s.hand!.instanceId)).toBe(started);
    expect(select(started, s.opponentHand.instanceId)).toBe(started);
    const stale = { ...started, players: started.players.map((player, index) => index === 0 ? { ...player, hand: { ...player.hand, cardIds: [] } } : player) };
    expect(select(stale, token)).toBe(stale);
    const busy = { ...s.game, activeEffect: { id: 'busy', abilityId: 'busy', sourceCardId: s.source.instanceId, controllerId: P1, effectText: '处理中', stepId: 'busy', stepText: '处理中', awaitingPlayerId: P1 } };
    expect(activateCardAbility(busy, P1, s.source.instanceId, A)).toBe(busy);
    const resolved = confirm(select(started, token));
    expect(activateCardAbility(resolved, P1, s.source.instanceId, A)).toBe(resolved);
  });
});
