/* scripts/lib/setup/credenciais.mjs — o que cada provedor de vídeo precisa, em UM lugar só: `video`, `doctor` e
 * `status` usam a mesma lista (antes cada um tinha a sua e elas não batiam). */

/* Credenciais OPCIONAIS que, nos modos restritos, ligam a assinatura de vídeo. */
export const CREDENCIAIS_DE_ASSINATURA = Object.freeze({
  bunny: ['hostDaPullZone', 'chaveDeToken'],
  'cloudflare-stream': ['chaveAssinaturaId', 'chaveAssinaturaJwk']
});

/* Variáveis que são só identificadores (aparecem em endereços e no painel); não são senha. O setup as pede num campo
 * VISÍVEL, para a pessoa conferir o que digitou. */
export const NAO_SECRETAS = Object.freeze(new Set([
  'BUNNY_LIBRARY_ID', 'BUNNY_PULLZONE', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_STREAM_SUBDOMINIO', 'CLOUDFLARE_STREAM_KEY_ID'
]));

/* Onde achar cada uma, em palavras simples (detalhes em docs/contas-e-chaves.md). */
export const ONDE_ACHAR = Object.freeze({
  BUNNY_LIBRARY_ID: 'Bunny: Stream, abra a sua biblioteca de vídeo; o "Library ID" é um número. Não é senha, pode aparecer na tela. (docs/contas-e-chaves.md, seção 2)',
  BUNNY_API_KEY: 'Bunny: Stream, sua biblioteca, aba API, "Stream API Key" da BIBLIOTECA (não a "Account API Key" da conta). É secreta. (docs/contas-e-chaves.md, seção 2)',
  BUNNY_PULLZONE: 'Bunny: o endereço de entrega dos vídeos da sua biblioteca, parecido com vz-xxxxxxxx-xxx.b-cdn.net ("pull zone" é o nome técnico desse endereço). Não é senha. (docs/contas-e-chaves.md, seção 2)',
  BUNNY_TOKEN_KEY: 'Bunny: na biblioteca, em Security, ligue a autenticação por token e copie a chave. É secreta e é ela que protege o vídeo nos modos privado e cadastro. (docs/contas-e-chaves.md, seção 2)',
  CLOUDFLARE_ACCOUNT_ID: 'Cloudflare: o ID da conta (32 letras e números) aparece na página Workers e Pages. Não é senha. (docs/contas-e-chaves.md, seção 3)',
  CLOUDFLARE_STREAM_TOKEN: 'Cloudflare: Perfil, Tokens de API, token personalizado com a permissão "Stream: Edit" só para a sua conta. É secreto. (docs/contas-e-chaves.md, seção 3)',
  CLOUDFLARE_STREAM_SUBDOMINIO: 'Cloudflare: na página do Stream, o endereço "customer-xxxx" dos vídeos. Não é senha. (docs/contas-e-chaves.md, seção 3)'
});

/* Regras de formato que a pessoa deve saber ANTES de chegar ao campo escondido. */
export const REGRAS_DO_SEGREDO = Object.freeze({
  ADMIN_PASSWORD: 'Escolha uma senha com pelo menos 12 caracteres (uma frase comprida serve). Você vai digitá-la duas vezes e deve guardá-la num gerenciador de senhas. É a senha de entrada no /admin.',
  TURNSTILE_SECRET: 'É a "chave secreta" do widget Turnstile (a chave do site, a pública, não vem aqui).'
});

/* [[nomeNoConfig, definição]] que o provedor exige hoje (obrigatórias + as de assinatura quando o acesso é restrito). */
export function credenciaisNecessarias(modulo, id, modo) {
  const restrito = modo !== 'publico';
  return Object.entries(modulo.CREDENCIAIS).filter(([nome, def]) =>
    def.segredo !== false && (def.obrigatoria || (restrito && (CREDENCIAIS_DE_ASSINATURA[id] || []).includes(nome))));
}
