// TPT Black Car · phones only.
// The desktop website is left exactly as it is: everything here switches on
// below 48rem (the same width as mobile.css) and off again above it. It adds
// to the booking form from app.js without changing what the form sends.

(() => {
  const mq = matchMedia("(max-width: 48rem)");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const form = $("#quote-form");
  const booking = $("#booking");
  if (!form || !booking) return;
  const root = document.documentElement;
  const added = []; // everything this script put on the page, removed again on a wide screen

  const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    "Airport Service": '<path fill="currentColor" stroke="none" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
    "Corporate Function": '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
    "Wedding": '<circle cx="12" cy="15" r="6"/><path d="m9 4 3 4 3-4-1.5-1.5h-3z"/>',
    "Special Event": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    "Personal Car Service": '<path d="M4 16v-4l2-5h12l2 5v4zM4 16v3h3v-3M17 16v3h3v-3M4 12h16"/>',
    "Funeral": '<path d="M12 21v-7M12 14c-4 0-6-3-6-7 3 0 5 1.5 6 4 1-2.5 3-4 6-4 0 4-2 7-6 7zM12 11V3"/>',
  };

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDate = (v) => { const [y, m, d] = String(v).split("-").map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const fmtTime = (v) => { const [h, m] = String(v).split(":").map(Number); return isNaN(h) ? "" : new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  const place = (v) => String(v || "").split(",")[0].trim();

  /* ---------- the sheet ----------
     On a phone the form opens full screen. The back gesture closes it, as it
     would any app screen. */

  const isOpen = () => root.classList.contains("m-sheet");
  function openSheet() {
    if (!mq.matches) return false;
    if (!isOpen()) {
      root.classList.add("m-sheet");
      history.pushState({ mSheet: true }, "");
    }
    booking.scrollTop = 0;
    return true;
  }
  function closeSheet(fromHistory) {
    if (!isOpen()) return;
    root.classList.remove("m-sheet");
    if (!fromHistory && history.state && history.state.mSheet) history.back();
  }
  addEventListener("popstate", () => closeSheet(true));
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  // Every "Reserve" link on the page opens the sheet instead of scrolling to
  // the form. app.js still gets the click, so a service link still picks its service.
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#booking"]');
    if (!a || !mq.matches) return;
    e.preventDefault();
    openSheet();
  }, true);

  /* ---------- the pieces only a phone gets ---------- */

  function setUp() {
    // Close button and the step counter in the form's header.
    const head = $(".booking-head", booking);
    const close = Object.assign(document.createElement("button"), { type: "button", className: "m-close" });
    close.setAttribute("aria-label", "Close");
    close.innerHTML = svg('<path d="M6 6l12 12M18 6 6 18"/>');
    close.addEventListener("click", () => closeSheet());
    head.prepend(close);
    added.push(close);

    // An icon on each service.
    $$("#service-chips label").forEach((l) => {
      const v = $("input", l).value;
      if (!ICONS[v]) return;
      const span = $("span", l);
      span.insertAdjacentHTML("afterbegin", svg(ICONS[v]));
      added.push(span.firstElementChild);
    });

    // Swap pickup and drop-off.
    const swap = Object.assign(document.createElement("button"), { type: "button", className: "m-swap" });
    swap.setAttribute("aria-label", "Swap pickup and drop-off");
    swap.innerHTML = svg('<path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4"/>');
    swap.addEventListener("click", () => {
      [form.pickup.value, form.dropoff.value] = [form.dropoff.value, form.pickup.value];
      form.dispatchEvent(new Event("change"));
    });
    $(".route", form).append(swap);
    added.push(swap);

    // Today / Tomorrow / Pick a date, above the date and time fields.
    const when = document.createElement("div");
    when.className = "m-when";
    when.setAttribute("role", "group");
    when.setAttribute("aria-label", "Date");
    const days = [["Today", 0], ["Tomorrow", 1], ["Pick a date", null]];
    days.forEach(([label, add]) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
      b.addEventListener("click", () => {
        if (add === null) {
          try { form.date.showPicker(); } catch { form.date.focus(); }
          return;
        }
        const d = new Date();
        d.setDate(d.getDate() + add);
        form.date.value = iso(d);
        form.date.dispatchEvent(new Event("change", { bubbles: true }));
        form.time.focus();
      });
      when.append(b);
    });
    const markWhen = () => {
      const t = new Date();
      const today = iso(t);
      t.setDate(t.getDate() + 1);
      const tomorrow = iso(t);
      const v = form.date.value;
      const [a, b, c] = $$("button", when);
      a.setAttribute("aria-pressed", String(v === today));
      b.setAttribute("aria-pressed", String(v === tomorrow));
      c.setAttribute("aria-pressed", String(!!v && v !== today && v !== tomorrow));
      c.textContent = v && v !== today && v !== tomorrow ? fmtDate(v) : "Pick a date";
    };
    form.date.addEventListener("change", markWhen);
    form.date.addEventListener("input", markWhen);
    markWhen();
    form.date.closest(".row").before(when);
    added.push(when);

    // What step 1 said, at the top of steps 2 and 3.
    $$('.step[data-step="2"], .step[data-step="3"]', form).forEach((step) => {
      const sum = document.createElement("div");
      sum.className = "m-sum";
      sum.innerHTML = "<span></span>";
      const edit = Object.assign(document.createElement("button"), { type: "button", textContent: "Edit" });
      // app.js's own step switch, so its step dots and checks stay right.
      edit.addEventListener("click", () => { if (typeof showStep === "function") showStep(1); });
      sum.append(edit);
      step.prepend(sum);
      added.push(sum);
    });

    // Start the trip from the box under the hero.
    const quick = $("#m-quick");
    if (quick) quick.hidden = false;
  }

  function tearDown() {
    closeSheet();
    added.splice(0).forEach((el) => el.remove());
    $$(".m-ticket, .m-ticket-acts").forEach((el) => el.remove());
    const quick = $("#m-quick");
    if (quick) quick.hidden = true;
  }

  function paintSum() {
    $$(".m-sum span", form).forEach((s) => {
      const from = place(form.pickup.value), to = place(form.dropoff.value);
      s.replaceChildren();
      const b = document.createElement("b");
      b.textContent = from && to ? `${from} → ${to}` : "Your trip";
      s.append(b, ` · ${[fmtDate(form.date.value), fmtTime(form.time.value)].filter(Boolean).join(", ")}`);
    });
  }

  const quickForm = $("#m-quick");
  if (quickForm) {
    quickForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = $("#m-pickup").value.trim();
      const d = $("#m-dropoff").value.trim();
      if (p) form.pickup.value = p;
      if (d) form.dropoff.value = d;
      if (typeof showStep === "function") showStep(1);
      openSheet();
      // Straight to whatever is still missing.
      const next = !form.service.value ? null : !form.pickup.value ? form.pickup : !form.dropoff.value ? form.dropoff : form.date;
      if (next) setTimeout(() => next.focus({ preventScroll: true }), 300);
    });
  }

  /* ---------- the confirmation ticket ---------- */

  const done = $("#done");
  function ticket() {
    if (!mq.matches || done.hidden) return;
    // A second booking from the same page gets a fresh ticket.
    $$(".m-ticket, .m-ticket-acts", done).forEach((el) => el.remove());
    const data = Object.fromEntries(new FormData(form).entries());
    const ref = ($("#done-ref").textContent || "").replace(/^Reference\s*/i, "").trim();
    const t = document.createElement("div");
    t.className = "m-ticket";
    const top = document.createElement("div");
    top.className = "m-ticket-top";
    if (ref) {
      const r = document.createElement("p");
      r.className = "m-ticket-ref";
      const b = document.createElement("b");
      b.textContent = ref;
      r.append("Reference", b);
      top.append(r);
    }
    const route = document.createElement("ol");
    route.className = "m-ticket-route";
    [data.pickup, data.dropoff].forEach((v) => { const li = document.createElement("li"); li.textContent = v || ""; route.append(li); });
    top.append(route);
    const cut = document.createElement("div");
    cut.className = "m-ticket-cut";
    const facts = document.createElement("dl");
    facts.className = "m-ticket-facts";
    const third = data.service === "Airport Service" && data.flight
      ? ["Flight", data.flight] : ["Passengers", data.passengers || "1"];
    [["Date", fmtDate(data.date)], ["Pickup", fmtTime(data.time)], third].forEach(([k, v]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      div.append(dt, dd);
      facts.append(div);
    });
    t.append(top, cut, facts);

    const acts = document.createElement("div");
    acts.className = "m-ticket-acts";
    const cal = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-quiet", textContent: "Add to calendar" });
    cal.addEventListener("click", () => calendar(data, ref));
    const callBtn = Object.assign(document.createElement("a"), { className: "btn btn-quiet", href: "tel:+18649016550", textContent: "Call TPT" });
    acts.append(cal, callBtn);

    const refLine = $("#done-ref");
    refLine.after(t);
    t.after(acts);
    booking.scrollTop = 0;
  }
  new MutationObserver(ticket).observe(done, { attributes: true, attributeFilter: ["hidden"] });

  /** A calendar entry for the requested pickup, marked as waiting on TPT. */
  function calendar(data, ref) {
    const [y, m, d] = String(data.date).split("-");
    const [hh, mm] = String(data.time).split(":");
    if (!y || !hh) return;
    const esc = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TPT Black Car//Ride request//EN", "BEGIN:VEVENT",
      `UID:${ref || stamp}@tptblackcar.com`, `DTSTAMP:${stamp}`, `DTSTART:${y}${m}${d}T${hh}${mm}00`, "DURATION:PT1H",
      `SUMMARY:${esc(`TPT ride${ref ? " " + ref : ""} (request, not yet confirmed)`)}`,
      `LOCATION:${esc(data.pickup)}`,
      `DESCRIPTION:${esc(`Pickup: ${data.pickup}\nDrop-off: ${data.dropoff}\nTPT confirms by email from bookings@tptblackcar.com. Questions: 864-901-6550.`)}`,
      "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `TPT-ride${ref ? "-" + ref : ""}.ics` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---------- keep the extras in step with app.js ---------- */

  // app.js shows and hides the steps; refresh the summary when it does.
  new MutationObserver(() => { if (mq.matches) { paintSum(); booking.scrollTop = 0; } })
    .observe(form, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

  const apply = () => (mq.matches ? (added.length ? null : setUp()) : tearDown());
  mq.addEventListener("change", apply);
  apply();
  paintSum();
})();
