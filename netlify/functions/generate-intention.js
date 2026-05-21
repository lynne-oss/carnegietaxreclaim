const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Log raw event details before any parsing so we can see exactly what arrives
  console.log('[generate-intention] body type:', typeof event.body,
    '| isBase64Encoded:', event.isBase64Encoded,
    '| raw (first 300):', String(event.body ?? '').substring(0, 300));

  let ans1, ans2;
  try {
    let parsed;
    if (typeof event.body === 'object' && event.body !== null) {
      // Some environments pre-parse the body
      parsed = event.body;
    } else if (event.isBase64Encoded) {
      parsed = JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'));
    } else {
      parsed = JSON.parse(event.body);
    }
    ans1 = parsed.ans1;
    ans2 = parsed.ans2;
  } catch (e) {
    console.log('[generate-intention] body parse failed:', e.message);
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid request body: ' + e.message })
    };
  }

  console.log('[generate-intention] ans1:', JSON.stringify(ans1), '| ans2:', JSON.stringify(ans2));

  if (!ans1 || !ans2) {
    console.log('[generate-intention] missing inputs — rejecting');
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Both fields are required' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  const prompt = `The user answered two questions. What they are committed to right now: ${ans1}. What usually pulls them off it: ${ans2}. Convert both answers into a single short sentence they can say out loud before sleep. Rules: natural human speech only, maximum 10 words, action-based, must work in messy real life not ideal conditions, absorb any resistance into the language without analysing it. Use one of these patterns: simple action (I am posting), persistence under reality (I keep going when I drift), or commitment continuity (I follow through). Output the sentence only. Nothing else.`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log('[generate-intention] Anthropic error:', JSON.stringify(parsed.error));
            resolve({
              statusCode: 502,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: parsed.error.message || 'API error' })
            });
            return;
          }
          const intention = parsed.content?.[0]?.text;
          if (!intention) {
            console.log('[generate-intention] unexpected response shape:', data.substring(0, 300));
            resolve({
              statusCode: 502,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: 'Unexpected API response' })
            });
            return;
          }
          console.log('[generate-intention] output:', JSON.stringify(intention));
          resolve({
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ intention })
          });
        } catch (e) {
          console.log('[generate-intention] response parse error:', e.message, '| raw:', data.substring(0, 300));
          resolve({
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Failed to parse API response' })
          });
        }
      });
    });
    req.on('error', e => {
      console.log('[generate-intention] request error:', e.message);
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      });
    });
    req.write(requestBody);
    req.end();
  });
};
