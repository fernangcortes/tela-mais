/* scripts/lib/setup/doctor.mjs — as checagens do `doctor`, em grupos: env, config, cloudflare, video, acesso, admin,
 * ia (opcional), seguranca e remoto (só com --remote). Cada checagem vira { id, grupo, status, mensagem, correcao }:
 *   ok     está certo
 *   aviso  funciona, mas você deveria saber (não impede de publicar)
 *   erro   precisa ser corrigido (o doctor sai com 1; o deploy não segue)
 *   pulado não deu para checar (depende de algo que faltou antes)
 * Nada aqui imprime valor de segredo; o wrangler só devolve NOMES de segredos. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatarErros } from '../../../core/worker/_lib/config-validar.mjs';
import { conteudoDoHeaders } from '../../gerar-headers.mjs';
import { criarProvedor, moduloDe } from '../provedores/index.mjs';
import { credenciaisNecessarias } from './credenciais.mjs';
import { criarEstado, URL_DO_ULTIMO_DEPLOY } from './estado.mjs';
import { arquivosParaVarrer, varrerArquivos } from './scan.mjs';
import { valoresSecretosLocais, garantirGitignore } from './segredos.mjs';
import { configDeTranscricao, VARIAVEL_PADRAO } from '../../../core/worker/_lib/ia/config.js';
import { configDoExecutor, VARIAVEL_DO_TOKEN } from '../../../core/worker/_lib/ia/executor.js';
import { lerSkills, lerNotas, gerarEspelhos, compararEspelhos, gravarEspelhos } from './agentes.mjs';

export const GRUPOS = Object.freeze(['env', 'config', 'cloudflare', 'video', 'acesso', 'admin', 'ia', 'seguranca', 'remoto']);

/* Credenciais que ligam a assinatura de vídeo (cada lista interna = qualquer uma serve). */
const SINAIS_DE_ASSINATURA = Object.freeze({
  bunny: [['BUNNY_TOKEN_KEY'], ['BUNNY_PULLZONE']],
  'cloudflare-stream': [['CLOUDFLARE_STREAM_KEY_ID'], ['CLOUDFLARE_STREAM_KEY_JWK', 'CLOUDFLARE_STREAM_KEY_PEM']]
});

export const DEFINICOES_DO_MODO = Object.freeze({
  publico: 'qualquer pessoa com o endereço vê o catálogo e assiste (sem conta).',
  cadastro: 'qualquer pessoa pode criar uma conta (com proteção anti-robô) e assistir.',
  privado: 'só quem foi convidado entra, e o vídeo só abre com endereço assinado e temporário.'
});

/* O que cada modo significa NA PRÁTICA (quem entra, como, o que a dona do site faz). */
export const COMO_FUNCIONA_O_MODO = Object.freeze({
  publico: 'Não há login: qualquer pessoa com o endereço vê tudo. Bom para conteúdo aberto (igreja, festival, prefeitura).',
  cadastro: 'A pessoa cria a conta sozinha no site. Exige o Turnstile (proteção anti-robô gratuita da Cloudflare) configurado ANTES de publicar, senão o cadastro fica fechado; ver docs/modos-de-acesso.md. Pode exigir aprovação sua (aprovacaoManual).',
  privado: 'Ninguém cria conta sozinho. Você, no /admin (tela Acesso), digita o e-mail de cada aluno ou convidado e copia o link de convite (vale 7 dias, uso único) para mandar por WhatsApp ou e-mail. Quem já foi convidado pede novo link de acesso pelo e-mail.'
});
export const AVISO_GRAVAR_TELA = 'Aviso honesto: nenhum modo impede alguém de gravar a tela do vídeo; o acesso só dificulta o caminho mais fácil (compartilhar o link).';

function limitar(lista, n = 5) { return lista.slice(0, n).join('; ') + (lista.length > n ? `; e mais ${lista.length - n}` : ''); }

export async function resolverUrl(ctx, estado, { url } = {}) {
  const candidatos = [url, ctx.env.APP_SITE_URL];
  try { candidatos.push(JSON.parse(await readFile(URL_DO_ULTIMO_DEPLOY(ctx.raiz), 'utf8')).url); } catch { /* sem deploy registrado */ }
  const cfg = await estado.config();
  if (cfg.ok && cfg.config.marca?.dominio) candidatos.push(cfg.config.marca.dominio);
  for (const c of candidatos) {
    if (typeof c !== 'string' || !c) continue;
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

export async function executarDoctor(ctx, rel, { only = null, remote = false, url, hls = [], videoId } = {}) {
  const estado = criarEstado(ctx);
  const grupos = (only && only.length ? only : GRUPOS.filter((g) => g !== 'remoto')).slice();
  if (remote && !grupos.includes('remoto')) grupos.push('remoto');
  for (const g of grupos) if (!GRUPOS.includes(g)) throw Object.assign(new Error(`grupo desconhecido: ${g}`), { grupoInvalido: true });
  const c = (id, grupo, status, mensagem, correcao = null) => rel.checagem(id, grupo, status, mensagem, correcao);
  const fix = ctx.flags.fix === true && !ctx.flags.dryRun;
  const cfgResultado = await estado.config();
  const config = cfgResultado.ok ? cfgResultado.config : null;
  const modo = config ? config.acesso.modo : 'privado';

  /* ------------------------------------------------------------------ env */
  if (grupos.includes('env')) {
    const [maior] = String(ctx.node || process.versions.node).split('.').map(Number);
    if (maior >= 22) c('env.node', 'env', 'ok', `Node ${ctx.node || process.versions.node}.`);
    else if (maior >= 20) c('env.node', 'env', 'aviso', `Node ${ctx.node || process.versions.node}: funciona, mas o projeto é testado no Node 22 ou mais novo.`, 'Instale o Node 22 em nodejs.org.');
    else c('env.node', 'env', 'erro', `Node ${ctx.node || process.versions.node} é velho demais (precisa de 20 ou mais).`, 'Instale o Node 22 em nodejs.org e abra um terminal novo.');
    const git = await ctx.exec('git', ['--version'], { cwd: ctx.raiz });
    if (git.codigo === 0) c('env.git', 'env', 'ok', 'git instalado.');
    else c('env.git', 'env', 'aviso', 'git não encontrado: sem ele não dá para versionar nem usar a trava de segredos no commit.', 'Instale o git em git-scm.com.');
    const versao = await estado.wr.versao();
    if (versao) c('env.wrangler', 'env', 'ok', `wrangler ${versao} acessível (o programa da Cloudflare; o setup o baixa sozinho pelo npx na primeira vez, por isso precisa de internet).`);
    else c('env.wrangler', 'env', 'erro', 'não consegui rodar o wrangler (a ferramenta da Cloudflare, baixada pelo npx).', 'Confirme que o Node está instalado e que há internet (ou que o proxy da rede deixa o npm baixar pacotes); depois rode: npx --yes wrangler@4 --version');
    const w = await estado.wrangler();
    if (w.existe) c('env.wrangler-jsonc', 'env', 'ok', 'wrangler.jsonc encontrado.');
    else c('env.wrangler-jsonc', 'env', 'erro', 'falta o wrangler.jsonc na raiz do projeto.', 'Restaure o arquivo com git (git checkout wrangler.jsonc).');
  }

  /* ------------------------------------------------------------------ config */
  if (grupos.includes('config')) {
    if (!cfgResultado.ok) {
      c('config.valida', 'config', 'erro', 'config/site.json tem problemas: ' + formatarErros(cfgResultado.erros).replace(/\n\s*/g, ' '), 'Corrija o arquivo (o site abre no modo mais fechado, "privado", enquanto isso). Rode: node scripts/validar-config.mjs');
    } else {
      c('config.valida', 'config', 'ok', 'config/site.json é válido.');
      const ap = await ctx.aplicarConfig({ raiz: ctx.raiz, verificar: true });
      if (ap.ok && !ap.alterados.length) c('config.aplicada', 'config', 'ok', 'os arquivos gerados do site estão em dia.');
      else {
        if (fix) { await ctx.aplicarConfig({ raiz: ctx.raiz, verificar: false }); c('config.aplicada', 'config', 'ok', 'os arquivos gerados estavam desatualizados e foram atualizados (--fix).'); }
        else c('config.aplicada', 'config', 'erro', 'os arquivos gerados do site estão desatualizados: ' + limitar(ap.alterados || []), 'Rode: node scripts/aplicar-config.mjs (ou doctor --fix)');
      }
      if (config.marca.nome === 'Plataforma Exemplo') c('config.marca', 'config', 'aviso', 'o site ainda usa o nome de exemplo "Plataforma Exemplo".', 'Defina o seu: node scripts/setup.mjs marca --nome "Seu nome"');
      else c('config.marca', 'config', 'ok', `marca: ${config.marca.nome}.`);
    }
    const esperado = conteudoDoHeaders();
    const arquivoHeaders = path.join(ctx.raiz, 'core', 'site', '_headers');
    const atual = await readFile(arquivoHeaders, 'utf8').catch(() => null);
    if (atual === esperado) c('config.headers', 'config', 'ok', 'core/site/_headers confere com a política de segurança.');
    else if (fix) { await writeFile(arquivoHeaders, esperado, 'utf8'); c('config.headers', 'config', 'ok', 'core/site/_headers regenerado (--fix).'); }
    else c('config.headers', 'config', 'erro', 'core/site/_headers está diferente da política de segurança.', 'Rode: node scripts/gerar-headers.mjs (ou doctor --fix)');
  }

  /* ------------------------------------------------------------------ cloudflare */
  const quem = grupos.some((g) => ['cloudflare', 'video', 'admin', 'acesso'].includes(g)) ? await estado.quem() : null;
  if (grupos.includes('cloudflare')) {
    if (ctx.env.CLOUDFLARE_API_TOKEN) {
      c('cloudflare.token-global', 'cloudflare', 'aviso', 'a variável CLOUDFLARE_API_TOKEN está no ambiente: o wrangler vai usá-la no lugar do login pelo navegador, e um token amplo é risco.', 'Remova-a do ambiente (unset CLOUDFLARE_API_TOKEN) e entre com: npx wrangler login');
    } else c('cloudflare.token-global', 'cloudflare', 'ok', 'nenhum token global da Cloudflare no ambiente.');
    if (!quem.logado) {
      c('cloudflare.login', 'cloudflare', 'erro', 'você não está logado na Cloudflare neste computador.', 'Rode: npx wrangler login (abre o navegador; clique em "Permitir")');
      c('cloudflare.kv', 'cloudflare', 'pulado', 'armazenamento KV: preciso do login para conferir.');
      c('cloudflare.d1', 'cloudflare', 'pulado', 'banco D1: preciso do login para conferir.');
    } else {
      c('cloudflare.login', 'cloudflare', quem.viaToken ? 'aviso' : 'ok', `logado como ${quem.email || '(conta)'}${quem.viaToken ? ' (por token de API, não pelo navegador)' : ''}.`, quem.viaToken ? 'Prefira o login do navegador: npx wrangler login' : null);
      const w = await estado.wrangler();
      const { kv, d1 } = w.recursos;
      if (!kv) c('cloudflare.kv', 'cloudflare', 'erro', 'o wrangler.jsonc não declara o armazenamento CATALOGO (KV).', 'Restaure o wrangler.jsonc com git.');
      else if (!kv.id) c('cloudflare.kv', 'cloudflare', 'erro', 'o armazenamento KV do catálogo ainda não foi criado.', 'Rode: node scripts/setup.mjs cloudflare');
      else {
        try {
          const existentes = await estado.wr.listarKv();
          if (existentes.some((x) => x.id === kv.id)) c('cloudflare.kv', 'cloudflare', 'ok', 'armazenamento KV do catálogo existe na sua conta.');
          else c('cloudflare.kv', 'cloudflare', 'erro', 'o id do KV no wrangler.jsonc não existe nesta conta Cloudflare.', 'Rode: node scripts/setup.mjs cloudflare (cria e corrige o id)');
        } catch (e) { c('cloudflare.kv', 'cloudflare', 'aviso', 'não consegui listar os KV da conta: ' + e.message); }
      }
      if (!d1) c('cloudflare.d1', 'cloudflare', modo === 'publico' ? 'aviso' : 'erro', 'o wrangler.jsonc não declara o banco DB (D1).', 'Restaure o wrangler.jsonc com git.');
      else if (!d1.database_id) c('cloudflare.d1', 'cloudflare', modo === 'publico' ? 'aviso' : 'erro', modo === 'publico' ? 'o banco D1 não foi criado (só é necessário nos modos com conta).' : 'o banco D1 (contas de pessoas) ainda não foi criado.', 'Rode: node scripts/setup.mjs cloudflare');
      else {
        try {
          const existentes = await estado.wr.listarD1();
          if (existentes.some((x) => x.id === d1.database_id)) c('cloudflare.d1', 'cloudflare', 'ok', 'banco D1 existe na sua conta.');
          else c('cloudflare.d1', 'cloudflare', 'erro', 'o database_id do D1 no wrangler.jsonc não existe nesta conta Cloudflare.', 'Rode: node scripts/setup.mjs cloudflare');
        } catch (e) { c('cloudflare.d1', 'cloudflare', 'aviso', 'não consegui listar os bancos D1: ' + e.message); }
      }
    }
  }

  /* ------------------------------------------------------------------ video */
  let adaptador = null;
  if (grupos.includes('video')) {
    if (!config) c('video.config', 'video', 'pulado', 'sem config válida não dá para conferir o provedor de vídeo.');
    else {
      const env = await estado.envLocal();
      adaptador = criarProvedor(config, env, { fetch: ctx.fetch });
      const remotos = await estado.segredosRemotos();
      const nomesRemotos = new Set(remotos.nomes);
      const faltandoLocal = adaptador.faltando || [];
      const faltandoEmTodo = faltandoLocal.filter((n) => !nomesRemotos.has(n));
      /* a mesma lista do `video`: além das obrigatórias, as de assinatura quando o acesso é restrito */
      const extras = credenciaisNecessarias(moduloDe(config.video.provedor), config.video.provedor, modo).map(([, d]) => d.env).filter((n) => !faltandoLocal.includes(n) && !nomesRemotos.has(n) && !env[n]);
      if (faltandoEmTodo.length) {
        c('video.credenciais', 'video', 'erro', `provedor "${config.video.provedor}": faltam as credenciais ${faltandoEmTodo.join(', ')}${extras.length ? `; e, como o acesso é "${modo}", também ${extras.join(', ')} (protegem o vídeo)` : ''}.`, 'Rode: node scripts/setup.mjs video (ele mostra onde achar cada chave; as secretas são pedidas num campo escondido, e a pessoa mesma digita)');
        c('video.conexao', 'video', 'pulado', 'sem as credenciais não dá para testar a conexão com o provedor.');
      } else if (faltandoLocal.length) {
        c('video.credenciais', 'video', 'ok', `credenciais de ${config.video.provedor} estão na Cloudflare.`);
        c('video.conexao', 'video', 'aviso', 'os valores só estão na Cloudflare (não neste computador), então não testei a conexão com o provedor daqui.', 'Para testar daqui: node scripts/setup.mjs video --testar');
      } else {
        c('video.credenciais', 'video', 'ok', `credenciais de ${config.video.provedor} presentes neste computador.`);
        const t = await adaptador.validarCredenciais();
        if (t.ok) c('video.conexao', 'video', 'ok', `o provedor "${config.video.provedor}" aceitou as credenciais.`);
        else c('video.conexao', 'video', 'erro', `o provedor "${config.video.provedor}" não aceitou: ${t.mensagem || t.codigo || 'sem resposta'}`, 'Confira a chave certa (no Bunny é a chave da biblioteca de vídeo) e rode: node scripts/setup.mjs video');
      }
      if (modo !== 'publico' && config.acesso.privado?.assinarMidia !== false) {
        const sinais = SINAIS_DE_ASSINATURA[config.video.provedor];
        const tem = (n) => nomesRemotos.has(n) || Boolean(env[n]);
        const assina = adaptador.capacidades().assinatura === true || (sinais && sinais.every((alt) => alt.some(tem)));
        if (config.video.provedor === 'hls-generico') c('video.assinatura', 'video', 'erro', 'o provedor "hls-generico" não assina endereços: no modo restrito o vídeo ficaria aberto a quem tiver o link.', 'Use bunny ou cloudflare-stream.');
        else if (assina) c('video.assinatura', 'video', 'ok', 'a chave de assinatura do vídeo existe (endereços temporários no modo restrito).');
        else c('video.assinatura', 'video', 'erro', `modo "${modo}" exige vídeo com endereço assinado, mas faltam as chaves de assinatura de ${config.video.provedor}.`, 'Rode: node scripts/setup.mjs video (ele pede também a chave de assinatura)');
      } else if (modo === 'publico') c('video.assinatura', 'video', 'ok', 'modo público: o vídeo não precisa de assinatura.');
    }
  }

  /* ------------------------------------------------------------------ acesso */
  if (grupos.includes('acesso')) {
    if (!config) c('acesso.modo', 'acesso', 'pulado', 'sem config válida não dá para conferir o acesso (o Worker usa "privado", o mais fechado).');
    else {
      c('acesso.modo', 'acesso', modo === 'publico' ? 'aviso' : 'ok', `modo "${modo}": ${DEFINICOES_DO_MODO[modo]}`, modo === 'publico' ? 'Confirme que é isso mesmo; para restringir: node scripts/setup.mjs acesso --modo privado' : null);
      if (modo !== 'publico') {
        if (config.acesso.privado?.assinarMidia === false) c('acesso.assinatura', 'acesso', 'erro', 'acesso.privado.assinarMidia está desligado: o vídeo abre para quem tiver o endereço.', 'Mude para true em config/site.json.');
        else c('acesso.assinatura', 'acesso', 'ok', 'vídeo com endereço assinado ligado.');
        const w = await estado.wrangler();
        if (w.recursos.d1) c('acesso.d1', 'acesso', 'ok', 'banco D1 declarado (contas de pessoas).');
        else c('acesso.d1', 'acesso', 'erro', 'este modo guarda contas no D1, mas o wrangler.jsonc não declara o banco DB.', 'Restaure o wrangler.jsonc com git.');
      }
      if (modo === 'cadastro') {
        const remotos = await estado.segredosRemotos();
        const env = await estado.envLocal();
        const w = await estado.wrangler();
        if (remotos.nomes.includes('TURNSTILE_SECRET') || env.TURNSTILE_SECRET) c('acesso.turnstile', 'acesso', 'ok', 'TURNSTILE_SECRET presente.');
        else c('acesso.turnstile', 'acesso', 'aviso', 'sem TURNSTILE_SECRET o cadastro fica fechado (proteção anti-robô obrigatória).', 'Crie o Turnstile e guarde as chaves com: node scripts/setup.mjs turnstile (a secreta: node scripts/setup.mjs segredo TURNSTILE_SECRET)');
        if (!(w.dados.vars && w.dados.vars.TURNSTILE_SITE_KEY) && !env.TURNSTILE_SITE_KEY) c('acesso.turnstile-site', 'acesso', 'aviso', 'falta a variável pública TURNSTILE_SITE_KEY (em vars do wrangler.jsonc).', 'Rode: node scripts/setup.mjs turnstile  (grava a chave pública sozinho)');
        const met = config.acesso.cadastro?.metodo ?? 'link-magico';
        if (met === 'link-magico' && (config.acesso.email?.adaptador ?? 'nenhum') === 'nenhum') c('acesso.email', 'acesso', 'aviso', 'cadastro por link mágico precisa de e-mail, e o envio de e-mail está desligado: o cadastro fica fechado.', 'Use acesso.cadastro.metodo "email-e-senha" ou configure o Resend.');
      }
      if (config.seo?.indexavel && modo !== 'publico') c('acesso.seo', 'acesso', 'aviso', `seo.indexavel está ligado, mas o acesso é "${modo}": os buscadores continuarão bloqueados.`);
    }
  }

  /* ------------------------------------------------------------------ admin */
  if (grupos.includes('admin')) {
    const remotos = await estado.segredosRemotos();
    const env = await estado.envLocal();
    for (const [nome, rotulo] of [['ADMIN_PASSWORD', 'senha do administrador'], ['SESSION_SECRET', 'chave das sessões']]) {
      const id = 'admin.' + nome.toLowerCase().replace(/_/g, '-');
      if (remotos.nomes.includes(nome)) c(id, 'admin', 'ok', `${nome} (${rotulo}) está cadastrado no Worker.`);
      else if (!remotos.consultado) c(id, 'admin', 'aviso', `ainda não dá para conferir ${nome} na Cloudflare (falta entrar na conta).${nome === 'SESSION_SECRET' ? ' Esta o setup cria sozinho depois da primeira publicação.' : ''}`, 'A pessoa entra com: npx wrangler login');
      else if (!remotos.existeWorker) c(id, 'admin', 'aviso', `${nome} ainda não existe: o Worker ainda não foi publicado.`, `Depois do primeiro deploy: node scripts/setup.mjs segredo ${nome}${nome === 'SESSION_SECRET' ? ' --gerar' : ''}`);
      else c(id, 'admin', 'erro', `${nome} (${rotulo}) não está cadastrado no Worker.${nome === 'ADMIN_PASSWORD' ? ' Ninguém consegue entrar no /admin.' : ' As sessões não funcionam.'}`, `Rode: node scripts/setup.mjs segredo ${nome}${nome === 'SESSION_SECRET' ? ' --gerar' : ''}`);
    }
    if (env.ADMIN_PASSWORD && env.SESSION_SECRET && env.ADMIN_PASSWORD === env.SESSION_SECRET) c('admin.separados', 'admin', 'erro', 'SESSION_SECRET e ADMIN_PASSWORD são iguais neste computador; precisam ser diferentes.', 'Gere outra chave: node scripts/setup.mjs segredo SESSION_SECRET --gerar');
  }

  /* ------------------------------------------------------------------ ia (opcional: só avisa custo e o que falta) */
  if (grupos.includes('ia')) await checarIA(ctx, estado, c, { config, fix });

  /* ------------------------------------------------------------------ segurança */
  if (grupos.includes('seguranca')) {
    const { origem, arquivos } = await arquivosParaVarrer(ctx);
    const { achados, varridos } = await varrerArquivos(ctx.raiz, arquivos, {});
    if (achados.length) c('seguranca.segredos', 'seguranca', 'erro', `${achados.length} possível(is) segredo(s) em arquivos do projeto: ${limitar(achados.map((a) => `${a.arquivo}:${a.linha} (${a.tipo})`))}.`, 'Tire o valor do arquivo, troque a chave (ela já pode ter vazado) e guarde-a com: node scripts/setup.mjs segredo NOME');
    else c('seguranca.segredos', 'seguranca', 'ok', `nenhum segredo nos ${varridos} arquivos varridos${origem === 'git' ? '' : ' (sem git: varri a pasta)'}.`);

    const faltandoGit = await garantirGitignore(ctx.raiz, { dryRun: !fix });
    if (!faltandoGit.length) c('seguranca.gitignore', 'seguranca', 'ok', '.gitignore protege .env, .dev.vars e .wrangler.');
    else if (fix) c('seguranca.gitignore', 'seguranca', 'ok', `.gitignore completado (--fix): ${faltandoGit.join(', ')}.`);
    else c('seguranca.gitignore', 'seguranca', 'erro', `.gitignore não cobre: ${faltandoGit.join(', ')}.`, 'Rode: node scripts/setup.mjs doctor --fix');

    const rastreados = await ctx.exec('git', ['ls-files', '--', '.env', '.dev.vars', '.env.local', '.env.production'], { cwd: ctx.raiz });
    const lista = rastreados.codigo === 0 ? String(rastreados.saida).split(/\r?\n/).filter(Boolean) : [];
    if (lista.length) c('seguranca.env-versionado', 'seguranca', 'erro', `arquivo de segredos no git: ${lista.join(', ')}.`, 'Rode: git rm --cached ' + lista.join(' ') + ' e troque as chaves que estavam nele.');
    else c('seguranca.env-versionado', 'seguranca', 'ok', 'nenhum arquivo de segredos versionado.');

    const hook = await readFile(path.join(ctx.raiz, '.githooks', 'pre-commit'), 'utf8').catch(() => null);
    const cfgHooks = await ctx.exec('git', ['config', '--get', 'core.hooksPath'], { cwd: ctx.raiz });
    if (hook && hook.includes('scan-secrets') && String(cfgHooks.saida).trim() === '.githooks') c('seguranca.hook', 'seguranca', 'ok', 'trava de segredos no commit ligada (.githooks/pre-commit).');
    else c('seguranca.hook', 'seguranca', 'aviso', 'a trava de segredos no commit não está ligada.', 'Rode: node scripts/setup.mjs scan-secrets --instalar-hook');

    const skills = await lerSkills(ctx.raiz);
    const agentsMd = await readFile(path.join(ctx.raiz, 'AGENTS.md'), 'utf8').catch(() => null);
    if (agentsMd === null) c('seguranca.agentes', 'seguranca', 'aviso', 'AGENTS.md não encontrado.');
    else {
      const esperado = gerarEspelhos({ agentsMd, skills, notas: await lerNotas(ctx.raiz) });
      const itens = await compararEspelhos(ctx.raiz, esperado);
      const ruins = itens.filter((i) => i.estado !== 'ok');
      if (!ruins.length) c('seguranca.agentes', 'seguranca', 'ok', 'CLAUDE.md, GEMINI.md e .cursor/rules conferem com o AGENTS.md.');
      else if (fix) { await gravarEspelhos(ctx.raiz, esperado, itens); c('seguranca.agentes', 'seguranca', 'ok', 'arquivos dos agentes regenerados (--fix).'); }
      else c('seguranca.agentes', 'seguranca', 'aviso', `arquivos dos agentes fora de sincronia: ${limitar(ruins.map((i) => i.arquivo))}.`, 'Rode: node scripts/setup.mjs sync-agents');
    }
  }

  /* ------------------------------------------------------------------ remoto */
  if (grupos.includes('remoto')) await checarRemoto(ctx, estado, rel, { config, modo, url, hls, videoId, adaptador });
  return { modo, config };
}

/* ------------------------------------------------------------------ IA de conteúdo (M9) */

/* Nunca dá erro: a IA é opcional, paga e nasce desligada. Aqui só se AVISA o custo, o destino do conteúdo e o que falta
 * (chave, token, bucket). Nenhum valor de segredo é lido para a tela: só se uma variável existe (nome) ou não. */
async function checarIA(ctx, estado, c, { config }) {
  if (!config) { c('ia.config', 'ia', 'pulado', 'config/site.json inválida: não deu para olhar a IA.'); return; }
  const ia = config.ia || {};
  const ligadosNaConfig = Object.entries(ia.recursos || {}).filter(([, v]) => v === true).map(([k]) => k);
  const textos = ia.textos || {}; const fala = ia.transcricao || {};
  const comTexto = (textos.provedor || 'nenhum') !== 'nenhum';
  const comFala = (fala.provedor || 'nenhum') !== 'nenhum';
  const comExecutor = Boolean(ia.executor && ia.executor.github && ia.executor.github.ligado);
  const comMidia = Boolean(ia.midia && ia.midia.destino === 'r2');
  if (!comTexto && !comFala && !comExecutor && !comMidia && !ligadosNaConfig.length) {
    c('ia.desligada', 'ia', 'ok', 'a IA de conteúdo está desligada (o padrão): sem custo e nenhum conteúdo sai da sua conta. Para ligar: docs/ia.md.');
    return;
  }

  const orcamento = Number.isFinite(ia.orcamentoMensalUSD) ? ia.orcamentoMensalUSD : 5;
  const envLocal = await estado.envLocal();
  const remotos = comTexto || comFala || comExecutor ? await estado.segredosRemotos() : { nomes: [], consultado: false, existeWorker: false };
  const w = await estado.wrangler();
  /* só a PRESENÇA de cada variável: o valor vira "1" e nunca sai daqui */
  const presenca = {};
  for (const [k, v] of Object.entries(envLocal)) if (v) presenca[k] = '1';
  for (const n of remotos.nomes || []) presenca[n] = '1';

  const onde = (nome) => ((remotos.nomes || []).includes(nome) ? 'no Worker' : (envLocal[nome] ? 'só neste computador' : null));
  const faltaChave = (nome, rotulo, usos) => {
    const lugar = onde(nome);
    if (lugar === 'no Worker') return null;
    if (lugar) return `${rotulo}: a chave ${nome} está só neste computador. Os scripts e o GitHub a usam, mas o botão "Gerar agora" do /admin precisa dela também no Worker.`;
    return `${rotulo}: falta a chave ${nome}. ${usos}`;
  };
  const nomeDaChave = (bloco, padrao) => (bloco && bloco.chave && typeof bloco.chave === 'object' && bloco.chave.$env) || padrao;

  /* o custo e o destino do conteúdo, de uma vez só */
  const partes = [];
  if (comTexto) partes.push(`textos por ${textos.provedor}${textos.modelo && typeof textos.modelo === 'string' ? ' (' + textos.modelo + ')' : ''}`);
  if (comFala) partes.push(`transcrição por ${fala.provedor}`);
  const saiDaConta = (comTexto && textos.provedor !== 'workers-ai') || (comFala && !['workers-ai-whisper', 'provedor-de-video'].includes(fala.provedor));
  c('ia.custo', 'ia', 'aviso',
    `IA de conteúdo configurada${partes.length ? ': ' + partes.join('; ') : ''}. Cada geração é cobrada pelo provedor, dentro do teto de US$ ${orcamento}/mês (ia.orcamentoMensalUSD); um lote que não cabe é recusado antes de começar. ${saiDaConta ? 'O texto e a legenda dos títulos que você gerar VÃO para o provedor escolhido. ' : 'O conteúdo fica na sua conta Cloudflare (Workers AI). '}Tudo que a IA gera fica como sugestão: só vai ao ar quando uma pessoa aceita. Cada recurso nasce desligado e se liga na tela IA do /admin.`,
    'Estimativa de custo e privacidade: docs/ia.md');
  if (orcamento === 0) c('ia.orcamento', 'ia', 'aviso', 'o orçamento mensal de IA é US$ 0: todo lote será recusado.', 'Defina ia.orcamentoMensalUSD em config/site.json (ex.: 5).');

  if (comTexto) {
    if (textos.provedor === 'workers-ai') {
      const temBinding = Boolean(w && w.dados && w.dados.ai);
      if (temBinding) c('ia.texto-acesso', 'ia', 'ok', 'textos: o Workers AI está ligado ao Worker (binding "ai" no wrangler.jsonc).');
      else c('ia.texto-acesso', 'ia', 'aviso', 'textos: o Workers AI precisa do binding "ai" no wrangler.jsonc para funcionar no Worker (nos scripts basta CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN).', 'Descomente a linha "ai": { "binding": "AI" } em wrangler.jsonc e publique de novo.');
    } else {
      const nome = nomeDaChave(textos, VARIAVEL_PADRAO[textos.provedor]);
      const problema = faltaChave(nome, 'textos', `Guarde-a com: node scripts/setup.mjs segredo ${nome}`);
      if (!problema) c('ia.texto-chave', 'ia', 'ok', `textos: a chave ${nome} está guardada no Worker.`);
      else c('ia.texto-chave', 'ia', 'aviso', problema, `Guarde-a com: node scripts/setup.mjs segredo ${nome}`);
    }
  }
  if (comFala && fala.provedor !== 'provedor-de-video' && fala.provedor !== 'workers-ai-whisper') {
    const nome = nomeDaChave(fala, VARIAVEL_PADRAO[fala.provedor]);
    const problema = faltaChave(nome, 'transcrição', `Guarde-a com: node scripts/setup.mjs segredo ${nome}`);
    if (!problema) c('ia.fala-chave', 'ia', 'ok', `transcrição: a chave ${nome} está guardada no Worker.`);
    else c('ia.fala-chave', 'ia', 'aviso', problema, `Guarde-a com: node scripts/setup.mjs segredo ${nome}`);
  }
  if (comFala && fala.provedor === 'workers-ai-whisper') {
    const ok = configDeTranscricao(config, presenca);
    if (ok.pronto || (w && w.dados && w.dados.ai)) c('ia.fala-acesso', 'ia', 'ok', 'transcrição: o Whisper do Workers AI tem como ser chamado.');
    else c('ia.fala-acesso', 'ia', 'aviso', 'transcrição: fora do Worker (scripts e GitHub) o Whisper do Workers AI precisa de CLOUDFLARE_API_TOKEN (permissão Workers AI) e CLOUDFLARE_ACCOUNT_ID. Não deixe o token no .env: ele atrapalha o "wrangler login".', 'Cadastre os dois como segredos do GitHub (Settings, Secrets and variables, Actions) e rode a transcrição pelo fluxo gerar-midia, ou use o binding "ai" no wrangler.jsonc.');
  }

  if (comExecutor) {
    const g = configDoExecutor(config, presenca);
    const fluxo = await readFile(path.join(ctx.raiz, '.github', 'workflows', g.fluxo), 'utf8').catch(() => null);
    if (!g.repositorio) c('ia.github', 'ia', 'aviso', 'o botão "Gerar no GitHub" está ligado, mas falta ia.executor.github.repositorio (dono/repositório).', 'Preencha em config/site.json.');
    else if (fluxo === null) c('ia.github', 'ia', 'aviso', `o botão "Gerar no GitHub" está ligado, mas o fluxo .github/workflows/${g.fluxo} não existe neste projeto.`, 'Restaure o arquivo com git (git checkout .github/workflows/gerar-midia.yml).');
    else if (!(remotos.nomes || []).includes(g.nomeDoToken)) c('ia.github', 'ia', 'aviso', `o botão "Gerar no GitHub" está ligado, mas o segredo ${g.nomeDoToken} não está no Worker. Use um token fino do GitHub só deste repositório, com a permissão "Actions: Read and write" e mais nenhuma.`, `Rode: node scripts/setup.mjs segredo ${g.nomeDoToken || VARIAVEL_DO_TOKEN}`);
    else c('ia.github', 'ia', 'ok', `o botão "Gerar no GitHub" está pronto (${g.repositorio}). Lembre: no GitHub, a variável IA_EXECUTOR_LIGADO = true e os segredos do provedor precisam existir (docs/ia.md).`);
  }

  if (comMidia) {
    const m = ia.midia || {};
    if (!m.bucket || !m.urlBase) c('ia.midia', 'ia', 'aviso', 'o destino do trailer e do clipe é o R2, mas faltam ia.midia.bucket e/ou ia.midia.urlBase (endereço https público do bucket).', 'Crie o bucket no painel da Cloudflare (R2), ligue o acesso público e preencha os dois campos. O endereço entra sozinho na política de segurança do site.');
    else c('ia.midia', 'ia', 'ok', `trailer e clipe vão para o R2 (${m.bucket}); R2 tem 10 GB grátis e não cobra a entrega.`);
  }

  if (comMidia || comExecutor || ligadosNaConfig.includes('trailer')) {
    const ff = await ctx.exec('ffmpeg', ['-version'], { cwd: ctx.raiz });
    if (ff.codigo === 0) c('ia.ffmpeg', 'ia', 'ok', 'ffmpeg instalado (corta trailer, clipe e capas; é grátis).');
    else c('ia.ffmpeg', 'ia', 'aviso', 'ffmpeg não encontrado neste computador. Só é preciso aqui se você for gerar capas, trailer ou clipe localmente; o GitHub instala o dele sozinho.', 'Instale em ffmpeg.org (ou: sudo apt install ffmpeg / brew install ffmpeg).');
  }
}

/* ------------------------------------------------------------------ site publicado */

async function buscar(ctx, url, { metodo = 'GET', limiteBytes = 4096 } = {}) {
  try {
    const r = await ctx.fetch(url, { method: metodo, redirect: 'manual', headers: { 'user-agent': 'tela-mais-doctor', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    let corpo = '';
    try { corpo = (await r.text()).slice(0, limiteBytes * 64); } catch { /* corpo ilegível */ }
    return { status: r.status, cabecalho: (n) => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(n) : null), corpo };
  } catch (e) { return { erro: String(e && e.message || e), status: 0, cabecalho: () => null, corpo: '' }; }
}

const FECHADO = (s) => s === 401 || s === 403 || (s >= 300 && s < 400);

async function checarRemoto(ctx, estado, rel, { config, modo, url, hls, videoId, adaptador }) {
  const c = (id, status, mensagem, correcao = null) => rel.checagem(id, 'remoto', status, mensagem, correcao);
  const base = await resolverUrl(ctx, estado, { url });
  if (!base) { c('remoto.url', 'erro', 'não tenho o endereço de um site publicado para testar (normal se ainda não publicou: esta checagem é só para DEPOIS do deploy).', 'Publique antes com: node scripts/setup.mjs deploy; ou, se já publicou, passe: --url https://seu-site.exemplo.com'); return; }
  rel.dado('url', base);
  const restrito = modo !== 'publico';

  const home = await buscar(ctx, base + '/');
  if (home.status === 200) c('remoto.home', 'ok', 'a página inicial responde (200).');
  else c('remoto.home', 'erro', home.erro ? `não consegui abrir ${base}: ${home.erro}` : `a página inicial respondeu ${home.status}.`, 'Confira o endereço e se o deploy terminou: node scripts/setup.mjs deploy');
  if (home.status === 200) {
    const csp = home.cabecalho('content-security-policy');
    const nosniff = home.cabecalho('x-content-type-options');
    if (csp && /nosniff/i.test(nosniff || '')) c('remoto.cabecalhos', 'ok', 'cabeçalhos de segurança presentes (CSP e nosniff).');
    else c('remoto.cabecalhos', 'aviso', 'faltam cabeçalhos de segurança na página inicial (política de conteúdo ou nosniff).', 'Rode: node scripts/gerar-headers.mjs e publique de novo.');
  }

  const vazados = [];
  for (const caminho of ['/.env', '/wrangler.jsonc', '/config/site.json', '/.dev.vars']) {
    const r = await buscar(ctx, base + caminho);
    if (r.status === 200) vazados.push(caminho);
  }
  if (vazados.length) c('remoto.arquivos-internos', 'erro', `arquivos internos abertos na internet: ${vazados.join(', ')}.`, 'Confirme que o site publica só a pasta core/site (assets.directory no wrangler.jsonc) e troque as chaves expostas.');
  else c('remoto.arquivos-internos', 'ok', 'arquivos internos (.env, wrangler.jsonc, config) não são servidos.');

  const cat = await buscar(ctx, base + '/api/catalogo', { limiteBytes: 1 << 20 });
  let candidatos = [...hls];
  if (restrito) {
    if (FECHADO(cat.status)) c('remoto.catalogo', 'ok', `modo "${modo}": o catálogo NÃO abre sem entrar (${cat.status}).`);
    else if (cat.status === 200) c('remoto.catalogo', 'erro', `modo "${modo}": o catálogo ABRE para qualquer pessoa sem login. O acesso restrito não está funcionando.`, 'Não divulgue o endereço. Rode node scripts/setup.mjs doctor, publique de novo com node scripts/setup.mjs deploy e repita este teste.');
    else c('remoto.catalogo', 'erro', cat.erro ? `não consegui consultar o catálogo: ${cat.erro}` : `o catálogo respondeu ${cat.status}; não consegui confirmar que está fechado.`);
  } else if (cat.status === 200) c('remoto.catalogo', 'ok', 'modo público: o catálogo responde (200).');
  else c('remoto.catalogo', 'erro', cat.erro ? `não consegui consultar o catálogo: ${cat.erro}` : `o catálogo respondeu ${cat.status}.`, 'Confira se o catálogo foi importado e se o Worker está no ar.');

  if (cat.status === 200) {
    try {
      const j = JSON.parse(cat.corpo);
      for (const it of (j.itens || []).slice(0, 3)) {
        const h = it && it.midia && it.midia.hls;
        if (typeof h === 'string') candidatos.push(h);
      }
    } catch { /* corpo não é JSON: o teste do catálogo já tratou */ }
  }
  if (videoId && adaptador) {
    try { const rep = await adaptador.urlReproducao(videoId, { assinar: false }); if (rep && rep.hls) candidatos.push(rep.hls); } catch { /* sem URL montável */ }
  }
  candidatos = [...new Set(candidatos)];
  if (!candidatos.length) {
    if (restrito) c('remoto.hls', 'aviso', 'não consegui testar o vídeo (HLS) de fora: não há endereço de vídeo para tentar.', 'Passe um vídeo seu: doctor --remote --video-id <id do vídeo no provedor> (ou --hls <endereço .m3u8 sem assinatura>)');
    else c('remoto.hls', 'pulado', 'modo público: sem vídeo para testar.');
  }
  const abertos = [];
  for (const h of candidatos) {
    const r = await buscar(ctx, h);
    if (r.status >= 200 && r.status < 300) abertos.push(h);
  }
  if (candidatos.length) {
    const mostrar = (h) => { try { const u = new URL(h); return u.origin + u.pathname; } catch { return '(endereço)'; } };
    if (restrito && abertos.length) c('remoto.hls', 'erro', `modo "${modo}": o vídeo ABRE sem login e sem assinatura (${abertos.map(mostrar).join(', ')}).`, 'Ligue a autenticação por token do provedor (no Bunny: Token Authentication da pull zone) e cadastre a chave: node scripts/setup.mjs video');
    else if (restrito) c('remoto.hls', 'ok', `o vídeo sem assinatura NÃO abre (${candidatos.length} endereço(s) testado(s)).`);
    else c('remoto.hls', 'ok', 'modo público: o vídeo abre, como esperado.');
  }

  const robots = await buscar(ctx, base + '/robots.txt');
  if (restrito) {
    if (robots.status === 200 && /Disallow:\s*\/\s*$/m.test(robots.corpo)) c('remoto.robots', 'ok', 'robots.txt bloqueia os buscadores.');
    else c('remoto.robots', 'aviso', 'robots.txt não bloqueia os buscadores num site restrito.', 'Rode: node scripts/aplicar-config.mjs e publique de novo.');
  }
}
