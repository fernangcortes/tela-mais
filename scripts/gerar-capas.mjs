/* scripts/gerar-capas.mjs — tira uma capa de dentro do próprio vídeo, para os
 * títulos que chegaram sem `*_CAPA.jpg` ao lado do master.
 *
 *   node scripts/gerar-capas.mjs --simular            mostra o plano
 *   node scripts/gerar-capas.mjs                      gera as que faltam
 *   node scripts/gerar-capas.mjs --item <id>[,<id>]   títulos específicos
 *   node scripts/gerar-capas.mjs --refazer            regera até as existentes
 *   node scripts/gerar-capas.mjs --em 0.4             muda o ponto do corte
 *
 * POR QUE existe: nem todo lote chega com capa escolhida a mão ao lado de cada
 * master. Sem capa enviada, o Bunny serve o `thumbnail.jpg` que ele mesmo
 * escolhe — e a escolha dele cai com frequência em quadro preto, transição ou
 * cartela de abertura.
 *
 * COMO escolhe o quadro: em vez de cortar num instante fixo, abre uma janela de
 * 20 s a 30% do vídeo e deixa o filtro `thumbnail` do ffmpeg eleger, dentro
 * dela, o quadro mais representativo — é o que evita o preto entre planos. Os
 * 30% ficam depois da vinheta de abertura e antes do encerramento.
 *
 * O arquivo sai ao lado do master, como `<nome>_CAPA.jpg`, que é onde
 * `capa_local` aponta e onde capas-legendas.mjs procura. Depois de rodar este
 * script:
 *
 *   node scripts/capas-legendas.mjs --so capas    envia ao Bunny
 *   node scripts/sincronizar-capas.mjs            grava o nome com hash
 */
import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  argumentos, lerCatalogo, gravarCatalogo, selecionar,
  CATALOGO_PADRAO, agora, erroFatal
} from './lib/catalogo.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

/* 30% do vídeo: depois da vinheta, antes do encerramento. */
const EM = Number(op.em) > 0 && Number(op.em) < 1 ? Number(op.em) : 0.30;
/* Janela que o filtro `thumbnail` examina para eleger o quadro. */
const JANELA_S = 20;

const existe = async (p) => { try { await access(p); return true; } catch { return false; } };

export function caminhoCapa(item) {
  if (item.capa_local) return item.capa_local;
  const ext = path.extname(item.caminho_local);
  return item.caminho_local.slice(0, -ext.length) + '_CAPA.jpg';
}

/* A capa entra numa grade de cartões, não numa tela cheia: 1280 no lado maior
 * chega a ~150 KB e é o que as capas do lote antigo já custavam. Preservar a
 * proporção importa porque nem tudo aqui é 16:9 — o corte vertical do Enem é
 * 1080x1920, e forçá-lo a deitado deixaria tarja preta gravada na capa. */
const ESCALA = "scale='if(gt(a,1),1280,-2)':'if(gt(a,1),-2,720)'";

function extrair(entrada, saida, inicio) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-v', 'error',
      /* -ss antes do -i busca por keyframe: é o que torna viável abrir um
       * arquivo de 1,8 GB no meio sem decodificar tudo que veio antes. */
      '-ss', String(Math.round(inicio)),
      '-i', entrada,
      '-t', String(JANELA_S),
      '-vf', `thumbnail=${JANELA_S * 5},${ESCALA}`,
      '-frames:v', '1',
      '-q:v', '4',
      saida
    ]);
    let erro = '';
    ff.stderr.on('data', d => { erro += d; });
    ff.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${erro.slice(0, 300)}`)));
  });
}

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);

  const alvos = [];
  for (const item of selecionar(catalogo.itens, op)) {
    if (!item.caminho_local) continue;
    if (!(await existe(item.caminho_local))) continue;

    /* Capa escolhida pela tela de admin manda: regerar por cima desfaria a
     * curadoria de quem olhou o vídeo. Mesma regra de capas-legendas.mjs. */
    if (item.capa_arquivo && !op.refazer) continue;

    const capa = caminhoCapa(item);
    if (await existe(capa) && !op.refazer) continue;

    alvos.push({ item, capa });
  }

  if (!alvos.length) {
    console.log('nada a fazer: todos os títulos já têm capa ao lado do master.');
    process.exit(0);
  }

  console.log(`capas a gerar: ${alvos.length}  ·  corte a ${(EM * 100).toFixed(0)}% de cada vídeo\n`);
  for (const { item } of alvos) console.log(`  ${item.duracao}  ${item.titulo}`);

  if (op.simular) {
    console.log('\n--simular: nada foi gerado.');
    process.exit(0);
  }
  console.log('');

  let feitas = 0, erros = 0;
  for (const { item, capa } of alvos) {
    const inicio = Math.max(0, (item.duracao_seg || 0) * EM);
    try {
      await extrair(item.caminho_local, capa, inicio);
      const { size } = await stat(capa);
      item.capa_local = capa;
      feitas++;
      console.log(`${agora()}  ✔  ${item.titulo}  (${(size / 1024).toFixed(0)} KB, aos ${Math.round(inicio)}s)`);
    } catch (e) {
      erros++;
      console.error(`${agora()}  ✖  ${item.titulo}: ${e.message}`);
    }
  }

  await gravarCatalogo(catalogo, caminhoCatalogo);

  console.log(`\ngeradas: ${feitas}${erros ? `  ·  erros: ${erros}` : ''}`);
  console.log('\npróximo passo: node scripts/capas-legendas.mjs --so capas');
  console.log('               node scripts/sincronizar-capas.mjs');
} catch (e) {
  erroFatal(e);
}
