/* M8 — os textos e a fiação das telas de operação. O servidor só manda CÓDIGOS (saúde, erros, motivos); quem escreve a frase é o
 * catálogo de idiomas. Aqui se confere que não existe código sem frase nos três idiomas, que cada tela está ligada à mesa
 * (menu, trilha, centro, painel e carregador de scripts) e que nada de interface foi escrito à mão no código. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const LOCALES = Object.fromEntries(['pt-BR', 'en', 'es'].map((id) => [id, JSON.parse(ler('core/locales/' + id + '.json'))]));
const em = (chave) => Object.entries(LOCALES).filter(([, t]) => !(chave in t)).map(([id]) => id);

function todosOsTextos(chaves) {
  const faltando = [];
  for (const chave of chaves) for (const id of em(chave)) faltando.push(id + ': ' + chave);
  return faltando;
}

test('toda checagem de saúde tem título, mensagem (e como corrigir, quando não está ok) nos três idiomas', () => {
  const fonte = ler('core/worker/_lib/saude.js');
  const emitidas = [...fonte.matchAll(/\bc\('([\w-]+)',\s*(?:'(\w+)'|[^,]+),\s*'([\w-]+)'/g)].map((m) => ({ id: m[1], codigo: m[3] }));
  assert.ok(emitidas.length >= 35, 'o extrator achou pouco: ' + emitidas.length);
  const SO_INFORMA = new Set(['config-sem-estado', 'video-conexao-sem-credenciais', 'video-conexao-sem-teste', 'versao-desconhecida', 'acesso-modo', 'catalogo-ok', 'd1-dispensado']);
  const chaves = [];
  for (const { id, codigo } of emitidas) {
    chaves.push('saude.t.' + id, 'saude.c.' + codigo);
    if (!/-ok$|-atual$|-recente$|^acesso-modo$|^d1-dispensado$/.test(codigo) && !SO_INFORMA.has(codigo)) chaves.push('saude.f.' + codigo);
  }
  assert.deepEqual(todosOsTextos(chaves), []);
});

test('todo modo de acesso, origem de backup, estado e parte do backup tem nome nos três idiomas', () => {
  const chaves = [];
  for (const m of ['publico', 'cadastro', 'privado']) chaves.push('saude.modo.' + m, 'assistente.acesso.' + m + '.nome', 'assistente.acesso.' + m + '.resumo', 'assistente.acesso.' + m + '.quem', 'assistente.acesso.' + m + '.como', 'assistente.acesso.' + m + '.cuidado');
  for (const o of ['admin', 'script', 'workflow']) chaves.push('saude.origem.' + o);
  for (const p of ['catalogo', 'operacao', 'legal', 'contas']) chaves.push('backup.parte.' + p, 'backup.parteDica.' + p);
  assert.deepEqual(todosOsTextos(chaves), []);
});

test('todo código de erro das rotas e libs novas tem frase em api.* (o servidor devolve o código, a mesa traduz)', () => {
  const codigos = new Set();
  for (const rel of ['core/worker/api/saude.js', 'core/worker/api/backup.js']) for (const m of ler(rel).matchAll(/erro\(\d{3},\s*'([\w-]+)'/g)) codigos.add(m[1]);
  for (const m of ler('core/worker/_lib/backup.js').matchAll(/codigo:\s*'([\w-]+)'/g)) codigos.add(m[1]);
  for (const m of ler('core/worker/_lib/assistente.js').matchAll(/codigo:\s*'([\w-]+)'/g)) codigos.add(m[1]);
  codigos.add('config-recusada');
  assert.ok(codigos.size >= 12, 'extrator achou pouco: ' + [...codigos].join(','));
  assert.deepEqual(todosOsTextos([...codigos].map((c) => 'api.' + c)), []);
});

test('todo erro do gerador de config (assistente) tem frase em assistente.erro.* — e as da tela também', () => {
  const fonte = ler('core/worker/_lib/assistente.js');
  const codigos = new Set([...fonte.matchAll(/falha\('[\w.]+',\s*'([\w-]+)'/g)].map((m) => m[1]));
  for (const m of ler('core/site/mesa-assistente.js').matchAll(/codigo:\s*'([\w-]+)'/g)) codigos.add(m[1]);
  assert.ok(codigos.size >= 14, [...codigos].join(','));
  assert.deepEqual(todosOsTextos([...codigos].map((c) => 'assistente.erro.' + c)), []);
});

test('cada modelo de uso, provedor, variável de ambiente, tema e passo do assistente tem texto nos três idiomas', async () => {
  const lib = await import('../core/worker/_lib/assistente.js');
  const d = lib.dadosDoAssistente({ config: {}, env: {} });
  const chaves = [];
  for (const p of d.presets) chaves.push('assistente.preset.' + p.id + '.nome', 'assistente.preset.' + p.id + '.resumo');
  for (const p of d.provedores) {
    chaves.push('assistente.provedor.' + p.id + '.nome', 'assistente.provedor.' + p.id + '.oQueE', 'assistente.provedor.' + p.id + '.custo', 'custos.cenario.pequeno');
    for (const c of p.credenciais) chaves.push('assistente.onde.' + c.env);
  }
  for (const passo of ['identidade', 'uso', 'acesso', 'video', 'idiomas', 'home', 'pronto']) chaves.push('assistente.passo.' + passo, 'assistente.ajuda.' + passo + '.titulo', 'assistente.ajuda.' + passo + '.texto');
  for (const i of d.idiomasDoProduto) chaves.push('assistente.idioma.' + (i === 'pt-BR' ? 'ptBR' : i));
  for (const id of ['cinema', 'claro', 'altoContraste', 'institucional', 'vibrante', 'aconchegante']) chaves.push('assistente.tema.' + id);
  for (const tema of d.temas) assert.ok(['cinema', 'claro', 'alto-contraste', 'institucional', 'vibrante', 'aconchegante'].includes(tema.id), 'tema novo sem texto no assistente: ' + tema.id);
  assert.deepEqual(todosOsTextos(chaves), []);
});

test('o aviso de mudança por área (assistente.area.*) cobre toda seção de topo do config/site.json', () => {
  const esquema = JSON.parse(ler('config/site.schema.json'));
  const secoes = Object.keys(esquema.properties).filter((k) => !['$schema', 'versaoDoEsquema', 'ia', 'mcp', 'seo', 'textos', 'tituloBase'].includes(k));
  for (const secao of secoes) {
    /* área sem texto cai em "outros ajustes" (implantação): só é falha se a chave nem existir para o que a tela usa */
    assert.ok(['assistente.area.' + secao, 'assistente.area.implantacao'].some((k) => em(k).length === 0), secao);
  }
  assert.deepEqual(todosOsTextos(['assistente.area.implantacao', 'assistente.area.marca', 'assistente.area.tema', 'assistente.area.acesso', 'assistente.area.video', 'assistente.area.idiomas', 'assistente.area.home', 'assistente.area.catalogo', 'assistente.area.recursos', 'assistente.area.player', 'assistente.area.preset']), []);
});

test('toda chave citada por tr(\'...\') nas telas novas existe, e as dinâmicas (prefixo + código) também', () => {
  const arquivos = ['mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js'];
  const faltando = [];
  for (const a of arquivos) {
    const fonte = ler('core/site/' + a);
    for (const m of fonte.matchAll(/'((?:assistente|saude|backup|custos|operacao)\.[\w-]+(?:\.[\w-]+)*)'/g)) {
      if (!(m[1] in LOCALES['pt-BR'])) faltando.push(a + ': ' + m[1]);
    }
  }
  assert.deepEqual(faltando, []);
});

test('cada tela de operação está ligada à mesa: carregador, menu, trilha, centro e painel', () => {
  const inicio = ler('core/site/mesa-inicio.js');
  const ordem = [...inicio.matchAll(/'([\w./-]+\.js)'/g)].map((m) => m[1]);
  for (const arquivo of ['mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js']) assert.ok(ordem.includes(arquivo), arquivo + ' não é carregado pela mesa');
  assert.ok(!ordem.includes('custos-core.js'), 'a conta de custo é do servidor (_lib/custos.js), não do navegador');
  assert.ok(ordem.indexOf('mesa-saude.js') < ordem.indexOf('mesa-backup.js'), 'a tela Saúde define o que as outras usam (M.operacao)');
  assert.ok(ordem.indexOf('mesa-saude.js') < ordem.indexOf('mesa-assistente.js'));
  assert.equal(ordem[ordem.length - 1], 'mesa.js', 'mesa.js é o último');
  const mesa = ler('core/site/mesa.js');
  const painel = ler('core/site/mesa-painel.js');
  for (const [tela, fn, pn] of [['saude', 'telaSaude', 'painelSaude'], ['backup', 'telaBackup', 'painelBackup'], ['custos', 'telaCustos', 'painelCustos'], ['assistente', 'telaAssistente', 'painelAssistente']]) {
    assert.match(mesa, new RegExp("itemMenu\\('" + tela + "'"), tela + ' sem item de menu');
    assert.match(mesa, new RegExp("st\\.tela === '" + tela + "' \\? \\[tr\\("), tela + ' sem trilha');
    assert.match(mesa, new RegExp("M\\." + fn + "\\(\\)"), tela + ' sem desenho no centro');
    assert.match(painel, new RegExp("M\\.st\\.tela === '" + tela + "' && M\\." + pn), tela + ' sem painel da direita');
  }
  assert.match(mesa, /if \(M\.aoAbrirMesa\) M\.aoAbrirMesa\(\)/);
  assert.match(mesa, /M\.sessao\.super \? itemMenu\('assistente'/, 'o assistente só aparece no menu do superadmin');
  assert.ok(!/NO_QUADRO = \{[^}]*(saude|backup|custos|assistente)/.test(mesa), 'estas telas desenham no centro, não no quadro do site');
});

test('as telas novas só usam o document para escutar com o prefixo delas, e nunca guardam estado no navegador', () => {
  for (const [arquivo, prefixo] of [['mesa-saude.js', 'saude-'], ['mesa-backup.js', 'bkp-'], ['mesa-custos.js', 'custo'], ['mesa-assistente.js', 'asst-']]) {
    const fonte = ler('core/site/' + arquivo);
    for (const m of fonte.matchAll(/closest\('\[data-acao(?:\^)?="([\w-]+)/g)) assert.ok(m[1].startsWith(prefixo), arquivo + ': escuta ' + m[1]);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(fonte), arquivo + ' guarda estado no navegador');
    assert.ok(!/innerHTML\s*=/.test(fonte), arquivo + ' escreve HTML cru');
    assert.ok(!/eval\(|new Function\(/.test(fonte));
  }
});

test('nenhuma cor escrita à mão nas telas novas nem no CSS delas: só tokens do tema', () => {
  const css = ler('core/site/mesa.css');
  const bloco = css.slice(css.indexOf('Operação (M8)'));
  assert.ok(bloco.length > 500, 'o bloco do M8 sumiu do mesa.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(bloco), 'cor literal no CSS do M8');
  for (const a of ['mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js']) {
    assert.ok(!/#[0-9a-fA-F]{6}\b|rgba?\(/.test(ler('core/site/' + a)), 'cor literal em ' + a);
  }
});

test('o assistente e as telas novas não escrevem a marca do produto na interface', () => {
  for (const id of Object.keys(LOCALES)) {
    for (const [chave, valor] of Object.entries(LOCALES[id])) {
      if (!/^(assistente|saude|backup|custos|operacao)\./.test(chave)) continue;
      const texto = typeof valor === 'string' ? valor : Object.values(valor).join(' ');
      assert.ok(!/tela\s*m\s*AI?s|telamais/i.test(texto), id + ' ' + chave + ' cita o nome do produto');
    }
  }
});

test('as rotas de operação estão na matriz com o papel certo (equipe vê, superadmin muda)', async () => {
  const { PERMISSOES } = await import('../core/worker/permissoes.js');
  assert.deepEqual(PERMISSOES['/api/saude'], { GET: 'equipe', POST: 'super', PUT: 'super' });
  assert.deepEqual(PERMISSOES['/api/backup'], { GET: 'equipe', POST: 'super' });
});
