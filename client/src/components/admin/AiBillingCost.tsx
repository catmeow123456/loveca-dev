import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiBillingSummary } from '@game/online/ai-battle-billing-types';
import './ai-battle.css';

function amount(cny: string): string {
  const [whole, fraction = ''] = cny.split('.');
  const units = BigInt(whole + fraction.padEnd(8, '0'));
  if (units > 0n && units < 10_000n) return '<¥0.0001';
  const rounded = (units + 5_000n) / 10_000n;
  return `≈¥${rounded / 10_000n}.${(rounded % 10_000n).toString().padStart(4, '0')}`;
}

/** A small price with the same token breakdown on hover, keyboard focus and touch. */
export function AiBillingCost({
  billing,
  label,
}: {
  readonly billing: AiBillingSummary | null;
  readonly label?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pinned = useRef(false);
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const unknown = billing
    ? billing.attempts - billing.reportedAttempts - billing.pendingAttempts
    : 0;
  const count = (value: number) => value.toLocaleString('zh-CN');
  const usage = billing?.usage;
  const subscription = billing?.estimatedCny === null;
  const text = subscription
    ? `ChatGPT 订阅${billing.attempts === 0 ? ' · 未调用' : billing.reportedAttempts === 0 ? ' · 用量未确认' : ''}`
    : !billing || billing.attempts === 0
      ? label
        ? '≈¥0.0000'
        : '—'
      : billing.reportedAttempts === 0
        ? billing.pendingAttempts > 0
          ? '统计中'
          : '用量未确认'
        : `${unknown > 0 ? '已知 ' : ''}${amount(billing.estimatedCny!)}${billing.pendingAttempts > 0 ? '…' : ''}`;
  const breakdown =
    !billing || billing.attempts === 0
      ? '未调用模型'
      : `输入 ${count(usage!.inputTokens)} + 缓存输入 ${count(usage!.implicitCachedTokens + usage!.explicitCachedTokens)} + 缓存创建 ${count(usage!.cacheCreationTokens)} → 输出 ${count(usage!.outputTokens)} token`;
  const notes = [
    billing && billing.attempts > 1 ? `${billing.attempts} 次调用合计` : '',
    billing?.pendingAttempts ? `${billing.pendingAttempts} 次待统计` : '',
    unknown ? `${unknown} 次用量未确认` : '',
    billing?.saveFailed ? '用量保存失败' : '',
    subscription ? '使用 ChatGPT 套餐 Codex 额度；token 用量不等于剩余额度，不估算人民币费用' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  useEffect(() => {
    if (!anchor) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) {
        // Reset the pinned state too: Safari does not move focus (no blur) when
        // tapping a non-focusable area, which would otherwise leave the tooltip stuck.
        pinned.current = false;
        setAnchor(null);
      }
    };
    const close = () => setAnchor(null);
    const scroll = () => {
      if (!pinned.current) return close();
      const rect = trigger.current?.getBoundingClientRect();
      setAnchor(rect && rect.bottom > 0 && rect.top < window.innerHeight ? rect : null);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor]);
  const open = () => setAnchor(trigger.current?.getBoundingClientRect() ?? null);
  const tooltipWidth = Math.min(620, window.innerWidth - 24);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="ai-billing-cost"
        data-ai-billing={label ? 'match' : 'decision'}
        aria-label={`${label ?? '调用费用'} ${text}`}
        aria-describedby={anchor ? id : undefined}
        onPointerEnter={open}
        onPointerLeave={() => {
          if (!pinned.current) setAnchor(null);
        }}
        onFocus={() => {
          pinned.current = true;
          open();
        }}
        onBlur={() => {
          pinned.current = false;
          setAnchor(null);
        }}
        onClick={() => {
          pinned.current = true;
          open();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && anchor) {
            event.stopPropagation();
            pinned.current = false;
            setAnchor(null);
          }
        }}
      >
        {label && <span>{label} </span>}
        {text}
        {billing?.saveFailed && <span className="ai-billing-warning"> · 保存失败</span>}
      </button>
      {anchor &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="ai-billing-tooltip"
            style={{
              left: Math.max(12, Math.min(anchor.left, window.innerWidth - tooltipWidth - 12)),
              top: anchor.bottom < window.innerHeight - 110 ? anchor.bottom + 6 : undefined,
              bottom:
                anchor.bottom >= window.innerHeight - 110
                  ? window.innerHeight - anchor.top + 6
                  : undefined,
              maxWidth: tooltipWidth,
            }}
          >
            <div>{breakdown}</div>
            {notes && <small>{notes}</small>}
          </div>,
          document.body
        )}
    </>
  );
}
