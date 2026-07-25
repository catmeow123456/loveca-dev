import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP7_023_LIVE_SUCCESS_LIELLA_REVEALED_CHEER_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { SP_BP7_023_SELECT_LIELLA_CHEER_TO_DECK_TOP_STEP_ID } from '../../src/application/card-effects/workflows/shared/revealed-cheer-selection';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function liveCard(cardCode: string, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function memberCard(cardCode: string, groupName = 'Liella!'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function energyCard(cardCode: string, groupName = 'Liella!'): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.ENERGY,
  };
}

function setup(options: { readonly includeValidTargets?: boolean } = {}) {
  const session = createGameSession();
  session.createGame('sp-bp7-023-start-true-dreams', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(liveCard('PL!SP-bp7-023-SECL'), PLAYER1, 'sp-bp7-023-source');
  const liellaMember = createCardInstance(
    memberCard('PL!SP-test-liella-member'),
    PLAYER1,
    'liella-member'
  );
  const liellaLive = createCardInstance(liveCard('PL!SP-test-liella-live'), PLAYER1, 'liella-live');
  const liellaEnergy = createCardInstance(
    energyCard('PL!SP-test-liella-energy'),
    PLAYER1,
    'liella-energy'
  );
  const otherGroup = createCardInstance(
    memberCard('PL!SP-test-other-group', 'Aqours'),
    PLAYER1,
    'other-group'
  );
  const opponentLiella = createCardInstance(
    memberCard('PL!SP-test-opponent-liella'),
    PLAYER2,
    'opponent-liella'
  );
  const staleLiella = createCardInstance(
    liveCard('PL!SP-test-stale-liella'),
    PLAYER1,
    'stale-liella'
  );
  const unrevealedLiella = createCardInstance(
    memberCard('PL!SP-test-unrevealed-liella'),
    PLAYER1,
    'unrevealed-liella'
  );
  const notCurrentCheerLiella = createCardInstance(
    energyCard('PL!SP-test-not-current-cheer-liella'),
    PLAYER1,
    'not-current-cheer-liella'
  );
  const deckTop = createCardInstance(
    liveCard('PL!SP-test-deck-top', 'Aqours'),
    PLAYER1,
    'deck-top'
  );

  const cards = [
    source,
    liellaMember,
    liellaLive,
    liellaEnergy,
    otherGroup,
    opponentLiella,
    staleLiella,
    unrevealedLiella,
    notCurrentCheerLiella,
    deckTop,
  ];
  let game = registerCards(session.state!, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId] },
    liveZone: {
      ...player.liveZone,
      cardIds: [source.instanceId],
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));

  const validTargetIds =
    options.includeValidTargets === false
      ? []
      : [liellaMember.instanceId, liellaLive.instanceId, liellaEnergy.instanceId];
  const currentCheerIds = [
    ...validTargetIds,
    otherGroup.instanceId,
    opponentLiella.instanceId,
    unrevealedLiella.instanceId,
    staleLiella.instanceId,
  ];
  const resolutionIds = [
    ...validTargetIds,
    otherGroup.instanceId,
    opponentLiella.instanceId,
    unrevealedLiella.instanceId,
    notCurrentCheerLiella.instanceId,
  ];
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: resolutionIds,
      revealedCardIds: resolutionIds.filter((cardId) => cardId !== unrevealedLiella.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[source.instanceId, true]]),
      firstPlayerCheerCardIds: currentCheerIds,
      performingPlayerId: PLAYER1,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  const timingResult = new GameService().executeCheckTiming(game, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(timingResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;

  return {
    session,
    validTargetIds,
    liellaMemberId: liellaMember.instanceId,
    liellaLiveId: liellaLive.instanceId,
    liellaEnergyId: liellaEnergy.instanceId,
    otherGroupId: otherGroup.instanceId,
    opponentLiellaId: opponentLiella.instanceId,
    staleLiellaId: staleLiella.instanceId,
    unrevealedLiellaId: unrevealedLiella.instanceId,
    notCurrentCheerLiellaId: notCurrentCheerLiella.instanceId,
    deckTopId: deckTop.instanceId,
  };
}

function submitSelection(
  session: ReturnType<typeof createGameSession>,
  selectedCardIds: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      null,
      null,
      false,
      null,
      selectedCardIds
    )
  );
}

function advancePublicSelection(session: ReturnType<typeof createGameSession>) {
  const effect = session.state!.activeEffect!;
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: { ...effect, publicCardSelectionAutoAdvanceAt: 0 },
  };
  return session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER1, effect.id, 0));
}

describe('PL!SP-bp7-023-SECL 分数1「START! True dreams」', () => {
  it('只提供当前己方声援公开且仍可移动的 Liella! 卡，不限制卡片类型', () => {
    const scenario = setup();

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP7_023_LIVE_SUCCESS_LIELLA_REVEALED_CHEER_TO_DECK_TOP_ABILITY_ID,
      stepId: SP_BP7_023_SELECT_LIELLA_CHEER_TO_DECK_TOP_STEP_ID,
      selectableCardIds: scenario.validTargetIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      stepText: '请选择至多1张因声援被公开的自己的『Liella!』卡片放置于卡组顶。',
      selectionLabel: '选择要放置于卡组顶的声援公开 Liella! 卡',
      confirmSelectionLabel: '放置于卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'REVEALED_CHEER',
          destination: 'MAIN_DECK_TOP',
        },
      },
    });
    expect(scenario.session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(
      true
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.otherGroupId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.opponentLiellaId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.staleLiellaId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.unrevealedLiellaId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.notCurrentCheerLiellaId
    );
  });

  it.each([
    ['MEMBER', 'liellaMemberId'],
    ['LIVE', 'liellaLiveId'],
    ['ENERGY', 'liellaEnergyId'],
  ] as const)('可以选择 Liella! %s，经双方公开后恰好置顶一次', (_type, key) => {
    const scenario = setup();
    const selectedCardId = scenario[key];
    const selected = submitSelection(scenario.session, [selectedCardId]);

    expect(selected.success, selected.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [selectedCardId],
    });
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
    expect(scenario.session.state?.resolutionZone.cardIds).toContain(selectedCardId);
    expect(scenario.session.getPlayerViewState(PLAYER1).activeEffect?.revealedObjectIds).toEqual([
      createPublicObjectId(selectedCardId),
    ]);
    expect(scenario.session.getPlayerViewState(PLAYER2).activeEffect?.revealedObjectIds).toEqual([
      createPublicObjectId(selectedCardId),
    ]);

    const advanced = advancePublicSelection(scenario.session);
    expect(advanced.success, advanced.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      selectedCardId,
      scenario.deckTopId,
    ]);
    expect(scenario.session.state?.resolutionZone.cardIds).not.toContain(selectedCardId);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP7_023_LIVE_SUCCESS_LIELLA_REVEALED_CHEER_TO_DECK_TOP_ABILITY_ID &&
          action.payload.step === 'MOVE_REVEALED_CHEER_CARD'
      )
    ).toHaveLength(1);
  });

  it('选择0张直接不发动，不创建空公开窗口或第二个确认窗口', () => {
    const scenario = setup();
    const result = submitSelection(scenario.session, []);

    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
  });

  it('没有合法目标时直接消费能力，不创建空公开或 confirm-only 窗口', () => {
    const scenario = setup({ includeValidTargets: false });

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
  });

  it('公开期间目标不再 revealed 时不移动，并恢复为当前真实候选', () => {
    const scenario = setup();
    const selected = submitSelection(scenario.session, [scenario.liellaMemberId]);
    expect(selected.success, selected.error).toBe(true);

    const displayEffect = scenario.session.state!.activeEffect!;
    (scenario.session as unknown as { authorityState: GameState }).authorityState = {
      ...scenario.session.state!,
      resolutionZone: {
        ...scenario.session.state!.resolutionZone,
        revealedCardIds: scenario.session.state!.resolutionZone.revealedCardIds.filter(
          (cardId) => cardId !== scenario.liellaMemberId
        ),
      },
      activeEffect: { ...displayEffect, publicCardSelectionAutoAdvanceAt: 0 },
    };

    const advanced = scenario.session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, displayEffect.id, 0)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepId: SP_BP7_023_SELECT_LIELLA_CHEER_TO_DECK_TOP_STEP_ID,
      selectableCardIds: [scenario.liellaLiveId, scenario.liellaEnergyId],
    });
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
    expect(scenario.session.state?.resolutionZone.cardIds).toContain(scenario.liellaMemberId);
  });
});
