import type { PdfMaterialQuestion } from "@/lib/pdf-materials";

export function isExplicitTopicHeader(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  const topicRe = /^\s*(?:topic|টপিক|বিষয়|বিষয়|অধ্যায়|অধ্যায়|chapter|unit)\s*[:：\-–—]?\s*(.+?)\s*$/i;
  const m1 = t.match(topicRe);
  if (m1 && (m1[1] ?? "").trim()) return (m1[1] ?? "").trim().replace(/^[:：\-–—\s]+/, "").trim();

  const bracketRe = /^\s*\[\s*([^\]\n]{1,80})\s*\]\s*$/;
  const m2 = t.match(bracketRe);
  if (m2 && (m2[1] ?? "").trim()) return (m2[1] ?? "").trim();

  const borderRe = /^\s*[-=*~#]{2,}\s*([^-\n=*~#]{2,80})\s*[-=*~#]{2,}\s*$/;
  const m3 = t.match(borderRe);
  if (m3 && (m3[1] ?? "").trim()) return (m3[1] ?? "").trim();

  return null;
}

export function isQuestionStartLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    /^\s*(?:(?:প্রশ্ন\s*(?:নং\.?|No\.?)?|Question\s*(?:No\.?)?|Q\s*[\.\-]?)\s*0*\d+|(?:\d+|[০-৯]+)\s*[\.\)\।\)\-]\-?)\s+/i.test(t) ||
    /^\s*(?:QUESTION\s*[:\-])/i.test(t)
  );
}

export function isOptionOrAnswerOrStem(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // Option marker
  if (/^\s*(?:\([A-Da-dকখগঘ1-4১-৪]\)|\[[A-Da-dকখগঘ1-4১-৪]\]|[A-Da-dকখগঘ1-4১-৪]\s*[\.\)\:\-\—।\)])/i.test(t)) return true;
  // Answer or Explanation prefix
  if (/^\s*(?:Ans(?:wer)?\.?|Correct|উত্তর|সঠিক\s*উত্তর|ব্যাখ্যা|Explanation|Explan\.?|MARK|MARKS)\b/i.test(t)) return true;
  // Stem / passage indicator phrases
  if (/(?:উদ্দীপক|অনুচ্ছেদ|পড়|পড়িয়া|পড়ে|লক্ষ\s*কর|লক্ষ্য\s*কর|উত্তর\s*দাও|stem|passage|context|following\s+information|based\s+on)/i.test(t)) return true;
  // Ends with or contains question mark
  if (/[?？]/.test(t)) return true;
  return false;
}

/**
 * Split pasted text into topic sections. Supports:
 * 1) Explicit topic lines: Topic: Cell Biology · টপিক: কোষ · [Cell Biology]
 * 2) Plain topic names preceding question blocks: Cell Biology \n 1. Question...
 * Stored as a Topic entity, never mistaken for a question, option, or answer.
 */
export function splitPasteByTopic(raw: string): { topic: string; text: string }[] {
  const lines = raw.split("\n");
  const sections: { topic: string; text: string }[] = [];
  let currentTopic = "";
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const explicitTopic = isExplicitTopicHeader(line);

    if (explicitTopic) {
      if (currentLines.join("\n").trim()) {
        sections.push({ topic: currentTopic, text: currentLines.join("\n") });
      }
      currentTopic = explicitTopic;
      currentLines = [];
      continue;
    }

    const trimmed = line.trim();
    if (
      trimmed.length >= 2 &&
      trimmed.length <= 80 &&
      !isQuestionStartLine(trimmed) &&
      !isOptionOrAnswerOrStem(trimmed) &&
      !/^[.,;:!?।]$/.test(trimmed)
    ) {
      // Look ahead for the next non-empty line: must be a question start!
      let nextNonEmpty = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextNonEmpty = lines[j].trim();
          break;
        }
      }
      if (nextNonEmpty && isQuestionStartLine(nextNonEmpty)) {
        if (currentLines.join("\n").trim()) {
          sections.push({ topic: currentTopic, text: currentLines.join("\n") });
        }
        currentTopic = trimmed;
        currentLines = [];
        continue;
      }
    }

    currentLines.push(line);
  }

  if (currentLines.join("\n").trim() || sections.length === 0) {
    sections.push({ topic: currentTopic, text: currentLines.join("\n") });
  }

  return sections.filter((s) => s.text.trim());
}

export function sanitizeQuestions(questions: PdfMaterialQuestion[]): PdfMaterialQuestion[] {
  let counter = 0;
  return questions.map((q) => {
    if (q.isStandaloneImage) return q;
    counter += 1;
    return { ...q, qNumber: counter };
  });
}
