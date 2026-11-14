import { prepareSession } from "@/lib/elevenlabs";
import { validateScenario } from "@/lib/scenarios";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { scenario } = await req.json();
    validateScenario(scenario);
    const out = await prepareSession(scenario);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
