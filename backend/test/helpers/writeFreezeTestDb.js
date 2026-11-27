const { CONTROL_COLLECTION, CONTROL_ID } = require('../../middleware/migrationWriteFreeze');

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function matches(document, filter) {
  if (!document) return false;
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$expr') {
      if (document.activeWrites !== document.activeWriteLeases?.length) return false;
    } else if (key === 'activeWriteLeases') {
      if (Array.isArray(expected)) {
        if (JSON.stringify(document.activeWriteLeases) !== JSON.stringify(expected)) return false;
      } else {
        if (expected.$exists !== undefined && (Array.isArray(document.activeWriteLeases) !== expected.$exists)) return false;
        if (expected.$size !== undefined && document.activeWriteLeases?.length !== expected.$size) return false;
        if (expected.$elemMatch && !document.activeWriteLeases?.some(lease => Object.entries(expected.$elemMatch).every(([field, value]) => lease[field] === value))) return false;
      }
    } else if (expected && typeof expected === 'object' && expected.$gt !== undefined) {
      if (!(document[key] > expected.$gt)) return false;
    } else if (expected && typeof expected === 'object' && expected.$exists !== undefined) {
      if ((document[key] !== undefined) !== expected.$exists) return false;
    } else {
      const actual = getPath(document, key);
      if (expected === null ? actual != null : actual !== expected) return false;
    }
  }
  return true;
}

function applyUpdate(document, update) {
  if (update.$set) Object.assign(document, clone(update.$set));
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) document[key] = (document[key] || 0) + amount;
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) document[key].push(clone(value));
  }
  if (update.$pull) {
    for (const [key, condition] of Object.entries(update.$pull)) {
      document[key] = document[key].filter(item => !Object.entries(condition).every(([field, value]) => item[field] === value));
    }
  }
}

function createWriteFreezeCollection(initialDocument = null) {
  let document = clone(initialDocument);
  return {
    async updateOne(filter, update) {
      if (!document && update.$setOnInsert) {
        document = { _id: CONTROL_ID, ...clone(update.$setOnInsert) };
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      if (!matches(document, filter)) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(document, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      if (!matches(document, filter)) return { value: null };
      applyUpdate(document, update);
      return { value: clone(document) };
    },
    async findOne(filter) {
      return matches(document, filter) ? clone(document) : null;
    },
    getDocument() { return clone(document); },
    setDocument(value) { document = clone(value); }
  };
}

function createTestDb(collectionFactory = () => ({}), initialControlDocument = null) {
  const lockCollection = createWriteFreezeCollection(initialControlDocument);
  return {
    collection(name) {
      return name === CONTROL_COLLECTION ? lockCollection : collectionFactory(name);
    },
    getControlCollection() { return lockCollection; }
  };
}

module.exports = { createTestDb, createWriteFreezeCollection };
