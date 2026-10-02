/* core/presets/temas/cinema.mjs — preset de tema "cinema".
 *
 * Escuro, como as plataformas de streaming. É o padrão.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'cinema',
  rotulo: 'Cinema',
  descricao: 'Escuro, como as plataformas de streaming. É o padrão.',
  modoPadrao: 'escuro',
  cores: {
    escuro: {
      marca: '#6aa6ff',
      marcaClara: '#8dbcff',
      marcaFraca: '#151d2b',
      marca2: '#4f8de0',
      marca3: '#f5c542',
      textoSobreMarca: '#07101c',
      textoSobreDestaque: '#1a1500',
      fundo: '#0f1115',
      superficie: '#171a1f',
      texto: '#eceff4',
      textoFraco: '#98a2ad',
      borda: '#2a2f36',
      contorno: '#656f78',
      alerta: '#e0b356',
      alertaFundo: '#2a2415',
      erro: '#f08c86',
      erroFundo: '#2c1817',
      mesaFundo: '#0a0c0e',
      mesaPainel: '#111417',
      mesaPainelAlto: '#1a1f23'
    },
    claro: {
      marca: '#1f5fbf',
      marcaClara: '#174c9a',
      marcaFraca: '#e2ecfa',
      marca2: '#2563c9',
      marca3: '#8a5a00',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#f4f6f8',
      superficie: '#ffffff',
      texto: '#14181d',
      textoFraco: '#4a5460',
      borda: '#d3d9e0',
      contorno: '#6b7684',
      alerta: '#7a4a00',
      alertaFundo: '#fff2d1',
      erro: '#b3261e',
      erroFundo: '#fde9e7',
      mesaFundo: '#e6eaef',
      mesaPainel: '#f4f6f8',
      mesaPainelAlto: '#ffffff'
    }
  },
  forma: { raioPx: 10, sombra: 'none' }
};
