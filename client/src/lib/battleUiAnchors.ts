export const BATTLE_UI_ANCHOR_ATTRIBUTE = 'data-battle-ui-anchor';
export const BATTLE_UI_OBJECT_ATTRIBUTE = 'data-battle-ui-object-id';

export const BATTLE_UI_ANCHORS = {
  BOARD: 'battle-board',
  SELF_AREA: 'self-area',
  OPPONENT_AREA: 'opponent-area',
  SELF_HAND: 'self-hand',
  OPPONENT_HAND: 'opponent-hand',
  SELF_MAIN_DECK: 'self-main-deck',
  OPPONENT_MAIN_DECK: 'opponent-main-deck',
  SELF_ENERGY_DECK: 'self-energy-deck',
  OPPONENT_ENERGY_DECK: 'opponent-energy-deck',
  SELF_ENERGY_ZONE: 'self-energy-zone',
  OPPONENT_ENERGY_ZONE: 'opponent-energy-zone',
  SELF_WAITING_ROOM: 'self-waiting-room',
  OPPONENT_WAITING_ROOM: 'opponent-waiting-room',
  SELF_STAGE_LEFT: 'self-stage-left',
  SELF_STAGE_CENTER: 'self-stage-center',
  SELF_STAGE_RIGHT: 'self-stage-right',
  OPPONENT_STAGE_LEFT: 'opponent-stage-left',
  OPPONENT_STAGE_CENTER: 'opponent-stage-center',
  OPPONENT_STAGE_RIGHT: 'opponent-stage-right',
  SELF_LIVE_ZONE: 'self-live-zone',
  OPPONENT_LIVE_ZONE: 'opponent-live-zone',
  SELF_SUCCESS_LIVE_ZONE: 'self-success-live-zone',
  OPPONENT_SUCCESS_LIVE_ZONE: 'opponent-success-live-zone',
  MULLIGAN_PANEL: 'mulligan-panel',
  MULLIGAN_CARDS: 'mulligan-cards',
  MULLIGAN_CONFIRM: 'mulligan-confirm',
  PHASE_CONTROLS: 'phase-controls',
  PHASE_PRIMARY_ACTION: 'phase-primary-action',
  JUDGMENT_PANEL: 'judgment-panel',
  JUDGMENT_CHEER_CARDS: 'judgment-cheer-cards',
  JUDGMENT_SUMMARY: 'judgment-summary',
  AUTOMATIC_JUDGMENT_CONFIRM: 'automatic-judgment-confirm',
  SCORE_CONFIRM: 'score-confirm',
  SCORE_CONFIRM_ACTION: 'score-confirm-action',
  RESULT_ANIMATION: 'result-animation',
  RESULT_ANIMATION_CONFIRM: 'result-animation-confirm',
  SUCCESS_LIVE_SELECTION: 'success-live-selection',
  SUCCESS_LIVE_CANDIDATES: 'success-live-candidates',
  ACTIVE_EFFECT_PANEL: 'active-effect-panel',
  ACTIVE_EFFECT_SELECTION: 'active-effect-selection',
  ACTIVE_EFFECT_CONFIRM: 'active-effect-confirm',
  ACTIVATED_ABILITY_MENU: 'activated-ability-menu',
} as const;

export type BattleUiAnchorId = (typeof BATTLE_UI_ANCHORS)[keyof typeof BATTLE_UI_ANCHORS];

type BattlePlayerSide = 'self' | 'opponent';
type BattleDeckKind = 'main' | 'energy';
type BattleStagePosition = 'left' | 'center' | 'right';

export function getBattlePlayerAreaAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self' ? BATTLE_UI_ANCHORS.SELF_AREA : BATTLE_UI_ANCHORS.OPPONENT_AREA;
}

export function getBattleHandAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self' ? BATTLE_UI_ANCHORS.SELF_HAND : BATTLE_UI_ANCHORS.OPPONENT_HAND;
}

export function getBattleDeckAnchor(
  side: BattlePlayerSide,
  deckKind: BattleDeckKind
): BattleUiAnchorId {
  if (side === 'self') {
    return deckKind === 'main'
      ? BATTLE_UI_ANCHORS.SELF_MAIN_DECK
      : BATTLE_UI_ANCHORS.SELF_ENERGY_DECK;
  }
  return deckKind === 'main'
    ? BATTLE_UI_ANCHORS.OPPONENT_MAIN_DECK
    : BATTLE_UI_ANCHORS.OPPONENT_ENERGY_DECK;
}

export function getBattleEnergyZoneAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self'
    ? BATTLE_UI_ANCHORS.SELF_ENERGY_ZONE
    : BATTLE_UI_ANCHORS.OPPONENT_ENERGY_ZONE;
}

export function getBattleWaitingRoomAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self'
    ? BATTLE_UI_ANCHORS.SELF_WAITING_ROOM
    : BATTLE_UI_ANCHORS.OPPONENT_WAITING_ROOM;
}

export function getBattleStageAnchor(
  side: BattlePlayerSide,
  position: BattleStagePosition
): BattleUiAnchorId {
  return `${side}-stage-${position}` as BattleUiAnchorId;
}

export function getBattleLiveZoneAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self' ? BATTLE_UI_ANCHORS.SELF_LIVE_ZONE : BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE;
}

export function getBattleSuccessLiveZoneAnchor(side: BattlePlayerSide): BattleUiAnchorId {
  return side === 'self'
    ? BATTLE_UI_ANCHORS.SELF_SUCCESS_LIVE_ZONE
    : BATTLE_UI_ANCHORS.OPPONENT_SUCCESS_LIVE_ZONE;
}
