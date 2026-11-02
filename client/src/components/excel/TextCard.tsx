import type { AnyCardData } from '@game/domain/entities/card';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { CardEffectText } from '@/components/card/CardEffectText';
import { formatTextJudgment } from '@/lib/excelCardView';
import { CardType } from '@game/shared/types/enums';

export function TextCard({
  card,
  instanceId,
  faceUp = true,
  selected,
  onClick,
}: {
  card: AnyCardData;
  instanceId?: string;
  faceUp?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  if (!faceUp) return <span className="excel-text-card">未知卡牌</span>;
  const text = getCardLocalizedInfo(card);
  return (
    <span
      className="excel-text-card"
      data-card-id={instanceId}
      data-selected={selected || undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onClick();
              }
            }
          : undefined
      }
    >
      <strong>{text.title}</strong>
      <span>
        {card.cardCode}
        {selected ? ' · 已选' : ''}
      </span>
      {text.effectCn && <CardEffectText as="span" text={text.effectCn} />}
      {!text.effectCn && text.effectJp && <CardEffectText as="span" text={text.effectJp} />}
    </span>
  );
}

export function TextJudgmentDetails({ printed, current }: { printed?: string; current?: string }) {
  if (printed === undefined) return null;
  return (
    <div className="excel-judgment-details">
      <p>印刷判定：{printed}</p>
      {current !== undefined && current !== printed && <p>本次判定：{current}（效果修正）</p>}
    </div>
  );
}

export function TextCardDetails({ card }: { card: AnyCardData }) {
  const text = getCardLocalizedInfo(card);
  return (
    <div className="excel-card-details">
      <strong>{text.title}</strong>
      <p>{card.cardCode}</p>
      {'cost' in card && <p>印刷费用：{card.cost}</p>}
      {'score' in card && <p>印刷分数：{card.score}</p>}
      {card.cardType !== CardType.ENERGY && (
        <TextJudgmentDetails printed={formatTextJudgment(card.bladeHearts)} />
      )}
      {text.effectCn && <CardEffectText text={text.effectCn} />}
      {text.effectJp && <CardEffectText text={text.effectJp} />}
      {!text.hasEffect && <p>没有卡牌效果文本。</p>}
    </div>
  );
}
