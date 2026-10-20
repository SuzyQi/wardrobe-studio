const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../wear-core.js'),Sync=require('../wear-sync.js'),App=require('../wear-app.js'),Cloud=require('../cloud.js');
const {fixture}=require('./helpers/github-fixture.cjs');
globalThis.crypto ||= require('node:crypto').webcrypto;
const root=path.resolve(__dirname,'..'),now='2026-10-20T12:00:00.000Z',options={now,cutoff:'2026-10-20'};
const wear=(garmentId,date='2026-10-20',extra={})=>({garmentId,date,name:garmentId,...extra});
function memory(journal=W.empty(),extra={}){let state={id:'journal',journal,base:null,origin:'',lastSyncAt:'',...extra},fail=false;const writes=[];return {read:async()=>structuredClone(state),update:async fn=>{const next=fn(structuredClone(state));if(fail){fail=false;throw new Error('模拟保存失败');}state=structuredClone(next);writes.push(structuredClone(state));return structuredClone(state);},writes,fail(){fail=true;}};}
const makeClient=api=>Sync.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',fetch:api.fetch,minWriteGap:0});
const patch=(j,c)=>W.patch(j,c,options);
test('wear days use the local calendar, valid leap dates and Monday weeks without DST shifts',()=>{
 assert.equal(W.today({getFullYear:()=>2026,getMonth:()=>9,getDate:()=>21}),'2026-10-21');
 assert.equal(W.date('2024-02-29'),'2024-02-29');for(const d of ['2026-02-29','2026-13-01','2026-10-00','foo'])assert.throws(()=>W.date(d));
 assert.equal(W.shift('2026-10-25',1),'2026-10-26');assert.equal(W.monthShift('2026-01',-1),'2025-12');assert.equal(W.calendar('2026-10')[0],'2026-09-28');assert.equal(W.calendar('2026-10').length,42);
});
test('repeated garment/day entries count once, batches count one day and separate pieces, and future writes fail atomically',()=>{
 const journal=patch(W.empty(),[wear('g_dress'),wear('g_shoes'),wear('g_bag'),wear('g_dress')]);assert.equal(journal.records.length,3);assert.deepEqual(W.stats(journal),{days:1,garments:3,first:'2026-10-20',last:'2026-10-20'});
 assert.equal(W.stats(patch(journal,[wear('g_dress','2026-10-12')]),'g_dress').days,2);assert.throws(()=>patch(journal,[wear('g_dress','2026-10-11'),wear('g_dress','2026-10-21')]),/过去/);assert.equal(journal.records.length,3);
});
test('removing a wear keeps a tombstone through backup, retains a deleted garment snapshot and cannot be resurrected by stale data',()=>{
 const base=patch(W.empty(),[wear('g_deleted','2026-10-12',{name:'旧裙子',brand:'Zimmermann'})]),local=patch(base,[wear('g_deleted','2026-10-12',{deleted:true})]);
 assert.equal(W.stats(local).days,0);const restored=W.validate(JSON.parse(JSON.stringify(local)));assert.equal(restored.records[0].name,'旧裙子');assert.equal(W.merge(base,restored,base).journal.records[0].deleted,true);
 assert.equal(W.importMissing(local,base).records[0].deleted,true);
});
test('independent devices merge distinct days and pieces and identical same-day marks without double counting',()=>{
 const local=patch(W.empty(),[wear('g_1'),wear('g_2','2026-10-10')]),remote=W.patch(W.empty(),[wear('g_1'),wear('g_3')],{...options,now:'2026-10-20T12:01:00Z'}),merged=W.merge(null,local,remote);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.journal.records.length,3);assert.equal(W.stats(merged.journal,'g_1').days,1);
});
test('simultaneous note changes require a choice while independent wear dates still survive',()=>{
 const base=patch(W.empty(),[{kind:'note',date:'2026-10-20',note:'原备注'}]);const local=patch(base,[{kind:'note',date:'2026-10-20',note:'本机晚餐'},wear('g_1')]),remote=patch(base,[{kind:'note',date:'2026-10-20',note:'手机旅行'},wear('g_2')]);
 const result=W.merge(base,local,remote);assert.equal(result.conflicts.length,1);const key='note:2026-10-20',resolved=W.merge(base,local,remote,{[key]:'remote'});assert.equal(resolved.conflicts.length,0);assert.equal(resolved.journal.records.find(r=>r.id===key).note,'手机旅行');assert.equal(W.stats(resolved.journal).garments,2);
});
test('malformed or duplicate backup records are rejected before import',()=>{
 const j=patch(W.empty(),[wear('g_1')]);for(const bad of [{...j,version:2},{...j,records:[...j.records,...j.records]},{...j,records:[{...j.records[0],id:'other'}]},{...j,records:[{...j.records[0],date:'2026-02-30'}]}])assert.throws(()=>W.validate(bad));
 assert.equal(W.importMissing(j,patch(W.empty(),[wear('g_1'),wear('g_2')])).records.length,2);
});
async function seedWardrobe(api){const c=Cloud.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',fetch:api.fetch,minWriteGap:0}),g={id:'g_1',name:'裙子',brand:'Zimmermann',category:'dresses',aspect:.7,image:new Blob(['display'],{type:'image/png'}),thumb:new Blob(['thumb'],{type:'image/png'}),original:new Blob(['original'],{type:'image/png'})};await c.connect();const remote=await c.readRemote(),prepared=await c.prepare([g],[]);await c.publish(prepared,remote);return c;}
test('journal sync adds only its own file and subsequent wardrobe sync preserves it',async()=>{
 const api=fixture(),wardrobe=await seedWardrobe(api),before=structuredClone(api.manifest()),client=makeClient(api),store=memory(patch(W.empty(),[wear('g_1')]));const out=await Sync.synchronize({store,client});assert.equal(out.conflicts.length,0);assert.equal(out.state.origin,client.origin);assert.deepEqual(api.manifest(),before);
 const r=await wardrobe.readRemote();await wardrobe.publish({...r.manifest,garments:r.manifest.garments.map(g=>({...g,name:'改名'}))},r);assert.equal((await client.read()).journal.records.length,1);assert.equal(api.manifest().garments[0].name,'改名');
 const mutations=api.requests.filter(r=>r.method==='PATCH');assert.ok(mutations.every(r=>r.body.force===false));assert.doesNotMatch(JSON.stringify((await client.read()).journal),/unit-test-only|Bearer/);
});
test('two devices converge after adding/removing days and a no-change sync makes no extra commit',async()=>{
 const api=fixture(),a=memory(patch(W.empty(),[wear('g_1')])),ca=makeClient(api),b=memory(),cb=makeClient(api);await Sync.synchronize({store:a,client:ca});await Sync.synchronize({store:b,client:cb});
 await a.update(s=>({...s,journal:patch(s.journal,[wear('g_1','2026-10-20',{deleted:true})])}));await b.update(s=>({...s,journal:patch(s.journal,[wear('g_2','2026-10-12')])}));await Sync.synchronize({store:a,client:ca});await Sync.synchronize({store:b,client:cb});await Sync.synchronize({store:a,client:ca});
 assert.ok(W.same((await a.read()).journal,(await b.read()).journal));assert.equal(W.stats((await a.read()).journal,'g_1').days,0);assert.equal(W.stats((await a.read()).journal,'g_2').days,1);const count=api.commitCount;await Sync.synchronize({store:a,client:ca});assert.equal(api.commitCount,count);
});
test('a concurrent branch move is reread and merged without forcing or changing the wardrobe',async()=>{
 const api=fixture();await seedWardrobe(api);const before=structuredClone(api.manifest()),store=memory(patch(W.empty(),[wear('g_1')]));api.moveBeforePublish();await Sync.synchronize({store,client:makeClient(api)});assert.deepEqual(api.manifest(),before);assert.equal(W.stats((await store.read()).base).days,1);
});
test('a local edit during a journal upload is merged and never marked synced prematurely',async()=>{
 const api=fixture(),store=memory(patch(W.empty(),[wear('g_1')]));let inserted=false;const client=Sync.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',minWriteGap:0,fetch:async(url,options)=>{if(options?.method==='PATCH'&&!inserted){inserted=true;await store.update(s=>({...s,journal:patch(s.journal,[wear('g_2','2026-10-10')])}));}return api.fetch(url,options);}});
 const result=await Sync.synchronize({store,client});assert.equal(W.stats(result.state.journal).garments,2);assert.equal(W.stats((await client.read()).journal).garments,2);assert.ok(W.same(result.state.base,result.state.journal));
});
test('public destinations, network failures and mismatched repositories keep the local checkpoint untouched',async()=>{
 const publicApi=fixture({privateRepo:false}),store=memory(patch(W.empty(),[wear('g_1')])),before=await store.read();await assert.rejects(Sync.synchronize({store,client:makeClient(publicApi)}),/私有/);assert.deepEqual(await store.read(),before);assert.equal(publicApi.requests.filter(r=>r.method!=='GET').length,0);
 const api=fixture();api.failNext(401);await assert.rejects(Sync.synchronize({store,client:makeClient(api)}),/授权/);assert.deepEqual(await store.read(),before);
 const other=memory(before.journal,{origin:'other/repository'});await assert.rejects(Sync.synchronize({store:other,client:makeClient(api)}),/原仓库/);
});
test('sync conflict resolution is accepted only for the exact unchanged versions the user reviewed',async()=>{
 const api=fixture(),a=memory(patch(W.empty(),[{kind:'note',date:'2026-10-20',note:'原文'}])),ca=makeClient(api);await Sync.synchronize({store:a,client:ca});const b=memory();await Sync.synchronize({store:b,client:makeClient(api)});
 await a.update(s=>({...s,journal:patch(s.journal,[{kind:'note',date:'2026-10-20',note:'本机'}])}));await b.update(s=>({...s,journal:patch(s.journal,[{kind:'note',date:'2026-10-20',note:'手机'}])}));await Sync.synchronize({store:b,client:makeClient(api)});const review=await Sync.synchronize({store:a,client:ca});assert.equal(review.conflicts.length,1);
 await a.update(s=>({...s,journal:patch(s.journal,[{kind:'note',date:'2026-10-20',note:'本机又改了'}])}));const stale=await Sync.synchronize({store:a,client:ca,choices:{'note:2026-10-20':'remote'},expectedConflicts:review.conflicts});assert.equal(stale.conflicts.length,1);
 const resolved=await Sync.synchronize({store:a,client:ca,choices:{'note:2026-10-20':'remote'},expectedConflicts:stale.conflicts});assert.equal(resolved.conflicts.length,0);assert.equal(resolved.state.journal.records[0].note,'手机');
});
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.events={};this.value='';this.style={};this.classList={add(){},remove(){}};}
 append(...children){for(const c of children){c.parentNode=this;this.children.push(c);}}
 replaceChildren(...children){this.children=[];this.append(...children);}setAttribute(k,v){this.attributes[k]=String(v);}addEventListener(type,fn){(this.events[type]||=[]).push(fn);}querySelector(tag){for(const c of this.children){if(c.tagName===tag.toUpperCase())return c;const r=c.querySelector(tag);if(r)return r;}return null;}
 showModal(){this.open=true;}close(){this.open=false;}click(){return this.fire('click');}async fire(type){for(const fn of this.events[type]||[])await fn({target:this});if(this['on'+type])await this['on'+type]({target:this});}
}
const text=e=>[e.textContent||'',...e.children.map(text)].join(' ');
const find=(e,cls)=>{for(const c of e.children){if(c.className===cls)return c;const r=find(c,cls);if(r)return r;}};
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const clothes=[{id:'g_1',name:'裙子',brand:'Zimmermann',category:'dresses',aspect:.7,thumb:PNG},{id:'g_2',name:'鞋子',brand:'Tabi',category:'shoes',aspect:1.2,thumb:PNG}];
async function ui({records=clothes,journal=W.empty(),outfits=[]}={}){
 const html=fs.readFileSync(path.join(root,'wear.html'),'utf8'),elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const doc={getElementById:id=>{assert.ok(elements[id],'missing '+id);return elements[id];},createElement:tag=>new Element(tag),addEventListener(){},querySelector:()=>Object.values(elements).find(e=>e.open)||null};
 const store=memory(journal),wardrobe={read:async name=>structuredClone(name==='garments'?records:outfits),write:()=>{throw new Error('must never write wardrobe');}},host={localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},matchMedia:()=>({matches:true}),addEventListener(){}};
 const app=await App.create({document:doc,store,wardrobe,host,clock:()=>new Date(now)});return {el:elements,store,app};
}
test('journal UI starts on today, records a batch with notes, updates statistics and undoes the same batch',async t=>{
 const {el,store,app}=await ui();t.after(()=>app.dispose());assert.match(el['wear-day-title'].textContent,/今天/);assert.equal(el['wear-month-panel'].hidden,true);await el['wear-add'].fire('click');assert.equal(el['wear-picker'].open,true);
 for(const b of el['wear-picker-grid'].children)await b.fire('click');el['wear-picker-note'].value='晚餐';await el['wear-picker-save'].fire('click');assert.equal(el['wear-picker'].open,false);assert.equal(W.stats((await store.read()).journal).garments,2);assert.equal(text(el['wear-day-note']),'晚餐');
 await el['wear-tab-stats'].fire('click');assert.match(text(el['wear-metrics']),/1 有记录的天数/);assert.match(text(el['wear-metrics']),/2 穿过的不同单品/);await el['wear-undo'].fire('click');assert.equal(W.stats((await store.read()).journal).days,0);assert.equal((await store.read()).journal.records.find(r=>r.kind==='note').deleted,true);
});
test('single-garment quick logging deduplicates and a month calendar batch adds/removes only the chosen dates',async t=>{
 const {el,store,app}=await ui();t.after(()=>app.dispose());await el['wear-tab-garment'].fire('click');let card=el['wear-garments'].children[1];assert.match(text(card),/裙子/);await find(card,'card-actions').children[0].fire('click');assert.equal(W.stats((await store.read()).journal,'g_1').days,1);
 card=el['wear-garments'].children.find(c=>text(c).includes('裙子'));await find(card,'card-actions').children[0].fire('click');assert.equal(W.stats((await store.read()).journal,'g_1').days,1);await find(card,'card-actions').children[1].fire('click');assert.equal(el['wear-piece-dialog'].open,true);
 await el['wear-piece-edit'].fire('click');for(const day of ['2026-10-12','2026-10-14','2026-10-20'])await el['wear-piece-calendar'].children.find(b=>b.dataset.date===day).fire('click');assert.match(el['wear-piece-changes'].textContent,/新增 2 天，移除 1 天/);await el['wear-piece-save'].fire('click');assert.deepEqual(W.active((await store.read()).journal,'g_1').map(r=>r.date),['2026-10-14','2026-10-12']);
 const before=store.writes.length;await el['wear-piece-calendar'].children.find(b=>b.dataset.date==='2026-10-12').fire('click');assert.equal(store.writes.length,before,'viewing a date must not edit it');assert.equal(el['wear-day-title'].textContent,labelFor('2026-10-12'));
});
function labelFor(day){return new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));}
test('failed saves retain picker choices and note for retry, cancel never writes, and future input cannot save',async t=>{
 const {el,store,app}=await ui();t.after(()=>app.dispose());await el['wear-add'].fire('click');await el['wear-picker-grid'].children[0].fire('click');el['wear-picker-note'].value='保留草稿';store.fail();await el['wear-picker-save'].fire('click');assert.equal(el['wear-picker'].open,true);assert.equal(store.writes.length,0);assert.match(el['wear-picker-error'].textContent,/失败/);assert.equal(el['wear-picker-note'].value,'保留草稿');await el['wear-picker-save'].fire('click');assert.equal(W.stats((await store.read()).journal).garments,1);
 await el['wear-add'].fire('click');await el['wear-picker-grid'].children[0].fire('click');await el['wear-picker-cancel'].fire('click');assert.equal(store.writes.length,1);
 await el['wear-add'].fire('click');el['wear-picker-date'].value='2026-10-21';await el['wear-picker-date'].fire('change');await el['wear-picker-save'].fire('click');assert.equal(store.writes.length,1);assert.match(el['wear-picker-error'].textContent,/过去/);
});
test('picker filtering preserves hidden selections and adding a saved outfit does not count until saved',async t=>{
 const {el,store,app}=await ui({outfits:[{id:'o_1',name:'晚餐搭配',layers:[{garmentId:'g_1'},{garmentId:'g_2'},{garmentId:'g_missing'}]}]});t.after(()=>app.dispose());await el['wear-add'].fire('click');await el['wear-picker-grid'].children[0].fire('click');el['wear-picker-search'].value='Tabi';await el['wear-picker-search'].fire('input');assert.match(el['wear-picker-count'].textContent,/已选 1 件/);el['wear-picker-outfit'].value='o_1';await el['wear-picker-outfit'].fire('change');assert.match(el['wear-picker-count'].textContent,/已选 2 件/);assert.equal(store.writes.length,0);await el['wear-picker-save'].fire('click');assert.equal(W.stats((await store.read()).journal).garments,2);
});
test('orphan histories remain readable and invalid imports cannot replace existing journal records',async t=>{
 const journal=patch(W.empty(),[wear('g_gone','2026-10-20',{name:'以前的裙子'})]),{el,store,app}=await ui({journal});t.after(()=>app.dispose());assert.match(text(el['wear-day-list']),/以前的裙子/);assert.match(text(el['wear-day-list']),/移除/);
 el['wear-import-file'].files=[{size:10,text:async()=>JSON.stringify({app:'wrong',version:1,records:[]})}];await el['wear-import-file'].fire('change');assert.equal(store.writes.length,0);assert.ok(W.same((await store.read()).journal,journal));
});
test('independent entrypoint resolves assets, all IDs exist and original application does not load journal code',()=>{
 const html=fs.readFileSync(path.join(root,'wear.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);const app=fs.readFileSync(path.join(root,'wear-app.js'),'utf8');for(const m of app.matchAll(/\$\('([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),m[1]);
 for(const m of html.matchAll(/(?:href|src)="\.\/([^"#]+)"/g))assert.ok(fs.existsSync(path.join(root,m[1].split('?')[0])),m[1]);const main=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(main,/<a class="nav-link" href="\.\/wear.html"/);assert.doesNotMatch(main,/<script[^>]+wear-/);
 for(const file of ['wear.html','wear-core.js','wear-store.js','wear-sync.js','wear-app.js','wear.css']){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/github_pat_[a-zA-Z0-9_]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{20,}/);for(const url of source.match(/https?:\/\/[^\s"'<>;]+/g)||[])assert.equal(new URL(url).hostname,'api.github.com');}
});
test('a missing or corrupt cloud journal cannot replace or recreate a previously synced history',async()=>{
 const api=fixture(),store=memory(patch(W.empty(),[wear('g_1')])),client=makeClient(api);await Sync.synchronize({store,client});const before=await store.read();let hide=true;
 const missing=Sync.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',minWriteGap:0,fetch:async(url,opts)=>{const response=await api.fetch(url,opts);if(hide&&url.includes('/git/trees/')){const data=await response.json();return {...response,json:async()=>({...data,tree:data.tree.filter(e=>e.path!=='wear-journal.json')})};}return response;}});
 await assert.rejects(Sync.synchronize({store,client:missing}),/缺失/);assert.deepEqual(await store.read(),before);
 const blob=[...api.blobs].find(([,bytes])=>bytes.toString().includes('"app":"wardrobe-wear-journal"'));api.corrupt(blob[0]);await assert.rejects(Sync.synchronize({store,client}),/损坏/);assert.deepEqual(await store.read(),before);
});
function databaseHarness(){
 const transactions=[],opens=[];const db={close(){},transaction(name,mode){const tx={name,mode,puts:[],abort(){this.aborted=true;this.onabort?.();},objectStore(){return {get(){const r={};tx.get=r;return r;},put(value){const r={};tx.puts.push({value,request:r});return r;}};}};transactions.push(tx);return tx;}};
 const context={WardrobeWear:W,indexedDB:{open(name,version){opens.push({name,version});const r={result:db};queueMicrotask(()=>r.onsuccess());return r;}}};vm.runInNewContext(fs.readFileSync(path.join(root,'wear-store.js'),'utf8'),context);return {api:context.WardrobeWearStore,transactions,opens};
}
const turn=()=>new Promise(setImmediate);
test('journal storage uses its own database and returns success only after transaction commit',async()=>{
 const {api,transactions,opens}=databaseHarness();let resolved=false;const pending=api.update(s=>({...s,journal:patch(s.journal,[wear('g_1')])})).then(x=>{resolved=true;return x;});await turn();const tx=transactions[0];tx.get.result=undefined;tx.get.onsuccess();assert.equal(tx.puts.length,1);assert.equal(resolved,false);assert.deepEqual(opens,[{name:'wardrobe-wear-journal-v1',version:1}]);assert.equal(tx.name,'state');tx.oncomplete();assert.equal(W.stats((await pending).journal).days,1);
});
test('journal quota or request abort rejects without success and invalid stored data is not reset',async()=>{
 const {api,transactions}=databaseHarness();const pending=api.update(s=>({...s,journal:patch(s.journal,[wear('g_1')])}));await turn();const tx=transactions[0];tx.get.onsuccess();tx.error=Object.assign(new Error('日记空间不足'),{name:'QuotaExceededError'});tx.onerror({target:{error:tx.error}});tx.onabort();await assert.rejects(pending,/空间不足/);
 const read=api.read();await turn();const r=transactions[1];r.get.result={journal:{app:'bad'}};r.get.onsuccess();await assert.rejects(read,/格式/);assert.equal(r.puts.length,0);assert.equal(r.aborted,true);
});
