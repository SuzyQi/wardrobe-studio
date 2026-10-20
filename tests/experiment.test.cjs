const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../experiment-core.js'),App=require('../experiment-app.js'),Renderer=require('../experiment-render.js');
const root=path.resolve(__dirname,'..');
const clothes=[{id:'top1',name:'衬衫',category:'tops',aspect:.8,image:'data:image/png;base64,AA=='},{id:'top2',name:'针织',category:'tops',aspect:.9,image:'data:image/png;base64,AA=='},{id:'bottom',name:'裙子',category:'bottoms',aspect:.6,image:'data:image/png;base64,AA=='},{id:'dress',name:'连衣裙',category:'dresses',aspect:.5,image:'data:image/png;base64,AA=='},{id:'shoes',name:'鞋',category:'shoes',aspect:2,image:'data:image/png;base64,AA=='}];
test('random choices keep locks, prefer alternatives, balance separates, and terminate with an incomplete wardrobe',()=>{
 const a=C.choose(clothes,['top1'],['top1'],()=>.1);assert(a.some(g=>g.id==='top1'));assert(a.some(g=>g.id==='bottom'));assert(!a.some(g=>g.id==='dress'));assert.equal(new Set(a.map(g=>g.id)).size,a.length);
 const b=C.choose(clothes.filter(g=>g.category==='tops'),[],['top1'],()=>.9);assert.equal(b[0].id,'top2');assert.deepEqual(C.choose([]),[]);assert.equal(C.choose([clothes[0],clothes[0]]).length,1);
});
test('layouts retain image proportions, safe coordinates and rotations; hit testing accounts for rotation',()=>{
 for(let i=0;i<50;i++)for(const l of C.layout(clothes)){assert(Math.abs(l.w/l.h-l.aspect)<.001);assert(l.x>0&&l.x<C.W&&l.y>0&&l.y<C.H);assert(Math.abs(l.rotation)<=7);assert(C.hit(l,l.x,l.y));assert(!C.hit(l,-1000,-1000));}
 const l={x:100,y:100,w:100,h:20,rotation:90};assert(C.hit(l,100,140));assert(!C.hit(l,140,100));assert.equal(C.move(l,-999,9999).y,1220);
 assert.throws(()=>C.normalize({version:1,layers:[{...l,id:'x',kind:'garment',opacity:NaN}]}));
});
class E{constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.value='';this.hidden=false;this.disabled=false;this.ctx={scale(){}};}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}setAttribute(k,v){this.attributes[k]=v;}getContext(){return this.ctx;}getBoundingClientRect(){return {left:0,top:0,width:500,height:625};}focus(){}setPointerCapture(){} }
async function setup({records=clothes,from='',saved=[],failSave=false,failImage=false}={}){
 const html=fs.readFileSync(path.join(root,'experiment.html'),'utf8'),els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new E()])),calls={writes:0,exports:[],draws:[],saved:[],cloudWrites:0};
 const d={getElementById:id=>{assert(els[id],id);return els[id];},createElement:t=>new E(t)};const host={Blob,crypto:require('node:crypto').webcrypto,URL,location:{search:from},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},addEventListener(){}};
 const app=await App.create({document:d,host,wardrobe:{read:async s=>s==='garments'?structuredClone(records):[{id:'draft',layers:[{garmentId:'top1'}]}],write(){calls.writes++;throw Error('never');}},store:{read:async()=>saved,save:async r=>{if(failSave)throw Error('QuotaExceededError');calls.saved.push(structuredClone(r));},remove:async()=>{}},imaging:{fromDataUrl:x=>new Blob([x]),load:async()=>{if(failImage)throw Error('坏图片');return {width:10,height:20};},blob:async()=>new Blob(['png']),download:(b,n)=>calls.exports.push(n)},renderer:{draw:(ctx,m,images,opt)=>calls.draws.push({m:structuredClone(m),opt})},rng:()=>.9});return {app,els,calls};
}
test('board shortcut carries and locks existing garments without mutating shared storage; reroll and reflow preserve locked identity',async()=>{
 const {app,els,calls}=await setup({from:'?from=board'});assert.equal(app.getModel().layers[0].garmentId,'top1');assert(app.getModel().layers[0].locked);await app.randomize();const ids=app.getModel().layers.map(l=>l.garmentId);assert(ids.includes('top1'));app.reflow();assert.deepEqual(app.getModel().layers.map(l=>l.garmentId),ids);assert(app.getModel().layers.find(l=>l.garmentId==='top1').locked);await app.save();assert.equal(calls.saved.length,1);assert.equal(calls.writes,0);assert(!JSON.stringify(calls.saved).includes('token'));await app.exportPNG();assert.equal(calls.exports.length,1);assert.equal(calls.draws.at(-2).opt.exporting,true);app.dispose();
});
test('empty wardrobes stay empty; failed local save and missing images cannot report success or export blank results',async()=>{
 const empty=await setup({records:[]});assert.equal(empty.app.getModel().layers.length,0);assert.equal(empty.els.empty.hidden,false);await assert.rejects(empty.app.randomize(),/同步/);
 const bad=await setup({failSave:true});await bad.app.randomize();await assert.rejects(bad.app.save(),/尚未保存/);assert.equal(bad.calls.saved.length,0);assert.equal(bad.els.save.disabled,false);
 const broken=await setup({failImage:true});await assert.rejects(broken.app.randomize(),/坏图片/);await assert.rejects(broken.app.exportPNG(),/坏图片/);assert.equal(broken.calls.exports.length,0);
});
test('only a garment’s own runway/reference can be added, with its own source field',async()=>{
 const g={...clothes[0],archive:{photos:[{id:'own',kind:'runway'}]},photo_own:'data:image/png;base64,AA=='};const {app,els}=await setup({records:[g],from:'?from=board'});const row=els.layers.children[0];await row.children.find(b=>b.textContent==='附图').onclick();const ref=app.getModel().layers.find(l=>l.field);assert.equal(ref.garmentId,'top1');assert.equal(ref.field,'photo_own');assert.equal(ref.opacity,.68);
});
test('renderer omits selection and missing-image placeholders from exported artwork',()=>{
 const calls=[];const ctx=new Proxy({canvas:null},{get:(o,k)=>k in o?o[k]:(...args)=>calls.push([k,...args])});const model={paper:'rose',title:'测试',layers:C.layout([clothes[0]])};Renderer.draw(ctx,model,new Map([[model.layers[0].id,{}]]),{selected:model.layers[0].id,exporting:true});assert(calls.some(c=>c[0]==='drawImage'));assert(!calls.some(c=>c[0]==='strokeRect'));assert(!calls.some(c=>c.includes('图片待载入')));
});
test('experiment store waits for transaction commit and rejects aborts; uses a separate database',async()=>{
 const txs=[];const db={close(){},transaction(){const tx={objectStore:()=>({put:r=>{tx.row=r;return tx.req={};}})};txs.push(tx);return tx;}};const env={indexedDB:{open(name){assert.equal(name,'wardrobe-collage-lab-v1');const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}},Promise};vm.runInNewContext(fs.readFileSync(path.join(root,'experiment-store.js'),'utf8'),env);let done=false;const p=env.CollageStore.save({id:'a',uploads:[{bytes:new ArrayBuffer(4),type:'image/png'}]}).then(()=>done=true);await new Promise(setImmediate);txs[0].req.onsuccess();assert.equal(done,false);txs[0].oncomplete();await p;assert.equal(done,true);const bad=env.CollageStore.save({id:'a'});await new Promise(setImmediate);txs[1].error=new Error('quota');txs[1].onabort();await assert.rejects(bad,/quota/);
});
test('entrypoint contains every app ID, local asset and isolated navigation entries',()=>{
 const html=fs.readFileSync(path.join(root,'experiment.html'),'utf8'),js=fs.readFileSync(path.join(root,'experiment-app.js'),'utf8');const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const m of js.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(m[1]),m[1]);for(const m of html.matchAll(/(?:src|href)="\.\/([^"?]+)/g))assert(fs.existsSync(path.join(root,m[1])),m[1]);const index=fs.readFileSync(path.join(root,'index.html'),'utf8');assert(index.includes('href="./experiment.html"'));assert(index.includes('href="./experiment.html?from=board"'));assert(!index.includes('src="./experiment-app.js'));
});
