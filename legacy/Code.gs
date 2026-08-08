// ============================================================
//  RepairDesk — Google Apps Script Web App
//  Spreadsheet ID: 1Y0fCphiOTi3790ePxf_IRoq4LCaRimQs-Im5hRkFr80
// ============================================================

const SHEET_NAME_JOBS     = "ใบแจ้งซ่อม";
const SHEET_NAME_MACHINES = "รายการ";
const SHEET_NAME_SUMMARY  = "สรุปสถานะ";
const SHEET_NAME_TECHS    = "ช่าง";

const HEADERS = [
  "รหัสแจ้งซ่อม","วันที่แจ้ง","ชื่อผู้แจ้ง","เบอร์โทร",
  "หมวดหมู่","ชื่อเครื่องจักร/ทะเบียนรถ","รายละเอียดปัญหา",
  "สถานที่","ความเร่งด่วน","สถานะ","ช่างผู้รับผิดชอบ","หมายเหตุ",
  "วันที่คาดว่าจะเสร็จ", "อะไหล่ที่ใช้", "ค่าใช้จ่าย", "วิธีการแก้ไข"
];
const TECH_HEADERS = ["รหัสช่าง","ชื่อช่าง","เบอร์โทร","ความเชี่ยวชาญ","สถานะ"];

// ป้องกัน Formula Injection: ถ้าค่าขึ้นต้นด้วย = + - @ ให้เติม ' นำหน้า
// เพื่อไม่ให้ Google Sheets ตีความเป็นสูตรที่รันได้ (เช่น =IMPORTXML(...))
function sanitizeCellValue(v) {
  if (v === null || v === undefined) return v;
  var s = v.toString();
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return v;
}

function sanitizeObject(data) {
  var out = {};
  Object.keys(data).forEach(function(k) {
    out[k] = sanitizeCellValue(data[k]);
  });
  return out;
}

function doGet(e) {
  try {
    var tmpl = HtmlService.createTemplateFromFile("index");
    tmpl.scriptUrl = ScriptApp.getService().getUrl();
    return tmpl.evaluate()
      .setTitle("RepairDesk — ระบบแจ้งซ่อม")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  } catch(err) {
    return HtmlService.createHtmlOutput("<h2>Error: " + err.message + "</h2>");
  }
}

function apiGetJobs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_JOBS);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0].map(function(h) { return h.toString().trim(); });
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      var val = row[i];
      if (val instanceof Date) {
        obj[h] = Utilities.formatDate(val, "Asia/Bangkok", "yyyy-MM-dd");
      } else {
        obj[h] = (val === null || val === undefined) ? "" : val.toString().trim();
      }
    });
    return obj;
  });
}

function apiGetMachines() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_MACHINES);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  return rows.slice(1).map(function(r) { return r[0].toString().trim(); }).filter(v => v);
}

function apiGetTechs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(SHEET_NAME_TECHS, TECH_HEADERS);
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0].map(function(h) { return h.toString().trim(); });
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { 
      var val = row[i];
      obj[h] = (val === null || val === undefined) ? "" : val.toString().trim();
    });
    // Ensure essential keys exist by looking for similar names if exact match fails
    if (!obj["ชื่อช่าง"]) {
      var idx = headers.findIndex(function(h) { return h.indexOf("ชื่อ") > -1; });
      if (idx > -1) obj["ชื่อช่าง"] = row[idx].toString().trim();
    }
    if (!obj["สถานะ"]) {
      var idx = headers.findIndex(function(h) { return h.indexOf("สถานะ") > -1; });
      if (idx > -1) obj["สถานะ"] = row[idx].toString().trim();
    }
    return obj;
  });
}

function apiPost(bodyStr) {
  try {
    var body = JSON.parse(bodyStr);
    var action = body.action;
    var result;
    if (action === "addJob") result = addJob(body.data);
    else if (action === "updateJob") result = updateJob(body.id, body.data);
    else if (action === "deleteJob") result = deleteJob(body.id);
    else if (action === "addTech") result = addTech(body.data);
    else if (action === "updateTech") result = updateTech(body.id, body.data);
    else if (action === "deleteTech") result = deleteTech(body.id);
    else result = { success: false, message: "ไม่รู้จักคำสั่ง: " + action };
    if (result.success) refreshSummary();
    return result;
  } catch(e) { return { success: false, message: e.message }; }
}

function addJob(data) {
  data = sanitizeObject(data);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // รอสูงสุด 10 วินาที กันการชนกันของ ID เมื่อมีคนบันทึกพร้อมกัน
  try {
    var sheet = getOrCreateSheet(SHEET_NAME_JOBS, HEADERS);
    var newId = generateJobId(sheet);
    var sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = sheetHeaders.map(h => {
      var headerStr = h.toString().trim();
      if (headerStr === "รหัสแจ้งซ่อม") return newId;
      if (headerStr === "วันที่แจ้ง") return data[headerStr] || Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
      return data[headerStr] || "";
    });
    sheet.appendRow(row);
    return { success: true, id: newId, message: "บันทึกเรียบร้อย" };
  } finally {
    lock.releaseLock();
  }
}

function updateJob(id, data) {
  data = sanitizeObject(data);
  var sheet = getOrCreateSheet(SHEET_NAME_JOBS, HEADERS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      Object.keys(data).forEach(k => {
        var col = headers.indexOf(k);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(data[k]);
      });
      return { success: true, message: "อัปเดตเรียบร้อย" };
    }
  }
  return { success: false, message: "ไม่พบรหัส" };
}

function deleteJob(id) {
  var sheet = getOrCreateSheet(SHEET_NAME_JOBS, HEADERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "ลบเรียบร้อย" };
    }
  }
  return { success: false, message: "ไม่พบรหัส" };
}

function addTech(data) {
  data = sanitizeObject(data);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateSheet(SHEET_NAME_TECHS, TECH_HEADERS);
    var rows = sheet.getDataRange().getValues();
    var maxId = rows.slice(1).reduce((m, r) => {
      var n = parseInt(String(r[0]).replace(/\D/g,''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    var newId = "TC-" + String(maxId + 1).padStart(3, "0");
    sheet.appendRow([newId, data["ชื่อช่าง"], data["เบอร์โทร"], data["ความเชี่ยวชาญ"], "ใช้งาน"]);
    return { success: true, message: "เพิ่มช่างเรียบร้อย" };
  } finally {
    lock.releaseLock();
  }
}

function updateTech(id, data) {
  data = sanitizeObject(data);
  var sheet = getOrCreateSheet(SHEET_NAME_TECHS, TECH_HEADERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, 2, 1, 4).setValues([[data["ชื่อช่าง"], data["เบอร์โทร"], data["ความเชี่ยวชาญ"], data["สถานะ"]]]);
      return { success: true, message: "อัปเดตช่างเรียบร้อย" };
    }
  }
  return { success: false, message: "ไม่พบข้อมูลช่าง" };
}

function deleteTech(id) {
  var sheet = getOrCreateSheet(SHEET_NAME_TECHS, TECH_HEADERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "ลบช่างเรียบร้อย" };
    }
  }
  return { success: false, message: "ไม่พบช่าง" };
}

function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(SHEET_NAME_SUMMARY, ["สถานะ", "จำนวน"]);
  var jobs = apiGetJobs();
  var stats = { "รอดำเนินการ": 0, "กำลังซ่อม": 0, "เสร็จสิ้น": 0, "ยกเลิก": 0 };
  jobs.forEach(j => { if (stats.hasOwnProperty(j["สถานะ"])) stats[j["สถานะ"]]++; });
  sheet.clearContents();
  sheet.getRange(1, 1).setValue("อัปเดตล่าสุด: " + Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm"));
  var rows = Object.entries(stats).map(e => [e[0], e[1]]);
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

function getOrCreateSheet(name, expectedHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeaders);
    sheet.setFrozenRows(1);
  } else {
    var lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      var missingHeaders = expectedHeaders.filter(function(h) { return currentHeaders.indexOf(h) === -1; });
      if (missingHeaders.length > 0) {
        sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
      }
    } else {
      sheet.appendRow(expectedHeaders);
    }
  }
  return sheet;
}

function generateJobId(sheet) {
  var rows = sheet.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < rows.length; i++) {
    var n = parseInt(String(rows[i][0]).replace(/\D/g,''), 10);
    if (!isNaN(n)) max = Math.max(max, n);
  }
  return "RD-" + String(max + 1).padStart(4, "0");
}
