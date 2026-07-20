import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP7_027_LIVE_SUCCESS_SELECT_NIJIGASAKI_HIGHEST_BLADE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_BP7_027_LIVE_SUCCESS_SELECT_NIJIGASAKI_HIGHEST_BLADE_SCORE_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!N-bp7-027-L';
const SELECT_MEMBER_STEP_ID = 'N_BP7_027_SELECT_NIJIGASAKI_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface BladeComparisonFact {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly blade: number;
}

interface BladeEvaluation {
  readonly targetMemberCardId: string;
  readonly targetBlade: number;
  readonly ownOtherMembers: readonly BladeComparisonFact[];
  readonly opponentMembers: readonly BladeComparisonFact[];
  readonly conditionMet: boolean;
}

type AbilityResolutionContext = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
>;

export function registerNBp7027AudreyWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startAudrey(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MEMBER_STEP_ID, (game, input, context) =>
    finishAudreySelection(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startAudrey(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending = removePendingAbility(game, ability.id);
  if (!isValidSourceLive(stateWithoutPending, ability.controllerId, ability.sourceCardId)) {
    return resolveNoOp(
      stateWithoutPending,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'SOURCE_INVALID' }
    );
  }

  const candidateCardIds = getNijigasakiTargetIds(stateWithoutPending, ability.controllerId);
  if (candidateCardIds.length === 0) {
    return resolveNoOp(
      stateWithoutPending,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'NO_NIJIGASAKI_STAGE_MEMBER', selectableCardIds: [] }
    );
  }
  if (candidateCardIds.length === 1) {
    return evaluateAndResolve(
      stateWithoutPending,
      ability,
      candidateCardIds[0]!,
      orderedResolution,
      continuePendingCardEffects,
      'AUTO_SELECT_MEMBER_AND_RESOLVE'
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上的1名『虹咲』成员，比较双方舞台成员的有效[BLADE]并结算。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要比较[BLADE]的『虹咲』成员',
        confirmSelectionLabel: '选择成员并结算',
        canSkipSelection: false,
        metadata: { orderedResolution },
      },
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_NIJIGASAKI_MEMBER',
      selectableCardIds: candidateCardIds,
    }
  );
}

function finishAudreySelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_MEMBER_STEP_ID) {
    return game;
  }
  if (selectedCardId === null || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  const ability: AbilityResolutionContext = {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
  };
  if (
    !isValidSourceLive(game, effect.controllerId, effect.sourceCardId) ||
    !getNijigasakiTargetIds(game, effect.controllerId).includes(selectedCardId)
  ) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'STALE_SOURCE_OR_TARGET',
        targetMemberCardId: selectedCardId,
        conditionMet: false,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  return evaluateAndResolve(
    { ...game, activeEffect: null },
    ability,
    selectedCardId,
    orderedResolution,
    continuePendingCardEffects,
    'SELECT_MEMBER_AND_RESOLVE'
  );
}

function evaluateAndResolve(
  game: GameState,
  ability: AbilityResolutionContext,
  targetMemberCardId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const evaluation = evaluateBladeComparison(game, ability.controllerId, targetMemberCardId);
  const scoreBonus = evaluation.conditionMet ? 1 : 0;
  const stateAfterScore = replaceScoreModifierAndRefresh(game, ability, scoreBonus);
  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      targetMemberCardId,
      targetBlade: evaluation.targetBlade,
      ownOtherMembers: evaluation.ownOtherMembers,
      opponentMembers: evaluation.opponentMembers,
      conditionMet: evaluation.conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function evaluateBladeComparison(
  game: GameState,
  controllerId: string,
  targetMemberCardId: string
): BladeEvaluation {
  const modifiers = collectLiveModifiers(game);
  const targetBlade = getMemberEffectiveBladeCount(
    game,
    controllerId,
    targetMemberCardId,
    modifiers
  );
  const ownOtherMembers = getTopLevelMemberIds(game, controllerId)
    .filter((memberCardId) => memberCardId !== targetMemberCardId)
    .map((memberCardId) => ({
      playerId: controllerId,
      memberCardId,
      blade: getMemberEffectiveBladeCount(game, controllerId, memberCardId, modifiers),
    }));
  const opponentMembers = game.players
    .filter((player) => player.id !== controllerId)
    .flatMap((player) =>
      getTopLevelMemberIds(game, player.id).map((memberCardId) => ({
        playerId: player.id,
        memberCardId,
        blade: getMemberEffectiveBladeCount(game, player.id, memberCardId, modifiers),
      }))
    );
  return {
    targetMemberCardId,
    targetBlade,
    ownOtherMembers,
    opponentMembers,
    conditionMet: [...ownOtherMembers, ...opponentMembers].every(
      (fact) => targetBlade > fact.blade
    ),
  };
}

function getNijigasakiTargetIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'))
  ).filter((cardId) => getCardById(game, cardId)?.ownerId === playerId);
}

function getTopLevelMemberIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  ability: AbilityResolutionContext,
  scoreBonus: number
): GameState {
  const matches = (modifier: LiveModifierState) =>
    modifier.kind === 'SCORE' &&
    modifier.playerId === ability.controllerId &&
    modifier.liveCardId === ability.sourceCardId &&
    modifier.sourceCardId === ability.sourceCardId &&
    modifier.abilityId === ability.abilityId;
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(matches)
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: 1,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: ability.controllerId,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    replacement
  );
  const delta = scoreBonus - previousScoreBonus;
  if (delta === 0) return state;
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(ability.controllerId, (playerScores.get(ability.controllerId) ?? 0) + delta);
  return { ...state, liveResolution: { ...state.liveResolution, playerScores } };
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      conditionMet: false,
      scoreBonus: 0,
      ...payload,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
