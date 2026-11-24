import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AjoutRapide from './AjoutRapide'
import Notifications from './Notifications'
import { IconeAccueil, IconeCalendrier, IconeCompte, IconeGroupe, IconePlus, IconeTaches } from './Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { useNotifications } from '../hooks/useNotifications'
import { estEchue, ROLES } from '../lib/statuts'
import { initiales } from '../lib/texte'
import { estAdmin } from '../lib/droits'

const LIENS = [
  { vers: '/', libelle: 'Accueil', Icone: IconeAccueil, fin: true },
  { vers: '/taches', libelle: 'Tâches', Icone: IconeTaches },
  { vers: '/calendrier', libelle: 'Calendrier', Icone: IconeCalendrier },
  { vers: '/compte', libelle: 'Mon compte', Icone: IconeCompte }
]

export default function Disposition() {
  const { profil } = useAuth()
  const { taches, jour, profilsParId, recharger } = useDonnees()
  const toast = useToast()
  const naviguer = useNavigate()
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const { pathname } = useLocation()

  // Nouvelle tâche confiée pendant que l'application est ouverte : message + actualisation
  const notifications = useNotifications({
    surNouvelle: (nouvelles) => {
      recharger()
      const n = nouvelles[0]
      const auteur = profilsParId[n.auteur_id]?.nom_complet || 'Quelqu’un'
      toast.info(
        nouvelles.length > 1 ? `${nouvelles.length} nouvelles tâches vous ont été confiées` : `${auteur} vous a confié la tâche N° ${n.taches?.numero ?? ''}`,
        n.taches ? { action: { libelle: 'Voir', onClick: () => naviguer(`/taches/${n.taches.id}`) } } : undefined
      )
    }
  })

  const nbEchues = taches.filter((t) => estEchue(t, jour)).length
  const masquerFab = /\/(nouvelle|modifier)$/.test(pathname) || pathname.startsWith('/compte') || pathname.startsWith('/admin')
  const admin = estAdmin(profil)

  const pastilleEchues = nbEchues > 0 && (
    <span className="pastille-nombre" aria-label={`${nbEchues} échues`}>{nbEchues > 99 ? '99+' : nbEchues}</span>
  )

  return (
    <div className="app">
      {/* ---------- Ordinateur : barre latérale (style logiciel) ---------- */}
      <aside className="barre-laterale" aria-label="Navigation principale">
        <div className="barre-laterale__marque">
          <img src="/logo-entete.png" alt="CRF Perfection" width="87" height="36" />
          <div className="entete__titre">Agenda<small>CRF Perfection</small></div>
        </div>

        <button type="button" className="btn btn--accent btn--bloc" onClick={() => setAjoutOuvert(true)}>
          <IconePlus /> Nouvelle tâche
        </button>

        <nav className="barre-laterale__nav">
          {LIENS.map(({ vers, libelle, Icone, fin }) => (
            <NavLink key={vers} to={vers} end={fin} className="lien-lateral">
              <Icone /> {libelle}
              {vers === '/taches' && pastilleEchues}
            </NavLink>
          ))}
          <Notifications notifications={notifications} variante="menu" />
          {admin && (
            <NavLink to="/admin" className="lien-lateral">
              <IconeGroupe /> Administration
            </NavLink>
          )}
        </nav>

        <NavLink to="/compte" className="barre-laterale__profil">
          <span className="avatar">{initiales(profil?.nom_complet)}</span>
          <span style={{ minWidth: 0 }}>
            <strong>{profil?.nom_complet}</strong>
            <small>{ROLES[profil?.role]}</small>
          </span>
        </NavLink>
      </aside>

      {/* ---------- Téléphone : en-tête ---------- */}
      <header className="entete">
        <div className="entete__barre">
          <img className="entete__logo" src="/logo-entete.png" alt="CRF Perfection" width="87" height="36" />
          <div className="entete__titre">
            Agenda
            <small>CRF Perfection</small>
          </div>
          <div className="entete__droite">
            <Notifications notifications={notifications} />
            <NavLink to="/compte" className="avatar" title={`${profil?.nom_complet} — ${ROLES[profil?.role] || ''}`} aria-label="Mon compte" style={{ textDecoration: 'none' }}>
              {initiales(profil?.nom_complet)}
            </NavLink>
          </div>
        </div>
      </header>

      <main className="contenu">
        <Outlet />
      </main>

      {!masquerFab && (
        <button type="button" className="fab" onClick={() => setAjoutOuvert(true)} aria-label="Ajouter une tâche">
          <IconePlus />
        </button>
      )}

      {/* ---------- Téléphone : barre du bas ---------- */}
      <nav className="nav-basse" aria-label="Navigation">
        {LIENS.map(({ vers, libelle, Icone, fin }) => (
          <NavLink key={vers} to={vers} end={fin}>
            <Icone />
            {libelle}
            {vers === '/taches' && pastilleEchues}
          </NavLink>
        ))}
      </nav>

      <AjoutRapide ouvert={ajoutOuvert} onFermer={() => setAjoutOuvert(false)} />
    </div>
  )
}
