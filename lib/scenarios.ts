import type { Scenario } from "./types";
import eliseaiScreen from "@/scenarios/eliseai-recruiter-screen.json";
import eliseaiPanel from "@/scenarios/eliseai-hm-panel.json";

// To add an interview: drop a JSON file in /scenarios and add it here.
// Or edit any scenario in the app before starting; edits stay in your browser.
export const SCENARIOS: Scenario[] = [eliseaiScreen as Scenario, eliseaiPanel as Scenario];

export function validateScenario(s: unknown): asserts s is Scenario {
  const x = s as Scenario;
  if (!x || typeof x !== "object") throw new Error("Scenario must be an object");
  for (const k of ["id", "title", "candidateName", "company", "role", "round", "companyContext", "candidateResume"] as const) {
    if (typeof x[k] !== "string" || !x[k].trim()) throw new Error(`Scenario is missing "${k}"`);
  }
  if (!Array.isArray(x.interviewers) || x.interviewers.length === 0) throw new Error("Add at least one interviewer");
  if (x.interviewers.length > 9) throw new Error("ElevenLabs allows at most 9 extra voices per agent, so keep it to 9 interviewers or fewer");
  for (const i of x.interviewers) {
    if (!i.name?.trim() || !i.voice?.trim()) throw new Error("Every interviewer needs a name and a voice");
  }
  if (!x.durationMinutes || x.durationMinutes < 1) throw new Error("durationMinutes must be at least 1");
  for (const k of ["agenda", "likelyQuestions", "curveballs", "rubric", "factsToCheck", "candidateGoals"] as const) {
    if (!Array.isArray(x[k])) (x as Record<string, unknown>)[k] = [];
  }
}
