/* scripts/lib/setup/golive.mjs — o checklist de go-live (docs/contas-e-chaves.md, seção 5) como CÓDIGO.
 *
 * Cada item vira { id, secao, titulo, estado, detalhe, comando } com estado:
 *   ok      a verificação rodou e passou
 *   falha   a verificação rodou e reprovou (o detalhe diz como corrigir)
 *   manual  só uma pessoa confirma (2FA, cartão, direito de exibir...) ou depende de algo que não deu para ler daqui;
 *           o `comando` diz onde olhar ou como conferir
 * `confirmados` (--confirmado id1,id2) vira "ok (confirmado pela pessoa)" nos itens manuais.
 * Nada aqui imprime valor de segredo: só nomes e situações. */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { criarRelatorio } from './saida.mjs';
import { criarEstado } from './estado.mjs';
import { executarDoctor, resolverUrl } from './doctor.mjs';

export const SECOES = Object.freeze({
  A: 'Contas e acesso',
  B: 'Segredos e configuração',
  C: 'Modo de acesso',
  D: 'Conteúdo e custos',
  E: 'Operação',
  F: 'Legal'
});

const HORAS_DE_BACKUP_VELHO = 48;
const TENTATIVAS_DO_LIMITE = 12;

const item = (id, secao, titulo, estado, detalhe, comando = null) => ({ id, secao, titulo, estado, detalhe, comando });
const manual = (id, secao, titulo, detalhe, comando) => item(id, secao, titulo, 'manual', detalhe, comando);

/* Resume uma lista de checagens do doctor num estado só: erro (e, se `estrito`, aviso) reprova. */
function doDoctor(checagens, ids, { estrito = false } = {}) {
  const alvo = checagens.filter((c) => ids.some((i) => (i.endsWith('.') ? c.id.startsWith(i) : c.id === i)));
  if (!alvo.length) return { estado: 'manual', detalhe: 'o diagnóstico não retornou esta checagem.' };
  const ruins = alvo.filter((c) => c.status === 'erro' || (estrito && c.status === 'aviso'));
  if (ruins.length) return { estado: 'falha', detalhe: ruins.map((c) => c.mensagem + (c.correcao ? ` Como corrigir: ${c.correcao}` : '')).join(' | ') };
  const incertos = alvo.filter((c) => c.status === 'aviso' || c.status === 'pulado');
  if (incertos.length) return { estado: 'manual', detalhe: incertos.map((c) => c.mensagem + (c.correcao ? ` Para conferir: ${c.correcao}` : '')).join(' | ') };
  return { estado: 'ok', detalhe: alvo.map((c) => c.mensagem).join(' ') };
}

async function existe(raiz, rel) { try { await access(path.join(raiz, rel)); return true; } catch { return false; } }

/* Última execução de um workflow, pelo `gh`. null = não deu para consultar (gh ausente, sem login, sem repositório). */
async function ultimaExecucao(ctx, arquivo) {
  const r = await ctx.exec('gh', ['run', 'list', '--workflow', arquivo, '--limit', '1', '--json', 'conclusion,status,createdAt'], { cwd: ctx.raiz });
  if (r.codigo !== 0) return null;
  try { const lista = JSON.parse(r.saida); return { execucoes: Array.isArray(lista) ? lista : [] }; } catch { return null; }
}

function itemDeWorkflow(ctx, { id, secao, titulo, arquivo, existeArquivo, comando, maxHoras = null, aviso }) {
  return (async () => {
    if (!existeArquivo) return item(id, secao, titulo, 'falha', `falta .github/workflows/${arquivo}.`, 'Restaure o arquivo com git (git checkout .github/workflows).');
    const u = await ultimaExecucao(ctx, arquivo);
    if (!u) return manual(id, secao, titulo, `o arquivo ${arquivo} existe, mas não consegui consultar o GitHub daqui (falta o programa "gh" ou entrar com: gh auth login). ${aviso}`, comando);
    const ultima = u.execucoes[0];
    if (!ultima) return item(id, secao, titulo, 'falha', `o fluxo ${arquivo} nunca rodou. ${aviso}`, comando);
    if (ultima.status !== 'completed') return manual(id, secao, titulo, `a última execução de ${arquivo} ainda está em andamento.`, comando);
    if (ultima.conclusion !== 'success') return item(id, secao, titulo, 'falha', `a última execução de ${arquivo} terminou com "${ultima.conclusion}".`, comando);
    if (maxHoras !== null) {
      const horas = (ctx.agora().getTime() - new Date(ultima.createdAt).getTime()) / 36e5;
      if (!(horas <= maxHoras)) return item(id, secao, titulo, 'falha', `a última execução de ${arquivo} foi há ${Math.round(horas)} h (o limite é ${maxHoras} h).`, comando);
    }
    return item(id, secao, titulo, 'ok', `a última execução de ${arquivo} deu certo (${ultima.createdAt}).`, comando);
  })();
}

async function testarLimiteDeLogin(ctx, base) {
  const pedidos = Array.from({ length: TENTATIVAS_DO_LIMITE }, () => ctx.fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'tela-mais-golive' },
    body: JSON.stringify({ usuario: 'go-live-teste', senha: 'senha-errada-do-teste-de-limite' }), signal: AbortSignal.timeout(20000)
  }).then((r) => r.status).catch(() => 0));
  const status = await Promise.all(pedidos);
  return { recusou: status.includes(429), status };
}

export async function executarGoLive(ctx, { url, hls = [], videoId, confirmados = [], pularLimite = false } = {}) {
  const estado = criarEstado(ctx);
  const sub = criarRelatorio('doctor', { json: true, out: () => {}, err: () => {} });
  await executarDoctor(ctx, sub, { only: ['config', 'video', 'acesso', 'admin', 'seguranca', 'remoto'], remote: true, url, hls, videoId });
  const ck = sub.checagens;
  const cfg = await estado.config();
  const config = cfg.ok ? cfg.config : null;
  const modo = config ? config.acesso.modo : 'privado';
  const base = await resolverUrl(ctx, estado, { url });
  const itens = [];
  const A = 'A', B = 'B', C = 'C', D = 'D', E = 'E', F = 'F';

  /* ---- A. contas e acesso */
  itens.push(manual('2fa-cloudflare', A, '2FA ligado na Cloudflare', 'só a pessoa vê isto no painel: "Autenticação de dois fatores" deve estar ativada.', 'abrir https://dash.cloudflare.com/profile/authentication'));
  itens.push(manual('2fa-github', A, '2FA ligado no GitHub', 'só a pessoa vê isto na conta dela.', 'abrir https://github.com/settings/security'));
  itens.push(manual('2fa-video', A, '2FA ligado no serviço de vídeo', 'só a pessoa vê isto na conta do provedor (Bunny: Account Settings; Cloudflare: o mesmo da Cloudflare).', 'abrir o painel do provedor, em Segurança'));
  {
    const r = await ctx.exec('gh', ['repo', 'view', '--json', 'isPrivate'], { cwd: ctx.raiz });
    let priv = null;
    if (r.codigo === 0) { try { priv = JSON.parse(r.saida).isPrivate; } catch { /* saída estranha */ } }
    if (priv === true) itens.push(item('repo-privado', A, 'Repositório do site é privado', 'ok', 'o gh confirma que o repositório é privado.', 'gh repo view --json isPrivate'));
    else if (priv === false) itens.push(item('repo-privado', A, 'Repositório do site é privado', 'falha', 'o repositório é PÚBLICO.', 'gh repo edit --visibility private --accept-visibility-change-consequences'));
    else itens.push(manual('repo-privado', A, 'Repositório do site é privado', 'não consegui consultar o GitHub daqui.', 'gh repo view --json isPrivate (ou abrir o repositório e olhar o selo "Private")'));
  }

  /* ---- B. segredos e configuração */
  { const r = doDoctor(ck, ['config.valida', 'config.aplicada', 'config.headers']); itens.push(item('config-valida', B, 'Configuração válida e arquivos gerados em dia', r.estado, r.detalhe, 'npm run config:validar && npm run config:aplicar')); }
  { const r = doDoctor(ck, ['admin.admin-password', 'admin.session-secret', 'admin.separados', 'video.credenciais', 'video.assinatura']); itens.push(item('segredos-presentes', B, 'Segredos presentes no Worker (só os nomes)', r.estado, r.detalhe, 'node scripts/setup.mjs doctor --only admin,video')); }
  { const r = doDoctor(ck, ['seguranca.segredos', 'seguranca.env-versionado', 'seguranca.gitignore']); itens.push(item('sem-segredo-no-git', B, 'Nenhum segredo nos arquivos; .env fora do git', r.estado, r.detalhe, 'node scripts/setup.mjs scan-secrets')); }
  itens.push(manual('senhas-guardadas', B, 'Senha de admin e e-mail de recuperação no gerenciador de senhas', 'só a pessoa sabe onde guardou.', 'perguntar à pessoa; nunca pedir a senha'));

  /* ---- C. modo de acesso */
  { const r = doDoctor(ck, ['remoto.url', 'remoto.home', 'remoto.catalogo', 'remoto.hls', 'remoto.arquivos-internos'], { estrito: false });
    itens.push(item('modo-testado-de-fora', C, `Modo "${modo}" testado de fora (catálogo e vídeo sem entrar falham com 401/403)`, r.estado, r.detalhe, 'node scripts/setup.mjs doctor --remote --video-id ID_DO_VIDEO')); }
  if (modo === 'cadastro') { const r = doDoctor(ck, ['acesso.turnstile', 'acesso.turnstile-site'], { estrito: true }); itens.push(item('turnstile', C, 'Turnstile ligado (obrigatório no cadastro)', r.estado, r.detalhe, 'node scripts/setup.mjs turnstile')); }
  else itens.push(item('turnstile', C, 'Turnstile ligado (obrigatório no cadastro)', 'ok', `não se aplica ao modo "${modo}".`, 'node scripts/setup.mjs doctor --only acesso'));
  if (!base) itens.push(item('limite-de-login', C, 'Limite de tentativas de login (a 11ª em 10 s é recusada)', 'falha', 'sem endereço de site publicado para testar.', 'node scripts/setup.mjs deploy, ou passe --url https://seu-site'));
  else if (pularLimite) itens.push(manual('limite-de-login', C, 'Limite de tentativas de login (a 11ª em 10 s é recusada)', 'o teste automático foi pulado (--pular-limite).', 'node scripts/setup.mjs go-live (sem --pular-limite)'));
  else {
    const t = await testarLimiteDeLogin(ctx, base);
    if (t.recusou) itens.push(item('limite-de-login', C, 'Limite de tentativas de login (a 11ª em 10 s é recusada)', 'ok', `${TENTATIVAS_DO_LIMITE} tentativas seguidas com senha errada: o Worker passou a recusar com 429.`, 'node scripts/setup.mjs go-live'));
    else if (t.status.every((s) => s === 0)) itens.push(item('limite-de-login', C, 'Limite de tentativas de login (a 11ª em 10 s é recusada)', 'falha', 'não consegui falar com o site para testar.', 'node scripts/setup.mjs go-live'));
    else itens.push(item('limite-de-login', C, 'Limite de tentativas de login (a 11ª em 10 s é recusada)', 'falha', `${TENTATIVAS_DO_LIMITE} tentativas erradas e nenhuma foi recusada (respostas: ${[...new Set(t.status)].join(', ')}). Sem o banco D1 ou o binding LIMITE_ENTRADA não há limite.`, 'node scripts/setup.mjs cloudflare (cria o D1) e node scripts/setup.mjs deploy'));
  }
  itens.push(manual('referrers-do-provedor', C, 'Provedor de vídeo: só o seu domínio como origem permitida; autenticação por token ligada', 'depende do painel do provedor (o doctor --remote cobre só "o vídeo sem assinatura não abre").', 'Bunny: pull zone > Security > Allowed Referrers e Token Authentication'));

  /* ---- D. conteúdo e custos */
  itens.push(manual('video-de-teste', D, 'Um vídeo de teste processado e tocando no celular e no computador', 'tocar de verdade só uma pessoa confirma.', 'abrir o site no celular e no computador (entrando, se o modo for restrito) e dar play; o /admin mostra o estado do envio'));
  itens.push(manual('custo-aceito', D, 'Custo mensal estimado aceito pela pessoa', 'a decisão é dela.', 'abrir o /admin, tela Custos, ou docs/custos.md'));
  itens.push(manual('alertas-de-gasto', D, 'Limite de banda do Bunny e alerta de gasto da Cloudflare configurados', 'ficam nos painéis, fora do alcance daqui.', 'Cloudflare: Notificações > Adicionar > Billable Usage; Bunny: Billing > Usage Limits'));

  /* ---- E. operação */
  {
    const dominio = config && config.marca && config.marca.dominio;
    if (!dominio) itens.push(item('dominio-https', E, 'Domínio próprio com HTTPS e www redirecionando', 'falha', 'config.marca.dominio está vazio: o site ainda usa o endereço workers.dev.', 'painel da Cloudflare (Workers > Configurações > Domínios), depois ponha o domínio em marca.dominio de config/site.json e rode npm run config:aplicar'));
    else {
      const host = String(dominio).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const ir = async (u) => { try { const r = await ctx.fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'tela-mais-golive' } }); return r.status; } catch { return 0; } };
      const apex = await ir(`https://${host}/`);
      const www = host.startsWith('www.') ? apex : await ir(`https://www.${host}/`);
      const comando = `curl -sI https://${host}/ ; curl -sI https://www.${host}/`;
      if (apex !== 200) itens.push(item('dominio-https', E, 'Domínio próprio com HTTPS e www redirecionando', 'falha', `https://${host}/ respondeu ${apex || 'sem resposta'}, e o esperado é 200.`, comando));
      else if (!(www === 200 || (www >= 300 && www < 400))) itens.push(item('dominio-https', E, 'Domínio próprio com HTTPS e www redirecionando', 'falha', `https://www.${host}/ respondeu ${www || 'sem resposta'}: o www precisa redirecionar para o endereço principal.`, comando));
      else itens.push(item('dominio-https', E, 'Domínio próprio com HTTPS e www redirecionando', 'ok', `https://${host}/ responde 200 e o www responde ${www}.`, comando));
    }
  }
  const wf = async (nome) => existe(ctx.raiz, `.github/workflows/${nome}`);
  itens.push(await itemDeWorkflow(ctx, { id: 'deploy-automatico', secao: E, titulo: 'Deploy automático funcionando (testes verdes antes de publicar)', arquivo: 'deploy.yml', existeArquivo: await wf('deploy.yml'), comando: 'gh run list --workflow deploy.yml --limit 3', aviso: 'Para ligar: docs/atualizar.md, "Publicar automático".' }));
  itens.push(await itemDeWorkflow(ctx, { id: 'backup-recente', secao: E, titulo: `Backup rodado há menos de ${HORAS_DE_BACKUP_VELHO} h`, arquivo: 'backup.yml', existeArquivo: await wf('backup.yml'), maxHoras: HORAS_DE_BACKUP_VELHO, comando: 'gh run list --workflow backup.yml --limit 3  (ou: npm run backup)', aviso: 'O backup automático vem desligado: docs/atualizar.md, "Backup automático".' }));
  itens.push(manual('restauracao-testada', E, 'Backup restaurado num projeto de teste', 'só dá para provar restaurando de verdade.', 'node scripts/importar-kv.mjs backup.json   (sem --yes só mostra o que mudaria)'));
  if (base) {
    let st = 0; try { st = (await ctx.fetch(base + '/api/saude', { redirect: 'manual', signal: AbortSignal.timeout(15000) })).status; } catch { /* sem resposta */ }
    const exige = st === 401 || st === 403;
    itens.push(manual('monitor-de-saude', E, 'Monitor externo em /api/saude com alerta no e-mail', exige ? 'o endereço /api/saude existe e exige entrada (correto). Falta só a pessoa confirmar que o monitor externo está criado e que o alerta de teste chegou.' : `/api/saude respondeu ${st || 'sem resposta'}; confirme o monitor e o alerta.`, `curl -s -o /dev/null -w "%{http_code}" ${base}/api/saude   (esperado 401 sem entrar)`));
  } else itens.push(manual('monitor-de-saude', E, 'Monitor externo em /api/saude com alerta no e-mail', 'sem endereço publicado para olhar.', 'node scripts/setup.mjs deploy'));
  itens.push(await itemDeWorkflow(ctx, { id: 'atualizar-core', secao: E, titulo: 'Atualização semanal do core ligada', arquivo: 'atualizar-core.yml', existeArquivo: await wf('atualizar-core.yml'), comando: 'gh workflow list   (o fluxo "atualizar-core" deve estar active)', aviso: 'Ele roda toda semana e abre um pull request; quem aprova é a pessoa.' }));
  itens.push(manual('segundo-administrador', E, 'Segunda pessoa de confiança consegue recuperar a conta', 'procedimento humano.', 'perguntar à pessoa quem é a segunda pessoa e onde está o procedimento escrito'));

  /* ---- F. legal */
  if (base) {
    let j = null; try { const r = await ctx.fetch(base + '/api/legal', { signal: AbortSignal.timeout(15000) }); if (r.status === 200) j = await r.json(); } catch { /* sem resposta */ }
    const docs = j && j.documentos;
    if (!docs) itens.push(manual('politica-e-termos', F, 'Política de privacidade e termos preenchidos', 'não consegui ler /api/legal.', 'abrir o /admin, Superadmin, textos legais'));
    else {
      const faltam = ['privacidade', 'termos'].filter((t) => !(docs[t] && docs[t].campos && docs[t].campos.controlador && docs[t].campos.contato));
      if (faltam.length) itens.push(item('politica-e-termos', F, 'Política de privacidade e termos preenchidos', 'falha', `faltam controlador e contato em: ${faltam.join(', ')}. (Peça orientação jurídica; o modelo não é aconselhamento jurídico.)`, `abrir ${base}/admin e preencher os textos legais`));
      else itens.push(item('politica-e-termos', F, 'Política de privacidade e termos preenchidos', 'ok', 'controlador e contato preenchidos nos dois documentos.', `curl -s ${base}/api/legal`));
    }
  } else itens.push(manual('politica-e-termos', F, 'Política de privacidade e termos preenchidos', 'sem endereço publicado para olhar.', 'node scripts/setup.mjs deploy'));
  itens.push(manual('direito-de-exibir', F, 'Direito de exibir todo o conteúdo publicado', 'só a pessoa sabe se tem os direitos.', 'perguntar à pessoa, título por título se preciso'));

  for (const it of itens) if (it.estado === 'manual' && confirmados.includes(it.id)) { it.estado = 'ok'; it.detalhe = 'confirmado pela pessoa (--confirmado).'; }
  return { itens, modo, url: base };
}
