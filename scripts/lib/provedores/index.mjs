/* scripts/lib/provedores/index.mjs — o ESPELHO NODE dos adaptadores de vídeo.
 *
 * Não há segunda implementação: os scripts de carga usam EXATAMENTE os módulos
 * do Worker (core/worker/_lib/provedores/), que são ESM puro e só dependem de
 * `fetch` e `crypto.subtle` — os dois existem no Node 22. Aqui ficam só as
 * cascas que o Worker não tem:
 *
 *   provedorDoAmbiente()    carrega o .env, lê `video.provedor` de config/site.json e devolve o adaptador;
 *   enviarArquivo(...)      manda um ARQUIVO do disco seguindo o plano de upload do adaptador (TUS);
 *   idDoVideo / migrarFonte lêem `item.fonte` no formato de antes e no de depois do M4.
 *
 * Segredo sai de variável de ambiente (.env, já ignorado pelo git) e nunca vai
 * para arquivo nem para a tela. */
import { open, stat } from 'node:fs/promises';
import { carregarConfig } from '../config-carregar.mjs';
import { carregarEnv } from '../env.mjs';
import { criarProvedor, montarMidia, comMidia, listarProvedores, moduloDe, ErroProvedor, idiomasDeLegendaPadrao }
  from '../../../core/worker/_lib/provedores/index.js';
import App from '../../../core/site/catalogo-core.js';

export { criarProvedor, montarMidia, comMidia, listarProvedores, moduloDe, ErroProvedor, idiomasDeLegendaPadrao };
export const { migrarFonte, idDoVideo } = App;

/* Devolve { provedor, config }. `config` é a de config/site.json (validada) ou null se inválida:
 * nesse caso vale o provedor padrão e os nomes padrão de variável, com um aviso. */
export async function provedorDoAmbiente({ raiz, env = process.env, provedor, arquivo } = {}) {
  if (env === process.env) await carregarEnv();
  /* APP_CONFIG aponta para outro site.json (um ensaio, ou o config de outra instalação); sem ele vale config/site.json. */
  const lida = await carregarConfig({ raiz, arquivo: arquivo || (env === process.env ? process.env.APP_CONFIG : undefined) });
  if (!lida.ok) console.error('aviso: config/site.json inválida; usando o provedor padrão e as variáveis padrão.');
  const config = lida.ok ? lida.config : null;
  const adaptador = criarProvedor(config, env, { provedor });
  return { provedor: adaptador, config };
}

/* A URL da legenda de um título (primeiro idioma de `idiomas`, 'pt' por padrão), montada pelo
 * adaptador; null se o título não tem vídeo neste provedor. Sem rede. */
export async function urlDaLegenda(provedor, item, idioma = 'pt') {
  const v = videoDoItem(provedor, item);
  if (!v) return null;
  /* Quem monta por convenção (Bunny) devolve só o idioma pedido; quem guarda o endereço por título (HLS genérico)
   * devolve as faixas cadastradas, e aqui se escolhe a do idioma (ou a primeira). */
  const faixas = await provedor.legendas(v.id, { idiomas: [idioma], extras: v.extras });
  const raiz = String(idioma).split('-')[0];
  const casa = faixas.find(f => f.idioma === idioma) || faixas.find(f => String(f.idioma).split('-')[0] === raiz) || faixas[0];
  return casa ? casa.url : null;
}

/* O vídeo do item NESTE provedor: { id, extras }, ou null (sem vídeo, ou de outro provedor). É o que se passa
 * às funções do adaptador que aceitam `extras` (statusEncoding, obterVideo, urlCapa, legendas). */
export function videoDoItem(provedor, item) {
  const f = migrarFonte(item && item.fonte);
  if (!f.id || (f.provedor && f.provedor !== provedor.id)) return null;
  return { id: f.id, extras: f.extras };
}

/* Consultas de um título pelo adaptador (a mesma chamada para qualquer provedor). */
export async function statusDoItem(provedor, item) {
  const v = videoDoItem(provedor, item);
  if (!v) throw new Error('o título não tem vídeo no provedor "' + provedor.id + '"');
  return provedor.statusEncoding(v.id, { extras: v.extras });
}
export async function dadosDoItem(provedor, item) {
  const v = videoDoItem(provedor, item);
  if (!v) throw new Error('o título não tem vídeo no provedor "' + provedor.id + '"');
  return provedor.obterVideo(v.id, { extras: v.extras });
}

/* O que só alguns provedores fazem fica atrás de capacidade: o script recusa com mensagem clara, em vez de
 * falhar no meio da carga. `quem` é o que o script ia fazer ("trocar a capa"). */
export function exigirCapacidade(provedor, capacidade, quem) {
  if (provedor.capacidades()[capacidade] === true) return provedor;
  throw new Error('o provedor "' + provedor.id + '" não oferece isto (' + quem + '): capacidade "' + capacidade + '" desligada.');
}

/* 404 do provedor = o vídeo foi apagado lá (estado normal do acervo), não falha de rede. */
export const ehNaoEncontrado = (e) => e instanceof ErroProvedor && e.status === 404;

/* A mensagem de quando faltam credenciais, com os NOMES das variáveis. */
export function exigirConfigurado(provedor) {
  if (provedor.configurado) return provedor;
  throw new Error('o provedor "' + provedor.id + '" não está configurado: defina ' + (provedor.faltando || []).join(', ') + ' no .env da raiz.');
}

const base64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/* Manda o arquivo `caminho` conforme o `plano` de criarUpload/retomarUpload.
 * Hoje só TUS (Bunny e Cloudflare Stream): retoma pelo offset que o servidor informa.
 *   opcoes: { aoProgredir(feito, total), fetch } */
export async function enviarArquivo(plano, caminho, { aoProgredir, fetch: buscar = globalThis.fetch } = {}) {
  if (plano.protocolo !== 'tus') throw new Error('protocolo de envio não suportado pelos scripts: ' + plano.protocolo);
  const { size } = await stat(caminho);
  const cab = Object.assign({ 'Tus-Resumable': '1.0.0' }, plano.cabecalhos);

  let alvo = plano.url;
  let offset = 0;
  if (plano.modo === 'endpoint') {
    const metadados = Object.assign({ filetype: 'video/mp4' }, plano.metadados);
    const criacao = await buscar(plano.url, {
      method: 'POST',
      headers: Object.assign({}, cab, {
        'Upload-Length': String(size),
        'Upload-Metadata': Object.entries(metadados).map(([k, v]) => k + ' ' + base64(v)).join(',')
      })
    });
    if (criacao.status !== 201) throw new Error('TUS create ' + criacao.status + ': ' + (await criacao.text()).slice(0, 300));
    const local = criacao.headers.get('location');
    if (!local) throw new Error('TUS não devolveu o header Location');
    alvo = new URL(local, plano.url).toString();
  } else {
    /* 'url-pronta': o servidor já criou o upload; pergunta de onde retomar. */
    const cabeca = await buscar(plano.url, { method: 'HEAD', headers: cab });
    const atual = Number(cabeca.headers.get('upload-offset'));
    if (cabeca.ok && Number.isFinite(atual)) offset = atual;
  }

  const pedaco = plano.pedacoBytes;
  const arquivo = await open(caminho, 'r');
  try {
    while (offset < size) {
      const tamanho = Math.min(pedaco, size - offset);
      const buffer = Buffer.allocUnsafe(tamanho);
      await arquivo.read(buffer, 0, tamanho, offset);
      const r = await buscar(alvo, {
        method: 'PATCH',
        headers: Object.assign({}, cab, { 'Upload-Offset': String(offset), 'content-type': 'application/offset+octet-stream' }),
        body: buffer
      });
      if (r.status !== 204) throw new Error('TUS patch ' + r.status + ' no offset ' + offset + ': ' + (await r.text()).slice(0, 300));
      const novo = Number(r.headers.get('upload-offset'));
      if (!Number.isFinite(novo) || novo <= offset) throw new Error('TUS não avançou o offset (era ' + offset + ', voltou ' + novo + ')');
      offset = novo;
      if (aoProgredir) aoProgredir(offset, size);
    }
    return size;
  } finally {
    await arquivo.close();
  }
}
