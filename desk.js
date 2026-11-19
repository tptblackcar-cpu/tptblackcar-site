// TPT Desk: Tab's app for requests, quotes, trips, reviews and drivers.
// It talks to the same Apps Script web app as the booking form, with the same
// actions the old desk used. BOOKING_ENDPOINT comes from config.js.

// GitHub Pages cannot send a frame-blocking header, so refuse to run inside
// someone else's page, where buttons could be overlaid and clicked unseen.
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error("framed");
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- storage ----------
   "Keep me signed in" keeps the token in localStorage, so closing the app does
   not sign Tab out. Without it the token dies with the tab, as before, for a
   borrowed phone. The script's own session still ends after six hours. */

const TOKEN_KEY = "tpt.admin.token";
const EXPIRES_KEY = "tpt.admin.expires";
const KEEP_KEY = "tpt.desk.keep";
const INSTALL_KEY = "tpt.desk.installDismissed";

function store(kind) {
  try { return kind === "local" ? localStorage : sessionStorage; } catch { return null; }
}
function readToken() {
  for (const s of [store("local"), store("session")]) {
    try {
      const t = s && s.getItem(TOKEN_KEY);
      const exp = Number(s && s.getItem(EXPIRES_KEY)) || 0;
      if (t && (!exp || exp > Date.now())) return t;
    } catch { /* blocked storage: sign in each time */ }
  }
  return "";
}
function saveToken(t, seconds, keep) {
  const s = store(keep ? "local" : "session");
  try {
    s.setItem(TOKEN_KEY, t);
    s.setItem(EXPIRES_KEY, String(Date.now() + (seconds || 21600) * 1000));
    store("local").setItem(KEEP_KEY, keep ? "1" : "0");
  } catch { /* still signed in for this visit */ }
}
function clearToken() {
  for (const s of [store("local"), store("session")]) {
    try { s.removeItem(TOKEN_KEY); s.removeItem(EXPIRES_KEY); } catch {}
  }
}

let token = readToken();
let reservations = [];
let drivers = [];
let reviews = [];
let loadedAt = 0;
let loading = null;

/* ---------- transport ---------- */

async function call(action, payload = {}) {
  if (!BOOKING_ENDPOINT) throw new Error("The app isn't connected to the booking system yet.");
  const res = await fetch(BOOKING_ENDPOINT, {
    method: "POST",
    // text/plain keeps this a simple request, which Apps Script can answer
    // without a CORS preflight.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...payload }),
    redirect: "follow",
  });
  let data;
  try {
    data = await res.json();
  } catch {
    // Apps Script answers with an HTML page when it is down or over quota.
    throw new Error("The booking desk sent back something unexpected. Try again in a minute.");
  }
  if (data.authRequired) {
    endSession("Your session ended. Sign in again.");
    throw new Error("signed out");
  }
  if (!data.ok) throw new Error(data.error || "That did not work.");
  return data;
}

function friendly(err) {
  if (!navigator.onLine) return "No signal. Try again when you're back online.";
  return err instanceof TypeError ? "Could not reach the booking desk. Check your connection." : err.message;
}

/* ---------- little DOM helpers ----------
   Everything a rider typed goes in as text nodes, never as HTML. */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function icon(name, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `i ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

let toastTimer;
function toast(text, kind = "ok") {
  const t = $("#toast");
  t.textContent = text;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === "error" ? 6000 : 3200);
}

/* ---------- dates and words ---------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const digits = (v) => String(v || "").replace(/\D/g, "");
const tel = (v) => { const d = digits(v); return d.length === 10 ? `+1${d}` : d ? `+${d}` : ""; };
const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";
const initials = (v) => String(v || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();

const fmtDate = (v) => {
  const [y, m, d] = String(v).split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtTime = (v) => {
  const [hh, mm] = String(v).split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return v;
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const clock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "2026-11-01 09:14" from the sheet -> a Date
function parseStamp(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(v || "").trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
function fmtStamp(v) {
  const d = parseStamp(v);
  return d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : String(v || "");
}

/** The trip's pickup as a Date, from the sheet's own date and time strings. */
function pickupAt(t) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.date || ""));
  const hm = /^(\d{2}):(\d{2})$/.exec(String(t.time || ""));
  if (!d || !hm) return null;
  // Built in the viewer's own timezone, which for Tab Butler is the fleet's.
  return new Date(+d[1], +d[2] - 1, +d[3], +hm[1], +hm[2]);
}

/** "in 2 h 10 min", "in 3 days", "20 min ago" */
function countdown(when, now = Date.now()) {
  if (!when) return "";
  const mins = Math.round((when.getTime() - now) / 60000);
  const n = Math.abs(mins);
  if (n < 1) return "now";
  let text;
  if (n < 60) text = `${n} min`;
  else if (n < 60 * 24) text = n % 60 && n < 600 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${Math.round(n / 60)} h`;
  else text = plural(Math.round(n / 1440), "day");
  return mins < 0 ? `${text} ago` : `in ${text}`;
}

/** "12 min ago" for when a request came in. */
function ago(v) {
  const d = parseStamp(v);
  if (!d) return "";
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusOf(r) {
  const s = String(r.status || "New").trim();
  return s || "New";
}
const isOff = (r) => /^(cancelled|declined)$/i.test(statusOf(r));
const isConfirmed = (r) => statusOf(r).toLowerCase() === "confirmed";
/** Under way: the driver has tapped On the way, and not yet Trip done. */
const isLive = (r) => isConfirmed(r) && (r.onTheWay || r.arrived) && !r.tripDone;
// Location goes out only while the car is coming: once the rider is in, the
// car's position would be theirs.
const isSharing = (r) => isConfirmed(r) && r.onTheWay && !r.arrived && !r.tripDone;

/** A confirmed trip nobody has started stays on hand this long past pickup, in
    case the driver is running late. */
const LATE_GRACE_MS = 4 * 60 * 60 * 1000;

/** Still to happen, and not called off. */
function isUpcoming(r) {
  if (isOff(r) || r.tripDone) return false;
  const when = pickupAt(r.trip);
  if (isLive(r)) return true;
  if (!when) return false;
  const until = when.getTime() + (isConfirmed(r) ? LATE_GRACE_MS : 0);
  return until > Date.now();
}

const SERVICE_ICON = [
  [/airport/i, "plane"], [/corporate/i, "brief"], [/wedding/i, "ring"],
  [/event/i, "spark"], [/funeral/i, "lily"], [/personal/i, "car"],
];
const serviceIcon = (s) => (SERVICE_ICON.find(([re]) => re.test(s || "")) || [, "car"])[1];
const serviceShort = (s) => String(s || "Trip").replace(/ (Service|Function|Car Service)$/i, "").replace(/^Special /, "");

const activeDrivers = () => drivers.filter((d) => d.active);
const driverOf = (name) => drivers.find((d) => d.name === name);
// The name the script writes when Tab keeps a trip for herself ("Me").
let selfName = "Tab";
const isMe = (name) => !!name && name.toLowerCase() === selfName.toLowerCase();
/** Tab drives a trip she kept for herself, or one nobody else has been given. */
const tabDrives = (r) => !r.driver || isMe(r.driver);
const drivingLine = (r) => tabDrives(r) ? "You're driving" : `${r.driver} driving`;

const DRIVER_COLORS = ["#6fa8dc", "#b48ee0", "#5fc0b0", "#e0a35f", "#d97aa0"];
function driverColor(name) {
  if (!name || isMe(name)) return "var(--color-gold)";
  const i = drivers.findIndex((d) => d.name === name);
  return DRIVER_COLORS[(i < 0 ? 0 : i) % DRIVER_COLORS.length];
}

const STEPS = [["onTheWay", "On the way"], ["arrived", "Arrived"], ["tripDone", "Trip done"]];
const nextStep = (r) => STEPS.find(([k]) => !r[k]);
/** Start trip only shows from three hours before pickup, so it is not tapped days early. */
const canStart = (r) => isLive(r) || ((pickupAt(r.trip) || 0) - Date.now() < 3 * 3600e3);
const STEP_BUTTON = { onTheWay: "Start trip", arrived: "I've arrived", tripDone: "Trip done" };

/* ---------- sign in / out ---------- */

function greet() {
  const hr = new Date().getHours();
  $("#greeting").textContent = `${hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"}, Tab`;
}

function showGate(message) {
  greet();
  $("#gate").hidden = false;
  $("#views").hidden = true;
  $("#tabbar").hidden = true;
  $("#detail").hidden = true;
  $("#gate-error").textContent = message || "";
  $("#gate-error").hidden = !message;
  $("#passcode").value = "";
  try { $("#keep").checked = store("local").getItem(KEEP_KEY) !== "0"; } catch {}
}

function showApp() {
  $("#gate").hidden = true;
  $("#views").hidden = false;
  $("#tabbar").hidden = false;
}

function endSession(message) {
  token = "";
  clearToken();
  reservations = [];
  reviews = [];
  drivers = [];
  stopSharing();
  stopFleet();
  setBadge(0);
  showGate(message);
}

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const passcode = $("#passcode").value;
  if (!passcode) return;
  const btn = $("#gate-btn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  $("#gate-error").hidden = true;
  try {
    const res = await call("login", { passcode });
    token = res.token;
    saveToken(token, res.expiresInSeconds, $("#keep").checked);
    showApp();
    if (!location.hash || location.hash === "#") location.replace("#today");
    route();
    await loadAll();
  } catch (err) {
    if (err.message === "signed out") return;
    $("#gate-error").textContent = friendly(err);
    $("#gate-error").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

$("#signout").addEventListener("click", async () => {
  if (await ask({ title: "Sign out?", text: "You'll need the passcode to get back in.", yes: "Sign out" })) endSession("");
});

/* ---------- loading ---------- */

function loadAll({ quiet = false } = {}) {
  if (loading) return loading;
  $$("[data-refresh]").forEach((b) => b.classList.add("spin"));
  if (!quiet && !reservations.length) { $("#note").textContent = "Loading your trips…"; $("#note").hidden = false; }
  loading = Promise.allSettled([call("list"), call("reviewList")])
    .then(([list, rv]) => {
      if (list.status === "fulfilled") {
        reservations = list.value.reservations || [];
        drivers = list.value.drivers || [];
        if (list.value.self) selfName = list.value.self;
        loadedAt = Date.now();
        $("#note").hidden = true;
      } else if (list.reason.message !== "signed out") {
        $("#note").textContent = friendly(list.reason);
        $("#note").hidden = false;
      }
      if (rv.status === "fulfilled") reviews = rv.value.reviews || [];
      renderAll();
      updateSharing();
    })
    .finally(() => {
      loading = null;
      $$("[data-refresh]").forEach((b) => b.classList.remove("spin"));
    });
  return loading;
}

$$("[data-refresh]").forEach((b) => b.addEventListener("click", () => loadAll()));

// Coming back to the app after a while should not show a stale list.
addEventListener("visibilitychange", () => {
  if (!document.hidden && token && Date.now() - loadedAt > 30000) loadAll({ quiet: true });
});
// Countdowns move on by themselves.
setInterval(() => { if (!document.hidden && token) renderToday(); }, 60000);

function renderAll() {
  renderBadges();
  renderToday();
  renderTrips();
  renderSchedule();
  renderReviews();
  renderDrivers();
  // The fleet names its cars from the trips, which may have just arrived.
  if (fleet && currentTab === "drivers") drawFleet();
  if (openRef) renderDetail();
}

function renderBadges() {
  const fresh = reservations.filter((r) => statusOf(r) === "New").length;
  const waiting = reviews.filter((r) => r.status === "Pending").length;
  const set = (k, n) => { const b = $(`[data-badge="${k}"]`); b.textContent = n; b.hidden = !n; };
  set("trips", fresh);
  set("reviews", waiting);
  setBadge(fresh + waiting);
}

// The number on the Home Screen icon (Android, and iPhone once installed).
function setBadge(n) {
  try {
    // Both return promises, which iPhone rejects without notification permission.
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* not supported */ }
}

/* ---------- routing ----------
   #today #trips #trips/New #schedule #reviews #drivers #trip/TPT-XXXX
   The phone's back gesture moves through these like any app. */

const TABS = ["today", "trips", "schedule", "reviews", "drivers"];
let currentTab = "today";
let openRef = "";
let tripFilter = "New";
let enteredDetailFromApp = false;

function route() {
  if (!token) return;
  let hash = location.hash.slice(1);
  try { hash = decodeURIComponent(hash); } catch { /* a mangled link: use it as typed */ }
  const [name, arg] = hash.split("/");
  if (name === "trip" && arg) {
    openRef = arg;
    $("#detail").hidden = false;
    renderDetail();
    return;
  }
  openRef = "";
  $("#detail").hidden = true;
  const tab = TABS.includes(name) ? name : "today";
  if (tab === "trips" && arg) tripFilter = arg;
  if (tab !== currentTab) scrollTo(0, 0);
  currentTab = tab;
  TABS.forEach((t) => { $(`#view-${t}`).hidden = t !== tab; });
  $$("#tabbar a").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (tab === "trips") renderTrips();
  if (tab === "drivers") startFleet(); else stopFleet();
}
addEventListener("hashchange", route);

function openTrip(ref) {
  enteredDetailFromApp = true;
  location.hash = `#trip/${encodeURIComponent(ref)}`;
}
function closeTrip() {
  if (enteredDetailFromApp) history.back();
  else location.hash = "#trips";
  enteredDetailFromApp = false;
}

/* ---------- Today ----------
   Three things only: the next trip, what needs Tab, and what's left today. */

function renderToday() {
  $("#today-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const ahead = reservations.filter((r) => isConfirmed(r) && isUpcoming(r))
    .sort((a, b) => (isLive(b) - isLive(a)) || (pickupAt(a.trip) - pickupAt(b.trip)));
  const next = ahead[0];
  $("#next").replaceChildren(next ? nextCard(next) : h("div", { class: "next none" },
    h("p", { text: reservations.length ? "No confirmed trips coming up." : "No trips yet." }),
    h("a", { class: "btn sm", href: "#trips/Upcoming" }, "See all trips")));

  const fresh = reservations.filter((r) => statusOf(r) === "New").length;
  const quoted = reservations.filter((r) => statusOf(r) === "Quoted" && isUpcoming(r)).length;
  const pending = reviews.filter((r) => r.status === "Pending").length;
  const rows = [];
  if (fresh) rows.push(todoRow("hot", fresh, fresh === 1 ? "New request" : "New requests", "Waiting for a quote", "#trips/New"));
  if (quoted) rows.push(todoRow("", quoted, quoted === 1 ? "Quote out" : "Quotes out", "Priced, not sent. Tell the rider, then Confirm & email", "#trips/Quoted"));
  if (pending) rows.push(todoRow("", pending, pending === 1 ? "Review to approve" : "Reviews to approve", "", "#reviews"));
  if (!rows.length) rows.push(todoRow("ok", icon("check"), "All caught up", "Nothing waiting on you", ""));
  $("#todo").replaceChildren(...rows);

  const today = dayKey(new Date());
  const todays = reservations.filter((r) => isConfirmed(r) && r.trip.date === today);
  const rest = todays.filter((r) => r !== next && isUpcoming(r)).sort((a, b) => pickupAt(a.trip) - pickupAt(b.trip));
  const done = todays.filter((r) => r.tripDone).length;
  const later = [];
  if (rest.length) {
    later.push(h("h2", { class: "sec", text: "Later today" }));
    rest.forEach((r) => {
      const when = pickupAt(r.trip);
      later.push(h("button", { type: "button", class: "later-row", onclick: () => openTrip(r.ref) },
        h("span", { class: "later-tm num", text: when ? clock(when) : fmtTime(r.trip.time) }),
        h("span", { class: "later-w" }, `${serviceShort(r.trip.service)} · ${r.trip.name}`,
          h("small", { text: r.driver ? drivingLine(r) : r.trip.pickup })),
        icon("chev-r")));
    });
  }
  if (done) later.push(h("p", { class: "later-done", text: `${plural(done, "trip")} done today` }));
  $("#later").replaceChildren(...later);
}

function todoRow(kind, n, title, sub, href) {
  return h(href ? "a" : "div", { class: `todo-row ${kind}`, href: href || null },
    h("span", { class: "todo-n num" }, n),
    h("span", { class: "todo-t" }, title, sub ? h("small", { text: sub }) : null),
    href ? icon("chev-r") : null);
}

function nextCard(r) {
  const t = r.trip;
  const when = pickupAt(t);
  const live = isLive(r);
  const step = nextStep(r);
  const card = h("div", { class: "next", role: "link", tabindex: "0", onclick: (e) => { if (!e.target.closest("a,button")) openTrip(r.ref); } },
    h("div", { class: "next-head" },
      h("span", { class: "next-lbl", text: `${live ? "Under way" : "Next trip"} · ${serviceShort(t.service)}` }),
      live ? h("span", { class: "pill", "data-s": "Live", text: r.arrived ? "Arrived" : "On the way" }) : null),
    h("p", { class: "next-when num", text: when ? clock(when) : fmtTime(t.time) }),
    h("p", { class: "next-in", text: `${when && when.toDateString() !== new Date().toDateString() ? fmtDate(t.date) + " · " : ""}${live ? "pickup " : ""}${countdown(when)} · ${t.name}` }),
    routeBlock(t, false),
    r.driver && !isMe(r.driver) ? h("p", { class: "next-by", text: `${r.driver} is driving` }) : null,
    h("div", { class: "next-acts" },
      h("a", { class: "btn", href: `tel:${tel(t.phone)}` }, icon("phone"), "Call"),
      tabDrives(r) && step && canStart(r)
        ? h("button", { type: "button", class: "btn gold", onclick: (e) => stamp(r, step[0], e.currentTarget) }, STEP_BUTTON[step[0]])
        : h("button", { type: "button", class: "btn gold", onclick: () => openTrip(r.ref) }, "Open trip")));
  if (tabDrives(r) && isSharing(r)) card.append(shareBox());
  return card;
}

function routeBlock(t, withDirections) {
  const dir = (place) => withDirections
    ? h("a", { class: "dir", href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}`, target: "_blank", rel: "noopener" }, "Directions")
    : null;
  return h("div", { class: "route" },
    h("div", { class: "stop" }, withDirections ? h("span", { class: "lbl", text: "Pickup" }) : null, h("p", { text: t.pickup }), dir(t.pickup)),
    h("div", { class: "stop" }, withDirections ? h("span", { class: "lbl", text: "Drop-off" }) : null, h("p", { text: t.dropoff }), dir(t.dropoff)));
}

/* ---------- Trips ---------- */

const search = $("#search");
search.addEventListener("input", () => renderTrips());
$$("#trip-seg button").forEach((b) => b.addEventListener("click", () => {
  tripFilter = b.dataset.filter;
  history.replaceState(null, "", `#trips/${tripFilter}`);
  renderTrips();
}));

function renderTrips() {
  const counts = { New: 0, Quoted: 0, Upcoming: 0 };
  reservations.forEach((r) => {
    const s = statusOf(r);
    if (s === "New") counts.New++;
    if (s === "Quoted") counts.Quoted++;
    if (isConfirmed(r) && isUpcoming(r)) counts.Upcoming++;
  });
  $$("[data-count]").forEach((b) => { b.textContent = counts[b.dataset.count] || ""; });
  $$("#trip-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filter === tripFilter)));

  const q = search.value.trim().toLowerCase();
  let shown =
    tripFilter === "New" ? reservations.filter((r) => statusOf(r) === "New")
    : tripFilter === "Quoted" ? reservations.filter((r) => statusOf(r) === "Quoted")
    : tripFilter === "Upcoming" ? reservations.filter((r) => isConfirmed(r) && isUpcoming(r))
        .sort((a, b) => pickupAt(a.trip) - pickupAt(b.trip))
    : reservations;
  if (q) {
    shown = reservations.filter((r) => [r.ref, r.trip.name, r.trip.pickup, r.trip.dropoff, r.trip.service, r.trip.email, r.trip.phone, r.driver]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }

  $("#trip-list").replaceChildren(...shown.map(tripCard));
  const empty = $("#trip-empty");
  empty.hidden = shown.length > 0;
  empty.textContent = q ? "Nothing matches that." : !reservations.length ? "No reservations yet."
    : { New: "No new requests. All caught up.", Quoted: "No quotes waiting.", Upcoming: "No trips coming up.", All: "Nothing here." }[tripFilter];
  $("#swipe-hint").hidden = !shown.some((r) => statusOf(r) === "New");
}

function tripCard(r) {
  const t = r.trip;
  const s = statusOf(r);
  const when = pickupAt(t);
  const unread = s === "New";
  const face = h("button", { type: "button", class: `req-face${unread ? " unread" : ""}`, onclick: () => {
    if (wrap.dataset.swiped) return;
    // A tap on a card that is swiped open just closes it again.
    if (wrap.dataset.open) { delete wrap.dataset.open; face.style.transform = ""; return; }
    openTrip(r.ref);
  } },
    h("span", { class: "req-h" },
      h("span", { class: "req-svc" }, icon(serviceIcon(t.service)), serviceShort(t.service)),
      unread ? h("span", { class: "req-ago" }, h("i", { class: "dot" }), ago(r.received))
        : h("span", { class: "pill", "data-s": isLive(r) ? "Live" : r.tripDone ? "Done" : s, text: isLive(r) ? "Under way" : r.tripDone ? "Done" : s })),
    h("span", { class: "req-dt num", style: "display:block", text: `${fmtDate(t.date)} · ${fmtTime(t.time)}${when && isUpcoming(r) && !unread ? " · " + countdown(when) : ""}` }),
    routeBlock(t, false),
    h("span", { class: "req-meta" },
      h("span", null, icon("user"), t.passengers || "1"),
      t.luggage && t.luggage !== "0" ? h("span", null, icon("bag"), t.luggage) : null,
      t.tripType === "Round trip" ? h("span", { text: "Round trip" }) : null,
      h("span", { class: "nm", text: r.driver && isConfirmed(r) ? `${t.name} · ${isMe(r.driver) ? "You" : r.driver}` : t.name })));
  const wrap = h("article", { class: "req" });
  if (s === "New" || s === "Quoted") {
    wrap.append(h("div", { class: "req-under" },
      h("button", { type: "button", class: "d", onclick: () => decline(r) }, icon("x"), "Decline"),
      h("button", { type: "button", class: "q", onclick: () => openQuote(r) }, icon("send"), "Quote")));
    swipeable(wrap, face);
  }
  wrap.append(face);
  return wrap;
}

/** Drag a card left to show its two actions underneath. */
function swipeable(wrap, face) {
  const OPEN = -144;
  let x0 = 0, y0 = 0, dx = 0, base = 0, dragging = false, decided = false;
  face.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = true; decided = false;
    base = wrap.dataset.open ? OPEN : 0;
  });
  face.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      if (Math.abs(my) > Math.abs(mx)) { dragging = false; return; }
      wrap.classList.add("dragging");
      try { face.setPointerCapture(e.pointerId); } catch { /* the finger already left */ }
    }
    dx = Math.max(OPEN - 30, Math.min(0, base + mx));
    face.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove("dragging");
    if (!decided) return;
    const open = dx < OPEN / 2;
    face.style.transform = open ? `translateX(${OPEN}px)` : "";
    if (open) wrap.dataset.open = "1"; else delete wrap.dataset.open;
    // The lift of the finger should not also count as a tap on the card.
    wrap.dataset.swiped = "1";
    setTimeout(() => { delete wrap.dataset.swiped; }, 350);
  };
  face.addEventListener("pointerup", end);
  face.addEventListener("pointercancel", end);
}

/* ---------- one trip ---------- */

$("#detail").addEventListener("click", (e) => { if (e.target.closest("[data-back]")) closeTrip(); });

function renderDetail() {
  const pane = $("#detail");
  const r = reservations.find((x) => x.ref === openRef);
  if (!r) {
    pane.replaceChildren(h("div", { class: "d-scroll" }, h("div", { class: "d-in" },
      h("div", { class: "d-bar" }, backBtn()),
      h("p", { class: "empty", text: loading || !loadedAt ? "Loading…" : `Could not find ${openRef}.` }))));
    return;
  }
  const t = r.trip;
  const s = statusOf(r);
  const when = pickupAt(t);
  const kids = [];

  kids.push(h("div", { class: "d-bar" }, backBtn(),
    h("div", { class: "grow" }, h("div", { class: "d-ref num", text: r.ref }), h("div", { class: "d-sub", text: `Received ${fmtStamp(r.received)}` })),
    h("span", { class: "pill", "data-s": isLive(r) ? "Live" : s, text: isLive(r) ? "Under way" : s }),
    moreActions(r).length ? h("button", { type: "button", class: "ico-btn", "aria-label": "More", onclick: () => openMore(r) }, icon("dots")) : null));

  kids.push(h("p", { class: "d-kind", text: [t.service, t.tripType].filter(Boolean).join(" · ") }));
  kids.push(h("h1", { class: "d-when num", id: "d-when", text: `${fmtDate(t.date)}, ${fmtTime(t.time)}` }));
  if (when && isUpcoming(r)) kids.push(h("p", { class: "d-cd", text: countdown(when) }));

  if (isConfirmed(r)) {
    const doneN = STEPS.filter(([k]) => r[k]).length;
    const now = nextStep(r);
    kids.push(h("div", { class: "steps", style: `--done:${Math.max(0, doneN - 1)}` },
      STEPS.map(([k, label]) => h("div", { class: `step${r[k] ? " done" : now && now[0] === k ? " now" : ""}` },
        h("i", null, r[k] ? icon("check") : null), label,
        r[k] ? h("small", { text: fmtStamp(r[k]).replace(/^.*?, /, "") }) : null))));
    if (tabDrives(r) && isSharing(r)) kids.push(shareBox());
  }

  kids.push(h("div", { class: "card" }, routeBlock(t, true)));

  const facts = [];
  if (t.flight) facts.push(fact("plane", t.flight, "Flight"));
  if (t.returnDate) facts.push(fact("calplus", `${fmtDate(t.returnDate)}${t.returnTime ? ", " + fmtTime(t.returnTime) : ""}`, "Return"));
  facts.push(fact("user", plural(Number(t.passengers) || 1, "passenger")));
  facts.push(fact("bag", plural(Number(t.luggage) || 0, "bag")));
  kids.push(h("div", { class: "facts" }, facts));

  kids.push(h("div", { class: "contact" },
    h("span", { class: "avatar", text: initials(t.name) }),
    h("div", { class: "grow" }, h("b", { text: t.name }), h("small", { text: t.phone || t.email || "" })),
    t.phone ? h("a", { class: "round", href: `tel:${tel(t.phone)}`, "aria-label": `Call ${t.name}` }, icon("phone")) : null,
    t.phone ? h("a", { class: "round", href: `sms:${tel(t.phone)}`, "aria-label": `Text ${t.name}` }, icon("msg")) : null,
    t.email ? h("a", { class: "round", href: `mailto:${encodeURIComponent(t.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Your trip ${r.ref}`)}`, "aria-label": `Email ${t.name}` }, icon("mail")) : null));

  if (t.notes) kids.push(h("p", { class: "note-box", text: t.notes }));
  if (r.quote) kids.push(h("p", { class: "d-line" }, "Quote: ", h("b", { text: r.quote })));
  if (r.note) kids.push(h("p", { class: "d-line" }, "Note to rider: ", h("b", { text: r.note })));
  if (isConfirmed(r) || r.driver) {
    const d = driverOf(r.driver);
    kids.push(h("p", { class: "d-line" }, "Driver: ", h("b", { text: tabDrives(r) ? "You" : r.driver }),
      d && d.phone ? h("a", { href: `tel:${tel(d.phone)}`, style: "margin-left:8px;color:var(--color-gold)" }, "Call") : null));
  }
  if (r.confirmedSent) kids.push(h("p", { class: "d-line ok", text: `Rider emailed ${r.confirmedSent}.` }));
  if (s === "Cancelled") kids.push(h("p", { class: "d-line", text: r.cancelledAt ? `Cancelled ${r.cancelledAt}.` : "Cancelled." }));

  pane.replaceChildren(h("div", { class: "d-scroll" }, h("div", { class: "d-in" }, kids)), actionBar(r));
}

const backBtn = () => h("button", { type: "button", class: "ico-btn", "data-back": true, "aria-label": "Back" }, icon("chev-l"));
const fact = (ic, text, label) => h("div", { class: "fact" }, icon(ic), h("div", null, label ? h("small", { text: label }) : null, text));

/** The bar at the bottom always holds the next step. */
function actionBar(r) {
  const s = statusOf(r);
  const btns = [];
  let hint = "";
  if (s === "New") {
    btns.push(h("button", { type: "button", class: "btn shrink", onclick: () => decline(r) }, "Decline"));
    btns.push(h("button", { type: "button", class: "btn gold", onclick: () => openQuote(r) }, icon("send"), "Quote this trip"));
  } else if (s === "Quoted") {
    btns.push(h("button", { type: "button", class: "btn shrink", onclick: () => openQuote(r) }, "Edit quote"));
    btns.push(h("button", { type: "button", class: "btn gold", onclick: () => openQuote(r) }, "Confirm & email"));
  } else if (isConfirmed(r) && !r.tripDone && tabDrives(r) && canStart(r)) {
    // An unsent confirmation must not hide Start trip, nor Start trip hide the email.
    if (!r.confirmedSent) btns.push(h("button", { type: "button", class: "btn shrink", onclick: () => openQuote(r) }, "Email rider"));
    const step = nextStep(r);
    btns.push(h("button", { type: "button", class: "btn gold lg", onclick: (e) => stamp(r, step[0], e.currentTarget) }, STEP_BUTTON[step[0]]));
    hint = step[0] === "onTheWay" ? `${firstName(r.trip.name)} gets an email and can follow you on a map`
      : step[0] === "arrived" ? `${firstName(r.trip.name)} is told you're there, and your location stops being shared` : `${firstName(r.trip.name)} is thanked and asked for a Google review`;
  } else if (isConfirmed(r) && !r.confirmedSent) {
    btns.push(h("button", { type: "button", class: "btn gold", onclick: () => openQuote(r) }, "Confirm & email rider"));
  } else if (isConfirmed(r) && !r.tripDone) {
    btns.push(h("button", { type: "button", class: "btn", onclick: () => openQuote(r) }, "Change driver or quote"));
  }
  if (!btns.length) return h("span", { hidden: true });
  return h("div", { class: "d-acts" }, h("div", { class: "d-acts-in" }, btns), hint ? h("p", { class: "hint", text: hint }) : null);
}

function moreActions(r) {
  const s = statusOf(r);
  const out = [];
  if (s === "Cancelled" || s === "Declined") return out;
  if (isConfirmed(r)) out.push(["edit", "Change quote, note or driver", () => openQuote(r)]);
  if (r.confirmedSent) out.push(["send", "Send the confirmation again", () => resend(r)]);
  if (s === "New" || s === "Quoted") out.push(["x", "Decline", () => decline(r), true]);
  // Nothing promised yet on a new request, so it is declined, not cancelled.
  if (!(s === "New" && !r.confirmedSent)) out.push(["x", "Cancel trip and email rider", () => cancelTrip(r), true]);
  return out;
}

function openMore(r) {
  const sheet = $("#more-sheet");
  $("#more-list").replaceChildren(...moreActions(r).map(([ic, label, fn, danger]) =>
    h("button", { type: "button", class: danger ? "danger" : null, onclick: () => { sheet.close(); fn(); } }, icon(ic), label)));
  sheet.showModal();
}

/* ---------- saving a trip ---------- */

/** What Tab is told after a save that should have emailed the rider. The server
    says whether it did; "has been emailed" is never assumed. */
const SKIPPED = { "no email": "this trip has no rider email", "already sent": "it had already been sent", error: "the email failed to send" };
function emailNote(res, r, sent) {
  if (res.emailed) return [sent || `Confirmed. ${firstName(r.trip.name)} has been emailed.`, "ok"];
  const why = SKIPPED[res.emailSkipped] || res.emailSkipped || "it was not sent";
  return [`Saved, but no email went: ${why}.`, "error"];
}

async function update(r, payload, working) {
  toast(working);
  try {
    // Only what this action changes. The quote, note and driver stay as the sheet
    // holds them, which may be newer than this copy.
    const res = await call("update", { ref: r.ref, ...payload });
    // Swap in the row the server actually holds now, so the app never drifts from the sheet.
    const i = reservations.findIndex((x) => x.ref === r.ref);
    if (i > -1) reservations[i] = res.reservation;
    renderAll();
    return res;
  } catch (err) {
    if (err.message !== "signed out") toast(friendly(err), "error");
    throw err;
  }
}

async function decline(r) {
  if (!await ask({ title: `Decline ${r.ref}?`, text: `${r.trip.name} is not emailed. Tell them yourself if you want to.`, yes: "Decline", danger: true })) return;
  await update(r, { status: "Declined" }, "Saving…").then(() => toast("Declined.")).catch(() => {});
}

async function cancelTrip(r) {
  if (!await ask({ title: `Cancel ${r.ref}?`, text: `${r.trip.name} is emailed that the trip is called off.`, yes: "Cancel trip", danger: true })) return;
  await update(r, { status: "Cancelled" }, "Cancelling and emailing…").then(() => toast("Cancelled. The rider has been emailed.")).catch(() => {});
}

async function resend(r) {
  if (!await ask({ title: "Send it again?", text: `${r.trip.name} gets the confirmation email again.`, yes: "Send" })) return;
  await update(r, { status: "Confirmed", resend: true }, "Sending again…").then((res) => toast(...emailNote(res, r, "Sent again."))).catch(() => {});
}

/** A driver tap, made by Tab on a trip she is driving herself. */
async function stamp(r, step, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const res = await call("driverStatus", { ref: r.ref, step });
    r[step] = r[step] || (res.trip && res.trip[step]) || stampNow();
    toast(res.emailed ? `Done. ${firstName(r.trip.name)} has been emailed.` : "Done.");
    renderAll();
    updateSharing();
    loadAll({ quiet: true });
  } catch (err) {
    if (err.message !== "signed out") toast(friendly(err), "error");
    renderAll();
  }
}
const stampNow = () => {
  const d = new Date();
  return `${dayKey(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/* ---------- the quote sheet ---------- */

const qSheet = $("#quote-sheet");
const qAmt = $("#q-amt");
const qOther = $("#q-other");
const qNote = $("#q-note");
let qTrip = null;
let qUnit = "flat";
let qDriver = "";

/** "$145 flat" -> {amount:"145", unit:"flat"}; anything else stays as typed. */
function parseQuote(q) {
  const m = /^\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(flat|\/\s*h(?:ou)?r|per hour|an hour|hourly)?\s*$/i.exec(q || "");
  if (!m) return q ? { unit: "other", text: q } : { unit: "flat", amount: "" };
  return { amount: m[1].replace(/,/g, ""), unit: m[2] && !/flat/i.test(m[2]) ? "hour" : "flat" };
}
function composeQuote() {
  if (qUnit === "other") return qOther.value.trim();
  const a = qAmt.value.replace(/[^\d.]/g, "");
  if (!a) return "";
  return qUnit === "hour" ? `$${a}/hour` : `$${a} flat`;
}

function setUnit(u) {
  qUnit = u;
  $$("#q-unit button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.unit === u)));
  $("#q-amt-wrap").hidden = u === "other";
  $("#q-presets").hidden = u === "other";
  $("#q-other-wrap").hidden = u !== "other";
}
// Enter on the number pad must not close the sheet unsaved.
$("#quote-form").addEventListener("submit", (e) => e.preventDefault());
$$("#q-unit button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.unit === "other" && qUnit !== "other" && !qOther.value) qOther.value = composeQuote();
  setUnit(b.dataset.unit);
  markPreset();
}));
qAmt.addEventListener("input", () => {
  qAmt.value = qAmt.value.replace(/[^\d.]/g, "");
  qAmt.style.width = `${Math.max(2, qAmt.value.length + 0.6)}ch`;
  markPreset();
});

/** The prices Tab has quoted before for this kind of trip, most used first. */
function pastPrices(r) {
  const tally = new Map();
  reservations.forEach((x) => {
    if (x.ref === r.ref || !x.quote || x.trip.service !== r.trip.service) return;
    const p = parseQuote(x.quote);
    if (p.unit !== "flat" || !p.amount) return;
    tally.set(p.amount, (tally.get(p.amount) || 0) + 1);
  });
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a).sort((a, b) => a - b);
}

function markPreset() {
  $$("#q-presets button").forEach((b) => b.setAttribute("aria-pressed", String(qUnit === "flat" && b.dataset.amt === qAmt.value)));
}

/** Notes Tab has written to riders before, so she can tap instead of typing. */
function pastNotes() {
  const tally = new Map();
  reservations.forEach((x) => { const n = String(x.note || "").trim(); if (n && n.length <= 60) tally.set(n, (tally.get(n) || 0) + 1); });
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
}

/** Who already has a confirmed trip within two hours of this one. */
function busyNear(r, name) {
  const when = pickupAt(r.trip);
  if (!when) return null;
  return reservations.find((x) => x.ref !== r.ref && isConfirmed(x) && !x.tripDone && x.driver === name &&
    Math.abs((pickupAt(x.trip) || 0) - when) < 2 * 3600e3);
}

function openQuote(r) {
  qTrip = r;
  const s = statusOf(r);
  const t = r.trip;
  $("#q-title").textContent = s === "New" ? `Quote for ${firstName(t.name)}` : isConfirmed(r) ? `Edit ${r.ref}` : `Confirm ${firstName(t.name)}'s trip`;
  $("#q-sub").textContent = `${serviceShort(t.service)}${t.tripType === "Round trip" ? ", round trip" : ""} · ${fmtDate(t.date)}, ${fmtTime(t.time)} · ${plural(Number(t.passengers) || 1, "passenger")}`;
  $("#q-error").hidden = true;

  const p = parseQuote(r.quote);
  qAmt.value = p.amount || "";
  qAmt.style.width = `${Math.max(2, qAmt.value.length + 0.6)}ch`;
  qOther.value = p.unit === "other" ? p.text : "";
  setUnit(p.unit);

  const prices = pastPrices(r);
  $("#q-presets").replaceChildren(...(prices.length ? [h("span", { class: "lbl", text: `Quoted before for ${serviceShort(t.service)}` })] : []),
    ...prices.map((a) => h("button", { type: "button", class: "num", "data-amt": a, onclick: () => { qAmt.value = a; setUnit("flat"); qAmt.dispatchEvent(new Event("input")); } }, `$${a}`)));
  markPreset();

  qNote.value = r.note || "";
  $("#q-notes").replaceChildren(...pastNotes().map((n) => h("button", { type: "button", class: "chip", "aria-pressed": String(qNote.value === n),
    onclick: (e) => { qNote.value = n; $$("#q-notes .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, n)));

  // "Auto" leaves it to the script, which picks a free driver on confirming;
  // "Me" keeps the trip Tab's, and the script never hands it to anyone.
  qDriver = isMe(r.driver) ? selfName : r.driver || "";
  const team = drivers.filter((d) => d.active || d.name === r.driver);
  $("#q-driver-wrap").hidden = !team.length;
  const pick = (name, label, sub, busy) => h("button", { type: "button", class: "drv-pick", "aria-pressed": String(qDriver === name),
    onclick: (e) => { qDriver = name; $$("#q-drivers .drv-pick").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } },
    h("span", { class: `avatar sm${name && !isMe(name) ? "" : " gold"}`, text: name ? initials(name) : "A" }), label,
    h("small", { class: busy ? "busy" : null, text: sub }));
  $("#q-drivers").replaceChildren(
    pick("", "Auto", "system picks"),
    (() => { const clash = busyNear(r, selfName); return pick(selfName, "Me", clash ? `busy ${fmtTime(clash.trip.time)}` : "you drive", !!clash); })(),
    ...team.map((d) => {
      const clash = busyNear(r, d.name);
      return pick(d.name, firstName(d.name), !d.active ? "switched off" : clash ? `busy ${fmtTime(clash.trip.time)}` : "free", !d.active || !!clash);
    }));

  const acts = [];
  if (isConfirmed(r) && r.confirmedSent) {
    acts.push(h("button", { type: "button", class: "btn", value: "close", onclick: () => qSheet.close() }, "Cancel"));
    acts.push(h("button", { type: "button", class: "btn gold", onclick: (e) => saveQuote({ status: "Confirmed" }, e.currentTarget, "Saved.") }, "Save changes"));
  } else {
    acts.push(h("button", { type: "button", class: "btn", onclick: (e) => saveQuote({ status: isConfirmed(r) ? "Confirmed" : "Quoted" }, e.currentTarget, "Quote saved. The rider has not been emailed.") }, "Save quote"));
    acts.push(h("button", { type: "button", class: "btn gold", onclick: (e) => saveQuote({ status: "Confirmed" }, e.currentTarget, `Confirmed. ${firstName(t.name)} has been emailed.`) }, "Confirm & email"));
  }
  $("#q-acts").replaceChildren(...acts);
  qSheet.showModal();
  // Straight to the number pad when there is no price yet.
  if (!qAmt.value && qUnit !== "other") setTimeout(() => qAmt.focus(), 250);
}

async function saveQuote(payload, btn, done) {
  const quote = composeQuote();
  // A cleared price would erase the saved one and confirm the trip without a fare.
  if (!quote) {
    $("#q-error").textContent = "Add a price first. It goes in the rider's email.";
    $("#q-error").hidden = false;
    return;
  }
  $$("#q-acts button").forEach((b) => { b.disabled = true; });
  const was = btn.textContent;
  btn.textContent = payload.status === "Confirmed" && !qTrip.confirmedSent ? "Emailing…" : "Saving…";
  const r = qTrip;
  const expectEmail = payload.status === "Confirmed" && !r.confirmedSent;
  try {
    const res = await call("update", { ref: r.ref, quote, note: qNote.value.trim(), driver: qDriver, ...payload });
    const i = reservations.findIndex((x) => x.ref === r.ref);
    if (i > -1) reservations[i] = res.reservation;
    qSheet.close();
    renderAll();
    if (expectEmail) toast(...emailNote(res, r));
    else toast(done);
  } catch (err) {
    if (err.message === "signed out") { qSheet.close(); return; }
    $("#q-error").textContent = friendly(err);
    $("#q-error").hidden = false;
  } finally {
    $$("#q-acts button").forEach((b) => { b.disabled = false; });
    btn.textContent = was;
  }
}

/* ---------- are you sure? ---------- */

function ask({ title, text, yes, danger }) {
  const d = $("#ask-sheet");
  $("#ask-title").textContent = title;
  $("#ask-text").textContent = text;
  const y = $("#ask-yes");
  y.textContent = yes;
  y.className = danger ? "btn danger" : "btn gold";
  return new Promise((resolve) => {
    const finish = (v) => { d.removeEventListener("close", onClose); y.onclick = null; $("#ask-no").onclick = null; if (d.open) d.close(); resolve(v); };
    const onClose = () => finish(false);
    y.onclick = () => finish(true);
    $("#ask-no").onclick = () => finish(false);
    d.addEventListener("close", onClose);
    d.showModal();
  });
}

// Every sheet closes on its Cancel/Close buttons and on a tap outside it.
$$("dialog.sheet").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) d.close();
    const r = d.getBoundingClientRect();
    if (e.target === d && (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right)) d.close();
  });
});

/* ---------- Schedule ---------- */

let weekOffset = 0;
let selectedDay = dayKey(new Date());

$("#wk-prev").addEventListener("click", () => { weekOffset--; selectedDay = dayKey(weekDays()[0]); renderSchedule(); });
$("#wk-next").addEventListener("click", () => { weekOffset++; selectedDay = dayKey(weekDays()[0]); renderSchedule(); });

function weekDays() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

function renderSchedule() {
  const days = weekDays();
  const today = dayKey(new Date());
  const live = reservations.filter((r) => !isOff(r));
  $("#sched-month").textContent = days[3].toLocaleDateString("en-US", { month: "long", year: "numeric" });
  $("#week").replaceChildren(...days.map((d) => {
    const k = dayKey(d);
    const n = live.filter((r) => r.trip.date === k).length;
    return h("button", { type: "button", role: "tab", class: k === today ? "today" : null, "aria-selected": String(k === selectedDay),
      onclick: () => { selectedDay = k; renderSchedule(); } },
      d.toLocaleDateString("en-US", { weekday: "short" }), h("b", { class: "num", text: d.getDate() }),
      h("span", { class: "dots" }, Array.from({ length: Math.min(n, 3) }, () => h("i"))));
  }));

  const sel = days.find((d) => dayKey(d) === selectedDay) || days[0];
  $("#day-title").textContent = selectedDay === today ? "Today" : sel.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const trips = live.filter((r) => r.trip.date === selectedDay).sort((a, b) => pickupAt(a.trip) - pickupAt(b.trip));
  const names = [...new Set(trips.filter(isConfirmed).map((r) => tabDrives(r) ? "" : r.driver))];
  $("#legend").replaceChildren(...names.map((n) => h("span", { style: `--c:${driverColor(n)}`, text: n || "You" })));

  $("#agenda").replaceChildren(...(trips.length ? trips.map((r) => {
    const when = pickupAt(r.trip);
    const conf = isConfirmed(r);
    const clash = conf ? busyNear(r, r.driver) : null;
    const tm = when ? clock(when).split(" ") : [fmtTime(r.trip.time), ""];
    return h("div", { class: "ag" },
      h("div", { class: "ag-tm num" }, tm[0], h("small", { text: tm[1] })),
      h("button", { type: "button", class: `ag-card${r.tripDone ? " off" : ""}`, style: `--c:${conf ? driverColor(r.driver) : "var(--color-rule-strong)"}`, onclick: () => openTrip(r.ref) },
        h("b", null, h("span", { text: `${serviceShort(r.trip.service)} · ${r.trip.name}` }), conf ? null : h("span", { class: "pill", "data-s": statusOf(r), text: statusOf(r) })),
        h("span", { text: `${r.trip.pickup} → ${r.trip.dropoff}` }),
        conf ? h("span", { text: drivingLine(r) }) : null,
        clash ? h("span", { class: "ag-warn" }, icon("flag"), `Close to ${fmtTime(clash.trip.time)}, same driver`) : null));
  }) : [h("p", { class: "empty", text: "No trips this day." })]));
}

/* ---------- Reviews ---------- */

let rvFilter = "Pending";
$$("#rv-seg button").forEach((b) => b.addEventListener("click", () => { rvFilter = b.dataset.rv; renderReviews(); }));

function renderReviews() {
  $$("#rv-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.rv === rvFilter)));
  const waiting = reviews.filter((r) => r.status === "Pending");
  $$("[data-rvcount]").forEach((b) => { b.textContent = waiting.length || ""; });
  const shown = reviews.filter((r) => r.status === rvFilter);
  const body = $("#rv-body");
  if (!shown.length) {
    body.replaceChildren(h("p", { class: "empty", text: rvFilter === "Pending" ? "No reviews waiting. All caught up." : "Nothing here yet." }));
    return;
  }
  if (rvFilter === "Pending") {
    // One at a time: decide, and the next one comes up.
    body.replaceChildren(
      h("div", { class: `stack${shown.length === 1 ? " one" : ""}` }, reviewCard(shown[0], true)),
      h("p", { class: "rv-count num", text: `1 of ${shown.length} waiting` }));
  } else {
    body.replaceChildren(h("div", { class: "list" }, shown.map((r) => reviewCard(r, false))));
  }
}

function reviewCard(r, big) {
  const n = Math.max(0, Math.min(5, Math.round(r.rating)));
  const decide = async (status, btn) => {
    btn.disabled = true;
    try {
      const res = await call("reviewUpdate", { id: r.id, status });
      const i = reviews.findIndex((x) => x.id === r.id);
      if (i > -1) reviews[i] = res.review;
      renderReviews();
      renderBadges();
      renderToday();
      toast(status === "Approved" ? "It's on the website now." : status === "Hidden" ? "Hidden." : "Back to waiting.");
    } catch (err) {
      btn.disabled = false;
      if (err.message !== "signed out") toast(friendly(err), "error");
    }
  };
  const acts = r.status === "Pending"
    ? [h("button", { type: "button", class: "btn", onclick: (e) => decide("Hidden", e.currentTarget) }, icon("x"), "Hide"),
       h("button", { type: "button", class: "btn gold", onclick: (e) => decide("Approved", e.currentTarget) }, icon("check"), "Show on site")]
    : [h("button", { type: "button", class: "btn sm", onclick: (e) => decide("Pending", e.currentTarget) }, "Back to waiting"),
       h("button", { type: "button", class: `btn sm${r.status === "Hidden" ? " gold" : ""}`, onclick: (e) => decide(r.status === "Hidden" ? "Approved" : "Hidden", e.currentTarget) },
         r.status === "Hidden" ? "Show on site" : "Hide")];
  return h("article", { class: "rv" },
    h("div", { class: "rv-top" },
      h("span", { class: "stars", "aria-label": `${n} of 5 stars` }, Array.from({ length: 5 }, (_, i) => icon("star", i < n ? "i-fill" : "off"))),
      // Set by the script when the review matched a real trip; shown so Tab knows what she is approving.
      r.verified ? h("span", { class: "verified" }, icon("check"), "Verified ride") : null),
    h("blockquote", { text: big ? `“${r.text}”` : r.text }),
    h("p", { class: "rv-by" }, r.name, h("small", { text: [r.trip, fmtStamp(r.received)].filter(Boolean).join(" · ") })),
    h("div", { class: "rv-acts" }, acts));
}

/* ---------- Drivers ----------
   Passcodes go one way only: Tab sets them here, and nothing ever shows one
   back, not even to her. */

function renderDrivers() {
  const list = $("#dr-list");
  if (!drivers.length) {
    list.replaceChildren(h("p", { class: "empty", text: "No drivers yet. Until you add one, you drive every trip." }));
    return;
  }
  list.replaceChildren(...drivers.map((d) => h("div", { class: `dr${d.active ? "" : " off"}` },
    h("button", { type: "button", class: "dr-open", onclick: () => openDriver(d) },
      h("span", { class: "avatar", text: initials(d.name) }),
      h("span", { class: "dr-n" }, h("b", { text: d.name }),
        h("small", { text: d.active ? (d.upcoming ? `${plural(d.upcoming, "trip")} coming up` : "No trips coming up") : "Switched off · can't sign in" }))),
    h("button", { type: "button", class: "tog", role: "switch", "aria-checked": String(!!d.active), "aria-label": `${d.name} can drive`,
      onclick: (e) => toggleDriver(d, e.currentTarget) }))));
}

async function toggleDriver(d, sw) {
  if (d.active && !await ask({ title: `Switch ${firstName(d.name)} off?`, text: "They're signed out and get no new trips. Trips already theirs stay theirs until you move them.", yes: "Switch off", danger: true })) return;
  sw.disabled = true;
  try {
    const res = await call("driverSave", { name: d.name, email: d.email || "", phone: d.phone || "", passcode: "", active: !d.active });
    drivers = res.drivers;
    renderDrivers();
    toast(d.active ? `${firstName(d.name)} is switched off.` : `${firstName(d.name)} is switched on.`);
  } catch (err) {
    sw.disabled = false;
    if (err.message !== "signed out") toast(friendly(err), "error");
  }
}

let editing = null;
const drSheet = $("#driver-sheet");
$("#dr-add").addEventListener("click", () => openDriver(null));

function openDriver(d) {
  editing = d;
  $("#dr-title").textContent = d ? d.name : "Add a driver";
  $("#dr-sub").textContent = d ? "Change their name, how to reach them, or give them a new passcode." : "They sign in on the driver page with this passcode.";
  $("#dr-name").value = d ? d.name : "";
  $("#dr-delete").hidden = !d;
  $("#dr-email").value = d ? d.email || "" : "";
  $("#dr-phone").value = d ? d.phone || "" : "";
  $("#dr-pass").value = "";
  $("#dr-pass").placeholder = d ? "Leave empty to keep the old one" : "8 or more characters";
  $("#dr-pass-lbl").textContent = d ? "New passcode" : "Passcode";
  $("#dr-error").hidden = true;
  drSheet.showModal();
}

$("#driver-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#dr-error");
  const typed = $("#dr-name").value.trim();
  const name = editing ? editing.name : typed;
  const pass = $("#dr-pass").value;
  if (!typed) { err.textContent = "Add their name."; err.hidden = false; return; }
  if ((!editing || pass) && pass.length < 8) { err.textContent = "The passcode needs 8 or more characters."; err.hidden = false; return; }
  const btn = $("#dr-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await call("driverSave", { isNew: !editing || undefined, name, newName: editing ? typed : undefined, email: $("#dr-email").value, phone: $("#dr-phone").value, passcode: pass });
    drivers = res.drivers;
    drSheet.close();
    renderDrivers();
    toast(editing ? "Saved." : `Added. Give ${firstName(name)} their passcode; it isn't shown again.`);
    // A new name is on their trips too.
    if (editing && typed !== editing.name) loadAll({ quiet: true });
  } catch (e2) {
    if (e2.message === "signed out") { drSheet.close(); return; }
    err.textContent = friendly(e2);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
});

// Gone for good: coming trips go back to Auto and the script hands them out.
$("#dr-delete").addEventListener("click", async () => {
  const d = editing;
  if (!d) return;
  drSheet.close();
  const first = firstName(d.name);
  const trips = d.upcoming
    ? `${d.upcoming === 1 ? "Their coming trip goes" : `Their ${d.upcoming} coming trips go`} back to Auto: each is given to another free driver, and you're emailed about any nobody can take. ${first} is told they're off their list. `
    : "";
  if (!await ask({ title: `Delete ${d.name}?`, text: `${trips}They can't sign in again. Past trips keep their name. This can't be undone.`, yes: "Delete", danger: true })) return;
  try {
    const res = await call("driverDelete", { name: d.name });
    drivers = res.drivers;
    renderDrivers();
    const parts = [`${first} is deleted.`];
    if (res.moved) parts.push(`${plural(res.moved, "trip")} handed to another driver.`);
    if (res.waiting) parts.push(`${plural(res.waiting, "trip")} still need${res.waiting === 1 ? "s" : ""} a driver.`);
    toast(parts.join(" "), res.waiting ? "error" : "ok");
    if (d.upcoming) loadAll({ quiet: true });
  } catch (err) {
    if (err.message !== "signed out") toast(friendly(err), "error");
  }
});

/* ---------- fleet map ----------
   Tab's view of every car under way, on the Drivers tab, refreshed every 15
   seconds while it is on screen. A car is placed only between its driver's
   "On the way" and "Arrived" taps, then briefly where it parked; during the
   ride the trip is listed but its position is never shared. */

const FLEET_EVERY = 15000;
const AIKEN = [33.5604, -81.7196];
let fleet = null;
let fleetMap = null;
let fleetLayer = null;
let fleetTimer = null;
// Once Tab pans or zooms, stop moving the map out from under her.
let fleetMoved = false;

function startFleet() {
  if (fleetTimer) return;
  refreshFleet();
  fleetTimer = setInterval(() => { if (!document.hidden) refreshFleet(); }, FLEET_EVERY);
}
function stopFleet() {
  clearInterval(fleetTimer);
  fleetTimer = null;
}

async function refreshFleet() {
  try {
    fleet = await call("fleet");
  } catch (err) {
    if (err.message !== "signed out") $("#fleet-upd").textContent = "Can't reach the system. Retrying…";
    return;
  }
  drawFleet();
}

const agoText = (s) => s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
function milesBetween(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
// Leaflet draws in SVG attributes, which cannot read CSS variables.
function solidColor(name) {
  const c = driverColor(name);
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#ddb968" : c;
}

function fleetStatus(c, r) {
  const rider = r ? firstName(r.trip.name) : "the rider";
  if (c.stage === "arrived") {
    return c.at ? { text: `At ${rider}'s pickup`, live: true } : { text: `On the ride with ${rider} · location not shared` };
  }
  if (!c.at) return { text: "On the way · no location yet. Is the driver page open?" };
  if (c.at.ageSeconds > fleet.staleSeconds) return { text: `On the way · last seen ${agoText(c.at.ageSeconds)}` };
  const away = c.pickupAt ? ` · ${milesBetween(c.at, c.pickupAt).toFixed(1)} mi from pickup` : "";
  return { text: `On the way to ${rider}${away} · ${agoText(c.at.ageSeconds)}`, live: true };
}

function drawFleet() {
  const cars = (fleet && fleet.cars) || [];
  const busy = new Set(cars.map((c) => (isMe(c.driver) ? selfName : c.driver).toLowerCase()));
  const nextFor = (name) => reservations
    .filter((r) => isConfirmed(r) && !r.onTheWay && !r.tripDone && (isMe(name) ? tabDrives(r) : r.driver === name) && pickupAt(r.trip) > Date.now())
    .sort((a, b) => pickupAt(a.trip) - pickupAt(b.trip))[0];
  const idle = [{ name: selfName }, ...activeDrivers()].filter((d) => !busy.has(d.name.toLowerCase()));

  $("#fleet-list").replaceChildren(
    ...cars.map((c) => {
      const r = reservations.find((x) => x.ref === c.ref);
      const st = fleetStatus(c, r);
      const who = isMe(c.driver) ? "You" : c.driver;
      return h("button", { type: "button", class: "fleet-row", style: `--c:${driverColor(isMe(c.driver) ? "" : c.driver)}`, onclick: () => openTrip(c.ref) },
        h("span", { class: "fleet-dot" }),
        h("span", null, h("b", { text: r ? `${who} · ${r.trip.name}, ${fmtTime(r.trip.time)}` : `${who} · ${c.ref}` }),
          h("small", { class: st.live ? "live" : null, text: st.text })),
        icon("chev-r"));
    }),
    ...idle.map((d) => {
      const n = nextFor(d.name);
      const when = n && pickupAt(n.trip);
      return h("button", { type: "button", class: "fleet-row idle", disabled: !n, onclick: () => n && openTrip(n.ref) },
        h("span", { class: "fleet-dot" }),
        h("span", null, h("b", { text: isMe(d.name) ? "You" : d.name }),
          h("small", { text: n ? `Not on a trip · next ${when.toDateString() === new Date().toDateString() ? "" : fmtDate(n.trip.date) + " "}${clock(when)}` : "Not on a trip" })));
    }));
  const placed = cars.filter((c) => c.at).length;
  $("#fleet-upd").textContent = placed ? `${plural(placed, "car")} on the map · ${clock(new Date())}`
    : cars.length ? "No car is sharing its location right now" : "No cars on the way right now";

  const box = $("#fleet-map");
  if (!window.L) { box.hidden = true; return; }
  if (!fleetMap) {
    fleetMap = L.map(box, { zoomControl: true, attributionControl: true }).setView(AIKEN, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // OpenStreetMap refuses tiles without a Referer. The page itself sends
      // none, so the tracking link never leaks; tiles get the site's name only.
      referrerPolicy: "strict-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(fleetMap);
    fleetMap.on("dragstart", () => { fleetMoved = true; });
    ["wheel", "touchstart"].forEach((type) => box.addEventListener(type, () => { fleetMoved = true; }, { passive: true }));
    fleetLayer = L.layerGroup().addTo(fleetMap);
  }
  // Drawn while the tab was hidden, the map has no size yet.
  fleetMap.invalidateSize();
  fleetLayer.clearLayers();
  const points = [];
  cars.filter((c) => c.at).forEach((c) => {
    const color = solidColor(isMe(c.driver) ? "" : c.driver);
    const at = [c.at.lat, c.at.lng];
    points.push(at);
    if (c.pickupAt) {
      const p = [c.pickupAt.lat, c.pickupAt.lng];
      points.push(p);
      L.polyline([at, p], { color, weight: 2, dashArray: "4 6", opacity: 0.8, interactive: false }).addTo(fleetLayer);
      L.circleMarker(p, { radius: 6, color, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(fleetLayer);
    }
    const stale = c.stage === "onTheWay" && c.at.ageSeconds > fleet.staleSeconds;
    L.circleMarker(at, { radius: 10, color: "#fff", weight: 3, fillColor: color, fillOpacity: stale ? 0.45 : 1 })
      .bindTooltip(isMe(c.driver) ? "You" : firstName(c.driver), { permanent: true, direction: "top", offset: [0, -10], className: "fleet-tip" })
      .on("click", () => openTrip(c.ref))
      .addTo(fleetLayer);
  });
  if (fleetMoved || !points.length) return;
  if (points.length === 1) fleetMap.setView(points[0], 14);
  else fleetMap.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
}

/* ---------- live location ----------
   On a trip Tab drives herself, from "Start trip" until "I've arrived", this
   phone's position goes to the script every 15 seconds and the rider watches
   it on track.html. A web app can only do that while it is open on screen, so
   the screen is kept awake and the banner says plainly when sharing pauses. */

const SEND_EVERY = 15000;
let watchId = null;
let lastFix = null;
let lastSent = 0;
let sendTimer = null;
let wakeLock = null;
let shareState = { state: "", head: "", note: "" };
const stopped = new Set();

const sharingTrips = () => reservations.filter((r) => isSharing(r) && tabDrives(r) && !stopped.has(r.ref));

function shareBox() {
  const box = h("div", { class: "share", "data-share": true, "data-state": shareState.state },
    h("p", null, h("b", { text: shareState.head }), h("span", { text: shareState.note })));
  return box;
}
function paintShare(state, note) {
  const live = sharingTrips();
  shareState = { state, note, head: `${live.map((r) => firstName(r.trip.name)).join(" and ")} can see you on a map.` };
  $$("[data-share]").forEach((b) => {
    b.dataset.state = state;
    $("b", b).textContent = shareState.head;
    $("span", b).textContent = note;
  });
}

function updateSharing() {
  if (!sharingTrips().length) return stopSharing();
  if (watchId === null) startSharing();
}

function startSharing() {
  if (!("geolocation" in navigator)) return paintShare("error", "This phone can't share its location from the app.");
  paintShare("waiting", "Finding your location…");
  watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  // Sitting still at the pickup, the phone may report nothing new; resend the
  // last fix so the rider's map does not go stale while they walk out.
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
}

function onFix(pos) {
  lastFix = pos;
  if (Date.now() - lastSent >= SEND_EVERY) sendFix();
}

function onFixError(err) {
  paintShare("error", err.code === err.PERMISSION_DENIED
    ? "Location is blocked for TPT Desk. iPhone: Settings → Privacy & Security → Location Services. Android: long-press the app icon → App info → Permissions."
    : "Can't get a location fix right now. It keeps trying.");
}

async function sendFix() {
  const live = sharingTrips();
  if (!live.length || !lastFix) return;
  lastSent = Date.now();
  const { latitude, longitude, accuracy, heading } = lastFix.coords;
  // How old the reading is, by this phone's own clock. Resent while parked,
  // it keeps its real age, so the rider's map says "last seen" once GPS is lost.
  for (const r of live) {
    try {
      await call("driverLocation", { ref: r.ref, lat: latitude, lng: longitude, accuracy, heading, ageMs: Date.now() - lastFix.timestamp });
    } catch (err) {
      if (err.message === "signed out") return;
      // The script says this trip is no longer this phone's to share.
      if (/assigned|only shared|find/i.test(err.message)) stopped.add(r.ref);
      else return paintShare("error", friendly(err));
    }
  }
  if (!sharingTrips().length) return stopSharing();
  paintShare("live", `Last sent ${new Date(lastSent).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Keep the app open on screen: it pauses if the phone locks.`);
}

// The screen staying on is what keeps the app, and so the sharing, alive.
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request("screen");
  } catch { /* not supported, or refused: the banner already says to keep it open */ }
}

addEventListener("visibilitychange", () => {
  if (watchId === null) return;
  if (document.hidden) return paintShare("paused", "Paused while the app isn't on screen.");
  keepAwake();
  if (lastFix) sendFix();
});

/* ---------- pull to refresh ----------
   Home Screen apps on iPhone have no browser reload, so pulling the list down
   does it, as in Mail. */

(() => {
  const ptr = $("#ptr");
  let y0 = null, pull = 0;
  addEventListener("touchstart", (e) => {
    if (scrollY > 0 || !token || !$("#detail").hidden || document.querySelector("dialog[open]")) { y0 = null; return; }
    y0 = e.touches[0].clientY;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    pull = Math.max(0, Math.min(110, (e.touches[0].clientY - y0) * 0.5));
    ptr.classList.toggle("on", pull > 8);
    ptr.style.setProperty("--pull", `${pull}px`);
    ptr.style.setProperty("--pull-n", pull);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 === null) return;
    y0 = null;
    if (pull > 60) {
      ptr.classList.add("go");
      loadAll().finally(() => { ptr.classList.remove("on", "go"); ptr.style.setProperty("--pull", "0px"); ptr.style.setProperty("--pull-n", 0); });
    } else {
      ptr.classList.remove("on");
      ptr.style.setProperty("--pull", "0px"); ptr.style.setProperty("--pull-n", 0);
    }
    pull = 0;
  });
})();

/* ---------- install ----------
   Android offers a real install button. iPhone has no prompt a page can show,
   so the card says where Safari keeps it. */

let installEvent = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const dismissed = () => { try { return localStorage.getItem(INSTALL_KEY) === "1"; } catch { return false; } };

function paintInstall() {
  const can = !standalone() && (installEvent || isiOS);
  $("#row-install").hidden = !can;
  const card = $("#install");
  card.hidden = !can || dismissed();
  if (card.hidden) return;
  $("#install-btn").hidden = !installEvent;
  $("#install-text").replaceChildren(...(installEvent
    ? ["Install ", h("b", { text: "TPT Desk" }), " on this phone, so it opens like an app."]
    : ["Add it to your Home Screen: tap ", h("b", { text: "Share" }), " in Safari, then ", h("b", { text: "Add to Home Screen" }), "."]));
}

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; paintInstall(); });
addEventListener("appinstalled", () => { installEvent = null; paintInstall(); toast("Installed. Open TPT Desk from your Home Screen."); });

async function install() {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    paintInstall();
  } else {
    toast("In Safari, tap Share, then Add to Home Screen.");
  }
}
$("#install-btn").addEventListener("click", install);
$("#row-install").addEventListener("click", install);
$("#install-close").addEventListener("click", () => { try { localStorage.setItem(INSTALL_KEY, "1"); } catch {} paintInstall(); });

/* ---------- offline ---------- */

function paintOnline() { $("#offline").hidden = navigator.onLine; }
addEventListener("online", () => { paintOnline(); if (token) loadAll({ quiet: true }); });
addEventListener("offline", paintOnline);

/* ---------- start ---------- */

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin.html" }).catch(() => {}));
}

paintOnline();
paintInstall();
if (token) {
  showApp();
  if (!location.hash || location.hash === "#") location.replace("#today");
  route();
  loadAll();
} else {
  showGate("");
}
