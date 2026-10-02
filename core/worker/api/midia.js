/* GET  /api/midia?videoId=...                 -> status do encoding no provedor (estado normalizado)
 * POST /api/midia?tipo=capa&videoId=...       -> corpo binário JPG; se o título
 *                                                já está no catálogo, grava a
 *                                                capa nele na mesma chamada
 * POST /api/midia?tipo=legenda&videoId=...    -> { srt, srclang?, label? }
 * GET  /api/midia?capacidades=1               -> { provedor, envio, fontePorUrl, ... } (a mesa escolhe o formulário)
 * POST /api/midia?tipo=fonte                  -> { hls, mp4?, capa?, legendas? }: cadastro por endereço (HLS genérico);
 *                                                devolve { fonte, estado, midia } com os endereços conferidos
 *
 * Capa e legenda são arquivos pequenos: podem passar pela função sem esbarrar
 * no limite de tamanho de requisição. Vídeo, não — esse vai por TUS direto
 * do navegador (ver upload-token.js).
 *
 * `videoId` é o id do vídeo NO PROVEDOR; quem diz se o formato vale é o adaptador
 * (`padraoId`), não esta rota. Tudo o que fala com o provedor passa por
 * `data.provedor` (provedores/contrato.js).
 *
 * Rota inteira exige admin: o middleware barra antes de chegar aqui.
 */
import { json, erro, pode, semPermissao } from '../_lib/sessao.js';
import { respostaDeErro, montarMidia } from '../_lib/provedores/index.js';
import AppI18n from '../../site/i18n.js';
import { onRequestPut as publicarCatalogo } from './catalogo.js';
import App from '../../site/catalogo-core.js';

const CHAVE_CATALOGO = 'catalogo';
const LIMITE_CAPA = 8 * 1024 * 1024;
const LIMITE_LEGENDA = 4 * 1024 * 1024;

function exigeVideoId(request, provedor) {
  const id = new URL(request.url).searchParams.get('videoId');
  return id && provedor.padraoId.test(id) ? id : null;
}

/* Task 2.4 / armadilha 4: um vídeo ainda em fila embeda e não toca — parece
 * bug do site. A tela de admin usa isto para não publicar cedo demais. */
export async function onRequestGet({ request, data }) {
  const provedor = data.provedor;
  /* O que o provedor desta instalação sabe fazer, para a mesa escolher o formulário
   * (enviar arquivo ou colar endereço). O navegador decide por capacidade, não por nome. */
  if (new URL(request.url).searchParams.get('capacidades') === '1') {
    const c = provedor.capacidades();
    return json(200, {
      provedor: provedor.id, configurado: provedor.configurado,
      envio: c.envio, uploadProtocolo: c.uploadProtocolo, fontePorUrl: c.fontePorUrl === true,
      capaPorUpload: c.capaPorUpload, legendaPorUpload: c.legendaPorUpload
    });
  }
  const videoId = exigeVideoId(request, provedor);
  if (!videoId) return erro(400, 'informe-video-id');

  let v;
  try {
    v = await provedor.statusEncoding(videoId);
  } catch (e) {
    return respostaDeErro(erro, e);
  }

  /* A `midia` do vídeo, para a mesa ligar o título novo ao player e ao seletor
   * de capa sem montar URL. Falha aqui não derruba a consulta de status. */
  let midia = null;
  try { midia = await montarMidia(provedor, { fonte: { provedor: provedor.id, id: videoId } }); } catch (e) { /* o status vale sozinho */ }

  return json(200, {
    videoId,
    estado: v.estado,
    status: v.estadoBruto,
    pronto: v.estado === 'pronto',
    falhou: v.estado === 'erro',
    progresso: v.progresso,
    duracao_seg: v.duracaoSeg,
    titulo: v.titulo,
    midia
  });
}

/* A CAPA NÃO É RASCUNHO (22/09). O provedor (o Bunny, na época) troca a capa na hora e o arquivo
 * anterior some da origem — até 22/09 este código contava com o contrário, e
 * a mesa guardava o nome novo no rascunho com a promessa de que "até publicar,
 * o site segue com a capa de antes". Um teste feito pela mesa, sem publicar,
 * deixou o *Bernardo Élis 2* sem capa no site no ar. Então a capa de um título
 * que JÁ ESTÁ no catálogo é gravada aqui, logo depois de o provedor aceitar.
 *
 * PELA MESMA PORTA DO PUT: o corpo é o catálogo que está gravado, com os dois
 * campos trocados (`App.comCapa`), e quem grava é o próprio `onRequestPut` —
 * a mesma conferência de permissão campo a campo, a mesma `rev` e a mesma
 * linha no histórico. Nenhuma cópia daquele caminho mora aqui.
 *
 * A PERMISSÃO É CONFERIDA ANTES DO PROVEDOR, e a ordem é a coisa toda: uma recusa
 * depois do envio deixaria o título sem capa no site, com o catálogo apontando
 * para o arquivo que acabou de sumir. */
const VOLTAS_DA_CAPA = 3;

async function gravarCapaNoCatalogo(request, env, data, videoId, arquivo, versao) {
  let ultima = null;
  for (let volta = 0; volta < VOLTAS_DA_CAPA; volta++) {
    const atual = await env.CATALOGO.get(CHAVE_CATALOGO, 'json');
    const corpo = App.comCapa(atual, videoId, arquivo, versao);
    if (!corpo) return { status: 404 };
    const resposta = await publicarCatalogo({
      request: new Request(request.url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo)
      }),
      env, data
    });
    ultima = { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
    /* 409: outra tela gravou entre a leitura e a gravação. Relê e tenta de
     * novo, como o Publicar da mesa faz. */
    if (resposta.status !== 409) return ultima;
  }
  return ultima;
}

export async function onRequestPost({ request, env, data }) {
  /* Capa e legenda são conteúdo do título; quem envia vídeo também as manda,
   * no mesmo caminho do envio (M2). Consultar o status do vídeo (GET) não
   * pede permissão nenhuma além de estar na mesa. */
  if (!pode(data.conta, 'conteudo') && !pode(data.conta, 'enviar')) return semPermissao('conteudo');

  const url = new URL(request.url);
  const provedor = data.provedor;
  const tipo = url.searchParams.get('tipo');

  /* Provedor sem envio (HLS genérico): o título se cadastra colando endereços. O adaptador confere cada um
   * (https, host liberado na config, extensão) e devolve a `fonte` pronta; a mesa a grava pelo PUT do catálogo. */
  if (tipo === 'fonte') {
    if (typeof provedor.prepararFonte !== 'function') return erro(501, 'recurso-indisponivel');
    if (!provedor.configurado) return erro(500, 'provedor-nao-configurado', { provedor: provedor.id, faltando: (provedor.faltando || []).join(', ') });
    let corpo;
    try { corpo = await request.json(); } catch (e) { return erro(400, 'corpo-invalido'); }
    try {
      const pronta = await provedor.prepararFonte(corpo, { verificar: true });
      let midia = null;
      try { midia = await montarMidia(provedor, { fonte: pronta.fonte }); } catch (e) { /* a fonte vale sozinha */ }
      return json(200, Object.assign({ midia, pronto: pronta.estado === 'pronto', falhou: pronta.estado === 'erro' }, pronta));
    } catch (e) {
      return respostaDeErro(erro, e);
    }
  }

  const videoId = exigeVideoId(request, provedor);
  if (!videoId) return erro(400, 'informe-video-id');

  if (tipo === 'capa') {
    if (!provedor.capacidades().capaPorUpload) return erro(501, 'recurso-indisponivel');
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return erro(400, 'corpo-vazio');
    if (bytes.byteLength > LIMITE_CAPA) return erro(413, 'capa-grande');

    /* O título já está no catálogo? Então a troca vai gravar nele — e a conta
     * precisa poder, conferido pela mesma regra do PUT, ANTES de tocar no
     * provedor. Quem só envia vídeo ainda manda a capa do título novo, que não
     * está no catálogo e segue pelo rascunho. */
    const atual = env.CATALOGO ? await env.CATALOGO.get(CHAVE_CATALOGO, 'json') : null;
    const hipotese = App.comCapa(atual, videoId, '(capa nova)', '0');
    if (hipotese && !data.conta.super) {
      const barradas = App.proibidas(data.conta, App.diferencasDoCatalogo(atual, hipotese));
      if (barradas.length) {
        return erro(403, 'sem-permissao-capa-catalogo', null, {
          barradas: barradas.slice(0, 20).map(d => ({ alvo: d.alvo, campo: d.campo, permissao: d.permissao }))
        });
      }
    }

    /* O adaptador troca a capa e devolve o nome/URL JÁ novos. Sem eles o
     * catálogo seguiria apontando para o arquivo de antes — que some. */
    let capa;
    try {
      capa = await provedor.definirCapa(videoId, bytes, 'image/jpeg');
    } catch (e) {
      return respostaDeErro(erro, e);
    }
    const capaArquivo = capa.arquivo || null;
    const versao = capa.versao || String(Date.now());
    const resultado = { ok: true, videoId, capa_arquivo: capaArquivo, capa: capa.urlCapa || null, capa_versao: capa.versao || null };

    /* Título novo, ou o provedor que não disse onde ficou a capa: nada a
     * gravar aqui. No segundo caso, `pendente` avisa que o site ficou sem aquela capa. */
    if (!hipotese || !(capaArquivo || capa.urlCapa)) {
      return json(200, Object.assign(resultado, { pendente: !!hipotese }));
    }

    const gravacao = await gravarCapaNoCatalogo(request, env, data, videoId, capaArquivo, versao);
    if (gravacao.status !== 200) {
      return json(200, Object.assign(resultado, {
        pendente: true,
        codigo: (gravacao.corpo && gravacao.corpo.codigo) || 'catalogo-nao-gravado',
        params: (gravacao.corpo && gravacao.corpo.params) || { status: gravacao.status },
        erro: (gravacao.corpo && gravacao.corpo.erro) || AppI18n.t('api.catalogo-nao-gravado', { status: gravacao.status })
      }));
    }
    return json(200, Object.assign(resultado, { rev: gravacao.corpo.rev, historico: gravacao.corpo.historico }));
  }

  if (tipo === 'legenda') {
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return erro(400, 'esperado-srt');
    }

    const srt = corpo && typeof corpo.srt === 'string' ? corpo.srt : '';
    if (!srt.trim()) return erro(400, 'legenda-vazia');
    if (srt.length > LIMITE_LEGENDA) return erro(413, 'legenda-grande');

    const srclang = (corpo.srclang || 'pt').toLowerCase().replace(/[^a-z-]/g, '') || 'pt';
    const label = corpo.label || 'Português'; /* i18n-ignorar: rótulo da faixa de legenda (a língua da fala, dado) */

    try {
      await provedor.enviarLegenda(videoId, { idioma: srclang, rotulo: label, srt });
    } catch (e) {
      return respostaDeErro(erro, e);
    }
    return json(200, { ok: true, videoId, srclang });
  }

  return erro(400, 'tipo-invalido');
}
