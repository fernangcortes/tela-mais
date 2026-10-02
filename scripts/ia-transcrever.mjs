/* scripts/ia-transcrever.mjs — gera a LEGENDA por IA dos títulos que ainda não têm (M9), como SUGESTÃO para revisar.
 *
 * Motor (ia.transcricao.provedor em config/site.json):
 *   workers-ai-whisper   padrão: Whisper no Workers AI, ~US$ 0,03/hora (estimativa de 2026-10-02; o áudio é fatiado em pedaços de 5 min)
 *   assemblyai           mais qualidade em nome próprio, ~US$ 0,21/hora
 *   openai               whisper-1 (com tempos)
 *   provedor-de-video    pede a legenda ao próprio Bunny/Stream (precisa da capacidade legendaIA)
 * De onde vem o áudio: do arquivo local do título (`caminho_local` no catálogo local, ou --arquivo) ou do endereço HLS do provedor
 * (o ffmpeg lê a playlist direto). ffmpeg é ferramenta externa: sem ele este script avisa e para.
 *
 * Nada vai ao ar. Custa dinheiro (exceto provedor-de-video no Stream): mostra a estimativa antes e só segue com --yes.
 *
 * Uso (da raiz do repositório):
 *     node scripts/ia-transcrever.mjs --item id1,id2 --simular
 *     node scripts/ia-transcrever.mjs --piloto --yes
 *     node scripts/ia-transcrever.mjs --item id1 --arquivo /caminho/master.mp4 --yes
 *     node scripts/ia-transcrever.mjs --todos --idioma pt --yes             (--refazer ignora a legenda que já existe) */
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { argumentos, erroFatal, lerCatalogo, CATALOGO_PADRAO } from './lib/catalogo.mjs';
import { carregarConfig } from './lib/config-carregar.mjs';
import { provedorDoAmbiente, videoDoItem } from './lib/provedores/index.mjs';
import { entrar } from './lib/ia-cliente.mjs';
import { rodarTranscricao } from './lib/ia-lote.mjs';
import { ffmpegDisponivel, extrairPedacos, extrairAudioUnico, duracaoDe } from './lib/ia-audio.mjs';

const op = argumentos();
try {
  const lida = await carregarConfig({ arquivo: process.env.APP_CONFIG });
  if (!lida.ok) throw new Error('config/site.json inválida: rode `npm run config:validar`');
  const config = lida.config;
  const site = typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL;
  const cliente = await entrar({ site, senha: process.env.APP_SENHA || process.env.ADMIN_PASSWORD });
  const { provedor } = await provedorDoAmbiente();

  /* Os caminhos de arquivo moram no catálogo LOCAL (nunca no site). Sem ele, só o HLS do provedor. */
  let locais = new Map();
  try { locais = new Map((await lerCatalogo(typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO)).itens.map((i) => [i.id, i.caminho_local])); } catch (e) { /* sem catálogo local */ }
  const pasta = await mkdtemp(path.join(os.tmpdir(), 'tela-ia-'));

  const audio = {
    async origemDe({ item, provedor: prov, fala, opcoes }) {
      if (fala.provedor === 'provedor-de-video') return { provedor: prov, video: videoDoItem(prov, item), referer: undefined };
      if (!ffmpegDisponivel()) throw new Error('o ffmpeg não está instalado (ffmpeg.org): ele tira o áudio do vídeo. Instale e rode de novo.');
      const arquivo = typeof opcoes.arquivo === 'string' ? opcoes.arquivo : locais.get(item.id);
      let entrada = arquivo;
      if (!entrada) {
        const v = videoDoItem(prov, item);
        const modoRestrito = config.acesso && config.acesso.modo !== 'publico';
        const u = await prov.urlReproducao(v.id, { extras: v.extras, assinar: Boolean(modoRestrito), validadeSeg: 7200 });
        entrada = u && u.hls;
        if (!entrada) throw new Error('não achei o vídeo para tirar o áudio (sem arquivo local e sem HLS do provedor)');
      }
      const duracaoSeg = Number(item.duracao_seg) || await duracaoDe(entrada).catch(() => null);
      const dir = path.join(pasta, item.id.replace(/[^A-Za-z0-9_-]/g, '_'));
      if (fala.provedor === 'assemblyai' || fala.provedor === 'openai') {
        return { audio: await extrairAudioUnico({ entrada, saida: path.join(dir, 'audio.mp3') }), mime: 'audio/mpeg', duracaoSeg };
      }
      return { pedacos: await extrairPedacos({ entrada, pasta: dir }), duracaoSeg };
    }
  };

  const r = await rodarTranscricao({ opcoes: op, cliente, config, env: process.env, provedor, audio });
  if (r.codigo !== 0) console.error('\n' + r.resumo);
  process.exit(r.codigo);
} catch (e) {
  erroFatal(e);
}
