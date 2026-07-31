-- =============================================================================
-- RNA One — Inspeção Após Pintura (Meus Relatórios Dimensionais)
-- Rassini NHK Automotive · PostgreSQL / Supabase · Idempotente
-- -----------------------------------------------------------------------------
-- Nova etapa do fluxo de inspeção dimensional:
--   Tipo e peça → Identificação → Amostras → Medições →
--   INSPEÇÃO APÓS PINTURA → Revisão → Resultado
--
-- Regra: toda característica cujo EQUIPAMENTO cadastrado na Biblioteca Técnica é
-- "Visual" sai da etapa Medições e é respondida como OK/NOK na nova etapa. Isso
-- é 100% de aplicação (services/inspecao.js → ehCaracteristicaVisual) — nenhuma
-- característica é excluída ou duplicada no banco.
--
-- O que ESTE script precisa criar:
--   • a coluna `relatorio_pintura` (jsonb) em insp_relatorios, onde fica o anexo
--     único "Relatório de Pintura" do relatório ({nome, tipo, url, tamanho, ...}).
--
-- O que NÃO precisa de migration:
--   • a resposta OK/NOK de cada característica visual é UMA linha em insp_medicoes
--     na amostra 0 (AMOSTRA_VISUAL). A coluna `amostra int` já aceita 0 e a UNIQUE
--     (caracteristica_id, amostra) já garante uma resposta por característica.
--   • as evidências das características visuais reusam insp_anexos (caracteristica_id).
--   • as políticas RLS de insp_relatorios / insp_medicoes / insp_anexos já cobrem
--     estas colunas (são políticas de linha, não de coluna) — nada a alterar.
--
-- Execute no SQL Editor do Supabase APÓS auditorias_dimensional.sql.
-- =============================================================================

-- Anexo único do Relatório de Pintura, guardado no próprio relatório.
alter table insp_relatorios
  add column if not exists relatorio_pintura jsonb;

comment on column insp_relatorios.relatorio_pintura is
  'Inspeção Após Pintura: anexo único do Relatório de Pintura (PDF/JPG/JPEG/PNG). '
  'Estrutura: {nome, tipo, url, tamanho, uploaded_by, uploaded_nome, created_at}. '
  'null quando ainda não anexado.';

-- (Opcional) Storage: os anexos de pintura vão para o bucket "evidencias" já
-- usado pelas evidências fotográficas (services/evidence.js). Nenhum bucket novo
-- é necessário; garanta apenas que o bucket "evidencias" exista e aceite PDF.
