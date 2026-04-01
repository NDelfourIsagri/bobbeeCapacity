// ── COLORS ──────────────────────────────────────────────
const COLORS=['#e91e63','#9c27b0','#3f51b5','#009688','#ff5722','#607d8b','#795548','#4caf50','#ff9800','#00bcd4'];
const mc=i=>COLORS[i%COLORS.length];

// ── TOKEN + THEME (seules choses en localStorage) ────────
let TOKEN = null;
try { TOKEN = localStorage.getItem('bcp_token'); } catch {}
const _ls = {
  getTheme(){ try{return localStorage.getItem('bcp_theme')||'yellow';}catch{return 'yellow';} },
  setTheme(t){ try{localStorage.setItem('bcp_theme',t);}catch{} },
  setToken(t){ TOKEN=t; try{ t?localStorage.setItem('bcp_token',t):localStorage.removeItem('bcp_token'); }catch{} }
};

// ── IN-MEMORY STORE ──────────────────────────────────────
const STORE = {
  team: [], sprints: [], leaves: [], users: [],
  vel_grid: {alternant:50,junior:70,intermediaire:85,senior:100},
  mtg_grid: {dev:15,tech_lead:35,qa:20,squad_lead:45,po:50}
};

// ── API ───────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? {'Authorization': 'Bearer '+TOKEN} : {}) }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw data;
  return data;
}

function normSprint(s) {
  return {
    ...s,
    id: String(s.id),
    start: s.start_date !== undefined ? s.start_date : s.start,
    end:   s.end_date   !== undefined ? s.end_date   : s.end,
    velocityPlanned:  s.velocity_planned  !== undefined ? s.velocity_planned  : (s.velocityPlanned||0),
    velocityCurrent:  s.velocity_current  !== undefined ? s.velocity_current  : s.velocityCurrent,
    velocityActual:   s.velocity_actual   !== undefined ? s.velocity_actual   : s.velocityActual,
    objectives: Array.isArray(s.objectives) ? s.objectives : JSON.parse(s.objectives||'[]'),
    closed: !!s.closed
  };
}

function normLeave(l) {
  return { ...l, id: String(l.id), memberId: String(l.memberId) };
}

async function loadAll() {
  const [team, sprints, leaves, config] = await Promise.all([
    api('GET','/team'), api('GET','/sprints'), api('GET','/leaves'), api('GET','/config')
  ]);
  STORE.team    = team.map(m=>({...m, id:String(m.id)}));
  STORE.sprints = sprints.map(normSprint);
  STORE.leaves  = leaves.map(normLeave);
  STORE.vel_grid = config.vel_grid || STORE.vel_grid;
  STORE.mtg_grid = config.mtg_grid || STORE.mtg_grid;
  if (CU?.role === 'admin') {
    try { const u=await api('GET','/users'); STORE.users=u.map(x=>({...x,id:String(x.id)})); } catch {}
  }
}

// ── STATE ────────────────────────────────────────────────
let CU=null; // current user
let calDate=new Date();
let editSprintId=null,closeSprintId=null,sprintStars=0,tmpObjs=[];
let editMemberId=null,dragSrc=null;
let charts={};

// ── AUTH ─────────────────────────────────────────────────
function switchAuthTab(t){
  document.querySelectorAll('.auth-tab').forEach((el,i)=>el.classList.toggle('active',i===(t==='login'?0:1)));
  document.getElementById('login-form').style.display=t==='login'?'':'none';
  document.getElementById('register-form').style.display=t==='register'?'':'none';
}
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pwd=document.getElementById('login-pwd').value;
  const err=document.getElementById('login-error');
  err.style.display='none';
  try {
    const {token,user}=await api('POST','/auth/login',{email,pwd});
    _ls.setToken(token);
    await loginOk(user);
  } catch { err.style.display='block'; }
}
async function doRegister(){
  const fname=document.getElementById('reg-fname').value.trim();
  const lname=document.getElementById('reg-lname').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pwd=document.getElementById('reg-pwd').value;
  const err=document.getElementById('reg-error');
  if(!fname||!lname||!email||!pwd){err.textContent='Remplissez tous les champs.';err.style.display='block';return;}
  if(pwd.length<6){err.textContent='Mot de passe trop court.';err.style.display='block';return;}
  try {
    const {token,user}=await api('POST','/auth/register',{fname,lname,email,pwd});
    _ls.setToken(token);
    await loginOk(user);
    toast('Bienvenue 🐝','success');
  } catch(e){ err.textContent=e.error||'Erreur serveur.';err.style.display='block'; }
}
async function loginOk(u){
  CU=u;
  await loadAll();
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  const ini=(u.fname[0]||'')+(u.lname[0]||'');
  document.getElementById('sidebar-avatar').textContent=ini.toUpperCase();
  document.getElementById('sidebar-name').textContent=u.fname+' '+u.lname;
  document.getElementById('sidebar-role').textContent=u.role==='admin'?'Administrateur':'Consultant';
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=u.role==='admin'?'':'none');
  navTo('dashboard');
}
function doLogout(){CU=null;_ls.setToken(null);document.getElementById('app').style.display='none';document.getElementById('auth-screen').style.display='flex';}
function openPwdModal(){['pwd-cur','pwd-new','pwd-cf'].forEach(id=>document.getElementById(id).value='');document.getElementById('pwd-err').style.display='none';document.getElementById('modal-pwd').classList.add('open');}
async function savePwd(){
  const cur=document.getElementById('pwd-cur').value;
  const nw=document.getElementById('pwd-new').value;
  const cf=document.getElementById('pwd-cf').value;
  const err=document.getElementById('pwd-err');
  if(nw.length<6){err.textContent='Min. 6 caractères.';err.style.display='block';return;}
  if(nw!==cf){err.textContent='Ne correspondent pas.';err.style.display='block';return;}
  try {
    await api('PUT','/auth/password',{current:cur,next:nw});
    closeModal('modal-pwd');toast('Mot de passe mis à jour ✓','success');
  } catch(e){ err.textContent=e.error||'Erreur serveur.';err.style.display='block'; }
}

// ── NAV ──────────────────────────────────────────────────
function navTo(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p)?.classList.add('active');
  document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll(`[onclick="navTo('${p}')"]`).forEach(x=>x.classList.add('active'));
  if(p==='dashboard')renderDash();
  if(p==='agenda')renderAgenda();
  if(p==='sprints')renderSprints();
  if(p==='charts')renderCharts();
  if(p==='settings')renderSettings();
  if(p==='users')renderUsers();
}

// ── THEME ────────────────────────────────────────────────
function setTheme(t){
  document.body.setAttribute('data-theme',t);_ls.setTheme(t);
  document.querySelectorAll('[data-theme]:not(body)').forEach(el=>el.classList.toggle('active',el.getAttribute('data-theme')===t));
}
function applyMode(){document.body.setAttribute('data-mode',window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}

// ── HOLIDAYS ─────────────────────────────────────────────
function holidays(year){
  // Algorithme de Meeus/Jones/Butcher pour Pâques
  const a=year%19;
  const b=Math.floor(year/100);
  const c=year%100;
  const d=Math.floor(b/4);
  const e=b%4;
  const f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4);
  const k=c%4;
  const l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const easterMonth=Math.floor((h+l-7*m+114)/31); // 1-based
  const easterDay=((h+l-7*m+114)%31)+1;
  const easter=new Date(year, easterMonth-1, easterDay);

  const add=(dt,n)=>{ const r=new Date(dt); r.setDate(r.getDate()+n); return r; };
  const fmt=dt=>toDS(dt); // utilise toDS() local = pas d'UTC

  return new Set([
    fmt(new Date(year,0,1)),           // Jour de l'an       1 jan
    fmt(add(easter,1)),                // Lundi de Pâques
    fmt(new Date(year,4,1)),           // Fête du Travail    1 mai
    fmt(new Date(year,4,8)),           // Victoire 1945      8 mai
    fmt(add(easter,39)),               // Ascension
    fmt(add(easter,50)),               // Lundi de Pentecôte
    fmt(new Date(year,6,14)),          // Fête Nationale    14 juil
    fmt(new Date(year,7,15)),          // Assomption        15 août
    fmt(new Date(year,10,1)),          // Toussaint          1 nov
    fmt(new Date(year,10,11)),         // Armistice         11 nov
    fmt(new Date(year,11,25)),         // Noël              25 déc
  ]);
}

// ── CAPACITY ─────────────────────────────────────────────
const r2=v=>Math.round(v*100)/100;
function dayH(dt){return dt.getDay()===5?7:8;}

function calcCap(member,start,end,leaves){
  const vg=STORE.vel_grid;
  const startDt=parseDate(start),endDt=parseDate(end);
  const hols=holidays(startDt.getFullYear());
  if(startDt.getFullYear()!==endDt.getFullYear())
    holidays(endDt.getFullYear()).forEach(x=>hols.add(x));
  const mLeaves=leaves.filter(l=>l.memberId===member.id);
  let totH=0,lvH=0;
  let d=new Date(startDt);
  while(d<=endDt){
    const dow=d.getDay();
    if(dow>0&&dow<6){
      const ds=toDS(d);
      if(!hols.has(ds)){
        const h=dayH(d);totH+=h;
        const lv=mLeaves.find(l=>l.date===ds);
        if(lv) lvH+=(lv.type==='full'?h:h/2);
      }
    }
    d.setDate(d.getDate()+1);
  }
  const avail=totH-lvH;
  const mtgH=avail*(member.meetings||20)/100;
  const prodH=(avail-mtgH)*((vg[member.level]||85)/100)*(((member.know||70)+(member.adapt||80))/200);
  return {totD:r2(totH/8),availD:r2(avail/8),mtgD:r2(mtgH/8),prodD:r2(prodH/8)};
}

// ── DASHBOARD ────────────────────────────────────────────
const RL={dev:'Développeur',tech_lead:'Tech Lead',qa:'QA',squad_lead:'Squad Lead',po:'PO'};
const LB={alternant:'badge-warning',junior:'badge-primary',intermediaire:'badge-success',senior:'badge-success'};

function renderDash(){
  const sprints=STORE.sprints,team=STORE.team,leaves=STORE.leaves;
  const now=new Date();
  const cur=sprints.find(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now)
    ||sprints.filter(s=>!s.closed).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];
  document.getElementById('dash-sprint-label').textContent=cur?`${cur.name} · ${fd(cur.start)} → ${fd(cur.end)}`:'Aucun sprint actif';
  const devs=team.filter(m=>m.role==='dev'||m.role==='tech_lead');
  let totA=0,totP=0;
  if(cur)devs.forEach(m=>{const c=calcCap(m,cur.start,cur.end,leaves);totA+=c.availD;totP+=c.prodD;});
  const dLeft=cur?Math.max(0,Math.ceil((new Date(cur.end)-now)/86400000)):0;
  document.getElementById('dash-stats').innerHTML=`
    <div class="card stat-card"><div class="stat-value">${devs.length}</div><div class="stat-label">Développeurs</div><div class="stat-sub">${team.length} membres total</div></div>
    <div class="card stat-card"><div class="stat-value">${r2(totP)}j</div><div class="stat-label">Capacité productive</div><div class="stat-sub">sur ${r2(totA)}j disponibles</div></div>
    <div class="card stat-card"><div class="stat-value">${cur?.velocityPlanned||'—'}</div><div class="stat-label">Points planifiés</div><div class="stat-sub">Vélocité cible</div></div>
    <div class="card stat-card"><div class="stat-value">${dLeft}</div><div class="stat-label">Jours restants</div><div class="stat-sub">${cur?.name||'—'}</div></div>`;
  document.getElementById('dash-cap').innerHTML=!cur||devs.length===0
    ?'<p style="color:var(--text3);font-size:13px">Configurez l\'équipe et un sprint</p>'
    :devs.map(m=>{const c=calcCap(m,cur.start,cur.end,leaves);const pct=Math.round(c.prodD/Math.max(.01,c.totD)*100);
      return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span style="font-weight:600">${m.fname} ${m.lname} <span class="badge ${LB[m.level]||'badge-primary'}" style="font-size:10px">${m.level}</span></span>
        <span style="color:var(--text3)">${c.prodD}j prod / ${c.availD}j dispo / ${c.totD}j bruts</span></div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">${c.mtgD}j réunions · ${RL[m.role]||m.role}</div></div>`;}).join('');
  const objs=cur?.objectives||[];
  document.getElementById('dash-obj').innerHTML=!cur?'<p style="color:var(--text3);font-size:13px">Aucun sprint actif</p>'
    :objs.length===0?'<p style="color:var(--text3);font-size:13px">Aucun objectif</p>'
    :objs.map(o=>`<div class="objective-item"><div class="checkbox ${o.done?'checked':''}"></div><span style="font-size:13px;${o.done?'text-decoration:line-through;color:var(--text3)':''}">${o.text}</span></div>`).join('');
  document.getElementById('dash-team').innerHTML=team.length===0
    ?'<p style="color:var(--text3);font-size:13px;grid-column:span 3">Aucun membre</p>'
    :team.map((m,i)=>`<div class="member-card">
      <div class="member-avatar" style="background:${mc(i)}">${(m.fname[0]||'')+(m.lname[0]||'')}</div>
      <div class="member-info"><div class="member-name">${m.fname} ${m.lname}</div><div class="member-meta">${RL[m.role]||m.role} · ${m.meetings||20}% réun.</div></div>
      ${cur&&(m.role==='dev'||m.role==='tech_lead')?`<div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:700;color:var(--primary)">${calcCap(m,cur.start,cur.end,leaves).prodD}j</div><div style="font-size:10px;color:var(--text3)">prod.</div></div>`:''}
    </div>`).join('');
}

// Parse 'YYYY-MM-DD' en date locale (évite le décalage UTC)
function parseDate(ds){ const [y,m,d]=ds.split('-').map(Number); return new Date(y,m-1,d); }
// Formater une date locale en 'YYYY-MM-DD'
function toDS(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
function showConfirm(msg, onOk, title='Confirmation'){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  const btn=document.getElementById('confirm-ok-btn');
  const fresh=btn.cloneNode(true); // remove old listeners
  btn.parentNode.replaceChild(fresh,btn);
  fresh.addEventListener('click',()=>{closeModal('modal-confirm');onOk();});
  document.getElementById('modal-confirm').classList.add('open');
}

// ── AGENDA ───────────────────────────────────────────────
// leaves format: {id, memberId, date:'YYYY-MM-DD', type:'full'|'am'|'pm', reason}

function renderAgenda(){
  const leaves=STORE.leaves;
  const team=STORE.team;
  const yr=calDate.getFullYear(),mo=calDate.getMonth();
  const hols=holidays(yr);
  const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('plan-label').textContent=`${MONTHS[mo]} ${yr}`;
  const dim=new Date(yr,mo+1,0).getDate();
  // today en local, pas en UTC
  const todayStr=toDS(new Date());
  const isAdmin=CU.role==='admin';

  const days=[];
  for(let d=1;d<=dim;d++){
    const dt=new Date(yr,mo,d);
    days.push({d,dt,ds:toDS(dt),dow:dt.getDay()});
  }

  // THEAD
  let html='<thead><tr><th class="th-member">Membre</th>';
  days.forEach(({d,dow,ds})=>{
    const isWe=dow===0||dow===6,isHol=hols.has(ds),isTod=ds===todayStr;
    const dayN=['D','L','M','M','J','V','S'][dow];
    let cls='',sty='';
    if(isTod) cls=' th-today';
    else if(isWe) sty='opacity:.35;';
    else if(isHol) sty='color:var(--warning);';
    html+=`<th class="${cls}" style="${sty}" id="thd-${ds}">${d}<br><span style="font-size:9px">${dayN}</span></th>`;
  });
  html+='</tr></thead><tbody>';

  // TBODY
  team.forEach((m,mi)=>{
    const canEdit=isAdmin||(m.email===CU.email);
    html+=`<tr><td class="td-member"><div style="display:flex;align-items:center;gap:8px;width:100%">
      <div style="width:22px;height:22px;border-radius:50%;background:${mc(mi)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${m.fname[0]||''}</div>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.fname} ${m.lname}</span>
    </div></td>`;
    days.forEach(({ds,dow})=>{
      const isWe=dow===0||dow===6,isHol=hols.has(ds),isTod=ds===todayStr;
      const state=leaveState(leaves,m.id,ds);
      const amCls=state==='full'||state==='am'?'leave':'free';
      const pmCls=state==='full'||state==='pm'?'leave':'free';
      let tdCls='';
      if(isTod&&!isWe&&!isHol) tdCls=' td-today';
      else if(isWe) tdCls=' td-we';
      else if(isHol) tdCls=' td-hol';
      let dcCls='dcell';
      if(isWe||isHol) dcCls+=' disabled';
      if(isTod&&!isWe&&!isHol) dcCls+=' dcell-today';
      const dataAttrs=canEdit&&!isWe&&!isHol?`data-mid="${m.id}" data-ds="${ds}" data-state="${state||''}"`:'';
      html+=`<td class="${tdCls}"><div class="${dcCls}" ${dataAttrs}>
        <div class="h ${amCls}">${amCls==='leave'?'▪':''}</div>
        <div class="h ${pmCls}">${pmCls==='leave'?'▪':''}</div>
      </div></td>`;
    });
    html+=`</tr>`;
  });
  html+='</tbody>';
  document.getElementById('plan-table').innerHTML=html;

  // Event delegation — recréer sur un nœud frais évite l'accumulation
  const tbl=document.getElementById('plan-table');
  // Clone pour vider tous les anciens listeners
  const fresh=tbl.cloneNode(true);
  tbl.parentNode.replaceChild(fresh,tbl);
  fresh.addEventListener('click',ev=>{
    const cell=ev.target.closest('.dcell[data-mid]');
    if(!cell)return;
    const mid=cell.dataset.mid,ds=cell.dataset.ds,state=cell.dataset.state||null;
    setLeave(mid,ds,state==='full'?null:'full');
  });
  fresh.addEventListener('contextmenu',ev=>{
    const cell=ev.target.closest('.dcell[data-mid]');
    if(!cell)return;
    const mid=cell.dataset.mid,ds=cell.dataset.ds,state=cell.dataset.state||null;
    showCtx(ev,mid,ds,state);
  });

  // Scroll to today
  const isCurMo=new Date().getFullYear()===yr&&new Date().getMonth()===mo;
  if(isCurMo){
    requestAnimationFrame(()=>{
      const th=document.getElementById(`thd-${todayStr}`);
      const scr=document.getElementById('plan-scroll');
      if(th&&scr) scr.scrollLeft=Math.max(0,th.offsetLeft-170);
    });
  }

  renderLeaveList(leaves,team);
}

// Group consecutive leaves per member into periods
function groupLeaves(leaves,team){
  const groups=[];
  team.forEach(m=>{
    const mLeaves=leaves.filter(l=>l.memberId===m.id).sort((a,b)=>a.date>b.date?1:-1);
    if(!mLeaves.length)return;
    // group by consecutive dates AND same type
    let cur=null;
    mLeaves.forEach(l=>{
      if(cur && l.type===cur.type){
        // check if l.date is next working day after cur.endDate
        const prev=new Date(cur.endDate);
        const next=new Date(l.date);
        // allow gaps of weekends/holidays (diff <= 3 days)
        const diffDays=(next-prev)/86400000;
        if(diffDays<=3){cur.endDate=l.date;cur.ids.push(l.id);return;}
      }
      cur={memberId:m.id,member:m,startDate:l.date,endDate:l.date,type:l.type,reason:l.reason,ids:[l.id]};
      groups.push(cur);
    });
  });
  return groups;
}

function renderLeaveList(leaves,team){
  const isAdmin=CU.role==='admin';
  const tl={full:'Journée',am:'Matin',pm:'Après-midi'};
  const myLeaves=isAdmin?leaves:leaves.filter(l=>{
    const me=team.find(m=>m.email===CU.email);return me&&l.memberId===me.id;
  });
  const el=document.getElementById('leave-list');if(!el)return;
  if(myLeaves.length===0){el.innerHTML='<p style="color:var(--text3);font-size:13px">Aucun congé enregistré</p>';return;}

  const groups=groupLeaves(myLeaves,team);
  // Store groups in a map for safe deletion
  window._leaveGroups={};
  el.innerHTML=groups.sort((a,b)=>a.startDate>b.startDate?1:-1).map((g,gi)=>{
    window._leaveGroups[gi]=g.ids;
    const idx=team.findIndex(t=>t.id===g.memberId);
    const isSameDay=g.startDate===g.endDate;
    const canDel=isAdmin||(team.find(t=>t.email===CU.email)?.id===g.memberId);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--divider)">
      <div style="width:32px;height:32px;border-radius:50%;background:${mc(idx>=0?idx:0)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">${g.member?.fname[0]||'?'}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${g.member?g.member.fname+' '+g.member.lname:'?'}</div>
        <div style="font-size:12px;color:var(--text3)">
          ${isSameDay?fd(g.startDate):fd(g.startDate)+' → '+fd(g.endDate)}
          · <span class="badge badge-danger" style="font-size:10px">${tl[g.type]||g.type}</span>
          ${g.reason?' · '+g.reason:''}
        </div>
      </div>
      ${canDel?`<button class="icon-btn leave-del-btn" data-gi="${gi}" title="Supprimer cette période">
        <span class="material-icons-round" style="font-size:18px;color:var(--danger)">delete</span>
      </button>`:''}
    </div>`;
  }).join('');

  // Bind delete buttons safely — no inline JS
  el.querySelectorAll('.leave-del-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const ids=window._leaveGroups[btn.dataset.gi];
      showConfirm(
        `Supprimer cette période (${ids.length} jour${ids.length>1?'s':''}) ?`,
        async ()=>{
          try {
            await api('DELETE','/leaves',{ids});
            STORE.leaves=STORE.leaves.filter(l=>!ids.includes(l.id));
            renderAgenda();toast('Période supprimée ✓','success');
          } catch(e){ toast(e.error||'Erreur','error'); }
        },
        'Supprimer le congé'
      );
    });
  });
}

function delLeavePeriod(idsJson){
  const ids=JSON.parse(idsJson);
  showConfirm(
    `Supprimer cette période (${ids.length} jour${ids.length>1?'s':''}) ?`,
    async ()=>{
      try {
        await api('DELETE','/leaves',{ids});
        STORE.leaves=STORE.leaves.filter(l=>!ids.includes(l.id));
        renderAgenda();toast('Période supprimée ✓','success');
      } catch(e){ toast(e.error||'Erreur','error'); }
    },
    'Supprimer le congé'
  );
}

function leaveState(leaves,memberId,ds){
  return (leaves.find(l=>l.memberId===memberId&&l.date===ds)||{}).type||null;
}
async function setLeave(memberId,ds,type){
  try {
    if(type) {
      await api('POST','/leaves',{memberId,date:ds,type,reason:''});
    } else {
      const existing=STORE.leaves.find(l=>l.memberId===memberId&&l.date===ds);
      if(existing) await api('DELETE','/leaves',{ids:[existing.id]});
    }
    const leaves=await api('GET','/leaves');
    STORE.leaves=leaves.map(normLeave);
    renderAgenda();
  } catch(e){ toast(e.error||'Erreur','error'); }
}

// Context menu
let _ctx=null;
function hideCtx(){if(_ctx){_ctx.remove();_ctx=null;}}
document.addEventListener('click',hideCtx);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideCtx();});
function showCtx(e,memberId,ds,state){
  e.preventDefault();e.stopPropagation();hideCtx();
  const actions=[];
  if(state!=='full') actions.push({icon:'wb_sunny',label:'Journée complète',fn:()=>setLeave(memberId,ds,'full')});
  if(state!=='am')   actions.push({icon:'light_mode',label:'Matin uniquement',fn:()=>setLeave(memberId,ds,'am')});
  if(state!=='pm')   actions.push({icon:'nights_stay',label:'Après-midi uniquement',fn:()=>setLeave(memberId,ds,'pm')});
  if(state) actions.push(null,{icon:'close',label:'Retirer le congé',fn:()=>setLeave(memberId,ds,null),danger:true});
  const m=document.createElement('div');m.id='ctx';
  m.innerHTML=actions.map(a=>a===null?'<div class="ctx-sep"></div>'
    :`<div class="ctx-item${a.danger?' ctx-danger':''}"><span class="material-icons-round">${a.icon}</span>${a.label}</div>`).join('');
  document.body.appendChild(m);_ctx=m;
  let ai=0;
  m.querySelectorAll('.ctx-item').forEach(el=>{
    while(actions[ai]===null)ai++;
    const fn=actions[ai++].fn;
    el.addEventListener('click',ev=>{ev.stopPropagation();fn();hideCtx();});
  });
  m.style.left=e.clientX+'px';m.style.top=e.clientY+'px';
  requestAnimationFrame(()=>{
    const r=m.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight;
    if(r.right>vw-8)m.style.left=(e.clientX-r.width)+'px';
    if(r.bottom>vh-8)m.style.top=(e.clientY-r.height)+'px';
  });
}

function calPrev(){calDate.setMonth(calDate.getMonth()-1);renderAgenda();}
function calNext(){calDate.setMonth(calDate.getMonth()+1);renderAgenda();}

function openLeaveModal(){
  const team=STORE.team,isAdmin=CU.role==='admin';
  const sel=document.getElementById('lm-user');sel.disabled=false;
  if(isAdmin) sel.innerHTML=team.map(m=>`<option value="${m.id}">${m.fname} ${m.lname}</option>`).join('');
  else{const me=team.find(m=>m.email===CU.email);sel.innerHTML=me?`<option value="${me.id}">${me.fname} ${me.lname}</option>`:'<option>—</option>';sel.disabled=!me;}
  ['lm-start','lm-end','lm-reason'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('lm-type').value='full';
  document.getElementById('modal-leave').classList.add('open');
}
async function saveLeave(){
  const memberId=document.getElementById('lm-user').value;
  const start=document.getElementById('lm-start').value;
  const end=document.getElementById('lm-end').value||start;
  const type=document.getElementById('lm-type').value;
  const reason=document.getElementById('lm-reason').value;
  if(!memberId||!start){toast('Champs obligatoires manquants','error');return;}
  if(parseDate(end)<parseDate(start)){toast('Date de fin invalide','error');return;}
  const hols=holidays(parseDate(start).getFullYear());
  try {
    const calls=[];
    let d=parseDate(start);const eD=parseDate(end);
    while(d<=eD){
      const dow=d.getDay(),ds=toDS(d);
      if(dow>0&&dow<6&&!hols.has(ds)) calls.push(api('POST','/leaves',{memberId,date:ds,type,reason}));
      d.setDate(d.getDate()+1);
    }
    await Promise.all(calls);
    const leaves=await api('GET','/leaves');
    STORE.leaves=leaves.map(normLeave);
    closeModal('modal-leave');toast('Congé enregistré ✓','success');renderAgenda();
  } catch(e){ toast(e.error||'Erreur','error'); }
}
async function delLeave(id){
  try {
    await api('DELETE','/leaves',{ids:[id]});
    STORE.leaves=STORE.leaves.filter(l=>l.id!==id);
    renderAgenda();toast('Congé supprimé','success');
  } catch(e){ toast(e.error||'Erreur','error'); }
}
function renderSprints(){
  const sprints=[...STORE.sprints].sort((a,b)=>new Date(b.start)-new Date(a.start));
  const now=new Date(),isAdmin=CU.role==='admin';
  document.getElementById('sprints-list').innerHTML=sprints.length===0
    ?'<div class="card" style="text-align:center;color:var(--text3);padding:48px">Aucun sprint créé</div>'
    :'<div class="timeline">'+sprints.map(s=>{
      const started=new Date(s.start)<=now,ended=new Date(s.end)<now;
      let tl='tl-item';if(s.closed)tl+=' done';else if(started&&!ended)tl+=' current';
      const objs=s.objectives||[],dO=objs.filter(o=>o.done).length;
      const stars=Array(5).fill(0).map((_,i)=>`<span class="material-icons-round conf-star ${i<(s.confidence||0)?'':'empty'}" style="font-size:14px">${i<(s.confidence||0)?'star':'star_border'}</span>`).join('');
      return `<div class="${tl}"><div class="sprint-card" style="margin-bottom:16px">
        <div class="sprint-card-header">
          <div>
            <div class="sprint-name">${s.name}</div>
            <div class="sprint-dates">${fd(s.start)} → ${fd(s.end)}</div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="badge ${s.closed?'badge-success':started?'badge-warning':'badge-primary'}">${s.closed?'Terminé':started?'En cours':'Planifié'}</span>
              <div>${stars}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            ${isAdmin&&!s.closed?`<button class="btn btn-outline btn-sm" onclick="openSprintModal('${s.id}')"><span class="material-icons-round">edit</span></button>`:''}
            ${isAdmin&&!s.closed&&started?`<button class="btn btn-filled btn-sm" onclick="openCloseModal('${s.id}')"><span class="material-icons-round">check</span>Clôturer</button>`:''}
            ${isAdmin?`<button class="btn btn-danger btn-sm" onclick="delSprint('${s.id}')"><span class="material-icons-round">delete</span></button>`:''}
          </div>
        </div>
        <div class="sprint-card-body">
          <div class="grid-3" style="gap:12px;margin-bottom:${objs.length?12:0}px">
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Planifié</div><div style="font-size:22px;font-weight:700;color:var(--primary)">${s.velocityPlanned||'—'} pts</div></div>
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">En cours</div>
              ${isAdmin&&!s.closed
                ?`<div style="display:flex;align-items:center;gap:6px"><input type="number" style="width:80px;padding:6px 10px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-weight:600;font-family:inherit;outline:none;text-align:center" value="${s.velocityCurrent||''}" placeholder="0" onchange="updateCurVel('${s.id}',this.value)"><span style="font-size:13px;color:var(--text3)">pts</span></div>`
                :`<div style="font-size:22px;font-weight:700;color:var(--warning)">${s.velocityCurrent||'—'}${s.velocityCurrent?' pts':''}</div>`}
            </div>
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Réalisé</div><div style="font-size:22px;font-weight:700;color:${s.velocityActual?'var(--success)':'var(--text3)'}">${s.velocityActual||'—'}${s.velocityActual?' pts':''}</div></div>
          </div>
          ${objs.length?`<div style="font-size:12px;color:var(--text3);margin-bottom:8px;font-weight:600">${dO}/${objs.length} objectifs</div>${objs.map(o=>`<div class="objective-item"><div class="checkbox ${o.done?'checked':''}"></div><span style="font-size:13px;${o.done?'text-decoration:line-through;color:var(--text3)':''}">${o.text}</span></div>`).join('')}`:''}
        </div>
      </div></div>`;}).join('')+'</div>';
}
async function updateCurVel(id,v){
  const i=STORE.sprints.findIndex(x=>x.id===id);
  if(i<0)return;
  const s=STORE.sprints[i];
  try {
    await api('PUT',`/sprints/${id}`,{name:s.name,start:s.start,end:s.end,velocityPlanned:s.velocityPlanned,velocityCurrent:Number(v),velocityActual:s.velocityActual,confidence:s.confidence,objectives:s.objectives,closed:s.closed});
    STORE.sprints[i].velocityCurrent=Number(v);
  } catch(e){ toast(e.error||'Erreur','error'); }
}
function openSprintModal(id=null){
  editSprintId=id;sprintStars=0;tmpObjs=[];
  const s=id?STORE.sprints.find(x=>x.id===id):null;
  document.getElementById('sprint-modal-title').textContent=id?'Modifier le sprint':'Nouveau sprint';
  document.getElementById('sm-name').value=s?.name||'';
  document.getElementById('sm-start').value=s?.start||'';
  document.getElementById('sm-end').value=s?.end||'';
  document.getElementById('sm-vel').value=s?.velocityPlanned||'';
  if(s?.objectives)tmpObjs=[...s.objectives];
  if(s?.confidence){sprintStars=s.confidence;}
  updateStars();renderTmpObjs();
  document.getElementById('modal-sprint').classList.add('open');
}
function setStar(v){sprintStars=v;updateStars();}
function updateStars(){document.querySelectorAll('#sm-stars .star').forEach((s,i)=>s.classList.toggle('filled',i<sprintStars));}
function addObj(){const v=document.getElementById('sm-obj-in').value.trim();if(!v)return;tmpObjs.push({id:'o'+Date.now(),text:v,done:false});document.getElementById('sm-obj-in').value='';renderTmpObjs();}
function renderTmpObjs(){document.getElementById('sm-objs').innerHTML=tmpObjs.map((o,i)=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="flex:1;font-size:13px">${o.text}</span><button class="icon-btn" onclick="tmpObjs.splice(${i},1);renderTmpObjs()"><span class="material-icons-round" style="font-size:16px">close</span></button></div>`).join('');}
async function saveSprint(){
  const name=document.getElementById('sm-name').value.trim();
  const start=document.getElementById('sm-start').value;
  const end=document.getElementById('sm-end').value;
  const vp=Number(document.getElementById('sm-vel').value);
  if(!name||!start||!end){toast('Champs obligatoires manquants','error');return;}
  try {
    if(editSprintId){
      await api('PUT',`/sprints/${editSprintId}`,{name,start,end,velocityPlanned:vp,confidence:sprintStars,objectives:tmpObjs});
      const i=STORE.sprints.findIndex(x=>x.id===editSprintId);
      if(i>-1)STORE.sprints[i]={...STORE.sprints[i],name,start,end,velocityPlanned:vp,confidence:sprintStars,objectives:tmpObjs};
    } else {
      const r=await api('POST','/sprints',{name,start,end,velocityPlanned:vp,confidence:sprintStars,objectives:tmpObjs});
      STORE.sprints.push({id:String(r.id),name,start,end,velocityPlanned:vp,velocityCurrent:null,velocityActual:null,confidence:sprintStars,objectives:tmpObjs,closed:false});
    }
    closeModal('modal-sprint');toast('Sprint sauvegardé ✓','success');renderSprints();
  } catch(e){ toast(e.error||'Erreur serveur','error'); }
}
function delSprint(id){
  showConfirm('Supprimer ce sprint ?',async ()=>{
    try {
      await api('DELETE',`/sprints/${id}`);
      STORE.sprints=STORE.sprints.filter(s=>s.id!==id);
      renderSprints();toast('Sprint supprimé','success');
    } catch(e){ toast(e.error||'Erreur','error'); }
  },'Supprimer le sprint');
}
function openCloseModal(id){
  closeSprintId=id;
  const s=STORE.sprints.find(x=>x.id===id);
  document.getElementById('scm-vel').value=s?.velocityCurrent||s?.velocityActual||'';
  const objs=s?.objectives||[];
  document.getElementById('scm-objs').innerHTML=objs.map((o,i)=>`<div class="objective-item"><div class="checkbox ${o.done?'checked':''}" onclick="toggleCloseObj(${i})"></div><span style="font-size:13px">${o.text}</span></div>`).join('');
  document.getElementById('modal-close-sprint').classList.add('open');
}
async function toggleCloseObj(i){
  const idx=STORE.sprints.findIndex(x=>x.id===closeSprintId);
  if(idx>-1){
    STORE.sprints[idx].objectives[i].done=!STORE.sprints[idx].objectives[i].done;
    const s=STORE.sprints[idx];
    try {
      await api('PUT',`/sprints/${closeSprintId}`,{name:s.name,start:s.start,end:s.end,velocityPlanned:s.velocityPlanned,velocityCurrent:s.velocityCurrent,velocityActual:s.velocityActual,confidence:s.confidence,objectives:s.objectives,closed:s.closed});
    } catch(e){ toast(e.error||'Erreur','error'); }
  }
  document.querySelectorAll('#scm-objs .checkbox')[i]?.classList.toggle('checked');
}
async function doCloseSprint(){
  const va=Number(document.getElementById('scm-vel').value);
  const idx=STORE.sprints.findIndex(x=>x.id===closeSprintId);
  if(idx<0)return;
  const s=STORE.sprints[idx];
  try {
    await api('PUT',`/sprints/${closeSprintId}`,{name:s.name,start:s.start,end:s.end,velocityPlanned:s.velocityPlanned,velocityCurrent:s.velocityCurrent,velocityActual:va,confidence:s.confidence,objectives:s.objectives,closed:true});
    STORE.sprints[idx].velocityActual=va;STORE.sprints[idx].closed=true;
    closeModal('modal-close-sprint');toast('Sprint clôturé ✓','success');renderSprints();
  } catch(e){ toast(e.error||'Erreur','error'); }
}

// ── CHARTS ───────────────────────────────────────────────
function cv(v){return getComputedStyle(document.body).getPropertyValue(v).trim();}
function dChart(id,type,data,opts){if(charts[id]){charts[id].destroy();delete charts[id];}charts[id]=new Chart(document.getElementById(id),{type,data,options:opts});}
function renderCharts(){
  const sprints=[...STORE.sprints].sort((a,b)=>new Date(a.start)-new Date(b.start));
  const pr=cv('--primary'),sc=cv('--secondary'),t2=cv('--text2'),dv=cv('--divider'),ff='Inter,sans-serif';
  const base={responsive:true,maintainAspectRatio:false,
    plugins:{legend:{labels:{color:t2,font:{family:ff,size:11}}},tooltip:{backgroundColor:'rgba(0,0,0,0.8)',titleFont:{family:ff},bodyFont:{family:ff}}},
    scales:{x:{ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv}},y:{ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv},beginAtZero:true}}};
  const labels=sprints.map(s=>s.name);
  dChart('chart-velocity','bar',{labels,datasets:[
    {label:'Planifiée',data:sprints.map(s=>s.velocityPlanned||0),backgroundColor:pr+'55',borderColor:pr,borderWidth:2,borderRadius:8},
    {label:'Réalisée',data:sprints.map(s=>s.velocityActual||null),backgroundColor:sc+'55',borderColor:sc,borderWidth:2,borderRadius:8}
  ]},base);
  const gS=sprints.filter(s=>s.closed&&(s.objectives||[]).length>0);
  dChart('chart-goals','line',{labels:gS.map(s=>s.name),datasets:[{label:'% objectifs atteints',data:gS.map(s=>Math.round(s.objectives.filter(o=>o.done).length/s.objectives.length*100)),borderColor:pr,backgroundColor:pr+'20',fill:true,tension:0.4,pointBackgroundColor:pr,pointRadius:5}]},
    {...base,scales:{...base.scales,y:{...base.scales.y,max:100,ticks:{callback:v=>v+'%'}}}});
  const now=new Date(),cur=STORE.sprints.find(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now);
  if(cur){
    const st=new Date(cur.start),en=new Date(cur.end),tot=cur.velocityPlanned||0;
    const bL=[],id=[],rm=[];let d=new Date(st),total=0;
    let td=new Date(st);while(td<=en){if(td.getDay()>0&&td.getDay()<6)total++;td.setDate(td.getDate()+1);}
    let dn=0;d=new Date(st);
    while(d<=en){if(d.getDay()>0&&d.getDay()<6){bL.push(d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}));id.push(r2(tot*(1-dn/total)));rm.push(d<=now?r2(tot*(1-(dn/total)*0.9)):null);dn++;}d.setDate(d.getDate()+1);}
    dChart('chart-burndown','line',{labels:bL,datasets:[{label:'Idéal',data:id,borderColor:sc,borderDash:[5,5],fill:false,tension:0,pointRadius:0},{label:'Restant',data:rm,borderColor:pr,backgroundColor:pr+'20',fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:pr}]},base);
  } else dChart('chart-burndown','line',{labels:[],datasets:[]},base);
  const leaves=STORE.leaves,team=STORE.team,devs=team.filter(m=>m.role==='dev'||m.role==='tech_lead');
  const cP=[],cA=[];
  sprints.forEach(s=>{let tp=0;devs.forEach(m=>{tp+=calcCap(m,s.start,s.end,leaves).prodD;});cP.push(r2(tp));cA.push(s.velocityActual||null);});
  dChart('chart-capacity','bar',{labels,datasets:[
    {label:'Capacité (j)',data:cP,backgroundColor:pr+'44',borderColor:pr,borderWidth:2,borderRadius:8,yAxisID:'y'},
    {label:'Vélocité réalisée (pts)',data:cA,backgroundColor:sc+'44',borderColor:sc,borderWidth:2,borderRadius:8,yAxisID:'y1'}
  ]},{...base,scales:{x:{ticks:{color:t2},grid:{color:dv}},y:{type:'linear',position:'left',ticks:{color:t2},grid:{color:dv},beginAtZero:true},y1:{type:'linear',position:'right',ticks:{color:t2},grid:{drawOnChartArea:false},beginAtZero:true}}});
}

// ── SETTINGS ─────────────────────────────────────────────
const LV={alternant:'Alternant',junior:'Junior',intermediaire:'Intermédiaire',senior:'Senior'};
function renderSettings(){
  const team=STORE.team,vg=STORE.vel_grid,mg=STORE.mtg_grid;
  document.getElementById('team-list').innerHTML=team.length===0?'<p style="color:var(--text3);font-size:13px">Aucun membre</p>'
    :team.map((m,i)=>`<div class="member-card" style="margin-bottom:8px" draggable="true" data-idx="${i}"
      ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})" ondrop="dragDrop(event,${i})" ondragend="dragEnd(event)">
      <div class="drag-handle"><span class="material-icons-round" style="font-size:18px">drag_indicator</span></div>
      <div class="member-avatar" style="background:${mc(i)}">${(m.fname[0]||'')+(m.lname[0]||'')}</div>
      <div class="member-info"><div class="member-name">${m.fname} ${m.lname}</div><div class="member-meta">${RL[m.role]||m.role} · ${LV[m.level]||m.level} · ${m.meetings||20}% réun.</div></div>
      <div style="display:flex;gap:4px">
        <button class="icon-btn" onclick="openMemberModal('${m.id}')"><span class="material-icons-round">edit</span></button>
        <button class="icon-btn" onclick="delMember('${m.id}')"><span class="material-icons-round" style="color:var(--danger)">delete</span></button>
      </div></div>`).join('');
  document.getElementById('vel-grid').innerHTML=Object.entries(vg).map(([k,v])=>`<div class="velocity-item"><label>${LV[k]||k}</label><input type="number" class="input" id="vg-${k}" value="${v}" min="0" max="100" step="5"><div style="font-size:11px;color:var(--text3);margin-top:4px">% du potentiel</div></div>`).join('');
  document.getElementById('mtg-grid').innerHTML=Object.entries(mg).map(([k,v])=>`<div class="velocity-item"><label>${RL[k]||k}</label><input type="number" class="input" id="mg-${k}" value="${v}" min="0" max="100" step="5"><div style="font-size:11px;color:var(--text3);margin-top:4px">% du temps</div></div>`).join('');
}
function dragStart(e,i){dragSrc=i;e.currentTarget.classList.add('dragging');e.dataTransfer.effectAllowed='move';}
function dragOver(e,i){e.preventDefault();document.querySelectorAll('.member-card[data-idx]').forEach(el=>el.classList.remove('drag-over'));if(i!==dragSrc)e.currentTarget.classList.add('drag-over');}
async function dragDrop(e,i){
  e.preventDefault();
  if(dragSrc===null||dragSrc===i)return;
  const t=[...STORE.team];const[mv]=t.splice(dragSrc,1);t.splice(i,0,mv);
  try {
    await api('PUT','/team/reorder',{ids:t.map(m=>m.id)});
    STORE.team=t;dragSrc=null;renderSettings();toast('Ordre mis à jour ✓','success');
  } catch(e){ toast(e.error||'Erreur','error'); }
}
function dragEnd(e){e.currentTarget.classList.remove('dragging');document.querySelectorAll('.member-card').forEach(el=>el.classList.remove('drag-over'));}
async function saveVelGrid(){
  const keys=['alternant','junior','intermediaire','senior'],g={};
  keys.forEach(k=>{const el=document.getElementById('vg-'+k);if(el)g[k]=Number(el.value);});
  try { await api('PUT','/config/vel_grid',{value:g});STORE.vel_grid=g;toast('Grille sauvegardée ✓','success'); }
  catch(e){ toast(e.error||'Erreur','error'); }
}
async function saveMtgGrid(){
  const keys=['dev','tech_lead','qa','squad_lead','po'],g={};
  keys.forEach(k=>{const el=document.getElementById('mg-'+k);if(el)g[k]=Number(el.value);});
  try { await api('PUT','/config/mtg_grid',{value:g});STORE.mtg_grid=g;toast('Grille sauvegardée ✓','success'); }
  catch(e){ toast(e.error||'Erreur','error'); }
}
function openMemberModal(id=null){
  editMemberId=id;
  const mg=STORE.mtg_grid;
  const m=id?STORE.team.find(t=>t.id===id):null;
  document.getElementById('member-modal-title').textContent=id?'Modifier le membre':'Nouveau membre';
  document.getElementById('mm-fname').value=m?.fname||'';document.getElementById('mm-lname').value=m?.lname||'';
  document.getElementById('mm-role').value=m?.role||'dev';document.getElementById('mm-level').value=m?.level||'intermediaire';
  document.getElementById('mm-know').value=m?.know||70;document.getElementById('mm-adapt').value=m?.adapt||80;
  document.getElementById('mm-mtg').value=m?.meetings||(mg[m?.role||'dev']||20);
  document.getElementById('modal-member').classList.add('open');
}
async function saveMember(){
  const fname=document.getElementById('mm-fname').value.trim();
  const lname=document.getElementById('mm-lname').value.trim();
  if(!fname||!lname){toast('Prénom et nom obligatoires','error');return;}
  const obj={fname,lname,role:document.getElementById('mm-role').value,level:document.getElementById('mm-level').value,
    know:Number(document.getElementById('mm-know').value),adapt:Number(document.getElementById('mm-adapt').value),
    meetings:Number(document.getElementById('mm-mtg').value)};
  try {
    if(editMemberId){
      await api('PUT',`/team/${editMemberId}`,obj);
      const i=STORE.team.findIndex(t=>t.id===editMemberId);if(i>-1)STORE.team[i]={...STORE.team[i],...obj};
    } else {
      const m=await api('POST','/team',obj);
      STORE.team.push({...m,id:String(m.id)});
    }
    closeModal('modal-member');toast('Membre sauvegardé ✓','success');renderSettings();
  } catch(e){ toast(e.error||'Erreur','error'); }
}
function delMember(id){
  showConfirm('Supprimer ce membre de l\'équipe ?',async ()=>{
    try {
      await api('DELETE',`/team/${id}`);
      STORE.team=STORE.team.filter(t=>t.id!==id);
      renderSettings();toast('Membre supprimé','success');
    } catch(e){ toast(e.error||'Erreur','error'); }
  },'Supprimer le membre');
}

// ── USERS ────────────────────────────────────────────────
function renderUsers(){
  document.getElementById('users-tbody').innerHTML=STORE.users.map(u=>`<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar" style="width:28px;height:28px;font-size:11px">${(u.fname[0]||'')+(u.lname[0]||'')}</div><span>${u.fname} ${u.lname}</span></div></td>
    <td style="color:var(--text2)">${u.email}</td>
    <td><span class="badge ${u.role==='admin'?'badge-success':'badge-primary'}">${u.role==='admin'?'Admin':'Consultant'}</span></td>
    <td>${u.id!==CU.id?`<button class="btn btn-outline btn-sm" onclick="toggleRole('${u.id}')"><span class="material-icons-round" style="font-size:14px">swap_horiz</span>${u.role==='admin'?'→ Consultant':'→ Admin'}</button>`:'<span style="color:var(--text3);font-size:12px">Vous</span>'}</td>
  </tr>`).join('');
}
async function toggleRole(id){
  const i=STORE.users.findIndex(x=>x.id===id);if(i<0)return;
  const newRole=STORE.users[i].role==='admin'?'consultant':'admin';
  try {
    await api('PUT',`/users/${id}/role`,{role:newRole});
    STORE.users[i].role=newRole;renderUsers();toast('Rôle mis à jour ✓','success');
  } catch(e){ toast(e.error||'Erreur','error'); }
}

// ── UTILS ────────────────────────────────────────────────
function fd(ds){if(!ds)return '—';return new Date(ds).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function toast(msg,type='success'){
  const c=document.getElementById('toast-container'),t=document.createElement('div');
  t.className=`toast ${type}`;t.innerHTML=`<span class="material-icons-round ti">${type==='success'?'check_circle':'error'}</span>${msg}`;
  c.appendChild(t);setTimeout(()=>t.remove(),3000);
}

// ── CHART.JS ─────────────────────────────────────────────
function loadChartJS(){return new Promise(res=>{if(window.Chart){res();return;}const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';s.onload=res;document.head.appendChild(s);});}

// ── INIT ─────────────────────────────────────────────────
async function init(){
  applyMode();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyMode);
  setTheme(_ls.getTheme());
  await loadChartJS();
  if(TOKEN){
    try {
      // Décoder le payload JWT (pas de vérification côté client, juste pour afficher l'UI)
      const payload=JSON.parse(atob(TOKEN.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      CU={id:String(payload.id),fname:payload.fname,lname:payload.lname,email:payload.email,role:payload.role};
      await loadAll();
      document.getElementById('auth-screen').style.display='none';
      document.getElementById('app').style.display='flex';
      const ini=(CU.fname[0]||'')+(CU.lname[0]||'');
      document.getElementById('sidebar-avatar').textContent=ini.toUpperCase();
      document.getElementById('sidebar-name').textContent=CU.fname+' '+CU.lname;
      document.getElementById('sidebar-role').textContent=CU.role==='admin'?'Administrateur':'Consultant';
      document.querySelectorAll('.admin-only').forEach(el=>el.style.display=CU.role==='admin'?'':'none');
      navTo('dashboard');
    } catch {
      _ls.setToken(null);
    }
  }
}
init();
