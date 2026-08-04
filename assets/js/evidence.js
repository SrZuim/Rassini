/* ==========================================================================
   RNA One — Componente reutilizável de Upload de Evidência
   ---------------------------------------------------------------------------
   • Clicar abre seletor de arquivo (computador/galeria) ou câmera (celular)
   • Aceita JPG / JPEG / PNG / WEBP
   • Mostra preview, permite remover/substituir antes de salvar
   • Comprime a imagem (canvas) para caber no fallback local
   • commit() envia ao Supabase Storage (bucket 'evidencias') OU guarda Base64
     no fallback local, e grava na tabela `evidencias` vinculada ao registro.
   ---------------------------------------------------------------------------
   API:
     const up = initEvidenceUpload(alvo, { multiple, accent, label, hint, max });
     up.hasFiles() / up.count()
     const evidencias = await up.commit({ registro_tipo, registro_id, usuario, mirror });
     up.first()  → primeira evidência salva ({nome,url,path,tamanho,dataHora,...})
     up.clear()

   `mirror` (default true) grava o espelho na tabela legada `evidencias`. Telas
   que possuem tabela PRÓPRIA de anexos (ex.: inspeção dimensional → insp_anexos)
   passam `mirror:false`: nesse caso o espelho é best-effort e a sua falha (RLS,
   tabela ausente) não pode derrubar o anexo que já subiu e já foi vinculado.
   Onde `evidencias` é a ÚNICA persistência (ocorrências, planos, rotinas), o
   padrão continua sendo FATAL — falhar ali é perda de dado, não detalhe.
   ========================================================================== */
import { SUPABASE } from '../../services/config.js';
import { getSupabase } from '../../services/supabaseClient.js';
import { db } from '../../services/db.js';
import { toast } from './ui.js';

const TIPOS_OK = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const EXT_OK   = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_MB   = 15;          // limite do arquivo original
const MAX_DIM  = 1280;        // redimensionamento máximo (px)
const QUALITY  = 0.72;        // qualidade JPEG na compressão

let _seq = 0;

export function initEvidenceUpload(alvo, opts = {}) {
  const host = (typeof alvo === 'string') ? document.querySelector(alvo) : alvo;
  if (!host) return _noop();

  const { multiple = false, accent = 'default', label = 'Anexar evidência (foto)',
          hint = 'JPG, PNG ou WEBP — toque para câmera ou arquivo', max = multiple ? 6 : 1 } = opts;

  const uid = 'ev' + (++_seq);
  const items = [];   // { id, nome, dataUrl, type }

  host.innerHTML = `
    <div class="rna-evidence ${accent === 'crit' ? 'is-crit' : ''}" data-uid="${uid}">
      <div class="rna-evidence__drop" role="button" tabindex="0">
        <input type="file" class="rna-evidence__file" accept=".jpg,.jpeg,.png,.webp,image/*" ${multiple ? 'multiple' : ''} hidden>
        <input type="file" class="rna-evidence__cam"  accept="image/*" capture="environment" hidden>
        <div class="rna-evidence__icon"><i class="bi bi-camera"></i></div>
        <div class="rna-evidence__txt"><b>${label}</b><small>${hint}</small></div>
        <div class="rna-evidence__actions">
          <button type="button" class="rna-btn rna-btn-ghost rna-btn-sm js-pick"><i class="bi bi-folder2-open"></i> Arquivo</button>
          <button type="button" class="rna-btn rna-btn-dark rna-btn-sm js-cam"><i class="bi bi-camera-fill"></i> Câmera</button>
        </div>
      </div>
      <div class="rna-evidence__previews"></div>
    </div>`;

  const root = host.querySelector('.rna-evidence');
  const inputFile = root.querySelector('.rna-evidence__file');
  const inputCam  = root.querySelector('.rna-evidence__cam');
  const drop      = root.querySelector('.rna-evidence__drop');
  const previews  = root.querySelector('.rna-evidence__previews');

  const openFile = () => inputFile.click();
  const openCam  = () => inputCam.click();

  drop.addEventListener('click', (e) => { if (!e.target.closest('button')) openFile(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(); } });
  root.querySelector('.js-pick').addEventListener('click', openFile);
  root.querySelector('.js-cam').addEventListener('click', openCam);

  // arrastar e soltar (desktop)
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  inputFile.addEventListener('change', () => { handleFiles(inputFile.files); inputFile.value = ''; });
  inputCam.addEventListener('change',  () => { handleFiles(inputCam.files);  inputCam.value = ''; });

  async function handleFiles(fileList) {
    const files = [...fileList];
    for (const file of files) {
      if (!multiple && items.length >= 1) items.splice(0);   // substitui se for single
      if (items.length >= max) { toast(`Máximo de ${max} imagem(ns).`, { type: 'warn' }); break; }
      const item = await handleEvidenceFile(file);
      if (item) { items.push(item); renderPreviews(); toast('Imagem anexada com sucesso.', { type: 'ok', title: 'Evidência' }); }
    }
  }

  function renderPreviews() {
    previews.innerHTML = items.map(it => `
      <div class="rna-evidence__thumb" data-id="${it.id}">
        <img src="${it.dataUrl}" alt="${it.nome}">
        <button type="button" class="rna-evidence__rm" data-rm="${it.id}" title="Remover"><i class="bi bi-x-lg"></i></button>
        <span class="rna-evidence__name">${it.nome}</span>
      </div>`).join('');
    previews.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      const i = items.findIndex(x => x.id === b.dataset.rm);
      if (i >= 0) { items.splice(i, 1); renderPreviews(); }
    }));
    root.classList.toggle('has-files', items.length > 0);
  }

  let _committed = [];
  return {
    el: root,
    hasFiles: () => items.length > 0,
    count: () => items.length,
    clear: () => { items.splice(0); renderPreviews(); },
    first: () => _committed[0] || null,
    async commit(meta = {}) {
      _committed = [];
      if (!items.length) return [];
      const usuarioNome = meta.usuario?.nome || meta.usuario || 'Sistema';
      const usuarioId = meta.usuario?.id || null;
      const mirror = meta.mirror !== false;    // ver cabeçalho: espelho em `evidencias`
      const saved = [];
      for (const it of items) {
        /* uploadEvidenceToStorage já loga o erro cru e devolve AnexoError com a
           mensagem pronta — quem chama só propaga (o toast sai uma vez só, na
           camada de autosave da tela). */
        const caminho = typeof meta.path === 'function' ? meta.path(it) : meta.path;
        const up = await uploadEvidenceToStorage(it, { ...meta, path: caminho });
        const rec = {
          entidade: meta.registro_tipo || 'registro',
          entidade_id: meta.registro_id || null,
          nome: it.nome, url: up.url, tipo: it.type,
          dataHora: new Date().toISOString(),
          usuario: usuarioNome, created_by: usuarioId
        };
        try {
          await db.insert('evidencias', rec);
        } catch (err) {
          /* O arquivo JÁ está no Storage. Se o espelho é a única persistência,
             desfazemos o upload para não deixar objeto órfão e propagamos o erro.
             Se a tela tem tabela própria, apenas avisamos no console. */
          if (mirror) {
            await removeEvidenceFromStorage(up.path);
            logAnexo('falha ao gravar em `evidencias` (espelho obrigatório)', err, { payload: rec, tabela: 'evidencias' });
            throw new AnexoError(mensagemRegistro(err), err);
          }
          console.warn('[evidence] espelho em `evidencias` não gravado (não bloqueante):', err?.message || err);
        }
        saved.push({ registro_tipo: rec.entidade, registro_id: rec.entidade_id, ...rec, path: up.path, tamanho: it.tamanho ?? '' });
      }
      _committed = saved;
      return saved;
    }
  };
}

/* Valida + comprime um arquivo de imagem; retorna { id, nome, dataUrl, type } ou null. */
export async function handleEvidenceFile(file) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const tipoOk = TIPOS_OK.includes(file.type) || EXT_OK.includes(ext);
  if (!tipoOk) { toast('Formato inválido. Use JPG, PNG ou WEBP.', { type: 'warn', title: 'Evidência' }); return null; }
  if (file.size > MAX_MB * 1024 * 1024) { toast(`Imagem muito grande (máx. ${MAX_MB} MB).`, { type: 'warn' }); return null; }
  const id = 'i' + Math.random().toString(36).slice(2, 9);
  try {
    const dataUrl = await compressImage(file);
    // A compressão SEMPRE devolve JPEG: o nome guardado acompanha o conteúdo,
    // senão o arquivo sobe como "foto.png" contendo JPEG e alguns visualizadores
    // (e o próprio Storage, pelo allowed_mime_types) recusam.
    return { id, nome: renomearExt(file.name || 'foto', 'jpg'), dataUrl, type: 'image/jpeg', tamanho: String(file.size) };
  } catch {
    // fallback: lê sem comprimir. Se nem isso funcionar, o arquivo não pôde ser
    // lido do disco — erro com nome próprio, nunca "falha de conexão" depois.
    try {
      const dataUrl = await readAsDataURL(file);
      return { id, nome: file.name, dataUrl, type: file.type || 'image/jpeg', tamanho: String(file.size) };
    } catch (e) {
      logAnexo('não foi possível ler a imagem escolhida', e, { nome: file?.name, tamanho: file?.size });
      toast('Não foi possível ler esta imagem do seu computador. Se ela estiver no OneDrive/Google Drive como "somente online", abra-a uma vez para baixar e tente de novo.',
        { type: 'crit', title: 'Evidência', timeout: 10000 });
      return null;
    }
  }
}

/* ======================================================= ERRO DE ANEXO
   Erro já traduzido para o usuário, carregando o erro CRU para o console.
   `amigavel` avisa as camadas de cima que a mensagem já está pronta e NÃO deve
   ser reembrulhada — era daí que saía "O vínculo entre a auditoria e a peça não
   pôde ser salvo: ..." colado num erro de upload. */
export class AnexoError extends Error {
  constructor(mensagem, causa, tecnico) {
    super(mensagem);
    this.name = 'AnexoError';
    this.amigavel = true;
    this.causa = causa;
    this.tecnico = tecnico || detalheTecnico(causa);
  }
}

/** Assinatura técnica do erro cru: status, code, message, details, hint. */
export function detalheTecnico(e) {
  if (!e) return '';
  const partes = [
    e.status || e.statusCode ? `HTTP ${e.status || e.statusCode}` : '',
    e.code ? `code ${e.code}` : '',
    e.name && e.name !== 'Error' ? e.name : '',
    e.message || '',
    e.details || '', e.hint || ''
  ].filter(Boolean);
  return [...new Set(partes)].join(' · ');
}

/** Log completo e não-destrutivo do erro (ETAPA 4). Nunca JSON.stringify(erro). */
export function logAnexo(contexto, e, extra = {}) {
  console.error(`[anexo] ${contexto}`, {
    message: e?.message, name: e?.name, code: e?.code,
    status: e?.status ?? e?.statusCode, details: e?.details, hint: e?.hint,
    causa: e?.causa, ...extra
  });
}

/* Nome de arquivo seguro para o Storage: sem acento, espaço, barra, símbolo —
   e com a extensão preservada. "Relatório de Pintura (lote 9).pdf" vira
   "Relatorio-de-Pintura-lote-9.pdf". */
export function sanitizarNomeArquivo(nome, { max = 80 } = {}) {
  const bruto = String(nome || 'arquivo');
  const ponto = bruto.lastIndexOf('.');
  const ext = ponto > 0 ? bruto.slice(ponto + 1) : '';
  const base = (ponto > 0 ? bruto.slice(0, ponto) : bruto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, '-')                     // espaço, barra, símbolo → '-'
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  const extSafe = ext.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `${base || 'arquivo'}${extSafe ? '.' + extSafe : ''}`;
}

/* O Storage está alcançável? Um POST cross-origin que o servidor recusa SEM
   devolver cabeçalho CORS chega ao navegador como "Failed to fetch" — idêntico
   a estar sem internet. Antes de acusar a rede do usuário (que costuma estar
   boa), perguntamos ao próprio endpoint: se ele responde, o problema é a
   requisição, não a conexão. */
export async function storageAlcancavel() {
  if (!SUPABASE.enabled) return false;
  try {
    await fetch(`${SUPABASE.url}/storage/v1/object/public/${BUCKET}/__diag__`, { method: 'GET', cache: 'no-store' });
    return true;    // qualquer resposta HTTP (inclusive 400/404) prova alcance
  } catch { return false; }
}

export const BUCKET = 'evidencias';

/* Lê o arquivo para a memória ANTES de enviar.

   Motivo: passar o File direto ao fetch faz o navegador ler o disco durante a
   requisição — e se essa leitura falhar (arquivo do OneDrive/Drive marcado como
   "somente online", arquivo movido/renomeado/pendrive removido depois de
   escolhido), o fetch rejeita com "Failed to fetch", indistinguível de falha de
   rede. Lendo antes, o erro aparece onde de fato aconteceu, com nome próprio, e
   nenhuma requisição inútil é disparada. */
export async function materializarArquivo(file) {
  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) throw new Error('leitura devolveu 0 bytes');
    return new Blob([buf], { type: file.type || 'application/octet-stream' });
  } catch (e) {
    logAnexo('não foi possível ler o arquivo escolhido', e, { nome: file?.name, tamanho: file?.size, tipo: file?.type });
    throw new AnexoError(
      'Não foi possível ler o arquivo do seu computador. Se ele estiver no OneDrive/Google Drive como "somente online", ' +
      'abra-o uma vez para baixar e tente de novo. Se tiver sido movido ou renomeado depois de escolhido, selecione-o novamente.',
      e, `leitura local · ${file?.name || '?'} · ${file?.size ?? '?'} bytes`);
  }
}

/* ======================================================== DIAGNÓSTICO
   Roda o caminho inteiro e diz em qual degrau ele quebra. Exposto na tela como
   window.__rnaDiagAnexo() para suporte — sem precisar de build ou breakpoint. */
export async function diagnosticarAnexos(file = null) {
  const passo = {};
  passo['1. Storage alcançável'] = (await storageAlcancavel()) ? 'OK' : 'FALHOU';
  try {
    const sb = await getSupabase();
    const { data } = await sb.auth.getUser();
    passo['2. Sessão autenticada'] = data?.user ? `OK (${data.user.email || data.user.id})` : 'SEM SESSÃO';
  } catch (e) { passo['2. Sessão autenticada'] = 'ERRO · ' + (e?.message || e); }

  // Blob sintético: isola servidor+policies do arquivo do usuário.
  try {
    const sb = await getSupabase();
    const p = `diagnostico/${Date.now()}-probe.pdf`;
    const b = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' });
    const { error } = await sb.storage.from(BUCKET).upload(p, b, { contentType: 'application/pdf' });
    if (error) { passo['3. Upload de teste (5 bytes)'] = 'FALHOU · ' + detalheTecnico(error); }
    else { passo['3. Upload de teste (5 bytes)'] = 'OK'; await sb.storage.from(BUCKET).remove([p]); }
  } catch (e) { passo['3. Upload de teste (5 bytes)'] = 'EXCEÇÃO · ' + detalheTecnico(e); }

  if (file) {
    try { const b = await materializarArquivo(file); passo['4. Leitura do seu arquivo'] = `OK (${b.size} bytes)`; }
    catch (e) { passo['4. Leitura do seu arquivo'] = 'FALHOU · ' + (e?.tecnico || e?.message); }
  } else {
    passo['4. Leitura do seu arquivo'] = 'não testado (chame __rnaDiagAnexo(arquivo))';
  }
  console.table?.(Object.entries(passo).map(([etapa, resultado]) => ({ etapa, resultado })));
  return passo;
}

/* Envia ao Supabase Storage (se configurado) ou retorna Base64 (fallback local).
   `meta.path` permite ao chamador definir o caminho (ETAPA 8); sem ele usamos o
   layout genérico <tipo>/<id>/<timestamp>-<nome>. Devolve { url, path }. */
export async function uploadEvidenceToStorage(item, meta = {}) {
  if (!SUPABASE.enabled) return { url: item.dataUrl, path: null };   // fallback Base64 (demo)
  const sb = await getSupabase();
  const safe = sanitizarNomeArquivo(item.nome || 'foto');
  const path = meta.path || `${meta.registro_tipo || 'geral'}/${meta.registro_id || 'tmp'}/${Date.now()}-${safe}`;
  const blob = dataURLtoBlob(item.dataUrl);   // já está em memória (foi comprimida)
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) {
    logAnexo('upload recusado pelo Storage', error, { bucket: BUCKET, path, contentType: blob.type, bytes: blob.size });
    throw new AnexoError(await mensagemStorage(error), error);
  }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new AnexoError('O arquivo subiu, mas o Storage não devolveu a URL pública.', null, `path ${path}`);
  return { url: data.publicUrl, path };
}

/** Apaga um objeto do bucket. Usado só para desfazer upload órfão — nunca lança
    (a falha do rollback não pode mascarar o erro original que o motivou). */
export async function removeEvidenceFromStorage(path) {
  if (!path || !SUPABASE.enabled) return false;
  try {
    const sb = await getSupabase();
    const { error } = await sb.storage.from('evidencias').remove([path]);
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[evidence] arquivo órfão não removido do Storage:', path, e?.message || e);
    return false;
  }
}

/* Erro de upload traduzido para a causa REAL, sempre com o detalhe técnico
   anexado ao fim — o usuário lê a instrução, o administrador lê a assinatura do
   erro sem precisar do console.

   REGRA: "falha de conexão" só é dita quando o Storage está PROVADAMENTE
   inalcançável. Um POST recusado sem cabeçalho CORS produz "Failed to fetch" no
   navegador, e culpar a rede do usuário nesse caso manda todo mundo investigar
   o lado errado — foi exatamente o que aconteceu neste bug. */
export async function mensagemStorage(e) {
  const txt = `${e?.message || ''} ${typeof e?.error === 'string' ? e.error : ''} ${e?.details || ''}`.toLowerCase();
  const code = String(e?.code || '');
  const status = String(e?.status ?? e?.statusCode ?? '');
  const tec = detalheTecnico(e);
  const com = m => (tec ? `${m} [detalhe: ${tec}]` : m);

  if (/bucket not found|nosuchbucket/.test(txt) || code === 'NoSuchBucket')
    return com('O repositório de arquivos (bucket "evidencias") não existe no Supabase. Rode database/fix_anexos_pintura.sql.');
  if (/mime type|invalid_mime/.test(txt))
    return com('Formato de arquivo não permitido pelo repositório. Use JPG, PNG, WEBP ou PDF.');
  if (/payload too large|exceeded the maximum|maximum allowed size/.test(txt) || status === '413')
    return com(`O arquivo excede o limite de ${MAX_MB} MB.`);
  if (code === '42501' || status === '403' || /row-level security|violates row-level|permission denied|new row violates/.test(txt))
    return com('Seu usuário não possui permissão para enviar anexos nesta auditoria. Faltam as policies de INSERT do bucket "evidencias" (Storage → evidencias → Policies).');
  if (status === '401' || /jwt|invalid token|not authenticated/.test(txt))
    return com('A sessão do usuário expirou. Entre novamente e repita o envio.');
  if (/duplicate|already exists/.test(txt) || status === '409')
    return com('Já existe um arquivo com este nome no repositório. Tente novamente.');

  /* Falha em nível de fetch (StorageUnknownError · Failed to fetch).
     VERIFICADO neste projeto: o Storage devolve as recusas com cabeçalho CORS
     normal (um 415 de MIME chega ao navegador como JSON legível). Ou seja,
     "Failed to fetch" aqui NÃO é o servidor recusando — é a requisição que não
     chega a completar. As causas reais, nesta ordem de frequência:
       1. o arquivo não pôde ser lido do disco (OneDrive/Drive "somente online",
          arquivo movido/renomeado depois de escolhido, pendrive removido);
       2. extensão do navegador bloqueando a requisição;
       3. conexão interrompida no meio do envio. */
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/.test(txt)) {
    const online = await storageAlcancavel();
    return online
      ? com('O envio foi interrompido antes de chegar ao servidor (o servidor está acessível). Quase sempre é o arquivo que não pôde ser lido: se ele estiver no OneDrive/Google Drive como "somente online", abra-o uma vez para baixar e tente de novo. Outras causas: extensão do navegador bloqueando o envio, ou o arquivo movido/renomeado após ser escolhido.')
      : com('Não foi possível alcançar o servidor de arquivos. Verifique a conexão e tente novamente.');
  }
  return com('Não foi possível enviar o arquivo para o armazenamento.');
}

/* Erro ao GRAVAR O REGISTRO do anexo (o arquivo já subiu). Códigos do Postgres
   têm causa distinta e correção distinta — ETAPA 4/11. */
export function mensagemRegistro(e) {
  const code = String(e?.code || '');
  const txt = `${e?.message || ''} ${e?.details || ''} ${e?.hint || ''}`.toLowerCase();
  const tec = detalheTecnico(e);
  const com = m => (tec ? `${m} [detalhe: ${tec}]` : m);

  if (code === '23503' || /foreign key/.test(txt))
    return com('Não foi possível identificar a peça/característica vinculada a esta auditoria (chave estrangeira inválida). O arquivo foi enviado, mas o anexo não foi registrado.');
  if (code === '23505' || /duplicate key/.test(txt))
    return com('Este anexo já estava registrado.');
  if (code === '23502' || /not-null|null value in column/.test(txt))
    return com('O anexo não pôde ser registrado: um campo obrigatório chegou vazio. Veja o payload no console.');
  if (code === '42501' || /row-level security|violates row-level|permission denied/.test(txt))
    return com('Seu usuário não possui permissão para salvar anexos nesta auditoria (RLS).');
  if (code === 'PGRST116' || /contains 0 rows|multiple \(or no\) rows/.test(txt))
    return com('O registro do anexo não foi encontrado após a gravação — provável bloqueio de leitura por RLS.');
  if (['PGRST204', 'PGRST205', '42703', '42P01'].includes(code) || /could not find the .*column|does not exist|schema cache/.test(txt))
    return com('A tabela de anexos está desatualizada neste banco. Rode database/fix_anexos_pintura.sql no Supabase.');
  return com('O arquivo foi enviado, mas não foi possível registrar o anexo.');
}

/** Troca a extensão do nome do arquivo (mantendo o nome original legível). */
function renomearExt(nome, ext) {
  const base = String(nome).replace(/\.[^.]+$/, '');
  return `${base || 'foto'}.${ext}`;
}

/* ----------------------------------------------------------------- helpers */
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function compressImage(file) {
  const dataUrl = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  let { width: w, height: h } = img;
  if (w > MAX_DIM || h > MAX_DIM) { const r = Math.min(MAX_DIM / w, MAX_DIM / h); w = Math.round(w * r); h = Math.round(h * r); }
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', QUALITY);
}
function dataURLtoBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/jpeg'])[1];
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function _noop() { return { el: null, hasFiles: () => false, count: () => 0, clear() {}, first: () => null, async commit() { return []; } }; }
