/* Licença e avisos: LICENSE (BSL 1.1) com o texto-base intacto, NOTICE em dia com o que está em vendor/, COMMERCIAL e
 * política de marca. Falha se faltar LICENSE ou NOTICE, ou se alguém mexer no texto-base da BSL. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

/* sha256 do texto-base da BSL 1.1 (de "Business Source License 1.1" + "License text copyright" até o fim). A BSL não
 * se edita: só os parâmetros do cabeçalho mudam. Se isto falhar, o texto-base foi alterado: reverta. */
const HASH_TEXTO_BASE = 'd90560217049db1d6020ec7cf482da4198bfa372dffd22270ba08fd8088cd93b';

test('LICENSE existe, é a BSL 1.1 e o texto-base não foi alterado', () => {
  const t = ler('LICENSE');
  assert.match(t, /^Business Source License 1\.1\n\nParameters\n/);
  const i = t.indexOf('Business Source License 1.1\n\nLicense text copyright');
  assert.ok(i > 0, 'o texto-base da BSL precisa estar no LICENSE');
  assert.equal(crypto.createHash('sha256').update(t.slice(i)).digest('hex'), HASH_TEXTO_BASE);
  for (const campo of ['Licensor:', 'Licensed Work:', 'Additional Use Grant:', 'Change Date:', 'Change License:']) assert.ok(t.includes(campo), campo);
  assert.match(t, /Change License:\s+Apache License, Version 2\.0/);
  assert.match(t, /BRL 1,000,000\.00/);
});

test('a Change Date do LICENSE respeita o teto de 4 anos da BSL (em relação à data da versão)', () => {
  const t = ler('LICENSE');
  const data = /Change Date:\s+(\d{4}-\d{2}-\d{2})/.exec(t)[1];
  const cl = ler('CHANGELOG.md');
  const versao = ler('.core-version').trim();
  const publicada = new RegExp('^## \\[' + versao.replace(/\./g, '\\.') + '\\] - (\\d{4}-\\d{2}-\\d{2})', 'm').exec(cl);
  assert.ok(publicada, 'o CHANGELOG precisa datar a versão atual');
  const [a, m, d] = publicada[1].split('-').map(Number);
  const limite = new Date(Date.UTC(a + 4, m - 1, d)).toISOString().slice(0, 10);
  assert.ok(data <= limite, `Change Date ${data} passa de 4 anos da publicação (${publicada[1]}): limite ${limite}`);
  assert.ok(data > publicada[1]);
});

test('a tradução de cortesia cita a mesma Change Date e diz que o inglês prevalece', () => {
  const lic = ler('LICENSE');
  const data = /Change Date:\s+(\d{4}-\d{2}-\d{2})/.exec(lic)[1];
  const pt = ler('LICENCA-PT.md');
  assert.ok(pt.includes(data), 'LICENCA-PT.md cita a Change Date');
  assert.match(pt, /versão em inglês .*prevalece/i);
  const v = ler('.core-version').trim();
  assert.ok(pt.includes(`${data} para a versão ${v}`));
});

test('NOTICE lista cada componente de vendor/ com a versão e a licença do arquivo', () => {
  const notice = ler('NOTICE');
  const vendor = ler('core', 'site', 'vendor', 'LEIA-ME.md');
  const hls = /hls\.js\s+(\d+\.\d+\.\d+)/.exec(vendor)[1];
  const tus = /tus-js-client\s+(\d+\.\d+\.\d+)/.exec(vendor)[1];
  assert.match(notice, new RegExp('hls\\.js[\\s\\S]*Versão: ' + hls.replace(/\./g, '\\.')));
  assert.match(notice, new RegExp('tus-js-client\\s+Versão: ' + tus.replace(/\./g, '\\.')));
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2015 tus/);
  /* todo .js dentro de vendor/ está no NOTICE */
  for (const arq of fs.readdirSync(path.join(RAIZ, 'core', 'site', 'vendor')).filter((n) => n.endsWith('.js'))) assert.ok(notice.includes(arq), `${arq} está no NOTICE`);
  assert.ok(fs.existsSync(path.join(RAIZ, 'core', 'site', 'vendor', 'tus-LICENSE.txt')));
});

test('LICENSE, NOTICE e COMMERCIAL vão em todo release (fazem parte do produto empacotado)', async () => {
  const { PRODUTO } = await import('../scripts/lib/atualizar-core.mjs');
  for (const f of ['LICENSE', 'NOTICE', 'COMMERCIAL.md', 'LICENCA-PT.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
    assert.ok(fs.existsSync(path.join(RAIZ, f)), f + ' existe');
    if (f !== 'CONTRIBUTING.md') assert.ok(PRODUTO.arquivos.includes(f), f + ' no pacote da release');
  }
});

test('COMMERCIAL.md traz o limite, a política de marca e o que é permitido e proibido', () => {
  const t = ler('COMMERCIAL.md');
  assert.match(t, /R\$ 1\.000\.000,00/);
  assert.match(t, /^## Política de marca/m);
  assert.match(t, /não concede direito de marca/i);
  assert.match(t, /Você pode, e deve/);
  assert.match(t, /Você não pode/);
  assert.match(t, /CONTRIBUTING\.md/);
  assert.doesNotMatch(t, /preço de R\$ \d/i, 'a tabela de preços ainda é "a definir": não publique valor sem decisão');
});

test('"tela mAIs" só aparece nos arquivos permitidos pela regra 10 do AGENTS.md (e nos de documentação deste M8)', () => {
  /* Interface do cliente (core/site, core/locales, config): nunca. */
  const varrer = (dir) => {
    for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { if (it.name !== 'vendor') varrer(p); continue; }
      if (!/\.(html|js|css|json|webmanifest|svg|txt)$/.test(it.name)) continue;
      assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /tela mAIs/i, path.relative(RAIZ, p) + ' mostra o nome do produto na interface');
    }
  };
  varrer(path.join(RAIZ, 'core', 'site'));
  varrer(path.join(RAIZ, 'core', 'locales'));
  varrer(path.join(RAIZ, 'config'));
});
