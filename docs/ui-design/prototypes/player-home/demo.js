(() => {
  const query = new URLSearchParams(location.search);
  const valid = (value, values, fallback) => values.includes(value) ? value : fallback;
  const state = {
    variant: valid(query.get('variant'), ['a', 'b', 'c'], 'c'),
    scenario: valid(query.get('scenario'), ['normal', 'room', 'empty', 'offline'], 'normal'),
    count: valid(query.get('count'), ['1', '5', '20'], '5'),
    mode: 'casual',
    selected: 0,
  };
  const shortcutOptions = [
    { id: 'tutorial', label: '新手教程', icon: 'learn' },
    { id: 'spectate', label: '观战', icon: 'eye' },
    { id: 'history', label: '历史对局', icon: 'history' },
    { id: 'practice', label: '本地练习', icon: 'room' },
    { id: 'decks', label: '卡组管理', icon: 'cards' },
    { id: 'debug', label: '双人调试', icon: 'room' },
    { id: 'announcements', label: '公告', icon: 'bell' },
  ];
  const defaultShortcuts = ['tutorial', 'spectate', 'history', 'practice'];
  const shortcutStorageKey = 'loveca:lobby-demo:shortcuts:v1';
  function readShortcuts() {
    try {
      const saved = JSON.parse(localStorage.getItem(shortcutStorageKey));
      if (Array.isArray(saved)) return [...new Set(saved.filter(id => shortcutOptions.some(option => option.id === id)))];
    } catch { /* Keep the demo usable when browser storage is unavailable. */ }
    return [...defaultShortcuts];
  }
  let shortcuts = readShortcuts();
  let shortcutDraft = null;
  const paths = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    cards: '<rect x="7" y="3" width="12" height="17" rx="2"/><path d="M5 7H4a1 1 0 0 0-1 1v12a2 2 0 0 0 2 2h9M10 7h6M10 10h6"/>',
    play: '<path d="m9 5 11 7-11 7V5Z"/>',
    trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 13v6M8 21h8"/>',
    sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
    learn: '<path d="m3 6 9-3 9 3v13l-9 3-9-3V6ZM12 3v19M6 9l3 1M15 10l3-1"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    room: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 12h4M9 10v4M16 11h.01M18 14h.01"/>',
    alert: '<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01"/>',
    bell: '<path d="M5 17h14l-2-3v-4a5 5 0 0 0-10 0v4l-2 3ZM10 21h4M12 3V1"/>',
    logout: '<path d="M9 4H4v16h5M9 12h12M17 8l4 4-4 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    edit: '<path d="m16 3 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  const baseDecks = [
    { name: 'Liella! · 放课后的约定', group: 'Liella!', style: '蓝紫构筑', card: 'kanon-card.webp', art: 'kanon.webp', pt: 5 },
    { name: '莲之空 · 绿叶与花', group: '莲之空', style: '绿莲构筑', card: 'kaho-card.webp', art: 'rurino.webp', pt: 0 },
    { name: '虹咲 · 一起绽放', group: '虹咲学园', style: '蓝紫构筑', card: 'ayumu-card.webp', art: 'rina.webp', pt: 7 },
    { name: "μ’s · 音乃木坂的舞台", group: 'μ’s', style: '均衡构筑', card: 'honoka-card.webp', art: 'hanayo.webp', pt: 2 },
    { name: 'Liella! · 星光练习曲', group: 'Liella!', style: '练习构筑', card: 'kanon-card.webp', art: 'keke.webp', pt: 4 },
  ];
  const modes = {
    casual: { label: '对战大厅', short: '自由对战', icon: 'room', action: '进入对战大厅', detail: '创建房间，或加入其他玩家的对局。', title: '和其他玩家，一起 LIVE。' },
    ranked: { label: '赛季排位', short: '赛季排位', icon: 'trophy', action: '前往赛季排位', detail: '查看当前赛季，准备你的排位对局。', title: '为下一场胜利，做好准备。' },
    event: { label: '娱乐模式', short: '娱乐模式', icon: 'sparkle', action: '前往娱乐模式', detail: '使用平台预组卡组，轻松开始一场对战。', title: '换一种构筑，发现新联动。' },
  };
  const app = document.querySelector('#app');
  const dialog = document.querySelector('#preview-dialog');
  const dialogContent = document.querySelector('#dialog-content');
  const isEmpty = () => state.scenario === 'empty';
  const isOffline = () => state.scenario === 'offline';
  const hasRoom = () => state.scenario === 'room';
  const getDeck = index => {
    const base = baseDecks[index % baseDecks.length];
    return { ...base, name: `${base.name}${index >= baseDecks.length ? ` ${Math.floor(index / baseDecks.length) + 1}` : ''}` };
  };
  const deck = () => getDeck(state.selected);
  const displayDeck = () => state.mode === 'event' ? baseDecks[3] : deck();
  const image = (file, cls = '', alt = '') => `<img src="assets/${file}" class="${cls}" alt="${alt}" draggable="false" />`;
  const button = (text, action, cls = 'text-button', tail = 'arrow') => `<button type="button" class="${cls}" data-action="${action}">${text}${tail ? icon(tail) : ''}</button>`;
  const mark = (text, type = '') => `<span class="status ${type}">${type === 'ready' ? '<i></i>' : ''}${text}</span>`;

  function header() {
    return `<header class="product-header"><div class="header-inner">
      <button class="brand" data-action="home" aria-label="Loveca 大厅"><span class="brand-symbol">L<span>✦</span></span><span>Loveca</span></button>
      <nav class="desktop-nav" aria-label="主导航">${[['大厅', 'home'], ['卡组', 'decks'], ['对战', 'casual'], ['观战', 'spectate'], ['历史', 'history']].map(([name, action]) => `<button class="nav-item ${action === 'home' ? 'active' : ''}" ${action === 'home' ? 'aria-current="page"' : ''} data-action="${action}">${name}</button>`).join('')}</nav>
      <div class="header-tools"><button class="icon-button announcements" data-action="announcements" aria-label="公告">${icon('bell')}</button><button class="profile-button" data-action="account">${image('avatar.webp', '', '')}<span>小星</span></button><button class="logout-button" data-action="logout">${icon('logout')}<span>退出登录</span></button><button class="icon-button mobile-menu-button" data-action="menu" aria-label="打开导航菜单" aria-expanded="false">${icon('menu')}</button></div>
      <nav class="mobile-menu" aria-label="移动导航" hidden>${[['大厅', 'home'], ['卡组', 'decks'], ['对战', 'casual'], ['观战', 'spectate'], ['历史', 'history'], ['公告', 'announcements'], ['账户', 'account'], ['退出登录', 'logout']].map(([name, action]) => `<button data-action="${action}">${name}</button>`).join('')}</nav>
    </div></header>`;
  }

  function offlineNotice() {
    return isOffline() ? `<div class="connection-notice" role="status">${icon('alert')}<div><strong>暂时无法连接服务器</strong><span>联网对战暂不可用。你仍可查看卡组或进入教程。</span></div>${button('重新连接', 'retry', 'small-button', '')}</div>` : '';
  }

  function pageHeading() {
    return `<div class="page-heading"><div><p class="greeting">欢迎回来，小星</p><h1>${hasRoom() ? '你的房间还在等你。' : '下一场 LIVE，准备开始。'}</h1></div>${hasRoom() ? mark('有进行中的房间', 'ready') : ''}</div>`;
  }

  function modeTabs() {
    return `<div class="mode-tabs" role="tablist" aria-label="选择玩法">${Object.entries(modes).map(([id, m]) => `<button role="tab" aria-selected="${state.mode === id}" data-mode="${id}" class="mode-tab ${state.mode === id ? 'selected' : ''}">${icon(m.icon)}${m.short}</button>`).join('')}</div>`;
  }

  function deckSummary(size = '') {
    const d = deck();
    if (state.mode === 'event') return `<div class="deck-summary platform-summary ${size}"><div class="platform-icon">${icon('sparkle')}</div><div class="deck-summary-text"><span class="field-label">本场卡组</span><strong>平台预组卡组</strong><p>在娱乐模式中选择</p></div>${mark('无需自建卡组')}</div>`;
    if (isEmpty()) return `<div class="deck-summary empty-summary ${size}"><div class="platform-icon">${icon('cards')}</div><div class="deck-summary-text"><strong>还没有自己的卡组</strong><p>也可以先用平台预组体验娱乐模式。</p></div>${button('构筑卡组', 'create', 'small-button', 'arrow')}</div>`;
    return `<div class="deck-summary ${size}"><button class="deck-thumbnail" data-action="view-deck" aria-label="查看当前卡组 ${d.name}">${image(d.card, '', '')}</button><div class="deck-summary-text"><span class="field-label">当前卡组</span><button class="deck-name" data-action="view-deck">${d.name}</button><p>${d.group}<span class="separator">·</span>${mark('可用', 'ready')}</p></div><div class="deck-summary-actions">${button('更换', 'choose-deck', 'text-button', '')}${button('查看构筑', 'view-deck', 'text-button secondary-text', '')}</div></div>`;
  }

  function mainAction(extra = '') {
    if (hasRoom()) return `${button('返回房间', 'resume', `primary-button ${extra}`, 'arrow')}<p class="action-caption">自由对战 · 房间 <span class="mono">LC-2048</span> · 等待准备</p>`;
    const unavailable = isOffline() || (isEmpty() && state.mode !== 'event');
    return `<button class="primary-button ${extra}" data-action="launch" ${unavailable ? 'disabled' : ''}>${modes[state.mode].action}${icon('arrow')}</button>${isEmpty() && state.mode !== 'event' ? `<p class="action-caption">需要一副自建卡组，或${button('体验娱乐模式', 'select-event', 'inline-button', '')}</p>` : ''}`;
  }

  function roomStrip() {
    return hasRoom() ? `<div class="room-strip">${icon('room')}<div><strong>房间 <span class="mono">LC-2048</span></strong><span>自由对战 · 等待你准备 · 小星 × 凛</span></div>${mark('可返回', 'ready')}</div>` : '';
  }

  function utilityLinks() {
    return `<div class="utility-links">${button('新手教程', 'tutorial', 'utility-link', 'learn')}${button('观战', 'spectate', 'utility-link', 'eye')}${button('历史对局', 'history', 'utility-link', 'history')}<details class="more-tools"><summary>更多${icon('chevron')}</summary><div>${button('本地练习', 'practice', 'text-button', '')}${button('双人调试', 'debug', 'text-button', '')}${button('管理卡组', 'decks', 'text-button', '')}</div></details></div>`;
  }

  function recentMatch(kind = '') {
    return `<section class="recent-match ${kind}"><div class="section-heading"><h2>最近一场</h2>${button('全部历史', 'history', 'text-button', 'arrow')}</div><button class="match-preview" data-action="replay"><div class="match-avatars">${image('avatar.webp', '', '')}<span>VS</span><span class="opponent-avatar">凛</span></div><div class="match-text"><strong>小星 <span>vs</span> 凛</strong><span>自由对战 · 昨天 21:36</span></div><span class="match-result">已结束${icon('chevron')}</span></button></section>`;
  }

  function commonEntries() {
    return `<section class="c-common-entries" aria-labelledby="common-entries-title"><div class="section-heading"><h2 id="common-entries-title">常用入口</h2>${button('自定义', 'customize-shortcuts', 'text-button secondary-text', 'edit')}</div>${shortcuts.length ? `<div class="c-shortcut-grid">${shortcuts.map(id => {
      const entry = shortcutOptions.find(option => option.id === id);
      return `<button class="c-shortcut" data-action="${entry.id}">${icon(entry.icon)}<span>${entry.label}</span></button>`;
    }).join('')}</div>` : '<p class="c-shortcuts-empty">按你的习惯添加入口。</p>'}</section>`;
  }

  function editShortcuts(focusSelector) {
    const entries = [...shortcutDraft, ...shortcutOptions.map(option => option.id).filter(id => !shortcutDraft.includes(id))];
    openDialog('自定义常用入口', `<p class="dialog-intro">选择需要的入口，并调整显示顺序。</p><div class="shortcut-editor-list">${entries.map(id => {
      const entry = shortcutOptions.find(option => option.id === id);
      const index = shortcutDraft.indexOf(id);
      return `<div class="shortcut-editor-row"><label class="shortcut-choice"><input type="checkbox" data-shortcut="${id}" ${index >= 0 ? 'checked' : ''}>${icon(entry.icon)}<span>${entry.label}</span></label>${index >= 0 ? `<div class="shortcut-move-actions"><button class="icon-button" data-shortcut-move="${id}" data-direction="up" aria-label="上移${entry.label}" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="icon-button" data-shortcut-move="${id}" data-direction="down" aria-label="下移${entry.label}" ${index === shortcutDraft.length - 1 ? 'disabled' : ''}>${icon('down')}</button></div>` : ''}</div>`;
    }).join('')}</div><div class="shortcut-editor-actions">${button('恢复默认', 'reset-shortcuts', 'text-button secondary-text', '')}<div>${button('取消', 'close-dialog', 'secondary-button', '')}${button('保存', 'save-shortcuts', 'primary-button', '')}</div></div>`, 'shortcut-editor');
    if (focusSelector) dialogContent.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function customizeShortcuts() {
    shortcutDraft = [...shortcuts];
    editShortcuts();
  }

  function saveShortcuts() {
    shortcuts = [...shortcutDraft];
    let stored = true;
    try { localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcuts)); }
    catch { stored = false; }
    dialog.close();
    render();
    document.querySelector('[data-action="customize-shortcuts"]')?.focus({ preventScroll: true });
    toast(stored ? '常用入口已保存' : '已应用到当前预览；浏览器未允许保存设置');
  }

  function renderA() {
    const d = displayDeck();
    return `<main class="lobby lobby-a">${pageHeading()}${offlineNotice()}<div class="a-main-layout"><section class="a-launch"><div class="a-launch-header"><h2>${hasRoom() ? '继续你的对局' : '准备下一场对战'}</h2>${button('管理卡组', 'decks', 'text-button secondary-text', 'cards')}</div>${roomStrip()}${modeTabs()}<div class="a-launch-body"><div class="a-card-stage"><div class="card-shadow"></div>${image('honoka-card.webp', 'card-back card-back-two', '')}${image('kaho-card.webp', 'card-back card-back-one', '')}<button class="showcase-card" data-action="${state.mode === 'event' ? 'platform-decks' : isEmpty() ? 'create' : 'view-deck'}" aria-label="${state.mode === 'event' ? '查看平台预组卡组' : isEmpty() ? '创建卡组' : '查看当前卡组'}">${image(d.card, '', '')}</button><div class="stage-caption">${state.mode === 'event' ? '平台预组' : d.group}</div></div><div class="a-launch-content"><p class="field-label">${modes[state.mode].short}</p><h3>${hasRoom() ? '熟悉的舞台，继续上场。' : modes[state.mode].title}</h3><p class="mode-description">${modes[state.mode].detail}</p>${deckSummary()}<div class="launch-action">${mainAction()}</div></div></div></section><aside class="a-aside">${recentMatch()}<section class="learning-entry"><div class="learning-symbol">${icon('learn')}</div><h2>第一次来到 Loveca？</h2><p>跟着教程，完成你的第一场 LIVE。</p>${button('进入新手教程', 'tutorial', 'secondary-button', 'arrow')}</section></aside></div>${utilityLinks()}<footer class="lobby-footer"><span>Loveca · 非官方网页对战工具</span>${button('公告', 'announcements', 'text-button', '')}</footer></main>`;
  }

  function renderB() {
    const d = displayDeck();
    return `<main class="lobby lobby-b">${offlineNotice()}<div class="b-stage ${hasRoom() ? 'has-room' : ''}"><div class="stage-light light-one"></div><div class="stage-light light-two"></div><div class="b-stage-copy"><p class="greeting">欢迎回来，小星</p><h1>${hasRoom() ? '回到舞台，\n继续上场。' : '让喜欢的她们，\n站上下一场舞台。'}</h1><div class="b-task-label">${icon(hasRoom() ? 'room' : modes[state.mode].icon)}<span>${hasRoom() ? '房间 LC-2048 · 等待准备' : modes[state.mode].short}</span></div>${modeTabs()}${deckSummary('dark-summary')}<div class="launch-action">${mainAction()}</div></div><div class="b-stage-art" aria-hidden="true"><div class="stage-ring ring-one"></div><div class="stage-ring ring-two"></div><span class="stage-word">${d.group === 'Liella!' ? 'Liella!' : d.group}</span>${image(d.art, 'stage-character', '')}<div class="stage-plinth"></div></div><button class="b-card-inspect" data-action="${state.mode === 'event' ? 'platform-decks' : isEmpty() ? 'create' : 'view-deck'}">${image(d.card, '', '')}<span>${state.mode === 'event' ? '查看平台预组' : isEmpty() ? '创建卡组' : '查看当前构筑'}${icon('arrow')}</span></button></div><section class="b-lower"><div class="b-shortcuts">${[['learn', '新手教程', 'tutorial'], ['eye', '观战', 'spectate'], ['history', '历史对局', 'history'], ['cards', '卡组管理', 'decks']].map(([i, name, a]) => `<button class="stage-shortcut" data-action="${a}">${icon(i)}<span>${name}</span>${icon('chevron')}</button>`).join('')}</div>${recentMatch('b-recent')}</section><details class="b-more"><summary>更多工具${icon('chevron')}</summary><div>${button('本地练习', 'practice', 'text-button', '')}${button('双人调试', 'debug', 'text-button', '')}${button('公告', 'announcements', 'text-button', '')}</div></details><footer class="lobby-footer"><span>Loveca · 非官方网页对战工具</span><span>和你喜欢的学园偶像，一起 LIVE。</span></footer></main>`;
  }

  function renderC() {
    const d = deck();
    return `<main class="lobby lobby-c">
      <div class="c-heading"><div><p class="greeting">欢迎回来，小星</p><h1>Loveca 大厅</h1></div></div>
      ${offlineNotice()}
      ${hasRoom() ? `<section class="c-room-banner">${roomStrip()}${mainAction('compact')}</section>` : ''}
      <div class="c-main-layout">
        <section class="c-mode-directory" aria-label="选择玩法">${Object.entries(modes).map(([id, m]) => `<button class="c-mode-row ${state.mode === id ? 'selected' : ''}" data-mode="${id}" aria-pressed="${state.mode === id}"><span class="mode-row-icon">${icon(m.icon)}</span><span class="mode-row-copy"><strong>${m.label}</strong><span>${id === 'casual' ? '自由选组 · 创建或加入房间' : id === 'ranked' ? '当前赛季 · 实力较量' : '平台预组 · 轻松体验'}</span></span><span class="mode-row-status">${id === 'casual' ? '自由对战' : id === 'ranked' ? '开放中' : '无需组卡'}</span>${icon('chevron')}</button>`).join('')}</section>
        <section class="c-mode-detail" aria-label="对战准备">
          <div class="c-deck-image"><button data-action="${state.mode === 'event' ? 'platform-decks' : isEmpty() ? 'create' : 'view-deck'}" aria-label="${state.mode === 'event' ? '查看平台预组' : isEmpty() ? '创建卡组' : '查看当前卡组'}">${image(state.mode === 'event' ? 'honoka-card.webp' : d.card, '', '')}</button><div><p class="field-label">${state.mode === 'event' ? '使用卡组' : '当前卡组'}</p><h2>${state.mode === 'event' ? '平台预组' : isEmpty() ? '还没有卡组' : d.name}</h2>${state.mode === 'event' ? '<span class="muted">无需自建卡组</span>' : isEmpty() ? button('构筑卡组', 'create', 'text-button', 'arrow') : button('更换卡组', 'choose-deck', 'text-button', 'arrow')}</div></div>
          ${!isEmpty() && state.mode !== 'event' ? `<div class="c-deck-meta">${mark('构筑可用', 'ready')}${button('查看构筑', 'view-deck', 'text-button secondary-text', '')}</div>` : ''}
          <div class="launch-action">${hasRoom() ? button('查看房间状态', 'resume', 'secondary-button', 'arrow') : mainAction()}</div>
        </section>
        ${commonEntries()}
        ${recentMatch('c-recent')}
      </div>
      <footer class="lobby-footer"><span>Loveca · 非官方网页对战工具</span>${button('公告', 'announcements', 'text-button', '')}</footer>
    </main>`;
  }

  function render() {
    document.body.dataset.variant = state.variant;
    document.body.dataset.scenario = state.scenario;
    app.innerHTML = header() + ({ a: renderA, b: renderB, c: renderC }[state.variant])();
    for (const id of ['variant', 'scenario', 'count']) document.querySelector(`#${id}`).value = state[id];
    document.querySelector('#count').disabled = isEmpty();
    if (isEmpty()) document.querySelector('#count').value = '0';
    const params = new URLSearchParams({ variant: state.variant, scenario: state.scenario, count: state.count });
    try { history.replaceState(null, '', `${location.pathname}?${params}`); } catch { /* file preview still works when history is unavailable. */ }
    document.title = `Loveca 大厅 · ${state.variant.toUpperCase()} ${ { a: '快捷开局', b: '舞台大厅', c: '对战中心' }[state.variant] }`;
  }

  function openDialog(title, body, type = '') {
    dialogContent.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body ${type}">${body}</div>`;
    if (!dialog.open) dialog.showModal();
  }

  function chooseDeck() {
    if (isEmpty()) return createDeck();
    const count = Number(state.count);
    openDialog('选择这次使用的卡组', `<p class="dialog-intro">${count} 副卡组 · 当前选择仅用于本次预览</p><div class="deck-picker">${Array.from({ length: count }, (_, index) => {
      const d = getDeck(index);
      return `<button class="deck-option ${state.selected === index ? 'selected' : ''}" data-deck="${index}" aria-pressed="${state.selected === index}">${image(d.card, '', '')}<span><strong>${d.name}</strong><span>${d.group} · ${d.pt}/9 PT · 可用</span></span>${state.selected === index ? icon('check') : icon('chevron')}</button>`;
    }).join('')}</div>`);
  }

  function manageDecks() {
    if (isEmpty()) return createDeck();
    const count = Number(state.count);
    openDialog('管理卡组', `<p class="dialog-intro">共 ${count} 副卡组</p><div class="deck-picker">${Array.from({ length: count }, (_, index) => {
      const d = getDeck(index);
      return `<button class="deck-option" data-inspect="${index}">${image(d.card, '', '')}<span><strong>${d.name}</strong><span>${d.group} · ${d.pt}/9 PT · 查看构筑</span></span>${icon('chevron')}</button>`;
    }).join('')}</div><p class="preview-only-note">卡组管理目的地预览；编辑与保存操作在正式页面处理。</p>`);
  }

  function viewDeck(index = state.selected) {
    if (isEmpty()) return createDeck();
    const d = getDeck(index);
    openDialog(d.name, `<div class="deck-detail-hero">${image(d.card, '', `${d.group} 代表卡面`)}<div>${mark('构筑可用', 'ready')}<p>${d.group} · ${d.style}</p><dl class="deck-stat-list"><div><dt>成员</dt><dd>48 / 48</dd></div><div><dt>LIVE</dt><dd>12 / 12</dd></div><div><dt>能量</dt><dd>12 / 12</dd></div><div><dt>PT</dt><dd>${d.pt} / 9</dd></div></dl></div></div><div class="dialog-actions">${button('更换卡组', 'choose-deck', 'secondary-button', '')}<button class="primary-button" data-use-deck="${index}">使用这副卡组${icon('check')}</button></div>`);
  }

  function createDeck() {
    openDialog('开始你的第一副卡组', `<p class="dialog-intro">构筑属于你的组合，或直接使用平台预组开始体验。</p><div class="destination-choices"><button data-action="empty-builder">${icon('cards')}<span><strong>创建空白卡组</strong><span>进入卡组编辑器</span></span>${icon('chevron')}</button><button data-action="empty-platform">${icon('sparkle')}<span><strong>先体验娱乐模式</strong><span>使用平台预组，无需自建卡组</span></span>${icon('chevron')}</button><button data-action="tutorial">${icon('learn')}<span><strong>进入新手教程</strong><span>从第一次 LIVE 开始</span></span>${icon('chevron')}</button></div>`);
  }

  function launch() {
    if (isOffline()) {
      toast('连接中断，联网对战与平台预组暂不可用。请先重新连接。');
      return;
    }
    const m = modes[state.mode];
    openDialog(m.label, `<div class="destination-preview"><div class="destination-icon">${icon(m.icon)}</div><h3>${state.mode === 'casual' ? '准备前往对战大厅' : state.mode === 'ranked' ? '准备前往赛季排位' : '选择一副平台预组'}</h3><p>${m.detail}</p>${state.mode === 'event' ? `<div class="platform-decks">${[baseDecks[3], baseDecks[0], baseDecks[1]].map(d => `<button data-platform="${d.group}">${image(d.card, '', '')}<span>${d.group}</span>${icon('chevron')}</button>`).join('')}</div>` : `<div class="destination-current">${image(deck().card, '', '')}<div><span>携带卡组</span><strong>${deck().name}</strong></div>${mark('可用', 'ready')}</div><div class="preview-room-row"><span>${state.mode === 'casual' ? '创建房间 / 加入房间' : '查看赛季 / 进入候场'}</span><span class="muted">下一个页面</span></div>`}<p class="preview-only-note">到达预览终点，未创建房间或开始匹配。</p>${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`);
  }

  function resume() {
    openDialog('房间 LC-2048', `<div class="room-preview"><div class="room-preview-header">${mark('等待准备', 'ready')}<span>自由对战</span></div><div class="room-player-grid"><div>${image('avatar.webp', '', '')}<strong>小星</strong><span>尚未准备</span></div><span class="versus">VS</span><div><span class="room-avatar">凛</span><strong>凛</strong><span>已准备</span></div></div><div class="room-current">${image(deck().card, '', '')}<div><span>当前卡组</span><strong>${deck().name}</strong></div></div><p class="preview-only-note">这是房间的视觉预览，未连接实际房间。</p>${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`);
  }

  function historyPreview() {
    openDialog('历史对局', `<div class="history-list">${[['昨天 21:36', '凛', '自由对战'], ['昨天 20:18', '海未', '娱乐模式'], ['周日 19:42', '可可', '自由对战']].map(([time, name, mode]) => `<button data-action="replay"><div><strong>小星 <span class="muted">vs</span> ${name}</strong><span>${mode} · ${time}</span></div><span>查看回放${icon('chevron')}</span></button>`).join('')}</div>`);
  }

  function infoPreview(kind) {
    const info = {
      tutorial: ['新手教程', '完成你的第一场 LIVE', '认识卡牌、登场成员与 LIVE 的基本操作。', 'learn'],
      spectate: ['观战', '选择一场对局', '这里只展示获准的公开视角。', 'eye'],
      practice: ['本地练习', '用自己的卡组，熟悉操作', '前往本地练习准备界面。', 'room'],
      debug: ['双人调试', '本地双人调试', '前往双人调试准备界面。', 'room'],
      'empty-builder': ['卡组编辑器', '创建你的第一副卡组', '在卡组编辑器中选择成员、LIVE 与能量卡。', 'cards'],
      replay: ['对局回放', '小星 vs 凛', '自由对战 · 昨天 21:36 · 对局已结束', 'history'],
    }[kind];
    openDialog(info[0], `<div class="destination-preview"><div class="destination-icon">${icon(info[3])}</div><h3>${info[1]}</h3><p>${info[2]}</p>${kind === 'spectate' ? `<div class="preview-room-row"><strong>海未 × 可可</strong>${button('预览观战', 'spectator-preview', 'small-button', 'arrow')}</div>` : ''}${kind === 'tutorial' ? `<ol class="tutorial-steps"><li>认识你的卡组</li><li>让成员登场</li><li>完成一场 LIVE</li></ol>` : ''}${kind === 'replay' ? `<div class="replay-preview"><span>LIVE 3</span><div class="replay-line"></div><span>对局结束</span></div>` : ''}<p class="preview-only-note">这是入口的下一步预览，未进入实际对局。</p>${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`);
  }

  let toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    const el = document.querySelector('#toast');
    el.textContent = message;
    el.classList.add('visible');
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.shortcutMove && shortcutDraft) {
      const id = target.dataset.shortcutMove;
      const index = shortcutDraft.indexOf(id);
      const next = index + (target.dataset.direction === 'up' ? -1 : 1);
      if (index < 0 || next < 0 || next >= shortcutDraft.length) return;
      [shortcutDraft[index], shortcutDraft[next]] = [shortcutDraft[next], shortcutDraft[index]];
      const step = target.dataset.direction === 'up' ? -1 : 1;
      const canMoveAgain = next + step >= 0 && next + step < shortcutDraft.length;
      editShortcuts(canMoveAgain ? `[data-shortcut-move="${id}"][data-direction="${target.dataset.direction}"]` : `[data-shortcut="${id}"]`);
      return;
    }
    if (target.dataset.mode) {
      state.mode = target.dataset.mode;
      render();
      document.querySelector(`[data-mode="${state.mode}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.deck !== undefined) {
      state.selected = Number(target.dataset.deck);
      dialog.close();
      render();
      toast(`已选用 ${deck().name}`);
      return;
    }
    if (target.dataset.inspect !== undefined) {
      viewDeck(Number(target.dataset.inspect));
      return;
    }
    if (target.dataset.useDeck !== undefined) {
      state.selected = Number(target.dataset.useDeck);
      dialog.close();
      render();
      toast(`已选用 ${deck().name}`);
      return;
    }
    if (target.dataset.platform) {
      openDialog('已选择平台预组', `<div class="destination-preview"><div class="destination-icon">${icon('check')}</div><h3>${target.dataset.platform}</h3><p>准备前往娱乐模式。</p><p class="preview-only-note">已完成选择预览，未加入候场或开始匹配。</p>${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`);
      return;
    }
    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'home': if (dialog.open) dialog.close(); render(); window.scrollTo({ top: 0, behavior: 'auto' }); break;
      case 'menu': {
        const menu = document.querySelector('.mobile-menu');
        menu.hidden = !menu.hidden;
        target.setAttribute('aria-expanded', String(!menu.hidden));
        break;
      }
      case 'decks': manageDecks(); break;
      case 'choose-deck': chooseDeck(); break;
      case 'view-deck': viewDeck(); break;
      case 'create': createDeck(); break;
      case 'select-event':
      case 'empty-platform': state.mode = 'event'; if (dialog.open) dialog.close(); render(); break;
      case 'launch': launch(); break;
      case 'platform-decks': launch(); break;
      case 'casual': state.mode = 'casual'; launch(); break;
      case 'resume': resume(); break;
      case 'history': historyPreview(); break;
      case 'customize-shortcuts': customizeShortcuts(); break;
      case 'reset-shortcuts': shortcutDraft = [...defaultShortcuts]; editShortcuts('[data-action="reset-shortcuts"]'); break;
      case 'save-shortcuts': saveShortcuts(); break;
      case 'retry': state.scenario = 'normal'; render(); toast('预览状态已恢复连接'); break;
      case 'close-dialog': dialog.close(); break;
      case 'announcements': openDialog('公告', `<div class="announcement-preview"><p class="field-label">产品公告</p><h3>这里展示与当前任务有关的公告</h3><p>日常状态下，公告保留在导航中；影响对战的消息会在大厅内提示。</p><p class="preview-only-note">本原型未接入公告数据。</p></div>`); break;
      case 'account': openDialog('账户', `<div class="account-preview">${image('avatar.webp', '', '')}<div><h3>小星</h3><p>示例玩家</p></div></div><p class="preview-only-note">账号设置在正式页面处理；此处没有账号写操作。</p>`); break;
      case 'logout': openDialog('退出登录', `<p>这是设计预览，不会退出实际账号。</p><div class="dialog-actions">${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`); break;
      case 'spectator-preview': openDialog('观战预览', `<div class="destination-preview"><div class="destination-icon">${icon('eye')}</div><h3>海未 × 可可</h3><p>公开观战视角 · 等待对局开始</p><p class="preview-only-note">未读取任何实际玩家的对局状态。</p>${button('返回大厅', 'close-dialog', 'secondary-button', '')}</div>`); break;
      default: infoPreview(action);
    }
  });
  dialog.addEventListener('change', event => {
    const input = event.target.closest('input[data-shortcut]');
    if (!input || !shortcutDraft) return;
    const id = input.dataset.shortcut;
    shortcutDraft = shortcutDraft.filter(value => value !== id);
    if (input.checked) shortcutDraft.push(id);
    editShortcuts(`[data-shortcut="${id}"]`);
  });
  dialog.addEventListener('close', () => { if (!dialog.open) shortcutDraft = null; });
  document.addEventListener('keydown', event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const modesInOrder = Object.keys(modes);
    const index = modesInOrder.indexOf(state.mode);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? modesInOrder.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + modesInOrder.length) % modesInOrder.length;
    state.mode = modesInOrder[next];
    render();
    document.querySelector(`[data-mode="${state.mode}"]`)?.focus({ preventScroll: true });
  });
  for (const id of ['variant', 'scenario', 'count']) {
    document.querySelector(`#${id}`).addEventListener('change', event => {
      state[id] = event.target.value;
      if (id === 'count') state.selected = Math.min(state.selected, Number(state.count) - 1);
      if (id === 'scenario' && state.scenario === 'empty') state.mode = 'event';
      render();
    });
  }
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  if (isEmpty()) state.mode = 'event';
  render();
})();
