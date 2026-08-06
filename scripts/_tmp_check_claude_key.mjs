import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.log('NO KEY SET');
  process.exit(0);
}

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'say ok' }],
  }),
});
console.log('status:', res.status);
const text = await res.text();
console.log(text.slice(0, 300));
