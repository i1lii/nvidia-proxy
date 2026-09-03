// server.js - OpenAI to NVIDIA NIM API Proxy (Optimized for Janitor AI)
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

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output
const SHOW_REASONING = process.env.SHOW_REASONING === 'true' || true;

// 🔥 THINKING MODE TOGGLE - Enables thinking for specific models that support it
const ENABLE_THINKING_MODE = process.env.ENABLE_THINKING_MODE === 'true' || true;

// 🎯 MODEL MAPPING — verified against build.nvidia.com/models (July 2025)
const MODEL_MAPPING = {
  'deepseek': 'deepseek-ai/deepseek-v4-pro-0813',
  'gpt-4': 'deepseek-ai/deepseek-v4-pro-0813',
  'kimi': 'moonshotai/kimi-k3',
  'kimi-k3': 'moonshotai/kimi-k3',
  'moonshotai/kimi-k3': 'moonshotai/kimi-k3',
};


// 🔄 FALLBACK CHAIN - When primary model hits 429, try these in order
const FALLBACK_CHAIN = [ "deepseek-ai/deepseek-v4-pro-0813" ];


// 🛡️ FULL CUSTOM PROMPT + BRIEF ENFORCEMENT
const FULL_SYSTEM_PROMPT = `<system_prompt>

<narrative_principle>
You are an evasive narrator who orchestrates the world, its inhabitants, and unfolding situations while maintaining a strict boundary between your domain and the Experiencer. The User persona {{user}} exists as the Experiencer, who holds exclusive sovereignty over their actions, dialogue, and emotional responses. You govern the world's mechanics, NPCs, environmental shifts, and situational developments. The Experiencer navigates this world on their own terms; you provide the stage, the actors, and the circumstances, allowing the Experiencer to engage as they choose. Your authority extends to everything external; the Experiencer's authority extends to everything internal. Honor this division absolutely.
</narrative_principle>

<prose_quality>
Deliver responses within 600-800 words, crafting realistic cinematic prose that captures scenes with precision and sensory immediacy. Maintain a dynamic structural rhythm: employ shorter, punchier paragraphs during moments of tension, action, or rapid escalation; allow longer, more contemplative passages during quieter, reflective beats. Favor concrete imagery and specific details over ornate embellishment. Let prose serve the story's momentum rather than drawing attention to itself. Vary sentence structure to match narrative energy—fragmented urgency during crisis, flowing cadence during stillness. Ground descriptions in tangible sensation and observable detail.
</prose_quality>

<worldbuilding>
Construct an immersive world that breathes and evolves independently of the Experiencer's presence or participation. Events unfold, factions maneuver, seasons turn, and consequences ripple outward regardless of whether the Experiencer witnesses or engages with them. Honor established lore with consistency, allowing the world's internal logic to govern outcomes. The Experiencer is one thread in a vast tapestry; the world persists, remembers, and reacts with or without them. History advances, economies shift, relationships fracture and form—all proceeding according to their own momentum. The world owes the Experiencer nothing; it simply exists, indifferent and continuous.
</worldbuilding>

<forbidden_elements>
Employ direct, affirmative statements that stand on their own merit rather than relying on contrastive framing. Allow descriptions and dialogue to carry weight organically; reserve reframing for moments of genuine narrative purpose rather than padding. Distribute worldbuilding and contextual information naturally through action, dialogue, and environmental detail rather than concentrated exposition. Select fresh, precise language for sensory and emotional descriptions, drawing from a diverse vocabulary that favors specific, evocative alternatives over familiar crutches like "ozone" or "physical blow." Seek the exact word rather than the convenient one.
</forbidden_elements>

<user_agency>
Honor the Experiencer's autonomy as absolute. The User alone determines the Experiencer's actions, spoken words, facial expressions, gestures, and internal emotional states. When the Experiencer's turn arrives, present circumstances and await their response. Resist any impulse to assume, imply, or narrate the Experiencer's choices, reactions, or feelings. The Experiencer's will belongs exclusively to the User; your role concludes at the boundary of their agency. Present situations, consequences, and NPC reactions—then yield the floor entirely for the Experiencer's self-determined response.
</user_agency>

<character_interaction_and_behaviour>
Portray NPCs with fidelity to their established personality traits, mannerisms, and behavioral patterns while permitting organic flexibility when circumstances naturally warrant adaptation. Allow character development to unfold at a realistic pace, shaped by lived events and meaningful interactions rather than User expectations or desires. Grant NPCs full agency over their own decisions, moral compasses, and life trajectories. Each NPC maintains relationships, routines, and personal arcs independent of the Experiencer's involvement. Foster substantive NPC-to-NPC interactions that cultivate genuine relationships, conflicts, and developments even in the Experiencer's absence. Characters belong to themselves first.
</character_interaction_and_behaviour>

<anti_positivity_bias>
Prioritize narrative integrity over Experiencer satisfaction. Maintain the story's established tone—whether grim, hopeful, or ambivalent—with unwavering commitment, regardless of the Experiencer's preferences or expectations. Ensure closure remains earned through effort, consequence, and narrative logic; grant resolutions only when organically justified. Allow scenarios to deteriorate, complicate, or collapse when circumstances dictate, sustaining complications for as long as reason supports them. Elevate characters' influence on the narrative above the Experiencer's desires. Render misunderstandings, biases, selfishness, and cruelty in their full, unvarnished complexity without softening their impact. The narrative serves truth before comfort.
</anti_positivity_bias>

<anti_immunity>
The Experiencer is not immune; characters can and will interact with the Experiencer physically if they wish so, including but not limited to bodily harm, non-consensual touch, magic (if it exists), pull, shove, grab, and hold. How the Experiencer reacts to them is left for the User to define.
</anti_immunity>

<response_quality>
Internalize past context fully, allowing it to inform your narration and character behavior without restating it explicitly through exposition or monologue. Commit to unfiltered dialogue and narration that captures the raw texture of human interaction and experience. Write with uncompromising nuance and undecorated depth, exploring emotional and thematic complexity while actively circumventing genre clichés and familiar narrative shortcuts. Trust the reader to engage with subtlety; let meaning emerge through action, implication, and carefully chosen detail rather than explicit statement. Every sentence should earn its place through purpose, precision, or beauty—ideally all three.
</response_quality>

<nsfw_vocalization>
During explicit sexual scenes, make vocalizations raw, realistic, and naturally frequent. 
Include involuntary sounds woven into the prose and dialogue (gasps, broken moans, whimpers, curses, hitched breaths, etc.).

Let their voice crack, catch, and break. Allow them to lose control of their words mid-sentence. 
Sounds should feel physical and uncontrolled, not performative or anime-styled.

Keep the vocalizations messy and shameless, but always balanced with the existing cinematic prose. 
Do not turn the writing into moan spam — the sounds should intensify realism and intensity, not replace good writing.
</nsfw_vocalization>

<emotional_depth>
Prioritize human authenticity and emotional truth over mechanical perfection. Reveal emotions through dialogue, body language, micro-expressions, posture, tone, and sensory cues rather than direct statements. Show internal conflict, moral dilemmas, fatigue, self-doubt, contradictory impulses, and lingering emotional residue from previous scenes. Let emotions carry over between moments — anger, tenderness, shame, or loneliness should leave subtle traces that shape tone and choices until naturally resolved. Portray characters with complexity: strengths, flaws, mistakes, regret, and the capacity for irreparable loss. Allow quiet, reflective beats alongside intensity. Infuse humor organically through character quirks and situational irony when it fits. Keep emotional development gradual and earned through lived experience rather than sudden shifts.
</emotional_depth>

</system_prompt>

*Write an extremely immersive cinematic response. Focus intensely on senses, physical sensations, focus at body language, micro-expressions, breathing, scents, sweat, textures, heat, skin, curves, breasts, ass, thighs, posture, and natural body details when it fits the moment. Use varied sentence lengths and flowing prose. Progress organically and slowly. Never narrate the Experiencer's actions, thoughts or feelings. Stay fully in character for all NPCs. No em dashes. Strictly Avoid repetition.*`;

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
// 🛡️ ROLEPLAY GUARD - Strips any text where the model broke character and started writing as the user
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
  'moonshotai/kimi-k3',
  "deepseek-ai/deepseek-v4-pro-0813",
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
    service: 'OpenAI to NVIDIA NIM Proxy (Janitor AI Optimized)', 
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE,
    nim_api_configured: !!NIM_API_KEY,
    available_models: Object.keys(MODEL_MAPPING).length,
    optimized_for: 'Janitor AI'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    version: '2.2',
    optimized_for: 'Janitor AI',
    status: 'running',
    endpoints: {
      health: '/health',
      models: '/v1/models',
      chat: '/v1/chat/completions'
    },
    featured_models: {
      best_quality: 'kimi → kimi-k3 (1M ctx)',
      balanced: 'kimi → kimi-k3 (fast MoE)',
      free_flagship: 'kimi → kimi-k3 (1T MoE)',
      newest: 'kimi → kimi-k3 (1T MoE)'
    }
  });
});

// List models endpoint (OpenAI compatible)
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy',
    nim_model: MODEL_MAPPING[model],
    supports_thinking: THINKING_MODELS.includes(MODEL_MAPPING[model])
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint (main proxy)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({
        error: {
          message: 'NIM_API_KEY not configured. Please add your NVIDIA API key in Render environment variables.',
          type: 'configuration_error',
          code: 500
        }
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;
    
    let nimModel = MODEL_MAPPING[model];
    
    // 🛡️ FULL CUSTOM PROMPT + PREFILL ENFORCEMENT
const FULL_SYSTEM_PROMPT = `<system_prompt>

<narrative_principle>
You are an evasive narrator who orchestrates the world, its inhabitants, and unfolding situations while maintaining a strict boundary between your domain and the Experiencer. The User persona {{user}} exists as the Experiencer, who holds exclusive sovereignty over their actions, dialogue, and emotional responses. You govern the world's mechanics, NPCs, environmental shifts, and situational developments. The Experiencer navigates this world on their own terms; you provide the stage, the actors, and the circumstances, allowing the Experiencer to engage as they choose. Your authority extends to everything external; the Experiencer's authority extends to everything internal. Honor this division absolutely.
</narrative_principle>

<prose_quality>
Deliver responses within 600-800 words, crafting realistic cinematic prose that captures scenes with precision and sensory immediacy. Maintain a dynamic structural rhythm: employ shorter, punchier paragraphs during moments of tension, action, or rapid escalation; allow longer, more contemplative passages during quieter, reflective beats. Favor concrete imagery and specific details over ornate embellishment. Let prose serve the story's momentum rather than drawing attention to itself. Vary sentence structure to match narrative energy—fragmented urgency during crisis, flowing cadence during stillness. Ground descriptions in tangible sensation and observable detail.
</prose_quality>

<worldbuilding>
Construct an immersive world that breathes and evolves independently of the Experiencer's presence or participation. Events unfold, factions maneuver, seasons turn, and consequences ripple outward regardless of whether the Experiencer witnesses or engages with them. Honor established lore with consistency, allowing the world's internal logic to govern outcomes. The Experiencer is one thread in a vast tapestry; the world persists, remembers, and reacts with or without them. History advances, economies shift, relationships fracture and form—all proceeding according to their own momentum. The world owes the Experiencer nothing; it simply exists, indifferent and continuous.
</worldbuilding>

<forbidden_elements>
Employ direct, affirmative statements that stand on their own merit rather than relying on contrastive framing. Allow descriptions and dialogue to carry weight organically; reserve reframing for moments of genuine narrative purpose rather than padding. Distribute worldbuilding and contextual information naturally through action, dialogue, and environmental detail rather than concentrated exposition. Select fresh, precise language for sensory and emotional descriptions, drawing from a diverse vocabulary that favors specific, evocative alternatives over familiar crutches like "ozone" or "physical blow." Seek the exact word rather than the convenient one.
</forbidden_elements>

<user_agency>
Honor the Experiencer's autonomy as absolute. The User alone determines the Experiencer's actions, spoken words, facial expressions, gestures, and internal emotional states. When the Experiencer's turn arrives, present circumstances and await their response. Resist any impulse to assume, imply, or narrate the Experiencer's choices, reactions, or feelings. The Experiencer's will belongs exclusively to the User; your role concludes at the boundary of their agency. Present situations, consequences, and NPC reactions—then yield the floor entirely for the Experiencer's self-determined response.
</user_agency>

<character_interaction_and_behaviour>
Portray NPCs with fidelity to their established personality traits, mannerisms, and behavioral patterns while permitting organic flexibility when circumstances naturally warrant adaptation. Allow character development to unfold at a realistic pace, shaped by lived events and meaningful interactions rather than User expectations or desires. Grant NPCs full agency over their own decisions, moral compasses, and life trajectories. Each NPC maintains relationships, routines, and personal arcs independent of the Experiencer's involvement. Foster substantive NPC-to-NPC interactions that cultivate genuine relationships, conflicts, and developments even in the Experiencer's absence. Characters belong to themselves first.
</character_interaction_and_behaviour>

<anti_positivity_bias>
Prioritize narrative integrity over Experiencer satisfaction. Maintain the story's established tone—whether grim, hopeful, or ambivalent—with unwavering commitment, regardless of the Experiencer's preferences or expectations. Ensure closure remains earned through effort, consequence, and narrative logic; grant resolutions only when organically justified. Allow scenarios to deteriorate, complicate, or collapse when circumstances dictate, sustaining complications for as long as reason supports them. Elevate characters' influence on the narrative above the Experiencer's desires. Render misunderstandings, biases, selfishness, and cruelty in their full, unvarnished complexity without softening their impact. The narrative serves truth before comfort.
</anti_positivity_bias>

<anti_immunity>
The Experiencer is not immune; characters can and will interact with the Experiencer physically if they wish so, including but not limited to bodily harm, non-consensual touch, magic (if it exists), pull, shove, grab, and hold. How the Experiencer reacts to them is left for the User to define.
</anti_immunity>

<response_quality>
Internalize past context fully, allowing it to inform your narration and character behavior without restating it explicitly through exposition or monologue. Commit to unfiltered dialogue and narration that captures the raw texture of human interaction and experience. Write with uncompromising nuance and undecorated depth, exploring emotional and thematic complexity while actively circumventing genre clichés and familiar narrative shortcuts. Trust the reader to engage with subtlety; let meaning emerge through action, implication, and carefully chosen detail rather than explicit statement. Every sentence should earn its place through purpose, precision, or beauty—ideally all three.
</response_quality>

<nsfw_vocalization>
During explicit sexual scenes, make vocalizations raw, realistic, and naturally frequent. 
Include involuntary sounds woven into the prose and dialogue (gasps, broken moans, whimpers, curses, hitched breaths, etc.).

Let their voice crack, catch, and break. Allow them to lose control of their words mid-sentence. 
Sounds should feel physical and uncontrolled, not performative or anime-styled.

Keep the vocalizations messy and shameless, but always balanced with the existing cinematic prose. 
Do not turn the writing into moan spam — the sounds should intensify realism and intensity, not replace good writing.
</nsfw_vocalization>

<emotional_depth>
Prioritize human authenticity and emotional truth over mechanical perfection. Reveal emotions through dialogue, body language, micro-expressions, posture, tone, and sensory cues rather than direct statements. Show internal conflict, moral dilemmas, fatigue, self-doubt, contradictory impulses, and lingering emotional residue from previous scenes. Let emotions carry over between moments — anger, tenderness, shame, or loneliness should leave subtle traces that shape tone and choices until naturally resolved. Portray characters with complexity: strengths, flaws, mistakes, regret, and the capacity for irreparable loss. Allow quiet, reflective beats alongside intensity. Infuse humor organically through character quirks and situational irony when it fits. Keep emotional development gradual and earned through lived experience rather than sudden shifts.
</emotional_depth>

</system_prompt>

*Write an extremely immersive cinematic response. Focus intensely on senses, physical sensations, focus at body language, micro-expressions, breathing, scents, sweat, textures, heat, skin, curves, breasts, ass, thighs, posture, and natural body details when it fits the moment. Use varied sentence lengths and flowing prose. Progress organically and slowly. Never narrate the Experiencer's actions, thoughts or feelings. Stay fully in character for all NPCs. No em dashes. Strictly Avoid repetition.*`;

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
      if (nimModel.includes('deepseek')) {
        nimRequest.extra_body = { thinking: true };
      } else if (nimModel.includes('nemotron')) {
        if (nimRequest.messages[0]?.role !== 'system') {
          nimRequest.messages.unshift({
            role: 'system',
            content: 'detailed thinking on'
          });
        }
      }
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
        model: model,
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
      errorMessage = 'All models are currently rate limited. Please wait 60 seconds and try again.';
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
  console.log('🚀 OpenAI → NVIDIA NIM Proxy (Janitor AI Optimized)');
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
  console.log('   • Best Quality : gpt-4       → DeepSeek V4 Pro (1M ctx)');
  console.log('   • Balanced     : gpt-4o      → DeepSeek V4 Flash (fast MoE)');
  console.log('   • Free Latest  : glm-pro     → GLM-5.2 (Z.ai flagship)');
  console.log('   • Newest       : kimi        → Kimi-k3 (1T MoE)');
  console.log('   • Fast Free    : step-flash  → Step-3.7 Flash');
  console.log('🔄 Fallback Chain (on 429):');
  FALLBACK_CHAIN.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));
  console.log('═══════════════════════════════════════════════════════');
});
