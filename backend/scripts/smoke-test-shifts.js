#!/usr/bin/env node
/**
 * Dress-rehearsal smoke test for the SNAP Shifts pilot.
 *
 * Verifies that every critical endpoint a CAPA coordinator will hit on day
 * one returns sane data, with sane errors when fed garbage. NOT a load test;
 * not a behavioral test — just confidence that the wiring survives.
 *
 * Usage:
 *   API_BASE=https://your-api.up.railway.app/api \
 *   FACILITY_EMAIL=coord@capa.example FACILITY_PASSWORD='...' \
 *   node scripts/smoke-test-shifts.js
 *
 * Defaults: API_BASE=http://localhost:3001/api (matches `npm run dev`).
 *
 * Safe to run against production — every probe is either read-only or
 * deliberately rejected (sends "DELETE ALL" with a bogus payload-guard so
 * the route 400s, NEVER actually clearing the roster).
 *
 * Each check prints PASS/FAIL with a short reason. Exits 1 if any FAIL.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const EMAIL = process.env.FACILITY_EMAIL;
const PASSWORD = process.env.FACILITY_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('FACILITY_EMAIL and FACILITY_PASSWORD env vars are required.');
  process.exit(2);
}

let token = null;
let pass = 0;
let fail = 0;
const failures = [];

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function check(name, fn) {
  process.stdout.write(`  ${pad(name, 56)} `);
  try {
    const note = await fn();
    pass++;
    console.log(`✓ PASS${note ? ` — ${note}` : ''}`);
  } catch (err) {
    fail++;
    failures.push({ name, err: err.message });
    console.log(`✗ FAIL — ${err.message}`);
  }
}

async function call(method, path, { body, expectStatus = 200, includeAuth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (includeAuth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (res.status !== expectStatus) {
    throw new Error(`expected HTTP ${expectStatus}, got ${res.status} — ${typeof data === 'string' ? data.slice(0, 160) : (data.error || JSON.stringify(data).slice(0, 160))}`);
  }
  return data;
}

// ── Test phases ──────────────────────────────────────────────────────────

async function loginPhase() {
  console.log('\n[login]');
  await check('POST /auth/facility/login (good creds)', async () => {
    const data = await call('POST', '/auth/facility/login', {
      body: { email: EMAIL, password: PASSWORD },
      includeAuth: false,
    });
    if (!data.token) throw new Error('no token in response');
    token = data.token;
    return `facility: ${data.facility?.name || 'unnamed'}`;
  });
  await check('POST /auth/facility/login (bad creds → 401)', () =>
    call('POST', '/auth/facility/login', {
      body: { email: EMAIL, password: 'definitely-wrong' },
      includeAuth: false,
      expectStatus: 401,
    })
  );
  await check('GET /roster (no token → 401)', () =>
    call('GET', '/roster', { expectStatus: 401, includeAuth: false })
  );
}

async function readPhase() {
  console.log('\n[reads]');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  await check('GET /facilities/me', async () => {
    const data = await call('GET', '/facilities/me');
    if (!data.id) throw new Error('no facility id');
    return `rate $${data.industryRoomRatePerDay || 0}/room/day`;
  });
  await check('GET /roster', async () => {
    const data = await call('GET', '/roster');
    if (!Array.isArray(data)) throw new Error('expected array');
    return `${data.length} providers`;
  });
  await check('GET /roster/locations', async () => {
    const data = await call('GET', '/roster/locations');
    if (!Array.isArray(data?.locations)) throw new Error('expected {locations:[]}');
    return `${data.locations.length} sites`;
  });
  await check('GET /roster/npi-review', async () => {
    const data = await call('GET', '/roster/npi-review');
    if (!data || typeof data !== 'object') throw new Error('expected object');
    return `${(data.rows || []).length} needing review`;
  });
  await check(`GET /schedule?year=${year}&month=${month}`, async () => {
    const data = await call('GET', `/schedule?year=${year}&month=${month}`);
    const days = data?.days?.length ?? (Array.isArray(data) ? data.length : 0);
    return `${days} schedule days this month`;
  });
  await check(`GET /schedule/summary?year=${year}&month=${month}`, async () => {
    const data = await call('GET', `/schedule/summary?year=${year}&month=${month}`);
    if (typeof data.estimatedCost !== 'number') throw new Error('estimatedCost not a number');
    return `cost $${data.estimatedCost}, ${data.totalShifts || 0} rooms, ${data.defaultRateProviders || 0} on default rate`;
  });
  await check('GET /staffiq/intelligence', () => call('GET', '/staffiq/intelligence'));
  await check('GET /coverage-templates', async () => {
    const data = await call('GET', '/coverage-templates');
    const n = (data?.templates || []).length;
    return `${n} templates`;
  });
}

async function validationPhase() {
  console.log('\n[validation guards — should all 400/404]');
  await check('POST /windows / with no body → 400', () =>
    call('POST', '/windows', { body: {}, expectStatus: 400 })
  );
  await check('POST /schedule/days with no body → 400', () =>
    call('POST', '/schedule/days', { body: {}, expectStatus: 400 })
  );
  await check('POST /roster/clear-all without confirm → 400', () =>
    call('POST', '/roster/clear-all', { body: {}, expectStatus: 400 })
  );
  await check('POST /roster/clear-all with WRONG confirm → 400', () =>
    call('POST', '/roster/clear-all', { body: { confirm: 'delete all' }, expectStatus: 400 })
  );
  await check('POST /roster/bulk-delete with no ids → 400', () =>
    call('POST', '/roster/bulk-delete', { body: { confirm: 'DELETE SELECTED' }, expectStatus: 400 })
  );
  await check('POST /roster/bulk-delete without confirm → 400', () =>
    call('POST', '/roster/bulk-delete', { body: { ids: ['x'] }, expectStatus: 400 })
  );
  await check('GET /schedule/summary with bad month → 400', () =>
    call('GET', '/schedule/summary?year=2026&month=13', { expectStatus: 400 })
  );
}

async function safeMutationPhase() {
  console.log('\n[safe mutations — exercise routes without changing data]');
  await check('POST /roster/bulk-delete with bogus ID (intersection guard)', async () => {
    const data = await call('POST', '/roster/bulk-delete', {
      body: { confirm: 'DELETE SELECTED', ids: ['this-id-does-not-exist-xyz'] },
    });
    if (data.rosterDeleted !== 0) throw new Error(`unexpected delete count: ${data.rosterDeleted}`);
    return 'rosterDeleted=0 ✓';
  });
}

async function main() {
  console.log(`Smoke test against ${API_BASE}\n`);
  try {
    await loginPhase();
    if (!token) throw new Error('login failed; cannot continue');
    await readPhase();
    await validationPhase();
    await safeMutationPhase();
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.name} — ${f.err}`);
    process.exit(1);
  }
}

main();
