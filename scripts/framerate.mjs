/* scripts/framerate.mjs — grava no catálogo o `framerate` que o Bunny já sabe
 * de cada vídeo. É o único insumo que falta para o passo
 * quadro a quadro do player.
 *
 *   node scripts/framerate.mjs --simular          mostra o que gravaria
 *   node scripts/framerate.mjs --item <id>[,<id>] um título só
 *   node scripts/framerate.mjs                    todos
 *
 * POR QUE ISTO EXISTE. O `<video>` do HTML não tem passo de quadro — não existe
 * `stepForward()`. O jeito é `currentTime += 1 / fps`, e para isso é preciso
 * saber o fps de CADA título. A API do Bunny devolve `framerate` no objeto do
 * vídeo, de graça, e o catálogo é onde o navegador consegue ler.
 *
 * POR QUE NÃO DÁ PARA FIXAR 30. Um acervo costuma ser MISTO: 23,976, 24, 25,
 * 29,97 e 30 quadros por segundo convivem na mesma library. Um passo fixo de
 * 1/30 erraria na maioria deles. Num vídeo de 23,976 o passo
 * seria 20% curto, e `,` `,` `,` andaria dois quadros e meio em vez de três —
 * o tipo de erro que ninguém vê acontecendo e todo mundo sente.
 *
 * ONDE O CAMPO MORA, e por que não em `fonte`. Ele fica no TOPO do item, ao
 * lado de `duracao_seg`: os dois vêm do Bunny, os dois descrevem a mídia, e
 * `duracao_seg` já provou ser o lugar certo para esse tipo de número. `fonte`
 * guarda onde o vídeo está (tipo, library, id), não como ele é.
 *
 * A ARMADILHA QUE ESTE SCRIPT SOZINHO NÃO RESOLVE: gravar no KV não basta.
 * `functions/api/catalogo.js` monta a resposta pública campo a campo, em
 * `paraPublico()` — **campo que não sai por ali não existe para o navegador**.
 * É o erro clássico: já aconteceu com a lista de capítulos e com `capa_arquivo`.
 * O `framerate` foi acrescentado lá junto com este script; se alguém copiar
 * este arquivo para gravar OUTRO campo, essa é a segunda metade do trabalho.
 *
 * O QUE ELE NÃO PROMETE. O passo continua APROXIMADO, como o player avisa. O Bunny devolve 23,976
 * arredondado, quando a taxa de verdade é 24000/1001 = 23,976023976…; para UM passo a diferença é de
 * nanossegundos e não importa, mas ninguém deve contar quadros somando passos.
 * E o Firefox não tem `requestVideoFrameCallback`, então lá não há como
 * confirmar em que quadro o vídeo parou.
 */
import { criarCliente } from './lib/bunny.mjs';
import { argumentos, lerCatalogo, gravarCatalogo, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const ensaio = Boolean(op.simular);

/* Uma taxa de quadros plausível. O teto não é gosto: o `<video>` não vai além
 * disso em nenhum navegador de escola, e um número absurdo vindo de um vídeo
 * corrompido viraria um passo de tempo negativo ou infinitesimal — o tipo de
 * valor que atravessa o catálogo em silêncio e explode no player. */
function taxaValida(n) {
  const f = Number(n);
  return Number.isFinite(f) && f >= 1 && f <= 240;
}

try {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');

  /* A fonte da verdade é o KV, não o catálogo local, que costuma ficar
   * defasado. Mesmo caminho do capas-menores. */
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

  /* SÓ o `config` sai. Ele vem do AMBIENTE (library, pull zone) e o PUT o
   * descarta de qualquer jeito.
   *
   * O `ajustes` NÃO sai, e este comentário é o preço de um erro clássico: apagar os dois
   * como se ambos fossem "campo derivado". **Só o `config` é.**
   * O `ajustes` MORA no documento do catálogo (o `config` se apaga a cada
   * gravação). Um PUT sem ele apaga do KV o teto do arrasto e o tempo dos
   * controles, sem erro nenhum: o GET seguinte devolve `null` nos dois e o
   * player cai nos padrões do código.
   *
   * A regra que fica, e vale para o próximo script que gravar o KV: **o que
   * veio no GET volta no PUT, menos o `config`.** Há teste varrendo os
   * scripts atrás de um `delete` em `ajustes`. */
  delete kv.config;

  const pedidos = typeof op.item === 'string' ? new Set(op.item.split(',').map(s => s.trim())) : null;

  /* Todos os que têm vídeo, publicados ou não. Ao contrário das capas — que só
   * pesam na grade e por isso só valiam para os publicados —, o framerate é
   * barato e serve a qualquer título que um dia entre: colhê-lo agora evita
   * uma segunda passada no dia em que um pendente for publicado. */
  const alvos = (kv.itens || []).filter(i =>
    i && i.fonte && i.fonte.videoId && (!pedidos || pedidos.has(i.id)));

  if (!alvos.length) throw new Error('nenhum título com videoId bate com o pedido.');

  console.log('KV rev ' + kv.rev + '  ·  ' + alvos.length + ' título(s) com vídeo\n');

  const bunny = criarCliente();
  const mudados = [];
  const distribuicao = new Map();
  let iguais = 0, semTaxa = 0, sumidos = 0, erros = 0;

  for (const item of alvos) {
    let v;
    try {
      v = await bunny.consultar(item.fonte.videoId);
    } catch (e) {
      /* Um 404 aqui é o vídeo apagado do painel, não uma falha de rede — é o
       * caso de um título apagado do painel. Vale distinguir: o
       * primeiro é estado normal do acervo, o segundo é motivo para parar. */
      if (/\b404\b/.test(e.message)) {
        sumidos++;
        console.log('  ⌀ ' + item.titulo + '  —  não existe mais no Bunny');
      } else {
        erros++;
        console.error('  ✖ ' + item.titulo + ': ' + e.message);
      }
      continue;
    }

    if (!taxaValida(v.framerate)) {
      semTaxa++;
      console.log('  ? ' + item.titulo + '  —  o Bunny não deu framerate (' + v.framerate + ')');
      continue;
    }

    const fps = Number(v.framerate);
    distribuicao.set(fps, (distribuicao.get(fps) || 0) + 1);

    if (item.framerate === fps) { iguais++; continue; }

    console.log('  ' + (item.framerate ? '~' : '+') + ' ' + item.titulo);
    console.log('      ' + (item.framerate || '(sem registro)') + '  ->  ' + fps);
    if (!ensaio) item.framerate = fps;
    mudados.push({ id: item.id, fps });
  }

  console.log('\ntaxas encontradas: ' +
    [...distribuicao.entries()].sort((a, b) => b[1] - a[1])
      .map(([f, n]) => String(f).replace('.', ',') + ' ×' + n).join('  ·  '));

  const resumo = mudados.length + ' a gravar  ·  ' + iguais + ' já corretos  ·  ' +
    semTaxa + ' sem taxa  ·  ' + sumidos + ' fora do Bunny  ·  ' + erros + ' erro(s)';

  if (ensaio) {
    console.log('\n--simular: nada foi gravado.  ' + resumo);
    process.exit(0);
  }
  if (!mudados.length) { console.log('\nnada mudou.  ' + resumo); process.exit(0); }

  /* O KV inteiro volta como veio, com um campo a mais nos títulos tocados.
   * Nada de `semear.mjs --sobrescrever`: ele reverteria os títulos e séries
   * editados pela tela de admin. O `rev` é o do GET, e o PUT recusa com 409 se
   * alguém tiver gravado no meio do caminho. */
  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(kv)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    console.error('\n⚠ o KV NÃO foi gravado — e nada quebrou: o framerate é campo novo,');
    console.error('  ninguém depende dele ainda, e o player continua como está.');
    throw new Error('gravação recusada (' + escrita.status + '): ' + (resposta.erro || JSON.stringify(resposta)));
  }
  console.log('\n✔ KV gravado  ·  rev ' + resposta.rev + '  ·  ' + mudados.length + ' título(s)');

  /* O catálogo local leva o mesmo campo. Ele não serve a grade, mas
   * `acrescentar-ao-kv.mjs` lê dele — e um arquivo sem `framerate` é um campo
   * faltando esperando para voltar ao KV em silêncio. */
  try {
    const local = await lerCatalogo(caminhoCatalogo);
    const porId = new Map(local.itens.map(i => [i.id, i]));
    let noLocal = 0;
    for (const { id, fps } of mudados) {
      const alvo = porId.get(id);
      if (!alvo) continue;
      alvo.framerate = fps;
      noLocal++;
    }
    if (noLocal) {
      await gravarCatalogo(local, caminhoCatalogo);
      console.log('  catálogo local atualizado em ' + noLocal + ' título(s)');
    }
  } catch (e) {
    console.error('  ⚠ o catálogo local NÃO foi atualizado: ' + e.message);
    console.error('    O KV está certo — a grade não usa o arquivo local. Rode de novo para acertá-lo.');
  }
} catch (e) {
  erroFatal(e);
}
