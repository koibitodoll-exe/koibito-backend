// testBadge.js
const badgeEngine = require('./services/badgeEngine');

async function run() {
  const result = await badgeEngine.process({
    user_id: 1,
    koibito_id: 1,
    event_type: 'koibito_paired',
    source: 'manual_test',
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});