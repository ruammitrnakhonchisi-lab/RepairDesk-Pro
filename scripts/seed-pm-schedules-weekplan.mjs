#!/usr/bin/env node
// One-time setup: recreates the old paper "Week 1-4" PM rotation
// (from ฟอร์มบันทึกการดูแลเครื่องจักร(ประจำเดือน).xlsx) as real PM
// schedules in Supabase. The paper sheets spread PM work for ~40
// pieces of equipment across 4 weeks of the month so nothing bunches
// up at month-end; here that becomes: each machine gets a "monthly"
// PM schedule whose next_due_date lands in its assigned week
// (week 1 = the coming Monday, week 2 = +7 days, etc.), so the same
// weekly spread repeats every month automatically.
//
// Safe to re-run: skips any machine that already has an active PM
// schedule (never overwrites something set up by hand), and upserts
// machines by name.
//
// Usage: node scripts/seed-pm-schedules-weekplan.mjs

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

const CHECKLIST_CRANE = 'เครน (ตรวจรายเดือน ละเอียด)';
const CHECKLIST_PLANT = 'แพล้น/เครื่องผสมคอนกรีต (ตรวจรายเดือน ละเอียด)';
const CHECKLIST_COMPRESSOR = 'ปั๊มลม (PM)';
const CHECKLIST_WIRE = 'เครื่องดึงลวด/เครื่องย้ำลวด (PM)';
const CHECKLIST_GENERAL = 'เครื่องจักรทั่วไป (PM)';

// week -> [{ machine, checklist, isNewMachine? }]
// Machine names mapped to the master "รายการ" sheet's existing spelling
// where a clear match exists (by number + location suffix); a few names
// on the paper schedule don't appear in the master equipment list at
// all, so those are added as new machines (flagged in the summary).
const PLAN = {
  1: [ // สัปดาห์ที่ 1 — แพล้น 2, โรงผลิตเสาใหญ่, รถไฟขนส่งปูน
    { machine: 'แพล้น 2', checklist: CHECKLIST_PLANT },
    { machine: 'ปั้มลม แพล้น2', checklist: CHECKLIST_COMPRESSOR },
    { machine: 'เครนเบอร์ 9', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 11', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 10', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 12', checklist: CHECKLIST_CRANE },
    { machine: 'เครื่องดึงลวด 5 (เสาใหญ่)', checklist: CHECKLIST_WIRE },
    { machine: 'เครื่องดึงลวด 6 (เสาใหญ่ 5 มม.)', checklist: CHECKLIST_WIRE },
    { machine: 'เครื่องดัดหูยกเสาเข็ม', checklist: CHECKLIST_GENERAL, isNew: true },
  ],
  2: [ // สัปดาห์ที่ 2 — โรงผลิตแผ่นรั้ว, โรงผลิตเสาหกเหลี่ยม
    { machine: 'เครนเบอร์ 5', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 6', checklist: CHECKLIST_CRANE },
    { machine: 'แท่นเขย่าคอนกรีต', checklist: CHECKLIST_GENERAL, isNew: true },
    { machine: 'ปั้มลม เสหกเหลี่ยม', checklist: CHECKLIST_COMPRESSOR },
    { machine: 'เครนเบอร์ 7', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 8', checklist: CHECKLIST_CRANE },
    { machine: 'เครื่องดึงลวด 2 (เสาหกเหลี่ยม)', checklist: CHECKLIST_WIRE },
    { machine: 'เครื่องยั้มหัวลวด (หกเหลี่ยม)', checklist: CHECKLIST_WIRE },
    { machine: 'ปั้มลม แผ่นรั้ว', checklist: CHECKLIST_COMPRESSOR },
    { machine: 'เครื่องดึงแกน ผนังรั้ว', checklist: CHECKLIST_WIRE, isNew: true },
    { machine: 'เครื่องดึงลวด 1 (แผ่นรั้ว)', checklist: CHECKLIST_WIRE },
    { machine: 'เครื่องยั้มหัวลวด (แผ่นรั้ว)', checklist: CHECKLIST_WIRE },
    { machine: 'เครื่องฉีดน้ำมันทาแบบ', checklist: CHECKLIST_GENERAL, isNew: true },
    { machine: 'เครื่องดึงแกน หกเหลี่ยม', checklist: CHECKLIST_WIRE, isNew: true },
  ],
  3: [ // สัปดาห์ที่ 3 — โรงผลิตเสาเล็ก, ผลิตเหล็กปอก
    { machine: 'เครนเบอร์ 3', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 4', checklist: CHECKLIST_CRANE },
    { machine: 'เครื่องเขย่าหน้าคอนกรีตแผ่นพื้น', checklist: CHECKLIST_GENERAL, isNew: true },
    // "No.1-4" on the paper sheet couldn't be matched to the master list
    // with certainty (which physical เอ๋/หมับ unit is "No.1" vs "No.2");
    // mapped by listed order — verify against the machines and relabel if wrong.
    { machine: 'เครื่องอัดแหวน (เอ๋)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องอัด ปอกแหวน No.1' },
    { machine: 'เครื่องอัดแหวน (หมับ)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องอัด ปอกแหวน No.2' },
    { machine: 'เครื่องปั่นแหวน (เอ๋1)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องปั่น ปอกแหวน No.1' },
    { machine: 'เครื่องปั่นแหวน (เอ๋2)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องปั่น ปอกแหวน No.2' },
    { machine: 'เครื่องปั่นแหวน (หมับ)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องปั่น ปอกแหวน No.3' },
    { machine: 'เครื่องปั่นแหนว (หมับ)', checklist: CHECKLIST_GENERAL, uncertain: 'เครื่องปั่น ปอกแหวน No.4' },
    { machine: 'เครื่องดึงลวด 3 (แผ่นพื้น)', checklist: CHECKLIST_WIRE },
  ],
  4: [ // สัปดาห์ที่ 4 — โรงผลิตแผ่นพื้น, สต๊อค Pc-wire
    { machine: 'แพล้น 1', checklist: CHECKLIST_PLANT },
    { machine: 'ปั้มลม แพล้น1', checklist: CHECKLIST_COMPRESSOR },
    { machine: 'เครนเบอร์ 1', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 2', checklist: CHECKLIST_CRANE },
    { machine: 'เครนเบอร์ 13', checklist: CHECKLIST_CRANE },
    { machine: 'เครื่องตััดลวด อัตโนมัติ', checklist: CHECKLIST_GENERAL },
    { machine: 'เครื่องดึงลวด 4 (เสาเล็ก)', checklist: CHECKLIST_WIRE },
    { machine: 'ปั้มลม ซ่อมบำรุง', checklist: CHECKLIST_COMPRESSOR },
  ],
};

function nextMonday(from) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const add = day === 1 ? 0 : ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + (day === 1 ? 0 : add));
  return d;
}
function ymd(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0'); }

const weekBase = nextMonday(new Date());
const weekDueDate = { 1: ymd(weekBase), 2: ymd(new Date(weekBase.getTime()+7*864e5)), 3: ymd(new Date(weekBase.getTime()+14*864e5)), 4: ymd(new Date(weekBase.getTime()+21*864e5)) };
console.log('Due dates by week:', weekDueDate);

const [machines, checklists, existingSchedules] = await Promise.all([
  sb('machines', { query: '?select=name' }),
  sb('pm_checklists', { query: '?select=id,name' }),
  sb('pm_schedules', { query: '?select=machine_name,active' }),
]);
const machineNames = new Set(machines.map(m => m.name));
const checklistIdByName = Object.fromEntries(checklists.map(c => [c.name, c.id]));
const scheduledMachines = new Set(existingSchedules.filter(s => s.active !== false).map(s => s.machine_name));

const toCreateMachines = [];
const toCreateSchedules = [];
const skipped = [];
const uncertainMappings = [];

for (const [week, entries] of Object.entries(PLAN)) {
  for (const e of entries) {
    if (scheduledMachines.has(e.machine)) { skipped.push(e.machine + ' (already has an active PM schedule)'); continue; }
    if (!machineNames.has(e.machine)) { toCreateMachines.push(e.machine); machineNames.add(e.machine); }
    const checklistId = checklistIdByName[e.checklist];
    if (!checklistId) { skipped.push(e.machine + ` (checklist "${e.checklist}" not found)`); continue; }
    toCreateSchedules.push({ machine_name: e.machine, checklist_id: checklistId, frequency: 'monthly', next_due_date: weekDueDate[week] });
    if (e.uncertain) uncertainMappings.push(`${e.uncertain}  ->  ${e.machine}`);
  }
}

if (toCreateMachines.length) {
  await sb('machines', {
    method: 'POST', query: '?on_conflict=name',
    body: toCreateMachines.map(name => ({ name })),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}
if (toCreateSchedules.length) {
  await sb('pm_schedules', { method: 'POST', body: toCreateSchedules, prefer: 'return=minimal' });
}

console.log(`\nCreated ${toCreateMachines.length} new machines:`, toCreateMachines);
console.log(`Created ${toCreateSchedules.length} PM schedules.`);
if (skipped.length) console.log(`\nSkipped (${skipped.length}):`, skipped);
if (uncertainMappings.length) {
  console.log(`\n⚠️  These mappings were guessed from list order — verify against the physical machines:`);
  uncertainMappings.forEach(m => console.log('  ' + m));
}
