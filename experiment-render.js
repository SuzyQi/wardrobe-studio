(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CollageRenderer=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const edges=new WeakMap();
function contour(image,ctx){if(edges.has(image))return edges.get(image);const d=ctx.canvas?.ownerDocument;if(!d)return null;const c=d.createElement('canvas');const a=(image.naturalWidth||image.width)/(image.naturalHeight||image.height);c.width=Math.round(400*Math.min(1,a));c.height=Math.round(c.width/a);const x=c.getContext('2d');x.drawImage(image,0,0,c.width,c.height);x.globalCompositeOperation='source-in';x.fillStyle='#fffffa';x.fillRect(0,0,c.width,c.height);edges.set(image,c);return c;}
function draw(ctx,model,images,{selected=null,exporting=false}={}){
 const colors={blue:'#bfcdd5',rose:'#d8c2bf',sage:'#c6cec1'},color=colors[model.paper]||colors.blue;
 ctx.save();ctx.fillStyle='#fafaf6';ctx.fillRect(0,0,1000,1250);
 // Deliberately sparse, overlapping sheets; clothes retain their original colours.
 for(const [x,y,w,h,r,a,c]of [[125,155,485,800,-2,.25,color],[610,330,240,395,3,.38,'#e3e2dc'],[570,770,290,245,-5,.22,color]]){ctx.save();ctx.translate(x,y);ctx.rotate(r*Math.PI/180);ctx.globalAlpha=a;ctx.fillStyle=c;ctx.fillRect(0,0,w,h);ctx.restore();}
 ctx.fillStyle='#293c4d';ctx.font='13px monospace';ctx.fillText('WARDROBE / COLLAGE STUDY',65,72);ctx.fillStyle='#8b8d86';ctx.font='11px monospace';ctx.fillText('CUT, LAYER & PLAY',65,96);
 for(const l of model.layers){ctx.save();ctx.translate(l.x,l.y);ctx.rotate(l.rotation*Math.PI/180);ctx.globalAlpha=l.opacity;const image=images.get(l.id);
 if(image){ctx.save();ctx.scale(l.flip?-1:1,1);ctx.shadowColor='#17212420';ctx.shadowBlur=10;ctx.shadowOffsetY=5;
 // A small ivory contour follows transparency, rather than framing every item in a card.
 const edge=contour(image,ctx);if(edge){for(const [dx,dy]of [[-4,0],[4,0],[0,-4],[0,4],[-3,-3],[3,3],[-3,3],[3,-3]])ctx.drawImage(edge,-l.w/2+dx,-l.h/2+dy,l.w,l.h);ctx.shadowColor='transparent';}ctx.drawImage(image,-l.w/2,-l.h/2,l.w,l.h);ctx.shadowColor='transparent';ctx.restore();}
 else if(!exporting){ctx.fillStyle='#e4e5df';ctx.fillRect(-l.w/2,-l.h/2,l.w,l.h);ctx.fillStyle='#68716d';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('图片待载入',0,0);}
 if(selected===l.id&&!exporting){ctx.globalAlpha=1;ctx.strokeStyle='#385b77';ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.strokeRect(-l.w/2-8,-l.h/2-8,l.w+16,l.h+16);ctx.setLineDash([]);}ctx.restore();}
 // Navy paper clip, away from the centre of the clothes.
 if(model.layers.length){ctx.save();ctx.translate(826,160);ctx.rotate(.12);ctx.strokeStyle='#304657';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,25);ctx.lineTo(0,-15);ctx.bezierCurveTo(0,-37,28,-37,28,-15);ctx.lineTo(28,62);ctx.bezierCurveTo(28,83,-9,83,-9,62);ctx.lineTo(-9,-13);ctx.stroke();ctx.restore();}
 ctx.fillStyle='#253846';ctx.font='24px serif';ctx.fillText((model.title||'无题实验').slice(0,28),65,1180);ctx.fillStyle='#7b8079';ctx.font='11px monospace';ctx.fillText('PRIVATE COLLECTION / '+String(model.layers.filter(l=>l.kind==='garment').length).padStart(2,'0')+' PIECES',65,1210);
 if(!model.layers.length&&!exporting){ctx.fillStyle='#737d79';ctx.font='25px serif';ctx.textAlign='center';ctx.fillText('从一件衣服开始，或随机来一套',500,600);ctx.font='15px sans-serif';ctx.fillText('人物与参考图也可以成为一张剪纸',500,640);ctx.textAlign='start';}ctx.restore();
}
return {draw};
});
