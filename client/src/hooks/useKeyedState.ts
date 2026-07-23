import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

interface KeyedState<T> {
  readonly key: string | null;
  readonly value: T;
}

export function useKeyedState<T>(
  key: string | null,
  initialValue: T
): readonly [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<KeyedState<T>>(() => ({ key, value: initialValue }));

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      setState((current) => {
        if (current.key !== key) {
          return current;
        }
        return {
          key,
          value:
            typeof nextValue === 'function'
              ? (nextValue as (previous: T) => T)(current.value)
              : nextValue,
        };
      });
    },
    [key]
  );

  if (state.key !== key) {
    setState({ key, value: initialValue });
    return [initialValue, setValue] as const;
  }

  return [state.value, setValue] as const;
}
