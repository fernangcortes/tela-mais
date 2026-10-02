/* scripts/lib/setup/cloudflare.mjs — fala com o wrangler (nunca com a API da Cloudflare direto, nunca com token global).
 *
 * Tudo passa por `ctx.exec(comando, args, { input?, cwd?, env? })`, que devolve { codigo, saida, erro }; nos
 * testes `exec` é um wrangler simulado. O valor de um segredo só viaja em `input` (stdin do processo), nunca em `args`. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lerJsonc, definirCampo, trocarString } from './jsonc.mjs';
import { falha, pendente } from './erros.mjs';
import { SEGREDOS_CONHECIDOS } from './segredos.mjs';

export const WRANGLER = Object.freeze(['--yes', 'wrangler@4']);   /* npx --yes wrangler@4 ... */
export const BINDING_KV = 'CATALOGO';
export const BINDING_D1 = 'DB';

export function criarWrangler(ctx) {
  const { exec, raiz } = ctx;
  const base = () => (ctx.env.TELA_WRANGLER ? { cmd: ctx.env.TELA_WRANGLER, pre: [] } : { cmd: 'npx', pre: [...WRANGLER] });

  async function rodar(args, { input, env } = {}) {
    const { cmd, pre } = base();
    const r = await exec(cmd, [...pre, ...args], { cwd: raiz, input, env });
    return { codigo: r.codigo, saida: String(r.saida ?? ''), erro: String(r.erro ?? '') };
  }
  const json = (t) => { try { return JSON.parse(t); } catch { const m = /[\[{][\s\S]*[\]}]/.exec(t); if (m) { try { return JSON.parse(m[0]); } catch { /* segue */ } } return null; } };

  return {
    rodar,
    async versao() {
      const r = await rodar(['--version']);
      const m = /(\d+\.\d+\.\d+)/.exec(r.saida + r.erro);
      return r.codigo === 0 && m ? m[1] : null;
    },
    /* { logado, email, contas:[{id,nome}], viaToken } */
    async quemSou() {
      const r = await rodar(['whoami', '--json']);
      const j = json(r.saida);
      if (j && typeof j === 'object') {
        return { logado: j.loggedIn === true, email: j.email || null, contas: (j.accounts || []).map((a) => ({ id: a.id, nome: a.name })), viaToken: /token/i.test(String(j.authType || '')) && !/oauth/i.test(String(j.authType || '')) };
      }
      const texto = r.saida + r.erro;
      if (r.codigo !== 0 || /not authenticated|not logged in|nao autenticado/i.test(texto)) return { logado: false, email: null, contas: [], viaToken: false };
      const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(texto);
      return { logado: true, email: email ? email[0] : null, contas: [], viaToken: false };
    },
    async listarKv() {
      const r = await rodar(['kv', 'namespace', 'list']);
      const j = json(r.saida);
      if (r.codigo !== 0 || !Array.isArray(j)) throw falha('wrangler-kv-lista', 'não consegui listar os armazenamentos (KV, onde fica o catálogo) da sua conta.', { dica: r.erro.slice(0, 300) });
      return j.map((x) => ({ id: x.id, titulo: x.title }));
    },
    async criarKv(titulo) {
      const r = await rodar(['kv', 'namespace', 'create', titulo]);
      const m = /"?id"?\s*[:=]\s*"([0-9a-f]{32})"/i.exec(r.saida + r.erro);
      if (r.codigo !== 0 || !m) throw falha('wrangler-kv-criar', 'não consegui criar o armazenamento do catálogo (KV).', { dica: (r.erro || r.saida).slice(0, 300) });
      return m[1];
    },
    async listarD1() {
      const r = await rodar(['d1', 'list', '--json']);
      const j = json(r.saida);
      if (r.codigo !== 0 || !Array.isArray(j)) throw falha('wrangler-d1-lista', 'não consegui listar os bancos (D1, onde ficam as contas das pessoas) da sua conta.', { dica: r.erro.slice(0, 300) });
      return j.map((x) => ({ id: x.uuid || x.id, nome: x.name }));
    },
    async criarD1(nome) {
      const r = await rodar(['d1', 'create', nome]);
      const m = /database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i.exec(r.saida + r.erro);
      if (r.codigo !== 0 || !m) throw falha('wrangler-d1-criar', 'não consegui criar o banco de contas (D1).', { dica: (r.erro || r.saida).slice(0, 300) });
      return m[1];
    },
    /* { existeWorker, nomes[] }: só os NOMES dos segredos; o wrangler nunca devolve valores. */
    async listarSegredos() {
      const r = await rodar(['secret', 'list', '--format', 'json']);
      const j = json(r.saida);
      if (r.codigo !== 0 || !Array.isArray(j)) return { existeWorker: false, nomes: [] };
      return { existeWorker: true, nomes: j.map((x) => x.name) };
    },
    async colocarSegredo(nome, valor) {
      const r = await rodar(['secret', 'put', nome], { input: valor + '\n' });
      if (r.codigo !== 0) throw falha('wrangler-segredo', `o wrangler não aceitou o segredo${/^[A-Z][A-Z0-9_]*$/.test(nome) && SEGREDOS_CONHECIDOS.includes(nome) ? ' ' + nome : ''}.`, { dica: 'O Worker ainda pode não existir: publique uma vez (node scripts/setup.mjs deploy) e repita.' });
      return true;
    },
    async publicar() {
      const r = await rodar(['deploy']);
      const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(r.saida + r.erro);
      return { ok: r.codigo === 0, url: url ? url[0] : null, saida: (r.saida + r.erro).slice(-600) };
    }
  };
}

/* ------------------------------------------------------------------ wrangler.jsonc */

export const caminhoWrangler = (raiz) => path.join(raiz, 'wrangler.jsonc');

export async function lerWrangler(raiz) {
  let texto;
  try { texto = await readFile(caminhoWrangler(raiz), 'utf8'); } catch { return { existe: false, texto: '', dados: {} }; }
  try { return { existe: true, texto, dados: lerJsonc(texto) }; }
  catch (e) { throw falha('wrangler-quebrado', `não consegui ler o wrangler.jsonc (${e.message}).`, { dica: 'Restaure o arquivo com git ou confira vírgulas e aspas.' }); }
}

export function recursosDoWrangler(dados) {
  const kv = (dados.kv_namespaces || []).find((k) => k.binding === BINDING_KV) || null;
  const d1 = (dados.d1_databases || []).find((d) => d.binding === BINDING_D1) || null;
  return { nome: dados.name || null, kv, d1 };
}

export async function gravarIdsNoWrangler(raiz, { kvId, d1Id, nomeDoProjeto, nomeAntigo }, { dryRun = false } = {}) {
  const w = await lerWrangler(raiz);
  if (!w.existe) throw falha('sem-wrangler', 'não encontrei wrangler.jsonc na raiz do projeto.');
  let texto = w.texto;
  let mudou = false;
  if (kvId) { const r = definirCampo(texto, /"binding"\s*:\s*"CATALOGO"/, 'id', kvId); texto = r.texto; mudou ||= r.mudou; }
  if (d1Id) { const r = definirCampo(texto, /"binding"\s*:\s*"DB"/, 'database_id', d1Id); texto = r.texto; mudou ||= r.mudou; }
  if (nomeDoProjeto) {
    const topo = trocarString(texto, /^\s*"name"\s*:\s*"([^"]*)"/m, nomeDoProjeto);
    texto = topo.texto; mudou ||= topo.mudou;
    const banco = trocarString(texto, /"binding"\s*:\s*"DB"\s*,\s*"database_name"\s*:\s*"([^"]*)"/, nomeDoProjeto);
    texto = banco.texto; mudou ||= banco.mudou;
  }
  if (mudou && !dryRun) await writeFile(caminhoWrangler(raiz), texto, 'utf8');
  return { mudou };
}

export const slugDoProjeto = (nome) => {
  const s = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s.length >= 3 ? s : 'minha-tela';
};

/* O que o setup precisa saber da conta antes de criar qualquer coisa. Lança pendência (saída 3) se faltar login
 * ou escolha de conta. Devolve { quem, env } onde env leva CLOUDFLARE_ACCOUNT_ID se foi escolhida. */
export async function exigirLogin(ctx, wr, { contaId } = {}) {
  const quem = await wr.quemSou();
  if (!quem.logado) {
    throw pendente('cloudflare-sem-login', 'a pessoa ainda não entrou na Cloudflare neste computador.', {
      comando: 'npx wrangler login',
      dica: 'Agente: peça que a pessoa abra um SEGUNDO terminal na pasta do projeto (COMECE-AQUI.md, "Como abrir um terminal"), rode o comando acima, crie a conta se não tiver (confirme o e-mail e ligue a verificação em duas etapas) e clique "Permitir" no navegador. Se o navegador não abrir, o terminal mostra um endereço longo: ela copia e cola no navegador deste mesmo computador. Se o computador for remoto (SSH, nuvem) o login não completa: use o Caminho B do COMECE-AQUI.md ou peça ajuda a quem indicou o produto. Depois rode este comando de novo.'
    });
  }
  const escolhida = contaId || ctx.env.CLOUDFLARE_ACCOUNT_ID;
  if (quem.contas.length > 1 && !escolhida) {
    throw pendente('cloudflare-varias-contas', 'o login tem mais de uma conta Cloudflare; a pessoa precisa dizer qual usar.', {
      quem: 'agente',
      comando: 'node scripts/setup.mjs cloudflare --conta <ID>', dados: { contas: quem.contas }
    });
  }
  if (escolhida) ctx.env.CLOUDFLARE_ACCOUNT_ID = escolhida;
  return quem;
}
