const crypto = require('crypto');
const os = require('os');
const mongoose = require('mongoose');

const CONTROL_COLLECTION = 'wareflow_control';
const CONTROL_ID = 'company-migration-write-freeze';
const OWNER_STOPPED_CONFIRMATION = 'I_VERIFIED_THE_EXACT_OWNER_PROCESS_IS_STOPPED';
const initializedDatabases = new WeakMap();
const processIdentity = Object.freeze({
  instanceId: crypto.randomUUID(),
  pid: process.pid,
  hostname: os.hostname(),
  startedAt: new Date()
});

function controlCollection(db) {
  return db.collection(CONTROL_COLLECTION);
}

function modifiedDocument(result) {
  return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
}

function leaseCountMatches(record) {
  return Boolean(record && Array.isArray(record.activeWriteLeases)
    && Number.isInteger(record.activeWrites) && record.activeWrites >= 0
    && record.activeWrites === record.activeWriteLeases.length);
}

function validateControlRecord(record) {
  if (!leaseCountMatches(record)) {
    throw new Error('Shared write-freeze state is inconsistent or uses an unverifiable legacy counter; writes and migrations are blocked for operator review.');
  }
  if (!Array.isArray(record.recoveryAudit)) {
    throw new Error('Shared write-freeze recovery audit state is missing; writes and migrations are blocked for operator review.');
  }
  if (record.maintenance === true) {
    if (!record.lockToken || !record.lockOwner?.instanceId || !record.lockOwner?.hostname || !Number.isInteger(record.lockOwner?.pid)) {
      throw new Error('Migration freeze owner cannot be verified; writes and migrations are blocked for operator review.');
    }
  } else if (record.maintenance !== false || record.lockToken != null || record.lockOwner != null) {
    throw new Error('Shared migration lock state is ambiguous; writes and migrations are blocked for operator review.');
  }
  return record;
}

async function ensureControlRecord(db) {
  if (!initializedDatabases.has(db)) {
    const initialization = (async () => {
      const collection = controlCollection(db);
      try {
        await collection.updateOne(
          { _id: CONTROL_ID },
          { $setOnInsert: {
            maintenance: false, activeWrites: 0, activeWriteLeases: [],
            lockToken: null, lockOwner: null, lockedAt: null, recoveryAudit: []
          } },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }

      let record = await collection.findOne({ _id: CONTROL_ID });
      if (!record) throw new Error('Shared write-freeze control record could not be initialized.');

      // Safely upgrade only the known quiescent legacy shape. A non-zero legacy
      // counter or a legacy migration lock has no owner evidence and must remain
      // blocked for explicit operator reconciliation.
      if (!Array.isArray(record.activeWriteLeases) || !Array.isArray(record.recoveryAudit)) {
        if (record.maintenance !== false || record.activeWrites !== 0 || record.lockToken != null
          || record.lockOwner != null || record.lockedAt != null
          || (Array.isArray(record.activeWriteLeases) && record.activeWriteLeases.length !== 0)) {
          throw new Error('Legacy write-freeze state has active or unverifiable ownership; writes and migrations are blocked for operator review.');
        }
        await collection.updateOne(
          { _id: CONTROL_ID, maintenance: false, activeWrites: 0, lockToken: null, lockOwner: null, lockedAt: null, activeWriteLeases: { $exists: false } },
          { $set: { activeWriteLeases: [], recoveryAudit: [] } }
        );
        // Some legacy records may have the lease array but not the audit array.
        await collection.updateOne(
          { _id: CONTROL_ID, maintenance: false, activeWrites: 0, lockToken: null, lockOwner: null, lockedAt: null, activeWriteLeases: [], recoveryAudit: { $exists: false } },
          { $set: { recoveryAudit: [] } }
        );
        record = await collection.findOne({ _id: CONTROL_ID });
      }
      validateControlRecord(record);
    })();
    initializedDatabases.set(db, initialization);
  }
  try {
    await initializedDatabases.get(db);
  } catch (error) {
    initializedDatabases.delete(db);
    throw error;
  }
}

async function acquireApplicationWriteLease(db) {
  await ensureControlRecord(db);
  const lease = {
    leaseId: crypto.randomUUID(),
    ownerInstanceId: processIdentity.instanceId,
    pid: processIdentity.pid,
    hostname: processIdentity.hostname,
    acquiredAt: new Date()
  };
  const result = await controlCollection(db).findOneAndUpdate(
    {
      _id: CONTROL_ID,
      maintenance: false,
      activeWriteLeases: { $exists: true },
      $expr: { $eq: ['$activeWrites', { $size: '$activeWriteLeases' }] }
    },
    { $inc: { activeWrites: 1 }, $push: { activeWriteLeases: lease } },
    { returnDocument: 'after' }
  );
  const record = modifiedDocument(result);
  if (record) return { ...record, lease };
  const current = await controlCollection(db).findOne({ _id: CONTROL_ID });
  if (current?.maintenance === true) return null;
  validateControlRecord(current);
  throw new Error('Could not acquire a shared application write lease; the control record changed concurrently.');
}

async function releaseApplicationWriteLease(db, lease) {
  if (!lease?.leaseId || !lease?.ownerInstanceId) {
    throw new Error('Exact application write lease ownership is required for release.');
  }
  if (lease.ownerInstanceId !== processIdentity.instanceId) {
    throw new Error('This process cannot release an application write lease owned by another process instance.');
  }
  const result = await controlCollection(db).updateOne(
    {
      _id: CONTROL_ID,
      maintenance: false,
      activeWrites: { $gt: 0 },
      activeWriteLeases: { $elemMatch: { leaseId: lease.leaseId, ownerInstanceId: lease.ownerInstanceId } },
      $expr: { $eq: ['$activeWrites', { $size: '$activeWriteLeases' }] }
    },
    {
      $inc: { activeWrites: -1 },
      $pull: { activeWriteLeases: { leaseId: lease.leaseId, ownerInstanceId: lease.ownerInstanceId } }
    }
  );
  if (!result || result.matchedCount !== 1 || result.modifiedCount !== 1) {
    throw new Error('Could not release the exact application write lease; inspect the WareFlow control record before migration.');
  }
}

async function acquireMigrationWriteFreeze(db, lockToken, { waitMs = 30000, pollIntervalMs = 250 } = {}) {
  if (typeof lockToken !== 'string' || !lockToken) throw new Error('A unique migration lock token is required.');
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error('Migration write-freeze wait settings are invalid.');
  }
  await ensureControlRecord(db);
  const lockOwner = { ...processIdentity };
  const lockedAt = new Date();
  const startedAt = Date.now();
  while (true) {
    const result = await controlCollection(db).findOneAndUpdate(
      {
        _id: CONTROL_ID,
        maintenance: false,
        activeWrites: 0,
        activeWriteLeases: [],
        $expr: { $eq: ['$activeWrites', { $size: '$activeWriteLeases' }] }
      },
      { $set: { maintenance: true, lockToken, lockOwner, lockedAt } },
      { returnDocument: 'after' }
    );
    const lock = modifiedDocument(result);
    if (lock) return lock;

    const current = await controlCollection(db).findOne({ _id: CONTROL_ID });
    validateControlRecord(current);
    if (current.maintenance) {
      throw new Error('Cannot acquire the shared application write freeze: another migration already holds it.');
    }
    const remainingMs = waitMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(`Cannot acquire the shared application write freeze: ${current.activeWrites} application write request(s) did not drain within ${waitMs} ms. Retry after requests drain.`);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }
}

async function releaseMigrationWriteFreeze(db, lockToken) {
  const result = await controlCollection(db).updateOne(
    { _id: CONTROL_ID, maintenance: true, lockToken, 'lockOwner.instanceId': processIdentity.instanceId },
    { $set: { maintenance: false, lockToken: null, lockOwner: null, lockedAt: null } }
  );
  if (!result || result.matchedCount !== 1 || result.modifiedCount !== 1) {
    throw new Error('Could not release the migration write freeze owned by this process. Keep application writes paused and inspect the WareFlow control record.');
  }
}

function isProcessPresent(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    // EPERM means a process exists but this user cannot inspect it.
    return true;
  }
}

function verifyOwnerStopped(owner, confirmation, processPresent = isProcessPresent) {
  if (confirmation !== OWNER_STOPPED_CONFIRMATION) {
    throw new Error(`Recovery requires --confirm-owner-stopped ${OWNER_STOPPED_CONFIRMATION} after independently verifying the exact owner process is stopped.`);
  }
  if (!owner?.instanceId || !owner?.hostname || !Number.isInteger(owner?.pid)) {
    throw new Error('Recovery refused because lock/lease owner identity is incomplete or ambiguous.');
  }
  if (owner.hostname.toLowerCase() === processIdentity.hostname.toLowerCase()) {
    const present = processPresent(owner.pid);
    if (present !== false) throw new Error(`Recovery refused because owner PID ${owner.pid} is present or cannot be verified as stopped.`);
  }
  // For remote hosts, the explicit attestation is an operator responsibility;
  // this process cannot reliably query a remote host's process table.
}

function makeRecoveryEntry(action, targetId, owner, operator, reason) {
  if (typeof operator !== 'string' || !operator.trim()) throw new Error('Recovery requires a named operator.');
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('Recovery requires a non-empty reason.');
  return {
    eventId: crypto.randomUUID(), action, targetId,
    owner: { instanceId: owner.instanceId, pid: owner.pid, hostname: owner.hostname, startedAt: owner.startedAt || null },
    operator: operator.trim(), reason: reason.trim(), recoveredAt: new Date()
  };
}

async function inspectWriteFreeze(db) {
  const record = await controlCollection(db).findOne({ _id: CONTROL_ID });
  if (!record) return { exists: false, consistent: false, reason: 'Control record does not exist.' };
  const consistent = leaseCountMatches(record)
    && Array.isArray(record.recoveryAudit)
    && (record.maintenance === true
      ? Boolean(record.lockToken && record.lockOwner?.instanceId && record.lockOwner?.hostname && Number.isInteger(record.lockOwner?.pid))
      : record.maintenance === false && record.lockToken == null && record.lockOwner == null);
  return { exists: true, consistent, record };
}

async function recoverAbandonedWriteLease(db, options = {}, processPresent = isProcessPresent) {
  const { leaseId, ownerInstanceId, operator, reason, confirmation } = options;
  const record = await controlCollection(db).findOne({ _id: CONTROL_ID });
  validateControlRecord(record);
  if (record.maintenance === true) throw new Error('Lease recovery refused while a migration lock is active.');
  if (record.activeWrites !== 1 || record.activeWriteLeases.length !== 1) throw new Error('Lease recovery refused while other active writes remain; only the exact sole lease can be reconciled.');
  const lease = record.activeWriteLeases[0];
  if (lease.leaseId !== leaseId || lease.ownerInstanceId !== ownerInstanceId) throw new Error('Lease recovery refused because the requested lease owner does not match the shared record.');
  verifyOwnerStopped({ ...lease, instanceId: lease.ownerInstanceId }, confirmation, processPresent);
  const audit = makeRecoveryEntry('application_write_lease', leaseId, lease, operator, reason);
  const result = await controlCollection(db).updateOne(
    {
      _id: CONTROL_ID, maintenance: false, activeWrites: 1,
      activeWriteLeases: { $size: 1, $elemMatch: { leaseId, ownerInstanceId } },
      $expr: { $eq: ['$activeWrites', { $size: '$activeWriteLeases' }] }
    },
    { $set: { activeWrites: 0 }, $pull: { activeWriteLeases: { leaseId, ownerInstanceId } }, $push: { recoveryAudit: audit } }
  );
  if (!result || result.matchedCount !== 1 || result.modifiedCount !== 1) throw new Error('Lease recovery lost an atomic state check; no recovery was recorded. Re-inspect the control record.');
  return audit;
}

async function recoverAbandonedMigrationLock(db, options = {}, processPresent = isProcessPresent) {
  const { lockToken, ownerInstanceId, operator, reason, confirmation } = options;
  const record = await controlCollection(db).findOne({ _id: CONTROL_ID });
  validateControlRecord(record);
  if (record.maintenance !== true) throw new Error('Migration-lock recovery refused because no migration lock is active.');
  if (record.activeWrites !== 0 || record.activeWriteLeases.length !== 0) throw new Error('Migration-lock recovery refused while active write leases remain.');
  const owner = record.lockOwner;
  if (record.lockToken !== lockToken || owner.instanceId !== ownerInstanceId) throw new Error('Migration-lock recovery refused because the exact token/owner does not match the shared record.');
  verifyOwnerStopped(owner, confirmation, processPresent);
  const audit = makeRecoveryEntry('migration_lock', lockToken, owner, operator, reason);
  const result = await controlCollection(db).updateOne(
    {
      _id: CONTROL_ID, maintenance: true, activeWrites: 0, lockToken,
      'lockOwner.instanceId': ownerInstanceId,
      activeWriteLeases: { $size: 0 },
      $expr: { $eq: ['$activeWrites', { $size: '$activeWriteLeases' }] }
    },
    { $set: { maintenance: false, lockToken: null, lockOwner: null, lockedAt: null }, $push: { recoveryAudit: audit } }
  );
  if (!result || result.matchedCount !== 1 || result.modifiedCount !== 1) throw new Error('Migration-lock recovery lost an atomic state check; no recovery was recorded. Re-inspect the control record.');
  return audit;
}

function migrationWriteFreeze(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const db = mongoose.connection.db;
  if (!db) {
    return res.status(503).json({ success: false, code: 'WRITE_FREEZE_UNAVAILABLE', message: 'Application writes are temporarily unavailable because the shared maintenance lock cannot be checked.' });
  }

  return acquireApplicationWriteLease(db).then((acquired) => {
    if (!acquired) {
      return res.status(503).json({ success: false, code: 'MAINTENANCE_WRITE_FREEZE', message: 'Application writes are paused for a maintenance operation. Please retry later.' });
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseApplicationWriteLease(db, acquired.lease).catch((error) => {
        console.error(`Could not release application write lease ${acquired.lease.leaseId}: ${error.message}`);
      });
    };
    res.once('finish', release);
    res.once('close', () => {
      if (!res.writableFinished) console.error(`HTTP response closed before finish; retaining write lease ${acquired.lease.leaseId} until operator reconciliation.`);
    });
    return next();
  }).catch((error) => {
    console.error(`Could not check the shared application write freeze: ${error.message}`);
    return res.status(503).json({ success: false, code: 'WRITE_FREEZE_UNAVAILABLE', message: 'Application writes are temporarily unavailable because the shared maintenance lock could not be checked.' });
  });
}

module.exports = migrationWriteFreeze;
module.exports.CONTROL_COLLECTION = CONTROL_COLLECTION;
module.exports.CONTROL_ID = CONTROL_ID;
module.exports.OWNER_STOPPED_CONFIRMATION = OWNER_STOPPED_CONFIRMATION;
module.exports.processIdentity = processIdentity;
module.exports.acquireApplicationWriteLease = acquireApplicationWriteLease;
module.exports.releaseApplicationWriteLease = releaseApplicationWriteLease;
module.exports.acquireMigrationWriteFreeze = acquireMigrationWriteFreeze;
module.exports.releaseMigrationWriteFreeze = releaseMigrationWriteFreeze;
module.exports.inspectWriteFreeze = inspectWriteFreeze;
module.exports.recoverAbandonedWriteLease = recoverAbandonedWriteLease;
module.exports.recoverAbandonedMigrationLock = recoverAbandonedMigrationLock;
