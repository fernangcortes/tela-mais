/* scripts/lib/setup/cmd-marca.mjs — `setup.mjs marca`: nome, slogan, cores e logo da marca do cliente. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { sugerirCorParaPares, contraste, paraRgb, deRgb } from '../../../core/worker/_lib/contraste.mjs';
import { resolverTema } from '../../../core/worker/_lib/tema.mjs';
import { erroUso, pendente } from './erros.mjs';
import { definirCaminho, lerCaminho } from './config-io.mjs';
import { dimensoesDoPng, gerarIcones, inicialDoNome } from './marca-icones.mjs';
import { salvarConfig, siteAtual, normalizarHex } from './comum.mjs';

const PASTA = 'marca';   /* dentro de core/site */

const misturar = (a, b, t) => { const x = paraRgb(a), y = paraRgb(b); return deRgb(x.map((v, i) => v + (y[i] - v) * t)); };

/* A paleta de um esquema a partir de UMA cor da marca, mantendo o contraste que o validador exige. */
export function derivarPaleta(corBase, esquema, cores) {
  const base = normalizarHex(corBase);
  const fundoDoMesa = cores.mesaPainel;
  const marcaFraca = misturar(cores.fundo, base, esquema === 'escuro' ? 0.14 : 0.12);
  const pares = [cores.fundo, cores.superficie, fundoDoMesa, marcaFraca].filter(Boolean).map((fundo) => ({ fundo, minimo: 4.5 }));
  const marca = sugerirCorParaPares(base, pares);
  const marcaClara = esquema === 'escuro' ? misturar(marca, '#ffffff', 0.2) : misturar(marca, '#000000', 0.2);
  const candidatos = ['#ffffff', '#000000'];
  const pior = (t) => Math.min(contraste(t, marca), contraste(t, marcaClara));
  const textoSobreMarca = candidatos.sort((p, q) => pior(q) - pior(p))[0];
  return { marca, marcaClara, marcaFraca, marca2: marca, textoSobreMarca, ajustada: marca !== base };
}

function validarSvg(texto) {
  if (!/<svg[\s>]/i.test(texto)) throw erroUso('o arquivo não parece um SVG (não achei a marca <svg>).');
  if (/<script|javascript:|<foreignObject|<!ENTITY|\son[a-z]+\s*=/i.test(texto)) throw erroUso('o SVG tem script ou recurso perigoso (script, onload, foreignObject). Exporte um SVG limpo do seu editor de imagens.');
  if (texto.length > 500 * 1024) throw erroUso('o SVG tem mais de 500 KB; use uma versão mais leve.');
}

async function lerImagem(caminho, rotulo) {
  let buf;
  try { buf = await readFile(caminho); } catch { throw erroUso(`não achei o arquivo ${rotulo}: ${caminho}`, 'Confira o caminho (arraste o arquivo para o terminal para colar o caminho certo).'); }
  const ext = path.extname(caminho).toLowerCase();
  if (ext === '.svg') { const t = buf.toString('utf8'); validarSvg(t); return { tipo: 'svg', ext, buf, texto: t }; }
  if (ext === '.png') { const d = dimensoesDoPng(buf); if (!d) throw erroUso(`${rotulo} não é um PNG válido.`); return { tipo: 'png', ext, buf, dim: d }; }
  throw erroUso(`${rotulo}: só aceito SVG ou PNG (recebi "${ext || 'sem extensão'}").`);
}

function tamanhoDoSvg(texto) {
  const cab = /<svg[^>]*>/i.exec(texto)[0];
  const w = /\swidth="([\d.]+)(?:px)?"/i.exec(cab), h = /\sheight="([\d.]+)(?:px)?"/i.exec(cab);
  if (w && h) return { largura: Math.round(+w[1]), altura: Math.round(+h[1]) };
  const vb = /viewBox="([\d.\s-]+)"/i.exec(cab);
  if (vb) { const p = vb[1].trim().split(/\s+/).map(Number); if (p.length === 4 && p[2] > 0 && p[3] > 0) { const k = 48 / p[3]; return { largura: Math.max(1, Math.round(p[2] * k)), altura: 48 }; } }
  return null;
}

async function gravarSeDiferente(raiz, relativo, conteudo) {
  const destino = path.join(raiz, 'core', 'site', relativo);
  let atual = null;
  try { atual = await readFile(destino); } catch { /* novo */ }
  const novo = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
  if (atual && atual.equals(novo)) return false;
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, novo);
  return true;
}

/* Aplica as escolhas de marca sobre `bruto` (já clonado). Grava imagens (salvo --dry-run). Devolve { ajustes[], arquivos[] }. */
export async function aplicarMarca(ctx, rel, bruto, o) {
  const ajustes = [];
  const gravados = [];
  const precisaAceitar = [];
  const tocouIdentidade = o.nome !== undefined || o.cor !== undefined || o.corClara !== undefined;
  if (o.nome !== undefined) {
    if (!o.nome.trim() || o.nome.length > 80) throw erroUso('o nome precisa ter de 1 a 80 caracteres.');
    definirCaminho(bruto, 'marca.nome', o.nome.trim());
    const curto = o.nomeCurto ?? (o.nome.trim().length <= 12 ? o.nome.trim() : o.nome.trim().split(/\s+/)[0].slice(0, 12));
    if (o.nomeCurto !== undefined || !lerCaminho(bruto, 'marca.nomeCurto') || lerCaminho(bruto, 'marca.nomeCurto') === 'Exemplo') definirCaminho(bruto, 'marca.nomeCurto', curto);
    if (!lerCaminho(bruto, 'marca.organizacao') || lerCaminho(bruto, 'marca.organizacao') === 'Organização Exemplo') definirCaminho(bruto, 'marca.organizacao', o.nome.trim());
    const desc = lerCaminho(bruto, 'marca.descricao');
    if (!desc || /Plataforma Exemplo/.test(desc)) definirCaminho(bruto, 'marca.descricao', `Catálogo de vídeos de ${o.nome.trim()}.`);
  } else if (o.nomeCurto !== undefined) definirCaminho(bruto, 'marca.nomeCurto', o.nomeCurto);
  if (o.slogan !== undefined) definirCaminho(bruto, 'marca.slogan', o.slogan);

  /* cores */
  if (o.cor !== undefined || o.corClara !== undefined) {
    const escura = o.cor !== undefined ? normalizarHex(o.cor) : null;
    const clara = o.corClara !== undefined ? normalizarHex(o.corClara) : escura;
    if ((o.cor !== undefined && !escura) || (o.corClara !== undefined && !clara)) throw erroUso('cor inválida. Use o formato #rrggbb (por exemplo #0b7285).');
    const tema = resolverTema({ tema: bruto.tema });
    for (const [esq, base] of [['escuro', escura], ['claro', clara]]) {
      if (!base) continue;
      const p = derivarPaleta(base, esq, tema.cores[esq]);
      for (const k of ['marca', 'marcaClara', 'marcaFraca', 'marca2', 'textoSobreMarca']) definirCaminho(bruto, `tema.cores.${esq}.${k}`, p[k]);
      if (p.ajustada) { ajustes.push(`No tema ${esq}, a cor ${base} não tinha contraste suficiente para ler; usei ${p.marca} (mesmo tom, mais legível).`); precisaAceitar.push({ esq, base, usada: p.marca }); }
    }
    /* A cor é da marca da pessoa: não trocamos sem ela saber. Com "sim" (--yes, ou resposta no terminal) seguimos. */
    if (precisaAceitar.length && !ctx.flags.yes) {
      const lista = precisaAceitar.map((x) => `${x.base} (tema ${x.esq}) ficaria ${x.usada}`).join('; ');
      const pergunta = `A cor que você pediu não tem contraste suficiente para o texto ser lido: ${lista}. Posso usar a versão mais próxima que se lê bem?`;
      if (ctx.interativo) {
        if (!(await ctx.perguntar.confirmar(pergunta, true))) throw pendente('cor-recusada', 'a cor não foi trocada e nada foi gravado. Escolha outra cor mais escura ou mais clara.', { quem: 'agente', comando: 'node scripts/setup.mjs marca --cor "#rrggbb"' });
      } else {
        throw pendente('cor-sem-contraste', pergunta + ' Nada foi gravado.', { quem: 'agente', comando: `node scripts/setup.mjs marca ${[o.nome !== undefined ? `--nome "${o.nome}"` : '', o.cor !== undefined ? `--cor ${o.cor}` : '', o.corClara !== undefined ? `--cor-clara ${o.corClara}` : ''].filter(Boolean).join(' ')} --yes`, dica: 'Pergunte à pessoa. Se ela aceitar, rode o comando com --yes; se não, peça outra cor.', dados: { ajustes: precisaAceitar } });
      }
    }
  }

  /* imagens */
  const arquivos = new Map();   /* relativo a core/site -> conteúdo */
  const arqs = {};
  for (const [chave, flag, base] of [['logoParaFundoEscuro', o.logo, 'logo-escuro'], ['logoParaFundoClaro', o.logoClaro || o.logo, 'logo-claro']]) {
    if (!flag) continue;
    const img = await lerImagem(path.resolve(flag), chave === 'logoParaFundoEscuro' ? '--logo' : '--logo-claro');
    if (img.tipo === 'png' && (img.dim.largura > 2000 || img.dim.altura > 2000)) throw erroUso('o logo PNG passa de 2000 px; reduza a imagem.');
    const rel_ = `${PASTA}/${base}${img.ext}`;
    arquivos.set(rel_, img.buf);
    arqs[chave] = rel_;
    if (chave === 'logoParaFundoEscuro') {
      const t = img.tipo === 'png' ? img.dim : tamanhoDoSvg(img.texto);
      if (t) definirCaminho(bruto, 'marca.arquivos.logoTamanho', t);
      if (!lerCaminho(bruto, 'marca.arquivos.textoAlternativoDoLogo')) definirCaminho(bruto, 'marca.arquivos.textoAlternativoDoLogo', String(lerCaminho(bruto, 'marca.nome') || '').slice(0, 100));
    }
  }
  const proprios = { icone512: o.icone512, icone192: o.icone192, favicon32: o.favicon32 };
  const medidas = { icone512: 512, icone192: 192, favicon32: 32 };
  for (const [chave, flag] of Object.entries(proprios)) {
    if (!flag) continue;
    const img = await lerImagem(path.resolve(flag), { icone512: '--icone-512', icone192: '--icone-192', favicon32: '--favicon-32' }[chave]);
    if (img.tipo !== 'png' || img.dim.largura !== medidas[chave] || img.dim.altura !== medidas[chave]) throw erroUso(`${chave} precisa ser um PNG de ${medidas[chave]}x${medidas[chave]} pixels.`);
    const destino = `${PASTA}/${chave === 'icone512' ? 'icone-512' : chave === 'icone192' ? 'icone-192' : 'favicon-32'}.png`;
    arquivos.set(destino, img.buf);
    arqs[chave] = destino;
  }
  const gerar = (tocouIdentidade || o.icones === true) && o.semIcones !== true;
  if (gerar) {
    const esc = lerCaminho(bruto, 'tema.cores.escuro') || {};
    const tema = resolverTema({ tema: bruto.tema });
    const cor = esc.marca || tema.cores.escuro.marca;
    const texto = esc.textoSobreMarca || tema.cores.escuro.textoSobreMarca;
    const ic = gerarIcones({ cor, corTexto: texto, inicial: inicialDoNome(lerCaminho(bruto, 'marca.nome')), fundoFora: tema.cores.escuro.fundo });
    const mapa = { 'icone.svg': ['iconeSvg', 'icone.svg'], 'icone-192.png': ['icone192', 'icone-192.png'], 'icone-512.png': ['icone512', 'icone-512.png'], 'favicon-32.png': ['favicon32', 'favicon-32.png'], 'og-image.png': ['imagemDeCompartilhamento', 'og-image.png'] };
    for (const [nome, [chave]] of Object.entries(mapa)) {
      if (arqs[chave]) continue;                      /* o cliente entregou o dele */
      arquivos.set(`${PASTA}/${nome}`, ic[nome]);
      arqs[chave] = `${PASTA}/${nome}`;
    }
    const semLogo = !o.logo && !lerCaminho(bruto, 'marca.arquivos.logoParaFundoEscuro');
    ajustes.push('Gerei ícones, favicon e imagem de compartilhamento com a cor da marca e a inicial do nome. Isso é PROVISÓRIO: para usar a sua arte, rode marca com --logo arquivo.svg (e --icone-512, --icone-192, --favicon-32 se tiver os ícones prontos).');
    if (semLogo) ajustes.push('Ainda não há um logo seu (só o ícone provisório). Quando tiver o arquivo (SVG ou PNG), rode: node scripts/setup.mjs marca --logo caminho/do/logo.svg');
  }
  for (const [k, v] of Object.entries(arqs)) definirCaminho(bruto, `marca.arquivos.${k}`, v);

  for (const [relativo, conteudo] of arquivos) {
    if (ctx.flags.dryRun) { rel.acao('imagem:' + relativo, `Gravaria core/site/${relativo}`, 'simulado'); continue; }
    const mudou = await gravarSeDiferente(ctx.raiz, relativo, conteudo);
    rel.acao('imagem:' + relativo, `core/site/${relativo}`, mudou ? 'feito' : 'ja-estava');
    gravados.push(relativo);
  }
  return { ajustes, arquivos: [...arquivos.keys()], gravados };
}

export const marca = {
  nome: 'marca',
  resumo: 'Nome, slogan, cores e logo da sua marca (gera ícones e favicon).',
  uso: 'marca [--nome "Nome"] [--nome-curto X] [--slogan "..."] [--cor #rrggbb] [--cor-clara #rrggbb] [--logo arquivo.svg|png] [--logo-claro arquivo] [--icone-512 f.png] [--icone-192 f.png] [--favicon-32 f.png] [--icones]',
  flags: { nome: 'valor', 'nome-curto': 'valor', slogan: 'valor', cor: 'valor', 'cor-clara': 'valor', logo: 'valor', 'logo-claro': 'valor', 'icone-512': 'valor', 'icone-192': 'valor', 'favicon-32': 'valor', icones: 'bool', 'sem-icones': 'bool' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const { bruto, existe } = await siteAtual(ctx);
    if (!existe) throw erroUso('não existe config/site.json. Rode antes: node scripts/setup.mjs init');
    const o = {
      nome: f.nome, nomeCurto: f['nome-curto'], slogan: f.slogan, cor: f.cor, corClara: f['cor-clara'], logo: f.logo, logoClaro: f['logo-claro'],
      icone512: f['icone-512'], icone192: f['icone-192'], favicon32: f['favicon-32'], icones: f.icones, semIcones: f['sem-icones']
    };
    const nenhuma = Object.entries(o).every(([, v]) => v === undefined || v === false);
    if (nenhuma && ctx.interativo && !f.yes) {
      const p = ctx.perguntar;
      o.nome = await p.texto('Nome da sua plataforma', lerCaminho(bruto, 'marca.nome'));
      o.slogan = await p.texto('Frase curta embaixo do nome (opcional)', lerCaminho(bruto, 'marca.slogan') || '');
      const cor = await p.texto('Cor principal em #rrggbb (Enter mantém a do tema)', '');
      if (cor) o.cor = cor;
      const logo = await p.texto('Arquivo do logo SVG ou PNG (Enter pula)', '');
      if (logo) o.logo = logo;
    } else if (nenhuma) {
      rel.info('Nada a mudar: informe pelo menos uma opção (--nome, --slogan, --cor, --logo...).');
      rel.dado('mudou', false);
      return 0;
    }
    const antes = JSON.stringify(bruto);
    const r = await aplicarMarca(ctx, rel, bruto, o);
    for (const a of r.ajustes) rel.info(a);
    if (JSON.stringify(bruto) !== antes || r.gravados.length) await salvarConfig(ctx, rel, bruto, 'Atualizei a marca em config/site.json');
    else rel.acao('config', 'config/site.json já estava assim', 'ja-estava');
    rel.dado('marca', { nome: bruto.marca?.nome, cor: bruto.tema?.cores?.escuro?.marca ?? null, arquivos: r.arquivos });
    rel.passo('Veja o resultado com: npm run dev  (ou siga para: node scripts/setup.mjs acesso)');
    return 0;
  }
};
