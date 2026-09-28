/* Minimal Firestore-style client over the /api REST endpoints (Cloudflare D1).
   Mirrors the subset of the artifact `db` API that app.js uses. Live updates are polled. */
function createDb(){
  const POLL_MS=15000, listeners=new Set();
  async function req(method,path,body){
    const r=await fetch("/api/"+path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    if(!r.ok){const e=new Error((await r.text())||r.statusText);e.code=r.status;throw e;}
    return r.status===204?null:r.json();
  }
  const refreshAll=()=>listeners.forEach(l=>l());
  function listen(fetchFn,cb,errCb){
    const run=()=>fetchFn().then(cb,e=>errCb&&errCb(e));
    listeners.add(run);run();
    const t=setInterval(run,POLL_MS);
    return ()=>{clearInterval(t);listeners.delete(run);};
  }
  const snapDoc=d=>({id:d.id,exists:true,data:()=>d.data});
  async function write(p){const out=await p;refreshAll();return out;}
  function docRef(col,id){
    const path=encodeURIComponent(col)+"/"+encodeURIComponent(id);
    return {
      id,
      update:data=>write(req("PATCH",path,data)),
      set:data=>write(req("PUT",path,data)),
      delete:()=>write(req("DELETE",path)),
      onSnapshot:(cb,errCb)=>listen(()=>req("GET",path).then(d=>d?snapDoc(d):{id,exists:false,data:()=>undefined}).catch(e=>{if(e.code===404)return {id,exists:false,data:()=>undefined};throw e;}),cb,errCb)
    };
  }
  function query(col,opts={}){
    const qs=()=>{const p=new URLSearchParams();if(opts.orderBy)p.set("orderBy",opts.orderBy);if(opts.dir)p.set("dir",opts.dir);if(opts.limit)p.set("limit",opts.limit);const s=p.toString();return encodeURIComponent(col)+(s?"?"+s:"");};
    return {
      orderBy:(f,dir="asc")=>query(col,{...opts,orderBy:f,dir}),
      limit:n=>query(col,{...opts,limit:n}),
      onSnapshot:(cb,errCb)=>listen(()=>req("GET",qs()).then(rows=>({docs:rows.map(snapDoc)})),cb,errCb)
    };
  }
  return {
    collection:col=>({...query(col),add:data=>write(req("POST",encodeURIComponent(col),data)).then(r=>docRef(col,r.id)),doc:id=>docRef(col,id)}),
    doc:path=>{const [col,id]=path.split("/");return docRef(col,id);}
  };
}
