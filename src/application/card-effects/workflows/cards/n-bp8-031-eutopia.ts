import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addPlayerScoreLiveModifierForTargetMember,
  collectLiveModifiers,
  selectUniqueStageMemberWithMostEffectiveHearts,
} from '../../../../domain/rules/live-modifiers.js';
import { N_BP8_031_LIVE_SUCCESS_MOST_HEART_MEMBER_GAIN_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

export function registerNBp8031EutopiaWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) => {
      // Eligibility is captured at resolution, not when the LIVE succeeded or the preview opened.
      const recipient = getRecipient(game);
      let state: GameState = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
      };
      const granted = recipient
        ? addPlayerScoreLiveModifierForTargetMember(state, {
            playerId: recipient.playerId,
            targetMemberCardId: recipient.memberCardId,
            sourceCardId: ability.sourceCardId,
            abilityId: ABILITY_ID,
            countDelta: 1,
          })
        : null;
      let scoreDelta = 0;
      if (granted && recipient) {
        state = granted.gameState;
        if (hasSuccessfulLive(state, recipient.playerId)) {
          // Result-phase drafts are authoritative and may contain a player's manual adjustment.
          // Merely adding a modifier does not refresh those drafts or the eventual winner.
          const playerScores = new Map(state.liveResolution.playerScores);
          playerScores.set(recipient.playerId, (playerScores.get(recipient.playerId) ?? 0) + 1);
          state = { ...state, liveResolution: { ...state.liveResolution, playerScores } };
          scoreDelta = 1;
        }
      }
      return context.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'GRANT_MOST_HEART_MEMBER_TOTAL_SCORE',
          targetMemberCardId: recipient?.memberCardId ?? null,
          targetPlayerId: recipient?.playerId ?? null,
          heartCount: recipient?.heartCount ?? null,
          granted: granted !== null,
          actualScoreDelta: scoreDelta,
        }),
        options.orderedResolution === true
      );
    },
    (game, _ability: PendingAbilityState) => {
      const recipient = getRecipient(game);
      const card = recipient ? getCardById(game, recipient.memberCardId) : null;
      const stepText =
        recipient && card
          ? `当前HEART唯一最多的成员是「${card.data.name}」（${recipient.heartCount}个HEART），将获得常时LIVE合计分数＋1。${hasSuccessfulLive(game, recipient.playerId) ? '该成员所属玩家本次LIVE合计分数＋1。' : '该成员所属玩家当前没有成功的LIVE，本能力不增加其本次LIVE合计分数。'}`
          : '当前双方舞台没有HEART数量严格多于所有其他成员的成员，本次不授予能力。';
      return { effectText: `${getAbilityEffectText(ABILITY_ID)}（${stepText}）`, stepText };
    }
  );
}

function getRecipient(game: GameState) {
  return selectUniqueStageMemberWithMostEffectiveHearts(game, collectLiveModifiers(game));
}

function hasSuccessfulLive(game: GameState, playerId: string): boolean {
  // Moving a successful LIVE afterwards does not erase this LIVE's result or score draft.
  return [...game.liveResolution.liveResults].some(([id, success]) => {
    const card = getCardById(game, id);
    return success === true && card?.ownerId === playerId && isLiveCardData(card.data);
  });
}
