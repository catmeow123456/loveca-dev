import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type {
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

type HandKey = 'discardMember' | 'handNijigasakiLive';
type WaitingKey = 'waitingNijigasakiLive' | 'waitingAqoursLive' | 'waitingMember';

function createMember(cardCode = 'PL!N-bp5-014-N', name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupKasumi014Scenario(options: {
  readonly energyOrientations?: readonly OrientationState[];
  readonly handKeys?: readonly HandKey[];
  readonly waitingKeys?: readonly WaitingKey[];
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
}) {
  const session = createGameSession();
  session.createGame('n-bp5-014-kasumi', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(createMember(), PLAYER1, 'n-bp5-014-source');
  const discardMember = createCardInstance(
    createMember('N-BP5-014-DISCARD-MEMBER', 'Discard Member'),
    PLAYER1,
    'discard-member'
  );
  const handNijigasakiLive = createCardInstance(
    createLive('N-BP5-014-HAND-NIJI-LIVE', ['虹ヶ咲']),
    PLAYER1,
    'hand-nijigasaki-live'
  );
  const waitingNijigasakiLive = createCardInstance(
    createLive('N-BP5-014-WAITING-NIJI-LIVE', ['虹ヶ咲']),
    PLAYER1,
    'waiting-nijigasaki-live'
  );
  const waitingAqoursLive = createCardInstance(
    createLive('N-BP5-014-WAITING-AQOURS-LIVE', ['Aqours']),
    PLAYER1,
    'waiting-aqours-live'
  );
  const waitingMember = createCardInstance(
    createMember('N-BP5-014-WAITING-MEMBER', 'Waiting Member'),
    PLAYER1,
    'waiting-member'
  );
  const energyCards = (options.energyOrientations ?? [
    OrientationState.ACTIVE,
    OrientationState.ACTIVE,
  ]).map((_, index) =>
    createCardInstance(createEnergy(`N-BP5-014-ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );

  const cards = {
    source,
    discardMember,
    handNijigasakiLive,
    waitingNijigasakiLive,
    waitingAqoursLive,
    waitingMember,
  };
  let game = registerCards(session.state!, [
    ...Object.values(cards),
    ...energyCards,
  ]);
  game = {
    ...game,
    currentPhase: options.currentPhase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: {
      ...player.hand,
      cardIds: (options.handKeys ?? ['discardMember']).map((key) => cards[key].instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: (options.waitingKeys ?? ['waitingNijigasakiLive']).map(
        (key) => cards[key].instanceId
      ),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation: options.energyOrientations?.[index] ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = game;

  return { session, cards, energyCards };
}

function activateKasumi014(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      'n-bp5-014-source',
      N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
    )
  );
}

function confirmSelectedCard(session: ReturnType<typeof createGameSession>, selectedCardId: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  if (session.state?.activeEffect?.stepId !== 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    return result;
  }
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state.activeEffect.id)
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function payCostCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'PAY_COST' &&
      action.payload.abilityId ===
        N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
  ).length;
}

describe('PL!N-bp5-014 Kasumi activated discard recover Nijigasaki LIVE workflow', () => {
  it('pays two active energy, discards one hand card, then recovers a Nijigasaki LIVE', () => {
    const scenario = setupKasumi014Scenario({
      handKeys: ['discardMember'],
      waitingKeys: ['waitingNijigasakiLive'],
    });

    expect(activateKasumi014(scenario.session).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.stepId).toBe(
      'N_BP5_014_SELECT_HAND_CARD_TO_DISCARD'
    );
    expect(confirmSelectedCard(scenario.session, scenario.cards.discardMember.instanceId).success).toBe(
      true
    );
    expect(scenario.session.state?.activeEffect?.stepId).toBe(
      'N_BP5_014_SELECT_NIJIGASAKI_LIVE_TO_HAND'
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.cards.waitingNijigasakiLive.instanceId,
    ]);
    expect(
      confirmSelectedCard(scenario.session, scenario.cards.waitingNijigasakiLive.instanceId).success
    ).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.hand.cardIds).toEqual([scenario.cards.waitingNijigasakiLive.instanceId]);
    expect(player.waitingRoom.cardIds).toContain(scenario.cards.discardMember.instanceId);
    expect(
      scenario.energyCards.map((card) => player.energyZone.cardStates.get(card.instanceId)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
    expect(payCostCount(scenario.session.state!)).toBe(1);
  });

  it('can recover the Nijigasaki LIVE that was just discarded as the cost', () => {
    const scenario = setupKasumi014Scenario({
      handKeys: ['handNijigasakiLive'],
      waitingKeys: [],
    });

    expect(activateKasumi014(scenario.session).success).toBe(true);
    expect(
      confirmSelectedCard(scenario.session, scenario.cards.handNijigasakiLive.instanceId).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.cards.handNijigasakiLive.instanceId,
    ]);
    expect(
      confirmSelectedCard(scenario.session, scenario.cards.handNijigasakiLive.instanceId).success
    ).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.hand.cardIds).toEqual([scenario.cards.handNijigasakiLive.instanceId]);
    expect(player.waitingRoom.cardIds).not.toContain(scenario.cards.handNijigasakiLive.instanceId);
  });

  it('does not pay cost or record turn use when activation conditions are not met', () => {
    for (const options of [
      { energyOrientations: [OrientationState.ACTIVE] },
      { handKeys: [] },
      { currentPhase: GamePhase.LIVE_SET_PHASE },
      { activePlayerIndex: 1 },
    ] as const) {
      const scenario = setupKasumi014Scenario({
        ...options,
        waitingKeys: ['waitingNijigasakiLive'],
      });
      const result = activateKasumi014(scenario.session);

      expect(result.success).toBe(false);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(abilityUseCount(scenario.session.state!)).toBe(0);
      expect(payCostCount(scenario.session.state!)).toBe(0);
    }
  });

  it('keeps the paid cost and resolves no-op when no legal target exists after discard', () => {
    const scenario = setupKasumi014Scenario({
      handKeys: ['discardMember'],
      waitingKeys: ['waitingAqoursLive', 'waitingMember'],
    });

    expect(activateKasumi014(scenario.session).success).toBe(true);
    expect(confirmSelectedCard(scenario.session, scenario.cards.discardMember.instanceId).success).toBe(
      true
    );

    const player = scenario.session.state!.players[0]!;
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(player.waitingRoom.cardIds).toEqual([
      scenario.cards.waitingAqoursLive.instanceId,
      scenario.cards.waitingMember.instanceId,
      scenario.cards.discardMember.instanceId,
    ]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
    expect(payCostCount(scenario.session.state!)).toBe(1);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID &&
          action.payload.step === 'PAY_COST_NO_NIJIGASAKI_LIVE_TARGET'
      )
    ).toBeTruthy();
  });

  it('rejects an illegal recovery selection and keeps the recovery window open', () => {
    const scenario = setupKasumi014Scenario({
      handKeys: ['discardMember'],
      waitingKeys: ['waitingNijigasakiLive', 'waitingAqoursLive'],
    });

    expect(activateKasumi014(scenario.session).success).toBe(true);
    expect(confirmSelectedCard(scenario.session, scenario.cards.discardMember.instanceId).success).toBe(
      true
    );
    const activeEffectId = scenario.session.state!.activeEffect!.id;
    const result = confirmActiveEffectStepThroughPublicReveal(
      scenario.session.state!,
      PLAYER1,
      activeEffectId,
      scenario.cards.waitingAqoursLive.instanceId
    );

    expect(result.activeEffect?.id).toBe(activeEffectId);
    expect(result.players[0]!.hand.cardIds).toEqual([]);
    expect(result.players[0]!.waitingRoom.cardIds).toEqual([
      scenario.cards.waitingNijigasakiLive.instanceId,
      scenario.cards.waitingAqoursLive.instanceId,
      scenario.cards.discardMember.instanceId,
    ]);
  });
});
