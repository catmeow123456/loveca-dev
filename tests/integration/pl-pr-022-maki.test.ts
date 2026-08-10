import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const EFFECT_TEXT =
  '【起动】【1回合1次】将此成员变为待机状态：自己的舞台上存在「星空凛」或「小泉花阳」的场合，抽2张卡，将1张手牌放置入休息室。同时存在2人的场合，接着将此成员变为活跃状态。';

function member(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 20 }, (_, index) =>
    member(`DECK-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => energy(`ENERGY-${index}`));
  return { mainDeck, energyDeck };
}

function setup(
  options: {
    readonly sourceCardCode?: string;
    readonly sourceOrientation?: OrientationState;
    readonly partnerNames?: readonly string[];
    readonly handCount?: number;
    readonly drawCount?: number;
  } = {}
) {
  const session = createGameSession();
  session.createGame('pl-pr-022-maki', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());

  const source = createCardInstance(
    member(options.sourceCardCode ?? 'PL!-PR-022-PR', '西木野真姬', 2),
    PLAYER1,
    'maki-source'
  );
  const partners = (options.partnerNames ?? []).map((name, index) =>
    createCardInstance(member(`PARTNER-${index}`, name, 2), PLAYER1, `partner-${index}`)
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), PLAYER1, `hand-${index}`)
  );
  const drawCards = Array.from({ length: options.drawCount ?? 2 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  const state = registerCards(session.state!, [source, ...partners, ...handCards, ...drawCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

  const player = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.hand.cardIds = handCards.map((card) => card.instanceId);
  player.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  player.waitingRoom.cardIds = [];
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: partners[0]?.instanceId ?? null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: partners[1]?.instanceId ?? null,
  };
  player.memberSlots.cardStates = new Map([
    [
      source.instanceId,
      {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ],
    ...partners.map(
      (partner) =>
        [
          partner.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ] as const
    ),
  ]);

  return {
    session,
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
}

function activate(scenario: ReturnType<typeof setup>) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID
    )
  );
}

function sourceOrientation(scenario: ReturnType<typeof setup>): OrientationState | undefined {
  return scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)
    ?.orientation;
}

describe('PL!-PR-022 费用2「西木野真姬」', () => {
  it('pays the WAIT cost even when neither named member exists and consumes the turn use', () => {
    const scenario = setup();

    expect(activate(scenario).success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(scenario.drawCardIds);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'PAID_COST_STAGE_NAME_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('draws two then discards one when only Rin is present and keeps the source WAITING', () => {
    const scenario = setup({
      sourceCardCode: 'PL!-PR-022-UNSEEN',
      partnerNames: ['星空 凛'],
    });

    expect(activate(scenario).success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
      stepId: 'PL_PR_022_SELECT_DISCARD_AFTER_DRAW',
      effectText: EFFECT_TEXT,
      stepText: '请选择1张手牌放置入休息室。',
      selectionLabel: '请选择要放置入休息室的手牌',
    });
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      ...scenario.handCardIds,
      ...scenario.drawCardIds,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.drawCardIds[0]
        )
      ).success
    ).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.drawCardIds[0],
    ]);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === 'HAND' &&
          entry.event.cardInstanceIds?.includes(scenario.drawCardIds[0]!)
      )
    ).toBe(true);
  });

  it('lets one combination card contribute both structured identities and reactivates after discard', () => {
    const scenario = setup({ partnerNames: ['星空 凛＆小泉 花陽'] });

    expect(activate(scenario).success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    const effectId = scenario.session.state!.activeEffect!.id;

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effectId, scenario.handCardIds[0])
      ).success
    ).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);

    const sourceStateEvents = scenario.session.state!.eventLog
      .map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          event.cardInstanceId === scenario.sourceId
      );
    expect(sourceStateEvents).toMatchObject([
      {
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      },
      {
        previousOrientation: OrientationState.WAITING,
        nextOrientation: OrientationState.ACTIVE,
      },
    ]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'ACTIVATE_SOURCE_AFTER_DRAW_DISCARD'
      )
    ).toBe(true);

    expect(activate(scenario).success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
  });

  it('rejects illegal discard input without rolling back the already-paid WAIT cost', () => {
    const scenario = setup({ partnerNames: ['小泉花阳'] });
    expect(activate(scenario).success).toBe(true);
    const effectId = scenario.session.state!.activeEffect!.id;

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effectId, 'not-a-selectable-card')
      ).success
    ).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect?.id).toBe(effectId);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      ...scenario.handCardIds,
      ...scenario.drawCardIds,
    ]);
  });

  it('rejects a WAITING source before paying or consuming the turn use', () => {
    const scenario = setup({
      sourceOrientation: OrientationState.WAITING,
      partnerNames: ['星空凛', '小泉花阳'],
    });

    expect(activate(scenario).success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.actionHistory).toEqual([]);
    expect(scenario.session.state?.eventLog).toEqual([]);
  });
});
