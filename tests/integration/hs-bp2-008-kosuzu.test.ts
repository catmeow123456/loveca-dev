import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_BP2_008_ON_ENTER_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
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
      member(`MEM-${index}`, `Member ${index}`, 1, 'DOLLCHESTRA')
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENE-${index}`)),
  };
}

function setup(options: {
  readonly sourceCardCode?: string;
  readonly replacementCost?: number;
  readonly replacementUnit?: string;
  readonly relay?: boolean;
}) {
  const session = createGameSession();
  const cards = deck();
  session.createGame('hs-bp2-008', PLAYER1, 'P1', PLAYER2, 'P2');
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
    member(options.sourceCardCode ?? 'PL!HS-bp2-008-R', '徒町 小鈴', 4, 'DOLLCHESTRA'),
    PLAYER1,
    'kosuzu-source'
  );
  const replacement = createCardInstance(
    member(
      'REPLACEMENT',
      'Relay Member',
      options.replacementCost ?? 3,
      options.replacementUnit ?? 'DOLLCHESTRA'
    ),
    PLAYER1,
    'relay-member'
  );
  const state = registerCards(session.state!, [source, replacement]);
  const player = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.hand.cardIds = [source.instanceId];
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map([
    [replacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  session.localFreePlay = true;
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(
      PLAYER1,
      source.instanceId,
      options.relay === false ? SlotPosition.LEFT : SlotPosition.CENTER,
      { freePlay: true }
    )
  );
  expect(result.success).toBe(true);
  return { session, sourceId: source.instanceId };
}

describe('PL!HS-bp2-008 徒町小鈴', () => {
  it.each(['PL!HS-bp2-008-R', 'PL!HS-bp2-008-P'])(
    'gains BLADE +2 for %s after lower-cost DOLLCHESTRA relay',
    (sourceCardCode) => {
      const { session, sourceId } = setup({ sourceCardCode });
      expect(session.state?.pendingAbilities).toEqual([]);
      expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(3);
      expect(session.state?.liveResolution.liveModifiers).toContainEqual({
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: 2,
        sourceCardId: sourceId,
        abilityId: HS_BP2_008_ON_ENTER_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE_ABILITY_ID,
      });
    }
  );

  it.each([
    ['no relay', { relay: false }],
    ['same cost', { replacementCost: 4 }],
    ['higher cost', { replacementCost: 5 }],
    ['wrong unit', { replacementUnit: 'Mira-Cra Park!' }],
  ] as const)('consumes pending without BLADE for %s', (_label, options) => {
    const { session, sourceId } = setup(options);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('safely consumes ordered stale pending abilities after the source leaves stage', () => {
    const source = createCardInstance(
      member('PL!HS-bp2-008-R', '徒町 小鈴', 4, 'DOLLCHESTRA'),
      PLAYER1,
      'stale-source'
    );
    const replacement = createCardInstance(
      member('REPLACEMENT', 'Relay Member', 3, 'DOLLCHESTRA'),
      PLAYER1,
      'stale-replacement'
    );
    let game = createGameState('stale-008', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, replacement]);
    const pending = (id: string): PendingAbilityState => ({
      id,
      abilityId: HS_BP2_008_ON_ENTER_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE_ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      sourceSlot: SlotPosition.CENTER,
      eventIds: [`event-${id}`],
      metadata: {
        relayReplacements: [{ cardId: replacement.instanceId, effectiveCost: 3 }],
      },
    });

    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pending('first'), pending('second')],
    }).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });
});
