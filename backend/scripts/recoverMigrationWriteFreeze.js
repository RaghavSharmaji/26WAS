require('dotenv').config();
const mongoose = require('mongoose');
const {
  CONTROL_COLLECTION, CONTROL_ID, OWNER_STOPPED_CONFIRMATION, inspectWriteFreeze,
  recoverAbandonedWriteLease, recoverAbandonedMigrationLock
} = require('../middleware/migrationWriteFreeze');

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--apply') options.apply = true;
    else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = args[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      if (!['lease-id', 'owner-instance-id', 'lock-token', 'operator', 'reason', 'confirm-owner-stopped'].includes(key)) {
        throw new Error(`Unknown option: ${value}`);
      }
      options[key] = next;
      index += 1;
    } else throw new Error(`Unexpected argument: ${value}`);
  }
  return options;
}

async function run(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.trim()) throw new Error('MONGODB_URI is required in the current process environment.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const db = mongoose.connection.db;
    if (!options.apply) {
      const snapshot = await inspectWriteFreeze(db);
      if (!snapshot.exists) {
        console.log(JSON.stringify({ exists: false, collection: CONTROL_COLLECTION, id: CONTROL_ID }, null, 2));
        return snapshot;
      }
      console.log(JSON.stringify(snapshot, null, 2));
      if (!snapshot.consistent) process.exitCode = 2;
      return snapshot;
    }

    const hasLease = Boolean(options['lease-id']);
    const hasLock = Boolean(options['lock-token']);
    if (hasLease === hasLock) throw new Error('Apply must name exactly one target: --lease-id or --lock-token.');
    const operator = options.operator || process.env.WAREFLOW_RECOVERY_OPERATOR;
    const shared = {
      operator,
      reason: options.reason,
      confirmation: options['confirm-owner-stopped']
    };
    const audit = hasLease
      ? await recoverAbandonedWriteLease(db, { ...shared, leaseId: options['lease-id'], ownerInstanceId: options['owner-instance-id'] })
      : await recoverAbandonedMigrationLock(db, { ...shared, lockToken: options['lock-token'], ownerInstanceId: options['owner-instance-id'] });
    console.log(JSON.stringify({ recovered: true, audit }, null, 2));
    return audit;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(`Write-freeze inspection/recovery stopped: ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
}

module.exports = { parseArgs, run, OWNER_STOPPED_CONFIRMATION };
