import { useState } from 'react';
import { Check, Clock3, Loader2 } from 'lucide-react';
import type { ThemeDeckChoiceView } from '@game/online/theme-table-types';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardDetailDrawer } from '@/components/deck-editor/CardDetailDrawer';
import { resolveCardImagePath } from '@/lib/imageService';
import { useGameStore } from '@/store/gameStore';
import { ThemeDeckGallery } from './ThemeDeckGallery';

export function ThemeDeckChoiceDialog({
  choice,
  remainingSeconds,
  loading,
  error,
  onConfirm,
}: {
  choice: ThemeDeckChoiceView;
  remainingSeconds: number | null;
  loading: boolean;
  error: string | null;
  onConfirm: (deckVersionId: string) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const [selection, setSelection] = useState<{
    reservationId: string;
    deckVersionId: string;
  } | null>(null);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const selectedDeckId =
    selection?.reservationId === choice.reservationId &&
    choice.candidates.some((deck) => deck.id === selection.deckVersionId)
      ? selection.deckVersionId
      : (choice.selectedDeckVersionId ?? choice.candidates[0]?.id ?? null);
  const selectedDeck = choice.candidates.find((deck) => deck.id === selectedDeckId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[114] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-deck-choice-title"
    >
      <div className="surface-panel mx-auto my-[max(1rem,4vh)] w-full max-w-5xl p-5 sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="theme-deck-choice-title"
              className="text-2xl font-bold text-[var(--text-primary)]"
            >
              选择本局卡组
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            <Clock3 size={16} /> {remainingSeconds ?? '—'} 秒
          </div>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {choice.candidates.map((deck) => {
            const selected = deck.id === selectedDeckId;
            const previewCard = deck.mainDeck[0] ?? deck.energyDeck[0] ?? null;
            return (
              <button
                key={deck.id}
                type="button"
                className={`relative flex min-h-28 items-center gap-4 overflow-hidden rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-md'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                }`}
                aria-pressed={selected}
                onClick={() =>
                  setSelection({ reservationId: choice.reservationId, deckVersionId: deck.id })
                }
              >
                {selected ? (
                  <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white">
                    <Check size={16} />
                  </span>
                ) : null}
                {previewCard ? (
                  <img
                    className="h-24 w-[69px] shrink-0 rounded-md border border-white/30 object-cover shadow-md"
                    src={resolveCardImagePath(cardDataRegistry.get(previewCard.cardCode), 'medium')}
                    alt=""
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0 pr-8">
                  <strong className="block text-base text-[var(--text-primary)]">
                    {deck.displayName}
                  </strong>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                    {deck.playStyleTags.length > 0
                      ? deck.playStyleTags.join(' · ')
                      : deck.sourceLabel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {selectedDeck ? (
          <section className="mt-6 max-h-[42vh] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 sm:max-h-[46vh]">
            <h3 className="mb-4 font-semibold text-[var(--text-primary)]">
              {selectedDeck.displayName} · 卡表
            </h3>
            <ThemeDeckGallery deck={selectedDeck} onViewCard={setSelectedCard} />
          </section>
        ) : null}

        {error ? <p className="mt-4 text-sm text-[var(--semantic-error)]">{error}</p> : null}
        <div className="sticky bottom-0 -mx-5 mt-6 border-t border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-5 pb-1 pt-4 sm:-mx-7 sm:px-7">
          <button
            className="button-primary w-full py-3"
            disabled={loading || !selectedDeckId}
            onClick={() => selectedDeckId && onConfirm(selectedDeckId)}
          >
            {loading ? <Loader2 className="mr-1 inline animate-spin" size={16} /> : null}
            确认这副卡组
          </button>
        </div>
      </div>
      <CardDetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}
