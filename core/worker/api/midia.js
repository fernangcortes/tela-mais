/* GET  /api/midia?videoId=...                 -> status do encoding no Bunny
 * POST /api/midia?tipo=capa&videoId=...       -> corpo binário JPG; se o título
 *                                                já está no catálogo, grava a
 *                                                capa nele na mesma chamada
 * POST /api/midia?tipo=legenda&videoId=...    -> { srt, srclang?, label? }
 *
 * Capa e legenda são arquivos pequenos: podem passar pela função sem esbarrar
 * no limite de tamanho de requisição. Vídeo, não — esse vai por TUS direto
 * do navegador (ver upload-token.js).
 *
 * Rota inteira exige admin: o middleware barra antes de chegar aqui.
 */
import { json, pode, semPermissao } from '../_lib/sessao.js';
import { onRequestPut as publicarCatalogo } from './catalogo.js';
import App from '../../site/catalogo-core.js';

const CHAVE_CATALOGO = 'catalogo';
const LIMITE_CAPA = 8 * 1024 * 1024;
const LIMITE_LEGENDA = 4 * 1024 * 1024;

function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function exigeVideoId(request) {
  const id = new URL(request.url).searchParams.get('videoId');
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

/* Task 2.4 / armadilha 4: um vídeo ainda em fila embeda e não toca — parece
 * bug do site. A tela de admin usa isto para não publicar cedo demais. */
export async function onRequestGet({ request, data }) {
  const videoId = exigeVideoId(request);
  if (!videoId) return json(400, { erro: 'informe um `videoId` válido' });

  const r = await data.bunny.chamar('/videos/' + videoId);
  if (!r.ok) {
    return json(502, { erro: 'Bunny recusou a consulta', status: r.status, detalhe: await r.text() });
  }

  const v = await r.json();
  /* status 4 = Finished, 5 = Failed (tabela de status do Bunny Stream) */
  return json(200, {
    videoId,
    status: v.status,
    pronto: v.status === 4,
    falhou: v.status === 5,
    progresso: v.encodeProgress ?? null,
    duracao_seg: v.length ?? null,
    titulo: v.title ?? null
  });
}

/* A CAPA NÃO É RASCUNHO (22/09). O Bunny troca a capa na hora e o arquivo
 * anterior some da origem — até 22/09 este código contava com o contrário, e
 * a mesa guardava o nome novo no rascunho com a promessa de que "até publicar,
 * o site segue com a capa de antes". Um teste feito pela mesa, sem publicar,
 * deixou o *Bernardo Élis 2* sem capa no site no ar. Então a capa de um título
 * que JÁ ESTÁ no catálogo é gravada aqui, logo depois de o Bunny aceitar.
 *
 * PELA MESMA PORTA DO PUT: o corpo é o catálogo que está gravado, com os dois
 * campos trocados (`App.comCapa`), e quem grava é o próprio `onRequestPut` —
 * a mesma conferência de permissão campo a campo, a mesma `rev` e a mesma
 * linha no histórico. Nenhuma cópia daquele caminho mora aqui.
 *
 * A PERMISSÃO É CONFERIDA ANTES DO BUNNY, e a ordem é a coisa toda: uma recusa
 * depois do envio deixaria o título sem capa no site, com o catálogo apontando
 * para o arquivo que acabou de sumir. */
const VOLTAS_DA_CAPA = 3;

async function gravarCapaNoCatalogo(request, env, data, videoId, arquivo) {
  let ultima = null;
  for (let volta = 0; volta < VOLTAS_DA_CAPA; volta++) {
    const atual = await env.CATALOGO.get(CHAVE_CATALOGO, 'json');
    const corpo = App.comCapa(atual, videoId, arquivo, String(Date.now()));
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
  const videoId = exigeVideoId(request);
  const tipo = url.searchParams.get('tipo');
  if (!videoId) return json(400, { erro: 'informe um `videoId` válido' });

  if (tipo === 'capa') {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json(400, { erro: 'corpo vazio' });
    if (bytes.byteLength > LIMITE_CAPA) return json(413, { erro: 'capa acima de 8 MB' });

    /* O título já está no catálogo? Então a troca vai gravar nele — e a conta
     * precisa poder, conferido pela mesma regra do PUT, ANTES de tocar no
     * Bunny. Quem só envia vídeo ainda manda a capa do título novo, que não
     * está no catálogo e segue pelo rascunho. */
    const atual = env.CATALOGO ? await env.CATALOGO.get(CHAVE_CATALOGO, 'json') : null;
    const hipotese = App.comCapa(atual, videoId, '(capa nova)', '0');
    if (hipotese && !data.conta.super) {
      const barradas = App.proibidas(data.conta, App.diferencasDoCatalogo(atual, hipotese));
      if (barradas.length) {
        return json(403, {
          erro: 'esta conta não pode trocar a capa de um título que já está no catálogo',
          barradas: barradas.slice(0, 20).map(d => ({ alvo: d.alvo, campo: d.campo, permissao: d.permissao }))
        });
      }
    }

    const r = await data.bunny.chamar('/videos/' + videoId + '/thumbnail', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes
    });
    if (!r.ok) {
      return json(502, { erro: 'Bunny recusou a capa', status: r.status, detalhe: await r.text() });
    }

    /* O Bunny grava a capa recebida com um hash no nome. Sem devolver o nome
     * real, o catálogo seguiria apontando para o arquivo de antes — que some. */
    let capaArquivo = null;
    const consulta = await data.bunny.chamar('/videos/' + videoId);
    if (consulta.ok) {
      const v = await consulta.json();
      capaArquivo = v.thumbnailFileName || null;
    }

    /* Título novo, ou o Bunny que não disse o nome: nada a gravar aqui. No
     * segundo caso, `pendente` avisa que o site ficou sem aquela capa. */
    if (!hipotese || !capaArquivo) {
      return json(200, { ok: true, videoId, capa_arquivo: capaArquivo, pendente: !!hipotese });
    }

    const gravacao = await gravarCapaNoCatalogo(request, env, data, videoId, capaArquivo);
    if (gravacao.status !== 200) {
      return json(200, {
        ok: true, videoId, capa_arquivo: capaArquivo, pendente: true,
        erro: (gravacao.corpo && gravacao.corpo.erro) || ('o catálogo não foi gravado (' + gravacao.status + ')')
      });
    }
    return json(200, {
      ok: true, videoId, capa_arquivo: capaArquivo,
      rev: gravacao.corpo.rev, historico: gravacao.corpo.historico
    });
  }

  if (tipo === 'legenda') {
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json(400, { erro: 'corpo inválido: esperado JSON com `srt`' });
    }

    const srt = corpo && typeof corpo.srt === 'string' ? corpo.srt : '';
    if (!srt.trim()) return json(400, { erro: 'legenda vazia' });
    if (srt.length > LIMITE_LEGENDA) return json(413, { erro: 'legenda acima de 4 MB' });

    const srclang = (corpo.srclang || 'pt').toLowerCase().replace(/[^a-z-]/g, '') || 'pt';
    const label = corpo.label || 'Português';

    const r = await data.bunny.chamar('/videos/' + videoId + '/captions/' + srclang, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ srclang, label, captionsFile: base64Utf8(srt) })
    });
    if (!r.ok) {
      return json(502, { erro: 'Bunny recusou a legenda', status: r.status, detalhe: await r.text() });
    }
    return json(200, { ok: true, videoId, srclang });
  }

  return json(400, { erro: 'parâmetro `tipo` deve ser `capa` ou `legenda`' });
}
