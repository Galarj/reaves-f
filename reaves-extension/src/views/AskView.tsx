import { useState, useEffect, useCallback } from 'react';
import { callAPI } from '../api';
import { readNotebooks, writeNotebooks } from '../notebook-bridge';
import { saveToNotebook as syncToCloud } from '../lib/supabase-actions';
import type { ClarifierResponse, SearchResult, Source, Notebook } from '../types';

interface Props {
  initialText: string | null;
  onTextConsumed: () => void;
}

type Step = 'input' | 'clarifying' | 'clarified' | 'searching' | 'results';

export default function AskView({ initialText, onTextConsumed }: Props) {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [clarifier, setClarifier] = useState<ClarifierResponse | null>(null);
  const [refinedQuery, setRefinedQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null); // source.id currently syncing

  // Notebook picker state
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null); // source.id being saved
  const [newNotebookName, setNewNotebookName] = useState('');

  // Load notebooks on mount (from web app's localStorage via bridge)
  useEffect(() => {
    readNotebooks().then(({ notebooks: nbs, activeId: id }) => {
      setNotebooks(nbs);
      setActiveId(id);
      const ids = new Set<string>();
      for (const nb of nbs) {
        for (const e of nb.entries) {
          ids.add(e.source.id);
        }
      }
      setSavedIds(ids);
    });
  }, []);

  // Pre-fill with selected text
  useEffect(() => {
    if (initialText) {
      setQuery(initialText);
      setStep('input');
      onTextConsumed();
    }
  }, [initialText, onTextConsumed]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  async function handleClarify() {
    if (!query.trim()) return;
    setStep('clarifying');
    setError(null);
    const res = await callAPI<ClarifierResponse>('/api/clarify', { raw_query: query.trim() });
    if (!res.ok || !res.data) {
      setError('Connecting to REAVES Cloud... Please check your internet connection.');
      setStep('input');
      return;
    }
    // If not ambiguous or no options, skip clarification and go straight to search
    if (!res.data.ambiguous || !res.data.options?.length || !res.data.clarifier_question) {
      const q = res.data.refined_queries?.[0] || query.trim();
      setRefinedQuery(q);
      handleSearch(q);
      return;
    }
    setClarifier(res.data);
    setRefinedQuery(res.data.refined_queries?.[0] || query);
    setStep('clarified');
  }

  function skipClarify() {
    setRefinedQuery(query.trim());
    handleSearch(query.trim());
  }

  async function handleSearch(q: string) {
    setStep('searching');
    setError(null);
    const res = await callAPI<SearchResult>('/api/search', { refined_query: q });
    if (!res.ok || !res.data) {
      setError('Search failed. Please try again.');
      setStep('input');
      return;
    }
    setResults(res.data);
    setStep('results');
  }

  // ─── Notebook picker: save source to a notebook ─────────────────────────
  function togglePicker(sourceId: string) {
    setPickerOpenFor(pickerOpenFor === sourceId ? null : sourceId);
    setNewNotebookName('');
  }

  async function saveToNotebook(source: Source, notebookId: string) {
    const { notebooks: nbs, activeId: aId } = await readNotebooks(); // fresh read from web app
    const idx = nbs.findIndex((n) => n.id === notebookId);
    if (idx === -1) return;

    const alreadySaved = (nbs[idx].entries as Array<{ source: { id: string } }>).some(
      (e) => e.source.id === source.id
    );
    if (alreadySaved) {
      nbs[idx].entries = nbs[idx].entries.filter((e) => e.source.id !== source.id);
      setSavedIds((prev) => { const s = new Set(prev); s.delete(source.id); return s; });
      showToast(`Removed from "${nbs[idx].name}"`);
    } else {
      const entry = {
        id: `e-${source.id}-${Date.now()}`,
        source,
        tag: 'Untagged',
        user_note: '',
        saved_at: new Date().toISOString(),
        citation_format: 'APA' as const,
      };
      nbs[idx].entries = [...nbs[idx].entries, entry];
      nbs[idx].updated_at = new Date().toISOString();
      setSavedIds((prev) => new Set(prev).add(source.id));
      showToast(`Saved to "${nbs[idx].name}"`);

      // ─── Cloud sync ───────────────────────────────────
      setSyncingId(source.id);
      const result = await syncToCloud(source);
      setSyncingId(null);
      if (result.ok) {
        showToast('☁️ Synced to Cloud');
      } else {
        showToast(`⚠ Cloud sync failed: ${result.error}`);
      }
    }

    await writeNotebooks({ notebooks: nbs, activeId: aId });
    setNotebooks(nbs);
    setActiveId(aId);
    setPickerOpenFor(null);
  }

  async function createNotebookAndSave(source: Source) {
    const name = newNotebookName.trim();
    if (!name) return;
    const { notebooks: nbs, activeId: aId } = await readNotebooks();
    const nb: Notebook = {
      id: `nb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      description: '',
      entries: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    nbs.push(nb);
    const newActiveId = aId || nb.id; // set active if none
    await writeNotebooks({ notebooks: nbs, activeId: newActiveId });
    setNotebooks(nbs);
    setActiveId(newActiveId);
    setNewNotebookName('');
    // Now save the source into the new notebook
    saveToNotebook(source, nb.id);
  }

  function reset() {
    setStep('input');
    setQuery('');
    setClarifier(null);
    setResults(null);
    setError(null);
    setPickerOpenFor(null);
  }



  function scoreClass(score: number) {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-medium';
    return 'score-low';
  }

  return (
    <div className="fade-up">
      {/* Input Step */}
      {(step === 'input' || step === 'clarifying') && (
        <>
          <p className="section-label">Highlight or type a query</p>
          <textarea
            className="input"
            rows={5}
            placeholder="Paste highlighted text or type a research question…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleClarify();
            }}
          />
          {error && <p style={{ color: 'var(--rose)', fontSize: 11, marginTop: 6 }}>{error}</p>}

          {/* Row 1: Global search buttons */}
          <div className="flex-between gap-2 mt-2">
            <button className="btn btn-ghost btn-sm" onClick={skipClarify} disabled={!query.trim() || step === 'clarifying'}>
              Search Global
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleClarify}
              disabled={!query.trim() || step === 'clarifying'}
            >
              {step === 'clarifying' ? <><div className="spinner" />Clarifying…</> : '✦ Clarify & Search'}
            </button>
          </div>

        </>
      )}

      {/* Clarified Step */}
      {step === 'clarified' && clarifier && (
        <>
          <div className="card">
            <p className="section-label" style={{ marginBottom: 6 }}>AI Clarification</p>
            <p style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10, lineHeight: 1.6 }}>
              {clarifier.clarifier_question}
            </p>
            {clarifier.options.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {clarifier.options.map((opt, i) => (
                  <button
                    key={i}
                    className="btn btn-ghost"
                    style={{
                      justifyContent: 'flex-start', fontSize: 11, textAlign: 'left',
                      borderColor: refinedQuery === (clarifier.refined_queries?.[i] || opt) ? 'var(--violet)' : undefined,
                      background: refinedQuery === (clarifier.refined_queries?.[i] || opt) ? 'var(--violet-dim)' : undefined,
                    }}
                    onClick={() => setRefinedQuery(clarifier.refined_queries?.[i] || opt)}
                  >
                    {refinedQuery === (clarifier.refined_queries?.[i] || opt)
                      ? '● ' : '○ '}{opt}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-between gap-2 mt-3">
              <button className="btn btn-ghost btn-sm" onClick={reset}>Back</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSearch(refinedQuery)}
              >
                Search →
              </button>
            </div>
          </div>
        </>
      )}

      {/* Searching */}
      {step === 'searching' && (
        <div className="flex-center" style={{ flexDirection: 'column', gap: 10, paddingTop: 40 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Searching academic sources…</p>
        </div>
      )}

      {/* Results */}
      {step === 'results' && results && (
        <>
          <div className="flex-between mb-2">
            <p className="section-label">{results.sources.length} sources found</p>
            <button className="btn btn-ghost btn-sm" onClick={reset} style={{ padding: '3px 8px' }}>New search</button>
          </div>

          {results.sources.map((source) => {
            const saved = savedIds.has(source.id);
            const pickerOpen = pickerOpenFor === source.id;
            return (
              <div key={source.id} className="card fade-up">
                <div className="flex-between gap-2" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.4, color: 'var(--text)', marginBottom: 2 }}>
                      {source.title}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {source.authors} · {source.year} · {source.journal}
                    </p>
                  </div>
                  <span className={`score-badge ${scoreClass(source.trust_score)}`}>
                    {source.trust_score}
                  </span>
                </div>

                {/* Trust bar */}
                <div className="trust-bar-wrap">
                  <div className="trust-bar-track">
                    <div className="trust-bar-fill" style={{ width: `${source.trust_score}%` }} />
                  </div>
                </div>

                {/* Abstract */}
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                  {source.abstract?.slice(0, 160)}{(source.abstract?.length ?? 0) > 160 ? '…' : ''}
                </p>

                <div className="flex-between gap-2 mt-2">
                  {source.doi && (
                    <a
                      href={`https://doi.org/${source.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      Open ↗
                    </a>
                  )}
                  <button
                    className={`btn btn-sm ${saved ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => togglePicker(source.id)}
                    style={{ marginLeft: 'auto' }}
                    disabled={syncingId === source.id}
                  >
                    {syncingId === source.id ? (
                      <><div className="spinner spinner-gold" />Syncing to Cloud…</>
                    ) : saved ? '✓ Saved' : '＋ Save'}
                  </button>
                </div>

                {/* ─── Notebook Picker Dropdown ─── */}
                {pickerOpen && (
                  <div style={{
                    marginTop: 8,
                    padding: 10,
                    background: 'var(--surface2)',
                    borderRadius: 8,
                    border: '1px solid var(--border2)',
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Save to notebook
                    </p>
                    {notebooks.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                        {notebooks.map((nb) => {
                          const inThisNb = nb.entries.some((e) => e.source.id === source.id);
                          return (
                            <button
                              key={nb.id}
                              className="btn btn-ghost btn-sm"
                              style={{
                                justifyContent: 'space-between',
                                fontSize: 11,
                                textAlign: 'left',
                                borderColor: nb.id === activeId ? 'rgba(124,58,237,0.3)' : undefined,
                              }}
                              onClick={() => saveToNotebook(source, nb.id)}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                {nb.name}
                                {nb.id === activeId && <span className="tag tag-violet" style={{ fontSize: 8, padding: '0 4px' }}>active</span>}
                              </span>
                              <span style={{ opacity: 0.5, fontSize: 10 }}>
                                {inThisNb ? '✓ saved' : `${nb.entries.length} sources`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                        No notebooks yet. Create one below.
                      </p>
                    )}

                    {/* Create new notebook inline */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input"
                        style={{ padding: '5px 8px', fontSize: 11, flex: 1 }}
                        placeholder="New notebook name…"
                        value={newNotebookName}
                        onChange={(e) => setNewNotebookName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') createNotebookAndSave(source);
                        }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: 10, whiteSpace: 'nowrap' }}
                        onClick={() => createNotebookAndSave(source)}
                        disabled={!newNotebookName.trim()}
                      >
                        + Create & Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Synthesis */}
          {results.synthesis && (
            <>
              <div className="divider" />
              <p className="section-label">Synthesis</p>
              <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>{results.synthesis}</p>
              </div>
            </>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>

  );


}
