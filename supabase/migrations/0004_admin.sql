-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0004 : page Administration
--  État des comptes (invitation acceptée, dernière connexion),
--  réservé au DG et aux administrateurs.
--  À exécuter dans Supabase > SQL Editor (après 0001 à 0003).
-- =====================================================================

create or replace function public.admin_comptes()
returns table (
  id                  uuid,
  email               text,
  invite_le           timestamptz,
  compte_active       boolean,
  derniere_connexion  timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.est_gestionnaire() then
    raise exception 'Réservé au DG et aux administrateurs.';
  end if;
  return query
    select u.id,
           u.email::text,
           coalesce(u.invited_at, u.created_at),
           (u.email_confirmed_at is not null and u.last_sign_in_at is not null),
           u.last_sign_in_at
    from auth.users u
    join public.profils p on p.id = u.id;
end;
$$;

revoke execute on function public.admin_comptes() from public, anon;
grant execute on function public.admin_comptes() to authenticated;
