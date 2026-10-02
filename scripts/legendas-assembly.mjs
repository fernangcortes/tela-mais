/* scripts/legendas-assembly.mjs — Task 3.3 pela API do AssemblyAI.
 *
 * Transcrição no servidor do AssemblyAI: o trabalho pesado não roda na sua
 * máquina, e os títulos são submetidos de uma vez em vez de um por vez.
 *
 * Pré-requisito:
 *     ASSEMBLYAI_API_KEY=...   (no .env da raiz)
 *
 * Uso:
 *     node scripts/legendas-assembly.mjs --simular     mostra o plano, não envia
 *     node scripts/legendas-assembly.mjs --piloto      só um lote pequeno, para testar
 *     node scripts/legendas-assembly.mjs               tudo que ainda não tem .srt
 *     node scripts/legendas-assembly.mjs --refazer     regera até as existentes
 *
 * NÃO sobe o vídeo: extrai só o áudio (mono, 16 kHz, 64 kbps). O acervo inteiro
 * vira algumas centenas de MB de áudio em vez de dezenas de GB de vídeo.
 *
 * RETOMÁVEL: o id de cada transcrição fica em `assemblyai-jobs.json`, ao lado do
 * catálogo. Interromper com Ctrl+C e rodar de novo não reenvia o que já foi
 * submetido — só busca o resultado.
 */
import { readFile, writeFile, access, mkdir, unlink, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { argumentos, lerCatalogo, selecionar, CATALOGO_PADRAO, agora, mb, erroFatal } from './lib/catalogo.mjs';

const API = 'https://api.assemblyai.com/v2';
const IDIOMA = 'pt';

/* Modelo explícito.
 *
 * Sem `speech_model` o script ficaria com o padrão da conta, que o provedor
 * pode mudar. Fixar o nome é o que faz duas rodadas do mesmo acervo saírem
 * comparáveis.
 *
 * O preço é POR HORA de áudio, não por minuto, e varia por modelo: confira a
 * tabela do provedor antes de rodar um acervo grande.
 *
 * O campo é `speech_models`, PLURAL e ARRAY — uma lista em ordem de prioridade,
 * com fallback para o próximo quando o primeiro não atende o idioma.
 *
 * Conferido contra a API submetendo 40 s de áudio: o pedido volta
 * 200 com `speech_models: ["universal-3-5-pro"]` ecoado e `speech_model` (o
 * singular) em `null` — são campos distintos, e `language_code: "pt"` continua
 * aceito junto com eles, ao lado de `punctuate` e `format_text`. */
const MODELO = process.env.ASSEMBLYAI_MODELO || 'universal-3-5-pro';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const arquivoEstado = path.join(path.dirname(caminhoCatalogo), 'assemblyai-jobs.json');

const chave = process.env.ASSEMBLYAI_API_KEY || '';
const existe = async (p) => { try { await access(p); return true; } catch { return false; } };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

function caminhoLegenda(item) {
  if (item.legenda_local) return item.legenda_local;
  const ext = path.extname(item.caminho_local);
  return item.caminho_local.slice(0, -ext.length) + '.srt';
}

async function lerEstado() {
  try {
    return JSON.parse(await readFile(arquivoEstado, 'utf8'));
  } catch {
    return {};
  }
}
const gravarEstado = (e) => writeFile(arquivoEstado, JSON.stringify(e, null, 1) + '\n', 'utf8');

/* Áudio mono em 16 kHz é o suficiente para reconhecimento de fala e reduz o
 * arquivo em duas ordens de grandeza — o que importa porque o upload é nosso. */
function extrairAudio(entrada, saida) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-v', 'error', '-i', entrada,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
      saida
    ]);
    let erro = '';
    ff.stderr.on('data', d => { erro += d; });
    ff.on('error', reject);
    ff.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg saiu com ' + c + ': ' + erro.slice(0, 300))));
  });
}

async function chamar(caminho, init = {}) {
  const r = await fetch(API + caminho, {
    ...init,
    headers: { authorization: chave, ...(init.headers || {}) }
  });
  if (!r.ok) {
    throw new Error(`AssemblyAI ${r.status} em ${caminho}: ${(await r.text()).slice(0, 300)}`);
  }
  return r;
}

async function enviarAudio(caminho) {
  const bytes = await readFile(caminho);
  const r = await chamar('/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes
  });
  const { upload_url } = await r.json();
  if (!upload_url) throw new Error('upload não devolveu upload_url');
  return upload_url;
}

async function submeter(audioUrl) {
  const r = await chamar('/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl, language_code: IDIOMA, punctuate: true, format_text: true,
      speech_models: [MODELO]
    })
  });
  const t = await r.json();
  if (!t.id) throw new Error('transcript não devolveu id');
  return t.id;
}

const consultar = async (id) => (await chamar('/transcript/' + id)).json();
const baixarSrt = async (id) => (await chamar('/transcript/' + id + '/srt')).text();

try {
  if (!chave) throw new Error('defina ASSEMBLYAI_API_KEY no ambiente');

  const catalogo = await lerCatalogo(caminhoCatalogo);
  const estado = await lerEstado();

  const alvos = [];
  for (const item of selecionar(catalogo.itens, op)) {
    /* Cartelas e sobras não têm fala — transcrever gastaria crédito para
     * devolver um .srt vazio, e a Task 3.4 geraria sinopse do nada. */
    if (item.pendencia === 'nao_e_conteudo') {
      console.warn(`  · pulando (não é conteúdo): ${item.titulo}`);
      continue;
    }
    const srt = caminhoLegenda(item);
    if (!op.refazer && await existe(srt)) continue;
    if (!(await existe(item.caminho_local))) {
      console.warn(`  ! arquivo ausente, pulando: ${item.arquivo}`);
      continue;
    }
    alvos.push({ item, srt });
  }

  const segundos = alvos.reduce((s, a) => s + (a.item.duracao_seg || 0), 0);
  console.log(`a transcrever: ${alvos.length} títulos, ${(segundos / 3600).toFixed(1)} h de áudio`);
  const jaSubmetidos = alvos.filter(a => estado[a.item.id]).length;
  if (jaSubmetidos) console.log(`  (${jaSubmetidos} já submetidos numa execução anterior — só vou buscar o resultado)`);

  if (!alvos.length) {
    console.log('nada a fazer: todos já têm .srt ao lado do master.');
    process.exit(0);
  }
  if (op.simular) {
    alvos.forEach(a => console.log('  ' + a.item.titulo));
    console.log('\n--simular: nada foi enviado.');
    process.exit(0);
  }

  const tmp = path.join(os.tmpdir(), 'tm-audio');
  await mkdir(tmp, { recursive: true });

  /* ---- fase 1: extrair, subir e submeter tudo ---- */
  console.log('\n== enviando ==');
  for (const alvo of alvos) {
    const { item } = alvo;
    if (estado[item.id]) continue;

    const audio = path.join(tmp, item.id + '.mp3');
    try {
      await extrairAudio(item.caminho_local, audio);
      const tamanho = (await stat(audio)).size;
      const url = await enviarAudio(audio);
      const id = await submeter(url);
      estado[item.id] = { transcricao: id, submetido_em: new Date().toISOString() };
      await gravarEstado(estado);
      console.log(`${agora()}  ↑ ${item.titulo}  (${mb(tamanho)} de áudio)`);
    } catch (e) {
      console.error(`${agora()}  ✖ ${item.titulo}: ${e.message}`);
    } finally {
      await unlink(audio).catch(() => {});
    }
  }

  /* ---- fase 2: colher os resultados ---- */
  console.log('\n== aguardando a transcrição ==');
  const pendentes = alvos.filter(a => estado[a.item.id]);
  let prontos = 0, falhas = 0, semFala = 0;

  while (pendentes.length) {
    for (let i = pendentes.length - 1; i >= 0; i--) {
      const { item, srt } = pendentes[i];
      const id = estado[item.id].transcricao;

      let t;
      try {
        t = await consultar(id);
      } catch (e) {
        console.error(`${agora()}  ✖ ${item.titulo}: ${e.message}`);
        pendentes.splice(i, 1); falhas++;
        continue;
      }

      if (t.status === 'completed') {
        /* Transcrição concluída e vazia = o áudio não tem fala. Acontece em
         * institucional de montagem, que é só trilha musical e texto na tela.
         * O endpoint /srt recusa esse caso com 400 — sem este desvio, um único
         * título sem narração derruba a execução inteira. */
        if (!t.text || !t.text.trim()) {
          console.warn(`${agora()}  · ${item.titulo}: sem fala no áudio ` +
            `(${t.audio_duration}s processados, 0 palavras) — não há o que legendar`);
          estado[item.id].sem_fala = true;
          estado[item.id].concluido_em = new Date().toISOString();
          await gravarEstado(estado);
          pendentes.splice(i, 1); semFala++;
          continue;
        }

        try {
          await writeFile(srt, await baixarSrt(id), 'utf8');
        } catch (e) {
          console.error(`${agora()}  ✖ ${item.titulo}: ${e.message}`);
          pendentes.splice(i, 1); falhas++;
          continue;
        }
        estado[item.id].concluido_em = new Date().toISOString();
        await gravarEstado(estado);
        pendentes.splice(i, 1); prontos++;
        console.log(`${agora()}  ✔ ${item.titulo}  ->  ${path.basename(srt)}`);
      } else if (t.status === 'error') {
        console.error(`${agora()}  ✖ ${item.titulo}: ${t.error}`);
        delete estado[item.id];          /* permite reenviar numa próxima rodada */
        await gravarEstado(estado);
        pendentes.splice(i, 1); falhas++;
      }
    }
    if (pendentes.length) {
      console.log(`  ${pendentes.length} em processamento… (aguardando 20 s)`);
      await espera(20000);
    }
  }

  console.log(`\nlegendas geradas: ${prontos}  ·  sem fala: ${semFala}  ·  falhas: ${falhas}`);
  if (semFala) {
    console.log('os títulos sem fala não terão legenda nem sinopse automática —');
    console.log('são institucionais de trilha musical, e a sinopse precisa ser escrita à mão.');
  }
  console.log('próximos passos:');
  console.log("  npm run ia:textos                    (sinopses etc. como sugestão, com custo avisado; ver docs/ia.md)");
  console.log('  node scripts/capas-legendas.mjs      (Task 3.2 — subir as legendas ao Bunny)');
} catch (e) {
  erroFatal(e);
}
