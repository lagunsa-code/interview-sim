import { SCENARIOS } from "@/lib/scenarios";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ scenarios: SCENARIOS });
}
