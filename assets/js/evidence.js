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
        let up;
        try {
          up = await uploadEvidenceToStorage(it, meta);
        } catch (err) {
          console.error('[evidence] falha no upload ao Storage', err);
          toast(mensagemStorage(err), { type: 'crit', title: 'Erro no upload', timeout: 9000 });
          throw err;
        }
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
            console.error('[evidence] falha ao gravar em `evidencias`', err);
            toast(mensagemStorage(err), { type: 'crit', title: 'Erro ao salvar evidência', timeout: 9000 });
            throw err;
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
    // fallback: lê sem comprimir
    const dataUrl = await readAsDataURL(file);
    return { id, nome: file.name, dataUrl, type: file.type || 'image/jpeg', tamanho: String(file.size) };
  }
}

/* Envia ao Supabase Storage (se configurado) ou retorna Base64 (fallback local).
   Devolve { url, path } — `path` é o caminho no bucket, necessário para apagar
   o objeto caso a gravação no banco falhe depois do upload (sem órfãos). */
export async function uploadEvidenceToStorage(item, meta = {}) {
  if (!SUPABASE.enabled) return { url: item.dataUrl, path: null };   // fallback Base64 (demo)
  const sb = await getSupabase();
  const safe = (item.nome || 'foto').replace(/[^\w.\-]+/g, '_');
  const path = `${meta.registro_tipo || 'geral'}/${meta.registro_id || 'tmp'}/${Date.now()}_${safe}`;
  const blob = dataURLtoBlob(item.dataUrl);
  const { error } = await sb.storage.from('evidencias').upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from('evidencias').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('O Storage não devolveu a URL pública do arquivo enviado.');
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

/* Erro de upload traduzido para a causa REAL. "Tente novamente" para tudo faz o
   administrador perder horas: bucket inexistente, MIME barrado e RLS têm cada um
   a sua correção — e todas passam por database/fix_anexos_pintura.sql. */
export function mensagemStorage(e) {
  const txt = `${e?.message || ''} ${e?.error || ''} ${e?.details || ''}`.toLowerCase();
  const code = String(e?.code || e?.statusCode || '');
  if (/bucket not found|nosuchbucket/.test(txt) || code === 'NoSuchBucket')
    return 'O repositório de arquivos (bucket "evidencias") não existe no Supabase. Rode database/fix_anexos_pintura.sql — nenhum anexo pode ser salvo até lá.';
  if (/mime type|invalid_mime|not supported/.test(txt))
    return 'O tipo deste arquivo não é aceito pelo repositório de arquivos. Use JPG, PNG, WEBP ou PDF.';
  if (/payload too large|exceeded the maximum|file size/.test(txt) || code === '413')
    return 'Arquivo maior que o limite do repositório de arquivos. Reduza o tamanho e tente novamente.';
  if (code === '42501' || /row-level security|violates row-level|permission denied|unauthorized|new row violates/.test(txt))
    return 'Você não tem permissão para enviar arquivos neste relatório. Fale com o administrador (policies do bucket "evidencias").';
  if (/failed to fetch|networkerror|load failed|timeout/.test(txt))
    return 'Não foi possível enviar o arquivo: falha de conexão. Verifique a rede e tente novamente.';
  if (/duplicate|already exists/.test(txt))
    return 'Já existe um arquivo com este nome. Tente novamente.';
  return `Erro ao enviar arquivo${e?.message ? ': ' + e.message : '.'}`;
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
