/**
 * _patch-dupes.mjs
 * Fixes duplicate sentences in SENTENCE_OVERRIDE (same or near-identical meaning)
 * and replaces overly long sentences that would overflow on cards.
 *
 * Usage: node scripts/_patch-dupes.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('src/kanji.js', 'utf8');
let fixed = 0;
let notFound = 0;

/**
 * Replace a specific { jp: '...', en: '...' } entry in kanji.js
 * Matches on the jp value (Japanese doesn't contain apostrophes, so safe)
 */
function patch(oldJp, newJp, newEn) {
  const key = `jp: '${oldJp}'`;
  const idx = src.indexOf(key);
  if (idx === -1) {
    console.warn(`  ⚠️  NOT FOUND: ${oldJp}`);
    notFound++;
    return;
  }
  // Find enclosing { ... }
  const start = src.lastIndexOf('{', idx);
  const end = src.indexOf('}', idx) + 1;
  const oldObj = src.slice(start, end);
  // Build new object (escape apostrophes in EN)
  const enEscaped = newEn.replace(/'/g, "\\'");
  const newObj = `{ jp: '${newJp}', en: '${enEscaped}' }`;
  src = src.slice(0, start) + newObj + src.slice(end);
  console.log(`  ✅ ${oldJp.slice(0, 18)}… → ${newJp}`);
  fixed++;
}

console.log('🔧 Patching SENTENCE_OVERRIDE duplicates...\n');

// ── 意 (user noticed: これ vs それ + same structure) ──────────────────────────
patch('それどういう意味？', 'いい意味で言ったんです。', 'I meant it in a good sense.');

// ── 持 ────────────────────────────────────────────────────────────────────────
patch('天気は持つかなあ。', 'スマホは長持ちしますか？', 'Does your smartphone hold its charge?');

// ── 館 ────────────────────────────────────────────────────────────────────────
patch('これは図書館です。', '映画館に行きましょう。', "Let's go to the cinema.");

// ── 魚 ────────────────────────────────────────────────────────────────────────
patch('私も金魚、飼ってる。', '焼き魚が好きです。', 'I like grilled fish.');

// ── 他 ────────────────────────────────────────────────────────────────────────
patch('遠い親戚より近くの他人。', '他に何か必要ですか？', 'Do you need anything else?');

// ── 例 ────────────────────────────────────────────────────────────────────────
patch('上記の例をご参照ください。', '例えばどんな食べ物が好き？', 'What kind of food do you like, for example?');

// ── 値 ────────────────────────────────────────────────────────────────────────
patch('彼の言い分は一言だって聞く価値がない。', '物の値段が上がっています。', 'Prices are going up.');

// ── 寄 ────────────────────────────────────────────────────────────────────────
patch('霧が押し寄せてくるのを見て、トムとメアリーは手を取り合った。', '駅に立ち寄りますか？', 'Will you stop by the station?');
patch('トムとメアリーは手を取り合って、霧が押し寄せてくるのを見ていた。', '近くに寄ってください。', 'Please come closer.');

// ── 寝 ────────────────────────────────────────────────────────────────────────
patch('彼は寝る前に目覚し時計をあわせた。', '早く寝ると体にいいよ。', 'Going to bed early is good for you.');

// ── 察 ────────────────────────────────────────────────────────────────────────
patch('警察に嘘を言った。', '状況を察してください。', 'Please read the situation.');

// ── 歳 ────────────────────────────────────────────────────────────────────────
patch('あの人は八十歳です。', 'もう何歳になりましたか？', 'How old are you now?');

// ── 等 ────────────────────────────────────────────────────────────────────────
patch('全ての人間は平等である。', '等しく扱われる権利がある。', 'Everyone has the right to equal treatment.');

// ── 続 ────────────────────────────────────────────────────────────────────────
// Both entries are about internet connection — replace both
patch('インターネット接続をご確認ください。', '読書を続けるつもりです。', 'I plan to keep reading.');
patch('インターネット接続を確認してみてください。', '毎日続けることが大切です。', 'It is important to keep going every day.');

// ── 接 ────────────────────────────────────────────────────────────────────────
// NOTE: 続 patch above consumed the first occurrence. 接 may have its own copies.
// Run script twice if needed, or add explicit second patch here:
// (The 続 patch already replaces the first occurrence; 接 has the remaining one)
// If 接 still has its duplicate, patch the second:
patch('インターネット接続をご確認ください。', '先生と直接話してみよう。', "Let's talk directly with the teacher.");
patch('インターネット接続を確認してみてください。', '接触を避けてください。', 'Please avoid contact.');

// ── 草 ────────────────────────────────────────────────────────────────────────
patch('ユリは多年草です。', '草原を歩くのが好きです。', 'I like walking through the meadows.');

// ── 際 ────────────────────────────────────────────────────────────────────────
patch('実際に何が起こったの？', '国際的な問題ですね。', "It's an international issue.");

// ── 刺 ────────────────────────────────────────────────────────────────────────
patch('名刺はお持ちですか？', '刺身を食べませんか？', 'Would you like some sashimi?');

// ── 匹 ────────────────────────────────────────────────────────────────────────
patch('12匹猫を飼ってます。', '犬を一匹飼いたいです。', 'I want to keep one dog.');

// ── 尊 ────────────────────────────────────────────────────────────────────────
patch('心から尊敬してます。', '自尊心を大切にしよう。', "Let's value our self-respect.");

// ── 帽 ────────────────────────────────────────────────────────────────────────
patch('トムはTシャツに野球帽だったよ。', '帽子を忘れないでね。', "Don't forget your hat.");

// ── 弱 ────────────────────────────────────────────────────────────────────────
patch('誰にでも弱点はある。', '彼は体が弱いです。', 'He has a weak constitution.');

// ── 沸 ────────────────────────────────────────────────────────────────────────
patch('トムは、やかんの湯が沸くのを待ってました。', 'お湯が沸いたら教えてね。', 'Tell me when the water boils.');

// ── 浴 ────────────────────────────────────────────────────────────────────────
patch('水浴びした後、ソファーに寝転がった。', '朝シャワーを浴びました。', 'I took a shower this morning.');

// ── 磨 ────────────────────────────────────────────────────────────────────────
patch('歯を磨いてたのよ。', '腕を磨いています。', "I'm honing my skills.");

// ── 袋 ────────────────────────────────────────────────────────────────────────
patch('手袋が要りますか？', '紙袋に入れてください。', 'Please put it in a paper bag.');

// ── 亜 ────────────────────────────────────────────────────────────────────────
patch('真鍮は銅と亜鉛の合金である。', '亜熱帯の気候が好きです。', 'I like the subtropical climate.');

// ── 伎 ────────────────────────────────────────────────────────────────────────
patch('歌舞伎って知ってる？', '歌舞伎座に行ったことある？', 'Have you ever been to the Kabukiza theatre?');

// ── 慨 ────────────────────────────────────────────────────────────────────────
patch('感慨深い一日でした。', '彼の行動に憤慨しました。', 'I was outraged by his actions.');

// ── 沼 ────────────────────────────────────────────────────────────────────────
patch('トムは泥沼に突っ込んだ。', 'この沼には魚がいる。', 'There are fish in this marsh.');

// ── 竜 ────────────────────────────────────────────────────────────────────────
patch('竜は想像上の動物だ。', '竜巻が近づいています。', 'A tornado is approaching.');

// ── 笛 ────────────────────────────────────────────────────────────────────────
patch('口笛の吹き方ってわかる？', '笛の音が聞こえます。', 'I can hear the sound of a flute.');

// ── 級 ────────────────────────────────────────────────────────────────────────
patch('彼は私の同級生です。', '一級品の品質ですね。', "It's first-class quality.");

// ── 薪 ────────────────────────────────────────────────────────────────────────
patch('トムは薪割りしてるよ。', '薪ストーブで暖まった。', 'I warmed up by the wood stove.');

// ── 霧 ────────────────────────────────────────────────────────────────────────
patch('私たちは霧の中で迷子になった。', '朝霧が出ています。', "There's morning fog.");

// ── 騰 ────────────────────────────────────────────────────────────────────────
patch('水は212℉で沸騰します。', '物価が高騰しています。', 'Prices are soaring.');

// ── 抱 (BOTH sentences too long — replace both) ───────────────────────────────
patch('連年、禁煙の誓いは、新年の抱負ランキングのトップ10にランクインしている。', '赤ちゃんを抱っこしました。', 'I held the baby in my arms.');
patch('タバコを止めるという誓いは、毎年、新年の抱負ランキングのトップ10に入っている。', '夢を抱いて頑張ってください。', 'Please keep going, holding onto your dreams.');

// ── 負 (shares same two long sentences as 抱 — replace both) ─────────────────
patch('連年、禁煙の誓いは、新年の抱負ランキングのトップ10にランクインしている。', '試合に負けてしまいました。', 'I lost the match.');
patch('タバコを止めるという誓いは、毎年、新年の抱負ランキングのトップ10に入っている。', '責任を負うのが大人です。', 'Taking responsibility is what adults do.');

// ── 習 (BOTH sentences too long — replace both) ───────────────────────────────
patch('神道も仏教も、宗教というより日常的な習慣のようなものになっているからです。', '毎日練習を習慣にしています。', 'I make daily practice a habit.');
patch('神道も仏教も、日本では宗教と言うよりも日常的な習慣の一種のようになってしまっているのです。', '習い事を始めたばかりです。', 'I just started taking lessons.');

// ── 瞳 (BOTH sentences way too long — replace both) ──────────────────────────
patch('私の孫息子は猫を飼っている。その猫は白と黒の被毛を持ち緑がかった瞳をしている。孫はその猫と遊ぶのが大好きで、その猫をビビと名づけた。ビビは美しい。それは私たちのペットである。', '彼女の瞳は綺麗ですね。', 'Her eyes are beautiful.');
patch('私の孫は子猫を飼っています。その猫の毛並みは白と黒で瞳はグリーンがかっています。孫はその猫と遊ぶのが大好きで、ヴィヴィと呼んでいます。ヴィヴィは綺麗な猫で、私たちのペットです。', '瞳を閉じて聴いてください。', 'Please close your eyes and listen.');

// ── 礎 ────────────────────────────────────────────────────────────────────────
patch('基礎体温をつけています。', '基礎からしっかり学ぼう。', "Let's study thoroughly from the basics.");

// ── 稔 (BOTH sentences too long — replace both) ───────────────────────────────
patch('田中稔子氏は広島原爆の生存者であり、平和と核軍縮の擁護者として活動しています。', '稲が稔る季節になりました。', 'The season when rice ripens has come.');
patch('田中稔子さんは、広島の原爆の生存者であり、平和と核軍縮の提唱者として活動しています。', '努力が実を結んで稔りました。', 'Our efforts bore fruit.');

// ── 瑞 (BOTH sentences use archaic country kanji — replace both) ──────────────
patch('瑞西は仏蘭西・伊太利・墺太利・独逸に囲まれている。', '瑞穂の国は日本の別称です。', 'Mizuho no kuni is another name for Japan.');
patch('瑞は仏・伊・墺・独に取り囲まれている。', '彼女の瑞々しい笑顔が素敵だ。', 'Her fresh, dewy smile is lovely.');

// ── 看 ────────────────────────────────────────────────────────────────────────
patch('日本では看護婦さんは社会的地位が高いのですか。', '看板に書いてあります。', 'It says so on the sign.');

// ── 献 ────────────────────────────────────────────────────────────────────────
patch('献血は初めてですか？', '神社に食べ物を献上した。', 'I offered food at the shrine.');

// ── 曇 ────────────────────────────────────────────────────────────────────────
patch('今日は曇っている。', '空が急に曇ってきた。', 'The sky suddenly clouded over.');

// ── 由 ────────────────────────────────────────────────────────────────────────
patch('理由を聞いてもいい？', '自由に使ってください。', 'Please use it freely.');

// ── 伺 ────────────────────────────────────────────────────────────────────────
patch('喜んでお伺いします。', '先生のご意見を伺いたい。', "I'd like to hear the teacher's opinion.");

// ── 寺 ────────────────────────────────────────────────────────────────────────
patch('寺院はどこですか？', 'お寺で静かに座った。', 'I sat quietly at the temple.');

// ── 派 ────────────────────────────────────────────────────────────────────────
patch('彼はなかなか立派だ。', '彼女は活発で派手だ。', 'She is lively and flashy.');

// ── 渇 ────────────────────────────────────────────────────────────────────────
patch('喉が渇いて死にそうだよ。水をくれ！', '砂漠は渇いた大地です。', 'The desert is a dry land.');

// ── 井 ────────────────────────────────────────────────────────────────────────
patch('私は福井に向かっています。', '井戸から水を汲んだ。', 'I drew water from the well.');

// ── 祝 ────────────────────────────────────────────────────────────────────────
patch('明日は母方の祖父の還暦のお祝いをする。', '誕生日をお祝いしました。', 'I celebrated a birthday.');

// ── 暦 ────────────────────────────────────────────────────────────────────────
patch('明日は母方の祖父の還暦祝いをする。', '旧暦では何月ですか？', 'What month is it in the old calendar?');
patch('明日は母方の祖父の還暦のお祝いをする。', '暦の上では春です。', 'According to the calendar, it is spring.');

// ── 還 ────────────────────────────────────────────────────────────────────────
patch('明日は母方の祖父の還暦祝いをする。', '故郷に還りたいです。', 'I want to return to my hometown.');
patch('明日は母方の祖父の還暦のお祝いをする。', '彼は還暦を迎えました。', 'He has turned sixty years old.');

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n✅ ${fixed} patches applied  |  ⚠️  ${notFound} not found`);

writeFileSync('src/kanji.js', src, 'utf8');
console.log('💾 src/kanji.js saved.');
