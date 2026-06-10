// Snappy — SNAP's in-app AI support assistant (Task #17).
//
// Account-aware: Snappy can look up the asking facility's own operational
// context (roster size, sites, schedule status) via tools, then answer or
// escalate to a human (email matt@ + text the SNAP line) when it can't help.
//
// Design decisions (locked 2026-06-09):
//   - Model: Opus 4.8 — answer quality matters more than cost at pilot scale.
//   - Voice: friendly-professional, NO emoji.
//   - Surface: facility web portal first.
//   - PHI: tools expose OPERATIONAL data only (counts, site names, schedule
//     state) — never credential documents or anything clinical. No BAA yet.
//
// The chat endpoint runs a manual tool loop so tools execute server-side with
// the authenticated facility's context (req.facility), never trusting the
// client to say who it is.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../config/db');
const { sendEmail, sendSMS } = require('./notifications');

const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ITERATIONS = 5;

// Where escalations land. Overridable via env; defaults to Matt's SNAP line.
const SUPPORT_EMAIL = process.env.SNAPPY_SUPPORT_EMAIL || 'matt@snapmedical.app';
const SUPPORT_SMS = process.env.SNAPPY_SUPPORT_SMS || '6173834290';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const SYSTEM_PROMPT = `You are Snappy, the in-app support assistant for SNAP Medical — a staffing and credentialing platform for anesthesia providers (CRNAs, anesthesiologists, anesthesia assistants) and the surgical centers / ASCs they work in.

You are talking to a facility coordinator or administrator inside their SNAP web portal. Be warm, professional, and concise. Do not use emoji. Write like a knowledgeable colleague, not a chatbot.

What SNAP does, so you can help confidently:
- SNAP Shifts: facilities build OR schedules from their internal roster. The Schedule Builder offers four modes (Cost-Efficient, Highest Quality, Hybrid, and StaffIQ-decide) and supports anesthesia care-team models (MD-only, or CRNA rooms supervised by MDs at a 1:3 or 1:4 ratio).
- Internal roster: providers a facility imports (CSV/Excel or one at a time), matched by NPI. Providers can be invited to credentialing and to the marketplace.
- Gaps & Internal Shifts: detect unfilled coverage; offer "available" shifts (standard rate) or "incentive" shifts (premium rate) to roster providers who are off or on PTO that day. Unfilled internal shifts can be escalated to the external SNAP Marketplace.
- Availability & requests: providers set availability and per-date notes, and can request days off or to work specific dates; accepted requests shape the next schedule build.
- Provider Requests page: where coordinators approve or decline those requests.
- Credentialing: a verified provider "passport" the facility can consume; providers are invited from the roster.

How to help:
- For "how do I…" questions, give clear, specific steps referencing the actual page names above.
- When a question depends on the facility's own data (their roster, sites, or whether a schedule is built), USE YOUR TOOLS to look it up before answering. Do not guess their numbers.
- If you cannot resolve something — a bug, a billing question, anything outside the platform's features, or a request that needs a human — use the escalate_to_human tool. Tell the coordinator you have flagged it for the SNAP team and that Matt will follow up.

Hard rules:
- Never ask for or repeat protected health information (patient data) or specific provider credential documents. You handle operational support, not clinical or credential records.
- If you are not sure, say so and offer to escalate rather than inventing an answer.
- Keep replies short unless asked for detail.`;

// ── Tools ──────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_facility_overview',
    description:
      "Look up the asking facility's own operational snapshot: name, mode, subscription tier, how many providers are on the internal roster, and the configured sites/locations. Use when the coordinator asks about their setup, roster size, or sites.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_schedule_status',
    description:
      'Check whether a schedule has been built for a given month for this facility, and how many unfilled coverage gaps exist. Use for questions about scheduling progress or gaps. Month/year default to the current month.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Four-digit year, e.g. 2026' },
        month: { type: 'integer', description: 'Month 1-12' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Hand the conversation to the SNAP team (Matt) when you cannot resolve it: bugs, billing, account changes, anything outside platform features, or when the user asks for a person. Sends Matt an email and a text with a summary. Call this, then tell the user you have flagged it.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: "One or two sentences describing the user's issue for the SNAP team." },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'], description: 'How time-sensitive this is.' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
];

// ── Tool executors (run with the authenticated facility context) ────────────────

async function execTool(name, input, ctx) {
  const facilityId = ctx.facility?.id;
  if (name === 'get_facility_overview') {
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, snapMode: true, subscription: { select: { tier: true } } },
    });
    const [rosterCount, sites] = await Promise.all([
      prisma.internalRosterEntry.count({ where: { facilityId } }),
      // Distinct site/location names the facility schedules into.
      prisma.scheduleDay.findMany({ where: { facilityId }, select: { location: true }, distinct: ['location'] }),
    ]);
    return {
      name: facility?.name || 'your facility',
      mode: facility?.snapMode || 'MARKETPLACE',
      tier: facility?.subscription?.tier || 'BASIC',
      rosterProviders: rosterCount,
      sites: sites.map((s) => s.location).filter(Boolean),
    };
  }

  if (name === 'get_schedule_status') {
    const now = new Date();
    const year = input.year || now.getFullYear();
    const month = input.month || now.getMonth() + 1;
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const days = await prisma.scheduleDay.findMany({
      where: { facilityId, date: { gte: start, lt: end } },
      select: { publishedAt: true },
    });
    const published = days.filter((d) => d.publishedAt).length;
    // Open incentive/available shifts as a proxy for known gaps.
    const openShifts = await prisma.internalIncentiveShift.count({
      where: { facilityId, status: 'OPEN', shiftDate: { gte: start, lt: end } },
    });
    return {
      year, month,
      scheduleDays: days.length,
      published,
      hasSchedule: days.length > 0,
      openInternalShifts: openShifts,
    };
  }

  if (name === 'escalate_to_human') {
    const facilityName = ctx.facility?.name || 'A facility';
    const userEmail = ctx.userEmail || 'unknown';
    const transcript = (ctx.messages || [])
      .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : '[structured]'}`)
      .join('\n');
    const subject = `Snappy escalation — ${facilityName} (${input.urgency || 'normal'})`;
    const body = `${input.summary}\n\nFacility: ${facilityName}\nUser: ${userEmail}\n\n--- Conversation ---\n${transcript}`;
    // Fire both channels; never throw back into the model loop.
    try { await sendEmail(SUPPORT_EMAIL, subject, `<pre style="white-space:pre-wrap;font-family:inherit">${body.replace(/</g, '&lt;')}</pre>`); } catch (e) { console.error('[snappy] escalation email failed:', e.message); }
    try { await sendSMS(SUPPORT_SMS, `SNAP support: ${facilityName} — ${input.summary}`.slice(0, 300)); } catch (e) { console.error('[snappy] escalation SMS failed:', e.message); }
    return { escalated: true };
  }

  return { error: `Unknown tool: ${name}` };
}

// ── Provider-side Snappy (mobile app) ───────────────────────────────────────────
// The marketplace mobile app is provider-facing (CRNAs/anesthesiologists). This
// runs with the authenticated PROVIDER's context (ctx.userId); its tools only
// ever read that provider's own schedule across the facilities they belong to.

const PROVIDER_SYSTEM_PROMPT = `You are Snappy, the in-app assistant in the SNAP Medical app for anesthesia providers (CRNAs, anesthesiologists, anesthesia assistants).

You are talking to a provider inside their SNAP mobile app. Be warm, professional, and concise. Do not use emoji. Write like a helpful colleague.

What you can help with:
- Their work schedule: which days they are assigned, at which sites, across the facilities they work with on SNAP.
- How the app works: My Schedule, setting availability and per-day notes, requesting a day off or to work a date (the Request feature), the notifications inbox, and picking up available/incentive shifts they are offered.
- General questions about SNAP.

How to help:
- When a question depends on the provider's own schedule, USE YOUR TOOLS to look it up before answering. Never guess their assignments or dates.
- For "how do I..." questions, give clear steps referencing the app's actual features above.
- If you cannot resolve something — a bug, a pay/contract question, anything needing a person — use escalate_to_human, then tell them you've flagged it for the SNAP team and Matt will follow up.

Hard rules:
- Never ask for or repeat protected health information (patient data). You handle scheduling and app support only.
- If you are not sure, say so and offer to escalate rather than inventing an answer.
- Keep replies short unless asked for detail.`;

const PROVIDER_TOOLS = [
  {
    name: 'get_my_schedule',
    description: "Look up the asking provider's own assignments for a month across all facilities they work with: dates, sites, and total shifts. Month/year default to the current month.",
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Four-digit year, e.g. 2026' },
        month: { type: 'integer', description: 'Month 1-12' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_my_facilities',
    description: "List the facilities this provider works with on SNAP (the rosters they are on). Use for 'where do I work' / 'which facilities am I on' questions.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'escalate_to_human',
    description: 'Hand the conversation to the SNAP team (Matt) when you cannot resolve it: bugs, pay/contract questions, account changes, or when the provider asks for a person. Sends Matt an email and a text. Call this, then tell the user you have flagged it.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: "One or two sentences describing the provider's issue for the SNAP team." },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'], description: 'How time-sensitive this is.' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
];

async function execProviderTool(name, input, ctx) {
  // The provider's roster memberships (one InternalRosterEntry per facility).
  async function memberships() {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: ctx.userId }, select: { id: true },
    });
    if (!provider) return [];
    return prisma.internalRosterEntry.findMany({
      where: { linkedProviderId: provider.id },
      select: { id: true, facilityId: true, facility: { select: { name: true } } },
    });
  }

  if (name === 'get_my_facilities') {
    const mems = await memberships();
    return { facilities: mems.map((m) => m.facility?.name).filter(Boolean) };
  }

  if (name === 'get_my_schedule') {
    const mems = await memberships();
    if (mems.length === 0) return { assignments: [], note: 'Not yet linked to any facility roster.' };
    const now = new Date();
    const year = input.year || now.getFullYear();
    const month = input.month || now.getMonth() + 1;
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const rosterIds = mems.map((m) => m.id);
    const facilityById = new Map(mems.map((m) => [m.facilityId, m.facility?.name]));
    const assignments = await prisma.scheduleAssignment.findMany({
      where: { rosterId: { in: rosterIds }, scheduleDay: { date: { gte: start, lt: end } } },
      include: { scheduleDay: { select: { date: true, location: true } } },
      orderBy: { scheduleDay: { date: 'asc' } },
    });
    return {
      year, month,
      totalShifts: assignments.length,
      assignments: assignments.map((a) => ({
        date: a.scheduleDay.date.toISOString().slice(0, 10),
        site: a.scheduleDay.location,
        facility: facilityById.get(a.facilityId) || null,
      })),
    };
  }

  if (name === 'escalate_to_human') {
    return escalateToHuman(input, ctx, ctx.userEmail ? `Provider ${ctx.userEmail}` : 'A provider');
  }

  return { error: `Unknown tool: ${name}` };
}

// Shared escalation (email + SMS to the SNAP team). Never throws into the loop.
async function escalateToHuman(input, ctx, who) {
  const userEmail = ctx.userEmail || 'unknown';
  const transcript = (ctx.messages || [])
    .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : '[structured]'}`)
    .join('\n');
  const subject = `Snappy escalation — ${who} (${input.urgency || 'normal'})`;
  const body = `${input.summary}\n\nFrom: ${who}\nUser: ${userEmail}\n\n--- Conversation ---\n${transcript}`;
  try { await sendEmail(SUPPORT_EMAIL, subject, `<pre style="white-space:pre-wrap;font-family:inherit">${body.replace(/</g, '&lt;')}</pre>`); } catch (e) { console.error('[snappy] escalation email failed:', e.message); }
  try { await sendSMS(SUPPORT_SMS, `SNAP support: ${who} — ${input.summary}`.slice(0, 300)); } catch (e) { console.error('[snappy] escalation SMS failed:', e.message); }
  return { escalated: true };
}

// ── Generic chat loop ───────────────────────────────────────────────────────────
// messages: [{ role: 'user'|'assistant', content: string }, ...] from the client.
// ctx carries audience context (facility OR provider) for the tool executor.
async function runConversation({ messages, ctx, system, tools, exec }) {
  const anthropic = getClient();
  if (!anthropic) {
    return { reply: "Snappy isn't configured yet — the SNAP team needs to add the assistant key. You can reach Matt at matt@snapmedical.app in the meantime.", escalated: false };
  }

  const convo = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-20); // cap history
  ctx.messages = convo; // for escalate transcript

  let escalated = false;
  let working = [...convo];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024, system, tools, messages: working,
    });

    if (resp.stop_reason === 'tool_use') {
      const toolUses = resp.content.filter((b) => b.type === 'tool_use');
      working.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        if (tu.name === 'escalate_to_human') escalated = true;
        let out;
        try { out = await exec(tu.name, tu.input || {}, ctx); }
        catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      working.push({ role: 'user', content: results });
      continue;
    }

    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { reply: text || "I'm not sure how to help with that — want me to flag it for the SNAP team?", escalated };
  }

  return { reply: "I'm having trouble pulling that together. I can flag this for the SNAP team if you'd like — just say the word.", escalated };
}

// Facility-side (web portal): tools read the authenticated facility's data.
function chat({ messages, ctx }) {
  return runConversation({ messages, ctx, system: SYSTEM_PROMPT, tools: TOOLS, exec: execTool });
}

// Provider-side (mobile app): tools read the authenticated provider's data.
function providerChat({ messages, ctx }) {
  return runConversation({ messages, ctx, system: PROVIDER_SYSTEM_PROMPT, tools: PROVIDER_TOOLS, exec: execProviderTool });
}

module.exports = { chat, providerChat };
