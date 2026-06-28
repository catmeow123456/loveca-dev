import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID } from '../../ability-ids.js';

const SELECT_NIJIGASAKI_MEMBER_STEP_ID = 'PL_N_BP4_029_SELECT_NIJIGASAKI_MEMBER_BLADE_TARGET';
const SCORE_BONUS = 1;
const BLADE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

export function registerNBp4029RiseUpHighWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startRiseUpHighLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    SELECT_NIJIGASAKI_MEMBER_STEP_ID,
    (game, input, context) =>
      finishRiseUpHighBladeTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startRiseUpHighLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const firstTurnLivePhase = game.turnCount === 1 && sourceInLiveZone;
  if (!firstTurnLivePhase) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_FIRST_TURN_LIVE_PHASE',
        turnCount: game.turnCount,
        sourceInLiveZone,
      }),
      orderedResolution
    );
  }

  const stateAfterScore = addScoreModifierAndRefresh(stateWithoutPending, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    scoreBonus: SCORE_BONUS,
  });
  const targetMemberCardIds = getNijigasakiStageMemberCardIds(stateAfterScore, player.id);

  if (targetMemberCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SCORE_NO_NIJIGASAKI_MEMBER_TARGET',
        scoreBonus: SCORE_BONUS,
        targetMemberCardIds,
      }),
      orderedResolution
    );
  }

  if (targetMemberCardIds.length === 1) {
    return applyBladeAndContinue(
      stateAfterScore,
      ability,
      player.id,
      targetMemberCardIds[0],
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'SCORE_AUTO_TARGET_NIJIGASAKI_MEMBER_BLADE',
        scoreBonus: SCORE_BONUS,
      }
    );
  }

  return addAction(
    {
      ...stateAfterScore,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_NIJIGASAKI_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上1名「虹ヶ咲」成员获得 BLADE。',
        awaitingPlayerId: player.id,
        selectableCardIds: targetMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得 BLADE 的虹咲成员',
        confirmSelectionLabel: '获得 BLADE',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          scoreBonus: SCORE_BONUS,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SCORE_SELECT_NIJIGASAKI_MEMBER_BLADE',
      scoreBonus: SCORE_BONUS,
      selectableCardIds: targetMemberCardIds,
    }
  );
}

function finishRiseUpHighBladeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getNijigasakiStageMemberCardIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_NIJIGASAKI_MEMBER_GAIN_BLADE',
      scoreBonus: getNumberMetadata(effect, 'scoreBonus') ?? SCORE_BONUS,
      targetMemberCardId: selectedCardId,
      bladeBonus: BLADE_BONUS,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function applyBladeAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  targetMemberCardId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId,
    sourceCardId: targetMemberCardId,
    abilityId: ability.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
      targetMemberCardId,
      bladeBonus: BLADE_BONUS,
    }),
    orderedResolution
  );
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}

function getNijigasakiStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data) && cardBelongsToGroup(card.data, '虹ヶ咲');
  });
}

function addScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: options.playerId,
    countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };
  return refreshPlayerScoreDraft(
    addLiveModifier(game, modifier),
    options.playerId,
    options.scoreBonus
  );
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function getNumberMetadata(
  effect: { readonly metadata?: Readonly<Record<string, unknown>> },
  key: string
): number | null {
  const value = effect.metadata?.[key];
  return typeof value === 'number' ? value : null;
}
