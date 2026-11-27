const DAY_MS = 24 * 60 * 60 * 1000;

function parseBoundary(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${field} must be a valid date`), { status: 400 });
  }
  const clean = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(clean);
  const date = new Date(clean);
  if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== clean)) {
    throw Object.assign(new Error(`${field} must be a valid date`), { status: 400 });
  }
  return { date, dateOnly };
}

function movementDateMatch(from, to, field = 'movementLog.createdAt') {
  const lower = parseBoundary(from, 'from');
  const upper = parseBoundary(to, 'to');
  if (!lower && !upper) return null;
  const range = {};
  if (lower) range.$gte = lower.date;
  if (upper) {
    if (upper.dateOnly) {
      range.$lt = new Date(upper.date.getTime() + DAY_MS);
    } else {
      range.$lte = upper.date;
    }
  }
  return { [field]: range };
}

function sumGroups(groups, predicate) {
  return groups.reduce((total, row) => predicate(row)
    ? { count: total.count + Number(row.count || 0), quantity: total.quantity + Number(row.quantity || 0) }
    : total, { count: 0, quantity: 0 });
}

function movementTotals(groups) {
  // GRN receipt is the physical arrival event. Its later putaway creates a
  // destination stock-in for internal movement, so exclude that from receipts.
  const received = sumGroups(groups, row => row.type === 'receipt'
    || (row.type === 'stock-in' && row.referenceType !== 'goods_receipt'));
  // Dispatch is the only modern event that removes goods from warehouse custody.
  // Legacy stock-out is used by the old picking/ticket path and is not dispatch.
  const shipped = sumGroups(groups, row => row.type === 'dispatch');
  const quarantined = sumGroups(groups, row => row.type === 'quarantine');
  const adjustments = sumGroups(groups, row => row.type === 'adjustment');
  return {
    received,
    shipped,
    quarantined,
    adjustments,
    // Compatibility keys consumed by the existing reports page.
    stockIn: received,
    stockOut: shipped
  };
}

function qualityTotals(rows) {
  return rows.reduce((total, row) => ({
    rejected: total.rejected + Number(row.rejected || 0),
    damaged: total.damaged + Number(row.damaged || 0),
    incorrect: total.incorrect + Number(row.incorrect || 0)
  }), { rejected: 0, damaged: 0, incorrect: 0 });
}

module.exports = { movementDateMatch, movementTotals, qualityTotals };
