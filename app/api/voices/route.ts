import { listVoices } from "@/lib/elevenlabs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const voices = await listVoices();
    return Response.json({
      voices: voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        desc: [v.labels?.gender, v.labels?.accent, v.labels?.age, v.labels?.description || v.labels?.descriptive].filter(Boolean).join(", "),
      })),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
