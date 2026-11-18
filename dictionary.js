const PARTS_OF_SPEECH = /^(?:noun|proper noun|verb|adjective|adverb|pronoun|preposition|postposition|conjunction|interjection|determiner|article|particle|numeral|phrase|proverb|idiom|prefix|suffix|abbreviation|initialism|letter|symbol)$/i;

const text = node => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const unique = (items, limit) => [...new Set(items.filter(Boolean))].slice(0, limit);
const site = language => `https://${language}.wiktionary.org`;
const languageNames = {
  'Middle English':'中古英語', 'Old English':'古英語', 'Anglo-Norman':'盎格魯諾曼語',
  'Middle French':'中古法語', 'Old French':'古法語', 'French':'法語',
  'Late Latin':'晚期拉丁語', 'Medieval Latin':'中世紀拉丁語', 'Vulgar Latin':'通俗拉丁語',
  'New Latin':'新拉丁語', 'Latin':'拉丁語', 'Ancient Greek':'古希臘語', 'Greek':'希臘語',
  'Proto-West Germanic':'原始西日耳曼語', 'Proto-Germanic':'原始日耳曼語',
  'Proto-Indo-European':'原始印歐語', 'Old Norse':'古諾斯語', 'German':'德語',
  'Middle Dutch':'中古荷蘭語', 'Dutch':'荷蘭語', 'Italian':'義大利語', 'Spanish':'西班牙語',
  'Portuguese':'葡萄牙語', 'Arabic':'阿拉伯語', 'Persian':'波斯語', 'Sanskrit':'梵語',
  'Hindi':'印地語', 'Japanese':'日語', 'Mandarin':'華語', 'Chinese':'中文'
};
const originPattern = new RegExp(
  `\\b(?:(not)\\s+)?(?:from|via) (${Object.keys(languageNames).join('|')})` +
  String.raw`\s+(\*?\p{L}[\p{L}\p{M}'’\-]*)(?=[\s,;.:()“”]|$)`,
  'giu'
);
const nonTerms = /^(?:a|an|the|and|or|of|in|as|for|by|with|to|via|see|which|while|where|meaning|word|form|pronunciation)$/i;

export function summarizeEtymologies(etymologies, roots = []) {
  const parts = [];
  for (const entry of etymologies) {
    const attested = entry.match(/\b(?:first attested|first recorded|first used)\s+(?:in\s+)?(\d{3,4})\b/i);
    const stages = unique([...entry.matchAll(originPattern)].flatMap(([,negated,language,form]) => {
      const name = Object.keys(languageNames).find(key => key.toLowerCase() === language.toLowerCase());
      return negated || nonTerms.test(form) ? [] : [`${languageNames[name]} ${form}`];
    }), 8);
    const sentence = [
      attested ? `詞典記載最早見於 ${attested[1]} 年。` : '',
      stages.length ? `詞源記載提及${stages.join('、')}。` : ''
    ].join('');
    if (sentence && /\b(?:possibly|perhaps|probably|uncertain|unclear)\b/i.test(entry)) {
      parts.push(`${sentence}原文含有推測或不確定的說明。`);
    } else if (sentence) {
      parts.push(sentence);
    }
  }
  if (roots.length) parts.push(`詞源列出的構詞組合為 ${roots.map(root => root.replace(/\s*\+\s*/g,' ＋ ')).join('、')}。`);
  return unique(parts, 9);
}

export function dictionarySourceURL(language, revision, word) {
  const origin = site(language === 'zh' ? 'zh' : 'en');
  return Number.isSafeInteger(revision) && revision > 0
    ? `${origin}/w/index.php?oldid=${revision}`
    : `${origin}/wiki/${encodeURIComponent(word)}`;
}

function englishSection(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') || doc.body;
  const section = [];
  let inEnglish = false;

  for (const node of root.children) {
    const heading = node.matches('h2,h3,h4,h5,h6') ? node
      : node.matches('.mw-heading') ? node.querySelector('h2,h3,h4,h5,h6') : null;
    if (heading?.tagName === 'H2') {
      if (inEnglish) break;
      const title = heading.id || heading.querySelector('.mw-headline')?.id || text(heading);
      inEnglish = ['English', '英語', '英语', '英文'].includes(title);
      continue;
    }
    if (inEnglish) section.push({node, heading});
  }
  return section;
}

function senseText(item) {
  const copy = item.cloneNode(true);
  copy.querySelectorAll('dl,ul,ol,table,.reference,style').forEach(node => node.remove());
  return text(copy);
}

function sectionTitle(heading) {
  return (heading.id || heading.querySelector('.mw-headline')?.id || text(heading)).replace(/_/g, ' ');
}

function etymologyParts(paragraph) {
  const copy = paragraph.cloneNode(true);
  copy.querySelectorAll('[class*="mention-gloss"], .ann-pos, .reference').forEach(node => node.remove());
  const terms = [];
  for (const mention of copy.querySelectorAll('.mention[lang]')) {
    terms.push(text(mention));
    mention.replaceWith(`§${terms.length - 1}§`);
  }
  const normalized = text(copy).replace(/[\u200e\u200f]/g, '');
  return [...normalized.matchAll(/§\d+§(?:\s*\+\s*§\d+§)+/g)].map(([chain]) =>
    chain.replace(/§(\d+)§/g, (_, index) => terms[Number(index)]));
}

export function parseEnglishEntry(html) {
  const etymologies = [];
  const roots = [];
  const examples = [];
  const collocations = [];
  const translations = [];
  let section = '';
  let etymologyHeading = '';

  for (const {node, heading} of englishSection(html)) {
    if (heading) {
      etymologyHeading = sectionTitle(heading);
      section = etymologyHeading.replace(/ \d+$/, '');
      continue;
    }
    if (section === 'Etymology' && (node.matches('p,ul,ol'))) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('.reference, style').forEach(item => item.remove());
      if (text(copy)) etymologies.push(`${etymologyHeading} · ${text(copy)}`);
      roots.push(...etymologyParts(node));
    }
    if (PARTS_OF_SPEECH.test(section) && node.matches('ol')) {
      for (const item of node.children) {
        for (const example of item.querySelectorAll('.h-usage-example .e-example[lang="en"]')) {
          const output = example.closest('.collocation') ? collocations : examples;
          output.push(text(example));
        }
      }
    }
    if (section === 'Translations') {
      for (const word of node.querySelectorAll('.Hant[lang="cmn"], .Hant[lang="zh"]')) {
        translations.push(text(word));
      }
    }
  }

  return {
    etymologies: unique(etymologies, 8),
    roots: unique(roots, 8),
    examples: unique(examples, 6),
    collocations: unique(collocations, 6),
    translations: unique(translations, 12)
  };
}

export function parseChineseEntry(html) {
  let inEtymology = false;
  const translations = [];
  const etymologiesZh = [];
  for (const {node,heading} of englishSection(html)) {
    if (heading) {
      inEtymology = /^(?:詞源|词源|語源|语源|字源)(?:\s*\d+)?$/.test(sectionTitle(heading));
      continue;
    }
    if (inEtymology && node.matches('p,ul,ol')) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('.reference,style').forEach(item => item.remove());
      if (/\p{Script=Han}/u.test(text(copy))) etymologiesZh.push(text(copy));
    } else if (node.matches('ol')) {
      translations.push(...[...node.children].map(senseText).filter(sense => /\p{Script=Han}/u.test(sense)));
    }
  }
  return {translations:unique(translations,12),etymologiesZh:unique(etymologiesZh,8)};
}

async function fetchEntry(language, word, signal) {
  const params = new URLSearchParams({
    action:'parse', page:word, prop:'text|revid', format:'json', formatversion:'2',
    origin:'*', redirects:'1', ...(language === 'zh' ? {uselang:'zh-tw'} : {})
  });
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  signal.addEventListener('abort', abort, {once:true});
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetch(`${site(language)}/w/api.php?${params}`, {
      signal:attempt.signal, credentials:'omit', referrerPolicy:'no-referrer'
    });
    if (!response.ok) throw Error(`Wiktionary HTTP ${response.status}`);
    const data = await response.json();
    if (data.error?.code === 'missingtitle') return null;
    if (typeof data.parse?.text !== 'string') throw Error('Wiktionary 查詢失敗');
    return data.parse;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function findEntry(language, word, signal) {
  const exact = await fetchEntry(language, word, signal);
  if (exact || word === word.toLowerCase()) return exact;
  return fetchEntry(language, word.toLowerCase(), signal);
}

export async function lookupDictionary(word, hasOfflineGloss, signal) {
  const [en,zh] = await Promise.allSettled([
    findEntry('en', word, signal), lookupChineseEtymology(word, signal)
  ]);
  if (en.status === 'rejected' && zh.status === 'rejected') throw en.reason;
  const english = en.value;
  const chinese = zh.value || {};
  const info = parseEnglishEntry(english?.text || '');
  if (!hasOfflineGloss && !info.translations.length && chinese.translations) info.translations = chinese.translations;

  return {
    ...info,
    etymologiesZh: chinese.etymologiesZh || [],
    chineseEtymologyChecked: zh.status === 'fulfilled',
    englishRevision: english?.revid || null,
    chineseRevision: chinese.chineseRevision || null,
    found: Boolean(chinese.etymologiesZh?.length || Object.values(info).some(entries => entries.length)),
    partial: en.status === 'rejected' || zh.status === 'rejected',
    lookedUpAt: new Date().toISOString()
  };
}

let traditionalConverter;
export async function lookupChineseEtymology(word, signal) {
  const page = await findEntry('zh', word, signal);
  const content = parseChineseEntry(page?.text || '');
  if (content.etymologiesZh.length) {
    traditionalConverter ||= import('./vendor/opencc-cn2t.js')
      .then(({Converter}) => Converter({from:'cn',to:'tw'}))
      .catch(error => {traditionalConverter = null; throw error;});
    const convert = await traditionalConverter;
    content.etymologiesZh = content.etymologiesZh.map(entry => convert(entry));
  }
  return {...content,chineseRevision:page?.revid || null};
}
