(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WardrobeRack=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function pose(index,position,width=1000,sway=0){const d=index-position,away=Math.abs(d),side=width<600?64:91,spread=width<600?99:151;return {x:d*side+clamp(d,-1,1)*spread,y:Math.min(away,4)*3,z:-Math.min(away,6)*65,yaw:clamp(-d*63,-76,76),scale:1-Math.min(away,4)*.065,rotation:clamp(sway*(1+Math.min(away,3)*.12),-9,9),visible:away<5.5,zIndex:100-Math.round(away*10)};}
function spring(state,target,dt){dt=clamp(Number(dt)||0,0,.032);const acceleration=(target-state.position)*150-state.velocity*22;const velocity=state.velocity+acceleration*dt,position=state.position+velocity*dt;return Math.abs(position-target)<.0007&&Math.abs(velocity)<.006?{position:target,velocity:0}:{position,velocity};}
function release(start,position,velocity,count){if(count<2)return 0;const direction=position-start;let next=Math.round(position+clamp(velocity,-3,3)*.12);if(Math.abs(direction)>.16&&Math.abs(direction)<.5)next=Math.round(start)+(direction>0?1:-1);return clamp(next,0,count-1);}
function filter(items,{query='',category='',brand=''}={}){const q=query.trim().toLocaleLowerCase();return items.filter(g=>(!category||g.category===category)&&(!brand||(g.brand||'').trim().toLocaleLowerCase()===brand)&&(!q||[g.name,g.brand,g.color,g.size].join(' ').toLocaleLowerCase().includes(q)));}
function nearby(count,position){const start=Math.max(0,Math.floor(position)-5),end=Math.min(count-1,Math.ceil(position)+5);return Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i);}
return {clamp,pose,spring,release,filter,nearby};
});
