import { dateStr, todayStr } from './utils.js';

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
// Placeholders — replace `preview` CSS / `img` paths with real assets later.
export const REWARDS = [
  // Profile frames (border style applied to avatar)
  { id: 'frame_red',    type: 'frame', name: 'Flame',    cost: 3,  border: '3px solid #c03a20',       emoji: '🔴' },
  { id: 'frame_gold',   type: 'frame', name: 'Gold',     cost: 5,  border: '3px solid #d4a017',       emoji: '🟡' },
  { id: 'frame_blue',   type: 'frame', name: 'Ocean',    cost: 7,  border: '3px solid #2563eb',       emoji: '🔵' },
  { id: 'frame_sakura', type: 'frame', name: 'Sakura',   cost: 10, border: '3px dashed #f472b6',      emoji: '🌸' },

  // Background themes (CSS var --bg override)
  { id: 'theme_dusk',   type: 'theme', name: 'Dusk',     cost: 5,  bg: '#1a0f0f',  emoji: '🌅' },
  { id: 'theme_ocean',  type: 'theme', name: 'Ocean',    cost: 5,  bg: '#0a1628',  emoji: '🌊' },
  { id: 'theme_forest', type: 'theme', name: 'Forest',   cost: 5,  bg: '#0a1a0f',  emoji: '🌲' },
  { id: 'theme_stone',  type: 'theme', name: 'Stone',    cost: 8,  bg: '#18181b',  emoji: '🪨' },

  // Calendar badges (emoji shown on studied days)
  { id: 'badge_star',   type: 'badge', name: 'Star',     cost: 8,  emoji: '⭐' },
  { id: 'badge_cherry', type: 'badge', name: 'Sakura',   cost: 10, emoji: '🌸' },
  { id: 'badge_bolt',   type: 'badge', name: 'Lightning',cost: 12, emoji: '⚡' },
  { id: 'badge_trophy', type: 'badge', name: 'Trophy',   cost: 20, emoji: '🏆' },
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

  // Theme → CSS variable on :root
  if (theme) {
    const t = REWARDS.find(r => r.id === theme);
    if (t) document.documentElement.style.setProperty('--bg', t.bg);
  } else {
    document.documentElement.style.removeProperty('--bg');
  }

  // Frame → border on all avatar elements
  const avatars = document.querySelectorAll('.auth-avatar, .profile-avatar');
  const frameReward = frame ? REWARDS.find(r => r.id === frame) : null;
  avatars.forEach(el => {
    el.style.border = frameReward ? frameReward.border : '';
  });
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
    if (b && isUnlocked(badge)) return b.emoji;
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
        <div class="xp-segs">${segs}</div>
        <div class="xp-bar-label">${bar}/3</div>
      </div>
      <div class="xp-grains-wrap" title="Coffee beans earned">
        <span class="xp-grain-icon">🫘</span>
        <span class="xp-grain-count">${grains}</span>
      </div>
    </div>`;
}

// ── Render Profile / Shop HTML ────────────────────────────────────────────
export function renderProfileHTML() {
  const grains   = getGrains();
  const unlocked = getUnlocked();
  const equipped = getEquipped();

  const types = [
    { key: 'frame', label: 'Profile Frames' },
    { key: 'theme', label: 'Themes' },
    { key: 'badge', label: 'Calendar Badges' },
  ];

  const sections = types.map(({ key, label }) => {
    const items = REWARDS.filter(r => r.type === key);
    const cards = items.map(r => {
      const owned    = unlocked.includes(r.id);
      const equippedThis = equipped[key] === r.id;
      const canAfford = grains >= r.cost;

      let action;
      if (!owned) {
        action = canAfford
          ? `<button class="shop-btn shop-btn-buy" onclick="window.shopBuy('${r.id}')">🫘 ${r.cost}</button>`
          : `<button class="shop-btn shop-btn-locked" disabled>🫘 ${r.cost}</button>`;
      } else {
        action = `<button class="shop-btn ${equippedThis ? 'shop-btn-equipped' : 'shop-btn-equip'}" onclick="window.shopEquip('${r.id}')">${equippedThis ? 'Equipped ✓' : 'Equip'}</button>`;
      }

      return `
        <div class="shop-card ${owned ? 'shop-card-owned' : ''} ${equippedThis ? 'shop-card-active' : ''}">
          <div class="shop-card-icon">${r.emoji}</div>
          <div class="shop-card-name">${r.name}</div>
          ${action}
        </div>`;
    }).join('');

    return `
      <details class="shop-section" open>
        <summary class="shop-section-summary">${label} <span class="shop-section-count">${items.length}</span></summary>
        <div class="shop-grid">${cards}</div>
      </details>`;
  }).join('');

  return `
    <div class="profile-wrap">
      <div class="profile-grains-row">
        <span class="xp-grain-icon">🫘</span>
        <span class="profile-grains-count">${grains}</span>
        <span class="profile-grains-label">coffee beans</span>
      </div>
      ${sections}
    </div>`;
}

// ── Shop actions (called from inline onclick) ─────────────────────────────
window.shopBuy = function(id) {
  const result = spendAndUnlock(id);
  if (result.ok) {
    applyEquipped();
    // Re-render profile section
    const el = document.getElementById('profileContent');
    if (el) el.innerHTML = renderProfileHTML();
  } else if (result.err === 'insufficient') {
    alert('Not enough beans ☕ Keep your streak going!');
  }
};

window.shopEquip = function(id) {
  equipReward(id);
  const el = document.getElementById('profileContent');
  if (el) el.innerHTML = renderProfileHTML();
};
