/* scripts/indice-busca.mjs — a carga e a reserva do índice da busca
 *
 *   node scripts/indice-busca.mjs --simular            mostra o que mudaria; não grava
 *   node scripts/indice-busca.mjs                      põe na busca o que mudou
 *   node scripts/indice-busca.mjs --item <id>[,<id>]   só estes títulos
 *   node scripts/indice-busca.mjs --refazer            ignora o manifesto e refaz tudo
 *   node scripts/indice-busca.mjs --so fala            só a fala, sem os vetores do sentido
 *   node scripts/indice-busca.mjs --salvar <arquivo>   escreve o índice da fala num arquivo,
 *                                                      para o `mesa-local.mjs --fala`; não toca o site
 *   node scripts/indice-busca.mjs --provar             a prova do sentido: não grava nada
 *
 * A PROVA DO MODELO, sem ninguém rotular nada: os títulos de capítulo são
 * perguntas com resposta conhecida — cada um descreve a fala entre o seu
 * início e o do próximo. Cada título é perguntado contra os vetores da FALA, e
 * conta-se em quantos o trecho certo vem entre os 5 primeiros. Junto, as
 * perguntas que não têm resposta no acervo ("asdfgh", "receita de bolo"),
 * para o CORTE: a nota delas é o chão que ele tem de passar. Custa uma
 * consulta ao Vectorize por capítulo — 461 × 1.024 dimensões, 1,6% do mês.
 *
 * QUEM PÕE NA BUSCA, NO DIA A DIA, É A MESA: no envio de um título novo, com
 * a legenda que ela já leu, e depois do Publicar, para a sinopse revisada.
 * Este script é a CARGA dos vídeos que já estavam no ar quando a busca nasceu,
 * e a RESERVA: a legenda trocada pelo `capas-legendas.mjs` pede rodá-lo, e o
 * painel da mesa mostra quem ficou fora.
 *
 * Um código só com a mesa: a leitura e a condensação vêm do
 * `site/indice-core.js`, e a escrita é a mesma rota, `POST /api/busca/indexar`.
 * Idempotente: o manifesto guarda o hash de cada conjunto de cada vídeo, e o
 * que tem hash igual é pulado.
 *
 * Indexa TODO título com vídeo, e não só os que estão no ar: é o que a mesa
 * faz no envio — o título novo entra na busca fora do ar —, e quem esconde o
 * fora do ar é o GET da fala, pelo catálogo da hora. O título que volta ao ar
 * volta com a fala, sem rodar nada.
 *
 * Um vídeo por vez, com UM SEGUNDO entre um e o seguinte: a chamada que fecha
 * o vídeo grava duas chaves do KV, e cada chave aceita uma escrita por segundo
 * (limites do KV).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { argumentos, erroFatal } from './lib/catalogo.mjs';
import { baixarTextoDaLegenda } from './lib/legenda.mjs';
import AppIndice from '../core/site/indice-core.js';
import App from '../core/site/catalogo-core.js';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
/* Quantos vetores por chamada: é a alavanca do CPU da rota, e o
 * `--lote <n>` existe para medi-la. O servidor aceita até o teto do
 * `indice-core.js`. */
const tamanhoDoLote = Math.max(1, Math.min(AppIndice.LIMITES.vetores, Number(op.lote) || AppIndice.LIMITES.vetores));
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function entrar() {
  const r = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!r.ok) throw new Error(`login recusado (${r.status})`);
  return (await r.json()).token;
}

function cliente(token) {
  return async function api(caminho, init = {}) {
    const r = await fetch(site + caminho, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(init.headers || {}) }
    });
    const texto = await r.text();
    let corpo = null;
    try { corpo = JSON.parse(texto); } catch (e) { /* resposta sem JSON */ }
    if (!r.ok) throw new Error(`${caminho} respondeu ${r.status}: ${(corpo && corpo.erro) || texto.slice(0, 200)}`);
    return corpo;
  };
}

/* A nota que deixa `fracao` das notas para baixo (0,5 é a mediana). */
function quantil(notas, fracao) {
  if (!notas.length) return null;
  const o = notas.slice().sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(fracao * o.length))];
}

async function provar(api, itens) {
  const noAr = itens.filter((i) => i.publicar === true && i.fonte && i.fonte.videoId);
  let perguntas = 0, top5 = 0, top1 = 0;
  const notasCertas = [], primeiras = [], semAcerto = [];
  for (const item of noAr) {
    const caps = App.capitulos(item);
    for (let i = 0; i < caps.length; i++) {
      const ini = caps[i].inicio;
      const fim = i + 1 < caps.length ? caps[i + 1].inicio : Infinity;
      const r = await api('/api/busca/sentido?cru=1&tipo=f&k=5&q=' + encodeURIComponent(caps[i].titulo));
      const brutos = r.brutos || [];
      perguntas++;
      /* O trecho certo: um bloco do MESMO vídeo cuja janela de 30 s cruza o
       * capítulo. */
      const pos = brutos.findIndex((b) => b[0] === item.fonte.videoId && b[2] < fim && b[2] + 30 > ini);
      if (pos >= 0) { top5++; notasCertas.push(brutos[pos][3]); if (pos === 0) top1++; }
      else semAcerto.push(`${item.titulo.slice(0, 40)} · ${caps[i].titulo}`);
      if (brutos[0]) primeiras.push(brutos[0][3]);
      if (perguntas % 50 === 0) console.log(`  ${perguntas} perguntas…`);
    }
  }
  const pct = (n) => (100 * n / perguntas).toFixed(1).replace('.', ',') + '%';
  console.log(`\nA PROVA: ${perguntas} títulos de capítulo, contra os vetores da fala`);
  console.log(`  o trecho certo entre os 5 primeiros: ${top5} (${pct(top5)})`);
  console.log(`  o trecho certo em primeiro:          ${top1} (${pct(top1)})`);
  const q = (l) => [0.05, 0.15, 0.25, 0.5, 0.75].map((f) => quantil(l, f)).join(' / ');
  console.log(`  nota do trecho certo (5% / 15% / 25% / 50% / 75%): ${q(notasCertas)}`);
  console.log(`  nota do primeiro de cada pergunta (idem):          ${q(primeiras)}`);
  const acima = notasCertas.filter((n) => n >= AppIndice.CORTE).length;
  console.log(`  dos ${notasCertas.length} acertos, acima do corte ${AppIndice.CORTE}: ${acima} (${(100 * acima / notasCertas.length).toFixed(1).replace('.', ',')}% deles, ${pct(acima)} das perguntas)`);

  console.log('\nO CHÃO DO CORTE: perguntas sem resposta no acervo, contra tudo (fala, capítulo, sinopse)');
  const soltas = ['asdfgh', 'qwerty', 'xkcd zzz', 'lorem ipsum dolor sit amet', 'receita de bolo de chocolate',
    'campeonato de fórmula 1', 'criptomoedas e bitcoin', 'previsão do tempo para amanhã', 'como trocar o pneu do carro'];
  for (const s of soltas) {
    const r = await api('/api/busca/sentido?cru=1&k=3&q=' + encodeURIComponent(s));
    console.log(`  ${s.padEnd(32)} ${(r.brutos || []).map((b) => b[3] + ' ' + b[1]).join(' · ')}`);
  }
  console.log(`\ncorte em uso no servidor: ${AppIndice.CORTE}`);
  if (semAcerto.length) {
    console.log(`\nsem o trecho certo entre os 5 (${semAcerto.length}), os 15 primeiros:`);
    semAcerto.slice(0, 15).forEach((s) => console.log('   ' + s));
  }
}

/* Um título por vídeo. Se dois títulos apontam para o mesmo vídeo, vale o que
 * está no ar — é dele a sinopse que a busca mostra. */
function titulosPorVideo(itens, escolhidos) {
  const porVideo = new Map();
  for (const item of itens) {
    const v = item.fonte && item.fonte.videoId;
    if (!v) continue;
    if (escolhidos && !escolhidos.has(item.id)) continue;
    const ja = porVideo.get(v);
    if (!ja || (ja.publicar !== true && item.publicar === true)) porVideo.set(v, item);
  }
  return [...porVideo.values()];
}

try {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');

  const api = cliente(await entrar());
  const catalogo = await api('/api/catalogo?completo=1');
  const pullzone = catalogo.config && catalogo.config.pullzone;
  if (!pullzone) throw new Error('o catálogo não trouxe a pull zone (config.pullzone)');

  const escolhidos = typeof op.item === 'string' ? new Set(op.item.split(',').map((s) => s.trim())) : null;
  const titulos = titulosPorVideo(catalogo.itens || [], escolhidos);
  if (escolhidos) {
    const faltam = [...escolhidos].filter((id) => !titulos.some((i) => i.id === id));
    if (faltam.length) throw new Error('id sem vídeo ou fora do catálogo: ' + faltam.join(', '));
  }

  /* --salvar: o índice da fala num arquivo, e nada mais. É o que alimenta o
   * site do `mesa-local.mjs`, que não tem KV. */
  if (typeof op.salvar === 'string') {
    let texto = '';
    let com = 0;
    for (const item of titulos) {
      const legenda = await baixarTextoDaLegenda(pullzone, item.fonte.videoId, site + '/');
      if (!legenda) continue;
      texto = AppIndice.trocarLinha(texto, item.fonte.videoId, AppIndice.blocosDaLegenda(legenda));
      com++;
    }
    await writeFile(path.resolve(op.salvar), texto + '\n', 'utf8');
    console.log(`índice da fala de ${com} vídeos em ${op.salvar} (${(Buffer.byteLength(texto) / 1024).toFixed(0)} KB)`);
    process.exit(0);
  }

  if (op.provar) {
    await provar(api, catalogo.itens || []);
    process.exit(0);
  }

  const manifesto = await api('/api/busca/indexar');
  const comSentido = manifesto.sentido === true && op.so !== 'fala';
  const kinds = comSentido ? ['fala', 'capitulos', 'sinopse'] : ['fala'];
  console.log(`site: ${site}`);
  console.log(`manifesto: versão ${manifesto.versao || 0}, ${Object.keys(manifesto.videos || {}).length} vídeos`);
  console.log(`busca por sentido neste ambiente: ${manifesto.sentido ? 'ligada' : 'desligada'}` +
    (manifesto.sentido && !comSentido ? ' (e deixada de fora: --so fala)' : ''));
  console.log(`${titulos.length} títulos com vídeo${escolhidos ? ' escolhidos' : ''}\n`);

  let feitos = 0, pulados = 0, semLegenda = 0, vetores = 0, apagados = 0;
  const falhas = [];

  for (const item of titulos) {
    const videoId = item.fonte.videoId;
    const antes = (manifesto.videos || {})[videoId] || {};
    const legenda = await baixarTextoDaLegenda(pullzone, videoId, site + '/');
    const conj = Object.assign({ fala: legenda ? AppIndice.blocosDaLegenda(legenda) : [] }, AppIndice.conjuntosDoItem(item));
    if (!legenda) semLegenda++;

    /* O que precisa ir: o conjunto cujo hash mudou, ou — com o sentido ligado
     * — cujos vetores ainda não foram feitos. */
    const vai = kinds.filter((k) => {
      if (op.refazer) return true;
      const guardado = antes[k];
      if (!guardado) return true;
      const hashAgora = k === 'sinopse' ? AppIndice.hash(conj.sinopse) : AppIndice.hashConjunto(conj[k]);
      if (guardado.hash !== hashAgora) return true;
      return comSentido && guardado.sentido !== true;
    });
    const nome = `${item.publicar === true ? '●' : '○'} ${item.titulo}`;
    if (!vai.length) { pulados++; continue; }

    const enviar = {};
    vai.forEach((k) => { enviar[k] = conj[k]; });
    const osVetores = comSentido ? AppIndice.vetoresDosConjuntos(enviar) : [];
    console.log(`${nome}\n    ${vai.map((k) => k === 'sinopse' ? 'sinopse' : k + ' (' + conj[k].length + ')').join(', ')}` +
      (comSentido ? ` · ${osVetores.length} vetores` : '') + (legenda ? '' : ' · sem legenda'));
    if (op.simular) { feitos++; continue; }

    try {
      for (const lote of AppIndice.lotes(osVetores, tamanhoDoLote)) {
        const r = await api('/api/busca/indexar', { method: 'POST', body: JSON.stringify({ videoId, vetores: lote }) });
        vetores += r.vetores || 0;
      }
      const fim = await api('/api/busca/indexar', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ videoId, fim: true, sentido: comSentido }, enviar))
      });
      apagados += fim.apagados || 0;
      feitos++;
    } catch (e) {
      falhas.push(`${item.id}: ${e.message}`);
      console.log('    ✖ ' + e.message);
    }
    /* Uma escrita por segundo em cada chave do KV. */
    await esperar(1100);
  }

  console.log(`\n${op.simular ? 'iriam' : 'foram'} ${feitos} vídeos · ${pulados} sem mudança · ${semLegenda} sem legenda` +
    (op.simular ? '' : ` · ${vetores} vetores · ${apagados} vetores apagados`));
  if (op.simular) console.log('--simular: nada foi gravado.');
  if (falhas.length) {
    console.log(`\n${falhas.length} falharam — rode de novo, e o que já foi é pulado:`);
    falhas.forEach((f) => console.log('   ' + f));
    process.exit(1);
  }
} catch (e) {
  erroFatal(e);
}
