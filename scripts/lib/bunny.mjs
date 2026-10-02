/* scripts/lib/bunny.mjs — cliente da API do Bunny Stream para os scripts de
 * carga em lote. Sem dependências: só o que vem no Node.
 *
 * A chave sai de variável de ambiente e nunca é escrita em disco.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const HOST = 'https://video.bunnycdn.com';

export function lerAmbiente() {
  const libraryId = process.env.BUNNY_LIBRARY_ID;
  const apiKey = process.env.BUNNY_API_KEY;
  if (!libraryId || !apiKey) {
    throw new Error(
      'defina BUNNY_LIBRARY_ID e BUNNY_API_KEY no ambiente.\n' +
      '  no .env da raiz:  BUNNY_LIBRARY_ID=123456  e  BUNNY_API_KEY=...\n' +
      '  (use a Stream API Key DA LIBRARY, não a Account API Key do painel geral)'
    );
  }
  return { libraryId: String(libraryId), apiKey: String(apiKey) };
}

export function criarCliente(ambiente = lerAmbiente()) {
  const { libraryId, apiKey } = ambiente;
  const base = `${HOST}/library/${libraryId}`;

  async function chamar(caminho, init = {}) {
    const r = await fetch(base + caminho, {
      ...init,
      headers: { AccessKey: apiKey, accept: 'application/json', ...(init.headers || {}) }
    });
    if (!r.ok) {
      throw new Error(`Bunny ${r.status} em ${caminho}: ${(await r.text()).slice(0, 400)}`);
    }
    return r;
  }

  return {
    libraryId,

    async criarVideo(titulo) {
      const r = await chamar('/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: titulo })
      });
      const v = await r.json();
      if (!v.guid) throw new Error('Bunny não devolveu o guid do vídeo');
      return v.guid;
    },

    async consultar(videoId) {
      return (await chamar(`/videos/${videoId}`)).json();
    },

    /* PUT direto: simples, mas uma queda no meio reinicia do zero.
     * Só para arquivos pequenos. */
    async enviarPut(videoId, caminho) {
      const { size } = await stat(caminho);
      const corpo = Readable.toWeb(createReadStream(caminho));
      const r = await fetch(`${base}/videos/${videoId}`, {
        method: 'PUT',
        headers: {
          AccessKey: apiKey,
          'content-type': 'application/octet-stream',
          'content-length': String(size)
        },
        body: corpo,
        duplex: 'half'
      });
      if (!r.ok) throw new Error(`PUT ${r.status}: ${(await r.text()).slice(0, 400)}`);
      return size;
    },

    /* Upload resumível. Obrigatório acima de ~2 GB e recomendado em conexão
     * instável. Retoma pelo offset que o próprio servidor informa. */
    async enviarTus(videoId, caminho, { pedacoMb = 50, aoProgredir } = {}) {
      const { size } = await stat(caminho);
      const expira = Math.floor(Date.now() / 1000) + 24 * 3600;
      const assinatura = assinarUpload(libraryId, apiKey, expira, videoId);

      const cabecalhosAuth = {
        AuthorizationSignature: assinatura,
        AuthorizationExpire: String(expira),
        VideoId: String(videoId),
        LibraryId: String(libraryId),
        'Tus-Resumable': '1.0.0'
      };

      const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
      const criacao = await fetch(`${HOST}/tusupload`, {
        method: 'POST',
        headers: {
          ...cabecalhosAuth,
          'Upload-Length': String(size),
          'Upload-Metadata': `filetype ${b64('video/mp4')},title ${b64(videoId)}`
        }
      });
      if (criacao.status !== 201) {
        throw new Error(`TUS create ${criacao.status}: ${(await criacao.text()).slice(0, 400)}`);
      }

      const local = criacao.headers.get('location');
      if (!local) throw new Error('TUS não devolveu o header Location');
      const alvo = local.startsWith('http') ? local : HOST + local;

      const pedaco = pedacoMb * 1024 * 1024;
      const arquivo = await open(caminho, 'r');
      try {
        let offset = 0;
        while (offset < size) {
          const tamanho = Math.min(pedaco, size - offset);
          const buffer = Buffer.allocUnsafe(tamanho);
          await arquivo.read(buffer, 0, tamanho, offset);

          const r = await fetch(alvo, {
            method: 'PATCH',
            headers: {
              ...cabecalhosAuth,
              'Upload-Offset': String(offset),
              'content-type': 'application/offset+octet-stream'
            },
            body: buffer
          });

          if (r.status !== 204) {
            throw new Error(`TUS patch ${r.status} no offset ${offset}: ${(await r.text()).slice(0, 300)}`);
          }
          const novo = Number(r.headers.get('upload-offset'));
          if (!Number.isFinite(novo) || novo <= offset) {
            throw new Error(`TUS não avançou o offset (era ${offset}, voltou ${novo})`);
          }
          offset = novo;
          if (aoProgredir) aoProgredir(offset, size);
        }
        return size;
      } finally {
        await arquivo.close();
      }
    },

    async enviarCapa(videoId, caminho) {
      const { size } = await stat(caminho);
      const corpo = Readable.toWeb(createReadStream(caminho));
      const r = await fetch(`${base}/videos/${videoId}/thumbnail`, {
        method: 'POST',
        headers: {
          AccessKey: apiKey,
          'content-type': 'application/octet-stream',
          'content-length': String(size)
        },
        body: corpo,
        duplex: 'half'
      });
      if (!r.ok) throw new Error(`capa ${r.status}: ${(await r.text()).slice(0, 300)}`);
    },

    /* Capítulos nativos do Bunny: é o que segmenta a linha do tempo do player e
     * mostra o título no hover — o efeito pedido, sem tocar no iframe.
     *
     * O formato da API é `{title, start, end}` com start/end em segundos
     * INTEIROS (int32). Mandar float não é recusado, mas o player arredonda e a
     * marca fica meio quadro fora do corte; por isso o arredondamento é aqui,
     * num lugar só.
     *
     * `chapters: []` apaga os capítulos do vídeo — é o desfazer de
     * scripts/capitulos.mjs --limpar.
     *
     * O update do Bunny é parcial: mandar só `chapters` não mexe em título,
     * legenda, capa nem em `moments`. */
    async definirCapitulos(videoId, capitulos) {
      const corpo = (capitulos || []).map(c => ({
        title: String(c.titulo != null ? c.titulo : c.title),
        start: Math.round(Number(c.inicio != null ? c.inicio : c.start)),
        end: Math.round(Number(c.fim != null ? c.fim : c.end))
      }));
      await chamar(`/videos/${videoId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapters: corpo })
      });
      return corpo.length;
    },

    async enviarLegenda(videoId, srt, srclang = 'pt', label = 'Português') {
      await chamar(`/videos/${videoId}/captions/${srclang}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          srclang,
          label,
          captionsFile: Buffer.from(srt, 'utf8').toString('base64')
        })
      });
    }
  };
}

/* expire é UNIX em SEGUNDOS. Em milissegundos, a assinatura não confere. */
export function assinarUpload(libraryId, apiKey, expira, videoId) {
  return createHash('sha256')
    .update(String(libraryId) + apiKey + String(expira) + String(videoId))
    .digest('hex');
}

/* Tabela de status do Bunny Stream. */
export const STATUS = {
  0: 'na fila', 1: 'processando', 2: 'codificando', 3: 'concluindo',
  4: 'pronto', 5: 'FALHOU', 6: 'apresentável', 7: 'upload falhou'
};
