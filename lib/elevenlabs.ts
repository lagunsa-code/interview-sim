import type { Scenario } from "./types";
import { buildPrompt, voiceLabels } from "./prompt";

const API = "https://api.elevenlabs.io";
const AGENT_NAME = "Interview Simulator";

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set in Vercel environment variables");
  return k;
}

async function el<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": key(), "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${init.method || "GET"} ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export type Voice = { voice_id: string; name: string; labels?: Record<string, string>; category?: string };

export async function listVoices(): Promise<Voice[]> {
  try {
    const out: Voice[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ page_size: "100" });
      if (token) q.set("next_page_token", token);
      const r = await el<{ voices: Voice[]; has_more?: boolean; next_page_token?: string }>(`/v2/voices?${q}`);
      out.push(...r.voices);
      if (!r.has_more || !r.next_page_token) break;
      token = r.next_page_token;
    }
    return out;
  } catch {
    const r = await el<{ voices: Voice[] }>(`/v1/voices`);
    return r.voices;
  }
}

// Match a scenario's voice (name or id) to a real voice in the account.
function resolveVoice(wanted: string, voices: Voice[], taken: Set<string>): string {
  const w = wanted.trim().toLowerCase();
  const byId = voices.find((v) => v.voice_id.toLowerCase() === w);
  const byName =
    voices.find((v) => v.name.toLowerCase() === w) ||
    voices.find((v) => v.name.toLowerCase().startsWith(w + " ") || v.name.toLowerCase().startsWith(w + " -")) ||
    voices.find((v) => v.name.toLowerCase().includes(w));
  const hit = byId || byName;
  if (hit) return hit.voice_id;
  // Fall back to any voice not already used so interviewers still sound different.
  const free = voices.find((v) => !taken.has(v.voice_id));
  if (!free) throw new Error(`No voice found for "${wanted}"`);
  return free.voice_id;
}

let cachedAgentId: string | null = null;

async function getOrCreateAgent(): Promise<string> {
  if (process.env.ELEVENLABS_AGENT_ID) return process.env.ELEVENLABS_AGENT_ID;
  if (cachedAgentId) return cachedAgentId;
  const list = await el<{ agents: { agent_id: string; name: string }[] }>(
    `/v1/convai/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=30`
  );
  const found = list.agents?.find((a) => a.name === AGENT_NAME);
  if (found) return (cachedAgentId = found.agent_id);
  const created = await el<{ agent_id: string }>(`/v1/convai/agents/create`, {
    method: "POST",
    body: JSON.stringify({
      name: AGENT_NAME,
      tags: ["interview-sim"],
      conversation_config: {
        agent: { first_message: "Hello?", language: "en", prompt: { prompt: "Placeholder. Configured per session." } },
      },
    }),
  });
  return (cachedAgentId = created.agent_id);
}

// Reconfigure the single agent for this scenario, then hand back a signed URL.
// One user, one call at a time, so rewriting the agent before each call is safe.
export async function prepareSession(s: Scenario): Promise<{ signedUrl: string; agentId: string; voiceMap: Record<string, string> }> {
  const [agentId, voices] = await Promise.all([getOrCreateAgent(), listVoices()]);
  const labels = voiceLabels(s.interviewers);
  const taken = new Set<string>();
  const ids = s.interviewers.map((i) => {
    const id = resolveVoice(i.voice, voices, taken);
    taken.add(id);
    return id;
  });
  const { prompt, firstMessage } = buildPrompt(s);

  await el(`/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      conversation_config: {
        agent: {
          first_message: firstMessage,
          language: "en",
          prompt: { prompt, llm: s.llm || "claude-sonnet-4-5", temperature: 0.7 },
        },
        tts: {
          voice_id: ids[0],
          supported_voices: s.interviewers.slice(1).map((i, k) => ({
            label: labels[k + 1],
            voice_id: ids[k + 1],
            description: `${i.name}, ${i.title}. Use for every line ${i.name} speaks.`,
          })),
        },
        // Patient turn-taking: candidates pause to think in interviews.
        turn: { turn_timeout: 15, turn_eagerness: "patient" },
        conversation: { max_duration_seconds: Math.round((s.durationMinutes + 5) * 60) },
      },
    }),
  });

  const r = await el<{ signed_url: string }>(`/v1/convai/conversation/get-signed-url?agent_id=${agentId}`);
  const voiceMap: Record<string, string> = {};
  s.interviewers.forEach((i, k) => (voiceMap[i.name] = voices.find((v) => v.voice_id === ids[k])?.name || ids[k]));
  return { signedUrl: r.signed_url, agentId, voiceMap };
}

export type TranscriptTurn = { role: "agent" | "user"; message: string | null; time_in_call_secs?: number };

export async function getConversation(id: string): Promise<{ status: string; transcript: TranscriptTurn[]; durationSecs?: number }> {
  const r = await el<{ status: string; transcript: TranscriptTurn[]; metadata?: { call_duration_secs?: number } }>(
    `/v1/convai/conversations/${encodeURIComponent(id)}`
  );
  return { status: r.status, transcript: r.transcript || [], durationSecs: r.metadata?.call_duration_secs };
}
