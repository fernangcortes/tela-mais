/* core/presets/temas/alto-contraste.mjs — preset de tema "alto-contraste".
 *
 * Preto e branco com amarelo (ou azul no claro): contraste acima de 7:1, para baixa visão.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'alto-contraste',
  rotulo: 'Alto contraste',
  descricao: 'Preto e branco com amarelo (ou azul no claro): contraste acima de 7:1, para baixa visão.',
  modoPadrao: 'escuro',
  cores: {
    escuro: {
      marca: '#ffe14d',
      marcaClara: '#fff08a',
      marcaFraca: '#1f1a00',
      marca2: '#7ec8ff',
      marca3: '#ffb347',
      textoSobreMarca: '#000000',
      textoSobreDestaque: '#000000',
      fundo: '#000000',
      superficie: '#0b0b0b',
      texto: '#ffffff',
      textoFraco: '#d9d9d9',
      borda: '#6e6e6e',
      contorno: '#ffffff',
      alerta: '#ffd24d',
      alertaFundo: '#1f1700',
      erro: '#ff9e9e',
      erroFundo: '#260000',
      mesaFundo: '#000000',
      mesaPainel: '#0a0a0a',
      mesaPainelAlto: '#141414'
    },
    claro: {
      marca: '#0033cc',
      marcaClara: '#0a2a99',
      marcaFraca: '#e6ecff',
      marca2: '#0b4fa8',
      marca3: '#7a3e00',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#ffffff',
      superficie: '#ffffff',
      texto: '#000000',
      textoFraco: '#262626',
      borda: '#595959',
      contorno: '#000000',
      alerta: '#5c3a00',
      alertaFundo: '#fff4d6',
      erro: '#9b0000',
      erroFundo: '#ffe5e5',
      mesaFundo: '#f0f0f0',
      mesaPainel: '#ffffff',
      mesaPainelAlto: '#ffffff'
    }
  },
  forma: { raioPx: 4, sombra: 'none' }
};
