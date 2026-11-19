// The rider's tracking page. Reached only from the rider's own "on the way"
// email, whose link carries the tracking number and a signature proving the
// link is theirs. Asks the script every 15 seconds where the car is; the
// script only answers with a moving car between the driver's "On the way" and
// "Arrived" taps, then where it parked, and nothing at all once the trip is
// over or the link has expired.

// GitHub Pages cannot send a frame-blocking header, so refuse to run inside
// someone else's page.
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error("framed");
}

const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
const ref = params.get("ref") || "";
const t = params.get("t") || "";

const POLL_EVERY = 15000;
// Nothing more will change on these.
const FINAL = ["done", "cancelled", "expired"];
let timer = null;
let map = null;
let carDot = null;
let carRing = null;
let pickupDot = null;
// Once the rider pans or zooms, stop moving the map out from under them.
let userMoved = false;
let last = null;

async function call() {
  if (!BOOKING_ENDPOINT) throw new Error("Tracking is not set up yet.");
  const res = await fetch(BOOKING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "track", ref, t }),
    redirect: "follow",
  });
  return res.json();
}

function showProblem(title, text) {
  $("#loading").hidden = true;
  $("#view").hidden = true;
  $("#problem-title").textContent = title;
  $("#problem-text").textContent = text;
  $("#problem").hidden = false;
}

const fmtTime = (v) => {
  const [h, m] = String(v).split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return v;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const fmtDate = (v) => {
  const [y, m, d] = String(v).split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
};

function ago(seconds) {
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const m = Math.round(seconds / 60);
  return m === 1 ? "a minute ago" : `${m} minutes ago`;
}

/** Straight-line miles between two points. */
function miles(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

async function refresh() {
  let res;
  try {
    res = await call();
  } catch (err) {
    // A dropped signal mid-trip: keep the last picture and try again.
    if (last) { $("#updated").textContent = "Reconnecting…"; return; }
    return showProblem("No connection", "Check your signal and reload this page, or call 864-901-6550.");
  }
  if (!res.ok) return showProblem("We could not open that", res.error || "Please call 864-901-6550.");
  last = res;
  render(res);
  if (FINAL.includes(res.stage)) stop();
}

function render(res) {
  $("#loading").hidden = true;
  $("#problem").hidden = true;
  $("#view").hidden = false;

  const driver = res.driver || "Your driver";
  const headlines = {
    pending: ["Your trip is not confirmed yet", "TPT will be in touch before your pickup."],
    waiting: [`${driver} has not set off yet`, "This page shows the car as soon as they are on the way."],
    onTheWay: [`${driver} is on the way`, ""],
    arrived: [`${driver} is here`, `They are waiting at your pickup.`],
    done: ["Your trip is complete", "Thank you for riding with TPT."],
    cancelled: ["This trip was cancelled", "Booked in error? Call 864-901-6550."],
    expired: ["This tracking link has expired", "It only works around your pickup. Questions? Call 864-901-6550."],
  };
  const [head, sub] = headlines[res.stage] || headlines.waiting;
  $("#headline").textContent = head;
  let subline = sub;
  if (res.stage === "onTheWay" && res.car && res.pickupAt) {
    const d = miles(res.car, res.pickupAt);
    subline = d < 0.2 ? "Almost at your pickup." : `About ${d.toFixed(1)} miles from your pickup, as the crow flies.`;
  } else if (res.stage === "onTheWay") {
    subline = "Questions on the way? Call or text TPT below.";
  }
  $("#subline").textContent = subline;
  $("#ref").textContent = res.ref ? `Tracking number ${res.ref}` : "";
  // Over, cancelled or expired: the script sends nothing about the trip.
  $("#card").hidden = !res.pickup;
  $("#pickup").textContent = res.pickup || "";
  $("#when").textContent = res.pickup ? `${fmtDate(res.date)}, ${fmtTime(res.time)}` : "";

  const showMap = !!res.car && ["onTheWay", "arrived"].includes(res.stage);
  $("#map-wrap").hidden = !showMap && !(res.pickupAt && ["onTheWay", "arrived"].includes(res.stage));
  if ($("#map-wrap").hidden) return;
  drawMap(res);

  const updated = $("#updated");
  if (res.stage === "arrived") {
    // Nothing is shared after "Arrived": this is where the car stopped.
    updated.textContent = res.car ? "Where your driver parked." : "";
    delete updated.dataset.stale;
  } else if (!res.car) {
    updated.textContent = "Waiting for the car's location…";
    updated.dataset.stale = "true";
  } else if (res.car.ageSeconds > res.staleSeconds) {
    updated.textContent = `Last seen ${ago(res.car.ageSeconds)}. The driver's phone may have lost signal.`;
    updated.dataset.stale = "true";
  } else {
    updated.textContent = `Updated ${ago(res.car.ageSeconds)}`;
    delete updated.dataset.stale;
  }
}

function drawMap(res) {
  if (!window.L) {
    $("#updated").textContent = "The map could not load. Your driver's status above still updates.";
    return;
  }
  if (!map) {
    map = L.map("map", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // OpenStreetMap refuses tiles without a Referer. The page itself sends
      // none, so the tracking link never leaks; tiles get the site's name only.
      referrerPolicy: "strict-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // Only a person's hand counts: fitBounds itself fires zoom events.
    map.on("dragstart", () => { userMoved = true; });
    ["wheel", "touchstart"].forEach((type) =>
      map.getContainer().addEventListener(type, () => { userMoved = true; }, { passive: true }));
  }

  if (res.pickupAt) {
    const at = [res.pickupAt.lat, res.pickupAt.lng];
    if (!pickupDot) {
      pickupDot = L.circleMarker(at, { radius: 8, color: "#fff", weight: 2, fillColor: "#3f8f5a", fillOpacity: 1 })
        .bindTooltip("Your pickup", { direction: "top" }).addTo(map);
    } else pickupDot.setLatLng(at);
  }

  if (res.car) {
    const at = [res.car.lat, res.car.lng];
    if (!carDot) {
      carRing = L.circle(at, { radius: res.car.accuracy || 0, color: "#c9a24a", weight: 1, fillOpacity: 0.12 }).addTo(map);
      carDot = L.circleMarker(at, { radius: 10, color: "#fff", weight: 3, fillColor: "#c9a24a", fillOpacity: 1 })
        .bindTooltip(res.driver || "Your driver", { direction: "top", permanent: false }).addTo(map);
    } else {
      carDot.setLatLng(at);
      carRing.setLatLng(at).setRadius(res.car.accuracy || 0);
    }
  }

  if (userMoved) return;
  const points = [res.car && [res.car.lat, res.car.lng], res.pickupAt && [res.pickupAt.lat, res.pickupAt.lng]].filter(Boolean);
  if (points.length === 2) map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  else if (points.length === 1) map.setView(points[0], 15);
}

function start() {
  if (timer) return;
  timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_EVERY);
}
function stop() {
  clearInterval(timer);
  timer = null;
}

// Back from another app: show where things are now, not 15 seconds ago.
addEventListener("visibilitychange", () => {
  if (!document.hidden && timer) refresh();
});

if (!ref || !t) {
  showProblem("That link is incomplete", "Open the link from your email again, or call 864-901-6550.");
} else {
  refresh().then(() => { if (last && !FINAL.includes(last.stage)) start(); });
}
