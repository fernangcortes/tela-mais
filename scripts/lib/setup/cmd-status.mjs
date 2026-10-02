/* scripts/lib/setup/cmd-status.mjs — `setup.mjs status`: onde estou e qual é a próxima etapa. */
import { readFile } from 'node:fs/promises';
import { criarEstado, URL_DO_ULTIMO_DEPLOY } from './estado.mjs';
import { moduloDe } from '../provedores/index.mjs';
import { credenciaisNecessarias } from './credenciais.mjs';

/* A numeração é a do roteiro do AGENTS.md (etapas 0 a 9), para quem lê um e o outro. */
export const ETAPAS = Object.freeze([
  { id: 'ambiente', numero: 0, titulo: 'Preparar o computador (Node e wrangler)', comando: 'node scripts/setup.mjs doctor --only env' },
  { id: 'identidade', numero: 1, titulo: 'Nome, tipo de organização e marca', comando: 'node scripts/setup.mjs init' },
  { id: 'acesso', numero: 2, titulo: 'Quem pode assistir (acesso)', comando: 'node scripts/setup.mjs acesso' },
  { id: 'cloudflare', numero: 3, titulo: 'Conta na Cloudflare (login)', comando: 'node scripts/setup.mjs cloudflare verificar' },
  { id: 'recursos', numero: 4, titulo: 'Armazenamento e banco na Cloudflare', comando: 'node scripts/setup.mjs cloudflare provisionar' },
  { id: 'video', numero: 5, titulo: 'Provedor de vídeo e chaves', comando: 'node scripts/setup.mjs video' },
  { id: 'segredos', numero: 6, titulo: 'Senha do administrador e chave das sessões', comando: 'node scripts/setup.mjs segredo ADMIN_PASSWORD' },
  { id: 'publicacao', numero: 7, titulo: 'Publicar o site', comando: 'node scripts/setup.mjs deploy' },
  { id: 'primeiro-video', numero: 8, titulo: 'Enviar o primeiro vídeo (pelo /admin do site)', comando: null },
  { id: 'opcionais', numero: 9, titulo: 'Opcionais: domínio, Turnstile, backup, alerta de gasto', comando: null }
]);

export const status = {
  nome: 'status',
  resumo: 'Mostra em que etapa da montagem você está e qual é a próxima.',
  uso: 'status [--offline] [--json]',
  flags: { offline: 'bool' },
  async executar(ctx, rel) {
    const estado = criarEstado(ctx);
    const off = ctx.flags.offline === true;
    const cfg = await estado.config();
    const config = cfg.ok ? cfg.config : null;
    const bruto = cfg.bruto || {};
    const etapas = [];
    const poe = (id, st, detalhe = '') => { const e = ETAPAS.find((x) => x.id === id); etapas.push({ id, numero: e.numero, titulo: e.titulo, estado: st, detalhe, comando: e.comando }); };

    const [maior] = process.versions.node.split('.').map(Number);
    poe('ambiente', maior >= 20 ? 'feito' : 'pendente', `Node ${process.versions.node}`);
    const nomeProprio = Boolean(config && config.marca.nome !== 'Plataforma Exemplo');
    poe('identidade', bruto.preset && nomeProprio ? 'feito' : 'pendente', bruto.preset && nomeProprio ? `${config.marca.nome} (modelo ${bruto.preset})` : !bruto.preset ? 'ainda sem o tipo de organização' : 'ainda com o nome de exemplo');
    /* o modelo traz um modo padrão: só conta como escolhido depois do `init` (que registra o tipo de organização) */
    const modoEscolhido = bruto.acesso && bruto.acesso.modo && bruto.preset;
    poe('acesso', modoEscolhido ? 'feito' : 'pendente', modoEscolhido ? `modo ${bruto.acesso.modo}` : 'ainda não confirmado (o modelo traz "publico" só como ponto de partida; confirme com a pessoa)');

    let quem = null;
    let segredos = { nomes: [], existeWorker: false, consultado: false };
    if (!off) { quem = await estado.quem(); segredos = await estado.segredosRemotos(); }
    const w = await estado.wrangler();
    const idsOk = Boolean(w.recursos.kv && w.recursos.kv.id && w.recursos.d1 && w.recursos.d1.database_id);
    if (off) {
      poe('cloudflare', 'desconhecido', 'sem --offline eu confiro o login');
      poe('recursos', idsOk ? 'feito' : 'desconhecido', idsOk ? 'ids no wrangler.jsonc' : 'sem --offline eu confiro');
    } else if (!quem.logado) {
      poe('cloudflare', 'pendente', 'ainda não entrou (a pessoa roda: npx wrangler login)');
      poe('recursos', 'pendente', 'depende do login');
    } else {
      poe('cloudflare', 'feito', `entrou como ${quem.email || '(conta)'}`);
      poe('recursos', idsOk ? 'feito' : 'pendente', idsOk ? 'armazenamento (KV) e banco de contas (D1) prontos' : 'faltam o armazenamento (KV) e o banco de contas (D1)');
    }

    let videoEstado = 'pendente';
    let videoDetalhe = 'config inválida';
    if (config) {
      const env = await estado.envLocal();
      const nec = credenciaisNecessarias(moduloDe(config.video.provedor), config.video.provedor, config.acesso.modo).map(([, d]) => d.env);
      const faltam = nec.filter((n) => !segredos.nomes.includes(n) && !env[n]);
      videoEstado = faltam.length ? 'pendente' : 'feito';
      videoDetalhe = faltam.length ? `${config.video.provedor}: faltam ${faltam.join(', ')}` : `${config.video.provedor}: credenciais presentes`;
    }
    poe('video', videoEstado, videoDetalhe);

    if (off) poe('segredos', 'desconhecido', 'sem --offline eu confiro no Worker');
    else {
      const faltam = ['ADMIN_PASSWORD', 'SESSION_SECRET'].filter((n) => !segredos.nomes.includes(n));
      poe('segredos', faltam.length ? 'pendente' : 'feito', faltam.length ? `faltam ${faltam.join(', ')}` : 'cadastrados no Worker');
    }
    let url = null;
    try { url = JSON.parse(await readFile(URL_DO_ULTIMO_DEPLOY(ctx.raiz), 'utf8')).url; } catch { /* nunca publicou daqui */ }
    poe('publicacao', url ? 'feito' : 'pendente', url || 'ainda não publicado por aqui');

    poe('primeiro-video', url ? 'desconhecido' : 'pendente', url ? 'entre em /admin e envie um vídeo (eu não consigo ver o catálogo daqui)' : 'depois de publicar');
    poe('opcionais', 'opcional', 'domínio próprio, Turnstile (obrigatório no modo cadastro), backup, alerta de gasto');
    const proxima = etapas.find((e) => e.estado === 'pendente') || etapas.find((e) => e.estado === 'desconhecido') || null;
    for (const e of etapas) rel.info(`  [${e.estado === 'feito' ? 'x' : e.estado === 'desconhecido' ? '?' : ' '}] ${e.numero}. ${e.titulo}${e.detalhe ? ' — ' + e.detalhe : ''}`);
    rel.dado('etapas', etapas);
    rel.dado('proximaEtapa', proxima ? proxima.id : null);
    rel.dado('projeto', { nome: config ? config.marca.nome : null, preset: bruto.preset || null, acesso: config ? config.acesso.modo : null, video: config ? config.video.provedor : null, url });
    const obrigatorias = etapas.filter((e) => e.estado !== 'opcional');
    const prontas = obrigatorias.filter((e) => e.estado === 'feito').length;
    rel.dado('progresso', { prontas, total: obrigatorias.length });
    rel.resumir(proxima ? `${prontas} de ${obrigatorias.length} etapas prontas. Falta: etapa ${proxima.numero}, ${proxima.titulo}.` : `${prontas} de ${obrigatorias.length} etapas prontas.`);
    rel.passo(proxima ? `Etapa ${proxima.numero}, ${proxima.titulo}${proxima.comando ? ': ' + proxima.comando : ''}` : 'Tudo montado. Teste de fora: node scripts/setup.mjs doctor --remote');
    return 0;
  }
};
