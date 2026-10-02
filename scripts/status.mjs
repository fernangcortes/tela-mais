/* scripts/status.mjs — Task 2.4: conferir o encoding antes de publicar.
 *
 *   node scripts/status.mjs                 lista o status de tudo que subiu
 *   node scripts/status.mjs --piloto        só o lote-piloto
 *   node scripts/status.mjs --esperar       fica repetindo até tudo ficar pronto
 *
 * Armadilha conhecida: um vídeo ainda em fila embeda e não toca — parece bug
 * do site. Só marque `publicar: true` depois que este script disser "pronto".
 */
import { argumentos, lerCatalogo, selecionar, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';
import { videoDoItem, statusDoItem, exigirConfigurado, provedorDoAmbiente } from './lib/provedores/index.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

const espera = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  const comVideo = selecionar(catalogo.itens, op).filter(i => videoDoItem(provedor, i));

  if (!comVideo.length) {
    console.log('nenhum título com vídeo no provedor ainda. Rode scripts/upload.mjs (ou cadastre os endereços) antes.');
    process.exit(0);
  }

  /* O estado vem NORMALIZADO pelo adaptador ('enviando' | 'processando' | 'pronto' | 'erro'): a tabela numérica de
   * cada provedor mora no adaptador. `estadoBruto` é o valor do provedor, só para diagnóstico. */
  const NOMES = { enviando: 'enviando', processando: 'processando', pronto: 'pronto', erro: 'FALHOU' };

  for (;;) {
    const contagem = { pronto: 0, processando: 0, falhou: 0 };
    console.log(`\n${agora()}  ${comVideo.length} títulos\n`);

    for (const item of comVideo) {
      let v;
      try {
        v = await statusDoItem(provedor, item);
      } catch (e) {
        console.log(`  ?    ${item.titulo}  —  ${e.message}`);
        contagem.falhou++;
        continue;
      }

      const marca = v.estado === 'pronto' ? '✔' : v.estado === 'erro' ? '✖' : '·';
      const progresso = v.estado === 'pronto' ? '' : `  ${v.progresso ?? 0}%`;
      console.log(`  ${marca}  ${(NOMES[v.estado] || v.estado).padEnd(12)} ${item.titulo}${progresso}`);

      if (v.estado === 'pronto') contagem.pronto++;
      else if (v.estado === 'erro') contagem.falhou++;
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
