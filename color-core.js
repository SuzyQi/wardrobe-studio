(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WardrobeColor=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const COLORS=[['white','白','#f7f6f0'],['beige','米','#d9cbb3'],['black','黑','#292a2b'],['gray','灰','#999b9c'],['brown','棕','#89604b'],['blue','蓝','#547ca7'],['green','绿','#6b8668'],['yellow','黄','#e9ce75'],['orange','橙','#d99156'],['red','红','#b85253'],['pink','粉','#d7a0b1'],['purple','紫','#9580b3'],['gold','金','#baa05b'],['silver','银','#b8c2ca'],['multi','多色',''],['unknown','待确认','']].map(([id,label,hex])=>({id,label,hex}));
 const label=id=>COLORS.find(c=>c.id===id)?.label||'待确认';
 const matches=(g,ids)=>!ids.length||ids.includes(g.mainColor||'unknown');
 function family(r,g,b){
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,s=max?delta/max:0,v=max;
  let h=0;if(delta){h=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;h=(h*60+360)%360;}
  if(v<.19||(v<.28&&s<.35))return 'black';
  if(h>=23&&h<65&&v>.60&&s>.05&&s<.36&&r-b>.025)return 'beige';
  if(s<.10)return v>.87?'white':'gray';
  if(s<.18)return v>.88?'white':'gray';
  if(h<18||h>=345)return v>.70&&s<.58?'pink':'red';
  if(h<48)return v<.65?'brown':'orange';
  if(h<70)return v<.55?'brown':'yellow';
  if(h<168)return 'green';
  if(h<260)return 'blue';
  if(h<318)return 'purple';
  return v>.68?'pink':'purple';
 }
 // Small transparent cutouts are preferred. Opaque photos require a uniform,
 // edge-connected neutral background; otherwise leave the decision uncertain.
 function analyze(data,w,h){
  if(!w||!h||data?.length!==w*h*4)return {mainColor:'unknown',colorSource:'auto'};
  const count=w*h,mask=new Uint8Array(count),opaque=[];let transparent=0;
  for(let i=0;i<count;i++)if(data[i*4+3]<80)transparent++;else opaque.push(i);
  if(opaque.length<8)return {mainColor:'unknown',colorSource:'auto'};
  if(transparent<count*.025){
   const sample=[0,w-1,(h-1)*w,count-1],rgb=sample.map(i=>Array.from(data.slice(i*4,i*4+3))),bg=[0,1,2].map(k=>rgb.reduce((sum,p)=>sum+p[k],0)/4);
   const spread=Math.max(...rgb.map(p=>Math.hypot(...p.map((v,k)=>v-bg[k]))));
   if(spread>22||Math.max(...bg)-Math.min(...bg)>24)return {mainColor:'unknown',colorSource:'auto'};
   const queue=new Int32Array(count);let head=0,tail=0;
   const add=i=>{if(mask[i])return;const p=i*4;if(Math.hypot(data[p]-bg[0],data[p+1]-bg[1],data[p+2]-bg[2])>30)return;mask[i]=1;queue[tail++]=i;};
   for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
   while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);if(x)add(i-1);if(x<w-1)add(i+1);if(y)add(i-w);if(y<h-1)add(i+w);}
   if(tail<count*.08||tail>count*.96)return {mainColor:'unknown',colorSource:'auto'};
  }
  const counts={};let total=0;
  for(const i of opaque){if(mask[i])continue;const p=i*4,key=family(data[p],data[p+1],data[p+2]);counts[key]=(counts[key]||0)+1;total++;}
  if(total<8)return {mainColor:'unknown',colorSource:'auto'};
  const ranked=Object.entries(counts).sort((a,b)=>b[1]-a[1]),first=ranked[0],second=ranked[1];
  const mainColor=second&&first[1]/total<.57&&second[1]/total>.23?'multi':first[1]/total>=.36?first[0]:'multi';
  return {mainColor,colorSource:'auto'};
 }
 return {COLORS,label,matches,family,analyze};
});
