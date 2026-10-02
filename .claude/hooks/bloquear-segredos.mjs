#!/usr/bin/env node
// Hook PreToolUse (Bash) do Claude Code: recusa comandos que imprimiriam ou vazariam segredos.
// Entrada: JSON no stdin ({ tool_input: { command } }). Saída: código 2 + motivo no stderr bloqueia o comando.
// É uma rede de proteção simples, não um cofre: a regra de verdade está no AGENTS.md (nunca pedir nem mostrar segredo).
// Sem dependências, portátil (Windows, macOS, Linux).

const ARQUIVOS_SECRETOS = String.raw`(?:\.env(?!\.example)(?:\.[\w.-]+)?|\.dev\.vars(?:\.[\w.-]+)?|[\w./\\-]*\.(?:pem|key)|(?:segredos|secrets)[\\/][\w./\\-]*)`;
const LEITORES = String.raw`(?:cat|type|more|less|head|tail|grep|egrep|rg|awk|sed|cp|mv|base64|xxd|od|strings|bat|nl|tac|source|\.|Get-Content|gc|Select-String|sls)`;

const REGRAS = [
  {
    re: new RegExp(String.raw`(?:^|[\s;&|(])${LEITORES}\s+[^;&|\n]*?(?<![\w.-])${ARQUIVOS_SECRETOS}(?![\w.-])`, 'i'),
    motivo: 'ler um arquivo de segredos (.env, .dev.vars, chaves). Use `node scripts/setup.mjs doctor`, que mostra só os nomes.',
  },
  {
    re: /(?:^|[\s;&|(])(?:printenv|env|export|set|declare|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:)\s*(?:$|[;&|\n])/i,
    motivo: 'listar todas as variáveis de ambiente (podem conter chaves).',
  },
  {
    re: /\b(?:echo|printf|Write-Output|Write-Host)\b[^;&|\n]*(?:\$\{?|%|\$env:)\w*(?:KEY|TOKEN|SECRET|PASSWORD|SENHA)\w*/i,
    motivo: 'imprimir variável que guarda segredo.',
  },
  {
    re: /\bwrangler\s+(?:pages\s+)?secret\s+(?:put|bulk)\b[^\n]*(?:<|\bcat\b)/i,
    motivo: 'passar um segredo para o wrangler por redirecionamento. Rode `wrangler secret put NOME` sozinho: o prompt oculto é da pessoa.',
  },
  {
    re: /(?:echo|printf|Write-Output)\b[^\n]*\|\s*(?:npx\s+)?wrangler\s+(?:pages\s+)?secret\s+(?:put|bulk)/i,
    motivo: 'enviar um segredo por pipe ao wrangler (o valor ficaria no comando). Use o prompt oculto.',
  },
  {
    re: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n]*(?:authorization:\s*bearer\s+[\w.~+/=-]{16,}|--?(?:u|user)\s+\S+:\S+|[?&](?:key|token|api_?key)=[\w.-]{16,})/i,
    motivo: 'um token escrito no próprio comando. Chave vai por variável de ambiente lida pelo script, nunca no texto do comando.',
  },
  {
    re: /(?:cfut_|cfat_|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
    motivo: 'o comando contém algo que parece uma chave ou token.',
  },
  {
    re: /\bwrangler\s+(?:pages\s+)?secret\s+list\b[^\n]*(?:--format\s*=?\s*json)?\s*\|\s*(?:jq|grep)[^\n]*value/i,
    motivo: 'tentar extrair valores de segredos.',
  },
];

export function avaliar(comando) {
  for (const { re, motivo } of REGRAS) if (re.test(comando)) return motivo;
  return null;
}

async function lerEntrada() {
  let texto = '';
  for await (const pedaco of process.stdin) texto += pedaco;
  return texto;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bloquear-segredos.mjs')) {
  let comando = '';
  try {
    comando = String(JSON.parse(await lerEntrada())?.tool_input?.command ?? '');
  } catch {
    process.exit(0); // entrada inesperada: não atrapalha o trabalho
  }
  const motivo = avaliar(comando);
  if (motivo) {
    console.error(`Bloqueado pela regra de segredos do projeto: ${motivo}\nSegredos só entram pelo prompt oculto do terminal da pessoa (veja AGENTS.md).`);
    process.exit(2);
  }
}
