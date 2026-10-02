/* core/presets/temas/institucional.mjs — preset de tema "institucional".
 *
 * Azul-marinho sóbrio e cantos discretos: escolas, órgãos e empresas.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'institucional',
  rotulo: 'Institucional',
  descricao: 'Azul-marinho sóbrio e cantos discretos: escolas, órgãos e empresas.',
  modoPadrao: 'claro',
  cores: {
    escuro: {
      marca: '#7fb2f0',
      marcaClara: '#a3c8f6',
      marcaFraca: '#12233b',
      marca2: '#5a97e0',
      marca3: '#e8b84a',
      textoSobreMarca: '#06101d',
      textoSobreDestaque: '#1a1300',
      fundo: '#0a1422',
      superficie: '#101d30',
      texto: '#e8eef7',
      textoFraco: '#9fb0c7',
      borda: '#223249',
      contorno: '#647a99',
      alerta: '#e0b356',
      alertaFundo: '#2a2415',
      erro: '#f08c86',
      erroFundo: '#2c1817',
      mesaFundo: '#060d18',
      mesaPainel: '#0c1828',
      mesaPainelAlto: '#142339'
    },
    claro: {
      marca: '#0b3d7a',
      marcaClara: '#082f5e',
      marcaFraca: '#e1eaf6',
      marca2: '#1a5aa8',
      marca3: '#8a4b00',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#f3f5f8',
      superficie: '#ffffff',
      texto: '#16202e',
      textoFraco: '#4a5668',
      borda: '#d8dee7',
      contorno: '#66738a',
      alerta: '#764800',
      alertaFundo: '#fff1d0',
      erro: '#a8231a',
      erroFundo: '#fbe6e4',
      mesaFundo: '#e5e9ef',
      mesaPainel: '#f3f5f8',
      mesaPainelAlto: '#ffffff'
    }
  },
  forma: { raioPx: 4, sombra: '0 1px 3px rgba(0,0,0,.12)' }
};
