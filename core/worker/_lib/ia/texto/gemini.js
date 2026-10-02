/* ia/texto/gemini.js — generateContent da Gemini API, por fetch puro.
 *
 * FORMATO (conhecimento da API; ai.google.dev não estava acessível desta máquina em 2026-10-02, NÃO RECONFERIDO hoje):
 * POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent, cabeçalho `x-goog-api-key`
 * (a chave NUNCA vai na URL), corpo { systemInstruction, contents, generationConfig:{maxOutputTokens, responseMimeType} };
 * resposta em `candidates[0].content.parts[].text` e `usageMetadata.promptTokenCount/candidatesTokenCount`. */
import { pedir, exigirJson } from './http.js';

export const ID = 'gemini';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export async function chamar({ fetch, chave, modelo, sistema, usuario, maxTokens }) {
  const r = await pedir(fetch, BASE + encodeURIComponent(modelo) + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: [{ text: usuario }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' }
    })
  });
  const c = exigirJson(r);
  const cand = (Array.isArray(c.candidates) && c.candidates[0]) || {};
  const partes = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
  const u = c.usageMetadata || {};
  return {
    texto: partes.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''),
    recusou: Boolean(c.promptFeedback && c.promptFeedback.blockReason) || cand.finishReason === 'SAFETY',
    cortou: cand.finishReason === 'MAX_TOKENS',
    entradaTokens: Number(u.promptTokenCount) || 0,
    saidaTokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0)
  };
}
