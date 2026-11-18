import {getAll,saveRecord,deleteRecord,replaceRecords} from './db.js';
import {lookupDictionary,lookupChineseEtymology,dictionarySourceURL,summarizeEtymologies} from './dictionary.js';

const $ = id => document.getElementById(id);
const state = {core:[], coreMeta:null, records:new Map(), current:null, queue:[], filter:'all', lastDrawn:null, searchLimit:70, detailKey:null, totalDrawn:0};
const lookups = new Map();
const lookupErrors = new Set();
let etymologyLanguage = 'zh';
let glosses = {};
let glossesReady;
let pendingCustomLookup;
const now = () => new Date().toISOString();
const canonical = word => word.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyFor = (type,word) => `${type}:${type === 'core' ? word : canonical(word)}`;
const cambridge = word => `https://dictionary.cambridge.org/search/english/direct/?q=${encodeURIComponent(word)}`;
const records = () => Array.from(state.records.values());
const recordFor = item => state.records.get(item.key) || {key:item.key, word:item.word, grade:0, note:'', added_at:null, updated_at:null};
const isCore = item => item.key.startsWith('core:');
const getWords = () => [
  ...state.core.map(w => ({key:keyFor('core',w.word),word:w.word,type:'core'})),
  ...records().filter(r => r.key.startsWith('custom:')).map(r=>({key:r.key,word:r.word,type:'custom'}))
];
const showToast = (message) => {const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2600);};
const setSaving = text => $('saving').textContent=text;
let pendingWrites = 0;
async function write(item, changes, existingOnly = false){
  pendingWrites++;
  $('export-btn').disabled = true;
  setSaving('儲存中…');
  try {
    const saved = await saveRecord(recordFor(item), {...changes, updated_at:now()}, existingOnly);
    if (!saved) return false;
    state.records.set(saved.key,saved);
    if (pendingWrites === 1) setSaving('已自動儲存');
    return true;
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
    roots: dictionary?.roots?.join('\n') || '',
    examples: dictionary?.examples?.join('\n\n') || record.examples || '',
    collocations: dictionary?.collocations?.join('\n') || '',
    meaningSource: local ? 'ECDICT · 臺灣繁體轉換' : translated ? '維基詞典中文資料 · 字形依原文' : ''
  };
}
function renderEtymology(item){
  const record = recordFor(item);
  const dictionary = record.dictionary;
  const english = dictionary?.etymologies?.length
    ? dictionary.etymologies : record.etymology ? [String(record.etymology)] : [];
  const sourceChinese = dictionary?.etymologiesZh || [];
  const chinese = sourceChinese.length ? sourceChinese : summarizeEtymologies(english,dictionary?.roots);
  const useEnglish = etymologyLanguage === 'en';
  const lines = useEnglish ? english : chinese;
  const target = $('detail-etymology');
  target.textContent = lines.join('\n\n') || (lookups.has(item.key)
    ? '正在查詢詞源…'
    : useEnglish ? '目前沒有英文詞源。'
    : english.length ? '目前沒有可用的中文詞源。可切換至 English 閱讀原文。' : '目前沒有中文詞源。');
  target.lang = lines.length && useEnglish ? 'en' : 'zh-Hant';
  $('detail-etymology-source').textContent = !lines.length ? ''
    : useEnglish ? '英語維基詞典原文'
    : sourceChinese.length ? '中文維基詞典 · 臺灣繁體轉換'
    : '中文摘要 · 依英語維基詞典的詞源資料整理';
  for (const button of document.querySelectorAll('[data-etymology-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset.etymologyLang === etymologyLanguage));
  }
}
function renderDictionary(item){
  const data = dictionarySections(item);
  for (const field of ['meaning','roots','examples']) {
    $('detail-' + field).textContent = data[field] || '查無資料';
  }
  renderEtymology(item);
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
  if (state.current?.key === item.key && !$('card-back').hidden) setCardDetails(item);
}
function lookupWord(item, retry = false){
  if (lookups.has(item.key)) return lookups.get(item.key).promise;
  const startingRecord = recordFor(item);
  const existing = startingRecord.dictionary;
  if (navigator.onLine === false || (!retry && (existing?.chineseEtymologyChecked || lookupErrors.has(item.key)))) return;
  const controller = new AbortController();
  const job = {controller};
  lookups.set(item.key,job);
  lookupErrors.delete(item.key);
  refreshDictionary(item);
  job.promise = (async () => {
    try {
      await glossesReady;
      let dictionary;
      if (existing && !retry && !existing.chineseEtymologyChecked) {
        const supplementary = await lookupChineseEtymology(item.word,controller.signal);
        const translations = existing.translations.length || offlineGloss(item)
          ? existing.translations : supplementary.translations;
        dictionary = {
          ...existing,
          ...supplementary,
          translations,
          found: Boolean(existing.found || supplementary.etymologiesZh.length || translations.length),
          partial:false,
          chineseEtymologyChecked:true
        };
      } else {
        dictionary = await lookupDictionary(item.word,Boolean(offlineGloss(item)),controller.signal);
      }
      if (controller.signal.aborted) return false;
      if (!isCore(item) && state.records.get(item.key)?.added_at !== startingRecord.added_at) return false;
      const saved = await write(item,{dictionary,dictionaryPending:dictionary.partial},!isCore(item));
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
function drawNext(){
  if(!state.queue.length)refreshQueue();
  state.current=state.queue.pop()||null;
  state.lastDrawn=state.current?.key||null;
  if(state.current)state.totalDrawn++;
  renderCard();
}
function setCardDetails(item){
  const r=recordFor(item);
  const dictionary = dictionarySections(item);
  const chunks=[];
  if(dictionary.meaning)chunks.push(`<div><b>中文意思</b><p>${esc(dictionary.meaning)}</p></div>`);
  if(r.note)chunks.push(`<div><b>筆記</b><p>${esc(r.note)}</p></div>`);
  if(!chunks.length)chunks.push(`<p class="muted">${lookups.has(item.key) ? '正在查詢字典…' : '目前沒有釋義。可開啟詳細資料查看或重新查詢。'}</p>`);
  $('card-details').innerHTML=chunks.join('');
}
function renderCard(){
  const item=state.current;
  $('card-word').textContent=item?.word||'這個範圍目前沒有單字';
  $('card-counter').textContent=item?`第 ${state.totalDrawn} 張`:'0 張';
  $('card-tag').textContent=item?'VOCABULARY':'EMPTY';
  $('card-back').hidden=true;
  $('card-placeholder').hidden=!item;
  $('card-placeholder').textContent='先想想這個字的意思，再揭曉答案。';
  $('reveal-btn').textContent='顯示答案';
  $('reveal-btn').disabled=!item;
  $('next-btn').disabled=!item && getWords().length===0;
  $('cambridge-btn').disabled=!item;
  $('copy-btn').disabled=!item;
  $('card-full').disabled=!item;
  for(const btn of document.querySelectorAll('[data-grade]')){
    const grade=Number(btn.dataset.grade);
    btn.disabled=!item;
    btn.classList.toggle('selected',item!=null && gradeOf(item)===grade);
  }
  $('count-pill').textContent=`${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
  $('review-note').textContent=item?'同一輪抽背不會重複，全部抽完才重新洗牌。':'可以更改抽背篩選，或到「單字庫」新增單字。';
}
function reveal(){
  if(!state.current)return;
  if($('card-back').hidden){
    $('card-back').hidden=false;$('card-placeholder').hidden=true;setCardDetails(state.current);$('reveal-btn').textContent='隱藏答案';
    if (!offlineGloss(state.current)) lookupWord(state.current);
  }
  else{$('card-back').hidden=true;$('card-placeholder').hidden=false;$('reveal-btn').textContent='顯示答案';}
}
async function setGrade(grade){
  const item = state.current;
  if(!item)return;
  if(await write(item,{grade})){
    if (state.current?.key === item.key) {
      document.querySelectorAll('[data-grade]').forEach(btn=>btn.classList.toggle('selected',Number(btn.dataset.grade)===gradeOf(item)));
    }
    showToast('熟練度已儲存');
    // Keep the undrawn queue intact, preventing repeats within the round.
    state.queue=state.queue.filter(matches);
    $('count-pill').textContent=`${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
    renderStats();
  }
}
function openCambridge(item){if(!item)return;window.open(cambridge(item.word),'_blank','noopener,noreferrer');}
function renderStats(){
  const all=getWords();const counts=[0,0,0,0];
  all.forEach(w=>counts[gradeOf(w)]++);
  $('stat-total').textContent=all.length.toLocaleString();
  $('stat-marked').textContent=(all.length-counts[0]).toLocaleString();
  for(let i=0;i<4;i++)$('stat-'+i).textContent=counts[i].toLocaleString();
  const marked=all.length?Math.round((all.length-counts[0])/all.length*100):0;
  $('progress-bar').firstElementChild.style.width=marked+'%';
  $('progress-text').textContent=`已標記 ${marked}% · 核心 ${state.core.length.toLocaleString()} 字 · 自訂 ${all.length-state.core.length} 字`;
}
function renderList(){
  const q=canonical($('search-word').value);
  const result=getWords().filter(w=>canonical(w.word).includes(q));
  $('search-count').textContent=`共 ${result.length.toLocaleString()} 筆`;
  const subset=result.slice(0,state.searchLimit);
  $('word-list').innerHTML=subset.map(w=>`<button class="word-row" data-key="${esc(w.key)}"><span class="word-row-main"><b>${esc(w.word)}</b><small>${isCore(w)?'核心詞條 · 唯讀':'自訂單字'}</small></span><span class="word-grade g${gradeOf(w)}">${['未標記','不熟練','普通','熟練'][gradeOf(w)]}</span><span class="chevron">›</span></button>`).join('') || '<div class="empty-list">沒有符合的單字。</div>';
  $('load-more').hidden=result.length<=state.searchLimit;
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
  etymologyLanguage = 'zh';
  const r=recordFor(item);
  $('detail-word').textContent=item.word;
  $('detail-category').textContent=isCore(item)?'Lexifold 核心詞條 · 原始資料已鎖定':'自訂單字 · 可刪除';
  $('detail-note').value=r.note||'';
  $('note-saved').textContent='輸入後自動儲存';
  $('detail-delete').hidden=isCore(item);
  $('detail-dialog').showModal();
  renderDictionary(item);
  lookupWord(item);
}
async function addWord(ev){
  ev.preventDefault();
  const word=$('new-word').value.trim().replace(/\s+/g,' ');
  if(!word || word.length>100 || !/^\p{Script=Latin}[\p{Script=Latin}\p{Mark}\s'’-]*$/u.test(word)){showToast('請輸入有效的英文單字');return;}
  if ($('add-form').dataset.saving) return;
  const words = getWords();
  const existing = words.find(w=>w.word===word) || words.find(w=>canonical(w.word)===canonical(word));
  if(existing){showToast('這個單字已在字庫中');openDetail(existing);return;}
  const item={key:keyFor('custom',word),word,type:'custom'};
  $('add-form').dataset.saving = 'true';
  const good=await write(item,{added_at:now(),dictionaryPending:true});
  delete $('add-form').dataset.saving;
  if(!good)return;
  $('new-word').value='';
  state.searchLimit=70;
  if (matches(item)) state.queue.unshift(item);
  if (!state.current) drawNext();
  else $('count-pill').textContent = `${getWords().filter(matches).length.toLocaleString('en-US')} 個單字`;
  renderList();renderStats();
  showToast('已新增並儲存在本機');openDetail(item);
}
function exportData(){
  const exported={format:'vocabulary-personal-backup',schema_version:1,created_at:now(),core_source:'Lexifold TOEIC',core_count:state.core.length,core_created_at:state.coreMeta?.generated_at||null,records:records()};
  const blob=new Blob([JSON.stringify(exported,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='vocabulary-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  $('backup-state').textContent='已產生備份檔（請確認已存到 iPhone 檔案 App）';
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
    if(!record||typeof record.key!=='string'||typeof record.word!=='string'||!record.word.trim()||record.word.length>100||typeof record.note!=='string'||![0,1,2,3].includes(record.grade))throw Error('備份內容有不合法的紀錄');
    const r = normalizeStoredRecord(record);
    if(!['custom:','core:'].some(p=>r.key.startsWith(p))||r.key!==keyFor(r.key.startsWith('core:')?'core':'custom',r.word))throw Error('備份含有不合法的詞條識別碼');
    if(keys.has(r.key))throw Error('備份包含重複詞條');
    if (r.dictionary != null && (!['translations','roots','etymologies','examples'].every(
      field => Array.isArray(r.dictionary[field]) && r.dictionary[field].every(value => typeof value === 'string')
    ))) throw Error('備份的字典資料格式有誤');
    for (const field of ['collocations','etymologiesZh']) {
      const values = r.dictionary?.[field];
      if (values != null && (!Array.isArray(values) || !values.every(value => typeof value === 'string'))) {
        throw Error('備份的字典資料格式有誤');
      }
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
    if(!confirm(`要載入 ${recs.length} 筆個人紀錄嗎？這將取代現有的熟練度、筆記和自訂單字。建議先建立現有資料的備份。`))return;
    for (const job of lookups.values()) job.controller.abort();
    lookups.clear();
    lookupErrors.clear();
    // A single IDB transaction makes restoration atomic; original core snapshot is never touched.
    await replaceRecords(recs);
    state.records=new Map(recs.map(r=>[r.key,r]));
    state.searchLimit=70;refreshQueue();drawNext();renderList();renderStats();
    setSaving('已還原');showToast('備份已載入');
    resumeCustomLookups();
  }catch(err){console.error(err);showToast(`載入失敗：${err.message}`)}
  finally{$('import-file').value='';}
}
function wire(){
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>view(el.dataset.view)));
  $('filter-select').addEventListener('change',ev=>{state.filter=ev.target.value;state.totalDrawn=0;refreshQueue();drawNext();});
  $('next-btn').addEventListener('click',drawNext);
  $('reveal-btn').addEventListener('click',reveal);
  $('cambridge-btn').addEventListener('click',()=>openCambridge(state.current));
  $('copy-btn').addEventListener('click',async()=>{if(!state.current)return;try{await navigator.clipboard.writeText(state.current.word);showToast('已複製單字');}catch{showToast('複製失敗，請長按選取單字');}});
  $('card-full').addEventListener('click',()=>{if(state.current)openDetail(state.current)});
  document.querySelectorAll('[data-grade]').forEach(btn=>btn.addEventListener('click',()=>setGrade(Number(btn.dataset.grade))));
  $('add-form').addEventListener('submit',addWord);
  $('search-word').addEventListener('input',()=>{state.searchLimit=70;renderList();});
  $('load-more').addEventListener('click',()=>{state.searchLimit+=100;renderList();});
  $('word-list').addEventListener('click',ev=>{const row=ev.target.closest('[data-key]');if(!row)return;const item=getWords().find(w=>w.key===row.dataset.key);if(item)openDetail(item);});
  $('close-dialog').addEventListener('click',()=>$('detail-dialog').close());
  $('detail-dialog').addEventListener('click',ev=>{if(ev.target===$('detail-dialog'))$('detail-dialog').close();});
  $('detail-cambridge').addEventListener('click',()=>{const item=getWords().find(w=>w.key===state.detailKey);openCambridge(item);});
  for (const button of document.querySelectorAll('[data-etymology-lang]')) {
    button.addEventListener('click',()=>{
      const item = getWords().find(word=>word.key===state.detailKey);
      if (!item) return;
      etymologyLanguage = button.dataset.etymologyLang;
      renderEtymology(item);
    });
  }
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
  $('detail-note').addEventListener('input',async ev=>{
    const key=state.detailKey;
    const item=getWords().find(w=>w.key===key);
    if(!item)return;
    const note = ev.target.value;
    $('note-saved').textContent='儲存中…';
    const good=await write(item,{note});
    if(key===state.detailKey && $('detail-note').value===note) {
      $('note-saved').textContent = good ? '已自動儲存' : '儲存失敗，請再試一次';
    }
  });
  $('detail-delete').addEventListener('click',async()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if(!item||isCore(item))return;
    if(!confirm(`確定刪除自訂單字「${item.word}」及其學習紀錄？`))return;
    lookups.get(item.key)?.controller.abort();
    lookups.delete(item.key);
    lookupErrors.delete(item.key);
    try{
      await deleteRecord(item.key);
      state.records.delete(item.key);
      $('detail-dialog').close();
      state.queue = state.queue.filter(entry => entry.key !== item.key);
      if (state.current?.key === item.key) drawNext();
      else renderCard();
      renderList();renderStats();showToast('已刪除自訂單字');
    }
    catch{showToast('刪除失敗')}
  });
  $('export-btn').addEventListener('click',exportData);
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',ev=>restoreFile(ev.target.files?.[0]));
}
async function main(){
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
  resumeCustomLookups();
  if(error){showToast(error.message);$('review-note').textContent=error.message;}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
main();
