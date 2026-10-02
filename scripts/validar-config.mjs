#!/usr/bin/env node
/* scripts/validar-config.mjs — confere o config/site.json antes de publicar.
 *
 *   node scripts/validar-config.mjs [caminho/do/site.json]
 *
 * Sai com código 0 se estiver tudo certo e com 1 se houver qualquer problema,
 * com uma frase por problema dizendo ONDE está e o que fazer. Não precisa de
 * conhecimento de programação para ler a saída.
 */
import { pathToFileURL } from 'node:url';
import { carregarConfig } from './lib/config-carregar.mjs';
import { listarProvedores, moduloDe } from './lib/provedores/index.mjs';
import { credenciaisNecessarias } from './lib/setup/credenciais.mjs';
import { formatarErros, ehReferenciaEnv } from '../core/worker/_lib/config-validar.mjs';

/* Nomes de variáveis secretas que o arquivo espera, para a pessoa saber o que cadastrar. */
export function variaveisEsperadas(valor, achados = new Set()) {
  if (ehReferenciaEnv(valor)) achados.add(valor.$env);
  else if (Array.isArray(valor)) valor.forEach((v) => variaveisEsperadas(v, achados));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach((v) => variaveisEsperadas(v, achados));
  return achados;
}

/* Avisos: não impedem de publicar, mas a pessoa precisa saber. */
export function avisosDe(config) {
  const avisos = [];
  if (config.seo?.indexavel && config.acesso?.modo !== 'publico') {
    avisos.push(`seo.indexavel está ligado, mas o acesso é "${config.acesso.modo}": buscadores continuarão bloqueados.`);
  }
  if (config.acesso?.modo === 'publico') {
    avisos.push('o acesso está "publico": qualquer pessoa com o endereço vê o catálogo. Para restringir, use "privado".');
  }
  if (config.acesso?.modo === 'cadastro') {
    avisos.push('modo "cadastro": o cadastro só abre com o secret TURNSTILE_SECRET e a variável TURNSTILE_SITE_KEY (chave pública do Turnstile) no Worker; sem eles fica fechado.');
    const metodo = config.acesso.cadastro?.metodo ?? 'link-magico';
    if (metodo === 'link-magico' && (config.acesso.email?.adaptador ?? 'nenhum') === 'nenhum') {
      avisos.push('cadastro por link mágico precisa de envio de e-mail: escolha acesso.email.adaptador "resend" (ou use acesso.cadastro.metodo "email-e-senha"); senão o cadastro fica fechado.');
    }
  }
  if (config.acesso?.modo !== 'publico' && config.acesso?.email?.adaptador === 'resend') {
    avisos.push('e-mail por Resend: cadastre o secret RESEND_API_KEY e a variável EMAIL_REMETENTE (um remetente de domínio verificado no Resend).');
  }
  if (config.acesso?.modo !== 'publico') {
    avisos.push('neste modo as contas de quem assiste ficam num banco de dados da Cloudflare (D1), que o projeto já deixa preparado; o passo "cloudflare provisionar" do setup o cria. Sem ele, só a equipe consegue entrar.');
  }
  return avisos;
}

export async function principal(argv = process.argv.slice(2), saida = console) {
  const arquivo = argv.find((a) => !a.startsWith('-'));
  const r = await carregarConfig({ arquivo });
  if (!r.ok) {
    saida.error('A configuração tem problemas e NÃO deve ser publicada assim:\n');
    saida.error(formatarErros(r.erros));
    saida.error('\nCorrija o arquivo config/site.json e rode de novo. Se errar, o site abre no modo mais fechado ("privado").');
    return 1;
  }
  const c = r.config;
  saida.log('Configuração válida.');
  saida.log(`  Marca:    ${c.marca.nome}`);
  saida.log(`  Acesso:   ${c.acesso.modo}`);
  saida.log(`  Vídeo:    ${c.video.provedor}`);
  saida.log(`  Autoplay: ${c.player.autoplay.modo}`);
  /* só as chaves do provedor ESCOLHIDO (a config traz o bloco dos outros, que não valem) */
  const bruto = JSON.parse(JSON.stringify(r.bruto));
  for (const p of listarProvedores()) {
    const chave = moduloDe(p).CHAVE_CONFIG;
    if (p !== c.video.provedor && chave && bruto.video) delete bruto.video[chave];
  }
  const vars = [...new Set([
    ...credenciaisNecessarias(moduloDe(c.video.provedor), c.video.provedor, c.acesso.modo).map(([, d]) => d.env),
    ...variaveisEsperadas(bruto)
  ])];
  const geradas = c.video.provedor === 'cloudflare-stream' ? ['CLOUDFLARE_STREAM_KEY_ID', 'CLOUDFLARE_STREAM_KEY_JWK'] : [];
  const suas = vars.filter((v) => !geradas.includes(v));
  if (suas.length) saida.log(`  Chaves que você vai precisar guardar mais adiante (o setup pede cada uma, num campo escondido; nunca no chat): ${suas.join(', ')}`);
  if (geradas.some((g) => vars.includes(g))) saida.log('  A chave de assinatura do vídeo (CLOUDFLARE_STREAM_KEY_ID e CLOUDFLARE_STREAM_KEY_JWK) o setup cria sozinho no passo do vídeo.');
  for (const a of avisosDe(c)) saida.log(`  Aviso: ${a}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal();
}
