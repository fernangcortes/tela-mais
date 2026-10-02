/* scripts/capitulos.mjs — grava os capítulos dos vídeos longos.
 *
 *   node scripts/capitulos.mjs --simular            mostra tudo que faria
 *   node scripts/capitulos.mjs                      grava no player do provedor (se ele tiver) e no catálogo
 *   node scripts/capitulos.mjs --item <id>[,<id>]   só esses títulos
 *   node scripts/capitulos.mjs --minimo 300         só os acima de N segundos
 *   node scripts/capitulos.mjs --so player          só o player do provedor (o `--so bunny` de antes vale igual)
 *   node scripts/capitulos.mjs --so site            só a lista da ficha
 *   node scripts/capitulos.mjs --limpar <id>[,<id>] apaga os capítulos
 *   node scripts/capitulos.mjs --transcricao <id>   imprime a legenda em blocos
 *
 * DOIS LUGARES, DUAS FUNÇÕES DIFERENTES — não são redundância:
 *
 *   player   (capacidade `capitulosNativos` do adaptador: o Bunny) é quem segmenta a linha
 *            do tempo do player e mostra o título no hover. O player é um iframe de outro
 *            domínio; nada que o site faça desenha aquilo. Provedor sem isso (Stream, HLS
 *            genérico) fica só com a ficha do catálogo.
 *   catálogo é quem alimenta a lista clicável ao lado do player (`app.js`).
 *            Campo que não está no KV não existe para o navegador.
 *
 * DE ONDE SAEM OS CAPÍTULOS: de `capitulos.json`, escrito à mão a partir da
 * legenda de cada vídeo. Não são gerados aqui e não são gerados pela IA do
 * Bunny (os Smart Chapters não têm gatilho por API — só o botão do painel).
 * A legenda é ASR cru, sem pontuação confiável e quebrada no meio da frase:
 * cortar por pausa ou por contagem de cues dá capítulo sem sentido. Use
 * `--transcricao <id>` para ler o vídeo e escrever os cortes à mão.
 *
 * `capitulos.json` guarda só `inicio` e `titulo`. O `end` que a API do player
 * pede é derivado por `fecharCapitulos` (scripts/lib/capitulos.mjs): cada
 * capítulo fecha onde o seguinte começa, e o último fecha na duração do vídeo —
 * assim a linha do tempo fica inteira segmentada, sem buraco entre um segmento
 * e o outro.
 *
 * IDEMPOTENTE: relê o que está no provedor e no KV antes de escrever, e pula o que
 * já está igual. Rodar de novo não gera requisição nem sobe `rev`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baixarLegenda, condensar, paraCarimbo } from './lib/legenda.mjs';
import { fecharCapitulos, iguaisNoPlayer, iguaisNoCatalogo, paraCatalogo } from './lib/capitulos.mjs';
import { argumentos, erroFatal } from './lib/catalogo.mjs';
import { videoDoItem, dadosDoItem, exigirConfigurado, provedorDoAmbiente, urlDaLegenda } from './lib/provedores/index.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CAPITULOS_PADRAO = path.resolve(AQUI, '..', 'exemplo', 'capitulos.json');

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const minimo = op.minimo != null ? Number(op.minimo) : 0;
/* `--so site` grava só a ficha; `--so player` (ou `bunny`, o nome de antes) só o player do provedor. */
const so = typeof op.so === 'string' ? (op.so === 'bunny' ? 'player' : op.so) : '';

const lista = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);

/* --------------------------------------------------------------- execução */

async function entrar() {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');
  const r = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!r.ok) throw new Error(`login recusado (${r.status})`);
  return { Authorization: 'Bearer ' + (await r.json()).token };
}

async function gravarCatalogo(auth, catalogo) {
  const r = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(catalogo)
  });
  const res = await r.json();
  if (!r.ok) throw new Error('gravação recusada: ' + JSON.stringify(res));
  return res;
}

try {
  /* --transcricao não toca em nada: é a ferramenta de leitura que produz os
   * cortes que vão para capitulos.json. */
  if (typeof op.transcricao === 'string') {
    const auth = await entrar();
    const catalogo = await (await fetch(site + '/api/catalogo?completo=1', { headers: auth })).json();
    for (const id of lista(op.transcricao)) {
      const item = catalogo.itens.find((i) => i.id === id);
      if (!item) throw new Error('id não encontrado no catálogo: ' + id);
      const { provedor } = await provedorDoAmbiente();
      if (!videoDoItem(provedor, item)) throw new Error(id + ' não tem vídeo no provedor');
      const cues = await baixarLegenda(await urlDaLegenda(provedor, item), site + '/');
      if (!cues) { console.log(`# ${item.titulo} — SEM LEGENDA no provedor`); continue; }
      console.log(`# ${item.titulo}  (${id}, ${cues.length} cues)`);
      for (const b of condensar(cues, Number(op.janela) || 30)) {
        console.log(`[${paraCarimbo(b.inicio)}] ${b.texto}`);
      }
    }
    process.exit(0);
  }

  const auth = await entrar();
  const catalogo = await (await fetch(site + '/api/catalogo?completo=1', { headers: auth })).json();
  delete catalogo.config;
  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  /* Capítulo no PLAYER do provedor é capacidade (`capitulosNativos`): sem ela, os capítulos vivem só na ficha do catálogo. */
  const nativos = provedor.capacidades().capitulosNativos === true && typeof provedor.definirCapitulos === 'function';
  if (so === 'player' && !nativos) throw new Error('o provedor "' + provedor.id + '" não tem capítulos no player: use --so site (a ficha do catálogo).');

  /* --limpar é o desfazer: some do player e da ficha. */
  if (typeof op.limpar === 'string') {
    const ids = new Set(lista(op.limpar));
    let n = 0;
    for (const item of catalogo.itens) {
      if (!ids.has(item.id)) continue;
      n++;
      console.log('  limpando: ' + item.titulo);
      if (!op.simular) {
        if (nativos && videoDoItem(provedor, item)) await provedor.definirCapitulos(videoDoItem(provedor, item).id, []);
        delete item.capitulos;
      }
    }
    if (!n) throw new Error('nenhum id encontrado: ' + op.limpar);
    if (op.simular) { console.log('\n--simular: nada foi apagado.'); process.exit(0); }
    const res = await gravarCatalogo(auth, catalogo);
    console.log(`\n✔ capítulos apagados em ${n} título(s)  ·  rev ${res.rev}`);
    process.exit(0);
  }

  const definidos = JSON.parse(await readFile(
    typeof op.capitulos === 'string' ? op.capitulos : CAPITULOS_PADRAO, 'utf8'));
  const escritos = definidos.titulos || {};
  /* Quem foi olhado e ficou de fora de propósito, com o motivo escrito. Sem
   * esta lista o script gritaria "faltam capítulos" nos títulos curtos toda
   * vez que rodasse, e o aviso de verdade — um título NOVO que ninguém
   * analisou — se perderia no meio do ruído. */
  const excluidos = definidos.sem_capitulos || {};

  /* Quem entra: publicado, com vídeo e com capítulo escrito em capitulos.json.
   *
   * NÃO existe corte automático por duração aqui, e é de propósito. O corte é
   * uma decisão de conteúdo, tomada vídeo a vídeo: parte dos publicados
   * ganha capítulo e o resto fica de fora com o motivo escrito em
   * `sem_capitulos`. Duração sozinha não decide — um vídeo curto que é uma
   * lista de itens ganha capítulo muito bem, e um longo de depoimentos sobre o
   * mesmo assunto pode não ganhar: qualquer corte seria arbitrário.
   * `--minimo` continua existindo para rodadas parciais.
   *
   * `--item` passa por cima de tudo, para consertar um título específico. */
  const publicados = catalogo.itens.filter((i) => i.publicar === true);
  const pedidos = typeof op.item === 'string' ? new Set(lista(op.item)) : null;
  if (pedidos) {
    const faltando = [...pedidos].filter((id) => !catalogo.itens.some((i) => i.id === id));
    if (faltando.length) throw new Error('id não encontrado no catálogo: ' + faltando.join(', '));
  }

  const alvos = [];
  const semTexto = [];
  let fora = 0;
  for (const item of publicados) {
    if (pedidos && !pedidos.has(item.id)) continue;
    if (!pedidos && (item.duracao_seg || 0) < minimo) continue;
    if (!videoDoItem(provedor, item)) continue;
    if (escritos[item.id] && Array.isArray(escritos[item.id].capitulos)) alvos.push(item);
    else if (excluidos[item.id]) fora++;
    else semTexto.push(item);
  }

  if (fora) console.log(`fora de propósito (motivo em capitulos.json > sem_capitulos): ${fora}`);
  if (semTexto.length) {
    console.log(`\nPRECISAM DE DECISÃO — sem capítulo escrito e sem motivo documentado: ${semTexto.length}`);
    semTexto.forEach((i) => console.log(`   · ${i.titulo} (${i.id})`));
    console.log('   leia com --transcricao <id>, ou escreva o motivo em sem_capitulos.\n');
  }
  if (!alvos.length) { console.log('nada a fazer.'); process.exit(0); }

  const conta = { player: 0, site: 0, iguais: 0, erros: 0 };
  let mudouCatalogo = false;

  for (const item of alvos) {
    /* A régua é a duração que o provedor mediu, não o `duracao_seg` do catálogo. */
    let video;
    try {
      video = await dadosDoItem(provedor, item);
    } catch (e) {
      conta.erros++;
      console.error(`✖  ${item.titulo}: ${e.message}`);
      continue;
    }
    if (video.estado !== 'pronto') {
      conta.erros++;
      console.error(`✖  ${item.titulo}: encoding não concluído (${video.estado})`);
      continue;
    }
    /* Provedor que não mede a duração (HLS genérico com playlist mestre): vale a do catálogo. */
    const duracao = video.duracaoSeg || item.duracao_seg;

    let capitulos;
    try {
      capitulos = fecharCapitulos(escritos[item.id].capitulos, duracao);
    } catch (e) {
      conta.erros++;
      console.error(`✖  ${item.titulo}: ${e.message}`);
      continue;
    }

    const noPlayer = !nativos || iguaisNoPlayer(capitulos, video.capitulos);
    const noSite = iguaisNoCatalogo(capitulos, item.capitulos);
    const faltaPlayer = !noPlayer && so !== 'site';
    const faltaSite = !noSite && so !== 'player';

    console.log(`${faltaPlayer || faltaSite ? '·' : '='}  ${item.titulo}` +
      `  —  ${capitulos.length} capítulos, ${paraCarimbo(duracao)}` +
      (faltaPlayer || faltaSite
        ? `  [${[faltaPlayer && 'player', faltaSite && 'ficha'].filter(Boolean).join(' + ')}]`
        : '  já gravados'));

    if (op.simular) {
      capitulos.forEach((c) => console.log(`      ${paraCarimbo(c.inicio).padStart(7)}  ${c.titulo}`));
      continue;
    }

    if (!faltaPlayer && !faltaSite) { conta.iguais++; continue; }

    if (faltaPlayer) {
      try {
        await provedor.definirCapitulos(videoDoItem(provedor, item).id, capitulos);
        conta.player++;
      } catch (e) {
        conta.erros++;
        console.error(`   ✖ player: ${e.message}`);
      }
    }
    if (faltaSite) {
      item.capitulos = paraCatalogo(capitulos);
      mudouCatalogo = true;
      conta.site++;
    }
  }

  if (op.simular) {
    console.log('\n--simular: nada foi gravado, nem no provedor nem no catálogo.');
    process.exit(0);
  }

  if (mudouCatalogo) {
    const res = await gravarCatalogo(auth, catalogo);
    console.log(`\n✔ player: ${conta.player}  ·  ficha: ${conta.site}  ·  já iguais: ${conta.iguais}  ·  rev ${res.rev}`);
  } else {
    console.log(`\n✔ player: ${conta.player}  ·  ficha: 0 (nada mudou)  ·  já iguais: ${conta.iguais}`);
  }
  if (conta.erros) console.log(`erros: ${conta.erros}`);
} catch (e) {
  erroFatal(e);
}
