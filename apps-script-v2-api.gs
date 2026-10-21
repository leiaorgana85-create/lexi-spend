// Lexi Spend v2 parallel API surface.
// This file intentionally does not replace or redefine legacy production functions.
// V2 calls reach this module only through the lexi-spend-v2-call route in Bridge.html.

function bridgeExecuteV2(apiCode, functionName, parameters) {
  assertLexiSpendApiCode_(apiCode);

  const name = String(functionName || '').trim();
  const args = Array.isArray(parameters) ? parameters : [];

  switch (name) {
    case 'getAppState':
      return v2GetAppState_.apply(null, args);
    case 'previewUsd':
      return previewUsd.apply(null, args);
    case 'getCalendarMonth':
      return v2GetCalendarMonth_.apply(null, args);
    case 'uploadReceipt':
      return v2UploadReceipt_.apply(null, args);
    case 'logExpense':
      return v2LogExpense_.apply(null, args);
    case 'deleteExpense':
      return v2DeleteExpense_.apply(null, args);
    case 'deleteReceiptFile':
      return v2DeleteReceiptFile_.apply(null, args);
    case 'addCashWithdrawal':
      return v2AddCashWithdrawal_.apply(null, args);
    case 'deleteCashWithdrawal':
      return v2DeleteCashWithdrawal_.apply(null, args);
    default:
      throw new Error('Unsupported v2 API function.');
  }
}

function v2EntryId_(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    throw new Error('Invalid Entry ID.');
  }
  return id;
}

function v2Month_(value) {
  const month = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid calendar month.');
  }
  return month;
}

function v2TransactionView_(row) {
  return {
    date:normalizeDateCell_(row[0]),
    merchant:String(row[1] || ''),
    category:String(row[2] || ''),
    paymentMethod:String(row[3] || ''),
    localAmount:String(row[4] == null ? '' : row[4]),
    currency:String(row[5] || ''),
    usdAmount:`$${Number(row[7] || 0).toFixed(2)}`,
    country:String(row[8] || ''),
    note:String(row[9] || ''),
    entryId:String(row[12] || ''),
    receiptUrl:String(row[13] || '')
  };
}

function v2ExtendRecentTransactions_(recent, limit) {
  const target = Math.max(0, Number(limit) || 0);
  const out = Array.isArray(recent) ? recent.slice(0, target) : [];
  if (!target || out.length >= target) return out;

  const known = new Set(out.map(item => String(item?.entryId || '')).filter(Boolean));
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const batchSize = 12;

  for (let endRow = lastRow; endRow >= 2 && out.length < target; endRow -= batchSize) {
    const startRow = Math.max(2, endRow - batchSize + 1);
    const rows = sheet.getRange(startRow, 1, endRow - startRow + 1, 15).getValues();

    for (let i = rows.length - 1; i >= 0 && out.length < target; i--) {
      const row = rows[i];
      if (normalizeCategory_(row[2]) === 'Housing') continue;
      const entryId = String(row[12] || '');
      if (entryId && known.has(entryId)) continue;
      out.push(v2TransactionView_(row));
      if (entryId) known.add(entryId);
    }
  }

  return out;
}

function v2GetAppState_(today, cashCurrency) {
  const result = getAppState(today, cashCurrency);
  result.recent = v2ExtendRecentTransactions_(result.recent, 4);
  return result;
}

function v2FindTransactionById_(sheet, entryId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet
    .getRange(2, 13, lastRow - 1, 1)
    .createTextFinder(entryId)
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  return {
    rowNumber,
    row: sheet.getRange(rowNumber, 1, 1, 15).getValues()[0]
  };
}

function v2FindCashById_(sheet, entryId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet
    .getRange(2, 12, lastRow - 1, 1)
    .createTextFinder(entryId)
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  return {
    rowNumber,
    row: sheet.getRange(rowNumber, 1, 1, 12).getValues()[0]
  };
}

function v2MoneyEqual_(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.000001;
}

function v2AssertTransactionRetryMatches_(row, expected) {
  const actualDate = normalizeDateCell_(row[0]);
  const actualCountry = String(row[8] || '').trim();
  const actualNote = String(row[9] || '').trim();
  const actualReceiptUrl = String(row[13] || '').trim();
  const actualReceiptFileId = String(row[14] || '').trim();

  const same =
    actualDate === expected.date &&
    String(row[1] || '').trim() === expected.merchant &&
    String(row[2] || '').trim() === expected.category &&
    String(row[3] || '').trim() === expected.paymentMethod &&
    v2MoneyEqual_(row[4], expected.amount) &&
    String(row[5] || '').trim().toUpperCase() === expected.currency &&
    actualCountry === expected.country &&
    actualNote === expected.note &&
    actualReceiptUrl === expected.receiptUrl &&
    actualReceiptFileId === expected.receiptFileId;

  if (!same) {
    throw new Error('Entry ID already exists with different expense data.');
  }
}

function v2AssertCashRetryMatches_(row, expected) {
  const same =
    normalizeDateCell_(row[0]) === expected.date &&
    v2MoneyEqual_(row[1], expected.amount) &&
    String(row[2] || '').trim().toUpperCase() === expected.currency &&
    v2MoneyEqual_(row[5], expected.atmFee) &&
    (expected.bankDebitUsd === ''
      ? String(row[7] == null ? '' : row[7]).trim() === ''
      : v2MoneyEqual_(row[7], expected.bankDebitUsd)) &&
    String(row[8] || '').trim() === expected.country &&
    String(row[9] || '').trim() === expected.note;

  if (!same) {
    throw new Error('Entry ID already exists with different cash data.');
  }
}

function v2TransactionReturn_(entryId, usdAmount, fxRate, fxEffectiveDate, today, paymentMethod, currency, deduped) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 15).getValues()
    : [];

  return {
    ok: true,
    entryId,
    deduped: Boolean(deduped),
    usdAmount: roundMoney_(usdAmount),
    fxRate: Number(fxRate || 0),
    fxEffectiveDate: String(fxEffectiveDate || ''),
    recent: getRecentTransactions_(4, rows),
    summary: getSpendingSummary_(today, rows),
    cash: paymentMethod === 'Cash'
      ? getCashState_(currency, null, rows, today)
      : null
  };
}

function v2LogExpense_(data) {
  if (!data) throw new Error('Missing expense data.');

  const entryId = v2EntryId_(data.entryId);
  const date = normalizeIsoDate_(data.date);
  const merchant = String(data.merchant || '').trim();
  const category = String(data.category || '').trim();
  const paymentMethod = String(data.paymentMethod || 'Card').trim();
  const amount = Number(data.amount);
  const currency = String(data.currency || '').trim().toUpperCase();
  const country = canonicalCountryForCurrency_(currency, data.country);
  const note = String(data.note || '').trim();
  const today = normalizeIsoDate_(data.today) || todayIso_();
  const receiptUrl = String(data.receiptUrl || '').trim();
  const receiptFileId = String(data.receiptFileId || '').trim();

  if (!date) throw new Error('Invalid date.');
  if (!merchant) throw new Error('Merchant is required.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid amount.');
  if (!category) throw new Error('Category is required.');
  if (!currency) throw new Error('Currency is required.');
  if (!['Cash','Card'].includes(paymentMethod)) throw new Error('Payment method must be Cash or Card.');

  const allowedCategory = getBudgetConfig_().categories.some(x => x.name === category);
  if (!allowedCategory) throw new Error('Invalid category.');

  validateTransactionSchema_();
  const sheet = getSheet_();

  const expected = {
    date, merchant, category, paymentMethod, amount, currency,
    country, note, receiptUrl, receiptFileId
  };

  const preExisting = v2FindTransactionById_(sheet, entryId);
  if (preExisting) {
    v2AssertTransactionRetryMatches_(preExisting.row, expected);
    return v2TransactionReturn_(
      entryId,
      Number(preExisting.row[7]) || 0,
      Number(preExisting.row[6]) || 0,
      date,
      today,
      paymentMethod,
      currency,
      true
    );
  }

  const fx = getUsdRate_(currency, date);
  const usdAmount = roundMoney_(amount * fx.rate);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = v2FindTransactionById_(sheet, entryId);
    if (existing) {
      v2AssertTransactionRetryMatches_(existing.row, expected);
      return v2TransactionReturn_(
        entryId,
        Number(existing.row[7]) || 0,
        Number(existing.row[6]) || 0,
        date,
        today,
        paymentMethod,
        currency,
        true
      );
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 15).setValues([[
      date,
      merchant,
      category,
      paymentMethod,
      amount,
      currency,
      fx.rate,
      usdAmount,
      country,
      note,
      new Date().toISOString(),
      fx.source,
      entryId,
      receiptUrl,
      receiptFileId
    ]]);
  } finally {
    lock.releaseLock();
  }

  return v2TransactionReturn_(
    entryId,
    usdAmount,
    fx.rate,
    fx.effectiveDate,
    today,
    paymentMethod,
    currency,
    false
  );
}

function v2DeleteExpense_(entryId, today, stayContext) {
  const id = v2EntryId_(entryId);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  let receiptFileId = '';
  let result;

  try {
    const sheet = getSheet_();
    const found = v2FindTransactionById_(sheet, id);
    if (!found) {
      return {
        ok: true,
        alreadyDeleted: true,
        recent: getRecentTransactions_(4),
        summary: getSpendingSummary_(normalizeIsoDate_(today) || todayIso_())
      };
    }

    receiptFileId = String(found.row[14] || '').trim();
    result = deleteExpense(id, today, stayContext);
    result.recent = v2ExtendRecentTransactions_(result.recent, 4);
  } finally {
    lock.releaseLock();
  }

  if (receiptFileId) {
    try {
      DriveApp.getFileById(receiptFileId).setTrashed(true);
      result.receiptDeleted = true;
    } catch (error) {
      result.receiptDeleted = false;
      result.receiptCleanupWarning = 'Transaction deleted, but receipt cleanup needs review.';
    }
  }
  return result;
}

function v2DeleteReceiptFile_(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return { ok:true, alreadyMissing:true };
  try {
    DriveApp.getFileById(id).setTrashed(true);
    return { ok:true, alreadyMissing:false };
  } catch (error) {
    return { ok:true, alreadyMissing:true };
  }
}

function v2AddCashWithdrawal_(data) {
  if (!data) throw new Error('Missing withdrawal data.');

  const entryId = v2EntryId_(data.entryId);
  const date = normalizeIsoDate_(data.date);
  const amount = Number(data.amount);
  const atmFee = Number(data.atmFee || 0);
  const bankDebitRaw = String(data.bankDebitUsd == null ? '' : data.bankDebitUsd).trim();
  const bankDebitUsd = bankDebitRaw === '' ? '' : Number(bankDebitRaw);
  const currency = String(data.currency || '').trim().toUpperCase();
  const country = canonicalCountryForCurrency_(currency, data.country);
  const note = String(data.note || '').trim();

  if (!date) throw new Error('Invalid date.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Withdrawal amount must be greater than zero.');
  if (!Number.isFinite(atmFee) || atmFee < 0) throw new Error('ATM fee cannot be negative.');
  if (bankDebitUsd !== '' && (!Number.isFinite(bankDebitUsd) || bankDebitUsd <= 0)) {
    throw new Error('Exact bank USD debit must be greater than zero or left blank.');
  }
  if (!currency || !SUPPORTED_WALLET_CURRENCIES.includes(currency)) throw new Error('Invalid currency.');

  validateCashSchema_();
  const sheet = getCashSheet_();
  const expected = { date, amount, currency, atmFee, bankDebitUsd, country, note };
  const preExisting = v2FindCashById_(sheet, entryId);
  if (preExisting) {
    v2AssertCashRetryMatches_(preExisting.row, expected);
    return {
      ok: true,
      deduped: true,
      withdrawal: {
        date,
        amount:Number(preExisting.row[1]) || 0,
        currency,
        fxRate:Number(preExisting.row[3]) || 0,
        usdEquivalent:Number(preExisting.row[4]) || 0,
        atmFee:Number(preExisting.row[5]) || 0,
        atmFeeUsd:Number(preExisting.row[6]) || 0,
        bankDebitUsd:Number(preExisting.row[7]) || 0,
        note,
        entryId
      }
    };
  }

  const fx = getUsdRate_(currency, date);
  const usdEquivalent = roundMoney_(amount * fx.rate);
  const atmFeeUsd = roundMoney_(atmFee * fx.rate);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = v2FindCashById_(sheet, entryId);
    if (existing) {
      v2AssertCashRetryMatches_(existing.row, expected);
      return {
        ok: true,
        deduped: true,
        withdrawal: {
          date,
          amount:Number(existing.row[1]) || 0,
          currency,
          fxRate:Number(existing.row[3]) || 0,
          usdEquivalent:Number(existing.row[4]) || 0,
          atmFee:Number(existing.row[5]) || 0,
          atmFeeUsd:Number(existing.row[6]) || 0,
          bankDebitUsd:Number(existing.row[7]) || 0,
          note,
          entryId
        }
      };
    }

    sheet.appendRow([
      date,
      amount,
      currency,
      fx.rate,
      usdEquivalent,
      atmFee,
      atmFeeUsd,
      bankDebitUsd,
      country,
      note,
      new Date().toISOString(),
      entryId
    ]);
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    deduped: false,
    withdrawal: {
      date, amount, currency, fxRate:fx.rate, usdEquivalent,
      atmFee, atmFeeUsd, bankDebitUsd, note, entryId
    },
    fxEffectiveDate:fx.effectiveDate
  };
}

function v2DeleteCashWithdrawal_(entryId) {
  const id = v2EntryId_(entryId);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getCashSheet_();
    if (!v2FindCashById_(sheet, id)) {
      return { ok:true, alreadyDeleted:true };
    }
    return deleteCashWithdrawal(id);
  } finally {
    lock.releaseLock();
  }
}

function v2GetCalendarMonth_(monthValue) {
  const month = v2Month_(monthValue);
  validateTransactionSchema_();

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 15).getValues()
    : [];

  const days = {};
  let monthTotalUsd = 0;
  let transactionCount = 0;

  rows.forEach(row => {
    const date = normalizeDateCell_(row[0]);
    if (!date || date.slice(0, 7) !== month) return;

    const rawCategory = String(row[2] || '').trim();
    const category = normalizeCategory_(rawCategory);
    if (category === 'Housing' || rawCategory === 'Travel & Irregular') return;

    const usdAmount = Number(row[7]) || 0;
    if (!days[date]) {
      days[date] = {
        totalUsd:0,
        count:0,
        categories:{},
        transactions:[]
      };
    }

    const day = days[date];
    day.totalUsd = roundMoney_(day.totalUsd + usdAmount);
    day.count += 1;
    day.categories[rawCategory || category || 'Other'] = roundMoney_(
      (day.categories[rawCategory || category || 'Other'] || 0) + usdAmount
    );
    day.transactions.push({
      entryId:String(row[12] || ''),
      date,
      merchant:String(row[1] || ''),
      category:rawCategory,
      paymentMethod:String(row[3] || ''),
      localAmount:Number(row[4]) || 0,
      currency:String(row[5] || ''),
      usdAmount:roundMoney_(usdAmount),
      country:String(row[8] || ''),
      note:String(row[9] || ''),
      receiptUrl:String(row[13] || '')
    });
    monthTotalUsd += usdAmount;
    transactionCount += 1;
  });

  return {
    month,
    monthTotalUsd:roundMoney_(monthTotalUsd),
    transactionCount,
    days
  };
}

function v2UploadReceipt_(data) {
  if (!data) throw new Error('Missing receipt data.');

  const entryId = v2EntryId_(data.entryId);
  const dataUrl = String(data.dataUrl || '');
  const date = normalizeIsoDate_(data.date);
  if (!date) throw new Error('Invalid receipt date.');

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Receipt image format is invalid.');
  const mimeType = match[1];
  const base64 = match[2];
  if (base64.length > MAX_RECEIPT_BASE64_CHARS) throw new Error('Receipt image is too large to save.');

  const ext = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
  const fileName = `${date}_receipt_${entryId}.${ext}`;
  const parts = date.split('-');
  const root = DriveApp.getFolderById(getReceiptRootFolderId_());
  const yearFolder = getOrCreateFolder_(root, parts[0]);
  const monthFolder = getOrCreateFolder_(yearFolder, parts[1]);

  const existing = monthFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    return { ok:true, deduped:true, url:file.getUrl(), fileId:file.getId(), name:file.getName() };
  }

  const bytes = Utilities.base64Decode(base64);
  const file = monthFolder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  return { ok:true, deduped:false, url:file.getUrl(), fileId:file.getId(), name:file.getName() };
}
