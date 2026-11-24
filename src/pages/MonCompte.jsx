import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeuilleBas from '../components/FeuilleBas'
import { IconeGroupe, IconeDossier, IconeStats, IconeCle, IconeSortie, IconeSuivant, IconeInstaller, IconeHorloge } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { useInstallation } from '../hooks/useInstallation'
import { messageErreur, modifierProfil } from '../lib/api'
import { supabase } from '../lib/supabase'
import { estAdmin, estGestionnaire } from '../lib/droits'
import { ROLES } from '../lib/statuts'
import Avatar from '../components/Avatar'
import { changerPhoto, retirerPhoto } from '../lib/api'
import { notificationsActives } from '../lib/notifications'

export default function MonCompte() {
  const { profil, setProfil, utilisateur, deconnexion } = useAuth()
  const { majProfil } = useDonnees()
  const toast = useToast()
  const installation = useInstallation()
  const [f, setF] = useState({ nom_complet: profil.nom_complet, poste: profil.poste || '', telephone: profil.telephone || '' })
  const [envoi, setEnvoi] = useState(false)
  const [mdpOuvert, setMdpOuvert] = useState(false)
  const [aideIOS, setAideIOS] = useState(false)
  const [mdp, setMdp] = useState({ nouveau: '', confirmation: '', erreur: '' })
  const champPhoto = useRef(null)
  const [envoiPhoto, setEnvoiPhoto] = useState(false)
  const photoAutorisee = profil.role !== 'dg' // cahier des charges : aucune photo du DG à l'écran

  const choisirPhoto = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = ''
    if (!fichier) return
    setEnvoiPhoto(true)
    try {
      const p = await changerPhoto(profil.id, fichier)
      setProfil(p)
      majProfil(p)
      toast.info('Photo de profil mise à jour')
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoiPhoto(false)
    }
  }

  const enleverPhoto = async () => {
    try {
      const p = await retirerPhoto(profil.id)
      setProfil(p)
      majProfil(p)
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  const modifie = f.nom_complet !== profil.nom_complet || f.poste !== (profil.poste || '') || f.telephone !== (profil.telephone || '')

  const enregistrer = async (e) => {
    e.preventDefault()
    if (!f.nom_complet.trim()) return toast.erreur('Le nom complet est obligatoire.')
    setEnvoi(true)
    try {
      const p = await modifierProfil(profil.id, {
        nom_complet: f.nom_complet.trim(),
        poste: f.poste.trim() || null,
        telephone: f.telephone.trim() || null
      })
      setProfil(p)
      majProfil(p)
      toast.info('Profil enregistré')
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const changerMotDePasse = async (e) => {
    e.preventDefault()
    if (mdp.nouveau.length < 8) return setMdp({ ...mdp, erreur: 'Au moins 8 caractères.' })
    if (mdp.nouveau !== mdp.confirmation) return setMdp({ ...mdp, erreur: 'Les deux mots de passe diffèrent.' })
    const { error } = await supabase.auth.updateUser({ password: mdp.nouveau })
    if (error) return setMdp({ ...mdp, erreur: messageErreur(error) })
    setMdp({ nouveau: '', confirmation: '', erreur: '' })
    setMdpOuvert(false)
    toast.info('Mot de passe modifié')
  }

  return (
    <>
      <h1 className="titre-page" style={{ marginBottom: 16 }}>Mon compte</h1>

      <div className="carte carte--padding ligne" style={{ gap: 14, marginBottom: 16 }}>
        <div className="photo-profil">
          <Avatar profil={profil} taille="grand" />
          {photoAutorisee && (
            <>
              <input ref={champPhoto} type="file" accept="image/*" hidden onChange={choisirPhoto} />
              <button type="button" className="photo-profil__bouton" onClick={() => champPhoto.current.click()} disabled={envoiPhoto} aria-label="Changer ma photo de profil">
                📷
              </button>
            </>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1.0625rem' }}>{profil.nom_complet}</div>
          <div className="texte-doux texte-petit" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{utilisateur?.email}</div>
          <span className={`etiquette-role etiquette-role--${profil.role}`} style={{ marginTop: 4 }}>{ROLES[profil.role]}</span>
          {photoAutorisee && (
            <div className="ligne" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--fantome" style={{ minHeight: 34, padding: '0 6px', fontSize: '0.875rem' }} onClick={() => champPhoto.current.click()} disabled={envoiPhoto}>
                {envoiPhoto ? 'Envoi…' : profil.photo_url ? 'Changer ma photo' : 'Ajouter une photo'}
              </button>
              {profil.photo_url && (
                <button type="button" className="btn btn--fantome" style={{ minHeight: 34, padding: '0 6px', fontSize: '0.875rem', color: 'var(--texte-doux)' }} onClick={enleverPhoto}>Retirer</button>
              )}
            </div>
          )}
        </div>
      </div>

      {estAdmin(profil) && (
        <Link to="/admin" className="btn btn--accent btn--bloc" style={{ marginBottom: 16 }}>
          <IconeGroupe /> Ouvrir l'administration
        </Link>
      )}

      <form className="carte carte--padding pile" onSubmit={enregistrer}>
        <h2 style={{ fontSize: '1rem' }}>Mon profil</h2>
        <div className="champ">
          <label htmlFor="nom">Nom complet</label>
          <input id="nom" className="saisie" value={f.nom_complet} onChange={(e) => setF({ ...f, nom_complet: e.target.value })} autoComplete="name" />
        </div>
        <div className="champ">
          <label htmlFor="poste">Poste</label>
          <input id="poste" className="saisie" value={f.poste} onChange={(e) => setF({ ...f, poste: e.target.value })} placeholder="Ex. : Comptable" />
        </div>
        <div className="champ">
          <label htmlFor="tel">Téléphone</label>
          <input id="tel" className="saisie" type="tel" inputMode="tel" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} placeholder="+229 01 00 00 00 00" autoComplete="tel" />
        </div>
        <button className="btn btn--primaire btn--bloc" type="submit" disabled={!modifie || envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>


      {estGestionnaire(profil) && (
        <>
          <h2 className="titre-section">Pilotage</h2>
          <nav className="carte liste-reglages" style={{ padding: '0 14px' }}>
            <Link to="/statistiques"><IconeStats /> Statistiques de l'équipe <IconeSuivant className="chevron" /></Link>
            <Link to="/projets"><IconeDossier /> Projets <IconeSuivant className="chevron" /></Link>
          </nav>
        </>
      )}

      <h2 className="titre-section">Application</h2>
      <div className="carte liste-reglages" style={{ padding: '0 14px' }}>
        {!installation.estInstallee && (installation.peutInstaller || installation.estIOS) && (
          <button type="button" className="lien" onClick={() => (installation.peutInstaller ? installation.installer() : setAideIOS(true))}>
            <IconeInstaller /> Installer sur l'écran d'accueil <IconeSuivant className="chevron" />
          </button>
        )}
        <button type="button" className="lien" onClick={() => setMdpOuvert(true)}>
          <IconeCle /> Changer mon mot de passe <IconeSuivant className="chevron" />
        </button>
        <div className="ligne" style={{ minHeight: 56, gap: 12, padding: '0 4px', borderBottom: '1px solid var(--bordure)' }}>
          <IconeHorloge style={{ width: 22, height: 22, color: 'var(--bleu-nuit)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Rappels d'échéance</div>
            <div className="texte-doux texte-tres-petit">{notificationsActives ? 'Disponibles' : 'Bientôt disponibles (48 h avant, tâche échue)'}</div>
          </div>
        </div>
        <button type="button" className="lien" onClick={deconnexion} style={{ color: 'var(--rouge)' }}>
          <IconeSortie style={{ color: 'var(--rouge)' }} /> Se déconnecter
        </button>
      </div>

      <p className="texte-doux texte-tres-petit" style={{ textAlign: 'center', marginTop: 20 }}>
        Agenda CRF Perfection · version {__VERSION_APP__}
      </p>

      <FeuilleBas ouvert={mdpOuvert} titre="Changer mon mot de passe" onFermer={() => setMdpOuvert(false)}>
        <form className="pile" onSubmit={changerMotDePasse}>
          <div className="champ">
            <label htmlFor="n-mdp">Nouveau mot de passe</label>
            <input id="n-mdp" className="saisie" type="password" autoComplete="new-password" value={mdp.nouveau} onChange={(e) => setMdp({ ...mdp, nouveau: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor="c-mdp">Confirmer</label>
            <input id="c-mdp" className="saisie" type="password" autoComplete="new-password" value={mdp.confirmation} onChange={(e) => setMdp({ ...mdp, confirmation: e.target.value })} />
          </div>
          {mdp.erreur && <p className="message-erreur">{mdp.erreur}</p>}
          <button className="btn btn--primaire btn--bloc" type="submit">Enregistrer</button>
        </form>
      </FeuilleBas>

      <FeuilleBas ouvert={aideIOS} titre="Installer sur iPhone" onFermer={() => setAideIOS(false)}>
        <ol className="pile" style={{ paddingLeft: 20, margin: 0 }}>
          <li>Ouvrez l'agenda dans <strong>Safari</strong>.</li>
          <li>Touchez le bouton <strong>Partager</strong> (carré avec une flèche vers le haut).</li>
          <li>Choisissez <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</li>
        </ol>
      </FeuilleBas>
    </>
  )
}
