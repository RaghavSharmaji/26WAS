// Retired unsafe migration. This command assigned all unowned rows to one user
// and dropped global indexes without a complete tenant mapping or rollback plan.
// Keep the entry point so old instructions fail closed with an actionable message.
async function migrateOwnership() {
  throw new Error('ownership:migrate is disabled. Use the reviewed companies:migrate dry-run workflow after approving a complete mapping and verified backup.');
}

if (require.main === module) {
  migrateOwnership().catch(error => {
    console.error(`Ownership migration stopped safely: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateOwnership };
