/* scripts/acrescentar-ao-kv.mjs — leva ao KV SÓ os títulos que ainda não estão
 * lá, sem encostar em nenhum dos que já estão.
 *
 *   node scripts/acrescentar-ao-kv.mjs --simular   mostra quem entraria
 *   node scripts/acrescentar-ao-kv.mjs             acrescenta
 *   node scripts/acrescentar-ao-kv.mjs --item <id>[,<id>]
 *
 * POR QUE NÃO `semear.mjs`. O semear monta o corpo a partir de `local.itens` e
 * só preserva do KV os campos que NÃO existem no arquivo local. `titulo`,
 * `serie`, `temporada` e `episodio` existem nos dois — então o valor do arquivo
 * ganha, sempre. Depois que a curadoria passa a ser feita pela tela de admin
 * (títulos renomeados, séries corrigidas), rodar `semear.mjs --sobrescrever`
 * devolveria os nomes antigos do arquivo local para o lugar dos nomes
 * curados, de uma vez, sem avisar. Este script existe para acrescentar sem
 * correr esse risco.
 *
 * A REGRA, e é só uma: item cujo `id` já existe no KV não é tocado. Nem para
 * atualizar um campo, nem para "melhorar" nada. O que já está no KV é a
 * curadoria, e a curadoria manda.
 *
 * Os títulos novos entram com `publicar: false`: quem decide o que vai à grade
 * é `publicar.mjs`, depois de conferir o encoding no Bunny.
 */
import { argumentos, lerCatalogo, selecionar, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');

  const entrada = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!entrada.ok) throw new Error(`login recusado (${entrada.status})`);
  const { token } = await entrada.json();
  const auth = { Authorization: 'Bearer ' + token, accept: 'application/json' };

  const leitura = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!leitura.ok) throw new Error(`leitura do KV falhou (${leitura.status})`);
  const noKv = await leitura.json();
  delete noKv.config;

  const jaNoKv = new Set((noKv.itens || []).map(i => i.id));
  const local = await lerCatalogo(caminhoCatalogo);
  const candidatos = selecionar(local.itens, op);

  const entram = candidatos.filter(i => !jaNoKv.has(i.id));
  const jaEstao = candidatos.length - entram.length;

  console.log(`KV: ${(noKv.itens || []).length} títulos (rev ${noKv.rev})`);
  console.log(`no arquivo local: ${candidatos.length}  ·  já no KV (intocados): ${jaEstao}  ·  entram: ${entram.length}\n`);

  for (const i of entram) {
    const ep = i.temporada != null || i.episodio != null
      ? ` T${i.temporada ?? '-'}E${i.episodio ?? '-'}` : '';
    console.log(`  + ${i.serie}${ep} :: ${i.titulo}${i.pendencia ? `  [${i.pendencia}]` : ''}`);
  }

  if (!entram.length) { console.log('\nnada a acrescentar.'); process.exit(0); }
  if (op.simular) { console.log('\n--simular: nada foi gravado.'); process.exit(0); }

  /* `publicar` nunca vem do arquivo local: o arquivo local costuma estar com
   * `publicar: false`, e quem publica é publicar.mjs, contra o Bunny. */
  const novos = entram.map(i => ({ ...i, publicar: false }));

  const corpo = { ...noKv, itens: [...(noKv.itens || []), ...novos] };
  corpo.total = corpo.itens.length;

  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    throw new Error(`gravação recusada (${escrita.status}): ${resposta.erro || JSON.stringify(resposta)}`);
  }

  console.log(`\n✔ +${novos.length} no KV  ·  ${resposta.total} títulos  ·  rev ${resposta.rev}`);
  console.log('   todos entraram como não publicados.');
  console.log('\npróximo passo: node scripts/publicar.mjs --simular');
} catch (e) {
  erroFatal(e);
}
