import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INDEX_CSS_PATH = path.resolve('client/src/index.css');
const PLAYER_AREA_PATH = path.resolve('client/src/components/game/PlayerArea.tsx');

function readZIndexToken(css: string, token: string): number {
  const match = css.match(new RegExp(`--${token}:\\s*(\\d+);`));
  if (!match) {
    throw new Error(`Missing z-index token: --${token}`);
  }
  return Number(match[1]);
}

describe('battle overlay layering', () => {
  it('keeps modal card action menus above battle modals without raising ordinary menus', () => {
    const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
    const ordinaryActionMenu = readZIndexToken(css, 'z-battle-action-menu');
    const modalBackdrop = readZIndexToken(css, 'z-battle-modal-backdrop');
    const modal = readZIndexToken(css, 'z-battle-modal');
    const modalActionMenu = readZIndexToken(css, 'z-battle-modal-action-menu');
    const cardDetail = readZIndexToken(css, 'z-card-detail');

    expect(ordinaryActionMenu).toBeLessThan(modalBackdrop);
    expect(modalBackdrop).toBeLessThan(modal);
    expect(modal).toBeLessThan(modalActionMenu);
    expect(modalActionMenu).toBeLessThan(cardDetail);
  });

  it('uses the modal action-menu layer for waiting-room activated abilities', () => {
    const source = fs.readFileSync(PLAYER_AREA_PATH, 'utf8');
    expect(source).toMatch(/canActivateWaitingRoomAbility[\s\S]*?<CardActionMenu\s+layer="modal"/);
  });
});
