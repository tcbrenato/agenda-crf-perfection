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
