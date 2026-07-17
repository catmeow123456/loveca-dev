import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createActivateAbilityCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  getActivatedAbilityLimitStatus,
  getActivatedAbilityUiConfig,
  getActivatedAbilityUiConfigs,
  isSupportedActivatedAbilityForCard,
} from '../../src/application/card-effect-runner';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import { createPublicObjectId } from '../../src/online/projector';
import {
  SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
  SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.groupNames?.[0] ?? 'Liella!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 6,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMember(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergy(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhase(session: GameSession): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.FIRST_PLAYER_TURN;
  mutableState.activePlayerIndex = 0;
}

function setupRelayScenario(options: {
  readonly sourceCardCode?: string;
  readonly replacementGroupName?: string;
  readonly includeReplacement?: boolean;
} = {}): {
  readonly session: GameSession;
  readonly sourceId: string;
  readonly replacementId: string;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-pb2-005-ren', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhase(session);

  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!SP-pb2-005-R', {
      name: '葉月 恋',
      cost: 20,
    }),
    PLAYER1,
    'ren-source'
  );
  const replacement = createCardInstance(
    createMember(
      options.replacementGroupName === 'Aqours' ? 'PL!S-replacement' : 'PL!SP-replacement',
      {
        name: 'Replacement',
        groupNames: [options.replacementGroupName ?? 'Liella!'],
      }
    ),
    PLAYER1,
    'relay-replacement'
  );
  const state = registerCards(session.state!, [source, replacement]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      memberBelow: Record<SlotPosition, string[]>;
    };
  };
  p1.hand.cardIds = [source.instanceId];
  p1.waitingRoom.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: options.includeReplacement === false ? null : replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map(
    options.includeReplacement === false
      ? []
      : [
          [
            replacement.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]
  );
  p1.memberSlots.memberBelow = {
    [SlotPosition.LEFT]: [],
    [SlotPosition.CENTER]: [],
    [SlotPosition.RIGHT]: [],
  };

  return {
    session,
    sourceId: source.instanceId,
    replacementId: replacement.instanceId,
  };
}

function playRenWithSingleRelay(session: GameSession, sourceId: string): void {
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
      relayMode: 'SINGLE',
      relayReplacementSlots: [SlotPosition.CENTER],
    })
  );
  expect(result.success).toBe(true);
}

function playRenWithoutRelay(session: GameSession, sourceId: string): void {
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

function setupGrantedActivatedScenario(): {
  readonly session: GameSession;
  readonly renId: string;
  readonly kekeBelowId: string;
  readonly handCardId: string;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-pb2-005-ren-granted-activated', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhase(session);

  const ren = createCardInstance(
    createMember('PL!SP-pb2-005-R', { name: '葉月 恋', cost: 20 }),
    PLAYER1,
    'ren-host'
  );
  const keke = createCardInstance(
    createMember('PL!SP-pb2-002-R', { name: '唐 可可', cost: 11 }),
    PLAYER1,
    'keke-below'
  );
  const target = createCardInstance(
    createMember('PL!SP-target', { name: 'Target' }),
    PLAYER1,
    'target-member'
  );
  const handCard = createCardInstance(
    createMember('PL!SP-hand-liella', { name: 'Hand Liella' }),
    PLAYER1,
    'hand-liella'
  );
  const energy = createCardInstance(createEnergy('energy-1'), PLAYER1, 'energy-1');
  const state = registerCards(session.state!, [ren, keke, target, handCard, energy]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      memberBelow: Record<SlotPosition, string[]>;
    };
  };
  p1.hand.cardIds = [handCard.instanceId];
  p1.energyDeck.cardIds = [energy.instanceId];
  p1.energyZone.cardIds = [];
  p1.energyZone.cardStates = new Map();
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: target.instanceId,
    [SlotPosition.CENTER]: ren.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [ren.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  p1.memberSlots.memberBelow = {
    [SlotPosition.LEFT]: [],
    [SlotPosition.CENTER]: [keke.instanceId],
    [SlotPosition.RIGHT]: [],
  };

  return {
    session,
    renId: ren.instanceId,
    kekeBelowId: keke.instanceId,
    handCardId: handCard.instanceId,
  };
}

describe('PL!SP-pb2-005 Ren on-enter and granted activated workflows', () => {
  it.each(['PL!SP-pb2-005-R', 'PL!SP-pb2-005-PP'])(
    'stacks this relay replacement below %s',
    (sourceCardCode) => {
      const scenario = setupRelayScenario({ sourceCardCode });
      playRenWithSingleRelay(scenario.session, scenario.sourceId);

      expect(scenario.session.state?.players[0].waitingRoom.cardIds).not.toContain(
        scenario.replacementId
      );
      expect(scenario.session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
        scenario.replacementId,
      ]);
      expect(latestRenPayload(scenario.session.state!)).toMatchObject({
        conditionMet: true,
        selectedCardId: scenario.replacementId,
        stackedCardId: scenario.replacementId,
      });
    }
  );

  it('consumes pending as no-op when Ren did not enter by relay', () => {
    const scenario = setupRelayScenario({ includeReplacement: false });
    playRenWithoutRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(
      []
    );
    expect(latestRenPayload(scenario.session.state!)).toMatchObject({
      conditionMet: false,
      reason: 'NO_RELAY_METADATA',
    });
  });

  it('does not stack a non-Liella replacement', () => {
    const scenario = setupRelayScenario({ replacementGroupName: 'Aqours' });
    playRenWithSingleRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(
      []
    );
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.replacementId
    );
    expect(latestRenPayload(scenario.session.state!)).toMatchObject({
      conditionMet: false,
      reason: 'NO_VALID_REPLACEMENT',
    });
  });

  it('lets Ren activate an implemented activated ability from a Liella! member below', () => {
    const scenario = setupGrantedActivatedScenario();
    const playerView = scenario.session.getPlayerViewState(PLAYER1)!;
    expect(
      playerView.objects[createPublicObjectId(scenario.renId)]?.activatedAbilityUiConfig
        ?.abilityId
    ).toBe(SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID);
    expect(
      playerView.objects[
        createPublicObjectId(scenario.renId)
      ]?.activatedAbilityUiConfigs?.map((config) => config.abilityId)
    ).toEqual([SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID]);

    expect(
      isSupportedActivatedAbilityForCard(
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
        'PL!SP-pb2-005-R',
        {
          game: scenario.session.state!,
          playerId: PLAYER1,
          sourceCardId: scenario.renId,
        }
      )
    ).toBe(true);
    expect(
      getActivatedAbilityUiConfig('PL!SP-pb2-005-R', CardAbilitySourceZone.STAGE_MEMBER, {
        game: scenario.session.state!,
        playerId: PLAYER1,
        sourceCardId: scenario.renId,
      })?.abilityId
    ).toBe(SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID);
    expect(
      getActivatedAbilityUiConfigs('PL!SP-pb2-005-R', CardAbilitySourceZone.STAGE_MEMBER, {
        game: scenario.session.state!,
        playerId: PLAYER1,
        sourceCardId: scenario.renId,
      }).map((config) => config.abilityId)
    ).toEqual([SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID]);

    const result = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.renId,
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
      )
    );

    expect(result).toMatchObject({ success: true });
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
      sourceCardId: scenario.renId,
      selectableCardIds: [scenario.handCardId],
    });
    const renLimitStatus = getActivatedAbilityLimitStatus(
      scenario.session.state!,
      PLAYER1,
      SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
      scenario.renId
    );
    expect(renLimitStatus?.sourceCardId).toBe(scenario.renId);
    expect(renLimitStatus?.remaining).toBe(0);
    expect(
      getActivatedAbilityLimitStatus(
        scenario.session.state!,
        PLAYER1,
        SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
        scenario.kekeBelowId
      )?.used
    ).toBe(0);
  });
});

function latestRenPayload(game: GameState): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID
    )?.payload;
}
