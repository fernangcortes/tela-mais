/* ia/texto/workers-ai.js — modelos de texto do Workers AI (a conta Cloudflare do próprio cliente).
 *
 * DOIS CAMINHOS, o mesmo corpo:
 *   binding  `env.AI.run(modelo, entrada)` — dentro do Worker, sem chave;
 *   REST     POST /accounts/{id}/ai/run/{modelo} com token — para os scripts (Node/GitHub Actions), que não têm o binding.
 *
 * CONFERIDO no catálogo de modelos da Cloudflare (cloudflare-docs, 2026-10-02) para `@cf/google/gemma-4-26b-a4b-it`: entrada
 * estilo Chat Completions (`messages`, `max_tokens`, `response_format:{type:"json_object"}`) e saída `choices[0].message.content`
 * com `usage`. Modelos mais antigos devolvem `{ response: "texto" }`; os dois formatos são aceitos aqui. */
import { ErroIA } from '../erros.js';
import { pedir, exigirJson, detalheDeErro } from './http.js';

export const ID = 'workers-ai';
const BASE = 'https://api.cloudflare.com/client/v4/accounts/';

function lerSaida(r) {
  const escolha = (r && Array.isArray(r.choices) && r.choices[0]) || null;
  let texto = '';
  if (escolha && escolha.message && typeof escolha.message.content === 'string') texto = escolha.message.content;
  else if (r && typeof r.response === 'string') texto = r.response;
  else if (r && r.response && typeof r.response === 'object') texto = JSON.stringify(r.response);   /* modo JSON devolve objeto */
  const u = (r && r.usage) || {};
  return {
    texto, recusou: false, cortou: Boolean(escolha && escolha.finish_reason === 'length'),
    entradaTokens: Number(u.prompt_tokens) || 0, saidaTokens: Number(u.completion_tokens) || 0
  };
}

export async function chamar({ fetch, chave, modelo, sistema, usuario, maxTokens, binding, contaId }) {
  const entrada = {
    messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  };
  if (binding) {
    try {
      return lerSaida(await binding.run(modelo, entrada));
    } catch (e) {
      throw new ErroIA('ia-provedor-inacessivel', { detalhe: (e && e.message) || 'o Workers AI falhou', retentavel: true });
    }
  }
  const r = await pedir(fetch, BASE + encodeURIComponent(contaId) + '/ai/run/' + modelo, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chave },
    body: JSON.stringify(entrada)
  });
  const c = exigirJson(r);
  if (c.success === false) throw new ErroIA('ia-provedor-recusou', { status: r.status, detalhe: detalheDeErro(c), retentavel: false });
  return lerSaida(c.result !== undefined ? c.result : c);
}
