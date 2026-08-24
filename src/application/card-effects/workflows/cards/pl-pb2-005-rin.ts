import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { getOwnedSuccessfulGroupScoreCardIds } from '../../../../domain/rules/success-zone-card-queries.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const MUSE = "μ's";

export function registerPlPb2005RinWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlPb2005RinOnEnter(game, ability, options, context.continuePendingCardEffects)
  );
}

function resolvePlPb2005RinOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceOnStage = player
    ? getAllMemberCardIds(player.memberSlots).includes(ability.sourceCardId)
    : false;
  const legalSource = Boolean(
    player &&
    sourceCard &&
    sourceCard.ownerId === player.id &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-pb2-005') &&
    sourceOnStage
  );
  if (!player || !legalSource) {
    return finishPendingAbility(
      game,
      ability,
      player?.id ?? null,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
        sourceOnStage,
        legalSource,
        qualifyingSuccessCardIds: [],
        conditionMet: false,
        bladeBonus: 0,
      }
    );
  }

  const qualifyingSuccessCardIds = getOwnedSuccessfulGroupScoreCardIds(game, player.id, MUSE);
  const conditionMet = qualifyingSuccessCardIds.length > 0;
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
    game,
    ability,
    {
      ...options,
      confirmBeforeResolution:
        options.confirmBeforeResolution === true || options.orderedResolution !== true,
    },
    {
      effectText: `${getAbilityEffectText(
        ability.abilityId
      )}\n\n（当前自己的成功LIVE卡区有${qualifyingSuccessCardIds.length}张符合条件的卡片，条件${
        conditionMet ? '满足' : '未满足'
      }；实际${conditionMet ? '自己舞台上的『μ’s』成员各获得[ブレード]' : '不获得[ブレード]'}。）`,
      stepText: conditionMet
        ? '确认后，自己舞台上的『μ’s』成员各获得[ブレード]。'
        : '确认后结算此效果，本次不获得[ブレード]。',
    }
  );
  if (confirmation) {
    return confirmation;
  }

  const stateWithoutPending = removePendingAbility(game, ability.id);
  const bladeResult = conditionMet
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 1,
      })
    : null;

  return continuePendingCardEffects(
    addAction(bladeResult?.gameState ?? stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: bladeResult ? 'GAIN_MUSE_STAGE_BLADE_AURA' : 'CONDITION_NOT_MET',
      sourceOnStage,
      legalSource,
      qualifyingSuccessCardIds,
      conditionMet,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    options.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string | null,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
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
