import { expect, test, type Page } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';
import { createGameSession } from '../../../src/application/game-session';
import { resolvePendingCardEffects } from '../../../src/application/card-effect-runner';
import { PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID as SUCCESS } from '../../../src/application/card-effects/ability-ids';
import { registerCards, updatePlayer, type GameState } from '../../../src/domain/entities/game';
import { placeCardInSlot } from '../../../src/domain/entities/zone';
import { createCardInstance, createHeartRequirement } from '../../../src/domain/entities/card';
import { toTransport } from '../../../src/online/serde';
import {
  FaceState,
  OrientationState,
  GamePhase,
  SubPhase,
  SlotPosition,
  TriggerCondition,
  TurnType,
  CardType,
} from '../../../src/shared/types/enums';
import type { OnlineRoomView, Seat } from '../../../src/online';

test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Two real OnlineRoomPage/GameBoard clients share one in-memory authority. Only HTTP
// transport is intercepted: no account writes, live rooms, or production API calls.
async function openPair(
  first: Page,
  second: Page,
  options: { disabled?: boolean; slowAck?: boolean }
) {
  const session = createGameSession({ cardEntrance: 'REMOTE' });
  let state = session.createGame('entrance-sync', 'p1', '先攻', 'p2', '后攻');
  state = registerCards(state, [
    createCardInstance(
      {
        cardCode: 'PL!-pb2-039-L',
        name: '我们是合而为一的光芒',
        cardType: CardType.LIVE,
        score: 9,
        requirements: createHeartRequirement({}),
        groupNames: ["μ's"],
      },
      'p1',
      'song'
    ),
    ...['member', 'deck', 'opponent-deck'].map((id) =>
      createCardInstance(
        {
          cardCode: 'ME-visual-001',
          name: '高坂穂乃果',
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 1,
          hearts: [],
          groupNames: ["μ's"],
        },
        id === 'opponent-deck' ? 'p2' : 'p1',
        id
      )
    ),
  ]);
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'member', up),
    liveZone: { ...p.liveZone, cardIds: ['song'], cardStates: new Map([['song', up]]) },
  }));
  state = updatePlayer(state, 'p2', (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['opponent-deck'] },
  }));
  state = {
    ...state,
    isStarted: true,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    currentTurnType: TurnType.LIVE_PHASE,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    activeEffect: null,
    pendingChoice: null,
    manualOperationMode: 'RULES',
    liveResolution: { ...state.liveResolution, playerScores: new Map([['p1', 9]]) },
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  let revision = 1;
  const acks: { seat: Seat; at: number }[] = [];
  const polls: { seat: Seat; at: number; waiting: boolean }[] = [];
  const snapshot = (seat: Seat) => ({
    matchId: 'entrance-sync',
    seat,
    playerId: seat === 'FIRST' ? 'p1' : 'p2',
    seq: revision,
    currentPublicSeq: session.getCurrentPublicEventSeq(),
    publicEvents: [],
    playerViewState: session.getPlayerViewState(seat === 'FIRST' ? 'p1' : 'p2', {
      seqOverride: revision,
    }),
  });
  for (const [page, seat] of [
    [first, 'FIRST'],
    [second, 'SECOND'],
  ] as const) {
    await installVisualApiMocks(page, true);
    await page.addInitScript((disabled) => {
      localStorage.setItem('loveca-card-entrance-enabled', String(!disabled));
      sessionStorage.setItem('loveca.online.room', 'SYNC');
    }, options.disabled ?? false);
    const room: OnlineRoomView = {
      roomCode: 'SYNC',
      originKind: 'ONLINE_ROOM',
      status: 'IN_GAME',
      battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
      ownerUserId: 'visual-user',
      currentUserId: 'visual-user',
      currentUserRole: 'HOST',
      currentUserPresence: 'ACTIVE',
      currentUserSeat: seat,
      members: [
        {
          userId: 'visual-user',
          displayName: '先攻',
          role: 'HOST',
          presence: 'ACTIVE',
          lockedDeckId: 'visual-deck',
          lockedDeckName: '测试',
          ready: true,
          startReady: true,
          seat: 'FIRST',
        },
        {
          userId: 'opponent-user',
          displayName: '后攻',
          role: 'GUEST',
          presence: 'ACTIVE',
          lockedDeckId: 'visual-deck',
          lockedDeckName: '测试',
          ready: true,
          startReady: true,
          seat: 'SECOND',
        },
      ],
      openingRps: null,
      openingArrivalExpiresAt: null,
      restartRequest: null,
      endInfo: null,
      matchId: 'entrance-sync',
      spectatorRoomEntry: null,
      spectatorPresence: { total: 0, viewers: [] },
      updatedAt: Date.now(),
    };
    await page.route('**/images/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#a8b8cc"/></svg>',
      })
    );
    await page.route('**/api/online/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const ok = (data: unknown) =>
        route.fulfill({ json: { data: toTransport(data), error: null } });
      if (path === '/api/online/rooms/SYNC') return ok(room);
      if (path.endsWith('/snapshot')) {
        polls.push({ seat, at: Date.now(), waiting: !!session.state!.entranceRuntime?.pending });
        await delay(35);
        if (session.expireCardEntrance()) revision++;
        return ok(snapshot(seat));
      }
      if (path.endsWith('/command')) {
        const command = route.request().postDataJSON().command;
        if (command.type === 'ACK_CARD_ENTRANCE') {
          acks.push({ seat, at: Date.now() });
          await delay(options.slowAck && seat === 'SECOND' ? 1400 : 35);
        }
        const result = session.executeCommand({
          ...command,
          playerId: seat === 'FIRST' ? 'p1' : 'p2',
        });
        if (result.success) revision++;
        return ok({ success: result.success, error: result.error, snapshot: snapshot(seat) });
      }
      if (path.endsWith('/public-events'))
        return ok({
          matchId: 'entrance-sync',
          currentPublicSeq: session.getCurrentPublicEventSeq(),
          publicEvents: [],
        });
      if (path.endsWith('/chat/messages')) return ok({ entries: [], currentSeq: 0 });
      return route.fallback();
    });
    await page.goto('/?page=battle-lobby');
    await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
    await page.evaluate(() => {
      sessionStorage.setItem('loveca.online.room', 'SYNC');
      window.dispatchEvent(new CustomEvent('loveca:casual-navigation', { detail: 'online-room' }));
    });
    await page.getByRole('button', { name: '跳过提示', exact: true }).click();
    await expect(page.getByTitle('打开房间操作')).toBeVisible();
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
      const { useGameStore } = await import(url);
      Object.assign(window, { syncTestStore: useGameStore, syncNotices: [] });
      const notices = (window as any).syncNotices;
      new MutationObserver(() => {
        const notice = document.querySelector('.card-entrance-wait');
        if (notice) notices.push({ at: Date.now(), text: notice.textContent });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }
  return {
    session,
    acks,
    polls,
    async start() {
      const next = resolvePendingCardEffects({
        ...session.state!,
        pendingAbilities: [
          {
            id: `success-${revision}`,
            abilityId: SUCCESS,
            sourceCardId: 'song',
            controllerId: 'p1',
            mandatory: true,
            timingId: TriggerCondition.ON_LIVE_SUCCESS,
            eventIds: [],
          },
        ],
      }).gameState;
      // Commit through the authority so its normal six-second deadline is attached.
      (session as unknown as { setAuthorityState(state: GameState): void }).setAuthorityState(next);
      expect(session.state!.entranceRuntime?.pending?.deadlineAt).toBeGreaterThan(Date.now());
      revision++;
      // The actor receives the command response immediately; the other client has to poll.
      const transport = toTransport(snapshot('FIRST'));
      await first.evaluate(
        async (data) => {
          const serde = '/@fs' + data.root + 'src/online/serde.ts';
          const { fromTransport } = await import(serde);
          await (window as any).syncTestStore
            .getState()
            .applyRemoteSnapshot(fromTransport(data.snapshot));
        },
        { root: new URL('../../../', import.meta.url).pathname, snapshot: transport }
      );
    },
  };
}

for (const scenario of ['normal', 'slow-opponent', 'both-disabled', 'skip'] as const) {
  test(`联机演出收尾：${scenario}`, async ({ page, context }, info) => {
    test.skip(info.project.name !== 'tablet-1024x768');
    const second = await context.newPage();
    const reduced = scenario === 'slow-opponent';
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await second.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    if (reduced) await page.setViewportSize({ width: 390, height: 844 });
    const f = await openPair(page, second, {
      disabled: scenario === 'both-disabled',
      slowAck: reduced,
    });
    await f.start();
    if (scenario === 'normal' || scenario === 'skip') {
      await expect(page.getByTestId('bokuhika-scene')).toHaveAttribute('data-ready', 'true');
      await expect(second.getByTestId('bokuhika-scene')).toHaveAttribute('data-ready', 'true');
    }
    if (scenario === 'skip') {
      await page.getByRole('button', { name: '跳过演出', exact: true }).click();
      await expect(page.locator('.card-entrance-wait')).toBeVisible();
      expect(f.session.state!.entranceRuntime?.pending?.waitingPlayerIds).toEqual(['p2']);
      expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(9);
    }
    if (reduced) {
      await expect(page.locator('.card-entrance-wait')).toBeVisible();
      expect(f.session.state!.entranceRuntime?.pending).toBeTruthy();
      expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(9);
      await expect(page.locator('.card-entrance-wait')).toHaveCSS('animation-name', 'none');
      const box = (await page.locator('.card-entrance-wait').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      const actions = (await page.locator('.battle-mobile-actions').boundingBox())!;
      expect(box.y + box.height).toBeLessThan(actions.y);
      await page.screenshot({ path: info.outputPath('slow-narrow.png') });
    }
    await expect.poll(() => f.session.state!.entranceRuntime?.pending).toBeNull();
    await expect(page.getByRole('button', { name: '继续处理', exact: true })).toBeVisible();
    await expect(page.locator('.card-entrance-wait')).toHaveCount(0);
    await expect(second.locator('.card-entrance-wait')).toHaveCount(0);
    expect(f.acks.filter((a) => a.seat === 'FIRST')).toHaveLength(1);
    if (!reduced && scenario !== 'skip') {
      expect(f.acks.filter((a) => a.seat === 'SECOND')).toHaveLength(1);
      expect(await page.evaluate(() => (window as any).syncNotices)).toEqual([]);
      expect(await second.evaluate(() => (window as any).syncNotices)).toEqual([]);
    }
    expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(9);
    await page.getByRole('button', { name: '继续处理', exact: true }).click();
    await expect.poll(() => f.session.state!.liveResolution.playerScores.get('p1')).toBe(10);
    await page.waitForTimeout(1000);
    expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(10);
    if (scenario === 'normal') {
      const active = f.polls.filter((p) => p.seat === 'FIRST' && p.waiting);
      expect(active.length).toBeGreaterThan(5);
      const gaps = active
        .slice(1)
        .map((p, i) => p.at - active[i].at)
        .sort((a, b) => a - b);
      expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(400);
    }
    await info.attach('synchronization', {
      body: JSON.stringify({ acks: f.acks, polls: f.polls }),
      contentType: 'application/json',
    });
    await second.close();
  });
}
