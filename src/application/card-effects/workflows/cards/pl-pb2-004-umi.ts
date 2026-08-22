import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import { and, groupAliasIs, hasScoreBladeHeart } from '../../../effects/card-selectors.js';
import { PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID } from '../../ability-ids.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const MUSE = "μ's";
const scoreMuseCard = and(groupAliasIs(MUSE), hasScoreBladeHeart());

export function registerPlPb2004UmiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlPb2004UmiOnCheer(game, ability, options, context.continuePendingCardEffects)
  );
}

function resolvePlPb2004UmiOnCheer(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        step: 'SOURCE_NOT_ON_STAGE',
        sourceSlot,
      }
    );
  }

  const cheerEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!cheerEvent) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
        sourceSlot,
      }
    );
  }

  const matchingCardIds = cheerEvent.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && scoreMuseCard(card);
  });
  const additionalCheerCount = matchingCardIds.length;
  const resultText =
    additionalCheerCount > 0
      ? `（本次普通声援公开了${additionalCheerCount}张符合条件的卡片，因此追加声援${additionalCheerCount}张。）`
      : '（本次普通声援公开的卡片中没有符合条件的卡片，因此不追加声援。）';
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
    game,
    ability,
    {
      ...options,
      // ON_CHEER 同样是 queued 自动能力：单个／手动结算先展示动态计数，
      // ordered batch 则遵守玩家已确认的连续结算语义。
      confirmBeforeResolution:
        options.confirmBeforeResolution === true || options.orderedResolution !== true,
    },
    {
      effectText: `${getAbilityEffectText(ability.abilityId)}\n\n${resultText}`,
      stepText:
        additionalCheerCount > 0
          ? `确认后追加声援${additionalCheerCount}张。`
          : '确认后结算此效果，本次不追加声援。',
    }
  );
  if (confirmation) {
    return confirmation;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    pendingAbilityId: ability.id,
  });
  state = removePendingAbility(state, ability.id);

  const cheerResult =
    additionalCheerCount > 0
      ? revealCheerCardsFromMainDeck(state, player.id, additionalCheerCount, {
          automated: true,
          additional: true,
        })
      : { gameState: state, cheerCardIds: [] as readonly string[] };
  state = cheerResult.gameState;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'COUNT_MUSE_SCORE_CARDS_AND_ADDITIONAL_CHEER',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      matchingCardIds,
      requestedAdditionalCheerCount: additionalCheerCount,
      additionalCheerCardIds: cheerResult.cheerCardIds,
      actualAdditionalCheerCount: cheerResult.cheerCardIds.length,
    }),
    options.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
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
