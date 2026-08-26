import type { TutorialMascotExpression } from './tutorialGuidance';

/** Compact expression stickers belong inside tutorial copy and completion notices. */
export const TUTORIAL_STICKER_ASSETS = {
  WELCOME: '/tutorial/mascot/stickers/kosuzu-welcome.png',
  READ_CARD: '/tutorial/mascot/stickers/kosuzu-card.png',
  CELEBRATE: '/tutorial/mascot/stickers/kosuzu-cheer.png',
} as const satisfies Record<TutorialMascotExpression, string>;

/** Taller scene portraits need their own whitespace and must stay outside board callouts. */
export const TUTORIAL_PORTRAIT_ASSETS = {
  WELCOME: '/tutorial/mascot/portraits/kosuzu-welcome.png',
  READING: '/tutorial/mascot/portraits/kosuzu-reading.png',
  THINKING: '/tutorial/mascot/portraits/kosuzu-thinking.png',
  RETRY: '/tutorial/mascot/portraits/kosuzu-retry.png',
  SUCCESS: '/tutorial/mascot/portraits/kosuzu-success.png',
} as const;
