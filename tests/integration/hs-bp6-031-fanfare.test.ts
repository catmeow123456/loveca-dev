import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
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
import {
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(
  cardCode: string,
  name: string,
  cost = 1,
  groupName = '莲之空'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name: string, groupName = '莲之空'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `Energy ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`, `Member ${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    firstPlayerIndex: number;
    liveSetCompletedPlayers: string[];
  };
  mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
  mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
  mutableState.currentTurnType = TurnType.LIVE_PHASE;
  mutableState.activePlayerIndex = 0;
  mutableState.firstPlayerIndex = 0;
  mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function setupFanfareRecycleScenario(options: {
  readonly miraCraCount: number;
  readonly includeHime: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly fanfareLiveId: string;
  readonly waitingMemberIds: readonly string[];
  readonly himeId: string | null;
  readonly deckFillerId: string;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `hs-bp6-031-fanfare-${options.miraCraCount}-${options.includeHime ? 'hime' : 'no-hime'}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);

  const fanfareLive = createCardInstance(
    createLiveCard('PL!HS-bp6-031-L', 'ファンファーレ！！！'),
    PLAYER1,
    'p1-fanfare-live'
  );
  const hime = options.includeHime
    ? createCardInstance(
        {
          ...createMemberCard('PL!HS-test-hime', '安養寺 姫芽', 4),
          unitName: 'みらくらぱーく！',
        },
        PLAYER1,
        'p1-hime'
      )
    : null;
  const miraCraMembers = Array.from({ length: options.miraCraCount }, (_, index) =>
    createCardInstance(
      {
        ...createMemberCard(
          `PL!HS-test-miracra-${index}`,
          `みらくらぱーく！ ${index}`,
          1
        ),
        unitName: 'みらくらぱーく！',
      },
      PLAYER1,
      `p1-miracra-${index}`
    )
  );
  const deckFiller = createCardInstance(
    createLiveCard('PL!HS-test-deck-filler-live', 'Deck Filler'),
    PLAYER1,
    'p1-deck-filler-live'
  );

  const registeredState = registerCards(session.state!, [
    fanfareLive,
    deckFiller,
    ...miraCraMembers,
    ...(hime ? [hime] : []),
  ]);
  const preparedState = updatePlayer(registeredState, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [deckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: miraCraMembers.map((card) => card.instanceId),
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [fanfareLive.instanceId],
      cardStates: new Map([
        [
          fanfareLive.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
        ],
      ]),
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: hime?.instanceId ?? null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map(
        hime
          ? [[hime.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]
          : []
      ),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = preparedState;

  advanceToLiveStartEffects(session);

  return {
    session,
    fanfareLiveId: fanfareLive.instanceId,
    waitingMemberIds: miraCraMembers.map((card) => card.instanceId),
    himeId: hime?.instanceId ?? null,
    deckFillerId: deckFiller.instanceId,
  };
}

describe('HS-bp6-031 Fanfare recycle workflow', () => {
  it('declines without recycling members or adding Blade', () => {
    const { session, waitingMemberIds, deckFillerId } = setupFanfareRecycleScenario({
      miraCraCount: 15,
      includeHime: true,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP6_031_RECYCLE_MEMBERS_OPTION');

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'decline'
      )
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(waitingMemberIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFillerId]);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
  });

  it('recycles members without adding Blade when condition passes but no Hime target exists', () => {
    const { session, waitingMemberIds, deckFillerId } = setupFanfareRecycleScenario({
      miraCraCount: 15,
      includeHime: false,
    });

    const activateResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([deckFillerId, ...waitingMemberIds])
    );
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'RECYCLE_MEMBERS_NO_HIME_TARGET' &&
          action.payload.miraCraMemberCount === 15 &&
          Array.isArray(action.payload.movedMemberCardIds) &&
          action.payload.movedMemberCardIds.length === waitingMemberIds.length
      )
    ).toBe(true);
  });
});
