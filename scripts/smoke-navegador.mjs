#!/usr/bin/env node
/* scripts/smoke-navegador.mjs — teste de fumaça no NAVEGADOR de verdade (Chromium via Playwright).
 *
 *   npm run smoke
 *   node scripts/smoke-navegador.mjs [--porta 8799] [--exigir] [--mostrar] [--manter] [--pasta-das-imagens pasta]
 *
 * O que faz: sobe `wrangler dev --local` (Worker + site, KV e D1 locais fora do projeto), semeia o catálogo de exemplo
 * (scripts/semear.mjs), e abre: a HOME (os cartões aparecem), a FICHA de um título, o /admin (entra com uma senha
 * descartável gerada na hora) o ASSISTENTE DE CONFIGURAÇÃO (e confere que a tabela de provedores cabe sem rolar) e MEDE o prazo do erro do player com segmentos
 * que travam (scripts/lib/prazo-player.mjs; no máximo 15 s). O botão Entrar nasce desabilitado: o teste entra sem esperar a rede. FALHA se aparecer exceção na página ou erro de console/rede
 * do nosso próprio site (o que vem de fora, como capa e vídeo do provedor, que não existem num teste local, é ignorado).
 *
 * É OPCIONAL: o projeto não tem dependências, então o Playwright e o Chromium vêm do computador (`npm i -g playwright`
 * e `npx playwright install chromium`). Sem eles o script AVISA e sai com 0 ("pulei"); com `--exigir` sai com 1.
 * Nunca usa a sua conta Cloudflare nem a rede: tudo é local. A senha e o segredo de sessão são sorteados a cada execução
 * e nunca são impressos. Códigos: 0 passou (ou pulou), 1 falhou, 2 uso incorreto. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { medirPrazoDoPlayer, LIMITE_DO_PRAZO_MS } from './lib/prazo-player.mjs';
import { caminhoDoPlaywright, argumentosDoWrangler, importa, IGNORAR_PADRAO, resumirProblemas } from './lib/smoke.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AJUDA = 'Uso: node scripts/smoke-navegador.mjs [--porta N] [--exigir] [--mostrar] [--manter] [--pasta-das-imagens pasta]';

/* Os seletores que o teste espera. Se uma tela mudar de marcação, ajuste AQUI (e só aqui). */
export const SELETORES = Object.freeze({
  cartaoDoTitulo: 'a.card, a.pcard',
  ficha: '#conteudo-ficha:not([hidden])',
  entrarSenha: '#senha',
  entrarFormulario: '#form-entrar',
  mesa: '#mesa:not([hidden])',
  assistente: '.asst-previa, [data-asst]',
  tabelaDeProvedores: '.a-tabela-provedores',
  menuIA: '[data-acao="tela"][data-tela="ia"]',
  telaIA: '.a.ia',
  recursoIA: 'input[data-ia="recurso"]'
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarServidor(url, ms, vivo) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (!vivo()) return false;
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return true; } catch { /* ainda subindo */ }
    await dormir(700);
  }
  return false;
}

function rodar(cmd, args, opcoes = {}) {
  return new Promise((resolve) => {
    const f = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opcoes });
    let saida = '';
    f.stdout.on('data', (d) => { saida += d; });
    f.stderr.on('data', (d) => { saida += d; });
    f.on('error', (e) => resolve({ codigo: 127, saida: saida + e.message }));
    f.on('close', (codigo) => resolve({ codigo: codigo ?? 1, saida }));
  });
}

export async function principal(argv = process.argv.slice(2), deps = {}) {
  const op = { porta: 8799, exigir: false, mostrar: false, manter: false, imagens: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--exigir') op.exigir = true;
    else if (a === '--mostrar') op.mostrar = true;
    else if (a === '--manter') op.manter = true;
    else if (a === '--porta') { op.porta = Number(argv[++i]); if (!Number.isInteger(op.porta) || op.porta < 1024 || op.porta > 65535) return { codigo: 2, texto: '--porta precisa ser um número entre 1024 e 65535.\n' }; }
    else if (a === '--pasta-das-imagens') { op.imagens = argv[++i]; if (!op.imagens) return { codigo: 2, texto: '--pasta-das-imagens precisa de um valor.\n' }; }
    else return { codigo: 2, texto: `Opção desconhecida: ${a}\n${AJUDA}\n` };
  }

  const modulo = (deps.caminhoDoPlaywright || caminhoDoPlaywright)();
  if (!modulo) {
    const msg = 'AVISO: Playwright não encontrado (instale com `npm i -g playwright` e `npx playwright install chromium`). Teste de fumaça PULADO.\n';
    return { codigo: op.exigir ? 1 : 0, pulado: true, texto: msg };
  }
  let chromium;
  try { ({ chromium } = await import(modulo)); } catch (e) { return { codigo: op.exigir ? 1 : 0, pulado: true, texto: `AVISO: não consegui carregar o Playwright (${e.message}). Teste de fumaça PULADO.\n` }; }

  const origem = `http://127.0.0.1:${op.porta}`;
  const senha = 'smoke-' + randomBytes(12).toString('hex');
  const segredoDeSessao = randomBytes(32).toString('hex');
  const pasta = await mkdtemp(path.join(tmpdir(), 'tela-smoke-'));
  const imagens = path.resolve(op.imagens || path.join(pasta, 'imagens'));
  const problemas = [];
  const log = [];
  const passo = (t) => { log.push(t); process.stdout.write(`  ${t}\n`); };
  let servidor = null, navegador = null, pagina = null, foto = async () => {};
  let vivo = true;
  let saidaDoServidor = '';

  const encerrar = async () => {
    if (navegador) { try { await navegador.close(); } catch { /* já fechou */ } }
    if (servidor && vivo) { try { process.kill(-servidor.pid, 'SIGTERM'); } catch { try { servidor.kill('SIGTERM'); } catch { /* já saiu */ } } await dormir(500); }
    if (!op.manter) await rm(pasta, { recursive: true, force: true });
  };

  try {
    process.stdout.write('Teste de fumaça no navegador\n');
    servidor = spawn('npx', argumentosDoWrangler({ porta: op.porta, persistirEm: path.join(pasta, 'estado'), senha, segredoDeSessao }), {
      cwd: RAIZ, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(pasta, 'logs') }
    });
    servidor.stdout.on('data', (d) => { saidaDoServidor += d; });
    servidor.stderr.on('data', (d) => { saidaDoServidor += d; });
    servidor.on('close', () => { vivo = false; });
    if (!(await esperarServidor(origem + '/', 180000, () => vivo))) {
      throw new Error('o wrangler dev não subiu a tempo. Últimas linhas:\n' + saidaDoServidor.split('\n').slice(-12).join('\n').replace(new RegExp(senha, 'g'), '***'));
    }
    passo('servidor local no ar');

    const semeou = await rodar(process.execPath, [path.join(RAIZ, 'scripts', 'semear.mjs'), '--catalogo', path.join(RAIZ, 'exemplo', 'catalogo.json')], {
      cwd: RAIZ, env: { ...process.env, APP_SITE_URL: origem, APP_SENHA: senha, APP_CATALOGO: '' }
    });
    if (semeou.codigo !== 0) throw new Error('não consegui semear o catálogo de exemplo:\n' + semeou.saida.replace(new RegExp(senha, 'g'), '***').slice(-600));
    passo('catálogo de exemplo semeado');

    navegador = await chromium.launch({ headless: !op.mostrar });
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', serviceWorkers: 'block' });
    pagina = await contexto.newPage();
    pagina.on('pageerror', (e) => problemas.push({ tipo: 'pageerror', url: pagina.url(), texto: e && e.message }));
    pagina.on('console', (m) => { if (m.type() === 'error') problemas.push({ tipo: 'console', url: (m.location() || {}).url || '', texto: m.text() }); });
    pagina.on('requestfailed', (r) => problemas.push({ tipo: 'requisicao', url: r.url(), texto: (r.failure() || {}).errorText || '' }));
    pagina.on('response', (r) => { if (r.status() >= 400) problemas.push({ tipo: 'resposta', status: r.status(), url: r.url(), texto: '' }); });
    foto = async (nome) => { try { await mkdir(imagens, { recursive: true }); await pagina.screenshot({ path: path.join(imagens, nome + '.png'), fullPage: true }); } catch { /* sem imagem, segue */ } };

    /* 1. HOME */
    await pagina.goto(origem + '/', { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector(SELETORES.cartaoDoTitulo, { timeout: 30000 });
    const titulo = await pagina.title();
    if (!titulo || /undefined|null/i.test(titulo)) throw new Error(`título da página estranho: "${titulo}"`);
    passo(`home abriu (${await pagina.locator(SELETORES.cartaoDoTitulo).count()} cartões, título "${titulo}")`);
    await foto('home');

    /* 2. FICHA DE UM TÍTULO */
    await pagina.locator(SELETORES.cartaoDoTitulo).first().click();
    await pagina.waitForSelector(SELETORES.ficha, { timeout: 20000 });
    passo('ficha do título abriu');
    await foto('ficha');

    /* 3. /ADMIN: entrar e achar o assistente */
    /* Entra SEM esperar a rede aquietar, de propósito: o botão "Entrar" nasce desabilitado e só abre quando a mesa liga o
     * ouvinte do formulário (senão o envio "à antiga" recarregaria a página e a senha digitada se perderia). O clique
     * do Playwright espera o botão ficar habilitado. */
    await pagina.goto(origem + '/admin', { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector(SELETORES.entrarSenha, { timeout: 20000 });
    await pagina.fill(SELETORES.entrarSenha, senha);
    await pagina.locator(`${SELETORES.entrarFormulario} button[type=submit]`).click();
    await pagina.waitForSelector(SELETORES.mesa, { timeout: 30000 });
    passo('/admin abriu e a entrada do superadmin funcionou');
    await foto('admin');
    await pagina.waitForSelector(SELETORES.assistente, { timeout: 30000 }).catch(() => { throw new Error('o assistente de configuração não apareceu depois da primeira entrada do superadmin (seletor: ' + SELETORES.assistente + ').'); });
    passo('assistente de configuração abriu');
    await foto('assistente');

    /* 3b. A comparação de provedores (passo 4) tem que caber sem rolar para o lado no desktop. */
    for (let i = 0; i < 3; i++) {
      await pagina.locator('[data-acao="asst-avancar"]').first().click();
      await pagina.waitForSelector('[data-acao="asst-avancar"]:not([disabled])', { timeout: 15000 });
    }
    await pagina.waitForSelector(SELETORES.tabelaDeProvedores, { timeout: 15000 }).catch(() => { throw new Error('a tabela comparativa de provedores não apareceu no passo do vídeo.'); });
    const medidas = await pagina.locator(SELETORES.tabelaDeProvedores).first().evaluate((t) => { const c = t.parentElement; return { rolagem: c.scrollWidth, caixa: c.clientWidth }; });
    await foto('assistente-provedores');
    if (medidas.rolagem > medidas.caixa + 1) throw new Error(`a tabela de provedores é cortada à direita no desktop (conteúdo ${medidas.rolagem}px numa caixa de ${medidas.caixa}px).`);
    passo('tabela de provedores cabe na tela, sem rolagem lateral');
    await dormir(800);   /* deixa o que ainda está carregando falhar, se for falhar */

    /* 3c. A tela IA (M9): abre sem erro, mostra o texto traduzido (nunca a chave crua) e tudo nasce desligado. */
    await pagina.locator(SELETORES.menuIA).first().click();
    await pagina.waitForSelector(SELETORES.telaIA, { timeout: 15000 }).catch(() => { throw new Error('a tela IA não abriu (seletor: ' + SELETORES.telaIA + ').'); });
    await pagina.waitForSelector(SELETORES.recursoIA, { timeout: 15000 }).catch(() => { throw new Error('a tela IA abriu mas não mostrou os recursos (a rota /api/ia respondeu?).'); });
    const ia = await pagina.locator(SELETORES.telaIA).first().evaluate((el) => ({ texto: el.innerText, ligados: el.querySelectorAll('input[data-ia="recurso"]:checked').length, total: el.querySelectorAll('input[data-ia="recurso"]').length }));
    await foto('ia');
    if (/\bia\.[a-zA-Z]+/.test(ia.texto)) throw new Error('a tela IA mostra uma chave de texto crua (falta tradução): ' + (ia.texto.match(/\bia\.[a-zA-Z.-]+/) || [''])[0]);
    if (!ia.total || ia.ligados !== 0) throw new Error(`na tela IA todo recurso deveria nascer desligado (ligados ${ia.ligados} de ${ia.total}).`);
    passo(`tela IA abriu: ${ia.total} recursos, todos desligados`);

    /* 4. O PRAZO DO ERRO DO PLAYER, medido de verdade: com segmentos que travam, o painel "Tentar de novo" aparece em até 15 s. */
    const prazos = await medirPrazoDoPlayer(navegador, { raizSite: path.join(RAIZ, 'core', 'site') });
    for (const p of prazos) {
      if (!p.ok) throw new Error(`prazo do erro do player (${p.cenario}): ${p.erro}`);
      passo(`erro do player com segmento ${p.cenario}: painel em ${(p.ms / 1000).toFixed(1)} s (limite ${LIMITE_DO_PRAZO_MS / 1000} s)`);
    }

    const relevantes = problemas.filter((p) => importa(p, origem, IGNORAR_PADRAO));
    if (relevantes.length) throw new Error(`erro de console/rede do próprio site (${relevantes.length}):\n${resumirProblemas(relevantes)}`);
    passo(`sem erros de console (${problemas.length - relevantes.length} avisos de fora ignorados)`);
    await encerrar();
    return { codigo: 0, texto: 'Teste de fumaça: PASSOU\n' };
  } catch (e) {
    /* Ao falhar, guarda uma imagem da tela e o que a página dizia, para quem for depurar. */
    let onde = '';
    if (pagina) {
      await foto('falhou');
      let estado = '';
      try { estado = (await pagina.locator('#estado-entrar').first().textContent({ timeout: 1000 })) || ''; } catch { /* sem o elemento */ }
      onde = `\n  Imagem da falha: ${path.join(imagens, 'falhou.png')}` + (estado.trim() ? `\n  Mensagem na tela de entrada: ${estado.trim()}` : '') +
        (problemas.length ? `\n  Problemas vistos:\n${resumirProblemas(problemas, 6)}` : '');
      op.manter = true;   /* a imagem precisa sobreviver à limpeza */
    }
    const msg = String(e && e.message || e).replace(new RegExp(senha, 'g'), '***').replace(new RegExp(segredoDeSessao, 'g'), '***');
    /* a última imagem fica para quem for depurar, só se pediu */
    await encerrar();
    return { codigo: 1, texto: `Teste de fumaça: FALHOU\n  ${msg}${onde}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await principal();
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
