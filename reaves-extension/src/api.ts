// Chrome API proxy helpers — called from sidebar context
// All API calls are routed through the background service worker

export function callAPI<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CALL_API', endpoint, method: 'POST', body },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      }
    );
  });
}

export function getPendingSelection(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_PENDING_SELECTION' }, (res) => {
      resolve(res?.text ?? null);
    });
  });
}

export function getSession(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (res) => {
      resolve(res?.token ?? null);
    });
  });
}

export function sendHighlights(excerpts: Array<{ text: string }>, tabId?: number) {
  chrome.runtime.sendMessage({ type: 'INJECT_HIGHLIGHTS', excerpts, tabId });
}

export function clearHighlights(tabId?: number) {
  chrome.runtime.sendMessage({ type: 'CLEAR_HIGHLIGHTS', tabId });
}

/** localStorage-based notebook helpers (mirrors notebook-context.tsx) */
const STORAGE_KEY = 'reaves-notebooks';

export function loadNotebooks(): { notebooks: Notebook[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return { notebooks: [], activeId: null };
}

export function saveNotebooks(notebooks: Notebook[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notebooks, activeId }));
  } catch { /* empty */ }
}

// Re-export Notebook for convenience
import type { Notebook } from './types';
export type { Notebook };
