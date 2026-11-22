import {getAll,saveRecord,deleteRecord,replaceRecords} from './db.js';
import {lookupDictionary,dictionarySourceURL} from './dictionary.js';
import {loadRootNotes} from './root-notes.js';
import {isRootNoteValue,renderRootNoteMarkdown,rootNoteMarkdown} from './root-note-markdown.js';

const $ = id => document.getElementById(id);
const state = {core:[], coreMeta:null, records:new Map(), current:null, queue:[], filter:'all', libraryFilter:'all', lastDrawn:null, reviewHistory:[], reviewPosition:-1, searchLimit:70, detailKey:null, totalDrawn:0, revealedKey:null};
const lookups = new Map();
const lookupErrors = new Set();
let glosses = {};
let glossesReady;
let rootNotes = new Map();
let rootNotesStatus = 'loading';
let rootNoteEditor = null;
let detailNoteEditor = null;
let pendingCustomLookup;
let addingWord = false;
// Existing IDs keep their meaning in IndexedDB and previously exported backups.
const familiarityLevels = [
  {grade:3,label:'熟悉'},
  {grade:4,label:'僅發音不熟'},
  {grade:2,label:'不熟'},
  {grade:1,label:'陌生'},
  {grade:0,label:'未標記'},
];
const validGrades = familiarityLevels.map(({grade})=>grade);
const familiarityLabel = grade => familiarityLevels.find(level=>level.grade===grade)?.label || '未標記';
const now = () => new Date().toISOString();
// This records the last export initiated on this device. Browser downloads cannot
// confirm that the user actually saved the JSON to Files or iCloud Drive.
const lastBackupKey = 'ed-vocabulary:last-backup-export';
const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const twoDigits = number => String(number).padStart(2,'0');
function formatLastBackup(date) {
  const hours = date.getHours();
  const hours12 = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  return `${twoDigits(date.getMonth()+1)}-${twoDigits(date.getDate())} ${shortDays[date.getDay()]} ${hours12}:${twoDigits(date.getMinutes())} ${ampm}`;
}
// A device label is local to this installation and intentionally excluded from
// restore. The backup JSON may carry it as source metadata only.
const deviceNameKey = 'ed-vocabulary:device-name';
function detectedDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows-PC';
  return 'My-Device';
}
let deviceName = detectedDeviceName();
const backupFileName = 'english-vocabulary-app-backup.json';
function loadDeviceName() {
  try {
    const saved = localStorage.getItem(deviceNameKey);
    if (saved && saved.trim()) deviceName = saved.trim();
  } catch (err) {
    console.warn('無法讀取本機設備名稱', err);
  }
  $('device-name-input').value = deviceName;
}
function saveDeviceName() {
  const input = $('device-name-input');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    $('device-name-state').textContent = '請輸入設備名稱。';
    input.focus();
    return;
  }
  try {
    localStorage.setItem(deviceNameKey, name);
    deviceName = name;
    input.value = name;
    renderLastBackup(lastBackupDate);
    $('device-name-state').textContent = '已儲存在這台設備，不會被匯入的備份覆蓋。';
    showToast('設備名稱已儲存');
  } catch (err) {
    console.warn('無法儲存本機設備名稱', err);
    $('device-name-state').textContent = '儲存失敗，請檢查網站儲存權限。';
  }
}
let lastBackupDate = null;
function renderLastBackup(date) {
  lastBackupDate = date;
  const label = $('last-backup-time');
  label.textContent = date ? formatLastBackup(date) : '尚未備份';
  if (date) label.setAttribute('datetime',date.toISOString());
  else label.removeAttribute('datetime');
}
function loadLastBackup() {
  try {
    const saved = localStorage.getItem(lastBackupKey);
    if (!saved) return renderLastBackup(null);
    const date = new Date(saved);
    renderLastBackup(Number.isNaN(date.getTime()) ? null : date);
  } catch (err) {
    console.warn('無法讀取上次備份時間',err);
    renderLastBackup(null);
  }
}
function storeLastBackup(date) {
  renderLastBackup(date);
  try { localStorage.setItem(lastBackupKey,date.toISOString()); }
  catch (err) { console.warn('無法保存上次備份時間',err); }
}
function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2,'0');
  const day = String(date.getDate()).padStart(2,'0');
  return `${date.getFullYear()}-${month}-${day}`;
}
const normalizeSpaces = word => word.trim().replace(/\s+/g,' ');
const canonical = word => normalizeSpaces(word).toLocaleLowerCase('en');
const duplicateKey = word => canonical(word).normalize('NFC').replace(/[‘’]/g,"'");
const validNewWord = word => word.length <= 100 && /^\p{Script=Latin}[\p{Script=Latin}\p{Mark}\s'’-]*$/u.test(word);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyFor = (type,word) => `${type}:${type === 'core' ? word : canonical(word)}`;
const cambridge = word => `https://dictionary.cambridge.org/search/english/direct/?q=${encodeURIComponent(word)}`;
const etymonline = word => `https://www.etymonline.com/search?q=${encodeURIComponent(word)}`;
const rootNotePrompt = word => `請為 ${word} 寫一張繁中字根卡。先說明現代構詞，再追溯一個最有助記憶的字根或原詞。助記請用一句聯想或常見搭配，把詞源連到現代用法。詞源不確定就直說。

只輸出一個 Markdown 程式碼區塊，內容嚴格照下面三段排版。每段的粗體標籤後接一個全形空格，段落之間空一行：

**拆解**　……

**關鍵來源**　……

**助記**　……

省略單字標題、音標、獨立翻譯、網址、連結、圖片、引用標記和來源清單。區塊外也不要加文字。`;
const chatgptLookup = word => `https://chatgpt.com/?q=${encodeURIComponent(rootNotePrompt(word))}&hints=search&temporary-chat=true`;
const records = () => Array.from(state.records.values());
const recordFor = item => state.records.get(item.key) || {key:item.key, word:item.word, grade:0, note:'', added_at:null, updated_at:null};
const isCore = item => item.key.startsWith('core:');
const getWords = () => [
  ...state.core.map(w => ({key:keyFor('core',w.word),id:w.id,word:w.word,type:'core'})),
  ...records().filter(r => r.key.startsWith('custom:')).map(r=>({key:r.key,word:r.word,type:'custom'}))
];
const showToast = (message) => {const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2600);};
const setSaving = text => $('saving').textContent=text;
let pendingWrites = 0;
async function write(item, changes, options){
  pendingWrites++;
  $('export-btn').disabled = true;
  setSaving('儲存中…');
  try {
    const updatedAt = now();
    const saved = await saveRecord(recordFor(item), record=>({
      ...(typeof changes === 'function' ? changes(record) : changes),
      updated_at:updatedAt
    }),options);
    if (!saved) {
      if (pendingWrites === 1) setSaving('本機儲存已啟用');
      return null;
    }
    state.records.set(saved.key,saved);
    if (pendingWrites === 1) setSaving('已自動儲存');
    return saved;
  } catch(err){
    console.error(err);
    setSaving('儲存失敗');
    showToast('儲存失敗，請檢查瀏覽器儲存空間後重試');
    return false;
  } finally {
    pendingWrites--;
    $('export-btn').disabled = pendingWrites > 0;
  }
}
function offlineGloss(item){
  if (Object.hasOwn(glosses,item.word)) return glosses[item.word];
  const lower = canonical(item.word);
  return !isCore(item) && Object.hasOwn(glosses,lower) ? glosses[lower] : '';
}
function dictionarySections(item){
  const record = recordFor(item);
  const dictionary = record.dictionary;
  const local = offlineGloss(item);
  const translated = dictionary?.translations?.join('、') || '';
  return {
    meaning: local || record.meaning || translated,
    examples: dictionary?.examples?.join('\n\n') || record.examples || '',
    collocations: dictionary?.collocations?.join('\n') || '',
    meaningSource: local ? 'ECDICT · 臺灣繁體轉換' : translated ? '維基詞典中文資料 · 字形依原文' : ''
  };
}
function editableRootNote(item, record){
  const bundled = rootNotes.get(item.id);
  // Older records displayed the bundled sources outside the saved note.
  const sources = record.rootNoteSourcesInline === true ? [] : bundled?.sources;
  return rootNoteMarkdown(record.rootNote ?? bundled,sources);
}
function renderRootNotes(item){
  const record = recordFor(item);
  const personal = record.rootNote;
  const note = editableRootNote(item,record);
  const hasText = Boolean(note.trim());
  const editor = rootNoteEditor?.key === item.key ? rootNoteEditor : null;
  const button = $('root-note-toggle');
  button.textContent = editor ? '儲存' : '編輯';
  button.setAttribute('aria-expanded',String(Boolean(editor)));
  button.disabled = Boolean(editor?.saving) || (personal == null && isCore(item) && rootNotesStatus === 'loading');
  $('root-note-editor').hidden = !editor;
  $('root-note-editor').disabled = Boolean(editor?.saving);
  const content = $('root-note-content');
  content.hidden = Boolean(editor) || !hasText;
  content.innerHTML = content.hidden ? '' : renderRootNoteMarkdown(note);
  $('root-note-status').hidden = Boolean(editor) || hasText;
  $('root-note-status').textContent = !isCore(item) || personal != null ? '尚無字根記憶。'
    : rootNotesStatus === 'loading' ? '正在讀取字根記憶…'
    : rootNotesStatus === 'error' ? '暫時無法載入字根記憶。'
    : '這個單字的字根記憶尚未整理。';
}
function startRootNoteEdit(item, savedEdit){
  const initial = savedEdit
    ? rootNoteMarkdown(savedEdit.initial)
    : editableRootNote(item,recordFor(item));
  rootNoteEditor = {key:item.key,initial,saving:false};
  const input = $('root-note-editor');
  input.value = rootNoteMarkdown(savedEdit?.draft ?? initial);
  $('root-note-feedback').textContent = '';
  renderRootNotes(item);
  if (!savedEdit) input.focus();
}
async function toggleRootNoteEdit(item){
  const editor = rootNoteEditor;
  if (!editor) {
    startRootNoteEdit(item);
    return;
  }
  if (editor.saving) return;
  const value = $('root-note-editor').value;
  const changed = value !== editor.initial;
  if (changed) {
    editor.saving = true;
    $('root-note-feedback').textContent = '儲存中…';
    renderRootNotes(item);
    const saved = await write(item,{rootNote:value,rootNoteSourcesInline:true},{existingOnly:!isCore(item)});
    if (rootNoteEditor !== editor) return;
    if (!saved) {
      editor.saving = false;
      $('root-note-feedback').textContent = '儲存失敗，請再試一次。';
      renderRootNotes(item);
      return;
    }
  }
  rootNoteEditor = null;
  takeLookupReturn();
  $('root-note-feedback').textContent = changed ? '字根記憶已儲存' : '';
  renderRootNotes(item);
  $('root-note-toggle').focus({preventScroll:true});
}
function renderDetailNote(item){
  const editor = detailNoteEditor?.key === item.key ? detailNoteEditor : null;
  const note = recordFor(item).note || '';
  const content = $('detail-note-content');
  content.textContent = note || '尚無筆記。';
  content.classList.toggle('muted', !note);
  content.hidden = Boolean(editor);
  const input = $('detail-note');
  input.hidden = !editor;
  input.disabled = Boolean(editor?.saving);
  const button = $('detail-note-toggle');
  button.textContent = editor ? '儲存' : '編輯';
  button.setAttribute('aria-expanded',String(Boolean(editor)));
  button.disabled = Boolean(editor?.saving);
}
function startDetailNoteEdit(item, savedEdit){
  const initial = savedEdit ? String(savedEdit.initial ?? '') : (recordFor(item).note || '');
  detailNoteEditor = {key:item.key, initial, saving:false};
  $('detail-note').value = savedEdit ? String(savedEdit.draft ?? initial) : initial;
  $('note-saved').textContent = '';
  renderDetailNote(item);
  if (!savedEdit) $('detail-note').focus();
}
async function toggleDetailNoteEdit(item){
  const editor = detailNoteEditor;
  if (!editor) {
    startDetailNoteEdit(item);
    return;
  }
  if (editor.saving) return;
  const value = $('detail-note').value;
  const changed = value !== editor.initial;
  if (changed) {
    editor.saving = true;
    $('note-saved').textContent = '儲存中…';
    renderDetailNote(item);
    const saved = await write(item,{note:value},{existingOnly:!isCore(item)});
    if (detailNoteEditor !== editor) return;
    if (!saved) {
      editor.saving = false;
      $('note-saved').textContent = '儲存失敗，請再試一次。';
      renderDetailNote(item);
      return;
    }
  }
  detailNoteEditor = null;
  $('note-saved').textContent = changed ? '筆記已儲存' : '';
  renderDetailNote(item);
  $('detail-note-toggle').focus({preventScroll:true});
}
function requestDetailClose(){
  const editor = rootNoteEditor;
  const noteEditor = detailNoteEditor;
  if (editor?.saving || noteEditor?.saving) return;
  const unsavedRoot = editor && $('root-note-editor').value !== editor.initial;
  const unsavedNote = noteEditor && $('detail-note').value !== noteEditor.initial;
  if ((unsavedRoot || unsavedNote) &&
      !window.confirm('有尚未儲存的字根記憶或筆記。要捨棄變更並關閉嗎？')) return;
  rootNoteEditor = null;
  detailNoteEditor = null;
  if (editor || noteEditor) takeLookupReturn();
  $('detail-dialog').close();
}
async function initializeRootNotes(){
  try {
    rootNotes = await loadRootNotes(state.core);
    const total = state.core.length.toLocaleString();
    $('root-notes-count').textContent = `字根記憶已整理 ${rootNotes.size.toLocaleString()} / ${total} 字`;
    rootNotesStatus = 'ready';
  } catch(error) {
    console.warn(error);
    $('root-notes-count').textContent = '暫時無法載入字根記憶。';
    rootNotesStatus = 'error';
  }
  const item = $('detail-dialog').open && getWords().find(w=>w.key===state.detailKey);
  if (item) renderRootNotes(item);
}
function renderDictionary(item){
  const data = dictionarySections(item);
  for (const field of ['meaning','examples']) {
    $('detail-' + field).textContent = data[field] || '查無資料';
  }
  $('detail-collocations').textContent = data.collocations;
  $('detail-collocation-section').hidden = !data.collocations;
  $('detail-meaning-source').textContent = data.meaningSource;
  const record = recordFor(item);
  const dictionary = record.dictionary;
  const source = $('detail-source');
  source.replaceChildren();
  if (dictionary?.found) {
    const editions = [['en',dictionary.englishRevision,'英語維基詞典'], ['zh',dictionary.chineseRevision,'中文維基詞典']];
    for (const [language,revision,label] of editions) {
      if (!revision) continue;
      const link = document.createElement('a');
      link.href = dictionarySourceURL(language,revision,item.word);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      if (source.childElementCount) source.append(' · ');
      source.append(link);
    }
    const license = document.createElement('a');
    license.href = 'https://creativecommons.org/licenses/by-sa/4.0/';
    license.target = '_blank';
    license.rel = 'noopener noreferrer';
    license.textContent = 'CC BY-SA 4.0';
    if (source.childElementCount) source.append(' · ');
    source.append(license);
  }
  const busy = lookups.has(item.key);
  $('detail-lookup').disabled = busy || navigator.onLine === false;
  $('detail-lookup').textContent = dictionary ? '重新查詢' : '查詢字典';
  $('detail-lookup-status').textContent = busy ? '正在查詢維基詞典…'
    : lookupErrors.has(item.key) ? '連線或儲存失敗，可以重新查詢。'
    : navigator.onLine === false ? '離線中，顯示已儲存的內容。'
    : dictionary?.partial ? '已儲存可取得的內容，部分來源可重新查詢。'
    : dictionary ? (dictionary.found ? '已儲存字典資料。' : '維基詞典暫無可用資料。')
    : '等待查詢字典。';
}
function refreshDictionary(item){
  if (state.detailKey === item.key && $('detail-dialog').open) renderDictionary(item);
}
function lookupWord(item, retry = false){
  if (lookups.has(item.key)) return lookups.get(item.key).promise;
  const startingRecord = recordFor(item);
  if (navigator.onLine === false || (!retry && (startingRecord.dictionary || lookupErrors.has(item.key)))) return;
  const controller = new AbortController();
  const job = {controller};
  lookups.set(item.key,job);
  lookupErrors.delete(item.key);
  refreshDictionary(item);
  job.promise = (async () => {
    try {
      await glossesReady;
      const dictionary = await lookupDictionary(item.word,Boolean(offlineGloss(item)),controller.signal);
      if (controller.signal.aborted) return false;
      if (!isCore(item) && state.records.get(item.key)?.added_at !== startingRecord.added_at) return false;
      const saved = await write(item,{dictionary,dictionaryPending:dictionary.partial},{existingOnly:!isCore(item)});
      if (!saved && !controller.signal.aborted) lookupErrors.add(item.key);
      return saved && !dictionary.partial;
    } catch(error) {
      if (!controller.signal.aborted) lookupErrors.add(item.key);
      return false;
    } finally {
      if (lookups.get(item.key) === job) {
        lookups.delete(item.key);
        refreshDictionary(item);
      }
    }
  })();
  return job.promise;
}
function resumeCustomLookups(){
  if (pendingCustomLookup || navigator.onLine === false) return;
  pendingCustomLookup = (async () => {
    for (const record of records()) {
      if (!isCore(record) && record.dictionaryPending && state.records.has(record.key)) {
        const done = await lookupWord(record,true);
        if (!done) break;
      }
    }
  })().finally(() => { pendingCustomLookup = null; });
}
function gradeOf(item){return Number(recordFor(item).grade||0);}
function matches(item){return state.filter==='all'||Number(state.filter)===gradeOf(item);}
function shuffle(list){for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;}
function refreshQueue(){
  state.queue=shuffle(getWords().filter(matches));
  // If possible don't repeat previous word between rounds.
  if(state.queue.length>1 && state.queue[state.queue.length-1].key===state.lastDrawn){
    [state.queue[0],state.queue[state.queue.length-1]]=[state.queue[state.queue.length-1],state.queue[0]];
  }
}
function resetReviewHistory(){
  state.reviewHistory=[];
  state.reviewPosition=-1;
  state.totalDrawn=0;
  state.revealedKey=null;
}
function drawNext(){
  // Returning from "上一個" must revisit the existing history before drawing a new word.
  if (state.reviewPosition < state.reviewHistory.length - 1) {
    state.reviewPosition++;
    state.current=state.reviewHistory[state.reviewPosition];
    state.totalDrawn=state.reviewPosition+1;
    state.revealedKey=null;
    renderCard();
    return;
  }
  // A completed round starts again at card 1; the queue is still shuffled without repeats.
  if(!state.queue.length){
    refreshQueue();
    resetReviewHistory();
  }
  state.current=state.queue.pop()||null;
  state.revealedKey=null;
  state.lastDrawn=state.current?.key||null;
  if(state.current){
    state.reviewHistory.push(state.current);
    state.reviewPosition=state.reviewHistory.length-1;
    state.totalDrawn=state.reviewPosition+1;
  }
  renderCard();
}
function drawPrevious(){
  // The first card deliberately keeps an enabled button but does nothing when tapped.
  if (state.reviewPosition<=0) return;
  state.reviewPosition--;
  state.current=state.reviewHistory[state.reviewPosition];
  state.totalDrawn=state.reviewPosition+1;
  state.revealedKey=null;
  renderCard();
}
function externalLookupTarget(){
  const useSameContext = navigator.standalone === true ||
    window.matchMedia('(pointer: coarse), (display-mode: standalone)').matches;
  return useSameContext ? '_self' : '_blank';
}
function setLookupLink(id,item,buildURL){
  const link = $(id);
  link.hidden = !item;
  if (item) link.href = buildURL(item.word);
  else link.removeAttribute('href');
  link.target = externalLookupTarget();
}
function rememberLookupReturn(){
  try {
    const editor = rootNoteEditor;
    window.history.replaceState({...window.history.state,vocabularyLookup:{
      view:document.querySelector('.nav-item.active')?.dataset.view || 'review',
      filter:state.filter,
      current:state.current?.key,
      queue:state.queue.map(item=>item.key),
      reviewHistory:state.reviewHistory.map(item=>item.key),
      reviewPosition:state.reviewPosition,
      totalDrawn:state.totalDrawn,
      revealedKey:state.revealedKey,
      libraryFilter:state.libraryFilter,
      search:$('search-word').value,
      detail:$('detail-dialog').open ? state.detailKey : null,
      rootNoteEdit:editor ? {initial:editor.initial,draft:$('root-note-editor').value} : null,
      detailNoteEdit:detailNoteEditor ? {initial:detailNoteEditor.initial,draft:$('detail-note').value} : null
    }},'');
  } catch(error) {
    console.warn('無法記住查詢前的畫面',error);
  }
}
function takeLookupReturn(){
  const {vocabularyLookup,...rest} = window.history.state || {};
  if (vocabularyLookup) {
    try { window.history.replaceState(rest,''); }
    catch(error) { console.warn(error); }
  }
  return vocabularyLookup;
}
function restoreLookupReturn(saved){
  if (!saved) return;
  const words = new Map(getWords().map(item=>[item.key,item]));
  state.filter = saved.filter || 'all';
  $('filter-select').value = state.filter;
  state.libraryFilter = saved.libraryFilter || 'all';
  $('library-filter-select').value = state.libraryFilter;
  $('search-word').value = saved.search || '';
  state.queue = (saved.queue || []).map(key=>words.get(key)).filter(item=>item && matches(item));
  const keys = Array.isArray(saved.reviewHistory) ? saved.reviewHistory : (saved.current ? [saved.current] : []);
  state.reviewHistory = keys.map(key=>words.get(key)).filter(Boolean);
  const requestedPosition = Number.isInteger(saved.reviewPosition) ? saved.reviewPosition : state.reviewHistory.length-1;
  state.reviewPosition = Math.max(-1,Math.min(requestedPosition,state.reviewHistory.length-1));
  state.current = state.reviewHistory[state.reviewPosition] || words.get(saved.current) || null;
  state.lastDrawn = state.reviewHistory.at(-1)?.key || state.current?.key || null;
  state.totalDrawn = state.current ? state.reviewPosition+1 : 0;
  state.revealedKey = saved.revealedKey === state.current?.key ? state.current.key : null;
  if (!state.current && state.queue.length) drawNext();
  view(saved.view);
  if (saved.view !== 'review') renderCard();
  const detail = words.get(saved.detail);
  if (detail) {
    openDetail(detail);
    if (saved.rootNoteEdit) startRootNoteEdit(detail,saved.rootNoteEdit);
    if (saved.detailNoteEdit) startDetailNoteEdit(detail,saved.detailNoteEdit);
  }
}
function renderCard(){
  const item=state.current;
  $('card-word').textContent=item?.word||'這個範圍目前沒有單字';
  $('card-counter').textContent=item?`第 ${state.totalDrawn} 張`:'0 張';
  $('card-tag').textContent=item?'VOCABULARY':'EMPTY';
  const translationVisible = Boolean(item && state.revealedKey === item.key);
  const translation = $('card-translation');
  translation.hidden = !translationVisible;
  translation.textContent = translationVisible ? (dictionarySections(item).meaning || '目前沒有中文釋義') : '';
  $('reveal-btn').textContent = translationVisible ? '隱藏中文' : '顯示中文';
  $('reveal-btn').setAttribute('aria-pressed', String(translationVisible));
  $('reveal-btn').disabled=!item;
  $('detail-btn').disabled=!item;
  $('next-btn').disabled=!item && !getWords().some(matches);
  setLookupLink('cambridge-btn',item,cambridge);
  $('copy-btn').disabled=!item;
  renderFamiliarityChoices($('review-familiarity'),item);
  $('count-pill').textContent=`${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
  $('review-note').textContent=item?'同一輪抽背不會重複，全部抽完才重新洗牌。':'可以更改抽背篩選，或到「單字庫」新增單字。';
}
function renderFamiliarity(button,item){
  const grade = item ? gradeOf(item) : 0;
  const label = familiarityLabel(grade);
  button.dataset.grade = grade;
  button.textContent = label;
  button.disabled = !item;
  button.setAttribute('aria-label',`目前熟悉度為${label}，點選更改`);
}
function renderFamiliarityChoices(group,item,includeClear = false){
  if (!group.firstElementChild) {
    group.innerHTML = familiarityLevels.filter(({grade})=>grade || includeClear).map(({grade,label})=>`
      <button type="button" class="familiarity-choice" data-grade="${grade}">${grade===0 ? '取消標記' : label}</button>`
    ).join('');
  }
  const selected = item ? gradeOf(item) : 0;
  for (const button of group.children) {
    button.disabled = !item;
    button.setAttribute('aria-pressed',String(Number(button.dataset.grade) === selected));
  }
}
function openFamiliarity(item){
  const dialog = $('familiarity-dialog');
  const options = $('familiarity-options');
  if (!item || dialog.open || options.disabled) return;
  dialog.dataset.key = item.key;
  $('familiarity-error').textContent = '';
  renderFamiliarityChoices(options,item,true);
  dialog.showModal();
  (options.querySelector('[aria-pressed="true"]') || options.firstElementChild).focus();
}
async function setGrade(item,grade,{toggle = false} = {}){
  const saved = await write(item,record=>{
    const nextGrade = toggle && record.grade===grade ? 0 : grade;
    return {grade:nextGrade,marked_on:nextGrade ? localDay() : null};
  },{existingOnly:!isCore(item)});
  if (!saved) return false;
  if (state.current?.key === item.key) renderFamiliarityChoices($('review-familiarity'),item);
  if (state.detailKey === item.key) renderFamiliarity($('detail-familiarity'),item);
  const row = Array.from($('word-list').querySelectorAll('.word-row')).find(row=>row.dataset.key===item.key);
  if (row) {
    const badge = row.querySelector('.familiarity-badge');
    badge.dataset.grade = saved.grade;
    badge.textContent = familiarityLabel(saved.grade);
  }
  showToast(saved.grade ? '熟悉度已儲存' : '已取消熟悉度標記');
  state.queue=state.queue.filter(matches);
  $('count-pill').textContent=`${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
  renderList();
  renderStats();
  return true;
}
async function selectFamiliarity(grade){
  const dialog = $('familiarity-dialog');
  const options = $('familiarity-options');
  if (!dialog.open || options.disabled) return;
  const item = getWords().find(item=>item.key===dialog.dataset.key);
  if (!item) return;
  if (grade === 0 && gradeOf(item) === 0) {
    dialog.close();
    return;
  }
  $('familiarity-error').textContent = '';
  options.disabled = true;
  const saved = await setGrade(item,grade);
  options.disabled = false;
  if (!dialog.open) return;
  if (saved) dialog.close();
  else {
    $('familiarity-error').textContent = '熟悉度未儲存，請再試一次。';
    options.querySelector(`[data-grade="${grade}"]`)?.focus();
  }
}
let midnightTimer;
function renderStats(){
  const time = new Date();
  const today = localDay(time);
  const all = getWords();
  const counts = Object.fromEntries(validGrades.map(grade=>[grade,0]));
  let markedToday = 0;
  for (const word of all) {
    const record = recordFor(word);
    const grade = Number(record.grade || 0);
    counts[grade]++;
    if (grade && record.marked_on === today) markedToday++;
  }
  $('stat-total').textContent=all.length.toLocaleString();
  $('stat-marked').textContent=(all.length-counts[0]).toLocaleString();
  $('stat-today').textContent=markedToday.toLocaleString();
  for(const grade of validGrades)$('stat-'+grade).textContent=counts[grade].toLocaleString();
  const marked=all.length?Math.round((all.length-counts[0])/all.length*100):0;
  $('progress-bar').firstElementChild.style.width=marked+'%';
  $('progress-text').textContent=`已標記 ${marked}% · 核心 ${state.core.length.toLocaleString()} 字 · 自訂 ${all.length-state.core.length} 字`;
  time.setHours(24,0,0,0);
  clearTimeout(midnightTimer);
  midnightTimer = setTimeout(renderStats,Math.max(0,time.getTime()-Date.now()));
}
function renderList(){
  const word = normalizeSpaces($('search-word').value.normalize('NFC'));
  const q = duplicateKey(word);
  const allWords = getWords();
  const result = allWords.filter(item=>(state.libraryFilter==='all'||gradeOf(item)===Number(state.libraryFilter)) && duplicateKey(item.word).includes(q));
  const count = result.length > 99999 ? '99,999+' : result.length.toLocaleString('en-US');
  $('search-count').textContent=`共 ${count} 筆`;
  const subset=result.slice(0,state.searchLimit);
  $('word-list').innerHTML=subset.map(item=>{
    const grade = gradeOf(item);
    return `<button type="button" class="word-row" data-key="${esc(item.key)}">
      <span class="word-row-main">
        <b>${esc(item.word)}</b><small>${isCore(item) ? '核心詞條 · 唯讀' : '自訂單字'}</small>
      </span>
      <span class="familiarity-badge" data-grade="${grade}">${familiarityLabel(grade)}</span>
    </button>`;
  }).join('') || '<div class="empty-list">沒有符合的單字。</div>';
  $('load-more').hidden=result.length<=state.searchLimit;
  const addButton = $('add-word-btn');
  addButton.hidden = !validNewWord(word) || allWords.some(item=>duplicateKey(item.word)===q);
  addButton.disabled = addingWord;
}
function view(name){
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+name));
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===name));
  if(name==='library')renderList();
  if(name==='stats')renderStats();
  if(name==='review')renderCard();
  window.scrollTo(0,0);
}
function openDetail(item){
  state.detailKey=item.key;
  rootNoteEditor = null;
  detailNoteEditor = null;
  $('detail-word').textContent=item.word;
  $('detail-category').textContent=isCore(item)?'Lexifold 核心詞條 · 原始資料已鎖定':'自訂單字 · 可刪除';
  $('note-saved').textContent='';
  renderDetailNote(item);
  $('root-note-feedback').textContent = '';
  $('detail-delete').hidden=isCore(item);
  setLookupLink('detail-cambridge',item,cambridge);
  setLookupLink('detail-ai-lookup',item,chatgptLookup);
  setLookupLink('detail-etymonline',item,etymonline);
  renderFamiliarity($('detail-familiarity'),item);
  $('detail-dialog').showModal();
  renderRootNotes(item);
  renderDictionary(item);
  lookupWord(item);
}
async function addWord(){
  if (addingWord) return;
  const search=$('search-word');
  const input=search.value;
  const word=normalizeSpaces(input.normalize('NFC'));
  if(!validNewWord(word)){showToast('請輸入有效的英文單字');return;}
  const duplicateMessage = '此單字已在資料庫，無法重複新增。';
  const spelling = duplicateKey(word);
  if (getWords().some(item=>duplicateKey(item.word)===spelling)) {
    window.alert(duplicateMessage);
    return;
  }
  const item={key:keyFor('custom',word),word,type:'custom'};
  addingWord=true;
  $('add-word-btn').disabled=true;
  const good=await write(item,{added_at:now(),dictionaryPending:true},{createOnly:true});
  addingWord=false;
  if (good === null) window.alert(duplicateMessage);
  if(!good){renderList();return;}
  if (search.value===input) search.value='';
  state.searchLimit=70;
  if (matches(item)) state.queue.unshift(item);
  if (!state.current) drawNext();
  else $('count-pill').textContent = `${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
  renderList();renderStats();
  showToast('已新增並儲存在本機');openDetail(item);
}
function exportData(){
  const exportedAt = new Date();
  const exported={format:'vocabulary-personal-backup',schema_version:1,created_at:exportedAt.toISOString(),source_device_name:deviceName,core_source:'Lexifold TOEIC',core_count:state.core.length,core_created_at:state.coreMeta?.generated_at||null,records:records()};
  const blob=new Blob([JSON.stringify(exported,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=backupFileName;
  document.body.append(a);
  try {
    a.click();
    storeLastBackup(exportedAt);
    $('backup-state').textContent='已產生備份檔（請確認已存到 iPhone 檔案 App 或 iCloud Drive）';
  } finally {
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
}
function normalizeStoredRecord(record){
  // The starter build lowercased core keys. Restore their original spelling.
  if (record.key === `core:${canonical(record.word)}`) {
    return {...record, key: keyFor('core',record.word)};
  }
  return record;
}
function validateBackup(obj){
  if(!obj || obj.format!=='vocabulary-personal-backup'||obj.schema_version!==1||!Array.isArray(obj.records))throw Error('這不是支援的備份格式');
  if(obj.records.length>100000)throw Error('備份紀錄數過多');
  const keys=new Set();
  const validated = obj.records.map(record => {
    if(!record||typeof record.key!=='string'||typeof record.word!=='string'||!record.word.trim()||record.word.length>100||typeof record.note!=='string'||!validGrades.includes(record.grade))throw Error('備份內容有不合法的紀錄');
    const r = normalizeStoredRecord(record);
    if(!['custom:','core:'].some(p=>r.key.startsWith(p))||r.key!==keyFor(r.key.startsWith('core:')?'core':'custom',r.word))throw Error('備份含有不合法的詞條識別碼');
    if(keys.has(r.key))throw Error('備份包含重複詞條');
    if (r.marked_on != null && (typeof r.marked_on !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(r.marked_on))) {
      throw Error('備份的標記日期格式有誤');
    }
    if (r.dictionary != null && (!['translations','examples'].every(
      field => Array.isArray(r.dictionary[field]) && r.dictionary[field].every(value => typeof value === 'string')
    ))) throw Error('備份的字典資料格式有誤');
    const collocations = r.dictionary?.collocations;
    if (collocations != null && (!Array.isArray(collocations) ||
        !collocations.every(value => typeof value === 'string'))) {
      throw Error('備份的字典資料格式有誤');
    }
    if (r.rootNote != null && !isRootNoteValue(r.rootNote)) {
      throw Error('備份的字根記憶格式有誤');
    }
    keys.add(r.key);
    return r;
  });
  return validated;
}
async function restoreFile(file){
  if(!file)return;
  try{
    if(file.size>20*1024*1024)throw Error('備份檔案超過 20 MB');
    const backup=JSON.parse(await file.text());
    const recs=validateBackup(backup);
    if(state.core.length && backup.core_count!==state.core.length){
      if(!confirm(`此備份來自 ${backup.core_count} 字版本；目前核心字庫是 ${state.core.length} 字。是否仍繼續？`))return;
    }
    const sourceDevice = typeof backup.source_device_name === 'string'
      ? backup.source_device_name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    const sourceInfo = sourceDevice ? `來源設備：${sourceDevice}\n` : '';
    if(!confirm(`${sourceInfo}要載入 ${recs.length} 筆個人紀錄嗎？這將取代現有的熟悉度、筆記、編輯過的字根記憶和自訂單字，但不會變更這台設備的名稱。建議先建立現有資料的備份。`))return;
    for (const job of lookups.values()) job.controller.abort();
    lookups.clear();
    lookupErrors.clear();
    // A single IDB transaction makes restoration atomic; original core snapshot is never touched.
    await replaceRecords(recs);
    state.records=new Map(recs.map(r=>[r.key,r]));
    state.searchLimit=70;resetReviewHistory();refreshQueue();drawNext();renderList();renderStats();
    setSaving('已還原');showToast('備份已載入');
    resumeCustomLookups();
  }catch(err){console.error(err);showToast(`載入失敗：${err.message}`)}
  finally{$('import-file').value='';}
}
function wire(){
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>{
    takeLookupReturn();
    view(el.dataset.view);
  }));
  $('filter-select').addEventListener('change',ev=>{state.filter=ev.target.value;resetReviewHistory();refreshQueue();drawNext();});
  $('library-filter-select').addEventListener('change',ev=>{state.libraryFilter=ev.target.value;state.searchLimit=70;renderList();});
  $('prev-btn').addEventListener('click',()=>{takeLookupReturn();drawPrevious();});
  $('next-btn').addEventListener('click',()=>{
    takeLookupReturn();
    drawNext();
  });
  $('reveal-btn').addEventListener('click',()=>{
    if (!state.current) return;
    state.revealedKey = state.revealedKey === state.current.key ? null : state.current.key;
    renderCard();
  });
  $('detail-btn').addEventListener('click',()=>{if(state.current)openDetail(state.current);});
  document.addEventListener('click',ev=>{
    const link = ev.target.closest('a.external-lookup');
    if (!link) return;
    if (rootNoteEditor?.saving || detailNoteEditor?.saving) {
      ev.preventDefault();
      return;
    }
    link.target = externalLookupTarget();
    if (link.target === '_self' && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      rememberLookupReturn();
    }
  });
  $('review-familiarity').addEventListener('click',ev=>{
    const button = ev.target.closest('button[data-grade]');
    if (button && state.current) setGrade(state.current,Number(button.dataset.grade),{toggle:true});
  });
  $('detail-familiarity').addEventListener('click',()=>{
    openFamiliarity(getWords().find(word=>word.key===state.detailKey));
  });
  $('familiarity-options').addEventListener('click',ev=>{
    const button = ev.target.closest('button[data-grade]');
    if (button) selectFamiliarity(Number(button.dataset.grade));
  });
  $('close-familiarity').addEventListener('click',()=>$('familiarity-dialog').close());
  $('familiarity-dialog').addEventListener('click',ev=>{if(ev.target===ev.currentTarget)ev.currentTarget.close();});
  window.addEventListener('pageshow',ev=>{
    if (ev.persisted) takeLookupReturn();
    renderStats();
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) renderStats();});
  $('copy-btn').addEventListener('click',async()=>{if(!state.current)return;try{await navigator.clipboard.writeText(state.current.word);showToast('已複製單字');}catch{showToast('複製失敗，請長按選取單字');}});
  $('add-word-btn').addEventListener('click',addWord);
  $('search-word').addEventListener('input',()=>{state.searchLimit=70;renderList();});
  $('load-more').addEventListener('click',()=>{state.searchLimit+=100;renderList();});
  $('word-list').addEventListener('click',ev=>{
    const row=ev.target.closest('.word-row');
    if (!row) return;
    const item=getWords().find(word=>word.key===row.dataset.key);
    if (item) openDetail(item);
  });
  $('close-dialog').addEventListener('click',requestDetailClose);
  $('detail-dialog').addEventListener('click',ev=>{if(ev.target===$('detail-dialog'))requestDetailClose();});
  $('detail-dialog').addEventListener('cancel',ev=>{
    ev.preventDefault();
    requestDetailClose();
  });
  $('root-note-toggle').addEventListener('click',()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if (item) toggleRootNoteEdit(item);
  });
  $('root-note-copy-prompt').addEventListener('click',async()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if (!item) return;
    const prompt = rootNotePrompt(item.word);
    try {
      await navigator.clipboard.writeText(prompt);
      if (item.key === state.detailKey && $('detail-dialog').open && !rootNoteEditor?.saving) {
        $('root-note-feedback').textContent = '已複製提示語';
      }
    } catch {
      window.prompt('請手動複製提示語',prompt);
    }
  });
  $('detail-lookup').addEventListener('click',()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if (item) lookupWord(item,true);
  });
  window.addEventListener('online',()=>{
    lookupErrors.clear();
    resumeCustomLookups();
    const item=getWords().find(w=>w.key===state.detailKey);
    if (item && $('detail-dialog').open) {
      refreshDictionary(item);
      lookupWord(item);
    }
  });
  window.addEventListener('offline',()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if (item) refreshDictionary(item);
  });
  $('detail-note-toggle').addEventListener('click',()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if (item) toggleDetailNoteEdit(item);
  });
  $('detail-note').addEventListener('input',()=>{
    if (detailNoteEditor) $('note-saved').textContent = '';
  });
  $('detail-delete').addEventListener('click',async()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if(!item||isCore(item)||rootNoteEditor?.saving||detailNoteEditor?.saving)return;
    if(!confirm(`確定刪除自訂單字「${item.word}」及其學習紀錄？`))return;
    lookups.get(item.key)?.controller.abort();
    lookups.delete(item.key);
    lookupErrors.delete(item.key);
    try{
      await deleteRecord(item.key);
      state.records.delete(item.key);
      rootNoteEditor = null;
      detailNoteEditor = null;
      $('detail-dialog').close();
      state.queue = state.queue.filter(entry => entry.key !== item.key);
      const currentKey=state.current?.key;
      state.reviewHistory=state.reviewHistory.filter(entry=>entry.key!==item.key);
      if (currentKey===item.key) {
        state.reviewPosition=Math.min(state.reviewPosition-1,state.reviewHistory.length-1);
        state.current=state.reviewHistory[state.reviewPosition]||null;
        if (!state.current){
          resetReviewHistory();
          drawNext();
        } else {
          state.totalDrawn=state.reviewPosition+1;
          renderCard();
        }
      } else {
        state.reviewPosition=state.reviewHistory.findIndex(entry=>entry.key===currentKey);
        state.totalDrawn=state.reviewPosition+1;
        renderCard();
      }
      renderList();renderStats();showToast('已刪除自訂單字');
    }
    catch{showToast('刪除失敗')}
  });
  $('save-device-name-btn').addEventListener('click',saveDeviceName);
  $('device-name-input').addEventListener('keydown',event=>{
    if (event.key === 'Enter') saveDeviceName();
  });
  $('device-name-input').addEventListener('input',()=>{
    $('device-name-state').textContent = '修改名稱後請按「儲存」。';
  });
  $('export-btn').addEventListener('click',exportData);
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',ev=>restoreFile(ev.target.files?.[0]));
}
async function main(){
  loadDeviceName();
  loadLastBackup();
  glossesReady = fetch('./data/glosses-zh.json')
    .then(response => {
      if (!response.ok) throw Error(`中文釋義 HTTP ${response.status}`);
      return response.json();
    })
    .then(data => { glosses = data; })
    .catch(error => console.warn(error));
  let error=null;
  try{
    const response=await fetch('./data/core.json',{cache:'no-cache'});
    if(!response.ok)throw Error(`核心字庫 HTTP ${response.status}`);
    const json=await response.json();
    if(json.word_count!==4027||json.words?.length!==4027){
      throw Error('核心字庫檔案不完整，請重新上傳完整專案中的 data/core.json');
    }
    if(new Set(json.words.map(w=>w.word)).size!==4027)throw Error('核心字庫有重複詞條，已停止載入');
    state.core=json.words;state.coreMeta=json;
    $('core-status').textContent=`已鎖定 ${json.word_count.toLocaleString()} 字`;
  }catch(err){error=err;$('core-status').textContent='尚未載入核心字庫';console.warn(err);}
  initializeRootNotes();
  try{
    const stored = await getAll();
    const normalized = stored.map(normalizeStoredRecord);
    if (normalized.some((r,i) => r.key !== stored[i].key)) await replaceRecords(normalized);
    state.records=new Map(normalized.map(r=>[r.key,r]));
    setSaving('本機儲存已啟用');
  }catch(err){console.error(err);setSaving('本機儲存不可用');showToast('無法使用 IndexedDB，請檢查瀏覽器設定');}
  refreshQueue();drawNext();renderList();renderStats();
  await glossesReady;
  wire();
  restoreLookupReturn(takeLookupReturn());
  resumeCustomLookups();
  if(error){showToast(error.message);$('review-note').textContent=error.message;}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(console.warn);
}
main();
