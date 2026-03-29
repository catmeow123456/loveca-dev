import { useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const getMatches = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = (event?: MediaQueryListEvent) => {
      setMatches(event ? event.matches : mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
}
