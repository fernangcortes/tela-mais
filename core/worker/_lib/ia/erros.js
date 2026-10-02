/* ia/erros.js — falha da IA, já em forma que o handler traduz para `erro(status, codigo, ...)`.
 *
 * `codigo` é estável (kebab-case) e cada um tem `api.<codigo>` em core/locales/*.json. Nada aqui carrega chave de API:
 * `detalhe` é curto e passa por `sanear` antes de sair (corta o que parece segredo). */

export const CODIGOS_ERRO_IA = Object.freeze([
  'ia-desligada',               /* provedor "nenhum", ou o recurso está desligado */
  'ia-sem-chave',               /* falta a chave do provedor (variável secreta) */
  'ia-provedor-invalido',       /* nome de provedor que não existe */
  'ia-tarefa-invalida',         /* tarefa que não existe */
  'ia-entrada-invalida',        /* entrada sem o que a tarefa precisa */
  'ia-provedor-recusou',        /* o provedor respondeu 4xx/5xx */
  'ia-provedor-inacessivel',    /* rede, tempo esgotado, resposta que não é JSON */
  'ia-resposta-invalida',       /* JSON torto ou fora do schema, mesmo depois da retentativa */
  'ia-orcamento-estourado',     /* o lote (ou a chamada) passa do orçamento do mês */
  'ia-transcricao-insuficiente',/* a transcrição não sustenta o texto (ou é curta demais) */
  'ia-sem-transcricao',         /* o título não tem legenda para ler */
  'ia-audio-grande',            /* áudio maior que o provedor aceita: fatie */
  'ia-sugestao-nao-encontrada',
  'ia-sugestao-invalida',       /* campo ou valor que a sugestão não aceita */
  'ia-titulo-nao-encontrado',
  'ia-recurso-desligado'        /* a tarefa existe, mas está desligada no /admin */
]);

export class ErroIA extends Error {
  constructor(codigo, { status = null, detalhe = '', retentavel = false } = {}) {
    super(codigo);
    this.name = 'ErroIA';
    this.codigo = codigo;
    this.status = status;
    this.retentavel = retentavel;
    this.detalhe = sanear(detalhe).slice(0, 400);
  }
}

/* Corta do texto o que se parece com chave de API, para o erro nunca vazar segredo. */
export function sanear(texto) {
  return String(texto == null ? '' : texto)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[chave]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[chave]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [chave]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[chave]');
}

export const ehErroIA = (e) => e instanceof ErroIA;
