const organizerClaimToken=new URLSearchParams(window.location.search).get('organizer_claim')||'';
let organizerSearchActive=false,organizerSearchKey='',organizerEvent=null,organizerSearchError='',organizerSearchVersion=0,claimedOrganizerKey='';
let currentUser=null;
const registeredEvents=new Set(), registeringEvents=new Set();
let treeData={waterings:0,level:1,reports:[]};const reportingEvents=new Set();
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showToast(title,message,warning=false){
 const toast=document.createElement('div');toast.className='app-toast'+(warning?' toast-warning':'');
 toast.innerHTML=`<span class="toast-icon" aria-hidden="true">${warning?'!':'✓'}</span><div class="toast-content"><strong>${esc(title)}</strong><p>${esc(message)}</p></div><button type="button" class="toast-close" aria-label="Dismiss notification">×</button>`;
 $('toastRegion').appendChild(toast);
 const timer=setTimeout(()=>toast.remove(),10000);
 toast.querySelector('button').onclick=()=>{clearTimeout(timer);toast.remove()};
}
function setTestMode(enabled){
 const active=!!currentUser?.is_admin&&!!enabled;
 $('showSamples').checked=active;
 renderEventsOnHome();renderImpact();renderPersonalImpact();
}
const eventMarkers=new Map();
let map,markers,selected,posts=[],events=[],googleMap,googlePins=[],googleInfo;
if(window.L){map=L.map('map').setView([42.2808,-83.7382],15);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);markers=L.layerGroup().addTo(map);map.on('click',e=>{selected=[e.latlng.lat,e.latlng.lng];$('status').textContent='Pin selected. Open “Share surplus food” to publish here.'})}else $('map').textContent='Map unavailable. Announcements remain available in the list.';
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
function tab(name){
 if(name==='personal'&&!currentUser)return;
 for(const n of ['food','impact','events','personal'])$(n).classList.toggle('hidden',n!==name);
 for(const [page,id] of [['food','foodTab'],['personal','personalTab']]){const active=page===name;$(id).classList.toggle('page-tab-active',active);if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current')}
 if(name==='food'&&map)map.invalidateSize();
}
$('foodTab').onclick=()=>tab('food');$('impactTab').onclick=()=>tab('impact');
let selectedCategory='All', selectedEventId=null, mapFramed=false;
const foodPhotos={fruit:'photo-1490645935967-10de6ba17061',pizza:'photo-1565299624946-b28f40a0ae38',bowls:'photo-1512621776951-a57141f2eefd',bagels:'photo-1509440159596-0249088772ff',sandwiches:'photo-1528735602780-2552fd46c7af'};
function eventImage(e){return e.image_url||`https://images.unsplash.com/${foodPhotos[e.food]||foodPhotos.bowls}?auto=format&fit=crop&w=900&q=80`}
function remaining(deadline){if(!deadline)return 'Unconfirmed';const mins=Math.max(0,Math.ceil((Date.parse(deadline)-Date.now())/60000));return mins>=60?Math.floor(mins/60)+'h '+(mins%60)+'m':mins+'m'}
function isUrgent(e){return e.deadline&&Date.parse(e.deadline)-Date.now()<30*60000}
function eventPopup(e){return `<strong>${esc(e.title)}</strong><p>${esc(e.location)}</p><p>${e.sample?'Sample pickup · ':''}${e.deadline?'Pickup closes at '+esc(new Date(e.deadline).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))+' · '+remaining(e.deadline)+' left':'Surplus not confirmed; no pickup deadline'}</p><p>${e.registration_count||0} registered to collect food</p>`}
function registrationControl(e,index){
 if(registeredEvents.has(e.id))return '<span class="going-tag">✓ You\'re going</span>';
 const saving=registeringEvents.has(e.id);return `<button class="register-button" data-register="${index}" ${saving?'disabled':''}>${saving?'Saving…':"I'm going"}</button>`;
}
async function refresh(){
 try{
  const [data,feed]=await Promise.all([api('/api/posts'),api('/api/events')]);posts=data.posts;events=feed.events;
  renderEventsOnHome();renderGooglePins();
  $('metrics').innerHTML=[['Announcements published',data.stats.published],['Currently active',data.stats.active],['Portions reported',data.stats.reportedPortions]].map(([label,num])=>`<div class="card metric"><strong>${num}</strong>${label}</div>`).join('');
 }catch(error){$('status').textContent='Unable to refresh. Displayed information may be outdated.'}
}
$('cancel').onclick=()=>$('formDialog').close();$('place').onchange=()=>selected=null;
$('form').onsubmit=async e=>{e.preventDefault();$('submit').disabled=true;try{const body=Object.fromEntries(new FormData(e.target));const [lat,lng]=selected||$('place').value.split(',').map(Number);body.lat=lat;body.lng=lng;body.deadline=new Date(body.deadline).toISOString();const result=await api('/api/posts',body);$('formDialog').close();e.target.reset();selected=null;tab('food');await refresh()}catch(e){$('formError').textContent=e.message}finally{$('submit').disabled=false}};
$('eventsButton').onclick=async()=>{tab('events');$('eventList').textContent='Loading official UMich activity feed…';try{const data=await api('/api/events');$('eventList').innerHTML=data.events.map((e,i)=>`<article class="card"><h3>${esc(e.title)}</h3><p>${esc(e.location)}</p><p>${esc(e.description.slice(0,500))}</p><span class="badge">${e.evidence.length?'Food terms: '+esc(e.evidence.join(', ')):'Needs review'}</span><p><a href="${/^https?:\/\//.test(e.url)?esc(e.url):'#'}" target="_blank" rel="noopener">View source event</a></p><button data-ai="${i}">AI review</button><p id="ai-${i}"></p></article>`).join('')||'No Food-tagged events today in Ann Arbor.';document.querySelectorAll('[data-ai]').forEach(b=>b.onclick=async()=>{b.disabled=true;const out=$('ai-'+b.dataset.ai);out.textContent='Reviewing…';try{out.textContent=(await api('/api/identify',{description:data.events[b.dataset.ai].description})).result}catch(e){out.textContent=e.message}finally{b.disabled=false}})}catch(e){$('eventList').textContent=e.message}};
setInterval(refresh,5000);

function renderEventsOnHome(){
 if(organizerSearchActive){renderOrganizerEvent();return}
 const expanded=new Set([...document.querySelectorAll('[data-event-index] details[open]')].map(detail=>events[Number(detail.closest('[data-event-index]').dataset.eventIndex)]?.id));
 eventMarkers.clear();markers?.clearLayers();
 const query=$('searchFood').value.toLowerCase().trim();
 const visible=events.filter(e=>((currentUser?.is_admin&&$('showSamples').checked)||!e.sample)&&(selectedCategory==='All'||(e.category||'events.umich.edu')===selectedCategory)&&[e.title,e.location,e.organizer,e.description].join(' ').toLowerCase().includes(query));
 visible.sort((a,b)=>$('sortFood').value==='name'?a.title.localeCompare(b.title):(Date.parse(a.deadline)||Infinity)-(Date.parse(b.deadline)||Infinity));
 $('pickupCount').textContent=visible.filter(e=>e.deadline).length+' active pickups';
 $('list').innerHTML=visible.map(e=>{const i=events.indexOf(e);return `<article class="card event-card ${selectedEventId===e.id?'selected-event':''}" data-event-index="${i}"><div class="food-cover"><img src="${esc(eventImage(e))}" onerror="this.onerror=null;this.src='/images/${['pizza','fruit','bagels','sandwiches','bowls'].includes(e.food)?e.food:'bowls'}.svg'" alt="${e.image_url?'Photo uploaded by the event creator':'Illustrative food photo, not a photo of this pickup'}"><div class="cover-badges"><span class="badge ${isUrgent(e)?'urgent':''}">${e.deadline?(isUrgent(e)?'Hurry':'Plenty of time'):'Event'}</span><span class="badge category">${esc(e.category||'events.umich.edu')}</span></div></div><div class="card-body">${e.sample?'<span class="sample-tag">SAMPLE · TEST DATA</span>':''}<h3>${esc(e.title)}</h3><div class="organizer">${esc(e.organizer||'UMich campus event')}</div><p>♧ ${esc(e.location||'Location not provided')}</p><p class="deadline">◷ ${e.deadline?'Pickup closes in <span data-countdown="'+esc(e.deadline)+'">'+remaining(e.deadline)+'</span>':'Surplus not confirmed'}</p><p class="count">♧ <span data-count-event="${esc(e.id)}">${e.registration_count||0}</span> registered to collect food</p>${e.food_items?.length?'<p class="muted">'+e.food_items.map(item=>esc(item.item_name)+': '+esc(item.quantity)+' '+esc(item.unit)).join(' · ')+'</p>':e.quantity?'<p class="muted">'+esc(e.quantity)+' '+esc(e.unit||'portions')+' remaining</p>':''}<details ${expanded.has(e.id)?'open':''}><summary>Event details</summary><p>${esc(e.description||'No additional instructions.')}</p>${e.url?'<a target="_blank" rel="noopener" href="'+(/^https?:\/\//.test(e.url)?esc(e.url):'#')+'">View source event</a>':''}</details>${registrationControl(e,i)}${reportControls(e,i)}<p class="muted">Let organizers know you are coming. Food remains first come, first served.</p></div></article>`}).join('')||'<article class="card empty"><h3>No matching pickups or events</h3><p>Try another filter or check back for new food pickups.</p></article>';
 if(map)for(const e of visible){if(e.lat==null||e.lng==null)continue;
  const html=`<span class="pin-label ${isUrgent(e)?'urgent':''}"><span data-countdown="${esc(e.deadline||'')}">${remaining(e.deadline)}</span> ♧ ${e.registration_count||0}</span>`;
  const marker=L.marker([e.lat,e.lng],{icon:L.divIcon({html,iconSize:[0,0],iconAnchor:[0,0]})}).addTo(markers).bindPopup(eventPopup(e));eventMarkers.set(e,marker);
 }
 if(map&&!mapFramed&&visible.some(e=>e.lat!=null)){map.fitBounds(visible.filter(e=>e.lat!=null&&e.lng!=null).map(e=>[e.lat,e.lng]),{padding:[55,55],maxZoom:15});mapFramed=true}
}
async function loadHomeEvents(){await refresh();await locateEvents()}
$('searchFood').oninput=handleOrganizerSearch;$('sortFood').onchange=()=>renderEventsOnHome();$('showSamples').onchange=()=>setTestMode($('showSamples').checked);
const categories=['All','Department event','Church / faith group','MHacks','events.umich.edu','Student org','Community pickup','Community event'];
$('categoryFilters').innerHTML=categories.map(c=>`<button class="${c==='All'?'active':''}" data-category="${esc(c)}">${esc(c)}</button>`).join('');
$('categoryFilters').onclick=event=>{const button=event.target.closest('[data-category]');if(!button)return;selectedCategory=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b===button));renderEventsOnHome()};
setInterval(()=>{document.querySelectorAll('[data-countdown]').forEach(label=>label.textContent=remaining(label.dataset.countdown))},1000);
initializeMaps().then(()=>{refresh();loadHomeEvents()});setInterval(loadHomeEvents,300000);

// Google Places results stay in memory for this browser session, not persistent storage.
const placeCache=new Map();
async function initializeMaps(){
 try{
  const config=await api('/api/config');
  if(!config.googleMapsKey)return;
  await new Promise((resolve,reject)=>{window.campusGoogleReady=resolve;const script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(config.googleMapsKey)+'&loading=async&libraries=places&callback=campusGoogleReady';script.onerror=reject;document.head.appendChild(script)});
  map?.remove();map=null;markers=null;
  googleMap=new google.maps.Map($('map'),{center:{lat:42.2808,lng:-83.7382},zoom:14,mapTypeControl:false,streetViewControl:false});
  googleInfo=new google.maps.InfoWindow();
  googleMap.addListener('click',e=>{selected=[e.latLng.lat(),e.latLng.lng()];$('status').textContent='Pin selected. Open Share surplus food to publish here.'});
 }catch(e){$('status').textContent='Google Maps unavailable. Check your browser key, enabled APIs and website restrictions.'}
}
async function locateEvents(){
 if(!googleMap)return;
 const {Place}=await google.maps.importLibrary('places');
 for(const e of events)if(e.lat!=null&&e.lng!=null)placeCache.set(e.location,{lat:e.lat,lng:e.lng});
 const locations=[...new Set(events.filter(e=>e.lat==null).map(e=>e.location).filter(x=>x&& !/virtual|online|zoom|off campus location/i.test(x)))];
 for(const location of locations){
  if(placeCache.has(location))continue;
  try{
   const result=await Place.searchByText({textQuery:location+', University of Michigan, Ann Arbor, MI',fields:['location','displayName','formattedAddress'],locationBias:{lat:42.2808,lng:-83.7382},maxResultCount:3});
   const candidates=(result.places||[]).filter(p=>p.location&&/Ann Arbor/i.test(p.formattedAddress||''));
   // Only auto-place a unique local match; ambiguous locations remain list-only.
   if(candidates.length===1){const p=candidates[0];placeCache.set(location,{lat:p.location.lat(),lng:p.location.lng(),name:p.displayName})}else placeCache.set(location,null);
  }catch(e){$('status').textContent='Events loaded; some Google building searches failed. Check Places API access.';break}
 }
 renderGooglePins();
}
function renderGooglePins(){
 if(organizerSearchActive)return;
 if(!googleMap)return;
 for(const pin of googlePins)pin.setMap(null);googlePins=[];
 const add=(position,title,html,color)=>{const pin=new google.maps.Marker({map:googleMap,position,title,icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});pin.addListener('click',()=>{googleInfo.setContent(html);googleInfo.open({map:googleMap,anchor:pin})});googlePins.push(pin)};
 for(const p of posts)add({lat:p.lat,lng:p.lng},p.title,`<strong>${esc(p.title)}</strong><p>${esc(p.location)}</p>Confirmed surplus until ${esc(new Date(p.deadline).toLocaleTimeString())}`,'#225e43');
 const grouped=new Map();for(const e of events){const pos=placeCache.get(e.location);if(!pos)continue;if(!grouped.has(e.location))grouped.set(e.location,{pos,events:[]});grouped.get(e.location).events.push(e)}
 for(const [location,g] of grouped)add(g.pos,location,`<strong>${esc(location)}</strong><p>Food-related events · Surplus unconfirmed</p>`+g.events.map(e=>`<p>${esc(e.title)}<br>${esc(e.start)}</p>`).join(''),'#a66b14');
}

function focusEvent(index){
 const e=events[index];if(!e)return;selectedEventId=e.id;
 const pos=e.lat!=null&&e.lng!=null?{lat:e.lat,lng:e.lng}:placeCache.get(e.location);
 if(!pos){$('status').textContent='This event has no verified map location. Check the source event for directions.';return}
 document.querySelectorAll('[data-event-index]').forEach(card=>card.classList.toggle('selected-event',Number(card.dataset.eventIndex)===index));
 if(googleMap){googleMap.setCenter(pos);googleMap.setZoom(17);googleInfo.setPosition(pos);googleInfo.setContent(eventPopup(e));googleInfo.open({map:googleMap})}
 else if(map){map.invalidateSize();map.flyTo([pos.lat,pos.lng],17,{duration:0.7});eventMarkers.get(e)?.openPopup()}
 else{$('status').textContent='Map unavailable. Check the source event for directions.';return}
 $('status').textContent='Showing '+e.title+' at '+e.location+'.';
 if(matchMedia('(max-width:750px)').matches)$('map').scrollIntoView({behavior:'smooth',block:'center'});
}
$('list').addEventListener('click',event=>{
 const report=event.target.closest('[data-report]');if(report){reportFood(Number(report.dataset.index),report.dataset.report);return}
 const button=event.target.closest('[data-register]');
 if(button){registerEvent(Number(button.dataset.register));return}
 if(event.target.closest('a,button'))return;
 const card=event.target.closest('[data-event-index]');if(card)focusEvent(Number(card.dataset.eventIndex));
});
async function syncRegistrations(){
 registeredEvents.clear();
 if(currentUser){const data=await api('/api/registrations');for(const r of data.registrations)registeredEvents.add(r.event_id)}
 await loadTree();renderEventsOnHome();updateRegisterButtons();
}
function updateRegisterButtons(){
 document.querySelectorAll('[data-register]').forEach(button=>{const e=events[Number(button.dataset.register)];if(!e)return;button.disabled=registeringEvents.has(e.id);button.textContent=registeringEvents.has(e.id)?'Saving…':"I'm going"});
}
async function registerEvent(index){
 const e=events[index];if(!e||registeredEvents.has(e.id)||registeringEvents.has(e.id))return;
 try{
  const session=await api('/api/auth/me');renderAccount(session.user);
  if(!session.user){registeredEvents.clear();updateRegisterButtons();setAuthMode('login');$('authDialog').showModal();$('authError').textContent='Please log in or create an account, then press Register again.';return}
  registeringEvents.add(e.id);updateRegisterButtons();
  await api('/api/events');
  await api('/api/registrations',{event_id:e.id});registeredEvents.add(e.id);await refresh();$('status').textContent="You're going to "+e.title+'.';
 }catch(error){$('status').textContent=error.message}
 finally{registeringEvents.delete(e.id);updateRegisterButtons()}
}

let authMode='login';
function renderAccount(user){
 $('smsSubscriptionInfo').classList.toggle('hidden',!user?.sms_opt_in);
 const previousAdmin=!!currentUser?.is_admin;
 currentUser=user;
 const admin=!!user?.is_admin;
 $('testModeControls').classList.toggle('hidden',!admin);
 $('showSamples').disabled=!admin;if(!admin)$('showSamples').checked=false;
 if(admin&&!previousAdmin)setTestMode(true);else if(!admin)setTestMode(false);

 $('personalTab').classList.toggle('hidden',!user);$('impactTab').classList.add('hidden');$('eventsButton').classList.add('hidden');
 if(!user){treeData={waterings:0,level:1,reports:[]};tab('food');$('personalTree').innerHTML='';$('reportHistory').innerHTML=''}
 $('accountName').textContent=user?'Hi, '+user.name:'';
 $('loginButton').classList.toggle('hidden',!!user);
 $('logoutButton').classList.toggle('hidden',!user);
}
function setAuthMode(mode){
 authMode=mode;const signup=mode==='register';
 $('authTitle').textContent=signup?'Create an account':'Log in';
 $('authSubmit').textContent=signup?'Sign up':'Log in';
 $('authSwitch').textContent=signup?'Already have an account? Log in':'Create an account';
 $('nameLabel').classList.toggle('hidden',!signup);
 $('passwordHelp').classList.toggle('hidden',!signup);
 $('authForm').elements.name.required=signup;
 $('signupSmsFields').classList.toggle('hidden',!signup);
 $('signupSmsOptIn').disabled=!signup;
 updateSignupSms();
 $('authForm').elements.password.minLength=signup?10:1;
 $('authForm').elements.password.autocomplete=signup?'new-password':'current-password';
 $('authError').textContent='';
}
$('loginButton').onclick=()=>{setAuthMode('login');$('authDialog').showModal()};
$('authCancel').onclick=()=>{$('authDialog').close();$('authForm').reset()};
$('authSwitch').onclick=()=>setAuthMode(authMode==='login'?'register':'login');
$('authForm').onsubmit=async event=>{
 event.preventDefault();$('authSubmit').disabled=true;$('authSwitch').disabled=true;$('authError').textContent='';
 try{const isSignup=authMode==='register';const result=await api('/api/auth/'+authMode,Object.fromEntries(new FormData(event.target)));renderAccount(result.user);await syncRegistrations();$('authDialog').close();event.target.reset();$('status').textContent='You are logged in.';if(isSignup){$('welcomeTree').innerHTML=treeSVG(1);$('treeWelcome').showModal()}}
 catch(error){$('authError').textContent=error.message}
 finally{$('authSubmit').disabled=false;$('authSwitch').disabled=false}
};
$('logoutButton').onclick=async()=>{
 $('logoutButton').disabled=true;
 try{await api('/api/auth/logout',{});renderAccount(null);await syncRegistrations();$('status').textContent='You are logged out.'}
 catch(error){$('status').textContent=error.message}
 finally{$('logoutButton').disabled=false}
};
async function initializeAccount(){
 let data;
 try{data=await api('/api/auth/me')}
 catch(error){setAuthMode('login');if(!organizerClaimToken&&!$('authDialog').open)$('authDialog').showModal();$('authError').textContent='Unable to reach the login service. Refresh the page or add an event as a guest.';return}
 renderAccount(data.user);
 try{await syncRegistrations()}
 catch(error){console.error('Account data failed to load',error);$('status').textContent='Your login was recognized, but some account data could not load. Refresh the page.'}
 if(!data.user&&!organizerClaimToken){setAuthMode('login');if(!$('authDialog').open)$('authDialog').showModal()}
}
initializeAccount();
$('authGuest').onclick=async()=>{$('authDialog').close();$('authForm').reset();$('authError').textContent='';await $('addEvent').onclick()};

let plushTreeSerial=0;
function treeSVG(level,watering=false){
 level=Math.max(1,Math.min(5,level));const id='plush-'+(++plushTreeSerial),stage=['Seed','Seedling','Small tree','Medium tree','Large tree'][level-1];
 const face=(x,y,size=1)=>`<g transform="translate(${x} ${y}) scale(${size})"><ellipse cx="-16" cy="0" rx="3.5" ry="4.5" fill="#3e352e"/><ellipse cx="16" cy="0" rx="3.5" ry="4.5" fill="#3e352e"/><circle cx="-15" cy="-1.5" r="1" fill="white"/><circle cx="17" cy="-1.5" r="1" fill="white"/><ellipse cx="-25" cy="8" rx="7" ry="3.5" fill="#dea99e" opacity=".65"/><ellipse cx="25" cy="8" rx="7" ry="3.5" fill="#dea99e" opacity=".65"/><path d="M-6 8q6 8 12 0" stroke="#655044" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
 const canopy=level===3?'M106 164C75 159 73 126 94 115C82 85 112 64 135 77C145 51 177 60 184 82C216 77 228 107 211 126C228 156 197 180 173 164C153 183 127 180 106 164Z':level===4?'M90 164C55 158 53 122 76 107C62 76 90 49 119 60C130 32 166 32 181 55C210 36 243 66 230 95C258 113 246 150 220 156C207 185 174 182 156 167C132 185 101 187 90 164Z':'M69 177C31 169 31 132 56 112C36 81 59 48 92 54C88 21 123 5 147 27C169 0 208 17 211 46C245 30 272 65 251 92C284 111 278 152 249 164C255 193 217 215 192 192C168 218 135 206 119 189C97 210 68 201 69 177Z';
 const fuzz=Array.from({length:level===5?170:95},(_,i)=>`<path d="M${35+(i*47%236)} ${15+(i*31%200)}q-2-3 1-4" stroke="${i%2?'#dbe7bf':'#637c52'}" opacity=".28" stroke-width="1.5" fill="none" stroke-linecap="round"/>`).join('');
 let plant='';
 if(level===1)plant=`<ellipse cx="150" cy="214" rx="25" ry="18" fill="url(#${id}-seed)" stroke="#a88a65" stroke-width="1.5"/><path d="M146 201q-8 11-2 23" stroke="#ead9b6" stroke-width="2" fill="none" stroke-dasharray="2 3"/>`;
 if(level===2)plant=`<path d="M150 220Q147 188 153 160" stroke="#8aab71" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M151 186C119 184 102 159 106 145C136 143 151 158 151 186Z" fill="url(#${id}-leaves)" stroke="#8a9e74"/><path d="M152 175C149 142 173 127 196 136C195 163 177 181 152 175Z" fill="url(#${id}-leaves)" stroke="#8a9e74"/><path d="M116 154l29 25m40-35l-27 24" stroke="#dce6c6" stroke-width="2" opacity=".6"/>`;
 if(level>=3)plant=`<path d="M${level===5?133:139} 265V143Q150 130 ${level===5?167:161} 143V265" fill="url(#${id}-trunk)" stroke="#a68965" stroke-width="1.5"/><path d="M146 158v82m10-78v76" stroke="#ead4b1" stroke-width="2" opacity=".5" stroke-dasharray="3 4"/><path d="${canopy}" fill="url(#${id}-leaves)" stroke="#839a6a" stroke-width="2"/><g clip-path="url(#${id}-clip)">${fuzz}</g><path d="${level===5?'M64 80q-9 16-2 30M110 37q15-13 27-6':'M100 89q-8 12-3 22'}" stroke="#e1eacd" stroke-width="5" opacity=".45" fill="none" stroke-linecap="round"/>${level>=4?face(150,level===5?239:220,.8):''}`;
 const base=level<=3?`<ellipse cx="116" cy="304" rx="17" ry="9" fill="#a58b70"/><ellipse cx="184" cy="304" rx="17" ry="9" fill="#a58b70"/><path d="M100 226Q100 218 112 218H188Q200 218 200 230L188 288Q183 306 150 306Q117 306 112 288Z" fill="url(#${id}-pot)" stroke="#c7b291" stroke-width="1.8"/><ellipse cx="150" cy="222" rx="49" ry="10" fill="#e6d5bb"/><ellipse cx="150" cy="222" rx="37" ry="5" fill="#997b5c"/><path d="M110 241q40 10 80 0" stroke="#bca58b" stroke-width="1.5" fill="none" stroke-dasharray="2 4"/>${face(150,270)}<path d="M120 291q30 10 60 0" stroke="#fff1dd" stroke-width="3" opacity=".5" fill="none"/>`:`<ellipse cx="150" cy="290" rx="${level===5?110:95}" ry="23" fill="#d1bc9b"/><path d="M${level===5?43:60} 290q20-24 44-13q24-25 49-10q28-23 48-4q28-12 56 16q18 1 18 15" fill="#b59a76" stroke="#a58a65" stroke-width="2"/><path d="M74 292l8-3m20 9l7-2m80-4l10 2m-56 6l7-1m80-12l8-3" stroke="#e7d5b6" stroke-width="2" stroke-linecap="round"/><path d="M72 279q-10-18-17-13m175 10q6-16 15-14" stroke="#93ac7c" stroke-width="4" fill="none" stroke-linecap="round"/>`;
 return `<svg viewBox="0 0 300 330" role="img" aria-label="${stage}, soft plush style, ${level<=3?'in a flowerpot':'growing in soil'}"><defs><radialGradient id="${id}-leaves" cx="30%" cy="20%" r="80%"><stop stop-color="#c9d9ae"/><stop offset=".6" stop-color="#9bb77e"/><stop offset="1" stop-color="#718d5b"/></radialGradient><linearGradient id="${id}-pot"><stop stop-color="#d7c4a8"/><stop offset=".5" stop-color="#f4e7d2"/><stop offset="1" stop-color="#cdb799"/></linearGradient><linearGradient id="${id}-seed"><stop stop-color="#e2caa0"/><stop offset="1" stop-color="#b79568"/></linearGradient><linearGradient id="${id}-trunk"><stop stop-color="#b6946e"/><stop offset=".5" stop-color="#d4b58b"/><stop offset="1" stop-color="#a88961"/></linearGradient><filter id="${id}-shadow" x="-25%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#826e52" flood-opacity=".16"/></filter><clipPath id="${id}-clip"><path d="${canopy}"/></clipPath></defs><ellipse cx="150" cy="311" rx="110" ry="10" fill="#e9dfd1" opacity=".5"/><g filter="url(#${id}-shadow)">${level<=3?`<ellipse cx="150" cy="225" rx="38" ry="6" fill="#997b5c"/>`:''}${plant}${base}${level===1?`<ellipse cx="150" cy="214" rx="25" ry="18" fill="url(#${id}-seed)" stroke="#b29570"/><path d="M146 201q-8 11-2 23" stroke="#f0dfbe" stroke-width="2" fill="none" stroke-dasharray="2 3"/>`:''}</g>${watering?'<g class="water-drop" fill="#8acddd"><path d="M70 15q-15 23 0 23q15 0 0-23"/><path d="M230 20q-15 23 0 23q15 0 0-23"/></g>':''}</svg>`;
}
function completedForest(count){
 const columns=Math.min(6,Math.ceil(Math.sqrt(count))),rows=[];
 for(let first=0;first<count;first+=columns){
  const length=Math.min(columns,count-first);
  rows.push(`<div class="forest-row" style="--forest-depth:${rows.length}">${Array.from({length},(_,i)=>`<div class="forest-member" title="Tree ${first+i+1} · Complete">${treeSVG(5)}</div>`).join('')}</div>`);
 }
 return `<div class="forest-completed"><div class="forest-caption">Your little forest · ${count} ${count===1?'tree':'trees'} grown</div><div class="forest-grove" role="group" aria-label="${count} completed trees">${rows.join('')}</div></div>`;
}
function renderTree(watering=false){
 const completed=treeData.completed_trees||0;
 $('personalTree').classList.toggle('tree-forest',completed>0);
 $('personalTree').innerHTML=completed?completedForest(completed)+`<div class="forest-growing">${treeSVG(treeData.level,watering)}<span>Tree ${completed+1} · Growing</span></div>`:treeSVG(treeData.level,watering);
 $('personalTree').classList.toggle('watering',watering);
 $('treeGreeting').textContent=(currentUser?.name||'Your')+"’s little tree";
 const grams=treeData.grams||0,goal=treeData.stage_goal||100;
 $('treeStats').textContent=(treeData.stage||'Seed')+(completed?' · Tree '+(completed+1):'');
 const lifetime=RescueImpact.summarize(treeData.impact?.entries||[]);
 $('personalCarbonSaved').textContent=(lifetime.co2e*1000).toLocaleString(undefined,{maximumFractionDigits:1})+' g CO₂ emission reduced';
 $('personalWaterings').textContent=treeData.waterings+' '+(treeData.waterings===1?'watering':'waterings');
 $('treeGrowthProgress').value=treeData.progress||0;
 $('treeGrowthGoal').textContent=(goal-grams).toLocaleString(undefined,{maximumFractionDigits:1})+' g CO₂ emission until '+(treeData.level===5?'your next seed':['Seed','Seedling','Small tree','Medium tree','Large tree'][treeData.level||1])+'. '+grams.toLocaleString(undefined,{maximumFractionDigits:1})+' / 1500 g CO₂ emission for this tree.';

 renderPersonalImpact();
 $('reportHistory').innerHTML=treeData.reports.map(r=>`<div class="history-row">${esc(events.find(e=>e.id===r.event_id)?.title||r.event_id)}<br>${r.status==='got_food'?'Collected food':'Food ran out'} · ${esc(new Date(r.updated).toLocaleString())}</div>`).join('');
}
async function loadTree(){if(!currentUser)return;treeData=await api('/api/personal');renderTree()}
function reportControls(e,index){
 if(!currentUser||!registeredEvents.has(e.id))return '';
 const report=treeData.reports.find(r=>r.event_id===e.id);
 return `<div class="report-controls"><button data-report="got_food" data-index="${index}" ${reportingEvents.has(e.id)?'disabled':''}>Just got it</button><button class="secondary" data-report="ran_out" data-index="${index}" ${reportingEvents.has(e.id)?'disabled':''}>It ran out</button></div><p class="report-feedback">${report?'Tree watered ✓ · Your report: '+(report.status==='got_food'?'Collected food':'Food ran out'):'Report food availability to water your tree.'}</p>`;
}
async function reportFood(index,status,pickupDetails=null){
 const e=events[index];if(!e||reportingEvents.has(e.id))return;
 if(status==='got_food'&&!pickupDetails){openPickup(index);return}
 reportingEvents.add(e.id);renderEventsOnHome();
 try{const result=await api('/api/reports',{event_id:e.id,status,...(pickupDetails||{})});treeData=result.tree;renderTree(result.watered);if(result.event_status===false)events=events.filter(event=>event.id!==e.id);await refresh();await refreshImpact();showToast(result.watered?'Tree watered!':'Report updated',result.watered?'Thanks! Your report watered your tree.':'Each event waters your tree only once.');return true}
 catch(error){$('status').textContent=error.message;$('pickupError').textContent=error.message;return false}
 finally{reportingEvents.delete(e.id);renderEventsOnHome()}
}
$('personalTab').onclick=async()=>{tab('personal');try{await loadTree()}catch(error){$('status').textContent=error.message}};
$('treeWelcomeDone').onclick=()=>{$('treeWelcome').close();tab('personal');renderTree()};
$('impactTab').classList.add('hidden');$('eventsButton').classList.add('hidden');

let pickupIndex=null,impactRange='all',impactPayload=null;const impactCharts={};
let pickupAllowed=[];
function addPickupRow(){
 const container=$('pickupFoodTypes');if(container.children.length>=pickupAllowed.length)return;
 const selected=Array.from(container.querySelectorAll('select')).map(s=>s.value);
 const next=pickupAllowed.find(item=>!selected.includes(item.id));
 container.insertAdjacentHTML('beforeend',`<div class="event-food-row"><select data-food-type required aria-label="Collected food type">${pickupAllowed.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select><div class="event-food-amount"><input data-food-quantity type="number" min="1" max="10000" step="1" required value="1" aria-label="Quantity collected"><span class="event-food-unit"></span></div><button type="button" class="food-remove-row" aria-label="Remove collected type">×</button></div>`);
 container.lastElementChild.querySelector('select').value=next.id;updatePickupRows();
}
function updatePickupRows(){
 const rows=Array.from($('pickupFoodTypes').children),selected=rows.map(row=>row.querySelector('select').value);
 rows.forEach(row=>{const select=row.querySelector('select'),item=pickupAllowed.find(i=>i.id===select.value);row.querySelector('.event-food-unit').textContent=item?.unit||'';Array.from(select.options).forEach(o=>o.disabled=o.value!==select.value&&selected.includes(o.value));row.querySelector('.food-remove-row').disabled=rows.length===1});
 $('pickupAddAnother').disabled=rows.length>=pickupAllowed.length;
}
function openPickup(index){
 const event=events[index];pickupIndex=index;$('pickupEventTitle').textContent=event.title;$('pickupError').textContent='';
 const ids=event.item_ids||[event.item_id];pickupAllowed=RescueImpact.ITEMS.filter(item=>ids.includes(item.id));
 $('pickupFoodTypes').innerHTML='';addPickupRow();$('pickupSubmit').disabled=!pickupAllowed.length;
 if(!pickupAllowed.length)$('pickupError').textContent='The organizer has not provided food types for this event.';
 $('pickupDialog').showModal();
}
$('pickupFoodTypes').onchange=updatePickupRows;
$('pickupFoodTypes').onclick=e=>{const button=e.target.closest('.food-remove-row');if(button&&!button.disabled){button.closest('.event-food-row').remove();updatePickupRows()}};
$('pickupAddAnother').onclick=addPickupRow;
$('pickupCancel').onclick=()=>{$('pickupDialog').close();pickupIndex=null};
$('pickupForm').onsubmit=async event=>{event.preventDefault();const index=pickupIndex;if(index==null)return;$('pickupSubmit').disabled=true;try{
 const food_items=Array.from($('pickupFoodTypes').children).map(row=>({item_id:row.querySelector('select').value,quantity:Number(row.querySelector('input').value)}));
 const ok=await reportFood(index,'got_food',{food_items});if(ok)$('pickupDialog').close();
 }finally{$('pickupSubmit').disabled=false}};
async function refreshImpact(){try{impactPayload=await api('/api/impact');$('impactError').textContent='';renderImpact()}catch(error){$('impactError').textContent='Impact data unavailable. Please refresh.'}}
function renderImpact(){
 if(!impactPayload)return;
 const demo=!!currentUser?.is_admin&&$('showSamples').checked,entries=impactPayload.entries.filter(e=>demo||!e.sample),parts=impactPayload.today.split('-').map(Number);
 const rep=RescueImpact.report(entries,impactRange,new Date(parts[0],parts[1]-1,parts[2])),d=rep.display;
 const split=metric=>{const suffix=' '+metric.unit;return [metric.text.endsWith(suffix)?metric.text.slice(0,-suffix.length):metric.text,metric.unit]};
 $('impactHeroText').innerHTML=`We’ve kept <b>${esc(d.kg.text)}</b> of food out of the trash, avoiding about <b>${esc(d.co2e.text)} CO₂ emission</b> — like not driving <b>${esc(d.miles.text)} miles</b>.`;
 $('impactLabel').textContent=demo?'INCLUDES DEMO':'SELF-REPORTED';$('impactRange').textContent=rep.range.start+' → '+rep.range.end+' · '+rep.range.days+' days';
 const co2=split(d.co2e),mass=split(d.kg);const cards=[['Meal equivalents rescued',d.meals.text,'','≈ '+d.kg.text+' of food'],['Estimated CO₂ emission avoided',co2[0],co2[1],'From reported pickups; modeled estimate'],['Driving equivalent',d.miles.text,'miles','Tailpipe CO₂ equivalent'],['Food diverted from disposal',mass[0],mass[1],'Estimated food weight']];
 $('impactStats').innerHTML=cards.map(([label,value,unit,note])=>`<div class="impact-stat"><h3>${label}</h3><strong>${value}</strong><small>${unit}</small><p>${note}</p></div>`).join('');
 $('impactNote').textContent='Only quantified “Just get it” reports count. Registrations, portions offered and “ran out” reports do not count. Weight uses your CSV estimates; 1 meal equivalent = 0.5443 kg; CO₂ emission = food kg × '+RescueImpact.CO2E_PER_KG.toFixed(4)+'. Assumes food would otherwise be discarded. '+impactPayload.unquantified+' older pickup reports lack quantities and are excluded. '+(demo?'Sample pickup reports are included.':'Sample pickup reports are excluded.');
 if(!window.Chart){$('impactError').textContent='Charts could not load; totals remain available.';return}
 const configs=RescueImpact.chartConfigs(rep,{main:'#1f8a54',text:'#5f6f66'});
 document.querySelector('#impactDashboard .impact-chart h3').textContent='Cumulative estimated CO₂ emission avoided ('+configs.units.cumulativeCo2e+')';
 for(const [id,key] of [['co2Chart','cumulativeCo2e']]){if(impactCharts[id]){impactCharts[id].data=configs[key].data;impactCharts[id].update('none')}else impactCharts[id]=new Chart($(id),configs[key])}
}
document.querySelectorAll('[data-range]').forEach(button=>button.onclick=()=>{impactRange=button.dataset.range;document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',b===button));renderImpact()});
refreshImpact();setInterval(refreshImpact,5000);

let eventChoices=[];
$('addEvent').onclick=async()=>{
 $('eventAccessNote').textContent=currentUser?'You are signed in as '+currentUser.name+'.':'No account is required. A contact method is required so the organizer receives a private event-management link.';
 $('eventError').textContent='';$('eventModeExisting').checked=true;$('eventNameSelect').innerHTML='<option value="">Loading events…</option>';$('eventNameSelect').value='';applyEventChoice();$('eventDialog').showModal();
 try{
  await api('/api/events');const [locations,catalog]=await Promise.all([api('/api/buildings'),api('/api/event-options')]);eventChoices=catalog.events;
  $('eventBuilding').innerHTML=locations.buildings.sort((a,b)=>a.name.localeCompare(b.name)).map(b=>`<option value="${esc(b.slug)}">${esc(b.name)}</option>`).join('');
  $('eventNameSelect').innerHTML='<option value="">Choose an event</option>'+eventChoices.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}${e.sample?' · Sample':''}</option>`).join('');
 }catch(error){$('eventError').textContent='Existing events could not load. You can create a new event instead.';$('eventNameSelect').innerHTML='<option value="">Events unavailable</option>'}
};
function applyEventChoice(){
 const other=$('eventModeNew').checked,form=$('eventForm');
 $('existingEventFields').classList.toggle('hidden',other);$('eventNameSelect').disabled=other;$('eventNameSelect').required=!other;
 $('manualEventFields').classList.toggle('hidden',!other);document.querySelectorAll('#manualEventFields input,#manualEventFields select,#manualEventFields button').forEach(field=>field.disabled=!other);
 $('selectedEventInfo').classList.add('hidden');
 if(other){const date=new Date(Date.now()+3600000);form.elements.start.value=new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);form.elements.title.value='';form.elements.organizer.value='';setEventLocationType();return}
 const e=eventChoices.find(e=>e.id===$('eventNameSelect').value);if(!e)return;
 form.elements.title.value=e.title;form.elements.organizer.value=e.organizer;
 const raw=e.start,display=/^\d{8}T\d{6}$/.test(raw)?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8)+' '+raw.slice(9,11)+':'+raw.slice(11,13)+' (Ann Arbor)':raw;
 $('selectedEventInfo').innerHTML='<strong>'+esc(e.title)+'</strong><p>Organizer: '+esc(e.organizer)+'</p><p>Location: '+esc(e.location)+'</p><p>Event time: '+esc(display)+'</p>'; $('selectedEventInfo').classList.remove('hidden');
}
$('eventNameSelect').onchange=applyEventChoice;
document.querySelectorAll('[name="event_mode"]').forEach(input=>input.onchange=applyEventChoice);
$('eventCancel').onclick=()=>$('eventDialog').close();
function updateEventContact(){
 const sms=$('eventContactChannel').value==='sms';
 $('eventEmailFields').classList.toggle('hidden',sms);$('eventSmsFields').classList.toggle('hidden',!sms);
 $('eventForm').elements.contact_email.disabled=sms;
 $('eventForm').elements.contact_email.required=!sms;
 $('eventForm').elements.contact_phone.disabled=!sms;
 $('eventForm').elements.contact_phone.required=sms;
}
$('eventContactChannel').onchange=updateEventContact;
function addEventFoodRow(){
 const container=$('eventFoodTypes');if(container.children.length>=RescueImpact.ITEMS.length)return;
 container.insertAdjacentHTML('beforeend',`<div class="event-food-row"><select data-food-type required aria-label="Food or drink type"><option value="">Choose a type</option>${RescueImpact.ITEMS.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select><div class="event-food-amount"><input type="number" data-food-quantity required min="1" max="10000" step="1" placeholder="Qty" aria-label="Quantity remaining"><span class="event-food-unit">Unit</span></div><button type="button" class="food-remove-row" aria-label="Remove food type">×</button></div>`);
 updateEventFoodUnit();
}
function updateEventFoodUnit(){
 const rows=Array.from(document.querySelectorAll('#eventFoodTypes .event-food-row'));
 const selected=rows.map(row=>row.querySelector('[data-food-type]').value).filter(Boolean);
 rows.forEach((row,index)=>{
  const select=row.querySelector('[data-food-type]'),item=RescueImpact.ITEMS.find(item=>item.id===select.value);
  row.querySelector('.event-food-unit').textContent=item?item.unit:'Unit';
  select.setAttribute('aria-label','Food or drink type '+(index+1));
  row.querySelector('[data-food-quantity]').setAttribute('aria-label','Quantity remaining '+(index+1)+(item?' ('+item.unit+')':''));
  Array.from(select.options).forEach(option=>option.disabled=!!option.value&&option.value!==select.value&&selected.includes(option.value));
  row.querySelector('.food-remove-row').disabled=rows.length===1;
 });
 $('addAnotherFood').disabled=rows.length>=RescueImpact.ITEMS.length;
 $('eventFoodSelectionError').textContent='';
}
function resetEventFoods(){$('eventFoodTypes').innerHTML='';addEventFoodRow()}
$('eventFoodTypes').onchange=updateEventFoodUnit;
$('eventFoodTypes').addEventListener('invalid',()=>{$('eventFoodSelectionError').textContent='Choose a food or drink type and enter its quantity for every row.'},true);
$('eventFoodTypes').onclick=event=>{const button=event.target.closest('.food-remove-row');if(button&&!button.disabled){button.closest('.event-food-row').remove();updateEventFoodUnit()}};
$('addAnotherFood').onclick=()=>{addEventFoodRow();$('eventFoodTypes').lastElementChild.querySelector('select').focus()};
function selectedEventFoods(){return Array.from(document.querySelectorAll('#eventFoodTypes .event-food-row')).map(row=>({item_id:row.querySelector('[data-food-type]').value,quantity:row.querySelector('[data-food-quantity]').value}))}
function readEventPhoto(file){
 if(!file)throw Error('Upload an event photo.');
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Event photo must be JPG, PNG or WebP.');
 if(file.size>3*1024*1024)throw Error('Event photo must be 3 MB or smaller.');
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('The event photo could not be read.'));reader.readAsDataURL(file)});
}
$('eventPhoto').onchange=event=>{const file=event.target.files[0];if(!file){$('eventPhotoPreview').classList.add('hidden');return}if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3*1024*1024){$('eventError').textContent='Choose a JPG, PNG or WebP photo no larger than 3 MB.';event.target.value='';$('eventPhotoPreview').classList.add('hidden');return}const reader=new FileReader();reader.onload=()=>{$('eventPhotoPreview').src=reader.result;$('eventPhotoPreview').classList.remove('hidden')};reader.readAsDataURL(file)};
resetEventFoods();
$('eventForm').onsubmit=async event=>{
 event.preventDefault();$('eventSubmit').disabled=true;
 try{const body=Object.fromEntries(new FormData(event.target));body.image_data=await readEventPhoto($('eventPhoto').files[0]);delete body.event_photo;body.food_items=selectedEventFoods();if(!body.food_items.length||body.food_items.some(food=>!food.item_id||!Number.isInteger(Number(food.quantity))||Number(food.quantity)<1||Number(food.quantity)>10000)){const message='Select at least one food or drink type and enter its quantity (a whole number from 1 to 10,000). Complete every added row.';$('eventFoodSelectionError').textContent=message;throw Error(message)}if(!$('eventModeNew').checked){body.source_event_id=$('eventNameSelect').value;const selected=eventChoices.find(e=>e.id===body.source_event_id);if(!selected)throw Error('Choose an existing event or select Create a new event.');body.start=new Date().toISOString();body.title=selected.title;body.organizer=selected.organizer;}if(body.location_type==='offcampus'){if(!chosenPlace)throw Error('Find and select your event location first.');body.place_id=chosenPlace.id}body.start=new Date(body.start).toISOString();if(body.deadline)body.deadline=new Date(body.deadline).toISOString();const result=await api('/api/user-events',body);$('eventDialog').close();event.target.reset();$('eventPhotoPreview').classList.add('hidden');updateEventContact();resetEventFoods();chosenPlace=null;setEventLocationType();tab('food');await refresh();showToast('Event added successfully',eventNotificationMessage(result),!['sent','no_email'].includes(result.notification_status||result.email_status))}
 catch(error){$('eventError').textContent=error.message}
 finally{$('eventSubmit').disabled=false}
};

let placeResults=[],chosenPlace=null,eventLocationMap,eventLocationMarker;
function setEventLocationType(){
 const outside=$('eventLocationType').value==='offcampus';$('campusLocationFields').classList.toggle('hidden',outside);$('offcampusLocationFields').classList.toggle('hidden',!outside);$('eventBuilding').required=!outside;
 const manual=$('eventModeNew').checked;
 $('eventBuilding').disabled=!manual||outside;
 for(const id of ['offcampusQuery','offcampusResults']){$(id).disabled=!manual||!outside;$(id).required=manual&&outside}
 $('findPlace').disabled=!manual||!outside;
 if(outside&&window.L){if(!eventLocationMap){eventLocationMap=L.map('eventLocationMap').setView([42.2808,-83.7382],13);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(eventLocationMap)}requestAnimationFrame(()=>eventLocationMap.invalidateSize())}
}
$('eventLocationType').onchange=setEventLocationType;
$('offcampusQuery').oninput=()=>{chosenPlace=null;placeResults=[];$('offcampusResults').innerHTML='<option value="">Search again to choose a location</option>';if(eventLocationMarker){eventLocationMarker.remove();eventLocationMarker=null}};
$('findPlace').onclick=async()=>{
 const query=$('offcampusQuery').value.trim();chosenPlace=null;$('findPlace').disabled=true;$('placeSearchStatus').textContent='Searching…';
 try{const data=await api('/api/geocode',{query});if(query!==$('offcampusQuery').value.trim())return;placeResults=data.places;$('offcampusResults').innerHTML='<option value="">Select the correct location</option>'+placeResults.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');$('placeSearchStatus').textContent=placeResults.length?'Select a result and confirm the map location.':'No results. Try a full address including the city.'}
 catch(error){$('placeSearchStatus').textContent=error.message}
 finally{$('findPlace').disabled=false}
};
$('offcampusResults').onchange=()=>{chosenPlace=placeResults.find(p=>p.id===$('offcampusResults').value)||null;if(eventLocationMarker){eventLocationMarker.remove();eventLocationMarker=null}if(chosenPlace&&eventLocationMap){eventLocationMap.setView([chosenPlace.lat,chosenPlace.lng],16);eventLocationMarker=L.marker([chosenPlace.lat,chosenPlace.lng]).addTo(eventLocationMap).bindPopup(esc(chosenPlace.label)).openPopup();$('placeSearchStatus').textContent='Location selected: '+chosenPlace.label}};


function eventNotificationMessage(result){
 const channel=result.notification_channel==='sms'?'SMS':'Email';
 const status=result.notification_status||result.email_status;
 if(status==='sent')return 'Event added. Your private event-management link was accepted for delivery by the '+channel+' provider.';
 if(status==='failed')return 'Event added, but '+channel+' sending failed. The private management link was not sent.';
 if(status==='no_email')return 'Event added. No contact was provided, so no private management link was sent.';
 return 'Event added. '+channel+' is pending service configuration. The private management link has not been sent.';
}
async function handleOrganizerSearch(){
 organizerSearchVersion++;organizerSearchActive=false;organizerEvent=null;organizerSearchKey='';organizerSearchError='';renderEventsOnHome();
}

async function initializeOrganizerClaim(){
 if(!organizerClaimToken)return;
 history.replaceState({},'',location.pathname+location.hash);
 organizerSearchActive=true;organizerSearchError='Opening your private event management page…';renderOrganizerEvent();
 try{
  const result=await api('/api/organizer-key-claim',{claim_token:organizerClaimToken});
  claimedOrganizerKey=result.organizer_key;organizerSearchKey=result.organizer_key;
  const eventResult=await api('/api/organizer-event',{organizer_key:organizerSearchKey});organizerEvent=eventResult.event;organizerSearchError='';tab('food');renderOrganizerEvent();
 }catch(error){organizerSearchError=error.message;renderOrganizerEvent()}
}
initializeOrganizerClaim();
function renderOrganizerEvent(){
 markers?.clearLayers();eventMarkers.clear();for(const pin of googlePins)pin.setMap(null);googlePins=[];
 $('pickupCount').textContent='Organizer view';
 if(!organizerEvent){$('list').innerHTML='<article class="card empty"><p role="status">'+esc(organizerSearchError)+'</p></article>';return}
 const e=organizerEvent;
 $('list').innerHTML=`<article class="card empty"><span class="badge">Private event management</span><h3>${esc(e.title)}</h3><p>${esc(e.location)}</p><p>Status: ${e.status?'Active':'False · Food has run out / event closed'}</p><button id="organizerGone" ${e.status?'':'disabled'}>${e.status?'Food has run out':'Event closed'}</button><p class="muted">This private link manages only this event.</p><p id="organizerUpdateMessage" role="status"></p></article>`;
 if(map&&e.lat!=null){L.marker([e.lat,e.lng]).addTo(markers).bindPopup(esc(e.title));map.setView([e.lat,e.lng],16)}
 $('organizerGone').onclick=async()=>{const key=organizerSearchKey,version=organizerSearchVersion;$('organizerGone').disabled=true;try{const result=await api('/api/organizer-close',{organizer_key:key});if(version!==organizerSearchVersion)return;organizerEvent=result.event;renderOrganizerEvent();$('organizerUpdateMessage').textContent='Updated: status is False. This event is no longer publicly listed.'}catch(error){if(version===organizerSearchVersion){$('organizerUpdateMessage').textContent=error.message;$('organizerGone').disabled=false}}};
}

let personalImpactRange='all';const personalImpactCharts={};
function renderPersonalImpact(){
 if(!treeData?.impact||!currentUser)return;
 const data=treeData.impact,demo=!!currentUser?.is_admin&&$('showSamples').checked;
 const entries=data.entries.filter(e=>demo||!e.sample),community=data.community_entries.filter(e=>demo||!e.sample);
 const [y,m,d]=data.today.split('-').map(Number);
 const rep=RescueImpact.personalReport(entries,personalImpactRange,new Date(y,m-1,d),RescueImpact.summarize(community));
 const dpy=rep.display,split=metric=>{const suffix=' '+metric.unit;return [metric.text.endsWith(suffix)?metric.text.slice(0,-suffix.length):metric.text,metric.unit]};
 $('personalImpactRange').textContent=rep.range.start+' → '+rep.range.end+(demo?' · Includes demo reports':' · Your reported pickups');
 const co2=split(dpy.co2e),mass=split(dpy.kg);const cards=[['Meal equivalents rescued',dpy.meals.text,'','≈ '+dpy.kg.text+' of food'],['Estimated CO₂ emission avoided',co2[0],co2[1],'Modeled estimate'],['Driving equivalent',dpy.miles.text,'miles','Tailpipe CO₂ equivalent'],['Food diverted from disposal',mass[0],mass[1],'Estimated food weight']];
 $('personalImpactStats').innerHTML=cards.map(([label,value,unit,note])=>`<div class="impact-stat"><h3>${esc(label)}</h3><strong>${esc(value)}</strong><small>${esc(unit)}</small><p>${esc(note)}</p></div>`).join('');
 $('personalRecentPickups').innerHTML=rep.recent.length?rep.recent.map(e=>`<div class="history-row"><strong>${esc(e.name)}</strong> · ${e.qty} ${esc(e.unit)}<br><span class="muted">${esc(e.date)} · ${esc(e.display.kg.text)} food · ${esc(e.display.co2e.text)} estimated CO₂ emission</span></div>`).join(''):'<p class="muted">No quantified pickups yet. Register for an event, then report what you collected with Just get it.</p>';
 $('personalImpactError').textContent='';
 if(!window.Chart){$('personalImpactError').textContent='Charts could not load; your totals remain available.';return}
 const configs=RescueImpact.chartConfigs(rep,{main:'#1f8a54',text:'#5f6f66'});
 document.querySelector('#personalImpact .impact-chart h3').textContent='Cumulative estimated CO₂ emission avoided ('+configs.units.cumulativeCo2e+')';
 for(const [id,key] of [['personalCo2Chart','cumulativeCo2e']]){if(personalImpactCharts[id]){personalImpactCharts[id].data=configs[key].data;personalImpactCharts[id].update('none')}else personalImpactCharts[id]=new Chart($(id),configs[key])}
}
document.querySelectorAll('[data-personal-range]').forEach(button=>button.onclick=()=>{personalImpactRange=button.dataset.personalRange;document.querySelectorAll('[data-personal-range]').forEach(b=>b.classList.toggle('active',b===button));renderPersonalImpact()});


$('treeAboutButton').onclick=()=>$('treeAboutDialog').showModal();
$('treeAboutClose').onclick=()=>$('treeAboutDialog').close();

function updateSignupSms(){
 const enabled=authMode==='register'&&$('signupSmsOptIn').checked;
 $('signupPhoneFields').classList.toggle('hidden',!enabled);$('signupSmsPhone').disabled=!enabled;$('signupSmsPhone').required=enabled;
}
$('signupSmsOptIn').onchange=updateSignupSms;
$('smsUnsubscribe').onclick=async()=>{try{await api('/api/sms/unsubscribe',{});currentUser.sms_opt_in=0;$('smsSubscriptionInfo').classList.add('hidden');$('status').textContent='Free food SMS alerts turned off.'}catch(error){$('status').textContent=error.message}};

document.addEventListener('click',event=>{const menu=$('foodFilterMenu');if(menu.open&&!menu.contains(event.target))menu.open=false});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('foodFilterMenu').open){$('foodFilterMenu').open=false;document.querySelector('#foodFilterMenu summary').focus()}});

let userLocationWatch=null,userLocationMarker=null,userLocationCircle=null,userLocationLast=null,userLocationGeneration=0;
function clearUserLocation(){
 userLocationGeneration++;
 if(userLocationWatch!==null){navigator.geolocation.clearWatch(userLocationWatch);userLocationWatch=null}
 if(userLocationMarker){userLocationMarker.remove();userLocationMarker=null}
 if(userLocationCircle){userLocationCircle.remove();userLocationCircle=null}
 userLocationLast=null;$('stopLocation').classList.add('hidden');$('locateMe').disabled=false;
}
function showUserLocation(position,center){
 const {latitude,longitude,accuracy}=position.coords;
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){throw new Error('Invalid location coordinates')}
 userLocationLast=[latitude,longitude];
 const text='Your location: '+latitude.toFixed(5)+', '+longitude.toFixed(5)+' · Accuracy ±'+Math.round(accuracy)+' m';
 if(!userLocationMarker){userLocationMarker=L.circleMarker(userLocationLast,{radius:8,color:'white',weight:3,fillColor:'#2878dc',fillOpacity:1}).addTo(map)}else userLocationMarker.setLatLng(userLocationLast);
 userLocationMarker.bindPopup('<strong>Your current location</strong><p>'+esc(text)+'</p>').bringToFront();
 if(Number.isFinite(accuracy)&&accuracy>0){
  if(!userLocationCircle)userLocationCircle=L.circle(userLocationLast,{radius:accuracy,color:'#2878dc',weight:1,fillColor:'#2878dc',fillOpacity:.08,interactive:false}).addTo(map);
  else userLocationCircle.setLatLng(userLocationLast).setRadius(accuracy);
 }
 if(center){mapFramed=true;map.invalidateSize();map.setView(userLocationLast,Math.max(map.getZoom(),15));userLocationMarker.openPopup()}
 $('userLocationStatus').textContent=text;$('userLocationStatus').classList.remove('hidden');$('stopLocation').classList.remove('hidden');$('locateMe').disabled=false;
}
function locationError(error,generation){
 if(generation!==userLocationGeneration)return;
 clearUserLocation();
 const messages={1:'Location access was denied. Allow location in your browser and device settings, then try again.',2:'Your device could not determine your location. Permission was granted, but no coordinates were received. Check device location services and try again.',3:'Your device did not return a location within 30 seconds. Check device location services and try My location again.'};
 $('userLocationStatus').textContent=messages[error.code]||'Unable to determine your location. Please try again.';
 $('userLocationStatus').classList.remove('hidden');
}
$('locateMe').onclick=()=>{
 $('userLocationStatus').classList.remove('hidden');
 if(!map){$('userLocationStatus').textContent='The map is unavailable. Please refresh and try again.';return}
 if(!navigator.geolocation||!window.isSecureContext){$('userLocationStatus').textContent='Location requires a supported browser and HTTPS (or localhost).';return}
 if(userLocationLast){map.invalidateSize();mapFramed=true;map.setView(userLocationLast,Math.max(map.getZoom(),15));userLocationMarker.openPopup();return}
 clearUserLocation();const generation=userLocationGeneration;
 $('userLocationStatus').textContent='Finding your location… This may take up to 30 seconds after allowing access.';$('locateMe').disabled=true;
 $('stopLocation').classList.remove('hidden');
 navigator.geolocation.getCurrentPosition(position=>{
  if(generation!==userLocationGeneration)return;
  try{showUserLocation(position,true)}catch(e){locationError({code:2},generation);return}
  userLocationWatch=navigator.geolocation.watchPosition(next=>{
   if(generation!==userLocationGeneration)return;
   try{showUserLocation(next,false)}catch(e){locationError({code:2},generation)}
  },error=>{
   if(generation!==userLocationGeneration)return;
   if(error.code===1){locationError(error,generation);return}
   $('userLocationStatus').textContent='Showing your last known location. Live location updates are currently unavailable.';
  },{enableHighAccuracy:false,timeout:30000,maximumAge:10000});
 },error=>locationError(error,generation),{enableHighAccuracy:false,timeout:30000,maximumAge:0});
};
$('stopLocation').onclick=()=>{clearUserLocation();$('userLocationStatus').textContent='Location display stopped.'};
window.addEventListener('pagehide',()=>{if(userLocationWatch!==null)navigator.geolocation.clearWatch(userLocationWatch)});
