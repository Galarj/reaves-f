/**
 * REAVES Extension — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * - Open the side panel when action icon is clicked
 * - Route messages between content scripts and the sidebar
 * - Proxy API calls to the Next.js web app (keeps base URL configurable)
 * - Manage session token in chrome.storage.session
 */

// Production API base — hardcoded because background.js is NOT processed by Vite.
const API_BASE = 'https://reaves-f-mol1.vercel.app';
const SUPABASE_URL = 'https://fxmudyjgfheriatuqphw.supabase.co';
console.log('[REAVES] Service Worker loaded. API target:', API_BASE);

// ─── Smart Glossary: instant lookup table ─────────────────────────────────────
// Matched by lowercase key. Returns the same shape as /api/define.
const JARGON_MAP = {
  synthesis: {
    word: 'Synthesis',
    short_definition: 'Combining information from multiple sources to form a new, unified argument or understanding.',
    detailed_explanation: 'In academic research, synthesis means weaving together ideas, findings, and arguments from multiple sources into a coherent new understanding. Rather than summarizing each source individually, synthesis shows how they relate, agree, or contradict each other—forming the backbone of literature reviews and research papers.',
  },
  doi: {
    word: 'DOI',
    short_definition: 'A Digital Object Identifier — a permanent link that uniquely identifies an academic paper or dataset.',
    detailed_explanation: 'A DOI (Digital Object Identifier) is a standardized alphanumeric string assigned to academic publications to provide a persistent link to their location on the internet. Unlike regular URLs that may change, a DOI is permanent and resolves to the current location of the document, making citations reliable and machine-readable.',
  },
  qualitative: {
    word: 'Qualitative',
    short_definition: 'Research that collects non-numerical data like interviews or observations to understand concepts and experiences.',
    detailed_explanation: 'Qualitative research explores the "why" and "how" behind human behavior, collecting data through interviews, observations, focus groups, and textual analysis. Rather than producing statistics, it generates rich, descriptive insights into participants\' experiences, attitudes, and motivations—commonly used in social sciences, education, and health research.',
  },
  quantitative: {
    word: 'Quantitative',
    short_definition: 'Research that uses numerical data and statistical analysis to measure variables and identify patterns.',
    detailed_explanation: 'Quantitative research relies on numerical data, statistical tests, and objective measurements to answer research questions. It is designed to produce generalizable results across large populations, using methods such as surveys, experiments, and existing datasets. Findings are usually presented as statistics, correlations, or effect sizes.',
  },
  'peer-reviewed': {
    word: 'Peer-Reviewed',
    short_definition: 'A publication vetted by independent experts in the field before it is published.',
    detailed_explanation: 'Peer review is the process by which a submitted academic paper is evaluated by independent experts (peers) in the same field before publication. Reviewers assess the methodology, originality, and accuracy of the work, acting as a quality filter. Peer-reviewed publications are considered the gold standard of reliable academic evidence.',
  },
  'peer reviewed': {
    word: 'Peer-Reviewed',
    short_definition: 'A publication vetted by independent experts in the field before it is published.',
    detailed_explanation: 'Peer review is the process by which a submitted academic paper is evaluated by independent experts (peers) in the same field before publication. Reviewers assess the methodology, originality, and accuracy of the work, acting as a quality filter. Peer-reviewed publications are considered the gold standard of reliable academic evidence.',
  },
};

// ─── Side panel setup ────────────────────────────────────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ─── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === 'OPEN_SIDEBAR') {
    // Content script requests sidebar open with selected text
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(console.error);
      // Forward the selected text to the sidebar once it opens
      // We store it temporarily so the sidebar can pick it up on mount
      chrome.storage.session.set({ pendingSelection: message.text }).catch(console.error);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'GET_PENDING_SELECTION') {
    chrome.storage.session.get('pendingSelection').then((result) => {
      sendResponse({ text: result.pendingSelection || null });
      // Clear after reading
      chrome.storage.session.remove('pendingSelection');
    });
    return true; // async
  }

  if (type === 'CALL_API') {
    // { endpoint: '/api/clarify', method: 'POST', body: {...} }
    const { endpoint, method = 'POST', body } = message;
    chrome.storage.session.get('authToken').then(async (result) => {
      try {
        const fullUrl = `${API_BASE}${endpoint}`;
        console.log(`[REAVES] Fetching: ${fullUrl}`);
        const res = await fetch(fullUrl, {
          method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(result.authToken ? { Authorization: `Bearer ${result.authToken}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        sendResponse({ ok: res.ok, status: res.status, data });
      } catch (err) {
        sendResponse({ ok: false, error: "REAVES Cloud Syncing... Please verify your session at reaves-f-mol1.vercel.app" });
      }
    });
    return true; // async
  }

  if (type === 'GET_SESSION') {
    chrome.storage.session.get('authToken').then((result) => {
      sendResponse({ token: result.authToken || null });
    });
    return true;
  }

  if (type === 'SET_SESSION') {
    chrome.storage.session.set({ authToken: message.token }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (type === 'CLEAR_SESSION') {
    chrome.storage.session.remove('authToken').then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (type === 'INJECT_HIGHLIGHTS') {
    // Forward highlight instructions to the active content script
    const tabId = sender.tab?.id ?? message.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'DO_HIGHLIGHT', excerpts: message.excerpts });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'CLEAR_HIGHLIGHTS') {
    const tabId = sender.tab?.id ?? message.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'DO_CLEAR_HIGHLIGHTS' });
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── Smart Glossary Hover ──────────────────────────────────────────────────
  if (type === 'GET_DEFINITION') {
    const rawWord = (message.word ?? '').trim();
    const key = rawWord.toLowerCase();

    // 1. Fast path — hardcoded jargon map (instant, no network)
    if (JARGON_MAP[key]) {
      sendResponse({ ok: true, ...JARGON_MAP[key] });
      return true;
    }

    // 2. Slow path — call the Next.js backend
    fetch(`${API_BASE}/api/define`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: rawWord }),
    })
      .then((res) => res.json())
      .then((data) => {
        // Forward the full API shape: { word, short_definition, detailed_explanation }
        sendResponse({ ok: true, ...data });
      })
      .catch((err) => {
        console.error('[REAVES background] GET_DEFINITION fetch error:', err);
        sendResponse({ ok: false, definition: null, error: "REAVES Cloud Syncing... Please verify your session at reaves-f-mol1.vercel.app" });
      });

    return true; // async
  }

  // ── Google Search Grader (CSP bypass) ────────────────────────────────────────
  // google_grader.js can't fetch directly due to Google's CSP.
  // This handler proxies the request through the background service worker.
  if (type === 'GRADE_SEARCH_RESULT') {
    const { title = '', url = '', snippet = '' } = message.payload || {};
    const fullUrl = `${API_BASE}/api/grade`;
    console.log(`[REAVES] Fetching: ${fullUrl}`);
    fetch(fullUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url, snippet }),
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => {
        console.error('[REAVES background] GRADE_SEARCH_RESULT error:', err);
        sendResponse({ ok: false, grade: 'C', score: 50, reason: "REAVES Cloud Syncing... Please verify your session at reaves-f-mol1.vercel.app" });
      });
    return true; // async
  }
});

// ─── Context menus ───────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'reaves-ask',
    title: 'Ask REAVES',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'reaves-search-page',
    title: 'Search page with REAVES',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'reaves-ask' && info.selectionText) {
    chrome.storage.session.set({ pendingSelection: info.selectionText });
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  }
  if (info.menuItemId === 'reaves-search-page') {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  }

});
