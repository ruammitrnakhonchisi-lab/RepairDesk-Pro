#!/usr/bin/env node
// Fix: the first week-plan seed (seed-pm-schedules-weekplan.mjs) gave every
// machine in the same "week group" the exact same next_due_date (that
// week's Monday), instead of spreading them across the week the way the
// original paper Week 1-4 sheets did (different machines on different
// weekdays). Real usage since then made this visible — once a whole
// group gets checked together on one visit, the monthly cycle keeps
// re-clustering them onto the same day every month (e.g. 12 machines
// all landing on the same date).
//
// This recomputes next_due_date for those 39 machines using the
// original day-of-week assignment from the paper sheets, anchored to
// the coming Monday, so the due-list spreads across the week instead
// of dumping everything on one day. Only touches next_due_date — does
// not touch history (pm_records) or the 2 schedules the user created
// by hand (เครนเบอร์ 1, เครนเบอร์ 2), which are left alone.
//
// Usage: node scripts/redistribute-pm-schedule-dates.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const SUPABASE_URL = configSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const SUPABASE_ANON_KEY = configSrc.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];

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

// week -> dayOffset (0=Mon..5=Sat) -> machine names
const PLAN = {
  1: {
    0: ['แพล้น 2', 'ปั้มลม แพล้น2'],
    2: ['เครนเบอร์ 9', 'เครนเบอร์ 11'],
    3: ['เครนเบอร์ 10', 'เครนเบอร์ 12'],
    4: ['เครื่องดึงลวด 5 (เสาใหญ่)', 'เครื่องดึงลวด 6 (เสาใหญ่ 5 มม.)'],
    5: ['เครื่องดัดหูยกเสาเข็ม'],
  },
  2: {
    0: ['เครนเบอร์ 5', 'เครนเบอร์ 6'],
    1: ['แท่นเขย่าคอนกรีต', 'ปั้มลม เสหกเหลี่ยม', 'เครนเบอร์ 7', 'เครนเบอร์ 8'],
    2: ['เครื่องดึงลวด 2 (เสาหกเหลี่ยม)', 'เครื่องยั้มหัวลวด (หกเหลี่ยม)'],
    3: ['ปั้มลม แผ่นรั้ว', 'เครื่องดึงแกน ผนังรั้ว'],
    4: ['เครื่องดึงลวด 1 (แผ่นรั้ว)', 'เครื่องยั้มหัวลวด (แผ่นรั้ว)'],
    5: ['เครื่องฉีดน้ำมันทาแบบ', 'เครื่องดึงแกน หกเหลี่ยม'],
  },
  3: {
    0: ['เครนเบอร์ 3', 'เครนเบอร์ 4'],
    1: ['เครื่องเขย่าหน้าคอนกรีตแผ่นพื้น'],
    2: ['เครื่องอัดแหวน (เอ๋)', 'เครื่องปั่นแหวน (เอ๋1)'],
    3: ['เครื่องอัดแหวน (หมับ)', 'เครื่องปั่นแหวน (เอ๋2)'],
    4: ['เครื่องปั่นแหวน (หมับ)', 'เครื่องปั่นแหนว (หมับ)'],
    5: ['เครื่องดึงลวด 3 (แผ่นพื้น)'],
  },
  4: {
    0: ['แพล้น 1', 'ปั้มลม แพล้น1'],
    // เครนเบอร์ 1 / 2 intentionally omitted — user-managed schedules, left untouched
    3: ['เครนเบอร์ 13', 'เครื่องตััดลวด อัตโนมัติ'],
    4: ['เครื่องดึงลวด 4 (เสาเล็ก)'],
    5: ['ปั้มลม ซ่อมบำรุง'],
  },
};

function nextMonday(from) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const day = d.getUTCDay();
  const add = day === 1 ? 0 : ((8 - day) % 7);
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}
function ymd(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0'); }

const weekBase = nextMonday(new Date());
const updates = []; // { machine, date }
for (const [week, byDay] of Object.entries(PLAN)) {
  const weekStart = new Date(weekBase.getTime() + (Number(week) - 1) * 7 * 864e5);
  for (const [offset, machines] of Object.entries(byDay)) {
    const date = ymd(new Date(weekStart.getTime() + Number(offset) * 864e5));
    machines.forEach(m => updates.push({ machine: m, date }));
  }
}

console.log(`Redistributing ${updates.length} schedules across ${new Set(updates.map(u=>u.date)).size} distinct days (was clustered onto as few as 4-6 days).`);

const existing = await sb('pm_schedules', { query: '?select=id,machine_name' });
const idByMachine = Object.fromEntries(existing.map(s => [s.machine_name, s.id]));

let updated = 0, missing = [];
for (const u of updates) {
  const id = idByMachine[u.machine];
  if (!id) { missing.push(u.machine); continue; }
  await sb('pm_schedules', { method: 'PATCH', query: `?id=eq.${id}`, body: { next_due_date: u.date }, prefer: 'return=minimal' });
  updated++;
}

console.log(`Updated ${updated} schedules.`);
if (missing.length) console.log('No active schedule found for (skipped):', missing);

const check = await sb('pm_schedules', { query: '?select=machine_name,next_due_date&order=next_due_date' });
const byDate = {};
check.forEach(s => { (byDate[s.next_due_date] ||= []).push(s.machine_name); });
console.log('\nNew distribution:');
Object.entries(byDate).forEach(([date, names]) => console.log(`  ${date}: ${names.length} machine(s) — ${names.join(', ')}`));
