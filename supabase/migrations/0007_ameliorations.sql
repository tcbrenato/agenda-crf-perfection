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
