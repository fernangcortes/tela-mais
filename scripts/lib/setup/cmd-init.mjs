/* scripts/lib/setup/cmd-init.mjs — `setup.mjs init`: as perguntas essenciais (nome, tipo de organização, acesso,
 * provedor de vídeo, idiomas). Interativo, ou por flags / --yes. Idempotente: rodar de novo com as mesmas respostas não
 * muda nada nem duplica recurso. */
import { listarPresets, carregarPreset, mesclar, definirCaminho, lerCaminho } from './config-io.mjs';
import { listarProvedores } from '../provedores/index.mjs';
import { erroUso, pendente } from './erros.mjs';
import { salvarConfig, siteAtual, apelidoDeModo } from './comum.mjs';
import { aplicarMarca } from './cmd-marca.mjs';
import { aplicarAcesso } from './cmd-acesso.mjs';
import { DEFINICOES_DO_MODO } from './doctor.mjs';
import { PROVEDORES_ROTULO } from './cmd-video.mjs';
import { provisionarCloudflare } from './cmd-cloudflare.mjs';
import { lerWrangler, gravarIdsNoWrangler, slugDoProjeto } from './cloudflare.mjs';

const NOME_PADRAO_DO_PROJETO = 'plataforma-exemplo';

export const init = {
  nome: 'init',
  resumo: 'Pergunta o essencial (nome, tipo de organização, acesso, vídeo, idiomas) e monta o config/site.json.',
  uso: 'init [--nome "Nome"] [--preset escola|igreja|empresa|infoprodutor|festival|prefeitura|criador] [--acesso publico|cadastro|privado] [--video bunny|cloudflare-stream|hls-generico] [--idiomas pt-BR,en,es] [--projeto slug] [--refazer-preset] [--cloudflare] [--yes] [--dry-run]',
  flags: { nome: 'valor', preset: 'valor', acesso: 'valor', video: 'valor', idiomas: 'lista', projeto: 'valor', 'refazer-preset': 'bool', cloudflare: 'bool', conta: 'valor' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const presets = await listarPresets(ctx.raiz);
    const { bruto, existe } = await siteAtual(ctx);
    if (!existe) throw erroUso('não achei config/site.json. Restaure com git ou copie o exemplo do repositório.');
    let nome = f.nome;
    let preset = f.preset;
    let modo = f.acesso !== undefined ? apelidoDeModo(f.acesso) : undefined;
    let provedor = f.video;
    let idiomas = f.idiomas && f.idiomas.length ? f.idiomas : undefined;
    if (f.acesso !== undefined && !modo) throw erroUso('--acesso: use publico, cadastro ou privado.');
    if (provedor !== undefined && !listarProvedores().includes(provedor)) throw erroUso(`--video: use ${listarProvedores().join(', ')}.`);
    if (preset !== undefined && !presets.some((p) => p.id === preset)) throw erroUso(`--preset "${preset}" não existe. Use: ${presets.map((p) => p.id).join(', ')}.`);

    const jaTemPreset = Boolean(bruto.preset);
    const faltaEssencial = nome === undefined || (preset === undefined && !jaTemPreset);
    if (faltaEssencial && !f.yes) {
      if (ctx.interativo) {
        const p = ctx.perguntar;
        if (nome === undefined) nome = await p.texto('Como se chama a sua plataforma?', lerCaminho(bruto, 'marca.nome'));
        if (preset === undefined && !jaTemPreset) {
          preset = await p.escolher('Que tipo de organização é a sua?', presets.map((x) => ({ valor: x.id, rotulo: x.nome, detalhe: x.resumo })), 'criador');
        }
        const base = mesclar(bruto, (presets.find((x) => x.id === (preset || bruto.preset)) || { config: {} }).config);
        if (modo === undefined) modo = await p.escolher('Quem pode assistir?', ['publico', 'cadastro', 'privado'].map((m) => ({ valor: m, rotulo: m, detalhe: DEFINICOES_DO_MODO[m] })), lerCaminho(base, 'acesso.modo') || 'privado');
        if (provedor === undefined) provedor = await p.escolher('Onde ficam os vídeos?', listarProvedores().map((v) => ({ valor: v, rotulo: PROVEDORES_ROTULO[v]?.rotulo || v, detalhe: PROVEDORES_ROTULO[v]?.detalhe })), lerCaminho(base, 'video.provedor') || 'bunny');
        if (idiomas === undefined) {
          const r = await p.texto('Idiomas do site (códigos separados por vírgula: pt-BR, en, es)', (lerCaminho(base, 'idiomas.disponiveis') || ['pt-BR']).join(', '));
          idiomas = r.split(',').map((s) => s.trim()).filter(Boolean);
        }
      } else {
        const faltam = [];
        if (nome === undefined) faltam.push('--nome');
        if (preset === undefined && !jaTemPreset) faltam.push('--preset');
        throw pendente('init-faltam-respostas', `faltam respostas da pessoa: ${faltam.join(', ')}. Agente: pergunte a ela, uma pergunta por vez, e então rode o comando com as respostas (ou use --yes para aceitar os padrões do tipo escolhido).`, {
          quem: 'agente',
          comando: 'node scripts/setup.mjs init --nome "Nome" --preset criador --acesso publico --video bunny --idiomas pt-BR',
          dados: { faltam, presets: presets.map((p) => ({ id: p.id, nome: p.nome, resumo: p.resumo })) }
        });
      }
    }

    let novo = JSON.parse(JSON.stringify(bruto));
    const aplicarPreset = preset !== undefined && (preset !== bruto.preset || f['refazer-preset']);
    if (aplicarPreset) {
      const p = await carregarPreset(ctx.raiz, preset);
      novo = mesclar(novo, p.config);
      rel.acao('preset', `Modelo "${p.nome}" aplicado: ${p.resumo}`, ctx.flags.dryRun ? 'simulado' : 'feito');
      const sug = p.config || {};
      const partes = [sug.tema?.preset && `visual "${sug.tema.preset}"`, sug.acesso?.modo && `acesso "${sug.acesso.modo}"`, sug.recursos?.legendas && 'legendas ligadas', sug.recursos?.continuarAssistindo && '"continuar de onde parou"'].filter(Boolean);
      if (partes.length) rel.info(`  O modelo escolheu para você: ${partes.join(', ')}. Tudo isso pode ser mudado depois (marca, acesso).`);
      if (modo !== undefined && sug.acesso?.modo && sug.acesso.modo !== modo) rel.info(`  Atenção: o modelo sugere acesso "${sug.acesso.modo}", mas você escolheu "${modo}"; vale a sua escolha. ${DEFINICOES_DO_MODO[modo]}`);
      if (bruto.preset && bruto.preset !== preset) rel.aviso(`troquei o preset de "${bruto.preset}" para "${preset}": as opções que o preset define foram sobrescritas.`);
    } else if (preset !== undefined) rel.acao('preset', `Preset "${preset}" já estava aplicado (use --refazer-preset para reaplicar)`, 'ja-estava');

    if (nome !== undefined) {
      await aplicarMarca(ctx, rel, novo, { nome, icones: false, semIcones: true });
    }
    if (modo !== undefined) aplicarAcesso(novo, { modo });
    else if (aplicarPreset) aplicarAcesso(novo, {});
    if (provedor !== undefined) definirCaminho(novo, 'video.provedor', provedor);
    if (idiomas !== undefined) {
      definirCaminho(novo, 'idiomas.disponiveis', idiomas);
      definirCaminho(novo, 'idiomas.padrao', idiomas[0]);
    }
    const slug = f.projeto || (nome !== undefined && lerCaminho(novo, 'implantacao.nomeDoProjeto') === NOME_PADRAO_DO_PROJETO ? slugDoProjeto(nome) : undefined);
    if (slug) {
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw erroUso('--projeto: use letras minúsculas, números e hífen (ex.: minha-tela).');
      definirCaminho(novo, 'implantacao.nomeDoProjeto', slug);
    }
    await salvarConfig(ctx, rel, novo, 'Gravei as suas escolhas em config/site.json');

    /* o nome do Worker no wrangler.jsonc acompanha, mas só enquanto ainda é o do modelo (renomear um Worker já publicado cria outro) */
    if (slug) {
      const w = await lerWrangler(ctx.raiz);
      if (w.existe && w.dados.name === NOME_PADRAO_DO_PROJETO && slug !== NOME_PADRAO_DO_PROJETO) {
        const g = await gravarIdsNoWrangler(ctx.raiz, { nomeDoProjeto: slug }, { dryRun: ctx.flags.dryRun });
        rel.acao('wrangler-nome', `Nome do projeto no wrangler.jsonc: ${slug}`, ctx.flags.dryRun ? 'simulado' : (g.mudou ? 'feito' : 'ja-estava'));
      }
    }

    let comCloudflare = f.cloudflare === true;
    if (!f.cloudflare && ctx.interativo && !f.yes && !f.dryRun) comCloudflare = await ctx.perguntar.confirmar('Criar agora o armazenamento na sua conta Cloudflare (KV e D1; cabem no plano gratuito)?', false);
    if (comCloudflare) await provisionarCloudflare(ctx, rel, { contaId: f.conta });

    const final = (await siteAtual(ctx)).bruto;
    rel.dado('escolhas', {
      nome: lerCaminho(final, 'marca.nome'), preset: final.preset || null, acesso: lerCaminho(final, 'acesso.modo') || 'privado',
      video: lerCaminho(final, 'video.provedor'), idiomas: lerCaminho(final, 'idiomas.disponiveis') || ['pt-BR'], projeto: lerCaminho(final, 'implantacao.nomeDoProjeto')
    });
    rel.passo(comCloudflare ? 'Escolha as cores e o logo: node scripts/setup.mjs marca' : 'Escolha as cores e o logo: node scripts/setup.mjs marca  (depois: cloudflare, video, segredo, deploy)');
    return 0;
  }
};
