// server.js - OpenAI to NVIDIA NIM API Proxy (DeepSeek V4 Pro Only - Clean)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🎯 MODEL MAPPING — كل شيء يروح على DeepSeek V4 Pro فقط
const MODEL_MAPPING = {
  'kimi': 'deepseek-ai/deepseek-v4-pro-0813',
  'kimi-k3': 'deepseek-ai/deepseek-v4-pro-0813',
  'moonshotai/kimi-k3': 'deepseek-ai/deepseek-v4-pro-0813',
  'gpt-4': 'deepseek-ai/deepseek-v4-pro-0813',
  'gpt-4o': 'deepseek-ai/deepseek-v4-pro-0813',
  'deepseek': 'deepseek-ai/deepseek-v4-pro-0813',
  'default': 'deepseek-ai/deepseek-v4-pro-0813'
};

// 🔄 FALLBACK CHAIN
const FALLBACK_CHAIN = ['deepseek-ai/deepseek-v4-pro-0813'];

// 🛡️ Strip user breakout
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

// 🔄 Helper: make a NIM request with automatic 429 fallback
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
      if (modelAttempt !== nimRequest.model) {
        console.log(`✅ Fell back to: ${modelAttempt}`);
      }
      return response;

    } catch (err) {
      const status = err.response?.status;
      const isLast = i === modelsToTry.length - 1;

      if (status === 429) {
        console.warn(`⚠️  429 on ${modelAttempt} — ${isLast ? 'all fallbacks exhausted' : `trying ${modelsToTry[i + 1]}`}`);
        if (isLast) throw err;
        continue;
      }

      throw err;
    }
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy (DeepSeek V4 Pro Only)',
    forced_model: 'deepseek-ai/deepseek-v4-pro-0813',
    nim_api_configured: !!NIM_API_KEY
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    version: '2.4-deepseek-clean',
    status: 'running',
    forced_model: 'deepseek-ai/deepseek-v4-pro-0813'
  });
});

// Models list
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy',
    nim_model: 'deepseek-ai/deepseek-v4-pro-0813'
  }));

  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({
        error: {
          message: 'NIM_API_KEY not configured.',
          type: 'configuration_error',
          code: 500
        }
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'messages is required and must be an array',
          type: 'invalid_request_error',
          code: 400
        }
      });
    }

    // Force DeepSeek V4 Pro
    let nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v4-pro-0813';

    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 1,
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
      const LOOKAHEAD = 150;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            if (line.includes('[DONE]')) {
              if (contentAccumulator.length > flushedUpTo) {
                const remaining = stripUserBreakout(contentAccumulator.substring(flushedUpTo));
                if (remaining.length > 0) {
                  const doneFlush = {
                    choices: [{ delta: { content: remaining }, index: 0 }]
                  };
                  res.write(`data: ${JSON.stringify(doneFlush)}\n\n`);
                }
              }
              res.write(line + '\n\n');
              return;
            }

            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                const content = data.choices[0].delta.content || '';
                
                // Remove any reasoning if present
                delete data.choices[0].delta.reasoning_content;

                if (content) {
                  contentAccumulator += content;
                  const filtered = stripUserBreakout(contentAccumulator);
                  const safeEnd = Math.max(flushedUpTo, filtered.length - LOOKAHEAD);
                  if (safeEnd > flushedUpTo) {
                    const toSend = filtered.substring(flushedUpTo, safeEnd);
                    flushedUpTo = safeEnd;
                    data.choices[0].delta.content = toSend;
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                  }
                  return;
                }
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              res.write(line + '\n');
            }
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'deepseek-v4-pro',
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message?.content || '';
          fullContent = stripUserBreakout(fullContent);

          return {
            index: choice.index,
            message: {
              role: choice.message.role,
              content: fullContent
            },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      res.json(openaiResponse);
    }

  } catch (error) {
    console.error('Proxy error:', error.message);

    let errorMessage = error.message || 'Internal server error';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid NVIDIA API key.';
    } else if (error.response?.status === 429) {
      errorMessage = 'DeepSeek V4 Pro is rate limited. Please wait and try again.';
      res.setHeader('Retry-After', 60);
    }

    res.status(error.response?.status || 500).json({
      error: {
        message: errorMessage,
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 OpenAI → NVIDIA NIM Proxy (DeepSeek V4 Pro Clean)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Models list: http://localhost:${PORT}/v1/models`);
  console.log('');
  console.log('⚙️  Forced Model: deepseek-ai/deepseek-v4-pro-0813');
  console.log('═══════════════════════════════════════════════════════');
});
