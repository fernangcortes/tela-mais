/* scripts/publicar.mjs — publica na grade os títulos que estão realmente prontos.
 *
 * Um título só entra se passar nas TRÊS condições:
 *   1. não tem pendência registrada (duplicata, material bruto, direitos…);
 *   2. tem `fonte.videoId` — senão a ficha abre com o player vazio;
 *   3. o encoding terminou no Bunny (status 4) — vídeo em fila embeda e não toca,
 *      e o usuário culpa o site.
 *
 * IDEMPOTENTE e feito para rodar várias vezes: enquanto uma carga grande sobe,
 * rode de novo a cada tanto e ele publica o que ficou pronto no intervalo.
 *
 * Uso:
 *     node scripts/publicar.mjs --simular      mostra quem entraria e quem não
 *     node scripts/publicar.mjs                publica os prontos
 *     node scripts/publicar.mjs --com-pendencia  inclui os que têm pendência
 *     node scripts/publicar.mjs --despublicar <id>[,<id>]
 *
 * Trabalha sobre o KV (a fonte da verdade da grade), não sobre o arquivo local.
 */
import { criarCliente, STATUS } from './lib/bunny.mjs';
import { argumentos, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';

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
  const auth = { Authorization: 'Bearer ' + token };

  const catalogo = await (await fetch(site + '/api/catalogo?completo=1', { headers: auth })).json();
  delete catalogo.config;

  /* --despublicar tem precedência: é o desfazer. */
  if (typeof op.despublicar === 'string') {
    const ids = new Set(op.despublicar.split(',').map(s => s.trim()));
    let n = 0;
    for (const item of catalogo.itens) {
      if (ids.has(item.id) && item.publicar) { item.publicar = false; n++; console.log('  despublicado:', item.titulo); }
    }
    const r = await fetch(site + '/api/catalogo', {
      method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(catalogo)
    });
    if (!r.ok) throw new Error('gravação recusada: ' + (await r.text()).slice(0, 200));
    console.log(`\n${n} despublicados.`);
    process.exit(0);
  }

  const bunny = criarCliente();
  const candidatos = catalogo.itens.filter(i => !i.publicar);
  const entram = [];
  const barrados = { pendencia: [], semVideo: [], codificando: [] };

  for (const item of candidatos) {
    if (item.pendencia && !op['com-pendencia']) { barrados.pendencia.push(item); continue; }
    if (!(item.fonte && item.fonte.videoId)) { barrados.semVideo.push(item); continue; }

    let v;
    try {
      v = await bunny.consultar(item.fonte.videoId);
    } catch {
      barrados.codificando.push(item);
      continue;
    }
    if (v.status !== 4) {
      barrados.codificando.push([item, STATUS[v.status] || v.status, v.encodeProgress]);
      continue;
    }
    entram.push(item);
  }

  console.log(`já publicados: ${catalogo.itens.filter(i => i.publicar).length}`);
  console.log(`entram agora: ${entram.length}`);
  entram.forEach(i => console.log('   + ' + i.titulo));

  if (barrados.semVideo.length) console.log(`\nsem vídeo no Bunny (aguardando upload): ${barrados.semVideo.length}`);
  if (barrados.codificando.length) {
    console.log(`ainda codificando: ${barrados.codificando.length}`);
    barrados.codificando.forEach(b => {
      if (Array.isArray(b)) console.log(`   · ${b[0].titulo} — ${b[1]} ${b[2] ?? ''}%`);
    });
  }
  if (barrados.pendencia.length) {
    console.log(`\nbarrados por pendência: ${barrados.pendencia.length} (use --com-pendencia para incluir)`);
    const porTipo = {};
    barrados.pendencia.forEach(i => { porTipo[i.pendencia] = (porTipo[i.pendencia] || 0) + 1; });
    Object.entries(porTipo).forEach(([t, n]) => console.log(`   ${t}: ${n}`));
  }

  if (op.simular) { console.log('\n--simular: nada foi gravado.'); process.exit(0); }
  if (!entram.length) { console.log('\nnada a publicar nesta rodada.'); process.exit(0); }

  entram.forEach(i => { i.publicar = true; });
  const r = await fetch(site + '/api/catalogo', {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(catalogo)
  });
  const res = await r.json();
  if (!r.ok) throw new Error('gravação recusada: ' + JSON.stringify(res));

  const total = catalogo.itens.filter(i => i.publicar).length;
  console.log(`\n✔ publicados +${entram.length}  ·  ${total} na grade  ·  rev ${res.rev}`);
  if (barrados.semVideo.length || barrados.codificando.length) {
    console.log('rode de novo quando o upload e o encoding avançarem.');
  }
} catch (e) {
  erroFatal(e);
}
