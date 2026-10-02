/* GET  /api/catalogo            público interno — só o que está publicado
 * GET  /api/catalogo?completo=1 admin — o catálogo inteiro, como está no KV
 * PUT  /api/catalogo            admin — grava o catálogo inteiro
 *
 * O catálogo mora numa chave só do KV (`catalogo`). Para 50 títulos isso é
 * trivial e cabe folgado no plano gratuito.
 */
import { json, erro } from '../_lib/sessao.js';
import AppI18n from '../../site/i18n.js';
import { registrarPublicacao } from './historico.js';
import App from '../../site/catalogo-core.js';
import { comMidia, montarMidia, idiomasDeLegendaPadrao } from '../_lib/provedores/index.js';

const CHAVE = 'catalogo';

/* Campos que NÃO saem para o público: caminhos de arquivo locais, links de origem no
 * Drive, nome de arquivo e o próprio `publicar`. Filtrar no servidor é o que
 * impede alguém de baixar o catálogo inteiro — inclusive o não publicado. */
function paraPublico(item) {
  return {
    id: item.id,
    titulo: item.titulo,
    serie: item.serie,
    temporada: item.temporada ?? null,
    episodio: item.episodio ?? null,
    duracao: item.duracao || '',
    duracao_seg: item.duracao_seg ?? null,
    /* A taxa de quadros, para o passo a passo da fase 9 (`,` e `.`): o <video>
     * não tem passo de quadro, então o player faz `currentTime += 1/framerate`
     * e precisa do número por TÍTULO — o acervo é misto (23,976 · 29,97 · 30 ·
     * 24 · 25) e um passo fixo erraria na maioria. Vem do provedor por
     * `scripts/framerate.mjs`; `null` enquanto o script não rodar, e o player
     * trata a ausência desligando o atalho em vez de chutar 30. */
    framerate: item.framerate ?? null,
    ano: item.ano || '',
    data_publicacao_original: item.data_publicacao_original || '',
    sinopse: item.sinopse || '',
    sinopse_origem: item.sinopse_origem || '',
    tema: item.tema || '',
    publico_alvo: item.publico_alvo || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    /* `titularidade` e `nivel_evidencia` NÃO saem mais (04/09): são
     * classificação interna de quem cataloga, a ficha parou de desenhá-las e
     * o /admin as lê por `?completo=1`, que devolve o item cru do KV. */
    pendencia: item.pendencia || null,
    publicar: true,
    /* O título escolhido para o DESTAQUE da chegada (D4). Mesma armadilha dos
     * capítulos, e por isso a mesma linha: campo que não sai por `paraPublico`
     * não existe para o navegador. Sem esta linha o destaque cai no padrão e
     * a escolha feita no /admin não tem efeito nenhum — sem erro, sem aviso.
     *
     * Só `true` viaja: `destaque: false` e a ausência do campo são a mesma
     * coisa para quem lê, e mandar 66 `false` é peso à toa. */
    destaque: item.destaque === true ? true : null,
    /* `capa_arquivo` e `capa_versao` NÃO saem mais (M4): o nome do arquivo de
     * capa é coisa do provedor, e a URL final já vai em `midia.capa`. */
    /* Capítulos: o player do provedor já os traz do lado dele (segmentam a linha
     * do tempo e mostram o título no hover), mas a LISTA clicável ao lado do
     * player é desenhada aqui pela grade. Campo que não sai por `paraPublico`
     * não existe para o navegador — sem esta linha a lista some. */
    capitulos: Array.isArray(item.capitulos) ? item.capitulos : [],
    /* O id do vídeo é a chave do índice da busca (fala e sentido); `extras`
     * (ex.: libraryId) fica no servidor. Quem toca o vídeo usa `midia`. */
    fonte: { provedor: (item.fonte && item.fonte.provedor) || null, id: (item.fonte && item.fonte.id) || null }
  };
}

/* A `midia` de cada item, calculada pelo adaptador do provedor a cada resposta
 * (nunca gravada). `assinar` é do M5: no modo privado a URL passa a sair
 * assinada e com validade curta (`urlReproducao({ assinar, validadeSeg })`). */
async function comMidias(provedor, itens, config) {
  const opcoes = { idiomasDeLegenda: idiomasDeLegendaPadrao(config) };
  return Promise.all(itens.map(i => comMidia(provedor, i, opcoes)));
}

/* Ajustes do player, editados em /admin e guardados no PRÓPRIO catálogo.
 *
 * Não vão em `config` porque `config` vem do ambiente e o PUT o descarta —
 * um ajuste que se apaga a cada gravação não serve para nada. Ficam num campo
 * de topo do documento, que o `salvarCatalogo` do admin preserva porque
 * grava o documento inteiro de volta.
 *
 * A validação é de forma, não de gosto: quem decide se 0,4 é o número certo é
 * quem usa o gesto, e quem apara valor absurdo é o `player-core`. Aqui só se
 * garante que o que sai é número, para o cliente não receber uma string. */
function ajustes(guardado) {
  const a = (guardado && guardado.ajustes) || {};
  /* AUSENTE NÃO É ZERO, e a diferença aqui custou um defeito achado pelo
   * histórico no primeiro ensaio dele (M5): `Number(null)` é `0`, e `0` é uma
   * escolha VÁLIDA neste campo — quer dizer "os controles nunca somem". Com a
   * conversão crua, um `controlesEspera: null` guardado voltava como `0` no
   * GET, a tela devolvia esse `0` no PUT seguinte, e o padrão do player virava
   * "nunca some" — sem ninguém pedir, e sem nada na tela. A leitura passa a
   * distinguir o nada do número antes de converter. */
  const numero = (v) => (v == null || v === '' ? NaN : Number(v));
  const teto = numero(a.arrastoTeto);
  const espera = numero(a.controlesEspera);
  return {
    arrastoTeto: Number.isFinite(teto) && teto > 0 ? teto : null,
    /* `0` é uma escolha válida — "os controles nunca somem" —, então a
     * checagem é `>= 0` e não a de valor verdadeiro. Um `!espera` aqui
     * transformaria "nunca some" em "some no padrão", em silêncio. */
    controlesEspera: Number.isFinite(espera) && espera >= 0 ? espera : null
  };
}

/* A estrutura da chegada (M4): o nome, a ordem e o "escondida" das
 * prateleiras, a classe de cada série, o destaque e os textos fixos.
 *
 * Sai pelo GET público porque é o site quem desenha com ela, e sai SANEADA
 * pela mesma razão do `ajustes()` logo acima: o que chega ao navegador tem
 * forma conferida, e um dado torto no KV não vira erro na tela de quem só
 * queria assistir. O padrão de tudo isso continua no `catalogo-core.js`, e por
 * isso o campo ausente é `{}` e não uma cópia do padrão.
 *
 * O `?completo=1` NÃO passa por aqui: a mesa precisa ver o documento como ele
 * está no KV, porque é contra esse valor que o Publicar confere o "antes". */
function site(guardado) {
  return App.siteSaneado(guardado && guardado.site);
}

/* A CAPA DO DESTAQUE, numa chave própria (o LCP da chegada,
 * 23/09). A capa do destaque é o LCP da chegada, e ela só era descoberta
 * depois de o app.js baixar, rodar e ler este catálogo. O `home.js`
 * põe um <link rel="preload"> dela no HTML, e lê ESTA chave — uma string
 * curta — em vez do catálogo: a página inicial não pode depender de ler e
 * desmontar o catálogo inteiro dentro dos 10 ms de CPU do plano gratuito,
 * porque o corte ali derruba o site, e não só uma imagem.
 *
 * Quem grava é este GET, e só ele: toda visita pede o catálogo, e aqui ele já
 * está lido. O catálogo é gravado por muitos caminhos — o PUT da mesa, o
 * histórico, oito scripts direto no KV —, e escrever a chave em cada um
 * deixaria sempre um esquecido. Assim, qualquer escrita é corrigida na visita
 * seguinte. A regravação só acontece quando a URL muda, e fora do caminho da
 * resposta (`waitUntil`).
 *
 * A URL sai das MESMAS funções que o app.js usa (`App.destaque` e
 * `App.urlCapa`, sobre os itens públicos): o preload é a capa que a chegada
 * vai pedir. Se ficar velha, o custo é um preload desperdiçado, não uma capa
 * errada na tela. */
export const CHAVE_CAPA_DESTAQUE = 'capa-destaque';

async function guardarCapaDoDestaque(env, url) {
  try {
    const atual = await env.CATALOGO.get(CHAVE_CAPA_DESTAQUE);
    if ((atual || '') === (url || '')) return;
    if (url) await env.CATALOGO.put(CHAVE_CAPA_DESTAQUE, url);
    else await env.CATALOGO.delete(CHAVE_CAPA_DESTAQUE);
  } catch (e) {
    /* KV fora ou limite de escrita: a próxima visita tenta de novo. */
  }
}

/* Lê o catálogo já com a `fonte` de cada item no formato novo
 * (`{ provedor, id, extras }`): o KV migra aos poucos, a cada PUT. */
async function lerCatalogo(env) {
  if (!env.CATALOGO) return null;
  return App.catalogoMigrado(await env.CATALOGO.get(CHAVE, 'json'));
}

export async function onRequestGet({ env, request, data, waitUntil, config }) {
  if (!env.CATALOGO) {
    return erro(500, 'kv-nao-vinculado');
  }

  const guardado = await lerCatalogo(env);

  if (!guardado) {
    return json(200, {
      versao: 1, rev: 0, itens: [], vazio: true,
      ajustes: ajustes(null), site: site(null),
      codigo: 'catalogo-nao-importado', observacao: AppI18n.t('api.catalogo-nao-importado')
    });
  }

  const completo = new URL(request.url).searchParams.get('completo') === '1';
  if (completo) {
    if (!data.admin) return erro(401, 'nao-autorizado');
    return json(200, Object.assign({}, guardado, {
      itens: await comMidias(data.provedor, guardado.itens || [], config), ajustes: ajustes(guardado)
    }));
  }

  const publicados = (guardado.itens || []).filter(i => i && i.publicar === true);
  const sitePublico = site(guardado);

  /* A capa do destaque sai do MESMO `midia.capa` que a chegada vai ler. */
  const opcoesMidia = { idiomasDeLegenda: idiomasDeLegendaPadrao(config) };
  /* A `midia` sai do item INTEIRO (extras, nome de capa, versão), que a projeção pública não carrega. */
  const comUrls = await Promise.all(publicados.map(async i =>
    Object.assign(paraPublico(i), { midia: await montarMidia(data.provedor, i, opcoesMidia) })));
  const emDestaque = App.destaque(comUrls, sitePublico);
  const capa = emDestaque ? App.urlCapa(emDestaque) : null;
  const guardar = guardarCapaDoDestaque(env, capa);
  if (waitUntil) waitUntil(guardar);

  return json(200, {
    versao: guardado.versao || 1,
    rev: guardado.rev || 0,
    atualizado_em: guardado.atualizado_em || null,
    total: comUrls.length,
    ajustes: ajustes(guardado),
    site: sitePublico,
    itens: comUrls
  });
}

export async function onRequestPut({ request, env, data }) {
  if (!data.admin) return erro(401, 'nao-autorizado');
  if (!env.CATALOGO) {
    return erro(500, 'kv-nao-vinculado');
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  if (!corpo || typeof corpo !== 'object' || !Array.isArray(corpo.itens)) {
    return erro(400, 'catalogo-esperado-itens');
  }
  /* O que entra no KV tem `fonte` no formato novo e NUNCA `midia`: ela é
   * calculada pelo servidor a cada resposta, e a mesa a devolve junto com o
   * resto do documento que leu. */
  corpo = App.catalogoMigrado(corpo);

  const ids = new Set();
  for (const item of corpo.itens) {
    if (!item || typeof item.id !== 'string' || !item.id) {
      return erro(400, 'item-sem-id');
    }
    if (ids.has(item.id)) {
      return erro(400, 'id-repetido', { id: item.id });
    }
    ids.add(item.id);
  }

  const atual = await lerCatalogo(env);
  const revAtual = (atual && atual.rev) || 0;

  /* Concorrência otimista: a tela lê o catálogo inteiro, edita e devolve.
   * Sem esta checagem, dois admins abertos ao mesmo tempo se sobrescrevem. */
  if (atual && corpo.rev !== revAtual) {
    return erro(409, 'catalogo-mudou', null, {
      rev_servidor: revAtual,
      rev_enviada: corpo.rev ?? null
    });
  }

  const novo = Object.assign({}, corpo, {
    versao: corpo.versao || 1,
    rev: revAtual + 1,
    total: corpo.itens.length,
    atualizado_em: new Date().toISOString()
  });
  delete novo.config;   /* config vem do ambiente, não é dado do catálogo */

  /* A ESTRUTURA é guardada saneada, ou não é guardada. Saneada porque o que
   * vai para o KV tem de ter forma conferida e ordem de chaves estável — é
   * contra esse valor que o Publicar confere o "antes" na próxima vez. E
   * nenhuma quando está vazia: o GET projeta `site` mesmo sem dado, a tela
   * devolve essa projeção no PUT, e sem esta linha toda primeira publicação
   * inventava o campo e uma linha no histórico que ninguém pediu. */
  if (App.siteVazio(novo.site)) delete novo.site;
  else novo.site = App.siteSaneado(novo.site);

  /* O QUE MUDOU, campo a campo, entre o que está gravado e o que VAI ser
   * gravado. Serve para duas coisas, e é por isso que a comparação roda para
   * TODA gravação desde a M5 — inclusive a do superadmin e a dos scripts:
   *
   *   - a conferência de permissão (M2): quem recusa é o servidor, e a mesa
   *     esconder o botão é conveniência;
   *   - o registro do histórico (M5). Como a comparação é aqui, gravação de
   *     script também entra: a rev 85, que apagou os ajustes do player em
   *     silêncio, teria aparecido como "arrastoTeto: 0,6 → vazio" na hora.
   *
   * Compara o documento FINAL, e não o corpo cru: o histórico tem de descrever
   * o que ficou guardado, não o que chegou. */
  const difs = App.diferencasDoCatalogo(atual || { itens: [] }, novo);

  if (!data.conta.super) {
    const barradas = App.proibidas(data.conta, difs);
    if (barradas.length) {
      return erro(403, 'conta-nao-pode-campos', { n: barradas.length }, {
        barradas: barradas.slice(0, 20).map(d => ({ alvo: d.alvo, campo: d.campo, permissao: d.permissao }))
      });
    }
  }

  const gravado = JSON.stringify(novo);
  await env.CATALOGO.put(CHAVE, gravado);

  /* O RASTRO (M5). Vem depois da gravação, e o erro dele não derruba a
   * publicação: histórico é memória, e memória que impede de trabalhar é pior
   * do que memória com um buraco. A resposta diz se ficou o buraco.
   *
   * O `catalogo_anterior` aposentou aqui: ele guardava UM estado anterior, e
   * agora são as 30 últimas cópias, cada uma com a rev no nome. A chave velha
   * fica onde está — apagar dado de recuperação não é trabalho de um deploy. */
  let historico = true;
  try {
    await registrarPublicacao(env, {
      anterior: atual, novo, corpoGravado: gravado, difs,
      quem: (data.conta && data.conta.usuario) || 'superadmin'
    });
  } catch (e) {
    historico = false;
  }

  return json(200, { ok: true, rev: novo.rev, total: novo.total, atualizado_em: novo.atualizado_em, mudancas: difs.length, historico });
}
