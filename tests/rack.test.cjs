const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const R=require('../rack-core.js'),App=require('../rack-app.js');
const root=path.resolve(__dirname,'..');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const clothes=[{id:'dress',name:'藏品连衣裙',brand:'Zimmermann',category:'dresses',thumb:PNG,image:PNG,aspect:.5,size:'UK 8',color:'白色',purchasePrice:99,currency:'GBP',archive:{year:'2020',story:'收藏故事'}},{id:'top',name:'衬衫',brand:'COS',category:'tops',thumb:PNG,image:PNG,aspect:.8},{id:'shoes',name:'鞋',brand:'COS',category:'shoes',thumb:PNG,image:PNG,aspect:1.5}];
test('spatial layout keeps the centred garment face-on and adjacent garments in perspective, including narrow screens',()=>{for(const width of [320,390,768,1400]){const p=R.pose(6,6,width);assert.equal(p.x,0);assert.equal(Math.abs(p.yaw),0);assert.equal(p.scale,1);const left=R.pose(5,6,width),right=R.pose(7,6,width);assert(left.x<0&&right.x>0);assert(left.yaw>0&&right.yaw<0);assert.equal(left.scale,right.scale);assert(R.nearby(1000,500).length<=12);assert.equal(R.pose(20,0,width).visible,false);}});
test('spring settles and stops; drag release clamps at either end, including an empty or single-item rack',()=>{let s={position:0,velocity:0};for(let i=0;i<220;i++)s=R.spring(s,4,.016);assert.deepEqual(s,{position:4,velocity:0});assert.equal(R.release(0,-2,-9,10),0);assert.equal(R.release(9,11,8,10),9);assert.equal(R.release(0,.25,0,10),1);assert.equal(R.release(0,.9,3,1),0);assert.equal(R.release(0,0,0,0),0);});
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.value='';this.hidden=false;this.checked=false;this.events={};this.classList={add(){},remove(){},toggle(){}};}
 append(...xs){for(const x of xs){x.parentNode=this;this.children.push(x);}}replaceChildren(...xs){this.children=[];this.append(...xs);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);}setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}addEventListener(k,fn){this.events[k]=fn;}removeEventListener(k){delete this.events[k];}showModal(){this.open=true;}close(){this.open=false;this.events.close?.();}getBoundingClientRect(){return {left:0,top:0,width:390,height:400,right:390,bottom:400};}focus(){}setPointerCapture(){}closest(){return null;}
}
const tick=()=>new Promise(setImmediate);
async function ui({records=clothes,remote=null,broken=false,reduce=false,stored={}}={}){
 const html=fs.readFileSync(path.join(root,'rack.html'),'utf8'),els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));const frames=new Map(),calls={writes:0,cloud:[],images:0,revoke:[]};let time=100,id=0;const prefs=new Map(Object.entries(stored));const d={hidden:false,body:new Element(),getElementById:n=>{assert(els[n],n);return els[n];},createElement:t=>new Element(t),addEventListener(){},removeEventListener(){}};
 const host={Blob,URL:{createObjectURL:()=>('blob:fixture-'+(++id)),revokeObjectURL:u=>calls.revoke.push(u)},performance:{now:()=>time},matchMedia:()=>({matches:reduce}),requestAnimationFrame:fn=>{const n=++id;frames.set(n,fn);return n;},cancelAnimationFrame:n=>frames.delete(n),localStorage:{getItem:k=>remote&&k==='wardrobe-github-device'?JSON.stringify({owner:'test',repo:'private-data',token:'fixture-only'}):prefs.get(k)||null,setItem:(k,v)=>prefs.set(k,v)},sessionStorage:{getItem:()=>null},addEventListener(){},removeEventListener(){}};
 const cloud={createClient:()=>({fullName:'test/private-data',connect:async()=>calls.cloud.push('connect'),readRemote:async()=>{calls.cloud.push('read');return {manifest:{garments:remote}};},getAsset:async()=>{calls.cloud.push('asset');return new Blob(['remote']);},disconnect(){calls.cloud.push('disconnect');},publish(){throw Error('must never publish');}}),localRecords:m=>m.garments};
 els['rack-detail-hanger'].append(new Element('span'),new Element('span'));
 const app=await App.create({document:d,host,wardrobe:{read:async()=>structuredClone(records),write:()=>{calls.writes++;throw Error('must never mutate wardrobe');}},cloud,imaging:{fromDataUrl:x=>new Blob([x]),load:async()=>{calls.images++;if(broken)throw Error('图片损坏');return {};}}});
 async function flush(){for(let i=0;i<240&&frames.size;i++){const f=[...frames.values()];frames.clear();time+=16;for(const fn of f)fn(time);}await tick();}
 return {app,els,calls,host,frames,prefs,flush,advance:n=>time+=n};
}
test('browse, brand/category/search filters, keyboard movement and detail archives share actual records without writes',async()=>{
 const {app,els,calls,flush}=await ui();assert.equal(app.getState().ids.length,2);assert.deepEqual(app.getState().shoeIds,['shoes']);await app.openDetail();assert.equal(els['rack-detail'].open,true);assert.equal(els['rack-detail-name'].textContent,'藏品连衣裙');assert.equal(els['rack-detail-story'].textContent,'收藏故事');assert.match(els['rack-archive'].href,/garment=dress/);app.closeDetail();assert.equal(els['rack-detail'].open,false);
 app.select(1);await flush();assert.equal(app.getState().position,1);assert.equal(els['rack-name'].textContent,'衬衫');els['rack-brand'].value='cos';els['rack-brand'].onchange();assert.deepEqual(app.getState().ids,['top']);assert.deepEqual(app.getState().shoeIds,['shoes']);els['rack-category'].value='shoes';els['rack-category'].onchange();assert.deepEqual(app.getState().ids,[]);assert.deepEqual(app.getState().shoeIds,['shoes']);assert.equal(els['rack-stage'].hidden,true);els['rack-search'].value='不存在';els['rack-search'].oninput();assert.equal(els['rack-empty'].hidden,false);assert.equal(els['rack-reset'].hidden,false);assert.equal(app.getState().ids.length,0);await els['rack-reset'].onclick();assert.equal(app.getState().ids.length,2);assert.deepEqual(app.getState().shoeIds,['shoes']);els['rack-stage'].onkeydown({key:'End',preventDefault(){}});await flush();assert.equal(app.getState().active,1);assert.equal(calls.writes,0);app.dispose();assert(calls.revoke.length>0);
});
test('horizontal drag advances while a vertical gesture leaves the selected garment unchanged; reduced motion snaps with no animation loop',async()=>{
 const {app,els,advance,flush,frames}=await ui();const stage=els['rack-stage'],target=new Element();const down={button:0,pointerId:1,clientX:200,clientY:100,target};stage.onpointerdown(down);advance(20);stage.onpointermove({...down,clientY:160,preventDefault(){throw Error('vertical scroll must remain native');}});stage.onpointerup(down);assert.equal(app.getState().active,0);
 stage.onpointerdown(down);advance(20);stage.onpointermove({...down,clientX:60,preventDefault(){}});stage.onpointerup({...down,clientX:60});await flush();assert.equal(app.getState().active,1);assert.equal(frames.size,0);els['rack-reduce'].checked=true;els['rack-reduce'].onchange();app.select(0);assert.equal(app.getState().position,0);assert.equal(frames.size,0);assert.equal(app.getState().reduced,true);
});
test('only nearby garments enter the stage, even with a large wardrobe, and refresh preserves the current garment',async()=>{
 const records=Array.from({length:350},(_,i)=>({...clothes[0],id:'g_'+i,name:'衣服 '+i}));const {app,els,flush}=await ui({records});app.select(180);await flush();assert(app.getState().rendered<=12);assert.equal(els['rack-pieces'].children.length,app.getState().rendered);await app.refresh();assert.equal(app.getState().ids[app.getState().active],'g_180');
});
test('new devices can read private metadata and images through remembered auth, but never publish or persist credentials',async()=>{
 const remote=clothes.map(g=>({...g,image:null,thumb:null,cloudOrigin:'test/private-data',cloudAssets:{image:{path:'verified'},thumb:{path:'verified-thumb'}}}));const {app,calls,prefs}=await ui({records:[],remote});await tick();await app.openDetail();assert(calls.cloud.includes('read'));assert(calls.cloud.includes('asset'));assert.equal(calls.writes,0);assert.equal(prefs.size,0);assert(!JSON.stringify(app.getState()).includes('fixture-only'));
});
test('missing or corrupt photos show an explicit error and do not erase wardrobe records',async()=>{
 const {app,els,calls}=await ui({broken:true});await tick();await app.openDetail();assert.equal(els['rack-error'].hidden,false);assert.match(els['rack-error'].textContent,/未能读取/);assert.match(els['rack-detail-image-status'].textContent,/原图未能加载/);assert.equal(app.getState().ids.length,2);assert.deepEqual(app.getState().shoeIds,['shoes']);assert.equal(calls.writes,0);
 const empty=await ui({records:[]});assert.equal(empty.els['rack-empty'].hidden,false);assert.equal(empty.els['rack-open'].disabled,true);
});
test('examples are opt-in and isolated; source assets and all app IDs resolve; no paid or external rendering dependencies',async()=>{
 const {app,host,calls}=await ui({records:[]});host.WardrobeDemo=[{name:'示例',category:'tops',svg:'<svg viewBox="0 0 100 100"></svg>'}];assert.equal(app.getState().ids.length,0);app.examples();assert.equal(app.getState().example,true);assert.deepEqual(app.getState().ids,['rack-demo-0']);assert.equal(calls.writes,0);
 const html=fs.readFileSync(path.join(root,'rack.html'),'utf8'),js=fs.readFileSync(path.join(root,'rack-app.js'),'utf8');const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const m of js.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(m[1]),m[1]);for(const m of html.matchAll(/(?:src|href)="\.\/([^"?]+)/g))assert(fs.existsSync(path.join(root,m[1])),m[1]);assert(!/<script[^>]+src="https?:/.test(html));assert(fs.readFileSync(path.join(root,'index.html'),'utf8').includes('href="./rack.html"'));
});
test('shoes never enter the hanging carousel or its arrows and instead open from a separate shelf without changing the selected garment',async()=>{
 const second={...clothes[2],id:'shoes2',name:'第二双鞋'};const {app,els,calls}=await ui({records:[...clothes,second]});await tick();assert.deepEqual(app.getState().ids,['dress','top']);assert.deepEqual(app.getState().shoeIds,['shoes','shoes2']);assert(els['rack-pieces'].children.every(n=>!n.dataset.id.startsWith('shoes')));assert.equal(els['rack-shoes'].hidden,false);assert.equal(els['rack-shoe-row'].children.length,2);assert(!els['rack-shoe-row'].children[0].children.some(n=>n.className==='hanger'));await app.openDetail();assert(els['rack-detail-image'].style.width);app.closeDetail();await els['rack-shoe-row'].children[0].onclick();assert.equal(els['rack-detail-image'].style.width,'');assert.equal(els['rack-detail'].dataset.category,'shoes');assert.equal(els['rack-detail-name'].textContent,'鞋');assert.match(els['rack-archive'].href,/garment=shoes$/);assert.equal(els['rack-detail-prev'].disabled,true);await els['rack-detail-next'].onclick();assert.equal(els['rack-detail-name'].textContent,'第二双鞋');assert.equal(els['rack-detail-next'].disabled,true);assert.equal(app.getState().active,0);app.closeDetail();assert.equal(calls.writes,0);
});
test('a shoes-only wardrobe or shoes-only filter shows the lower row without a misleading empty hanging rail',async()=>{
 const {app,els}=await ui({records:[clothes[2]]});assert.deepEqual(app.getState().ids,[]);assert.deepEqual(app.getState().shoeIds,['shoes']);assert.equal(els['rack-stage'].hidden,true);assert.equal(els['rack-selected-info'].hidden,true);assert.equal(els['rack-shoes'].hidden,false);assert.equal(els['rack-empty'].hidden,true);assert.equal(els['rack-open'].disabled,true);await els['rack-shoe-row'].children[0].onclick();assert.equal(els['rack-detail-name'].textContent,'鞋');assert.equal(els['rack-detail-prev'].disabled,true);assert.equal(els['rack-detail-next'].disabled,true);els['rack-search'].value='没有';els['rack-search'].oninput();assert.equal(els['rack-stage'].hidden,false);assert.equal(els['rack-empty'].hidden,false);assert.equal(els['rack-shoes'].hidden,true);await els['rack-reset'].onclick();assert.equal(els['rack-stage'].hidden,true);
});
test('touch dragging survives implicit capture leaving a garment button, then settles without opening a preview',async()=>{
 const {app,els,advance,flush}=await ui();const stage=els['rack-stage'],piece=els['rack-pieces'].children[0];const down={button:0,isPrimary:true,pointerType:'touch',pointerId:81,clientX:260,clientY:150,target:piece};stage.onpointerdown(down);
 // Touch starts implicitly captured by the button. Capturing the stage sends a
 // bubbling lostpointercapture from that old button; that is not a cancelled drag.
 stage.setPointerCapture=id=>stage.onlostpointercapture({pointerId:id,target:piece});advance(18);stage.onpointermove({...down,clientX:220,preventDefault(){}});advance(18);stage.onpointermove({...down,clientX:80,preventDefault(){}});stage.onpointerup({...down,clientX:80});await flush();assert.equal(app.getState().active,1);assert.equal(app.getState().position,1);assert.notEqual(els['rack-detail'].open,true);assert.equal(els['rack-name'].textContent,'衬衫');
});
test('hanger support follows narrow straps instead of a fixed rectangle and remains centred on the rail',()=>{
 const make=(w,h,rects)=>{const a=new Uint8ClampedArray(w*h*4);for(const [x1,y1,x2,y2]of rects)for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)a[(y*w+x)*4+3]=255;return a;};
 const gown=R.support(make(120,300,[[35,10,40,65],[80,10,85,65],[30,65,90,299]]),120,300,'dresses');assert.equal(gown.measured,true);assert.equal(gown.kind,'straps');
 const shirt=R.support(make(200,260,[[80,10,120,32],[35,32,165,85],[10,85,190,140],[35,140,165,259]]),200,260,'tops');assert.equal(shirt.kind,'shoulder');
 for(const [w,h]of [[205,330],[260,395],[330,470]]){const a=R.fitting(gown,w,h,'dresses'),b=R.fitting(shirt,w,h,'tops');assert(a.hanger.w<b.hanger.w*.65);assert(Math.abs(a.image.w/a.image.h-gown.aspect)<.001);assert(Math.abs(a.hanger.x+a.hanger.w/2-w/2)<.001);assert(Math.abs(a.image.x+(gown.left+gown.right)/2*a.image.w-w/2)<.001);assert(a.image.y+a.image.h<=h);assert(a.hanger.drop>0);}
 const skirt=R.support(make(120,200,[[20,0,100,200]]),120,200,'bottoms');assert.equal(skirt.kind,'clip');assert.equal(R.fitting(skirt,205,330,'bottoms').hanger.kind,'clip');
 const opaque=new Uint8ClampedArray(120*200*4).fill(255);assert.equal(R.support(opaque,120,200,'dresses').measured,false);
});

test('shirt hanger arms begin behind the collar and end inside the shoulders in every view',()=>{
 const profile={aspect:.75,left:.12,right:.88,y:.16,neckY:.04,kind:'shoulder',measured:true};
 for(const [w,h] of [[205,330],[260,395],[330,470]]){
  const f=R.fitting(profile,w,h),apex=3+f.hanger.woodTop;
  assert(apex>f.image.y+profile.neckY*f.image.h);
  assert(apex+f.hanger.drop>f.image.y+profile.y*f.image.h);
  assert(f.hanger.w<(profile.right-profile.left)*f.image.w);
  assert(3-9+f.hanger.hookHeight>=apex);
 }
});

test('uncertain opaque necks retain a collar support; manual preview, cancel, save and restore remain per garment',async()=>{
 const {app,els,prefs,calls}=await ui();await app.openDetail(clothes[1]);assert.equal(els['rack-detail-piece'].neckHanger.hidden,false);
 await els['rack-neck-toggle'].onclick();assert.equal(els['rack-neck-editor'].hidden,false);
 els['rack-neck-shape'].value='v';els['rack-neck-shape'].onchange();const window=els['rack-detail-piece'].neckHanger;assert(window);assert.equal(window.hidden,false);assert.match(window.style.clipPath,/polygon/);assert.equal(els['rack-detail-piece'].neckHandles.filter(b=>!b.hidden).length,3);
 await els['rack-neck-cancel'].onclick();assert.equal(window.hidden,false);assert(!prefs.has('wardrobe-rack-neck-v1'));
 await els['rack-neck-toggle'].onclick();els['rack-neck-shape'].value='round';els['rack-neck-shape'].onchange();await els['rack-neck-save'].onclick();assert.equal(JSON.parse(prefs.get('wardrobe-rack-neck-v1')).top.shape,'round');assert.equal(window.hidden,false);
 await app.openDetail(clothes[2],'shoes');assert.equal(window.hidden,true);await app.openDetail(clothes[1]);assert.equal(window.hidden,false);
 await els['rack-neck-toggle'].onclick();await els['rack-neck-auto'].onclick();await els['rack-neck-save'].onclick();assert.equal(window.hidden,false);assert.deepEqual(JSON.parse(prefs.get('wardrobe-rack-neck-v1')),{});assert.equal(calls.writes,0);app.dispose();
});
test('transparent neck indentation is detected, while opaque and flat high necks do not invent an opening',()=>{
 const w=100,h=200,a=new Uint8ClampedArray(w*h*4);for(let x=10;x<90;x++){const first=10+Math.max(0,20-Math.abs(x-50));for(let y=first;y<190;y++)a[(y*w+x)*4+3]=255;}
 const n=R.neckline(a,w,h,{left:10,right:89,top:10,bottom:189});assert(n);assert(n.depth>.05);assert(R.neckPoints(n).length>4);
 const opaque=new Uint8ClampedArray(w*h*4).fill(255);assert.equal(R.neckline(opaque,w,h,{left:0,right:99,top:0,bottom:199}),null);
 assert.equal(R.calibration({shape:'v',x:NaN,y:.1,width:.2,depth:.1}),null);assert.equal(R.calibration({shape:'bad',x:.5,y:.1,width:.2,depth:.1}),null);assert.deepEqual(R.neckPoints({shape:'closed'}),[]);
});

test('saved neck settings survive a fresh app and storage failure leaves the draft available',async()=>{
 const stored={'wardrobe-rack-neck-v1':JSON.stringify({top:{shape:'v',x:.5,y:.08,width:.2,depth:.1},bad:{shape:'v',x:null}})};const {app,els,host}=await ui({stored});await app.openDetail(clothes[1]);assert.equal(els['rack-detail-piece'].neckHanger.hidden,false);await els['rack-neck-toggle'].onclick();assert.equal(els['rack-neck-shape'].value,'v');assert.match(els['rack-neck-status'].textContent,/已保存的手动校准/);host.localStorage.setItem=()=>{throw Error('quota');};await els['rack-neck-save'].onclick();assert.equal(els['rack-neck-editor'].hidden,false);assert.match(els['rack-neck-status'].textContent,/保存失败/);await els['rack-neck-cancel'].onclick();assert.equal(els['rack-detail-piece'].neckHanger.hidden,false);app.dispose();
});

test('uncertain neckline fallback stays on the top rim and leaves a visible wood segment at mobile and large sizes',()=>{
 for(const [w,h] of [[205,330],[260,395],[330,470]]){
 const p={aspect:.65,left:.1,right:.9,y:.18,neckY:.09,topY:.05,bodyHeight:.9,collarWidth:.25,kind:'shoulder'},n=R.defaultNeck(p),f=R.fitting({...p,neckY:n.y+Math.min(.012,n.depth*.15)},w,h);
 const apex=3+f.hanger.woodTop,top=f.image.y+p.topY*f.image.h;
 assert(apex>=top-1&&apex<=top+4);assert(f.image.y+(n.y+n.depth)*f.image.h>apex+4);assert(n.depth<.055);assert(n.width<=.30);
 }
 assert.equal(R.defaultNeck({kind:'clip'}),null);assert.equal(R.defaultNeck({kind:'straps'}),null);
});

test('rabbit hanger keeps its carved proportions and reaches the straps without a floating gap',()=>{
 for(const [w,h] of [[205,330],[260,395],[330,470]]){
  const a=R.fitting({aspect:.42,left:.28,right:.72,y:.06,kind:'straps'},w,h),b=R.rabbitFitting(a);
  assert.deepEqual(a.image,b.image);assert(Math.abs(b.hanger.drop/b.hanger.w-506/1881)<.00001);
  assert(Math.abs(b.hanger.woodTop+b.hanger.drop-a.hanger.woodTop-a.hanger.drop-2)<.001);
 }
 const a=R.fitting({aspect:.6,left:.1,right:.9,y:.02,kind:'clip'},205,330);assert.deepEqual(R.rabbitFitting(a),a);
 assert(fs.existsSync(path.join(root,'assets/rabbit-hanger.webp')));
});

test('sleeved rabbit hanger hook reaches the neck while the full carving is hidden outside the opening',()=>{
 const a=R.fitting({aspect:.7,left:.1,right:.9,y:.14,neckY:.04,kind:'shoulder'},205,330),b=R.rabbitFitting(a);
 assert.equal(b.hanger.hookHeight,a.hanger.hookHeight);
 assert(Math.abs(b.hanger.woodTop+b.hanger.w*110/1881-a.hanger.woodTop)<.001);
 const css=fs.readFileSync(path.join(root,'rack.css'),'utf8');assert(css.includes('.hanger[data-kind=shoulder] .hanger-wood{visibility:hidden}'));
});

test('calibration status distinguishes persisted settings, edits, cancellation and pending automatic restore',async()=>{
 const stored={'wardrobe-rack-neck-v1':JSON.stringify({top:{shape:'round',x:.5,y:.06,width:.2,depth:.1}})},u=await ui({stored});const {app,els}=u;await app.openDetail(clothes[1]);await els['rack-neck-toggle'].onclick();assert.match(els['rack-neck-status'].textContent,/已保存的手动校准/);
 els['rack-neck-width'].value='25';els['rack-neck-width'].oninput();assert.match(els['rack-neck-status'].textContent,/本次修改尚未保存/);await els['rack-neck-cancel'].onclick();await els['rack-neck-toggle'].onclick();assert.match(els['rack-neck-status'].textContent,/已保存的手动校准/);
 await els['rack-neck-auto'].onclick();assert.match(els['rack-neck-status'].textContent,/恢复自动预览.*尚未保存/);await els['rack-neck-save'].onclick();assert.match(els['rack-neck-message'].textContent,/已恢复自动估计/);app.dispose();
});
