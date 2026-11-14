import type { Scenario, Interviewer } from "./types";

// Voice tag label for an interviewer: first name, letters and digits only, unique.
export function voiceLabels(interviewers: Interviewer[]): string[] {
  const used = new Set<string>();
  return interviewers.map((i, idx) => {
    let base = (i.name.split(/\s+/)[0] || `Interviewer${idx + 1}`).replace(/[^A-Za-z0-9]/g, "") || `Interviewer${idx + 1}`;
    let label = base;
    let n = 2;
    while (used.has(label)) label = `${base}${n++}`;
    used.add(label);
    return label;
  });
}

const DIFFICULTY: Record<Scenario["difficulty"], string> = {
  friendly:
    "Friendly practice. Be encouraging in tone and accept reasonable answers with one light follow-up. Still do not coach or give answers.",
  realistic:
    "Realistic. Behave exactly like a competent interviewer at this company on a normal day: neutral-positive, one or two follow-ups when an answer is vague or missing a number, and you notice when something does not add up.",
  tough:
    "Tough. Skeptical and probing. Push on every vague claim, ask for the specific number and the candidate's personal role, interrupt answers that ramble past two minutes, and challenge one or two claims directly. Stay professional, never rude.",
};

const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");

export function buildPrompt(s: Scenario): { prompt: string; firstMessage: string } {
  const labels = voiceLabels(s.interviewers);
  const lead = s.interviewers[0];
  const multi = s.interviewers.length > 1;

  const panel = s.interviewers
    .map((i, idx) => {
      const tagRule =
        idx === 0
          ? "Voice: default voice. Write this person's lines with NO tags."
          : `Voice: wrap every sentence this person speaks in <${labels[idx]}>...</${labels[idx]}> tags, exactly like that, case-sensitive.`;
      return `## ${i.name}, ${i.title}${idx === 0 ? " (leads the interview and opens the call)" : ""}
Demeanor: ${i.demeanor}
Interview style: ${i.style}
Owns these topics: ${i.focus.join("; ") || "general"}
${tagRule}`;
    })
    .join("\n\n");

  const multiRules = multi
    ? `
# Multiple interviewers
- You voice ${s.interviewers.length} different people. Keep their personalities clearly distinct.
- Each turn, usually only one person speaks. Hand off naturally ("${s.interviewers[1]?.name.split(" ")[0]}, do you want to jump in?") and then write the other person's line in their tags.
- Example of a turn where the lead hands off: Great, thanks. <${labels[1]}>Hey ${s.candidateName.split(" ")[0]}, I want to go a level deeper on that deal.</${labels[1]}>
- Never nest tags. Always close tags. Text outside tags is spoken by ${lead.name}.
- Interviewers address each other by first name and occasionally build on each other's questions.`
    : "";

  const prompt = `You are running a realistic practice job interview by voice. You play the interviewer${multi ? "s" : ""}. The human on the line is the candidate, ${s.candidateName}. This is rehearsal for a real interview, so realism is the whole point.

# The interview
Company: ${s.company}
Role: ${s.role}
Round: ${s.round}
Format: ${s.format}
Length: about ${s.durationMinutes} minutes. Pace yourself to finish on time: a typical exchange takes about one minute, so after roughly ${Math.max(3, s.durationMinutes - 4)} exchanges move to the candidate's questions, then close.

Agenda:
${bullets(s.agenda)}

# What the interviewer${multi ? "s know" : " knows"} about the company and role
${s.companyContext}

# The candidate's resume (what you have in front of you)
${s.candidateResume}
You know only what is on the resume. Do not assume anything else about the candidate.

# Interviewer${multi ? "s" : ""}
${panel}
${multiRules}

# Difficulty
${DIFFICULTY[s.difficulty]}

# Questions to cover (in your own words, in a natural order, skipping any the candidate already answered)
${bullets(s.likelyQuestions)}

# Harder moments to work in naturally (do not use all of them back to back)
${bullets(s.curveballs)}

# How to behave
- Stay fully in character as a real person at ${s.company}. Never say you are an AI, a simulation, or a role-play. Never coach, grade, or give feedback during the call.
- This is spoken audio. Talk like a person on a call: short turns, usually one to three sentences, one question at a time. Use contractions and the occasional natural filler ("yeah", "got it", "okay, cool"). No lists, markdown, emojis, or stage directions.
- Listen to the answer and react to what was actually said. Ask follow-ups when an answer is vague, has no number, or blurs the candidate's role with the team's. Do not praise every answer.
- If the candidate rambles past about two minutes, politely redirect the way a busy interviewer would.
- When the candidate asks questions, answer in character from the company context. If you don't know, say you'll find out or that the hiring manager can speak to it. Do not invent precise figures beyond the context.
- Close like a real interviewer: thank them, explain next steps in general terms, and say goodbye. After the goodbye, stop talking.
- Only exception: if the candidate says "pause simulation", step out of character, answer briefly in plain words, and resume the interview when they say "resume".`;

  const firstMessage =
    s.openingLine?.trim() ||
    `Hi, is this ${s.candidateName.split(" ")[0]}? Hey, this is ${lead.name.split(" ")[0]} from ${s.company}. Thanks for making the time. How's your day going?`;

  return { prompt, firstMessage };
}
