(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CollageLab=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const W=1000,H=1250,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function choose(pool,locked=[],previous=[],rng=Math.random){
 const unique=[...new Map(pool.map(g=>[g.id,g])).values()],result=unique.filter(g=>locked.includes(g.id));
 const has=cat=>result.some(g=>g.category===cat);
 const pick=cat=>{if(has(cat))return;const options=unique.filter(g=>g.category===cat&&!result.some(x=>x.id===g.id));const fresh=options.filter(g=>!previous.includes(g.id));const a=fresh.length?fresh:options;if(a.length)result.push(a[Math.min(a.length-1,Math.floor(rng()*a.length))]);};
 if(!has('dresses')&&!has('tops')&&!has('bottoms')){if(unique.some(g=>g.category==='dresses')&&(!unique.some(g=>g.category==='tops')||rng()<.45))pick('dresses');else{pick('tops');pick('bottoms');}}
 else if(!has('dresses')){pick('tops');pick('bottoms');}
 for(const cat of ['outerwear','shoes','bags','accessories'])pick(cat);
 if(!result.length&&unique.length)result.push(unique[Math.min(unique.length-1,Math.floor(rng()*unique.length))]);
 return result.slice(0,24);
}
const slots={tops:[430,365,420,380],bottoms:[440,775,360,480],dresses:[430,610,420,790],outerwear:[265,475,380,640],shoes:[520,1070,330,145],bags:[770,780,225,245],accessories:[770,275,160,210],figure:[475,625,430,970],reference:[770,475,250,320]};
function layout(items,rng=Math.random){const counts={};return items.map(g=>{const slot=slots[g.category]||[720,510,240,300],n=counts[g.category]||0;counts[g.category]=n+1;const a=clamp(Number(g.aspect)||.7,.12,8),width=Math.min(slot[2],slot[3]*a),height=width/a;return {id:g.id,garmentId:g.garmentId||g.id,kind:g.kind||'garment',name:g.name||'剪纸',category:g.category||'other',aspect:a,x:clamp(slot[0]+(rng()-.5)*75+n*45,30,W-30),y:clamp(slot[1]+(rng()-.5)*50+n*40,30,H-30),w:width,h:height,rotation:(rng()-.5)*14,opacity:g.category==='reference'?.68:1,flip:false,locked:!!g.locked};});}
function normalize(input){if(!input||input.version!==1||!Array.isArray(input.layers)||input.layers.length>24)throw new Error('实验记录格式无效。');const ids=new Set();return {version:1,title:String(input.title||'无题实验').slice(0,80),paper:['rose','sage','blue'].includes(input.paper)?input.paper:'blue',layers:input.layers.map(l=>{if(!l||typeof l.id!=='string'||ids.has(l.id)||!['garment','upload'].includes(l.kind)||![l.x,l.y,l.w,l.h,l.rotation,l.opacity].every(Number.isFinite))throw new Error('拼贴图层无效。');ids.add(l.id);return {...l,name:String(l.name||'剪纸').slice(0,120),x:clamp(l.x,0,W),y:clamp(l.y,0,H),w:clamp(l.w,30,900),h:clamp(l.h,20,1100),rotation:clamp(l.rotation,-180,180),opacity:clamp(l.opacity,.15,1),flip:!!l.flip,locked:!!l.locked};})};}
function hit(l,x,y){const a=-l.rotation*Math.PI/180,dx=x-l.x,dy=y-l.y;return Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=l.w/2&&Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=l.h/2;}
function move(l,x,y){return {...l,x:clamp(x,30,W-30),y:clamp(y,30,H-30)};}
return {W,H,clamp,choose,layout,normalize,hit,move};
});
