import { dateStr, todayStr } from './utils.js';
import { t } from './i18n.js';

// ── Studied-dates helper (mirrors stats.js — avoids circular import) ──────
function _getStudiedDates() {
  const dates = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('vocab_daily_')) dates.add(k.slice(12));
  }
  try {
    const history = JSON.parse(localStorage.getItem('quiz_history') || '[]');
    history.forEach(h => { if (h.date) dates.add(h.date); });
  } catch {}
  return dates;
}

// ── Rewards catalog ───────────────────────────────────────────────────────
// cost: 0 on all items → free unlock for testing. Set real costs before launch.
export const REWARDS = [
  // Profile frames (PNG overlay on avatar)
  { id: 'frame_red',    type: 'frame', name: 'Autumn',  cost: 0, img: '/assets/Frame/Leaf_Frame.png',   emoji: '🍂' },
  { id: 'frame_gold',   type: 'frame', name: 'Sun',     cost: 0, img: '/assets/Frame/Sun_Frame.png',    emoji: '✨' },
  { id: 'frame_blue',   type: 'frame', name: 'Bean',    cost: 0, img: '/assets/Frame/Bean_Frame.png',   emoji: '☕' },
  { id: 'frame_sakura', type: 'frame', name: 'Sakura',  cost: 0, img: '/assets/Frame/Sakura_Frame.png', emoji: '🌸' },

  // Background themes (accent colors only — only changes the header/red)
  { id: 'theme_dusk',   type: 'theme', name: 'Dusk',   cost: 0, emoji: '🌅', accent: '#c47828', accentDark: '#8b5010' },
  { id: 'theme_ocean',  type: 'theme', name: 'Ocean',  cost: 0, emoji: '🌊', accent: '#2e7db3', accentDark: '#1a5980' },
  { id: 'theme_forest', type: 'theme', name: 'Forest', cost: 0, emoji: '🌲', accent: '#22c55e', accentDark: '#15803d' },
  { id: 'theme_stone',  type: 'theme', name: 'Stone',  cost: 0, emoji: '🪨', accent: '#2a6a58', accentDark: '#1a4a3a' },

  // Calendar badges (PNG shown on studied days)
  { id: 'badge_star',   type: 'badge', name: 'Sun',    cost: 0, img: '/assets/Badge/Sun_Badge.png',     emoji: '☀️' },
  { id: 'badge_cherry', type: 'badge', name: 'Sakura', cost: 0, img: '/assets/Badge/Sakura_Badge.png',  emoji: '🌸' },
  { id: 'badge_bolt',   type: 'badge', name: 'Bloom',  cost: 0, img: '/assets/Badge/Sakura_Badge2.png', emoji: '🌺' },
  { id: 'badge_trophy', type: 'badge', name: 'Coffee', cost: 0, img: '/assets/Badge/Coffee_Badge.png',  emoji: '☕' },
];

// ── Storage helpers ───────────────────────────────────────────────────────
export function getGrains() {
  return Math.max(0, parseInt(localStorage.getItem('km_xp_grains') || '0'));
}
export function getSpentGrains() {
  return Math.max(0, parseInt(localStorage.getItem('km_xp_grains_spent') || '0'));
}
export function getXPBar() {
  // 0, 1, or 2 segments currently filled (3 = full, triggers grain + reset immediately)
  return Math.min(2, Math.max(0, parseInt(localStorage.getItem('km_xp_bar') || '0')));
}
export function getEquipped() {
  return {
    frame: localStorage.getItem('km_equipped_frame') || null,
    theme: localStorage.getItem('km_equipped_theme') || null,
    badge: localStorage.getItem('km_equipped_badge') || null,
  };
}
export function getUnlocked() {
  try { return JSON.parse(localStorage.getItem('km_xp_unlocked') || '[]'); } catch { return []; }
}
export function isUnlocked(id) { return getUnlocked().includes(id); }

// ── Spend / unlock / equip ────────────────────────────────────────────────
/** Auto-unlock every item whose cost is 0. Call at app startup. */
export function unlockAllFree() {
  try {
    const unlocked = getUnlocked();
    const free     = REWARDS.filter(r => r.cost === 0).map(r => r.id);
    const merged   = [...new Set([...unlocked, ...free])];
    if (merged.length !== unlocked.length) {
      localStorage.setItem('km_xp_unlocked', JSON.stringify(merged));
    }
  } catch (e) {
    console.warn('[unlockAllFree] localStorage write failed:', e.name);
  }
}

export function spendAndUnlock(id) {
  const reward = REWARDS.find(r => r.id === id);
  if (!reward) return { ok: false, err: 'unknown' };
  if (isUnlocked(id)) return { ok: false, err: 'already' };
  const grains = getGrains();
  if (grains < reward.cost) return { ok: false, err: 'insufficient' };
  localStorage.setItem('km_xp_grains', grains - reward.cost);
  const spent = getSpentGrains();
  localStorage.setItem('km_xp_grains_spent', spent + reward.cost);
  const unlocked = getUnlocked();
  unlocked.push(id);
  localStorage.setItem('km_xp_unlocked', JSON.stringify(unlocked));
  return { ok: true };
}

export function equipReward(id) {
  const reward = REWARDS.find(r => r.id === id);
  if (!reward || !isUnlocked(id)) return;
  const equipped = getEquipped();
  if (equipped[reward.type] === id) {
    // Toggle off
    localStorage.removeItem(`km_equipped_${reward.type}`);
  } else {
    localStorage.setItem(`km_equipped_${reward.type}`, id);
  }
  applyEquipped();
}
window.equipReward = equipReward;

// ── Apply equipped cosmetics to DOM ──────────────────────────────────────
export function applyEquipped() {
  const { frame, theme } = getEquipped();

  // Theme → only accent color (header/banner), does not touch light/dark mode
  const themeReward = theme ? REWARDS.find(r => r.id === theme) : null;
  if (themeReward) {
    document.documentElement.style.setProperty('--red', themeReward.accent);
    document.documentElement.style.setProperty('--red-dark', themeReward.accentDark);
  } else {
    document.documentElement.style.removeProperty('--red');
    document.documentElement.style.removeProperty('--red-dark');
  }

  // Frame → PNG overlay on all avatar elements (header, home, stats, settings)
  const frameReward = frame ? REWARDS.find(r => r.id === frame) : null;
  // Remove any previous overlays and unwrap
  document.querySelectorAll('.km-frame-overlay').forEach(el => el.remove());
  document.querySelectorAll('.km-avatar-wrap').forEach(wrap => {
    const parent = wrap.parentElement;
    Array.from(wrap.children).forEach(child => {
      if (!child.classList.contains('km-frame-overlay')) parent.insertBefore(child, wrap);
    });
    wrap.remove();
  });
  if (frameReward) {
    document.querySelectorAll(
      '.auth-user .auth-avatar, .auth-user .auth-avatar-fallback, ' +
      '.home-today-avatar, .home-today-fallback, ' +
      '.stats-user-avatar, .stats-user-fallback'
    ).forEach(avatarEl => {
      const wrap = document.createElement('div');
      wrap.className = 'km-avatar-wrap';
      avatarEl.parentNode.insertBefore(wrap, avatarEl);
      wrap.appendChild(avatarEl);
      const overlay = document.createElement('img');
      overlay.className = 'km-frame-overlay';
      overlay.src = frameReward.img;
      overlay.alt = '';
      wrap.appendChild(overlay);
    });
  }
}

// ── XP bar sync ───────────────────────────────────────────────────────────
// Call on app open and after each quiz completion.
// Returns true if a new grain was earned this call.
export function syncXPBar(studiedDatesSet) {
  const studied = studiedDatesSet || _getStudiedDates();
  const today     = todayStr();
  const lastCheck = localStorage.getItem('km_xp_last_check') || today;
  const todayDone = localStorage.getItem('km_xp_today_awarded') === today;

  let bar    = getXPBar();
  let grains = getGrains();
  let earned = false;

  // ── 1. Process past days (lastCheck+1 → yesterday) ──
  if (lastCheck !== today) {
    const lastDate  = new Date(lastCheck + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    const daysDiff  = Math.round((todayDate - lastDate) / 86400000);

    for (let i = 1; i < daysDiff; i++) {   // up to yesterday (exclusive of today)
      const d  = new Date(lastDate);
      d.setDate(d.getDate() + i);
      const ds = dateStr(d);

      if (studied.has(ds)) {
        bar++;
        if (bar >= 3) { grains++; bar = 0; earned = true; }
      } else {
        bar = Math.max(0, bar - 1);
      }
    }
    localStorage.setItem('km_xp_last_check', today);
    localStorage.setItem('km_xp_today_awarded', ''); // reset for new day
  }

  // ── 2. Process today if studied and not yet awarded ──
  if (!todayDone && studied.has(today)) {
    bar++;
    if (bar >= 3) { grains++; bar = 0; earned = true; }
    localStorage.setItem('km_xp_today_awarded', today);
  }

  localStorage.setItem('km_xp_bar', bar);
  localStorage.setItem('km_xp_grains', grains);

  return earned;
}

// ── Calendar badge ────────────────────────────────────────────────────────
export function getCalendarBadge() {
  const { badge } = getEquipped();
  if (badge) {
    const b = REWARDS.find(r => r.id === badge);
    if (b && isUnlocked(badge)) {
      if (b.img) return `<img src="${b.img}" class="scal-badge-img" alt="${b.name}">`;
      return b.emoji;
    }
  }
  return '☕';
}

// ── Render XP bar HTML ────────────────────────────────────────────────────
export function renderXPBarHTML() {
  const bar    = getXPBar();
  const grains = getGrains();
  const segs   = [0, 1, 2].map(i =>
    `<div class="xp-seg${i < bar ? ' xp-seg-filled' : ''}"></div>`
  ).join('');

  return `
    <div class="xp-bar-wrap">
      <div class="xp-bar-left">
        <div class="xp-cup-icon">☕</div>
        <div class="xp-bar-main">
          <div class="xp-segs">${segs}</div>
          <div class="xp-bar-label">${bar}/3</div>
        </div>
      </div>
      <div class="xp-grains-wrap" title="${t('xp_beans_title')}">
        <span class="xp-grain-icon">🫘</span>
        <span class="xp-grain-count">${grains}</span>
      </div>
    </div>`;
}

// ── Render Shop HTML (unowned items only — buy) ───────────────────────────
export function renderShopHTML() {
  const grains   = getGrains();
  const unlocked = getUnlocked();

  const types = [
    { key: 'frame', label: t('shop_section_frames') },
    { key: 'theme', label: t('shop_section_themes') },
    { key: 'badge', label: t('shop_section_badges') },
  ];

  let hasAny = false;
  const sections = types.map(({ key, label }) => {
    const items = REWARDS.filter(r => r.type === key && !unlocked.includes(r.id));
    if (!items.length) return '';
    hasAny = true;
    const cards = items.map(r => {
      const canAfford = grains >= r.cost;
      const action = canAfford
        ? `<button class="shop-btn shop-btn-buy" onclick="window.shopBuy('${r.id}')">🫘 ${r.cost}</button>`
        : `<button class="shop-btn shop-btn-locked" disabled>🫘 ${r.cost}</button>`;
      const iconHTML = r.img
        ? `<img src="${r.img}" class="shop-card-img" alt="${r.name}">`
        : r.emoji;
      return `
        <div class="shop-card">
          <div class="shop-card-icon">${iconHTML}</div>
          <div class="shop-card-name">${r.name}</div>
          ${action}
        </div>`;
    }).join('');

    return `
      <details class="shop-section">
        <summary class="shop-section-summary">${label} <span class="shop-section-count">${items.length}</span></summary>
        <div class="shop-grid">${cards}</div>
      </details>`;
  }).join('');

  const beansRow = `
    <div class="profile-grains-row">
      <span class="xp-grain-icon">🫘</span>
      <span class="profile-grains-count">${grains}</span>
      <span class="profile-grains-label">${t('shop_grains_label')}</span>
    </div>`;

  if (!hasAny) {
    return `<div class="profile-wrap">${beansRow}<p class="shop-empty">🎉 All items unlocked!</p></div>`;
  }
  return `<div class="profile-wrap">${beansRow}${sections}</div>`;
}

// ── Render Appearances HTML (owned items only — equip) ────────────────────
export function renderAppearancesHTML() {
  const unlocked = getUnlocked();
  const equipped = getEquipped();

  const types = [
    { key: 'frame', label: t('shop_section_frames') },
    { key: 'theme', label: t('shop_section_themes') },
    { key: 'badge', label: t('shop_section_badges') },
  ];

  let hasAny = false;
  const sections = types.map(({ key, label }) => {
    const items = REWARDS.filter(r => r.type === key && unlocked.includes(r.id));
    if (!items.length) return '';
    hasAny = true;
    const cards = items.map(r => {
      const equippedThis = equipped[key] === r.id;
      const action = `<button class="shop-btn ${equippedThis ? 'shop-btn-equipped' : 'shop-btn-equip'}" onclick="window.shopEquip('${r.id}')">${equippedThis ? t('shop_btn_equipped') : t('shop_btn_equip')}</button>`;
      const iconHTML = r.img
        ? `<img src="${r.img}" class="shop-card-img" alt="${r.name}">`
        : r.emoji;
      return `
        <div class="shop-card shop-card-owned ${equippedThis ? 'shop-card-active' : ''}">
          <div class="shop-card-icon">${iconHTML}</div>
          <div class="shop-card-name">${r.name}</div>
          ${action}
        </div>`;
    }).join('');

    return `
      <details class="shop-section">
        <summary class="shop-section-summary">${label} <span class="shop-section-count">${items.length}</span></summary>
        <div class="shop-grid">${cards}</div>
      </details>`;
  }).join('');

  if (!hasAny) {
    return `<p class="shop-empty" style="color:var(--muted);font-size:13px;padding:8px 0">Unlock items in the shop to customise your profile.</p>`;
  }
  return `<div class="profile-wrap">${sections}</div>`;
}

// ── Compat wrapper (kept for any legacy call sites) ───────────────────────
export function renderProfileHTML() {
  return renderShopHTML();
}

// ── Cloud sync helpers ────────────────────────────────────────────────────
export function getXPCloudData() {
  return {
    grains:       getGrains(),
    spent:        getSpentGrains(),
    bar:          getXPBar(),
    lastCheck:    localStorage.getItem('km_xp_last_check') || '',
    todayAwarded: localStorage.getItem('km_xp_today_awarded') || '',
    unlocked:     getUnlocked(),
    equipped:     getEquipped(),
  };
}

export function applyXPCloudData(data) {
  if (!data) return;
  try {
    // Unlocked: union local + cloud
    const local  = getUnlocked();
    const merged = [...new Set([...local, ...(data.unlocked || [])])];
    localStorage.setItem('km_xp_unlocked', JSON.stringify(merged));
  } catch (e) {
    console.warn('[applyXPCloudData] localStorage quota full, skipping unlocked write:', e.name);
  }
  try {
    // Equipped: cloud wins (has explicit null for unequipped)
    if (data.equipped) {
      const { frame, theme, badge } = data.equipped;
      if (frame) localStorage.setItem('km_equipped_frame', frame);
      else       localStorage.removeItem('km_equipped_frame');
      if (theme) localStorage.setItem('km_equipped_theme', theme);
      else       localStorage.removeItem('km_equipped_theme');
      if (badge) localStorage.setItem('km_equipped_badge', badge);
      else       localStorage.removeItem('km_equipped_badge');
    }
    // Grains: take max so offline progress is never lost
    const cg = parseInt(data.grains || 0);
    if (cg > getGrains()) localStorage.setItem('km_xp_grains', cg);
    const cs = parseInt(data.spent || 0);
    if (cs > getSpentGrains()) localStorage.setItem('km_xp_grains_spent', cs);
    // Bar / timestamps
    if (data.bar          !== undefined) localStorage.setItem('km_xp_bar',           data.bar);
    if (data.lastCheck)                  localStorage.setItem('km_xp_last_check',    data.lastCheck);
    if (data.todayAwarded)               localStorage.setItem('km_xp_today_awarded', data.todayAwarded);
  } catch (e) {
    console.warn('[applyXPCloudData] localStorage quota full, skipping some writes:', e.name);
  }
}

// ── Shop actions (called from inline onclick) ─────────────────────────────
function _refreshShopPanels() {
  const shopEl = document.getElementById('profileContent');
  if (shopEl) shopEl.innerHTML = renderShopHTML();
  const appEl = document.getElementById('appearancesContent');
  if (appEl) appEl.innerHTML = renderAppearancesHTML();
}

window.shopBuy = function(id) {
  const result = spendAndUnlock(id);
  if (result.ok || result.err === 'already') {
    applyEquipped();
    _refreshShopPanels();
  } else if (result.err === 'insufficient') {
    alert(t('shop_no_beans'));
  }
};

window.shopEquip = function(id) {
  equipReward(id);
  _refreshShopPanels();
};
