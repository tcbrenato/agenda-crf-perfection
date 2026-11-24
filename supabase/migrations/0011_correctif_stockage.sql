-- =====================================================================
--  AGENDA CRF PERFECTION — Migration 0011 : correctif du stockage
--  - Photos de profil : droit de relecture (nécessaire à l'enregistrement)
--  - Espaces « avatars » et « pieces-jointes » visibles des utilisateurs connectés
-- =====================================================================

-- Relire les photos (bucket public) : nécessaire pour enregistrer un fichier
drop policy if exists "avatars_lecture" on storage.objects;
create policy "avatars_lecture" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

-- Voir les deux espaces de stockage de l'agenda (évite « Bucket not found »)
drop policy if exists "agenda_buckets_lecture" on storage.buckets;
create policy "agenda_buckets_lecture" on storage.buckets for select to authenticated
  using (id in ('avatars', 'pieces-jointes'));

-- Vérification : les 4 règles des photos et les 3 des pièces jointes doivent apparaître
select policyname, cmd from pg_policies
where schemaname = 'storage' and (policyname like 'avatars%' or policyname like 'pj_%' or policyname like 'agenda_%')
order by policyname;
