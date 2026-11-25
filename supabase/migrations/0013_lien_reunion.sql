-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0013
--  Lien de réunion : on ne garde que l'adresse (https://…), même si du texte
--  a été collé avec. S'applique aux enregistrements futurs ; corrige aussi
--  les réunions existantes SANS renvoyer de notification.
-- =====================================================================
create or replace function public.nettoyer_lien_reunion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lien is not null then
    new.lien := nullif(rtrim(substring(new.lien from 'https?://[^[:space:]<>"'']+'), '.,;:)]'), '');
  end if;
  return new;
end;
$$;
drop trigger if exists avant_evenement_lien on public.evenements;
create trigger avant_evenement_lien
  before insert or update of lien on public.evenements
  for each row execute function public.nettoyer_lien_reunion();

-- Correction des réunions déjà enregistrées, sans notification (trigger désactivé le temps de la mise à jour)
alter table public.evenements disable trigger apres_evenement_notifier;
update public.evenements
   set lien = nullif(rtrim(substring(lien from 'https?://[^[:space:]<>"'']+'), '.,;:)]'), '')
 where lien is not null and lien !~ '^https?://[^[:space:]]+$';
alter table public.evenements enable trigger apres_evenement_notifier;

select titre, lien from public.evenements where not annule;
