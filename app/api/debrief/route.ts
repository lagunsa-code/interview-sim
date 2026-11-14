import { getConversation } from "@/lib/elevenlabs";
import { generateDebrief } from "@/lib/debrief";
import { saveDebriefToNotion } from "@/lib/notion";
import { validateScenario } from "@/lib/scenarios";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (secs?: number) => (secs == null ? "" : `[${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}] `);

export async function POST(req: Request) {
  try {
    const { conversationId, scenario } = await req.json();
    validateScenario(scenario);
    if (!conversationId) throw new Error("Missing conversationId");

    // ElevenLabs finishes processing the call a few seconds after it ends.
    let conv = await getConversation(conversationId);
    for (let i = 0; i < 20 && conv.status !== "done"; i++) {
      await sleep(3000);
      conv = await getConversation(conversationId);
    }
    const lead = scenario.interviewers[0].name;
    const lines = conv.transcript
      .filter((t) => t.message && t.message.trim())
      .map((t) => `${fmt(t.time_in_call_secs)}${t.role === "user" ? scenario.candidateName : lead}: ${t.message!.trim()}`);
    const userTurns = conv.transcript.filter((t) => t.role === "user" && t.message?.trim()).length;
    if (userTurns < 2) throw new Error("The call was too short to debrief.");

    const debrief = await generateDebrief(scenario, lines.join("\n"));
    let notionUrl: string | null = null;
    let notionError: string | null = null;
    try {
      notionUrl = await saveDebriefToNotion({ scenario, debrief, transcriptLines: lines, conversationId });
    } catch (e) {
      notionError = (e as Error).message;
    }
    return Response.json({ debrief, transcript: lines, notionUrl, notionError, durationSecs: conv.durationSecs });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
