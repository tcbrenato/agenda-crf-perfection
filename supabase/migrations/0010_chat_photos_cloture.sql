-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0010
--   1. CHAT : discussion « Général » (toute l'équipe) + conversations privées
--   2. PHOTO DE PROFIL (stockage « avatars »)
--   3. CLÔTURE / BLOCAGE : le compte rendu ou le motif accompagne la
--      notification (et l'email) envoyée au DG
--  À exécuter après 0001 à 0009.
-- =====================================================================

-- =====================================================================
--  1. CHAT
-- =====================================================================
create table if not exists public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null check (type in ('general', 'directe')),
  cle                 text not null unique,           -- 'general' ou '<uuid>:<uuid>' (ordre croissant)
  cree_le             timestamptz not null default now(),
  dernier_message_le  timestamptz
);

create table if not exists public.participants (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  profil_id        uuid not null references public.profils (id) on delete cascade,
  primary key (conversation_id, profil_id)
);
create index if not exists participants_profil_idx on public.participants (profil_id);

create table if not exists public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  auteur_id        uuid default auth.uid() references public.profils (id) on delete set null,
  texte            text not null check (length(btrim(texte)) between 1 and 4000),
  cree_le          timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, cree_le);

create table if not exists public.lectures (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  profil_id        uuid not null references public.profils (id) on delete cascade,
  lu_le            timestamptz not null default now(),
  primary key (conversation_id, profil_id)
);

insert into public.conversations (type, cle) values ('general', 'general') on conflict (cle) do nothing;

-- L'utilisateur connecté fait-il partie de la conversation ?
create or replace function public.est_membre_conversation(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.est_actif() and (
    exists (select 1 from public.conversations c where c.id = p_conversation and c.type = 'general')
    or exists (select 1 from public.participants p where p.conversation_id = p_conversation and p.profil_id = auth.uid())
  );
$$;
grant execute on function public.est_membre_conversation(uuid) to authenticated, service_role;

alter table public.conversations enable row level security;
alter table public.participants  enable row level security;
alter table public.messages      enable row level security;
alter table public.lectures      enable row level security;
revoke all on public.conversations, public.participants, public.messages, public.lectures from anon;
grant select on public.conversations, public.participants to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, update on public.lectures to authenticated;
grant all on public.conversations, public.participants, public.messages, public.lectures to service_role;

drop policy if exists "conv_lecture" on public.conversations;
create policy "conv_lecture" on public.conversations for select to authenticated using (public.est_membre_conversation(id));
drop policy if exists "participants_lecture" on public.participants;
create policy "participants_lecture" on public.participants for select to authenticated using (public.est_membre_conversation(conversation_id));
drop policy if exists "messages_lecture" on public.messages;
create policy "messages_lecture" on public.messages for select to authenticated using (public.est_membre_conversation(conversation_id));
drop policy if exists "messages_envoi" on public.messages;
create policy "messages_envoi" on public.messages for insert to authenticated
  with check (auteur_id = auth.uid() and public.est_membre_conversation(conversation_id));
drop policy if exists "messages_suppression" on public.messages;
create policy "messages_suppression" on public.messages for delete to authenticated using (auteur_id = auth.uid());
drop policy if exists "lectures_les_miennes" on public.lectures;
create policy "lectures_les_miennes" on public.lectures for all to authenticated
  using (profil_id = auth.uid()) with check (profil_id = auth.uid());

-- Date du dernier message (tri de la liste)
create or replace function public.maj_dernier_message()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.conversations set dernier_message_le = new.cree_le where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists apres_message on public.messages;
create trigger apres_message after insert on public.messages
  for each row execute function public.maj_dernier_message();

-- Ouvre (ou crée) la conversation privée avec une autre personne
create or replace function public.ouvrir_conversation(p_autre uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cle text;
  v_id uuid;
begin
  if not public.est_actif() then raise exception 'Compte inactif.'; end if;
  if p_autre = auth.uid() then raise exception 'Choisissez une autre personne.'; end if;
  if not exists (select 1 from public.profils where id = p_autre and actif) then
    raise exception 'Cette personne n''a pas de compte actif.';
  end if;
  v_cle := least(auth.uid()::text, p_autre::text) || ':' || greatest(auth.uid()::text, p_autre::text);
  insert into public.conversations (type, cle) values ('directe', v_cle) on conflict (cle) do nothing;
  select id into v_id from public.conversations where cle = v_cle;
  insert into public.participants (conversation_id, profil_id)
  values (v_id, auth.uid()), (v_id, p_autre) on conflict do nothing;
  return v_id;
end;
$$;
revoke execute on function public.ouvrir_conversation(uuid) from public, anon;
grant execute on function public.ouvrir_conversation(uuid) to authenticated;

-- Liste des conversations de l'utilisateur avec dernier message et non-lus
create or replace function public.resume_conversations()
returns table (id uuid, type text, autre_id uuid, dernier_texte text, dernier_auteur uuid,
               dernier_le timestamptz, non_lus integer)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.type,
         (select p.profil_id from public.participants p where p.conversation_id = c.id and p.profil_id <> auth.uid() limit 1),
         m.texte, m.auteur_id, m.cree_le,
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id
             and x.auteur_id is distinct from auth.uid()
             and x.cree_le > greatest(coalesce(l.lu_le, '-infinity'::timestamptz),
                                      (select pr.cree_le from public.profils pr where pr.id = auth.uid())))
  from public.conversations c
  left join public.lectures l on l.conversation_id = c.id and l.profil_id = auth.uid()
  left join lateral (
    select texte, auteur_id, cree_le from public.messages mm
    where mm.conversation_id = c.id order by mm.cree_le desc limit 1
  ) m on true
  where public.est_membre_conversation(c.id)
  order by (c.type = 'general') desc, c.dernier_message_le desc nulls last;
$$;
revoke execute on function public.resume_conversations() from public, anon;
grant execute on function public.resume_conversations() to authenticated;

create or replace function public.marquer_conversation_lue(p_conversation uuid)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.lectures (conversation_id, profil_id, lu_le)
  select p_conversation, auth.uid(), now()
  where public.est_membre_conversation(p_conversation)
  on conflict (conversation_id, profil_id) do update set lu_le = excluded.lu_le;
$$;
revoke execute on function public.marquer_conversation_lue(uuid) from public, anon;
grant execute on function public.marquer_conversation_lue(uuid) to authenticated;

-- Messages en direct (Supabase Realtime ; la sécurité ci-dessus s'applique)
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then
  raise notice 'Realtime : %', sqlerrm;
end;
$$;

-- =====================================================================
--  2. PHOTO DE PROFIL
--     Fichiers : avatars/<id du profil>/<horodatage>.jpg (bucket public, 1 Mo max)
-- =====================================================================
alter table public.profils add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 1048576)
on conflict (id) do nothing;

drop policy if exists "avatars_ajout" on storage.objects;
create policy "avatars_ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_modif" on storage.objects;
create policy "avatars_modif" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_suppression" on storage.objects;
create policy "avatars_suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
--  3. COMPTE RENDU DE CLÔTURE / MOTIF DE BLOCAGE
--     L'application enregistre le commentaire « ✅ Terminée : … » ou « 🚫 Bloquée : … »
--     juste AVANT de changer le statut ; il est repris dans la notification.
-- =====================================================================
create or replace function public.notifier_statut()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note text;
begin
  if auth.uid() is null or new.statut is not distinct from old.statut
     or new.statut not in ('termine', 'bloque') then
    return new;
  end if;
  select left(c.texte, 400) into v_note
  from public.commentaires c
  where c.tache_id = new.id and c.auteur_id = auth.uid()
    and c.date > now() - interval '10 minutes'
    and (c.texte like '✅%' or c.texte like '🚫%')
  order by c.date desc limit 1;

  insert into public.notifications (profil_id, tache_id, type, auteur_id, details)
  select distinct d.id, new.id, 'statut', auth.uid(), jsonb_build_object('statut', new.statut, 'note', v_note)
  from (
    select public.ids_dg_actifs() as id
    union
    select p.id from public.profils p where p.id = new.cree_par and p.actif
    union
    -- la personne qui a confié la tâche est aussi prévenue
    select a.attribue_par from public.attributions a
    join public.profils p on p.id = a.attribue_par and p.actif
    where a.tache_id = new.id
  ) d
  where d.id is not null and d.id <> auth.uid();
  return new;
end;
$$;

-- Ces commentaires automatiques ne génèrent pas, en plus, une notification « commentaire »
create or replace function public.notifier_commentaire()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.texte like '✅ Terminée%' or new.texte like '🚫 Bloquée%' then
    return new;
  end if;
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
