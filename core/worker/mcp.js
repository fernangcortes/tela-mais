/* mcp.js — o endpoint /mcp: servidor MCP remoto, STATELESS, JSON-RPC 2.0 sobre Streamable HTTP, sem dependências.
 *
 * PROTOCOLO. Implementa a revisão 2025-06-18 do Model Context Protocol (e aceita negociar 2025-03-26 e 2024-11-05, as que os
 * clientes ainda usam). Não conseguimos ler a especificação nova (modelcontextprotocol.io estava fora do alcance ao escrever isto), então
 * o servidor é tolerante pelo lado seguro: não exige `initialize` antes de `tools/list` e `tools/call`, não emite
 * `Mcp-Session-Id` e não guarda estado entre pedidos. Isso cobre tanto os clientes que ainda fazem o aperto de mão quanto os da
 * linha "stateless" da especificação mais nova. Reconferir contra a especificação vigente quando ela estiver acessível.
 *
 *   POST /mcp   um (ou vários) mensagem JSON-RPC. Pedido -> resposta `application/json`. Notificação ou resposta -> 202, sem corpo.
 *   GET  /mcp   405: não oferecemos o fluxo SSE do servidor para o cliente (permitido pela especificação).
 *   DELETE      405: sem sessão para encerrar.
 *
 * SEGURANÇA, nesta ordem: (1) `mcp.ligado` falso => 404 (o endpoint nem existe para quem não ligou); (2) `Origin` de outro site => 403
 * (a defesa de DNS rebinding que a especificação exige: cliente de linha de comando e de IDE não manda Origin); (3) token Bearer
 * `mcp_…` válido, não vencido e não revogado => senão 401; (4) limite de taxa por token => 429; (5) o escopo efetivo
 * (o menor entre o do token e o que `mcp.somenteLeitura` permite) decide o que `tools/list` mostra e o que `tools/call` aceita;
 * (6) toda chamada de ferramenta vai para a auditoria. O token da equipe (Bearer da mesa) NÃO vale aqui, e o do MCP não vale na API. */
import { json } from './_lib/sessao.js';
import { VERSAO_DO_CORE } from './_lib/saude.js';
import { autenticar, registrarAuditoria, escopoMenor, nivelDoEscopo } from './_lib/mcp-tokens.js';
import { FERRAMENTAS, FERRAMENTA_POR_NOME, ErroDeFerramenta } from './_lib/mcp-ferramentas.js';
import { chaveDe, limitar } from './_lib/limite.js';
import { idiomaDoPedido } from './_lib/mensagens.js';
import { CATALOGOS_DE_FABRICA } from './_lib/i18n-catalogos.mjs';
import AppI18n from '../site/i18n.js';

export const VERSOES_SUPORTADAS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const LIMITE_POR_MINUTO = 60;
const TAMANHO_MAXIMO_DO_CORPO = 256 * 1024;

/* Códigos de erro do JSON-RPC 2.0. */
const E = { PARSE: -32700, PEDIDO: -32600, METODO: -32601, PARAMS: -32602, INTERNO: -32603, NAO_AUTORIZADO: -32001, LIMITE: -32002, DESLIGADO: -32003 };

/* Mensagens do PROTOCOLO (JSON-RPC), em inglês, como os clientes de IA esperam: não são texto de tela. */
const MSG = {
  semNome: 'Invalid params: "name" is required', /* i18n-ignorar: protocolo */
  ferramentaDesconhecida: 'Unknown tool: ', /* i18n-ignorar: protocolo */
  argumentosNaoObjeto: 'Invalid params: "arguments" must be an object', /* i18n-ignorar: protocolo */
  pedidoInvalido: 'Invalid Request', /* i18n-ignorar: protocolo */
  idInvalido: 'Invalid Request: id must be a string or a number', /* i18n-ignorar: protocolo */
  metodoDesconhecido: 'Method not found: ', /* i18n-ignorar: protocolo */
  desligado: 'MCP is not enabled on this site', /* i18n-ignorar: protocolo */
  origem: 'Origin not allowed', /* i18n-ignorar: protocolo */
  banco: 'Database unavailable', /* i18n-ignorar: protocolo */
  naoAutorizado: 'Unauthorized: ', /* i18n-ignorar: protocolo */
  limite: 'Rate limit exceeded', /* i18n-ignorar: protocolo */
  versao: 'Unsupported MCP-Protocol-Version', /* i18n-ignorar: protocolo */
  grande: 'Request too large', /* i18n-ignorar: protocolo */
  loteVazio: 'Invalid Request: empty batch', /* i18n-ignorar: protocolo */
  loteGrande: 'Invalid Request: batch too large', /* i18n-ignorar: protocolo */
  soPost: ' is not supported; use POST', /* i18n-ignorar: protocolo */
  parse: 'Parse error' /* i18n-ignorar: protocolo */
};

const rpcErro = (id, codigo, mensagem, dados) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: Object.assign({ code: codigo, message: mensagem }, dados === undefined ? {} : { data: dados }) });
const rpcOk = (id, resultado) => ({ jsonrpc: '2.0', id, result: resultado });

function resposta(status, corpo, extras) {
  return json(status, corpo, extras);
}

/* Quem o token é, para o catálogo: uma conta de equipe SEM poder de superadmin. As permissões finas do PUT valem por cima. */
function contaDoToken(token, escopo) {
  const permissoes = nivelDoEscopo(escopo) >= nivelDoEscopo('curate') ? ['conteudo', 'no-ar', 'estrutura'] : [];
  return { usuario: 'mcp:' + token.nome, nome: token.nome, super: false, permissoes, mcp: true };
}

function configMcp(config) {
  const m = (config && config.mcp) || {};
  return { ligado: m.ligado === true, somenteLeitura: m.somenteLeitura !== false };
}

function tradutor(request, config) {
  const { idioma, padrao } = idiomaDoPedido(request, config);
  const inst = AppI18n.criar({ idioma, padrao, catalogos: CATALOGOS_DE_FABRICA, overrides: {} });
  return (chave, params) => (inst.tem(chave) ? inst.t(chave, params) : chave);
}

/* O escopo que vale agora e a lista do que ele enxerga. */
function escopoEfetivo(token, cfg) {
  return cfg.somenteLeitura ? escopoMenor(token.escopo, 'read') : token.escopo;
}

function descreverFerramenta(f, t) {
  return {
    name: f.nome,
    description: t('mcp.d.' + f.nome),
    inputSchema: f.esquema,
    annotations: { readOnlyHint: f.leitura === true, destructiveHint: f.leitura ? false : Boolean(f.destrutiva), idempotentHint: f.leitura === true, openWorldHint: false }
  };
}

function resultadoDeFerramenta(dados, { erro = false } = {}) {
  return { content: [{ type: 'text', text: JSON.stringify(dados) }], structuredContent: dados, isError: erro };
}

function resultadoDeErro(t, codigo, params, extras) {
  const mensagem = t('mcp.e.' + codigo, params || undefined);
  return resultadoDeFerramenta(Object.assign({ ok: false, erro: codigo, mensagem }, extras || {}), { erro: true });
}

async function chamarFerramenta(params, ctx) {
  const { t, token, cfg, escopo } = ctx;
  if (!params || typeof params !== 'object' || typeof params.name !== 'string') return { protocolo: rpcErro(ctx.id, E.PARAMS, MSG.semNome) };
  const f = FERRAMENTA_POR_NOME.get(params.name);
  if (!f) {
    await registrarAuditoria(ctx.env, { token, ferramenta: params.name, argumentos: null, resultado: 'erro', detalhe: 'ferramenta-desconhecida' });
    return { protocolo: rpcErro(ctx.id, E.PARAMS, MSG.ferramentaDesconhecida + String(params.name).slice(0, 60)) };
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    await registrarAuditoria(ctx.env, { token, ferramenta: f.nome, argumentos: null, resultado: 'erro', detalhe: 'argumentos-invalidos' });
    return { protocolo: rpcErro(ctx.id, E.PARAMS, MSG.argumentosNaoObjeto) };
  }

  const auditar = (resultado, detalhe) => registrarAuditoria(ctx.env, { token, ferramenta: f.nome, argumentos: args, resultado, detalhe });

  if (nivelDoEscopo(f.escopo) > nivelDoEscopo(escopo)) {
    const porConfig = cfg.somenteLeitura && nivelDoEscopo(f.escopo) <= nivelDoEscopo(token.escopo);
    const codigo = porConfig ? 'somente-leitura' : 'escopo-insuficiente';
    await auditar('negado', codigo);
    return { resultado: resultadoDeErro(t, codigo, { escopo: token.escopo, exigido: f.escopo }) };
  }

  try {
    const r = await f.executar(args, Object.assign({}, ctx.exec, { conta: contaDoToken(token, escopo) }));
    await auditar(r.dados && r.dados.confirmacaoNecessaria ? 'confirmacao' : 'ok', r.dados && r.dados.nadaMudou ? 'nada-mudou' : null);
    return { resultado: resultadoDeFerramenta(r.dados) };
  } catch (e) {
    if (e instanceof ErroDeFerramenta) {
      await auditar(e.codigo === 'conflito' ? 'conflito' : (e.codigo === 'permissao-negada' ? 'negado' : 'erro'), e.codigo);
      return { resultado: resultadoDeErro(t, e.codigo, e.params, e.extras) };
    }
    await auditar('erro', 'interno');
    console.error('mcp: ferramenta falhou:', f.nome, e && e.message); /* i18n-ignorar: log técnico, não vai à tela */
    return { resultado: resultadoDeErro(t, 'interno') };
  }
}

/* Uma mensagem JSON-RPC. Devolve o objeto de resposta, ou null quando é notificação/resposta (nada a devolver). */
async function tratarMensagem(msg, ctx) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return rpcErro(msg && msg.id, E.PEDIDO, MSG.pedidoInvalido);
  const temId = Object.prototype.hasOwnProperty.call(msg, 'id');
  if (typeof msg.method !== 'string') {
    /* resposta do cliente a algo nosso: não mandamos pedidos ao cliente, então só se ignora. */
    return temId && ('result' in msg || 'error' in msg) ? null : rpcErro(msg.id, E.PEDIDO, MSG.pedidoInvalido);
  }
  if (!temId) return null;   /* notificação (ex.: notifications/initialized): 202 */
  if (typeof msg.id !== 'string' && typeof msg.id !== 'number') return rpcErro(null, E.PEDIDO, MSG.idInvalido);
  const { t, cfg, escopo } = ctx;

  switch (msg.method) {
    case 'initialize': {
      const pedida = msg.params && msg.params.protocolVersion;
      const versao = VERSOES_SUPORTADAS.indexOf(pedida) >= 0 ? pedida : VERSOES_SUPORTADAS[0];
      const marca = (ctx.config && ctx.config.marca && ctx.config.marca.nome) || 'streaming';
      return rpcOk(msg.id, {
        protocolVersion: versao,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: String(marca).slice(0, 60), version: VERSAO_DO_CORE },
        instructions: t('mcp.instrucoes')
      });
    }
    case 'ping':
      return rpcOk(msg.id, {});
    case 'tools/list':
      return rpcOk(msg.id, { tools: FERRAMENTAS.filter((f) => nivelDoEscopo(f.escopo) <= nivelDoEscopo(escopo)).map((f) => descreverFerramenta(f, t)) });
    case 'tools/call': {
      const r = await chamarFerramenta(msg.params, Object.assign({}, ctx, { id: msg.id }));
      return r.protocolo || rpcOk(msg.id, r.resultado);
    }
    default:
      return rpcErro(msg.id, E.METODO, MSG.metodoDesconhecido + msg.method.slice(0, 60));
  }
}

function naoPermitido(metodo) {
  return resposta(405, rpcErro(null, E.PEDIDO, metodo + MSG.soPost), { allow: 'POST' });
}

export async function onRequestGet({ config }) {
  return configMcp(config).ligado ? naoPermitido('GET') : desligado();
}
export async function onRequestDelete({ config }) {
  return configMcp(config).ligado ? naoPermitido('DELETE') : desligado();
}

function desligado() {
  return resposta(404, rpcErro(null, E.DESLIGADO, MSG.desligado));
}

export async function onRequestPost({ request, env, config, modo, waitUntil }) {
  const cfg = configMcp(config);
  if (!cfg.ligado) return desligado();

  /* Origin: quem manda Origin é navegador. Só o próprio site. (Cliente de IDE e de linha de comando não manda.) */
  const origem = request.headers.get('origin');
  if (origem && origem !== new URL(request.url).origin) return resposta(403, rpcErro(null, E.NAO_AUTORIZADO, MSG.origem));

  const auth = await autenticar(env, request, { waitUntil });
  if (!auth.ok) {
    const desafio = 'Bearer realm="mcp"' + (auth.motivo === 'sem-token' ? '' : ', error="invalid_token"');
    const status = auth.motivo === 'banco-ausente' || auth.motivo === 'banco-indisponivel' ? 503 : 401;
    return resposta(status, rpcErro(null, E.NAO_AUTORIZADO, status === 503 ? MSG.banco : MSG.naoAutorizado + auth.motivo), status === 401 ? { 'www-authenticate': desafio } : {});
  }
  const token = auth.token;

  const lim = await limitar(env, { chave: await chaveDe(env, 'mcp', token.id), max: LIMITE_POR_MINUTO, janelaS: 60 });
  if (!lim.ok) {
    const s = Math.max(1, Math.ceil(lim.tentarEmS || 1));
    return resposta(429, rpcErro(null, E.LIMITE, MSG.limite, { retryAfterSeconds: s }), { 'retry-after': String(s) });
  }

  const versaoPedida = request.headers.get('mcp-protocol-version');
  if (versaoPedida && VERSOES_SUPORTADAS.indexOf(versaoPedida) < 0) {
    return resposta(400, rpcErro(null, E.PEDIDO, MSG.versao, { supported: VERSOES_SUPORTADAS }));
  }

  let texto;
  try { texto = await request.text(); } catch (e) { return resposta(400, rpcErro(null, E.PARSE, MSG.parse)); }
  if (texto.length > TAMANHO_MAXIMO_DO_CORPO) return resposta(413, rpcErro(null, E.PEDIDO, MSG.grande));
  let corpo;
  try { corpo = JSON.parse(texto); } catch (e) { return resposta(400, rpcErro(null, E.PARSE, MSG.parse)); }

  const t = tradutor(request, config);
  const escopo = escopoEfetivo(token, cfg);
  const ctx = { t, cfg, token, escopo, env, config, exec: { env, config, modo, request, t, waitUntil } };

  if (Array.isArray(corpo)) {
    if (!corpo.length) return resposta(400, rpcErro(null, E.PEDIDO, MSG.loteVazio));
    if (corpo.length > 20) return resposta(400, rpcErro(null, E.PEDIDO, MSG.loteGrande));
    const saidas = [];
    for (const m of corpo) { const r = await tratarMensagem(m, ctx); if (r) saidas.push(r); }
    return saidas.length ? resposta(200, saidas) : new Response(null, { status: 202 });
  }
  const r = await tratarMensagem(corpo, ctx);
  return r ? resposta(200, r) : new Response(null, { status: 202 });
}
