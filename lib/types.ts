// A scenario fully describes one practice interview. Everything here can change
// from interview to interview: context, number of interviewers, demeanor, style.

export type Interviewer = {
  name: string; // "Shane Bermingham"
  title: string; // "Talent Acquisition Manager"
  voice: string; // ElevenLabs voice name or voice_id, e.g. "Adam" or "pNInz6obpgDQGcFmaJgB"
  demeanor: string; // how they come across: "warm but brisk", "skeptical, low affect"
  style: string; // how they interview: "rapid-fire screening checklist", "digs for numbers"
  focus: string[]; // topics this person owns in the interview
};

export type Difficulty = "friendly" | "realistic" | "tough";

export type Scenario = {
  id: string;
  title: string; // shown in the picker
  candidateName: string;
  company: string;
  role: string;
  round: string; // "Recruiter phone screen", "Hiring manager", "Panel", "Mock pitch"
  durationMinutes: number;
  difficulty: Difficulty;
  format: string; // phone, Zoom, in person; what the setting sounds like
  agenda: string[]; // the order the interviewer(s) intend to run
  companyContext: string; // what the interviewers know and can say about the company and role
  candidateResume: string; // what the interviewers have in front of them about the candidate
  interviewers: Interviewer[]; // first one leads and opens the call
  likelyQuestions: string[]; // questions they should cover, in their own words
  curveballs: string[]; // harder moments to drop in naturally
  openingLine?: string; // optional exact first line; otherwise generated
  // Debrief settings
  rubric: string[]; // what a strong performance looks like in this round
  factsToCheck: string[]; // the candidate's approved facts and wording rules
  candidateGoals: string[]; // what the candidate wants to land or ask in this call
  notionParentPageId?: string; // debrief is saved as a child page here
  llm?: string; // ElevenLabs agent LLM override
};
