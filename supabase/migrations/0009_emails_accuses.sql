-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0009
--   1. Toutes les notifications partent aussi PAR EMAIL
--      (fonction Edge « envoyer-notifications », déclenchée à chaque
--       nouvelle notification + vérification toutes les 10 minutes)
--   2. ACCUSÉ DE RÉCEPTION : l'attributaire confirme avoir bien reçu
--      une tâche ; la personne qui la lui a confiée est prévenue.
--
--  À exécuter après 0001 à 0008, puis déployer « envoyer-notifications »
--  (Verify JWT désactivé).
-- =====================================================================

-- ------------------------------------------------------------------
--  1. Suivi de l'envoi des emails
-- ------------------------------------------------------------------
alter table public.notifications add column if not exists email_envoye_le timestamptz;
alter table public.notifications add column if not exists email_tentatives integer not null default 0;

-- Les notifications déjà existantes ne sont pas envoyées après coup
update public.notifications set email_envoye_le = coalesce(email_envoye_le, now()) where email_envoye_le is null;

create index if not exists notifications_email_a_envoyer_idx
  on public.notifications (id) where email_envoye_le is null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('attribution', 'statut', 'commentaire', 'rappel_48h', 'rappel_echue',
                  'report_demande', 'report_reponse', 'accuse_reception'));

-- Les rappels du matin ont leur propre email groupé : leurs notifications sont marquées « envoyées »
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
    insert into public.notifications (profil_id, tache_id, type, details, email_envoye_le)
    select j.profil_id, j.tache_id,
           case when j.type = 'echue' then 'rappel_echue' else 'rappel_48h' end,
           null, now()
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

-- Réserve un lot de notifications à envoyer par email (sans doublon, même en parallèle)
create or replace function public.reserver_notifications_email(p_limite integer default 40)
returns table (
  id bigint, type text, details jsonb, cree_le timestamptz,
  destinataire_email text, destinataire_nom text, auteur_nom text,
  tache_id uuid, numero integer, intitule text, description text, echeance date, priorite text,
  co_attributaires text
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with choisies as (
    select n.id from public.notifications n
    where n.email_envoye_le is null and n.email_tentatives < 3
      and n.cree_le > now() - interval '2 days'
    order by n.id
    limit p_limite
    for update skip locked
  ), reservees as (
    update public.notifications n
       set email_envoye_le = now(), email_tentatives = n.email_tentatives + 1
      from choisies c
     where n.id = c.id
    returning n.id, n.type, n.details, n.cree_le, n.profil_id, n.auteur_id, n.tache_id
  )
  select r.id, r.type, r.details, r.cree_le,
         d.email, d.nom_complet, a.nom_complet,
         t.id, t.numero, t.intitule, t.description, t.echeance, t.priorite,
         (select string_agg(p.nom_complet, ', ' order by p.nom_complet)
            from public.attributions x join public.profils p on p.id = x.profil_id
           where x.tache_id = t.id and x.profil_id <> r.profil_id)
  from reservees r
  join public.profils d on d.id = r.profil_id and d.actif
  left join public.profils a on a.id = r.auteur_id
  left join public.taches t on t.id = r.tache_id
  order by r.id;
end;
$$;
revoke execute on function public.reserver_notifications_email(integer) from public, anon, authenticated;
grant execute on function public.reserver_notifications_email(integer) to service_role;

-- Déclenche l'envoi dès qu'une notification est créée (appel HTTP asynchrone, pg_net).
-- En cas d'indisponibilité, la vérification toutes les 10 minutes prend le relais.
create or replace function public.declencher_envoi_emails()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://bvewhdjqlbxbuwthhzqr.supabase.co/functions/v1/envoyer-notifications',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  exception when others then
    null; -- ne bloque jamais la création de la notification
  end;
  return null;
end;
$$;

drop trigger if exists apres_notification_email on public.notifications;
create trigger apres_notification_email
  after insert on public.notifications
  for each statement execute function public.declencher_envoi_emails();

-- Filet de sécurité : toutes les 10 minutes
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-emails-notifications';
  perform cron.schedule(
    'agenda-emails-notifications',
    '*/10 * * * *',
    $c$ select net.http_post(
          url := 'https://bvewhdjqlbxbuwthhzqr.supabase.co/functions/v1/envoyer-notifications',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{}'::jsonb,
          timeout_milliseconds := 60000) $c$
  );
exception when others then
  raise notice 'pg_cron indisponible : exécutez d''abord 0008_planification.sql';
end;
$$;

-- ------------------------------------------------------------------
--  2. Accusé de réception
-- ------------------------------------------------------------------
alter table public.attributions add column if not exists recu_le timestamptz;

-- Les tâches qu'on s'est attribuées soi-même sont « reçues » d'office
update public.attributions set recu_le = attribue_le
 where recu_le is null and attribue_par = profil_id;

create or replace function public.attribution_auto_recue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attribue_par is not null and new.attribue_par = new.profil_id then
    new.recu_le := coalesce(new.recu_le, now());
  end if;
  return new;
end;
$$;
drop trigger if exists avant_attribution_recue on public.attributions;
create trigger avant_attribution_recue
  before insert on public.attributions
  for each row execute function public.attribution_auto_recue();

-- L'attributaire confirme ; la personne qui a confié la tâche est prévenue
create or replace function public.confirmer_reception(p_tache uuid)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_par uuid;
  v_le timestamptz;
begin
  if not public.est_actif() then
    raise exception 'Compte inactif.';
  end if;
  update public.attributions
     set recu_le = now()
   where tache_id = p_tache and profil_id = auth.uid() and recu_le is null
  returning attribue_par, recu_le into v_par, v_le;

  if v_le is null then
    select recu_le into v_le from public.attributions where tache_id = p_tache and profil_id = auth.uid();
    if v_le is null then
      raise exception 'Cette tâche ne vous est pas attribuée.';
    end if;
    return v_le; -- déjà confirmée
  end if;

  if v_par is not null and v_par <> auth.uid() then
    insert into public.notifications (profil_id, tache_id, type, auteur_id)
    select v_par, p_tache, 'accuse_reception', auth.uid()
    where exists (select 1 from public.profils where id = v_par and actif);
  end if;
  return v_le;
end;
$$;
revoke execute on function public.confirmer_reception(uuid) from public, anon;
grant execute on function public.confirmer_reception(uuid) to authenticated;
