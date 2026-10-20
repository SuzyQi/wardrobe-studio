(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WardrobeWear=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const APP='wardrobe-wear-journal', LIMIT=30000, ID=/^[a-zA-Z0-9_-]{1,100}$/;
  function today(now=new Date()){return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');}
  function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new Error('请选择有效日期。');return value;}
  function shift(value,days){const d=new Date(date(value)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
  function monthShift(value,offset){const d=new Date(date(value.slice(0,7)+'-01')+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,7);}
  function calendar(month){const first=date(month+'-01'),start=shift(first,-((new Date(first+'T12:00:00Z').getUTCDay()+6)%7));return Array.from({length:42},(_,i)=>shift(start,i));}
  function text(v,max){return typeof v==='string'?v.slice(0,max):'';}
  function key(kind,day,gid=''){date(day);if(kind==='wear'&&!ID.test(gid))throw new Error('单品编号无效。');return kind==='wear'?'wear:'+day+':'+gid:'note:'+day;}
  function validate(input){
    if(!input||input.app!==APP||input.version!==1||!Array.isArray(input.records)||input.records.length>LIMIT)throw new Error('穿着日记格式或数量无效，原记录未更改。');
    const seen=new Set();const records=input.records.map(r=>{
      if(!r||!['wear','note'].includes(r.kind))throw new Error('穿着记录类型无效。');
      const day=date(r.date),gid=r.kind==='wear'?r.garmentId:'';
      if(r.id!==key(r.kind,day,gid)||seen.has(r.id)||typeof r.deleted!=='boolean'||typeof r.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(r.updatedAt)||!Number.isFinite(Date.parse(r.updatedAt)))throw new Error('穿着记录编号或时间无效。');
      seen.add(r.id);const out={id:r.id,kind:r.kind,date:day,deleted:r.deleted,updatedAt:new Date(r.updatedAt).toISOString()};
      if(r.kind==='wear'){out.garmentId=gid;out.name=text(r.name,100)||'未命名单品';out.brand=text(r.brand,100);}else out.note=text(r.note,1500);
      return out;
    });return {app:APP,version:1,records:records.sort((a,b)=>a.id.localeCompare(b.id))};
  }
  function empty(){return {app:APP,version:1,records:[]};}
  function payload(r){return r?JSON.stringify([r.kind,r.date,r.garmentId||'',r.deleted,r.kind==='note'?r.note:'']):'';}
  function same(a,b){const ordered=m=>(m?.records||[]).map(r=>[r.id,payload(r)]).sort((x,y)=>x[0].localeCompare(y[0]));return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));}
  function merge(base,local,remote,choices={}){
    const values=[base||empty(),local,remote].map(m=>new Map(validate(m).records.map(r=>[r.id,r]))),records=[],conflicts=[];
    for(const id of [...new Set(values.flatMap(m=>[...m.keys()]))].sort()){
      const [b,l,r]=values.map(m=>m.get(id));let win;
      if(payload(l)===payload(r))win=!l?r:!r?l:l.updatedAt>=r.updatedAt?l:r;
      else if(payload(l)===payload(b))win=r;else if(payload(r)===payload(b))win=l;
      else if(choices[id]==='local')win=l;else if(choices[id]==='remote')win=r;
      else {conflicts.push({id,date:(l||r||b).date,local:l||null,remote:r||null});continue;}
      if(win)records.push(win);
    }return {journal:{app:APP,version:1,records},conflicts};
  }
  function active(journal,gid,period=''){return journal.records.filter(r=>r.kind==='wear'&&!r.deleted&&(!gid||r.garmentId===gid)&&(!period||r.date.startsWith(period))).sort((a,b)=>b.date.localeCompare(a.date)||a.garmentId.localeCompare(b.garmentId));}
  function stats(journal,gid,period=''){const rows=active(journal,gid,period);return {days:new Set(rows.map(r=>r.date)).size,garments:new Set(rows.map(r=>r.garmentId)).size,first:rows.at(-1)?.date||'',last:rows[0]?.date||''};}
  function patch(journal,changes,{now=new Date().toISOString(),cutoff=today()}={}){
    const records=new Map(validate(journal).records.map(r=>[r.id,r]));
    for(const c of changes){const day=date(c.date);if(day>cutoff)throw new Error('穿着记录只能选择今天或过去的日期。');
      const kind=c.kind||'wear',id=key(kind,day,c.garmentId),old=records.get(id);
      const r={id,kind,date:day,deleted:!!c.deleted,updatedAt:now};
      if(kind==='wear'){r.garmentId=c.garmentId;r.name=(r.deleted&&old?old.name:c.name)||old?.name||'未命名单品';r.brand=(r.deleted&&old?old.brand:c.brand)||old?.brand||'';}else r.note=text(c.note,1500);
      if(payload(r)!==payload(old)&&!(r.deleted&&!old))records.set(id,r);
    }return validate({app:APP,version:1,records:[...records.values()]});
  }
  function importMissing(current,incoming){const map=new Map(validate(current).records.map(r=>[r.id,r]));for(const r of validate(incoming).records)if(!map.has(r.id))map.set(r.id,r);return validate({app:APP,version:1,records:[...map.values()]});}
  return {APP,today,date,shift,monthShift,calendar,key,validate,empty,same,merge,active,stats,patch,importMissing};
});
