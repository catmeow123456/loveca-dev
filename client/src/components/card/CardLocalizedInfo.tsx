import type { AnyCardData } from '@game/domain/entities/card';
import { cn } from '@/lib/utils';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';

type TextAlign = 'left' | 'center';

function LanguageLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--text-muted)]">
      {children}
    </span>
  );
}

function LocalizedTextRow({
  label,
  value,
  missingText,
  className,
  textClassName,
}: {
  label: string;
  value: string | null;
  missingText: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <LanguageLabel>{label}</LanguageLabel>
      <p
        className={cn(
          'whitespace-pre-wrap break-words leading-relaxed',
          value ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
          textClassName
        )}
      >
        {value ?? missingText}
      </p>
    </div>
  );
}

export function CardLocalizedName({
  card,
  align = 'center',
  className,
}: {
  card: AnyCardData;
  align?: TextAlign;
  className?: string;
}) {
  const { nameCn, nameJp } = getCardLocalizedInfo(card);

  return (
    <div className={cn('space-y-1.5', align === 'center' ? 'text-center' : 'text-left', className)}>
      <div className="space-y-0.5">
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-1.5',
            align === 'center' ? 'justify-center' : 'justify-start'
          )}
        >
          <LanguageLabel>中文</LanguageLabel>
          <span
            className={cn(
              'break-words font-bold leading-tight',
              nameCn ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            )}
          >
            {nameCn ?? '未收录中文名'}
          </span>
        </div>
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-1.5',
            align === 'center' ? 'justify-center' : 'justify-start'
          )}
        >
          <LanguageLabel>日文</LanguageLabel>
          <span
            className={cn(
              'break-words text-sm leading-tight',
              nameJp ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
            )}
          >
            {nameJp ?? '未收录日文名'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CardLocalizedEffect({
  card,
  className,
  textClassName,
}: {
  card: AnyCardData;
  className?: string;
  textClassName?: string;
}) {
  const { effectCn, effectJp, hasEffect } = getCardLocalizedInfo(card);

  if (!hasEffect) {
    return (
      <p className={cn('text-sm leading-relaxed text-[var(--text-muted)]', textClassName)}>
        该卡牌没有效果描述。
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <LocalizedTextRow
        label="中文"
        value={effectCn}
        missingText="未收录中文效果"
        textClassName={textClassName}
      />
      <LocalizedTextRow
        label="日文"
        value={effectJp}
        missingText="未收录日文效果"
        className="border-t border-[var(--border-subtle)] pt-3"
        textClassName={textClassName}
      />
    </div>
  );
}
