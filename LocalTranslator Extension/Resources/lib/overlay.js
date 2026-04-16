// lib/overlay.js — renders translated text over the original image bubbles.
//
// Strategy:
//   - Create a positioned <div> sibling to the image that matches the image's
//     on-screen rect exactly. This avoids modifying the image itself (which
//     could break sites that swap src / lazy-load) while still looking like
//     the text was painted onto the picture.
//   - For each translated region, create a child <div> absolutely positioned
//     in the overlay and sized to the region. Fill it with a near-white
//     background (to mask the source text) and place the translated string
//     centred inside with auto-shrinking font.
//   - Reposition on resize + scroll using a ResizeObserver.

const OVERLAY_CLASS = "lt-overlay-root";
const BUBBLE_CLASS = "lt-overlay-bubble";

function renderOverlay(imgEl, sourceCanvas, translations) {
  // Root element tracks the image's layout rectangle.
  const root = document.createElement("div");
  root.className = OVERLAY_CLASS;
  root.setAttribute("aria-hidden", "true");
  root.dataset.ltOverlay = "1";

  const parent = imgEl.parentElement || document.body;
  // Make sure the parent creates a containing block for absolute positioning.
  const parentStyle = getComputedStyle(parent);
  if (parentStyle.position === "static") {
    parent.style.position = "relative";
  }
  parent.appendChild(root);

  function place() {
    const imgRect = imgEl.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    root.style.left = imgRect.left - parentRect.left + parent.scrollLeft + "px";
    root.style.top = imgRect.top - parentRect.top + parent.scrollTop + "px";
    root.style.width = imgRect.width + "px";
    root.style.height = imgRect.height + "px";
  }

  const sx = sourceCanvas.width;
  const sy = sourceCanvas.height;

  for (const { region, english } of translations) {
    const bubble = document.createElement("div");
    bubble.className = BUBBLE_CLASS;
    const leftPct = (region.x / sx) * 100;
    const topPct = (region.y / sy) * 100;
    const wPct = (region.w / sx) * 100;
    const hPct = (region.h / sy) * 100;
    bubble.style.left = `${leftPct}%`;
    bubble.style.top = `${topPct}%`;
    bubble.style.width = `${wPct}%`;
    bubble.style.height = `${hPct}%`;
    bubble.textContent = english;
    root.appendChild(bubble);
  }

  place();

  const ro = new ResizeObserver(place);
  ro.observe(imgEl);
  window.addEventListener("scroll", place, { passive: true });
  window.addEventListener("resize", place);

  return {
    remove() {
      ro.disconnect();
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      root.remove();
    },
  };
}

// Expose for content script use (injected as a plain script, not an ES module).
window._LT = window._LT || {};
window._LT.renderOverlay = renderOverlay;
