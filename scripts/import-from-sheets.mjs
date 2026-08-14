#!/usr/bin/env node
// One-time importer: reads CSV exports of the old Google Sheet tabs and
// bulk-loads them into Supabase. Run locally with plain Node (18+), no
// npm install needed — uses global fetch and a hand-rolled CSV parser.
//
// Usage:
//   node scripts/import-from-sheets.mjs
//
// Expects (any subset is fine, missing files are skipped):
//   import/jobs.csv       — the "ใบแจ้งซ่อม" tab
//   import/machines.csv   — the "รายการ" tab
//   import/techs.csv      — the "ช่าง" tab

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const SUPABASE_URL = configSrc.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const SUPABASE_ANON_KEY = configSrc.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];

if (SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
  console.error('config.js still has placeholder values — fill in SUPABASE_URL / SUPABASE_ANON_KEY first.');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text).filter(r => r.some(v => v.trim() !== ''));
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

function readCsvIfExists(file) {
  const p = path.join(ROOT, 'import', file);
  if (!fs.existsSync(p)) { console.log(`(skip) ${file} not found in import/`); return []; }
  return csvToObjects(fs.readFileSync(p, 'utf8'));
}

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${table} -> ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

async function insertBatches(table, rows, { onConflict, chunk = 300 } = {}) {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    await sb(table, {
      method: 'POST',
      body: batch,
      query: onConflict ? `?on_conflict=${onConflict}` : '',
      prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    });
    n += batch.length;
  }
  return n;
}

function toNullableNum(v) {
  if (v === undefined || v === null) return null;
  const cleaned = String(v).replace(/[,\s฿]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function toNullableStr(v) {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

async function importJobs() {
  const rows = readCsvIfExists('jobs.csv');
  if (!rows.length) return { count: 0 };
  const payload = rows.map(r => ({
    id: toNullableStr(r['รหัสแจ้งซ่อม']),
    reported_at: toNullableStr(r['วันที่แจ้ง']),
    customer_name: toNullableStr(r['ชื่อผู้แจ้ง']),
    phone: toNullableStr(r['เบอร์โทร']),
    category: toNullableStr(r['หมวดหมู่']),
    machine_name: toNullableStr(r['ชื่อเครื่องจักร/ทะเบียนรถ']),
    problem_detail: toNullableStr(r['รายละเอียดปัญหา']),
    location: toNullableStr(r['สถานที่']),
    urgency: toNullableStr(r['ความเร่งด่วน']) || 'ปานกลาง',
    status: toNullableStr(r['สถานะ']) || 'รอดำเนินการ',
    technician: toNullableStr(r['ช่างผู้รับผิดชอบ']),
    note: toNullableStr(r['หมายเหตุ']),
    due_date: toNullableStr(r['วันที่คาดว่าจะเสร็จ']),
    parts_used: toNullableStr(r['อะไหล่ที่ใช้']),
    cost: toNullableNum(r['ค่าใช้จ่าย']),
    solution: toNullableStr(r['วิธีการแก้ไข']),
  }));
  const count = await insertBatches('jobs', payload, { onConflict: 'id' });

  // derive machines / techs referenced by jobs so the app's dropdowns work
  // even if the machines.csv / techs.csv exports aren't imported
  const machineNames = [...new Set(payload.map(j => j.machine_name).filter(Boolean))];
  const techNames = [...new Set(payload.map(j => j.technician).filter(Boolean))];
  if (machineNames.length) {
    await insertBatches('machines', machineNames.map(name => ({ name })), { onConflict: 'name' });
  }
  if (techNames.length) {
    // only insert techs that don't already exist (code is trigger-generated, so
    // on_conflict upsert-by-name isn't possible here without a unique constraint on name)
    const existing = await sb('techs', { query: '?select=name' });
    const existingNames = new Set(existing.map(t => t.name));
    const toAdd = techNames.filter(n => !existingNames.has(n));
    if (toAdd.length) await insertBatches('techs', toAdd.map(name => ({ name })));
  }

  return { count, machineNames: machineNames.length, techNames: techNames.length };
}

async function importMachines() {
  const rows = readCsvIfExists('machines.csv');
  if (!rows.length) return { count: 0 };
  const payload = rows.map(r => ({
    // some exports have a stray duplicate/blank "name" header column, so prefer
    // whichever column actually has a value, falling back to the first column
    name: toNullableStr(r['ชื่อเครื่องจักร/ทะเบียนรถ'] || r['ชื่อเครื่องจักร / ทะเบียนรถ'] || r['ชื่อ'] || Object.values(r)[0]),
    category: toNullableStr(r['หมวดหมู่']),
    location: toNullableStr(r['สถานที่ตั้ง']),
    note: toNullableStr(r['หมายเหตุ']),
  })).filter(m => m.name);
  const count = await insertBatches('machines', payload, { onConflict: 'name' });
  return { count };
}

async function importTechs() {
  const rows = readCsvIfExists('techs.csv');
  if (!rows.length) return { count: 0 };
  const existing = await sb('techs', { query: '?select=name' });
  const existingNames = new Set(existing.map(t => t.name));
  const parsed = rows.map(r => ({
    name: toNullableStr(r['ชื่อช่าง']),
    phone: toNullableStr(r['เบอร์โทร']),
    skill: toNullableStr(r['ความเชี่ยวชาญ']),
    status: toNullableStr(r['สถานะ']) || 'ใช้งาน',
  })).filter(t => t.name);

  const toInsert = parsed.filter(t => !existingNames.has(t.name));
  const toUpdate = parsed.filter(t => existingNames.has(t.name));

  const inserted = await insertBatches('techs', toInsert);
  for (const t of toUpdate) {
    // enrich a tech that already exists (e.g. was auto-created from a job's
    // "ช่างผู้รับผิดชอบ" text) with phone/skill/status from this sheet
    const { name, ...patch } = t;
    await sb('techs', {
      method: 'PATCH',
      query: `?name=eq.${encodeURIComponent(name)}`,
      body: patch,
      prefer: 'return=minimal',
    });
  }
  return { inserted, updated: toUpdate.length };
}

const jobsResult = await importJobs();
console.log('jobs:', jobsResult);
const machinesResult = await importMachines();
console.log('machines.csv:', machinesResult);
const techsResult = await importTechs();
console.log('techs.csv:', techsResult);

console.log(`
Done. IMPORTANT — run this once in Supabase SQL Editor to keep future
auto-generated IDs from colliding with the imported ones:

  select setval('job_code_seq',
    (select coalesce(max(nullif(regexp_replace(id, '\\D', '', 'g'), '')::int), 0) from jobs));
  select setval('tech_code_seq',
    (select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) from techs));
`);
