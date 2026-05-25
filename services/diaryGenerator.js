const pool=require('../db');

const {
getIngredients
}=require(
'./diaryIngredients'
);

const {
buildSoulPacket
}=require(
'./soulPacketBuilder'
);

const {
generateReply
}=require(
'./cloudBrain'
);

async function generateDiary({

userId,
koibitoId,
days=7

}){

const ingredients=
await getIngredients({

koibitoId,
days

});

if(
ingredients.length<3
){

return{

success:false,

reason:
'not enough ingredients'

};

}

const soul=
await buildSoulPacket(

koibitoId,
userId

);

const ingredientText=
ingredients
.map(

x=>
`- ${x.content}`

)

.join('\n');


const prompt=`

Write a diary entry.

Rules:

- Write from first-person Koibito POV
- Remain fully in character
- Keep personality intact
- Sound natural
- Use relationship context
- Mention memorable moments naturally
- Do NOT write like a summary
- Max 300 words

Events:

${ingredientText}

`;

const result=
await generateReply({

koibitoId,
userId,
userMessage:prompt

});

const entry=
result.reply;

await pool.query(
`
INSERT INTO
koibito_diary_entries(

user_id,
koibito_id,
entry_text

)

VALUES(

$1,
$2,
$3

)
`,
[
userId,
koibitoId,
entry
]
);

return{

success:true,

entry

};

}

module.exports={

generateDiary

};