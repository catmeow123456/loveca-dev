import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_PB2_037_LIVE_SUCCESS_SAME_UNIT_CHEER_MEMBER_TO_HAND_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const TEXT =
  '【LIVE成功时】因声援被公开的自己的成员卡全部为『Printemps』，或全部为『lily white』，或全部为『BiBi』的场合，从因声援被公开的自己的卡片中将1张成员卡加入手牌。';
const live = (code: string): LiveCardData => ({
  cardCode: code,
  name: 'Shangri-La Shower',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({}),
});
const member = (unit: string, i: number): MemberCardData => ({
  cardCode: `TEST-${i}`,
  name: `Member ${i}`,
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 0,
  hearts: [],
  unitName: unit,
});
function pending(id: string): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY,
    sourceCardId: 'source',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
  };
}
function scenario(units: string[], moved: number[] = [], start = true) {
  const session = createGameSession();
  session.createGame('shangri-la', P1, 'P1', 'p2', 'P2');
  const source = createCardInstance(live('PL!-pb2-037-L'), P1, 'source');
  const members = units.map((u, i) => createCardInstance(member(u, i), P1, `member-${i}`));
  const nonmember = createCardInstance(live('TEST-LIVE'), P1, 'cheer-live');
  const ids = [...members.map((c) => c.instanceId), nonmember.instanceId];
  let game = registerCards(session.state!, [source, ...members, nonmember]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    liveZone: {
      ...p.liveZone,
      cardIds: ['source'],
      cardStates: new Map([
        ['source', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    hand: { ...p.hand, cardIds: moved.map((i) => `member-${i}`) },
  }));
  const current = ids.filter((id) => !moved.some((i) => id === `member-${i}`));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: { ...game.resolutionZone, cardIds: current, revealedCardIds: current },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([['source', true]]),
      firstPlayerCheerCardIds: ids,
      performingPlayerId: P1,
    },
  };
  game = emitGameEvent(game, createCheerEvent(P1, ids.slice(0, 1), 1, { automated: true }));
  game = emitGameEvent(
    game,
    createCheerEvent(P1, ids.slice(1), ids.length - 1, { automated: true, additional: true })
  );
  if (start) {
    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
    expect(result.success).toBe(true);
    game = result.gameState;
  }
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}
function setState(session: ReturnType<typeof scenario>, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}
function choose(session: ReturnType<typeof scenario>, id?: string) {
  return session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, id)
  );
}

describe('PL!-pb2-037 分数3 Shangri-La Shower', () => {
  it.each(['L', 'SEC', 'UNRELEASED'])(
    'covers %s with the full exported ability paragraph',
    (rare) => {
      expect(getCardAbilityDefinitionsForCardCode(`PL!-pb2-037-${rare}`)).toEqual(
        expect.arrayContaining([expect.objectContaining({ abilityId: ABILITY, effectText: TEXT })])
      );
    }
  );
  it.each(['Printemps', 'lily white', 'BiBi'])(
    'recovers exactly one member from %s, ignoring LIVE cards and including additional cheer',
    (unit) => {
      const session = scenario([unit, unit]);
      expect(session.state!.activeEffect).toMatchObject({
        effectText: TEXT,
        canSkipSelection: false,
        selectableCardIds: ['member-0', 'member-1'],
      });
      expect(choose(session).success).toBe(false);
      expect(choose(session, 'cheer-live').success).toBe(false);
      expect(choose(session, 'member-1').success).toBe(true);
      expect(session.state!.activeEffect!.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.resolutionZone.cardIds).toContain('member-1');
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toEqual(['member-1']);
      expect(session.state!.activeEffect).toBeNull();
    }
  );
  it.each([['Printemps', 'BiBi'], ['Printemps', 'lily white', 'BiBi'], ['Unknown'], []])(
    'confirms without recovery for member units %j',
    (...units) => {
      const session = scenario(units as string[]);
      expect(session.state!.activeEffect!.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(session.state!.activeEffect!.effectText).toContain('不加入手牌');
      expect(choose(session).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.pendingAbilities).toEqual([]);
      expect(session.state!.activeEffect).toBeNull();
    }
  );
  it('keeps moved additional-cheer members in the all-members condition', () => {
    const session = scenario(['Printemps', 'BiBi'], [1]);
    expect(session.state!.activeEffect!.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(session.state!.activeEffect!.effectText).toContain('不满足条件');
  });
  it('excludes moved members from legal targets but preserves a satisfied historical condition', () => {
    const session = scenario(['BiBi', 'BiBi'], [1]);
    expect(session.state!.activeEffect!.selectableCardIds).toEqual(['member-0']);
    expect(choose(session, 'member-1').success).toBe(false);
  });
  it('confirms the satisfied condition with no remaining legal member target', () => {
    const session = scenario(['BiBi'], [0]);
    expect(session.state!.activeEffect!.effectText).toContain('满足条件。 没有可选择的成员卡');
    expect(choose(session).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
  });
  it('revalidates after public display and refreshes remaining targets', () => {
    const session = scenario(['BiBi', 'BiBi']);
    expect(choose(session, 'member-0').success).toBe(true);
    const game = session.state!;
    setState(session, {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: ['member-1', 'cheer-live'],
        revealedCardIds: ['member-1', 'cheer-live'],
      },
    });
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.activeEffect!.selectableCardIds).toEqual(['member-1']);
  });
  it('rechecks the condition on display restoration and continues without moving when it fails', () => {
    const session = scenario(['BiBi']);
    expect(choose(session, 'member-0').success).toBe(true);
    const extra = createCardInstance(member('Printemps', 9), P1, 'extra');
    let game = registerCards(session.state!, [extra]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [...game.liveResolution.firstPlayerCheerCardIds, 'extra'],
      },
    };
    game = emitGameEvent(game, createCheerEvent(P1, ['extra'], 1, { additional: true }));
    setState(session, game);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
  });
  it('does not insert the next pending ability during public display and resumes after recovery', () => {
    const session = scenario(['BiBi', 'BiBi']);
    setState(session, { ...session.state!, pendingAbilities: [pending('later')] });
    expect(choose(session, 'member-0').success).toBe(true);
    expect(session.state!.activeEffect!.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(session.state!.pendingAbilities.map((ability) => ability.id)).toEqual(['later']);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual(['member-0']);
    expect(session.state!.activeEffect).toMatchObject({
      id: 'later',
      selectableCardIds: ['member-1'],
    });
  });
  it('consumes condition-failed ordered batches without extra confirmation windows', () => {
    const session = scenario([], [], false);
    const order = resolvePendingCardEffects({
      ...session.state!,
      pendingAbilities: [pending('a'), pending('b')],
    }).gameState;
    const result = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(result.actionHistory.filter((a) => a.payload.step === 'CONDITION_NOT_MET')).toHaveLength(
      2
    );
  });
});
