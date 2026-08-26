export type TutorialHistoryTransition = 'ENTER' | 'EXIT' | null;

export function resolveTutorialHistoryTransition(
  currentPage: string,
  nextPage: string
): TutorialHistoryTransition {
  const currentlyInTutorial = currentPage === 'tutorial';
  const navigatingToTutorial = nextPage === 'tutorial';
  if (currentlyInTutorial === navigatingToTutorial) return null;
  return navigatingToTutorial ? 'ENTER' : 'EXIT';
}
