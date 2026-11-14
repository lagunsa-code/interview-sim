"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VoiceConversation } from "@elevenlabs/client";
import type { Scenario, Interviewer, Difficulty } from "@/lib/types";
import type { Debrief } from "@/lib/debrief";
import { voiceLabels } from "@/lib/prompt";

type Line = { who: string; role: "agent" | "user"; text: string };
type VoiceOpt = { id: string; name: string; desc: string };
type Phase = "setup" | "connecting" | "live" | "debriefing" | "done";

const LS_KEY = "interview-sim:custom-scenarios";
const listToText = (xs: string[]) => xs.join("\n");
const textToList = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function loadCustom(): Scenario[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveCustom(xs: Scenario[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(xs));
  } catch {}
}

// Split an agent message into speaker segments using the <Label>...</Label> voice tags.
function splitSpeakers(text: string, s: Scenario): Line[] {
  const labels = voiceLabels(s.interviewers);
  const nameFor = (label: string) => s.interviewers[labels.indexOf(label)]?.name || label;
  const lead = s.interviewers[0].name;
  const out: Line[] = [];
  const re = /<([A-Za-z0-9]+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (who: string, t: string) => {
    const clean = t.replace(/<\/?[A-Za-z0-9]+>/g, "").trim();
    if (clean) out.push({ who, role: "agent", text: clean });
  };
  while ((m = re.exec(text))) {
    push(lead, text.slice(last, m.index));
    push(nameFor(m[1]), m[2]);
    last = re.lastIndex;
  }
  push(lead, text.slice(last));
  return out;
}

export default function Page() {
  const [presets, setPresets] = useState<Scenario[]>([]);
  const [custom, setCustom] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Scenario | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [voices, setVoices] = useState<VoiceOpt[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<"speaking" | "listening">("listening");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<{ debrief: Debrief; notionUrl: string | null; notionError: string | null } | null>(null);
  const convRef = useRef<VoiceConversation | null>(null);
  const convIdRef = useRef<string>("");
  const scenarioRef = useRef<Scenario | null>(null);
  const endedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/scenarios")
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.scenarios);
        const c = loadCustom();
        setCustom(c);
        const first = d.scenarios[0];
        if (first) {
          setSelectedId(first.id);
          setDraft(structuredClone(first));
        }
      })
      .catch((e) => setError(String(e)));
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => (d.voices ? setVoices(d.voices) : setError(d.error || "Could not load voices")))
      .catch(() => {});
  }, []);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [lines]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const all = useMemo(() => [...custom, ...presets], [custom, presets]);

  function pick(id: string) {
    setSelectedId(id);
    const s = all.find((x) => x.id === id);
    if (s) setDraft(structuredClone(s));
    setJsonMode(false);
  }

  function update<K extends keyof Scenario>(k: K, v: Scenario[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }
  function updateInterviewer(i: number, patch: Partial<Interviewer>) {
    setDraft((d) => (d ? { ...d, interviewers: d.interviewers.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : d));
  }

  function currentScenario(): Scenario {
    if (jsonMode) return JSON.parse(jsonText);
    return draft!;
  }

  function saveAsCustom() {
    try {
      const s = currentScenario();
      const isCustom = s.id.startsWith("custom-");
      const id = isCustom ? s.id : `custom-${Date.now()}`;
      const saved: Scenario = { ...s, id, title: isCustom ? s.title : `${s.title} (edited)` };
      const next = [saved, ...custom.filter((c) => c.id !== id)];
      setCustom(next);
      saveCustom(next);
      setDraft(saved);
      setSelectedId(id);
      setJsonMode(false);
      setError("");
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
    }
  }
  function deleteCustom() {
    const next = custom.filter((c) => c.id !== selectedId);
    setCustom(next);
    saveCustom(next);
    pick(presets[0]?.id);
  }

  async function start() {
    setError("");
    setResult(null);
    setLines([]);
    setSeconds(0);
    endedRef.current = false;
    let s: Scenario;
    try {
      s = currentScenario();
    } catch (e) {
      setError(`Scenario JSON is invalid: ${(e as Error).message}`);
      return;
    }
    scenarioRef.current = s;
    setPhase("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: s }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const conv = await VoiceConversation.startSession({
        signedUrl: d.signedUrl,
        connectionType: "websocket",
        onConnect: ({ conversationId }) => {
          convIdRef.current = conversationId;
          setPhase("live");
        },
        onMessage: (m) => {
          const role = m.role ?? (m.source === "ai" ? "agent" : "user");
          if (role === "user") setLines((xs) => [...xs, { who: s.candidateName.split(" ")[0], role: "user", text: m.message }]);
          else setLines((xs) => [...xs, ...splitSpeakers(m.message, s)]);
        },
        onModeChange: ({ mode }) => setMode(mode as "speaking" | "listening"),
        onError: (msg) => setError(String(msg)),
        onDisconnect: () => {
          if (!endedRef.current) finish();
        },
      });
      convRef.current = conv;
      if (!convIdRef.current) convIdRef.current = conv.getId();
      setPhase("live");
    } catch (e) {
      setError((e as Error).message || String(e));
      setPhase("setup");
    }
  }

  async function finish() {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      await convRef.current?.endSession();
    } catch {}
    convRef.current = null;
    const id = convIdRef.current;
    if (!id) {
      setPhase("setup");
      return;
    }
    setPhase("debriefing");
    try {
      const r = await fetch("/api/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, scenario: scenarioRef.current }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setResult({ debrief: d.debrief, notionUrl: d.notionUrl, notionError: d.notionError });
      setPhase("done");
    } catch (e) {
      setError(`Debrief failed: ${(e as Error).message}. Conversation ID: ${id}`);
      setPhase("done");
    }
  }

  function toggleMute() {
    convRef.current?.setMicMuted(!muted);
    setMuted(!muted);
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const busy = phase === "connecting" || phase === "live" || phase === "debriefing";

  return (
    <main>
      <h1>Interview Simulator</h1>
      <p className="sub">Pick a scenario, adjust anything, then start talking. Say &ldquo;pause simulation&rdquo; to step out of character.</p>

      {error && <div className="card err">{error}</div>}

      {!busy && draft && (
        <div className="card">
          <div className="row">
            <div>
              <label>Scenario</label>
              <select value={selectedId} onChange={(e) => pick(e.target.value)}>
                {custom.length > 0 && (
                  <optgroup label="Saved edits (this browser)">
                    {custom.map((s) => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Presets">
                  {presets.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="actions" style={{ alignItems: "flex-end" }}>
              <button
                onClick={() => {
                  if (!jsonMode) setJsonText(JSON.stringify(draft, null, 2));
                  else {
                    try {
                      setDraft(JSON.parse(jsonText));
                    } catch (e) {
                      setError(`Invalid JSON: ${(e as Error).message}`);
                      return;
                    }
                  }
                  setJsonMode(!jsonMode);
                }}
              >
                {jsonMode ? "Back to form" : "Edit as JSON"}
              </button>
              <button onClick={saveAsCustom}>Save edits</button>
              {selectedId.startsWith("custom-") && <button onClick={deleteCustom}>Delete</button>}
            </div>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary big" onClick={start}>Start interview</button>
            <span className="pill">{draft.interviewers.length} interviewer{draft.interviewers.length > 1 ? "s" : ""}</span>
            <span className="pill">{draft.durationMinutes} min</span>
            <span className="pill">{draft.difficulty}</span>
          </div>
        </div>
      )}

      {!busy && draft && jsonMode && (
        <div className="card">
          <textarea style={{ minHeight: 520, fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
        </div>
      )}

      {!busy && draft && !jsonMode && (
        <>
          <div className="card">
            <h2>Setting</h2>
            <div className="row">
              <div>
                <label>Company</label>
                <input value={draft.company} onChange={(e) => update("company", e.target.value)} />
              </div>
              <div>
                <label>Role</label>
                <input value={draft.role} onChange={(e) => update("role", e.target.value)} />
              </div>
            </div>
            <div className="row3">
              <div>
                <label>Round</label>
                <input value={draft.round} onChange={(e) => update("round", e.target.value)} />
              </div>
              <div>
                <label>Minutes</label>
                <input type="number" min={3} max={90} value={draft.durationMinutes} onChange={(e) => update("durationMinutes", Number(e.target.value))} />
              </div>
              <div>
                <label>Difficulty</label>
                <select value={draft.difficulty} onChange={(e) => update("difficulty", e.target.value as Difficulty)}>
                  <option value="friendly">Friendly</option>
                  <option value="realistic">Realistic</option>
                  <option value="tough">Tough</option>
                </select>
              </div>
            </div>
            <label>Format</label>
            <textarea value={draft.format} onChange={(e) => update("format", e.target.value)} style={{ minHeight: 60 }} />
            <label>Company and role context (what the interviewers know)</label>
            <textarea value={draft.companyContext} onChange={(e) => update("companyContext", e.target.value)} style={{ minHeight: 140 }} />
            <label>Your resume as they see it</label>
            <textarea value={draft.candidateResume} onChange={(e) => update("candidateResume", e.target.value)} />
            <label>Opening line (optional)</label>
            <input value={draft.openingLine || ""} onChange={(e) => update("openingLine", e.target.value)} />
          </div>

          <div className="card">
            <h2>Interviewers</h2>
            <p className="muted" style={{ margin: 0 }}>The first one leads and opens the call. Up to 9.</p>
            <datalist id="voices">
              {voices.map((v) => (
                <option key={v.id} value={v.name}>{v.desc}</option>
              ))}
            </datalist>
            {draft.interviewers.map((iv, i) => (
              <div className="interviewer" key={i}>
                <div className="row3">
                  <div>
                    <label>Name</label>
                    <input value={iv.name} onChange={(e) => updateInterviewer(i, { name: e.target.value })} />
                  </div>
                  <div>
                    <label>Title</label>
                    <input value={iv.title} onChange={(e) => updateInterviewer(i, { title: e.target.value })} />
                  </div>
                  <div>
                    <label>Voice</label>
                    <input list="voices" value={iv.voice} onChange={(e) => updateInterviewer(i, { voice: e.target.value })} />
                  </div>
                </div>
                <label>Demeanor</label>
                <textarea style={{ minHeight: 56 }} value={iv.demeanor} onChange={(e) => updateInterviewer(i, { demeanor: e.target.value })} />
                <label>Style</label>
                <textarea style={{ minHeight: 56 }} value={iv.style} onChange={(e) => updateInterviewer(i, { style: e.target.value })} />
                <label>Topics they own (comma-separated)</label>
                <input value={iv.focus.join(", ")} onChange={(e) => updateInterviewer(i, { focus: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                {draft.interviewers.length > 1 && (
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button onClick={() => update("interviewers", draft.interviewers.filter((_, j) => j !== i))}>Remove</button>
                    {i > 0 && (
                      <button
                        onClick={() => {
                          const xs = [...draft.interviewers];
                          [xs[0], xs[i]] = [xs[i], xs[0]];
                          update("interviewers", xs);
                        }}
                      >
                        Make lead
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {draft.interviewers.length < 9 && (
              <button
                onClick={() =>
                  update("interviewers", [
                    ...draft.interviewers,
                    { name: "New Interviewer", title: "", voice: voices[draft.interviewers.length]?.name || "", demeanor: "", style: "", focus: [] },
                  ])
                }
              >
                + Add interviewer
              </button>
            )}
          </div>

          <div className="card">
            <h2>Script and scoring</h2>
            <label>Agenda (one per line)</label>
            <textarea value={listToText(draft.agenda)} onChange={(e) => update("agenda", textToList(e.target.value))} />
            <label>Questions to cover (one per line)</label>
            <textarea style={{ minHeight: 140 }} value={listToText(draft.likelyQuestions)} onChange={(e) => update("likelyQuestions", textToList(e.target.value))} />
            <label>Curveballs (one per line)</label>
            <textarea value={listToText(draft.curveballs)} onChange={(e) => update("curveballs", textToList(e.target.value))} />
            <label>Rubric: what strong looks like (one per line)</label>
            <textarea style={{ minHeight: 120 }} value={listToText(draft.rubric)} onChange={(e) => update("rubric", textToList(e.target.value))} />
            <label>My goals for this call (one per line)</label>
            <textarea value={listToText(draft.candidateGoals)} onChange={(e) => update("candidateGoals", textToList(e.target.value))} />
            <label>Facts and wording rules to check (one per line)</label>
            <textarea style={{ minHeight: 120 }} value={listToText(draft.factsToCheck)} onChange={(e) => update("factsToCheck", textToList(e.target.value))} />
            <label>Notion page ID for the debrief (optional)</label>
            <input value={draft.notionParentPageId || ""} onChange={(e) => update("notionParentPageId", e.target.value)} />
          </div>
        </>
      )}

      {(phase === "connecting" || phase === "live") && (
        <div className="card">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <div>
              <span className={`dot ${phase === "live" ? "live" : ""}`} />
              {phase === "connecting" ? "Setting up the interviewer…" : mode === "speaking" ? "Interviewer speaking" : "Listening"}
              <span className="muted"> · {mmss}</span>
            </div>
            <div className="actions">
              <button onClick={toggleMute} disabled={phase !== "live"}>{muted ? "Unmute" : "Mute"}</button>
              <button className="danger" onClick={finish}>End and debrief</button>
            </div>
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div className="card">
          <h2>Transcript</h2>
          <div className="transcript">
            {lines.map((l, i) => (
              <div key={i} className={`msg ${l.role}`}>
                <div className="who">{l.who}</div>
                {l.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      {phase === "debriefing" && <div className="card">Scoring your interview… this takes about a minute.</div>}

      {result && <DebriefView d={result.debrief} notionUrl={result.notionUrl} notionError={result.notionError} />}

      {phase === "done" && (
        <div className="actions">
          <button className="primary" onClick={() => setPhase("setup")}>Back to setup</button>
          <button onClick={start}>Run it again</button>
        </div>
      )}
    </main>
  );
}

function DebriefView({ d, notionUrl, notionError }: { d: Debrief; notionUrl: string | null; notionError: string | null }) {
  const tone = d.verdict === "Would advance" ? "good" : d.verdict === "Coin flip" ? "warn" : "bad";
  return (
    <div className="card">
      <div className="actions" style={{ gap: 16 }}>
        <div className={`score ${tone}`}>{d.score}/10</div>
        <div>
          <div className={tone} style={{ fontWeight: 700 }}>{d.verdict}</div>
          <div>{d.summary}</div>
        </div>
      </div>
      {notionUrl && (
        <p>
          Saved to Notion: <a href={notionUrl} target="_blank" rel="noreferrer">open debrief</a>
        </p>
      )}
      {notionError && <p className="err">Not saved to Notion: {notionError}</p>}

      <h3>What worked</h3>
      <ul>{d.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3>Fix before the real call</h3>
      {d.fixes.map((f, i) => (
        <details key={i} open={i < 2} style={{ margin: "8px 0" }}>
          <summary>{f.moment}</summary>
          <p><b>Issue:</b> {f.issue}</p>
          <p><b>Say instead:</b> {f.betterAnswer}</p>
        </details>
      ))}

      <h3>Fact and wording checks</h3>
      {d.factFlags.length ? (
        <ul>{d.factFlags.map((f, i) => <li key={i} className="bad">&ldquo;{f.said}&rdquo;: {f.problem}</li>)}</ul>
      ) : (
        <p className="good">Clean.</p>
      )}

      <h3>Goals for this call</h3>
      <ul>{d.goals.map((g, i) => <li key={i}>{g.hit ? "✅" : "❌"} {g.goal}{g.note ? <span className="muted">: {g.note}</span> : null}</li>)}</ul>

      <h3>Rubric</h3>
      <ul>{d.rubric.map((r, i) => <li key={i}><b>{r.score}/5</b> {r.criterion}{r.note ? <span className="muted">: {r.note}</span> : null}</li>)}</ul>

      <h3>Drill next</h3>
      <ul>{d.drillNext.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
