import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { GameService } from '../../src/application/game-service';
import { SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createAspire(cardCode = 'PL!SP-sd2-025-SD2'): LiveCardData {
  return {
    cardCode,
    name: 'Aspire',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly groupNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setupState(options: {
  readonly liveCardCode?: string;
  readonly members: readonly {
    readonly id: string;
    readonly slot: SlotPosition;
    readonly cardCode: string;
    readonly groupNames?: readonly string[];
  }[];
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly membersById: ReadonlyMap<string, ReturnType<typeof createCardInstance>>;
} {
  const live = createCardInstance(createAspire(options.liveCardCode), PLAYER1, 'aspire-live');
  const members = options.members.map((member) =>
    createCardInstance(
      createMember({ cardCode: member.cardCode, groupNames: member.groupNames }),
      PLAYER1,
      member.id
    )
  );
  const membersById = new Map(members.map((member) => [member.instanceId, member]));

  let game = createGameState('sp-sd2-025-aspire', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...members]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const member of options.members) {
      memberSlots = placeCardInSlot(memberSlots, member.slot, member.id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      memberSlots,
    };
  });

  return { game, live, membersById };
}

function moveMember(game: GameState, cardId: string, toSlot: SlotPosition): GameState {
  const moveResult = moveMemberBetweenSlots(game, PLAYER1, cardId, toSlot);
  expect(moveResult).not.toBeNull();
  return moveResult!.gameState;
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return confirmIfConfirmOnly(result.gameState, PLAYER1);
}

function aspireBladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId ===
        SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID
  );
}

describe('PL!SP-sd2-025 Aspire workflow', () => {
  it('gives BLADE +1 to a moved Liella member', () => {
    const { game } = setupState({
      members: [
        {
          id: 'moved-liella',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-moved',
          groupNames: ['Liella!'],
        },
      ],
    });
    const movedState = moveMember(game, 'moved-liella', SlotPosition.CENTER);
    const state = resolveLiveStart(movedState);

    expect(aspireBladeModifiers(state)).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: 'moved-liella',
        abilityId: SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID,
      },
    ]);
  });

  it('does not give BLADE to an unmoved Liella member', () => {
    const { game } = setupState({
      members: [
        {
          id: 'unmoved-liella',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-unmoved',
          groupNames: ['Liella!'],
        },
      ],
    });
    const state = resolveLiveStart(game);

    expect(aspireBladeModifiers(state)).toEqual([]);
  });

  it('does not give BLADE to a moved non-Liella member', () => {
    const { game } = setupState({
      members: [
        {
          id: 'moved-aqours',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!S-test-moved',
          groupNames: ['Aqours'],
        },
      ],
    });
    const movedState = moveMember(game, 'moved-aqours', SlotPosition.CENTER);
    const state = resolveLiveStart(movedState);

    expect(aspireBladeModifiers(state)).toEqual([]);
  });

  it('gives BLADE to multiple moved Liella members in stable stage order', () => {
    const { game } = setupState({
      members: [
        {
          id: 'liella-left',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
        },
        {
          id: 'liella-center',
          slot: SlotPosition.CENTER,
          cardCode: 'PL!SP-test-center',
          groupNames: ['Liella!'],
        },
      ],
    });
    const movedState = moveMember(game, 'liella-left', SlotPosition.CENTER);
    const state = resolveLiveStart(movedState);

    expect(aspireBladeModifiers(state).map((modifier) => modifier.sourceCardId)).toEqual([
      'liella-center',
      'liella-left',
    ]);
    expect(aspireBladeModifiers(state)).toEqual([
      expect.objectContaining({ sourceCardId: 'liella-center', countDelta: 1 }),
      expect.objectContaining({ sourceCardId: 'liella-left', countDelta: 1 }),
    ]);
  });

  it('does not give BLADE to a moved Liella member that has left the stage', () => {
    const { game } = setupState({
      members: [
        {
          id: 'liella-left-stage',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-left-stage',
          groupNames: ['Liella!'],
        },
      ],
    });
    const movedState = moveMember(game, 'liella-left-stage', SlotPosition.CENTER);
    const leftStageState = updatePlayer(movedState, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const state = resolveLiveStart(leftStageState);

    expect(aspireBladeModifiers(state)).toEqual([]);
  });

  it('does not treat entering the stage as member-position movement', () => {
    const { game } = setupState({
      members: [
        {
          id: 'entered-liella',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-entered',
          groupNames: ['Liella!'],
        },
      ],
    });
    const state = resolveLiveStart(game);

    expect(aspireBladeModifiers(state)).toEqual([]);
  });

  it('consumes pending and records an empty payload when there are no targets', () => {
    const { game } = setupState({
      members: [
        {
          id: 'unmoved-liella',
          slot: SlotPosition.LEFT,
          cardCode: 'PL!SP-test-unmoved',
          groupNames: ['Liella!'],
        },
      ],
    });
    const state = resolveLiveStart(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID &&
          Array.isArray(action.payload.targetMemberCardIds) &&
          action.payload.targetMemberCardIds.length === 0 &&
          action.payload.targetCount === 0
      )
    ).toBe(true);
  });

  it.each(['PL!SP-sd2-025-P', 'PL!SP-sd2-025-SD2'])(
    'resolves the base-code ability for %s',
    (liveCardCode) => {
      const { game } = setupState({
        liveCardCode,
        members: [
          {
            id: 'moved-liella',
            slot: SlotPosition.LEFT,
            cardCode: 'PL!SP-test-moved',
            groupNames: ['Liella!'],
          },
        ],
      });
      const movedState = moveMember(game, 'moved-liella', SlotPosition.CENTER);
      const state = resolveLiveStart(movedState);

      expect(aspireBladeModifiers(state)).toHaveLength(1);
    }
  );
});
