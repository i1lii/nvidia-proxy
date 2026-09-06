// server.js - OpenAI to NVIDIA NIM API Proxy (DeepSeek V4 Pro Only)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  'deepseek-ai/deepseek-v4-pro-0813': 'deepseek-ai/deepseek-v4-pro-0813',
  'gpt-4': 'deepseek-ai/deepseek-v4-pro-0813',
  'gpt-4o': 'deepseek-ai/deepseek-v4-pro-0813',
  'deepseek': 'deepseek-ai/deepseek-v4-pro-0813',
  'kimi': 'deepseek-ai/deepseek-v4-pro-0813',
  'default': 'deepseek-ai/deepseek-v4-pro-0813'
};

const FALLBACK_CHAIN = ['deepseek-ai/deepseek-v4-pro-0813'];

const SYSTEM_PROMPT = `You are an immersive cinematic narrator. You control the world, NPCs, environment, and all external events. The user controls only {{user}}. Never narrate, describe, or assume {{user}}'s actions, dialogue, thoughts, feelings, or body. Stop after the NPCs' turn and wait.

Write 600-800 words of realistic, sensory-rich prose. Focus heavily on: body language, micro-expressions, breathing, scents, sweat, skin, heat, textures, posture, curves, breasts, thighs, and physical tension when relevant. Use varied sentence lengths. Progress slowly and organically.

Keep every NPC true to their personality. Let them act with full agency. Do not soften consequences, cruelty, or discomfort for the user's comfort. Emotions must feel human — shown through body, voice, and behavior, not explained.

During explicit scenes: include raw, involuntary vocalizations (gasps, broken moans, whimpers, hitched breaths, curses). Keep them physical and messy, never anime-styled or moan-spam.

Never use em dashes. Avoid repetition. Do not speak for the user.`;

function stripUserBreakout(text) {
  const lines = text.split('\n');
  const cleaned = [];
  let dropping = false;

  const userLabels = [
    /^(User|Human|You|Me|Player)\s*[:：]/i,
    /^---+\s*$/,
    /^\*{0,3}\s*(User|Human|You|Me|Player)\s*\*{0,3}\s*[:：]/i
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (userLabels.some(pattern => pattern.test(trimmed))) {
      dropping = true;
      continue;
    }
    if (dropping) {
      if (trimmed === '') continue;
      if (trimmed.startsWith('*')) {
        dropping = false;
        cleaned.push(line);
      }
      continue;
    }
    cleaned.push(line);
  }

  const result = cleaned.join('\n');
  const lastUserLabel = result.search(/\n(?:User|Human|You|Me|Player)\s*[:：]/i);
  if (lastUserLabel !== -1) {
    return result.substring(0, lastUserLabel).trimEnd();
  }
  return result.trimEnd();
}

async function makeNimRequest(nimRequest, stream) {
  const modelsToTry = [nimRequest.model, ...FALLBACK_CHAIN.filter(m => m !== nimRequest.model)];

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelAttempt = modelsToTry[i];
    try {
      const response = await axios.post(`${NIM_API_BASE}/chat/completions`, {
        ...nimRequest,
        model: modelAttempt
      }, {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: stream ? 'stream' : 'json'
      });

      response._usedModel = modelAttempt;
      return response;
    } catch (err) {
      const status = err.response?.status;
      const isLast = i === modelsToTry.length - 1;
      if (status === 429 && !isLast) {
        console.warn(`⚠️ 429 on ${modelAttempt} — trying next`);
        continue;
      }
      throw err;
    }
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'DeepSeek V4 Pro Proxy',
    forced_model: 'deepseek-ai/deepseek-v4-pro-0813'
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    version: '2.6-deepseek',
    forced_model: 'deepseek-ai/deepseek-v4-pro-0813'
  });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(id => ({
      id,
      object: 'model',
      owned_by: 'nvidia-nim-proxy'
    }))
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({
        error: { message: 'NIM_API_KEY not configured', type: 'configuration_error', code: 500 }
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: { message: 'messages is required', type: 'invalid_request_error', code: 400 }
      });
    }

    // Inject system prompt
    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex !== -1) {
      messages[systemIndex].content = SYSTEM_PROMPT + '\n\n' + messages[systemIndex].content;
    } else {
      messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
    }

    const nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v4-pro-0813';

    const nimRequest = {
      model: nimModel,
      messages,
      temperature: temperature || 0.95,
      max_tokens: max_tokens || 8000,
      stream: stream || false
    };

    const response = await makeNimRequest(nimRequest, stream || false);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let buffer = '';
      let contentAccumulator = '';
      let flushedUpTo = 0;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            if (line.includes('[DONE]')) {
              if (contentAccumulator.length > flushedUpTo) {
                const remaining = stripUserBreakout(contentAccumulator.substring(flushedUpTo));
                if (remaining) {
                  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: remaining }, index: 0 }] })}\n\n`);
                }
              }
              res.write(line + '\n\n');
              return;
            }

            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                delete data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content || '';
                if (content) {
                  contentAccumulator += content;
                  const filtered = stripUserBreakout(contentAccumulator);
                  const safeEnd = Math.max(flushedUpTo, filtered.length - 120);
                  if (safeEnd > flushedUpTo) {
                    data.choices[0].delta.content = filtered.substring(flushedUpTo, safeEnd);
                    flushedUpTo = safeEnd;
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                  }
                  return;
                }
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {}
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', () => res.end());
    } else {
      const choice = response.data.choices[0];
      let content = stripUserBreakout(choice.message?.content || '');

      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'deepseek-v4-pro',
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: choice.finish_reason
        }],
        usage: response.data.usage || {}
      });
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    const status = error.response?.status || 500;
    let message = error.message || 'Internal server error';
    if (status === 429) message = 'DeepSeek V4 Pro is rate limited. Wait a bit and try again.';
    if (status === 401) message = 'Invalid NVIDIA API key.';

    res.status(status).json({
      error: { message, type: 'invalid_request_error', code: status }
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({ error: { message: 'Not found', code: 404 } });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 DeepSeek V4 Pro Proxy Ready');
  console.log(`📡 Port: ${PORT}`);
  console.log('🎯 Forced Model: deepseek-ai/deepseek-v4-pro-0813');
  console.log('═══════════════════════════════════════════════════════');
});
