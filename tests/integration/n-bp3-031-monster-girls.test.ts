import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addMemberBelowMember, placeCardInSlot, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase, TriggerCondition } from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const P1 = 'player1';
const P2 = 'player2';

function live(): LiveCardData { return { cardCode: 'PL!N-bp3-031-L', name: 'MONSTER GIRLS', groupNames: ['虹ヶ咲'], cardType: CardType.LIVE, score: 6, requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }) }; }
function member(code: string): MemberCardData { return { cardCode: code, name: code, groupNames: ['虹ヶ咲'], cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] }; }

function setup(options: { own?: readonly OrientationState[]; opponentWaiting?: boolean; memberBelow?: boolean; sources?: number; initialScore?: number } = {}): { game: GameState; sourceIds: string[] } {
  const sources = Array.from({ length: options.sources ?? 1 }, (_, i) => createCardInstance(live(), P1, `monster-${i}`));
  const own = (options.own ?? []).map((orientation, i) => ({ orientation, card: createCardInstance(member(`own-${i}`), P1, `own-${i}`) }));
  const opponent = createCardInstance(member('opponent'), P2, 'opponent');
  const below = createCardInstance(member('below'), P1, 'below');
  let game = registerCards(createGameState('monster-girls', P1, 'P1', P2, 'P2'), [...sources, ...own.map((x) => x.card), opponent, below]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = own.reduce((slots, entry, index) => placeCardInSlot(slots, [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!, entry.card.instanceId, { orientation: entry.orientation, face: FaceState.FACE_UP }), player.memberSlots);
    if (options.memberBelow) memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, below.instanceId);
    return { ...player, liveZone: sources.reduce((zone, source) => addCardToStatefulZone(zone, source.instanceId), player.liveZone), memberSlots };
  });
  if (options.opponentWaiting) game = updatePlayer(game, P2, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }) }));
  return { sourceIds: sources.map((source) => source.instanceId), game: { ...game, currentPhase: GamePhase.LIVE_RESULT_PHASE, currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS, firstPlayerIndex: 0, activePlayerIndex: 0, liveResolution: { ...game.liveResolution, playerScores: new Map([[P1, options.initialScore ?? 6]]), liveResults: new Map(sources.map((source) => [source.instanceId, true])), performingPlayerId: P1 } } };
}

function modifiers(game: GameState) { return game.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'SCORE' && modifier.abilityId === PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID); }
function check(game: GameState) { const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]); expect(result.success, result.error).toBe(true); return result.gameState; }

describe('PL!N-bp3-031-L MONSTER GIRLS', () => {
  it.each([[0, 0], [1, 1], [2, 2], [3, 3]] as const)('adds SCORE +%i for %i own waiting stage members', (count, expected) => {
    const state = confirmIfConfirmOnly(check(setup({ own: Array(count).fill(OrientationState.WAITING) }).game), P1);
    expect(modifiers(state)).toHaveLength(expected ? 1 : 0);
    expect(state.liveResolution.playerScores.get(P1)).toBe(6 + expected);
  });

  it('excludes ACTIVE, memberBelow, opponent WAITING, and empty slots', () => {
    const state = confirmIfConfirmOnly(check(setup({ own: [OrientationState.ACTIVE, OrientationState.WAITING], opponentWaiting: true, memberBelow: true }).game), P1);
    expect(modifiers(state)).toContainEqual(expect.objectContaining({ countDelta: 1 }));
  });

  it('uses a realtime confirm-only preview and re-reads member state on confirmation', () => {
    const checked = check(setup({ own: [OrientationState.WAITING, OrientationState.ACTIVE] }).game);
    expect(checked.activeEffect).toMatchObject({ abilityId: PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID, metadata: { confirmOnlyPendingAbility: true } });
    expect(checked.activeEffect?.effectText).toContain('当前自己舞台有1名待机成员，实际[スコア]+1');
    expect(checked.activeEffect?.effectText).not.toMatch(/source|pending|stale|来源.*LIVE区/);
    expect(modifiers(checked)).toEqual([]);
    const changed = updatePlayer(checked, P1, (player) => { const cardStates = new Map(player.memberSlots.cardStates); for (const [id, state] of cardStates) cardStates.set(id, { ...state, orientation: OrientationState.WAITING }); return { ...player, memberSlots: { ...player.memberSlots, cardStates } }; });
    const resolved = confirmIfConfirmOnly(changed, P1);
    expect(modifiers(resolved)).toContainEqual(expect.objectContaining({ countDelta: 2 }));
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(8);
  });

  it('ordered resolution is automatic while manual pending selection opens confirmation', () => {
    const checked = check(setup({ own: [OrientationState.WAITING], sources: 2, initialScore: 12 }).game);
    const ordered = confirmActiveEffectStep(checked, P1, checked.activeEffect!.id, undefined, undefined, true);
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.liveResolution.playerScores.get(P1)).toBe(14);
    const manual = confirmActiveEffectStep(checked, P1, checked.activeEffect!.id, checked.pendingAbilities[0]!.sourceCardId);
    expect(manual.activeEffect?.metadata).toMatchObject({ confirmOnlyPendingAbility: true });
    expect(modifiers(manual)).toEqual([]);
  });

  it('consumes a stale source as no-op and replaces duplicate source/ability modifiers', () => {
    const scenario = setup({ own: [OrientationState.WAITING, OrientationState.WAITING] });
    const checked = check(scenario.game);
    const departed = updatePlayer(checked, P1, (player) => ({ ...player, liveZone: removeCardFromStatefulZone(player.liveZone, scenario.sourceIds[0]!) }));
    const noOp = confirmIfConfirmOnly(departed, P1);
    expect(noOp.activeEffect).toBeNull(); expect(modifiers(noOp)).toEqual([]); expect(noOp.liveResolution.playerScores.get(P1)).toBe(6);

    const once = confirmIfConfirmOnly(check(scenario.game), P1);
    const repeated = confirmIfConfirmOnly(check({ ...once, pendingAbilities: [{ id: 'monster-repeat', abilityId: PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID, sourceCardId: scenario.sourceIds[0]!, controllerId: P1, triggerCondition: TriggerCondition.ON_LIVE_SUCCESS }] }), P1);
    expect(modifiers(repeated)).toHaveLength(1);
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(8);
  });
});
