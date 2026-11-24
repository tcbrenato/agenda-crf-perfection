-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0008 : planification quotidienne
--  Chaque jour à 07:00 UTC (08:00 à Porto-Novo), appel de la fonction
--  « rappels-echeances » : rappels 48 h / tâches échues, et le lundi
--  récapitulatif pour le DG + sauvegarde pour l'administration.
--
--  Prérequis : fonction Edge « rappels-echeances » déployée
--  avec « Verify JWT » DÉSACTIVÉ (elle n'envoie jamais deux fois la même chose).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (re)programmation idempotente
select cron.unschedule(jobid) from cron.job where jobname = 'agenda-rappels-quotidiens';

select cron.schedule(
  'agenda-rappels-quotidiens',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://bvewhdjqlbxbuwthhzqr.supabase.co/functions/v1/rappels-echeances',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Vérification : la tâche planifiée doit apparaître ici
select jobid, jobname, schedule from cron.job where jobname = 'agenda-rappels-quotidiens';
