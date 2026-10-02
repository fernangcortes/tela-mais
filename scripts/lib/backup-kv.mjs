/* scripts/lib/backup-kv.mjs — exporta e restaura o backup pelo wrangler (nunca pela API direta, nunca com token colado).
 * Usado por scripts/exportar-kv.mjs e scripts/importar-kv.mjs.
 *
 * O FORMATO E AS REGRAS SÃO OS DO /admin: este módulo só dá ao Worker-lib (core/worker/_lib/backup.js) um `env.CATALOGO`
 * que fala com o KV pelo wrangler. Assim um backup baixado pelo botão do /admin restaura por aqui e vice-versa, e a
 * restauração é a MESMA publicação do painel (rev + 1, histórico, validação do catálogo e da config operacional).
 * O que mora no banco D1 (textos legais, espectadores) não é alcançável por wrangler de forma segura: fica para o botão
 * do /admin. A equipe (hash de senha) mora no KV e entra com --com-contas.
 *
 * Tudo que toca o mundo passa por `ctx.exec` (o wrangler) e `ctx.agora`; os testes trocam por falsos. */
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { criarWrangler, lerWrangler, recursosDoWrangler } from './setup/cloudflare.mjs';
import { falha } from './setup/erros.mjs';

const BANNER = /^\s*(?:⛅️?\s*)?wrangler\b[^\n]*\n(?:\s*[-─]{3,}\s*\n)?/i;
const limparSaida = (t) => String(t).replace(BANNER, '').replace(/\n$/, '');
const bibliotecaDeBackup = () => import('../../core/worker/_lib/backup.js');

/* Qual KV? --namespace-id; senão TELA_KV_ID; senão o id do wrangler.jsonc; senão procura "<projeto>-catalogo" na conta. */
export async function resolverNamespace(ctx, wr, flags) {
  if (flags['namespace-id']) return { id: String(flags['namespace-id']), origem: 'flag' };
  if (ctx.env.TELA_KV_ID) return { id: ctx.env.TELA_KV_ID, origem: 'ambiente' };
  const w = await lerWrangler(ctx.raiz);
  const { nome, kv } = recursosDoWrangler(w.dados || {});
  if (kv && kv.id) return { id: kv.id, origem: 'wrangler.jsonc' };
  if (flags.local) return { id: null, origem: 'binding-local' };
  const lista = await wr.listarKv();
  const achado = lista.find((x) => x.titulo === `${nome}-catalogo`) || lista.find((x) => /-catalogo$/.test(x.titulo || ''));
  if (achado) return { id: achado.id, origem: 'conta' };
  throw falha('kv-nao-encontrado', 'não achei o armazenamento do catálogo (KV).', { dica: 'Passe --namespace-id <id> (painel da Cloudflare, Armazenamento e bancos, KV) ou rode: node scripts/setup.mjs cloudflare provisionar.' });
}

/* Um `env` mínimo ({ CATALOGO }) com get/put/delete/list sobre o wrangler. A lista de chaves é lida UMA vez; get de chave
 * ausente da lista devolve null sem chamar o wrangler. `somenteLeitura` recusa qualquer escrita (exportar nunca grava). */
export function criarEnvKv(wr, { id, local = false, somenteLeitura = true }) {
  const alvo = id ? ['--namespace-id', id] : ['--binding', 'CATALOGO'];
  const onde = local ? ['--local'] : ['--remote'];
  let chaves = null;   /* Map nome -> { metadata } */
  const valores = new Map();
  const bloqueia = () => { if (somenteLeitura) throw new Error('kv-somente-leitura'); };

  async function carregar() {
    if (chaves) return chaves;
    const r = await wr.rodar(['kv', 'key', 'list', ...alvo, ...onde]);
    let j = null;
    try { j = JSON.parse(r.saida.slice(r.saida.indexOf('['))); } catch { /* cai no erro abaixo */ }
    if (r.codigo !== 0 || !Array.isArray(j)) throw falha('kv-lista', 'não consegui listar as chaves do KV.', { dica: (r.erro || r.saida).slice(0, 300) });
    chaves = new Map(j.map((k) => [k.name, { metadata: k.metadata ?? null }]));
    return chaves;
  }

  const CATALOGO = {
    async get(chave, tipo) {
      const todas = await carregar();
      if (!todas.has(chave)) return null;
      if (!valores.has(chave)) {
        const r = await wr.rodar(['kv', 'key', 'get', chave, ...alvo, ...onde, '--text']);
        if (r.codigo !== 0) throw falha('kv-leitura', `não consegui ler a chave "${chave}".`, { dica: (r.erro || r.saida).slice(0, 300) });
        valores.set(chave, limparSaida(r.saida));
      }
      const texto = valores.get(chave);
      if (tipo === 'json' || (tipo && tipo.type === 'json')) { try { return JSON.parse(texto); } catch { return null; } }
      return texto;
    },
    async put(chave, valor, opcoes) {
      bloqueia();
      const todas = await carregar();
      const pasta = await mkdtemp(path.join(tmpdir(), 'tela-kv-'));
      try {
        const arquivo = path.join(pasta, 'valor.txt');
        await writeFile(arquivo, String(valor), 'utf8');
        const extra = opcoes && opcoes.metadata != null ? ['--metadata', JSON.stringify(opcoes.metadata)] : [];
        const r = await wr.rodar(['kv', 'key', 'put', chave, '--path', arquivo, ...extra, ...alvo, ...onde]);
        if (r.codigo !== 0) throw falha('kv-gravacao', `o wrangler não conseguiu gravar a chave "${chave}".`, { dica: (r.erro || r.saida).slice(0, 300) });
      } finally { await rm(pasta, { recursive: true, force: true }); }
      todas.set(chave, { metadata: opcoes && opcoes.metadata != null ? opcoes.metadata : null });
      valores.set(chave, String(valor));
    },
    async delete(chave) {
      bloqueia();
      const todas = await carregar();
      if (!todas.has(chave)) return;
      const r = await wr.rodar(['kv', 'key', 'delete', chave, ...alvo, ...onde]);
      if (r.codigo !== 0) throw falha('kv-exclusao', `o wrangler não conseguiu apagar a chave "${chave}".`, { dica: (r.erro || r.saida).slice(0, 300) });
      todas.delete(chave); valores.delete(chave);
    },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const todas = await carregar();
      const nomes = [...todas.keys()].filter((n) => n.startsWith(prefix)).sort();
      const de = cursor ? Number(cursor) || 0 : 0;
      const fatia = nomes.slice(de, de + limit);
      const fim = de + limit >= nomes.length;
      return { keys: fatia.map((name) => ({ name, metadata: todas.get(name).metadata || undefined })), list_complete: fim, cursor: fim ? undefined : String(de + limit) };
    }
  };
  return { CATALOGO };
}

export async function coreVersaoDoProjeto(ctx) {
  try { return (await readFile(path.join(ctx.raiz, '.core-version'), 'utf8')).trim() || null; } catch { return null; }
}

async function preparar(ctx, flags, { escrita }) {
  const wr = criarWrangler(ctx);
  const ns = await resolverNamespace(ctx, wr, flags);
  const env = criarEnvKv(wr, { id: ns.id, local: !!flags.local, somenteLeitura: !escrita });
  return { ns, env };
}

/* EXPORTAR. Devolve { backup, namespace, registrado }; quem chama grava o arquivo. `registrar` anota "backup feito agora"
 * no KV (a tela Saúde lê isso) e por isso EXIGE permissão de escrita no KV: fica desligado por padrão. */
export async function exportarKv(ctx, { flags = {}, contas = false, registrar = false } = {}) {
  const lib = await bibliotecaDeBackup();
  const { ns, env } = await preparar(ctx, flags, { escrita: registrar });
  const backup = await lib.montarBackup({ env, incluirContas: contas, origem: 'script', agora: ctx.agora().getTime() });
  if (!backup.conteudo.catalogo) throw falha('sem-catalogo', 'o KV não tem a chave "catalogo": nada para fazer backup (o site já recebeu algum título?).', { dica: 'Confira se é o armazenamento certo (--namespace-id).' });
  let registrado = null;
  if (registrar) registrado = await lib.registrarBackup(env, backup, 'script');
  return { backup, namespace: ns, registrado };
}

/* RESTAURAR. `aplicar: false` só descreve (e confere o arquivo). Com `aplicar`, devolve `copiaDeSeguranca` (o estado
 * atual, no mesmo formato) para quem chama guardar em arquivo ANTES de qualquer escrita, e depois confere o hash do
 * catálogo relendo o KV. `partes` = quais partes restaurar ({ catalogo, operacao, contas }). */
export async function importarKv(ctx, texto, { flags = {}, partes = { catalogo: true, operacao: true }, aplicar = false, aoTerCopia = null } = {}) {
  const lib = await bibliotecaDeBackup();
  let arquivo;
  try { arquivo = JSON.parse(texto); } catch { throw falha('backup-invalido', 'o arquivo não é um JSON válido.'); }
  const v = await lib.verificarBackup(arquivo);
  if (!v.ok) throw falha('backup-invalido', `o arquivo de backup não passou na conferência (${v.codigo}${v.params && v.params.parte ? ': ' + v.params.parte : ''}).`, { dica: 'Use um arquivo gerado por exportar-kv.mjs ou pelo botão "Baixar backup" do /admin, sem editar.' });

  const { ns, env } = await preparar(ctx, flags, { escrita: aplicar });
  const atual = await env.CATALOGO.get('catalogo', 'json');
  const escolhas = { catalogo: !!partes.catalogo, operacao: !!partes.operacao, legal: false, contas: !!partes.contas };
  const naoAlcancadas = [];
  if (v.partes.includes('legal')) naoAlcancadas.push('textos legais (ficam no banco D1: use o botão "Restaurar" do /admin)');
  if (v.conteudo.contas && Array.isArray(v.conteudo.contas.espectadores) && v.conteudo.contas.espectadores.length) naoAlcancadas.push('espectadores (ficam no banco D1: use o botão "Restaurar" do /admin)');

  let copiaDeSeguranca = null;
  if (aplicar) {
    copiaDeSeguranca = await lib.montarBackup({ env, incluirContas: true, origem: 'script', agora: ctx.agora().getTime() });
    if (aoTerCopia) await aoTerCopia(copiaDeSeguranca);
  }
  const r = await lib.importarBackup({ env, backup: arquivo, escolhas, rev: atual ? (atual.rev || 0) : undefined, simular: !aplicar, quem: 'script' });
  if (!r.ok) throw falha('importacao-recusada', `a restauração foi recusada: ${r.codigo}${r.params && r.params.detalhe ? ' (' + r.params.detalhe + ')' : ''}.`, { dica: r.status === 409 ? 'O catálogo mudou durante a restauração. Rode de novo.' : undefined });

  const resultado = { namespace: ns, partes: r.partes, plano: r.plano, feito: r.feito || null, simulado: !aplicar, naoAlcancadas, copiaDeSeguranca, conferido: null, hashDoCatalogo: null };
  if (aplicar && r.partes.includes('catalogo')) {
    /* Relê o KV (cache zerado) e compara o hash do catálogo, que não conta rev nem data. */
    const { env: env2 } = await preparar(ctx, flags, { escrita: false });
    const depois = await lib.montarBackup({ env: env2, incluirContas: false, origem: 'script', agora: ctx.agora().getTime() });
    resultado.hashDoCatalogo = depois.hashes.catalogo;
    resultado.conferido = depois.hashes.catalogo === arquivo.hashes.catalogo;
  }
  return resultado;
}
