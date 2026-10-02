/* core/presets/temas/vibrante.mjs — preset de tema "vibrante".
 *
 * Roxo profundo com rosa-choque: para público jovem e conteúdo de entretenimento.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'vibrante',
  rotulo: 'Vibrante',
  descricao: 'Roxo profundo com rosa-choque: para público jovem e conteúdo de entretenimento.',
  modoPadrao: 'escuro',
  cores: {
    escuro: {
      marca: '#ff5fa2',
      marcaClara: '#ff85b9',
      marcaFraca: '#2a1038',
      marca2: '#a98bff',
      marca3: '#ffd23f',
      textoSobreMarca: '#1a0010',
      textoSobreDestaque: '#1a1300',
      fundo: '#12081f',
      superficie: '#1b1030',
      texto: '#f6efff',
      textoFraco: '#b8a6d6',
      borda: '#33224f',
      contorno: '#7d6a9e',
      alerta: '#f2c14e',
      alertaFundo: '#2a2210',
      erro: '#ff8f8f',
      erroFundo: '#33121a',
      mesaFundo: '#0c0515',
      mesaPainel: '#150a26',
      mesaPainelAlto: '#1f1236'
    },
    claro: {
      marca: '#b0006a',
      marcaClara: '#8f0055',
      marcaFraca: '#fde3f0',
      marca2: '#6a3fd6',
      marca3: '#8a5a00',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#fff7fb',
      superficie: '#ffffff',
      texto: '#26112e',
      textoFraco: '#5d4a6b',
      borda: '#ead6e4',
      contorno: '#8a6f94',
      alerta: '#7a4a00',
      alertaFundo: '#fff2d1',
      erro: '#b3261e',
      erroFundo: '#fde9e7',
      mesaFundo: '#f3e6ef',
      mesaPainel: '#fff7fb',
      mesaPainelAlto: '#ffffff'
    }
  },
  forma: { raioPx: 16, sombra: 'none' }
};
