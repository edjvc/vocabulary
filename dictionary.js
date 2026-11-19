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

function sectionTitle(heading) {
  return (heading.id || heading.querySelector('.mw-headline')?.id || text(heading)).replace(/_/g, ' ');
}

export function parseEnglishEntry(html) {
  const examples = [];
  const collocations = [];
  const translations = [];
  let section = '';

  for (const {node, heading} of englishSection(html)) {
    if (heading) {
      section = sectionTitle(heading).replace(/ \d+$/, '');
      continue;
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
    examples: unique(examples, 6),
    collocations: unique(collocations, 6),
    translations: unique(translations, 12)
  };
}

export function parseChineseEntry(html) {
  let inEtymology = false;
  const translations = [];
  for (const {node,heading} of englishSection(html)) {
    if (heading) {
      inEtymology = /^(?:詞源|词源|語源|语源|字源)(?:\s*\d+)?$/.test(sectionTitle(heading));
      continue;
    }
    if (!inEtymology && node.matches('ol')) {
      translations.push(...[...node.children].map(senseText).filter(sense => /\p{Script=Han}/u.test(sense)));
    }
  }
  return unique(translations,12);
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
