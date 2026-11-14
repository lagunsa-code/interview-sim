# Interview Simulator

Voice mock interviews on ElevenLabs Agents. Each scenario sets the company context, how many interviewers there are, and each interviewer's voice, demeanor and style. After the call it scores the transcript and saves a debrief to Notion.

## How it works
- One ElevenLabs agent named "Interview Simulator", created automatically on first use.
- Before each call, the app rewrites that agent for the chosen scenario: system prompt, opening line, lead voice, and one extra voice per additional interviewer (ElevenLabs multi-voice, up to 10 voices total).
- The browser talks to the agent over WebSocket with a signed URL. Your API key never leaves the server.
- When the call ends, the app pulls the transcript from ElevenLabs, grades it with Claude through Vercel AI Gateway, and saves a debrief page under the scenario's Notion page.

## Access
Protected by Vercel Authentication: only people signed in to your Vercel account can open it. Keep Deployment Protection on, since every call spends ElevenLabs credits.

## Environment variables (Vercel → Project → Settings → Environment Variables)
| Key | Required | What |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | yes | Needs ElevenLabs Agents read/write and Voices read permissions |
| `NOTION_TOKEN` | for Notion debriefs | Internal integration secret; share the Job Search Tracker with the integration |
| `ELEVENLABS_AGENT_ID` | no | Use an existing agent instead of auto-creating one |
| `DEBRIEF_MODEL` | no | AI Gateway model for scoring; default `anthropic/claude-opus-4.6` |

## Adding an interview
Copy a file in `/scenarios`, edit it, and register it in `lib/scenarios.ts`. Or edit any scenario in the app and click "Save edits" (stored in that browser).

During a call, say "pause simulation" to step out of character and "resume" to continue.
