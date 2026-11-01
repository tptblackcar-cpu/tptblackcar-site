// The rider's cancel page. Reached from the link in their emails, which
// carries the reference and a signature proving the link is theirs.
//
// Opening the link only ever LOOKS the trip up. Cancelling is a second,
// deliberate press — mail scanners and link previewers fetch URLs out of
// inboxes, and a cancel that happened on page load would call off trips
// nobody touched.

const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
const ref = params.get("ref") || "";
const token = params.get("t") || "";

const loading = $("#loading");
const problem = $("#problem");
const confirmPanel = $("#confirm");
const donePanel = $("#done");
const cancelBtn = $("#cancel-btn");
const cancelError = $("#cancel-error");

async function call(action, extra = {}) {
  if (!BOOKING_ENDPOINT) throw new Error("Online cancelling is not set up yet.");
  const res = await fetch(BOOKING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ref, token, ...extra }),
    redirect: "follow",
  });
  return res.json();
}

function showProblem(title, text) {
  loading.hidden = true;
  confirmPanel.hidden = true;
  $("#problem-title").textContent = title;
  $("#problem-text").textContent = text;
  problem.hidden = false;
}

const REASONS = {
  "too close": [
    "This one is too close to call off online",
    "Your pickup is near enough that a car may already be arranged. Give us a ring and we will sort it out right away.",
  ],
  "already cancelled": [
    "That trip is already cancelled",
    "Nothing further to do. If you would like to book again, just call.",
  ],
  "already passed": [
    "That trip has already happened",
    "If something went wrong with it, please call and tell us.",
  ],
  "not booked": [
    "That trip was not booked",
    "There is nothing to cancel. Call us if you would like to arrange a car.",
  ],
};

async function start() {
  if (!ref || !token) {
    return showProblem(
      "That link is incomplete",
      "Open the link straight from your confirmation email, or call and we will cancel it for you."
    );
  }
  try {
    const res = await call("lookup");
    if (!res.ok) return showProblem("We could not open that", res.error);

    if (!res.cancellable) {
      const [title, text] = REASONS[res.reason] || [
        "This one needs a phone call",
        "Please call and we will take care of it.",
      ];
      return showProblem(title, text);
    }

    $("#c-ref").textContent = res.ref;
    const status = $("#c-status");
    status.textContent = res.status;
    status.dataset.status = res.status;
    $("#c-trip").textContent = `${res.trip.service} · ${res.trip.date}, ${res.trip.time}`;
    $("#c-pickup").textContent = res.trip.pickup;
    $("#c-dropoff").textContent = res.trip.dropoff;
    $("#confirm-lead").textContent = res.trip.name
      ? `${res.trip.name}, this is the trip we have. Cancelling costs nothing.`
      : "This is the trip we have. Cancelling costs nothing.";

    loading.hidden = true;
    confirmPanel.hidden = false;
  } catch (err) {
    showProblem(
      "We could not reach the booking desk",
      "Check your connection and try again, or call 864-901-6550."
    );
  }
}

cancelBtn.addEventListener("click", async () => {
  cancelBtn.disabled = true;
  cancelBtn.textContent = "Cancelling…";
  cancelError.hidden = true;
  try {
    const res = await call("cancel");
    if (!res.ok) {
      const [title, text] = REASONS[res.reason] || ["We could not cancel that", res.error];
      return showProblem(title, text);
    }
    confirmPanel.hidden = true;
    donePanel.hidden = false;
    donePanel.focus();
  } catch {
    cancelError.textContent =
      "We could not reach the booking desk. Please call 864-901-6550 and we will cancel it for you.";
    cancelError.hidden = false;
  } finally {
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Yes, cancel it";
  }
});

start();
