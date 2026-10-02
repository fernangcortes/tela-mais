/* ia/texto/anthropic.js — Messages API da Anthropic, por fetch puro (sem SDK).
 *
 * CONFERIDO em platform.claude.com/docs/en/api/messages (2026-10-02): POST https://api.anthropic.com/v1/messages, cabeçalhos
 * `x-api-key` e `anthropic-version: 2023-06-01`; corpo { model, max_tokens, system, messages }; resposta com `content[]`
 * (blocos `type:"text"`), `stop_reason` e `usage.input_tokens/output_tokens`. NÃO CONFERIDO: o JSON estruturado nativo
 * (`output_config.format`) — não é usado; a conferência do JSON é do código (texto.js). */
import { pedir, exigirJson } from './http.js';

export const ID = 'anthropic';
const URL_MENSAGENS = 'https://api.anthropic.com/v1/messages';
export const VERSAO_DA_API = '2023-06-01';

export async function chamar({ fetch, chave, modelo, sistema, usuario, maxTokens }) {
  const r = await pedir(fetch, URL_MENSAGENS, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO_DA_API },
    body: JSON.stringify({ model: modelo, max_tokens: maxTokens, system: sistema, messages: [{ role: 'user', content: usuario }] })
  });
  const c = exigirJson(r);
  const texto = (Array.isArray(c.content) ? c.content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const u = c.usage || {};
  return {
    texto, recusou: c.stop_reason === 'refusal', cortou: c.stop_reason === 'max_tokens',
    entradaTokens: Number(u.input_tokens) || 0, saidaTokens: Number(u.output_tokens) || 0
  };
}
