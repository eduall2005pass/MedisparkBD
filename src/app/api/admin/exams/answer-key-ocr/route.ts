import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { BEST_FREE_MODELS, OPENROUTER_BASE } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
// Vision transcription can take a while on free tiers (1 image ≈ seconds).
export const maxDuration = 60;

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Vision-capable free models first (reuses existing OpenRouter infra —
// no new external service). Text-only models cannot see images.
const VISION_CHAIN = [
  BEST_FREE_MODELS.vision,
  "inclusionai/ling-3.0-flash-vl:free",
  BEST_FREE_MODELS.router,
] as const;

const TRANSCRIBE_PROMPT = `Transcribe this answer-key image verbatim.
Output ONLY one entry per line in the exact format "NUMBER-LETTER" (e.g. "1-A").
Rules:
- Preserve the original question numbers and order exactly as shown.
- Letters are option labels A B C D E (uppercase). Map Bengali কখগঘঙ to A B C D E.
- Do NOT guess, reorder, deduplicate, or add entries that are not visible.
- No headings, no explanations, no extra text — only NUMBER-LETTER lines.`;

async function transcribeImage(dataUrl: string, apiKey: string): Promise<{ text: string; model: string }> {
  let lastErr = "vision transcription failed";
  for (const model of VISION_CHAIN) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://medisparkbd.com",
          "X-Title": "MediSparkBD",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TRANSCRIBE_PROMPT },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          max_tokens: 2048,
          temperature: 0,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        lastErr = `${model}: ${data?.error?.message ?? res.statusText}`;
        if (res.status === 429 || res.status === 403 || res.status === 404) continue;
        throw new Error(lastErr);
      }
      const raw = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(raw)
        ? raw.map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? "")).join("\n")
        : typeof raw === "string"
          ? raw
          : "";
      if (!text.trim()) {
        lastErr = `${model}: empty transcription`;
        continue;
      }
      return { text: text.trim(), model };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
  }
  throw new Error(lastErr);
}

function fileToDataUrl(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const b64 = Buffer.from(buf).toString("base64");
    const mime = file.type || "image/png";
    return `data:${mime};base64,${b64}`;
  });
}

/** POST — transcribe answer-key image(s) to raw key text (parsed client-side).
 *  Accepts multipart { images: File[] } (preferred) or JSON { images: dataURL[] }.
 *  Returns { texts, combinedText, model, count }. No files are stored. */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OCR unavailable (missing API key). Please paste the answer key as text instead." },
      { status: 503 },
    );
  }

  let dataUrls: string[] = [];
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
      const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) return NextResponse.json({ error: "No images provided." }, { status: 400 });
      if (files.length > MAX_IMAGES) {
        return NextResponse.json({ error: `Too many images (max ${MAX_IMAGES} per request).` }, { status: 400 });
      }
      for (const f of files) {
        if (!f.type.startsWith("image/")) {
          return NextResponse.json({ error: `"${f.name}" is not an image.` }, { status: 400 });
        }
        if (f.size > MAX_IMAGE_BYTES) {
          return NextResponse.json({ error: `"${f.name}" exceeds 8 MB.` }, { status: 413 });
        }
      }
      dataUrls = await Promise.all(files.map(fileToDataUrl));
    } else {
      const body = (await request.json().catch(() => null)) as { images?: unknown } | null;
      const imgs = Array.isArray(body?.images) ? body.images : [];
      const valid = imgs.filter((u): u is string => typeof u === "string" && u.startsWith("data:image"));
      if (valid.length === 0) return NextResponse.json({ error: "No images provided." }, { status: 400 });
      if (valid.length > MAX_IMAGES) {
        return NextResponse.json({ error: `Too many images (max ${MAX_IMAGES} per request).` }, { status: 400 });
      }
      dataUrls = valid;
    }
  } catch {
    return NextResponse.json({ error: "Failed to read images." }, { status: 400 });
  }

  try {
    const texts: string[] = [];
    let usedModel = "";
    // Sequential (free-tier friendly, low RAM) — client shows Page x/y progress.
    for (const url of dataUrls) {
       
      const r = await transcribeImage(url, apiKey);
      texts.push(r.text);
      usedModel = r.model;
    }
    return NextResponse.json({
      texts,
      combinedText: texts.join("\n"),
      model: usedModel,
      count: texts.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "OCR failed.";
    return NextResponse.json(
      { error: `Answer-key OCR failed (${message}). Please paste the key as text instead.` },
      { status: 502 },
    );
  }
}
