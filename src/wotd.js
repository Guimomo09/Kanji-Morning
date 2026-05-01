/**
 * 今日の一語 — Word of the Day
 * Words are grouped by season. Each day of the month deterministically
 * picks a word from the current season's pool (seasonal + universal).
 */

const WORDS = [
  // ── Spring 春 (Mar–May) ───────────────────────────────────────────────
  { word: '桜',    reading: 'さくら',     meaning: 'cherry blossom',          season: 'spring' },
  { word: '春風',  reading: 'はるかぜ',   meaning: 'spring breeze',            season: 'spring' },
  { word: '花見',  reading: 'はなみ',     meaning: 'flower viewing',           season: 'spring' },
  { word: '新緑',  reading: 'しんりょく', meaning: 'fresh green leaves',       season: 'spring' },
  { word: '若葉',  reading: 'わかば',     meaning: 'young leaves',             season: 'spring' },
  { word: '霞',    reading: 'かすみ',     meaning: 'spring haze',              season: 'spring' },
  { word: '卒業',  reading: 'そつぎょう', meaning: 'graduation',               season: 'spring' },
  { word: '入学',  reading: 'にゅうがく', meaning: 'school enrollment',        season: 'spring' },
  { word: '春雨',  reading: 'はるさめ',   meaning: 'gentle spring rain',       season: 'spring' },

  // ── Summer 夏 (Jun–Aug) ──────────────────────────────────────────────
  { word: '海',    reading: 'うみ',       meaning: 'sea',                      season: 'summer' },
  { word: '花火',  reading: 'はなび',     meaning: 'fireworks',                season: 'summer' },
  { word: '祭り',  reading: 'まつり',     meaning: 'festival',                 season: 'summer' },
  { word: '向日葵', reading: 'ひまわり',  meaning: 'sunflower',                season: 'summer' },
  { word: '蛍',    reading: 'ほたる',     meaning: 'firefly',                  season: 'summer' },
  { word: '夕立',  reading: 'ゆうだち',   meaning: 'summer shower',            season: 'summer' },
  { word: '風鈴',  reading: 'ふうりん',   meaning: 'wind chime',               season: 'summer' },
  { word: '暑さ',  reading: 'あつさ',     meaning: 'summer heat',              season: 'summer' },
  { word: '夕涼み', reading: 'ゆうすずみ', meaning: 'evening cool',            season: 'summer' },

  // ── Autumn 秋 (Sep–Nov) ──────────────────────────────────────────────
  { word: '紅葉',  reading: 'こうよう',   meaning: 'autumn leaves',            season: 'autumn' },
  { word: '月見',  reading: 'つきみ',     meaning: 'moon viewing',             season: 'autumn' },
  { word: '秋風',  reading: 'あきかぜ',   meaning: 'autumn wind',              season: 'autumn' },
  { word: '落ち葉', reading: 'おちば',    meaning: 'fallen leaves',            season: 'autumn' },
  { word: '稲穂',  reading: 'いなほ',     meaning: 'rice ears',                season: 'autumn' },
  { word: '夕焼け', reading: 'ゆうやけ',  meaning: 'sunset glow',              season: 'autumn' },
  { word: '虫の音', reading: 'むしのね',  meaning: 'sound of insects',         season: 'autumn' },
  { word: '収穫',  reading: 'しゅうかく', meaning: 'harvest',                  season: 'autumn' },

  // ── Winter 冬 (Dec–Feb) ──────────────────────────────────────────────
  { word: '雪',    reading: 'ゆき',       meaning: 'snow',                     season: 'winter' },
  { word: '梅',    reading: 'うめ',       meaning: 'plum blossom',             season: 'winter' },
  { word: '初日の出', reading: 'はつひので', meaning: 'first sunrise of the year', season: 'winter' },
  { word: '寒さ',  reading: 'さむさ',     meaning: 'winter cold',              season: 'winter' },
  { word: '節分',  reading: 'せつぶん',   meaning: 'bean-throwing festival',   season: 'winter' },
  { word: '冬空',  reading: 'ふゆぞら',   meaning: 'winter sky',               season: 'winter' },

  // ── Universal 通年 ────────────────────────────────────────────────────
  { word: '朝',    reading: 'あさ',       meaning: 'morning',                  season: 'all' },
  { word: '夜',    reading: 'よる',       meaning: 'night',                    season: 'all' },
  { word: '空',    reading: 'そら',       meaning: 'sky',                      season: 'all' },
  { word: '月',    reading: 'つき',       meaning: 'moon',                     season: 'all' },
  { word: '星',    reading: 'ほし',       meaning: 'star',                     season: 'all' },
  { word: '山',    reading: 'やま',       meaning: 'mountain',                 season: 'all' },
  { word: '川',    reading: 'かわ',       meaning: 'river',                    season: 'all' },
  { word: '森',    reading: 'もり',       meaning: 'forest',                   season: 'all' },
  { word: '道',    reading: 'みち',       meaning: 'path',                     season: 'all' },
  { word: '旅',    reading: 'たび',       meaning: 'journey',                  season: 'all' },
  { word: '夢',    reading: 'ゆめ',       meaning: 'dream',                    season: 'all' },
  { word: '心',    reading: 'こころ',     meaning: 'heart / mind',             season: 'all' },
  { word: '笑顔',  reading: 'えがお',     meaning: 'smile',                    season: 'all' },
  { word: '幸せ',  reading: 'しあわせ',   meaning: 'happiness',                season: 'all' },
  { word: '感謝',  reading: 'かんしゃ',   meaning: 'gratitude',                season: 'all' },
  { word: '希望',  reading: 'きぼう',     meaning: 'hope',                     season: 'all' },
  { word: '縁',    reading: 'えん',       meaning: 'fate / connection',        season: 'all' },
  { word: '間',    reading: 'ま',         meaning: 'space / pause',            season: 'all' },
  { word: '静寂',  reading: 'せいじゃく', meaning: 'silence',                  season: 'all' },
];

const SEASON_EMOJIS = { spring: '🌸', summer: '🌊', autumn: '🍂', winter: '❄️', all: '✨' };

function getSeason(month) {
  if (month <= 2 || month === 12) return 'winter';
  if (month <= 5)  return 'spring';
  if (month <= 8)  return 'summer';
  return 'autumn';
}

export function getWordOfDay(dateStr) {
  const d      = dateStr ? new Date(dateStr) : new Date();
  const month  = d.getMonth() + 1; // 1–12
  const day    = d.getDate();      // 1–31
  const season = getSeason(month);

  const pool = WORDS.filter(w => w.season === season || w.season === 'all');
  const word = pool[(day - 1) % pool.length];
  return { ...word, emoji: SEASON_EMOJIS[word.season] };
}
