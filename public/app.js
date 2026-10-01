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
 ["cat_watch","Cat Watch","A cat team wins by a decent margin"],
 ["cat_fight","Cat fight","Two cat teams play each other"],
 ["gator_watch","Gator Watch","Florida beats a team, which gets spooked by the Gators (the Chubbs meme)"]];
const UC=Object.fromEntries(USE_CASES.map(u=>[u[0],u[1]]));
const MARGIN={NFL:14,CFB:14,NBA:15,WNBA:15,MLB:5,NHL:3,CBB:15};
const LEAGUE_TAGS={NFL:["#nflmemes","#nfl"],CFB:["#cfbmemes","#collegefootball"],MLB:["#mlbmemes","#baseballmemes"],NBA:["#nbamemes","#nba"],WNBA:["#wnbamemes","#wnba"],NHL:["#nhlmemes","#hockeymemes"],CBB:["#collegebasketball","#cbbmemes"]};
const LEAGUE_NAMES={NFL:"NFL",CFB:"College football",MLB:"MLB",NBA:"NBA",WNBA:"WNBA",NHL:"NHL",CBB:"College basketball"};
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
  ["today","plan","match","lib","add","guide"].forEach(p=>$("pane-"+p).hidden=p!==t);
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
  if(isCat($("m-winner").value)&&isCat($("m-loser").value))auto.push("cat_fight");
  if(/^florida( gators)?$/i.test($("m-winner").value.trim())&&["CFB","CBB"].includes(lg))auto.push("gator_watch");
  return {auto:[...new Set(auto)],margin,hasScore};
}
function currentUseCases(auto){return USE_CASES.map(u=>u[0]).filter(id=>id in manual?manual[id]:auto.includes(id));}

/* when to post: the next window (ET) that leaves an hour to make the meme */
const POST_WINDOWS=[{label:"Morning",start:8*60,end:10*60,range:"8–10 AM"},{label:"Late night",start:22*60,end:24*60,range:"10 PM–12 AM"}];
const PREP_MINUTES=60;
function etParts(d){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));
  return {ymd:`${p.year}-${p.month}-${p.day}`,min:(+p.hour%24)*60+(+p.minute)};
}
function minutesLabel(m){const h=Math.floor(m/60)%24;return (h%12||12)+":"+String(m%60).padStart(2,"0")+" "+(h>=12?"PM":"AM");}
function nextWindow(from,lead=PREP_MINUTES){
  const ready=new Date(from.getTime()+lead*6e4),readyMin=Math.ceil(etParts(ready).min/15)*15;
  for(let k=0;k<4;k++){
    const date=etParts(new Date(ready.getTime()+k*864e5)).ymd;
    for(const w of POST_WINDOWS){const t=Math.max(w.start,k===0?readyMin:0);if(t<w.end)return {date,time:minutesLabel(t),window:w.label,range:w.range};}
  }
  return {date:"",time:"",window:"",range:""};
}
function dayLabel(dateStr){
  const today=etParts(new Date()).ymd,tomorrow=etParts(new Date(Date.now()+864e5)).ymd;
  if(dateStr===today)return "Today";if(dateStr===tomorrow)return "Tomorrow";
  const d=new Date(dateStr+"T12:00:00");return isNaN(d)?dateStr:d.toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"});
}
function postPlan(){
  const w=$("m-when").value, lg=$("m-league").value, now=new Date();
  if(w==="future")return {urgency:"Planned",date:"TBD",time:"TBD",window:"",note:"Upcoming. Use the Plan ahead tab and prep both outcomes.",motw:false};
  const slot=nextWindow(now),today=etParts(now).ymd;
  const urgency=w==="week"?"Batch":slot.date===today?"Post today":"Next window";
  const note=`${slot.window} window (${slot.range} ET), the next one that leaves an hour to make it.`+(w==="week"?" Past the reaction window: works as a batch post or a Meme of the Week slide.":"");
  const day=now.getDay();
  const motw=(lg==="NFL"||lg==="CFB")&&w!=="future"&&[0,1,6].includes(day);
  return {urgency,date:slot.date,time:slot.time,window:slot.window,note,motw};
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
  const sfx=lg==="CFB"?"football":lg==="CBB"?"basketball":"";
  if(winner)tags.push(team(winner)+sfx);
  if(loser)tags.push(team(loser)+sfx);
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
      <dt>Post</dt><dd>${plan.date==="TBD"?"TBD":plan.window+" · "+dayLabel(plan.date)+" "+plan.time+" ET"}</dd>
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
$("finalizeMoment").addEventListener("click",async()=>{
  if(!db)return;const {auto}=autoUseCases();const ucs=currentUseCases(auto);const plan=postPlan();
  if($("m-offlimits").checked){toast("Off-limits: nothing to finalize");return;}
  const data={createdAt:new Date().toISOString(),league:$("m-league").value,winner:$("m-winner").value.trim(),loser:$("m-loser").value.trim(),
    winnerScore:$("m-ws").value===""?null:+$("m-ws").value,loserScore:$("m-ls").value===""?null:+$("m-ls").value,
    description:$("m-desc").value.trim(),headline:$("m-desc").value.trim(),useCases:ucs,templateId:picked||null,concept:$("m-concept").value.trim(),
    postDate:plan.date,postTime:plan.time,postWindow:plan.window||"",urgency:plan.urgency};
  try{const ref=await db.collection("moments").add(data);await finalizeMoment({id:ref.id,...data},picked,$("finalizeMoment"));}
  catch(e){toast("Couldn't save: "+(e.message||e.code));}
});
$("markUsed").addEventListener("click",async()=>{
  const t=templates.find(x=>x.id===picked);if(!t||!db)return;
  try{await db.collection("templates").doc(t.id).update({lastUsed:new Date().toISOString(),timesUsed:(t.timesUsed||0)+1});toast("Marked used: "+t.name);}
  catch(e){toast("Couldn't save: "+(e.message||e.code));}
});
$("saveMoment").addEventListener("click",async()=>{
  if(!db)return;const {auto}=autoUseCases();const ucs=currentUseCases(auto);const plan=postPlan();
  const data={createdAt:new Date().toISOString(),league:$("m-league").value,winner:$("m-winner").value.trim(),loser:$("m-loser").value.trim(),
    winnerScore:$("m-ws").value===""?null:+$("m-ws").value,loserScore:$("m-ls").value===""?null:+$("m-ls").value,
    description:$("m-desc").value.trim(),useCases:ucs,templateId:picked||null,concept:$("m-concept").value.trim(),postDate:plan.date,postTime:plan.time,postWindow:plan.window||"",urgency:plan.urgency};
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
      ${off?"":`<dl class="kv"><dt>Post</dt><dd>${m.postWindow?esc(m.postWindow)+" · "+esc(dayLabel(m.postDate))+" "+esc(m.postTime||"")+" ET":esc(m.urgency||"")+" · "+esc(m.postDate||"")+" "+esc(m.postTime||"")+" ET"}</dd>${m.concept?`<dt>Idea</dt><dd>${esc(m.concept)}</dd>`:""}${m.text1?`<dt>On image</dt><dd>${esc([m.text1,m.text2,m.text3].filter(Boolean).join(" / "))}</dd>`:""}</dl>
      ${m.csvUrl?`<div class="note">Finalized: <a href="${esc(m.csvUrl)}" target="_blank" rel="noopener">${esc(m.csvName||"CSV for After Effects")}</a></div>`:""}
      <div class="chips">${ranked.map(r=>`<button type="button" class="chk${r.t.id===pick?" auto":""}" data-ip="${esc(m.id)}|${esc(r.t.id)}">${esc(r.t.name)}</button>`).join("")||'<span class="note">No tagged template fits yet.</span>'}</div>`}
      ${(m.sources||[]).length?`<div class="note">Source: ${(m.sources||[]).slice(0,2).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc((u.split("/")[2]||u))}</a>`).join(" · ")}</div>`:""}
      <div class="actions">
        ${off?"":`${canFinalize()?`<button class="btn small primary" type="button" data-final="${esc(m.id)}">${m.csvUrl?"Finalize again":"Finalize"}</button>`:""}
        <button class="btn small${canFinalize()?"":" primary"}" type="button" data-copy="${esc(m.id)}">Copy row</button>
        ${canFinalize()?"":`<button class="btn small" type="button" data-queue="${esc(m.id)}">${(m.status||"new")==="queued"?"Queued ✓":"Mark queued"}</button>`}
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
  host.querySelectorAll("[data-final]").forEach(b=>b.addEventListener("click",()=>{const m=moments.find(x=>x.id===b.dataset.final);
    const ranked=templates.map(t=>scoreTemplate(t,m.useCases||[],m.league)).filter(Boolean).filter(r=>r.overlap.length).sort((a,c)=>c.s-a.s);
    finalizeMoment(m,inboxPick[m.id]||m.templateId||(ranked[0]&&ranked[0].t.id)||null,b);}));
}
$("t-show").addEventListener("input",renderInbox);

/* finalize: Claude writes the on-image text in your voice; the engine adds a Meme Queue row,
   saves a CSV for After Effects in Drive, and marks the moment queued */
function canFinalize(){return typeof api!=="undefined"&&typeof api.finalize==="function";}
async function finalizeMoment(m,templateId,btn){
  if(!templateId&&!confirm("No template picked. Finalize anyway?"))return;
  const label=btn?btn.textContent:"";if(btn){btn.disabled=true;btn.textContent="Writing…";}
  try{
    const res=await api.finalize({momentId:m.id,templateId,hashtags:hashtags(m.league,m.winner,m.loser)});
    toast("Saved to Meme Queue + CSV (it's under Show: Queued)");
    return res;
  }catch(e){toast("Couldn't finalize: "+(e.message||e.code));}
  finally{if(btn){btn.disabled=false;btn.textContent=label;}}
}

/* moment scan: ESPN refuses Google's and Cloudflare's servers, so this device fetches yesterday's and
   today's scoreboards and sends the finished games to the engine, which flags them and saves moments */
const ESPN_FEEDS={NFL:"football/nfl",CFB:"football/college-football",MLB:"baseball/mlb",NBA:"basketball/nba",WNBA:"basketball/wnba",NHL:"hockey/nhl",CBB:"basketball/mens-college-basketball"};
const ESPN_GROUPS={CFB:"80",CBB:"50"}; // FBS, Division I
const espnUrl=(league,kind,q)=>`https://site.api.espn.com/apis/site/v2/sports/${ESPN_FEEDS[league]}/${kind}?${q}${ESPN_GROUPS[league]?"&groups="+ESPN_GROUPS[league]:""}`;
const AUTO_SCAN_HOURS=3;
function etDay(d){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(d);}
function trimEvent(ev){ // only what the scan reads, so the upload stays small
  const c=(ev.competitions||[])[0]||{},st=c.status||{},type=st.type||{},h=(c.headlines||[])[0];
  const link=(ev.links||[]).find(l=>(l.rel||[]).some(r=>r==="recap"||r==="summary"));
  return {competitions:[{status:{period:st.period,type:{completed:!!type.completed,detail:type.detail}},
    competitors:(c.competitors||[]).map(x=>({score:x.score,curatedRank:x.curatedRank?{current:x.curatedRank.current}:undefined,
      team:{name:(x.team||{}).name,location:(x.team||{}).location,displayName:(x.team||{}).displayName}})),
    headlines:h?[{shortLinkText:h.shortLinkText,description:h.description}]:[]}],
    links:link?[{rel:link.rel,href:link.href}]:[]};
}
async function fetchScoreboards(){
  const now=new Date(),days=[etDay(new Date(now.getTime()-864e5)),etDay(now)],jobs=[];
  Object.keys(ESPN_FEEDS).forEach(league=>days.forEach(day=>jobs.push({league,day})));
  return Promise.all(jobs.map(async({league,day})=>{
    try{
      const r=await fetch(espnUrl(league,"scoreboard","dates="+day.replace(/-/g,"")+"&limit=300"),{credentials:"omit"});
      if(!r.ok)return{league,day,error:String(r.status)};
      const body=await r.json();
      return{league,day,events:(body.events||[]).filter(e=>((((e.competitions||[])[0]||{}).status||{}).type||{}).completed).map(trimEvent)};
    }catch(e){return{league,day,error:"couldn't reach ESPN from this device"};}
  }));
}
let lastRefresh=null,scanning=false,autoChecked=false;
function refreshLabel(){
  if(scanning)return;
  if(!lastRefresh){$("refreshNote").textContent="";$("refreshBtn").disabled=false;return;}
  const mins=Math.round((Date.now()-new Date(lastRefresh).getTime())/60000);
  $("refreshNote").textContent=`Last check: ${mins<1?"just now":new Date(lastRefresh).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}`;
  $("refreshBtn").disabled=mins<10;
}
async function runScan(auto){
  if(scanning)return;
  scanning=true;const btn=$("refreshBtn");btn.disabled=true;$("refreshNote").textContent="Checking last night's and today's games…";
  try{
    const res=await api.scan(await fetchScoreboards());
    scanning=false;lastRefresh=new Date().toISOString();refreshLabel();
    if(res.added||!auto)toast(res.added?`${res.added} new moment${res.added>1?"s":""}`:"No new moments");
    if(res.errors&&res.errors.length)$("refreshNote").textContent+=` · ${res.errors.length} problem${res.errors.length>1?"s":""}: ${res.errors[0]}`;
  }catch(e){
    scanning=false;
    if(e.code==="cooldown"){lastRefresh=e.at;refreshLabel();if(!auto)toast("Checked less than 10 minutes ago");return;}
    btn.disabled=false;$("refreshNote").textContent="Couldn't run the check ("+(e.message||"error")+"). Try again in a minute.";
  }
}
$("refreshBtn").addEventListener("click",()=>runScan(false));
/** When the app opens, check for new moments if the last check is a few hours old. */
function autoScan(){
  if(autoChecked)return;autoChecked=true;
  if(!lastRefresh||Date.now()-new Date(lastRefresh).getTime()>AUTO_SCAN_HOURS*36e5)runScan(true);
}
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
    const res=await api.suggest({name:$("a-name").value,how:$("a-how").value});
    ucs=(res.useCases||[]).filter(u=>UC[u]);if(res.format)$("a-format").value=res.format;if(res.tone)$("a-tone").value=res.tone;note.textContent=res.reason||"Suggested by Claude. Adjust as needed.";
  }catch(e){ucs=null;note.textContent=e.code==="not_configured"?"Claude suggestions aren't set up (no API key). Using keyword matching.":"Claude couldn't answer. Using keyword matching.";}
  if(!ucs){ucs=keywordSuggest(text);if(!ucs.length)note.textContent+=" No keyword match either. Tick the use cases yourself.";}
  const cur=readChips("auc");renderChips($("a-uc"),"auc",[...new Set([...cur,...ucs])],ucs);btn.disabled=false;
});

/* plan ahead: this device fetches ESPN's upcoming schedule (ESPN blocks servers); the engine flags
   matchups worth prepping and Claude writes "if this happens, post this" ideas */
const PLAN_LABELS={gator_watch:"Gator Watch",cat_fight:"Cat fight",ranked_showdown:"Ranked showdown",upset_watch:"Upset watch",rivalry:"Rivalry"};
let plans=[];
function trimUpcoming(ev){
  const c=(ev.competitions||[])[0]||{};
  return {date:ev.date,competitions:[{date:c.date||ev.date,status:{type:{state:((c.status||{}).type||{}).state}},
    competitors:(c.competitors||[]).map(x=>({homeAway:x.homeAway,curatedRank:x.curatedRank?{current:x.curatedRank.current}:undefined,
      team:{name:(x.team||{}).name,location:(x.team||{}).location,displayName:(x.team||{}).displayName}})),
    notes:(c.notes||[]).map(n=>({headline:n.headline}))}]};
}
/* Runs fn over items, a few at a time, so dozens of ESPN requests don't all go at once. */
async function inBatches(items,size,fn){const out=[];for(let i=0;i<items.length;i+=size)out.push(...await Promise.all(items.slice(i,i+size).map(fn)));return out;}
/* One scoreboard request per league per day, the same request the Today scan uses (ESPN rejects
   date ranges and big page sizes with a 400). Returns one feed per league. */
async function fetchUpcoming(days){
  const now=new Date(),dates=[];
  for(let k=0;k<=days;k++)dates.push(etParts(new Date(now.getTime()+k*864e5)).ymd.replace(/-/g,""));
  const jobs=[];Object.keys(ESPN_FEEDS).forEach(league=>dates.forEach(d=>jobs.push({league,d})));
  const replies=await inBatches(jobs,8,async({league,d})=>{
    try{
      const r=await fetch(espnUrl(league,"scoreboard",`dates=${d}&limit=300`),{credentials:"omit"});
      if(!r.ok)return{league,error:String(r.status)};
      const body=await r.json();
      return{league,events:(body.events||[]).filter(e=>((((e.competitions||[])[0]||{}).status||{}).type||{}).state==="pre").map(trimUpcoming)};
    }catch(e){return{league,error:"couldn't reach ESPN from this device"};}
  });
  return Object.keys(ESPN_FEEDS).map(league=>{
    const mine=replies.filter(r=>r.league===league),ok=mine.filter(r=>r.events);
    return ok.length?{league,events:ok.flatMap(r=>r.events)}:{league,error:(mine[0]||{}).error||"no schedule"};
  });
}
$("planBtn").addEventListener("click",async()=>{
  const btn=$("planBtn");btn.disabled=true;$("planNote").textContent="Looking at the schedule…";
  try{
    const res=await api.plan(await fetchUpcoming(+$("p-range").value));
    $("planNote").textContent=`${res.found} matchup${res.found===1?"":"s"} with an angle · ${res.added} new`+
      (res.errors&&res.errors.length?` · ${res.errors.length} problem${res.errors.length>1?"s":""}: ${res.errors[0]}`:"");
  }catch(e){$("planNote").textContent="Couldn't plan ("+(e.message||"error")+").";}
  finally{btn.disabled=false;}
});
const planStatus=p=>p.status||"upcoming";
const planOpen=p=>planStatus(p)==="upcoming"&&(p.start||"")>=new Date(Date.now()-6*36e5).toISOString();
function renderPlans(){
  const host=$("planList"),show=$("p-show").value;
  const list=plans.filter(p=>show==="all"||(show==="open"?planOpen(p):planStatus(p)===show));
  $("p-count").textContent=`${plans.filter(planOpen).length} to prep`;
  if(!list.length){host.innerHTML=`<div class="empty">${show==="open"?"Nothing to prep yet. Pick how far ahead and press Find matchups.":"Nothing here."}</div>`;return;}
  const rank=r=>r?"#"+r+" ":"";
  host.innerHTML=list.map(p=>{
    const when=p.start?new Date(p.start).toLocaleString([], {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
    return `<div class="card">
      <div class="head"><span class="tname">${esc(p.headline)}</span><span class="meta">${esc(LEAGUE_NAMES[p.league]||p.league)} · ${esc(when)}</span></div>
      <div class="meta">${esc(rank(p.awayRank)+(p.awayFull||p.away))} at ${esc(rank(p.homeRank)+(p.homeFull||p.home))}${p.notes?" · "+esc(p.notes):""}</div>
      <div class="chips">${(p.angles||[]).map(a=>`<span class="pill ${a==="gator_watch"||a==="cat_fight"?"fresh":"uc"}">${esc(PLAN_LABELS[a]||a)}</span>`).join("")}</div>
      ${(p.scenarios||[]).length?`<dl class="kv">${p.scenarios.map(sc=>`<dt>${esc(sc.outcome)}</dt><dd>${esc(sc.idea)}${sc.template?` <span class="pill">${esc(sc.template)}</span>`:""}</dd>`).join("")}</dl>`
        :'<p class="note">No ideas written (Claude is off or didn\'t answer). The angle is still worth a look.</p>'}
      <dl class="kv"><dt>Post</dt><dd>${esc(p.postWindow||"")} · ${esc(dayLabel(p.postDate||""))} ${esc(p.postTime||"")} ET, after the game</dd></dl>
      <div class="actions">
        <button class="btn small${planStatus(p)==="prepping"?"":" primary"}" type="button" data-prep="${esc(p.id)}">${planStatus(p)==="prepping"?"Prepping ✓":"Prep this"}</button>
        <button class="btn small" type="button" data-pdis="${esc(p.id)}">${planStatus(p)==="dismissed"?"Restore":"Dismiss"}</button>
      </div></div>`;}).join("");
  const setStatus=async(id,next)=>{try{await db.collection("plans").doc(id).update({status:next});}catch(e){toast("Couldn't save: "+(e.message||e.code));}};
  host.querySelectorAll("[data-prep]").forEach(b=>b.addEventListener("click",()=>{const p=plans.find(x=>x.id===b.dataset.prep);setStatus(p.id,planStatus(p)==="prepping"?"upcoming":"prepping");}));
  host.querySelectorAll("[data-pdis]").forEach(b=>b.addEventListener("click",()=>{const p=plans.find(x=>x.id===b.dataset.pdis);setStatus(p.id,planStatus(p)==="dismissed"?"upcoming":"dismissed");}));
}
$("p-show").addEventListener("input",renderPlans);

/* team numbers for After Effects: this device fetches ESPN's team lists; the engine numbers them */
async function fetchTeams(){
  return Promise.all(Object.keys(ESPN_FEEDS).map(async league=>{
    try{
      let r=await fetch(espnUrl(league,"teams","limit=500"),{credentials:"omit"});
      if(!r.ok)r=await fetch(espnUrl(league,"teams","limit=100"),{credentials:"omit"});
      if(!r.ok)return{league,teams:[]};
      const body=await r.json();
      const list=((((body.sports||[])[0]||{}).leagues||[])[0]||{}).teams||[];
      return{league,teams:list.map(x=>x.team||{}).map(t=>({id:t.id,name:t.name,location:t.location,displayName:t.displayName,abbr:t.abbreviation}))};
    }catch(e){return{league,teams:[]};}
  }));
}
$("teamsBtn").addEventListener("click",async()=>{
  const btn=$("teamsBtn");btn.disabled=true;$("teamsNote").textContent="Getting team lists…";
  try{
    const res=await api.saveTeams(await fetchTeams());
    $("teamsNote").textContent=Object.entries(res).filter(([,r])=>r.total).map(([lg,r])=>`${LEAGUE_NAMES[lg]||lg}: ${r.total}${r.added?` (+${r.added} new)`:""}`).join(" · ")||"No team lists came back from ESPN.";
  }catch(e){$("teamsNote").textContent="Couldn't build the lists ("+(e.message||"error")+").";}
  finally{btn.disabled=false;}
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
// features the Apps Script engine has (the older Cloudflare-only version doesn't)
const engineHas=fn=>typeof api!=="undefined"&&typeof api[fn]==="function";
$("finalizeMoment").hidden=!engineHas("finalize");
$("teamsPanel").hidden=!engineHas("saveTeams");
$("tab-plan").hidden=!engineHas("plan");
if(engineHas("plan"))db.collection("plans").onSnapshot(s=>{plans=s.docs.map(d=>({id:d.id,...d.data()}));renderPlans();},()=>{});
db.doc("meta/refresh").onSnapshot(d=>{lastRefresh=d.exists?d.data().at:null;refreshLabel();autoScan();},()=>{});
