// ── Date helpers ──────────────────────────────────────────────────────────
// Uses local components (not toISOString) to avoid UTC shift in UTC+X zones.
export function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayStr() { return dateStr(new Date()); }

// ── Array utility ─────────────────────────────────────────────────────────
export function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Meaning normalisation ─────────────────────────────────────────────────
// For learned-words dedup: lowercase, strip punctuation/spaces
export function normMeaning(m) {
  return (m || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

// For display dedup: strip parens, collapse spaces
export function normalizeMeaning(gloss) {
  return gloss.toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

// ── Status bar helper ─────────────────────────────────────────────────────
export function setStatus(type, msg) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'status-' + type;
}

// ── Sort meanings: common first, specialized/archaic last ─────────────────
// Used for both kanji card meanings and vocab card glosses.
const RARE_RE = /\b(archaism|archaic|obsolete|rare|dated|poetic|vulgar|derogatory|slang|colloquial|euphemism|honorific|humble|polite|familiar|childish|female|male|baseball|cards|mahjong|shogi|go\b|sumo|chess|cricket|poker|trump|fishing|card game|nautical|heraldry|anatomy|botany|zoology|chemistry|physics|mathematics|geometry|algebra|computing|programming|law|legal|judicial|military|ecclesiastical|biblical|mythology|astrology|dialectal|regional)/i;

// Meanings that are grammatically specialized or low daily utility
const COUNTER_RE = /^counter for\b/i;
const POS_DEPRIORITIZE_RE = /counter|numeric.?classifier|suffix|prefix|particle|auxiliary/i;
// Subjects that appear in glosses but aren't daily-life concepts
const NONDAILY_RE = /\b(buddha|goddess?|deity|shrine|temple|nobleman|noble|aristocrat|feudal|imperial|shogun|emperor|empress|consort|prince|princess|monk|priest|nun|clan|warlord|samurai|vassal|regent|dynasty|epoch|era\b|period\b|reign|manor|castle|artifact|relic|scripture|sutra|incense|ritual|ceremony|divinity|divination|oracle|omen|ancestral|pilgrimage|cerebrum|cerebellum|cortex|neuron|artery|vein|tendon|ligament|vertebra|pelvis|thorax|femur|tibia|fibula|humerus|radius|ulna|clavicle|scapula|cranium|mandible|phalanx|battalion|regiment|platoon|squadron|garrison|artillery|infantry|cavalry|grenade|torpedo|mortar|barracks|ordnance|munition|troop|brigade|company\b.*soldier|battery\b.*military|messrs|addressee|salutation|preamble|foreword|preface|postscript|appendix|errata|treatise|dissertation|monograph|on base|times on base|batting|fielding|pitcher|catcher|inning|strikeout|homerun|shortstop|outfield|infield|distribution of electricity|electric.?power.?distribution|high.?voltage|low.?voltage|transformer\b|substation|switchboard)\b/i;

function meaningScore(m) {
  const text = (m.glosses || []).join(' ');
  const pos  = (m.part_of_speech || []).join(' ');
  let score  = 0;
  if (RARE_RE.test(text))           score += 20;
  if (NONDAILY_RE.test(text))       score += 15;
  if (COUNTER_RE.test(text))        score += 25; // "counter for X" almost never most useful meaning
  if (POS_DEPRIORITIZE_RE.test(pos)) score += 20;
  return score;
}

export function sortGlosses(glosses) {
  if (!glosses || glosses.length <= 1) return glosses || [];
  return [...glosses].sort((a, b) => {
    const aRare = RARE_RE.test(a);
    const bRare = RARE_RE.test(b);
    if (aRare && !bRare) return 1;
    if (!aRare && bRare) return -1;
    return 0;
  });
}

// Sort an array of meaning objects (each with .glosses) — common/simple first
export function sortMeanings(meanings) {
  if (!meanings || meanings.length <= 1) return meanings || [];
  return [...meanings].sort((a, b) => meaningScore(a) - meaningScore(b));
}

// ── Pick the best display gloss from a meanings array ────────────────────
// Skips glosses with language/qualifier prefixes like "(French)", "(approx.)"
// and rare/historical/grammatical content. Falls back gracefully.
export const GLOSS_SKIP_RE = /^\((french|german|english|dutch|portuguese|chinese|korean|approx|abbr|uk|us|lit|fig|also|esp|orig|hist|obs|arch)\)/i;
export const GLOSS_RARE_RE = /\b(monarchy|empire|dynasty|shogunate|anniversary|feudal|imperial|shogun|archaic|obsolete|rare|dated|poetic|biblical|mythology|ecclesiastical|heraldry|nautical|mahjong|shogi|sumo|cricket|poker|chess)\b/i;

export function pickBestGloss(meanings) {
  if (!meanings?.length) return null;
  const sorted = sortMeanings(meanings);
  // Pass 1: no skip prefix, no rare content, not a "counter for X" meaning
  for (const m of sorted) {
    if (COUNTER_RE.test((m.glosses || []).join(' '))) continue;
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g) && !NONDAILY_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  // Pass 2: allow non-daily subjects but still no skip prefix
  for (const m of sorted) {
    if (COUNTER_RE.test((m.glosses || []).join(' '))) continue;
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  // Pass 3: accept anything except language prefixes
  for (const m of sorted) {
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  // Fallback
  const g = sorted[0]?.glosses?.[0];
  return g ? { gloss: g, meaning: sorted[0] } : null;
}
