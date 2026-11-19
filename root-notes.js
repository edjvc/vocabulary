export const ROOT_NOTES_FORMAT = 'vocabulary-root-notes';
const BODY_FIELDS = ['split','key_origin','mnemonic'];

function httpsSources(sources) {
  return Array.isArray(sources) && sources.length > 0 && sources.every(source => {
    if (typeof source?.title !== 'string' || !source.title.trim() || typeof source.url !== 'string') return false;
    try { return new URL(source.url).protocol === 'https:'; }
    catch { return false; }
  });
}

export async function loadRootNotes(core) {
  const response = await fetch('./data/root-notes.json',{cache:'no-cache'});
  if (!response.ok) throw Error(`字根記憶 HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.format !== ROOT_NOTES_FORMAT || payload.schema_version !== 1 ||
      !Array.isArray(payload.entries) || payload.entries.length !== payload.entry_count ||
      payload.core_word_count !== core.length) {
    throw Error('字根記憶資料格式不符');
  }
  const coreWords = new Map(core.map(({id,word})=>[id,word]));
  const notes = new Map();
  for (const note of payload.entries) {
    if (typeof note?.word !== 'string' || coreWords.get(note.id) !== note.word || notes.has(note.id) ||
        !BODY_FIELDS.every(field=>typeof note[field] === 'string' && note[field].trim()) || !httpsSources(note.sources)) {
      throw Error('字根記憶與核心詞條無法對應');
    }
    notes.set(note.id,note);
  }
  return notes;
}
