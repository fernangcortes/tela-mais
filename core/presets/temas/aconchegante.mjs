/* core/presets/temas/aconchegante.mjs — preset de tema "aconchegante".
 *
 * Tons de papel e terracota, títulos com serifa: cursos, comunidades e conteúdo autoral.
 * Traz as DUAS paletas (escura e clara) para que tema.modo "auto" funcione com
 * qualquer preset; `modoPadrao` vale quando o config não diz tema.modo.
 * Todo par de cores passa o contraste do próprio validador (4,5:1 texto, 3:1
 * controles): tests/tema.test.js mede cada um, então editar uma cor aqui sem
 * refazer a conta reprova o teste. Cores do cliente vão em tema.cores no
 * config/site.json (sobrescrevem este preset), não aqui. */
export default {
  nome: 'aconchegante',
  rotulo: 'Aconchegante',
  descricao: 'Tons de papel e terracota, títulos com serifa: cursos, comunidades e conteúdo autoral.',
  modoPadrao: 'claro',
  cores: {
    escuro: {
      marca: '#f0905a',
      marcaClara: '#f5aa80',
      marcaFraca: '#35211a',
      marca2: '#d9b25a',
      marca3: '#f2c46d',
      textoSobreMarca: '#1c0d05',
      textoSobreDestaque: '#1c1200',
      fundo: '#1c1611',
      superficie: '#261e17',
      texto: '#f3e9da',
      textoFraco: '#b9a893',
      borda: '#3b3025',
      contorno: '#86745f',
      alerta: '#e8b95a',
      alertaFundo: '#2d2412',
      erro: '#f09a8c',
      erroFundo: '#33191a',
      mesaFundo: '#120e0a',
      mesaPainel: '#1a140f',
      mesaPainelAlto: '#251d16'
    },
    claro: {
      marca: '#a8461b',
      marcaClara: '#8a3814',
      marcaFraca: '#f6e0d0',
      marca2: '#7a5a12',
      marca3: '#8a5200',
      textoSobreMarca: '#ffffff',
      textoSobreDestaque: '#ffffff',
      fundo: '#faf3e8',
      superficie: '#fffaf1',
      texto: '#2e2216',
      textoFraco: '#5e4e3d',
      borda: '#e4d6c0',
      contorno: '#8a7558',
      alerta: '#6e4400',
      alertaFundo: '#fdebc4',
      erro: '#a8231a',
      erroFundo: '#fbe3df',
      mesaFundo: '#eadfcc',
      mesaPainel: '#f4ead9',
      mesaPainelAlto: '#fffaf1'
    }
  },
  forma: { raioPx: 14, sombra: 'none' },
  tipografia: {
    titulo: { familia: 'Georgia', origem: 'sistema' },
    reservaTitulo: "'Times New Roman', Times, serif"
  }
};
