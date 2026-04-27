// lib/overlay.js — renders translated text over the original image bubbles.

(function () {
  if (window._LT && window._LT.renderOverlay) return; // already loaded

const OVERLAY_CLASS = "lt-overlay-root";
const BUBBLE_CLASS  = "lt-overlay-bubble";

function renderOverlay(imgEl, sourceCanvas, translations) {
  const root = document.createElement("div");
  root.className = OVERLAY_CLASS;
  root.setAttribute("aria-hidden", "true");
  root.dataset.ltOverlay = "1";
  // position:absolute is required so left/top/width/height actually work
  root.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "z-index:2147483646",
    "overflow:hidden",
  ].join(";");

  const parent = imgEl.parentElement || document.body;
  if (getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }
  parent.appendChild(root);

  function place() {
    const imgRect    = imgEl.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    root.style.left   = imgRect.left - parentRect.left + parent.scrollLeft + "px";
    root.style.top    = imgRect.top  - parentRect.top  + parent.scrollTop  + "px";
    root.style.width  = imgRect.width  + "px";
    root.style.height = imgRect.height + "px";
  }

  const sx = sourceCanvas.width;
  const sy = sourceCanvas.height;

  for (const { region, english } of translations) {
    const bubble = document.createElement("div");
    bubble.className = BUBBLE_CLASS;
    bubble.style.cssText = [
      "position:absolute",
      "box-sizing:border-box",
      "background:rgba(255,255,255,0.93)",
      "color:#111",
      "border:1.5px solid rgba(0,0,0,0.18)",
      "border-radius:6px",
      "padding:3px 5px",
      "font:500 11px/-apple-system,'Helvetica Neue',sans-serif",
      "line-height:1.35",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "text-align:center",
      "word-break:break-word",
      "overflow:hidden",
    ].join(";");
    bubble.style.left   = `${(region.x / sx) * 100}%`;
    bubble.style.top    = `${(region.y / sy) * 100}%`;
    bubble.style.width  = `${(region.w / sx) * 100}%`;
    bubble.style.height = `${(region.h / sy) * 100}%`;
    bubble.textContent  = english;
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

  window._LT = window._LT || {};
  window._LT.renderOverlay = renderOverlay;
})();
