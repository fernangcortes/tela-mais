/* As telas do espectador (entrar, cadastro, minha conta, privacidade, termos) e a tela Acesso do /admin:
 * o que dá para conferir sem navegador — a página existe, é acessível no básico, só usa tokens de tema, todo
 * texto vem do catálogo nos três idiomas, e a CSP libera o Turnstile só onde ele é desenhado. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper } = require('./fixtures/contas-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'core', 'site');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const PAGINAS = ['entrar.html', 'cadastro.html', 'conta.html', 'privacidade.html', 'termos.html'];
const catalogos = () => ['pt-BR', 'en', 'es'].reduce((o, id) => Object.assign(o, { [id]: JSON.parse(ler('core', 'locales', id + '.json')) }), {});

test('cada página do espectador: lang, viewport, noindex, título, um <h1>, pular para o conteúdo, sem script inline', () => {
  for (const f of PAGINAS) {
    const html = ler('core', 'site', f);
    assert.match(html, /<!doctype html>/i, f);
    assert.match(html, /<html lang="pt-BR">/, f);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, f);
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/, f + ': páginas de conta não são indexadas');
    assert.match(html, /<title>[^<]+<\/title>/, f);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, f + ': um <h1> só');
    assert.match(html, /<a class="pular" href="#conteudo"/, f);
    assert.match(html, /<main id="conteudo"[^>]*tabindex="-1"/, f);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), f + ': script inline brigaria com a CSP');
    assert.ok(!/\sstyle=|\son[a-z]+=/i.test(html), f + ': style/handler inline');
    assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['i18n.js', 'acesso.js'], f);
    for (const css of ['tokens-fixos.css', 'theme.css', 'acesso.css']) assert.ok(html.includes('href="' + css + '"'), f + ' sem ' + css);
  }
});

test('todo campo tem <label for>, todo botão tem texto, e cada id é único', () => {
  for (const f of PAGINAS) {
    const html = ler('core', 'site', f);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], f + ': id repetido');
    for (const m of html.matchAll(/<input\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
      assert.ok(new RegExp('<label[^>]*for="' + m[1] + '"').test(html), f + ': o campo #' + m[1] + ' não tem <label for>');
    }
    for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      assert.ok(m[1].trim() || /data-i18n=/.test(m[0]), f + ': botão sem texto');
    }
    for (const m of html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
      if (/type="(?:checkbox|hidden)"/.test(m[0])) continue;
      assert.ok(/\sid="/.test(m[0]), f + ': campo sem id: ' + m[0]);
    }
  }
  /* O e-mail pede o teclado certo e não corrige maiúscula. */
  const entrar = ler('core', 'site', 'entrar.html');
  assert.match(entrar, /type="email" id="email" autocomplete="email"/);
  assert.match(entrar, /autocomplete="current-password"/);
  assert.match(ler('core', 'site', 'cadastro.html'), /autocomplete="new-password"/);
});

test('o texto escrito nas páginas é o do catálogo pt-BR, e toda chave existe nos três idiomas', () => {
  const cat = catalogos();
  for (const f of PAGINAS.concat(['index.html'])) {
    const html = ler('core', 'site', f);
    for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
      const chave = m[2];
      for (const id of Object.keys(cat)) assert.ok(chave in cat[id], f + ': ' + chave + ' falta em ' + id);
      if (f !== 'index.html') assert.equal(m[3].trim(), String(cat['pt-BR'][chave]).trim(), f + ': o texto de ' + chave + ' difere do catálogo');
    }
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const par of m[1].split(';')) {
        const chave = par.slice(par.indexOf(':') + 1).trim();
        for (const id of Object.keys(cat)) assert.ok(chave in cat[id], f + ': ' + chave + ' falta em ' + id);
      }
    }
  }
});

test('o JavaScript das páginas só usa chaves que existem (tr, api.*, legal.*) nos três idiomas', () => {
  const cat = catalogos();
  for (const arquivo of ['acesso.js', 'mesa-acesso.js']) {
    const fonte = ler('core', 'site', arquivo).replace(/\/\*[\s\S]*?\*\//g, '');
    const chaves = new Set([...fonte.matchAll(/['"]((?:acesso|legal|api|telas|site|mesa)\.[A-Za-z0-9-]+)['"]/g)].map((m) => m[1]));
    assert.ok(chaves.size > 20, arquivo);
    for (const chave of chaves) for (const id of Object.keys(cat)) assert.ok(chave in cat[id], arquivo + ': ' + chave + ' falta em ' + id);
  }
  /* As seções do modelo legal montadas por contagem: 9 de privacidade, 7 de termos, com título. */
  for (const id of Object.keys(cat)) {
    for (let i = 1; i <= 9; i++) for (const k of ['legal.priv' + i, 'legal.priv' + i + 'T']) assert.ok(k in cat[id], k + ' em ' + id);
    for (let i = 1; i <= 7; i++) for (const k of ['legal.termos' + i, 'legal.termos' + i + 'T']) assert.ok(k in cat[id], k + ' em ' + id);
    /* O modelo é neutro: nada de marca de cliente, e o cliente é o controlador. */
    assert.ok(cat[id]['legal.priv1'].includes('{controlador}'), id);
    assert.ok(cat[id]['legal.priv7'].includes('{contato}'), id);
  }
  /* "Excluir apaga": o texto mostrado à pessoa diz o que de fato é apagado. */
  assert.match(cat['pt-BR']['acesso.excluirTexto'], /conta.*sessões.*convites.*links/);
});

test('a página de entrada: o token do link vai no fragmento, é tirado da barra e só é gasto por POST', () => {
  const js = ler('core', 'site', 'acesso.js');
  assert.match(js, /history\.replaceState/, 'o token sai da barra de endereço');
  assert.match(js, /\/api\/auth\/link/);
  assert.match(js, /\/api\/auth\/convite/);
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')), 'a sessão não passa pelo JavaScript');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js), 'nada de HTML montado de texto: sem XSS');
  const mesa = ler('core', 'site', 'mesa-acesso.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(mesa));
  /* "voltar" só aceita caminho do próprio site. */
  assert.match(js, /function destinoSeguro/);
});

test('só variáveis do tema nas folhas novas (zero cor literal) e o foco aparece', () => {
  const css = ler('core', 'site', 'acesso.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css));
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 44px/, 'alvo de toque');
  assert.match(css, /@media \(max-width: 420px\)/, 'celular');
});

test('o rodapé do catálogo leva privacidade, termos e Minha conta (só onde há contas)', () => {
  const html = ler('core', 'site', 'index.html');
  assert.match(html, /href="privacidade\.html"/);
  assert.match(html, /href="termos\.html"/);
  assert.match(html, /id="rodape-conta"[^>]*hidden/, 'Minha conta nasce escondido e o app.js o mostra fora do modo público');
  const app = ler('core', 'site', 'app.js');
  assert.match(app, /entrar\.html\?voltar=/);
  assert.match(app, /r\.status === 401\) irParaEntrar\(\)/);
});

test('a CSP libera o Turnstile só em entrar e cadastro; a home e o /admin seguem sem ele', async () => {
  const worker = await criarWorker(configDe({ modo: 'cadastro' }));
  const env = ambiente();
  for (const caminho of ['/entrar.html', '/entrar', '/cadastro.html']) {
    const r = await worker.fetch(new Request('https://exemplo.test' + caminho), env, {});
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/, caminho);
    assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/, caminho);
  }
  for (const caminho of ['/', '/admin.html', '/conta.html', '/privacidade.html', '/api/auth/estado']) {
    const r = await worker.fetch(new Request('https://exemplo.test' + caminho), env, {});
    assert.ok(!/challenges\.cloudflare\.com/.test(r.headers.get('content-security-policy')), caminho + ' não precisa do Turnstile');
  }
});

test('a mesa tem a tela Acesso só para o superadmin e carrega o arquivo dela, antes do mesa.js', () => {
  const mesa = ler('core', 'site', 'mesa.js');
  assert.match(mesa, /M\.sessao\.super \? itemMenu\('acesso'/);
  assert.match(mesa, /st\.tela === 'acesso' \? M\.telaAcesso\(\)/);
  const inicio = ler('core', 'site', 'mesa-inicio.js');
  assert.ok(inicio.indexOf('mesa-acesso.js') > 0 && inicio.indexOf('mesa-acesso.js') < inicio.indexOf("'mesa.js'"));
});

test('sessão da equipe dura o que `acesso.sessao.horasEquipe` manda', async () => {
  const worker = await criarWorker(configDe({ modo: 'publico', sessao: { horasEquipe: 2 } }));
  const env = ambiente();
  const r = await cliente(worker, env).post('/api/login', { senha: 'senha-do-super' });
  assert.equal(r.status, 200);
  const agora = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(r.json.expira - (agora + 2 * 3600)) < 5, 'expira em ' + (r.json.expira - agora) + ' s');
  const padrao = await cliente(await criarWorker(configDe({ modo: 'publico' })), ambiente()).post('/api/login', { senha: 'senha-do-super' });
  assert.ok(Math.abs(padrao.json.expira - (agora + 8 * 3600)) < 5);
});

test('Turnstile: com o secret mas sem a chave pública o cadastro continua FECHADO e o login não é trancado', async () => {
  const worker = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'email-e-senha' } }));
  const env = ambiente({ TURNSTILE_SECRET: 'segredo-do-turnstile-123' });
  const c = cliente(worker, env, { ip: '203.0.113.15' });
  const estado = await c.get('/api/auth/estado');
  assert.equal(estado.json.cadastroAberto, false);
  assert.equal(estado.json.turnstile.siteKey, '');
  const r = await c.post('/api/auth/cadastro', { email: 'a@exemplo.com', aceite: true, versoes: { privacidade: 1, termos: 1 }, senha: 'uma-senha-bem-comprida', turnstile: 'tok-qualquer-0123456789' });
  assert.equal(r.json.codigo, 'turnstile-nao-configurado');
  const sup = await tokenDoSuper(worker, env);
  const d = await c.get('/api/espectadores', { token: sup });
  assert.equal(d.json.diagnostico.cadastro.motivo, 'turnstile-sem-chave-publica');
  /* O login por link não exige token que a página não tem como produzir. */
  const privado = await criarWorker(configDe({ modo: 'privado' }));
  const e = await cliente(privado, env, { ip: '203.0.113.16' }).post('/api/auth/entrar', { email: 'a@exemplo.com' });
  assert.equal(e.status, 200);
});

test('cada id que o acesso.js procura existe na página da função que o procura', () => {
  const js = ler('core', 'site', 'acesso.js');
  const trecho = (de, ate) => { const i = js.indexOf(de); const j = js.indexOf(ate, i); assert.ok(i > 0 && j > i, de); return js.slice(i, j); };
  const casos = [
    ['entrar.html', trecho('function iniciarConfirmar', '/* ---------------------------------------------------------------- CADASTRO')],
    ['cadastro.html', trecho('function iniciarCadastro', '/* ------------------------------------------------------------------- CONTA')],
    ['conta.html', trecho('function iniciarConta', '/* ------------------------------------------------------------------- LEGAL')],
    ['privacidade.html', trecho('function iniciarLegal', '/* -------------------------------------------------------------------- início')],
    ['termos.html', trecho('function iniciarLegal', '/* -------------------------------------------------------------------- início')]
  ];
  for (const [pagina, codigo] of casos) {
    const html = ler('core', 'site', pagina);
    const ids = new Set([...codigo.matchAll(/(?:\$|mostrar|dizer)\('([\w-]+)'/g)].map((m) => m[1]));
    assert.ok(ids.size >= 4, pagina);
    for (const id of ids) assert.ok(new RegExp('\\sid="' + id + '"').test(html), pagina + ': o acesso.js procura #' + id + ' e a página não tem');
  }
  /* O que a página de entrada procura fora das funções de confirmar. */
  const entrar = ler('core', 'site', 'entrar.html');
  for (const id of ['titulo', 'carregando', 'bloco-publico', 'bloco-dentro', 'sair-botao', 'bloco-indisponivel', 'form-entrar', 'bloco-sem-email', 'form-senha', 'bloco-cadastro', 'email', 'entrar-botao', 'entrar-estado', 'senha-email', 'senha', 'senha-botao', 'senha-estado', 'turnstile', 'idioma', 'idioma-caixa']) {
    assert.ok(new RegExp('\\sid="' + id + '"').test(entrar), 'entrar.html sem #' + id);
  }
  const mesa = ler('core', 'site', 'mesa-acesso.js');
  assert.ok(/'ac-email'/.test(mesa) && /'ac-estado'/.test(mesa));
});
