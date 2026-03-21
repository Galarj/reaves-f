import { useState, useEffect, type JSX } from 'react';
import { getPendingSelection } from './api';
import AskView from './views/AskView';
import NotebookView from './views/NotebookView';
import AnalyzePage from './views/AnalyzePage';
import { GlossaryCard, useGlossaryToggle } from './views/GlossaryCard';
import type { View } from './types';

// Icons (inline SVG to keep bundle size tiny)
const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.4L22 12l-7.6 2.6L12 22l-2.4-7.4L2 12l7.6-2.6z"/>
  </svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);
const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);
const ScanIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>
  </svg>
);

export default function App() {
  const [view, setView] = useState<View>('ask');
  const [pendingText, setPendingText] = useState<string | null>(null);

  // Smart Glossary toggle (persisted in chrome.storage.local)
  const { enabled: glossaryEnabled, toggle: setGlossaryEnabled, init: initGlossary } = useGlossaryToggle();

  // Google Search Grader toggle
  const [graderEnabled, setGraderEnabled] = useState<boolean>(true);

  // Detailed definition pushed from the content script
  const [glossaryPayload, setGlossaryPayload] = useState<{
    word: string;
    detailed_explanation: string;
  } | null>(null);

  // On mount, check if content script sent a selected text
  useEffect(() => {
    // Hydrate both toggles from storage
    initGlossary();
    chrome.storage.local.get(['searchGraderEnabled'], (result) => {
      setGraderEnabled(result.searchGraderEnabled !== false);
    });

    // Pending selection (from context-menu or bubble click)
    getPendingSelection().then((text) => {
      if (text) {
        setPendingText(text);
        setView('ask');
      }
    });

    // Listen for messages from the content script
    const handler = (message: { type: string; text?: string; payload?: { word: string; short_definition: string; detailed_explanation: string } }) => {
      if (message.type === 'OPEN_SIDEBAR' && message.text) {
        setPendingText(message.text);
        setView('ask');
      }
      // Glossary hover fired → show the detailed explanation in the sidebar
      if (message.type === 'SHOW_DETAILED_DEF' && message.payload?.detailed_explanation) {
        setGlossaryPayload({
          word: message.payload.word,
          detailed_explanation: message.payload.detailed_explanation,
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const navItems: Array<{ id: View; label: string; Icon: () => JSX.Element }> = [
    { id: 'ask',      label: 'Ask',      Icon: SparkleIcon },
    { id: 'analyze',  label: 'Analyze',  Icon: ScanIcon   },
    { id: 'notebook', label: 'Notebook', Icon: BookIcon   },
  ];

  return (
    <div className="sidebar">
      {/* Header */}
      <header className="sidebar-header">
        <span className="sidebar-logo">✦ REAVES</span>
        {/* Toggles row */}
        <div className="header-toggles">
          {/* Smart Glossary Toggle */}
          <label className="glossary-toggle" title="Smart Glossary Hover">
            <span className="glossary-toggle-label">Glossary</span>
            <button
              className={`toggle-switch ${glossaryEnabled ? 'on' : 'off'}`}
              role="switch"
              aria-checked={glossaryEnabled}
              onClick={() => setGlossaryEnabled(!glossaryEnabled)}
            >
              <span className="toggle-thumb" />
            </button>
          </label>

          {/* Google Search Grader Toggle */}
          <label className="glossary-toggle" title="Google Search Grader">
            <span className="glossary-toggle-label">Grader</span>
            <button
              className={`toggle-switch ${graderEnabled ? 'on' : 'off'}`}
              role="switch"
              aria-checked={graderEnabled}
              onClick={() => {
                const next = !graderEnabled;
                setGraderEnabled(next);
                chrome.storage.local.set({ searchGraderEnabled: next });
              }}
            >
              <span className="toggle-thumb" />
            </button>
          </label>
        </div>
      </header>

      {/* View Content */}
      <main className="sidebar-body">
        {/* Glossary Card — slides in when the hover fires */}
        {glossaryPayload && (
          <GlossaryCard
            word={glossaryPayload.word}
            detailed_explanation={glossaryPayload.detailed_explanation}
            onDismiss={() => setGlossaryPayload(null)}
          />
        )}

        {view === 'ask' && (
          <AskView
            initialText={pendingText}
            onTextConsumed={() => setPendingText(null)}
          />
        )}
        {view === 'analyze' && <AnalyzePage />}
        {view === 'notebook' && <NotebookView />}
      </main>

      {/* Bottom Nav */}
      <nav className="sidebar-nav">
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-btn ${view === id ? 'active' : ''}`}
            onClick={() => setView(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
