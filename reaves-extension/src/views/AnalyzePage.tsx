import { useState, useRef, useEffect, useCallback } from 'react';
import { callAPI } from '../api';

/* ─── Types ──────────────────────────────────────────────────────────────── */
type Mode = 'local' | 'global';
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode: Mode;
}

/* ─── Lakers Palette ─────────────────────────────────────────────────────── */
const GOLD   = '#FDB927';
const PURPLE = '#a855f7';

const themeFor = (mode: Mode) => mode === 'local'
  ? { accent: GOLD,   glow: 'rgba(253,185,39,0.35)',  dimGlow: 'rgba(253,185,39,0.15)',  border: `rgba(253,185,39,0.3)` }
  : { accent: PURPLE, glow: 'rgba(168,85,247,0.35)',   dimGlow: 'rgba(168,85,247,0.15)',  border: `rgba(168,85,247,0.3)` };

/* ─── System Prompts (extension-side, baked into question field) ─────────── */
const LOCAL_SYSTEM = `You are a 'Document Auditor'. Your knowledge is strictly limited to the text of the provided page. If a user asks something not in the text, say you can't find it in this specific document. Ground ALL answers strictly in the provided page text.`;

const GLOBAL_SYSTEM = `You are a 'Senior Research Consultant'. DO NOT restrict yourself to the current page. Use your full internal knowledge base to answer. You can reference broader trends, history, and external academic concepts. Even if the current page doesn't mention it, YOU SHOULD answer based on your general training.`;

/* ─── Icons ───────────────────────────────────────────────────────────────── */
const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/>
  </svg>
);
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>
  </svg>
);

/* ─── Page Text Extractor ─────────────────────────────────────────────────── */
async function extractPageText(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return reject('No active tab');
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            const sel = ['article', 'main', '[role="main"]', '.content', '.article-body', '#content', 'body'];
            for (const s of sel) {
              const el = document.querySelector(s);
              if (el) {
                const text = (el as HTMLElement).innerText;
                if (text.length > 200) return text.slice(0, 30000);
              }
            }
            return document.body.innerText.slice(0, 30000);
          },
        },
        (results) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
          resolve(results?.[0]?.result as string ?? '');
        }
      );
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function AnalyzePage() {
  const [mode, setMode] = useState<Mode>('local');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const theme = themeFor(mode);
  const isGlobalMode = mode === 'global';

  // Auto-scroll to newest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const uid = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: uid(), role: 'user', text, mode };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      let pageContext = '';

      // Always try to extract page text (used as strict source in local, optional ref in global)
      try {
        pageContext = await extractPageText();
      } catch {
        // In local mode, page extraction failure is fatal
        if (!isGlobalMode) {
          const errMsg: Message = {
            id: uid(), role: 'assistant', text: 'Failed to read the current page. Make sure you are on a standard web page.', mode,
          };
          setMessages((prev) => [...prev, errMsg]);
          setLoading(false);
          return;
        }
        // In global mode, just proceed without context — that's fine
        pageContext = '';
      }

      // In local mode, require sufficient page content
      if (!isGlobalMode && (!pageContext || pageContext.length < 100)) {
        const errMsg: Message = {
          id: uid(), role: 'assistant', text: 'Could not extract readable text from this page. Try navigating to a page with article content.', mode,
        };
        setMessages((prev) => [...prev, errMsg]);
        setLoading(false);
        return;
      }

      // Build the question payload with the system prompt baked in
      const systemPrompt = isGlobalMode ? GLOBAL_SYSTEM : LOCAL_SYSTEM;

      // Context injection: label differently based on mode
      const contextBlock = isGlobalMode
        ? (pageContext ? `\n\nOPTIONAL_REFERENCE_CONTEXT (you may ignore this if irrelevant):\n${pageContext}` : '')
        : `\n\nPAGE_CONTENT (THE ONLY SOURCE OF TRUTH):\n${pageContext}`;

      const question = `${systemPrompt}\n\nUSER_QUESTION: ${text}${contextBlock}`;

      const res = await callAPI<{ answer: string; evidence_snippet: string | null; confidence_score: number; status: string }>(
        '/api/page-search',
        {
          question,
          context: isGlobalMode ? (pageContext || text) : pageContext,
          mode,  // <— Signal the server which prompt to use
        },
      );

      const answer = res.ok && res.data?.answer
        ? res.data.answer
        : 'Connecting to REAVES Cloud... Please check your internet connection.';

      const aiMsg: Message = { id: uid(), role: 'assistant', text: answer, mode };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: uid(), role: 'assistant', text: `Error: ${String(err)}`, mode,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, mode, loading]);

  /* ─── Render ────────────────────────────────────────────────────────────── */
  return (
    <div
      className="analyze-container fade-up"
      style={{
        border: `1px solid ${theme.border}`,
        boxShadow: `0 0 20px ${theme.glow}, inset 0 0 30px ${theme.dimGlow}`,
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
      }}
    >
      {/* ── Scope Toggle ─────────────────────────────────────────────────── */}
      <div className="scope-toggle">
        <button
          className={`scope-btn ${mode === 'local' ? 'active' : ''}`}
          style={{
            ...(mode === 'local'
              ? { background: `rgba(253,185,39,0.15)`, color: GOLD, borderColor: `rgba(253,185,39,0.4)` }
              : {}),
            transition: 'all 0.3s ease',
          }}
          onClick={() => setMode('local')}
        >
          <ShieldIcon /> Local Page
        </button>
        <button
          className={`scope-btn ${mode === 'global' ? 'active' : ''}`}
          style={{
            ...(mode === 'global'
              ? { background: `rgba(168,85,247,0.15)`, color: PURPLE, borderColor: `rgba(168,85,247,0.4)` }
              : {}),
            transition: 'all 0.3s ease',
          }}
          onClick={() => setMode('global')}
        >
          <GlobeIcon /> Global Web
        </button>
      </div>

      {/* ── Chat Messages ────────────────────────────────────────────────── */}
      <div className="chat-scroller" ref={scrollRef}>
        {messages.length === 0 && !loading && (
          <div className="empty-state" style={{ paddingTop: 24 }}>
            <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.3 }}>
              {mode === 'local' ? '🛡' : '🌐'}
            </div>
            <p style={{ fontSize: 10, lineHeight: 1.6 }}>
              {mode === 'local'
                ? 'Ask anything about the current page.\nAnswers are grounded in the document text.'
                : 'Ask anything — answers draw from\nbroad academic knowledge.'}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const msgTheme = themeFor(msg.mode);

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="msg-bubble msg-user">
                {msg.text}
              </div>
            );
          }

          // Assistant bubble — mode-aware styling
          return (
            <div
              key={msg.id}
              className="msg-bubble msg-ai"
              style={{
                borderLeft: `2px solid ${msgTheme.accent}`,
                boxShadow: `0 0 12px ${msgTheme.dimGlow}, inset 0 0 20px rgba(255,255,255,0.02)`,
              }}
            >
              <span className="msg-mode-tag" style={{ color: msgTheme.accent }}>
                {msg.mode === 'local' ? '🛡 DOCUMENT-LOCKED' : '🌐 GLOBAL SYNTHESIS'}
              </span>
              {msg.text}
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading && (
          <div className="msg-bubble msg-ai" style={{
            borderLeft: `2px solid ${theme.accent}`,
            boxShadow: `0 0 12px ${theme.dimGlow}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderTopColor: theme.accent }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {mode === 'local' ? 'Auditing document…' : 'Consulting knowledge base…'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend (compact, single line above input) ───────────────────── */}
      <div className="legend-row">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: GOLD }} />
          <span>DOCUMENT-LOCKED</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: PURPLE }} />
          <span>GLOBAL SYNTHESIS</span>
        </div>
      </div>

      {/* ── Input Bar ────────────────────────────────────────────────────── */}
      <div
        className="analyze-input-wrap"
        style={{
          borderColor: theme.border,
          boxShadow: `0 0 12px ${theme.dimGlow}`,
          transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
        }}
      >
        <input
          className="analyze-input"
          type="text"
          placeholder={mode === 'local' ? 'Ask about this page…' : 'Ask anything…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={loading}
        />
        <button
          className="analyze-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          style={{ color: theme.accent, transition: 'color 0.3s ease' }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
