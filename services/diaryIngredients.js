const pool=require('../db');

async function addIngredient({

userId,
koibitoId,
eventType,
content,
importance=1,
metadata={}

}){

await pool.query(
`
INSERT INTO
koibito_diary_ingredients(

user_id,
koibito_id,
event_type,
importance,
content,
metadata

)

VALUES(

$1,
$2,
$3,
$4,
$5,
$6

)
`,
[
userId,
koibitoId,
eventType,
importance,
content,
metadata
]
);

}

async function getIngredients({

koibitoId,
days=7

}){

const result=
await pool.query(
`
SELECT *

FROM
koibito_diary_ingredients

WHERE

koibito_id=$1

AND

created_at>

NOW()-($2||' days')::interval

ORDER BY

importance DESC,
created_at ASC
`,
[
koibitoId,
days
]
);

return result.rows;

}

module.exports={

addIngredient,
getIngredients

};