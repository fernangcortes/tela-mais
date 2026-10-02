/* scripts/capas-legendas.mjs — Tasks 3.1 e 3.2: enviar capas e legendas.
 *
 *   node scripts/capas-legendas.mjs --piloto        só o lote-piloto
 *   node scripts/capas-legendas.mjs                 tudo que já tem videoId
 *   node scripts/capas-legendas.mjs --so capas      só as capas
 *   node scripts/capas-legendas.mjs --so legendas   só as legendas
 *
 * As capas estão ao lado de cada master (`*_CAPA.jpg`) e as 8 legendas
 * existentes, também (`*.srt`). Os caminhos já vêm no catálogo, em
 * `capa_local` e `legenda_local`.
 *
 * Reenviar é inofensivo: o provedor sobrescreve. O script marca o que enviou em
 * `midia_enviada` para você saber o que já passou.
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { argumentos, lerCatalogo, gravarCatalogo, selecionar, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';
import { videoDoItem, exigirCapacidade, exigirConfigurado, provedorDoAmbiente } from './lib/provedores/index.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const so = typeof op.so === 'string' ? op.so : '';

const existe = async (p) => { try { await access(p); return true; } catch { return false; } };

/* Os .srt gerados por legendas-assembly.mjs ficam ao lado do master e nao passam
 * por legenda_local. Sem este fallback o script ignoraria 40 legendas novas. */
function caminhoLegenda(item) {
  if (item.legenda_local) return item.legenda_local;
  const ext = path.extname(item.caminho_local);
  return item.caminho_local.slice(0, -ext.length) + '.srt';
}

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  /* Enviar capa e legenda por arquivo é capacidade do provedor (o HLS genérico guarda o ENDEREÇO delas no item). */
  if (so !== 'legendas') exigirCapacidade(provedor, 'capaPorUpload', 'enviar capas');
  if (so !== 'capas') exigirCapacidade(provedor, 'legendaPorUpload', 'enviar legendas');
  const alvos = selecionar(catalogo.itens, op).filter(i => videoDoItem(provedor, i));

  if (!alvos.length) {
    console.log('nenhum título com vídeo no provedor. Rode scripts/upload.mjs antes.');
    process.exit(0);
  }

  const idDe = (item) => videoDoItem(provedor, item).id;
  const conta = { capas: 0, legendas: 0, semCapa: 0, semLegenda: 0, mantidas: 0, erros: 0 };

  for (const item of alvos) {
    const marcas = item.midia_enviada || (item.midia_enviada = {});

    if (so !== 'legendas') {
      if (item.capa_arquivo) {
        /* Capa escolhida pela tela de admin: reenviar o quadro automatico
         * desfaria a escolha de quem curou. */
        conta.mantidas++;
        console.log(`${agora()}  capa     ·  ${item.titulo}: mantida (escolhida pela tela)`);
      } else if (item.capa_local && await existe(item.capa_local)) {
        try {
          /* O arquivo local vai ao provedor; se ele devolve outro nome (hash), o catálogo passa a guardá-lo. */
          const troca = await provedor.definirCapa(idDe(item), await readFile(item.capa_local), 'image/jpeg');
          if (troca.arquivo) { item.capa_arquivo = troca.arquivo; item.capa_versao = troca.versao || String(Date.now()); }
          marcas.capa = new Date().toISOString();
          conta.capas++;
          console.log(`${agora()}  capa     ✔  ${item.titulo}`);
        } catch (e) {
          conta.erros++;
          console.error(`${agora()}  capa     ✖  ${item.titulo}: ${e.message}`);
        }
      } else {
        conta.semCapa++;
      }
    }

    if (so !== 'capas') {
      const srt = caminhoLegenda(item);
      if (srt && await existe(srt)) {
        try {
          const conteudo = await readFile(srt, 'utf8');
          await provedor.enviarLegenda(idDe(item), { idioma: 'pt', rotulo: 'Português', srt: conteudo }); /* i18n-ignorar: rótulo da faixa de legenda (dado: a língua da fala) */
          marcas.legenda = new Date().toISOString();
          conta.legendas++;
          console.log(`${agora()}  legenda  ✔  ${item.titulo}`);
        } catch (e) {
          conta.erros++;
          console.error(`${agora()}  legenda  ✖  ${item.titulo}: ${e.message}`);
        }
      } else {
        conta.semLegenda++;
      }
    }
  }

  await gravarCatalogo(catalogo, caminhoCatalogo);

  console.log(`\ncapas enviadas: ${conta.capas}  ·  mantidas (escolhidas pela tela): ${conta.mantidas}  ·  sem arquivo: ${conta.semCapa}`);
  console.log(`legendas enviadas: ${conta.legendas}  (sem arquivo: ${conta.semLegenda})`);
  if (conta.erros) console.log(`erros: ${conta.erros}`);
  if (conta.semLegenda) {
    console.log('\nas legendas que faltam saem da Task 3.3 (Whisper) — veja scripts/legendas-whisper.ps1');
  }
} catch (e) {
  erroFatal(e);
}
