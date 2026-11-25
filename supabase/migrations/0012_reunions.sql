-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0012 : RÉUNIONS ET ÉVÉNEMENTS
--   - Planification (réunion, projet, événement) avec lien Meet / Zoom
--   - Répétition hebdomadaire (ex. réunion du staff mardi et vendredi à 19 h)
--   - Notification (cloche + email) aux participants à la création / modification
--   - Rappel 30 minutes avant (cloche + email), vérifié toutes les 5 minutes
--  À exécuter après 0001 à 0011. Heures en Africa/Porto-Novo.
-- =====================================================================

create table if not exists public.evenements (
  id               uuid primary key default gen_random_uuid(),
  titre            text not null check (length(btrim(titre)) > 0),
  description      text,
  type             text not null default 'reunion' check (type in ('reunion', 'projet', 'evenement')),
  debut            timestamptz not null,               -- première occurrence (date + heure)
  duree_minutes    integer not null default 60 check (duree_minutes between 5 and 1440),
  lien             text,                               -- lien Google Meet, Zoom, Teams…
  lieu             text,
  recurrence       text not null default 'aucune' check (recurrence in ('aucune', 'hebdomadaire')),
  jours_semaine    integer[] not null default '{}',     -- 1 = lundi … 7 = dimanche
  fin_recurrence   date,
  pour_tous        boolean not null default true,
  annule           boolean not null default false,
  cree_par         uuid default auth.uid() references public.profils (id) on delete set null,
  cree_le          timestamptz not null default now(),
  modifie_le       timestamptz not null default now(),
  check (recurrence = 'aucune' or cardinality(jours_semaine) > 0)
);

create table if not exists public.evenement_participants (
  evenement_id  uuid not null references public.evenements (id) on delete cascade,
  profil_id     uuid not null references public.profils (id) on delete cascade,
  primary key (evenement_id, profil_id)
);

create table if not exists public.journal_rappels_reunions (
  evenement_id  uuid not null references public.evenements (id) on delete cascade,
  occurrence    timestamptz not null,
  profil_id     uuid not null references public.profils (id) on delete cascade,
  envoye_le     timestamptz not null default now(),
  primary key (evenement_id, occurrence, profil_id)
);

-- L'utilisateur est-il concerné par l'événement ?
create or replace function public.concerne_evenement(p_evenement uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.est_actif() and exists (
    select 1 from public.evenements e
    where e.id = p_evenement
      and (e.pour_tous or e.cree_par = auth.uid() or public.est_gestionnaire()
           or exists (select 1 from public.evenement_participants p where p.evenement_id = e.id and p.profil_id = auth.uid()))
  );
$$;
grant execute on function public.concerne_evenement(uuid) to authenticated, service_role;

-- Destinataires d'un événement (profils actifs)
create or replace function public.destinataires_evenement(p_evenement uuid)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id from public.profils p
  join public.evenements e on e.id = p_evenement
  where p.actif
    and (e.pour_tous
         or p.id = e.cree_par
         or exists (select 1 from public.evenement_participants x where x.evenement_id = e.id and x.profil_id = p.id));
$$;

alter table public.evenements enable row level security;
alter table public.evenement_participants enable row level security;
alter table public.journal_rappels_reunions enable row level security;
revoke all on public.evenements, public.evenement_participants, public.journal_rappels_reunions from anon;
grant select, insert, update, delete on public.evenements, public.evenement_participants to authenticated;
grant all on public.evenements, public.evenement_participants, public.journal_rappels_reunions to service_role;

drop policy if exists "evenements_lecture" on public.evenements;
create policy "evenements_lecture" on public.evenements for select to authenticated using (public.concerne_evenement(id));
drop policy if exists "evenements_gestion" on public.evenements;
create policy "evenements_gestion" on public.evenements for all to authenticated
  using (public.est_gestionnaire()) with check (public.est_gestionnaire());
drop policy if exists "ev_participants_lecture" on public.evenement_participants;
create policy "ev_participants_lecture" on public.evenement_participants for select to authenticated
  using (public.concerne_evenement(evenement_id));
drop policy if exists "ev_participants_gestion" on public.evenement_participants;
create policy "ev_participants_gestion" on public.evenement_participants for all to authenticated
  using (public.est_gestionnaire()) with check (public.est_gestionnaire());

-- ---------------------------------------------------------------------
--  Occurrences entre deux instants (réunions ponctuelles et répétées)
--  (respecte la sécurité : chacun ne voit que ses événements)
-- ---------------------------------------------------------------------
create or replace function public.occurrences_evenements(p_de timestamptz, p_a timestamptz)
returns table (evenement_id uuid, debut timestamptz, fin timestamptz)
language sql stable
set search_path = ''
as $$
  select e.id, e.debut, e.debut + make_interval(mins => e.duree_minutes)
  from public.evenements e
  where not e.annule and e.recurrence = 'aucune'
    and e.debut < p_a and e.debut + make_interval(mins => e.duree_minutes) > p_de
  union all
  select e.id, o.debut, o.debut + make_interval(mins => e.duree_minutes)
  from public.evenements e
  cross join lateral (
    select ((j::date + (e.debut at time zone 'Africa/Porto-Novo')::time) at time zone 'Africa/Porto-Novo') as debut
    from generate_series(
      greatest((e.debut at time zone 'Africa/Porto-Novo')::date, (p_de at time zone 'Africa/Porto-Novo')::date - 1)::timestamp,
      least(coalesce(e.fin_recurrence, date '9999-12-31'), (p_a at time zone 'Africa/Porto-Novo')::date + 1)::timestamp,
      interval '1 day'
    ) j
    where extract(isodow from j)::int = any (e.jours_semaine)
  ) o
  where not e.annule and e.recurrence = 'hebdomadaire'
    and o.debut >= e.debut - interval '1 minute'
    and o.debut < p_a and o.debut + make_interval(mins => e.duree_minutes) > p_de
  order by 2;
$$;
grant execute on function public.occurrences_evenements(timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
--  Notifications
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('attribution', 'statut', 'commentaire', 'rappel_48h', 'rappel_echue',
                  'report_demande', 'report_reponse', 'accuse_reception', 'reunion', 'rappel_reunion'));

-- Prochaine occurrence d'un événement (pour le texte des notifications)
create or replace function public.prochaine_occurrence(p_evenement uuid)
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select o.debut from public.occurrences_evenements(now() - interval '1 hour', now() + interval '60 days') o
  where o.evenement_id = p_evenement order by o.debut limit 1;
$$;

-- Création / modification / annulation → tous les participants sont prévenus
create or replace function public.notifier_evenement()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_etat text;
begin
  if tg_op = 'INSERT' then
    v_etat := 'nouveau';
  elsif new.annule and not old.annule then
    v_etat := 'annule';
  elsif new.debut is distinct from old.debut or new.lien is distinct from old.lien
        or new.jours_semaine is distinct from old.jours_semaine or new.recurrence is distinct from old.recurrence
        or new.titre is distinct from old.titre or new.lieu is distinct from old.lieu then
    v_etat := 'modifie';
  else
    return new;
  end if;

  insert into public.notifications (profil_id, type, auteur_id, details)
  select d, 'reunion', new.cree_par,
         jsonb_build_object(
           'evenement_id', new.id, 'etat', v_etat, 'titre', new.titre, 'type_evenement', new.type,
           'debut', coalesce(public.prochaine_occurrence(new.id), new.debut),
           'duree', new.duree_minutes, 'lien', new.lien, 'lieu', new.lieu,
           'recurrence', new.recurrence, 'jours', to_jsonb(new.jours_semaine), 'description', left(new.description, 500))
  from public.destinataires_evenement(new.id) d
  where d is distinct from coalesce(auth.uid(), new.cree_par);
  return new;
end;
$$;

drop trigger if exists apres_evenement_notifier on public.evenements;
create trigger apres_evenement_notifier
  after insert or update on public.evenements
  for each row execute function public.notifier_evenement();

-- Participants choisis ajoutés APRÈS la création : on les prévient aussi
create or replace function public.notifier_participant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.evenements;
begin
  select * into e from public.evenements where id = new.evenement_id;
  if e.pour_tous or new.profil_id = e.cree_par then return new; end if;
  insert into public.notifications (profil_id, type, auteur_id, details)
  select new.profil_id, 'reunion', e.cree_par,
         jsonb_build_object('evenement_id', e.id, 'etat', 'nouveau', 'titre', e.titre, 'type_evenement', e.type,
           'debut', coalesce(public.prochaine_occurrence(e.id), e.debut), 'duree', e.duree_minutes,
           'lien', e.lien, 'lieu', e.lieu, 'recurrence', e.recurrence, 'jours', to_jsonb(e.jours_semaine),
           'description', left(e.description, 500))
  where exists (select 1 from public.profils where id = new.profil_id and actif);
  return new;
end;
$$;
drop trigger if exists apres_participant_notifier on public.evenement_participants;
create trigger apres_participant_notifier
  after insert on public.evenement_participants
  for each row execute function public.notifier_participant();

-- ---------------------------------------------------------------------
--  Rappel 30 minutes avant (appelé toutes les 5 minutes)
-- ---------------------------------------------------------------------
create or replace function public.generer_rappels_reunions()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with prochaines as (
    select o.evenement_id, o.debut
    from public.occurrences_evenements(now(), now() + interval '31 minutes') o
    where o.debut > now()
  ), cibles as (
    select p.evenement_id, p.debut, d as profil_id
    from prochaines p
    cross join lateral public.destinataires_evenement(p.evenement_id) d
  ), journal as (
    insert into public.journal_rappels_reunions (evenement_id, occurrence, profil_id)
    select evenement_id, debut, profil_id from cibles
    on conflict do nothing
    returning evenement_id, occurrence, profil_id
  ), notifs as (
    insert into public.notifications (profil_id, type, details)
    select j.profil_id, 'rappel_reunion',
           jsonb_build_object('evenement_id', e.id, 'titre', e.titre, 'type_evenement', e.type, 'debut', j.occurrence,
                              'duree', e.duree_minutes, 'lien', e.lien, 'lieu', e.lieu)
    from journal j join public.evenements e on e.id = j.evenement_id
    returning 1
  )
  select count(*) into n from notifs;
  return n;
end;
$$;
revoke execute on function public.generer_rappels_reunions() from public, anon, authenticated;
grant execute on function public.generer_rappels_reunions() to service_role;

-- Planification toutes les 5 minutes (les emails partent ensuite via envoyer-notifications)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-rappels-reunions';
  perform cron.schedule('agenda-rappels-reunions', '*/5 * * * *', 'select public.generer_rappels_reunions()');
exception when others then
  raise notice 'pg_cron indisponible : exécutez d''abord 0008_planification.sql';
end;
$$;
