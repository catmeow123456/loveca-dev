import { describe, expect, it } from 'vitest';
import { createConfirmEffectStepCommand, createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_PR_014_ON_ENTER_BLIND_REVEAL_OPPONENT_HAND_THREE_DRAW_IF_NO_LIVE_ABILITY_ID as A, PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { createCardInstance, createHeartIcon, createHeartRequirement, type LiveCardData, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createPublicObjectId } from '../../src/online/projector';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../src/application/card-effects/ability-definition-types';
import { CardType, GamePhase, HeartColor, SlotPosition, SubPhase, TriggerCondition, TurnType } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const EFFECT_TEXT = '【登场】自己在不查看的情况下将对手的3张手牌公开。通过这个效果公开的卡牌中不包含Live卡的场合，抽1张牌。';

const member = (code: string, owner = P1): ReturnType<typeof createCardInstance> =>
  createCardInstance({ cardCode: code, name: code, cardType: CardType.MEMBER, cost: 2, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)], groupNames: ["μ's"] } satisfies MemberCardData, owner, code);
const live = (code: string, owner = P2): ReturnType<typeof createCardInstance> =>
  createCardInstance({ cardCode: code, name: code, cardType: CardType.LIVE, score: 1, requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }), groupNames: ["μ's"] } satisfies LiveCardData, owner, code);

function setup(kinds: readonly ('MEMBER' | 'LIVE')[], options: { deckCount?: number; waitingCount?: number } = {}) {
  const source = member('PL!-PR-014-PR');
  const opponentHand = kinds.map((kind, index) => kind === 'LIVE' ? live(`opp-live-${index}`) : member(`opp-member-${index}`, P2));
  const deck = Array.from({ length: options.deckCount ?? 2 }, (_, index) => member(`deck-${index}`));
  const waiting = Array.from({ length: options.waitingCount ?? 0 }, (_, index) => member(`waiting-${index}`));
  let game = registerCards(createGameState('pl-pr-014', P1, 'P1', P2, 'P2'), [source, ...opponentHand, ...deck, ...waiting]);
  game = updatePlayer(game, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [source.instanceId] }, mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) }, waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) } }));
  game = updatePlayer(game, P2, (player) => ({ ...player, hand: { ...player.hand, cardIds: opponentHand.map((card) => card.instanceId) } }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, currentTurnType: TurnType.NORMAL, activePlayerIndex: 0, waitingPlayerId: null };
  const session = createGameSession();
  session.createGame('pl-pr-014-session', P1, 'P1', P2, 'P2');
  setState(session, game);
  session.setManualOperationMode('FREE');
  const result = session.executeCommand(createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, { freePlay: true }));
  expect(result.success, result.error).toBe(true);
  return { session, source, opponentHand, deck, waiting };
}

function setState(session: ReturnType<typeof createGameSession>, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function blindTokens(session: ReturnType<typeof createGameSession>): readonly string[] {
  return (session.getPlayerViewState(P1).activeEffect?.selectableObjectIds ?? []).map((id) => id.replace(/^obj_/, ''));
}

function submitBlind(session: ReturnType<typeof createGameSession>, tokens = blindTokens(session).slice(0, 3)) {
  return session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, undefined, undefined, undefined, tokens));
}

function confirmReveal(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id));
}

describe('PL!-PR-014-PR 费用2「園田海未」', () => {
  it('has exactly one independent queued ON_ENTER definition with Excel-exact Chinese text', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!-PR-014-PR');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({ abilityId: A, baseCardCodes: ['PL!-PR-014'], category: CardAbilityCategory.ON_ENTER, sourceZone: CardAbilitySourceZone.PLAYED_MEMBER, triggerCondition: TriggerCondition.ON_ENTER_STAGE, queued: true, implemented: true, effectText: EFFECT_TEXT });
    expect(definitions[0]?.abilityId).not.toBe(PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID);
    expect(definitions[0]?.abilityId).not.toBe(N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID);
    for (const otherUmiCode of ['PL!-PR-004-PR', 'PL!-pb1-013-R', 'PL!-sd1-004-SD']) {
      expect(getCardAbilityDefinitionsForCardCode(otherUmiCode).map((definition) => definition.abilityId)).not.toContain(A);
    }
  });

  it.each([5, 3, 2, 1])('starts through the production play path and requires min(3, hand) for %s cards', (count) => {
    const s = setup(Array.from({ length: count }, () => 'MEMBER' as const));
    const required = Math.min(3, count);
    expect(s.session.state?.activeEffect).toMatchObject({ abilityId: A, awaitingPlayerId: P1, effectText: EFFECT_TEXT, selectableCardIds: s.opponentHand.map((card) => card.instanceId), selectableCardVisibility: 'AWAITING_PLAYER_BLIND', selectableCardMode: 'ORDERED_MULTI', minSelectableCards: required, maxSelectableCards: required, canSkipSelection: false, selectionLabel: '选择要公开的对方手牌', confirmSelectionLabel: '公开所选手牌', stepText: `请在不查看内容的情况下，从对方手牌选择${required}张并公开。` });
  });

  it('projects only anonymous backs to the controller and no candidates to the opponent', () => {
    const s = setup(['MEMBER', 'LIVE', 'MEMBER', 'LIVE']);
    const controller = s.session.getPlayerViewState(P1);
    const opponent = s.session.getPlayerViewState(P2);
    expect(controller.activeEffect?.selectableObjectIds).toHaveLength(4);
    expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const objectId of controller.activeEffect?.selectableObjectIds ?? []) {
      expect(objectId).not.toContain('opp-');
      expect(controller.objects[objectId]).toMatchObject({ surface: 'BACK' });
      expect(controller.objects[objectId]?.frontInfo).toBeUndefined();
      expect(controller.objects[objectId]?.cardType).toBeUndefined();
    }
  });

  it('rejects real ids, forged, repeated, too few, too many, empty, and the non-waiting player', () => {
    const attempts = [
      (s: ReturnType<typeof setup>) => [s.opponentHand[0]!.instanceId, s.opponentHand[1]!.instanceId, s.opponentHand[2]!.instanceId],
      () => ['forged', 'blind-card-v0-1', 'blind-card-v0-2'],
      () => ['blind-card-v0-0', 'blind-card-v0-0', 'blind-card-v0-1'],
      () => ['blind-card-v0-0', 'blind-card-v0-1'],
      () => ['blind-card-v0-0', 'blind-card-v0-1', 'blind-card-v0-2', 'blind-card-v0-3'],
      () => [],
    ];
    for (const makeTokens of attempts) {
      const s = setup(['MEMBER', 'MEMBER', 'MEMBER', 'MEMBER']);
      const before = s.session.state;
      expect(submitBlind(s.session, makeTokens(s)).success).toBe(false);
      expect(s.session.state).toBe(before);
    }
    const s = setup(['MEMBER', 'MEMBER', 'MEMBER']);
    const result = s.session.executeCommand(createConfirmEffectStepCommand(P2, s.session.state!.activeEffect!.id, undefined, undefined, undefined, undefined, blindTokens(s.session)));
    expect(result.success).toBe(false);
  });

  it('reveals all three in one window, cleans selection fields, keeps cards in hand, and hides unselected cards', () => {
    const s = setup(['MEMBER', 'LIVE', 'MEMBER', 'MEMBER']);
    expect(submitBlind(s.session).success).toBe(true);
    const selectedIds = s.opponentHand.slice(0, 3).map((card) => card.instanceId);
    const effect = s.session.state?.activeEffect;
    expect(effect).toMatchObject({ revealedCardIds: selectedIds, stepText: '已公开所选手牌。确认后，根据公开卡中是否包含LIVE卡结算。', selectionLabel: '公开的卡片', confirmSelectionLabel: '确认公开结果' });
    for (const field of ['selectableCardIds', 'selectableCardVisibility', 'selectableCardMode', 'minSelectableCards', 'maxSelectableCards', 'canSkipSelection', 'skipSelectionLabel'] as const) expect(effect?.[field]).toBeUndefined();
    expect(s.session.state?.players[1].hand.cardIds).toEqual(s.opponentHand.map((card) => card.instanceId));
    for (const viewer of [P1, P2]) {
      const view = s.session.getPlayerViewState(viewer);
      for (const cardId of selectedIds) expect(view.objects[createPublicObjectId(cardId)]?.surface).toBe('FRONT');
    }
    expect(s.session.getPlayerViewState(P1).objects[createPublicObjectId(s.opponentHand[3]!.instanceId)]?.surface).not.toBe('FRONT');
    expect(s.session.state?.actionHistory.filter((action) => action.payload.step === 'REVEAL_OPPONENT_HAND')).toHaveLength(1);
  });

  it.each([
    { kinds: ['MEMBER', 'MEMBER', 'MEMBER'] as const, draw: 1 },
    { kinds: ['LIVE', 'MEMBER', 'MEMBER'] as const, draw: 0 },
    { kinds: ['LIVE', 'LIVE', 'MEMBER'] as const, draw: 0 },
    { kinds: ['MEMBER', 'MEMBER', 'MEMBER', 'LIVE'] as const, draw: 1 },
  ])('uses only the revealed snapshot for LIVE and draws $draw card(s)', ({ kinds, draw }) => {
    const s = setup(kinds);
    const handBefore = s.session.state!.players[0].hand.cardIds.length;
    expect(submitBlind(s.session).success).toBe(true);
    expect(confirmReveal(s.session).success).toBe(true);
    expect(s.session.state?.players[0].hand.cardIds).toHaveLength(handBefore + draw);
    const action = s.session.state?.actionHistory.findLast((entry) => entry.payload.step === 'RESOLVE_BLIND_REVEALED_OPPONENT_HAND');
    expect(action?.payload).toMatchObject({ revealedHandCardIds: s.opponentHand.slice(0, 3).map((card) => card.instanceId), revealedHadLive: draw === 0 });
    expect(action?.payload.drawnCardIds).toHaveLength(draw);
  });

  it('draws directly for an empty opponent hand and safely completes with no available draw', () => {
    const draws = setup([], { deckCount: 1 });
    expect(draws.session.state?.activeEffect).toBeNull();
    expect(draws.session.state?.players[0].hand.cardIds).toHaveLength(1);
    expect(draws.session.state?.actionHistory.findLast((entry) => entry.payload.abilityId === A)?.payload).toMatchObject({ revealedHandCardIds: [], revealedHadLive: false, drawnCardIds: [draws.deck[0]!.instanceId] });
    const empty = setup([], { deckCount: 0 });
    expect(empty.session.state?.activeEffect).toBeNull();
    expect(empty.session.state?.actionHistory.findLast((entry) => entry.payload.abilityId === A)?.payload.drawnCardIds).toEqual([]);
  });

  it('uses the standard refresh-aware draw helper when the main deck is empty', () => {
    const s = setup([], { deckCount: 0, waitingCount: 2 });
    expect(s.session.state?.activeEffect).toBeNull();
    expect(s.session.state?.players[0].hand.cardIds).toHaveLength(1);
    expect(s.session.state?.actionHistory.some((entry) => entry.type === 'RULE_ACTION' && entry.payload.type === 'REFRESH')).toBe(true);
    expect(s.session.state?.actionHistory.findLast((entry) => entry.payload.abilityId === A)?.payload.drawnCardIds).toHaveLength(1);
  });

  it('refreshes changed candidates with a new token version and rejects stale tokens', () => {
    const s = setup(['MEMBER', 'MEMBER', 'MEMBER']);
    const oldTokens = blindTokens(s.session);
    const replacement = member('replacement', P2);
    let changed = registerCards(s.session.state!, [replacement]);
    changed = updatePlayer(changed, P2, (player) => ({ ...player, hand: { ...player.hand, cardIds: [replacement.instanceId, ...player.hand.cardIds.slice(1)] } }));
    setState(s.session, changed);
    expect(submitBlind(s.session, oldTokens).success).toBe(true);
    expect(s.session.state?.activeEffect?.metadata?.blindSelectionVersion).toBe(1);
    expect(blindTokens(s.session)).not.toEqual(oldTokens);
    expect(submitBlind(s.session, oldTokens).success).toBe(false);
    expect(submitBlind(s.session).success).toBe(true);
    expect(s.session.state?.activeEffect?.revealedCardIds).toContain(replacement.instanceId);
  });

  it('keeps the reveal-time LIVE fact when selected cards become stale and does not draw twice', () => {
    const s = setup(['LIVE', 'MEMBER', 'MEMBER']);
    expect(submitBlind(s.session).success).toBe(true);
    const before = s.session.state!;
    const stale = updatePlayer(before, P2, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }));
    setState(s.session, stale);
    expect(confirmReveal(s.session).success).toBe(true);
    expect(s.session.state?.actionHistory.findLast((entry) => entry.payload.step === 'RESOLVE_BLIND_REVEALED_OPPONENT_HAND')?.payload.revealedHadLive).toBe(true);
    const after = s.session.state;
    expect(s.session.executeCommand(createConfirmEffectStepCommand(P1, before.activeEffect!.id)).success).toBe(false);
    expect(s.session.state).toBe(after);
  });

  it('continues only after confirmation and starts the next pending ability even if the source left stage', () => {
    const s = setup(['MEMBER', 'MEMBER', 'MEMBER']);
    const secondSource = member('PL!-PR-014-PR-second');
    let state = registerCards(s.session.state!, [secondSource]);
    state = updatePlayer(state, P1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null } } }));
    state = { ...state, pendingAbilities: [...state.pendingAbilities, { id: 'second-pending', abilityId: A, sourceCardId: secondSource.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['second-event'] }] };
    setState(s.session, state);
    expect(submitBlind(s.session).success).toBe(true);
    expect(s.session.state?.activeEffect?.id).not.toBe('second-pending');
    expect(confirmReveal(s.session).success).toBe(true);
    expect(s.session.state?.activeEffect).toMatchObject({ id: 'second-pending', abilityId: A });
  });
});
