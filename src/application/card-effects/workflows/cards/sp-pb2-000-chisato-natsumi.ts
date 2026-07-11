import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  groupAliasIs,
  hasBladeHeart,
} from '../../../effects/card-selectors.js';
import {
  addBladeLiveModifierForSourceMember,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2000ChisatoNatsumiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2000ChisatoNatsumiOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb2000ChisatoNatsumiOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const relayReplacementCardIds = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  if (relayReplacementCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'CHECK_RELAY_DRAW_AND_GAIN_BLADE',
        conditionMet: false,
        reason: 'NOT_RELAY',
        relayReplacementCardIds,
      },
      continuePendingCardEffects
    );
  }

  const checkedReplacements = relayReplacementCardIds.map((cardId) => {
    const card = getCardById(game, cardId);
    const inWaitingRoom = player.waitingRoom.cardIds.includes(cardId);
    const isLiellaMember =
      card !== null && inWaitingRoom && isMemberCardData(card.data) && groupAliasIs('Liella!')(card);
    const hasBladeHeartIcon = card !== null && hasBladeHeart()(card);
    return {
      cardId,
      inWaitingRoom,
      isLiellaMember,
      hasBladeHeart: hasBladeHeartIcon,
      countsForDraw: isLiellaMember,
      countsForBlade: isLiellaMember && !hasBladeHeartIcon,
    };
  });
  const liellaReplacementCardIds = checkedReplacements
    .filter((replacement) => replacement.countsForDraw)
    .map((replacement) => replacement.cardId);
  const noBladeHeartLiellaReplacementCardIds = checkedReplacements
    .filter((replacement) => replacement.countsForBlade)
    .map((replacement) => replacement.cardId);
  const drawCount = liellaReplacementCardIds.length;
  const bladeBonus = noBladeHeartLiellaReplacementCardIds.length * 2;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult =
    drawCount > 0 ? drawCardsForPlayer(stateWithoutPending, player.id, drawCount) : null;
  const stateAfterDraw = drawResult?.gameState ?? stateWithoutPending;
  const bladeResult =
    bladeBonus > 0
      ? addBladeLiveModifierForSourceMember(stateAfterDraw, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          amount: bladeBonus,
        })
      : null;
  const stateAfterBlade = bladeResult?.gameState ?? stateAfterDraw;

  return continuePendingCardEffects(
    addAction(stateAfterBlade, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'RELAY_DRAW_AND_GAIN_BLADE',
      conditionMet: true,
      relayReplacementCardIds,
      checkedReplacements,
      liellaReplacementCardIds,
      noBladeHeartLiellaReplacementCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      drawCount,
      bladeBonus,
    }),
    orderedResolution
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    return typeof cardId === 'string' ? [cardId] : [];
  });
}
