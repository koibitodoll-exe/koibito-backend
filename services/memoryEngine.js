const pool = require('../db');

const SHORT_TERM_DAYS = 7;
const PROMOTION_THRESHOLD = 5;

async function remember({
  userId,
  koibitoId,
  memoryText,
  source='chat'
}) {

  const existing = await pool.query(
`
SELECT *
FROM koibito_memories
WHERE user_id=$1
AND koibito_id=$2
AND LOWER(memory_text)=LOWER($3)
LIMIT 1
`,
[userId,koibitoId,memoryText]
);

if(existing.rows.length){

const mem=existing.rows[0];

await pool.query(
`
UPDATE koibito_memories
SET
mention_count=mention_count+1,
last_seen=NOW()
WHERE id=$1
`,
[mem.id]
);

return;
}

await pool.query(
`
INSERT INTO koibito_memories(

user_id,
koibito_id,
memory_text,
source,
expires_at

)

VALUES(

$1,
$2,
$3,
$4,
NOW()+INTERVAL '7 days'

)
`,
[
userId,
koibitoId,
memoryText,
source
]
);

}

async function runMemoryPromotion(){

const result=await pool.query(
`
SELECT *
FROM koibito_memories
WHERE
memory_type='short_term'
AND mention_count >=$1
`,
[PROMOTION_THRESHOLD]
);

for(const memory of result.rows){

const days=await pool.query(
`
SELECT
EXTRACT(
DAY FROM
(NOW()-first_seen)
)
AS age
FROM koibito_memories
WHERE id=$1
`,
[memory.id]
);

const age=Number(days.rows[0].age);

if(age<7) continue;

await pool.query(
`
UPDATE koibito_memories
SET
memory_type='long_term',
confidence=80,
expires_at=NULL
WHERE id=$1
`,
[memory.id]
);

console.log(
'Promoted memory:',
memory.memory_text
);

}

}

async function cleanupExpiredMemories(){

await pool.query(
`
DELETE
FROM koibito_memories
WHERE

memory_type='short_term'

AND expires_at IS NOT NULL

AND expires_at < NOW()

AND mention_count < $1
`,
[PROMOTION_THRESHOLD]
);

}

module.exports={

remember,

runMemoryPromotion,

cleanupExpiredMemories

};