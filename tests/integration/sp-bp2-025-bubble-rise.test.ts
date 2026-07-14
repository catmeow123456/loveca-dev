import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP2_025_LIVE_SUCCESS_TWO_DISTINCT_NAMED_STAGE_MEMBERS_REVEALED_CHEER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode: string): LiveCardData {
  return { cardCode, name: cardCode, groupNames: ['Liella!'], cardType: CardType.LIVE, score: 4, requirements: createHeartRequirement({ [HeartColor.RED]: 1 }) };
}

function member(cardCode: string, name: string): MemberCardData {
  return { cardCode, name, groupNames: ['Liella!'], cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [createHeartIcon(HeartColor.RED, 1)] };
}

interface SetupOptions {
  readonly ownStage?: readonly string[];
  readonly opponentStage?: readonly string[];
  readonly memberBelowName?: string;
  readonly includeTarget?: boolean;
  readonly secondSource?: boolean;
}

function setup(options: SetupOptions = {}) {
  const session = createGameSession();
  session.createGame('sp-bp2-025-bubble-rise', PLAYER1, 'P1', PLAYER2, 'P2');
  const source = createCardInstance(live('PL!SP-bp2-025-L'), PLAYER1, 'bubble-rise');
  const secondSource = options.secondSource
    ? createCardInstance(live('PL!SP-bp2-025-SRL'), PLAYER1, 'bubble-rise-srl')
    : null;
  const ownStage = (options.ownStage ?? ['涩谷香音', 'ウィーン・マルガレーテ']).map((name, index) =>
    createCardInstance(member(`PL!SP-stage-${index}`, name), PLAYER1, `own-stage-${index}`)
  );
  const opponentStage = (options.opponentStage ?? []).map((name, index) =>
    createCardInstance(member(`PL!SP-opponent-${index}`, name), PLAYER2, `opponent-stage-${index}`)
  );
  const below = options.memberBelowName
    ? createCardInstance(member('PL!SP-below', options.memberBelowName), PLAYER1, 'member-below')
    : null;
  const targetLive = createCardInstance(live('PL!SP-cheer-live'), PLAYER1, 'cheer-live');
  const targetMember = createCardInstance(member('PL!SP-cheer-member', '任意成员'), PLAYER1, 'cheer-member');
  const opponentTarget = createCardInstance(member('PL!SP-opponent-cheer', '对方卡'), PLAYER2, 'opponent-cheer');
  const stale = createCardInstance(member('PL!SP-stale-cheer', '已移走卡'), PLAYER1, 'stale-cheer');
  let game = registerCards(session.state!, [source, ...(secondSource ? [secondSource] : []), ...ownStage, ...opponentStage, ...(below ? [below] : []), targetLive, targetMember, opponentTarget, stale]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let slots = ownStage.reduce((current, card, index) => placeCardInSlot(current, [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index], card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), player.memberSlots);
    if (below) slots = addMemberBelowMember(slots, SlotPosition.CENTER, below.instanceId);
    return { ...player, liveZone: [source, ...(secondSource ? [secondSource] : [])].reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.liveZone), memberSlots: slots };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({ ...player, memberSlots: opponentStage.reduce((current, card, index) => placeCardInSlot(current, [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index], card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), player.memberSlots) }));
  const currentIds = options.includeTarget === false ? [] : [targetLive.instanceId, targetMember.instanceId, opponentTarget.instanceId];
  game = { ...game, currentPhase: GamePhase.LIVE_RESULT_PHASE, currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS, firstPlayerIndex: 0, activePlayerIndex: 0, resolutionZone: { ...game.resolutionZone, cardIds: currentIds, revealedCardIds: currentIds }, liveResolution: { ...game.liveResolution, liveResults: new Map([[source.instanceId, true], ...(secondSource ? [[secondSource.instanceId, true] as const] : [])]), firstPlayerCheerCardIds: [...currentIds, stale.instanceId], performingPlayerId: PLAYER1 } };
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const timing = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(timing.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = timing.gameState;
  return { session, source, ownStage, targetLive, targetMember, opponentTarget, stale };
}

describe('PL!SP-bp2-025 Bubble Rise', () => {
  it.each([
    { label: 'one target name', ownStage: ['澁谷かのん'] },
    { label: 'two entities with the same target name', ownStage: ['澁谷かのん', '涩谷香音'] },
    { label: 'non-target member', ownStage: ['澁谷かのん', '唐可可'] },
  ])('does not queue when $label', ({ ownStage }) => {
    const { session } = setup({ ownStage });
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('does not count opponent stage or memberBelow', () => {
    const { session } = setup({ ownStage: ['澁谷かのん'], opponentStage: ['鬼塚冬毬'], memberBelowName: 'ウィーン・マルガレーテ' });
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('requires two entities even when one entity has multiple structured names', () => {
    const { session } = setup({ ownStage: ['澁谷かのん＆鬼塚冬毬'] });
    expect(session.state?.activeEffect).toBeNull();
    const withSecondEntity = setup({ ownStage: ['澁谷かのん＆鬼塚冬毬', 'ウィーン・マルガレーテ'] });
    expect(withSecondEntity.session.state?.activeEffect?.abilityId).toBe(SP_BP2_025_LIVE_SUCCESS_TWO_DISTINCT_NAMED_STAGE_MEMBERS_REVEALED_CHEER_TO_HAND_ABILITY_ID);
  });

  it('uses aliases, queues before resolution, and opens one public forced selection with current movable own targets', () => {
    const { session, targetLive, targetMember, opponentTarget, stale } = setup({ ownStage: ['涩谷香音', '薇恩・玛格丽特'] });
    expect(session.state?.activeEffect).toMatchObject({ abilityId: SP_BP2_025_LIVE_SUCCESS_TWO_DISTINCT_NAMED_STAGE_MEMBERS_REVEALED_CHEER_TO_HAND_ABILITY_ID, stepId: 'SP_BP2_025_SELECT_REVEALED_CHEER_TO_HAND', stepText: '请选择1张因声援被公开的自己的卡片加入手牌。', selectionLabel: '选择要加入手牌的声援公开卡', confirmSelectionLabel: '加入手牌', selectableCardIds: [targetLive.instanceId, targetMember.instanceId], selectableCardVisibility: 'PUBLIC', selectableCardMode: 'SINGLE', canSkipSelection: false });
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(opponentTarget.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(stale.instanceId);
  });

  it('keeps an already queued ability after the stage changes and moves exactly one arbitrary card type to hand', () => {
    const { session, ownStage, targetMember, targetLive } = setup();
    const before = session.state!;
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(before, PLAYER1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null, [SlotPosition.CENTER]: null } } }));
    const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMember.instanceId));
    expect(result.success, result.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toContain(targetMember.instanceId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(targetLive.instanceId);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(ownStage).toHaveLength(2);
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toEqual([]);
  });

  it('rejects null, opponent, stale and non-candidate input without moving or advancing', () => {
    const { session, targetLive, opponentTarget, stale } = setup();
    const effectId = session.state!.activeEffect!.id;
    for (const invalidId of [null, opponentTarget.instanceId, stale.instanceId, 'missing']) {
      const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, invalidId));
      expect(result.success).toBe(false);
      expect(session.state?.activeEffect?.id).toBe(effectId);
      expect(session.state?.resolutionZone.cardIds).toContain(targetLive.instanceId);
    }
  });

  it('shows one no-target confirmation for a single pending and auto-consumes ordered no-target abilities', () => {
    const single = setup({ includeTarget: false });
    expect(single.session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    const confirmed = single.session.executeCommand(createConfirmEffectStepCommand(PLAYER1, single.session.state!.activeEffect!.id));
    expect(confirmed.success, confirmed.error).toBe(true);
    expect(single.session.state?.activeEffect).toBeNull();

    const ordered = setup({ includeTarget: false, secondSource: true });
    const orderEffect = ordered.session.state!.activeEffect!;
    expect(orderEffect.metadata?.pendingAbilityIds).toHaveLength(2);
    const result = ordered.session.executeCommand(createConfirmEffectStepCommand(PLAYER1, orderEffect.id, orderEffect.selectableCardIds![0], null, true));
    expect(result.success, result.error).toBe(true);
    expect(ordered.session.state?.activeEffect).toBeNull();
    expect(ordered.session.state?.pendingAbilities).toEqual([]);
  });
});
