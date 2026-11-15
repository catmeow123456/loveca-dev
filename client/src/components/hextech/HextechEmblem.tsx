import type { HextechRarity } from '@game/domain/hextech/catalog';
import './hextech-emblem.css';

/** Shared identity; tier geometry remains distinguishable without color. */
export function HextechEmblem({ rarity }: { rarity?: HextechRarity }) {
  return (
    <svg
      className="hextech-emblem"
      data-rarity={rarity}
      viewBox="0 0 32 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="hextech-emblem-shell" d="M16 2 30 10v16L16 34 2 26V10Z" />
      {rarity === 'SILVER' ? (
        <path className="hextech-emblem-core" d="m16 11 7 7-7 7-7-7Z" />
      ) : (
        <>
          <path className="hextech-emblem-core" d="m16 9 8 4.5v9L16 27l-8-4.5v-9Z" />
          {rarity === 'PRISMATIC' ? (
            <>
              <path className="hextech-emblem-facet" d="m16 9 0 9 8-4.5M16 18l8 4.5M16 18v9" />
              <path d="m8 13.5 8 4.5-8 4.5" />
            </>
          ) : (
            <path d="m16 13 4 5-4 5-4-5Z" />
          )}
        </>
      )}
    </svg>
  );
}
