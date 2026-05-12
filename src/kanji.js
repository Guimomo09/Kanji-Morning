import { LEVEL_LABEL, CLOUD_ENABLED } from './config.js';
import { normalizeMeaning, setStatus, sortGlosses, GLOSS_SKIP_RE, GLOSS_RARE_RE } from './utils.js';
import { getMeaning } from './trans.js';
import { getLang, t } from './i18n.js';
import { FREQ } from './freq.js';
import { state } from './state.js';
import { getKanjiDetail, getWords, buildPool, pickChars } from './api.js';
import { cloudUpdate } from './cloud.js';
import { speakJapanese } from './audio.js';

// ── Blacklist: full written forms that are archaic / redundant ────────────
// Only add complete word forms, never bare kanji (they won't match variant.written).
const ARCHAIC_WORDS = new Set([
  '報え', '申せ', '掛かれ', '著わす', '斎く', '映ず', '告ぐ', '知らす',
  '示す',     // prefer 見せる in daily contexts
  '請け取る', // prefer 受け取る
  '云う',     // prefer 言う
]);

// ── Reading overrides: API data known to be wrong ─────────────────────────
const READING_OVERRIDE = {
  '馬車': 'ばしゃ',
};

// ── Kanji meaning overrides ───────────────────────────────────────────────
// kanjiapi.dev returns meanings alphabetically — for simple kanji the
// alphabetically-first meaning is often archaic/technical, not the core one.
// Format: { char: { en, fr?, es?, de?, ru? } }
// Non-EN fallback: kanji_index.json[char][lang] (see bestKanjiMeaning below).
export const KANJI_MEANING_OVERRIDE = {
  // N5
  '午': { en: ['noon', 'midday'],                    fr: ['midi'],                   es: ['mediodía'],           de: ['Mittag'],              ru: ['полдень'] },
  '子': { en: ['child', 'kid'],                      fr: ['enfant'],                 es: ['niño', 'hijo'],       de: ['Kind'],                ru: ['ребёнок', 'дитя'] },
  '目': { en: ['eye'],                               fr: ['œil'],                    es: ['ojo'],                de: ['Auge'],                ru: ['глаз'] },
  '足': { en: ['foot', 'leg'],                       fr: ['pied', 'jambe'],          es: ['pie', 'pierna'],      de: ['Fuß', 'Bein'],         ru: ['нога', 'стопа'] },
  '見': { en: ['see', 'look at', 'watch'],           fr: ['voir', 'regarder'],       es: ['ver', 'mirar'],       de: ['sehen', 'schauen'],    ru: ['видеть', 'смотреть'] },
  '校': { en: ['school', 'educational institution'], fr: ['école'],                  es: ['escuela'],            de: ['Schule'],              ru: ['школа'] },
  '空': { en: ['sky', 'air', 'empty'],               fr: ['ciel', 'air', 'vide'],    es: ['cielo', 'vacío'],     de: ['Himmel', 'Luft'],      ru: ['небо', 'воздух', 'пустой'] },
  '生': { en: ['life', 'living', 'birth'],           fr: ['vie', 'naissance'],       es: ['vida', 'nacimiento'], de: ['Leben', 'Geburt'],     ru: ['жизнь', 'рождение'] },
  '立': { en: ['stand', 'stand up', 'rise'],         fr: ['se lever', 'se tenir'],   es: ['levantarse', 'estar de pie'], de: ['stehen', 'aufstehen'], ru: ['стоять', 'вставать'] },
  '名': { en: ['name', 'famous'],                    fr: ['nom', 'célèbre'],         es: ['nombre', 'famoso'],   de: ['Name', 'berühmt'],     ru: ['имя', 'известный'] },
  '国': { en: ['country', 'nation'],                 fr: ['pays', 'nation'],         es: ['país', 'nación'],     de: ['Land', 'Nation'],      ru: ['страна', 'государство'] },
  '川': { en: ['river', 'stream'],                   fr: ['rivière', 'fleuve'],      es: ['río'],                de: ['Fluss'],               ru: ['река'] },
  '土': { en: ['earth', 'soil', 'ground'],           fr: ['terre', 'sol'],           es: ['tierra', 'suelo'],    de: ['Erde', 'Boden'],       ru: ['земля', 'почва'] },
  '年': { en: ['year'],                              fr: ['année', 'an'],            es: ['año'],                de: ['Jahr'],                ru: ['год'] },
  '気': { en: ['spirit', 'energy', 'mood', 'atmosphere'], fr: ['esprit', 'énergie', 'humeur'], es: ['espíritu', 'energía', 'ánimo'], de: ['Geist', 'Energie', 'Stimmung'], ru: ['дух', 'энергия', 'настроение'] },
  '早': { en: ['early', 'fast', 'quick'],            fr: ['tôt', 'rapide'],          es: ['temprano', 'rápido'], de: ['früh', 'schnell'],     ru: ['рано', 'быстро'] },
  '来': { en: ['come', 'arrive'],                    fr: ['venir', 'arriver'],       es: ['venir', 'llegar'],    de: ['kommen', 'ankommen'],  ru: ['приходить', 'приезжать'] },
  '東': { en: ['east'],                              fr: ['est'],                    es: ['este'],               de: ['Osten'],               ru: ['восток'] },
  '南': { en: ['south'],                             fr: ['sud'],                    es: ['sur'],                de: ['Süden'],               ru: ['юг'] },
  '北': { en: ['north'],                             fr: ['nord'],                   es: ['norte'],              de: ['Norden'],              ru: ['север'] },
  '西': { en: ['west'],                              fr: ['ouest'],                  es: ['oeste'],              de: ['Westen'],              ru: ['запад'] },
  // N4
  '発': { en: ['departure', 'emit', 'launch', 'start'], fr: ['départ', 'émettre', 'lancer'], es: ['salida', 'emitir', 'lanzar'], de: ['Abfahrt', 'aussenden', 'starten'], ru: ['отправление', 'испускать', 'запускать'] },
  '感': { en: ['feeling', 'sense', 'emotion'],       fr: ['sentiment', 'sens', 'émotion'], es: ['sentimiento', 'emoción'], de: ['Gefühl', 'Empfindung'], ru: ['чувство', 'ощущение', 'эмоция'] },
  '楽': { en: ['fun', 'easy', 'comfortable', 'music'], fr: ['amusant', 'facile', 'musique'], es: ['divertido', 'fácil', 'música'], de: ['Spaß', 'einfach', 'Musik'], ru: ['веселье', 'лёгкий', 'музыка'] },
  '運': { en: ['carry', 'luck', 'fortune', 'transport'], fr: ['chance', 'chance', 'transport'], es: ['suerte', 'transportar'], de: ['Glück', 'transportieren'], ru: ['удача', 'перевозить'] },
  '転': { en: ['roll', 'turn', 'rotate', 'change'],  fr: ['rouler', 'tourner', 'changer'], es: ['rodar', 'girar', 'cambiar'], de: ['rollen', 'drehen', 'wechseln'], ru: ['катиться', 'вращаться', 'менять'] },
  '起': { en: ['get up', 'rise', 'occur', 'wake up'], fr: ['se lever', 'se réveiller', 'survenir'], es: ['levantarse', 'despertarse', 'ocurrir'], de: ['aufstehen', 'aufwachen', 'vorkommen'], ru: ['вставать', 'просыпаться', 'происходить'] },
  '考': { en: ['think', 'consider', 'idea'],         fr: ['penser', 'réfléchir'],    es: ['pensar', 'considerar'], de: ['denken', 'überlegen'],  ru: ['думать', 'размышлять'] },
  '死': { en: ['death', 'die'],                      fr: ['mort', 'mourir'],         es: ['muerte', 'morir'],    de: ['Tod', 'sterben'],      ru: ['смерть', 'умирать'] },
  '止': { en: ['stop', 'halt'],                      fr: ['arrêter', 'stopper'],     es: ['parar', 'detener'],   de: ['stoppen', 'anhalten'], ru: ['останавливать', 'прекращать'] },
  '重': { en: ['heavy', 'important', 'serious', 'pile up'], fr: ['lourd', 'important', 'grave'], es: ['pesado', 'importante', 'grave'], de: ['schwer', 'wichtig', 'ernst'], ru: ['тяжёлый', 'важный', 'серьёзный'] },
  '野': { en: ['field', 'plain', 'wild'],            fr: ['champ', 'plaine', 'sauvage'], es: ['campo', 'llanura', 'salvaje'], de: ['Feld', 'Ebene', 'wild'], ru: ['поле', 'равнина', 'дикий'] },
  '服': { en: ['clothes', 'clothing', 'obey'],       fr: ['vêtements', 'habits'],    es: ['ropa', 'vestimenta'], de: ['Kleidung', 'Kleidungsstück'], ru: ['одежда', 'одеяние'] },
  '者': { en: ['person', 'someone'],                 fr: ['personne', 'quelqu\'un'],  es: ['persona', 'alguien'], de: ['Person', 'jemand'],    ru: ['человек', 'некто'] },
  '理': { en: ['reason', 'logic', 'principle', 'manage'], fr: ['raison', 'logique', 'principe'], es: ['razón', 'lógica', 'principio'], de: ['Vernunft', 'Logik', 'Prinzip'], ru: ['причина', 'логика', 'принцип'] },
  '活': { en: ['lively', 'active', 'live'],          fr: ['vif', 'actif', 'vivant'], es: ['vivo', 'activo'],     de: ['lebhaft', 'aktiv'],    ru: ['живой', 'активный'] },
  // N5 — clean up "radical" suffix from number kanji
  '一': { en: ['one'],   fr: ['un'],   es: ['uno'],   de: ['eins'],  ru: ['один'] },
  '二': { en: ['two'],   fr: ['deux'], es: ['dos'],   de: ['zwei'],  ru: ['два'] },
  '八': { en: ['eight'], fr: ['huit'], es: ['ocho'],  de: ['acht'],  ru: ['восемь'] },
  '行': { en: ['go', 'walk', 'do', 'journey'],       fr: ['aller', 'marcher', 'faire', 'voyage'], es: ['ir', 'caminar', 'hacer', 'viaje'], de: ['gehen', 'tun', 'Reise'], ru: ['идти', 'делать', 'путешествие'] },
  // N4
  '京': { en: ['capital city'],                      fr: ['ville capitale'],         es: ['capital'],            de: ['Hauptstadt'],          ru: ['столица'] },
  '朝': { en: ['morning', 'dynasty', 'epoch'],       fr: ['matin', 'dynastie'],      es: ['mañana', 'dinastía'], de: ['Morgen', 'Dynastie'],  ru: ['утро', 'династия'] },
  '弟': { en: ['younger brother'],                   fr: ['frère cadet'],            es: ['hermano menor'],      de: ['jüngerer Bruder'],     ru: ['младший брат'] },
  '使': { en: ['use', 'employ', 'envoy'],            fr: ['utiliser', 'employer', 'messager'], es: ['usar', 'emplear', 'mensajero'], de: ['benutzen', 'verwenden', 'Bote'], ru: ['использовать', 'применять', 'посланник'] },
  '去': { en: ['leave', 'past', 'go away'],          fr: ['partir', 'passé', 'quitter'], es: ['irse', 'pasado', 'alejarse'], de: ['weggehen', 'Vergangenheit', 'verlassen'], ru: ['уходить', 'прошлое', 'прошедший'] },
  '正': { en: ['correct', 'right', 'proper'],        fr: ['correct', 'juste', 'droit'], es: ['correcto', 'justo', 'recto'], de: ['korrekt', 'richtig', 'ordentlich'], ru: ['правильный', 'правосудие', 'честный'] },
  '英': { en: ['England', 'English', 'outstanding'], fr: ['Angleterre', 'anglais', 'remarquable'], es: ['Inglaterra', 'inglés', 'sobresaliente'], de: ['England', 'Englisch', 'herausragend'], ru: ['Англия', 'английский', 'выдающийся'] },
  '真': { en: ['true', 'real', 'genuine'],           fr: ['vrai', 'réel', 'authentique'], es: ['verdadero', 'real', 'genuino'], de: ['wahr', 'echt', 'aufrichtig'], ru: ['истинный', 'настоящий', 'подлинный'] },
  // N3
  '参': { en: ['go (humble)', 'come (humble)', 'visit'], fr: ['aller (humble)', 'venir (humble)', 'visiter'], es: ['ir (humilde)', 'venir (humilde)', 'visitar'], de: ['gehen (höflich)', 'kommen (höflich)', 'besuchen'], ru: ['идти (вежливо)', 'прийти (вежливо)', 'посещать'] },
  '反': { en: ['anti-', 'oppose', 'reverse', 'rebel'], fr: ['anti-', 'opposer', 'inverse'], es: ['anti-', 'oponer', 'inverso'], de: ['anti-', 'entgegen', 'umgekehrt'], ru: ['анти-', 'против', 'обратный'] },
  '合': { en: ['fit', 'join', 'suit', 'agree'],      fr: ['correspondre', 'convenir', 'unir'], es: ['ajustar', 'unir', 'concordar'], de: ['passen', 'vereinen', 'übereinstimmen'], ru: ['подходить', 'соединять', 'совпадать'] },
  '図': { en: ['drawing', 'map', 'diagram', 'plan'], fr: ['dessin', 'carte', 'diagramme', 'plan'], es: ['dibujo', 'mapa', 'diagrama', 'plan'], de: ['Zeichnung', 'Karte', 'Diagramm', 'Plan'], ru: ['рисунок', 'карта', 'схема', 'план'] },
  '加': { en: ['add', 'increase', 'join'],           fr: ['ajouter', 'augmenter', 'joindre'], es: ['añadir', 'aumentar', 'unirse'], de: ['hinzufügen', 'erhöhen', 'beitreten'], ru: ['добавлять', 'увеличивать', 'присоединять'] },
  '予': { en: ['beforehand', 'in advance', 'preliminary'], fr: ["à l'avance", 'préalable', 'préliminaire'], es: ['de antemano', 'previo', 'preliminar'], de: ['im Voraus', 'Vorbereitung', 'vorläufig'], ru: ['заранее', 'предварительный', 'заблаговременно'] },
};


// The subtitle corpus uses Arabic numerals (7月, 7日) so all kanji-written
// number words get freqRank=99999, letting obscure Buddhist/historical terms
// bubble to the top. These overrides guarantee simple, daily-use examples.
const EXAMPLE_OVERRIDE = {
  '一': [
    { w: '一つ',   r: 'ひとつ',     m: 'one; one thing' },
    { w: '一人',   r: 'ひとり',     m: 'one person; alone' },
    { w: '一番',   r: 'いちばん',   m: 'number one; first; best' },
  ],
  '二': [
    { w: '二つ',   r: 'ふたつ',     m: 'two; two things' },
    { w: '二人',   r: 'ふたり',     m: 'two people; both' },
    { w: '二月',   r: 'にがつ',     m: 'February' },
  ],
  '三': [
    { w: '三つ',   r: 'みっつ',     m: 'three; three things' },
    { w: '三月',   r: 'さんがつ',   m: 'March' },
    { w: '三人',   r: 'さんにん',   m: 'three people' },
  ],
  '四': [
    { w: '四つ',   r: 'よっつ',     m: 'four; four things' },
    { w: '四月',   r: 'しがつ',     m: 'April' },
    { w: '四日',   r: 'よっか',     m: '4th day of the month; four days' },
  ],
  '五': [
    { w: '五つ',   r: 'いつつ',     m: 'five; five things' },
    { w: '五月',   r: 'ごがつ',     m: 'May' },
    { w: '五日',   r: 'いつか',     m: '5th day of the month; five days' },
  ],
  '六': [
    { w: '六つ',   r: 'むっつ',     m: 'six; six things' },
    { w: '六月',   r: 'ろくがつ',   m: 'June' },
    { w: '六日',   r: 'むいか',     m: '6th day of the month; six days' },
  ],
  '七': [
    { w: '七月',   r: 'しちがつ',   m: 'July' },
    { w: '七日',   r: 'なのか',     m: '7th day of the month; seven days' },
    { w: '七つ',   r: 'ななつ',     m: 'seven' },
  ],
  '八': [
    { w: '八つ',   r: 'やっつ',     m: 'eight; eight things' },
    { w: '八月',   r: 'はちがつ',   m: 'August' },
    { w: '八日',   r: 'ようか',     m: '8th day of the month; eight days' },
  ],
  '九': [
    { w: '九つ',   r: 'ここのつ',   m: 'nine; nine things' },
    { w: '九月',   r: 'くがつ',     m: 'September' },
    { w: '九日',   r: 'ここのか',   m: '9th day of the month; nine days' },
  ],
  '十': [
    { w: '十月',   r: 'じゅうがつ', m: 'October' },
    { w: '十分',   r: 'じゅうぶん', m: 'enough; sufficient; plenty' },
    { w: '二十',   r: 'にじゅう',   m: 'twenty' },
  ],
  '百': [
    { w: '百円',   r: 'ひゃくえん', m: '100 yen' },
    { w: '百万',   r: 'ひゃくまん', m: 'one million' },
    { w: '三百',   r: 'さんびゃく', m: 'three hundred' },
  ],
  '千': [
    { w: '千円',   r: 'せんえん',   m: '1000 yen' },
    { w: '何千',   r: 'なんぜん',   m: 'thousands of; many thousands' },
    { w: '三千',   r: 'さんぜん',   m: 'three thousand' },
  ],
  '万': [
    { w: '一万',   r: 'いちまん',   m: '10,000; ten thousand' },
    { w: '何万',   r: 'なんまん',   m: 'tens of thousands' },
    { w: '一万円', r: 'いちまんえん', m: '10,000 yen' },
  ],
  // ── N5 — bad API examples replaced ───────────────────────────────────────
  '人': [
    { w: '人',     r: 'ひと',       m: 'person, someone' },
    { w: '外国人', r: 'がいこくじん', m: 'foreigner' },
    { w: '大人',   r: 'おとな',     m: 'adult' },
  ],
  '上': [
    { w: '上',     r: 'うえ',       m: 'above, top, on' },
    { w: '上手',   r: 'じょうず',   m: 'skilled, good at' },
    { w: '上着',   r: 'うわぎ',     m: 'jacket, coat' },
  ],
  '下': [
    { w: '下',     r: 'した',       m: 'below, under, bottom' },
    { w: '地下',   r: 'ちか',       m: 'underground, basement' },
    { w: '上下',   r: 'じょうげ',   m: 'up and down, top and bottom' },
  ],
  '中': [
    { w: '中',       r: 'なか',         m: 'inside, middle, among' },
    { w: '中学校',   r: 'ちゅうがっこう', m: 'middle school, junior high school' },
    { w: '一日中',   r: 'いちにちじゅう', m: 'all day long' },
  ],
  '子': [
    { w: '子',     r: 'こ',         m: 'child, kid' },
    { w: '男の子', r: 'おとこのこ', m: 'boy' },
    { w: '女の子', r: 'おんなのこ', m: 'girl' },
  ],
  '先': [
    { w: '先生',   r: 'せんせい',   m: 'teacher' },
    { w: '先週',   r: 'せんしゅう', m: 'last week' },
    { w: '先',     r: 'さき',       m: 'ahead, tip, future' },
  ],
  '入': [
    { w: '入る',   r: 'はいる',     m: 'to enter, to go in' },
    { w: '入口',   r: 'いりぐち',   m: 'entrance' },
    { w: '入学',   r: 'にゅうがく', m: 'school enrollment, starting school' },
  ],
  '外': [
    { w: '外',     r: 'そと',       m: 'outside, outdoors' },
    { w: '外出',   r: 'がいしゅつ', m: 'going out' },
    { w: '海外',   r: 'かいがい',   m: 'overseas, abroad' },
  ],
  '大': [
    { w: '大きい', r: 'おおきい',   m: 'big, large' },
    { w: '大学',   r: 'だいがく',   m: 'university' },
    { w: '大事',   r: 'だいじ',     m: 'important, precious' },
  ],
  '天': [
    { w: '天気',   r: 'てんき',     m: 'weather' },
    { w: '天井',   r: 'てんじょう', m: 'ceiling' },
    { w: '天才',   r: 'てんさい',   m: 'genius, gifted person' },
  ],
  '学': [
    { w: '大学',   r: 'だいがく',   m: 'university' },
    { w: '学ぶ',   r: 'まなぶ',     m: 'to learn, to study' },
    { w: '学生',   r: 'がくせい',   m: 'student' },
  ],
  '小': [
    { w: '小さい',   r: 'ちいさい',     m: 'small, little' },
    { w: '小学校',   r: 'しょうがっこう', m: 'elementary school' },
    { w: '小説',     r: 'しょうせつ',   m: 'novel, fiction' },
  ],
  '山': [
    { w: '山',     r: 'やま',       m: 'mountain' },
    { w: '富士山', r: 'ふじさん',   m: 'Mt. Fuji' },
    { w: '山登り', r: 'やまのぼり', m: 'mountain climbing, hiking' },
  ],
  '白': [
    { w: '白',     r: 'しろ',       m: 'white' },
    { w: '白紙',   r: 'はくし',     m: 'blank paper, clean slate' },
    { w: '白黒',   r: 'しろくろ',   m: 'black and white' },
  ],
  '木': [
    { w: '木',     r: 'き',         m: 'tree, wood' },
    { w: '木曜日', r: 'もくようび', m: 'Thursday' },
    { w: '木の葉', r: 'このは',     m: 'leaf' },
  ],
  '本': [
    { w: '本',       r: 'ほん',       m: 'book' },
    { w: '日本',     r: 'にほん',     m: 'Japan' },
    { w: '本当に',   r: 'ほんとうに', m: 'really, truly' },
  ],
  '休': [
    { w: '休む',   r: 'やすむ',     m: 'to rest, to be absent' },
    { w: '休み',   r: 'やすみ',     m: 'rest, holiday, break' },
    { w: '夏休み', r: 'なつやすみ', m: 'summer vacation' },
  ],
  '南': [
    { w: '南',     r: 'みなみ',     m: 'south' },
    { w: '南口',   r: 'みなみぐち', m: 'south exit' },
    { w: '南北',   r: 'なんぼく',   m: 'north and south' },
  ],
  '後': [
    { w: '後',     r: 'あと',       m: 'after, later, behind' },
    { w: '後ろ',   r: 'うしろ',     m: 'back, behind' },
    { w: '午後',   r: 'ごご',       m: 'afternoon, p.m.' },
  ],
  '時': [
    { w: '時間',   r: 'じかん',     m: 'time, hours, duration' },
    { w: '何時',   r: 'なんじ',     m: 'what time' },
    { w: '時々',   r: 'ときどき',   m: 'sometimes, occasionally' },
  ],
  '水': [
    { w: '水',     r: 'みず',       m: 'water' },
    { w: '水曜日', r: 'すいようび', m: 'Wednesday' },
    { w: '水泳',   r: 'すいえい',   m: 'swimming' },
  ],
  '気': [
    { w: '天気',   r: 'てんき',     m: 'weather' },
    { w: '元気',   r: 'げんき',     m: 'healthy, energetic, lively' },
    { w: '気持ち', r: 'きもち',     m: 'feeling, mood' },
  ],
  '書': [
    { w: '書く',   r: 'かく',       m: 'to write' },
    { w: '教科書', r: 'きょうかしょ', m: 'textbook' },
    { w: '図書館', r: 'としょかん', m: 'library' },
  ],
  '金': [
    { w: 'お金',   r: 'おかね',     m: 'money' },
    { w: '金曜日', r: 'きんようび', m: 'Friday' },
    { w: '金色',   r: 'きんいろ',   m: 'gold color' },
  ],
  '食': [
    { w: '食べる', r: 'たべる',     m: 'to eat' },
    { w: '食事',   r: 'しょくじ',   m: 'meal' },
    { w: '朝食',   r: 'ちょうしょく', m: 'breakfast' },
  ],
  '高': [
    { w: '高い',   r: 'たかい',     m: 'tall, high; expensive' },
    { w: '高校',   r: 'こうこう',   m: 'high school' },
    { w: '最高',   r: 'さいこう',   m: 'the best, maximum' },
  ],
  '聞': [
    { w: '聞く',   r: 'きく',       m: 'to hear, to listen, to ask' },
    { w: '聞こえる', r: 'きこえる', m: 'to be audible, to sound' },
    { w: '新聞',   r: 'しんぶん',   m: 'newspaper' },
  ],
  '行': [
    { w: '行く',   r: 'いく',       m: 'to go' },
    { w: '旅行',   r: 'りょこう',   m: 'travel, trip' },
    { w: '銀行',   r: 'ぎんこう',   m: 'bank' },
  ],
  // ── N4 — bad API examples replaced ───────────────────────────────────────
  '世': [
    { w: '世界',   r: 'せかい',     m: 'world' },
    { w: '世の中', r: 'よのなか',   m: 'society, the world' },
    { w: '世紀',   r: 'せいき',     m: 'century' },
  ],
  '主': [
    { w: '主人',   r: 'しゅじん',   m: 'husband; master; owner; host' },
    { w: '主に',   r: 'おもに',     m: 'mainly, chiefly, primarily' },
    { w: '主役',   r: 'しゅやく',   m: 'lead role, main character' },
  ],
  '事': [
    { w: '仕事',   r: 'しごと',     m: 'work, job' },
    { w: '大事',   r: 'だいじ',     m: 'important; serious' },
    { w: '事故',   r: 'じこ',       m: 'accident' },
  ],
  '代': [
    { w: '時代',   r: 'じだい',     m: 'era, age, period' },
    { w: '代わり', r: 'かわり',     m: 'substitute, instead, in place of' },
    { w: '代表',   r: 'だいひょう', m: 'representative, typical example' },
  ],
  '朝': [
    { w: '朝',     r: 'あさ',       m: 'morning' },
    { w: '今朝',   r: 'けさ',       m: 'this morning' },
    { w: '朝食',   r: 'ちょうしょく', m: 'breakfast' },
  ],
  '春': [
    { w: '春',     r: 'はる',       m: 'spring (season)' },
    { w: '春休み', r: 'はるやすみ', m: 'spring break, spring vacation' },
    { w: '青春',   r: 'せいしゅん', m: 'youth, springtime of life' },
  ],
  '昼': [
    { w: '昼ご飯', r: 'ひるごはん', m: 'lunch' },
    { w: '昼食',   r: 'ちゅうしょく', m: 'lunch' },
    { w: '昼間',   r: 'ひるま',     m: 'daytime, during the day' },
  ],
  '真': [
    { w: '写真',   r: 'しゃしん',   m: 'photograph' },
    { w: '真実',   r: 'しんじつ',   m: 'truth, reality' },
    { w: '真面目', r: 'まじめ',     m: 'serious, sincere, diligent' },
  ],
  '映': [
    { w: '映画',   r: 'えいが',     m: 'movie, film' },
    { w: '映像',   r: 'えいぞう',   m: 'image, video, footage' },
    { w: '映る',   r: 'うつる',     m: 'to be reflected, to look (good/bad)' },
  ],
  '有': [
    { w: '有名',   r: 'ゆうめい',   m: 'famous, well-known' },
    { w: '有効',   r: 'ゆうこう',   m: 'valid, effective' },
    { w: '有利',   r: 'ゆうり',     m: 'advantageous, favorable' },
  ],
  '歩': [
    { w: '歩く',   r: 'あるく',     m: 'to walk' },
    { w: '散歩',   r: 'さんぽ',     m: 'walk, stroll' },
    { w: '一歩',   r: 'いっぽ',     m: 'one step' },
  ],
  '多': [
    { w: '多い',   r: 'おおい',     m: 'many, much, a lot' },
    { w: '多分',   r: 'たぶん',     m: 'probably, perhaps' },
    { w: '多少',   r: 'たしょう',   m: 'more or less, a little' },
  ],
  '色': [
    { w: '色',     r: 'いろ',       m: 'color' },
    { w: '色々',   r: 'いろいろ',   m: 'various, diverse, all sorts of' },
    { w: '黄色',   r: 'きいろ',     m: 'yellow' },
  ],
  '花': [
    { w: '花',     r: 'はな',       m: 'flower, blossom' },
    { w: '花見',   r: 'はなみ',     m: 'cherry blossom viewing' },
    { w: '花火',   r: 'はなび',     m: 'fireworks' },
  ],
  '赤': [
    { w: '赤',     r: 'あか',       m: 'red' },
    { w: '赤ちゃん', r: 'あかちゃん', m: 'baby, infant' },
    { w: '赤字',   r: 'あかじ',     m: 'deficit, being in the red' },
  ],
  '走': [
    { w: '走る',   r: 'はしる',     m: 'to run' },
    { w: '競走',   r: 'きょうそう', m: 'race' },
    { w: '走り回る', r: 'はしりまわる', m: 'to run around' },
  ],
  '起': [
    { w: '起きる', r: 'おきる',     m: 'to wake up; to occur, to happen' },
    { w: '早起き', r: 'はやおき',   m: 'early rising' },
    { w: '起こす', r: 'おこす',     m: 'to wake someone up; to cause' },
  ],
  '足': [
    { w: '足',     r: 'あし',       m: 'foot, leg' },
    { w: '足りる', r: 'たりる',     m: 'to be sufficient, to be enough' },
    { w: '不足',   r: 'ふそく',     m: 'shortage, lack' },
  ],
  '魚': [
    { w: '魚',     r: 'さかな',     m: 'fish' },
    { w: '金魚',   r: 'きんぎょ',   m: 'goldfish' },
    { w: '魚屋',   r: 'さかなや',   m: 'fishmonger, fish market' },
  ],
  '鳥': [
    { w: '小鳥',   r: 'ことり',     m: 'small bird, little bird' },
    { w: '野鳥',   r: 'やちょう',   m: 'wild bird' },
    { w: '鳥',     r: 'とり',       m: 'bird' },
  ],
  '牛': [
    { w: '牛',     r: 'うし',       m: 'cow, ox, bull' },
    { w: '牛乳',   r: 'ぎゅうにゅう', m: "cow's milk" },
    { w: '牛肉',   r: 'ぎゅうにく', m: 'beef' },
  ],
  '銀': [
    { w: '銀',     r: 'ぎん',       m: 'silver' },
    { w: '銀行',   r: 'ぎんこう',   m: 'bank' },
    { w: '銀メダル', r: 'ぎんめだる', m: 'silver medal' },
  ],
  '飲': [
    { w: '飲む',   r: 'のむ',       m: 'to drink' },
    { w: '飲み物', r: 'のみもの',   m: 'drink, beverage' },
    { w: '飲み水', r: 'のみみず',   m: 'drinking water' },
  ],
  '黒': [
    { w: '黒',     r: 'くろ',       m: 'black' },
    { w: '黒板',   r: 'こくばん',   m: 'blackboard' },
    { w: '黒字',   r: 'くろじ',     m: 'surplus, profit, in the black' },
  ],
  '古': [
    { w: '古い',   r: 'ふるい',     m: 'old, aged' },
    { w: '中古',   r: 'ちゅうこ',   m: 'used, secondhand' },
    { w: '古典',   r: 'こてん',     m: 'classic, classical literature' },
  ],
  '安': [
    { w: '安い',   r: 'やすい',     m: 'cheap, inexpensive' },
    { w: '安心',   r: 'あんしん',   m: 'peace of mind, relief' },
    { w: '安全',   r: 'あんぜん',   m: 'safe, security' },
  ],
  '室': [
    { w: '教室',   r: 'きょうしつ', m: 'classroom' },
    { w: '寝室',   r: 'しんしつ',   m: 'bedroom' },
    { w: '室内',   r: 'しつない',   m: 'indoors, inside a room' },
  ],
  '借': [
    { w: '借りる', r: 'かりる',     m: 'to borrow, to rent' },
    { w: '借金',   r: 'しゃっきん', m: 'debt' },
    { w: '貸し借り', r: 'かしかり', m: 'lending and borrowing' },
  ],
  '動': [
    { w: '動く',   r: 'うごく',     m: 'to move' },
    { w: '運動',   r: 'うんどう',   m: 'exercise, movement, campaign' },
    { w: '活動',   r: 'かつどう',   m: 'activity, action' },
  ],
  '口': [
    { w: '口',     r: 'くち',       m: 'mouth' },
    { w: '人口',   r: 'じんこう',   m: 'population' },
    { w: '出口',   r: 'でぐち',     m: 'exit' },
  ],
  '左': [
    { w: '左',     r: 'ひだり',     m: 'left, left side' },
    { w: '左右',   r: 'さゆう',     m: 'left and right' },
    { w: '左折',   r: 'させつ',     m: 'turning left' },
  ],
  '右': [
    { w: '右',     r: 'みぎ',       m: 'right, right side' },
    { w: '左右',   r: 'さゆう',     m: 'left and right' },
    { w: '右折',   r: 'うせつ',     m: 'turning right' },
  ],
  '午': [
    { w: '午後',   r: 'ごご',       m: 'afternoon, p.m.' },
    { w: '午前',   r: 'ごぜん',     m: 'morning, a.m.' },
    { w: '正午',   r: 'しょうご',   m: 'noon, midday' },
  ],
  '何': [
    { w: '何',     r: 'なに',       m: 'what' },
    { w: '何度',   r: 'なんど',     m: 'how many times; how many degrees' },
    { w: '何か',   r: 'なにか',     m: 'something' },
  ],
  '円': [
    { w: '千円',   r: 'せんえん',   m: '1,000 yen' },
    { w: '百円',   r: 'ひゃくえん', m: '100 yen' },
    { w: '円',     r: 'えん',       m: 'yen (Japanese currency); circle' },
  ],
  '出': [
    { w: '出る',   r: 'でる',       m: 'to exit, to leave, to come out' },
    { w: '出口',   r: 'でぐち',     m: 'exit' },
    { w: '輸出',   r: 'ゆしゅつ',   m: 'export' },
  ],
  '北': [
    { w: '北',     r: 'きた',       m: 'north' },
    { w: '北口',   r: 'きたぐち',   m: 'north exit' },
    { w: '北海道', r: 'ほっかいどう', m: 'Hokkaido (northernmost island of Japan)' },
  ],
  '友': [
    { w: '友達',   r: 'ともだち',   m: 'friend' },
    { w: '友人',   r: 'ゆうじん',   m: 'friend (formal)' },
    { w: '友好',   r: 'ゆうこう',   m: 'friendship, amity' },
  ],
  '名': [
    { w: '名前',   r: 'なまえ',     m: 'name' },
    { w: '名刺',   r: 'めいし',     m: 'business card' },
    { w: '有名',   r: 'ゆうめい',   m: 'famous, well-known' },
  ],
  '土': [
    { w: '土',     r: 'つち',       m: 'earth, soil, ground' },
    { w: '土曜日', r: 'どようび',   m: 'Saturday' },
    { w: '土地',   r: 'とち',       m: 'land, plot of land' },
  ],
  '年': [
    { w: '今年',   r: 'ことし',     m: 'this year' },
    { w: '来年',   r: 'らいねん',   m: 'next year' },
    { w: '昨年',   r: 'さくねん',   m: 'last year' },
  ],
  '日': [
    { w: '毎日',   r: 'まいにち',   m: 'every day' },
    { w: '今日',   r: 'きょう',     m: 'today' },
    { w: '休日',   r: 'きゅうじつ', m: 'holiday, day off' },
  ],
  '来': [
    { w: '来年',   r: 'らいねん',   m: 'next year' },
    { w: '来月',   r: 'らいげつ',   m: 'next month' },
    { w: '来週',   r: 'らいしゅう', m: 'next week' },
  ],
  '毎': [
    { w: '毎日',   r: 'まいにち',   m: 'every day' },
    { w: '毎週',   r: 'まいしゅう', m: 'every week' },
    { w: '毎朝',   r: 'まいあさ',   m: 'every morning' },
  ],
  '男': [
    { w: '男',     r: 'おとこ',     m: 'man, male' },
    { w: '男の子', r: 'おとこのこ', m: 'boy' },
    { w: '長男',   r: 'ちょうなん', m: 'eldest son' },
  ],
  '話': [
    { w: '話す',   r: 'はなす',     m: 'to speak, to talk' },
    { w: '話',     r: 'はなし',     m: 'story, talk, conversation' },
    { w: '電話',   r: 'でんわ',     m: 'telephone' },
  ],
  '読': [
    { w: '読む',   r: 'よむ',       m: 'to read' },
    { w: '読書',   r: 'どくしょ',   m: 'reading (books)' },
    { w: '読み方', r: 'よみかた',   m: 'way of reading; pronunciation' },
  ],
  '見': [
    { w: '見る',   r: 'みる',       m: 'to see, to look at, to watch' },
    { w: '見物',   r: 'けんぶつ',   m: 'sightseeing, watching' },
    { w: '見方',   r: 'みかた',     m: 'viewpoint, way of seeing' },
  ],
  '女': [
    { w: '女',     r: 'おんな',     m: 'woman, female' },
    { w: '女性',   r: 'じょせい',   m: 'woman, female' },
    { w: '女の子', r: 'おんなのこ', m: 'girl' },
  ],
  '母': [
    { w: 'お母さん', r: 'おかあさん', m: 'mother (polite)' },
    { w: '母',     r: 'はは',       m: 'mother (humble)' },
    { w: '母親',   r: 'ははおや',   m: 'mother' },
  ],
  '父': [
    { w: 'お父さん', r: 'おとうさん', m: 'father (polite)' },
    { w: '父',     r: 'ちち',       m: 'father (humble)' },
    { w: '父親',   r: 'ちちおや',   m: 'father' },
  ],
  '川': [
    { w: '川',     r: 'かわ',       m: 'river, stream' },
    { w: '川岸',   r: 'かわぎし',   m: 'riverbank' },
    { w: '天の川', r: 'あまのがわ', m: 'Milky Way' },
  ],
  '車': [
    { w: '電車',   r: 'でんしゃ',   m: 'train, electric train' },
    { w: '自動車', r: 'じどうしゃ', m: 'car, automobile' },
    { w: '駐車場', r: 'ちゅうしゃじょう', m: 'parking lot' },
  ],
  '間': [
    { w: '時間',   r: 'じかん',     m: 'time, hours, duration' },
    { w: '人間',   r: 'にんげん',   m: 'human being, person' },
    { w: '間',     r: 'あいだ',     m: 'between, space, interval' },
  ],
  '雨': [
    { w: '雨',     r: 'あめ',       m: 'rain' },
    { w: '梅雨',   r: 'つゆ',       m: 'rainy season' },
    { w: '大雨',   r: 'おおあめ',   m: 'heavy rain' },
  ],
  '今': [
    { w: '今日',   r: 'きょう',     m: 'today' },
    { w: '今月',   r: 'こんげつ',   m: 'this month' },
    { w: '今年',   r: 'ことし',     m: 'this year' },
  ],
  '前': [
    { w: '午前',   r: 'ごぜん',     m: 'morning, a.m.' },
    { w: '前',     r: 'まえ',       m: 'front, before, previous' },
    { w: '前半',   r: 'ぜんはん',   m: 'first half' },
  ],
  '半': [
    { w: '半分',   r: 'はんぶん',   m: 'half' },
    { w: '一時半', r: 'いちじはん', m: 'half past one' },
    { w: '前半',   r: 'ぜんはん',   m: 'first half' },
  ],
  '月': [
    { w: '今月',   r: 'こんげつ',   m: 'this month' },
    { w: '来月',   r: 'らいげつ',   m: 'next month' },
    { w: '月曜日', r: 'げつようび', m: 'Monday' },
  ],
  '火': [
    { w: '火',     r: 'ひ',         m: 'fire, flame' },
    { w: '火曜日', r: 'かようび',   m: 'Tuesday' },
    { w: '火山',   r: 'かざん',     m: 'volcano' },
  ],
  '語': [
    { w: '日本語', r: 'にほんご',   m: 'Japanese language' },
    { w: '英語',   r: 'えいご',     m: 'English language' },
    { w: '語',     r: 'ご',         m: 'language; word' },
  ],
  '長': [
    { w: '長い',   r: 'ながい',     m: 'long; lengthy' },
    { w: '校長',   r: 'こうちょう', m: 'school principal' },
    { w: '長男',   r: 'ちょうなん', m: 'eldest son' },
  ],
  '電': [
    { w: '電話',   r: 'でんわ',     m: 'telephone' },
    { w: '電気',   r: 'でんき',     m: 'electricity; light' },
    { w: '電車',   r: 'でんしゃ',   m: 'train, electric train' },
  ],
  // ── N4 — bad API examples replaced / quality overrides ──────────────────
  '仕': [
    { w: '仕事',     r: 'しごと',       m: 'work, job' },
    { w: '仕方',     r: 'しかた',       m: 'way, method, means' },
    { w: '仕組み',   r: 'しくみ',       m: 'structure, mechanism' },
  ],
  '以': [
    { w: '以上',     r: 'いじょう',     m: 'more than; above; that is all' },
    { w: '以前',     r: 'いぜん',       m: 'before, previously' },
    { w: '以来',     r: 'いらい',       m: 'since, ever since' },
  ],
  '会': [
    { w: '会議',     r: 'かいぎ',       m: 'meeting, conference' },
    { w: '会社',     r: 'かいしゃ',     m: 'company, corporation' },
    { w: '会話',     r: 'かいわ',       m: 'conversation' },
  ],
  '住': [
    { w: '住む',     r: 'すむ',         m: 'to live, to reside' },
    { w: '住所',     r: 'じゅうしょ',   m: 'address' },
    { w: '住宅',     r: 'じゅうたく',   m: 'house, residence' },
  ],
  '体': [
    { w: '体',       r: 'からだ',       m: 'body' },
    { w: '体育',     r: 'たいいく',     m: 'physical education' },
    { w: '全体',     r: 'ぜんたい',     m: 'whole, entirety' },
  ],
  '写': [
    { w: '写真',     r: 'しゃしん',     m: 'photograph, photo' },
    { w: '写す',     r: 'うつす',       m: 'to copy; to photograph' },
    { w: '写真集',   r: 'しゃしんしゅう', m: 'photo album' },
  ],
  '切': [
    { w: '大切',     r: 'たいせつ',     m: 'important, precious' },
    { w: '切る',     r: 'きる',         m: 'to cut' },
    { w: '切手',     r: 'きって',       m: 'postage stamp' },
  ],
  '力': [
    { w: '力',       r: 'ちから',       m: 'strength, power' },
    { w: '努力',     r: 'どりょく',     m: 'effort, hard work' },
    { w: '協力',     r: 'きょうりょく', m: 'cooperation' },
  ],
  '台': [
    { w: '台所',     r: 'だいどころ',   m: 'kitchen' },
    { w: '台風',     r: 'たいふう',     m: 'typhoon' },
    { w: '舞台',     r: 'ぶたい',       m: 'stage (theatre)' },
  ],
  '同': [
    { w: '同じ',     r: 'おなじ',       m: 'same, identical' },
    { w: '同時',     r: 'どうじ',       m: 'simultaneous, at the same time' },
    { w: '同僚',     r: 'どうりょう',   m: 'colleague, co-worker' },
  ],
  '味': [
    { w: '味',       r: 'あじ',         m: 'taste, flavor' },
    { w: '意味',     r: 'いみ',         m: 'meaning' },
    { w: '趣味',     r: 'しゅみ',       m: 'hobby, interest' },
  ],
  '始': [
    { w: '始まる',   r: 'はじまる',     m: 'to begin, to start' },
    { w: '始める',   r: 'はじめる',     m: 'to start (something)' },
    { w: '開始',     r: 'かいし',       m: 'start, commencement' },
  ],
  '字': [
    { w: '漢字',     r: 'かんじ',       m: 'kanji, Chinese character' },
    { w: '数字',     r: 'すうじ',       m: 'numeral, digit' },
    { w: '文字',     r: 'もじ',         m: 'letter, character' },
  ],
  '屋': [
    { w: '部屋',     r: 'へや',         m: 'room' },
    { w: '本屋',     r: 'ほんや',       m: 'bookstore' },
    { w: '花屋',     r: 'はなや',       m: 'florist, flower shop' },
  ],
  '帰': [
    { w: '帰る',     r: 'かえる',       m: 'to return home' },
    { w: '帰国',     r: 'きこく',       m: 'return to one\'s country' },
    { w: '帰宅',     r: 'きたく',       m: 'returning home' },
  ],
  '度': [
    { w: '温度',     r: 'おんど',       m: 'temperature' },
    { w: '程度',     r: 'ていど',       m: 'degree, extent' },
    { w: '今度',     r: 'こんど',       m: 'this time; next time' },
  ],
  '心': [
    { w: '心',       r: 'こころ',       m: 'heart, mind, spirit' },
    { w: '中心',     r: 'ちゅうしん',   m: 'center, core' },
    { w: '安心',     r: 'あんしん',     m: 'relief, peace of mind' },
  ],
  '急': [
    { w: '急ぐ',     r: 'いそぐ',       m: 'to hurry, to rush' },
    { w: '急に',     r: 'きゅうに',     m: 'suddenly, unexpectedly' },
    { w: '急行',     r: 'きゅうこう',   m: 'express (train)' },
  ],
  '悪': [
    { w: '悪い',     r: 'わるい',       m: 'bad, wrong, poor' },
    { w: '悪化',     r: 'あっか',       m: 'worsening, deterioration' },
    { w: '最悪',     r: 'さいあく',     m: 'worst, terrible' },
  ],
  '手': [
    { w: '手',       r: 'て',           m: 'hand' },
    { w: '手紙',     r: 'てがみ',       m: 'letter (mail)' },
    { w: '上手',     r: 'じょうず',     m: 'skilled, good at' },
  ],
  '持': [
    { w: '持つ',     r: 'もつ',         m: 'to hold, to carry' },
    { w: '気持ち',   r: 'きもち',       m: 'feeling, mood' },
    { w: '持ち物',   r: 'もちもの',     m: 'belongings, personal effects' },
  ],
  '教': [
    { w: '教える',   r: 'おしえる',     m: 'to teach, to tell' },
    { w: '教育',     r: 'きょういく',   m: 'education' },
    { w: '教室',     r: 'きょうしつ',   m: 'classroom' },
  ],
  '文': [
    { w: '文化',     r: 'ぶんか',       m: 'culture, civilization' },
    { w: '文章',     r: 'ぶんしょう',   m: 'sentence, text' },
    { w: '作文',     r: 'さくぶん',     m: 'essay, composition' },
  ],
  '料': [
    { w: '料理',     r: 'りょうり',     m: 'cooking, dish' },
    { w: '無料',     r: 'むりょう',     m: 'free of charge' },
    { w: '料金',     r: 'りょうきん',   m: 'fee, charge' },
  ],
  '新': [
    { w: '新しい',   r: 'あたらしい',   m: 'new' },
    { w: '新聞',     r: 'しんぶん',     m: 'newspaper' },
    { w: '新幹線',   r: 'しんかんせん', m: 'Shinkansen, bullet train' },
  ],
  '方': [
    { w: '方法',     r: 'ほうほう',     m: 'method, way' },
    { w: '方向',     r: 'ほうこう',     m: 'direction' },
    { w: '方針',     r: 'ほうしん',     m: 'policy, course of action' },
  ],
  '明': [
    { w: '明るい',   r: 'あかるい',     m: 'bright, cheerful' },
    { w: '説明',     r: 'せつめい',     m: 'explanation' },
    { w: '明日',     r: 'あした',       m: 'tomorrow' },
  ],
  '夕': [
    { w: '夕方',     r: 'ゆうがた',     m: 'evening, dusk' },
    { w: '夕食',     r: 'ゆうしょく',   m: 'dinner, supper' },
    { w: '夕日',     r: 'ゆうひ',       m: 'setting sun' },
  ],
  '夜': [
    { w: '夜',       r: 'よる',         m: 'night, evening' },
    { w: '今夜',     r: 'こんや',       m: 'tonight, this evening' },
    { w: '夜中',     r: 'よなか',       m: 'midnight, middle of the night' },
  ],
  '姉': [
    { w: '姉',       r: 'あね',         m: 'older sister' },
    { w: 'お姉さん', r: 'おねえさん',   m: 'older sister (polite form)' },
    { w: '姉妹',     r: 'しまい',       m: 'sisters' },
  ],
  '業': [
    { w: '授業',     r: 'じゅぎょう',   m: 'class, lesson' },
    { w: '卒業',     r: 'そつぎょう',   m: 'graduation' },
    { w: '工業',     r: 'こうぎょう',   m: 'industry, manufacturing' },
  ],
  '歌': [
    { w: '歌う',     r: 'うたう',       m: 'to sing' },
    { w: '歌',       r: 'うた',         m: 'song' },
    { w: '歌手',     r: 'かしゅ',       m: 'singer' },
  ],
  '洋': [
    { w: '洋服',     r: 'ようふく',     m: 'Western clothing' },
    { w: '太平洋',   r: 'たいへいよう', m: 'Pacific Ocean' },
    { w: '西洋',     r: 'せいよう',     m: 'Western countries, the West' },
  ],
  '海': [
    { w: '海',       r: 'うみ',         m: 'sea, ocean' },
    { w: '海外',     r: 'かいがい',     m: 'overseas, abroad' },
    { w: '海水浴',   r: 'かいすいよく', m: 'sea bathing, swimming in the sea' },
  ],
  '漢': [
    { w: '漢字',     r: 'かんじ',       m: 'kanji, Chinese character' },
    { w: '漢語',     r: 'かんご',       m: 'Chinese-origin word' },
    { w: '漢和辞典', r: 'かんわじてん', m: 'kanji dictionary' },
  ],
  '田': [
    { w: '田舎',     r: 'いなか',       m: 'countryside, rural area' },
    { w: '田んぼ',   r: 'たんぼ',       m: 'paddy field, rice field' },
    { w: '田園',     r: 'でんえん',     m: 'rural scenery, countryside' },
  ],
  '界': [
    { w: '世界',     r: 'せかい',       m: 'world' },
    { w: '限界',     r: 'げんかい',     m: 'limit, boundary' },
    { w: '業界',     r: 'ぎょうかい',   m: 'industry, business world' },
  ],
  '着': [
    { w: '着る',     r: 'きる',         m: 'to wear (clothing)' },
    { w: '着く',     r: 'つく',         m: 'to arrive' },
    { w: '到着',     r: 'とうちゃく',   m: 'arrival' },
  ],
  '知': [
    { w: '知る',     r: 'しる',         m: 'to know, to find out' },
    { w: '知識',     r: 'ちしき',       m: 'knowledge' },
    { w: '知り合い', r: 'しりあい',     m: 'acquaintance' },
  ],
  '社': [
    { w: '会社',     r: 'かいしゃ',     m: 'company, corporation' },
    { w: '社会',     r: 'しゃかい',     m: 'society' },
    { w: '神社',     r: 'じんじゃ',     m: 'Shinto shrine' },
  ],
  '私': [
    { w: '私',       r: 'わたし',       m: 'I, me' },
    { w: '私立',     r: 'しりつ',       m: 'private (school, etc.)' },
    { w: '私生活',   r: 'しせいかつ',   m: 'private life' },
  ],
  '究': [
    { w: '研究',     r: 'けんきゅう',   m: 'research, study' },
    { w: '研究者',   r: 'けんきゅうしゃ', m: 'researcher' },
    { w: '追究',     r: 'ついきゅう',   m: 'investigation, inquiry' },
  ],
  '終': [
    { w: '終わる',   r: 'おわる',       m: 'to end, to finish' },
    { w: '最終',     r: 'さいしゅう',   m: 'final, last' },
    { w: '終わり',   r: 'おわり',       m: 'end, conclusion' },
  ],
  '自': [
    { w: '自分',     r: 'じぶん',       m: 'oneself' },
    { w: '自由',     r: 'じゆう',       m: 'freedom, liberty' },
    { w: '自転車',   r: 'じてんしゃ',   m: 'bicycle' },
  ],
  '茶': [
    { w: 'お茶',     r: 'おちゃ',       m: 'tea' },
    { w: '茶色',     r: 'ちゃいろ',     m: 'brown (color)' },
    { w: '茶道',     r: 'さどう',       m: 'tea ceremony' },
  ],
  '親': [
    { w: '親',       r: 'おや',         m: 'parent' },
    { w: '親切',     r: 'しんせつ',     m: 'kind, kindness' },
    { w: '親友',     r: 'しんゆう',     m: 'close friend, best friend' },
  ],
  '質': [
    { w: '質問',     r: 'しつもん',     m: 'question' },
    { w: '品質',     r: 'ひんしつ',     m: 'quality (of a product)' },
    { w: '性質',     r: 'せいしつ',     m: 'nature, character, property' },
  ],
  '近': [
    { w: '近い',     r: 'ちかい',       m: 'near, close' },
    { w: '最近',     r: 'さいきん',     m: 'recently, lately' },
    { w: '近所',     r: 'きんじょ',     m: 'neighborhood' },
  ],
  '元': [
    { w: '元気',     r: 'げんき',       m: 'energetic, healthy; fine' },
    { w: '元',       r: 'もと',         m: 'origin, former' },
    { w: '地元',     r: 'じもと',       m: 'local, home area' },
  ],
  '勉': [
    { w: '勉強',     r: 'べんきょう',   m: 'study, learning' },
    { w: '勤勉',     r: 'きんべん',     m: 'diligent, hardworking' },
    { w: '勉学',     r: 'べんがく',     m: 'studying, pursuit of knowledge' },
  ],
  '問': [
    { w: '問題',     r: 'もんだい',     m: 'problem, issue, question' },
    { w: '質問',     r: 'しつもん',     m: 'question' },
    { w: '問う',     r: 'とう',         m: 'to ask, to question' },
  ],
  '待': [
    { w: '待つ',     r: 'まつ',         m: 'to wait' },
    { w: '期待',     r: 'きたい',       m: 'expectation, hope' },
    { w: '招待',     r: 'しょうたい',   m: 'invitation' },
  ],
  '思': [
    { w: '思う',     r: 'おもう',       m: 'to think, to feel' },
    { w: '思い出',   r: 'おもいで',     m: 'memory, recollection' },
    { w: '思い',     r: 'おもい',       m: 'thought, feeling' },
  ],
  '旅': [
    { w: '旅行',     r: 'りょこう',     m: 'travel, trip' },
    { w: '旅',       r: 'たび',         m: 'journey, travel' },
    { w: '旅館',     r: 'りょかん',     m: 'Japanese inn' },
  ],
  '族': [
    { w: '家族',     r: 'かぞく',       m: 'family' },
    { w: '民族',     r: 'みんぞく',     m: 'people, ethnic group' },
    { w: '水族館',   r: 'すいぞくかん', m: 'aquarium' },
  ],
  '注': [
    { w: '注意',     r: 'ちゅうい',     m: 'attention, caution, warning' },
    { w: '注文',     r: 'ちゅうもん',   m: 'order (for an item)' },
    { w: '注目',     r: 'ちゅうもく',   m: 'attention, notice' },
  ],
  '物': [
    { w: '動物',     r: 'どうぶつ',     m: 'animal' },
    { w: '食べ物',   r: 'たべもの',     m: 'food' },
    { w: '建物',     r: 'たてもの',     m: 'building' },
  ],
  '用': [
    { w: '用',       r: 'よう',         m: 'use; business; errand' },
    { w: '使用',     r: 'しよう',       m: 'use, application' },
    { w: '費用',     r: 'ひよう',       m: 'cost, expense' },
  ],
  '町': [
    { w: '町',       r: 'まち',         m: 'town, city district' },
    { w: '下町',     r: 'したまち',     m: 'downtown, old city area' },
    { w: '市町村',   r: 'しちょうそん', m: 'cities, towns and villages' },
  ],
  '秋': [
    { w: '秋',       r: 'あき',         m: 'autumn, fall' },
    { w: '秋分',     r: 'しゅうぶん',   m: 'autumnal equinox' },
    { w: '春夏秋冬', r: 'しゅんかしゅうとう', m: 'four seasons' },
  ],
  '答': [
    { w: '答える',   r: 'こたえる',     m: 'to answer, to respond' },
    { w: '答',       r: 'こたえ',       m: 'answer, response' },
    { w: '回答',     r: 'かいとう',     m: 'reply, answer' },
  ],
  '肉': [
    { w: '肉',       r: 'にく',         m: 'meat' },
    { w: '牛肉',     r: 'ぎゅうにく',   m: 'beef' },
    { w: '肉料理',   r: 'にくりょうり', m: 'meat dish' },
  ],
  '買': [
    { w: '買う',     r: 'かう',         m: 'to buy' },
    { w: '買い物',   r: 'かいもの',     m: 'shopping' },
    { w: '売買',     r: 'ばいばい',     m: 'buying and selling, trade' },
  ],
  '通': [
    { w: '通る',     r: 'とおる',       m: 'to pass, to go through' },
    { w: '通学',     r: 'つうがく',     m: 'commuting to school' },
    { w: '普通',     r: 'ふつう',       m: 'ordinary, usual, normal' },
  ],
  '道': [
    { w: '道',       r: 'みち',         m: 'road, way, path' },
    { w: '近道',     r: 'ちかみち',     m: 'shortcut' },
    { w: '道路',     r: 'どうろ',       m: 'road, highway' },
  ],
  '開': [
    { w: '開ける',   r: 'あける',       m: 'to open' },
    { w: '開発',     r: 'かいはつ',     m: 'development' },
    { w: '公開',     r: 'こうかい',     m: 'opening to the public' },
  ],
  '院': [
    { w: '病院',     r: 'びょういん',   m: 'hospital' },
    { w: '大学院',   r: 'だいがくいん', m: 'graduate school' },
    { w: '入院',     r: 'にゅういん',   m: 'hospitalization' },
  ],
  '青': [
    { w: '青い',     r: 'あおい',       m: 'blue; green' },
    { w: '青空',     r: 'あおぞら',     m: 'blue sky' },
    { w: '青年',     r: 'せいねん',     m: 'youth, young person' },
  ],
  '音': [
    { w: '音楽',     r: 'おんがく',     m: 'music' },
    { w: '音',       r: 'おと',         m: 'sound, noise' },
    { w: '発音',     r: 'はつおん',     m: 'pronunciation' },
  ],
  '題': [
    { w: '問題',     r: 'もんだい',     m: 'problem, issue, question' },
    { w: '話題',     r: 'わだい',       m: 'topic, subject of conversation' },
    { w: '課題',     r: 'かだい',       m: 'homework, task, assignment' },
  ],
  '風': [
    { w: '風',       r: 'かぜ',         m: 'wind' },
    { w: '台風',     r: 'たいふう',     m: 'typhoon' },
    { w: '風景',     r: 'ふうけい',     m: 'scenery, landscape' },
  ],
  '駅': [
    { w: '駅',       r: 'えき',         m: 'station' },
    { w: '駅前',     r: 'えきまえ',     m: 'in front of the station' },
    { w: '駅員',     r: 'えきいん',     m: 'station staff' },
  ],
  // ── N4 wave 3 — remaining API overrides ──────────────────────────────────
  '少': [
    { w: '少し',     r: 'すこし',       m: 'a little, slightly' },
    { w: '少ない',   r: 'すくない',     m: 'few, little (in quantity)' },
    { w: '少なくとも', r: 'すくなくとも', m: 'at least' },
  ],
  '犬': [
    { w: '犬',       r: 'いぬ',         m: 'dog' },
    { w: '子犬',     r: 'こいぬ',       m: 'puppy' },
    { w: '番犬',     r: 'ばんけん',     m: 'watchdog, guard dog' },
  ],
  '病': [
    { w: '病院',     r: 'びょういん',   m: 'hospital' },
    { w: '病気',     r: 'びょうき',     m: 'illness, sickness' },
    { w: '看病',     r: 'かんびょう',   m: 'nursing, caring for the sick' },
  ],
  '研': [
    { w: '研究',     r: 'けんきゅう',   m: 'research' },
    { w: '研究者',   r: 'けんきゅうしゃ', m: 'researcher' },
    { w: '研修',     r: 'けんしゅう',   m: 'training, internship' },
  ],
  '作': [
    { w: '作品',     r: 'さくひん',     m: 'work, creation (art, literature)' },
    { w: '作業',     r: 'さぎょう',     m: 'task, operation, work' },
    { w: '作家',     r: 'さっか',       m: 'author, writer' },
  ],
  '兄': [
    { w: '兄',       r: 'あに',         m: 'older brother' },
    { w: 'お兄さん', r: 'おにいさん',   m: 'older brother (polite)' },
    { w: '兄弟',     r: 'きょうだい',   m: 'siblings, brothers and sisters' },
  ],
  '冬': [
    { w: '冬',       r: 'ふゆ',         m: 'winter' },
    { w: '冬休み',   r: 'ふゆやすみ',   m: 'winter vacation' },
    { w: '冬至',     r: 'とうじ',       m: 'winter solstice' },
  ],
  '別': [
    { w: '特別',     r: 'とくべつ',     m: 'special' },
    { w: '別れ',     r: 'わかれ',       m: 'parting, farewell' },
    { w: '区別',     r: 'くべつ',       m: 'distinction, difference' },
  ],
  '堂': [
    { w: '食堂',     r: 'しょくどう',   m: 'cafeteria, dining hall' },
    { w: '本堂',     r: 'ほんどう',     m: 'main hall (of a temple)' },
    { w: '堂々',     r: 'どうどう',     m: 'majestic, dignified' },
  ],
  '売': [
    { w: '売る',     r: 'うる',         m: 'to sell' },
    { w: '売り場',   r: 'うりば',       m: 'sales floor, counter' },
    { w: '販売',     r: 'はんばい',     m: 'sales' },
  ],
  '妹': [
    { w: '妹',       r: 'いもうと',     m: 'younger sister' },
    { w: '姉妹',     r: 'しまい',       m: 'sisters' },
    { w: '兄妹',     r: 'あにいもうと', m: 'older brother and younger sister' },
  ],
  '広': [
    { w: '広い',     r: 'ひろい',       m: 'wide, spacious, broad' },
    { w: '広告',     r: 'こうこく',     m: 'advertisement' },
    { w: '広場',     r: 'ひろば',       m: 'plaza, open space' },
  ],
  '建': [
    { w: '建てる',   r: 'たてる',       m: 'to build, to construct' },
    { w: '建物',     r: 'たてもの',     m: 'building' },
    { w: '建築',     r: 'けんちく',     m: 'architecture, building construction' },
  ],
  '強': [
    { w: '強い',     r: 'つよい',       m: 'strong, powerful' },
    { w: '勉強',     r: 'べんきょう',   m: 'study' },
    { w: '強調',     r: 'きょうちょう', m: 'emphasis, stress' },
  ],
  '意': [
    { w: '意味',     r: 'いみ',         m: 'meaning' },
    { w: '意見',     r: 'いけん',       m: 'opinion' },
    { w: '注意',     r: 'ちゅうい',     m: 'attention, caution' },
  ],
  '紙': [
    { w: '紙',       r: 'かみ',         m: 'paper' },
    { w: '手紙',     r: 'てがみ',       m: 'letter (mail)' },
    { w: '折り紙',   r: 'おりがみ',     m: 'origami, paper folding' },
  ],
  '言': [
    { w: '言う',     r: 'いう',         m: 'to say, to speak' },
    { w: '言葉',     r: 'ことば',       m: 'word, expression, language' },
    { w: '発言',     r: 'はつげん',     m: 'statement, remark' },
  ],
  '計': [
    { w: '計画',     r: 'けいかく',     m: 'plan, project' },
    { w: '合計',     r: 'ごうけい',     m: 'total, sum' },
    { w: '時計',     r: 'とけい',       m: 'clock, watch' },
  ],
  '貸': [
    { w: '貸す',     r: 'かす',         m: 'to lend, to loan' },
    { w: '貸し出し', r: 'かしだし',     m: 'lending, checkout' },
    { w: '賃貸',     r: 'ちんたい',     m: 'rental, lease' },
  ],
  '送': [
    { w: '送る',     r: 'おくる',       m: 'to send; to see off' },
    { w: '放送',     r: 'ほうそう',     m: 'broadcasting' },
    { w: '送別会',   r: 'そうべつかい', m: 'farewell party' },
  ],
  '週': [
    { w: '今週',     r: 'こんしゅう',   m: 'this week' },
    { w: '来週',     r: 'らいしゅう',   m: 'next week' },
    { w: '毎週',     r: 'まいしゅう',   m: 'every week' },
  ],
  '集': [
    { w: '集める',   r: 'あつめる',     m: 'to collect, to gather' },
    { w: '集まる',   r: 'あつまる',     m: 'to gather, to come together' },
    { w: '集合',     r: 'しゅうごう',   m: 'assembly, gathering point' },
  ],
  '飯': [
    { w: 'ご飯',     r: 'ごはん',       m: 'cooked rice; meal' },
    { w: '夕飯',     r: 'ゆうはん',     m: 'dinner, evening meal' },
    { w: '朝ご飯',   r: 'あさごはん',   m: 'breakfast' },
  ],
  // ── N3 — bad API examples replaced ───────────────────────────────────────
  '命': [
    { w: '命',     r: 'いのち',     m: 'life' },
    { w: '生命',   r: 'せいめい',   m: 'life, existence' },
    { w: '革命',   r: 'かくめい',   m: 'revolution' },
  ],
  '和': [
    { w: '和食',   r: 'わしょく',   m: 'Japanese cuisine' },
    { w: '平和',   r: 'へいわ',     m: 'peace' },
    { w: '和室',   r: 'わしつ',     m: 'Japanese-style room' },
  ],
  '化': [
    { w: '変化',   r: 'へんか',     m: 'change, variation' },
    { w: '文化',   r: 'ぶんか',     m: 'culture, civilization' },
    { w: '化学',   r: 'かがく',     m: 'chemistry' },
  ],
  '勝': [
    { w: '勝つ',   r: 'かつ',       m: 'to win' },
    { w: '優勝',   r: 'ゆうしょう', m: 'championship, winning first place' },
    { w: '勝負',   r: 'しょうぶ',   m: 'match, game, contest' },
  ],
  '息': [
    { w: '息',     r: 'いき',       m: 'breath' },
    { w: '息子',   r: 'むすこ',     m: 'son' },
    { w: '休息',   r: 'きゅうそく', m: 'rest, repose' },
  ],
  '労': [
    { w: '労働',   r: 'ろうどう',   m: 'labour, work, toil' },
    { w: '苦労',   r: 'くろう',     m: 'hardship, difficulty, trouble' },
    { w: '労力',   r: 'ろうりょく', m: 'effort, labour, toil' },
  ],
  '交': [
    { w: '交流',   r: 'こうりゅう', m: 'exchange, interaction' },
    { w: '交差点', r: 'こうさてん', m: 'intersection, crossroads' },
    { w: '外交',   r: 'がいこう',   m: 'diplomacy, foreign affairs' },
  ],

  // ── N3 wave 2 — critical fixes ────────────────────────────────────────────
  // OFFENSIVE CONTENT
  '猫': [
    { w: '猫',       r: 'ねこ',         m: 'cat' },
    { w: '子猫',     r: 'こねこ',       m: 'kitten' },
    { w: '猫背',     r: 'ねこぜ',       m: 'hunched back, slouch' },
  ],
  '笑': [
    { w: '笑う',     r: 'わらう',       m: 'to laugh, to smile' },
    { w: '笑顔',     r: 'えがお',       m: 'smiling face' },
    { w: '苦笑い',   r: 'くしょうい',   m: 'wry smile, bitter laugh' },
  ],
  '精': [
    { w: '精神',     r: 'せいしん',     m: 'mind, spirit' },
    { w: '精一杯',   r: 'せいいっぱい', m: 'with all one\'s strength' },
    { w: '精密',     r: 'せいみつ',     m: 'precise, detailed' },
  ],
  // COMPLETELY WRONG DEFINITIONS
  '腹': [
    { w: 'お腹',     r: 'おなか',       m: 'stomach, belly' },
    { w: '腹',       r: 'はら',         m: 'belly, abdomen' },
    { w: '腹立てる', r: 'はらだてる',   m: 'to get angry' },
  ],
  '緒': [
    { w: '一緒',     r: 'いっしょ',     m: 'together' },
    { w: '内緒',     r: 'ないしょ',     m: 'secret, private' },
    { w: '情緒',     r: 'じょうちょ',   m: 'emotion, atmosphere' },
  ],
  '老': [
    { w: '老人',     r: 'ろうじん',     m: 'elderly person' },
    { w: '老いる',   r: 'おいる',       m: 'to grow old' },
    { w: '老後',     r: 'ろうご',       m: 'old age, one\'s later years' },
  ],
  '耳': [
    { w: '耳',       r: 'みみ',         m: 'ear' },
    { w: '耳鳴り',   r: 'みみなり',     m: 'ringing in the ears' },
    { w: '耳元',     r: 'みみもと',     m: 'close to one\'s ear' },
  ],
  '育': [
    { w: '育てる',   r: 'そだてる',     m: 'to raise, to bring up' },
    { w: '教育',     r: 'きょういく',   m: 'education' },
    { w: '保育園',   r: 'ほいくえん',   m: 'nursery school, daycare' },
  ],
  '術': [
    { w: '手術',     r: 'しゅじゅつ',   m: 'surgery, operation' },
    { w: '技術',     r: 'ぎじゅつ',     m: 'technology, skill' },
    { w: '美術',     r: 'びじゅつ',     m: 'fine arts' },
  ],
  '解': [
    { w: '理解',     r: 'りかい',       m: 'understanding, comprehension' },
    { w: '解く',     r: 'とく',         m: 'to solve, to untie' },
    { w: '解説',     r: 'かいせつ',     m: 'explanation, commentary' },
  ],
  '許': [
    { w: '許す',     r: 'ゆるす',       m: 'to forgive, to permit' },
    { w: '許可',     r: 'きょか',       m: 'permission, authorization' },
    { w: '免許',     r: 'めんきょ',     m: 'license (driving, etc.)' },
  ],
  '盗': [
    { w: '盗む',     r: 'ぬすむ',       m: 'to steal, to pilfer' },
    { w: '強盗',     r: 'ごうとう',     m: 'robber, thief' },
    { w: '盗難',     r: 'とうなん',     m: 'theft, robbery' },
  ],
  '礼': [
    { w: '礼',       r: 'れい',         m: 'bow, courtesy, thanks' },
    { w: '礼儀',     r: 'れいぎ',       m: 'manners, etiquette' },
    { w: '失礼',     r: 'しつれい',     m: 'rudeness; excuse me' },
  ],
  '断': [
    { w: '断る',     r: 'ことわる',     m: 'to refuse, to decline' },
    { w: '判断',     r: 'はんだん',     m: 'judgment, decision' },
    { w: '決断',     r: 'けつだん',     m: 'determination, resolution' },
  ],
  '果': [
    { w: '果物',     r: 'くだもの',     m: 'fruit' },
    { w: '結果',     r: 'けっか',       m: 'result, outcome' },
    { w: '成果',     r: 'せいか',       m: 'result, achievement' },
  ],
  '破': [
    { w: '破る',     r: 'やぶる',       m: 'to tear, to break' },
    { w: '破壊',     r: 'はかい',       m: 'destruction' },
    { w: '突破',     r: 'とっぱ',       m: 'breakthrough, breaking through' },
  ],
  '路': [
    { w: '道路',     r: 'どうろ',       m: 'road, highway' },
    { w: '路線',     r: 'ろせん',       m: 'route (bus, train)' },
    { w: '通路',     r: 'つうろ',       m: 'passage, aisle, corridor' },
  ],
  '途': [
    { w: '途中',     r: 'とちゅう',     m: 'on the way, midway' },
    { w: '用途',     r: 'ようと',       m: 'use, purpose, application' },
    { w: '途切れる', r: 'とぎれる',     m: 'to be interrupted, to pause' },
  ],
  '薬': [
    { w: '薬',       r: 'くすり',       m: 'medicine, drug' },
    { w: '薬局',     r: 'やっきょく',   m: 'pharmacy, drugstore' },
    { w: '薬品',     r: 'やくひん',     m: 'medicine, chemicals' },
  ],
  '遊': [
    { w: '遊ぶ',     r: 'あそぶ',       m: 'to play, to have fun' },
    { w: '遊び',     r: 'あそび',       m: 'play, game, fun' },
    { w: '遊園地',   r: 'ゆうえんち',   m: 'amusement park' },
  ],
  '渡': [
    { w: '渡す',     r: 'わたす',       m: 'to hand over, to pass' },
    { w: '渡る',     r: 'わたる',       m: 'to cross (a bridge, street)' },
    { w: '渡航',     r: 'とこう',       m: 'voyage, journey abroad' },
  ],
  '欠': [
    { w: '欠ける',   r: 'かける',       m: 'to be lacking, to be missing' },
    { w: '欠席',     r: 'けっせき',     m: 'absence' },
    { w: '欠点',     r: 'けってん',     m: 'flaw, shortcoming, defect' },
  ],
  '殺': [
    { w: '殺す',     r: 'ころす',       m: 'to kill' },
    { w: '殺人',     r: 'さつじん',     m: 'murder' },
    { w: '暗殺',     r: 'あんさつ',     m: 'assassination' },
  ],
  '良': [
    { w: '良い',     r: 'よい',         m: 'good, fine' },
    { w: '良質',     r: 'りょうしつ',   m: 'high quality' },
    { w: '改良',     r: 'かいりょう',   m: 'improvement, reform' },
  ],
  '眠': [
    { w: '眠る',     r: 'ねむる',       m: 'to sleep' },
    { w: '眠い',     r: 'ねむい',       m: 'sleepy, drowsy' },
    { w: '睡眠',     r: 'すいみん',     m: 'sleep' },
  ],
  '石': [
    { w: '石',       r: 'いし',         m: 'stone, rock' },
    { w: '石油',     r: 'せきゆ',       m: 'oil, petroleum' },
    { w: '石けん',   r: 'せっけん',     m: 'soap' },
  ],
  '種': [
    { w: '種類',     r: 'しゅるい',     m: 'type, kind, variety' },
    { w: '種',       r: 'たね',         m: 'seed; kind, type' },
    { w: '各種',     r: 'かくしゅ',     m: 'various kinds, all sorts' },
  ],
  '流': [
    { w: '流れる',   r: 'ながれる',     m: 'to flow, to stream' },
    { w: '流行',     r: 'りゅうこう',   m: 'trend, fashion' },
    { w: '流通',     r: 'りゅうつう',   m: 'distribution, circulation' },
  ],
  '求': [
    { w: '求める',   r: 'もとめる',     m: 'to seek, to want' },
    { w: '要求',     r: 'ようきゅう',   m: 'demand, request' },
    { w: '請求書',   r: 'せいきゅうしょ', m: 'invoice, bill' },
  ],
  '絵': [
    { w: '絵',       r: 'え',           m: 'picture, drawing, painting' },
    { w: '絵画',     r: 'かいが',       m: 'painting, picture' },
    { w: '似顔絵',   r: 'にがおえ',     m: 'portrait, likeness' },
  ],
  '祖': [
    { w: '祖父',     r: 'そふ',         m: 'grandfather' },
    { w: '祖母',     r: 'そぼ',         m: 'grandmother' },
    { w: '先祖',     r: 'せんぞ',       m: 'ancestor, forefather' },
  ],
  '神': [
    { w: '神',       r: 'かみ',         m: 'god, deity' },
    { w: '神社',     r: 'じんじゃ',     m: 'Shinto shrine' },
    { w: '精神',     r: 'せいしん',     m: 'mind, spirit' },
  ],
  '貧': [
    { w: '貧しい',   r: 'まずしい',     m: 'poor, impoverished' },
    { w: '貧困',     r: 'ひんこん',     m: 'poverty' },
    { w: '貧乏',     r: 'びんぼう',     m: 'poverty, being poor' },
  ],
  '訪': [
    { w: '訪問',     r: 'ほうもん',     m: 'visit, call' },
    { w: '訪れる',   r: 'おとずれる',   m: 'to visit, to come' },
    { w: '訪日',     r: 'ほうにち',     m: 'visit to Japan' },
  ],
  '王': [
    { w: '王',       r: 'おう',         m: 'king, monarch' },
    { w: '国王',     r: 'こくおう',     m: 'king, sovereign' },
    { w: '王様',     r: 'おうさま',     m: 'king (respectful)' },
  ],
  '景': [
    { w: '景色',     r: 'けしき',       m: 'scenery, view' },
    { w: '背景',     r: 'はいけい',     m: 'background' },
    { w: '景気',     r: 'けいき',       m: 'economic conditions, business' },
  ],
  '晴': [
    { w: '晴れ',     r: 'はれ',         m: 'clear weather, sunny' },
    { w: '晴れる',   r: 'はれる',       m: 'to clear up (weather)' },
    { w: '素晴らしい', r: 'すばらしい', m: 'wonderful, splendid' },
  ],
  '暗': [
    { w: '暗い',     r: 'くらい',       m: 'dark, gloomy' },
    { w: '暗記',     r: 'あんき',       m: 'memorization, learning by heart' },
    { w: '暗号',     r: 'あんごう',     m: 'code, cipher' },
  ],
  '申': [
    { w: '申す',     r: 'もうす',       m: 'to say (humble form)' },
    { w: '申し込む', r: 'もうしこむ',   m: 'to apply, to register' },
    { w: '申し訳ない', r: 'もうしわけない', m: 'I\'m sorry, inexcusable' },
  ],
  '留': [
    { w: '留学',     r: 'りゅうがく',   m: 'studying abroad' },
    { w: '留守',     r: 'るす',         m: 'absence from home' },
    { w: '留まる',   r: 'とどまる',     m: 'to stay, to remain' },
  ],
  '越': [
    { w: '越える',   r: 'こえる',       m: 'to cross over, to exceed' },
    { w: '引っ越し', r: 'ひっこし',     m: 'moving (house)' },
    { w: '乗り越える', r: 'のりこえる', m: 'to overcome, to get through' },
  ],
  '辞': [
    { w: '辞書',     r: 'じしょ',       m: 'dictionary' },
    { w: '辞める',   r: 'やめる',       m: 'to resign, to quit' },
    { w: '辞典',     r: 'じてん',       m: 'dictionary, lexicon' },
  ],
  '職': [
    { w: '職業',     r: 'しょくぎょう', m: 'occupation, profession' },
    { w: '職場',     r: 'しょくば',     m: 'workplace' },
    { w: '就職',     r: 'しゅうしょく', m: 'getting a job, employment' },
  ],
  '苦': [
    { w: '苦しい',   r: 'くるしい',     m: 'painful, difficult, distressing' },
    { w: '苦手',     r: 'にがて',       m: 'weak point; not good at' },
    { w: '苦労',     r: 'くろう',       m: 'hardship, trouble' },
  ],
  '犯': [
    { w: '犯人',     r: 'はんにん',     m: 'criminal, offender' },
    { w: '犯罪',     r: 'はんざい',     m: 'crime' },
    { w: '犯す',     r: 'おかす',       m: 'to commit (a crime), to violate' },
  ],
  '民': [
    { w: '国民',     r: 'こくみん',     m: 'citizens, people of a nation' },
    { w: '住民',     r: 'じゅうみん',   m: 'residents, inhabitants' },
    { w: '民主主義', r: 'みんしゅしゅぎ', m: 'democracy' },
  ],
  '閉': [
    { w: '閉める',   r: 'しめる',       m: 'to close, to shut' },
    { w: '閉まる',   r: 'しまる',       m: 'to be closed, to shut' },
    { w: '閉会',     r: 'へいかい',     m: 'close of a meeting, adjournment' },
  ],
  '草': [
    { w: '草',       r: 'くさ',         m: 'grass, weed' },
    { w: '草原',     r: 'そうげん',     m: 'grassland, meadow' },
    { w: '雑草',     r: 'ざっそう',     m: 'weed' },
  ],
  '突': [
    { w: '突然',     r: 'とつぜん',     m: 'suddenly, unexpectedly' },
    { w: '衝突',     r: 'しょうとつ',   m: 'collision, conflict' },
    { w: '突く',     r: 'つく',         m: 'to thrust, to poke' },
  ],
  '等': [
    { w: '平等',     r: 'びょうどう',   m: 'equality, equal treatment' },
    { w: '等しい',   r: 'ひとしい',     m: 'equal, identical' },
    { w: '高等',     r: 'こうとう',     m: 'high level, advanced' },
  ],
  '米': [
    { w: '米',       r: 'こめ',         m: 'rice (uncooked)' },
    { w: '米国',     r: 'べいこく',     m: 'United States of America' },
    { w: '白米',     r: 'はくまい',     m: 'white rice' },
  ],
  '速': [
    { w: '速い',     r: 'はやい',       m: 'fast, quick, rapid' },
    { w: '速度',     r: 'そくど',       m: 'speed, velocity' },
    { w: '急速',     r: 'きゅうそく',   m: 'rapid, swift' },
  ],
  '遅': [
    { w: '遅い',     r: 'おそい',       m: 'slow; late' },
    { w: '遅れる',   r: 'おくれる',     m: 'to be late, to be delayed' },
    { w: '遅延',     r: 'ちえん',       m: 'delay' },
  ],
  '船': [
    { w: '船',       r: 'ふね',         m: 'ship, boat' },
    { w: '漁船',     r: 'ぎょせん',     m: 'fishing boat' },
    { w: '乗船',     r: 'じょうせん',   m: 'boarding a ship' },
  ],
  '識': [
    { w: '意識',     r: 'いしき',       m: 'consciousness, awareness' },
    { w: '認識',     r: 'にんしき',     m: 'recognition, understanding' },
    { w: '知識',     r: 'ちしき',       m: 'knowledge' },
  ],

  // ── N3 wave 3 — remaining bad counter/ateji fixes ─────────────────────────
  '信': [
    { w: '信じる',   r: 'しんじる',     m: 'to believe, to trust' },
    { w: '通信',     r: 'つうしん',     m: 'communication, correspondence' },
    { w: '自信',     r: 'じしん',       m: 'self-confidence' },
  ],
  '客': [
    { w: 'お客さん', r: 'おきゃくさん', m: 'guest, customer' },
    { w: '乗客',     r: 'じょうきゃく', m: 'passenger' },
    { w: '観客',     r: 'かんきゃく',   m: 'spectator, audience' },
  ],
  '更': [
    { w: '変更',     r: 'へんこう',     m: 'change, alteration' },
    { w: '更新',     r: 'こうしん',     m: 'renewal, update' },
    { w: '更に',     r: 'さらに',       m: 'furthermore, even more' },
  ],
  '球': [
    { w: '野球',     r: 'やきゅう',     m: 'baseball' },
    { w: '地球',     r: 'ちきゅう',     m: 'Earth, the globe' },
    { w: '球場',     r: 'きゅうじょう', m: 'baseball stadium' },
  ],
  '頭': [
    { w: '頭',       r: 'あたま',       m: 'head, mind' },
    { w: '冒頭',     r: 'ぼうとう',     m: 'beginning, opening' },
    { w: '先頭',     r: 'せんとう',     m: 'head (of a line), front' },
  ],

  // ── N3 wave 4 — wrong definitions / ateji cleanup ─────────────────────────
  '便': [
    { w: '便利',     r: 'べんり',       m: 'convenient, handy' },
    { w: '不便',     r: 'ふべん',       m: 'inconvenient, impractical' },
    { w: '郵便',     r: 'ゆうびん',     m: 'mail, post' },
  ],
  '係': [
    { w: '関係',     r: 'かんけい',     m: 'relationship, connection' },
    { w: '係員',     r: 'かかりいん',   m: 'staff member, clerk' },
    { w: '係る',     r: 'かかわる',     m: 'to be involved, to relate to' },
  ],
  '側': [
    { w: '内側',     r: 'うちがわ',     m: 'inside, inner side' },
    { w: '外側',     r: 'そとがわ',     m: 'outside, outer side' },
    { w: '側面',     r: 'そくめん',     m: 'side, flank, aspect' },
  ],
  '働': [
    { w: '働く',     r: 'はたらく',     m: 'to work, to labor' },
    { w: '労働',     r: 'ろうどう',     m: 'labor, work, toil' },
    { w: '共働き',   r: 'ともばたらき', m: 'dual income (both spouses working)' },
  ],
  '優': [
    { w: '優しい',   r: 'やさしい',     m: 'kind, gentle, tender' },
    { w: '優秀',     r: 'ゆうしゅう',   m: 'excellent, outstanding' },
    { w: '俳優',     r: 'はいゆう',     m: 'actor, actress' },
  ],
  '全': [
    { w: '全体',     r: 'ぜんたい',     m: 'the whole, entirety' },
    { w: '安全',     r: 'あんぜん',     m: 'safety, security' },
    { w: '全員',     r: 'ぜんいん',     m: 'all members, everyone' },
  ],
  '共': [
    { w: '共に',     r: 'ともに',       m: 'together, with' },
    { w: '共通',     r: 'きょうつう',   m: 'common, shared' },
    { w: '共同',     r: 'きょうどう',   m: 'joint, cooperative, together' },
  ],
  '具': [
    { w: '道具',     r: 'どうぐ',       m: 'tool, instrument' },
    { w: '具体的',   r: 'ぐたいてき',   m: 'concrete, specific' },
    { w: '具合',     r: 'ぐあい',       m: 'condition, state, how one feels' },
  ],
  '列': [
    { w: '列車',     r: 'れっしゃ',     m: 'train' },
    { w: '行列',     r: 'ぎょうれつ',   m: 'queue, line, procession' },
    { w: '整列',     r: 'せいれつ',     m: 'standing in a row, lining up' },
  ],
  '刻': [
    { w: '時刻',     r: 'じこく',       m: 'time, hour' },
    { w: '深刻',     r: 'しんこく',     m: 'serious, grave' },
    { w: '刻む',     r: 'きざむ',       m: 'to carve, to chop finely' },
  ],
  '呼': [
    { w: '呼ぶ',     r: 'よぶ',         m: 'to call, to summon, to invite' },
    { w: '呼吸',     r: 'こきゅう',     m: 'breathing, respiration' },
    { w: '呼びかける', r: 'よびかける', m: 'to call out to, to appeal' },
  ],
  '喜': [
    { w: '喜ぶ',     r: 'よろこぶ',     m: 'to be happy, to be pleased' },
    { w: '喜び',     r: 'よろこび',     m: 'joy, happiness, delight' },
    { w: '喜劇',     r: 'きげき',       m: 'comedy, comic play' },
  ],
  '因': [
    { w: '原因',     r: 'げんいん',     m: 'cause, reason' },
    { w: '要因',     r: 'よういん',     m: 'main cause, key factor' },
    { w: '因果',     r: 'いんが',       m: 'cause and effect, karma' },
  ],
  '困': [
    { w: '困る',     r: 'こまる',       m: 'to be troubled, to be in difficulty' },
    { w: '困難',     r: 'こんなん',     m: 'difficulty, hardship' },
    { w: '困惑',     r: 'こんわく',     m: 'bewilderment, perplexity' },
  ],
  '変': [
    { w: '変わる',   r: 'かわる',       m: 'to change, to be different' },
    { w: '変化',     r: 'へんか',       m: 'change, transformation' },
    { w: '大変',     r: 'たいへん',     m: 'very; serious, difficult' },
  ],
  '太': [
    { w: '太陽',     r: 'たいよう',     m: 'the sun' },
    { w: '太い',     r: 'ふとい',       m: 'thick, fat, bold' },
    { w: '太平洋',   r: 'たいへいよう', m: 'Pacific Ocean' },
  ],
  '害': [
    { w: '害',       r: 'がい',         m: 'harm, damage, injury' },
    { w: '被害',     r: 'ひがい',       m: 'damage, injury, harm suffered' },
    { w: '障害',     r: 'しょうがい',   m: 'obstacle, disability, disorder' },
  ],
  '庭': [
    { w: '庭',       r: 'にわ',         m: 'garden, yard' },
    { w: '家庭',     r: 'かてい',       m: 'home, family, household' },
    { w: '庭園',     r: 'ていえん',     m: 'garden, park' },
  ],
  '形': [
    { w: '形',       r: 'かたち',       m: 'shape, form, figure' },
    { w: '形式',     r: 'けいしき',     m: 'format, form, formality' },
    { w: '人形',     r: 'にんぎょう',   m: 'doll, puppet' },
  ],
  '怒': [
    { w: '怒る',     r: 'おこる',       m: 'to get angry, to be furious' },
    { w: '怒り',     r: 'いかり',       m: 'anger, rage' },
    { w: '怒鳴る',   r: 'どなる',       m: 'to shout, to yell, to roar' },
  ],
  '愛': [
    { w: '愛',       r: 'あい',         m: 'love, affection' },
    { w: '愛する',   r: 'あいする',     m: 'to love' },
    { w: '恋愛',     r: 'れんあい',     m: 'romance, love' },
  ],
  '所': [
    { w: '場所',     r: 'ばしょ',       m: 'place, location, spot' },
    { w: '住所',     r: 'じゅうしょ',   m: 'address' },
    { w: '所',       r: 'ところ',       m: 'place, point, part' },
  ],
  '望': [
    { w: '希望',     r: 'きぼう',       m: 'hope, wish, aspiration' },
    { w: '望む',     r: 'のぞむ',       m: 'to hope for, to wish' },
    { w: '展望',     r: 'てんぼう',     m: 'prospect, outlook, view' },
  ],
  '由': [
    { w: '理由',     r: 'りゆう',       m: 'reason, cause' },
    { w: '自由',     r: 'じゆう',       m: 'freedom, liberty' },
    { w: '由来',     r: 'ゆらい',       m: 'origin, history' },
  ],
  '示': [
    { w: '指示',     r: 'しじ',         m: 'instructions, directions' },
    { w: '展示',     r: 'てんじ',       m: 'exhibition, display' },
    { w: '示す',     r: 'しめす',       m: 'to show, to indicate, to demonstrate' },
  ],
  '罪': [
    { w: '犯罪',     r: 'はんざい',     m: 'crime, offence' },
    { w: '罪',       r: 'つみ',         m: 'sin, crime, fault, guilt' },
    { w: '無罪',     r: 'むざい',       m: 'innocence, not guilty' },
  ],
  '若': [
    { w: '若い',     r: 'わかい',       m: 'young' },
    { w: '若者',     r: 'わかもの',     m: 'young person, youth' },
    { w: '若手',     r: 'わかて',       m: 'young talent, up-and-comer' },
  ],
  '誤': [
    { w: '誤解',     r: 'ごかい',       m: 'misunderstanding' },
    { w: '誤り',     r: 'あやまり',     m: 'error, mistake' },
    { w: '誤る',     r: 'あやまる',     m: 'to make a mistake, to err' },
  ],
  '迷': [
    { w: '迷う',     r: 'まよう',       m: 'to hesitate, to get lost, to wander' },
    { w: '迷惑',     r: 'めいわく',     m: 'trouble, nuisance, inconvenience' },
    { w: '迷子',     r: 'まいご',       m: 'lost child, person who is lost' },
  ],
  '過': [
    { w: '過去',     r: 'かこ',         m: 'the past' },
    { w: '過ごす',   r: 'すごす',       m: 'to spend time, to pass time' },
    { w: '通り過ぎる', r: 'とおりすぎる', m: 'to pass by, to go past' },
  ],
  '際': [
    { w: '実際',     r: 'じっさい',     m: 'in practice, actually, in reality' },
    { w: '国際',     r: 'こくさい',     m: 'international' },
    { w: '際',       r: 'きわ',         m: 'edge, verge, moment' },
  ],
  '難': [
    { w: '難しい',   r: 'むずかしい',   m: 'difficult, hard' },
    { w: '困難',     r: 'こんなん',     m: 'difficulty, hardship' },
    { w: '避難',     r: 'ひなん',       m: 'evacuation, taking shelter' },
  ],
  '面': [
    { w: '面白い',   r: 'おもしろい',   m: 'interesting, fun, amusing' },
    { w: '場面',     r: 'ばめん',       m: 'scene, situation' },
    { w: '面',       r: 'おもて',       m: 'face, surface, side' },
  ],
  '頂': [
    { w: '頂く',     r: 'いただく',     m: 'to receive (humble); to eat/drink (humble)' },
    { w: '山頂',     r: 'さんちょう',   m: 'mountain top, summit' },
    { w: '頂上',     r: 'ちょうじょう', m: 'top, summit, peak' },
  ],
  '飛': [
    { w: '飛ぶ',     r: 'とぶ',         m: 'to fly, to jump' },
    { w: '飛行機',   r: 'ひこうき',     m: 'airplane' },
    { w: '飛び込む', r: 'とびこむ',     m: 'to jump into, to dive into' },
  ],
  '馬': [
    { w: '馬',       r: 'うま',         m: 'horse' },
    { w: '馬力',     r: 'ばりき',       m: 'horsepower; energy, drive' },
    { w: '乗馬',     r: 'じょうば',     m: 'horseback riding' },
  ],
  '鳴': [
    { w: '鳴く',     r: 'なく',         m: 'to cry, to chirp, to bark (animals)' },
    { w: '鳴る',     r: 'なる',         m: 'to ring, to sound, to chime' },
    { w: '悲鳴',     r: 'ひめい',       m: 'shriek, scream' },
  ],

  // ── N3 wave 5 — final cleanup (末/込/活/参 API bad first examples) ──────────
  '末': [
    { w: '年末',     r: 'ねんまつ',     m: 'end of the year' },
    { w: '末',       r: 'すえ',         m: 'end, close, later part' },
    { w: '週末',     r: 'しゅうまつ',   m: 'weekend' },
  ],
  '込': [
    { w: '申し込む', r: 'もうしこむ',   m: 'to apply, to register, to request' },
    { w: '込む',     r: 'こむ',         m: 'to be crowded, to be packed' },
    { w: '盛り込む', r: 'もりこむ',     m: 'to incorporate, to include' },
  ],
  '活': [
    { w: '生活',     r: 'せいかつ',     m: 'life, living, livelihood' },
    { w: '活動',     r: 'かつどう',     m: 'activity, action' },
    { w: '活用',     r: 'かつよう',     m: 'practical use, utilization' },
  ],
  '参': [
    { w: '参加',     r: 'さんか',       m: 'participation, taking part' },
    { w: '参る',     r: 'まいる',       m: 'to go (humble); to be overwhelmed' },
    { w: '参考',     r: 'さんこう',     m: 'reference, consultation' },
  ],

  // ── N2 wave 1 — batch 1/4 (kanji 1-90) ───────────────────────────────────
  '久': [
    { w: '久しぶり', r: 'ひさしぶり',   m: 'long time no see, after a long time' },
    { w: '永久',     r: 'えいきゅう',   m: 'eternity, permanence' },
    { w: '久々',     r: 'ひさびさ',     m: 'after a long time, long-awaited' },
  ],
  '乾': [
    { w: '乾く',     r: 'かわく',       m: 'to dry, to become dry' },
    { w: '乾燥',     r: 'かんそう',     m: 'dryness, dehydration' },
    { w: '乾電池',   r: 'かんでんち',   m: 'dry cell battery' },
  ],
  '仏': [
    { w: '仏',       r: 'ほとけ',       m: 'Buddha, Buddhist image' },
    { w: '仏教',     r: 'ぶっきょう',   m: 'Buddhism' },
    { w: '大仏',     r: 'だいぶつ',     m: 'large statue of Buddha' },
  ],
  '令': [
    { w: '命令',     r: 'めいれい',     m: 'order, command, instruction' },
    { w: '法令',     r: 'ほうれい',     m: 'laws and ordinances, regulations' },
    { w: '令和',     r: 'れいわ',       m: 'Reiwa era (2019–)' },
  ],
  '伸': [
    { w: '伸びる',   r: 'のびる',       m: 'to grow, to stretch, to extend' },
    { w: '伸ばす',   r: 'のばす',       m: 'to stretch out, to lengthen' },
    { w: '背伸び',   r: 'せのび',       m: 'standing on tiptoe; stretching oneself' },
  ],
  '伺': [
    { w: '伺う',     r: 'うかがう',     m: 'to ask (humble); to visit (humble)' },
    { w: '伺い',     r: 'うかがい',     m: 'humble inquiry, question' },
    { w: '伺いを立てる', r: 'うかがいをたてる', m: 'to ask for instructions' },
  ],
  '低': [
    { w: '低い',     r: 'ひくい',       m: 'low, short' },
    { w: '低下',     r: 'ていか',       m: 'fall, drop, decline' },
    { w: '最低',     r: 'さいてい',     m: 'worst, minimum, at least' },
  ],
  '停': [
    { w: '停止',     r: 'ていし',       m: 'stop, halt, suspension' },
    { w: '停車',     r: 'ていしゃ',     m: 'stopping (a vehicle), stop' },
    { w: 'バス停',   r: 'バスてい',     m: 'bus stop' },
  ],
  '児': [
    { w: '児童',     r: 'じどう',       m: 'child, juvenile' },
    { w: '幼児',     r: 'ようじ',       m: 'infant, toddler, young child' },
    { w: '育児',     r: 'いくじ',       m: 'childcare, child-rearing' },
  ],
  '匹': [
    { w: '匹',       r: 'ひき',         m: 'unit for counting small animals' },
    { w: '一匹',     r: 'いっぴき',     m: 'one small animal' },
    { w: '匹敵',     r: 'ひってき',     m: 'to be a match for, to rival' },
  ],
  '印': [
    { w: '印象',     r: 'いんしょう',   m: 'impression' },
    { w: '目印',     r: 'めじるし',     m: 'mark, sign, landmark' },
    { w: '調印',     r: 'ちょういん',   m: 'signing (a treaty), signature' },
  ],
  '卵': [
    { w: '卵',       r: 'たまご',       m: 'egg' },
    { w: '卵焼き',   r: 'たまごやき',   m: 'Japanese rolled omelette' },
    { w: '産卵',     r: 'さんらん',     m: 'egg-laying, spawning' },
  ],
  '双': [
    { w: '双方',     r: 'そうほう',     m: 'both sides, both parties' },
    { w: '双子',     r: 'ふたご',       m: 'twins' },
    { w: '双眼鏡',   r: 'そうがんきょう', m: 'binoculars' },
  ],
  '召': [
    { w: '召す',     r: 'めす',         m: 'to call, to summon (honorific)' },
    { w: '召し上がる', r: 'めしあがる', m: 'to eat, to drink (honorific)' },
    { w: '召集',     r: 'しょうしゅう', m: 'convening, summoning' },
  ],
  '周': [
    { w: '周り',     r: 'まわり',       m: 'surroundings, around, vicinity' },
    { w: '一周',     r: 'いっしゅう',   m: 'one lap, one round, one revolution' },
    { w: '周辺',     r: 'しゅうへん',   m: 'surroundings, vicinity, neighborhood' },
  ],
  '咲': [
    { w: '咲く',     r: 'さく',         m: 'to bloom, to flower' },
    { w: '花が咲く', r: 'はながさく',   m: 'flowers bloom' },
    { w: '返り咲き', r: 'かえりざき',   m: 'comeback, return to prominence' },
  ],
  '喫': [
    { w: '喫茶店',   r: 'きっさてん',   m: 'coffee shop, café' },
    { w: '喫煙',     r: 'きつえん',     m: 'smoking (tobacco)' },
    { w: '満喫',     r: 'まんきつ',     m: 'to fully enjoy, to have one\'s fill of' },
  ],
  '団': [
    { w: '団体',     r: 'だんたい',     m: 'group, organization' },
    { w: '集団',     r: 'しゅうだん',   m: 'group, mass, collective' },
    { w: '団地',     r: 'だんち',       m: 'housing complex, housing estate' },
  ],
  '刺': [
    { w: '名刺',     r: 'めいし',       m: 'business card' },
    { w: '刺す',     r: 'さす',         m: 'to stab, to sting, to pierce' },
    { w: '刺激',     r: 'しげき',       m: 'stimulus, stimulation, excitement' },
  ],
  '劇': [
    { w: '劇場',     r: 'げきじょう',   m: 'theatre, playhouse' },
    { w: '演劇',     r: 'えんげき',     m: 'drama, theatrical performance' },
    { w: '劇的',     r: 'げきてき',     m: 'dramatic' },
  ],
  '効': [
    { w: '効果',     r: 'こうか',       m: 'effect, result, effectiveness' },
    { w: '有効',     r: 'ゆうこう',     m: 'valid, effective, useful' },
    { w: '効率',     r: 'こうりつ',     m: 'efficiency' },
  ],
  '坂': [
    { w: '坂',       r: 'さか',         m: 'slope, hill' },
    { w: '坂道',     r: 'さかみち',     m: 'sloping road, hill' },
    { w: '上り坂',   r: 'のぼりざか',   m: 'uphill slope, ascent' },
  ],
  '型': [
    { w: '型',       r: 'かた',         m: 'type, model, mold, pattern' },
    { w: '大型',     r: 'おおがた',     m: 'large size, large-scale' },
    { w: '血液型',   r: 'けつえきがた', m: 'blood type' },
  ],
  '塩': [
    { w: '塩',       r: 'しお',         m: 'salt' },
    { w: '塩分',     r: 'えんぶん',     m: 'salt content, saltiness' },
    { w: '食塩',     r: 'しょくえん',   m: 'table salt, edible salt' },
  ],
  '央': [
    { w: '中央',     r: 'ちゅうおう',   m: 'center, middle, central' },
    { w: '震央',     r: 'しんおう',     m: 'epicenter (of an earthquake)' },
    { w: '中央集権', r: 'ちゅうおうしゅうけん', m: 'centralization of power' },
  ],
  '姓': [
    { w: '姓名',     r: 'せいめい',     m: 'full name (surname and given name)' },
    { w: '姓',       r: 'せい',         m: 'surname, family name' },
    { w: '旧姓',     r: 'きゅうせい',   m: 'maiden name, former surname' },
  ],
  '専': [
    { w: '専門',     r: 'せんもん',     m: 'specialty, field of expertise' },
    { w: '専念',     r: 'せんねん',     m: 'devotion, concentration on' },
    { w: '専用',     r: 'せんよう',     m: 'exclusive use, dedicated' },
  ],
  '将': [
    { w: '将来',     r: 'しょうらい',   m: 'future, prospects' },
    { w: '将軍',     r: 'しょうぐん',   m: 'shogun, military commander' },
    { w: '大将',     r: 'たいしょう',   m: 'general, admiral; leader' },
  ],
  '導': [
    { w: '指導',     r: 'しどう',       m: 'guidance, coaching, instruction' },
    { w: '導く',     r: 'みちびく',     m: 'to lead, to guide' },
    { w: '誘導',     r: 'ゆうどう',     m: 'guidance, induction, leading' },
  ],
  '層': [
    { w: '地層',     r: 'ちそう',       m: 'stratum, geological layer' },
    { w: '階層',     r: 'かいそう',     m: 'class, stratum, hierarchy' },
    { w: '大気層',   r: 'たいきそう',   m: 'atmospheric layer' },
  ],
  '岩': [
    { w: '岩',       r: 'いわ',         m: 'rock, boulder' },
    { w: '岩山',     r: 'いわやま',     m: 'rocky mountain' },
    { w: '溶岩',     r: 'ようがん',     m: 'lava' },
  ],

  // ── N2 wave 2 — batch 2/4 (kanji 91-180) ─────────────────────────────────
  '巻': [
    { w: '巻く',     r: 'まく',         m: 'to wind, to roll, to wrap' },
    { w: '巻物',     r: 'まきもの',     m: 'scroll, makimono' },
    { w: '第一巻',   r: 'だいいっかん', m: 'volume one, first volume' },
  ],
  '布': [
    { w: '布',       r: 'ぬの',         m: 'cloth, fabric' },
    { w: '布団',     r: 'ふとん',       m: 'futon, Japanese bedding' },
    { w: '毛布',     r: 'もうふ',       m: 'blanket' },
  ],
  '希': [
    { w: '希望',     r: 'きぼう',       m: 'hope, wish, aspiration' },
    { w: '希少',     r: 'きしょう',     m: 'rare, scarce' },
    { w: '希薄',     r: 'きはく',       m: 'thin, dilute, sparse' },
  ],
  '帯': [
    { w: '帯',       r: 'おび',         m: 'sash, belt, obi' },
    { w: '地帯',     r: 'ちたい',       m: 'zone, area, belt' },
    { w: '携帯',     r: 'けいたい',     m: 'mobile phone; carrying' },
  ],
  '幅': [
    { w: '幅',       r: 'はば',         m: 'width, breadth' },
    { w: '大幅',     r: 'おおはば',     m: 'large-scale, significant, drastic' },
    { w: '幅広い',   r: 'はばひろい',   m: 'wide, broad, extensive' },
  ],
  '干': [
    { w: '干す',     r: 'ほす',         m: 'to dry (laundry, food, etc.)' },
    { w: '干渉',     r: 'かんしょう',   m: 'interference, intervention' },
    { w: '若干',     r: 'じゃっかん',   m: 'a few, some, a little' },
  ],
  '床': [
    { w: '床',       r: 'ゆか',         m: 'floor' },
    { w: '床屋',     r: 'とこや',       m: 'barbershop, barber' },
    { w: '寝床',     r: 'ねどこ',       m: 'bed, sleeping place' },
  ],
  '延': [
    { w: '延長',     r: 'えんちょう',   m: 'extension, prolongation' },
    { w: '延期',     r: 'えんき',       m: 'postponement, deferment' },
    { w: '延びる',   r: 'のびる',       m: 'to extend, to be postponed' },
  ],
  '弱': [
    { w: '弱い',     r: 'よわい',       m: 'weak, frail' },
    { w: '弱点',     r: 'じゃくてん',   m: 'weak point, weakness' },
    { w: '弱める',   r: 'よわめる',     m: 'to weaken, to reduce (power)' },
  ],
  '律': [
    { w: '規律',     r: 'きりつ',       m: 'discipline, order, rules' },
    { w: '法律',     r: 'ほうりつ',     m: 'law, act, statute' },
    { w: '一律',     r: 'いちりつ',     m: 'uniform, flat, across the board' },
  ],
  '憎': [
    { w: '憎む',     r: 'にくむ',       m: 'to hate, to detest' },
    { w: '憎しみ',   r: 'にくしみ',     m: 'hatred, animosity' },
    { w: '憎悪',     r: 'ぞうお',       m: 'hatred, abhorrence' },
  ],
  '戸': [
    { w: '戸',       r: 'と',           m: 'door, sliding door' },
    { w: '戸口',     r: 'とぐち',       m: 'doorway, entrance' },
    { w: '一戸建て', r: 'いっこだて',   m: 'detached house, single-family home' },
  ],
  '拾': [
    { w: '拾う',     r: 'ひろう',       m: 'to pick up, to find' },
    { w: '拾い物',   r: 'ひろいもの',   m: 'found article, lucky find' },
    { w: '収拾',     r: 'しゅうしゅう', m: 'collection, bringing under control' },
  ],
  '掃': [
    { w: '掃除',     r: 'そうじ',       m: 'cleaning, sweeping' },
    { w: '掃く',     r: 'はく',         m: 'to sweep, to brush' },
    { w: '大掃除',   r: 'おおそうじ',   m: 'spring cleaning, general cleaning' },
  ],
  '旧': [
    { w: '旧',       r: 'きゅう',       m: 'old, former, ex-' },
    { w: '旧来',     r: 'きゅうらい',   m: 'traditional, conventional' },
    { w: '復旧',     r: 'ふっきゅう',   m: 'restoration, recovery, repair' },
  ],
  '星': [
    { w: '星',       r: 'ほし',         m: 'star' },
    { w: '衛星',     r: 'えいせい',     m: 'satellite' },
    { w: '星座',     r: 'せいざ',       m: 'constellation' },
  ],
  '普': [
    { w: '普通',     r: 'ふつう',       m: 'ordinary, common, normal' },
    { w: '普及',     r: 'ふきゅう',     m: 'spread, diffusion, popularization' },
    { w: '普段',     r: 'ふだん',       m: 'usually, habitually, normally' },
  ],
  '暴': [
    { w: '暴力',     r: 'ぼうりょく',   m: 'violence, force' },
    { w: '暴れる',   r: 'あばれる',     m: 'to act violently, to rage, to rampage' },
    { w: '暴力団',   r: 'ぼうりょくだん', m: 'organized crime group, yakuza' },
  ],
  '板': [
    { w: '板',       r: 'いた',         m: 'board, plank, slab' },
    { w: '黒板',     r: 'こくばん',     m: 'blackboard' },
    { w: '掲示板',   r: 'けいじばん',   m: 'bulletin board, message board' },
  ],
  '林': [
    { w: '林',       r: 'はやし',       m: 'woods, forest, grove' },
    { w: '森林',     r: 'しんりん',     m: 'forest, woods' },
    { w: '竹林',     r: 'ちくりん',     m: 'bamboo grove' },
  ],
  '枯': [
    { w: '枯れる',   r: 'かれる',       m: 'to wither, to die (of plants)' },
    { w: '枯れ葉',   r: 'かれは',       m: 'dead leaf, fallen leaf' },
    { w: '枯渇',     r: 'こかつ',       m: 'drying up, exhaustion (of resources)' },
  ],
  '柔': [
    { w: '柔らかい', r: 'やわらかい',   m: 'soft, tender, flexible' },
    { w: '柔道',     r: 'じゅうどう',   m: 'martial art using throws and holds' },
    { w: '柔軟',     r: 'じゅうなん',   m: 'flexible, supple, adaptable' },
  ],
  '柱': [
    { w: '柱',       r: 'はしら',       m: 'pillar, column, post' },
    { w: '電柱',     r: 'でんちゅう',   m: 'utility pole, telegraph pole' },
    { w: '支柱',     r: 'しちゅう',     m: 'prop, support, pillar' },
  ],
  '栄': [
    { w: '栄える',   r: 'さかえる',     m: 'to prosper, to flourish, to thrive' },
    { w: '繁栄',     r: 'はんえい',     m: 'prosperity, thriving' },
    { w: '栄養',     r: 'えいよう',     m: 'nutrition, nourishment' },
  ],
  '根': [
    { w: '根',       r: 'ね',           m: 'root (of a plant, problem)' },
    { w: '根拠',     r: 'こんきょ',     m: 'basis, grounds, foundation' },
    { w: '根本',     r: 'こんぽん',     m: 'root, origin, foundation' },
  ],
  '棒': [
    { w: '棒',       r: 'ぼう',         m: 'stick, rod, bar' },
    { w: '鉄棒',     r: 'てつぼう',     m: 'iron bar; horizontal bar (gymnastics)' },
    { w: '棒読み',   r: 'ぼうよみ',     m: 'reading in a monotone' },
  ],
  '植': [
    { w: '植物',     r: 'しょくぶつ',   m: 'plant, vegetation' },
    { w: '植える',   r: 'うえる',       m: 'to plant, to grow, to instill' },
    { w: '植え込む', r: 'うえこむ',     m: 'to plant (in the ground)' },
  ],
  '極': [
    { w: '極端',     r: 'きょくたん',   m: 'extreme, extremity' },
    { w: '積極的',   r: 'せっきょくてき', m: 'positive, proactive, assertive' },
    { w: '北極',     r: 'ほっきょく',   m: 'the North Pole, Arctic' },
  ],
  '毒': [
    { w: '毒',       r: 'どく',         m: 'poison, toxin' },
    { w: '中毒',     r: 'ちゅうどく',   m: 'poisoning; addiction' },
    { w: '毒素',     r: 'どくそ',       m: 'toxin, toxic substance' },
  ],
  '沸': [
    { w: '沸く',     r: 'わく',         m: 'to boil, to bubble up' },
    { w: '沸かす',   r: 'わかす',       m: 'to boil (water), to heat' },
    { w: '沸騰',     r: 'ふっとう',     m: 'boiling, coming to a boil' },
  ],
  '波': [
    { w: '波',       r: 'なみ',         m: 'wave, ripple' },
    { w: '電波',     r: 'でんぱ',       m: 'radio wave, electromagnetic wave' },
    { w: '波長',     r: 'はちょう',     m: 'wavelength; compatibility' },
  ],
  '泥': [
    { w: '泥',       r: 'どろ',         m: 'mud, dirt' },
    { w: '泥棒',     r: 'どろぼう',     m: 'thief, burglar, robber' },
    { w: '泥沼',     r: 'どろぬま',     m: 'bog, quagmire; vicious cycle' },
  ],

  // ── N2 wave 3 — batch 3/4 (kanji 181-270) ─────────────────────────────────
  '涙': [
    { w: '涙',       r: 'なみだ',       m: 'tear, teardrop' },
    { w: '涙声',     r: 'なみだごえ',   m: 'tearful voice' },
    { w: '涙ぐむ',   r: 'なみだぐむ',   m: 'to be on the verge of tears' },
  ],
  '混': [
    { w: '混乱',     r: 'こんらん',     m: 'disorder, confusion, turmoil' },
    { w: '混む',     r: 'こむ',         m: 'to be crowded, to be packed' },
    { w: '混雑',     r: 'こんざつ',     m: 'congestion, crowding' },
  ],
  '濃': [
    { w: '濃い',     r: 'こい',         m: 'dark (color), strong (taste), thick (liquid)' },
    { w: '濃度',     r: 'のうど',       m: 'concentration, density' },
    { w: '濃厚',     r: 'のうこう',     m: 'rich, thick, strong-flavored' },
  ],
  '濯': [
    { w: '洗濯',     r: 'せんたく',     m: 'laundry, washing' },
    { w: '洗濯機',   r: 'せんたくき',   m: 'washing machine' },
    { w: '洗濯物',   r: 'せんたくもの', m: 'laundry, things to be washed' },
  ],
  '焼': [
    { w: '焼く',     r: 'やく',         m: 'to bake, to roast, to grill, to burn' },
    { w: '焼き肉',   r: 'やきにく',     m: 'grilled meat, yakiniku' },
    { w: '焼き物',   r: 'やきもの',     m: 'pottery, ceramics; grilled food' },
  ],
  '燥': [
    { w: '乾燥',     r: 'かんそう',     m: 'dryness, dehydration' },
    { w: '乾燥肌',   r: 'かんそうはだ', m: 'dry skin' },
    { w: '燥ぐ',     r: 'はしゃぐ',     m: 'to frolic, to make merry, to be excited' },
  ],
  '片': [
    { w: '片方',     r: 'かたほう',     m: 'one side, the other' },
    { w: '片側',     r: 'かたがわ',     m: 'one side' },
    { w: '欠片',     r: 'かけら',       m: 'fragment, shard, piece' },
  ],
  '玉': [
    { w: '玉',       r: 'たま',         m: 'ball, sphere, jewel' },
    { w: '玉ねぎ',   r: 'たまねぎ',     m: 'onion' },
    { w: '水玉',     r: 'みずたま',     m: 'water drop; polka dot' },
  ],
  '珍': [
    { w: '珍しい',   r: 'めずらしい',   m: 'rare, unusual, novel' },
    { w: '珍品',     r: 'ちんぴん',     m: 'rare article, curio' },
    { w: '珍事',     r: 'ちんじ',       m: 'unusual happening, strange event' },
  ],
  '甘': [
    { w: '甘い',     r: 'あまい',       m: 'sweet; lenient, naive' },
    { w: '甘える',   r: 'あまえる',     m: 'to depend on, to be indulged' },
    { w: '甘やかす', r: 'あまやかす',   m: 'to pamper, to spoil' },
  ],
  '畜': [
    { w: '家畜',     r: 'かちく',       m: 'domestic animals, livestock' },
    { w: '畜産',     r: 'ちくさん',     m: 'animal husbandry, livestock farming' },
    { w: '畜舎',     r: 'ちくしゃ',     m: 'barn, stable, livestock shed' },
  ],
  '皮': [
    { w: '皮',       r: 'かわ',         m: 'skin, peel, hide, rind' },
    { w: '皮膚',     r: 'ひふ',         m: 'skin (of the body)' },
    { w: '皮肉',     r: 'ひにく',       m: 'irony, sarcasm' },
  ],
  '皿': [
    { w: 'お皿',     r: 'おさら',       m: 'plate, dish' },
    { w: '灰皿',     r: 'はいざら',     m: 'ashtray' },
    { w: '受け皿',   r: 'うけざら',     m: 'saucer; receptacle, catch-all' },
  ],
  '硬': [
    { w: '硬い',     r: 'かたい',       m: 'hard, stiff, rigid' },
    { w: '硬貨',     r: 'こうか',       m: 'coin' },
    { w: '強硬',     r: 'きょうこう',   m: 'firm, resolute, uncompromising' },
  ],
  '移': [
    { w: '移動',     r: 'いどう',       m: 'movement, transfer, relocation' },
    { w: '移転',     r: 'いてん',       m: 'moving, transfer, relocation' },
    { w: '移る',     r: 'うつる',       m: 'to move, to transfer, to change' },
  ],
  '章': [
    { w: '章',       r: 'しょう',       m: 'chapter, section' },
    { w: '文章',     r: 'ぶんしょう',   m: 'sentence, text, writing' },
    { w: '印章',     r: 'いんしょう',   m: 'seal, stamp' },
  ],
  '符': [
    { w: '切符',     r: 'きっぷ',       m: 'ticket (train, bus, etc.)' },
    { w: '符号',     r: 'ふごう',       m: 'sign, symbol, code' },
    { w: '音符',     r: 'おんぷ',       m: 'musical note' },
  ],
  '管': [
    { w: '管理',     r: 'かんり',       m: 'management, administration, control' },
    { w: '管',       r: 'くだ',         m: 'pipe, tube' },
    { w: '血管',     r: 'けっかん',     m: 'blood vessel' },
  ],
  '簡': [
    { w: '簡単',     r: 'かんたん',     m: 'simple, easy, brief' },
    { w: '簡潔',     r: 'かんけつ',     m: 'concise, brief, succinct' },
    { w: '書簡',     r: 'しょかん',     m: 'letter, correspondence' },
  ],
  '紅': [
    { w: '紅葉',     r: 'こうよう',     m: 'autumn foliage, fall colors' },
    { w: '紅茶',     r: 'こうちゃ',     m: 'black tea' },
    { w: '紅白',     r: 'こうはく',     m: 'red and white' },
  ],
  '缶': [
    { w: '缶',       r: 'かん',         m: 'can, tin' },
    { w: '缶詰',     r: 'かんづめ',     m: 'canned food, canning' },
    { w: 'ドラム缶', r: 'どらむかん',   m: 'oil drum, barrel' },
  ],
  '羽': [
    { w: '羽',       r: 'はね',         m: 'feather, wing' },
    { w: '羽毛',     r: 'うもう',       m: 'feathers, plumage, down' },
    { w: '羽根',     r: 'はね',         m: 'feather, shuttlecock' },
  ],
  '肌': [
    { w: '肌',       r: 'はだ',         m: 'skin, complexion' },
    { w: '肌着',     r: 'はだぎ',       m: 'underwear, undershirt' },
    { w: '肌寒い',   r: 'はださむい',   m: 'chilly, slightly cold' },
  ],
  '肯': [
    { w: '肯定',     r: 'こうてい',     m: 'affirmation, approval, positive' },
    { w: '肯ける',   r: 'うなずける',   m: 'to be understandable, to make sense' },
    { w: '首肯',     r: 'しゅこう',     m: 'nodding assent, agreement' },
  ],
  '胃': [
    { w: '胃',       r: 'い',           m: 'stomach' },
    { w: '胃腸',     r: 'いちょう',     m: 'stomach and intestines' },
    { w: '胃薬',     r: 'いぐすり',     m: 'stomach medicine' },
  ],
  '滴': [
    { w: '点滴',     r: 'てんてき',     m: 'intravenous drip, IV' },
    { w: '水滴',     r: 'すいてき',     m: 'drop of water' },
    { w: '一滴',     r: 'いってき',     m: 'a drop (of liquid)' },
  ],

  // ── N2 wave 4 — batch 4/4 (kanji 271-367) ─────────────────────────────────
  '胸': [
    { w: '胸',       r: 'むね',         m: 'chest, breast' },
    { w: '胸焼け',   r: 'むねやけ',     m: 'heartburn' },
    { w: '度胸',     r: 'どきょう',     m: 'courage, guts' },
  ],
  '腰': [
    { w: '腰',       r: 'こし',         m: 'waist, hip, lower back' },
    { w: '腰痛',     r: 'ようつう',     m: 'lower back pain' },
    { w: '足腰',     r: 'あしこし',     m: 'legs and lower back' },
  ],
  '膚': [
    { w: '皮膚',     r: 'ひふ',         m: 'skin' },
    { w: '皮膚科',   r: 'ひふか',       m: 'dermatology, skin clinic' },
    { w: '皮膚炎',   r: 'ひふえん',     m: 'dermatitis, skin inflammation' },
  ],
  '舟': [
    { w: '舟',       r: 'ふね',         m: 'small boat' },
    { w: '小舟',     r: 'こぶね',       m: 'small boat, dinghy' },
    { w: '助け舟',   r: 'たすけぶね',   m: 'rescue boat; helping hand' },
  ],
  '豊': [
    { w: '豊か',     r: 'ゆたか',       m: 'rich, abundant, plentiful' },
    { w: '豊富',     r: 'ほうふ',       m: 'abundant, plentiful' },
    { w: '豊作',     r: 'ほうさく',     m: 'good harvest, bumper crop' },
  ],
  '芸': [
    { w: '芸術',     r: 'げいじゅつ',   m: 'art, fine arts' },
    { w: '芸能',     r: 'げいのう',     m: 'entertainment, performing arts' },
    { w: '文芸',     r: 'ぶんげい',     m: 'literature, literary arts' },
  ],
  '荒': [
    { w: '荒れる',   r: 'あれる',       m: 'to become rough, to be stormy, to be unsettled' },
    { w: '荒廃',     r: 'こうはい',     m: 'ruin, desolation, devastation' },
    { w: '荒野',     r: 'こうや',       m: 'wasteland, wilderness, wild field' },
  ],
  '菜': [
    { w: '野菜',     r: 'やさい',       m: 'vegetable, vegetables' },
    { w: '白菜',     r: 'はくさい',     m: 'Chinese cabbage' },
    { w: '菜食',     r: 'さいしょく',   m: 'vegetarian diet' },
  ],
  '蔵': [
    { w: '蔵',       r: 'くら',         m: 'warehouse, storehouse, cellar' },
    { w: '貯蔵',     r: 'ちょぞう',     m: 'storage, preservation' },
    { w: '冷蔵庫',   r: 'れいぞうこ',   m: 'refrigerator, fridge' },
  ],
  '袋': [
    { w: '袋',       r: 'ふくろ',       m: 'bag, sack, pouch' },
    { w: '手袋',     r: 'てぶくろ',     m: 'gloves' },
    { w: '紙袋',     r: 'かみぶくろ',   m: 'paper bag' },
  ],
  '装': [
    { w: '服装',     r: 'ふくそう',     m: 'dress, attire, clothing' },
    { w: '装置',     r: 'そうち',       m: 'device, apparatus, equipment' },
    { w: '装備',     r: 'そうび',       m: 'equipment, gear' },
  ],
  '裏': [
    { w: '裏',       r: 'うら',         m: 'back, reverse side, wrong side' },
    { w: '裏側',     r: 'うらがわ',     m: 'back side, reverse side, behind' },
    { w: '裏切り',   r: 'うらぎり',     m: 'betrayal, treachery' },
  ],
  '補': [
    { w: '補う',     r: 'おぎなう',     m: 'to supplement, to make up for' },
    { w: '補助',     r: 'ほじょ',       m: 'assistance, support, subsidy' },
    { w: '補充',     r: 'ほじゅう',     m: 'replenishment, supplementation' },
  ],
  '角': [
    { w: '角',       r: 'かど',         m: 'corner, edge, angle' },
    { w: '三角',     r: 'さんかく',     m: 'triangle' },
    { w: '角度',     r: 'かくど',       m: 'angle' },
  ],
  '貨': [
    { w: '通貨',     r: 'つうか',       m: 'currency' },
    { w: '貨物',     r: 'かもつ',       m: 'freight, cargo, goods' },
    { w: '百貨店',   r: 'ひゃっかてん', m: 'department store' },
  ],
  '貯': [
    { w: '貯金',     r: 'ちょきん',     m: 'savings, bank deposit' },
    { w: '貯蓄',     r: 'ちょちく',     m: 'savings, accumulation' },
    { w: '貯める',   r: 'ためる',       m: 'to save up, to store' },
  ],
  '賢': [
    { w: '賢い',     r: 'かしこい',     m: 'wise, intelligent, clever' },
    { w: '賢者',     r: 'けんじゃ',     m: 'wise person, sage' },
    { w: '悪賢い',   r: 'わるがしこい', m: 'cunning, crafty, sly' },
  ],
  '跡': [
    { w: '跡',       r: 'あと',         m: 'trace, mark, evidence, ruins' },
    { w: '遺跡',     r: 'いせき',       m: 'archaeological ruins, historic remains' },
    { w: '奇跡',     r: 'きせき',       m: 'miracle, wonder' },
  ],
  '軽': [
    { w: '軽い',     r: 'かるい',       m: 'light (weight), minor, easy' },
    { w: '軽傷',     r: 'けいしょう',   m: 'minor injury' },
    { w: '軽減',     r: 'けいげん',     m: 'reduction, mitigation' },
  ],
  '輸': [
    { w: '輸入',     r: 'ゆにゅう',     m: 'import' },
    { w: '輸出',     r: 'ゆしゅつ',     m: 'export' },
    { w: '輸送',     r: 'ゆそう',       m: 'transport, shipping' },
  ],
  '辺': [
    { w: '辺り',     r: 'あたり',       m: 'vicinity, neighborhood, around' },
    { w: '周辺',     r: 'しゅうへん',   m: 'surroundings, outskirts, vicinity' },
    { w: '近辺',     r: 'きんぺん',     m: 'neighborhood, nearby area' },
  ],
  '逆': [
    { w: '逆',       r: 'ぎゃく',       m: 'reverse, opposite, inverse' },
    { w: '逆転',     r: 'ぎゃくてん',   m: 'reversal, turnaround' },
    { w: '逆らう',   r: 'さからう',     m: 'to go against, to defy, to disobey' },
  ],
  '量': [
    { w: '量',       r: 'りょう',       m: 'quantity, amount, volume' },
    { w: '大量',     r: 'たいりょう',   m: 'large quantity, mass' },
    { w: '量る',     r: 'はかる',       m: 'to measure, to weigh' },
  ],
  '針': [
    { w: '針',       r: 'はり',         m: 'needle, pin, hook' },
    { w: '方針',     r: 'ほうしん',     m: 'policy, course, plan of action' },
    { w: '指針',     r: 'ししん',       m: 'guideline, guiding principle' },
  ],
  '鈍': [
    { w: '鈍い',     r: 'にぶい',       m: 'dull, slow, dim, blunt' },
    { w: '鈍化',     r: 'どんか',       m: 'becoming dull, slowing down' },
    { w: '鈍感',     r: 'どんかん',     m: 'insensitive, thick-skinned, obtuse' },
  ],
  '録': [
    { w: '記録',     r: 'きろく',       m: 'record, note, documentation' },
    { w: '録音',     r: 'ろくおん',     m: 'sound recording' },
    { w: '登録',     r: 'とうろく',     m: 'registration, enrollment' },
  ],
  '門': [
    { w: '門',       r: 'もん',         m: 'gate, entrance' },
    { w: '専門',     r: 'せんもん',     m: 'specialty, expertise, major' },
    { w: '部門',     r: 'ぶもん',       m: 'division, department, field' },
  ],
  '陸': [
    { w: '陸',       r: 'りく',         m: 'land, ground, shore' },
    { w: '大陸',     r: 'たいりく',     m: 'continent' },
    { w: '陸上',     r: 'りくじょう',   m: 'on land, land (transport, athletics)' },
  ],
  '階': [
    { w: '階段',     r: 'かいだん',     m: 'stairs, staircase, steps' },
    { w: '二階',     r: 'にかい',       m: 'second floor, upstairs' },
    { w: '段階',     r: 'だんかい',     m: 'stage, step, phase, level' },
  ],
  '雲': [
    { w: '雲',       r: 'くも',         m: 'cloud' },
    { w: '雲海',     r: 'うんかい',     m: 'sea of clouds' },
    { w: '暗雲',     r: 'あんうん',     m: 'dark clouds; ominous signs' },
  ],
  '革': [
    { w: '革命',     r: 'かくめい',     m: 'revolution' },
    { w: '改革',     r: 'かいかく',     m: 'reform, reformation' },
    { w: '革新',     r: 'かくしん',     m: 'innovation, reform, progressivism' },
  ],
  '預': [
    { w: '預金',     r: 'よきん',       m: 'bank deposit, savings' },
    { w: '預ける',   r: 'あずける',     m: 'to deposit, to entrust' },
    { w: '預かる',   r: 'あずかる',     m: 'to take custody of, to look after' },
  ],
  '香': [
    { w: '香り',     r: 'かおり',       m: 'fragrance, aroma, scent' },
    { w: '香水',     r: 'こうすい',     m: 'perfume' },
    { w: '香辛料',   r: 'こうしんりょう', m: 'spices, seasoning' },
  ],
  '骨': [
    { w: '骨',       r: 'ほね',         m: 'bone' },
    { w: '骨折',     r: 'こっせつ',     m: 'bone fracture, broken bone' },
    { w: '骨格',     r: 'こっかく',     m: 'skeleton, frame, physique' },
  ],
  '麦': [
    { w: '麦',       r: 'むぎ',         m: 'wheat, barley, oat' },
    { w: '小麦',     r: 'こむぎ',       m: 'wheat' },
    { w: '麦茶',     r: 'むぎちゃ',     m: 'barley tea' },
  ],
  '黄': [
    { w: '黄色',     r: 'きいろ',       m: 'yellow' },
    { w: '黄金',     r: 'こがね',       m: 'gold, golden' },
    { w: '卵黄',     r: 'らんおう',     m: 'egg yolk' },
  ],

  // ── N1 wave 1 — batch 1/4 (kanji 1-308) ───────────────────────────────────
  '丁': [
    { w: '丁寧',     r: 'ていねい',     m: 'polite, careful, thorough' },
    { w: '丁度',     r: 'ちょうど',     m: 'exactly, just, precisely' },
    { w: '丁目',     r: 'ちょうめ',     m: 'district block number (address)' },
  ],
  '且': [
    { w: 'なお且つ', r: 'なおかつ',     m: 'and yet, in addition, further' },
    { w: '且つ',     r: 'かつ',         m: 'besides, moreover, at the same time' },
    { w: '且て',     r: 'かつて',       m: 'once, ever, formerly' },
  ],
  '丘': [
    { w: '丘',       r: 'おか',         m: 'hill, knoll' },
    { w: '丘陵',     r: 'きゅうりょう', m: 'hill, hillock, rising ground' },
    { w: '砂丘',     r: 'さきゅう',     m: 'sand dune' },
  ],
  '丹': [
    { w: '丹念',     r: 'たんねん',     m: 'painstaking, careful, elaborate' },
    { w: '丹精',     r: 'たんせい',     m: 'taking great pains, working diligently' },
    { w: '牡丹',     r: 'ぼたん',       m: 'peony (flower)' },
  ],
  '乃': [
    { w: '乃至',     r: 'ないし',       m: 'or, up to, between' },
    { w: '乃ち',     r: 'すなわち',     m: 'that is, in other words' },
    { w: '乃父',     r: 'だいふ',       m: 'your father, my father' },
  ],
  '也': [
    { w: '也',       r: 'なり',         m: 'a sum of money (classical particle)' },
    { w: '可也',     r: 'かなり',       m: 'considerably, fairly, quite' },
    { w: '時は金也', r: 'ときはかねなり', m: 'time is money' },
  ],
  '亜': [
    { w: '亜細亜',   r: 'あじあ',       m: 'Asia' },
    { w: '亜熱帯',   r: 'あねったい',   m: 'subtropics' },
    { w: '亜種',     r: 'あしゅ',       m: 'subspecies' },
  ],
  '享': [
    { w: '享受',     r: 'きょうじゅ',   m: 'enjoyment, appreciation, reception' },
    { w: '享楽',     r: 'きょうらく',   m: 'enjoyment, pleasure' },
    { w: '享年',     r: 'きょうねん',   m: 'age at death' },
  ],
  '亭': [
    { w: '料亭',     r: 'りょうてい',   m: 'high-class Japanese restaurant' },
    { w: '亭主',     r: 'ていしゅ',     m: 'husband; host (at a tea ceremony)' },
    { w: '料亭',     r: 'りょうてい',   m: 'high-class Japanese restaurant' },
    { w: '亭',       r: 'ちん',         m: 'pavilion, kiosk' },
  ],
  '仁': [
    { w: '仁義',     r: 'じんぎ',       m: 'humanity and justice; moral code' },
    { w: '仁術',     r: 'じんじゅつ',   m: 'benevolent art (esp. medicine)' },
    { w: '仁愛',     r: 'じんあい',     m: 'benevolence, charity, love' },
  ],
  '仙': [
    { w: '仙人',     r: 'せんにん',     m: 'hermit, recluse, wizard' },
    { w: '仙台',     r: 'せんだい',     m: 'Sendai (city in Miyagi)' },
    { w: '水仙',     r: 'すいせん',     m: 'daffodil, narcissus' },
  ],
  '仮': [
    { w: '仮名',     r: 'かな',         m: 'kana (Japanese syllabary)' },
    { w: '仮説',     r: 'かせつ',       m: 'hypothesis, supposition' },
    { w: '仮定',     r: 'かてい',       m: 'assumption, supposition, premise' },
  ],
  '仰': [
    { w: '信仰',     r: 'しんこう',     m: 'faith, belief, religion' },
    { w: '仰ぐ',     r: 'あおぐ',       m: 'to look up at; to revere' },
    { w: '仰天',     r: 'ぎょうてん',   m: 'astonishment, being astounded' },
  ],
  '企': [
    { w: '企業',     r: 'きぎょう',     m: 'enterprise, business, company' },
    { w: '企画',     r: 'きかく',       m: 'plan, project, planning' },
    { w: '企て',     r: 'くわだて',     m: 'plan, scheme, attempt' },
  ],
  '伊': [
    { w: '伊達',     r: 'だて',         m: 'elegance, dandyism; vanity' },
    { w: '伊勢',     r: 'いせ',         m: 'Ise (region in Mie Prefecture)' },
    { w: '伊豆',     r: 'いず',         m: 'Izu (peninsula, islands)' },
  ],
  '伴': [
    { w: '伴奏',     r: 'ばんそう',     m: 'musical accompaniment' },
    { w: '同伴',     r: 'どうはん',     m: 'going together, accompanying' },
    { w: '伴う',     r: 'ともなう',     m: 'to accompany, to be accompanied by' },
  ],
  '催': [
    { w: '開催',     r: 'かいさい',     m: 'holding (an event), hosting' },
    { w: '主催',     r: 'しゅさい',     m: 'sponsoring, hosting, organizing' },
    { w: '催し',     r: 'もよおし',     m: 'event, gathering, function' },
  ],
  '債': [
    { w: '債券',     r: 'さいけん',     m: 'bond, debenture' },
    { w: '国債',     r: 'こくさい',     m: 'national bond, government bond' },
    { w: '債務',     r: 'さいむ',       m: 'debt, obligation, liability' },
  ],
  '傷': [
    { w: '傷',       r: 'きず',         m: 'wound, injury, scar' },
    { w: '傷つく',   r: 'きずつく',     m: 'to be wounded, to be hurt' },
    { w: '負傷',     r: 'ふしょう',     m: 'injury, wound' },
  ],
  '僚': [
    { w: '同僚',     r: 'どうりょう',   m: 'colleague, coworker' },
    { w: '閣僚',     r: 'かくりょう',   m: 'cabinet minister' },
    { w: '官僚',     r: 'かんりょう',   m: 'government official, bureaucrat' },
  ],
  '僧': [
    { w: '僧侶',     r: 'そうりょ',     m: 'Buddhist priest, monk' },
    { w: '僧院',     r: 'そういん',     m: 'monastery, convent' },
    { w: '高僧',     r: 'こうそう',     m: 'high priest, eminent monk' },
  ],
  '儒': [
    { w: '儒教',     r: 'じゅきょう',   m: 'Confucianism' },
    { w: '儒学',     r: 'じゅがく',     m: 'Confucian studies' },
    { w: '儒者',     r: 'じゅしゃ',     m: 'Confucian scholar' },
  ],
  '充': [
    { w: '充実',     r: 'じゅうじつ',   m: 'fulfillment, enrichment, completeness' },
    { w: '充電',     r: 'じゅうでん',   m: 'charging (a battery)' },
    { w: '補充',     r: 'ほじゅう',     m: 'replenishment, supplement' },
  ],
  '克': [
    { w: '克服',     r: 'こくふく',     m: 'overcoming, conquest (of a difficulty)' },
    { w: '克己',     r: 'こっき',       m: 'self-control, self-discipline' },
    { w: '克明',     r: 'こくめい',     m: 'detailed, precise, scrupulous' },
  ],
  '典': [
    { w: '古典',     r: 'こてん',       m: 'classic, classical literature' },
    { w: '式典',     r: 'しきてん',     m: 'ceremony, ritual, formal function' },
    { w: '辞典',     r: 'じてん',       m: 'dictionary' },
  ],
  '兼': [
    { w: '兼ねる',   r: 'かねる',       m: 'to serve dual purposes, to double as' },
    { w: '兼業',     r: 'けんぎょう',   m: 'side business, concurrent work' },
    { w: '兼任',     r: 'けんにん',     m: 'concurrent post, holding two positions' },
  ],
  '冒': [
    { w: '冒険',     r: 'ぼうけん',     m: 'adventure, risk, venture' },
    { w: '冒頭',     r: 'ぼうとう',     m: 'beginning, start, opening' },
    { w: '冒す',     r: 'おかす',       m: 'to brave, to risk, to challenge' },
  ],
  '冗': [
    { w: '冗談',     r: 'じょうだん',   m: 'joke, jest' },
    { w: '冗長',     r: 'じょうちょう', m: 'wordy, verbose, redundant' },
    { w: '冗費',     r: 'じょうひ',     m: 'waste, unnecessary expenditure' },
  ],
  '刀': [
    { w: '刀',       r: 'かたな',       m: 'sword, katana' },
    { w: '刀剣',     r: 'とうけん',     m: 'swords, bladed weapons' },
    { w: '日本刀',   r: 'にほんとう',   m: 'Japanese sword' },
  ],
  '刑': [
    { w: '死刑',     r: 'しけい',       m: 'death penalty, capital punishment' },
    { w: '刑事',     r: 'けいじ',       m: 'detective, criminal investigator' },
    { w: '刑罰',     r: 'けいばつ',     m: 'penalty, punishment' },
  ],
  '剖': [
    { w: '解剖',     r: 'かいぼう',     m: 'dissection, autopsy' },
    { w: '解剖学',   r: 'かいぼうがく', m: 'anatomy' },
    { w: '剖検',     r: 'ぼうけん',     m: 'autopsy, post-mortem examination' },
  ],
  '剣': [
    { w: '剣道',     r: 'けんどう',     m: 'kendo (Japanese fencing)' },
    { w: '剣士',     r: 'けんし',       m: 'swordsman, fencer' },
    { w: '真剣',     r: 'しんけん',     m: 'serious, earnest; real sword' },
  ],
  '剤': [
    { w: '洗剤',     r: 'せんざい',     m: 'detergent, cleanser' },
    { w: '薬剤',     r: 'やくざい',     m: 'medicine, pharmaceutical, drug' },
    { w: '消毒剤',   r: 'しょうどくざい', m: 'disinfectant' },
  ],
  '剰': [
    { w: '過剰',     r: 'かじょう',     m: 'excess, surplus, overabundance' },
    { w: '余剰',     r: 'よじょう',     m: 'surplus, excess' },
    { w: '剰余',     r: 'じょうよ',     m: 'remainder, surplus' },
  ],
  '励': [
    { w: '奨励',     r: 'しょうれい',   m: 'encouragement, promotion, incentive' },
    { w: '励む',     r: 'はげむ',       m: 'to strive, to work hard' },
    { w: '激励',     r: 'げきれい',     m: 'encouragement, cheering on' },
  ],
  '勅': [
    { w: '勅令',     r: 'ちょくれい',   m: 'imperial edict, imperial decree' },
    { w: '勅語',     r: 'ちょくご',     m: 'imperial message, imperial rescript' },
    { w: '勅命',     r: 'ちょくめい',   m: 'imperial command' },
  ],
  '勘': [
    { w: '勘定',     r: 'かんじょう',   m: 'bill, calculation, count' },
    { w: '勘違い',   r: 'かんちがい',   m: 'misunderstanding, misconception' },
    { w: '勘',       r: 'かん',         m: 'intuition, sense, perception' },
  ],
  '勧': [
    { w: '勧告',     r: 'かんこく',     m: 'advice, recommendation, counsel' },
    { w: '勧誘',     r: 'かんゆう',     m: 'invitation, solicitation' },
    { w: '勧める',   r: 'すすめる',     m: 'to recommend, to advise, to encourage' },
  ],
  '勲': [
    { w: '勲章',     r: 'くんしょう',   m: 'decoration, medal, order' },
    { w: '勲功',     r: 'くんこう',     m: 'meritorious deeds, distinguished service' },
    { w: '殊勲',     r: 'しゅくん',     m: 'distinguished service, special merit' },
  ],
  '匠': [
    { w: '師匠',     r: 'ししょう',     m: 'master, teacher, expert craftsman' },
    { w: '巨匠',     r: 'きょしょう',   m: 'great master, grandmaster' },
    { w: '意匠',     r: 'いしょう',     m: 'design, motif, artistic conception' },
  ],
  '匿': [
    { w: '匿名',     r: 'とくめい',     m: 'anonymity, using a pseudonym' },
    { w: '匿す',     r: 'かくす',       m: 'to hide, to conceal' },
    { w: '隠匿',     r: 'いんとく',     m: 'concealment, hiding' },
  ],
  '升': [
    { w: '升',       r: 'ます',         m: 'traditional Japanese unit of volume (~0.18L)' },
    { w: '一升',     r: 'いっしょう',   m: 'one shō (~1.8 liters)' },
    { w: '升目',     r: 'ますめ',       m: 'grid squares, ruled squares' },
  ],
  '卑': [
    { w: '卑しい',   r: 'いやしい',     m: 'humble, base, vulgar, greedy' },
    { w: '卑劣',     r: 'ひれつ',       m: 'mean, cowardly, despicable' },
    { w: '卑屈',     r: 'ひくつ',       m: 'servile, submissive, cringing' },
  ],
  '卓': [
    { w: '卓球',     r: 'たっきゅう',   m: 'table tennis, ping-pong' },
    { w: '食卓',     r: 'しょくたく',   m: 'dining table' },
    { w: '卓越',     r: 'たくえつ',     m: 'excellence, superiority' },
  ],
  '博': [
    { w: '博物館',   r: 'はくぶつかん', m: 'museum' },
    { w: '博士',     r: 'はかせ',       m: 'doctor (academic degree)' },
    { w: '博覧会',   r: 'はくらんかい', m: 'exhibition, fair, exposition' },
  ],
  '即': [
    { w: '即座',     r: 'そくざ',       m: 'immediate, prompt, on the spot' },
    { w: '即時',     r: 'そくじ',       m: 'immediate, prompt' },
    { w: '即興',     r: 'そっきょう',   m: 'improvisation, extemporization' },
  ],
  '厄': [
    { w: '厄介',     r: 'やっかい',     m: 'trouble, nuisance, burden' },
    { w: '厄年',     r: 'やくどし',     m: 'unlucky year, year of bad luck' },
    { w: '厄払い',   r: 'やくばらい',   m: 'warding off evil, purification' },
  ],
  '厳': [
    { w: '厳しい',   r: 'きびしい',     m: 'strict, harsh, severe' },
    { w: '厳重',     r: 'げんじゅう',   m: 'strict, tight, rigorous' },
    { w: '尊厳',     r: 'そんげん',     m: 'dignity, majesty, solemnity' },
  ],
  '及': [
    { w: '普及',     r: 'ふきゅう',     m: 'diffusion, spread, popularization' },
    { w: '及ぶ',     r: 'およぶ',       m: 'to reach, to amount to, to extend' },
    { w: '追及',     r: 'ついきゅう',   m: 'pursuit, investigation, questioning' },
  ],
  '叙': [
    { w: '叙情',     r: 'じょじょう',   m: 'lyricism, lyrical expression' },
    { w: '叙述',     r: 'じょじゅつ',   m: 'description, narration' },
    { w: '叙勲',     r: 'じょくん',     m: 'conferral of decoration' },
  ],
  '叡': [
    { w: '叡智',     r: 'えいち',       m: 'wisdom, intelligence, sagacity' },
    { w: '叡覧',     r: 'えいらん',     m: 'imperial inspection' },
    { w: '比叡山',   r: 'ひえいざん',   m: 'Mount Hiei (in Kyoto)' },
  ],
  '司': [
    { w: '司令',     r: 'しれい',       m: 'command, commandant' },
    { w: '司法',     r: 'しほう',       m: 'administration of justice, judicature' },
    { w: '司会',     r: 'しかい',       m: 'chairing, hosting, moderation' },
  ],
  '哲': [
    { w: '哲学',     r: 'てつがく',     m: 'philosophy' },
    { w: '哲学的',   r: 'てつがくてき', m: 'philosophical' },
    { w: '先哲',     r: 'せんてつ',     m: 'ancient sage, wise man of the past' },
  ],
  '唱': [
    { w: '合唱',     r: 'がっしょう',   m: 'chorus, choral singing' },
    { w: '提唱',     r: 'ていしょう',   m: 'advocacy, proposal' },
    { w: '斉唱',     r: 'せいしょう',   m: 'unison singing' },
  ],
  '嘆': [
    { w: '嘆く',     r: 'なげく',       m: 'to lament, to deplore, to grieve' },
    { w: '嘆願',     r: 'たんがん',     m: 'petition, entreaty, supplication' },
    { w: '感嘆',     r: 'かんたん',     m: 'admiration, exclamation' },
  ],
  '嘱': [
    { w: '嘱託',     r: 'しょくたく',   m: 'commission, entrust, part-time worker' },
    { w: '嘱望',     r: 'しょくぼう',   m: 'great hopes (for someone)' },
    { w: '委嘱',     r: 'いしょく',     m: 'commission, entrust' },
  ],
  '圏': [
    { w: '首都圏',   r: 'しゅとけん',   m: 'Greater Tokyo metropolitan area' },
    { w: '圏内',     r: 'けんない',     m: 'within a region or area' },
    { w: '北極圏',   r: 'ほっきょくけん', m: 'Arctic Circle' },
  ],
  '坑': [
    { w: '炭坑',     r: 'たんこう',     m: 'coal mine' },
    { w: '坑道',     r: 'こうどう',     m: 'tunnel, mine shaft' },
    { w: '落盤坑',   r: 'らくばんこう', m: 'collapsed mine shaft' },
  ],
  '壁': [
    { w: '壁',       r: 'かべ',         m: 'wall, barrier' },
    { w: '壁画',     r: 'へきが',       m: 'mural, wall painting, fresco' },
    { w: '岸壁',     r: 'がんぺき',     m: 'cliff, wharf, quay' },
  ],
  '壊': [
    { w: '壊れる',   r: 'こわれる',     m: 'to break, to be damaged, to collapse' },
    { w: '破壊',     r: 'はかい',       m: 'destruction, demolition, breaking' },
    { w: '崩壊',     r: 'ほうかい',     m: 'collapse, crumbling, breakdown' },
  ],
  '奇': [
    { w: '奇妙',     r: 'きみょう',     m: 'strange, odd, peculiar' },
    { w: '好奇心',   r: 'こうきしん',   m: 'curiosity' },
    { w: '奇跡',     r: 'きせき',       m: 'miracle, wonder' },
  ],
  '奉': [
    { w: '奉仕',     r: 'ほうし',       m: 'service, ministry, dedication' },
    { w: '奉公',     r: 'ほうこう',     m: 'service, serving a master' },
    { w: '信奉',     r: 'しんぽう',     m: 'belief, faith, adherence' },
  ],
  '奏': [
    { w: '演奏',     r: 'えんそう',     m: 'musical performance' },
    { w: '演奏会',   r: 'えんそうかい', m: 'concert, recital' },
    { w: '伴奏',     r: 'ばんそう',     m: 'musical accompaniment' },
  ],
  '契': [
    { w: '契約',     r: 'けいやく',     m: 'contract, agreement' },
    { w: '契約書',   r: 'けいやくしょ', m: 'written contract' },
    { w: '契機',     r: 'けいき',       m: 'opportunity, trigger, occasion' },
  ],
  '奨': [
    { w: '奨励',     r: 'しょうれい',   m: 'encouragement, promotion' },
    { w: '奨学金',   r: 'しょうがくきん', m: 'scholarship, student grant' },
    { w: '推奨',     r: 'すいしょう',   m: 'recommendation, endorsement' },
  ],
  '嫌': [
    { w: '嫌い',     r: 'きらい',       m: 'dislike, hate, aversion' },
    { w: '嫌悪',     r: 'けんお',       m: 'hatred, disgust, aversion' },
    { w: '嫌がる',   r: 'いやがる',     m: 'to show dislike, to be reluctant' },
  ],
  '嬢': [
    { w: '令嬢',     r: 'れいじょう',   m: "young lady, (someone's) daughter" },
    { w: 'お嬢さん', r: 'おじょうさん', m: "young lady, (another's) daughter" },
    { w: '嬢',       r: 'じょう',       m: 'Miss, young woman' },
  ],
  '孔': [
    { w: '孔子',     r: 'こうし',       m: 'Confucius' },
    { w: '瞳孔',     r: 'どうこう',     m: 'pupil (of the eye)' },
    { w: '孔雀',     r: 'くじゃく',     m: 'peacock' },
  ],
  '孤': [
    { w: '孤独',     r: 'こどく',       m: 'loneliness, isolation, solitude' },
    { w: '孤立',     r: 'こりつ',       m: 'isolation, being alone' },
    { w: '孤児',     r: 'こじ',         m: 'orphan' },
  ],
  '宙': [
    { w: '宇宙',     r: 'うちゅう',     m: 'universe, space, cosmos' },
    { w: '宇宙飛行士', r: 'うちゅうひこうし', m: 'astronaut' },
    { w: '宙返り',   r: 'ちゅうがえり', m: 'somersault, loop-the-loop' },
  ],
  '宣': [
    { w: '宣言',     r: 'せんげん',     m: 'declaration, proclamation' },
    { w: '宣伝',     r: 'せんでん',     m: 'publicity, propaganda, advertising' },
    { w: '宣告',     r: 'せんこく',     m: 'pronouncement, sentence, ruling' },
  ],
  '宮': [
    { w: '神宮',     r: 'じんぐう',     m: 'Shinto shrine (of high rank)' },
    { w: '宮殿',     r: 'きゅうでん',   m: 'palace' },
    { w: '宮内庁',   r: 'くないちょう', m: 'Imperial Household Agency' },
  ],
  '宴': [
    { w: '披露宴',   r: 'ひろうえん',   m: 'wedding reception' },
    { w: '宴会',     r: 'えんかい',     m: 'banquet, party, dinner' },
    { w: '宴',       r: 'うたげ',       m: 'feast, banquet, party' },
  ],
  '密': [
    { w: '秘密',     r: 'ひみつ',       m: 'secret, mystery' },
    { w: '密か',     r: 'ひそか',       m: 'secret, private, covert' },
    { w: '緊密',     r: 'きんみつ',     m: 'close, tight, intimate (relationship)' },
  ],
  '寛': [
    { w: '寛ぐ',     r: 'くつろぐ',     m: 'to relax, to unwind, to feel at home' },
    { w: '寛容',     r: 'かんよう',     m: 'tolerance, generosity, magnanimity' },
    { w: '寛大',     r: 'かんだい',     m: 'tolerant, generous, lenient' },
  ],
  '寧': [
    { w: '寧ろ',     r: 'むしろ',       m: 'rather, instead, preferably' },
    { w: '丁寧',     r: 'ていねい',     m: 'polite, careful, thorough' },
    { w: '安寧',     r: 'あんねい',     m: 'peace, tranquility, public order' },
  ],
  '審': [
    { w: '審査',     r: 'しんさ',       m: 'judging, examination, screening' },
    { w: '審議',     r: 'しんぎ',       m: 'deliberation, discussion' },
    { w: '審判',     r: 'しんぱん',     m: 'referee, umpire; judgment' },
  ],
  '寮': [
    { w: '寮',       r: 'りょう',       m: 'dormitory, residence hall' },
    { w: '寮生',     r: 'りょうせい',   m: 'dormitory student, boarder' },
    { w: '社員寮',   r: 'しゃいんりょう', m: 'company dormitory' },
  ],
  '寸': [
    { w: '寸前',     r: 'すんぜん',     m: 'on the verge of, just before' },
    { w: '寸法',     r: 'すんぽう',     m: 'measurement, dimensions, size' },
    { w: '一寸',     r: 'ちょっと',     m: 'a little, a moment, just a bit' },
  ],
  '射': [
    { w: '放射線',   r: 'ほうしゃせん', m: 'radiation' },
    { w: '注射',     r: 'ちゅうしゃ',   m: 'injection, shot' },
    { w: '射撃',     r: 'しゃげき',     m: 'shooting, gunfire' },
  ],
  '尺': [
    { w: '尺度',     r: 'しゃくど',     m: 'scale, measure, criterion' },
    { w: '巻き尺',   r: 'まきじゃく',   m: 'tape measure' },
    { w: '尺八',     r: 'しゃくはち',   m: 'shakuhachi (traditional bamboo flute)' },
  ],
  '展': [
    { w: '発展',     r: 'はってん',     m: 'development, growth, expansion' },
    { w: '展示',     r: 'てんじ',       m: 'exhibition, display' },
    { w: '進展',     r: 'しんてん',     m: 'progress, advance' },
  ],
  '属': [
    { w: '金属',     r: 'きんぞく',     m: 'metal' },
    { w: '所属',     r: 'しょぞく',     m: 'belonging to, affiliation' },
    { w: '専属',     r: 'せんぞく',     m: 'exclusive, belonging to one person' },
  ],
  '屈': [
    { w: '屈辱',     r: 'くつじょく',   m: 'disgrace, humiliation' },
    { w: '屈する',   r: 'くっする',     m: 'to yield, to give in, to submit' },
    { w: '理屈',     r: 'りくつ',       m: 'reason, logic, argument' },
  ],
  '岳': [
    { w: '山岳',     r: 'さんがく',     m: 'mountain, alpine' },
    { w: '岳',       r: 'たけ',         m: 'mountain peak' },
    { w: '富岳',     r: 'ふがく',       m: 'Mount Fuji' },
  ],
  '峠': [
    { w: '峠',       r: 'とうげ',       m: 'mountain pass' },
    { w: '峠道',     r: 'とうげみち',   m: 'road over a mountain pass' },
    { w: '峠越え',   r: 'とうげごえ',   m: 'crossing a mountain pass' },
  ],
  '峡': [
    { w: '海峡',     r: 'かいきょう',   m: 'strait, channel' },
    { w: '峡谷',     r: 'きょうこく',   m: 'gorge, canyon, ravine' },
    { w: '三峡',     r: 'さんきょう',   m: 'Three Gorges (of the Yangtze)' },
  ],
  '崇': [
    { w: '崇拝',     r: 'すうはい',     m: 'worship, adoration, reverence' },
    { w: '崇高',     r: 'すうこう',     m: 'sublime, lofty, noble' },
    { w: '崇敬',     r: 'すうけい',     m: 'reverence, deep respect' },
  ],
  '崩': [
    { w: '崩壊',     r: 'ほうかい',     m: 'collapse, crumbling, breakdown' },
    { w: '崩れる',   r: 'くずれる',     m: 'to crumble, to collapse, to break down' },
    { w: '崩す',     r: 'くずす',       m: 'to knock down, to break (into small change)' },
  ],
  '嵐': [
    { w: '嵐',       r: 'あらし',       m: 'storm, tempest' },
    { w: '嵐のような', r: 'あらしのような', m: 'stormy, tumultuous' },
    { w: '夜嵐',     r: 'よあらし',     m: 'night storm' },
  ],
  '巡': [
    { w: '巡回',     r: 'じゅんかい',   m: 'tour, patrol, going around' },
    { w: '巡査',     r: 'じゅんさ',     m: 'police officer, constable' },
    { w: '巡る',     r: 'めぐる',       m: 'to go around, to travel about, to tour' },
  ],
  '帆': [
    { w: '帆船',     r: 'はんせん',     m: 'sailing ship, sailboat' },
    { w: '帆',       r: 'ほ',           m: 'sail' },
    { w: '帆走',     r: 'はんそう',     m: 'sailing, navigating under sail' },
  ],
  '帝': [
    { w: '帝国',     r: 'ていこく',     m: 'empire' },
    { w: '帝王',     r: 'ていおう',     m: 'emperor, sovereign' },
    { w: '皇帝',     r: 'こうてい',     m: 'emperor' },
  ],
  '帳': [
    { w: '電話帳',   r: 'でんわちょう', m: 'phone book, telephone directory' },
    { w: 'メモ帳',   r: 'めもちょう',   m: 'notepad, memo book' },
    { w: '帳簿',     r: 'ちょうぼ',     m: 'account book, ledger' },
  ],
  '幕': [
    { w: '幕',       r: 'まく',         m: 'curtain, act (of a play)' },
    { w: '開幕',     r: 'かいまく',     m: 'raising the curtain, opening (of an event)' },
    { w: '幕府',     r: 'ばくふ',       m: 'shogunate, bakufu' },
  ],
  '幣': [
    { w: '紙幣',     r: 'しへい',       m: 'paper money, banknote' },
    { w: '貨幣',     r: 'かへい',       m: 'money, currency, coin' },
    { w: '造幣局',   r: 'ぞうへいきょく', m: 'mint (bureau)' },
  ],
};

// ── Kanji-level lookup built from the loaded pool (available after buildPool()) ─
// Returns a Map<char, jlptNum> (5=N5 easiest … 1=N1 hardest).
function getCharLevelMap() {
  if (!state.POOL.length) return new Map();
  // state.POOL contains duplicates for weighting — deduplicate by keeping first occurrence
  const map = new Map();
  for (const { char, jlptNum } of state.POOL) {
    if (!map.has(char)) map.set(char, jlptNum);
  }
  return map;
}

// Returns true if every kanji in `written` is at or below the given JLPT level.
// jlptNum 5=N5 (easiest), 1=N1 (hardest).
// Unknown kanji (not in pool) are treated as too advanced.
function isWordLevelOk(written, targetJlptNum, charLevelMap) {
  for (const ch of written) {
    const cp = ch.codePointAt(0);
    // CJK Unified Ideographs main block + Extension A
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) {
      const lvl = charLevelMap.get(ch);
      if (lvl === undefined || lvl < targetJlptNum) return false;
    }
  }
  return true;
}

// ── Best display meaning for a kanji ─────────────────────────────────────
// Priority: KANJI_MEANING_OVERRIDE[lang] → kanji_index[char][lang] → EN override → sortGlosses
function bestKanjiMeaning(char, apiMeanings, lang = 'en', indexEntry = null) {
  const ov = KANJI_MEANING_OVERRIDE[char];
  // Curated multilingual override
  if (ov) {
    // New format: { en: [...], fr: [...], ... }
    if (ov[lang]) return ov[lang].join(', ');
    // EN fallback inside new format
    if (ov.en)  return ov.en.join(', ');
  }
  // Non-EN: use kanji_index translated field (already includes FR/ES/DE/RU)
  if (lang !== 'en' && indexEntry?.[lang]) {
    const terms = indexEntry[lang].split(',').map(t => t.trim()).filter(Boolean).slice(0, 3);
    if (terms.length) return terms.join(', ');
  }
  // EN default: sortGlosses on API data
  return sortGlosses(apiMeanings ?? ['?']).slice(0, 4).join(', ');
}

// ── Extract best example words from API response ─────────────────────────
// Scoring: prefer short common words that are level-appropriate.
// Pass jlptNum (5=N5 … 1=N1) to restrict to vocab of that level or easier.
export function bestExamples(words, targetChar, max = 3, jlptNum = null) {
  if (EXAMPLE_OVERRIDE[targetChar]) return EXAMPLE_OVERRIDE[targetChar].slice(0, max);
  const candidates   = [];
  const seenMeanings = new Set();
  const charLevelMap = jlptNum ? getCharLevelMap() : null;

  for (const entry of words) {
    // Pick the best variant: prefer one with non-empty priorities (= standard reading)
    const variants = (entry.variants ?? []).filter(v => v.written && v.written.includes(targetChar));
    if (!variants.length) continue;
    const variant = variants.find(v => v.priorities && v.priorities.length > 0) ?? variants[0];
    if (ARCHAIC_WORDS.has(variant.written)) continue;

    // Find best gloss: skip glosses that start with a language/qualifier prefix
    let gloss = null;
    for (const meaning of (entry.meanings ?? [])) {
      for (const g of (meaning.glosses ?? [])) {
        if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g)) { gloss = g; break; }
      }
      if (gloss) break;
    }
    // Fallback: accept rare content but skip language prefixes
    if (!gloss) {
      for (const meaning of (entry.meanings ?? [])) {
        for (const g of (meaning.glosses ?? [])) {
          if (!GLOSS_SKIP_RE.test(g)) { gloss = g; break; }
        }
        if (gloss) break;
      }
    }
    if (!gloss) gloss = entry.meanings?.[0]?.glosses?.[0];
    if (!gloss || gloss.length < 5) continue;

    const normGloss = normalizeMeaning(gloss);
    if (seenMeanings.has(normGloss)) continue;
    seenMeanings.add(normGloss);

    const wordLen    = variant.written.length;
    const isRare     = GLOSS_RARE_RE.test(gloss);
    const hasPrefix  = GLOSS_SKIP_RE.test(gloss);
    // Frequency rank: lower = more common.
    // If not in subtitle corpus, fall back to API's news-frequency rank (nfXX)
    // so words like 七月 (nf01) rank far above obscure unlisted terms.
    const priorities = variant.priorities ?? [];
    let freqRank = FREQ[variant.written];
    if (freqRank == null) {
      const nfMatch = priorities.map(p => p.match(/^nf(\d+)$/)).find(Boolean);
      if (nfMatch)                                               freqRank = 5000 + parseInt(nfMatch[1]) * 100;
      else if (priorities.some(p => p === 'ichi1' || p === 'spec1')) freqRank = 5000;
      else                                                       freqRank = 99999;
    }
    // Score: low = appears first.
    // Heavy penalty for words that contain kanji harder than the target JLPT level.
    const levelPenalty = (charLevelMap && !isWordLevelOk(variant.written, jlptNum, charLevelMap))
      ? 100000
      : 0;
    const score      = (freqRank / 100) + (isRare ? 20 : 0) + (hasPrefix ? 10 : 0) + (wordLen > 4 ? wordLen : 0) + levelPenalty;

    candidates.push({
      w: variant.written,
      hasPriority: !!(variant.priorities && variant.priorities.length > 0),
      r: READING_OVERRIDE[variant.written] ?? (() => {
        const raw = variant.pronounced ?? '';
        if (!raw || raw === variant.written) return '';
        // Convert katakana to hiragana (e.g. ムダ→むだ)
        return raw.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
      })(),
      m: gloss.length > 42 ? gloss.slice(0, 40) + '…' : gloss,
      score,
    });
  }

  // Sort by score, then deduplicate by written form — prefer variant with priorities
  const seen = new Map();
  candidates.sort((a, b) => a.score - b.score).forEach(c => {
    if (!seen.has(c.w) || (!seen.get(c.w).hasPriority && c.hasPriority)) seen.set(c.w, c);
  });
  return [...seen.values()].slice(0, max).map(({ w, r, m }) => ({ w, r, m }));
}

// ── Kanji save / unsave ─────────────────────────────────────────────────────
function getSavedKanjiMap() {
  try { return new Map(JSON.parse(localStorage.getItem('saved_kanjis') || '[]')); }
  catch { return new Map(); }
}
export function getAllSavedKanjis() {
  return [...getSavedKanjiMap().values()]
    .sort((a, b) => b.savedDate.localeCompare(a.savedDate));
}
export function isKanjiSaved(char) {
  return getSavedKanjiMap().has(char);
}
function persistKanjiMap(map) {
  localStorage.setItem('saved_kanjis', JSON.stringify([...map.entries()]));
}
export function toggleSaveKanji(k) {
  const map = getSavedKanjiMap();
  if (map.has(k.kanji)) {
    map.delete(k.kanji);
  } else {
    map.set(k.kanji, {
      kanji: k.kanji, level: k.level, meaning: k.meaning,
      savedDate: new Date().toISOString().slice(0, 10),
    });
  }
  persistKanjiMap(map);
}
export function removeKanjiFromSaved(char) {
  const map = getSavedKanjiMap();
  map.delete(char);
  persistKanjiMap(map);
}

export function removeSelectedKanjis(chars) {
  if (!chars.length) return;
  const map = getSavedKanjiMap();
  chars.forEach(c => map.delete(c));
  persistKanjiMap(map);
}

// ── Kanji level filter ────────────────────────────────────────────────────
export function applyKanjiLevelFilterUI() {
  document.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.level === state.kanjiLevelFilter);
  });
}
export function setKanjiLevel(level) {
  if (state.kanjiLevelFilter === level) return;
  state.kanjiLevelFilter = level;
  localStorage.setItem('kanjiLevelFilter', level);
  if (CLOUD_ENABLED && state._fbUser) cloudUpdate({ kanjiLevel: level });
  applyKanjiLevelFilterUI();
  state.currentKanjiCards = [];
  loadAndRender(state.count, true);
}

// ── Skeleton loaders ──────────────────────────────────────────────────────
export function showSkeletons(n) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton';
    s.style.animationDelay = `${i * 60}ms`;
    s.innerHTML = `
      <div class="skel-big"></div>
      <div style="flex:1">
        <div class="skel-line" style="width:50%"></div>
        <div class="skel-line" style="width:80%"></div>
        <div class="skel-line" style="width:65%"></div>
      </div>`;
    grid.appendChild(s);
  }
}

// ── Card renderer ─────────────────────────────────────────────────────────
export function renderCard(k, delay) {
  const on     = k.on.length  ? k.on.join('　')  : '—';
  const kun    = k.kun.length ? k.kun.join('　') : '—';
  const exHtml = k.ex.length
    ? k.ex.map(e => `
        <div class="example">
          <div class="ex-top">
            <span class="ex-word">${e.w}</span>
            ${e.r ? `<span class="ex-reading">【${e.r}】</span>` : ''}
          </div>
          <div class="ex-meaning">${getMeaning(e.w, getLang()) || e.m}</div>
        </div>`).join('')
    : '<div class="example"><div class="ex-meaning">No examples available.</div></div>';

  const saved     = isKanjiSaved(k.kanji);
  const card      = document.createElement('div');
  card.className  = 'card';
  card.style.animationDelay = `${delay}ms`;
  card.dataset.search = [k.kanji, k.meaning, ...k.on, ...k.kun, ...k.ex.map(e => `${e.w} ${e.r}`)].join(' ').toLowerCase();

  // Build save button as a proper DOM element so the listener is 100% reliable
  const saveBtn = document.createElement('button');
  saveBtn.className = 'kanji-save-btn' + (saved ? ' saved' : '');
  saveBtn.title     = saved ? 'Saved to My List' : 'Save to My List';
  saveBtn.textContent = saved ? '★' : '☆';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSaveKanji(k);
    const nowSaved = isKanjiSaved(k.kanji);
    saveBtn.textContent = nowSaved ? '★' : '☆';
    saveBtn.classList.toggle('saved', nowSaved);
    saveBtn.title = nowSaved ? 'Saved to My List' : 'Save to My List';
  });
  card.appendChild(saveBtn);

  // Speak button
  const speakBtn = document.createElement('button');
  speakBtn.className = 'speak-btn kanji-speak-btn';
  speakBtn.title     = 'Prononcer';
  speakBtn.textContent = '🔊';
  speakBtn.addEventListener('click', (e) => { e.stopPropagation(); speakJapanese(k.kanji); });
  card.appendChild(speakBtn);

  card.insertAdjacentHTML('beforeend', `
    <div class="card-body">
      <div class="card-top">
        <div class="kanji-char">${k.kanji}</div>
        <div class="card-info">
          <span class="badge badge-${k.level}">${k.level}</span>
          <div class="card-meaning">${k.meaning || getMeaning(k.kanji, getLang()) || k.ex.reduce((a, e) => a || getMeaning(e.w, getLang()), null)}</div>
        </div>
      </div>
      <div class="readings">
        <div class="reading-group">
          <span class="reading-label">音読み (On)</span>
          <span class="reading-kana">${on}</span>
        </div>
        <div class="reading-group">
          <span class="reading-label">訓読み (Kun)</span>
          <span class="reading-kana">${kun}</span>
        </div>
      </div>
      <div class="examples-label">Examples</div>
      ${exHtml}
    </div>`);

  return card;
}

// ── Load kanji data without touching the DOM (used by From Kanji mode) ──
export async function ensureKanjiCards() {
  if (state.currentKanjiCards.length > 0) return state.currentKanjiCards;
  if (!state.POOL.length) await buildPool();
  const _idx = await getKanjiSearchIndex();
  const lang  = getLang();
  const picks   = pickChars(state.count);
  const results = await Promise.allSettled(
    picks.map(async ({ char, jlptNum }) => {
      const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
      return {
        kanji:   char,
        level:   LEVEL_LABEL[jlptNum],
        on:      detail.on_readings  ?? [],
        kun:     detail.kun_readings ?? [],
        meaning: bestKanjiMeaning(char, detail.meanings, lang, _idx[char]),
        ex:      bestExamples(words, char, 3, jlptNum),
      };
    })
  );
  const cards = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  state.currentKanjiCards = cards;
  return cards;
}

// ── Main kanji loader ─────────────────────────────────────────────────────
// forceNew = true  →  pick a fresh random set (ignores cache)
export async function loadAndRender(n, forceNew = false) {
  // Serve from cache on simple tab switch
  if (!forceNew && state.currentKanjiCards.length > 0) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    state.currentKanjiCards.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
    document.getElementById('countLabel').textContent = state.currentKanjiCards.length;
    const unique = new Set(state.POOL.map(p => p.char)).size;
    setStatus('ok', `${unique.toLocaleString()} kanji in database · N3 & N2 favoured`);
    return;
  }

  showSkeletons(n);
  setStatus('loading', '読み込み中…');
  document.getElementById('countLabel').textContent = n;

  try {
    if (!state.POOL.length) await buildPool();
    if (state.currentTab !== 'kanji') return; // tab changed while loading

    const _idx = await getKanjiSearchIndex();
    const lang  = getLang();
    const picks   = pickChars(n);
    const results = await Promise.allSettled(
      picks.map(async ({ char, jlptNum }) => {
        const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
        return {
          kanji:   char,
          level:   LEVEL_LABEL[jlptNum],
          on:      detail.on_readings  ?? [],
          kun:     detail.kun_readings ?? [],
          meaning: bestKanjiMeaning(char, detail.meanings, lang, _idx[char]),
          ex:      bestExamples(words, char, 3, jlptNum),
        };
      })
    );

    if (state.currentTab !== 'kanji') return; // tab changed while loading

    const cards = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    state.currentKanjiCards = cards;
    const grid  = document.getElementById('grid');
    grid.innerHTML = '';
    cards.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
    document.getElementById('countLabel').textContent = cards.length;

    const unique = new Set(state.POOL.map(p => p.char)).size;
    setStatus('ok', `${unique.toLocaleString()} kanji in database · N3 & N2 favoured`);

  } catch (err) {
    setStatus('error', 'Failed to load — check your internet connection.');
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;color:var(--red);padding:24px;font-weight:600">${err.message}</div>`;
  }
}

// ── Kanji search index (loaded once from public/kanji_index.json) ─────────────
let _kanjiSearchIndex = null; // Map<char, {m, o, k}>

async function getKanjiSearchIndex() {
  if (_kanjiSearchIndex) return _kanjiSearchIndex;
  try {
    const res = await fetch('/kanji_index.json');
    if (!res.ok) throw new Error('index not found');
    const raw = await res.json();
    _kanjiSearchIndex = raw;
  } catch {
    _kanjiSearchIndex = {};
  }
  return _kanjiSearchIndex;
}

// ── Full-pool kanji search ────────────────────────────────────────────────
export async function searchAndRenderKanji(query) {
  const grid = document.getElementById('grid');
  const q    = (query || '').trim();

  if (!q) {
    grid.innerHTML = '';
    state.currentKanjiCards.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
    const noRes = document.getElementById('searchNoResults');
    if (noRes) noRes.style.display = 'none';
    return;
  }

  const ql = q.toLowerCase();

  // 1. Filter among already-loaded cards (fast, in-memory)
  let matching = state.currentKanjiCards.filter(k => {
    const s = [k.kanji, k.meaning, ...k.on, ...k.kun, ...k.ex.map(e => `${e.w} ${e.r}`)].join(' ').toLowerCase();
    return s.includes(ql);
  });

  // 2. If not found in current cards, search the full index
  if (!matching.length) {
    if (!state.POOL.length) await buildPool();
    const index = await getKanjiSearchIndex();

    // Single kanji character: exact lookup
    const isSingleKanji = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/.test(q);
    if (isSingleKanji) {
      const inPool = state.POOL.find(p => p.char === q);
      if (inPool) {
        try {
          const [detail, words] = await Promise.all([getKanjiDetail(inPool.char), getWords(inPool.char)]);
          const _idx = _kanjiSearchIndex ?? {};
          matching = [{
            kanji:   inPool.char,
            level:   LEVEL_LABEL[inPool.jlptNum],
            on:      detail.on_readings  ?? [],
            kun:     detail.kun_readings ?? [],
            meaning: bestKanjiMeaning(inPool.char, detail.meanings, lang, _idx[inPool.char]),
            ex:      bestExamples(words, inPool.char, 3, inPool.jlptNum),
          }];
        } catch { /* leave empty */ }
      }
    } else {
      // Text query (meaning/reading): search index for all pool chars
      const lang = getLang();
      const uniqueChars = [...new Set(state.POOL.map(p => p.char))];
      const hits = uniqueChars.filter(char => {
        const entry = index[char];
        if (!entry) return false;
        const s = [char, entry.m, entry[lang] || '', ...(entry.o || []), ...(entry.k || [])].join(' ').toLowerCase();
        return s.includes(ql);
      });

      if (hits.length) {
        // Fetch full details for matching chars (up to 20)
        const toFetch = hits.slice(0, 20);
        const poolMap = Object.fromEntries(state.POOL.map(p => [p.char, p]));
        const results = await Promise.allSettled(
          toFetch.map(async char => {
            const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
            const pool = poolMap[char] || { jlptNum: 1 };
            return {
              kanji:   char,
              level:   LEVEL_LABEL[pool.jlptNum],
              on:      detail.on_readings  ?? [],
              kun:     detail.kun_readings ?? [],
              meaning: bestKanjiMeaning(char, detail.meanings, lang, index[char]),
              ex:      bestExamples(words, char, 3, pool.jlptNum),
            };
          })
        );
        matching = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      }
    }
  }

  grid.innerHTML = '';
  const noRes = document.getElementById('searchNoResults');
  if (!matching.length) {
    if (noRes) { noRes.textContent = t('search_no_results'); noRes.style.display = ''; }
  } else {
    if (noRes) noRes.style.display = 'none';
    matching.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
  }
}
