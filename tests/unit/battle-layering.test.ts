import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INDEX_CSS_PATH = path.resolve('client/src/index.css');
const PLAYER_AREA_PATH = path.resolve('client/src/components/game/PlayerArea.tsx');
const MATCH_RECORDS_PAGE_PATH = path.resolve('client/src/components/pages/MatchRecordsPage.tsx');
const CARD_DETAIL_OVERLAY_PATH = path.resolve('client/src/components/game/CardDetailOverlay.tsx');
const TUTORIAL_GUIDANCE_LAYER_PATH = path.resolve(
  'client/src/components/tutorial/TutorialGuidanceLayer.tsx'
);

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
    const replaySurface = readZIndexToken(css, 'z-battle-replay-surface');
    const ordinaryActionMenu = readZIndexToken(css, 'z-battle-action-menu');
    const modalBackdrop = readZIndexToken(css, 'z-battle-modal-backdrop');
    const modal = readZIndexToken(css, 'z-battle-modal');
    const modalActionMenu = readZIndexToken(css, 'z-battle-modal-action-menu');
    const cardDetailBackdrop = readZIndexToken(css, 'z-card-detail-backdrop');
    const cardDetail = readZIndexToken(css, 'z-card-detail');
    const tutorialGuidance = readZIndexToken(css, 'z-tutorial-guidance');

    expect(replaySurface).toBeLessThan(ordinaryActionMenu);
    expect(ordinaryActionMenu).toBeLessThan(modalBackdrop);
    expect(modalBackdrop).toBeLessThan(modal);
    expect(modal).toBeLessThan(modalActionMenu);
    expect(modalActionMenu).toBeLessThan(cardDetailBackdrop);
    expect(cardDetailBackdrop).toBeLessThan(cardDetail);
    expect(cardDetail).toBeLessThan(tutorialGuidance);
  });

  it('uses the modal action-menu layer for waiting-room activated abilities', () => {
    const source = fs.readFileSync(PLAYER_AREA_PATH, 'utf8');
    expect(source).toMatch(/canActivateWaitingRoomAbility[\s\S]*?<CardActionMenu\s+layer="modal"/);
  });

  it('keeps the replay board below body-portaled battle overlays', () => {
    const source = fs.readFileSync(MATCH_RECORDS_PAGE_PATH, 'utf8');
    expect(source).toContain('z-[var(--z-battle-replay-surface)]');
    expect(source).not.toContain('className="fixed inset-0 z-[200] overflow-hidden');
  });

  it('uses the shared card-detail layers for desktop and mobile overlays', () => {
    const source = fs.readFileSync(CARD_DETAIL_OVERLAY_PATH, 'utf8');
    expect(source.match(/z-\[var\(--z-card-detail\)\]/g)).toHaveLength(2);
    expect(source).toContain('z-[var(--z-card-detail-backdrop)]');
    expect(source).not.toMatch(/z-\[(119|120|200)\]/);
  });

  it('keeps tutorial guidance above modal surfaces while passing through board interaction', () => {
    const source = fs.readFileSync(TUTORIAL_GUIDANCE_LAYER_PATH, 'utf8');
    expect(source).toContain('pointer-events-none fixed z-[var(--z-tutorial-guidance)]');
    expect(source).toContain('pointer-events-auto absolute flex flex-col');
    expect(source).not.toContain('fixed inset-0 z-[120]');
  });
});
