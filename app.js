// Booking widget: 3 short steps → review → send to Google Apps Script.

// BOOKING_ENDPOINT comes from config.js, loaded just before this file.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const form = $("#quote-form");
const review = $("#review");
const reviewList = $("#review-list");
const done = $("#done");
const formError = $("#form-error");
const sendError = $("#send-error");
const sendBtn = $("#send-btn");
const booking = $("#booking");

$("#year").textContent = new Date().getFullYear();

// ---- Services carousel: arrows page the track, and disable at either end ----
const track = $("#svc-track");
const prevBtn = $('[data-carousel="prev"]');
const nextBtn = $('[data-carousel="next"]');
if (track && prevBtn && nextBtn) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const page = () => {
    const card = track.querySelector("li");
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return card ? card.getBoundingClientRect().width + gap : track.clientWidth;
  };
  const sync = () => {
    prevBtn.disabled = track.scrollLeft <= 2;
    nextBtn.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  };
  prevBtn.addEventListener("click", () => track.scrollBy({ left: -page(), behavior: calm ? "auto" : "smooth" }));
  nextBtn.addEventListener("click", () => track.scrollBy({ left: page(), behavior: calm ? "auto" : "smooth" }));
  track.addEventListener("scroll", sync, { passive: true });
  addEventListener("resize", sync);
  sync();
}

// ---- Header: glass once the page moves, tucked away scrolling down, back on the way up ----
const siteHeader = $("#site-header");
if (siteHeader) {
  let lastY = scrollY;
  const syncHeader = () => {
    const y = scrollY;
    siteHeader.classList.toggle("is-scrolled", y > 24);
    // Never tuck while the menu is open, near the top, or on the way up.
    const tuck = y > 320 && y > lastY && !document.documentElement.classList.contains("menu-open");
    siteHeader.classList.toggle("is-tucked", tuck);
    lastY = y;
  };
  addEventListener("scroll", syncHeader, { passive: true });
  syncHeader();
}

// ---- Nav: the car rides the road to the section in view ----
const navRoute = $(".nav-route");
if (navRoute) {
  const links = $$("[data-spy]", navRoute);
  const sections = links.map((a) => $(`#${a.dataset.spy}`)).filter(Boolean);
  const nav = navRoute.closest(".nav");
  const park = (link) => {
    links.forEach((a) => a.setAttribute("aria-current", a === link ? "true" : "false"));
    if (!link) { nav.style.setProperty("--car-on", 0); return; }
    const r = link.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    nav.style.setProperty("--car-x", `${r.left - n.left + r.width / 2}px`);
    nav.style.setProperty("--car-on", 1);
  };
  // The section covering the upper third of the screen is the one being read.
  const spy = () => {
    const line = innerHeight / 3;
    let here = null;
    sections.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) here = links[i];
    });
    park(here);
  };
  addEventListener("scroll", spy, { passive: true });
  addEventListener("resize", spy);
  spy();
}

// ---- Menu: full-screen route map ----
const menu = $("#menu");
const menuBtn = $(".menu-btn");
if (menu && menuBtn) {
  const label = $(".menu-btn-label", menuBtn);
  let lastFocus = null;
  const openMenu = () => {
    lastFocus = document.activeElement;
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add("is-open"));
    document.documentElement.classList.add("menu-open");
    menuBtn.setAttribute("aria-expanded", "true");
    if (label) label.textContent = "Close";
    $("a", menu)?.focus({ preventScroll: true });
  };
  const closeMenu = ({ restore = true } = {}) => {
    menu.classList.remove("is-open");
    document.documentElement.classList.remove("menu-open");
    menuBtn.setAttribute("aria-expanded", "false");
    if (label) label.textContent = "Menu";
    setTimeout(() => { menu.hidden = true; }, 320);
    if (restore) (lastFocus || menuBtn).focus({ preventScroll: true });
  };
  menuBtn.addEventListener("click", () => {
    menuBtn.getAttribute("aria-expanded") === "true" ? closeMenu() : openMenu();
  });
  // A stop closes the menu and lets the link scroll on its own.
  $$("a", menu).forEach((a) => a.addEventListener("click", () => closeMenu({ restore: false })));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuBtn.getAttribute("aria-expanded") === "true") closeMenu();
  });
  // A width that brings the full nav back leaves the menu stranded open.
  matchMedia("(min-width: 68.01rem)").addEventListener("change", (e) => {
    if (e.matches && menuBtn.getAttribute("aria-expanded") === "true") closeMenu({ restore: false });
  });
}

// ---- About: the bench draws, Tab settles onto it, once ----
const about = $("#about");
if (about) {
  new IntersectionObserver(([entry], obs) => {
    if (!entry.isIntersecting) return;
    about.classList.add("is-in");
    obs.disconnect();
  }, { threshold: 0.25 }).observe(about);
}

// ---- Reviews: a spotlight carousel. Steps right to left, loops, swipes; the route stops jump to a review ----
const quoteTrack = $("#quote-track");
const quoteRoute = $("#quote-route");
function initQuotes() {
  if (!quoteTrack || !quoteRoute) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const originals = $$(".quote-slot", quoteTrack);
  const n = originals.length;
  // A copy of the set on each side, so the loop never shows an empty end in either direction.
  const copy = (slot) => {
    const c = slot.cloneNode(true);
    c.setAttribute("aria-hidden", "true");
    c.inert = true;
    return c;
  };
  originals.forEach((slot) => quoteTrack.append(copy(slot)));
  [...originals].reverse().forEach((slot) => quoteTrack.prepend(copy(slot)));
  const slots = $$(".quote-slot", quoteTrack);

  const stops = originals.map((slot, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `Review ${i + 1} of ${n}, ${slot.querySelector("b").textContent}`);
    b.addEventListener("click", () => { go(n + i); pauseFor(8000); });
    quoteRoute.append(b);
    return b;
  });

  const leftFor = (slot) => slot.offsetLeft - (quoteTrack.clientWidth - slot.offsetWidth) / 2;
  const nearest = () => {
    const mid = quoteTrack.scrollLeft + quoteTrack.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  let current = n;
  const mark = (i) => {
    current = i;
    slots.forEach((s, k) => s.classList.toggle("is-active", k === i));
    const r = ((i % n) + n) % n;
    stops.forEach((b, k) => {
      b.setAttribute("aria-current", k === r ? "true" : "false");
      b.classList.toggle("is-passed", k < r);
    });
    quoteRoute.style.setProperty("--progress", n > 1 ? r / (n - 1) : 0);
  };
  const go = (i, smooth = !calm) => {
    quoteTrack.scrollTo({ left: leftFor(slots[i]), behavior: smooth ? "smooth" : "auto" });
    mark(i);
  };

  // Once a scroll settles on a copy, hop silently to the matching original.
  let settleTimer;
  const settle = () => {
    let i = nearest();
    if (i < n) i += n;
    else if (i >= 2 * n) i -= n;
    if (i !== nearest()) quoteTrack.scrollTo({ left: leftFor(slots[i]), behavior: "auto" });
    mark(i);
  };
  quoteTrack.addEventListener("scroll", () => {
    const i = nearest();
    if (i !== current) mark(i);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 140);
  }, { passive: true });

  // Pause while someone is reading or touching it, and while it is off screen.
  let held = false;
  let visible = false;
  let resumeTimer;
  const hold = () => { held = true; clearTimeout(resumeTimer); };
  const pauseFor = (ms) => { hold(); resumeTimer = setTimeout(() => { held = false; }, ms); };
  quoteTrack.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hold(); });
  quoteTrack.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") pauseFor(1200); });
  quoteTrack.addEventListener("touchstart", hold, { passive: true });
  quoteTrack.addEventListener("touchend", () => pauseFor(5000), { passive: true });
  quoteTrack.addEventListener("focusin", hold);
  quoteTrack.addEventListener("focusout", () => pauseFor(1200));
  quoteTrack.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(current + 1); pauseFor(8000); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1); pauseFor(8000); }
  });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.4 }).observe(quoteTrack);

  addEventListener("resize", () => go(current, false));
  requestAnimationFrame(() => go(n, false));
  if (!calm) setInterval(() => { if (visible && !held && !document.hidden) go(current + 1); }, 5500);
}

/* ---------- Reviews Tab has approved, fetched from the same desk the bookings use ----------
   The carousel clones its cards to loop, so the approved ones have to be in the list before it
   starts. The fetch gets a short leash: if the desk is slow or unreachable, the carousel opens
   with the reviews already on the page rather than waiting. */

function starRow(rating) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  const span = document.createElement("span");
  span.className = "quote-stars";
  span.textContent = "\u2605".repeat(n);
  span.setAttribute("aria-label", `${n} out of 5 stars`);
  return span;
}

function initials(name) {
  const parts = name.replace(/[^\p{L}\s-]/gu, "").split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return "\u2605";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const VERIFIED_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function reviewSlot(r) {
  const li = document.createElement("li");
  li.className = "quote-slot";
  const fig = document.createElement("figure");
  fig.className = "quote";

  const badge = document.createElement("span");
  badge.className = "quote-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = initials(r.name);

  const cap = document.createElement("figcaption");
  const b = document.createElement("b");
  b.textContent = r.name;
  const who = document.createElement("span");
  who.textContent = "Client";
  cap.append(b, who);

  const rule = document.createElement("span");
  rule.className = "quote-rule";
  rule.setAttribute("aria-hidden", "true");

  const quote = document.createElement("blockquote");
  quote.textContent = r.text;

  const tab = document.createElement("span");
  tab.className = "quote-tab";
  if (r.rating) tab.append(starRow(r.rating), document.createTextNode(r.rating.toFixed(1)));
  else tab.append(document.createTextNode("Review"));

  fig.append(badge, cap, rule, quote, tab);

  // The badge is printed only when the desk matched this review to a real trip.
  if (r.verified) {
    const v = document.createElement("span");
    v.className = "quote-verified";
    v.innerHTML = VERIFIED_SVG;
    v.append(document.createTextNode(r.trip ? `Verified ride \u00b7 ${r.trip}` : "Verified ride"));
    fig.append(v);
  }
  li.append(fig);
  return li;
}

async function loadApprovedReviews() {
  if (!quoteTrack || typeof BOOKING_ENDPOINT !== "string" || !BOOKING_ENDPOINT) return;
  const stop = new AbortController();
  const bail = setTimeout(() => stop.abort(), 4000);
  try {
    const res = await fetch(BOOKING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "reviews" }),
      redirect: "follow",
      signal: stop.signal,
    });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.reviews)) return;
    // Newest first, ahead of the ones written into the page.
    const first = quoteTrack.firstElementChild;
    data.reviews.forEach((r) => {
      if (!r || !r.name || !r.text) return;
      quoteTrack.insertBefore(reviewSlot(r), first);
    });
  } catch (err) {
    // An old deployment without the reviews action, or no connection: the
    // carousel still has everything already on the page.
  } finally {
    clearTimeout(bail);
  }
}

loadApprovedReviews().then(initQuotes, initQuotes);

// The Google link lives in config.js, so it is changed in one place. The href in
// the page is the same address, and stands in if config.js ever fails to load.
const googleLink = $("#google-review");
if (googleLink && typeof GOOGLE_REVIEW_URL === "string" && GOOGLE_REVIEW_URL) {
  googleLink.href = GOOGLE_REVIEW_URL;
}

/* ---------- Reviews on Google ----------
   A small deck: one card face up, the others fanned behind it. Google sends at most five
   and asks that they are shown as written, so nothing here edits them; the card clamps the
   long ones and the link goes to Google for the rest. With no key set at the desk, or if
   Google cannot be reached, the cards already in the page stay where they are. */

const gdeck = $("#gdeck");

function googleStars(n) {
  const wrap = document.createElement("span");
  wrap.className = "g-stars";
  wrap.setAttribute("aria-label", `Rated ${n} out of 5`);
  for (let i = 0; i < Math.round(n); i++) {
    wrap.insertAdjacentHTML("beforeend",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4 6.2 20.4l1.1-6.4L2.6 9.4l6.5-.9z"/></svg>');
  }
  return wrap;
}

const G_TONES = ["blue", "green", "red", "purple", "teal"];

function googleCard(r, i) {
  const card = document.createElement("article");
  card.className = "g-card";

  const head = document.createElement("header");
  head.className = "g-head";

  let avatar;
  if (r.photo) {
    avatar = document.createElement("img");
    avatar.className = "g-avatar";
    avatar.src = r.photo;
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.width = 34;
    avatar.height = 34;
  } else {
    avatar = document.createElement("span");
    avatar.className = "g-avatar";
    avatar.dataset.tone = G_TONES[i % G_TONES.length];
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = (r.name || "?").trim()[0].toUpperCase();
  }

  const who = document.createElement("span");
  who.className = "g-who";
  const b = document.createElement("b");
  b.textContent = r.name || "A Google user";
  const when = document.createElement("span");
  when.textContent = r.when || "";
  who.append(b, when);

  const source = document.createElement("span");
  source.className = "g-source";
  source.setAttribute("aria-hidden", "true");
  source.textContent = "G";

  head.append(avatar, who, source);

  const text = document.createElement("p");
  text.className = "g-text";
  text.textContent = r.text;

  card.append(head, googleStars(r.rating || 5), text);
  return card;
}

/** Deal the deck: front card face up, the rest a step further back each. */
function dealDeck(front) {
  if (!gdeck) return;
  const cards = $$(".g-card", gdeck);
  if (!cards.length) return;
  const n = cards.length;
  cards.forEach((card, i) => {
    const depth = (i - front + n) % n;
    card.style.setProperty("--d", depth);
    card.setAttribute("aria-hidden", depth === 0 ? "false" : "true");
    card.tabIndex = depth === 0 ? 0 : -1;
  });
  const count = $("#gdeck-count");
  if (count) count.textContent = `${front + 1} of ${n}`;
  gdeck.dataset.front = front;
}

function turnDeck(step) {
  const cards = $$(".g-card", gdeck);
  if (!cards.length) return;
  const n = cards.length;
  dealDeck(((Number(gdeck.dataset.front) || 0) + step + n) % n);
}

if (gdeck) {
  dealDeck(0);
  // The deck itself turns: tapping a card behind brings it forward, tapping the
  // face-up one moves on to the next.
  gdeck.addEventListener("click", (e) => {
    const card = e.target.closest(".g-card");
    if (!card) return;
    const i = $$(".g-card", gdeck).indexOf(card);
    turnDeck(i === Number(gdeck.dataset.front) ? 1 : i - Number(gdeck.dataset.front));
  });
  gdeck.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); turnDeck(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); turnDeck(-1); }
  });
  $("#gdeck-next")?.addEventListener("click", () => turnDeck(1));
  $("#gdeck-prev")?.addEventListener("click", () => turnDeck(-1));
}

async function loadGoogleReviews() {
  if (!gdeck || typeof BOOKING_ENDPOINT !== "string" || !BOOKING_ENDPOINT) return;
  const stop = new AbortController();
  const bail = setTimeout(() => stop.abort(), 5000);
  try {
    const res = await fetch(BOOKING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "googleReviews" }),
      redirect: "follow",
      signal: stop.signal,
    });
    const data = await res.json();
    if (!data.ok || !data.configured || !data.reviews || !data.reviews.length) return;

    gdeck.replaceChildren(...data.reviews.map(googleCard));
    dealDeck(0);

    const score = $(".gdeck-score");
    if (score && data.rating) {
      score.querySelector("b").textContent = Number(data.rating).toFixed(1);
      score.querySelector(".g-stars").replaceWith(googleStars(data.rating));
    }
    const total = $("#gdeck-total");
    if (total && data.total) total.textContent = `${data.total} review${data.total === 1 ? "" : "s"}`;
    const link = $(".gdeck-link");
    if (link && data.url) {
      link.href = data.url;
      link.firstChild.textContent = "See them all";
    }
  } catch (err) {
    // No key yet, an old deployment, or no connection: the deck keeps what it has.
  } finally {
    clearTimeout(bail);
  }
}

loadGoogleReviews();

/* ---------- Writing a review ---------- */

const reviewForm = $("#review-form");
if (reviewForm) {
  const sendBtn = $("#rv-send");
  const sendLabel = $("span", sendBtn);
  const error = $("#rv-error");
  const done = $("#rv-done");
  const doneNote = $("#rv-done-note");

  reviewForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const data = Object.fromEntries(new FormData(reviewForm));
    if (!String(data.name || "").trim() || !data.rating || String(data.text || "").trim().length < 10) {
      error.textContent = "Please give your name, a rating, and a few words about the ride.";
      error.hidden = false;
      return;
    }
    sendBtn.disabled = true;
    if (sendLabel) sendLabel.textContent = "Sending\u2026";
    try {
      const res = await fetch(BOOKING_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "review", ...data }),
        redirect: "follow",
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || "That did not go through.");
      reviewForm.hidden = true;
      done.hidden = false;
      if (out.verified && doneNote) {
        doneNote.textContent = "Your review has been received, and your trip was matched, so it carries a verified badge. Thank you for riding with TPT.";
      }
      done.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (err) {
      error.textContent = err instanceof TypeError
        ? "Could not reach the booking desk. Please check your connection and try again."
        : err.message;
      error.hidden = false;
    } finally {
      sendBtn.disabled = false;
      if (sendLabel) sendLabel.textContent = "Send review";
    }
  });
}

// ---- Dates: nothing in the past ----
const now = new Date();
const isoToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
form.date.min = isoToday;
form.returnDate.min = isoToday;
form.date.addEventListener("change", () => { form.returnDate.min = form.date.value || isoToday; });

// ---- Conditional fields ----
function syncConditional() {
  const round = form.tripType.value === "Round trip";
  $("#return-row").hidden = !round;
  form.returnDate.required = round;
  form.returnTime.required = round;
  $("#flight-field").hidden = form.service.value !== "Airport Service";
}
form.addEventListener("change", syncConditional);

// ---- +/- steppers ----
$$("[data-inc],[data-dec]").forEach((b) =>
  b.addEventListener("click", () => {
    const input = form[b.dataset.inc || b.dataset.dec];
    const v = (parseInt(input.value, 10) || 0) + (b.dataset.inc ? 1 : -1);
    input.value = Math.min(+input.max, Math.max(+input.min, v));
  })
);

// ---- Service links pre-select the chip ----
$$("[data-service]").forEach((a) =>
  a.addEventListener("click", () => {
    const chip = $(`input[name="service"][value="${a.dataset.service}"]`);
    if (chip) { chip.checked = true; syncConditional(); }
    showStep(1);
    setTimeout(() => form.pickup.focus({ preventScroll: true }), 450);
  })
);

// ---- Steps ----
let current = 1;
function showStep(n) {
  current = n;
  $$(".step", form).forEach((s) => (s.hidden = +s.dataset.step !== n));
  $$("[data-step-dot]").forEach((d) => {
    const i = +d.dataset.stepDot;
    d.classList.toggle("is-current", i === n);
    d.classList.toggle("is-done", i < n);
  });
  formError.hidden = true;
  form.hidden = false;
  review.hidden = true;
  done.hidden = true;
}

function validateStep(n) {
  const step = $(`.step[data-step="${n}"]`, form);
  $$(".field", step).forEach((f) => f.classList.remove("invalid"));
  let firstBad = null;
  $$("input, select, textarea", step).forEach((el) => {
    if (el.name === "company" || el.closest("[hidden]")) return;
    if (el.type === "radio") {
      if (el.required && !form[el.name].value) { el.closest(".field").classList.add("invalid"); firstBad ||= el; }
      return;
    }
    if (!el.checkValidity()) { el.closest(".field")?.classList.add("invalid"); firstBad ||= el; }
  });

  if (!firstBad && n === 2 && form.tripType.value === "Round trip") {
    if (`${form.returnDate.value}T${form.returnTime.value}` <= `${form.date.value}T${form.time.value}`) {
      form.returnDate.closest(".field").classList.add("invalid");
      return fail("The return has to be after the pickup.", form.returnDate);
    }
  }
  if (firstBad) {
    const msg = firstBad.name === "service" ? "Please choose a service." : "Please complete the highlighted fields.";
    return fail(msg, firstBad);
  }
  formError.hidden = true;
  return true;
}

function fail(msg, el) {
  formError.textContent = msg;
  formError.hidden = false;
  el.focus();
  return false;
}

$$("[data-next]", form).forEach((b) => b.addEventListener("click", () => { if (validateStep(current)) showStep(current + 1); }));
$$("[data-back]", form).forEach((b) => b.addEventListener("click", () => showStep(current - 1)));

// Enter in a text field moves forward instead of submitting early
form.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT" && current < 3) {
    e.preventDefault();
    if (validateStep(current)) showStep(current + 1);
  }
});

// ---- Review ----
const LABELS = {
  service: "Service", pickup: "Pickup", dropoff: "Drop-off", date: "Date", time: "Time",
  tripType: "Trip", returnDate: "Return date", returnTime: "Return time",
  passengers: "Passengers", luggage: "Bags", flight: "Flight number", notes: "Anything else",
  name: "Name", phone: "Phone", email: "Email",
};

function readForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k in data) data[k] = String(data[k]).trim();
  if (data.tripType !== "Round trip") { delete data.returnDate; delete data.returnTime; }
  if (data.service !== "Airport Service") delete data.flight;
  return data;
}

const fmtDate = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" }); };
const fmtTime = (v) => { const [h, m] = v.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
const display = (k, v) => (/date/i.test(k) ? fmtDate(v) : /time$/i.test(k) && k !== "tripType" ? fmtTime(v) : v);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validateStep(3)) return;
  const data = readForm();
  reviewList.replaceChildren();
  for (const key of Object.keys(LABELS)) {
    if (!data[key]) continue;
    const dt = document.createElement("dt");
    dt.textContent = LABELS[key];
    const dd = document.createElement("dd");
    dd.textContent = display(key, data[key]);
    reviewList.append(dt, dd);
  }
  sendError.hidden = true;
  form.hidden = true;
  review.hidden = false;
  booking.scrollIntoView({ block: "start" });
});

// Editing makes this a different trip, so it gets a fresh id rather than
// being swallowed as a duplicate of what was already sent.
$("#edit-btn").addEventListener("click", () => { requestId = null; showStep(1); });

// One id per reservation attempt. A retry reuses it, so the backend can tell a
// second send of the same trip from a genuine second booking.
let requestId = null;

sendBtn.addEventListener("click", async () => {
  const data = readForm();
  if (data.company) return showDone(); // spam trap filled: quietly accept

  if (!BOOKING_ENDPOINT) {
    sendError.textContent = "Online booking is being set up. Please call or text 864-901-6550 to book.";
    sendError.hidden = false;
    return;
  }

  requestId ||= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  sendError.hidden = true;
  try {
    // text/plain keeps this a simple request (no CORS preflight, which Apps
    // Script cannot answer); the script reads e.postData.contents.
    const res = await fetch(BOOKING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...data, requestId, submittedAt: new Date().toISOString() }),
      redirect: "follow",
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "rejected");
    requestId = null;
    showDone(result.ref);
  } catch (err) {
    sendError.textContent =
      err instanceof TypeError
        // Network or CORS failure: we cannot tell whether it landed, so don't
        // imply it did and don't push them to resend blindly.
        ? "We could not reach the booking desk. Please call or text 864-901-6550 and we'll take it down."
        : err.message === "rejected"
          ? "Something went wrong. Please try again, or call 864-901-6550."
          : err.message;
    sendError.hidden = false;
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Confirm & send";
  }
});

function showDone(ref) {
  const refLine = $("#done-ref");
  if (refLine) {
    refLine.textContent = ref ? `Reference ${ref}` : "";
    refLine.hidden = !ref;
  }
  review.hidden = true;
  form.hidden = true;
  done.hidden = false;
  $$("[data-step-dot]").forEach((d) => { d.classList.remove("is-current"); d.classList.add("is-done"); });
  done.focus();
}

syncConditional();
