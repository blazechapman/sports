/* Cloudflare version of the page's data layer: a minimal Firestore-style client over the
   /api REST endpoints (D1), mirroring the subset of the artifact `db` API that app.js uses,
   plus `api` for the server actions. Live updates are polled.
   apps-script/DbClient.html provides the same interface for the Apps Script version. */
async function postJson(path,body){
  const r=await fetch("/api/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});
  const res=await r.json().catch(()=>({error:String(r.status)}));
  if(!r.ok||res.error)throw Object.assign(new Error(res.error||r.statusText),{code:res.error,at:res.at});
  return res;
}
const api={suggest:body=>postJson("suggest",body),scan:()=>postJson("scan")};
function createDb(){
  const POLL_MS=15000, listeners=new Set();
  async function req(method,path,body){
    const r=await fetch("/api/"+path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    if(!r.ok){const e=new Error((await r.text())||r.statusText);e.code=r.status;throw e;}
    return r.status===204?null:r.json();
  }
  const refreshAll=()=>listeners.forEach(l=>l());
  function listen(fetchFn,cb,errCb){
    let last=null;
    const run=()=>fetchFn().then(snap=>{const key=JSON.stringify(snap.docs?snap.docs.map(d=>[d.id,d.data()]):[snap.exists,snap.data()]);if(key!==last){last=key;cb(snap);}},e=>errCb&&errCb(e));
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
