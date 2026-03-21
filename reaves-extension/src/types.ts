// Shared type definitions mirroring the REAVES web app types
// Kept lean — only what the extension sidebar needs

export interface Source {
  id: string;
  title: string;
  authors: string;
  year: number;
  journal: string;
  trust_score: number;
  trust_factors: {
    peer_reviewed: boolean;
    citation_count: number;
    author_hindex: number;
    recency_years: number;
    open_access: boolean;
  };
  trust_reason: string;
  abstract: string;
  doi: string;
  bias?: {
    bias_detected: boolean;
    bias_type: string;
    bias_note: string | null;
    severity: 'low' | 'medium' | 'high' | 'none';
  };
}

export interface ClarifierResponse {
  ambiguous: boolean;
  clarifier_question: string;
  options: string[];
  refined_queries: string[];
}

export interface SearchResult {
  sources: Source[];
  synthesis: string;
  agreements: string[];
  conflicts: string[];
  research_gaps: Array<{ gap: string; angle: string }>;
}

export interface PageExcerpt {
  text: string;
  score: number;
  chunkIndex: number;
}

export interface NotebookEntry {
  id: string;
  source: Source;
  tag: string;
  user_note: string;
  saved_at: string;
  citation_format: 'APA' | 'MLA' | 'Chicago';
}

export interface Notebook {
  id: string;
  name: string;
  description: string;
  entries: NotebookEntry[];
  created_at: string;
  updated_at: string;
}

export interface EvidenceResponse {
  answer: string;
  evidence_snippet: string | null;
  confidence_score: number;
  location_context: string;
  status: 'success' | 'no_evidence_found';
}

export type View = 'ask' | 'pagesearch' | 'notebook' | 'analyze';
