import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export function reconcileSelection(
  values: readonly string[],
  candidates: readonly string[],
  maximum = Infinity
): string[] {
  return [...new Set(values)].filter((value) => candidates.includes(value)).slice(0, maximum);
}

/** Preserve still-legal selections within a match/view/step, including their order. */
export function useSelectionDraft(
  context: string | null,
  candidates: readonly string[],
  maximum = Infinity
): readonly [string[], Dispatch<SetStateAction<string[]>>, boolean] {
  const [draft, setDraft] = useState({ context, values: [] as string[], invalidated: false });
  const current = draft.context === context ? draft : { context, values: [], invalidated: false };
  const valid = reconcileSelection(current.values, candidates, maximum);
  const changed = valid.length !== current.values.length;
  const invalidated = current.invalidated || changed;
  if (draft.context !== context || changed) setDraft({ context, values: valid, invalidated });
  const update = useCallback<Dispatch<SetStateAction<string[]>>>(
    (next) => {
      setDraft((previous) => {
        if (previous.context !== context) return previous;
        const base = reconcileSelection(previous.values, candidates, maximum);
        return {
          context,
          values: reconcileSelection(
            typeof next === 'function' ? next(base) : next,
            candidates,
            maximum
          ),
          invalidated: false,
        };
      });
    },
    [context, candidates, maximum]
  );
  return [changed ? valid : current.values, update, invalidated];
}
