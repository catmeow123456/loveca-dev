import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bell,
  BookOpen,
  ExternalLink,
  Eye,
  Gamepad2,
  LogIn,
  Play,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { AnnouncementCenterButton, ProductHeader, ThemeToggle } from '@/components/common';
import type { PublicSiteAnnouncement, PublicSiteStatus } from '@/lib/appConfig';
import { getCardBackUrl, getCardImageUrl } from '@/lib/imageService';
import { useGameStore } from '@/store/gameStore';
import './public-home.css';

interface PublicHomePageProps {
  onLogin: () => void;
  onRegister: () => void;
  onManageDecks: () => void;
  onStartGame: () => void;
  onSpectate: () => void;
  onTryOffline: () => void;
  serviceAvailable: boolean;
  siteStatus: PublicSiteStatus;
}

const TABLE_CARDS = [
  { code: 'PL!-sd1-004-SD', label: '费用 11「园田海未」' },
  { code: 'PL!SP-bp4-008-P', label: '费用 13「若菜四季」' },
  { code: 'PL!HS-bp1-004-P', label: '费用 15「夕雾缀理」' },
  { code: 'PL!-sd1-019-SD', label: '分数 4「START:DASH!!」' },
] as const;

const PRODUCT_PATHS = [
  {
    label: '对战',
    title: '开始对战',
    detail: '真人匹配、房间对战与单人测试',
    note: '需要登录',
    icon: Gamepad2,
    action: 'game' as const,
  },
  {
    label: '卡组',
    title: '构筑与管理卡组',
    detail: '创建、导入卡组，检查是否符合构筑规则',
    note: '需要登录',
    icon: BookOpen,
    action: 'deck' as const,
  },
  {
    label: '观战',
    title: '房间观战',
    detail: '输入房间号观看对局',
    note: '无需登录',
    icon: Eye,
    action: 'spectate' as const,
  },
] as const;

const LATEST_PRODUCTS = [
  {
    type: '补充包',
    title: 'まじかる♡とり～と',
    releaseDate: '2026-11-14',
    releaseLabel: '11月14日发售',
    edition: '日本语版',
    summary: '收录 μ’s、虹咲与莲之空，并首次加入橙色 BLADE HEART。',
    image: '/images/official-products/magical-treat.webp',
    url: 'https://llofficial-cardgame.com/products/bp08_mt/',
  },
  {
    type: '周边商品',
    title: 'Love Live! Sunshine!! 收藏透明卡页＆活页夹套装',
    releaseDate: '2026-10-24',
    releaseLabel: '10月24日发售',
    edition: '日本语版',
    summary: '收录 Aqours 9 位成员、4 张 LIVE 与 3 张能量卡，附透明卡页和活页夹。',
    image: '/images/official-products/sunshine-binder.webp',
    url: 'https://llofficial-cardgame.com/products/lls_binder/',
  },
  {
    type: '高级补充包',
    title: 'Love Live! DUO',
    releaseDate: '2026-10-03',
    releaseLabel: '10月3日发售',
    edition: '日本语版',
    summary: '收录 μ’s 九位成员的新绘制插画与全新 DUO 规格卡牌。',
    image: '/images/official-products/lovelive-duo.webp',
    url: 'https://llofficial-cardgame.com/products/pbll_duo/',
  },
] as const;

const ANNOUNCEMENT_TYPE_LABELS: Record<PublicSiteAnnouncement['type'], string> = {
  MAINTENANCE: '维护',
  UPDATE: '更新',
  NEWS: '公告',
};

function formatAnnouncementDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function PublicHomePage({
  onLogin,
  onRegister,
  onManageDecks,
  onStartGame,
  onSpectate,
  onTryOffline,
  serviceAvailable,
  siteStatus,
}: PublicHomePageProps) {
  const cardCount = useGameStore((state) => state.cardDataRegistry.size);
  const announcements = siteStatus.announcements.slice(0, 3);
  const hasAnnouncements = Boolean(siteStatus.maintenance || announcements.length > 0);
  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.onerror = null;
    event.currentTarget.src = getCardBackUrl('medium');
  };

  return (
    <div className="public-home">
      <a className="public-home__skip" href="#public-home-main">
        跳到主要内容
      </a>

      <ProductHeader
        className="public-home__header"
        brandAriaLabel="Loveca 公开首页"
        brandHref="#top"
        navigation={
          <nav className="public-home__nav" aria-label="产品导航">
            <button type="button" className="product-nav-item" onClick={onManageDecks}>
              卡组
            </button>
            <button type="button" className="product-nav-item" onClick={onStartGame}>
              对战
            </button>
            <button type="button" className="product-nav-item" onClick={onSpectate}>
              观战
            </button>
            <a className="product-nav-item" href="#latest-products">
              最新商品
            </a>
            <AnnouncementCenterButton
              className="product-nav-item public-home__nav-announcement"
              siteStatus={siteStatus}
              label="公告"
            />
          </nav>
        }
        actions={
          <div className="public-home__account">
            <AnnouncementCenterButton
              className="public-home__announcement-link"
              siteStatus={siteStatus}
              iconSize={17}
              indicatorClassName="public-home__announcement-indicator"
            />
            <ThemeToggle className="public-home__theme-toggle" />
            <button
              type="button"
              className="button-ghost public-home__login-button"
              onClick={onLogin}
            >
              登录
            </button>
            <button
              type="button"
              className="button-secondary public-home__register-button"
              onClick={onRegister}
            >
              创建账号
            </button>
          </div>
        }
        mobileNavigation={
          <nav className="product-mobile-nav public-home__mobile-nav" aria-label="移动端产品导航">
            <div className="grid grid-cols-2">
              <button type="button" className="product-mobile-nav-item" onClick={onManageDecks}>
                卡组
              </button>
              <button type="button" className="product-mobile-nav-item" onClick={onStartGame}>
                对战
              </button>
              <button type="button" className="product-mobile-nav-item" onClick={onSpectate}>
                观战
              </button>
              <a className="product-mobile-nav-item" href="#latest-products">
                最新商品
              </a>
              <button type="button" className="product-mobile-nav-item" onClick={onRegister}>
                创建账号
              </button>
            </div>
          </nav>
        }
      />

      <main id="public-home-main">
        <section className="public-home__hero" id="top" aria-labelledby="public-home-title">
          <motion.div
            className="public-home__hero-copy"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="public-home__eyebrow">
              <span />
              Love Live! Series Official Card Game
            </div>
            <h1 id="public-home-title">
              <span className="public-home__hero-title-brand">Loveca</span>
              <span className="public-home__hero-title-product">在线对战</span>
            </h1>
            <p className="public-home__lead">
              Love Live! Series Official Card Game
              的非官方网页对战工具。管理卡组、寻找对手，直接在浏览器中开始对局。
            </p>

            <div className="public-home__hero-actions">
              <button type="button" className="public-home__primary-cta" onClick={onStartGame}>
                开始对战
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <button type="button" className="public-home__secondary-cta" onClick={onManageDecks}>
                管理卡组
              </button>
            </div>

            <button type="button" className="public-home__offline-link" onClick={onTryOffline}>
              <WifiOff size={14} aria-hidden="true" />
              暂不登录，进入离线模式
            </button>

            {!serviceAvailable ? (
              <div className="public-home__service-note" role="status">
                <span aria-hidden="true" />
                云端服务暂不可用；仍可查看首页或体验离线对局。
              </div>
            ) : null}
          </motion.div>

          <motion.div
            className="public-home__table-preview"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.58, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            aria-label="Loveca 对战桌预览"
          >
            <div className="public-home__table-bar">
              <span>MATCH TABLE / PLAYER SIDE</span>
              <strong>
                <i />
                READY
              </strong>
            </div>
            <div className="public-home__playmat">
              <div className="public-home__zone public-home__zone--deck">
                <small>MAIN</small>
                <img src={getCardBackUrl('medium')} alt="主卡组" onError={handleImageError} />
              </div>
              <div className="public-home__zone public-home__zone--live">
                <small>LIVE</small>
                <img
                  src={getCardImageUrl(TABLE_CARDS[3].code, 'medium')}
                  alt={`${TABLE_CARDS[3].code} ${TABLE_CARDS[3].label}`}
                  onError={handleImageError}
                />
              </div>
              <div className="public-home__stage-slots" aria-label="成员区">
                {TABLE_CARDS.slice(0, 3).map((card, index) => (
                  <figure key={card.code}>
                    <small>{index === 0 ? 'LEFT' : index === 1 ? 'CENTER' : 'RIGHT'}</small>
                    <img
                      src={getCardImageUrl(card.code, 'medium')}
                      alt={`${card.code} ${card.label}`}
                      onError={handleImageError}
                    />
                  </figure>
                ))}
              </div>
              <div className="public-home__turn-marker">
                <span>MAIN</span>
                <strong>你的回合</strong>
              </div>
            </div>
            <div className="public-home__table-caption">
              <span>已支持卡效自动处理</span>
              <small>
                {cardCount > 0
                  ? `当前可使用 ${cardCount.toLocaleString('zh-CN')} 张卡牌`
                  : '卡牌持续更新'}
              </small>
            </div>
          </motion.div>
        </section>

        <section className="public-home__paths" aria-label="选择下一步">
          {PRODUCT_PATHS.map((path) => {
            const Icon = path.icon;
            const onClick =
              path.action === 'game'
                ? onStartGame
                : path.action === 'deck'
                  ? onManageDecks
                  : onSpectate;

            return (
              <button type="button" onClick={onClick} key={path.label}>
                <span className="public-home__path-label">{path.label}</span>
                <Icon size={19} aria-hidden="true" />
                <span className="public-home__path-copy">
                  <strong>{path.title}</strong>
                  <small>{path.detail}</small>
                </span>
                <span className="public-home__path-note">{path.note}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            );
          })}
        </section>

        <section
          className="public-home__announcements"
          id="announcements"
          aria-labelledby="public-home-announcements-title"
        >
          <header className="public-home__announcements-header">
            <div>
              <span>SITE NOTICE</span>
              <h2 id="public-home-announcements-title">公告</h2>
            </div>
            <p>{hasAnnouncements ? '查看近期更新与维护安排。' : '当前服务运行正常。'}</p>
          </header>

          <div className="public-home__announcement-list">
            {siteStatus.maintenance ? (
              <article className="public-home__announcement public-home__announcement--maintenance">
                <div>
                  <span>服务状态</span>
                  {formatAnnouncementDate(siteStatus.maintenance.startsAt) ? (
                    <time dateTime={siteStatus.maintenance.startsAt ?? undefined}>
                      {formatAnnouncementDate(siteStatus.maintenance.startsAt)}
                    </time>
                  ) : null}
                </div>
                <h3>{siteStatus.maintenance.title}</h3>
                <p>{siteStatus.maintenance.summary}</p>
              </article>
            ) : null}

            {announcements.map((announcement) => {
              const timestamp = announcement.startsAt ?? announcement.publishedAt;
              const dateLabel = formatAnnouncementDate(timestamp);

              return (
                <article className="public-home__announcement" key={announcement.id}>
                  <div>
                    <span>{ANNOUNCEMENT_TYPE_LABELS[announcement.type]}</span>
                    {dateLabel ? <time dateTime={timestamp ?? undefined}>{dateLabel}</time> : null}
                  </div>
                  <h3>{announcement.title}</h3>
                  <p>{announcement.summary}</p>
                </article>
              );
            })}

            {!hasAnnouncements ? (
              <div className="public-home__announcement-empty">
                <Bell size={18} aria-hidden="true" />
                <div>
                  <strong>暂无新公告</strong>
                  <span>维护安排和版本更新会在这里发布。</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section
          className="public-home__latest-products"
          id="latest-products"
          aria-labelledby="latest-products-title"
        >
          <header className="public-home__latest-products-header">
            <div>
              <span>OFFICIAL PRODUCTS</span>
              <h2 id="latest-products-title">Loveca 最新商品</h2>
              <p>
                来自 Bushiroad 官方网站的近期发售信息。2026 年 5 月后的新商品均为日本语版。
                官网另已公布 12 月发售的
                <a
                  href="https://llofficial-cardgame.com/products/pbls_duo/"
                  target="_blank"
                  rel="noreferrer"
                >
                  「Love Live! Sunshine!! DUO」
                </a>
                ，具体日期尚未公布。
              </p>
            </div>
            <a href="https://llofficial-cardgame.com/products/" target="_blank" rel="noreferrer">
              查看全部官方商品
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </header>

          <div className="public-home__latest-products-grid">
            {LATEST_PRODUCTS.map((product, index) => (
              <article
                className={
                  index === 0
                    ? 'public-home__product public-home__product--featured'
                    : 'public-home__product'
                }
                key={product.title}
              >
                <div className="public-home__product-media">
                  <img src={product.image} alt={`${product.title} 商品包装`} loading="lazy" />
                </div>
                <div className="public-home__product-body">
                  <div className="public-home__product-meta">
                    <span>{product.type}</span>
                    <span>{product.edition}</span>
                    <time dateTime={product.releaseDate}>{product.releaseLabel}</time>
                  </div>
                  <h3>{product.title}</h3>
                  <p>{product.summary}</p>
                  <a href={product.url} target="_blank" rel="noreferrer">
                    查看官方商品页
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>

          <footer className="public-home__latest-products-footer">
            <span>信息来源：Bushiroad Loveca 官方网站</span>
            <span>整理于 2026.08.13 · 商品名称与日期以官方页面为准</span>
          </footer>
        </section>

        <section className="public-home__closing">
          <div>
            <Sparkles size={18} aria-hidden="true" />
            <p>准备开始？</p>
            <h2>登录后即可使用云端卡组并参加在线对战。</h2>
          </div>
          <button type="button" onClick={onLogin}>
            <LogIn size={18} aria-hidden="true" />
            登录 Loveca
          </button>
          <button type="button" onClick={onRegister}>
            还没有账号？创建一个
          </button>
        </section>
      </main>

      <footer className="public-home__footer">
        <div>
          <img src="/icon.jpg" alt="" />
          <span>
            <strong>Loveca</strong>
            <small>玩家制作的非官方卡组与对战工具</small>
          </span>
        </div>
        <p>卡牌与作品版权归原权利方所有 · v{__APP_VERSION__}</p>
        <button type="button" onClick={onTryOffline}>
          <Play size={13} aria-hidden="true" />
          体验离线对局
        </button>
      </footer>
    </div>
  );
}
