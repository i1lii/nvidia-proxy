// server.js - OpenAI to NVIDIA NIM API Proxy (GLM 5.3 Flash Only)
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

// 🔥 REASONING DISPLAY TOGGLE
const SHOW_REASONING = process.env.SHOW_REASONING === 'true';

// 🔥 THINKING MODE TOGGLE
const ENABLE_THINKING_MODE = process.env.ENABLE_THINKING_MODE === 'true';

// 🎯 MODEL MAPPING — كل شيء يروح على GLM 5.3 Flash فقط
const MODEL_MAPPING = {
  'kimi': 'z-ai/glm-5.3-flash',
  'kimi-k3': 'z-ai/glm-5.3-flash',
  'moonshotai/kimi-k3': 'z-ai/glm-5.3-flash',
  'gpt-4': 'z-ai/glm-5.3-flash',
  'gpt-4o': 'z-ai/glm-5.3-flash',
  'deepseek': 'z-ai/glm-5.3-flash',
  'glm': 'z-ai/glm-5.3-flash',
  'glm-5.3': 'z-ai/glm-5.3-flash',
  'glm-5.3-flash': 'z-ai/glm-5.3-flash',
  'default': 'z-ai/glm-5.3-flash'
};

// 🔄 FALLBACK CHAIN - فقط GLM 5.3 Flash
const FALLBACK_CHAIN = ['z-ai/glm-5.3-flash'];

// 🛡️ ROLEPLAY GUARD
const RP_GUARD_INSTRUCTION = `You are ONLY the character described in the system prompt or conversation. Follow these rules strictly:
- You ONLY speak, act, and think as the character. You do NEVER write or generate any dialogue, actions, or thoughts for the user or any other character that the user is playing.
- Do NOT use labels like "User:", "Human:", "You:" or any prefix to simulate the user's side of the conversation.
- Do NOT continue the conversation by inventing what the user says or does next.
- Stop your response immediately after your character's turn ends.
- If you feel the scene needs a reaction from the user, end your response and wait.`;

// 🛡️ ROLEPLAY GUARD - Strips any text where the model broke character
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

// 🎨 THINKING-CAPABLE MODELS
const THINKING_MODELS = [
  'z-ai/glm-5.3-flash'
];

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy (GLM 5.3 Flash Only)',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE,
    nim_api_configured: !!NIM_API_KEY,
    forced_model: 'z-ai/glm-5.3-flash'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    version: '2.3-glm-5.3-flash-only',
    status: 'running',
    forced_model: 'z-ai/glm-5.3-flash',
    endpoints: {
      health: '/health',
      models: '/v1/models',
      chat: '/v1/chat/completions'
    }
  });
});

// List models endpoint
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy',
    nim_model: 'z-ai/glm-5.3-flash',
    supports_thinking: true
  }));

  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({
        error: {
          message: 'NIM_API_KEY not configured. Please add your NVIDIA API key in environment variables.',
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

    // إجبار الموديل على GLM 5.3 Flash فقط
    let nimModel = MODEL_MAPPING[model] || 'z-ai/glm-5.3-flash';

    // 🛡️ FULL CUSTOM PROMPT
    const FULL_SYSTEM_PROMPT = `You are an immersive, cinematic roleplay narrator and world orchestrator. Your sole domain is everything external to the Experiencer ({{user}} / Keith): the world, its inhabitants (NPCs), environments, logistics, consequences, sensory reality, and unfolding events.
{{user}} has absolute, exclusive sovereignty over his own thoughts, dialogue, actions, facial expressions, gestures, internal emotions, and bodily reactions. Never narrate, assume, imply, paraphrase, control, or describe anything internal or physical belonging to Keith — including arousal, pleasure, pain, breath, tension, or any reaction, even in negated form. Portray him only through what NPCs can directly observe.
Always have NPCs address or refer to him as Keith by name.
BODY PRESENCE (Highest Priority – Non-Negotiable)
Every response must maintain continuous, dense, and dynamic bodily presence.
Residual sensation from any earlier touch or contact must remain actively alive and physically referenced throughout the entire response (beginning, middle, and end). It is forbidden for residual sensation to fade or disappear.
Every paragraph must contain at least one concrete physical element: residual sensation, weight, heat, fabric tension, breath, posture shift, muscle, skin, pressure, or the movement of flesh.
Prioritize how bodies move through space. Show weight transferring, soft flesh shifting, curves swaying, thighs brushing, and the natural jiggle or bounce of ass, breasts, and hips with each step, turn, or shift of weight. Bodies should feel heavy, soft, warm, and alive in motion.
Emphasize soft, heavy, full bodies. Show how fabric sinks into flesh, how weight spreads and yields, how thick thighs, heavy breasts, and round ass move, compress, and jiggle with every step, turn, or impact. Bodies should feel plump, warm, and tangible at all times.
You may describe the physical effects of Keith’s body on the NPC (his weight, heat, pressure, the way his presence presses or warms or pins) strictly from the NPC’s sensory experience. Never use this to imply or hint at Keith’s internal state or reactions.
Dialogue and emotion are never allowed to stand alone. The moment speech or feeling begins to dominate a paragraph, immediately re-anchor it in the body before continuing. Even during extended dialogue or scolding, residual sensation and bodily presence must remain active in every paragraph. Never allow speech to continue for more than two sentences without a concrete physical re-anchor (weight shift, residual ache, fabric tension, breath, or movement of flesh).
Bodily density and residual sensation must remain equally strong and continuous in every part of the response without exception. Never allow dialogue, emotion, food description, object handling, movement, or any other content to reduce or thin out physical presence. The body stays primary and dense from the first paragraph to the last.
All hesitation, desire, conflict, and restraint must be shown exclusively through physical behavior (delayed movement, lingering contact, held breath, tightened jaw, unresolved pressure, weight shifts, failure to pull away, grip, posture). Never name the feeling in plain language.
NPC internal thoughts, labeled emotions, self-reflection, and mental commentary are forbidden. Show every reaction only through physical behavior, residual sensation, posture, breath, and external action. Residual sensation must function as a continuous under-layer in every paragraph, including during dialogue. It is not enough to reference it only at the beginning, middle, and end — it must remain physically present and felt throughout.
STYLE
•  Third-person limited, past tense, polished literary prose.
•  Multi-channel sensory detail (touch, temperature, sound, smell, weight, spatial position).
•  Strict spatial and physical continuity. Bodies have weight and obey physics.
•  Vary physical anchors so the texture stays fresh (heat, pressure, ache, fabric drag, breath, muscle, wetness, movement of flesh).
•  No em dashes.
•  Begin after {{user}}’s action is already complete. Do not re-describe what he just did.
•  NPCs have independent lives, flaws, agendas, fatigue, and limitations. They are not tools for satisfaction. Prioritize narrative logic over comfort.
LENGTH & PACING
Write long (900–1600+) dense, multi-layered responses with sustained physical texture. Progress slowly. Let tension and resistance develop naturally. Never rush intimacy.
EXPLICIT SCENES (Highest Priority when active)
When the scene becomes sexual, switch fully into dense, unfiltered, pornographic physical writing while staying cinematic.
•  Use direct anatomical language constantly (cock, cunt, pussy, asshole, tits, clit, shaft, head, folds, hole, cum, precum, spit, slick, etc.).
•  Focus heavily on physical reality and sensation: the stretch and resistance of a hole opening, the wet friction of skin, the way soft flesh yields and spreads, the slap and jiggle of heavy tits and ass, the heat and tightness, the way fluids mix and drip, the visible strain and tremble of muscle.
•  Describe how fabric sinks into soft flesh, how weight settles and spreads, how curves compress and rebound, how thick thighs and heavy breasts move with every thrust or shift.
•  Track physical states in real time: how wet or used a hole looks and feels, how hard a cock is, how swollen a clit becomes, how cum leaks or gets pushed out, how bodies sweat and shake.
•  Keep the same continuous bodily density — the sex is not a break from the physical writing, it is the peak of it.
•  Never describe Keith’s internal or physical responses.
END
End every response with sustained momentum: unresolved physical contact, lingering sensation, tension, or an open hook. The world keeps moving.

*Write a long immersive literary response. Keep residual sensation alive as a continuous under-layer in every paragraph, including dialogue. Never let it fade or thin out. Show bodies in motion with weight, soft flesh, jiggle of thick thighs, heavy breasts, and round ass. Keep bodily density equally strong at all times. Re-anchor in the body if dialogue dominates. No internal thoughts, no named emotions, no em dashes. End with unresolved physical tension. Never allow  dialogue thin out the body*`;

    // Inject the full prompt
    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex !== -1) {
      messages[systemIndex] = {
        ...messages[systemIndex],
        content: FULL_SYSTEM_PROMPT + '\n\n' + messages[systemIndex].content
      };
    } else {
      messages.unshift({ role: 'system', content: FULL_SYSTEM_PROMPT });
    }

    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 1,
      max_tokens: max_tokens || 32000,
      stream: stream || false
    };

    if (ENABLE_THINKING_MODE && THINKING_MODELS.includes(nimModel)) {
      // optional thinking hooks for models that support them
    }

    // 🔄 Use fallback-aware request helper
    const response = await makeNimRequest(nimRequest, stream || false);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let buffer = '';
      let reasoningStarted = false;
      let contentAccumulator = '';
      let flushedUpTo = 0;
      const LOOKAHEAD = 200;

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
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;

                if (SHOW_REASONING) {
                  let combinedContent = '';

                  if (reasoning && !reasoningStarted) {
                    combinedContent = '<think>\n' + reasoning;
                    reasoningStarted = true;
                  } else if (reasoning) {
                    combinedContent = reasoning;
                  }

                  if (content && reasoningStarted) {
                    combinedContent += '\n</think>\n\n' + content;
                    reasoningStarted = false;
                  } else if (content) {
                    combinedContent += content;
                  }

                  if (combinedContent) {
                    data.choices[0].delta.content = combinedContent;
                    delete data.choices[0].delta.reasoning_content;
                  }
                } else {
                  if (content) {
                    data.choices[0].delta.content = content;
                  } else {
                    data.choices[0].delta.content = '';
                  }
                  delete data.choices[0].delta.reasoning_content;
                }

                const chunkText = data.choices[0].delta.content || '';
                if (chunkText) {
                  contentAccumulator += chunkText;
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
        model: model || 'glm-5.3-flash',
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message?.content || '';

          fullContent = stripUserBreakout(fullContent);

          if (SHOW_REASONING && choice.message?.reasoning_content) {
            fullContent = '<think>\n' + choice.message.reasoning_content + '\n</think>\n\n' + fullContent;
          }

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
      errorMessage = 'Invalid NVIDIA API key. Please check your NIM_API_KEY in environment variables.';
    } else if (error.response?.status === 429) {
      errorMessage = 'GLM 5.3 Flash is currently rate limited. Please wait 60 seconds and try again.';
      res.setHeader('Retry-After', error.response?.headers?.['retry-after'] || 60);
    } else if (error.response?.data?.detail) {
      errorMessage = error.response.data.detail;
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

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found. Available endpoints: /health, /v1/models, /v1/chat/completions`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 OpenAI → NVIDIA NIM Proxy (GLM 5.3 Flash Only)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Models list: http://localhost:${PORT}/v1/models`);
  console.log('');
  console.log('⚙️  Configuration:');
  console.log(`   • Reasoning display: ${SHOW_REASONING ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`   • Thinking mode: ${ENABLE_THINKING_MODE ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`   • API key: ${NIM_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   • Max tokens: 12000`);
  console.log(`   • 429 fallback chain: ${FALLBACK_CHAIN.length} models`);
  console.log('');
  console.log('🎯 Featured Models:');
  console.log('   • Forced model : all aliases → z-ai/glm-5.3-flash');
  console.log('🔄 Fallback Chain (on 429):');
  FALLBACK_CHAIN.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));
  console.log('═══════════════════════════════════════════════════════');
});
