/* scripts/semear.mjs — Task 5.1b: levar o catálogo local para o KV, e trazer
 * de volta uma cópia de segurança.
 *
 *   export APP_SITE_URL="https://seu-site.exemplo.com"
 *   export APP_SENHA="<a senha de admin>"
 *
 *   node scripts/semear.mjs                       envia o catálogo local ao KV
 *   node scripts/semear.mjs --sobrescrever        aceita substituir um KV já populado
 *   node scripts/semear.mjs --baixar backup.json  salva o que está no KV
 *
 * A senha vem do ambiente, não da linha de comando: argumento de linha de
 * comando fica no histórico do shell.
 */
import { writeFile } from 'node:fs/promises';
import { argumentos, lerCatalogo, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  if (!site) throw new Error('defina APP_SITE_URL (ex.: https://seu-site.exemplo.com)');
  if (!senha) throw new Error('defina APP_SENHA com a senha da área de administração');

  const entrada = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!entrada.ok) {
    throw new Error(`login recusado (${entrada.status}): ${(await entrada.text()).slice(0, 200)}`);
  }
  const { token } = await entrada.json();
  const auth = { Authorization: 'Bearer ' + token, accept: 'application/json' };

  const leitura = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!leitura.ok) throw new Error(`leitura do KV falhou (${leitura.status})`);
  const noKv = await leitura.json();

  if (op.baixar) {
    const destino = typeof op.baixar === 'string' ? op.baixar : 'catalogo.kv.json';
    delete noKv.config;
    await writeFile(destino, JSON.stringify(noKv, null, 1) + '\n', 'utf8');
    console.log(`salvo em ${destino}: ${(noKv.itens || []).length} títulos, rev ${noKv.rev || 0}`);
    process.exit(0);
  }

  const quantosNoKv = (noKv.itens || []).length;
  if (quantosNoKv && !op.sobrescrever) {
    console.error(
      `o KV já tem ${quantosNoKv} títulos (rev ${noKv.rev}).\n` +
      'Semear de novo apagaria o que foi editado pela tela de administração.\n' +
      'Se é isso mesmo que você quer:\n' +
      '  1. node scripts/semear.mjs --baixar backup.json\n' +
      '  2. node scripts/semear.mjs --sobrescrever'
    );
    process.exit(1);
  }

  const local = await lerCatalogo(caminhoCatalogo);

  /* MERGE, não substituição.
   *
   * O arquivo local é a fonte dos metadados em lote; o KV é a fonte do estado
   * editorial — o que foi publicado, a capa escolhida pela tela, a sinopse
   * revisada. Um `--sobrescrever` ingênuo joga fora esse estado sem avisar:
   * foi assim que uma capa recém-escolhida pela tela se perde.foi assim que uma capa recém-escolhida pela tela se perde.
   *
   * Regra: campo que existe no KV e não existe no arquivo local é preservado,
   * e `publicar` é sempre do KV — publicar é decisão de quem opera a tela. */
  const noKvPorId = new Map((noKv.itens || []).map(i => [i.id, i]));
  let preservados = 0;

  const itens = local.itens.map(item => {
    const antigo = noKvPorId.get(item.id);
    if (!antigo) return item;

    const juntado = { ...item };
    for (const [campo, valor] of Object.entries(antigo)) {
      if (!(campo in item) && valor != null) {
        juntado[campo] = valor;
        preservados++;
      }
    }
    if (typeof antigo.publicar === 'boolean') juntado.publicar = antigo.publicar;
    return juntado;
  });

  if (preservados) {
    console.log(`preservados do KV: ${preservados} campos que não existem no arquivo local`);
  }

  /* O merge acima só protege campo que NÃO existe no arquivo local. `titulo`,
   * `serie`, `temporada` e `episodio` existem nos dois — logo o valor do arquivo
   * ganha, e a curadoria feita pela tela de admin volta atrás sem aviso. Rodar
   * aqui devolveria os nomes do arquivo ao lugar dos nomes curados.Rodar
   * aqui devolveria os nomes do arquivo ao lugar dos nomes curados.
   *
   * O aviso não bloqueia — semear continua sendo a ferramenta certa para
   * restaurar o KV de um backup. Ele só deixa de ser silencioso. Para APENAS
   * acrescentar títulos novos sem tocar no resto, use acrescentar-ao-kv.mjs. */
  const regressoes = [];
  for (const item of local.itens) {
    const antigo = noKvPorId.get(item.id);
    if (!antigo) continue;
    for (const campo of ['titulo', 'serie', 'temporada', 'episodio']) {
      if (String(antigo[campo]) !== String(item[campo])) {
        regressoes.push({ id: item.id, campo, kv: antigo[campo], arquivo: item[campo] });
      }
    }
  }

  if (regressoes.length) {
    console.log(`\n⚠  ${regressoes.length} campos editados pela tela de admin VÃO SER SOBRESCRITOS pelo arquivo local:`);
    for (const r of regressoes.slice(0, 20)) {
      console.log(`   ${r.id} · ${r.campo}`);
      console.log(`      no ar:   ${r.kv}`);
      console.log(`      vai virar: ${r.arquivo}`);
    }
    if (regressoes.length > 20) console.log(`   … e mais ${regressoes.length - 20}`);
    console.log('   Se a intenção era só acrescentar títulos novos, pare aqui e use:');
    console.log('     node scripts/acrescentar-ao-kv.mjs --simular\n');
  }

  const corpo = { ...local, itens, rev: noKv.rev || 0 };
  delete corpo.config;

  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    throw new Error(`gravação recusada (${escrita.status}): ${resposta.erro || ''}`);
  }

  console.log(`✔ ${resposta.total} títulos no KV (rev ${resposta.rev}, ${resposta.atualizado_em})`);
  const publicados = local.itens.filter(i => i.publicar).length;
  console.log(`  ${publicados} marcados como publicados — só esses aparecem na grade.`);
} catch (e) {
  erroFatal(e);
}
