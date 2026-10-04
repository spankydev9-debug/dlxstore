import { NextResponse } from "next/server";
import { answerFromCatalogue, describeAssistantCapability } from "../../../../services/server/assistant";

// The assistant is a POST body, so it must never be cached.
export const dynamic = "force-dynamic";

/** GET reports capability so a UI can label itself honestly. */
export async function GET() {
  return NextResponse.json(describeAssistantCapability());
}

/**
 * POST asks the assistant a question.
 *
 * Answered from the real catalogue via `search_the_catalogue`. No language model
 * is called, so the response cannot contain an invented product, price or stock
 * level. `source` is returned so the client always knows how the answer was made.
 */
export async function POST(request: Request) {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    if (typeof body?.question === "string") {
      // Bound on the server too: a client-side limit is a suggestion.
      question = body.question.slice(0, 300);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (question.trim() === "") {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  try {
    const answer = await answerFromCatalogue(question);
    return NextResponse.json(answer);
  } catch (error) {
    // A search failure is a server problem, and the message stays generic so no
    // catalogue detail leaks through it.
    console.error("[assistant] search failed:", error);
    return NextResponse.json(
      { error: "The assistant could not search the catalogue right now." },
      { status: 500 }
    );
  }
}
