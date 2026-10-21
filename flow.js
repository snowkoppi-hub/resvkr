/* flow.js - runs after app.js. Splash, popups, package page and the 5-page booking flow. */
(function(){
var main=document.querySelector('main'); if(!main) return;
function el(t,a){var e=document.createElement(t);a=a||{};for(var k in a){if(k==='on')for(var v in a.on)e.addEventListener(v,a.on[v]);else if(k==='text')e.textContent=a[k];else e.setAttribute(k,a[k])}
  for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c!=null)e.append(c.nodeType?c:document.createTextNode(c))}return e}
var secs=main.querySelectorAll('section.step'), s1=secs[0], s2=secs[1], s3=secs[2];
var pkgBox=s1.querySelector('.pkgs'), addonBox=s1.lastElementChild, calBox=s2.querySelector('#cal'), calErr=s2.querySelector('#e-date');
var payWrap=s3.nextElementSibling, remWrap=payWrap.nextElementSibling, summary=document.querySelector('dl.summary'), form=document.getElementById('bookform');
s1.classList.add('s-home'); s2.classList.add('s-cal'); s3.classList.add('s-form'); payWrap.classList.add('s-pay'); remWrap.classList.add('s-pay');
var slug=function(t){return String(t).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')};
var cutoff=CONFIG.cutoff||'3:00 PM';
var appDlg=document.querySelector('dialog.dlg'), doneBox=document.getElementById('donebox');
var rm=form.querySelector('.loc-rm'); if(rm) rm.click();   // no pin question on the booking pages; it is offered after the request is sent
function flash(e){e.classList.remove('flash');void e.offsetWidth;e.classList.add('flash')}

/* announcement */
var ann=el('dialog',{class:'ann'},
  el('button',{class:'ann-x','aria-label':'Close',text:'×',on:{click:function(){ann.close()}}}),
  el('h3',{text:'Service Announcement'}),
  el('p',{},el('b',{text:'Cancellation cut-off: '}),'To get a full refund of your reservation fee, cancel on or before '+cutoff+' on the day before your rental date. Cancellations after that, including on the rental date, are not refundable. See Section 2.4 of the Rental Agreement.'),
  el('p',{},el('b',{text:'Data privacy: '}),'We collect your name, mobile number and venue address only to process your booking, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).'),
  el('label',{class:'ann-ck'},el('input',{type:'checkbox',id:'ann-ck'}),el('span',{text:'I understand the cancellation cut-off and the data privacy notice.'})),
  el('button',{class:'btn',id:'ann-go',text:'Submit',disabled:'',on:{click:function(){ann.close()}}}));
document.body.append(ann);
ann.querySelector('#ann-ck').addEventListener('change',function(e){ann.querySelector('#ann-go').disabled=!e.target.checked});
function showAnn(){ if(!sessionStorage.getItem('annSeen')){ ann.showModal(); sessionStorage.setItem('annSeen','1') } }
var loc=el('dialog',{class:'ann loc'},
  el('div',{class:'loc-head'},el('img',{src:'images/logo.png',alt:'AARF'})),
  el('h3',{text:'Allow location?'}),
  el('p',{text:'For better use of this webpage. Sharing your location lets us pin your event venue and work out delivery distance faster. You can skip this and type your address instead.'}),
  el('button',{class:'btn',text:'Allow location',on:{click:function(){loc.close();try{navigator.geolocation.getCurrentPosition(function(){},function(){},{timeout:8000})}catch(x){}}}}),
  el('button',{class:'btn ghost',text:'Not now',on:{click:function(){loc.close()}}}));
loc.addEventListener('close',showAnn); document.body.append(loc);
setTimeout(function(){
  var ask=function(){ if(sessionStorage.getItem('locAsked')||!navigator.geolocation||!window.isSecureContext) return showAnn(); sessionStorage.setItem('locAsked','1'); loc.showModal() };
  try{ navigator.permissions.query({name:'geolocation'}).then(function(r){ r.state==='prompt'?ask():showAnn() },ask) }catch(x){ ask() } },document.getElementById('splash')?1700:300);

/* app bar, package page, date page, bars */
var cur=-1, allow=false, total=el('b',{text:'₱0'}), car=el('div',{class:'car'}), dots=el('div',{class:'dots'}), pTitle=el('h2'), pPrice=el('div',{class:'pp'}), pNote=el('div',{class:'pnote'}), pList=el('ul');
var raf=0; car.addEventListener('scroll',function(){ if(raf) return; raf=requestAnimationFrame(function(){raf=0;var i=Math.round(car.scrollLeft/car.clientWidth);[].forEach.call(dots.children,function(d,j){d.className=j===i?'on':''})}) },{passive:true});
var calHead=el('h3',{text:'When is your event?'}), chip=el('div',{class:'chip'});
var reserve=el('button',{type:'button',class:'btn',text:'Next',on:{click:function(){
  if(document.body.dataset.step==='pkg') return go('date');
  if(!dateChosen()){calErr.textContent='Please choose a date.';flash(calBox);calBox.scrollIntoView({behavior:'smooth',block:'center'});return}
  go('details')}}});
var pg=el('section',{class:'step page-pkg'},car,dots,el('div',{class:'card p-info'},pTitle,pPrice,pNote,pList),el('div',{class:'card p-add'},addonBox));
var pgDate=el('section',{class:'step page-date'},el('div',{class:'card'},calHead,chip,calBox,calErr));
var bar=el('div',{class:'bar'},el('div',{},el('small',{text:'Total'}),total),reserve);
var abT=el('b'), abN=el('span',{class:'ab-n'}), appbar=el('div',{class:'appbar'},el('button',{class:'ab-back','aria-label':'Back',text:'←',on:{click:function(){history.back()}}}),abT,abN,el('i',{class:'ab-p'}));
var statusPg=el('section',{class:'step s-status'});
var again=el('button',{type:'button',class:'btn',text:'Book another package',on:{click:function(){startOver()}}});
var sbar=el('div',{class:'sbar'},again);
main.append(statusPg); document.body.append(sbar); document.body.prepend(appbar);
s1.after(pg); pg.after(pgDate); document.body.append(bar);
function cell(name){var dts=summary.querySelectorAll('dt');for(var i=0;i<dts.length;i++)if(dts[i].textContent===name)return dts[i].nextElementSibling.textContent;return ''}
function dateChosen(){var d=cell('Date');return d&&d!=='Not chosen yet'}
function showTotal(){var t=cell('Total rental fee');total.textContent=t?t.replace(/ \(.*/,''):'₱0';chip.textContent=dateChosen()?'📅 '+cell('Date'):'No date selected yet';chip.classList.toggle('ok',!!dateChosen())}
new MutationObserver(showTotal).observe(summary,{childList:true});

function openPkg(i){
  var p=CONFIG.packages[i]; cur=i; allow=true; pkgBox.children[i].click(); allow=false;   // selects the package in the existing app
  var base=p.image||'images/'+slug(p.title)+'.jpg', ext=base.replace(/\.(jpe?g|png|webp)$/i,'');
  car.replaceChildren(); dots.replaceChildren(); car.scrollLeft=0;
  [base,ext+'-2.jpg',ext+'-3.jpg'].forEach(function(s,j){
    var im=el('img',{src:s,alt:p.title+' photo '+(j+1),decoding:'async',loading:j?'lazy':'eager',width:'1200',height:'600'});
    im.onerror=function(){im.remove();dots.lastChild&&dots.lastChild.remove()};
    car.append(im);dots.append(el('i',{class:j?'':'on'}))});
  pTitle.textContent=p.title;
  pPrice.replaceChildren(p.regular?el('s',{text:'₱'+p.regular+' '}):'', '₱'+p.price); pNote.textContent=p.note||'';
  pList.replaceChildren.apply(pList,(p.items||[]).map(function(x){return el('li',{text:x})}));
  showTotal(); go('pkg');
}

/* add-on pictures: drop images/addon-<name>.jpg or set CONFIG.addonImages = {id:'path'} */
function decorateAddons(){ addonBox.querySelectorAll('table.addons tbody tr').forEach(function(tr){
  if(tr.dataset.ad) return; tr.dataset.ad='1';
  var cb=tr.querySelector('input[type=checkbox]'), id=cb?cb.id.slice(3):'', a=(CONFIG.addons||[]).filter(function(x){return x.id===id})[0]||{};
  var info=tr.children[1], wrap=el('div',{class:'ad-tx'}); while(info.firstChild) wrap.append(info.firstChild);
  var ph=el('span',{class:'ad-img'},el('span',{text:a.icon||'🎁'})), im=new Image();
  im.onload=function(){ph.replaceChildren(im)}; im.alt=''; im.decoding='async'; im.src=a.image||(CONFIG.addonImages||{})[id]||'images/addon-'+id+'.jpg';
  info.append(ph,wrap)})}
new MutationObserver(decorateAddons).observe(addonBox,{childList:true}); decorateAddons();

/* tapping a package card opens its page (cards show only the first 4 items; CSS) */
pkgBox.addEventListener('click',function(e){
  if(allow) return;
  var b=e.target.closest('.pkg'); if(!b||b.disabled) return;
  var i=[].indexOf.call(pkgBox.children,b); e.stopImmediatePropagation(); e.preventDefault();
  openPkg(i);
},true);

/* steps: home > pkg > date > details > pay (> sent) */
var steps=['home','pkg','date','details','pay'], prevN=0;
var grps=form.querySelectorAll('.grp'); grps[grps.length-1].classList.add('g-last');
form.querySelector('label[for=f-pay]').classList.add('f-pay');
var next=el('div',{class:'nextrow'},el('button',{type:'button',class:'btn',text:'Next',on:{click:function(){if(detailsOk())go('pay')}}}));
form.querySelector('.form-main').append(next);
var sb=document.getElementById('send');
function relabel(){ if(sb&&sb.textContent==='Send booking request') sb.textContent='Book Now' } relabel();
if(sb) new MutationObserver(relabel).observe(sb,{childList:true,characterData:true,subtree:true});
[].forEach.call(form.querySelectorAll('p.hint'),function(p){ if(/location/i.test(p.textContent)) p.remove() });   // old "your location will be shared" note
/* terms + privacy tick boxes with "Read this" roll-down (text lives in legal.js) */
var LG=window.LEGAL||{};
function legalBody(t){ var d=el('div',{class:'lg-body',hidden:''}), ul=null; String(t||'').split('\n').forEach(function(l){ l=l.trim(); if(!l) return;
  if(l.slice(0,3)==='## '){ ul=null; d.append(el('h4',{text:l.slice(3)})) }
  else if(l.charAt(0)==='•'){ if(!ul){ul=el('ul');d.append(ul)} ul.append(el('li',{text:l.slice(1).trim()})) }
  else { ul=null; d.append(el('p',{text:l})) } }); return d }
function legalRow(id,label,txt){
  var ck=el('input',{type:'checkbox',id:id}), body=legalBody(txt), tg=el('button',{type:'button',class:'lg-tg','aria-expanded':'false',text:'Read this ▾',on:{click:function(){var o=body.hidden; body.hidden=!o; tg.setAttribute('aria-expanded',String(o)); tg.textContent=o?'Hide ▴':'Read this ▾'}}});
  return el('div',{class:'lg'},el('div',{class:'lg-row'},el('label',{class:'lg-ck'},ck,el('span',{},'I agree to the ',el('b',{text:label}))),tg),body)}
var legalBox=el('div',{class:'legal'},legalRow('lg-terms','Terms of Service',LG.terms),legalRow('lg-priv','Data Privacy Policy',LG.privacy),el('p',{class:'err',id:'e-legal',role:'alert'}));
form.querySelector('.form-main').append(legalBox);
function legalOk(){ var t=document.getElementById('lg-terms'), p=document.getElementById('lg-priv'), bad=!t.checked?t:!p.checked?p:null;
  document.getElementById('e-legal').textContent=bad?'Please tick both boxes to continue.':'';
  if(bad){ var row=bad.closest('.lg-ck'); flash(row); row.scrollIntoView({block:'center',behavior:'smooth'}); bad.focus({preventScroll:true}); return false } return true }
function resetLegal(){ ['lg-terms','lg-priv'].forEach(function(id){document.getElementById(id).checked=false}); document.getElementById('e-legal').textContent='' }
document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('#send'); if(b&&!legalOk()){e.preventDefault();e.stopImmediatePropagation()} },true);
document.addEventListener('submit',function(e){ if(e.target!==form) return;
  if(document.body.dataset.step==='details'){e.preventDefault();e.stopImmediatePropagation(); if(detailsOk()) go('pay'); return}   // Enter key on the details page = Next
  if(!legalOk()){e.preventDefault();e.stopImmediatePropagation()} },true);

function detailsOk(){
  var f=function(id){return document.getElementById(id)}, bad=null, m={
    'f-name':['e-name','Please enter your name.',function(v){return v.trim().length>1}],
    'f-phone':['e-phone','Please enter your 11-digit mobile number.',function(v){return v.replace(/\D/g,'').length>=11}],
    'f-city':['e-city','Please select a city.',function(v){return v}],
    'f-brgy':['e-brgy','Please select a barangay.',function(v){return v}]};
  Object.keys(m).forEach(function(id){var ok=m[id][2](f(id).value);f(m[id][0]).textContent=ok?'':m[id][1];if(!ok&&!bad)bad=f(id)});
  if(!form.querySelector('.events input:checked')){document.getElementById('e-events').textContent='Please tick at least one type of event.';bad=bad||form.querySelector('.events input')}
  if(bad){flash(bad);bad.scrollIntoView({block:'center',behavior:'smooth'});bad.focus({preventScroll:true});return false}return true}
function view(s,t,p){document.body.dataset.step=s;document.body.dataset.dir='fwd';abT.textContent=t;abN.textContent='';appbar.style.setProperty('--p',p+'%');
  [s3,statusPg].forEach(function(e){e.style.animation='none';void e.offsetWidth;e.style.animation=''});window.scrollTo(0,0)}
function startOver(){
  var ag=[].filter.call(doneBox.querySelectorAll('button'),function(b){return b.textContent==='Book another package'})[0];
  if(!doneBox.hidden&&ag) ag.click(); cur=-1; resetLegal(); statusPg.replaceChildren(); go('home')}
function go(s,fromHash){
  if(!doneBox.hidden&&s!=='home') return view('sent','Request sent',100);
  var k=steps.indexOf(s); if(k>1&&cur<0) s='home'; else if(k>2&&!dateChosen()) s='date';
  if(s==='pkg'&&cur<0) s='home';
  reserve.textContent='Next';
  document.body.dataset.step=s;
  var n=steps.indexOf(s); document.body.dataset.dir=n<prevN?'back':'fwd'; prevN=n;
  abT.textContent={pkg:CONFIG.packages[cur]&&CONFIG.packages[cur].title,date:'Choose date',details:'Your details',pay:'Payment'}[s]||''; abN.textContent=n>0?'Step '+(n+1)+' of 5':''; appbar.style.setProperty('--p',(n*25)+'%');
  if(s==='details'||s==='pay'){s3.style.animation='none';void s3.offsetWidth;s3.style.animation=''}
  if(!fromHash&&location.hash!=='#'+s) location.hash=s;
  window.scrollTo(0,0)}
window.addEventListener('hashchange',function(){var h=location.hash.slice(1);go(steps.indexOf(h)<0?'home':h,true)});

/* after the request is sent: minimal screen = summary, tick box for pin, Messenger button */
function tidyDone(){
  if(doneBox.hidden) return;
  if(document.body.dataset.step!=='sent') view('sent','Request sent',100);
  var bs=[].slice.call(doneBox.querySelectorAll('button')), c=doneBox.querySelectorAll('.contacts');
  bs.forEach(function(b){ if(b.textContent==='Book another package') b.classList.add('again-bar'); else if(/^Copy|^Copied/.test(b.textContent)) b.classList.add('lnk') });
  if(c[1]) c[1].classList.add('ct-extra');
  var first=c[0]; if(!first||!navigator.geolocation) return;
  var mb=first.parentNode, pinBtn=mb.children[3], box=doneBox.querySelector('.pin-ck');
  if(pinBtn) pinBtn.classList.add('pin-hide');
  if(!box){ box=el('label',{class:'pin-ck'},el('input',{type:'checkbox'}),el('span',{text:'Share my pin location'}),el('small',{text:'So we can find your venue easily.'}));
    box.querySelector('input').addEventListener('change',function(e){ var pb=doneBox.querySelector('.pin-hide'); if(e.target.checked&&pb) pb.click() });
    mb.before(box) }
  var inp=box.querySelector('input'), sm=box.querySelector('small');
  var put=function(n,v){ if(n.textContent!==v) n.textContent=v };   // only write when it changed, or the observer below would re-trigger itself forever
  if(!pinBtn){ inp.checked=true; inp.disabled=true; put(sm,'Pin added to your Messenger message.') }
  else { var t=pinBtn.textContent, busy=/^Getting/.test(t), idle=t.charCodeAt(0)===0xD83D; inp.disabled=busy; if(!busy) inp.checked=false;
    put(sm,busy?'Getting your location...':idle?'So we can find your venue easily.':t) }
}
new MutationObserver(tidyDone).observe(doneBox,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
new MutationObserver(function(){ if(doneBox.hidden&&document.body.dataset.step==='sent'){cur=-1;resetLegal();go('home')} }).observe(doneBox,{attributes:true,attributeFilter:['hidden']});
/* owner answered (Accepted / On hold / Declined): show it as its own page */
if(appDlg) new MutationObserver(function(){
  if(!appDlg.open) return; var sv=appDlg.querySelector('.sv.ok,.sv.hold,.sv.bad'); if(!sv) return;
  var a=sv.querySelector('.actions'); if(a) a.remove(); statusPg.replaceChildren(sv); appDlg.close();
  view('status',sv.classList.contains('ok')?'Booking confirmed':sv.classList.contains('hold')?'Date on hold':'Request declined',100);
}).observe(appDlg,{attributes:true,attributeFilter:['open']});

/* phone-friendly form helpers + faster repeat visits (service worker) */
(function(){ var ph=document.getElementById('f-phone'); if(ph){ph.setAttribute('inputmode','tel');ph.setAttribute('autocomplete','tel');ph.setAttribute('enterkeyhint','next')}
  var nm=document.getElementById('f-name'); if(nm) nm.setAttribute('enterkeyhint','next');
  if('serviceWorker' in navigator && location.protocol==='https:') window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})}) })();

if(location.hash) history.replaceState(null,'',location.pathname);
if(!doneBox.hidden) tidyDone(); else go('home',true);   // a request sent a moment ago stays on its "Request sent" page after a reload
})();
