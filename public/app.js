const USE_CASES=[
 ["blowout","Blowout","Won by a big margin"],
 ["upset","Upset","Underdog or unranked team wins"],
 ["collapse","Collapse","Blown lead, choke, late meltdown on the field"],
 ["rivalry","Rivalry","Rival or trophy game result"],
 ["clutch","Clutch finish","Walk-off, buzzer-beater, game-winner"],
 ["bad_call","Bad call","Refs, replay, controversial call"],
 ["coaching","Coaching","Head-scratching decision, hot seat, firing"],
 ["meltdown","Fanbase meltdown","A fanbase losing it online"],
 ["streak","Streak","Streak extended or snapped"],
 ["rankings","Rankings","Polls, snubs, playoff picture"],
 ["transaction","Transaction","Trade, signing, draft, portal"],
 ["fantasy","Fantasy pain","Lineup regret, waiver misery"],
 ["hype","Hype","Before a big game, bold predictions"],
 ["milestone","Milestone","Record or career milestone"],
 ["revenge","Revenge game","Facing a former team"],
 ["cat_watch","Cat Watch","A cat team wins by a decent margin"]];
const UC=Object.fromEntries(USE_CASES.map(u=>[u[0],u[1]]));
const MARGIN={NFL:14,CFB:14,NBA:15,MLB:5,NHL:3};
const LEAGUE_TAGS={NFL:["#nflmemes","#nfl"],CFB:["#cfbmemes","#collegefootball"],MLB:["#mlbmemes","#baseballmemes"],NBA:["#nbamemes","#nba"],NHL:["#nhlmemes","#hockeymemes"]};
const CAT_NAMES=["tiger","lion","panther","jaguar","bengal","wildcat","cougar","bobcat","bearcat","lynx","puma","leopard","cheetah","catamount","sabercat",
 "jags","lsu","clemson","auburn","missouri","mizzou","memphis tigers","kentucky","arizona wildcats","kansas state","k-state","northwestern","penn state","pitt","houston cougars","byu","washington state","wsu","cincinnati bearcats","villanova","texas state","ohio bobcats","montana state","towson","grambling","jackson state","tennessee state","uab","northern iowa","prairie view"];
let db=null, templates=[], moments=[], picked=null, editingId=null;

const $=id=>document.getElementById(id);
function toast(t){const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2200);}
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function ymd(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function fmtTime(d){let h=d.getHours(),m=d.getMinutes();const ap=h>=12?"PM":"AM";h=h%12||12;return h+":"+String(m).padStart(2,"0")+" "+ap;}
function daysSince(iso){if(!iso)return null;return Math.floor((Date.now()-new Date(iso).getTime())/864e5);}

/* chips */
function renderChips(host,prefix,selected=[],auto=[]){
  host.innerHTML=USE_CASES.map(([id,name,desc])=>`<label class="chk${auto.includes(id)?" auto":""}" title="${esc(desc)}"><input type="checkbox" id="${prefix}-${id}" value="${id}"${selected.includes(id)?" checked":""}> ${esc(name)}</label>`).join("");
}
function readChips(prefix){return USE_CASES.map(u=>u[0]).filter(id=>$(prefix+"-"+id)?.checked);}

/* tabs */
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
function showTab(t){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  ["today","match","lib","add","guide"].forEach(p=>$("pane-"+p).hidden=p!==t);
  try{localStorage.setItem("memelab.tab",t)}catch(e){}
}

/* moment analysis */
let manual={}; // use-case id -> bool when the user overrides
function isCat(name){const n=" "+(name||"").toLowerCase().replace(/[^a-z\- ]/g," ")+" ";return n.trim()!==""&&CAT_NAMES.some(c=>new RegExp("\\b"+c.replace("-","\\-")+"s?\\b").test(n));}
function autoUseCases(){
  const lg=$("m-league").value, ws=+$("m-ws").value, ls=+$("m-ls").value, hasScore=$("m-ws").value!==""&&$("m-ls").value!=="";
  const desc=($("m-desc").value||"").toLowerCase(), auto=[];
  const margin=hasScore?ws-ls:null;
  if((hasScore&&margin>=MARGIN[lg])||/blew out|blowout|destroy|demolish|dismantl|rout|embarrass|beat down|clobber|pummel/.test(desc))auto.push("blowout");
  if(/upset|stun|shock/.test(desc))auto.push("upset");
  if(/collaps|choke|blew a|blown lead|meltdown in the/.test(desc))auto.push("collapse");
  if(/rival|trophy|iron bowl|egg bowl|red river|the game/.test(desc))auto.push("rivalry");
  if(/walk-?off|buzzer|game-?winner|last-?second|overtime|ot winner/.test(desc))auto.push("clutch");
  if(/ref|call|flag|replay|review|officiat/.test(desc))auto.push("bad_call");
  if(/coach|fired|hot seat|punt|went for it|timeout/.test(desc))auto.push("coaching");
  if(/fans|fanbase|meltdown|twitter|reddit/.test(desc))auto.push("meltdown");
  if(/streak|straight|in a row|snapped/.test(desc))auto.push("streak");
  if(/rank|poll|snub|playoff/.test(desc))auto.push("rankings");
  if(/trade|sign|draft|portal|waive|release/.test(desc))auto.push("transaction");
  if(/fantasy|waiver|lineup/.test(desc))auto.push("fantasy");
  if(/record|milestone|career|all-?time/.test(desc))auto.push("milestone");
  if(/revenge|former team|return to/.test(desc))auto.push("revenge");
  if($("m-when").value==="future")auto.push("hype");
  const catWin=isCat($("m-winner").value)&&(auto.includes("blowout"));
  if(catWin)auto.push("cat_watch");
  return {auto:[...new Set(auto)],margin,hasScore};
}
function currentUseCases(auto){return USE_CASES.map(u=>u[0]).filter(id=>id in manual?manual[id]:auto.includes(id));}

function postPlan(){
  const w=$("m-when").value, lg=$("m-league").value, now=new Date(), d=new Date(now);
  let urgency="Post today", date, time, note="";
  if(w==="now"){d.setMinutes(d.getMinutes()+45);d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);date=ymd(d);time=fmtTime(d);note="Fast reaction: post within about an hour.";}
  else if(w==="night"){if(now.getHours()<18){d.setHours(19,0,0,0);}else{d.setMinutes(d.getMinutes()+30);d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);}date=ymd(d);time=fmtTime(d);note="Still fresh today. Evening slot.";}
  else if(w==="week"){urgency="Batch";d.setDate(d.getDate()+1);d.setHours(19,0,0,0);date=ymd(d);time=fmtTime(d);note="Past the reaction window. Works as a batch post or a Meme of the Week slide.";}
  else{urgency="Planned";date="TBD";time="TBD";note="Upcoming. Plan it in the Content Radar and prep both outcomes.";}
  const day=now.getDay();
  const motw=(lg==="NFL"||lg==="CFB")&&(w==="night"||w==="now"||w==="week")&&[0,1,6].includes(day);
  return {urgency,date,time,note,motw};
}

function scoreTemplate(t,ucs,lg){
  if(t.status==="retired")return null;
  const overlap=(t.useCases||[]).filter(u=>ucs.includes(u));
  let s=overlap.length*3;
  const why=[];
  if(overlap.length)why.push("Fits: "+overlap.map(u=>UC[u]).join(", "));
  if(t.freshness==="fresh"){s+=1;why.push("Fresh format");}
  if(t.format==="Reel"||t.format==="Both")s+=.5;
  const ds=daysSince(t.lastUsed);
  if(ds!==null&&ds<7){s-=2;why.push(`Used ${ds===0?"today":ds+" day"+(ds>1?"s":"")+" ago"}`);}
  else if(ds!==null)why.push(`Last used ${ds} days ago`);else why.push("Never used");
  return {t,s,overlap,why};
}

function pillarFor(t,ucs){
  if(ucs.includes("meltdown")||ucs.includes("fantasy"))return "Fanbase Moment";
  return t&&t.freshness==="fresh"?"Fresh Format":"Classic Remix";
}
function hashtags(lg,winner,loser){
  const team=s=>"#"+(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const tags=["#sportsmemes",...LEAGUE_TAGS[lg]];
  if(winner)tags.push(team(winner)+(lg==="CFB"?"football":""));
  if(loser)tags.push(team(loser)+(lg==="CFB"?"football":""));
  return tags.slice(0,5).join(" ");
}

function analyze(){
  const {auto,margin,hasScore}=autoUseCases();
  renderChips($("m-uc"),"muc",currentUseCases(auto),auto);
  $("m-uc").querySelectorAll("input").forEach(i=>i.addEventListener("change",()=>{manual[i.value]=i.checked;analyze();}));
  const ucs=currentUseCases(auto), lg=$("m-league").value, off=$("m-offlimits").checked;
  const winner=$("m-winner").value.trim(), loser=$("m-loser").value.trim();
  const plan=postPlan();
  const lgWeight={NFL:3,CFB:3,MLB:2,NBA:2,NHL:1}[lg];
  const pot=ucs.length+lgWeight+(ucs.includes("upset")||ucs.includes("rivalry")?1:0);
  const level=pot>=6?"High":pot>=4?"Medium":"Low";
  const v=$("verdict");
  if(off){
    v.innerHTML=`<div class="verdict block"><div class="big">Off-limits · report only</div><div>This moment fails the brand filter. Skip the meme. Punch at moments, not people.</div></div>`;
  }else{
    const scoreLine=hasScore?`${esc(winner)} ${$("m-ws").value}–${$("m-ls").value} ${esc(loser)} · margin ${margin}${margin>=MARGIN[lg]?" (blowout for "+lg+")":" (under the "+MARGIN[lg]+"-pt blowout line)"}`:"Add the score to check the blowout margin";
    v.innerHTML=`<div class="verdict"><div class="big">Meme potential: ${level}</div>
      <div class="chips">${ucs.map(u=>`<span class="pill uc">${esc(UC[u])}</span>`).join("")||'<span class="pill warn">No use case yet: tick one</span>'}${ucs.includes("cat_watch")?' <span class="pill fresh">Cat Watch</span>':""}</div>
      <dl class="kv"><dt>Result</dt><dd>${scoreLine}</dd>
      <dt>Urgency</dt><dd>${plan.urgency}</dd>
      <dt>Post</dt><dd>${plan.date==="TBD"?"TBD":plan.date+" · "+plan.time+" ET"}</dd>
      <dt>Why</dt><dd>${esc(plan.note)}${plan.motw?" Also a Meme of the Week candidate (Mon 7:00 PM).":""}</dd>
      <dt>Format</dt><dd>Reel first (launch mix ~4:1)</dd></dl></div>`;
  }
  // ranking
  const ranked=off?[]:templates.map(t=>scoreTemplate(t,ucs,lg)).filter(Boolean).filter(r=>r.overlap.length>0).sort((a,b)=>b.s-a.s).slice(0,6);
  if(picked&&!ranked.some(r=>r.t.id===picked))picked=null;
  if(!picked&&ranked[0])picked=ranked[0].t.id;
  const rl=$("rankList");
  if(off)rl.innerHTML=`<li class="empty" style="display:block">No templates for off-limits moments.</li>`;
  else if(!templates.length)rl.innerHTML=`<li class="empty" style="display:block">Your library is empty. Add templates in the Add template tab.</li>`;
  else if(!ranked.length)rl.innerHTML=`<li class="empty" style="display:block">No template is tagged for these use cases yet. Tag some in the library, or add a new one.</li>`;
  else rl.innerHTML=ranked.map((r,i)=>`<li class="${r.t.id===picked?"picked":""}"><span class="num">${i+1}</span>
      <div><div class="tname">${esc(r.t.name)} ${r.t.freshness==="fresh"?'<span class="pill fresh">Fresh</span>':'<span class="pill">Classic</span>'} <span class="pill">${esc(r.t.format||"Both")}</span></div>
      <div class="why">${esc(r.why.join(" · "))}</div>${r.t.how?`<div class="why">${esc(r.t.how)}</div>`:""}</div>
      <button class="btn small" type="button" data-pick="${esc(r.t.id)}">${r.t.id===picked?"Picked":"Pick"}</button></li>`).join("");
  rl.querySelectorAll("[data-pick]").forEach(b=>b.addEventListener("click",()=>{picked=b.dataset.pick;analyze();}));
  // row
  const t=templates.find(x=>x.id===picked);
  const storyline=(ucs.includes("cat_watch")?"Cat Watch: ":"")+($("m-desc").value.trim()||`${winner} over ${loser}`)+($("m-ws").value!==""?` (${$("m-ws").value}-${$("m-ls").value})`:"");
  const caption=`${winner}${$("m-ws").value!==""?" "+$("m-ws").value+"-"+$("m-ls").value:""} over ${loser}. `;
  const fmt=t&&t.format==="Carousel"?"Carousel":"Reel";
  const cols=[ymd(new Date()),"",plan.date,plan.time,plan.urgency,lg,storyline,t?t.name:"(pick a template)",pillarFor(t,ucs),fmt,$("m-concept").value.trim()||"(write your concept)",caption.trim()+" [finish the joke]",hashtags(lg,winner,loser),ucs.map(u=>UC[u]).join(", ")];
  $("tsvOut").textContent=off?"Off-limits: nothing to queue.":cols.map(c=>String(c).replace(/[\t\n]/g," ")).join("\t");
  $("copyRow").disabled=off; $("markUsed").disabled=off||!t||!db; $("saveMoment").disabled=off||!db;
}
["m-league","m-when","m-winner","m-ws","m-loser","m-ls","m-desc","m-offlimits","m-concept"].forEach(id=>$(id).addEventListener("input",()=>{if(["m-desc","m-ws","m-ls","m-winner","m-league","m-when"].includes(id))manual={};analyze();}));
$("momentForm").addEventListener("submit",e=>e.preventDefault());

async function copyText(txt,el){
  try{await navigator.clipboard.writeText(txt);toast("Copied");}
  catch(e){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Selected. Press Ctrl/Cmd+C to copy");}
}
$("copyRow").addEventListener("click",()=>copyText($("tsvOut").textContent,$("tsvOut")));
$("markUsed").addEventListener("click",async()=>{
  const t=templates.find(x=>x.id===picked);if(!t||!db)return;
  try{await db.collection("templates").doc(t.id).update({lastUsed:new Date().toISOString(),timesUsed:(t.timesUsed||0)+1});toast("Marked used: "+t.name);}
  catch(e){toast("Couldn't save: "+(e.message||e.code));}
});
$("saveMoment").addEventListener("click",async()=>{
  if(!db)return;const {auto}=autoUseCases();const ucs=currentUseCases(auto);const plan=postPlan();
  const data={createdAt:new Date().toISOString(),league:$("m-league").value,winner:$("m-winner").value.trim(),loser:$("m-loser").value.trim(),
    winnerScore:$("m-ws").value===""?null:+$("m-ws").value,loserScore:$("m-ls").value===""?null:+$("m-ls").value,
    description:$("m-desc").value.trim(),useCases:ucs,templateId:picked||null,concept:$("m-concept").value.trim(),postDate:plan.date,postTime:plan.time,urgency:plan.urgency};
  try{await db.collection("moments").add(data);toast("Saved to idea bank");}catch(e){toast("Couldn't save: "+(e.message||e.code));}
});
function renderMoments(){
  const host=$("momentList");
  if(!db){host.innerHTML=`<div class="empty">The idea bank needs the saved library, which isn't available in this view.</div>`;return;}
  if(!moments.some(m=>m.source!=="auto")){host.innerHTML=`<div class="empty">No saved moments yet. Use Save to idea bank above.</div>`;return;}
  host.innerHTML=moments.filter(m=>m.source!=="auto").slice(0,12).map(m=>{const t=templates.find(x=>x.id===m.templateId);return `<div class="card"><div class="head"><span class="tname">${esc(m.description||m.winner+" over "+m.loser)}</span><span class="meta">${esc(m.league)} · ${esc(m.postDate)} ${esc(m.postTime||"")}</span></div>
    <div class="chips">${(m.useCases||[]).map(u=>`<span class="pill uc">${esc(UC[u]||u)}</span>`).join("")}${t?` <span class="pill">${esc(t.name)}</span>`:""}</div>
    ${m.concept?`<div class="why">${esc(m.concept)}</div>`:""}
    <div class="actions"><button class="btn small" type="button" data-load="${esc(m.id)}">Load</button><button class="btn small" type="button" data-delm="${esc(m.id)}">Delete</button></div></div>`}).join("");
  host.querySelectorAll("[data-load]").forEach(b=>b.addEventListener("click",()=>loadMoment(b.dataset.load)));
  host.querySelectorAll("[data-delm]").forEach(b=>b.addEventListener("click",async()=>{if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Tap again to delete";return;}
    try{await db.collection("moments").doc(b.dataset.delm).delete();toast("Deleted");}catch(e){toast("Couldn't delete: "+(e.message||e.code));}}));
}
function loadMoment(id){const m=moments.find(x=>x.id===id);if(!m)return;
    $("m-league").value=m.league;$("m-winner").value=m.winner||"";$("m-loser").value=m.loser||"";$("m-ws").value=m.winnerScore??"";$("m-ls").value=m.loserScore??"";$("m-desc").value=m.description||"";$("m-concept").value=m.concept||"";
    manual={};const {auto}=autoUseCases();USE_CASES.forEach(([id])=>{const want=(m.useCases||[]).includes(id);if(want!==auto.includes(id))manual[id]=want;});picked=m.templateId||null;$("m-when").value=m.urgency==="Batch"?"week":m.urgency==="Planned"?"future":"night";$("m-offlimits").checked=!!m.offLimits;analyze();window.scrollTo({top:0});}

/* today inbox */
function rowFor(m,t){
  const ucs=m.useCases||[], lg=m.league;
  const sc=m.winnerScore!=null&&m.loserScore!=null?` (${m.winnerScore}-${m.loserScore})`:"";
  const storyline=(ucs.includes("cat_watch")?"Cat Watch: ":"")+(m.description||`${m.winner} over ${m.loser}`)+sc;
  const caption=(m.captionStarter||`${m.winner}${sc?" "+m.winnerScore+"-"+m.loserScore:""} over ${m.loser}.`)+" [finish the joke]";
  const fmt=t&&t.format==="Carousel"?"Carousel":"Reel";
  return [ymd(new Date()),"",m.postDate||"",m.postTime||"",m.urgency||"",lg,storyline,t?t.name:"(pick a template)",pillarFor(t,ucs),fmt,m.concept||"(write your concept)",caption,hashtags(lg,m.winner,m.loser),ucs.map(u=>UC[u]||u).join(", ")]
    .map(c=>String(c??"").replace(/[\t\n]/g," ")).join("\t");
}
const inboxPick={};
function renderInbox(){
  const host=$("inboxList"), show=$("t-show").value;
  if(!db){host.innerHTML=`<div class="empty">Today's moments need the saved library, which isn't available in this view.</div>`;$("t-count").textContent="";return;}
  const auto=moments.filter(m=>m.source==="auto");
  const list=auto.filter(m=>show==="all"||(m.status||"new")===show);
  $("t-count").textContent=`${auto.filter(m=>(m.status||"new")==="new").length} new`;
  if(!list.length){host.innerHTML=`<div class="empty">${show==="new"?"Nothing new. The next automatic check adds moments here.":"Nothing here."}</div>`;return;}
  host.innerHTML=list.map(m=>{
    const off=!!m.offLimits;
    const ranked=off?[]:templates.map(t=>scoreTemplate(t,m.useCases||[],m.league)).filter(Boolean).filter(r=>r.overlap.length).sort((a,b)=>b.s-a.s).slice(0,3);
    const pick=inboxPick[m.id]||m.templateId||(ranked[0]&&ranked[0].t.id)||null;
    const sc=m.winnerScore!=null&&m.loserScore!=null?` ${m.winnerScore}–${m.loserScore}`:"";
    return `<div class="card">
      <div class="head"><span class="tname">${esc(m.headline||m.description)}</span>
        <span class="meta">${esc(m.league)} · ${esc(m.winner)}${sc} ${esc(m.loser)}</span></div>
      <div class="chips">${off?'<span class="pill warn">Off-limits · report only</span>':`<span class="pill ${m.potential==="High"?"fresh":""}">${esc(m.potential||"")} potential</span>`}
        ${(m.useCases||[]).map(u=>`<span class="pill uc">${esc(UC[u]||u)}</span>`).join("")}</div>
      ${m.description&&m.headline?`<div class="why">${esc(m.description)}</div>`:""}
      ${off?"":`<dl class="kv"><dt>Post</dt><dd>${esc(m.urgency||"")} · ${esc(m.postDate||"")} ${esc(m.postTime||"")} ET</dd>${m.concept?`<dt>Idea</dt><dd>${esc(m.concept)}</dd>`:""}</dl>
      <div class="chips">${ranked.map(r=>`<button type="button" class="chk${r.t.id===pick?" auto":""}" data-ip="${esc(m.id)}|${esc(r.t.id)}">${esc(r.t.name)}</button>`).join("")||'<span class="note">No tagged template fits yet.</span>'}</div>`}
      ${(m.sources||[]).length?`<div class="note">Source: ${(m.sources||[]).slice(0,2).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc((u.split("/")[2]||u))}</a>`).join(" · ")}</div>`:""}
      <div class="actions">
        ${off?"":`<button class="btn small primary" type="button" data-copy="${esc(m.id)}">Copy row</button>
        <button class="btn small" type="button" data-queue="${esc(m.id)}">${(m.status||"new")==="queued"?"Queued ✓":"Mark queued"}</button>
        <button class="btn small" type="button" data-load="${esc(m.id)}">Open in matcher</button>`}
        <button class="btn small" type="button" data-dismiss="${esc(m.id)}">${(m.status||"new")==="dismissed"?"Restore":"Dismiss"}</button>
      </div></div>`;}).join("");
  host.querySelectorAll("[data-ip]").forEach(b=>b.addEventListener("click",()=>{const [mid,tid]=b.dataset.ip.split("|");inboxPick[mid]=tid;renderInbox();}));
  host.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>{const m=moments.find(x=>x.id===b.dataset.copy);
    const off=!!m.offLimits;const ranked=templates.map(t=>scoreTemplate(t,m.useCases||[],m.league)).filter(Boolean).filter(r=>r.overlap.length).sort((a,c)=>c.s-a.s);
    const tid=inboxPick[m.id]||m.templateId||(ranked[0]&&ranked[0].t.id);const t=templates.find(x=>x.id===tid);
    const pre=document.createElement("pre");pre.className="out";pre.textContent=rowFor(m,t);b.closest(".card").appendChild(pre);copyText(pre.textContent,pre);}));
  host.querySelectorAll("[data-queue]").forEach(b=>b.addEventListener("click",async()=>{const m=moments.find(x=>x.id===b.dataset.queue);
    const tid=inboxPick[m.id]||m.templateId||null;const t=templates.find(x=>x.id===tid);
    try{await db.collection("moments").doc(m.id).update({status:"queued",templateId:tid});
      if(t)await db.collection("templates").doc(t.id).update({lastUsed:new Date().toISOString(),timesUsed:(t.timesUsed||0)+1});toast("Queued");}
    catch(e){toast("Couldn't save: "+(e.message||e.code));}}));
  host.querySelectorAll("[data-dismiss]").forEach(b=>b.addEventListener("click",async()=>{const m=moments.find(x=>x.id===b.dataset.dismiss);
    try{await db.collection("moments").doc(m.id).update({status:(m.status||"new")==="dismissed"?"new":"dismissed"});}catch(e){toast("Couldn't save: "+(e.message||e.code));}}));
  host.querySelectorAll("[data-load]").forEach(b=>b.addEventListener("click",()=>{loadMoment(b.dataset.load);showTab("match");}));
}
$("t-show").addEventListener("input",renderInbox);

/* refresh: runs the moment scan now via /api/scan */
let lastRefresh=null;
function refreshLabel(){
  if(!lastRefresh){$("refreshNote").textContent="";$("refreshBtn").disabled=false;return;}
  const mins=Math.round((Date.now()-new Date(lastRefresh).getTime())/60000);
  $("refreshNote").textContent=`Last check: ${mins<1?"just now":new Date(lastRefresh).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}`;
  $("refreshBtn").disabled=mins<10;
}
$("refreshBtn").addEventListener("click",async()=>{
  const btn=$("refreshBtn");btn.disabled=true;$("refreshNote").textContent="Checking last night's and today's games…";
  try{
    const r=await fetch("/api/scan",{method:"POST"});const res=await r.json();
    if(r.status===429){lastRefresh=res.at;refreshLabel();toast("Checked less than 10 minutes ago");return;}
    if(!r.ok)throw new Error(res.error||r.status);
    lastRefresh=new Date().toISOString();refreshLabel();
    toast(res.added?`${res.added} new moment${res.added>1?"s":""}`:"No new moments");
    if(res.errors&&res.errors.length)$("refreshNote").textContent+=` · ${res.errors.length} feed problem${res.errors.length>1?"s":""}`;
  }catch(e){btn.disabled=false;$("refreshNote").textContent="Couldn't run the check ("+(e.message||"error")+"). Try again in a minute.";}
});
setInterval(refreshLabel,60000);

/* library */
function renderLibFilters(){$("f-uc").innerHTML='<option value="">All</option>'+USE_CASES.map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join("");}
function renderLib(){
  const fuc=$("f-uc").value,ff=$("f-fresh").value,q=$("f-q").value.trim().toLowerCase();
  const list=templates.filter(t=>(!fuc||(t.useCases||[]).includes(fuc))&&(!ff||t.freshness===ff)&&(!q||(t.name+" "+(t.how||"")).toLowerCase().includes(q)))
    .sort((a,b)=>(a.status==="retired")-(b.status==="retired")||a.name.localeCompare(b.name));
  const host=$("libList");
  if(!db){host.innerHTML=`<div class="empty">Your saved library isn't available in this view. Open the page on claude.ai while signed in.</div>`;return;}
  if(!templates.length){host.innerHTML=`<div class="empty">No templates yet. Add your first one in the Add template tab.</div>`;return;}
  if(!list.length){host.innerHTML=`<div class="empty">No templates match these filters.</div>`;return;}
  host.innerHTML=`<p class="note">${list.length} of ${templates.length} templates</p>`+list.map(t=>{const ds=daysSince(t.lastUsed);return `<div class="card${t.status==="retired"?" retired":""}">
    <div class="head"><span class="tname">${esc(t.name)} ${t.freshness==="fresh"?'<span class="pill fresh">Fresh</span>':'<span class="pill">Classic</span>'} <span class="pill">${esc(t.format||"Both")}</span> <span class="pill">${esc(t.tone||"")}</span>${t.status==="retired"?' <span class="pill warn">Retired</span>':""}</span>
    <span class="meta">Used ${t.timesUsed||0}× · ${ds===null?"never":"last "+ds+"d ago"}</span></div>
    ${t.how?`<div class="why">${esc(t.how)}</div>`:""}
    <div class="chips">${(t.useCases||[]).map(u=>`<span class="pill uc">${esc(UC[u]||u)}</span>`).join("")||'<span class="pill warn">No use cases</span>'}</div>
    <div class="actions"><button class="btn small" type="button" data-edit="${esc(t.id)}">Edit</button><button class="btn small" type="button" data-retire="${esc(t.id)}">${t.status==="retired"?"Restore":"Retire"}</button></div></div>`}).join("");
  host.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>startEdit(b.dataset.edit)));
  host.querySelectorAll("[data-retire]").forEach(b=>b.addEventListener("click",async()=>{const t=templates.find(x=>x.id===b.dataset.retire);
    try{await db.collection("templates").doc(t.id).update({status:t.status==="retired"?"active":"retired"});}catch(e){toast("Couldn't save: "+(e.message||e.code));}}));
}
["f-uc","f-fresh","f-q"].forEach(id=>$(id).addEventListener("input",renderLib));
$("exportBtn").addEventListener("click",()=>{
  const out=$("exportOut");
  const lines=["MEME TEMPLATE DATABASE (@sportsmemery) - exported "+ymd(new Date()),"Format: Name | Type | Best format | Tone | Use cases | How it works | Last used",""];
  templates.filter(t=>t.status!=="retired").sort((a,b)=>a.name.localeCompare(b.name)).forEach(t=>lines.push([t.name,t.freshness,t.format,t.tone,(t.useCases||[]).map(u=>UC[u]).join(", "),t.how||"",t.lastUsed?t.lastUsed.slice(0,10):"never"].join(" | ")));
  out.textContent=lines.join("\n");out.hidden=false;copyText(out.textContent,out);
});

/* add / edit */
function resetAdd(){editingId=null;$("addForm").reset();renderChips($("a-uc"),"auc");$("addTitle").textContent="Add a template";$("addSubmit").textContent="Save template";$("addCancel").hidden=true;$("suggestNote").textContent="";}
function startEdit(id){const t=templates.find(x=>x.id===id);if(!t)return;editingId=id;
  $("a-name").value=t.name;$("a-how").value=t.how||"";$("a-fresh").value=t.freshness||"classic";$("a-format").value=t.format||"Both";$("a-tone").value=t.tone||"Roast";$("a-source").value=t.source||"";
  renderChips($("a-uc"),"auc",t.useCases||[]);$("addTitle").textContent="Edit: "+t.name;$("addSubmit").textContent="Save changes";$("addCancel").hidden=false;showTab("add");}
$("addCancel").addEventListener("click",resetAdd);
$("addForm").addEventListener("submit",async e=>{e.preventDefault();
  if(!db){toast("Saving needs the library, which isn't available in this view");return;}
  const name=$("a-name").value.trim();if(!name){toast("Give the template a name");return;}
  const data={name,how:$("a-how").value.trim(),freshness:$("a-fresh").value,format:$("a-format").value,tone:$("a-tone").value,source:$("a-source").value.trim(),useCases:readChips("auc")};
  try{
    if(editingId){await db.collection("templates").doc(editingId).update(data);toast("Saved changes");}
    else{await db.collection("templates").add({...data,addedAt:new Date().toISOString(),lastUsed:null,timesUsed:0,status:"active"});toast("Added "+name);}
    resetAdd();
  }catch(err){toast("Couldn't save: "+(err.message||err.code));}
});
function keywordSuggest(text){
  const t=text.toLowerCase(),out=[];
  const map={blowout:/domina|destroy|crush|flex|laugh|easy|superior|stomp/,upset:/surpris|shock|unexpected|underdog|pikachu/,collapse:/fine|fire|fall|crash|panic|choke|melt/,rivalry:/versus|vs|rival|enemy|compare/,
    clutch:/clutch|hero|last|save/,bad_call:/ref|unfair|wrong|blind/,coaching:/plan|decision|choice|strategy|brain/,meltdown:/cry|scream|yell|angry|rage|mad/,streak:/again|always|every time|still/,
    rankings:/rank|tier|list|better than|best/,transaction:/leav|new|replace|swap|trade|distract/,fantasy:/regret|bench|wrong choice|two buttons/,hype:/hype|ready|coming|prepare|incoming/,milestone:/record|history|legend/,revenge:/revenge|return|back|ex /,cat_watch:/cat|tiger|lion|panther/};
  for(const [k,re] of Object.entries(map))if(re.test(t))out.push(k);return out;
}
$("suggestBtn").addEventListener("click",async()=>{
  const text=$("a-name").value+". "+$("a-how").value;if(text.trim().length<4){toast("Add a name and how it works first");return;}
  const btn=$("suggestBtn"),note=$("suggestNote");btn.disabled=true;
  let ucs=null;
  note.textContent="Asking Claude…";
  try{
    const r=await fetch("/api/suggest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:$("a-name").value,how:$("a-how").value})});
    const res=await r.json();
    if(!r.ok)throw Object.assign(new Error(res.error),{code:res.error});
    ucs=(res.useCases||[]).filter(u=>UC[u]);if(res.format)$("a-format").value=res.format;if(res.tone)$("a-tone").value=res.tone;note.textContent=res.reason||"Suggested by Claude. Adjust as needed.";
  }catch(e){ucs=null;note.textContent=e.code==="not_configured"?"Claude suggestions aren't set up (no API key). Using keyword matching.":"Claude couldn't answer. Using keyword matching.";}
  if(!ucs){ucs=keywordSuggest(text);if(!ucs.length)note.textContent+=" No keyword match either. Tick the use cases yourself.";}
  const cur=readChips("auc");renderChips($("a-uc"),"auc",[...new Set([...cur,...ucs])],ucs);btn.disabled=false;
});

/* guide */
$("guideList").innerHTML=USE_CASES.map(([id,n,d])=>`<div><b>${esc(n)}</b>${esc(d)}</div>`).join("");

/* boot */
renderLibFilters();renderChips($("a-uc"),"auc");
try{const t=localStorage.getItem("memelab.tab");if(t)showTab(t);}catch(e){}
analyze();renderLib();renderMoments();renderInbox();
db=createDb();
db.collection("templates").onSnapshot(s=>{templates=s.docs.map(d=>({id:d.id,...d.data()}));$("dbStatus").textContent=`Library: ${templates.length} templates`;analyze();renderLib();renderMoments();renderInbox();},
  e=>{$("dbStatus").textContent="Library error: "+e.message;});
db.collection("moments").orderBy("createdAt","desc").limit(150).onSnapshot(s=>{moments=s.docs.map(d=>({id:d.id,...d.data()}));renderMoments();renderInbox();},()=>{});
$("refreshBtn").hidden=false;
db.doc("meta/refresh").onSnapshot(d=>{lastRefresh=d.exists?d.data().at:null;refreshLabel();},()=>{});
