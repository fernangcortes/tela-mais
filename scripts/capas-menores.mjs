/* scripts/capas-menores.mjs — troca as capas da pull zone por versões menores,
 * SEM trocar o quadro: a imagem que já está lá é baixada, reduzida e devolvida.
 *
 *   node scripts/capas-menores.mjs --medir             só mede o que está no ar
 *   node scripts/capas-menores.mjs --simular           mostra o plano e o que pouparia
 *   node scripts/capas-menores.mjs --item <id>[,<id>]  um título só (o piloto)
 *   node scripts/capas-menores.mjs                     todos
 *   node scripts/capas-menores.mjs --largura 640       muda o alvo
 *
 * POR QUE EXISTE: capas de 1280 px de largura entram num cartão de ~180 px no
 * celular e ~330 px no computador. É o único peso que todo mundo paga em toda
 * visita, e a tela inicial lenta em conexão ruim é a queixa mais comum.
 *
 * POR QUE NÃO É O `gerar-capas.mjs`: aquele extrai um quadro NOVO do master, e
 * regerar por cima desfaria a curadoria de quem escolheu a capa pela tela de
 * admin. Aqui a origem é a própria capa que está no ar — o quadro é o mesmo até
 * o último pixel, só que com menos deles.
 *
 * POR QUE NÃO É UM PARÂMETRO NA URL: o Bunny Optimizer resolveria isto com
 * `?width=400`, mas ele é um recurso pago e só vale se estiver ligado na sua
 * pull zone. Confira: se a resposta voltar idêntica com e sem o parâmetro, ele
 * está desligado, e este script é o caminho.
 *
 * A LARGURA, e de onde ela sai. O cartão da grade é o consumidor principal, e
 * ele mede no MÁXIMO ~321 px (o `.grade` resolve em 4 colunas dentro de um
 * `.limite` de 1400 px). No celular o teto é 180 px, escrito no `.card-capa`.
 * A 2× de densidade, 321 px pedem 642 — daí os 640.
 *
 * MAS O CARTÃO NÃO É O ÚNICO FREGUÊS: a mesma URL é o `poster` do player
 * (`player.js`), num quadro de ~881 px na ficha, e do tamanho da tela em tela
 * cheia. Por isso a largura não desce a 400: a 400 px o poster de 881 subiria
 * 2,2×, e ele é a primeira coisa que se vê antes do play. A 640 a subida é
 * 1,4×.
 *
 * O BUNNY PODE APAGAR A CAPA ANTERIOR: não conte com o arquivo velho
 * continuar no ar depois da troca. Então:
 *
 *   - o catálogo é gravado DEPOIS DE CADA ENVIO, e não uma vez no fim. Entre
 *     o envio e a gravação, a grade aponta para um arquivo que não existe
 *     mais: com o lote inteiro no meio, eram minutos de cartões sem capa;
 *   - o ORIGINAL fica guardado fora do Bunny, em `--guardar` (padrão
 *     `~/.tm-capas-originais`), antes de a versão menor subir. Desfazer é
 *     enviar o original de volta — pela mesa, "Enviar JPG";
 *   - capa que o Bunny já trocou NÃO é reduzida: o arquivo baixado seria o do
 *     catálogo, e a versão menor dele voltaria ao ar POR CIMA da escolha nova.
 *     O script para nesse título e manda rodar o `sincronizar-capas.mjs`.
 *
 * O `preview.webp` NÃO é tocado: ele é pedido só no `mouseenter`, nunca na
 * carga da tela, e é outro problema.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, mkdtemp, mkdir, rmdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { argumentos, lerCatalogo, gravarCatalogo, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';
import { videoDoItem, dadosDoItem, exigirCapacidade, exigirConfigurado, provedorDoAmbiente } from './lib/provedores/index.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const LARGURA = Number(op.largura) > 0 ? Number(op.largura) : 640;
const QUALIDADE = Number(op.qualidade) > 0 ? Number(op.qualidade) : 4;
const ensaio = Boolean(op.simular || op.medir);
const guardarEm = typeof op.guardar === 'string' ? op.guardar : join(homedir(), '.tm-capas-originais');

/* Largura e altura lidas do próprio JPEG (marcador SOFn). Sem dependência: o
 * projeto tem uma dependência de terceiros só, e ela é a hls.js. */
function dimensoes(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

/* `min(LARGURA, iw)` e não `LARGURA`: uma capa que já seja menor que o alvo não
 * pode ser AMPLIADA por este script — sairia maior e mais borrada. */
function reduzir(entrada, saida) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-v', 'error', '-i', entrada,
      '-vf', "scale='min(" + LARGURA + ",iw)':-2",
      '-q:v', String(QUALIDADE),
      saida
    ]);
    let erro = '';
    ff.stderr.on('data', d => { erro += d; });
    ff.on('error', e => reject(new Error('ffmpeg não rodou: ' + e.message)));
    ff.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg ' + c + ': ' + erro.slice(0, 300))));
  });
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

/* A URL da capa atual, montada pelo ADAPTADOR (sem `versao`: é o arquivo, não o cache do navegador). */
function urlCapa(provedor, item) {
  const v = videoDoItem(provedor, item);
  return provedor.urlCapa(v.id, { arquivo: item.capa_arquivo || undefined, extras: v.extras });
}

/* A pull zone é protegida por Allowed Referrers e responde 403 sem o cabeçalho.
 * É a mesma razão pela qual `no-referrer` quebrou as capas uma vez. */
async function baixar(url) {
  const r = await fetch(url, { headers: { Referer: site + '/' } });
  if (!r.ok) throw new Error('o provedor respondeu ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

try {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');

  /* A fonte da verdade é o KV, não o catálogo local — ele costuma ficar
   * com `publicar: false` e defasado em relação ao que a tela de admin editou. */
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
  delete kv.config;
  const { provedor } = await provedorDoAmbiente();
  exigirConfigurado(provedor);
  /* Trocar a capa por upload é coisa do provedor que a recebe (Bunny); os outros guardam o instante ou o endereço. */
  exigirCapacidade(provedor, 'capaPorUpload', 'trocar a capa por um arquivo menor');

  const pedidos = typeof op.item === 'string' ? new Set(op.item.split(',').map(s => s.trim())) : null;

  /* Só o que a grade mostra: capa de título não publicado não pesa na tela
   * inicial, e mexer nela seria trabalho sem ninguém do outro lado. */
  const alvos = (kv.itens || []).filter(i =>
    i && i.publicar === true && videoDoItem(provedor, i) &&
    (!pedidos || pedidos.has(i.id)));

  if (!alvos.length) throw new Error('nenhum título publicado bate com o pedido.');

  console.log('KV rev ' + kv.rev + '  ·  ' + alvos.length + ' capa(s) publicada(s)  ·  alvo: ' +
    LARGURA + ' px de largura, q=' + QUALIDADE + '\n');

  const pasta = await mkdtemp(join(tmpdir(), 'tm-capas-'));
  const feitos = [];
  let somaAntes = 0, somaDepois = 0, erros = 0, jaPequenas = 0, jaTrocadas = 0;
  /* O provedor é consultado também no ensaio: é a consulta que acha a capa que ele
   * já trocou, e o ensaio tem de mostrá-la antes de a troca de verdade tropeçar
   * nela. */
  if (!ensaio) await mkdir(guardarEm, { recursive: true });

  /* UMA GRAVAÇÃO POR CAPA, cada uma com a `rev` que a anterior devolveu. O KV
   * inteiro volta como veio, com dois campos trocados no título tocado. Nada de
   * `semear.mjs --sobrescrever`: ele reverteria os títulos e séries editados
   * pela mesa. O PUT recusa com 409 se alguém tiver gravado no meio do caminho. */
  async function gravarKV() {
    const escrita = await fetch(site + '/api/catalogo', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(kv)
    });
    const resposta = await escrita.json().catch(() => ({}));
    if (!escrita.ok) {
      throw new Error('gravação recusada (' + escrita.status + '): ' + (resposta.erro || JSON.stringify(resposta)));
    }
    kv.rev = resposta.rev;
    return resposta.rev;
  }

  try {
    for (const item of alvos) {
      const noProvedor = (await dadosDoItem(provedor, item)).arquivoCapa || 'thumbnail.jpg';
      if (noProvedor !== (item.capa_arquivo || 'thumbnail.jpg')) {
        jaTrocadas++;
        console.log(agora() + '  ≠  ' + item.titulo + '  —  o provedor já tem outra capa (' + noProvedor +
          '): rode o sincronizar-capas.mjs antes');
        continue;
      }

      const antes = await baixar(await urlCapa(provedor, item));
      const d = dimensoes(antes);
      somaAntes += antes.length;

      if (d.w && d.w <= LARGURA) {
        jaPequenas++;
        somaDepois += antes.length;
        console.log(agora() + '  =  ' + item.titulo + '  (já tem ' + d.w + ' px)');
        continue;
      }

      const cru = join(pasta, item.id + '.orig.jpg');
      const novo = join(pasta, item.id + '.jpg');
      await writeFile(cru, antes);
      await reduzir(cru, novo);
      const depois = await readFile(novo);
      const dd = dimensoes(depois);
      somaDepois += depois.length;

      if (ensaio) {
        console.log(agora() + '  ·  ' + item.titulo);
        console.log('        ' + d.w + '×' + d.h + ' ' + kb(antes.length) +
          '  ->  ' + dd.w + '×' + dd.h + ' ' + kb(depois.length));
      } else {
        /* O original sai daqui ANTES do envio: depois dele, o provedor apaga o
         * arquivo, e este é o único caminho de volta. */
        const de = item.capa_arquivo || 'thumbnail.jpg';
        const original = join(guardarEm, item.id + '--' + de);
        await writeFile(original, antes);

        let enviada = false;
        try {
          /* O adaptador troca a capa e já devolve o nome novo (relê o vídeo: o Bunny grava com hash). */
          const troca = await provedor.definirCapa(videoDoItem(provedor, item).id, depois, 'image/jpeg');
          enviada = true;
          const nome = troca.arquivo || 'thumbnail.jpg';
          item.capa_arquivo = nome;
          item.capa_versao = troca.versao || String(Date.now());
          const rev = await gravarKV();
          feitos.push({ item, de, para: nome });
          console.log(agora() + '  ✔  ' + item.titulo + '   rev ' + rev);
          console.log('        ' + d.w + '×' + d.h + ' ' + kb(antes.length) +
            '  ->  ' + dd.w + '×' + dd.h + ' ' + kb(depois.length) + '   ' + de + ' -> ' + nome);
        } catch (e) {
          erros++;
          somaDepois += antes.length - depois.length;   /* não mudou: desfaz a conta */
          console.error(agora() + '  ✖  ' + item.titulo + ': ' + e.message);
          if (enviada) {
            /* Entre o envio e a gravação a capa do catálogo deixou de existir:
             * o cartão está SEM CAPA no site agora. Parar é o certo — seguir
             * multiplicaria o estrago —, e o conserto é uma linha. */
            console.error('\n⚠ A CAPA NOVA ESTÁ NO PROVEDOR, E O KV NÃO FOI GRAVADO.');
            console.error('  O provedor apaga a capa anterior: este título está sem capa no site agora.');
            console.error('  Conserte com:   node scripts/sincronizar-capas.mjs --item ' + item.id);
            console.error('  O original ficou em ' + original);
            throw e;
          }
        }
      }

      await unlink(cru).catch(() => {});
      await unlink(novo).catch(() => {});
    }
  } finally {
    await rmdir(pasta).catch(() => {});
  }

  console.log('\nantes:  ' + mb(somaAntes) + '   ·   depois: ' + mb(somaDepois) +
    '   ·   poupa ' + mb(somaAntes - somaDepois) +
    ' (' + (100 - somaDepois / somaAntes * 100).toFixed(0) + '%)');
  if (jaPequenas) console.log('já estavam no tamanho: ' + jaPequenas);
  if (jaTrocadas) console.log('o provedor já tinha outra capa, e ficaram de fora: ' + jaTrocadas);
  if (erros) console.log('erros: ' + erros);

  if (ensaio) {
    console.log('\nensaio: nada foi enviado ao provedor nem gravado no KV.');
    process.exit(0);
  }
  if (!feitos.length) { console.log('\nnada mudou.'); process.exit(0); }

  console.log('\n✔ KV gravado a cada capa  ·  rev ' + kv.rev + '  ·  ' + feitos.length +
    ' capa(s) trocada(s)  ·  originais em ' + guardarEm);

  /* O catálogo local leva os mesmos dois campos. Ele não serve a grade, mas
   * `acrescentar-ao-kv.mjs` lê dele — e um `capa_arquivo` velho ali é um nome
   * de arquivo antigo esperando para voltar ao KV em silêncio. */
  try {
    const local = await lerCatalogo(caminhoCatalogo);
    const porId = new Map(local.itens.map(i => [i.id, i]));
    let noLocal = 0;
    for (const { item } of feitos) {
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

  console.log('\npara conferir o que ficou no ar:');
  console.log('   node scripts/capas-menores.mjs --medir');
} catch (e) {
  erroFatal(e);
}
