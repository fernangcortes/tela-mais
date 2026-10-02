/* M8 — a calculadora de custo no /admin. A CONTA é a do guia (core/worker/_lib/custos.js); esta suíte confere a ponte —
 * GET /api/saude?custos=1&... devolve exatamente a conta do módulo, para a equipe, sem ler nem gravar nada — e a tela
 * (mesa-custos.js) rodando num DOM falso ligada a essa mesma conta: cenários, digitação sem tirar o cursor, câmbio local,
 * data dos preços e aviso de estimativa. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper } = require('./fixtures/contas-ambiente.js');
const { abrirOperacao } = require('./assistente-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const custos = () => import('../core/worker/_lib/custos.js');

/* ------------------------------------------------------------------ a ponte */

test('GET /api/saude?custos=1 devolve a conta do módulo, para a equipe, e só para quem tem sessão', async () => {
  const c = await custos();
  const env = ambiente();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const tSuper = await tokenDoSuper(worker, env);
  const http = cliente(worker, env);
  await http.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token: tSuper });
  const tEquipe = (await http.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).json.token;

  const q = '?custos=1&videos=300&horasPorVideo=1&visualizacoesMes=10000&minutosPorVisualizacao=20&publico=brasil&modoAcesso=publico';
  const r = await http.get('/api/saude' + q, { token: tEquipe });
  assert.equal(r.status, 200, r.texto);
  const esperado = c.estimarCusto({ videos: '300', horasPorVideo: '1', visualizacoesMes: '10000', minutosPorVisualizacao: '20', publico: 'brasil', modoAcesso: 'publico' });
  assert.equal(r.json.provedores.bunny.totalUsd, 174.75);
  assert.deepEqual(r.json.provedores, JSON.parse(JSON.stringify(esperado.provedores)));
  assert.deepEqual(r.json.cloudflare, JSON.parse(JSON.stringify(esperado.cloudflare)));
  assert.deepEqual(r.json.cenarios, JSON.parse(JSON.stringify(c.CENARIOS)), 'os cenários de partida vêm junto');
  assert.equal(r.json.dataDosValores, c.DATA_DOS_VALORES);
  assert.equal((await http.get('/api/saude' + q)).status, 401, 'sem sessão, não');
});

test('a consulta aceita só os campos da conta; o resto é ignorado, e o que vier torto a conta trata', async () => {
  const { onRequestGet } = await import('../core/worker/api/saude.js');
  const chamar = async (qs) => (await onRequestGet({ request: new Request('https://x.test/api/saude?custos=1' + qs), env: {}, data: {}, modo: 'publico', config: {} })).json();
  const padrao = await chamar('');
  assert.equal(padrao.entrada.videos, 50, 'sem números, os padrões');
  const torto = await chamar('&videos=abc&visualizacoesMes=-5&publico=lua&modoAcesso=aberto&horasPorVideo=');
  assert.equal(torto.entrada.videos, 50);
  assert.equal(torto.entrada.publico, 'brasil');
  assert.equal(torto.entrada.modoAcesso, 'publico');
  assert.ok(Number.isFinite(torto.provedores.bunny.totalUsd));
  const intruso = await chamar('&cambio=1&CAMBIO_BRL=1&__proto__=x&constructor=y');
  assert.equal(intruso.cambioBrl, 5.18, 'o câmbio não vem da consulta');
  const virgula = await chamar('&videos=12,5');
  assert.equal(virgula.entrada.videos, 12.5, 'vírgula decimal da pessoa vale');
});

test('a consulta da calculadora não toca em KV, D1 nem rede', async () => {
  const { onRequestGet } = await import('../core/worker/api/saude.js');
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('rede proibida'); };
  try {
    const sentinela = new Proxy({}, { get() { throw new Error('o ambiente não pode ser lido'); } });
    const r = await onRequestGet({ request: new Request('https://x.test/api/saude?custos=1'), env: sentinela, data: {}, modo: 'publico', config: {} });
    assert.equal(r.status, 200);
  } finally { globalThis.fetch = original; }
});

test('docs/custos.md traz a mesma data de preços do módulo', async () => {
  const c = await custos();
  const arquivo = path.join(RAIZ, 'docs', 'custos.md');
  if (!fs.existsSync(arquivo)) return;
  const [ano, mes, dia] = c.DATA_DOS_VALORES.split('-');
  const texto = fs.readFileSync(arquivo, 'utf8');
  assert.ok(texto.includes(c.DATA_DOS_VALORES) || texto.includes(`${dia}/${mes}/${ano}`), 'docs/custos.md precisa dizer a data dos preços: ' + c.DATA_DOS_VALORES);
});

/* ------------------------------------------------------------------ a tela */

async function rotas() {
  const c = await custos();
  return {
    '/api/saude': (url) => {
      const p = new URL(url, 'https://x.test').searchParams;
      const entrada = {};
      for (const [k, v] of p) if (k !== 'custos') entrada[k] = v;
      return Object.assign(c.estimarCusto(entrada), { cenarios: c.CENARIOS, padroes: c.PADROES });
    }
  };
}
async function abrir(opcoes = {}) {
  const t = abrirOperacao(Object.assign({ rotas: await rotas() }, opcoes));
  t.tela('custos');
  await t.esperar();
  return t;
}
const valorDe = (t, id) => t.achar('#' + id).value;
const consultas = (t) => t.pedidosDe('/api/saude').map((p) => new URL(p.url, 'https://x.test').searchParams);

test('a tela abre no cenário pequeno, com os números e o aviso de que é estimativa, e UMA pergunta ao servidor', async () => {
  const t = await abrir();
  assert.equal(valorDe(t, 'custo-videos'), '50');
  assert.equal(valorDe(t, 'custo-visualizacoesMes'), '500');
  assert.equal(valorDe(t, 'custo-cambio'), '5.18');
  assert.match(t.texto(), /É uma estimativa\./);
  assert.match(t.texto(), /pesquisa feita em 01\/10\/2026/);
  assert.match(t.texto(), /Mais barato/);
  assert.match(t.texto(), /Depende do serviço/);
  assert.match(t.texto(), /fica no plano grátis/);
  assert.ok(t.achar('[aria-live="polite"]'), 'o resultado é anunciado quando muda');
  assert.equal(t.achar('[data-acao="custo-cenario"][data-cenario="pequeno"]').getAttribute('aria-pressed'), 'true');
  assert.equal(consultas(t).length, 1);
});

test('o resultado mostra, por provedor, o vídeo em US$ e em R$, o total com o Worker e com o IOF, e de onde vem cada parte', async () => {
  const t = await abrir();
  const c = await custos();
  const linhas = t.todos('tr').filter((l) => l.querySelector('td'));
  assert.equal(linhas.length, 3);
  const bunny = linhas.find((l) => /Bunny/.test(l.textContent)).textContent;
  assert.match(bunny, /Mais barato/);
  assert.match(bunny, /US\$\s?9,44/);
  assert.match(bunny, /guardar US\$\s?1,00 · entregar US\$\s?8,44/, 'as partes da conta, em palavras');
  const stream = linhas.find((l) => /Cloudflare Stream/.test(l.textContent)).textContent;
  assert.match(stream, /US\$\s?25,00/);
  const r = c.estimarCusto(c.CENARIOS.pequeno);
  const reais = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
  assert.ok(bunny.includes(reais(r.provedores.bunny.totalUsd * r.cambioBrl)), 'o valor em reais é o dólar vezes o câmbio');
  assert.ok(bunny.includes(reais(r.totaisComHospedagem.bunny.totalUsd * r.cambioBrl * (1 + r.iof))), 'e o total com IOF');
  assert.match(t.texto(), /O IOF da compra no cartão internacional \(cerca de 6%\)/);
  assert.equal(t.todos('th[scope="col"]').length, 6);
});

test('trocar de cenário pergunta de novo e refaz os campos; digitar espera um instante, pergunta e muda só o resultado', async () => {
  const t = await abrir();
  t.clicar('[data-cenario="grande"]');
  await t.esperar();
  assert.equal(valorDe(t, 'custo-videos'), '2000');
  assert.match(t.texto(), /3\.415/);
  assert.equal(consultas(t).length, 2);
  assert.equal(consultas(t)[1].get('videos'), '2000');

  const campo = t.achar('#custo-visualizacoesMes');
  const antes = consultas(t).length;
  t.digitar(campo, '1');
  t.digitar(campo, '10');
  t.digitar(campo, '100');
  assert.equal(consultas(t).length, antes, 'nada vai ao servidor antes da espera');
  await t.esperar();
  assert.ok(consultas(t).length > antes, 'depois da espera, pergunta');
  assert.equal(consultas(t).pop().get('visualizacoesMes'), '100');
  assert.equal(t.achar('#custo-visualizacoesMes'), campo, 'redesenhar tudo tiraria o cursor de quem digita');
  assert.equal(t.achar('[data-cenario="grande"]').getAttribute('aria-pressed'), 'false', 'os números já não são os do cenário');
});

test('uma resposta que chega atrasada não passa por cima de uma mais nova', async () => {
  const c = await custos();
  const segurar = [];
  const t = abrirOperacao({ rotas: {
    '/api/saude': (url) => {
      const p = new URL(url, 'https://x.test').searchParams;
      const entrada = {}; for (const [k, v] of p) if (k !== 'custos') entrada[k] = v;
      const r = Object.assign(c.estimarCusto(entrada), { cenarios: c.CENARIOS, padroes: c.PADROES });
      /* a pergunta dos 7000 views demora; a de 70 views volta antes */
      return entrada.visualizacoesMes === '7000' ? new Promise((ok) => segurar.push(() => ok(r))) : r;
    }
  } });
  t.tela('custos');
  await t.esperar();
  t.digitar('#custo-visualizacoesMes', '7000');
  await t.esperar();
  t.digitar('#custo-visualizacoesMes', '70');
  await t.esperar();
  segurar.forEach((liberar) => liberar());
  await t.esperar();
  const dado = t.achar('#custo-resultado').textContent;
  assert.match(dado, /1\.400 minutos|1,400 minutes|1400/, 'o resultado é o de 70 visualizações (1.400 minutos), não o atrasado');
});

test('trocar o público ou quem pode ver pergunta de novo; o câmbio só refaz os reais, sem ir ao servidor', async () => {
  const t = await abrir();
  t.clicar('[data-cenario="medio"]');
  await t.esperar();
  const n = consultas(t).length;
  const antes = t.achar('#custo-resultado').textContent;
  t.mudar('#custo-publico', 'global');
  await t.esperar();
  assert.equal(consultas(t).length, n + 1);
  assert.equal(consultas(t).pop().get('publico'), 'global');
  assert.notEqual(t.achar('#custo-resultado').textContent, antes);
  t.mudar('#custo-modoAcesso', 'privado');
  await t.esperar();
  assert.equal(consultas(t).pop().get('modoAcesso'), 'privado');
  assert.match(t.texto(), /plano pago do Worker/, 'acesso restrito: o Worker precisa do plano pago');

  const depois = t.achar('#custo-resultado').textContent;
  const m = consultas(t).length;
  t.digitar('#custo-cambio', '10');
  assert.equal(consultas(t).length, m, 'câmbio é conta local');
  assert.notEqual(t.achar('#custo-resultado').textContent, depois);
  t.digitar('#custo-cambio', 'abc');
  assert.ok(!/NaN|undefined|Infinity/.test(t.texto()), 'câmbio torto cai no de partida');
});

test('o modo de acesso de partida é o do site, lido da tela Saúde', async () => {
  const t = abrirOperacao({ rotas: await rotas() });
  t.M.saude.dados = { modo: 'cadastro', checagens: [], resumo: {}, segredos: [] };
  t.tela('custos');
  await t.esperar();
  assert.equal(consultas(t).length, 1);
  assert.equal(t.M.custos.entradas.modoAcesso, 'cadastro');
  const opcoes = t.achar('#custo-modoAcesso').children;
  assert.deepEqual(opcoes.filter((o) => o.selected).map((o) => o.value), ['cadastro']);
});

test('muito movimento passa do limite grátis: a tela avisa do plano pago com o valor', async () => {
  const t = await abrir();
  t.digitar('#custo-visualizacoesMes', '2000000');
  await t.esperar();
  const c = await custos();
  const esperado = c.estimarCusto({ visualizacoesMes: 2000000 }).cloudflare;
  assert.equal(esperado.plano, 'pago');
  assert.match(t.texto(), /passam do limite do plano grátis/);
  assert.ok(t.texto().includes(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(esperado.totalUsd) + ' por mês'), 'o valor do plano pago vem da conta');
  t.digitar('#custo-videos', '0');
  await t.esperar();
  assert.match(t.texto(), /Sem vídeos ou sem visualizações/);
});

test('se o servidor falha, a tela mostra o erro e deixa tentar de novo (sem laço de recarga)', async () => {
  let falhar = true;
  const c = await custos();
  const t = abrirOperacao({ rotas: { '/api/saude': () => (falhar ? new Response(JSON.stringify({ codigo: 'nao-autorizado' }), { status: 500 }) : Object.assign(c.estimarCusto({}), { cenarios: c.CENARIOS, padroes: c.PADROES })) } });
  t.tela('custos');
  await t.esperar(30);
  assert.ok(t.achar('[role="alert"]'));
  assert.equal(consultas(t).length, 1, 'uma tentativa; a pessoa decide');
  falhar = false;
  t.clicar('[data-acao="custo-tentar"]');
  await t.esperar();
  assert.ok(t.achar('#custo-videos'), 'depois de tentar de novo, a tela aparece');
});

test('acessibilidade: campos com rótulo e dica ligada, tabela com legenda e cabeçalhos, links externos com noopener', async () => {
  const t = await abrir();
  for (const campo of t.todos('input').concat(t.todos('select'))) {
    assert.ok(t.todos('label').some((l) => l.getAttribute('for') === campo.id), 'sem rótulo: ' + campo.id);
    assert.ok(campo.getAttribute('aria-describedby'), 'sem dica ligada: ' + campo.id);
  }
  assert.equal(t.todos('caption').length, 1);
  assert.equal(t.todos('th[scope="row"]').length, 3, 'um cabeçalho de linha por provedor');
  const externos = t.todos('a[target="_blank"]');
  assert.ok(externos.length >= 4);
  assert.ok(externos.every((a) => /noopener/.test(a.getAttribute('rel')) && /^https:\/\//.test(a.getAttribute('href'))));
  assert.ok(t.todos('button').every((b) => b.textContent.trim().length > 0));
});

test('em inglês e em espanhol a tela sai no idioma, com o dinheiro no formato dele', async () => {
  for (const [idioma, trecho] of [['en', /This is an estimate\./], ['es', /Es una estimación\./]]) {
    const t = await abrir({ idioma });
    assert.match(t.texto(), trecho);
    assert.ok(!/custos\.|saude\.|assistente\./.test(t.texto()), 'chave crua na tela em ' + idioma);
  }
});
