import {Marked} from './vendor/marked.esm.js';

const sections = [['split','拆解'], ['key_origin','關鍵來源'], ['mnemonic','助記']];
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));

function escapeLegacyText(text) {
  return text.replace(/[\\`*_~\[\]<>&|]/g, '\\$&')
    .replace(/^( {0,3})([#=+-])/gm, '$1\\$2')
    .replace(/^( {0,3}\d{1,9})([.)])(?=[ \t])/gm, '$1\\$2');
}

export function rootNoteMarkdown(value,sources = []) {
  const body = typeof value === 'string' ? value : sections
    .filter(([key]) => value?.[key]?.trim())
    .map(([key,label]) => `**${label}**　${escapeLegacyText(value[key])}`)
    .join('\n\n');
  if (!body.trim() || !sources.length) return body;
  const links = sources.flatMap(({title,url}) => {
    const href = webURL(url);
    return href ? [`[${escapeLegacyText(title)}](<${href}>)`] : [];
  });
  return links.length ? `${body}\n\n原始資料來源　${links.join(' · ')}` : body;
}

export function isRootNoteValue(value) {
  return typeof value === 'string' || (value != null &&
    sections.every(([key]) => typeof value[key] === 'string'));
}

function webURL(href) {
  try {
    const url = new URL(href);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // Markdown may contain links that are plain text in the app.
  }
  return '';
}

const markdown = new Marked({
  gfm:true,
  breaks:true,
  walkTokens(token) {
    // Text inside raw HTML must also go through the normal HTML escaping.
    if (token.type === 'text' || token.type === 'code') token.escaped = false;
  },
  renderer: {
    html({text}) {
      return escapeHtml(text);
    },
    link({href,title,tokens}) {
      const label = this.parser.parseInline(tokens);
      const url = webURL(href);
      if (!url) return label;
      const tooltip = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(url)}" class="external-lookup" target="_blank" rel="noopener noreferrer"${tooltip}>${label}</a>`;
    },
    image({text}) {
      return escapeHtml(text);
    }
  }
});

export function renderRootNoteMarkdown(text) {
  return markdown.parse(text);
}
