/* provedores/index.js — o registro: escolhe o adaptador de vídeo pela config
 * (`video.provedor`) e monta `item.midia` para o catálogo.
 *
 *   criarProvedor(config, env)        o adaptador do provedor escolhido
 *   hostsDeMidia(config, env)         hosts que a CSP e o preconnect precisam liberar
 *   montarMidia(provedor, item, ...)  o `item.midia` que o navegador recebe
 *
 * CREDENCIAIS. A config nunca guarda segredo: `video.bunny.chaveApi` é
 * `{"$env":"BUNNY_API_KEY"}` e o valor sai de `env` aqui (resolverCredenciais).
 * Referência ausente cai no nome PADRÃO da variável (BUNNY_API_KEY...), que é o
 * que o `.env.example` e os testes usam. Config nula (falha de configuração, ou
 * testes que só passam `{ acesso }`) vale `video.provedor = 'bunny'`.
 *
 * Um site tem UM provedor. Item cuja `fonte.provedor` é outro fica sem `midia`
 * (o id de um provedor não toca em outro): trocar `video.provedor` sem migrar
 * os ids deixa o acervo "sem vídeo", em vez de quebrar a página. */
import App from '../../../site/catalogo-core.js';
import { ehReferenciaEnv } from '../config-validar.mjs';
import { ErroProvedor, hostsLimpos, validarAdaptador } from './contrato.js';
import * as bunny from './bunny.js';
import * as cloudflareStream from './cloudflare-stream.js';
import * as hlsGenerico from './hls-generico.js';

export { ErroProvedor, validarAdaptador };

const MODULOS = Object.freeze({
  [bunny.ID]: bunny,
  [cloudflareStream.ID]: cloudflareStream,
  [hlsGenerico.ID]: hlsGenerico
});

export const PROVEDOR_PADRAO = 'bunny';

/** Os ids de provedor que existem (os mesmos do enum `video.provedor` do schema). */
export function listarProvedores() {
  return Object.keys(MODULOS);
}

/** O módulo (ID, CHAVE_CONFIG, CREDENCIAIS, criar) de um provedor, ou undefined. */
export function moduloDe(id) {
  return MODULOS[id];
}

/** Resolve as credenciais de um módulo: `{$env}` da config, ou o nome padrão da variável. */
export function resolverCredenciais(modulo, bloco, env) {
  const saida = {};
  for (const [nome, def] of Object.entries(modulo.CREDENCIAIS)) {
    const ref = bloco ? bloco[nome] : undefined;
    let valor;
    if (ehReferenciaEnv(ref)) valor = env ? env[ref.$env] : undefined;
    else if (def.segredo === false && typeof ref === 'string' && ref) valor = ref;   /* ex.: baseUrl do HLS genérico */
    else if (ref === undefined || ref === null) valor = env ? env[def.env] : undefined;
    if (typeof valor === 'string' && valor !== '') saida[nome] = valor;
  }
  return saida;
}

/** Nomes das credenciais OBRIGATÓRIAS que faltam (para a mensagem de "não configurado"). */
export function credenciaisFaltando(modulo, credenciais) {
  return Object.entries(modulo.CREDENCIAIS)
    .filter(([nome, def]) => def.obrigatoria && !credenciais[nome])
    .map(([, def]) => def.env);
}

/* criarProvedor(config, env, opcoes?) -> adaptador
 * opcoes: { provedor?: string (força o id), fetch?, agora? } — para testes e scripts.
 * Nunca lança por id desconhecido: id fora do enum é erro de config, já barrado pelo
 * validador, e aqui cai no padrão para o site não cair junto. */
export function criarProvedor(config, env, opcoes = {}) {
  const video = (config && config.video) || {};
  const pedido = opcoes.provedor || video.provedor || PROVEDOR_PADRAO;
  const modulo = MODULOS[pedido] || MODULOS[PROVEDOR_PADRAO];
  const credenciais = resolverCredenciais(modulo, video[modulo.CHAVE_CONFIG], env || {});
  const adaptador = modulo.criar({ credenciais, config: video, fetch: opcoes.fetch, agora: opcoes.agora });
  /* Para o handler dizer QUAIS variáveis faltam, sem o adaptador saber de env. */
  Object.defineProperty(adaptador, 'faltando', { value: credenciaisFaltando(modulo, credenciais), enumerable: false });
  return adaptador;
}

/** Hosts de mídia do provedor desta instalação (CSP e preconnect). Nunca lança. */
export function hostsDeMidia(config, env, opcoes = {}) {
  let hosts;
  try {
    hosts = hostsLimpos(criarProvedor(config, env, opcoes).hostsMidia());
  } catch (e) {
    hosts = hostsLimpos({});
  }
  /* Clipe e trailer gerados (M9) moram fora do provedor de vídeo (R2 do cliente): o host de `ia.midia.urlBase` entra na CSP. */
  const extra = hostDaMidiaGerada(config);
  if (!extra) return hosts;
  return hostsLimpos({
    ...hosts,
    img: (hosts.img || []).concat([extra]),
    media: (hosts.media || []).concat([extra])
  });
}

/** O host (`https://...`) de `ia.midia.urlBase`, ou null. Só https e só a origem: nunca caminho nem consulta. */
export function hostDaMidiaGerada(config) {
  const base = config && config.ia && config.ia.midia && config.ia.midia.urlBase;
  if (typeof base !== 'string') return null;
  try {
    const u = new URL(base);
    return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null;
  } catch (e) { return null; }
}

/** Põe `clipe`, `clipePoster` e `trailer` de `item.midia_gerada` em `midia`, SÓ se uma pessoa aceitou
 * (`proveniencia.revisado === true`) e a URL é https. Nunca sobrescreve o que o adaptador do provedor entregou.
 * (Mesma regra de scripts/lib/midia-gerada.mjs: o Worker não importa de scripts/.) Devolve `midia` se nada muda. */
export function mesclarMidiaGerada(midia, item) {
  const g = item && item.midia_gerada;
  if (!midia || !g || !g.proveniencia || g.proveniencia.revisado !== true) return midia;
  const https = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);
  const saida = { ...midia };
  if (https(g.clipe) && !saida.clipe) { saida.clipe = g.clipe; if (https(g.clipePoster)) saida.clipePoster = g.clipePoster; }
  if (https(g.trailer) && !saida.trailer) saida.trailer = g.trailer;
  return saida;
}

/** Os idiomas de legenda que se presumem existir quando o item não diz: o idioma padrão do site. */
export function idiomasDeLegendaPadrao(config) {
  const padrao = config && config.idiomas && config.idiomas.padrao;
  const base = typeof padrao === 'string' && padrao ? padrao.split('-')[0].toLowerCase() : 'pt';
  return [base];
}

/* montarMidia(provedor, item, opcoes?) -> Midia | null
 *   opcoes: { assinar?, validadeSeg?, sessao?, viewer?, idiomasDeLegenda?: string[], semAtalho? (força a composição; para testes) }
 *   O handler chama com assinar = (config.acesso.modo !== 'publico' && config.acesso.privado.assinarMidia) e
 *   validadeSeg = config.acesso.privado.validadeDaAssinaturaSeg. `sessao` ({ expiraEm?: UNIX s, id? }) limita a validade:
 *   a URL nunca vive mais que a sessão (mínimo de 30 s). Capa, prévia e legendas saem assinadas junto (mesmo token no Bunny).
 * Devolve null quando o item não tem vídeo NESTE provedor. Com `assinar` e um
 * adaptador sem assinatura, REJEITA (ErroProvedor 'assinatura-indisponivel'):
 * quem pediu URL assinada não pode receber uma aberta. Sem rede quando o
 * adaptador só monta URL. */
export async function montarMidia(provedor, item, opcoes = {}) {
  const fonte = App.migrarFonte(item && item.fonte);
  if (!fonte.id) return null;
  if (fonte.provedor && fonte.provedor !== provedor.id) return null;
  if (!provedor.padraoId.test(fonte.id)) return null;

  const assinar = opcoes.assinar === true;
  let validadeSeg = opcoes.validadeSeg;
  const fimDaSessao = opcoes.sessao && Number(opcoes.sessao.expiraEm);
  if (assinar && fimDaSessao > 0) {
    const restante = Math.max(30, Math.floor(fimDaSessao - Date.now() / 1000));
    validadeSeg = Number(validadeSeg) > 0 ? Math.min(Number(validadeSeg), restante) : restante;
  }
  const idiomas = Array.isArray(item.legendas_idiomas) ? item.legendas_idiomas : (opcoes.idiomasDeLegenda || ['pt']);

  /* Atalho opcional do adaptador (uma chamada em vez de quatro: o catálogo monta isto
   * por título, e o plano gratuito dá 10 ms de CPU). Só sem assinatura. */
  if (typeof provedor.midia === 'function' && opcoes.assinar !== true && opcoes.semAtalho !== true) {
    const m = await provedor.midia(fonte.id, {
      extras: fonte.extras, arquivo: item.capa_arquivo || undefined,
      versao: item.capa_versao != null ? item.capa_versao : undefined, idiomas
    });
    return mesclarMidiaGerada(Object.assign({}, m, { legendas: m.legendas.filter(l => l.url).map(l => ({ idioma: l.idioma, rotulo: l.rotulo, url: l.url })) }), item);
  }

  const [rep, capa, previa, legendas] = await Promise.all([
    provedor.urlReproducao(fonte.id, { assinar, validadeSeg, viewer: opcoes.viewer, extras: fonte.extras }),
    provedor.urlCapa(fonte.id, { arquivo: item.capa_arquivo || undefined, versao: item.capa_versao != null ? item.capa_versao : undefined, extras: fonte.extras, assinar, validadeSeg }),
    provedor.urlPreview(fonte.id, { assinar, validadeSeg }),
    provedor.legendas(fonte.id, { idiomas, extras: fonte.extras, assinar, validadeSeg })
  ]);
  return mesclarMidiaGerada({
    hls: rep.hls || null,
    mp4: rep.mp4 || null,
    capa: capa || null,
    previa: (previa && previa.animada) || null,
    legendas: legendas.filter(l => l.url).map(l => ({ idioma: l.idioma, rotulo: l.rotulo, url: l.url })),
    embed: rep.embed || null,
    expiraEm: rep.expiraEm || null
  }, item);
}

/** As opções de assinatura de UMA requisição, a partir do que o middleware já decidiu (`data`).
 * Só assina quando o modo é restrito, a política manda e há sessão válida; no modo público
 * nada muda. Sem sessão em modo restrito devolve `assinar: false` (o gate já barrou antes). */
export function opcoesDeAssinatura(data, extra = {}) {
  const pol = (data && data.politica) || {};
  const logado = !!(data && data.sessao && data.sessao.papel && data.sessao.papel !== 'anonimo');
  const assinar = !!pol.modo && pol.modo !== 'publico' && pol.assinarMidia === true && logado;
  const op = Object.assign({}, extra, { assinar });
  if (assinar) {
    op.validadeSeg = pol.validadeDaAssinaturaSeg;
    if (data.sessao.expiraEm) op.sessao = { expiraEm: data.sessao.expiraEm };
  }
  return op;
}

/** O item com `midia` calculada (cópia; o original não muda). */
export async function comMidia(provedor, item, opcoes) {
  const midia = await montarMidia(provedor, item, opcoes);
  return Object.assign({}, item, { midia });
}

/** Erro de provedor -> resposta HTTP de erro. `erro` é o de sessao.js (passado para não criar ciclo). */
export function respostaDeErro(erroFn, e) {
  if (!(e instanceof ErroProvedor)) throw e;
  const extras = {};
  if (e.status != null) extras.status = e.status;
  if (e.detalhe) extras.detalhe = e.detalhe;
  const status = e.codigo === 'recurso-indisponivel' || e.codigo === 'assinatura-indisponivel' ? 501
    : e.codigo === 'id-invalido' || e.codigo === 'parametro-invalido' ? 400
    : e.codigo === 'provedor-nao-configurado' ? 500 : 502;
  return erroFn(status, e.codigo, null, extras);
}
