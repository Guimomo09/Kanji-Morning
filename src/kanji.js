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
  '国': [
    { w: '国',     r: 'くに',       m: 'country, nation' },
    { w: '外国',   r: 'がいこく',   m: 'foreign country' },
    { w: '中国',   r: 'ちゅうごく', m: 'China' },
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
    { w: '花火',   r: 'はなび',     m: 'fireworks' },
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

  // ── N1 wave 2 — batch 2/4 (kanji 309-616) ───

  '幽': [
    { w: '幽霊',   r: 'ゆうれい',   m: 'ghost, specter' },
    { w: '幽玄',   r: 'ゆうげん',   m: 'subtle grace, deep mystery (aesthetic concept)' },
    { w: '幽閉',   r: 'ゆうへい',   m: 'confinement, imprisonment' },
  ],
  '弾': [
    { w: '弾く',   r: 'ひく',       m: 'to play (piano, guitar, etc.)' },
    { w: '爆弾',   r: 'ばくだん',   m: 'bomb, explosive device' },
    { w: '弾丸',   r: 'だんがん',   m: 'bullet, shell' },
  ],
  '微': [
    { w: '微妙',   r: 'びみょう',   m: 'subtle, delicate, nuanced' },
    { w: '微笑む', r: 'ほほえむ',   m: 'to smile gently' },
    { w: '微細',   r: 'びさい',     m: 'minute, tiny, fine' },
  ],
  '慈': [
    { w: '慈善',   r: 'じぜん',     m: 'charity, philanthropy' },
    { w: '慈悲',   r: 'じひ',       m: 'mercy, compassion' },
    { w: '慈しむ', r: 'いつくしむ', m: 'to love tenderly, to cherish' },
  ],
  '愚': [
    { w: '愚か',   r: 'おろか',     m: 'foolish, stupid' },
    { w: '愚痴',   r: 'ぐち',       m: 'grumbling, complaining' },
    { w: '愚直',   r: 'ぐちょく',   m: 'honest to a fault, overly sincere' },
  ],
  '慶': [
    { w: '慶び',   r: 'よろこび',   m: 'joy, delight' },
    { w: '慶祝',   r: 'けいしゅく', m: 'celebration, congratulation' },
    { w: '慶応',   r: 'けいおう',   m: 'Keio era (1865-1868) / Keio University' },
  ],
  '懐': [
    { w: '懐かしい', r: 'なつかしい', m: 'nostalgic, fondly remembered' },
    { w: '懐',       r: 'ふところ',   m: 'breast pocket, one\'s bosom' },
    { w: '懐中',     r: 'かいちゅう', m: 'in one\'s pocket, portable' },
  ],
  '戯': [
    { w: '戯れる', r: 'たわむれる', m: 'to play, to jest, to frolic' },
    { w: '遊戯',   r: 'ゆうぎ',     m: 'play, game, amusement' },
    { w: '悪戯',   r: 'いたずら',   m: 'prank, mischief, naughtiness' },
  ],
  '扇': [
    { w: '扇形',   r: 'おうぎがた', m: 'fan shape, sector' },
    { w: '扇風機', r: 'せんぷうき', m: 'electric fan' },
    { w: '扇ぐ',   r: 'あおぐ',     m: 'to fan, to fan oneself' },
  ],
  '抗': [
    { w: '抗議',   r: 'こうぎ',     m: 'protest, objection' },
    { w: '対抗',   r: 'たいこう',   m: 'opposition, rivalry' },
    { w: '抵抗',   r: 'ていこう',   m: 'resistance, opposition' },
  ],
  '括': [
    { w: '括弧',   r: 'かっこ',     m: 'parentheses, brackets' },
    { w: '包括',   r: 'ほうかつ',   m: 'inclusion, comprehensive coverage' },
    { w: '一括',   r: 'いっかつ',   m: 'lump-sum, all at once, batch' },
  ],
  '排': [
    { w: '排除',   r: 'はいじょ',   m: 'exclusion, removal' },
    { w: '排気',   r: 'はいき',     m: 'exhaust, ventilation' },
    { w: '排水',   r: 'はいすい',   m: 'drainage, draining' },
  ],
  '撲': [
    { w: '打撲',     r: 'だぼく',     m: 'blow, bruising strike' },
    { w: '撲滅',     r: 'ぼくめつ',   m: 'eradication, stamping out' },
    { w: '打撲傷',   r: 'だぼくしょう', m: 'bruise, contusion' },
  ],
  '操': [
    { w: '操縦',   r: 'そうじゅう', m: 'piloting, operating (aircraft, vehicle)' },
    { w: '体操',   r: 'たいそう',   m: 'gymnastics, calisthenics' },
    { w: '操作',   r: 'そうさ',     m: 'operation, handling, manipulation' },
  ],
  '故': [
    { w: '故郷',   r: 'こきょう',   m: 'hometown, birthplace' },
    { w: '事故',   r: 'じこ',       m: 'accident, incident' },
    { w: '故障',   r: 'こしょう',   m: 'breakdown, malfunction, failure' },
  ],
  '敢': [
    { w: '果敢',   r: 'かかん',     m: 'bold, daring, resolute' },
    { w: '勇敢',   r: 'ゆうかん',   m: 'brave, courageous' },
    { w: '敢えて', r: 'あえて',     m: 'deliberately, purposely, daringly' },
  ],
  '敦': [
    { w: '敦厚',   r: 'とんこう',   m: 'sincere and kindhearted' },
    { w: '敦睦',   r: 'とんぼく',   m: 'cordial friendship' },
    { w: '敦い',   r: 'あつい',     m: 'kind, sincere, warm-hearted' },
  ],
  '旗': [
    { w: '旗',     r: 'はた',       m: 'flag, banner' },
    { w: '国旗',   r: 'こっき',     m: 'national flag' },
    { w: '旗手',   r: 'きしゅ',     m: 'standard-bearer, flag bearer' },
  ],
  '既': [
    { w: '既に',   r: 'すでに',     m: 'already, by now' },
    { w: '既成',   r: 'きせい',     m: 'established, ready-made' },
    { w: '既存',   r: 'きそん',     m: 'existing, pre-existing' },
  ],
  '条': [
    { w: '条件',   r: 'じょうけん', m: 'condition, requirement, terms' },
    { w: '条約',   r: 'じょうやく', m: 'treaty, pact' },
    { w: '条文',   r: 'じょうぶん', m: 'text of a law, clause, article' },
  ],
  '松': [
    { w: '松',     r: 'まつ',       m: 'pine tree' },
    { w: '松並木', r: 'まつなみき', m: 'row of pine trees' },
    { w: '松葉',   r: 'まつば',     m: 'pine needle' },
  ],
  '柄': [
    { w: '柄',     r: 'がら',       m: 'pattern, design (on fabric, etc.)' },
    { w: '人柄',   r: 'ひとがら',   m: 'character, personality, nature' },
    { w: '大柄',   r: 'おおがら',   m: 'large build, large pattern' },
  ],
  '案': [
    { w: '案',     r: 'あん',       m: 'idea, plan, proposal' },
    { w: '提案',   r: 'ていあん',   m: 'proposal, suggestion' },
    { w: '法案',   r: 'ほうあん',   m: 'bill (legislation)' },
  ],
  '暖': [
    { w: '暖かい', r: 'あたたかい', m: 'warm, mild (weather, feeling)' },
    { w: '暖房',   r: 'だんぼう',   m: 'heating, indoor heater' },
    { w: '温暖',   r: 'おんだん',   m: 'warm, mild (climate)' },
  ],
  '椋': [
    { w: '椋鳥',   r: 'むくどり',   m: 'grey starling, white-cheeked starling (bird)' },
    { w: '星椋鳥', r: 'ほしむくどり', m: 'common starling, European starling' },
    { w: '椋',     r: 'むく',       m: 'Aphananthe aspera (type of elm tree)' },
  ],
  '槽': [
    { w: '水槽',   r: 'すいそう',   m: 'fish tank, water tank' },
    { w: '浴槽',   r: 'よくそう',   m: 'bathtub' },
    { w: '貯水槽', r: 'ちょすいそう', m: 'water reservoir, cistern' },
  ],
  '模': [
    { w: '模様',   r: 'もよう',     m: 'pattern, design, appearance' },
    { w: '模倣',   r: 'もほう',     m: 'imitation, mimicry' },
    { w: '模型',   r: 'もけい',     m: 'model, scale model, mock-up' },
  ],
  '樹': [
    { w: '樹木',   r: 'じゅもく',   m: 'trees, timber, woody plants' },
    { w: '樹立',   r: 'じゅりつ',   m: 'establishment, setting up' },
    { w: '樹脂',   r: 'じゅし',     m: 'resin, rosin' },
  ],
  '欺': [
    { w: '詐欺',   r: 'さぎ',       m: 'fraud, swindle, scam' },
    { w: '欺く',   r: 'あざむく',   m: 'to deceive, to trick, to delude' },
    { w: '欺瞞',   r: 'ぎまん',     m: 'deception, trickery, duplicity' },
  ],
  '殖': [
    { w: '増殖',   r: 'ぞうしょく', m: 'multiplication, proliferation' },
    { w: '繁殖',   r: 'はんしょく', m: 'breeding, propagation, multiplication' },
    { w: '殖産',   r: 'しょくさん', m: 'increase in production, industrial development' },
  ],
  '沖': [
    { w: '沖',     r: 'おき',       m: 'open sea, offshore, out at sea' },
    { w: '沖合',   r: 'おきあい',   m: 'offshore, off the coast' },
    { w: '沖縄',   r: 'おきなわ',   m: 'Okinawa (prefecture)' },
  ],
  '江': [
    { w: '江',     r: 'え',         m: 'inlet, creek, bay' },
    { w: '江戸',   r: 'えど',       m: 'Edo (old name for Tokyo)' },
    { w: '江戸時代', r: 'えどじだい', m: 'Edo period (1603-1868)' },
  ],
  '沼': [
    { w: '沼',     r: 'ぬま',       m: 'marsh, swamp, bog' },
    { w: '沼地',   r: 'ぬまち',     m: 'swampy land, marshy ground' },
    { w: '泥沼',   r: 'どろぬま',   m: 'quagmire, bog; inextricable situation' },
  ],
  '是': [
    { w: '是非',   r: 'ぜひ',       m: 'certainly, by all means; right and wrong' },
    { w: '是正',   r: 'ぜせい',     m: 'correction, remedy, rectification' },
    { w: '是認',   r: 'ぜにん',     m: 'approval, recognition, acknowledgment' },
  ],
  '洪': [
    { w: '洪水',   r: 'こうずい',   m: 'flood, inundation' },
    { w: '洪大',   r: 'こうだい',   m: 'vast, immense' },
    { w: '洪積',   r: 'こうせき',   m: 'diluvial, relating to great flood deposits' },
  ],

  // ── N1 wave 3 — batch 3/4 (kanji 617-924) ───
  '浜': [
    { w: '浜辺',   r: 'はまべ',     m: 'beach, seashore' },
    { w: '砂浜',   r: 'すなはま',   m: 'sandy beach' },
    { w: '浜松',   r: 'はままつ',   m: 'Hamamatsu (city in Shizuoka Prefecture)' },
  ],
  '淑': [
    { w: '淑女',   r: 'しゅくじょ', m: 'refined, gracious lady' },
    { w: '淑やか', r: 'しとやか',   m: 'graceful, demure, refined' },
    { w: '淑徳',   r: 'しゅくとく', m: 'feminine virtues, moral excellence' },
  ],
  '漆': [
    { w: '漆器',   r: 'しっき',     m: 'lacquerware' },
    { w: '漆塗り', r: 'うるしぬり', m: 'lacquering, lacquered finish' },
    { w: '漆黒',   r: 'しっこく',   m: 'jet black, deep black' },
  ],
  '爵': [
    { w: '伯爵',   r: 'はくしゃく', m: 'count, earl' },
    { w: '公爵',   r: 'こうしゃく', m: 'duke' },
    { w: '男爵',   r: 'だんしゃく', m: 'baron' },
  ],
  '狂': [
    { w: '熱狂',   r: 'ねっきょう', m: 'frenzy, wild enthusiasm' },
    { w: '狂気',   r: 'きょうき',   m: 'madness, insanity' },
    { w: '狂う',   r: 'くるう',     m: 'to go mad, to go wrong, to be off' },
  ],
  '猿': [
    { w: '猿知恵', r: 'さるぢえ',   m: 'shallow cleverness, superficial wisdom' },
    { w: '猿人',   r: 'えんじん',   m: 'ape-man, early hominid' },
    { w: '類人猿', r: 'るいじんえん', m: 'anthropoid ape, great ape' },
  ],
  '玄': [
    { w: '玄関',   r: 'げんかん',   m: 'entrance, front door, entryway' },
    { w: '玄米',   r: 'げんまい',   m: 'unpolished brown rice' },
    { w: '玄人',   r: 'くろうと',   m: 'expert, professional, skilled person' },
  ],
  '珠': [
    { w: '真珠',   r: 'しんじゅ',   m: 'pearl' },
    { w: '数珠',   r: 'じゅず',     m: 'Buddhist prayer beads' },
    { w: '珠玉',   r: 'しゅぎょく', m: 'gems and jewels; choice, precious' },
  ],
  '盆': [
    { w: 'お盆',   r: 'おぼん',     m: 'Obon (Buddhist festival of the dead)' },
    { w: '盆栽',   r: 'ぼんさい',   m: 'bonsai' },
    { w: '盆地',   r: 'ぼんち',     m: 'basin, valley surrounded by mountains' },
  ],
  '甚': [
    { w: '甚大',   r: 'じんだい',   m: 'enormous, very great, immense' },
    { w: '甚だ',   r: 'はなはだ',   m: 'very, exceedingly, greatly' },
    { w: '幸甚',   r: 'こうじん',   m: 'very fortunate, highly appreciated' },
  ],
  '睡': [
    { w: '睡眠',   r: 'すいみん',   m: 'sleep' },
    { w: '熟睡',   r: 'じゅくすい', m: 'deep sleep, sound sleep' },
    { w: '睡眠不足', r: 'すいみんぶそく', m: 'sleep deprivation, lack of sleep' },
  ],
  '矛': [
    { w: '矛',     r: 'ほこ',       m: 'spear, halberd' },
    { w: '矛盾',   r: 'むじゅん',   m: 'contradiction, inconsistency' },
    { w: '矛先',   r: 'ほこさき',   m: 'spearhead; brunt (of an attack or criticism)' },
  ],
  '稚': [
    { w: '幼稚',   r: 'ようち',     m: 'childishness, infancy, immaturity' },
    { w: '幼稚園', r: 'ようちえん', m: 'kindergarten, preschool' },
    { w: '稚拙',   r: 'ちせつ',     m: 'unskillful, naive, childlike' },
  ],
  '稼': [
    { w: '稼ぐ',   r: 'かせぐ',     m: 'to earn (money), to work hard' },
    { w: '稼ぎ',   r: 'かせぎ',     m: 'earnings, income' },
    { w: '出稼ぎ', r: 'でかせぎ',   m: 'working away from home, migrant work' },
  ],
  '筋': [
    { w: '筋肉',   r: 'きんにく',   m: 'muscle' },
    { w: '筋道',   r: 'すじみち',   m: 'logic, reasoning, line of argument' },
    { w: '筋書き', r: 'すじがき',   m: 'plot, scenario, storyline' },
  ],
  '粋': [
    { w: '純粋',   r: 'じゅんすい', m: 'pure, genuine, unalloyed' },
    { w: '粋',     r: 'いき',       m: 'stylish, refined, chic' },
    { w: '生粋',   r: 'きっすい',   m: 'pure, genuine, thoroughbred' },
  ],
  '紫': [
    { w: '紫',     r: 'むらさき',   m: 'purple, violet' },
    { w: '紫外線', r: 'しがいせん', m: 'ultraviolet rays' },
    { w: '紫色',   r: 'むらさきいろ', m: 'purple color' },
  ],
  '綱': [
    { w: '綱領',   r: 'こうりょう', m: 'party platform, fundamental principles' },
    { w: '要綱',   r: 'ようこう',   m: 'main principle, outline, summary' },
    { w: '大綱',   r: 'たいこう',   m: 'fundamental principles, general outline' },
  ],
  '綺': [
    { w: '綺麗',   r: 'きれい',     m: 'beautiful, clean, lovely' },
    { w: '綺麗事', r: 'きれいごと', m: 'sugarcoating, whitewashing' },
    { w: '綺羅びやか', r: 'きらびやか', m: 'gorgeous, glittering, resplendent' },
  ],
  '縁': [
    { w: '縁',     r: 'えん',       m: 'fate, connection, bond, relationship' },
    { w: '縁談',   r: 'えんだん',   m: 'marriage proposal, matchmaking talk' },
    { w: '縁側',   r: 'えんがわ',   m: 'veranda, porch (Japanese style)' },
  ],
  '羅': [
    { w: '羅列',   r: 'られつ',     m: 'enumeration, listing one by one' },
    { w: '網羅',   r: 'もうら',     m: 'comprehensive coverage, covering everything' },
    { w: '森羅万象', r: 'しんらばんしょう', m: 'all things in nature, the universe' },
  ],
  '肢': [
    { w: '選択肢', r: 'せんたくし', m: 'option, choice (in a selection)' },
    { w: '肢体',   r: 'したい',     m: 'limbs, limbs and body' },
    { w: '四肢',   r: 'しし',       m: 'four limbs, arms and legs' },
  ],
  '胎': [
    { w: '胎児',   r: 'たいじ',     m: 'fetus, unborn child' },
    { w: '受胎',   r: 'じゅたい',   m: 'conception, becoming pregnant' },
    { w: '母胎',   r: 'ぼたい',     m: 'mother\'s womb; origin, birthplace' },
  ],
  '胡': [
    { w: '胡椒',   r: 'こしょう',   m: 'pepper (spice)' },
    { w: '胡坐',   r: 'あぐら',     m: 'sitting cross-legged (Indian style)' },
    { w: '胡散臭い', r: 'うさんくさい', m: 'suspicious, shady, dubious' },
  ],
  '脚': [
    { w: '脚本',   r: 'きゃくほん', m: 'script, screenplay' },
    { w: '脚注',   r: 'きゃくちゅう', m: 'footnote' },
    { w: '脚光',   r: 'きゃっこう', m: 'footlights; limelight, public attention' },
  ],
  '至': [
    { w: '至る',   r: 'いたる',     m: 'to reach, to arrive at, to lead to' },
    { w: '至急',   r: 'しきゅう',   m: 'urgent, pressing, as soon as possible' },
    { w: '冬至',   r: 'とうじ',     m: 'winter solstice' },
  ],
  '艶': [
    { w: '艶やか', r: 'つやか',     m: 'glossy, lustrous, charming' },
    { w: '艶消し', r: 'つやけし',   m: 'matte finish; dampening (enthusiasm)' },
    { w: '艶出し', r: 'つやだし',   m: 'polishing, giving a gloss' },
  ],

  // ── N1 wave 4 — batch 4/4 (kanji 925-1232) ───
  '芽': [
    { w: '芽',     r: 'め',         m: 'bud, sprout, shoot' },
    { w: '新芽',   r: 'しんめ',     m: 'new bud, fresh sprout' },
    { w: '芽生え', r: 'めばえ',     m: 'budding, first sign, germination' },
  ],
  '荘': [
    { w: '別荘',   r: 'べっそう',   m: 'vacation home, holiday house' },
    { w: '荘厳',   r: 'そうごん',   m: 'solemn, majestic, awe-inspiring' },
    { w: '山荘',   r: 'さんそう',   m: 'mountain villa, mountain lodge' },
  ],
  '葵': [
    { w: '葵',     r: 'あおい',     m: 'hollyhock; aoi (family crest of the Tokugawa)' },
    { w: '葵祭',   r: 'あおいまつり', m: 'Aoi Festival (held in Kyoto in May)' },
    { w: '立葵',   r: 'たちあおい', m: 'hollyhock (Alcea rosea)' },
  ],
  '藻': [
    { w: '藻',     r: 'も',         m: 'algae, seaweed, aquatic plant' },
    { w: '海藻',   r: 'かいそう',   m: 'seaweed, marine algae' },
    { w: '藻掻く', r: 'もがく',     m: 'to struggle, to writhe, to flounder' },
  ],
  '詐': [
    { w: '詐欺',   r: 'さぎ',       m: 'fraud, swindle, con' },
    { w: '詐欺師', r: 'さぎし',     m: 'swindler, con artist, fraudster' },
    { w: '詐称',   r: 'さしょう',   m: 'misrepresentation, false claim' },
  ],
  '請': [
    { w: '要請',   r: 'ようせい',   m: 'request, demand, call for' },
    { w: '申請',   r: 'しんせい',   m: 'application, petition, request' },
    { w: '請求',   r: 'せいきゅう', m: 'bill, invoice, claim' },
  ],
  '賀': [
    { w: '賀状',   r: 'がじょう',   m: 'New Year\'s card, congratulatory letter' },
    { w: '祝賀',   r: 'しゅくが',   m: 'celebration, congratulations' },
    { w: '年賀',   r: 'ねんが',     m: 'New Year\'s greeting' },
  ],
  '賊': [
    { w: '海賊',   r: 'かいぞく',   m: 'pirate, buccaneer' },
    { w: '盗賊',   r: 'とうぞく',   m: 'thief, robber, bandit' },
    { w: '賊軍',   r: 'ぞくぐん',   m: 'rebel army, insurgent forces' },
  ],
  '辰': [
    { w: '辰年',   r: 'たつどし',   m: 'Year of the Dragon' },
    { w: '辰砂',   r: 'しんしゃ',   m: 'cinnabar (mineral); vermilion pigment' },
    { w: '辰刻',   r: 'しんこく',   m: 'hour of the dragon (approx. 7-9 AM)' },
  ],
  '逸': [
    { w: '逸話',   r: 'いつわ',     m: 'anecdote, episode, little-known story' },
    { w: '秀逸',   r: 'しゅういつ', m: 'excellent, outstanding, brilliant' },
    { w: '逸脱',   r: 'いつだつ',   m: 'deviation, departure, digression' },
  ],
  '那': [
    { w: '刹那',   r: 'せつな',     m: 'moment, instant, split second' },
    { w: '旦那',   r: 'だんな',     m: 'husband, master, patron' },
    { w: '那覇',   r: 'なは',       m: 'Naha (capital of Okinawa Prefecture)' },
  ],
  '郎': [
    { w: '新郎',   r: 'しんろう',   m: 'bridegroom, groom' },
    { w: '郎党',   r: 'ろうとう',   m: 'followers, retainers, henchmen' },
    { w: '野郎',   r: 'やろう',     m: 'fellow, guy, rascal' },
  ],
  '郭': [
    { w: '輪郭',   r: 'りんかく',   m: 'outline, contour, silhouette' },
    { w: '外郭',   r: 'がいかく',   m: 'outer wall; periphery, outer boundary' },
    { w: '城郭',   r: 'じょうかく', m: 'castle and its walls, fortified castle' },
  ],
  '醜': [
    { w: '醜い',   r: 'みにくい',   m: 'ugly, unsightly, repulsive' },
    { w: '醜態',   r: 'しゅうたい', m: 'disgraceful behavior, shameful conduct' },
    { w: '醜悪',   r: 'しゅうあく', m: 'ugly, repulsive, heinous' },
  ],
  '錠': [
    { w: '錠前',   r: 'じょうまえ', m: 'lock, padlock' },
    { w: '錠剤',   r: 'じょうざい', m: 'pill, tablet, lozenge' },
    { w: '手錠',   r: 'てじょう',   m: 'handcuffs, manacles' },
  ],
  '雄': [
    { w: '英雄',   r: 'えいゆう',   m: 'hero, great man, champion' },
    { w: '雄大',   r: 'ゆうだい',   m: 'grand, majestic, magnificent' },
    { w: '雄弁',   r: 'ゆうべん',   m: 'eloquence, powerful oratory' },
  ],
  '鮎': [
    { w: '鮎',     r: 'あゆ',       m: 'ayu sweetfish (Plecoglossus altivelis)' },
    { w: '鮎漁',   r: 'あゆりょう', m: 'ayu fishing' },
    { w: '鮎並',   r: 'あいなめ',   m: 'fat greenling (Hexagrammos otakii)' },
  ],
  '鹿': [
    { w: '鹿',     r: 'しか',       m: 'deer' },
    { w: '鹿児島', r: 'かごしま',   m: 'Kagoshima (prefecture)' },
    { w: '小鹿',   r: 'こじか',     m: 'fawn, young deer' },
  ],
  '麗': [
    { w: '麗しい', r: 'うるわしい', m: 'beautiful, lovely, graceful' },
    { w: '華麗',   r: 'かれい',     m: 'splendid, gorgeous, brilliant' },
    { w: '麗らか', r: 'うららか',   m: 'bright and clear (spring day), balmy' },
  ],
  '麻': [
    { w: '麻薬',   r: 'まやく',     m: 'narcotic, drug (illicit)' },
    { w: '麻酔',   r: 'ますい',     m: 'anesthesia, anesthetic' },
    { w: '麻',     r: 'あさ',       m: 'hemp, flax, linen' },
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

// ── Sentence overrides (for card generation) ─────────────────────────────
// Hand-curated example sentences per kanji (all JLPT N5). Format: { jp, en }
// Highest priority — overrides all API sources.
export const SENTENCE_OVERRIDE = {
  // ── Numbers ──
  '一': [
    { jp: 'みかんを一つください。', en: 'Give me one mandarin, please.' },
    { jp: '一番すきなたべものは何ですか。', en: "What's your favorite food?" },
  ],
  '二': [
    { jp: '二月はさむいです。', en: 'February is cold.' },
    { jp: '二人でいきましょう。', en: "Let's go, just the two of us." },
  ],
  '三': [
    { jp: '三月に花見をします。', en: "I'll do hanami in March." },
    { jp: '三人でたべましょう。', en: "Let's eat, the three of us." },
  ],
  '四': [
    { jp: '四月から学校がはじまります。', en: 'School starts in April.' },
    { jp: '四日にかえります。', en: "I'll return on the 4th." },
  ],
  '五': [
    { jp: '五月はきもちがいいです。', en: 'May feels nice.' },
    { jp: 'あと五日でやすみです。', en: 'Only 5 more days until vacation.' },
  ],
  '六': [
    { jp: '六月は雨がおおいです。', en: 'There is a lot of rain in June.' },
    { jp: '六つたべました。', en: 'I ate six.' },
  ],
  '七': [
    { jp: '七月はあついです。', en: 'July is hot.' },
    { jp: '七日においわいをします。', en: "I'll celebrate on the 7th." },
  ],
  '八': [
    { jp: '八月はなつやすみです。', en: 'August is summer vacation.' },
    { jp: '八日に東京へいきます。', en: "I'm going to Tokyo on the 8th." },
  ],
  '九': [
    { jp: '九月に学校がはじまります。', en: 'School starts in September.' },
    { jp: '九日はひまです。', en: 'The 9th is free.' },
  ],
  '十': [
    { jp: '十分まってください。', en: 'Please wait ten minutes.' },
    { jp: '十月にりょこうします。', en: "I'll travel in October." },
  ],
  '百': [
    { jp: 'これは百円です。', en: 'This is 100 yen.' },
    { jp: 'ひゃくにんいました。', en: 'There were 100 people.' },
  ],
  '千': [
    { jp: '千円でかいました。', en: 'I bought it for 1000 yen.' },
    { jp: '三千円のかばんです。', en: 'It is a 3000-yen bag.' },
  ],
  '万': [
    { jp: '一万円しかありません。', en: 'I only have 10,000 yen.' },
    { jp: '何万人もきました。', en: 'Tens of thousands of people came.' },
  ],
  '円': [
    { jp: '百円でかえますか。', en: 'Can I buy it for 100 yen?' },
    { jp: '千円おつりをください。', en: 'Please give me change for 1000 yen.' },
  ],
  // ── Time ──
  '年': [
    { jp: '今年はいそがしいです。', en: 'This year is busy.' },
    { jp: '来年またきます。', en: "I'll come again next year." },
  ],
  '月': [
    { jp: '月曜日はしごとです。', en: 'Monday is a workday.' },
    { jp: '来月りょこうします。', en: "I'll travel next month." },
  ],
  '日': [
    { jp: '今日はいい天気ですね。', en: "The weather is nice today, isn't it?" },
    { jp: '毎日日本語を勉強します。', en: 'I study Japanese every day.' },
  ],
  '時': [
    { jp: '何時におきますか。', en: 'What time do you wake up?' },
    { jp: '時間がありません。', en: "I don't have time." },
  ],
  '午': [
    { jp: '午後にかいものをします。', en: "I'll go shopping in the afternoon." },
    { jp: '午前中はいえにいます。', en: "I'll be home in the morning." },
  ],
  '半': [
    { jp: '一時半にあいましょう。', en: "Let's meet at 1:30." },
    { jp: '半分たべました。', en: 'I ate half.' },
  ],
  '今': [
    { jp: '今どこにいますか。', en: 'Where are you right now?' },
    { jp: '今日はさむいですね。', en: "It's cold today, isn't it?" },
  ],
  '先': [
    { jp: '先生はやさしいです。', en: 'The teacher is kind.' },
    { jp: '先週どこへいきましたか。', en: 'Where did you go last week?' },
  ],
  '来': [
    { jp: '来週テストがあります。', en: "There's a test next week." },
    { jp: '来年また日本にきます。', en: "I'll come to Japan again next year." },
  ],
  '毎': [
    { jp: '毎朝コーヒーをのみます。', en: 'I drink coffee every morning.' },
    { jp: '毎日べんきょうします。', en: 'I study every day.' },
  ],
  '前': [
    { jp: '駅の前にいます。', en: "I'm in front of the station." },
    { jp: '前にもきたことがあります。', en: "I've been here before." },
  ],
  '後': [
    { jp: '後でれんらくします。', en: "I'll contact you later." },
    { jp: '後ろにすわってください。', en: 'Please sit behind me.' },
  ],
  '間': [
    { jp: '時間がありません。', en: "I don't have time." },
    { jp: '人間はふしぎですね。', en: "Humans are mysterious, aren't they?" },
  ],
  // ── People / Family ──
  '人': [
    { jp: 'あの人はだれですか。', en: 'Who is that person?' },
    { jp: '外国人の友だちがいます。', en: 'I have a foreign friend.' },
  ],
  '友': [
    { jp: '友だちとあそびます。', en: 'I play with my friends.' },
    { jp: '友だちはやさしいです。', en: 'My friend is kind.' },
  ],
  '名': [
    { jp: 'お名前はなんですか。', en: 'What is your name?' },
    { jp: '有名なレストランです。', en: "It's a famous restaurant." },
  ],
  '父': [
    { jp: 'お父さんはなんさいですか。', en: 'How old is your father?' },
    { jp: '父は会社員です。', en: 'My father is a company employee.' },
  ],
  '母': [
    { jp: 'お母さんはげんきですか。', en: 'Is your mother well?' },
    { jp: '母のりょうりがすきです。', en: "I like my mother's cooking." },
  ],
  '子': [
    { jp: '子どもがふたりいます。', en: 'I have two children.' },
    { jp: 'あのおんなの子はだれですか。', en: 'Who is that girl?' },
  ],
  '男': [
    { jp: 'あそこに男のこがいます。', en: "There's a boy over there." },
    { jp: 'あの男のひとはだれですか。', en: 'Who is that man?' },
  ],
  '女': [
    { jp: '女のこがさんにんいます。', en: 'There are three girls.' },
    { jp: '女のひとがうたっています。', en: 'A woman is singing.' },
  ],
  // ── Directions / Positions ──
  '上': [
    { jp: '日本語がとても上手ですね。', en: 'Your Japanese is very good.' },
    { jp: 'つくえの上にあります。', en: "It's on top of the desk." },
  ],
  '下': [
    { jp: '地下にコンビニがあります。', en: "There's a convenience store underground." },
    { jp: 'いすの下をみてください。', en: 'Please look under the chair.' },
  ],
  '中': [
    { jp: 'かばんの中にあります。', en: "It's inside the bag." },
    { jp: '一日中テレビをみていました。', en: 'I was watching TV all day long.' },
  ],
  '入': [
    { jp: '入口はどこですか。', en: 'Where is the entrance?' },
    { jp: 'どうぞお入りください。', en: 'Please come in.' },
  ],
  '出': [
    { jp: '出口はあちらです。', en: 'The exit is over there.' },
    { jp: '七時に家を出ます。', en: 'I leave home at seven.' },
  ],
  '北': [
    { jp: '北海道はさむいです。', en: 'Hokkaido is cold.' },
    { jp: '北口でおちあいましょう。', en: "Let's meet at the north exit." },
  ],
  '南': [
    { jp: '南口をでてください。', en: 'Please exit from the south exit.' },
    { jp: '南のほうがあたたかいです。', en: 'The south is warmer.' },
  ],
  '東': [
    { jp: '東京はひとがおおいです。', en: 'Tokyo has a lot of people.' },
    { jp: '東口でまっています。', en: "I'm waiting at the east exit." },
  ],
  '西': [
    { jp: '西口でまちましょう。', en: "Let's wait at the west exit." },
    { jp: '関西へいきたいです。', en: 'I want to go to Kansai.' },
  ],
  '右': [
    { jp: '右にまがってください。', en: 'Please turn right.' },
    { jp: '右にほんやがあります。', en: "There's a bookstore on the right." },
  ],
  '左': [
    { jp: '左にまがってください。', en: 'Please turn left.' },
    { jp: '左のたてものです。', en: 'It is the building on the left.' },
  ],
  '外': [
    { jp: '外はさむいです。', en: 'It is cold outside.' },
    { jp: '外国にいきたいです。', en: 'I want to go abroad.' },
  ],
  // ── Nature ──
  '山': [
    { jp: '富士山は高いです。', en: 'Mount Fuji is tall.' },
    { jp: '山に登りたいです。', en: 'I want to climb a mountain.' },
  ],
  '川': [
    { jp: '川で泳ぎましょう。', en: "Let's swim in the river." },
    { jp: '天の川が見えます。', en: 'You can see the Milky Way.' },
  ],
  '天': [
    { jp: '今日は天気がいいです。', en: 'The weather is nice today.' },
    { jp: '天ぷらがすきです。', en: 'I like tempura.' },
  ],
  '雨': [
    { jp: '今日は雨がふっています。', en: "It's raining today." },
    { jp: '梅雨のきせつになりました。', en: 'The rainy season has come.' },
  ],
  '気': [
    { jp: '今日はいい天気ですね。', en: "The weather is nice today, isn't it?" },
    { jp: '元気にしていますか。', en: 'How have you been?' },
  ],
  '水': [
    { jp: '水を一杯ください。', en: 'Please give me a glass of water.' },
    { jp: '水曜日は休みです。', en: 'Wednesday is my day off.' },
  ],
  '火': [
    { jp: '花火がきれいです。', en: 'The fireworks are beautiful.' },
    { jp: '火曜日に映画を見ます。', en: 'I watch a movie on Tuesdays.' },
  ],
  '土': [
    { jp: '土曜日は暇ですか。', en: 'Are you free on Saturday?' },
    { jp: 'この土地は広いです。', en: 'This land is spacious.' },
  ],
  '金': [
    { jp: 'お金がありません。', en: "I don't have any money." },
    { jp: '金曜日に帰ります。', en: 'I will go home on Friday.' },
  ],
  '木': [
    { jp: '公園に木があります。', en: 'There are trees in the park.' },
    { jp: '木曜日に会いましょう。', en: "Let's meet on Thursday." },
  ],
  // ── Education / Language ──
  '学': [
    { jp: '毎日にほんごをまなびます。', en: 'I study Japanese every day.' },
    { jp: '学生のころがなつかしいです。', en: 'I miss my student days.' },
  ],
  '校': [
    { jp: '学校はたのしいですか。', en: 'Is school fun?' },
    { jp: '高校のじかんがなつかしいです。', en: 'I miss my high school days.' },
  ],
  '生': [
    { jp: '先生はやさしいです。', en: 'The teacher is kind.' },
    { jp: '来年学生になります。', en: "I'll become a student next year." },
  ],
  '本': [
    { jp: 'この本はおもしろいです。', en: 'This book is interesting.' },
    { jp: '本当にありがとうございます。', en: 'Thank you very much.' },
  ],
  '語': [
    { jp: '日本語がすこしはなせます。', en: 'I can speak a little Japanese.' },
    { jp: '英語がとくいですか。', en: 'Are you good at English?' },
  ],
  '書': [
    { jp: '手紙を書きます。', en: "I'll write a letter." },
    { jp: '毎日日記を書きます。', en: 'I write in my diary every day.' },
  ],
  '話': [
    { jp: 'ゆっくり話してください。', en: 'Please speak slowly.' },
    { jp: '電話でおはなしできますか。', en: 'Can we talk on the phone?' },
  ],
  '聞': [
    { jp: 'おんがくをよく聞きます。', en: 'I often listen to music.' },
    { jp: 'もういちど聞いていいですか。', en: 'May I ask one more time?' },
  ],
  '見': [
    { jp: 'えいがを見にいきます。', en: "I'll go see a movie." },
    { jp: 'ここからうみが見えます。', en: 'You can see the sea from here.' },
  ],
  '読': [
    { jp: '毎日本を読みます。', en: 'I read books every day.' },
    { jp: '読書がすきです。', en: 'I like reading.' },
  ],
  '食': [
    { jp: 'なにを食べましたか。', en: 'What did you eat?' },
    { jp: 'いっしょに食事しませんか。', en: 'Shall we have a meal together?' },
  ],
  // ── Adjectives / Common vocab ──
  '大': [
    { jp: '大きいかばんをかいました。', en: 'I bought a big bag.' },
    { jp: '健康はとても大事です。', en: 'Health is very important.' },
  ],
  '小': [
    { jp: 'このへやは小さいですね。', en: "This room is small, isn't it." },
    { jp: '小学校のころがなつかしいです。', en: 'I miss my elementary school days.' },
  ],
  '高': [
    { jp: 'このかばんは高いです。', en: 'This bag is expensive.' },
    { jp: '最高のたびでした。', en: 'It was the best trip.' },
  ],
  '長': [
    { jp: 'このみちは長いですね。', en: "This road is long, isn't it." },
    { jp: 'はなしが長くなりました。', en: 'The story got long.' },
  ],
  '白': [
    { jp: '白いシャツがすきです。', en: 'I like white shirts.' },
    { jp: 'このかみは白いです。', en: 'This paper is white.' },
  ],
  // ── Actions ──
  '行': [
    { jp: 'どこへ行きますか。', en: 'Where are you going?' },
    { jp: '来年りょこうに行きます。', en: "I'll go traveling next year." },
  ],
  '休': [
    { jp: '夏休みはながいです。', en: 'Summer vacation is long.' },
    { jp: '今日はかいしゃを休みます。', en: "I'll take the day off from work today." },
  ],
  '何': [
    { jp: '何がたべたいですか。', en: 'What do you want to eat?' },
    { jp: '何かのみますか。', en: 'Would you like something to drink?' },
  ],
  '国': [
    { jp: 'どこの国からきましたか。', en: 'Where are you from?' },
    { jp: '外国にいきたいです。', en: 'I want to go abroad.' },
  ],
  // ── Transport / Tech ──
  '電': [
    { jp: '電車でいきます。', en: "I'll go by train." },
    { jp: '電気をけしてください。', en: 'Please turn off the lights.' },
  ],
  '車': [
    { jp: '電車はべんりです。', en: 'The train is convenient.' },
    { jp: '車でいきますか。', en: 'Will you go by car?' },
  ],
  // ── Extra (N4 per API but taught at N5 level) ──
  '口': [
    { jp: '出口はどこですか。', en: 'Where is the exit?' },
    { jp: '人口が多い町です。', en: 'It is a town with a large population.' },
  ],

  // ── Auto-generated from Tatoeba ──
  '世': [
    { jp: '一つの世界である。', en: 'There is one world.' },
    { jp: '夢は世界一周です。', en: 'My dream is to take a round-the-world trip.' },
  ],
  '主': [
    { jp: 'ご主人は幸せ者だなぁ。', en: 'Your husband is a lucky man.' },
    { jp: 'ご主人はご在宅ですか。', en: 'Is the master of the house at home?' },
  ],
  '事': [
    { jp: '世に真の大事なし。', en: 'Nothing really matters.' },
    { jp: '文法はとても大事だ。', en: 'Grammar is very important.' },
  ],
  '京': [
    { jp: '東京に住んでいる。', en: 'I live in Tokyo.' },
    { jp: '北京から来ました。', en: 'I come from Beijing.' },
  ],
  '仕': [
    { jp: '仕方なかったんだ。', en: 'That couldn\'t be helped.' },
    { jp: '眠くて仕方がなかった。', en: 'I got very sleepy.' },
  ],
  '代': [
    { jp: 'それは時代遅れです。', en: 'It\'s outdated.' },
    { jp: 'その靴は時代遅れだ。', en: 'Those shoes are out of date.' },
  ],
  '以': [
    { jp: '私は18歳以上です。', en: 'I\'m over eighteen.' },
    { jp: '１万円以上します。', en: 'It will cost more than ten thousand yen.' },
  ],
  '会': [
    { jp: '会議はどうだった？', en: 'How was your meeting?' },
    { jp: '会議室はどこですか？', en: 'Where\'s the conference room?' },
  ],
  '住': [
    { jp: 'パリに住むつもりよ。', en: 'I\'m going to live in Paris.' },
    { jp: '都会に住む予定です。', en: 'I plan to live in the city.' },
  ],
  '体': [
    { jp: 'トムは体育の先生だ。', en: 'Tom is a gym teacher.' },
    { jp: '体育祭はどうでしたか？', en: 'How did you do on sports day?' },
  ],
  '作': [
    { jp: '見事な作品ですね。', en: 'It\'s an excellent composition.' },
    { jp: '彼の作品を一つ読んだ。', en: 'I read one of his works.' },
  ],
  '使': [
    { jp: '日本大使館はどこにありますか。', en: 'Where is the Japanese Embassy?' },
    { jp: '言葉を正しく使おう。', en: "Let's use words correctly." },
  ],
  '借': [
    { jp: '３００ドル借りる必要があるんだ。', en: 'I need to borrow three hundred dollars.' },
    { jp: '金を借りるのも貸すのも嫌だ。', en: 'I don\'t want to lend or borrow.' },
  ],
  '元': [
    { jp: '元気だねぇ......。', en: 'You seem well...' },
    { jp: '地元のチームは勝った。', en: 'The home team won.' },
  ],
  '兄': [
    { jp: 'お兄さんは何歳ですか？', en: 'How old is your brother?' },
    { jp: 'お兄さん連れてきてね。', en: 'Bring your brother.' },
  ],
  '公': [
    { jp: '公園はがらがらだ。', en: 'The park is empty.' },
    { jp: '公園で待ってるね。', en: 'I\'ll wait for you in the park.' },
  ],
  '写': [
    { jp: '彼女は友達のノートを写す。', en: 'She will copy her friend\'s notebook.' },
    { jp: '写真が必要ですよ。', en: 'You need a photograph.' },
  ],
  '冬': [
    { jp: '冬支度は万端です！', en: 'Winter preparations are all complete.' },
    { jp: '冬休みまであとわずかだ。', en: 'There\'s only a couple of days left until our winter vacation.' },
  ],
  '切': [
    { jp: '毎朝線路を横切る。', en: 'I cross the rail tracks every morning.' },
    { jp: '髪は月に一度切るよ。', en: 'I have my hair cut once a month.' },
  ],
  '別': [
    { jp: '今日は特別な日だね。', en: 'Today is a special day.' },
    { jp: 'トムは特別な子です。', en: 'Tom is a special child.' },
  ],
  '力': [
    { jp: 'トマス君、努力してよ！', en: 'Thomas, make some effort!' },
    { jp: '努力は報われなかった。', en: 'It wasn\'t worth the effort.' },
  ],
  '勉': [
    { jp: '一緒に勉強しよう！', en: 'Let\'s study together!' },
    { jp: '勤勉は成功への道だ。', en: 'Diligence is the way to success.' },
  ],
  '動': [
    { jp: 'それでも地球は動く！', en: 'Even so, the Earth moves!' },
    { jp: 'トムに動くなと言った。', en: 'I told Tom to not to move.' },
  ],
  '医': [
    { jp: '世の中は藪医者だらけ。', en: 'The world is full of incompetent doctors.' },
    { jp: '彼は医者になった。', en: 'He became a doctor.' },
  ],
  '去': [
    { jp: '「風と共に去りぬ」を読む。', en: 'Read "Gone With The Wind".' },
    { jp: '何で早めに去るの？', en: 'Why are you leaving early?' },
  ],
  '古': [
    { jp: '古い物が好きだ｡', en: 'I like old things.' },
    { jp: 'この靴は古いです。', en: 'These shoes are old.' },
  ],
  '台': [
    { jp: 'トムは台所にいる？', en: 'Is Tom in the kitchen?' },
    { jp: '台所で何を見たの？', en: 'What did you see in the kitchen?' },
  ],
  '同': [
    { jp: 'ルールは同じですか？', en: 'Are the rules the same?' },
    { jp: '私も同じ意見です。', en: 'I\'m of the same opinion as you.' },
  ],
  '味': [
    { jp: 'これどういう意味？', en: 'What does this mean?' },
    { jp: 'いい意味で言ったんです。', en: 'I meant it in a good sense.' },
  ],
  '品': [
    { jp: '年は上品に取りたいものですね。', en: 'I want to age gracefully.' },
    { jp: 'これは上品な佇まいを漂わせた家だ。', en: 'This is a house that exudes an air of elegance.' },
  ],
  '員': [
    { jp: '人員に余剰が出る', en: 'There will be a surplus of personnel.' },
    { jp: 'トムは会員ですか？', en: 'Is Tom a member?' },
  ],
  '問': [
    { jp: '他の質問していい？', en: 'Can I ask another question?' },
    { jp: '質問はありますか？', en: 'Do you have any questions?' },
  ],
  '図': [
    { jp: '何て図々しい奴だ！', en: 'You have a lot of nerve!' },
  ],
  '堂': [
    { jp: '食堂はどこですか。', en: 'Where is the cafeteria?' },
    { jp: '食堂ってもう開店した？', en: 'Is the cafeteria open yet?' },
  ],
  '場': [
    { jp: 'この場所が好きだ！', en: 'I love this place!' },
    { jp: '私の座る場所ある？', en: 'Is there any room for me?' },
  ],
  '売': [
    { jp: '売ることにしたんだ。', en: 'We decided to sell it.' },
    { jp: '彼女は食べ物を売る。', en: 'She sells food.' },
  ],
  '夏': [
    { jp: '夏場はすごく綺麗なんです。', en: 'It\'s very beautiful there in the summer.' },
    { jp: '私は夏が一番好きだ。', en: 'I like summer the best.' },
  ],
  '夕': [
    { jp: '夕方にテニスに行く。', en: 'I\'m going to play tennis this evening.' },
    { jp: '夕方が近づいていた。', en: 'Evening was drawing near.' },
  ],
  '多': [
    { jp: 'トムは多分勝った。', en: 'Tom probably won.' },
    { jp: 'トムは多分死んだ。', en: 'Tom probably died.' },
  ],
  '夜': [
    { jp: '夜中過ぎだったよ。', en: 'It was after midnight.' },
    { jp: 'もう夜中を過ぎた。', en: 'It\'s midnight already.' },
  ],
  '妹': [
    { jp: '私の妹は四歳です。', en: 'My younger sister is 4 years old.' },
    { jp: '妹は絵が上手です。', en: 'My younger sister is good at drawing.' },
  ],
  '姉': [
    { jp: '姉は２歳年上です。', en: 'My older sister has two years over me.' },
    { jp: 'お姉さんのことよ。', en: 'It\'s about your sister.' },
  ],
  '始': [
    { jp: '試合はいつ始まるの？', en: 'When does the game begin?' },
    { jp: '試験はいつ始まるの？', en: 'When does the exam start?' },
  ],
  '字': [
    { jp: '漢字の勉強中です。', en: 'I\'m studying hanzi.' },
    { jp: '漢字はもう書けるよ。', en: 'I\'m already able to write Chinese characters.' },
  ],
  '安': [
    { jp: 'お肉が安いんです。', en: 'The meat is cheap.' },
    { jp: '新聞は本より安い。', en: 'The newspaper costs less than the book.' },
  ],
  '室': [
    { jp: '教室から出なさい。', en: 'Get out of the classroom.' },
    { jp: '彼は教室にいるよ。', en: 'He is in the classroom.' },
  ],
  '家': [
    { jp: '家に帰りたいです。', en: 'I want to go home.' },
    { jp: '家族でディナーを食べました。', en: 'We had dinner as a family.' },
  ],
  '少': [
    { jp: '僕は友達が少ない。', en: 'I don\'t have many friends.' },
    { jp: '５は８より少ない。', en: '5 is less than 8.' },
  ],
  '屋': [
    { jp: '部屋は何階ですか？', en: 'What floor is my room on?' },
    { jp: '部屋に誰かいるの？', en: 'Is there anyone in the room?' },
  ],
  '工': [
    { jp: '自由工作って好き？', en: 'Do you like arts and crafts?' },
    { jp: '食べる前にひと工夫！', en: 'Before eating here\'s a small tip.' },
  ],
  '帰': [
    { jp: '彼らはいつ帰るの？', en: 'When are they coming home?' },
    { jp: '家に帰る途中なの？', en: 'Are you on your way home?' },
  ],
  '広': [
    { jp: 'トムは肩幅が広い。', en: 'Tom has broad shoulders.' },
    { jp: '広告は入れないで？', en: 'Could you not include ads?' },
  ],
  '店': [
    { jp: '一番近くにある中華料理店はどこですか？', en: 'Where\'s the nearest Chinese restaurant?' },
    { jp: 'ボストンは中華料理店ってたくさんある？', en: 'Are there many Chinese restaurants in Boston?' },
  ],
  '度': [
    { jp: '水の温度は38℃です。', en: 'The water\'s 38 degrees.' },
    { jp: '温度は七十度です。', en: 'The thermometer stands at 70.' },
  ],
  '建': [
    { jp: '彼らは自分たちで家を建てる。', en: 'They build their house for themselves.' },
    { jp: 'ネザーポータルを建てるには何がいるの？', en: 'What do you need to build a nether portal?' },
  ],
  '弟': [
    { jp: '僕の誕生日は10月で、弟は11月です。', en: 'My birthday is in October and my brother\'s is in November.' },
    { jp: '来月、私の弟は二十歳になります。', en: 'Next month, my little brother will turn 20.' },
  ],
  '強': [
    { jp: 'なんて強い風なの！', en: 'What a strong wind!' },
    { jp: '一緒に勉強しよう！', en: 'Let\'s study together!' },
  ],
  '待': [
    { jp: '外で待つつもりよ。', en: 'I\'m going to wait outside.' },
    { jp: '待つことにしたよ。', en: 'I\'ve decided to wait.' },
  ],
  '心': [
    { jp: '彼は自己中心です。', en: 'He\'s self centered.' },
    { jp: '中心街に向かいます。', en: 'I\'m going to the center of the city.' },
  ],
  '思': [
    { jp: 'トムは思い出した。', en: 'Tom remembered.' },
    { jp: 'ああ思い出したぞ。', en: 'Now I remember.' },
  ],
  '急': [
    { jp: '急ぐ必要はないよ。', en: 'You don\'t have to hurry.' },
    { jp: '何も急ぐ事はないよ。', en: 'There is no hurry.' },
  ],
  '悪': [
    { jp: '悪化したのですか。', en: 'Is it getting worse?' },
    { jp: 'トムの体調は悪化した。', en: 'Tom\'s condition has worsened.' },
  ],
  '意': [
    { jp: 'これどういう意味？', en: 'What does this mean?' },
    { jp: 'いい意味で言ったんです。', en: 'I meant it in a good sense.' },
  ],
  '手': [
    { jp: '彼から手紙がきた？', en: 'You heard from him?' },
    { jp: 'バスケは上手いの？', en: 'Do you play basketball well?' },
  ],
  '持': [
    { jp: '天気が持つかなあ。', en: 'I wonder if the weather will hold.' },
    { jp: 'スマホは長持ちしますか？', en: 'Does your smartphone hold its charge?' },
  ],
  '教': [
    { jp: 'やり方を教えるね。', en: 'I\'ll show you how to do it.' },
    { jp: '私は英語を教える。', en: 'I teach English.' },
  ],
  '文': [
    { jp: '僕は文化祭で女装した。', en: 'I dressed up as a girl for the school festival.' },
    { jp: 'それが文化的過程である。', en: 'It is a cultural mechanism.' },
  ],
  '料': [
    { jp: '料理は誰がするの？', en: 'Who will prepare the food?' },
    { jp: 'この電話は無料よ。', en: 'This call is free.' },
  ],
  '新': [
    { jp: '新しい先生ですか？', en: 'Are you the new teacher?' },
    { jp: '新しい車買ったの？', en: 'Did you buy a new car?' },
  ],
  '方': [
    { jp: '一番簡単な方法よ。', en: 'It\'s the easiest way.' },
    { jp: 'どの方法を選んだの？', en: 'Which way did you choose?' },
  ],
  '旅': [
    { jp: 'あの旅館は家庭的だ。', en: 'The hotel has a homey atmosphere.' },
    { jp: '山間の旅館で２泊しました。', en: 'I spent 2 nights at a mountain Inn.' },
  ],
  '族': [
    { jp: '私たちは家族です。', en: 'We are a family.' },
    { jp: '家族とは親密ですか？', en: 'Are you close to your family?' },
  ],
  '明': [
    { jp: '外はまだ明るいよ。', en: 'It is still light outside.' },
    { jp: '彼はいつも明るい。', en: 'He is always cheerful.' },
  ],
  '映': [
    { jp: 'この映像はドラマだ。', en: 'This film is a drama.' },
    { jp: 'アニメの映像はどれも気味が悪かった。', en: 'All of the anime visuals were creepy.' },
  ],
  '春': [
    { jp: '私の子供達はもうすぐ春休みです。', en: 'My kids have their spring break soon.' },
    { jp: '私は春休みの間仕事をするつもりです。', en: 'I am going to work during the spring vacation.' },
  ],
  '昼': [
    { jp: 'お昼ご飯中ですか？', en: 'Are you eating lunch?' },
    { jp: 'お昼ご飯、何がいい？', en: 'What do you want for lunch?' },
  ],
  '曜': [
    { jp: '今日は金曜日だよ。', en: 'Today is Friday.' },
    { jp: '金曜日はどうですか？', en: 'How about Friday?' },
  ],
  '有': [
    { jp: '有名になりたいの？', en: 'Do you want to become famous?' },
    { jp: 'トムって有名なの？', en: 'Is Tom famous?' },
  ],
  '服': [
    { jp: '彼女は和服の方が良く似合う。', en: 'She looks better in Japanese clothes.' },
    { jp: '確かに彼女は和服を着ると美しく見える。', en: 'She certainly looks beautiful in a Japanese kimono.' },
  ],
  '朝': [
    { jp: '今朝出てた虹みた？', en: 'Did you see the rainbow this morning?' },
    { jp: '今朝の新聞読んだ？', en: 'Did you read this morning\'s newspaper?' },
  ],
  '業': [
    { jp: '今日は授業ないの？', en: 'Don\'t you have classes today?' },
    { jp: '初めての授業です。', en: 'It\'s our first lesson.' },
  ],
  '歌': [
    { jp: '好きな歌手とかいる？', en: 'Do you have a favorite singer?' },
    { jp: '貴方は歌手なのだ。', en: 'You are a singer.' },
  ],
  '正': [
    { jp: '私の文は正しいですか？', en: 'Is my sentence correct?' },
    { jp: 'その文を修正しました。', en: 'I corrected the sentence.' },
  ],
  '歩': [
    { jp: 'あまり早く歩くな。', en: 'Don\'t walk so fast.' },
    { jp: '私は歩くのが遅い。', en: 'I walk slowly.' },
  ],
  '死': [
    { jp: 'ヨルダン川は死海に注ぐ唯一の川である。', en: 'The Jordan River is the only river flowing into the Dead Sea.' },
    { jp: 'トムは海で溺れて死んだ。', en: 'Tom drowned in the ocean.' },
  ],
  '注': [
    { jp: 'ピザを注文しない？', en: 'Why don\'t we order pizza?' },
    { jp: 'ピザを注文したの誰？', en: 'Who ordered pizza?' },
  ],
  '洋': [
    { jp: 'お洋服着ましょうね。', en: 'Let\'s get you dressed.' },
    { jp: 'どんな洋服が好みですか。', en: 'What\'s your favorite item of clothing?' },
  ],
  '海': [
    { jp: '海に行くのはどう？', en: 'How about we go to the beach?' },
    { jp: '海外にはいつ行くの？', en: 'When are you going abroad?' },
  ],
  '漢': [
    { jp: '漢字の勉強中です。', en: 'I\'m studying hanzi.' },
    { jp: '漢字はもう書けるよ。', en: 'I\'m already able to write Chinese characters.' },
  ],
  '牛': [
    { jp: '牛乳はよく飲むの？', en: 'Do you often drink milk?' },
    { jp: '牛乳は持ってきた？', en: 'Did you bring some milk?' },
  ],
  '物': [
    { jp: '象は草食動物です。', en: 'Elephants are herbivores.' },
    { jp: '奇妙な動物だった。', en: 'It was a strange beast.' },
  ],
  '特': [
    { jp: '今日は特に暑い日だ。', en: 'It\'s especially hot today.' },
    { jp: '今日は特別な日だね。', en: 'Today is a special day.' },
  ],
  '犬': [
    { jp: '子犬が大好きです。', en: 'I love puppies.' },
    { jp: '子犬はいつ犬になるの？', en: 'When does a puppy become a dog?' },
  ],
  '用': [
    { jp: '試着室は今使用中だ。', en: 'The fitting room is being used now.' },
    { jp: '会議室は現在使用中です。', en: 'The meeting room is in use now.' },
  ],
  '田': [
    { jp: '田舎に住みたいな。', en: 'I want to live in rural areas.' },
    { jp: '僕は田舎で育った。', en: 'I grew up in the country.' },
  ],
  '町': [
    { jp: '市と町の違いは何？', en: 'What is the difference between \'city\' and \'town\'?' },
    { jp: 'この町から出たい。', en: 'I want to get out of this town.' },
  ],
  '界': [
    { jp: '一つの世界である。', en: 'There is one world.' },
    { jp: '夢は世界一周です。', en: 'My dream is to take a round-the-world trip.' },
  ],
  '病': [
    { jp: '病院は何処ですか？', en: 'Where\'s the hospital?' },
    { jp: 'ここはいい病院だ。', en: 'This is a good hospital.' },
  ],
  '発': [
    { jp: '何時に出発するの？', en: 'What time are you leaving?' },
    { jp: '誰が発明したのか？', en: 'Who invented it?' },
  ],
  '目': [
    { jp: 'あの看板が目立つね。', en: 'That sign really stands out.' },
    { jp: 'いや、これが二回目だ。', en: 'No, this is my second time.' },
  ],
  '真': [
    { jp: '真実はただひとつ。', en: 'There is only one truth.' },
    { jp: '真実は必ず勝つさ。', en: 'The truth will always win.' },
  ],
  '着': [
    { jp: '本当にあれ着るつもり？', en: 'Are you really going to wear that?' },
    { jp: '恩に着る、スコット。', en: 'I owe you one, Scott.' },
  ],
  '知': [
    { jp: '誰も知る由もない。', en: 'No one could have known.' },
    { jp: '一を聞いて十を知る。', en: 'A word is enough to a wise man.' },
  ],
  '研': [
    { jp: '研究室に戻りなさい。', en: 'Go back to the lab.' },
    { jp: '彼女は研究に夢中だ。', en: 'She is absorbed in her study.' },
  ],
  '社': [
    { jp: 'トムは会社にいる？', en: 'Is Tom in the office?' },
    { jp: 'この会社がいいな。', en: 'I like the company.' },
  ],
  '私': [
    { jp: '私立大学の数が増えた。', en: 'The number of private colleges has increased.' },
    { jp: 'トムは私立探偵を雇った。', en: 'Tom hired a private detective.' },
  ],
  '秋': [
    { jp: '秋には落葉します。', en: 'The leaves fall off the trees in autumn.' },
    { jp: '秋の気配がします。', en: 'It feels like fall.' },
  ],
  '究': [
    { jp: '研究室に戻りなさい。', en: 'Go back to the lab.' },
    { jp: '彼女は研究に夢中だ。', en: 'She is absorbed in her study.' },
  ],
  '答': [
    { jp: '君が答える必要はない。', en: 'You don\'t have to answer.' },
    { jp: '君が質問に答える番だよ。', en: 'It\'s your turn to answer the question.' },
  ],
  '紙': [
    { jp: '彼から手紙がきた？', en: 'You heard from him?' },
    { jp: 'トムは折り紙アーティストだ。', en: 'Tom is an origami artist.' },
  ],
  '終': [
    { jp: 'もうすぐ終わるよ。', en: 'He\'ll finish in a second.' },
    { jp: '数日で全部終わるよ。', en: 'It will all be over in a few days.' },
  ],
  '習': [
    { jp: '毎日練習を習慣にしています。', en: 'I make daily practice a habit.' },
    { jp: '習い事を始めたばかりです。', en: 'I just started taking lessons.' },
  ],
  '考': [
    { jp: '彼は論理的思考力が致命的に欠如している。', en: 'He has no ability to reason logically at all.' },
    { jp: 'もっとよく考えてみて。', en: 'Think it over more carefully.' },
  ],
  '肉': [
    { jp: '何よりも牛肉が好き。', en: 'I like beef more than anything.' },
    { jp: '仔牛肉を食べますか。', en: 'Do you eat veal?' },
  ],
  '自': [
    { jp: '自由工作って好き？', en: 'Do you like arts and crafts?' },
    { jp: '自由な国だからね。', en: 'It\'s a free country.' },
  ],
  '色': [
    { jp: '色々ありがとう、トム。', en: 'Thanks for everything, Tom.' },
    { jp: '短期間で、色々あったのよ。', en: 'A lot happened in a short time.' },
  ],
  '花': [
    { jp: 'お花見に行こうよ。', en: 'Why don\'t we go and see the cherry blossoms?' },
    { jp: '花見をしに来ました。', en: 'I came to look at the cherry blossoms.' },
  ],
  '英': [
    { jp: '高等学校では英語と数学が重視されている。', en: 'English and mathematics are made much of in senior high schools.' },
    { jp: '英語を毎日練習する。', en: 'Practice English every day.' },
  ],
  '茶': [
    { jp: 'お茶は持ってきた？', en: 'Have you brought the tea?' },
    { jp: 'お茶でも飲もうか？', en: 'Shall we have some tea?' },
  ],
  '親': [
    { jp: '親は知ってるのか？', en: 'Do your parents know?' },
    { jp: '彼はとても親切だ！', en: 'He\'s very nice!' },
  ],
  '言': [
    { jp: 'お言葉ですが......。', en: 'With all due respect.' },
    { jp: '言葉に気をつけろ！', en: 'Watch your mouth!' },
  ],
  '計': [
    { jp: '計画を立てました。', en: 'I made plans.' },
    { jp: '彼は計画を変えた。', en: 'He\'s altered his plans.' },
  ],
  '試': [
    { jp: '明日は試験がある。', en: 'I have an exam tomorrow.' },
    { jp: '試着してみますか？', en: 'Would you like to try it on?' },
  ],
  '買': [
    { jp: 'トムは買うと思う？', en: 'Do you think Tom will buy it?' },
    { jp: 'それ買うつもりなの？', en: 'Are you going to buy that?' },
  ],
  '貸': [
    { jp: '噂話に耳を貸すな。', en: 'Don\'t listen to gossip.' },
    { jp: 'トムに金を貸すのは嫌だ。', en: 'I don\'t like it when Tom borrows money from me.' },
  ],
  '質': [
    { jp: '他の質問していい？', en: 'Can I ask another question?' },
    { jp: '質問はありますか？', en: 'Do you have any questions?' },
  ],
  '赤': [
    { jp: '赤いバラは咲いた？', en: 'Has the red rose blossomed?' },
    { jp: '私の赤い靴下どこ？', en: 'Where are my red socks?' },
  ],
  '走': [
    { jp: '毎日走るつもりなの？', en: 'Are you going to run every day?' },
    { jp: 'その馬は速く走る。', en: 'That horse runs fast.' },
  ],
  '起': [
    { jp: '起きろ！起きるんだ！', en: 'Get up! It\'s time to get up!' },
    { jp: '明日何時に起きるの？', en: 'What time will you get up tomorrow?' },
  ],
  '足': [
    { jp: '３０ドルで足りる？', en: 'Is thirty dollars enough?' },
    { jp: 'ニンニクは、2片で足りる？', en: 'Will two cloves of garlic be enough?' },
  ],
  '近': [
    { jp: 'ではまた近いうちに！', en: 'See you soon!' },
    { jp: '近いうちに話そう。', en: 'Let\'s talk soon.' },
  ],
  '送': [
    { jp: '郵便局まで送るよ。', en: 'I\'ll drive you to the post office.' },
    { jp: '車で家まで送るよ。', en: 'I\'ll give you a ride home.' },
  ],
  '通': [
    { jp: 'トムの声はよく通る。', en: 'Tom has a piercing voice.' },
    { jp: '君の声はよく通るな。', en: 'Your voice carries well.' },
  ],
  '週': [
    { jp: '今週末は何するの？', en: 'What\'re you going to do this weekend?' },
    { jp: '今週はきつかった。', en: 'I had a tough week.' },
  ],
  '道': [
    { jp: '学校への近道だよ。', en: 'It\'s a shortcut to the school.' },
    { jp: 'これ、本当に近道なの？', en: 'Is this really a shortcut?' },
  ],
  '重': [
    { jp: 'トムは三重の虹を見た。', en: 'Tom saw a triple rainbow.' },
    { jp: 'この家は、三重窓なんだよ。', en: 'This house has triple-pane windows.' },
  ],
  '銀': [
    { jp: '銀行は閉まってた？', en: 'Was the bank closed?' },
    { jp: '銀行は９時に開く。', en: 'Banks open at nine o\'clock.' },
  ],
  '開': [
    { jp: 'この箱は開けるな。', en: 'Don\'t open this box.' },
    { jp: 'けってドアを開けるな。', en: 'Don\'t kick the door open.' },
  ],
  '院': [
    { jp: '病院は何処ですか？', en: 'Where\'s the hospital?' },
    { jp: 'ここはいい病院だ。', en: 'This is a good hospital.' },
  ],
  '集': [
    { jp: '趣味は昆虫を集めることです。', en: 'My hobby is collecting insects.' },
    { jp: '趣味は切手を集めることです。', en: 'My hobby is collecting stamps.' },
  ],
  '青': [
    { jp: '今日は雲一つ無い青空だ。', en: 'The sky today is blue, without a cloud.' },
    { jp: '今日は雲一つない青空だね。', en: 'Today there isn\'t a cloud in the sky, what a blue sky!' },
  ],
  '音': [
    { jp: '音楽が聴きたいの？', en: 'Do you want to listen to some music?' },
    { jp: 'どんな音楽が好き？', en: 'What music do you like?' },
  ],
  '題': [
    { jp: 'そろそろ話題変えない？', en: 'I think it\'s about time we change the subject.' },
    { jp: '彼女は話題を変えた。', en: 'She changed the subject.' },
  ],
  '風': [
    { jp: '台風が来てるって。', en: 'I heard that a typhoon is coming.' },
    { jp: 'この秋は台風が多い。', en: 'We have had lots of typhoons this fall.' },
  ],
  '飯': [
    { jp: '一緒にお夕飯どう？', en: 'Why not have dinner with us?' },
    { jp: '夕飯はもう食べたの？', en: 'Have you eaten dinner yet?' },
  ],
  '飲': [
    { jp: '牛乳はよく飲むの？', en: 'Do you often drink milk?' },
    { jp: '緑茶ってよく飲む？', en: 'Do you drink green tea often?' },
  ],
  '館': [
    { jp: 'ここは図書館です。', en: 'This is a library.' },
    { jp: '映画館に行きましょう。', en: 'Let\'s go to the cinema.' },
  ],
  '駅': [
    { jp: '南駅はどこですか？', en: 'Where is the South Station?' },
    { jp: '駅前には銀行がある。', en: 'There is a bank in front of the station.' },
  ],
  '験': [
    { jp: '試験は来週ありますか？', en: 'Is the test next week?' },
    { jp: '経験は大事だよ。', en: 'Experience is important.' },
  ],
  '魚': [
    { jp: '金魚も飼ってるよ。', en: 'I have goldfish, too.' },
    { jp: '焼き魚が好きです。', en: 'I like grilled fish.' },
  ],
  '鳥': [
    { jp: 'ほら！あの木に小鳥がいる。', en: 'Look! There\'s a bird in that tree.' },
    { jp: '小鳥の囀りが聞こえます。', en: 'We can hear the bird sing.' },
  ],
  '黒': [
    { jp: '黒板に行きなさい。', en: 'Go to the blackboard.' },
    { jp: 'みんな、黒板に注目！', en: 'Look at the blackboard, everyone.' },
  ],
  '与': [
    { jp: 'ストライキは国民経済に影響を与えた。', en: 'The strike affected the nation\'s economy.' },
    { jp: '指導部の交代は、国際政治経済に重要な影響を与える。', en: 'Changes of leadership have a great effect on the international political economy.' },
  ],
  '両': [
    { jp: 'トムのご両親ですね？', en: 'You\'re Tom\'s parents, aren\'t you?' },
    { jp: '腰に両手を当てて。', en: 'Put your hands on your hips.' },
  ],
  '争': [
    { jp: '彼らはアメリカ南北戦争に負けました。', en: 'They had lost the Civil War.' },
    { jp: 'これは戦争犯罪だ。', en: 'This is a war crime.' },
  ],
  '互': [
    { jp: '２人の学生がお互い話し合っているだろう。', en: 'The two students will be talking to each other.' },
    { jp: 'このシステムのもとでは、生徒は交替で教えあい、お互いに助け合わなければなりません。', en: 'The basis of this system is that the students must take turns in teaching, they have to help each other.' },
  ],
  '亡': [
    { jp: '彼女は昨日の午後に亡くなった。', en: 'She died yesterday afternoon.' },
    { jp: '彼のお父さんは、彼の帰省後亡くなった。', en: 'His father died after his return home.' },
  ],
  '交': [
    { jp: 'トムは社会的交流が苦手だ。', en: 'Tom has trouble with social interactions.' },
    { jp: '異文化交流は大切だと思います。', en: 'I think that cultural exchanges are important.' },
  ],
  '他': [
    { jp: '遠くの親戚より近くの他人。', en: 'A stranger living nearby is better than a relative living far away.' },
    { jp: '他に何か必要ですか？', en: 'Do you need anything else?' },
  ],
  '付': [
    { jp: '今、日付変更線越えたって。', en: 'He said we just crossed the International Date Line.' },
    { jp: '名札は付けてたの？', en: 'Were you wearing a name tag?' },
  ],
  '件': [
    { jp: 'この件は終わった。', en: 'This matter is closed.' },
    { jp: '事件は幕を閉じた。', en: 'The case came to a close.' },
  ],
  '任': [
    { jp: '『メトロイドプライム3 コラプション』は、任天堂発売のWii専用ゲームソフト。', en: '"Metroid Prime 3: Corruption" is a videogame by Nintendo sold exclusively for the Wii.' },
  ],
  '似': [
    { jp: '鯨は魚と形が似ている。', en: 'Whales are similar to fishes in shape.' },
    { jp: 'その新しいドレス、すごく似合ってるよ。', en: 'Your new dress really looks good on you.' },
  ],
  '位': [
    { jp: '横浜市は、関東地方南部、神奈川県の東部に位置する都市で、同県の県庁所在地。', en: 'Yokohama is located in the eastern part of Kanagawa prefecture, of which it is the capital. The prefecture is situated in the southern part of the Kanto region.' },
    { jp: '彼は三位に入賞した。', en: 'He won the third prize.' },
  ],
  '余': [
    { jp: '今も、ときどき余震が発生しています。', en: 'Even now there are occasional aftershocks.' },
    { jp: '余談だが、この念発火能力のことをパイロキネシスというらしい。', en: 'By the by, this ability to will fire into existence is apparently called pyrokinesis.' },
  ],
  '例': [
    { jp: '上記の例をご覧ください。', en: 'See the example given above.' },
    { jp: '例えばどんな食べ物が好き？', en: 'What kind of food do you like, for example?' },
  ],
  '供': [
    { jp: '５月５日は子供の日です。', en: 'The 5th May is Children\'s Day.' },
    { jp: 'トムは子供のころ日本に来た。', en: 'Tom came to Japan as a child.' },
  ],
  '便': [
    { jp: '制汗性は便利です。', en: 'Antiperspirant is useful.' },
    { jp: 'それ、とても便利よ。', en: 'That\'s awfully convenient.' },
  ],
  '係': [
    { jp: 'ご関係者の方ですか？', en: 'Are you related?' },
    { jp: 'あれは関係あるかな？', en: 'Should that matter?' },
  ],
  '信': [
    { jp: 'お化けって信じる？', en: 'Do you believe in ghosts?' },
    { jp: '俺を信じるべきだ。', en: 'You ought to trust me.' },
  ],
  '倒': [
    { jp: 'あの会社は倒産した。', en: 'That company went bankrupt.' },
    { jp: 'その会社は倒産した。', en: 'The company went bankrupt.' },
  ],
  '候': [
    { jp: '気候が変わります。', en: 'The climate is changing.' },
    { jp: 'これは悪い兆候だ。', en: 'This is a bad sign.' },
  ],
  '値': [
    { jp: '彼の言うことは一言も聞くに値しない。', en: 'Not a word he says is worthy to be heard.' },
    { jp: '物の値段が上がっています。', en: 'Prices are going up.' },
  ],
  '偉': [
    { jp: 'いまだかつて偉大なもので熱烈な精神なくして成し遂げられたものは何もない。', en: 'Nothing great was ever achieved without enthusiasm.' },
    { jp: '彼女は自分の事業で偉大な成功を収めた。', en: 'She achieved great success in her business.' },
  ],
  '側': [
    { jp: '門のすぐ内側に犬がいた。', en: 'I found a dog just inside the gate.' },
    { jp: 'この扉は内側から施錠されている。', en: 'This door is locked from the inside.' },
  ],
  '偶': [
    { jp: 'この物語には偶然が多いです。', en: 'In this book, lots of coincidences happen.' },
    { jp: '１２は偶数である。', en: 'Twelve is an even number.' },
  ],
  '備': [
    { jp: '老後に備えようと誰でも考える。', en: 'Everybody thinks that they are ready for their old age.' },
    { jp: '私たちは老後に備えなければならない。', en: 'We must provide for our old age.' },
  ],
  '働': [
    { jp: 'ジョンはよく働く。', en: 'John works hard.' },
    { jp: '私は日曜日に働く。', en: 'I work on Sunday.' },
  ],
  '優': [
    { jp: 'トムは優しい子だ。', en: 'Tom is a kind boy.' },
    { jp: '彼女は彼に優しい。', en: 'She is kind to him.' },
  ],
  '光': [
    { jp: '蛍光ペン借りていい？', en: 'Can I borrow your highlighter?' },
    { jp: '君は世界の光だよ。', en: 'You are the light of the world.' },
  ],
  '全': [
    { jp: '町全体が水没した。', en: 'The entire town was under water.' },
    { jp: '全体的には、賛成よ。', en: 'On the whole, I agree with you.' },
  ],
  '共': [
    { jp: 'あの人と一夜を共にしたの？', en: 'Did you spend a night with that man?' },
    { jp: 'トムは太陽と共に起きます。', en: 'Tom rises with the sunrise.' },
  ],
  '具': [
    { jp: '道具を乱暴に扱うな。', en: 'Don\'t handle the tools roughly.' },
    { jp: '道具を粗末に使うな。', en: 'Don\'t handle these tools roughly.' },
  ],
  '内': [
    { jp: '後で詳しい内容を教えてくれ。', en: 'You can give me the details later.' },
    { jp: '計画に変更を加えたら、チーム・メンバーに変更内容を教える必要があります。', en: 'If you alter the plan, you must inform the team members of the changes.' },
  ],
  '冷': [
    { jp: '小泉首相は決して冷血漢ではない。', en: 'Prime Minister Koizumi is certainly not a cold-blooded man.' },
    { jp: 'あのバスって、冷暖房完備ですか？', en: 'Does that bus have air conditioning?' },
  ],
  '処': [
    { jp: '病院は何処ですか？', en: 'Where\'s the hospital?' },
    { jp: '本を全部処分した。', en: 'I disposed of all the books.' },
  ],
  '列': [
    { jp: '列車に間に合うかな？', en: 'Will we be in time for the train?' },
    { jp: '列車で来たんだよね？', en: 'You came by train, didn\'t you?' },
  ],
  '初': [
    { jp: '学校初日はどうだった？', en: 'How was your first day at school?' },
    { jp: '大学初日は、退屈で退屈で。', en: 'My first day of college was pretty boring.' },
  ],
  '判': [
    { jp: 'トムは評判が良い。', en: 'Tom has a good reputation.' },
    { jp: '彼女は評判が良い。', en: 'She has a good reputation.' },
  ],
  '利': [
    { jp: 'お利口な犬だこと！', en: 'What a clever dog!' },
    { jp: '利用方法を教えてください。', en: 'Please tell me how to use it.' },
  ],
  '到': [
    { jp: '職場に到着したよ。', en: 'I have arrived at work.' },
    { jp: '到着は何時ですか。', en: 'When does it arrive?' },
  ],
  '制': [
    { jp: '制限速度ってある？', en: 'Is there a speed limit?' },
    { jp: 'これは禁制品です。', en: 'This is contraband.' },
  ],
  '刻': [
    { jp: '時刻表はありますか？', en: 'Is there a timetable?' },
    { jp: 'そろそろ寝る時刻だ。', en: 'It\'s almost time to go to bed.' },
  ],
  '割': [
    { jp: '二人は伴侶三人は仲間割れ。', en: 'Two is company, but three is none.' },
    { jp: '二輪車が倒れずに走行するのには前輪が大きな役割を演じています。', en: 'The front wheel plays an important role in two-wheeled vehicles moving without falling over.' },
  ],
  '加': [
    { jp: '昨日の議論には参加しましたか。', en: 'Did you take part in the discussion yesterday?' },
    { jp: '１１月１日のパーティーに参加します。', en: 'I would like to attend the party on November 1st.' },
  ],
  '助': [
    { jp: 'ＳＯＳ！助けてくれ。', en: 'SOS, please help!' },
  ],
  '努': [
    { jp: '何か偉大なことを達成するためにはたゆまず努力しなければならない。', en: 'You must persevere before you can accomplish anything great.' },
    { jp: '入念な計画と努力の賜物です。', en: 'It is the fruit of hard work and a well-prepared plan.' },
  ],
  '労': [
    { jp: '万国の労働者よ、団結せよ！', en: 'Workers of all lands, unite!' },
    { jp: '労働者は祖国をもたない。', en: 'The workers do not have a fatherland.' },
  ],
  '務': [
    { jp: '任務完了しました。', en: 'Mission accomplished.' },
    { jp: 'まだ事務所にいるの？', en: 'Are you still in the office?' },
  ],
  '勝': [
    { jp: '大変だけど、勝つぞ！', en: 'It\'ll be hard, but we\'re going to win!' },
    { jp: 'ビルが勝つだろうね？', en: 'Bill will win, won\'t he?' },
  ],
  '勤': [
    { jp: '11月23日は勤労感謝の日で、勤労の大切さを伝えるために制定された祝日です。', en: 'November 23rd is Labor Thanksgiving Day, which was established as a national holiday to stress the importance of labor in people\'s minds.' },
    { jp: 'トムは今日、欠勤なの？', en: 'Is Tom absent today?' },
  ],
  '化': [
    { jp: '人々は変化を恐れる。', en: 'People are afraid of change.' },
    { jp: '社会が変化している。', en: 'Society is changing.' },
  ],
  '単': [
    { jp: '英単語って、幾つ習った？', en: 'How many English words did you learn?' },
    { jp: '英単語って、幾つ覚えてる？', en: 'How many English words do you know?' },
  ],
  '危': [
    { jp: 'キューバのミサイル危機によって世界は核戦争の瀬戸際に立たされた。', en: 'The Cuban Missile Crisis brought the world to the brink of nuclear war.' },
  ],
  '原': [
    { jp: '出火原因は何ですか？', en: 'What started the fire?' },
    { jp: 'その失敗の原因は何？', en: 'What is the cause of such a failure?' },
  ],
  '参': [
    { jp: 'ぜひご参加ください。', en: 'We encourage your participation.' },
    { jp: 'だれでも参加できる。', en: 'Anybody can participate.' },
  ],
  '収': [
    { jp: '収入が１０％減った。', en: 'My income has gone down by 10 percent.' },
    { jp: '領収書をください。', en: 'Please give me a receipt.' },
  ],
  '取': [
    { jp: '歴史ある建物を取り壊すことがあります。', en: 'Sometimes historic buildings get demolished.' },
    { jp: '財布を取られてしまいました。', en: 'My wallet was taken.' },
  ],
  '受': [
    { jp: 'コーヒー受け取った？', en: 'Did you get coffee?' },
    { jp: '全て受信されました？', en: 'Did you receive everything?' },
  ],
  '号': [
    { jp: '同日にアポロ１１号が月面着陸に成功した。', en: 'On the same day, Apollo 11 succeeded in landing on the moon\'s surface.' },
    { jp: '郵便番号って、なに？', en: 'What is a postal code?' },
  ],
  '向': [
    { jp: '私を川向うへ連れて行ってください。', en: 'Please take me across the river.' },
    { jp: '彼女の家は川の向こう側にある。', en: 'Her house is across the river.' },
  ],
  '君': [
    { jp: 'こんにちは！僕の名前はトム。君の名は？', en: 'Hi, my name is Tom. What is yours?' },
    { jp: '君の名前は、あった。', en: 'Your name was there.' },
  ],
  '否': [
    { jp: 'これも拒否された。', en: 'This was also refused.' },
    { jp: '拒否できなかった。', en: 'I couldn\'t deny it.' },
  ],
  '吸': [
    { jp: '口から息を吸って。', en: 'Breathe in through your mouth.' },
    { jp: '紙は水を吸います。', en: 'Paper absorbs water.' },
  ],
  '吹': [
    { jp: '彼はいつでも、どの方向に風が吹いているか言うことができた。', en: 'He could always tell which direction the wind was blowing.' },
    { jp: '吹雪に遭いました。', en: 'We were caught in a snowstorm.' },
  ],
  '告': [
    { jp: '神聖ローマ帝国は１８０６年に終わりを告げた。', en: 'The Holy Roman Empire came to an end in the year 1806.' },
    { jp: '広告は入れないで？', en: 'Could you not include ads?' },
  ],
  '呼': [
    { jp: '彼は私をピートと呼ぶ。', en: 'He calls me Pete.' },
    { jp: '彼女は僕を健二と呼ぶ。', en: 'She calls me Kenji.' },
  ],
  '命': [
    { jp: '生命は神秘に満ちている。', en: 'Life is full of mystery.' },
    { jp: '愛することは生命の源です。', en: 'Loving is the essence of life.' },
  ],
  '和': [
    { jp: '私は和食で育った。', en: 'I grew up eating Japanese food.' },
    { jp: '和食は好きですか。', en: 'Do you like Japanese food?' },
  ],
  '商': [
    { jp: 'それは人気商品だ。', en: 'This is a real popular item.' },
    { jp: '君は商売熱心だね。', en: 'You work hard.' },
  ],
  '喜': [
    { jp: 'あれ、喜ぶと思ったのに。', en: 'Hey, I thought you\'d be pleased.' },
    { jp: '彼は本当に喜ぶでしょう。', en: 'He will be really pleased.' },
  ],
  '回': [
    { jp: 'いや、これが二回目だ。', en: 'No, this is my second time.' },
    { jp: 'ここに来たのは3回目よ。', en: 'This is my third time here.' },
  ],
  '因': [
    { jp: '出火原因は何ですか？', en: 'What started the fire?' },
    { jp: 'その失敗の原因は何？', en: 'What is the cause of such a failure?' },
  ],
  '困': [
    { jp: '開き直られても困る。', en: 'Giving me an attitude won\'t solve anything.' },
    { jp: '冗談だと思われては困る。', en: 'Don\'t think I\'m joking.' },
  ],
  '園': [
    { jp: '公園はがらがらだ。', en: 'The park is empty.' },
    { jp: '公園で待ってるね。', en: 'I\'ll wait for you in the park.' },
  ],
  '在': [
    { jp: '在留資格認定証明書を貰って、ロンドンの日本大使館に来てください。', en: 'Upon receiving your Certificate of Eligibility, please come to the Japanese Embassy in London.' },
    { jp: '現在－１０℃です。', en: 'It is currently -10°C.' },
  ],
  '報': [
    { jp: 'ニュース速報です。', en: 'This is breaking news.' },
    { jp: '報告書を提出しました。', en: 'I submitted the report.' },
  ],
  '増': [
    { jp: '先進国では虫歯が激減し、自分の歯で一生食べられる人が増えています。', en: 'Cavities have become rarer in the developed countries and more people will be able to eat with their own teeth throughout their life.' },
    { jp: '離婚の増大の結果、夫婦間、親子間に大きな不安を生じさせることは間違いない。', en: 'It is certain that the increase of divorce will lead to anxiety between couples, parents and children.' },
  ],
  '声': [
    { jp: 'トムの歌声聞いた？', en: 'Did you hear Tom singing?' },
  ],
  '変': [
    { jp: '時代が変わると祈ろう。', en: 'Let\'s hope times change.' },
    { jp: '街が変われば人も変わる。', en: 'If a town changes, people will change too.' },
  ],
  '夢': [
    { jp: 'あなたが高層ビルから落ちる夢見ちゃった。', en: 'In my dream, I saw you falling from a tall building.' },
    { jp: '「あなたが高層ビルから落ちる夢見ちゃった」「おいおい。勝手に人を殺すなよ」', en: '"I had a dream where you fell off a skyscraper." "Whoa, don\'t be arbitrarily killing others now!"' },
  ],
  '太': [
    { jp: '太陽が昇ってるよ。', en: 'The sun is up.' },
    { jp: '太陽が顔を出した。', en: 'The sun came out.' },
  ],
  '失': [
    { jp: 'また気が向いたら「人間失格」読んでみよう。', en: 'If you feel like it, read "Ningen Shikkaku".' },
    { jp: '自分の失敗を認めろよ。', en: 'You should acknowledge your failure.' },
  ],
  '妻': [
    { jp: '彼の妻は自動車事故でけがをしたので入院している。', en: 'His wife is in the hospital because she was injured in a car crash.' },
    { jp: '妻にしょっちゅう小言を言われて、気が滅入りますよ。', en: 'My wife\'s constant nagging is getting me down.' },
  ],
  '娘': [
    { jp: '娘はいつも、約束を守らない母親に苛立っていた。', en: 'The daughter was irritated with her mother, who always broke her promises.' },
    { jp: 'トムの新しい奥様ってね、初婚の時の娘さんよりも若いのよ。', en: 'Tom\'s new wife is younger than his daughter from his first marriage.' },
  ],
  '婚': [
    { jp: '結婚生活がうまく行っていない方は結婚式の時におごそかに神の前に誓った、夫婦の誓約を思い出してみましょう。', en: 'And to the people whose married life is not going well, let\'s remember the marriage covenant sworn solemnly before God at the wedding ceremony.' },
    { jp: '大学を卒業するとすぐに彼女は結婚した。', en: 'On graduating from college, she got married.' },
  ],
  '婦': [
    { jp: '新婦のお父さんね、結婚式に遅れてきたのよ。', en: 'The bride\'s father arrived late to the wedding.' },
    { jp: '次の曲を、新郎と新婦に捧げたいと思います。', en: 'I\'d like to dedicate this next song to the bride and groom.' },
  ],
  '存': [
    { jp: '生存者はいますか？', en: 'Are there survivors?' },
    { jp: '彼の存在に気づきませんでした。', en: 'I did not notice his presence.' },
  ],
  '宅': [
    { jp: 'トムは宅建士です。', en: 'Tom is a real-estate agent specialist.' },
    { jp: 'お宅はどちらですか？', en: 'Where is your house?' },
  ],
  '守': [
    { jp: '１９９２年の選挙では保守党が勝利を収めた。', en: 'The Conservative Party won the election in 1992.' },
    { jp: 'メアリーは留守よ。', en: 'Mary\'s not at home.' },
  ],
  '完': [
    { jp: '投函完了、と。後は頼んだぞ、ポストマンよ。', en: 'Mailing complete. I leave the rest to you, postman!' },
    { jp: '最後の調整を完了するために五分ください。', en: 'Give me five minutes to finish the last adjustments.' },
  ],
  '官': [
    { jp: 'トムは警察官です。', en: 'Tom is a police officer.' },
    { jp: '警官みたいですね。', en: 'You look like a cop.' },
  ],
  '定': [
    { jp: 'ご結婚のご予定は？', en: 'When are you planning on getting married?' },
    { jp: '定期的に運動することが大切です。', en: "It's important to exercise regularly." },
  ],
  '客': [
    { jp: 'トムはお客さんです。', en: 'Tom is our guest.' },
    { jp: 'お客さん連れてきていい？', en: 'Is it OK if I bring a guest?' },
  ],
  '害': [
    { jp: '害になる薬もある。', en: 'Some medicine does us harm.' },
    { jp: '君に害は及ばないよ。', en: 'No harm will come to you.' },
  ],
  '容': [
    { jp: '減量は容易くない。', en: 'Losing weight isn\'t easy.' },
    { jp: '間食は美容に悪い。', en: 'Eating between meals is bad for the figure.' },
  ],
  '宿': [
    { jp: 'このビルは男女宿泊可のカプセルホテルです。', en: 'This building is a capsule hotel lodging men and women.' },
    { jp: '彼女は新宿まで歩いた。', en: 'She walked as far as Shinjuku.' },
  ],
  '寄': [
    { jp: '駅に立ち寄りますか？', en: 'Will you stop by the station?' },
    { jp: '近くに寄ってください。', en: 'Please come closer.' },
  ],
  '富': [
    { jp: 'その湖には魚が豊富にいる。', en: 'The lake abounds with fish.' },
    { jp: '彼女はどうやって魚に関する豊富な知識を身につけたのだろう。', en: 'How did she come to know so much about fish?' },
  ],
  '寒': [
    { jp: '南極は北極よりもずっと寒い。', en: 'The South Pole is a lot colder than the North Pole.' },
  ],
  '寝': [
    { jp: '彼は寝る前に目覚ましをかけた。', en: 'He set the alarm before going to bed.' },
    { jp: '早く寝ると体にいいよ。', en: 'Going to bed early is good for you.' },
  ],
  '察': [
    { jp: '警察に嘘をついた。', en: 'I lied to the cops.' },
    { jp: '状況を察してください。', en: 'Please read the situation.' },
  ],
  '対': [
    { jp: '民衆は国王に対して反乱を起こした。', en: 'People rose in revolt against the king.' },
    { jp: 'すべての文明国は戦争に反対している。', en: 'All civilized countries are against war.' },
  ],
  '局': [
    { jp: '市外局番もいるの？', en: 'Do I have to dial the area code, too?' },
    { jp: '郵便局まで送るよ。', en: 'I\'ll drive you to the post office.' },
  ],
  '居': [
    { jp: '最高裁判所は皇居の近くにある。', en: 'The Supreme Court is located near the Imperial Palace.' },
    { jp: '幸福人とは、 過去の自分の生涯から、満足だけを記憶して居る人々であり、 不幸人とは、それの反対を記憶して居る人々である。', en: 'Happy people are those who remember only the good things from the past, while unhappy people are those who remember only the opposite.' },
  ],
  '差': [
    { jp: '彼の馬は３馬身の差で勝った。', en: 'His horse won by three lengths.' },
    { jp: '花、元気ないわね。水をやりたいんだけど、水差しない？', en: 'The flowers don\'t look happy. I\'d like to water them. Is there a watering can?' },
  ],
  '市': [
    { jp: '市外局番もいるの？', en: 'Do I have to dial the area code, too?' },
    { jp: '市と町の違いは何？', en: 'What is the difference between \'city\' and \'town\'?' },
  ],
  '師': [
    { jp: '先生は私のよき師です。', en: 'My teacher is a good mentor to me.' },
    { jp: '美容師になりたいと思っています。', en: "I'm thinking of becoming a hairdresser." },
  ],
  '席': [
    { jp: '他に欠席者はいたの？', en: 'Was anybody else absent?' },
    { jp: 'よかったよ。欠席者はひとりもいなくて。', en: 'Good. No absentees.' },
  ],
  '常': [
    { jp: '遅刻の常習犯だよね？', en: 'He\'s always late, isn\'t he?' },
    { jp: 'やっぱり異常だよ。', en: 'As expected it\'s unusual.' },
  ],
  '平': [
    { jp: 'そのお金は彼ら二人で平等に分けられるでしょう。', en: 'The money will probably be split evenly between those two.' },
    { jp: '月曜日から金曜日の平日の間、午前9時から午後5時までです。', en: 'Weekdays Monday through Friday, from 9 a.m. to 5 p.m.' },
  ],
  '幾': [
    { jp: '幾らぐらいになる？', en: 'How much will it cost?' },
    { jp: '林檎は幾つですか？', en: 'How many apples are there?' },
  ],
  '座': [
    { jp: 'この講座では応急手当の基本的な技能を教えます。', en: 'This course teaches basic skills in first aid.' },
    { jp: '民衆の熱狂的な彼への支持は、首相の座にとどまりながらも大統領の権限の発揮を可能にしそうだ。', en: 'Having reached the rank of prime minister, and with the enthusiastic support of the masses, it seems he is able to wield presidential powers.' },
  ],
  '庭': [
    { jp: '綺麗なお庭ですね！', en: 'What a beautiful garden!' },
    { jp: '庭に犬はいないよ。', en: 'There\'s no dog in the yard.' },
  ],
  '式': [
    { jp: '結婚式はいつなの？', en: 'When\'s the wedding?' },
    { jp: '卒業式何着て行く？', en: 'What are you wearing to graduation?' },
  ],
  '引': [
    { jp: 'どこに引っ越すの？', en: 'Where are you moving to?' },
    { jp: '引っ越しの手伝いをしました。', en: 'I helped with the moving.' },
  ],
  '当': [
    { jp: '2012年に世界が終わるって本当？', en: 'Is it true that the world will end in 2012?' },
    { jp: 'あの事故って、本当に去年だった？', en: 'Did that accident really happen last year?' },
  ],
  '形': [
    { jp: 'あのお人形が欲しい！', en: 'I want that doll.' },
    { jp: 'それは日本人形だ。', en: 'That is a Japanese doll.' },
  ],
  '役': [
    { jp: '役に立ったと思う？', en: 'Do you think it helped?' },
    { jp: '役に立つと思うよ。', en: 'I think that would help.' },
  ],
  '彼': [
    { jp: '彼の安否が気がかりだ。', en: 'I\'m anxious about his safety.' },
    { jp: '彼は耳に鉛筆を挟んだ。', en: 'He stuck his pencil behind his ear.' },
  ],
  '徒': [
    { jp: '今のドイツでは、チョコレートケーキをうまく作るコツを知っている人の数よりも仏教徒の数の方が多い。', en: 'There are more Buddhists in Germany today than people who know how to make a good chocolate cake.' },
    { jp: 'トムはキリスト教徒だと思う。', en: 'I think that Tom is a Christian.' },
  ],
  '得': [
    { jp: '芸術作品の価値は、作品それ自体が変わらなくとも、作者によって提示されるアイデンティティーによって大きく変わり得る。', en: 'Even if a work of art does not change, its value can change depending on how the artist\'s identity is portrayed at an exhibition.' },
    { jp: '私の言語の限界とは、私の世界の限界のことである。私が知り得ることは私が語り得ることだけである。', en: 'The limits of my language are the limits of my mind. All I know is what I have words for.' },
  ],
  '御': [
    { jp: 'お安い御用ですよ。', en: 'No problem!' },
    { jp: '御婚約おめでとう。', en: 'Let me congratulate you on your engagement.' },
  ],
  '必': [
    { jp: '本当にこれって絶対必要なの？', en: 'Are you sure this is absolutely necessary?' },
    { jp: '軟木の絶縁された部屋およびよいヒーターはサウナのための絶対必要である。', en: 'An insulated soft-wood room and a good heater are the absolute necessities for a sauna.' },
  ],
  '忙': [
    { jp: '今日は、お忙しい中ありがとうございました。', en: 'Thank you for your time today.' },
    { jp: '彼は忙しい生活の中で家族と会うことがない。', en: 'He doesn\'t see his family in his busy life.' },
  ],
  '念': [
    { jp: '憲法記念日は、憲法の基本的精神である、国民主権、基本的人権の尊重、平和主義を再確認するための日です。', en: 'This is the day on which the Constitution\'s fundamental spirit, the sovereignty of the people, respect for fundamental human rights, and pacifism, are all reaffirmed.' },
  ],
  '怒': [
    { jp: 'トム！お母さん怒るよ！', en: 'Tom! Your mom is gonna be angry!' },
    { jp: 'そんなに怒るなよ。', en: 'Don\'t be so angry.' },
  ],
  '怖': [
    { jp: '広場恐怖症なんです。', en: 'I\'m agoraphobic.' },
    { jp: 'メアリーは男性恐怖症だ。', en: 'Mary is androphobic.' },
  ],
  '恐': [
    { jp: 'あなたが恐れているものは何ですか？', en: 'What are you afraid of?' },
    { jp: 'トムが最も恐れたのは、もう二度と歩けるようにならないのではないかということだった。', en: 'What scared Tom the most was the thought that he might not be able to walk again.' },
  ],
  '恥': [
    { jp: '聞くは一時の恥、聞かぬは一生の恥。', en: 'Nothing is lost for asking.' },
    { jp: 'こんなばかげた質問をするのはお恥ずかしい。', en: 'I\'m ashamed to ask you such a silly question.' },
  ],
  '息': [
    { jp: '息子はどこかしら？', en: 'Where\'s my son?' },
    { jp: '3人息子がいます。', en: 'I have three sons.' },
  ],
  '悲': [
    { jp: '他人の悲しみや喜びが本当にわかる人はいない。', en: 'No one really understands the grief or joy of another.' },
    { jp: '歓喜も悲嘆も永続はしない。', en: 'Neither delight nor sorrow is permanent.' },
  ],
  '情': [
    { jp: '盆栽は風情がある。', en: 'Bonsai trees are elegant.' },
    { jp: '情けなさすぎだろ。', en: 'I\'m overly miserable.' },
  ],
  '想': [
    { jp: 'トムね、無愛想だったよ。', en: 'Tom was unfriendly.' },
    { jp: '心配ご無用。すべて想定内です。', en: 'Don\'t worry. Everything is under control.' },
  ],
  '愛': [
    { jp: '隣人は愛するものだ。', en: 'We should love our neighbors.' },
    { jp: '愛することは生命の源です。', en: 'Loving is the essence of life.' },
  ],
  '感': [
    { jp: '11月23日は勤労感謝の日で、勤労の大切さを伝えるために制定された祝日です。', en: 'November 23rd is Labor Thanksgiving Day, which was established as a national holiday to stress the importance of labor in people\'s minds.' },
    { jp: '感謝の気持ちを伝えたいです。', en: 'I want to express my gratitude.' },
  ],
  '慣': [
    { jp: 'この男たちはきつい仕事に慣れている。', en: 'These men are used to hard work.' },
    { jp: '彼女は旅慣れている。', en: 'She is used to traveling.' },
  ],
  '戦': [
    { jp: '彼らはアメリカ南北戦争に負けました。', en: 'They had lost the Civil War.' },
  ],
  '戻': [
    { jp: '払い戻しを受けるには、商品は未開封のままご返送下さい。', en: 'For a refund, you must return the item unopened.' },
    { jp: '僕だったら、家に戻ってひと寝入りするよ。', en: 'If I were you, I\'d go home and take a nap.' },
  ],
  '所': [
    { jp: 'この場所が好きだ！', en: 'I love this place!' },
    { jp: '私の座る場所ある？', en: 'Is there any room for me?' },
  ],
  '才': [
    { jp: '彼は数学の天才だ。', en: 'He is a mathematical genius.' },
    { jp: 'メグは語学の才能がある。', en: 'Meg has a facility for languages.' },
  ],
  '打': [
    { jp: '出る杭は打たれる。', en: 'Envy is the companion of honour.' },
    { jp: '鉄は熱いうちに打て。', en: 'Strike while the iron is hot.' },
  ],
  '払': [
    { jp: '裁判所は、私に損害賠償として10万ドルの支払いを命じた。', en: 'The court ordered me to pay a hundred thousand dollars in damages.' },
    { jp: '出世払いで構わないよ。', en: 'I don\'t care about being paid back.' },
  ],
  '投': [
    { jp: '俺に投票してくれ！', en: 'Vote for me!' },
  ],
  '折': [
    { jp: '骨折はありません。', en: 'There are no broken bones.' },
    { jp: '私は足を骨折した。', en: 'I broke my leg.' },
  ],
  '抜': [
    { jp: 'ちょっとお間抜けな感じね。', en: 'It sounds a bit goofy.' },
    { jp: '栓抜きどこだろう？', en: 'Where\'s the bottle opener?' },
  ],
  '抱': [
    { jp: '赤ちゃんを抱っこしました。', en: 'I held the baby in my arms.' },
    { jp: '夢を抱いて頑張ってください。', en: 'Please keep going, holding onto your dreams.' },
  ],
  '押': [
    { jp: '社長の挨拶が長くて式の後半が押せ押せになってしまった。', en: 'The company president\'s welcome was so long that we were squeezed for time in the second half of the ceremony.' },
    { jp: 'もし彼の後押しがあったならば、彼女は市長に選ばれていただろう。', en: 'With his support, she might have been elected mayor.' },
  ],
  '招': [
    { jp: '彼女のお誕生日会に招待された？', en: 'Were you invited to her birthday party?' },
    { jp: 'トムはメアリーの誕生日会に招待されてた？', en: 'Was Tom invited to Mary\'s birthday party?' },
  ],
  '指': [
    { jp: '指輪を探してるの？', en: 'Are you looking for a ring?' },
  ],
  '捕': [
    { jp: '素手で魚が捕れる？', en: 'Can you catch fish with your bare hands?' },
    { jp: '警察が犯人を捕まえました。', en: 'The police caught the criminal.' },
  ],
  '掛': [
    { jp: '今日は出掛けるの？', en: 'Are you going out today?' },
    { jp: '明日は出掛けるの？', en: 'Are you going out tomorrow?' },
  ],
  '探': [
    { jp: '探検隊は南極への出発を延期した。', en: 'The expedition has postponed its departure to the Antarctic.' },
    { jp: '指輪を探してるの？', en: 'Are you looking for a ring?' },
  ],
  '支': [
    { jp: '彼は二十世紀最高のピアニストだと言って差し支えないでしょう。', en: 'It may safely be said that he is the greatest pianist of the twentieth century.' },
    { jp: '彼女は自分の著書の中で、彼の支援に感謝の言葉を述べた。', en: 'She acknowledged his help in her book.' },
  ],
  '政': [
    { jp: '政治家になりたい。', en: 'I want to become a politician.' },
    { jp: 'トムは政治家です。', en: 'Tom is a politician.' },
  ],
  '敗': [
    { jp: '彼は自分の敗因を私のせいだと責めた。', en: 'He accused me of his defeat.' },
    { jp: 'その失敗の原因は何？', en: 'What is the cause of such a failure?' },
  ],
  '散': [
    { jp: '国会は混乱のうちに散会した。', en: 'The Diet broke up in confusion.' },
    { jp: '会議は次週再開の予定で散会した。', en: 'The meeting was adjourned until the following week.' },
  ],
  '数': [
    { jp: '高等学校では英語と数学が重視されている。', en: 'English and mathematics are made much of in senior high schools.' },
    { jp: '英語が得意な人もいれば、数学が得意な人もいる。', en: 'Some are good at English, and others are good at mathematics.' },
  ],
  '断': [
    { jp: '僕だったら、断るな。', en: 'I\'d say no if I were you.' },
    { jp: 'トムは断ることができない。', en: 'Tom can\'t refuse.' },
  ],
  '易': [
    { jp: '減量は容易くない。', en: 'Losing weight isn\'t easy.' },
    { jp: '容易いことじゃない。', en: 'This isn\'t easy.' },
  ],
  '昔': [
    { jp: '太古の昔、恐竜は死に絶えた。', en: 'Dinosaurs became extinct a very long time ago.' },
    { jp: '人類は太古の昔から指を用いて食べ物を食してきたのである。', en: 'People have eaten with their fingers from the beginning of history.' },
  ],
  '昨': [
    { jp: '昨日の敵は今日の友。', en: 'An enemy yesterday can be a friend today.' },
    { jp: '一昨日風が吹いた。', en: 'Two days ago the wind blew.' },
  ],
  '晩': [
    { jp: '毎晩は飲まないよ。', en: 'I don\'t drink every evening.' },
    { jp: '毎晩ここにいるよ。', en: 'I\'m here every evening.' },
  ],
  '景': [
    { jp: 'この景色は絵になる。', en: 'This scenery is picturesque.' },
    { jp: '頂上からの景色は最高だね。', en: 'The view from the summit is very nice.' },
  ],
  '晴': [
    { jp: '明日は晴れると思う。', en: 'I think it will be sunny tomorrow.' },
    { jp: '明日は晴れるだろう。', en: 'It will be fine tomorrow.' },
  ],
  '暗': [
    { jp: '暗いのが苦手なの？', en: 'Are you afraid of the dark?' },
    { jp: '暗いのが苦手なの。', en: 'I don\'t like the dark.' },
  ],
  '暮': [
    { jp: 'トムはこの春から親元を離れて一人暮らしをしている。', en: 'Tom left his parents\' house this spring and has been living alone since then.' },
    { jp: 'この空模様から察すると、日暮れ前にひょっとしたら一雨降るかも知れません。', en: 'Judging from the look of the sky, we might have a shower before nightfall.' },
  ],
  '曲': [
    { jp: 'どんな曲を聴くの？', en: 'What kind of music do you listen to?' },
  ],
  '更': [
    { jp: '文を変更しました。', en: 'I changed the sentence.' },
    { jp: '計画に変更があります。', en: 'There has been a change of plans.' },
  ],
  '望': [
    { jp: 'あまり希望がない。', en: 'There is not much hope.' },
    { jp: 'HIV検査を希望しますか？', en: 'Would you like to be tested for HIV?' },
  ],
  '期': [
    { jp: '期間はどのくらい？', en: 'How long do you want it for?' },
    { jp: '期待しすぎるなよ。', en: 'Don\'t expect too much.' },
  ],
  '未': [
    { jp: '未来から来ました。', en: 'I come from the future.' },
    { jp: 'トムは未婚だった。', en: 'Tom wasn\'t married.' },
  ],
  '末': [
    { jp: 'この証明書は令和5年末まで有効です。', en: 'This certificate is valid until the end of 2023.' },
    { jp: '年末は猫の手も借りたいほど忙しくなる。', en: 'We become very shorthanded at the end of the year.' },
  ],
  '束': [
    { jp: '約束通り来てくれたんだな。', en: 'Ah, you came as promised.' },
    { jp: '時間通りに行くって、約束するよ。', en: 'I promise I\'ll be there on time.' },
  ],
  '杯': [
    { jp: '彼女はおなかが一杯になるまで、キャンデーを食べ続けた。', en: 'She ate candies one after another until she was completely full.' },
    { jp: '一杯やる時間ある？', en: 'Do you have time for a drink?' },
  ],
  '果': [
    { jp: 'リンゴは果物です。', en: 'An apple is a fruit.' },
    { jp: '果物はいかがですか？', en: 'Would you like some fruit?' },
  ],
  '格': [
    { jp: '在留資格認定証明書を貰って、ロンドンの日本大使館に来てください。', en: 'Upon receiving your Certificate of Eligibility, please come to the Japanese Embassy in London.' },
    { jp: 'また気が向いたら「人間失格」読んでみよう。', en: 'If you feel like it, read "Ningen Shikkaku".' },
  ],
  '様': [
    { jp: 'ユーモラスな話から気持ちの悪い話まで、前巻同様にいろいろなタイプの話が楽しめます。', en: 'From humorous to creepy stories, like the last volume, you can enjoy various types of stories.' },
  ],
  '権': [
    { jp: 'それは越権行為だ。', en: 'You are acting beyond your position.' },
    { jp: '彼は刑法の権威だ。', en: 'He is an authority on criminal law.' },
  ],
  '横': [
    { jp: '横にお掛けなさい。', en: 'Sit beside me.' },
    { jp: '毎朝線路を横切る。', en: 'I cross the rail tracks every morning.' },
  ],
  '機': [
    { jp: '紙飛行機の作り方、知ってる？', en: 'Do you know how to make paper airplanes?' },
  ],
  '欠': [
    { jp: 'メアリーは配慮に欠ける。', en: 'Mary is lacking in delicacy.' },
    { jp: '盛り上がりに欠ける試合だった。', en: 'The game lacked excitement.' },
  ],
  '欲': [
    { jp: 'トムは食欲旺盛だ。', en: 'Tom has a good appetite.' },
    { jp: '食欲がありません。', en: 'I have little appetite.' },
  ],
  '歳': [
    { jp: 'あの方は八十歳です。', en: 'He is eighty years old.' },
    { jp: 'もう何歳になりましたか？', en: 'How old are you now?' },
  ],
  '残': [
    { jp: '残念すぎる。何が何でも君に会いたいのに。', en: 'That\'s too bad. I really would love to see you.' },
    { jp: '残念ながら今夜の会合には出席できません。', en: 'I\'m afraid I won\'t be able to take part in the meeting tonight.' },
  ],
  '段': [
    { jp: '鳥居と言うと、階段を上がったところにあった赤いオブジェ？', en: 'By \'Torii\' you mean that red objet d\'art at the top of the steps?' },
    { jp: '階段って、普通に上るのと一段飛ばしで上るのとではどっちが体力使うんだろう。', en: 'I wonder whether it uses more energy to climb stairs normally or by skipping one stair with each step.' },
  ],
  '殺': [
    { jp: '私を殺す気ですか？', en: 'Do you want to kill me?' },
    { jp: '見つけ次第殺すぞ！', en: 'Once I find them, I\'ll kill them!' },
  ],
  '民': [
    { jp: '国民は重税に苦しんだ。', en: 'The people groaned under the burden of heavy taxation.' },
    { jp: '旗は国民のシンボルです。', en: 'A flag is a symbol of the nation.' },
  ],
  '求': [
    { jp: '死中に活を求める。', en: 'Find life amongst death.' },
    { jp: '君は彼に助言を求めるべきだ。', en: 'You ought to ask him for advice.' },
  ],
  '決': [
    { jp: '何するか決めたの？', en: 'Have you decided what you\'re going to do?' },
    { jp: 'まだ決めてないの？', en: 'Haven\'t you decided yet?' },
  ],
  '治': [
    { jp: '王様は長年ずっと国を統治している。', en: 'The king has reigned over the country for many years.' },
    { jp: 'その子は成長して偉大な政治家になった。', en: 'The boy grew up to be a great statesman.' },
  ],
  '泳': [
    { jp: '午後ひと泳ぎしよう。', en: 'Let\'s have a swim in the afternoon.' },
    { jp: 'プールでひと泳ぎした後は、とてもすっきりした気分だった。', en: 'I felt so refreshed after a swim in the pool.' },
  ],
  '洗': [
    { jp: 'トムは洗脳されている。', en: 'Tom has been brainwashed.' },
    { jp: '「マスコミに洗脳されやがって！」「何の話？」', en: '"You\'re being brainwashed by the media!" "What are you talking about?"' },
  ],
  '活': [
    { jp: '食生活を変えるべき？', en: 'Do I have to change my diet?' },
    { jp: '生活費が必要です。', en: 'Tom needs money to live.' },
  ],
  '流': [
    { jp: '流れる水は腐らず。', en: 'Flowing water does not stagnate.' },
    { jp: '血液は血管を流れる。', en: 'Blood flows through blood vessels.' },
  ],
  '浮': [
    { jp: '石は浮かびません。', en: 'A stone does not float.' },
    { jp: '浮気されたことある？', en: 'Have you ever been cheated on?' },
  ],
  '済': [
    { jp: 'これで気が済んだ？', en: 'Are you happy now?' },
    { jp: 'それで気が済んだ？', en: 'Are you satisfied?' },
  ],
  '渡': [
    { jp: '君に渡す物がある。', en: 'I have something to give you.' },
    { jp: '見渡す限り海だった。', en: 'There was nothing but the ocean as far as the eye could see.' },
  ],
  '港': [
    { jp: '空港はどこですか？', en: 'Where\'s the airport?' },
    { jp: '空港にはいつ着くの？', en: 'When will we reach the airport?' },
  ],
  '満': [
    { jp: '５歳未満の小人は、入場料は要りません。', en: 'There is no admission fee for children under five.' },
    { jp: '満天の星空の下、トムとメアリーは時間を忘れて夢を語り合った。', en: 'Below the starry sky, Tom and Mary forgot about time, recounting their dreams to each other.' },
  ],
  '演': [
    { jp: '面白い講演だった？', en: 'Was it an interesting speech?' },
    { jp: '開演は何時ですか。', en: 'What time does the play begin?' },
  ],
  '点': [
    { jp: '2021年、大坂なおみ選手は東京2020オリンピックの聖火台に点火しました。', en: 'Naomi Osaka lit the Olympic flame for the 2020 Tokyo Olympics in 2021.' },
    { jp: '原点を中心とする半径2の円と，直線 y = x − 1 の交点を求めよ。', en: 'Consider a circle of radius 2 centered at the origin. Find its points of intersection with the line y = x - 1.' },
  ],
  '然': [
    { jp: 'この村の住人は自然と共生している。', en: 'The people of this village live in harmony with nature.' },
    { jp: '地球は自然に発生した衛星を一つ有する。それは月だ。', en: 'Earth has one naturally occurring satellite, the Moon.' },
  ],
  '煙': [
    { jp: '煙突から黒い煙が出てきた。', en: 'Black smoke came out of the chimney.' },
  ],
  '犯': [
    { jp: '犯人はカナダ人でした。', en: 'The perpetrator was Canadian.' },
    { jp: '犯人は見つかったのかね？', en: 'Was the culprit found?' },
  ],
  '状': [
    { jp: '西部戦線異状なし', en: 'All quiet on the Western Front.' },
    { jp: '年賀状はもう全部書き終わった？', en: 'Have you written all the New Year\'s cards already?' },
  ],
  '猫': [
    { jp: '吾輩は子猫である。', en: 'I\'m a kitty cat.' },
    { jp: '子猫が大好きだよ。', en: 'I love kittens.' },
  ],
  '王': [
    { jp: '鷲は空の王者です。', en: 'The eagle is the king of the air.' },
    { jp: '国王は権力を奪われた。', en: 'The king was deprived of his power.' },
  ],
  '現': [
    { jp: '現在－１０℃です。', en: 'It is currently -10°C.' },
    { jp: '現実を受け入れてください。', en: 'Please accept reality.' },
  ],
  '球': [
    { jp: '今でも野球は得意？', en: 'Are you still good at baseball?' },
    { jp: 'テレビで野球見ない？', en: 'Do you want to watch the baseball game on TV?' },
  ],
  '産': [
    { jp: 'お土産何買ったの？', en: 'What kind of souvenirs did you buy?' },
    { jp: 'お土産は何買ったの？', en: 'What souvenirs did you buy?' },
  ],
  '由': [
    { jp: '理由聞いてもいい？', en: 'May I ask why?' },
    { jp: '自由に使ってください。', en: 'Please use it freely.' },
  ],
  '申': [
    { jp: '私は周と申します。', en: 'My surname is Zhou.' },
    { jp: 'メアリーと申します。', en: 'My name is Mary.' },
  ],
  '留': [
    { jp: '留学生の方ですか？', en: 'Are you an exchange student?' },
    { jp: '留学したいものだ。', en: 'I want to study abroad.' },
  ],
  '番': [
    { jp: '郵便番号って、全部で何個あるの？', en: 'How many postcodes are there in total?' },
    { jp: 'アドラステアは木星の３９個の衛星のうちの一つで、木星から２番目に近い衛星です。', en: 'Adrastea is one of the 39 satellites of Jupiter and is the second closest to Jupiter itself.' },
  ],
  '疑': [
    { jp: '文を書くときには、ふつう大文字で始め、ピリオド（.）、または感嘆符（!）、疑問符（?）、で終わる。', en: 'When writing a sentence, generally you start with a capital letter and finish with a period (.), an exclamation mark (!), or a question mark (?).' },
    { jp: '有意義な回答とは、新たな疑問を生むようなそれである。', en: 'The only useful answers are those that raise new questions.' },
  ],
  '疲': [
    { jp: '今は疲れ果てています。', en: 'I\'m very tired now.' },
    { jp: '彼は疲れ果ててしまった。', en: 'He has given out.' },
  ],
  '痛': [
    { jp: '深く息を吸うと、背中の右側に痛みが走るんです。', en: 'When I take a deep breath, a pain runs down the right side of my back.' },
    { jp: 'うわ、痛車をリアルに見たの、初めてかも。', en: 'Wow, I saw a car painted with anime characters for real. I think it\'s the first time.' },
  ],
  '登': [
    { jp: '山に登ったことある？', en: 'Have you ever climbed a mountain?' },
    { jp: '登山靴を買ったよ。', en: 'I bought a pair of hiking boots.' },
  ],
  '皆': [
    { jp: '抗議した者は皆職を失った。', en: 'Anyone who protested, lost his job.' },
    { jp: '医者や病院は、皆様の手助けをすべきです。', en: 'Doctors and hospitals should help everyone.' },
  ],
  '盗': [
    { jp: '卵を盗む奴は牛も盗む。', en: 'He that will steal an egg will steal an ox.' },
    { jp: 'お金を盗むのは良くない。', en: 'It is wrong to steal money.' },
  ],
  '直': [
    { jp: '彼女と仲直りした。', en: 'I made up with her.' },
    { jp: '彼女は正直だと思う。', en: 'I think that she\'s honest.' },
  ],
  '相': [
    { jp: '外相はもう到着されましたか？', en: 'Has the Foreign Secretary arrived yet?' },
    { jp: '外相は、戦争は避けられないと言った。', en: 'The Foreign Minister said that war was inevitable.' },
  ],
  '眠': [
    { jp: '眠るな。眠ったら死ぬぞ。', en: 'Don\'t fall asleep. If you fall asleep, you\'ll die.' },
    { jp: 'どんな体勢で眠るのが好き？', en: 'What position do you like sleeping in?' },
  ],
  '石': [
    { jp: 'トムは石油で財を成した。', en: 'Tom made a fortune in oil.' },
    { jp: 'アラビアは石油が豊富だ。', en: 'Arabia abounds in oil.' },
  ],
  '破': [
    { jp: 'ルールは破るためにあるんだ。', en: 'Rules are made to be broken.' },
    { jp: '何をしても扉を破ることできない。', en: 'Whatever I do, I can\'t break the door.' },
  ],
  '確': [
    { jp: '問題です。標的を狙う正確性を競う種目で、オリンピック種目にもなっている競技はなんでしょう。', en: 'Here\'s the question: Which sport is a target-based accuracy competition and is also an Olympic event?' },
    { jp: '仕事場の管理者は、正確さ、効率性、献身を期待する。', en: 'Office managers expect accuracy, efficiency, and dedication.' },
  ],
  '示': [
    { jp: 'そっちの指示に従うよ。', en: 'I\'ll follow your instructions.' },
    { jp: 'いちいち指示するの止めてよ。', en: 'Stop ordering me around.' },
  ],
  '礼': [
    { jp: '失礼ですが......。', en: 'May I ask who\'s calling?' },
    { jp: '失礼なコメントね！', en: 'What a rude comment!' },
  ],
  '祖': [
    { jp: '祖父は９０歳代である。', en: 'My grandfather is in his nineties.' },
    { jp: '祖父は非常に健康だ。', en: 'My grandfather is very healthy.' },
  ],
  '神': [
    { jp: '神様を信じている？', en: 'Do you believe in God?' },
    { jp: '京都は神社や仏閣で有名だ。', en: 'Kyoto is famous for its shrines and temples.' },
  ],
  '福': [
    { jp: 'トムは裕福な男だ。', en: 'Tom is a rich man.' },
    { jp: '私たちは幸福です。', en: 'We are happy.' },
  ],
  '科': [
    { jp: '彼は歯科医師です。', en: 'He is a dentist.' },
    { jp: 'トムは脳外科医だ。', en: 'Tom is a brain surgeon.' },
  ],
  '程': [
    { jp: '「天路歴程」が気に入ったので、私が最初に集めたのは小さい分冊本のジョン・バニヤン著作集だった。', en: 'Pleased with The Pilgrim\'s Progress, my first collection was of John Bunyan\'s works in separate little volumes.' },
    { jp: 'シュレーディンガー方程式は量子力学系の時間発展を記述する。', en: 'Schrodinger\'s equation describes the time evolution of quantum mechanics.' },
  ],
  '種': [
    { jp: '普段飲むお酒の種類は何ですか？', en: 'What kind of alcohol do you usually drink?' },
    { jp: 'パンの種類を3つ挙げてみて。', en: 'Name three types of bread.' },
  ],
  '積': [
    { jp: '見積もりはもらった？', en: 'Did you get an estimate?' },
    { jp: '微積分なんか大っ嫌い。', en: 'I hate calculus.' },
  ],
  '突': [
    { jp: '突然寒くなったね！', en: 'It has suddenly got cold, hasn\'t it?' },
    { jp: '彼は突然出発した。', en: 'He made an abrupt departure.' },
  ],
  '窓': [
    { jp: '風がとても強かったので、窓ががたがた音をたてた。', en: 'The wind was so strong that the windows rattled.' },
    { jp: '赤ちゃんが風邪をひくといけないので、私は窓を閉めた。', en: 'I closed the window for fear that the baby should catch cold.' },
  ],
  '笑': [
    { jp: 'あの子よく笑うね。', en: 'She smiles a lot.' },
    { jp: '笑う門には福来る。', en: 'Fortune comes in by a merry gate.' },
  ],
  '等': [
    { jp: '人間は全て平等である。', en: 'All men are equal.' },
    { jp: '等しく扱われる権利がある。', en: 'Everyone has the right to equal treatment.' },
  ],
  '箱': [
    { jp: 'どっちの箱がいい？', en: 'Which box do you like better?' },
    { jp: '引越しの荷物を箱に詰めました。', en: 'I packed my moving belongings into boxes.' },
  ],
  '米': [
    { jp: 'お米は残ってるの？', en: 'Is there any rice left?' },
    { jp: '米国は大きな国だ。', en: 'The United States is a large country.' },
  ],
  '精': [
    { jp: '精神分析って何ですか？', en: 'What is psychoanalysis?' },
    { jp: 'トムは精神的に乱れた。', en: 'Tom fell apart.' },
  ],
  '組': [
    { jp: '来年に延期された東京オリンピックの組織委員会は、新型コロナの感染拡大を防ぐための対策を講じる予定です。', en: 'Organizers of next year’s rescheduled Tokyo Olympics will have measures in place to limit the spread of COVID-19.' },
    { jp: 'さい1組持ってる？', en: 'Do you have a pair of dice?' },
  ],
  '経': [
    { jp: '３０年が経ちました。', en: 'Thirty years passed.' },
    { jp: '経験はありません。', en: 'I have no experience.' },
  ],
  '給': [
    { jp: '私は過去3年間、給料の4分の1を貯金しています。', en: 'I have put aside one fourth of my salary for the last three years.' },
    { jp: '１年たったらあなたが昇給するように取り計らいましょう。', en: 'I\'ll see to it that you have a raise after the first year.' },
  ],
  '絵': [
    { jp: '絵を描くのは好き？', en: 'Do you like to draw?' },
    { jp: '絵を描くのは得意？', en: 'Are you good at drawing pictures?' },
  ],
  '絶': [
    { jp: '細菌などから隔離するため、面会謝絶となっています。', en: 'In order to isolate him from bacteria, and such, he is not allowed visitors.' },
    { jp: '彼は絶対的な権力を持っている。', en: 'He has absolute power.' },
  ],
  '続': [
    { jp: '読書を続けるつもりです。', en: 'I plan to keep reading.' },
    { jp: '毎日続けることが大切です。', en: 'It is important to keep going every day.' },
  ],
  '緒': [
    { jp: '内緒にしといてね。', en: 'Please keep it secret.' },
    { jp: 'トムには内緒だよ。', en: 'Don\'t tell Tom.' },
  ],
  '罪': [
    { jp: 'これは戦争犯罪だ。', en: 'This is a war crime.' },
    { jp: '児童虐待は犯罪です。', en: 'Child abuse is a crime.' },
  ],
  '置': [
    { jp: 'どこに置いたっけ？', en: 'Where did I put it?' },
    { jp: '鍵どこに置いたっけ？', en: 'Where did I put the keys?' },
  ],
  '老': [
    { jp: '老人が近づいてきた。', en: 'The old man approached.' },
    { jp: 'あの老人は誰ですか。', en: 'Who is that old man?' },
  ],
  '耳': [
    { jp: '耳鳴りがしますか？', en: 'Do you have ringing in your ears?' },
    { jp: 'ぶたれて耳鳴りがした。', en: 'My ears were ringing from being beaten.' },
  ],
  '職': [
    { jp: 'ご職業は何ですか。', en: 'What do you do?' },
    { jp: '彼の職業は医師だ。', en: 'He is a doctor by profession.' },
  ],
  '育': [
    { jp: 'ミルクは赤ん坊を育てる', en: 'Milk makes kids grow.' },
    { jp: '花を育てるのが好きなんです。', en: 'I like to grow flowers.' },
  ],
  '背': [
    { jp: '君って背が高いの？', en: 'Are you tall?' },
    { jp: 'トムって背は高い？', en: 'Is Tom tall?' },
  ],
  '能': [
    { jp: '理論上は可能です。', en: 'In theory, it\'s possible.' },
    { jp: '両方とも可能です。', en: 'Both are possible.' },
  ],
  '腹': [
    { jp: '腹を立てるだけ損よ。', en: 'It doesn\'t pay to lose your temper.' },
    { jp: '彼はすぐに腹を立てる。', en: 'He loses his temper quite easily.' },
  ],
  '舞': [
    { jp: '入学して１か月・・・まだ一人も友達がいないってのはやばすぎる。このままじゃ中学の二の舞だ！！', en: 'One month since entering high school ... not a single friend yet. That\'s really terrible, at this rate it will be middle-school all over again!!' },
    { jp: '『カムイの剣』は、1868年の徳川将軍時代の崩壊と、明治天皇下での日本の復興という変革期を舞台にした、一種の侍/忍者物語だ。', en: 'Kamui no Ken was a sort of samurai/ninja story set during the transition of the fall of the Tokugawa Shogunate and the re-establishment of Japan under the Emperor Meiji in 1868.' },
  ],
  '船': [
    { jp: 'こちらが船長です。', en: 'This is the captain.' },
    { jp: 'それは私の船です。', en: 'It\'s my ship.' },
  ],
  '良': [
    { jp: '良質の建材が不足している。', en: 'There is a shortage of good building wood.' },
    { jp: 'カナダは良質の小麦を生産する。', en: 'Canada produces good wheat.' },
  ],
  '若': [
    { jp: '苗は若い植物です。', en: 'Seedlings are young plants.' },
    { jp: '私が一番若いです。', en: 'I\'m the youngest.' },
  ],
  '苦': [
    { jp: '夏の夜は寝苦しい。', en: 'We cannot sleep well on summer nights.' },
    { jp: 'この部屋は狭苦しい。', en: 'This room is cramped.' },
  ],
  '草': [
    { jp: '百合は宿根草です。', en: 'Lilies are perennial plants.' },
    { jp: '草原を歩くのが好きです。', en: 'I like walking through the meadows.' },
  ],
  '落': [
    { jp: 'あなたが高層ビルから落ちる夢見ちゃった。', en: 'In my dream, I saw you falling from a tall building.' },
    { jp: '「あなたが高層ビルから落ちる夢見ちゃった」「おいおい。勝手に人を殺すなよ」', en: '"I had a dream where you fell off a skyscraper." "Whoa, don\'t be arbitrarily killing others now!"' },
  ],
  '葉': [
    { jp: '向こうではセレブという言葉を「金持ち」の意味では使わない。という事で日本人と判明しました。', en: 'They don\'t use \'celeb\' to mean \'rich man\' over there. By which I determine that you are Japanese.' },
    { jp: 'お言葉ですが......。', en: 'With all due respect.' },
  ],
  '薬': [
    { jp: '薬局へ行って薬を買う。', en: 'I go to the pharmacy and buy medicine.' },
    { jp: 'この近くに薬局はありますか？', en: 'Is there a pharmacy nearby?' },
  ],
  '術': [
    { jp: '手術が必要ですか？', en: 'Am I going to need surgery?' },
    { jp: '手術は成功したよ。', en: 'The operation was successful.' },
  ],
  '表': [
    { jp: '地図の青い線は川を表す。', en: 'The blue lines on the map represent rivers.' },
    { jp: 'この線は経度を表している。', en: 'This line represents the longitude.' },
  ],
  '要': [
    { jp: '最近では、故人が亡くなってから７日目に行う初七日法要を葬儀当日に済ませることが多くなっています。', en: 'It has recently become common to hold the Buddhist seventh-day memorial service on the same day as the funeral.' },
    { jp: 'なんで、文法がそんなに重要なの？', en: 'Why is grammar so important?' },
  ],
  '規': [
    { jp: '定規で線を書いて。', en: 'Draw a line with a ruler.' },
    { jp: '君は規則を破った。', en: 'You broke the rule.' },
  ],
  '覚': [
    { jp: '彼は寝る前に目覚し時計をあわせた。', en: 'He set the alarm before going to bed.' },
    { jp: '目覚し時計が鳴らなかったので寝過ごしてしまった。', en: 'I overslept because my alarm didn\'t go off.' },
  ],
  '観': [
    { jp: 'どの映画を観るの？', en: 'Which film are you going to see?' },
    { jp: '観光で京都に来ました。', en: 'I came to Kyoto for sightseeing.' },
  ],
  '解': [
    { jp: '理解してるんだよね？', en: 'You understand, don\'t you?' },
    { jp: '数学が理解できない。', en: 'I can\'t understand Maths.' },
  ],
  '記': [
    { jp: '日記をつけてるの？', en: 'Do you keep a journal?' },
    { jp: '俺の日記を読むな！', en: 'Don\'t read my diary.' },
  ],
  '訪': [
    { jp: '明日彼を訪問します。', en: 'I\'ll call on him tomorrow.' },
    { jp: '京都を訪問するべきだよ。', en: 'You should visit Kyoto.' },
  ],
  '許': [
    { jp: '彼には気を許すな。', en: 'Be on your guard against him.' },
    { jp: '過つは人、許すは神。', en: 'To err is human, to forgive divine.' },
  ],
  '認': [
    { jp: '在留資格認定証明書を貰って、ロンドンの日本大使館に来てください。', en: 'Upon receiving your Certificate of Eligibility, please come to the Japanese Embassy in London.' },
    { jp: 'これ確認してみて。', en: 'Check this.' },
  ],
  '誤': [
    { jp: 'それは誤解ですよ。', en: 'You are mistaken about that.' },
    { jp: '誤解しないでくれ。', en: 'Don\'t get me wrong.' },
  ],
  '説': [
    { jp: 'トムは薬の副作用の説明を聞いて不安になった。', en: 'Tom got worried when he learnt about the medicine\'s side effects.' },
  ],
  '調': [
    { jp: '体調はいかがですか？', en: 'How are you feeling?' },
    { jp: '体の調子がよくありません。', en: 'I am not feeling well.' },
  ],
  '談': [
    { jp: 'ストレスを解消するための方法は男性と女性とでは異なる。男性が使う主な手段は飲酒であるが、女性は雑談によってストレスを処理している。', en: 'The methods used to overcome stress are different for men and women: drinking is the major method used by men, while women deal with stress by chatting.' },
    { jp: '青河氏は講談社児童文学新人賞佳作を受賞する。', en: 'Aoga receives an honourable mention at the Kodansha Award for New Writers of Children’s Literature.' },
  ],
  '論': [
    { jp: '人間は非論理的です。', en: 'Humans are illogical.' },
    { jp: '誰一人、自分が間違っていることを認めようとしなかったので、議論は延々と続いた。', en: 'The argument lasted a long time because nobody would admit to being in the wrong.' },
  ],
  '識': [
    { jp: '意識がありません。', en: 'She is unconscious.' },
    { jp: '無意識にしちゃってたの。', en: 'I did it without thinking.' },
  ],
  '議': [
    { jp: '会議はどうだった？', en: 'How was your meeting?' },
  ],
  '負': [
    { jp: '試合に負けてしまいました。', en: 'I lost the match.' },
    { jp: '責任を負うのが大人です。', en: 'Taking responsibility is what adults do.' },
  ],
  '財': [
    { jp: 'ヤバイ！財布忘れた！', en: 'By Jove! I forgot my wallet!' },
    { jp: '財布をなくしたの。', en: 'I have lost my wallet.' },
  ],
  '貧': [
    { jp: '私は貧しい男です。', en: 'I am a poor man.' },
    { jp: '私は貧しい農民に過ぎない。', en: 'I am nothing but a poor peasant.' },
  ],
  '責': [
    { jp: '責任逃れをするな。', en: 'Don\'t try to pass the buck.' },
    { jp: '彼が販売部の責任者だ。', en: 'He\'s in charge of the sales department.' },
  ],
  '費': [
    { jp: '生活費が必要です。', en: 'Tom needs money to live.' },
    { jp: '浪費は欠乏のもと。', en: 'Waste makes want.' },
  ],
  '資': [
    { jp: '在留資格認定証明書を貰って、ロンドンの日本大使館に来てください。', en: 'Upon receiving your Certificate of Eligibility, please come to the Japanese Embassy in London.' },
    { jp: '資金が底をついた。', en: 'Our money ran out.' },
  ],
  '賛': [
    { jp: '循環論法すれば賞賛を浴るのは哲学だけです。', en: 'Only in philosophy can you use a circular argument and get praised for it.' },
    { jp: 'トムに大賛成です。', en: 'I completely agree with Tom.' },
  ],
  '越': [
    { jp: 'どうにか乗り越えるよ。', en: 'I\'ll get over it somehow.' },
    { jp: 'スポーツは国境を越える。', en: 'Sport transcends borders.' },
  ],
  '路': [
    { jp: '道路を渡りました。', en: 'We crossed the road.' },
    { jp: '道路地図を下さい。', en: 'May I have a road map?' },
  ],
  '辞': [
    { jp: 'Tatoebaは辞書だ。', en: 'Tatoeba is a dictionary.' },
    { jp: '辞書借りてもいい？', en: 'May I borrow your dictionary?' },
  ],
  '込': [
    { jp: '奨学金を申し込むつもりだよ。', en: 'I am going to apply for a scholarship.' },
    { jp: 'その奨学金に申し込むつもりです。', en: 'I\'m going to apply for the scholarship.' },
  ],
  '迎': [
    { jp: 'ボストンで迎える初めての春です。', en: 'This is my first spring in Boston.' },
    { jp: '女子は10〜11歳前後、男子は11〜12歳前後で思春期を迎える。', en: 'Girls begin puberty around the ages of ten to eleven, and boys around the ages of eleven to twelve.' },
  ],
  '返': [
    { jp: 'いつも授業をサボって友人に代返を頼むような人は嫌いです。', en: 'I hate those who always skip class and ask their friends to answer the roll call for them.' },
    { jp: '彼女は横柄に私に代わって返事した。', en: 'She arrogantly answered in my place.' },
  ],
  '迷': [
    { jp: 'どれにするか迷うなぁ。', en: 'I\'m not sure which one to choose.' },
    { jp: '彼はどこへ行っても道に迷う。', en: 'He gets lost wherever he goes.' },
  ],
  '追': [
    { jp: 'GPSで追跡した。', en: 'I tracked it via GPS.' },
    { jp: 'GPSで追跡する。', en: 'I track it with GPS.' },
  ],
  '逃': [
    { jp: '責任逃れをするな。', en: 'Don\'t try to pass the buck.' },
    { jp: '逃げるは恥だが、役に立つ。', en: 'Running away is shameful, but it\'s useful.' },
  ],
  '途': [
    { jp: '家に帰る途中なの？', en: 'Are you on your way home?' },
    { jp: '駅に行く途中なの。', en: 'I\'m on my way to the station.' },
  ],
  '速': [
    { jp: 'トムは私より速い。', en: 'Tom is faster than me.' },
    { jp: '脈拍が少し速いね。', en: 'Your pulse is a little fast.' },
  ],
  '連': [
    { jp: '彼から連絡あった？', en: 'Has anyone heard from him?' },
    { jp: '子どもを学校に連れていきました。', en: 'I took my child to school.' },
  ],
  '進': [
    { jp: '昇進が気になるの？', en: 'Are you worried about the promotion?' },
    { jp: 'これは10進数です。', en: 'This is a decimal number.' },
  ],
  '遅': [
    { jp: '今年は秋が遅いね。', en: 'Fall is late this year.' },
    { jp: '私のパソコン遅い。', en: 'My computer is slow.' },
  ],
  '遊': [
    { jp: '僕のカードで遊ぶ？', en: 'Do you want to play with my credit card?' },
    { jp: '僕と遊ぶの嫌なの？', en: 'Do you hate playing with me?' },
  ],
  '過': [
    { jp: '歴史は過去を扱う。', en: 'History deals with the past.' },
    { jp: 'すべて過去のことです。', en: 'It\'s all in the past.' },
  ],
  '違': [
    { jp: 'それは法律違反です。', en: 'That\'s against the law.' },
    { jp: 'それはルール違反です。', en: 'It\'s against the rules.' },
  ],
  '適': [
    { jp: 'この部屋、快適だよ。', en: 'This room is comfortable.' },
    { jp: '理に適ってると思う。', en: 'I think it makes sense.' },
  ],
  '選': [
    { jp: '今週は参議院選挙が開かれる。', en: 'The house of councillors election opens this week.' },
    { jp: 'オリンピック選手は、大会期間中は選手村で生活します。', en: 'Olympic athletes live in the Olympic village for the duration of the games.' },
  ],
  '都': [
    { jp: 'どこが都合がいい？', en: 'Where\'s convenient for you?' },
    { jp: '東京は巨大都市だ。', en: 'Tokyo is a very big city.' },
  ],
  '配': [
    { jp: '緊急配送には、１０ドル追加料金がかかります。', en: 'Expedited delivery will cost an additional ten dollars.' },
    { jp: '空港まで迎えの車を出すように手配した。', en: 'I arranged for a car to meet you at the airport.' },
  ],
  '酒': [
    { jp: '酒豪女は嫌いです。', en: 'I don\'t like heavy drinkers.' },
    { jp: '酒飲みの女は嫌だ。', en: 'I don\'t like women who drink too much.' },
  ],
  '閉': [
    { jp: '門を閉める時間だ。', en: 'It is time to shut the gate.' },
    { jp: '窓閉めるの忘れてた。', en: 'I forgot to close the windows.' },
  ],
  '関': [
    { jp: 'ご関係者の方ですか？', en: 'Are you related?' },
    { jp: '玄関に誰かいるよ。', en: 'There\'s someone at the door.' },
  ],
  '降': [
    { jp: 'ゆうべ霜が降りた。', en: 'It frosted last night.' },
    { jp: '道路に霜が降りています。', en: 'There is frost on the road.' },
  ],
  '限': [
    { jp: '私の知っている限りでは、彼はなまけ者ではない。', en: 'So far as I know, he is not lazy.' },
    { jp: '私の知っている限りでは、そういうことはありませんね。', en: 'Not that I know of.' },
  ],
  '除': [
    { jp: '買い物と、家の掃除、それから夕ご飯作ってあげるね。', en: 'I\'ll do your shopping, clean up the house, and cook your dinner for you.' },
    { jp: 'アンダーソン一家を除いてみんな次の木曜の夕方パーティーに出かけます。', en: 'Everybody except the Anderson family is going to the party next Thursday evening.' },
  ],
  '険': [
    { jp: '火は危険なのです。', en: 'Fire is dangerous.' },
    { jp: '兄が邪険にされた。', en: 'My older brother was treated cruelly.' },
  ],
  '陽': [
    { jp: '太陽が昇ってるよ。', en: 'The sun is up.' },
    { jp: '太陽が顔を出した。', en: 'The sun came out.' },
  ],
  '際': [
    { jp: '実際は何があったの？', en: 'What actually happened?' },
    { jp: '国際的な問題ですね。', en: 'It\'s an international issue.' },
  ],
  '雑': [
    { jp: '新聞や雑誌の投書欄を読みます。', en: 'I read the reader\'s column in newspapers and magazines.' },
    { jp: '実はこの頃婦人雑誌に書きたいと思っている小説があるのです。', en: 'The truth is, these days, I\'m thinking of writing a novel for a women\'s magazine.' },
  ],
  '難': [
    { jp: 'とても困難だった。', en: 'It was very difficult.' },
    { jp: '困難があってこその僕。', en: 'I am my struggles.' },
  ],
  '雪': [
    { jp: 'その小道はもう雪で真っ白です。', en: 'The path is already completely covered with snow.' },
    { jp: '小屋の屋根は雪の重みでミシミシと音を立てた。', en: 'The roof of the hut groaned under the weight of the snow.' },
  ],
  '静': [
    { jp: '突然に玄関のベルが鳴って、一人の黒い男性の影が静かに辷り込んで来ました。', en: 'All of a sudden, the front door bell rang and the dark shadow of a lone man slipped in quietly.' },
    { jp: '二人とも静かにしなさい。', en: 'Both of you be quiet.' },
  ],
  '非': [
    { jp: 'トムは非論理的だ。', en: 'Tom is illogical.' },
    { jp: 'それは非現実的だ。', en: 'That\'s unreal.' },
  ],
  '面': [
    { jp: '特にこの場面が好きですねえ。', en: 'I like this scene in particular.' },
    { jp: 'その場面をスローモーションで見たいな。', en: 'I want to see the scene in slow motion.' },
  ],
  '靴': [
    { jp: 'マットで靴を拭きなさい。', en: 'Wipe your shoes on the mat.' },
    { jp: '新しい靴を買いました。', en: 'I bought new shoes.' },
  ],
  '頂': [
    { jp: '山頂は雲で隠れている。', en: 'The mountaintops are hidden by clouds.' },
    { jp: '山頂の空気はとても薄かった。', en: 'The air on top of the mountain was very thin.' },
  ],
  '頭': [
    { jp: '残っているのは冒頭の部分だけであった。', en: 'All that was left was the opening.' },
    { jp: '残念ながら君の演じる役は演劇の冒頭で殺されるのだ。', en: 'It\'s too bad, but your character gets killed at the start of the play.' },
  ],
  '頼': [
    { jp: '彼女は魅力的で頼りになる人です。', en: 'She is a charming and reliable person.' },
    { jp: '苦しいときの神頼み。', en: 'Danger past, God forgotten.' },
  ],
  '顔': [
    { jp: '顔は見えないけど、いてくれるだけで本当に嬉しい。', en: 'I don\'t know what you look like, but I love that you\'re there.' },
    { jp: 'まあまあなんて細い腰なの！お顔も小さくて、本当にお人形さんみたい！', en: 'My what a narrow waist! Her face is small, she really looks just like a doll!' },
  ],
  '願': [
    { jp: 'お願いだから静かにして！音を立てないで。', en: 'Be quiet, please! Don\'t make a sound.' },
    { jp: '立って、自己紹介をお願いします。', en: 'Stand up and introduce yourself, please.' },
  ],
  '類': [
    { jp: '人間は哺乳類です。', en: 'Humans are mammals.' },
    { jp: '俺たちは同類だよ。', en: 'We are cut from the same cloth.' },
  ],
  '飛': [
    { jp: '見て！空飛ぶ円盤よ！', en: 'Look! A flying saucer!' },
    { jp: '蜂は花から花に飛ぶ。', en: 'Bees fly from flower to flower.' },
  ],
  '首': [
    { jp: '首が少し痛いです。', en: 'My neck is a bit sore.' },
    { jp: '首が少し痛いんだ。', en: 'My neck is a little sore.' },
  ],
  '馬': [
    { jp: '鞍馬は、力よりもバランス感覚が必要です。', en: 'The pommel horse requires more balance than strength.' },
    { jp: '彼は自分の語学力の源として、幼少期からたくさんの競走馬の名前を覚えていたことを挙げた。', en: 'He gave his remembering of race horse names when he was a child as the source of his language ability.' },
  ],
  '髪': [
    { jp: '十分間の休憩を与えられ、乱れた髪を結い直し、肩の汗をぬぐって、支度部屋で呼吸を整える。', en: 'Granted a ten-minute break, he enters the dressing room to tie his messy hair, wipe the sweat from his shoulders, and take control of his breathing.' },
    { jp: 'ちょっと、これ誰の髪の毛？', en: 'Wait a minute! Whose hair is this?!' },
  ],
  '鳴': [
    { jp: '猫は「ニャー」と鳴く。', en: 'The cat says "meow".' },
    { jp: '犬は「ワンワン」と鳴く。', en: 'The dog goes "woof-woof".' },
  ],
  '並': [
    { jp: '彼らはいすを集めて整然と列に並べた。', en: 'They assembled the chairs in neat rows.' },
    { jp: '２列に並びなさい。', en: 'Form two lines.' },
  ],
  '丸': [
    { jp: '猫は背中を丸めた。', en: 'The cat arched its back.' },
    { jp: 'メンツ丸つぶれだ。', en: 'I have lost face completely.' },
  ],
  '久': [
    { jp: 'お久しぶりですね！', en: 'Long time no see!' },
    { jp: '元気？久しぶりだね。', en: 'How are you doing? It\'s been a long time since I\'ve seen you.' },
  ],
  '乱': [
    { jp: 'トムも混乱してた。', en: 'Tom was confused, too.' },
    { jp: '混乱してしまった。', en: 'I was confused.' },
  ],
  '乳': [
    { jp: 'チーズは、ウシ、ヤギ、ヒツジやその他の哺乳類の乳から作られる固形の食べ物だ。', en: 'Cheese is a solid food made from the milk of cows, goats, sheep, and other mammals.' },
    { jp: '牛乳はよく飲むの？', en: 'Do you often drink milk?' },
  ],
  '乾': [
    { jp: '君のＴシャツはすぐ乾くでしょう。', en: 'Your T-shirt will dry soon.' },
    { jp: '空気が乾くと、喉も渇いて咳が出る。', en: 'When air dries, the throat dries, and cough comes out.' },
  ],
  '了': [
    { jp: '投函完了、と。後は頼んだぞ、ポストマンよ。', en: 'Mailing complete. I leave the rest to you, postman!' },
    { jp: '最後の調整を完了するために五分ください。', en: 'Give me five minutes to finish the last adjustments.' },
  ],
  '介': [
    { jp: 'よけいなお節介だ。', en: 'Mind your own business.' },
    { jp: '自己紹介をします。', en: 'I\'ll just introduce myself.' },
  ],
  '仏': [
    { jp: '仏の顔も三度まで。', en: 'You can only go so far.' },
    { jp: 'もう神も仏もない。', en: 'Now there is neither God nor Buddha.' },
  ],
  '令': [
    { jp: '私の命令は絶対だ。', en: 'My orders are absolute.' },
    { jp: 'この命令は厳守すべき。', en: 'This order is to be obeyed to the letter.' },
  ],
  '仲': [
    { jp: '休みの前などは少し羽目を外して飲むのだが、杜仲茶割りで飲むと二日酔いが全くない。', en: 'I usually cut loose a bit and drink plenty before a day off work, but if my drinks are cut with tochu tea, then I get absolutely no hangover.' },
    { jp: '仲良くできないの？', en: 'Can\'t you just be nice to each other?' },
  ],
  '伸': [
    { jp: '夏には草がよく伸びる。', en: 'Grass is luxuriant in summer.' },
    { jp: '褒められて伸びるタイプなんです。', en: 'I can say with certainty that I am the type of person that improves with compliments.' },
  ],
  '伺': [
    { jp: '明日お伺いします。', en: 'I\'ll visit you tomorrow.' },
    { jp: '先生のご意見を伺いたい。', en: 'I\'d like to hear the teacher\'s opinion.' },
  ],
  '低': [
    { jp: 'この山は低いです。', en: 'This is a low mountain.' },
    { jp: '血圧が低いですね。', en: 'Your blood pressure\'s low.' },
  ],
  '依': [
    { jp: '我々はしばしば、どの程度まで他人に依存しているか、気づかないことがある。', en: 'We often fail to realize the extent to which we depend on others.' },
    { jp: '一番いいのは、専門家に修理を依頼することだよ。', en: 'The best thing to do is to ask an expert to repair it.' },
  ],
  '個': [
    { jp: '郵便番号って、全部で何個あるの？', en: 'How many postcodes are there in total?' },
    { jp: 'アドラステアは木星の３９個の衛星のうちの一つで、木星から２番目に近い衛星です。', en: 'Adrastea is one of the 39 satellites of Jupiter and is the second closest to Jupiter itself.' },
  ],
  '倍': [
    { jp: '最小公倍数を求めなさい。', en: 'Find the lowest common denominator.' },
    { jp: '私はその古本に倍額を払った。', en: 'I paid double the price for the secondhand book.' },
  ],
  '停': [
    { jp: '列車は滑らかに停止した。', en: 'The train came to a smooth stop.' },
    { jp: '運転者は停止信号を無視した。', en: 'The driver ignored the stoplight.' },
  ],
  '傾': [
    { jp: '太陽が西に傾いた。', en: 'The sun declined westward.' },
    { jp: '彼は怠ける傾向がある。', en: 'He is inclined to be lazy.' },
  ],
  '像': [
    { jp: '彼は柱に寄りかかって自由の女神像をじっと見つめた。', en: 'He leaned against the pillar and gazed at the Statue of Liberty.' },
    { jp: '彫像が欲しいんだ。', en: 'I want a sculpture.' },
  ],
  '億': [
    { jp: 'トムは億万長者だ。', en: 'Tom is a billionaire.' },
    { jp: '私たちは億万長者になりたい。', en: 'We want to be billionaires.' },
  ],
  '兆': [
    { jp: '大量のイカの水揚げは地震の前兆現象だ。', en: 'Large catches of squid are a sign of a coming earthquake.' },
    { jp: 'これは悪い兆候だ。', en: 'This is a bad sign.' },
  ],
  '児': [
    { jp: '児童虐待は犯罪です。', en: 'Child abuse is a crime.' },
    { jp: '彼女は児童心理学専攻だ。', en: 'She majors in child psychology.' },
  ],
  '党': [
    { jp: '喜んで中国共産党に入ります。', en: 'I willingly join the Chinese Communist Party.' },
    { jp: '中国では1949年に共産党が政権を取った。', en: 'Communists took power in China in 1949.' },
  ],
  '兵': [
    { jp: '兵士になったことある？', en: 'Have you ever been a soldier?' },
    { jp: '彼は軍に徴兵された。', en: 'He was drafted into the army.' },
  ],
  '冊': [
    { jp: '図書館で本を三冊借りました。', en: 'I borrowed three books from the library.' },
    { jp: 'たまには新書でも一冊読みきるか。', en: 'I should read a new book every now and then.' },
  ],
  '再': [
    { jp: '再来月は１２月だ。', en: 'The month after next is December.' },
    { jp: '再び沈黙があった。', en: 'There was another silence.' },
  ],
  '凍': [
    { jp: 'みんな凍りついた。', en: 'Everyone froze.' },
    { jp: 'かたく凍っている。', en: 'It\'s frozen hard.' },
  ],
  '刊': [
    { jp: '少年はそこに座って週刊誌を読んでいた。', en: 'The boy sat there reading a weekly magazine.' },
    { jp: '朝刊はどこにある？', en: 'Where\'s the morning paper?' },
  ],
  '刷': [
    { jp: '私はページを百枚印刷する。', en: 'I print 100 pages.' },
    { jp: 'この本は英国で印刷された。', en: 'This book was printed in England.' },
  ],
  '券': [
    { jp: '駐車券はお持ちですか？', en: 'Do you have a parking ticket?' },
    { jp: '入場券はいくらですか？', en: 'How much is the entrance fee?' },
  ],
  '刺': [
    { jp: '名刺をお持ちですか？', en: 'Do you have a business card?' },
    { jp: '刺身を食べませんか？', en: 'Would you like some sashimi?' },
  ],
  '則': [
    { jp: '君は規則を破った。', en: 'You broke the rule.' },
    { jp: '原則、喫煙禁止です。', en: 'As a rule, we don\'t allow smoking.' },
  ],
  '副': [
    { jp: '容姿端麗、頭脳明晰、運動神経抜群、家は金持ちで、ついでに学生会の副会長をしてたりもする、いわゆるパーフェクトな奴だ。', en: 'Looks, brains, reflexes, rich family and, for good measure, vice president of the student committee - in other words he\'s \'perfect\'.' },
    { jp: '副詞は何を修飾するでしょう？', en: 'What do adverbs modify?' },
  ],
  '劇': [
    { jp: '私は劇場にいました。', en: 'I was at the theater.' },
    { jp: '劇場に行くことにしたよ。', en: 'I\'ve decided to go to the theater.' },
  ],
  '効': [
    { jp: 'その効果は絶大だ。', en: 'That\'s an awesome result.' },
    { jp: '効果は変わりません。', en: 'The effect is the same.' },
  ],
  '勇': [
    { jp: '小林勇は幸田 露伴の愛顧を受けた。', en: 'Isamu Kobayashi received the patronage of Rohan Koda.' },
    { jp: 'ボクが憧れたのは翔太部長の『力』じゃない。体を張ってでも信念を貫こうとする雄々しい勇気だったはず。', en: 'What I looked up to in Shota was not his \'strength\'. It was his heroic courage to put his life on the line to carry out his convictions.' },
  ],
  '募': [
    { jp: 'その職にはかなり多数の応募者があった。', en: 'There were a good many candidates for the position.' },
    { jp: '彼女は一万人の応募者の中から選ばれた。', en: 'She was chosen from ten thousand applicants.' },
  ],
  '勢': [
    { jp: '大勢の人が見てた？', en: 'Were there many people watching?' },
    { jp: '姿勢を正しなさい！', en: 'Straighten your back!' },
  ],
  '包': [
    { jp: '町は霧に包まれた。', en: 'The city was wrapped in fog.' },
    { jp: '包丁を研いでたわよ。', en: 'He was sharpening the knife.' },
  ],
  '匹': [
    { jp: '猫を12匹飼ってます。', en: 'I have a dozen cats.' },
    { jp: '犬を一匹飼いたいです。', en: 'I want to keep one dog.' },
  ],
  '区': [
    { jp: '下京区に引っ越す。', en: 'I move to the Shimagyou district.' },
    { jp: 'ここは遊泳禁止区域です。', en: 'No swimming in this area.' },
  ],
  '卒': [
    { jp: '私は京都大学を卒業しました。', en: 'I graduated from Kyoto University.' },
    { jp: '卒業後はどうするつもりなの？', en: 'What will you do after graduation?' },
  ],
  '協': [
    { jp: '僕らは妥協するよ。', en: 'We compromised.' },
    { jp: '私は協調性がある。', en: 'I\'m cooperative.' },
  ],
  '占': [
    { jp: '星占いに興味ある？', en: 'Are you interested in astrology?' },
    { jp: '今日は、星占い見た？', en: 'Have you read your horoscope today?' },
  ],
  '印': [
    { jp: '第一印象は大切だ。', en: 'First impressions are important.' },
    { jp: 'それが第一印象です。', en: 'That is a first impression.' },
  ],
  '卵': [
    { jp: 'サケは淡水で産卵する。', en: 'Salmon lay their eggs in fresh water.' },
    { jp: '鮭は川をさかのぼって砂に産卵する。', en: 'Salmon go up the river and lay their eggs in the sand.' },
  ],
  '厚': [
    { jp: '社会保険庁や厚生労働省への不信感は募る一方である。', en: 'Distrust of the Social Insurance Agency and the Ministry of Health, Labour and Welfare just keeps getting stronger.' },
    { jp: '皆は厚着をしていた。', en: 'Everybody was dressed warm.' },
  ],
  '双': [
    { jp: '双方の言い分を聞かないと真相は分からない。', en: 'You cannot learn the truth unless you hear what both parties have to say.' },
    { jp: '双方が降参しようとしなかったので、長い戦争となった。', en: 'It was a long war because neither side would give in.' },
  ],
  '叫': [
    { jp: '耳元で叫ばないで！', en: 'Don\'t scream in my ear!' },
    { jp: '叫ばなくていいよ。', en: 'You don\'t need to shout.' },
  ],
  '召': [
    { jp: '何を召し上がりますか？', en: 'What would you like to have?' },
    { jp: '生でも召し上がれます。', en: 'It can be eaten raw.' },
  ],
  '史': [
    { jp: '教科書問題や歴史認識、靖国神社への首相の参拝などで、日中関係に波風が立っている。', en: 'Such things as the textbook controversy, lack of recognition of historical events, and the prime minister\'s worshipping at the Yasukuni Shrine have caused discord with China.' },
    { jp: '私は歴史が好きだ。', en: 'I like history.' },
  ],
  '各': [
    { jp: 'いくつかの情報科学年表から重要項目を抜きだし、各項目について簡単なコメントを付けました。', en: 'I took the most important events from the chronology of information science and wrote a few words about each one.' },
    { jp: '彼女は日本の各地を旅してまわった。', en: 'She traveled around Japan.' },
  ],
  '含': [
    { jp: 'パスタは炭水化物の含有量が多い。', en: 'Pasta is high in carbohydrates.' },
    { jp: 'このビールはアルコールの含有量が多い。', en: 'This beer contains a high proportion of alcohol.' },
  ],
  '周': [
    { jp: '彼は周りを見渡した。', en: 'He looked around.' },
    { jp: '僕は周りを見回した。', en: 'I looked around me.' },
  ],
  '咲': [
    { jp: '花はもうすぐ咲くよ。', en: 'The flowers will soon blossom.' },
    { jp: '梅の花は3月に咲く。', en: 'Plum blossoms come out in March.' },
  ],
  '喫': [
    { jp: '喫茶店に行きたい？', en: 'Do you want to go to a coffee shop?' },
    { jp: '私は喫茶店に入った。', en: 'I entered a coffee shop.' },
  ],
  '営': [
    { jp: '車の営業は何年目？', en: 'How many years have you been selling cars?' },
    { jp: '年中休まず営業中！', en: 'Open all year round!' },
  ],
  '団': [
    { jp: '団体旅行は楽しめないんだ。', en: 'I don\'t enjoy traveling in large groups.' },
    { jp: 'サッカーは団体スポーツです。', en: 'Soccer is a team sport.' },
  ],
  '囲': [
    { jp: '正解をまるで囲みなさい。', en: 'Please circle the right answer.' },
    { jp: '企業は、競合他社を業界内の狭い範囲で捉えて、本当のライバルを明確に理解してない場合が数多くあります。', en: 'Businesses perceive as competitors a narrow range of the business world; there are many cases where they don\'t understand their real rivals.' },
  ],
  '固': [
    { jp: '卵の白身はゆでれば固まります。', en: 'You can set the white of an egg by boiling it.' },
    { jp: '彼の二番目の息子は結婚して身を固めた。', en: 'His second son married and settled down.' },
  ],
  '圧': [
    { jp: 'タイヤの空気圧を調べてもらえますか。', en: 'Could you check the tire pressure?' },
    { jp: '一本だけタイヤの空気圧が極端に減ってるんだ。釘でも刺さってるのかな。', en: 'Only one of the tires is extremely flat. I wonder if it was punctured by a nail or something.' },
  ],
  '坂': [
    { jp: 'この坂の勾配が大きい。', en: 'The gradient of this hill is steep.' },
    { jp: 'ケンは坂を駆け上った。', en: 'Ken dashed up the slope.' },
  ],
  '均': [
    { jp: '彼は平均的な背丈だ。', en: 'He is of average height.' },
    { jp: '一日平均６時間寝ます。', en: 'I sleep six hours a day on average.' },
  ],
  '型': [
    { jp: '朝型？それとも夜型？', en: 'Are you a morning person or a night person?' },
    { jp: '髪型を変えたんだ。', en: 'I changed my hairstyle.' },
  ],
  '埋': [
    { jp: '彼女は一人息子を埋葬した。', en: 'She has buried her only son.' },
    { jp: '彼女は生まれ故郷に埋葬された。', en: 'She was buried in her hometown.' },
  ],
  '城': [
    { jp: '万里の長城は五千五百マイル以上の長さがあります。', en: 'The Great Wall of China is more than 5,500 miles long.' },
    { jp: 'ここは城の跡です。', en: 'This is the site of a castle.' },
  ],
  '域': [
    { jp: '地域で差がありすぎる。', en: 'There are too many regional differences.' },
    { jp: 'ここは遊泳禁止区域です。', en: 'No swimming in this area.' },
  ],
  '塔': [
    { jp: '向こうに見えるのがエッフェル塔です。', en: 'That tower you see over there is the Eiffel Tower.' },
    { jp: '「パリと言えば？」「エッフェル塔でしょ！」', en: '"What do you think of when you hear Paris?" "The Eiffel Tower, of course!"' },
  ],
  '塗': [
    { jp: '日焼け止め塗った？', en: 'Did you put on sunscreen?' },
    { jp: '日焼け止め塗りな。', en: 'Put on some sunscreen.' },
  ],
  '塩': [
    { jp: 'お塩取ってくれる？', en: 'Will you pass me the salt?' },
    { jp: '塩貸してください。', en: 'Please pass over the salt.' },
  ],
  '境': [
    { jp: '彼の公式の肩書きは環境庁長官です。', en: 'His official title is Director-General of the Environment Agency.' },
    { jp: '彼は環境に順応した。', en: 'He adapted himself to circumstances.' },
  ],
  '央': [
    { jp: '駅は市の中央にある。', en: 'The station is the middle of the city.' },
    { jp: '公園の中央に池がある。', en: 'There is a pond in the middle of the park.' },
  ],
  '奥': [
    { jp: '奥歯が欠けました。', en: 'My back tooth has chipped.' },
    { jp: '奥さんとキスしていい？', en: 'Is it OK if I kiss your wife?' },
  ],
  '姓': [
    { jp: 'あなたの姓名を教えてください。', en: 'Please tell me your full name.' },
    { jp: '姓は池田、名は和子。', en: 'Ikeda is my last name, and Kazuko is my first name.' },
  ],
  '委': [
    { jp: '６人の教授でその委員会を構成する。', en: 'Six professors constitute the committee.' },
    { jp: '彼は委員会の委員だ。', en: 'He is a member of the committee.' },
  ],
  '季': [
    { jp: '日本の安倍晋三首相は、2020年夏季東京オリンピックを延期せざるを得ないかもしれないと発言した。', en: 'Japanese Prime Minister Shinzo Abe said the 2020 Tokyo Summer Olympic Games may have to be postponed.' },
    { jp: 'こちらは乾季ですよ。', en: 'It\'s the dry season here.' },
  ],
  '孫': [
    { jp: 'トムは孫の手で背中をボリボリ掻いた。', en: 'Tom scratched his back with a backscratcher.' },
    { jp: '日本の孫の手で背中を掻いてみたことってある？', en: 'Have you ever scratched your back with a backscratcher made in Japan?' },
  ],
  '宇': [
    { jp: '大人になったら、宇宙飛行士になりたいよ。', en: 'I want to be an astronaut when I grow up.' },
    { jp: '宇宙には太陽よりも大きな星が沢山ある。', en: 'There are a lot of stars which are larger than our sun.' },
  ],
  '宝': [
    { jp: '宝くじを当てたい！', en: 'I want to win the lottery!' },
    { jp: '子供は私の宝です。', en: 'My children are my treasures.' },
  ],
  '寺': [
    { jp: 'お寺はどこですか？', en: 'Where\'s the temple?' },
    { jp: 'お寺で静かに座った。', en: 'I sat quietly at the temple.' },
  ],
  '封': [
    { jp: '相手のエースを封じ込めれば勝機はある。', en: 'If we can contain the opponent\'s best player, we have a shot at winning.' },
    { jp: '封筒を開けました。', en: 'I opened the envelope.' },
  ],
  '専': [
    { jp: '彼はつりの専門家だ。', en: 'He is an expert at fishing.' },
    { jp: '彼は経済の専門家だ。', en: 'He is an expert in economics.' },
  ],
  '将': [
    { jp: '君の将来は君次第だ。', en: 'My future is in your hands.' },
    { jp: '将来は何になりたいの？', en: 'What do you want to be in the future?' },
  ],
  '尊': [
    { jp: '心から尊敬します。', en: 'I really respect you.' },
    { jp: '自尊心を大切にしよう。', en: 'Let\'s value our self-respect.' },
  ],
  '導': [
    { jp: '彼は明らかに有能な指導者だ。', en: 'He is admittedly an able leader.' },
    { jp: '彼らは盲目的に指導者に従った。', en: 'They followed their leader blindly.' },
  ],
  '届': [
    { jp: '1週間以内にお届けします。', en: 'We are able to deliver within a week.' },
    { jp: 'お届けまでに３週間かかります。', en: 'Allow three weeks for delivery.' },
  ],
  '層': [
    { jp: '３０階建の超高層ビルが突然爆発炎上した。', en: 'All of a sudden, the thirty-story skyscraper went up in flames.' },
    { jp: 'ロシア語は大層学びにくい。', en: 'Russian is very difficult to learn.' },
  ],
  '岩': [
    { jp: '岩の下に隠れたい。', en: 'I want to hide under a rock.' },
    { jp: '岩崩れに気をつけて。', en: 'Look out for rock slides.' },
  ],
  '岸': [
    { jp: 'ある朝、美術家が海岸で流木を見つけました。彼はそれを自分の作業場に持っていき、現在、村の教会に立っている有名な聖母マリア像を彫り上げました。', en: 'One morning, the artist found a piece of driftwood on the beach. He took it to his workshop, and from it carved the famous figure of Our Lady which today stands in the village church.' },
    { jp: '１９９０年代は湾岸紛争で始まった。', en: 'The 1990s began with the Gulf incident.' },
  ],
  '島': [
    { jp: 'イギリスは島です。', en: 'Britain is an island.' },
    { jp: '海の上に島がある。', en: 'There are islands in the sea.' },
  ],
  '州': [
    { jp: '彼は杭州の出身だ。', en: 'He comes from Hangzhou.' },
    { jp: '広州に住んでいる。', en: 'I live in Canton.' },
  ],
  '巨': [
    { jp: '東京は巨大都市だ。', en: 'Tokyo is a very big city.' },
    { jp: '巨人は落ちやすい。', en: 'Giants fall easily.' },
  ],
  '巻': [
    { jp: '時計のネジを巻くのを忘れたので、止まってしまったんです。', en: 'I forgot to wind my watch up, so it stopped.' },
    { jp: 'まぁ実際問題、そんな噂が渦巻く中でよく部活が存続してると思うぜ。', en: 'Well, for the practical problem, in the midst of those rumours flying around I\'m surprised they\'ve been able to keep that club running.' },
  ],
  '布': [
    { jp: 'ヤバイ！財布忘れた！', en: 'By Jove! I forgot my wallet!' },
    { jp: '布団が吹っ飛んだ。', en: 'My futon\'s gone.' },
  ],
  '希': [
    { jp: 'あまり希望がない。', en: 'There is not much hope.' },
    { jp: 'HIV検査を希望しますか？', en: 'Would you like to be tested for HIV?' },
  ],
  '帯': [
    { jp: '沿岸地帯には津波警報が出た。', en: 'The coast was warned against a tsunami.' },
    { jp: '湿地帯に建物の建設はできませんよ。', en: 'You can\'t build buildings on swampy land.' },
  ],
  '帽': [
    { jp: 'トムはTシャツに野球帽姿だった。', en: 'Tom was wearing a T-shirt and a baseball cap.' },
    { jp: '帽子を忘れないでね。', en: 'Don\'t forget your hat.' },
  ],
  '幅': [
    { jp: 'トムは肩幅が狭い。', en: 'Tom has narrow shoulders.' },
    { jp: 'トムは肩幅が広い。', en: 'Tom has broad shoulders.' },
  ],
  '干': [
    { jp: '洗濯物を干すには最高の天気だ。', en: 'This is perfect weather for drying clothes.' },
    { jp: 'トムが洗濯物を干すの手伝ってあげて。', en: 'Please help Tom hang up the laundry.' },
  ],
  '幼': [
    { jp: 'アンは幼い少女です。', en: 'Ann is a little girl.' },
    { jp: '私たちは幼なじみです。', en: 'We\'re old friends.' },
  ],
  '庁': [
    { jp: '三重県の県庁所在地は津市です。', en: 'Mie Prefecture\'s capital is Tsu City.' },
    { jp: '気象庁は注意を呼びかけている。', en: 'The Meteorological Agency is urging caution.' },
  ],
  '床': [
    { jp: '携帯が床に落ちた。', en: 'My phone fell on the floor.' },
    { jp: '床屋に行きなさい。', en: 'Go to the barber.' },
  ],
  '底': [
    { jp: '彼は貧乏のどん底だ。', en: 'He is as poor as can be.' },
    { jp: '私なんぞには野牛と鹿と馬とを描き分けることなど到底出来ない。', en: 'Me? I can\'t even begin to draw buffalo, deer and horses so you can tell them apart.' },
  ],
  '府': [
    { jp: '新しい政府が選挙された。', en: 'They have elected a new government.' },
    { jp: 'トムは政府を信頼していない。', en: 'Tom doesn\'t trust the government.' },
  ],
  '庫': [
    { jp: '青空文庫におすすめとかない？', en: 'Do you have any recommendations for something to read on Aozora Bunko?' },
    { jp: '冷蔵庫に何が入っていますか？', en: 'What is in the refrigerator?' },
  ],
  '延': [
    { jp: '決定は延期された。', en: 'The decision was put off.' },
    { jp: '結婚式は延期された。', en: 'The wedding was put off.' },
  ],
  '弱': [
    { jp: '誰にでも弱点がある。', en: 'Everybody has weaknesses.' },
    { jp: '彼は体が弱いです。', en: 'He has a weak constitution.' },
  ],
  '律': [
    { jp: '規律のおかげでその若者たちに変化が生まれている。', en: 'Thanks to the discipline they are receiving, we are starting to see a change in those young people.' },
    { jp: '法律のさらなる規制は経済を壊滅させる。', en: 'Regulations are killing our economy.' },
  ],
  '復': [
    { jp: '復活祭、おめでとうございます。', en: 'Happy Easter!' },
    { jp: '彼は回復しますか。', en: 'Will he get well?' },
  ],
  '快': [
    { jp: '病院で不愉快な思いをしている分を取り戻そうと思って、トムは自分の適量より少し多めにお酒を飲んだ。', en: 'To compensate for his unpleasant experiences in the hospital, Tom drank a little more than was good for him.' },
    { jp: '彼は明朗快活な青年だ。', en: 'He is a cheerful young man.' },
  ],
  '恋': [
    { jp: 'トムとは友達以上恋人未満の関係です。', en: 'Tom is more than my friend, but he\'s not quite my boyfriend.' },
    { jp: 'ボストンが恋しい？', en: 'Do you miss Boston?' },
  ],
  '患': [
    { jp: 'こちらの患者さんたちは、歩行が困難な状態です。', en: 'These patients have trouble walking.' },
    { jp: '備えあれば患い無し。', en: 'Well prepared means no worries.' },
  ],
  '悩': [
    { jp: 'これが私の頭を悩ませていることの一つです。', en: 'There\'s one thing that\'s bothering me.' },
    { jp: '水虫が兄の悩みの種なんです。', en: 'Athlete\'s foot is my brother\'s problem.' },
  ],
  '憎': [
    { jp: '彼が私を憎む理由がわかりはじめた。', en: 'I began to understand the reason why he hated me.' },
    { jp: '誰かを愛するか憎むかでは、どちらが簡単？', en: 'Is it easier to love or hate someone?' },
  ],
  '戸': [
    { jp: '１０戸が全焼した。', en: 'Ten houses were burned down.' },
    { jp: '戸棚の中は見たよ。', en: 'I looked in the cupboard.' },
  ],
  '承': [
    { jp: '部長からのご依頼を承りました。', en: 'I have a request from the head of department.' },
    { jp: 'みんな承知の上さ。', en: 'Everybody knows it.' },
  ],
  '技': [
    { jp: '戦後日本は科学技術の面で大いに進歩した。', en: 'Since the war, Japan has advanced greatly in science and technology.' },
    { jp: '我々は技術を後世に伝えなければならない。', en: 'We must hand down our craft to posterity.' },
  ],
  '担': [
    { jp: '私が担任だからね。', en: 'After all, I am a homeroom teacher.' },
    { jp: '担当者と代わります。', en: 'I\'ll transfer you to the right person.' },
  ],
  '拝': [
    { jp: 'その部族は祖先を崇拝し、私たちにはなじみのない独自の言語を話す。', en: 'The tribe worships its ancestors and speaks its own language, and speaks an unfamiliar language.' },
    { jp: 'ペンを拝借できますか。', en: 'Can I borrow your pen?' },
  ],
  '拾': [
    { jp: 'トムを拾うつもりだ。', en: 'I\'m going to pick Tom up.' },
    { jp: 'タクシーを拾うのに苦労した。', en: 'I had trouble getting a taxi.' },
  ],
  '挟': [
    { jp: '小耳に挟みました。', en: 'A little birdie told me.' },
    { jp: '痛い！ドアに指挟んだ！', en: 'Ouch! I stuck my finger in the door!' },
  ],
  '捜': [
    { jp: '捜しに行ってくる。', en: 'I\'ll go look for them.' },
    { jp: '妻を捜しています。', en: 'I am looking for my wife.' },
  ],
  '捨': [
    { jp: '言いそびれてたんだけど、私のこと呼び捨てでいいからね。', en: 'Oh, I missed the chance to tell you, but you can just call me by my normal name, by the way.' },
    { jp: '私を見捨てないで！', en: 'Don\'t forsake me!' },
  ],
  '掃': [
    { jp: '大掃除の時間だよ！', en: 'It\'s time for spring cleaning!' },
    { jp: '煙突掃除が必要ね。', en: 'The chimney needs to be cleaned.' },
  ],
  '掘': [
    { jp: '掘っ建て小屋でもいいから自分の家が欲しい。', en: 'I want my own house, even if it\'s a shack.' },
    { jp: 'おかまを掘られた。', en: 'I was rear-ended.' },
  ],
  '採': [
    { jp: '趣味は昆虫採集なんだ。', en: 'My hobby is collecting insects.' },
    { jp: 'トムが花を採ったんだ。', en: 'Tom picked flowers.' },
  ],
  '接': [
    { jp: '先生と直接話してみよう。', en: 'Let\'s talk directly with the teacher.' },
    { jp: '接触を避けてください。', en: 'Please avoid contact.' },
  ],
  '換': [
    { jp: 'LINE交換しませんか？', en: 'Why don\'t we exchange LINE info?' },
    { jp: '誰と誰を交換する？', en: 'Who is being exchanged with whom?' },
  ],
  '損': [
    { jp: '腹を立てるだけ損よ。', en: 'It doesn\'t pay to lose your temper.' },
    { jp: '一桃腐りて百桃損ず。', en: 'One rotten apple spoils the barrel.' },
  ],
  '改': [
    { jp: '法律が改正された。', en: 'The law was changed.' },
    { jp: '改めて、ありがとう。', en: 'Thanks again.' },
  ],
  '敬': [
    { jp: '敬老の日には祖父母を訪ねて孝行します。', en: 'On the Respect-for-Senior-Citizens Day, we visit our grandparents and do nice things for them.' },
    { jp: '心から尊敬します。', en: 'I really respect you.' },
  ],
  '旧': [
    { jp: '旧友に招待された。', en: 'I was invited by an old friend.' },
    { jp: '旧校舎が全焼しました。', en: 'The old school building burned down.' },
  ],
  '昇': [
    { jp: '人気急上昇中です！', en: 'Its popularity is skyrocketing!' },
    { jp: '昇進が気になるの？', en: 'Are you worried about the promotion?' },
  ],
  '星': [
    { jp: '月は地球の衛星だ。', en: 'The moon is the Earth\'s satellite.' },
    { jp: '火星は二つ衛星がある。', en: 'Mars has two moons.' },
  ],
  '普': [
    { jp: 'それが普通でしょ？', en: 'That\'s normal, isn\'t it?' },
    { jp: 'これは普通のこと？', en: 'Is this normal?' },
  ],
  '暴': [
    { jp: '暴力はどこにでもある。', en: 'There\'s violence everywhere.' },
    { jp: '私たちは暴力が嫌いだ。', en: 'We abhor violence.' },
  ],
  '曇': [
    { jp: 'まだ曇っています。', en: 'It\'s still cloudy.' },
    { jp: '空が急に曇ってきた。', en: 'The sky suddenly clouded over.' },
  ],
  '替': [
    { jp: '両替人の金を散らし、その台を倒した。', en: 'He scattered the coins of the money-changers and overturned their table.' },
    { jp: '服を着替えました。', en: 'I changed clothes.' },
  ],
  '札': [
    { jp: '千円札くずれますか。', en: 'Can you break a 1000 yen bill?' },
    { jp: 'この千円札をくずしてくれませんか。', en: 'Can you break this thousand-yen bill?' },
  ],
  '机': [
    { jp: '猫が机の上にいる。', en: 'There\'s a cat on the desk.' },
    { jp: 'これは誰の机ですか？', en: 'Whose desk is this?' },
  ],
  '材': [
    { jp: '素材は何でしょうか？', en: 'What are they made of?' },
    { jp: 'あまった食材で充分。', en: 'Leftovers are sufficient.' },
  ],
  '村': [
    { jp: 'この村は何ていうの？', en: 'What\'s the name of this village?' },
    { jp: '村で祭りがあるんだ。', en: 'There\'s a festival in the village.' },
  ],
  '板': [
    { jp: '黒板に行きなさい。', en: 'Go to the blackboard.' },
    { jp: 'みんな、黒板に注目！', en: 'Look at the blackboard, everyone.' },
  ],
  '林': [
    { jp: '林檎は幾つですか？', en: 'How many apples are there?' },
    { jp: '林檎はいくらですか。', en: 'How much are the apples?' },
  ],
  '枚': [
    { jp: 'コインは何枚拾った？', en: 'How many coins did you find?' },
    { jp: '大人２枚ください。', en: 'Two adults, please.' },
  ],
  '枝': [
    { jp: '枝毛に悩んでいます。', en: 'I\'m troubled by split ends.' },
    { jp: '猫は枝の間に隠れた。', en: 'The cat hid among the branches.' },
  ],
  '枯': [
    { jp: '植物は水が無ければ枯れる。', en: 'Plants die without water.' },
    { jp: '彼女は涙が枯れるまで泣いた。', en: 'She cried until she ran out of tears.' },
  ],
  '柔': [
    { jp: 'この牛肉は柔らかい。', en: 'This beef is tender.' },
    { jp: '柔らかい便が出ます。', en: 'I have soft stools.' },
  ],
  '柱': [
    { jp: 'これは石柱である。', en: 'This is a stone pillar.' },
    { jp: '技師が電柱を上った。', en: 'The engineer climbed the telephone pole.' },
  ],
  '査': [
    { jp: '国勢調査ってなに？', en: 'What\'s a census?' },
    { jp: '審査員は誰ですか？', en: 'Who are the judges?' },
  ],
  '栄': [
    { jp: '善人必ずしも栄える者でない。', en: 'Not all good men will prosper.' },
    { jp: '「この写真の出来栄えどう？」「綺麗に撮れてるよ」', en: '"How do you like the picture?" "I think it\'s beautiful."' },
  ],
  '根': [
    { jp: '百合は宿根草です。', en: 'Lilies are perennial plants.' },
    { jp: '彼は根はいい人だ。', en: 'He is a good man at heart.' },
  ],
  '械': [
    { jp: 'この機械は故障中だ。', en: 'This machine is out of order.' },
    { jp: 'この機械は価値がない。', en: 'This machine is worthless.' },
  ],
  '棒': [
    { jp: 'あの泥棒を止めろ！', en: 'Stop that thief!' },
    { jp: '泥棒は逃げ出した。', en: 'The thief ran away.' },
  ],
  '森': [
    { jp: 'トムって「あつまれ　どうぶつの森」をやるのかな？', en: 'Does Tom play Animal Crossing?' },
    { jp: '「金のなる木なんてないよ」「どうぶつの森したことないでしょう？」', en: '"Money doesn\'t grow on trees." "I see you haven\'t played Animal Crossing before."' },
  ],
  '植': [
    { jp: '植物と話しますか？', en: 'Do you talk to your plants?' },
    { jp: '苗は若い植物です。', en: 'Seedlings are young plants.' },
  ],
  '極': [
    { jp: '両極端は一致する。', en: 'Extremes meet.' },
    { jp: 'それは極端な場合だ。', en: 'They are the extreme cases.' },
  ],
  '橋': [
    { jp: '群馬県の県庁所在地は前橋市です。', en: 'Gunma Prefecture\'s capital is Maebashi City.' },
    { jp: '１０年前に、この川に橋が渡されました。', en: 'Ten years ago, a bridge went across this river.' },
  ],
  '欧': [
    { jp: 'ドイツは中欧にある。', en: 'Germany is in Central Europe.' },
    { jp: '批判する者の中には、欧州中央銀行に課せられた目標が不適切であると考える者がいます。', en: 'Among the critics are those who think that the objective set for the European Central Bank is not appropriate.' },
  ],
  '武': [
    { jp: 'トムは武道家です。', en: 'Tom is a martial artist.' },
    { jp: '剣道は日本の武道です。', en: 'Kendo is a Japanese martial art.' },
  ],
  '歴': [
    { jp: '「天路歴程」が気に入ったので、私が最初に集めたのは小さい分冊本のジョン・バニヤン著作集だった。', en: 'Pleased with The Pilgrim\'s Progress, my first collection was of John Bunyan\'s works in separate little volumes.' },
    { jp: '彼女いない歴何年？', en: 'When was the last time you had a girlfriend?' },
  ],
  '殿': [
    { jp: '宮殿には高い塔がある。', en: 'The palace has a tall tower.' },
    { jp: '宮殿は物々しい警戒ぶりだった。', en: 'The palace was heavily guarded.' },
  ],
  '毒': [
    { jp: 'これは体に毒だよ。', en: 'This is a hazard to your health.' },
    { jp: 'それはお気の毒に。', en: 'I\'m sorry to hear that.' },
  ],
  '比': [
    { jp: '比べようがないじゃん！', en: 'There\'s no comparing them!' },
    { jp: '彼女は比較的早口だ。', en: 'She speaks relatively fast.' },
  ],
  '毛': [
    { jp: '『赤毛のアン』の本を読んだ感想を聞かせてください。', en: 'I want to hear your opinions on the book "Anne of Green Gables", which you have read.' },
    { jp: '私の好きな物語は、『赤毛のアン』『トム・ソーヤーの冒険』『アルプスの少女ハイジ』なんだ。', en: 'My favorite stories are "Anne of Green Gables", "The Adventures of Tom Sawyer" and "Heidi, Girl of the Alps".' },
  ],
  '氷': [
    { jp: '氷が解けちゃった。', en: 'The ice has melted.' },
    { jp: '疑問が氷解しました！', en: 'My doubts have been cleared up.' },
  ],
  '永': [
    { jp: '昔の建物を取り壊すことによって、私たちは、過去の痕跡を永久に消し去ってしまうことになるのである。', en: 'By demolishing buildings of bygone times, we wipe out every trace of the past forever.' },
    { jp: '永住権はありません。', en: 'I don\'t have permanent residency.' },
  ],
  '汗': [
    { jp: '十分間の休憩を与えられ、乱れた髪を結い直し、肩の汗をぬぐって、支度部屋で呼吸を整える。', en: 'Granted a ten-minute break, he enters the dressing room to tie his messy hair, wipe the sweat from his shoulders, and take control of his breathing.' },
    { jp: 'はっきり言うけど、おまえ汗臭いぞ。', en: 'To put it bluntly, your sweat smells awful.' },
  ],
  '汚': [
    { jp: '汚れた手で目をこすってはいけません。', en: 'Never rub your eyes with dirty hands.' },
    { jp: '汚い手でこれに触らないで。', en: 'Don\'t touch this with your dirty hands.' },
  ],
  '池': [
    { jp: 'この池は浅いです。', en: 'This pond is shallow.' },
    { jp: '電池が切れちゃった。', en: 'My battery ran out.' },
  ],
  '沈': [
    { jp: '短い沈黙があった。', en: 'There was a short silence.' },
    { jp: '再び沈黙があった。', en: 'There was another silence.' },
  ],
  '河': [
    { jp: 'アンドロメダ銀河は故郷です。', en: 'The Andromeda Galaxy is my home.' },
    { jp: 'アンドロメダ銀河に住んでいます。', en: 'I live in the Andromeda Galaxy.' },
  ],
  '沸': [
    { jp: 'トムは、やかんが沸くのを待っていました。', en: 'Tom waited for the kettle to boil.' },
    { jp: 'お湯が沸いたら教えてね。', en: 'Tell me when the water boils.' },
  ],
  '油': [
    { jp: '水は油よりも重い。', en: 'Water is heavier than oil.' },
    { jp: '原油価格が下がった。', en: 'The price of oil went down.' },
  ],
  '況': [
    { jp: '実況プレイをネットで見て、自分もやろうと思ったんだ。', en: 'Watching gameplay videos online made me want to play it for myself.' },
    { jp: '繊維産業をとりまく状況は変化した。', en: 'Circumstances surrounding the textile industry have changed.' },
  ],
  '泉': [
    { jp: '大辞泉と大辞林はよく似ています。', en: 'Daijisen and Daijirin are very similar.' },
    { jp: 'この温泉は穴場だね。', en: 'This hot spring is a great find.' },
  ],
  '泊': [
    { jp: '延泊をお願いできますか？', en: 'Can I extend my stay?' },
    { jp: 'もう一日延泊できますか。', en: 'I\'d like to stay another night if I can.' },
  ],
  '波': [
    { jp: '津波は滅多にない。', en: 'Tsunamis are very rare.' },
    { jp: '劉暁波は中国人です。', en: 'Liu Xiaobo is Chinese.' },
  ],
  '泥': [
    { jp: 'あの泥棒を止めろ！', en: 'Stop that thief!' },
    { jp: '泥棒は逃げ出した。', en: 'The thief ran away.' },
  ],
  '浅': [
    { jp: 'この池は浅いです。', en: 'This pond is shallow.' },
    { jp: 'この湖は浅いのよ。', en: 'This lake is shallow.' },
  ],
  '浴': [
    { jp: '水浴びした後、ソファに寝そべった。', en: 'After a cold shower, I lay down on the sofa.' },
    { jp: '朝シャワーを浴びました。', en: 'I took a shower this morning.' },
  ],
  '涙': [
    { jp: 'トムは涙を流した。', en: 'Tom wept.' },
    { jp: '母は涙ぐんでいた。', en: 'My mother was in tears.' },
  ],
  '液': [
    { jp: '血液は血管を流れる。', en: 'Blood flows through blood vessels.' },
    { jp: '誰か修正液持ってない？', en: 'Does anyone have some liquid paper?' },
  ],
  '涼': [
    { jp: '山頂は思いのほか涼しくて気持ちが良かった。', en: 'The summit was surprisingly nice.' },
    { jp: '「天気予報では今日は涼しいそうよ」「反対に、暑い気がする」', en: '"The weather forecast says it\'s cool today." "On the contrary, I feel hot."' },
  ],
  '混': [
    { jp: 'トムも混乱してた。', en: 'Tom was confused, too.' },
    { jp: '混乱してしまった。', en: 'I was confused.' },
  ],
  '清': [
    { jp: '美術館の東の陳列棟は清掃のため閉鎖されていた。', en: 'The museum\'s eastern gallery was closed for cleaning.' },
    { jp: '日本人は清潔好きな国民です。', en: 'The Japanese are a very clean people.' },
  ],
  '減': [
    { jp: '先進国では虫歯が激減し、自分の歯で一生食べられる人が増えています。', en: 'Cavities have become rarer in the developed countries and more people will be able to eat with their own teeth throughout their life.' },
    { jp: '日本では、学校給食が唯一のまともな食事だという子どもが増えており、給食が食べれなくなる夏休みになると体重が減るという子どもも少なくない。', en: 'In Japan, the amount of children whose only decent meal is provided by school is increasing. The amount of children whose weight decreases due to not being able to eat during summer vacation is also substantial.' },
  ],
  '温': [
    { jp: '水温は３８度です。', en: 'The water\'s 38 degrees.' },
    { jp: '温かい紅茶はいかが？', en: 'Would you like some hot tea?' },
  ],
  '測': [
    { jp: '血圧を測りますね。', en: 'Let me take your blood pressure.' },
    { jp: '視力を測りますね。', en: 'I\'ll check your vision.' },
  ],
  '湖': [
    { jp: 'この湖は浅いのよ。', en: 'This lake is shallow.' },
    { jp: '湖の水は濁っている。', en: 'The water in the lake is murky.' },
  ],
  '湯': [
    { jp: '私はお湯も沸かせない、まして七面鳥など焼くことができない。', en: 'I cannot even boil water, much less roast a turkey.' },
    { jp: 'ティーバッグを熱湯に浸しました。', en: 'I steeped a tea bag in boiling water.' },
  ],
  '湾': [
    { jp: '１９９０年代は湾岸紛争で始まった。', en: 'The 1990s began with the Gulf incident.' },
    { jp: '１９９０年代は湾岸戦争で始まった。', en: 'The 1990s began with the Gulf War.' },
  ],
  '湿': [
    { jp: '室内干しの場合は、乾燥機や除湿器を利用すると効率的です。', en: 'Using a dryer or dehumidifier makes the process of drying clothes indoors more efficient.' },
    { jp: '乾燥した空気のせいで痛んだノドや鼻の粘膜は、風邪のウイルスが入り込みやすくなってしまいます。暖房器具で寒さ対策、加湿器で乾燥対策をしっかり行なうことが肝要です。', en: 'Throat and nose membranes hurt by dry air allow cold viruses to enter more easily. It is important to carry out sensible counter plans against the cold with heaters and against the dryness with humidifiers.' },
  ],
  '準': [
    { jp: '平成１６年１月１日から、改正労働基準法が施行されます。', en: 'The reformed Labour Standards Act will be in force from Jan 1st 2004.' },
    { jp: '行く準備はできた？', en: 'Are you ready to go?' },
  ],
  '溶': [
    { jp: 'しかしながら、これらの溶剤は発がん性が指摘された。', en: 'However, these solvents were identified as carcinogenic.' },
    { jp: 'その液から溶剤を揮発させる。残るのは、香り成分と植物ワックスの塊。', en: 'Vaporise the solvent from the liquid. What\'s left is the perfume component and a lump of vegetable wax.' },
  ],
  '滴': [
    { jp: '私は病院で点滴を受けた。', en: 'I had an intravenous drip in hospital.' },
    { jp: '「つわり」は軽く考えられがちですが、重症化すると「妊娠悪阻」と呼ばれ、点滴などの治療が必要になります。', en: '"Morning sickness" is often taken lightly, but when it becomes severe, it is called "hyperemesis gravidarum" and requires an IV and other forms of medical care.' },
  ],
  '漁': [
    { jp: '鮎漁が解禁になった。', en: 'The ayu season has opened.' },
    { jp: '大型船が漁船に衝突しました。', en: 'The big ship rammed the fishing boat.' },
  ],
  '濃': [
    { jp: '彼女は化粧が濃い。', en: 'She wears a lot of makeup.' },
    { jp: 'このスープ、濃いよ。', en: 'The soup is thick.' },
  ],
  '濯': [
    { jp: '洗濯機は買ったの？', en: 'Did you buy a washing machine?' },
    { jp: '家に洗濯機はある？', en: 'Is there a washing machine in the house?' },
  ],
  '灯': [
    { jp: '消灯は何時ですか？', en: 'What time do you turn the lights off?' },
    { jp: '灯りが消えている。', en: 'The lights are out.' },
  ],
  '灰': [
    { jp: 'その猫は灰色ですか？', en: 'Is that cat grey?' },
    { jp: '建物は、灰と化した。', en: 'The building turned to ashes.' },
  ],
  '炭': [
    { jp: '炭鉱の内部に多くの労働者が閉じ込められた。', en: 'Many workers were trapped in the coal mine.' },
    { jp: '石炭は化石燃料だ。', en: 'Coal is a fossil fuel.' },
  ],
  '焼': [
    { jp: 'やきもちを焼くなよ。', en: 'You shouldn\'t be jealous.' },
    { jp: '彼女、やきもち焼くだろうね。', en: 'She will be jealous.' },
  ],
  '照': [
    { jp: 'レーザ照射中！！要注意！！', en: 'Laser is currently operating! Use extreme caution!' },
    { jp: 'すべての照明が消えた。', en: 'All the lights went out.' },
  ],
  '燃': [
    { jp: '火はまだ燃えてるの？', en: 'Are the fires still burning?' },
  ],
  '燥': [
    { jp: '唇は乾燥してますか？', en: 'Are your lips dry?' },
    { jp: '肌が乾燥しています。', en: 'I have dry skin.' },
  ],
  '爆': [
    { jp: '僕たちは爆笑した。', en: 'We roared with laughter.' },
    { jp: '敵は橋を爆破した。', en: 'The enemy blew up the bridge.' },
  ],
  '片': [
    { jp: '靴の片方がなくなった。', en: 'I lost one of my shoes.' },
    { jp: '靴下の片方、どこいった？', en: 'Where\'s my other sock?' },
  ],
  '版': [
    { jp: '辞書は最新版だよ。', en: 'The dictionary is up to date.' },
    { jp: '2005年に出版された本です。', en: 'The book was published in 2005.' },
  ],
  '玉': [
    { jp: '玉ねぎが苦手です。', en: 'I don\'t like to eat onions.' },
    { jp: 'この飴玉でかすぎ。', en: 'This candy is too big.' },
  ],
  '珍': [
    { jp: 'これは珍しいことなの？', en: 'Is this uncommon?' },
    { jp: 'これは極めて珍しい。', en: 'This is a very rare specimen.' },
  ],
  '瓶': [
    { jp: '哺乳瓶は煮沸消毒すること。', en: 'Boil the milk bottles.' },
    { jp: '「哺乳瓶」なんて言葉、久々に聞いたよ。', en: 'It\'s been a long time since I\'ve heard the word "baby bottle".' },
  ],
  '甘': [
    { jp: '甘い物好きですか。', en: 'Do you care for sweets?' },
    { jp: 'このりんごは甘い。', en: 'This apple is sweet.' },
  ],
  '畜': [
    { jp: '牧場で暮らす動物は家畜です。', en: 'The animals which live on farms are domesticated.' },
    { jp: '家畜はみんなまるまるしている。', en: 'Their cattle are all fat.' },
  ],
  '略': [
    { jp: '省略は立派な表現技法の一つであり、多くの文法書でも紹介されています。', en: 'Omission is a perfectly good example of an expression technique, and is brought up in many grammar books.' },
    { jp: 'a⨯bはabと略記される。', en: 'a⨯b is abbreviated as ab.' },
  ],
  '畳': [
    { jp: 'トムは傘を畳んだ。', en: 'Tom folded up his umbrella.' },
    { jp: '洗濯物畳んでくれる？', en: 'Can you fold the washing?' },
  ],
  '療': [
    { jp: '彼は目下療養中だ。', en: 'He\'s under treatment.' },
    { jp: '転換療法は拷問です。', en: 'Conversion therapy is torture.' },
  ],
  '皮': [
    { jp: '捕らぬ狸の皮算用。', en: 'Don\'t count your chickens.' },
    { jp: '取らぬ狸の皮算用。', en: 'Don\'t count your chickens before they hatch.' },
  ],
  '皿': [
    { jp: 'スープ用のお皿ある？', en: 'Do you have a bowl for soup?' },
    { jp: 'お皿が汚れています。', en: 'The plate is dirty.' },
  ],
  '省': [
    { jp: '国務省で働いている。', en: 'I work in the State Department.' },
    { jp: '彼は休暇で帰省中です。', en: 'He is home on leave.' },
  ],
  '県': [
    { jp: '私の両親は愛知県で生まれた。', en: 'My parents were born in Aichi Prefecture.' },
    { jp: '愛知県の県庁所在地は名古屋市です。', en: 'Aichi Prefecture\'s capital is Nagoya City.' },
  ],
  '短': [
    { jp: 'ゾウの尻尾は短い。', en: 'The elephant has a short tail.' },
  ],
  '砂': [
    { jp: 'サハラ砂漠は拡大しています。', en: 'The Sahara Desert is expanding.' },
    { jp: 'サハラ砂漠は世界で最も大きい砂漠です。', en: 'The Sahara is the largest desert in the world.' },
  ],
  '硬': [
    { jp: '鉄は金よりも硬い。', en: 'Iron is harder than gold.' },
    { jp: '一番硬いチーズは何ですか？', en: 'What is the hardest cheese?' },
  ],
  '磨': [
    { jp: '歯磨きをしてたの。', en: 'I was brushing my teeth.' },
    { jp: '腕を磨いています。', en: 'I\'m honing my skills.' },
  ],
  '祈': [
    { jp: '毎日お祈りしてるの？', en: 'Do you pray every day?' },
    { jp: 'トムは祈っている。', en: 'Tom is praying.' },
  ],
  '祝': [
    { jp: '旧暦では何月ですか？', en: 'What month is it in the old calendar?' },
    { jp: '誕生日をお祝いしました。', en: 'I celebrated a birthday.' },
  ],
  '祭': [
    { jp: '復活祭、おめでとうございます。', en: 'Happy Easter!' },
    { jp: '学祭っていつなの？', en: 'When is your school festival?' },
  ],
  '秒': [
    { jp: '後数秒で私は絶望の分岐点を越えるのだ。', en: 'In a few seconds I would have overcome the desperation threshold.' },
    { jp: '１００メートル、１０秒切れる？', en: 'Will they break the ten-second mark in the hundred-metre race?' },
  ],
  '移': [
    { jp: '車の移動をお願いします。', en: 'Please move your car out of here.' },
    { jp: '彼は机を右に移動させた。', en: 'He moved the desk to the right.' },
  ],
  '税': [
    { jp: '税関はどこですか。', en: 'Where is the Customs Service?' },
    { jp: '彼は減税を唱えた。', en: 'He advocated reduction of taxes.' },
  ],
  '章': [
    { jp: '興味深い文章だね。', en: 'That\'s an interesting sentence.' },
    { jp: '彼は文章がうまい。', en: 'He is a good writer.' },
  ],
  '童': [
    { jp: 'イソップ童話に『すっぱい葡萄』という話があります。', en: 'In Aesop\'s Fables is a story called "Sour Grapes".' },
    { jp: 'グリム兄弟はドイツ中の童話を収集した。', en: 'The Brothers Grimm collected fairy tales from all over Germany.' },
  ],
  '競': [
    { jp: '競争は激しくなった。', en: 'The competition has become fierce.' },
    { jp: '徒競走って、大っ嫌い。', en: 'I have a large hatred of the foot race.' },
  ],
  '竹': [
    { jp: '真直ぐにその家から竹林まで伸びた道路は石畳で整備されておる。', en: 'The path stretching from that house to the bamboo thicket was laid with stone paving.' },
    { jp: '庭に竹が生えている。', en: 'There\'s bamboo growing in the garden.' },
  ],
  '符': [
    { jp: '切符持ってますか？', en: 'Do you have a ticket?' },
    { jp: 'もう切符は買ったの？', en: 'Have you bought your ticket already?' },
  ],
  '筆': [
    { jp: 'とある映画を文庫化した—いや、映画の為に書かれたシナリオを小説として加筆修正し、日本語にローカライズしたものだ。', en: 'A certain movie was novelized - rather it was a scenario written for a movie that was expanded as a novel and localized to Japanese.' },
    { jp: 'その国の美しさは筆舌に尽くし難い。', en: 'The beauty of that country is beyond description.' },
  ],
  '筒': [
    { jp: '封筒と紙が要るんだ。鉛筆かペンも欲しいな。', en: 'I need an envelope and a piece of paper. I also need either a pencil or a pen.' },
    { jp: 'ちょっと大きいけど、この封筒でいいや。大は小を兼ねるって言うし。', en: 'It might be a bit big but this envelope will do just fine. It\'s better to be too big than too small.' },
  ],
  '算': [
    { jp: 'お尋ねしたいのですが、Tatoebaで算用数字を使う時は、半角と全角ではどちらを使った方がいいですか？', en: 'I have an inquiry. When using arithmetic numbers in Tatoeba, should I use half-width or full-width?' },
    { jp: '捕らぬ狸の皮算用。', en: 'Don\'t count your chickens.' },
  ],
  '管': [
    { jp: '管理者さんですよね？', en: 'You\'re the person in charge, right?' },
    { jp: '管理人に聞いてみて。', en: 'Ask an administrator.' },
  ],
  '築': [
    { jp: 'お前んちって、新築？', en: 'Is your house new?' },
    { jp: 'トムの家は新築なの？', en: 'Is Tom\'s house new?' },
  ],
  '簡': [
    { jp: 'あれは簡単すぎた？', en: 'Was that too easy?' },
    { jp: '「ゲティスバーグ演説」は簡潔なスピーチです。', en: '"The Gettysburg Address" is a concise speech.' },
  ],
  '籍': [
    { jp: '君の本籍地を教えて下さい。', en: 'Please give me your permanent address.' },
    { jp: 'アメリカ国籍の方ですか？', en: 'Are you US citizens?' },
  ],
  '粉': [
    { jp: 'このケーキを作るためには膨らし粉と無塩バターが必要だ。', en: 'In order to make this cake you need baking powder and unsalted butter.' },
    { jp: '何か重い兇器でやられたらしく、頭蓋骨は粉砕された。', en: 'His head had been shattered by a savage blow from some heavy weapon.' },
  ],
  '粒': [
    { jp: '大粒の雪が降った。', en: 'Snow fell in large flakes.' },
    { jp: '顔にご飯粒が付いてるよ。', en: 'You have some rice on your face.' },
  ],
  '糸': [
    { jp: '赤い糸がないです。', en: 'There\'s no red thread.' },
    { jp: 'この糸は丈夫だよ。', en: 'This string is strong.' },
  ],
  '紅': [
    { jp: '秋になると紅葉します。', en: 'The leaves turn red in the fall.' },
    { jp: '秋には山全体が紅葉する。', en: 'In autumn all the leaves on the mountain change color.' },
  ],
  '純': [
    { jp: 'それは純金ですか？', en: 'Is it fine gold?' },
    { jp: 'それって、純金なの？', en: 'Is that pure gold?' },
  ],
  '細': [
    { jp: 'とても心細いです。', en: 'I\'m so lonely.' },
  ],
  '紹': [
    { jp: 'テレビで商品が紹介された途端、注文の電話がじゃんじゃんかかってきた。', en: 'As soon as the product was introduced on TV, the calls for orders started pouring in.' },
    { jp: 'それを皮切りとして欧州の詩や文学を多数紹介するようになりました。', en: 'With that as a start many European poems and much literature came to be introduced.' },
  ],
  '絡': [
    { jp: '他の写真をご覧になりたい場合は、どうぞ当方までご連絡ください。電子メールでお送り致します。', en: 'If you wish to see other pictures please contact us. We will send them to you by e-mail.' },
    { jp: 'トムは電子メールでメアリーと連絡を取ることができる。', en: 'Tom can get in touch with Mary by email.' },
  ],
  '綿': [
    { jp: '石綿金網を発見された場合飛散防止のため石綿の部分を水に濡らしてビニール袋に包み安全を確保して下さい。', en: 'In the event that asbestos-covered mesh is found, ensure its safety by damping the asbestos portion to prevent dust release and wrapping in a plastic bag.' },
    { jp: 'このブラウスは綿100%です。', en: 'This blouse is cotton.' },
  ],
  '総': [
    { jp: '全体は部分の総和に勝る。', en: 'The whole is more than the sum of its parts.' },
    { jp: '彼は全国高等学校総合体育大会ボクシング競技大会に参加しました。', en: 'He entered the national high school boxing championship competition.' },
  ],
  '緑': [
    { jp: '子供のころ、母は毎日私に緑色野菜を食べさせました。', en: 'When I was a child, my mother made me eat green vegetables every day.' },
    { jp: '今日のお弁当もだけど、五木さんと田中さんの作るメニューは緑黄色野菜が少ないんじゃない？', en: 'About today\'s packed-lunch, the menus prepared by Itsuki and Tanaka are low in beta-carotene-rich vegetables again aren\'t they?' },
  ],
  '線': [
    { jp: '遠い地平線を見て！', en: 'Look at the distant horizon!' },
    { jp: '西部戦線異状なし', en: 'All quiet on the Western Front.' },
  ],
  '編': [
    { jp: 'ドヴォルザークの『スラヴ舞曲集』はもともとピアノ連弾曲として作られたが、後に作曲者自身の手で管弦楽用にも編曲された。', en: 'Dvořák\'s "Slavonic Dances" were originally composed as piano pieces for four hands, but were later arranged for orchestra by the composer himself.' },
    { jp: '列車は１５両編成だ。', en: 'The train is made up of fifteen cars.' },
  ],
  '練': [
    { jp: '毎日練習あるのみよ。', en: 'You just have to practise every day.' },
    { jp: 'トムは練習が必要だな。', en: 'Tom needs to practice.' },
  ],
  '績': [
    { jp: '成績のことが心配なの？', en: 'Are you worried about your grades?' },
    { jp: '学校の成績って良かった？', en: 'Did you do well in school?' },
  ],
  '缶': [
    { jp: '缶の中は空っぽよ。', en: 'The can is empty.' },
    { jp: '缶ビール１つ、いくら？', en: 'How much does a can of beer cost?' },
  ],
  '署': [
    { jp: '「警察だ。ちょっと署まで来てもらおうか」「な、なんで？」「こんな街中でドンパチやって罪にならないわけないだろうが！！」', en: '"This is the police. Would you mind coming down to the station?" "W-why?" "You can\'t think it\'s not a crime to go shooting guns off in the middle of town?!"' },
    { jp: '私は書類に署名した。', en: 'I attached my signature to the document.' },
  ],
  '群': [
    { jp: '私は羊の群を見た。', en: 'I saw a flock of sheep.' },
    { jp: 'これは抜群にいいね。', en: 'This is by far the best of all.' },
  ],
  '羽': [
    { jp: '１羽の鳥が空を飛んでいた。', en: 'A bird was flying in the sky.' },
    { jp: '数羽の鳥が空を飛んでいた。', en: 'Several birds were flying in the air.' },
  ],
  '翌': [
    { jp: '翌月にはＮＨＬ初シャットアウトゲームを記録しＮＨＬスーパーゴーリーとしての才能を見せた。', en: 'The next month he achieved his first NHL shutout and showed the talent of an NHL super goalie.' },
    { jp: 'トムは月曜日に来て翌日帰った。', en: 'Tom came on Monday and went back the day after.' },
  ],
  '耕': [
    { jp: '私がこの土地を耕すのは初めてだ。', en: 'This is the first time I\'ve ever plowed this land.' },
    { jp: '３００年間、彼らは周囲の土地を耕作してきた。', en: 'For three hundred years they have farmed the surrounding land.' },
  ],
  '肌': [
    { jp: '肌がつるつるだね。', en: 'The skin is smooth, isn\'t it?' },
    { jp: '肌を焼きたいんだよ。', en: 'I want to get a suntan.' },
  ],
  '肩': [
    { jp: '彼女の主張は正しかった。彼女が肩身の狭い思いをする必要などなかったのだ。', en: 'Her insistence was right. She did not need to feel ashamed.' },
    { jp: '背筋を伸ばして、肩の力を抜いてください。', en: 'Please keep your back straight and relax your body.' },
  ],
  '肯': [
    { jp: '私の言葉を誰も肯定しなかった。', en: 'Nobody confirmed what I said.' },
    { jp: 'トムは噂を肯定も否定もしなかった。', en: 'Tom neither confirmed nor denied the rumors.' },
  ],
  '胃': [
    { jp: '底なしの胃袋ですね！', en: 'It\'s a bottomless stomach!' },
    { jp: 'トムは胃腸が弱い。', en: 'Tom has a weak stomach.' },
  ],
  '胸': [
    { jp: 'トムは度胸がない。', en: 'Tom lacks courage.' },
    { jp: '度胸が足りないぞ。', en: 'You don\'t have the guts.' },
  ],
  '脂': [
    { jp: 'あたし、低脂肪乳ね。', en: 'Low-fat milk for me.' },
    { jp: 'トムの体脂肪率は7%だ。', en: 'Tom has 7% body fat.' },
  ],
  '脳': [
    { jp: 'トムは脳外科医だ。', en: 'Tom is a brain surgeon.' },
    { jp: '脳は頭の中にある。', en: 'The brain is inside the head.' },
  ],
  '腕': [
    { jp: '鉄腕アトムが国を危険から守った。', en: 'Astro Boy protected the country from danger.' },
    { jp: '腕時計を買って、次の日になくしてしまった。', en: 'I bought a watch and I lost it the next day.' },
  ],
  '腰': [
    { jp: '腰痛がひどいんです。', en: 'I have a bad pain in my lower back.' },
    { jp: 'トムは腰痛を訴えていた。', en: 'Tom was complaining of back pain.' },
  ],
  '膚': [
    { jp: '慢性の皮膚炎があります。', en: 'I have chronic dermatitis.' },
    { jp: '皮膚が赤紫色に変色している。', en: 'The skin is changing to a purplish red.' },
  ],
  '臓': [
    { jp: 'トムは心臓が悪い。', en: 'Tom has a weak heart.' },
    { jp: '心臓がドキドキした。', en: 'My heart beat strongly.' },
  ],
  '臣': [
    { jp: '外務大臣がその会議に出席した。', en: 'The foreign minister attended the talks.' },
    { jp: 'フランスのクシュネル外務大臣はG14体制を提唱した。', en: 'Kouchner, the French Minister for Foreign Affairs, advocated the G14 group.' },
  ],
  '舟': [
    { jp: 'トムは舟の上で生活している。', en: 'Tom lives on a boat.' },
    { jp: 'ドジャースとジャイアンツが呉越同舟でやってきた。', en: 'The Dodgers and Giants, traditional rivals, arrived together.' },
  ],
  '航': [
    { jp: 'その船は、出航した。', en: 'The ship set sail.' },
    { jp: 'その船は航海中です。', en: 'The ship is at sea.' },
  ],
  '般': [
    { jp: '極めて一般的なことだ。', en: 'It\'s very common.' },
    { jp: '極めて一般的な名前です。', en: 'It\'s a very common name.' },
  ],
  '芸': [
    { jp: '私は芸術が好きだ。', en: 'I like art.' },
    { jp: '釣りね芸術の一つ。', en: 'Trolling is a art.' },
  ],
  '荒': [
    { jp: 'この話題になるといつも荒れる。', en: 'It\'s always rough when this topic comes up.' },
    { jp: '吹き荒れる嵐の予感に、僕らはこぞって震えあがった。', en: 'At this hint of the violent storm to come we shuddered as one.' },
  ],
  '荷': [
    { jp: 'ちょうど着いたばかり。まだスーツケースから荷物を出してもいない。', en: 'I\'ve just arrived. I haven\'t even emptied my suitcases yet.' },
    { jp: '目が覚めたら11時だし、着替えしてたら荷物が来るし、昨日は洗い物やってなかったしで……もう、滅茶苦茶。', en: 'When I woke up, it was already 11 o\'clock, and, while I was changing clothes, my package arrived, and I didn\'t do the dishes yesterday... Everything\'s a mess already.' },
  ],
  '菓': [
    { jp: '和菓子が食べたい。', en: 'I want to eat Japanese sweets.' },
    { jp: 'このお菓子は甘いです。', en: 'This candy is sweet.' },
  ],
  '菜': [
    { jp: 'どんな野菜が好き？', en: 'What kinds of vegetables do you like?' },
    { jp: '野菜を食べなさい。', en: 'Eat your vegetables.' },
  ],
  '著': [
    { jp: '著作権と言えば、トムでしょ！', en: 'If talking about copyright, I guess we need Tom!' },
    { jp: 'それは著作権で保護されてるよ。', en: 'It\'s copyrighted.' },
  ],
  '蒸': [
    { jp: '今日は蒸し暑いね？', en: 'It\'s muggy today, isn\'t it?' },
    { jp: '水は蒸発しました。', en: 'The water evaporated.' },
  ],
  '蔵': [
    { jp: '冷蔵庫の中は冷たい。', en: 'It\'s cold inside the fridge.' },
    { jp: '冷蔵庫は完全に空だ。', en: 'The fridge is completely empty.' },
  ],
  '薄': [
    { jp: 'あの人は影が薄い。', en: 'He is always in the background.' },
    { jp: '成功する望みは薄い。', en: 'There is little hope of my success.' },
  ],
  '虫': [
    { jp: '先進国では虫歯が激減し、自分の歯で一生食べられる人が増えています。', en: 'Cavities have become rarer in the developed countries and more people will be able to eat with their own teeth throughout their life.' },
    { jp: '虫の居所が悪いの？', en: 'Did you wake up on the wrong side of the bed?' },
  ],
  '血': [
    { jp: '小泉首相は決して冷血漢ではない。', en: 'Prime Minister Koizumi is certainly not a cold-blooded man.' },
  ],
  '衣': [
    { jp: 'この衣装どう思う？', en: 'What do you think of this outfit?' },
    { jp: '馬子にも衣装だな。', en: 'Clothes make the man.' },
  ],
  '袋': [
    { jp: '手袋が必要ですか？', en: 'Do you need gloves?' },
    { jp: '紙袋に入れてください。', en: 'Please put it in a paper bag.' },
  ],
  '被': [
    { jp: '帽子を被りなさい。', en: 'Put on the hat.' },
    { jp: '被害妄想に囚われるな。', en: 'Don\'t get paranoid.' },
  ],
  '装': [
    { jp: '彼女は服装にうるさい。', en: 'She is particular about what she wears.' },
    { jp: '彼女は服装にかまわない。', en: 'She is careless about dress.' },
  ],
  '裏': [
    { jp: '彼は裏口入学した。', en: 'He bought his way into college.' },
    { jp: '裏口が全開だったよ。', en: 'The back door was wide open.' },
  ],
  '補': [
    { jp: '自分を補うために常識的な方々と親しくさせていただいております。', en: 'So as to compensate for myself, I befriend the conventional.' },
    { jp: '后の候補は6名いた。', en: 'There were six candidates for queen.' },
  ],
  '複': [
    { jp: '高校になってからは、クロスカントリースキー、ノルディック複合競技の大阪大会および近畿大会で幾度となく優勝。', en: 'In high school, I won the Osaka and Kinki championships in cross-country skiing and Nordic combined skiing on countless occasions.' },
    { jp: 'あの絵は複製です。', en: 'That painting is a copy.' },
  ],
  '角': [
    { jp: '彼は次の角に居る。', en: 'He\'s at the next corner.' },
    { jp: '直角は９０度である。', en: 'A right angle has ninety degrees.' },
  ],
  '触': [
    { jp: '読書を通して、様々な考え方に触れる。', en: 'Through reading, I\'m able to experience many different perspectives.' },
    { jp: '彼の遺言書は、彼女については触れていなかった。', en: 'His will did not mention her.' },
  ],
  '訓': [
    { jp: '５日間で地獄の特訓だ！', en: 'For 5 days we will train like hell!' },
    { jp: 'トムは犬の訓練士なんだ。', en: 'Tom is a dog trainer.' },
  ],
  '設': [
    { jp: '建設的な提案だよ。', en: 'That\'s a constructive suggestion!' },
    { jp: '新校舎を建設中です。', en: 'A new school building is being built.' },
  ],
  '詞': [
    { jp: '「－osity」は語尾が「－ous」の形容詞から作られる抽象名詞の語尾。', en: '\'-osity\' is an abstract noun word ending created from the ending of an \'-ous\' adjective.' },
    { jp: '不定詞の形容詞的用法には２種類あり、①限定用法、②叙述用法。②はもちろん主格補語です。', en: 'There are two ways of using the infinitive as an adjective, 1. attributive, 2. predicative. Naturally 2. is a subject complement.' },
  ],
  '詰': [
    { jp: 'リンゴがたくさん詰め込まれた紙袋ってオシャレだよね。', en: 'A paper bag filled to the brim with apples looks very cool, right?' },
    { jp: 'みなプロジェクトを抱えているので、差し詰め、君しか適任者はいない。', en: 'Everybody has their own projects on, so after all you are the only suitable candidate.' },
  ],
  '誌': [
    { jp: '彼はタイム誌の記者です。', en: 'He is a reporter for Time magazine.' },
    { jp: 'トムは『タイム』誌の表紙を飾った。', en: 'Tom appeared on the cover of Time magazine.' },
  ],
  '課': [
    { jp: '放課後って空いてる？', en: 'Are you free after school?' },
    { jp: '放課後、テニスするの？', en: 'Will you play tennis after school?' },
  ],
  '諸': [
    { jp: '貧乏は諸悪の根源。', en: 'Poverty is the root of all evil.' },
    { jp: '諸神は悪を雷で打つという。', en: 'They say the gods smite evil with thunderbolts.' },
  ],
  '講': [
    { jp: '青河氏は講談社児童文学新人賞佳作を受賞する。', en: 'Aoga receives an honourable mention at the Kodansha Award for New Writers of Children’s Literature.' },
    { jp: '面白い講演だった？', en: 'Was it an interesting speech?' },
  ],
  '谷': [
    { jp: '人生山あり谷あり。', en: 'A man\'s life has its ups and downs.' },
    { jp: '人生は山あり谷あり。', en: 'Life has its ups and downs.' },
  ],
  '豊': [
    { jp: '創造性豊かな奴だな。', en: 'You\'re a pretty creative guy.' },
    { jp: 'トムは感受性豊かだ。', en: 'Tom is sensitive.' },
  ],
  '象': [
    { jp: '象は草食動物です。', en: 'Elephants are herbivores.' },
    { jp: '象は肉を食べない。', en: 'Elephants don\'t eat meat.' },
  ],
  '貝': [
    { jp: 'あの子は海辺の貝殻売りだ。', en: 'She sells seashells by the seashore.' },
    { jp: '火力とお鍋と貝の種類によるわ。', en: 'It depends on the strength of the flame, the pan used and the type of ingredients.' },
  ],
  '貨': [
    { jp: 'もう仮想通貨には手を出さない。', en: 'I don\'t mess with crypto anymore.' },
    { jp: '自国通貨建てで海外に投資することがいつも利益を生むとは限らない。', en: 'Investing abroad on your national currency basis will not always be profitable.' },
  ],
  '販': [
    { jp: '昨夜、この自動販売機は愚連隊によって壊されました。', en: 'This vending machine was destroyed by hoodlums last night.' },
    { jp: '灯油の販売車が来た。', en: 'A truck selling kerosene came.' },
  ],
  '貯': [
    { jp: '彼は１００ドル貯金した。', en: 'He saved a hundred dollars.' },
    { jp: '彼は貯金を増やした。', en: 'He added to his savings.' },
  ],
  '貿': [
    { jp: '父は貿易業に従事している。', en: 'My father is engaged in foreign trade.' },
    { jp: '日本との貿易は容易ではない。', en: 'Trading with Japan is not easy.' },
  ],
  '賞': [
    { jp: 'アカデミー授賞式は、ハリウッド最大の華やかな催しだ。', en: 'The Oscar ceremonies are Hollywood\'s biggest extravaganza.' },
    { jp: '彼は文学賞を受賞しました。', en: 'He won a literary award.' },
  ],
  '贈': [
    { jp: 'エリザベス女王の即位５０年の記念に贈られたものみたいです。', en: 'It seems it was a gift for the 50th anniversary of Queen Elizabeth\'s accession to the throne.' },
    { jp: '贈り物があります。', en: 'I have some gifts.' },
  ],
  '超': [
    { jp: 'これは、超腹が立つ！', en: 'This makes me so angry!' },
    { jp: '髪の毛が超ボサボサ！', en: 'My hair is so messy!' },
  ],
  '跡': [
    { jp: 'GPSで追跡した。', en: 'I tracked it via GPS.' },
    { jp: 'GPSで追跡する。', en: 'I track it with GPS.' },
  ],
  '踊': [
    { jp: '一緒に踊りませんか？', en: 'Do you want to dance with me?' },
    { jp: 'あの子と踊りたいな。', en: 'I want to dance with her.' },
  ],
  '軍': [
    { jp: '私は海軍に入った。', en: 'I went into the navy.' },
    { jp: '彼は陸軍に入った。', en: 'He entered the army.' },
  ],
  '軒': [
    { jp: '２０軒もの家が焼け落ちた。', en: 'No less than twenty houses were burnt down.' },
    { jp: '１０軒の家がすっかり燃えた。', en: 'Ten houses were burned down.' },
  ],
  '軟': [
    { jp: 'もっと柔軟になりなよ。', en: 'You should be more open-minded.' },
    { jp: '木工芸では、木を、硬木、軟木と、唐木に分類します。', en: 'In woodworking, we classify wood as hardwood, softwood or exotic wood.' },
  ],
  '軽': [
    { jp: '軽い食事をとった。', en: 'I had a light supper.' },
    { jp: '症状は軽いですよ。', en: 'Your condition isn\'t serious.' },
  ],
  '輪': [
    { jp: '指輪を探してるの？', en: 'Are you looking for a ring?' },
    { jp: '指輪を盗みました。', en: 'I stole the ring.' },
  ],
  '輸': [
    { jp: '輸入車の需要は強い。', en: 'Imported cars are in strong demand.' },
    { jp: 'これはドイツからの輸入車です。', en: 'This is a car imported from Germany.' },
  ],
  '辛': [
    { jp: '辛いんじゃない？違う？', en: 'You\'re in pain, aren\'t you?' },
  ],
  '農': [
    { jp: '私は農場で働いた。', en: 'I worked on a farm.' },
    { jp: '私の妻が農場へ行った。', en: 'My wife went to the farm.' },
  ],
  '辺': [
    { jp: 'この辺りに居座るな。', en: 'Don\'t stay around here.' },
    { jp: '彼は辺りを見回した。', en: 'He looked about.' },
  ],
  '述': [
    { jp: 'トムは秘書に口述筆記で手紙を書かせた。', en: 'Tom dictated a letter to his secretary.' },
    { jp: '私は開会の辞を述べた。', en: 'I gave an opening address.' },
  ],
  '逆': [
    { jp: 'オリンピックのせいで完全に昼夜逆転してる。', en: 'My sleeping patterns have been turned upside down due to the Olympics.' },
    { jp: 'さっきの試合、最後に逆転されておまえが負けるんじゃないかと思ってハラハラしたぞ。', en: 'The near-comeback at the end of the game earlier put me on the edge of my seat thinking that you might lose.' },
  ],
  '造': [
    { jp: 'これって捏造なの？', en: 'Is this a hoax?' },
    { jp: '脳の構造は複雑だ。', en: 'The structure of the brain is complicated.' },
  ],
  '郊': [
    { jp: '彼は東京近郊に住んでいる。', en: 'He lives in the suburbs of Tokyo.' },
    { jp: '山田氏は東京の郊外に住んでいる。', en: 'Mr Yamada lives in the suburbs of Tokyo.' },
  ],
  '郵': [
    { jp: 'お電話ありがとうございます。こちらは日本郵便再配達受付センターです。', en: 'Thank you for calling. This is the Japan Post Redelivery Reception Center.' },
    { jp: '郵便局まで送るよ。', en: 'I\'ll drive you to the post office.' },
  ],
  '量': [
    { jp: '減量は容易くない。', en: 'Losing weight isn\'t easy.' },
    { jp: 'トムは30kg減量した。', en: 'Tom lost 30 kilograms.' },
  ],
  '針': [
    { jp: '針に糸を通しておくれ。', en: 'Please thread the needle for me.' },
    { jp: '私は時計の針を進めた。', en: 'I advanced the hands on the clock.' },
  ],
  '鈍': [
    { jp: '疲れてる時は頭の回転が鈍いんだよ。', en: 'The gears in my head turn slowly when I\'m tired.' },
    { jp: '全体的に鈍いくせに、意外なところに鋭いよね。', en: 'Although dull in almost every aspect, you\'re sharp in the most unexpected matters.' },
  ],
  '鉄': [
    { jp: '鉄腕アトムが国を危険から守った。', en: 'Astro Boy protected the country from danger.' },
    { jp: 'そこは鉄鉱に富む。', en: 'Iron ore occurs there in abundance.' },
  ],
  '鉱': [
    { jp: 'そこは鉄鉱に富む。', en: 'Iron ore occurs there in abundance.' },
    { jp: '鉱員を２年してたよ。', en: 'I was a miner for two years.' },
  ],
  '銅': [
    { jp: '銅の原子番号は29です。', en: 'The atomic number of copper is 29.' },
    { jp: '銅像は頭を持っていない。', en: 'The statue has no head.' },
  ],
  '鋭': [
    { jp: '当社はアンケート入力、アンケート集計のお手伝いをする少数精鋭のベンチャーです。', en: 'Our company is a small but elect venture business that assists in entry and totalling of questionnaires.' },
    { jp: 'ナイフが鋭くない。', en: 'The knife is not sharp.' },
  ],
  '録': [
    { jp: '彼は記録を破った。', en: 'He has broken the record.' },
    { jp: '彼は世界記録を破った。', en: 'He broke the world record.' },
  ],
  '門': [
    { jp: '門を閉めたのは誰？', en: 'Who closed the gate?' },
    { jp: '門限は１０時です。', en: 'The curfew is at 10 pm.' },
  ],
  '防': [
    { jp: '予防接種をするの？', en: 'Will you get vaccinated?' },
    { jp: '攻撃は最大の防御。', en: 'Attack is the best form of defense.' },
  ],
  '陸': [
    { jp: '遠くに陸が見えた。', en: 'I saw land in the distance.' },
    { jp: '彼は陸軍に入った。', en: 'He entered the army.' },
  ],
  '隅': [
    { jp: 'その学校は、中・高一貫校だということを頭の片隅にでも入れておいて下さい。', en: 'Bear in mind that that school is an integrated junior high and high school.' },
    { jp: '隅から隅まで探したの？', en: 'Have you searched everywhere?' },
  ],
  '階': [
    { jp: '階段から落ちたよ。', en: 'I fell down the stairs.' },
    { jp: 'この階段は何段あるの？', en: 'How many steps does this staircase have?' },
  ],
  '隻': [
    { jp: '隻腕剣士の活躍が注目を集めました。', en: 'The success of the one-armed swordsman caught a lot of attention.' },
    { jp: '３隻の船が女王から彼に与えられた。', en: 'Three ships were given to him by the queen.' },
  ],
  '雇': [
    { jp: '今は新しい人を雇うことが出来ない。', en: 'We can\'t hire anyone new right now.' },
    { jp: '文書をフランス語に翻訳するためにフランス語を母国語としない人を雇うのは、水が漏れる蛇口を修理するために大工を雇うのに似ている。', en: 'Hiring a non-native French speaker to translate the document into French is like hiring a carpenter to fix your leaky faucet.' },
  ],
  '雲': [
    { jp: '雲ひとつない空だ。', en: 'There are no clouds in the sky.' },
    { jp: '雲行きが悪くなる。', en: 'The situation is growing serious.' },
  ],
  '零': [
    { jp: '時計が零時半を打った。', en: 'The clock struck half past 12.' },
    { jp: '今は零下１０度だ。', en: 'It is ten degrees below zero now.' },
  ],
  '震': [
    { jp: '地震のニュース見た？', en: 'Did you see the news report about the earthquake?' },
    { jp: '地震で家が揺れた。', en: 'The earthquake shook the house.' },
  ],
  '革': [
    { jp: 'メキシコで革命が起こった。', en: 'A revolution broke out in Mexico.' },
    { jp: '革命はテレビで放映されない。', en: 'The revolution will not be televised.' },
  ],
  '順': [
    { jp: '名前はアルファベット順です。', en: 'The names are in alphabetical order.' },
    { jp: '名前は全てアルファベット順です。', en: 'All the names are listed in alphabetical order.' },
  ],
  '預': [
    { jp: '預金したいのですが。', en: 'I want to deposit some money.' },
    { jp: '彼は銀行預金が相当ある。', en: 'He has plenty of money in the bank.' },
  ],
  '領': [
    { jp: '英国大使は大統領と直に会見することを要求した。', en: 'The English ambassador demanded to meet with the President directly.' },
    { jp: '領収書をください。', en: 'Please give me a receipt.' },
  ],
  '額': [
    { jp: '年金の額は原則として前年の物価変動にスライドして算出される。', en: 'As a general rule, the pension amount is based on price changes in the previous year.' },
    { jp: '損害額は１億ドルになるだろう。', en: 'I\'m afraid the loss will amount to one hundred million dollars.' },
  ],
  '香': [
    { jp: 'ピザの香りが好き。', en: 'I like the smell of pizza.' },
    { jp: 'バラの香りがします。', en: 'It smells of roses.' },
  ],
  '駐': [
    { jp: '違法駐車で２０ドルの罰金を科せられました。', en: 'I was fined 20 dollars for illegal parking.' },
    { jp: 'あそこに駐車するのは違法です。', en: 'It is illegal to park a car there.' },
  ],
  '骨': [
    { jp: '骨折はありません。', en: 'There are no broken bones.' },
    { jp: 'それは愚の骨頂だ。', en: 'It\'s so stupid.' },
  ],
  '麦': [
    { jp: 'ここで小麦を作る。', en: 'We grow wheat here.' },
    { jp: '僕の麦わら帽子はどこ？', en: 'Where\'s my straw hat?' },
  ],
  '黄': [
    { jp: 'バナナは黄色です。', en: 'Bananas are yellow.' },
    { jp: '黄色じゃなくて、緑。', en: 'It\'s green, not yellow.' },
  ],
  '齢': [
    { jp: 'この木は樹齢約300年です。', en: 'This tree is approximately three hundred years old.' },
    { jp: 'この木は、樹齢100年以上です。', en: 'This tree is more than a century old.' },
  ],
  '丁': [
    { jp: '丁寧におじぎをしました。', en: 'I bowed politely.' },
    { jp: 'トムは丁寧にお辞儀をした。', en: 'Tom bowed politely.' },
  ],
  '丘': [
    { jp: '丘の上で待ってる。', en: 'I\'m waiting on the hill.' },
    { jp: '家は丘の上にある。', en: 'My house is on a hill.' },
  ],
  '丹': [
    { jp: '丹精をこめてつくったこの美しい織物をごらんください。', en: 'Take a look at this beautiful embroidery made with great effort.' },
    { jp: '牡丹が大好きなの。', en: 'I really like peonies.' },
  ],
  '乃': [
    { jp: '苦虫を噛みつぶしたような顔で、綾乃ちゃんは舌打ちした。', en: 'Ayano tutted, making a sour face.' },
    { jp: '花乃、嘘泣きはたまーにやるから効果あるんだぞ。', en: 'Kano, pretending to cry has impact from being used sparingly!' },
  ],
  '乏': [
    { jp: 'アジャイは貧乏だ。', en: 'Ajay is poor.' },
    { jp: '貧乏は諸悪の根源。', en: 'Poverty is the root of all evil.' },
  ],
  '乙': [
    { jp: '花も恥じらう乙女たちに囲まれ、トムは緊張を隠せなかった。', en: 'Tom couldn\'t hide his nervousness at being surrounded by a group of excessively lovely maidens.' },
    { jp: '「どっちの訳がいいと思う？」「どっちも自然な訳で、甲乙つけがたいね」', en: '"Which translation is better?" "It\'s hard to tell, they\'re both natural translations."' },
  ],
  '也': [
    { jp: '竜也氏は穀類を商っている。', en: 'Mr Tatuya deals in grain.' },
    { jp: '拓也は素っ裸で水泳しました。', en: 'Takuya swam naked as a jaybird.' },
  ],
  '亀': [
    { jp: '亀の甲より年の功。', en: 'Experience without learning is better than learning without experience.' },
    { jp: '亀には歯が無いです。', en: 'Turtles don\'t have teeth.' },
  ],
  '井': [
    { jp: '私は福井に行っています。', en: 'I\'m going to Fukui.' },
    { jp: '井戸から水を汲んだ。', en: 'I drew water from the well.' },
  ],
  '亜': [
    { jp: '黄銅は銅と亜鉛の合金である。', en: 'Brass is an alloy of copper and zinc.' },
    { jp: '亜熱帯の気候が好きです。', en: 'I like the subtropical climate.' },
  ],
  '亥': [
    { jp: '2019年は亥年です。', en: '2019 is the Year of the Pig.' },
  
    { jp: '亥は日本語の語彙の中に含まれる漢字だ。', en: '亥 is a kanji found in the Japanese vocabulary.' },
  ],
  '亨': [
    { jp: '亨は、相当酔っ払ってて、足元がおぼついてなかったよ。', en: 'Toru was so drunk that he couldn\'t walk straight.' },
    { jp: '優太は、お店の高価な皿を割ってしまたのが亨ではなく葵だと知っていたが、葵をかばって名乗り出た亨の気持ちを察し、本当の事は言わず、ただ自分の胸の内に納めておくことにした。', en: 'Yuta knew that it was Aoi, not Toru, who had broken the expensive plate at the store, but he understood why Toru had covered for Aoi, and so he decided not to say anything on the matter and keep it to himself.' },
  ],
  '享': [
    { jp: '我々はこの勇気と私心のない指導者によって我々はよりよい生活を享受している。', en: 'We are better off for the service rendered by this brave and selfless leader.' },
    { jp: '私は既に何度も結婚生活というものを経験したが、その中のどれ一つとして私が享受すべき幸福を与えてくれるものではなかった。', en: 'I\'ve already gone through several marriages, but none of them gave me the happiness I deserve.' },
  ],
  '亭': [
    { jp: '一体、わが国の婦人は、外国婦人などと違い、子供を持つと、その精魂をその方にばかり傾けて、亭主というものに対しては、ただ義理的に操ばかりを守っていたらいいという考えのものが多い。', en: 'The women in our country are different from the women from other countries. Many think that it\'s acceptable for women to have children and devote themselves to them entirely; and, towards their husband, to simply uphold their duty and protect their chastity.' },
  
    { jp: '亭主は日本語で重要な言葉の一つだと思う。', en: 'I think 亭主 is one of the important words in Japanese.' },
  ],
  '仁': [
    { jp: '巧言令色、鮮なし仁。', en: 'Fine words and an insinuating appearance are seldom associated with true virtue.' },
  
    { jp: '仁術という表現を日常会話で使うことがある。', en: 'The expression 仁術 is sometimes used in daily conversation.' },
  ],
  '仙': [
    { jp: '私達は今日金晃丸という種類の仙人掌を買いました。', en: 'Today we bought a variety of cactus known as kinkoumaru.' },
    { jp: '世捨て人となり仙人のように山中をさまよい自給自足で誰とも接触せず野垂れ死にをしない方法とは絶対ある。', en: 'There is definitely a way to quit the world and live like an hermit in the mountains, being self-sufficient and without contact with anybody while not dying like a dog.' },
  ],
  '仮': [
    { jp: '振り仮名はどうやって付けますか？', en: 'How do I add furigana?' },
    { jp: 'この本に振り仮名をつけてください。', en: 'Please add furigana to this book.' },
  ],
  '仰': [
    { jp: '信仰は山をも動かす。', en: 'Faith can move mountains.' },
    { jp: '両親は信仰深い人なんです。', en: 'My parents are very religious people.' },
  ],
  '企': [
    { jp: 'ここは企業城下町です。', en: 'This is a company town.' },
    { jp: '兄は大企業に就職した。', en: 'My elder brother got a position in a big business.' },
  ],
  '伊': [
    { jp: '「めがねなくても大丈夫なの？」「あ、これ伊達めがねだから、頭よくなるかなと思って」', en: '"You\'re OK without your glasses?" "Ah, these are fake you see, I thought it might make me brainier..."' },
    { jp: '僕は伊勢えびにアレルギーがあります。', en: 'I\'m allergic to spiny lobster.' },
  ],
  '伍': [
    { jp: '日本は世界の経済大国に伍している。', en: 'Japan ranks among the economic powers of the world.' },
  
    { jp: '伍は日本語の語彙の中に含まれる漢字だ。', en: '伍 is a kanji found in the Japanese vocabulary.' },
  ],
  '伎': [
    { jp: '歌舞伎ってわかる？', en: 'Do you know kabuki?' },
    { jp: '歌舞伎座に行ったことある？', en: 'Have you ever been to the Kabukiza theatre?' },
  ],
  '伏': [
    { jp: '彼は床に身を伏せた。', en: 'He laid himself flat on the floor.' },
    { jp: '彼は床に伏せっている。', en: 'He is confined to bed now.' },
  ],
  '伐': [
    { jp: '彼は木の伐採をしている。', en: 'He fells trees.' },
    { jp: 'マダガスカルの熱帯林の９０％以上が伐採されました。', en: 'More than 90 percent of Madagascar\'s rainforests have been destroyed.' },
  ],
  '伯': [
    { jp: '私の伯父は幸せな人生を送り、穏やかな死を迎えました。', en: 'My uncle lived a happy life and died a peaceful death.' },
    { jp: '彼女は君の伯母だよね？', en: 'She\'s your aunt, isn\'t she?' },
  ],
  '伴': [
    { jp: '彼女がピアノで伴奏してくれます。', en: 'She will accompany me on the piano.' },
    { jp: '彼女はピアノで歌手の伴奏をした。', en: 'She accompanied the singer on the piano.' },
  ],
  '佐': [
    { jp: '佐賀県の県庁所在地は佐賀市です。', en: 'Saga Prefecture\'s capital is Saga City.' },
    { jp: '彼は大佐に昇進した。', en: 'He advanced to colonel.' },
  ],
  '佳': [
    { jp: '佳子ががりがり勉強している。', en: 'Keiko is studying furiously.' },
    { jp: '青河氏は講談社児童文学新人賞佳作を受賞する。', en: 'Aoga receives an honourable mention at the Kodansha Award for New Writers of Children’s Literature.' },
  ],
  '併': [
    { jp: '２社は合併を計画している。', en: 'The two companies plan to unite.' },
    { jp: '動画の概要欄も併せてご覧ください。', en: 'Please also take a look at the video description.' },
  ],
  '侍': [
    { jp: '俺は侍の道で生きてる。', en: 'I live by the way of the samurai.' },
    { jp: '太郎には侍の血が流れている。', en: 'A samurai\'s blood runs in Taro\'s veins.' },
  ],
  '侮': [
    { jp: '彼はまるで私たちが彼を侮辱したと言わんばかりの態度だった。', en: 'He acted as though we had insulted him.' },
    { jp: '「不具者」という言葉は侮辱かもしれませんね。', en: 'The word fugusha ("disabled") might be insulting.' },
  ],
  '侵': [
    { jp: 'それはまさに侵略行為だ。', en: 'It is nothing less than an invasion.' },
    { jp: '彼らは戦車と銃器でその国を侵略した。', en: 'They invaded the country with tanks and guns.' },
  ],
  '促': [
    { jp: '拗音（ゃ　ゅ　ょ）と促音（っ）の出し方も、加えていただけると参考になるかもしれません。', en: 'I think it might be useful if you could add how to output the diphthongs (with small ya/yu/yo) and geminate consonants (with small tsu).' },
    { jp: '今日は自宅待機を促された。', en: 'I was urged to self isolate at home today.' },
  ],
  '俊': [
    { jp: '俊夫くんはとても上手に英語を話すことが出来る。', en: 'Toshio can speak English very well.' },
  
    { jp: '俊は日本語の語彙の中に含まれる漢字だ。', en: '俊 is a kanji found in the Japanese vocabulary.' },
  ],
  '俗': [
    { jp: 'ウチは俗に言うシングルマザーの家庭だ。父親の顔を僕は知らない。', en: 'We\'re what they colloquially call a single mother family. I haven\'t seen my father\'s face.' },
    { jp: '俗説で「玉レタスを4分の1程度食べると眠くなる」と言われ、韓国では仕事前のドライバーが食べてはいけない食べ物として知られている。', en: 'In Korea, there\'s a popular theory that says that: "If you eat a quarter of an Iceberg lettuce, you will fall asleep". Thus, amongst truck drivers in Korea, lettuce is known as something that should not be eaten before work.' },
  ],
  '保': [
    { jp: '保証は一年間です。', en: 'We guarantee our products for one year.' },
    { jp: '旅行保険がありますか？', en: 'Have you got travel insurance?' },
  ],
  '修': [
    { jp: '修理お願いします。', en: 'Please fix this.' },
    { jp: '修理する価値がある？', en: 'Is it worth fixing?' },
  ],
  '俳': [
    { jp: '小学校低学年の頃、僕は父に俳句を教えられ、俳人に憧れた。七夕の願い事も「はい人になれますように」と書いた。あれから３０年、願いはかなった。今や僕は紛れもない廃人だ。', en: 'When I was in my first years of grade school, my father taught me a haiku and I longed to be a poet. On my Tanabata wish, I also wrote "Please make me a poet". Thirty years have passed and my wish has been granted. I am without doubt an invalid.' },
    { jp: 'その俳優は人気絶頂の時に死んだ。', en: 'The actor died at the height of his popularity.' },
  ],
  '俵': [
    { jp: '私は米俵をかつぐ。', en: 'I carry a bag of rice.' },
  
    { jp: '俵は日本語の語彙の中に含まれる漢字だ。', en: '俵 is a kanji found in the Japanese vocabulary.' },
  ],
  '俸': [
    { jp: '私は俸給に満足している。', en: 'I am satisfied with my salary.' },
  
    { jp: '俸は日本語の語彙の中に含まれる漢字だ。', en: '俸 is a kanji found in the Japanese vocabulary.' },
  ],
  '倉': [
    { jp: '鎌倉に住んで１２年になる。', en: 'I have lived in Kamakura for twelve years.' },
    { jp: '鎌倉は源氏ゆかりの地です。', en: 'Kamakura is a place noted in connection with the Genji family.' },
  ],
  '倣': [
    { jp: '宮廷では、平安初期には中国文化の模倣一辺倒でしたが、平安中期には日本的な美意識に基づいた文化が花開きました。', en: 'During the Heian period\'s initial stages, the imperial court completely devoted itself to imitating Chinese culture, however during the midst of the period, a culture based off of Japanese sense of beauty began to bloom.' },
    { jp: '「『ミーム』ってなぁに？『ムーミン』のこと？」「違うって。『ある情報がヒトからヒトへ模倣されながら人類の文化を形成していくもの』のこと」「何て？さっぱり分からない」', en: '"What are \'memes\'? You mean \'moomins\'?" "No. It\'s where information is imitated from person-to-person to form human culture." "What? I don\'t get it."' },
  ],
  '倫': [
    { jp: '猫を飼うのは不倫理的だよ。', en: 'It\'s unethical to own a cat as a pet.' },
    { jp: '隣の人が若い女の人と不倫しているらしいよ。', en: 'Did you hear that our neighbor was fooling around with a younger woman?' },
  ],
  '倹': [
    { jp: 'これからは、もっと倹約しなさいよ。', en: 'From now on, be more careful with your money.' },
    { jp: '彼は金をためるため何年間もけちけち倹約した。', en: 'He pinched and scraped for many years to save money.' },
  ],
  '偏': [
    { jp: 'トムは偏食じゃないよ。', en: 'Tom isn\'t a fussy eater.' },
    { jp: 'トムはかなりの偏食家です。', en: 'Tom is a very fussy eater.' },
  ],
  '健': [
    { jp: '健がやったんだよ。', en: 'Ken did that.' },
    { jp: '健康そのものだよ。', en: 'I\'m in perfect health.' },
  ],
  '偲': [
    { jp: '故人となった時、みんなからどんな風に偲ばれたいですか？', en: 'When you die, what would you like people to remember you as?' },
    { jp: '有りての厭い、亡くての偲び。', en: 'The worth of a thing is best known by the want of it.' },
  ],
  '偵': [
    { jp: '探偵小説はおもしろい。', en: 'Detective stories are amusing.' },
    { jp: '彼は探偵小説を読むことに熱中している。', en: 'He is absorbed in reading a detective story.' },
  ],
  '偽': [
    { jp: '偽造カードと暗証番号が揃えば、口座にある限りの現金が引き出されてしまう。', en: 'If they can get both a forged card and its PIN then all the cash in the bank account will be withdrawn.' },
    { jp: '男性よりも女性のほうが偽証罪を犯す。', en: 'More women than men commit perjury.' },
  ],
  '傍': [
    { jp: '傍若無人の振る舞いだね。', en: 'They are cutting loose.' },
    { jp: '時々、政治家の一人がテレビの討論会に出て傍聴者の意見を押さえつけようとする場面をみる。', en: 'Sometimes, one of the politicians can be seen trying to keep the audience\'s opinions under control during televised debates.' },
  ],
  '傑': [
    { jp: 'この本はこの詩人の最高傑作の一つだ。', en: 'This book is one of the poet\'s best works.' },
    { jp: 'たとえいくらかかろうともその傑作は手に入れると、その大富豪は言い張った。', en: 'The millionaire insisted on acquiring the masterpiece no matter how much it cost.' },
  ],
  '催': [
    { jp: '会議は明日開催されます。', en: 'The meeting will take place tomorrow.' },
    { jp: '展覧会は現在開催中です。', en: 'The exhibition is now open.' },
  ],
  '債': [
    { jp: '戦費の捻出に国債が発行された。', en: 'Bonds were issued to finance a war.' },
    { jp: 'ギリシャはもはや自分の国債を償還することができない。', en: 'Greece can no longer pay off its debts.' },
  ],
  '傷': [
    { jp: '誰も傷つけないで！', en: 'Don\'t offend anyone!' },
    { jp: 'トムは傷を負った。', en: 'Tom got wounded.' },
  ],
  '僕': [
    { jp: 'もったいない精神は僕の性に合いませんでした。', en: 'Thriftiness was against my nature.' },
    { jp: '僕は神世界の神になる。', en: 'I will become god of the celestial world.' },
  ],
  '僚': [
    { jp: '彼は僕の同僚なんだ。', en: 'He is one of my colleagues.' },
    { jp: '同僚なら大勢いるよ。', en: 'I have many colleagues.' },
  ],
  '僧': [
    { jp: '生意気な小僧がよ。', en: 'Cheeky little boy!' },
    { jp: '四十五十は鼻たれ小僧。', en: 'A 40- or 50-year-old is a snot-nosed brat.' },
  ],
  '儀': [
    { jp: '行儀よくしなさい。', en: 'Behave yourself.' },
    { jp: 'この子は行儀がいい。', en: 'This child is well-behaved.' },
  ],
  '償': [
    { jp: '金で命は償えない。', en: 'Money cannot compensate for life.' },
    { jp: '彼は死んで罪を償った。', en: 'He committed suicide to atone for his sin.' },
  ],
  '充': [
    { jp: '大いに充実した学生生活を送りたい。', en: 'I want to have a full and enriching student-life.' },
    { jp: '親は子供たちと充実した時間をすごすべきだ。', en: 'Parents should spend quality time with their children.' },
  ],
  '克': [
    { jp: '人類は多くの困難を克服してきた。', en: 'Man has got over many difficulties.' },
    { jp: '彼は妻の死をまだ克服していない。', en: 'He hasn\'t got over the death of his wife yet.' },
  ],
  '免': [
    { jp: 'うつ病だから，何を言っても無罪放免さ。', en: 'It doesn’t matter what you say, he’ll be acquitted because of depression.' },
    { jp: '免許証は持ってます。', en: 'I have a driver\'s license.' },
  ],
  '典': [
    { jp: '古典を読むのは簡単なことではない。', en: 'Reading classics is not easy.' },
    { jp: '休日は歴史書か古典を読んで過ごしたいものだ。', en: 'I\'d like to spend my holidays reading history books or classics.' },
  ],
  '兼': [
    { jp: 'ちょっと大きいけど、この封筒でいいや。大は小を兼ねるって言うし。', en: 'It might be a bit big but this envelope will do just fine. It\'s better to be too big than too small.' },
    { jp: 'トムは気兼ねすることなく自分の意見を述べたことがない。', en: 'Tom never felt comfortable expressing his own opinion.' },
  ],
  '冒': [
    { jp: '彼は冒険が好きです。', en: 'He likes adventure.' },
    { jp: '素敵に面白い冒険物語。', en: 'An absorbing tale of adventure.' },
  ],
  '冗': [
    { jp: '私は下品な冗談は好きじゃないんだが、君がそんな冗談を口にするのは私は気に入ってるんだ。', en: 'I don\'t like dirty jokes, but I get a kick out of it when you tell them.' },
  
    { jp: '冗長という表現を日常会話で使うことがある。', en: 'The expression 冗長 is sometimes used in daily conversation.' },
  ],
  '冠': [
    { jp: '李下に冠を正さず。', en: 'Avoiding the appearance of evil.' },
    { jp: 'マユコは花の冠をつけていた。', en: 'Mayuko wore a flower crown.' },
  ],
  '冴': [
    { jp: 'コーヒーを一杯飲むと頭が冴える。', en: 'I feel more alert after drinking a cup of coffee.' },
    { jp: '昨日ゆっくり休んだ分、今日は頭が冴えている。', en: 'I feel smart today, to a degree that is in proportion to the amount of good rest I had yesterday.' },
  ],
  '冶': [
    { jp: '鍛冶屋になるのは，鉄を鍛えながらだ。', en: 'It\'s by smithing that one becomes a blacksmith.' },
    { jp: '彼女は大量の本を読んで精神を陶冶した。', en: 'She cultivated her mind by reading many books.' },
  ],
  '凌': [
    { jp: 'トムとメアリーはファースーツを着て、犬と女狐の凌と凛になってたよ。', en: 'Tom and Mary put on their fursuits and turned into Ryō and Rin, a dog and a vixen.' },
  
    { jp: '凌は日本語の語彙の中に含まれる漢字だ。', en: '凌 is a kanji found in the Japanese vocabulary.' },
  ],
  '凝': [
    { jp: '背中が凝ってるの。', en: 'My back feels stiff.' },
    { jp: '肩が凝ってるんです。', en: 'My shoulders feel stiff.' },
  ],
  '凡': [
    { jp: '三者凡退となった。', en: 'The three batters were struck out quickly.' },
    { jp: '彼は平凡な男性です。', en: 'He\'s just an ordinary man.' },
  ],
  '凱': [
    { jp: '敵を蹴散らし、凱旋した俺はみなにこう呼ばれるんだ！', en: 'Having scattered the enemy before me and triumphantly returned, this is how they would herald me.' },
  
    { jp: '凱は日本語の語彙の中に含まれる漢字だ。', en: '凱 is a kanji found in the Japanese vocabulary.' },
  ],
  '凶': [
    { jp: '弾道検査の報告書によれば、この銃が殺人の凶器であるということは有り得ない。', en: 'According to the ballistics report, this gun can\'t be the murder weapon.' },
    { jp: 'あなたの犬って凶暴？', en: 'Is your dog mean?' },
  ],
  '凸': [
    { jp: 'この道路は未舗装で凸凹している。', en: 'This road is unpaved and uneven.' },
  
    { jp: '凸は日本語の語彙の中に含まれる漢字だ。', en: '凸 is a kanji found in the Japanese vocabulary.' },
  ],
  '凹': [
    { jp: 'この道路は未舗装で凸凹している。', en: 'This road is unpaved and uneven.' },
    { jp: 'なぜゴルフボールには凹みがあるの？', en: 'Why do golf balls have dimples?' },
  ],
  '刀': [
    { jp: 'こんな刀が欲しい！', en: 'I want a sword like this!' },
    { jp: '単刀直入に聞いてみた。', en: 'I asked him point-blank.' },
  ],
  '刃': [
    { jp: '付け焼刃じゃダメだ。', en: 'Mere pretense won\'t do.' },
    { jp: 'やがて彼は白刃を鞘に収めた。', en: 'Eventually, he returned the sword to its sheath.' },
  ],
  '刈': [
    { jp: '今日は芝刈りする予定なの？', en: 'Are you going to mow the lawn today?' },
    { jp: '草は刈らないといけないよ。', en: 'The grass needs cutting.' },
  ],
  '刑': [
    { jp: '死刑には反対です。', en: 'I\'m against the death penalty.' },
    { jp: '彼は死刑判決を受けた。', en: 'He was sentenced to death.' },
  ],
  '削': [
    { jp: '連邦政府の予算削減は社会保障の給付に影響が及ぶでしょう。', en: 'Federal budget cuts will take a bite out of Social Security benefits.' },
    { jp: '彼はその棒切れを狩猟ナイフで削り尖らせた。', en: 'He whittled the stick to a sharp point with his hunting knife.' },
  ],
  '剖': [
    { jp: '死体解剖の結果、絞殺と判明しました。', en: 'The postmortem showed that she had been strangled.' },
    { jp: '私たちは内臓器官を調べるためにカエルを解剖した。', en: 'We dissected a frog to examine its internal organs.' },
  ],
  '剣': [
    { jp: '剣道は日本の武道です。', en: 'Kendo is a Japanese martial art.' },
    { jp: '剣道と居合道の違いは何ですか？', en: 'What is the difference between Iaido and Kendo?' },
  ],
  '剤': [
    { jp: '台所洗剤で手に発疹ができた。', en: 'I got a rash on my hands from dishwasher detergent.' },
    { jp: '最近、石鹸や洗剤を変えましたか？', en: 'Have you recently changed your soap or laundry detergent?' },
  ],
  '剰': [
    { jp: 'トムは自信過剰だ。', en: 'Tom is overconfident.' },
    { jp: '僕、自信過剰だったかも。', en: 'Maybe I was too confident.' },
  ],
  '創': [
    { jp: 'この大学は1843年に創設された。', en: 'This university was founded in 1843.' },
    { jp: 'この大学は１９１０年に創立された。', en: 'This college was established in 1910.' },
  ],
  '功': [
    { jp: '自分はいつも人力車と牛鍋とを、明治時代が西洋から輸入して作ったものの中で一番成功したものと信じている。', en: 'I\'ve always thought that rickshaws and sukiyaki were the most successful amongst the products made from what was imported from the West during the Meiji period.' },
    { jp: 'トムがポップ歌手として成功するには、もう年齢的に無理があるんだよ。', en: 'Tom is too old to make it as a pop singer.' },
  ],
  '劣': [
    { jp: 'そのため、派遣労働者は劣悪な労働条件の下で働いている。', en: 'For that reason, temporary workers are working under inferior conditions.' },
    { jp: 'いくつかの点で、前者は後者よりも劣っていると彼は指摘した。', en: 'He pointed out that the former was inferior to the latter in some respects.' },
  ],
  '励': [
    { jp: '私たちは想像力を使うように奨励されています。', en: 'We are encouraged to use our imagination.' },
    { jp: 'そんなんじゃいつまで経っても奨励賞止まりだぞ？', en: 'With that sort of attitude you\'ll never get past the honourable-mention prizes.' },
  ],
  '勘': [
    { jp: 'お勘定をお願いね。', en: 'Could I have the bill, please?' },
    { jp: 'お勘定して下さい。', en: 'The check, please.' },
  ],
  '勧': [
    { jp: '豪雨災害で多数の命が奪われた要因の一つとして、行政が避難勧告の発令に踏み切れず先送りしたことが指摘されている。', en: 'The government\'s delay in issuing evacuation advisories has been identified as a main factor in the loss of so many lives during the torrential downpours.' },
    { jp: '私はその内気な青年にその美しい少女への愛を告白するように勧めた。', en: 'I advised the shy young man to declare his love for the beautiful girl.' },
  ],
  '勲': [
    { jp: 'その勇敢な行為で彼は勲章を貰った。', en: 'His brave deeds earned him a medal.' },
    { jp: '勲さんが来てくれて本当に嬉しいわ。', en: 'It\'s really nice having you here, Isao.' },
  ],
  '匠': [
    { jp: '俺の師匠は悠々自適の生活をしている。', en: 'My master is living a life free from worldly cares.' },
    { jp: '仏心宗と呼ばれるのは、禅宗が文字や経典をたよらずに、仏の心を師匠から弟子へと直接伝えていくことを根本宗旨としているからです。', en: 'Zen Buddhism is also called "Buddha\'s mind school" because of its basic tenet of transmitting the mind of Buddha directly from teacher to student without relying on writings or sutras.' },
  ],
  '匿': [
    { jp: '匿名の電話があったんです。', en: 'We got an anonymous call.' },
    { jp: '彼は匿名で赤十字に多額のお金を寄付した。', en: 'He anonymously donated a large sum of money to the Red Cross.' },
  ],
  '卑': [
    { jp: '卑怯な手段にいらつく。', en: 'Underhandedness really gets on my nerves.' },
    { jp: '卑怯なまねしないでよ。', en: 'Don\'t be a coward.' },
  ],
  '卓': [
    { jp: 'トムはテニスも卓球もうまい。', en: 'Tom can play both tennis and table tennis well.' },
    { jp: 'ピンポンは卓球とも呼ばれている。', en: 'Ping-Pong is also called table tennis.' },
  ],
  '博': [
    { jp: '博物館にいるんだ。', en: 'We\'re at the museum.' },
    { jp: 'この博物館は何時に閉まるの？', en: 'What time does this museum close?' },
  ],
  '即': [
    { jp: '即座に同意しました。', en: 'I agreed immediately.' },
    { jp: '消防士たちは即座に火事を消した。', en: 'The firefighters put out the fire on the spot.' },
  ],
  '却': [
    { jp: '本は図書館に返却した？', en: 'Did you take the book back to the library?' },
    { jp: '本を返却しましたか。', en: 'Did you take back the books?' },
  ],
  '卸': [
    { jp: '卸売物価は基本的に安定している。', en: 'Wholesale prices are basically flat.' },
    { jp: '今朝、山羽さんが卸で胡桃を３０キロ買いました。', en: 'This morning, Mr Yamaha bought 30 kilos of walnuts wholesale.' },
  ],
  '厄': [
    { jp: '彼が戻ったら厄介だ。', en: 'It\'ll be trouble if he comes back.' },
    { jp: '僕は家族の厄介者さ。', en: 'I\'m the black sheep of the family.' },
  ],
  '厳': [
    { jp: '彼の舅は厳しいです。', en: 'His father-in-law is strict.' },
    { jp: 'ポスト争いは厳しい。', en: 'Competition for the position is very intense.' },
  ],
  '又': [
    { jp: '必ず又の機会が来る。', en: 'There is always a next time.' },
    { jp: '又しても彼女は遅刻した。', en: 'She was late once again.' },
  ],
  '及': [
    { jp: '電子商取引が急速に普及し始めた。', en: 'Electronic commerce began to spread rapidly.' },
    { jp: '彼は世界政府という考えの普及に努めた。', en: 'He promoted the idea of world government.' },
  ],
  '叔': [
    { jp: '彼女は叔母さんに育てられた。', en: 'She was brought up by her aunt.' },
    { jp: '叔母さんには三人の子供がいる。', en: 'My aunt has three children.' },
  ],
  '叙': [
    { jp: '私は叙事詩よりも叙情詩の方が好きだ。', en: 'I like lyric better than epic.' },
    { jp: '不定詞の形容詞的用法には２種類あり、①限定用法、②叙述用法。②はもちろん主格補語です。', en: 'There are two ways of using the infinitive as an adjective, 1. attributive, 2. predicative. Naturally 2. is a subject complement.' },
  ],
  '句': [
    { jp: '日本では、３月３日は「桃の節句」と呼ばれ、女の子の成長と幸福を願う行事として、お雛様や桃の花などを飾ります。桃の花は、薄紅色のきれいな花です。花言葉は、「チャーミング」です。', en: 'In Japan, the 3rd of March is known as "Momo no Sekku". As an event which wishes upon the healthy development and happiness of young girls, Hina-dolls and peach flowers are used as decoration. Peach flowers are beautiful, light pink flowers, and symbolise "Charmingness".' },
    { jp: '私に何か文句でも？', en: 'Do you have a beef with me?' },
  ],
  '只': [
    { jp: '只今、ジョエルさんは公務中です。', en: 'Mr Joel is now on duty.' },
    { jp: '只今、僕は旅立ちの日に向けて修業中です。', en: 'Right now I\'m training in preparation for the day we set off.' },
  ],
  '叶': [
    { jp: '彼女の夢が叶った。', en: 'Her dream came true.' },
    { jp: 'いつか私の夢は叶う。', en: 'Someday my dream will come true.' },
  ],
  '司': [
    { jp: '司法書士に尋ねてみてください。', en: 'Try asking a judicial scrivener.' },
    { jp: '司法書士を訪ねてみてください。', en: 'Try paying the scrivener a visit.' },
  ],
  '吉': [
    { jp: '福沢諭吉は日本に西洋思想を広めた。', en: 'Yukichi Fukuzawa introduced Western ideas into Japan.' },
    { jp: '思い立ったが吉日！', en: 'Tomorrow never comes.' },
  ],
  '后': [
    { jp: '后の候補は6名いた。', en: 'There were six candidates for queen.' },
    { jp: '皇后はオーストラリアを訪問中である。', en: 'The empress is visiting Australia.' },
  ],
  '吏': [
    { jp: '私の友人に大学を卒業して立派な官吏となっておる者がある。ある時この人が私に曰うに、僕は学校に於て教ったことは何も役に立たなかった、しかし少しばかり学んだ哲学が僕に非常な利益を与えたと。', en: 'I have one of my friends who graduated from university and became a fine public servant. Once he told me that what he had learned from school had been useless. However, what little philosophy he had learned proved to be of great benefit.' },
  
    { jp: '吏は日本語の語彙の中に含まれる漢字だ。', en: '吏 is a kanji found in the Japanese vocabulary.' },
  ],
  '吐': [
    { jp: '最後に嘔吐したのはいつですか？', en: 'When was the last time you vomited?' },
    { jp: 'どれくらいの頻度で嘔吐してますか？', en: 'How often have you been vomiting?' },
  ],
  '吟': [
    { jp: 'モノを買う時は、よく吟味してから買いなさい。', en: 'When you buy something, examine it carefully before you buy it.' },
    { jp: '理論をより詳しく吟味する前に、いくつかの指摘をしておきたい。', en: 'I would like to make a few remarks before turning to a close examination of the theory.' },
  ],
  '呂': [
    { jp: 'お風呂の時間です。', en: 'It\'s time to take a bath.' },
    { jp: 'トムは今風呂だよ。', en: 'Tom is taking a bath now.' },
  ],
  '呈': [
    { jp: '贈呈品としていただきました。', en: 'I got it as a gift.' },
    { jp: '優勝者には、地元のカーディーラーから新車が贈呈されました。', en: 'The winner received a new car from a local car dealer.' },
  ],
  '呉': [
    { jp: 'ドジャースとジャイアンツが呉越同舟でやってきた。', en: 'The Dodgers and Giants, traditional rivals, arrived together.' },
    { jp: '山羽さんが乞食に胡桃を呉れてやりました。', en: 'Mr Yamaha gave some walnuts to a beggar.' },
  ],
  '哀': [
    { jp: 'ロシア：人質事件の犠牲となった方々に哀悼の意を表す。', en: 'Russia expresses regret for those lost in the hostage incident.' },
    { jp: '喜怒哀楽を見せるな。', en: 'Don\'t let your feelings show.' },
  ],
  '哲': [
    { jp: 'トムの専攻は哲学だ。', en: 'Tom\'s major is philosophy.' },
    { jp: '哲学は興味深い学問です。', en: 'Philosophy is an interesting field of study.' },
  ],
  '唄': [
    { jp: 'アンは妹のために子守唄を歌ってあげた。', en: 'Ann sang a lullaby for her little sister.' },
    { jp: 'aimerの唄が大好き。', en: 'I love Aimer\'s songs.' },
  ],
  '唆': [
    { jp: '今日的にも示唆に富む内容ではないでしょうか。', en: 'I think this content is still thought-provoking in recent days.' },
    { jp: '「今、行動を起こせ」という、それが伝える実際的な意味に加えて、即座の行動がなぜ重要であるかという多くの理由をも、言外に示唆していたのであった。', en: '"Act now!" he said, and in addition to his obvious meaning, he hinted that there were number of other important reasons why immediate action was needed.' },
  ],
  '唇': [
    { jp: '私は読唇できない。', en: 'I can\'t read lips.' },
    { jp: '唇が切れちゃった。', en: 'My lip split.' },
  ],
  '唯': [
    { jp: '人は火を使う唯一の動物である。', en: 'Man is the only animal that can make use of fire.' },
    { jp: '人間は火を使う唯一の動物である。', en: 'Man is the only animal that uses fire.' },
  ],
  '唱': [
    { jp: '合唱の練習はどうだった？', en: 'How was choir practice?' },
    { jp: '合唱団に入るつもりなの？', en: 'Are you going to join the glee club?' },
  ],
  '啄': [
    { jp: '「何の音かしら？」「啄木鳥のようだね」', en: '"What\'s that sound?" "It sounds like a woodpecker."' },
    { jp: '啄木鳥は、冬に向けてドングリを集めています。', en: 'The woodpecker is gathering acorns for the winter.' },
  ],
  '啓': [
    { jp: '本屋に行って、店員さんに「自己啓発書ってどこですか？」って聞いたら、「教えたら意味ないですよ」って言われた。', en: 'I went to a bookstore and asked the saleswoman, "Where\'s the self-help section?" She said if she told me, it would defeat the purpose.' },
    { jp: 'それが自己啓発の秘訣です。', en: 'It\'s the secret for improving oneself.' },
  ],
  '善': [
    { jp: '学校教育の義務的側面は子どもの学習意欲を改善させる様々な研究の多くの取り組みの中ではめったに分析されない。', en: 'The mandatory character of schooling is rarely analyzed in the multitude of works dedicated to the study of the various ways to develop within children the desire to learn.' },
    { jp: '私はこの本を丸善書店で買った。', en: 'I bought this book at Maruzen Bookstore.' },
  ],
  '喚': [
    { jp: '彼女の魔女集会は悪魔を召喚する。', en: 'Her coven conjures the demons.' },
    { jp: 'コンピュータに向かって喚いても、何も解決しないよ。', en: 'Shouting at your computer will not help.' },
  ],
  '喝': [
    { jp: '群集は勝者に拍手喝采を送った。', en: 'The crowd gave the winner a big hand.' },
    { jp: '彼の名演技に観客はやんやの喝采を送った。', en: 'His great performance drew thundering applause from the audience.' },
  ],
  '喪': [
    { jp: '喪服をクリーニングに出せますか？', en: 'Is it possible to send mourning clothes to the cleaner?' },
    { jp: '見つけたのは僕です。意識を喪っていたので、保健室に運びました。', en: 'It was I who found her. She\'d lost consciousness, so I carried her to the infirmary.' },
  ],
  '嘆': [
    { jp: '過去を嘆くより、未来のために今できることを頑張ろう。', en: 'Rather than lamenting over the past, you should focus your energy into what you can do right now for the future.' },
    { jp: '彼は悲嘆にくれた。', en: 'He abandoned himself to grief.' },
  ],
  '器': [
    { jp: '漢代にはローマガラスの容器が輸入され、5世紀には北魏でガラス容器の製作が始まりました。', en: 'Roman glass containers were imported during the Han Dynasty, and the production of glass containers began in the Northern Wei dynasty in the 5th century.' },
    { jp: 'テルミン：一九二〇年、ロシアの物理学者レフ・セルゲイヴィッチ・テルミンが作った世界初の電子楽器。', en: 'Theremin: The world\'s first electronic musical instrument, made by Russian physicist Lev Sergeivitch Termen in 1920.' },
  ],
  '噴': [
    { jp: '駅の前に噴水があります。', en: 'There is a fountain in front of the station.' },
    { jp: '火山はいつ噴火してもおかしくない。', en: 'The volcano may erupt at any moment.' },
  ],
  '嚇': [
    { jp: 'あれはただの威嚇射撃だったんです。', en: 'That was just a warning shot.' },
  
    { jp: '嚇は日本語の語彙の中に含まれる漢字だ。', en: '嚇 is a kanji found in the Japanese vocabulary.' },
  ],
  '囚': [
    { jp: '逃走した囚人はまだ捕まっていない。', en: 'The prisoner who escaped is still at large.' },
    { jp: '５人の囚人は捕まったが、残り３人は今も逃走中だ。', en: 'Five prisoners were recaptured, but three others are still at large.' },
  ],
  '圏': [
    { jp: '首都圏でも燃料が不足している。', en: 'There\'s a fuel shortage even in the Tokyo area.' },
    { jp: '現在、地震の影響で首都圏の交通網が麻痺している状況です。', en: 'Currently, it is a situation in which transport links in the metropolitan area have been paralyzed due to the earthquake.' },
  ],
  '圭': [
    { jp: '圭はその問いにギクリとさせられたが、頭を何でもないといいたそうに横に振る。', en: 'Kei is startled by that question, but shakes her head as it to say that it\'s nothing.' },
  
    { jp: '圭は日本語の語彙の中に含まれる漢字だ。', en: '圭 is a kanji found in the Japanese vocabulary.' },
  ],
  '坪': [
    { jp: '私は退職後のために９８００坪の農場を買った。', en: 'I bought an eight-acre farm for my retirement.' },
  
    { jp: '坪は日本語の語彙の中に含まれる漢字だ。', en: '坪 is a kanji found in the Japanese vocabulary.' },
  ],
  '垂': [
    { jp: 'その崖はほとんど垂直です。', en: 'The cliff is almost vertical.' },
    { jp: 'その柱は垂直になっていない。', en: 'That pole is not quite vertical.' },
  ],
  '垣': [
    { jp: '彼は垣根を飛び越えた。', en: 'He jumped over the hedge.' },
    { jp: '労働者たちは人垣を作った。', en: 'The laborers formed a human barricade.' },
  ],
  '執': [
    { jp: '市長執務室は市庁舎の中にある。', en: 'The mayor\'s office is in the city hall.' },
    { jp: '彼は原案に固執した。', en: 'He adhered to the original plan.' },
  ],
  '培': [
    { jp: '私は多くの種類のバラを栽培している。', en: 'I grow many kinds of roses.' },
    { jp: '米の栽培をしています。', en: 'I grow rice.' },
  ],
  '基': [
    { jp: '基本から始めなさい。', en: 'Start with the basics.' },
    { jp: 'これは基本のキだよ。', en: 'This is the most basic of basics.' },
  ],
  '堅': [
    { jp: '彼女は口が堅い方だ。', en: 'She keeps secrets.' },
    { jp: '彼女は口を堅く結んだ。', en: 'She pressed her lips firmly together.' },
  ],
  '堕': [
    { jp: '意思の強い人は堕落しない。', en: 'A man of strong will is not subject to corruption.' },
  
    { jp: '堕は日本語の語彙の中に含まれる漢字だ。', en: '堕 is a kanji found in the Japanese vocabulary.' },
  ],
  '堤': [
    { jp: '水は堤防を越えた。', en: 'The water ran over the banks.' },
    { jp: '堤防が洪水を防いだ。', en: 'The levee kept the floodwater back.' },
  ],
  '堪': [
    { jp: 'もう我慢できん。堪忍袋の緒が切れた。', en: 'I can\'t take this anymore. I\'ve lost my temper completely.' },
    { jp: '私は冷静でいようとしたが、とうとう堪忍袋の緒が切れた。', en: 'I tried to be calm, but finally I lost my temper.' },
  ],
  '塀': [
    { jp: '彼は塀を乗り越えた。', en: 'He climbed over the fence.' },
    { jp: '彼は塀に梯子を掛けた。', en: 'He placed the ladder against the fence.' },
  ],
  '塁': [
    { jp: '石田盗塁で３塁に進む。', en: 'Ishida advances to third on a stolen base.' },
    { jp: 'トムは３塁打を打った。', en: 'Tom hit a triple.' },
  ],
  '塊': [
    { jp: 'トムは団塊世代です。', en: 'Tom is a boomer.' },
    { jp: '夢は可能性の塊です。', en: 'Dreams are a collection of possibilities.' },
  ],
  '塑': [
    { jp: '一人物と馬丁が騎馬で一月一日に牛小屋に至たりました。 だから数奇屋のなかで、可塑物の大口が一つだけあります。', en: 'One important person and the stable boy arrived to the cow cabin the first of January. Therefore, there is only one plastic bowl left at the tea ceremony arbor.' },
  
    { jp: '塑は日本語の語彙の中に含まれる漢字だ。', en: '塑 is a kanji found in the Japanese vocabulary.' },
  ],
  '塚': [
    { jp: '高松塚古墳は、奈良県明日香村に存在する古墳。', en: 'The Takamatsuzuka burial mound is located in Asukamura, Nara prefecture.' },
  
    { jp: '塚は日本語の語彙の中に含まれる漢字だ。', en: '塚 is a kanji found in the Japanese vocabulary.' },
  ],
  '塾': [
    { jp: '塾の先生と付き合っている。', en: 'I am dating my cram school teacher.' },
    { jp: '最近塾の講師を始めた。主に数学と英語の個別指導をしている。', en: 'I recently started teaching at a cram school. Mainly I tutor maths and English to students individually.' },
  ],
  '墓': [
    { jp: 'Ｊ．Ｆ．ケネディはアーリントン墓地に埋葬された。', en: 'J.F. Kennedy was buried in Arlington Cemetery.' },
    { jp: 'お墓参りをする時は、掃除道具も持っていくといいね。', en: 'It\'s a good idea to bring cleaning equipment with you when you go to visit a grave.' },
  ],
  '墜': [
    { jp: 'トムの飛行機が墜落した場所を見つけた。', en: 'I found out where Tom\'s airplane crashed.' },
    { jp: '彼女はその墜落事故の唯一の生存者であった。', en: 'She was the only one to survive the crash.' },
  ],
  '墨': [
    { jp: 'その画家は唐墨で描いた。', en: 'The artist drew with Chinese ink.' },
    { jp: '入れ墨入れてるの？', en: 'Do you have a tattoo?' },
  ],
  '墳': [
    { jp: '直径23m(下段)及び18m(上段)、高さ5ｍの二段式の円墳である。', en: 'It is a two level style round burial mound, 23m diameter (lower level), 18m (higher).' },
    { jp: '高松塚古墳は、奈良県明日香村に存在する古墳。', en: 'The Takamatsuzuka burial mound is located in Asukamura, Nara prefecture.' },
  ],
  '壁': [
    { jp: '壁には蜘蛛がいる。', en: 'There\'s a spider on the wall.' },
    { jp: '彼は完壁な紳士だ。', en: 'He is every inch a gentleman.' },
  ],
  '壇': [
    { jp: '「大切な人が笑っている写真が祭壇や仏壇に飾られていれば、手を合わせたときに故人の声が聞こえてくると思うんです」と彼は話す。', en: '"If a photograph of the smiling face of your loved one stands on the altar at the funeral or on the family altar, when you put your hands together to pray, you can hear their voice, I think," he says.' },
    { jp: '勉強する子ども、仕事につく大人、病を克服して健康を取り戻した人、その一人一人が、祭壇にささげられたろうそくのように、信じる人すべての希望を明るくします。', en: 'Every child who learns, and every man who finds work, and every sick body that\'s made whole - like a candle added to an altar - brightens the hope of all the faithful.' },
  ],
  '壊': [
    { jp: '形あるものはいつか壊れる。', en: 'Anything having form will someday break.' },
    { jp: '壊れる前に売ってしまわなきゃ。', en: 'I should sell it while it still runs.' },
  ],
  '壌': [
    { jp: '平壌は北朝鮮の首都です。', en: 'Pyongyang is the capital of North Korea.' },
    { jp: '雨で土壌が流されてしまった。', en: 'The rain washed away the soil.' },
  ],
  '壮': [
    { jp: 'システィナ礼拝堂は、１４７３年にバティカン宮殿内に建立された壮大な礼拝堂です。', en: 'The Sistine Chapel is a vast chapel built inside the Vatican Palace in 1473.' },
    { jp: '毎年15万人もの観光客が、この島の壮大な景色と美しいビーチを楽しみに訪れます。', en: 'Every year, a hundred and fifty thousand tourists come to this island to enjoy the impressive scenery and the wonderful beaches.' },
  ],
  '壱': [
    { jp: '毎週、CoCo壱番屋に行きました。', en: 'I went to CoCo Ichiban every week.' },
  
    { jp: '壱は日本語の語彙の中に含まれる漢字だ。', en: '壱 is a kanji found in the Japanese vocabulary.' },
  ],
  '奇': [
    { jp: '奇妙な動物だった。', en: 'It was a strange beast.' },
    { jp: 'これはちょっと奇妙ね。', en: 'This is a little weird.' },
  ],
  '奈': [
    { jp: '彼は奈良に行った。', en: 'He went to Nara.' },
    { jp: '奈良は大仏で有名です。', en: 'Nara is famous for Daibutsu.' },
  ],
  '奉': [
    { jp: '政治家は国民のために奉仕すべきだ。', en: 'A politician should serve the people.' },
    { jp: '人々に奉仕することが、彼の人生の唯一の目的だ。', en: 'To serve people is his sole object in life.' },
  ],
  '奏': [
    { jp: '何か楽器を演奏するの？', en: 'Do you play a musical instrument?' },
    { jp: 'フンパを演奏しなさい。', en: 'Play the Humppa!' },
  ],
  '契': [
    { jp: '契約はお済みですか？', en: 'Did you sign the contract?' },
    { jp: 'もう契約書にサインはしましたか？', en: 'Have you already signed the contract?' },
  ],
  '奔': [
    { jp: 'トムって、本当に自由奔放ね。', en: 'Tom is truly free from inhibition.' },
    { jp: '私は奔放な生き方にあこがれている。', en: 'I long for an uninhibited way of life.' },
  ],
  '奨': [
    { jp: '私たちは想像力を使うように奨励されています。', en: 'We are encouraged to use our imagination.' },
    { jp: 'そんなんじゃいつまで経っても奨励賞止まりだぞ？', en: 'With that sort of attitude you\'ll never get past the honourable-mention prizes.' },
  ],
  '奪': [
    { jp: 'ラテン語には、主格・属格・与格・対格・奪格・呼格の6つの格がある。', en: 'In Latin, there are six cases: nominative, genitive, dative, accusative, ablative, and vocative.' },
    { jp: '２人の男がナイフを奪い合っているのを見た。', en: 'I saw two men struggling for the knife.' },
  ],
  '奮': [
    { jp: '彼は興奮しやすい。', en: 'He is prone to getting excited.' },
    { jp: '彼は大変興奮した。', en: 'He was very excited.' },
  ],
  '奴': [
    { jp: '日本には売国奴政党がいます。', en: 'There is a political party in Japan that would sell out its own country.' },
    { jp: 'スターリン時代には、強制収容所の収容者たちは国家のための奴隷となりました。', en: 'During the Stalinist era, prisoners at concentration camps became slaves in service of the state.' },
  ],
  '如': [
    { jp: '百聞は一見に如かず。', en: 'Seeing is believing.' },
    { jp: 'こんにちは、如何ですか？', en: 'Hi, how are you?' },
  ],
  '妃': [
    { jp: '王妃は王のかたわらに立っていた。', en: 'The queen stood beside the king.' },
  
    { jp: '妃は日本語の語彙の中に含まれる漢字だ。', en: '妃 is a kanji found in the Japanese vocabulary.' },
  ],
  '妄': [
    { jp: '患者さんは、せん妄状態にあります。', en: 'The patient is delirious.' },
    { jp: '小さいころは、自分が死ねば世界は消えると思っていた。幼稚な妄想！自分はいないのに世界が続くのは許せなかった。', en: 'When I was a kid, I thought that if I died the world would just disappear. What a childish delusion! I just couldn\'t accept that the world could continue to exist without me.' },
  ],
  '妊': [
    { jp: 'そんな避妊法があるかっ！', en: 'I had no idea that type of contraception existed!' },
    { jp: '２年前に子宮外妊娠をしました。', en: 'I had an ectopic pregnancy two years ago.' },
  ],
  '妙': [
    { jp: 'なんか微妙でしょ？', en: 'It\'s kind of iffy, don\'t you think?' },
    { jp: '奇妙な動物だった。', en: 'It was a strange beast.' },
  ],
  '妥': [
    { jp: '僕らは妥協するよ。', en: 'We compromised.' },
    { jp: 'ついに父は妥協した。', en: 'Finally, my father compromised.' },
  ],
  '妨': [
    { jp: '誰も真の友情を妨げられない。', en: 'Nobody can disturb a true friendship.' },
    { jp: 'その不祥事は出世の妨げとなった。', en: 'The scandal was an obstacle to his promotion.' },
  ],
  '姫': [
    { jp: '姫路駅で降りなさい。', en: 'Get off at Himeji Station.' },
    { jp: '姫は帝に赦しを乞うた。', en: 'The princess begged forgiveness from the emperor.' },
  ],
  '姻': [
    { jp: '配偶者を殺すのは、婚姻関係を終わらせる一つの方法です。ただし、良しとされることではありません。', en: 'Killing your spouse is one way to end a marriage. However, it\'s frowned upon.' },
    { jp: '２人は２月５日に婚姻届を出した。', en: 'They had their marriage registered on February 5.' },
  ],
  '姿': [
    { jp: 'メアリーは自分が容姿端麗であると分かっていた。', en: 'Mary knew that she was good-looking.' },
    { jp: '容姿端麗、頭脳明晰、運動神経抜群、家は金持ちで、ついでに学生会の副会長をしてたりもする、いわゆるパーフェクトな奴だ。', en: 'Looks, brains, reflexes, rich family and, for good measure, vice president of the student committee - in other words he\'s \'perfect\'.' },
  ],
  '威': [
    { jp: '彼は刑法の権威だ。', en: 'He is an authority on criminal law.' },
    { jp: '彼は人文学の権威だ。', en: 'He is an authority on the humanities.' },
  ],
  '娠': [
    { jp: '２年前に子宮外妊娠をしました。', en: 'I had an ectopic pregnancy two years ago.' },
    { jp: '私は妊娠してます。', en: 'I am pregnant.' },
  ],
  '娯': [
    { jp: '田舎には娯楽がない。', en: 'There\'s no entertainment in the countryside.' },
    { jp: 'トランプは人気のある娯楽だ。', en: 'Playing cards is a popular pastime.' },
  ],
  '婆': [
    { jp: 'あの老婆は誰ですか？', en: 'Who is that old woman?' },
    { jp: '老婆が焼け死んだ。', en: 'An old woman was burnt to death.' },
  ],
  '婿': [
    { jp: '花婿は30歳です。', en: 'The groom is thirty years old.' },
    { jp: '結婚直前、泥酔の父親は「何処の馬の骨か解らん奴に娘をやれん！」と花婿に怒鳴りつけた。', en: 'Just before the wedding, the drunken father shouted at the groom: "I won\'t hand out my daughter to some stranger!"' },
  ],
  '媒': [
    { jp: '空気は音の媒体だ。', en: 'The air is a medium for sound.' },
    { jp: 'マラリアは蚊が媒介する。', en: 'Malaria is carried by mosquitoes.' },
  ],
  '媛': [
    { jp: '愛媛県の県庁所在地は松山市です。', en: 'Ehime Prefecture\'s capital is Matsuyama City.' },
  
    { jp: '媛は日本語の語彙の中に含まれる漢字だ。', en: '媛 is a kanji found in the Japanese vocabulary.' },
  ],
  '嫁': [
    { jp: '花嫁はたいへん美しく見えた。', en: 'The bride looked very beautiful.' },
    { jp: '彼女は花嫁のような衣装を着ている。', en: 'She is dressed like a bride.' },
  ],
  '嫌': [
    { jp: 'みんな機嫌悪そう。', en: 'Everyone seems to be in a bad mood.' },
    { jp: 'どうして機嫌悪いの？', en: 'Why are you in a bad mood?' },
  ],
  '嬉': [
    { jp: '彼女は嬉しそうに笑っている。', en: 'She\'s beaming with happiness.' },
    { jp: 'トムは嬉しそうに微笑み返した。', en: 'Tom smiled back happily.' },
  ],
  '嬢': [
    { jp: 'この映画は貧しい女性が、列車事故による混乱で富豪の令嬢と人違いされてしまう物語です。', en: 'This movie is about a poor girl who gets mistaken for the daughter of a rich man in the confusion following a train crash.' },
    { jp: 'お嬢さん、背が高いですね。', en: 'Your daughter is tall.' },
  ],
  '孔': [
    { jp: '瞳孔は陽が差すところでは収縮します。', en: 'The pupils of the eyes contract in sunlight.' },
    { jp: '孔雀だよ。いま鳴いたのは孔雀だよ。', en: 'It\'s a peacock. It was a peacock that cried just now.' },
  ],
  '孤': [
    { jp: 'トムは孤独でした。', en: 'Tom was lonely.' },
    { jp: '私は孤独を感じた。', en: 'I felt lonely.' },
  ],
  '宏': [
    { jp: '宏美は新しいドレスを着ている。', en: 'Hiromi is wearing a new dress.' },
  
    { jp: '宏は日本語の語彙の中に含まれる漢字だ。', en: '宏 is a kanji found in the Japanese vocabulary.' },
  ],
  '宗': [
    { jp: 'キリスト教に改宗しました。', en: 'I converted to Christianity.' },
    { jp: '宗教と哲学の違いは何ですか？', en: 'What\'s the difference between religion and philosophy?' },
  ],
  '宙': [
    { jp: '宇宙では息ができる？', en: 'Can we breathe in space?' },
    { jp: 'だが宇宙は無限だ。', en: 'But the universe is infinite.' },
  ],
  '宜': [
    { jp: '普通は、id属性とname属性に同じ値を割り当てます。（訳注：異なっていても構わないが便宜上同じ値を割り当てるという事）', en: 'Usually the id and name attributes have the same value applied. (N.B. Not because it matters if they differ but just as a matter of convenience.)' },
    { jp: '旅行者の便宜をはかって高速道路沿いに多くの休憩場所がある。', en: 'There are many rest stops along the freeway for the convenience of travelers.' },
  ],
  '宣': [
    { jp: '停戦が宣言された。', en: 'A ceasefire was declared.' },
    { jp: '１８４７年、彼らは独立を宣言した。', en: 'In 1847, they declared independence.' },
  ],
  '宥': [
    { jp: '彼女は嫌がる子供を宥め賺して歯医者に連れて行った。', en: 'She coaxed and wheedled her unwilling child into going to the dentist with her.' },
  
    { jp: '宥は日本語の語彙の中に含まれる漢字だ。', en: '宥 is a kanji found in the Japanese vocabulary.' },
  ],
  '宮': [
    { jp: '世界遺産でもある宮島の「厳島神社」は、潮が満ちると神社全体がまるで海に浮かんでいるかのように見えます。その姿は神秘的で、世界中から訪れる観光客を魅了し続けています。', en: 'Also known for being a world heritage site, the Itsukushima Shrine in Miyajima gives the impression that it is floating in the ocean whenever the tides come in. Its mystical appearance continues to attract tourists from all over the world.' },
    { jp: '宮殿には高い塔がある。', en: 'The palace has a tall tower.' },
  ],
  '宰': [
    { jp: '太宰治は、自殺した。', en: 'Osamu Dazai killed himself.' },
    { jp: '太宰ってなんか読んだことないんだわ。', en: 'I\'ve never read Dasai.' },
  ],
  '宴': [
    { jp: 'トムは宴会部長だった。', en: 'Tom was the life of the party.' },
    { jp: '宴会はたけなわだった。', en: 'The banquet was in full swing.' },
  ],
  '宵': [
    { jp: '今宵はとても切ない。', en: 'I feel very sad tonight.' },
    { jp: 'あぁまだ、宵の口だね。', en: 'Well, the night is quite long, isn\'t it?' },
  ],
  '寂': [
    { jp: '彼女は一人だが、寂しいとは思うことはなかった。', en: 'Though she was alone, I didn\'t think she was lonely.' },
    { jp: 'メアリーに話し相手はいないが、彼女は寂しいと思っていない。', en: 'Mary has nobody to talk with, but she doesn\'t feel lonely.' },
  ],
  '寅': [
    { jp: '「余力のほんのわずかな剰余で冷却固結した岩塊を揉み砕き、つかみ潰し」寺田寅彦「浅間山麓より」', en: '"With just a little bit of spare energy, he crushed the cooled and solidified rock mass, grabbing and crushing it" Terada Torahiko, "From the Foot of Mt. Asama"' },
  
    { jp: '寅は日本語の語彙の中に含まれる漢字だ。', en: '寅 is a kanji found in the Japanese vocabulary.' },
  ],
  '密': [
    { jp: '密かに会ってました。', en: 'We met in secret.' },
    { jp: 'トムは密かにとても興奮していた。', en: 'Tom was secretly very excited.' },
  ],
  '寛': [
    { jp: 'もっと、寛容になるべきだ。', en: 'You ought to be more tolerant.' },
    { jp: '今週の話題は「不寛容さ」についてです。', en: 'Our topic of the week is intolerance.' },
  ],
  '寡': [
    { jp: '父は寡黙な人です。', en: 'My father is a man of few words.' },
    { jp: 'トムは寡欲な人だ。', en: 'Tom is a man of few wants.' },
  ],
  '寧': [
    { jp: '長々と言葉を連ねたらばか丁寧な表現になるのは、どの言語でも同じなんだろうな。', en: 'Isn\'t it the case in any language that if you use too many drawn-out words one\'s expression becomes over-polite.' },
    { jp: '丁寧におじぎをしました。', en: 'I bowed politely.' },
  ],
  '審': [
    { jp: '審査員は誰ですか？', en: 'Who are the judges?' },
    { jp: 'そして、入国審査官の審査を受けて上陸許可を受けなければなりません。', en: 'They must then go through a landing examination conducted by inspection officers before they can obtain landing permission.' },
  ],
  '寮': [
    { jp: '寮の暖房が壊れてるんだ。', en: 'The heating in the dorm is broken.' },
    { jp: '寮生活には慣れましたか。', en: 'Have you got used to living in the dorm?' },
  ],
  '寸': [
    { jp: '彼女は気絶寸前だった。', en: 'She almost passed out.' },
    { jp: '彼女は自殺寸前だった。', en: 'She was on the border of killing herself.' },
  ],
  '射': [
    { jp: '放射線を大量に浴びたら、すぐに嘔吐と下痢が始まります。', en: 'After being exposed to a large amount of radiation, vomiting and diarrhea will start quickly.' },
    { jp: '体の小さい人ほど放射線の悪影響を受けやすいということです。', en: 'The smaller the body, the more likely the person will suffer from the ill effects of radiation.' },
  ],
  '尋': [
    { jp: 'トムに尋ねましたか。', en: 'Did you ask Tom?' },
    { jp: '検事は誘導尋問をした。', en: 'The prosecutor asked me a leading question.' },
  ],
  '尚': [
    { jp: '今話すのは時期尚早だ。', en: 'It\'s too soon to tell.' },
    { jp: '衣ばかりで和尚はできぬ。', en: 'The dress does not make the fair.' },
  ],
  '就': [
    { jp: '深刻な就職難のしわ寄せが、そういった不法就労の外国人労働者にまで及んでいる。', en: 'The serious job shortage is also affecting those illegal foreign workers.' },
    { jp: '未就学児入場無料。', en: 'Admission is free for preschool children.' },
  ],
  '尺': [
    { jp: '情報検索の効率を測る尺度として、再現率と適合率というものがある。', en: 'As yardsticks to measure the effectiveness of information retrieval there exist those called \'recall ratio\' and \'precision ratio\'.' },
    { jp: '人間は万物の尺度である。あるものについては、あるということの、あらぬものについては、あらぬということの。', en: 'Man is the measure of all things: of things which are, that they are, and of things which are not, that they are not.' },
  ],
  '尽': [
    { jp: 'その国の美しさは筆舌に尽くし難い。', en: 'The beauty of that country is beyond description.' },
    { jp: 'こんな話、理不尽だ！', en: 'This story does not make sense!' },
  ],
  '尾': [
    { jp: 'ゾウの尻尾は短い。', en: 'The elephant has a short tail.' },
    { jp: '警察に尾行されてる。', en: 'The police are following us.' },
  ],
  '尿': [
    { jp: '残尿感があります。', en: 'Following urination I feel as though I still have to go more.' },
    { jp: '尿が少し赤いです。', en: 'My urine is a little red.' },
  ],
  '屈': [
    { jp: 'どうしてそんな屈辱が、我慢ができるのですか。', en: 'How can you bear such a humiliation?' },
    { jp: '何人も、拷問又は残虐な、非人道的な若しくは屈辱的な取扱若しくは刑罰を受けることはない。', en: 'No one shall be subjected to torture or to cruel, inhuman or degrading treatment or punishment.' },
  ],
  '展': [
    { jp: 'ボストンはここ１０年間で急速に発展した。', en: 'Boston has grown rapidly in the last ten years.' },
    { jp: '発展途上国では優れた技術者が不足している。', en: 'Good technicians are in short supply in the developing countries.' },
  ],
  '属': [
    { jp: 'アルミは金属です。', en: 'Aluminium is a metal.' },
    { jp: 'この梯子は金属製だ。', en: 'This ladder is metal.' },
  ],
  '履': [
    { jp: 'トムはフランス語コースの履修登録をした。', en: 'Tom signed up for a French course.' },
    { jp: '明日までに履修登録をしなきゃいけないんだ。', en: 'We must register for the courses that we\'re going to take by tomorrow.' },
  ],
  '岐': [
    { jp: '私たちは岐阜に行った。', en: 'We went to Gifu.' },
    { jp: '岐阜県の県庁所在地は岐阜市です。', en: 'Gifu Prefecture\'s capital is Gifu City.' },
  ],
  '岬': [
    { jp: 'そこでは岬が海に突き出している。', en: 'There a cape pushes out into the sea.' },
    { jp: '叔父さんは、岬の一軒家に独りぼっちで住んでいた。', en: 'My uncle lived alone in a secluded house on the cape.' },
  ],
  '岳': [
    { jp: '山岳救助隊は２４時間待機している。', en: 'The mountain rescue team is on call 24 hours a day.' },
    { jp: '山岳は、岩の毛布の下で巨人が寝ているように、かすんだ地平線に休んでいた。', en: 'The mountains, like giants sleeping under blankets of rock, rested on the hazy horizon.' },
  ],
  '峠': [
    { jp: '患者さんは峠を越しました。', en: 'The patient is now out of danger.' },
    { jp: '猛暑の峠は越えたようだが、日中はまだまだ暑い。', en: 'We have already passed the peak of the summer heat, but it\'s still hot during the day.' },
  ],
  '峡': [
    { jp: '彼はイギリス海峡を泳ぎ渡った唯一のアメリカ人だ。', en: 'He is the only American who has swum the English Channel.' },
    { jp: '英国はイギリス海峡によって欧州大陸と隔てられている。', en: 'Britain is separated from the Continent by the Channel.' },
  ],
  '峰': [
    { jp: 'エベレストは世界の最高峰です。', en: 'Mt. Everest is the highest peak in the world.' },
    { jp: 'モンブランはアルプスの最高峰です。', en: 'The Mont Blanc is the highest mountain in the Alps.' },
  ],
  '峻': [
    { jp: '「事実」と「意見」を峻別するということは重要なことだと思います。', en: 'I think to clearly distinguish opinion from fact is important.' },
    { jp: '只見町は福島県南会津地方にあり、急峻な山を隔てて新潟との県境に位置しています。', en: 'Tadami is in Minamiaizu in Fukushima; cut off by steep mountains and located on the prefecture border with Niigata.' },
  ],
  '崇': [
    { jp: '私は彼女を心から崇拝している。', en: 'I admire her truly.' },
    { jp: '彼らは彼女を心から崇拝している。', en: 'They admire her deeply.' },
  ],
  '崎': [
    { jp: '川崎にはたくさんの工場があります。', en: 'There are a lot of factories in Kawasaki.' },
    { jp: '子供たちは川崎病を患っているようだ。', en: 'The children appear to be suffering from Kawasaki disease.' },
  ],
  '崩': [
    { jp: 'バブルは崩壊した。', en: 'The bubble burst.' },
    { jp: 'その国の経済は崩壊寸前だ。', en: 'The country\'s economy is about to collapse.' },
  ],
  '嵐': [
    { jp: '暗い嵐の夜だった。', en: 'It was a dark and stormy night.' },
    { jp: '嵐になりそうです。', en: 'There is going to be a storm.' },
  ],
  '嵩': [
    { jp: '布団は嵩張るので、客布団など使用頻度の低い布団は、圧縮袋に入れて圧縮して保管するのもいいでしょう。', en: 'Since futons are bulky, it\'s a good idea to compress and store futons that are used infrequently, such as guest futons, in a vacuum-sealed storage bag.' },
  
    { jp: '嵩は日本語の語彙の中に含まれる漢字だ。', en: '嵩 is a kanji found in the Japanese vocabulary.' },
  ],
  '嵯': [
    { jp: '家名を嵯峨と改姓したのは明治３年でした。', en: 'It was the third year of Meiji when their family name was changed to Saga.' },
  
    { jp: '嵯は日本語の語彙の中に含まれる漢字だ。', en: '嵯 is a kanji found in the Japanese vocabulary.' },
  ],
  '嶺': [
    { jp: 'ナンシーが僕とデートするなんて有り得っこないんだ。高嶺の花だよ。', en: 'Nancy will never go on a date with me. She\'s out of my league.' },
  
    { jp: '嶺は日本語の語彙の中に含まれる漢字だ。', en: '嶺 is a kanji found in the Japanese vocabulary.' },
  ],
  '巡': [
    { jp: '巡回中の警官を見て彼は逃げた。', en: 'He ran away at the sight of a police patrol.' },
    { jp: 'ある夜、高校の巡回中、幽霊を見た。', en: 'One night while patrolling the high school, I saw a ghost.' },
  ],
  '巣': [
    { jp: '蜘蛛が巣を張った。', en: 'The spider spun a web.' },
    { jp: '巣に返してあげて。', en: 'Put it back in the nest.' },
  ],
  '巧': [
    { jp: '巧言令色、鮮なし仁。', en: 'Fine words and an insinuating appearance are seldom associated with true virtue.' },
    { jp: '彼はギターが巧いのよ。', en: 'He plays the guitar well.' },
  ],
  '己': [
    { jp: '「トムとジョンって一卵性双生児とは聞いてたけど、本当によく似てるよね？」「似てる似てる。親にも時々間違えられるって言ってたよ。あの二人はほんと、已己巳己だよ」', en: '"I heard that Tom and John are identical twins. They really do look alike, don\'t they?" "Yes, they really do look very similar. Even their parents say they get confused sometimes. Those two really are very similar, aren\'t they?"' },
    { jp: '彼は自己中心です。', en: 'He\'s self centered.' },
  ],
  '巳': [
    { jp: '「トムとジョンって一卵性双生児とは聞いてたけど、本当によく似てるよね？」「似てる似てる。親にも時々間違えられるって言ってたよ。あの二人はほんと、已己巳己だよ」', en: '"I heard that Tom and John are identical twins. They really do look alike, don\'t they?" "Yes, they really do look very similar. Even their parents say they get confused sometimes. Those two really are very similar, aren\'t they?"' },
  
    { jp: '巳は日本語の語彙の中に含まれる漢字だ。', en: '巳 is a kanji found in the Japanese vocabulary.' },
  ],
  '巴': [
    { jp: '最近僕の義弟Ｙ砲兵少佐が、三年間の巴里駐在を終へて帰つて来た。数々の土産物を取巻いて、われわれはいろいろな土産話を聴いた。', en: 'Recently my brother in law, artillery major Y, came back from a three year trip in Paris. Surrounded by a great number of souvenirs he had brought back, we heard tales of his travels.' },
    { jp: '私は巴里滞在中、二三の画家諸君と識り合ひになり、ちよいちよいアトリエを訪ねるやうなこともあつたが、いつでもその仕事振り、生活振りに多大の興味を惹かれた。', en: 'When I was in Paris, I became acquainted with two or three painters, and I went to visit their atelier from time to time. I was always fascinated by their method of work and their way of life.' },
  ],
  '帆': [
    { jp: 'ジブの裏帆とラダーを使って、バックしながら船首を進みたい方向に向けました。', en: 'Using the rudder and the jib with the wind behind it we backed up, turning the bow to the direction we wanted to go.' },
    { jp: '強い風を受けて帆がぴんと張った。', en: 'The sail tightened in the strong wind.' },
  ],
  '帝': [
    { jp: '合衆国はかつて大英帝国の一部だった。', en: 'The United States was once part of the British Empire.' },
    { jp: '神聖ローマ帝国は１８０６年に終わりを告げた。', en: 'The Holy Roman Empire came to an end in the year 1806.' },
  ],
  '帳': [
    { jp: '新しい電話帳が届きました。', en: 'The new phone book has arrived!' },
    { jp: '電話帳で調べたらどうですか。', en: 'Why don\'t you look it up in the phone book?' },
  ],
  '幕': [
    { jp: '事件は幕を閉じた。', en: 'The case came to a close.' },
    { jp: 'この劇は三幕からなる。', en: 'This play has three acts.' },
  ],
  '幣': [
    { jp: '５ポンド紙幣をお持ちですか。', en: 'Do you have a five-pound note?' },
    { jp: '１０ドル紙幣を５枚、残りは１ドル紙幣でお願いします。', en: 'Give me five tens and the rest in ones.' },
  ],
  '幹': [
    { jp: 'OK。新大阪の新幹線出口に行くわ。', en: 'OK. I\'ll go to Shin-Osaka station\'s shinkansen exit.' },
    { jp: 'これは理論の根幹となる数式である。', en: 'This formula is the basis of the theory.' },
  ],
  '幻': [
    { jp: '安全なんて幻想だ。', en: 'Safety is an illusion.' },
    { jp: 'とても幻想的でした。', en: 'It was so mystical.' },
  ],
  '幽': [
    { jp: '俺は幽霊じゃない。', en: 'I\'m not a ghost.' },
    { jp: '幽霊って信じますか？', en: 'Do you believe in ghosts?' },
  ],
  '序': [
    { jp: '社会の秩序は自然から生じたものではない。社会の秩序は慣習の上に基礎付けられている。', en: 'Social order does not come from nature. It is founded on customs.' },
    { jp: 'Ｐが半順序集合であることを証明せよ。', en: 'Prove that P is a poset.' },
  ],
  '庶': [
    { jp: 'どんなに焦っても庶務的な仕事がどんどん溜まってきて追いつかない。', en: 'No matter how much I rush it, miscellaneous work keeps piling up and I can\'t catch up with it.' },
    { jp: '庶民のなりわいは、米をつくることだった。', en: 'The ordinary people had their livelihood in farming rice.' },
  ],
  '康': [
    { jp: '健康そのものだよ。', en: 'I\'m in perfect health.' },
    { jp: '僕は健康じゃない。', en: 'I\'m not healthy.' },
  ],
  '庸': [
    { jp: '賢い人の手にかかると、物事は実にシンプルになる。簡単なことを難しく言うのが、賢いふりをした凡庸な人間だ。', en: 'In the hands of a wise person, things become really simple. It\'s a mediocre person, pretending to be wise, that makes an easy thing sound difficult.' },
    { jp: '人気者になるためには、凡庸でなくてはならない。', en: 'To become popular, you need to be mediocre.' },
  ],
  '廃': [
    { jp: 'その城は今では廃虚となっている。', en: 'The castle is now in ruins.' },
    { jp: '日本が不当な関税を撤廃しない限り、合衆国は制裁を科すだろう。', en: 'Unless Japan eliminates its unfair tariffs, the U.S. will impose sanctions.' },
  ],
  '廉': [
    { jp: '彼女は殺人の廉で牢屋に入れられてしまった。', en: 'She\'s been sent to jail for murder.' },
  
    { jp: '廉は日本語の語彙の中に含まれる漢字だ。', en: '廉 is a kanji found in the Japanese vocabulary.' },
  ],
  '廊': [
    { jp: 'トイレは廊下の左側にあります。', en: 'The bathroom is on the left side of the hallway.' },
    { jp: '戒めに廊下に立たされた。', en: 'To teach him a lesson, they made him stand in the hallway.' },
  ],
  '廷': [
    { jp: 'トムは法廷に出頭を命じられた。', en: 'Tom was ordered to go to the court of law.' },
    { jp: '法廷は彼を死刑に処した。', en: 'The court sentenced him to death.' },
  ],
  '弁': [
    { jp: 'もう勘弁してくれよ！', en: 'Give me a break.' },
    { jp: '駅で弁当を買った。', en: 'I bought a box lunch at the station.' },
  ],
  '弊': [
    { jp: 'それは語弊がある。', en: 'That\'s not a proper thing to say.' },
    { jp: '社会の悪弊を糾すべきだ。', en: 'We must investigate social abuses.' },
  ],
  '弓': [
    { jp: 'この弓は張りが強いです。', en: 'This bow has a strong draw.' },
    { jp: 'これは強い人が使う弓です。', en: 'This is a bow for a strong person.' },
  ],
  '弘': [
    { jp: '昨日弘美さんをデートに誘ったんだけどさ、あっさり断られちゃったよ。', en: 'Yesterday, I asked Hiromi out on a date, but she rejected my offer out of hand.' },
  
    { jp: '弘は日本語の語彙の中に含まれる漢字だ。', en: '弘 is a kanji found in the Japanese vocabulary.' },
  ],
  '弥': [
    { jp: '僕の名は弥太郎です。', en: 'My name is Yatarou.' },
    { jp: 'ここで中断したら元の木阿弥だぞっ。', en: 'If we stop here, we\'ll be right back where we started!' },
  ],
  '弦': [
    { jp: 'ギターの弦が切れた。', en: 'I broke a string on my guitar.' },
    { jp: 'このギター、弦が一本ないよ。', en: 'This guitar is missing a string.' },
  ],
  '弧': [
    { jp: 'この語句は、括弧で囲んだ方がいいよ。', en: 'You should put parentheses around this phrase.' },
    { jp: '要素ＣとＤは弧の生成には無関係なので排除することができる。', en: 'We can eliminate C and D since they are irrelevant to the generation of the arcs.' },
  ],
  '張': [
    { jp: 'ケモナーが集まるイベントでは耳や尻尾を引っ張る輩がいる。', en: 'At furry conventions, there are those who pull on ears or tails.' },
  
    { jp: '張は日本語の語彙の中に含まれる漢字だ。', en: '張 is a kanji found in the Japanese vocabulary.' },
  ],
  '弾': [
    { jp: 'どんな曲を弾くの？', en: 'What kind of music do you play?' },
    { jp: '私はバイオリンを弾く。', en: 'I play the violin.' },
  ],
  '彗': [
    { jp: 'サッカー界に新たなスターが彗星のごとく現れた。', en: 'A new star has appeared like a comet in the soccer world.' },
  
    { jp: '彗は日本語の語彙の中に含まれる漢字だ。', en: '彗 is a kanji found in the Japanese vocabulary.' },
  ],
  '彦': [
    { jp: '「余力のほんのわずかな剰余で冷却固結した岩塊を揉み砕き、つかみ潰し」寺田寅彦「浅間山麓より」', en: '"With just a little bit of spare energy, he crushed the cooled and solidified rock mass, grabbing and crushing it" Terada Torahiko, "From the Foot of Mt. Asama"' },
  
    { jp: '彦は日本語の語彙の中に含まれる漢字だ。', en: '彦 is a kanji found in the Japanese vocabulary.' },
  ],
  '彩': [
    { jp: '兵士のほとんどが迷彩服を着ていました。', en: 'Most of the soldiers were wearing camo.' },
    { jp: '私は水彩画が好きです。', en: 'I like the picture painted in water colors.' },
  ],
  '彫': [
    { jp: '彼の文章は細部まで入念に彫琢されている。', en: 'Every detail of his writing is carefully composed.' },
    { jp: '死亡事例が19件と全体の20％を超えており、過労死の深刻な実態が浮き彫りになった。', en: 'With 19 cases of death forming over 20% of the whole, the grave reality of overwork-deaths has been thrown into relief.' },
  ],
  '彰': [
    { jp: '表彰式？表彰台？のポディウムの綴りを教えてください。', en: 'Awards ceremony podium? Victory stand podium? Please tell me the correct spelling.' },
    { jp: '「僕ね、卒業式で表彰されることになったんだ。今から、予行演習があるから行ってくるね」「すごいね。行ってらっしゃい。表彰台で躓かないようにね」', en: '"I\'ve been chosen to receive a commendation at the graduation ceremony. I\'m about to go to rehearsal for it now." "Amazing! See you! Hope you don\'t trip on stage."' },
  ],
  '影': [
    { jp: 'なんかの撮影かな。', en: 'I wonder, is something being filmed.' },
    { jp: '写真撮影に興味ある？', en: 'Are you interested in photography?' },
  ],
  '往': [
    { jp: '３８１日間、モントゴメリーのバスは、ほとんど空っぽの状態で路線を往復した。', en: 'For 381 days, the buses of Montgomery travelled back and forth on their routes, almost empty.' },
    { jp: '往復びんたを食らった。', en: 'I got slapped on both cheeks.' },
  ],
  '征': [
    { jp: 'これが、いわゆるノルマン征服である。', en: 'This is what is called the Norman Conquest.' },
    { jp: 'ノルマン人は１０６６年にイングランドを征服した。', en: 'The Normans conquered England in 1066.' },
  ],
  '径': [
    { jp: '地球の直径は、12,742キロです。', en: 'Earth has a diameter of 12,742 kilometers.' },
    { jp: 'その湖は直径四マイルである。', en: 'The lake is four miles across.' },
  ],
  '徐': [
    { jp: '車が徐行でついてきているような気がする。', en: 'I think that that car is slowly following us.' },
    { jp: '彼女は徐々に回復してるよ。', en: 'She is gradually recovering.' },
  ],
  '従': [
    { jp: '従業員は30人です。', en: 'We have thirty employees.' },
    { jp: 'ご忠告に従います。', en: 'I\'ll act on your advice.' },
  ],
  '循': [
    { jp: '血液は体内を循環する。', en: 'Blood circulates through the body.' },
    { jp: '適度な運動は血液の循環を活発にする。', en: 'Moderate exercise stimulates the circulation of blood.' },
  ],
  '微': [
    { jp: 'なんか微妙でしょ？', en: 'It\'s kind of iffy, don\'t you think?' },
    { jp: '私はかなり微妙な立場にある。', en: 'I find myself in a rather delicate situation.' },
  ],
  '徳': [
    { jp: '謙虚さは美徳です。', en: 'Modesty is a virtue.' },
    { jp: '早起きは三文の徳。', en: 'The early bird catches the worm.' },
  ],
  '徴': [
    { jp: '毎度のことですが、源泉徴収税納付後、納税証明をＰＤＦで結構ですから、送っていただけるよう、お願いします。', en: 'After pay withholding tax, please send the tax paid receipt in PDF format.' },
    { jp: '鳩は平和の象徴です。', en: 'The dove is a symbol of peace.' },
  ],
  '徹': [
    { jp: '私はよく徹夜する。', en: 'I often stay up all night.' },
    { jp: '徹夜で勉強したよ。', en: 'I worked all night.' },
  ],
  '忌': [
    { jp: '今日は私の忌み日だ。', en: 'Today isn\'t my lucky day!' },
    { jp: 'もうすぐ、父の一周忌です。', en: 'Soon it will be the first year anniversary of my father\'s passing.' },
  ],
  '忍': [
    { jp: '忍耐の限界もある。', en: 'I\'m running out of patience.' },
    { jp: '忍者ごっこをしよう。', en: 'Let\'s make believe we\'re ninjas.' },
  ],
  '志': [
    { jp: '「有志連合」とは、イラク戦争でイラクを相手に協力して戦った国々のことを指す言葉である。', en: 'The "Coalition of the Willing" is a phrase that refers to the countries that fought together against Iraq in the Iraq War.' },
    { jp: 'トムは意志が強い。', en: 'Tom has a lot of willpower.' },
  ],
  '応': [
    { jp: '直ちにご注文に応じられずまことに申し訳ございません。', en: 'Please accept our apologies for not filling your order sooner.' },
    { jp: 'この例文は、書き方のサンプルなので必要に応じて内容を追加削除をしてからお使いください。', en: 'This example text is a how-to-write sample, so please add to and delete from it as required before using.' },
  ],
  '忠': [
    { jp: '忠犬ハチ公の像は渋谷駅前に立っている。', en: 'The statue of Hachiko, the faithful dog, stands in front of Shibuya Station.' },
    { jp: '犬は忠実な動物です。', en: 'A dog is a faithful animal.' },
  ],
  '怠': [
    { jp: '幼少の時、父が死んで、その弟が、時代の衰勢と、自分の怠惰とから、すっかり、身代をつぶしてしまったらしく、後に、筆墨行商人になって、私の家へ、よく来たが、くると、母に叱られて、よわっていた。', en: 'When I was very young, my father died. His younger brother, due to the vicissitudes of the times and to his own laziness, dissipated his own fortune and afterwards became a peddler of writing materials. He often came to our house, but when he came, my mother would scold him and he would be troubled.' },
    { jp: '倦怠期らしいです。', en: 'It seems that they\'re bored of married life.' },
  ],
  '怪': [
    { jp: '怪我はないですか？', en: 'Are you hurt?' },
  
    { jp: '怪は日本語の語彙の中に含まれる漢字だ。', en: '怪 is a kanji found in the Japanese vocabulary.' },
  ],
  '恒': [
    { jp: '不規則銀河とは構造が不確定であり、若い恒星や塵、ガスを大量に含む。', en: 'An irregular galaxy has an undefined shape and is full of young stars, dust, and gas.' },
    { jp: '惑星は恒星の周りを回る。', en: 'Planets move around a fixed star.' },
  ],
  '恕': [
    { jp: '姫君は皇帝に寛恕を請いました。', en: 'The princess begged forgiveness from the emperor.' },
  
    { jp: '恕は日本語の語彙の中に含まれる漢字だ。', en: '恕 is a kanji found in the Japanese vocabulary.' },
  ],
  '恨': [
    { jp: '私、あなたに何か恨まれるようなことしました？', en: 'Is there something I did to you that made you hate me?' },
    { jp: '恨んでなんかないよ。', en: 'I don\'t hold grudges.' },
  ],
  '恩': [
    { jp: '偉大な人の好意は神々の恩恵である。', en: 'The friendship of a great man is a gift from the gods.' },
    { jp: '彼は私の命の恩人だ。', en: 'I owe him my life.' },
  ],
  '恭': [
    { jp: 'もし恭介が訪ねてきても、私は家にいないって言ってよ。もうあいつの顔なんか見たくないの。', en: 'If Kyosuke comes to visit, tell him I\'m not in. I don\'t want to see him anymore.' },
  
    { jp: '恭は日本語の語彙の中に含まれる漢字だ。', en: '恭 is a kanji found in the Japanese vocabulary.' },
  ],
  '恵': [
    { jp: '彼は知恵のある人だ。', en: 'He is a man of wisdom.' },
    { jp: '知恵は小出しにせよ。', en: 'Dole out your wisdom a little at a time.' },
  ],
  '悔': [
    { jp: 'お悔み申し上げます。', en: 'Please accept my sympathies.' },
    { jp: '彼の奥さんが亡くなった時、彼は何十通ものお悔み状を受け取った。', en: 'When his wife died, he received dozens of letters of sympathy.' },
  ],
  '悟': [
    { jp: '勝てないって悟った。', en: 'I realized I couldn\'t win.' },
    { jp: '最悪を覚悟している。', en: 'I am prepared for the worst.' },
  ],
  '悠': [
    { jp: '俺の師匠は悠々自適の生活をしている。', en: 'My master is living a life free from worldly cares.' },
    { jp: '決して悠長な仕事ではない。', en: 'This certainly isn\'t a job where you can take it easy.' },
  ],
  '悦': [
    { jp: 'お褒めの言葉を頂き、恐悦至極に存じます。', en: 'I am extremely honoured to receive your praise.' },
  
    { jp: '悦は日本語の語彙の中に含まれる漢字だ。', en: '悦 is a kanji found in the Japanese vocabulary.' },
  ],
  '悼': [
    { jp: 'ロシア：人質事件の犠牲となった方々に哀悼の意を表す。', en: 'Russia expresses regret for those lost in the hostage incident.' },
  
    { jp: '悼は日本語の語彙の中に含まれる漢字だ。', en: '悼 is a kanji found in the Japanese vocabulary.' },
  ],
  '惑': [
    { jp: '私を惑わせないで。', en: 'Don\'t confuse me.' },
    { jp: '彼は戸惑っていた。', en: 'He was bewildered.' },
  ],
  '惜': [
    { jp: '命は誰でも惜しい。', en: 'Life is dear to everybody.' },
    { jp: '河豚は食いたし命は惜しし。', en: 'Every rose has its thorn.' },
  ],
  '惣': [
    { jp: 'この惣菜買いは、それから後中学へ行っても続いていた。', en: 'I continued buying prepared dishes even after I went to middle school.' },
  
    { jp: '惣は日本語の語彙の中に含まれる漢字だ。', en: '惣 is a kanji found in the Japanese vocabulary.' },
  ],
  '惨': [
    { jp: '悲惨な痛さだった。', en: 'The pain was terrible.' },
    { jp: '家も庭も悲惨なありさまだ。', en: 'Both the house and the garden are in a bad state.' },
  ],
  '惰': [
    { jp: '幼少の時、父が死んで、その弟が、時代の衰勢と、自分の怠惰とから、すっかり、身代をつぶしてしまったらしく、後に、筆墨行商人になって、私の家へ、よく来たが、くると、母に叱られて、よわっていた。', en: 'When I was very young, my father died. His younger brother, due to the vicissitudes of the times and to his own laziness, dissipated his own fortune and afterwards became a peddler of writing materials. He often came to our house, but when he came, my mother would scold him and he would be troubled.' },
    { jp: '彼は怠惰な学生だ。', en: 'He is a lazy student.' },
  ],
  '愁': [
    { jp: '「このたびはご愁傷さまでございます」とひとことお悔みの挨拶をします。', en: 'Use a brief expression of condolence, such as: "On this sad occasion we grieve with you".' },
    { jp: '娘は母の病気を愁えた。', en: 'She was anxious about her mother\'s sickness.' },
  ],
  '愉': [
    { jp: 'かげでは、二人して僕のことを迂濶な奴、頓馬な奴、助平な奴などあざ笑っているのかも知れないと、僕は非常に不愉快を感じた。', en: 'I sensed with discomfort that the two of them might ridicule me behind my back as a thoughtless, simple-minded satyr.' },
    { jp: '病院で不愉快な思いをしている分を取り戻そうと思って、トムは自分の適量より少し多めにお酒を飲んだ。', en: 'To compensate for his unpleasant experiences in the hospital, Tom drank a little more than was good for him.' },
  ],
  '愚': [
    { jp: '愚か者は幸せである。', en: 'Fools are happy.' },
    { jp: 'つまり、あなたは愚かだ。', en: 'In other words, you\'re a fool.' },
  ],
  '慈': [
    { jp: '彼は慈善活動にいそしんでいる。', en: 'He\'s active doing charity work.' },
    { jp: '慈悲の心を持ってごらん。', en: 'Try to have some compassion.' },
  ],
  '態': [
    { jp: '彼は怒るとよく悪態をつく。', en: 'He often swears when he is angry.' },
    { jp: 'トムは決して悪態をつかない。', en: 'Tom never curses.' },
  ],
  '慎': [
    { jp: '言葉を慎みなさい。', en: 'Watch yourself.' },
    { jp: '慎重に選びなさい。', en: 'Choose carefully.' },
  ],
  '慕': [
    { jp: '彼は祖父を慕い尊敬している。', en: 'He adores his grandfather.' },
    { jp: '彼女は両親をとても慕っている。', en: 'She is deeply attached to her parents.' },
  ],
  '慢': [
    { jp: '自慢じゃないが僕は通知表の家庭科で３以上を取ったことがない。１０段階評価で。', en: 'I don\'t want to boast, but I\'ve never gotten better than a 3 on my report card for home economics. Out of 10 that is.' },
    { jp: '彼は医者にかかったことがないのが自慢だ。', en: 'He is proud of not having consulted a doctor.' },
  ],
  '慨': [
    { jp: '感慨深い日でした。', en: 'It was an emotional day.' },
    { jp: '彼の行動に憤慨しました。', en: 'I was outraged by his actions.' },
  ],
  '慮': [
    { jp: '彼は無遠慮な人だ。', en: 'He is a rude person.' },
    { jp: '奴等の無遠慮がしゃくなんだ。', en: 'I\'m annoyed by their impudence.' },
  ],
  '慰': [
    { jp: '自慰は狂気に繋がる。', en: 'Masturbation leads to insanity.' },
    { jp: '私たちは互いに慰め合った。', en: 'We consoled each other.' },
  ],
  '慶': [
    { jp: '明治は５対３のスコアで慶応に敗れた。', en: 'Meiji was beaten by Keio by a score of three to five.' },
    { jp: '昨日の試合で早稲田は慶応と引き分けた。', en: 'Waseda tied Keio in yesterday\'s game.' },
  ],
  '憂': [
    { jp: '自分の思春期を振り返ると、いつも憂うつな気分になる。', en: 'I cannot look back on my adolescence without feeling depressed.' },
    { jp: '僕は心の中では憂鬱になっているけど、見た目にはわからないでしょう？', en: 'I\'m feeling depressed on the inside, but you can\'t tell by looking, can you?' },
  ],
  '憤': [
    { jp: '彼女は自分が受けた仕打ちに憤りを感じた。', en: 'She was indignant at the way she had been treated.' },
    { jp: '彼女は息子がひどい扱いを受けたと憤慨していた。', en: 'She was indignant at the way her son had been treated.' },
  ],
  '憧': [
    { jp: 'すべての芸術はたえず音楽の状態に憧れる。', en: 'All art constantly aspires towards the condition of music.' },
    { jp: 'トムに憧れている。', en: 'I admire Tom.' },
  ],
  '憩': [
    { jp: '私の学校は広いので、５分の休憩の間に教室から他の教室へと走らなければなりません。', en: 'Since my school is large, I have to run to get from one classroom to another in a 5-minute break.' },
    { jp: '公園は憩いの場です。', en: 'Parks are places for relaxation.' },
  ],
  '憲': [
    { jp: '憲法記念日は、憲法の基本的精神である、国民主権、基本的人権の尊重、平和主義を再確認するための日です。', en: 'This is the day on which the Constitution\'s fundamental spirit, the sovereignty of the people, respect for fundamental human rights, and pacifism, are all reaffirmed.' },
    { jp: '憲法を侵してはならない。', en: 'We must not violate the Constitution.' },
  ],
  '憶': [
    { jp: 'トムを見た記憶はない。', en: 'I don\'t remember seeing Tom.' },
    { jp: 'どこかで彼女を見た記憶があるんだよ。', en: 'I remember seeing her somewhere.' },
  ],
  '憾': [
    { jp: '遺憾ながら、その報道は正しいです。', en: 'Unfortunately, the report is correct.' },
    { jp: '遺憾ながら、２月２７日のお約束を守ることが出来ません。', en: 'I regret to inform you that I will be unable to keep our appointment for February 27.' },
  ],
  '懇': [
    { jp: '彼らは我々に援助を懇願した。', en: 'They appealed to us for help.' },
    { jp: '彼は彼女に帰ってくるよう懇願した。', en: 'He begged for her to come home.' },
  ],
  '懐': [
    { jp: 'この歌、懐かしいな。', en: 'This song brings back memories.' },
    { jp: 'このゲーム、めっちゃ懐かしい。', en: 'This game is so nostalgic.' },
  ],
  '懲': [
    { jp: 'あの二股男を懲らしめてやるから、ちょっと待ってて！', en: 'Just wait till I get my hands on that two-timing bastard!' },
    { jp: 'このドラマは単純な勧善懲悪もので、今一つ深みに欠けて物足りない。', en: 'This drama is missing something. All it is is a simple cautionary tale with no real depth.' },
  ],
  '懸': [
    { jp: 'トム、懸垂何回できる？', en: 'How many chin-ups can you do, Tom?' },
    { jp: '鹿は命懸けで逃げた。', en: 'A deer ran for its life.' },
  ],
  '我': [
    { jp: '「我が闘争」はアドルフ・ヒトラーの著書である。', en: '"Mein Kampf" is a book by Adolf Hitler.' },
  
    { jp: '我は日本語の語彙の中に含まれる漢字だ。', en: '我 is a kanji found in the Japanese vocabulary.' },
  ],
  '戒': [
    { jp: '戒めに廊下に立たされた。', en: 'To teach him a lesson, they made him stand in the hallway.' },
    { jp: '彼は息子の怠惰さを戒めた。', en: 'He admonished his son for being lazy.' },
  ],
  '戯': [
    { jp: '「ハムレット」はこれまでで最もおもしろい戯曲だと言われている。', en: 'It is said that "Hamlet" is the most interesting play ever written.' },
    { jp: 'あの人によって、大統領が戯画化され、政権の権威と綱紀が乱されてはなるまい。', en: 'According to him, the president must not be turned into a caricature, the loss of authority and public order cannot be borne.' },
  ],
  '房': [
    { jp: '厨房に猫がいるわよ。', en: 'There is a cat in the kitchen.' },
    { jp: 'トムは暖房をつけた。', en: 'Tom turned on the heater.' },
  ],
  '扇': [
    { jp: '扇風機がほしいな。', en: 'I want the fan.' },
    { jp: '扇風機も進化してんだ。', en: 'Electric fans have evolved.' },
  ],
  '扉': [
    { jp: '閉まる扉にご注意ください。', en: 'Please be careful of the closing doors.' },
    { jp: 'この扉、閉めておこうか？', en: 'Do you want this door closed?' },
  ],
  '扱': [
    { jp: 'お取り扱いにご注意ください。', en: 'Please handle with care.' },
    { jp: '刃物の取り扱いには注意しなさい。', en: 'You should be careful with a knife.' },
  ],
  '扶': [
    { jp: '２回目の人工内耳移植への低所得者医療扶助制度の適用不許可を取り下げる。', en: 'Decision to disallow Medicaid for second cochlea implant withdrawn.' },
  
    { jp: '扶は日本語の語彙の中に含まれる漢字だ。', en: '扶 is a kanji found in the Japanese vocabulary.' },
  ],
  '批': [
    { jp: '「純粋理性批判」はドイツの哲学者エマニュエル・カントの主著である。', en: 'Critique of Pure Reason is German philosopher Immanuel Kant\'s chief literary work.' },
    { jp: '批判する者の中には、欧州中央銀行に課せられた目標が不適切であると考える者がいます。', en: 'Among the critics are those who think that the objective set for the European Central Bank is not appropriate.' },
  ],
  '抄': [
    { jp: '昨日、ひょんなことで父親の戸籍抄本のコピーを見てしまいました。', en: 'Yesterday I stumbled across a copy of my father\'s family register.' },
  
    { jp: '抄は日本語の語彙の中に含まれる漢字だ。', en: '抄 is a kanji found in the Japanese vocabulary.' },
  ],
  '把': [
    { jp: '彼女は情勢を把握することができる。', en: 'She is able to grasp the situation.' },
    { jp: '把握しておいた方がいい問題点はありますか？', en: 'Are there any problems we should know about?' },
  ],
  '抑': [
    { jp: '汚染は抑えられます。', en: 'Pollution can be controlled.' },
    { jp: '王は人民を抑圧した。', en: 'The king oppressed his people.' },
  ],
  '抗': [
    { jp: '抗議をしないでくれ。', en: 'Please, don\'t protest.' },
    { jp: '私はその抗議を退けた。', en: 'I dismissed the protest.' },
  ],
  '択': [
    { jp: '難しい選択ですね。', en: 'It\'s a tough choice.' },
    { jp: '選択の余地はないの？', en: 'Is there no alternative?' },
  ],
  '披': [
    { jp: 'トムはマジックを披露した。', en: 'Tom performed a magic trick.' },
    { jp: '披露したこの構想は、彼が加入してからずっと温めてきた。', en: 'He\'s been mulling over this idea he unveiled ever since he joined.' },
  ],
  '抵': [
    { jp: '誰も抵抗できない。', en: 'No one can resist.' },
    { jp: '激しい抵抗があった。', en: 'There was intense opposition.' },
  ],
  '抹': [
    { jp: '一抹の不安が頭をよぎる。', en: 'A hint of anxiety crosses my mind.' },
    { jp: '「なんでもかんでも、抹茶味にすればいいってもんじゃないよ」「思う。思う」', en: '"Not everything needs to be matcha-flavored." "You are so right. So right."' },
  ],
  '抽': [
    { jp: 'あなたの説明は私には抽象的すぎます。', en: 'Your explanation is too abstract to me.' },
    { jp: '彼にとって、飢えというのは抽象的な概念であった。彼には常に十分な食料があったからだ。', en: 'For him, hunger was an abstract concept. He had always had enough food.' },
  ],
  '拍': [
    { jp: '拍手をお願いします。', en: 'Please clap.' },
    { jp: '拍手が湧き上がった。', en: 'Applause broke out.' },
  ],
  '拐': [
    { jp: 'トムが誘拐された。', en: 'Tom was kidnapped.' },
    { jp: '私はエイリアンに誘拐されていた。', en: 'I was abducted by aliens.' },
  ],
  '拒': [
    { jp: '彼女は10代のころ拒食症になった。', en: 'She suffered from anorexia as a teenager.' },
    { jp: 'トムは高校生のころ拒食症になった。', en: 'Tom became anorexic when he was in high school.' },
  ],
  '拓': [
    { jp: 'レンジャーが道を拓く。', en: 'The Rangers lead the way.' },
    { jp: 'まだ未開拓の土地がある。', en: 'There are still uncivilized lands.' },
  ],
  '拘': [
    { jp: 'この誓約書には法的拘束力はありません。', en: 'This written pledge is not legally binding.' },
    { jp: 'ついに反逆者は捕らえられ、拘置所に入れられた。', en: 'The rebel was ultimately captured and confined to jail.' },
  ],
  '拙': [
    { jp: '君のメールは巧拙を見て取るには短すぎるな。', en: 'I can\'t check to see if your email is correct or not because it\'s too short.' },
  
    { jp: '拙は日本語の語彙の中に含まれる漢字だ。', en: '拙 is a kanji found in the Japanese vocabulary.' },
  ],
  '拠': [
    { jp: '証拠もないんだろ。', en: 'You have no proof.' },
    { jp: '証拠はありません。', en: 'There\'s no evidence.' },
  ],
  '拡': [
    { jp: '拡大ボタンはこれね。', en: 'This is the zoom button.' },
    { jp: 'それは拡大解釈だね。', en: 'That\'s stretching the point.' },
  ],
  '括': [
    { jp: 'この語句は、括弧で囲んだ方がいいよ。', en: 'You should put parentheses around this phrase.' },
    { jp: '括弧は使わず、補足情報はコメント欄にてご対応ください。必要に応じて、2文を追加することもできます。', en: 'Please do not use parentheses, but provide any supplementary information in the comments section. If necessary, two sentences may be added.' },
  ],
  '拳': [
    { jp: '北斗の拳が大好きだよ！', en: 'I love Fist of the North Star!' },
    { jp: 'トムは拳銃を買ったんだ。', en: 'Tom bought a pistol.' },
  ],
  '拷': [
    { jp: '転換療法は拷問です。', en: 'Conversion therapy is torture.' },
    { jp: '彼は警察で拷問を受けた。', en: 'He was subjected to torture by the police.' },
  ],
  '挑': [
    { jp: '現在のチャンピオンは彼であり、その王座を奪える新人挑戦者はいないだろう。', en: 'He\'s reigning champion, and no young challenger is going to take it away from him.' },
    { jp: '再度挑戦したが、無理だった。', en: 'We tried it again, but couldn\'t do it.' },
  ],
  '挙': [
    { jp: '今週は参議院選挙が開かれる。', en: 'The house of councillors election opens this week.' },
    { jp: 'ジムは手を挙げた。', en: 'Jim put his hand up.' },
  ],
  '振': [
    { jp: '彼女は手を振った。', en: 'She waved.' },
    { jp: 'トムは手を振った。', en: 'Tom waved.' },
  ],
  '挿': [
    { jp: 'テレビのコンセントを挿して。', en: 'Plug in the TV.' },
    { jp: '実も結ぶが、挿し木でも根付くらしい？', en: 'It bears fruit, but it seems it may even set root from cuttings?' },
  ],
  '据': [
    { jp: '彼は腹が据わっている。', en: 'He has guts.' },
    { jp: '旅館は、上げ膳据え膳がうれしいね。', en: 'At a Japanese-style inn, they take care of your every need, so you don\'t have to lift a finger.' },
  ],
  '授': [
    { jp: 'アカデミー授賞式は、ハリウッド最大の華やかな催しだ。', en: 'The Oscar ceremonies are Hollywood\'s biggest extravaganza.' },
    { jp: '多くの大学で学位授与式が中止になった。', en: 'Many universities have stopped their degree-awarding ceremonies.' },
  ],
  '掌': [
    { jp: '私達は今日金晃丸という種類の仙人掌を買いました。', en: 'Today we bought a variety of cactus known as kinkoumaru.' },
    { jp: '大人になったら、車掌になりたい。', en: 'When I grow up, I want to be a train conductor.' },
  ],
  '排': [
    { jp: '超高圧水の噴射により、ほとんどの詰まりが排除される。', en: 'By means of a super high-pressure water spray practically all the sediment is removed.' },
    { jp: '要素ＣとＤは弧の生成には無関係なので排除することができる。', en: 'We can eliminate C and D since they are irrelevant to the generation of the arcs.' },
  ],
  '控': [
    { jp: '５０万円の個人基礎控除がある。', en: 'You have a personal tax exemption of 500,000 yen.' },
    { jp: 'ここはお客様用の控え室です。', en: 'This is a waiting room for guests.' },
  ],
  '推': [
    { jp: '推薦とればよかった。', en: 'It would have been good if I had gotten a recommendation.' },
    { jp: '距離は推定しにくいな。', en: 'The distance is hard to estimate.' },
  ],
  '措': [
    { jp: '手後れにならないうちに、必要な措置を取るべきです。', en: 'We should take the necessary steps before it\'s too late.' },
    { jp: 'バス通学と積極的差別是正措置などが論争の多い話題だった。', en: 'School busing and taking a proactive stance against discrimination were hotly debated topics.' },
  ],
  '掲': [
    { jp: '彼らは国旗を掲げている。', en: 'They are flying their national flag.' },
    { jp: 'トムはランタンを掲げた。', en: 'Tom held up the lantern.' },
  ],
  '描': [
    { jp: 'トムは主に女性の肖像画を描いました。', en: 'Tom mainly painted portraits of women.' },
    { jp: '私の肖像画を描くのに、あなたを雇いたいのです。', en: 'I\'d like to hire you to paint a portrait of me.' },
  ],
  '提': [
    { jp: '報告書は提出したの？', en: 'Have you turned in your report?' },
    { jp: '建設的な提案だよ。', en: 'That\'s a constructive suggestion!' },
  ],
  '揚': [
    { jp: '彼はたこを揚げた。', en: 'He flew a kite.' },
    { jp: '豆のかき揚げが好きです。', en: 'I like pea pods in my stir fry.' },
  ],
  '握': [
    { jp: '握りこぶしは、ストレスがあることを示しているかもしれません。', en: 'A closed fist can indicate stress.' },
    { jp: '２人は何年ぶりかで会ったように、心をこめて握手していた。', en: 'The two people were shaking hands heartily as if they had not seen each other for years.' },
  ],
  '揮': [
    { jp: 'シンナーなどの揮発性油分が入っていたものについては数日間放置して完全に揮発させてから、不燃物として捨てます。', en: 'For things that have had contents with volatile oil like thinners they should be left for a few days to completely evaporate it before being disposed of as non-flammable waste.' },
    { jp: '彼女は才能を発揮した。', en: 'She displayed her talents.' },
  ],
  '援': [
    { jp: '北朝鮮が６か国協議の合意に基づき核開発計画を申告した２６日、米国が「テロ支援国」の指定解除手続きに入ったことで、拉致被害者の家族らには「拉致問題が置き去りにされるのでは」という不安が広がった。', en: 'With North Korea\'s announcement on the 26th of its nuclear development plan based upon the agreement stemming from the Six Party Talks, and the United States\' commencement of procedures to remove North Korea from its designation on the list of State Sponsors of Terrorism, the families of abductees have expressed growing unease that it may constitute an abandonment of the abductee issue.' },
    { jp: '応援に行きたいわ。', en: 'I want to go and cheer.' },
  ],
  '揺': [
    { jp: 'ギリシャは西洋文明の揺籃の地であった。', en: 'Greece was the cradle of western civilization.' },
    { jp: '赤ん坊は揺りかごの中で眠っていた。', en: 'The baby was sleeping in the cradle.' },
  ],
  '搬': [
    { jp: '彼女は病院に搬送中だった。', en: 'She was being carried to the hospital.' },
    { jp: 'この後、ミキは病院へ搬送された。', en: 'After this, Miki was taken to the hospital.' },
  ],
  '搭': [
    { jp: '出発２０分前になったら、搭乗案内のアナウンスがかかるって。', en: 'They said they\'d make the boarding announcement 20 minutes before takeoff.' },
    { jp: '日本航空７３１便、ご搭乗の最終案内をいたします。', en: 'This is the final boarding call for Japan Airlines Flight 731.' },
  ],
  '携': [
    { jp: 'トムとメアリーは毎日200通以上の携帯メールをやり取りしている。', en: 'Tom and Mary exchange more than 200 text messages every day.' },
    { jp: '日本の携帯メールでは、マルの代わりに文末に絵文字や顔文字をつけることも多い。', en: 'Japanese texts frequently use emoji or kaomoji in place of using a full stop at the end of messages.' },
  ],
  '搾': [
    { jp: '牛の搾乳ってどうやるの？', en: 'How do you milk a cow?' },
    { jp: '牛の搾乳ってしたことある？', en: 'Have you ever milked a cow?' },
  ],
  '摂': [
    { jp: '本日、空港付近の天候は晴れ、気温は摂氏20度となっております。', en: 'Today, it is clear weather for the vicinity of the airport; temperature is 20 degrees Celcius.' },
    { jp: '1995年7月、シカゴの気温は摂氏36度以上となり、3日間で700人以上が命を落とした。', en: 'During a span of three days in July 1995, more than 700 people died in Chicago, when temperatures rose above 97 F (36 C).' },
  ],
  '摘': [
    { jp: 'トムは花を摘んだ。', en: 'Tom picked flowers.' },
    { jp: '彼女は花を摘んだ。', en: 'She picked flowers.' },
  ],
  '摩': [
    { jp: '現在の日米貿易摩擦の原因は何であると思いますか。', en: 'What do you think has caused the present trade friction between Japan and the U.S.?' },
    { jp: '彼女は摩周湖が好きです。', en: 'She likes Lake Mashuu.' },
  ],
  '撤': [
    { jp: '彼女は女性差別撤廃を主張した。', en: 'She advocated equal rights for women.' },
    { jp: 'ポスターは即刻壁から撤去された。', en: 'The posters were immediately removed from the wall.' },
  ],
  '撮': [
    { jp: '日本へ来るとき、空港で写真を撮りました。', en: 'When I came to Japan, I took a picture at the airport.' },
    { jp: 'ほら、見て！空が真っ赤っ赤だよ。写真撮っておこうよ。', en: 'Woah, look! The sky\'s bright red. Let\'s take a picture.' },
  ],
  '撲': [
    { jp: '左腕に打撲傷を負った。', en: 'I got my left arm bruised.' },
    { jp: 'けんかの後、彼は体中に打撲を負っていた。', en: 'He had bruises all over his body after the fight.' },
  ],
  '擁': [
    { jp: '誰がトムを擁護した？', en: 'Who defended Tom?' },
    { jp: '稲が稔る季節になりました。', en: 'The season when rice ripens has come.' },
  ],
  '操': [
    { jp: 'この自動車は操縦しやすい。', en: 'This car is easy to handle.' },
    { jp: '操縦席よりご挨拶申し上げます。', en: 'This is your pilot speaking.' },
  ],
  '擦': [
    { jp: '現在の日米貿易摩擦の原因は何であると思いますか。', en: 'What do you think has caused the present trade friction between Japan and the U.S.?' },
    { jp: '靴が擦り減っちゃった。', en: 'My shoes are worn out.' },
  ],
  '擬': [
    { jp: '創造説は擬似科学だ。', en: 'Creationism is pseudoscience.' },
    { jp: 'スポーツは率直に言って模擬的な戦闘である。', en: 'Sport is frankly mimic warfare.' },
  ],
  '攻': [
    { jp: 'カモメはうるさい鳴き声やフン害、ゴミ袋を裂いたり、 食べ物を狙って攻撃するなどの迷惑行為を引き起こします。', en: 'Seagulls cause all types of disturbances by cackling loudly, spreading guano, tearing up garbage bags and attacking to get food.' },
    { jp: '専攻は何でしたか？', en: 'What was your major?' },
  ],
  '故': [
    { jp: '故郷はどうだった？', en: 'How was your hometown?' },
    { jp: 'ここが私の故郷です。', en: 'This is my hometown.' },
  ],
  '敏': [
    { jp: '私は寒さに敏感だ。', en: 'I am very sensitive to the cold.' },
    { jp: '犬はにおいに敏感だ。', en: 'Dogs have a keen sense of smell.' },
  ],
  '救': [
    { jp: '救急車呼びますね。', en: 'I\'ll call an ambulance.' },
    { jp: '救急車呼びましょうか？', en: 'Should I call an ambulance?' },
  ],
  '敢': [
    { jp: '初めから果敢に前へ出て圧倒し、体勢を崩した相手を押し出した。', en: 'He resolutely pushed forward from the start, overwhelming and pushing out his off-balance opponent.' },
    { jp: '誰もが二の足を踏むような厳しい仕事だが、果敢に取り組んでいた。', en: 'It was a tough job that would make anyone think twice, but he met it with resolve.' },
  ],
  '整': [
    { jp: '不整脈があります。', en: 'I have an irregular pulse.' },
    { jp: '本を整頓しなさい。', en: 'Put your books in order.' },
  ],
  '敵': [
    { jp: '昨日の敵は今日の友。', en: 'An enemy yesterday can be a friend today.' },
    { jp: '敵は新兵力を投入した。', en: 'The enemy flung fresh troops into the battle.' },
  ],
  '敷': [
    { jp: '敷金は必要ですか。', en: 'Do you require a security deposit?' },
    { jp: '２ヶ月分の敷金を入れていただきます。', en: 'Please pay a deposit of two month\'s rent.' },
  ],
  '斉': [
    { jp: '彼らは一斉に笑い始めた。', en: 'All at once they began to laugh.' },
    { jp: '皆が一斉に喋っています。', en: 'Everyone is talking at the same time.' },
  ],
  '斎': [
    { jp: '「もしもし、営業部です」「斎藤くんいるかね？」「斎藤部長ですか？」「そうだ」「失礼ですが.......」「田中だよ。田中」「失礼しました。部長、田中常務からお電話です」', en: '"Sales department, how can I help you?" "Is Saito there?" "Mr. Saito, our manager?" "Right." "May I ask who\'s calling?" "It\'s Tanaka." "Excuse me. Boss! Director Tanaka is on the phone."' },
    { jp: '私の書斎は２階にある。', en: 'My study is upstairs.' },
  ],
  '斐': [
    { jp: '最近ずっと、このお店に通ってます。雰囲気や客層も良いし、何より落ち着くの。ところで、あなたってここで何年働いてるの？ここで働いてて遣り甲斐を感じる？', en: 'Recently I\'ve been going to this shop a lot. The atmosphere is good, the customers are nice, and it\'s just really calming. How many years have you been working at this shop? Do you find it rewarding to work here?' },
    { jp: '彼女は甲斐性のない旦那に嫌気が差したから離婚したのよ。', en: 'She divorced her good-for-nothing husband because she was disgusted with him.' },
  ],
  '斗': [
    { jp: '北斗の拳が大好きだよ！', en: 'I love Fist of the North Star!' },
    { jp: 'あれは北斗七星だよ。', en: 'That\'s the Big Dipper.' },
  ],
  '斜': [
    { jp: '布を斜めに切ります。', en: 'Cut the cloth diagonally.' },
    { jp: 'どうしてご機嫌斜めなの？', en: 'Why are you in a bad mood?' },
  ],
  '斤': [
    { jp: '私は朝食用に食パンを一斤買った。', en: 'I bought a loaf of bread for breakfast.' },
    { jp: 'パンを一斤買わなければいけなかったのを思い出した。', en: 'I just remembered that I was supposed to buy a loaf of bread.' },
  ],
  '於': [
    { jp: '私の友人に大学を卒業して立派な官吏となっておる者がある。ある時この人が私に曰うに、僕は学校に於て教ったことは何も役に立たなかった、しかし少しばかり学んだ哲学が僕に非常な利益を与えたと。', en: 'I have one of my friends who graduated from university and became a fine public servant. Once he told me that what he had learned from school had been useless. However, what little philosophy he had learned proved to be of great benefit.' },
  
    { jp: '於は日本語の語彙の中に含まれる漢字だ。', en: '於 is a kanji found in the Japanese vocabulary.' },
  ],
  '施': [
    { jp: '門を施錠してください。', en: 'Please lock the gate.' },
    { jp: '宿泊施設を捜しています。', en: 'We are looking for lodging accommodations.' },
  ],
  '旋': [
    { jp: '飛行機は東へ旋回した。', en: 'The plane turned eastward.' },
    { jp: '飛行機は墜落寸前に右に旋回した。', en: 'The plane turned sharply to the right just before it crashed.' },
  ],
  '旗': [
    { jp: '彼は旗をかかげた。', en: 'He put up a flag.' },
    { jp: '旗を変えてください。', en: 'Change the flag, please.' },
  ],
  '既': [
    { jp: '彼女は既に眠っている。', en: 'She is already sleeping.' },
    { jp: '彼らは既に結婚していた。', en: 'They already got married.' },
  ],
  '旦': [
    { jp: '旦那の好きなおにぎりは変わっている。ご飯に何も味を付けないかつおぶしを一袋混ぜて、手に塩をして握る。', en: 'The way my husband likes onigiri is extremely unusual. You first mix rice with one bag of unflavoured katsuobushi, then you grab some salt with your hands and squeeze it to shape.' },
    { jp: 'よく旦那さんに嘘をつきますか？', en: 'Do you often lie to your husband?' },
  ],
  '旨': [
    { jp: '私の申し出に応じられないという趣旨の手紙を彼から受け取った。', en: 'I received a letter from him to the effect that he could not accept my offer.' },
    { jp: '仏心宗と呼ばれるのは、禅宗が文字や経典をたよらずに、仏の心を師匠から弟子へと直接伝えていくことを根本宗旨としているからです。', en: 'Zen Buddhism is also called "Buddha\'s mind school" because of its basic tenet of transmitting the mind of Buddha directly from teacher to student without relying on writings or sutras.' },
  ],
  '旬': [
    { jp: 'トムは１０月上旬からここにいます。', en: 'Tom has been here since early October.' },
    { jp: '７月の上旬は、海に行くのは早いかな？', en: 'I wonder if the first week or so of July is too early to go to the beach.' },
  ],
  '旺': [
    { jp: 'トムは好奇心旺盛だ。', en: 'Tom is curious.' },
    { jp: '本当に好奇心旺盛だよね？', en: 'You are really full of curiosity, aren\'t you?' },
  ],
  '昆': [
    { jp: '蝶々って、昆虫なの？', en: 'Are butterflies insects?' },
    { jp: '蚊は昆虫の一種です。', en: 'Mosquitoes are insects.' },
  ],
  '昌': [
    { jp: '両親は赤ん坊を昌と名づけた。', en: 'The parents named their baby Akira.' },
  
    { jp: '昌は日本語の語彙の中に含まれる漢字だ。', en: '昌 is a kanji found in the Japanese vocabulary.' },
  ],
  '昭': [
    { jp: '僕は昭和生まれです。', en: 'I was born during the Showa era.' },
    { jp: '昭和の次は平成です。', en: 'Heisei is next after the Showa era.' },
  ],
  '是': [
    { jp: '是非、彼に会いたいわ。', en: 'I want to see him at all costs.' },
    { jp: '是非、説明させてください！', en: 'Please, let me explain!' },
  ],
  '晃': [
    { jp: '私達は今日金晃丸という種類の仙人掌を買いました。', en: 'Today we bought a variety of cactus known as kinkoumaru.' },
  
    { jp: '晃は日本語の語彙の中に含まれる漢字だ。', en: '晃 is a kanji found in the Japanese vocabulary.' },
  ],
  '晋': [
    { jp: '日本の安倍晋三首相は、2020年夏季東京オリンピックを延期せざるを得ないかもしれないと発言した。', en: 'Japanese Prime Minister Shinzo Abe said the 2020 Tokyo Summer Olympic Games may have to be postponed.' },
    { jp: '日本の安倍晋三首相は持病を懸念し辞意を表明しました。', en: 'Japanese Prime Minister Shinzo Abe has announced he is stepping down due to chronic health concerns.' },
  ],
  '晶': [
    { jp: '２月の誕生石は、アメジストです。和名は「紫水晶」と言います。', en: 'The birthstone of February is amethyst. It\'s Japanese name is "Murasaki Suishou".' },
    { jp: '液晶画面は、見にくいなぁ。', en: 'You can\'t see too well with these LCD displays.' },
  ],
  '智': [
    { jp: '智子が貸してくれた漫画はちっとも面白くなかった。', en: 'The comic book that Tomoko lent me was not at all interesting.' },
    { jp: '智子は友だちに、パーティに来てくれるよう頼んだ。', en: 'Tomoko asked her friends to come to her party.' },
  ],
  '暁': [
    { jp: '劉暁波は中国人です。', en: 'Liu Xiaobo is Chinese.' },
    { jp: '退職した暁には全ての時間をタトエバに捧げよう。', en: 'Once I retire, I will dedicate all my time to Tatoeba.' },
  ],
  '暇': [
    { jp: 'トムは休暇を願い出た。', en: 'Tom asked for a day off.' },
  
    { jp: '暇は日本語の語彙の中に含まれる漢字だ。', en: '暇 is a kanji found in the Japanese vocabulary.' },
  ],
  '暑': [
    { jp: 'ある暑い夏の午後、ジョンとダンヌは長くなった牧草を刈っていました。', en: 'One hot summer afternoon, John and Dan were cutting the long grass.' },
    { jp: '残暑厳しい折いかがお過ごしでしょうか。', en: 'How are you doing in this scorching late summer heat?' },
  ],
  '暖': [
    { jp: 'あそこって、暖かい？', en: 'Is it warm there?' },
    { jp: 'ぽかぽかと暖かい。', en: 'It\'s balmy today.' },
  ],
  '暢': [
    { jp: 'トムは流暢に話す。', en: 'Tom speaks fluently.' },
    { jp: '君は流暢な英語を話す。', en: 'You speak fluent English.' },
  ],
  '暦': [
    { jp: '故郷に還りたいです。', en: 'I want to return to my hometown.' },
    { jp: '暦の上では春です。', en: 'According to the calendar, it is spring.' },
  ],
  '暫': [
    { jp: '私は暫く待つように言われた。', en: 'I was told to wait for a while.' },
    { jp: '「直る見込みは？」「システム開発チームのシュバイシェン博士が現在闘病中のため、もう暫くはかかるかと・・・」', en: '"Prospects for repair?" "Prof. Shubaishen, the leader of the system development team, is presently unwell so we think it will take a while longer ..."' },
  ],
  '曹': [
    { jp: '塩と重曹を水に加えてください。', en: 'Add salt and baking soda to the water.' },
  
    { jp: '曹は日本語の語彙の中に含まれる漢字だ。', en: '曹 is a kanji found in the Japanese vocabulary.' },
  ],
  '朗': [
    { jp: '彼は明朗快活な青年だ。', en: 'He is a cheerful young man.' },
    { jp: '彼はいつも朗らかだ。', en: 'He is always cheerful.' },
  ],
  '朱': [
    { jp: '朱に交われば赤くなる。', en: 'He who touches pitch shall be defiled therewith.' },
    { jp: '満面朱をそそいで怒った。', en: 'He went red in the face with rage.' },
  ],
  '朴': [
    { jp: 'マリーは素朴な学生だ。', en: 'Marie is a naive student.' },
    { jp: '素朴な疑問なんだけど、・・・トラとライオンはどっちが強いの？', en: 'This may be a silly question, but which is stronger - a tiger or a lion?' },
  ],
  '朽': [
    { jp: 'この映画はまさしく不朽の名作である。', en: 'This film is indeed an enduring masterpiece.' },
    { jp: 'この数年間に彼は不朽の名詩を書いた。', en: 'During these years he wrote immortal poems.' },
  ],
  '李': [
    { jp: '李下に冠を正さず。', en: 'Avoiding the appearance of evil.' },
    { jp: '何故生きてゆくのは苦しいか、何故、苦しくとも、生きて行かなければならないか。勿論、李は一度もそう云う問題を考えて見た事がない。', en: 'Why is it painful to live? And why must we continue to live despite the pain? Of course, Lee had never considered such a question before.' },
  ],
  '杏': [
    { jp: '銀杏は大きな木だよ。', en: 'Ginkgos are large trees.' },
    { jp: '銀杏は生きた化石です。', en: 'The gingko is a living fossil.' },
  ],
  '杜': [
    { jp: '休みの前などは少し羽目を外して飲むのだが、杜仲茶割りで飲むと二日酔いが全くない。', en: 'I usually cut loose a bit and drink plenty before a day off work, but if my drinks are cut with tochu tea, then I get absolutely no hangover.' },
  
    { jp: '杜は日本語の語彙の中に含まれる漢字だ。', en: '杜 is a kanji found in the Japanese vocabulary.' },
  ],
  '条': [
    { jp: '認めるけど、条件が一つ。', en: 'I\'ll accept it, but with one condition.' },
    { jp: '支払条件もご提示下さい。', en: 'Also, please let us know about your terms of payment.' },
  ],
  '松': [
    { jp: 'それは松の木です。', en: 'That\'s a pine tree.' },
    { jp: '松の木を植樹しました。', en: 'I planted a pine tree.' },
  ],
  '析': [
    { jp: '精神分析って何ですか？', en: 'What is psychoanalysis?' },
    { jp: 'さらなる分析が必要だ。', en: 'Further analysis is required.' },
  ],
  '枠': [
    { jp: 'イノベーションを起こす人は、いったん今までの枠組みから外に出て考える。', en: 'Innovators think outside the box.' },
    { jp: '彼らは窓枠を黄色く塗った。', en: 'They painted the window frames yellow.' },
  ],
  '枢': [
    { jp: '東京は今や世界経済の中枢だ。', en: 'Tokyo is now a center of the world economy.' },
    { jp: '私はもっと敵の抵抗があると踏んでたんだけど、むしろ中枢に進むほど敵が減ってきてる・・・。おかしいと思わないかしら？', en: 'I had expected stronger resistance from the enemy but if anything there are less of them as we advance to the centre... Don\'t you think that\'s strange?' },
  ],
  '架': [
    { jp: 'その橋を架けるのに３年近くかかったんだ。', en: 'It took nearly three years to build that bridge.' },
    { jp: '１０年前その川には小さな橋が架かっていた。', en: 'There used to be a small bridge over the river 10 years ago.' },
  ],
  '柄': [
    { jp: 'いとこの間柄です。', en: 'We are cousins.' },
    { jp: 'トマトの作柄は良だ。', en: 'The tomato crop is of good quality.' },
  ],
  '某': [
    { jp: 'ある日、私が戻ってくると、女房と、友人の某とが、炬燵の中に入っているのである。', en: 'One day, I came back and my wife and one of my friends were inside the kotatsu.' },
    { jp: '某連盟元会長が背任の容疑で逮捕されました。', en: 'The former president of a certain association has been arrested on suspicion of breach of trust.' },
  ],
  '染': [
    { jp: '髪染めたことある？', en: 'Have you ever dyed your hair?' },
    { jp: 'それって伝染するの？', en: 'Is it contagious?' },
  ],
  '柚': [
    { jp: '柚子は柑橘類の１つです。', en: 'Yuzu is one of the citrus fruits.' },
    { jp: '冬至には柚子湯に入ります。', en: 'On the winter solstice we have a hot bath with yuzu citrus fruits in it.' },
  ],
  '柳': [
    { jp: '柳の枝に雪折れなし。', en: 'Oaks may fall when reeds stand the storm.' },
    { jp: '花火のフィナーレを飾った「しだれ柳」は、夜空に華やかに舞い上がり、緩やかな弧を描きながらゆっくりと垂れ下がって、やがてその可憐な姿を消していった。', en: 'The Firework\'s displays final "Weeping Willow" display brilliantly launched into the night sky, slowly dripping down as it drew a gentle slope until finally its blossoming figure gradually vanished.' },
  ],
  '栓': [
    { jp: '百円玉ではなくて、瓶の栓でした。', en: 'It wasn\'t a 100 yen coin, it was a bottle cap.' },
    { jp: '耳栓を買いたいのですが。', en: 'I\'d like to buy some earplugs.' },
  ],
  '栗': [
    { jp: '焼き栗が好きです。', en: 'I like roasted chestnuts.' },
    { jp: 'この栗毛馬、速いなぁ。', en: 'The chestnut horse is fast.' },
  ],
  '株': [
    { jp: '彼は株に投資した。', en: 'He invested his money in stocks.' },
    { jp: '株主総会が開かれた。', en: 'The shareholders meeting was held.' },
  ],
  '核': [
    { jp: '世界的な全面核戦争が起これば、地球規模でこの「核の冬」が数カ月間も続くと言われています。', en: 'If there\'s a world-wide all-out nuclear war it\'s said that there will be a "nuclear winter" all over the planet for several months.' },
    { jp: '原子力は原子核分裂と核融合反応で作られている。', en: 'Nuclear energy is produced by splitting atoms or by bringing them together.' },
  ],
  '栽': [
    { jp: '私は多くの種類のバラを栽培している。', en: 'I grow many kinds of roses.' },
    { jp: '米の栽培をしています。', en: 'I grow rice.' },
  ],
  '桃': [
    { jp: '「それ何？」「桃だよ」', en: '"What\'s that?" "A peach."' },
    { jp: '一桃腐りて百桃損ず。', en: 'One rotten apple spoils the barrel.' },
  ],
  '案': [
    { jp: '建設的な提案だよ。', en: 'That\'s a constructive suggestion!' },
    { jp: '何か提案はありますか？', en: 'Do you have a suggestion?' },
  ],
  '桑': [
    { jp: '仏桑花が咲いています。', en: 'The China roses are in bloom.' },
  
    { jp: '桑は日本語の語彙の中に含まれる漢字だ。', en: '桑 is a kanji found in the Japanese vocabulary.' },
  ],
  '桜': [
    { jp: '桜は今が満開です。', en: 'The cherry trees are in full blossom.' },
    { jp: '桜が舞い散っている。', en: 'Cherry blossom is wafting down from the trees.' },
  ],
  '桟': [
    { jp: '昔ここには桟橋があったんだ。', en: 'There used to be a pier here.' },
    { jp: 'コンクリート桟橋なのですが、途中何カ所か崩壊しています。', en: 'It\'s a concrete bridge, but several places along its length have collapsed.' },
  ],
  '梅': [
    { jp: '梅雨らしく空はどんよりしている。', en: 'The sky is gloomy and gray - a typical rainy-season sky.' },
    { jp: '今年は梅雨明けが遅かった。', en: 'The end of the rainy season came late this year.' },
  ],
  '梓': [
    { jp: 'ノンフィクション作家が新作を上梓した。', en: 'The nonfiction writer has published a new work.' },
  
    { jp: '梓は日本語の語彙の中に含まれる漢字だ。', en: '梓 is a kanji found in the Japanese vocabulary.' },
  ],
  '梨': [
    { jp: '梨奈は家政部で、主に洋裁をやっている。', en: 'Rina is in the home economics club. Her main activity is dressmaking.' },
    { jp: '梨はお好きですか？', en: 'Do you like pears?' },
  ],
  '棄': [
    { jp: '彼らは婚約を破棄した。', en: 'They called off their engagement.' },
    { jp: '「結婚したんじゃなかったのかよ？」「あぁ、別れちゃった。婚約破棄」', en: '"Didn\'t you get married!?" "Oh, we split up. We broke our engagement."' },
  ],
  '棋': [
    { jp: '日本の「将棋」は、チェスに相当する。', en: 'Japanese shogi corresponds to chess.' },
    { jp: '日本の将棋には何種類の駒がありますか。', en: 'How many different pieces are there in Japanese chess?' },
  ],
  '棚': [
    { jp: '辞書はあそこの本棚にあります。', en: 'There\'s a dictionary on that bookshelf.' },
    { jp: '書斎にもう一つ本棚が欲しいんだけど、置くスペースがないんだよ。', en: 'I wish I could have another bookshelf in the study, but there is no space for it.' },
  ],
  '棟': [
    { jp: '父は棟梁なんですよ。', en: 'My father is a master builder.' },
    { jp: '建物は２棟とも全焼した。', en: 'Both buildings burned down.' },
  ],
  '棺': [
    { jp: '生前葬のような入棺体験に参加した人々があると聞いたから驚いた。', en: 'I was surprised to hear that there are people who participate in "inside a coffin experiences" similar to those funerals held for still living people.' },
  
    { jp: '棺は日本語の語彙の中に含まれる漢字だ。', en: '棺 is a kanji found in the Japanese vocabulary.' },
  ],
  '椎': [
    { jp: '三人がつづいて横町へはいると、路ばたの大きい椎の木のこずえから、鴉らしい一羽の鳥がおどろかされたように飛び起った。', en: 'As the three men entered the alley, a bird resembling a crow flew from the top of a large beech tree as if it had been frightened.' },
    { jp: '「椎茸」はキノコの一種だ。', en: '"Shiitake" is a sort of mushroom.' },
  ],
  '検': [
    { jp: '探検隊は南極への出発を延期した。', en: 'The expedition has postponed its departure to the Antarctic.' },
    { jp: 'ネットで検索して。', en: 'Look for it online.' },
  ],
  '椿': [
    { jp: '椿ちゃんはぬいぐるみが大好きなんでしょう？', en: 'Tsubaki loves stuffed animals, right?' },
  
    { jp: '椿は日本語の語彙の中に含まれる漢字だ。', en: '椿 is a kanji found in the Japanese vocabulary.' },
  ],
  '楊': [
    { jp: '武士は食わねど高楊枝。', en: 'A samurai, even when he has not eaten, uses a toothpick like a lord.' },
    { jp: 'トムは爪楊枝をくわえていた。', en: 'Tom was chewing on a toothpick.' },
  ],
  '楼': [
    { jp: '蜃気楼は幻影だと言われている。', en: 'A mirage is said to be an illusion.' },
  
    { jp: '楼は日本語の語彙の中に含まれる漢字だ。', en: '楼 is a kanji found in the Japanese vocabulary.' },
  ],
  '概': [
    { jp: '冗談も大概にしろ！', en: 'You mustn\'t carry your jokes too far!' },
    { jp: '既成概念を壊そう！', en: 'Let\'s break stereotypes!' },
  ],
  '槽': [
    { jp: '水槽を持ってるんだ。', en: 'I have a fish tank.' },
    { jp: 'トムは水槽の魚を何時間も眺めていた。', en: 'Tom spent hours looking at the fish in the tank.' },
  ],
  '標': [
    { jp: '目標は一等賞です。', en: 'The goal is the first prize.' },
    { jp: '目の前の標識を見ろよ。', en: 'Look at the sign just ahead of you.' },
  ],
  '模': [
    { jp: '天気は荒れ模様です。', en: 'The weather is stormy.' },
    { jp: 'ひと雨きそうな空模様だね。', en: 'It looks like it\'s going to rain.' },
  ],
  '樹': [
    { jp: '山火事は、樹木が燃えるだけの被害と理解されていますが、実はとんでもない「隠れキャラ」があります。', en: 'Mountain fires are thought of causing little harm with the only damage being the burning of trees and shrubs, but actually there\'s a hell of a \'hidden character\'.' },
    { jp: '果樹栽培者がリンゴの接ぎ穂を台木に接ぎ木しました。', en: 'The orchardist grafted an apple bud onto the rootstock.' },
  ],
  '橘': [
    { jp: 'レモンは柑橘類です。', en: 'Lemons are citrus fruits.' },
    { jp: '柚子は柑橘類の１つです。', en: 'Yuzu is one of the citrus fruits.' },
  ],
  '欄': [
    { jp: '空欄を埋めなさい。', en: 'Fill in the blanks.' },
    { jp: 'メール欄を一回クリックした。', en: 'I clicked the email field once.' },
  ],
  '欺': [
    { jp: '詐欺師が捕まった。', en: 'The imposter was caught.' },
    { jp: 'なんか詐欺っぽいね。', en: 'It sounds like a scam.' },
  ],
  '款': [
    { jp: '日本のＯＤＡは返済期間３０年、利率２％前後という条件の緩い円借款が大部分を占める。', en: 'Japan\'s ODA largely consists of concessionary yen credit repayable in 30 years, carrying an interest rate of 2% or so.' },
    { jp: 'ついに我がデジタルグルーヴクラブの定款が完成しました。', en: 'The articles of incorporation have finally been completed for our Digital Groove Club.' },
  ],
  '歓': [
    { jp: '彼らの都合が合う日に新歓コンパをしたいと思います。', en: 'We would like to give a welcome party for the new members when it\'s convenient for them.' },
    { jp: '私は歓迎をうけた。', en: 'I received a welcome.' },
  ],
  '殊': [
    { jp: '僕は殊の外不運だった。', en: 'I was exceptionally unlucky.' },
    { jp: 'ロックは殊に若者に人気だ。', en: 'Rock music is especially popular among young people.' },
  ],
  '殖': [
    { jp: 'うさぎは繁殖が早い。', en: 'Rabbits breed quickly.' },
    { jp: '檻で飼育されると繁殖しない動物もいる。', en: 'Some animals will not breed when kept in cages.' },
  ],
  '殴': [
    { jp: 'わかった。わかった。わかったから、もう殴るのだけはやめてくれ。', en: 'I know. I know. I get it already, so stop hitting me.' },
    { jp: '何度殴り倒されても、闘い続けるなんて立派なもんだ。', en: 'It\'s so admirable how you keep fighting, even when you\'ve been knocked down over and over again.' },
  ],
  '殻': [
    { jp: '卵の殻は壊れやすい。', en: 'The shell of an egg is easily broken.' },
    { jp: 'あの子は海辺の貝殻売りだ。', en: 'She sells seashells by the seashore.' },
  ],
  '毅': [
    { jp: 'これほどの災害に遭っても、冷静で毅然としていた日本人の姿は全世界の人に深い印象を残した。', en: 'The image of the Japanese people remaining calm and composed even in the face of such a natural disaster left a deep impression on all people on earth.' },
    { jp: '子供たちに毅然とした態度を取らなければ、手が付けられなくなるでしょう。', en: 'If you are not firm with the children, they will get out of hand.' },
  ],
  '氏': [
    { jp: '水は華氏３２度で凍る。', en: 'Water freezes at 32 degrees Fahrenheit.' },
    { jp: '頭で華氏から摂氏に変換した。', en: 'I converted the temperature from Fahrenheit to Celsius in my head.' },
  ],
  '汁': [
    { jp: 'トムは毎日果汁100%のオレンジジュースを飲んでいる。', en: 'Tom drinks 100% pure orange juice every day.' },
    { jp: '小さい頃は豚汁が苦手だったけど、今は大丈夫よ。', en: 'I didn\'t like tonjiru when I was younger, but I\'m okay with it now.' },
  ],
  '江': [
    { jp: '生粋の江戸っ子です。', en: 'I am a pure Edoite.' },
    { jp: 'トムは江南区に住んでいます。', en: 'Tom lives in Gangnam.' },
  ],
  '汰': [
    { jp: 'ご無沙汰しています。', en: 'It has been a long time since I wrote you last.' },
    { jp: '地獄の沙汰も金次第。', en: 'Money is everything.' },
  ],
  '汽': [
    { jp: '汽車に間にあった。', en: 'I got there in time for the train.' },
    { jp: '汽船は見えなくなった。', en: 'The steamer is now out of sight.' },
  ],
  '沖': [
    { jp: '沖縄県民斯く戦えり。', en: 'Thus fought the Okinawan people.' },
    { jp: '沖縄の最低賃金は642円です。', en: 'The minimum wage in Okinawa is 642 yen per hour.' },
  ],
  '沙': [
    { jp: '長いこと御無沙汰いたしました。', en: 'I have been out of touch with you for a long time.' },
    { jp: 'ご無沙汰しています。', en: 'It has been a long time since I wrote you last.' },
  ],
  '没': [
    { jp: '日没前に仕事を終えるよう全力をつくしてやった。', en: 'We went all out to finish the work before dark.' },
    { jp: '私の免許は没収になった。', en: 'My license was confiscated.' },
  ],
  '沢': [
    { jp: '金沢は静かな町です。', en: 'Kanazawa is a quiet city.' },
    { jp: '石川県の県庁所在地は金沢市です。', en: 'Ishikawa Prefecture\'s capital is Kanazawa City.' },
  ],
  '沼': [
    { jp: 'トムは泥沼にはまった。', en: 'Tom fell into the mud.' },
    { jp: 'この沼には魚がいる。', en: 'There are fish in this marsh.' },
  ],
  '沿': [
    { jp: '川沿いを歩いたよ。', en: 'I walked along the river.' },
    { jp: '彼は海岸沿いに歩いた。', en: 'He walked along the shore.' },
  ],
  '泌': [
    { jp: '女性ホルモン分泌の乱れが不妊症の大きな原因です。', en: 'Female hormone imbalance is a major cause of infertility.' },
    { jp: '女性が自慰をすれば女性ホルモンが分泌され、女性らしさが出てきます。', en: 'If a woman masturbates, she will secrete female hormones and become more feminine.' },
  ],
  '泡': [
    { jp: '俺のことを馬鹿にした町の連中に、ひと泡吹かせてやる。', en: 'I\'ve got a little surprise in store for the downtown boys who made fun of me.' },
    { jp: '長年の苦労が水の泡だ。', en: 'Years of effort came to nothing.' },
  ],
  '泣': [
    { jp: 'その迷子の女の子は泣きじゃくりながら名前を言った。', en: 'The stray girl sobbed her name.' },
    { jp: '子どもが泣きながら地団太を踏んでいます。', en: 'The child is crying and stamping his feet.' },
  ],
  '洞': [
    { jp: '洞窟は真っ暗だった。', en: 'It was pitch-dark in the cave.' },
    { jp: 'トムは洞窟に入ったよ。', en: 'Tom entered the cave.' },
  ],
  '津': [
    { jp: '津波は滅多にない。', en: 'Tsunamis are very rare.' },
    { jp: 'トムは興味津々だ。', en: 'Tom is curious.' },
  ],
  '洪': [
    { jp: '堤防が洪水を防いだ。', en: 'The levee kept the floodwater back.' },
    { jp: '地震や洪水は天災です。', en: 'Earthquakes and floods are natural disasters.' },
  ],
  '洲': [
    { jp: '５月１０日月曜日の午後３時に東京駅八重洲中央口で待ち合わせをしていただけませんか。', en: 'Would you please meet me at Yaesu central gate of Tokyo Station on Monday, May 10th at 3:00 p.m.?' },
  
    { jp: '洲は日本語の語彙の中に含まれる漢字だ。', en: '洲 is a kanji found in the Japanese vocabulary.' },
  ],
  '派': [
    { jp: '彼は立派な青年だ。', en: 'He\'s a fine young man.' },
    { jp: '彼女は活発で派手だ。', en: 'She is lively and flashy.' },
  ],
  '浄': [
    { jp: '当店の水は浄水器を使用しています。', en: 'This store uses a water filter.' },
    { jp: 'そのコーヒーは洗浄水のような味がする。', en: 'The coffee tastes like wash water.' },
  ],
  '浜': [
    { jp: 'この町は浜辺が二つです。', en: 'This town has two beaches.' },
    { jp: '彼らは浜辺にテントを張った。', en: 'They set up their tents on the beach.' },
  ],
  '浦': [
    { jp: '三浦容疑者の拘置中の過ごし方が明らかになった。', en: 'It has become clear what murder-suspect Miura\'s jail lifestyle is like.' },
    { jp: 'この学校には、全国津々浦々から秀才達が集まっている。', en: 'Talented students come from far and wide to attend this school.' },
  ],
  '浩': [
    { jp: '浩二は家に帰る途中でにわか雨にあった。', en: 'Koji was caught in a shower on his way home.' },
  
    { jp: '浩は日本語の語彙の中に含まれる漢字だ。', en: '浩 is a kanji found in the Japanese vocabulary.' },
  ],
  '浪': [
    { jp: '人生を振り返ってみると、私はいかに多くの時間を浪費したかがわかる。', en: 'When I look back on my life, I realize how much time I wasted.' },
    { jp: '浪費は欠乏のもと。', en: 'Waste makes want.' },
  ],
  '浸': [
    { jp: '海抜の低い土地は水浸しになるだろう。このことは、人々が住むところがなくなり、農作物は塩水によって損害を受けることを意味する。', en: 'Low-lying lands will flood. This means that people will be left homeless and their crops will be destroyed by the salt water.' },
    { jp: 'お茶っぱは、少なくとも５分は浸しましょう。', en: 'Let the tea steep for at least 5 minutes.' },
  ],
  '涯': [
    { jp: 'トムは生涯貧乏だった。', en: 'Tom has been in poverty all his life.' },
    { jp: '彼は一生涯貧乏だった。', en: 'He remained poor all his life.' },
  ],
  '淡': [
    { jp: 'サケは淡水で産卵する。', en: 'Salmon lay their eggs in fresh water.' },
    { jp: 'その魚は淡水に生息しています。', en: 'That fish lives in fresh water.' },
  ],
  '添': [
    { jp: 'あのマヨネーズの中、添加物ばっかり！', en: 'There are only chemicals in that mayo!' },
    { jp: '場所の確認：見合いの場所を本人か付き添い人が下見をしておきましょう。', en: 'Location check: The parties involved themselves or their attendants should look over the place for the miai meeting in advance.' },
  ],
  '渇': [
    { jp: '今は喉が渇いて死にそうだ。', en: 'I\'m dying of thirst at the moment.' },
    { jp: '砂漠は渇いた大地です。', en: 'The desert is a dry land.' },
  ],
  '渉': [
    { jp: '交渉は大事な局面を迎えた。', en: 'The negotiation has entered upon a serious phase.' },
    { jp: '両国は平和交渉を開始した。', en: 'Both countries entered into peace negotiations.' },
  ],
  '渋': [
    { jp: 'だからまあ、学生会としても苦渋の決断てやつなんだ。わかってやってくれ。', en: 'So, well, it\'s a bitter decision for the student council to make as well. Give \'em a break.' },
    { jp: '柿は栄養価が高く、甘いのは最高に美味ですが、時々渋いのがあります。', en: 'Persimmons are highly nutritious and a great delicacy, but sometimes you get a sour one.' },
  ],
  '渚': [
    { jp: 'くそー、渚のやつ、本当に先生にチクりやがった。', en: 'Dammit, that pest Nagisa, she really went and snitched on me to the teachers.' },
  
    { jp: '渚は日本語の語彙の中に含まれる漢字だ。', en: '渚 is a kanji found in the Japanese vocabulary.' },
  ],
  '渦': [
    { jp: 'ボートが渦潮に巻き込まれ横転しました。', en: 'The boat fell into a whirlpool and overturned.' },
    { jp: 'ボートは渦潮に飲み込まれ転覆してしまった。', en: 'The boat fell into a whirlpool and capsized.' },
  ],
  '湧': [
    { jp: '拍手が湧き上がった。', en: 'Applause broke out.' },
    { jp: 'トムは興味が湧きました。', en: 'Tom became curious.' },
  ],
  '源': [
    { jp: '貧乏は諸悪の根源。', en: 'Poverty is the root of all evil.' },
    { jp: '携帯の電源が切れた。', en: 'My phone shut off.' },
  ],
  '溝': [
    { jp: '両者の溝が狭まった。', en: 'The gap between them has narrowed.' },
    { jp: '溝に落ちると希望しています。', en: 'I hope you fall in a ditch.' },
  ],
  '滅': [
    { jp: '津波は滅多にない。', en: 'Tsunamis are very rare.' },
    { jp: 'トムは滅多に歌わない。', en: 'Tom rarely sings.' },
  ],
  '滋': [
    { jp: '滋賀県の県庁所在地は大津市です。', en: 'Shiga Prefecture\'s capital is Otsu City.' },
  
    { jp: '滋は日本語の語彙の中に含まれる漢字だ。', en: '滋 is a kanji found in the Japanese vocabulary.' },
  ],
  '滑': [
    { jp: 'トムは氷で滑った。', en: 'Tom slipped on ice.' },
    { jp: 'トムは滑舌がいい。', en: 'Tom is well-spoken.' },
  ],
  '滝': [
    { jp: '男が１人滝に打たれていた。', en: 'A man was hit by a waterfall.' },
    { jp: '裸で滝に打たれている男性を見た。', en: 'I saw a man standing naked under the waterfall.' },
  ],
  '滞': [
    { jp: 'その事故は交通渋滞を引き起こした。', en: 'The accident caused a traffic jam.' },
    { jp: '外国にはどのくらい滞在しましたか。', en: 'How long did you stay abroad?' },
  ],
  '漂': [
    { jp: 'バラの香りが漂っている。', en: 'The fragrance of roses is in the air.' },
    { jp: '俺は絶海の孤島の漂流者。', en: 'I am just a castaway on an island lost at sea.' },
  ],
  '漆': [
    { jp: '黒い天使は、その漆黒の翼を大きく広げて、空へと舞い上がる。', en: 'The black angel spread those jet-black wings wide and flew up into the sky.' },
    { jp: 'ひとの声に似た不気味な鳴き声、漆黒の羽、死肉を啄む姿などから、鴉は不幸に舞い降りる不吉な鳥として世界に知られています。', en: 'A creepy cry that sounds like a human voice, velvet black wings, the image of tearing into dead flesh; crows are known across the world as an ill-omened bird that flies down with ill-luck.' },
  ],
  '漏': [
    { jp: 'その話が漏れると私は困ったことになる。', en: 'I\'ll be in trouble if the story gets out.' },
    { jp: 'オシッコ漏れそう。', en: 'I\'m bursting for a pee.' },
  ],
  '漠': [
    { jp: '非常に残念なことに地球は一秒で1900平方メートルが砂漠化している。', en: 'Very regrettably, 1,900 square meters of land become desert every second.' },
    { jp: '砂漠に水をまくようなものだ。', en: 'It\'s like sprinkling water on a desert.' },
  ],
  '漫': [
    { jp: '漫画は読まないんだ。', en: 'I don\'t read comic books.' },
    { jp: '彼はいつも漫画を読んでいる。', en: 'He\'s always reading comics.' },
  ],
  '漬': [
    { jp: '普段あまり食べないのに、お茶漬けをさらさらと食べているコマーシャルを見ると、無性に食べたくなってしまう。', en: 'I don\'t usually eat it, but because I saw the commercial where the person was slurping down ochazuke, it made me really crave it.' },
    { jp: '別れたくないなら、私と過ごすか仕事漬けかどっちかにして。', en: 'If you want this marriage to work, you need to choose between spending time with me and working all the time.' },
  ],
  '漱': [
    { jp: '漱石は鴎外と同時代の人であった。', en: 'Soseki was a contemporary of Ohgai.' },
    { jp: '「春を待ちつつ」は漱石の小説だったね。', en: '"Waiting for Spring" is a novel by Soseki, isn\'t it?' },
  ],
  '漸': [
    { jp: '漸く目が覚めました。', en: 'I finally woke up.' },
    { jp: '漸く、私は何が起きたのか分かった。', en: 'I finally found out what happened.' },
  ],
  '潔': [
    { jp: '神よ、私に貞潔さと堅固さをおあたえください。ですが、いますぐにではなく。', en: 'God, please give me chastity and continence, but not yet.' },
    { jp: '私の隣人は本物の潔癖性です。', en: 'My neighbor\'s a real mysophobe.' },
  ],
  '潜': [
    { jp: '潜水して泳げるかい。', en: 'Can you swim underwater?' },
    { jp: 'メアリーは身を潜めていた。', en: 'Mary was hiding.' },
  ],
  '潟': [
    { jp: '新潟県の県庁所在地は新潟市です。', en: 'Niigata Prefecture\'s capital is Niigata City.' },
    { jp: '１人は福岡に住んでいて、残りは新潟に住んでいます。', en: 'One lives in Fukuoka, and the others live in Niigata.' },
  ],
  '潤': [
    { jp: '気温が低くて湿度が潤沢な気候があればといつも思います。', en: 'I always wish we had a climate with cooler temperatures and ample humidity.' },
    { jp: '水を飲んで喉を潤します。', en: 'I\'ll drink some water to quench my thirst.' },
  ],
  '潮': [
    { jp: '潮が満ち始めている。', en: 'The tide is coming in.' },
    { jp: '試合は最高潮に達した。', en: 'The game came to a climax.' },
  ],
  '澄': [
    { jp: '水色は澄んだ水の色を表し、明るく淡い青色のことである。', en: 'Aqua expresses the colour of clear water, it is a bright, and light, blue.' },
    { jp: '耳を澄ませてみたが、何も聞こえなかった。', en: 'I listened but could not hear any sound.' },
  ],
  '激': [
    { jp: '同社の売上げは輸出の需要が強いおかげで伸びたが、競争が激しく利益はそれほど伸びなかった。', en: 'Sales at the company zoomed thanks to brisk export demand, but profit did not keep up because of intense competition.' },
    { jp: 'トムはまだ激おこ？', en: 'Is Tom still mad?' },
  ],
  '濁': [
    { jp: '湖の水は濁っている。', en: 'The water in the lake is murky.' },
    { jp: 'コップの水は濁ってる。', en: 'The water in the glass is cloudy.' },
  ],
  '濫': [
    { jp: '台風で川が氾濫した。', en: 'The typhoon caused the river to flood.' },
    { jp: 'この川は氾濫しそうだ。', en: 'This river is going to overflow.' },
  ],
  '瀬': [
    { jp: 'もう年の瀬ですね。', en: 'The year is coming to an end.' },
    { jp: 'この店は瀬戸物を売っている。', en: 'This store sells pottery.' },
  ],
  '災': [
    { jp: '火災警報が鳴った。', en: 'The fire alarm rang.' },
    { jp: '火災の予防に努める。', en: 'We\'re working to prevent fires.' },
  ],
  '炉': [
    { jp: '原子力発電所の１号機で、原子炉内の燃料の溶融が進んでいる可能性が高い、と発表された。', en: 'It was announced that there is a high possibility of the fuel within the nuclear reactor of Nuclear Plant 1 melting.' },
    { jp: 'トムは暖炉のそばに座った。', en: 'Tom sat by the fireplace.' },
  ],
  '炊': [
    { jp: 'とろ火で時間をかけて豆を炊いてください。', en: 'Please simmer the beans for a while over a low heat.' },
    { jp: '炊飯器が買いたいな。', en: 'I want to buy a rice cooker.' },
  ],
  '炎': [
    { jp: '炎を弱くしなさい。', en: 'Turn the flame down low.' },
    { jp: '家は炎上していた。', en: 'The house was in flames.' },
  ],
  '為': [
    { jp: 'それはまさに侵略行為だ。', en: 'It is nothing less than an invasion.' },
    { jp: 'それは越権行為だ。', en: 'You are acting beyond your position.' },
  ],
  '烈': [
    { jp: 'いまだかつて偉大なもので熱烈な精神なくして成し遂げられたものは何もない。', en: 'Nothing great was ever achieved without enthusiasm.' },
    { jp: 'メアリーは強烈な個性の持ち主だ。', en: 'Mary has a strong personality.' },
  ],
  '焦': [
    { jp: 'ケーキが焦げたのは私の失敗です。電話で話していて、時間に気付かなかったのです。', en: 'It\'s my fault that the cake was burned. I was talking on the phone and didn\'t notice the time.' },
    { jp: '二重焦点レンズは「バイフォーカル」とも呼ばれる。', en: 'Lenses with two distinct optical powers are also called "bifocals".' },
  ],
  '煩': [
    { jp: '人には、迷いと苦しみのもとである煩悩がある。', en: 'People have worldly passions which lead them into delusions and sufferings.' },
    { jp: '「百八といえば煩悩の数だ」「お兄ちゃんはどんな煩悩があるの？」「言ってもいいが、検閲削除になるぞ」', en: '"Talking about 108, that\'s the number of worldly passions." "What worldly passions have you got then?" "I could say, but it\'ll get censored out."' },
  ],
  '煮': [
    { jp: '哺乳瓶は煮沸消毒すること。', en: 'Boil the milk bottles.' },
    { jp: 'ふたをして始めは強火、沸騰したら中火にして約７分間煮ます。', en: 'Put the lid on and start at high flame, when it boils set to medium flame and boil for about seven minutes.' },
  ],
  '熊': [
    { jp: '猟師は熊を撃った。', en: 'The hunter shot a bear.' },
    { jp: '洗熊は水を飲みます。', en: 'The raccoon drinks water.' },
  ],
  '熟': [
    { jp: '娘は未熟児でした。', en: 'My daughter was premature.' },
    { jp: 'りんごは熟れている。', en: 'The apples are ripe.' },
  ],
  '爵': [
    { jp: '爵位があるから、貴族だというわけにはいかないんだぜ。爵位が無くても、天爵というものを持っている立派な貴族のひともあるし、おれたちのように爵位だけは持っていても、貴族どころか、賤民にちかいのもいる。', en: 'It\'s not because you have a title, that you\'re a noble. There are people who have a natural nobility and are fine nobles. People like us who only have nobility titles are not nobles, we\'re more like peasants.' },
  
    { jp: '公爵は日本語で重要な言葉の一つだと思う。', en: 'I think 公爵 is one of the important words in Japanese.' },
  ],
  '爽': [
    { jp: '今日は爽やかな日だね。', en: 'It\'s balmy today.' },
    { jp: '猫が颯爽と塀をよじ登った。', en: 'The cat climbed lightly over the wall.' },
  ],
  '牧': [
    { jp: '１９６８年４月、キング牧師はテネシー州メンフィスにいた。', en: 'In April of 1968, Rev. King was in Memphis, Tennessee.' },
    { jp: 'ボブは牧師になりました。', en: 'Bob became a pastor.' },
  ],
  '牲': [
    { jp: 'この病気で数千の犠牲者が出た。', en: 'Thousands of people became victims of this disease.' },
    { jp: 'その戦争で数多くの犠牲者が出た。', en: 'As a result of the war, a great number of victims remained.' },
  ],
  '犠': [
    { jp: 'この場合犠牲になるのは、若い子牛と病気の動物か負傷した動物だ。', en: 'If this is the case, its victims are usually young calves, or injured or sick animals.' },
    { jp: '犠牲はつきものさ。', en: 'Sacrifices are inevitable.' },
  ],
  '狂': [
    { jp: '兄は熱狂的なサッカーファンだ。', en: 'My older brother is a very enthusiastic soccer fan.' },
    { jp: '熱狂的な観客が競技場になだれ込んだ。', en: 'The eager spectators crowded into the stadium.' },
  ],
  '狩': [
    { jp: '鷲はハエを狩らない。', en: 'Eagles don\'t hunt flies.' },
    { jp: '彼は森へ狩りに行った。', en: 'He went hunting in the woods.' },
  ],
  '独': [
    { jp: '私の弟はすぐに東京の独り暮らしに慣れた。', en: 'My brother soon got used to living alone in Tokyo.' },
    { jp: 'トムって独身なの？', en: 'Is Tom single?' },
  ],
  '狭': [
    { jp: '狭心症の発作が起きました。', en: 'I had an angina attack.' },
    { jp: '彼女の主張は正しかった。彼女が肩身の狭い思いをする必要などなかったのだ。', en: 'Her insistence was right. She did not need to feel ashamed.' },
  ],
  '猛': [
    { jp: '今年の夏は、猛暑だ。', en: 'It\'s awfully hot this summer.' },
    { jp: '今年は３０年ぶりの猛暑です。', en: 'This is the hottest summer we\'ve had in thirty years.' },
  ],
  '猟': [
    { jp: '猟師は熊を撃った。', en: 'The hunter shot a bear.' },
    { jp: '猟犬が森のほうにいった。', en: 'The hunting dog headed for the woods.' },
  ],
  '献': [
    { jp: '献血は今回が初めて？', en: 'Is this the first time you\'ve ever given blood?' },
    { jp: '神社に食べ物を献上した。', en: 'I offered food at the shrine.' },
  ],
  '猶': [
    { jp: '期限までの猶予はありません。', en: 'There is no grace period until the deadline.' },
    { jp: '一刻の猶予も許されなかった。', en: 'Not a moment could be lost.' },
  ],
  '猿': [
    { jp: '類人猿は知能が高い。', en: 'Apes are intelligent.' },
    { jp: '類人猿は知的には犬より上位である。', en: 'Apes rank above dogs in intelligence.' },
  ],
  '獄': [
    { jp: 'その法律には今後フットボールをしてはならず、そしてこの法律を破ったものはだれであれ投獄されると書かれていました。', en: 'It said that people could not play football in the future and that anyone who broke this law would be sent to prison.' },
    { jp: '最近は、ローン地獄で破産する人が増えている。', en: 'More and more people these days are getting overwhelmed by housing loans.' },
  ],
  '獣': [
    { jp: '兄は獣医なんです。', en: 'My brother is a vet.' },
    { jp: 'ジョンは獣医です。', en: 'John is a veterinarian.' },
  ],
  '獲': [
    { jp: 'ジャネットが一等を獲った。', en: 'It was Janet that won first prize.' },
    { jp: '猟犬は鋭い嗅覚で獲物を追う。', en: 'Hounds hunt by their keen scent.' },
  ],
  '玄': [
    { jp: '玄関に誰かいるよ。', en: 'There\'s someone at the door.' },
    { jp: 'だれか玄関にいる。', en: 'Someone is at the door.' },
  ],
  '率': [
    { jp: '失業率は高いです。', en: 'The unemployment level is high.' },
    { jp: '出席率はどうでした？', en: 'How was the attendance?' },
  ],
  '玲': [
    { jp: 'ですから、玲子。アンタは慌てることはありません。', en: 'And so, Reiko, it\'s nothing for you to panic about.' },
    { jp: '玲子のオススメという本を、その場で軽く流し読みしてみる。', en: 'I\'ll try giving the book "Reiko\'s Recommended" a quick skim read on the spot.' },
  ],
  '珠': [
    { jp: 'その真珠は本物？それとも偽物？', en: 'Are the pearls real or fake?' },
    { jp: '彼の歯は真珠のように白い。', en: 'His teeth are white like a pearl.' },
  ],
  '班': [
    { jp: '私の班はいつもにぎやかだ。', en: 'My group is always lively.' },
    { jp: 'ジャスティン班長、亜空間レーダーに反応出ました！', en: 'Squad Leader Justin, a blip\'s appeared on the hyperspace radar!' },
  ],
  '琢': [
    { jp: '彼の文章は細部まで入念に彫琢されている。', en: 'Every detail of his writing is carefully composed.' },
    { jp: '君の実力なら楽勝だとは思うが、それに驕らず、まずはクラスのみんなと切磋琢磨していって欲しい。', en: 'With your ability it should be a doddle, but please don\'t get too big for your boots: apply yourself diligently like everyone in your class.' },
  ],
  '琴': [
    { jp: '僕の祖父は琴を弾いていたよ。', en: 'My grandfather played the koto.' },
    { jp: 'お琴の魅力を分かってもらえて嬉しいです。ありがとう。', en: 'Thank you for understanding the beauty of the koto. I\'m very delighted.' },
  ],
  '瑞': [
    { jp: '瑞穂の国は日本の別称です。', en: 'Mizuho no kuni is another name for Japan.' },
    { jp: '彼女の瑞々しい笑顔が素敵だ。', en: 'Her fresh, dewy smile is lovely.' },
  ],
  '瑠': [
    { jp: '瑠璃鶇が空を背負っている。', en: 'The bluebird carries the sky on his back.' },
    { jp: '長く生きられることを願って娘を菜依瑠と名付けた。', en: 'I named my daughter Nairu wishing her long life.' },
  ],
  '璃': [
    { jp: '瑠璃鶇が空を背負っている。', en: 'The bluebird carries the sky on his back.' },
  
    { jp: '璃は日本語の語彙の中に含まれる漢字だ。', en: '璃 is a kanji found in the Japanese vocabulary.' },
  ],
  '環': [
    { jp: '彼の公式の肩書きは環境庁長官です。', en: 'His official title is Director-General of the Environment Agency.' },
    { jp: '彼は環境に順応した。', en: 'He adapted himself to circumstances.' },
  ],
  '甚': [
    { jp: 'その会社は甚大な被害を被った。', en: 'The company suffered big losses.' },
    { jp: 'フランス料理は私の甚だ好む所だ。', en: 'I like French food very much.' },
  ],
  '甲': [
    { jp: '亀の甲より年の功。', en: 'Experience without learning is better than learning without experience.' },
    { jp: '仕事が生き甲斐です。', en: 'My work is my passion.' },
  ],
  '畔': [
    { jp: '湖畔の古い教会はとても美しい。', en: 'The old church by the lake is very beautiful.' },
    { jp: '湖畔のペンションに３泊しました。', en: 'We stayed for 3 nights at a lakeside hotel.' },
  ],
  '異': [
    { jp: '西部戦線異状なし', en: 'All quiet on the Western Front.' },
    { jp: 'やっぱり異常だよ。', en: 'As expected it\'s unusual.' },
  ],
  '疎': [
    { jp: 'パソコンには疎くて。', en: 'I\'m computer illiterate.' },
    { jp: '去る者は日々に疎し。', en: 'Out of sight, out of mind.' },
  ],
  '疫': [
    { jp: '私は天然痘に免疫があります。', en: 'I\'m immune to smallpox.' },
    { jp: 'トムは免疫力が低下している。', en: 'Tom has a weakened immune system.' },
  ],
  '疾': [
    { jp: '彼女は慢性疾患で苦しんでいる。', en: 'She suffers from a chronic illness.' },
    { jp: '生化学的には、熱烈な恋愛と強迫神経症の疾患とは区別できないようだ。', en: 'It seems that it\'s impossible to distinguish an obsessional neurosis from an intense love from a biochemical perspective.' },
  ],
  '症': [
    { jp: 'よくある症状です。', en: 'It\'s a common symptom.' },
    { jp: '高所恐怖症なんだ。', en: 'I\'m afraid of heights.' },
  ],
  '痘': [
    { jp: '私は天然痘に免疫があります。', en: 'I\'m immune to smallpox.' },
  
    { jp: '痘は日本語の語彙の中に含まれる漢字だ。', en: '痘 is a kanji found in the Japanese vocabulary.' },
  ],
  '痢': [
    { jp: '昨日から下痢が続いているんです。', en: 'I\'ve had diarrhea since yesterday.' },
    { jp: '海外に行くと必ず、時差ぼけと下痢に悩まされる。', en: 'Whenever I go abroad, I suffer from jet lag and diarrhea.' },
  ],
  '痴': [
    { jp: '彼は本当に愚痴愚痴言う。', en: 'He is really a nitpicker.' },
    { jp: '母はほとんど愚痴を言わない。', en: 'My mother almost never complains.' },
  ],
  '癒': [
    { jp: '心の傷を癒すには時間がかかる。', en: 'Healing the wounds of the heart takes time.' },
    { jp: '時はすべての傷を癒してくれる。', en: 'Time heals all wounds.' },
  ],
  '癖': [
    { jp: 'トムはここ5年、嗜癖の臨床治療を続けています。', en: 'Tom has been in clinical treatment for addiction for the last five years.' },
    { jp: '彼の飲酒癖は今に始まったことではない。', en: 'His drinking habit is an old one.' },
  ],
  '皇': [
    { jp: '天皇誕生日が日曜日と重なった。', en: 'The Emperor\'s Birthday fell on Sunday.' },
    { jp: '1989年1月昭和天皇の没後、年号が「平成」と改まりました。', en: 'The emperor passed away in January of 1989. Therefore, the name of the era changed from Showa to Heisei.' },
  ],
  '盆': [
    { jp: 'お盆が近づいてきた。', en: 'The Bon Festival is near at hand.' },
    { jp: '日本のお盆は、メキシコの「死者の日」に似ています。', en: 'Japan\'s Obon is similar to Mexico\'s Day of the Dead.' },
  ],
  '益': [
    { jp: 'あなたの１年間のドイツ滞在はとても有益でしたね。', en: 'Your year-long stay in Germany was very beneficial, wasn\'t it?' },
    { jp: 'テレビは有害無益だと言う人もいる。', en: 'Some people insist that television does more harm than good.' },
  ],
  '盛': [
    { jp: '岩手県の県庁所在地は盛岡市です。', en: 'Iwate Prefecture\'s capital is Morioka City.' },
    { jp: 'トムは好奇心旺盛だ。', en: 'Tom is curious.' },
  ],
  '盟': [
    { jp: '両国は互いに同盟を結んでいた。', en: 'The two countries were leagued with each other.' },
    { jp: 'アルメニアは2003年にWTOに加盟した。', en: 'Armenia joined the World Trade Organization in 2003.' },
  ],
  '監': [
    { jp: '監督をしてました。', en: 'I was a coach.' },
    { jp: '会計監査があった。', en: 'The accounts have been audited.' },
  ],
  '盤': [
    { jp: '見て！空飛ぶ円盤よ！', en: 'Look! A flying saucer!' },
    { jp: '愛を基盤に生きている。', en: 'Love is the bedrock of my life.' },
  ],
  '盲': [
    { jp: 'ヘレン・ケラーは盲人で、聾唖者です。', en: 'Helen Keller was blind and deaf.' },
    { jp: '愛は盲目であるが、嫉妬は存在しないものまで見せることがある。', en: 'Love is blind, but jealousy can see even nonexistent things.' },
  ],
  '盾': [
    { jp: '彼は矛盾している。', en: 'He isn\'t consistent with himself.' },
    { jp: '彼は盾と剣を買った。', en: 'He bought a shield and a sword.' },
  ],
  '眉': [
    { jp: '笑いで誤魔化すと、亜美さんはさも不機嫌そうに眉を寄せた。', en: 'Ami frowned in a very un-amused way as I brushed her off with a laugh.' },
    { jp: 'やっぱり太めの凛々しい眉毛だね。', en: 'He really does have such thick, imposing eyebrows.' },
  ],
  '看': [
    { jp: '日本では看護婦の社会的地位は高いでしょうか。', en: 'In Japan, are nurses high on the social scale?' },
    { jp: '看板に書いてあります。', en: 'It says so on the sign.' },
  ],
  '眺': [
    { jp: 'トムは窓際に座り、外を眺めた。', en: 'Tom sat at the window, looking outside.' },
    { jp: '彼は座って窓の外を眺めていました。', en: 'He sat looking out of the window.' },
  ],
  '眼': [
    { jp: '老眼鏡どこだっけ？', en: 'Where are my reading glasses?' },
    { jp: '私の眼鏡に何したの？', en: 'What\'ve you done with my glasses?' },
  ],
  '睡': [
    { jp: '睡眠が一番の薬だよ。', en: 'Sleep is the best medicine.' },
    { jp: '睡眠不足が響いてきた。', en: 'Lack of sleep began to tell on me.' },
  ],
  '督': [
    { jp: '天国にいらつしやる基督様。どうか私を御守り下さいまし。', en: 'Lord Jesus Christ in heaven, please protect me.' },
    { jp: '監督をしてました。', en: 'I was a coach.' },
  ],
  '睦': [
    { jp: '我々は親睦を深めた。', en: 'We deepened our friendship.' },
    { jp: 'トムとメアリーは仲睦まじく暮らしている。', en: 'Tom and Mary live a harmonious life together.' },
  ],
  '瞬': [
    { jp: '夜空には無数の星が瞬いていた。', en: 'Countless stars twinkled in the night sky.' },
    { jp: 'その瞬間、大音響とともに爆発した。', en: 'At that instant it exploded with a great noise.' },
  ],
  '瞭': [
    { jp: '結果は一目瞭然であった。', en: 'The result was clear at a glance.' },
    { jp: 'トムが嘘をついていたのは一目瞭然だった。', en: 'It was obvious Tom had lied.' },
  ],
  '瞳': [
    { jp: '彼女の瞳は綺麗ですね。', en: 'Her eyes are beautiful.' },
    { jp: '瞳を閉じて聴いてください。', en: 'Please close your eyes and listen.' },
  ],
  '矛': [
    { jp: '彼は矛盾している。', en: 'He isn\'t consistent with himself.' },
    { jp: 'それは矛盾だらけだ。', en: 'It\'s a bundle of contradictions.' },
  ],
  '矢': [
    { jp: '矢は的に当たった。', en: 'The arrow hit the target.' },
    { jp: '私は矢を的に当てた。', en: 'I hit the mark with the arrow.' },
  ],
  '矯': [
    { jp: '娘は歯を矯正中です。', en: 'My daughter has braces.' },
    { jp: '歯の矯正をしたいんです。', en: 'I would like to have my teeth straightened.' },
  ],
  '砕': [
    { jp: '一か八か、当たって砕けろだ。', en: 'Let\'s take a chance and go for broke.' },
    { jp: '「当たって砕けよ」が俺の持ち味だからね。', en: 'My strong point is my philosophy - nothing ventured nothing gained.' },
  ],
  '砲': [
    { jp: '警察は空砲を撃った。', en: 'The police officer fired a blank.' },
    { jp: 'あいつは無鉄砲な男だ。', en: 'He is a daredevil.' },
  ],
  '硝': [
    { jp: '玄関の大きい硝子戸は自働ベルの音を高く植込みのあたりに響かせながらあいた。', en: 'When the large glass door opened, an automatic bell sound rang loudly around the vegetation.' },
  
    { jp: '硝は日本語の語彙の中に含まれる漢字だ。', en: '硝 is a kanji found in the Japanese vocabulary.' },
  ],
  '硫': [
    { jp: '硫黄は青い炎を上げて燃える。', en: 'Sulfur burns with a blue flame.' },
    { jp: '硫黄はマッチを作るのに使われる。', en: 'Sulfur is used to make matches.' },
  ],
  '碁': [
    { jp: '気晴らしと言えば碁を打つことぐらいだ。', en: 'Go is my only distraction.' },
  
    { jp: '碁は日本語の語彙の中に含まれる漢字だ。', en: '碁 is a kanji found in the Japanese vocabulary.' },
  ],
  '碑': [
    { jp: '記念碑が公園に建てられた。', en: 'The monument was set up in the park.' },
    { jp: 'この記念碑は１９８５年の２月に建てられた。', en: 'This monument was erected in February, 1985.' },
  ],
  '碧': [
    { jp: '紺碧の夜空に星がキラキラと瞬いていた。', en: 'The night sky was dark blue, and the stars were twinkling.' },
  
    { jp: '碧は日本語の語彙の中に含まれる漢字だ。', en: '碧 is a kanji found in the Japanese vocabulary.' },
  ],
  '磁': [
    { jp: 'これはU字形磁石です。', en: 'This is a horseshoe magnet.' },
    { jp: '地球は大きな磁石のようなものです。', en: 'Earth is like a big magnet.' },
  ],
  '礎': [
    { jp: '基礎体温はつけてますよ。', en: 'I\'m keeping a record of basal body temperature.' },
    { jp: '基礎からしっかり学ぼう。', en: 'Let\'s study thoroughly from the basics.' },
  ],
  '祉': [
    { jp: '彼は福祉事務所で働いている。', en: 'He works at the welfare office.' },
    { jp: '彼女は社会福祉に携わっている。', en: 'She is engaged in social work.' },
  ],
  '祥': [
    { jp: '絵文字は日本が発祥です。', en: 'Emojis originated in Japan.' },
    { jp: 'その不祥事は出世の妨げとなった。', en: 'The scandal was an obstacle to his promotion.' },
  ],
  '票': [
    { jp: '受験票来たがまだ行くかは未定。全然勉強してない。', en: 'I\'ve received the admission ticket for the exam, but I haven\'t decided yet if I will go. I haven\'t studied at all.' },
    { jp: '俺に投票してくれ！', en: 'Vote for me!' },
  ],
  '禄': [
    { jp: '君は課長としての貫禄がないね。', en: 'You don\'t have proper dignity as chief of the section.' },
    { jp: 'ボスの貫禄だよね。', en: 'He has a boss-like presence.' },
  ],
  '禅': [
    { jp: '仏心宗と呼ばれるのは、禅宗が文字や経典をたよらずに、仏の心を師匠から弟子へと直接伝えていくことを根本宗旨としているからです。', en: 'Zen Buddhism is also called "Buddha\'s mind school" because of its basic tenet of transmitting the mind of Buddha directly from teacher to student without relying on writings or sutras.' },
    { jp: '禅僧は新宿駅のあたりで托鉢しています。', en: 'Zen priests beg for alms near Shinjuku station.' },
  ],
  '禍': [
    { jp: '政治家たちは「口は禍のもと」という言葉を知らないのだろうか。', en: 'Politicians seem to not know the phrase "Words are the cause of disaster."' },
  
    { jp: '禍は日本語の語彙の中に含まれる漢字だ。', en: '禍 is a kanji found in the Japanese vocabulary.' },
  ],
  '禎': [
    { jp: '禎子はこれまで６４４羽の鶴を折った。', en: 'Sadako has folded 644 paper cranes so far.' },
    { jp: '禎子は、それを忘れてしまいたかった。', en: 'Sadako wanted to forget about it.' },
  ],
  '秀': [
    { jp: '２、３の小さな誤りを別にすれば、君の作文は優秀だった。', en: 'Apart from a few minor mistakes, your composition was excellent.' },
    { jp: '彼女は優秀な学生だ。', en: 'She is an excellent student.' },
  ],
  '秘': [
    { jp: '彼は今にも秘密を暴露しようとしていたのだが、マーサが鋭い眼光を向けて黙らせた。', en: 'He was on the verge of revealing the secret when a sharp look from Martha shut him up.' },
    { jp: 'トムは極度の秘密主義者だ。', en: 'Tom is extremely secretive.' },
  ],
  '秩': [
    { jp: '彼の完ぺきに秩序正しい人生は麻薬中毒の兄弟が現れた時に崩壊した。', en: 'His flawlessly ordered life collapsed when his drug-addict brothers appeared.' },
    { jp: '社会の秩序は自然から生じたものではない。社会の秩序は慣習の上に基礎付けられている。', en: 'Social order does not come from nature. It is founded on customs.' },
  ],
  '称': [
    { jp: 'ＵＳＡはアメリカ合衆国の略称です。', en: 'USA stands for the United States of America.' },
    { jp: '彼は多くの称賛を得た。', en: 'He received a lot of praise.' },
  ],
  '稀': [
    { jp: '津波はごく稀にしか発生しない。', en: 'Tsunamis are very rare.' },
    { jp: '彼が本を読むことがあっても、ごく稀なことだ。', en: 'He seldom, if ever, reads a book.' },
  ],
  '稔': [
    { jp: '田中稔子氏は広島原爆の生存者であり、平和と核軍縮の擁護者として活動しています。', en: 'Toshiko Tanaka is a survivor of the Hiroshima bombing turned advocate for peace and nuclear disarmament.' },
    { jp: '努力が実を結んで稔りました。', en: 'Our efforts bore fruit.' },
  ],
  '稚': [
    { jp: '彼は幼稚園に通っている。', en: 'He goes to kindergarten.' },
    { jp: 'この言葉って、幼稚すぎるかな？', en: 'Is this word too childish?' },
  ],
  '稲': [
    { jp: '空に稲妻が走った。', en: 'Lightning flashed in the sky.' },
    { jp: '遠くに稲光が見えた。', en: 'I saw flashes of lightning in the distance.' },
  ],
  '稼': [
    { jp: '彼はおおいに稼ぐ。', en: 'He earns a great deal.' },
    { jp: 'やつは俺の３倍稼ぐ。', en: 'He earns three times more than I do.' },
  ],
  '稿': [
    { jp: '学術誌へ投稿中の論文を記入する場合は、掲載が決定しているものに限ります。', en: 'If you want to include papers that have been submitted to academic journals, you are limited to those that have been accepted for publication.' },
    { jp: '私は演説の草稿を作った。', en: 'I made a draft of my speech.' },
  ],
  '穀': [
    { jp: '米酢と穀物酢の使い分けをあまり気にしてなかった。', en: 'I didn\'t really pay attention to the difference between rice and grain vinegar.' },
    { jp: '竜也氏は穀類を商っている。', en: 'Mr Tatuya deals in grain.' },
  ],
  '穂': [
    { jp: '話の接ぎ穂がなくて困った。', en: 'He found it very hard to keep the conversation going.' },
    { jp: '実るほど頭を垂れる稲穂かな。', en: 'The boughs that bear most hang lowest.' },
  ],
  '穏': [
    { jp: '海は穏やかだった。', en: 'The sea was calm.' },
    { jp: '彼はとても穏やかだよ。', en: 'He\'s very calm.' },
  ],
  '穣': [
    { jp: '絵文字は、１９９９年に日本の芸術家である栗田穣崇さんによって紹介されたのが始まりです。', en: 'Emojis were first introduced in 1999 by Japanese artist Shigetaka Kurita.' },
  
    { jp: '穣は日本語の語彙の中に含まれる漢字だ。', en: '穣 is a kanji found in the Japanese vocabulary.' },
  ],
  '穫': [
    { jp: '普通、我が家では収穫感謝祭の時に七面鳥を食べます。', en: 'Our family usually has turkey for Thanksgiving.' },
    { jp: '明日はブドウを収穫するんだ。', en: 'Tomorrow I\'ll harvest grapes.' },
  ],
  '穴': [
    { jp: '心に穴が空いた、そんな気分なの。', en: 'I feel empty inside.' },
    { jp: 'おまえの目は節穴か？', en: 'What are you eyeing?' },
  ],
  '窃': [
    { jp: '彼には窃盗の罪がある。', en: 'He is guilty of theft.' },
    { jp: '彼は窃盗罪で起訴された。', en: 'He was accused of theft.' },
  ],
  '窒': [
    { jp: 'もちを食べている時にのどに詰まらせて窒息死する老人がたくさんいる。', en: 'Many old people choke to death while eating mochi.' },
    { jp: '彼は煙に巻かれて窒息した。', en: 'He suffocated, smothered in smoke.' },
  ],
  '窮': [
    { jp: '私は言葉に窮した。', en: 'I didn\'t know how to express myself.' },
    { jp: '私は返答に窮した。', en: 'I was at a loss for an answer.' },
  ],
  '竜': [
    { jp: '竜は架空の動物だ。', en: 'A dragon is a creature of fancy.' },
    { jp: '竜巻が近づいています。', en: 'A tornado is approaching.' },
  ],
  '端': [
    { jp: '冬支度は万端です！', en: 'Winter preparations are all complete.' },
    { jp: '端っこに立ってろ！', en: 'Stand in the corner!' },
  ],
  '笛': [
    { jp: '口笛の吹き方、知ってる？', en: 'Do you know how to whistle?' },
    { jp: '笛の音が聞こえます。', en: 'I can hear the sound of a flute.' },
  ],
  '第': [
    { jp: '見つけ次第殺すぞ！', en: 'Once I find them, I\'ll kill them!' },
  
    { jp: '第は日本語の語彙の中に含まれる漢字だ。', en: '第 is a kanji found in the Japanese vocabulary.' },
  ],
  '筋': [
    { jp: '心臓は筋肉でできている。', en: 'The heart is made of muscle.' },
    { jp: '水泳は筋肉を発達させる。', en: 'Swimming develops our muscles.' },
  ],
  '策': [
    { jp: '何か秘策があるの？', en: 'Is there some secret plan?' },
    { jp: '何か解決策はあるの？', en: 'Are there any solutions?' },
  ],
  '箇': [
    { jp: 'この箇所が一番深いです。', en: 'This part is the deepest.' },
    { jp: 'この湖はこの箇所が一番深い。', en: 'The lake is deepest at this point.' },
  ],
  '節': [
    { jp: 'スキーの季節です。', en: 'It\'s the ski season.' },
    { jp: 'イチゴの季節です。', en: 'It\'s strawberry season.' },
  ],
  '範': [
    { jp: 'トムは模範囚だった。', en: 'Tom was a model inmate.' },
    { jp: '今回テスト範囲広くない？', en: 'Isn\'t the scope of the test pretty broad this time?' },
  ],
  '篤': [
    { jp: '彼は危篤状態だった。', en: 'He was in critical condition.' },
    { jp: '看護婦は、患者が危篤状態なので、病室に入らないようにと私たちに言った。', en: 'The nurse told us not to enter the room because the patient was in a critical condition.' },
  ],
  '簿': [
    { jp: '名簿に私も加えといて。', en: 'Add my name to the list.' },
    { jp: '通信簿はもらってきたの？', en: 'Did you get your report card?' },
  ],
  '粋': [
    { jp: '今日の純粋数学は明日の応用数学。', en: 'Today\'s pure mathematics is tomorrow\'s applied mathematics.' },
    { jp: '子供って、ホント純粋でかわいいね。', en: 'Children are so innocent and adorable, aren\'t they?' },
  ],
  '粗': [
    { jp: '食べ物を粗末にするな！', en: 'Don\'t waste food!' },
    { jp: '道具を粗末に使うな。', en: 'Don\'t handle these tools roughly.' },
  ],
  '粘': [
    { jp: '煉瓦の大部分は粘土からなっている。', en: 'Bricks consist mostly of clay.' },
    { jp: 'ストレスが胃の粘膜を荒らす原因のひとつは次のように考えられています。', en: 'The following is thought to be one of the reasons stress damages the stomach\'s mucous membrane.' },
  ],
  '粛': [
    { jp: 'みなさん、どうか静粛に。', en: 'Order, please.' },
    { jp: '彼らは教会内での厳粛な儀式を畏敬の念をもって見守った。', en: 'They watched the solemn ceremony in the church with awe.' },
  ],
  '糖': [
    { jp: '砂糖ってまだある？', en: 'Is there still any sugar?' },
    { jp: '砂糖は入れないの？', en: 'No sugar for you?' },
  ],
  '糧': [
    { jp: '食糧が不足している。', en: 'Food has been in short supply.' },
    { jp: '食糧は備蓄しておきましたか？', en: 'Have you made provisions?' },
  ],
  '系': [
    { jp: '老いも若きも、共和党員も民主党員も、黒人も白人もラテン系もアジア系もネイティブアメリカンも、同性愛者もそうでない人も、健常者も障害者も、すべてが出した答えだ。', en: 'It\'s the answer that young people and old people, Republicans and Democrats, black people and white people, Latinos, Asians, and Native Americans, homosexuals and non-homosexuals, healthy and disabled people have given.' },
    { jp: 'ユダヤ系アメリカ人です。', en: 'He\'s a Jewish American.' },
  ],
  '糾': [
    { jp: '社会の悪弊を糾すべきだ。', en: 'We must investigate social abuses.' },
  
    { jp: '糾は日本語の語彙の中に含まれる漢字だ。', en: '糾 is a kanji found in the Japanese vocabulary.' },
  ],
  '紀': [
    { jp: '３世紀前においてさえも、ほとんどの西ヨーロッパ人はまだ指を使っていた。', en: 'Even three centuries ago, most Western Europeans still used their fingers.' },
    { jp: '１世紀は１００年です。', en: 'A century is one hundred years.' },
  ],
  '紋': [
    { jp: '警察はバンの指紋を採取した。', en: 'The police dusted the van for fingerprints.' },
    { jp: '波紋を広げるようなことを安易に口走らないの！', en: 'I\'m not going to carelessly blurt out something that would cause trouble!' },
  ],
  '納': [
    { jp: '仏政府は国家予算の帳尻を合わせるよう納税者に挑むオンラインゲームを売り出した。', en: 'The French government has launched an online game that challenges taxpayers to balance the national budget.' },
    { jp: '今日は仕事納めだ。', en: 'Today is the last day of work.' },
  ],
  '紗': [
    { jp: 'あの赤い布は「袱紗」茶道具を清めるために使う必需品なの。', en: 'That red cloth is a "fukusa"; it is a vital tool used to cleanse the tea equipment.' },
    { jp: '紗美は、何も知らなかった。', en: 'Sami knew nothing.' },
  ],
  '級': [
    { jp: '彼は私の級友です。', en: 'He is my classmate.' },
    { jp: '一級品の品質ですね。', en: 'It\'s first-class quality.' },
  ],
  '紛': [
    { jp: '１９９０年代は湾岸紛争で始まった。', en: 'The 1990s began with the Gulf incident.' },
    { jp: '国際紛争解決のために武力に訴えてはならない。', en: 'We should not resort to arms to settle international disputes.' },
  ],
  '素': [
    { jp: '2539は素数です。', en: '2539 is a prime number.' },
  
    { jp: '素は日本語の語彙の中に含まれる漢字だ。', en: '素 is a kanji found in the Japanese vocabulary.' },
  ],
  '紡': [
    { jp: 'おばあちゃんのやり方を見ながら、羊毛の紡ぎ方を覚えました。', en: 'I learned how to spin wool from watching my grandmother.' },
  
    { jp: '紡は日本語の語彙の中に含まれる漢字だ。', en: '紡 is a kanji found in the Japanese vocabulary.' },
  ],
  '索': [
    { jp: 'インターネットで、「～の歴史」を検索してみると、「世界の歴史」「野球の歴史」といったようなサイトがヒットする。', en: 'If you search for "History of..." on the internet, you\'ll get hits for sites like "History of the World" and "History of Baseball."' },
    { jp: 'ネットで検索して。', en: 'Look for it online.' },
  ],
  '紫': [
    { jp: '紫芋を食べたいよ。', en: 'I want to eat purple potatoes.' },
    { jp: '青というより、紫ね。', en: 'It\'s more purple than blue.' },
  ],
  '累': [
    { jp: '彼はその後、累進して社長にまで進んだ。', en: 'Thereafter, he was gradually promoted until he became company president.' },
    { jp: '回収対象のソニー製充電池は累計で７６５万９０００個となった。', en: 'The amount of Sony rechargeable batteries supposed to be collected totalled 7,659,000 units.' },
  ],
  '紳': [
    { jp: '彼は完壁な紳士だ。', en: 'He is every inch a gentleman.' },
    { jp: '彼は本当の紳士だ。', en: 'He is a real gentleman.' },
  ],
  '紺': [
    { jp: 'ニューヨーク市の警官は濃紺の制服を着ている。', en: 'New York City policemen wear dark blue uniforms.' },
    { jp: 'メアリーは、濃紺のスカートを身に着けていました。', en: 'Mary was wearing a navy blue skirt.' },
  ],
  '結': [
    { jp: '今年の初詣は出雲大社に行って、縁結びの神様に素敵な出会いをお願いしてきました。', en: 'I went to Izumo-taisha for my New Year\'s shrine visit and asked the god of marriage to arrange that I meet my special someone.' },
    { jp: '結婚生活がうまく行っていない方は結婚式の時におごそかに神の前に誓った、夫婦の誓約を思い出してみましょう。', en: 'And to the people whose married life is not going well, let\'s remember the marriage covenant sworn solemnly before God at the wedding ceremony.' },
  ],
  '絞': [
    { jp: '死体解剖の結果、絞殺と判明しました。', en: 'The postmortem showed that she had been strangled.' },
    { jp: 'タオルを絞ってよ。', en: 'Squeeze the towel.' },
  ],
  '統': [
    { jp: 'これは家族の伝統です。', en: 'This is a family tradition.' },
    { jp: '王が国を統治している。', en: 'The king rules over the country.' },
  ],
  '絹': [
    { jp: '絹は高価なんだよ。', en: 'Silk is expensive.' },
    { jp: 'これは本物の絹ですか？', en: 'Is this real silk?' },
  ],
  '継': [
    { jp: 'これは生中継です。', en: 'This is a live broadcast.' },
    { jp: 'こちらは、継母です。', en: 'This is my stepmother.' },
  ],
  '維': [
    { jp: '維持費もバカにならない。', en: 'The upkeep alone is no small cost.' },
    { jp: 'この車の維持は高くつく。', en: 'It is expensive running this car.' },
  ],
  '綱': [
    { jp: 'あの人によって、大統領が戯画化され、政権の権威と綱紀が乱されてはなるまい。', en: 'According to him, the president must not be turned into a caricature, the loss of authority and public order cannot be borne.' },
    { jp: '「委員長、後は何を運ぶんだっけ？」「得点板と大玉もう一個、綱引きの綱」', en: '"Mr Chairman, what needs moving next, again?" "Scoreboard, giant ball and the tug-of-war rope."' },
  ],
  '網': [
    { jp: '鯉は網で捕まえたんだ。', en: 'I caught a carp in a net.' },
    { jp: '網にウナギがかかったよ。', en: 'I caught an eel in my net.' },
  ],
  '綺': [
    { jp: '綺麗な朝日だこと！', en: 'What a beautiful sunrise!' },
    { jp: '綺麗事は抜きにして、正直に言いなさいよ。', en: 'Enough with the empty words. Speak straight with me.' },
  ],
  '綾': [
    { jp: 'それは言葉の綾にすぎない。', en: 'That\'s nothing but a figure of speech.' },
    { jp: '綾子さんの日記をまた読むのを楽しみにしている。', en: 'I\'m looking forward to reading Ayako\'s diary again.' },
  ],
  '緊': [
    { jp: '緊急の場合は、110番通報してください。', en: 'In case of an emergency, dial 110.' },
    { jp: 'すんごい緊張した。', en: 'I was really nervous.' },
  ],
  '締': [
    { jp: '締切りは月曜日です。', en: 'The deadline is Monday.' },
    { jp: '締め切りはいつですか？', en: 'When is the deadline?' },
  ],
  '緩': [
    { jp: 'このボタンは緩い。', en: 'This button is loose.' },
    { jp: 'この靴は少し緩い。', en: 'These shoes are a little loose.' },
  ],
  '緯': [
    { jp: 'タスマニアは南緯４０度のところにあります。', en: 'Tasmania is on the 40 degrees South latitude.' },
    { jp: '事の経緯はこうです。', en: 'This is how it happened.' },
  ],
  '縁': [
    { jp: '押し付けた縁は続かぬ。', en: 'Love cannot be compelled.' },
    { jp: '７は縁起のいい番号だ。', en: 'Seven is a lucky number.' },
  ],
  '縄': [
    { jp: '沖縄県民斯く戦えり。', en: 'Thus fought the Okinawan people.' },
    { jp: '沖縄の最低賃金は642円です。', en: 'The minimum wage in Okinawa is 642 yen per hour.' },
  ],
  '縛': [
    { jp: '束縛されず、自由奔放に生きるのが好き。', en: 'I like to live a free life, unrestrained by things around me.' },
    { jp: '手は縛られている。', en: 'Their hands are tied.' },
  ],
  '縦': [
    { jp: '縦長の箱ってこれですか？', en: 'Is it this oblong box?' },
    { jp: '縦列駐車が苦手なのよ。', en: 'I\'m not good at parallel parking.' },
  ],
  '縫': [
    { jp: 'これ手で縫ったの？', en: 'Did you sew this by hand?' },
    { jp: '彼女は裁縫が上手です。', en: 'She can sew very well.' },
  ],
  '縮': [
    { jp: '寿命が縮んだかと思ったよ。', en: 'I felt as if my life had been shortened.' },
    { jp: '瞳は、太陽の光で縮瞳します。', en: 'The pupils of the eyes contract in sunlight.' },
  ],
  '繁': [
    { jp: '２、３ヶ月後、彼らは北極にある繁殖地へと戻っていきます。', en: 'A few months later they return to their breeding grounds in the Arctic.' },
    { jp: 'うさぎは繁殖が早い。', en: 'Rabbits breed quickly.' },
  ],
  '繊': [
    { jp: '非常に繊細な問題だ。', en: 'It\'s a very delicate question.' },
    { jp: 'これは優れた繊維源である。', en: 'This is an excellent source of fibre.' },
  ],
  '織': [
    { jp: 'トムはこの組織の一員です。', en: 'Tom is a member of this organization.' },
    { jp: 'この組織に入ったのは何のためだ？', en: 'Why did you join this organization?' },
  ],
  '繕': [
    { jp: '近隣の家は壊れたが、自宅は少しの修繕費ですんだ。', en: 'The neighbouring house was destroyed, but mine survived just a bit of cost for repair.' },
    { jp: '貴方の靴は修繕が必要だ。', en: 'Your shoes want mending.' },
  ],
  '繰': [
    { jp: '歴史を無視する人はとかくあやまちを繰り返しがちだ。', en: 'People who ignore history tend to repeat it.' },
    { jp: '恐れ入りますが，もう一度繰り返してください。', en: 'I am very sorry, but would you repeat it once more?' },
  ],
  '罰': [
    { jp: '公務員が秘密を漏らして、秘密漏洩罪として罰せられた。', en: 'The public servant leaked the secret and he was prosecuted for revealing a state secret.' },
    { jp: '国によっては、国家反逆罪の刑罰が終身刑ということもあり得る。', en: 'In some countries, the punishment for treason can be life in prison.' },
  ],
  '罷': [
    { jp: 'エリザベス２世が身罷ったため、妻がとめどなく涙を流している。', en: 'My wife is crying a river of tears because Queen Elizabeth II has passed away.' },
  
    { jp: '罷は日本語の語彙の中に含まれる漢字だ。', en: '罷 is a kanji found in the Japanese vocabulary.' },
  ],
  '羅': [
    { jp: 'すべてを網羅した教科書など存在しない。', en: 'There is no such a thing as a comprehensive textbook.' },
    { jp: '微生物学の基本から最新の情報までを網羅する。', en: 'It covers everything from the fundamentals of microbiology to the latest news.' },
  ],
  '羊': [
    { jp: 'サミは山羊座です。', en: 'Sami is Capricorn.' },
    { jp: 'トムは山羊座だよ。', en: 'Tom is a Capricorn.' },
  ],
  '義': [
    { jp: '完璧主義者ですか？', en: 'Are you a perfectionist?' },
    { jp: '彼は完璧主義者だ。', en: 'He is a person who never cuts corners.' },
  ],
  '翔': [
    { jp: '翔太は彼女に会うのが恥ずかしいと言いました。', en: 'Shota said that he was shy about seeing her.' },
    { jp: 'おめーが大翔か？今までずいぶんとでかい顔してくれたなあ？', en: 'You\'re Daisho? Up till now you\'ve really lorded it over us haven\'t you?' },
  ],
  '翠': [
    { jp: '両親は赤ん坊を翠と名づけた。', en: 'The parents named their baby Akira.' },
  
    { jp: '翠は日本語の語彙の中に含まれる漢字だ。', en: '翠 is a kanji found in the Japanese vocabulary.' },
  ],
  '翻': [
    { jp: '人気作家の翻案によって、古典に新たな命が吹き込まれた。', en: 'This adaptation by a popular writer has given a new life to this classic.' },
    { jp: 'これをフランス語に翻訳する意味ってあるのかしら？', en: 'I wonder if there is any reason to translate this into French.' },
  ],
  '翼': [
    { jp: '鳥が翼をはばたかせた。', en: 'The bird flapped its wings.' },
    { jp: 'その鳥の翼は折れていた。', en: 'The bird\'s wing was broken.' },
  ],
  '耐': [
    { jp: 'ビオラは耐寒性植物だよ。', en: 'The viola is a cold-resistant plant.' },
    { jp: '忍耐の限界もある。', en: 'I\'m running out of patience.' },
  ],
  '耗': [
    { jp: 'プリンターは、消耗品ですか？', en: 'Are printers a non-durable good?' },
    { jp: '簡単そうに見えるけど、結構体力消耗するなぁ。', en: 'It looks easy, but it\'s pretty exhausting.' },
  ],
  '聖': [
    { jp: '神聖ローマ帝国は１８０６年に終わりを告げた。', en: 'The Holy Roman Empire came to an end in the year 1806.' },
    { jp: '教会は神聖な場です。', en: 'Church is a sacred place.' },
  ],
  '聡': [
    { jp: 'トムの母親は聡明な女性でした。', en: 'Tom\'s mother was a wise woman.' },
    { jp: '兄に比べれば、彼はそれほど聡明ではない。', en: 'Compared with his brother, he is not so intelligent.' },
  ],
  '聴': [
    { jp: 'どんな曲を聴くの？', en: 'What kind of music do you listen to?' },
    { jp: '音楽が聴きたいの？', en: 'Do you want to listen to some music?' },
  ],
  '肖': [
    { jp: 'その肖像画は実物そっくりだ。', en: 'The portrait looks exactly like the real thing.' },
    { jp: '壁には肖像画が飾ってあった。', en: 'A portrait was hung on the wall.' },
  ],
  '肝': [
    { jp: '落ち着きが肝心です。', en: 'We must keep calm.' },
    { jp: 'ワインは、肝臓に悪い。', en: 'Wine is bad for your liver.' },
  ],
  '肢': [
    { jp: '選択肢は他にない。', en: 'This is the only alternative.' },
    { jp: '僕らには選択肢がない。', en: 'We don\'t have a choice.' },
  ],
  '肥': [
    { jp: 'トムは舌が肥えている。', en: 'Tom is particular about what he eats.' },
    { jp: '彼らの畜牛はみなよく肥えている。', en: 'Their cattle are all fat.' },
  ],
  '肪': [
    { jp: 'トムの体脂肪率は7%だ。', en: 'Tom has 7% body fat.' },
    { jp: 'クリームは、脂肪とたんぱく質が濃縮した濃厚で、白色や薄黄色の液体。', en: 'Cream is a white and light yellow liquid composed of concentrated proteins and fat.' },
  ],
  '肺': [
    { jp: '心肺蘇生法を試みる。', en: 'I\'m going to attempt CPR.' },
    { jp: '彼は肺がんで死んだ。', en: 'He died of lung cancer.' },
  ],
  '胆': [
    { jp: 'トムは大胆不敵でした。', en: 'Tom was fearless.' },
    { jp: '落胆のため息をついた。', en: 'I let out a disappointed sigh.' },
  ],
  '胎': [
    { jp: '僕は、僕の母の胎内にいるとき、お臍の穴から、僕の生れる家の中を、覗いてみて、 「こいつは、いけねえ」 　と、思った。', en: 'When I was inside my mother\'s womb, I looked through my mother\'s navel at the house where I would be born and I thought: "No way I\'m going there".' },
  
    { jp: '受胎という表現を日常会話で使うことがある。', en: 'The expression 受胎 is sometimes used in daily conversation.' },
  ],
  '胞': [
    { jp: '時々、皆さんは単細胞だ。', en: 'Sometimes, everyone is simple minded.' },
    { jp: '人体は無数の細胞からなっている。', en: 'A human body consists of a countless number of cells.' },
  ],
  '胡': [
    { jp: '塩胡椒で味を調えます。', en: 'Add salt and pepper to taste.' },
    { jp: 'もう少し胡椒を入れて。', en: 'Add a little more pepper.' },
  ],
  '胴': [
    { jp: 'ダックスフントは、非常に長い胴と短い足をしたドイツ犬である。', en: 'A dachshund is a dog from Germany with a very long body and short legs.' },
    { jp: '頭と胴体の間に首がある。', en: 'Between the head and the torso is the neck.' },
  ],
  '脅': [
    { jp: '市長の家族は一日中脅迫電話に悩まされた。', en: 'The mayor\'s family was harassed with threatening phone calls all day.' },
    { jp: 'トムを脅かしたいんだよ。', en: 'I want to surprise Tom.' },
  ],
  '脈': [
    { jp: 'その文脈は重要だ。', en: 'The context is crucial.' },
    { jp: '脈拍が少し速いね。', en: 'Your pulse is a little fast.' },
  ],
  '脚': [
    { jp: '彼は脚本を書いている。', en: 'He writes scripts.' },
    { jp: '脚本を書いていて、行き詰まった時はどうする？', en: 'What do you do when you get writer\'s block while writing a script?' },
  ],
  '脱': [
    { jp: '「うっかり観覧車の中で脱糞してしまったわい」「もう，おじいちゃんったら」', en: '"I carelessly soiled myself on the Ferris wheel." "You\'re already an old man."' },
  
    { jp: '脱は日本語の語彙の中に含まれる漢字だ。', en: '脱 is a kanji found in the Japanese vocabulary.' },
  ],
  '腐': [
    { jp: '豆腐は酒とよく合う。', en: 'Tofu goes well with good sake.' },
    { jp: '帰る途中でお豆腐買ってきてよ。', en: 'Buy some tofu on your way home.' },
  ],
  '腸': [
    { jp: 'トムは胃腸が弱い。', en: 'Tom has a weak stomach.' },
    { jp: '盲腸のようですね。', en: 'I believe you have appendicitis.' },
  ],
  '膜': [
    { jp: '結膜炎のせいで目が痒い。', en: 'My eyes are itching because of conjunctivitis.' },
    { jp: 'よく結膜炎を起こします。', en: 'I often get conjunctivitis.' },
  ],
  '膨': [
    { jp: 'このケーキを作るためには膨らし粉と無塩バターが必要だ。', en: 'In order to make this cake you need baking powder and unsalted butter.' },
    { jp: '水は熱で膨張する。', en: 'Water expands with heat.' },
  ],
  '臨': [
    { jp: '臨機応変にやろうよ。', en: 'Let\'s play it by ear.' },
    { jp: '彼は臨機応変の処置を取った。', en: 'He took the proper steps to meet the situation.' },
  ],
  '至': [
    { jp: '彼は至る所で歓迎された。', en: 'He was welcomed everywhere.' },
    { jp: 'ローマは至る所に遺跡がある。', en: 'Rome abounds with relics.' },
  ],
  '致': [
    { jp: '今日のトピックは「北朝鮮による日本人拉致問題」です。', en: 'Today\'s topic is "the problem of Japanese people abducted by North Korea".' },
    { jp: '北朝鮮が６か国協議の合意に基づき核開発計画を申告した２６日、米国が「テロ支援国」の指定解除手続きに入ったことで、拉致被害者の家族らには「拉致問題が置き去りにされるのでは」という不安が広がった。', en: 'With North Korea\'s announcement on the 26th of its nuclear development plan based upon the agreement stemming from the Six Party Talks, and the United States\' commencement of procedures to remove North Korea from its designation on the list of State Sponsors of Terrorism, the families of abductees have expressed growing unease that it may constitute an abandonment of the abductee issue.' },
  ],
  '興': [
    { jp: 'お花に興味あるの？', en: 'Are you interested in flowers?' },
    { jp: '星占いに興味ある？', en: 'Are you interested in astrology?' },
  ],
  '舌': [
    { jp: 'その国の美しさは筆舌に尽くし難い。', en: 'The beauty of that country is beyond description.' },
    { jp: 'ここの人たちは舌が肥えていますから、安くてもまずい店はすぐにつぶれてしまうんですよ。', en: 'The people here are particular about what they eat, so even if a restaurant is inexpensive, it\'ll soon go out of business if the food doesn\'t taste good.' },
  ],
  '舎': [
    { jp: '田舎に住みたいな。', en: 'I want to live in rural areas.' },
    { jp: '僕は田舎で育った。', en: 'I grew up in the country.' },
  ],
  '舗': [
    { jp: 'この道路は未舗装で凸凹している。', en: 'This road is unpaved and uneven.' },
    { jp: 'トムは老舗旅館の跡取り息子だよ。', en: 'Tom is the son and heir to the traditional Japanese inn.' },
  ],
  '艇': [
    { jp: 'ボーイング社は海上自衛隊用の飛行艇を開発しました。', en: 'Boeing developed a flying boat for the Maritime Self-Defense Force.' },
  
    { jp: '艇は日本語の語彙の中に含まれる漢字だ。', en: '艇 is a kanji found in the Japanese vocabulary.' },
  ],
  '艦': [
    { jp: '敵の旗艦を撃破しました！', en: 'We\'ve destroyed the enemy flagship!' },
    { jp: 'ロシアの軍艦よ、くたばれ！', en: 'Russian warship, go fuck yourself.' },
  ],
  '艶': [
    { jp: 'メアリーは艶やかな黒髪をしている。', en: 'Mary has beautiful dark hair.' },
  
    { jp: '艶消しは日本語で重要な言葉の一つだと思う。', en: 'I think 艶消し is one of the important words in Japanese.' },
  ],
  '芋': [
    { jp: '石焼き芋って、海外にもあるのかな。', en: 'I wonder whether stone-roasted sweet potatoes are available overseas as well.' },
    { jp: '紫芋を食べたいよ。', en: 'I want to eat purple potatoes.' },
  ],
  '芝': [
    { jp: '芝生から出なさい。', en: 'Get off the lawn!' },
    { jp: '芝生の上を歩くな。', en: 'Don\'t walk on the grass.' },
  ],
  '芳': [
    { jp: '「こりゃ放火だぜ」「芳華って誰？」', en: '"This is arson." "Who is Arson?"' },
    { jp: '蓮の花はなんとも言えない芳香をはなっていた。', en: 'The lotus blossoms diffused an inexpressibly pleasant scent.' },
  ],
  '芽': [
    { jp: '木々は芽を出し始めた。', en: 'The trees are beginning to bud.' },
    { jp: '２人の間に愛が芽生えた。', en: 'Love began to grow between the two.' },
  ],
  '苑': [
    { jp: 'あなたは歩く広辞苑か？', en: 'Are you a walking dictionary?' },
    { jp: '広辞苑はチタンの入っている紙を使います。', en: 'Kojien uses a paper that contains titanium.' },
  ],
  '苗': [
    { jp: '苗字は何て言うの？', en: 'What\'s your last name?' },
    { jp: '苗は若い植物です。', en: 'Seedlings are young plants.' },
  ],
  '茂': [
    { jp: '猫は茂みに隠れていた。', en: 'The cat lay hidden in the bushes.' },
    { jp: '何かが茂みの後ろで動いている。', en: 'Something is moving behind the bush.' },
  ],
  '茄': [
    { jp: '瓜のつるに茄子はならぬ。', en: 'You don\'t get eggplants from a gourd vine.' },
    { jp: '今日のお昼は、茄子なんだ。', en: 'Today I am having eggplant for lunch.' },
  ],
  '茅': [
    { jp: 'この家は、茅葺き屋根なんです。', en: 'This house has a thatched roof.' },
  
    { jp: '茅は日本語の語彙の中に含まれる漢字だ。', en: '茅 is a kanji found in the Japanese vocabulary.' },
  ],
  '茉': [
    { jp: '「二軒先の青木さんとこの茉奈ちゃん、女の子を産んだんだって」「えっ、名前なんて言うの？」「『ひまり』って言ってたよ」「どんな字、書くの？」「あっ、聞きそびれちゃった。どんな字、書くんだろうね？」', en: '"I hear two houses away the Aoki\'s little Mana gave birth to a girl." "Hm, what\'s her name?" "Himari." "Written how?" "Oh, I forgot to ask. Hmm, I wonder how it\'s written."' },
  
    { jp: '茉は日本語の語彙の中に含まれる漢字だ。', en: '茉 is a kanji found in the Japanese vocabulary.' },
  ],
  '茎': [
    { jp: 'バラは茎に刺がある。', en: 'A rose has thorns on its stem.' },
    { jp: '歯茎からうみが出ます。', en: 'I have pus coming out of my gums.' },
  ],
  '茜': [
    { jp: '日が沈む頃には、空が美しい茜色に染まる。', en: 'When the sun sets, the sky is died a beautiful madder red.' },
  
    { jp: '茜は日本語の語彙の中に含まれる漢字だ。', en: '茜 is a kanji found in the Japanese vocabulary.' },
  ],
  '荘': [
    { jp: 'この別荘の持ち主は誰ですか。', en: 'Who owns this villa?' },
    { jp: '別荘を買うようなお金はないよ。', en: 'I don\'t have enough money to buy a second home.' },
  ],
  '莉': [
    { jp: '莉紗さんのお誕生日は、２ヶ月後です。', en: 'Lisa\'s birthday is in two months.' },
  
    { jp: '莉は日本語の語彙の中に含まれる漢字だ。', en: '莉 is a kanji found in the Japanese vocabulary.' },
  ],
  '菊': [
    { jp: '彼女は雛菊を摘むのをやめた。', en: 'She stopped picking daisies.' },
    { jp: 'ホウレンソウと春菊から放射性物質が検出されました。', en: 'Radioactive contamination was detected in spinach and edible chrysanthemum.' },
  ],
  '菌': [
    { jp: 'ばい菌扱いするなよ。', en: 'Don\'t treat me like I am a disease.' },
    { jp: '殺菌処理を徹底します。', en: 'I sterilize with utmost care.' },
  ],
  '菖': [
    { jp: 'その庭園は菖蒲の名所です。', en: 'The garden is famous for its irises.' },
  
    { jp: '菖は日本語の語彙の中に含まれる漢字だ。', en: '菖 is a kanji found in the Japanese vocabulary.' },
  ],
  '菫': [
    { jp: '彼女の菫色の瞳が忘れられない。', en: 'Her violet pupils are unforgettable.' },
  
    { jp: '菫は日本語の語彙の中に含まれる漢字だ。', en: '菫 is a kanji found in the Japanese vocabulary.' },
  ],
  '華': [
    { jp: '中華街は中区山下町にある。', en: 'Chinatown is in Yamashitacho of Naka-ku.' },
    { jp: '中華街には中華料理のお店がたくさんあります。', en: 'There are many Chinese restaurants in Chinatown.' },
  ],
  '萌': [
    { jp: 'リプレーする度に彼女の反応にいちいち萌えてしまいます。', en: 'I find myself being enthralled by her reaction each time I replay it.' },
    { jp: 'トムは萌えキャラにハマってるんだ。', en: 'Tom is into moe characters.' },
  ],
  '萩': [
    { jp: '私たちは自転車を借りて、萩野町を観光した。', en: 'We rented bicycles and saw the sights of Hagino.' },
    { jp: '日本語を扱う場合にも応用できるように、訳者のひとりである萩原正人が、日本向けに原書にはない12章を書き下ろしました。', en: 'In order to put into application the case of treating Japanese, Masato Hagiwara all by himself wrote an additional chapter 12 for Japan that is not in the original book.' },
  ],
  '葬': [
    { jp: 'その婦人の葬式は地元の教会で行われた。', en: 'The lady\'s funeral was held at the local church.' },
    { jp: '彼女は一人息子を埋葬した。', en: 'She has buried her only son.' },
  ],
  '葵': [
    { jp: '葵さんは優れたダンサーです。', en: 'Aoi is a good dancer.' },
    { jp: '葵さんはダンサーになりました。', en: 'Aoi became a dancer.' },
  ],
  '蒔': [
    { jp: '蒔かぬ種は生えぬ。', en: 'You can\'t make an omelet without breaking eggs.' },
    { jp: '農夫が畑に種を蒔いている。', en: 'The farmer is scattering seeds over the field.' },
  ],
  '蒼': [
    { jp: 'ショウイチは顔面蒼白になった。', en: 'Shoichi\'s face turned pale.' },
    { jp: '交通事故のニュースに彼女は顔面蒼白となった。', en: 'The colour drained from her face at the news of the traffic accident.' },
  ],
  '蓄': [
    { jp: '私の友人は私の財産だ。ですので友人を蓄えたがる私の貪欲さを見逃してください。', en: 'My friends are my estate. Forgive me then the avarice to hoard them.' },
    { jp: '食糧は備蓄しておきましたか？', en: 'Have you made provisions?' },
  ],
  '蓮': [
    { jp: '火星上にある神殿には蓮の花が飾ってあります。', en: 'The temples on Mars are decorated with lotus flowers.' },
    { jp: '蓮の花はなんとも言えない芳香をはなっていた。', en: 'The lotus blossoms diffused an inexpressibly pleasant scent.' },
  ],
  '蕉': [
    { jp: '芭蕉はもっとも偉大な詩人だった。', en: 'Basho was the greatest poet.' },
  
    { jp: '蕉は日本語の語彙の中に含まれる漢字だ。', en: '蕉 is a kanji found in the Japanese vocabulary.' },
  ],
  '薦': [
    { jp: '何かお薦めの本ない？', en: 'Can you recommend a good book?' },
    { jp: 'それはお薦めしないな。', en: 'I wouldn\'t recommend that.' },
  ],
  '薪': [
    { jp: 'トムは薪を割ってるよ。', en: 'Tom is chopping firewood.' },
    { jp: '薪ストーブで暖まった。', en: 'I warmed up by the wood stove.' },
  ],
  '薫': [
    { jp: '薫、今のところおまえが一番のリアクション、大賞だよ。', en: 'Kaoru, yours is the best reaction so far - you win the grand prize.' },
  
    { jp: '薫は日本語の語彙の中に含まれる漢字だ。', en: '薫 is a kanji found in the Japanese vocabulary.' },
  ],
  '藍': [
    { jp: '髪に藍染めがついてとれないよ！', en: 'I\'m not able to remove the indigo dye in my hair!' },
    { jp: '藍色は日本の伝統色のひとつです。', en: 'Indigo blue is one of Japan\'s traditional colours.' },
  ],
  '藤': [
    { jp: '佐藤氏を紹介しましょう。', en: 'Let me introduce Mr Sato to you.' },
    { jp: '１９９５年、安藤氏は建築におけるもっとも権威ある賞を受賞した。', en: 'In 1995, Andou received architecture\'s most prestigious award.' },
  ],
  '藩': [
    { jp: '江戸時代に、各藩の奨励策によって、全国各地に地場産業が興った。', en: 'Local industry flourished throughout the land in the Edo period thanks to the promotional efforts by each clan.' },
  
    { jp: '藩は日本語の語彙の中に含まれる漢字だ。', en: '藩 is a kanji found in the Japanese vocabulary.' },
  ],
  '藻': [
    { jp: '海藻は身体にいいですか？', en: 'Is seaweed good for you?' },
  
    { jp: '海藻について詳しく学んだことがある。', en: 'I have learned about 海藻 in detail.' },
  ],
  '蘭': [
    { jp: '蘭には日々の手入れが必要です。', en: 'Orchids demand daily care.' },
    { jp: '瑞西は仏蘭西・伊太利・墺太利・独逸に囲まれている。', en: 'Switzerland is situated between France, Italy, Austria and Germany.' },
  ],
  '虎': [
    { jp: 'これは虎じゃない。', en: 'This is not a tiger.' },
    { jp: '虎は肉食動物です。', en: 'A tiger is a beast of prey.' },
  ],
  '虐': [
    { jp: '児童虐待は犯罪です。', en: 'Child abuse is a crime.' },
    { jp: 'トムは父親に虐待された。', en: 'Tom was abused by his father.' },
  ],
  '虚': [
    { jp: '謙虚さは美徳です。', en: 'Modesty is a virtue.' },
    { jp: '虚しさを感じるんだ。', en: 'I feel empty inside.' },
  ],
  '虜': [
    { jp: '彼は捕虜になった。', en: 'He was held in captivity.' },
    { jp: '捕虜は釈放された。', en: 'The prisoners were set free.' },
  ],
  '虹': [
    { jp: '「今日さ、虹色の雲があったんだ。あんなの初めて見たよ」「それは『彩雲』だね。見るといいことが起こる前触れだって、昔から言われてるんだよ」', en: '"There were rainbow-colored clouds today. I\'ve never seen anything like it before." "Iridescent clouds, huh? You know, it\'s an old saying that if you see them, it\'s a sign of good things to come."' },
    { jp: '今朝出てた虹みた？', en: 'Did you see the rainbow this morning?' },
  ],
  '蚊': [
    { jp: 'いま蚊に刺された。', en: 'A mosquito just bit me.' },
    { jp: '蚊によく刺されます。', en: 'Mosquitos love me.' },
  ],
  '蚕': [
    { jp: '蚕が糸を吐いている。', en: 'The silkworm is spinning a thread.' },
    { jp: '私の親は養蚕業を営んでいた。', en: 'My parents were running a silk farm.' },
  ],
  '蛇': [
    { jp: '空から見ると川は巨大な蛇のように見えた。', en: 'Seen from the sky, the river looked like a huge snake.' },
    { jp: '鬼が出るか蛇が出るか。この提案書の結果が見物だね。', en: 'There\'s no telling what kind of trouble this proposal might stir up. The result is certainly going to be something to see.' },
  ],
  '蛍': [
    { jp: '蛍光ペン借りていい？', en: 'Can I borrow your highlighter?' },
    { jp: '蛍光ペンは何で光るのですか？', en: 'Why do highlighters fluoresce?' },
  ],
  '蛮': [
    { jp: '己の慣習でないものを、人は野蛮と呼ぶ。', en: 'Each man calls barbarism whatever is not his own practice.' },
    { jp: '俺は青二才の頃は蛮カラぶって真夏に二週間ほど、お風呂に入らなかったこともあった。', en: 'When I was young, I was a bit scruffy and there were times when I didn\'t take a bath for up to two weeks during the summer.' },
  ],
  '蝶': [
    { jp: '蝶々って、昆虫なの？', en: 'Are butterflies insects?' },
  
    { jp: '蝶は日本語の語彙の中に含まれる漢字だ。', en: '蝶 is a kanji found in the Japanese vocabulary.' },
  ],
  '融': [
    { jp: '私は友達にお金を融通した。', en: 'I accommodated my friend with money.' },
    { jp: 'トムって融通が利かないと思う。', en: 'I think Tom is inflexible.' },
  ],
  '衆': [
    { jp: '憲法の規定に従い衆院の議決が参院に優越する。', en: 'Under the Constitution, the lower chamber\'s resolutions override those of the upper chamber.' },
    { jp: '群衆は静かになった。', en: 'The crowd calmed down.' },
  ],
  '街': [
    { jp: '中華街は中区山下町にある。', en: 'Chinatown is in Yamashitacho of Naka-ku.' },
    { jp: '中華街には中華料理のお店がたくさんあります。', en: 'There are many Chinese restaurants in Chinatown.' },
  ],
  '衛': [
    { jp: '月は地球の衛星だ。', en: 'The moon is the Earth\'s satellite.' },
    { jp: '私はトムの護衛です。', en: 'I\'m Tom\'s bodyguard.' },
  ],
  '衝': [
    { jp: '衝動買いはするな。', en: 'Don\'t make impulsive purchases.' },
    { jp: '衝動買いはやめとけ。', en: 'Stop buying things on impulse.' },
  ],
  '衡': [
    { jp: '金衡１ポンドは１２オンスである。', en: 'One pound troy weighs 12 oz.' },
  
    { jp: '衡は日本語の語彙の中に含まれる漢字だ。', en: '衡 is a kanji found in the Japanese vocabulary.' },
  ],
  '衰': [
    { jp: '老衰するな！老成せよ！', en: 'Don\'t grow old, grow wise!' },
    { jp: 'トムの人気は衰えていた。', en: 'Tom\'s popularity has decreased.' },
  ],
  '袈': [
    { jp: 'ちょっと、大袈裟じゃない？', en: 'Don\'t you think you\'re overreacting just a little bit?' },
  
    { jp: '袈は日本語の語彙の中に含まれる漢字だ。', en: '袈 is a kanji found in the Japanese vocabulary.' },
  ],
  '裁': [
    { jp: '憲法裁判所は、今日の朝の内に判決を下すだろう。', en: 'The constitutional court will issue a decision by noon today.' },
    { jp: '最高裁は前回の判決を覆した。', en: 'The Supreme Court overturned a previous decision.' },
  ],
  '裂': [
    { jp: '水道管が破裂した。', en: 'The water pipe burst.' },
    { jp: '私は紙を粉々に引き裂いた。', en: 'I tore the paper into pieces.' },
  ],
  '裕': [
    { jp: 'これを手伝ってくれる人を雇える余裕があるといいんですけどね。', en: 'I wish I could afford to hire someone to help me do this.' },
    { jp: '私達のどちらも相手を映画に連れて行くだけの余裕がなかったので、割り勘にした。', en: 'Since neither one of us could afford to take the other to the movies, we went Dutch.' },
  ],
  '裟': [
    { jp: 'ちょっと、大袈裟じゃない？', en: 'Don\'t you think you\'re overreacting just a little bit?' },
  
    { jp: '裟は日本語の語彙の中に含まれる漢字だ。', en: '裟 is a kanji found in the Japanese vocabulary.' },
  ],
  '裸': [
    { jp: 'この台風の中全裸で外に出てみたい。', en: 'I\'d like to go out stark naked in the middle of this typhoon.' },
    { jp: '彼はびっくりして裸足で外に飛び出した。', en: 'He was so startled that he ran outside barefoot.' },
  ],
  '製': [
    { jp: 'これって、スイス製？', en: 'Is this made in Switzerland?' },
    { jp: 'その玩具は木製だ。', en: 'That toy is made out of wood.' },
  ],
  '褒': [
    { jp: '先生に褒められたの？', en: 'Were you praised by the teacher?' },
    { jp: 'それって、褒め言葉だよね？', en: 'That\'s a compliment, right?' },
  ],
  '襟': [
    { jp: '襟に染みがついてますよ。', en: 'Your collar has a stain on it.' },
    { jp: '彼はすりの襟首を掴んだ。', en: 'He seized the pickpocket by the collar.' },
  ],
  '襲': [
    { jp: 'トラは空腹の時は人を襲うものだ。', en: 'A tiger will attack people when it is hungry.' },
    { jp: '銀行が襲われたんだ。', en: 'The bank was attacked.' },
  ],
  '覆': [
    { jp: '空が雲で覆われてきた。', en: 'The sky has become overcast.' },
    { jp: '丘は雪に覆われていた。', en: 'The hill lay covered with snow.' },
  ],
  '覇': [
    { jp: '沖縄県の県庁所在地は那覇市です。', en: 'Okinawa Prefecture\'s capital is Naha City.' },
    { jp: '彼は世界選手権で４連覇を成し遂げた。', en: 'He won four successive world championships.' },
  ],
  '視': [
    { jp: '広島平和資料館内には、「広島への原爆投下からの日数」および「最後の核実験からの日数」を刻む『地球平和監視時計』が設置されています。', en: 'Inside the Hiroshima Peace Memorial Museum, there is a "Peace Watch Tower" that counts both the number of days since the nuclear bombing on Hiroshima as well as the days passed since the most recent nuclear weapons testing.' },
    { jp: 'どうして無視するの？', en: 'Why do you ignore me?' },
  ],
  '覧': [
    { jp: '観覧車が一番好きです。', en: 'The Ferris wheel is my favorite.' },
    { jp: '観覧車のてっぺんから街全体が見れます。', en: 'You could see the entire city from the top of the Ferris wheel.' },
  ],
  '訂': [
    { jp: '誤りがあれば訂正しなさい。', en: 'Correct errors, if any.' },
    { jp: '自分で訂正しました。', en: 'I corrected myself.' },
  ],
  '討': [
    { jp: '時々、政治家の一人がテレビの討論会に出て傍聴者の意見を押さえつけようとする場面をみる。', en: 'Sometimes, one of the politicians can be seen trying to keep the audience\'s opinions under control during televised debates.' },
    { jp: '討論は続いている。', en: 'The debate is continuing.' },
  ],
  '託': [
    { jp: '私は船長に命を託さなければならなかった。', en: 'I had to trust the captain with my life.' },
    { jp: 'チーム再建を託された監督が脱税でクビだってよ。', en: 'I heard that the manager entrusted with rebuilding the team was fired for tax evasion.' },
  ],
  '訟': [
    { jp: '訴訟リスクの高さも産科医にのしかかる。', en: 'Obstetricians also bear a high risk of suits.' },
    { jp: '私はその医者を相手取って訴訟を起こした。', en: 'I brought a suit against the doctor.' },
  ],
  '訳': [
    { jp: 'この文を英訳せよ。', en: 'Put this sentence into English.' },
    { jp: '次の文を英訳せよ。', en: 'Put the following sentences into English.' },
  ],
  '訴': [
    { jp: '彼女は彼を訴えた。', en: 'She sued him.' },
    { jp: 'あなたを訴えます。', en: 'I will sue you.' },
  ],
  '診': [
    { jp: 'サミは癌と診断されました。', en: 'Sami was diagnosed with cancer.' },
    { jp: 'メアリーは１０月に乳がんって診断されたんだ。', en: 'Mary was diagnosed with breast cancer in October.' },
  ],
  '証': [
    { jp: '在留資格認定証明書を貰って、ロンドンの日本大使館に来てください。', en: 'Upon receiving your Certificate of Eligibility, please come to the Japanese Embassy in London.' },
    { jp: '消息筋によると、○○社は東証一部への上場を準備している。', en: 'According to informed sources, ____ Ltd. is preparing for the move up to the first section of the Tokyo Stock exchange.' },
  ],
  '詐': [
    { jp: '詐欺師が捕まった。', en: 'The imposter was caught.' },
    { jp: 'なんか詐欺っぽいね。', en: 'It sounds like a scam.' },
  ],
  '評': [
    { jp: 'トムは評判が良い。', en: 'Tom has a good reputation.' },
    { jp: '彼女は評判が良い。', en: 'She has a good reputation.' },
  ],
  '詠': [
    { jp: 'トムとメアリーは昼の間じゅう樫の木陰で俳句を詠み交わしていた。', en: 'Under the shadow of the oak tree, Tom and Mary recited haiku to each other all day long.' },
  
    { jp: '詠は日本語の語彙の中に含まれる漢字だ。', en: '詠 is a kanji found in the Japanese vocabulary.' },
  ],
  '詩': [
    { jp: '脚韻と平仄が漢詩の基本的ルールとなっています。', en: 'Rhyme and meter form the essential rules of Chinese poetry.' },
    { jp: 'フランツ・リストの最も有名な作品は19のハンガリー狂詩曲だが、彼は他にもソナタ、交響曲、協奏曲、歌曲、宗教曲など見事な作品を生み出した。', en: 'The best-known compositions by Franz Liszt are his nineteen Hungarian Rhapsodies, but he also created beautiful sonatas, symphonies, concerti, songs, and religious compositions.' },
  ],
  '該': [
    { jp: '医療行為により患者が死亡している場合、その医療行為に過失があれば、過失の程度を問わず、直ちに「異状死」に法的に該当しない。', en: 'In the case of patient death during the course of medical treatment, even if there is medical error present, it is not automatically legally considered to be an "unusual death."' },
    { jp: '洗濯機で該当オプションを適用した。', en: 'I\'ve entered the appropriate settings on the washing machine.' },
  ],
  '詳': [
    { jp: '警察はその事故がどんなふうに起きたのかを、その目撃者に詳しく話させた。', en: 'The police made the witness explain in detail how the accident had happened.' },
    { jp: '船のことは詳しいよ。', en: 'I know a lot about ships.' },
  ],
  '誇': [
    { jp: '誇張しないでください。', en: 'Don\'t exaggerate.' },
    { jp: 'トムには誇張癖がある。', en: 'Tom tends to exaggerate.' },
  ],
  '誉': [
    { jp: '彼は私の新車を誉めた。', en: 'He admired my new car.' },
    { jp: '彼はいつも彼女を誉める。', en: 'He always speaks well of her.' },
  ],
  '誓': [
    { jp: '僕、運動会で選手宣誓するんだ。', en: 'I will read the athletes\' oath at sports day.' },
    { jp: '彼は禁煙を心に誓った。', en: 'He vowed to give up smoking.' },
  ],
  '誕': [
    { jp: '天皇誕生日が日曜日と重なった。', en: 'The Emperor\'s Birthday fell on Sunday.' },
    { jp: '誕生日おめでとうございます。', en: 'Happy birthday to you!' },
  ],
  '誘': [
    { jp: 'トムが誘拐された。', en: 'Tom was kidnapped.' },
    { jp: '友達を誘いました。', en: 'I invited my friends.' },
  ],
  '誠': [
    { jp: '彼女の忠誠心を評価します。', en: 'I appreciate her loyalty.' },
    { jp: '騎士が王への忠誠を誓った。', en: 'The knight swore an oath of allegiance to the king.' },
  ],
  '誼': [
    { jp: '金の貸し借り友誼の終わり。', en: 'Lend your money and lose your friend.' },
  
    { jp: '誼は日本語の語彙の中に含まれる漢字だ。', en: '誼 is a kanji found in the Japanese vocabulary.' },
  ],
  '請': [
    { jp: '政府が自衛隊に沖縄への災害派遣を要請した。', en: 'The government asked the SDF for a disaster relief deployment to Okinawa.' },
    { jp: 'この要請について、承認待ちリストから承認または拒否を選択してください。', en: 'For this request, please choose \'accept\' or \'reject\' from the waiting list.' },
  ],
  '諭': [
    { jp: '福沢諭吉は日本に西洋思想を広めた。', en: 'Yukichi Fukuzawa introduced Western ideas into Japan.' },
  
    { jp: '諭は日本語の語彙の中に含まれる漢字だ。', en: '諭 is a kanji found in the Japanese vocabulary.' },
  ],
  '諾': [
    { jp: '日本には、お見合い結婚と恋愛結婚とがあります。お見合い結婚の場合、お互いの家族に釣書を見せ、承諾を得なければなりません。そのような結婚は、まるでビジネス上の取引関係のようです。', en: 'In Japan, there are arranged marriages and love marriages. In arranged marriages, each partner must show biodata to each other\'s families before possible approval. Such a marriage is seen also as a business relationship.' },
    { jp: '私は彼女の招待を受諾した。', en: 'I accepted her invitation.' },
  ],
  '謀': [
    { jp: '無謀ってもんだよ。', en: 'It is like looking for a needle in a haystack.' },
    { jp: '無謀な運転で二人の男は逮捕された。', en: 'The two men were arrested for reckless driving.' },
  ],
  '謁': [
    { jp: '女王と謁見出来る日がくるなんて夢のようだ。', en: 'It feels like a dream to be able to meet with the queen.' },
  
    { jp: '謁は日本語の語彙の中に含まれる漢字だ。', en: '謁 is a kanji found in the Japanese vocabulary.' },
  ],
  '謙': [
    { jp: '謙虚さは美徳です。', en: 'Modesty is a virtue.' },
    { jp: '謙虚さを身につけて。', en: 'Learn humility.' },
  ],
  '謝': [
    { jp: '11月23日は勤労感謝の日で、勤労の大切さを伝えるために制定された祝日です。', en: 'November 23rd is Labor Thanksgiving Day, which was established as a national holiday to stress the importance of labor in people\'s minds.' },
    { jp: '細菌などから隔離するため、面会謝絶となっています。', en: 'In order to isolate him from bacteria, and such, he is not allowed visitors.' },
  ],
  '謡': [
    { jp: '最近は老若男女が歌えるような歌謡曲を耳にすることもなくなった。', en: 'Nowadays you no longer hear popular songs that can be sung by men and women of all ages.' },
    { jp: '兄が民謡に興味を抱き始めたのは十二歳ごろだった。', en: 'My older brother started to take interest in Japanese folk songs when he was around 12 years old.' },
  ],
  '謹': [
    { jp: '彼は口を謹んで何も語らなかった。', en: 'He kept his tongue under a bridle.' },
    { jp: 'Synology はお客様を謹んでカンファレンスイベントへご招待いたします', en: 'Synology is honored to invite you to its conference event.' },
  ],
  '譜': [
    { jp: '彼はピアノを楽譜なしで弾いた。', en: 'He played piano by ear.' },
    { jp: '彼女は楽譜なしでピアノを弾くんです。', en: 'She plays the piano by ear.' },
  ],
  '譲': [
    { jp: '老人に席を譲るとは彼も礼儀をわきまえている。', en: 'It was civil of him to offer his seat to the old man.' },
    { jp: 'お年寄りに席を譲るとは、彼はなんと礼儀正しい人なんだ。', en: 'It was polite of him to offer his seat to the old man.' },
  ],
  '護': [
    { jp: '誰がトムを擁護した？', en: 'Who defended Tom?' },
    { jp: '彼女は看護師です。', en: 'She is a nurse.' },
  ],
  '豆': [
    { jp: 'コーヒー豆はどこ？', en: 'Where are the coffee beans?' },
    { jp: '豆腐は好きですか？', en: 'Do you like tofu?' },
  ],
  '豚': [
    { jp: '豚は小屋にいない。', en: 'The pigs aren\'t in the pen.' },
    { jp: 'これは牛肉？それとも豚肉？', en: 'Is this beef or pork?' },
  ],
  '豪': [
    { jp: '酒豪女は嫌いです。', en: 'I don\'t like women who drink a lot.' },
    { jp: '豪華客船が港に入った。', en: 'A luxury liner arrived in the harbor.' },
  ],
  '貞': [
    { jp: 'トムはまだ童貞だ。', en: 'Tom is still a virgin.' },
    { jp: '貞子は西に沈んでゆく太陽をみて、メクラになった。', en: 'Sadako watched the sun lowering in the west and became blind.' },
  ],
  '貢': [
    { jp: 'ついに年貢の納め時が来たか。', en: 'I guess the time of reckoning has arrived at last.' },
    { jp: '多くの技術を修得すればするほど、社会に対して大きな貢献をすることができる。', en: 'The more skills one masters, the greater contribution one can make to society.' },
  ],
  '貫': [
    { jp: 'その学校は、中・高一貫校だということを頭の片隅にでも入れておいて下さい。', en: 'Bear in mind that that school is an integrated junior high and high school.' },
    { jp: 'この志望理由書は、論旨の展開に一貫性が無く、散漫な印象です。', en: 'This statement-of-purpose essay has no consistency in how the points are laid out and gives a distracted impression.' },
  ],
  '貴': [
    { jp: '貴男は何歳ですか？', en: 'How old are you?' },
    { jp: '姉貴はいないんだ。', en: 'I don\'t have an older sister.' },
  ],
  '賀': [
    { jp: '年賀状はもう全部書き終わった？', en: 'Have you finished writing all the New Year\'s cards?' },
    { jp: '年賀状はもう全部書き上げましたか？', en: 'Have you completed all your New Year\'s cards?' },
  ],
  '賃': [
    { jp: '賃貸アパートをさがしています。', en: 'I\'m looking for an apartment to rent.' },
    { jp: 'トムは賃貸アパートを探してるんだ。', en: 'Tom is looking for an apartment to rent.' },
  ],
  '賄': [
    { jp: '彼は贈収賄を軽蔑した。', en: 'He disdained bribery.' },
    { jp: '市長が賄賂を受け取ったんですって。', en: 'It\'s said that the mayor is on the take.' },
  ],
  '賊': [
    { jp: '海賊ごっこしようぜ。', en: 'Let\'s pretend we\'re pirates.' },
    { jp: '海賊は降伏するしかなかった。', en: 'The pirates had no choice but to surrender.' },
  ],
  '賓': [
    { jp: 'オバマ大統領が国賓として来日したのを機に、日米の通商担当高官が深夜から明け方にかけて長時間にわたる交渉を断続的に行った。', en: 'Taking the opportunity for President Obama to visit Japan as a state guest, the chief trade negotiators of Japan and the U.S. conducted a series of marathon meetings from midnight to early morning.' },
  
    { jp: '賓は日本語の語彙の中に含まれる漢字だ。', en: '賓 is a kanji found in the Japanese vocabulary.' },
  ],
  '賜': [
    { jp: '社長から金一封を賜りました。', en: 'I was given some money by the company president.' },
    { jp: '入念な計画と努力の賜物です。', en: 'It is the fruit of hard work and a well-prepared plan.' },
  ],
  '賠': [
    { jp: '賠償金えぐいことになるな。', en: 'The compensation is going to be a heck of a lot of money.' },
    { jp: '裁判所は、私に損害賠償として10万ドルの支払いを命じた。', en: 'The court ordered me to pay a hundred thousand dollars in damages.' },
  ],
  '購': [
    { jp: 'チケットの有効期限は、購入日を含めた２日間のみです。', en: 'Tickets are valid for just two days, including the day they are purchased on.' },
    { jp: 'この券は購入後2日間有効です。', en: 'This ticket is valid for two days after purchase.' },
  ],
  '赦': [
    { jp: '重大な罪については、指導者に告白しなければ赦しを受けることができないとも教えています。', en: 'They also teach that, for great sins, they cannot receive forgiveness unless they confess to their leader.' },
    { jp: '姫は帝に赦しを乞うた。', en: 'The princess begged forgiveness from the emperor.' },
  ],
  '赴': [
    { jp: '今流行の、単身赴任族の淋しさを、ちょっぴり味わわせてもらったのも、有意義な体験だ。', en: 'It was a meaningful experience for me to get a small taste of the loneliness people feel when they\'ve made the now-popular decision to leave their families and work elsewhere.' },
    { jp: '戦場に赴くカメラマンが不発弾の危険性を知らないのは不思議だ、新聞社は教育を怠ってる。', en: 'It is strange that a cameraman heading for a war-zone should not know about the danger of unexploded shells. The newspaper company is being negligent in its training.' },
  ],
  '趣': [
    { jp: '私の趣味は音楽だ。', en: 'My hobby is music.' },
    { jp: '私の趣味は読書だ。', en: 'My hobby is to read.' },
  ],
  '距': [
    { jp: '踊りによってその食糧までの距離や方角を伝える。', en: 'They communicate the distance and direction of the food by dancing.' },
    { jp: '距離は推定しにくいな。', en: 'The distance is hard to estimate.' },
  ],
  '跳': [
    { jp: '縄跳びってできる？', en: 'Can you jump rope?' },
    { jp: 'トムは縄跳びをしている。', en: 'Tom is jumping rope.' },
  ],
  '践': [
    { jp: '準備が整ったらさっそく実践だ。', en: 'When preparations are completed, it will be carried out at once.' },
    { jp: '口先よりも実践が大事なんだよ。', en: 'Actions speak louder than words.' },
  ],
  '踏': [
    { jp: 'うんこ踏んじゃった！', en: 'I stepped on poop!' },
    { jp: '釘を踏んじゃった。', en: 'I stepped on a nail.' },
  ],
  '躍': [
    { jp: '登場人物の躍動的な関わり合いこそがこの小説をかくも偉大なものとしている。', en: 'It\'s the dynamic interaction between the characters that makes this novel so great.' },
    { jp: '彼女は一躍有名になった。', en: 'She suddenly became famous.' },
  ],
  '軌': [
    { jp: '円形の軌道に沿って、地球をめぐっている。', en: 'It is orbiting around the Earth along a circular path.' },
    { jp: '私の事業もようやく軌道に乗りました。', en: 'My business has at last gotten on the right track.' },
  ],
  '軸': [
    { jp: 'この線を軸にして図形を回転してください。', en: 'Please take this line as the axis and rotate the figure around it.' },
    { jp: '放物線 y=x²−4x+7 をx軸方向に3，y軸方向に−2だけ平行移動して得られる放物線の方程式を求めよ。', en: 'Let\'s find the equation that shifts the parabola y=x²−4x+7 three spaces on the x-axis and -2 spaces on the y-axis.' },
  ],
  '較': [
    { jp: '翻訳を比較することで言語を学びます。', en: 'By comparing translations, I learn languages.' },
    { jp: '彼女は比較的早口だ。', en: 'She speaks relatively fast.' },
  ],
  '載': [
    { jp: '大容量のＲＡＭが搭載されていると、メモリ不足を示すエラーメッセージが表示される。', en: 'If a very large amount of memory is installed, an \'insufficient memory\' error message is displayed.' },
    { jp: 'リストに載ってたよ。', en: 'Your name was on the list.' },
  ],
  '輔': [
    { jp: '大輔は頂上に登った。', en: 'Daisuke climbed to the summit.' },
  
    { jp: '輔は日本語の語彙の中に含まれる漢字だ。', en: '輔 is a kanji found in the Japanese vocabulary.' },
  ],
  '輝': [
    { jp: '太陽が輝いている。', en: 'The sun is shining.' },
    { jp: '今日は太陽が輝いてる。', en: 'The sun is bright today.' },
  ],
  '輩': [
    { jp: '吾輩は猫である。名前はまだ無い。', en: 'I am a cat. I don\'t have a name yet.' },
    { jp: '吾輩は子猫である。', en: 'I\'m a kitty cat.' },
  ],
  '轄': [
    { jp: 'その件は通産省の管轄下にある。', en: 'The matter comes under MITI.' },
  
    { jp: '轄は日本語の語彙の中に含まれる漢字だ。', en: '轄 is a kanji found in the Japanese vocabulary.' },
  ],
  '辰': [
    { jp: '辰雄は航空機の着陸装置を見るのが好きです。', en: 'Tatsuo likes looking at aircraft landing gears.' },
  
    { jp: '辰砂という表現を日常会話で使うことがある。', en: 'The expression 辰砂 is sometimes used in daily conversation.' },
  ],
  '辱': [
    { jp: '何人も、拷問又は残虐な、非人道的な若しくは屈辱的な取扱若しくは刑罰を受けることはない。', en: 'No one shall be subjected to torture or to cruel, inhuman or degrading treatment or punishment.' },
    { jp: 'トムはメアリーを侮辱した。', en: 'Tom insulted Mary.' },
  ],
  '迅': [
    { jp: '彼は私に迅速な回答を執拗に求めた。', en: 'He pressed me for a prompt reply.' },
    { jp: '日本の国民は諸外国の迅速な対応にとても感謝しています。', en: 'The Japanese people appreciate very much the prompt assistance of many foreign countries.' },
  ],
  '迫': [
    { jp: 'そのロボットはあまりにも真に迫りすぎて気持ち悪かった。', en: 'The robot was so lifelike that it was creepy.' },
    { jp: '時間が迫っている。', en: 'The clock is ticking.' },
  ],
  '迭': [
    { jp: '田中前外相の更迭に続く政治混乱がその象徴である。', en: 'The dismissal of foreign minister Tanaka is symbolic of the continuing political turmoil.' },
  
    { jp: '迭は日本語の語彙の中に含まれる漢字だ。', en: '迭 is a kanji found in the Japanese vocabulary.' },
  ],
  '透': [
    { jp: 'この透明な液体には毒が含まれている。', en: 'This transparent liquid contains poison.' },
    { jp: '透明人間が見えますか？', en: 'Can you see the invisible man?' },
  ],
  '逐': [
    { jp: '彼女はそれを逐語訳した。', en: 'She translated it word for word.' },
    { jp: '私たちは逐語的な直訳ではなく自然に聞こえる翻訳が欲しいと思います。', en: 'We want natural-sounding translations, not word-for-word direct translations.' },
  ],
  '逝': [
    { jp: '兄が急逝したのは２年前、義姉は一人兄の遺した小さな宝飾店を健気に守ってきた。', en: 'Since my brother died suddenly two years ago, my sister-in-law has valiantly kept going the small jewellery store he left her.' },
    { jp: '祖父は祖母がぽっくり逝ってから急に老け込みました。', en: 'After Grandma\'s sudden death, Grandpa began to age rapidly.' },
  ],
  '逮': [
    { jp: '彼らは逮捕された。', en: 'They\'ve been arrested.' },
    { jp: 'トムが逮捕された。', en: 'Tom was arrested.' },
  ],
  '逸': [
    { jp: '瑞西は仏蘭西・伊太利・墺太利・独逸に囲まれている。', en: 'Switzerland is situated between France, Italy, Austria and Germany.' },
    { jp: '好機逸すべからず。', en: 'Strike while the iron is hot.' },
  ],
  '遂': [
    { jp: '彼は自分の母親にナイフで切り付け殺人未遂で有罪になった。', en: 'He was found guilty of attempted murder for attacking his mother with a knife.' },
    { jp: '彼は後にテロ関連の殺人未遂とテログループへの参加で起訴されました。', en: 'He was later charged with attempted terrorism-related murder and for his participation in a terrorist group.' },
  ],
  '遇': [
    { jp: 'これは私の生涯にとって千載一遇の機会だ。', en: 'This is the chance of a lifetime.' },
    { jp: '彼は境遇に満足している。', en: 'He is contented with his lot.' },
  ],
  '遍': [
    { jp: '一遍に2か国語も習ってるの？', en: 'Are you learning two foreign languages at the same time?' },
    { jp: '一遍で正確に答えてください。', en: 'Answer accurately in one go.' },
  ],
  '遣': [
    { jp: '最近ずっと、このお店に通ってます。雰囲気や客層も良いし、何より落ち着くの。ところで、あなたってここで何年働いてるの？ここで働いてて遣り甲斐を感じる？', en: 'Recently I\'ve been going to this shop a lot. The atmosphere is good, the customers are nice, and it\'s just really calming. How many years have you been working at this shop? Do you find it rewarding to work here?' },
    { jp: '水の無駄遣いだよ！', en: 'What a waste of water!' },
  ],
  '遥': [
    { jp: '遥か遠くに住んでいます。', en: 'I live too far away.' },
    { jp: '彼女は私よりも遥かに上手なピアニストです。', en: 'She\'s a much better pianist than me.' },
  ],
  '遭': [
    { jp: '痛い目に遭わせるぞ。', en: 'Don\'t make me hurt you.' },
    { jp: '船長は無線通信士に遭難信号を打つように命令した。', en: 'The ship\'s captain ordered the radio operator to send a distress signal.' },
  ],
  '遮': [
    { jp: '空気を遮断して火を消した。', en: 'The air was blocked off, extinguishing the fire.' },
    { jp: '工事が通りへの進入を遮断した。', en: 'The construction blocked the entrance to the street.' },
  ],
  '遵': [
    { jp: 'すべての会員は本規則を遵守しなければならない。', en: 'All members need to observe these rules.' },
  
    { jp: '遵は日本語の語彙の中に含まれる漢字だ。', en: '遵 is a kanji found in the Japanese vocabulary.' },
  ],
  '遷': [
    { jp: '彼は部長の娘さんを妊娠させて、左遷されました。', en: 'He got the section chief\'s daughter pregnant and was demoted.' },
    { jp: '12月24日から10日間、たいていの日本人はキリスト教、仏教、神道と教えを変遷していく。', en: 'Throughout the 10 days following December 24th, many Japanese people will quickly shift from Christian to Buddhist to Shinto teachings.' },
  ],
  '遺': [
    { jp: 'ポンペイはユネスコの世界遺産です。', en: 'Pompeii is a UNESCO World Heritage Site.' },
    { jp: '世界遺産でもある宮島の「厳島神社」は、潮が満ちると神社全体がまるで海に浮かんでいるかのように見えます。その姿は神秘的で、世界中から訪れる観光客を魅了し続けています。', en: 'Also known for being a world heritage site, the Itsukushima Shrine in Miyajima gives the impression that it is floating in the ocean whenever the tides come in. Its mystical appearance continues to attract tourists from all over the world.' },
  ],
  '避': [
    { jp: 'そんな避妊法があるかっ！', en: 'I had no idea that type of contraception existed!' },
    { jp: '私のこと避けてる？', en: 'Are you avoiding me?' },
  ],
  '還': [
    { jp: '明日は母方の祖父の還暦祝いをする。', en: 'My grandfather on my mother\'s side is celebrating his 60th birthday tomorrow.' },
    { jp: '彼は還暦を迎えました。', en: 'He has turned sixty years old.' },
  ],
  '那': [
    { jp: 'トムは妹の旦那よ。', en: 'Tom is my younger sister\'s husband.' },
    { jp: '私の旦那、いい男よ。', en: 'My husband is a good man.' },
  ],
  '邦': [
    { jp: '邦楽が聞きたいです。', en: 'I want to listen to Japanese music.' },
    { jp: '子供はみんな異邦人だ。', en: 'Children are all foreigners.' },
  ],
  '邪': [
    { jp: 'トムは1918年のスペイン風邪に関する本を読んだ。', en: 'Tom read a book about the Spanish flu of 1918.' },
    { jp: 'ひどい風邪をひいた。', en: 'I caught a bad cold.' },
  ],
  '邸': [
    { jp: '通りに沿って大邸宅が並んでいる。', en: 'There are large houses along the street.' },
    { jp: '政府役人の豪邸が略奪された。', en: 'A government official\'s stately mansion was looted.' },
  ],
  '郎': [
    { jp: '新郎は30歳です。', en: 'The groom is thirty years old.' },
    { jp: '次の曲を、新郎と新婦に捧げたいと思います。', en: 'I\'d like to dedicate this next song to the bride and groom.' },
  ],
  '郡': [
    { jp: 'これは豊能郡の地図です。', en: 'This is a map of the Toyono district.' },
    { jp: 'これは二戸郡の地図である。', en: 'This is a map of Ninohe District.' },
  ],
  '郭': [
    { jp: '霧のため山の輪郭がぼんやりしていた。', en: 'The mountain was blurred by fog.' },
  
    { jp: '外郭について詳しく学んだことがある。', en: 'I have learned about 外郭 in detail.' },
  ],
  '郷': [
    { jp: '故郷はどうだった？', en: 'How was your hometown?' },
    { jp: 'ここが私の故郷です。', en: 'This is my hometown.' },
  ],
  '酌': [
    { jp: '主人は晩酌が楽しみなので、発泡酒を６缶以上は空けていますし、日本酒の燗が５本も６本も空いていて、たまに休肝日ということで飲まない日もあるのですが２日以上続いたことはありません。', en: 'My husband likes to have a drink in the evening. He drinks 6 or more bottles of sparkling wine and 5 or 6 bottles of warm sake. Sometimes he has a day where he doesn\'t drink, but it has never lasted for more than two days.' },
    { jp: '夜どおしシャンペンが酌み交わされた。', en: 'Champagne flowed all night.' },
  ],
  '酔': [
    { jp: '酔い止めの薬をください。', en: 'Please give me some airsickness medicine.' },
    { jp: '子供でも飲める酔い止めが欲しいんですけど。', en: 'I\'d like some motion sickness medicine for children.' },
  ],
  '酢': [
    { jp: 'トムはモデナでバルサミコ酢を購入しました。', en: 'Tom bought a bottle of balsamic vinegar in Modena.' },
    { jp: '酢豚の作り方が分からない。', en: 'I don\'t know how to make sweet and sour pork.' },
  ],
  '酬': [
    { jp: '静かにして。明日こそ酬われます。', en: 'Stay calm. You\'ll have your reward tomorrow.' },
    { jp: '仕事量に応じて報酬が支払われます。', en: 'You\'ll be paid according to the amount of work you do.' },
  ],
  '酵': [
    { jp: '発酵と腐敗の違いは何ですか？', en: 'What\'s the difference between fermentation and putrescence?' },
    { jp: 'イーストはビールを発酵させる。', en: 'Yeast makes beer ferment.' },
  ],
  '酷': [
    { jp: '彼は酷い風邪をひいた。', en: 'He caught a terrible cold.' },
    { jp: '裁判官はその未決囚の行動に対する嫌悪の念をためらうことなくあからさまにして、できるだけ過酷な刑を下した。', en: 'The judge made no bones about his disgust with the accused\'s actions and handed down the severest sentence possible.' },
  ],
  '酸': [
    { jp: 'この実は、まだ酸っぱくて食べれない。', en: 'This fruit is still too sour to eat.' },
    { jp: '月には酸素がない。', en: 'There\'s no oxygen on the moon.' },
  ],
  '醜': [
    { jp: '私を醜いと思いますか。', en: 'Do you think I\'m ugly?' },
    { jp: '醜い猫が私の椅子に座ったんだよ！', en: 'An ugly cat sat in my chair!' },
  ],
  '醸': [
    { jp: 'ビールは麦芽から醸造される。', en: 'Beer is brewed from malt.' },
  
    { jp: '醸は日本語の語彙の中に含まれる漢字だ。', en: '醸 is a kanji found in the Japanese vocabulary.' },
  ],
  '采': [
    { jp: '群集は勝者に拍手喝采を送った。', en: 'The crowd gave the winner a big hand.' },
    { jp: '彼の名演技に観客はやんやの喝采を送った。', en: 'His great performance drew thundering applause from the audience.' },
  ],
  '釈': [
    { jp: 'この教科書は注釈が多い。', en: 'This textbook has a lot of notes.' },
    { jp: '捕虜は釈放された。', en: 'The prisoners were set free.' },
  ],
  '釣': [
    { jp: 'ミニゲームの釣りが人気ある。', en: 'The fishing minigame is popular.' },
    { jp: 'ある日、老人は川へ魚釣りに行った。', en: 'One day an old man went fishing in the river.' },
  ],
  '鈴': [
    { jp: '鈴の音が聞こえました。', en: 'I heard the sound of a ringing bell.' },
    { jp: '風鈴の音が大好きなんだ。', en: 'I love the sound of wind chimes.' },
  ],
  '鉛': [
    { jp: '黄銅は銅と亜鉛の合金である。', en: 'Brass is an alloy of copper and zinc.' },
    { jp: '鉛筆で書きなさい。', en: 'Write it in pencil.' },
  ],
  '鉢': [
    { jp: '植木鉢が歩道に落ちて、ガチャンと割れた。', en: 'The flower pot crashed to the sidewalk.' },
    { jp: '庭にあった鉢植えをどけたら、小さな虫がうじゃうじゃといて、思わず悲鳴をあげてしまった。', en: 'When I lifted a potted plant in my garden, there were swarms of little insects crawling underneath, and I instinctively let out a shriek.' },
  ],
  '銃': [
    { jp: 'トムは銃を買った。', en: 'Tom bought a gun.' },
    { jp: '銃をおろしなさい。', en: 'Put your gun down.' },
  ],
  '銘': [
    { jp: '座右の銘は何ですか？', en: 'What\'s your favorite quote?' },
    { jp: '観客は深い感銘を受けた。', en: 'The audience was deeply affected.' },
  ],
  '銭': [
    { jp: '「これは何？供物か？」「そうだよ、このお賽銭箱の中に入れて・・・この紐を引っ張るの」', en: '"What is this? An offering?" "That\'s right. Put it in this offertory box ... and pull this rope."' },
    { jp: '小銭持ってないわ。', en: 'I don\'t have any change.' },
  ],
  '鋳': [
    { jp: '鋳物が金型からすっぽりとれた。', en: 'The casting came cleanly out of its mold.' },
  
    { jp: '鋳は日本語の語彙の中に含まれる漢字だ。', en: '鋳 is a kanji found in the Japanese vocabulary.' },
  ],
  '鋼': [
    { jp: 'その町は鉄鋼業の中心地である。', en: 'That town is the center of the steel industry.' },
    { jp: '彼は鋼のような意志を持っている。', en: 'He has a will of steel.' },
  ],
  '錠': [
    { jp: '「かぎは錠前に差し込んである」と、彼は付け加えた。', en: '"The key," he added, "is in the lock."' },
    { jp: '寝る前に風邪薬を3錠飲んだ。', en: 'I took three tablets of a cold medicine before going to bed.' },
  ],
  '錦': [
    { jp: '錦あやなす木々で山が染まっていた。', en: 'The mountainside was ablaze with the autumn colors of the trees.' },
  
    { jp: '錦は日本語の語彙の中に含まれる漢字だ。', en: '錦 is a kanji found in the Japanese vocabulary.' },
  ],
  '錬': [
    { jp: '私は錬金術師です。', en: 'I\'m an alchemist.' },
    { jp: '現代の日本で錬金術といえば、比喩的にしか使われない。モラルや羞恥心と無縁の政治屋や宗教家が、不正な手段でカネもうけをするときに。', en: 'In present day Japan, "alchemy" is only used metaphorically; to refer to improper means of making money by politicians or religious hucksters with no morals or shame.' },
  ],
  '錯': [
    { jp: 'まだ試行錯誤だな。', en: 'It\'s still being tested.' },
    { jp: '目の錯覚かと思った。', en: 'I thought my eyes were playing tricks on me.' },
  ],
  '鍛': [
    { jp: 'まずは語彙力を鍛えないとね。', en: 'First you have to build up your vocabulary.' },
    { jp: '体を鍛えるのが好きなんです。', en: 'I like working out.' },
  ],
  '鎌': [
    { jp: '鎌倉に住んで１２年になる。', en: 'I have lived in Kamakura for twelve years.' },
    { jp: '鎌倉は源氏ゆかりの地です。', en: 'Kamakura is a place noted in connection with the Genji family.' },
  ],
  '鎖': [
    { jp: 'このソフトウエアはギブスサンプリングのアルゴリズムによりマルコフ連鎖モンテカルロ法の計算を行います。', en: 'This software carries out Markov Chain Monte Carlo calculations by the use of Gibbs Sampling.' },
    { jp: '5時半に閉鎖します。', en: 'It shuts at 5.30.' },
  ],
  '鎮': [
    { jp: '暴動は鎮圧された。', en: 'The riot was put down.' },
    { jp: '反乱は鎮圧された。', en: 'The revolt was crushed.' },
  ],
  '鏡': [
    { jp: '老眼鏡どこだっけ？', en: 'Where are my reading glasses?' },
    { jp: '私の眼鏡に何したの？', en: 'What\'ve you done with my glasses?' },
  ],
  '鐘': [
    { jp: '教会の鐘が鳴っている。', en: 'The church bells are ringing.' },
    { jp: '僕が学校に着いてすぐに鐘が鳴った。', en: 'I had hardly reached the school when the bell rang.' },
  ],
  '鑑': [
    { jp: 'DNA鑑定によって彼の無罪が証明された。', en: 'A DNA test showed he was innocent.' },
    { jp: '趣味は映画鑑賞です。', en: 'One of my hobbies is watching films.' },
  ],
  '閑': [
    { jp: 'ウチだって閑古鳥が鳴くようなカツカツの状態だから、バイトを雇う余裕なんてない。', en: 'We\'re in a slump, barely scraping by, so we certainly don\'t have the margin to take on a part-time worker.' },
    { jp: '閑さや岩に染み入る蝉の声', en: 'Quietness! The cicada song soaks into the rocks.' },
  ],
  '閣': [
    { jp: '京都は神社や仏閣で有名だ。', en: 'Kyoto is famous for its shrines and temples.' },
    { jp: '内閣が触れを回した。', en: 'The Cabinet sent round an official notice.' },
  ],
  '閥': [
    { jp: '２つの派閥が手をむすんだ。', en: 'The two factions gang up with each other.' },
  
    { jp: '閥は日本語の語彙の中に含まれる漢字だ。', en: '閥 is a kanji found in the Japanese vocabulary.' },
  ],
  '閲': [
    { jp: 'ジュネーブ大学の図書館には、いい閲覧室がある。', en: 'The Geneva University Library has a good reading room.' },
    { jp: '最初にTatoebaを検閲する国はどこかな。', en: 'I wonder which country will be the first to censor Tatoeba.' },
  ],
  '闘': [
    { jp: '「我が闘争」はアドルフ・ヒトラーの著書である。', en: '"Mein Kampf" is a book by Adolf Hitler.' },
    { jp: '最後まで闘います。', en: 'I will fight until the end.' },
  ],
  '阻': [
    { jp: '抗生物質は一般的に酵素の阻害剤である。', en: 'Antibiotics are commonly enzymatic inhibitors.' },
    { jp: '妊婦はたいてい、悪阻を経験する。', en: 'Pregnant women often experience morning sickness.' },
  ],
  '阿': [
    { jp: 'ここで中断したら元の木阿弥だぞっ。', en: 'If we stop here, we\'ll be right back where we started!' },
    { jp: '阿蘇山は活火山だ。', en: 'Mt. Aso is an active volcano.' },
  ],
  '附': [
    { jp: '小沢の顔を見て、耳の附根まで赧くなった。', en: 'When she saw Ozawa\'s face, she became red up to the base of her ears.' },
  
    { jp: '附は日本語の語彙の中に含まれる漢字だ。', en: '附 is a kanji found in the Japanese vocabulary.' },
  ],
  '陛': [
    { jp: '国王陛下が私達の市を訪れて下さったことを大変光栄に思います。', en: 'It\'s a great honor to have had the king visit our city.' },
  
    { jp: '陛は日本語の語彙の中に含まれる漢字だ。', en: '陛 is a kanji found in the Japanese vocabulary.' },
  ],
  '陣': [
    { jp: '報道陣の方ですね。', en: 'You\'re a reporter.' },
    { jp: '彼らは円陣を組んだ。', en: 'They formed themselves into a circle.' },
  ],
  '陥': [
    { jp: '彼は危篤に陥った。', en: 'He fell into critical condition.' },
    { jp: 'この携帯は欠陥品だ。', en: 'This phone is defective.' },
  ],
  '陪': [
    { jp: '陪審員は有罪の評決を出した。', en: 'The jury has returned a verdict of guilty.' },
  
    { jp: '陪は日本語の語彙の中に含まれる漢字だ。', en: '陪 is a kanji found in the Japanese vocabulary.' },
  ],
  '陰': [
    { jp: '木陰は涼しかった。', en: 'It was cool in the shade of the trees.' },
    { jp: '二人は物陰に隠れた。', en: 'The two hid from view.' },
  ],
  '陳': [
    { jp: '私はその陳述を真実と認める。', en: 'I accept the statement as true.' },
    { jp: '私は彼の陳述の正確さを疑い始めた。', en: 'I began to doubt the accuracy of his statement.' },
  ],
  '陶': [
    { jp: '東洋の陶器に興味があります。', en: 'I have an interest in oriental ceramics.' },
    { jp: 'とても高価な陶器がめちゃめちゃに割れてしまった。', en: 'The priceless china shattered into fragments.' },
  ],
  '隆': [
    { jp: '隆、もうお風呂に入った？', en: 'Have you taken a bath yet, Takashi?' },
    { jp: '法隆寺は世界最古の木造建築である。', en: 'The Horyuji is the oldest wooden building in the world.' },
  ],
  '隊': [
    { jp: '軍隊に入りたいんです。', en: 'I want to join the army.' },
    { jp: '軍隊がいっぱい来てる。', en: 'It\'s getting full of soldiers.' },
  ],
  '随': [
    { jp: '今朝は随分早いね。', en: 'You are very early this morning.' },
    { jp: '随分と怠慢な教師だな！', en: 'What a lazy teacher!' },
  ],
  '隔': [
    { jp: '海とこれを隔てるのは何ですか？', en: 'What is it that separates this from the sea?' },
    { jp: 'どれくらいの間隔で献血してるの？', en: 'How often do you give blood?' },
  ],
  '障': [
    { jp: 'ＡＴＭは故障中です。', en: 'The ATM is out of order.' },
    { jp: 'その車は故障した。', en: 'The car broke down.' },
  ],
  '隣': [
    { jp: '隣りの人が大嫌い。', en: 'I hate my neighbors.' },
    { jp: '彼は私の隣人です。', en: 'He is one of my neighbours.' },
  ],
  '隷': [
    { jp: '大統領は奴隷制度を廃止した。', en: 'The president abolished slavery.' },
    { jp: 'アメリカは1863年に奴隷制度を廃止した。', en: 'America did away with slavery in 1863.' },
  ],
  '隼': [
    { jp: '隼はとても速い鳥です。', en: 'The falcon is a very fast bird.' },
  
    { jp: '隼は日本語の語彙の中に含まれる漢字だ。', en: '隼 is a kanji found in the Japanese vocabulary.' },
  ],
  '雄': [
    { jp: '彼は英雄のつもりだ。', en: 'He believes that he is a hero.' },
    { jp: '私は英雄などではない。', en: 'I\'m not a hero.' },
  ],
  '雅': [
    { jp: '洋子はみんながびっくりするような優雅さで踊った。', en: 'Yoko danced with a grace that surprised us.' },
    { jp: '滞りのない、優雅な仕草でグラスに水を注ぎ込んだ。', en: 'She smoothly and elegantly poured the water into the glass.' },
  ],
  '雌': [
    { jp: 'ココは雌のゴリラである。', en: 'Koko is a female gorilla.' },
    { jp: '私は、雌猫を飼ってるよ。', en: 'I keep a female cat.' },
  ],
  '雛': [
    { jp: '彼女は雛菊を摘むのをやめた。', en: 'She stopped picking daisies.' },
    { jp: '日本では、３月３日は「桃の節句」と呼ばれ、女の子の成長と幸福を願う行事として、お雛様や桃の花などを飾ります。桃の花は、薄紅色のきれいな花です。花言葉は、「チャーミング」です。', en: 'In Japan, the 3rd of March is known as "Momo no Sekku". As an event which wishes upon the healthy development and happiness of young girls, Hina-dolls and peach flowers are used as decoration. Peach flowers are beautiful, light pink flowers, and symbolise "Charmingness".' },
  ],
  '離': [
    { jp: '踊りによってその食糧までの距離や方角を伝える。', en: 'They communicate the distance and direction of the food by dancing.' },
  
    { jp: '離は日本語の語彙の中に含まれる漢字だ。', en: '離 is a kanji found in the Japanese vocabulary.' },
  ],
  '雰': [
    { jp: '雰囲気を壊さないで。', en: 'Don\'t spoil the mood.' },
    { jp: 'ゆるい雰囲気の作品が好きです。', en: 'I like lighthearted works of art.' },
  ],
  '雷': [
    { jp: '僕、雷嫌いなんだよ！', en: 'I\'m scared of lightning!' },
    { jp: '雷鳴がとどろいた。', en: 'The thunder roared.' },
  ],
  '需': [
    { jp: '１９９８年の需要予測です。', en: 'Here is the demand forecast for 1998.' },
    { jp: '輸入車の需要は強い。', en: 'Imported cars are in strong demand.' },
  ],
  '霊': [
    { jp: '昨日の夜ね、僕ね、幽霊見たんだ。', en: 'I saw a ghost last night.' },
    { jp: '大晦日には悪霊がこの世に戻ってくると信じられていました。', en: 'It was believed that evil spirits would return to earth on the last day of the year.' },
  ],
  '霜': [
    { jp: 'ゆうべ霜が降りた。', en: 'It frosted last night.' },
    { jp: '道路に霜が降りています。', en: 'There is frost on the road.' },
  ],
  '霞': [
    { jp: '展望台から遠くの街が霞んで見える。', en: 'From the observation platform, you can just barely make out the town in the distance.' },
  
    { jp: '霞は日本語の語彙の中に含まれる漢字だ。', en: '霞 is a kanji found in the Japanese vocabulary.' },
  ],
  '霧': [
    { jp: '私達は霧の中で迷った。', en: 'We got lost in the fog.' },
    { jp: '朝霧が出ています。', en: 'There\'s morning fog.' },
  ],
  '露': [
    { jp: '露が草の葉におりている。', en: 'The dew is on the leaves of grass.' },
    { jp: '今朝は露が降りた。', en: 'The dew fell this morning.' },
  ],
  '靖': [
    { jp: '靖国神社参拝に関しては閣僚の自主的な判断に任せられている。', en: 'The question of worshipping at the Yasukuni Shrine is left to the independent judgement of Cabinet ministers.' },
    { jp: '小泉首相が「憲法違反だから靖国神社参拝しちゃいかんという人がいます」と語った。', en: 'Prime Minister Koizumi said, "There are people who say that, because it\'s unconstitutional, I should not pray at the Yasukuni Shrine".' },
  ],
  '韻': [
    { jp: '観客はコンサートの余韻に浸っていた。', en: 'The audience was immersed in an aftertaste of the concert.' },
    { jp: '英語には奇妙な音韻論と奇妙な正書法があります。', en: 'English has an odd phonology and an odd orthography.' },
  ],
  '響': [
    { jp: 'ロンドンの交響楽団のコンサートスケジュールを知りませんか。', en: 'Do you know the concert schedule of London Symphony Orchestra?' },
    { jp: 'これも温暖化の影響か？', en: 'Is this another effect of global warming?' },
  ],
  '項': [
    { jp: 'それが最優先事項です。', en: 'That\'s the number one priority.' },
    { jp: '１０項を参照して下さい。', en: 'Please refer to paragraph ten.' },
  ],
  '須': [
    { jp: 'この急須、どこで買ったの？', en: 'Where did you buy this teapot?' },
    { jp: 'キャリーバッグは旅行に必須。', en: 'A carry-on bag is essential for travel.' },
  ],
  '頑': [
    { jp: 'トムって頑張り屋だと思う。', en: 'I think Tom is hard-working.' },
    { jp: 'あなたは本当に頑張り屋さんだ。', en: 'You\'re really a hard worker.' },
  ],
  '頻': [
    { jp: 'どれくらいの頻度で柿って食べる？', en: 'How often do you eat persimmons?' },
    { jp: 'お酒を飲む頻度はどれくらいですか？', en: 'How often do you drink alcohol?' },
  ],
  '顕': [
    { jp: 'トムは顕微鏡が欲しい。', en: 'Tom wants a microscope.' },
    { jp: '彼は顕微鏡をのぞいていた。', en: 'He was looking through a microscope.' },
  ],
  '顧': [
    { jp: 'テクトロニクスの新ソフトウェアは、ロジック・アナライザを使う顧客のニーズにまさしく応えるものです。', en: 'Tektronix\'s new software perfectly responds to the needs of customers using logic analysers.' },
    { jp: '退かぬ，媚びぬ，顧みぬ！', en: 'I’ll never quit, never curry favor, and never look back!' },
  ],
  '颯': [
    { jp: '猫が颯爽と塀をよじ登った。', en: 'The cat climbed lightly over the wall.' },
  
    { jp: '颯は日本語の語彙の中に含まれる漢字だ。', en: '颯 is a kanji found in the Japanese vocabulary.' },
  ],
  '飢': [
    { jp: '避難民たちは飢えと闘った。', en: 'The refugees struggled against hunger.' },
    { jp: 'その男は飢えている。', en: 'The man is starving.' },
  ],
  '飼': [
    { jp: '新潟市の水族館で６月１８日、飼育員の誤りで飼育されていた魚約 7,000匹が大量死した。', en: 'On June 18 at the Niigata city aquarium, 7000 fish died because of a mistake by an employee.' },
    { jp: '次の兎の飼育当番は彼らです。', en: 'They are the next to be on duty for taking care of the rabbits.' },
  ],
  '飽': [
    { jp: 'ゲーム機の国内市場は飽和状態で、大きなヒットは期待できない。', en: 'Being that the domestic game market is saturated, one can\'t hope for a big hit.' },
    { jp: 'もう飽きちゃった。', en: 'I\'m already bored.' },
  ],
  '飾': [
    { jp: '彼女は壁を絵で飾った。', en: 'She decorated the wall with pictures.' },
    { jp: '飾らない君が大好きだよ。', en: 'I love you the way you are.' },
  ],
  '養': [
    { jp: 'トムは教養がない。', en: 'Tom is a philistine.' },
    { jp: 'トムは教養がある。', en: 'Tom is refined.' },
  ],
  '餓': [
    { jp: '彼らは餓死しそうだ。', en: 'They are on the border of starvation.' },
    { jp: '飢饉のために、家畜が餓死した。', en: 'Because of the famine, the cattle starved to death.' },
  ],
  '駄': [
    { jp: '無駄にする時間はない。', en: 'There is no time to lose.' },
    { jp: '時間の無駄だった。', en: 'It was a waste of time.' },
  ],
  '駆': [
    { jp: '彼は全速で駆けた。', en: 'He ran as fast as he could.' },
    { jp: '私は母に駆け寄った。', en: 'I ran to my mother.' },
  ],
  '駒': [
    { jp: '僕はボードの上の駒を一つ前に進めた。', en: 'I moved a chess piece on the board one forward.' },
    { jp: '日本の将棋には何種類の駒がありますか。', en: 'How many different pieces are there in Japanese chess?' },
  ],
  '駿': [
    { jp: '「風立ちぬ」は宮崎駿の最後の映画です。', en: '"The Wind Rises" is Hayao Miyazaki\'s last film.' },
  
    { jp: '駿は日本語の語彙の中に含まれる漢字だ。', en: '駿 is a kanji found in the Japanese vocabulary.' },
  ],
  '騎': [
    { jp: '馬上の騎士をみてごらん。', en: 'Look at that knight on the horse.' },
    { jp: '騎士が王への忠誠を誓った。', en: 'The knight swore an oath of allegiance to the king.' },
  ],
  '騒': [
    { jp: 'ちょっと腹の虫が騒ぎ始めたかな。', en: 'I\'m feeling a bit peckish.' },
    { jp: '「唇が割れてるけど、どうしたの？」「弟と一緒にばか騒ぎしてて、口を蹴られちゃったんだ」', en: '"How did you split your lip?" "My brother and I were horseplaying, and he ended up kicking me in the mouth."' },
  ],
  '騰': [
    { jp: '物価が高騰しています。', en: 'Prices are soaring.' },
    { jp: '水は100℃で沸騰します。', en: 'Water boils at 212°F.' },
  ],
  '驚': [
    { jp: 'その質問は少し吃驚した。', en: 'I was a little surprised at the question.' },
    { jp: 'おばあちゃんが突然死んで家族一同驚いた。', en: 'The family was shook up when the grandmother died unexpectedly.' },
  ],
  '髄': [
    { jp: '彼は骨の髄まで日本人だ。', en: 'He is Japanese to the bone.' },
    { jp: '彼は骨の髄まで腐りきっている。', en: 'He is rotten to the core.' },
  ],
  '鬼': [
    { jp: '鬼ごっこがしたい？', en: 'Do you want to play tag?' },
    { jp: '吸血鬼って信じてる？', en: 'Do you believe in vampires?' },
  ],
  '魂': [
    { jp: '三つ子の魂百まで。', en: 'The child is father to the man.' },
    { jp: 'ペンは魂の舌である。', en: 'The pen is the tongue of the soul.' },
  ],
  '魅': [
    { jp: '彼女は魅力的な女性だ。', en: 'She is a charming woman.' },
    { jp: '佐渡さんは魅力的な個性の持ち主なのに、その価値が分からず、自分を好まない。', en: 'Even though Sato has a nice personality, he doesn\'t know its value and doesn\'t like himself.' },
  ],
  '鮎': [
    { jp: '鮎漁が解禁になった。', en: 'The ayu season has opened.' },
    { jp: '鮎の美味しい季節になりました。', en: 'It\'s delicious sweetfish season.' },
  ],
  '鮮': [
    { jp: '今日のトピックは「北朝鮮による日本人拉致問題」です。', en: 'Today\'s topic is "the problem of Japanese people abducted by North Korea".' },
    { jp: '北朝鮮が６か国協議の合意に基づき核開発計画を申告した２６日、米国が「テロ支援国」の指定解除手続きに入ったことで、拉致被害者の家族らには「拉致問題が置き去りにされるのでは」という不安が広がった。', en: 'With North Korea\'s announcement on the 26th of its nuclear development plan based upon the agreement stemming from the Six Party Talks, and the United States\' commencement of procedures to remove North Korea from its designation on the list of State Sponsors of Terrorism, the families of abductees have expressed growing unease that it may constitute an abandonment of the abductee issue.' },
  ],
  '鯉': [
    { jp: '鯉は網で捕まえたんだ。', en: 'I caught a carp in a net.' },
    { jp: '鯉は、私が一番好きな魚だよ。', en: 'Carp is my favorite fish.' },
  ],
  '鯛': [
    { jp: '鯛も一人はうまからず。', en: 'Good food requires good company.' },
    { jp: 'お兄ちゃん、このお魚本当に美味しいの？黒鯛が極道に落ちて、全国指名手配されたみたいなお魚だよ？', en: 'Hey, is this fish tasty for real? It looks like a black porgy who\'d fallen in with mobsters and been put on the country\'s most wanted list!?' },
  ],
  '鯨': [
    { jp: '鯨は魚と形が似ている。', en: 'Whales are similar to fishes in shape.' },
    { jp: '鯨は哺乳類である。', en: 'A whale is a mammal.' },
  ],
  '鳩': [
    { jp: '鳩は飛んでいった。', en: 'The pigeon has flown away.' },
    { jp: '鳩は平和の象徴です。', en: 'The dove is a symbol of peace.' },
  ],
  '鶏': [
    { jp: '鶏肉で、何が作れる？', en: 'What can you make with chicken?' },
    { jp: '彼女は鶏を買った。', en: 'She bought a chicken.' },
  ],
  '鶴': [
    { jp: '長女は千鶴って名前よ。', en: 'My oldest daughter\'s name is Chizuru.' },
    { jp: 'トムは折り鶴を折った。', en: 'Tom folded an origami crane.' },
  ],
  '鷹': [
    { jp: '能ある鷹は爪を隠す。', en: 'A smart falcon hides its talons.' },
    { jp: '鵜の目鷹の目で探していたよ。', en: 'He was looking for it like a hunting dog.' },
  ],
  '鹿': [
    { jp: '鹿児島県の県庁所在地は鹿児島市です。', en: 'Kagoshima Prefecture\'s capital is Kagoshima City.' },
  
    { jp: '鹿児島について詳しく学んだことがある。', en: 'I have learned about 鹿児島 in detail.' },
  ],
  '麗': [
    { jp: 'あの城は麗しいです。', en: 'That castle is beautiful.' },
    { jp: '母はベッドに綺麗なシーツを敷いた。', en: 'My mother put clean sheets on the bed.' },
  ],
  '麟': [
    { jp: '麒麟はどこにいますか。', en: 'Where are the giraffes?' },
    { jp: '王を得た麒麟もまた寿命を持たない生き物だが、この病ばかりは治癒の方法がない。', en: 'A qilin with a king too has no limit on its lifespan, but this illness alone admits of no remedy.' },
  ],
  '麻': [
    { jp: '麻薬をやってるの？', en: 'Are you on dope?' },
    { jp: '彼ね、麻薬してるの。', en: 'He does drugs.' },
  ],
  '黙': [
    { jp: '短い沈黙があった。', en: 'There was a short silence.' },
    { jp: '再び沈黙があった。', en: 'There was another silence.' },
  ],
  '鼓': [
    { jp: '太鼓の音が聞こえる。', en: 'I hear the drum.' },
    { jp: '太鼓判を押してくれた。', en: 'He gave me his stamp of approval.' },
  ],

  // ── Manual additions — N4/N3/N2 gaps ─────────────────────────────────────
  // ── N4 ──
  '図': [
    { jp: '地図を見て道を確かめました。', en: 'I checked the route on the map.' },
    { jp: '図書館で本をかりました。', en: 'I borrowed a book from the library.' },
  ],
  '止': [
    { jp: 'バスが止まりました。', en: 'The bus stopped.' },
    { jp: '雨がやんだので出かけます。', en: "The rain stopped, so I'll go out." },
  ],
  '楽': [
    { jp: '音楽を聞くのが好きです。', en: 'I like listening to music.' },
    { jp: '楽しい週末でした。', en: 'It was a fun weekend.' },
  ],
  '画': [
    { jp: '映画を見にいきませんか。', en: "Shall we go see a movie?" },
    { jp: '計画どおりにすすみました。', en: 'It went according to plan.' },
  ],
  '者': [
    { jp: '医者にいってきました。', en: 'I went to the doctor.' },
    { jp: '若者が多い町です。', en: 'It is a town with many young people.' },
  ],
  '転': [
    { jp: '自転車で学校にいきます。', en: 'I go to school by bicycle.' },
    { jp: '転んでひざをけがしました。', en: 'I fell and hurt my knee.' },
  ],
  '野': [
    { jp: '野菜をたくさんたべます。', en: 'I eat a lot of vegetables.' },
    { jp: '野球が大好きです。', en: 'I love baseball.' },
  ],
  '運': [
    { jp: '毎朝公園で運動します。', en: 'I exercise in the park every morning.' },
    { jp: '運がよかったです。', en: 'I was lucky.' },
  ],
  '不': [
    { jp: '今日は不思議な天気ですね。', en: "The weather is strange today, isn't it?" },
    { jp: '不便な場所に住んでいます。', en: 'I live in an inconvenient place.' },
  ],
  '地': [
    { jp: '地図を見て道を調べました。', en: 'I checked the route on the map.' },
    { jp: '地球は太陽のまわりをまわっています。', en: 'The Earth revolves around the Sun.' },
  ],
  '早': [
    { jp: '早起きは三文の得です。', en: 'The early bird catches the worm.' },
    { jp: 'もっと早く起きてください。', en: 'Please get up earlier.' },
  ],
  '理': [
    { jp: '理由を教えてください。', en: 'Please tell me the reason.' },
    { jp: '料理が上手ですね。', en: "You are good at cooking, aren't you?" },
  ],
  '空': [
    { jp: '空が青くて気持ちいいですね。', en: "The sky is blue and it feels great, doesn't it?" },
    { jp: '空港まで迎えに来てください。', en: 'Please come to pick me up at the airport.' },
  ],
  '立': [
    { jp: 'ここに立っていてください。', en: 'Please stand here.' },
    { jp: '国立博物館に行きたいです。', en: 'I want to go to the national museum.' },
  ],
  // ── N3 ──
  '予': [
    { jp: 'レストランを予約しました。', en: 'I made a restaurant reservation.' },
    { jp: '今日の予定を教えてください。', en: 'Please tell me your plans for today.' },
  ],
  '伝': [
    { jp: 'メッセージを伝えてもらえますか。', en: 'Could you pass on my message?' },
    { jp: '日本の伝統文化を学んでいます。', en: 'I am studying traditional Japanese culture.' },
  ],
  '任': [
    { jp: '大事な仕事を任されました。', en: 'I was entrusted with an important task.' },
    { jp: '責任をもってやります。', en: "I'll do it responsibly." },
  ],
  '助': [
    { jp: '助けてください。', en: 'Please help me.' },
    { jp: '友だちに助けてもらいました。', en: 'A friend helped me out.' },
  ],
  '危': [
    { jp: 'そこは危ないので気をつけて。', en: 'That place is dangerous so be careful.' },
    { jp: '危険なので近づかないでください。', en: "It's dangerous, so please don't come near." },
  ],
  '反': [
    { jp: 'その意見には反対です。', en: 'I am against that opinion.' },
    { jp: '反省しています。', en: 'I am reflecting on my mistake.' },
  ],
  '合': [
    { jp: '待ち合わせは駅にしましょう。', en: "Let's meet up at the station." },
    { jp: 'みんなが力を合わせました。', en: 'Everyone joined forces together.' },
  ],
  '声': [
    { jp: '声がきれいですね。', en: 'You have a beautiful voice.' },
    { jp: '大きな声で話してください。', en: 'Please speak in a loud voice.' },
  ],
  '好': [
    { jp: '音楽が好きです。', en: 'I like music.' },
    { jp: '好きな食べ物は何ですか。', en: 'What food do you like?' },
  ],
  '寒': [
    { jp: '今日は寒いですね。', en: "It's cold today, isn't it." },
    { jp: '寒くなったので上着を着ます。', en: "It got cold so I'll put on a jacket." },
  ],
  '幸': [
    { jp: '幸せそうですね。', en: 'You seem happy.' },
    { jp: '幸いにもけがはありませんでした。', en: 'Fortunately there were no injuries.' },
  ],
  '念': [
    { jp: '念のため確認しておきます。', en: "I'll confirm just to be safe." },
    { jp: '残念ながら今日は行けません。', en: "Unfortunately I can't go today." },
  ],
  '忘': [
    { jp: 'かさを忘れてしまいました。', en: 'I forgot my umbrella.' },
    { jp: '忘れないようにメモします。', en: "I'll make a note so I don't forget." },
  ],
  '性': [
    { jp: '性格がいい人です。', en: 'She is a good-natured person.' },
    { jp: '可能性はあります。', en: "There's a possibility." },
  ],
  '戦': [
    { jp: '試合でよく戦いました。', en: 'I competed well in the match.' },
    { jp: '戦争は悲しいことです。', en: 'War is a sad thing.' },
  ],
  '成': [
    { jp: '努力して成功しました。', en: 'I succeeded through hard work.' },
    { jp: 'チームが成長しています。', en: 'The team is growing.' },
  ],
  '投': [
    { jp: 'ボールを投げてください。', en: 'Please throw the ball.' },
    { jp: '投票は大切です。', en: 'Voting is important.' },
  ],
  '指': [
    { jp: '指がいたいです。', en: 'My finger hurts.' },
    { jp: '先生が黒板を指しました。', en: 'The teacher pointed to the blackboard.' },
  ],
  '放': [
    { jp: '放課後に遊びに行きます。', en: "I'll go play after school." },
    { jp: 'ラジオで放送しています。', en: 'It is broadcasting on the radio.' },
  ],
  '曲': [
    { jp: 'この曲がとても好きです。', en: 'I really like this song.' },
    { jp: 'ピアノで新しい曲を練習しています。', en: 'I am practicing a new piece on the piano.' },
  ],
  '最': [
    { jp: '最近どうですか。', en: 'How have you been lately?' },
    { jp: 'これが最高の思い出です。', en: 'This is my best memory.' },
  ],
  '構': [
    { jp: '大丈夫ですよ、構いません。', en: "It's okay, I don't mind." },
    { jp: '建物の構造が複雑です。', en: 'The structure of the building is complex.' },
  ],
  '様': [
    { jp: 'お客様をおもてなしします。', en: 'I will welcome the guests.' },
    { jp: 'どのようにしましたか。', en: 'How did you do it?' },
  ],
  '次': [
    { jp: '次の電車は何時ですか。', en: 'What time is the next train?' },
    { jp: '次はあなたの番です。', en: 'Next is your turn.' },
  ],
  '機': [
    { jp: '洗濯機がこわれました。', en: 'The washing machine broke.' },
    { jp: '機会があればぜひ来てください。', en: 'Please come if you have the opportunity.' },
  ],
  '法': [
    { jp: '使い方の法則をおぼえました。', en: 'I memorized the rule of how to use it.' },
    { jp: '法律を守ることが大切です。', en: 'It is important to follow the law.' },
  ],
  '消': [
    { jp: '電気を消してください。', en: 'Please turn off the light.' },
    { jp: '火を消しました。', en: 'I put out the fire.' },
  ],
  '煙': [
    { jp: 'たばこの煙が苦手です。', en: 'I dislike cigarette smoke.' },
    { jp: '煙突から煙が出ています。', en: 'Smoke is coming out of the chimney.' },
  ],
  '熱': [
    { jp: '熱があるので学校を休みます。', en: "I have a fever so I'll stay home from school." },
    { jp: '熱いので気をつけてください。', en: "It's hot so please be careful." },
  ],
  '約': [
    { jp: '約束を守ります。', en: "I'll keep my promise." },
    { jp: '約10分でつきます。', en: "I'll arrive in about 10 minutes." },
  ],
  '美': [
    { jp: 'この景色はとても美しいです。', en: 'This scenery is very beautiful.' },
    { jp: '美術館にいきたいです。', en: 'I want to go to the art museum.' },
  ],
  '説': [
    { jp: 'もう少し説明してもらえますか。', en: 'Could you explain it a little more?' },
    { jp: '小説を読むのが好きです。', en: 'I like reading novels.' },
  ],
  '警': [
    { jp: '警察を呼びましょう。', en: "Let's call the police." },
    { jp: '警告を無視しないでください。', en: 'Please do not ignore the warning.' },
  ],
  '議': [
    { jp: '今日は会議があります。', en: "There's a meeting today." },
    { jp: 'みんなで議論しましょう。', en: "Let's discuss together." },
  ],
  '退': [
    { jp: '病院を退院しました。', en: 'I was discharged from the hospital.' },
    { jp: '退屈な時間がありました。', en: 'I had some boring time.' },
  ],
  '達': [
    { jp: '友達とランチをしました。', en: 'I had lunch with a friend.' },
    { jp: '目標を達成することができました。', en: 'I was able to achieve my goal.' },
  ],
  '遠': [
    { jp: '学校まで遠いです。', en: 'It is far to school.' },
    { jp: '遠くから来てくれてありがとう。', en: 'Thank you for coming from far away.' },
  ],
  '部': [
    { jp: '部活はサッカー部です。', en: 'My club activity is soccer club.' },
    { jp: 'この部分が難しいです。', en: 'This part is difficult.' },
  ],
  '乗': [
    { jp: 'バスに乗りましょう。', en: "Let's get on the bus." },
    { jp: '乗り物酔いがひどいんです。', en: 'I get really motion sick.' },
  ],
  '夫': [
    { jp: '夫はいつも残業しています。', en: 'My husband always works overtime.' },
    { jp: '夫婦で旅行に行きました。', en: 'We went on a trip as a couple.' },
  ],
  '実': [
    { jp: '実は、昨日から風邪を引いています。', en: 'Actually, I have had a cold since yesterday.' },
    { jp: '実用的なプレゼントが好きです。', en: 'I like practical gifts.' },
  ],
  '歯': [
    { jp: '歯を磨くのを忘れないでください。', en: "Don't forget to brush your teeth." },
    { jp: '歯が痛くて眠れません。', en: "I can't sleep because of a toothache." },
  ],
  '深': [
    { jp: '深呼吸してみてください。', en: 'Please try to take a deep breath.' },
    { jp: 'この川はとても深いです。', en: 'This river is very deep.' },
  ],
  // ── N2 ──
  '燃': [
    { jp: 'ゴミを燃やしてはいけません。', en: 'You must not burn garbage.' },
    { jp: '燃料が足りないので補充します。', en: "The fuel is low so I'll refill it." },
  ],
  '短': [
    { jp: 'この鉛筆は短くなりました。', en: 'This pencil has gotten short.' },
    { jp: '短所と長所をおしえてください。', en: 'Please tell me your weaknesses and strengths.' },
  ],
  '禁': [
    { jp: 'ここは禁煙です。', en: 'This is a no-smoking area.' },
    { jp: '飲酒運転は禁止されています。', en: 'Drunk driving is prohibited.' },
  ],
  '細': [
    { jp: '細かいことは気にしないでください。', en: "Please don't worry about the details." },
    { jp: '細い路地を通りました。', en: 'I went through a narrow alley.' },
  ],
  '血': [
    { jp: '血が出ているので手当てします。', en: 'Blood is coming out so I will treat it.' },
    { jp: '血液検査をしました。', en: 'I had a blood test.' },
  ],
  '辛': [
    { jp: 'この料理はとても辛いです。', en: 'This dish is very spicy.' },
    { jp: '辛抱強く待つことが大切です。', en: 'It is important to wait patiently.' },
  ],
  '鼻': [
    { jp: '花粉症で鼻水が止まりません。', en: "My runny nose won't stop because of hay fever." },
    { jp: '鼻がつまって息がしにくいです。', en: 'My nose is stuffy and it is hard to breathe.' },
  ],
  '賢': [
    { jp: '賢い選択をしてください。', en: 'Please make a wise choice.' },
    { jp: '彼女は本当に賢い人です。', en: 'She is truly a wise person.' },
  ],

  // ── N1 gap fill (offline templates + manual) ──
  '丑': [
    { jp: '丑という漢字には深い意味がある。', en: 'The kanji 丑 carries a deep meaning.' },
    { jp: '丑は日本語の語彙の中に含まれる漢字だ。', en: '丑 is a kanji found in the Japanese vocabulary.' },
  ],
  '且': [
    { jp: 'なお且つという言葉を覚えておくと役に立つ。', en: 'Remembering the word なお且つ will come in handy.' },
    { jp: '且つは日本語で重要な言葉の一つだと思う。', en: 'I think 且つ is one of the important words in Japanese.' },
  ],
  '丙': [
    { jp: '丙という漢字には深い意味がある。', en: 'The kanji 丙 carries a deep meaning.' },
    { jp: '丙は日本語の語彙の中に含まれる漢字だ。', en: '丙 is a kanji found in the Japanese vocabulary.' },
  ],
  '丞': [
    { jp: '丞という漢字には深い意味がある。', en: 'The kanji 丞 carries a deep meaning.' },
    { jp: '丞は日本語の語彙の中に含まれる漢字だ。', en: '丞 is a kanji found in the Japanese vocabulary.' },
  ],
  '之': [
    { jp: '之という漢字には深い意味がある。', en: 'The kanji 之 carries a deep meaning.' },
    { jp: '之は日本語の語彙の中に含まれる漢字だ。', en: '之 is a kanji found in the Japanese vocabulary.' },
  ],
  '亘': [
    { jp: '亘という漢字には深い意味がある。', en: 'The kanji 亘 carries a deep meaning.' },
    { jp: '亘は日本語の語彙の中に含まれる漢字だ。', en: '亘 is a kanji found in the Japanese vocabulary.' },
  ],
  '亦': [
    { jp: '亦という漢字には深い意味がある。', en: 'The kanji 亦 carries a deep meaning.' },
    { jp: '亦は日本語の語彙の中に含まれる漢字だ。', en: '亦 is a kanji found in the Japanese vocabulary.' },
  ],
  '亮': [
    { jp: '亮という漢字には深い意味がある。', en: 'The kanji 亮 carries a deep meaning.' },
    { jp: '亮は日本語の語彙の中に含まれる漢字だ。', en: '亮 is a kanji found in the Japanese vocabulary.' },
  ],
  '伶': [
    { jp: '伶という漢字には深い意味がある。', en: 'The kanji 伶 carries a deep meaning.' },
    { jp: '伶は日本語の語彙の中に含まれる漢字だ。', en: '伶 is a kanji found in the Japanese vocabulary.' },
  ],
  '伽': [
    { jp: '伽という漢字には深い意味がある。', en: 'The kanji 伽 carries a deep meaning.' },
    { jp: '伽は日本語の語彙の中に含まれる漢字だ。', en: '伽 is a kanji found in the Japanese vocabulary.' },
  ],
  '但': [
    { jp: '但という漢字には深い意味がある。', en: 'The kanji 但 carries a deep meaning.' },
    { jp: '但は日本語の語彙の中に含まれる漢字だ。', en: '但 is a kanji found in the Japanese vocabulary.' },
  ],
  '佑': [
    { jp: '佑という漢字には深い意味がある。', en: 'The kanji 佑 carries a deep meaning.' },
    { jp: '佑は日本語の語彙の中に含まれる漢字だ。', en: '佑 is a kanji found in the Japanese vocabulary.' },
  ],
  '侃': [
    { jp: '侃という漢字には深い意味がある。', en: 'The kanji 侃 carries a deep meaning.' },
    { jp: '侃は日本語の語彙の中に含まれる漢字だ。', en: '侃 is a kanji found in the Japanese vocabulary.' },
  ],
  '侑': [
    { jp: '侑という漢字には深い意味がある。', en: 'The kanji 侑 carries a deep meaning.' },
    { jp: '侑は日本語の語彙の中に含まれる漢字だ。', en: '侑 is a kanji found in the Japanese vocabulary.' },
  ],
  '価': [
    { jp: '価という漢字には深い意味がある。', en: 'The kanji 価 carries a deep meaning.' },
    { jp: '価は日本語の語彙の中に含まれる漢字だ。', en: '価 is a kanji found in the Japanese vocabulary.' },
  ],
  '侯': [
    { jp: '侯という漢字には深い意味がある。', en: 'The kanji 侯 carries a deep meaning.' },
    { jp: '侯は日本語の語彙の中に含まれる漢字だ。', en: '侯 is a kanji found in the Japanese vocabulary.' },
  ],
  '倖': [
    { jp: '倖という漢字には深い意味がある。', en: 'The kanji 倖 carries a deep meaning.' },
    { jp: '倖は日本語の語彙の中に含まれる漢字だ。', en: '倖 is a kanji found in the Japanese vocabulary.' },
  ],
  '倭': [
    { jp: '倭という漢字には深い意味がある。', en: 'The kanji 倭 carries a deep meaning.' },
    { jp: '倭は日本語の語彙の中に含まれる漢字だ。', en: '倭 is a kanji found in the Japanese vocabulary.' },
  ],
  '傘': [
    { jp: '傘という漢字には深い意味がある。', en: 'The kanji 傘 carries a deep meaning.' },
    { jp: '傘は日本語の語彙の中に含まれる漢字だ。', en: '傘 is a kanji found in the Japanese vocabulary.' },
  ],
  '儒': [
    { jp: '儒教（じゅきょう）という言葉は「Confucianism」を意味する。', en: 'The word 儒教 (じゅきょう) means "Confucianism".' },
    { jp: '儒学について詳しく学んだことがある。', en: 'I have learned about 儒学 in detail.' },
  ],
  '允': [
    { jp: '允という漢字には深い意味がある。', en: 'The kanji 允 carries a deep meaning.' },
    { jp: '允は日本語の語彙の中に含まれる漢字だ。', en: '允 is a kanji found in the Japanese vocabulary.' },
  ],
  '准': [
    { jp: '准という漢字には深い意味がある。', en: 'The kanji 准 carries a deep meaning.' },
    { jp: '准は日本語の語彙の中に含まれる漢字だ。', en: '准 is a kanji found in the Japanese vocabulary.' },
  ],
  '凜': [
    { jp: '凜という漢字には深い意味がある。', en: 'The kanji 凜 carries a deep meaning.' },
    { jp: '凜は日本語の語彙の中に含まれる漢字だ。', en: '凜 is a kanji found in the Japanese vocabulary.' },
  ],
  '凪': [
    { jp: '凪という漢字には深い意味がある。', en: 'The kanji 凪 carries a deep meaning.' },
    { jp: '凪は日本語の語彙の中に含まれる漢字だ。', en: '凪 is a kanji found in the Japanese vocabulary.' },
  ],
  '剛': [
    { jp: '剛という漢字には深い意味がある。', en: 'The kanji 剛 carries a deep meaning.' },
    { jp: '剛は日本語の語彙の中に含まれる漢字だ。', en: '剛 is a kanji found in the Japanese vocabulary.' },
  ],
  '劾': [
    { jp: '劾という漢字には深い意味がある。', en: 'The kanji 劾 carries a deep meaning.' },
    { jp: '劾は日本語の語彙の中に含まれる漢字だ。', en: '劾 is a kanji found in the Japanese vocabulary.' },
  ],
  '勁': [
    { jp: '勁という漢字には深い意味がある。', en: 'The kanji 勁 carries a deep meaning.' },
    { jp: '勁は日本語の語彙の中に含まれる漢字だ。', en: '勁 is a kanji found in the Japanese vocabulary.' },
  ],
  '勅': [
    { jp: '勅令（ちょくれい）という言葉は「imperial edict, imperial decree」を意味する。', en: 'The word 勅令 (ちょくれい) means "imperial edict, imperial decree".' },
    { jp: '勅語について詳しく学んだことがある。', en: 'I have learned about 勅語 in detail.' },
  ],
  '勺': [
    { jp: '勺という漢字には深い意味がある。', en: 'The kanji 勺 carries a deep meaning.' },
    { jp: '勺は日本語の語彙の中に含まれる漢字だ。', en: '勺 is a kanji found in the Japanese vocabulary.' },
  ],
  '匁': [
    { jp: '匁という漢字には深い意味がある。', en: 'The kanji 匁 carries a deep meaning.' },
    { jp: '匁は日本語の語彙の中に含まれる漢字だ。', en: '匁 is a kanji found in the Japanese vocabulary.' },
  ],
  '匡': [
    { jp: '匡という漢字には深い意味がある。', en: 'The kanji 匡 carries a deep meaning.' },
    { jp: '匡は日本語の語彙の中に含まれる漢字だ。', en: '匡 is a kanji found in the Japanese vocabulary.' },
  ],
  '升': [
    { jp: '升はよく知られた日本語の表現の一つだ。', en: '升 is one of the well-known Japanese expressions.' },
    { jp: '一升という表現を日常会話で使うことがある。', en: 'The expression 一升 is sometimes used in daily conversation.' },
  ],
  '卯': [
    { jp: '卯という漢字には深い意味がある。', en: 'The kanji 卯 carries a deep meaning.' },
    { jp: '卯は日本語の語彙の中に含まれる漢字だ。', en: '卯 is a kanji found in the Japanese vocabulary.' },
  ],
  '厘': [
    { jp: '厘という漢字には深い意味がある。', en: 'The kanji 厘 carries a deep meaning.' },
    { jp: '厘は日本語の語彙の中に含まれる漢字だ。', en: '厘 is a kanji found in the Japanese vocabulary.' },
  ],
  '叡': [
    { jp: '叡智という言葉を覚えておくと役に立つ。', en: 'Remembering the word 叡智 will come in handy.' },
    { jp: '叡覧は日本語で重要な言葉の一つだと思う。', en: 'I think 叡覧 is one of the important words in Japanese.' },
  ],
  '哉': [
    { jp: '哉という漢字には深い意味がある。', en: 'The kanji 哉 carries a deep meaning.' },
    { jp: '哉は日本語の語彙の中に含まれる漢字だ。', en: '哉 is a kanji found in the Japanese vocabulary.' },
  ],
  '喬': [
    { jp: '喬という漢字には深い意味がある。', en: 'The kanji 喬 carries a deep meaning.' },
    { jp: '喬は日本語の語彙の中に含まれる漢字だ。', en: '喬 is a kanji found in the Japanese vocabulary.' },
  ],
  '嗣': [
    { jp: '嗣という漢字には深い意味がある。', en: 'The kanji 嗣 carries a deep meaning.' },
    { jp: '嗣は日本語の語彙の中に含まれる漢字だ。', en: '嗣 is a kanji found in the Japanese vocabulary.' },
  ],
  '嘉': [
    { jp: '嘉という漢字には深い意味がある。', en: 'The kanji 嘉 carries a deep meaning.' },
    { jp: '嘉は日本語の語彙の中に含まれる漢字だ。', en: '嘉 is a kanji found in the Japanese vocabulary.' },
  ],
  '嘱': [
    { jp: '嘱託（しょくたく）という言葉は「commission, entrust, part-time worker」を意味する。', en: 'The word 嘱託 (しょくたく) means "commission, entrust, part-time worker".' },
    { jp: '嘱望について詳しく学んだことがある。', en: 'I have learned about 嘱望 in detail.' },
  ],
  '坑': [
    { jp: '炭坑（たんこう）という言葉は「coal mine」を意味する。', en: 'The word 炭坑 (たんこう) means "coal mine".' },
    { jp: '坑道について詳しく学んだことがある。', en: 'I have learned about 坑道 in detail.' },
  ],
  '堀': [
    { jp: '堀という漢字には深い意味がある。', en: 'The kanji 堀 carries a deep meaning.' },
    { jp: '堀は日本語の語彙の中に含まれる漢字だ。', en: '堀 is a kanji found in the Japanese vocabulary.' },
  ],
  '墾': [
    { jp: '墾という漢字には深い意味がある。', en: 'The kanji 墾 carries a deep meaning.' },
    { jp: '墾は日本語の語彙の中に含まれる漢字だ。', en: '墾 is a kanji found in the Japanese vocabulary.' },
  ],
  '士': [
    { jp: '士という漢字には深い意味がある。', en: 'The kanji 士 carries a deep meaning.' },
    { jp: '士は日本語の語彙の中に含まれる漢字だ。', en: '士 is a kanji found in the Japanese vocabulary.' },
  ],
  '奎': [
    { jp: '奎という漢字には深い意味がある。', en: 'The kanji 奎 carries a deep meaning.' },
    { jp: '奎は日本語の語彙の中に含まれる漢字だ。', en: '奎 is a kanji found in the Japanese vocabulary.' },
  ],
  '嫡': [
    { jp: '嫡という漢字には深い意味がある。', en: 'The kanji 嫡 carries a deep meaning.' },
    { jp: '嫡は日本語の語彙の中に含まれる漢字だ。', en: '嫡 is a kanji found in the Japanese vocabulary.' },
  ],
  '孟': [
    { jp: '孟という漢字には深い意味がある。', en: 'The kanji 孟 carries a deep meaning.' },
    { jp: '孟は日本語の語彙の中に含まれる漢字だ。', en: '孟 is a kanji found in the Japanese vocabulary.' },
  ],
  '尉': [
    { jp: '尉という漢字には深い意味がある。', en: 'The kanji 尉 carries a deep meaning.' },
    { jp: '尉は日本語の語彙の中に含まれる漢字だ。', en: '尉 is a kanji found in the Japanese vocabulary.' },
  ],
  '尭': [
    { jp: '尭という漢字には深い意味がある。', en: 'The kanji 尭 carries a deep meaning.' },
    { jp: '尭は日本語の語彙の中に含まれる漢字だ。', en: '尭 is a kanji found in the Japanese vocabulary.' },
  ],
  '尼': [
    { jp: '尼という漢字には深い意味がある。', en: 'The kanji 尼 carries a deep meaning.' },
    { jp: '尼は日本語の語彙の中に含まれる漢字だ。', en: '尼 is a kanji found in the Japanese vocabulary.' },
  ],
  '屯': [
    { jp: '屯という漢字には深い意味がある。', en: 'The kanji 屯 carries a deep meaning.' },
    { jp: '屯は日本語の語彙の中に含まれる漢字だ。', en: '屯 is a kanji found in the Japanese vocabulary.' },
  ],
  '崚': [
    { jp: '崚々たる山々が朝日に輝いていた。', en: 'The towering mountains shone in the morning sun.' },
    { jp: '険しい崚峰を登るのは容易ではない。', en: 'Climbing the rugged, lofty peaks is no easy feat.' },
  ],
  '巌': [
    { jp: '巌という漢字には深い意味がある。', en: 'The kanji 巌 carries a deep meaning.' },
    { jp: '巌は日本語の語彙の中に含まれる漢字だ。', en: '巌 is a kanji found in the Japanese vocabulary.' },
  ],
  '巽': [
    { jp: '巽という漢字には深い意味がある。', en: 'The kanji 巽 carries a deep meaning.' },
    { jp: '巽は日本語の語彙の中に含まれる漢字だ。', en: '巽 is a kanji found in the Japanese vocabulary.' },
  ],
  '帥': [
    { jp: '帥という漢字には深い意味がある。', en: 'The kanji 帥 carries a deep meaning.' },
    { jp: '帥は日本語の語彙の中に含まれる漢字だ。', en: '帥 is a kanji found in the Japanese vocabulary.' },
  ],
  '庄': [
    { jp: '庄という漢字には深い意味がある。', en: 'The kanji 庄 carries a deep meaning.' },
    { jp: '庄は日本語の語彙の中に含まれる漢字だ。', en: '庄 is a kanji found in the Japanese vocabulary.' },
  ],
  '弐': [
    { jp: '弐という漢字には深い意味がある。', en: 'The kanji 弐 carries a deep meaning.' },
    { jp: '弐は日本語の語彙の中に含まれる漢字だ。', en: '弐 is a kanji found in the Japanese vocabulary.' },
  ],
  '弔': [
    { jp: '弔という漢字には深い意味がある。', en: 'The kanji 弔 carries a deep meaning.' },
    { jp: '弔は日本語の語彙の中に含まれる漢字だ。', en: '弔 is a kanji found in the Japanese vocabulary.' },
  ],
  '彪': [
    { jp: '彪炳たる業績を後世に残した人物だ。', en: 'He was a figure who left distinguished achievements for posterity.' },
    { jp: '彪は虎の模様や勇猛さを表す漢字だ。', en: 'Hyō is a kanji expressing tiger stripes and bravery.' },
  ],
  '彬': [
    { jp: '彬という漢字には深い意味がある。', en: 'The kanji 彬 carries a deep meaning.' },
    { jp: '彬は日本語の語彙の中に含まれる漢字だ。', en: '彬 is a kanji found in the Japanese vocabulary.' },
  ],
  '怜': [
    { jp: '怜という漢字には深い意味がある。', en: 'The kanji 怜 carries a deep meaning.' },
    { jp: '怜は日本語の語彙の中に含まれる漢字だ。', en: '怜 is a kanji found in the Japanese vocabulary.' },
  ],
  '悌': [
    { jp: '悌という漢字には深い意味がある。', en: 'The kanji 悌 carries a deep meaning.' },
    { jp: '悌は日本語の語彙の中に含まれる漢字だ。', en: '悌 is a kanji found in the Japanese vocabulary.' },
  ],
  '惇': [
    { jp: '惇という漢字には深い意味がある。', en: 'The kanji 惇 carries a deep meaning.' },
    { jp: '惇は日本語の語彙の中に含まれる漢字だ。', en: '惇 is a kanji found in the Japanese vocabulary.' },
  ],
  '惟': [
    { jp: '惟という漢字には深い意味がある。', en: 'The kanji 惟 carries a deep meaning.' },
    { jp: '惟は日本語の語彙の中に含まれる漢字だ。', en: '惟 is a kanji found in the Japanese vocabulary.' },
  ],
  '慧': [
    { jp: '慧という漢字には深い意味がある。', en: 'The kanji 慧 carries a deep meaning.' },
    { jp: '慧は日本語の語彙の中に含まれる漢字だ。', en: '慧 is a kanji found in the Japanese vocabulary.' },
  ],
  '捷': [
    { jp: '捷という漢字には深い意味がある。', en: 'The kanji 捷 carries a deep meaning.' },
    { jp: '捷は日本語の語彙の中に含まれる漢字だ。', en: '捷 is a kanji found in the Japanese vocabulary.' },
  ],
  '捺': [
    { jp: '捺という漢字には深い意味がある。', en: 'The kanji 捺 carries a deep meaning.' },
    { jp: '捺は日本語の語彙の中に含まれる漢字だ。', en: '捺 is a kanji found in the Japanese vocabulary.' },
  ],
  '撃': [
    { jp: '撃という漢字には深い意味がある。', en: 'The kanji 撃 carries a deep meaning.' },
    { jp: '撃は日本語の語彙の中に含まれる漢字だ。', en: '撃 is a kanji found in the Japanese vocabulary.' },
  ],
  '敦': [
    { jp: '敦厚という言葉を覚えておくと役に立つ。', en: 'Remembering the word 敦厚 will come in handy.' },
    { jp: '敦睦は日本語で重要な言葉の一つだと思う。', en: 'I think 敦睦 is one of the important words in Japanese.' },
  ],
  '斥': [
    { jp: '斥という漢字には深い意味がある。', en: 'The kanji 斥 carries a deep meaning.' },
    { jp: '斥は日本語の語彙の中に含まれる漢字だ。', en: '斥 is a kanji found in the Japanese vocabulary.' },
  ],
  '旭': [
    { jp: '旭という漢字には深い意味がある。', en: 'The kanji 旭 carries a deep meaning.' },
    { jp: '旭は日本語の語彙の中に含まれる漢字だ。', en: '旭 is a kanji found in the Japanese vocabulary.' },
  ],
  '昂': [
    { jp: '昂という漢字には深い意味がある。', en: 'The kanji 昂 carries a deep meaning.' },
    { jp: '昂は日本語の語彙の中に含まれる漢字だ。', en: '昂 is a kanji found in the Japanese vocabulary.' },
  ],
  '昴': [
    { jp: '昴という漢字には深い意味がある。', en: 'The kanji 昴 carries a deep meaning.' },
    { jp: '昴は日本語の語彙の中に含まれる漢字だ。', en: '昴 is a kanji found in the Japanese vocabulary.' },
  ],
  '晏': [
    { jp: '晏という漢字には深い意味がある。', en: 'The kanji 晏 carries a deep meaning.' },
    { jp: '晏は日本語の語彙の中に含まれる漢字だ。', en: '晏 is a kanji found in the Japanese vocabulary.' },
  ],
  '晟': [
    { jp: '晟という字は輝きや盛んなさまを意味する。', en: 'The character sei means brightness and prosperity.' },
    { jp: '晟は人名によく使われる漢字の一つだ。', en: 'Sei is one of the kanji commonly used in personal names.' },
  ],
  '晨': [
    { jp: '晨という漢字には深い意味がある。', en: 'The kanji 晨 carries a deep meaning.' },
    { jp: '晨は日本語の語彙の中に含まれる漢字だ。', en: '晨 is a kanji found in the Japanese vocabulary.' },
  ],
  '暉': [
    { jp: '暉という漢字には深い意味がある。', en: 'The kanji 暉 carries a deep meaning.' },
    { jp: '暉は日本語の語彙の中に含まれる漢字だ。', en: '暉 is a kanji found in the Japanese vocabulary.' },
  ],
  '曙': [
    { jp: '曙という漢字には深い意味がある。', en: 'The kanji 曙 carries a deep meaning.' },
    { jp: '曙は日本語の語彙の中に含まれる漢字だ。', en: '曙 is a kanji found in the Japanese vocabulary.' },
  ],
  '朋': [
    { jp: '朋という漢字には深い意味がある。', en: 'The kanji 朋 carries a deep meaning.' },
    { jp: '朋は日本語の語彙の中に含まれる漢字だ。', en: '朋 is a kanji found in the Japanese vocabulary.' },
  ],
  '朔': [
    { jp: '朔という漢字には深い意味がある。', en: 'The kanji 朔 carries a deep meaning.' },
    { jp: '朔は日本語の語彙の中に含まれる漢字だ。', en: '朔 is a kanji found in the Japanese vocabulary.' },
  ],
  '朕': [
    { jp: '古代の天皇は朕という一人称を使った。', en: 'Ancient emperors used the first-person pronoun "chin".' },
    { jp: '朕はこれを命ずる、と天皇は宣言した。', en: '"I hereby command this," the emperor declared.' },
  ],
  '杉': [
    { jp: '杉という漢字には深い意味がある。', en: 'The kanji 杉 carries a deep meaning.' },
    { jp: '杉は日本語の語彙の中に含まれる漢字だ。', en: '杉 is a kanji found in the Japanese vocabulary.' },
  ],
  '柊': [
    { jp: '柊という漢字には深い意味がある。', en: 'The kanji 柊 carries a deep meaning.' },
    { jp: '柊は日本語の語彙の中に含まれる漢字だ。', en: '柊 is a kanji found in the Japanese vocabulary.' },
  ],
  '柾': [
    { jp: '柾という漢字には深い意味がある。', en: 'The kanji 柾 carries a deep meaning.' },
    { jp: '柾は日本語の語彙の中に含まれる漢字だ。', en: '柾 is a kanji found in the Japanese vocabulary.' },
  ],
  '栞': [
    { jp: '栞という漢字には深い意味がある。', en: 'The kanji 栞 carries a deep meaning.' },
    { jp: '栞は日本語の語彙の中に含まれる漢字だ。', en: '栞 is a kanji found in the Japanese vocabulary.' },
  ],
  '桂': [
    { jp: '桂という漢字には深い意味がある。', en: 'The kanji 桂 carries a deep meaning.' },
    { jp: '桂は日本語の語彙の中に含まれる漢字だ。', en: '桂 is a kanji found in the Japanese vocabulary.' },
  ],
  '桐': [
    { jp: '桐という漢字には深い意味がある。', en: 'The kanji 桐 carries a deep meaning.' },
    { jp: '桐は日本語の語彙の中に含まれる漢字だ。', en: '桐 is a kanji found in the Japanese vocabulary.' },
  ],
  '梢': [
    { jp: '梢という漢字には深い意味がある。', en: 'The kanji 梢 carries a deep meaning.' },
    { jp: '梢は日本語の語彙の中に含まれる漢字だ。', en: '梢 is a kanji found in the Japanese vocabulary.' },
  ],
  '梧': [
    { jp: '梧という漢字には深い意味がある。', en: 'The kanji 梧 carries a deep meaning.' },
    { jp: '梧は日本語の語彙の中に含まれる漢字だ。', en: '梧 is a kanji found in the Japanese vocabulary.' },
  ],
  '椋': [
    { jp: '椋鳥という言葉を覚えておくと役に立つ。', en: 'Remembering the word 椋鳥 will come in handy.' },
    { jp: '星椋鳥は日本語で重要な言葉の一つだと思う。', en: 'I think 星椋鳥 is one of the important words in Japanese.' },
  ],
  '椰': [
    { jp: '椰という漢字には深い意味がある。', en: 'The kanji 椰 carries a deep meaning.' },
    { jp: '椰は日本語の語彙の中に含まれる漢字だ。', en: '椰 is a kanji found in the Japanese vocabulary.' },
  ],
  '楓': [
    { jp: '楓という漢字には深い意味がある。', en: 'The kanji 楓 carries a deep meaning.' },
    { jp: '楓は日本語の語彙の中に含まれる漢字だ。', en: '楓 is a kanji found in the Japanese vocabulary.' },
  ],
  '楠': [
    { jp: '楠という漢字には深い意味がある。', en: 'The kanji 楠 carries a deep meaning.' },
    { jp: '楠は日本語の語彙の中に含まれる漢字だ。', en: '楠 is a kanji found in the Japanese vocabulary.' },
  ],
  '榛': [
    { jp: '榛という漢字には深い意味がある。', en: 'The kanji 榛 carries a deep meaning.' },
    { jp: '榛は日本語の語彙の中に含まれる漢字だ。', en: '榛 is a kanji found in the Japanese vocabulary.' },
  ],
  '槙': [
    { jp: '槙という漢字には深い意味がある。', en: 'The kanji 槙 carries a deep meaning.' },
    { jp: '槙は日本語の語彙の中に含まれる漢字だ。', en: '槙 is a kanji found in the Japanese vocabulary.' },
  ],
  '槻': [
    { jp: '槻という漢字には深い意味がある。', en: 'The kanji 槻 carries a deep meaning.' },
    { jp: '槻は日本語の語彙の中に含まれる漢字だ。', en: '槻 is a kanji found in the Japanese vocabulary.' },
  ],
  '樺': [
    { jp: '樺という漢字には深い意味がある。', en: 'The kanji 樺 carries a deep meaning.' },
    { jp: '樺は日本語の語彙の中に含まれる漢字だ。', en: '樺 is a kanji found in the Japanese vocabulary.' },
  ],
  '檀': [
    { jp: '檀という漢字には深い意味がある。', en: 'The kanji 檀 carries a deep meaning.' },
    { jp: '檀は日本語の語彙の中に含まれる漢字だ。', en: '檀 is a kanji found in the Japanese vocabulary.' },
  ],
  '欣': [
    { jp: '欣という漢字には深い意味がある。', en: 'The kanji 欣 carries a deep meaning.' },
    { jp: '欣は日本語の語彙の中に含まれる漢字だ。', en: '欣 is a kanji found in the Japanese vocabulary.' },
  ],
  '欽': [
    { jp: '欽という漢字には深い意味がある。', en: 'The kanji 欽 carries a deep meaning.' },
    { jp: '欽は日本語の語彙の中に含まれる漢字だ。', en: '欽 is a kanji found in the Japanese vocabulary.' },
  ],
  '殉': [
    { jp: '殉という漢字には深い意味がある。', en: 'The kanji 殉 carries a deep meaning.' },
    { jp: '殉は日本語の語彙の中に含まれる漢字だ。', en: '殉 is a kanji found in the Japanese vocabulary.' },
  ],
  '毬': [
    { jp: '毬という漢字には深い意味がある。', en: 'The kanji 毬 carries a deep meaning.' },
    { jp: '毬は日本語の語彙の中に含まれる漢字だ。', en: '毬 is a kanji found in the Japanese vocabulary.' },
  ],
  '汐': [
    { jp: '汐という漢字には深い意味がある。', en: 'The kanji 汐 carries a deep meaning.' },
    { jp: '汐は日本語の語彙の中に含まれる漢字だ。', en: '汐 is a kanji found in the Japanese vocabulary.' },
  ],
  '泰': [
    { jp: '泰という漢字には深い意味がある。', en: 'The kanji 泰 carries a deep meaning.' },
    { jp: '泰は日本語の語彙の中に含まれる漢字だ。', en: '泰 is a kanji found in the Japanese vocabulary.' },
  ],
  '洵': [
    { jp: '洵という漢字には深い意味がある。', en: 'The kanji 洵 carries a deep meaning.' },
    { jp: '洵は日本語の語彙の中に含まれる漢字だ。', en: '洵 is a kanji found in the Japanese vocabulary.' },
  ],
  '洸': [
    { jp: '洸という漢字には深い意味がある。', en: 'The kanji 洸 carries a deep meaning.' },
    { jp: '洸は日本語の語彙の中に含まれる漢字だ。', en: '洸 is a kanji found in the Japanese vocabulary.' },
  ],
  '淑': [
    { jp: '淑女（しゅくじょ）という言葉は「refined, gracious lady」を意味する。', en: 'The word 淑女 (しゅくじょ) means "refined, gracious lady".' },
    { jp: '淑やかについて詳しく学んだことがある。', en: 'I have learned about 淑やか in detail.' },
  ],
  '淳': [
    { jp: '淳という漢字には深い意味がある。', en: 'The kanji 淳 carries a deep meaning.' },
    { jp: '淳は日本語の語彙の中に含まれる漢字だ。', en: '淳 is a kanji found in the Japanese vocabulary.' },
  ],
  '渓': [
    { jp: '渓という漢字には深い意味がある。', en: 'The kanji 渓 carries a deep meaning.' },
    { jp: '渓は日本語の語彙の中に含まれる漢字だ。', en: '渓 is a kanji found in the Japanese vocabulary.' },
  ],
  '渥': [
    { jp: '渥という漢字には深い意味がある。', en: 'The kanji 渥 carries a deep meaning.' },
    { jp: '渥は日本語の語彙の中に含まれる漢字だ。', en: '渥 is a kanji found in the Japanese vocabulary.' },
  ],
  '滉': [
    { jp: '滉という漢字には深い意味がある。', en: 'The kanji 滉 carries a deep meaning.' },
    { jp: '滉は日本語の語彙の中に含まれる漢字だ。', en: '滉 is a kanji found in the Japanese vocabulary.' },
  ],
  '澪': [
    { jp: '澪という漢字には深い意味がある。', en: 'The kanji 澪 carries a deep meaning.' },
    { jp: '澪は日本語の語彙の中に含まれる漢字だ。', en: '澪 is a kanji found in the Japanese vocabulary.' },
  ],
  '熙': [
    { jp: '熙という漢字には深い意味がある。', en: 'The kanji 熙 carries a deep meaning.' },
    { jp: '熙は日本語の語彙の中に含まれる漢字だ。', en: '熙 is a kanji found in the Japanese vocabulary.' },
  ],
  '燎': [
    { jp: '燎という漢字には深い意味がある。', en: 'The kanji 燎 carries a deep meaning.' },
    { jp: '燎は日本語の語彙の中に含まれる漢字だ。', en: '燎 is a kanji found in the Japanese vocabulary.' },
  ],
  '燦': [
    { jp: '燦という漢字には深い意味がある。', en: 'The kanji 燦 carries a deep meaning.' },
    { jp: '燦は日本語の語彙の中に含まれる漢字だ。', en: '燦 is a kanji found in the Japanese vocabulary.' },
  ],
  '燿': [
    { jp: '夜空の星が燿々と輝いていた。', en: 'The stars in the night sky shone brilliantly.' },
    { jp: '燿は光り輝くことを表す漢字だ。', en: 'Yō is a kanji representing shining brilliance.' },
  ],
  '爾': [
    { jp: '爾という漢字には深い意味がある。', en: 'The kanji 爾 carries a deep meaning.' },
    { jp: '爾は日本語の語彙の中に含まれる漢字だ。', en: '爾 is a kanji found in the Japanese vocabulary.' },
  ],
  '猪': [
    { jp: '猪という漢字には深い意味がある。', en: 'The kanji 猪 carries a deep meaning.' },
    { jp: '猪は日本語の語彙の中に含まれる漢字だ。', en: '猪 is a kanji found in the Japanese vocabulary.' },
  ],
  '玖': [
    { jp: '玖という漢字には深い意味がある。', en: 'The kanji 玖 carries a deep meaning.' },
    { jp: '玖は日本語の語彙の中に含まれる漢字だ。', en: '玖 is a kanji found in the Japanese vocabulary.' },
  ],
  '琉': [
    { jp: '琉という漢字には深い意味がある。', en: 'The kanji 琉 carries a deep meaning.' },
    { jp: '琉は日本語の語彙の中に含まれる漢字だ。', en: '琉 is a kanji found in the Japanese vocabulary.' },
  ],
  '琳': [
    { jp: '琳という漢字には深い意味がある。', en: 'The kanji 琳 carries a deep meaning.' },
    { jp: '琳は日本語の語彙の中に含まれる漢字だ。', en: '琳 is a kanji found in the Japanese vocabulary.' },
  ],
  '瑚': [
    { jp: '瑚という漢字には深い意味がある。', en: 'The kanji 瑚 carries a deep meaning.' },
    { jp: '瑚は日本語の語彙の中に含まれる漢字だ。', en: '瑚 is a kanji found in the Japanese vocabulary.' },
  ],
  '瑛': [
    { jp: '瑛という漢字には深い意味がある。', en: 'The kanji 瑛 carries a deep meaning.' },
    { jp: '瑛は日本語の語彙の中に含まれる漢字だ。', en: '瑛 is a kanji found in the Japanese vocabulary.' },
  ],
  '瑳': [
    { jp: '瑳という漢字には深い意味がある。', en: 'The kanji 瑳 carries a deep meaning.' },
    { jp: '瑳は日本語の語彙の中に含まれる漢字だ。', en: '瑳 is a kanji found in the Japanese vocabulary.' },
  ],
  '瑶': [
    { jp: '瑶という漢字には深い意味がある。', en: 'The kanji 瑶 carries a deep meaning.' },
    { jp: '瑶は日本語の語彙の中に含まれる漢字だ。', en: '瑶 is a kanji found in the Japanese vocabulary.' },
  ],
  '甫': [
    { jp: '甫という漢字には深い意味がある。', en: 'The kanji 甫 carries a deep meaning.' },
    { jp: '甫は日本語の語彙の中に含まれる漢字だ。', en: '甫 is a kanji found in the Japanese vocabulary.' },
  ],
  '畝': [
    { jp: '畝という漢字には深い意味がある。', en: 'The kanji 畝 carries a deep meaning.' },
    { jp: '畝は日本語の語彙の中に含まれる漢字だ。', en: '畝 is a kanji found in the Japanese vocabulary.' },
  ],
  '皐': [
    { jp: '皐という漢字には深い意味がある。', en: 'The kanji 皐 carries a deep meaning.' },
    { jp: '皐は日本語の語彙の中に含まれる漢字だ。', en: '皐 is a kanji found in the Japanese vocabulary.' },
  ],
  '皓': [
    { jp: '皓という漢字には深い意味がある。', en: 'The kanji 皓 carries a deep meaning.' },
    { jp: '皓は日本語の語彙の中に含まれる漢字だ。', en: '皓 is a kanji found in the Japanese vocabulary.' },
  ],
  '眸': [
    { jp: '眸という漢字には深い意味がある。', en: 'The kanji 眸 carries a deep meaning.' },
    { jp: '眸は日本語の語彙の中に含まれる漢字だ。', en: '眸 is a kanji found in the Japanese vocabulary.' },
  ],
  '碩': [
    { jp: '碩という漢字には深い意味がある。', en: 'The kanji 碩 carries a deep meaning.' },
    { jp: '碩は日本語の語彙の中に含まれる漢字だ。', en: '碩 is a kanji found in the Japanese vocabulary.' },
  ],
  '磯': [
    { jp: '磯という漢字には深い意味がある。', en: 'The kanji 磯 carries a deep meaning.' },
    { jp: '磯は日本語の語彙の中に含まれる漢字だ。', en: '磯 is a kanji found in the Japanese vocabulary.' },
  ],
  '礁': [
    { jp: '礁という漢字には深い意味がある。', en: 'The kanji 礁 carries a deep meaning.' },
    { jp: '礁は日本語の語彙の中に含まれる漢字だ。', en: '礁 is a kanji found in the Japanese vocabulary.' },
  ],
  '祐': [
    { jp: '祐という漢字には深い意味がある。', en: 'The kanji 祐 carries a deep meaning.' },
    { jp: '祐は日本語の語彙の中に含まれる漢字だ。', en: '祐 is a kanji found in the Japanese vocabulary.' },
  ],
  '租': [
    { jp: '租という漢字には深い意味がある。', en: 'The kanji 租 carries a deep meaning.' },
    { jp: '租は日本語の語彙の中に含まれる漢字だ。', en: '租 is a kanji found in the Japanese vocabulary.' },
  ],
  '秦': [
    { jp: '秦という漢字には深い意味がある。', en: 'The kanji 秦 carries a deep meaning.' },
    { jp: '秦は日本語の語彙の中に含まれる漢字だ。', en: '秦 is a kanji found in the Japanese vocabulary.' },
  ],
  '稜': [
    { jp: '稜という漢字には深い意味がある。', en: 'The kanji 稜 carries a deep meaning.' },
    { jp: '稜は日本語の語彙の中に含まれる漢字だ。', en: '稜 is a kanji found in the Japanese vocabulary.' },
  ],
  '窯': [
    { jp: '窯という漢字には深い意味がある。', en: 'The kanji 窯 carries a deep meaning.' },
    { jp: '窯は日本語の語彙の中に含まれる漢字だ。', en: '窯 is a kanji found in the Japanese vocabulary.' },
  ],
  '竣': [
    { jp: '竣という漢字には深い意味がある。', en: 'The kanji 竣 carries a deep meaning.' },
    { jp: '竣は日本語の語彙の中に含まれる漢字だ。', en: '竣 is a kanji found in the Japanese vocabulary.' },
  ],
  '笙': [
    { jp: '笙という漢字には深い意味がある。', en: 'The kanji 笙 carries a deep meaning.' },
    { jp: '笙は日本語の語彙の中に含まれる漢字だ。', en: '笙 is a kanji found in the Japanese vocabulary.' },
  ],
  '笹': [
    { jp: '笹という漢字には深い意味がある。', en: 'The kanji 笹 carries a deep meaning.' },
    { jp: '笹は日本語の語彙の中に含まれる漢字だ。', en: '笹 is a kanji found in the Japanese vocabulary.' },
  ],
  '紘': [
    { jp: '紘という漢字には深い意味がある。', en: 'The kanji 紘 carries a deep meaning.' },
    { jp: '紘は日本語の語彙の中に含まれる漢字だ。', en: '紘 is a kanji found in the Japanese vocabulary.' },
  ],
  '紬': [
    { jp: '紬という漢字には深い意味がある。', en: 'The kanji 紬 carries a deep meaning.' },
    { jp: '紬は日本語の語彙の中に含まれる漢字だ。', en: '紬 is a kanji found in the Japanese vocabulary.' },
  ],
  '絃': [
    { jp: '絃という漢字には深い意味がある。', en: 'The kanji 絃 carries a deep meaning.' },
    { jp: '絃は日本語の語彙の中に含まれる漢字だ。', en: '絃 is a kanji found in the Japanese vocabulary.' },
  ],
  '絢': [
    { jp: '絢という漢字には深い意味がある。', en: 'The kanji 絢 carries a deep meaning.' },
    { jp: '絢は日本語の語彙の中に含まれる漢字だ。', en: '絢 is a kanji found in the Japanese vocabulary.' },
  ],
  '綜': [
    { jp: '綜という漢字には深い意味がある。', en: 'The kanji 綜 carries a deep meaning.' },
    { jp: '綜は日本語の語彙の中に含まれる漢字だ。', en: '綜 is a kanji found in the Japanese vocabulary.' },
  ],
  '綸': [
    { jp: '綸という漢字には深い意味がある。', en: 'The kanji 綸 carries a deep meaning.' },
    { jp: '綸は日本語の語彙の中に含まれる漢字だ。', en: '綸 is a kanji found in the Japanese vocabulary.' },
  ],
  '緋': [
    { jp: '緋という漢字には深い意味がある。', en: 'The kanji 緋 carries a deep meaning.' },
    { jp: '緋は日本語の語彙の中に含まれる漢字だ。', en: '緋 is a kanji found in the Japanese vocabulary.' },
  ],
  '繭': [
    { jp: '繭という漢字には深い意味がある。', en: 'The kanji 繭 carries a deep meaning.' },
    { jp: '繭は日本語の語彙の中に含まれる漢字だ。', en: '繭 is a kanji found in the Japanese vocabulary.' },
  ],
  '翁': [
    { jp: '翁という漢字には深い意味がある。', en: 'The kanji 翁 carries a deep meaning.' },
    { jp: '翁は日本語の語彙の中に含まれる漢字だ。', en: '翁 is a kanji found in the Japanese vocabulary.' },
  ],
  '耀': [
    { jp: '耀という漢字には深い意味がある。', en: 'The kanji 耀 carries a deep meaning.' },
    { jp: '耀は日本語の語彙の中に含まれる漢字だ。', en: '耀 is a kanji found in the Japanese vocabulary.' },
  ],
  '耶': [
    { jp: '耶という漢字には深い意味がある。', en: 'The kanji 耶 carries a deep meaning.' },
    { jp: '耶は日本語の語彙の中に含まれる漢字だ。', en: '耶 is a kanji found in the Japanese vocabulary.' },
  ],
  '肇': [
    { jp: '肇という漢字には深い意味がある。', en: 'The kanji 肇 carries a deep meaning.' },
    { jp: '肇は日本語の語彙の中に含まれる漢字だ。', en: '肇 is a kanji found in the Japanese vocabulary.' },
  ],
  '胤': [
    { jp: '胤という漢字には深い意味がある。', en: 'The kanji 胤 carries a deep meaning.' },
    { jp: '胤は日本語の語彙の中に含まれる漢字だ。', en: '胤 is a kanji found in the Japanese vocabulary.' },
  ],
  '脩': [
    { jp: '脩という漢字には深い意味がある。', en: 'The kanji 脩 carries a deep meaning.' },
    { jp: '脩は日本語の語彙の中に含まれる漢字だ。', en: '脩 is a kanji found in the Japanese vocabulary.' },
  ],
  '脹': [
    { jp: '脹という漢字には深い意味がある。', en: 'The kanji 脹 carries a deep meaning.' },
    { jp: '脹は日本語の語彙の中に含まれる漢字だ。', en: '脹 is a kanji found in the Japanese vocabulary.' },
  ],
  '臭': [
    { jp: '臭という漢字には深い意味がある。', en: 'The kanji 臭 carries a deep meaning.' },
    { jp: '臭は日本語の語彙の中に含まれる漢字だ。', en: '臭 is a kanji found in the Japanese vocabulary.' },
  ],
  '舜': [
    { jp: '舜は古代中国の伝説的な聖王だ。', en: 'Shun is a legendary sage king of ancient China.' },
    { jp: '堯舜の時代は平和だったと伝えられる。', en: 'The era of Yao and Shun is said to have been peaceful.' },
  ],
  '舶': [
    { jp: '舶という漢字には深い意味がある。', en: 'The kanji 舶 carries a deep meaning.' },
    { jp: '舶は日本語の語彙の中に含まれる漢字だ。', en: '舶 is a kanji found in the Japanese vocabulary.' },
  ],
  '芙': [
    { jp: '芙という漢字には深い意味がある。', en: 'The kanji 芙 carries a deep meaning.' },
    { jp: '芙は日本語の語彙の中に含まれる漢字だ。', en: '芙 is a kanji found in the Japanese vocabulary.' },
  ],
  '芹': [
    { jp: '芹という漢字には深い意味がある。', en: 'The kanji 芹 carries a deep meaning.' },
    { jp: '芹は日本語の語彙の中に含まれる漢字だ。', en: '芹 is a kanji found in the Japanese vocabulary.' },
  ],
  '莞': [
    { jp: '莞という漢字には深い意味がある。', en: 'The kanji 莞 carries a deep meaning.' },
    { jp: '莞は日本語の語彙の中に含まれる漢字だ。', en: '莞 is a kanji found in the Japanese vocabulary.' },
  ],
  '蓉': [
    { jp: '蓉という漢字には深い意味がある。', en: 'The kanji 蓉 carries a deep meaning.' },
    { jp: '蓉は日本語の語彙の中に含まれる漢字だ。', en: '蓉 is a kanji found in the Japanese vocabulary.' },
  ],
  '蔦': [
    { jp: '蔦という漢字には深い意味がある。', en: 'The kanji 蔦 carries a deep meaning.' },
    { jp: '蔦は日本語の語彙の中に含まれる漢字だ。', en: '蔦 is a kanji found in the Japanese vocabulary.' },
  ],
  '蕗': [
    { jp: '蕗という漢字には深い意味がある。', en: 'The kanji 蕗 carries a deep meaning.' },
    { jp: '蕗は日本語の語彙の中に含まれる漢字だ。', en: '蕗 is a kanji found in the Japanese vocabulary.' },
  ],
  '虞': [
    { jp: '虞という漢字には深い意味がある。', en: 'The kanji 虞 carries a deep meaning.' },
    { jp: '虞は日本語の語彙の中に含まれる漢字だ。', en: '虞 is a kanji found in the Japanese vocabulary.' },
  ],
  '衷': [
    { jp: '衷という漢字には深い意味がある。', en: 'The kanji 衷 carries a deep meaning.' },
    { jp: '衷は日本語の語彙の中に含まれる漢字だ。', en: '衷 is a kanji found in the Japanese vocabulary.' },
  ],
  '衿': [
    { jp: '衿という漢字には深い意味がある。', en: 'The kanji 衿 carries a deep meaning.' },
    { jp: '衿は日本語の語彙の中に含まれる漢字だ。', en: '衿 is a kanji found in the Japanese vocabulary.' },
  ],
  '褐': [
    { jp: '褐という漢字には深い意味がある。', en: 'The kanji 褐 carries a deep meaning.' },
    { jp: '褐は日本語の語彙の中に含まれる漢字だ。', en: '褐 is a kanji found in the Japanese vocabulary.' },
  ],
  '詔': [
    { jp: '詔という漢字には深い意味がある。', en: 'The kanji 詔 carries a deep meaning.' },
    { jp: '詔は日本語の語彙の中に含まれる漢字だ。', en: '詔 is a kanji found in the Japanese vocabulary.' },
  ],
  '詢': [
    { jp: '詢という漢字には深い意味がある。', en: 'The kanji 詢 carries a deep meaning.' },
    { jp: '詢は日本語の語彙の中に含まれる漢字だ。', en: '詢 is a kanji found in the Japanese vocabulary.' },
  ],
  '諄': [
    { jp: '諄という漢字には深い意味がある。', en: 'The kanji 諄 carries a deep meaning.' },
    { jp: '諄は日本語の語彙の中に含まれる漢字だ。', en: '諄 is a kanji found in the Japanese vocabulary.' },
  ],
  '諒': [
    { jp: '諒という漢字には深い意味がある。', en: 'The kanji 諒 carries a deep meaning.' },
    { jp: '諒は日本語の語彙の中に含まれる漢字だ。', en: '諒 is a kanji found in the Japanese vocabulary.' },
  ],
  '諮': [
    { jp: '諮という漢字には深い意味がある。', en: 'The kanji 諮 carries a deep meaning.' },
    { jp: '諮は日本語の語彙の中に含まれる漢字だ。', en: '諮 is a kanji found in the Japanese vocabulary.' },
  ],
  '謄': [
    { jp: '謄という漢字には深い意味がある。', en: 'The kanji 謄 carries a deep meaning.' },
    { jp: '謄は日本語の語彙の中に含まれる漢字だ。', en: '謄 is a kanji found in the Japanese vocabulary.' },
  ],
  '賦': [
    { jp: '賦という漢字には深い意味がある。', en: 'The kanji 賦 carries a deep meaning.' },
    { jp: '賦は日本語の語彙の中に含まれる漢字だ。', en: '賦 is a kanji found in the Japanese vocabulary.' },
  ],
  '赳': [
    { jp: '赳々武夫という言葉は勇ましい武人を指す。', en: 'The phrase "kyūkyū takeo" refers to a brave warrior.' },
    { jp: '赳は勇ましさや凛々しさを表す漢字だ。', en: 'Kyū is a kanji that expresses bravery and gallantry.' },
  ],
  '迪': [
    { jp: '迪という漢字には深い意味がある。', en: 'The kanji 迪 carries a deep meaning.' },
    { jp: '迪は日本語の語彙の中に含まれる漢字だ。', en: '迪 is a kanji found in the Japanese vocabulary.' },
  ],
  '逓': [
    { jp: '逓という漢字には深い意味がある。', en: 'The kanji 逓 carries a deep meaning.' },
    { jp: '逓は日本語の語彙の中に含まれる漢字だ。', en: '逓 is a kanji found in the Japanese vocabulary.' },
  ],
  '遼': [
    { jp: '遼という漢字には深い意味がある。', en: 'The kanji 遼 carries a deep meaning.' },
    { jp: '遼は日本語の語彙の中に含まれる漢字だ。', en: '遼 is a kanji found in the Japanese vocabulary.' },
  ],
  '邑': [
    { jp: '邑という漢字には深い意味がある。', en: 'The kanji 邑 carries a deep meaning.' },
    { jp: '邑は日本語の語彙の中に含まれる漢字だ。', en: '邑 is a kanji found in the Japanese vocabulary.' },
  ],
  '郁': [
    { jp: '郁という漢字には深い意味がある。', en: 'The kanji 郁 carries a deep meaning.' },
    { jp: '郁は日本語の語彙の中に含まれる漢字だ。', en: '郁 is a kanji found in the Japanese vocabulary.' },
  ],
  '酉': [
    { jp: '酉という漢字には深い意味がある。', en: 'The kanji 酉 carries a deep meaning.' },
    { jp: '酉は日本語の語彙の中に含まれる漢字だ。', en: '酉 is a kanji found in the Japanese vocabulary.' },
  ],
  '酪': [
    { jp: '酪という漢字には深い意味がある。', en: 'The kanji 酪 carries a deep meaning.' },
    { jp: '酪は日本語の語彙の中に含まれる漢字だ。', en: '酪 is a kanji found in the Japanese vocabulary.' },
  ],
  '銑': [
    { jp: '銑という漢字には深い意味がある。', en: 'The kanji 銑 carries a deep meaning.' },
    { jp: '銑は日本語の語彙の中に含まれる漢字だ。', en: '銑 is a kanji found in the Japanese vocabulary.' },
  ],
  '錘': [
    { jp: '錘という漢字には深い意味がある。', en: 'The kanji 錘 carries a deep meaning.' },
    { jp: '錘は日本語の語彙の中に含まれる漢字だ。', en: '錘 is a kanji found in the Japanese vocabulary.' },
  ],
  '陵': [
    { jp: '陵という漢字には深い意味がある。', en: 'The kanji 陵 carries a deep meaning.' },
    { jp: '陵は日本語の語彙の中に含まれる漢字だ。', en: '陵 is a kanji found in the Japanese vocabulary.' },
  ],
  '隠': [
    { jp: '隠という漢字には深い意味がある。', en: 'The kanji 隠 carries a deep meaning.' },
    { jp: '隠は日本語の語彙の中に含まれる漢字だ。', en: '隠 is a kanji found in the Japanese vocabulary.' },
  ],
  '鞠': [
    { jp: '鞠という漢字には深い意味がある。', en: 'The kanji 鞠 carries a deep meaning.' },
    { jp: '鞠は日本語の語彙の中に含まれる漢字だ。', en: '鞠 is a kanji found in the Japanese vocabulary.' },
  ],
  '頌': [
    { jp: '頌という漢字には深い意味がある。', en: 'The kanji 頌 carries a deep meaning.' },
    { jp: '頌は日本語の語彙の中に含まれる漢字だ。', en: '頌 is a kanji found in the Japanese vocabulary.' },
  ],
  '頒': [
    { jp: '頒という漢字には深い意味がある。', en: 'The kanji 頒 carries a deep meaning.' },
    { jp: '頒は日本語の語彙の中に含まれる漢字だ。', en: '頒 is a kanji found in the Japanese vocabulary.' },
  ],
  '馨': [
    { jp: '馨という漢字には深い意味がある。', en: 'The kanji 馨 carries a deep meaning.' },
    { jp: '馨は日本語の語彙の中に含まれる漢字だ。', en: '馨 is a kanji found in the Japanese vocabulary.' },
  ],
  '魁': [
    { jp: '魁という漢字には深い意味がある。', en: 'The kanji 魁 carries a deep meaning.' },
    { jp: '魁は日本語の語彙の中に含まれる漢字だ。', en: '魁 is a kanji found in the Japanese vocabulary.' },
  ],
  '魔': [
    { jp: '魔という漢字には深い意味がある。', en: 'The kanji 魔 carries a deep meaning.' },
    { jp: '魔は日本語の語彙の中に含まれる漢字だ。', en: '魔 is a kanji found in the Japanese vocabulary.' },
  ],
  '鳳': [
    { jp: '鳳という漢字には深い意味がある。', en: 'The kanji 鳳 carries a deep meaning.' },
    { jp: '鳳は日本語の語彙の中に含まれる漢字だ。', en: '鳳 is a kanji found in the Japanese vocabulary.' },
  ],
  '鴻': [
    { jp: '鴻という漢字には深い意味がある。', en: 'The kanji 鴻 carries a deep meaning.' },
    { jp: '鴻は日本語の語彙の中に含まれる漢字だ。', en: '鴻 is a kanji found in the Japanese vocabulary.' },
  ],
  '鵬': [
    { jp: '鵬という漢字には深い意味がある。', en: 'The kanji 鵬 carries a deep meaning.' },
    { jp: '鵬は日本語の語彙の中に含まれる漢字だ。', en: '鵬 is a kanji found in the Japanese vocabulary.' },
  ],
  '麿': [
    { jp: '麿という漢字には深い意味がある。', en: 'The kanji 麿 carries a deep meaning.' },
    { jp: '麿は日本語の語彙の中に含まれる漢字だ。', en: '麿 is a kanji found in the Japanese vocabulary.' },
  ],
  '黎': [
    { jp: '黎という漢字には深い意味がある。', en: 'The kanji 黎 carries a deep meaning.' },
    { jp: '黎は日本語の語彙の中に含まれる漢字だ。', en: '黎 is a kanji found in the Japanese vocabulary.' },
  ],
  '黛': [
    { jp: '黛という漢字には深い意味がある。', en: 'The kanji 黛 carries a deep meaning.' },
    { jp: '黛は日本語の語彙の中に含まれる漢字だ。', en: '黛 is a kanji found in the Japanese vocabulary.' },
  ],
};

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

  // Know button ("I already know this")
  const knowBtn = document.createElement('button');
  knowBtn.className = 'kanji-know-btn';
  knowBtn.textContent = '✓';
  knowBtn.title = t('vocab_know_btn');
  knowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    skipAndReplaceKanjiCard(k, card);
  });
  card.appendChild(knowBtn);

  card.addEventListener('click', () => {
    if (window.openKanjiDetail) window.openKanjiDetail(k.kanji);
  });

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
      <div class="card-examples">
        <div class="examples-label">Examples</div>
        ${exHtml}
      </div>
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

// ── Replace a single kanji card ("I know it" button) ─────────────────────
export async function skipAndReplaceKanjiCard(k, cardEl) {
  // Auto-save to My List if not already saved
  if (!isKanjiSaved(k.kanji)) toggleSaveKanji(k);

  // Remove from currentKanjiCards
  const idx = state.currentKanjiCards.indexOf(k);
  if (idx !== -1) state.currentKanjiCards.splice(idx, 1);

  // Show skeleton placeholder
  const skeleton = document.createElement('div');
  skeleton.className = 'card skeleton';
  skeleton.innerHTML = `<div class="skel-big"></div><div style="flex:1"><div class="skel-line" style="width:50%"></div><div class="skel-line" style="width:80%"></div><div class="skel-line" style="width:65%"></div></div>`;
  cardEl.replaceWith(skeleton);

  try {
    if (!state.POOL.length) await buildPool();
    const _idx = await getKanjiSearchIndex();
    const lang = getLang();
    const alreadyShown = new Set(state.currentKanjiCards.map(c => c.kanji));
    const uniquePool = [...new Map(state.POOL.map(p => [p.char, p])).values()];
    const candidates = uniquePool.filter(p => !alreadyShown.has(p.char));
    if (!candidates.length) { skeleton.remove(); return; }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const [detail, words] = await Promise.all([getKanjiDetail(pick.char), getWords(pick.char)]);
    const newK = {
      kanji:   pick.char,
      level:   LEVEL_LABEL[pick.jlptNum],
      on:      detail.on_readings  ?? [],
      kun:     detail.kun_readings ?? [],
      meaning: bestKanjiMeaning(pick.char, detail.meanings, lang, _idx[pick.char]),
      ex:      bestExamples(words, pick.char, 3, pick.jlptNum),
    };
    state.currentKanjiCards.push(newK);
    const newCard = renderCard(newK, 0);
    skeleton.replaceWith(newCard);
  } catch {
    skeleton.remove();
  }
}

// ── Incremental add/remove cards (used by +More / −Less buttons) ──────────
// delta > 0 → fetch `delta` new cards and append; delta < 0 → remove last cards
export async function loadAndRenderDelta(delta) {
  const grid = document.getElementById('grid');

  if (delta < 0) {
    const toRemove = Math.min(Math.abs(delta), state.currentKanjiCards.length - 1);
    for (let i = 0; i < toRemove; i++) {
      state.currentKanjiCards.pop();
      if (grid.lastElementChild) grid.removeChild(grid.lastElementChild);
    }
    document.getElementById('countLabel').textContent = state.currentKanjiCards.length;
    return;
  }

  // delta > 0 — pick new chars not already on screen
  if (!state.POOL.length) await buildPool();
  const _idx = await getKanjiSearchIndex();
  const lang  = getLang();
  const already = new Set(state.currentKanjiCards.map(k => k.kanji));
  const filteredPool = state.kanjiLevelFilter === 'all'
    ? state.POOL
    : state.POOL.filter(x => x.jlptNum === Number(state.kanjiLevelFilter));
  const source      = filteredPool.length ? filteredPool : state.POOL;
  const uniqueChars = [...new Set(source.map(x => x.char))].filter(c => !already.has(c));

  const picks = [];
  const seen  = new Set();
  let tries   = 0;
  while (picks.length < delta && tries < source.length * 4) {
    const item = source[Math.floor(Math.random() * source.length)];
    if (!already.has(item.char) && !seen.has(item.char)) {
      seen.add(item.char);
      picks.push(item);
    }
    tries++;
  }
  for (const char of uniqueChars) {
    if (picks.length >= delta) break;
    if (!seen.has(char)) {
      seen.add(char);
      picks.push(source.find(x => x.char === char));
    }
  }

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

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const k = r.value;
    state.currentKanjiCards.push(k);
    grid.appendChild(renderCard(k, i * 80));
  });
  document.getElementById('countLabel').textContent = state.currentKanjiCards.length;
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
