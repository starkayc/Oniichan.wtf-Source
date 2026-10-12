/**
 * Shared page behaviour: back-to-top, sticky-chrome measurement, deep links, in-page nav.
 */

import { reducedMotion } from "./motion.js";

const BACK_TO_TOP_AFTER_PX = 300;
const EDGE_EPSILON_PX = 1;
const PILL_MARGIN_PX = 12;
const SCROLL_SETTLED_MS = 150;

/** Band below the sticky chrome in which a section counts as current. */
const OBSERVER_BAND = "-25% 0px -65% 0px";

const backToTop = document.querySelector(".back-to-top");

// One handler for the whole page: the floating pill, and the flag on <html> that drives
// the scroll-edge fade on whichever bar is bottom-most.
const syncScroll = () => {
  document.documentElement.toggleAttribute("data-scrolled", window.scrollY > 0);
  backToTop?.classList.toggle("is-visible", window.scrollY > BACK_TO_TOP_AFTER_PX);
};

syncScroll();
window.addEventListener("scroll", syncScroll, { passive: true });

backToTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// The item is flagged before it opens so faq.js does not report it as a user flip.
const openHashTarget = () => {
  const target = document.getElementById(window.location.hash.slice(1));
  if (!(target instanceof HTMLDetailsElement)) return;

  target.dataset.openedByHash = "1";
  target.open = true;
};

openHashTarget();
window.addEventListener("hashchange", openHashTarget);

// Two flags tell theme.css which edge of the pill row is actually cut off.
const tocList = document.querySelector(".page-nav-list");

if (tocList) {
  const syncTocEdges = () => {
    const maxScroll = tocList.scrollWidth - tocList.clientWidth;
    tocList.toggleAttribute("data-overflow-start", tocList.scrollLeft > EDGE_EPSILON_PX);
    tocList.toggleAttribute("data-overflow-end", tocList.scrollLeft < maxScroll - EDGE_EPSILON_PX);
  };

  syncTocEdges();
  tocList.addEventListener("scroll", syncTocEdges, { passive: true });
  // Wrapping and the label's visibility both change the row's width.
  new ResizeObserver(syncTocEdges).observe(tocList);

  // Tab reaches pills that are scrolled out of sight; reveal them the way the engine
  // reveals any focused element. `block: nearest` keeps the page itself still.
  tocList.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      event.target.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  });
}

const keepPillInView = (pill) => {
  if (!tocList || tocList.scrollWidth <= tocList.clientWidth) return;

  const left = pill.offsetLeft;
  const right = left + pill.offsetWidth;
  const inView = left >= tocList.scrollLeft && right <= tocList.scrollLeft + tocList.clientWidth;
  if (inView) return;

  tocList.scrollTo({
    left: Math.max(0, left - PILL_MARGIN_PX),
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
};

// Measured, not assumed: the nav's height varies with wrapping, zoom and the system
// font size, and anchor jumps offset by it.
const siteNav = document.querySelector(".site-nav");
const inPageNav = document.querySelector(".page-nav");

if (siteNav) {
  const measureChrome = () => {
    const navHeight = siteNav.getBoundingClientRect().height;
    const tocHeight = inPageNav?.getBoundingClientRect().height ?? 0;
    document.documentElement.style.setProperty("--h-nav", `${Math.round(navHeight)}px`);
    document.documentElement.style.setProperty(
      "--h-chrome",
      `${Math.round(navHeight + tocHeight)}px`
    );
  };

  // Once up front: a deep link is scrolled before the observer's first callback.
  measureChrome();

  const chromeObserver = new ResizeObserver(measureChrome);
  chromeObserver.observe(siteNav);
  if (inPageNav) chromeObserver.observe(inPageNav);
}

const navLinks = [...document.querySelectorAll(".page-nav-list a[href^='#']")];
const navSections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if (navSections.length > 0) {
  // A tap holds the pill until scrolling stops, so the spy cannot steal it mid-scroll.
  let held = false;
  let settleTimer = 0;

  const release = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      held = false;
    }, SCROLL_SETTLED_MS);
  };

  const setCurrent = (id) => {
    for (const link of navLinks) {
      if (link.getAttribute("href") !== `#${id}`) {
        link.removeAttribute("aria-current");
        continue;
      }
      // Must be the literal string theme.css selects on: a plain `true` from
      // toggleAttribute writes an empty value that matches nothing.
      link.setAttribute("aria-current", "location");
      keepPillInView(link);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (held) return;
      for (const entry of entries) {
        if (entry.isIntersecting) setCurrent(entry.target.id);
      }
    },
    { rootMargin: OBSERVER_BAND }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (held) release();
    },
    { passive: true }
  );

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      setCurrent(link.getAttribute("href").slice(1));
      held = true;
      release();
    });
  }

  for (const section of navSections) observer.observe(section);
}
