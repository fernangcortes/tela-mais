/* scripts/status.mjs — Task 2.4: conferir o encoding antes de publicar.
 *
 *   node scripts/status.mjs                 lista o status de tudo que subiu
 *   node scripts/status.mjs --piloto        só o lote-piloto
 *   node scripts/status.mjs --esperar       fica repetindo até tudo ficar pronto
 *
 * Armadilha conhecida: um vídeo ainda em fila embeda e não toca — parece bug
 * do site. Só marque `publicar: true` depois que este script disser "pronto".
 */
import { criarCliente, STATUS } from './lib/bunny.mjs';
import { argumentos, lerCatalogo, selecionar, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

const espera = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const comVideo = selecionar(catalogo.itens, op).filter(i => i.fonte && i.fonte.videoId);

  if (!comVideo.length) {
    console.log('nenhum título com videoId ainda. Rode scripts/upload.mjs antes.');
    process.exit(0);
  }

  const bunny = criarCliente();

  for (;;) {
    const contagem = { pronto: 0, processando: 0, falhou: 0 };
    console.log(`\n${agora()}  ${comVideo.length} títulos\n`);

    for (const item of comVideo) {
      let v;
      try {
        v = await bunny.consultar(item.fonte.videoId);
      } catch (e) {
        console.log(`  ?    ${item.titulo}  —  ${e.message}`);
        contagem.falhou++;
        continue;
      }

      const nome = STATUS[v.status] || ('status ' + v.status);
      const marca = v.status === 4 ? '✔' : v.status === 5 || v.status === 7 ? '✖' : '·';
      const progresso = v.status === 4 ? '' : `  ${v.encodeProgress ?? 0}%`;
      console.log(`  ${marca}  ${nome.padEnd(12)} ${item.titulo}${progresso}`);

      if (v.status === 4) contagem.pronto++;
      else if (v.status === 5 || v.status === 7) contagem.falhou++;
      else contagem.processando++;
    }

    console.log(`\n  prontos ${contagem.pronto}  ·  processando ${contagem.processando}  ·  com falha ${contagem.falhou}`);

    if (!op.esperar || contagem.processando === 0) break;
    console.log('  aguardando 60 s…');
    await espera(60000);
  }
} catch (e) {
  erroFatal(e);
}
