import { useTextPresentation } from '@/lib/appPresentation';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import { memo, Fragment } from 'react';
import { cn } from '@/lib/utils';
import { parseCardEffectText, type CardEffectTokenIcon } from '@/lib/cardEffectTokens';
import { MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';

export interface CardEffectTextProps {
  readonly text: string;
  readonly as?: 'p' | 'span' | 'div';
  readonly className?: string;
}

function EffectIcon({
  icon,
  label,
  className,
}: {
  readonly icon: CardEffectTokenIcon;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span className={cn('card-effect-icon-token', className)} title={label} aria-label={label}>
      <PresentationImage src={MODIFIER_ICON_SOURCE[icon]} alt="" aria-hidden="true" />
    </span>
  );
}

export const CardEffectText = memo(function CardEffectText({
  text,
  as: Tag = 'p',
  className,
}: CardEffectTextProps) {
  const textOnly = useTextPresentation();
  const parts = parseCardEffectText(text);
  if (textOnly)
    return (
      <Tag className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {parts.map((part) => (part.kind === 'text' ? part.text : `[${part.label}]`)).join('')}
      </Tag>
    );

  return (
    <Tag className={cn('card-effect-rendered whitespace-pre-wrap break-words', className)}>
      {parts.map((part, index) => {
        if (part.kind === 'text') {
          return <Fragment key={index}>{part.text}</Fragment>;
        }

        if (part.icon) {
          return <EffectIcon key={index} icon={part.icon} label={part.label} />;
        }

        return (
          <span
            key={index}
            className={cn('card-effect-keyword-token', `card-effect-keyword-token-${part.kind}`)}
            title={part.raw}
          >
            {part.label}
          </span>
        );
      })}
    </Tag>
  );
});
