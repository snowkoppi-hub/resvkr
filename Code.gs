/**
 * AARF Karaoke & Event Rentals - booking backend (Google Apps Script)
 *
 * Sheets:
 *   "Requests" -> every booking request from the website. You change the Status
 *                 column (B) with the dropdown: New / Accepted / Hold / Declined.
 *   "Dates"    -> the dates the website shows as booked or hold.
 *                 Rows added by this script say "request" in column C.
 *                 Rows you type yourself are never touched by the script.
 *                 Status can be: booked, hold, or unavailable (a date you are closed).
 *                 Column D is the package. Each package is booked separately, so Standard
 *                 can be booked while Pro and Premium are still open. Leave D blank to
 *                 block ALL packages (for example a date you are closed).
 *
 * What happens when you change Status in "Requests":
 *   Accepted -> the date becomes BOOKED on the website, and a reply message is written
 *   Hold     -> the date becomes ON HOLD on the website, and a reply message is written
 *   Declined -> the date is freed (if nothing else uses it), and a reply message is written
 *   New      -> the date is freed (if nothing else uses it), and the reply is cleared
 *
 *   "Monitoring"          -> one row per date: how many of each package / add-on are REMAINING and how many are BOOKED.
 *                            Rebuilt automatically. Do not type in it.
 *   "Transaction History" -> one row per ACCEPTED request. You type the Payment Received (partial or full);
 *                            Balance and Status (Success / Remaining Bal.) are automatic.
 *
 * Run setup() once from the editor (and again after pasting a new version).
 */

// Put your email here to get a message for every new request. Leave '' to turn off.
const NOTIFY_EMAIL = 'aarfkaraoke.events@gmail.com';
const BUSINESS = 'AARF Karaoke & Event Rentals';

const DATES_SHEET = 'Dates';
const REQUESTS_SHEET = 'Requests';
const STATUSES = ['New', 'Accepted', 'Hold', 'Declined'];
// Added to the confirmation reply.
const REMINDER = 'A ₱1,000 security deposit is collected upon delivery. It is refundable upon pick up, as long as there is no damage and no missing equipment. Delivery is free within 5 km, then ₱30 for every additional km.';
const PACKAGES_SHEET = 'Packages';
const ADDONS_SHEET = 'Add-ons';
const SETTINGS_SHEET = 'Settings';
const SPECIAL_SHEET = 'Special Prices';
const AVAIL_SHEET = 'Availability by Date';
const LOCATIONS_SHEET = 'Locations';
const MONITOR_SHEET = 'Monitoring';
const TX_SHEET = 'Transaction History';
const SITE_TZ = 'Asia/Manila'; // used to decide what "today" is for the booking window

// Requests columns (1-based)
const C = { RECEIVED: 1, STATUS: 2, NAME: 3, PHONE: 4, PKG: 5, PRICE: 6, DATE: 7, TIME: 8, HOURS: 9, VENUE: 10, DELIVERY: 11, NOTES: 12, REPLY: 13, SMS: 14, EVENT: 15, ADDONS: 16, TOTAL: 17, LOC: 18, ID: 19, PAY: 23 };
// Extra Requests headers (columns S to W). Existing headers in those columns are never overwritten.
const EXTRA_HEADS = ['Request ID (auto, do not edit)', 'Tap to WhatsApp', 'Messenger ID (auto)', 'Messenger message (auto)', 'Payment method (customer)'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupContent(ss); // the Packages and Add-ons sheets you can edit
  setupSpecial(ss); // the Special Prices sheet (holiday or date-specific rates)
  setupAvailability(ss); // the Availability by Date sheet (turn packages / add-ons off on certain dates)
  setupSettings(ss); // the Settings sheet (header text)
  setupTransactions(ss); // the Transaction History sheet (payments)
  setupLocations(ss); // the Locations sheet (city and barangay dropdowns)

  let d = ss.getSheetByName(DATES_SHEET);
  if (!d) d = ss.insertSheet(DATES_SHEET);
  d.getRange(1, 1, 1, 4).setValues([['Date (YYYY-MM-DD)', 'Status (booked, hold or unavailable)', 'Source (auto)', 'Package (blank = all packages)']]);
  d.getRange(2, 4, 1000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(PACKAGES_SHEET).getRange('B2:B30'), true).setAllowInvalid(false).build());
  d.getRange('A:A').setNumberFormat('@');
  d.setFrozenRows(1);
  d.getRange(2, 2, 1000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['booked', 'hold', 'unavailable'], true).setAllowInvalid(false).build());

  let r = ss.getSheetByName(REQUESTS_SHEET);
  if (!r) r = ss.insertSheet(REQUESTS_SHEET);
  r.getRange(1, 1, 1, 18).setValues([['Received', 'Status', 'Name', 'Mobile', 'Package', 'Price', 'Event date', 'Start', 'Hours', 'Venue', 'Delivery', 'Notes', 'Reply to send', 'Tap to text', 'Event type', 'Add-ons', 'Total', 'Location (map link)']]);
  EXTRA_HEADS.forEach(function (t, i) { const cell = r.getRange(1, C.ID + i); if (!String(cell.getValue()).trim()) cell.setValue(t); });
  r.getRange('G:H').setNumberFormat('@'); // Event date + Start stay plain text so Sheets does not turn "8:00 AM" into a time value
  r.setFrozenRows(1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  r.getRange(2, C.STATUS, 1000, 1).setDataValidation(rule);
  r.setColumnWidth(C.REPLY, 380);
  clearCache();
  rebuildMonitoring(); // the Monitoring sheet (remaining / booked per date)
  // Keep the Monitoring sheet's dates current every night (one trigger only)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rebuildMonitoring') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rebuildMonitoring').timeBased().everyDays(1).atHour(0).inTimezone(SITE_TZ).create();
}

/* ---------------- website: load dates ---------------- */
// The page asks "did anything change?" every few seconds. The answer is kept in a short-lived cache so those
// checks are instant, and the cache is cleared the moment you edit the sheet, so changes still show within seconds.
const CACHE_KEY = 'site-payload', CACHE_SECONDS = 60;
function clearCache() { try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (err) {} }

// { REQUEST_ID: 'accepted' | 'hold' | 'declined' | 'new' } for the ids a customer's device sends (a random 8-character code, up to 20)
function statusOf(raw) {
  const want = {}, out = {};
  String(raw).split(',').slice(0, 20).forEach(function (x) { x = x.trim().toUpperCase(); if (/^[A-Z0-9]{4,12}$/.test(x)) want[x] = true; });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, C.ID).getValues().forEach(function (r) {
    const id = String(r[C.ID - 1]).trim().toUpperCase();
    if (want[id]) out[id] = String(r[C.STATUS - 1]).trim().toLowerCase();
  });
  return out;
}

function doGet(e) {
  if (e && e.parameter && e.parameter.admin) { // owner dashboard (admin.html): needs the ADMIN_KEY from Script properties
    const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
    if (!key || String(e.parameter.key || '') !== key) { Utilities.sleep(800); return json({ ok: false, error: 'auth' }); }
    return json(adminData());
  }
  const cache = CacheService.getScriptCache();
  let payload = null;
  try { const hit = cache.get(CACHE_KEY); if (hit) payload = JSON.parse(hit); } catch (err) {}
  if (!payload) {
    const st = loadState(), settings = getSettings(), special = getSpecialPrices();
    payload = { ok: true, days: st.days, packages: st.packages, addons: st.addons, settings: settings, used: st.used, pused: st.pused, special: special, off: st.off, locations: getLocations(), locationsOff: getLocationsOff() };
    payload.v = hash(JSON.stringify(payload));
    try { cache.put(CACHE_KEY, JSON.stringify(payload), CACHE_SECONDS); } catch (err) {}
  }
  if (e && e.parameter && e.parameter.check) { // cheap "did anything change?" check, plus the status of this customer's own requests
    const out = { ok: true, v: payload.v };
    if (e.parameter.ids) out.st = statusOf(e.parameter.ids);
    return json(out);
  }
  return json(payload);
}

/* ---------------- owner dashboard data (read only, needs ADMIN_KEY) ---------------- */
function adminData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), reqs = [], tx = [];
  const t = function (v) { return String(v == null ? '' : v).trim(); };
  const rs = ss.getSheetByName(REQUESTS_SHEET);
  if (rs && rs.getLastRow() > 1) {
    const n = Math.min(rs.getLastRow() - 1, 600), start = rs.getLastRow() - n + 1;
    rs.getRange(start, 1, n, C.PAY).getValues().forEach(function (v) {
      if (!t(v[C.NAME - 1])) return;
      reqs.push({ at: v[0] instanceof Date ? v[0].toISOString() : '', status: t(v[C.STATUS - 1]) || 'New', name: t(v[C.NAME - 1]), phone: t(v[C.PHONE - 1]),
        pkg: t(v[C.PKG - 1]), price: t(v[C.PRICE - 1]), date: normDate(v[C.DATE - 1]), time: timeText(v[C.TIME - 1]), hours: t(v[C.HOURS - 1]),
        venue: t(v[C.VENUE - 1]), delivery: t(v[C.DELIVERY - 1]), notes: t(v[C.NOTES - 1]), reply: t(v[C.REPLY - 1]), event: t(v[C.EVENT - 1]),
        addons: t(v[C.ADDONS - 1]), total: t(v[C.TOTAL - 1]), loc: t(v[C.LOC - 1]), id: t(v[C.ID - 1]), pay: t(v[C.PAY - 1]) });
    });
  }
  const ts = ss.getSheetByName(TX_SHEET);
  if (ts && ts.getLastRow() > 1) {
    const n = Math.min(ts.getLastRow() - 1, 600);
    ts.getRange(2, 1, n, TX.ID).getValues().forEach(function (v) {
      if (!t(v[TX.NAME - 1])) return;
      tx.push({ at: v[0] instanceof Date ? v[0].toISOString() : '', name: t(v[TX.NAME - 1]), pkg: t(v[TX.PKG - 1]), total: t(v[TX.TOTAL - 1]), paid: t(v[TX.PAID - 1]),
        bal: t(v[TX.BAL - 1]), method: t(v[TX.METHOD - 1]), status: t(v[TX.STATUS - 1]) });
    });
  }
  return { ok: true, now: Utilities.formatDate(new Date(), SITE_TZ, 'yyyy-MM-dd'), reqs: reqs, tx: tx };
}

/* ---------------- Packages and Add-ons sheets (you edit these) ---------------- */
function setupContent(ss) {
  let p = ss.getSheetByName(PACKAGES_SHEET);
  if (!p) p = ss.insertSheet(PACKAGES_SHEET);
  p.getRange(1, 1, 1, 9).setValues([['Show (Yes/No)', 'Package name', 'Promo price', 'Regular price', 'Note under the price', 'Image (optional: file in images folder, web link, or Google Drive link)', 'Included items (one per line: Alt+Enter for a new line)', 'Available (Yes/No)', 'Quantity available (how many customers can pick)']]);
  p.setFrozenRows(1);
  if (p.getLastRow() < 2) {
    p.getRange(2, 1, 3, 9).setValues([
      ['Yes', 'Standard Package', 1200, 1500, 'per event, up to 22 hrs', '', ['Sony ULT Tower 7 420W Speaker', 'Xiaomi 32 inch LED TV', 'Platinum XL SD with 23k Songs', 'Platinum jukebox keypad', 'Behringer wired mic & 1 Platinum wired mic', 'Song book 23k songs'].join('\n'), 'Yes', 1],
      ['Yes', 'Pro Package', 1500, 1800, 'per event, up to 22 hrs', '', ['JBL Partybox 710 800W Speaker', 'Xiaomi 32 inch LED TV', 'Platinum XL SD with 23k Songs', 'Platinum jukebox keypad', 'JBL Partybox Wireless Mic 2', 'Song book 23k songs', '1 High Chair'].join('\n'), 'Yes', 1],
      ['Yes', 'Premium Package', 1800, 2300, 'per event, up to 22 hrs', '', ['JBL Partybox 720 800W Speaker with built-in Battery', 'Xiaomi 43 inch QLED TV 4k Display', 'Platinum Piano 4k - 4k Output Display', 'JBL Easysing Wireless Mic with AI', 'Song book 23k songs', '2 High bar Chair'].join('\n'), 'Yes', 1]
    ]);
  }
  p.getRange('C:D').setNumberFormat('#,##0');
  p.getRange('G:G').setWrap(true);
  p.setColumnWidth(2, 160); p.setColumnWidth(6, 220); p.setColumnWidth(7, 380);
  p.getRange(2, 1, 30, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  p.getRange(2, 8, 30, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  p.setColumnWidth(8, 130); p.setColumnWidth(9, 190);
  p.getRange('I:I').setNumberFormat('0');

  let a = ss.getSheetByName(ADDONS_SHEET);
  if (!a) a = ss.insertSheet(ADDONS_SHEET);
  a.getRange(1, 1, 1, 7).setValues([['Show (Yes/No)', 'Add-on name', 'Promo price', 'Regular price', 'Note', 'Available (Yes/No)', 'Quantity available (how many customers can pick)']]);
  a.setFrozenRows(1);
  if (a.getLastRow() < 2) {
    a.getRange(2, 1, 3, 7).setValues([
      ['Yes', 'Shure SM58 Professional Dynamic Vocal Microphone', 150, 200, '', 'Yes', 1],
      ['Yes', 'Tables', '', '', 'Rental tables for your guests', 'No', ''],
      ['Yes', 'Chairs', '', '', 'Rental chairs for your guests', 'No', '']
    ]);
  }
  a.getRange('C:D').setNumberFormat('#,##0');
  a.setColumnWidth(2, 300); a.setColumnWidth(5, 220); a.setColumnWidth(7, 190);
  a.getRange('G:G').setNumberFormat('0');
  a.getRange(2, 1, 30, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  a.getRange(2, 6, 30, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
}

// Settings sheet: [key used by the website, label shown in the sheet, starting text, help text]
const SETTINGS_ROWS = [
  ['eyebrow', 'Header small text', 'Reserve Now!', 'The small gold text above the title.'],
  ['title', 'Header title', BUSINESS, 'The big title at the top of the page.'],
  ['subtitle', 'Header description', 'Videoke sets for birthdays, debuts, reunions and fiestas. Pick a package and date, then send your request.', 'The sentence under the title.'],
  ['image', 'Header background image', '', 'Optional. A web link, a Google Drive share link (set sharing to "Anyone with the link"), or a file in the images folder, like images/header.jpg. Leave blank for the default design.'],
  ['color', 'Header background color', '', 'Optional. A color code like #1b1740. Shown when there is no image, and behind it.'],
  ['dark', 'Image darkness (0-90)', '55', 'How dark the shade over the image is, so the white text stays easy to read. 0 = no shade, 90 = very dark.'],
  ['step1', 'Step 1 title', 'Pick a package', 'The heading of the packages section.'],
  ['step1note', 'Step 1 note', 'All prices shown are promo prices.', 'The line under the Step 1 heading.'],
  ['addonsTitle', 'Add-ons title', 'Add-ons', 'The heading above the add-ons table.'],
  ['addonsNote', 'Add-ons note', 'Tick the add-ons you want, then choose how many. It is included in your total rental fee.', 'The line under the add-ons heading.'],
  ['minDays', 'Earliest booking date (days from today)', '0', 'How soon customers can book. 0 = from today. Example: 3 = the earliest date is 3 days from today. Dates before that are greyed out.'],
  ['maxDays', 'Latest booking date (days from today)', '', 'How far ahead customers can book. Example: 30 = only the next 30 days are open. Blank = no limit (the calendar shows about 12 months).'],
  ['step2', 'Step 2 title', 'Pick a date', 'The heading of the calendar section.'],
  ['calNote', 'Calendar note', 'Each date shows how many packages are left. Pick a package above to check yours.', 'The line above the calendar, shown before a package is chosen.'],
  ['step3', 'Step 3 title', 'Your details and request', 'The heading of the form section.'],
  ['reqTitle', 'Your request title', 'Your request', 'The heading above the request summary.'],
  ['sendBtn', 'Send button text', 'Send booking request', 'The text on the send button.'],
  ['locNote', 'Location note', 'By sending this request, you allow your location to be shared with {name}.', 'The line under the send button. {name} becomes the business name from config.js.'],
  ['gcashTitle', 'GCash title', 'Pay with GCash', 'The heading of the payment section.'],
  ['gcashNote', 'GCash note', 'Already confirmed? Pay here. The reservation fee is included in your total rental fee.', 'The first line in the payment section.'],
  ['gcashHint', 'GCash hint', 'Open GCash, tap Send Money, and enter the exact amount of your total rental fee.', 'The line under the GCash number.'],
  ['remTitle', 'Reminder title', 'Reminder', 'The heading of the reminder box.'],
  ['rem1', 'Reminder 1', 'The reservation fee is included in your total rental fee. It is not an extra charge.', 'First reminder line. Type - to hide it.'],
  ['rem2', 'Reminder 2', 'A ₱1,000 security deposit is collected upon delivery. It is refundable upon pick up, as long as there is no damage and no missing equipment.', 'Second reminder line. Type - to hide it.'],
  ['rem3', 'Reminder 3', 'Delivery is free within 5 km. Beyond 5 km, it is ₱30 for every additional kilometer.', 'Third reminder line. Type - to hide it.'],
  ['rem4', 'Reminder 4', '', 'Optional extra reminder line.'],
  ['rem5', 'Reminder 5', '', 'Optional extra reminder line.'],
  ['phone', 'Phone number (call or text)', '0999 711 4240', 'Shown to customers as "You can also call or text". Change it here when your number changes. Type - to hide.'],
  ['payMethods', 'Payment methods (separate with commas)', 'GCash, Maya, Bank Transfer, Cash', 'The choices in the customer\'s Payment method list and in the Transaction History dropdown.'],
  ['whatsapp', 'WhatsApp number', '09997114240', 'Number for the WhatsApp button. Change it here if you get a new number. Blank = no button.'],
  ['viber', 'Viber number', '09997114240', 'Number for the Viber button. Blank = no button.'],
  ['messenger', 'Messenger page ID or username', '1368190183045322', 'Your Facebook page ID or username for the Messenger button. Blank = no button.'],
  ['gcashNumber', 'GCash number', '09997114240', 'The GCash number customers see and can copy. Blank = hides the GCash section.'],
  ['gcashName', 'GCash account name', '', 'Optional. Shown next to the GCash number.'],
  ['showWhatsapp', 'Show WhatsApp button', 'Yes', 'Choose Yes or No from the dropdown.'],
  ['showViber', 'Show Viber button', 'Yes', 'Choose Yes or No from the dropdown.'],
  ['showMessenger', 'Show Messenger button', 'Yes', 'Choose Yes or No from the dropdown.'],
  ['showGcash', 'Show GCash payment section', 'Yes', 'Choose Yes or No from the dropdown.'],
  ['showCall', 'Show call or text line', 'Yes', 'Choose Yes or No from the dropdown.'],
  ['acceptRequests', 'Accept booking requests (Send button)', 'Yes', 'Choose No to pause online booking. The Send button turns off and customers see the paused message below.'],
  ['pausedMsg', 'Paused message', 'Online booking is paused right now. Please message us to book.', 'Shown above the Send button when Accept booking requests is No.'],
  ['footer', 'Footer note', 'Your date is not reserved until we reply and confirm.', 'The small line at the very bottom of the page.'],
  ['doneTitle', 'Request sent title', 'Request sent!', 'The heading customers see after sending.'],
  ['doneMsg', 'Request sent message', 'Thank you, {customer}. We will contact you at {phone} to confirm your date for {date}.', 'The message after sending. {customer}, {phone} and {date} are filled in automatically.'],
  ['doneNote', 'Request sent note', 'Your date is not reserved until we reply and confirm.', 'The second line after sending. Type - to hide it.']
];

const TOGGLE_KEYS = ['showWhatsapp', 'showViber', 'showMessenger', 'showGcash', 'showCall', 'acceptRequests'];

// Creates the Settings sheet, or adds any rows it is missing. Your own text is never overwritten.
function setupSettings(ss) {
  let t = ss.getSheetByName(SETTINGS_SHEET);
  if (!t) t = ss.insertSheet(SETTINGS_SHEET);
  if (t.getLastRow() < 1) t.getRange(1, 1, 1, 3).setValues([['Setting (do not rename)', 'Your text', 'What it changes']]);
  t.setFrozenRows(1);
  t.getRange('A:C').setNumberFormat('@');
  const have = {};
  if (t.getLastRow() > 1) t.getRange(2, 1, t.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0]).trim().toLowerCase()] = true; });
  const add = SETTINGS_ROWS.filter(function (r) { return !have[r[1].toLowerCase()] && !have[r[0].toLowerCase()]; })
    .map(function (r) { return [r[1], r[2], r[3]]; });
  if (add.length) t.getRange(t.getLastRow() + 1, 1, add.length, 3).setValues(add);
  // The add-ons note used to say "Tick an add-on...". Update that old text once; any other text you wrote is kept.
  if (t.getLastRow() > 1) {
    t.getRange(2, 1, t.getLastRow() - 1, 2).getValues().forEach(function (r, i) {
      const lab = String(r[0]).trim().toLowerCase();
      if ((lab === 'add-ons note' || lab === 'addonsnote') && /^\s*(tick an?\s*add|choose how many of each)/i.test(String(r[1]))) {
        t.getRange(i + 2, 2).setValue('Tick the add-ons you want, then choose how many. It is included in your total rental fee.');
      }
    });
  }
  t.setColumnWidth(1, 190); t.setColumnWidth(2, 460); t.setColumnWidth(3, 340);
  t.getRange('B:B').setWrap(true);
  // Yes/No dropdown on every on/off switch row
  const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(false).build();
  const keyOf = {};
  SETTINGS_ROWS.forEach(function (r) { keyOf[r[1].toLowerCase()] = r[0]; keyOf[r[0].toLowerCase()] = r[0]; });
  if (t.getLastRow() > 1) {
    t.getRange(2, 1, t.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
      if (TOGGLE_KEYS.indexOf(keyOf[String(r[0]).trim().toLowerCase()]) > -1) t.getRange(i + 2, 2).setDataValidation(yn);
    });
  }
}

// Reads the Settings sheet and gives the website {key: text}. Works with the labels in column A.
function getSettings() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null; // the website then uses its built-in text
  const keyOf = {};
  SETTINGS_ROWS.forEach(function (r) { keyOf[r[1].toLowerCase()] = r[0]; keyOf[r[0].toLowerCase()] = r[0]; });
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const k = keyOf[String(r[0] || '').trim().toLowerCase()];
    if (k) out[k] = String(r[1] == null ? '' : r[1]).trim();
  });
  return out;
}

// The reminder lines (Settings sheet, Reminder 2 to 5) are reused in the confirmation reply, so you only edit them once.
function reminderText() {
  const s = getSettings();
  if (!s) return REMINDER;
  return ['rem2', 'rem3', 'rem4', 'rem5'].map(function (k) { return String(s[k] || '').trim(); }).filter(function (x) { return x && x !== '-'; }).join(' ');
}

function money(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
  return n ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
}

function getPackages() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PACKAGES_SHEET);
  if (!sh || sh.getLastRow() < 2) return null; // the website then uses config.js
  const out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(function (r) {
    const title = String(r[1] || '').trim();
    if (!title || String(r[0]).trim().toLowerCase() === 'no') return;
    out.push({
      title: title, price: money(r[2]), regular: money(r[3]), note: String(r[4] || '').trim(),
      available: String(r[7]).trim().toLowerCase() !== 'no', // blank = Yes; No = shown but greyed out and not tappable
      qty: Math.max(1, Math.min(50, Math.floor(Number(r[8])) || 1)), // how many can be booked on the same date; blank = 1
      image: String(r[5] || '').trim(),
      items: String(r[6] || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)
    });
  });
  return out.length ? out : null;
}

function getAddons() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ADDONS_SHEET);
  if (!sh) return null;
  const out = [];
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) {
      const title = String(r[1] || '').trim();
      if (!title || String(r[0]).trim().toLowerCase() === 'no') return;
      const qty = Math.max(1, Math.min(50, Math.floor(Number(r[6])) || 1)); // blank = 1
      out.push({
        title: title, price: money(r[2]), regular: money(r[3]), note: String(r[4] || '').trim(), qty: qty,
        available: String(r[5]).trim().toLowerCase() !== 'no' && !!money(r[2])
      });
    });
  }
  return out;
}

/* ---------------- Availability by Date sheet (1 row per date, 1 column per package / add-on) ---------------- */
function setupAvailability(ss) {
  let sh = ss.getSheetByName(AVAIL_SHEET);
  if (!sh) sh = ss.insertSheet(AVAIL_SHEET);
  const pk = (getPackages() || []).map(function (x) { return x.title; });
  const ad = (getAddons() || []).map(function (x) { return x.title; });
  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); }) : [];
  if (!have[0]) { have[0] = 'Date (YYYY-MM-DD)'; sh.getRange(1, 1).setValue(have[0]); }
  // Add a column for every package and add-on that has none yet. Existing columns and your Yes/No choices are never touched.
  pk.concat(ad).forEach(function (t) {
    if (have.indexOf(t) < 0) { have.push(t); sh.getRange(1, have.length).setValue(t); }
  });
  const n = have.length;
  sh.setFrozenRows(1); sh.setFrozenColumns(1);
  sh.getRange('A:A').setNumberFormat('@');
  sh.setColumnWidth(1, 150);
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setWrap(true);
  sh.getRange('A1').setNote('One row per date, like 2026-12-25. Under each package or add-on, pick No to turn it off on that date. Blank or Yes = available as usual.');
  if (n > 1) {
    const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(false).build();
    for (let c = 2; c <= n; c++) {
      sh.getRange(2, c, 500, 1).setDataValidation(yn);
      sh.setColumnWidth(c, 140);
      sh.getRange(1, c).setBackground(pk.indexOf(have[c - 1]) > -1 ? '#dbeafe' : ad.indexOf(have[c - 1]) > -1 ? '#fef3c7' : '#eeeeee');
    }
    sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No').setBackground('#f4c7c3').setFontColor('#a61c00').setRanges([sh.getRange(2, 2, 500, n - 1)]).build()]);
  }
}

// { 'YYYY-MM-DD': { 'Package or add-on title': true } } for every cell set to No
function getAvailability() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAIL_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 2) return out;
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const heads = vals[0].map(function (v) { return String(v || '').trim(); });
  for (let i = 1; i < vals.length; i++) {
    const d = normDate(vals[i][0]);
    if (!d) continue;
    for (let c = 1; c < heads.length; c++) {
      if (heads[c] && String(vals[i][c]).trim().toLowerCase() === 'no') { out[d] = out[d] || {}; out[d][heads[c]] = true; }
    }
  }
  return out;
}

/* ---------------- Special Prices sheet (a different price on certain dates) ---------------- */
function setupSpecial(ss) {
  let sp = ss.getSheetByName(SPECIAL_SHEET);
  if (!sp) sp = ss.insertSheet(SPECIAL_SHEET);
  sp.getRange(1, 1, 1, 6).setValues([['From date (YYYY-MM-DD)', 'To date (optional, for a range)', 'Package (blank = all packages)', 'Price for these dates (PHP)', 'OR add / subtract (PHP, example 300 or -200)', 'Label shown to customers (example: Holiday rate)']]);
  sp.setFrozenRows(1);
  sp.getRange('A:B').setNumberFormat('@');
  sp.getRange('D:E').setNumberFormat('#,##0');
  sp.getRange(2, 3, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(PACKAGES_SHEET).getRange('B2:B30'), true).setAllowInvalid(false).build());
  sp.getRange('A1').setNote('Example: 2026-12-25. For one day, leave the To date blank.');
  sp.getRange('D1').setNote('Fills in the exact price for that package on those dates. If this is filled, the add/subtract column is ignored.');
  sp.getRange('E1').setNote('Use this instead to raise or lower the normal price. Example: 300 makes it 300 more, -200 makes it 200 less. Handy with "all packages".');
  sp.getRange('F1').setNote('The small tag customers see beside the price on those dates. Blank shows "Special rate".');
  sp.setColumnWidth(1, 160); sp.setColumnWidth(2, 190); sp.setColumnWidth(3, 190); sp.setColumnWidth(4, 190); sp.setColumnWidth(5, 230); sp.setColumnWidth(6, 260);
  sp.getRange(1, 1, 1, 6).setWrap(true);
}

// [{from, to, pkg ('' = all), price (number or null), add (number or null), label}]
function getSpecialPrices() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SPECIAL_SHEET);
  const out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
    const from = normDate(r[0]);
    if (!from) return;
    let to = normDate(r[1]) || from;
    if (to < from) to = from;
    const price = Math.round(Number(String(r[3] == null ? '' : r[3]).replace(/[^\d.]/g, ''))) || null;
    const addRaw = String(r[4] == null ? '' : r[4]).replace(/[^\d.\-]/g, '');
    const add = addRaw !== '' && !isNaN(Number(addRaw)) ? Math.round(Number(addRaw)) : null;
    if (price === null && add === null) return;
    out.push({ from: from, to: to, pkg: String(r[2] || '').trim(), price: price, add: add, label: String(r[5] || '').trim() });
  });
  return out;
}

// The rule that applies to a package on a date: a rule for that package beats an "all packages" rule; a lower row beats a higher one.
function specialFor(rules, title, date) {
  let best = null, bestScore = -1;
  rules.forEach(function (r) {
    if (date < r.from || date > r.to) return;
    if (r.pkg && r.pkg !== title) return;
    const score = r.pkg ? 1 : 0;
    if (score >= bestScore) { best = r; bestScore = score; }
  });
  return best;
}

// Add-ons already taken on each date, so the website can show what is left.
// Counts requests marked Accepted or Hold. (Add 'new' to the list to also count requests you have not answered yet.)
const STOCK_STATUSES = ['accepted', 'hold'];
function getAddonUse(addons) {
  const out = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2 || !addons || !addons.length) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, C.ADDONS).getValues().forEach(function (r) {
    if (STOCK_STATUSES.indexOf(String(r[C.STATUS - 1]).trim().toLowerCase()) < 0) return;
    const date = normDate(r[C.DATE - 1]), text = String(r[C.ADDONS - 1] || '').trim();
    if (!date || !text) return;
    addons.forEach(function (a) {
      // the Add-ons column looks like: "Shure SM58 ... x2, Tables x3" (no x means 1)
      const m = text.match(new RegExp('(?:^|, )' + a.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: x(\\d+))?(?=, |$)'));
      if (!m) return;
      out[date] = out[date] || {};
      out[date][a.title] = (out[date][a.title] || 0) + (m[1] ? parseInt(m[1], 10) : 1);
    });
  });
  return out;
}

// Packages already taken on each date: { 'YYYY-MM-DD': { 'Package title': count } }. Counts the same statuses as add-ons.
function getPackageUse() {
  const out = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, C.DATE).getValues().forEach(function (r) {
    if (STOCK_STATUSES.indexOf(String(r[C.STATUS - 1]).trim().toLowerCase()) < 0) return;
    const date = normDate(r[C.DATE - 1]), pk = String(r[C.PKG - 1]).trim();
    if (!date || !pk) return;
    out[date] = out[date] || {};
    out[date][pk] = (out[date][pk] || 0) + 1;
  });
  return out;
}

// How many of a package can be booked on one date (the Quantity column on the Packages sheet; 1 if blank or not found).
function packageCap(title, list) {
  list = list || getPackages() || [];
  const m = list.filter(function (x) { return x.title === title; })[0];
  return m ? m.qty : 1;
}

function getDays() {
  // { 'YYYY-MM-DD': { '*': 'unavailable' }  or  { 'Standard Package': 'booked', 'Pro Package': 'hold' } }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATES_SHEET);
  const days = {};
  if (sheet && sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    rows.forEach(function (row) {
      const d = normDate(row[0]);
      const status = String(row[1] || '').trim().toLowerCase();
      const pk = String(row[3] || '').trim() || '*';
      if (!d || !(status === 'booked' || status === 'hold' || status === 'unavailable')) return;
      days[d] = days[d] || {};
      if (days[d][pk] !== 'booked') days[d][pk] = status;
    });
  }
  return days;
}

// Everything about stock and blocked dates, read once. Used by the website and by the Monitoring sheet.
function loadState() {
  const days = getDays(), packages = getPackages(), addons = getAddons();
  // Availability by Date: a package set to No becomes "unavailable" for that package on that date; add-ons set to No go in "off"
  const avail = getAvailability(), addonTitles = (addons || []).map(function (x) { return x.title; }), off = {};
  Object.keys(avail).forEach(function (d) {
    Object.keys(avail[d]).forEach(function (t) {
      if (addonTitles.indexOf(t) > -1) { off[d] = off[d] || {}; off[d][t] = 1; }
      else { days[d] = days[d] || {}; if (!days[d]['*'] && !days[d][t]) days[d][t] = 'unavailable'; }
    });
  });
  return { days: days, packages: packages, addons: addons, off: off, used: getAddonUse(addons), pused: getPackageUse() };
}

// 'YYYY-MM-DD' for today + n days in the business time zone
function dayKey(n) { const d = new Date(); d.setDate(d.getDate() + n); return Utilities.formatDate(d, SITE_TZ, 'yyyy-MM-dd'); }

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

/* ---------------- website: save a request ---------------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const p = JSON.parse(e.postData.contents);

    if (p.website) return json({ ok: true }); // honeypot: bots fill this, humans don't

    const name = clean(p.name), phone = clean(p.phone), date = clean(p.date);
    if (!name || !phone || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !clean(p.pkg)) {
      return json({ ok: false, error: 'invalid' });
    }

    // Booking window (Settings sheet): refuse dates that are too soon or too far ahead
    const cfgS = getSettings() || {};
    const minD = Math.max(0, parseInt(cfgS.minDays, 10) || 0), maxD = parseInt(cfgS.maxDays, 10);
    if (date < dayKey(minD) || (!isNaN(maxD) && maxD >= 0 && date > dayKey(maxD))) return json({ ok: false, error: 'closed' });

    // Price check: refuse if the price the customer saw is no longer the right price for that date
    const pkgList = getPackages() || [];
    const pkRow = pkgList.filter(function (x) { return x.title === clean(p.pkg); })[0];
    if (pkRow) {
      const base = Number(String(pkRow.price).replace(/[^\d]/g, '')) || 0;
      const sp = specialFor(getSpecialPrices(), pkRow.title, date);
      const expect = sp ? (sp.price !== null ? sp.price : Math.max(0, base + (sp.add || 0))) : base;
      const sent = Number(String(p.price).replace(/[^\d]/g, '')) || 0;
      if (sent !== expect) return json({ ok: false, error: 'price', expected: expect });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dSheet = ss.getSheetByName(DATES_SHEET);
    if (dSheet && dSheet.getLastRow() > 1) {
      const rows = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 4).getValues();
      for (let i = 0; i < rows.length; i++) {
        const st = String(rows[i][1] || '').trim().toLowerCase();
        const rowPkg = String(rows[i][3] || '').trim();
        if (normDate(rows[i][0]) === date && (st === 'booked' || st === 'hold' || st === 'unavailable') && (!rowPkg || rowPkg === clean(p.pkg))) {
          return json({ ok: false, error: 'taken' });
        }
      }
    }

    // Availability by Date: refuse a package or add-on that is switched off for this date
    const av = getAvailability()[date] || {};
    if (av[clean(p.pkg)]) return json({ ok: false, error: 'taken' });

    // Package stock: refuse if every set of this package is already taken for this date
    const pkgUse = (getPackageUse()[date] || {})[clean(p.pkg)] || 0;
    if (pkgUse >= packageCap(clean(p.pkg), pkgList)) return json({ ok: false, error: 'taken' });

    // Add-on stock: refuse if someone already took the last ones for this date
    if (p.addonQty && typeof p.addonQty === 'object') {
      const list = getAddons() || [], use = (getAddonUse(list)[date]) || {};
      for (const t in p.addonQty) {
        const a = list.filter(function (x) { return x.title === t; })[0], q = Math.floor(Number(p.addonQty[t])) || 0;
        if (q < 1) continue;
        if (av[t]) return json({ ok: false, error: 'addon', item: t });
        if (!a || !a.available || q > a.qty - (use[t] || 0)) return json({ ok: false, error: 'addon', item: t });
      }
    }

    // Customer location (they allowed it in the browser): saved as a Google Maps link
    let loc = '';
    if (p.lat != null && p.lng != null && p.lat !== '' && p.lng !== '') {
      const lat = Number(p.lat), lng = Number(p.lng);
      if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) loc = 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6);
    }

    const rSheet = ss.getSheetByName(REQUESTS_SHEET), reqId = newId();
    rSheet.appendRow([
      new Date(), 'New', name, phone, clean(p.pkg), clean(p.price),
      date, clean(p.time), clean(p.hours), clean(p.venue) + (clean(p.landmark) ? ' (Landmark: ' + clean(p.landmark) + ')' : ''),
      p.delivery ? 'Yes' : 'No (pickup)', clean(p.notes), '', '', clean(p.events), clean(p.addons), clean(p.total), loc,
      reqId, '', '', '', clean(p.payMethod)
    ]);

    // Telegram first, and the email in its own try/catch, so a mail problem can never block the alert or the customer's booking
    notifyOwner(buildNewRequestText(p, name, phone, date));
    if (NOTIFY_EMAIL) try {
      MailApp.sendEmail(
        NOTIFY_EMAIL,
        'New booking request: ' + date + ' - ' + name,
        'Name: ' + name + '\nMobile: ' + phone + '\nPackage: ' + clean(p.pkg) +
        '\nDate: ' + date + '\nStart: ' + clean(p.time) + ' (' + clean(p.hours) + ' hours)' +
        '\nVenue: ' + clean(p.venue) + '\nDelivery: ' + (p.delivery ? 'Yes' : 'No') +
        '\nPayment method: ' + clean(p.payMethod) + '\nEvent: ' + clean(p.events) + '\nAdd-ons: ' + clean(p.addons) + '\nTotal: ' + clean(p.total) + '\nLocation: ' + (loc || 'not shared') + '\nNotes: ' + clean(p.notes)
      );
    } catch (mailErr) {}
    return json({ ok: true, id: reqId });
  } catch (err) {
    return json({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- you change a Status: update calendar + write reply ---------------- */
// Runs by itself whenever you edit the sheet (a "simple trigger", no setup needed).
const STOCK_SHEETS = [PACKAGES_SHEET, ADDONS_SHEET, AVAIL_SHEET, DATES_SHEET, SETTINGS_SHEET];
function onEdit(e) {
  if (!e || !e.range) return;
  clearCache(); // any edit in the spreadsheet: the website should see it on its next check
  const sheet = e.range.getSheet(), name = sheet.getName();
  if (STOCK_SHEETS.indexOf(name) > -1) { rebuildMonitoring(); return; } // quantity / availability / booking window changed
  if (name !== REQUESTS_SHEET) return;
  if (e.range.getColumn() > C.STATUS || e.range.getLastColumn() < C.STATUS) return;

  const ss = e.source;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  const dates = {}, caps = capMap();

  for (let row = first; row <= last; row++) {
    const v = sheet.getRange(row, 1, 1, C.PAY).getValues()[0];
    const date = normDate(v[C.DATE - 1]);
    if (!date) continue;
    dates[date] = true;
    writeReply(sheet, row, v, date);
    syncTransaction(ss, sheet, row, v); // Accepted -> a line in Transaction History
  }
  Object.keys(dates).forEach(function (d) { syncDate(ss, d, caps); });
  rebuildMonitoring();
  clearCache();
}

function newId() { return Utilities.getUuid().slice(0, 8).toUpperCase(); }

// { 'Package title': how many can be booked on one date }
function capMap() {
  const out = {};
  (getPackages() || []).forEach(function (p) { out[p.title] = p.qty; });
  return out;
}

// Work out the date's status from all requests, then update the "Dates" sheet.
function syncDate(ss, date, caps) {
  caps = caps || capMap();
  const rSheet = ss.getSheetByName(REQUESTS_SHEET);
  const want = {}; // package -> 'booked' | 'hold'
  const acc = {}, hld = {}; // package -> how many accepted / on hold for this date
  if (rSheet.getLastRow() > 1) {
    const rows = rSheet.getRange(2, 1, rSheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function (r) {
      if (normDate(r[C.DATE - 1]) !== date) return;
      const pk = String(r[C.PKG - 1]).trim();
      const st = String(r[C.STATUS - 1]).trim().toLowerCase();
      if (!pk) return;
      if (st === 'accepted') acc[pk] = (acc[pk] || 0) + 1;
      else if (st === 'hold') hld[pk] = (hld[pk] || 0) + 1;
    });
  }
  // The date is only marked for a package once ALL its sets are taken (Quantity on the Packages sheet; 1 = as before)
  Object.keys(acc).concat(Object.keys(hld)).forEach(function (pk) {
    if (want[pk]) return;
    const a = acc[pk] || 0, total = a + (hld[pk] || 0), cap = caps[pk] || 1;
    if (total >= cap) want[pk] = a >= cap ? 'booked' : 'hold';
  });

  const dSheet = ss.getSheetByName(DATES_SHEET);
  const n = dSheet.getLastRow() - 1;
  const rows = n > 0 ? dSheet.getRange(2, 1, n, 4).getValues() : [];
  const typed = {}; // rows you typed yourself are never touched
  rows.forEach(function (r) {
    if (normDate(r[0]) === date && String(r[2]).trim() !== 'request') typed[String(r[3]).trim()] = true;
  });
  const have = {};
  for (let i = rows.length - 1; i >= 0; i--) { // bottom-up so deleting keeps row numbers right
    if (normDate(rows[i][0]) !== date || String(rows[i][2]).trim() !== 'request') continue;
    const pk = String(rows[i][3]).trim();
    if (want[pk] && !have[pk]) {
      have[pk] = true;
      if (String(rows[i][1]).trim() !== want[pk]) dSheet.getRange(i + 2, 2).setValue(want[pk]);
    } else {
      dSheet.deleteRow(i + 2);
    }
  }
  Object.keys(want).forEach(function (pk) {
    if (!have[pk] && !typed[pk] && !typed['']) dSheet.appendRow([date, want[pk], 'request', pk]);
  });
}

// Run once after upgrading: rebuilds the auto rows in "Dates" from your existing requests.
function rebuildDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = ss.getSheetByName(REQUESTS_SHEET);
  const seen = {};
  if (r.getLastRow() > 1) {
    r.getRange(2, C.DATE, r.getLastRow() - 1, 1).getValues().forEach(function (v) {
      const d = normDate(v[0]);
      if (d) seen[d] = true;
    });
  }
  const caps = capMap();
  Object.keys(seen).forEach(function (d) { syncDate(ss, d, caps); });
  rebuildMonitoring();
  clearCache();
}

function writeReply(sheet, row, v, date) {
  const status = String(v[C.STATUS - 1]).trim().toLowerCase();
  const name = String(v[C.NAME - 1]).trim();
  const nice = prettyDate(date);
  let msg = '';

  if (status === 'accepted') {
    msg = 'Hi ' + name + '! Your booking is CONFIRMED.\n' +
      'Package: ' + v[C.PKG - 1] + ' (' + v[C.PRICE - 1] + ')\n' +
      (v[C.ADDONS - 1] ? 'Add-ons: ' + v[C.ADDONS - 1] + '\n' : '') +
      (v[C.TOTAL - 1] ? 'Total rental fee: ' + v[C.TOTAL - 1] + ' (reservation fee included)\n' : '') +
      'Date: ' + nice + ', ' + timeText(v[C.TIME - 1]) + ' for ' + v[C.HOURS - 1] + ' hours\n' +
      'Venue: ' + v[C.VENUE - 1] + '\n' +
      (reminderText() ? reminderText() + '\n' : '') +
      'Thank you for choosing ' + BUSINESS + '!';
  } else if (status === 'hold') {
    msg = 'Hi ' + name + '! We are holding ' + nice + ' for you (' + v[C.PKG - 1] + '). ' +
      'Please reply to confirm so we can lock in your booking. Thank you! - ' + BUSINESS;
  } else if (status === 'declined') {
    msg = 'Hi ' + name + '! Sorry, we are not available on ' + nice + '. ' +
      'You are welcome to book another date. Thank you! - ' + BUSINESS;
  }

  const replyCell = sheet.getRange(row, C.REPLY);
  const smsCell = sheet.getRange(row, C.SMS);
  if (!msg) { replyCell.clearContent(); smsCell.clearContent(); return; }

  replyCell.setValue(msg).setWrap(true);
  const phone = String(v[C.PHONE - 1]).replace(/[^\d+]/g, '');
  if (phone) {
    const url = 'sms:' + phone + '?body=' + encodeURIComponent(msg);
    smsCell.setFormula('=HYPERLINK("' + url + '","Text them")');
  } else {
    smsCell.clearContent();
  }
}

/* ---------------- Locations sheet: city + barangay dropdowns on the booking form ---------------- */
// One row per barangay. Add, edit or delete rows freely. A new city name in column A creates a new city.
// Cities appear in the order of their first row; barangays in the order of their rows.
const LOC_SEED = {
  'Bansud': ['Alcadesma', 'Bato', 'Corazon', 'Malo', 'Manihala', 'Pag-asa', 'Poblacion', 'Proper Bansud', 'Rosacara', 'Salcedo', 'Sumagui', 'Proper Tiguisan', 'Villa Pag-Asa'],
  'Bongabong': ['Bagumbayan I', 'Labasan', 'Malitbog', 'Ipil'],
  'Gloria': ['Banus', 'Agsalin', 'Maragooc']
};
function setupLocations(ss) {
  let sh = ss.getSheetByName(LOCATIONS_SHEET);
  if (!sh) sh = ss.insertSheet(LOCATIONS_SHEET);
  sh.getRange(1, 1, 1, 3).setValues([['City', 'Barangay', 'Available']]).setFontWeight('bold').setBackground('#d9e2f3');
  sh.setFrozenRows(1); sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 100);
  sh.getRange('A1').setNote('One row per barangay. Type a new City in column A to add a city. Edit or delete any row to change the dropdowns on the website.');
  sh.getRange('C1').setNote('Yes = customers can pick this barangay. No = it is shown greyed out as "not available" and cannot be chosen. Blank counts as Yes.');
  if (sh.getLastRow() < 2) {
    const rows = [];
    Object.keys(LOC_SEED).forEach(function (c) { LOC_SEED[c].forEach(function (b) { rows.push([c, b, 'Yes']); }); });
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  // existing rows with an empty Available cell become Yes
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const rng = sh.getRange(2, 3, n, 1), vals = rng.getValues();
    rng.setValues(vals.map(function (r) { return [String(r[0]).trim() ? r[0] : 'Yes']; }));
  }
  // Yes / No dropdown for the whole column (also applies to rows you add later)
  sh.getRange(2, 3, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(false).build());
  // grey out the rows that are switched off
  const red = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="No"')
    .setBackground('#f4cccc').setFontColor('#999999').setRanges([sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 3)]).build();
  sh.setConditionalFormatRules([red]);
}

// { 'City': ['Barangay', ...] } or null when the sheet is empty (the website then uses config.js)
function getLocations() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOCATIONS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const c = String(r[0] || '').trim(), b = String(r[1] || '').trim();
    if (!c) return;
    out[c] = out[c] || [];
    if (b && out[c].indexOf(b) < 0) out[c].push(b);
  });
  return Object.keys(out).length ? out : null;
}

// { 'City': ['Barangay', ...] } of the barangays switched off (Available = No). Empty object when none.
function getLocationsOff() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOCATIONS_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    const c = String(r[0] || '').trim(), b = String(r[1] || '').trim(), a = String(r[2] || '').trim().toLowerCase();
    if (!c || !b) return;
    if (a === 'no' || a === 'n' || a === 'false' || a === 'off') { out[c] = out[c] || []; out[c].push(b); }
  });
  return out;
}

/* ---------------- Monitoring sheet: remaining and booked, per date ---------------- */
// One row per date. Left block = REMAINING, right block = BOOKED (accepted + on hold). Packages first, then add-ons.
// Columns follow your Packages and Add-ons sheets, so a new package or add-on shows up by itself.
function rebuildMonitoring() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MONITOR_SHEET) || ss.insertSheet(MONITOR_SHEET);
  const st = loadState(), pk = st.packages || [], ad = st.addons || [];
  const n = pk.length + ad.length;
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear(); sh.clearConditionalFormatRules();
  if (!n) { sh.getRange(1, 1).setValue('Add packages on the Packages sheet first.'); return; }

  // dates: today up to the "Latest booking date" (60 days if blank), plus any later date that has bookings
  const maxD = parseInt((getSettings() || {}).maxDays, 10), span = !isNaN(maxD) && maxD >= 0 ? maxD : 60;
  const set = {}, today = dayKey(0);
  for (let i = 0; i <= span; i++) set[dayKey(i)] = true;
  Object.keys(st.pused).concat(Object.keys(st.used)).forEach(function (d) { if (d >= today) set[d] = true; });
  const dates = Object.keys(set).sort();

  const items = pk.map(function (p) { return { t: p.title, qty: p.qty, ok: p.available, pkg: true }; })
    .concat(ad.map(function (a) { return { t: a.title, qty: a.qty, ok: a.available, pkg: false }; }));
  const rows = dates.map(function (d) {
    const day = st.days[d] || {}, off = st.off[d] || {}, rem = [], bk = [];
    items.forEach(function (it) {
      const used = ((it.pkg ? st.pused : st.used)[d] || {})[it.t] || 0;
      const closed = !it.ok || day['*'] || (it.pkg ? day[it.t] : off[it.t]);
      rem.push(closed ? 0 : Math.max(0, it.qty - used));
      bk.push(used);
    });
    return [d].concat(rem, bk);
  });
  const total = ['TOTAL BOOKED'];
  for (let i = 0; i < n; i++) total.push('');
  for (let i = 0; i < n; i++) total.push(rows.reduce(function (s, r) { return s + r[1 + n + i]; }, 0));

  const cols = 1 + 2 * n;
  sh.getRange(1, 1, 1, cols).setValues([['Date'].concat(items.map(function (x, i) { return i === 0 ? 'REMAINING AVAILABLE' : ''; }), items.map(function (x, i) { return i === 0 ? 'BOOKED (accepted + on hold)' : ''; }))]);
  sh.getRange(1, 2, 1, n).merge(); sh.getRange(1, 2 + n, 1, n).merge();
  sh.getRange(2, 1, 1, cols).setValues([['Date (YYYY-MM-DD)'].concat(items.map(function (x) { return x.t; }), items.map(function (x) { return x.t; }))]);
  sh.getRange(3, 1, 1, cols).setValues([total]);
  sh.getRange(4, 1, rows.length, 1).setNumberFormat('@');
  if (rows.length) sh.getRange(4, 1, rows.length, cols).setValues(rows);

  sh.getRange(1, 1, 3, cols).setFontWeight('bold');
  sh.getRange(1, 2, 1, n).setBackground('#d9ead3').setHorizontalAlignment('center');
  sh.getRange(1, 2 + n, 1, n).setBackground('#fce5cd').setHorizontalAlignment('center');
  sh.getRange(2, 2, 1, n).setBackground('#d9ead3'); sh.getRange(2, 2 + n, 1, n).setBackground('#fce5cd');
  sh.getRange(2, 1, 1, cols).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(3, 1, 1, cols).setBackground('#efefef');
  sh.getRange(1, 2, sh.getMaxRows(), cols - 1).setHorizontalAlignment('center');
  sh.getRange(1, 2 + n, sh.getMaxRows(), 1).setBorder(null, true, null, null, null, null, '#999999', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setFrozenRows(3); sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 150);
  for (let c = 2; c <= cols; c++) sh.setColumnWidth(c, 110);
  if (rows.length) {
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setBackground('#f4c7c3').setFontColor('#a61c00').setRanges([sh.getRange(4, 2, rows.length, n)]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground('#fff2cc').setRanges([sh.getRange(4, 2 + n, rows.length, n)]).build()
    ]);
  }
  sh.getRange('A1').setNote('Automatic. Rebuilt whenever you change a request Status, Quantity, Availability or Settings. Do not type here.');
}

/* ---------------- Transaction History sheet: payments ---------------- */
const TX_HEAD = ['Transaction date', 'Customer Name', 'Packages', 'Total Add-ons', 'Total Amount', 'Payment Received', 'Balance', 'Payment Method', 'Status', 'Request ID (auto)'];
const TX = { DATE: 1, NAME: 2, PKG: 3, ADD: 4, TOTAL: 5, PAID: 6, BAL: 7, METHOD: 8, STATUS: 9, ID: 10 };

function payMethodList() {
  const raw = (getSettings() || {}).payMethods;
  const list = String(raw == null || raw === '' ? 'GCash, Maya, Bank Transfer, Cash' : raw).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  return list.length ? list : ['GCash'];
}

function setupTransactions(ss) {
  let tx = ss.getSheetByName(TX_SHEET);
  if (!tx) tx = ss.insertSheet(TX_SHEET);
  tx.getRange(1, 1, 1, TX_HEAD.length).setValues([TX_HEAD]).setFontWeight('bold').setBackground('#d9e2f3').setWrap(true);
  tx.setFrozenRows(1);
  tx.getRange('A:A').setNumberFormat('mmm d, yyyy, h:mm am/pm');
  tx.getRange('D:G').setNumberFormat('#,##0');
  [170, 160, 160, 100, 110, 120, 100, 140, 130, 120].forEach(function (w, i) { tx.setColumnWidth(i + 1, w); });
  tx.getRange(2, TX.METHOD, 998, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(payMethodList(), true).setAllowInvalid(true).build());
  tx.getRange(2, TX.PAID, 998, 1).setBackground('#fff9e5'); // the cells you type in
  tx.getRange('F1').setNote('You type this. Enter what the customer has paid so far (partial or full). Balance and Status update by themselves.');
  tx.getRange('I1').setNote('Automatic: Success when the balance is zero, otherwise Remaining Bal.');
  tx.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Success').setBackground('#d9ead3').setFontColor('#274e13').setRanges([tx.getRange(2, TX.STATUS, 998, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Remaining Bal.').setBackground('#fff2cc').setFontColor('#7f6000').setRanges([tx.getRange(2, TX.STATUS, 998, 1)]).build()
  ]);
  tx.hideColumns(TX.ID);
}

function amountOf(v) { return Number(String(v == null ? '' : v).replace(/[^\d.]/g, '')) || 0; }

function findTxRow(tx, id) {
  const n = tx.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = tx.getRange(2, TX.ID, n, 1).getValues();
  for (let i = 0; i < n; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

// Called for each request whose Status was edited. Accepted -> one line (once). Anything else -> the line goes away if nothing was paid yet.
function syncTransaction(ss, rSheet, row, v) {
  const tx = ss.getSheetByName(TX_SHEET);
  if (!tx) return;
  const accepted = String(v[C.STATUS - 1]).trim().toLowerCase() === 'accepted';
  let id = String(v[C.ID - 1] || '').trim();
  if (!id) {
    if (!accepted) return;
    id = newId(); rSheet.getRange(row, C.ID).setValue(id); // older requests get their ID now
  }
  const found = findTxRow(tx, id);
  if (!accepted) {
    if (found && !(amountOf(tx.getRange(found, TX.PAID).getValue()) > 0)) tx.deleteRow(found);
    return;
  }
  if (found) return; // already logged: keep what you typed
  const total = amountOf(v[C.TOTAL - 1]) || amountOf(v[C.PRICE - 1]);
  const addons = Math.max(0, total - amountOf(v[C.PRICE - 1]));
  if (tx.getMaxRows() < 2) tx.insertRowAfter(1);
  tx.insertRowBefore(2); // newest on top
  const r = tx.getRange(2, 1, 1, TX_HEAD.length);
  r.setFontWeight('normal').setFontColor(null).setBackground(null);
  r.setValues([[v[C.RECEIVED - 1] instanceof Date ? v[C.RECEIVED - 1] : new Date(), String(v[C.NAME - 1]).trim(), String(v[C.PKG - 1]).trim(), addons, total, '',
    '=IF(E2="","",E2-N(F2))', String(v[C.PAY - 1] || '').trim(),
    '=IF(E2="","",IF(E2-N(F2)<=0,"Success","Remaining Bal."))', id]]);
  tx.getRange(2, TX.PAID).setBackground('#fff9e5');
  tx.getRange(2, TX.METHOD).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(payMethodList(), true).setAllowInvalid(true).build());
}

/* ---------------- helpers ---------------- */
// Turns a Date or text into 'YYYY-MM-DD' (or '' if it is not a date).
function normDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Shows the Start cell as "8:00 AM" even if Sheets stored it as a time value (which prints as Dec 30 1899).
function timeText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'h:mm a');
  return String(v == null ? '' : v).trim();
}

// Run ONCE to repair old rows: turns the Start column into plain text like "8:00 AM".
function fixStartTimes() {
  const r = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REQUESTS_SHEET);
  const n = r.getLastRow() - 1;
  if (n < 1) return;
  const rng = r.getRange(2, C.TIME, n, 1);
  const vals = rng.getValues().map(function (row) { return [timeText(row[0])]; });
  rng.setNumberFormat('@').setValues(vals);
}

function prettyDate(s) {
  const p = s.split('-');
  return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2]), Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
}

// Trim, limit length, and stop spreadsheet formulas from being injected.
function clean(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 500);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
