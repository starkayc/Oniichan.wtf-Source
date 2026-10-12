/**
 * Click-to-play previews for the skins grid and the FAQ answers.
 * Nothing is fetched until a thumbnail is pressed.
 */

const LOADING_MESSAGE = "Loading preview…";
const FAILED_MESSAGE = "This preview could not be loaded.";

/**
 * Failure needs three paths: `error` misses a 404 in WebKit, `play()` never settles on a
 * missing source, and the timeout catches a stall. A HEAD probe on click catches a 404
 * before the timeout does.
 */
const START_TIMEOUT_MS = 20000;

/** Every preview on the page, so only one plays at a time. */
const previews = [...document.querySelectorAll("video")].flatMap((video) => {
  const container = video.parentElement;
  const button = container?.querySelector(":scope > .preview-play");
  const status = container?.querySelector(":scope > .preview-status");
  return button && status ? [{ video, button, status }] : [];
});

/** Give an unlabelled button a name from the question or card it belongs to. */
for (const { video, button } of previews) {
  if (button.hasAttribute("aria-label")) continue;
  const heading =
    video.closest(".faq-item")?.querySelector(".faq-q") ??
    video.closest(".card")?.querySelector("h2");
  button.setAttribute(
    "aria-label",
    heading ? `Play: ${heading.textContent.trim()}` : "Play this video"
  );
}

for (const { video, button, status } of previews) {
  let timer = null;
  let failed = false;

  const stopWaiting = () => {
    clearTimeout(timer);
    timer = null;
    button.removeAttribute("aria-busy");
  };

  const fail = () => {
    failed = true;
    stopWaiting();
    status.textContent = FAILED_MESSAGE;
  };

  button.addEventListener("click", () => {
    for (const other of previews) {
      if (other.video !== video && !other.video.paused) other.video.pause();
    }

    // A failed element keeps that state and never settles a play() promise, so a
    // second press has to reset it to be a real retry.
    if (failed) {
      failed = false;
      video.load();
    }

    // WebKit's `error` event misses a 404, so probe the source here and fail fast.
    const src = video.currentSrc || video.querySelector("source")?.src;
    if (src) {
      fetch(src, { method: "HEAD" })
        .then((r) => {
          if (!r.ok) fail();
        })
        .catch(() => {});
    }

    button.setAttribute("aria-busy", "true");
    status.textContent = LOADING_MESSAGE;
    timer = setTimeout(fail, START_TIMEOUT_MS);

    // Started, not awaited: play() has to be called in the gesture, but its
    // promise is not the signal that playback began — `playing` is.
    video.play().catch(fail);
  });

  video.addEventListener("playing", () => {
    stopWaiting();
    failed = false;
    // Controls appear only once there is something to control.
    video.controls = true;
    button.hidden = true;
    status.textContent = "";
  });

  // Captured rather than bubbled: a failed <source> fires this on the source.
  video.addEventListener("error", fail, true);
}

/**
 * Warm the posters once the page is idle, so the first open has nothing left to
 * decode during the drawer animation.
 */
const warmPosters = () => {
  for (const { video } of previews) {
    const poster = video.getAttribute("poster");
    if (!poster) continue;
    const image = new Image();
    image.src = poster;
    // Warm-up only: a decode failure costs nothing.
    image.decode?.().catch(() => {});
  }
};

if ("requestIdleCallback" in window) {
  requestIdleCallback(warmPosters);
} else {
  window.addEventListener("load", warmPosters, { once: true });
}
