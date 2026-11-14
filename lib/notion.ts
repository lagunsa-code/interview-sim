import type { Debrief } from "./debrief";
import type { Scenario } from "./types";

const NOTION = "https://api.notion.com/v1";
// "Mock Interviews" database under Job Search HQ. One row per practice call.
const MOCK_INTERVIEWS_DB_ID = "418544a585f981139bf2e53438bcf919";

type Block = Record<string, unknown>;
const rt = (text: string) => [{ type: "text", text: { content: text.slice(0, 1900) } }];
const p = (text: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(text) } });
const h2 = (text: string): Block => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(text) } });
const h3 = (text: string): Block => ({ object: "block", type: "heading_3", heading_3: { rich_text: rt(text) } });
const li = (text: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(text) } });
const callout = (text: string, emoji: string): Block => ({
  object: "block",
  type: "callout",
  callout: { rich_text: rt(text), icon: { type: "emoji", emoji } },
});

async function notion(path: string, method: string, body: unknown) {
  const res = await fetch(`${NOTION}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion ${method} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

export async function saveDebriefToNotion(opts: {
  scenario: Scenario;
  debrief: Debrief;
  transcriptLines: string[];
  conversationId: string;
  durationSecs?: number;
}): Promise<string | null> {
  const { scenario: s, debrief: d, transcriptLines, conversationId, durationSecs } = opts;
  if (!process.env.NOTION_TOKEN) return null;
  const dbId = process.env.NOTION_MOCK_INTERVIEWS_DB_ID || MOCK_INTERVIEWS_DB_ID;

  const now = new Date();
  const date = now.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  const company = s.title.split(":")[0];
  const text = (v: string) => ({ rich_text: rt(v) });
  const blocks: Block[] = [
    callout(`${d.score}/10 · ${d.verdict}. ${d.summary}`, "🎯"),
    p(`${s.round} · ${s.interviewers.map((i) => i.name).join(", ")} · ${s.difficulty} · ElevenLabs conversation ${conversationId}`),
    h2("What worked"),
    ...d.strengths.map(li),
    h2("Fix before the real call"),
    ...d.fixes.flatMap((f) => [h3(f.moment), p(`Issue: ${f.issue}`), p(`Better: ${f.betterAnswer}`)]),
    h2("Fact and wording checks"),
    ...(d.factFlags.length ? d.factFlags.map((f) => li(`"${f.said}": ${f.problem}`)) : [p("No issues found.")]),
    h2("Goals for this call"),
    ...d.goals.map((g) => li(`${g.hit ? "✅" : "❌"} ${g.goal}${g.note ? `: ${g.note}` : ""}`)),
    h2("Rubric"),
    ...d.rubric.map((r) => li(`${r.score}/5 · ${r.criterion}${r.note ? `: ${r.note}` : ""}`)),
    h2("Drill next"),
    ...d.drillNext.map(li),
  ];

  const properties: Record<string, unknown> = {
    Session: { title: rt(`${company} · ${s.round.split(",")[0]} · ${date}`) },
    Date: { date: { start: now.toISOString() } },
    Round: text(s.round),
    Interviewers: text(s.interviewers.map((i) => `${i.name} (${i.title})`).join(", ")),
    Difficulty: { select: { name: s.difficulty } },
    Score: { number: d.score },
    Verdict: { select: { name: d.verdict } },
    "Fact Flags": { number: d.factFlags.length },
    "Top Fix": text(d.fixes[0] ? `${d.fixes[0].moment}: ${d.fixes[0].issue}` : ""),
    "Drill Next": text(d.drillNext.join("; ")),
    Scenario: text(s.title),
    "Conversation ID": text(conversationId),
  };
  if (durationSecs) properties.Minutes = { number: Math.round(durationSecs / 6) / 10 };
  if (s.notionRolePageId) properties.Role = { relation: [{ id: s.notionRolePageId }] };

  const page = await notion("/pages", "POST", {
    parent: { database_id: dbId },
    icon: { type: "emoji", emoji: "🎙️" },
    properties,
    children: blocks.slice(0, 100),
  });

  const rest = [...blocks.slice(100), h2("Transcript"), ...transcriptLines.map(p)];
  for (let i = 0; i < rest.length; i += 100) {
    await notion(`/blocks/${page.id}/children`, "PATCH", { children: rest.slice(i, i + 100) });
  }
  return page.url as string;
}
