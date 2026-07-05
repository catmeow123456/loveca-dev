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
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['Liella!']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createPendingAbility(sourceCardId: string, sourceSlot: SlotPosition): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${sourceCardId}`],
    sourceSlot,
  };
}

function setupScenario(options: {
  readonly energyCount: number;
  readonly sourceOnStage?: boolean;
  readonly targets?: readonly {
    readonly id: string;
    readonly slot: SlotPosition;
    readonly groupNames?: readonly string[];
  }[];
}): {
  readonly game: GameState;
  readonly sourceCardId: string;
  readonly targetCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-sd2-020-SD2', '鬼塚夏美'),
    PLAYER1,
    'source'
  );
  const targets = (options.targets ?? []).map((target) =>
    createCardInstance(
      createMember(`PL!SP-test-${target.id}`, target.id, target.groupNames ?? ['Liella!']),
      PLAYER1,
      target.id
    )
  );
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-test-energy-${index + 1}`,
        name: `Energy ${index + 1}`,
        cardType: CardType.ENERGY,
      },
      PLAYER1,
      `energy-${index + 1}`
    )
  );

  let game = createGameState('sp-sd2-020-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...targets, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots =
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          });
    for (const target of options.targets ?? []) {
      memberSlots = placeCardInSlot(memberSlots, target.slot, target.id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      energyZone: energyCards.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });

  return {
    game: {
      ...game,
      pendingAbilities: [createPendingAbility(source.instanceId, SlotPosition.CENTER)],
    },
    sourceCardId: source.instanceId,
    targetCardIds: targets.map((target) => target.instanceId),
  };
}

function startScenario(options: Parameters<typeof setupScenario>[0]): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly targetCardIds: readonly string[];
} {
  const scenario = setupScenario(options);
  const started = resolvePendingCardEffects(scenario.game).gameState;
  const session = createGameSession();
  session.createGame('sp-sd2-020-natsumi-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return { session, sourceCardId: scenario.sourceCardId, targetCardIds: scenario.targetCardIds };
}

function bladeModifierCardIds(game: GameState | null): readonly string[] {
  return (
    game?.liveResolution.liveModifiers
      .filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID
      )
      .map((modifier) => modifier.sourceCardId) ?? []
  );
}

function expectConfirmOnlyPreview(session: GameSession, expectedText: string): void {
  expect(session.state?.activeEffect).toMatchObject({
    abilityId: SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    metadata: {
      confirmOnlyPendingAbility: true,
    },
  });
  expect(session.state?.activeEffect?.effectText).toContain(expectedText);
}

function confirmCurrentEffect(session: GameSession): void {
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    ).success
  ).toBe(true);
}

describe('PL!SP-sd2-020 鬼塚夏美 LIVE start workflow', () => {
  it('previews and consumes pending without BLADE when own energy is below seven', () => {
    const { session } = startScenario({
      energyCount: 6,
      targets: [{ id: 'target', slot: SlotPosition.LEFT }],
    });

    expectConfirmOnlyPreview(session, '当前能量 6 张，其他 Liella! 目标 1 名');
    expect(bladeModifierCardIds(session.state)).toEqual([]);
    confirmCurrentEffect(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(bladeModifierCardIds(session.state)).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'ENERGY_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('previews a single other Liella target before giving both members BLADE', () => {
    const { session, sourceCardId, targetCardIds } = startScenario({
      energyCount: 7,
      targets: [{ id: 'target', slot: SlotPosition.LEFT }],
    });

    expectConfirmOnlyPreview(session, '实际结算：将给来源成员与 1 名其他 Liella! 成员各写入 BLADE +1');
    expect(bladeModifierCardIds(session.state)).toEqual([]);
    confirmCurrentEffect(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(bladeModifierCardIds(session.state)).toEqual([sourceCardId, targetCardIds[0]]);
  });

  it('opens a target choice for multiple other Liella members', () => {
    const { session, sourceCardId, targetCardIds } = startScenario({
      energyCount: 7,
      targets: [
        { id: 'left-target', slot: SlotPosition.LEFT },
        { id: 'right-target', slot: SlotPosition.RIGHT },
      ],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
      selectableCardIds: targetCardIds,
    });
    expect(session.state?.activeEffect?.canSkipSelection).not.toBe(true);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          targetCardIds[1]
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(bladeModifierCardIds(session.state)).toEqual([sourceCardId, targetCardIds[1]]);
  });

  it('previews and does not block when there is no other Liella target', () => {
    const { session, sourceCardId } = startScenario({
      energyCount: 7,
      targets: [{ id: 'aqours-target', slot: SlotPosition.LEFT, groupNames: ['Aqours'] }],
    });

    expectConfirmOnlyPreview(session, '实际结算：没有其他 Liella! 目标，将只给来源成员写入 BLADE +1');
    expect(bladeModifierCardIds(session.state)).toEqual([]);
    confirmCurrentEffect(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(bladeModifierCardIds(session.state)).toEqual([sourceCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SOURCE_GAIN_BLADE_NO_OTHER_LIELLA_TARGET'
      )
    ).toBe(true);
  });

  it('previews and consumes pending safely when the source member is no longer on stage', () => {
    const { session } = startScenario({
      energyCount: 7,
      sourceOnStage: false,
      targets: [{ id: 'target', slot: SlotPosition.LEFT }],
    });

    expectConfirmOnlyPreview(session, '实际结算：来源成员不在舞台，不写入 BLADE');
    confirmCurrentEffect(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(bladeModifierCardIds(session.state)).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('continues ordered pending after a no-op source into the next auto resolve', () => {
    const first = createCardInstance(createMember('PL!SP-sd2-020-SD2', '鬼塚夏美'), PLAYER1, 'first');
    const second = createCardInstance(createMember('PL!SP-sd2-020-SD2', '鬼塚夏美'), PLAYER1, 'second');
    const target = createCardInstance(createMember('PL!SP-test-target'), PLAYER1, 'target');
    const energyCards = Array.from({ length: 7 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `PL!SP-test-ordered-energy-${index + 1}`,
          name: `Energy ${index + 1}`,
          cardType: CardType.ENERGY,
        },
        PLAYER1,
        `ordered-energy-${index + 1}`
      )
    );
    let game = createGameState('sp-sd2-020-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, target, ...energyCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, second.instanceId),
        SlotPosition.LEFT,
        target.instanceId
      ),
      energyZone: energyCards.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(first.instanceId, SlotPosition.RIGHT),
        createPendingAbility(second.instanceId, SlotPosition.CENTER),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    const session = createGameSession();
    session.createGame('sp-sd2-020-ordered-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = orderSelection;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(bladeModifierCardIds(session.state)).toEqual([second.instanceId, target.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.sourceCardId === first.instanceId &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });
});
