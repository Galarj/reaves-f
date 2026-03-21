import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/anthropic';
import { RAG_SYSTEM_PROMPT, GLOBAL_SYSTEM_PROMPT } from '@/prompts/rag';
import { EvidenceResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Accept both the spec shape { question, context }
    // and the legacy extension shape { query, chunks }
    const question: string = body.question ?? body.query ?? '';
    const mode: string = body.mode ?? 'local';
    const isGlobal = mode === 'global';
    const rawContext: string =
      body.context ??
      (Array.isArray(body.chunks) ? (body.chunks as string[]).join(' ') : '');

    if (!question || (!isGlobal && !rawContext)) {
      return NextResponse.json(
        { error: 'Missing question/query or context/chunks' },
        { status: 400 },
      );
    }

    // Normalize whitespace and enforce 30k char limit (Claude/Gemini hates massive whitespace chunks)
    const cleanContext = rawContext.replace(/\s+/g, ' ').trim().slice(0, 50000);

    if (process.env.USE_MOCK === 'true') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({
        answer:
          'Based on the mock page content, researchers found a significant correlation between social media use and youth mental health decline across several longitudinal studies.',
        evidence_snippet:
          'correlation between social media use and youth mental health decline',
        confidence_score: 0.95,
        location_context: 'In the methodology section',
        status: 'success',
      } as EvidenceResponse);
    }

    // Branch prompt and message based on mode
    let systemPrompt: string;
    let userMessage: string;

    if (isGlobal) {
      systemPrompt = GLOBAL_SYSTEM_PROMPT;
      const refBlock = cleanContext
        ? `\n\nOPTIONAL_REFERENCE_CONTEXT (use ONLY if relevant, otherwise ignore):\n${cleanContext}`
        : '';
      userMessage = `USER_QUESTION: ${question}${refBlock}`;
    } else {
      systemPrompt = RAG_SYSTEM_PROMPT;
      userMessage = `USER_QUESTION: ${question}\n\nPAGE_CONTENT:\n${cleanContext}\nAnalyze the page content... \nSTRICT RULE: Your evidence_snippet MUST be a direct "Copy-Paste" from the PAGE_CONTENT. \nIf you change a single comma, the user will not see the highlight. \nDO NOT REPHRASE THE SNIPPET\nAnalyze the page content and answer the question, ensuring you extract an exact character-for-character excerpt as the evidence_snippet.`;
    }

    const rawResult = (await callClaude(systemPrompt, userMessage)) as Record<
      string,
      unknown
    >;

    const result: EvidenceResponse = {
      answer:
        typeof rawResult.answer === 'string'
          ? rawResult.answer
          : 'I could not generate an answer.',
      evidence_snippet:
        typeof rawResult.evidence_snippet === 'string'
          ? rawResult.evidence_snippet
          : null,
      confidence_score:
        typeof rawResult.confidence_score === 'number' ? rawResult.confidence_score : 0,
      location_context:
        typeof rawResult.location_context === 'string'
          ? rawResult.location_context
          : 'Unknown location',
      status:
        rawResult.status === 'no_evidence_found' ? 'no_evidence_found' : 'success',
    };

    // Server-side Literal-Match guard: nullify any hallucinated snippet so the
    // frontend highlighter never crashes on a non-existent substring.
    // Skip this guard in global mode — there is no document to highlight.
    if (!isGlobal && result.evidence_snippet && !cleanContext.includes(result.evidence_snippet)) {
      console.warn(
        '[/api/page-search] AI returned a snippet that is not a literal match — nullifying to protect the frontend highlighter.',
      );
      result.evidence_snippet = null;
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/page-search]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
