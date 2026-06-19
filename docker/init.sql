-- ============================================
-- Loveca - 自托管数据库初始化脚本
-- ============================================
-- 基于当前自托管 schema 整理
-- 权限控制、用户认证和对象存储均由当前服务端实现
-- ============================================

-- ============================================
-- 1. users 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

COMMENT ON TABLE public.users IS '用户认证表';
COMMENT ON COLUMN public.users.email IS '邮箱，可为系统生成的占位邮箱';
COMMENT ON COLUMN public.users.password_hash IS 'bcrypt 哈希后的密码';
COMMENT ON COLUMN public.users.email_verified IS '邮箱是否已验证';

-- ============================================
-- 2. refresh_tokens 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON public.refresh_tokens(expires_at);

COMMENT ON TABLE public.refresh_tokens IS 'Refresh token 存储，支持 token rotation';

-- ============================================
-- 3. email_verification_tokens 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON public.email_verification_tokens(token);

COMMENT ON TABLE public.email_verification_tokens IS '邮箱验证 token';

-- ============================================
-- 4. password_reset_tokens 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);

COMMENT ON TABLE public.password_reset_tokens IS '密码重置 token';

-- ============================================
-- 5. profiles 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  deck_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

COMMENT ON TABLE public.profiles IS '用户档案表，与 users 表 1:1 关联';
COMMENT ON COLUMN public.profiles.username IS '唯一用户名，用于登录和显示';
COMMENT ON COLUMN public.profiles.display_name IS '可选的显示昵称';
COMMENT ON COLUMN public.profiles.role IS '用户角色: user 或 admin';
COMMENT ON COLUMN public.profiles.deck_count IS '已创建卡组数量（触发器自动维护）';

-- ============================================
-- 6. decks 表
-- ============================================

CREATE TABLE IF NOT EXISTS public.decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  main_deck JSONB NOT NULL DEFAULT '[]'::jsonb,
  energy_deck JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_valid BOOLEAN NOT NULL DEFAULT false,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT false,
  share_id UUID UNIQUE DEFAULT gen_random_uuid(),
  share_enabled BOOLEAN NOT NULL DEFAULT false,
  shared_at TIMESTAMPTZ,
  forked_from_deck_id UUID REFERENCES public.decks(id) ON DELETE SET NULL,
  forked_from_share_id UUID,
  forked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS share_id UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forked_from_deck_id UUID REFERENCES public.decks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forked_from_share_id UUID,
  ADD COLUMN IF NOT EXISTS forked_at TIMESTAMPTZ;

UPDATE public.decks
SET
  share_enabled = is_public,
  shared_at = COALESCE(shared_at, CASE WHEN is_public THEN updated_at ELSE NULL END)
WHERE share_enabled IS DISTINCT FROM is_public
   OR (is_public = true AND shared_at IS NULL);

UPDATE public.decks
SET share_id = gen_random_uuid()
WHERE share_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_decks_user_id ON public.decks(user_id);
CREATE INDEX IF NOT EXISTS idx_decks_is_public ON public.decks(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_decks_share_id ON public.decks(share_id);
CREATE INDEX IF NOT EXISTS idx_decks_share_enabled ON public.decks(share_enabled) WHERE share_enabled = true;

COMMENT ON TABLE public.decks IS '用户卡组表，存储主卡组和能量卡组';
COMMENT ON COLUMN public.decks.main_deck IS '主卡组 JSON，格式: [{"card_code": "xxx", "count": n}]';
COMMENT ON COLUMN public.decks.energy_deck IS '能量卡组 JSON，格式: [{"card_code": "xxx", "count": n}]';
COMMENT ON COLUMN public.decks.share_id IS '对外分享链接使用的稳定标识';
COMMENT ON COLUMN public.decks.share_enabled IS '是否开启分享链接访问';
COMMENT ON COLUMN public.decks.shared_at IS '首次开启分享的时间';
COMMENT ON COLUMN public.decks.forked_from_deck_id IS '复制来源卡组 ID';
COMMENT ON COLUMN public.decks.forked_from_share_id IS '复制来源分享 ID';
COMMENT ON COLUMN public.decks.forked_at IS '复制保存时间';

-- ============================================
-- 7. cards 表 (合并 003, 004, 005, 006)
-- ============================================

CREATE TABLE IF NOT EXISTS public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 基础信息
  card_code TEXT UNIQUE NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN ('MEMBER', 'LIVE', 'ENERGY')),
  name TEXT NOT NULL,
  group_name TEXT,
  unit_name TEXT,

  -- 成员卡字段
  cost INT,
  blade INT,
  hearts JSONB DEFAULT '[]'::jsonb,
  blade_hearts JSONB DEFAULT NULL,

  -- Live 卡字段
  score INT,
  requirements JSONB DEFAULT '[]'::jsonb,

  -- 通用字段
  card_text TEXT,
  image_filename TEXT,
  rare TEXT,
  product TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),

  -- 元数据
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_card_code ON public.cards(card_code);
CREATE INDEX IF NOT EXISTS idx_cards_card_type ON public.cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_group_name ON public.cards(group_name);
CREATE INDEX IF NOT EXISTS idx_cards_name ON public.cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_rare ON public.cards(rare);
CREATE INDEX IF NOT EXISTS idx_cards_status ON public.cards(status);

COMMENT ON TABLE public.cards IS '卡牌数据表，存储所有成员卡、Live卡和能量卡信息';
COMMENT ON COLUMN public.cards.card_code IS '卡牌唯一编号，如 PL-sd1-001';
COMMENT ON COLUMN public.cards.card_type IS '卡牌类型: MEMBER, LIVE, ENERGY';
COMMENT ON COLUMN public.cards.hearts IS '成员卡心图标数组，格式: [{"color": "PINK", "count": 2}]';
COMMENT ON COLUMN public.cards.blade_hearts IS '应援棒心效果数组，格式: [{"effect": "DRAW", "heartColor": "PINK"}]';
COMMENT ON COLUMN public.cards.requirements IS 'Live卡心需求数组，格式: [{"color": "PINK", "count": 3}]';
COMMENT ON COLUMN public.cards.status IS '卡牌状态: DRAFT(草稿) 或 PUBLISHED(已上线)';

-- ============================================
-- 8. 对局记录与回放表
-- ============================================

CREATE TABLE IF NOT EXISTS public.match_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'ONLINE'
    CHECK (match_mode IN ('ONLINE', 'SOLITAIRE')),
  automation_game_mode TEXT NOT NULL DEFAULT 'DEBUG'
    CHECK (automation_game_mode IN ('DEBUG', 'SOLITAIRE')),
  origin_kind TEXT NOT NULL DEFAULT 'ONLINE_ROOM'
    CHECK (origin_kind IN ('ONLINE_ROOM', 'SOLITAIRE')),
  origin_label TEXT NOT NULL DEFAULT '在线房间',
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'SURRENDERED', 'INTERRUPTED', 'CORRUPTED')),
  completeness TEXT NOT NULL DEFAULT 'FULL'
    CHECK (completeness IN ('FULL', 'PARTIAL', 'INCOMPLETE')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  first_user_id TEXT NOT NULL,
  second_user_id TEXT NOT NULL,
  winner_seat TEXT CHECK (winner_seat IS NULL OR winner_seat IN ('FIRST', 'SECOND')),
  end_reason TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  last_timeline_seq INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_seq INTEGER NOT NULL DEFAULT 0,
  last_public_seq INTEGER NOT NULL DEFAULT 0,
  last_private_seq_by_seat JSONB NOT NULL DEFAULT '{"FIRST":0,"SECOND":0}'::jsonb,
  last_audit_seq INTEGER NOT NULL DEFAULT 0,
  last_command_seq INTEGER NOT NULL DEFAULT 0,
  last_game_event_seq INTEGER NOT NULL DEFAULT 0,
  record_version INTEGER NOT NULL DEFAULT 1,
  rules_version TEXT NOT NULL,
  card_data_version TEXT NOT NULL,
  card_data_hash TEXT NOT NULL,
  replay_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  replay_limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  partial_reason TEXT,
  last_recorder_error TEXT,
  append_failure_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT match_records_match_id_unique UNIQUE(match_id)
);

CREATE INDEX IF NOT EXISTS idx_match_records_first_user_id ON public.match_records(first_user_id);
CREATE INDEX IF NOT EXISTS idx_match_records_second_user_id ON public.match_records(second_user_id);
CREATE INDEX IF NOT EXISTS idx_match_records_match_mode ON public.match_records(match_mode);
CREATE INDEX IF NOT EXISTS idx_match_records_status ON public.match_records(status);
CREATE INDEX IF NOT EXISTS idx_match_records_started_at ON public.match_records(started_at);

CREATE TABLE IF NOT EXISTS public.match_deck_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_deck_snapshots_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  seat TEXT NOT NULL CHECK (seat IN ('FIRST', 'SECOND')),
  user_id TEXT NOT NULL,
  source_deck_id TEXT,
  source_deck_name TEXT,
  source TEXT NOT NULL CHECK (source IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT', 'SOLITAIRE_DEFAULT_DECK')),
  main_deck JSONB NOT NULL,
  energy_deck JSONB NOT NULL,
  card_summaries JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_state TEXT NOT NULL DEFAULT 'RUNTIME_ACCEPTED'
    CHECK (validation_state IN ('RUNTIME_ACCEPTED', 'VALID', 'INVALID')),
  card_data_version TEXT NOT NULL,
  card_data_hash TEXT NOT NULL,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_deck_snapshots_match_seat
  ON public.match_deck_snapshots(match_id, seat);
CREATE INDEX IF NOT EXISTS idx_match_deck_snapshots_user_id
  ON public.match_deck_snapshots(user_id);

CREATE TABLE IF NOT EXISTS public.match_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_participants_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  seat TEXT NOT NULL CHECK (seat IN ('FIRST', 'SECOND')),
  display_name TEXT NOT NULL,
  player_id TEXT NOT NULL,
  participant_kind TEXT NOT NULL DEFAULT 'USER'
    CHECK (participant_kind IN ('USER', 'SYSTEM')),
  owner_user_id TEXT,
  deck_snapshot_id UUID CONSTRAINT match_participants_deck_snapshot_id_match_deck_snapshots_id_fk REFERENCES public.match_deck_snapshots(id) ON DELETE SET NULL,
  replay_access TEXT NOT NULL DEFAULT 'PARTICIPANT'
    CHECK (replay_access IN ('PARTICIPANT', 'ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_participants_match_seat
  ON public.match_participants(match_id, seat);
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_participants_match_user
  ON public.match_participants(match_id, user_id);
CREATE INDEX IF NOT EXISTS idx_match_participants_user_id
  ON public.match_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_match_participants_owner_user_id
  ON public.match_participants(owner_user_id);

CREATE TABLE IF NOT EXISTS public.match_timeline_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_timeline_entries_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  timeline_seq INTEGER NOT NULL,
  frame_type TEXT NOT NULL,
  visibility_scope TEXT NOT NULL CHECK (visibility_scope IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM')),
  related_checkpoint_seq INTEGER,
  related_public_seq INTEGER,
  related_private_seq INTEGER,
  related_private_seq_by_seat JSONB NOT NULL DEFAULT '{"FIRST":0,"SECOND":0}'::jsonb,
  related_audit_seq INTEGER,
  related_command_seq INTEGER,
  related_game_event_seq INTEGER,
  related_decision_id TEXT,
  dedupe_key TEXT NOT NULL,
  turn_count INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL,
  sub_phase TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_timeline_entries_match_seq
  ON public.match_timeline_entries(match_id, timeline_seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_timeline_entries_match_dedupe
  ON public.match_timeline_entries(match_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_match_timeline_entries_match_created_at
  ON public.match_timeline_entries(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_match_timeline_entries_checkpoint
  ON public.match_timeline_entries(match_id, related_checkpoint_seq);

CREATE TABLE IF NOT EXISTS public.match_record_public_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_record_public_events_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  timeline_seq INTEGER NOT NULL,
  event_seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT,
  actor_seat TEXT CHECK (actor_seat IS NULL OR actor_seat IN ('FIRST', 'SECOND')),
  summary TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_record_public_events_match_seq
  ON public.match_record_public_events(match_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_match_record_public_events_timeline
  ON public.match_record_public_events(match_id, timeline_seq);
CREATE INDEX IF NOT EXISTS idx_match_record_public_events_type
  ON public.match_record_public_events(match_id, event_type);

CREATE TABLE IF NOT EXISTS public.match_decision_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_decision_records_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL,
  timeline_seq INTEGER NOT NULL,
  decision_schema_version INTEGER NOT NULL DEFAULT 1,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('ACTIVE_EFFECT_OPENED', 'ACTIVE_EFFECT_SUBMITTED', 'PENDING_ABILITY_ORDER_SUBMITTED', 'ACTIVATE_ABILITY_SUBMITTED', 'MULLIGAN_SUBMITTED', 'SET_LIVE_CARD_SUBMITTED', 'SELECT_SUCCESS_LIVE_SUBMITTED')),
  status TEXT NOT NULL CHECK (status IN ('OPENED', 'SUBMITTED')),
  player_id TEXT,
  event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_type TEXT,
  source_card_object_id TEXT,
  source_card_code TEXT,
  source_base_card_code TEXT,
  source_zone TEXT,
  source_slot TEXT,
  ability_id TEXT,
  trigger_condition TEXT,
  ability_category TEXT,
  ability_source_zone TEXT,
  effect_text_snapshot TEXT,
  step_id TEXT,
  step_text TEXT,
  waiting_seat TEXT CHECK (waiting_seat IS NULL OR waiting_seat IN ('FIRST', 'SECOND')),
  visible_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  visible_context_summary JSONB,
  min_select INTEGER,
  max_select INTEGER,
  can_skip BOOLEAN,
  opened_checkpoint_seq INTEGER,
  submitted_timeline_seq INTEGER,
  submitted_command_seq INTEGER,
  submission JSONB,
  result_summary TEXT,
  replay_capability TEXT NOT NULL DEFAULT 'DECISION_RECORDS_PARTIAL',
  transition_semantics TEXT NOT NULL CHECK (transition_semantics IN ('STRUCTURED', 'SNAPSHOT_AUDIT_ONLY', 'UNSTRUCTURED_MANUAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_decision_records_match_decision
  ON public.match_decision_records(match_id, decision_id);
CREATE INDEX IF NOT EXISTS idx_match_decision_records_timeline
  ON public.match_decision_records(match_id, timeline_seq);
CREATE INDEX IF NOT EXISTS idx_match_decision_records_waiting_seat
  ON public.match_decision_records(match_id, waiting_seat);

CREATE TABLE IF NOT EXISTS public.match_record_private_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_record_private_events_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  seat TEXT NOT NULL CHECK (seat IN ('FIRST', 'SECOND')),
  timeline_seq INTEGER NOT NULL,
  event_seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  related_public_seq INTEGER NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_record_private_events_match_seat_seq
  ON public.match_record_private_events(match_id, seat, event_seq);
CREATE INDEX IF NOT EXISTS idx_match_record_private_events_timeline
  ON public.match_record_private_events(match_id, timeline_seq);
CREATE INDEX IF NOT EXISTS idx_match_record_private_events_seat
  ON public.match_record_private_events(match_id, seat);

CREATE TABLE IF NOT EXISTS public.match_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL CONSTRAINT match_checkpoints_match_id_match_records_match_id_fk REFERENCES public.match_records(match_id) ON DELETE CASCADE,
  checkpoint_seq INTEGER NOT NULL,
  timeline_seq INTEGER NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('AUTHORITY', 'PLAYER_VIEW', 'PUBLIC_VIEW')),
  related_public_seq INTEGER,
  related_command_seq INTEGER,
  related_game_event_seq INTEGER,
  turn_count INTEGER NOT NULL,
  phase TEXT NOT NULL,
  sub_phase TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_compression TEXT NOT NULL DEFAULT 'NONE',
  payload_hash TEXT NOT NULL,
  visibility_scope TEXT NOT NULL CHECK (visibility_scope IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM')),
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_checkpoints_match_seq
  ON public.match_checkpoints(match_id, checkpoint_seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_checkpoints_match_timeline
  ON public.match_checkpoints(match_id, timeline_seq);
CREATE INDEX IF NOT EXISTS idx_match_checkpoints_match_created_at
  ON public.match_checkpoints(match_id, created_at);

COMMENT ON TABLE public.match_records IS '历史对局根记录，P0 记录创建与封存入口';
COMMENT ON TABLE public.match_participants IS '历史对局参与者、座位和回放权限';
COMMENT ON TABLE public.match_deck_snapshots IS '历史对局锁卡时卡组快照';
COMMENT ON TABLE public.match_timeline_entries IS '历史对局统一时间线账本';
COMMENT ON TABLE public.match_record_public_events IS '历史对局公共事件明细';
COMMENT ON TABLE public.match_decision_records IS '历史对局玩家决策记录，保存稳定选择语义而非运行时 activeEffect 原对象';
COMMENT ON TABLE public.match_record_private_events IS '历史对局按座位隔离的私密事件明细';
COMMENT ON TABLE public.match_checkpoints IS '历史对局 checkpoint payload envelope';

-- ============================================
-- 9. 触发器函数
-- ============================================

-- 维护 profiles.deck_count
CREATE OR REPLACE FUNCTION public.update_deck_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles
    SET deck_count = deck_count + 1, updated_at = now()
    WHERE id = NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
    SET deck_count = deck_count - 1, updated_at = now()
    WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 自动维护 decks.updated_at
CREATE OR REPLACE FUNCTION public.update_deck_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 自动维护 cards.updated_at (updated_by 由 API 层设置)
CREATE OR REPLACE FUNCTION public.update_card_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 自动维护 users.updated_at
CREATE OR REPLACE FUNCTION public.update_user_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. 触发器
-- ============================================

CREATE TRIGGER on_deck_change
  AFTER INSERT OR DELETE ON public.decks
  FOR EACH ROW EXECUTE FUNCTION public.update_deck_count();

CREATE TRIGGER update_deck_updated_at
  BEFORE UPDATE ON public.decks
  FOR EACH ROW EXECUTE FUNCTION public.update_deck_timestamp();

CREATE TRIGGER update_card_updated_at
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.update_card_timestamp();

CREATE TRIGGER update_user_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_user_timestamp();

-- ============================================
-- 11. 清理过期 token 的函数（可定期调用）
-- ============================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_tokens()
RETURNS integer AS $$
DECLARE
  total integer := 0;
  cnt integer;
BEGIN
  DELETE FROM public.refresh_tokens WHERE expires_at < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  DELETE FROM public.email_verification_tokens WHERE expires_at < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  DELETE FROM public.password_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  RETURN total;
END;
$$ LANGUAGE plpgsql;
