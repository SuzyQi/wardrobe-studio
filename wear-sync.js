(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./wear-core.js'));else root.WardrobeWearSync=factory(root.WardrobeWear);})(typeof globalThis!=='undefined'?globalThis:this,function(W){
  'use strict';const SHA=/^[a-f0-9]{40}$/,FILE='wear-journal.json';
  function createClient({owner,repo,token,fetch:fetcher=globalThis.fetch,minWriteGap=1200}){
    if(!/^[a-zA-Z0-9-]{1,39}$/.test(owner)||!/^[a-zA-Z0-9_.-]{1,100}$/.test(repo)||['.','..'].includes(repo)||!String(token||'').trim())throw new Error('请先在衣橱的 GitHub 设置中连接并记住此设备。');
    let secret=String(token).trim(),branch='',nextWrite=0;const controllers=new Set(),prefix='https://api.github.com/repos/'+owner+'/'+repo;
    async function request(path,{method='GET',body}={}){if(!secret)throw new Error('GitHub 连接已断开。');if(method!=='GET'){const wait=Math.max(0,nextWrite-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));nextWrite=Date.now()+minWriteGap;}
      const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),30000);
      try{const response=await fetcher(prefix+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+secret,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
        if(!response.ok){const e=new Error([401,403].includes(response.status)?'GitHub 授权不可用，请返回衣橱检查同步设置。':[409,422].includes(response.status)?'云端刚有更新，请重试同步；本机记录已保留。':'日记同步未完成，请检查网络后重试。');e.status=response.status;throw e;}return await response.json();
      }finally{clearTimeout(timer);controllers.delete(controller);}}
    async function connect(){const info=await request('');if(!info.private)throw new Error('穿着日记只同步到私有仓库。');if(!info.default_branch||!/^[-\w./]+$/.test(info.default_branch))throw new Error('仓库分支无效。');branch=info.default_branch;}
    const path=()=>branch.split('/').map(encodeURIComponent).join('/');
    async function read(){if(!branch)await connect();const ref=await request('/git/ref/heads/'+path());if(!SHA.test(ref.object?.sha))throw new Error('云端提交无效。');const commit=await request('/git/commits/'+ref.object.sha);if(!SHA.test(commit.tree?.sha))throw new Error('云端目录无效。');const tree=await request('/git/trees/'+commit.tree.sha);if(tree.truncated)throw new Error('云端目录不完整，日记未更改。');const entry=tree.tree?.find(x=>x.path===FILE);let journal=W.empty();
      if(entry){if(entry.type!=='blob'||entry.mode!=='100644'||!SHA.test(entry.sha))throw new Error('云端日记文件无效。');const blob=await request('/git/blobs/'+entry.sha);if(blob.sha!==entry.sha||blob.encoding!=='base64'||blob.size>8*1024*1024||typeof blob.content!=='string'||blob.content.length>12*1024*1024)throw new Error('云端日记过大或格式无效。');try{journal=W.validate(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))));}catch{throw new Error('云端日记损坏或版本不受支持，本机记录已保留。');}}
      return {head:ref.object.sha,tree:commit.tree.sha,exists:!!entry,journal};}
    async function publish(journal,remote){const safe=W.validate(journal);if(remote.exists&&W.same(safe,remote.journal))return remote;const tree=await request('/git/trees',{method:'POST',body:{base_tree:remote.tree,tree:[{path:FILE,mode:'100644',type:'blob',content:JSON.stringify(safe)}]}});if(!SHA.test(tree.sha))throw new Error('云端目录创建失败。');const commit=await request('/git/commits',{method:'POST',body:{message:'Sync wear journal',tree:tree.sha,parents:[remote.head]}});if(!SHA.test(commit.sha))throw new Error('云端提交创建失败。');await request('/git/refs/heads/'+path(),{method:'PATCH',body:{sha:commit.sha,force:false}});return {journal:safe,head:commit.sha,tree:tree.sha,exists:true};}
    function disconnect(){secret='';for(const c of controllers)c.abort();controllers.clear();}
    return {origin:(owner+'/'+repo).toLowerCase(),connect,read,publish,disconnect};
  }
  async function synchronize({store,client,choices={},expectedConflicts=[]}){
    for(let attempt=0;attempt<3;attempt++){
      const local=await store.read();if(local.origin&&local.origin!==client.origin)throw new Error('当前授权的仓库与日记原仓库不同。请切回原仓库，记录已保留。');
      const remote=await client.read();if(local.base&&!remote.exists)throw new Error('云端 wear-journal.json 缺失，请先恢复云端文件；本机记录已保留。');
      const usable={};for(const c of expectedConflicts){const l=local.journal.records.find(r=>r.id===c.id)||null,r=remote.journal.records.find(r=>r.id===c.id)||null;if(JSON.stringify(l)===JSON.stringify(c.local)&&JSON.stringify(r)===JSON.stringify(c.remote))usable[c.id]=choices[c.id];}
      const merged=W.merge(local.base,local.journal,remote.journal,usable);if(merged.conflicts.length)return {conflicts:merged.conflicts};
      try{const published=await client.publish(merged.journal,remote);const result=await store.update(current=>{
        if(JSON.stringify(current)!==JSON.stringify(local)){const e=new Error('本机日记刚有更新，正在重新合并。');e.race=true;throw e;}
        return {...current,journal:published.journal,base:published.journal,origin:client.origin,lastSyncAt:new Date().toISOString()};});return {state:result,conflicts:[]};
      }catch(error){if((error.race||[409,422].includes(error.status))&&attempt<2)continue;throw error;}
    }
  }
  return {createClient,synchronize};
});
