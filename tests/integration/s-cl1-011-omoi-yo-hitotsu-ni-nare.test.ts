import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type HeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  createConfirmEffectStepCommand,
  createAutoAdvancePublicCardSelectionCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { S_CL1_011_LIVE_SUCCESS_COMMON_HEART_AQOURS_CHEER_MEMBER_TO_HAND_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { addHeartLiveModifierForTargetMember } from '../../src/domain/rules/live-modifiers';
import { getOwnAqoursStageMemberCommonHeartColors } from '../../src/application/effects/stage-member-common-hearts';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor as H,
  OrientationState as O,
  SlotPosition as S,
  SubPhase,
  TriggerCondition as T,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const hearts = (colors: readonly H[]): HeartIcon[] => colors.map((color) => ({ color, count: 1 }));
function member(
  id: string,
  colors: readonly H[],
  groups = ['Aqours'],
  bladeHeart?: H
): MemberCardData {
  return {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: hearts(colors),
    groupNames: groups,
    bladeHearts: bladeHeart ? [{ effect: BladeHeartEffect.HEART, heartColor: bladeHeart }] : [],
  };
}
const live = (code: string) => ({
  cardCode: code,
  name: code,
  cardType: CardType.LIVE as const,
  score: 3,
  requirements: createHeartRequirement({}),
});
function pending(id: string): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY,
    sourceCardId: 'source',
    controllerId: P1,
    mandatory: true,
    timingId: T.ON_LIVE_SUCCESS,
  };
}
function scenario(
  stageColors: readonly (readonly H[])[] = [[H.RED], [H.RED], [H.RED]],
  groups = ['Aqours', 'Aqours', 'Aqours'],
  autoStart = true
) {
  const session = createGameSession();
  session.createGame('s-cl1-011', P1, 'P1', P2, 'P2');
  const source = createCardInstance(live('PL!S-cl1-011-CL'), P1, 'source');
  const stage = stageColors.map((colors, i) =>
    createCardInstance(member(`stage-${i}`, colors, [groups[i] ?? 'Aqours']), P1, `stage-${i}`)
  );
  const targets = [
    createCardInstance(member('red', [H.RED], ['Aqours'], H.BLUE), P1, 'red'),
    createCardInstance(member('blue', [H.BLUE], ['Aqours'], H.RED), P1, 'blue'),
    createCardInstance(member('both', [H.RED, H.BLUE]), P1, 'both'),
    createCardInstance(member('rainbow', [H.RAINBOW]), P1, 'rainbow'),
    createCardInstance(member('other-group', [H.RED], ['Liella!']), P1, 'other-group'),
    createCardInstance(member('opponent', [H.RED]), P2, 'opponent'),
    createCardInstance(live('cheer-live'), P1, 'cheer-live'),
  ];
  let game = registerCards(session.state!, [source, ...stage, ...targets]);
  game = updatePlayer(game, P1, (p) => {
    let slots = p.memberSlots;
    stage.forEach((card, i) => {
      slots = placeCardInSlot(slots, [S.LEFT, S.CENTER, S.RIGHT][i]!, card.instanceId, {
        orientation: O.ACTIVE,
        face: FaceState.FACE_UP,
      });
    });
    return {
      ...p,
      memberSlots: slots,
      liveZone: {
        ...p.liveZone,
        cardIds: ['source'],
        cardStates: new Map([['source', { orientation: O.ACTIVE, face: FaceState.FACE_UP }]]),
      },
    };
  });
  const ids = targets.map((card) => card.instanceId);
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: { ...game.resolutionZone, cardIds: ids, revealedCardIds: ids },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([['source', true]]),
      firstPlayerCheerCardIds: ids,
      performingPlayerId: P1,
    },
  };
  game = emitGameEvent(game, createCheerEvent(P1, ids, ids.length, { automated: true }));
  if (autoStart) {
    const result = new GameService().executeCheckTiming(game, [T.ON_LIVE_SUCCESS]);
    expect(result.success, result.error).toBe(true);
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
function start(session: ReturnType<typeof scenario>) {
  const result = new GameService().executeCheckTiming(session.state!, [T.ON_LIVE_SUCCESS]);
  expect(result.success, result.error).toBe(true);
  setState(session, result.gameState);
}

describe('PL!S-cl1-011 分数3「思念合而为一吧」 common ordinary Heart recovery', () => {
  it('requires exactly one legal Aqours member with the common ordinary Heart, not its Blade Heart', () => {
    const session = scenario();
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardIds: ['red', 'both'],
      canSkipSelection: false,
    });
    expect(choose(session).success).toBe(false);
    for (const id of ['blue', 'other-group', 'opponent', 'cheer-live'])
      expect(choose(session, id).success).toBe(false);
    expect(choose(session, 'red').success).toBe(true);
    const shown = session.state!.activeEffect!;
    expect(shown.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(shown.publicCardSelectionAutoAdvanceAt).toBeTypeOf('number');
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toContain('red');
    const early = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(
        P1,
        shown.id,
        shown.publicCardSelectionAutoAdvanceAt!
      )
    );
    expect(early.success).toBe(false);
    expect(session.state?.resolutionZone.cardIds).toContain('red');
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual(['red']);
    expect(session.state?.activeEffect).toBeNull();
  });

  it.each([
    { colors: [[H.RED], [H.RED]], groups: ['Aqours', 'Aqours'] },
    { colors: [[H.RED], [H.RED], [H.RED]], groups: ['Aqours', 'Aqours', 'Liella!'] },
    {
      colors: [
        [H.RED, H.BLUE],
        [H.RED, H.YELLOW],
        [H.BLUE, H.YELLOW],
      ],
      groups: ['Aqours', 'Aqours', 'Aqours'],
    },
  ])(
    'confirms without recovery for insufficient or globally nonintersecting members: %j',
    ({ colors, groups }) => {
      const session = scenario(colors, groups);
      expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(choose(session).success).toBe(true);
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      expect(session.state?.activeEffect).toBeNull();
    }
  );

  it('excludes memberBelow from the three-member condition', () => {
    const session = scenario([[H.RED], [H.RED]], ['Aqours', 'Aqours'], false);
    const below = createCardInstance(member('below', [H.RED]), P1, 'below');
    let game = registerCards(session.state!, [below]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        memberBelow: { ...p.memberSlots.memberBelow, [S.LEFT]: ['below'] },
      },
    }));
    setState(session, game);
    start(session);
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  });

  it('allows targets matching any of several shared colors and treats RAINBOW only as its own color', () => {
    const multi = scenario([
      [H.RED, H.BLUE],
      [H.RED, H.BLUE],
      [H.RED, H.BLUE],
    ]);
    expect(multi.state?.activeEffect?.selectableCardIds).toEqual(['red', 'blue', 'both']);
    const rainbow = scenario([[H.RAINBOW], [H.RAINBOW], [H.RAINBOW]]);
    expect(rainbow.state?.activeEffect?.selectableCardIds).toEqual(['rainbow']);
    const mixed = scenario([[H.RED], [H.RED], [H.RAINBOW]]);
    expect(mixed.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  });

  it('uses effective ordinary Hearts from modifiers to establish the common color', () => {
    const session = scenario([[H.RED], [H.RED], [H.BLUE]], undefined, false);
    const result = addHeartLiveModifierForTargetMember(session.state!, {
      playerId: P1,
      sourceCardId: 'source',
      targetMemberCardId: 'stage-2',
      abilityId: 'gain-red',
      hearts: hearts([H.RED]),
    });
    setState(session, result!.gameState);
    expect(getOwnAqoursStageMemberCommonHeartColors(session.state!, P1)).toEqual([H.RED]);
    start(session);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['red', 'both']);
  });

  it('rechecks both the common color and target predicate after the public deadline', () => {
    const session = scenario();
    expect(choose(session, 'red').success).toBe(true);
    // The stage still has a common color, but it changed from red to blue.
    const registry = new Map(session.state!.cardRegistry);
    for (let i = 0; i < 3; i++) {
      const card = registry.get(`stage-${i}`)!;
      registry.set(card.instanceId, { ...card, data: member(card.data.cardCode, [H.BLUE]) });
    }
    setState(session, { ...session.state!, cardRegistry: registry });
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['blue', 'both']);
    expect(choose(session, 'blue').success).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual(['blue']);
  });

  it.each(['condition', 'revealed', 'resolution', 'current-cheer'])(
    'does not move a selected target when %s becomes stale during public display',
    (kind) => {
      const session = scenario();
      expect(choose(session, 'red').success).toBe(true);
      let game = session.state!;
      if (kind === 'condition')
        game = updatePlayer(game, P1, (p) => ({
          ...p,
          memberSlots: placeCardInSlot(p.memberSlots, S.RIGHT, null),
        }));
      if (kind === 'revealed')
        game = {
          ...game,
          resolutionZone: {
            ...game.resolutionZone,
            revealedCardIds: game.resolutionZone.revealedCardIds.filter((id) => id !== 'red'),
          },
        };
      if (kind === 'resolution')
        game = {
          ...game,
          resolutionZone: {
            ...game.resolutionZone,
            cardIds: game.resolutionZone.cardIds.filter((id) => id !== 'red'),
          },
        };
      if (kind === 'current-cheer')
        game = {
          ...game,
          liveResolution: {
            ...game.liveResolution,
            firstPlayerCheerCardIds: game.liveResolution.firstPlayerCheerCardIds.filter(
              (id) => id !== 'red'
            ),
          },
        };
      setState(session, game);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      if (kind === 'condition') expect(session.state?.activeEffect).toBeNull();
    }
  );

  it('continues pending effects only after public recovery and rejects duplicate completion', () => {
    const session = scenario();
    setState(session, { ...session.state!, pendingAbilities: [pending('next')] });
    expect(choose(session, 'red').success).toBe(true);
    const id = session.state!.activeEffect!.id;
    expect(session.state?.pendingAbilities.map((p) => p.id)).toEqual(['next']);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual(['red']);
    expect(session.state?.activeEffect?.id).toBe('next');
    const repeated = session.executeCommand(createConfirmEffectStepCommand(P1, id, 'red'));
    expect(repeated.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual(['red']);
  });
});
