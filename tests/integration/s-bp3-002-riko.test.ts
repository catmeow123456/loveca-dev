import { describe, expect, it } from 'vitest';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP3_002_LIVE_SUCCESS_HIGHER_SCORE_SELF_REVEALED_CHEER_TO_HAND_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { createCardInstance, createHeartIcon, createHeartRequirement, type LiveCardData, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, updateResolutionZone, type GameState } from '../../src/domain/entities/game';
import { CardType, GamePhase, HeartColor, SubPhase, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (): MemberCardData => ({ cardCode: 'PL!S-bp3-002-P', name: '桜内梨子', groupNames: ['Aqours'], cardType: CardType.MEMBER, cost: 11, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] });
const live = (code: string): LiveCardData => ({ cardCode: code, name: code, groupNames: ['Aqours'], cardType: CardType.LIVE, score: 1, requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }) });

function createScenario(
  ownScore = 2,
  opponentScore = 1,
  options: {
    readonly sourceOwnerId?: string;
    readonly includeInCheer?: boolean;
    readonly includeInResolution?: boolean;
    readonly includeInRevealed?: boolean;
  } = {}
) {
  const source = createCardInstance(member(), options.sourceOwnerId ?? P1, 'riko'); const ownLive = createCardInstance(live('own-live'), P1, 'own-live'); const oppLive = createCardInstance(live('opp-live'), P2, 'opp-live');
  let game = registerCards(createGameState('s-bp3-002', P1, 'P1', P2, 'P2'), [source, ownLive, oppLive]);
  game = updatePlayer(game, P1, (player) => ({ ...player, liveZone: { ...player.liveZone, cardIds: [ownLive.instanceId] } }));
  game = updatePlayer(game, P2, (player) => ({ ...player, liveZone: { ...player.liveZone, cardIds: [oppLive.instanceId] } }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: options.includeInResolution === false ? [] : [source.instanceId],
    revealedCardIds: options.includeInRevealed === false ? [] : [source.instanceId],
  }));
  game = { ...game, currentPhase: GamePhase.LIVE_RESULT_PHASE, currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS, firstPlayerIndex: 0, activePlayerIndex: 0, liveResolution: { ...game.liveResolution, performingPlayerId: P1, firstPlayerCheerCardIds: options.includeInCheer === false ? [] : [source.instanceId], liveResults: new Map([[ownLive.instanceId, true]]), playerScores: new Map([[P1, ownScore], [P2, opponentScore]]) } };
  return { game, source };
}

function setup(ownScore = 2, opponentScore = 1) {
  const { game, source } = createScenario(ownScore, opponentScore);
  const resolved = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]); expect(resolved.success).toBe(true);
  const session = createGameSession(); session.createGame('s-bp3-002-session', P1, 'P1', P2, 'P2'); (session as unknown as { authorityState: GameState }).authorityState = resolved.gameState;
  return { session, source };
}

function queueTwoConditionFailurePendingAbilities() {
  const { game, source } = createScenario(1, 1);
  const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(queued.pendingAbilities).toHaveLength(1);
  const first = queued.pendingAbilities[0]!;
  return {
    source,
    first,
    game: {
      ...queued,
      pendingAbilities: [first, { ...first, id: `${first.id}:second` }],
    },
  };
}

describe('PL!S-bp3-002 樱内梨子', () => {
  it.each(['PL!S-bp3-002-P', 'PL!S-bp3-002-R'])('%s maps to the one revealed-cheer definition', (cardCode) => {
    expect(getCardAbilityDefinitionsForCardCode(cardCode).filter((definition) => definition.abilityId === ABILITY && definition.sourceZone === 'REVEALED_CHEER_CARD')).toHaveLength(1);
  });
  it('collects the currently revealed cheer source and moves only itself on the positive option', () => {
    const { session, source } = setup();
    expect(session.state!.activeEffect).toMatchObject({ abilityId: ABILITY, selectableOptions: [{ id: 'MOVE_TO_HAND', label: '加入手牌' }], skipSelectionLabel: '不加入' });
    expect(session.state!.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, undefined, undefined, 'MOVE_TO_HAND')).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual([source.instanceId]);
    expect(session.state!.resolutionZone.cardIds).not.toContain(source.instanceId);
    expect(session.state!.resolutionZone.revealedCardIds).not.toContain(source.instanceId);
  });
  it('shows a single-pending confirm-only window for an unmet score, then consumes only after confirmation', () => {
    const { session, source } = setup(1, 1);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      effectText: '【LIVE成功时】LIVE的合计分数比对方高的场合，可以将此卡加入手牌。此能力仅可从此卡因自己声援被公开的场合发动。（当前LIVE合计分数为1对1，未满足条件，此卡不加入手牌。）',
      stepText: '当前LIVE合计分数为1对1，未满足条件，此卡不加入手牌。',
    });
    expect(session.state!.pendingAbilities).toHaveLength(1);
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id)).success).toBe(true);
    expect(session.state!.pendingAbilities).toHaveLength(0);
    expect(session.state!.players[0].hand.cardIds).not.toContain(source.instanceId);
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({ step: 'CONDITION_NOT_MET', conditionMet: false, movedCardIds: [] });
  });
  it('declines without moving, rejects invalid options, and safely no-ops if the opened source becomes stale', () => {
    const { session, source } = setup();
    const invalid = session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, undefined, undefined, 'INVALID'));
    expect(invalid.success).toBe(false);
    expect(session.state!.activeEffect).not.toBeNull();
    (session as unknown as { authorityState: GameState }).authorityState = updateResolutionZone(session.state!, (zone) => ({ ...zone, cardIds: [], revealedCardIds: [] }));
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, undefined, undefined, 'MOVE_TO_HAND')).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).not.toContain(source.instanceId);
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({ step: 'SOURCE_NOT_CURRENT_REVEALED_CHEER', conditionMet: true, movedCardIds: [] });
  });
  it('keeps the source in resolution when choosing not to add it', () => {
    const { session, source } = setup();
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id)).success).toBe(true);
    expect(session.state!.resolutionZone.cardIds).toContain(source.instanceId);
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({ step: 'DECLINED_MOVE_TO_HAND', declined: true, movedCardIds: [] });
  });
  it('shows confirm-only when manually selected from multiple pending abilities', () => {
    const scenario = queueTwoConditionFailurePendingAbilities();
    const orderSelection = resolvePendingCardEffects(scenario.game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const preview = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      false,
      scenario.first.id
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: scenario.source.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
      stepText: '当前LIVE合计分数为1对1，未满足条件，此卡不加入手牌。',
    });
    expect(preview.pendingAbilities).toHaveLength(2);
    const resolved = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(resolved.actionHistory.filter((action) => action.payload.abilityId === ABILITY && action.payload.step === 'CONDITION_NOT_MET')).toHaveLength(1);
    expect(resolved.pendingAbilities).toHaveLength(1);
  });
  it('resolves an ordered batch of condition failures without opening confirm-only windows', () => {
    const scenario = queueTwoConditionFailurePendingAbilities();
    const orderSelection = resolvePendingCardEffects(scenario.game).gameState;
    const resolved = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.actionHistory.filter((action) => action.payload.abilityId === ABILITY && action.payload.step === 'CONDITION_NOT_MET')).toHaveLength(2);
  });
  it('consumes an already queued ability safely when its source becomes stale before the starter runs', () => {
    const { game, source } = createScenario();
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS]);
    const stale = updateResolutionZone(queued, (zone) => ({ ...zone, cardIds: [], revealedCardIds: [] }));
    const resolved = resolvePendingCardEffects(stale).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.players[0].hand.cardIds).not.toContain(source.instanceId);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SOURCE_NOT_CURRENT_REVEALED_CHEER',
      conditionMet: true,
      movedCardIds: [],
    });
  });
  it.each([
    ['not in the current cheer set', { includeInCheer: false }],
    ['outside resolution', { includeInResolution: false }],
    ['no longer revealed', { includeInRevealed: false }],
    ['owned by the opponent', { sourceOwnerId: P2 }],
  ])('does not enqueue a revealed-cheer source that is %s', (_label, options) => {
    const { game } = createScenario(2, 1, options);
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS]);
    expect(queued.pendingAbilities.some((ability) => ability.abilityId === ABILITY)).toBe(false);
  });
});
