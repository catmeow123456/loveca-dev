import { describe, expect, it } from 'vitest';
import { buildAiDecisionContract } from '../../src/application/ai-decisions/decision-contract';
import {
  createCardInstance,
  createDefaultCardState,
  createFaceDownCardState,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  AI_OBSERVATION_SCHEMA_VERSION,
  buildAiObservation,
} from '../../src/server/ai-battle/ai-observation';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

const AI_PLAYER = 'authority-ai-player';
const OPPONENT = 'authority-opponent-player';
const REVISION = 9;

function member(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    nameCn: name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    cardTextCn: `${name}的公开卡文`,
  };
}

function live(cardCode: string, name: string, score: number): LiveCardData {
  return {
    cardCode,
    name,
    nameCn: name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createRepresentativeState(): GameState {
  const ownHandMember = createCardInstance(
    member('PL!TEST-001', '自己的手牌成员', 3),
    AI_PLAYER,
    'secret-own-hand-member-id'
  );
  const ownHandLive = createCardInstance(
    live('PL!TEST-LIVE-001', '自己的手牌LIVE', 4),
    AI_PLAYER,
    'secret-own-hand-live-id'
  );
  const ownDeckCard = createCardInstance(
    member('PL!TEST-DECK-001', '自己的未知卡组顶', 7),
    AI_PLAYER,
    'secret-own-deck-order-id'
  );
  const opponentHand = createCardInstance(
    member('PL!TEST-OPPONENT-HAND', '对手隐藏手牌', 9),
    OPPONENT,
    'secret-opponent-hand-id'
  );
  const opponentStage = createCardInstance(
    member('PL!TEST-OPPONENT-STAGE', '对手公开成员', 5),
    OPPONENT,
    'public-opponent-stage-authority-id'
  );
  const opponentSetLive = createCardInstance(
    live('PL!TEST-OPPONENT-LIVE', '对手里侧LIVE', 6),
    OPPONENT,
    'secret-opponent-set-live-id'
  );
  const opponentSuccess = createCardInstance(
    live('PL!TEST-OPPONENT-SUCCESS', '对手成功LIVE', 3),
    OPPONENT,
    'public-opponent-success-authority-id'
  );

  let state = registerCards(
    createGameState(
      'secret-match-id',
      AI_PLAYER,
      '不应出站的AI显示名',
      OPPONENT,
      '不应出站的对手显示名'
    ),
    [
      ownHandMember,
      ownHandLive,
      ownDeckCard,
      opponentHand,
      opponentStage,
      opponentSetLive,
      opponentSuccess,
    ]
  );
  state = {
    ...state,
    currentPhase: GamePhase.MULLIGAN_PHASE,
    currentSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
  };
  state = updatePlayer(state, AI_PLAYER, (player) => ({
    ...player,
    hand: addCardToZone(
      addCardToZone(player.hand, ownHandMember.instanceId),
      ownHandLive.instanceId
    ),
    mainDeck: addCardToZone(player.mainDeck, ownDeckCard.instanceId),
  }));
  state = updatePlayer(state, OPPONENT, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, opponentHand.instanceId),
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: opponentStage.instanceId,
      },
      cardStates: new Map([[opponentStage.instanceId, createDefaultCardState()]]),
    },
    liveZone: addCardToStatefulZone(
      player.liveZone,
      opponentSetLive.instanceId,
      createFaceDownCardState()
    ),
    successZone: addCardToZone(player.successZone, opponentSuccess.instanceId),
  }));
  return state;
}

function buildObservation(state: GameState) {
  const contract = buildAiDecisionContract(state, AI_PLAYER, REVISION);
  expect(contract.ok, contract.ok ? undefined : contract.detail).toBe(true);
  if (!contract.ok) throw new Error(contract.detail);
  const view = projectPlayerViewState(state, AI_PLAYER, { seq: REVISION });
  return {
    view,
    contract: contract.handle.contract,
    observation: buildAiObservation(view, contract.handle.contract),
  };
}

describe('AI battle Phase 2 observation boundary', () => {
  it('builds a representative allowlist snapshot without authority or hidden identifiers', () => {
    const { observation } = buildObservation(createRepresentativeState());
    const ownHand = observation.seats.FIRST.zones.find((zone) => zone.zoneKey === 'HAND');
    const opponentHand = observation.seats.SECOND.zones.find((zone) => zone.zoneKey === 'HAND');
    const opponentStage = observation.seats.SECOND.zones.find(
      (zone) => zone.zoneKey === 'MEMBER_CENTER'
    );
    const opponentLive = observation.seats.SECOND.zones.find(
      (zone) => zone.zoneKey === 'LIVE_ZONE'
    );

    expect(observation.schemaVersion).toBe(AI_OBSERVATION_SCHEMA_VERSION);
    expect(observation.decision).toMatchObject({
      decisionRef: 'current-decision',
      kind: 'MULLIGAN',
      candidates: [
        {
          candidateId: 'candidate-1',
          hidden: false,
          card: { cardCode: 'PL!TEST-001', name: '自己的手牌成员', cost: 3 },
        },
        {
          candidateId: 'candidate-2',
          hidden: false,
          card: { cardCode: 'PL!TEST-LIVE-001', name: '自己的手牌LIVE', score: 4 },
        },
      ],
    });
    expect(ownHand).toMatchObject({ count: 2 });
    expect(ownHand?.visibleCards.map((card) => card.cardCode)).toEqual([
      'PL!TEST-001',
      'PL!TEST-LIVE-001',
    ]);
    expect(opponentHand).toEqual({
      zoneKey: 'HAND',
      zoneType: ZoneType.HAND,
      count: 1,
      ordered: false,
      visibleCards: [],
    });
    expect(opponentStage?.visibleCards).toMatchObject([
      {
        cardCode: 'PL!TEST-OPPONENT-STAGE',
        name: '对手公开成员',
        role: 'PRIMARY',
        slot: SlotPosition.CENTER,
      },
    ]);
    expect(opponentLive).toMatchObject({ count: 1, visibleCards: [] });
    expect(observation.seats.SECOND).toMatchObject({
      successLiveCount: 1,
      successLiveScore: 3,
    });
    expect({
      schemaVersion: observation.schemaVersion,
      turn: observation.turn,
      ownHandCardCodes: ownHand?.visibleCards.map((card) => card.cardCode),
      opponentHand: {
        count: opponentHand?.count,
        visibleCardCount: opponentHand?.visibleCards.length,
      },
      opponentCenter: opponentStage?.visibleCards.map((card) => ({
        cardCode: card.cardCode,
        slot: card.slot,
      })),
      opponentLive: {
        count: opponentLive?.count,
        visibleCardCount: opponentLive?.visibleCards.length,
      },
      decision: observation.decision,
    }).toMatchInlineSnapshot(`
      {
        "decision": {
          "actions": [],
          "candidates": [
            {
              "candidateId": "candidate-1",
              "card": {
                "blade": 1,
                "bladeHearts": undefined,
                "cardCode": "PL!TEST-001",
                "cardType": "MEMBER",
                "cost": 3,
                "effectiveCost": undefined,
                "enteredStageThisTurn": undefined,
                "faceState": undefined,
                "hearts": [
                  {
                    "color": "PINK",
                    "count": 1,
                  },
                ],
                "judgmentResult": undefined,
                "liveScoreDelta": undefined,
                "modifierDelta": undefined,
                "name": "自己的手牌成员",
                "orientation": undefined,
                "requiredHearts": undefined,
                "requirementDeltas": undefined,
                "score": undefined,
                "text": "自己的手牌成员的公开卡文",
              },
              "hidden": false,
              "location": {
                "ownerSeat": "FIRST",
                "zoneKey": "HAND",
              },
            },
            {
              "candidateId": "candidate-2",
              "card": {
                "blade": undefined,
                "bladeHearts": undefined,
                "cardCode": "PL!TEST-LIVE-001",
                "cardType": "LIVE",
                "cost": undefined,
                "effectiveCost": undefined,
                "enteredStageThisTurn": undefined,
                "faceState": undefined,
                "hearts": undefined,
                "judgmentResult": undefined,
                "liveScoreDelta": undefined,
                "modifierDelta": undefined,
                "name": "自己的手牌LIVE",
                "orientation": undefined,
                "requiredHearts": {
                  "colorRequirements": {
                    "PINK": 2,
                  },
                  "totalRequired": 2,
                },
                "requirementDeltas": undefined,
                "score": 4,
                "text": undefined,
              },
              "hidden": false,
              "location": {
                "ownerSeat": "FIRST",
                "zoneKey": "HAND",
              },
            },
          ],
          "decisionRef": "current-decision",
          "input": {
            "kind": "CARD_SELECTION",
            "maxSelections": 2,
            "minSelections": 0,
          },
          "kind": "MULLIGAN",
          "mandatory": true,
          "options": [],
        },
        "opponentCenter": [
          {
            "cardCode": "PL!TEST-OPPONENT-STAGE",
            "slot": "CENTER",
          },
        ],
        "opponentHand": {
          "count": 1,
          "visibleCardCount": 0,
        },
        "opponentLive": {
          "count": 1,
          "visibleCardCount": 0,
        },
        "ownHandCardCodes": [
          "PL!TEST-001",
          "PL!TEST-LIVE-001",
        ],
        "schemaVersion": "ai-battle.observation/v3",
        "turn": {
          "activeSeat": "FIRST",
          "count": 0,
          "firstSeat": "FIRST",
          "phase": "MULLIGAN_PHASE",
          "prioritySeat": "FIRST",
          "subPhase": "MULLIGAN_FIRST_PLAYER",
        },
      }
    `);

    const serialized = JSON.stringify(observation);
    for (const forbidden of [
      'secret-match-id',
      AI_PLAYER,
      OPPONENT,
      '不应出站的AI显示名',
      '不应出站的对手显示名',
      'secret-own-hand-member-id',
      'secret-own-deck-order-id',
      'secret-opponent-hand-id',
      'secret-opponent-set-live-id',
      'obj_',
      'publicObjectId',
      'availableCommands',
      'permissions',
      'participants',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain('PL!TEST-OPPONENT-HAND');
    expect(serialized).not.toContain('PL!TEST-OPPONENT-LIVE');
    expect(serialized).not.toContain('自己的未知卡组顶');
  });

  it('keeps blind active-effect candidates anonymous while retaining legal constraints', () => {
    const source = createCardInstance(
      member('PL!TEST-SOURCE', '公开效果来源', 2),
      AI_PLAYER,
      'source-authority-id'
    );
    const blindTarget = createCardInstance(
      live('PL!TEST-BLIND-TARGET', '绝不能出站的盲选目标', 9),
      OPPONENT,
      'blind-target-authority-id'
    );
    const effect: ActiveEffectState = {
      id: 'secret-effect-runtime-id',
      abilityId: 'public-test-ability',
      sourceCardId: source.instanceId,
      sourceCardDisplayCode: source.data.cardCode,
      controllerId: AI_PLAYER,
      effectText: '从里侧候选中选择 1 张。',
      stepId: 'BLIND_PICK',
      stepText: '请选择 1 张。',
      awaitingPlayerId: AI_PLAYER,
      selectableCardIds: [blindTarget.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_BLIND',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
      metadata: { blindSelectionVersion: 3 },
    };
    let state = registerCards(
      createGameState('blind-match-id', AI_PLAYER, 'AI', OPPONENT, 'Opponent'),
      [source, blindTarget]
    );
    state = {
      ...state,
      activeEffect: effect,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.FREE_ACTION,
    };
    state = updatePlayer(state, AI_PLAYER, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: source.instanceId },
        cardStates: new Map([[source.instanceId, createDefaultCardState()]]),
      },
    }));

    const { view, contract, observation } = buildObservation(state);
    expect(observation.decision).toMatchObject({
      kind: 'ACTIVE_EFFECT',
      abilityId: 'public-test-ability',
      stepId: 'BLIND_PICK',
      effectSource: {
        controllerSeat: 'FIRST',
        card: {
          cardCode: 'PL!TEST-SOURCE',
          name: '公开效果来源',
          cardType: 'MEMBER',
          cost: 2,
        },
        location: {
          ownerSeat: 'FIRST',
          zoneKey: 'MEMBER_LEFT',
          slot: 'LEFT',
          role: 'PRIMARY',
        },
      },
      candidates: [{ candidateId: 'candidate-1', hidden: true }],
      input: {
        kind: 'CARD_SELECTION',
        minSelections: 1,
        maxSelections: 1,
        canSkip: false,
      },
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain('PL!TEST-BLIND-TARGET');
    expect(serialized).not.toContain('绝不能出站的盲选目标');
    expect(serialized).not.toContain('blind-target-authority-id');
    expect(serialized).not.toContain('secret-effect-runtime-id');
    expect(serialized).not.toContain('obj_');

    const sourceObjectId = view.activeEffect?.sourceObjectId;
    expect(sourceObjectId).toBeDefined();
    if (!sourceObjectId) throw new Error('missing projected active-effect source');
    const sourceObject = view.objects[sourceObjectId];
    expect(sourceObject).toBeDefined();
    if (!sourceObject) throw new Error('missing projected source object');
    const hiddenSourceObservation = buildAiObservation(
      {
        ...view,
        objects: {
          ...view.objects,
          [sourceObjectId]: {
            ...sourceObject,
            surface: 'BACK',
            frontInfo: undefined,
          },
        },
      },
      contract
    );
    expect(hiddenSourceObservation.decision.effectSource).toEqual({
      controllerSeat: 'FIRST',
      publicDisplayCardCode: 'PL!TEST-SOURCE',
    });
  });

  it('rejects seat, revision, and operation-mode mismatches at the boundary', () => {
    const { view, contract } = buildObservation(createRepresentativeState());

    expect(() =>
      buildAiObservation({ ...view, match: { ...view.match, viewerSeat: 'SECOND' } }, contract)
    ).toThrow('seat mismatch');
    expect(() =>
      buildAiObservation({ ...view, match: { ...view.match, seq: REVISION + 1 } }, contract)
    ).toThrow('revision mismatch');
    expect(() =>
      buildAiObservation(
        {
          ...view,
          match: {
            ...view.match,
            manualOperation: { ...view.match.manualOperation, mode: 'FREE' },
          },
        },
        contract
      )
    ).toThrow('only supports RULES mode');
  });
});
