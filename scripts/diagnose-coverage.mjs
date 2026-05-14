/**
 * diagnose-coverage.mjs
 * Pour chaque niveau JLPT, affiche par kanji :
 *   - Vocab KUN ✅/❌
 *   - Vocab ON  ✅/❌
 *   - Phrase KUN ✅/❌
 *   - Phrase ON  ✅/❌
 * Et un résumé : combien cochent tout, combien ont un problème, combien ont rien.
 *
 * Usage: node scripts/diagnose-coverage.mjs [--level n5]
 *        (sans --level = tous les niveaux)
 */
import { readFileSync }  from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const kuromoji = require('kuromoji');
const KUROMOJI_DIC = resolve(ROOT, 'node_modules/kuromoji/dict');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ONLY_LEVEL = args.includes('--level') ? args[args.indexOf('--level') + 1] : null;

// ── Load overrides + kanji index ──────────────────────────────────────────────
const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
function loadObj(varName) {
  const marker = `${varName} = {`;
  const start = kjText.indexOf(marker);
  if (start === -1) return {};
  let depth = 0, i = start + marker.length - 1;
  while (i < kjText.length) {
    if (kjText[i] === '{') depth++;
    else if (kjText[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return new Function('"use strict"; return (' + kjText.slice(start + marker.length - 1, i + 1) + ')')();
}
const EXAMPLE_OVERRIDE  = loadObj('EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj('SENTENCE_OVERRIDE');

const KANJI_INDEX_RAW = readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8');
const KANJI_INDEX = JSON.parse(KANJI_INDEX_RAW);

// ── Tokenizer ─────────────────────────────────────────────────────────────────
let _tokenizer = null;
async function getTokenizer() {
  if (_tokenizer) return _tokenizer;
  return new Promise((res, rej) => {
    kuromoji.builder({ dicPath: KUROMOJI_DIC }).build((err, t) => {
      if (err) return rej(err);
      _tokenizer = t;
      res(t);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toHira(s) {
  return s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function voiced(s) {
  const v = { 'か':'が','き':'ぎ','く':'ぐ','け':'げ','こ':'ご','さ':'ざ','し':'じ','す':'ず','せ':'ぜ','そ':'ぞ','た':'だ','ち':'ぢ','つ':'づ','て':'で','と':'ど','は':'ば','ひ':'び','ふ':'ぶ','へ':'べ','ほ':'ぼ' };
  return s.replace(/./g, c => v[c] || c);
}

function classifyVocab(words, kanjiData, targetKanji) {
  const kunRoots    = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
  const onRootsKata = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
  const onRootsHira = onRootsKata.map(toHira);
  const kun = [], on = [], other = [];
  for (const w of words) {
    const r = w.r || '';
    const pos = targetKanji ? (w.w || '').indexOf(targetKanji) : 0;
    let classified = false;
    if (pos === 0) {
      const km = kunRoots.find(k => r.startsWith(k)) ?? kunRoots.find(k => r.startsWith(voiced(k)));
      if (km) { kun.push(w); classified = true; }
      else {
        const oi = onRootsHira.findIndex(o => r.startsWith(o));
        if (oi >= 0) { on.push(w); classified = true; }
      }
    } else {
      const km = kunRoots.find(k => r.includes(k)) ?? kunRoots.find(k => r.includes(voiced(k)));
      if (km) { kun.push(w); classified = true; }
      else {
        const oi = onRootsHira.findIndex(o => r.includes(o));
        if (oi >= 0) { on.push(w); classified = true; }
      }
    }
    if (!classified) other.push(w);
  }
  return { kun, on, other };
}

async function detectReadingType(jp, kanji, kanjiData) {
  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(jp);
    const kunRoots = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
    const onKata   = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
    const onHira   = onKata.map(toHira);
    for (const tok of tokens) {
      if (!tok.surface_form.includes(kanji)) continue;
      const rd = tok.reading ? toHira(tok.reading) : '';
      if (!rd) continue;
      const km = kunRoots.find(k => rd.startsWith(k) || rd.includes(k) || rd.startsWith(voiced(k)) || rd.includes(voiced(k)));
      if (km) return 'kun';
      const oi = onHira.findIndex(o => rd.startsWith(o) || rd.includes(o));
      if (oi >= 0) return 'on';
    }
  } catch {}
  return null;
}

// ── Fetch N1-N5 lists ─────────────────────────────────────────────────────────
const LEVELS = ONLY_LEVEL ? [ONLY_LEVEL] : ['n5','n4','n3','n2','n1'];
const lists = {};
for (const lv of LEVELS) {
  const r = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${lv.replace('n','')}`);
  lists[lv] = r.ok ? await r.json() : [];
}

// ── Analyse ───────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════');
console.log('  DIAGNOSTIC COUVERTURE — KUN/ON vocab + phrases');
console.log('════════════════════════════════════════════════════════════════\n');

for (const lv of LEVELS) {
  const kanji_list = lists[lv];
  let perfect = 0;   // all 4 boxes
  let partial = [];  // has something but not all 4
  let empty   = [];  // nothing (0 vocab, 0 sentences)

  process.stdout.write(`\n── ${lv.toUpperCase()} (${kanji_list.length} kanji) ── analyse en cours...\n`);

  for (const k of kanji_list) {
    const kd = KANJI_INDEX[k] || {};
    const hasKunReadings = (kd.k || []).length > 0;
    const hasOnReadings  = (kd.o || []).length > 0;

    // ── Vocab classification ──
    const vocab = EXAMPLE_OVERRIDE[k] || [];
    const { kun: vKun, on: vOn } = classifyVocab(vocab, kd, k);
    const vocabKun = vKun.length > 0;
    const vocabOn  = vOn.length > 0;

    // ── Sentence KUN/ON detection ──
    const sentences = SENTENCE_OVERRIDE[k] || [];
    let phraseKun = false, phraseOn = false;
    for (const s of sentences.slice(0, 2)) {
      if (!s.jp) continue;
      const type = await detectReadingType(s.jp, k, kd);
      if (type === 'kun') phraseKun = true;
      if (type === 'on')  phraseOn  = true;
    }

    // ── A kanji with only KUN (no ON readings) — ON n'est pas requis ──
    const needOn  = hasOnReadings;
    const needKun = hasKunReadings;

    const vocabKunOk  = !needKun  || vocabKun;
    const vocabOnOk   = !needOn   || vocabOn;
    const phraseKunOk = !needKun  || phraseKun;
    const phraseOnOk  = !needOn   || phraseOn;

    const score = [vocabKunOk, vocabOnOk, phraseKunOk, phraseOnOk].filter(Boolean).length;
    const total = [needKun, needOn, needKun, needOn].filter(Boolean).length * 2; // max possible
    // Simpler: just count which of the 4 absolute checks pass
    const boxes = {
      vKun: vocabKun,
      vOn:  vocabOn,
      pKun: phraseKun,
      pOn:  phraseOn,
    };
    const applicable = (needKun ? 2 : 0) + (needOn ? 2 : 0); // how many boxes apply
    const passed     = (needKun && vocabKun ? 1 : 0)
                     + (needOn  && vocabOn  ? 1 : 0)
                     + (needKun && phraseKun ? 1 : 0)
                     + (needOn  && phraseOn  ? 1 : 0);

    const hasSentences = sentences.length > 0;
    const hasVocab     = vocab.length > 0;

    if (!hasSentences && !hasVocab) {
      empty.push(k);
    } else if (applicable === 0 || passed === applicable) {
      perfect++;
    } else {
      partial.push({
        k,
        vKun, vOn, phraseKun, phraseOn,
        needKun, needOn,
        missing: [
          (!vocabKun  && needKun)  ? 'vocab-KUN'  : null,
          (!vocabOn   && needOn)   ? 'vocab-ON'   : null,
          (!phraseKun && needKun)  ? 'phrase-KUN' : null,
          (!phraseOn  && needOn)   ? 'phrase-ON'  : null,
        ].filter(Boolean)
      });
    }
  }

  // ── Summary ──
  const total = kanji_list.length;
  console.log(`\n${lv.toUpperCase()} — Résultats :`);
  console.log(`  ✅ Parfait (toutes cases cochées) : ${perfect}/${total} (${Math.round(perfect/total*100)}%)`);
  console.log(`  ⚠️  Partiel (manque au moins 1)   : ${partial.length}/${total} (${Math.round(partial.length/total*100)}%)`);
  console.log(`  ❌ Vide (aucun vocab ni phrase)   : ${empty.length}/${total} (${Math.round(empty.length/total*100)}%)`);

  if (partial.length > 0) {
    // Group by missing pattern
    const byMissing = {};
    for (const p of partial) {
      const key = p.missing.join('+');
      byMissing[key] = (byMissing[key] || 0) + 1;
    }
    console.log(`\n  Détail des problèmes partiels :`);
    for (const [pattern, count] of Object.entries(byMissing).sort((a,b) => b[1]-a[1])) {
      console.log(`    manque [${pattern}] : ${count} kanji`);
    }
    if (partial.length <= 30) {
      console.log(`\n  Kanji en cause :`);
      for (const p of partial) {
        const flags = [
          p.vKun  ? '✅vKUN' : '❌vKUN',
          p.vOn   ? '✅vON'  : (p.needOn ? '❌vON' : '—vON'),
          p.phraseKun ? '✅pKUN' : '❌pKUN',
          p.phraseOn  ? '✅pON'  : (p.needOn ? '❌pON' : '—pON'),
        ].join(' ');
        console.log(`    ${p.k}  ${flags}`);
      }
    }
  }
  if (empty.length > 0 && empty.length <= 20) {
    console.log(`\n  Kanji vides : ${empty.join(' ')}`);
  }
}

console.log('\n════════════════════════════════════════════════════════════════\n');
