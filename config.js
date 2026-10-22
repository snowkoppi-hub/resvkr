/* =====================================================================
   SETTINGS: edit this part only
   ===================================================================== */
var CONFIG = {
  name: 'AARF Karaoke & Event Rentals',
  logo: 'images/logo.png',
  // Silent refresh (the page never reloads or blinks; only the parts that changed are redrawn).
  // checkSeconds: how often the page asks the Google Sheet "did anything change?" (5 = your sheet edits show up in a few seconds).
  // refreshMinutes: a full safety re-download of the data, also silent.
  checkSeconds: 10, refreshMinutes: 5,
  // Booking window (how many days ahead customers can book) is in the Google Sheet > Settings:
  //   "Earliest booking date" and "Latest booking date" (example: 30 = only the next 30 days are open).
  // GCash number: a fallback. The Settings sheet (GCash number) is used once it has a value.
  gcash: {number:'09997114240', name:''},
  events: ['Birthday','Debut','Reunion','Wedding','Christening','Anniversary','Graduation','School Events','Outing','Fiesta','Company party','Other'],
  addons: [
    {id:'sm58', title:'Shure SM58 Professional Dynamic Vocal Microphone', note:'', qty:1, price:'150', regular:'200', available:true},
    {id:'tables', title:'Tables', note:'Rental tables for your guests', available:false},
    {id:'chairs', title:'Chairs', note:'Rental chairs for your guests', available:false}
  ],
  // Reminders shown to customers. Delivery: free within freeKm, then perKm for every extra kilometer.
  rules: {deposit:1000, freeKm:5, perKm:30},
  // Cities and barangays for the venue address. Fallback only: the Google Sheet "Locations" tab is used once it has rows.
  locations: {
    'Bansud': ['Alcadesma','Bato','Corazon','Malo','Manihala','Pag-asa','Poblacion','Proper Bansud','Rosacara','Salcedo','Sumagui','Proper Tiguisan','Villa Pag-Asa'],
    'Bongabong': ['Bagumbayan I','Labasan','Malitbog','Ipil'],
    'Gloria': ['Banus','Agsalin','Maragooc']
  },
  // Paste your Google Apps Script Web App URL here (ends with /exec)
  scriptUrl: 'https://script.google.com/macros/s/AKfycbx4qk8DEHL0CR1vF2__wtkrC5SJS9hfbeRAQ27hrKU0r4jbNG4HOEfrxiehmleONl4mMw/exec',
  // Your Facebook page username, for the optional Messenger button (example: 'myvideokepage'). Leave '' to hide.
  messenger: '1368190183045322',
  // Facebook page opened when the logo is tapped. Paste your full page link (example: 'https://www.facebook.com/yourpage'). Leave '' to use the Messenger page above.
  facebook: 'https://www.facebook.com/profile.php?id=61595115668773',
  // Phone number to show to customers. Leave '' to hide.
  phone: '0999 711 4240',
  // Numbers for the Viber and WhatsApp buttons (same number as your phone by default). Leave '' to hide a button.
  viber: '09997114240',
  whatsapp: '09997114240',
  // Cancellation cut-off shown in the Service Announcement. It must match Section 2.4 of the Agreement.
  cutoff: '3:00 PM',
  packages: [
    {id:'standard', icon:'🎤', image:'', regular:'1,500', title:'Standard Package', price:'1,200', note:'per event, up to 22 hrs',
     items:['Sony ULT Tower 7 420W Speaker','Xiaomi 32 inch LED TV','Platinum XL SD with 23k Songs','Platinum jukebox keypad','Behringer wired mic & 1 Platinum wired mic','Song book 23k songs']},
    {id:'pro', icon:'🔊', image:'', regular:'1,800', title:'Pro Package', price:'1,500', note:'per event, up to 22 hrs',
     items:['JBL Partybox 710 800W Speaker','Xiaomi 32 inch LED TV','Platinum XL SD with 23k Songs','Platinum jukebox keypad','JBL Partybox Wireless Mic 2','Song book 23k songs','1 High Chair']},
    {id:'premium', icon:'🎉', image:'', regular:'2,300', title:'Premium Package', price:'1,800', note:'per event, up to 22 hrs',
     items:['JBL Partybox 720 800W Speaker with built-in Battery','Xiaomi 43 inch QLED TV 4k Display','Platinum Piano 4k - 4k Output Display','JBL Easysing Wireless Mic with AI','Song book 23k songs','2 High bar Chair']}
  ]
};
