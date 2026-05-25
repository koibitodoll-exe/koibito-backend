// testEvent.js

const { processEvent } =
require('./services/eventProcessor');

async function run() {
 await processEvent({
   user_id:1,
   koibito_id:1,

   event_type:"koibito.paired"
 });

 console.log("done");
 process.exit(0);
}

run().catch(console.error);