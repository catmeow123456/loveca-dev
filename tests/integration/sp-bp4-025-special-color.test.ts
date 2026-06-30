import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
  SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import { addLiveModifier, getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface AutoCheerService {
  autoRevealPerformanceCheer(game: GameState, playerId: string): GameState;
}

function createMember(
  cardCode: string,
  options: { readonly blade?: number; readonly groupNames?: readonly string[] } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: 'CatChu!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: 'Special Color',
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function setupState(options: {
  readonly centerBlade?: number;
  readonly centerGroupName?: string;
  readonly centerCardCode?: string;
  readonly emptyCenter?: boolean;
  readonly mainDeckCardCount?: number;
} = {}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly centerMemberId: string;
} {
  const live = createCardInstance(createLive('PL!SP-bp4-025-L'), PLAYER1, 'special-color-live');
  const centerMember = createCardInstance(
    createMember(options.centerCardCode ?? 'PL!SP-bp4-025-center', {
      blade: options.centerBlade ?? 1,
      groupNames: [options.centerGroupName ?? 'Liella!'],
    }),
    PLAYER1,
    'special-color-center'
  );
  const cheerCards = Array.from({ length: options.mainDeckCardCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMember(`SPECIAL-COLOR-CHEER-${index}`, { blade: 0 }),
      PLAYER1,
      `special-color-cheer-${index}`
    )
  );
  let game = createGameState('sp-bp4-025-special-color', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, centerMember, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: cheerCards.map((card) => card.instanceId) },
    memberSlots: options.emptyCenter
      ? player.memberSlots
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, centerMember.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
  }));
  return { game, liveId: live.instanceId, centerMemberId: centerMember.instanceId };
}

function pendingAbility(
  abilityId: string,
  liveId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId: liveId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${timingId}:event`],
  };
}

function resolveAbility(game: GameState, ability: PendingAbilityState): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [ability],
  }).gameState;
}

function autoRevealCheer(game: GameState): GameState {
  const service = new GameService() as unknown as AutoCheerService;
  return service.autoRevealPerformanceCheer(game, PLAYER1);
}

describe('PL!SP-bp4-025 Special Color', () => {
  it.each([1, 5])('treats center Liella printed BLADE %i as original BLADE 3', (blade) => {
    const scenario = setupState({ centerBlade: blade });
    const state = resolveAbility(
      scenario.game,
      pendingAbility(
        SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
        scenario.liveId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(getMemberEffectiveBladeCount(state, PLAYER1, scenario.centerMemberId)).toBe(3);
  });

  it.each([1, 5])(
    'auto-reveals 3 cheer cards after replacing center Liella printed BLADE %i',
    (blade) => {
      const scenario = setupState({ centerBlade: blade, mainDeckCardCount: 5 });
      const state = resolveAbility(
        scenario.game,
        pendingAbility(
          SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
          scenario.liveId,
          TriggerCondition.ON_LIVE_START
        )
      );
      const cheered = autoRevealCheer(state);

      expect(cheered.liveResolution.firstPlayerCheerCardIds).toHaveLength(3);
      expect(cheered.resolutionZone.revealedCardIds).toHaveLength(3);
      expect(cheered.actionHistory.at(-1)?.payload).toMatchObject({
        cheerCount: 3,
        automated: true,
      });
    }
  );

  it('appends ordinary BLADE modifiers after original BLADE replacement', () => {
    const scenario = setupState({ centerBlade: 5 });
    let state = resolveAbility(
      scenario.game,
      pendingAbility(
        SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
        scenario.liveId,
        TriggerCondition.ON_LIVE_START
      )
    );
    state = addLiveModifier(state, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: scenario.centerMemberId,
      abilityId: 'test-blade-bonus',
    });

    expect(getMemberEffectiveBladeCount(state, PLAYER1, scenario.centerMemberId)).toBe(5);
  });

  it('does not replace BLADE when center is empty or not Liella', () => {
    const empty = setupState({ emptyCenter: true });
    const emptyState = resolveAbility(
      empty.game,
      pendingAbility(
        SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
        empty.liveId,
        TriggerCondition.ON_LIVE_START
      )
    );
    expect(emptyState.liveResolution.liveModifiers).toEqual([]);

    const nonLiella = setupState({
      centerBlade: 5,
      centerGroupName: 'Aqours',
      centerCardCode: 'PL!S-bp4-025-center',
    });
    const nonLiellaState = resolveAbility(
      nonLiella.game,
      pendingAbility(
        SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
        nonLiella.liveId,
        TriggerCondition.ON_LIVE_START
      )
    );
    expect(getMemberEffectiveBladeCount(nonLiellaState, PLAYER1, nonLiella.centerMemberId)).toBe(5);
  });

  it('adds score to this LIVE when center Liella moved this turn', () => {
    const scenario = setupState();
    const movedGame = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      positionMovedThisTurn: [scenario.centerMemberId],
    }));
    const state = resolveAbility(
      movedGame,
      pendingAbility(
        SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: scenario.liveId,
      sourceCardId: scenario.liveId,
      abilityId: SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });

  it('does not add score when center Liella has not moved', () => {
    const scenario = setupState();
    const state = resolveAbility(
      scenario.game,
      pendingAbility(
        SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
  });
});
