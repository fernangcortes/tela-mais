/* provedores/hls-generico.js — adaptador de HLS genérico: qualquer m3u8 em https.
 *
 * "Já tenho meus vídeos em outro lugar que entrega m3u8" (R2 com ffmpeg, Gumlet,
 * api.video, um servidor próprio...). O site só TOCA: o envio, a codificação e a
 * assinatura ficam por conta de quem hospeda. Por isso `capacidades().envio` é
 * false, `criarUpload`/`retomarUpload`/`definirCapa`/`enviarLegenda` recusam com
 * `recurso-indisponivel`, e o cadastro de um título é COLAR ENDEREÇOS no /admin
 * (`prepararFonte`), em vez de enviar arquivo.
 *
 * O QUE O ITEM GUARDA (`fonte = { provedor, id, extras }`)
 *
 *   id      o caminho do .m3u8 relativo a `video.hlsGenerico.baseUrl`
 *           (ex.: `acervo/aula-1/master.m3u8`), quando o endereço colado está
 *           sob a base; senão um identificador curto (`hls-3f9a21bc`) e o
 *           endereço fica em `extras.hls`.
 *   extras  { hls?, mp4?: { '720p': url }, capa?, legendas?: [{ idioma, rotulo, url }] }
 *           endereços ABSOLUTOS em https, cada um conferido contra a lista de
 *           hosts liberados (abaixo). `item.capa_arquivo` (opcional) é um caminho
 *           sob a base, alternativa a `extras.capa`.
 *
 * QUAIS HOSTS A CSP LIBERA (decisão de segurança, a mais restritiva)
 *
 *   Só o host de `baseUrl` e os de `video.hlsGenerico.hostsPermitidos`, ambos
 *   escritos pelo DONO da instalação em config/variável de ambiente. Os hosts
 *   NÃO são derivados dos endereços cadastrados nos títulos: quem edita o
 *   catálogo (uma conta de conteúdo) não pode ampliar a política de segurança
 *   do site nem fazer o navegador do público falar com um servidor qualquer
 *   colando um endereço. Endereço de host não liberado é recusado ao cadastrar
 *   (`prepararFonte`) e, por garantia, ignorado ao montar `item.midia`.
 *   O host dos SEGMENTOS (.ts/.m4s) costuma ser o mesmo do playlist; se for
 *   outro, entra em `hostsPermitidos`. O servidor de vídeo precisa liberar CORS
 *   para a origem do site (hls.js busca playlist e segmentos com fetch).
 *
 * ESTADO. Não há processamento do lado de cá; `statusEncoding` lê o playlist:
 *   - master (EXT-X-STREAM-INF), ou media com EXT-X-ENDLIST / PLAYLIST-TYPE:VOD -> 'pronto';
 *   - media sem ENDLIST nem VOD (o ffmpeg ainda escrevendo)                    -> 'processando';
 *   - resposta que não é playlist (HTML, sem #EXTM3U)                          -> 'erro';
 *   - 404/5xx                                                                  -> ErroProvedor.
 *   'enviando' não existe aqui (não há envio). Só 'pronto' pode ir ao ar.
 *
 * Assinatura de URL: indisponível (`assinar: true` é recusado). O modo privado
 * real é do provedor de quem hospeda.
 */
import {
  ErroProvedor, mensagemDe, hostsLimpos, hostSimples, rotuloDoIdioma, detalheDe, PADRAO_IDIOMA
} from './contrato.js';

export const ID = 'hls-generico';
export const CHAVE_CONFIG = 'hlsGenerico';
/* baseUrl não é segredo: vale o texto do config (`segredo: false`); a variável é a rede de segurança. */
export const CREDENCIAIS = Object.freeze({
  baseUrl: { env: 'HLS_BASE_URL', obrigatoria: true, segredo: false }
});

/* O id é um caminho relativo: letras, números, `.`, `_`, `-` e `/`, sem `..`, `//`, `/./`, nem barra no fim. */
const PADRAO_ID = /^(?!.*\.\.)(?!.*\/\/)(?!.*\/\.(\/|$))(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;
const EXT_HLS = /\.m3u8$/i;
const EXT_MP4 = /\.mp4$/i;
const EXT_VTT = /\.vtt$/i;
const EXT_IMAGEM = /\.(jpe?g|png|webp|avif|gif)$/i;
const PADRAO_RESOLUCAO = /^\d{3,4}p$/;
const MAX_URL = 2000;
const MAX_LEGENDAS = 20;
const MAX_PLAYLIST_BYTES = 1024 * 1024;
const HOST_DE_PERMITIDOS = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
/* Caracteres que nunca valem num endereço colado (e que quebrariam a CSP, um atributo HTML ou um cabeçalho). */
const INSEGURO_NA_URL = /[\s"'<>\\`{}|^\u0000-\u001f\u007f]/;

/* Hash curto e estável (FNV-1a, 32 bits) para o id de um título cujo endereço não está sob a base. */
function hashCurto(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* `https://host[/caminho]`, sem porta, sem credencial, sem query: a base dos ids. */
function lerBase(valor) {
  if (typeof valor !== 'string' || !valor.trim() || INSEGURO_NA_URL.test(valor.trim())) return null;
  let u;
  try { u = new URL(valor.trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
  const host = hostSimples(u.hostname);
  if (!host) return null;
  return { host, origem: 'https://' + host, caminho: u.pathname.replace(/\/+$/, '') };
}

/* A lista de hosts liberados além da base: `host` ou `*.dominio`; o que não tem esse formato é descartado. */
function lerPermitidos(config) {
  const bruto = config && config.hlsGenerico && config.hlsGenerico.hostsPermitidos;
  const saida = [];
  if (!Array.isArray(bruto)) return saida;
  for (const h of bruto) {
    if (typeof h !== 'string') continue;
    const limpo = h.trim().toLowerCase();
    if (limpo.length < 200 && HOST_DE_PERMITIDOS.test(limpo) && !saida.includes(limpo)) saida.push(limpo);
    if (saida.length >= 20) break;
  }
  return saida;
}

/* Lê no máximo `limite` bytes do corpo e descarta o resto (um playlist é pequeno; um arquivo de 4 GB colado por engano, não). */
async function lerTextoLimitado(resposta, limite) {
  if (!resposta.body || typeof resposta.body.getReader !== 'function') return (await resposta.text()).slice(0, limite);
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let texto = '';
  let lidos = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.byteLength;
    texto += decodificador.decode(value, { stream: true });
    if (lidos >= limite) { try { await leitor.cancel(); } catch (e) { /* já acabou */ } break; }
  }
  return texto;
}

export function criar({ credenciais = {}, config = {}, fetch: fetchInjetado } = {}) {
  const base = lerBase(credenciais.baseUrl);
  const permitidos = lerPermitidos(config);
  const configurado = base !== null;
  const buscar = (...a) => (fetchInjetado || globalThis.fetch)(...a);

  const baseTexto = base ? base.origem + base.caminho : '';
  const juntar = (relativo) => baseTexto + '/' + relativo;

  function hostLiberado(host) {
    if (!host) return false;
    if (base && host === base.host) return true;
    return permitidos.some(p => p.startsWith('*.') ? host.endsWith(p.slice(1)) : host === p);
  }

  /* Confere um endereço colado: { url } ou { motivo } (motivo é código estável: a tela o traduz). */
  function examinar(valor, extensao) {
    if (typeof valor !== 'string') return { motivo: 'invalida' };
    const texto = valor.trim();
    if (!texto || texto.length > MAX_URL || INSEGURO_NA_URL.test(texto)) return { motivo: 'invalida' };
    if (/^http:\/\//i.test(texto)) return { motivo: 'sem-https' };
    if (!/^https:\/\//i.test(texto)) return { motivo: 'invalida' };
    let u;
    try { u = new URL(texto); } catch (e) { return { motivo: 'invalida' }; }
    if (u.username || u.password || u.port || !u.hostname) return { motivo: 'invalida' };
    if (!hostLiberado(u.hostname.toLowerCase())) return { motivo: 'host-nao-permitido' };
    if (!extensao.test(u.pathname)) return { motivo: 'extensao' };
    return { url: u.href };
  }

  function validarId(id) {
    if (typeof id !== 'string' || !PADRAO_ID.test(id)) throw new ErroProvedor('id-invalido');
    return id;
  }

  /* ---- o que o item aponta (sem rede) ---- */

  function resolverHls(id, extras) {
    if (extras && extras.hls) return examinar(extras.hls, EXT_HLS).url || null;
    return base && EXT_HLS.test(id) ? juntar(id) : null;
  }

  function resolverMp4(extras) {
    const bruto = extras && extras.mp4;
    if (!bruto) return null;
    const mapa = typeof bruto === 'string' ? { '720p': bruto } : (typeof bruto === 'object' ? bruto : {});
    const saida = {};
    for (const [res, valor] of Object.entries(mapa)) {
      if (!PADRAO_RESOLUCAO.test(res)) continue;
      const r = examinar(valor, EXT_MP4);
      if (r.url) saida[res] = r.url;
    }
    return Object.keys(saida).length ? saida : null;
  }

  function resolverCapa(extras, arquivo, versao) {
    let url = null;
    if (extras && extras.capa) url = examinar(extras.capa, EXT_IMAGEM).url || null;
    else if (base && typeof arquivo === 'string' && PADRAO_ID.test(arquivo) && EXT_IMAGEM.test(arquivo)) url = juntar(arquivo);
    if (!url) return null;
    return versao != null && versao !== '' ? url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(versao) : url;
  }

  function resolverLegendas(extras) {
    const lista = extras && Array.isArray(extras.legendas) ? extras.legendas.slice(0, MAX_LEGENDAS) : [];
    const vistos = new Set();
    const saida = [];
    for (const l of lista) {
      if (!l || typeof l.idioma !== 'string' || !PADRAO_IDIOMA.test(l.idioma) || vistos.has(l.idioma)) continue;
      const r = examinar(l.url, EXT_VTT);
      if (!r.url) continue;
      vistos.add(l.idioma);
      const rotulo = typeof l.rotulo === 'string' ? l.rotulo.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
      saida.push({ idioma: l.idioma, rotulo: rotulo || rotuloDoIdioma(l.idioma), url: r.url, origem: 'manual' });
    }
    return saida;
  }

  /* ---- o que o playlist diz (com rede) ---- */

  async function inspecionar(id, extras) {
    validarId(id);
    const url = resolverHls(id, extras);
    if (!url) {
      if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
      return { estado: 'erro', progresso: null, duracaoSeg: null, estadoBruto: 'url-invalida', framerate: null, modificadoEm: null };
    }
    let resposta;
    try {
      resposta = await buscar(url, {
        method: 'GET',
        headers: { accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain;q=0.5, */*;q=0.1' },
        redirect: 'manual'
      });
    } catch (e) {
      throw new ErroProvedor('provedor-inacessivel', { detalhe: e && e.message });
    }
    /* 3xx: o host respondeu e manda para outro lugar; o navegador seguirá. Não se persegue redirecionamento daqui. */
    if (resposta.status >= 300 && resposta.status < 400) {
      return { estado: 'pronto', progresso: 100, duracaoSeg: null, estadoBruto: 'redirecionado', framerate: null, modificadoEm: null };
    }
    if (!resposta.ok) throw new ErroProvedor('provedor-recusou-consulta', { status: resposta.status, detalhe: await detalheDe(resposta, []) });

    const tipo = String(resposta.headers.get('content-type') || '').toLowerCase();
    const modificado = Date.parse(resposta.headers.get('last-modified') || '');
    const modificadoEm = Number.isFinite(modificado) ? new Date(modificado).toISOString() : null;
    const invalido = (bruto) => ({ estado: 'erro', progresso: null, duracaoSeg: null, estadoBruto: bruto, framerate: null, modificadoEm });
    if (tipo.startsWith('text/html')) return invalido('html');
    const texto = (await lerTextoLimitado(resposta, MAX_PLAYLIST_BYTES)).replace(/^﻿/, '').trimStart();
    if (!texto.startsWith('#EXTM3U')) return invalido('sem-extm3u');

    const mestre = texto.includes('#EXT-X-STREAM-INF');
    const fim = texto.includes('#EXT-X-ENDLIST') || /#EXT-X-PLAYLIST-TYPE:VOD/.test(texto);
    const pronto = mestre || fim;
    let duracao = null;
    if (!mestre && pronto) {
      let soma = 0;
      for (const m of texto.matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/g)) soma += Number(m[1]);
      duracao = soma > 0 ? Math.round(soma) : null;
    }
    const taxa = /FRAME-RATE=([0-9]+(?:\.[0-9]+)?)/.exec(texto);
    return {
      estado: pronto ? 'pronto' : 'processando',
      progresso: pronto ? 100 : null,
      duracaoSeg: duracao,
      estadoBruto: mestre ? 'master' : (fim ? 'vod' : 'sem-endlist'),
      framerate: taxa ? Number(taxa[1]) : null,
      modificadoEm
    };
  }

  const montarMidia = (id, { extras, arquivo, versao } = {}) => ({
    hls: resolverHls(id, extras),
    mp4: resolverMp4(extras),
    capa: resolverCapa(extras, arquivo, versao),
    previa: null,
    legendas: resolverLegendas(extras).map(l => ({ idioma: l.idioma, rotulo: l.rotulo, url: l.url })),
    embed: null,
    expiraEm: null
  });

  const indisponivel = async () => { throw new ErroProvedor('recurso-indisponivel'); };

  return {
    id: ID,
    configurado,
    /* O id é um caminho relativo OU um identificador curto (hls-xxxxxxxx): letras, números, `.`, `_`, `-`, `/`. */
    padraoId: PADRAO_ID,

    capacidades: () => ({
      uploadProtocolo: 'nenhum', envio: false, assinatura: false, drm: 'nenhum', embed: false, mp4: false, previa: false,
      sprites: false, clipe: false, capaPorUpload: false, capaPorTempo: false, legendaPorUpload: false, legendaIA: false,
      capitulosNativos: false, webhooks: false, uso: false,
      /* O cadastro é por endereço colado (`prepararFonte`), não por arquivo. */
      fontePorUrl: true,
      hostsMidia: hostsLimpos({})
    }),

    /* A base e os hosts permitidos, e só eles: ver o cabeçalho deste arquivo. Imagem, vídeo e fetch (playlist, segmentos, legenda). */
    hostsMidia() {
      const hosts = [];
      if (base) hosts.push('https://' + base.host);
      for (const p of permitidos) hosts.push('https://' + p);
      return hostsLimpos({ img: hosts, media: hosts, connect: hosts, frame: [], script: [] });
    },

    async validarCredenciais() {
      if (!configurado) {
        return { ok: false, codigo: 'provedor-nao-configurado', mensagem: mensagemDe('provedor-nao-configurado', { provedor: ID, faltando: 'HLS_BASE_URL' }) };
      }
      try {
        /* Qualquer resposta abaixo de 500 prova que o host existe e responde; a raiz de um bucket costuma dar 403/404. */
        const r = await buscar(baseTexto + '/', { method: 'HEAD', redirect: 'manual' });
        if (r.status === 401) return { ok: false, codigo: 'credenciais-recusadas', mensagem: mensagemDe('credenciais-recusadas') };
        if (r.status >= 500) return { ok: false, codigo: 'provedor-recusou-consulta', mensagem: mensagemDe('provedor-recusou-consulta') };
        return { ok: true, mensagem: '' };
      } catch (e) {
        return { ok: false, codigo: 'provedor-inacessivel', mensagem: mensagemDe('provedor-inacessivel') };
      }
    },

    criarUpload: indisponivel,
    async retomarUpload(id) { validarId(id); throw new ErroProvedor('recurso-indisponivel'); },

    async statusEncoding(id, { extras } = {}) {
      const v = await inspecionar(id, extras);
      return { estado: v.estado, progresso: v.progresso, duracaoSeg: v.duracaoSeg, titulo: null, estadoBruto: v.estadoBruto };
    },

    async urlReproducao(id, { assinar, extras } = {}) {
      validarId(id);
      /* Quem pediu URL assinada não recebe uma aberta: o HLS genérico não assina. */
      if (assinar === true) throw new ErroProvedor('assinatura-indisponivel');
      return { hls: resolverHls(id, extras), mp4: resolverMp4(extras), embed: null, expiraEm: null };
    },

    async urlCapa(id, { arquivo, versao, extras } = {}) {
      validarId(id);
      return resolverCapa(extras, arquivo, versao);
    },
    definirCapa: indisponivel,

    async urlPreview() { return { animada: null, clipeHls: null, sprite: null }; },

    /* As faixas que o título cadastrou (`extras.legendas`); `idiomas` não adivinha nome de arquivo. */
    async legendas(id, { extras } = {}) {
      validarId(id);
      return resolverLegendas(extras);
    },
    enviarLegenda: indisponivel,

    async obterVideo(id, { extras } = {}) {
      const v = await inspecionar(id, extras);
      return {
        id, titulo: null, duracaoSeg: v.duracaoSeg, criadoEm: v.modificadoEm, tamanhoBytes: null,
        estado: v.estado, progresso: v.progresso, framerate: v.framerate,
        arquivoCapa: null, urlCapa: resolverCapa(extras, undefined, undefined)
      };
    },

    /* Não há inventário do outro lado: o catálogo do site é a fonte. */
    async listar() { return { itens: [], proximo: null }; },

    /* Os arquivos são de quem hospeda: não há o que apagar daqui. Tirar o título é tirá-lo do catálogo. */
    async excluir(id) { validarId(id); return { ok: true, removido: false }; },

    /* Atalho de desempenho (ver contrato.js): a Midia inteira, sem rede, igual à composição. */
    async midia(id, p = {}) {
      validarId(id);
      return montarMidia(id, p);
    },

    /* O cadastro de um título por endereço: `{ hls, mp4?, capa?, legendas?: [{ idioma, rotulo?, url }] }`.
     * Confere cada endereço (https, host liberado, extensão), escolhe o id e devolve a `fonte` pronta para o catálogo.
     * Com `verificar`, lê o playlist (`statusEncoding`). Erro de endereço: ErroProvedor('parametro-invalido',
     * { detalhe: '<campo>:<motivo>' }), com motivo em 'invalida' | 'sem-https' | 'host-nao-permitido' | 'extensao'. */
    async prepararFonte(entrada, { verificar = false } = {}) {
      if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
      const dado = entrada && typeof entrada === 'object' ? entrada : {};
      const recusar = (campo, motivo) => { throw new ErroProvedor('parametro-invalido', { detalhe: campo + ':' + motivo }); };

      const hls = examinar(dado.hls, EXT_HLS);
      if (!hls.url) recusar('hls', hls.motivo);

      const extras = {};
      const prefixo = baseTexto + '/';
      let id = null;
      if (hls.url.startsWith(prefixo)) {
        const relativo = hls.url.slice(prefixo.length);
        if (!/[?#%]/.test(relativo) && PADRAO_ID.test(relativo)) id = relativo;
      }
      if (!id) { id = 'hls-' + hashCurto(hls.url); extras.hls = hls.url; }

      if (dado.mp4) {
        const mapa = typeof dado.mp4 === 'string' ? { '720p': dado.mp4 } : (typeof dado.mp4 === 'object' ? dado.mp4 : {});
        const mp4 = {};
        for (const [res, valor] of Object.entries(mapa)) {
          if (!PADRAO_RESOLUCAO.test(res)) recusar('mp4', 'invalida');
          const r = examinar(valor, EXT_MP4);
          if (!r.url) recusar('mp4', r.motivo);
          mp4[res] = r.url;
        }
        if (Object.keys(mp4).length) extras.mp4 = mp4;
      }
      if (dado.capa) {
        const r = examinar(dado.capa, EXT_IMAGEM);
        if (!r.url) recusar('capa', r.motivo);
        extras.capa = r.url;
      }
      if (Array.isArray(dado.legendas) && dado.legendas.length) {
        const faixas = [];
        for (const l of dado.legendas.slice(0, MAX_LEGENDAS)) {
          if (!l || !l.url) continue;
          if (typeof l.idioma !== 'string' || !PADRAO_IDIOMA.test(l.idioma)) recusar('legenda', 'invalida');
          const r = examinar(l.url, EXT_VTT);
          if (!r.url) recusar('legenda', r.motivo);
          faixas.push({ idioma: l.idioma, rotulo: (typeof l.rotulo === 'string' && l.rotulo.trim()) || rotuloDoIdioma(l.idioma), url: r.url });
        }
        if (faixas.length) extras.legendas = faixas;
      }

      const fonte = { provedor: ID, id, extras };
      if (!verificar) return { fonte };
      const v = await inspecionar(id, extras);
      return { fonte, estado: v.estado, estadoBruto: v.estadoBruto, duracaoSeg: v.duracaoSeg };
    }
  };
}
