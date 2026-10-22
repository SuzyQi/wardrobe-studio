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
 return {aspect,left:median(samples.map(r=>r.l))/width,right:(median(samples.map(r=>r.r))+1)/width,y:y/height,neckY:(top+h*.035)/height,topY:top/height,bodyHeight:h/height,collarWidth:clamp((median(band.map(r=>r.r-r.l+1))||(right-left+1))/width,.08,.34),neck:kind==='shoulder'?neckline(data,width,height,{left,right,top,bottom}):null,kind,measured:true};
}
// Locate a transparent neck indentation from the upper contour. Opaque back-neck
// fabric is deliberately left uncertain; it must not produce a chest overlay.
function neckline(data,width,height,bounds){
 const {left,right,top,bottom}=bounds,w=right-left+1,h=bottom-top+1,c=(left+right)/2;
 const first=x=>{for(let y=top;y<=Math.min(bottom,top+h*.30);y++)if(data[(y*width+x)*4+3]>40)return y;return null;};
 const x1=Math.round(c-w*.19),x2=Math.round(c+w*.19),cy=first(Math.round(c)),ly=first(x1),ry=first(x2);
 if(cy===null||ly===null||ry===null)return null;
 const rim=Math.max(ly,ry),depth=cy-rim;
 if(depth<h*.018||depth>h*.26||Math.abs(ly-ry)>h*.05)return null;
 const contour=[];for(let x=x1;x<=x2;x+=Math.max(1,Math.round(w*.025))){const y=first(x);if(y===null)return null;contour.push([x/width,y/height]);}
 contour.push([x2/width,ry/height]);
 return {shape:'contour',x:c/width,y:rim/height,width:(x2-x1)/width,depth:depth/height,points:[[x1/width,rim/height],[x2/width,rim/height],...contour.reverse()],confidence:'outline'};
}
// An uncertain neckline still gets a small visible collar support, anchored to
// the actual top of the cutout, never the former fixed chest-level window.
function defaultNeck(p){if(p.kind!=='shoulder')return null;const body=p.bodyHeight||.9;return {shape:'round',x:(p.left+p.right)/2,y:Math.max(0,(Number.isFinite(p.topY)?p.topY:Math.max(0,(p.neckY||.04)-.035))-.006*body),width:clamp(p.collarWidth||.22,.08,.30),depth:.055*body,confidence:'fallback'};}
function calibration(value){if(!value||!['round','v','closed'].includes(value.shape))return null;const out={shape:value.shape};for(const [k,a,b]of [['x',.1,.9],['y',0,.55],['width',.02,.65],['depth',.005,.35]]){if(!Number.isFinite(Number(value[k])))return null;out[k]=clamp(Number(value[k]),a,b);}out.width=Math.min(out.width,2*Math.min(out.x,1-out.x));out.depth=Math.min(out.depth,1-out.y);return out;}
function neckPoints(n){if(!n||n.shape==='closed')return [];if(n.shape==='contour')return n.points;const {x,y,width:w,depth:h}=n,l=x-w/2,r=x+w/2;return n.shape==='v'?[[l,y],[r,y],[x,y+h]]:[[l,y],[r,y],[r-w*.08,y+h*.6],[x+w*.25,y+h*.92],[x,y+h],[x-w*.25,y+h*.92],[l+w*.08,y+h*.6]];}

function fitting(profile,boxWidth,boxHeight,category='tops'){
 const p=profile||{aspect:.7,left:.13,right:.87,y:.12,kind:'shoulder'},aspect=Number.isFinite(p.aspect)&&p.aspect>0?p.aspect:.7,kind=p.kind;
 const imageTop=kind==='hook'?18:29,available=Math.max(10,boxHeight-imageTop-8),w=Math.min(boxWidth,available*aspect),h=w/aspect;
 const center=(p.left+p.right)/2,image={x:boxWidth/2-center*w,y:imageTop,w,h};
 const span=(p.right-p.left)*w,scale=kind==='straps'?1.04:kind==='clip'?.9:kind==='shoulder'?.86:.94;
 const hangerWidth=clamp(span*scale,12,boxWidth*.96),contact=imageTop+p.y*h;
 // Shoulder arms sit behind the collar, with their ends buried inside the fabric.
 const neck=kind==='shoulder'?imageTop+(Number.isFinite(p.neckY)?p.neckY:p.y*.25)*h+3:18;
 const woodTop=kind==='shoulder'?neck-3:15,drop=kind==='shoulder'?Math.max(7,contact+5-neck):Math.max(7,contact-18);
 const hangerCenter=Number.isFinite(p.hangerX)?image.x+p.hangerX*w:boxWidth/2;
 return {image,hanger:{x:hangerCenter-hangerWidth/2,w:hangerWidth,woodTop,hookHeight:kind==='shoulder'?neck+6:kind==='hook'?32:25,drop,kind},measured:!!p.measured};
}


function rabbitFitting(geo,closed=false){
 const image={...geo.image},hanger={...geo.hanger};
 if(['shoulder','straps'].includes(hanger.kind)){
  const height=hanger.w*506/1881;
  if(hanger.kind==='straps'){hanger.woodTop+=hanger.drop-height+2;}
  else{hanger.woodTop-=closed?0:hanger.w*110/1881;}
  hanger.drop=height;
  // One shared attachment point for the gold stem and the exposed neck layer.
  hanger.joinY=hanger.woodTop+hanger.w*110/1881;
  hanger.hookHeight=hanger.joinY+9;
 }
 return {...geo,image,hanger};
}

return {clamp,pose,spring,release,filter,nearby,support,fitting,neckline,calibration,neckPoints,defaultNeck,rabbitFitting};
});
