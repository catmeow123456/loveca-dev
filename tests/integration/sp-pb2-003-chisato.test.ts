import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import { SP_PB2_003_LIVE_SUCCESS_OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, groupName = 'Liella!'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    unitName: groupName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupChisatoState(options: {
  readonly chisatoSlot?: SlotPosition;
  readonly moverSlot?: SlotPosition;
  readonly moverGroupName?: string;
} = {}): {
  readonly game: GameState;
  readonly chisatoId: string;
  readonly moverId: string;
} {
  const chisato = createCardInstance(createMember('PL!SP-pb2-003-R'), PLAYER1, 'chisato');
  const mover = createCardInstance(
    createMember(
      options.moverGroupName === 'Aqours' ? 'PL!S-test-mover' : 'PL!SP-test-mover',
      options.moverGroupName ?? 'Liella!'
    ),
    PLAYER1,
    'mover'
  );
  let game = createGameState('sp-pb2-003-chisato', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [chisato, mover]);
  const chisatoSlot = options.chisatoSlot ?? SlotPosition.LEFT;
  const moverSlot = options.moverSlot ?? SlotPosition.CENTER;
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
        [chisatoSlot]: chisato.instanceId,
        [moverSlot]: mover.instanceId,
      },
      cardStates: new Map([
        [chisato.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        [mover.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
        playerScores: new Map([[PLAYER1, 5]]),
      },
    },
    chisatoId: chisato.instanceId,
    moverId: mover.instanceId,
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-003-pending',
    abilityId: SP_PB2_003_LIVE_SUCCESS_OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function resolveChisato(game: GameState, chisatoId: string): GameState {
  return confirmIfConfirmOnly(resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(chisatoId)],
  }).gameState);
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function moveByCardEffect(
  game: GameState,
  movedCardId: string,
  sourceCardId: string,
  toSlot: SlotPosition
): GameState {
  const result = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    PLAYER1,
    movedCardId,
    toSlot,
    (state) => state,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: PLAYER1,
        sourceCardId,
        abilityId: 'test-position-change',
        pendingAbilityId: 'test-pending',
      },
    }
  );
  expect(result).not.toBeNull();
  return result!.gameState;
}

describe('PL!SP-pb2-003 Chisato live success workflow', () => {
  it('adds one total live score after an own Liella! card effect moved this member', () => {
    const scenario = setupChisatoState();
    const moved = moveByCardEffect(
      scenario.game,
      scenario.chisatoId,
      scenario.moverId,
      SlotPosition.RIGHT
    );
    const state = resolveChisato(moved, scenario.chisatoId);

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      scoreBonus: 1,
    });
  });

  it('does not add score when this member did not move this turn', () => {
    const scenario = setupChisatoState();
    const state = resolveChisato(scenario.game, scenario.chisatoId);

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      movedThisTurn: false,
      scoreBonus: 0,
    });
  });

  it('does not add score for a manual member move without card-effect cause', () => {
    const scenario = setupChisatoState();
    const moveResult = moveMemberBetweenSlots(
      scenario.game,
      PLAYER1,
      scenario.chisatoId,
      SlotPosition.RIGHT
    );
    expect(moveResult).not.toBeNull();
    const state = resolveChisato(moveResult!.gameState, scenario.chisatoId);

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      movedThisTurn: true,
      matchingMoveEventIds: [],
    });
  });

  it('does not add score when the moving card effect source is not Liella!', () => {
    const scenario = setupChisatoState({ moverGroupName: 'Aqours' });
    const moved = moveByCardEffect(
      scenario.game,
      scenario.chisatoId,
      scenario.moverId,
      SlotPosition.RIGHT
    );
    const state = resolveChisato(moved, scenario.chisatoId);

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      movedThisTurn: true,
      matchingMoveEventIds: [],
    });
  });

  it('recognizes this member when it moved as the swapped member', () => {
    const scenario = setupChisatoState({
      chisatoSlot: SlotPosition.CENTER,
      moverSlot: SlotPosition.LEFT,
    });
    const moved = moveByCardEffect(
      scenario.game,
      scenario.moverId,
      scenario.moverId,
      SlotPosition.CENTER
    );
    const state = resolveChisato(moved, scenario.chisatoId);

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.chisatoId);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      scoreBonus: 1,
    });
  });
});

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_003_LIVE_SUCCESS_OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE_ABILITY_ID
    )?.payload;
}
