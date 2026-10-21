// Canonical repository source for live Lexi Spend API Code.gs.
// Required Script Property: LEXI_SPEND_RECEIPT_ROOT_FOLDER_ID = private receipt Drive folder ID.
// Never commit the receipt folder ID or API code to GitHub.

const SPREADSHEET_ID_PROPERTY = 'LEXI_SPEND_SPREADSHEET_ID';
const SHEET_NAME = 'Transactions';
const CASH_SHEET_NAME = 'Cash Wallet';
const STAYS_SHEET_NAME = 'Stays';
const SETUP_SHEET_NAME = 'Setup';
const APP_VERSION = '13.12.21';
const FX_API = 'https://api.frankfurter.dev/v2/rate';

const RECEIPT_ROOT_FOLDER_PROPERTY = 'LEXI_SPEND_RECEIPT_ROOT_FOLDER_ID';
const MAX_RECEIPT_BASE64_CHARS = 7000000;

let SPREADSHEET_TIME_ZONE_CACHE_ = null;
let SPREADSHEET_CACHE_ = null;
let BUDGET_CONFIG_CACHE_ = null;


const STAY_HEADERS = [
  'Stay',
  'Start',
  'End',
  'Days',
  'Lower-cost?',
  'Note',
  'Uses DTV?'
];

const TRANSACTION_HEADERS = [
  'Date',
  'Merchant',
  'Category',
  'Payment Method',
  'Local Amount',
  'Currency',
  'FX Rate to USD',
  'USD Amount',
  'Country',
  'Note',
  'Logged At',
  'FX Source',
  'Entry ID',
  'Receipt Link',
  'Receipt File ID'
];


const CURRENCY_COUNTRY_MAP = {
  THB: 'Thailand',
  KRW: 'South Korea',
  VND: 'Vietnam',
  JPY: 'Japan',
  MXN: 'Mexico'
};

const SUPPORTED_WALLET_CURRENCIES = [
  'THB',
  'KRW',
  'VND',
  'JPY',
  'MXN',
  'USD'
];

function canonicalCountryForCurrency_(
  currency,
  fallbackCountry
) {
  const curr =
    String(currency || '')
      .trim()
      .toUpperCase();

  if (
    Object.prototype
      .hasOwnProperty
      .call(
        CURRENCY_COUNTRY_MAP,
        curr
      )
  ) {
    return CURRENCY_COUNTRY_MAP[curr];
  }

  return String(
    fallbackCountry || ''
  ).trim();
}

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Bridge')
    .setTitle('Lexi Spend API')
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
}

function bridgeExecute(
  apiCode,
  functionName,
  parameters
) {
  assertLexiSpendApiCode_(apiCode);

  return runLexiSpendApiFunction_(
    String(functionName || '').trim(),
    Array.isArray(parameters) ? parameters : []
  );
}

function getAppState(
  today,
  cashCurrency
) {
  validateTransactionSchema_();
  validateCashSchema_();

  const props = PropertiesService.getScriptProperties();

  const country =
    props.getProperty('country') || 'Thailand';

  const currency =
    props.getProperty('currency') || 'THB';

  const symbol =
    props.getProperty('symbol') || '฿';

  const requestedCashCurrency =
    String(
      cashCurrency || currency
    )
      .trim()
      .toUpperCase();

  const current =
    normalizeIsoDate_(today) ||
    todayIso_();

  const stay =
    getStayContextFromSheet_(
      current
    );

  /*
    Read each ledger once during app initialization.
    All six Cash Wallet views are derived from these same in-memory rows,
    so switching wallet currency in the browser requires no server call.
  */
  const txSheet =
    getSheet_();

  const txLastRow =
    txSheet.getLastRow();

  const txRows =
    txLastRow >= 2
      ? txSheet
          .getRange(
            2,
            1,
            txLastRow - 1,
            15
          )
          .getValues()
      : [];

  const cashSheet =
    getCashSheet_();

  const cashLastRow =
    cashSheet.getLastRow();

  const cashRows =
    cashLastRow >= 2
      ? cashSheet
          .getRange(
            2,
            1,
            cashLastRow - 1,
            12
          )
          .getValues()
      : [];

  const cashWallets = {};

  SUPPORTED_WALLET_CURRENCIES
    .forEach(curr => {
      cashWallets[curr] =
        getCashState_(
          curr,
          5,
          txRows,
          current,
          cashRows
        );
    });

  return {
    appVersion: APP_VERSION,
    country,
    currency,
    symbol,
    stayName: stay.name,
    stayStart: stay.start,
    stayEnd: stay.end || '',
    stayStatus: stay.status,
    staySource: STAYS_SHEET_NAME,
    recent:
      getRecentTransactions_(
        3,
        txRows
      ),
    cash:
      cashWallets[
        requestedCashCurrency
      ] ||
      cashWallets[currency] ||
      null,
    cashWallets,
    summary:
      getSpendingSummary_(
        current,
        txRows,
        stay
      )
  };
}

function previewUsd(
  amount,
  currency,
  date
) {
  const n =
    Number(amount);

  const curr =
    String(currency || '')
      .trim()
      .toUpperCase();

  const d =
    normalizeIsoDate_(date);

  if (
    !Number.isFinite(n) ||
    n < 0
  ) {
    throw new Error(
      'Invalid amount.'
    );
  }

  if (!curr) {
    throw new Error(
      'Currency is required.'
    );
  }

  if (!d) {
    throw new Error(
      'Invalid date.'
    );
  }

  const fx =
    getUsdRate_(
      curr,
      d
    );

  return {
    rate: fx.rate,
    effectiveDate:
      fx.effectiveDate,
    usdAmount:
      roundMoney_(
        n * fx.rate
      ),
    source: fx.source
  };
}

/*
  Run this ONCE from the Apps Script editor after adding
  Drive receipt support. It forces Google's Drive permission
  prompt and verifies the configured receipt folder.
*/
function authorizeDriveAccess() {
  const folder =
    DriveApp.getFolderById(
      getReceiptRootFolderId_()
    );

  return {
    ok: true,
    folderName:
      folder.getName(),
    folderUrl:
      folder.getUrl()
  };
}

function uploadReceipt(data) {
  if (!data) {
    throw new Error(
      'Missing receipt data.'
    );
  }

  const dataUrl =
    String(
      data.dataUrl || ''
    );

  const date =
    normalizeIsoDate_(
      data.date
    );

  const label =
    String(
      data.label ||
      'receipt'
    ).trim() ||
    'receipt';

  if (!date) {
    throw new Error(
      'Invalid receipt date.'
    );
  }

  const entryId =
    Utilities.getUuid();

  try {
    return saveReceipt_(
      dataUrl,
      date,
      label,
      entryId
    );
  } catch (err) {
    const msg =
      String(
        err &&
        err.message
          ? err.message
          : err
      );

    if (
      /permission|authorization|authorize|scope/i
        .test(msg)
    ) {
      throw new Error(
        'Google Drive permission is not authorized yet. In Apps Script, run authorizeDriveAccess once and approve the Drive permission.'
      );
    }

    throw err;
  }
}

function deleteReceiptFile(fileId) {
  const id =
    String(
      fileId || ''
    ).trim();

  if (!id) {
    return {
      ok: true
    };
  }

  DriveApp
    .getFileById(id)
    .setTrashed(true);

  return {
    ok: true
  };
}

function logExpense(data) {
  const serverStartMs = Date.now();
  if (!data) {
    throw new Error(
      'Missing expense data.'
    );
  }

  const date =
    normalizeIsoDate_(
      data.date
    );

  const merchant =
    String(
      data.merchant || ''
    ).trim();

  const category =
    String(
      data.category || ''
    ).trim();

  const paymentMethod =
    String(
      data.paymentMethod ||
      'Card'
    ).trim();

  const amount =
    Number(
      data.amount
    );

  const currency =
    String(
      data.currency || ''
    )
      .trim()
      .toUpperCase();

  const country =
    canonicalCountryForCurrency_(
      currency,
      data.country
    );

  const note =
    String(
      data.note || ''
    ).trim();

  const today =
    normalizeIsoDate_(
      data.today
    ) ||
    todayIso_();

  if (!date) {
    throw new Error(
      'Invalid date.'
    );
  }

  if (!merchant) {
    throw new Error(
      'Merchant is required.'
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      'Invalid amount.'
    );
  }

  if (!category) {
    throw new Error(
      'Category is required.'
    );
  }

  if (!currency) {
    throw new Error(
      'Currency is required.'
    );
  }

  if (
    ![
      'Cash',
      'Card'
    ].includes(
      paymentMethod
    )
  ) {
    throw new Error(
      'Payment method must be Cash or Card.'
    );
  }

  /*
    getAppState() already validates/migrates the sheet at app load.
    Avoid repeating the expensive schema/formatting work on every save.
  */
  const sheet =
    getSheet_();

  const fx =
    getUsdRate_(
      currency,
      date
    );

  const usdAmount =
    roundMoney_(
      amount *
      fx.rate
    );

  const entryId =
    Utilities.getUuid();

  const newRow = [
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
    new Date()
      .toISOString(),
    fx.source,
    entryId,
    '',
    ''
  ];

  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      1,
      15
    )
    .setValues([
      newRow
    ]);

  /*
    One transaction-table read after the write.
    The same rows feed:
      - last 3 transactions
      - weekly/monthly/category totals
      - cash-spend total if this purchase used cash
    No second browser -> Apps Script refresh call is needed.
  */
  const lastRow =
    sheet.getLastRow();

  const txRows =
    lastRow >= 2
      ? sheet
          .getRange(
            2,
            1,
            lastRow - 1,
            15
          )
          .getValues()
      : [];

  const recent =
    getRecentTransactions_(
      3,
      txRows
    );

  const summary =
    getSpendingSummary_(
      today,
      txRows
    );

  const cash =
    paymentMethod ===
      'Cash'
      ? getCashState_(
          currency,
          null,
          txRows,
          today
        )
      : null;

  return {
    ok: true,
    entryId,
    usdAmount,
    fxRate:
      fx.rate,
    fxEffectiveDate:
      fx.effectiveDate,
    recent,
    summary,
    cash,
    serverMs:
      Date.now() -
      serverStartMs
  };
}

function deleteExpense(
  entryId,
  today,
  stayContext
) {
  const id =
    String(
      entryId || ''
    ).trim();

  const current =
    normalizeIsoDate_(
      today
    ) ||
    todayIso_();

  const providedStay =
    stayContext &&
    normalizeIsoDate_(stayContext.start)
      ? {
          name: String(stayContext.name || '').trim() || 'Stay',
          start: normalizeIsoDate_(stayContext.start),
          end: normalizeIsoDate_(stayContext.end) || '',
          status: String(stayContext.status || 'active')
        }
      : null;

  if (!id) {
    throw new Error(
      'Missing transaction ID.'
    );
  }

  /*
    App initialization already validated the schema.
    Read Transactions once, delete the target row, then reuse
    the in-memory remaining rows for recent + summary + cash.
  */
  const sheet =
    getSheet_();

  const lastRow =
    sheet.getLastRow();

  if (
    lastRow < 2
  ) {
    throw new Error(
      'Transaction not found.'
    );
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        15
      )
      .getValues();

  const index =
    rows.findIndex(
      r =>
        String(
          r[12] || ''
        ) === id
    );

  if (
    index < 0
  ) {
    throw new Error(
      'Transaction not found.'
    );
  }

  const row =
    rows[index];

  const rowNumber =
    index + 2;

  const deleted = {
    merchant:
      String(
        row[1] || ''
      ),
    amount:
      Number(
        row[4]
      ) || 0,
    currency:
      String(
        row[5] || ''
      ),
    paymentMethod:
      String(
        row[3] || ''
      )
  };

  /*
    Delete the Sheet row first so the spending record is gone
    as soon as this call succeeds.
  */
  sheet.deleteRow(
    rowNumber
  );

  rows.splice(
    index,
    1
  );

  const recent =
    getRecentTransactions_(
      3,
      rows
    );

  const summary =
    getSpendingSummary_(
      current,
      rows,
      providedStay || undefined
    );

  return {
    ok: true,
    deleted,
    recent,
    summary
  };
}

function addCashWithdrawal(data) {
  if (!data) {
    throw new Error(
      'Missing withdrawal data.'
    );
  }

  const date =
    normalizeIsoDate_(
      data.date
    );

  const amount =
    Number(
      data.amount
    );

  const atmFee =
    Number(
      data.atmFee || 0
    );

  const bankDebitRaw =
    String(
      data.bankDebitUsd == null
        ? ''
        : data.bankDebitUsd
    ).trim();

  const bankDebitUsd =
    bankDebitRaw === ''
      ? ''
      : Number(
          bankDebitRaw
        );

  const currency =
    String(
      data.currency || ''
    )
      .trim()
      .toUpperCase();

  const country =
    canonicalCountryForCurrency_(
      currency,
      data.country
    );

  const note =
    String(
      data.note || ''
    ).trim();

  if (!date) {
    throw new Error(
      'Invalid date.'
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      'Withdrawal amount must be greater than zero.'
    );
  }

  if (
    !Number.isFinite(atmFee) ||
    atmFee < 0
  ) {
    throw new Error(
      'ATM fee cannot be negative.'
    );
  }

  if (
    bankDebitUsd !== '' &&
    (
      !Number.isFinite(
        bankDebitUsd
      ) ||
      bankDebitUsd <= 0
    )
  ) {
    throw new Error(
      'Exact bank USD debit must be greater than zero or left blank.'
    );
  }

  if (!currency) {
    throw new Error(
      'Currency is required.'
    );
  }

  const fx =
    getUsdRate_(
      currency,
      date
    );

  const usdEquivalent =
    roundMoney_(
      amount *
      fx.rate
    );

  const atmFeeUsd =
    roundMoney_(
      atmFee *
      fx.rate
    );

  const entryId =
    Utilities.getUuid();

  const sheet =
    getCashSheet_();

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
    new Date()
      .toISOString(),
    entryId
  ]);

  return {
    ok: true,
    withdrawal: {
      date,
      amount,
      currency,
      fxRate:
        fx.rate,
      usdEquivalent,
      atmFee,
      atmFeeUsd,
      bankDebitUsd,
      note,
      entryId
    },
    usdEquivalent,
    atmFee,
    atmFeeUsd,
    fxRate:
      fx.rate,
    fxEffectiveDate:
      fx.effectiveDate
  };
}

function deleteCashEntry(entryId) {
  return deleteCashWithdrawal(entryId);
}

function deleteCashWithdrawal(
  entryId
) {
  const id =
    String(
      entryId || ''
    ).trim();

  if (!id) {
    throw new Error(
      'Missing cash entry ID.'
    );
  }

  const sheet =
    getCashSheet_();

  const lastRow =
    sheet.getLastRow();

  if (
    lastRow < 2
  ) {
    throw new Error(
      'Cash withdrawal not found.'
    );
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        12
      )
      .getValues();

  const index =
    rows.findIndex(
      r =>
        String(
          r[11] || ''
        ) === id
    );

  if (
    index < 0
  ) {
    throw new Error(
      'Cash withdrawal not found.'
    );
  }

  const row =
    rows[index];

  sheet.deleteRow(
    index + 2
  );

  return {
    ok: true,
    deleted: {
      date:
        normalizeDateCell_(
          row[0]
        ),
      amount:
        Number(
          row[1]
        ) || 0,
      currency:
        String(
          row[2] || ''
        ),
      usdEquivalent:
        Number(
          row[4]
        ) || 0,
      atmFee:
        Number(
          row[5]
        ) || 0,
      atmFeeUsd:
        Number(
          row[6]
        ) || 0,
      bankDebitUsd:
        Number(
          row[7]
        ) || 0,
      note:
        String(
          row[9] || ''
        ),
      entryId:
        String(
          row[11] || ''
        )
    }
  };
}

function getCashWallet(
  currency,
  today
) {
  validateTransactionSchema_();
  validateCashSchema_();

  const curr =
    String(
      currency || ''
    )
      .trim()
      .toUpperCase();

  const current =
    normalizeIsoDate_(
      today
    ) ||
    todayIso_();

  /*
    Fallback refresh path. Read each ledger once and pass the rows through
    so getCashState_ does not repeat schema checks or sheet reads.
  */
  const txSheet =
    getSheet_();

  const txLastRow =
    txSheet.getLastRow();

  const txRows =
    txLastRow >= 2
      ? txSheet
          .getRange(
            2,
            1,
            txLastRow - 1,
            15
          )
          .getValues()
      : [];

  const cashSheet =
    getCashSheet_();

  const cashLastRow =
    cashSheet.getLastRow();

  const cashRows =
    cashLastRow >= 2
      ? cashSheet
          .getRange(
            2,
            1,
            cashLastRow - 1,
            12
          )
          .getValues()
      : [];

  return getCashState_(
    curr,
    5,
    txRows,
    current,
    cashRows
  );
}

function getDashboard(
  today,
  currency
) {
  validateTransactionSchema_();
  validateCashSchema_();

  const current =
    normalizeIsoDate_(
      today
    ) ||
    todayIso_();

  return {
    recent:
      getRecentTransactions_(3),
    cash:
      getCashState_(
        String(
          currency || ''
        )
          .trim()
          .toUpperCase(),
        5,
        undefined,
        current
      ),
    summary:
      getSpendingSummary_(
        current
      )
  };
}

function getCashState_(
  currency,
  limit,
  providedTxRows,
  localToday,
  providedCashRows
) {
  if (!currency) {
    return {
      currency: '',
      balance: 0,
      withdrawals: 0,
      cashSpent: 0,
      calendarMonthFees: 0,
      calendarMonthFeesUsd: 0,
      recentWithdrawals: [],
      monthWithdrawals: []
    };
  }

  if (
    providedTxRows ===
      undefined &&
    providedCashRows ===
      undefined
  ) {
    validateCashSchema_();
    validateTransactionSchema_();
  }

  let withdrawals = 0;

  const recentWithdrawals = [];
  const monthWithdrawals = [];

  let calendarMonthFees = 0;
  let calendarMonthFeesUsd = 0;

  const today =
    normalizeIsoDate_(
      localToday
    ) ||
    todayIso_();

  const calendarMonthPrefix =
    today.slice(0, 7);

  let cashRows =
    providedCashRows;

  if (
    cashRows ===
      undefined
  ) {
    const cashSheet =
      getCashSheet_();

    const cashLastRow =
      cashSheet.getLastRow();

    cashRows =
      cashLastRow >= 2
        ? cashSheet
            .getRange(
              2,
              1,
              cashLastRow - 1,
              12
            )
            .getValues()
        : [];
  }

  if (
    cashRows.length
  ) {
    for (
      let i =
        cashRows.length - 1;
      i >= 0;
      i--
    ) {
      const r =
        cashRows[i];

      const rowCurrency =
        String(
          r[2] || ''
        ).toUpperCase();

      const rowDate =
        normalizeDateCell_(
          r[0]
        );

      const cashReceived =
        Number(r[1]) ||
        0;

      const withdrawalEntry = {
        date:
          rowDate,
        amount:
          cashReceived,
        currency:
          rowCurrency,
        fxRate:
          Number(r[3]) ||
          0,
        usdEquivalent:
          Number(r[4]) ||
          0,
        atmFee:
          Number(r[5]) ||
          0,
        atmFeeUsd:
          Number(r[6]) ||
          0,
        bankDebitUsd:
          Number(r[7]) ||
          0,
        note:
          String(
            r[9] || ''
          ),
        entryId:
          String(
            r[11] || ''
          )
      };

      if (
        rowDate &&
        rowDate.slice(0, 7) ===
          calendarMonthPrefix
      ) {
        monthWithdrawals
          .push(
            withdrawalEntry
          );
      }

      if (
        rowCurrency !==
        currency
      ) {
        continue;
      }

      withdrawals +=
        cashReceived;

      if (
        rowDate &&
        rowDate.slice(0, 7) ===
          calendarMonthPrefix
      ) {
        calendarMonthFees +=
          Number(r[5]) ||
          0;

        calendarMonthFeesUsd +=
          Number(r[6]) ||
          0;

        recentWithdrawals
          .push(
            withdrawalEntry
          );
      }
    }
  }

  let cashSpent = 0;

  let txRows =
    providedTxRows;

  if (
    txRows ===
      undefined
  ) {
    const txSheet =
      getSheet_();

    const txLastRow =
      txSheet.getLastRow();

    txRows =
      txLastRow >= 2
        ? txSheet
            .getRange(
              2,
              1,
              txLastRow - 1,
              15
            )
            .getValues()
        : [];
  }

  if (
    txRows.length
  ) {
    txRows.forEach(r => {
      const payment =
        String(
          r[3] || ''
        );

      const amount =
        Number(
          r[4]
        ) || 0;

      const rowCurrency =
        String(
          r[5] || ''
        )
          .toUpperCase();

      if (
        rowCurrency ===
          currency &&
        payment ===
          'Cash'
      ) {
        cashSpent +=
          amount;
      }
    });
  }

  return {
    currency,
    withdrawals:
      roundMoney_(
        withdrawals
      ),
    cashSpent:
      roundMoney_(
        cashSpent
      ),
    balance:
      roundMoney_(
        withdrawals -
        cashSpent
      ),
    calendarMonthFees:
      roundMoney_(
        calendarMonthFees
      ),
    calendarMonthFeesUsd:
      roundMoney_(
        calendarMonthFeesUsd
      ),
    recentWithdrawals,
    monthWithdrawals
  };
}

function getRecentTransactions_(
  limit,
  providedRows
) {
  let rows;

  if (
    providedRows !==
      undefined
  ) {
    rows =
      providedRows;
  } else {
    ensureEntryIds_();

    const sheet =
      getSheet_();

    const lastRow =
      sheet.getLastRow();

    if (
      lastRow < 2
    ) {
      return [];
    }

    rows =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          15
        )
        .getValues();
  }

  /*
    Housing is entered directly in the Google Sheet by the auditor.
    The app is an entry/display surface for non-Housing spending only.
  */
  const appRows =
    rows.filter(
      r =>
        normalizeCategory_(
          r[2]
        ) !==
        'Housing'
    );

  const n =
    Math.min(
      limit || 3,
      appRows.length
    );

  if (
    n <= 0
  ) {
    return [];
  }

  return appRows
    .slice(
      appRows.length - n
    )
    .reverse()
    .map(r => ({
      date:
        normalizeDateCell_(
          r[0]
        ),
      merchant:
        String(
          r[1] || ''
        ),
      category:
        String(
          r[2] || ''
        ),
      paymentMethod:
        String(
          r[3] || ''
        ),
      localAmount:
        String(
          r[4] == null
            ? ''
            : r[4]
        ),
      currency:
        String(
          r[5] || ''
        ),
      usdAmount:
        `$${Number(r[7] || 0).toFixed(2)}`,
      country:
        String(
          r[8] || ''
        ),
      note:
        String(
          r[9] || ''
        ),
      entryId:
        String(
          r[12] || ''
        ),
      receiptUrl:
        String(
          r[13] || ''
        )
    }));
}

function getSpendingSummary_(
  today,
  providedRows,
  providedStay
) {
  if (
    providedRows ===
      undefined
  ) {
    validateTransactionSchema_();
  }

  const current =
    normalizeIsoDate_(
      today
    ) ||
    todayIso_();

  const stay =
    providedStay ||
    getStayContextFromSheet_(
      current
    );

  const stayName = stay.name;
  const stayStart = stay.start;
  const stayEnd = stay.end || '';

  const period =
    getStayPeriod_(
      current,
      stayStart,
      stayEnd
    );

  const week =
    getStayWeek_(
      current,
      stayStart,
      stayEnd
    );

  const periodDays =
    Math.max(
      1,
      Math.round(
        (
          isoToUtcDate_(period.end).getTime() -
          isoToUtcDate_(period.start).getTime()
        ) /
        86400000
      ) + 1
    );

  const budgetConfig = getBudgetConfig_();
  const categoryLimits = budgetConfig.categories;
  const periodFactor =
    periodDays /
    budgetConfig.standardMonthDays;

  const categories = {};

  categoryLimits
    .forEach(x => {
      categories[x.name] = {
        name: x.name,
        monthlyLimit: x.limit,
        limit:
          x.limit == null
            ? null
            : roundMoney_(
                x.limit *
                periodFactor
              ),
        countsTowardAppLimit:
          Boolean(
            x.countsTowardAppLimit
          ),
        spent: 0
      };
    });

  let weekTotal = 0;
  let monthTotal = 0;
  let budgetTotal = 0;
  let stayTotal = 0;
  let legacyTravelStaySpent = 0;
  let legacyTravelStayCount = 0;

  const stayThrough =
    current < stayStart
      ? null
      : (
          stayEnd &&
          current > stayEnd
            ? stayEnd
            : current
        );

  let rows =
    providedRows;

  if (
    rows ===
      undefined
  ) {
    const sheet =
      getSheet_();

    const lastRow =
      sheet.getLastRow();

    rows =
      lastRow >= 2
        ? sheet
            .getRange(
              2,
              1,
              lastRow - 1,
              15
            )
            .getValues()
        : [];
  }

  if (
    rows.length
  ) {
    rows.forEach(r => {
      const date =
        normalizeDateCell_(
          r[0]
        );

      if (!date) {
        return;
      }

      const rawCategory =
        String(
          r[2] || ''
        ).trim();

      const category =
        normalizeCategory_(
          rawCategory
        );

      const usd =
        Number(
          r[7]
        ) || 0;

      /*
        Housing is recorded in the Google Sheet by the auditor and is
        deliberately outside every in-app spending summary.

        Travel & Irregular is no longer a before-quit app category.
        An old/queued v13.12.13 payload may still arrive with that exact
        category string. logExpense() intentionally saves it unchanged;
        summaries exclude it from totals and surface a move-to-Fixed-costs
        warning instead of silently dropping the row.
      */
      if (
        rawCategory ===
          'Travel & Irregular'
      ) {
        if (
          date >= stayStart &&
          (
            !stayEnd ||
            date <= stayEnd
          )
        ) {
          legacyTravelStaySpent += usd;
          legacyTravelStayCount += 1;
        }
        return;
      }

      if (
        category ===
        'Housing'
      ) {
        return;
      }

      if (
        date >=
          week.start &&
        date <=
          week.end
      ) {
        weekTotal += usd;
      }

      if (
        date >=
          period.start &&
        date <=
          period.end
      ) {
        monthTotal += usd;

        if (
          category &&
          categories[
            category
          ]
        ) {
          categories[
            category
          ].spent += usd;

          if (
            categories[
              category
            ].countsTowardAppLimit
          ) {
            budgetTotal +=
              usd;
          }
        }
      }

      if (
        stayThrough &&
        date >=
          stayStart &&
        date <=
          stayThrough
      ) {
        stayTotal += usd;
      }
    });
  }

  const categoryList =
    categoryLimits
      .map(x => ({
        name: x.name,
        monthlyLimit:
          x.limit,
        limit:
          categories[
            x.name
          ].limit,
        spent:
          roundMoney_(
            categories[
              x.name
            ].spent
          )
      }));

  return {
    stayName,
    stayStart,
    stayEnd,
    stayStatus: stay.status,
    staySource: STAYS_SHEET_NAME,
    periodNumber:
      period.number,
    periodStart:
      period.start,
    periodEnd:
      period.end,
    weekStart:
      week.start,
    weekEnd:
      week.end,
    weeklyTotal:
      roundMoney_(
        weekTotal
      ),
    monthlyTotal:
      roundMoney_(
        monthTotal
      ),
    budgetTotal:
      roundMoney_(
        budgetTotal
      ),
    budgetLimit:
      roundMoney_(
        budgetConfig.monthlyBudgetLimit *
        periodFactor
      ),
    monthlyBudgetLimit:
      budgetConfig.monthlyBudgetLimit,
    periodDays,
    stayTotal:
      roundMoney_(
        stayTotal
      ),
    categories:
      categoryList,
    legacyTravelNeedsMove:
      legacyTravelStayCount > 0,
    legacyTravelCount:
      legacyTravelStayCount,
    legacyTravelUsd:
      roundMoney_(
        legacyTravelStaySpent
      )
  };
}

function exportStayCsv() {
  ensureSchema_();

  const stay =
    getStayContextFromSheet_(
      todayIso_()
    );

  const stayName = stay.name;
  const stayStart = stay.start;
  const stayEnd = stay.end || todayIso_();

  const sheet =
    getSheet_();

  const lastRow =
    sheet.getLastRow();

  const output = [
    TRANSACTION_HEADERS
  ];

  if (
    lastRow >= 2
  ) {
    const rows =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          15
        )
        .getDisplayValues();

    rows.forEach(r => {
      const date =
        normalizeIsoDate_(
          r[0]
        );

      if (
        date &&
        date >=
          stayStart &&
        date <=
          stayEnd
      ) {
        output.push(r);
      }
    });
  }

  const csv =
    output
      .map(row =>
        row
          .map(csvEscape_)
          .join(',')
      )
      .join('\r\n');

  const safeName =
    sanitizeFileName_(
      stayName
    )
      .replace(/\s+/g, '_') ||
    'Stay';

  return {
    filename:
      `${safeName}_${stayStart}_${stayEnd}_spending.csv`,
    csv
  };
}

function saveReceipt_(
  dataUrl,
  date,
  label,
  entryId
) {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
      .exec(dataUrl);

  if (!match) {
    throw new Error(
      'Receipt image format is invalid.'
    );
  }

  const mimeType =
    match[1];

  const base64 =
    match[2];

  if (
    base64.length >
    MAX_RECEIPT_BASE64_CHARS
  ) {
    throw new Error(
      'Receipt image is too large to save.'
    );
  }

  const bytes =
    Utilities
      .base64Decode(
        base64
      );

  const ext =
    mimeType ===
      'image/png'
      ? 'png'
      : (
          mimeType ===
            'image/webp'
            ? 'webp'
            : 'jpg'
        );

  const safeLabel =
    sanitizeFileName_(
      label
    )
      .slice(
        0,
        60
      ) ||
    'receipt';

  const fileName =
    `${date}_${safeLabel}_${entryId.slice(0,8)}.${ext}`;

  const [
    year,
    month
  ] =
    date.split('-');

  const root =
    DriveApp
      .getFolderById(
        getReceiptRootFolderId_()
      );

  const yearFolder =
    getOrCreateFolder_(
      root,
      year
    );

  const monthFolder =
    getOrCreateFolder_(
      yearFolder,
      month
    );

  const blob =
    Utilities
      .newBlob(
        bytes,
        mimeType,
        fileName
      );

  const file =
    monthFolder
      .createFile(
        blob
      );

  return {
    ok: true,
    url:
      file.getUrl(),
    fileId:
      file.getId(),
    name:
      file.getName()
  };
}

function validateTransactionSchema_() {
  const sheet = getSheet_();

  if (sheet.getMaxColumns() < TRANSACTION_HEADERS.length) {
    throw new Error('Transactions sheet has fewer than 15 columns. Run schema maintenance before using the app.');
  }

  const current = sheet
    .getRange(1, 1, 1, TRANSACTION_HEADERS.length)
    .getDisplayValues()[0]
    .map(x => String(x || '').trim());

  const ok = TRANSACTION_HEADERS.every((h, i) => current[i] === h);

  if (!ok) {
    throw new Error(
      'Transactions header mismatch. Expected: ' +
      TRANSACTION_HEADERS.join(' | ')
    );
  }
}

function validateCashSchema_() {
  const sheet = getCashSheet_();
  const headers = [
    'Date',
    'Cash Received',
    'Currency',
    'Reference FX Rate to USD',
    'Estimated Cash USD',
    'ATM Fee',
    'Estimated ATM Fee USD',
    'Exact Bank USD Debit',
    'Country',
    'Note',
    'Logged At',
    'Entry ID'
  ];

  if (sheet.getMaxColumns() < headers.length) {
    throw new Error('Cash Wallet sheet has fewer than 12 columns. Run schema maintenance before using the app.');
  }

  const current = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0]
    .map(x => String(x || '').trim());

  const ok = headers.every((h, i) => current[i] === h);

  if (!ok) {
    throw new Error(
      'Cash Wallet header mismatch. Expected: ' +
      headers.join(' | ')
    );
  }
}

function runSchemaMaintenance() {
  ensureSchema_();
  ensureCashSheet_();
  return { ok: true, appVersion: APP_VERSION };
}

function ensureSchema_() {
  const sheet =
    getSheet_();

  migrateTransactionSchema_(
    sheet
  );

  sheet.setFrozenRows(1);

  if (
    sheet.getMaxColumns() <
    15
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      15 -
      sheet.getMaxColumns()
    );
  }

  /*
    Receipt File ID is internal.
    Receipt Link remains visible.
  */
  try {
    sheet.showColumns(
      14,
      1
    );
  } catch (_) {}

  if (
    !sheet.isColumnHiddenByUser(
      15
    )
  ) {
    sheet.hideColumns(
      15,
      1
    );
  }

  sheet
    .getRange(
      'A:A'
    )
    .setNumberFormat(
      'yyyy-mm-dd'
    );

  sheet
    .getRange(
      'E:E'
    )
    .setNumberFormat(
      '#,##0.00'
    );

  sheet
    .getRange(
      'G:G'
    )
    .setNumberFormat(
      '0.000000'
    );

  sheet
    .getRange(
      'H:H'
    )
    .setNumberFormat(
      '$#,##0.00'
    );

  ensureEntryIds_();
}

function migrateTransactionSchema_(sheet) {
  const lastRow =
    Math.max(
      sheet.getLastRow(),
      1
    );

  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      15
    );

  if (
    sheet.getMaxColumns() <
    lastColumn
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      lastColumn -
      sheet.getMaxColumns()
    );
  }

  const header =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getDisplayValues()[0]
      .map(x =>
        String(
          x || ''
        ).trim()
      );

  const alreadyCorrect =
    TRANSACTION_HEADERS
      .every(
        (h, i) =>
          header[i] === h
      );

  if (
    alreadyCorrect
  ) {
    return;
  }

  const hasKnownSchema =
    header.includes(
      'Date'
    ) &&
    header.includes(
      'Merchant'
    ) &&
    header.includes(
      'Category'
    );

  if (
    !hasKnownSchema
  ) {
    sheet
      .getRange(
        1,
        1,
        1,
        15
      )
      .setValues([
        TRANSACTION_HEADERS
      ]);

    return;
  }

  const source =
    sheet
      .getRange(
        1,
        1,
        lastRow,
        lastColumn
      )
      .getValues();

  const index = {};

  header.forEach(
    (h, i) => {
      if (
        h &&
        index[h] ===
          undefined
      ) {
        index[h] = i;
      }
    }
  );

  const reordered = [
    TRANSACTION_HEADERS
  ];

  for (
    let r = 1;
    r < source.length;
    r++
  ) {
    const sourceRow =
      source[r];

    const out =
      TRANSACTION_HEADERS
        .map(h => {
          const i =
            index[h];

          return i ===
            undefined
            ? ''
            : sourceRow[i];
        });

    reordered.push(
      out
    );
  }

  sheet
    .getRange(
      1,
      1,
      lastRow,
      lastColumn
    )
    .clearContent();

  sheet
    .getRange(
      1,
      1,
      reordered.length,
      15
    )
    .setValues(
      reordered
    );
}

function ensureCashSheet_() {
  const ss =
    getSpreadsheet_();

  let sheet =
    ss.getSheetByName(
      CASH_SHEET_NAME
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        CASH_SHEET_NAME
      );
  }

  const headers = [
    'Date',
    'Cash Received',
    'Currency',
    'Reference FX Rate to USD',
    'Estimated Cash USD',
    'ATM Fee',
    'Estimated ATM Fee USD',
    'Exact Bank USD Debit',
    'Country',
    'Note',
    'Logged At',
    'Entry ID'
  ];

  if (
    sheet.getMaxColumns() <
    headers.length
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length -
      sheet.getMaxColumns()
    );
  }

  const lastRow =
    Math.max(
      sheet.getLastRow(),
      1
    );

  const sourceLastCol =
    Math.max(
      sheet.getLastColumn(),
      headers.length
    );

  const current =
    sheet
      .getRange(
        1,
        1,
        1,
        sourceLastCol
      )
      .getDisplayValues()[0]
      .map(x =>
        String(x || '').trim()
      );

  const alreadyCorrect =
    headers.every(
      (h, i) =>
        current[i] === h
    );

  if (!alreadyCorrect) {
    const source =
      lastRow >= 2
        ? sheet
            .getRange(
              1,
              1,
              lastRow,
              sourceLastCol
            )
            .getValues()
        : [];

    const index = {};

    current.forEach(
      (h, i) => {
        if (
          h &&
          index[h] === undefined
        ) {
          index[h] = i;
        }
      }
    );

    const rows = [
      headers
    ];

    const looksIsoTimestamp =
      value =>
        /^\d{4}-\d{2}-\d{2}T/
          .test(
            String(
              value || ''
            )
          );

    const looksEntryId =
      value =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          .test(
            String(
              value || ''
            )
          );

    for (
      let r = 1;
      r < source.length;
      r++
    ) {
      const s =
        source[r];

      const pick = (...names) => {
        for (
          const name of names
        ) {
          if (
            index[name] !==
            undefined
          ) {
            return s[
              index[name]
            ];
          }
        }

        return '';
      };

      /*
        A brief v13.12.2 test window could append the NEW 12-column
        row shape while the sheet still had the OLD 12-column header:
          H exact bank USD, I country, J note, K logged-at, L entry-id.
        Detect that shape before header-based migration so those rows
        are not misread as H=Country / K=Entry ID / L=Entry Type.
      */
      const partialV13122Row =
        !current.includes(
          'Exact Bank USD Debit'
        ) &&
        looksIsoTimestamp(
          s[10]
        ) &&
        looksEntryId(
          s[11]
        );

      if (
        partialV13122Row
      ) {
        rows.push([
          s[0],
          Number(
            s[1]
          ) || 0,
          s[2],
          s[3],
          s[4],
          s[5],
          s[6],
          s[7],
          s[8],
          s[9],
          s[10],
          s[11]
        ]);

        continue;
      }

      const adjustment =
        Number(
          pick(
            'Adjustment'
          )
        ) || 0;

      const entryType =
        String(
          pick(
            'Entry Type'
          ) || ''
        ).trim();

      if (
        entryType ===
          'Adjustment' ||
        adjustment !==
          0
      ) {
        continue;
      }

      rows.push([
        pick('Date'),
        Number(
          pick(
            'Cash Received',
            'Amount'
          )
        ) || 0,
        pick('Currency'),
        pick(
          'Reference FX Rate to USD',
          'FX Rate to USD'
        ),
        pick(
          'Estimated Cash USD',
          'Cash USD Equivalent',
          'USD Equivalent'
        ),
        pick('ATM Fee'),
        pick(
          'Estimated ATM Fee USD',
          'ATM Fee USD'
        ),
        pick(
          'Exact Bank USD Debit'
        ),
        pick('Country'),
        pick('Note'),
        pick('Logged At'),
        pick('Entry ID') ||
          Utilities.getUuid()
      ]);
    }

    sheet
      .getRange(
        1,
        1,
        lastRow,
        sourceLastCol
      )
      .clearContent();

    sheet
      .getRange(
        1,
        1,
        rows.length,
        headers.length
      )
      .setValues(
        rows
      );
  }

  sheet.setFrozenRows(1);

  sheet
    .getRange('A:A')
    .setNumberFormat(
      'yyyy-mm-dd'
    );

  sheet
    .getRange('B:B')
    .setNumberFormat(
      '#,##0.00'
    );

  sheet
    .getRange('D:D')
    .setNumberFormat(
      '0.000000'
    );

  sheet
    .getRange('E:E')
    .setNumberFormat(
      '$0.00'
    );

  sheet
    .getRange('F:F')
    .setNumberFormat(
      '#,##0.00'
    );

  sheet
    .getRange('G:H')
    .setNumberFormat(
      '$0.00'
    );

}

function getReceiptRootFolderId_() {
  const id =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(
          RECEIPT_ROOT_FOLDER_PROPERTY
        ) || ''
    ).trim();

  if (!id) {
    throw new Error(
      'Lexi Spend receipt folder is not configured.'
    );
  }

  return id;
}

function getSpreadsheetId_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY) || ''
  ).trim();
  if (!id) throw new Error('Lexi Spend spreadsheet is not configured.');
  return id;
}

function getSpreadsheet_() {
  if (!SPREADSHEET_CACHE_) {
    SPREADSHEET_CACHE_ = SpreadsheetApp.openById(getSpreadsheetId_());
  }
  return SPREADSHEET_CACHE_;
}

function getSheet_() {
  const sheet =
    getSpreadsheet_()
      .getSheetByName(
        SHEET_NAME
      );

  if (!sheet) {
    throw new Error(
      'Transactions sheet not found.'
    );
  }

  return sheet;
}

function getBudgetConfig_() {
  if (BUDGET_CONFIG_CACHE_) return BUDGET_CONFIG_CACHE_;

  const sheet = getSpreadsheet_().getSheetByName(SETUP_SHEET_NAME);
  if (!sheet) throw new Error('Setup sheet not found.');

  const monthlyBudgetLimit = Number(sheet.getRange('B4').getValue());
  const standardMonthDays = Number(sheet.getRange('B5').getValue());
  const rows = sheet.getRange('D2:F20').getValues();

  const categories = rows
    .map(row => ({
      name: String(row[0] || '').trim(),
      limit: row[1] === '' ? null : Number(row[1]),
      treatment: String(row[2] || '').trim().toLowerCase()
    }))
    .filter(row => row.name && (row.treatment === 'budgeted' || row.treatment === 'no limit'))
    .map(row => ({
      name: row.name,
      limit: row.limit == null || !Number.isFinite(row.limit) ? null : row.limit,
      countsTowardAppLimit: row.treatment === 'budgeted'
    }));

  if (!Number.isFinite(monthlyBudgetLimit) || monthlyBudgetLimit <= 0) {
    throw new Error('Setup app monthly limit is invalid.');
  }
  if (!Number.isFinite(standardMonthDays) || standardMonthDays <= 0) {
    throw new Error('Setup standard month days is invalid.');
  }
  if (!categories.length) throw new Error('Setup app categories are missing.');

  BUDGET_CONFIG_CACHE_ = { monthlyBudgetLimit, standardMonthDays, categories };
  return BUDGET_CONFIG_CACHE_;
}

function categoryKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeCategory_(value) {
  const key = categoryKey_(value);
  if (!key) return null;

  const configured = getBudgetConfig_().categories.find(item => categoryKey_(item.name) === key);
  if (configured) return configured.name;

  const housingAliases = ['housing', 'housingutilitiesinternet'];
  return housingAliases.includes(key) ? 'Housing' : null;
}

function ensureEntryIds_() {
  const sheet =
    getSheet_();

  const lastRow =
    sheet.getLastRow();

  if (
    lastRow < 2
  ) {
    return;
  }

  const range =
    sheet
      .getRange(
        2,
        13,
        lastRow - 1,
        1
      );

  const values =
    range.getValues();

  let changed = false;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    if (
      !values[i][0]
    ) {
      values[i][0] =
        Utilities
          .getUuid();

      changed = true;
    }
  }

  if (changed) {
    range.setValues(
      values
    );
  }
}

function getStayContextFromSheet_(today) {
  const current =
    normalizeIsoDate_(today) ||
    todayIso_();

  const sheet =
    getSpreadsheet_()
      .getSheetByName(
        STAYS_SHEET_NAME
      );

  if (!sheet) {
    throw new Error(
      'Stays sheet not found. Stay dates are owned by the Google Sheet.'
    );
  }

  const stayHeader =
    sheet
      .getRange(
        1,
        1,
        1,
        STAY_HEADERS.length
      )
      .getDisplayValues()[0]
      .map(x =>
        String(
          x || ''
        ).trim()
      );

  const staySchemaOk =
    STAY_HEADERS
      .every(
        (h, i) =>
          stayHeader[i] === h
      );

  if (!staySchemaOk) {
    throw new Error(
      'Stays sheet header mismatch. Expected: ' +
      STAY_HEADERS.join(' | ')
    );
  }

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error(
      'No stays are configured in the Stays tab.'
    );
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        STAY_HEADERS.length
      )
      .getValues();

  const stays = [];

  for (const r of rows) {
    const name =
      String(r[0] || '')
        .trim();

    const start =
      normalizeDateCell_(
        r[1]
      );

    const end =
      normalizeDateCell_(
        r[2]
      );

    const lowerCost =
      String(r[4] || '')
        .trim();

    /*
      Stay records are the contiguous table directly under the
      Stay / Start / End header. The first non-stay row ends that table.
      This keeps the fixed-cost and regional-span blocks below it from
      being misread even though those blocks also contain dates.
    */
    if (!name || !start) {
      if (stays.length) {
        break;
      }
      continue;
    }

    if (
      end &&
      end < start
    ) {
      throw new Error(
        `Invalid Stays row for ${name}: end date is before start date.`
      );
    }

    stays.push({
      name,
      start,
      end: end || '',
      lowerCost,
      note:
        String(r[5] || '')
          .trim()
    });
  }

  if (!stays.length) {
    throw new Error(
      'No valid stay rows were found in the Stays tab.'
    );
  }

  stays.sort(
    (a, b) =>
      a.start.localeCompare(
        b.start
      )
  );

  let selected =
    stays
      .filter(s =>
        current >= s.start &&
        (
          !s.end ||
          current <= s.end
        )
      )
      .pop();

  let status = 'active';

  if (!selected) {
    selected =
      stays.find(
        s => s.start > current
      );

    if (selected) {
      status = 'upcoming';
    } else {
      selected =
        stays[
          stays.length - 1
        ];
      status = 'past';
    }
  } else if (!selected.end) {
    status = 'active-open-end';
  }

  return {
    ...selected,
    status,
    source: STAYS_SHEET_NAME
  };
}

function getStayPeriod_(
  today,
  stayStart,
  stayEnd
) {
  const periods = [];

  let n = 1;
  let start =
    stayStart;

  while (
    (
      !stayEnd ||
      start <= stayEnd
    ) &&
    n <= 24
  ) {
    const next =
      addMonthsIso_(
        stayStart,
        n
      );

    const calculatedEnd =
      addDaysIso_(
        next,
        -1
      );

    const end =
      stayEnd &&
      calculatedEnd > stayEnd
        ? stayEnd
        : calculatedEnd;

    periods.push({
      number: n,
      start,
      end
    });

    if (
      stayEnd &&
      end >= stayEnd
    ) {
      break;
    }

    n++;
    start = next;
  }

  if (
    today <= stayStart
  ) {
    return periods[0];
  }

  for (
    const p of periods
  ) {
    if (
      today >= p.start &&
      today <= p.end
    ) {
      return p;
    }
  }

  return periods[
    periods.length - 1
  ];
}

function getStayWeek_(
  today,
  stayStart,
  stayEnd
) {
  const current =
    today < stayStart
      ? stayStart
      : (
          stayEnd &&
          today > stayEnd
            ? stayEnd
            : today
        );

  const startMs =
    isoToUtcDate_(
      stayStart
    ).getTime();

  const currentMs =
    isoToUtcDate_(
      current
    ).getTime();

  const daysFromStart =
    Math.max(
      0,
      Math.floor(
        (
          currentMs -
          startMs
        ) /
        86400000
      )
    );

  const blockIndex =
    Math.floor(
      daysFromStart /
      7
    );

  const start =
    addDaysIso_(
      stayStart,
      blockIndex *
      7
    );

  const uncappedEnd =
    addDaysIso_(
      start,
      6
    );

  return {
    start,
    end:
      stayEnd &&
      uncappedEnd > stayEnd
        ? stayEnd
        : uncappedEnd
  };
}

function getCashSheet_() {
  const sheet =
    getSpreadsheet_()
      .getSheetByName(
        CASH_SHEET_NAME
      );

  if (!sheet) {
    throw new Error(
      'Cash Wallet sheet not found.'
    );
  }

  return sheet;
}

function getOrCreateFolder_(
  parent,
  name
) {
  const it =
    parent
      .getFoldersByName(
        name
      );

  return it.hasNext()
    ? it.next()
    : parent
        .createFolder(
          name
        );
}

function sanitizeFileName_(s) {
  return String(
    s || ''
  )
    .replace(
      /[\/:*?"<>|#%{}[\]~]/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function getUsdRate_(
  currency,
  date
) {
  if (
    currency ===
    'USD'
  ) {
    return {
      rate: 1,
      effectiveDate:
        date,
      source:
        'USD base rate = 1'
    };
  }

  const cache =
    CacheService
      .getScriptCache();

  /*
    Fetch USD -> local currency, then invert.
    Frankfurter's local -> USD quote can be materially rounded
    for high-unit currencies such as VND.
  */
  const cacheKey =
    `fx:USD:${currency}:${date}:inverse:v13.11`;

  const cached =
    cache.get(
      cacheKey
    );

  if (cached) {
    return JSON.parse(
      cached
    );
  }

  const url =
    `${FX_API}/usd/${encodeURIComponent(currency.toLowerCase())}?date=${encodeURIComponent(date)}`;

  const response =
    UrlFetchApp
      .fetch(
        url,
        {
          muteHttpExceptions:
            true,
          headers: {
            Accept:
              'application/json'
          }
        }
      );

  const status =
    response
      .getResponseCode();

  if (
    status < 200 ||
    status >= 300
  ) {
    throw new Error(
      `FX lookup failed (${status}).`
    );
  }

  const data =
    JSON.parse(
      response
        .getContentText()
    );

  const localPerUsd =
    Number(
      data.rate
    );

  if (
    !Number.isFinite(
      localPerUsd
    ) ||
    localPerUsd <= 0
  ) {
    throw new Error(
      'FX lookup returned an invalid rate.'
    );
  }

  const rate =
    1 /
    localPerUsd;

  const effectiveDate =
    data.date ||
    date;

  const result = {
    rate,
    effectiveDate,
    source:
      `Frankfurter v2 USD→${currency} inverse (${effectiveDate})`
  };

  cache.put(
    cacheKey,
    JSON.stringify(
      result
    ),
    21600
  );

  return result;
}

function normalizeIsoDate_(value) {
  const s =
    String(
      value || ''
    ).trim();

  return /^\d{4}-\d{2}-\d{2}$/
    .test(s)
    ? s
    : '';
}

function getSpreadsheetTimeZone_() {
  if (
    !SPREADSHEET_TIME_ZONE_CACHE_
  ) {
    const ss =
      getSpreadsheet_();

    SPREADSHEET_TIME_ZONE_CACHE_ =
      ss.getSpreadsheetTimeZone() ||
      Session.getScriptTimeZone() ||
      'UTC';
  }

  return (
    SPREADSHEET_TIME_ZONE_CACHE_
  );
}

function normalizeDateCell_(value) {
  const timeZone =
    getSpreadsheetTimeZone_();

  if (
    value instanceof Date
  ) {
    return Utilities
      .formatDate(
        value,
        timeZone,
        'yyyy-MM-dd'
      );
  }

  const s =
    String(
      value || ''
    ).trim();

  const direct =
    s.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const parsed =
    new Date(s);

  if (
    !isNaN(
      parsed.getTime()
    )
  ) {
    return Utilities
      .formatDate(
        parsed,
        timeZone,
        'yyyy-MM-dd'
      );
  }

  return '';
}

function todayIso_() {
  return Utilities
    .formatDate(
      new Date(),
      Session
        .getScriptTimeZone() ||
      'UTC',
      'yyyy-MM-dd'
    );
}

function isoToUtcDate_(iso) {
  const [
    y,
    m,
    d
  ] =
    iso
      .split('-')
      .map(Number);

  return new Date(
    Date.UTC(
      y,
      m - 1,
      d
    )
  );
}

function dateToIso_(d) {
  return [
    d.getUTCFullYear(),
    String(
      d.getUTCMonth() + 1
    ).padStart(2,'0'),
    String(
      d.getUTCDate()
    ).padStart(2,'0')
  ].join('-');
}

function addDaysIso_(
  iso,
  days
) {
  const d =
    isoToUtcDate_(
      iso
    );

  d.setUTCDate(
    d.getUTCDate() +
    days
  );

  return dateToIso_(d);
}

function addMonthsIso_(
  iso,
  months
) {
  const [
    y,
    m,
    day
  ] =
    iso
      .split('-')
      .map(Number);

  const base =
    new Date(
      Date.UTC(
        y,
        m - 1 + months,
        1
      )
    );

  const targetYear =
    base.getUTCFullYear();

  const targetMonth =
    base.getUTCMonth();

  const lastDay =
    new Date(
      Date.UTC(
        targetYear,
        targetMonth + 1,
        0
      )
    )
      .getUTCDate();

  const d =
    new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(
          day,
          lastDay
        )
      )
    );

  return dateToIso_(d);
}

function csvEscape_(value) {
  const s =
    String(
      value == null
        ? ''
        : value
    );

  return `"${s.replace(/"/g,'""')}"`;
}

function roundMoney_(n) {
  return (
    Math.round(
      (
        Number(n) +
        Number.EPSILON
      ) *
      100
    ) /
    100
  );
}

function setupLexiSpendApiCode() {
  const props = PropertiesService.getScriptProperties();
  const apiCode =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  props.setProperty(
    'LEXI_SPEND_API_CODE_SHA256',
    lexiSpendSha256Hex_(apiCode)
  );

  console.log('LEXI_SPEND_API_CODE=' + apiCode);
  return apiCode;
}

function runLexiSpendApiFunction_(functionName, parameters) {
  switch (functionName) {
    case 'getAppState':
      return getAppState.apply(null, parameters);
    case 'previewUsd':
      return previewUsd.apply(null, parameters);
    case 'getDashboard':
      return getDashboard.apply(null, parameters);
    case 'getCashWallet':
      return getCashWallet.apply(null, parameters);
    case 'uploadReceipt':
      return uploadReceipt.apply(null, parameters);
    case 'deleteReceiptFile':
      return deleteReceiptFile.apply(null, parameters);
    case 'logExpense':
      return logExpense.apply(null, parameters);
    case 'deleteExpense':
      return deleteExpense.apply(null, parameters);
    case 'addCashWithdrawal':
      return addCashWithdrawal.apply(null, parameters);
    case 'deleteCashWithdrawal':
      return deleteCashWithdrawal.apply(null, parameters);
    default:
      throw new Error('Unsupported API function.');
  }
}

function assertLexiSpendApiCode_(apiCode) {
  const expectedHash =
    PropertiesService.getScriptProperties().getProperty(
      'LEXI_SPEND_API_CODE_SHA256'
    );

  if (!expectedHash) {
    throw new Error(
      'Lexi Spend API code has not been configured yet.'
    );
  }

  const supplied = String(apiCode || '').trim();

  if (!supplied) {
    throw new Error('Missing Lexi Spend API code.');
  }

  if (lexiSpendSha256Hex_(supplied) !== expectedHash) {
    throw new Error('Invalid Lexi Spend API code.');
  }
}

function lexiSpendSha256Hex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  )
    .map(function(byte) {
      const unsigned = (byte + 256) % 256;
      return ('0' + unsigned.toString(16)).slice(-2);
    })
    .join('');
}

function doPost(e) {
  try {
    const raw =
      e &&
      e.postData &&
      e.postData.contents
        ? e.postData.contents
        : '';

    const body =
      JSON.parse(raw || '{}');

    const apiCode =
      String(body.apiCode || '');

    const functionName =
      String(
        body.functionName ||
        body.function ||
        ''
      ).trim();

    const parameters =
      Array.isArray(body.parameters)
        ? body.parameters
        : [];

    assertLexiSpendApiCode_(
      apiCode
    );

    const result =
      runLexiSpendApiFunction_(
        functionName,
        parameters
      );

    return ContentService
      .createTextOutput(
        JSON.stringify({
          ok: true,
          result:
            result === undefined
              ? null
              : result
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  } catch (err) {
    return ContentService
      .createTextOutput(
        JSON.stringify({
          ok: false,
          error:
            err && err.message
              ? String(err.message)
              : String(err)
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }
}
