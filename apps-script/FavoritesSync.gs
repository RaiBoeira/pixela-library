const SHEET_NAME = 'favorites';
const REQUIRED_HEADERS = ['drive_file_id', 'path', 'updated_at', 'active'];

function doGet(e) {
  try {
    assertAuthorized_(e);
    const sheet = getSheet_();
    const rows = readRows_(sheet);
    const favorites = rows
      .filter((row) => String(row.active).toLowerCase() === 'true')
      .map((row) => ({
        drive_file_id: String(row.drive_file_id || '').trim(),
        path: String(row.path || '').trim(),
      }))
      .filter((row) => row.drive_file_id || row.path);

    return jsonResponse_({ ok: true, favorites });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    assertAuthorized_(e);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const driveFileId = String(payload.drive_file_id || '').trim();
    const path = String(payload.path || '').trim();
    const active = Boolean(payload.active);

    if (!driveFileId && !path) {
      throw new Error('drive_file_id ou path obrigatorio.');
    }

    const sheet = getSheet_();
    const rows = readRows_(sheet);
    const rowIndex = rows.findIndex((row) => {
      return (
        String(row.drive_file_id || '').trim() === driveFileId ||
        (path && String(row.path || '').trim() === path)
      );
    });

    const now = new Date().toISOString();
    const record = [
      driveFileId || (rowIndex >= 0 ? rows[rowIndex].drive_file_id : ''),
      path || (rowIndex >= 0 ? rows[rowIndex].path : ''),
      now,
      active,
    ];

    if (rowIndex >= 0) {
      sheet.getRange(rowIndex + 2, 1, 1, REQUIRED_HEADERS.length).setValues([record]);
    } else {
      sheet.appendRow(record);
    }

    return jsonResponse_({ ok: true, drive_file_id: driveFileId, path, active });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error.message || error) });
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const headerRange = sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length);
  const headers = headerRange.getValues()[0];
  const needsHeaders = REQUIRED_HEADERS.some((header, index) => headers[index] !== header);
  if (needsHeaders) {
    headerRange.setValues([REQUIRED_HEADERS]);
  }

  return sheet;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();
  return values.map((row) => ({
    drive_file_id: row[0],
    path: row[1],
    updated_at: row[2],
    active: row[3],
  }));
}

function assertAuthorized_(e) {
  const expectedApiKey = String(PropertiesService.getScriptProperties().getProperty('PIXELA_API_KEY') || '').trim();
  if (!expectedApiKey) {
    return;
  }

  const suppliedApiKey = String((e && e.parameter && e.parameter.api_key) || '').trim();
  if (suppliedApiKey !== expectedApiKey) {
    throw new Error('api_key invalida.');
  }
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
