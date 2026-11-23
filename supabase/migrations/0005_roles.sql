-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0005 : séparation des rôles
--
--  admin  : administration de l'agenda (comptes, rôles, invitations,
--           état des comptes) + tous les droits sur les tâches
--  dg     : tous les droits sur les tâches (créer, attribuer, modifier,
--           supprimer), PAS d'accès à l'administration des comptes
--  membre : inchangé
-- =====================================================================

-- Fonction d'aide : l'utilisateur connecté est-il administrateur actif ?
create or replace function public.est_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profils p
    where p.id = auth.uid() and p.actif and p.role = 'admin'
  );
$$;
grant execute on function public.est_admin() to authenticated, service_role;

-- Profils : chacun modifie le sien ; seul l'admin modifie ceux des autres
drop policy if exists "profils_modification" on public.profils;
create policy "profils_modification" on public.profils
  for update to authenticated
  using (id = auth.uid() or public.est_admin())
  with check (id = auth.uid() or public.est_admin());

-- Rôles et activation : réservés à l'administrateur
create or replace function public.proteger_profil()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_nb_admin integer;
begin
  new.modifie_le := now();

  -- Requêtes système (SQL Editor, fonctions Edge) : pas de contrôle applicatif
  if auth.uid() is null then
    return new;
  end if;

  if new.id <> old.id or new.email is distinct from old.email then
    raise exception 'Modification non autorisée de l''identifiant ou de l''email.';
  end if;

  if (new.role <> old.role or new.actif <> old.actif) then
    if not public.est_admin() then
      raise exception 'Seul l''administrateur peut changer un rôle ou désactiver un compte.';
    end if;
    if new.id = auth.uid() then
      raise exception 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte.';
    end if;
  end if;

  -- Il doit toujours rester au moins un administrateur actif
  if old.role = 'admin' and old.actif and (new.role <> 'admin' or new.actif = false) then
    select count(*) into v_nb_admin from public.profils
    where role = 'admin' and actif and id <> old.id;
    if v_nb_admin = 0 then
      raise exception 'Il doit rester au moins un administrateur actif.';
    end if;
  end if;

  return new;
end;
$$;

-- État des comptes : réservé à l'administrateur
create or replace function public.admin_comptes()
returns table (id uuid, email text, invite_le timestamptz, compte_active boolean, derniere_connexion timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.est_admin() then
    raise exception 'Réservé à l''administrateur.';
  end if;
  return query
    select u.id, u.email::text, coalesce(u.invited_at, u.created_at),
           (u.email_confirmed_at is not null and u.last_sign_in_at is not null),
           u.last_sign_in_at
    from auth.users u
    join public.profils p on p.id = u.id;
end;
$$;
revoke execute on function public.admin_comptes() from public, anon;
grant execute on function public.admin_comptes() to authenticated;

comment on column public.profils.role is 'admin = administrateur de l''agenda, dg = Directeur Général (tous droits sur les tâches), membre = personnel';
