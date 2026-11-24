-- =================================================================
--  AGENDA CRF PERFECTION — INSTALLATION COMPLÈTE (à coller en une fois)
--  Contient : migrations 0001 à 0007
--  Ensuite, à part et dans l'ordre : 0008_planification.sql puis 0009_emails_accuses.sql
-- =================================================================


-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0001 : schéma de la base
--  À exécuter dans Supabase > SQL Editor (ou via la CLI Supabase),
--  AVANT 0002_rls.sql puis 0003_rappels.sql.
--  Fuseau de référence : Africa/Porto-Novo (UTC+1, sans heure d'été)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  Fonction utilitaire : date du jour à Porto-Novo
-- ---------------------------------------------------------------------
create or replace function public.aujourdhui_porto_novo()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Porto-Novo')::date;
$$;

-- ---------------------------------------------------------------------
--  Table PROFILS (1 ligne par compte, liée à auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profils (
  id           uuid primary key references auth.users (id) on delete cascade,
  nom_complet  text not null default '',
  email        text,
  role         text not null default 'membre' check (role in ('dg', 'admin', 'membre')),
  poste        text,
  telephone    text,
  actif        boolean not null default true,
  cree_le      timestamptz not null default now(),
  modifie_le   timestamptz not null default now()
);

comment on table public.profils is 'Personnel de CRF Perfection (un profil par compte).';
comment on column public.profils.role is 'dg = Directeur Général, admin = administrateur, membre = personnel';

-- ---------------------------------------------------------------------
--  Table TACHES
-- ---------------------------------------------------------------------
create sequence if not exists public.taches_numero_seq;

create table if not exists public.taches (
  id             uuid primary key default gen_random_uuid(),
  numero         integer not null unique default nextval('public.taches_numero_seq'),
  intitule       text not null check (length(btrim(intitule)) > 0),
  description    text,
  date_creation  date not null default public.aujourdhui_porto_novo(),
  echeance       date,
  statut         text not null default 'a_faire'
                   check (statut in ('a_faire', 'en_cours', 'termine', 'bloque')),
  priorite       text not null default 'normale' check (priorite in ('normale', 'haute')),
  cree_par       uuid default auth.uid() references public.profils (id) on delete set null,
  date_terminee  date,
  cree_le        timestamptz not null default now(),
  modifie_le     timestamptz not null default now()
);

alter sequence public.taches_numero_seq owned by public.taches.numero;

create index if not exists taches_echeance_idx on public.taches (echeance);
create index if not exists taches_statut_idx   on public.taches (statut);
create index if not exists taches_cree_par_idx on public.taches (cree_par);

comment on column public.taches.numero is 'Numéro lisible affiché « N° 1, 2, 3… » (auto-incrémenté).';

-- ---------------------------------------------------------------------
--  Table ATTRIBUTIONS (plusieurs attributaires par tâche)
-- ---------------------------------------------------------------------
create table if not exists public.attributions (
  tache_id      uuid not null references public.taches (id) on delete cascade,
  profil_id     uuid not null references public.profils (id) on delete cascade,
  attribue_le   timestamptz not null default now(),
  attribue_par  uuid default auth.uid() references public.profils (id) on delete set null,
  primary key (tache_id, profil_id)
);

create index if not exists attributions_profil_idx on public.attributions (profil_id);

-- ---------------------------------------------------------------------
--  Table COMMENTAIRES
-- ---------------------------------------------------------------------
create table if not exists public.commentaires (
  id         uuid primary key default gen_random_uuid(),
  tache_id   uuid not null references public.taches (id) on delete cascade,
  auteur_id  uuid default auth.uid() references public.profils (id) on delete set null,
  texte      text not null check (length(btrim(texte)) > 0),
  date       timestamptz not null default now()
);

create index if not exists commentaires_tache_idx on public.commentaires (tache_id, date);

-- ---------------------------------------------------------------------
--  Table HISTORIQUE (trace des changements : qui, quand, avant/après)
-- ---------------------------------------------------------------------
create table if not exists public.historique (
  id               bigint generated always as identity primary key,
  tache_id         uuid not null references public.taches (id) on delete cascade,
  auteur_id        uuid references public.profils (id) on delete set null,
  date             timestamptz not null default now(),
  champ            text not null check (champ in ('creation', 'statut', 'echeance', 'attribution')),
  ancienne_valeur  text,
  nouvelle_valeur  text
);

create index if not exists historique_tache_idx on public.historique (tache_id, date);

-- =====================================================================
--  FONCTIONS D'AIDE AUX DROITS (utilisées par les politiques RLS)
--  « security definer » : elles lisent les tables sans déclencher la RLS
--  (évite les boucles infinies de politiques).
-- =====================================================================
create or replace function public.est_actif()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profils p where p.id = auth.uid() and p.actif);
$$;

create or replace function public.est_gestionnaire()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profils p
    where p.id = auth.uid() and p.actif and p.role in ('dg', 'admin')
  );
$$;

create or replace function public.est_dg()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profils p
    where p.id = auth.uid() and p.actif and p.role = 'dg'
  );
$$;

create or replace function public.est_attribue(p_tache uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attributions a
    where a.tache_id = p_tache and a.profil_id = auth.uid()
  );
$$;

create or replace function public.est_createur(p_tache uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.taches t
    where t.id = p_tache and t.cree_par = auth.uid()
  );
$$;

-- =====================================================================
--  TRIGGERS
-- =====================================================================

-- 1) Création automatique du profil lorsqu'un compte est créé / invité.
--    Le rôle est TOUJOURS « membre » à la création ; il est ensuite fixé
--    par le DG/admin (fonction admin-membres) ou en SQL pour le premier DG.
create or replace function public.creer_profil_nouvel_utilisateur()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profils (id, email, nom_complet)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nom_complet'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists sur_creation_utilisateur on auth.users;
create trigger sur_creation_utilisateur
  after insert on auth.users
  for each row execute function public.creer_profil_nouvel_utilisateur();

-- 2) Protection des profils : seul DG/admin change rôle / activation ;
--    seul le DG nomme ou retire un DG ; on ne peut pas retirer le dernier DG actif.
create or replace function public.proteger_profil()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_nb_dg integer;
begin
  new.modifie_le := now();

  -- Requêtes système (SQL Editor, clé service_role) : pas de contrôle applicatif
  if auth.uid() is null then
    return new;
  end if;

  if new.id <> old.id or new.email is distinct from old.email then
    raise exception 'Modification non autorisée de l''identifiant ou de l''email.';
  end if;

  if (new.role <> old.role or new.actif <> old.actif) then
    if not public.est_gestionnaire() then
      raise exception 'Seuls le DG et les administrateurs peuvent changer un rôle ou désactiver un compte.';
    end if;
    if (old.role = 'dg' or new.role = 'dg') and new.role <> old.role and not public.est_dg() then
      raise exception 'Seul le DG peut nommer ou retirer un DG.';
    end if;
    if new.id = auth.uid() and new.actif = false then
      raise exception 'Vous ne pouvez pas désactiver votre propre compte.';
    end if;
    if old.role = 'dg' and (new.role <> 'dg' or new.actif = false) then
      select count(*) into v_nb_dg from public.profils
      where role = 'dg' and actif and id <> old.id;
      if v_nb_dg = 0 then
        raise exception 'Il doit rester au moins un DG actif.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists avant_maj_profil on public.profils;
create trigger avant_maj_profil
  before update on public.profils
  for each row execute function public.proteger_profil();

-- 3) Règles métier des tâches (avant écriture)
--    - date_terminee renseignée automatiquement
--    - un membre ne peut modifier QUE le statut d'une tâche qui lui est attribuée
--      (il peut tout modifier sur une tâche qu'il a lui-même créée, sauf N° et créateur)
create or replace function public.regles_tache()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.modifie_le := now();

  if new.statut = 'termine' then
    if tg_op = 'INSERT' or old.statut <> 'termine' then
      new.date_terminee := coalesce(new.date_terminee, public.aujourdhui_porto_novo());
    end if;
  else
    new.date_terminee := null;
  end if;

  if auth.uid() is null or public.est_gestionnaire() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.cree_par := auth.uid();
    return new;
  end if;

  -- UPDATE par un membre
  if new.numero <> old.numero or new.cree_par is distinct from old.cree_par
     or new.date_creation <> old.date_creation then
    raise exception 'Le numéro, la date de création et le créateur ne peuvent pas être modifiés.';
  end if;

  if old.cree_par is distinct from auth.uid() then
    if new.intitule is distinct from old.intitule
       or new.description is distinct from old.description
       or new.echeance is distinct from old.echeance
       or new.priorite is distinct from old.priorite then
      raise exception 'Sur une tâche qui vous est attribuée, seul le statut peut être modifié.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists avant_ecriture_tache on public.taches;
create trigger avant_ecriture_tache
  before insert or update on public.taches
  for each row execute function public.regles_tache();

-- 4) Historique automatique (création, statut, échéance)
create or replace function public.historiser_tache()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.historique (tache_id, auteur_id, champ, nouvelle_valeur)
    values (new.id, auth.uid(), 'creation', new.statut);
    return new;
  end if;

  if new.statut is distinct from old.statut then
    insert into public.historique (tache_id, auteur_id, champ, ancienne_valeur, nouvelle_valeur)
    values (new.id, auth.uid(), 'statut', old.statut, new.statut);
  end if;

  if new.echeance is distinct from old.echeance then
    insert into public.historique (tache_id, auteur_id, champ, ancienne_valeur, nouvelle_valeur)
    values (new.id, auth.uid(), 'echeance', old.echeance::text, new.echeance::text);
  end if;

  return new;
end;
$$;

drop trigger if exists apres_ecriture_tache on public.taches;
create trigger apres_ecriture_tache
  after insert or update on public.taches
  for each row execute function public.historiser_tache();

-- 5) Historique des attributions (ajout / retrait d'un attributaire)
create or replace function public.historiser_attribution()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_nom text;
begin
  if tg_op = 'INSERT' then
    select nom_complet into v_nom from public.profils where id = new.profil_id;
    insert into public.historique (tache_id, auteur_id, champ, nouvelle_valeur)
    values (new.tache_id, auth.uid(), 'attribution', v_nom);
    return new;
  else
    -- la tâche peut être en cours de suppression (cascade) : on ignore alors
    if exists (select 1 from public.taches where id = old.tache_id) then
      select nom_complet into v_nom from public.profils where id = old.profil_id;
      insert into public.historique (tache_id, auteur_id, champ, ancienne_valeur)
      values (old.tache_id, auth.uid(), 'attribution', v_nom);
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists apres_ecriture_attribution on public.attributions;
create trigger apres_ecriture_attribution
  after insert or delete on public.attributions
  for each row execute function public.historiser_attribution();

-- 6) Numérotation : si des N° sont fournis explicitement (import),
--    la séquence est recalée pour que la prochaine tâche suive le plus grand N°.
create or replace function public.recaler_numerotation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_dernier bigint;
  v_appele boolean;
begin
  select max(numero) into v_max from public.taches;
  select last_value, is_called into v_dernier, v_appele from public.taches_numero_seq;
  if v_max is not null and (v_max > v_dernier or (v_max = v_dernier and not v_appele)) then
    perform setval('public.taches_numero_seq', v_max, true);
  end if;
  return null;
end;
$$;

drop trigger if exists apres_insertion_taches on public.taches;
create trigger apres_insertion_taches
  after insert on public.taches
  for each statement execute function public.recaler_numerotation();

-- =====================================================================
--  DROITS DE BASE (la RLS de 0002_rls.sql affine ensuite ligne par ligne)
-- =====================================================================
revoke all on public.profils, public.taches, public.attributions,
              public.commentaires, public.historique from anon;

grant select, update on public.profils to authenticated;
grant select, insert, update, delete on public.taches to authenticated;
grant select, insert, delete on public.attributions to authenticated;
grant select, insert, update, delete on public.commentaires to authenticated;
grant select on public.historique to authenticated;
grant usage, select on sequence public.taches_numero_seq to authenticated;

-- Rôle serveur (fonctions Edge) : les projets Supabase récents ne lui donnent plus
-- de droits automatiquement sur les nouvelles tables.
grant usage on schema public to service_role;
grant all on public.profils, public.taches, public.attributions,
             public.commentaires, public.historique to service_role;
grant all on sequence public.taches_numero_seq to service_role;
grant usage on sequence public.historique_id_seq to service_role;

grant execute on function public.est_actif(), public.est_gestionnaire(), public.est_dg(),
  public.est_attribue(uuid), public.est_createur(uuid), public.aujourdhui_porto_novo()
  to authenticated;


-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0002 : sécurité (Row Level Security)
--
--  DG et admin : accès total (voir, créer, modifier, supprimer, assigner).
--  Membre      : voit toutes les tâches de l'équipe ;
--                modifie le statut et commente les tâches qui lui sont attribuées ;
--                crée ses propres tâches (et peut les modifier / les attribuer).
--  Compte désactivé : plus aucun accès aux données.
-- =====================================================================

alter table public.profils      enable row level security;
alter table public.taches       enable row level security;
alter table public.attributions enable row level security;
alter table public.commentaires enable row level security;
alter table public.historique   enable row level security;

-- ------------------------------- PROFILS -------------------------------
drop policy if exists "profils_lecture" on public.profils;
create policy "profils_lecture" on public.profils
  for select to authenticated
  using (id = auth.uid() or public.est_actif());

drop policy if exists "profils_modification" on public.profils;
create policy "profils_modification" on public.profils
  for update to authenticated
  using (id = auth.uid() or public.est_gestionnaire())
  with check (id = auth.uid() or public.est_gestionnaire());
-- (Le trigger proteger_profil empêche un membre de changer son rôle ou son statut actif.)
-- Pas d'INSERT/DELETE : les profils naissent avec le compte (invitation) et sont désactivés, pas supprimés.

-- ------------------------------- TACHES --------------------------------
drop policy if exists "taches_lecture" on public.taches;
create policy "taches_lecture" on public.taches
  for select to authenticated
  using (public.est_actif());

drop policy if exists "taches_creation" on public.taches;
create policy "taches_creation" on public.taches
  for insert to authenticated
  with check (
    public.est_gestionnaire()
    or (public.est_actif() and cree_par = auth.uid())
  );

drop policy if exists "taches_modification" on public.taches;
create policy "taches_modification" on public.taches
  for update to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and (cree_par = auth.uid() or public.est_attribue(id)))
  )
  with check (
    public.est_gestionnaire()
    or (public.est_actif() and (cree_par = auth.uid() or public.est_attribue(id)))
  );
-- (Le trigger regles_tache limite un membre attributaire au seul changement de statut.)

drop policy if exists "taches_suppression" on public.taches;
create policy "taches_suppression" on public.taches
  for delete to authenticated
  using (public.est_gestionnaire());

-- ----------------------------- ATTRIBUTIONS ----------------------------
drop policy if exists "attributions_lecture" on public.attributions;
create policy "attributions_lecture" on public.attributions
  for select to authenticated
  using (public.est_actif());

drop policy if exists "attributions_ajout" on public.attributions;
create policy "attributions_ajout" on public.attributions
  for insert to authenticated
  with check (
    public.est_gestionnaire()
    or (public.est_actif() and public.est_createur(tache_id))
  );

drop policy if exists "attributions_retrait" on public.attributions;
create policy "attributions_retrait" on public.attributions
  for delete to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and public.est_createur(tache_id))
  );

-- ----------------------------- COMMENTAIRES ----------------------------
drop policy if exists "commentaires_lecture" on public.commentaires;
create policy "commentaires_lecture" on public.commentaires
  for select to authenticated
  using (public.est_actif());

drop policy if exists "commentaires_ajout" on public.commentaires;
create policy "commentaires_ajout" on public.commentaires
  for insert to authenticated
  with check (
    auteur_id = auth.uid()
    and (
      public.est_gestionnaire()
      or (public.est_actif() and (public.est_attribue(tache_id) or public.est_createur(tache_id)))
    )
  );

drop policy if exists "commentaires_modification" on public.commentaires;
create policy "commentaires_modification" on public.commentaires
  for update to authenticated
  using (auteur_id = auth.uid() and public.est_actif())
  with check (auteur_id = auth.uid());

drop policy if exists "commentaires_suppression" on public.commentaires;
create policy "commentaires_suppression" on public.commentaires
  for delete to authenticated
  using ((auteur_id = auth.uid() and public.est_actif()) or public.est_gestionnaire());

-- ------------------------------ HISTORIQUE -----------------------------
-- Lecture seule : l'historique est écrit uniquement par les triggers.
drop policy if exists "historique_lecture" on public.historique;
create policy "historique_lecture" on public.historique
  for select to authenticated
  using (public.est_actif());


-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0003 : architecture des RAPPELS
--  (notifications « échéance dans 48 h » et « tâche échue »)
--
--  ⚠ PRÉPARÉ MAIS NON ACTIVÉ : aucune notification n'est envoyée tant que
--    la planification (pg_cron, en bas de fichier) n'est pas activée et que
--    la fonction Edge « rappels-echeances » n'a pas RAPPELS_ACTIFS=true.
-- =====================================================================

-- Préférences de chaque membre
create table if not exists public.preferences_rappels (
  profil_id     uuid primary key references public.profils (id) on delete cascade,
  echeance_48h  boolean not null default true,
  tache_echue   boolean not null default true,
  canal         text not null default 'push' check (canal in ('push', 'email', 'aucun')),
  modifie_le    timestamptz not null default now()
);

-- Abonnements « Web Push » (un par appareil / navigateur)
create table if not exists public.abonnements_push (
  id          uuid primary key default gen_random_uuid(),
  profil_id   uuid not null default auth.uid() references public.profils (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  appareil    text,
  cree_le     timestamptz not null default now()
);

-- Journal des rappels envoyés (évite les doublons)
create table if not exists public.journal_rappels (
  id         bigint generated always as identity primary key,
  tache_id   uuid not null references public.taches (id) on delete cascade,
  profil_id  uuid not null references public.profils (id) on delete cascade,
  type       text not null check (type in ('echeance_48h', 'echue')),
  envoye_le  timestamptz not null default now(),
  unique (tache_id, profil_id, type)
);

alter table public.preferences_rappels enable row level security;
alter table public.abonnements_push    enable row level security;
alter table public.journal_rappels     enable row level security;

revoke all on public.preferences_rappels, public.abonnements_push, public.journal_rappels from anon;
grant select, insert, update on public.preferences_rappels to authenticated;
grant select, insert, delete on public.abonnements_push to authenticated;
grant select on public.journal_rappels to authenticated;

drop policy if exists "prefs_les_miennes" on public.preferences_rappels;
create policy "prefs_les_miennes" on public.preferences_rappels
  for all to authenticated
  using (profil_id = auth.uid()) with check (profil_id = auth.uid());

drop policy if exists "push_les_miens" on public.abonnements_push;
create policy "push_les_miens" on public.abonnements_push
  for all to authenticated
  using (profil_id = auth.uid()) with check (profil_id = auth.uid());

drop policy if exists "journal_les_miens" on public.journal_rappels;
create policy "journal_les_miens" on public.journal_rappels
  for select to authenticated
  using (profil_id = auth.uid() or public.est_gestionnaire());

-- Liste des rappels à envoyer maintenant (utilisée par la fonction Edge)
create or replace function public.rappels_a_envoyer()
returns table (
  tache_id uuid, numero integer, intitule text, echeance date,
  profil_id uuid, nom_complet text, type text
)
language sql stable security definer
set search_path = ''
as $$
  with candidats as (
    select t.id as tache_id, t.numero, t.intitule, t.echeance, a.profil_id,
           case
             when t.echeance < public.aujourdhui_porto_novo() then 'echue'
             else 'echeance_48h'
           end as type
    from public.taches t
    join public.attributions a on a.tache_id = t.id
    join public.profils p on p.id = a.profil_id and p.actif
    where t.statut <> 'termine'
      and t.echeance is not null
      and t.echeance <= public.aujourdhui_porto_novo() + 2
  )
  select c.tache_id, c.numero, c.intitule, c.echeance, c.profil_id, p.nom_complet, c.type
  from candidats c
  join public.profils p on p.id = c.profil_id
  left join public.preferences_rappels pr on pr.profil_id = c.profil_id
  where not exists (
          select 1 from public.journal_rappels j
          where j.tache_id = c.tache_id and j.profil_id = c.profil_id and j.type = c.type
        )
    and coalesce(pr.canal, 'push') <> 'aucun'
    and (
      (c.type = 'echue' and coalesce(pr.tache_echue, true))
      or (c.type = 'echeance_48h' and coalesce(pr.echeance_48h, true))
    );
$$;

revoke execute on function public.rappels_a_envoyer() from public, anon, authenticated;
grant execute on function public.rappels_a_envoyer() to service_role;
grant all on public.preferences_rappels, public.abonnements_push, public.journal_rappels to service_role;

-- ---------------------------------------------------------------------
--  ACTIVATION FUTURE (laisser commenté pour l'instant)
--  1) Database > Extensions : activer « pg_cron » et « pg_net »
--  2) Déployer la fonction Edge : supabase functions deploy rappels-echeances
--  3) Décommenter et adapter (URL du projet + clé service_role stockée dans Vault)
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'rappels-echeances-quotidiens',
--   '0 7 * * *',   -- tous les jours à 07:00 UTC = 08:00 à Porto-Novo
--   $$
--   select net.http_post(
--     url     := 'https://VOTRE-PROJET.supabase.co/functions/v1/rappels-echeances',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );


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


-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0006
--  1) Visibilité : DG et administrateur voient toutes les tâches ;
--     un membre ne voit que SES tâches (attribuées à lui ou créées par lui)
--  2) Notifications dans l'application quand quelqu'un vous confie une tâche
-- =====================================================================

-- ---------------------------- 1) VISIBILITÉ ----------------------------
drop policy if exists "taches_lecture" on public.taches;
create policy "taches_lecture" on public.taches
  for select to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and (cree_par = auth.uid() or public.est_attribue(id)))
  );

drop policy if exists "attributions_lecture" on public.attributions;
create policy "attributions_lecture" on public.attributions
  for select to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and (profil_id = auth.uid() or public.est_attribue(tache_id) or public.est_createur(tache_id)))
  );

drop policy if exists "commentaires_lecture" on public.commentaires;
create policy "commentaires_lecture" on public.commentaires
  for select to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and (public.est_attribue(tache_id) or public.est_createur(tache_id)))
  );

drop policy if exists "historique_lecture" on public.historique;
create policy "historique_lecture" on public.historique
  for select to authenticated
  using (
    public.est_gestionnaire()
    or (public.est_actif() and (public.est_attribue(tache_id) or public.est_createur(tache_id)))
  );

-- -------------------------- 2) NOTIFICATIONS ---------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  profil_id  uuid not null references public.profils (id) on delete cascade,
  tache_id   uuid references public.taches (id) on delete cascade,
  type       text not null default 'attribution' check (type in ('attribution')),
  auteur_id  uuid references public.profils (id) on delete set null,
  lu         boolean not null default false,
  cree_le    timestamptz not null default now()
);
create index if not exists notifications_profil_idx on public.notifications (profil_id, lu, cree_le desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

drop policy if exists "notifications_les_miennes" on public.notifications;
create policy "notifications_les_miennes" on public.notifications
  for select to authenticated using (profil_id = auth.uid());
drop policy if exists "notifications_marquer_lu" on public.notifications;
create policy "notifications_marquer_lu" on public.notifications
  for update to authenticated using (profil_id = auth.uid()) with check (profil_id = auth.uid());
drop policy if exists "notifications_effacer" on public.notifications;
create policy "notifications_effacer" on public.notifications
  for delete to authenticated using (profil_id = auth.uid());

-- Une notification est créée quand QUELQU'UN D'AUTRE vous attribue une tâche
create or replace function public.notifier_attribution()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.attribue_par is not null and new.attribue_par <> new.profil_id then
    insert into public.notifications (profil_id, tache_id, type, auteur_id)
    values (new.profil_id, new.tache_id, 'attribution', new.attribue_par);
  end if;
  return new;
end;
$$;

drop trigger if exists apres_attribution_notifier on public.attributions;
create trigger apres_attribution_notifier
  after insert on public.attributions
  for each row execute function public.notifier_attribution();


-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0007 : améliorations
--
--   1. Notifications étendues : statut (terminée / bloquée), commentaires,
--      rappels (48 h, échue), demandes de report et réponses
--   2. Demandes de report d'échéance (membre → DG / admin)
--   3. Projets (catégories de tâches)
--   4. Étapes (checklist) dans une tâche
--   5. Pièces jointes (stockage Supabase, dossier privé)
--   6. Tâches récurrentes (chaque semaine / chaque mois)
--   7. Rappels automatiques et journal des envois (récap, sauvegarde)
--
--  À exécuter dans Supabase > SQL Editor, après 0001 à 0006.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Fonction d'aide : l'utilisateur peut-il voir / contribuer à la tâche ?
--  (DG, admin, attributaire ou créateur)
-- ---------------------------------------------------------------------
create or replace function public.peut_voir_tache(p_tache uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.est_gestionnaire()
      or (public.est_actif() and (public.est_attribue(p_tache) or public.est_createur(p_tache)));
$$;

-- Variante tolérante pour les chemins de fichiers (« <uuid>/<nom> »)
create or replace function public.peut_voir_tache_texte(p_tache text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return public.peut_voir_tache(p_tache::uuid);
exception when others then
  return false;
end;
$$;
grant execute on function public.peut_voir_tache(uuid), public.peut_voir_tache_texte(text) to authenticated, service_role;

-- =====================================================================
--  1. NOTIFICATIONS ÉTENDUES
-- =====================================================================
alter table public.notifications add column if not exists details jsonb;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('attribution', 'statut', 'commentaire', 'rappel_48h', 'rappel_echue', 'report_demande', 'report_reponse'));

-- Destinataires « direction » : DG actifs
create or replace function public.ids_dg_actifs()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.profils where role = 'dg' and actif;
$$;

-- a) Tâche terminée ou bloquée → le DG et le créateur sont prévenus
create or replace function public.notifier_statut()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.statut is not distinct from old.statut
     or new.statut not in ('termine', 'bloque') then
    return new;
  end if;
  insert into public.notifications (profil_id, tache_id, type, auteur_id, details)
  select distinct d.id, new.id, 'statut', auth.uid(), jsonb_build_object('statut', new.statut)
  from (
    select public.ids_dg_actifs() as id
    union
    select p.id from public.profils p where p.id = new.cree_par and p.actif
  ) d
  where d.id is not null and d.id <> auth.uid();
  return new;
end;
$$;

drop trigger if exists apres_statut_notifier on public.taches;
create trigger apres_statut_notifier
  after update of statut on public.taches
  for each row execute function public.notifier_statut();

-- b) Nouveau commentaire → attributaires et créateur prévenus (sauf l'auteur)
create or replace function public.notifier_commentaire()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.notifications (profil_id, tache_id, type, auteur_id, details)
  select distinct d.id, new.tache_id, 'commentaire', new.auteur_id, jsonb_build_object('extrait', left(new.texte, 160))
  from (
    select a.profil_id as id from public.attributions a where a.tache_id = new.tache_id
    union
    select t.cree_par from public.taches t where t.id = new.tache_id
  ) d
  join public.profils p on p.id = d.id and p.actif
  where d.id is distinct from new.auteur_id;
  return new;
end;
$$;

drop trigger if exists apres_commentaire_notifier on public.commentaires;
create trigger apres_commentaire_notifier
  after insert on public.commentaires
  for each row execute function public.notifier_commentaire();

-- =====================================================================
--  2. DEMANDES DE REPORT D'ÉCHÉANCE
-- =====================================================================
create table if not exists public.demandes_report (
  id                 bigint generated always as identity primary key,
  tache_id           uuid not null references public.taches (id) on delete cascade,
  demandeur_id       uuid not null default auth.uid() references public.profils (id) on delete cascade,
  ancienne_echeance  date,
  nouvelle_echeance  date not null,
  motif              text not null check (length(btrim(motif)) > 0),
  statut             text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee')),
  reponse            text,
  traite_par         uuid references public.profils (id) on delete set null,
  traite_le          timestamptz,
  cree_le            timestamptz not null default now()
);
create unique index if not exists demandes_report_une_en_attente
  on public.demandes_report (tache_id, demandeur_id) where statut = 'en_attente';

alter table public.demandes_report enable row level security;
revoke all on public.demandes_report from anon;
grant select, insert on public.demandes_report to authenticated;
grant all on public.demandes_report to service_role;

drop policy if exists "reports_lecture" on public.demandes_report;
create policy "reports_lecture" on public.demandes_report
  for select to authenticated
  using (demandeur_id = auth.uid() or public.peut_voir_tache(tache_id));

drop policy if exists "reports_demande" on public.demandes_report;
create policy "reports_demande" on public.demandes_report
  for insert to authenticated
  with check (
    demandeur_id = auth.uid() and public.est_actif()
    and (public.est_attribue(tache_id) or public.est_createur(tache_id))
  );

-- Valeurs imposées à la création + notification au DG
create or replace function public.preparer_report()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.statut := 'en_attente';
  new.traite_par := null;
  new.traite_le := null;
  new.reponse := null;
  select echeance into new.ancienne_echeance from public.taches where id = new.tache_id;
  return new;
end;
$$;
drop trigger if exists avant_report on public.demandes_report;
create trigger avant_report before insert on public.demandes_report
  for each row execute function public.preparer_report();

create or replace function public.notifier_report()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.notifications (profil_id, tache_id, type, auteur_id, details)
  select d, new.tache_id, 'report_demande', new.demandeur_id,
         jsonb_build_object('demande_id', new.id, 'nouvelle_echeance', new.nouvelle_echeance, 'motif', left(new.motif, 160))
  from public.ids_dg_actifs() d
  where d <> new.demandeur_id;
  return new;
end;
$$;
drop trigger if exists apres_report on public.demandes_report;
create trigger apres_report after insert on public.demandes_report
  for each row execute function public.notifier_report();

-- Accepter / refuser (DG ou admin) : met à jour l'échéance si acceptée, prévient le demandeur
create or replace function public.traiter_report(p_id bigint, p_accepter boolean, p_reponse text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.demandes_report;
begin
  if not public.est_gestionnaire() then
    raise exception 'Réservé au DG et à l''administrateur.';
  end if;
  select * into d from public.demandes_report where id = p_id for update;
  if d.id is null then raise exception 'Demande introuvable.'; end if;
  if d.statut <> 'en_attente' then raise exception 'Cette demande a déjà été traitée.'; end if;

  update public.demandes_report
     set statut = case when p_accepter then 'acceptee' else 'refusee' end,
         reponse = nullif(btrim(coalesce(p_reponse, '')), ''),
         traite_par = auth.uid(), traite_le = now()
   where id = p_id;

  if p_accepter then
    update public.taches set echeance = d.nouvelle_echeance where id = d.tache_id;
  end if;

  insert into public.notifications (profil_id, tache_id, type, auteur_id, details)
  values (d.demandeur_id, d.tache_id, 'report_reponse', auth.uid(),
          jsonb_build_object('acceptee', p_accepter, 'nouvelle_echeance', d.nouvelle_echeance,
                             'reponse', nullif(btrim(coalesce(p_reponse, '')), '')));
end;
$$;
revoke execute on function public.traiter_report(bigint, boolean, text) from public, anon;
grant execute on function public.traiter_report(bigint, boolean, text) to authenticated;

-- =====================================================================
--  3. PROJETS
-- =====================================================================
create table if not exists public.projets (
  id       uuid primary key default gen_random_uuid(),
  nom      text not null unique check (length(btrim(nom)) > 0),
  couleur  text not null default '#1B2A41',
  archive  boolean not null default false,
  cree_le  timestamptz not null default now()
);
alter table public.projets enable row level security;
revoke all on public.projets from anon;
grant select, insert, update, delete on public.projets to authenticated;
grant all on public.projets to service_role;

drop policy if exists "projets_lecture" on public.projets;
create policy "projets_lecture" on public.projets for select to authenticated using (public.est_actif());
drop policy if exists "projets_gestion" on public.projets;
create policy "projets_gestion" on public.projets for all to authenticated
  using (public.est_gestionnaire()) with check (public.est_gestionnaire());

alter table public.taches add column if not exists projet_id uuid references public.projets (id) on delete set null;
create index if not exists taches_projet_idx on public.taches (projet_id);

-- =====================================================================
--  4. ÉTAPES (CHECKLIST)
-- =====================================================================
create table if not exists public.etapes (
  id        uuid primary key default gen_random_uuid(),
  tache_id  uuid not null references public.taches (id) on delete cascade,
  texte     text not null check (length(btrim(texte)) > 0),
  fait      boolean not null default false,
  ordre     integer not null default 0,
  cree_le   timestamptz not null default now()
);
create index if not exists etapes_tache_idx on public.etapes (tache_id, ordre);
alter table public.etapes enable row level security;
revoke all on public.etapes from anon;
grant select, insert, update, delete on public.etapes to authenticated;
grant all on public.etapes to service_role;

drop policy if exists "etapes_lecture" on public.etapes;
create policy "etapes_lecture" on public.etapes for select to authenticated using (public.peut_voir_tache(tache_id));
drop policy if exists "etapes_cocher" on public.etapes;
create policy "etapes_cocher" on public.etapes for update to authenticated
  using (public.peut_voir_tache(tache_id)) with check (public.peut_voir_tache(tache_id));
drop policy if exists "etapes_ajout" on public.etapes;
create policy "etapes_ajout" on public.etapes for insert to authenticated
  with check (public.est_gestionnaire() or (public.est_actif() and public.est_createur(tache_id)));
drop policy if exists "etapes_suppression" on public.etapes;
create policy "etapes_suppression" on public.etapes for delete to authenticated
  using (public.est_gestionnaire() or (public.est_actif() and public.est_createur(tache_id)));

-- =====================================================================
--  5. PIÈCES JOINTES (bucket privé « pieces-jointes », 10 Mo max)
--     Chemin des fichiers : <id de la tâche>/<horodatage>-<nom>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('pieces-jointes', 'pieces-jointes', false, 10485760)
on conflict (id) do nothing;

create table if not exists public.pieces_jointes (
  id          uuid primary key default gen_random_uuid(),
  tache_id    uuid not null references public.taches (id) on delete cascade,
  nom         text not null,
  chemin      text not null unique,
  taille      bigint,
  type_mime   text,
  ajoute_par  uuid default auth.uid() references public.profils (id) on delete set null,
  cree_le     timestamptz not null default now()
);
create index if not exists pieces_jointes_tache_idx on public.pieces_jointes (tache_id);
alter table public.pieces_jointes enable row level security;
revoke all on public.pieces_jointes from anon;
grant select, insert, delete on public.pieces_jointes to authenticated;
grant all on public.pieces_jointes to service_role;

drop policy if exists "pj_lecture" on public.pieces_jointes;
create policy "pj_lecture" on public.pieces_jointes for select to authenticated using (public.peut_voir_tache(tache_id));
drop policy if exists "pj_ajout" on public.pieces_jointes;
create policy "pj_ajout" on public.pieces_jointes for insert to authenticated
  with check (ajoute_par = auth.uid() and public.peut_voir_tache(tache_id));
drop policy if exists "pj_suppression" on public.pieces_jointes;
create policy "pj_suppression" on public.pieces_jointes for delete to authenticated
  using (ajoute_par = auth.uid() or public.est_gestionnaire());

-- Droits sur les fichiers eux-mêmes
drop policy if exists "pj_fichiers_lecture" on storage.objects;
create policy "pj_fichiers_lecture" on storage.objects for select to authenticated
  using (bucket_id = 'pieces-jointes' and public.peut_voir_tache_texte((storage.foldername(name))[1]));
drop policy if exists "pj_fichiers_ajout" on storage.objects;
create policy "pj_fichiers_ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'pieces-jointes' and public.peut_voir_tache_texte((storage.foldername(name))[1]));
drop policy if exists "pj_fichiers_suppression" on storage.objects;
create policy "pj_fichiers_suppression" on storage.objects for delete to authenticated
  using (
    bucket_id = 'pieces-jointes'
    and (public.est_gestionnaire()
         or exists (select 1 from public.pieces_jointes pj where pj.chemin = name and pj.ajoute_par = auth.uid()))
  );

-- =====================================================================
--  6. TÂCHES RÉCURRENTES
-- =====================================================================
alter table public.taches add column if not exists recurrence text not null default 'aucune';
alter table public.taches drop constraint if exists taches_recurrence_check;
alter table public.taches add constraint taches_recurrence_check check (recurrence in ('aucune', 'hebdomadaire', 'mensuelle'));
alter table public.taches add column if not exists recurrence_suivante uuid references public.taches (id) on delete set null;

-- Règles métier : un membre non créateur ne peut pas non plus changer le projet ni la récurrence ;
-- les créations automatiques (récurrence) gardent le créateur d'origine.
create or replace function public.regles_tache()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.modifie_le := now();

  if new.statut = 'termine' then
    if tg_op = 'INSERT' or old.statut <> 'termine' then
      new.date_terminee := coalesce(new.date_terminee, public.aujourdhui_porto_novo());
    end if;
  else
    new.date_terminee := null;
  end if;

  if auth.uid() is null or public.est_gestionnaire()
     or current_setting('agenda.creation_systeme', true) = 'oui' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.cree_par := auth.uid();
    return new;
  end if;

  if new.numero <> old.numero or new.cree_par is distinct from old.cree_par
     or new.date_creation <> old.date_creation then
    raise exception 'Le numéro, la date de création et le créateur ne peuvent pas être modifiés.';
  end if;

  if old.cree_par is distinct from auth.uid() then
    if new.intitule is distinct from old.intitule
       or new.description is distinct from old.description
       or new.echeance is distinct from old.echeance
       or new.priorite is distinct from old.priorite
       or new.projet_id is distinct from old.projet_id
       or new.recurrence is distinct from old.recurrence then
      raise exception 'Sur une tâche qui vous est attribuée, seul le statut peut être modifié.';
    end if;
  end if;

  return new;
end;
$$;

-- Quand une tâche récurrente est terminée, la suivante est créée automatiquement
create or replace function public.creer_occurrence_suivante()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_echeance date;
begin
  if new.statut <> 'termine' or old.statut = 'termine' or new.recurrence = 'aucune'
     or new.recurrence_suivante is not null then
    return new;
  end if;

  v_echeance := coalesce(new.echeance, public.aujourdhui_porto_novo());
  v_echeance := case new.recurrence
                  when 'hebdomadaire' then v_echeance + 7
                  else (v_echeance + interval '1 month')::date
                end;

  perform set_config('agenda.creation_systeme', 'oui', true);

  insert into public.taches (intitule, description, echeance, priorite, projet_id, recurrence, cree_par)
  values (new.intitule, new.description, v_echeance, new.priorite, new.projet_id, new.recurrence, new.cree_par)
  returning id into v_id;

  insert into public.attributions (tache_id, profil_id, attribue_par)
  select v_id, a.profil_id, a.attribue_par
  from public.attributions a
  join public.profils p on p.id = a.profil_id and p.actif
  where a.tache_id = new.id;

  insert into public.etapes (tache_id, texte, ordre)
  select v_id, e.texte, e.ordre from public.etapes e where e.tache_id = new.id;

  update public.taches set recurrence_suivante = v_id where id = new.id;

  perform set_config('agenda.creation_systeme', '', true);
  return new;
end;
$$;

drop trigger if exists apres_terminee_recurrence on public.taches;
create trigger apres_terminee_recurrence
  after update of statut on public.taches
  for each row execute function public.creer_occurrence_suivante();

-- =====================================================================
--  7. RAPPELS AUTOMATIQUES (appelés chaque jour par la fonction Edge)
-- =====================================================================
alter table public.journal_rappels drop constraint if exists journal_rappels_type_check;
alter table public.journal_rappels add constraint journal_rappels_type_check check (type in ('echeance_48h', 'echue'));

-- Génère les rappels du jour (notifications dans l'application + journal)
-- et renvoie la liste pour l'envoi des emails. Un rappel n'est jamais envoyé deux fois.
create or replace function public.generer_rappels()
returns table (profil_id uuid, email text, nom_complet text, tache_id uuid, numero integer,
               intitule text, echeance date, type text)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with dus as (
    select * from public.rappels_a_envoyer()
  ), journal as (
    insert into public.journal_rappels (tache_id, profil_id, type)
    select d.tache_id, d.profil_id, d.type from dus d
    on conflict do nothing
    returning journal_rappels.tache_id, journal_rappels.profil_id, journal_rappels.type
  ), notifs as (
    insert into public.notifications (profil_id, tache_id, type, details)
    select j.profil_id, j.tache_id,
           case when j.type = 'echue' then 'rappel_echue' else 'rappel_48h' end,
           null
    from journal j
    returning 1
  )
  select j.profil_id, p.email, p.nom_complet, t.id, t.numero, t.intitule, t.echeance, j.type
  from journal j
  join public.profils p on p.id = j.profil_id
  join public.taches t on t.id = j.tache_id
  order by p.email, t.echeance;
end;
$$;
revoke execute on function public.generer_rappels() from public, anon, authenticated;
grant execute on function public.generer_rappels() to service_role;

-- Journal des envois périodiques (récapitulatif du lundi, sauvegarde)
create table if not exists public.journal_envois (
  cle        text primary key,
  envoye_le  timestamptz not null default now()
);
alter table public.journal_envois enable row level security;
revoke all on public.journal_envois from anon, authenticated;
grant all on public.journal_envois to service_role;

-- Droits du rôle serveur sur les nouvelles fonctions
grant execute on function public.ids_dg_actifs() to service_role;
