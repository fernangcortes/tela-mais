/* provedores/bunny.js — adaptador do Bunny Stream.
 *
 * É AQUI, e só aqui, que moram os hosts do Bunny (video.bunnycdn.com, o
 * player.mediadelivery.net, a pull zone), a tabela de status numérica, o hash
 * no nome da capa e a assinatura SHA-256 do upload TUS. Tudo o que o resto do
 * projeto sabe do Bunny passa pela interface de contrato.js.
 *
 * Paridade com o comportamento de antes do M4 (criarClienteBunny, upload-token,
 * midia, catalogo-core):
 *   - criar vídeo = POST /library/{id}/videos { title } -> guid;
 *   - upload TUS direto do navegador em /tusupload, com assinatura de uso
 *     único SHA256(libraryId + apiKey + expire + videoId), expire em SEGUNDOS;
 *   - HLS em https://{pullzone}/{id}/playlist.m3u8; MP4 em play_{res}.mp4;
 *   - capa em {pullzone}/{id}/{capa_arquivo|thumbnail.jpg}?v={versao}; o Bunny
 *     grava a capa ENVIADA com hash no nome e apaga a anterior, então
 *     `definirCapa` relê o vídeo e devolve o nome novo;
 *   - prévia animada preview.webp; legenda em captions/{idioma}.vtt (o Bunny a
 *     serve como application/octet-stream: o navegador busca com fetch);
 *   - embed com os quatro parâmetros que desligam autoplay/loop/preload/
 *     rememberPosition (o padrão do Bunny é autoplay=true: ARMADILHA CENTRAL).
 *
 * Assinatura de URL (modo privado, Token Authentication) é do M5: aqui é só a
 * capacidade (`assinatura: false`) e o stub que recusa `assinar: true`.
 */
import {
  ErroProvedor, mensagemDe, hostsLimpos, hostSimples, base64Utf8, rotuloDoIdioma, detalheDe, mascarar, PADRAO_IDIOMA
} from './contrato.js';

export const ID = 'bunny';
export const CHAVE_CONFIG = 'bunny';
export const CREDENCIAIS = Object.freeze({
  bibliotecaId: { env: 'BUNNY_LIBRARY_ID', obrigatoria: true, segredo: true },
  chaveApi: { env: 'BUNNY_API_KEY', obrigatoria: true, segredo: true },
  hostDaPullZone: { env: 'BUNNY_PULLZONE', obrigatoria: false, segredo: true },
  chaveDeToken: { env: 'BUNNY_TOKEN_KEY', obrigatoria: false, segredo: true }   /* Token Authentication: M5 */
});

const HOST_API = 'https://video.bunnycdn.com';
const URL_TUS = HOST_API + '/tusupload';
const HOST_PLAYER = 'https://player.mediadelivery.net';
const URL_PLAYERJS = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js';

/* O id do Bunny é um guid. O padrão antigo do projeto (8 a 64, letras, números
 * e hífen) é mantido: aceita o guid e recusa tudo que muda o caminho da URL. */
const PADRAO_ID = /^[A-Za-z0-9-]{8,64}$/;
const PADRAO_ARQUIVO_CAPA = /^[A-Za-z0-9._-]{1,120}$/;
/* Os quatro parâmetros que desligam o autoplay do player (o padrão dele é TRUE), prontos: o catálogo monta isto por título. */
const PARAMETROS_DO_EMBED = 'autoplay=false&loop=false&preload=false&rememberPosition=false';
const VALIDADE_PADRAO_S = 3600;

/* Status do vídeo no Bunny -> estado normalizado. 4 = pronto e 5 = erro são os
 * dois que o produto sempre usou; os demais seguem a documentação da API
 * (0 criado, 1 enviado, 2 processando, 3 transcodificando, 6 upload falhou,
 * 7 e 8 segmentação JIT). Conferir contra a conta real antes de confiar em 6-8. */
function normalizarEstado(status) {
  switch (status) {
    case 0: return 'enviando';
    case 4: return 'pronto';
    case 5: case 6: return 'erro';
    default: return 'processando';
  }
}

/* Status do WEBHOOK (numeração própria, diferente da do vídeo): 3 e 4 = pronto,
 * 5 e 8 = falhou. A documentação do evento precisa ser conferida na conta. */
function eventoDoWebhook(status) {
  if (status === 3 || status === 4) return 'pronto';
  if (status === 5 || status === 8) return 'erro';
  return 'processando';
}

export function criar({ credenciais = {}, config = {}, fetch: fetchInjetado, agora = Date.now } = {}) {
  const libraryId = String(credenciais.bibliotecaId || '');
  const apiKey = String(credenciais.chaveApi || '');
  const host = hostSimples(credenciais.hostDaPullZone || '');
  const configurado = Boolean(libraryId && apiKey);
  const base = HOST_API + '/library/' + encodeURIComponent(libraryId);
  const pedacoBytes = ((config && config.envio && config.envio.tamanhoDoPedacoMb) || 50) * 1024 * 1024;

  /* O fetch é lido NA HORA: os testes trocam o global, e um adaptador criado
   * antes da troca precisa enxergá-la. */
  const buscar = (...a) => (fetchInjetado || globalThis.fetch)(...a);

  async function chamar(caminho, init = {}) {
    if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
    try {
      return await buscar(base + caminho, Object.assign({}, init, {
        headers: Object.assign({ AccessKey: apiKey, accept: 'application/json' }, init.headers || {})
      }));
    } catch (e) {
      throw new ErroProvedor('provedor-inacessivel', { detalhe: mascarar(e && e.message, [apiKey]) });
    }
  }

  async function exigir(resposta, codigo) {
    if (!resposta.ok) throw new ErroProvedor(codigo, { status: resposta.status, detalhe: await detalheDe(resposta, [apiKey, credenciais.chaveDeToken]) });
    return resposta;
  }

  function validarId(id) {
    if (typeof id !== 'string' || !PADRAO_ID.test(id)) throw new ErroProvedor('id-invalido');
    return id;
  }

  async function lerJson(resposta, codigo) {
    try { return await resposta.json(); } catch (e) {
      throw new ErroProvedor(codigo, { status: resposta.status, detalhe: 'resposta sem JSON' });
    }
  }

  async function assinarUpload(id, expira) {
    const dados = new TextEncoder().encode(libraryId + apiKey + expira + id);
    const resumo = await crypto.subtle.digest('SHA-256', dados);
    return [...new Uint8Array(resumo)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function planoDe(id, validadeSeg) {
    /* expire é UNIX em SEGUNDOS: milissegundos invalidam a assinatura. */
    const expiraEm = Math.floor(agora() / 1000) + (Number(validadeSeg) > 0 ? Math.floor(Number(validadeSeg)) : VALIDADE_PADRAO_S);
    return {
      id,
      protocolo: 'tus',
      modo: 'endpoint',
      url: URL_TUS,
      cabecalhos: {
        AuthorizationSignature: await assinarUpload(id, expiraEm),
        AuthorizationExpire: String(expiraEm),
        VideoId: id,
        LibraryId: libraryId
      },
      metadados: {},
      expiraEm,
      pedacoBytes,
      fonte: { provedor: ID, id, extras: { libraryId } }
    };
  }

  function estadoDe(v) {
    return {
      estado: normalizarEstado(v.status),
      progresso: typeof v.encodeProgress === 'number' ? v.encodeProgress : null,
      duracaoSeg: typeof v.length === 'number' ? v.length : null,
      titulo: v.title != null ? v.title : null,
      estadoBruto: v.status != null ? v.status : null,
      qualidades: typeof v.availableResolutions === 'string' && v.availableResolutions ? v.availableResolutions.split(',') : []
    };
  }

  function resumoDe(v) {
    const e = estadoDe(v);
    return {
      id: v.guid,
      titulo: e.titulo,
      duracaoSeg: e.duracaoSeg,
      criadoEm: v.dateUploaded || null,
      tamanhoBytes: typeof v.storageSize === 'number' ? v.storageSize : null,
      estado: e.estado,
      progresso: e.progresso,
      framerate: typeof v.framerate === 'number' ? v.framerate : null,
      arquivoCapa: v.thumbnailFileName || null,
      urlCapa: urlDaCapa(v.guid, { arquivo: v.thumbnailFileName }),
      /* Os capítulos que o player já tem (só quem tem `capitulosNativos`): o script de capítulos compara antes de gravar. */
      capitulos: Array.isArray(v.chapters)
        ? v.chapters.map(c => ({ titulo: String(c.title), inicio: Number(c.start), fim: Number(c.end) }))
        : null
    };
  }

  function urlDaCapa(id, { arquivo, versao } = {}) {
    if (!host || typeof id !== 'string' || !PADRAO_ID.test(id)) return null;
    const nome = typeof arquivo === 'string' && PADRAO_ARQUIVO_CAPA.test(arquivo) ? arquivo : 'thumbnail.jpg';
    const url = 'https://' + host + '/' + id + '/' + nome;
    return versao != null && versao !== '' ? url + '?v=' + encodeURIComponent(versao) : url;
  }

  function reproducaoSemAssinatura(id, extras) {
    const saida = { hls: null, mp4: null, embed: null, expiraEm: null };
    if (typeof id !== 'string' || !PADRAO_ID.test(id)) return saida;
    if (host) {
      saida.hls = 'https://' + host + '/' + id + '/playlist.m3u8';
      const prefixo = 'https://' + host + '/' + id + '/play_';
      saida.mp4 = { '240p': prefixo + '240p.mp4', '360p': prefixo + '360p.mp4', '720p': prefixo + '720p.mp4' };
    }
    /* O libraryId do item manda; o do ambiente é a rede de segurança para itens
     * gravados antes de a library existir. */
    const biblioteca = String((extras && extras.libraryId) || libraryId || '');
    if (biblioteca) {
      /* ARMADILHA CENTRAL: o autoplay do Bunny é `true` por padrão. Omitir o
       * parâmetro faz o vídeo tocar sozinho, o que o produto proíbe. Os
       * quatro parâmetros são obrigatórios; há teste cobrindo isso. */
      saida.embed = {
        url: HOST_PLAYER + '/embed/' + encodeURIComponent(biblioteca) + '/' + id + '?' + PARAMETROS_DO_EMBED,
        scriptUrl: URL_PLAYERJS,
        controle: 'playerjs'
      };
    }
    return saida;
  }

  function legendasPorIdioma(id, idiomas) {
    if (!host || typeof id !== 'string' || !PADRAO_ID.test(id)) return [];
    return idiomas.filter(i => typeof i === 'string' && PADRAO_IDIOMA.test(i)).map(idioma => ({
      idioma, rotulo: rotuloDoIdioma(idioma),
      url: 'https://' + host + '/' + id + '/captions/' + idioma + '.vtt', origem: 'desconhecida'
    }));
  }

  const adaptador = {
    id: ID,
    configurado,
    padraoId: PADRAO_ID,

    capacidades() {
      return {
        uploadProtocolo: 'tus',
        envio: true,
        assinatura: false,            /* Token Authentication: M5 */
        drm: 'nenhum',                /* MediaCage existe no Bunny, mas não é ligado por aqui */
        embed: true,
        mp4: true,
        previa: true,
        sprites: false,
        clipe: false,
        capaPorUpload: true,
        capaPorTempo: false,
        legendaPorUpload: true,
        legendaIA: false,             /* Transcribe AI existe no Bunny; ainda não ligado */
        capitulosNativos: true,
        webhooks: true,
        uso: false,
        hostsMidia: hostsLimpos({
          img: ['https://*.b-cdn.net'],
          media: ['https://*.b-cdn.net'],
          connect: ['https://*.b-cdn.net', HOST_API],
          frame: [HOST_PLAYER, 'https://iframe.mediadelivery.net'],
          script: ['https://assets.mediadelivery.net']
        })
      };
    },

    hostsMidia() {
      const estaticos = adaptador.capacidades().hostsMidia;
      /* Pull zone própria (domínio do cliente): só entra se parece um host. */
      const proprio = host ? ['https://' + host] : [];
      return hostsLimpos({
        img: estaticos.img.concat(proprio),
        media: estaticos.media.concat(proprio),
        connect: estaticos.connect.concat(proprio),
        frame: estaticos.frame,
        script: estaticos.script
      });
    },

    async validarCredenciais() {
      if (!configurado) {
        return { ok: false, codigo: 'provedor-nao-configurado', mensagem: mensagemDe('provedor-nao-configurado', { provedor: ID, faltando: 'BUNNY_LIBRARY_ID, BUNNY_API_KEY' }) };
      }
      try {
        const r = await chamar('/videos?page=1&itemsPerPage=1');
        if (r.ok) return { ok: true, mensagem: '' };
        const codigo = r.status === 401 || r.status === 403 ? 'credenciais-recusadas' : 'provedor-recusou-consulta';
        return { ok: false, codigo, mensagem: mensagemDe(codigo) };
      } catch (e) {
        const codigo = e instanceof ErroProvedor ? e.codigo : 'provedor-inacessivel';
        return { ok: false, codigo, mensagem: mensagemDe(codigo) };
      }
    },

    async criarUpload({ titulo, validadeSeg } = {}) {
      if (typeof titulo !== 'string' || !titulo.trim()) throw new ErroProvedor('parametro-invalido', { detalhe: 'titulo' });
      const r = await exigir(await chamar('/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: titulo.trim() })
      }), 'provedor-recusou-criacao');
      const criado = await lerJson(r, 'provedor-recusou-criacao');
      if (!criado || !criado.guid) throw new ErroProvedor('provedor-sem-guid');
      return planoDe(validarId(String(criado.guid)), validadeSeg);
    },

    async retomarUpload(id, { validadeSeg } = {}) {
      if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
      return planoDe(validarId(id), validadeSeg);
    },

    async statusEncoding(id) {
      validarId(id);
      const r = await exigir(await chamar('/videos/' + id), 'provedor-recusou-consulta');
      return estadoDe(await lerJson(r, 'provedor-recusou-consulta'));
    },

    async urlReproducao(id, { assinar = false, extras } = {}) {
      if (assinar) throw new ErroProvedor('assinatura-indisponivel', { status: 501 });
      return reproducaoSemAssinatura(id, extras);
    },

    /* Atalho do catálogo (CPU do plano gratuito): a mesma `Midia` que `montarMidia` compõe
     * com as quatro funções de URL, numa chamada só e sem rede. Só vale para URL sem
     * assinatura: com `assinar`, o registro volta à composição. A suíte de contrato confere
     * que as duas dão o mesmo resultado. */
    async midia(id, { extras, arquivo, versao, idiomas } = {}) {
      const rep = reproducaoSemAssinatura(id, extras);
      return {
        hls: rep.hls,
        mp4: rep.mp4,
        capa: urlDaCapa(id, { arquivo, versao }),
        previa: host && PADRAO_ID.test(id) ? 'https://' + host + '/' + id + '/preview.webp' : null,
        legendas: legendasPorIdioma(id, idiomas),
        embed: rep.embed,
        expiraEm: null
      };
    },

    async urlCapa(id, opcoes) {
      return urlDaCapa(id, opcoes || {});
    },

    async definirCapa(id, bytes, mime) {
      validarId(id);
      await exigir(await chamar('/videos/' + id + '/thumbnail', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes
      }), 'provedor-recusou-capa');
      /* O Bunny grava a capa recebida com um hash no nome e apaga a anterior.
       * Sem reler o vídeo para saber o nome real, o catálogo seguiria
       * apontando para um arquivo que sumiu. */
      let arquivo = null;
      const consulta = await chamar('/videos/' + id);
      if (consulta.ok) {
        const v = await consulta.json().catch(() => ({}));
        arquivo = v && v.thumbnailFileName ? String(v.thumbnailFileName) : null;
      }
      if (!arquivo) return { arquivo: null, versao: null, urlCapa: null };
      const versao = String(agora());
      return { arquivo, versao, urlCapa: urlDaCapa(id, { arquivo, versao }) };
    },

    async urlPreview(id) {
      if (!host || typeof id !== 'string' || !PADRAO_ID.test(id)) return { animada: null, clipeHls: null, sprite: null };
      /* ARMADILHA medida: o preview.webp tem de 454 KB a 3,1 MB (mediana 1,13 MB).
       * Quem usa a URL só a pede no mouseenter e a solta no mouseleave. */
      return { animada: 'https://' + host + '/' + id + '/preview.webp', clipeHls: null, sprite: null };
    },

    async legendas(id, { idiomas } = {}) {
      validarId(id);
      if (Array.isArray(idiomas)) return legendasPorIdioma(id, idiomas);
      const r = await exigir(await chamar('/videos/' + id), 'provedor-recusou-consulta');
      const v = await lerJson(r, 'provedor-recusou-consulta');
      return (v.captions || []).filter(c => c && PADRAO_IDIOMA.test(String(c.srclang))).map(c => ({
        idioma: String(c.srclang), rotulo: c.label ? String(c.label) : rotuloDoIdioma(String(c.srclang)),
        url: host ? 'https://' + host + '/' + id + '/captions/' + c.srclang + '.vtt' : '', origem: 'desconhecida'
      }));
    },

    async enviarLegenda(id, { idioma, rotulo, srt, vtt } = {}) {
      validarId(id);
      if (typeof idioma !== 'string' || !PADRAO_IDIOMA.test(idioma)) throw new ErroProvedor('parametro-invalido', { detalhe: 'idioma' });
      const texto = typeof srt === 'string' && srt ? srt : (typeof vtt === 'string' ? vtt : '');
      if (!texto.trim()) throw new ErroProvedor('parametro-invalido', { detalhe: 'legenda vazia' }); /* i18n-ignorar: detalhe técnico do erro */
      const nome = rotulo || rotuloDoIdioma(idioma);
      await exigir(await chamar('/videos/' + id + '/captions/' + idioma, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ srclang: idioma, label: nome, captionsFile: base64Utf8(texto) })
      }), 'provedor-recusou-legenda');
      return { idioma, rotulo: nome };
    },

    /* Capítulos nativos: segmentam a linha do tempo do player do Bunny e mostram
     * o título no hover. O formato da API é { title, start, end } em segundos
     * INTEIROS (int32): o arredondamento é aqui, num lugar só. `[]` apaga. O
     * update é parcial: mandar só `chapters` não mexe em título, legenda nem capa. */
    async definirCapitulos(id, capitulos) {
      validarId(id);
      const corpo = (capitulos || []).map(c => ({
        title: String(c.titulo != null ? c.titulo : c.title),
        start: Math.round(Number(c.inicio != null ? c.inicio : c.start)),
        end: Math.round(Number(c.fim != null ? c.fim : c.end))
      }));
      await exigir(await chamar('/videos/' + id, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapters: corpo })
      }), 'provedor-recusou-capitulos');
      return { n: corpo.length };
    },

    async obterVideo(id) {
      validarId(id);
      const r = await exigir(await chamar('/videos/' + id), 'provedor-recusou-consulta');
      return resumoDe(await lerJson(r, 'provedor-recusou-consulta'));
    },

    async listar({ cursor, limite } = {}) {
      const pagina = Math.max(1, Math.floor(Number(cursor)) || 1);
      const porPagina = Math.min(100, Math.max(1, Math.floor(Number(limite)) || 50));
      const r = await exigir(await chamar('/videos?page=' + pagina + '&itemsPerPage=' + porPagina + '&orderBy=date'), 'provedor-recusou-consulta');
      const corpo = await lerJson(r, 'provedor-recusou-consulta');
      const itens = (corpo.items || []).map(resumoDe);
      const total = typeof corpo.totalItems === 'number' ? corpo.totalItems : itens.length;
      return { itens, proximo: pagina * porPagina < total ? pagina + 1 : null };
    },

    async excluir(id) {
      validarId(id);
      await exigir(await chamar('/videos/' + id, { method: 'DELETE' }), 'provedor-recusou-exclusao');
      return { ok: true };
    },

    /* O webhook do Bunny não é assinado: o que se confere é a biblioteca. */
    async receberWebhook(request) {
      let corpo;
      try { corpo = await request.json(); } catch (e) { return null; }
      if (!corpo || typeof corpo.VideoGuid !== 'string' || !PADRAO_ID.test(corpo.VideoGuid)) return null;
      if (libraryId && String(corpo.VideoLibraryId) !== libraryId) return null;
      return { id: corpo.VideoGuid, evento: eventoDoWebhook(corpo.Status) };
    }
  };
  return adaptador;
}
