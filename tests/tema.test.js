// Testes do tema (M3): presets, contraste, tokens de cor, tipografia e geração do theme.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarConfig } from '../core/worker/_lib/config-validar.mjs';
import {
  contraste, verificarPaleta, sugerirCor, normalizarHex, PARES_DE_CONTRASTE
} from '../core/worker/_lib/contraste.mjs';
import { resolverTema, CHAVES_DE_COR } from '../core/worker/_lib/tema.mjs';
import { PRESETS, NOMES_DOS_PRESETS, PRESET_PADRAO } from '../core/presets/temas/index.mjs';
import { aplicarConfig } from '../scripts/aplicar-config.mjs';
import { gerarThemeCss, gerarManifest } from '../scripts/lib/config-gerar.mjs';
import { listarCoresLiterais, semComentariosCss, semComentariosJs } from '../scripts/cores-literais.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lerArq = (...p) => readFileSync(path.join(RAIZ, ...p), 'utf8').split('\r\n').join('\n');
const schema = JSON.parse(lerArq('config', 'site.schema.json'));
const exemplo = () => JSON.parse(lerArq('config', 'site.json'));
const com = (mudar) => { const c = exemplo(); mudar(c); return c; };
const validar = (mudar) => validarConfig(schema, com(mudar));

/* Um repositório de mentira com só o que o aplicar-config precisa. */
function raizTemporaria(mudarConfig, fontes = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'tm-tema-'));
  mkdirSync(path.join(raiz, 'config', 'fontes'), { recursive: true });
  mkdirSync(path.join(raiz, 'core', 'site'), { recursive: true });
  cpSync(path.join(RAIZ, 'config/site.schema.json'), path.join(raiz, 'config/site.schema.json'));
  for (const f of ['index.html', 'admin.html']) cpSync(path.join(RAIZ, 'core/site', f), path.join(raiz, 'core/site', f));
  const c = exemplo();
  if (mudarConfig) mudarConfig(c);
  writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(c, null, 2));
  for (const [nome, dados] of Object.entries(fontes)) writeFileSync(path.join(raiz, 'config/fontes', nome), dados);
  return raiz;
}
const lerSite = (raiz, f) => readFileSync(path.join(raiz, 'core/site', f), 'utf8');
/* Um "woff2" mínimo: só a assinatura importa para o aplicar-config. */
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(32, 1)]);

/* ------------------------------------------------------------ a conta de contraste */

test('contraste: preto sobre branco dá 21:1 e a conta é simétrica', () => {
  assert.ok(Math.abs(contraste('#000000', '#ffffff') - 21) < 0.001);
  assert.equal(contraste('#123456', '#fedcba'), contraste('#fedcba', '#123456'));
  assert.equal(normalizarHex('#ABC'), '#aabbcc');
});

test('contraste: sugerirCor devolve uma cor que passa, na mesma tonalidade', () => {
  const cinza = sugerirCor('#999999', '#ffffff', 4.5);
  assert.ok(contraste(cinza, '#ffffff') >= 4.5, cinza);
  const claro = sugerirCor('#555555', '#101010', 4.5);
  assert.ok(contraste(claro, '#101010') >= 4.5, claro);
  assert.equal(sugerirCor('#000000', '#ffffff', 4.5), '#000000', 'quem já passa não muda');
});

/* ------------------------------------------------------------ os 6 temas prontos */

test('há seis temas prontos, no registro, nos arquivos e no enum do schema', () => {
  assert.equal(NOMES_DOS_PRESETS.length, 6);
  assert.ok(NOMES_DOS_PRESETS.includes(PRESET_PADRAO));
  const enumSchema = schema.properties.tema.properties.preset.enum;
  assert.deepEqual([...enumSchema].sort(), [...NOMES_DOS_PRESETS].sort(), 'o enum de tema.preset divergiu do registro');
  const arquivos = readdirSync(path.join(RAIZ, 'core/presets/temas')).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs')
    .map((f) => f.replace('.mjs', '')).sort();
  assert.deepEqual(arquivos, [...NOMES_DOS_PRESETS].sort(), 'há preset sem registro (ou registro sem arquivo)');
  assert.equal(schema.properties.tema.properties.preset.default, PRESET_PADRAO);
  assert.equal(PRESETS[PRESET_PADRAO].modoPadrao, 'escuro', 'o padrão do produto é escuro');
});

for (const nome of NOMES_DOS_PRESETS) {
  test(`tema "${nome}": traz as 20 cores nos dois modos e passa no contraste do próprio validador`, () => {
    const p = PRESETS[nome];
    assert.equal(p.nome, nome);
    for (const modo of ['escuro', 'claro']) {
      for (const k of CHAVES_DE_COR) {
        assert.match(p.cores[modo][k] || '', /^#[0-9a-f]{6}$/, `${nome}.${modo}.${k}`);
      }
      assert.deepEqual(Object.keys(p.cores[modo]).sort(), [...CHAVES_DE_COR].sort(), 'cor desconhecida no preset');
      const falhas = verificarPaleta(p.cores[modo], { prefixo: `${nome}.${modo}` });
      assert.deepEqual(falhas.map((f) => f.mensagem), [], `${nome} (${modo}) reprovado`);
    }
    /* E o caminho completo: config com só o preset passa em validarConfig. */
    const r = validar((c) => { c.tema = { preset: nome }; });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
  });
}

test('os temas são de fato diferentes entre si (marca e fundo)', () => {
  const marcas = new Set(NOMES_DOS_PRESETS.map((n) => PRESETS[n].cores.escuro.marca + PRESETS[n].cores.claro.marca));
  assert.equal(marcas.size, 6);
});

test('alto-contraste passa de 7:1 em texto e contorno (AAA), nos dois modos', () => {
  for (const modo of ['escuro', 'claro']) {
    const c = PRESETS['alto-contraste'].cores[modo];
    for (const [a, b] of [['texto', 'fundo'], ['texto', 'superficie'], ['textoFraco', 'fundo'], ['marca', 'fundo'], ['contorno', 'fundo']]) {
      assert.ok(contraste(c[a], c[b]) >= 7, `${modo}: ${a} sobre ${b} dá ${contraste(c[a], c[b]).toFixed(2)}`);
    }
  }
});

/* ------------------------------------------------------------ paleta ruim é recusada */

test('paleta sem 4,5:1 de texto é recusada, dizendo QUAL par e sugerindo uma cor que passa', () => {
  const r = validar((c) => { c.tema = { preset: 'cinema', cores: { escuro: { textoFraco: '#4a4f57' } } }; });
  assert.equal(r.ok, false);
  const e = r.erros.find((x) => x.caminho === 'tema.cores.escuro.textoFraco');
  assert.ok(e, JSON.stringify(r.erros));
  assert.match(e.mensagem, /contraste insuficiente/);
  assert.match(e.mensagem, /textoFraco \(#4a4f57\)/);
  assert.match(e.mensagem, /também falha sobre/, 'lista os outros fundos em que a cor também reprova');
  assert.match(e.mensagem, /\(#[0-9a-f]{6}\): .* dá \d,\d\d:1/);
  assert.match(e.mensagem, /mínimo é 4,5:1/);
  const sugestao = e.mensagem.match(/Sugestão: troque textoFraco por (#[0-9a-f]{6})/);
  assert.ok(sugestao, e.mensagem);
  const corrigida = validar((c) => { c.tema = { preset: 'cinema', cores: { escuro: { textoFraco: sugestao[1] } } }; });
  assert.equal(corrigida.ok, true, 'a cor sugerida precisa passar: ' + JSON.stringify(corrigida.erros));
});

test('controle sem 3:1 é recusado (contorno quase da cor do fundo)', () => {
  const r = validar((c) => { c.tema = { cores: { escuro: { contorno: '#1c2026' } } }; });
  assert.equal(r.ok, false);
  const e = r.erros.find((x) => x.caminho === 'tema.cores.escuro.contorno');
  assert.ok(e, JSON.stringify(r.erros));
  assert.match(e.mensagem, /contorno dos controles/);
  assert.match(e.mensagem, /mínimo é 3,0:1/);
});

test('o texto escrito sobre a cor da marca também é medido (botão principal)', () => {
  const r = validar((c) => { c.tema = { cores: { escuro: { marca: '#2a2a8a', textoSobreMarca: '#303090' } } }; });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /textoSobreMarca/.test(e.mensagem)), JSON.stringify(r.erros));
});

test('o modo claro (mesmo sem estar em uso) também é validado', () => {
  const r = validar((c) => { c.tema = { modo: 'escuro', cores: { claro: { texto: '#bbbbbb' } } }; });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => e.caminho === 'tema.cores.claro.texto'));
});

test('se o cliente trocou só o fundo e o texto do preset deixou de passar, o erro aponta o fundo', () => {
  const r = validar((c) => { c.tema = { preset: 'cinema', cores: { escuro: { fundo: '#7a7a7a' } } }; });
  assert.equal(r.ok, false);
  assert.ok(r.erros.every((e) => e.caminho === 'tema.cores.escuro.fundo' || e.caminho === 'tema.cores.escuro.superficie'), JSON.stringify(r.erros.map((e) => e.caminho)));
});

test('os mínimos do config só podem ficar MAIS exigentes: baixar abaixo de 4,5 / 3 é recusado', () => {
  assert.equal(validar((c) => { c.tema = { validarContraste: { textoMinimo: 3 } }; }).ok, false);
  assert.equal(validar((c) => { c.tema = { validarContraste: { controleMinimo: 1.5 } }; }).ok, false);
  /* Mais exigente vale: o cinema escuro não chega a 15:1 em textoFraco. */
  const r = validar((c) => { c.tema = { validarContraste: { textoMinimo: 15 } }; });
  assert.equal(r.ok, false);
  assert.match(r.erros[0].mensagem, /15,0:1/);
});

test('cor inválida é recusada pelo schema, em português', () => {
  const r = validar((c) => { c.tema = { cores: { escuro: { marca: 'azul' } } }; });
  assert.equal(r.ok, false);
  assert.equal(r.erros[0].caminho, 'tema.cores.escuro.marca');
  const p = validar((c) => { c.tema = { preset: 'neon' }; });
  assert.equal(p.ok, false);
  assert.match(p.erros[0].mensagem, /cinema/);
});

/* ------------------------------------------------------------ resolução do tema */

test('resolverTema: preset < override do cliente; modo padrão vem do preset', () => {
  const t = resolverTema({ tema: { preset: 'aconchegante', cores: { claro: { marca: '#005500' } } } });
  assert.equal(t.cores.claro.marca, '#005500');
  assert.equal(t.cores.claro.fundo, PRESETS.aconchegante.cores.claro.fundo);
  assert.equal(t.modo, 'claro', 'aconchegante abre claro quando o config não diz');
  assert.equal(resolverTema({ tema: { preset: 'aconchegante', modo: 'auto' } }).modo, 'auto');
  assert.equal(resolverTema({}).preset, PRESET_PADRAO);
  assert.equal(resolverTema({}).modo, 'escuro');
});

/* ------------------------------------------------------------ o theme.css gerado */

test('theme.css: modo escuro e claro têm um bloco só; auto traz o claro por prefers-color-scheme', () => {
  const escuro = gerarThemeCss(validar((c) => { c.tema = { preset: 'cinema', modo: 'escuro' }; }).config);
  assert.ok(!/prefers-color-scheme/.test(escuro));
  assert.match(escuro, /color-scheme: dark;/);
  assert.match(escuro, /--fundo: #0f1115;/);

  const claro = gerarThemeCss(validar((c) => { c.tema = { preset: 'cinema', modo: 'claro' }; }).config);
  assert.ok(!/prefers-color-scheme/.test(claro));
  assert.match(claro, /color-scheme: light;/);
  assert.match(claro, new RegExp('--fundo: ' + PRESETS.cinema.cores.claro.fundo + ';'));
  assert.ok(!claro.includes(PRESETS.cinema.cores.escuro.fundo + ';'), 'o claro não pode carregar o fundo do escuro');

  const auto = gerarThemeCss(validar((c) => { c.tema = { preset: 'cinema', modo: 'auto' }; }).config);
  assert.match(auto, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-tema="escuro"\]\)/);
  assert.match(auto, /:root\[data-tema="claro"\]/);
  assert.match(auto, new RegExp('--fundo: ' + PRESETS.cinema.cores.claro.fundo + ';'));
});

test('theme.css: toda cor do tema vira variável, e há as derivadas de transparência', () => {
  const css = gerarThemeCss(validar(() => {}).config);
  for (const v of ['marca', 'marca-clara', 'marca-fraca', 'marca-alt', 'marca-destaque', 'texto-sobre-marca', 'texto-sobre-destaque',
    'fundo', 'superficie', 'texto', 'texto-fraco', 'borda', 'contorno', 'alerta', 'alerta-fundo', 'erro', 'erro-fundo',
    'mesa-fundo', 'painel', 'painel-alto', 'fundo-96', 'fundo-72', 'marca-destaque-08',
    'raio', 'sombra', 'largura', 'esp-1', 'esp-8', 'tipo-micro', 'tipo-base', 'tipo-secao', 'fonte-corpo', 'fonte-titulo', 'fonte-mono']) {
    assert.match(css, new RegExp('--' + v + ':'), 'faltou --' + v);
  }
  assert.ok(!/https?:\/\//.test(css), 'o theme.css não pode apontar para fora');
});

test('theme.css: forma e escala acompanham o preset e o config', () => {
  const css = gerarThemeCss(validar((c) => { c.tema = { preset: 'vibrante', forma: { larguraMaximaPx: 1200 }, tipografia: { tamanhoBasePx: 20 } }; }).config);
  assert.match(css, /--raio: 16px;/);
  assert.match(css, /--largura: 1200px;/);
  assert.match(css, /--tipo-base: 20px;/);
  assert.match(css, /--tipo-corpo: 18\.8px;/, 'a escala inteira acompanha o tamanho base');
  const padrao = gerarThemeCss(validar(() => {}).config);
  assert.match(padrao, /--tipo-base: 16px;/);
  assert.match(padrao, /--tipo-corpo: 15px;/);
  assert.match(padrao, /--esp-3: 12px;/);
});

test('o theme.css do repositório é o do config/site.json (em dia)', async () => {
  const r = await aplicarConfig({ raiz: RAIZ, verificar: true });
  assert.deepEqual(r.alterados, [], 'rode: node scripts/aplicar-config.mjs');
});

test('manifest e theme-color seguem o fundo do modo escolhido; em auto há duas metas', async () => {
  const claro = validar((c) => { c.tema = { preset: 'institucional' }; }).config;   // abre claro
  assert.equal(JSON.parse(gerarManifest(claro)).background_color, PRESETS.institucional.cores.claro.fundo);
  const raiz = raizTemporaria((c) => { c.tema = { preset: 'institucional', modo: 'auto' }; });
  assert.equal((await aplicarConfig({ raiz })).ok, true);
  const html = lerSite(raiz, 'index.html');
  assert.match(html, /<meta name="theme-color" content="#0a1422" media="\(prefers-color-scheme: dark\)">/);
  assert.match(html, /<meta name="theme-color" content="#f3f5f8" media="\(prefers-color-scheme: light\)">/);
});

/* ------------------------------------------------------------ nada de cor literal fora dos tokens */

test('nenhuma cor literal fora do theme.css e do tokens-fixos.css (CSS, JS e HTML do site)', async () => {
  const lista = await listarCoresLiterais();
  assert.deepEqual(lista.map((a) => `${a.arquivo}:${a.linha}: ${a.cores.join(', ')}`), []);
});

test('o varredor de cores literais enxerga #hex, rgb(), nomes e cor dentro de string de JS, e ignora comentário', async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'tm-cores-'));
  mkdirSync(path.join(raiz, 'core/site'), { recursive: true });
  writeFileSync(path.join(raiz, 'core/site/a.css'), '/* #fff no comentário */\n.a { color: #ABC; }\n.b { background: rgba(0,0,0,.5); }\n.c { border: 1px solid white; }\n.d { color: var(--texto); }\n');
  writeFileSync(path.join(raiz, 'core/site/b.js'), "// #000 num comentário\nvar x = '#123456';\nctx.fillStyle = 'rgb(1, 2, 3)';\nvar y = '#site';\n");
  writeFileSync(path.join(raiz, 'core/site/c.html'), '<meta name="theme-color" content="#000">\n<div style="color:#f00">x</div>\n');
  writeFileSync(path.join(raiz, 'core/site/theme.css'), ':root { --a: #fff; }\n');
  const lista = await listarCoresLiterais({ raiz });
  const chave = lista.map((a) => `${a.arquivo}:${a.linha}`);
  assert.deepEqual(chave, ['core/site/a.css:2', 'core/site/a.css:3', 'core/site/a.css:4', 'core/site/b.js:2', 'core/site/b.js:3', 'core/site/c.html:1']);
  assert.ok(semComentariosCss('/* #fff */').trim() === '');
  assert.ok(!semComentariosJs("var u = 'http://x'; // #fff").includes('#fff'));
});

test('toda var(--x) usada nas folhas está definida (tema, tokens fixos, a própria folha ou o JS)', () => {
  const css = {};
  for (const n of ['style.css', 'mesa.css', 'theme.css', 'tokens-fixos.css']) css[n] = semComentariosCss(lerArq('core/site', n));
  const definidas = new Set();
  for (const t of Object.values(css)) for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) definidas.add(m[1]);
  /* Variáveis que o JS define em tempo de execução (setProperty). */
  for (const f of readdirSync(path.join(RAIZ, 'core/site')).filter((x) => x.endsWith('.js'))) {
    for (const m of lerArq('core/site', f).matchAll(/setProperty\('(--[\w-]+)'/g)) definidas.add(m[1]);
  }
  const faltando = [];
  for (const n of ['style.css', 'mesa.css']) {
    for (const m of css[n].matchAll(/var\((--[\w-]+)(?:\s*,[^)]*)?\)/g)) {
      /* Com valor de reserva (var(--x, 1)) a variável é opcional de propósito. */
      if (!definidas.has(m[1]) && !/^var\([^)]*,/.test(m[0])) faltando.push(`${n}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(faltando)], []);
});

test('o tokens-fixos.css não define nada que o tema também define (um dono por token)', () => {
  const fixos = [...semComentariosCss(lerArq('core/site/tokens-fixos.css')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
  const tema = new Set([...semComentariosCss(lerArq('core/site/theme.css')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual(fixos.filter((v) => tema.has(v)), []);
});

test('o branco e o realce do player contrastam com o preto do player (conta do comentário do tokens-fixos.css)', () => {
  const t = semComentariosCss(lerArq('core/site/tokens-fixos.css'));
  const v = (n) => t.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{3,6})'))[1];
  assert.ok(contraste(v('player-texto'), v('player-fundo')) >= 4.5);
  assert.ok(contraste(v('player-texto-fraco'), v('player-fundo')) >= 4.5);
  assert.ok(contraste(v('player-realce'), '#121212') >= 4.5);
});

/* ------------------------------------------------------------ trocar o tema não deixa resíduo */

test('trocar tema e marca.nome gera o site sem resíduo do anterior', async () => {
  const raiz = raizTemporaria((c) => { c.marca.nome = 'Primeira Marca Zeta'; c.marca.nomeCurto = 'Zeta'; c.tema = { preset: 'cinema', modo: 'escuro', cores: { escuro: { marca: '#6aa6ff' } } }; });
  assert.equal((await aplicarConfig({ raiz })).ok, true);
  const antes = lerSite(raiz, 'theme.css');
  assert.ok(antes.includes('#0f1115'));

  /* Agora outra marca e outro tema, no mesmo diretório (o que acontece na vida real). */
  const cfg = JSON.parse(readFileSync(path.join(raiz, 'config/site.json'), 'utf8'));
  cfg.marca.nome = 'Segunda Marca Ômega'; cfg.marca.nomeCurto = 'Ômega';
  cfg.tema = { preset: 'aconchegante', modo: 'claro' };
  writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(cfg, null, 2));
  assert.equal((await aplicarConfig({ raiz })).ok, true);

  const gerados = ['theme.css', 'index.html', 'admin.html', 'manifest.webmanifest', 'config.public.json', 'robots.txt'];
  for (const f of gerados) {
    const t = lerSite(raiz, f);
    assert.ok(!/Primeira Marca|Zeta/.test(t), `${f} guardou a marca anterior`);
  }
  const depois = lerSite(raiz, 'theme.css');
  /* Nenhuma cor do cinema escuro (que o aconchegante não usa) sobrou. */
  const usadasPeloNovo = new Set(Object.values({ ...PRESETS.aconchegante.cores.escuro, ...PRESETS.aconchegante.cores.claro }));
  for (const cor of Object.values(PRESETS.cinema.cores.escuro)) {
    if (!usadasPeloNovo.has(cor)) assert.ok(!depois.includes(cor), `theme.css guardou ${cor} do tema anterior`);
  }
  assert.match(depois, /tema "aconchegante", modo "claro"/);
  assert.ok(!/tema "cinema"/.test(depois));
  assert.match(depois, /--fonte-titulo: "Georgia"/);
  assert.equal(JSON.parse(lerSite(raiz, 'manifest.webmanifest')).background_color, PRESETS.aconchegante.cores.claro.fundo);
  assert.ok(lerSite(raiz, 'index.html').includes('Segunda Marca Ômega'));
  assert.match(lerSite(raiz, 'index.html'), new RegExp(`content="${PRESETS.aconchegante.cores.claro.fundo}"`));
  assert.equal(JSON.parse(lerSite(raiz, 'config.public.json')).tema.preset, 'aconchegante');
});

/* ------------------------------------------------------------ tipografia */

test('tipografia de sistema: família entra na pilha, com reserva, sem baixar nada', () => {
  const css = gerarThemeCss(validar((c) => { c.tema = { tipografia: { corpo: { familia: 'Verdana', origem: 'sistema' }, reserva: 'sans-serif' } }; }).config);
  assert.match(css, /--fonte-corpo: "Verdana", sans-serif;/);
  assert.ok(!/@font-face/.test(css));
});

test('tipografia de arquivo: copia o woff2, gera @font-face com fallback e font-display, sem CDN', async () => {
  const raiz = raizTemporaria((c) => {
    c.tema = { tipografia: {
      corpo: { familia: 'Minha Fonte', origem: 'arquivo', arquivos: ['Minha-Regular.woff2', 'Minha-Bold.woff2'], pesos: [400, 700] },
      titulo: { familia: 'Minha Titulo', origem: 'arquivo', arquivos: ['Titulo-Var.woff2'] }
    } };
  }, { 'Minha-Regular.woff2': WOFF2, 'Minha-Bold.woff2': WOFF2, 'Titulo-Var.woff2': WOFF2 });
  const r = await aplicarConfig({ raiz });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const css = lerSite(raiz, 'theme.css');
  assert.match(css, /@font-face \{\s*font-family: "Minha Fonte";\s*src: url\("fontes\/Minha-Regular\.woff2"\) format\("woff2"\);\s*font-weight: 400;/);
  assert.match(css, /font-weight: 700;/);
  assert.match(css, /font-family: "Minha Titulo";[\s\S]*?font-weight: 100 900;/, 'um arquivo sem pesos vale como fonte variável');
  assert.equal((css.match(/font-display: swap;/g) || []).length, 3);
  assert.match(css, /--fonte-corpo: "Minha Fonte", system-ui/, 'a reserva vem junto');
  assert.match(css, /--fonte-titulo: "Minha Titulo", system-ui/);
  assert.ok(!/https?:\/\//.test(css));
  assert.deepEqual(readdirSync(path.join(raiz, 'core/site/fontes')).sort(), ['Minha-Bold.woff2', 'Minha-Regular.woff2', 'Titulo-Var.woff2']);
  assert.ok(lerSite(raiz, 'theme.css').length > 0);
  assert.deepEqual((await aplicarConfig({ raiz })).alterados, [], 'idempotente');
});

test('trocar a fonte remove o woff2 antigo; o --verificar enxerga fonte desatualizada', async () => {
  const raiz = raizTemporaria((c) => { c.tema = { tipografia: { corpo: { familia: 'Antiga', origem: 'arquivo', arquivos: ['Antiga.woff2'] } } }; },
    { 'Antiga.woff2': WOFF2, 'Nova.woff2': WOFF2 });
  await aplicarConfig({ raiz });
  assert.ok(existsSync(path.join(raiz, 'core/site/fontes/Antiga.woff2')));
  const cfg = JSON.parse(readFileSync(path.join(raiz, 'config/site.json'), 'utf8'));
  cfg.tema.tipografia.corpo = { familia: 'Nova', origem: 'arquivo', arquivos: ['Nova.woff2'] };
  writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(cfg));
  const seco = await aplicarConfig({ raiz, verificar: true });
  assert.ok(seco.alterados.some((a) => /Nova\.woff2/.test(a)) && seco.alterados.some((a) => /Antiga\.woff2 \(removido\)/.test(a)));
  assert.ok(existsSync(path.join(raiz, 'core/site/fontes/Antiga.woff2')), '--verificar não pode mexer em arquivo');
  await aplicarConfig({ raiz });
  assert.ok(!existsSync(path.join(raiz, 'core/site/fontes/Antiga.woff2')));
  assert.ok(existsSync(path.join(raiz, 'core/site/fontes/Nova.woff2')));
  assert.ok(!/Antiga/.test(lerSite(raiz, 'theme.css')));
  /* Voltar a "sistema" limpa a pasta inteira. */
  cfg.tema.tipografia = {};
  writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(cfg));
  await aplicarConfig({ raiz });
  assert.deepEqual(readdirSync(path.join(raiz, 'core/site/fontes')), []);
});

test('fonte de arquivo ausente ou que não é woff2 faz o aplicar-config recusar, sem escrever nada', async () => {
  const faltando = raizTemporaria((c) => { c.tema = { tipografia: { corpo: { familia: 'X', origem: 'arquivo', arquivos: ['Sumiu.woff2'] } } }; });
  const r = await aplicarConfig({ raiz: faltando });
  assert.equal(r.ok, false);
  assert.match(r.erros[0].mensagem, /config\/fontes\/Sumiu\.woff2/);
  assert.ok(!existsSync(path.join(faltando, 'core/site/theme.css')));

  const falso = raizTemporaria((c) => { c.tema = { tipografia: { corpo: { familia: 'X', origem: 'arquivo', arquivos: ['Falso.woff2'] } } }; }, { 'Falso.woff2': Buffer.from('isto é um ttf') });
  const r2 = await aplicarConfig({ raiz: falso });
  assert.equal(r2.ok, false);
  assert.match(r2.erros[0].mensagem, /não é um woff2/);
});

test('tipografia: combinações inválidas são recusadas em português; origem "google" não existe', () => {
  const casos = [
    [{ corpo: { familia: 'X', origem: 'google' } }, 'tema.tipografia.corpo.origem'],
    [{ corpo: { familia: 'X', origem: 'arquivo' } }, 'tema.tipografia.corpo.arquivos'],
    [{ corpo: { familia: 'X', origem: 'sistema', arquivos: ['a.woff2'] } }, 'tema.tipografia.corpo.arquivos'],
    [{ corpo: { familia: 'X', origem: 'arquivo', arquivos: ['a.woff2', 'b.woff2'] } }, 'tema.tipografia.corpo.pesos'],
    [{ corpo: { familia: 'X', origem: 'arquivo', arquivos: ['a.woff2', 'b.woff2'], pesos: [400] } }, 'tema.tipografia.corpo.pesos'],
    [{ corpo: { familia: 'X', origem: 'arquivo', arquivos: ['../a.woff2'] } }, 'tema.tipografia.corpo.arquivos[0]'],
    [{ corpo: { familia: 'X', origem: 'arquivo', arquivos: ['a.ttf'] } }, 'tema.tipografia.corpo.arquivos[0]'],
    [{ corpo: { familia: 'X"; } body { display:none', origem: 'sistema' } }, 'tema.tipografia.corpo.familia'],
    [{ corpo: { origem: 'sistema' } }, 'tema.tipografia.corpo.familia'],
    [{ reserva: 'x; } body { display:none' }, 'tema.tipografia.reserva']
  ];
  for (const [tip, caminho] of casos) {
    const r = validar((c) => { c.tema = { tipografia: tip }; });
    assert.equal(r.ok, false, JSON.stringify(tip));
    assert.ok(r.erros.some((e) => e.caminho === caminho && /[a-zãé]/.test(e.mensagem)), caminho + ' :: ' + JSON.stringify(r.erros));
  }
});

test('nenhuma regra de CSS é injetável pelo config: valores de forma e curva só aceitam o formato esperado', () => {
  assert.equal(validar((c) => { c.tema = { forma: { sombra: '0 0 0 red; } * { display:none' } }; }).ok, false);
  assert.equal(validar((c) => { c.tema = { movimento: { curva: 'ease; } *{x:y' } }; }).ok, false);
  assert.equal(validar((c) => { c.tema = { forma: { sombra: '0 1px 3px rgba(0,0,0,.2)' }, movimento: { curva: 'cubic-bezier(.2,.7,.2,1)' } }; }).ok, true);
});
