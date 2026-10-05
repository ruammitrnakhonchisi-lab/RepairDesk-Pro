#!/usr/bin/env node
// Gap-filler: the paper Week 1-4 rotation only covered plant/crane/wire
// equipment, so vehicles (trucks, trailers, forklift, loader, backhoe,
// อีแต๋น, ...) never got a PM schedule. This gives every machine that has
// no active schedule a monthly one using the "ยานพาหนะ (ของเหลว/ระบบพื้นฐาน)"
// checklist, assigning each to the least-loaded weekday in the coming
// 4 weeks so the technicians' daily PM load stays even.
//
// Safe to re-run: only touches machines with no active PM schedule.
// Usage: node scripts/seed-pm-schedules-missing-machines.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const SUPABASE_URL = configSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const SUPABASE_ANON_KEY = configSrc.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const CHECKLIST_NAME = 'ยานพาหนะ (ของเหลว/ระบบพื้นฐาน)';

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

function ymd(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0'); }

const [machines, schedules, checklists] = await Promise.all([
  sb('machines', { query: '?select=name&order=name&limit=1000' }),
  sb('pm_schedules', { query: '?select=machine_name,next_due_date,active&limit=1000' }),
  sb('pm_checklists', { query: '?select=id,name' }),
]);
const checklist = checklists.find(c => c.name === CHECKLIST_NAME);
if (!checklist) throw new Error(`Checklist "${CHECKLIST_NAME}" not found — run seed-pm-checklists.mjs first`);

const active = schedules.filter(s => s.active !== false);
const scheduled = new Set(active.map(s => s.machine_name));
const missing = machines.map(m => m.name).filter(n => !scheduled.has(n));
if (!missing.length) { console.log('Every machine already has an active PM schedule.'); process.exit(0); }

// candidate days: Mon-Sat over the next 28 days, starting tomorrow
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const days = [];
for (let i = 1; i <= 28; i++) {
  const d = new Date(today.getTime() + i * 864e5);
  if (d.getUTCDay() !== 0) days.push(ymd(d));
}
const load = Object.fromEntries(days.map(d => [d, 0]));
active.forEach(s => { if (s.next_due_date in load) load[s.next_due_date]++; });

const rows = [];
for (const name of missing) {
  const day = days.reduce((best, d) => load[d] < load[best] ? d : best, days[0]); // earliest day wins ties
  load[day]++;
  rows.push({ machine_name: name, checklist_id: checklist.id, frequency: 'monthly', next_due_date: day });
}

await sb('pm_schedules', { method: 'POST', body: rows, prefer: 'return=minimal' });
console.log(`Created ${rows.length} PM schedules (checklist: ${CHECKLIST_NAME}, monthly).`);
const byDay = {};
rows.forEach(r => (byDay[r.next_due_date] ||= []).push(r.machine_name));
Object.entries(byDay).sort().forEach(([d, n]) => console.log(`  ${d}: ${n.join(', ')}`));
const maxLoad = Math.max(...Object.values(load));
console.log(`\nBusiest day across all schedules in the window: ${maxLoad} machine(s).`);
