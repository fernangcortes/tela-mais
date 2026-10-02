/* scripts/upload.mjs — Tasks 2.1, 2.2, 2.3 e 2.5: carga em lote no provedor de vídeo
 * (o de `video.provedor` em config/site.json, pelo adaptador de scripts/lib/provedores).
 *
 *   node scripts/upload.mjs --piloto            os 6 títulos do lote-piloto
 *   node scripts/upload.mjs                     todos os que ainda não subiram
 *   node scripts/upload.mjs --item <id>[,<id>]  títulos específicos
 *   node scripts/upload.mjs --piloto --simular  não envia nada, só mostra o plano
 *
 *   --catalogo <p>   usa outro JSON (padrão: exemplo/catalogo.json na raiz do projeto)
 *
 * O envio é TUS (resumível) para todo arquivo, pelo PLANO que o adaptador devolve
 * (criarUpload/retomarUpload): a mesma via da mesa de curadoria.
 *
 * IDEMPOTENTE: se o item já tem fonte (id do vídeo no provedor), é pulado. Rodar duas vezes não
 * duplica nada — é seguro interromper com Ctrl+C e recomeçar.
 */
import { stat } from 'node:fs/promises';
import { idDoVideo, provedorDoAmbiente, exigirConfigurado, enviarArquivo } from './lib/provedores/index.mjs';
import {
  argumentos, lerCatalogo, gravarFontes, selecionar,
  CATALOGO_PADRAO, mb, barra, agora, erroFatal
} from './lib/catalogo.mjs';

/* O plano de upload vale 24 h: um lote grande não pode perder a assinatura no meio. */
const VALIDADE_PLANO_S = 24 * 3600;

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const escolhidos = selecionar(catalogo.itens, op).filter(i => {
    /* Cartelas e sobras nao viram titulo do catalogo: subir e pagar
     * armazenamento por algo que nunca sera publicado.
     *
     * Duplicata reconhecida ANTES do upload entra na mesma regra. As
     * `versao_duplicada` identificadas so depois de subir ja tem videoId — para
     * elas este filtro nao muda nada. Ele existe para as que chegam ja sabidas,
     * identicas em duracao e tamanho ao que ja esta no ar. */
    if (i.pendencia === 'nao_e_conteudo' || i.pendencia === 'versao_duplicada') {
      const motivo = i.pendencia === 'nao_e_conteudo' ? 'nao e conteudo' : 'versao duplicada';
      console.log(`  · pulando (${motivo}): ${i.titulo}`);
      return false;
    }
    return true;
  });
  const pendentes = escolhidos.filter(i => !idDoVideo(i));
  const jaFeitos = escolhidos.length - pendentes.length;

  console.log(`catálogo: ${caminhoCatalogo}`);
  console.log(`selecionados: ${escolhidos.length}  ·  já enviados: ${jaFeitos}  ·  a enviar: ${pendentes.length}\n`);

  if (!pendentes.length) {
    console.log('nada a fazer.');
    process.exit(0);
  }

  /* Confere que os arquivos existem ANTES de criar qualquer vídeo no Bunny:
   * criar 50 vídeos vazios porque o F: não estava montado é um estrago chato. */
  const planos = [];
  for (const item of pendentes) {
    let tamanho;
    try {
      tamanho = (await stat(item.caminho_local)).size;
    } catch {
      throw new Error(
        `arquivo não encontrado: ${item.caminho_local}\n` +
        '  (o HD externo F: está conectado?)'
      );
    }
    planos.push({ item, tamanho });
  }

  /* Menores primeiro: quem esta esperando para testar ganha varios titulos
   * nos primeiros minutos, em vez de ficar preso num arquivo de 3 GB. */
  planos.sort((a, b) => a.tamanho - b.tamanho);

  const total = planos.reduce((s, p) => s + p.tamanho, 0);
  for (const p of planos) {
    console.log(`  TUS  ${mb(p.tamanho).padStart(8)}  ${p.item.arquivo}`);
  }
  console.log(`\ntotal: ${mb(total)}\n`);

  if (op.simular) {
    console.log('--simular: nada foi enviado.');
    process.exit(0);
  }

  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  if (!provedor.capacidades().envio) {
    throw new Error('o provedor "' + provedor.id + '" não recebe arquivo por aqui.' +
      (provedor.capacidades().fontePorUrl ? ' Os vídeos já estão no seu servidor: cadastre os endereços com scripts/cadastrar-hls.mjs ou pelo /admin.' : ' Envie pelo painel dele e informe o id no catálogo.'));
  }
  let enviados = 0;

  for (const { item, tamanho } of planos) {
    const rotulo = `[${enviados + 1}/${planos.length}] ${item.titulo}`;
    console.log(`${agora()}  ${rotulo}`);

    try {
      /* Cria e grava a fonte ANTES de mandar os bytes. Se o envio cair, o id
       * já está no JSON e a retomada não cria um vídeo órfão no painel. */
      let plano;
      if (!idDoVideo(item)) {
        plano = await provedor.criarUpload({ titulo: item.titulo, tamanhoBytes: tamanho, validadeSeg: VALIDADE_PLANO_S });
        item.fonte = plano.fonte;
        await gravarFontes(catalogo.itens, caminhoCatalogo);
        console.log(`         id ${plano.id}`);
      } else {
        plano = await provedor.retomarUpload(idDoVideo(item), { validadeSeg: VALIDADE_PLANO_S, tamanhoBytes: tamanho });
      }

      let ultimo = 0;
      await enviarArquivo(plano, item.caminho_local, {
        aoProgredir(feito, tot) {
          if (feito - ultimo < 50 * 1024 * 1024 && feito !== tot) return;
          ultimo = feito;
          process.stdout.write('\r         ' + barra(feito, tot) + '  ' + mb(feito));
        }
      });
      process.stdout.write('\n');

      enviados++;
      console.log(`         enviado (${mb(tamanho)})\n`);
    } catch (e) {
      console.error(`         ✖ falhou: ${e.message}`);
      console.error('         o id do vídeo ficou gravado; rode de novo para retomar este título.\n');
    }
  }

  await gravarFontes(catalogo.itens, caminhoCatalogo);

  const comId = catalogo.itens.filter(i => idDoVideo(i)).length;
  console.log(`\nconcluído: ${enviados} de ${planos.length} nesta rodada.`);
  console.log(`catálogo agora tem ${comId} de ${catalogo.itens.length} títulos com videoId.`);
  console.log('\npróximo passo: node scripts/status.mjs  (aguardar o encoding antes de publicar)');
} catch (e) {
  erroFatal(e);
}
