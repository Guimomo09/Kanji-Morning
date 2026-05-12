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
    { w: '部屋',   r: 'へや',       m: 'room' },
    { w: '寝室',   r: 'しんしつ',   m: 'bedroom' },
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
    { w: '努力',   r: 'どりょく',   m: 'effort, hard work' },
  ],
  '交': [
    { w: '交流',   r: 'こうりゅう', m: 'exchange, interaction' },
    { w: '交差点', r: 'こうさてん', m: 'intersection, crossroads' },
    { w: '外交',   r: 'がいこう',   m: 'diplomacy, foreign affairs' },
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
          <div class="card-meaning">${getMeaning(k.kanji, getLang()) || k.ex.reduce((a, e) => a || getMeaning(e.w, getLang()), null) || k.meaning}</div>
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
