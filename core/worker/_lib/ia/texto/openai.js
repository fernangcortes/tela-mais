/* ia/texto/openai.js — Chat Completions da OpenAI, por fetch puro.
 *
 * FORMATO (conhecimento da API; a página oficial não estava acessível desta máquina em 2026-10-02, então NÃO RECONFERIDO hoje):
 * POST https://api.openai.com/v1/chat/completions, `Authorization: Bearer`, corpo { model, messages, max_completion_tokens,
 * response_format:{type:"json_object"} }; resposta em `choices[0].message.content` e `usage.prompt_tokens/completion_tokens`.
 * Modelos de raciocínio gastam parte de `max_completion_tokens` pensando: o teto aqui já vem folgado (texto.js). */
import { pedir, exigirJson } from './http.js';

export const ID = 'openai';
const URL_CHAT = 'https://api.openai.com/v1/chat/completions';

export async function chamar({ fetch, chave, modelo, sistema, usuario, maxTokens }) {
  const r = await pedir(fetch, URL_CHAT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chave },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' }
    })
  });
  const c = exigirJson(r);
  const escolha = (Array.isArray(c.choices) && c.choices[0]) || {};
  const msg = escolha.message || {};
  const u = c.usage || {};
  return {
    texto: typeof msg.content === 'string' ? msg.content : '',
    recusou: Boolean(msg.refusal) || escolha.finish_reason === 'content_filter', cortou: escolha.finish_reason === 'length',
    entradaTokens: Number(u.prompt_tokens) || 0, saidaTokens: Number(u.completion_tokens) || 0
  };
}
