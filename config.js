// The one place the Apps Script web app URL lives. Both the booking form and
// the admin desk read it from here.
//
// Paste the /exec URL from Deploy > New deployment > Web app.
// See booking-automation/README.md.
const BOOKING_ENDPOINT = "https://script.google.com/macros/s/AKfycbw1g9SKOVfOP1_4zfRffED7W_U9bVq2xiqJ1HE34JPGZc47leDBJOB-xWPXnxSclBGD/exec";

// Where "Leave a Google review" sends people. The id is the Google Business
// Profile's Place ID; it belongs to the business, not to this domain, so it
// keeps working wherever the site is hosted.
const GOOGLE_REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJM4MOAXtT-IgRnFsz1b1kzlA";
