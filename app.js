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
  passengers: "Passengers", luggage: "Bags", flight: "Flight", notes: "Notes",
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
