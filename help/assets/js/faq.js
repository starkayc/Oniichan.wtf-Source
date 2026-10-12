/**
 * FAQ accordion: the drawer animation and open tracking.
 */

import { reducedMotion } from "./motion.js";

/** Analytics event for an opened answer, id as its property. */
const FAQ_OPEN_EVENT = "faq_open";

// Timing comes from CSS so the panel and the chevron cannot drift apart.
const rootStyle = getComputedStyle(document.documentElement);
const DRAWER_MS = parseFloat(rootStyle.getPropertyValue("--drawer-duration")) || 300;
const DRAWER_EASING = rootStyle.getPropertyValue("--drawer-easing").trim() || "ease";

const COLLAPSED = { height: "0px", paddingTop: "0px", paddingBottom: "0px" };

/** The answer as it is right now, including any animation in flight. */
const measure = (answer) => {
  const style = getComputedStyle(answer);
  return {
    height: `${answer.getBoundingClientRect().height}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
  };
};

function setupDrawer(item) {
  const summary = item.querySelector(".faq-q");
  const answer = item.querySelector(".faq-answer");
  if (!summary || !answer) return;

  let animation = null;
  let fade = null;

  const start = (from, to) => {
    animation?.cancel();
    fade?.cancel();
    const options = { duration: DRAWER_MS, easing: DRAWER_EASING };

    animation = answer.animate([from, to], options);
    // Faded in step with the box: the clip edge would otherwise slice glyphs flat.
    fade = answer.animate(
      [{ opacity: from.height === "0px" ? 0 : 1 }, { opacity: to.height === "0px" ? 0 : 1 }],
      options
    );
    return animation;
  };

  const collapse = (from) => {
    item.classList.add("is-closing");
    const closing = start(from, COLLAPSED);
    // A cancelled collapse leaves the item open, so the row returns to its open state.
    const settle = () => item.classList.remove("is-closing");

    closing.addEventListener(
      "finish",
      () => {
        item.open = false;
        settle();
      },
      { once: true }
    );
    closing.addEventListener("cancel", settle, { once: true });
  };

  summary.addEventListener("click", (event) => {
    // Reduced motion: let the browser toggle instantly.
    if (reducedMotion.matches) return;

    event.preventDefault();

    // Closed items still report their natural height, so the collapsed state is spelled
    // out; open ones are measured live, which a mid-animation reversal needs.
    const wasOpen = item.open;
    const from = wasOpen ? measure(answer) : COLLAPSED;
    animation?.cancel();
    fade?.cancel();
    animation = null;
    fade = null;

    if (wasOpen) {
      collapse(from);
      return;
    }

    item.classList.remove("is-closing");
    item.open = true;
    start(from, measure(answer));
  });
}

for (const item of document.querySelectorAll(".faq-item")) {
  setupDrawer(item);

  item.addEventListener("toggle", () => {
    if (!item.open) return;
    if (item.dataset.openedByHash) {
      delete item.dataset.openedByHash;
      return;
    }
    // Optional call: a no-op when the analytics tag is blocked.
    window.umami?.track?.(FAQ_OPEN_EVENT, { faq: item.id });
  });
}
