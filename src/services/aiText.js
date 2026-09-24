/**
 * aiText.js — one call to get a piece of prose from whichever AI provider the
 * dashboard has available, in this order:
 *
 *   1. Groq / Llama, when Conversational Analytics has a Groq key configured
 *      (same key and model the chat uses).
 *   2. Gemini, with the models discovered from the API for this key rather
 *      than guessed: the configured model first, then the fallbacks, then any
 *      other "flash" model the key can use. Quota (429), retired-model (404)
 *      and overload (503) replies move on to the next model.
 *
 * Throws with `status` (of the FIRST failure, i.e. the root cause) and
 * `attempts` (one line per model tried) so callers can explain what happened.
 */
import { getStoredApiKey, GEMINI_MODEL, GEMINI_FALLBACK_MODELS } from './geminiService';
import { getStoredLlamaConfig } from './llamaService';

const MODEL_CACHE_KEY = 'gemini_models_v1';
const MODEL_CACHE_MS = 60 * 60 * 1000;

async function listGeminiModels(apiKey) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(MODEL_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.models;
  } catch (_) { /* storage unavailable */ }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`);
  if (!res.ok) return [];
  const data = await res.json();
  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  try { sessionStorage.setItem(MODEL_CACHE_KEY, JSON.stringify({ at: Date.now(), models })); } catch (_) { /* ignore */ }
  return models;
}

function geminiCandidates(available) {
  const preferred = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  const known = new Set(available);
  const list = [];
  preferred.forEach((m) => { if (!available.length || known.has(m)) list.push(m); });
  available
    .filter((m) => /flash|lite/i.test(m) && !/embedding|image|tts|audio|live|thinking|exp|preview|omni/i.test(m))
    .sort()
    .reverse()
    .forEach((m) => { if (!list.includes(m)) list.push(m); });
  return list.slice(0, 6);
}

const describe = (status, body) => {
  let msg = '';
  try { msg = JSON.parse(body)?.error?.message || ''; } catch (_) { msg = body; }
  return `HTTP ${status}${msg ? ` — ${String(msg).slice(0, 140)}` : ''}`;
};

export async function generateText(prompt, { temperature = 0.3 } = {}) {
  const attempts = [];
  let root = null;

  // 1. Groq / Llama, exactly as the chat is configured
  const llama = getStoredLlamaConfig();
  if (llama.apiKey) {
    try {
      const res = await fetch(llama.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llama.apiKey}` },
        body: JSON.stringify({ model: llama.model, temperature, messages: [{ role: 'user', content: prompt }] }),
      });
      if (res.ok) {
        const d = await res.json();
        const text = String(d.choices?.[0]?.message?.content || '').trim();
        if (text) return { text, provider: 'Groq', model: llama.model };
        attempts.push(`${llama.model}: empty reply`);
      } else {
        const line = describe(res.status, await res.text().catch(() => ''));
        attempts.push(`${llama.model}: ${line}`);
        if (!root) root = { status: res.status, line };
      }
    } catch (e) {
      attempts.push(`${llama.model}: ${e.message}`);
    }
  }

  // 2. Gemini, over the models this key can actually use
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    const err = new Error(attempts.length ? attempts.join('; ') : 'No Gemini or Groq API key is configured');
    err.attempts = attempts;
    throw err;
  }
  const available = await listGeminiModels(apiKey).catch(() => []);
  for (const model of geminiCandidates(available)) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature } }),
      });
    } catch (e) {
      attempts.push(`${model}: ${e.message}`);
      continue;
    }
    if (res.ok) {
      const d = await res.json();
      const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
      if (text) return { text, provider: 'Gemini', model };
      attempts.push(`${model}: empty reply (${d.candidates?.[0]?.finishReason || 'no candidate'})`);
      continue;
    }
    const line = describe(res.status, await res.text().catch(() => ''));
    attempts.push(`${model}: ${line}`);
    if (!root) root = { status: res.status, line };
    if (![429, 404, 500, 503].includes(res.status)) break;
  }

  const err = new Error(root ? `Gemini ${root.line}` : 'No AI model returned a reply');
  err.status = root?.status;
  err.attempts = attempts;
  throw err;
}
