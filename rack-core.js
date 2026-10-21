(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WardrobeRack=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function pose(index,position,width=1000,sway=0){const d=index-position,away=Math.abs(d),side=width<600?64:91,spread=width<600?99:151;return {x:d*side+clamp(d,-1,1)*spread,y:Math.min(away,4)*3,z:-Math.min(away,6)*65,yaw:clamp(-d*63,-76,76),scale:1-Math.min(away,4)*.065,rotation:clamp(sway*(1+Math.min(away,3)*.12),-9,9),visible:away<5.5,zIndex:100-Math.round(away*10)};}
function spring(state,target,dt){dt=clamp(Number(dt)||0,0,.032);const acceleration=(target-state.position)*150-state.velocity*22;const velocity=state.velocity+acceleration*dt,position=state.position+velocity*dt;return Math.abs(position-target)<.0007&&Math.abs(velocity)<.006?{position:target,velocity:0}:{position,velocity};}
function release(start,position,velocity,count){if(count<2)return 0;const direction=position-start;let next=Math.round(position+clamp(velocity,-3,3)*.12);if(Math.abs(direction)>.16&&Math.abs(direction)<.5)next=Math.round(start)+(direction>0?1:-1);return clamp(next,0,count-1);}
function filter(items,{query='',category='',brand=''}={}){const q=query.trim().toLocaleLowerCase();return items.filter(g=>(!category||g.category===category)&&(!brand||(g.brand||'').trim().toLocaleLowerCase()===brand)&&(!q||[g.name,g.brand,g.color,g.size].join(' ').toLocaleLowerCase().includes(q)));}
function nearby(count,position){const start=Math.max(0,Math.floor(position)-5),end=Math.min(count-1,Math.ceil(position)+5);return Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i);}
// Estimate a support line from the transparent silhouette, not the rectangular photo box.
function support(data,width,height,category='tops'){
 const aspect=width/height,fallback={aspect,left:.13,right:.87,y:.12,kind:category==='bottoms'?'clip':category==='bags'||category==='accessories'?'hook':'shoulder',measured:false};
 if(!data||!width||!height||data.length!==width*height*4)return fallback;
 const lines=[];let top=height,bottom=-1,left=width,right=-1,transparent=0;
 for(let y=0;y<height;y++){let l=width,r=-1,count=0;for(let x=0;x<width;x++){if(data[(y*width+x)*4+3]>40){l=Math.min(l,x);r=x;count++;}else transparent++;}lines.push({l,r,count});if(count>=2){top=Math.min(top,y);bottom=y;left=Math.min(left,l);right=Math.max(right,r);}}
 if(bottom<=top||transparent<width*height*.03)return fallback;
 const h=bottom-top+1,band=lines.slice(top+Math.floor(h*.01),top+Math.max(2,Math.floor(h*.09))).filter(r=>r.count>=2&&r.r>r.l);
 const sparse=band.length>0&&band.filter(r=>r.count/(r.r-r.l+1)<(category==='dresses'?.48:.26)).length>band.length*.55;
 const kind=fallback.kind==='hook'?'hook':category==='bottoms'?'clip':sparse?'straps':'shoulder';const fraction=kind==='straps'?.035:kind==='clip'?.025:kind==='hook'?.02:.13;
 const y=clamp(Math.round(top+h*fraction),top,bottom),samples=lines.slice(Math.max(top,y-2),Math.min(bottom+1,y+3)).filter(r=>r.count>=2&&r.r>r.l);
 if(!samples.length)return fallback;const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
 return {aspect,left:median(samples.map(r=>r.l))/width,right:(median(samples.map(r=>r.r))+1)/width,y:y/height,kind,measured:true};
}
function fitting(profile,boxWidth,boxHeight,category='tops'){
 const p=profile||{aspect:.7,left:.13,right:.87,y:.12,kind:'shoulder'},aspect=Number.isFinite(p.aspect)&&p.aspect>0?p.aspect:.7,kind=p.kind;
 const imageTop=kind==='hook'?18:29,available=Math.max(10,boxHeight-imageTop-8),w=Math.min(boxWidth,available*aspect),h=w/aspect;
 const center=(p.left+p.right)/2,image={x:boxWidth/2-center*w,y:imageTop,w,h};
 const span=(p.right-p.left)*w,scale=kind==='straps'?1.04:kind==='clip'?.9:.94;
 const hangerWidth=clamp(span*scale,12,boxWidth*.96),contact=imageTop+p.y*h;
 return {image,hanger:{x:(boxWidth-hangerWidth)/2,w:hangerWidth,drop:Math.max(7,contact-18),kind},measured:!!p.measured};
}

return {clamp,pose,spring,release,filter,nearby,support,fitting};
});
