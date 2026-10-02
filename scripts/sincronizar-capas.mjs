/* scripts/sincronizar-capas.mjs — lê do Bunny o nome real do arquivo de capa
 * de cada título e grava em `capa_arquivo`, NO KV.
 *
 *   node scripts/sincronizar-capas.mjs --simular          mostra o que gravaria
 *   node scripts/sincronizar-capas.mjs --item <id>[,<id>] um título só
 *   node scripts/sincronizar-capas.mjs                    todos
 *
 * POR QUE ISTO EXISTE: ao receber uma capa enviada por nós, o Bunny grava com um
 * hash no nome (`thumbnail_2c504259.jpg`). O site monta a URL da capa com o nome
 * guardado em `capa_arquivo`, e quem troca a capa no Bunny sem gravar o nome
 * novo deixa o catálogo apontando para o arquivo de antes.
 *
 * E O ARQUIVO DE ANTES PODE SOMIR: o Bunny nem sempre mantém a capa anterior
 * depois da troca, e um nome não gravado deixa o cartão sem imagem no site no
 * ar até alguém gravar o nome novo.
 *
 * Rode isto depois de trocar capas pelo painel do Bunny. A mesa grava o nome
 * sozinha, na mesma chamada que envia a capa (`/api/midia`).
 *
 * A FONTE DA VERDADE É O KV, não o catálogo local — que costuma ficar
 * defasado. Mesmo caminho do capas-menores e do framerate.
 */
import { criarCliente } from './lib/bunny.mjs';
import { argumentos, lerCatalogo, gravarCatalogo, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const ensaio = Boolean(op.simular);

try {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');

  const entrada = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!entrada.ok) throw new Error('login recusado (' + entrada.status + ')');
  const { token } = await entrada.json();
  const auth = { Authorization: 'Bearer ' + token, accept: 'application/json' };

  const leitura = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!leitura.ok) throw new Error('leitura do KV falhou (' + leitura.status + ')');
  const kv = await leitura.json();
  const config = kv.config;

  /* SÓ o `config` sai: ele vem do ambiente e o PUT o descarta de qualquer
   * jeito. O que veio no GET volta no PUT, menos ele — a regra do framerate.mjs
   * (apagar o `ajustes` também perderia os ajustes do player). */
  delete kv.config;

  const pedidos = typeof op.item === 'string' ? new Set(op.item.split(',').map(s => s.trim())) : null;
  const alvos = (kv.itens || []).filter(i =>
    i && i.fonte && i.fonte.videoId && (!pedidos || pedidos.has(i.id)));
  if (!alvos.length) throw new Error('nenhum título com videoId bate com o pedido.');

  console.log('KV rev ' + kv.rev + '  ·  ' + alvos.length + ' título(s) com vídeo\n');

  /* A pull zone é protegida por Allowed Referrers e responde 403 sem o
   * cabeçalho — a mesma razão pela qual `no-referrer` quebrou as capas uma vez. */
  const status = async (nome, videoId) => {
    const r = await fetch('https://' + config.pullzone + '/' + videoId + '/' + nome,
      { method: 'HEAD', headers: { Referer: site + '/' } });
    return r.status;
  };

  const bunny = criarCliente();
  const mudados = [];
  let iguais = 0, sumidos = 0, recusados = 0, erros = 0;

  for (const item of alvos) {
    let v;
    try {
      v = await bunny.consultar(item.fonte.videoId);
    } catch (e) {
      if (/\b404\b/.test(e.message)) {
        sumidos++;
        console.log('  ⌀ ' + item.titulo + (item.publicar ? '' : '  (fora do ar)') + '  —  não existe mais no Bunny');
      } else {
        erros++;
        console.error('  ✖ ' + item.titulo + ': ' + e.message);
      }
      continue;
    }

    const nome = v.thumbnailFileName || 'thumbnail.jpg';
    if (item.capa_arquivo === nome) { iguais++; continue; }

    /* As duas pontas, conferidas na pull zone. A de antes diz o que a grade
     * mostra hoje (404 é o cartão sem capa); a nova tem de responder 200 antes
     * de ir para o catálogo — gravar um nome que a pull zone não serve só
     * trocaria uma capa quebrada por outra. */
    const antes = item.capa_arquivo ? await status(item.capa_arquivo, item.fonte.videoId) : null;
    const depois = await status(nome, item.fonte.videoId);
    console.log('  ' + (item.capa_arquivo ? '~' : '+') + ' ' + item.titulo + (item.publicar ? '' : '  (fora do ar)'));
    console.log('      ' + (item.capa_arquivo ? item.capa_arquivo + ' (' + antes + ')' : '(sem registro)') +
      '  ->  ' + nome + ' (' + depois + ')');
    if (depois !== 200) {
      recusados++;
      console.error('      ✖ a pull zone não serve o arquivo que o Bunny informa: nada gravado');
      continue;
    }
    if (!ensaio) {
      item.capa_arquivo = nome;
      item.capa_versao = String(Date.now());
    }
    mudados.push(item);
  }

  const resumo = mudados.length + ' a gravar  ·  ' + iguais + ' já corretos  ·  ' +
    sumidos + ' fora do Bunny  ·  ' + recusados + ' recusado(s)  ·  ' + erros + ' erro(s)';

  if (ensaio) {
    console.log('\n--simular: nada foi gravado.  ' + resumo);
    process.exit(0);
  }
  if (!mudados.length) { console.log('\nnada mudou.  ' + resumo); process.exit(0); }

  /* O KV inteiro volta como veio, com dois campos trocados nos títulos
   * tocados. Nada de `semear.mjs --sobrescrever`: ele reverteria os títulos e
   * séries editados pela mesa. O `rev` é o do GET, e o PUT recusa com 409 se
   * alguém tiver gravado no meio do caminho. */
  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(kv)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    throw new Error('gravação recusada (' + escrita.status + '): ' + (resposta.erro || JSON.stringify(resposta)));
  }
  console.log('\n✔ KV gravado  ·  rev ' + resposta.rev + '  ·  ' + resumo);

  /* O catálogo local leva os mesmos dois campos. Ele não serve a grade, mas
   * `acrescentar-ao-kv.mjs` lê dele — e um `capa_arquivo` velho ali é um nome
   * de arquivo que não existe mais esperando para voltar ao KV em silêncio. */
  try {
    const local = await lerCatalogo(caminhoCatalogo);
    const porId = new Map(local.itens.map(i => [i.id, i]));
    let noLocal = 0;
    for (const item of mudados) {
      const alvo = porId.get(item.id);
      if (!alvo) continue;
      alvo.capa_arquivo = item.capa_arquivo;
      alvo.capa_versao = item.capa_versao;
      noLocal++;
    }
    if (noLocal) {
      await gravarCatalogo(local, caminhoCatalogo);
      console.log('   e ' + noLocal + ' no ' + caminhoCatalogo.split(/[\\/]/).pop());
    }
  } catch (e) {
    console.error('   (o catálogo local não foi atualizado: ' + e.message + ')');
  }
} catch (e) {
  erroFatal(e);
}
