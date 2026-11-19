// Driver page: each driver signs in with their own passcode, sees the
// confirmed trips Tab (or the script) gave them, and taps each step of a trip. Each tap is stamped on the sheet and, unless Tab has switched it
// off, emails the rider. Same Apps Script web app as everything else;
// BOOKING_ENDPOINT comes from config.js.

// GitHub Pages cannot send a frame-blocking header, so refuse to run inside
// someone else's page, where buttons could be overlaid and clicked unseen.
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error("framed");
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const gate = $("#gate");
const gateForm = $("#gate-form");
const gateError = $("#gate-error");
const gateBtn = $("#gate-btn");
const desk = $("#desk");
const list = $("#list");
const empty = $("#empty");
const note = $("#desk-note");
const signout = $("#signout");

// localStorage, unlike the desk: a driver opens this from the home screen
// between trips, and signing in again each time would get in the way. The
// script forgets the token after six hours regardless, and this page shows no
// fares and no rider emails.
const TOKEN_KEY = "tpt.driver.token";
let token = "";
try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* private mode */ }
let trips = [];
let notify = {};
let isAdmin = false;

const STEPS = [
  { key: "onTheWay", label: "On the way", done: "On the way", ask: "is told you are on the way" },
  { key: "arrived", label: "Arrived", done: "Arrived", ask: "is told you have arrived" },
  { key: "tripDone", label: "Trip done", done: "Done", ask: "is thanked and asked for a Google review" },
];

/* ---------- transport ---------- */

async function call(action, payload = {}) {
  if (!BOOKING_ENDPOINT) throw new Error("No endpoint is configured. Paste the Apps Script URL into config.js.");
  const res = await fetch(BOOKING_ENDPOINT, {
    method: "POST",
    // text/plain keeps this a simple request, which Apps Script can answer
    // without a CORS preflight.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...payload }),
    redirect: "follow",
  });
  const data = await res.json();
  if (data.authRequired) {
    endSession("Signed out after six hours. Sign in again.");
    throw new Error("signed out");
  }
  if (!data.ok) throw new Error(data.error || "That did not work.");
  return data;
}

/* ---------- sign in / out ---------- */

function saveToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: lasts as long as the page */ }
}

function showGate(message) {
  gate.hidden = false;
  desk.hidden = true;
  signout.hidden = true;
  gateError.textContent = message || "";
  gateError.hidden = !message;
  $("#passcode").value = "";
}

function showDesk() {
  gate.hidden = true;
  desk.hidden = false;
  signout.hidden = false;
}

function endSession(message) {
  stopSharing();
  saveToken("");
  trips = [];
  list.replaceChildren();
  showGate(message);
}

gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const passcode = $("#passcode").value;
  if (!passcode) return;
  gateBtn.disabled = true;
  gateBtn.textContent = "Checking…";
  gateError.hidden = true;
  try {
    const res = await call("driverLogin", { passcode });
    saveToken(res.token);
    showDesk();
    await load();
  } catch (err) {
    gateError.textContent = friendly(err);
    gateError.hidden = false;
  } finally {
    gateBtn.disabled = false;
    gateBtn.textContent = "Sign in";
  }
});

signout.addEventListener("click", () => endSession(""));

function friendly(err) {
  return err instanceof TypeError
    ? "No connection. Check your signal and try again."
    : err.message;
}

/* ---------- loading ---------- */

async function load() {
  note.textContent = "Loading…";
  note.hidden = false;
  try {
    const res = await call("driverList");
    trips = res.trips || [];
    notify = res.notify || {};
    isAdmin = !!res.admin;
    // Tab, signed in with her desk passcode, sees every driver's trips.
    $("#me").textContent = res.admin
      ? "Every driver's confirmed trips, soonest first."
      : `Signed in as ${res.me}. Your confirmed trips, soonest first.`;
    render();
    note.hidden = true;
  } catch (err) {
    if (err.message === "signed out") return;
    note.textContent = friendly(err);
    note.hidden = false;
  }
}

$("#refresh").addEventListener("click", load);

// Back from the maps app or a call: show what the sheet holds now.
addEventListener("visibilitychange", () => {
  if (!document.hidden && token && !desk.hidden) load();
});

// Keep the countdowns honest while the page sits open.
setInterval(() => { if (!document.hidden && trips.length) render(); }, 60000);

/* ---------- rendering ---------- */

const FACTS = [
  ["passengers", "Passengers"],
  ["luggage", "Bags"],
  ["flight", "Flight"],
  ["tripType", "Trip"],
  ["returnDate", "Return date"],
  ["returnTime", "Return time"],
  ["notes", "Rider's notes", true],
];

const fmtDate = (v) => {
  const [y, m, d] = String(v).split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtTime = (v) => {
  const [h, m] = String(v).split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return v;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const digits = (v) => String(v).replace(/\D/g, "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "2026-11-18 15:10" from the sheet -> "3:10 PM"
function stampTime(v) {
  const m = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(String(v || ""));
  return m ? fmtTime(m[1]) : "";
}

/** The trip's pickup as a Date, from the sheet's own date and time strings. */
function pickupAt(t) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.date || ""));
  const h = /^(\d{2}):(\d{2})$/.exec(String(t.time || ""));
  if (!d || !h) return null;
  // Built in the phone's own timezone, which for TPT's drivers is the fleet's.
  return new Date(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
}

/** "in 3 hours", "in 20 minutes", "now", "40 minutes ago". */
function countdown(when, now = Date.now()) {
  const mins = Math.round((when.getTime() - now) / 60000);
  const n = Math.abs(mins);
  if (n < 1) return "now";
  const text = n < 60 ? plural(n, "minute") : n < 60 * 36 ? plural(Math.round(n / 60), "hour") : plural(Math.round(n / 1440), "day");
  return mins < 0 ? `${text} ago` : `in ${text}`;
}

/** "Today", "Tomorrow", "Yesterday", or the date. */
function dayLabel(dateStr) {
  const when = pickupAt({ date: dateStr, time: "12:00" });
  if (!when) return dateStr;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((when - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDate(dateStr);
}

// Apple Maps on an iPhone; the same link opens Google Maps everywhere else.
const directions = (place) => `https://maps.apple.com/?daddr=${encodeURIComponent(place)}`;

function render() {
  const nodes = [];
  let day = "";
  trips.forEach((t) => {
    if (t.trip.date !== day) {
      day = t.trip.date;
      const h = $("#day-tpl").content.firstElementChild.cloneNode(true);
      h.textContent = dayLabel(day);
      nodes.push(h);
    }
    nodes.push(card(t));
  });
  list.replaceChildren(...nodes);
  empty.hidden = trips.length > 0;
  updateSharing();
}

function card(r) {
  const el = $("#trip-tpl").content.firstElementChild.cloneNode(true);
  const t = r.trip;

  $(".drv-time", el).textContent = fmtTime(t.time);
  $(".res-ref", el).textContent = r.ref;
  const when = pickupAt(t);
  const cd = $(".res-countdown", el);
  if (when && !r.tripDone) {
    const soon = when.getTime() - Date.now();
    cd.textContent = countdown(when);
    if (soon > 0 && soon < 2 * 3600e3) cd.dataset.soon = "true";
    if (soon <= 0) cd.dataset.past = "true";
  }
  if (r.tripDone) el.classList.add("is-done");

  $(".res-trip", el).textContent = t.service;
  if (r.driver) {
    const who = $(".drv-driver", el);
    who.textContent = `Driver: ${r.driver}`;
    who.hidden = false;
  }
  $(".res-pickup", el).textContent = t.pickup;
  $(".res-dropoff", el).textContent = t.dropoff;
  $(".drv-nav-pickup", el).href = directions(t.pickup);
  $(".drv-nav-dropoff", el).href = directions(t.dropoff);

  const facts = $(".res-facts", el);
  const rows = FACTS.filter(([key]) => t[key]).map(([key, label, wide]) => [label, t[key], wide, key]);
  if (r.note) rows.push(["From Tab", r.note, true, "note"]);
  rows.forEach(([label, value, wide, key]) => {
    // Each label and value share one grid cell, or they wrap independently
    // and a value ends up under somebody else's label.
    const pair = document.createElement("div");
    pair.className = wide ? "fact wide" : "fact";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = /date$/i.test(key) ? fmtDate(value) : /time$/i.test(key) ? fmtTime(value) : value;
    pair.append(dt, dd);
    facts.append(pair);
  });

  $(".res-name", el).textContent = t.name;
  $(".res-tel", el).href = `tel:+1${digits(t.phone)}`;
  $(".res-sms", el).href = `sms:+1${digits(t.phone)}`;

  const msg = $(".res-msg", el);
  const say = (text, kind) => {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = !text;
  };

  // The next step to take is the gold one; steps already taken show their time.
  const next = STEPS.find((s) => !r[s.key]);
  STEPS.forEach((s) => {
    const btn = $(`.drv-step[data-step="${s.key}"]`, el);
    if (r[s.key]) {
      btn.textContent = `✓ ${s.done} · ${stampTime(r[s.key])}`;
      btn.classList.add("btn-quiet", "is-stamped");
      btn.disabled = true;
      return;
    }
    btn.classList.add(s === next ? "btn-action" : "btn-quiet");
    btn.addEventListener("click", () => tap(r, s, el, say));
  });

  return el;
}

async function tap(r, step, el, say) {
  const first = r.trip.name.split(/\s+/)[0] || "The rider";
  const told = notify[step.key] ? `\n\n${first} ${step.ask} by email.` : "";
  if (!window.confirm(`${step.label}: ${r.ref}?${told}`)) return;

  el.classList.add("is-busy");
  say("Saving…", "ok");
  try {
    const res = await call("driverStatus", { ref: r.ref, step: step.key });
    // Swap in the row the sheet holds now, so the card never drifts from it.
    const i = trips.findIndex((x) => x.ref === r.ref);
    if (i > -1) trips[i] = res.trip;
    render();
  } catch (err) {
    el.classList.remove("is-busy");
    if (err.message !== "signed out") say(friendly(err), "error");
  }
}

/* ---------- live location ----------
   From "On the way" until "Trip done", this phone's position goes to the
   script every 15 seconds and the rider watches it on track.html. A web page
   can only do that while it is open on screen, so the screen is kept awake
   and the banner says plainly when sharing has paused. */

const SEND_EVERY = 15000;
const share = $("#share");
const shareHead = $("#share-head");
const shareNote = $("#share-note");
let watchId = null;
let lastFix = null;
let lastSent = 0;
let sendTimer = null;
let wakeLock = null;
// Trips the script said to stop sending for (taken off this driver, or done).
const stopped = new Set();

/** The trips this phone should be sharing for right now. */
function sharingTrips() {
  return trips.filter((t) =>
    (t.onTheWay || t.arrived) && !t.tripDone && !stopped.has(t.ref) &&
    // Signed in as Tab, only the trips nobody else is driving are hers.
    (!isAdmin || !t.driver));
}

function updateSharing() {
  const live = sharingTrips();
  if (!live.length) return stopSharing();
  const names = live.map((t) => t.trip.name.split(/\s+/)[0]).join(" and ");
  share.hidden = false;
  shareHead.textContent = `${names} can see you on a map.`;
  if (watchId === null) startSharing();
  else showShareState();
}

function startSharing() {
  if (!("geolocation" in navigator)) {
    shareNote.textContent = "This phone cannot share its location from a web page.";
    share.dataset.state = "error";
    return;
  }
  shareNote.textContent = "Finding your location…";
  share.dataset.state = "waiting";
  watchId = navigator.geolocation.watchPosition(onFix, onFixError,
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  // Sitting still at the pickup, the phone may report nothing new; resend
  // the last fix so the rider's map does not go stale while they walk out.
  sendTimer = setInterval(() => { if (lastFix) sendFix(); }, SEND_EVERY);
  keepAwake();
}

function stopSharing() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(sendTimer);
  sendTimer = null;
  lastFix = null;
  lastSent = 0;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  share.hidden = true;
}

function onFix(pos) {
  lastFix = pos;
  if (Date.now() - lastSent >= SEND_EVERY) sendFix();
}

function onFixError(err) {
  share.dataset.state = "error";
  shareNote.textContent = err.code === err.PERMISSION_DENIED
    ? "Location is blocked for this page. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then reload."
    : "Cannot get a location fix right now. It keeps trying.";
}

async function sendFix() {
  const live = sharingTrips();
  if (!live.length || !lastFix) return;
  lastSent = Date.now();
  const { latitude, longitude, accuracy, heading } = lastFix.coords;
  for (const t of live) {
    try {
      await call("driverLocation", { ref: t.ref, lat: latitude, lng: longitude, accuracy, heading });
    } catch (err) {
      if (err.message === "signed out") return;
      // The script says this trip is no longer this phone's to share.
      if (/assigned|only shared|find/i.test(err.message)) stopped.add(t.ref);
      else { share.dataset.state = "error"; shareNote.textContent = friendly(err); return; }
    }
  }
  if (!sharingTrips().length) return stopSharing();
  showShareState();
}

function showShareState() {
  if (!lastSent) return;
  share.dataset.state = "live";
  const at = new Date(lastSent).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  shareNote.textContent = `Last sent ${at}. Keep this page open on screen: it pauses if the phone locks or you switch apps.`;
}

// The screen staying on is what keeps the page, and so the sharing, alive.
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* not supported, or refused: the banner already says to keep it open */ }
}

addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (watchId !== null) {
      share.dataset.state = "paused";
      shareNote.textContent = "Paused while this page is not on screen.";
    }
    return;
  }
  // Back on screen: the lock was dropped when the page went away.
  if (watchId !== null) { keepAwake(); if (lastFix) sendFix(); }
});

/* ---------- start ---------- */

if (token) {
  showDesk();
  load();
} else {
  showGate("");
}
