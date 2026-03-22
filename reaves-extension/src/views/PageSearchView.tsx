import { useState, useCallback } from 'react';
import { callAPI, sendHighlights, clearHighlights } from '../api';
import type { EvidenceResponse } from '../types';

type Step = 'idle' | 'extracting' | 'searching' | 'results';

function formatCitation(title: string, url: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `(${title}, ${url}, accessed ${date})`;
}

async function extractPageText(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return reject('No active tab');
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            // Extract readable text from the page
            const sel = [
              'article', 'main', '[role="main"]', '.content',
              '.article-body', '#content', 'body',
            ];
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

function chunkText(text: string, chunkSize = 800): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  return chunks.filter((c) => c.length > 80);
}

export default function PageSearchView() {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<EvidenceResponse | null>(null);
  const [highlightsOn, setHighlightsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [pageUrl, setPageUrl] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  async function handleSearch() {
    if (!query.trim()) return;
    setStep('extracting');
    setError(null);
    setResult(null);
    setHighlightsOn(false);
    clearHighlights();

    try {
      // Get page metadata
      const [tab] = await new Promise<chrome.tabs.Tab[]>((res) =>
        chrome.tabs.query({ active: true, currentWindow: true }, res)
      );
      setPageTitle(tab.title || '');
      setPageUrl(tab.url || '');

      const pageText = await extractPageText();
      if (!pageText || pageText.length < 100) {
        setError('Could not extract readable text from this page.');
        setStep('idle');
        return;
      }

      const chunks = chunkText(pageText);
      setStep('searching');

      const res = await callAPI<EvidenceResponse>('/api/page-search', {
        chunks,
        query: query.trim(),
      });

      if (!res.ok || !res.data) {
        setError('Connecting to REAVES Cloud... Please check your internet connection.');
        setStep('idle');
        return;
      }

      setResult(res.data);
      setStep('results');
    } catch (err) {
      setError(String(err));
      setStep('idle');
    }
  }

  function toggleHighlights() {
    if (highlightsOn) {
      clearHighlights();
      setHighlightsOn(false);
    } else if (result?.evidence_snippet) {
      sendHighlights([{ text: result.evidence_snippet }]);
      setHighlightsOn(true);
    }
  }

  function copyPlain(text: string) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
  }

  function copyWithCitation(text: string) {
    const citation = formatCitation(pageTitle || 'Unknown', pageUrl || window.location.href);
    navigator.clipboard.writeText(`"${text}" ${citation}`).then(() => showToast('Copied with citation!'));
  }

  function reset() {
    clearHighlights();
    setHighlightsOn(false);
    setResult(null);
    setStep('idle');
    setQuery('');
    setError(null);
  }

  const isLoading = step === 'extracting' || step === 'searching';

  return (
    <div className="fade-up">
      <p className="section-label">Evidence Engine</p>

      <div style={{ position: 'relative' }}>
        <textarea
          className="input"
          rows={2}
          placeholder="Ask a question about the current page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); }
          }}
        />
      </div>

      {error && <p style={{ color: 'var(--rose)', fontSize: 11, marginTop: 6 }}>{error}</p>}

      <div className="flex-between gap-2 mt-2">
        {step === 'results' && (
          <button className="btn btn-ghost btn-sm" onClick={reset}>Clear</button>
        )}
        <button
          className="btn btn-primary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={handleSearch}
          disabled={!query.trim() || isLoading}
        >
          {isLoading
            ? <><div className="spinner" />{step === 'extracting' ? 'Reading page…' : 'Synthesizing…'}</>
            : '⌕ Extract Answer'}
        </button>
      </div>

      {step === 'results' && result && (
        <>
          <div className="divider" />
          <div className="flex-between mb-2">
            <p className="section-label">AI Analysis</p>
            {result.evidence_snippet && result.status !== 'no_evidence_found' && (
              <button
                className={`btn btn-sm ${highlightsOn ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleHighlights}
                style={{ padding: '4px 10px', fontSize: 10 }}
              >
                {highlightsOn ? '● Source Highlighted' : '○ Highlight Source'}
              </button>
            )}
          </div>

          <div className="card fade-up">
            <div className="flex-between gap-2" style={{ marginBottom: 10 }}>
              {result.status === 'no_evidence_found' ? (
                <span className="tag" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                  ○ Not found on this page
                </span>
              ) : (
                <span className="tag tag-violet">
                  {result.location_context?.slice(0, 40) || 'Verified Match'}
                </span>
              )}
              <span
                className={`score-badge ${result.confidence_score >= 0.8 ? 'score-high' : result.confidence_score >= 0.5 ? 'score-medium' : 'score-low'}`}
              >
                {Math.round(result.confidence_score * 100)}% confidence
              </span>
            </div>
            
            <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, marginBottom: 12, fontWeight: 500 }}>
              {result.answer}
            </p>

            {result.evidence_snippet ? (
              <div style={{ 
                padding: '8px 10px', 
                backgroundColor: 'var(--surface2)', 
                borderLeft: '2px solid var(--violet)', 
                borderRadius: '4px', 
                fontSize: 11, 
                color: 'var(--text-muted)', 
                fontStyle: 'italic', 
                marginBottom: 12,
                lineHeight: 1.5
              }}>
                "{result.evidence_snippet}"
              </div>
            ) : (
              <p style={{ fontSize: 10, color: 'var(--rose)', marginBottom: 12, fontStyle: 'italic' }}>
                No exact snippet could be extracted.
              </p>
            )}

            <div className="copy-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => copyPlain(result.answer)}
              >
                Copy Answer
              </button>
              {result.evidence_snippet && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyWithCitation(result.evidence_snippet!)}
                  style={{ flex: 1 }}
                >
                  Copy Quote + Citation
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
