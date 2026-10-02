/* scripts/cadastrar-hls.mjs — carga em lote para o provedor "hls-generico": os vídeos já estão no seu
 * servidor (qualquer .m3u8 em https), então não há upload; o que se grava no catálogo local é a `fonte`.
 *
 *   node scripts/cadastrar-hls.mjs --mapa mapa-hls.json            grava a `fonte` de cada título do mapa
 *   node scripts/cadastrar-hls.mjs --mapa mapa-hls.json --simular  só mostra o que gravaria
 *   node scripts/cadastrar-hls.mjs --mapa mapa-hls.json --verificar  lê cada playlist (status e duração)
 *   node scripts/cadastrar-hls.mjs --mapa mapa-hls.json --sobrescrever  troca a `fonte` de quem já tem
 *
 *   --catalogo <p>   usa outro JSON (padrão: exemplo/catalogo.json)
 *
 * O mapa é uma lista (ou um objeto { "<id do título>": { ... } }) de:
 *   { "item": "<id do título no catálogo>", "hls": "https://.../master.m3u8",
 *     "capa": "https://.../capa.jpg", "mp4": "https://.../720.mp4",
 *     "legenda": "https://.../pt.vtt", "idioma": "pt" }       (só `hls` é obrigatório)
 *
 * Cada endereço é conferido pelo adaptador (`prepararFonte`): https, host da `video.hlsGenerico.baseUrl` ou de
 * `hostsPermitidos`, extensão certa. Endereço fora disso é recusado — é a mesma regra do /admin. IDEMPOTENTE:
 * quem já tem `fonte` é pulado (use --sobrescrever para trocar).
 */
import { readFile } from 'node:fs/promises';
import { argumentos, lerCatalogo, gravarFontes, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';
import { videoDoItem, exigirCapacidade, exigirConfigurado, provedorDoAmbiente } from './lib/provedores/index.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  if (typeof op.mapa !== 'string') throw new Error('informe o mapa: --mapa <arquivo.json> (veja o início deste script)');
  const bruto = JSON.parse(await readFile(op.mapa, 'utf8'));
  const entradas = Array.isArray(bruto)
    ? bruto
    : Object.entries(bruto || {}).map(([item, dados]) => Object.assign({ item }, dados));
  if (!entradas.length) throw new Error('o mapa está vazio');

  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  /* O provedor é o de `video.provedor` em config/site.json: gravar fonte de outro provedor deixaria o site sem vídeo. */
  exigirCapacidade(provedor, 'fontePorUrl', 'cadastrar título por endereço (defina video.provedor = "hls-generico")');

  const catalogo = await lerCatalogo(caminhoCatalogo);
  const porId = new Map(catalogo.itens.map(i => [i.id, i]));
  const conta = { gravados: 0, pulados: 0, recusados: 0, naoEncontrados: 0, aviso: 0 };
  const gravar = [];

  for (const e of entradas) {
    const item = porId.get(e && e.item);
    if (!item) { conta.naoEncontrados++; console.error('  ✖ título não encontrado no catálogo: ' + (e && e.item)); continue; }
    if (videoDoItem(provedor, item) && !op.sobrescrever) { conta.pulados++; console.log('  · já tem fonte: ' + item.titulo); continue; }

    let pronta;
    try {
      pronta = await provedor.prepararFonte({
        hls: e.hls, mp4: e.mp4, capa: e.capa,
        legendas: e.legenda ? [{ idioma: e.idioma || 'pt', url: e.legenda }] : undefined
      }, { verificar: Boolean(op.verificar) });
    } catch (erro) {
      conta.recusados++;
      console.error('  ✖ ' + item.titulo + ': ' + (erro.detalhe ? erro.codigo + ' (' + erro.detalhe + ')' : erro.message));
      continue;
    }
    if (op.verificar && pronta.estado !== 'pronto') {
      conta.aviso++;
      console.log('  ! ' + item.titulo + ': playlist ' + pronta.estado + ' (' + pronta.estadoBruto + ')');
    }
    console.log('  ' + (op.simular ? '~' : '✔') + ' ' + item.titulo + '  ->  ' + pronta.fonte.id);
    item.fonte = pronta.fonte;
    gravar.push(item);
    conta.gravados++;
  }

  if (!op.simular && gravar.length) await gravarFontes(gravar, caminhoCatalogo);
  console.log('\n' + (op.simular ? '--simular: nada foi gravado.  ' : '') + conta.gravados + ' fonte(s)  ·  ' + conta.pulados +
    ' já tinham  ·  ' + conta.recusados + ' recusada(s)  ·  ' + conta.naoEncontrados + ' fora do catálogo' +
    (conta.aviso ? '  ·  ' + conta.aviso + ' com aviso' : ''));
  if (conta.recusados || conta.naoEncontrados) process.exitCode = 1;
} catch (e) {
  erroFatal(e);
}
