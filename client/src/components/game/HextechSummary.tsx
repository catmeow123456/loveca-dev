import { Disclosure } from '@/components/common';
import type { MatchViewState } from '@game/online/types';
import { HEXTECH_RARITY_LABELS } from '@game/domain/hextech/catalog';

export function HextechSummary({ match }: { match: MatchViewState }) {
  if (!match.hextech) return null;
  return (
    <Disclosure summary="海克斯" variant="popover">
      <div className="max-h-[60dvh] space-y-4 overflow-y-auto text-sm" aria-label="已持有海克斯">
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
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Disclosure>
  );
}
