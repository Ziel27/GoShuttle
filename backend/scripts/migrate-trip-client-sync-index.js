#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const TARGET_INDEX = {
  key: { clientSyncId: 1 },
  options: {
    unique: true,
    partialFilterExpression: {
      clientSyncId: { $type: 'string' },
    },
  },
};

const hasArg = (name) => process.argv.slice(2).includes(`--${name}`);

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const isClientSyncIndex = (index) => {
  return (
    index &&
    index.key &&
    Object.keys(index.key).length === 1 &&
    index.key.clientSyncId === 1
  );
};

const isTargetClientSyncIndex = (index) => {
  return (
    isClientSyncIndex(index) &&
    index.unique === true &&
    index.partialFilterExpression &&
    index.partialFilterExpression.clientSyncId &&
    index.partialFilterExpression.clientSyncId.$type === 'string'
  );
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is required in environment.');
  }

  const dryRun = hasArg('dry-run');
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const trips = mongoose.connection.collection('trips');
    const summary = {
      unsetNull: 0,
      unsetEmpty: 0,
      droppedIndexes: 0,
      createdIndex: false,
      plannedDrops: 0,
      plannedCreateIndex: false,
    };

    if (!dryRun) {
      const nullResult = await trips.updateMany(
        { clientSyncId: null },
        { $unset: { clientSyncId: '' } }
      );
      summary.unsetNull = Number(nullResult.modifiedCount || 0);

      const emptyResult = await trips.updateMany(
        { clientSyncId: { $type: 'string', $in: ['', ' ', '  ', '   '] } },
        { $unset: { clientSyncId: '' } }
      );
      summary.unsetEmpty = Number(emptyResult.modifiedCount || 0);
    }

    const indexes = await trips.indexes();
    const clientSyncIndexes = indexes.filter(isClientSyncIndex);
    const hasTargetAlready = clientSyncIndexes.some(isTargetClientSyncIndex);

    if (!hasTargetAlready) {
      for (const index of clientSyncIndexes) {
        if (index.name === '_id_') continue;
        if (dryRun) {
          summary.plannedDrops += 1;
        } else {
          await trips.dropIndex(index.name);
          summary.droppedIndexes += 1;
        }
      }

      if (dryRun) {
        summary.plannedCreateIndex = true;
      } else {
        await trips.createIndex(TARGET_INDEX.key, TARGET_INDEX.options);
        summary.createdIndex = true;
      }
    }

    console.log('Trip clientSyncId migration complete.');
    console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
    console.log(`unset clientSyncId=null docs: ${summary.unsetNull}`);
    console.log(`unset empty-string docs: ${summary.unsetEmpty}`);
    console.log(`dropped clientSyncId indexes: ${summary.droppedIndexes}`);
    console.log(`created target partial unique index: ${summary.createdIndex}`);

    if (dryRun) {
      console.log(`planned index drops: ${summary.plannedDrops}`);
      console.log(`planned target index creation: ${summary.plannedCreateIndex}`);
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('ERROR: Failed to migrate Trip clientSyncId index.');
  console.error(error?.message || error);
  process.exit(1);
});
