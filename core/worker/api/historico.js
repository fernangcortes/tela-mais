/* /api/historico — a linha do tempo das publicações (M5).
 *
 *   GET                  -> a linha do tempo, dos metadados das chaves
 *   GET ?rev=108         -> o registro daquela publicação, campo a campo
 *   GET ?versao=108      -> a cópia inteira do catálogo naquela rev
 *   POST { restaurar }   -> devolve o catálogo a uma cópia, como publicação nova
 *
 * Duas chaves por publicação, escritas pelo PUT do catálogo:
 *
 *   - `historico:<invertida>` — o que mudou. O RESUMO VAI NOS METADADOS da
 *     chave, e é por isso que a linha do tempo custa UMA listagem: sem eles,
 *     mostrar vinte publicações seria abrir vinte registros;
 *   - `versao:<rev>` — a cópia inteira, para ver como estava e restaurar. As
 *     30 últimas; a mais velha sai a cada publicação.
 *
 * Ver o histórico é de todo admin (todo admin vê tudo). RESTAURAR pede a
 * permissão `historico` E as permissões de cada campo que a volta muda — é uma
 * gravação como qualquer outra, e a conferência é a mesma do PUT.
 *
 * DESFAZER UMA MUDANÇA NÃO PASSA POR AQUI: a mesa monta a mudança contrária e
 * ela vira rascunho, que vai pelo Publicar de sempre. Um caminho de gravação a
 * menos é uma conferência de permissão a menos para manter.
 */
import { json, erro } from '../_lib/sessao.js';
import App from '../../site/catalogo-core.js';

const CHAVE = 'catalogo';

/* Trinta cópias inteiras, a conta: 30 × ~165 KB ≈ 5 MB, contra
 * o 1 GB do plano gratuito. Guardar todas acabaria com o espaço em meses; os
 * registros de mudança, que são ~1 KB, é que seguram a memória mais antiga. */
const VERSOES_GUARDADAS = 30;

/* Uma gravação de script pode mexer em tudo de uma vez. O registro guarda as
 * primeiras mudanças e o TOTAL — a linha do tempo continua verdadeira sobre o
 * tamanho do que aconteceu, sem um valor de 25 MiB no KV. */
const MUDANCAS_NO_REGISTRO = 300;

/* Grava o rastro de uma publicação. Chamada pelo PUT do catálogo DEPOIS de o
 * catálogo estar gravado, e de propósito: o histórico é memória, não pode
 * derrubar a publicação que ele descreve. Quem chama trata o erro. */
export async function registrarPublicacao(env, { anterior, novo, corpoGravado, difs, quem, restaurou }) {
  const conta = App.contarMudancasPorAlvo(difs);
  const registro = {
    rev: novo.rev,
    em: novo.atualizado_em,
    quem: quem || 'superadmin',
    conta,
    total: difs.length,
    mudancas: difs.slice(0, MUDANCAS_NO_REGISTRO),
    cortado: difs.length > MUDANCAS_NO_REGISTRO
  };
  if (restaurou != null) registro.restaurou = restaurou;

  /* Os metadados têm 1 KB: cabe o resumo, não cabe a lista. */
  const metadata = {
    rev: registro.rev,
    em: registro.em,
    quem: registro.quem,
    n: conta.total,
    bytes: corpoGravado.length,
    resumo: App.resumoDeMudancas(conta)
  };
  if (registro.restaurou != null) metadata.restaurou = registro.restaurou;

  await env.CATALOGO.put(App.chaveHistorico(novo.rev), JSON.stringify(registro), { metadata });

  const listadas = await env.CATALOGO.list({ prefix: 'versao:' });
  const existentes = (listadas.keys || []).map(k => k.name);

  /* A VIRADA: na primeira publicação com histórico, a cópia do estado que
   * acabou de sair ainda não existe em lugar nenhum — e sem ela o primeiro
   * "ver como estava" não teria o que mostrar. Grava-se uma vez só. */
  if (anterior && anterior.rev != null) {
    const chaveAnterior = App.chaveVersao(anterior.rev);
    if (existentes.indexOf(chaveAnterior) < 0) {
      await env.CATALOGO.put(chaveAnterior, JSON.stringify(anterior));
      existentes.push(chaveAnterior);
    }
  }

  const chaveNova = App.chaveVersao(novo.rev);
  await env.CATALOGO.put(chaveNova, corpoGravado);
  if (existentes.indexOf(chaveNova) < 0) existentes.push(chaveNova);

  /* A mais velha sai. A chave da versão tem a rev crua com zeros à esquerda, e
   * por isso a ordem alfabética É a ordem das revs. */
  existentes.sort();
  for (const chave of existentes.slice(0, Math.max(0, existentes.length - VERSOES_GUARDADAS))) {
    await env.CATALOGO.delete(chave);
  }
  return true;
}

async function linhaDoTempo(env, limite, cursor) {
  const r = await env.CATALOGO.list({ prefix: 'historico:', limit: limite, cursor: cursor || undefined });
  const linha = (r.keys || []).map((k) => {
    const meta = k.metadata || {};
    return {
      rev: meta.rev != null ? meta.rev : App.revDaChaveHistorico(k.name),
      em: meta.em || null,
      quem: meta.quem || null,
      n: meta.n || 0,
      bytes: meta.bytes || null,
      resumo: meta.resumo || '',
      restaurou: meta.restaurou
    };
  }).filter(x => x.rev != null);
  return { linha, fim: r.list_complete !== false, cursor: r.cursor || null };
}

export async function onRequestGet({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  if (!data.admin) return erro(401, 'nao-autorizado');

  const p = new URL(request.url).searchParams;

  const versao = p.get('versao');
  if (versao) {
    const copia = await env.CATALOGO.get(App.chaveVersao(versao), 'json');
    if (!copia) return erro(404, 'sem-copia-rev', { rev: versao });
    return json(200, { rev: Number(versao), catalogo: copia });
  }

  const rev = p.get('rev');
  if (rev) {
    const registro = await env.CATALOGO.get(App.chaveHistorico(rev), 'json');
    if (!registro) return erro(404, 'sem-registro-rev', { rev });
    /* Diz se a cópia inteira daquela rev ainda existe: passadas as 30, o
     * registro do que mudou continua, e o "ver como estava" não. */
    const copia = await env.CATALOGO.get(App.chaveVersao(rev));
    return json(200, { registro, temCopia: !!copia });
  }

  const limite = Math.max(1, Math.min(200, Number(p.get('limite')) || 30));
  return json(200, await linhaDoTempo(env, limite, p.get('cursor')));
}

/* Restaurar: a cópia vira o catálogo de novo, como PUBLICAÇÃO NOVA — a rev
 * anda para a frente, e a volta entra no histórico com o número da rev de onde
 * veio. Nada é apagado; desfazer a restauração é restaurar a anterior. */
export async function onRequestPost({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  if (!App.contaPode(data.conta, 'historico')) {
    return erro(403, 'sem-permissao-restaurar', null, { permissao: 'historico' });
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }
  const alvo = corpo && corpo.restaurar;
  if (alvo == null || !isFinite(Number(alvo))) return erro(400, 'esperado-restaurar');

  const copia = await env.CATALOGO.get(App.chaveVersao(alvo), 'json');
  if (!copia) return erro(404, 'sem-copia-rev', { rev: alvo });

  const atual = await env.CATALOGO.get(CHAVE, 'json');
  const revAtual = (atual && atual.rev) || 0;
  if (corpo.rev != null && corpo.rev !== revAtual) {
    return erro(409, 'catalogo-mudou', null, { rev_servidor: revAtual, rev_enviada: corpo.rev });
  }

  const novo = Object.assign({}, copia, {
    versao: copia.versao || 1,
    rev: revAtual + 1,
    total: (copia.itens || []).length,
    atualizado_em: new Date().toISOString()
  });
  delete novo.config;
  /* De onde a volta veio é assunto do HISTÓRICO, não do catálogo: um campo
   * `restaurou` guardado no documento viajaria para sempre em toda gravação,
   * apareceria como diferença na publicação seguinte e voltaria junto na
   * próxima restauração. O número vai no registro, que é onde se pergunta. */
  delete novo.restaurou;

  /* A MESMA conferência do PUT, campo a campo: quem restaura precisa poder
   * mudar tudo o que a volta muda. `historico` abre a porta; não dá poderes. */
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

  let historico = true;
  try {
    await registrarPublicacao(env, {
      anterior: atual, novo, corpoGravado: gravado, difs,
      quem: (data.conta && data.conta.usuario) || 'superadmin',
      restaurou: Number(alvo)
    });
  } catch (e) {
    historico = false;
  }

  return json(200, { ok: true, rev: novo.rev, total: novo.total, restaurou: Number(alvo), mudancas: difs.length, historico });
}
