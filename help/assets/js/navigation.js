/**
 * Navigation Enhancements
 * Version: 2.1.0
 */

(function () {
  "use strict";

  // Smooth scroll for anchor links
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", function (e) {
        const href = this.getAttribute("href");
        if (href === "#") return;

        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });

          // Update URL without scrolling
          history.pushState(null, null, href);
        }
      });
    });
  }

  // Add active link highlighting based on scroll position
  function initActiveNavigation() {
    const sections = document.querySelectorAll("section[id]");
    const navLinks = document.querySelectorAll('a[href^="#"]');

    if (sections.length === 0 || navLinks.length === 0) return;

    window.addEventListener(
      "scroll",
      () => {
        let current = "";

        sections.forEach((section) => {
          if (window.scrollY >= section.offsetTop - 200) {
            current = section.getAttribute("id");
          }
        });

        navLinks.forEach((link) => {
          link.classList.remove("active");
          if (link.getAttribute("href").slice(1) === current) {
            link.classList.add("active");
          }
        });
      },
      { passive: true }
    );
  }

  // Lazy load images
  function initLazyLoading() {
    if ("IntersectionObserver" in window) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.removeAttribute("data-src");
              observer.unobserve(img);
            }
          }
        });
      });

      document.querySelectorAll("img[data-src]").forEach((img) => {
        imageObserver.observe(img);
      });
    } else {
      // Fallback for older browsers
      document.querySelectorAll("img[data-src]").forEach((img) => {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      });
    }
  }

  // Back to top button
  function initBackToTop() {
    const backToTopBtn = document.createElement("button");
    backToTopBtn.className = "back-to-top";
    backToTopBtn.setAttribute("aria-label", "Back to top");
    backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    backToTopBtn.style.cssText = `
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #3b82f6;
      color: white;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    document.body.appendChild(backToTopBtn);

    // Show/hide button based on scroll position
    window.addEventListener(
      "scroll",
      () => {
        const visible = window.scrollY > 300;
        backToTopBtn.style.opacity = visible ? "1" : "0";
        backToTopBtn.style.visibility = visible ? "visible" : "hidden";
      },
      { passive: true }
    );

    // Scroll to top on click
    backToTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  // Initialize all features when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    initSmoothScroll();
    initActiveNavigation();
    initLazyLoading();
    initBackToTop();
  }
})();
