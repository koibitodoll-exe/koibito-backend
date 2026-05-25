const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../db');

router.get('/:koibitoId', authMiddleware, async (req, res) => {
  try {
    const { koibitoId } = req.params;

    const since =
      req.query.since ||
      '1970-01-01T00:00:00.000Z';

    const result = await pool.query(
`
SELECT *

FROM sync_events

WHERE

koibito_id=$1

AND created_at > $2

ORDER BY created_at ASC
`,
[
koibitoId,
since
]
);

res.json({

success:true,

sync_events:result.rows,

server_time:new Date(),

count:result.rows.length

});

} catch(err){

console.error(
'Sync fetch error:',
err
);

res.status(500)
.json({

error:
'Failed sync fetch'

});

}

});

module.exports=router;