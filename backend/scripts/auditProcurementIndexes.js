#!/usr/bin/env node
'use strict';

// Read-only index/data audit. This file deliberately does not load the app,
// dotenv, or Mongoose models, and contains no index or document write calls.
const crypto = require('crypto');
const mongoose = require('mongoose');

const EXPECTED = [
  {
    collection: 'inventory_operations', name: 'unique_inventory_operation_request_company',
    key: { companyId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  },
  {
    collection: 'inventory_operations', name: 'unique_inventory_operation_request_legacy',
    key: { ownerId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: null }
  },
  {
    collection: 'goods_receipts', name: 'companyId_1_reference_1',
    key: { companyId: 1, reference: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  },
  {
    collection: 'goods_receipts', name: 'ownerId_1_reference_1',
    key: { ownerId: 1, reference: 1 }, unique: true,
    partialFilterExpression: { companyId: null }
  },
  {
    collection: 'goods_receipts', name: 'unique_grn_request',
    key: { companyId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  },
  {
    collection: 'goods_receipts', name: 'unique_legacy_grn_request',
    key: { ownerId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: null }
  },
  {
    collection: 'putaways', name: 'unique_putaway_request',
    key: { companyId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  },
  {
    collection: 'putaways', name: 'unique_legacy_putaway_request',
    key: { ownerId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: null }
  },
  {
    collection: 'purchase_orders', name: 'companyId_1_reference_1',
    key: { companyId: 1, reference: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  },
  {
    collection: 'purchase_orders', name: 'ownerId_1_reference_1',
    key: { ownerId: 1, reference: 1 }, unique: true,
    partialFilterExpression: { companyId: null }
  }
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function same(valueA, valueB) {
  return JSON.stringify(stable(valueA)) === JSON.stringify(stable(valueB));
}

function matchingIndex(expected, actual) {
  return same(expected.key, actual.key)
    && actual.unique === true
    && same(expected.partialFilterExpression, actual.partialFilterExpression || {});
}

function duplicatePipeline(spec, sampleLimit = 25) {
  const keyFields = Object.keys(spec.key);
  const groupKey = Object.fromEntries(keyFields.map(field => [field, `$${field}`]));
  return [
    { $match: spec.partialFilterExpression },
    { $group: { _id: groupKey, duplicateCount: { $sum: 1 } } },
    { $match: { duplicateCount: { $gt: 1 } } },
    { $sort: { duplicateCount: -1 } },
    { $limit: sampleLimit }
  ];
}

function publicDuplicate(row, spec) {
  const tuple = JSON.stringify(stable(row._id));
  const tenantScope = {};
  if (row._id?.companyId !== undefined) tenantScope.companyId = String(row._id.companyId);
  if (row._id?.ownerId !== undefined) tenantScope.ownerId = String(row._id.ownerId);
  return {
    collection: spec.collection,
    index: spec.name,
    fields: Object.keys(spec.key),
    tenantScope,
    tupleFingerprint: crypto.createHash('sha256').update(tuple).digest('hex').slice(0, 16),
    duplicateCount: row.duplicateCount
  };
}

async function auditDatabase(db) {
  const collectionNames = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  const byCollection = new Map();
  for (const spec of EXPECTED) {
    if (!byCollection.has(spec.collection)) byCollection.set(spec.collection, []);
    byCollection.get(spec.collection).push(spec);
  }

  const report = {
    mode: 'read-only dry-run',
    duplicateGroupSampleLimitPerIndex: 25,
    collections: [],
    summary: { requiredIndexes: EXPECTED.length, missingIndexes: 0, mismatchedIndexes: 0, duplicateGroupSamples: 0 }
  };
  for (const [collectionName, specs] of byCollection) {
    if (!collectionNames.has(collectionName)) {
      report.collections.push({ collection: collectionName, exists: false, indexes: [], required: specs.map(spec => ({ name: spec.name, status: 'missing' })), duplicateGroups: [] });
      report.summary.missingIndexes += specs.length;
      continue;
    }

    const collection = db.collection(collectionName);
    const actualIndexes = await collection.listIndexes().toArray();
    const required = [];
    const duplicates = [];
    for (const spec of specs) {
      const sameKey = actualIndexes.filter(index => same(spec.key, index.key));
      const exact = sameKey.find(index => matchingIndex(spec, index));
      const status = exact ? 'present' : sameKey.length ? 'mismatched' : 'missing';
      required.push({ name: spec.name, fields: spec.key, partialFilterExpression: spec.partialFilterExpression, status, actualIndexNames: sameKey.map(index => index.name) });
      if (status === 'missing') report.summary.missingIndexes += 1;
      if (status === 'mismatched') report.summary.mismatchedIndexes += 1;

      const groups = await collection.aggregate(duplicatePipeline(spec), { allowDiskUse: true }).toArray();
      groups.forEach(group => duplicates.push(publicDuplicate(group, spec)));
      report.summary.duplicateGroupSamples += groups.length;
    }

    const malformedCompanyIds = await collection.countDocuments({
      companyId: { $exists: true, $ne: null, $not: { $type: 'objectId' } }
    });
    const legacyWithoutOwner = await collection.countDocuments({
      $or: [{ companyId: null }, { companyId: { $exists: false } }], ownerId: { $exists: false }
    });
    report.collections.push({
      collection: collectionName,
      exists: true,
      indexes: actualIndexes.map(index => ({
        name: index.name, key: index.key, unique: index.unique === true,
        ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}),
        ...(index.sparse ? { sparse: true } : {})
      })),
      required,
      duplicateGroups: duplicates,
      scopeAnomalies: { nonObjectIdCompanyIds: malformedCompanyIds, legacyRecordsWithoutOwnerId: legacyWithoutOwner }
    });
  }
  report.summary.status = report.summary.missingIndexes || report.summary.mismatchedIndexes || report.summary.duplicateGroupSamples
    ? 'REVIEW REQUIRED' : 'REQUIRED INDEXES PRESENT; DUPLICATE CHECKS CLEAR';
  return report;
}

function parseArgs(args) {
  const allowed = new Set(['--dry-run', '--allow-remote-readonly', '--help']);
  const unknown = args.find(arg => !allowed.has(arg));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  return { dryRun: args.includes('--dry-run'), allowRemote: args.includes('--allow-remote-readonly'), help: args.includes('--help') };
}

function usage() {
  return [
    'Read-only procurement/idempotency index audit',
    'PowerShell:',
    '  $env:WAREFLOW_INDEX_AUDIT_URI = "mongodb://127.0.0.1:27017/wareflow_test"',
    '  node backend/scripts/auditProcurementIndexes.js --dry-run',
    'For a remote target, add --allow-remote-readonly only after confirming the URI targets the intended non-production database and the user has read-only privileges.',
    'This script never creates, alters, or drops indexes, and never writes or deletes records.'
  ].join('\n');
}

function uriTarget(uri) {
  let parsed;
  try { parsed = new URL(uri); } catch (_) { throw new Error('WAREFLOW_INDEX_AUDIT_URI is not a valid MongoDB URI'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error('Audit URI must use mongodb:// or mongodb+srv://');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!database) throw new Error('Audit URI must name a database in its path');
  return { hostname, database, isLocal };
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  if (!options.dryRun) throw new Error('Explicit --dry-run is required; this tool has no write mode');
  const uri = process.env.WAREFLOW_INDEX_AUDIT_URI;
  if (!uri) throw new Error('Set WAREFLOW_INDEX_AUDIT_URI in the current shell; the script does not load .env files');
  const target = uriTarget(uri);
  if (!target.isLocal && !options.allowRemote) throw new Error('Non-local target blocked. Add --allow-remote-readonly only after independently confirming the target and read-only database credentials.');

  await mongoose.connect(uri, {
    autoIndex: false,
    bufferCommands: false,
    readPreference: 'secondaryPreferred',
    serverSelectionTimeoutMS: 8000
  });
  try {
    const report = await auditDatabase(mongoose.connection.db);
    report.target = { host: target.hostname, database: target.database };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.summary.status === 'REVIEW REQUIRED') process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED, duplicatePipeline, matchingIndex, auditDatabase, parseArgs, uriTarget };
