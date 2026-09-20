import type { GameState } from '../../domain/entities/game.js';
import {
  getLiveSetCardCountForPlayer,
  getLiveSetCardIdsForPlayer,
  getLiveSetCardLimitForPlayer,
  getPlayerById,
} from '../../domain/entities/game.js';
import { GameCommandType, type GameCommand } from '../../application/game-commands.js';
import { getNormalMemberPlayOptions } from '../../application/normal-member-play.js';
import {
  buildAiSpecialMemberPlayConfirmation,
  queryAiSpecialMemberPlays,
} from './special-member-play-decision.js';
import { canUseActivatedAbilityThisTurn } from '../../application/card-effects/runtime/ability-turn-limit.js';
import { queryActivatedAbilityStart } from '../../application/card-effects/runtime/activated-registry.js';
import { getActivatedAbilityUiConfigs } from '../../application/card-effects/runtime/activated-ability-ui.js';
import { CardAbilitySourceZone } from '../../application/card-effects/ability-definition-types.js';
import { visibleActivationResources, visibleMemberEntryResources } from './ability-resources.js';
import { createPublicObjectId, projectPlayerViewState } from '../../online/projector.js';
import type { PlayerViewState } from '../../online/types.js';
import { CardType, FaceState, GamePhase, SubPhase } from '../../shared/types/enums.js';
import { getSuccessLiveSelectionCandidateIds } from '../../domain/rules/success-live-placement.js';
import { buildAiEffectDecision } from './effect-decision.js';
import {
  describeAiActivationResources,
  describeAiCardIdentity,
  describeAiLiveSet,
  describeAiMainPhaseEnd,
  summarizeAiLiveBaseBudget,
  describeAiMemberPlay,
  summarizeAiSelfResources,
} from './visible-resources.js';

import {
  validateSelection,
  responseSchema,
  type AiDecision,
  type AiCandidate,
  type AiDecisionSpace,
  type AiDecisionInput,
  type AiDecisionQuery,
} from './protocol.js';
export {
  materializeAiDecisionCommands,
  validateSelection,
  parseAiBattleResponse,
  type AiSelection,
  type AiCandidate,
  type AiDecisionSpace,
  type AiDecisionInput,
  type AiDecision,
  type AiDecisionQuery,
} from './protocol.js';

type CommandParameters = GameCommand extends infer C
  ? C extends GameCommand
    ? Omit<C, 'timestamp' | 'playerId'>
    : never
  : never;

/** Pure rule-window query. The service must sample and conditionally submit under its own queue. */
export function buildAiBattleDecision(
  game: GameState,
  playerId: string,
  view: PlayerViewState = projectPlayerViewState(game, playerId)
): AiDecisionQuery {
  if (game.isEnded || game.currentPhase === GamePhase.GAME_END) return { kind: 'ENDED' };
  if (
    view.match.matchId !== game.gameId ||
    view.match.participants[view.match.viewerSeat].id !== playerId
  ) {
    throw new Error('AI decision requires a view of the same game and seat');
  }
  if (game.manualOperationMode !== 'RULES')
    return { kind: 'UNSUPPORTED', reason: 'AI requires RULES mode' };
  const player = getPlayerById(game, playerId);
  if (!player) throw new Error('Unknown AI player');
  const enabled = (command: GameCommandType) =>
    view.permissions.availableCommands.some((hint) => hint.command === command && hint.enabled);
  const display = view.activeEffect;
  if (display) {
    const gate =
      display.publicRevealAutoAdvanceAt !== undefined
        ? {
            deadlineAt: display.publicRevealAutoAdvanceAt,
            remaining: display.publicRevealAutoAdvanceAfterMs,
            parameters: {
              publicRevealAutoAdvanceAt: display.publicRevealAutoAdvanceAt,
              publicRevealGeneration: display.publicRevealGeneration,
            },
          }
        : display.publicCardSelectionAutoAdvanceAt !== undefined
          ? {
              deadlineAt: display.publicCardSelectionAutoAdvanceAt,
              remaining: display.publicCardSelectionAutoAdvanceAfterMs,
              parameters: {
                publicCardSelectionAutoAdvanceAt: display.publicCardSelectionAutoAdvanceAt,
              },
            }
          : display.publicEffectChoiceAutoAdvanceAt !== undefined
            ? {
                deadlineAt: display.publicEffectChoiceAutoAdvanceAt,
                remaining: display.publicEffectChoiceAutoAdvanceAfterMs,
                parameters: {
                  publicEffectChoiceAutoAdvanceAt: display.publicEffectChoiceAutoAdvanceAt,
                },
              }
            : null;
    if (gate) {
      if (
        gate.remaining === undefined ||
        (display.publicRevealAutoAdvanceAt !== undefined && !display.publicRevealGeneration)
      ) {
        return { kind: 'UNSUPPORTED', reason: 'Incomplete public-display gate projection' };
      }
      if (gate.remaining > 0)
        return { kind: 'WAITING_FOR_TIME', deadlineAt: gate.deadlineAt, reason: 'PUBLIC_DISPLAY' };
      if (!enabled(GameCommandType.CONFIRM_EFFECT_STEP)) return { kind: 'WAITING_FOR_PLAYER' };
      const space: AiDecisionSpace = {
        kind: 'ACTION',
        candidates: [
          { ref: 'a1', description: '公开展示结束，继续处理', effectText: display.effectText },
        ],
      };
      return {
        kind: 'DECISION',
        decision: {
          input: createDecisionInput(game, view, 'PUBLIC_DISPLAY', space),
          toCommand(selection, timestamp) {
            validateSelection(space, selection);
            return {
              type: GameCommandType.CONFIRM_EFFECT_STEP,
              playerId,
              timestamp,
              effectId: display.id,
              ...gate.parameters,
            };
          },
        },
      };
    }
  }
  if (game.activeEffect) {
    if (
      view.activeEffect?.waitingSeat !== view.match.viewerSeat ||
      !enabled(GameCommandType.CONFIRM_EFFECT_STEP)
    )
      return { kind: 'WAITING_FOR_PLAYER' };
    const plan = buildAiEffectDecision(game, playerId, view);
    if ('reason' in plan) return { kind: 'UNSUPPORTED', reason: plan.reason };
    return {
      kind: 'DECISION',
      decision: {
        input: createDecisionInput(game, view, plan.purpose, plan.space),
        toCommand: plan.toCommand,
      },
    };
  }
  if (game.pendingSpecialMemberPlay) {
    if (
      view.pendingSpecialMemberPlay?.playerSeat !== view.match.viewerSeat ||
      !enabled(GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY)
    )
      return { kind: 'WAITING_FOR_PLAYER' };
    const plan = buildAiSpecialMemberPlayConfirmation(game, playerId, view);
    if ('reason' in plan) return { kind: 'UNSUPPORTED', reason: plan.reason };
    return {
      kind: 'DECISION',
      decision: {
        input: createDecisionInput(game, view, plan.purpose, plan.space),
        toCommand: plan.toCommand,
      },
    };
  }
  if (game.pendingCostPayment || game.inspectionContext) {
    const ownsWindow =
      view.activeEffect?.waitingSeat === view.match.viewerSeat ||
      view.pendingCostPayment?.playerSeat === view.match.viewerSeat ||
      game.inspectionContext?.ownerPlayerId === playerId ||
      enabled(GameCommandType.CONFIRM_EFFECT_STEP);
    return ownsWindow
      ? { kind: 'UNSUPPORTED', reason: 'Effect/payment/inspection window requires P2 adaptation' }
      : { kind: 'WAITING_FOR_PLAYER' };
  }

  const candidates: AiCandidate[] = [];
  const commands = new Map<string, CommandParameters>();
  const addAction = (facts: Omit<AiCandidate, 'ref'>, command: CommandParameters) => {
    const ref = `a${candidates.length + 1}`;
    candidates.push({ ref, ...facts });
    commands.set(ref, command);
  };
  const cardFront = (cardId: string) => {
    const front = view.objects[createPublicObjectId(cardId)]?.frontInfo;
    if (!front) throw new Error('Candidate does not have a visible card face');
    return front;
  };
  const cardName = (cardId: string) => describeAiCardIdentity(cardFront(cardId));
  let purpose: AiDecisionInput['purpose'];
  let space: AiDecisionSpace;
  let toCommands: AiDecision['toCommands'];
  const mulliganIds = new Map<string, string>();
  if (enabled(GameCommandType.MULLIGAN)) {
    purpose = 'MULLIGAN';
    for (const cardId of player.hand.cardIds) {
      const ref = `c${candidates.length + 1}`;
      candidates.push({
        ref,
        objectId: createPublicObjectId(cardId),
        description: cardName(cardId),
      });
      mulliganIds.set(ref, cardId);
    }
    space = { kind: 'CARDS', candidates, min: 0, max: candidates.length, ordered: false };
  } else if (game.currentPhase === GamePhase.MAIN_PHASE && enabled(GameCommandType.END_PHASE)) {
    purpose = 'MAIN';
    const resources = summarizeAiSelfResources(view, view.match.viewerSeat);
    if (enabled(GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY)) {
      const special = queryAiSpecialMemberPlays(game, playerId, view);
      if ('reason' in special) return { kind: 'UNSUPPORTED', reason: special.reason };
      for (const { facts, command } of special) addAction(facts, command);
    }
    if (enabled(GameCommandType.PLAY_MEMBER_TO_SLOT)) {
      for (const option of getNormalMemberPlayOptions(game, playerId)) {
        const replacedCardId = player.memberSlots.slots[option.targetSlot];
        addAction(
          {
            description: describeAiMemberPlay(
              cardFront(option.cardId),
              replacedCardId ? cardFront(replacedCardId) : undefined,
              {
                resources,
                targetSlot: option.targetSlot,
                energyCost: option.plan.actualEnergyCost,
              }
            ),
            objectId: createPublicObjectId(option.cardId),
            effectText:
              cardFront(option.cardId).cardTextCn?.trim() ||
              cardFront(option.cardId).cardTextJp?.trim(),
            targetSlot: option.targetSlot,
            energyCost: option.plan.actualEnergyCost,
            replacedObjectIds: replacedCardId ? [createPublicObjectId(replacedCardId)] : [],
            entryResources: visibleMemberEntryResources(
              game,
              playerId,
              option.cardId,
              option.targetSlot,
              replacedCardId ? [replacedCardId] : [],
              view
            ),
          },
          {
            type: GameCommandType.PLAY_MEMBER_TO_SLOT,
            cardId: option.cardId,
            targetSlot: option.targetSlot,
          }
        );
      }
    }
    if (enabled(GameCommandType.ACTIVATE_ABILITY)) {
      for (const cardId of [
        ...Object.values(player.memberSlots.slots),
        ...player.hand.cardIds,
        ...player.waitingRoom.cardIds,
      ]) {
        if (!cardId) continue;
        const visible = view.objects[createPublicObjectId(cardId)];
        if (visible?.surface !== 'FRONT' || !visible.frontInfo) continue;
        const sourceZone = player.hand.cardIds.includes(cardId)
          ? CardAbilitySourceZone.HAND
          : player.waitingRoom.cardIds.includes(cardId)
            ? CardAbilitySourceZone.WAITING_ROOM
            : CardAbilitySourceZone.STAGE_MEMBER;
        const abilities =
          sourceZone === CardAbilitySourceZone.STAGE_MEMBER
            ? (visible.activatedAbilityUiConfigs ?? [])
            : getActivatedAbilityUiConfigs(visible.frontInfo.cardCode, sourceZone, {
                game,
                playerId,
                sourceCardId: cardId,
              });
        for (const ability of abilities) {
          if (
            !canUseActivatedAbilityThisTurn(
              game,
              playerId,
              ability.abilityId,
              cardId,
              ability.abilityInstanceId
            )
          )
            continue;
          const canStart = queryActivatedAbilityStart(game, playerId, cardId, ability.abilityId);
          if (canStart === undefined)
            return {
              kind: 'UNSUPPORTED',
              reason: `Missing activation query: ${ability.abilityId}`,
            };
          if (!canStart) continue;
          const activationResources = visibleActivationResources(
            game,
            playerId,
            cardId,
            ability.abilityId,
            view
          );
          addAction(
            {
              description: `起动 ${cardName(cardId)}；${activationResources.activation ? `${describeAiActivationResources(activationResources.activation)}；` : ''}能力：${ability.title}`,
              objectId: createPublicObjectId(cardId),
              effectText: ability.text,
              ...activationResources,
            },
            {
              type: GameCommandType.ACTIVATE_ABILITY,
              cardId,
              abilityId: ability.abilityId,
              ...(ability.abilityInstanceId
                ? { abilityInstanceId: ability.abilityInstanceId }
                : {}),
            }
          );
        }
      }
    }
    addAction(
      {
        description: describeAiMainPhaseEnd(resources.activeEnergyCount, candidates),
      },
      { type: GameCommandType.END_PHASE }
    );
    space = { kind: 'ACTION', candidates };
  } else if (
    game.currentPhase === GamePhase.LIVE_SET_PHASE &&
    [SubPhase.LIVE_SET_FIRST_PLAYER, SubPhase.LIVE_SET_SECOND_PLAYER].includes(
      game.currentSubPhase
    ) &&
    enabled(GameCommandType.CONFIRM_STEP)
  ) {
    purpose = 'LIVE_SET';
    const setLimit = getLiveSetCardLimitForPlayer(game, playerId);
    const initiallySetIds = getLiveSetCardIdsForPlayer(game, playerId).filter(
      (cardId) =>
        player.liveZone.cardIds.includes(cardId) &&
        player.liveZone.cardStates.get(cardId)?.face === FaceState.FACE_DOWN
    );
    const initiallySet = new Set(initiallySetIds);
    const cardIdsByRef = new Map<string, string>();
    const addCard = (cardId: string, description: string) => {
      const ref = `c${candidates.length + 1}`;
      candidates.push({ ref, description, objectId: createPublicObjectId(cardId) });
      cardIdsByRef.set(ref, cardId);
    };
    for (const cardId of initiallySetIds) {
      const front = cardFront(cardId);
      // A kept LIVE stays in the same merged all-or-nothing judgment as any newly set LIVE;
      // members already set do not participate, so only tag the LIVE keeps.
      const keepTag =
        front.cardType === CardType.LIVE ? '；保留的 LIVE 仍并入本轮合并判定（全成或全败）' : '';
      addCard(cardId, `保留本次已盖牌 ${describeAiCardIdentity(front)}；仍作为最终盖牌${keepTag}`);
    }
    if (enabled(GameCommandType.SET_LIVE_CARD))
      for (const cardId of player.hand.cardIds)
        addCard(cardId, describeAiLiveSet(cardFront(cardId)));
    space = {
      kind: 'CARDS',
      candidates,
      min: 0,
      max: Math.min(setLimit, candidates.length),
      ordered: false,
    };
    const subPhase = game.currentSubPhase;
    toCommands = (selection, timestamp) => {
      validateSelection(space, selection);
      if (selection.kind !== 'CARDS') throw new Error('Invalid LIVE set selection');
      const selectedRefs = new Set(selection.cardRefs);
      const selectedCardIds = new Set(selection.cardRefs.map((ref) => cardIdsByRef.get(ref)!));
      return [
        ...initiallySetIds
          .filter((cardId) => !selectedCardIds.has(cardId))
          .map((cardId): GameCommand => ({
            type: GameCommandType.UNSET_LIVE_CARD,
            playerId,
            timestamp,
            cardId,
          })),
        ...candidates
          .filter(
            (candidate) =>
              selectedRefs.has(candidate.ref) && !initiallySet.has(cardIdsByRef.get(candidate.ref)!)
          )
          .map((candidate): GameCommand => ({
            type: GameCommandType.SET_LIVE_CARD,
            playerId,
            timestamp,
            cardId: cardIdsByRef.get(candidate.ref)!,
            faceDown: true,
          })),
        {
          type: GameCommandType.CONFIRM_STEP,
          playerId,
          timestamp,
          subPhase,
        },
      ];
    };
  } else if (enabled(GameCommandType.SELECT_SUCCESS_LIVE)) {
    purpose = 'SUCCESS_LIVE';
    for (const cardId of getSuccessLiveSelectionCandidateIds(game, playerId)) {
      const objectId = createPublicObjectId(cardId);
      if (!view.match.liveResult?.successLiveSelection?.candidateObjectIds.includes(objectId))
        return { kind: 'UNSUPPORTED', reason: 'Success LIVE candidate is not projected' };
      addAction(
        { description: `放置入成功 LIVE 区：${cardName(cardId)}`, objectId },
        { type: GameCommandType.SELECT_SUCCESS_LIVE, cardId }
      );
    }
    if (view.match.liveResult?.successLiveSelection?.canSkipToWaitingRoom)
      return {
        kind: 'UNSUPPORTED',
        reason: 'Optional success LIVE skip is outside the fixed RULES match',
      };
    if (candidates.length === 0)
      return { kind: 'UNSUPPORTED', reason: 'Success LIVE selection has no candidates' };
    space = { kind: 'ACTION', candidates };
  } else if (enabled(GameCommandType.SUBMIT_JUDGMENT) && !enabled(GameCommandType.CONFIRM_STEP)) {
    purpose = 'RULE_CONFIRM';
    addAction(
      { description: '提交当前规则自动判定' },
      { type: GameCommandType.SUBMIT_JUDGMENT, judgmentResults: new Map() }
    );
    space = { kind: 'ACTION', candidates };
  } else if (enabled(GameCommandType.SUBMIT_SCORE)) {
    if (view.match.liveResult?.confirmedSeats.includes(view.match.viewerSeat))
      return { kind: 'WAITING_FOR_PLAYER' };
    purpose = 'RULE_CONFIRM';
    addAction({ description: '确认当前规则得分' }, { type: GameCommandType.SUBMIT_SCORE });
    space = { kind: 'ACTION', candidates };
  } else if (enabled(GameCommandType.CONFIRM_STEP)) {
    purpose = 'RULE_CONFIRM';
    addAction(
      { description: '继续当前规则步骤' },
      { type: GameCommandType.CONFIRM_STEP, subPhase: game.currentSubPhase }
    );
    space = { kind: 'ACTION', candidates };
  } else {
    const hasInput = view.permissions.availableCommands.some(
      (hint) => hint.enabled && hint.command !== GameCommandType.SURRENDER
    );
    return hasInput
      ? {
          kind: 'UNSUPPORTED',
          reason: `Unadapted window: ${game.currentPhase}/${game.currentSubPhase}`,
        }
      : { kind: 'WAITING_FOR_PLAYER' };
  }

  const input = createDecisionInput(game, view, purpose, space);
  return {
    kind: 'DECISION',
    decision: {
      input,
      ...(toCommands ? { toCommands } : {}),
      toCommand(selection, timestamp) {
        validateSelection(space, selection);
        if (toCommands) {
          const batch = toCommands(selection, timestamp);
          if (batch.length !== 1) throw new Error('LIVE_SET selection requires batch submission');
          return batch[0]!;
        }
        if (selection.kind === 'ACTION')
          return { ...commands.get(selection.actionRef)!, playerId, timestamp } as GameCommand;
        return {
          type: GameCommandType.MULLIGAN,
          playerId,
          timestamp,
          cardIdsToMulligan: selection.cardRefs.map((ref) => mulliganIds.get(ref)!),
        };
      },
    },
  };
}

function createDecisionInput(
  game: GameState,
  view: PlayerViewState,
  purpose: AiDecisionInput['purpose'],
  space: AiDecisionSpace
): AiDecisionInput {
  const selfResources = summarizeAiSelfResources(view, view.match.viewerSeat);
  const candidates = space.candidates.map((candidate) => {
    const front = candidate.objectId ? view.objects[candidate.objectId]?.frontInfo : undefined;
    const liveBaseBudget = front ? summarizeAiLiveBaseBudget(selfResources, front) : undefined;
    return liveBaseBudget ? { ...candidate, liveBaseBudget } : candidate;
  });
  const selfId = view.match.participants[view.match.viewerSeat].id;
  const setCount = getLiveSetCardCountForPlayer(game, selfId);
  const setLimit = getLiveSetCardLimitForPlayer(game, selfId);
  return globalThis.structuredClone({
    state: {
      turn: game.turnCount,
      phase: game.currentPhase,
      subPhase: game.currentSubPhase,
      selfSeat: view.match.viewerSeat,
      firstSeat: view.match.firstSeat,
      activeSeat: view.match.activeSeat,
      selfResources,
      ...buildModelVisibleTable(view),
      ...(view.match.liveResult ? { liveResult: view.match.liveResult } : {}),
    },
    purpose,
    ...(purpose === 'LIVE_SET'
      ? {
          liveSet: {
            selectionMode: 'FINAL_SET_AND_CONFIRM',
            setCardObjectIds: getLiveSetCardIdsForPlayer(game, selfId)
              .map(createPublicObjectId)
              .filter((id) => view.objects[id]?.surface === 'FRONT'),
            setCount,
            setLimit,
            drawCountRule: 'FINAL_SET_COUNT',
          },
        }
      : {}),
    ...(view.activeEffect
      ? {
          effect: {
            effectText: view.activeEffect.effectText,
            stepText: view.activeEffect.stepText,
            selectionLabel: view.activeEffect.selectionLabel,
            ...(view.objects[view.activeEffect.sourceObjectId]?.surface === 'FRONT'
              ? { sourceObjectId: view.activeEffect.sourceObjectId }
              : {}),
            sourceCardDisplayCode: view.activeEffect.sourceCardDisplayCode,
          },
        }
      : {}),
    space: { ...space, candidates },
    responseSchema: responseSchema(space),
  });
}

/** UI projections may retain facedown instance IDs for rendering; those do not identify model facts. */
function buildModelVisibleTable(view: PlayerViewState): Pick<PlayerViewState, 'table' | 'objects'> {
  const objects = Object.fromEntries(
    Object.entries(view.objects).filter(([, card]) => card.surface === 'FRONT')
  );
  const zones = Object.fromEntries(
    Object.entries(view.table.zones).map(([key, zone]) => [
      key,
      {
        ...zone,
        ...(zone.objectIds
          ? { objectIds: zone.objectIds.filter((id) => objects[id] !== undefined) }
          : {}),
      },
    ])
  );
  return { objects, table: { zones: zones as PlayerViewState['table']['zones'] } };
}
