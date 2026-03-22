import { useState, useEffect } from 'react';
import { readNotebooks, writeNotebooks } from '../notebook-bridge';
import type { Notebook, NotebookEntry } from '../types';

export default function NotebookView() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    readNotebooks().then(({ notebooks: nbs, activeId: id }) => {
      setNotebooks(nbs);
      setActiveId(id);
      setExpandedId(id);
    });
  }, []);

  async function persist(nbs: Notebook[], id: string | null) {
    setNotebooks(nbs);
    setActiveId(id);
    await writeNotebooks({ notebooks: nbs, activeId: id });
  }

  function activateNotebook(id: string) {
    persist(notebooks, id);
    setExpandedId(id);
  }

  function removeEntry(nbId: string, entryId: string) {
    const updated = notebooks.map((n) =>
      n.id === nbId
        ? { ...n, entries: n.entries.filter((e) => e.id !== entryId), updated_at: new Date().toISOString() }
        : n
    );
    persist(updated, activeId);
  }

  function formatCitation(entry: NotebookEntry): string {
    const { source: s, citation_format: fmt } = entry;
    const authorsShort = s.authors.split(',')[0]?.trim() ?? 'Unknown';
    const doi = s.doi ? `https://doi.org/${s.doi}` : '';
    if (fmt === 'APA') {
      return `${s.authors} (${s.year}). ${s.title}. ${s.journal}.${doi ? ` ${doi}` : ''}`;
    }
    if (fmt === 'MLA') {
      return `${authorsShort}. "${s.title}." ${s.journal} (${s.year}).${doi ? ` ${doi}` : ''}`;
    }
    // Chicago
    return `${s.authors}. "${s.title}." ${s.journal} (${s.year}).${doi ? ` ${doi}` : ''}`;
  }

  function copyCitation(entry: NotebookEntry) {
    navigator.clipboard.writeText(formatCitation(entry)).then(() => {
      setToast('Citation copied!');
      setTimeout(() => setToast(null), 1800);
    });
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  if (notebooks.length === 0) {
    return (
      <div className="empty-state fade-up">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <p>No notebooks yet.<br />Open the REAVES web app to create your first notebook, then save sources here.</p>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <p className="section-label">{notebooks.length} notebook{notebooks.length !== 1 ? 's' : ''}</p>

      {notebooks.map((nb) => {
        const isActive = nb.id === activeId;
        const isExpanded = expandedId === nb.id;
        return (
          <div
            key={nb.id}
            className="card"
            style={{ borderColor: isActive ? 'rgba(124,58,237,0.4)' : undefined }}
          >
            {/* Notebook header */}
            <div className="flex-between gap-2">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <p style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nb.name}
                  </p>
                  {isActive && <span className="tag tag-violet" style={{ fontSize: 9, padding: '1px 6px' }}>Active</span>}
                </div>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {nb.entries.length} source{nb.entries.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {!isActive && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { activateNotebook(nb.id); showToast(`"${nb.name}" is now active`); }}
                    style={{ fontSize: 10 }}
                  >
                    Set Active
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpandedId(isExpanded ? null : nb.id)}
                  style={{ fontSize: 10, minWidth: 32 }}
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>
            </div>

            {/* Entries */}
            {isExpanded && nb.entries.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 1, background: 'var(--border)' }} />
                {nb.entries.map((entry) => (
                  <div key={entry.id} style={{ padding: '8px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div className="flex-between gap-2" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                          {entry.source.title}
                        </p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {entry.source.authors} · {entry.source.year}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeEntry(nb.id, entry.id)}
                        style={{ fontSize: 10, color: 'var(--rose)', flexShrink: 0 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="copy-actions" style={{ marginTop: 6 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => copyCitation(entry)}
                        style={{ flex: 1, fontSize: 10 }}
                      >
                        Copy {entry.citation_format}
                      </button>
                      {entry.source.doi && (
                        <a
                          href={`https://doi.org/${entry.source.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                          style={{ textDecoration: 'none', fontSize: 10 }}
                        >
                          Open ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isExpanded && nb.entries.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
                No sources yet. Search and save from the Ask tab.
              </p>
            )}
          </div>
        );
      })}

      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
        Manage notebooks in the <a href="https://reaves-f-mol1-3isvuqyw6-galarjs-projects.vercel.app/notebook" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>REAVES Cloud ↗</a>
      </p>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
