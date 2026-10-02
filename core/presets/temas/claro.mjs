/* core/presets/temas/claro.mjs — preset de tema "claro".
 *
 * Fundo claro e verde-esmeralda: leitura confortável de dia.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'claro',
  rotulo: 'Claro',
  descricao: 'Fundo claro e verde-esmeralda: leitura confortável de dia.',
  modoPadrao: 'claro',
  cores: {
    escuro: {
      marca: '#3ddc97',
      marcaClara: '#6ae8b2',
      marcaFraca: '#12261d',
      marca2: '#2fbf82',
      marca3: '#f2c14e',
      textoSobreMarca: '#04130c',
      textoSobreDestaque: '#1a1300',
      fundo: '#0e1411',
      superficie: '#151d19',
      texto: '#e8efea',
      textoFraco: '#9aa8a0',
      borda: '#27322c',
      contorno: '#66746b',
      alerta: '#e0b356',
      alertaFundo: '#2a2415',
      erro: '#f08c86',
      erroFundo: '#2c1817',
      mesaFundo: '#090d0b',
      mesaPainel: '#0f1512',
      mesaPainelAlto: '#18211c'
    },
    claro: {
      marca: '#0f6b45',
      marcaClara: '#0b573a',
      marcaFraca: '#def3e8',
      marca2: '#1b7a52',
      marca3: '#8a5a00',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#fafaf7',
      superficie: '#ffffff',
      texto: '#1a1f1c',
      textoFraco: '#4f5a53',
      borda: '#dde2dd',
      contorno: '#6c776f',
      alerta: '#7a4a00',
      alertaFundo: '#fff2d1',
      erro: '#b3261e',
      erroFundo: '#fde9e7',
      mesaFundo: '#e8ece8',
      mesaPainel: '#f3f5f2',
      mesaPainelAlto: '#ffffff'
    }
  },
  forma: { raioPx: 10, sombra: 'none' }
};
