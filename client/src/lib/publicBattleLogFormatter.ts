import type { AnyCardData } from '@game/domain/entities/card';
import { ZoneType } from '@game/shared/types/enums';
import type { PublicCardInfo, PublicEvent, PublicZoneRef, Seat } from '@game/online';
import { getCardLocalizedInfo } from './cardLocalization';

export type PublicBattleLogFilter = 'KEY' | 'ALL';

export interface PublicBattleLogCardView {
  readonly publicObjectId: string;
  readonly cardCode: string;
  readonly label: string;
}

export interface PublicBattleLogEventView {
  readonly id: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly type: PublicEvent['type'];
  readonly keyEvent: boolean;
  readonly title: string;
  readonly detail: string | null;
  readonly actorLabel: string;
  readonly cards: readonly PublicBattleLogCardView[];
}

export function isKeyPublicBattleLogEvent(event: PublicEvent): boolean {
  return (
    event.type === 'CardMovedPublic' ||
    event.type === 'CardRevealed' ||
    event.type === 'CardRevealedAndMoved' ||
    event.type === 'CardsInspectedSummary' ||
    event.type === 'DeckRefreshed'
  );
}

export function formatPublicBattleLogEvent(
  event: PublicEvent,
  options: {
    readonly getCardData: (cardCode: string) => AnyCardData | undefined;
    readonly getSeatLabel: (seat: Seat) => string;
  }
): PublicBattleLogEventView {
  const actorLabel = event.actorSeat ? options.getSeatLabel(event.actorSeat) : 'SYSTEM';
  const cards = getEventCards(event).map((card) => formatPublicCard(card, options.getCardData));
  const keyEvent = isKeyPublicBattleLogEvent(event);

  switch (event.type) {
    case 'CardMovedPublic': {
      const count = event.card ? 1 : (event.count ?? 1);
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${actorLabel} 将 ${count} 张卡从${formatZoneRef(event.from)}移动到${formatZoneRef(
          event.to
        )}`,
        detail: event.card ? null : '未公开具体卡牌身份',
        cards,
      };
    }
    case 'CardRevealed':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${actorLabel} 公开 1 张卡`,
        detail: formatZoneDetail(event.from),
        cards,
      };
    case 'CardRevealedAndMoved':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${actorLabel} 公开并将 1 张卡从${formatZoneRef(
          event.from
        )}移动到${formatZoneRef(event.to)}`,
        detail: null,
        cards,
      };
    case 'CardsInspectedSummary':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${event.ownerSeat ? options.getSeatLabel(event.ownerSeat) : actorLabel} 检视 ${
          event.count
        } 张卡`,
        detail: `来源：${formatZoneName(event.sourceZone)}`,
        cards,
      };
    case 'DeckRefreshed':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${options.getSeatLabel(event.ownerSeat)} 牌库刷新`,
        detail: `休息室 ${event.movedCount} 张洗入主卡组，刷新后主卡组 ${event.mainDeckCountAfter} 张`,
        cards,
      };
    case 'PhaseStarted':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `进入${event.phase}阶段`,
        detail: event.activeSeat ? `行动玩家：${options.getSeatLabel(event.activeSeat)}` : null,
        cards,
      };
    case 'SubPhaseStarted':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `进入${event.subPhase}`,
        detail: event.activeSeat ? `行动玩家：${options.getSeatLabel(event.activeSeat)}` : null,
        cards,
      };
    case 'WindowStatusChanged':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `窗口${event.status}`,
        detail: event.windowType ?? '无窗口',
        cards,
      };
    case 'PlayerDeclared':
      return {
        id: event.eventId,
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        keyEvent,
        actorLabel,
        title: `${actorLabel} 宣言 ${event.declarationType}`,
        detail:
          event.publicValue === undefined || event.publicValue === null
            ? null
            : String(event.publicValue),
        cards,
      };
  }
}

function getEventCards(event: PublicEvent): readonly PublicCardInfo[] {
  if (event.type === 'CardMovedPublic') {
    return event.card ? [event.card] : [];
  }
  if (event.type === 'CardRevealed' || event.type === 'CardRevealedAndMoved') {
    return [event.card];
  }
  return [];
}

function formatPublicCard(
  card: PublicCardInfo,
  getCardData: (cardCode: string) => AnyCardData | undefined
): PublicBattleLogCardView {
  const data = getCardData(card.cardCode);
  const name = data ? getCardLocalizedInfo(data).displayNameCn : '未收录卡牌';
  return {
    publicObjectId: card.publicObjectId,
    cardCode: card.cardCode,
    label: `${card.cardCode}「${name}」`,
  };
}

function formatZoneDetail(ref?: PublicZoneRef): string | null {
  return ref ? `来源：${formatZoneRef(ref)}` : null;
}

function formatZoneRef(ref?: PublicZoneRef): string {
  if (!ref) {
    return '未知区域';
  }
  const owner = ref.ownerSeat ? `${ref.ownerSeat} ` : '';
  return `${owner}${formatZoneName(ref.zone)}`;
}

function formatZoneName(zone: string): string {
  switch (zone) {
    case ZoneType.HAND:
      return '手牌';
    case ZoneType.MAIN_DECK:
      return '主卡组';
    case ZoneType.ENERGY_DECK:
      return '能量卡组';
    case ZoneType.MEMBER_SLOT:
      return '成员区';
    case ZoneType.ENERGY_ZONE:
      return '能量区';
    case ZoneType.LIVE_ZONE:
      return 'LIVE 区';
    case ZoneType.SUCCESS_ZONE:
      return '成功 LIVE 区';
    case ZoneType.WAITING_ROOM:
      return '休息室';
    case ZoneType.EXILE_ZONE:
      return '移除区';
    case ZoneType.RESOLUTION_ZONE:
      return '解决区';
    case ZoneType.INSPECTION_ZONE:
      return '检视区';
    default:
      return zone;
  }
}
