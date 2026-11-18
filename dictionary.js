const PARTS_OF_SPEECH = /^(?:noun|proper noun|verb|adjective|adverb|pronoun|preposition|postposition|conjunction|interjection|determiner|article|particle|numeral|phrase|proverb|idiom|prefix|suffix|abbreviation|initialism|letter|symbol)$/i;

const text = node => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const unique = (items, limit) => [...new Set(items.filter(Boolean))].slice(0, limit);
const site = language => `https://${language}.wiktionary.org`;

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
  const definitions = new Map();
  const examples = [];
  const collocations = [];
  const translations = [];
  let section = '';
  let etymologyHeading = '';

  for (const {node, heading} of englishSection(html)) {
    if (heading) {
      section = (heading.id || heading.querySelector('.mw-headline')?.id || text(heading))
        .replace(/_/g, ' ').replace(/ \d+$/, '');
      etymologyHeading = (heading.id || heading.querySelector('.mw-headline')?.id || text(heading)).replace(/_/g, ' ');
      continue;
    }
    if (section === 'Etymology' && (node.matches('p,ul,ol'))) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('.reference, style').forEach(item => item.remove());
      if (text(copy)) etymologies.push(`${etymologyHeading} · ${text(copy)}`);
      roots.push(...etymologyParts(node));
    }
    if (PARTS_OF_SPEECH.test(section) && node.matches('ol')) {
      if (!definitions.has(section)) definitions.set(section, []);
      const senses = definitions.get(section);
      for (const item of node.children) {
        const sense = senseText(item);
        if (sense) senses.push(`${section} · ${sense}`);
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
    definitions: unique([...definitions.values()].flatMap(senses => unique(senses, 8)), 32),
    examples: unique(examples, 6),
    collocations: unique(collocations, 6),
    translations: unique(translations, 12)
  };
}

export function parseChineseEntry(html) {
  return unique(englishSection(html).flatMap(({node}) => node.matches('ol')
    ? [...node.children].map(senseText).filter(sense => /\p{Script=Han}/u.test(sense))
    : []), 12);
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
  const english = await findEntry('en', word, signal);
  const info = parseEnglishEntry(english?.text || '');
  let chinese = null;
  let partial = false;

  if (!hasOfflineGloss && !info.translations.length) {
    try {
      chinese = await findEntry('zh', word, signal);
      info.translations = parseChineseEntry(chinese?.text || '');
    } catch(error) {
      if (signal.aborted) throw error;
      partial = true;
    }
  }

  return {
    ...info,
    englishRevision: english?.revid || null,
    chineseRevision: chinese?.revid || null,
    found: Object.values(info).some(entries => entries.length),
    partial,
    lookedUpAt: new Date().toISOString()
  };
}
