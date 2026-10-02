/* scripts/capas.mjs — capas por template: escolhe bons quadros do próprio vídeo e compõe título e marca.
 *
 *   node scripts/capas.mjs --video arquivo.mp4 --titulo "Primeiros passos" [--saida pasta] [--quantas 3]
 *   node scripts/capas.mjs --item <id>[,<id>] [--catalogo arquivo.json]     usa o título e o arquivo do catálogo
 *   node scripts/capas.mjs --fila --item <id>[,<id>]    modo do executor (GitHub): título e vídeo vêm do SITE (APP_SITE_URL e APP_SENHA);
 *                                                      as candidatas ficam na pasta de saída (o fluxo as guarda como artefato). Nada vai ao ar.
 *   node scripts/capas.mjs ... --simular                                    só diz o que faria
 *   node scripts/capas.mjs ... --sem-titulo     só os quadros limpos      --fonte arquivo.ttf   fonte do título
 *   node scripts/capas.mjs ... --cor '#2563eb'                              cor da barra (padrão: a da marca na config)
 *
 * COMO escolhe: o ffmpeg detecta cortes de cena; logo depois de cada corte (e numa grade regular) tira um quadro
 * pequeno e mede brilho (descarta preto e estourado), nitidez (bordas, `sobel`) e contraste. Os N melhores, afastados
 * entre si, viram candidatas: `capa-1.jpg` (com título e marca) e `quadro-1.jpg` (limpo).
 *
 * CUSTO: zero. Roda na sua máquina (ou no executor do GitHub) com o ffmpeg; não usa IA nem rede.
 * Com `--item`, as candidatas ficam como SUGESTÃO em `item.midia_sugerida.capas` (revisado:false). Nada vai ao ar:
 * a pessoa escolhe uma no /admin (ou copia para `*_CAPA.jpg` e roda capas-legendas.mjs --so capas).
 *
 * Capa por MODELO de imagem (Workers AI flux e afins): existe como opção (`gerarCapaPorModelo`), DESLIGADA, e só
 * roda com `--modelo-imagem workers-ai --confirmo-custo`. Cobra por imagem na sua conta Cloudflare.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  verificarFfmpeg, sondar, detectarCenas, candidatosDeQuadro, extrairQuadro, medirImagem,
  pontuarQuadro, escolherDistintos, arred
} from './lib/ffmpeg.mjs';
import { comporCapa, acharFonte } from './lib/ffmpeg-midia.mjs';
import { proveniencia, registrarSugestao } from './lib/midia-gerada.mjs';

/** Pasta do título dentro de `saida`: o id (ou o nome do arquivo) sem caracteres perigosos. */
const pastaDe = (saida, nome) => path.join(saida, String(nome).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'titulo');

/**
 * Gera as candidatas. Devolve `{ candidatas:[{arquivo, quadro, t, nota, comTitulo}], avisos, duracao }`.
 * Lança se o ffmpeg não existe ou o vídeo não abre; quadro nenhum aproveitável não é erro: sai o melhor que houver, com aviso.
 */
export async function gerarCapas({ video, titulo, marca, cor, fonte, saida, quantas = 3, comTitulo = true, nome, aoProgredir = () => {} }) {
  const ff = await verificarFfmpeg();
  if (!ff.ok) throw Object.assign(new Error(ff.motivo), { codigo: 'sem-ffmpeg' });
  const avisos = [];
  const info = await sondar(video);
  const pasta = pastaDe(saida, nome || path.basename(video, path.extname(video)));
  await mkdir(pasta, { recursive: true });

  aoProgredir('procurando cortes de cena');
  const cenas = await detectarCenas(video, { limiar: 0.3 });
  const tempos = candidatosDeQuadro({ duracao: info.duracao, cenas });
  aoProgredir(`medindo ${tempos.length} quadros`);

  const medidos = [];
  for (const t of tempos) {
    const tmp = path.join(pasta, `.medida-${String(Math.round(t * 100))}.jpg`);
    try {
      await extrairQuadro(video, t, tmp, { largura: 480, qualidade: 5 });
      const m = await medirImagem(tmp);
      medidos.push({ t, ...m, nota: pontuarQuadro(m) });
    } catch (e) { avisos.push(`quadro em ${t}s ignorado: ${e.message.slice(0, 120)}`); }
    finally { await import('node:fs/promises').then((f) => f.rm(tmp, { force: true })); }
  }
  const escolhidos = escolherDistintos(medidos, quantas, Math.max(4, info.duracao * 0.06));
  if (!escolhidos.length) throw new Error('não achei nenhum quadro aproveitável (o vídeo é todo escuro?). Escolha a capa à mão.');
  if (escolhidos.length < quantas) avisos.push(`só ${escolhidos.length} quadro(s) bom(ns) neste vídeo`);

  let fontePath = null;
  if (comTitulo) {
    fontePath = await acharFonte(fonte);
    if (!fontePath || !ff.filtros.has('drawtext')) { avisos.push('sem fonte ou sem o filtro drawtext no ffmpeg: saem só os quadros limpos (use --fonte arquivo.ttf)'); fontePath = null; }
  }

  const candidatas = [];
  for (let i = 0; i < escolhidos.length; i++) {
    const q = escolhidos[i];
    const limpo = path.join(pasta, `quadro-${i + 1}.jpg`);
    await extrairQuadro(video, q.t, limpo, { largura: 1280, qualidade: 2 });
    let arquivo = limpo; let texto = false;
    if (fontePath && titulo) {
      arquivo = path.join(pasta, `capa-${i + 1}.jpg`);
      await comporCapa(limpo, arquivo, { titulo, marca, cor, fonte: fontePath, altura: info.largura && info.altura ? Math.round(1280 * info.altura / info.largura) : 720 });
      texto = true;
    }
    candidatas.push({ arquivo, quadro: limpo, t: arred(q.t, 2), nota: q.nota, comTitulo: texto });
  }
  return { candidatas, avisos, duracao: info.duracao, pasta };
}

/**
 * OPCIONAL, DESLIGADA: capa gerada por modelo de imagem. Cobra por imagem. `gerarImagem(prompt)` devolve bytes
 * (injetada: nos testes é falsa). O prompt leva o título e a sinopse, e a imagem sai marcada como 'ia'.
 */
export async function gerarCapaPorModelo({ titulo, sinopse, saida, gerarImagem, modelo = 'workers-ai/flux-1-schnell' }) {
  if (typeof gerarImagem !== 'function') throw new Error('capa por modelo está desligada (nenhum gerador de imagem configurado)');
  const prompt = `Capa de vídeo, sem texto nem letras, estilo cinematográfico. Tema: ${String(titulo).slice(0, 120)}. ${String(sinopse || '').slice(0, 300)}`;
  const bytes = await gerarImagem(prompt);
  if (!bytes || !bytes.length) throw new Error('o modelo de imagem não devolveu imagem');
  await writeFile(saida, bytes);
  return { arquivo: saida, prompt, proveniencia: proveniencia({ origem: 'ia', modelo }) };
}

/**
 * Workers AI (flux-1-schnell) por fetch puro: POST /accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell,
 * corpo { prompt, steps }, resposta { result: { image: <base64 jpeg> } }. NÃO CONFIRMADO ao vivo nesta sessão.
 * Credenciais só do ambiente (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN); nada passa pela linha de comando.
 */
export function geradorWorkersAi({ env = process.env, fetchFn = fetch } = {}) {
  return async (prompt) => {
    const conta = env.CLOUDFLARE_ACCOUNT_ID; const token = env.CLOUDFLARE_API_TOKEN;
    if (!conta || !token) throw new Error('faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN no ambiente (o token precisa do escopo Workers AI)');
    const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ prompt, steps: 4 })
    });
    if (!r.ok) throw new Error('Workers AI respondeu ' + r.status);
    const j = await r.json();
    const b64 = j && j.result && j.result.image;
    if (!b64) throw new Error('resposta do Workers AI sem imagem');
    return Buffer.from(b64, 'base64');
  };
}

/* ---------- linha de comando ---------- */

async function principal() {
  const { argumentos, lerCatalogo, gravarCatalogo, selecionar, CATALOGO_PADRAO, RAIZ, erroFatal } = await import('./lib/catalogo.mjs');
  const { carregarConfig } = await import('./lib/config-carregar.mjs');
  const op = argumentos();
  try {
    const cfg = await carregarConfig();
    const marca = cfg.config && cfg.config.marca && (cfg.config.marca.nomeCurto || cfg.config.marca.nome);
    const corPadrao = cfg.config && cfg.config.tema && cfg.config.tema.cores && cfg.config.tema.cores.escuro && cfg.config.tema.cores.escuro.primaria;
    const saida = path.resolve(typeof op.saida === 'string' ? op.saida : path.join(RAIZ, 'dados', 'midia-gerada'));
    const quantas = Math.min(6, Math.max(1, Number(op.quantas) || 3));
    const comum = { marca, cor: typeof op.cor === 'string' ? op.cor : corPadrao, fonte: typeof op.fonte === 'string' ? op.fonte : undefined, saida, quantas, comTitulo: !op['sem-titulo'] };

    let alvos;
    let catalogo = null; const caminhoCat = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
    if (op.fila) {
      const ids = typeof op.item === 'string' ? op.item.split(',').map((x) => x.trim()).filter(Boolean) : [];
      if (!ids.length) throw new Error('no modo --fila diga os títulos: --item id1,id2');
      const { entrar } = await import('./lib/ia-cliente.mjs');
      const { provedorDoAmbiente } = await import('./lib/provedores/index.mjs');
      const { alvosDaFila } = await import('./lib/ia-midia-fila.mjs');
      const cliente = await entrar({ site: typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL, senha: process.env.APP_SENHA || process.env.ADMIN_PASSWORD });
      const { provedor } = await provedorDoAmbiente();
      const r = await alvosDaFila({ cliente, provedor, config: cfg.config, ids });
      for (const p of r.pulados) console.log(`${p.id}: pulado (${p.motivo})`);
      alvos = r.alvos;
    } else if (op.item) {
      catalogo = await lerCatalogo(caminhoCat);
      alvos = selecionar(catalogo.itens, op).map((i) => ({ id: i.id, titulo: i.titulo, video: path.resolve(RAIZ, i.caminho_local || '') }));
    } else if (typeof op.video === 'string') {
      alvos = [{ id: path.basename(op.video, path.extname(op.video)), titulo: op.titulo || '', video: path.resolve(op.video) }];
    } else {
      console.error('Diga o vídeo: --video arquivo.mp4 --titulo "Nome"  ou  --item <id>. Veja o cabeçalho deste arquivo.'); process.exit(2);
    }
    if (op.simular) {
      for (const a of alvos) console.log(`gerariam-se ${quantas} candidata(s) de capa para "${a.titulo}" (${a.video}) em ${pastaDe(saida, a.id)}. Custo: zero (ffmpeg local).`);
      return;
    }
    if (op['modelo-imagem']) {
      if (op['modelo-imagem'] !== 'workers-ai' || !op['confirmo-custo']) { console.error('Capa por modelo de imagem cobra por imagem na sua conta Cloudflare (Workers AI). Para usar: --modelo-imagem workers-ai --confirmo-custo'); process.exit(3); }
      const gerar = geradorWorkersAi();
      for (const a of alvos) {
        const p = pastaDe(saida, a.id); await mkdir(p, { recursive: true });
        const r = await gerarCapaPorModelo({ titulo: a.titulo, saida: path.join(p, 'capa-modelo.jpg'), gerarImagem: gerar });
        console.log(`${a.id}: ${r.arquivo} (gerada por IA; revise antes de usar)`);
      }
      return;
    }
    for (const a of alvos) {
      console.log(`\n${a.id}`);
      const r = await gerarCapas({ ...comum, video: a.video, titulo: a.titulo, nome: a.id, aoProgredir: (m) => console.log('  ' + m) });
      for (const c of r.candidatas) console.log(`  ${path.relative(process.cwd(), c.arquivo)}  (aos ${c.t}s, nota ${c.nota})`);
      for (const av of r.avisos) console.log('  aviso: ' + av);
      if (catalogo) {
        const i = catalogo.itens.findIndex((x) => x.id === a.id);
        catalogo.itens[i] = registrarSugestao(catalogo.itens[i], 'capas', { candidatas: r.candidatas.map((c) => ({ arquivo: c.arquivo, quadro: c.quadro, t: c.t, nota: c.nota, comTitulo: c.comTitulo })) }, proveniencia({ origem: 'automatica' }));
      }
    }
    if (catalogo) { await gravarCatalogo(catalogo, caminhoCat); console.log('\nSugestões gravadas no catálogo (revisado:false). Nada foi publicado.'); }
  } catch (e) { erroFatal(e); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
