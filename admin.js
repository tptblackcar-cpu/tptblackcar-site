// Owner's desk: sign in, read the reservations, quote them, confirm them.
// Everything goes through the same Apps Script web app the booking form uses.
// BOOKING_ENDPOINT comes from config.js.

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

// sessionStorage, not localStorage: the token dies with the tab, so a shared
// or borrowed phone does not stay signed in.
const TOKEN_KEY = "tpt.admin.token";
let token = sessionStorage.getItem(TOKEN_KEY) || "";
let reservations = [];

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
    endSession("Your session expired. Sign in again.");
    throw new Error("signed out");
  }
  if (!data.ok) throw new Error(data.error || "That did not work.");
  return data;
}

/* ---------- sign in / out ---------- */

function showGate(message) {
  gate.hidden = false;
  desk.hidden = true;
  signout.hidden = true;
  gateError.textContent = message || "";
  gateError.hidden = !message;
  $("#passcode").value = "";
}

function endSession(message) {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  reservations = [];
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
    const res = await call("login", { passcode });
    token = res.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    gate.hidden = true;
    desk.hidden = false;
    signout.hidden = false;
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
    ? "Could not reach the booking desk. Check your connection."
    : err.message;
}

/* ---------- loading ---------- */

async function load() {
  note.textContent = "Loading…";
  note.hidden = false;
  try {
    const res = await call("list");
    reservations = res.reservations;
    render();
    note.hidden = true;
  } catch (err) {
    if (err.message === "signed out") return;
    note.textContent = friendly(err);
    note.hidden = false;
  }
}

$("#refresh").addEventListener("click", load);
$$('input[name="filter"]').forEach((r) => r.addEventListener("change", render));

// Coming back to the tab after a while should not show a stale list.
addEventListener("visibilitychange", () => {
  if (!document.hidden && token && !desk.hidden) load();
});

/* ---------- rendering ---------- */

const FACTS = [
  ["tripType", "Trip"],
  ["passengers", "Passengers"],
  ["luggage", "Bags"],
  ["flight", "Flight"],
  ["returnDate", "Return date"],
  ["returnTime", "Return time"],
  ["notes", "Notes", true],
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

// "2026-11-01 09:14" from the sheet -> "Nov 1, 9:14 AM"
function fmtReceived(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return String(v || "");
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function statusOf(r) {
  const s = (r.status || "New").trim();
  return s || "New";
}

function render() {
  const filter = $('input[name="filter"]:checked').value;

  const counts = { New: 0, Quoted: 0, Confirmed: 0, All: reservations.length };
  reservations.forEach((r) => {
    const s = statusOf(r);
    if (s in counts) counts[s]++;
  });
  $$("[data-count]").forEach((el) => { el.textContent = counts[el.dataset.count] ?? 0; });

  const shown = filter === "All" ? reservations : reservations.filter((r) => statusOf(r) === filter);
  list.replaceChildren(...shown.map(card));
  empty.hidden = shown.length > 0;
  empty.textContent = reservations.length
    ? `Nothing ${filter.toLowerCase()}.`
    : "No reservations yet.";
}

function card(r) {
  const el = $("#res-tpl").content.firstElementChild.cloneNode(true);
  const t = r.trip;
  const status = statusOf(r);

  $(".res-ref", el).textContent = r.ref;
  const pill = $(".res-status", el);
  pill.textContent = status;
  pill.dataset.status = status;
  $(".res-when", el).textContent = fmtReceived(r.received);

  $(".res-trip", el).textContent = `${t.service} · ${fmtDate(t.date)}, ${fmtTime(t.time)}`;
  $(".res-pickup", el).textContent = t.pickup;
  $(".res-dropoff", el).textContent = t.dropoff;

  const facts = $(".res-facts", el);
  FACTS.forEach(([key, label, wide]) => {
    if (!t[key]) return;
    // Each label and value share one grid cell, or they wrap independently
    // and a value ends up under somebody else's label.
    const pair = document.createElement("div");
    pair.className = wide ? "fact wide" : "fact";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = /date$/i.test(key) ? fmtDate(t[key]) : /time$/i.test(key) ? fmtTime(t[key]) : t[key];
    pair.append(dt, dd);
    facts.append(pair);
  });

  $(".res-name", el).textContent = t.name;
  $(".res-tel", el).href = `tel:+1${digits(t.phone)}`;
  $(".res-sms", el).href = `sms:+1${digits(t.phone)}`;
  $(".res-mail", el).href = `mailto:${t.email}?subject=${encodeURIComponent(`Your trip ${r.ref}`)}`;

  const quote = $(".res-quote", el);
  const noteInput = $(".res-note", el);
  quote.value = r.quote || "";
  noteInput.value = r.note || "";

  const sent = $(".res-sent", el);
  const resend = $(".res-resend", el);
  const confirm = $(".res-confirm", el);
  if (r.confirmedSent) {
    sent.textContent = `Rider emailed ${r.confirmedSent}.`;
    sent.hidden = false;
    confirm.hidden = true;
    resend.hidden = false;
  }

  const msg = $(".res-msg", el);
  const say = (text, kind) => {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = !text;
  };

  const act = async (payload, working) => {
    el.classList.add("is-busy");
    say(working, "ok");
    try {
      const res = await call("update", {
        ref: r.ref,
        quote: quote.value,
        note: noteInput.value,
        ...payload,
      });
      // Swap in the row the server actually holds now, so the card can never
      // drift from the sheet.
      const i = reservations.findIndex((x) => x.ref === r.ref);
      if (i > -1) reservations[i] = res.reservation;
      render();
    } catch (err) {
      el.classList.remove("is-busy");
      if (err.message !== "signed out") say(friendly(err), "error");
    }
  };

  confirm.addEventListener("click", () => act({ status: "Confirmed" }, "Confirming and emailing…"));
  $(".res-quoted", el).addEventListener("click", () =>
    act({ status: status === "Confirmed" ? status : "Quoted" }, "Saving…"));
  $(".res-decline", el).addEventListener("click", () => {
    if (!window.confirm(`Decline ${r.ref}? The rider is not emailed — you would tell them yourself.`)) return;
    act({ status: "Declined" }, "Saving…");
  });
  resend.addEventListener("click", () => {
    if (!window.confirm(`Send ${t.name} the confirmation email again?`)) return;
    act({ status: "Confirmed", resend: true }, "Sending again…");
  });

  return el;
}

/* ---------- start ---------- */

if (token) {
  gate.hidden = true;
  desk.hidden = false;
  signout.hidden = false;
  load();
} else {
  showGate("");
}
