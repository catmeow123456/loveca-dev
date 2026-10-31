import type {
  LiveResultViewState,
  PlayerViewState,
  ViewBladeHeartItem,
  ViewCardObject,
  ViewFrontCardInfo,
} from '@game/online/types';
import { getCardLocalizedInfo } from './cardLocalization';
import { parseCardEffectText } from './cardEffectTokens';
import {
  getAdjustedLiveRequirements,
  getRequirementEntriesForDisplay,
} from './liveJudgmentPreview';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  ZoneType,
} from '@game/shared/types/enums';

/** Shared compact text for hand rows and authorized selection candidates. */
export function getExcelCardSummary(front: ViewFrontCardInfo) {
  const text = getCardLocalizedInfo(front);
  const effect = text.effectCn ?? text.effectJp;
  const live = front.cardType === CardType.LIVE;
  return {
    name: text.nameCn ?? text.nameJp ?? front.cardCode,
    effect,
    preview: effect
      ? parseCardEffectText(effect)
          .map((part) => (part.kind === 'text' ? part.text : `[${part.label}]`))
          .join('')
      : '无效果',
    type: live ? 'LIVE' : front.cardType === CardType.MEMBER ? '成员' : '能量',
    value: live ? `分 ${front.score ?? '—'}` : `费 ${front.cost ?? '—'}`,
    valueLabel: live ? '印刷分数' : '印刷费用',
  };
}

export const HEART_TEXT: Record<HeartColor, string> = {
  PINK: '粉',
  RED: '红',
  YELLOW: '黄',
  GREEN: '绿',
  BLUE: '蓝',
  PURPLE: '紫',
  ORANGE: '橙',
  GRAY: '无色',
  RAINBOW: '彩虹',
};

export function formatTextHearts(hearts?: readonly { color: HeartColor; count: number }[]): string {
  return (
    hearts
      ?.filter((item) => item.count !== 0)
      .map((item) => `${HEART_TEXT[item.color] ?? item.color} ${item.count}`)
      .join('、') || '—'
  );
}

/** Requirement RAINBOW means generic gray hearts; a gained RAINBOW is still a rainbow heart. */
export function formatTextLiveRequirements(requirements: unknown): string {
  return (
    getRequirementEntriesForDisplay(requirements)
      .map(
        ({ color, count }) =>
          `${color === HeartColor.RAINBOW || color === HeartColor.GRAY ? '灰心' : HEART_TEXT[color]} ${count}`
      )
      .join('、') || '—'
  );
}

/** Only formats authorized printed markers and the owner's projected color replacement. */
export function formatTextJudgment(
  markers?: readonly ViewBladeHeartItem[],
  replacement?: LiveResultViewState['cheerHeartColorReplacements']['FIRST']
): string {
  const hearts = new Map<HeartColor, number>();
  let draw = 0;
  let score = 0;
  for (const marker of markers ?? []) {
    if (marker.effect === BladeHeartEffect.DRAW) draw += 1;
    if (marker.effect === BladeHeartEffect.SCORE) score += 1;
    if (marker.effect === BladeHeartEffect.HEART && marker.heartColor) {
      const color = replacement?.fromColors.includes(marker.heartColor)
        ? replacement.toColor
        : marker.heartColor;
      hearts.set(color, (hearts.get(color) ?? 0) + 1);
    }
  }
  return (
    [
      ...Object.values(HeartColor).flatMap((color) =>
        hearts.has(color) ? [`${HEART_TEXT[color]} ${hearts.get(color)}`] : []
      ),
      ...(draw ? [`抽卡 +${draw}`] : []),
      ...(score ? [`分数 +${score}`] : []),
    ].join('、') || '—'
  );
}

export function formatFrontMetrics(front: ViewFrontCardInfo, onStage = false): string {
  const values: string[] = [];
  if (front.cost !== undefined)
    values.push(
      `${onStage ? '当前费用' : '印刷费用'} ${front.cost + (onStage ? (front.modifierDelta?.costDelta ?? 0) : 0)}${onStage && front.modifierDelta?.costDelta ? `（印刷 ${front.cost}）` : ''}`
    );
  if (front.blade !== undefined) values.push(`光棒 ${front.blade}`);
  if (front.hearts?.length) values.push(`心 ${formatTextHearts(front.hearts)}`);
  if (front.score !== undefined) values.push(`印刷分数 ${front.score}`);
  if (front.requiredHearts)
    values.push(
      `需求 ${formatTextLiveRequirements(front.requiredHearts)}；总心 ${front.requiredHearts.totalRequired}`
    );
  return values.join('；') || '—';
}

export interface ExcelCardRow {
  readonly objectId: string;
  readonly cardId: string;
  readonly label: string;
  readonly front: ViewFrontCardInfo;
  readonly object: ViewCardObject;
  readonly metrics: string;
  readonly state: string;
  readonly location?: string;
  readonly printedJudgment?: string;
  readonly currentJudgment?: string;
}

/** Accept only a projected identity with an authorized front. Never search the card registry for a hidden object. */
export function selectExcelCard(view: PlayerViewState, objectId: string): ExcelCardRow | null {
  const object = view.objects[objectId];
  const front = object?.surface === 'FRONT' ? object.frontInfo : undefined;
  if (!front) return null;
  const cardId = objectId.replace(/^obj_/, '');
  const zones = Object.values(view.table.zones);
  const stageZone = zones.find((zone) => Object.values(zone.slotMap ?? {}).includes(objectId));
  const onStage = Boolean(stageZone);
  const slot = Object.entries(stageZone?.slotMap ?? {}).find(([, id]) => id === objectId)?.[0];
  const slotLabel = slot
    ? ({ LEFT: '左', CENTER: '中', RIGHT: '右' } as Record<string, string>)[slot]
    : undefined;
  const inEnergyZone = zones.some(
    (zone) => zone.zone === ZoneType.ENERGY_ZONE && zone.objectIds?.includes(objectId)
  );
  // Orientation is a rule state only for stage occupants and energy-zone cards.
  // Missing orientation must not invent an active state for cards in other zones.
  const orientationLabel =
    onStage || inEnergyZone
      ? object.orientation === OrientationState.ACTIVE
        ? '活跃'
        : object.orientation === OrientationState.WAITING
          ? '待机'
          : ''
      : '';
  const result = view.match.liveResult;
  const reduction =
    result?.requirementReductions[cardId] ?? result?.requirementReductions[objectId] ?? 0;
  const modifiers =
    result?.requirementModifiers?.[cardId] ??
    result?.requirementModifiers?.[objectId] ??
    (reduction > 0 ? [{ color: HeartColor.RAINBOW, countDelta: -reduction }] : []);
  const scoreDelta =
    result?.liveCardScoreModifiers[cardId] ?? result?.liveCardScoreModifiers[objectId] ?? 0;
  const adjustedRequirements = getAdjustedLiveRequirements(front.requiredHearts, modifiers);
  const hasJudgment = front.cardType === CardType.MEMBER || front.cardType === CardType.LIVE;
  const isCheerCard =
    (view.match.phase === GamePhase.PERFORMANCE_PHASE ||
      view.match.phase === GamePhase.LIVE_RESULT_PHASE) &&
    view.table.zones.SHARED_RESOLUTION_ZONE?.objectIds?.includes(objectId);
  const liveMetrics =
    front.score !== undefined
      ? `当前分数 ${Math.max(0, front.score + scoreDelta)}（印刷 ${front.score}）；当前需求 ${formatTextLiveRequirements(adjustedRequirements)}${adjustedRequirements ? `；总心 ${adjustedRequirements.totalRequired}` : ''}`
      : null;
  return {
    objectId,
    cardId: objectId.replace(/^obj_/, ''),
    object,
    front,
    label: getCardLocalizedInfo(front).title,
    location: slotLabel
      ? `${stageZone?.ownerSeat === view.match.viewerSeat ? '我方' : '对方'}${slotLabel}`
      : undefined,
    metrics: liveMetrics ?? formatFrontMetrics(front, onStage),
    printedJudgment: hasJudgment ? formatTextJudgment(front.bladeHearts) : undefined,
    currentJudgment:
      hasJudgment && isCheerCard
        ? formatTextJudgment(
            front.bladeHearts,
            result?.cheerHeartColorReplacements?.[object.ownerSeat]
          )
        : undefined,
    state: [
      orientationLabel,
      onStage && object.enteredStageThisTurn ? '本回合登场' : '',
      onStage && object.skipsNextActivePhase ? '下次不活跃' : '',
    ]
      .filter(Boolean)
      .join('；'),
  };
}
