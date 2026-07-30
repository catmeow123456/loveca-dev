import type { PublicTableStatusView } from '../../src/online/public-table-types';

const publicTableClient = vi.hoisted(() => ({
  cancelPublicTable: vi.fn(),
  confirmPublicTable: vi.fn(),
  fetchPublicTableStatus: vi.fn(),
  heartbeatPublicTable: vi.fn(),
  joinPublicTable: vi.fn(),
}));

vi.mock('@/lib/publicTableClient', () => publicTableClient);

import { usePublicTableStore } from '../../client/src/store/publicTableStore';

const IDLE_STATUS: PublicTableStatusView = {
  state: 'IDLE',
  ticketId: null,
  joinedAt: null,
  deckName: null,
  reservationId: null,
  confirmationExpiresAt: null,
  confirmed: false,
  roomCode: null,
  roomGeneration: null,
  message: null,
};

const WAITING_STATUS: PublicTableStatusView = {
  ...IDLE_STATUS,
  state: 'WAITING',
  ticketId: 'ticket-a',
  joinedAt: 100,
  deckName: '测试卡组',
};

const PENDING_CONFIRMATION_STATUS: PublicTableStatusView = {
  ...WAITING_STATUS,
  state: 'PENDING_CONFIRMATION',
  reservationId: 'reservation-a',
  confirmationExpiresAt: 200,
};

const CONFIRMED_STATUS: PublicTableStatusView = {
  ...PENDING_CONFIRMATION_STATUS,
  state: 'CONFIRMED',
  confirmed: true,
};

const MATCHED_STATUS: PublicTableStatusView = {
  ...WAITING_STATUS,
  state: 'MATCHED',
  roomCode: 'ABC123',
  roomGeneration: 'room-generation-a',
};

beforeEach(() => {
  vi.clearAllMocks();
  usePublicTableStore.getState().setSessionUser(null);
});

it('切换登录用户时立即清除旧用户的公共牌桌状态', async () => {
  publicTableClient.fetchPublicTableStatus.mockResolvedValueOnce(MATCHED_STATUS);
  usePublicTableStore.getState().setSessionUser('user-a');
  await usePublicTableStore.getState().refresh();

  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-a',
    hydrated: true,
    status: MATCHED_STATUS,
  });

  usePublicTableStore.getState().setSessionUser('user-b');

  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-b',
    hydrated: false,
    status: null,
    loading: false,
    error: null,
  });
});

it('忽略上一登录用户延迟返回的状态响应', async () => {
  let resolveStatus!: (status: PublicTableStatusView) => void;
  publicTableClient.fetchPublicTableStatus.mockReturnValueOnce(
    new Promise<PublicTableStatusView>((resolve) => {
      resolveStatus = resolve;
    })
  );
  usePublicTableStore.getState().setSessionUser('user-a');
  const pendingRefresh = usePublicTableStore.getState().refresh();

  usePublicTableStore.getState().setSessionUser('user-b');
  resolveStatus(MATCHED_STATUS);
  await pendingRefresh;

  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-b',
    hydrated: false,
    status: null,
    loading: false,
  });
});

it('合并同一用户同时发起的状态刷新', async () => {
  publicTableClient.fetchPublicTableStatus.mockResolvedValueOnce(IDLE_STATUS);
  usePublicTableStore.getState().setSessionUser('user-a');

  await Promise.all([
    usePublicTableStore.getState().refresh(),
    usePublicTableStore.getState().refresh(),
  ]);

  expect(publicTableClient.fetchPublicTableStatus).toHaveBeenCalledTimes(1);
  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-a',
    hydrated: true,
    status: IDLE_STATUS,
  });
});

it('同一账号重新登录时不会复用上一次会话的在途刷新', async () => {
  let resolveOldRefresh!: (status: PublicTableStatusView) => void;
  publicTableClient.fetchPublicTableStatus
    .mockReturnValueOnce(
      new Promise<PublicTableStatusView>((resolve) => {
        resolveOldRefresh = resolve;
      })
    )
    .mockResolvedValueOnce(IDLE_STATUS);
  usePublicTableStore.getState().setSessionUser('user-a');
  const oldRefresh = usePublicTableStore.getState().refresh();

  usePublicTableStore.getState().setSessionUser(null);
  usePublicTableStore.getState().setSessionUser('user-a');
  await usePublicTableStore.getState().refresh();
  resolveOldRefresh(MATCHED_STATUS);
  await oldRefresh;

  expect(publicTableClient.fetchPublicTableStatus).toHaveBeenCalledTimes(2);
  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-a',
    hydrated: true,
    status: IDLE_STATUS,
  });
});

it('较早开始的刷新响应不会覆盖稍后完成的入队操作', async () => {
  let resolveRefresh!: (status: PublicTableStatusView) => void;
  publicTableClient.fetchPublicTableStatus.mockReturnValueOnce(
    new Promise<PublicTableStatusView>((resolve) => {
      resolveRefresh = resolve;
    })
  );
  publicTableClient.joinPublicTable.mockResolvedValueOnce(WAITING_STATUS);
  usePublicTableStore.getState().setSessionUser('user-a');

  const pendingRefresh = usePublicTableStore.getState().refresh();
  await usePublicTableStore.getState().join('00000000-0000-4000-8000-000000000001');
  resolveRefresh(IDLE_STATUS);
  await pendingRefresh;

  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-a',
    hydrated: true,
    status: WAITING_STATUS,
    loading: false,
  });
});

it('状态变更进行中不会发起可能覆盖结果的刷新', async () => {
  let resolveConfirmation!: (status: PublicTableStatusView) => void;
  publicTableClient.fetchPublicTableStatus.mockResolvedValueOnce(PENDING_CONFIRMATION_STATUS);
  publicTableClient.confirmPublicTable.mockReturnValueOnce(
    new Promise<PublicTableStatusView>((resolve) => {
      resolveConfirmation = resolve;
    })
  );
  usePublicTableStore.getState().setSessionUser('user-a');
  await usePublicTableStore.getState().refresh();

  const pendingConfirmation = usePublicTableStore.getState().confirm();
  const refreshDuringConfirmation = usePublicTableStore.getState().refresh();
  resolveConfirmation(CONFIRMED_STATUS);
  await Promise.all([pendingConfirmation, refreshDuringConfirmation]);

  expect(publicTableClient.fetchPublicTableStatus).toHaveBeenCalledTimes(1);
  expect(usePublicTableStore.getState()).toMatchObject({
    sessionUserId: 'user-a',
    hydrated: true,
    status: CONFIRMED_STATUS,
    loading: false,
  });
});
