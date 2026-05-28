// ── COLORS ──────────────────────────────────────────────
const COLORS=['#e91e63','#9c27b0','#3f51b5','#009688','#ff5722','#607d8b','#795548','#4caf50','#ff9800','#00bcd4'];
const mc=i=>COLORS[i%COLORS.length];

// ── API CLIENT ───────────────────────────────────────────
const API={
  async req(method,url,body){
    const opts={method,headers:{'Content-Type':'application/json'}};
    const t=localStorage.getItem('bcp_token');
    if(t)opts.headers['Authorization']='Bearer '+t;
    if(body!==undefined)opts.body=JSON.stringify(body);
    const r=await fetch(url,opts);
    const data=await r.json().catch(()=>({}));
    if(r.status===401){doLogout();throw{error:'Session expirée'};}
    if(!r.ok)throw data;
    return data;
  },
  get:url=>API.req('GET',url),
  post:(url,body)=>API.req('POST',url,body),
  put:(url,body)=>API.req('PUT',url,body),
  del:(url,body)=>API.req('DELETE',url,body),
};

// ── STATE ────────────────────────────────────────────────
const S={
  team:[],sprints:[],leaves:[],
  config:{vel_grid:{alternant:50,junior:70,intermediaire:85,senior:100},mtg_grid:{dev:15,tech_lead:35,qa:20,squad_lead:45,po:50}},
  users:[],teams:[],backlog:[],objectivesData:null,noTimespent:null
};
let selectedTeamId=null;

function normSprint(s){
  return{id:s.id,name:s.name,
    start:s.start_date||s.start,end:s.end_date||s.end,
    velocityPlanned:s.velocity_planned??s.velocityPlanned??0,
    velocityCurrent:s.velocity_current??s.velocityCurrent??null,
    velocityActual:s.velocity_actual??s.velocityActual??null,
    confidence:s.confidence||0,objectives:s.objectives||[],closed:!!s.closed,
    convergence:s.convergence??1};
}
async function loadTeam(){
  const q=selectedTeamId?`?teamId=${selectedTeamId}`:'';
  S.team=await API.get('/api/team'+q);
}
async function loadSprints(){
  const q=selectedTeamId?`?teamId=${selectedTeamId}`:'';
  S.sprints=(await API.get('/api/sprints'+q)).map(normSprint);
}
async function loadLeaves(){S.leaves=await API.get('/api/leaves');}
async function loadConfig(){const d=await API.get('/api/config');if(d.vel_grid)S.config.vel_grid=d.vel_grid;if(d.mtg_grid)S.config.mtg_grid=d.mtg_grid;}
async function loadUsers(){
  S.users=await API.get('/api/users');
  // Charger les équipes de chaque utilisateur
  await Promise.all(S.users.map(async u=>{
    try{u._teamIds=await API.get('/api/users/'+u.id+'/teams');}catch(e){u._teamIds=[];}
  }));
}
async function loadTeams(){S.teams=await API.get('/api/teams');}
async function loadBacklog(){if(selectedTeamId)S.backlog=await API.get('/api/backlog?teamId='+selectedTeamId+'&syncSprints=1');else S.backlog=[];}
async function loadNoTimespent(){if(selectedTeamId)S.noTimespent=await API.get('/api/jira/no-timespent?teamId='+selectedTeamId).catch(()=>null);else S.noTimespent=null;}

// ── ROUTING ──────────────────────────────────────────────
const BASE_PATH='/bobbeeCapacity/';
const PAGE_SLUGS={dashboard:'dashboard',charts:'chart',sprints:'sprints',backlog:'backlog',objectives:'objectives',roadmap:'roadmap',agenda:'planning',settings:'admin',users:'users'};
const SLUG_PAGES=Object.fromEntries(Object.entries(PAGE_SLUGS).map(([k,v])=>[v,k]));

// ── APP STATE ────────────────────────────────────────────
let CU=null;
let calDate=new Date();
let editSprintId=null,closeSprintId=null,sprintStars=0,tmpObjs=[];
let selectedSprintId=null;
let editMemberId=null,_modalTeams=[];
let charts={};

// ── AUTH ─────────────────────────────────────────────────
// ── TOGGLE PASSWORD VISIBILITY ───────────────────────────
function togglePwd(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  const icon = btn.querySelector('.material-icons-round');
  if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
}

// ── FORGOT / RESET PASSWORD ──────────────────────────────
function showLoginForm(){
  document.getElementById('login-form').style.display='block';
  document.getElementById('forgot-form').style.display='none';
  document.getElementById('reset-form').style.display='none';
  document.querySelector('.auth-tabs').style.display='flex';
  document.getElementById('forgot-email').value='';
  document.getElementById('forgot-error').style.display='none';
  document.getElementById('forgot-success').style.display='none';
}
function showForgotForm(){
  document.getElementById('login-form').style.display='none';
  document.getElementById('forgot-form').style.display='block';
  document.getElementById('reset-form').style.display='none';
  document.querySelector('.auth-tabs').style.display='none';
  setTimeout(()=>document.getElementById('forgot-email').focus(),80);
}
function showResetForm(){
  document.getElementById('login-form').style.display='none';
  document.getElementById('forgot-form').style.display='none';
  document.getElementById('reset-form').style.display='block';
  document.querySelector('.auth-tabs').style.display='none';
}
async function doForgot(){
  const email=document.getElementById('forgot-email').value.trim();
  const err=document.getElementById('forgot-error');
  const ok=document.getElementById('forgot-success');
  const btn=document.getElementById('forgot-btn');
  err.style.display='none'; ok.style.display='none';
  if(!email){err.textContent='Saisissez votre email.';err.style.display='block';return;}
  btn.disabled=true; btn.textContent='Envoi…';
  try{
    await API.post('/api/auth/forgot',{email});
    ok.style.display='block';
    btn.textContent='Email envoyé';
  }catch(e){
    err.textContent=e.error||'Erreur lors de l\'envoi. Vérifiez la configuration SMTP.';
    err.style.display='block';
    btn.disabled=false; btn.textContent='Envoyer le lien';
  }
}
function checkResetStrength(){
  const val=document.getElementById('reset-pwd').value;
  const fill=document.getElementById('pwd-strength-fill');
  const label=document.getElementById('pwd-strength-label');
  if(!fill||!label)return;
  let score=0;
  if(val.length>=6)score++;
  if(val.length>=10)score++;
  if(/[A-Z]/.test(val))score++;
  if(/[0-9]/.test(val))score++;
  if(/[^A-Za-z0-9]/.test(val))score++;
  const levels=[
    {pct:0,color:'transparent',txt:''},
    {pct:20,color:'var(--danger)',txt:'Très faible'},
    {pct:40,color:'#fb8c00',txt:'Faible'},
    {pct:60,color:'#fbc02d',txt:'Moyen'},
    {pct:80,color:'#7cb342',txt:'Fort'},
    {pct:100,color:'var(--success)',txt:'Très fort'},
  ];
  const l=levels[score]||levels[0];
  fill.style.width=l.pct+'%';
  fill.style.background=l.color;
  label.textContent=l.txt;
  label.style.color=l.color;
}
async function doReset(){
  const token=document.getElementById('reset-token-val')?.value||'';
  const pwd=document.getElementById('reset-pwd').value;
  const pwd2=document.getElementById('reset-pwd2').value;
  const err=document.getElementById('reset-error');
  const btn=document.getElementById('reset-btn');
  err.style.display='none';
  if(pwd.length<6){err.textContent='Le mot de passe doit faire au moins 6 caractères.';err.style.display='block';return;}
  if(pwd!==pwd2){err.textContent='Les mots de passe ne correspondent pas.';err.style.display='block';return;}
  btn.disabled=true; btn.textContent='Mise à jour…';
  try{
    const data=await API.post('/api/auth/reset',{token,pwd});
    localStorage.setItem('bcp_token',data.token);
    localStorage.setItem('bcp_user',JSON.stringify(data.user));
    // Nettoyer le token de l'URL
    history.replaceState({},'',BASE_PATH);
    loginOk(data.user);
    toast('Mot de passe mis à jour — bienvenue 🐝','success');
  }catch(e){
    err.textContent=e.error||'Lien invalide ou expiré.';
    err.style.display='block';
    btn.disabled=false; btn.textContent='Changer le mot de passe';
  }
}

async function switchAuthTab(t){
  document.querySelectorAll('.auth-tab').forEach((el,i)=>el.classList.toggle('active',i===(t==='login'?0:1)));
  document.getElementById('login-form').style.display=t==='login'?'block':'none';
  document.getElementById('register-form').style.display=t==='register'?'block':'none';
  if(t==='register'){
    try{
      const teams=await fetch('/api/teams/public').then(r=>r.json());
      const c=document.getElementById('reg-teams');
      if(c)c.innerHTML=teams.length===0?'<span style="color:var(--text3);font-size:12px">Aucune équipe disponible</span>'
        :teams.map(tm=>`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 8px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid var(--border);font-size:13px"><input type="checkbox" value="${tm.id}" style="accent-color:var(--primary)"> ${tm.name}</label>`).join('');
    }catch(e){}
  }
}
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pwd=document.getElementById('login-pwd').value;
  try{
    const data=await API.post('/api/auth/login',{email,pwd});
    localStorage.setItem('bcp_token',data.token);
    localStorage.setItem('bcp_user',JSON.stringify(data.user));
    document.getElementById('login-error').style.display='none';
    loginOk(data.user);
  }catch(e){document.getElementById('login-error').style.display='block';}
}
async function doRegister(){
  const fname=document.getElementById('reg-fname').value.trim();
  const lname=document.getElementById('reg-lname').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pwd=document.getElementById('reg-pwd').value;
  const err=document.getElementById('reg-error');
  if(!fname||!lname||!email||!pwd){err.textContent='Remplissez tous les champs.';err.style.display='block';return;}
  if(pwd.length<6){err.textContent='Mot de passe trop court.';err.style.display='block';return;}
  try{
    const boxes=document.querySelectorAll('#reg-teams input[type=checkbox]');
    const teamIds=[...boxes].filter(b=>b.checked).map(b=>Number(b.value));
    const data=await API.post('/api/auth/create',{fname,lname,email,pwd,teamIds});
    localStorage.setItem('bcp_token',data.token);
    localStorage.setItem('bcp_user',JSON.stringify(data.user));
    loginOk(data.user);toast('Bienvenue 🐝','success');
  }catch(e){err.textContent=e.error||'Erreur lors de la création.';err.style.display='block';}
}
async function loginOk(u){
  CU=u;
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  const ini=(u.fname[0]||'')+(u.lname[0]||'');
  document.getElementById('sidebar-avatar').textContent=ini.toUpperCase();
  document.getElementById('sidebar-name').textContent=u.fname+' '+u.lname;
  const roleLabel={super_admin:'Super Admin',admin:'Administrateur',consultant:'Consultant'};
  document.getElementById('sidebar-role').textContent=roleLabel[u.role]||'Consultant';
  const isA=['admin','super_admin'].includes(u.role);
  const isSA=u.role==='super_admin';
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isA?'':'none');
  document.querySelectorAll('.superadmin-only').forEach(el=>el.style.display=isSA?'':'none');
  await loadTeams();
  initTeamSel();
  // Déterminer la page cible depuis l'URL courante
  const _path=location.pathname.replace(BASE_PATH,'').replace(/\/$/,'');
  const _sp=new URLSearchParams(location.search);
  const _reqSlug=SLUG_PAGES[_path]?_path:(_sp.get('page')||'');
  const _targetPage=SLUG_PAGES[_reqSlug]||'dashboard';
  navTo(_targetPage);
}
function doLogout(){
  const _activePage=document.querySelector('.page.active')?.id?.replace('page-','');
  const _slug=_activePage&&_activePage!=='dashboard'?'?page='+(PAGE_SLUGS[_activePage]||_activePage):'';
  // bcp_team_<id> intentionnellement conservé : la préférence d'équipe survit au logout
  localStorage.removeItem('bcp_team'); // nettoyage ancienne clé
  localStorage.removeItem('bcp_sprint');
  CU=null;
  localStorage.removeItem('bcp_token');
  localStorage.removeItem('bcp_user');
  history.pushState({},'',BASE_PATH+'login'+_slug);
  document.getElementById('app').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
}
function openPwdModal(){['pwd-cur','pwd-new','pwd-cf'].forEach(id=>document.getElementById(id).value='');document.getElementById('pwd-err').style.display='none';document.getElementById('modal-pwd').classList.add('open');}
async function savePwd(){
  const cur=document.getElementById('pwd-cur').value;
  const nw=document.getElementById('pwd-new').value;
  const cf=document.getElementById('pwd-cf').value;
  const err=document.getElementById('pwd-err');
  if(nw.length<6){err.textContent='Min. 6 caractères.';err.style.display='block';return;}
  if(nw!==cf){err.textContent='Ne correspondent pas.';err.style.display='block';return;}
  try{
    await API.put('/api/auth/password',{current:cur,next:nw});
    closeModal('modal-pwd');toast('Mot de passe mis à jour ✓','success');
  }catch(e){err.textContent=e.error||'Mot de passe actuel incorrect.';err.style.display='block';}
}

// ── TEAM SELECTOR ───────────────────────────────────────
function teamStorageKey(){return `bcp_team_${CU?.id||'x'}`;}
function initTeamSel(){
  const el=document.getElementById('team-sel-sidebar');
  if(!S.teams.length){if(el)el.style.display='none';return;}
  const saved=localStorage.getItem(teamStorageKey());
  if(saved&&S.teams.find(t=>String(t.id)===saved)){
    // Restaurer la dernière sélection de cet utilisateur
    selectedTeamId=saved;
  } else {
    // Défaut : première équipe assignée à l'utilisateur, sinon première équipe de la liste
    const ownId=CU?.teamIds?.find(id=>S.teams.find(t=>String(t.id)===String(id)));
    selectedTeamId=ownId?String(ownId):String(S.teams[0].id);
    localStorage.setItem(teamStorageKey(),selectedTeamId);
  }
  if(el)el.style.display=S.teams.length>1?'block':'none';
  renderTeamSelector();
}
function renderTeamSelector(){
  const useSelect=CU?.role==='super_admin'||S.teams.length>2;
  const arrowRow=document.getElementById('tm-arrow-row');
  const selectRow=document.getElementById('tm-select-row');
  if(arrowRow)arrowRow.style.display=useSelect?'none':'flex';
  if(selectRow)selectRow.style.display=useSelect?'flex':'none';
  if(useSelect){
    const sel=document.getElementById('tm-select');
    if(sel){
      sel.innerHTML=S.teams.map(t=>`<option value="${t.id}" ${String(t.id)===String(selectedTeamId)?'selected':''}>${t.name}</option>`).join('');
      sel.value=String(selectedTeamId);
    }
  }else{
    const idx=S.teams.findIndex(t=>String(t.id)===String(selectedTeamId));
    const t=S.teams[idx];
    const nameEl=document.getElementById('tm-sel-name');
    const prevBtn=document.getElementById('tm-btn-prev');
    const nextBtn=document.getElementById('tm-btn-next');
    if(nameEl)nameEl.textContent=t?t.name:'—';
    if(prevBtn)prevBtn.style.visibility=idx>0?'visible':'hidden';
    if(nextBtn)nextBtn.style.visibility=idx<S.teams.length-1?'visible':'hidden';
  }
}
async function selectTeam(id){
  if(String(id)===String(selectedTeamId))return;
  selectedTeamId=String(id);
  localStorage.setItem(teamStorageKey(),selectedTeamId);
  renderTeamSelector();
  selectedSprintId=null;
  localStorage.removeItem('bcp_sprint');
  await Promise.all([loadTeam(),loadSprints(),loadLeaves(),loadBacklog()]);
  const activePage=document.querySelector('.page.active')?.id?.replace('page-','');
  if(activePage)navTo(activePage);
}
async function navTeam(dir){
  const idx=S.teams.findIndex(t=>String(t.id)===String(selectedTeamId));
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=S.teams.length)return;
  selectedTeamId=String(S.teams[newIdx].id);
  localStorage.setItem(teamStorageKey(),selectedTeamId);
  renderTeamSelector();
  selectedSprintId=null;
  localStorage.removeItem('bcp_sprint');
  await Promise.all([loadTeam(),loadSprints(),loadLeaves(),loadBacklog(),loadNoTimespent()]);
  initSprintSel();
  const activePage=document.querySelector('.page.active')?.id;
  if(activePage==='page-dashboard')renderDash();
  else if(activePage==='page-charts')renderCharts();
  else if(activePage==='page-sprints')renderSprints();
  else if(activePage==='page-agenda')renderAgenda();
  else if(activePage==='page-backlog'){renderBacklog();if(blActiveTab==='chrono'){const os=document.getElementById('bl-filter-obj');if(os){os.dataset.teamKey='';os.value='';}renderGantt();}}
  else if(activePage==='page-settings'){await Promise.all([loadConfig(),loadTeams()]);renderSettings();}
  else if(activePage==='page-objectives'){
    const sel=document.getElementById('obj-team-filter');
    if(sel&&S.teams.find(t=>String(t.id)===String(selectedTeamId)))sel.value=selectedTeamId;
    renderObjectivesContent();
  }
  else if(activePage==='page-roadmap'){
    const sel=document.getElementById('rdm-team-filter');
    if(sel&&S.teams.find(t=>String(t.id)===String(selectedTeamId)))sel.value=selectedTeamId;
    renderRoadmapContent();
  }
}

// ── SPRINT SELECTOR ──────────────────────────────────────
function sprintsSorted(){
  return S.sprints.slice().sort((a,b)=>new Date(a.start)-new Date(b.start));
}
function initSprintSel(){
  const sprints=sprintsSorted();
  const sidebarEl=document.getElementById('sprint-sel-sidebar');
  const barEl=document.getElementById('sprint-bar-sticky');
  if(!sprints.length){
    if(sidebarEl)sidebarEl.style.display='none';
    if(barEl)barEl.classList.remove('active');
    return;
  }
  // Restaurer depuis localStorage si valide pour cette équipe, sinon sprint courant
  const savedSprint=localStorage.getItem('bcp_sprint');
  if(savedSprint&&sprints.find(s=>String(s.id)===savedSprint)){
    selectedSprintId=savedSprint;
  } else if(!selectedSprintId||!sprints.find(s=>String(s.id)===String(selectedSprintId))){
    const now=new Date();
    const cur=sprints.find(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now)
      ||sprints.filter(s=>!s.closed).sort((a,b)=>new Date(a.start)-new Date(b.start))[0]
      ||sprints[sprints.length-1];
    selectedSprintId=String(cur.id);
  }
  localStorage.setItem('bcp_sprint',selectedSprintId);
  if(sidebarEl)sidebarEl.style.display='block';
  renderSprintSelector();
}
// Calcule le statut d'un sprint : closed | overdue | current | planned
function sprintSt(s){
  if(s.closed) return {text:'Terminé', badge:'badge-success', tl:'done'};
  const now=new Date();
  const endOfDay=new Date(s.end);endOfDay.setDate(endOfDay.getDate()+1); // dépassé seulement à partir du lendemain
  const started=new Date(s.start)<=now,ended=endOfDay<=now;
  if(ended)   return {text:'Dépassé', badge:'badge-danger',  tl:'overdue'};
  if(started) return {text:'En cours',badge:'badge-warning', tl:'current'};
  return              {text:'Planifié',badge:'badge-primary', tl:''};
}
function renderSprintSelector(){
  const sprints=sprintsSorted();
  const idx=sprints.findIndex(s=>String(s.id)===String(selectedSprintId));
  const s=sprints[idx];
  if(!s)return;
  const st=sprintSt(s);
  const statusText=st.text,statusClass=st.badge;
  const badge=`<span class="badge ${statusClass}" style="font-size:10px">${statusText}</span>`;
  const hasPrev=idx>0,hasNext=idx<sprints.length-1;
  // Desktop sidebar
  const nameEl=document.getElementById('sp-sel-name');
  const statusEl=document.getElementById('sp-sel-status');
  const prevBtn=document.getElementById('sp-btn-prev');
  const nextBtn=document.getElementById('sp-btn-next');
  if(nameEl)nameEl.textContent=s.name;
  if(statusEl)statusEl.innerHTML=badge;
  if(prevBtn)prevBtn.style.visibility=hasPrev?'visible':'hidden';
  if(nextBtn)nextBtn.style.visibility=hasNext?'visible':'hidden';
  // Mobile/tablet bar
  const sel=document.getElementById('sp-sel-select');
  const prevMBtn=document.getElementById('sp-btn-prev-m');
  const nextMBtn=document.getElementById('sp-btn-next-m');
  if(sel){
    sel.innerHTML=sprints.map(sp=>`<option value="${sp.id}" ${String(sp.id)===String(selectedSprintId)?'selected':''}>${sp.name}</option>`).join('');
  }
  if(prevMBtn)prevMBtn.style.visibility=hasPrev?'visible':'hidden';
  if(nextMBtn)nextMBtn.style.visibility=hasNext?'visible':'hidden';
  // Show/hide sticky bar depending on active page
  const activePage=document.querySelector('.page.active')?.id;
  const showBar=activePage==='page-dashboard'||activePage==='page-charts';
  const barEl=document.getElementById('sprint-bar-sticky');
  if(barEl)barEl.classList.toggle('active',showBar);
}
function navSprint(dir){
  const sprints=sprintsSorted();
  const idx=sprints.findIndex(s=>String(s.id)===String(selectedSprintId));
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=sprints.length)return;
  selectedSprintId=String(sprints[newIdx].id);
  localStorage.setItem('bcp_sprint',selectedSprintId);
  renderSprintSelector();
  const activePage=document.querySelector('.page.active')?.id;
  if(activePage==='page-dashboard')renderDash();
  if(activePage==='page-charts')renderCharts();
}
function selectSprint(id){
  selectedSprintId=String(id);
  localStorage.setItem('bcp_sprint',selectedSprintId);
  renderSprintSelector();
  const activePage=document.querySelector('.page.active')?.id;
  if(activePage==='page-dashboard')renderDash();
  if(activePage==='page-charts')renderCharts();
}

// ── NAV ──────────────────────────────────────────────────
async function navTo(p,noPush=false){
  if(['settings','users'].includes(p)&&!['admin','super_admin'].includes(CU?.role))return navTo('dashboard',noPush);
  if(!noPush)history.pushState({page:p},'',BASE_PATH+(PAGE_SLUGS[p]||p));
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p)?.classList.add('active');
  document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll(`[onclick="navTo('${p}')"]`).forEach(x=>x.classList.add('active'));
  if(p==='dashboard'){await Promise.all([loadTeam(),loadSprints(),loadLeaves(),loadBacklog(),loadNoTimespent()]);initSprintSel();renderDash();syncJiraVelocities().then(()=>loadSprints().then(()=>{renderDash();initSprintSel();})).catch(()=>{});}
  if(p==='agenda'){await Promise.all([loadTeam(),loadLeaves()]);renderAgenda();document.getElementById('sprint-bar-sticky')?.classList.remove('active');}
  if(p==='sprints'){await loadSprints();renderSprints();document.getElementById('sprint-bar-sticky')?.classList.remove('active');syncJiraVelocities().then(()=>loadSprints().then(()=>renderSprints())).catch(()=>{});}
  if(p==='charts'){await Promise.all([loadSprints(),loadTeam(),loadLeaves()]);initSprintSel();renderCharts();}
  if(p==='settings'){await Promise.all([loadTeam(),loadConfig(),loadTeams()]);renderSettings();document.getElementById('sprint-bar-sticky')?.classList.remove('active');}
  if(p==='users'){await loadUsers();renderUsers();document.getElementById('sprint-bar-sticky')?.classList.remove('active');}
  if(p==='backlog'){await Promise.all([loadSprints(),loadBacklog(),loadObjectives()]);renderBacklog();document.getElementById('sprint-bar-sticky')?.classList.remove('active');}
  if(p==='objectives'){
    document.getElementById('sprint-bar-sticky')?.classList.remove('active');
    document.getElementById('obj-content').innerHTML=`<div class="obj-empty"><span class="material-icons-round" style="animation:spin 1s linear infinite;font-size:36px;color:var(--primary)">sync</span><p>Chargement des objectifs…</p></div>`;
    try{await loadObjectives();}catch(e){document.getElementById('obj-content').innerHTML=`<div class="obj-empty"><span class="material-icons-round" style="color:var(--danger);font-size:36px">error_outline</span><p>${e.error||'Erreur lors du chargement'}</p></div>`;return;}
    renderObjectives();
  }
  if(p==='roadmap'){
    document.getElementById('sprint-bar-sticky')?.classList.remove('active');
    document.getElementById('rdm-content').innerHTML=`<div class="obj-empty"><span class="material-icons-round" style="animation:spin 1s linear infinite;font-size:36px;color:var(--primary)">sync</span><p>Chargement…</p></div>`;
    try{
      await Promise.all([API.get('/api/sprints').then(d=>{S.sprints=d.map(normSprint);}),loadObjectives()]);
      // Charger le backlog pour TOUTES les équipes (objectivesData les contient toutes, sans filtre de rôle)
      const rdmTeams=S.objectivesData?.teams||S.teams||[];
      S.backlog=(await Promise.all(rdmTeams.map(t=>API.get('/api/backlog?teamId='+t.id).catch(()=>[])))).flat();
    }catch(e){document.getElementById('rdm-content').innerHTML=`<div class="obj-empty"><span class="material-icons-round" style="color:var(--danger);font-size:36px">error_outline</span><p>${e.error||'Erreur lors du chargement'}</p></div>`;return;}
    renderRoadmap();
  }
}

// ── THEME ────────────────────────────────────────────────
function setTheme(t){
  document.body.setAttribute('data-theme',t);localStorage.setItem('bcp_theme',t);
  document.querySelectorAll('[data-theme]:not(body)').forEach(el=>el.classList.toggle('active',el.getAttribute('data-theme')===t));
}
// ── SUNRISE / SUNSET (Paris 48.8566°N 2.3522°E) ──────────
function parisSunTimes(date){
  // L'équation solaire doit être évaluée au midi UTC du jour concerné,
  // pas à l'heure courante — sinon le JD fractionnaire fausse le transit solaire.
  const noon=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),12,0,0));
  const lat=48.8566*Math.PI/180;
  // Paris est à l'est : l_w négatif → Jstar = n - l_w/360 = n + lon/360
  const lonDeg=2.3522;
  const JD=noon.getTime()/86400000+2440587.5; // JD entier+0 à midi UTC
  const n=JD-2451545.0;
  const Jstar=n+lonDeg/360; // signe correct pour longitude est
  const M=(357.5291+0.98560028*Jstar)%360;
  const Mr=M*Math.PI/180;
  const C=1.9148*Math.sin(Mr)+0.02*Math.sin(2*Mr)+0.0003*Math.sin(3*Mr);
  const lam=((M+C+180+102.9372)%360)*Math.PI/180;
  const Jtr=2451545.0+Jstar+0.0053*Math.sin(Mr)-0.0069*Math.sin(2*lam);
  const sinD=Math.sin(lam)*Math.sin(23.4397*Math.PI/180);
  const cosO=(Math.sin(-0.8333*Math.PI/180)-Math.sin(lat)*sinD)/(Math.cos(lat)*Math.cos(Math.asin(sinD)));
  if(Math.abs(cosO)>1)return null;
  const omega=Math.acos(cosO)*180/Math.PI;
  const jd2d=jd=>new Date((jd-2440587.5)*86400000);
  return{rise:jd2d(Jtr-omega/360),set:jd2d(Jtr+omega/360)};
}
let _modeTimer=null;
function targetMode(){
  if(window.matchMedia('(prefers-color-scheme: dark)').matches)return'dark';
  const now=new Date(),t=parisSunTimes(now);
  if(!t)return'light';
  return(now>=t.rise&&now<=t.set)?'light':'dark';
}
function scheduleMode(){
  if(_modeTimer){clearTimeout(_modeTimer);_modeTimer=null;}
  if(window.matchMedia('(prefers-color-scheme: dark)').matches)return;
  const now=new Date(),t=parisSunTimes(now);
  if(!t)return;
  let next;
  if(now<t.rise)next=t.rise;
  else if(now<t.set)next=t.set;
  else{const tom=new Date(now);tom.setUTCDate(tom.getUTCDate()+1);next=parisSunTimes(tom)?.rise;}
  if(next){const delay=next-now;_modeTimer=setTimeout(()=>{applyMode();scheduleMode();},delay);}
}
function applyMode(){document.body.setAttribute('data-mode',targetMode());}

// ── HOLIDAYS ─────────────────────────────────────────────
function holidays(year,country='FR'){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const easterMonth=Math.floor((h+l-7*m+114)/31),easterDay=((h+l-7*m+114)%31)+1;
  const easter=new Date(year,easterMonth-1,easterDay);
  const add=(dt,n)=>{const r=new Date(dt);r.setDate(r.getDate()+n);return r;};
  const fmt=dt=>toDS(dt);
  // Lundi le plus proche d'une date fixe (règle mexicaine)
  const nearestMon=dt=>{const dw=dt.getDay();return add(dt,[1,0,-1,-2,-3,3,2][dw]);};
  if(country==='ES') return new Set([
    fmt(new Date(year,0,1)),   // Año Nuevo
    fmt(add(easter,-2)),       // Viernes Santo
    fmt(new Date(year,4,1)),   // Día del Trabajo
    fmt(new Date(year,7,15)),  // Asunción
    fmt(new Date(year,9,12)),  // Fiesta Nacional
    fmt(new Date(year,10,1)),  // Todos los Santos
    fmt(new Date(year,11,6)),  // Día de la Constitución
    fmt(new Date(year,11,8)),  // Inmaculada Concepción
    fmt(new Date(year,11,25)), // Navidad
  ]);
  if(country==='MX') return new Set([
    fmt(new Date(year,0,1)),                      // Año Nuevo
    fmt(nearestMon(new Date(year,1,5))),           // Constitución (lunes más cercano au 5 fév)
    fmt(nearestMon(new Date(year,2,21))),          // Benito Juárez (lunes más cercano au 21 mars)
    fmt(new Date(year,4,1)),                       // Día del Trabajo
    fmt(new Date(year,8,16)),                      // Independencia
    fmt(nearestMon(new Date(year,10,20))),         // Revolución (lunes más cercano au 20 nov)
    fmt(new Date(year,11,25)),                     // Navidad
  ]);
  if(country==='MA') return new Set([
    fmt(new Date(year,0,1)),   // 1er janvier
    fmt(new Date(year,0,11)),  // 11 janvier - Fête de l'Indépendance
    fmt(new Date(year,4,1)),   // 1er mai
    fmt(new Date(year,6,30)),  // 30 juillet - Fête du Trône
    fmt(new Date(year,7,21)),  // 21 août - Révolution
    fmt(new Date(year,10,6)),  // 6 novembre - Marche Verte
    fmt(new Date(year,11,25)), // 25 décembre
  ]);
  // France (par défaut)
  return new Set([
    fmt(new Date(year,0,1)),   // 1er janvier
    fmt(add(easter,1)),        // Lundi de Pâques
    fmt(new Date(year,4,1)),   // 1er mai
    fmt(new Date(year,4,8)),   // 8 mai
    fmt(add(easter,39)),       // Ascension
    fmt(add(easter,50)),       // Lundi de Pentecôte
    fmt(new Date(year,6,14)),  // 14 juillet
    fmt(new Date(year,7,15)),  // 15 août
    fmt(new Date(year,10,1)),  // 1er novembre
    fmt(new Date(year,10,11)), // 11 novembre
    fmt(new Date(year,11,25)), // 25 décembre
  ]);
}

// ── CAPACITY ─────────────────────────────────────────────
const r2=v=>Math.round(v*100)/100;
function dayH(dt){return dt.getDay()===5?7:8;}

// Retourne la date (YYYY-MM-DD) du premier jour de la semaine de convergence
// = premier des 5 derniers jours ouvrés du sprint
function convergenceStart(sprintEnd){
  const hols=holidays(new Date(sprintEnd).getFullYear(),'FR');
  let count=0,d=new Date(sprintEnd);
  while(count<5){
    const dow=d.getDay();
    if(dow>0&&dow<6&&!hols.has(toDS(d)))count++;
    if(count<5)d.setDate(d.getDate()-1);
  }
  return toDS(d);
}

function calcCap(member,start,end,leaves){
  const vg=S.config.vel_grid||{alternant:50,junior:70,intermediaire:85,senior:100};
  const startDt=parseDate(start),endDt=parseDate(end);
  const country=member.country||'FR';
  const hols=holidays(startDt.getFullYear(),country);
  if(startDt.getFullYear()!==endDt.getFullYear())
    holidays(endDt.getFullYear(),country).forEach(x=>hols.add(x));
  const mLeaves=leaves.filter(l=>l.memberId==member.id);
  // Compter en jours (pas en heures) pour éviter les décimales liées au vendredi 7h
  let totD=0,lvD=0;
  let d=new Date(startDt);
  while(d<=endDt){
    const dow=d.getDay();
    if(dow>0&&dow<6){
      const ds=toDS(d);
      if(!hols.has(ds)){
        totD++;
        const lv=mLeaves.find(l=>l.date===ds);
        if(lv) lvD+=(lv.type==='full'?1:0.5);
      }
    }
    d.setDate(d.getDate()+1);
  }
  const availD=totD-lvD;
  const velPct=member.velocity!=null?member.velocity:(vg[member.level]??85);
  const hasCustomVel=member.velocity!=null;
  const mtgPct=member.meetings||20;
  const mtgD=r2(availD*mtgPct/100);
  const prodD=r2(availD*(velPct-mtgPct)/100);
  return {totD,availD,mtgD,prodD,velPct,hasCustomVel};
}

// ── DASHBOARD ────────────────────────────────────────────
function countWorkDays(start,end){
  if(!start||!end||start>end)return 0;
  const hols=holidays(start.getFullYear());
  if(start.getFullYear()!==end.getFullYear())holidays(end.getFullYear()).forEach(x=>hols.add(x));
  let count=0,d=new Date(start);
  while(d<=end){const dow=d.getDay();if(dow>0&&dow<6&&!hols.has(toDS(d)))count++;d.setDate(d.getDate()+1);}
  return count;
}
const RL={dev:'Développeur',tech_lead:'Tech Lead',qa:'QA',squad_lead:'Squad Lead',po:'PO'};
const LB={alternant:'badge-warning',junior:'badge-primary',intermediaire:'badge-success',senior:'badge-success'};

function renderDash(){
  const sprints=S.sprints,team=S.team,leaves=S.leaves;
  const now=new Date();
  const cur=selectedSprintId
    ?sprints.find(s=>String(s.id)===String(selectedSprintId))
    :(sprints.find(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now)
      ||sprints.filter(s=>!s.closed).sort((a,b)=>new Date(a.start)-new Date(b.start))[0]);
  document.getElementById('dash-sprint-label').textContent=cur?`${cur.name} · ${fd(cur.start)} → ${fd(cur.end)}`:'Aucun sprint actif';
  const devs=team.filter(m=>(m.role==='dev'||m.role==='tech_lead')&&(!cur||memberActiveInPeriod(m,cur.start,cur.end)));
  let totA=0,totP=0,totC=0;
  const hasConv=cur&&(cur.convergence===1||cur.convergence===true);
  const convStart=hasConv?convergenceStart(cur.end):null;
  const prodEnd=convStart?toDS(new Date(new Date(convStart).setDate(new Date(convStart).getDate()-1))):null;
  if(cur)devs.forEach(m=>{
    if(hasConv){
      const cP=calcCap(m,cur.start,prodEnd,leaves);
      const cC=calcCap(m,convStart,cur.end,leaves);
      totA+=cP.availD+cC.availD;totP+=cP.prodD;totC+=cC.prodD;
    }else{
      const c=calcCap(m,cur.start,cur.end,leaves);totA+=c.availD;totP+=c.prodD;
    }
  });
  const todayMid=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const sprintStart=cur?parseDate(cur.start):null;
  const sprintEnd=cur?parseDate(cur.end):null;
  const totalDays=cur?countWorkDays(sprintStart,sprintEnd):0;
  const fromDay=cur?(todayMid>=sprintStart?todayMid:sprintStart):null;
  const remainDays=cur?Math.max(0,countWorkDays(fromDay,sprintEnd)):0;
  document.getElementById('dash-stats').innerHTML=`
    <div class="card stat-card"><div class="stat-value">${devs.length}</div><div class="stat-label">Développeurs</div><div class="stat-sub">${team.length} membres total</div></div>
    <div class="card stat-card"><div class="stat-value">${r2(totP)}j</div><div class="stat-label">Capacité dev</div><div class="stat-sub">${hasConv?`+ ${r2(totC)}j convergence · `:''}sur ${r2(totA)}j dispo</div></div>
    <div class="card stat-card"><div class="stat-value">${cur?.velocityPlanned||'—'}</div><div class="stat-label">Points planifiés</div><div class="stat-sub">Vélocité cible</div></div>
    <div class="card stat-card"><div class="stat-value">${cur?remainDays+'j':'—'}</div><div class="stat-label">Jours restants</div><div class="stat-sub">${cur?`sur ${totalDays}j ouvrés`:'—'}</div></div>`;
  document.getElementById('dash-cap').innerHTML=!cur||devs.length===0
    ?'<p style="color:var(--text3);font-size:13px">Configurez l\'équipe et un sprint</p>'
    :devs.map(m=>{
      let prodD,convD,availD,totD,mtgD,velPct,hasCustomVel;
      if(hasConv){
        const cP=calcCap(m,cur.start,prodEnd,leaves);
        const cC=calcCap(m,convStart,cur.end,leaves);
        prodD=cP.prodD;convD=cC.prodD;availD=cP.availD+cC.availD;
        totD=cP.totD+cC.totD;mtgD=r2(cP.mtgD+cC.mtgD);velPct=cP.velPct;hasCustomVel=cP.hasCustomVel;
      }else{
        const c=calcCap(m,cur.start,cur.end,leaves);
        prodD=c.prodD;convD=0;availD=c.availD;totD=c.totD;mtgD=c.mtgD;velPct=c.velPct;hasCustomVel=c.hasCustomVel;
      }
      const totalProd=r2(prodD+(convD||0));
      const pct=Math.round(totalProd/Math.max(.01,totD)*100);
      return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span style="font-weight:600">${m.fname} ${m.lname} <span class="badge ${LB[m.level]||'badge-primary'}" style="font-size:10px">${m.level}</span></span>
        <span style="color:var(--text3)">${hasConv?`${prodD}j dev + ${convD}j conv`:prodD+'j prod'} / ${availD}j dispo</span></div>
        <div class="progress-wrap">
          <div style="display:flex;height:100%">
            <div style="width:${Math.round(prodD/Math.max(.01,totD)*100)}%;background:var(--primary)"></div>
            ${hasConv?`<div style="width:${Math.round(convD/Math.max(.01,totD)*100)}%;background:var(--warning);opacity:0.85"></div>`:''}
          </div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">${mtgD}j réunions · ${RL[m.role]||m.role} · <span style="color:${hasCustomVel?'var(--primary)':'var(--text3)'}" title="${hasCustomVel?'Vélocité personnalisée':'Vélocité par niveau'}">${velPct}% vél.${hasCustomVel?' ✎':''}</span></div></div>`;
    }).join('');
  const objs=cur?.objectives||[];
  const canToggle=cur&&!cur.closed&&['admin','super_admin'].includes(CU?.role);
  const isAdmin=['admin','super_admin'].includes(CU?.role);
  const inpStyle='width:100%;padding:6px 8px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-weight:600;font-family:inherit;outline:none;text-align:center';
  const velBlock=!cur?''
    :cur.closed?`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:10px 12px;background:var(--bg);border-radius:var(--radius-md);border:1.5px solid var(--border)">
      <span class="material-icons-round" style="color:var(--success);font-size:22px">verified</span>
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Vélocité définitive</div>
        <div style="font-size:22px;font-weight:700;color:var(--success)">${cur.velocityActual!=null?cur.velocityActual:'—'}<span style="font-size:12px;color:var(--text3);margin-left:4px">pts</span></div>
      </div>
    </div>
    <div style="height:1px;background:var(--divider);margin-bottom:10px"></div>`
    :`
    <div style="display:flex;gap:16px;margin-bottom:10px;padding:8px 12px;background:var(--bg);border-radius:var(--radius-md);border:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">En cours</div>
        <div style="font-size:18px;font-weight:700;color:var(--primary)">${cur.velocityCurrent!=null?cur.velocityCurrent:'—'}<span style="font-size:11px;color:var(--text3);margin-left:3px">pts</span></div>
      </div>
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Réalisé</div>
        <div style="font-size:18px;font-weight:700;color:var(--success)">${cur.velocityActual!=null?cur.velocityActual:'—'}<span style="font-size:11px;color:var(--text3);margin-left:3px">pts</span></div>
      </div>
    </div>
    <div style="height:1px;background:var(--divider);margin-bottom:10px"></div>`;
  const objsBlock=!cur?'<p style="color:var(--text3);font-size:13px">Aucun sprint actif</p>'
    :objs.length===0?'<p style="color:var(--text3);font-size:13px">Aucun objectif</p>'
    :objs.map(o=>`<div class="objective-item" ${canToggle?`onclick="toggleObj('${cur.id}','${o.id}')" style="cursor:pointer"`:''}><div class="checkbox ${o.done?'checked':''}"></div><span style="font-size:13px;${o.done?'text-decoration:line-through;color:var(--text3)':''}">${o.text}</span></div>`).join('');
  const sprintBacklog=cur?(S.backlog||[]).filter(r=>String(r.sprint_id)===String(cur.id)).sort((a,b)=>{const sc=r=>r.effort>0?Math.round((r.reach*r.impact*r.confidence)/r.effort):0;return sc(b)-sc(a);}):[];
  const backlogBlock=cur&&sprintBacklog.length>0?`
    <div style="height:1px;background:var(--divider);margin:10px 0"></div>
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Backlog du sprint</div>
    ${sprintBacklog.map(r=>{
      const score=r.effort>0?Math.round((r.reach*r.impact*r.confidence)/r.effort):0;
      const jiraLink=r.jira_id?`<a href="https://isagri.atlassian.net/browse/${encodeURIComponent(r.jira_id)}" target="_blank" rel="noopener" style="font-size:10px;font-weight:600;color:var(--primary);text-decoration:none;flex-shrink:0">${r.jira_id}</a>`:'';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--divider)">
        ${jiraLink}
        <span style="font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onmouseenter="showBlTip(event,this)" onmouseleave="hideBlTip()" data-tip="${(r.label||'').replace(/"/g,'&quot;')}">${r.label||'—'}</span>
        ${score>0?`<span style="font-size:10px;font-weight:700;color:var(--primary);flex-shrink:0">${score}</span>`:''}
      </div>`;
    }).join('')}`:''
  document.getElementById('dash-obj').innerHTML=velBlock+objsBlock+backlogBlock;
  const dashTeam=cur?team.filter(m=>memberActiveInPeriod(m,cur.start,cur.end)):team;
  document.getElementById('dash-team').innerHTML=dashTeam.length===0
    ?'<p style="color:var(--text3);font-size:13px;grid-column:span 3">Aucun membre</p>'
    :dashTeam.map((m,i)=>`<div class="member-card">
      <div class="member-avatar" style="background:${mc(i)}">${(m.fname[0]||'')+(m.lname[0]||'')}</div>
      <div class="member-info"><div class="member-name">${m.fname} ${m.lname}</div><div class="member-meta">${RL[m.role]||m.role} · ${m.meetings||20}% réun.</div></div>
      ${cur&&(m.role==='dev'||m.role==='tech_lead')?`<div style="text-align:right;flex-shrink:0">${(()=>{
        if(hasConv){const cP=calcCap(m,cur.start,prodEnd,leaves);const cC=calcCap(m,convStart,cur.end,leaves);
          return `<div style="font-size:13px;font-weight:700;color:var(--primary)">${cP.prodD}j <span style="font-size:10px;color:var(--text3)">dev</span></div><div style="font-size:11px;font-weight:600;color:var(--warning)">${cC.prodD}j <span style="font-size:10px;color:var(--text3)">conv.</span></div>`;}
        return `<div style="font-size:15px;font-weight:700;color:var(--primary)">${calcCap(m,cur.start,cur.end,leaves).prodD}j</div><div style="font-size:10px;color:var(--text3)">prod.</div>`;
      })()}</div>`:''}
    </div>`).join('');
  const nt=S.noTimespent||{total:0,issues:[]};
  const ntColor=nt.total>0?'var(--danger)':'var(--success)';
  const JIRA_BROWSE='https://isagri.atlassian.net/browse/';
  document.getElementById('dash-no-time').innerHTML=`
    <div style="font-size:48px;font-weight:800;color:${ntColor};line-height:1">${nt.total}</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;margin-top:2px">US sans temps renseigné</div>
    ${nt.issues.length>0?`<div class="no-time-list">${nt.issues.map(i=>`
      <div class="no-time-row">
        <a href="${JIRA_BROWSE}${encodeURIComponent(i.jira_id)}" target="_blank" rel="noopener" class="no-time-key">${i.jira_id}</a>
        <span class="no-time-assignee">${i.assignee_name}</span>
      </div>`).join('')}</div>`:''}`;
}

function parseDate(ds){ const [y,m,d]=ds.split('-').map(Number); return new Date(y,m-1,d); }
function toDS(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
function showConfirm(msg, onOk, title='Confirmation'){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').innerHTML=msg;
  const btn=document.getElementById('confirm-ok-btn');
  const fresh=btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh,btn);
  fresh.addEventListener('click',()=>{closeModal('modal-confirm');onOk();});
  document.getElementById('modal-confirm').classList.add('open');
}

// ── AGENDA ───────────────────────────────────────────────
function memberActiveInPeriod(m,startDS,endDS){
  if(!m.teamPeriods?.length)return true; // données sans historique = toujours actif
  return m.teamPeriods.some(p=>
    (!p.startDate||p.startDate<=endDS)&&(!p.endDate||p.endDate>=startDS)
  );
}
function memberActiveInMonth(m,monthStart,monthEnd){return memberActiveInPeriod(m,monthStart,monthEnd);}
function memberIsFormer(m){
  if(!m.teamPeriods?.length)return false;
  const today=toDS(new Date());
  return m.teamPeriods.every(p=>p.endDate&&p.endDate<today);
}
function renderAgenda(){
  const leaves=S.leaves;
  const team=S.team;
  const yr=calDate.getFullYear(),mo=calDate.getMonth();
  const holsFR=holidays(yr,'FR'); // header basé sur FR (majorité)
  const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('plan-label').textContent=`${MONTHS[mo]} ${yr}`;
  const dim=new Date(yr,mo+1,0).getDate();
  const todayStr=toDS(new Date());
  const monthStart=toDS(new Date(yr,mo,1));
  const monthEnd=toDS(new Date(yr,mo,dim));
  const isAdmin=['admin','super_admin'].includes(CU.role);
  const days=[];
  for(let d=1;d<=dim;d++){
    const dt=new Date(yr,mo,d);
    days.push({d,dt,ds:toDS(dt),dow:dt.getDay()});
  }
  // Filtrer les membres visibles ce mois
  const visibleTeam=team.filter(m=>memberActiveInMonth(m,monthStart,monthEnd));
  let html='<thead><tr><th class="th-member">Membre</th>';
  days.forEach(({d,dow,ds})=>{
    const isWe=dow===0||dow===6,isHol=holsFR.has(ds),isTod=ds===todayStr;
    const dayN=['D','L','M','M','J','V','S'][dow];
    let cls='',sty='';
    if(isTod) cls=' th-today';
    else if(isWe) sty='opacity:.35;';
    else if(isHol) sty='color:var(--warning);';
    html+=`<th class="${cls}" style="${sty}" id="thd-${ds}">${d}<br><span style="font-size:9px">${dayN}</span></th>`;
  });
  html+='</tr></thead><tbody>';
  const COUNTRY_FLAG={FR:'🇫🇷',ES:'🇪🇸',MX:'🇲🇽',MA:'🇲🇦'};
  visibleTeam.forEach((m,mi)=>{
    const former=memberIsFormer(m);
    const canEdit=!former; // lecture seule pour les membres partis
    const mHols=holidays(yr,m.country||'FR');
    const flag=COUNTRY_FLAG[m.country||'FR']||'';
    html+=`<tr${former?' class="agenda-former"':''}><td class="td-member"><div style="display:flex;align-items:center;gap:8px;width:100%">
      <div style="width:22px;height:22px;border-radius:50%;background:${mc(mi)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${m.fname[0]||''}</div>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.fname} ${m.lname}</span>
      ${m.country&&m.country!=='FR'?`<span style="font-size:12px;flex-shrink:0" title="${m.country}">${flag}</span>`:''}
    </div></td>`;
    days.forEach(({ds,dow})=>{
      const isWe=dow===0||dow===6,isHol=mHols.has(ds),isTod=ds===todayStr;
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
  const tbl=document.getElementById('plan-table');
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

function groupLeaves(leaves,team){
  const groups=[];
  team.forEach(m=>{
    const mLeaves=leaves.filter(l=>l.memberId==m.id).sort((a,b)=>a.date>b.date?1:-1);
    if(!mLeaves.length)return;
    let cur=null;
    mLeaves.forEach(l=>{
      if(cur && l.type===cur.type){
        const prev=new Date(cur.endDate);
        const next=new Date(l.date);
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
  const tl={full:'Journée',am:'Matin',pm:'Après-midi'};
  const el=document.getElementById('leave-list');if(!el)return;
  if(leaves.length===0){el.innerHTML='<p style="color:var(--text3);font-size:13px">Aucun congé enregistré</p>';return;}
  const groups=groupLeaves(leaves,team);
  window._leaveGroups={};
  el.innerHTML=groups.sort((a,b)=>a.startDate>b.startDate?1:-1).map((g,gi)=>{
    window._leaveGroups[gi]=g.ids;
    const idx=team.findIndex(t=>t.id==g.memberId);
    const isSameDay=g.startDate===g.endDate;
    const canDel=true;
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
  el.querySelectorAll('.leave-del-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const ids=window._leaveGroups[btn.dataset.gi];
      showConfirm(
        `Supprimer cette période (${ids.length} jour${ids.length>1?'s':''}) ?`,
        async()=>{await API.del('/api/leaves',{ids});await loadLeaves();renderAgenda();toast('Période supprimée ✓','success');},
        'Supprimer le congé'
      );
    });
  });
}

function leaveState(leaves,memberId,ds){
  return (leaves.find(l=>l.memberId==memberId&&l.date===ds)||{}).type||null;
}
async function setLeave(memberId,ds,type){
  if(type){
    await API.post('/api/leaves',{memberId,date:ds,type,reason:''});
  }else{
    const lv=S.leaves.find(l=>String(l.memberId)===String(memberId)&&l.date===ds);
    if(lv)await API.del('/api/leaves',{ids:[lv.id]});
  }
  await loadLeaves();
  renderAgenda();
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
  const team=S.team;
  const sel=document.getElementById('lm-user');
  sel.disabled=false;
  sel.innerHTML=team.map(m=>`<option value="${m.id}">${m.fname} ${m.lname}</option>`).join('');
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
  const promises=[];
  let d=parseDate(start);const eD=parseDate(end);
  while(d<=eD){
    const dow=d.getDay(),ds=toDS(d);
    if(dow>0&&dow<6&&!hols.has(ds)){
      promises.push(API.post('/api/leaves',{memberId,date:ds,type,reason}));
    }
    d.setDate(d.getDate()+1);
  }
  try{
    await Promise.all(promises);
    await loadLeaves();
    closeModal('modal-leave');toast('Congé enregistré ✓','success');renderAgenda();
  }catch(e){toast(e.error||'Erreur','error');}
}

// ── SPRINTS ──────────────────────────────────────────────
function renderSprints(){
  const sprints=S.sprints.slice().sort((a,b)=>new Date(b.start)-new Date(a.start));
  const now=new Date(),isAdmin=['admin','super_admin'].includes(CU.role);
  document.getElementById('sprints-list').innerHTML=sprints.length===0
    ?'<div class="card" style="text-align:center;color:var(--text3);padding:48px">Aucun sprint créé</div>'
    :'<div class="timeline">'+sprints.map(s=>{
      const st=sprintSt(s);
      const tl='tl-item'+(st.tl?' '+st.tl:'');
      const objs=s.objectives||[],dO=objs.filter(o=>o.done).length;
      const stars=Array(5).fill(0).map((_,i)=>`<span class="material-icons-round conf-star ${i<(s.confidence||0)?'':'empty'}" style="font-size:14px">${i<(s.confidence||0)?'star':'star_border'}</span>`).join('');
      return `<div class="${tl}"><div class="sprint-card" style="margin-bottom:16px">
        <div class="sprint-card-header">
          <div>
            <div class="sprint-name">${s.name}</div>
            <div class="sprint-dates">${fd(s.start)} → ${fd(s.end)}</div>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="badge ${st.badge}">${st.text}</span>
              <div>${stars}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            ${isAdmin&&!s.closed?`<button class="btn btn-outline btn-sm" onclick="openSprintModal('${s.id}')"><span class="material-icons-round">edit</span></button>`:''}
            ${isAdmin&&!s.closed&&st.tl!==''?`<button class="btn btn-filled btn-sm" onclick="openCloseModal('${s.id}')"><span class="material-icons-round">check</span>Clôturer</button>`:''}
            ${isAdmin?`<button class="btn btn-danger btn-sm" onclick="delSprint('${s.id}')"><span class="material-icons-round">delete</span></button>`:''}
          </div>
        </div>
        <div class="sprint-card-body">
          <div class="grid-3" style="gap:12px;margin-bottom:${objs.length?12:0}px">
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Planifié</div><div style="font-size:22px;font-weight:700;color:var(--primary)">${s.velocityPlanned||'—'} pts</div></div>
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">En cours</div>
              <div style="font-size:22px;font-weight:700;color:var(--warning)">${s.velocityCurrent||'—'}${s.velocityCurrent?' pts':''}</div>
            </div>
            <div><div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Réalisé</div>
              <div style="font-size:22px;font-weight:700;color:${s.velocityActual?'var(--success)':'var(--text3)'}">${s.velocityActual||'—'}${s.velocityActual?' pts':''}</div>
            </div>
          </div>
          ${objs.length?`<div style="font-size:12px;color:var(--text3);margin-bottom:8px;font-weight:600">${dO}/${objs.length} objectifs</div>${objs.map(o=>`<div class="objective-item" ${!s.closed?`onclick="toggleObj('${s.id}','${o.id}')" style="cursor:pointer"`:''}><div class="checkbox ${o.done?'checked':''}"></div><span style="font-size:13px;${o.done?'text-decoration:line-through;color:var(--text3)':''}">${o.text}</span></div>`).join('')}`:''}
        </div>
      </div></div>`;}).join('')+'</div>';
}
async function toggleObj(sprintId,objId){
  const s=S.sprints.find(x=>String(x.id)===String(sprintId));
  if(!s||s.closed)return;
  const obj=(s.objectives||[]).find(o=>String(o.id)===String(objId));
  if(!obj)return;
  obj.done=!obj.done;
  try{
    await API.put('/api/sprints/'+sprintId,{
      name:s.name,start:s.start,end:s.end,
      velocityPlanned:s.velocityPlanned,velocityCurrent:s.velocityCurrent,
      velocityActual:s.velocityActual,confidence:s.confidence,
      objectives:s.objectives,closed:s.closed,
      teamId:Number(selectedTeamId),
    });
    const activePage=document.querySelector('.page.active')?.id;
    if(activePage==='page-dashboard')renderDash();
    else if(activePage==='page-sprints')renderSprints();
  }catch(e){
    obj.done=!obj.done; // rollback mémoire
    toast(e.error||'Erreur de sauvegarde','error');
  }
}
function openSprintModal(id=null){
  editSprintId=id;sprintStars=0;tmpObjs=[];
  const s=id?S.sprints.find(x=>x.id==id):null;
  document.getElementById('sprint-modal-title').textContent=id?'Modifier le sprint':'Nouveau sprint';
  document.getElementById('sm-name').value=s?.name||'';
  document.getElementById('sm-start').value=s?.start||'';
  document.getElementById('sm-end').value=s?.end||'';
  document.getElementById('sm-vel').value=s?.velocityPlanned||'';
  document.getElementById('sm-convergence').checked=s?(s.convergence!==0&&s.convergence!==false):true;
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
  const convergence=document.getElementById('sm-convergence').checked;
  if(!name||!start||!end){toast('Champs obligatoires manquants','error');return;}
  try{
    if(editSprintId){
      const s=S.sprints.find(x=>x.id==editSprintId);
      await API.put('/api/sprints/'+editSprintId,{
        name,start,end,velocityPlanned:vp,
        velocityCurrent:s?.velocityCurrent||null,
        velocityActual:s?.velocityActual||null,
        confidence:sprintStars,objectives:tmpObjs,closed:s?.closed||false,
        teamId:Number(selectedTeamId),convergence,
      });
    }else{
      await API.post('/api/sprints',{name,start,end,velocityPlanned:vp,confidence:sprintStars,objectives:tmpObjs,teamId:selectedTeamId?Number(selectedTeamId):null,convergence});
    }
    await loadSprints();
    closeModal('modal-sprint');toast('Sprint sauvegardé ✓','success');renderSprints();
  }catch(e){toast(e.error||'Erreur','error');}
}
function delSprint(id){
  const s=S.sprints.find(x=>x.id==id);
  showConfirm(
    `Supprimer  "${s?.name||id}" ?<br />Cette action le supprimera pour toutes les équipes.`,
    async()=>{
      await API.del('/api/sprints/'+id);
      await loadSprints();renderSprints();toast('Sprint supprimé','success');
    },
    'Supprimer le sprint'
  );
}
function openCloseModal(id){
  closeSprintId=id;
  const s=S.sprints.find(x=>x.id==id);
  document.getElementById('scm-vel').value=s?.velocityCurrent||s?.velocityActual||'';
  const objs=s?.objectives||[];
  document.getElementById('scm-objs').innerHTML=objs.map((o,i)=>`<div class="objective-item"><div class="checkbox ${o.done?'checked':''}" onclick="toggleCloseObj(${i})"></div><span style="font-size:13px">${o.text}</span></div>`).join('');
  document.getElementById('modal-close-sprint').classList.add('open');
}
function toggleCloseObj(i){
  const s=S.sprints.find(x=>x.id==closeSprintId);
  if(s)s.objectives[i].done=!s.objectives[i].done;
  document.querySelectorAll('#scm-objs .checkbox')[i]?.classList.toggle('checked');
}
async function doCloseSprint(){
  const va=Number(document.getElementById('scm-vel').value);
  const s=S.sprints.find(x=>x.id==closeSprintId);if(!s)return;
  await API.put('/api/sprints/'+closeSprintId,{
    name:s.name,start:s.start,end:s.end,
    velocityPlanned:s.velocityPlanned,velocityCurrent:s.velocityCurrent,
    velocityActual:va,confidence:s.confidence,
    objectives:s.objectives,closed:true,
    teamId:Number(selectedTeamId),
  });
  await loadSprints();
  closeModal('modal-close-sprint');toast('Sprint clôturé ✓','success');renderSprints();
}

// ── CHARTS ───────────────────────────────────────────────
function cv(v){return getComputedStyle(document.body).getPropertyValue(v).trim();}
function dChart(id,type,data,opts){if(charts[id]){charts[id].destroy();delete charts[id];}charts[id]=new Chart(document.getElementById(id),{type,data,options:opts});}
function renderCharts(){
  const now=new Date();
  // Sprint sélectionné dans la sidebar (peut être à venir)
  const selSprint=selectedSprintId?S.sprints.find(s=>String(s.id)===String(selectedSprintId)):null;
  // 3 derniers sprints commencés, hors sprint sélectionné, triés chronologiquement
  const past3=S.sprints
    .filter(s=>new Date(s.start)<=now&&String(s.id)!==String(selectedSprintId))
    .sort((a,b)=>new Date(a.start)-new Date(b.start))
    .slice(-3);
  // Combiné et trié : 3 derniers + sprint sélectionné
  const sprints=[...past3,...(selSprint?[selSprint]:[])]
    .sort((a,b)=>new Date(a.start)-new Date(b.start));
  const pr=cv('--primary'),sc=cv('--secondary'),t2=cv('--text2'),dv=cv('--divider'),ff='Inter,sans-serif';
  const base={responsive:true,maintainAspectRatio:false,
    plugins:{legend:{labels:{color:t2,font:{family:ff,size:11}}},tooltip:{backgroundColor:'rgba(0,0,0,0.8)',titleFont:{family:ff},bodyFont:{family:ff}}},
    scales:{x:{ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv}},y:{ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv},beginAtZero:true}}};
  const labels=sprints.map(s=>s.name+(!s.closed&&new Date(s.start)<=now?' (en cours)':''));
  dChart('chart-velocity','bar',{labels,datasets:[
    {label:'Planifiée',data:sprints.map(s=>s.velocityPlanned||0),backgroundColor:pr+'55',borderColor:pr,borderWidth:2,borderRadius:8},
    {label:'Réalisée',data:sprints.map(s=>s.velocityActual||null),backgroundColor:sc+'55',borderColor:sc,borderWidth:2,borderRadius:8}
  ]},base);
  const gS=sprints.filter(s=>(s.objectives||[]).length>0);
  const gLabels=gS.map(s=>s.name+(!s.closed&&new Date(s.start)<=now?' (en cours)':''));
  const warnG=cv('--warning')||'#f59e0b';
  dChart('chart-goals','bar',{labels:gLabels,datasets:[
    {label:'Atteints',data:gS.map(s=>s.objectives.filter(o=>o.done).length),backgroundColor:sc+'88',borderColor:sc,borderWidth:2,borderRadius:6,stack:'obj'},
    {label:'Restants',data:gS.map(s=>s.objectives.length-s.objectives.filter(o=>o.done).length),backgroundColor:warnG+'55',borderColor:warnG,borderWidth:2,borderRadius:6,stack:'obj'}
  ]},{...base,scales:{...base.scales,y:{...base.scales.y,stacked:true,ticks:{color:t2,font:{family:ff,size:11},stepSize:1}},x:{...base.scales.x,stacked:true}}});
  const cur=selectedSprintId
    ?S.sprints.find(s=>String(s.id)===String(selectedSprintId))
    :S.sprints.find(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now);
  if(cur){
    const st=new Date(cur.start),en=new Date(cur.end),tot=cur.velocityPlanned||0;
    const todayDS=toDS(new Date(now.getFullYear(),now.getMonth(),now.getDate()));
    // Jours ouvrés total et écoulés
    let totalWD=0,elapsedWD=0;
    let td=new Date(st);
    while(td<=en){
      if(td.getDay()>0&&td.getDay()<6){
        totalWD++;
        if(toDS(td)<=todayDS) elapsedWD++;
      }
      td.setDate(td.getDate()+1);
    }
    // Réalisé (Done) vs En cours (In Progress)
    // Number() requis : MySQL DECIMAL revient en string, + ferait de la concaténation sinon
    const ptDone=Number(cur.velocityActual??0);
    const ptInProg=cur.closed?0:Number(cur.velocityCurrent??0);
    const ptTotal=ptDone+ptInProg;
    const buL=[],scopeLine=[],idealLine=[],doneLine=[],totalLine=[];
    let dn=0;
    td=new Date(st);
    while(td<=en){
      if(td.getDay()>0&&td.getDay()<6){
        dn++;
        buL.push(td.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}));
        scopeLine.push(tot);
        idealLine.push(r2(tot*dn/totalWD));
        const isElapsed=toDS(td)<=todayDS;
        if(cur.closed){
          doneLine.push(r2(ptDone*dn/totalWD));
          totalLine.push(null);
        } else if(elapsedWD===0){
          doneLine.push(null);totalLine.push(null);
        } else if(isElapsed){
          doneLine.push(r2(ptDone*dn/elapsedWD));
          totalLine.push(r2(ptTotal*dn/elapsedWD));
        } else {
          doneLine.push(null);totalLine.push(null);
        }
      }
      td.setDate(td.getDate()+1);
    }
    const warn=cv('--warning');
    const succ=cv('--success')||'#22c55e';
    const datasets=[
      {label:'Scope',data:scopeLine,borderColor:t2,borderDash:[4,4],borderWidth:1.5,fill:false,tension:0,pointRadius:0},
      {label:'Idéal',data:idealLine,borderColor:sc,borderWidth:2,fill:false,tension:0,pointRadius:0},
      {label:'Réalisé',data:doneLine,borderColor:succ,backgroundColor:succ+'28',fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:succ,borderWidth:2.5},
      {label:'Réalisé + En cours',data:totalLine,borderColor:warn,backgroundColor:warn+'18',fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:warn,borderWidth:2.5},
    ];
    dChart('chart-burndown','line',{labels:buL,datasets},{...base,
      plugins:{...base.plugins,tooltip:{...base.plugins.tooltip,mode:'index',intersect:false}},
      scales:{...base.scales,y:{...base.scales.y,min:0}}});
  } else dChart('chart-burndown','line',{labels:[],datasets:[]},base);
  const leaves=S.leaves,team=S.team;
  const warn=cv('--warning')||'#f59e0b';
  const cDev=[],cConv=[],cA=[];
  sprints.forEach(s=>{
    const sDevs=team.filter(m=>(m.role==='dev'||m.role==='tech_lead')&&memberActiveInPeriod(m,s.start,s.end));
    const hasConv=s.convergence===1||s.convergence===true;
    const convStart=hasConv?convergenceStart(s.end):null;
    const prodEnd=convStart?toDS(new Date(new Date(convStart).setDate(new Date(convStart).getDate()-1))):null;
    let tDev=0,tConv=0;
    sDevs.forEach(m=>{
      if(hasConv&&convStart&&prodEnd){
        tDev+=calcCap(m,s.start,prodEnd,leaves).prodD;
        tConv+=calcCap(m,convStart,s.end,leaves).prodD;
      } else {
        tDev+=calcCap(m,s.start,s.end,leaves).prodD;
      }
    });
    cDev.push(r2(tDev));cConv.push(hasConv?r2(tConv):null);cA.push(s.velocityActual||null);
  });
  dChart('chart-capacity','bar',{labels,datasets:[
    {label:'Capacité dev (j)',data:cDev,backgroundColor:pr+'55',borderColor:pr,borderWidth:2,borderRadius:4,stack:'cap',yAxisID:'y'},
    {label:'Capacité convergence (j)',data:cConv,backgroundColor:warn+'88',borderColor:warn,borderWidth:2,borderRadius:4,stack:'cap',yAxisID:'y'},
    {label:'Vélocité réalisée (pts)',data:cA,backgroundColor:sc+'44',borderColor:sc,borderWidth:2,borderRadius:8,yAxisID:'y1'}
  ]},{...base,scales:{x:{ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv}},y:{type:'linear',position:'left',stacked:true,ticks:{color:t2,font:{family:ff,size:11}},grid:{color:dv},beginAtZero:true,title:{display:true,text:'Jours',color:t2,font:{family:ff,size:11}}},y1:{type:'linear',position:'right',ticks:{color:t2,font:{family:ff,size:11}},grid:{drawOnChartArea:false},beginAtZero:true,title:{display:true,text:'Story points',color:t2,font:{family:ff,size:11}}}}});
}

// ── SETTINGS ─────────────────────────────────────────────
const LV={alternant:'Alternant',junior:'Junior',intermediaire:'Intermédiaire',senior:'Senior'};
function renderSettings(){
  const isSA=CU?.role==='super_admin';
  document.getElementById('settings-grid').style.gridTemplateColumns=isSA?'1fr 1fr':'1fr';
  const team=S.team,vg=S.config.vel_grid||{},mg=S.config.mtg_grid||{};
  const tl=document.getElementById('team-list');
  tl.innerHTML=team.length===0?'<p style="color:var(--text3);font-size:13px">Aucun membre</p>'
    :team.map((m,i)=>`<div class="member-card" draggable="true" data-id="${m.id}" style="margin-bottom:8px">
      <div class="drag-handle"><span class="material-icons-round" style="font-size:18px">drag_indicator</span></div>
      <div class="member-avatar" style="background:${mc(i)}">${(m.fname[0]||'')+(m.lname[0]||'')}</div>
      <div class="member-info"><div class="member-name">${m.fname} ${m.lname}</div><div class="member-meta">${RL[m.role]||m.role} · ${LV[m.level]||m.level} · ${m.meetings||20}% réun. · <span style="color:${m.velocity!=null?'var(--primary)':'var(--text3)'}">${m.velocity!=null?m.velocity:(vg[m.level]||85)}% vél.${m.velocity!=null?' ✎':''}</span></div></div>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="icon-btn" onclick="openMemberModal('${m.id}')"><span class="material-icons-round">edit</span></button>
        <button class="icon-btn" onclick="delMember('${m.id}')"><span class="material-icons-round" style="color:var(--danger)">delete</span></button>
      </div></div>`).join('');
  tl.querySelectorAll('.member-card').forEach(card=>{
    card.addEventListener('dragstart',e=>{
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
      // defer class addition so the ghost image captures the normal state
      requestAnimationFrame(()=>card.classList.add('dragging'));
    });
    card.addEventListener('dragend',()=>{
      tl.querySelectorAll('.member-card').forEach(c=>c.classList.remove('dragging','drag-over'));
    });
    card.addEventListener('dragover',e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave',e=>{
      // ignore if still within the same card (child elements trigger dragleave)
      if(!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
    });
    card.addEventListener('drop',async e=>{
      e.preventDefault();
      card.classList.remove('drag-over');
      const srcId=e.dataTransfer.getData('text/plain');
      if(!srcId||srcId===card.dataset.id)return;
      // work with string IDs to avoid numeric/string indexOf mismatch
      const ids=S.team.map(m=>String(m.id));
      const fi=ids.indexOf(srcId), ti=ids.indexOf(String(card.dataset.id));
      if(fi<0||ti<0)return;
      ids.splice(fi,1);ids.splice(ti,0,srcId);
      await API.put('/api/team/reorder',{ids});
      await loadTeam();renderSettings();toast('Ordre mis à jour ✓','success');
    });
  });
  document.getElementById('vel-grid').innerHTML=Object.entries(vg).map(([k,v])=>`<div class="velocity-item"><label>${LV[k]||k}</label><input type="number" class="input" id="vg-${k}" value="${v}" min="0" max="100" step="5"><div style="font-size:11px;color:var(--text3);margin-top:4px">% du potentiel</div></div>`).join('');
  document.getElementById('mtg-grid').innerHTML=Object.entries(mg).map(([k,v])=>`<div class="velocity-item"><label>${RL[k]||k}</label><input type="number" class="input" id="mg-${k}" value="${v}" min="0" max="100" step="5"><div style="font-size:11px;color:var(--text3);margin-top:4px">% du temps</div></div>`).join('');
  if(isSA) renderTeamsList();
}
async function moveTeamMember(i,dir){
  const t=[...S.team];const j=i+dir;
  if(j<0||j>=t.length)return;
  [t[i],t[j]]=[t[j],t[i]];
  await API.put('/api/team/reorder',{ids:t.map(m=>m.id)});
  await loadTeam();renderSettings();toast('Ordre mis à jour ✓','success');
}
async function saveVelGrid(){
  const keys=['alternant','junior','intermediaire','senior'],g={};
  keys.forEach(k=>{const el=document.getElementById('vg-'+k);if(el)g[k]=Number(el.value);});
  await API.put('/api/config/vel_grid',{value:g});
  S.config.vel_grid=g;toast('Grille sauvegardée ✓','success');
}
async function saveMtgGrid(){
  const keys=['dev','tech_lead','qa','squad_lead','po'],g={};
  keys.forEach(k=>{const el=document.getElementById('mg-'+k);if(el)g[k]=Number(el.value);});
  await API.put('/api/config/mtg_grid',{value:g});
  S.config.mtg_grid=g;toast('Grille sauvegardée ✓','success');
}
function addTeamRow(assignment=null){
  const list=document.getElementById('mm-teams-list');
  if(!list)return;
  const opts=_modalTeams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  const div=document.createElement('div');
  div.className='mm-team-row';
  div.style.cssText='display:flex;gap:6px;align-items:center';
  div.innerHTML=`
    <select class="input select mm-tr-team" style="flex:1;min-width:0;font-size:13px;padding:5px 8px">
      <option value="">— Équipe —</option>${opts}
    </select>
    <input type="date" class="input mm-tr-start" style="width:132px;font-size:12px;padding:5px 6px" title="Date d'arrivée">
    <input type="date" class="input mm-tr-end" style="width:132px;font-size:12px;padding:5px 6px" title="Date de départ (vide = toujours actif)">
    <button class="icon-btn" type="button" onclick="this.closest('.mm-team-row').remove()" title="Supprimer">
      <span class="material-icons-round" style="font-size:16px;color:var(--danger)">delete</span>
    </button>`;
  if(assignment){
    div.querySelector('.mm-tr-team').value=assignment.teamId||'';
    div.querySelector('.mm-tr-start').value=assignment.startDate||'';
    div.querySelector('.mm-tr-end').value=assignment.endDate||'';
  }
  list.appendChild(div);
}
async function openMemberModal(id=null){
  editMemberId=id;
  const mg=S.config.mtg_grid||{dev:15,tech_lead:35,qa:20,squad_lead:45,po:50};
  const vg=S.config.vel_grid||{alternant:50,junior:70,intermediaire:85,senior:100};
  const m=id?S.team.find(t=>t.id==id):null;
  document.getElementById('member-modal-title').textContent=id?'Modifier le membre':'Nouveau membre';
  document.getElementById('mm-fname').value=m?.fname||'';document.getElementById('mm-lname').value=m?.lname||'';
  document.getElementById('mm-role').value=m?.role||'dev';document.getElementById('mm-level').value=m?.level||'intermediaire';
  document.getElementById('mm-know').value=m?.know||70;document.getElementById('mm-adapt').value=m?.adapt||80;
  document.getElementById('mm-vel').value=m?.velocity!=null?m.velocity:(vg[m?.level||'intermediaire']||85);
  document.getElementById('mm-mtg').value=m?.meetings||(mg[m?.role||'dev']||20);
  document.getElementById('mm-country').value=m?.country||'FR';
  // Affectations équipes (admin seulement)
  const isAdmin=['admin','super_admin'].includes(CU?.role);
  const teamsGroup=document.getElementById('mm-teams-group');
  const teamsList=document.getElementById('mm-teams-list');
  if(teamsGroup)teamsGroup.style.display=isAdmin?'':'none';
  if(teamsList){teamsList.innerHTML='';}
  if(isAdmin){
    try{_modalTeams=await API.get('/api/teams/all');}catch(e){_modalTeams=S.teams;}
    let assignments=[];
    if(id){try{assignments=await API.get('/api/team/'+id+'/teams');}catch(e){}}
    if(assignments.length){
      assignments.forEach(a=>addTeamRow(a));
    } else if(selectedTeamId){
      // Nouveau membre : pré-remplir avec l'équipe courante
      addTeamRow({teamId:selectedTeamId,startDate:'',endDate:''});
    }
  }
  document.getElementById('modal-member').classList.add('open');
}
async function saveMember(){
  const fname=document.getElementById('mm-fname').value.trim();
  const lname=document.getElementById('mm-lname').value.trim();
  if(!fname||!lname){toast('Prénom et nom obligatoires','error');return;}
  const velVal=document.getElementById('mm-vel').value;
  const obj={fname,lname,role:document.getElementById('mm-role').value,level:document.getElementById('mm-level').value,
    know:Number(document.getElementById('mm-know').value),adapt:Number(document.getElementById('mm-adapt').value),
    velocity:velVal!==''?Number(velVal):null,
    meetings:Number(document.getElementById('mm-mtg').value),
    country:document.getElementById('mm-country').value||'FR'};
  try{
    let memberId=editMemberId;
    if(editMemberId){await API.put('/api/team/'+editMemberId,obj);}
    else{const r=await API.post('/api/team',obj);memberId=r.id;}
    // Sauvegarder les affectations équipes
    const isAdmin=['admin','super_admin'].includes(CU?.role);
    if(isAdmin&&memberId){
      const rows=[...document.querySelectorAll('.mm-team-row')];
      const periods=rows.map(row=>({
        teamId:Number(row.querySelector('.mm-tr-team').value),
        startDate:row.querySelector('.mm-tr-start').value||null,
        endDate:row.querySelector('.mm-tr-end').value||null,
      })).filter(p=>p.teamId);
      await API.put('/api/team/'+memberId+'/teams',{periods});
    }
    await loadTeam();
    closeModal('modal-member');toast('Membre sauvegardé ✓','success');renderSettings();
  }catch(e){toast(e.error||'Erreur','error');}
}
function delMember(id){
  showConfirm('Supprimer ce membre de l\'équipe ?',async()=>{
    await API.del('/api/team/'+id);
    await loadTeam();renderSettings();toast('Membre supprimé','success');
  },'Supprimer le membre');
}

// ── USERS ────────────────────────────────────────────────
const ROLE_BADGE={super_admin:'badge-warning',admin:'badge-success',consultant:'badge-primary'};
const ROLE_LABEL={super_admin:'Super Admin',admin:'Admin',consultant:'Consultant'};
function renderUsers(){
  const isSA=CU?.role==='super_admin';
  document.getElementById('users-tbody').innerHTML=S.users.map(u=>{
    const isSelf=u.id==CU.id;
    const badge=`<span class="badge ${ROLE_BADGE[u.role]||'badge-primary'}">${ROLE_LABEL[u.role]||u.role}</span>`;
    let actions='<span style="color:var(--text3);font-size:12px">Vous</span>';
    if(!isSelf){
      if(isSA){
        const opts=['super_admin','admin','consultant'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('');
        actions=`<div style="display:flex;align-items:center;gap:6px">
          <select class="input" style="padding:4px 8px;font-size:12px;height:auto" onchange="setRole('${u.id}',this.value)">${opts}</select>
          <button class="icon-btn" onclick="delUser('${u.id}')" title="Supprimer"><span class="material-icons-round" style="font-size:16px;color:var(--danger)">delete</span></button>
        </div>`;
      } else {
        actions=`<button class="btn btn-outline btn-sm" onclick="toggleRole('${u.id}')"><span class="material-icons-round" style="font-size:14px">swap_horiz</span>${u.role==='admin'?'→ Consultant':'→ Admin'}</button>`;
      }
    }
    const teamBadges=(u._teamIds||[]).map(tid=>{const t=S.teams.find(x=>String(x.id)===String(tid));return t?`<span class="badge badge-primary" style="font-size:10px">${t.name}</span>`:''}).join(' ');
    const teamsCell=`<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">${teamBadges||'<span style="color:var(--text3);font-size:12px">—</span>'}${isSA||['admin','super_admin'].includes(CU?.role)?`<button class="icon-btn" onclick="openUserTeamsModal('${u.id}')" title="Éditer équipes" style="margin-left:4px"><span class="material-icons-round" style="font-size:14px">edit</span></button>`:''}</div>`;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar" style="width:28px;height:28px;font-size:11px">${(u.fname[0]||'')+(u.lname[0]||'')}</div><span>${u.fname} ${u.lname}</span></div></td>
      <td style="color:var(--text2)">${u.email}</td>
      <td>${badge}</td>
      <td>${teamsCell}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}
async function toggleRole(id){
  const u=S.users.find(x=>x.id==id);if(!u)return;
  await API.put('/api/users/'+id+'/role',{role:u.role==='admin'?'consultant':'admin'});
  await loadUsers();renderUsers();toast('Rôle mis à jour ✓','success');
}
async function setRole(id,role){
  try{
    await API.put('/api/users/'+id+'/role',{role});
    await loadUsers();renderUsers();toast('Rôle mis à jour ✓','success');
  }catch(e){toast(e.error||'Erreur','error');await loadUsers();renderUsers();}
}
async function delUser(id){
  const u=S.users.find(x=>x.id==id);if(!u)return;
  showConfirm(`Supprimer l'utilisateur ${u.fname} ${u.lname} ?`,async()=>{
    try{
      await API.del('/api/users/'+id);
      await loadUsers();renderUsers();toast('Utilisateur supprimé','success');
    }catch(e){toast(e.error||'Erreur','error');}
  },'Supprimer l\'utilisateur');
}

let editUserTeamsId=null;
async function openUserTeamsModal(userId){
  editUserTeamsId=userId;
  const u=S.users.find(x=>String(x.id)===String(userId));
  document.getElementById('ut-user-label').textContent=u?`${u.fname} ${u.lname}`:'';
  const current=u?._teamIds||[];
  document.getElementById('ut-teams-check').innerHTML=S.teams.map(t=>`
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--border);font-size:13px;font-weight:500">
      <input type="checkbox" value="${t.id}" ${current.includes(t.id)?'checked':''} style="accent-color:var(--primary)">
      ${t.name}
    </label>`).join('');
  document.getElementById('modal-user-teams').classList.add('open');
}
async function saveUserTeams(){
  const boxes=document.querySelectorAll('#ut-teams-check input[type=checkbox]');
  const teamIds=[...boxes].filter(b=>b.checked).map(b=>Number(b.value));
  try{
    await API.put('/api/users/'+editUserTeamsId+'/teams',{teamIds});
    await loadUsers();renderUsers();closeModal('modal-user-teams');toast('Équipes mises à jour ✓','success');
  }catch(e){toast(e.error||'Erreur','error');}
}

// ── TEAMS ────────────────────────────────────────────────
function renderTeamsList(){
  const tl=document.getElementById('teams-list');if(!tl)return;
  tl.innerHTML=S.teams.length===0?'<p style="color:var(--text3);font-size:13px">Aucune équipe</p>'
    :S.teams.map(t=>{
      const m=t.scoring_method||'rice';
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <input class="input" style="width:130px;font-size:13px;font-weight:600"
        value="${(t.name||'').replace(/"/g,'&quot;')}"
        placeholder="Nom de l'équipe"
        onchange="saveTeamName(${t.id},this.value.trim(),this)"
        title="Nom de l'équipe">
      <input class="input" style="flex:1;min-width:220px;font-size:12px;font-family:monospace"
        placeholder="UID Jira (ex: dfec288c-42b6-4000-…)"
        value="${t.jira_team_id||''}"
        onchange="saveTeamJiraId(${t.id},this.value.trim())"
        title="UID de l'équipe dans Jira (champ Team[Team])">
      <div style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg2);border-radius:var(--radius-md);border:1px solid var(--border)" title="Méthode de scoring">
        <button onclick="saveTeamScoringMethod(${t.id},'rice')" style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:none;cursor:pointer;transition:all var(--transition);background:${m==='rice'?'var(--primary)':'transparent'};color:${m==='rice'?'#fff':'var(--text3)'}">RICE</button>
        <button onclick="saveTeamScoringMethod(${t.id},'rricce')" style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:none;cursor:pointer;transition:all var(--transition);background:${m==='rricce'?'var(--primary)':'transparent'};color:${m==='rricce'?'#fff':'var(--text3)'}">RRICCE</button>
      </div>
      <button class="icon-btn" onclick="delTeam('${t.id}')" title="Supprimer"><span class="material-icons-round" style="font-size:16px;color:var(--danger)">delete</span></button>
    </div>`;}).join('');
}
async function saveTeamName(id, name, el){
  if(!name){toast('Le nom ne peut pas être vide','error');if(el){const t=S.teams.find(t=>t.id==id);if(t)el.value=t.name;}return;}
  const t=S.teams.find(t=>t.id==id);if(!t)return;
  try{
    await API.put('/api/teams/'+id,{name,jiraTeamId:t.jira_team_id||undefined,scoringMethod:t.scoring_method||'rice'});
    t.name=name;
    toast('Équipe renommée ✓','success');
  }catch(e){toast(e.error||'Erreur','error');if(el)el.value=t.name;}
}
async function saveTeamJiraId(id, jiraTeamId){
  const t=S.teams.find(t=>t.id==id);if(!t)return;
  try{
    await API.put('/api/teams/'+id,{name:t.name,jiraTeamId,scoringMethod:t.scoring_method||'rice'});
    t.jira_team_id=jiraTeamId||null;
    toast('UID Jira sauvegardé ✓','success');
  }catch(e){toast(e.error||'Erreur','error');}
}
async function saveTeamScoringMethod(id, method){
  const t=S.teams.find(t=>t.id==id);if(!t)return;
  try{
    await API.put('/api/teams/'+id,{name:t.name,jiraTeamId:t.jira_team_id||undefined,scoringMethod:method});
    t.scoring_method=method;
    renderTeamsList();
    toast('Méthode mise à jour ✓','success');
  }catch(e){toast(e.error||'Erreur','error');}
}
async function setBlMethod(method){
  if(!selectedTeamId)return;
  const t=S.teams.find(t=>String(t.id)===String(selectedTeamId));if(!t)return;
  try{
    await API.put('/api/teams/'+t.id,{name:t.name,jiraTeamId:t.jira_team_id||undefined,scoringMethod:method});
    t.scoring_method=method;
    renderBacklog();
  }catch(e){toast(e.error||'Erreur','error');}
}
async function addTeam(){
  const inp=document.getElementById('new-team-name');
  const inpUid=document.getElementById('new-team-jira-uid');
  const name=(inp?.value||'').trim();if(!name)return;
  const jiraTeamId=(inpUid?.value||'').trim()||undefined;
  try{
    const t=await API.post('/api/teams',{name,jiraTeamId});
    S.teams.push(t);inp.value='';if(inpUid)inpUid.value='';renderTeamsList();toast('Équipe créée ✓','success');
  }catch(e){toast(e.error||'Erreur','error');}
}
async function delTeam(id){
  showConfirm('Supprimer cette équipe ?',async()=>{
    try{
      await API.del('/api/teams/'+id);
      S.teams=S.teams.filter(t=>String(t.id)!==String(id));renderTeamsList();toast('Équipe supprimée','success');
    }catch(e){toast(e.error||'Erreur','error');}
  },'Supprimer l\'équipe');
}

// ── NOTE PANEL ───────────────────────────────────────────
let _noteQuill=null,_noteItemId=null,_noteDirty=false,_noteReadOnly=false;

function noteStripHtml(html){
  const d=document.createElement('div');d.innerHTML=html||'';
  return (d.textContent||d.innerText||'').replace(/\s+/g,' ').trim();
}
function loadQuill(){
  return new Promise(res=>{
    if(window.Quill){res();return;}
    const lnk=document.createElement('link');lnk.rel='stylesheet';
    lnk.href='https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.snow.min.css';
    document.head.appendChild(lnk);
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.min.js';
    s.onload=res;document.head.appendChild(s);
  });
}
async function openNotePanel(itemId){
  const item=S.backlog.find(r=>r.id==itemId);if(!item)return;
  _noteItemId=itemId;
  _noteReadOnly=!['admin','super_admin'].includes(CU?.role);
  document.getElementById('note-panel-jira').textContent=item.jira_id||'Sans ID Jira';
  document.getElementById('note-panel-lbl').textContent=item.label||'Sans titre';
  document.getElementById('note-panel-hint').textContent=_noteReadOnly?'Lecture seule':'Sauvegarde automatique à la fermeture';
  document.getElementById('note-backdrop').classList.add('open');
  document.getElementById('note-panel').classList.add('open');
  await loadQuill();
  const body=document.getElementById('note-panel-body');
  if(!_noteQuill){
    body.innerHTML=`
      <div id="note-quill-toolbar">
        <span class="ql-formats"><button class="ql-bold"></button><button class="ql-italic"></button><button class="ql-underline"></button><button class="ql-strike"></button></span>
        <span class="ql-formats"><button class="ql-list" value="bullet"></button><button class="ql-list" value="ordered"></button></span>
        <span class="ql-formats"><select class="ql-header"><option selected></option><option value="1"></option><option value="2"></option></select></span>
        <span class="ql-formats"><button class="ql-blockquote"></button><button class="ql-clean"></button></span>
      </div>
      <div id="note-quill-editor" style="flex:1"></div>`;
    _noteQuill=new Quill('#note-quill-editor',{
      modules:{toolbar:'#note-quill-toolbar'},
      placeholder:'Saisissez vos notes, observations, contexte…',
      theme:'snow'
    });
    _noteQuill.on('text-change',()=>{_noteDirty=true;});
    // Echap pour fermer
    _noteQuill.keyboard.addBinding({key:27},()=>closeNotePanel());
  }
  _noteQuill.enable(!_noteReadOnly);
  document.getElementById('note-quill-toolbar').style.display=_noteReadOnly?'none':'block';
  _noteQuill.root.innerHTML=item.note||'';
  _noteDirty=false;
  if(!_noteReadOnly)setTimeout(()=>_noteQuill.focus(),300);
}
async function closeNotePanel(){
  if(_noteDirty&&_noteItemId!==null&&!_noteReadOnly){
    await _saveNote(_noteItemId,_noteQuill.root.innerHTML);
  }
  document.getElementById('note-backdrop').classList.remove('open');
  document.getElementById('note-panel').classList.remove('open');
  _noteItemId=null;_noteDirty=false;
}
async function _saveNote(itemId,html){
  const clean=html==='<p><br></p>'||html==='<p></p>'?'':html;
  const item=S.backlog.find(r=>r.id==itemId);if(!item)return;
  item.note=clean;
  // Mettre à jour l'icône sans re-render complet
  const btn=document.getElementById('bl-note-'+itemId);
  if(btn){
    btn.className='bl-note-btn'+(clean?' has-note':'');
    btn.querySelector('.material-icons-round').textContent=clean?'sticky_note_2':'note_add';
    if(clean){
      btn.removeAttribute('title');
      btn.onmouseenter=e=>showNoteTip(e,itemId);
      btn.onmouseleave=()=>hideNoteTip();
    } else {
      btn.title='Ajouter une note';
      btn.onmouseenter=null;btn.onmouseleave=null;
    }
  }
  try{await API.put('/api/backlog/'+itemId+'/note',{note:clean});}
  catch(e){toast('Erreur sauvegarde note','error');}
}
// Fermer avec Echap depuis n'importe où
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.getElementById('note-panel')?.classList.contains('open'))
    closeNotePanel();
});

// ── BACKLOG ───────────────────────────────────────────────
let blSort={col:'score',dir:'desc'};
let blActiveTab='prio';
let blLabelW=Number(localStorage.getItem('bl_label_w'))||220;
let blGanttLeftW=Number(localStorage.getItem('bl_gantt_left_w'))||260;
let blGanttExpanded  = new Set(); // jiraIds actuellement développés
let blGanttChildren  = {};        // cache : jiraId → tableau d'enfants
let blChildPositions = {};        // cache : jiraId → { offset_px, sprint_name }
let blPrioExpanded   = new Set(); // jiraIds ouverts dans l'onglet priorisation
let _ganttMeta = { totalW: 0, ROW_H: 40, PX: 10, toX: null, bc: null };
let _blL3=136; // mis à jour au rendu, utilisé par le resize handler

function blStartLabelResize(e){
  e.preventDefault();e.stopPropagation();
  const startX=e.clientX,startW=blLabelW;
  document.body.style.cursor='col-resize';
  document.body.style.userSelect='none';
  const onMove=e=>{
    blLabelW=Math.max(80,Math.min(600,startW+e.clientX-startX));
    document.documentElement.style.setProperty('--bl-label-w',blLabelW+'px');
    document.documentElement.style.setProperty('--bl-L4',(_blL3+blLabelW)+'px');
  };
  const onUp=()=>{
    document.body.style.cursor='';
    document.body.style.userSelect='';
    localStorage.setItem('bl_label_w',blLabelW);
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
  };
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

function blStartGanttResize(e){
  e.preventDefault();e.stopPropagation();
  const startX=e.clientX,startW=blGanttLeftW;
  document.body.style.cursor='col-resize';
  document.body.style.userSelect='none';
  const onMove=e=>{
    blGanttLeftW=Math.max(120,Math.min(600,startW+e.clientX-startX));
    document.documentElement.style.setProperty('--gantt-left-w',blGanttLeftW+'px');
  };
  const onUp=()=>{
    document.body.style.cursor='';
    document.body.style.userSelect='';
    localStorage.setItem('bl_gantt_left_w',blGanttLeftW);
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
  };
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}
function switchBlTab(tab){
  blActiveTab=tab;
  document.getElementById('bl-tab-prio').classList.toggle('active',tab==='prio');
  document.getElementById('bl-tab-chrono').classList.toggle('active',tab==='chrono');
  document.getElementById('bl-view-prio').style.display=tab==='prio'?'flex':'none';
  document.getElementById('bl-view-chrono').style.display=tab==='chrono'?'block':'none';
  const isAdmin=['admin','super_admin'].includes(CU?.role);
  const addBtn=document.getElementById('bl-add-btn');
  if(addBtn)addBtn.style.display=tab==='chrono'||!isAdmin?'none':'';
  const syncBtn=document.getElementById('bl-sync-btn');
  if(syncBtn)syncBtn.style.display=tab==='chrono'||!isAdmin?'none':'inline-flex';
  const filterSel=document.getElementById('bl-filter-sprint');
  if(filterSel)filterSel.style.display=tab==='chrono'?'none':'block';
  const objSel=document.getElementById('bl-filter-obj');
  if(objSel)objSel.style.display='block';
  const methodWrap=document.getElementById('bl-method-wrap');
  if(methodWrap)methodWrap.style.display=tab==='chrono'?'none':'flex';
  if(tab==='chrono')renderGantt();
}

const BL_REACH_TIPS='20 pts : 0-40% des utilisateurs\n40 pts : 40-60% des utilisateurs\n80 pts : 60-80% des utilisateurs\n100 pts : 100% des utilisateurs';
const BL_IMPACT_TIPS='20 pts : Irritant faible\n40 pts : Irritant fort / Bug bloquant\n80 pts : Besoin réglementaire / conformité\n100 pts : Impact business direct';
const BL_CONF_TIPS='20 pts : Hypothèse, intuition\n40 pts : Quelques retours utilisateurs\n80 pts : Retours support et terrain\n100 pts : Metrics, tests utilisateurs et réglementation';
const BL_EFFORT_TIPS='1 : jusqu\'à 1 semaine\n2 : jusqu\'à 2 semaines\n3 : 1 sprint\n5 : 2 sprints\n8 : 3 sprints ou plus';
const BL_RISK_TIPS='1 : Aucun risque si non livré, fonctionnalité optionnelle\n2 : Insatisfaction utilisateur probable mais tolérable\n5 : Perte de clients ou dégradation significative de l\'expérience\n8 : Risque légal, financier ou perte majeure de clients si non livré';
const BL_CRIT_TIPS='1 : Nice to have, aucune urgence\n2 : Demande récurrente mais non bloquante\n5 : Engagement client ou deadline connue\n8 : Bloquant, obligation légale ou incident en production';

function currentTeamMethod(){
  const t=S.teams.find(t=>String(t.id)===String(selectedTeamId));
  return t?.scoring_method||'rice';
}
function riceScore(r){
  if(!r.effort)return 0;
  if(currentTeamMethod()==='rricce')
    return Math.round((r.reach*r.risk*r.impact*r.criticality*r.confidence)/r.effort);
  return Math.round((r.reach*r.impact*r.confidence)/r.effort);
}

function infoIcon(tip){
  return `<span class="rice-info" data-tip="${tip.replace(/"/g,'&quot;')}" onmouseenter="showBlTip(event,this)" onmouseleave="hideBlTip()"><span class="material-icons-round">info</span></span>`;
}
function showBlTip(e,el){
  const tip=document.getElementById('bl-tip');
  tip.innerHTML=(el.dataset.tip||'').replace(/\n/g,'<br>');
  tip.style.display='block';
  posBlTip(e);
}
function posBlTip(e){
  const tip=document.getElementById('bl-tip');if(!tip||tip.style.display==='none')return;
  const m=8,w=tip.offsetWidth,h=tip.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let x=e.clientX+12,y=e.clientY-h-8;
  if(x+w>vw-m)x=e.clientX-w-12;
  if(y<m)y=e.clientY+12;
  tip.style.left=x+'px';tip.style.top=y+'px';
}
function hideBlTip(){const tip=document.getElementById('bl-tip');if(tip)tip.style.display='none';}
function showNoteTip(e,itemId){
  const item=S.backlog.find(r=>r.id==itemId);
  if(!item?.note)return;
  const tip=document.getElementById('note-tip');
  tip.innerHTML=item.note;
  tip.style.display='block';
  posNoteTip(e);
}
function posNoteTip(e){
  const tip=document.getElementById('note-tip');if(!tip||tip.style.display==='none')return;
  const m=12,vw=window.innerWidth,vh=window.innerHeight;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+18,y=e.clientY-Math.round(h/2);
  if(x+w>vw-m)x=e.clientX-w-18;
  if(y<m)y=m;
  if(y+h>vh-m)y=vh-h-m;
  tip.style.left=x+'px';tip.style.top=y+'px';
}
function hideNoteTip(){const tip=document.getElementById('note-tip');if(tip)tip.style.display='none';}

function blSortIcon(col){
  if(blSort.col!==col)return `<span class="material-icons-round sort-icon">unfold_more</span>`;
  return `<span class="material-icons-round sort-icon">${blSort.dir==='asc'?'arrow_upward':'arrow_downward'}</span>`;
}

function toggleBlSort(col){
  if(blSort.col===col)blSort.dir=blSort.dir==='asc'?'desc':'asc';
  else{blSort.col=col;blSort.dir=col==='score'?'desc':'asc';}
  renderBacklog();
}

function _initObjFilter(){
  const sel=document.getElementById('bl-filter-obj');
  if(!sel||!S.objectivesData)return;
  const teamKey=String(selectedTeamId||'');
  if(sel.dataset.teamKey===teamKey&&sel.options.length>1)return;
  sel.dataset.teamKey=teamKey;
  const{objectives}=S.objectivesData;
  const prev=sel.value;
  const opts=['<option value="">Tous</option>'];
  Object.entries(objectives||{}).forEach(([k,feats])=>{
    if(k==='__orphan__'||k.startsWith('__unresolved__'))return;
    const visible=selectedTeamId?feats.filter(f=>String(f.team_id)===teamKey):feats;
    if(visible.length===0)return;
    if(visible.every(f=>f.done))return;
    opts.push(`<option value="${encodeURIComponent(k)}">${k}</option>`);
  });
  opts.push('<option value="__orphan__">Sans objectif</option>');
  sel.innerHTML=opts.join('');
  if(prev)sel.value=prev;
}

function onObjFilterChange(){
  if(blActiveTab==='chrono')renderGantt();
  else renderBacklog();
}

function renderGantt(){
  _initObjFilter();
  const sel=document.getElementById('bl-filter-obj');
  const objVal=sel?sel.value:'';
  let items=S.backlog||[];
  if(objVal==='__orphan__'){
    const allIds=new Set();
    Object.entries(S.objectivesData?.objectives||{}).forEach(([k,feats])=>{
      if(k!=='__orphan__')feats.forEach(f=>allIds.add(f.jira_id));
    });
    items=items.filter(r=>!allIds.has(r.jira_id));
  } else if(objVal&&S.objectivesData){
    const key=decodeURIComponent(objVal);
    const feats=S.objectivesData.objectives[key]||[];
    const ids=new Set(feats.map(f=>f.jira_id));
    items=items.filter(r=>ids.has(r.jira_id));
  }
  renderGanttFor(items,'bl-gantt-wrap');
}

function renderGanttFor(backlogItems, wrapId){
  const wrap=document.getElementById(wrapId);
  if(!wrap)return;
  const JIRA='https://isagri.atlassian.net/browse/';
  const mob=window.innerWidth<640;
  const PX=mob?5:10; // px par jour
  const ROW_H=40,MH=36,SH=36;
  _ganttMeta.ROW_H = ROW_H;
  _ganttMeta.PX = PX;
  // WI avec sprint planifié, triés par sprint puis score RICE décroissant
  const items=(backlogItems||[]).filter(r=>r.sprint_id).sort((a,b)=>{
    const sa=S.sprints.find(s=>String(s.id)===String(a.sprint_id));
    const sb=S.sprints.find(s=>String(s.id)===String(b.sprint_id));
    const da=sa?.start?new Date(sa.start):new Date('9999-01-01');
    const db=sb?.start?new Date(sb.start):new Date('9999-01-01');
    return da-db||riceScore(b)-riceScore(a);
  });
  if(!items.length){
    wrap.innerHTML=`<div class="gantt-empty">Aucun Work Item avec sprint planifié.<br><span style="font-size:12px">Assigne un sprint dans l'onglet Priorisation pour visualiser la chronologie.</span></div>`;
    return;
  }
  // Plage de dates
  const today=new Date();today.setHours(0,0,0,0);
  // Début = premier jour du premier sprint non clôturé (sinon début du mois courant)
  const firstOpenSprint=S.sprints.filter(s=>!s.closed&&s.start).sort((a,b)=>new Date(a.start)-new Date(b.start))[0];
  const gStart=firstOpenSprint?new Date(firstOpenSprint.start):new Date(today.getFullYear(),today.getMonth(),1);
  gStart.setHours(0,0,0,0);
  let gEnd=new Date(today.getTime()+90*86400000);
  S.sprints.forEach(s=>{if(s.end){const e=new Date(s.end);if(e>gEnd)gEnd=e;}});
  gEnd=new Date(gEnd.getFullYear(),gEnd.getMonth()+2,0);
  const totalDays=Math.ceil((gEnd-gStart)/86400000)+1;
  const totalW=totalDays*PX;
  _ganttMeta.totalW = totalW;
  _ganttMeta.gStart = gStart;
  const toX=d=>{const dt=new Date(d);dt.setHours(0,0,0,0);return Math.round((dt-gStart)/86400000)*PX;};
  _ganttMeta.toX = toX;
  // Sprints triés par date de début
  const sortedSprints=S.sprints.filter(s=>s.start&&s.end).sort((a,b)=>new Date(a.start)-new Date(b.start));
  // Durée d'un sprint en jours (+1 car end est inclusif dans l'affichage)
  const sprintDays=s=>s?.start&&s?.end?Math.ceil((new Date(s.end)-new Date(s.start))/86400000)+1:14;
  // Retourne { days, firstStartX } pour les N sprints se terminant sur sp (inclus) + gaps inter-sprints
  const nSprintsBack=(sp,n)=>{
    const idx=sortedSprints.findIndex(s=>String(s.id)===String(sp?.id));
    if(idx===-1)return{days:sprintDays(sp)*n,firstStartX:toX(sp?.start)};
    const slice=sortedSprints.slice(Math.max(0,idx-n+1),idx+1);
    let days=slice.reduce((sum,s)=>sum+sprintDays(s),0);
    for(let i=0;i<slice.length-1;i++){
      const gap=Math.ceil((new Date(slice[i+1].start)-new Date(slice[i].end))/86400000)-1;
      if(gap>0)days+=gap;
    }
    return{days,firstStartX:toX(slice[0].start)};
  };
  // Sprints visibles triés
  const vSprints=S.sprints.filter(s=>s.start&&s.end&&new Date(s.end)>=gStart&&new Date(s.start)<=gEnd).sort((a,b)=>new Date(a.start)-new Date(b.start));
  _ganttMeta.vSprints = vSprints;
  // Mois
  const months=[];
  let mc=new Date(gStart);
  while(mc<=gEnd){
    const ms=new Date(mc.getFullYear(),mc.getMonth(),1);
    const me=new Date(mc.getFullYear(),mc.getMonth()+1,0);
    const cs=ms<gStart?gStart:ms,ce=me>gEnd?gEnd:me;
    const w=(Math.ceil((ce-cs)/86400000)+1)*PX;
    months.push({label:ms.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}),w,today:today>=ms&&today<=me});
    mc=new Date(mc.getFullYear(),mc.getMonth()+1,1);
  }
  // Cellules sprints avec gaps
  const sCells=[];let pos=0;
  vSprints.forEach(s=>{
    const ss=new Date(s.start);ss.setHours(0,0,0,0);
    const se=new Date(s.end);se.setHours(0,0,0,0);
    const cSs=ss<gStart?gStart:ss,cSe=se>gEnd?gEnd:se;
    const x=toX(cSs);
    const w=Math.max(PX,(Math.ceil((cSe-cSs)/86400000)+1)*PX);
    if(x>pos)sCells.push({gap:true,w:x-pos});
    sCells.push({gap:false,s,w,cur:ss<=today&&se>=today});
    pos=x+w;
  });
  if(pos<totalW)sCells.push({gap:true,w:totalW-pos});
  // Ligne aujourd'hui
  const todX=toX(today);
  const showTod=todX>=0&&todX<=totalW;
  // Palette de couleurs pour les barres
  const COLS=['#7c3aed','#e05c3a','#0891b2','#d97706','#059669','#db2777','#0f766e','#c2410c'];
  const bc=id=>COLS[Math.abs(id)%COLS.length];
  _ganttMeta.bc = bc;
  // === HTML ===
  // Colonne gauche
  const leftRows=items.map(r=>{
    const href=r.jira_id?`${JIRA}${encodeURIComponent(r.jira_id)}`:null;
    const lbl=(r.label||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const expandBtn=r.jira_id
      ?`<button class="gantt-expand-btn${blGanttExpanded.has(r.jira_id)?' open':''}" onclick="toggleGanttFeature('${r.jira_id}')" title="Tickets enfants"><span class="material-icons-round">chevron_right</span></button>`
      :`<span class="gantt-expand-placeholder"></span>`;
    return `<div class="gantt-left-wi" style="height:${ROW_H}px" data-gantt-id="${r.jira_id||r.id}" title="${lbl}">
      ${expandBtn}
      ${href?`<a class="gantt-wi-id" href="${href}" target="_blank" rel="noopener">${r.jira_id}</a>`:`<span class="gantt-wi-id" style="color:var(--text3)">—</span>`}
      <span class="gantt-wi-label">${lbl||'—'}</span>
    </div>`;
  }).join('');
  // En-tête mois
  const mHtml=months.map(m=>`<div class="gantt-month-cell ${m.today?'is-today-month':''}" style="width:${m.w}px">${m.label}</div>`).join('');
  // En-tête sprints
  const sHtml=sCells.map(c=>c.gap
    ?`<div class="gantt-sprint-cell is-gap" style="width:${c.w}px"></div>`
    :`<div class="gantt-sprint-cell ${c.cur?'is-current':''}" data-sprint-id="${c.s.id}" style="width:${c.w}px">
      ${c.cur?'<span class="material-icons-round" style="font-size:10px;flex-shrink:0">radio_button_checked</span>':''}
      <span style="overflow:hidden;text-overflow:ellipsis">${c.s.name}</span>
    </div>`).join('');
  // Barres WI — la barre SE TERMINE à la fin du sprint (date de livraison)
  // et L'EFFORT détermine la durée (donc le début de la barre)
  const bHtml=items.map(r=>{
    const sp=S.sprints.find(s=>String(s.id)===String(r.sprint_id));
    if(!sp?.start||!sp?.end)return `<div class="gantt-wi-row" style="width:${totalW}px;height:${ROW_H}px" data-gantt-bar-id="${r.jira_id||r.id}"></div>`;
    const spStartX=toX(sp.start);
    const spW=toX(sp.end)+PX-spStartX;               // largeur totale du sprint assigné
    const e=r.effort;
    let bx,bw,showOutline=false;
    if(!e||e<=3){
      // effort 0/3 = 1 sprint entier ; effort 1 = 7j ; effort 2 = 14j (+ contour fantôme)
      const {days,firstStartX}=nSprintsBack(sp,1);
      if(!e||e===3){bx=firstStartX;bw=days*PX;}
      else{bx=spStartX;bw=Math.min((e<=1?7:14)*PX,spW);showOutline=true;}
    } else if(e<=5){
      const {days,firstStartX}=nSprintsBack(sp,2);
      bx=firstStartX;bw=days*PX;
    } else {
      const {days,firstStartX}=nSprintsBack(sp,3);
      bx=firstStartX;bw=days*PX;
    }
    bw=Math.max(16,bw);
    const href=r.jira_id?`${JIRA}${encodeURIComponent(r.jira_id)}`:null;
    const lbl=(r.label||'').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const sc=riceScore(r);
    const isAdminG=['admin','super_admin'].includes(CU?.role);
    const outlineHtml=showOutline?`<div class="gantt-bar-sprint-outline" data-outline-for="${r.id}" style="left:${spStartX}px;width:${spW}px;border-color:${bc(r.id)}"></div>`:'';
    const dragFeatAttrs=isAdminG
      ?` data-drag-feat="${r.id}" data-drag-feat-sprint="${sp.id}" data-drag-bw-feat="${bw}" style="left:${bx}px;width:${bw}px;background:${bc(r.id)};height:24px;cursor:grab"`
      :` style="left:${bx}px;width:${bw}px;background:${bc(r.id)};height:24px"`;
    return `<div class="gantt-wi-row" style="width:${totalW}px;height:${ROW_H}px" data-gantt-bar-id="${r.jira_id||r.id}">
      ${outlineHtml}
      <div class="gantt-bar"${dragFeatAttrs} title="${lbl} · RICE: ${sc||'—'} · Effort: ${r.effort||0}">
        <span class="gantt-bar-label">${r.jira_id||lbl}</span>
        ${href?`<a class="gantt-bar-link" href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><span class="material-icons-round">open_in_new</span></a>`:''}
      </div>
    </div>`;
  }).join('');
  // Ligne today
  const todHtml=showTod?`<div class="gantt-today-line" style="left:${todX}px;background:var(--primary)"><div class="gantt-today-dot" style="background:var(--primary)"></div></div>`:'';
  document.documentElement.style.setProperty('--gantt-left-w',blGanttLeftW+'px');
  wrap.innerHTML=`<div class="gantt-wrap">
    <div class="gantt-left">
      <div class="gantt-left-head-row" style="height:${MH}px">Tickets</div>
      <div class="gantt-left-head-row" style="height:${SH}px">Sprints</div>
      ${leftRows}
      <div class="gantt-left-resize" onmousedown="blStartGanttResize(event)"></div>
    </div>
    <div class="gantt-right">
      <div class="gantt-timeline" style="width:${totalW}px;position:relative">
        ${todHtml}
        <div class="gantt-months-row">${mHtml}</div>
        <div class="gantt-sprints-row">${sHtml}</div>
        <div class="gantt-body-rows">${bHtml}</div>
      </div>
    </div>
  </div>`;
  // Ré-afficher les enfants déjà chargés (re-render après changement d'équipe/sprint)
  blGanttExpanded.forEach(jiraId => {
    if (blGanttChildren[jiraId]) _renderGanttChildren(jiraId, blGanttChildren[jiraId]);
  });
  // Activer le drag sur les barres enfants (admin uniquement, délégation sur le conteneur)
  if (['admin','super_admin'].includes(CU?.role)) {
    const ganttRight = wrap.querySelector('.gantt-right');
    if (ganttRight && !ganttRight._dragInit) {
      ganttRight._dragInit = true;
      initGanttChildDrag(ganttRight);
    }
  }
}

async function toggleGanttFeature(jiraId) {
  const leftRow = document.querySelector(`.gantt-left-wi[data-gantt-id="${jiraId}"]`);
  if (!leftRow) return;
  const btn = leftRow.querySelector('.gantt-expand-btn');
  const isOpen = blGanttExpanded.has(jiraId);

  if (isOpen) {
    blGanttExpanded.delete(jiraId);
    document.querySelectorAll(`.gantt-left-wi[data-gantt-parent="${jiraId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`.gantt-wi-row[data-gantt-parent="${jiraId}"]`).forEach(el => el.remove());
    btn?.classList.remove('open');
  } else {
    blGanttExpanded.add(jiraId);
    btn?.classList.add('loading');
    if (!blGanttChildren[jiraId]) {
      try {
        blGanttChildren[jiraId] = await API.get(`/api/jira/children?key=${encodeURIComponent(jiraId)}`);
      } catch (e) {
        blGanttChildren[jiraId] = [];
        toast('Impossible de charger les tickets enfants', 'error');
      }
    }
    btn?.classList.remove('loading');
    btn?.classList.add('open');
    // Charger les positions sauvegardées
    const kids = blGanttChildren[jiraId] || [];
    const keys = kids.map(c => c.jira_id).filter(Boolean);
    if (keys.length) {
      try {
        const pos = await API.get(`/api/children/positions?keys=${keys.map(encodeURIComponent).join(',')}`);
        Object.assign(blChildPositions, pos);
      } catch {}
    }
    _renderGanttChildren(jiraId, blGanttChildren[jiraId]);
  }
}

// Retourne le sprint correspondant à une position x (pixels) dans le Gantt
function sprintAtX(x) {
  const { vSprints, toX } = _ganttMeta;
  if (!vSprints || !toX) return null;
  return vSprints.find(s => {
    const sx = toX(s.start);
    const ex = toX(s.end) + _ganttMeta.PX;
    return x >= sx && x < ex;
  }) || null;
}

function _renderGanttChildren(jiraId, children) {
  const leftRow = document.querySelector(`.gantt-left-wi[data-gantt-id="${jiraId}"]`);
  const barRow  = document.querySelector(`.gantt-wi-row[data-gantt-bar-id="${jiraId}"]`);
  if (!leftRow || !barRow) return;

  // Supprimer les lignes enfants existantes avant re-render
  document.querySelectorAll(`.gantt-left-wi[data-gantt-parent="${jiraId}"]`).forEach(el => el.remove());
  document.querySelectorAll(`.gantt-wi-row[data-gantt-parent="${jiraId}"]`).forEach(el => el.remove());

  const { totalW, ROW_H, PX, toX, bc } = _ganttMeta;
  const JIRA = 'https://isagri.atlassian.net/browse/';
  // Barème SP → jours ouvrés
  const PT_DAYS = { 0.5:0.5, 1:1, 2:2, 3:3, 5:7, 8:14, 13:21 };

  // Sprint et couleur du parent
  const parentItem = S.backlog.find(b => b.jira_id === jiraId);
  const parentSprint = parentItem ? S.sprints.find(s => String(s.id) === String(parentItem.sprint_id)) : null;
  const parentColor = bc ? bc(parentItem?.id ?? 0) : '#6b7280';

  if (!children.length) {
    const lEl = document.createElement('div');
    lEl.className = 'gantt-left-wi gantt-child-wi'; lEl.dataset.ganttParent = jiraId;
    lEl.style.height = ROW_H + 'px';
    lEl.innerHTML = `<span class="gantt-expand-placeholder"></span><span style="font-size:11px;color:var(--text3)">Aucun ticket enfant</span>`;
    leftRow.after(lEl);
    const bEl = document.createElement('div');
    bEl.className = 'gantt-wi-row'; bEl.dataset.ganttParent = jiraId;
    bEl.style.cssText = `width:${totalW}px;height:${ROW_H}px`;
    barRow.after(bEl);
    return;
  }

  const isAdmin = ['admin','super_admin'].includes(CU?.role);
  let lastLeft = leftRow, lastBar = barRow;
  let hasChildInLaterSprint = false;

  children.forEach(child => {
    const lbl = (child.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const href = child.jira_id ? `${JIRA}${encodeURIComponent(child.jira_id)}` : null;
    const done = ['10 - termine', '9 - a livrer en prod'].includes(child.status.trim().toLowerCase());

    // Ligne gauche
    const lEl = document.createElement('div');
    lEl.className = 'gantt-left-wi gantt-child-wi' + (done ? ' done' : ''); lEl.dataset.ganttParent = jiraId;
    lEl.style.height = ROW_H + 'px'; lEl.title = lbl;
    lEl.innerHTML = `
      <span class="gantt-expand-placeholder"></span>
      ${href ? `<a class="gantt-wi-id" href="${href}" target="_blank" rel="noopener" style="font-size:10px">${child.jira_id}</a>` : '<span class="gantt-wi-id" style="color:var(--text3)">—</span>'}
      <span class="gantt-wi-label" style="font-size:11px;color:var(--text2)">${lbl||'—'}</span>
      <span class="gantt-child-type-badge">${child.type||''}</span>
    `;
    lastLeft.after(lEl); lastLeft = lEl;

    // Barre droite — si pas de sprint Jira sur l'enfant, on utilise le sprint de la feature parente
    const savedPos = child.jira_id ? blChildPositions[child.jira_id] : null;
    const effectiveSprintName = savedPos?.sprint_name || child.sprint_name;
    const sp = (effectiveSprintName && S.sprints.find(s => s.name === effectiveSprintName)) || parentSprint;

    // Warning si l'enfant est dans un sprint postérieur à celui du parent
    if (parentSprint && sp && sp.start && parentSprint.start && new Date(sp.start) > new Date(parentSprint.start)) {
      hasChildInLaterSprint = true;
    }

    let barHtml = '';
    if (sp?.start && sp?.end && toX) {
      const spStartX = toX(sp.start);
      const spEndX   = toX(sp.end) + PX;
      const days = PT_DAYS[child.points] ?? Math.min(child.points || 1, 10);
      const bw = Math.max(16, Math.min(days * PX, spEndX - spStartX));
      const offset = savedPos?.offset_px ?? 0;
      const startX = Math.max(spStartX, Math.min(spStartX + offset, spEndX - bw));
      const col = done ? '#9ca3af' : parentColor;
      const dragAttrs = isAdmin && child.jira_id
        ? ` data-drag-child="${child.jira_id}" data-drag-parent="${jiraId}" data-drag-bw="${bw}" style="left:${startX}px;width:${bw}px;background:${col};cursor:grab"`
        : ` style="left:${startX}px;width:${bw}px;background:${col}"`;
      barHtml = `<div class="gantt-bar gantt-child-bar${done?' done':''}"${dragAttrs} title="${lbl} · ${child.status}${child.points?' · '+child.points+' pts':''}">
        <span class="gantt-bar-label" style="font-size:10px">${child.jira_id||lbl}</span>
        ${href?`<a class="gantt-bar-link" href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><span class="material-icons-round">open_in_new</span></a>`:''}
      </div>`;
    }
    const bEl = document.createElement('div');
    bEl.className = 'gantt-wi-row'; bEl.dataset.ganttParent = jiraId;
    bEl.style.cssText = `width:${totalW}px;height:${ROW_H}px`;
    bEl.innerHTML = barHtml;
    lastBar.after(bEl); lastBar = bEl;
  });

  // Indicateur ⚠️ sur la barre parent si un enfant est dans un sprint ultérieur
  const parentBarEl = barRow.querySelector('.gantt-bar');
  if (parentBarEl) {
    parentBarEl.querySelectorAll('.gantt-child-warn').forEach(el => el.remove());
    if (hasChildInLaterSprint) {
      const warn = document.createElement('span');
      warn.className = 'gantt-child-warn material-icons-round';
      warn.title = 'Des tickets enfants sont planifiés dans un sprint ultérieur';
      warn.textContent = 'warning';
      parentBarEl.appendChild(warn);
    }
  }
}

// ── Drag horizontal des tickets enfants Gantt ─────────────
let _ganttDrag = null; // état courant du drag

// Listeners document attachés une seule fois (évite les doublons au re-render)
document.addEventListener('mousemove', e => {
  if (!_ganttDrag) return;
  const { bar, bw, startLeft, startMouseX, timeline, outline, startOutlineLeft } = _ganttDrag;
  const { totalW } = _ganttMeta;
  const dx = e.clientX - startMouseX;
  const newLeft = Math.max(0, Math.min(totalW - bw, startLeft + dx));
  bar.style.left = newLeft + 'px';
  // Déplacer l'outline (barre fantôme des features multi-sprint) solidairement
  if (outline) outline.style.left = (startOutlineLeft + dx) + 'px';

  // Surbrillance du sprint survolé
  if (timeline) {
    timeline.querySelectorAll('.gantt-sprint-cell').forEach(c => c.classList.remove('drag-over'));
    const sp = sprintAtX(newLeft + bw / 2);
    if (sp) {
      const cell = timeline.querySelector(`.gantt-sprint-cell[data-sprint-id="${sp.id}"]`);
      if (cell) cell.classList.add('drag-over');
    }
  }
});

document.addEventListener('mouseup', async e => {
  if (!_ganttDrag) return;
  const drag = _ganttDrag;
  const { type, bar, bw, startLeft, timeline, outline, startOutlineLeft } = drag;
  bar.style.cursor = 'grab';
  bar.classList.remove('gantt-dragging');
  document.body.style.userSelect = '';
  if (timeline) timeline.querySelectorAll('.gantt-sprint-cell').forEach(c => c.classList.remove('drag-over'));
  _ganttDrag = null;

  const finalLeft = parseInt(bar.style.left, 10);
  if (Math.abs(finalLeft - startLeft) < 2) return;

  const sp = sprintAtX(finalLeft + bw / 2);
  const snapBack = () => {
    bar.style.left = startLeft + 'px';
    if (outline) outline.style.left = startOutlineLeft + 'px';
  };
  if (!sp) { snapBack(); return; }
  if (sp.closed) { snapBack(); toast('Sprint clôturé — déplacement interdit', 'error'); return; }

  if (type === 'child') {
    const { childId, parentId } = drag;
    const { PX, toX } = _ganttMeta;
    const spStartX = toX(sp.start);
    const spEndX   = toX(sp.end) + PX;
    const offset = Math.max(0, Math.min(finalLeft - spStartX, spEndX - bw - spStartX));
    const child = (blGanttChildren[parentId] || []).find(c => c.jira_id === childId);
    const prevPos = blChildPositions[childId];
    const prevSprintName = prevPos?.sprint_name || child?.sprint_name || null;
    const sprintChanged = prevSprintName !== sp.name;
    try {
      await API.put('/api/children/position', { jira_id: childId, offset_px: offset, sprint_name: sp.name });
      blChildPositions[childId] = { offset_px: offset, sprint_name: sp.name };
    } catch {
      toast('Erreur lors de la sauvegarde de la position', 'error');
      snapBack(); return;
    }
    if (sprintChanged) {
      try {
        const res = await API.post('/api/jira/move-sprint', { jira_id: childId, sprint_name: sp.name });
        if (res.jira) { toast(`${childId} déplacé dans "${sp.name}"`, 'success'); if (child) child.sprint_name = sp.name; }
        else toast(`Position sauvegardée — Jira non mis à jour : ${res.reason || ''}`, 'warning');
      } catch { toast('Position sauvegardée — erreur Jira', 'warning'); }
    }
    _renderGanttChildren(parentId, blGanttChildren[parentId] || []);

  } else if (type === 'feat') {
    const { itemId } = drag;
    const item = S.backlog.find(r => String(r.id) === String(itemId));
    if (!item || String(item.sprint_id) === String(sp.id)) return;
    // blUpdate met à jour S.backlog, sauvegarde en DB et synchro Jira
    blUpdate(Number(itemId), { sprint_id: sp.id });
    // Re-render immédiat avec le nouvel état (blUpdate a déjà appliqué le patch)
    renderGantt();
  }
});

// Initialise le drag sur un conteneur (mousedown uniquement — délégation)
function initGanttChildDrag(container) {
  container.addEventListener('mousedown', e => {
    if (!['admin','super_admin'].includes(CU?.role)) return;
    if (e.target.closest('.gantt-bar-link')) return;

    // Drag feature (barre parent)
    const featBar = e.target.closest('[data-drag-feat]');
    if (featBar) {
      e.preventDefault(); e.stopPropagation();
      const itemId   = featBar.dataset.dragFeat;
      const bw       = parseInt(featBar.dataset.dragBwFeat, 10);
      const startLeft = parseInt(featBar.style.left, 10);
      const timeline  = featBar.closest('.gantt-timeline');
      const row       = featBar.closest('.gantt-wi-row');
      const outline   = row?.querySelector('.gantt-bar-sprint-outline') || null;
      _ganttDrag = {
        type: 'feat', bar: featBar, outline, itemId, bw, startLeft,
        startOutlineLeft: outline ? parseInt(outline.style.left, 10) : 0,
        startMouseX: e.clientX, timeline,
      };
      featBar.style.cursor = 'grabbing';
      featBar.classList.add('gantt-dragging');
      document.body.style.userSelect = 'none';
      return;
    }

    // Drag ticket enfant
    const childBar = e.target.closest('[data-drag-child]');
    if (!childBar) return;
    e.preventDefault(); e.stopPropagation();
    _ganttDrag = {
      type: 'child', bar: childBar,
      childId:    childBar.dataset.dragChild,
      parentId:   childBar.dataset.dragParent,
      bw:         parseInt(childBar.dataset.dragBw, 10),
      startLeft:  parseInt(childBar.style.left, 10),
      startMouseX: e.clientX,
      timeline:   childBar.closest('.gantt-timeline'),
      outline: null, startOutlineLeft: 0,
    };
    childBar.style.cursor = 'grabbing';
    childBar.classList.add('gantt-dragging');
    document.body.style.userSelect = 'none';
  });
}

function _statusDotPrio(s){
  const sl=(s||'').trim().toLowerCase();
  const done=['10 - termine','9 - a livrer en prod','8 - a tester en staging','7 - a livrer en staging'].some(x=>sl.includes(x));
  const inProg=['en cours','pull request','livrer en dev','tester en dev','ephemere'].some(x=>sl.includes(x));
  const col=done?'var(--success)':inProg?'var(--warning)':'var(--text3)';
  return `<span class="bl-child-dot" style="background:${col}" title="${(s||'—').replace(/"/g,'&quot;')}"></span>`;
}
function _renderPrioChildren(jiraId){
  const btn=document.querySelector(`.bl-prio-expand-btn[data-jira="${jiraId}"]`);
  if(!btn)return;
  const tr=btn.closest('tr');
  const existing=tr.nextElementSibling;
  if(existing?.classList.contains('bl-prio-children-row'))existing.remove();
  const children=blGanttChildren[jiraId]||[];
  const JIRA_BASE='https://isagri.atlassian.net/browse/';
  let inner;
  if(!children.length){
    inner=`<span style="color:var(--text3);font-size:12px;font-style:italic">Aucun ticket enfant</span>`;
  }else{
    inner=children.map(c=>{
      const href=c.jira_id?`${JIRA_BASE}${encodeURIComponent(c.jira_id)}`:null;
      const sp=c.sprint_name?S.sprints.find(s=>s.name===c.sprint_name):null;
      const spLabel=sp?sp.name:'—';
      const lbl=(c.label||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<span class="bl-child-chip" title="${lbl} · ${c.status||'—'}">
        ${href?`<a class="bl-child-id" href="${href}" target="_blank" rel="noopener">${c.jira_id}</a>`:''}
        <span class="bl-child-label">${lbl}</span>
        ${c.type?`<span class="bl-child-type">${c.type}</span>`:''}
        ${c.points?`<span class="bl-child-pts">${c.points}pts</span>`:''}
        <span class="bl-child-sprint">${spLabel}</span>
        ${_statusDotPrio(c.status)}
      </span>`;
    }).join('');
  }
  const row=document.createElement('tr');
  row.className='bl-prio-children-row';
  row.innerHTML=`<td colspan="20" class="bl-prio-children-td"><div class="bl-prio-children-wrap">${inner}</div></td>`;
  tr.after(row);
}
async function togglePrioChildren(jiraId,btn){
  if(blPrioExpanded.has(jiraId)){
    blPrioExpanded.delete(jiraId);
    btn.classList.remove('open');
    const next=btn.closest('tr').nextElementSibling;
    if(next?.classList.contains('bl-prio-children-row'))next.remove();
    return;
  }
  blPrioExpanded.add(jiraId);
  btn.classList.add('loading');
  if(!blGanttChildren[jiraId]){
    try{blGanttChildren[jiraId]=await API.get(`/api/jira/children?key=${encodeURIComponent(jiraId)}`);}
    catch(e){blGanttChildren[jiraId]=[];toast('Impossible de charger les tickets enfants','error');}
  }
  btn.classList.remove('loading');
  btn.classList.add('open');
  _renderPrioChildren(jiraId);
}

function renderBacklog(){
  const isAdmin=['admin','super_admin'].includes(CU?.role);
  _initObjFilter();
  const objSel=document.getElementById('bl-filter-obj');
  if(objSel)objSel.style.display='block';
  // Remplir le filtre sprint
  const openSprints=S.sprints.filter(s=>!s.closed);
  const filterEl=document.getElementById('bl-filter-sprint');
  const filterVal=filterEl?filterEl.value:'';
  if(filterEl){
    const cur=filterEl.value;
    const closedWithItems=S.sprints.filter(s=>s.closed&&S.backlog.some(b=>String(b.sprint_id)===String(s.id)));
    filterEl.innerHTML='<option value="">Tous les sprints</option>'
      +openSprints.map(s=>`<option value="${s.id}" ${String(s.id)===cur?'selected':''}>${s.name}</option>`).join('')
      +(closedWithItems.length?'<optgroup label="Clôturés">'+closedWithItems.map(s=>`<option value="${s.id}" ${String(s.id)===cur?'selected':''}>${s.name}</option>`).join('')+'</optgroup>':'');
    filterEl.value=cur;
  }
  // Filtrer
  let rows=[...S.backlog];
  if(filterVal)rows=rows.filter(r=>String(r.sprint_id)===String(filterVal));
  const objVal=objSel?objSel.value:'';
  if(objVal==='__orphan__'){
    const allIds=new Set();
    Object.entries(S.objectivesData?.objectives||{}).forEach(([k,feats])=>{if(k!=='__orphan__')feats.forEach(f=>allIds.add(f.jira_id));});
    rows=rows.filter(r=>!allIds.has(r.jira_id));
  } else if(objVal&&S.objectivesData){
    const feats=S.objectivesData.objectives[decodeURIComponent(objVal)]||[];
    const ids=new Set(feats.map(f=>f.jira_id));
    rows=rows.filter(r=>ids.has(r.jira_id));
  }
  // Calculer le score
  rows=rows.map(r=>({...r,_score:riceScore(r)}));
  // Trier
  rows.sort((a,b)=>{
    let av,bv;
    if(blSort.col==='score'){av=a._score;bv=b._score;}
    else if(blSort.col==='jira_id'){av=a.jira_id||'';bv=b.jira_id||'';}
    else if(blSort.col==='label'){av=a.label||'';bv=b.label||'';}
    else if(blSort.col==='sprint'){av=a.sprint_id||0;bv=b.sprint_id||0;}
    else{av=a[blSort.col]||0;bv=b[blSort.col]||0;}
    if(typeof av==='string')return blSort.dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
    return blSort.dir==='asc'?av-bv:bv-av;
  });
  // Méthode de scoring courante
  const method=currentTeamMethod();
  const isRricce=method==='rricce';
  // Mettre à jour le titre de page
  const titleEl=document.getElementById('bl-page-title');
  const subEl=document.getElementById('bl-page-sub');
  if(titleEl)titleEl.textContent='Backlog 📋';
  if(subEl)subEl.textContent=isRricce?'Priorisation RRICCE':'Priorisation RICE';
  // Mettre à jour l'apparence du switch méthode
  const btnRice=document.getElementById('bl-method-rice');
  const btnRricce=document.getElementById('bl-method-rricce');
  const activeStyle='background:var(--primary);color:#fff';
  const inactiveStyle='background:transparent;color:var(--text3)';
  if(btnRice){btnRice.style.cssText+=';'+(!isRricce?activeStyle:inactiveStyle);}
  if(btnRricce){btnRricce.style.cssText+=';'+(isRricce?activeStyle:inactiveStyle);}
  // Masquer le switch pour les non-admins (lecture seule)
  const methodWrap=document.getElementById('bl-method-wrap');
  if(methodWrap){
    if(!isAdmin){
      btnRice&&(btnRice.style.pointerEvents='none');
      btnRricce&&(btnRricce.style.pointerEvents='none');
      btnRice&&(btnRice.style.opacity=!isRricce?'1':'0.4');
      btnRricce&&(btnRricce.style.opacity=isRricce?'1':'0.4');
    }else{
      btnRice&&(btnRice.style.pointerEvents='');
      btnRricce&&(btnRricce.style.pointerEvents='');
      btnRice&&(btnRice.style.opacity='');
      btnRricce&&(btnRricce.style.opacity='');
    }
  }
  // En-tête — colonnes sticky : icône | jira_id | libellé | note
  const L2=36,jiraW=isAdmin?100:90,L3=L2+jiraW,L4=L3+blLabelW;
  _blL3=L3;
  document.documentElement.style.setProperty('--bl-label-w',blLabelW+'px');
  document.documentElement.style.setProperty('--bl-L4',L4+'px');
  const sortable=(col,label,tip='',cls='',sty='')=>`<th class="${blSort.col===col?'sorted':''} ${cls}" style="${sty}" onclick="toggleBlSort('${col}')"><div class="rice-th">${label}${tip?infoIcon(tip):''}${blSortIcon(col)}</div></th>`;
  const noteIconHtml=r=>{
    const hasNote=!!(r.note&&r.note.trim());
    const evts=hasNote
      ?`onmouseenter="showNoteTip(event,${r.id})" onmouseleave="hideNoteTip()"`
      :`title="Ajouter une note"`;
    return `<button class="bl-note-btn${hasNote?' has-note':''}" id="bl-note-${r.id}" onclick="openNotePanel(${r.id})" ${evts}><span class="material-icons-round">${hasNote?'sticky_note_2':'note_add'}</span></button>`;
  };
  const scoreLabel=isRricce?'Score RRICCE':'Score RICE';
  document.getElementById('bl-thead').innerHTML=`<tr>
    <th class="bl-sk" style="width:36px;left:0"></th>
    ${sortable('jira_id','ID Jira','','bl-sk',`left:${L2}px`)}
    <th class="${blSort.col==='label'?'sorted':''} bl-sk bl-label-col" style="left:${L3}px" onclick="toggleBlSort('label')"><div class="rice-th">Libellé${blSortIcon('label')}</div><div class="bl-col-resize" onmousedown="blStartLabelResize(event)"></div></th>
    <th class="bl-sk bl-sk-sep" style="width:40px;left:var(--bl-L4);text-align:center;cursor:default"><span class="material-icons-round" style="font-size:16px;color:var(--text3);vertical-align:middle">sticky_note_2</span></th>
    ${sortable('sprint','Sprint prévu')}
    ${sortable('reach','Portée',BL_REACH_TIPS)}
    ${isRricce?sortable('risk','Risque',BL_RISK_TIPS):''}
    ${sortable('impact','Impact',BL_IMPACT_TIPS)}
    ${isRricce?sortable('criticality','Criticité',BL_CRIT_TIPS):''}
    ${sortable('confidence','Confiance',BL_CONF_TIPS)}
    ${sortable('effort','Effort',BL_EFFORT_TIPS)}
    <th style="text-align:center;white-space:nowrap;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.4px" title="Estimation validée par le tech lead"><span class="material-icons-round" style="font-size:15px;vertical-align:middle;color:var(--text3)">engineering</span> Dev</th>
    ${sortable('score',scoreLabel)}
    ${isAdmin?'<th></th>':''}
  </tr>`;
  // Corps
  const selOpts=(vals,cur)=>vals.map(v=>`<option value="${v}" ${Number(cur)===v?'selected':''}>${v||'—'}</option>`).join('');
  const sprintOpts=(cur)=>{
    const closedCur=cur?S.sprints.find(s=>String(s.id)===String(cur)&&s.closed):null;
    return '<option value="">—</option>'
      +(closedCur?`<option value="${closedCur.id}" selected disabled>${closedCur.name} (clôturé)</option>`:'')
      +openSprints.map(s=>`<option value="${s.id}" ${!closedCur&&String(s.id)===String(cur)?'selected':''}>${s.name}</option>`).join('');
  };
  const JIRA_BASE='https://isagri.atlassian.net/browse/';
  const jiraIcon=(id,rowId)=>id
    ?`<a href="${JIRA_BASE}${encodeURIComponent(id)}" target="_blank" rel="noopener" id="bl-jira-link-${rowId}" title="Ouvrir ${id} dans Jira" style="color:var(--primary);display:inline-flex;align-items:center"><span class="material-icons-round" style="font-size:18px">open_in_new</span></a>`
    :`<span id="bl-jira-link-${rowId}" style="color:var(--text3);display:inline-flex;align-items:center" title="Saisir un ID Jira"><span class="material-icons-round" style="font-size:18px">link_off</span></span>`;

  document.getElementById('bl-tbody').innerHTML=rows.length===0
    ?`<tr>
      <td class="bl-sk" style="width:36px;left:0;padding:32px 4px"></td>
      <td class="bl-sk" style="min-width:${jiraW}px;left:${L2}px;padding:32px 4px"></td>
      <td class="bl-sk bl-label-col" style="left:${L3}px;padding:32px 16px;color:var(--text3);font-size:13px;white-space:nowrap">Aucun élément dans le backlog</td>
      <td class="bl-sk bl-sk-sep" style="width:40px;left:var(--bl-L4);padding:32px 4px"></td>
      <td style="padding:32px 4px"></td><td style="padding:32px 4px"></td><td style="padding:32px 4px"></td>
      ${isRricce?'<td style="padding:32px 4px"></td><td style="padding:32px 4px"></td>':''}
      <td style="padding:32px 4px"></td><td style="padding:32px 4px"></td><td style="padding:32px 4px"></td>
      ${isAdmin?'<td style="padding:32px 4px"></td>':''}
    </tr>`
    :rows.map(r=>{
      const score=r._score;
      const isJira=r.source==='jira';
      if(!isAdmin) return `<tr>
        <td class="bl-sk" style="width:36px;padding:6px 4px;text-align:center;left:0">${r.jira_id?`<button class="bl-prio-expand-btn${blPrioExpanded.has(r.jira_id)?' open':''}" data-jira="${r.jira_id}" onclick="togglePrioChildren('${r.jira_id}',this)" title="Tickets enfants"><span class="material-icons-round">chevron_right</span></button>`:`<span id="bl-jira-link-${r.id}" style="color:var(--text3);display:inline-flex;align-items:center"><span class="material-icons-round" style="font-size:18px">link_off</span></span>`}</td>
        <td class="bl-sk" style="min-width:${jiraW}px;left:${L2}px;font-size:12px;font-weight:600">${r.jira_id?`<a href="${JIRA_BASE}${encodeURIComponent(r.jira_id)}" target="_blank" rel="noopener" style="color:var(--text2);text-decoration:none;font-weight:600">${r.jira_id}</a>`:'<span style="color:var(--text3)">—</span>'}</td>
        <td class="bl-sk bl-label-col" style="left:${L3}px;cursor:default" ${r.label?`data-tip="${(r.label||'').replace(/"/g,'&quot;')}" onmouseenter="showBlTip(event,this)" onmouseleave="hideBlTip()"`:``}>${r.label||'—'}</td>
        <td class="bl-sk bl-sk-sep" style="width:40px;left:var(--bl-L4);text-align:center;padding:4px">${noteIconHtml(r)}</td>
        <td>${(sp=>!sp?'<span style="color:var(--text3)">—</span>':sp.closed?`<span style="color:var(--text3)" title="Sprint clôturé">${sp.name}</span>`:sp.name)(S.sprints.find(s=>String(s.id)===String(r.sprint_id)))}</td>
        <td style="text-align:center">${r.reach||0}</td>
        ${isRricce?`<td style="text-align:center">${r.risk||0}</td>`:''}
        <td style="text-align:center">${r.impact||0}</td>
        ${isRricce?`<td style="text-align:center">${r.criticality||0}</td>`:''}
        <td style="text-align:center">${r.confidence||0}</td>
        <td style="text-align:center">${r.effort||0}</td>
        <td style="text-align:center;vertical-align:middle"><div style="display:flex;justify-content:center;align-items:center">${r.dev_validated?'<span class="material-icons-round" style="font-size:16px;color:var(--success)">check_circle</span>':'<span class="material-icons-round" style="font-size:16px;color:var(--border)">radio_button_unchecked</span>'}</div></td>
        <td class="bl-score ${score===0?'zero':''}">${score||'—'}</td>
      </tr>`;
      return `<tr>
        <td class="bl-sk" style="width:36px;padding:6px 4px;text-align:center;left:0">${r.jira_id?`<button class="bl-prio-expand-btn${blPrioExpanded.has(r.jira_id)?' open':''}" data-jira="${r.jira_id}" onclick="togglePrioChildren('${r.jira_id}',this)" title="Tickets enfants"><span class="material-icons-round">chevron_right</span></button>`:`<span id="bl-jira-link-${r.id}" style="color:var(--text3);display:inline-flex;align-items:center" title="Saisir un ID Jira"><span class="material-icons-round" style="font-size:18px">link_off</span></span>`}</td>
        <td class="bl-sk" style="min-width:${jiraW}px;left:${L2}px">${isJira?`<a href="${JIRA_BASE}${encodeURIComponent(r.jira_id)}" target="_blank" rel="noopener" style="color:var(--text2);font-size:12px;font-weight:600;padding:0 4px;text-decoration:none" title="Ouvrir dans Jira">${r.jira_id}</a>`:`<input class="bl-input" style="width:${jiraW-6}px" placeholder="PROJ-123" value="${r.jira_id||''}" onchange="blUpdate(${r.id},{jira_id:this.value.trim()})" oninput="blUpdateJiraIcon(${r.id},this.value.trim())">`}</td>
        <td class="bl-sk bl-label-col" style="left:${L3}px" ${r.label?`data-tip="${(r.label||'').replace(/"/g,'&quot;')}" onmouseenter="if(document.activeElement!==this.querySelector('input'))showBlTip(event,this)" onmouseleave="hideBlTip()"`:``}><input class="bl-input" style="width:100%" placeholder="Titre du ticket" value="${(r.label||'').replace(/"/g,'&quot;')}" onchange="blUpdate(${r.id},{label:this.value});this.closest('td').dataset.tip=this.value"></td>
        <td class="bl-sk bl-sk-sep" style="width:40px;left:var(--bl-L4);text-align:center;padding:4px">${noteIconHtml(r)}</td>
        <td style="min-width:140px"><select class="bl-select" onchange="blUpdate(${r.id},{sprint_id:this.value||null})">${sprintOpts(r.sprint_id)}</select></td>
        <td><select class="bl-select" onchange="blUpdate(${r.id},{reach:Number(this.value)})">${selOpts([0,20,40,80,100],r.reach)}</select></td>
        ${isRricce?`<td><select class="bl-select" onchange="blUpdate(${r.id},{risk:Number(this.value)})">${selOpts([0,1,2,5,8],r.risk)}</select></td>`:''}
        <td><select class="bl-select" onchange="blUpdate(${r.id},{impact:Number(this.value)})">${selOpts([0,20,40,80,100],r.impact)}</select></td>
        ${isRricce?`<td><select class="bl-select" onchange="blUpdate(${r.id},{criticality:Number(this.value)})">${selOpts([0,1,2,5,8],r.criticality)}</select></td>`:''}
        <td><select class="bl-select" onchange="blUpdate(${r.id},{confidence:Number(this.value)})">${selOpts([0,20,40,80,100],r.confidence)}</select></td>
        <td><select class="bl-select" onchange="blUpdate(${r.id},{effort:Number(this.value)})">${selOpts([0,1,2,3,5,8],r.effort)}</select></td>
        <td style="text-align:center;vertical-align:middle" id="bl-dev-${r.id}"><div style="display:flex;justify-content:center;align-items:center"><button class="icon-btn" onclick="blUpdate(${r.id},{dev_validated:${r.dev_validated?0:1}})" title="Validation effort tech lead" style="padding:2px;display:flex;align-items:center;justify-content:center">${r.dev_validated?'<span class="material-icons-round" style="font-size:18px;color:var(--success)">check_circle</span>':'<span class="material-icons-round" style="font-size:18px;color:var(--text3)">radio_button_unchecked</span>'}</button></div></td>
        <td class="bl-score ${score===0?'zero':''}" id="bl-score-${r.id}">${score||'—'}</td>
        <td><button class="icon-btn" onclick="blDelete(${r.id})" title="Supprimer"><span class="material-icons-round" style="font-size:16px;color:var(--danger)">delete</span></button></td>
      </tr>`;
    }).join('');

  // Re-insérer les lignes enfants ouvertes après rebuild du tbody
  blPrioExpanded.forEach(id=>{if(blGanttChildren[id]!==undefined)_renderPrioChildren(id);});
  // Bouton d'ajout toujours visible sous le tableau (admin seulement)
  const addFooter=document.getElementById('bl-add-footer');
  if(addFooter)addFooter.style.display=isAdmin?'block':'none';
  // Bouton sync Jira (admin et super_admin)
  const syncBtn=document.getElementById('bl-sync-btn');
  if(syncBtn)syncBtn.style.display=isAdmin?'inline-flex':'none';
  // Mettre à jour la vue chronologie si active
  if(blActiveTab==='chrono')renderGantt();
}

async function addBacklogItem(){
  if(!selectedTeamId){toast('Sélectionnez une équipe','error');return;}
  try{
    const item=await API.post('/api/backlog',{teamId:Number(selectedTeamId),label:'Nouveau ticket'});
    S.backlog.push(item);
    renderBacklog();
    // Focus sur le libellé du nouvel item
    setTimeout(()=>{
      const inputs=document.querySelectorAll('#bl-tbody input.bl-input');
      if(inputs.length)inputs[inputs.length-1].select();
    },50);
  }catch(e){toast(e.error||'Erreur','error');}
}

function blUpdateJiraIcon(id,val){
  const el=document.getElementById('bl-jira-link-'+id);if(!el)return;
  const JIRA_BASE='https://isagri.atlassian.net/browse/';
  if(val){
    el.outerHTML=`<a href="${JIRA_BASE}${encodeURIComponent(val)}" target="_blank" rel="noopener" id="bl-jira-link-${id}" title="Ouvrir ${val} dans Jira" style="color:var(--primary);display:inline-flex;align-items:center"><span class="material-icons-round" style="font-size:18px">open_in_new</span></a>`;
  }else{
    el.outerHTML=`<span id="bl-jira-link-${id}" style="color:var(--text3);display:inline-flex;align-items:center" title="Saisir un ID Jira"><span class="material-icons-round" style="font-size:18px">link_off</span></span>`;
  }
}
async function blUpdate(id,patch){
  const item=S.backlog.find(r=>r.id==id);if(!item)return;
  const prevSprintId=item.sprint_id;
  Object.assign(item,patch);
  // Recalculer le score à la volée
  const score=riceScore(item);
  const scoreEl=document.getElementById('bl-score-'+id);
  if(scoreEl){scoreEl.textContent=score||'—';scoreEl.className='bl-score'+(score===0?' zero':'');}
  // Mettre à jour l'icône dev_validated immédiatement
  if('dev_validated' in patch){
    const devEl=document.getElementById('bl-dev-'+id);
    if(devEl)devEl.innerHTML=`<div style="display:flex;justify-content:center;align-items:center"><button class="icon-btn" onclick="blUpdate(${id},{dev_validated:${item.dev_validated?0:1}})" title="Validation effort tech lead" style="padding:2px;display:flex;align-items:center;justify-content:center">${item.dev_validated?'<span class="material-icons-round" style="font-size:18px;color:var(--success)">check_circle</span>':'<span class="material-icons-round" style="font-size:18px;color:var(--text3)">radio_button_unchecked</span>'}</button></div>`;
  }
  try{
    await API.put('/api/backlog/'+id,{
      jiraId:item.jira_id,label:item.label,sprintId:item.sprint_id,
      reach:item.reach,impact:item.impact,confidence:item.confidence,effort:item.effort,
      risk:item.risk,criticality:item.criticality,devValidated:item.dev_validated
    });
    // Sync sprint Jira si sprint_id a changé et que l'item a un jira_id
    if('sprint_id' in patch && item.jira_id && String(prevSprintId)!==String(patch.sprint_id)){
      const newSp=S.sprints.find(s=>String(s.id)===String(patch.sprint_id));
      if(newSp){
        try{
          const r=await API.post('/api/jira/move-sprint',{jira_id:item.jira_id,sprint_name:newSp.name});
          if(r.jira){
            const due=r.due_date?` · due ${r.due_date}`:'';
            toast(`Jira : ${item.jira_id} → "${r.sprint_name||newSp.name}"${due}`, 'success');
            if(r.warning)toast(`${item.jira_id} : ${r.warning}`, 'warning');
          } else {
            toast(`${item.jira_id} sauvegardé dans bobbee — Jira : ${r.reason||'échec inconnu'}`, 'warning');
          }
        }catch(err){
          const msg=err?.error||err?.message||JSON.stringify(err)||'erreur';
          toast(`${item.jira_id} sauvegardé — Jira inaccessible : ${msg}`, 'warning');
        }
      } else if(!patch.sprint_id){
        // Sprint retiré
        toast(`${item.jira_id} : sprint retiré dans bobbee (Jira non modifié)`, 'warning');
      }
    }
  }catch(e){toast(e.error||'Erreur sauvegarde','error');}
}

function blDelete(id){
  showConfirm('Supprimer cet élément du backlog ?',async()=>{
    try{
      await API.del('/api/backlog/'+id);
      S.backlog=S.backlog.filter(r=>r.id!=id);
      renderBacklog();toast('Élément supprimé','success');
    }catch(e){toast(e.error||'Erreur','error');}
  },'Supprimer');
}



async function syncJiraVelocities(){
  if(!selectedTeamId)return;
  try{await API.post('/api/jira/sync-velocities',{teamId:Number(selectedTeamId)});}
  catch(e){console.warn('Jira velocity sync:',e);}
}

async function syncJira(btnId, statusId){
  if(!selectedTeamId){toast('Sélectionnez une équipe','error');return;}
  const btn=document.getElementById(btnId);
  const status=statusId?document.getElementById(statusId):null;
  if(btn){btn.disabled=true;btn.innerHTML='<span class="material-icons-round" style="animation:spin 1s linear infinite">sync</span>Synchronisation…';}
  if(status)status.textContent='Synchronisation en cours…';
  try{
    const r=await API.post('/api/jira/sync',{teamId:Number(selectedTeamId)});
    const parts=[];
    if(r.sprints_synced)parts.push(`${r.sprints_synced} sprint(s) ← Jira`);
    if(r.pushed_to_jira)parts.push(`${r.pushed_to_jira} sprint(s) → Jira`);
    const sprintPart=parts.length?` · ${parts.join(', ')}` :'';
    const msg=`Synchronisé le ${new Date().toLocaleString('fr-FR')} — ${r.imported} importé(s), ${r.updated} mis à jour, ${r.skipped} ignoré(s)${sprintPart}`;
    if(status)status.textContent=msg;
    toast(`${r.imported} importé(s), ${r.updated} mis à jour${sprintPart}`,'success');
    await loadBacklog();
    renderBacklog();
  }catch(e){
    toast(e.error||'Erreur de synchronisation','error');
    if(status)status.textContent='Erreur lors de la synchronisation';
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML='<span class="material-icons-round">sync</span>Sync Jira';}
  }
}

// ── OBJECTIFS ────────────────────────────────────────────
async function loadObjectives(){
  S.objectivesData=await API.get('/api/objectives');
}

function initObjectivesFilter(){
  const sel=document.getElementById('obj-team-filter');
  if(!sel||!S.objectivesData)return;
  const{teams}=S.objectivesData;
  sel.innerHTML=
    `<option value="">Toutes les équipes</option>`+
    teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')+
    `<option value="__empty__">Sans équipe</option>`;
  // Défaut : équipe sélectionnée dans la sidebar
  if(selectedTeamId&&teams.find(t=>String(t.id)===String(selectedTeamId)))
    sel.value=String(selectedTeamId);
}

function renderObjectives(){
  if(!S.objectivesData)return;
  initObjectivesFilter();
  renderObjectivesContent();
}

function filterObjectives(){renderObjectivesContent();}

function renderObjectivesContent(){
  const container=document.getElementById('obj-content');
  if(!container||!S.objectivesData)return;

  // Mémoriser les accordéons ouverts avant de reconstruire
  const openKeys=new Set(
    [...container.querySelectorAll('.obj-accordion[data-obj-key]')]
      .filter(a=>a.querySelector('.obj-accordion-body')?.classList.contains('open'))
      .map(a=>a.dataset.objKey)
  );
  const filterVal=document.getElementById('obj-team-filter')?.value||'';
  const JIRA_BASE='https://isagri.atlassian.net/browse/';
  const{objectives}=S.objectivesData;

  // Trier : objectifs nommés en alpha, orphelines en dernier
  const named=Object.entries(objectives).filter(([k])=>k!=='__orphan__').sort(([a],[b])=>a.localeCompare(b,'fr'));
  const orphan=objectives['__orphan__']?[['__orphan__',objectives['__orphan__']]]:[];
  const sorted=[...named,...orphan];

  if(!sorted.length){
    container.innerHTML=`<div class="obj-empty"><span class="material-icons-round">check_circle_outline</span><p>Aucune feature active trouvée.</p></div>`;
    return;
  }

  const showDone=document.getElementById('obj-show-done')?.checked||false;

  const applyTeamFilter=features=>{
    if(!filterVal)return features;
    if(filterVal==='__empty__')return features.filter(f=>!f.team_id);
    return features.filter(f=>String(f.team_id)===filterVal);
  };

  const isAdmin=['admin','super_admin'].includes(CU?.role);
  let html='';
  for(const[objKey,rawFeatures]of sorted){
    const teamFiltered=applyTeamFilter(rawFeatures);
    if(!teamFiltered.length)continue;

    // Calcul de la progression (toujours sur les features filtrées par équipe)
    const doneCount=teamFiltered.filter(f=>f.done).length;
    const totalCount=teamFiltered.length;
    const pct=totalCount?Math.round(doneCount/totalCount*100):0;

    // Features à afficher (selon le toggle "terminées")
    const visibleFeatures=showDone?teamFiltered:teamFiltered.filter(f=>!f.done);
    if(!visibleFeatures.length&&!showDone&&doneCount===totalCount){
      // Toutes terminées et switch off : afficher l'accordéon quand même (pour la progression)
    }

    const isOrphan=objKey==='__orphan__';
    const isUnresolved=!isOrphan&&objKey.startsWith('__unresolved__');
    const ari=isUnresolved?objKey.replace('__unresolved__',''):null;
    const title=isOrphan?'Orphelines (sans objectif)':isUnresolved?'Objectif non nommé':objKey;

    const editBtn=isAdmin&&!isOrphan
      ? `<button class="obj-edit-btn" onclick="event.stopPropagation();openGoalNameModal('${(ari||objKey).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" title="${isUnresolved?'Nommer cet objectif':'Renommer'}"><span class="material-icons-round">edit</span></button>`
      : '';

    // Barre de progression
    const progressHtml=`
      <div class="obj-progress-wrap">
        <div class="obj-progress-bar"><div class="obj-progress-fill" style="width:${pct}%"></div></div>
        <span class="obj-progress-label">${doneCount}/${totalCount}</span>
      </div>`;

    // Lignes features
    const rowsHtml=visibleFeatures.map(f=>`
      <div class="obj-feature-row${f.done?' done':''}">
        <a href="${JIRA_BASE}${encodeURIComponent(f.jira_id)}" target="_blank" rel="noopener" class="obj-feature-id" title="Ouvrir ${f.jira_id} dans Jira">
          <span class="material-icons-round" style="font-size:12px;vertical-align:middle">open_in_new</span>&nbsp;${f.jira_id}
        </a>
        <span class="obj-feature-label" title="${(f.label||'').replace(/"/g,'&quot;')}">${f.label||'—'}</span>
        <span class="obj-feature-team${f.team_name?'':' empty'}">${f.team_name||'Sans équipe'}</span>
      </div>`).join('');

    const emptyMsg=!visibleFeatures.length
      ? `<div class="obj-feature-empty">Toutes les features sont terminées ✓</div>`
      : '';

    html+=`
    <div class="obj-accordion" data-obj-key="${objKey.replace(/"/g,'&quot;')}">
      <div class="obj-accordion-header" onclick="toggleObjAccordion(this)">
        <span class="material-icons-round obj-chevron" style="transform:rotate(-90deg)">expand_more</span>
        <span class="obj-accordion-title${isOrphan?' obj-orphan-title':''}${isUnresolved?' obj-unresolved-title':''}">${title}</span>
        ${editBtn}
        ${progressHtml}
        <span class="obj-count">${totalCount}&nbsp;feature${totalCount>1?'s':''}</span>
      </div>
      <div class="obj-accordion-body">
        <div class="obj-feature-grid">
          ${rowsHtml||emptyMsg}
        </div>
      </div>
    </div>`;
  }

  container.innerHTML=html||`<div class="obj-empty"><span class="material-icons-round">filter_list_off</span><p>Aucune feature pour ce filtre.</p></div>`;

  // Restaurer les accordéons qui étaient ouverts
  if(openKeys.size){
    container.querySelectorAll('.obj-accordion[data-obj-key]').forEach(a=>{
      if(openKeys.has(a.dataset.objKey)){
        const body=a.querySelector('.obj-accordion-body');
        const chevron=a.querySelector('.obj-chevron');
        if(body)body.classList.add('open');
        if(chevron)chevron.style.transform='rotate(0deg)';
      }
    });
  }
}

function openGoalNameModal(ariOrCurrentName){
  const parsed=parseGoalAriClient(ariOrCurrentName);
  const isAri=!!parsed;
  document.getElementById('gnm-ari').value=ariOrCurrentName;
  document.getElementById('gnm-name').value=isAri?'':ariOrCurrentName;
  document.getElementById('modal-goal-name').classList.add('open');
  setTimeout(()=>document.getElementById('gnm-name').focus(),80);
}
// Parser ARI côté client (miroir de la fonction serveur)
function parseGoalAriClient(ari){
  const m=String(ari||'').match(/^ari:cloud:townsquare:([^:]+):goal\/(.+)$/);
  return m?{cloudId:m[1],goalId:m[2]}:null;
}
async function saveGoalName(){
  const ariOrName=document.getElementById('gnm-ari').value;
  const name=(document.getElementById('gnm-name').value||'').trim();
  if(!name){toast('Saisissez un nom','error');return;}
  // Si c'est un renommage d'un objectif déjà nommé, on passe le nom courant comme ARI
  // Le serveur fait un upsert sur l'ARI → si ce n'est pas un vrai ARI, ça crée un override par nom
  try{
    await API.put('/api/goal-names',{ari:ariOrName,name});
    closeModal('modal-goal-name');
    if(S.objectivesData?.objectives){
      const oldKey='__unresolved__'+ariOrName;
      if(S.objectivesData.objectives[oldKey]){
        // Objectif non résolu → on le renomme dans le cache local
        S.objectivesData.objectives[name]=S.objectivesData.objectives[oldKey];
        delete S.objectivesData.objectives[oldKey];
      } else if(S.objectivesData.objectives[ariOrName]!==undefined){
        // Objectif déjà nommé → renommage
        S.objectivesData.objectives[name]=S.objectivesData.objectives[ariOrName];
        delete S.objectivesData.objectives[ariOrName];
      }
    }
    renderObjectivesContent();
    toast('Nom enregistré ✓','success');
  }catch(e){toast(e.error||'Erreur','error');}
}

function toggleObjAccordion(header){
  const body=header.nextElementSibling;
  const chevron=header.querySelector('.obj-chevron');
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  chevron.style.transform=isOpen?'rotate(-90deg)':'rotate(0deg)';

}

async function refreshObjectives(){
  const btn=document.getElementById('obj-refresh-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="material-icons-round" style="animation:spin 1s linear infinite">sync</span>Chargement…';}
  try{
    await loadObjectives();
    initObjectivesFilter();
    renderObjectivesContent();
    toast('Objectifs mis à jour','success');
  }catch(e){toast(e.error||'Erreur lors du chargement','error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML='<span class="material-icons-round">refresh</span>Actualiser';}}
}

// ── ROADMAP ───────────────────────────────────────────────
const RDM_COLORS=['#7c3aed','#0891b2','#059669','#d97706','#ec4899','#2563eb','#b45309','#0e7490'];
const RDM_MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
let _rdmCarouselIdx=0;
let _rdmSlides=[];

function initRoadmapFilter(){
  const sel=document.getElementById('rdm-team-filter');
  if(!sel||!S.objectivesData)return;
  const{teams}=S.objectivesData;
  const prev=sel.value;
  sel.innerHTML=`<option value="">Toutes les équipes</option>`+
    teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  if(selectedTeamId&&teams.find(t=>String(t.id)===String(selectedTeamId)))sel.value=String(selectedTeamId);
  else if(prev&&teams.find(t=>String(t.id)===prev))sel.value=prev;
}

function _rdmBuildData(teamId){
  const now=new Date();now.setHours(0,0,0,0);
  const sorted=[...S.sprints].sort((a,b)=>new Date(a.start)-new Date(b.start));
  let curIdx=sorted.findIndex(s=>!s.closed&&new Date(s.start)<=now&&new Date(s.end)>=now);
  if(curIdx<0)curIdx=sorted.findIndex(s=>!s.closed&&new Date(s.start)>now);
  if(curIdx<0)curIdx=Math.max(0,sorted.length-1);
  const startIdx=Math.max(0,curIdx-1);
  const sprintsToShow=sorted.slice(startIdx,startIdx+5);
  const currentSprintId=sorted[curIdx]?.id;

  // jira_id → objectif
  const jiraToObj={};
  if(S.objectivesData)
    Object.entries(S.objectivesData.objectives||{}).forEach(([k,feats])=>feats.forEach(f=>{jiraToObj[f.jira_id]=k;}));

  // Pour chaque feature de backlog, quelle date de fin de sprint ?
  const jiraToSprintEnd={};
  (S.backlog||[]).forEach(f=>{
    const sp=S.sprints.find(s=>String(s.id)===String(f.sprint_id));
    if(sp)jiraToSprintEnd[f.jira_id]=sp.end;
  });

  const DONE_ST=['10 - termine','9 - a livrer en prod'];

  const sprintBlocks=sprintsToShow.map(sprint=>{
    const isPast=!!sprint.closed;
    const sprintEndDt=new Date(sprint.end);

    // Features de ce sprint pour ce groupe
    const features=(S.backlog||[]).filter(f=>
      String(f.sprint_id)===String(sprint.id)&&
      (!teamId||String(f.team_id)===String(teamId))
    );
    const groups={};
    features.forEach(f=>{
      const k=jiraToObj[f.jira_id]||'__orphan__';
      if(!groups[k])groups[k]=[];
      groups[k].push({...f,_done:DONE_ST.includes((f.status||'').trim().toLowerCase())});
    });

    // Progression par objectif — réelle pour sprint passé, projection pour les autres
    const projProgress={};
    if(S.objectivesData){
      Object.entries(S.objectivesData.objectives||{}).forEach(([k,feats])=>{
        const tf=teamId?feats.filter(f=>String(f.team_id)===String(teamId)):feats;
        if(!tf.length)return;
        if(isPast){
          // État réel actuel
          const done=tf.filter(f=>f.done).length;
          projProgress[k]={done,total:tf.length,pct:Math.round(done/tf.length*100),isProjection:false};
        } else {
          // Projection : déjà faites OU sprint de livraison ≤ fin de ce sprint
          const projDone=tf.filter(f=>{
            if(f.done)return true;
            const fEnd=jiraToSprintEnd[f.jira_id];
            return fEnd&&new Date(fEnd)<=sprintEndDt;
          }).length;
          projProgress[k]={done:projDone,total:tf.length,pct:Math.round(projDone/tf.length*100),isProjection:true};
        }
      });
    }

    return{sprint,groups,projProgress,isPast};
  });

  // Bandes cumulatives par carte : --primary décroissant (100→75→50→25%) par offset
  const BAND_COLORS=[
    'var(--primary)',
    'color-mix(in srgb,var(--primary) 75%,transparent)',
    'color-mix(in srgb,var(--primary) 50%,transparent)',
    'color-mix(in srgb,var(--primary) 25%,transparent)'
  ];
  const curBlockIdx=sprintsToShow.findIndex(s=>String(s.id)===String(currentSprintId));
  sprintBlocks.forEach((block,blockIdx)=>{
    block.objBands={};
    if(!S.objectivesData)return;
    const isPastCard=curBlockIdx>=0&&blockIdx<curBlockIdx;
    Object.entries(S.objectivesData.objectives||{}).forEach(([k,feats])=>{
      const tf=teamId?feats.filter(f=>String(f.team_id)===String(teamId)):feats;
      if(!tf.length)return;
      const total=tf.length;
      const doneCount=tf.filter(f=>f.done).length;
      const bands=[];
      if(curBlockIdx>=0&&blockIdx>=curBlockIdx){
        for(let i=curBlockIdx;i<=blockIdx;i++){
          const sp=sprintsToShow[i];
          const o=i-curBlockIdx;
          const count=tf.filter(f=>{
            if(f.done)return false;
            const bl=(S.backlog||[]).find(b=>b.jira_id===f.jira_id);
            return bl&&String(bl.sprint_id)===String(sp.id);
          }).length;
          if(count>0)bands.push({color:BAND_COLORS[o]||'color-mix(in srgb,var(--primary) 15%,transparent)',pct:Math.round(count/total*100)});
        }
      }
      const doneColor='#475569';
      block.objBands[k]={donePct:Math.round(doneCount/total*100),doneColor,bands};
    });
  });

  return{sprintBlocks,currentSprintId};
}

function _rdmAssignColors(sprintBlocks){
  const colorMap={__orphan__:'#6b7280'};
  let ci=0;const seen=new Set();
  sprintBlocks.forEach(({groups})=>Object.keys(groups).forEach(k=>{
    if(k!=='__orphan__'&&!seen.has(k)){seen.add(k);colorMap[k]=RDM_COLORS[ci++%RDM_COLORS.length];}
  }));
  return colorMap;
}

function _rdmSprintLabel(sprint){
  const d=new Date(sprint.end||sprint.start);
  return`${sprint.name} · ${RDM_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function _rdmCardHtml({sprint,groups,projProgress,isPast,objBands},colorMap,animIdx,solo=false,currentSprintId=null){
  const isCurrent=String(sprint.id)===String(currentSprintId||(_rdmLastData||{}).currentSprintId);
  const orderedKeys=[
    ...Object.keys(groups).filter(k=>k!=='__orphan__').sort((a,b)=>a.localeCompare(b,'fr')),
    ...(groups['__orphan__']?['__orphan__']:[])
  ];
  const groupsHtml=orderedKeys.map(k=>{
    const feats=groups[k];
    const color=colorMap[k]||'#6b7280';
    const label=k==='__orphan__'?'Sans objectif':k;
    const prog=k!=='__orphan__'?projProgress[k]:null;
    const pctLabel=prog
      ?(prog.isProjection
        ?`<span class="rdm-group-pct rdm-group-pct--proj" style="color:${color}" title="Projection à la clôture du sprint">→ ${prog.pct}%</span>`
        :`<span class="rdm-group-pct" style="color:${color}" title="Avancement actuel">${prog.pct}%</span>`)
      :'';
    const bdata=k!=='__orphan__'?(objBands||{})[k]:null;
    const barHtml=bdata
      ?`<div class="rdm-group-progress-seg">
          ${bdata.donePct>0?`<div class="rdm-seg" style="width:${bdata.donePct}%;background:${bdata.doneColor||'var(--success,#22c55e)'}" title="${bdata.donePct}% déjà livré"></div>`:''}
          ${bdata.bands.map(b=>`<div class="rdm-seg" style="width:${b.pct}%;background:${b.color}"></div>`).join('')}
        </div>`
      :'';
    return`<div class="rdm-group" style="--rdm-color:${color}">
      <div class="rdm-group-header"><span class="rdm-group-label">${label}</span>${pctLabel}</div>
      ${barHtml}
      <ul class="rdm-feature-list">${feats.map(f=>`
        <li class="rdm-feature${f._done?' rdm-feature--done':''}">
          ${f._done?'<span class="material-icons-round rdm-check">check_circle</span>':`<span class="rdm-dot" style="background:${color}"></span>`}
          <span class="rdm-feature-label" title="${(f.label||'').replace(/"/g,'&quot;')}">${f.label||f.jira_id||'—'}</span>
        </li>`).join('')}
      </ul>
    </div>`;
  }).join('');
  return`<div class="rdm-sprint-card${isCurrent?' rdm-sprint-card--current':''}${isPast?' rdm-sprint-card--past':''}" style="animation-delay:${animIdx*0.09}s">
    ${isCurrent?'<div class="rdm-current-stripe"></div>':''}
    <div class="rdm-sprint-header">
      <div class="rdm-sprint-title">${_rdmSprintLabel(sprint)}</div>
      <div class="rdm-sprint-dates">${fd(sprint.start)} → ${fd(sprint.end)}</div>
      ${isCurrent?'<span class="rdm-badge-current">En cours</span>':isPast?'<span class="rdm-badge-past">Clôturé</span>':''}
    </div>
    <div class="rdm-sprint-body">${groupsHtml||'<p class="rdm-empty">Aucune feature planifiée</p>'}</div>
  </div>`;
}

let _rdmLastData=null;
function _rdmBuildTrackHtml(data,colorMap,teamName=''){
  _rdmLastData=data;
  const{sprintBlocks,currentSprintId}=data;
  const pastBlock=sprintBlocks.find(b=>b.isPast);
  const curBlock=sprintBlocks.find(b=>String(b.sprint.id)===String(currentSprintId));
  const futureBlocks=sprintBlocks.filter(b=>!b.isPast&&String(b.sprint.id)!==String(currentSprintId));

  // ── Flex 2 lignes + route S inversée dynamique ─────────────────────────────
  // Les centres X sont calculés depuis les largeurs CSS des .rdm-card-pin (290px/320px, gap 20px).
  // Les points SVG sont placés exactement sur le chemin → dots toujours sur la route.
  const makePin=(block,animIdx)=>{
    if(!block)return'';
    const isCur=curBlock&&String(block.sprint.id)===String(currentSprintId);
    const cls=`rdm-card-pin${isCur?' rdm-card-pin--current':''}`;
    return`<div class="${cls}">${_rdmCardHtml(block,colorMap,animIdx,false,currentSprintId)}</div>`;
  };

  const row1=[pastBlock,curBlock].filter(Boolean);
  const row2=futureBlocks.slice(0,3);
  const row1Html=row1.map((b,i)=>makePin(b,i)).join('');
  const row2Html=row2.map((b,i)=>makePin(b,i+2)).join('');

  // Chemin exact depuis trace.svg (viewBox 1022×670)
  const RD=`M 1.12 119.821 C 1.12 119.821 92.997 38.635 154.365 37.514 C 215.733 36.393 247.112 35.834 261.635 103.024 C 276.158 170.214 226.936 187.571 210.737 218.365 C 194.538 249.159 190.772 319.708 226.209 336.506 C 261.645 353.304 314.232 349.384 402.292 320.829 C 490.352 292.274 613.676 198.208 663.902 190.37 C 714.129 182.532 728.832 187.01 748.187 203.808 C 767.541 220.606 798.736 253.08 796.896 326.988 C 795.056 400.896 743.846 456.887 669.375 471.445 C 594.905 486.003 515.178 497.76 457.569 496.081 C 399.96 494.402 251.482 497.761 197.054 511.199 C 142.625 524.637 78.185 543.673 100.729 583.427 C 123.273 623.181 218.21 628.779 302.684 617.582 C 387.158 606.385 557.441 579.507 598.689 576.708 C 639.936 573.909 730.346 571.668 813.863 585.107 C 897.379 598.546 885.011 597.425 939.741 596.305 C 994.471 595.185 1019.1 586.227 1021.84 586.227`;
  const AW=`M -10,-6 L 4,0 L -10,6 L -6,0 Z`;
  const roadSvg=`<svg class="rdm-road-bg" viewBox="0 0 1022 670" preserveAspectRatio="none" aria-hidden="true">
    <path class="rdm-road-line" opacity="0" d="${RD}"/>
    <path class="rdm-arrow rdm-arrow--1" d="${AW}"><animateMotion path="${RD}" dur="20s" begin="5s" repeatCount="indefinite" rotate="auto" calcMode="linear"/></path>
    <path class="rdm-arrow rdm-arrow--2" d="${AW}"><animateMotion path="${RD}" dur="20s" begin="9s" repeatCount="indefinite" rotate="auto" calcMode="linear"/></path>
    <path class="rdm-arrow rdm-arrow--3" d="${AW}"><animateMotion path="${RD}" dur="20s" begin="19s" repeatCount="indefinite" rotate="auto" calcMode="linear"/></path>
  </svg>`;

  const headerHtml=`<div class="rdm-slide-header">
    <div class="rdm-slide-hd-title"><span class="material-icons-round">map</span>Roadmap</div>
    ${teamName?`<span class="rdm-slide-hd-team">${teamName}</span>`:''}
  </div>`;
  return`<div class="rdm-slide">${headerHtml}<div class="rdm-cards-map">
    ${roadSvg}
    <div class="rdm-row rdm-row--top">${row1Html}</div>
    <div class="rdm-row rdm-row--bottom">${row2Html}</div>
  </div></div>`;
}

function renderRoadmapContent(){
  const content=document.getElementById('rdm-content');
  if(!content)return;
  const filterVal=document.getElementById('rdm-team-filter')?.value||'';

  if(!filterVal){
    // Mode carousel — toutes les équipes
    const teams=S.objectivesData?.teams||[];
    if(!teams.length){content.innerHTML='<p class="obj-empty">Aucune équipe disponible</p>';return;}
    _rdmSlides=teams.map(t=>{
      const data=_rdmBuildData(String(t.id));
      const colorMap=_rdmAssignColors(data.sprintBlocks);
      return{team:t,html:_rdmBuildTrackHtml(data,colorMap,t.name),data};
    });
    _rdmCarouselIdx=Math.max(0,_rdmSlides.findIndex(s=>String(s.team.id)===String(selectedTeamId)));
    const dis=_rdmSlides.length<=1?'disabled':'';
    content.innerHTML=`<div class="rdm-carousel" id="rdm-carousel">
      <div class="rdm-carousel-header">
        <span class="rdm-carousel-team-name" id="rdm-carousel-team-name">${_rdmSlides[_rdmCarouselIdx]?.team.name||''}</span>
      </div>
      <div class="rdm-carousel-stage">
        <button class="rdm-carousel-btn" onclick="rdmCarouselPrev()" ${dis}><span class="material-icons-round">chevron_left</span></button>
        <div class="rdm-carousel-slides-wrap" id="rdm-carousel-slides">
          ${_rdmSlides.map((s,i)=>`<div class="rdm-carousel-slide${i===_rdmCarouselIdx?' active':''}" data-idx="${i}">${s.html}</div>`).join('')}
        </div>
        <button class="rdm-carousel-btn" onclick="rdmCarouselNext()" ${dis}><span class="material-icons-round">chevron_right</span></button>
      </div>
      <div class="rdm-carousel-footer">
        <div class="rdm-carousel-dots" id="rdm-carousel-dots">
          ${_rdmSlides.map((_,i)=>`<span class="rdm-carousel-dot${i===_rdmCarouselIdx?' active':''}" onclick="rdmCarouselGo(${i})"></span>`).join('')}
        </div>
      </div>
    </div>`;
  } else {
    // Mode équipe unique
    const data=_rdmBuildData(filterVal);
    const colorMap=_rdmAssignColors(data.sprintBlocks);
    const tn=(S.objectivesData?.teams||[]).find(t=>String(t.id)===String(filterVal))?.name||'';
    content.innerHTML=_rdmBuildTrackHtml(data,colorMap,tn);
  }
}

function rdmCarouselGo(idx){
  if(!_rdmSlides.length)return;
  idx=((idx%_rdmSlides.length)+_rdmSlides.length)%_rdmSlides.length;
  _rdmCarouselIdx=idx;
  document.querySelectorAll('#rdm-carousel-slides .rdm-carousel-slide').forEach((s,i)=>s.classList.toggle('active',i===idx));
  document.querySelectorAll('#rdm-carousel-dots .rdm-carousel-dot').forEach((d,i)=>d.classList.toggle('active',i===idx));
  const tn=document.getElementById('rdm-carousel-team-name');
  if(tn)tn.textContent=_rdmSlides[idx]?.team.name||'';
}
function rdmCarouselPrev(){rdmCarouselGo(_rdmCarouselIdx-1);}
function rdmCarouselNext(){rdmCarouselGo(_rdmCarouselIdx+1);}

function renderRoadmap(){
  if(!S.objectivesData)return;
  initRoadmapFilter();
  renderRoadmapContent();
}
function filterRoadmap(){renderRoadmapContent();}

// ── PDF EXPORT ───────────────────────────────────────────
let _rdmFontCSS=null; // cache Inter base64 entre exports

async function _rdmBuildFontEmbedCSS(){
  if(_rdmFontCSS!==null)return _rdmFontCSS;
  try{
    const css=await fetch(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
    ).then(r=>r.text());
    const urls=[...css.matchAll(/url\((https?:\/\/[^)]+)\)/g)].map(m=>m[1]);
    const encoded=await Promise.all(urls.map(async url=>{
      try{
        const ab=await fetch(url).then(r=>r.arrayBuffer());
        const bytes=new Uint8Array(ab);
        let bin='';
        for(let j=0;j<bytes.length;j+=8192)
          bin+=String.fromCharCode.apply(null,bytes.subarray(j,j+8192));
        return{url,data:`data:font/woff2;base64,${btoa(bin)}`};
      }catch{return null;}
    }));
    let result=css;
    encoded.forEach(e=>e&&(result=result.split(e.url).join(e.data)));
    _rdmFontCSS=result;
  }catch{_rdmFontCSS='';}
  return _rdmFontCSS;
}

function _rdmLoadScript(src){
  return new Promise((resolve,reject)=>{
    if(document.querySelector(`script[src="${src}"]`)){resolve();return;}
    const s=document.createElement('script');
    s.src=src; s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}

function _rdmPrepareForExport(slide){
  const line=slide.querySelector('.rdm-road-line');
  if(line){
    line.style.strokeDashoffset='0';
    line.style.opacity='0.28';
    line.style.animation='none';
  }
  slide.querySelectorAll('.rdm-arrow').forEach(a=>{a._pdfDisplay=a.style.display;a.style.display='none';});
  const svg=slide.querySelector('.rdm-road-bg');
  if(svg&&line){
    const tmp=document.createElementNS('http://www.w3.org/2000/svg','path');
    tmp.setAttribute('d',line.getAttribute('d'));
    tmp.style.visibility='hidden';
    svg.appendChild(tmp);
    const total=tmp.getTotalLength();
    const AW='M -10,-6 L 4,0 L -10,6 L -6,0 Z';
    [0.20,0.55,0.85].forEach(pct=>{
      const len=total*pct;
      const pt=tmp.getPointAtLength(len);
      const pt2=tmp.getPointAtLength(Math.min(len+2,total));
      const angle=Math.atan2(pt2.y-pt.y,pt2.x-pt.x)*180/Math.PI;
      const arrow=document.createElementNS('http://www.w3.org/2000/svg','path');
      arrow.setAttribute('d',AW);
      arrow.setAttribute('fill','#64748b');
      arrow.setAttribute('opacity','0.7');
      arrow.setAttribute('transform',`translate(${pt.x},${pt.y}) rotate(${angle})`);
      arrow.classList.add('rdm-static-arrow');
      svg.appendChild(arrow);
    });
    svg.removeChild(tmp);
  }
  // Geler les animations d'entrée des cartes (opacity:0 dans le keyframe "from")
  slide.querySelectorAll('.rdm-sprint-card').forEach(c=>{
    c.style.animation='none';c.style.opacity='1';c.style.transform='none';
  });
  // Material Icons ne peut pas être ré-intégré par html-to-image (CORS Google Fonts)
  // → icône titre masquée, check remplacé par un cercle coloré
  const st=document.createElement('style');
  st.id='rdm-pdf-style';
  st.textContent=
    '.rdm-slide .rdm-slide-hd-title .material-icons-round{font-size:0!important;width:0;overflow:hidden;}'+
    '.rdm-slide .rdm-check{font-size:0!important;display:inline-block!important;'+
    'width:11px!important;height:11px!important;border-radius:50%!important;'+
    'background:#22c55e!important;margin-top:2px!important;flex-shrink:0!important;}';
  document.head.appendChild(st);
}

function _rdmRestoreAfterExport(slide){
  const line=slide.querySelector('.rdm-road-line');
  if(line){line.style.strokeDashoffset='';line.style.opacity='';line.style.animation='';}
  slide.querySelectorAll('.rdm-arrow').forEach(a=>{a.style.display=a._pdfDisplay||'';delete a._pdfDisplay;});
  slide.querySelectorAll('.rdm-static-arrow').forEach(a=>a.remove());
  slide.querySelectorAll('.rdm-sprint-card').forEach(c=>{
    c.style.animation='';c.style.opacity='';c.style.transform='';
  });
  document.getElementById('rdm-pdf-style')?.remove();
}

async function rdmExportPdf(){
  const btn=document.getElementById('rdm-export-btn');
  if(btn){btn.disabled=true;}
  try{
    await Promise.all([
      _rdmLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
      _rdmLoadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js')
    ]);
    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:[297,167]});
    const fontEmbedCSS=await _rdmBuildFontEmbedCSS();
    const entries=[];
    const filterVal=document.getElementById('rdm-team-filter')?.value||'';
    if(!filterVal){
      document.querySelectorAll('#rdm-carousel-slides .rdm-carousel-slide').forEach(wrap=>{
        const slide=wrap.querySelector('.rdm-slide');
        if(slide)entries.push({slide,wrap});
      });
    } else {
      const slide=document.querySelector('#rdm-content > .rdm-slide');
      if(slide)entries.push({slide,wrap:null});
    }
    for(let i=0;i<entries.length;i++){
      const{slide,wrap}=entries[i];
      const wasHidden=wrap&&!wrap.classList.contains('active');
      if(wasHidden){
        wrap.style.position='fixed';wrap.style.left='-9999px';
        wrap.style.top='0';wrap.style.display='block';
      }
      const natW=slide.offsetWidth||1024;
      const natH=slide.offsetHeight||576;
      _rdmPrepareForExport(slide);
      const dataUrl=await htmlToImage.toPng(slide,{pixelRatio:2,fontEmbedCSS:fontEmbedCSS||undefined});
      _rdmRestoreAfterExport(slide);
      if(wasHidden){
        wrap.style.position='';wrap.style.left='';
        wrap.style.top='';wrap.style.display='';
      }
      if(i>0)pdf.addPage();
      // Placement en respectant le ratio — fond neutre pour les marges éventuelles
      const pdfW=297,pdfH=167,r=natH/natW;
      let iw,ih,ix,iy;
      if(r*pdfW<=pdfH){iw=pdfW;ih=pdfW*r;ix=0;iy=(pdfH-ih)/2;}
      else{ih=pdfH;iw=pdfH/r;ix=(pdfW-iw)/2;iy=0;}
      pdf.setFillColor(248,250,252);
      pdf.rect(0,0,pdfW,pdfH,'F');
      pdf.addImage(dataUrl,'PNG',ix,iy,iw,ih);
    }
    pdf.save('roadmap.pdf');
  }catch(e){
    console.error('PDF export failed',e);
    alert('Erreur lors de l\'export PDF. Vérifiez la console.');
  }finally{
    if(btn){btn.disabled=false;}
  }
}

// ── UTILS ────────────────────────────────────────────────
function fd(ds){if(!ds)return '—';return new Date(ds).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function toast(msg,type='success'){
  const c=document.getElementById('toast-container'),t=document.createElement('div');
  const icon=type==='success'?'check_circle':type==='warning'?'warning':'error';
  t.className=`toast ${type}`;t.innerHTML=`<span class="material-icons-round ti">${icon}</span>${msg}`;
  c.appendChild(t);setTimeout(()=>t.remove(),3000);
}

// ── CHART.JS ─────────────────────────────────────────────
function loadChartJS(){return new Promise(res=>{if(window.Chart){res();return;}const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';s.onload=res;document.head.appendChild(s);});}

// ── INIT ─────────────────────────────────────────────────
async function init(){
  applyMode();
  scheduleMode();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{applyMode();scheduleMode();});
  setTheme(localStorage.getItem('bcp_theme')||'green');
  await loadChartJS();
  // Listener bouton back/forward navigateur
  window.addEventListener('popstate',e=>{if(CU&&e.state?.page)navTo(e.state.page,true);});

  // Détecter un token de réinitialisation dans l'URL
  const _resetToken=new URLSearchParams(location.search).get('token');
  if(_resetToken){
    // Vérifier la validité du token avant d'afficher le formulaire
    try{
      const r=await fetch('/api/auth/check-reset-token?token='+encodeURIComponent(_resetToken)).then(x=>x.json());
      if(r.valid){
        // Injecter le token dans un champ caché et afficher le formulaire reset
        const container=document.getElementById('reset-form');
        if(!document.getElementById('reset-token-val')){
          const inp=document.createElement('input');
          inp.type='hidden'; inp.id='reset-token-val'; inp.value=_resetToken;
          container.appendChild(inp);
        }
        document.getElementById('auth-screen').style.display='flex';
        showResetForm();
        return;
      }
    }catch{}
    // Token invalide → afficher login avec message
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('login-error').textContent='Ce lien est invalide ou a expiré.';
    document.getElementById('login-error').style.display='block';
    return;
  }

  const token=localStorage.getItem('bcp_token');
  if(token){
    try{
      const data=await API.get('/api/auth/me');
      localStorage.setItem('bcp_token',data.token);
      localStorage.setItem('bcp_user',JSON.stringify(data.user));
      loginOk(data.user);
    }catch(e){
      // Token invalide → rediriger vers login en préservant la page demandée
      const _path=location.pathname.replace(BASE_PATH,'').replace(/\/$/,'');
      const _slug=SLUG_PAGES[_path]?_path:'';
      history.replaceState({},'',BASE_PATH+'login'+(_slug?'?page='+_slug:''));
    }
  } else {
    // Pas de token → mettre l'URL sur /login en préservant la page demandée
    const _path=location.pathname.replace(BASE_PATH,'').replace(/\/$/,'');
    const _slug=SLUG_PAGES[_path]?_path:'';
    history.replaceState({},'',BASE_PATH+'login'+(_slug?'?page='+_slug:''));
  }
}
init();
