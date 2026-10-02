/* scripts/lib/ia-lote.mjs — a lógica dos scripts de lote da IA (M9), separada da linha de comando para ser testável.
 *
 *   rodarTextos(...)       sinopse, capítulos, tags, título alternativo, descrição para acessibilidade, tradução de legenda
 *   rodarTranscricao(...)  legenda por IA (Whisper no Workers AI, AssemblyAI, OpenAI ou a legenda nativa do provedor de vídeo)
 *
 * REGRAS (as mesmas do Worker, porque o código é o mesmo):
 *   - CUSTO ANTES: o lote é estimado pelo site (`POST /api/ia { acao:'estimar' }`), mostrado, e só segue com `--yes`. Lote acima
 *     do orçamento do mês é recusado. O gasto real de cada chamada vai ao site na hora.
 *   - NADA VAI AO AR: tudo que sai é SUGESTÃO na fila do /admin (`/api/ia-sugestoes`); uma pessoa aceita, edita ou descarta.
 *   - Recurso desligado no /admin não roda.
 * Retorno: { codigo: 0 deu certo | 1 falhou | 3 falta uma confirmação (--yes), resumo }. */
import { configDeTexto, configDeTranscricao, TAREFAS_LIGAVEIS } from '../../core/worker/_lib/ia/config.js';
import { gerarSugestoes, transcricaoDoItem } from '../../core/worker/_lib/ia/pipeline.js';
import { transcrever } from '../../core/worker/_lib/ia/transcricao/index.js';
import { TAREFAS, NOMES_DE_TAREFAS } from '../../core/worker/_lib/ia/tarefas.js';
import { proveniencia } from '../../core/worker/_lib/ia/proveniencia.js';
import { orcamentoRemoto } from './ia-cliente.mjs';

const curto = (i) => String(i || 'pt').split('-')[0].toLowerCase();
const usd = (n) => 'US$ ' + (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');

/* Já tem este campo preenchido? (a regra de não refazer o que existe, a menos que `--refazer`) */
const JA_TEM = {
  sinopse: (i) => Boolean(i.sinopse), sinopse_longa: (i) => Boolean(i.sinopse_longa),
  capitulos: (i) => Array.isArray(i.capitulos) && i.capitulos.length > 0,
  tags: (i) => Array.isArray(i.tags) && i.tags.length > 0,
  titulo_alternativo: (i) => Boolean(i.titulo_alternativo), descricao_acessivel: (i) => Boolean(i.descricao_acessivel)
};

export function escolherTitulos(itens, { ids, piloto, todos }) {
  if (ids && ids.length) {
    const falta = ids.filter((id) => !itens.some((i) => i.id === id));
    if (falta.length) throw new Error('id não encontrado no catálogo: ' + falta.join(', '));
    return itens.filter((i) => ids.includes(i.id));
  }
  if (piloto) return itens.filter((i) => i.piloto === true);
  if (todos) return itens.slice();
  throw new Error('diga quais títulos: --item id1,id2 | --piloto | --todos');
}

export function listaDe(valor) {
  return typeof valor === 'string' ? valor.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function mostrarEstimativa(log, e) {
  log('Estimativa (US$, valores de ' + e.dataDosPrecos + (e.precosConfirmados ? '' : '; há preço NÃO conferido na fonte oficial') + ', margem de ' + Math.round((e.margem - 1) * 100) + '% já incluída):');
  for (const [t, v] of Object.entries(e.porTarefa)) log('  ' + t.padEnd(22) + usd(v));
  log('  ' + 'TOTAL'.padEnd(22) + usd(e.totalUSD) + '   (orçamento do mês: ' + usd(e.limiteUSD) + ', já gasto ' + usd(e.gastoDoMesUSD) + ', sobram ' + usd(e.restanteUSD) + ')');
  for (const a of e.avisos || []) log('  aviso: ' + a);
}

/* O que as duas rotinas fazem antes de gastar: confere liga/desliga, estima, mostra, recusa ou pede o --yes. */
async function portaoDeCusto({ cliente, tarefas, ids, idiomasDestino, estado, opcoes, log }) {
  const desligadas = tarefas.filter((t) => TAREFAS_LIGAVEIS.includes(t) && !(estado.recursos[t] && estado.recursos[t].ligado));
  if (desligadas.length) return { codigo: 1, resumo: 'recurso desligado no /admin (tela IA): ' + desligadas.join(', ') };
  const { estimativa, decisao } = await cliente.estimar({ tarefas, ids, idiomasDestino });
  mostrarEstimativa(log, estimativa);
  if (!decisao.ok) return { codigo: 1, resumo: 'lote RECUSADO: custaria ' + usd(decisao.totalUSD) + ' e o mês só tem ' + usd(decisao.restanteUSD) + ' de orçamento. Nada foi feito.', estimativa };
  if (opcoes.simular) return { codigo: 0, resumo: '--simular: nada foi chamado.', estimativa };
  if (!opcoes.yes) return { codigo: 3, resumo: 'Isto vai gastar dinheiro (estimativa acima). Se concorda, rode de novo com --yes.', estimativa };
  return { liberado: true, estimativa };
}

export async function rodarTextos({ opcoes, cliente, config, env, provedor, fetch, log = console.log, agora = Date.now }) {
  const tarefas = listaDe(opcoes.tarefa);
  const invalidas = tarefas.filter((t) => !NOMES_DE_TAREFAS.includes(t) || t === 'trechos-trailer' || t === 'transcricao');
  if (!tarefas.length || invalidas.length) return { codigo: 1, resumo: 'diga a tarefa: --tarefa ' + NOMES_DE_TAREFAS.filter((t) => t !== 'trechos-trailer').join(' | ') + (invalidas.length ? ' (inválida: ' + invalidas.join(', ') + ')' : '') };
  const idiomasDestino = listaDe(opcoes.idiomas);
  if (tarefas.includes('traducao-legenda') && !idiomasDestino.length) return { codigo: 1, resumo: 'a tradução precisa de --idiomas en,es (os idiomas de destino)' };

  const texto = configDeTexto(config, env);
  if (!texto.pronto) {
    return { codigo: 1, resumo: texto.provedor === 'nenhum'
      ? 'a IA de textos está desligada (ia.textos.provedor = "nenhum" em config/site.json).'
      : 'falta a chave do provedor "' + texto.provedor + '": guarde-a como segredo (node scripts/setup.mjs segredo NOME) ou no .env, e aponte ia.textos.chave para {"$env":"NOME"}.' };
  }

  const estado = await cliente.estado();
  const catalogo = await cliente.catalogo();
  const alvos = escolherTitulos(catalogo.itens || [], { ids: listaDe(opcoes.item), piloto: opcoes.piloto === true, todos: opcoes.todos === true });
  const fila = await cliente.fila();
  const pendente = new Set(fila.map((s) => s.itemId + '|' + s.campo));

  /* por título, só as tarefas que ainda fazem falta */
  const plano = [];
  for (const item of alvos) {
    const fazer = [];
    for (const t of tarefas) {
      const def = TAREFAS[t];
      if (t === 'traducao-legenda') { if (opcoes.refazer || idiomasDestino.some((d) => !pendente.has(item.id + '|legenda-' + d))) fazer.push(t); continue; }
      if (!opcoes.refazer && (JA_TEM[def.campo] ? JA_TEM[def.campo](item) : false)) continue;
      if (!opcoes.refazer && pendente.has(item.id + '|' + def.campo)) continue;
      fazer.push(t);
    }
    if (fazer.length) plano.push({ item, tarefas: fazer });
  }
  log('Títulos: ' + alvos.length + ' escolhidos, ' + plano.length + ' com algo a fazer.');
  if (!plano.length) return { codigo: 0, resumo: 'nada a fazer (use --refazer para gerar de novo o que já existe).' };

  const porta = await portaoDeCusto({ cliente, tarefas: Array.from(new Set(plano.flatMap((p) => p.tarefas))), ids: plano.map((p) => p.item.id), idiomasDestino, estado, opcoes, log });
  if (!porta.liberado) return porta;

  const orcamento = orcamentoRemoto(cliente, estado.orcamento);
  const contagem = { sugeridas: 0, insuficientes: 0, falhas: 0, semLegenda: 0 };
  let gasto = 0;
  const registrar = async (s) => {
    const r = await cliente.entregar(s);
    return r.ok ? { ok: true } : { ok: false, codigo: (r.json && r.json.codigo) || 'erro' };
  };
  for (const { item, tarefas: fazer } of plano) {
    let resultados;
    try {
      resultados = await gerarSugestoes({ env, config, item, tarefas: fazer, idiomasDestino, provedor, fetch, orcamento, registrar, agora,
        ligados: Object.fromEntries(Object.entries(estado.recursos).map(([k, v]) => [k, v.ligado])) });
    } catch (e) {
      contagem.falhas++; log('  ✖ ' + item.titulo + ': ' + e.message); continue;
    }
    for (const r of resultados) {
      gasto += r.custoUSD || 0;
      if (r.estado === 'sugerida') { contagem.sugeridas++; log('  ✔ ' + item.titulo + ' · ' + r.tarefa + (r.idioma ? ' → ' + r.idioma : '') + ' (sugestão na fila)'); }
      else if (r.estado === 'insuficiente') { contagem.insuficientes++; log('  · ' + item.titulo + ' · ' + r.tarefa + ': a transcrição não sustenta (nada foi inventado)'); }
      else if (r.estado === 'sem-transcricao') { contagem.semLegenda++; log('  · ' + item.titulo + ': sem legenda para a IA ler (rode ia-transcrever antes)'); }
      else { contagem.falhas++; log('  ✖ ' + item.titulo + ' · ' + r.tarefa + ': ' + (r.codigo || 'falhou') + (r.detalhe ? ' (' + r.detalhe + ')' : '')); }
    }
    if (!(await orcamento.podeGastar(0.0001))) { log('Orçamento do mês esgotado: parei aqui.'); break; }
  }
  const resumo = 'sugestões na fila: ' + contagem.sugeridas + ' · sem material: ' + contagem.insuficientes + ' · sem legenda: ' + contagem.semLegenda + ' · falhas: ' + contagem.falhas + ' · gasto real: ' + usd(gasto);
  log('\n' + resumo + '\nNada foi publicado: revise na tela IA do /admin (aceitar, editar ou descartar).');
  return { codigo: contagem.falhas && !contagem.sugeridas ? 1 : 0, resumo, contagem, gasto };
}

/* ------------------------------------------------------------------ transcrição */

export async function rodarTranscricao({ opcoes, cliente, config, env, provedor, fetch, audio, log = console.log, agora = Date.now }) {
  const fala = configDeTranscricao(config, env);
  if (fala.provedor === 'nenhum') return { codigo: 1, resumo: 'a transcrição está desligada (ia.transcricao.provedor = "nenhum" em config/site.json).' };
  if (!fala.pronto) return { codigo: 1, resumo: 'falta a chave (ou a conta Cloudflare) da transcrição "' + fala.provedor + '": guarde-a como segredo ou no .env e aponte ia.transcricao.chave para {"$env":"NOME"}.' };
  const idioma = opcoes.idioma || fala.idioma;
  const campo = 'legenda-' + curto(idioma);

  const estado = await cliente.estado();
  const catalogo = await cliente.catalogo();
  const alvos = escolherTitulos(catalogo.itens || [], { ids: listaDe(opcoes.item), piloto: opcoes.piloto === true, todos: opcoes.todos === true });
  const pendente = new Set((await cliente.fila()).map((s) => s.itemId + '|' + s.campo));

  const plano = [];
  for (const item of alvos) {
    if (!(item.fonte && item.fonte.id)) continue;
    if (!opcoes.refazer && pendente.has(item.id + '|' + campo)) continue;
    if (!opcoes.refazer && await transcricaoDoItem({ provedor, item, idioma, fetch }).catch(() => null)) continue;   /* já tem legenda no provedor */
    plano.push(item);
  }
  log('Títulos: ' + alvos.length + ' escolhidos, ' + plano.length + ' sem legenda em ' + idioma + '.');
  if (!plano.length) return { codigo: 0, resumo: 'nada a fazer (use --refazer para transcrever de novo).' };

  const porta = await portaoDeCusto({ cliente, tarefas: ['transcricao'], ids: plano.map((i) => i.id), idiomasDestino: [], estado, opcoes, log });
  if (!porta.liberado) return porta;

  const orcamento = orcamentoRemoto(cliente, estado.orcamento);
  const contagem = { sugeridas: 0, semFala: 0, falhas: 0 };
  let gasto = 0;
  for (const item of plano) {
    let r;
    try {
      const origem = await audio.origemDe({ item, provedor, fala, opcoes, config });
      r = await transcrever({ origem, idioma, config, env, fetch, orcamento, agora, glossario: (config.ia && config.ia.textos && config.ia.textos.estilo && config.ia.textos.estilo.glossario) || [] });
    } catch (e) { r = { estado: 'falhou', codigo: 'erro', detalhe: e.message, custoUSD: 0 }; }
    gasto += r.custoUSD || 0;
    if (r.estado === 'ok' && r.srt) {
      const g = await cliente.entregar({ itemId: item.id, campo, valor: r.srt, proveniencia: r.proveniencia, custoUSD: r.custoUSD, atual: null });
      if (g.ok) { contagem.sugeridas++; log('  ✔ ' + item.titulo + ': legenda ' + idioma + ' na fila (' + usd(r.custoUSD) + ')'); }
      else { contagem.falhas++; log('  ✖ ' + item.titulo + ': a fila recusou (' + ((g.json && g.json.codigo) || g.status) + ')'); }
    } else if (r.estado === 'ok') { contagem.falhas++; log('  ✖ ' + item.titulo + ': este modelo devolve só texto, sem tempos; troque o modelo (ex.: whisper-1) para gerar legenda'); }
    else if (r.estado === 'sem-fala') { contagem.semFala++; log('  · ' + item.titulo + ': sem fala no áudio (nada a legendar)'); }
    else if (r.estado === 'pendente') { contagem.falhas++; log('  … ' + item.titulo + ': o provedor ainda processa; rode de novo mais tarde'); }
    else { contagem.falhas++; log('  ✖ ' + item.titulo + ': ' + (r.codigo || 'falhou') + (r.detalhe ? ' (' + r.detalhe + ')' : '')); }
  }
  const resumo = 'legendas na fila: ' + contagem.sugeridas + ' · sem fala: ' + contagem.semFala + ' · falhas: ' + contagem.falhas + ' · gasto real: ' + usd(gasto);
  log('\n' + resumo + '\nNada foi publicado: a legenda espera a sua revisão na tela IA do /admin.');
  return { codigo: contagem.falhas && !contagem.sugeridas ? 1 : 0, resumo, contagem, gasto };
}
