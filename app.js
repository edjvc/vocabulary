import {getAll,saveRecord,deleteRecord,replaceRecords} from './db.js';

const $ = id => document.getElementById(id);
const state = {core:[], coreMeta:null, records:new Map(), current:null, queue:[], filter:'all', lastDrawn:null, searchLimit:70, detailKey:null, totalDrawn:0};
const now = () => new Date().toISOString();
const canonical = word => word.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyFor = (type,word) => `${type}:${canonical(word)}`;
const cambridge = word => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(canonical(word)).replace(/%20/g,'-')}`;
const records = () => Array.from(state.records.values());
const recordFor = item => state.records.get(item.key) || {key:item.key, word:item.word, grade:0, note:'', added_at:null, updated_at:null};
const isCore = item => item.key.startsWith('core:');
const getWords = () => [
  ...state.core.map(w => ({key:keyFor('core',w.word),word:w.word,type:'core'})),
  ...records().filter(r => r.key.startsWith('custom:')).map(r=>({key:r.key,word:r.word,type:'custom'}))
];
const showToast = (message) => {const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2600);};
const setSaving = text => $('saving').textContent=text;
async function write(record){
  const safe = {...record,updated_at:now()};
  setSaving('儲存中…');
  try {await saveRecord(safe); state.records.set(safe.key,safe);setSaving('已自動儲存');return true;}
  catch(err){console.error(err);setSaving('儲存失敗');showToast('儲存失敗，請立即建立備份或檢查 Safari 空間');return false;}
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
  const chunks=[];
  if(r.meaning)chunks.push(`<div><b>中文意思</b><p>${esc(r.meaning)}</p></div>`);
  if(r.etymology)chunks.push(`<div><b>詞源</b><p>${esc(r.etymology)}</p></div>`);
  if(r.examples)chunks.push(`<div><b>例句</b><p>${esc(r.examples)}</p></div>`);
  if(r.note)chunks.push(`<div><b>筆記</b><p>${esc(r.note)}</p></div>`);
  if(!chunks.length)chunks.push('<p class="muted">詳細詞義、字根與例句將於下一階段自動補齊。你可以先新增個人筆記。</p>');
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
  $('review-note').textContent=item?'同一輪抽背不會重複，全部抽完才重新洗牌。':'你可以到「單字庫」新增自己的單字，或等待核心字庫初始化。';
}
function reveal(){
  if(!state.current)return;
  if($('card-back').hidden){$('card-back').hidden=false;$('card-placeholder').hidden=true;setCardDetails(state.current);$('reveal-btn').textContent='隱藏答案';}
  else{$('card-back').hidden=true;$('card-placeholder').hidden=false;$('reveal-btn').textContent='顯示答案';}
}
async function setGrade(grade){
  if(!state.current)return;
  const r=recordFor(state.current);
  if(await write({...r,grade})){
    document.querySelectorAll('[data-grade]').forEach(btn=>btn.classList.toggle('selected',Number(btn.dataset.grade)===grade));
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
  const r=recordFor(item);
  $('detail-word').textContent=item.word;
  $('detail-category').textContent=isCore(item)?'Lexifold 核心詞條 · 原始資料已鎖定':'自訂單字 · 可刪除';
  $('detail-meaning').textContent=r.meaning||'尚未補齊。第一版已提供個人筆記，字典自動補齊將於下一階段加入。';
  $('detail-etymology').textContent=r.etymology||'尚未補齊';
  $('detail-examples').textContent=r.examples||'尚未補齊';
  $('detail-note').value=r.note||'';
  $('note-saved').textContent='輸入後自動儲存';
  $('detail-delete').hidden=isCore(item);
  $('detail-dialog').showModal();
}
async function addWord(ev){
  ev.preventDefault();
  const word=$('new-word').value.trim().replace(/\s+/g,' ');
  if(!word || word.length>100 || !/^[a-zA-Z][a-zA-Z\s'’-]*$/.test(word)){showToast('請輸入有效的英文單字');return;}
  const existing=getWords().find(w=>canonical(w.word)===canonical(word));
  if(existing){showToast('這個單字已在字庫中');openDetail(existing);return;}
  const item={key:keyFor('custom',word),word,type:'custom'};
  const good=await write({...recordFor(item),added_at:now(),grade:0});
  if(!good)return;
  $('new-word').value='';
  state.searchLimit=70;
  refreshQueue();renderList();renderStats();
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
function validateBackup(obj){
  if(!obj || obj.format!=='vocabulary-personal-backup'||obj.schema_version!==1||!Array.isArray(obj.records))throw Error('這不是支援的備份格式');
  if(obj.records.length>100000)throw Error('備份紀錄數過多');
  const keys=new Set();
  for(const r of obj.records){
    if(!r||typeof r.key!=='string'||typeof r.word!=='string'||!r.word.trim()||r.word.length>100||typeof r.note!=='string'||![0,1,2,3].includes(Number(r.grade)))throw Error('備份內容有不合法的紀錄');
    if(!['custom:','core:'].some(p=>r.key.startsWith(p))||r.key!==keyFor(r.key.startsWith('core:')?'core':'custom',r.word))throw Error('備份含有不合法的詞條識別碼');
    if(keys.has(r.key))throw Error('備份包含重複詞條');
    keys.add(r.key);
  }
  return obj.records;
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
    // A single IDB transaction makes restoration atomic; original core snapshot is never touched.
    await replaceRecords(recs);
    state.records=new Map(recs.map(r=>[r.key,r]));
    state.searchLimit=70;refreshQueue();drawNext();renderList();renderStats();
    setSaving('已還原');showToast('備份已載入');
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
  $('detail-note').addEventListener('input',async ev=>{
    const key=state.detailKey;
    const item=getWords().find(w=>w.key===key);
    if(!item)return;
    const good=await write({...recordFor(item),note:ev.target.value});
    if(good && key===state.detailKey)$('note-saved').textContent='已自動儲存';
  });
  $('detail-delete').addEventListener('click',async()=>{
    const item=getWords().find(w=>w.key===state.detailKey);
    if(!item||isCore(item))return;
    if(!confirm(`確定刪除自訂單字「${item.word}」及其學習紀錄？`))return;
    try{await deleteRecord(item.key);state.records.delete(item.key);$('detail-dialog').close();refreshQueue();drawNext();renderList();renderStats();showToast('已刪除自訂單字');}
    catch{showToast('刪除失敗')}
  });
  $('export-btn').addEventListener('click',exportData);
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',ev=>restoreFile(ev.target.files?.[0]));
}
async function main(){
  wire();
  let error=null;
  try{
    const response=await fetch('./data/core.json',{cache:'no-cache'});
    if(!response.ok)throw Error(`核心字庫 HTTP ${response.status}`);
    const json=await response.json();
    if(json.word_count!==4027||json.words?.length!==4027){
      throw Error('核心 4,027 字尚未初始化；請完成 GitHub Actions 首次部署');
    }
    if(new Set(json.words.map(w=>canonical(w.word))).size!==4027)throw Error('核心字庫有重複詞條，已停止載入');
    state.core=json.words;state.coreMeta=json;
    $('core-status').textContent=`已鎖定 ${json.word_count.toLocaleString()} 字`;
  }catch(err){error=err;$('core-status').textContent='尚未載入核心字庫';console.warn(err);}
  try{
    state.records=new Map((await getAll()).map(r=>[r.key,r]));
    setSaving('本機儲存已啟用');
  }catch(err){console.error(err);setSaving('本機儲存不可用');showToast('無法使用 IndexedDB，請檢查瀏覽器設定');}
  refreshQueue();drawNext();renderList();renderStats();
  if(error){showToast(error.message);$('review-note').textContent=error.message;}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
main();
