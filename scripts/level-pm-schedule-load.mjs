#!/usr/bin/env node
// Re-levels PM due dates. Because PM schedules recur monthly from the day
// they were actually checked, checking several machines in one trip makes
// them re-land on the same day every month (and a +1 month jump can land on
// a Sunday). This moves the overflow back onto the nearest Mon-Sat day that
// has capacity, so no technician day exceeds CAP machines.
//
// Only touches next_due_date of active schedules due from tomorrow onward
// (never overdue/today items, never check history). Re-run any time.
// Usage: node scripts/level-pm-schedule-load.mjs [--cap=3] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const SUPABASE_URL = configSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const SUPABASE_ANON_KEY = configSrc.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const CAP = Number((process.argv.find(a => a.startsWith('--cap=')) || '--cap=3').split('=')[1]);
const DRY = process.argv.includes('--dry-run');

async function sb(table, { method = 'GET', body, query = '', prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${table} -> ${res.status}: ${await res.text()}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

const ms = 864e5;
const ymd = d => d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
const parse = s => new Date(s + 'T00:00:00Z');
const isSunday = s => parse(s).getUTCDay() === 0;

const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const tomorrow = ymd(new Date(today.getTime() + ms));

const all = await sb('pm_schedules', { query: '?select=id,machine_name,next_due_date,active&order=id&limit=1000' });
const active = all.filter(s => s.active !== false && s.next_due_date);
const movable = active.filter(s => s.next_due_date >= tomorrow);

const load = {};
active.forEach(s => { load[s.next_due_date] = (load[s.next_due_date] || 0) + 1; });

const maxDate = movable.reduce((m, s) => s.next_due_date > m ? s.next_due_date : m, tomorrow);
const pool = [];
for (let t = parse(tomorrow).getTime(); t <= parse(maxDate).getTime() + 7 * ms; t += ms) {
  const d = ymd(new Date(t));
  if (!isSunday(d)) pool.push(d);
}
pool.forEach(d => load[d] ||= 0);

const dist = (a, b) => Math.abs(parse(a).getTime() - parse(b).getTime()) / ms;

// Sunday items must move; then items past CAP on a day move (keep the first CAP in id order).
const toMove = [];
const seen = {};
for (const s of movable.sort((a, b) => a.id - b.id)) {
  seen[s.next_due_date] = (seen[s.next_due_date] || 0) + 1;
  if (isSunday(s.next_due_date) || seen[s.next_due_date] > CAP) toMove.push(s);
}
toMove.forEach(s => { load[s.next_due_date]--; });

const moves = [];
for (const s of toMove) {
  let best = null;
  for (const radius of [4, 8, 14, 30]) {
    const cands = pool.filter(d => dist(d, s.next_due_date) <= radius && load[d] < CAP);
    if (cands.length) { best = cands.sort((a, b) => load[a] - load[b] || dist(a, s.next_due_date) - dist(b, s.next_due_date))[0]; break; }
  }
  if (!best) best = pool.reduce((m, d) => load[d] < load[m] ? d : m, pool[0]);
  load[best]++;
  moves.push({ id: s.id, machine: s.machine_name, from: s.next_due_date, to: best });
}

console.log(`Cap ${CAP}/day. ${toMove.length} of ${movable.length} upcoming schedules need moving.`);
moves.forEach(m => console.log(`  ${m.machine}: ${m.from} -> ${m.to}`));
if (DRY) { console.log('\n(dry run — nothing changed)'); process.exit(0); }

for (const m of moves) {
  await sb('pm_schedules', { method: 'PATCH', query: `?id=eq.${m.id}`, body: { next_due_date: m.to }, prefer: 'return=minimal' });
}
const final = await sb('pm_schedules', { query: '?select=next_due_date&active=eq.true&limit=1000' });
const byDay = {};
final.forEach(s => { byDay[s.next_due_date] = (byDay[s.next_due_date] || 0) + 1; });
console.log(`\nDone. Busiest day now: ${Math.max(...Object.values(byDay))} machine(s); Sunday dates: ${Object.keys(byDay).filter(d => isSunday(d)).length}.`);
