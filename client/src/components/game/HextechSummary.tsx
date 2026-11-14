import { useRef, useState } from 'react';
import { ActionButton, Disclosure } from '@/components/common';
import { HextechPool } from '@/components/hextech/HextechPool';
import type { MatchViewState } from '@game/online/types';
import { HEXTECH_RARITY_LABELS } from '@game/domain/hextech/catalog';

export function HextechSummary({
  match,
  onActivate,
}: {
  match: MatchViewState;
  onActivate?: (instanceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
  if (!match.hextech) return null;
  return (
    <>
      <Disclosure
        summary="海克斯"
        variant="popover"
        open={open}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          summaryRef.current = event.currentTarget.querySelector('summary');
        }}
      >
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto text-sm" aria-label="已持有海克斯">
          <ActionButton
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setPoolOpen(true);
            }}
          >
            查看海克斯池
          </ActionButton>
          {(['FIRST', 'SECOND'] as const).map((seat) => {
            const owned = match.hextech!.owned.filter((item) => item.ownerSeat === seat);
            return (
              <section key={seat}>
                <h3 className="mb-2 font-bold">
                  {seat === 'FIRST' ? 'P1' : 'P2'} · {match.participants[seat].name}
                </h3>
                {owned.length === 0 ? (
                  <p>尚未取得海克斯</p>
                ) : (
                  <ul className="space-y-2">
                    {owned.map((item) => (
                      <li key={item.instanceId}>
                        <div className="font-medium">
                          {HEXTECH_RARITY_LABELS[item.rarity]} · {item.name}
                        </div>
                        <p className="text-[var(--text-secondary)]">{item.rulesText}</p>
                        {onActivate &&
                          match.hextech?.abilities?.some(
                            (ability) => ability.instanceId === item.instanceId
                          ) && (
                            <button
                              className="button-primary"
                              onClick={() => {
                                setOpen(false);
                                onActivate(item.instanceId);
                              }}
                            >
                              发动{item.name}
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </Disclosure>
      {poolOpen && <HextechPool onClose={() => setPoolOpen(false)} returnFocusRef={summaryRef} />}
    </>
  );
}
