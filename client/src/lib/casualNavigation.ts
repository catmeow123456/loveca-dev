export const CASUAL_NAVIGATION_EVENT = 'loveca:casual-navigation';
export const CASUAL_PAGE_EVENT = 'loveca:casual-page';
export function openCasualDestination(
  page: 'battle-lobby' | 'online-room' | 'ranked' | 'theme-table',
  roomCode?: string
) {
  if (roomCode) window.sessionStorage.setItem('loveca.online.room', roomCode);
  window.dispatchEvent(new CustomEvent(CASUAL_NAVIGATION_EVENT, { detail: page }));
}
