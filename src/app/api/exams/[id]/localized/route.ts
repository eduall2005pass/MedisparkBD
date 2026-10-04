import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import {
  fetchMasterSet,
  fetchTranslations,
  masterRowToOptions,
  normalizeSyncSet,
} from "@/lib/exam-autosync";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id]/localized?lang=bn|en&set=A|B
 * Student paper: SAME question IDs, order, topic, correct_option in both
 * languages. Sanitized — correct answers never leave the server. Scoring
 * always uses the stored correct_option identifier (see submit path).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getFirebaseUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id: examId } = await params;
  const set = normalizeSyncSet(request.nextUrl.searchParams.get("set")) ?? "A";
  const langRaw = (request.nextUrl.searchParams.get("lang") ?? "bn").toLowerCase();
  const lang = langRaw === "en" || langRaw === "english" ? "en" : "bn";
  try {
    const masters = await fetchMasterSet(examId, set);
    if (lang === "bn") {
      return NextResponse.json({
        examId, set, lang: "bn",
        questions: masters.map((m, i) => {
          const [a, b, c, d] = masterRowToOptions(m);
          return {
            id: m.id, questionUid: m.question_uid, order: i + 1,
            topic: m.topic, question: m.question, options: [a, b, c, d],
            marks: Number(m.marks) || 1,
            // correctOption intentionally omitted (server-side lock).
          };
        }),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const translations = await fetchTranslations(examId, set);
    return NextResponse.json({
      examId, set, lang: "en", autoTranslated: true,
      questions: masters.map((m, i) => {
        const t = translations.get(Number(m.id));
        return {
          id: m.id, questionUid: m.question_uid, order: i + 1,
          topic: m.topic,
          question: t?.question_text ?? null,
          options: t ? [t.option_a, t.option_b, t.option_c, t.option_d] : [null, null, null, null],
          marks: Number(m.marks) || 1,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
