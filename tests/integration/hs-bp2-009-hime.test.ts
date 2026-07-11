import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, name: string, cost: number, unitName: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) =>
      member(`MEM-${index}`, `Member ${index}`, 1, 'Mira-Cra Park!')
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENE-${index}`)),
  };
}

function setup(options: {
  readonly sourceCardCode?: string;
  readonly replacementCost?: number;
  readonly replacementUnit?: string;
  readonly activeEnergyCount?: number;
  readonly relay?: boolean;
}) {
  const session = createGameSession();
  const cards = deck();
  session.createGame('hs-bp2-009', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(cards, cards);
  const phase = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  phase.currentPhase = GamePhase.MAIN_PHASE;
  phase.currentSubPhase = SubPhase.MAIN_FREE;
  phase.currentTurnType = TurnType.NORMAL;
  phase.activePlayerIndex = 0;

  const source = createCardInstance(
    member(options.sourceCardCode ?? 'PL!HS-bp2-009-R', '安養寺 姫芽', 13, 'Mira-Cra Park!'),
    PLAYER1,
    'hime-source'
  );
  const replacement = createCardInstance(
    member(
      'REPLACEMENT',
      'Relay Member',
      options.replacementCost ?? 12,
      options.replacementUnit ?? 'Mira-Cra Park!'
    ),
    PLAYER1,
    'relay-member'
  );
  const energyCards = Array.from({ length: options.activeEnergyCount ?? 1 }, (_, index) =>
    createCardInstance(energy(`TEST-ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const state = registerCards(session.state!, [source, replacement, ...energyCards]);
  const player = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.hand.cardIds = [source.instanceId];
  player.energyZone.cardIds = energyCards.map((card) => card.instanceId);
  player.energyZone.cardStates = new Map(
    energyCards.map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map([
    [replacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(
      PLAYER1,
      source.instanceId,
      options.relay === false ? SlotPosition.LEFT : SlotPosition.CENTER,
      { freePlay: true }
    )
  );
  expect(playResult.success).toBe(true);
  return {
    session,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function choose(session: ReturnType<typeof createGameSession>, optionId?: 'pay') {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      optionId
    )
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-bp2-009 安養寺姫芽', () => {
  it.each(['PL!HS-bp2-009-R', 'PL!HS-bp2-009-P'])(
    'pays one active energy then gains two pink Heart for %s after valid relay',
    (sourceCardCode) => {
      const { session, sourceId, energyCardIds } = setup({ sourceCardCode });
      expect(session.state?.activeEffect).toMatchObject({
        abilityId:
          HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID,
        selectableOptions: [{ id: 'pay', label: '支付1能量' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(session.state?.activeEffect?.selectableOptions).not.toContainEqual(
        expect.objectContaining({ label: '不发动' })
      );

      choose(session, 'pay');

      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.pendingAbilities).toEqual([]);
      expect(
        session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
      ).toBe(OrientationState.WAITING);
      expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
      expect(session.state?.liveResolution.liveModifiers).toContainEqual({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        hearts: [createHeartIcon(HeartColor.PINK, 2)],
        sourceCardId: sourceId,
        abilityId:
          HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID,
      });
    }
  );

  it('skips without paying or adding Heart', () => {
    const { session, energyCardIds } = setup({});
    choose(session);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('only offers the single skip entry when there is no active energy', () => {
    const { session } = setup({ activeEnergyCount: 0 });
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect).toMatchObject({
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    choose(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it.each([
    ['no relay', { relay: false }],
    ['same cost', { replacementCost: 13 }],
    ['wrong unit', { replacementUnit: 'DOLLCHESTRA' }],
  ] as const)(
    'still offers payment for %s and retains the paid cost without Heart',
    (_label, options) => {
      const { session, energyCardIds } = setup(options);
      expect(session.state?.activeEffect?.selectableOptions).toContainEqual({
        id: 'pay',
        label: '支付1能量',
      });

      choose(session, 'pay');

      expect(
        session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
      ).toBe(OrientationState.WAITING);
      expect(session.state?.liveResolution.liveModifiers).toEqual([]);
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.type === 'PAY_COST' &&
            action.payload.abilityId ===
              HS_BP2_009_ON_ENTER_PAY_ENERGY_LOWER_COST_MIRACRA_RELAY_GAIN_TWO_PINK_HEART_ABILITY_ID &&
            action.payload.amount === 1
        )
      ).toBe(true);
    }
  );

  it('pays but does not write Heart when the source leaves stage before confirmation', () => {
    const { session, sourceId, energyCardIds } = setup({});
    const player = session.state!.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    player.memberSlots.slots[SlotPosition.CENTER] = null;

    choose(session, 'pay');

    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.sourceCardId === sourceId &&
          action.payload.reason === 'SOURCE_LEFT_STAGE' &&
          action.payload.heartCount === 0
      )
    ).toBe(true);
  });
});
