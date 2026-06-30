import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addEnergyBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  applyRuleActionResult,
  ruleActionProcessor,
} from '../../src/domain/rules/rule-actions';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, options: Partial<MemberCardData> = {}): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: options.blade ?? 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.BLUE, 1)],
    ...options,
  };
}

function createLive(cardCode: string, options: Partial<LiveCardData> = {}): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: options.score ?? 1,
    requirements: options.requirements ?? createHeartRequirement({ [HeartColor.BLUE]: 1 }),
    ...options,
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createCards() {
  const source = createCardInstance(
    createMember('PL!N-pb1-011-R', { name: 'ミア・テイラー', cost: 15, blade: 5 }),
    PLAYER1,
    'mia-source'
  );
  const energyCards = [0, 1].map((index) =>
    createCardInstance(createEnergy(`MIA-ENERGY-${index}`), PLAYER1, `mia-energy-${index}`)
  );
  const nijigasakiLive = createCardInstance(
    createLive('PL!N-LIVE-001-L', { name: '虹咲 LIVE', groupNames: ['虹ヶ咲'] }),
    PLAYER1,
    'nijigasaki-live'
  );
  const otherLive = createCardInstance(
    createLive('PL!S-LIVE-001-L', { name: 'Aqours LIVE', groupNames: ['Aqours'] }),
    PLAYER1,
    'other-live'
  );
  const waitingMember = createCardInstance(
    createMember('PL!N-MEMBER-001-R', { name: '虹咲 member', groupNames: ['虹ヶ咲'] }),
    PLAYER1,
    'waiting-member'
  );
  return { source, energyCards, nijigasakiLive, otherLive, waitingMember };
}

function setupMiaSession(options: {
  readonly energyOrientations?: readonly OrientationState[];
  readonly waitingRoomCards?: readonly ('nijigasakiLive' | 'otherLive' | 'waitingMember')[];
} = {}) {
  const session = createGameSession();
  session.createGame('n-pb1-011-mia', PLAYER1, 'P1', PLAYER2, 'P2');
  const cards = createCards();
  let game = registerCards(session.state!, [
    cards.source,
    ...cards.energyCards,
    cards.nijigasakiLive,
    cards.otherLive,
    cards.waitingMember,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  const energyOrientations =
    options.energyOrientations ?? [OrientationState.ACTIVE, OrientationState.WAITING];
  const waitingRoomCards = options.waitingRoomCards ?? ['nijigasakiLive'];
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cards.source.instanceId),
    energyZone: {
      ...player.energyZone,
      cardIds: cards.energyCards
        .slice(0, energyOrientations.length)
        .map((card) => card.instanceId),
      cardStates: new Map(
        cards.energyCards.slice(0, energyOrientations.length).map((card, index) => [
          card.instanceId,
          {
            orientation: energyOrientations[index]!,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoomCards.map((key) => cards[key].instanceId),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, ...cards };
}

function activate(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      'mia-source',
      PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
    )
  );
}

function confirmCard(session: ReturnType<typeof createGameSession>, cardId: string): void {
  const effectId = session.state!.activeEffect!.id;
  expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardId)).success).toBe(
    true
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!N-pb1-011 Mia workflows', () => {
  it('automatically moves the first energy below this member and recovers one Nijigasaki LIVE', () => {
    const scenario = setupMiaSession();
    expect(activate(scenario.session).success).toBe(true);
    expect(scenario.session.state?.players[0].energyZone.cardIds).not.toContain(
      scenario.energyCards[0].instanceId
    );
    expect(
      scenario.session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]
    ).toEqual([scenario.energyCards[0].instanceId]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.nijigasakiLive.instanceId,
    ]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);

    confirmCard(scenario.session, scenario.nijigasakiLive.instanceId);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(
      scenario.nijigasakiLive.instanceId
    );
  });

  it('allows ACTIVE or WAITING energy as the cost', () => {
    for (const orientation of [OrientationState.ACTIVE, OrientationState.WAITING]) {
      const scenario = setupMiaSession({
        energyOrientations: [orientation],
        waitingRoomCards: [],
      });
      expect(activate(scenario.session).success).toBe(true);

      expect(
        scenario.session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]
      ).toEqual([scenario.energyCards[0].instanceId]);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(abilityUseCount(scenario.session.state!)).toBe(1);
    }
  });

  it('does not allow non-Nijigasaki LIVE or member cards as recovery targets', () => {
    const scenario = setupMiaSession({
      waitingRoomCards: ['nijigasakiLive', 'otherLive', 'waitingMember'],
    });
    expect(activate(scenario.session).success).toBe(true);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.nijigasakiLive.instanceId,
    ]);
  });

  it('keeps the paid energy below this member and finishes safely when there is no recovery target', () => {
    const scenario = setupMiaSession({ waitingRoomCards: ['otherLive', 'waitingMember'] });
    expect(activate(scenario.session).success).toBe(true);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]
    ).toEqual([scenario.energyCards[0].instanceId]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
  });

  it('cannot be activated without energy in the energy zone', () => {
    const scenario = setupMiaSession({ energyOrientations: [] });
    expect(activate(scenario.session).success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(abilityUseCount(scenario.session.state!)).toBe(0);
  });

  it('is limited to once per turn after the energy cost succeeds', () => {
    const scenario = setupMiaSession({ waitingRoomCards: [] });
    expect(activate(scenario.session).success).toBe(true);

    const second = activate(scenario.session);
    expect(second.success).toBe(false);
    expect(second.error).toContain('本回合已发动');
  });

  it('returns energyBelow to energy deck through existing rule cleanup after the source leaves stage', () => {
    const scenario = setupMiaSession({ waitingRoomCards: [] });
    expect(activate(scenario.session).success).toBe(true);

    let game = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const ruleActions = ruleActionProcessor.collectPendingRuleActions(game, (cardId) => {
      const card = getCardById(game, cardId);
      return card?.data.cardType ?? null;
    });
    for (const action of ruleActions) {
      game = applyRuleActionResult(game, action, (cardId) => {
        const card = getCardById(game, cardId);
        return card?.data.cardType ?? null;
      });
    }

    expect(game.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(game.players[0].energyDeck.cardIds).toContain(scenario.energyCards[0].instanceId);
  });
});
