/**
 * REAVES — Google Search Grader (Inline Breadcrumb Pill Edition)
 *
 * Injects a premium pill badge INLINE at the end of each Google search result's
 * URL breadcrumb row (e.g., nba.com > Players [ ✦ HIGH TRUST ]).
 *
 * Uses Shadow DOM isolation to prevent Google's CSS from inverting the badge.
 * Glassmorphism background with Lakers Gold border. Hover expands to show score.
 */

(function () {
  "use strict";

  // ─── Domain exclusion — skip badge injection on video-heavy sites ────────────
  var EXCLUDED_DOMAINS = ['www.youtube.com', 'm.youtube.com', 'youtube.com'];

  // ─── Per-result URL patterns to skip (Videos tab results, etc.) ─────────────
  var SKIPPED_URL_PATTERNS = ['youtube.com', 'youtu.be', 'reddit.com'];

  function isExcludedDomain() {
    return EXCLUDED_DOMAINS.some(function (d) {
      return window.location.hostname === d || window.location.hostname.endsWith('.' + d);
    });
  }

  // ─── Tier definitions ───────────────────────────────────────────────────────
  var TIERS = {
    A: { icon: "\u2726", label: "HIGH TRUST", bg: "#10b981" }, // Emerald
    B: { icon: "\u2713", label: "REPUTABLE", bg: "#3b82f6" }, // Blue
    C: { icon: "\u26A0", label: "CAUTION", bg: "#f59e0b" }, // Amber
    D: { icon: "\u2716", label: "UNVERIFIED", bg: "#ef4444" }, // Red
    F: { icon: "\u2716", label: "UNVERIFIED", bg: "#ef4444" }, // Red
  };

  // ─── Shadow CSS — Inline Breadcrumb Pill ────────────────────────────────────
  var SHADOW_CSS = /* css */ `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap');

    :host {
      all: initial !important;
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      margin-left: 6px !important;
      transform: none !important;
      direction: ltr !important;
      writing-mode: horizontal-tb !important;
      unicode-bidi: isolate !important;
      z-index: 1 !important;
      flex-shrink: 0 !important;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      border-radius: 4px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      white-space: nowrap;
      cursor: help;
      position: relative;
      color: #ffffff;

      /* Glassmorphism */
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);

      /* Lakers Gold border */
      border: 1px solid #FDB927;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15),
                  0 0 0 0.5px rgba(253, 185, 39, 0.3);

      /* Mirror locks */
      direction: ltr;
      writing-mode: horizontal-tb;
      transform: none;
      unicode-bidi: isolate;

      transition: all 0.2s ease;
    }
    .pill:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2),
                  0 0 0 1px rgba(253, 185, 39, 0.5);
      transform: scale(1.05);
    }

    /* Score — hidden by default, revealed on hover */
    .pill-score {
      display: none;
      font-size: 9px;
      font-weight: 700;
      opacity: 0.85;
      color: #ffffff;
      margin-left: 2px;
    }
    .pill:hover .pill-score {
      display: inline;
    }

    /* Icon */
    .pill-icon {
      font-size: 10px;
      line-height: 1;
      flex-shrink: 0;
      color: #ffffff;
    }

    /* Label */
    .pill-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #ffffff;
    }

    /* Loading state */
    .pill.loading {
      background: rgba(113, 113, 122, 0.7);
      border-color: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    /* Error state */
    .pill.error {
      background: rgba(82, 82, 91, 0.7);
      border-color: rgba(255, 255, 255, 0.1);
      color: #e4e4e7;
    }

    /* Spinner */
    .spin {
      display: inline-block;
      width: 8px; height: 8px;
      border: 1.5px solid #ffffff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: rg-spin 0.6s linear infinite;
      flex-shrink: 0;
    }
    @keyframes rg-spin { to { transform: rotate(360deg); } }

    /* ── Tooltip — sleek dark panel ── */
    .tip {
      display: none;
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      background: #18181b;
      color: #e4e4e7;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 11.5px;
      font-weight: 400;
      line-height: 1.55;
      letter-spacing: 0;
      text-transform: none;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55),
                  0 0 0 1px rgba(0, 0, 0, 0.15);
      white-space: normal;
      width: 260px;
      text-align: left;
      z-index: 2147483647;
      direction: ltr;
      writing-mode: horizontal-tb;
    }
    .tip::before {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 14px;
      border: 6px solid transparent;
      border-bottom-color: #18181b;
    }
    .pill:hover .tip {
      display: block;
    }
  `;

  // ─── Toggle guard ──────────────────────────────────────────────────────────
  chrome.storage.local.get(["searchGraderEnabled"], function (res) {
    if (res.searchGraderEnabled === false) return;
    init();
  });

  function init() {
    // Skip entirely on excluded domains (e.g. YouTube)
    if (isExcludedDomain()) return;

    gradeAll();
    var obs = new MutationObserver(function () {
      gradeAll();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Grade all ungraded results ─────────────────────────────────────────────
  var isGrading = false;

  async function gradeAll() {
    // Double-check: bail out on excluded domains
    if (isExcludedDomain()) return;
    if (isGrading) return;
    isGrading = true;

    // URL-level dedup: prevents the same link from being graded twice
    // when overlapping selectors (div.g, div[data-hveid], .MjjYud > div)
    // match nested elements that share the same <a>.
    var gradedUrls = new Set();
    var requestIndex = 0;

    try {
      // Broad selector for Google search result blocks
      var candidates = document.querySelectorAll(
        "div.g, div[data-hveid], div.MjjYud > div",
      );

      for (var i = 0; i < candidates.length; i++) {
        var resultEl = candidates[i];

        // ── Guard 1: data-attribute on the result block ──
        if (resultEl.getAttribute("data-reaves-graded")) continue;

        var titleEl = resultEl.querySelector("h3");
        if (!titleEl) continue;

        // Target only the <a> that wraps the <h3> — avoids sub-links/buttons
        var linkEl = titleEl.closest("a[href]");
        if (!linkEl) linkEl = resultEl.querySelector("a[href]");
        if (!linkEl) continue;

        var snippetEl = resultEl.querySelector(".VwiC3b, [data-sncf], .lEBKkf");

        var url = linkEl.href || "";
        if (!url.startsWith("http") || url.includes("google.com/search"))
          continue;

        // ── Guard: skip video/social domains (YouTube, Reddit) ──
        var skipResult = false;
        for (var j = 0; j < SKIPPED_URL_PATTERNS.length; j++) {
          if (url.indexOf(SKIPPED_URL_PATTERNS[j]) !== -1) {
            skipResult = true;
            break;
          }
        }
        if (skipResult) {
          resultEl.setAttribute("data-reaves-graded", "1"); // mark so we don't retry
          continue;
        }

        // ── Guard 2: URL-level dedup across overlapping selectors ──
        if (gradedUrls.has(url)) {
          resultEl.setAttribute("data-reaves-graded", "1");
          continue;
        }
        gradedUrls.add(url);

        // Mark as graded immediately to prevent re-processing
        resultEl.setAttribute("data-reaves-graded", "1");

        var title = titleEl.textContent.trim();
        var snippet = snippetEl ? snippetEl.textContent.trim() : "";

        // ── Stagger: 1.5s between requests to avoid API rate-limits ──
        if (requestIndex > 0) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 1500);
          });
        }
        requestIndex++;

        // ── Find the container (favicon/URL breadcrumb row) ──
        var container =
          resultEl.querySelector(".yuRUbf") ||
          resultEl.querySelector(".ca_7v") ||
          resultEl.querySelector(".egMi0.kCrYT") ||
          resultEl.querySelector("[data-header-feature]") ||
          resultEl.querySelector(".TbwUpd")?.parentElement ||
          null;

        // Last resort: walk up from the <h3>
        if (!container) {
          container =
            titleEl.closest(".yuRUbf") ||
            titleEl.closest(".ca_7v") ||
            titleEl.parentElement;
        }

        if (!container) continue;

        // ── Guard 3: check if this container already has a badge ──
        if (container.querySelector(".reaves-pill-host")) continue;

        // ── Guard 4: fix mirrored / RTL containers ──
        // Google's Videos tab can apply dir="rtl" or transform:scaleX(-1)
        var containerStyle = window.getComputedStyle(container);
        var parentStyle = container.parentElement ? window.getComputedStyle(container.parentElement) : null;
        var isMirrored = (container.getAttribute("dir") === "rtl") ||
          (containerStyle.direction === "rtl") ||
          (containerStyle.transform && containerStyle.transform.indexOf("-1") !== -1) ||
          (parentStyle && parentStyle.transform && parentStyle.transform.indexOf("-1") !== -1);

        if (isMirrored) {
          container.style.direction = "ltr";
          container.style.transform = "none";
          if (container.parentElement && parentStyle && parentStyle.transform && parentStyle.transform.indexOf("-1") !== -1) {
            container.parentElement.style.transform = "none";
          }
        }

        // ── Build the inline wrapper ──
        // Sits at the end of the breadcrumb row as an inline element.
        var wrapper = document.createElement("span");
        wrapper.className = "reaves-pill-host";
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.style.cssText =
          "display:inline-flex;align-items:center;vertical-align:middle;";

        var shadow;
        try {
          shadow = wrapper.attachShadow({ mode: "open" });
        } catch (e) {
          // Fallback: inline pill without Shadow DOM
          wrapper.style.cssText =
            "display:inline-flex;align-items:center;gap:4px;" +
            "padding:1px 8px;border-radius:4px;margin-left:6px;" +
            "font:bold 10px Inter,system-ui,sans-serif;" +
            "color:#fff;background:rgba(113,113,122,0.7);" +
            "letter-spacing:.05em;text-transform:uppercase;" +
            "border:1px solid #FDB927;" +
            "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
            "direction:ltr;transform:none;white-space:nowrap;vertical-align:middle;";
          wrapper.textContent = "\u2699\uFE0F Grading\u2026";
          container.appendChild(wrapper);
          fetchGrade(wrapper, null, wrapper, title, url, snippet, 50);
          continue;
        }

        // Inject CSS
        var styleEl = document.createElement("style");
        styleEl.textContent = SHADOW_CSS;
        shadow.appendChild(styleEl);

        // Build loading pill
        var pill = document.createElement("span");
        pill.className = "pill loading";

        var spin = document.createElement("span");
        spin.className = "spin";
        pill.appendChild(spin);

        var lbl = document.createElement("span");
        lbl.className = "pill-label";
        lbl.textContent = "Analyzing\u2026";
        pill.appendChild(lbl);

        var tip = document.createElement("span");
        tip.className = "tip";
        tip.textContent = "Checking source credibility\u2026";
        pill.appendChild(tip);

        shadow.appendChild(pill);

        // ── Append inline wrapper to end of breadcrumb row ──
        container.appendChild(wrapper);

        fetchGrade(wrapper, pill, null, title, url, snippet, 50);
      }
    } finally {
      isGrading = false;
    }
  }

  // ─── Fetch grade from background service worker ─────────────────────────────
  function fetchGrade(wrapper, pill, fallbackEl, title, url, snippet, fallbackScore) {
    chrome.runtime.sendMessage(
      {
        type: "GRADE_SEARCH_RESULT",
        payload: { title: title, url: url, snippet: snippet },
      },
      function (response) {
        if (chrome.runtime.lastError || !response || response.error) {
          if (pill) {
            renderPill(
              pill,
              "rgba(82, 82, 91, 0.7)",
              "\u26A0\uFE0F",
              "ERROR",
              null,
              "Connecting to REAVES Cloud... Please check your internet connection.",
            );
          } else if (fallbackEl) {
            fallbackEl.style.background = "rgba(82, 82, 91, 0.7)";
            fallbackEl.textContent = "\u26A0 Error";
          }
          return;
        }

        var grade = response.grade || scoreToLetter(response.trustScore);
        var score =
          typeof response.score === "number"
            ? response.score
            : typeof response.trustScore === "number"
              ? response.trustScore
              : fallbackScore;
        var reason =
          response.reason || response.tooltip || "Analysis complete.";

        var tier = TIERS[grade] || TIERS.C;

        if (pill) {
          renderPill(pill, tier.bg + "cc", tier.icon, tier.label, score, reason);
        } else if (fallbackEl) {
          fallbackEl.style.background = tier.bg + "cc";
          fallbackEl.textContent = tier.icon + " " + tier.label;
        }
      },
    );
  }

  // ─── Pill renderer ──────────────────────────────────────────────────────────
  function renderPill(pill, bgColor, icon, label, score, reason) {
    pill.className = "pill";
    pill.style.background = bgColor;

    while (pill.firstChild) pill.removeChild(pill.firstChild);

    var iconEl = document.createElement("span");
    iconEl.className = "pill-icon";
    iconEl.textContent = icon;
    pill.appendChild(iconEl);

    var labelEl = document.createElement("span");
    labelEl.className = "pill-label";
    labelEl.textContent = label;
    pill.appendChild(labelEl);

    // Score — visible on hover
    if (score != null) {
      var scoreEl = document.createElement("span");
      scoreEl.className = "pill-score";
      scoreEl.textContent = "- " + score + "/100";
      pill.appendChild(scoreEl);
    }

    var tipEl = document.createElement("span");
    tipEl.className = "tip";
    tipEl.textContent = reason;
    pill.appendChild(tipEl);
  }

  function scoreToLetter(score) {
    if (score == null) return "C";
    if (score >= 85) return "A";
    if (score >= 70) return "B";
    if (score >= 50) return "C";
    if (score >= 35) return "D";
    return "F";
  }
})();
