# Agenda CRF Perfection

Agenda électronique de suivi des tâches pour tout le personnel de **CRF Perfection**.
Le Directeur Général y inscrit ses propres points et ceux de l'équipe. Chaque tâche a un
**numéro**, une **date**, une **échéance** et un ou plusieurs **attributaires**. D'un coup d'œil,
on voit ce qui n'est pas encore échu, ce qui est en cours et ce qui est en retard.

- Conçue **d'abord pour le téléphone** (360 à 430 px), puis pour l'ordinateur
- **Installable** sur l'écran d'accueil (PWA), elle s'ouvre comme une application
- Légère pour les connexions faibles : environ 140 Ko compressés au premier chargement, puis l'application reste en cache
- Interface 100 % en français, dates au format jj/mm/aaaa, fuseau **Africa/Porto-Novo**

**Technologies :** React + Vite · Supabase (Auth, Postgres, Row Level Security, Edge Functions) · Vercel

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Structure du projet](#2-structure-du-projet)
3. [Créer le projet Supabase](#3-créer-le-projet-supabase)
4. [Variables d'environnement](#4-variables-denvironnement)
5. [Lancer en local (Windows / PowerShell / VS Code)](#5-lancer-en-local-windows--powershell--vs-code)
6. [Créer le premier compte administrateur](#6-créer-le-premier-compte-administrateur)
7. [Déployer sur Vercel](#7-déployer-sur-vercel)
8. [Inviter les membres](#8-inviter-les-membres)
9. [Logo et icônes](#9-logo-et-icônes)
10. [Import d'une liste existante](#10-import-dune-liste-existante)
11. [Rappels (prévus, non activés)](#11-rappels-prévus-non-activés)
12. [Droits et sécurité](#12-droits-et-sécurité)
13. [Dépannage](#13-dépannage)

---

## 1. Fonctionnalités

| Écran | Contenu |
|---|---|
| **Connexion** | Email et mot de passe, logo, « Mot de passe oublié ». Pas d'inscription libre. |
| **Accueil** | 4 compteurs (Total, En cours, Échues, Terminées), section **En retard** mise en évidence, section **À échéance dans les 7 jours**. Bascule « Équipe / Mes tâches ». |
| **Tâches** | Cartes sur mobile, tableau sur ordinateur : N° · Tâche · Date · Échéance · Attributaire · Statut · Délai. Filtres en puces (Toutes, Mes tâches, En cours, Échues, Terminées, Bloquées, puis par attributaire), recherche, tri, **export Excel et PDF** de la liste filtrée. |
| **Changement de statut en un geste** | Glisser une carte **vers la droite** pour la marquer terminée (ou la rouvrir), **vers la gauche** pour choisir un statut. On peut aussi toucher la pastille de statut. Un bouton « Annuler » apparaît quelques secondes. |
| **Fiche tâche** | Détail, attributaires (avec appel direct), commentaires, historique (statut, échéance, attributions : qui, quand, avant/après). |
| **Ajout rapide** | Bouton **+** : intitulé, échéance (raccourcis Aujourd'hui / Demain / 7 j / 15 j / fin du mois), attributaires, puis Enregistrer. Moins de 10 secondes. |
| **Formulaire complet** | Description, date, statut, priorité, plusieurs attributaires. |
| **Calendrier** | Vue mensuelle des échéances (points bleu, rouge et vert). Toucher un jour affiche ses tâches. |
| **Mon compte** | Profil, changement du mot de passe, installation sur l'écran d'accueil, déconnexion. |
| **Administration** (administrateur uniquement) | **Aperçu** : membres actifs, invitations en attente, tâches échues, charge par personne. **Membres** : inviter, changer le rôle, désactiver/réactiver, renvoyer le lien, voir la dernière connexion. **Données** : import, export complet Excel/PDF. **Activité** : journal des dernières modifications de toute l'équipe. Accès : bouton « Ouvrir l'administration » dans Mon compte, ou lien dans l'en-tête sur ordinateur. |

### Règles de calcul et d'affichage

- **Délai** (calculé automatiquement, fuseau Porto-Novo) : « Dans X j », « Aujourd'hui », « Échu depuis X j », « Terminé ».
- **Échue** : échéance passée et tâche non terminée. Elle est signalée en rouge discret (liseré et texte).
- **Terminée** : intitulé barré et grisé.
- **Bloquée** : pastille orange avec icône d'alerte.
- Compteur **En cours** et filtre « En cours » : toutes les tâches non terminées dont l'échéance n'est pas dépassée (à faire, en cours ou bloquées).
- Le **N°** est attribué automatiquement (1, 2, 3…). En cas d'import avec des N°, la numérotation reprend après le plus grand.

---

## 2. Structure du projet

```
agenda-crf-perfection/
├─ index.html                  Page HTML (méta PWA, iOS)
├─ package.json
├─ vite.config.js              Vite + PWA (manifest, service worker, cache)
├─ vercel.json                 Réécritures SPA + en-têtes de cache
├─ .env.example                Modèle des variables d'environnement
├─ logos/                     Logos officiels sources (non mis en ligne)
├─ public/
│  ├─ logo-entete.png          Symbole CRF pour l'en-tête (généré)
│  ├─ logo-connexion.png       Logo complet pour la connexion et le PDF (généré)
│  ├─ favicon.png              (généré)
│  ├─ sw-rappels.js            Réception des notifications push (inactif pour l'instant)
│  └─ icons/                   Icônes PWA 192, 512, maskable, apple-touch (générées)
├─ scripts/
│  └─ generer-icones.mjs       npm run icones : régénère icônes et logos depuis logos/
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_schema.sql       Tables, triggers (profil auto, historique, numérotation)
│  │  ├─ 0002_rls.sql          Politiques de sécurité (Row Level Security)
│  │  ├─ 0003_rappels.sql      Architecture des rappels (préparée, non planifiée)
│  │  ├─ 0004_admin.sql        État des comptes pour la page Administration
│  │  ├─ 0005_roles.sql        Séparation des rôles : admin (comptes) / DG (tâches)
│  │  ├─ 0006_visibilite_notifications.sql  Membres : leurs tâches uniquement ; notifications
│  │  ├─ 0007_ameliorations.sql Reports, projets, étapes, pièces jointes, récurrence, rappels
│  │  ├─ 0008_planification.sql Appel quotidien de la fonction de rappels (pg_cron)
│  │  ├─ 0009_emails_accuses.sql Emails de toutes les notifications, accusé de réception
│  │  ├─ 0010_chat_photos_cloture.sql Messagerie, photos de profil, compte rendu de clôture
│  │  └─ 0011_correctif_stockage.sql Droits de lecture du stockage
│  └─ functions/
│     ├─ admin-membres/        Invitation, désactivation et réactivation des comptes (admin)
│     ├─ notifier-attribution/ Bouton « Prévenir par email » (renvoi manuel)
│     ├─ envoyer-notifications/ Envoi par email de chaque notification (automatique)
│     └─ rappels-echeances/    Envoi des rappels (mode simulation tant que non activé)
└─ src/
   ├─ main.jsx, App.jsx        Démarrage, routes, garde de connexion
   ├─ styles/global.css        Charte graphique (mobile d'abord)
   ├─ assets/                  Police Inter (sous-ensemble latin, intégrée)
   ├─ lib/                     supabase, api, dates, statuts, droits, filtres,
   │                           export (Excel/PDF), import (CSV/Excel), notifications
   ├─ context/                 AuthContext, DonneesContext, ToastContext
   ├─ hooks/                   useMediaQuery, useInstallation, useChangementStatut
   ├─ components/              Disposition (en-tête + barre basse + bouton +), CarteTache,
   │                           TableauTaches, ListeTaches, AjoutRapide, FeuilleBas, MenuStatut,
   │                           PastilleStatut, SelecteurPersonnes, ChampEcheance, Icones…
   └─ pages/                   Connexion, DefinirMotDePasse, Accueil, Taches, FicheTache,
                               FormulaireTache, Calendrier, MonCompte, Administration, GestionMembres, Import…
```

### Base de données

| Table | Rôle |
|---|---|
| `profils` | id (lié à `auth.users`), nom_complet, email, role (`dg`, `admin`, `membre`), poste, telephone, actif |
| `taches` | id, **numero** (auto), intitule, description, date_creation (aujourd'hui par défaut), echeance, statut (`a_faire`, `en_cours`, `termine`, `bloque`), priorite (`normale`, `haute`), cree_par, date_terminee (automatique) |
| `attributions` | tache_id, profil_id (plusieurs attributaires par tâche) |
| `commentaires` | id, tache_id, auteur_id, texte, date |
| `historique` | tache_id, auteur_id, date, champ (`creation`, `statut`, `echeance`, `attribution`), ancienne_valeur, nouvelle_valeur. Rempli automatiquement par des triggers. |
| `preferences_rappels`, `abonnements_push`, `journal_rappels` | Rappels (voir §11) |

---

## 3. Créer le projet Supabase

1. Créez un compte sur <https://supabase.com>, puis **New project**.
   - Nom : `agenda-crf-perfection`
   - Région : **West EU (Paris)** ou **Central EU (Frankfurt)**, les plus proches de l'Afrique de l'Ouest
   - Notez le mot de passe de la base de données.
2. **Exécuter les migrations** : menu **SQL Editor**, puis **New query**. Copiez-collez le contenu de chaque fichier **dans cet ordre**, puis cliquez **Run** :
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_rls.sql`
   3. `supabase/migrations/0003_rappels.sql`
   4. `supabase/migrations/0004_admin.sql`
   5. `supabase/migrations/0005_roles.sql`
   6. `supabase/migrations/0006_visibilite_notifications.sql`
   7. `supabase/migrations/0007_ameliorations.sql`
   8. `supabase/migrations/0008_planification.sql` (après avoir déployé la fonction `rappels-echeances`, voir §11)
   9. `supabase/migrations/0009_emails_accuses.sql` (après 0008 ; puis déployer `envoyer-notifications`, voir §11 bis)
   10. `supabase/migrations/0010_chat_photos_cloture.sql` (messagerie, photos de profil, compte rendu de clôture)
   11. `supabase/migrations/0011_correctif_stockage.sql` (droits de lecture du stockage : photos et pièces jointes)

   Ou, en une seule fois : `supabase/installation_complete.sql`.

   Chaque exécution doit afficher « Success. No rows returned ».
3. **Fermer l'inscription libre** : **Authentication**, puis **Sign In / Providers**. Désactivez **Allow new users to sign up**. Laissez le fournisseur **Email** activé.
4. **Adresses autorisées** : **Authentication**, puis **URL Configuration** :
   - **Site URL** : l'adresse Vercel (par ex. `https://agenda-crf-perfection.vercel.app`). En attendant, mettez `http://localhost:5173`.
   - **Redirect URLs** : ajoutez `http://localhost:5173/**` et `https://agenda-crf-perfection.vercel.app/**`.
5. **Emails en français** (conseillé) : **Authentication**, puis **Email Templates** :
   - *Invite user*, sujet : `Invitation à l'Agenda CRF Perfection`. Corps :
     ```html
     <h2>Agenda CRF Perfection</h2>
     <p>Bonjour,</p>
     <p>La Direction Générale vous invite à utiliser l'agenda de suivi des tâches.</p>
     <p><a href="{{ .ConfirmationURL }}">Activer mon compte et choisir mon mot de passe</a></p>
     ```
   - *Reset password*, sujet : `Réinitialisation de votre mot de passe`. Corps :
     ```html
     <p>Bonjour,</p>
     <p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>
     <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
     ```
6. **Envoi des emails (important)** : le service d'email intégré de Supabase est limité à quelques messages par heure et sert surtout aux tests. Pour inviter toute l'équipe, configurez un SMTP dans **Project Settings**, puis **Authentication**, puis **SMTP Settings** (Brevo, Mailjet, Gmail Workspace, etc.).
7. **Déployer la fonction `admin-membres`**, nécessaire pour inviter et désactiver des membres. Deux méthodes :
   - **Depuis le tableau de bord** (le plus simple) : **Edge Functions**, puis **Deploy a new function**, puis **Via Editor**. Nommez-la exactement `admin-membres`, collez le contenu de `supabase/functions/admin-membres/index.ts`, puis **Deploy**.
   - **En ligne de commande**, dans PowerShell, à la racine du projet :
     ```powershell
     npx supabase login
     npx supabase init
     npx supabase link --project-ref VOTRE_REF_PROJET
     npx supabase functions deploy admin-membres
     ```
     Le *project ref* est l'identifiant visible dans l'URL du tableau de bord (`https://supabase.com/dashboard/project/<ref>`). Si `supabase init` demande d'écraser des fichiers, répondez **non**.

   Les clés nécessaires (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) sont fournies automatiquement à la fonction. Vous n'avez rien à configurer.

---

## 4. Variables d'environnement

Récupérez les valeurs dans **Project Settings**, puis **API** (ou **Data API** et **API Keys**) :

| Variable | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | Project URL, par ex. `https://abcdefghijkl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Clé **anon / publishable** (publique) |
| `VITE_NOTIFICATIONS_ACTIVES` | `false` (voir §11) |

> ⚠️ Ne mettez **jamais** la clé `service_role` / `secret` dans `.env` ni dans Vercel : elle donne tous les droits sur la base de données.

---

## 5. Lancer en local (Windows / PowerShell / VS Code)

Prérequis : **Node.js 18 ou plus récent** (version LTS conseillée, <https://nodejs.org>) et VS Code.

Dans VS Code, ouvrez le dossier `agenda-crf-perfection`, puis le terminal (**Ctrl + `**) :

```powershell
npm install
Copy-Item .env.example .env
code .env
```

Renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans `.env`, enregistrez, puis :

```powershell
npm run dev
```

Ouvrez <http://localhost:5173>.

**Tester sur votre téléphone (même Wi-Fi)** : `npm run dev` affiche aussi une adresse `Network: http://192.168.x.x:5173`. Ouvrez-la sur le téléphone. Si Windows le demande, autorisez Node.js dans le pare-feu. Pour vous connecter depuis cette adresse, ajoutez-la aussi dans les **Redirect URLs** de Supabase.

Autres commandes :

```powershell
npm run build     # compile la version de production dans dist/
npm run preview   # sert dist/ en local (test du mode PWA / hors ligne)
npm run icones    # régénère icônes et logos depuis logos/
```

---

## 6. Créer le premier compte administrateur

L'inscription libre est fermée : le premier compte se crée dans Supabase. C'est l'**administrateur** de l'agenda (par ex. `contact@crfperfection.pro`). Il crée ensuite tous les autres comptes, y compris celui du DG.

1. **Authentication**, puis **Users**, puis **Add user** et **Create new user** :
   - Email et mot de passe provisoire
   - Cochez **Auto Confirm User**
2. Le profil est créé automatiquement avec le rôle `membre`. Pour le passer **administrateur**, allez dans **SQL Editor** et exécutez :
   ```sql
   update public.profils
   set role = 'admin', nom_complet = 'Prénom NOM'
   where email = 'contact@crfperfection.pro';
   ```
3. Connectez-vous, puis allez dans **Mon compte**, **Ouvrir l'administration**, onglet **Membres**, et **Inviter**. Invitez le DG avec le rôle **Directeur Général**, puis le reste de l'équipe.

---

## 7. Déployer sur Vercel

1. Le code est sur GitHub : dépôt `tcbrenato/agenda-crf-perfection`, branche `main`.
2. Sur <https://vercel.com>, choisissez **Add New**, puis **Project**, puis **Import** du dépôt `agenda-crf-perfection`.
3. Réglages :
   - **Root Directory** : laisser la valeur par défaut (`./`)
   - **Framework Preset** : Vite (détecté automatiquement). Build : `npm run build`. Output : `dist`.
   - **Environment Variables** : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_NOTIFICATIONS_ACTIVES=false`
4. **Deploy**. Reportez ensuite l'adresse obtenue dans Supabase, **Authentication**, puis **URL Configuration** : *Site URL* et *Redirect URLs* (§3.4).
5. Domaine personnalisé (facultatif, par ex. `agenda.crfperfection.com`) : **Settings**, puis **Domains** dans Vercel. Ajoutez-le aussi dans Supabase.

Toute modification d'une variable d'environnement sur Vercel nécessite un **Redeploy**.

### Installer l'application sur le téléphone

- **Android (Chrome)** : ouvrez l'adresse, puis **Mon compte** et **Installer sur l'écran d'accueil**, ou le menu ⋮ puis **Installer l'application**.
- **iPhone (Safari)** : bouton **Partager**, puis **Sur l'écran d'accueil**.

---

## 8. Inviter les membres

Dans **Administration**, onglet **Membres**, puis **Inviter** : nom, email, rôle, poste, téléphone.
La personne reçoit un email, clique sur le lien et choisit son mot de passe.

- Seul l'**administrateur** a accès à cette page.
- **Changer le rôle** : liste déroulante (Membre, Directeur Général, Administrateur).
- **Désactiver** : la personne ne peut plus se connecter. Ses tâches et commentaires sont conservés. Le compte peut être réactivé à tout moment.
- **Renvoyer le lien** : renvoie l'invitation, ou un lien de réinitialisation si le compte est déjà activé.
- On ne peut ni modifier son propre rôle ni se désactiver, et il reste toujours au moins un administrateur actif.

---

## 9. Logo et icônes

Les logos officiels sont rangés dans `logos/`. Ce dossier n'est pas mis en ligne : ce sont les fichiers sources.

| Fichier source | Utilisation |
|---|---|
| `logos/logo-icone.png` (carré bleu nuit) | Icônes de l'application (écran d'accueil, PWA, favicon) |
| `logos/logo-symbole.png` (symbole CRF, fond blanc) | En-tête de l'application |
| `logos/logo-complet.png` (CRF PERFECTION + sous-titre) | Écran de connexion, en-tête des exports PDF |

Pour changer un logo, remplacez le fichier dans `logos/` (même nom), puis lancez :

```powershell
npm run icones
```

Le script régénère dans `public/` des versions légères : `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`, `favicon.png`, `logo-entete.png` et `logo-connexion.png`. Redéployez ensuite. Sur un téléphone où l'application est déjà installée, la nouvelle icône apparaît après réinstallation.

---

## 10. Import d'une liste existante

Dans **Administration**, onglet **Données**, puis **Importer un fichier** (administrateur) :

- Formats : **Excel `.xlsx`** ou **CSV** (séparateur `;` ou `,`, UTF-8 ou format « CSV » d'Excel). Pour un ancien fichier `.xls`, faites **Enregistrer sous**, puis **Classeur Excel (.xlsx)**.
- Première ligne : les titres **N°, Tâche, Date, Échéance, Attributaire**. Les colonnes **Statut** et **Description** sont facultatives. Les variantes courantes (« Intitulé », « Responsable », « Date limite »…) sont reconnues.
- Dates : `jj/mm/aaaa` (ou `jj/mm/aa`, ou une vraie date Excel).
- Attributaires : nom complet ou partiel (« Koffi », « K. Agbodjan »). Pour plusieurs personnes, séparez par `,` `;` `/` ou « et ». **Les membres doivent avoir été invités avant l'import.**
- Un **aperçu** signale chaque ligne : ✓ prête, ! avertissement (nom inconnu, N° déjà utilisé : numérotation automatique), ✕ ignorée (intitulé vide, échéance illisible).
- Un modèle CSV peut être téléchargé depuis cet écran.

---

## 11 bis. Notifications : dans l'application ET par email

Chaque notification de la cloche part aussi par email, depuis `contact@crfperfection.pro` : tâche confiée, tâche terminée ou bloquée, commentaire, demande de report, réponse à un report, accusé de réception. L'envoi est déclenché par la base dès la création de la notification (fonction `envoyer-notifications`), avec une vérification toutes les 10 minutes en cas d'échec et 3 tentatives au maximum. Les rappels du matin restent groupés dans un seul email (§11).

**Accusé de réception** : quand une tâche vous est confiée par quelqu'un d'autre, un bouton **« J'ai bien reçu »** apparaît sur l'accueil (« Nouvelles tâches à confirmer », avec « Tout confirmer »), sur la carte et sur la fiche. La personne qui a confié la tâche reçoit « X a bien reçu la tâche », dans la cloche et par email. Sur la fiche, chaque attributaire indique « ✓ Reçue le … » ou « En attente de confirmation de réception ».

**Mise en place de l'envoi des emails :**
1. **SQL Editor** : exécutez `0009_emails_accuses.sql` (après `0008`).
2. **Edge Functions**, puis **Deploy a new function**, puis **Via Editor** : nom `envoyer-notifications`, collez `supabase/functions/envoyer-notifications/index.ts`, puis **Deploy**. Ensuite, dans **Details**, **désactivez « Verify JWT »**.
3. Les secrets SMTP sont ceux ci-dessous (déjà en place si `notifier-attribution` fonctionne).

### Historique : notifications à l'attribution d'une tâche

**Dans l'application** : quand quelqu'un d'autre vous attribue une tâche, une notification apparaît sous la cloche (en haut sur téléphone, « Notifications » dans le menu sur ordinateur). Un message s'affiche aussi si l'application est ouverte. Ces notifications sont créées automatiquement par la base de données (migration 0006).

**Traçabilité** : sur la tâche, « Confiée par X » indique qui l'a attribuée, si ce n'est pas la personne elle-même. Sur la fiche, la date de l'attribution s'affiche aussi.

### Email

Quand le **DG** ou un **administrateur** attribue une tâche à quelqu'un, à la création ou en ajoutant un attributaire, la personne reçoit un email de `contact@crfperfection.pro`. L'email contient le N°, l'intitulé, l'échéance, la priorité, la description, qui l'a confiée, les co-attributaires et un bouton « Voir la tâche ».

- Pas d'email à soi-même, ni aux comptes désactivés, ni lors d'un import de liste.
- Un membre qui attribue sa propre tâche ne déclenche pas d'email.
- La fonction vérifie que l'attribution vient d'être faite par l'appelant (moins de 15 minutes), ce qui empêche les envois abusifs.

**Mise en place :**
1. **Edge Functions**, puis **Deploy a new function**, puis **Via Editor**. Nommez-la exactement `notifier-attribution`, collez `supabase/functions/notifier-attribution/index.ts`, puis **Deploy**.
2. **Edge Functions**, puis **Secrets** : ajoutez
   | Nom | Valeur |
   |---|---|
   | `SMTP_HOST` | `smtp.hostinger.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `contact@crfperfection.pro` |
   | `SMTP_PASS` | mot de passe de la boîte mail |
   | `APP_URL` | `https://agenda-crf-perfection.vercel.app` |
3. Testez : depuis le compte du DG, créez une tâche attribuée à un membre.
4. Pour une tâche déjà existante, le bouton **Prévenir par email** de la fiche (DG et administrateur) renvoie l'email à tous ses attributaires. En cas de problème, consultez **Edge Functions**, puis `notifier-attribution`, puis **Logs**.

---

## 11. Rappels, récapitulatif et sauvegarde automatiques

La fonction `rappels-echeances` est appelée **chaque matin à 8 h (heure de Porto-Novo)** :

| Quand | Quoi | Pour qui |
|---|---|---|
| Chaque jour | Rappel des tâches à rendre dans les 48 h et des tâches échues : un seul email par personne, plus une notification dans l'application | Chaque attributaire |
| Le lundi | Récapitulatif de la semaine : en retard, à rendre cette semaine, terminées la semaine passée, demandes de report à traiter | Le(s) DG |
| Le lundi | Sauvegarde complète des données (fichier JSON en pièce jointe) | Le(s) administrateur(s) |

Un même rappel n'est jamais envoyé deux fois : la fonction peut être appelée plusieurs fois sans risque.

**Mise en place :**
1. **Edge Functions** : ouvrez `rappels-echeances`, ou créez-la avec **Deploy a new function**, puis **Via Editor**. Collez `supabase/functions/rappels-echeances/index.ts`, puis **Deploy**.
2. Dans les réglages de la fonction (**Details**), **désactivez « Verify JWT »**, puis enregistrez. La planification l'appelle sans session.
3. Les secrets SMTP sont ceux de `notifier-attribution` (§11 bis) : rien à ajouter.
4. **SQL Editor** : exécutez `supabase/migrations/0008_planification.sql`. La dernière ligne doit afficher la tâche `agenda-rappels-quotidiens`.
5. Test immédiat : ouvrez `https://<projet>.supabase.co/functions/v1/rappels-echeances` dans un navigateur. La réponse indique combien de rappels ont été envoyés.

---

## 11 quater. Messagerie, photos de profil, clôture avec fichier

- **Messages** (onglet du menu) : discussion **Général** pour toute l'équipe, et **conversations privées** à deux (« Nouveau »). Les messages arrivent en direct (Supabase Realtime) et le nombre de non-lus s'affiche dans le menu. Pour supprimer un de ses messages : double-clic, ou double appui, sur la bulle. Les messages ne déclenchent pas d'email.
- **Photo de profil** : dans **Mon compte**, « Ajouter une photo ». L'image est recadrée en carré de 256 px (environ 25 Ko) et remplace les initiales partout. Conformément au cahier des charges, **aucune photo du DG n'est affichée** : l'option n'est pas proposée sur son compte (voir `src/components/Avatar.jsx` pour changer cette règle).
- **Terminer une tâche** (bouton, menu de statut ou glissement vers la droite) : une étape propose un **compte rendu** et le **fichier corrigé ou livrable**, tous deux facultatifs. Le fichier rejoint les pièces jointes de la tâche ; le DG, le créateur et la personne qui a confié la tâche sont prévenus, et l'email contient le compte rendu.

**Mise en place :** exécutez `0010_chat_photos_cloture.sql`, puis redéployez `envoyer-notifications` (nouvelle version qui inclut le compte rendu).

## 11 ter. Autres fonctions

| Fonction | Qui | Où |
|---|---|---|
| **Motif obligatoire pour « Bloquée »** | Tous | Le motif est ajouté en commentaire, et le DG et le créateur sont prévenus |
| **Le DG est prévenu** quand une tâche est terminée ou bloquée | Automatique | Cloche des notifications |
| **Notification sur les commentaires** | Attributaires et créateur | Cloche des notifications |
| **Demande de report d'échéance** | Un membre attributaire la demande ; le DG ou l'admin accepte ou refuse | Fiche de la tâche, accueil du DG (« Demandes de report à traiter ») |
| **Projets** (catégories) | Le DG ou l'admin les crée ; tout le monde peut les choisir | Menu **Projets**, filtre dans **Tâches**, colonne dans les exports |
| **Étapes (checklist)** | Le créateur, le DG ou l'admin les ajoutent ; les attributaires les cochent | Fiche de la tâche, avancement « ☑ 2/5 » sur les cartes |
| **Pièces jointes** (10 Mo max, stockage privé) | Toute personne qui voit la tâche | Fiche de la tâche |
| **Tâches récurrentes** (chaque semaine, chaque mois) | Formulaire, champ « Répéter » | Une fois la tâche terminée, la suivante est créée avec les mêmes attributaires et étapes |
| **Statistiques** : terminées à temps, retard moyen, par personne, par mois, par projet | DG et admin | Menu **Statistiques** |

---

## 12. Droits et sécurité

La sécurité est assurée **dans la base de données** (Row Level Security et triggers), pas seulement dans l'interface :

| Action | Administrateur | DG | Membre |
|---|---|---|---|
| Page **Administration** (comptes, rôles, invitations, import, journal) | ✅ | ❌ | ❌ |
| Voir les tâches | ✅ toutes | ✅ toutes | ✅ seulement les siennes (attribuées à lui ou créées par lui) |
| Projets, statistiques | ✅ | ✅ | ❌ (choisit un projet existant) |
| Accepter / refuser un report | ✅ | ✅ | ❌ (peut en demander un) |
| Créer une tâche | ✅ | ✅ | ✅ (il en devient le créateur) |
| Modifier une tâche (intitulé, échéance…) | ✅ toutes | ✅ toutes | ✅ seulement celles qu'il a créées |
| Changer le statut | ✅ toutes | ✅ toutes | ✅ tâches qui lui sont attribuées ou qu'il a créées |
| Commenter | ✅ toutes | ✅ toutes | ✅ tâches qui lui sont attribuées ou qu'il a créées |
| Assigner des attributaires | ✅ toutes | ✅ toutes | ✅ seulement sur ses propres tâches |
| Supprimer une tâche | ✅ | ✅ | ❌ |
| Exporter (Excel, PDF) | ✅ | ✅ | ✅ |
| Compte désactivé | aucun accès | aucun accès | aucun accès |

- Sur une tâche qui lui est attribuée, un membre ne peut changer **que le statut** : toute autre modification est refusée par le trigger `regles_tache`.
- Le N°, la date de création et le créateur ne peuvent pas être modifiés par un membre.
- L'historique est en lecture seule : il n'est écrit que par les triggers.
- La clé publique (`anon`) ne permet de lire aucune donnée sans être connecté.

Ces règles ont été vérifiées sur PostgreSQL 16 avec des scénarios DG, admin, membre et compte désactivé.

---

## 13. Dépannage

| Problème | Solution |
|---|---|
| Écran « Configuration requise » | `.env` absent ou incomplet. Relancez `npm run dev` après l'avoir modifié (sur Vercel : variables d'environnement puis Redeploy). |
| « Email ou mot de passe incorrect » pour le premier DG | Vérifiez que **Auto Confirm User** était coché, ou confirmez l'utilisateur dans Authentication > Users. |
| Le bouton « Ouvrir l'administration » n'apparaît pas | Normal pour le DG et les membres. Pour l'administrateur, vérifiez que son rôle est `admin` (étape 6.2). |
| « La fonction admin-membres n'est pas déployée » | Déployez la fonction (§3.7) avec exactement ce nom. |
| L'invitation n'arrive pas | Vérifiez les spams et la limite d'envoi du SMTP intégré (§3.6). Vérifiez aussi les Redirect URLs. |
| Le lien de l'email ouvre une page d'erreur | Ajoutez l'adresse de l'application dans les **Redirect URLs** (§3.4). Les liens expirent après 24 h : utilisez « Renvoyer le lien ». |
| Une nouvelle version n'apparaît pas | L'application se met à jour d'elle-même au lancement suivant. Fermez-la complètement puis rouvrez-la. |
| `npm install` échoue sur `sharp` | Mettez à jour Node.js (LTS), puis `npm install` à nouveau. `sharp` ne sert qu'à générer les icônes. |
