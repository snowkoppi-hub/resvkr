(function(){
var OFF = {};               // { 'YYYY-MM-DD': { 'Add-on title': 1 } } add-ons switched off on that date (Availability by Date sheet)
var SPECIAL = [];           // rows of the Special Prices sheet: {from,to,pkg,price,add,label}
var PUSED = {};             // { 'YYYY-MM-DD': { 'Package title': how many are already taken that day } }
var USED = {};              // { 'YYYY-MM-DD': { 'Add-on title': how many are already taken that day } }, loaded from the Google Sheet
var DAYS = {};              // { 'YYYY-MM-DD': { 'Package title' or '*': 'booked'|'hold'|'unavailable' } }, loaded from the Google Sheet
var daysState = 'loading';  // loading | ok | failed
var today = new Date(); today.setHours(0,0,0,0);
var sel = {pkg:null,date:null,name:'',phone:'',street:'',city:'',brgy:'',time:'8:00 AM',hours:'22',delivery:true,notes:'',website:'',events:[],addons:{},landmark:'',pay:'',loc:null,locSkip:false};
var errors = {};
var sending = false, sentOk = false;
var SENT = null;   // snapshot of the request that was just sent (kept on the device so the "Request sent" page survives a reload)
var SENT_KEY = 'arSent';
function readSent(){ try{ var s=JSON.parse(localStorage.getItem(SENT_KEY)||'null'); return (s&&s.date&&s.name&&(Date.now()-(s.t||0))<12*3600*1000)?s:null; }catch(e){ return null; } }
function saveSent(s){ try{ if(s) localStorage.setItem(SENT_KEY,JSON.stringify(s)); else localStorage.removeItem(SENT_KEY); }catch(e){} }
var view = new Date(today.getFullYear(), today.getMonth(), 1);
var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DOW=['Su','Mo','Tu','We','Th','Fr','Sa'];

function h(tag, props){
  var e=document.createElement(tag); props=props||{};
  Object.keys(props).forEach(function(k){
    var v=props[k];
    if(k==='class') e.className=v;
    else if(k.slice(0,2)==='on') e.addEventListener(k.slice(2),v);
    else if(v===true) e.setAttribute(k,'');
    else if(v!==false && v!=null) e.setAttribute(k,v);
  });
  for(var i=2;i<arguments.length;i++){
    [].concat(arguments[i]).forEach(function(c){
      if(c==null||c===false) return;
      e.append(c.nodeType?c:document.createTextNode(c));
    });
  }
  return e;
}
function key(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function fromKey(k){var p=k.split('-');return new Date(+p[0],+p[1]-1,+p[2])}
function longDate(k){return fromKey(k).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
function stateFor(k,t){   // status of a date for one package ('' = open)
  var o=DAYS[k]; if(!o) return ''; if(o['*']) return o['*'];
  t=t||(pkgById(sel.pkg)||{}).title; return t?(o[t]||''):'';
}
function num(s){return parseInt(String(s||'').replace(/[^\d]/g,''),10)||0}
function peso(n){return '₱'+Number(n).toLocaleString('en-PH')}
function capOf(x){var q=parseInt(x.qty,10); return isNaN(q)||q<1?1:Math.min(q,50)}   // total stock typed in the Add-ons sheet
function usedOn(x){var u=sel.date&&USED[sel.date]; return (u&&u[x.title])||0}          // already booked on the chosen date
function isOff(x){var o=sel.date&&OFF[sel.date]; return !!(o&&o[x.title])}              // switched off on the chosen date
function maxQty(x){return isOff(x)?0:Math.max(0,capOf(x)-usedOn(x))}                              // what is still left on the chosen date
function qtyOf(x){return Math.min(sel.addons[x.id]||0,maxQty(x))}
function chosenAddons(){   // add-ons with a quantity above 0; each copy carries q (how many)
  return (CONFIG.addons||[]).filter(function(x){return x.available&&qtyOf(x)>0}).map(function(x){var o={};for(var k in x)o[k]=x[k];o.q=qtyOf(x);return o});
}
function addonLabel(x){return x.title+(x.q>1?' x'+x.q:'')}
function specialFor(p,k){   // Special Prices sheet: a different price on certain dates (null = normal price)
  var best=null, bs=-1, base=num(p.price);
  SPECIAL.forEach(function(r){
    if(k<r.from||k>r.to) return; if(r.pkg&&r.pkg!==p.title) return;
    var sc=r.pkg?1:0; if(sc>=bs){best=r;bs=sc}
  });
  if(!best) return null;
  return {price:best.price!=null?best.price:Math.max(0,base+(best.add||0)),label:best.label||'Special rate'};
}
function priceOf(p){var s=sel.date&&specialFor(p,sel.date); return s?s.price:num(p.price)}
function priceTag(p){var s=sel.date&&specialFor(p,sel.date); return s?s.label:'promo price'}
/* booking window (Settings sheet): earliest and latest date customers can pick */
function addDays(d,n){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n)}
function winMin(){var v=parseInt(cfg('minDays','0'),10); return isNaN(v)||v<0?0:v}
function winMax(){var v=parseInt(cfg('maxDays',''),10); return isNaN(v)||v<0?null:v}
function openFrom(){return addDays(today,winMin())}
function openTo(){var m=winMax(); return m==null?null:addDays(today,m)}
function inWindow(dt){var t=openTo(); return dt>=openFrom()&&(!t||dt<=t)}
function deliveryMode(){ var m=cfg('deliveryMode','').toLowerCase(); return /pick/.test(m)?'pickup':(/only/.test(m)?'delivery':'choose') }   // Settings sheet: Delivery option
function wantsDelivery(){ var m=deliveryMode(); return m==='pickup'?false:m==='delivery'?true:sel.delivery }
function feeOf(){ var f=(LOCFEE[sel.city]||{})[sel.brgy]; return (f==null||f==='')?null:(Number(f)||0) }   // Locations sheet: Delivery fee (null = none listed)
function deliveryFee(){ return wantsDelivery()?(feeOf()||0):0 }
function totalFee(){var p=pkgById(sel.pkg);return (p?priceOf(p):0)+chosenAddons().reduce(function(s,x){return s+num(x.price)*x.q},0)+deliveryFee()}
function fmtPhone(v){
  var d=String(v).replace(/\D/g,''); if(d.length>11&&d.indexOf('63')===0) d='0'+d.slice(2);
  d=d.slice(0,11); return [d.slice(0,4),d.slice(4,7),d.slice(7,11)].filter(Boolean).join(' ');
}
function slug(t){return String(t).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function imgSrc(u,w){
  u=String(u).trim();
  var m=u.match(/drive\.google\.com\/file\/d\/([\w-]+)/)||u.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  return m?'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w'+(w||1000):u;
}
function availPkgs(){return CONFIG.packages.filter(function(p){return p.available!==false})}
function pcap(p){var q=parseInt(p.qty,10); return isNaN(q)||q<1?1:Math.min(q,50)}   // how many of this package can be booked on one date
function pseats(p,k){var u=PUSED[k]; return Math.max(0,pcap(p)-((u&&u[p.title])||0))}
function leftFor(k){var o=DAYS[k]||{}; if(o['*']) return 0; return availPkgs().filter(function(p){return !o[p.title]}).length}
function pkgById(id){return CONFIG.packages.filter(function(p){return p.id===id})[0]}
function messengerName(){
  if(!flag('showMessenger')) return '';
  var m=cfg('messenger',CONFIG.messenger).replace(/[?#].*$/,'').replace(/\/+$/,'');
  return m.split('/').pop().replace(/^@/,'');
}
function phoneOk(v){
  var d=String(v).replace(/\D/g,'');
  return /^09\d{9}$/.test(d);   // 11 digits, like 0995 252 5426
}

/* ---------- skeleton ---------- */
var app=document.getElementById('app');
var pkgBox=h('div',{class:'pkgs',role:'radiogroup','aria-label':'Package'});
var pkgErr=h('p',{class:'err',id:'e-pkg',role:'alert'});
var calBox=h('div',{id:'cal'});
var calErr=h('p',{class:'err',id:'e-date',role:'alert'});
var formBox=h('div',{id:'formbox'});
var addonBox=h('div',{});

// The header text and background image can be changed by the owner in the "Settings" sheet of the Google Sheet.
// Built-in text, used ONLY when the Google Sheet has no Settings sheet (or has no row for a setting).
// Once your Settings sheet exists, the text comes from the sheet only: a blank cell hides that line.
var FALLBACK={pausedMsg:'Online booking is paused right now. Please message us to book.',eyebrow:'Reserve Now',title:CONFIG.name,subtitle:'Videoke sets for birthdays, debuts, reunions and fiestas. Pick a package and date, then send your request.',
  step1:'Pick a package',step1note:'All prices shown are promo prices.',addonsTitle:'Add-ons',addonsNote:'Tick the add-ons you want, then choose how many. It is included in your total rental fee.',
  step2:'Pick a date',calNote:'Each date shows how many packages are left. Pick a package above to check yours.',step3:'Your details and request',reqTitle:'Your request',
  sendBtn:'Send booking request',locNote:'By sending this request, you allow your location to be shared with {name}.',
  payTitle:'Choose your payment',gcashTitle:'Pay with GCash',gcashNote:'Already confirmed? Pay here. The reservation fee is included in your total rental fee.',
  gcashHint:'Open GCash, tap Send Money, and enter your payment amount.',remTitle:'Reminder',
  footer:'Your date is not reserved until we reply and confirm.',doneTitle:'Request sent!',
  doneMsg:'Thank you, {customer}. We will contact you at {phone} to confirm your date for {date}.',
  doneNote:'Your date is not reserved until we reply and confirm.'};
(function(){ var r=CONFIG.rules||{};
  FALLBACK.rem1='The reservation fee is included in your total rental fee. It is not an extra charge.';
  FALLBACK.rem2='A '+peso(r.deposit)+' security deposit is collected upon delivery. It is refundable upon pick up, as long as there is no damage and no missing equipment.';
  FALLBACK.rem3='Delivery is free within '+r.freeKm+' km. Beyond '+r.freeKm+' km, it is '+peso(r.perKm)+' for every additional kilometer.';
})();
var ST={}, HAVE=false;   // text from the Settings sheet. Blank cell = hidden, a single - = hidden too.
// Remember the last Settings text on this device, so the page shows it right away on the next visit.
try{ var _c=JSON.parse(localStorage.getItem('arSettings')||'null'); if(_c&&typeof _c==='object'){ ST=_c; HAVE=true; } }catch(e){}
function tx(k){
  if(!HAVE||!(k in ST)) return FALLBACK[k]||'';
  var v=String(ST[k]==null?'':ST[k]).trim(); return v==='-'?'':v;
}
// cfg: a value (like a phone number) from the Settings sheet; config.js is used only until the sheet has that row.
function cfg(k,fb){
  if(HAVE&&(k in ST)){ var v=String(ST[k]==null?'':ST[k]).trim(); return v==='-'?'':v; }
  return fb==null?'':String(fb);
}
// flag: an on/off switch from the Settings sheet. Only No / Off / Hide / False / 0 turn it off.
function flag(k){
  if(!HAVE||!(k in ST)) return true;
  var v=String(ST[k]==null?'':ST[k]).trim().toLowerCase();
  return !(v==='no'||v==='off'||v==='hide'||v==='false'||v==='0');
}
var heroEl=h('header',{class:'hero'}), eyebrowEl=h('p',{class:'eyebrow'},FALLBACK.eyebrow), titleEl=h('h1',{},CONFIG.name), subEl=h('p',{},FALLBACK.subtitle);
// Facebook page the logo opens. Uses CONFIG.facebook (full link or page name) if set, otherwise the Messenger page id/name.
function fbUrl(){
  var f=String(cfg('facebook',CONFIG.facebook)||cfg('messenger',CONFIG.messenger)||'').trim().replace(/[?#].*$/,'').replace(/\/+$/,'');
  if(!f) return '';
  if(/^https?:\/\//i.test(f)) return f;
  return 'https://www.facebook.com/'+f.split('/').pop().replace(/^@/,'');
}
var logoLink=h('a',{href:'#',target:'_blank',rel:'noopener',title:CONFIG.name+' on Facebook',style:'display:contents'},h('img',{class:'logo',src:CONFIG.logo||'',alt:CONFIG.name+' logo'}));   // the logo opens your Facebook page (Settings > Facebook page link)
heroEl.append(h('div',{class:'hero-in'},CONFIG.logo?logoLink:null,h('div',{},eyebrowEl,titleEl,subEl)));
var step1T=h('span',{},FALLBACK.step1), step1N=h('p',{class:'promo-note'},FALLBACK.step1note), step2T=h('span',{},FALLBACK.step2), step3T=h('span',{},FALLBACK.step3);
var footEl=h('p',{class:'foot'},FALLBACK.footer), remWrap=h('div',{class:'rem-wrap'}), payWrap=h('div',{});
var callEl=h('p',{class:'hint'}), pausedEl=h('p',{class:'note',role:'status'});
function applyText(s){
  if(s){ ST=s; HAVE=true; try{ localStorage.setItem('arSettings',JSON.stringify(s)); }catch(e){} }
  eyebrowEl.textContent=tx('eyebrow');
  var t=tx('title')||CONFIG.name; titleEl.textContent=t; document.title=t+' Booking';
  subEl.textContent=tx('subtitle');
  step1T.textContent=tx('step1'); step1N.textContent=tx('step1note'); step1N.hidden=!tx('step1note');
  payTitleT.textContent=tx('payTitle')||FALLBACK.payTitle; step2T.textContent=tx('step2'); step3T.textContent=tx('step3');
  footEl.textContent=tx('footer'); footEl.hidden=!tx('footer');
  reqTitleEl.textContent=tx('reqTitle'); locNoteEl.textContent=tx('locNote').replace('{name}',CONFIG.name); locNoteEl.hidden=!tx('locNote');
  lblTimeT.textContent=cfg('lblTime','')||'Start time'; lblHoursT.textContent=cfg('lblHours','')||'Hours needed';
  delLblT.textContent=cfg('lblDelivery','')||'I need delivery and setup'; delLabel.hidden=deliveryMode()!=='choose';
  fNotes.placeholder=cfg('notesHint','Number of guests, anything we should know');
  logoLink.href=fbUrl()||'#'; logoLink.hidden=!fbUrl();
  if(!sending) submitBtn.textContent=tx('sendBtn');
  var acc=flag('acceptRequests');   // Settings sheet: Accept booking requests = No pauses the Send button
  if(!sending) submitBtn.disabled=!acc;
  pausedEl.textContent=tx('pausedMsg'); pausedEl.hidden=acc;
  var ph=flag('showCall')?cfg('phone',CONFIG.phone):'';
  callEl.replaceChildren(); if(ph) callEl.append('You can also call or text: ',h('a',{class:'tel',href:'tel:+'+intl(ph)},ph)); callEl.hidden=!ph;
  var img=String(ST.image||'').trim(), col=String(ST.color||'').trim();
  heroEl.style.backgroundColor=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(col)?col:'';
  if(img){
    var d=parseInt(ST.dark,10); if(isNaN(d)) d=55; d=Math.min(90,Math.max(0,d));
    var a=(d/100).toFixed(2);   // a dark shade keeps the white text readable on any photo
    heroEl.style.backgroundImage='linear-gradient(rgba(10,8,30,'+a+'),rgba(10,8,30,'+a+')),url("'+imgSrc(img,2000).replace(/"/g,'%22')+'")';
    heroEl.style.backgroundSize='cover'; heroEl.style.backgroundPosition='center';
  } else {
    heroEl.style.backgroundImage=''; heroEl.style.backgroundSize=''; heroEl.style.backgroundPosition='';
  }
}
app.append(
  heroEl,
  h('main',{},
    h('section',{class:'step'},h('h2',{},h('span',{class:'num'},'1'),step1T),step1N,pkgBox,pkgErr,addonBox),
    h('section',{class:'step'},h('h2',{},h('span',{class:'num'},'2'),step2T),calBox,calErr),
    h('section',{class:'step'},h('h2',{},h('span',{class:'num'},'3'),step3T),formBox),
    payWrap,
    remWrap,
    footEl)
);
document.title = CONFIG.name + ' Booking';

/* ---------- packages ---------- */
function seatText(p){
  if(p.available===false) return '';
  if(sel.date){ var st=stateFor(sel.date,p.title); if(st) return (st==='unavailable'?'Not available on ':st==='hold'?'On hold on ':'Fully booked on ')+shortDate(sel.date); var n=pseats(p,sel.date); return n+(n===1?' set':' sets')+' available on '+shortDate(sel.date); }
  return pcap(p)>1?'Up to '+pcap(p)+' sets available per date':'';
}
function renderPkgs(){
  pkgBox.replaceChildren.apply(pkgBox, CONFIG.packages.map(function(p){
    var on = sel.pkg===p.id, tk = sel.date?stateFor(sel.date,p.title):'', off = p.available===false || !!tk;   // taken or set to No on the chosen date: gray and not selectable
    return h('button',{type:'button',class:'pkg'+(off?' off':''),disabled:off,role:'radio','aria-checked':on?'true':'false',onclick:function(){
      sel.pkg=p.id; pkgErr.textContent=''; renderPkgs();
      var bad=sel.date?stateFor(sel.date):''; var was=sel.date; if(bad) sel.date=null;
      renderCal(); renderSummary(); if(bad) showTaken(was,bad);
    }},
      h('div',{class:'pkg-row'},
        h('div',{class:'pkg-img'},pkgImg(p)),
        h('div',{class:'pkg-main'},
          h('div',{class:'pkg-top'},
            h('span',{class:'pkg-title'},p.title),
            p.available===false?h('span',{class:'soon'},'Not available'):(tk?h('span',{class:'soon'},({hold:'On hold',booked:'Booked',unavailable:'Not available'})[tk]||'Not available'):null),
            (function(){var s=sel.date&&specialFor(p,sel.date);
              return s?h('span',{class:'pkg-price'},h('span',{class:'promo sp'},s.label),peso(s.price)+' ',h('small',{},(p.note?p.note+' · ':'')+'rate for '+shortDate(sel.date)))
                      :h('span',{class:'pkg-price'},h('span',{class:'promo'},'Promo'),p.regular?h('s',{},'₱'+p.regular):null,'₱'+p.price+' ',h('small',{},p.note||''))})()),
          seatText(p)?h('p',{class:'seats'},seatText(p)):null,
          h('ul',{},(p.items||[]).map(function(i){return h('li',{},i)})))));
  }));
}
var IMGS={};   // image elements are kept and reused, so a silent refresh never makes pictures blink
function pkgImg(p){
  var src=imgSrc(p.image||'images/'+slug(p.title)+'.jpg'), k=p.title+'|'+src;
  if(!IMGS[k]) IMGS[k]=h('img',{src:src,alt:p.title,decoding:'async',onerror:function(e){var t=document.createTextNode(p.icon||'🎤'); e.target.replaceWith(t); IMGS[k]=t}});
  return IMGS[k];
}
var addonDate='';
function renderAddons(){
  addonDate=sel.date||'';
  if(!(CONFIG.addons||[]).length){addonBox.replaceChildren();return}
  var rows=(CONFIG.addons||[]).map(function(x){
    var max=maxQty(x), ok=x.available&&max>0;
    if(sel.addons[x.id]){ if(!ok) delete sel.addons[x.id]; else if(sel.addons[x.id]>max) sel.addons[x.id]=max; }   // stock dropped: keep the choice valid
    var cur=ok?qtyOf(x):0, opts=[];
    for(var i=1;i<=Math.max(1,max);i++) opts.push(h('option',{value:String(i),selected:i===(cur||1)},String(i)));
    var pick=h('select',{id:'q-'+x.id,'aria-label':'How many '+x.title,disabled:!(ok&&cur>0)},opts);
    pick.addEventListener('change',function(){ sel.addons[x.id]=parseInt(pick.value,10)||1; renderSummary(); });
    var box=h('input',{type:'checkbox',id:'ad-'+x.id,'aria-label':'Add '+x.title,disabled:!ok,checked:cur>0});
    box.addEventListener('change',function(){
      if(box.checked){ sel.addons[x.id]=parseInt(pick.value,10)||1; pick.disabled=false; }
      else { delete sel.addons[x.id]; pick.disabled=true; }
      renderSummary();
    });
    var stock=!x.available?null:(sel.date?(max>0?max+' left on '+shortDate(sel.date):(isOff(x)?'Not available on '+shortDate(sel.date):'All booked on '+shortDate(sel.date))):'Up to '+capOf(x)+' available');
    return h('tr',{class:ok?'':'off'},
      h('td',{class:'ck'},h('div',{class:'pickrow'},box,pick)),
      h('td',{},h('label',{for:'ad-'+x.id},x.title),x.note?h('small',{class:'sub-note'},x.note):null,stock?h('small',{class:'sub-note'},stock):null),
      h('td',{},x.available?[h('span',{class:'promo'},'Promo'),x.regular?h('s',{},'₱'+x.regular):null,' ₱'+x.price+(capOf(x)>1?' each':'')]:h('span',{class:'soon'},'Not available, coming soon')));
  });
  addonBox.replaceChildren.apply(addonBox,[h('h3',{class:'sub'},tx('addonsTitle')),tx('addonsNote')?h('p',{class:'promo-note'},tx('addonsNote')):'',
    h('div',{class:'tblwrap'},h('table',{class:'addons'},
      h('thead',{},h('tr',{},h('th',{},'Add / Qty'),h('th',{},'Add-on'),h('th',{},'Promo price'))),h('tbody',{},rows)))]);
}
function remList(){
  var out=[];
  for(var i=1;i<=5;i++){ var v=tx('rem'+i); if(v) out.push(v); }
  return out;
}
function remindersEl(){
  var items=remList(); if(!items.length) return null;
  return h('div',{class:'reminders'},h('strong',{},tx('remTitle')),h('ul',{},items.map(function(x){return h('li',{},x)})));
}
function renderRem(){ var n=remindersEl(); remWrap.replaceChildren.apply(remWrap,n?[n]:[]); }

/* ---------- GCash ---------- */
function gnum(){
  if(!flag('showGcash')) return '';
  return cfg('gcashNumber',(CONFIG.gcash||{}).number).replace(/\D/g,'').replace(/^(\d{4})(\d{3})(\d{4})$/,'$1 $2 $3');
}
function gname(){return cfg('gcashName',(CONFIG.gcash||{}).name)}
function copyBtn(txt,label){
  return h('button',{type:'button',class:'btn alt',onclick:function(e){
    var b=e.currentTarget;
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(function(){b.textContent='Copied!'},function(){window.prompt('Copy this:',txt)});
  }},label);
}
// Messenger, Viber and WhatsApp buttons with icons. Numbers come from config.js (viber, whatsapp). '' hides a button.
function intl(v){var d=String(v||'').replace(/\D/g,''); if(d.indexOf('0')===0) d='63'+d.slice(1); return d}
function svgIcon(path){
  var s=document.createElement('span'); s.className='ico'; s.setAttribute('aria-hidden','true');
  s.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" focusable="false"><path d="'+path+'"/></svg>';
  return s;
}
var ICO={   // official brand logos (Simple Icons, CC0)
  msgr:'M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.38-.16-3.47-.46a.96.96 0 00-.64.05l-2.39 1.05a.96.96 0 01-1.35-.85l-.07-2.14a.97.97 0 00-.32-.68A11.39 11.389 0 01.002 11.64zm8.32-2.19l-3.52 5.6c-.35.53.32 1.139.82.75l3.79-2.87c.26-.2.6-.2.87 0l2.8 2.1c.84.63 2.04.4 2.6-.48l3.52-5.6c.35-.53-.32-1.13-.82-.75l-3.79 2.87c-.25.2-.6.2-.86 0l-2.8-2.1a1.8 1.8 0 00-2.61.48z',
  viber:'M11.4 0C9.473.028 5.333.344 3.02 2.467 1.302 4.187.696 6.7.633 9.817.57 12.933.488 18.776 6.12 20.36h.003l-.004 2.416s-.037.977.61 1.177c.777.242 1.234-.5 1.98-1.302.407-.44.972-1.084 1.397-1.58 3.85.326 6.812-.416 7.15-.525.776-.252 5.176-.816 5.892-6.657.74-6.02-.36-9.83-2.34-11.546-.596-.55-3.006-2.3-8.375-2.323 0 0-.395-.025-1.037-.017zm.058 1.693c.545-.004.88.017.88.017 4.542.02 6.717 1.388 7.222 1.846 1.675 1.435 2.53 4.868 1.906 9.897v.002c-.604 4.878-4.174 5.184-4.832 5.395-.28.09-2.882.737-6.153.524 0 0-2.436 2.94-3.197 3.704-.12.12-.26.167-.352.144-.13-.033-.166-.188-.165-.414l.02-4.018c-4.762-1.32-4.485-6.292-4.43-8.895.054-2.604.543-4.738 1.996-6.173 1.96-1.773 5.474-2.018 7.11-2.03zm.38 2.602c-.167 0-.303.135-.304.302 0 .167.133.303.3.305 1.624.01 2.946.537 4.028 1.592 1.073 1.046 1.62 2.468 1.633 4.334.002.167.14.3.307.3.166-.002.3-.138.3-.304-.014-1.984-.618-3.596-1.816-4.764-1.19-1.16-2.692-1.753-4.447-1.765zm-3.96.695c-.19-.032-.4.005-.616.117l-.01.002c-.43.247-.816.562-1.146.932-.002.004-.006.004-.008.008-.267.323-.42.638-.46.948-.008.046-.01.093-.007.14 0 .136.022.27.065.4l.013.01c.135.48.473 1.276 1.205 2.604.42.768.903 1.5 1.446 2.186.27.344.56.673.87.984l.132.132c.31.308.64.6.984.87.686.543 1.418 1.027 2.186 1.447 1.328.733 2.126 1.07 2.604 1.206l.01.014c.13.042.265.064.402.063.046.002.092 0 .138-.008.31-.036.627-.19.948-.46.004 0 .003-.002.008-.005.37-.33.683-.72.93-1.148l.003-.01c.225-.432.15-.842-.18-1.12-.004 0-.698-.58-1.037-.83-.36-.255-.73-.492-1.113-.71-.51-.285-1.032-.106-1.248.174l-.447.564c-.23.283-.657.246-.657.246-3.12-.796-3.955-3.955-3.955-3.955s-.037-.426.248-.656l.563-.448c.277-.215.456-.737.17-1.248-.217-.383-.454-.756-.71-1.115-.25-.34-.826-1.033-.83-1.035-.137-.165-.31-.265-.502-.297zm4.49.88c-.158.002-.29.124-.3.282-.01.167.115.312.282.324 1.16.085 2.017.466 2.645 1.15.63.688.93 1.524.906 2.57-.002.168.13.306.3.31.166.003.305-.13.31-.297.025-1.175-.334-2.193-1.067-2.994-.74-.81-1.777-1.253-3.05-1.346h-.024zm.463 1.63c-.16.002-.29.127-.3.287-.008.167.12.31.288.32.523.028.875.175 1.113.422.24.245.388.62.416 1.164.01.167.15.295.318.287.167-.008.295-.15.287-.317-.03-.644-.215-1.178-.58-1.557-.367-.378-.893-.574-1.52-.607h-.018z',
  call:'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  wapp:'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'
};
function contactRow(){   // Call / WhatsApp / Viber. Messenger is only the one button in the "Request sent" box.
  var b=[];
  var cph=flag('showCall')?cfg('phone',CONFIG.phone):'';
  if(cph) b.push(h('a',{class:'btn contact call',href:'tel:+'+intl(cph)},svgIcon(ICO.call),'Call '+cph));   // tap = the phone dials right away
  var vb=flag('showViber')?intl(cfg('viber',CONFIG.viber===undefined?CONFIG.phone:CONFIG.viber)):'';
  var wa=flag('showWhatsapp')?intl(cfg('whatsapp',CONFIG.whatsapp===undefined?CONFIG.phone:CONFIG.whatsapp)):'';
  if(wa) b.push(h('a',{class:'btn contact wapp',href:'https://wa.me/'+wa,target:'_blank',rel:'noopener'},svgIcon(ICO.wapp),'WhatsApp'));
  if(vb) b.push(h('a',{class:'btn contact viber',href:'viber://chat?number=%2B'+vb,rel:'noopener'},svgIcon(ICO.viber),'Viber'));
  return b.length?h('div',{class:'contacts'},b):null;
}
// Opens Messenger with the request already typed in (?text=). Facebook does not officially support this, so the same text is
// also copied: if the message box opens empty on a phone, the customer can paste it.
function msgrSendBtn(){
  var mn=messengerName(); if(!mn) return null;
  return h('a',{class:'btn contact msgr',href:'https://m.me/'+encodeURIComponent(mn)+'?text='+encodeURIComponent(messageText()),target:'_blank',rel:'noopener',onclick:function(){
    try{ if(navigator.clipboard) navigator.clipboard.writeText(messageText()); }catch(x){}
  }},svgIcon(ICO.msgr),'Messenger');
}
function shotNote(){
  return h('p',{class:'hint'},'You can send a screenshot of your payment through Messenger or Viber.');
}
function paySection(){
  if(!gnum()) return null;
  return h('section',{class:'step'},h('h2',{},tx('gcashTitle')),
    tx('gcashNote')?h('p',{class:'hint',style:'margin:0 0 .6rem'},tx('gcashNote')):null,
    tx('gcashHint')?h('p',{class:'hint',style:'margin:0 0 .4rem'},tx('gcashHint')):null,
    shotNote(),
    h('div',{class:'payrow'},h('span',{class:'pay-name'},'GCash number: '+gnum()+(gname()?' ('+gname()+')':'')),copyBtn(gnum().replace(/\s/g,''),'Copy GCash number')),
    contactRow());
}
function renderPay(){ var n=paySection(); payWrap.hidden=!n; payWrap.replaceChildren.apply(payWrap,n?[n]:[]); }

/* ---------- calendar ---------- */
var dlg=h('dialog',{class:'dlg','aria-labelledby':'dlg-t',onclick:function(e){if(e.target===dlg)dlg.close()}});
document.body.append(dlg);
var STATE_TXT={hold:'on hold',booked:'booked',unavailable:'not available'}, STATE_SHORT={hold:'Hold',booked:'Booked',unavailable:'N/A'};
function shortDate(k){return fromKey(k).toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})}
function pick(k){
  var d=fromKey(k); sel.date=k; view=new Date(d.getFullYear(),d.getMonth(),1);
  calErr.textContent=''; renderCal(); renderSummary();
}
function nearOpen(k){
  var d=fromKey(k), out=[];
  for(var i=1;i<=60&&out.length<3;i++) [i,-i].forEach(function(o){
    var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+o), xk=key(x);
    if(out.length<3 && x>=today && inWindow(x) && !stateFor(xk) && leftFor(xk)>0) out.push(xk);
  });
  return out.sort();
}
function showDlg(title,msg,k,extra){
  var near=k?nearOpen(k):[], mn=messengerName();
  if(dlg.open) dlg.close();
  dlg.replaceChildren(
    h('h3',{id:'dlg-t'},title), h('p',{},msg),
    extra||'',
    near.length?h('p',{class:'hint'},pkgById(sel.pkg)?'Closest open dates for the '+pkgById(sel.pkg).title+':':'Closest dates with openings:'):'',
    h('div',{class:'chips'},near.map(function(x){return h('button',{type:'button',class:'chip',onclick:function(){dlg.close();pick(x)}},shortDate(x))})),
    h('div',{class:'actions'},
      h('button',{type:'button',class:'btn',autofocus:true,onclick:function(){dlg.close()}},'Choose another date'),
      mn?h('a',{class:'btn alt',href:'https://m.me/'+encodeURIComponent(mn),target:'_blank',rel:'noopener'},'Message us'):''));
  dlg.showModal();
}
function showTaken(k,st){
  var cp=pkgById(sel.pkg), t=cp?cp.title:'', all=!!(DAYS[k]&&DAYS[k]['*']);
  var alt=all?[]:CONFIG.packages.filter(function(p){return p.id!==sel.pkg && p.available!==false && !stateFor(k,p.title)});
  var msg;
  if(all) msg=' is not available.';
  else if(!alt.length) msg=' is fully booked. All packages are booked or on hold.';
  else if(st==='unavailable') msg=' is not available for the '+t+'.';
  else if(st==='hold') msg=' is on hold for the '+t+'. It may open up if the other customer does not confirm.';
  else msg=' is already booked for the '+t+'.';
  var extra=alt.length?h('div',{},h('p',{class:'hint'},'Same date, still open for:'),
    h('div',{class:'chips'},alt.map(function(p){return h('button',{type:'button',class:'chip',onclick:function(){dlg.close();sel.pkg=p.id;renderPkgs();pick(k)}},p.title)}))):'';
  showDlg(alt.length?(t?t+' is already taken':'That package is taken')+' on this date':'Sorry, that date is not available',longDate(k)+msg,k,extra);
}

function renderCal(){
  var fm=new Date(openFrom().getFullYear(),openFrom().getMonth(),1), lm=openTo()?new Date(openTo().getFullYear(),openTo().getMonth(),1):null;
  if(view<fm) view=fm; else if(lm&&view>lm) view=lm;   // keep the calendar on months that can be booked
  var y=view.getFullYear(), m=view.getMonth();
  var first=new Date(y,m,1), n=new Date(y,m+1,0).getDate(), openDays=0, N=availPkgs().length;
  var canPrev = view > fm;
  var limit = new Date(today.getFullYear(), today.getMonth()+12,1);
  var canNext = new Date(y,m+1,1) < limit && (!lm || new Date(y,m+1,1) <= lm);
  var cp=pkgById(sel.pkg), cells=[];
  DOW.forEach(function(d){cells.push(h('div',{class:'dow'},d))});
  for(var i=0;i<first.getDay();i++) cells.push(h('span',{class:'day empty'}));
  for(var d=1; d<=n; d++){
    (function(d){
      var dt=new Date(y,m,d), k=key(dt), past=dt<today, out=!past&&!inWindow(dt), off=past||out, o=DAYS[k]||{}, blocked=!!o['*'];
      var left=off?0:leftFor(k), mine=(!off&&!blocked&&cp&&o[cp.title])?true:false, cls, lab, say;
      var allBooked=!blocked&&left===0&&availPkgs().every(function(p){return o[p.title]==='booked'});
      if(off){cls=past?'past':'past out';lab='';say=past?'past date':'outside the booking dates'}
      else if(blocked){cls='unavailable';lab='N/A';say='not available'}
      else if(left===0){cls='booked';lab=allBooked?'Booked':'Full';say='fully booked, 0 packages left'}
      else {cls='open '+(left>=N?'l3':left===1?'l1':'l2');lab=left+' left';say=left+' of '+N+' packages left'; openDays++}
      if(!off&&!blocked&&left>0&&cp&&!o[cp.title]&&pcap(cp)>1){var sl=pseats(cp,k); lab=sl+' left'; say=sl+' of '+pcap(cp)+' '+cp.title+' sets left'; cls='open '+(sl>=pcap(cp)?'l3':sl===1?'l1':'l2')}
      if(mine) {cls+=' mine'; say+='. '+cp.title+' is taken'}
      if(!off&&!blocked&&left>0&&(cp?specialFor(cp,k):CONFIG.packages.some(function(x){return specialFor(x,k)}))){cls+=' sp'; say+=', special rate'}
      if(dt.getTime()===today.getTime()) cls+=' today';
      var label=dt.toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric'})+', '+say;
      cells.push(h('button',{type:'button',class:'day '+cls,disabled:off,'aria-label':label,'aria-pressed':sel.date===k?'true':'false',onclick:function(){
        var s=stateFor(k);
        if(s){showTaken(k,s);return}
        if(left===0){showTaken(k,'booked');return}
        pick(k);
      }},h('span',{class:'dn'},String(d)),h('span',{class:'ds'},lab)));
    })(d);
  }
  calBox.replaceChildren(
    daysState==='failed' ? h('p',{class:'note'},'We could not load the booked dates right now. You can still send a request and we will check the date for you.') : '',
    h('p',{class:'hint',style:'margin:0 0 .6rem'},cp?'Your package: '+cp.title+'. A red dashed outline means it is taken that day.':tx('calNote')),
    (winMin()>0||winMax()!=null)?h('p',{class:'hint',style:'margin:0 0 .6rem'},'Online booking is open for '+shortDate(key(openFrom()))+(openTo()?' to '+shortDate(key(openTo())):' onwards')+'.'):'',
    h('div',{class:'cal-head'},
      h('button',{type:'button',class:'nav','aria-label':'Previous month',disabled:!canPrev,onclick:function(){view=new Date(y,m-1,1);renderCal()}},'‹'),
      h('strong',{},MONTHS[m]+' '+y),
      h('button',{type:'button',class:'nav','aria-label':'Next month',disabled:!canNext,onclick:function(){view=new Date(y,m+1,1);renderCal()}},'›')),
    h('div',{class:'legend'},
      h('span',{},h('i',{class:'sw l3'}),'Available'),
      h('span',{},h('i',{class:'sw booked'}),'Fully booked'),
      h('span',{},h('i',{class:'sw na'}),'Not available'),
      cp?h('span',{},h('i',{class:'sw mine'}),'Your package is taken'):null,
      SPECIAL.length?h('span',{},h('i',{class:'sw sp'}),'Special rate'):null),
    h('div',{class:'grid',style:'margin-top:.7rem'},cells),
    daysState==='loading' ? h('p',{class:'hint'},'Loading available dates...') :
    (sel.date ? h('p',{class:'chosen'},longDate(sel.date)+((cp&&specialFor(cp,sel.date))?' · '+specialFor(cp,sel.date).label+': '+peso(specialFor(cp,sel.date).price):'')) : h('p',{class:'hint'},openDays+' '+(openDays===1?'date has':'dates have')+' openings in '+MONTHS[m]+'. Tap a green date to choose it.'))
  );
}

/* ---------- form (built once so typing never loses focus) ---------- */
var fName=h('input',{type:'text',id:'f-name',autocomplete:'name',required:true,'aria-describedby':'e-name',oninput:function(e){sel.name=e.target.value;clearErr('name',e.target)}});
var fPhone=h('input',{type:'tel',id:'f-phone',autocomplete:'tel',inputmode:'numeric',maxlength:'13',pattern:'[0-9 ]*',required:true,'aria-describedby':'e-phone',oninput:function(e){e.target.value=fmtPhone(e.target.value);sel.phone=e.target.value;clearErr('phone',e.target)}});
var fStreet=h('input',{type:'text',id:'f-street',autocomplete:'off',placeholder:'House No. and street',oninput:function(e){sel.street=e.target.value;renderSummary()}});
var fCity=h('select',{id:'f-city',required:true,'aria-describedby':'e-city',onchange:function(e){sel.city=e.target.value;sel.brgy='';fillBrgy();clearErr('city',e.target)}});
var fBrgy=h('select',{id:'f-brgy',required:true,'aria-describedby':'e-brgy',onchange:function(e){sel.brgy=e.target.value;clearErr('brgy',e.target)}});
var fLandmark=h('input',{type:'text',id:'f-landmark',placeholder:'Nearby landmark, like beside the barangay hall',oninput:function(e){sel.landmark=e.target.value;renderSummary()}});
var fPay=h('select',{id:'f-pay',required:true,'aria-describedby':'e-pay',onchange:function(e){sel.pay=e.target.value;clearErr('pay',e.target)}});
var LOCS=CONFIG.locations||{}, LOCOFF={}, LOCFEE={}, locKey='';   // { 'City': ['Barangay', ...] } from the Locations sheet
function venueText(){   // House No. and Street, Barangay, City
  return [sel.street.trim(),sel.brgy,sel.city].filter(Boolean).join(', ');
}
function brgyOff(c,b){ return (LOCOFF[c]||[]).indexOf(b)>-1 }
function cityOff(c){ var l=LOCS[c]||[]; return !!l.length&&l.every(function(b){return brgyOff(c,b)}) }
function fillBrgy(){
  var list=LOCS[sel.city]||[];
  if(sel.brgy&&(list.indexOf(sel.brgy)<0||brgyOff(sel.city,sel.brgy))) sel.brgy='';
  fBrgy.disabled=!sel.city;
  fBrgy.replaceChildren.apply(fBrgy,[h('option',{value:''},sel.city?'Select barangay':'Select city first')].concat(list.map(function(x){
    var off=brgyOff(sel.city,x);
    return h('option',{value:x,selected:x===sel.brgy,disabled:off},off?x+' (not available)':x)})));
}
function renderLocs(){   // rebuilt only when the Locations sheet really changed
  var k=JSON.stringify([LOCS,LOCOFF]); if(k===locKey) return; locKey=k;
  if(sel.city&&(!LOCS[sel.city]||cityOff(sel.city))) sel.city='';
  fCity.replaceChildren.apply(fCity,[h('option',{value:''},'Select city')].concat(Object.keys(LOCS).map(function(c){
    var off=cityOff(c);
    return h('option',{value:c,selected:c===sel.city,disabled:off},off?c+' (not available)':c)})));
  fillBrgy();
}
var payKey='';
function renderPayOptions(){   // the choices come from the Settings sheet (Payment methods)
  var list=cfg('payMethods','GCash, Pay Maya, Bank Transfer, Cash').split(',').map(function(s){return s.trim()}).filter(Boolean);
  if(!list.length) list=['GCash'];
  if(list.join('|')===payKey) return;   // nothing changed: leave the open dropdown alone
  payKey=list.join('|');
  if(sel.pay&&list.indexOf(sel.pay)<0) sel.pay='';
  fPay.replaceChildren.apply(fPay,[h('option',{value:''},'Select payment method')].concat(list.map(function(x){return h('option',{value:x,selected:x===sel.pay},x)})));
}
renderPayOptions(); renderLocs();
var DEF_TIMES=[];for(var t=8;t<=21;t++){var hh=t>12?t-12:t;DEF_TIMES.push(hh+':00 '+(t<12?'AM':'PM'))}
var DEF_HOURS=['3','4','5','6','8','10','12','16','22'];
var TIMES=DEF_TIMES, HOURS=DEF_HOURS, schKey='';
var fTime=h('select',{id:'f-time',onchange:function(e){sel.time=e.target.value;renderSummary()}});
var fHours=h('select',{id:'f-hours',onchange:function(e){sel.hours=e.target.value;renderSummary()}});
function renderSched(){   // start times and hours come from the Schedule sheet; rebuilt only when they really changed
  var k=JSON.stringify([TIMES,HOURS]); if(k===schKey) return; schKey=k;
  if(TIMES.indexOf(sel.time)<0) sel.time=TIMES[0];
  if(HOURS.indexOf(sel.hours)<0) sel.hours=HOURS[0];
  fTime.replaceChildren.apply(fTime,TIMES.map(function(x){return h('option',{value:x,selected:x===sel.time},x)}));
  fHours.replaceChildren.apply(fHours,HOURS.map(function(x){return h('option',{value:x,selected:x===sel.hours},x+(x==='1'?' hour':' hours'))}));
}
renderSched();
var fDelivery=h('input',{type:'checkbox',id:'f-delivery',checked:true,onchange:function(e){sel.delivery=e.target.checked;renderSummary()}});
var delLblT=h('span',{},'I need delivery and setup'), delLabel=h('label',{class:'check wide',for:'f-delivery'},fDelivery,delLblT);
var fDelHint=h('p',{class:'hint wide',role:'status'});
var payTitleT=h('span',{},FALLBACK.payTitle), lblTimeT=h('span',{},'Start time'), lblHoursT=h('span',{},'Hours needed');
var fNotes=h('textarea',{id:'f-notes',placeholder:'Number of guests, anything we should know',oninput:function(e){sel.notes=e.target.value}});
var fHp=h('input',{type:'text',id:'f-website',tabindex:'-1',autocomplete:'off','aria-hidden':'true',oninput:function(e){sel.website=e.target.value}});
var eName=h('span',{class:'err',id:'e-name'}), ePhone=h('span',{class:'err',id:'e-phone'}), eCity=h('span',{class:'err',id:'e-city'}), eBrgy=h('span',{class:'err',id:'e-brgy'}), eEvents=h('span',{class:'err',id:'e-events',role:'alert'}), ePay=h('span',{class:'err',id:'e-pay'});
var errEls={name:eName,phone:ePhone,city:eCity,brgy:eBrgy,events:eEvents,pay:ePay}, inEls={name:fName,phone:fPhone,city:fCity,brgy:fBrgy,pay:fPay};
function reqLab(t){return h('span',{},t,h('span',{class:'req','aria-hidden':'true'},' *'))}   // red star for required fields
var EVTYPES=null, evKey='';
var evOpts=h('div',{class:'opts'});
var evBox=h('fieldset',{class:'events wide'},h('legend',{},reqLab('Type of event (tick all that apply)')),evOpts,eEvents);
function renderEvents(){   // the tick boxes come from the Event Types sheet; rebuilt only when they really changed
  var list=(EVTYPES&&EVTYPES.length)?EVTYPES:(CONFIG.events||[]);
  var k=JSON.stringify(list); if(k===evKey) return; evKey=k;
  sel.events=sel.events.filter(function(x){return list.indexOf(x)>-1});   // a type that was switched off is un-ticked
  evOpts.replaceChildren.apply(evOpts,list.map(function(n){
    return h('label',{class:'check chip-check'},h('input',{type:'checkbox',value:n,checked:sel.events.indexOf(n)>-1,onchange:function(e){
      var i=sel.events.indexOf(n); if(e.target.checked){if(i<0)sel.events.push(n)}else if(i>=0)sel.events.splice(i,1); clearErr('events',evBox);
    }}),n)}));
}
renderEvents();
inEls.events=evBox;
var summaryBox=h('dl',{class:'summary'});
var submitBtn=h('button',{type:'submit',class:'btn',id:'send'},FALLBACK.sendBtn);
var reqTitleEl=h('h3',{style:'font-family:var(--font-display);margin:1.1rem 0 .5rem;font-size:1.05rem'},FALLBACK.reqTitle);
var locNoteEl=h('p',{class:'hint'},FALLBACK.locNote.replace('{name}',CONFIG.name));
var statusEl=h('p',{class:'status',role:'status','aria-live':'polite'});
var extraBox=h('div',{class:'actions'});

function clearErr(k,input){ delete errors[k]; errEls[k].textContent=''; input.removeAttribute('aria-invalid'); renderSummary(); }
function setErr(k,msg){ errors[k]=msg; errEls[k].textContent=msg; inEls[k].setAttribute('aria-invalid','true'); }

function grp(title,kids){ return h('div',{class:'grp'},h('h3',{class:'grp-t'},title),h('div',{class:'fields'},kids)); }
var locBtn=h('button',{type:'button',class:'btn alt loc-btn',onclick:function(){ shareLoc(); }});
var locRm=h('button',{type:'button',class:'loc-rm',onclick:function(){ sel.loc=null; sel.locSkip=true; sel.locMsg=''; drawLoc(); renderSummary(); }},'Remove');
var locMsgEl=h('p',{class:'loc-msg',role:'status','aria-live':'polite'});
var locCard=h('div',{class:'loc-card'},h('div',{class:'loc-row'},h('span',{class:'loc-ico','aria-hidden':'true'},'\uD83D\uDCCD'),h('div',{class:'loc-tx'},h('strong',{},'Pin your venue (optional)'),locMsgEl)),h('div',{class:'loc-act'},locBtn,locRm));
function drawLoc(){
  if(sel.loc){
    locBtn.textContent='Update my pin'; locRm.hidden=false;
    locMsgEl.className='loc-msg ok'; locMsgEl.textContent='Pin added'+(sel.loc.acc?' (about '+sel.loc.acc+' m accurate)':'')+'. It will be sent with your request.';
  } else {
    locBtn.textContent='Share my location'; locRm.hidden=true;
    locMsgEl.className='loc-msg'+(sel.locBad?' bad':''); locMsgEl.textContent=sel.locMsg||'One tap. Your phone will ask permission, and we can find your venue easily.';
  }
  locBtn.disabled=!!sel.locBusy;
}
function locError(code){
  var inApp=/FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\//i.test(navigator.userAgent);
  if(!window.isSecureContext) return 'Location only works on a secure (https) page.';
  if(code===1) return 'Location is blocked. Turn on Location for your browser in your phone Settings, then tap again.'+(inApp?' If you opened this from Facebook or Messenger, open the page in Chrome or Safari.':'');
  if(code===3) return 'Your phone took too long to find you. Step outside or turn on GPS, then tap again.';
  return 'We could not get your location.'+(inApp?' Open this page in Chrome or Safari and try again.':' Turn on GPS and try again.');
}
// Runs inside the tap itself, which phones require before they show the permission box.
function shareLoc(){
  if(sel.locBusy) return;
  if(!navigator.geolocation){ sel.locBad=true; sel.locMsg='This browser cannot share location. You can skip this.'; drawLoc(); return; }
  sel.locBusy=true; sel.locBad=false; sel.locMsg='Finding your location...'; locBtn.textContent='Finding location...'; drawLoc(); locBtn.textContent='Finding location...';
  getLocation(true,function(loc,code){
    sel.locBusy=false;
    if(loc){ sel.loc=loc; sel.locSkip=false; sel.locMsg=''; }
    else { sel.locBad=true; sel.locMsg=locError(code); if(code===1) sel.locSkip=true; }
    drawLoc(); renderSummary();
  });
}

var form=h('form',{novalidate:true,id:'bookform',onsubmit:onSubmit},
  h('div',{class:'form-grid'},
    h('div',{class:'form-main'},
      grp('Your contact',[
        h('label',{for:'f-name'},reqLab('Your name'),fName,eName),
        h('label',{for:'f-phone'},reqLab('Mobile number'),fPhone,ePhone)]),
      grp('Venue address',[
        h('label',{class:'wide',for:'f-street'},'House No. and Street (optional)',fStreet),
        h('label',{for:'f-city'},reqLab('City'),fCity,eCity),
        h('label',{for:'f-brgy'},reqLab('Barangay'),fBrgy,eBrgy),
        h('label',{class:'wide',for:'f-landmark'},'Landmark (optional)',fLandmark)]),
      grp('Schedule',[
        h('label',{for:'f-time'},lblTimeT,fTime),
        h('label',{for:'f-hours'},lblHoursT,fHours),
        delLabel,
        fDelHint]),
      grp(payTitleT,[
        h('label',{class:'wide',for:'f-pay'},reqLab('Payment method'),fPay,ePay),
        evBox,
        h('label',{class:'wide',for:'f-notes'},'Notes (optional)',fNotes)]),
      h('div',{class:'hp','aria-hidden':'true'},h('label',{for:'f-website'},'Leave this empty',fHp))),
    h('aside',{class:'form-side'},
      reqTitleEl,
      summaryBox,
      locCard,
      pausedEl,
      h('div',{class:'actions send-row'},submitBtn),
      locNoteEl,
      statusEl,
      extraBox)));
drawLoc();
var doneBox=h('div',{id:'donebox',hidden:true});
formBox.append(form,doneBox);

function drawDelHint(){
  var f=feeOf(), on=wantsDelivery()&&sel.brgy&&f!=null;
  fDelHint.textContent=on?(f>0?'Delivery fee to '+sel.brgy+': '+peso(f)+' (added to your total).':'Free delivery to '+sel.brgy+'.'):'';
  fDelHint.hidden=!on;
}
function renderSummary(){
  drawDelHint();
  if(addonDate!==(sel.date||'')){ renderAddons(); renderPkgs(); }   // the chosen date changed: show what is left for that date
  var p=pkgById(sel.pkg);
  function row(a,b){return [h('dt',{},a),h('dd',{},b)]}
  summaryBox.replaceChildren.apply(summaryBox,[].concat(
    row('Package',p?p.title+' ('+peso(priceOf(p))+' '+priceTag(p)+')':'Not chosen yet'),
    chosenAddons().length?row('Add-ons',chosenAddons().map(function(x){return addonLabel(x)+' ('+peso(num(x.price)*x.q)+')'}).join(', ')):[],
    row('Date',sel.date?longDate(sel.date):'Not chosen yet'),
    sel.landmark.trim()?row('Landmark',sel.landmark.trim()):[],
    sel.city?row('Venue',venueText()):[],
    sel.loc?row('Pin location','Added'):[],
    row('Time',sel.time+' for '+sel.hours+' hours'),
    row('Delivery',wantsDelivery()?'Delivery and setup':'I will pick up'),
    (wantsDelivery()&&feeOf()!=null)?row('Delivery fee',feeOf()>0?peso(feeOf()):'Free'):[],
    sel.pay?row('Payment method',sel.pay):[],
    sel.events.length?row('Event',sel.events.join(', ')):[],
    p?row('Total rental fee',peso(totalFee())+' (reservation fee included)'):[]
  ));
}

function validate(){
  errors={};
  ['name','phone','city','brgy','events','pay'].forEach(function(k){errEls[k].textContent='';inEls[k].removeAttribute('aria-invalid')});
  pkgErr.textContent=''; calErr.textContent='';
  var first=null;
  if(!sel.pkg){pkgErr.textContent='Please choose a package.'; first=first||pkgBox.querySelector('button')}
  if(!sel.date){calErr.textContent='Please choose a date.'; first=first||calBox.querySelector('.day:not(:disabled)')}
  if(sel.pkg&&sel.date){   // the chosen package may have been taken since the date was picked
    var taken=stateFor(sel.date);
    if(taken){var lostDate=sel.date; sel.date=null; renderCal(); renderSummary(); showTaken(lostDate,taken); return false}
  }
  if(sel.name.trim().length<2){setErr('name','Your name is required. Please enter your name.'); first=first||fName}
  if(!phoneOk(sel.phone)){setErr('phone',sel.phone.trim()?'Enter your 11-digit mobile number, like 0995 252 5426.':'Please enter your mobile number.'); first=first||fPhone}
  if(!sel.city){setErr('city','Please select a city.'); first=first||fCity}
  if(sel.city&&!sel.brgy){setErr('brgy','Please select a barangay.'); first=first||fBrgy}
  else if(sel.city&&brgyOff(sel.city,sel.brgy)){sel.brgy=''; fillBrgy(); setErr('brgy','Sorry, we cannot serve that barangay right now. Please pick another.'); first=first||fBrgy}
  if(!sel.pay){setErr('pay','Please select a payment method.'); first=first||fPay}
  if(!sel.events.length){setErr('events','Please tick at least one type of event.'); first=first||evBox.querySelector('input')}
  if(first){first.focus(); first.scrollIntoView({block:'center',behavior:'smooth'}); return false}
  return true;
}

function messageText(){
  if(SENT&&SENT.msg){   // after sending, always use the saved copy (the form may have been refreshed or reset since)
    return (sel.loc&&SENT.msg.indexOf('maps?q=')<0)?SENT.msg+'\n• My location: https://www.google.com/maps?q='+sel.loc.lat+','+sel.loc.lng:SENT.msg;
  }
  var p=pkgById(sel.pkg);
  var lines=['Hi! I would like to book:',
    '• Package: '+(p?p.title:''),
    '• Date: '+longDate(sel.date),
    '• Start: '+sel.time+' for '+sel.hours+' hours',
    '• Venue: '+venueText(),
    (sel.landmark.trim()?'• Landmark: '+sel.landmark.trim():null),
    (sel.loc?'• My location: https://www.google.com/maps?q='+sel.loc.lat+','+sel.loc.lng:null),
    (sel.pay?'• Payment method: '+sel.pay:null),
    '• Event type: '+(sel.events.join(', ')||'Not specified'),
    '• Add-ons: '+(chosenAddons().map(addonLabel).join(', ')||'None'),
    '• Total rental fee: '+peso(totalFee())+' (reservation fee included)',
    '• Delivery and setup: '+(wantsDelivery()?'Yes':'No, I will pick up'),
    ((wantsDelivery()&&feeOf()!=null)?'• Delivery fee: '+(feeOf()>0?peso(feeOf()):'Free'):null),
    '• Name: '+sel.name.trim(),
    '• Mobile: '+sel.phone.trim()];
  if(sel.notes.trim()) lines.push('• Notes: '+sel.notes.trim());
  lines.push('Is this date still available? Thank you!');
  return lines.filter(Boolean).join('\n');
}

// Asks the phone for its position (the browser shows its own permission prompt). Never blocks sending: any problem gives null.
// quiet=true: do not touch the Send button text (used after the request is already sent).
function getLocation(quiet,cb){
  function done(loc,code){ if(cb) cb(loc,code); }
  return new Promise(function(resolve){
    if(!navigator.geolocation||!window.isSecureContext){ done(null,0); resolve(null); return }
    if(!quiet) submitBtn.textContent='Getting location...';
    function ok(pos){ if(!quiet) submitBtn.textContent='Sending...'; var l={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:Math.round(pos.coords.accuracy)}; done(l); resolve(l); }
    function fail(err){ if(!quiet) submitBtn.textContent='Sending...'; done(null,err&&err.code); resolve(null); }
    // Normal (Wi-Fi / cell) position first: it answers fast on phones and indoors. Then try GPS only if that failed.
    navigator.geolocation.getCurrentPosition(ok,function(err){
      if(err && err.code===1){ fail(err); return; }   // 1 = the customer pressed Don't allow
      navigator.geolocation.getCurrentPosition(ok,fail,{enableHighAccuracy:true,timeout:12000,maximumAge:0});
    },{enableHighAccuracy:false,timeout:8000,maximumAge:120000});
  });
}
// Our own friendly "Share your location?" question, shown BEFORE the phone's permission prompt.
// Yes -> the phone asks for permission and the pin is added to the booking and to the Messenger message. No -> request is sent without a pin.
function askLocation(){
  return new Promise(function(resolve){
    if(!navigator.geolocation){resolve(null);return}
    dlg.returnValue=''; var allowed=false;
    dlg.replaceChildren(
      h('h3',{id:'dlg-t'},'📍 Share your pin location?'),
      h('p',{},'Allow '+CONFIG.name+' to see your location? Your map pin will be added to your booking and to your Messenger message, so we can find your venue easily.'),
      h('p',{class:'hint'},'Your phone will ask for permission next. You can also skip this.'),
      h('div',{class:'actions'},
        h('button',{type:'button',class:'btn',autofocus:true,onclick:function(){ allowed=true; var p=getLocation(); dlg.close('allow'); p.then(resolve); }},'Yes, share my location'),
        h('button',{type:'button',class:'btn alt',onclick:function(){dlg.close('skip')}},'No, skip')));
    dlg.addEventListener('close',function(){ if(!allowed) resolve(null); },{once:true});
    dlg.showModal();
  });
}

function setStatus(msg,bad){ statusEl.textContent=msg||''; statusEl.className='status'+(bad?' bad':''); }

function showMessengerFallback(){
  var mn=messengerName();
  var btns=[];
  btns.push(h('button',{type:'button',class:'btn alt',onclick:function(e){
    var b=e.currentTarget;
    (navigator.clipboard?navigator.clipboard.writeText(messageText()):Promise.reject()).then(function(){b.textContent='Copied!'},function(){
      window.prompt('Copy this message:',messageText());
    });
  }},'Copy message'));
  if(mn) btns.push(h('a',{class:'btn alt',href:'https://m.me/'+encodeURIComponent(mn),target:'_blank',rel:'noopener'},'Open Messenger'));
  extraBox.replaceChildren.apply(extraBox,btns);
}

function onSubmit(ev){
  ev.preventDefault();
  if(sending||!flag('acceptRequests')) return;
  if(!validate()) return;
  if(!CONFIG.scriptUrl){
    setStatus('Online sending is not set up yet. Copy your message and send it on Messenger instead.',true);
    showMessengerFallback(); return;
  }
  sending=true; submitBtn.disabled=true; submitBtn.textContent='Sending...'; setStatus('');
  var p=pkgById(sel.pkg);
  var payload={pkg:p.title,price:peso(priceOf(p)),date:sel.date,time:sel.time,hours:sel.hours,venue:venueText(),
    delivery:wantsDelivery(),events:sel.events.join(', '),addons:chosenAddons().map(addonLabel).concat(deliveryFee()>0?['Delivery fee ('+peso(deliveryFee())+')']:[]).join(', '),addonQty:chosenAddons().reduce(function(o,x){o[x.title]=x.q;return o},{}),total:peso(totalFee()),landmark:sel.landmark.trim(),payMethod:sel.pay,name:sel.name.trim(),phone:sel.phone.trim(),notes:sel.notes.trim(),website:sel.website};
  var ctl=new AbortController(), timer;
  ((sel.loc||sel.locSkip)?Promise.resolve(sel.loc):askLocation()).then(function(loc){
    if(loc){payload.lat=loc.lat;payload.lng=loc.lng;payload.acc=loc.acc;sel.loc=loc;drawLoc()}
    timer=setTimeout(function(){ctl.abort()},35000);   // Google Script can take a while to save, so give it time
    return fetch(CONFIG.scriptUrl,{method:'POST',body:JSON.stringify(payload),signal:ctl.signal});   // no custom headers: avoids a CORS preflight
  })
    .then(function(r){return r.json()})
    .then(function(res){
      if(res && res.ok){ sel.reqId=res.id; trackReq(res.id); SENT=snapshot(); saveSent(SENT); showDone(); loadDays(true,true); }
      else if(res && res.error==='taken'){
        var tk=sel.date; sel.date=null; loadDays(true,true); renderSummary(); showDlg('Sorry, that date was just taken',longDate(tk)+' was requested by someone else a moment ago.',tk);
        setStatus('Sorry, that date was just taken. Please choose another date.',true);
        calErr.textContent='Please choose another date.';
        calBox.scrollIntoView({behavior:'smooth',block:'start'});
      } else if(res && res.error==='addon'){
        loadDays(true,true);
        setStatus('Sorry, '+(res.item||'an add-on')+' was just booked by someone else for that date. Please check the add-ons again and resend.',true);
        addonBox.scrollIntoView({behavior:'smooth',block:'start'});
      } else if(res && res.error==='price'){
        loadDays(true,true);
        setStatus('The price for that date was just updated. Please check your total and send again.',true);
      } else if(res && res.error==='closed'){
        var cd=sel.date; sel.date=null; loadDays(true,true); renderCal(); renderSummary();
        setStatus('Sorry, '+longDate(cd)+' is not open for online booking. Please choose another date.',true);
        calErr.textContent='Please choose another date.';
        calBox.scrollIntoView({behavior:'smooth',block:'start'});
      } else { throw new Error('bad') }
    })
    .catch(function(err){
      var slow=err&&err.name==='AbortError';
      setStatus('We could not confirm your request. Please check with us on Messenger or by phone before sending it again, so you are not booked twice.',true);
      showMessengerFallback();
      showErr(slow?'This is taking too long':'We could not confirm your request',
        (slow?'The server did not answer in time. ':'Something went wrong on our side. ')+'Your request may have been received. Please message or call us to check before sending it again, so you are not booked twice.');
    })
    .then(function(){ clearTimeout(timer); sending=false; submitBtn.disabled=!flag('acceptRequests'); submitBtn.textContent=tx('sendBtn'); });
}

/* ---------- status view: one look for "Request sent" (magenta), Confirmed (green), On hold (orange), Declined (red) ---------- */
var SV={sent:'<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',ok:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  hold:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',bad:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  peso:'<path d="M8 20V5h5a3.6 3.6 0 0 1 0 7.2H8M5.5 8.5h10.5M5.5 11.5h10.5"/>',
  box:'<path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4zM3.5 8 12 12l8.5-4M12 12v8"/>',
  pin:'<path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/>',phone:'<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  card:'<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/>',star:'<path d="M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.1 7.2 18.8l1-5.4-4-3.7 5.4-.7z"/>',
  truck:'<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',note:'<path d="M6 3.5h9l3.5 3.5v13.5H6zM9 11h6M9 15h6"/>'};
function svgS(p,size){
  var s=document.createElement('span'); s.setAttribute('aria-hidden','true'); s.style.display='inline-flex';
  s.innerHTML='<svg viewBox="0 0 24 24" width="'+size+'" height="'+size+'" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false">'+p+'</svg>';
  return s;
}
function svRow(icon,label,value,sub,big){
  return h('div',{class:'sv-row'},h('span',{class:'sv-ri'},svgS(SV[icon],22)),
    h('div',{class:'sv-tx'},h('div',{class:'sv-k'},label),h('div',{class:'sv-v'+(big?' big':'')},value),sub?h('div',{class:'sv-sub'},sub):null));
}
// bolds the {customer} {phone} {date} words of a sentence
function boldTpl(t,map){
  var out=[];
  String(t).split(/(\{\w+\})/).forEach(function(part){
    var m=part.match(/^\{(\w+)\}$/);
    if(m && map[m[1]]!=null) out.push(h('strong',{},map[m[1]])); else if(part) out.push(part);
  });
  return out;
}
function statusView(kind,title,msg,rows,extra){
  return h('div',{class:'sv '+kind,role:'status'},
    h('div',{class:'sv-ico'},h('span',{},svgS(SV[kind==='sent'?'sent':kind],34))),
    h('h3',{},title),h('p',{class:'sv-msg'},msg),
    rows&&rows.length?h('div',{class:'sv-card'},rows):null,extra);
}

function showErr(title,msg){   // simple pop-up with one OK button
  if(dlg.open) dlg.close();
  dlg.replaceChildren(h('h3',{id:'dlg-t'},title),h('p',{},msg),
    h('div',{class:'actions'},h('button',{type:'button',class:'btn',autofocus:true,onclick:function(){dlg.close()}},'OK')));
  dlg.showModal();
}
// Everything the customer sees on the "Request sent" page, saved at the moment of sending.
function snapshot(){
  var p=pkgById(sel.pkg)||{}, f=feeOf();
  return {id:sel.reqId||'',t:Date.now(),name:sel.name.trim(),phone:sel.phone.trim(),pkg:p.title||'',time:sel.time,hours:sel.hours,
    addons:chosenAddons().map(addonLabel).join(', '),date:sel.date,venue:venueText(),landmark:sel.landmark.trim(),events:sel.events.join(', '),
    pay:sel.pay,delivery:wantsDelivery()?'Delivery and setup':'I will pick up',fee:(wantsDelivery()&&f!=null)?(f>0?peso(f):'Free'):'',
    notes:sel.notes.trim(),total:peso(totalFee()),hasLoc:!!sel.loc,msg:messageText()};
}

function showDone(){
  sentOk=true;
  var S=SENT||snapshot(), dateText=longDate(S.date);
  var msgrBox=h('div',{});
  function drawMsgr(){
    var btn=msgrSendBtn(); if(!btn){ msgrBox.replaceChildren(); return }
    var parts=[h('div',{class:'contacts'},btn),
      h('p',{class:'hint'},'Your details'+(sel.loc?' and your map pin':'')+' are already typed in Messenger. If the message box opens empty, tap Copy message below, then paste it in the chat.')];
    parts.push(h('button',{type:'button',class:'btn alt',style:'margin-top:.6rem',onclick:function(e){
      var b=e.currentTarget;
      (navigator.clipboard?navigator.clipboard.writeText(messageText()):Promise.reject()).then(function(){b.textContent='Copied! Now paste it in Messenger'},function(){
        window.prompt('Copy this message:',messageText());
      });
    }},'Copy message'+(sel.loc?' (with my pin)':'')));
    if(!sel.loc && navigator.geolocation){
      parts.push(h('button',{type:'button',class:'btn alt',style:'margin-top:.6rem',onclick:function(e){
        var b=e.currentTarget; b.textContent='Getting location...';
        getLocation(true,function(l,code){
          if(l){ sel.loc=l; drawMsgr(); }
          else { b.textContent=locError(code); }
        });
      }},'📍 Add my pin to the Messenger message'));
    }
    msgrBox.replaceChildren.apply(msgrBox,parts);
  }
  drawMsgr();
  var again=h('button',{type:'button',class:'btn',onclick:function(){
    sentOk=false; SENT=null; saveSent(null); doneBox.hidden=true; form.hidden=false;
    sel.pkg=null; sel.date=null; sel.notes=''; fNotes.value=''; setStatus(''); extraBox.replaceChildren();
    renderPkgs(); renderAddons(); renderCal(); renderSummary(); window.scrollTo({top:0,behavior:'smooth'});
  }},'Book another package');
  var rows=[
    svRow('user','Name',S.name),
    svRow('phone','Mobile number',S.phone),
    S.pkg?svRow('box','Package',S.pkg,S.time?('Start: '+S.time+(S.hours?' ('+S.hours+' hrs)':'')):''):null,
    S.addons?svRow('star','Add-ons',S.addons):null,
    svRow('cal','Reservation date',dateText),
    S.venue?svRow('pin','Venue',S.venue,S.landmark?('Landmark: '+S.landmark):''):null,
    svRow('truck','Delivery',S.delivery,S.fee?('Delivery fee: '+S.fee):''),
    S.events?svRow('star','Event',S.events):null,
    S.pay?svRow('card','Payment method',S.pay):null,
    S.notes?svRow('note','Notes',S.notes):null,
    svRow('peso','Total rental fee',S.total,'The reservation fee is included in it.',true)];
  doneBox.replaceChildren(statusView('sent',tx('doneTitle'),
    boldTpl(tx('doneMsg'),{customer:S.name,phone:S.phone,date:dateText}),rows.filter(Boolean),
    [tx('doneNote')?h('p',{class:'sv-note'},tx('doneNote')):null,msgrBox,contactRow()]),again);
  form.hidden=true; doneBox.hidden=false; doneBox.scrollIntoView({behavior:'smooth',block:'center'});
}

/* ---------- load booked dates from the Google Sheet (silent: no reload, no flicker) ---------- */
var ver='', pending=null;
var CACHE='arPayload';   // last data from the sheet, kept on the device so the page opens already filled in
function saveCache(res){ try{ localStorage.setItem(CACHE,JSON.stringify(res)); }catch(e){} }
function readCache(){ try{ var c=JSON.parse(localStorage.getItem(CACHE)||'null'); return c&&c.ok?c:null; }catch(e){ return null; } }
// Draws new sheet data. Returns the chosen date if it was just taken by someone else.
function applyPayload(res){
  DAYS=res.days||{}; USED=res.used||{}; PUSED=res.pused||{}; OFF=res.off||{}; ver=res.v||'';
  applyText(res.settings); renderPayOptions();
  LOCOFF=res.locationsOff||{}; LOCFEE=res.locationsFee||{};
  if(res.eventTypes){ EVTYPES=res.eventTypes; renderEvents(); }
  if(res.schedule){ TIMES=(res.schedule.times&&res.schedule.times.length)?res.schedule.times:DEF_TIMES; HOURS=(res.schedule.hours&&res.schedule.hours.length)?res.schedule.hours:DEF_HOURS; renderSched(); }
  if(res.locations){ LOCS=res.locations; renderLocs(); }
  var ICONS=['🎤','🔊','🎉'], selT=(pkgById(sel.pkg)||{}).title, adQ={}; chosenAddons().forEach(function(x){adQ[x.title]=x.q});
  if(res.packages&&res.packages.length) CONFIG.packages=res.packages.map(function(p,i){p.id=slug(p.title);p.icon=ICONS[i%3];return p});
  if(res.addons) CONFIG.addons=res.addons.map(function(x){x.id=slug(x.title);return x});
  SPECIAL=res.special||[];
  if(sel.date&&!inWindow(fromKey(sel.date))) sel.date=null;   // the booking window changed and the chosen date fell outside it
  var np=CONFIG.packages.filter(function(p){return p.title===selT})[0]; sel.pkg=(np&&np.available!==false)?np.id:null;
  sel.addons={}; (CONFIG.addons||[]).forEach(function(x){ if(x.available&&adQ[x.title]) sel.addons[x.id]=Math.min(adQ[x.title],maxQty(x)); });
  var lost=(sel.date&&stateFor(sel.date))?sel.date:null; if(lost) sel.date=null;
  renderPkgs(); renderAddons(); renderCal(); renderSummary(); renderRem(); renderPay();
  return lost;
}
function interacting(){   // an open quantity list must not be redrawn under the customer's finger
  var a=document.activeElement; return !!(a&&addonBox.contains(a)&&(a.tagName==='SELECT'||a.type==='checkbox'));
}
function commit(res,quiet){
  var lost=applyPayload(res);
  if(lost&&quiet&&!sentOk) showDlg('Your date is no longer open',longDate(lost)+' was just taken. Please pick another date.',lost);
}
addonBox.addEventListener('focusout',function(){ setTimeout(function(){ if(pending&&!interacting()){ var r=pending; pending=null; commit(r,true); } },250); });
function loadDays(quiet,force){
  if(!CONFIG.scriptUrl){ daysState='ok'; renderCal(); return; }
  if(!quiet){ daysState='loading'; renderCal(); }
  fetch(CONFIG.scriptUrl+'?t='+Date.now(),{cache:'no-store'})   // the time stamp keeps phones and networks from showing old dates
    .then(function(r){return r.json()})
    .then(function(res){
      if(!res||!res.ok) throw new Error('bad');
      var wasOk=daysState==='ok'; daysState='ok';
      if(wasOk&&!force&&res.v&&res.v===ver) return;   // same data as on screen: touch nothing
      saveCache(res);
      if(interacting()){ pending=res; return; }
      commit(res,quiet);
    })
    .catch(function(){ if(!quiet){ daysState='failed'; renderCal(); } });
}
/* ---------- pop-up when the owner answers this customer's request (Accepted / Hold / Declined) ---------- */
// Requests sent from this device are remembered here and checked with the same quick check as the calendar.
var REQS='arReqs';
function readReqs(){ try{ var a=JSON.parse(localStorage.getItem(REQS)||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function saveReqs(a){ try{ localStorage.setItem(REQS,JSON.stringify(a)); }catch(e){} }
function trackReq(id){
  if(!id) return;
  var a=readReqs().filter(function(r){return r.id!==id});
  a.push({id:id,date:sel.date,pkg:(pkgById(sel.pkg)||{}).title||'',name:sel.name.trim(),seen:'new'}); saveReqs(a);
}
saveReqs(readReqs().filter(function(r){return r.date>=key(today)}));   // forget requests whose event date has passed
function showStatus(r,st){
  var d=longDate(r.date), who=r.name?'Hi '+r.name+'! ':'', t=r.pkg||'your package', title, msg, again=false;
  if(st==='accepted'){ title='Your booking is confirmed!'; msg=who+'Your '+t+' on '+d+' is CONFIRMED. Thank you for choosing '+CONFIG.name+'!'; }
  else if(st==='hold'){ title='Your date is on hold'; msg=who+'We are holding '+d+' for your '+t+'. We will contact you to lock in your booking.'; }
  else { title='Sorry, we are not available'; msg=who+'We are not available on '+d+' for the '+t+'. You are welcome to book another date.'; again=true; }
  if(dlg.open) dlg.close();
  var kind=st==='accepted'?'ok':st==='hold'?'hold':'bad';
  dlg.replaceChildren(statusView(kind,title,msg,[svRow('cal','Reservation date',d),r.pkg?svRow('box','Package',r.pkg):null],
    h('div',{class:'actions'},h('button',{type:'button',class:'btn sv-btn',autofocus:true,onclick:function(){ dlg.close(); if(again) calBox.scrollIntoView({behavior:'smooth',block:'start'}); }},again?'Choose another date':'OK'))));
  dlg.showModal();
}
function handleStatuses(st){
  if(!st||dlg.open) return;   // one pop-up at a time; the next one shows on the next check
  var a=readReqs(), changed=false, shown=false;
  a.forEach(function(r){
    var s=st[r.id]; if(!s||s===r.seen||shown) return;
    r.seen=s; changed=true;
    if(s==='accepted'||s==='hold'||s==='declined'){ shown=true; showStatus(r,s); }
  });
  if(changed) saveReqs(a);
}
// Cheap "did anything change?" check every few seconds (catches Accepted / Hold edits in the sheet).
var checking=false;
function check(){
  if(!CONFIG.scriptUrl||document.hidden||checking) return;
  checking=true;
  var ids=readReqs().map(function(r){return r.id}).join(',');
  fetch(CONFIG.scriptUrl+'?check=1&t='+Date.now()+(ids?'&ids='+encodeURIComponent(ids):''),{cache:'no-store'}).then(function(r){return r.json()})
    .then(function(res){ if(res&&res.ok){ if(res.v!==ver) loadDays(true); handleStatuses(res.st); } }).catch(function(){})
    .then(function(){ checking=false; });
}
setInterval(check,Math.max(3,CONFIG.checkSeconds||5)*1000);
setInterval(function(){ if(!document.hidden) loadDays(true); },(CONFIG.refreshMinutes||5)*60000);   // safety net: the page is never reloaded
document.addEventListener('visibilitychange',check);
window.addEventListener('pageshow',check);   // coming back with the Back button
window.addEventListener('focus',check);

var boot=readCache();
var savedSent=readSent();   // a request sent a moment ago: bring its "Request sent" page back after a reload
if(boot){ daysState='ok'; applyPayload(boot); loadDays(true); }   // opens with the last known data, then updates silently
else { applyText(null); renderPkgs(); renderAddons(); renderSummary(); renderRem(); renderPay(); loadDays(); }
check();   // also answers a request that was decided while this page was closed
formBox.append(callEl);
if(savedSent){ SENT=savedSent; showDone(); }
})();
