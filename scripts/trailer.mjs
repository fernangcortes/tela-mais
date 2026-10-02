/* scripts/trailer.mjs — trailer (até 60 s) e clipe mudo de fundo (6 a 10 s, até 4 MB) a partir do vídeo.
 *
 *   node scripts/trailer.mjs --video arquivo.mp4 [--transcricao legenda.vtt|.srt|.txt] [--saida pasta]
 *   node scripts/trailer.mjs --item <id>[,<id>] [--catalogo arquivo.json] ...     usa o catálogo
 *   node scripts/trailer.mjs ... --simular            só diz o que faria
 *   --trechos arquivo.json     trechos escolhidos por você: [{"inicio":12.5,"fim":20,"motivo":"..."}] (não usa IA)
 *   --max 45                   duração do trailer em segundos (30 a 60; padrão 45)
 *   --so-clipe | --so-trailer
 *   --publicar                 envia o resultado ao destino e ACEITA (só use depois de assistir; veja abaixo)
 *   --destino pasta|r2         (padrão pasta)   --bucket NOME --url-base https://midia.seudominio.com   (r2)
 *   --ia                       o modelo de texto escolhe os trechos pela legenda (custa centavos; mostra a estimativa e só segue com --yes;
 *                              precisa de APP_SITE_URL e APP_SENHA para conferir o orçamento do mês). Sem --ia: amostra automática, de graça.
 *   --fila                     modo do executor (GitHub): o catálogo e o vídeo vêm do SITE, o resultado vai ao R2 (--destino r2, --bucket,
 *                              --url-base ou ia.midia.* na config) e entra como SUGESTÃO na fila da tela IA do /admin. Nada vai ao ar.
 *
 * COMO funciona: (1) o ffmpeg acha cortes de cena e silêncios; (2) os trechos vêm de, nesta ordem: o arquivo
 * --trechos, o modelo de linguagem lendo a transcrição (`--ia`; tarefa `trechos-trailer` do gerarTexto, JSON validado) ou, sem nada
 * disso, uma amostra automática espalhada pelo vídeo; (3) cada trecho é encaixado no corte de cena e no silêncio
 * mais próximos, para não começar nem terminar no meio de uma fala; (4) monta o trailer com fade nas emendas e um
 * clipe MUDO de 6 a 10 s (um plano contínuo, sem corte no meio) com poster.
 *
 * CUSTO: o ffmpeg é grátis. O modelo de linguagem (só se houver transcrição e IA ligada em /admin) cobra por token,
 * dentro do orçamento mensal de `ia.orcamentoMensalUSD` (docs/ia.md). O R2, se usar: 10 GB grátis; um clipe de ~3 MB
 * e um trailer de ~25 MB por título custam centavos por mês e a entrega não é cobrada.
 *
 * NADA SOBE SOZINHO. Sem --publicar, o resultado fica na pasta de saída e, com --item, como SUGESTÃO
 * (`item.midia_sugerida`, revisado:false). Com --publicar (a pessoa já assistiu e aprovou) os arquivos vão ao
 * destino e a sugestão vira `item.midia_gerada` (revisado:true), que o Worker põe em `item.midia.clipe` e o fundo
 * do destaque passa a tocar (`home.destaque.fundo.tipo: "video-mudo"`, `usarTrailer: true`).
 *
 * ffmpeg é ferramenta externa e opcional: roda na sua máquina ou no executor do GitHub (gerar-midia.yml), nunca no Worker.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  verificarFfmpeg, sondar, detectarCenas, detectarSilencios, validarTrechos, ajustarTrechos,
  escolherJanelaClipe, trechosAutomaticos, arred
} from './lib/ffmpeg.mjs';
import { montarTrailer, montarClipe, montarPoster, TRAILER, CLIPE } from './lib/ffmpeg-midia.mjs';
import {
  proveniencia, registrarSugestao, aceitarSugestao, conferirClipe, conferirTrailer,
  escolherDestino, chaveDeObjeto, entregarNaPasta, enviarParaR2
} from './lib/midia-gerada.mjs';

/** Esquema JSON da resposta do modelo (o schema da tarefa `trechos-trailer` do gerarTexto, de core/worker/_lib/ia/tarefas.js, é o que vale; este é o formato esperado aqui). */
export const ESQUEMA_TRECHOS = Object.freeze({
  type: 'object',
  properties: {
    trechos: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object',
        properties: { inicio: { type: 'number', minimum: 0 }, fim: { type: 'number', minimum: 0 }, motivo: { type: 'string', maxLength: 200 } },
        required: ['inicio', 'fim', 'motivo']
      }
    }
  },
  required: ['trechos']
});

/**
 * `escolherTrechos` padrão: o `gerarTexto` do M9 (tarefa `trechos-trailer`, JSON validado, 1 retentativa, INSUFICIENTE),
 * com o orçamento do mês conferido (scripts/lib/ia-trechos.mjs). `opcoes`: { config, env, fetch, orcamento, titulo, serie, blocos }.
 * Sem `config` (ou com a IA desligada) devolve `null`: o trailer usa a amostra automática.
 */
export async function escolherTrechosPadrao(opcoes = {}) {
  if (!opcoes.config) return null;
  const { criarEscolhedorDeTrechos } = await import('./lib/ia-trechos.mjs');
  return criarEscolhedorDeTrechos({ env: process.env, ...opcoes });
}

/** O que `escolherTrechos` pode devolver -> lista bruta ou `null` (INSUFICIENTE, vazio, formato errado). */
export function lerRespostaDeTrechos(resp) {
  if (resp == null) return null;
  const r = (typeof resp === 'object' && resp.resultado !== undefined) ? resp.resultado : (typeof resp === 'object' && resp.dados !== undefined ? resp.dados : resp);
  if (r === 'INSUFICIENTE' || (r && (r.insuficiente === true || r.status === 'INSUFICIENTE'))) return null;
  const lista = Array.isArray(r) ? r : (r && Array.isArray(r.trechos) ? r.trechos : null);
  return lista && lista.length ? lista : null;
}

/**
 * O pipeline todo. Devolve:
 *   { trailer:{arquivo, poster, duracao, bytes, trechos}|null, clipe:{arquivo, poster, duracao, bytes, janela}|null,
 *     origemTrechos:'manual'|'ia'|'automatica', modelo, avisos[], duracao }
 * Nada vai a rede aqui (a escolha pelo modelo é a função injetada). `saida` é a pasta do título.
 */
export async function gerarTrailerEClipe({
  video, saida, transcricao = '', escolherTrechos = null, trechosManuais = null,
  maxSeg = TRAILER.padraoSeg, soClipe = false, soTrailer = false, aoProgredir = () => {}
}) {
  const ff = await verificarFfmpeg();
  if (!ff.ok) throw Object.assign(new Error(ff.motivo), { codigo: 'sem-ffmpeg' });
  const avisos = [];
  const info = await sondar(video);
  const alvo = Math.min(TRAILER.maxSeg, Math.max(TRAILER.minSeg, Number(maxSeg) || TRAILER.padraoSeg));
  await mkdir(saida, { recursive: true });

  aoProgredir('procurando cortes de cena');
  const cenas = await detectarCenas(video);
  aoProgredir(info.temAudio ? 'procurando pausas na fala' : 'vídeo sem áudio: sem pausas para procurar');
  const silencios = info.temAudio ? await detectarSilencios(video, { duracao: info.duracao }) : [];

  /* 1. de onde vêm os trechos */
  let bruto = null; let origemTrechos = 'automatica'; let modelo = null;
  if (Array.isArray(trechosManuais) && trechosManuais.length) { bruto = trechosManuais; origemTrechos = 'manual'; }
  else if (typeof escolherTrechos === 'function' && String(transcricao).trim()) {
    aoProgredir('pedindo ao modelo os trechos pela transcrição');
    let resp = null;
    try { resp = await escolherTrechos(transcricao, { duracao: info.duracao, alvoSeg: alvo }); } catch (e) { avisos.push('o modelo não respondeu (' + String(e.message).slice(0, 120) + '); usei a amostra automática'); }
    bruto = lerRespostaDeTrechos(resp);
    if (bruto) { origemTrechos = 'ia'; modelo = (resp && resp.modelo) || null; }
    else if (!avisos.length) avisos.push('a transcrição não sustenta uma escolha (INSUFICIENTE); usei a amostra automática');
  } else if (typeof escolherTrechos === 'function') avisos.push('sem transcrição: usei a amostra automática (gere a transcrição antes para o modelo escolher)');
  if (!bruto) bruto = trechosAutomaticos({ duracao: info.duracao });

  /* 2. validar e encaixar nos cortes reais */
  const { trechos: validos, descartados } = validarTrechos(bruto, info.duracao);
  if (descartados.length) avisos.push(`${descartados.length} trecho(s) fora do vídeo ou curtos demais foram descartados`);
  let trechos = ajustarTrechos(validos, { cenas, silencios, duracao: info.duracao, maxTotal: alvo });
  if (!trechos.length && origemTrechos !== 'automatica') {
    avisos.push('nenhum trecho utilizável; usei a amostra automática'); origemTrechos = 'automatica'; modelo = null;
    trechos = ajustarTrechos(validarTrechos(trechosAutomaticos({ duracao: info.duracao }), info.duracao).trechos, { cenas, silencios, duracao: info.duracao, maxTotal: alvo });
  }
  if (!trechos.length) throw new Error('o vídeo é curto demais para um trailer');

  let trailer = null; let clipe = null;
  const total = trechos.reduce((s, t) => s + (t.fim - t.inicio), 0);
  if (!soClipe) {
    if (total < TRAILER.minSeg) avisos.push(`o trailer ficou com ${arred(total, 1)} s, abaixo de ${TRAILER.minSeg} s (vídeo curto ou poucos trechos bons)`);
    aoProgredir(`montando o trailer (${trechos.length} trechos, ${arred(total, 1)} s)`);
    const arq = path.join(saida, 'trailer.mp4');
    const r = await montarTrailer(video, arq, trechos, { temAudio: info.temAudio });
    const poster = path.join(saida, 'trailer-poster.jpg');
    await montarPoster(arq, poster, r.duracao * 0.3);
    const problemas = conferirTrailer({ duracao: r.duracao, trechos });
    if (problemas.length) throw new Error('trailer fora do limite: ' + problemas.join('; '));
    trailer = { arquivo: arq, poster, duracao: r.duracao, bytes: r.bytes, trechos };
  }
  if (!soTrailer) {
    const janela = escolherJanelaClipe({ trechos, cenas, duracao: info.duracao });
    if (!janela) avisos.push('vídeo curto demais para um clipe de ' + CLIPE.minSeg + ' s');
    else {
      if (janela.corteNoMeio) avisos.push('não achei um plano contínuo de ' + CLIPE.minSeg + ' s: o clipe tem um corte de cena no meio');
      aoProgredir(`montando o clipe mudo (${arred(janela.fim - janela.inicio, 1)} s)`);
      const arq = path.join(saida, 'clipe.mp4');
      const r = await montarClipe(video, arq, janela);
      const poster = path.join(saida, 'clipe-poster.jpg');
      await montarPoster(arq, poster, r.duracao / 2);
      const sonda = await sondar(arq);
      const problemas = conferirClipe({ duracao: sonda.duracao, bytes: r.bytes, temAudio: sonda.temAudio });
      if (problemas.length) throw new Error('clipe fora do limite: ' + problemas.join('; '));
      clipe = { arquivo: arq, poster, duracao: sonda.duracao, bytes: r.bytes, janela: { inicio: janela.inicio, fim: janela.fim } };
    }
  }
  return { trailer, clipe, origemTrechos, modelo, avisos, duracao: info.duracao };
}

/**
 * Entrega os arquivos ao destino e devolve as URLs (ou caminhos, no destino 'pasta'). `executarFn` e `copiar` são
 * injetáveis para teste. O poster do clipe vai junto, com o mesmo destino.
 */
export async function entregar({ id, resultado, destino = 'pasta', pastaSaida, bucket, urlBase, executarFn, raiz }) {
  const d = escolherDestino({ destino });
  const urls = {};
  const lista = [];
  if (resultado.clipe) lista.push(['clipe', resultado.clipe.arquivo, 'clipe.mp4'], ['clipePoster', resultado.clipe.poster, 'clipe-poster.jpg']);
  if (resultado.trailer) lista.push(['trailer', resultado.trailer.arquivo, 'trailer.mp4'], ['trailerPoster', resultado.trailer.poster, 'trailer-poster.jpg']);
  for (const [campo, arquivo, nome] of lista) {
    if (d === 'r2') urls[campo] = (await enviarParaR2({ bucket, chave: chaveDeObjeto(id, nome), arquivo, urlBase, executarFn })).url;
    else urls[campo] = await entregarNaPasta(arquivo, pastaSaida, `${id}-${nome}`, { raiz });
  }
  return { destino: d, urls };
}

/* ---------- linha de comando ---------- */

async function principal() {
  const { argumentos, lerCatalogo, gravarCatalogo, selecionar, CATALOGO_PADRAO, RAIZ, erroFatal } = await import('./lib/catalogo.mjs');
  const op = argumentos();
  try {
    const saida = path.resolve(typeof op.saida === 'string' ? op.saida : path.join(RAIZ, 'dados', 'midia-gerada'));
    const manuais = typeof op.trechos === 'string' ? JSON.parse(await readFile(op.trechos, 'utf8')) : null;
    const lista = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

    /* o site só entra quando é preciso: o modo --fila (catálogo e fila no site) ou --ia (orçamento do mês) */
    let config = null; let cliente = null; let provedor = null;
    if (op.fila || op.ia) {
      const { carregarConfig } = await import('./lib/config-carregar.mjs');
      const { entrar } = await import('./lib/ia-cliente.mjs');
      const lida = await carregarConfig({ arquivo: process.env.APP_CONFIG });
      if (!lida.ok) throw new Error('config/site.json inválida: rode `npm run config:validar`');
      config = lida.config;
      const site = typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL;
      if (site || op.fila) cliente = await entrar({ site, senha: process.env.APP_SENHA || process.env.ADMIN_PASSWORD });
    }
    const midiaCfg = (config && config.ia && config.ia.midia) || {};
    const destino = typeof op.destino === 'string' ? op.destino : (op.fila ? (midiaCfg.destino || 'pasta') : undefined);
    const bucket = typeof op.bucket === 'string' ? op.bucket : midiaCfg.bucket;
    const urlBase = typeof op['url-base'] === 'string' ? op['url-base'] : midiaCfg.urlBase;
    if (op.fila && destino !== 'r2') throw new Error('no modo --fila o arquivo precisa ir para o R2 (--destino r2 --bucket NOME --url-base https://..., ou ia.midia.* em config/site.json): a sugestão da fila aponta para um endereço https.');

    let catalogo = null; const caminhoCat = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
    let alvos;
    if (op.fila) {
      const ids = lista(op.item);
      if (!ids.length) throw new Error('no modo --fila diga os títulos: --item id1,id2');
      const { provedorDoAmbiente } = await import('./lib/provedores/index.mjs');
      ({ provedor } = await provedorDoAmbiente());
      const { alvosDaFila } = await import('./lib/ia-midia-fila.mjs');
      const r = await alvosDaFila({ cliente, provedor, config, ids, comTranscricao: !!op.ia, idioma: (config.idiomas && config.idiomas.padrao ? String(config.idiomas.padrao).split('-')[0] : 'pt') });
      for (const p of r.pulados) console.log(`${p.id}: pulado (${p.motivo})`);
      alvos = r.alvos;
    } else if (op.item) {
      catalogo = await lerCatalogo(caminhoCat);
      alvos = selecionar(catalogo.itens, op).map((i) => ({ id: i.id, titulo: i.titulo, serie: i.serie || '', video: path.resolve(RAIZ, i.caminho_local || ''), transcricao: typeof op.transcricao === 'string' ? op.transcricao : i.legenda_local }));
    } else if (typeof op.video === 'string') {
      alvos = [{ id: path.basename(op.video, path.extname(op.video)), titulo: '', video: path.resolve(op.video), transcricao: typeof op.transcricao === 'string' ? op.transcricao : null }];
    } else { console.error('Diga o vídeo: --video arquivo.mp4  ou  --item <id>. Veja o cabeçalho deste arquivo.'); process.exit(2); }
    if (!alvos.length) { console.error('nenhum título com vídeo para cortar.'); process.exit(1); }

    /* IA: o custo vem ANTES (estimativa, orçamento, --yes). Sem --ia, ou com --trechos, não há IA e não há custo. */
    let escolherPara = null;
    if (op.ia && !manuais) {
      const { prepararEscolhedor } = await import('./lib/ia-trechos.mjs');
      const p = await prepararEscolhedor({ opcoes: op, cliente, config, env: process.env, ids: alvos.map((a) => a.id) });
      if (p.codigo !== undefined && !(op.simular && p.codigo === 0)) { console.error('\n' + p.resumo); process.exit(p.codigo); }
      escolherPara = p.escolherPara || null;
    }

    if (op.simular) {
      for (const a of alvos) console.log(`geraria trailer (até ${op.max || TRAILER.padraoSeg} s) e clipe mudo (${CLIPE.minSeg} a ${CLIPE.maxSeg} s, até 4 MB) de "${a.titulo || a.id}" em ${path.join(saida, a.id)}. Custo: ffmpeg grátis${op.ia ? '; o modelo de linguagem lê a legenda (conta no orçamento de IA, estimativa acima)' : ''}.`);
      return;
    }
    if (op.publicar && !destino) { console.error('--publicar pede --destino pasta|r2 (e, no r2, --bucket e --url-base).'); process.exit(2); }

    for (const a of alvos) {
      console.log('\n' + a.id);
      let transcricao = a.transcricao || '';
      if (!op.fila && a.transcricao) { try { transcricao = await readFile(path.resolve(RAIZ, a.transcricao), 'utf8'); } catch { transcricao = ''; } }
      const r = await gerarTrailerEClipe({
        video: a.video, saida: path.join(saida, a.id), transcricao,
        escolherTrechos: escolherPara ? escolherPara({ titulo: a.titulo, serie: a.serie, blocos: a.blocos }) : null, trechosManuais: manuais,
        maxSeg: Number(op.max) || TRAILER.padraoSeg, soClipe: !!op['so-clipe'], soTrailer: !!op['so-trailer'], aoProgredir: (m) => console.log('  ' + m)
      });
      for (const av of r.avisos) console.log('  aviso: ' + av);
      if (r.trailer) console.log(`  trailer: ${r.trailer.arquivo} (${r.trailer.duracao} s, ${(r.trailer.bytes / 1048576).toFixed(1)} MB)`);
      if (r.clipe) console.log(`  clipe:   ${r.clipe.arquivo} (${r.clipe.duracao} s, ${(r.clipe.bytes / 1048576).toFixed(2)} MB, mudo)`);

      if (op.fila) {
        /* envia ao R2 e coloca na fila do /admin; só uma pessoa, ali, faz o clipe virar fundo do destaque */
        const e = await entregar({ id: a.id, resultado: r, destino, bucket, urlBase, raiz: RAIZ });
        const { sugerirNaFila } = await import('./lib/ia-midia-fila.mjs');
        for (const x of await sugerirNaFila({ cliente, itemId: a.id, resultado: r, urls: e.urls })) console.log(x.ok ? `  sugestão na fila: ${x.campo}` : `  ✖ a fila recusou ${x.campo} (${x.codigo})`);
      } else if (catalogo) {
        const i = catalogo.itens.findIndex((x) => x.id === a.id);
        const prov = proveniencia({ origem: r.origemTrechos === 'ia' ? 'ia' : 'automatica', modelo: r.modelo });
        if (r.clipe) catalogo.itens[i] = registrarSugestao(catalogo.itens[i], 'clipe', { arquivo: r.clipe.arquivo, poster: r.clipe.poster, duracao: r.clipe.duracao, bytes: r.clipe.bytes, janela: r.clipe.janela }, prov);
        if (r.trailer) catalogo.itens[i] = registrarSugestao(catalogo.itens[i], 'trailer', { arquivo: r.trailer.arquivo, poster: r.trailer.poster, duracao: r.trailer.duracao, bytes: r.trailer.bytes, trechos: r.trailer.trechos }, prov);
        if (op.publicar) {
          const e = await entregar({ id: a.id, resultado: r, destino, pastaSaida: path.join(saida, 'publicado'), bucket, urlBase, raiz: RAIZ });
          if (e.destino === 'pasta') console.log('  arquivos copiados para a pasta; publique-os num endereço https e rode de novo com --destino r2, ou registre o endereço à mão em item.midia_gerada.');
          else {
            if (r.clipe) catalogo.itens[i] = aceitarSugestao(catalogo.itens[i], 'clipe', { clipe: e.urls.clipe, clipePoster: e.urls.clipePoster });
            if (r.trailer) catalogo.itens[i] = aceitarSugestao(catalogo.itens[i], 'trailer', { trailer: e.urls.trailer, trailerPoster: e.urls.trailerPoster });
            console.log('  publicado no R2 e aceito: ' + Object.values(e.urls).join(', '));
          }
        }
      }
    }
    if (op.fila) console.log('\nPronto. Nada foi publicado: assista e aceite na tela IA do /admin.');
    else if (catalogo) { await gravarCatalogo(catalogo, caminhoCat); console.log('\nCatálogo atualizado.' + (op.publicar ? '' : ' Sugestões com revisado:false; nada foi publicado.')); }
  } catch (e) { erroFatal(e); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
