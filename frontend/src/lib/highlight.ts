// Syntax colours for diffs, from Shiki with VS Code's Dark+ theme. Grammars
// load on first use, so only the languages you open are fetched.
import { useEffect, useState } from "react";
import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

export type Token = { content: string; color?: string };

const THEME = "dark-plus";
// Past this many lines a diff is shown without colours to stay fast.
const MAX_LINES = 8000;

let highlighter: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighter;
}

async function tokenize(lines: string[], lang: string): Promise<Token[][]> {
  const hl = await getHighlighter();
  if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(lang as BundledLanguage);
  const out = hl.codeToTokensBase(lines.join("\n"), { lang: lang as BundledLanguage, theme: THEME });
  return out.map((line) => line.map((t) => ({ content: t.content, color: t.color })));
}

/**
 * Highlights both sides of a diff. Returns null until ready, or when the
 * language is unknown; the view shows plain text meanwhile.
 */
export function useHighlight(oldLines: string[], newLines: string[], lang: string | undefined) {
  const [result, setResult] = useState<{ key: object; old: Token[][]; new: Token[][] } | null>(null);
  useEffect(() => {
    if (!lang || oldLines.length + newLines.length > MAX_LINES) return;
    let live = true;
    const key = oldLines;
    Promise.all([tokenize(oldLines, lang), tokenize(newLines, lang)])
      .then(([o, n]) => live && setResult({ key, old: o, new: n }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [oldLines, newLines, lang]);
  // Tokens of a previous file never show on this one.
  return result && result.key === oldLines ? result : null;
}
