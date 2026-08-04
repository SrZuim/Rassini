/* ==========================================================================
   RNA One — Mídia da Biblioteca Técnica (imagens e documentos)
   ---------------------------------------------------------------------------
   FONTE ÚNICA de upload/leitura/substituição/remoção de arquivo da Biblioteca.
   Antes cada tela tinha a sua própria função de upload (uma usava o bucket
   `evidencias`, outra o `biblioteca`, cada uma com validação e mensagem
   próprias) — e nenhuma tratava o caso "editei outro campo e a imagem sumiu".

   REGRAS QUE ESTE MÓDULO GARANTE
   1. Nada de referência temporária no banco. `blob:` e `C:\fakepath\` nunca
      chegam a uma coluna: getLibraryImageUrl os rejeita e o upload devolve
      exclusivamente URL pública + path do Storage.
   2. Ordem de substituição segura. replaceLibraryImage() envia o novo arquivo e
      devolve `descartarAnterior()` — um fechamento que o chamador só executa
      DEPOIS de o UPDATE ter dado certo. Se o upload ou o UPDATE falhar, a
      imagem anterior continua intacta.
   3. Nada de órfão. Falhou a gravação no banco? O chamador chama
      removeLibraryImage(novo.path) e o Storage volta ao estado anterior.
   4. Erro nunca é engolido. Toda falha vira mensagem específica (bucket
      inexistente, MIME, tamanho, permissão, sessão) com o detalhe técnico
      anexado, e o erro cru vai para o console.

   ORGANIZAÇÃO NO BUCKET `biblioteca`
     pecas/{registro_id}/{timestamp}-{uuid}-{nome-tratado}
     especificacoes/{registro_id}/...
     caracteristicas-visuais/{registro_id}/...
     desenhos/{registro_id}/...

   COMPATIBILIDADE: o banco guarda a URL completa, então imagens antigas que
   foram parar no bucket `evidencias` continuam abrindo sem migração.
   ========================================================================== */
import { SUPABASE } from './config.js';
import { getSupabase } from './supabaseClient.js';

export const BUCKET_BIBLIOTECA = 'biblioteca';

/* Pastas válidas — lista fechada para não nascer pasta solta a cada tela nova. */
export const PASTAS = {
  pecas: 'pecas',
  especificacoes: 'especificacoes',
  caracteristicasVisuais: 'caracteristicas-visuais',
  desenhos: 'desenhos',
  documentos: 'documentos'
};

const IMG_EXT  = ['jpg', 'jpeg', 'png', 'webp'];
const IMG_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const DOC_EXT  = ['pdf', 'dwg', 'dxf', 'xls', 'xlsx', 'doc', 'docx', 'zip', ...IMG_EXT];
export const IMG_MAX_MB = 10;
export const DOC_MAX_MB = 20;

/* Erro de mídia já traduzido. `amigavel` avisa as camadas de cima para NÃO
   reembrulhar a mensagem (o erro real fica em `causa`). */
export class MidiaError extends Error {
  constructor(mensagem, causa, tecnico) {
    super(mensagem);
    this.name = 'MidiaError';
    this.amigavel = true;
    this.causa = causa;
    this.tecnico = tecnico || detalhe(causa);
  }
}
function detalhe(e) {
  if (!e) return '';
  const p = [e.status || e.statusCode ? `HTTP ${e.status || e.statusCode}` : '', e.code ? `code ${e.code}` : '',
             e.message || '', e.details || '', e.hint || ''].filter(Boolean);
  return [...new Set(p)].join(' · ');
}
function logMidia(contexto, e, extra = {}) {
  console.error(`[biblioteca-midia] ${contexto}`, {
    message: e?.message, name: e?.name, code: e?.code,
    status: e?.status ?? e?.statusCode, details: e?.details, hint: e?.hint, ...extra
  });
}

/* ===================================================== VALIDAÇÃO ========== */
/** Valida imagem. Devolve '' quando ok, ou a mensagem do problema. */
export function validarImagem(file) {
  if (!file) return 'Nenhum arquivo selecionado.';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();
  if (!IMG_EXT.includes(ext) && !IMG_MIME.includes(file.type))
    return `Formato de arquivo não permitido. Use ${IMG_EXT.join(', ').toUpperCase()}.`;
  if (!file.size) return 'O arquivo selecionado está vazio.';
  if (file.size > IMG_MAX_MB * 1024 * 1024) return `A imagem excede o limite de ${IMG_MAX_MB} MB.`;
  return '';
}
/** Valida documento técnico (inclui PDF e os formatos de desenho). */
export function validarDocumento(file) {
  if (!file) return 'Nenhum arquivo selecionado.';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();
  if (!DOC_EXT.includes(ext)) return `Formato de arquivo não permitido. Use ${DOC_EXT.join(', ').toUpperCase()}.`;
  if (!file.size) return 'O arquivo selecionado está vazio.';
  if (file.size > DOC_MAX_MB * 1024 * 1024) return `O arquivo excede o limite de ${DOC_MAX_MB} MB.`;
  return '';
}

/** Nome seguro: sem acento, espaço, barra ou símbolo; extensão preservada. */
export function sanitizarNome(nome, { max = 60 } = {}) {
  const bruto = String(nome || 'arquivo');
  const i = bruto.lastIndexOf('.');
  const ext = (i > 0 ? bruto.slice(i + 1) : '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const base = (i > 0 ? bruto.slice(0, i) : bruto).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return `${base || 'arquivo'}${ext ? '.' + ext : ''}`;
}

/** Caminho único e previsível dentro do bucket. */
export function caminhoBiblioteca(pasta, registroId, nome) {
  const uuid = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8);
  return `${PASTAS[pasta] || pasta || 'outros'}/${registroId || 'sem-registro'}/${Date.now()}-${uuid}-${sanitizarNome(nome)}`;
}

/* ====================================================== LEITURA =========== */
/** URL exibível a partir do que está gravado no banco.
    Rejeita de propósito `blob:` e `C:\fakepath\`: são referências da máquina de
    quem fez o upload, não apontam para nada depois do F5. Se uma delas tiver
    vazado para o banco em versões anteriores, aqui ela vira `null` (a tela
    mostra o placeholder) em vez de uma imagem quebrada. */
export function getLibraryImageUrl(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  if (/^(blob:|data:image\/[^;]+;base64,$)/i.test(s)) return null;
  if (/^[a-zA-Z]:\\|fakepath/i.test(s)) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;   // URL pública ou base64 (modo demo)
  if (!SUPABASE.enabled) return s;
  // Guardado como path relativo → resolve no bucket da Biblioteca.
  try { return `${SUPABASE.url}/storage/v1/object/public/${BUCKET_BIBLIOTECA}/${s.replace(/^\/+/, '')}`; }
  catch { return null; }
}

/* ======================================================= UPLOAD =========== */
/** Envia uma IMAGEM e devolve { url, path, nome, tipo, tamanho }.
    `onProgress(fase)` recebe 'lendo' | 'enviando' | 'concluido' para a tela
    poder mostrar "Enviando imagem..." e travar o botão salvar. */
export async function uploadLibraryImage(file, { pasta = 'pecas', registroId, onProgress } = {}) {
  const erro = validarImagem(file);
  if (erro) throw new MidiaError(erro, null, `${file?.name || '?'} · ${file?.size ?? '?'} bytes`);
  return enviarArquivo(file, { pasta, registroId, onProgress });
}

/** Envia um DOCUMENTO técnico (PDF/DWG/DXF/Office/imagem). */
export async function uploadLibraryDoc(file, { pasta = 'desenhos', registroId, onProgress } = {}) {
  const erro = validarDocumento(file);
  if (erro) throw new MidiaError(erro, null, `${file?.name || '?'} · ${file?.size ?? '?'} bytes`);
  return enviarArquivo(file, { pasta, registroId, onProgress });
}

async function enviarArquivo(file, { pasta, registroId, onProgress }) {
  const meta = { nome: file.name, tipo: file.type || '', tamanho: String(file.size) };
  if (!SUPABASE.enabled) {                       // modo demo: Base64 (sem Storage)
    onProgress?.('lendo');
    const url = await lerBase64(file);
    onProgress?.('concluido');
    return { url, path: null, ...meta };
  }
  /* Lê o arquivo para a memória ANTES de enviar. Se a leitura do disco falhar
     (arquivo do OneDrive "somente online", anexo aberto direto do e-mail,
     arquivo movido), o erro aparece com nome próprio em vez de virar um
     "Failed to fetch" no meio da requisição, indistinguível de falha de rede. */
  onProgress?.('lendo');
  let corpo;
  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) throw new Error('leitura devolveu 0 bytes');
    corpo = new Blob([buf], { type: file.type || 'application/octet-stream' });
  } catch (e) {
    logMidia('não foi possível ler o arquivo escolhido', e, { nome: file?.name, tamanho: file?.size });
    throw new MidiaError(
      'Não foi possível ler o arquivo do seu computador. Se ele estiver no OneDrive/Google Drive como "somente online", ' +
      'abra-o uma vez para baixar. Se veio de um e-mail, salve-o numa pasta antes de anexar.',
      e, `leitura local · ${file?.name || '?'}`);
  }

  onProgress?.('enviando');
  const sb = await getSupabase();
  const path = caminhoBiblioteca(pasta, registroId, file.name);
  const { error } = await sb.storage.from(BUCKET_BIBLIOTECA)
    .upload(path, corpo, { contentType: file.type || corpo.type, upsert: false });
  if (error) {
    logMidia('upload recusado pelo Storage', error, { bucket: BUCKET_BIBLIOTECA, path, bytes: corpo.size });
    throw new MidiaError(await mensagemStorageBiblioteca(error), error);
  }
  const { data } = sb.storage.from(BUCKET_BIBLIOTECA).getPublicUrl(path);
  if (!data?.publicUrl) {
    await removeLibraryImage(path);              // não deixa órfão
    throw new MidiaError('O arquivo subiu, mas o Storage não devolveu a URL pública.', null, `path ${path}`);
  }
  onProgress?.('concluido');
  return { url: data.publicUrl, path, ...meta };
}

/* =================================================== SUBSTITUIÇÃO ========= */
/** Substituição SEGURA. Envia o novo arquivo e devolve:
      { novo, descartarAnterior(), desfazer() }
    - `novo`      → { url, path, ... } já no Storage;
    - `descartarAnterior()` → apaga o arquivo antigo. Chame SÓ depois de o
      UPDATE no banco ter dado certo e a nova URL estar gravada;
    - `desfazer()` → apaga o arquivo NOVO. Chame se o UPDATE falhar.
    A função nunca apaga nada sozinha: quem sabe se o banco gravou é o chamador. */
export async function replaceLibraryImage(file, anterior, { pasta = 'pecas', registroId, onProgress } = {}) {
  const novo = await uploadLibraryImage(file, { pasta, registroId, onProgress });
  return {
    novo,
    descartarAnterior: () => removeLibraryImage(anterior),
    desfazer: () => removeLibraryImage(novo.path)
  };
}

/* ====================================================== REMOÇÃO =========== */
/** Apaga o arquivo do Storage. Aceita o `path` ou a URL pública gravada no
    banco. NUNCA lança: a falha ao limpar não pode mascarar (nem desfazer) a
    operação de negócio que já concluiu — fica registrada no console. */
export async function removeLibraryImage(ref) {
  const path = pathDe(ref);
  if (!path || !SUPABASE.enabled) return false;
  try {
    const sb = await getSupabase();
    const { error } = await sb.storage.from(path.bucket).remove([path.chave]);
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[biblioteca-midia] arquivo não removido do Storage (segue órfão):', ref, e?.message || e);
    return false;
  }
}

/** Extrai { bucket, chave } de uma URL pública do Storage ou de um path puro.
    Precisa reconhecer o bucket porque imagens antigas foram para `evidencias`. */
export function pathDe(ref) {
  const s = String(ref ?? '').trim();
  if (!s || /^(blob:|data:)/i.test(s)) return null;
  const m = s.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  if (m) return { bucket: m[1], chave: decodeURIComponent(m[2].split('?')[0]) };
  if (/^https?:\/\//i.test(s)) return null;         // URL externa: não é nossa para apagar
  return { bucket: BUCKET_BIBLIOTECA, chave: s.replace(/^\/+/, '') };
}

/* ================================================== MENSAGENS ============= */
export async function mensagemStorageBiblioteca(e) {
  const txt = `${e?.message || ''} ${e?.details || ''}`.toLowerCase();
  const code = String(e?.code || '');
  const status = String(e?.status ?? e?.statusCode ?? '');
  const tec = detalhe(e);
  const com = m => (tec ? `${m} [detalhe: ${tec}]` : m);

  if (/bucket not found|nosuchbucket/.test(txt) || code === 'NoSuchBucket')
    return com(`O repositório de arquivos (bucket "${BUCKET_BIBLIOTECA}") não existe no Supabase. Rode database/fix_buckets_biblioteca.sql — nenhuma imagem ou documento pode ser salvo até lá.`);
  if (/mime type|invalid_mime/.test(txt))
    return com('Formato de arquivo não permitido pelo repositório. Use JPG, PNG, WEBP ou PDF.');
  if (/payload too large|exceeded the maximum|maximum allowed size/.test(txt) || status === '413')
    return com('O arquivo excede o limite do repositório de arquivos.');
  if (code === '42501' || status === '403' || /row-level security|violates row-level|permission denied/.test(txt))
    return com(`Seu usuário não possui permissão para enviar arquivos da Biblioteca. Faltam as policies do bucket "${BUCKET_BIBLIOTECA}" (Storage → ${BUCKET_BIBLIOTECA} → Policies).`);
  if (status === '401' || /jwt|invalid token|not authenticated/.test(txt))
    return com('A sessão do usuário expirou. Entre novamente e repita o envio.');
  if (/duplicate|already exists/.test(txt) || status === '409')
    return com('Já existe um arquivo com este nome no repositório. Tente novamente.');
  if (/failed to fetch|networkerror|load failed|timeout/.test(txt))
    return com('O envio foi interrompido antes de chegar ao servidor. Verifique a conexão (ou se o arquivo ainda existe no computador) e tente de novo.');
  return com('Não foi possível enviar o arquivo para o armazenamento.');
}

function lerBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
