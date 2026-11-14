import { generateObject } from "ai";
import { z } from "zod";
import type { Scenario } from "./types";

export const DebriefSchema = z.object({
  score: z.number().min(1).max(10).describe("Overall 1 to 10, calibrated: 7 means would likely advance, 9+ is rare"),
  verdict: z.enum(["Would advance", "Coin flip", "Would not advance"]),
  summary: z.string().describe("Two sentences, direct, from the interviewer's point of view"),
  strengths: z.array(z.string()).describe("Two to four specific things that worked, citing what he said"),
  fixes: z
    .array(
      z.object({
        moment: z.string().describe("Short label for the question or moment"),
        issue: z.string().describe("What went wrong, specifically"),
        betterAnswer: z.string().describe("A tighter answer he could say out loud, in his voice, using only approved facts"),
      })
    )
    .describe("The three to five highest-impact fixes, most important first"),
  factFlags: z
    .array(z.object({ said: z.string(), problem: z.string() }))
    .describe("Anything he said that breaks a fact or wording rule, or a number that does not match the approved facts. Empty if none."),
  goals: z.array(z.object({ goal: z.string(), hit: z.boolean(), note: z.string() })),
  rubric: z.array(z.object({ criterion: z.string(), score: z.number().min(1).max(5), note: z.string() })),
  drillNext: z.array(z.string()).describe("Two or three things to practice in the next rep"),
});
export type Debrief = z.infer<typeof DebriefSchema>;

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n") || "- (none)";

export async function generateDebrief(s: Scenario, transcript: string): Promise<Debrief> {
  const { object } = await generateObject({
    model: process.env.DEBRIEF_MODEL || "anthropic/claude-opus-4.6",
    schema: DebriefSchema,
    system:
      "You are a demanding interview coach for senior enterprise sales candidates. You review a transcript of a practice interview run by an AI interviewer. Be direct and specific, quote the candidate's words, and never pad with generic advice. Judge only the candidate (user) turns. The interviewer lines may contain <Name> voice tags; ignore the tags.",
    prompt: `Interview: ${s.company}, ${s.role}. Round: ${s.round}. Planned length: ${s.durationMinutes} minutes. Difficulty: ${s.difficulty}.

What a strong performance looks like in this round:
${bullets(s.rubric)}

The candidate's approved facts and wording rules (flag any breach or mismatch):
${bullets(s.factsToCheck)}

What the candidate wanted to land or ask in this call:
${bullets(s.candidateGoals)}

Transcript:
${transcript}

Score every rubric line and every goal. In betterAnswer, use only the approved facts; never invent numbers, customers, or experience.`,
  });
  return object;
}
