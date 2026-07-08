-- =============================================================================
-- RNA One — DIAGNÓSTICO e correção do login de novos cadastros
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- Sintoma: após aprovar, o login do novo usuário retorna "E-mail ou senha
-- inválidos." (na verdade, quase sempre é "Email not confirmed" mascarado).
-- Nada aqui apaga dados nem mexe nos administradores antigos.
-- Onde colar: Supabase → SQL Editor → rode cada bloco e observe o resultado.
-- =============================================================================

-- 1) COMPARA Supabase Auth × tabela usuarios --------------------------------
--    Confira: auth_id preenchido e == a.id, e-mail igual/minúsculo,
--    email_confirmed_at NÃO nulo (se for nulo → confirmação de e-mail ligada).
select
  u.nome,
  u.email                       as usuarios_email,
  a.email                       as auth_email,
  u.auth_id                     as usuarios_auth_id,
  a.id                          as auth_id_real,
  (u.auth_id = a.id)            as auth_id_ok,
  a.email_confirmed_at          as confirmado_em,
  u.status, u.ativo
from usuarios u
left join auth.users a on lower(a.email) = lower(u.email)
order by u.created_at desc
limit 15;

-- INTERPRETAÇÃO:
--  • auth_id_real NULL  → o usuário NÃO existe no Supabase Auth (cadastro só
--    gravou em usuarios). Improvável no fluxo atual, mas se ocorrer o usuário
--    precisa se recadastrar por cadastro.html (que chama supabase.auth.signUp).
--  • confirmado_em NULL → confirmação de e-mail está LIGADA e bloqueia o login.
--    → Solução A (recomendada): Authentication > Providers > Email >
--      DESATIVAR "Confirm email".
--    → Solução B (confirmar só os já criados): rode o bloco 3 abaixo.
--  • auth_id_ok = false/null → rode o bloco 2 (backfill).

-- 2) BACKFILL do vínculo auth_id (idempotente, seguro) -----------------------
update usuarios u
set auth_id = a.id, updated_at = now()
from auth.users a
where lower(a.email) = lower(u.email)
  and (u.auth_id is null or u.auth_id <> a.id);

-- 3) (OPCIONAL) Confirmar e-mail dos usuários JÁ criados ---------------------
--    Use SOMENTE se você preferir manter "Confirm email" ligada mas liberar
--    quem já se cadastrou. Não afeta senha nem perfil.
-- update auth.users
-- set email_confirmed_at = coalesce(email_confirmed_at, now())
-- where email_confirmed_at is null;

-- 4) Normaliza e-mail em usuarios (minúsculo, sem espaços) -------------------
update usuarios set email = lower(trim(email))
where email <> lower(trim(email));
