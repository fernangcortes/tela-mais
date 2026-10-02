/* /api/mcp-tokens — a tela "Integrações / MCP" do /admin. Só o superadmin, em todos os métodos.
 *
 *   GET                         -> { ligado, somenteLeitura, url, tokens[], auditoria[] }  (nunca o hash nem o token)
 *   GET ?antes=ID               -> mais registros de auditoria, do mais novo para o mais velho
 *   POST { nome, escopo, dias } -> cria o token e o devolve UMA VEZ: { token: { id, token, ... } }
 *   DELETE ?id=…                -> revoga (vale no pedido seguinte)
 *
 * Quem liga o MCP é o config/site.json (`mcp.ligado`), por deploy: a tela mostra o estado e avisa, mas não liga. */
import { json, erro } from '../_lib/sessao.js';
import { abrirBanco, lerCorpo } from '../_lib/contas-fluxo.js';
import { criarToken, listarTokens, revogarToken, listarAuditoria, validarCriacao } from '../_lib/mcp-tokens.js';

export async function onRequestGet({ request, env, config }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const p = new URL(request.url).searchParams;
  const mcp = (config && config.mcp) || {};
  if (p.has('antes')) return json(200, { auditoria: await listarAuditoria(env, { antesDe: p.get('antes') }) });
  return json(200, {
    ligado: mcp.ligado === true,
    somenteLeitura: mcp.somenteLeitura !== false,
    url: new URL(request.url).origin + '/mcp',
    tokens: await listarTokens(env),
    auditoria: await listarAuditoria(env, { limite: 50 })
  });
}

export async function onRequestPost({ request, env, data }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const v = validarCriacao({ nome: corpo.nome, escopo: corpo.escopo, dias: corpo.dias });
  if (!v.ok) return erro(400, v.codigo);
  const criado = await criarToken(env, { nome: v.nome, escopo: v.escopo, dias: v.dias, criadoPor: (data.conta && data.conta.usuario) || 'superadmin' });
  return json(200, { ok: true, token: criado });
}

export async function onRequestDelete({ request, env }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return erro(400, 'mcp-id-faltando');
  const revogou = await revogarToken(env, id);
  return revogou ? json(200, { ok: true }) : erro(404, 'mcp-token-inexistente');
}
