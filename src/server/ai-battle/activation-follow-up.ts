import { GameCommandType } from '../../application/game-commands.js';
import { queryActivatedAbilityResources } from '../../application/card-effects/runtime/ability-resource-query.js';
import type { GameState } from '../../domain/entities/game.js';
import { createPublicObjectId } from '../../online/projector.js';
import type { PlayerViewState } from '../../online/types.js';
import { buildAiEffectDecision } from './effect-decision.js';
import { validateSelection, type AiActivationFollowUp, type AiSelection } from './protocol.js';

/** No effect execution or hidden-card projection. The workflow owns the immediate-choice contract. */
export function queryAiActivationFollowUps(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  view: PlayerViewState,
  abilityInstanceId?: string
): readonly { targetObjectId: string; followUp: AiActivationFollowUp }[] {
  const facts = queryActivatedAbilityResources(game, playerId, sourceCardId, abilityId);
  const choice = facts?.immediateSelection;
  if (!facts || !choice || choice.max !== 1 || choice.min > 1) return [];
  const targetObjectIds = facts.targetCardIds.map(createPublicObjectId);
  if (targetObjectIds.some((id) => view.objects[id]?.surface !== 'FRONT')) return [];
  const knownFaces = new Set(
    Object.values(view.objects)
      .filter((card) => card.surface === 'FRONT')
      .map((card) => card.publicObjectId)
  );
  // Comparing public zone counts catches draws/refreshes without inspecting deck order or faces.
  const deckCounts = Object.entries(view.table.zones)
    .filter(([, zone]) => zone.zone === 'MAIN_DECK')
    .map(([key, zone]) => [key, zone.count] as const);
  const hand = view.table.zones[`${view.match.viewerSeat}_HAND`]?.objectIds ?? [];
  const pending = JSON.stringify(game.pendingAbilities);
  const turn = game.turnCount;
  const phase = game.currentPhase;
  const subPhase = game.currentSubPhase;
  const matchId = game.gameId;
  const seat = view.match.viewerSeat;

  return targetObjectIds.map((targetObjectId) => ({
    targetObjectId,
    followUp: {
      resolve(after, nextView, timestamp) {
        const requery = (reason: string) => ({ kind: 'REQUERY' as const, reason });
        const effect = after.activeEffect;
        const visible = nextView.activeEffect;
        if (
          after.isEnded ||
          after.gameId !== matchId ||
          nextView.match.matchId !== matchId ||
          nextView.match.viewerSeat !== seat ||
          nextView.match.participants[seat].id !== playerId ||
          after.turnCount !== turn ||
          after.currentPhase !== phase ||
          after.currentSubPhase !== subPhase ||
          effect?.controllerId !== playerId ||
          effect.sourceCardId !== sourceCardId ||
          effect.abilityId !== abilityId ||
          effect.stepId !== choice.stepId ||
          effect.abilityInstanceId !== abilityInstanceId ||
          visible?.id !== effect.id ||
          visible.waitingSeat !== seat ||
          !nextView.permissions.availableCommands.some(
            (hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP && hint.enabled
          )
        )
          return requery('WINDOW_CHANGED');
        if (JSON.stringify(after.pendingAbilities) !== pending) return requery('TRIGGERS_CHANGED');
        if (
          after.pendingCostPayment ||
          after.pendingSpecialMemberPlay ||
          after.inspectionContext ||
          visible.publicRevealAutoAdvanceAt !== undefined ||
          visible.publicCardSelectionAutoAdvanceAt !== undefined ||
          visible.publicEffectChoiceAutoAdvanceAt !== undefined
        )
          return requery('INTERVENING_WINDOW');
        if (
          Object.values(nextView.objects).some(
            (card) => card.surface === 'FRONT' && !knownFaces.has(card.publicObjectId)
          ) ||
          JSON.stringify(nextView.table.zones[`${seat}_HAND`]?.objectIds ?? []) !==
            JSON.stringify(hand) ||
          deckCounts.some(
            ([key, count]) =>
              nextView.table.zones[key as keyof typeof nextView.table.zones]?.count !== count
          )
        )
          return requery('NEW_INFORMATION');
        const actual = buildAiEffectDecision(after, playerId, nextView);
        if ('reason' in actual) return requery('UNSUPPORTED_SELECTION');
        const space = actual.space;
        if (
          actual.purpose !== 'EFFECT' ||
          space.kind !== 'CARDS' ||
          space.ordered ||
          space.groups ||
          space.min !== choice.min ||
          space.max !== choice.max ||
          Boolean(space.canSkip) !== choice.canSkip ||
          space.candidates.length !== targetObjectIds.length ||
          space.candidates.some(
            (candidate) => !candidate.objectId || !targetObjectIds.includes(candidate.objectId)
          )
        )
          return requery('TARGETS_OR_CONSTRAINTS_CHANGED');
        const target = space.candidates.find((candidate) => candidate.objectId === targetObjectId);
        if (!target) return requery('TARGET_MISSING');
        const selection: AiSelection = { kind: 'CARDS', cardRefs: [target.ref] };
        validateSelection(space, selection);
        return { kind: 'READY', selection, command: actual.toCommand(selection, timestamp) };
      },
    },
  }));
}
