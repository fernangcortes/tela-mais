/* scripts/sinopses.mjs — Task 3.4: gerar as sinopses a partir das legendas.
 *
 * Com o .srt em mãos, a sinopse deixa de exigir que alguém assista ao vídeo.
 * O trabalho vira revisão: a tela de admin mostra "não revisada" até alguém
 * confirmar.
 *
 * Pré-requisitos:
 *     npm install @anthropic-ai/sdk
 *     ANTHROPIC_API_KEY=...      (no .env da raiz; ou `ant auth login`)
 *
 * Uso:
 *     node scripts/sinopses.mjs --piloto          só um lote pequeno, para testar
 *     node scripts/sinopses.mjs                   todos que tiverem .srt
 *     node scripts/sinopses.mjs --refazer         regera até as já existentes
 *     node scripts/sinopses.mjs --simular         mostra o que faria
 *
 * Toda sinopse gerada aqui nasce com sinopse_origem: "auto" — nunca
 * "revisada". Quem revisa é gente, pela tela.
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { argumentos, lerCatalogo, gravarCatalogo, selecionar, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';

const MODELO = 'claude-opus-5';

/* A transcrição automática erra nome próprio e topônimo. Daí a proibição de
 * inventar nome: o que estiver errado na transcrição já é risco suficiente. */
const INSTRUCAO = `Você escreve sinopses para um catálogo de vídeos.

A partir da transcrição automática que o usuário enviar, escreva uma sinopse em português do Brasil seguindo exatamente estas regras:

- 2 a 3 frases, no máximo 60 palavras.
- Terceira pessoa. Descreva DO QUE TRATA o vídeo.
- Nunca comece com "Neste vídeo", "O vídeo", "Este material" ou equivalente.
- Sem juízo de valor: nada de "importante", "belíssimo", "imperdível".
- Não invente nome de pessoa, cidade ou instituição que não apareça na transcrição.
- A transcrição é automática e erra nomes próprios. Se um nome parecer duvidoso, escreva a sinopse sem ele.
- Se a transcrição for curta ou ininteligível demais para dizer do que trata, responda apenas: INSUFICIENTE

Responda somente com o texto da sinopse. Sem aspas, sem título, sem comentário.`;

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

const existe = async (p) => { try { await access(p); return true; } catch { return false; } };

/* Descarta numeração e timecodes; sobra o texto falado. */
function textoDoSrt(srt) {
  return srt
    .split(/\r?\n/)
    .filter(l => !/^\d+$/.test(l.trim()))
    .filter(l => !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(l.trim()))
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function caminhoLegenda(item) {
  if (item.legenda_local) return item.legenda_local;
  if (!item.caminho_local) return null;
  const ext = path.extname(item.caminho_local);
  return item.caminho_local.slice(0, -ext.length) + '.srt';
}

/* Carregado sob demanda: --simular precisa rodar sem o SDK instalado. */
async function carregarSdk() {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return Anthropic;
  } catch {
    throw new Error(
      'o SDK da Anthropic não está instalado.\n' +
      '  npm install @anthropic-ai/sdk'
    );
  }
}

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const alvos = [];

  for (const item of selecionar(catalogo.itens, op)) {
    if (item.sinopse && !op.refazer) continue;
    const srt = caminhoLegenda(item);
    if (!srt || !(await existe(srt))) continue;
    alvos.push({ item, srt });
  }

  console.log(`legendas disponíveis para gerar sinopse: ${alvos.length}`);
  if (!alvos.length) {
    console.log('nada a fazer. Rode scripts/legendas-whisper.ps1 antes (Task 3.3).');
    process.exit(0);
  }

  if (op.simular) {
    alvos.forEach(a => console.log('  ' + a.item.titulo));
    console.log('\n--simular: nenhuma chamada foi feita.');
    process.exit(0);
  }

  const Anthropic = await carregarSdk();
  const cliente = new Anthropic();
  let feitas = 0, insuficientes = 0, erros = 0;

  for (const { item, srt } of alvos) {
    const transcricao = textoDoSrt(await readFile(srt, 'utf8'));

    if (transcricao.length < 200) {
      console.log(`${agora()}  ·  ${item.titulo} — transcrição curta demais, pulando`);
      insuficientes++;
      continue;
    }

    try {
      const resposta = await cliente.beta.messages.create({
        model: MODELO,
        max_tokens: 16000,
        system: INSTRUCAO,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        /* Se um classificador recusar, a API cai para outro modelo em vez de
         * devolver a rodada vazia no meio de um lote de 50. */
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{
          role: 'user',
          content: `Título do vídeo: ${item.titulo}\nSérie: ${item.serie}\n\nTranscrição:\n${transcricao}`
        }]
      });

      if (resposta.stop_reason === 'refusal') {
        console.log(`${agora()}  ✖  ${item.titulo} — recusado (${resposta.stop_details?.category ?? 'sem categoria'})`);
        erros++;
        continue;
      }

      const texto = resposta.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join(' ')
        .trim();

      if (!texto || texto === 'INSUFICIENTE') {
        console.log(`${agora()}  ·  ${item.titulo} — transcrição não permite descrever o conteúdo`);
        insuficientes++;
        continue;
      }

      item.sinopse = texto;
      item.sinopse_origem = 'auto';
      feitas++;
      await gravarCatalogo(catalogo, caminhoCatalogo);
      console.log(`${agora()}  ✔  ${item.titulo}\n     ${texto}\n`);
    } catch (e) {
      erros++;
      console.error(`${agora()}  ✖  ${item.titulo}: ${e.message}`);
    }
  }

  console.log(`\ngeradas: ${feitas}  ·  sem material: ${insuficientes}  ·  erros: ${erros}`);
  console.log('todas marcadas como `auto` — a tela de admin vai pedir revisão antes de dar por boas.');
} catch (e) {
  erroFatal(e);
}
