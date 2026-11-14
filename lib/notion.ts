import type { Debrief } from "./debrief";
import type { Scenario } from "./types";

const NOTION = "https://api.notion.com/v1";

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
}): Promise<string | null> {
  const { scenario: s, debrief: d, transcriptLines, conversationId } = opts;
  if (!process.env.NOTION_TOKEN || !s.notionParentPageId) return null;

  const date = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
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

  const page = await notion("/pages", "POST", {
    parent: { page_id: s.notionParentPageId },
    icon: { type: "emoji", emoji: "🎙️" },
    properties: { title: { title: rt(`Mock interview debrief: ${s.title.split(":")[0]} · ${date} · ${d.score}/10`) } },
    children: blocks.slice(0, 100),
  });

  const rest = [...blocks.slice(100), h2("Transcript"), ...transcriptLines.map(p)];
  for (let i = 0; i < rest.length; i += 100) {
    await notion(`/blocks/${page.id}/children`, "PATCH", { children: rest.slice(i, i + 100) });
  }
  return page.url as string;
}
