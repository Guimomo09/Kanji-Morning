import { normMeaning } from './utils.js';
import { cloudUpdate } from './cloud.js'; // circular ok — only called inside function bodies

export function loadLearnedWords() {
  try {
    const raw = localStorage.getItem('learned_words');
    if (!raw) return { byWord: new Set(), byMeaning: new Set() };
    const obj = JSON.parse(raw);
    return {
      byWord:    new Set(obj.byWord    || []),
      byMeaning: new Set(obj.byMeaning || []),
    };
  } catch { return { byWord: new Set(), byMeaning: new Set() }; }
}

export function saveLearnedWords(learned) {
  try {
    localStorage.setItem('learned_words', JSON.stringify({
      byWord:    [...learned.byWord],
      byMeaning: [...learned.byMeaning],
    }));
  } catch {}
}

export function markWordsLearned(items) {
  const learned = loadLearnedWords();
  items.forEach(it => {
    learned.byWord.add(it.word);
    learned.byMeaning.add(normMeaning(it.meaning));
  });
  saveLearnedWords(learned);
  cloudUpdate({ learnedWords: { byWord: [...learned.byWord], byMeaning: [...learned.byMeaning] } });
}

export function isLearned(item, learned) {
  if (learned.byWord.has(item.word)) return true;
  if (learned.byMeaning.has(normMeaning(item.meaning))) return true;
  return false;
}

export function forgetWord(word) {
  const learned = loadLearnedWords();
  learned.byWord.delete(word);
  saveLearnedWords(learned);
  cloudUpdate({ learnedWords: { byWord: [...learned.byWord], byMeaning: [...learned.byMeaning] } });
}
