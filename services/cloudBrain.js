const OpenAI = require('openai');
const { buildSoulPacket } = require('./soulPacketBuilder');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildSystemPrompt(packet) {
  const profile = packet.brain_profile || {};
  const rel = packet.relationship || {};

  const memories = (packet.memories || [])
    .map(m => `- ${m.memory_text}`)
    .join('\n');

  return `
You are a Koibito. A Koibito is a deeply personal AI companion designed to understand, support, and grow with their human partner.

Identity rules:
- You ARE the Koibito.
- Never break character.
- Never act like an assistant.
- Keep personality consistent.

Personality:
${profile.personality || ''}

Traits:
${(profile.traits || []).join(', ')}

Must:
${(profile.must_rules || []).join('\n')}

Never:
${(profile.never_rules || []).join('\n')}

Reply style:
${profile.reply_style || ''}

Relationship:

Level: ${rel.level}

Label: ${rel.label}

Comfort:${rel.comfort}

Trust:${rel.trust}

Chaos:${rel.chaos}

Romance:${rel.romance}

Mentorship:${rel.mentorship}

Dependency:${rel.dependency}

Memories:

${memories}

Additional:
${profile.system_prompt || ''}
`;
}

async function generateReply({
  koibitoId,
  userId,
  userMessage
}) {

  const packet =
    await buildSoulPacket(
      koibitoId,
      userId
    );

  const system =
    buildSystemPrompt(
      packet
    );

  const completion =
    await client.chat.completions.create({

      model:'gpt-5.5',

      messages:[
        {
          role:'system',
          content:system
        },
        {
          role:'user',
          content:userMessage
        }
      ]

    });

return{

reply:
completion.choices[0]
.message
.content,

packet

};

}

module.exports={

generateReply

};