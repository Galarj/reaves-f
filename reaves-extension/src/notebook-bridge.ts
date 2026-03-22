/**
 * Notebook bridge — reads/writes the REAVES web app's localStorage
 * via chrome.scripting.executeScript into an open localhost:3000 tab.
 *
 * This keeps the extension and web app notebooks perfectly in sync
 * without needing any API endpoint or Supabase.
 */

import type { Notebook } from './types';

const STORAGE_KEY = 'reaves-notebooks';
const REAVES_ORIGINS = ['http://localhost:3000', 'https://localhost:3000', 'https://reaves-f-mol1-3isvuqyw6-galarjs-projects.vercel.app'];

interface NotebookState {
  notebooks: Notebook[];
  activeId: string | null;
}

/** Find an open REAVES web app tab */
async function findReavesTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && REAVES_ORIGINS.some((o) => tab.url!.startsWith(o))) {
      return tab.id;
    }
  }
  return null;
}

/** Read notebooks from the web app's localStorage */
export async function readNotebooks(): Promise<NotebookState> {
  const tabId = await findReavesTab();
  if (!tabId) {
    // Fallback: read from extension's own localStorage
    return readLocal();
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (key: string) => localStorage.getItem(key),
      args: [STORAGE_KEY],
    });

    const raw = results?.[0]?.result;
    if (raw) {
      const parsed = JSON.parse(raw) as NotebookState;
      // Also cache locally so it works if REAVES tab is closed later
      try { localStorage.setItem(STORAGE_KEY, raw); } catch { /* ok */ }
      return parsed;
    }
  } catch (err) {
    console.warn('[notebook-bridge] Could not read from REAVES tab:', err);
  }

  return readLocal();
}

/** Write notebooks to BOTH the web app's localStorage and the extension's */
export async function writeNotebooks(state: NotebookState): Promise<void> {
  const json = JSON.stringify(state);

  // Always write to extension localStorage as cache
  try { localStorage.setItem(STORAGE_KEY, json); } catch { /* ok */ }

  // Also write to the web app tab if open
  const tabId = await findReavesTab();
  if (tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (key: string, value: string) => {
          localStorage.setItem(key, value);
          // Dispatch storage event so React picks it up
          window.dispatchEvent(new Event('storage'));
        },
        args: [STORAGE_KEY, json],
      });
    } catch (err) {
      console.warn('[notebook-bridge] Could not write to REAVES tab:', err);
    }
  }
}

function readLocal(): NotebookState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return { notebooks: [], activeId: null };
}
