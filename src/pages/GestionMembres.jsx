import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FeuilleBas from '../components/FeuilleBas'
import { IconePlus, IconeRetour } from '../components/Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { adminMembres, chargerEtatComptes, messageErreur, modifierProfil } from '../lib/api'
import { formaterHorodatage } from '../lib/dates'
import { ROLES } from '../lib/statuts'
import Avatar from '../components/Avatar'

const VIDE = { email: '', nom_complet: '', role: 'membre', poste: '', telephone: '' }

export default function GestionMembres({ integre = false }) {
  const { profil } = useAuth()
  const { profils, majProfil, recharger } = useDonnees()
  const toast = useToast()
  const naviguer = useNavigate()
  const [inviter, setInviter] = useState(false)
  const [f, setF] = useState(VIDE)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [etats, setEtats] = useState(null)

  useEffect(() => {
    chargerEtatComptes().then(setEtats)
  }, [profils.length])

  const tries = [...profils].sort((a, b) => (b.actif - a.actif) || a.nom_complet.localeCompare(b.nom_complet, 'fr'))

  const [edition, setEdition] = useState(null) // membre en cours de modification

  const enregistrerMembre = async (e) => {
    e.preventDefault()
    if (!edition.nom_complet.trim()) return toast.erreur('Le nom complet est obligatoire.')
    setEnCours(edition.id)
    try {
      majProfil(await modifierProfil(edition.id, {
        nom_complet: edition.nom_complet.trim(),
        poste: edition.poste.trim() || null,
        telephone: edition.telephone.trim() || null
      }))
      toast.info('Informations enregistrées')
      setEdition(null)
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnCours(null)
    }
  }

  const envoyerInvitation = async (e) => {
    e.preventDefault()
    setErreur('')
    if (!f.nom_complet.trim()) return setErreur('Indiquez le nom complet.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErreur('Adresse email invalide.')
    const existant = profils.find((p) => (p.email || '').toLowerCase() === f.email.trim().toLowerCase())
    if (existant) {
      return setErreur(`Ce compte existe déjà (${existant.nom_complet}). Fermez cette fenêtre et utilisez « Modifier » sur sa ligne.`)
    }
    setEnvoi(true)
    try {
      await adminMembres('inviter', f)
      await recharger()
      setInviter(false)
      setF(VIDE)
      toast.info(`Invitation envoyée à ${f.email.trim()}`)
    } catch (err) {
      setErreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const changerRole = async (p, role) => {
    setEnCours(p.id)
    try {
      majProfil(await modifierProfil(p.id, { role }))
      toast.info(`${p.nom_complet} : ${ROLES[role]}`)
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnCours(null)
    }
  }

  const basculerAcces = async (p) => {
    setConfirmation(null)
    setEnCours(p.id)
    try {
      await adminMembres(p.actif ? 'desactiver' : 'reactiver', { profil_id: p.id })
      majProfil({ id: p.id, actif: !p.actif })
      toast.info(p.actif ? `${p.nom_complet} a été désactivé(e)` : `${p.nom_complet} a été réactivé(e)`)
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnCours(null)
    }
  }

  const renvoyer = async (p) => {
    setEnCours(p.id)
    try {
      const r = await adminMembres('renvoyer_invitation', { email: p.email })
      toast.info(r?.message || 'Invitation renvoyée')
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnCours(null)
    }
  }

  return (
    <>
      {!integre && (
        <button type="button" className="btn btn--fantome btn--petit retour" onClick={() => naviguer('/compte')}>
          <IconeRetour /> Mon compte
        </button>
      )}
      <div className="ligne ligne--espace" style={{ marginBottom: 12 }}>
        {integre ? <h2 className="titre-section" style={{ margin: 0 }}>Membres</h2> : <h1 className="titre-page">Membres</h1>}
        <button className="btn btn--accent btn--petit" onClick={() => { setErreur(''); setInviter(true) }}>
          <IconePlus /> Inviter
        </button>
      </div>
      <p className="texte-doux texte-petit" style={{ marginBottom: 12 }}>
        {profils.filter((p) => p.actif).length} membres actifs. Les nouveaux comptes sont créés uniquement par invitation.
      </p>

      <div className="carte liste-membres" style={{ padding: '0 14px' }}>
        {tries.map((p) => {
          const moi = p.id === profil.id
          return (
            <div key={p.id} className={`membre ${p.actif ? '' : 'membre--inactif'}`}>
              <Avatar profil={p} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{p.nom_complet}{moi && ' (vous)'}</div>
                <div className="texte-doux texte-petit" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.poste || '—'} · {p.email}</div>
                {!p.actif && <div className="texte-petit" style={{ color: 'var(--rouge)', fontWeight: 600 }}>Compte désactivé</div>}
                {p.actif && etats?.[p.id] && (
                  etats[p.id].compte_active ? (
                    <div className="texte-tres-petit texte-doux">Dernière connexion : {formaterHorodatage(etats[p.id].derniere_connexion)}</div>
                  ) : (
                    <div className="texte-tres-petit" style={{ color: '#8f4700', fontWeight: 600 }}>Invitation en attente (envoyée le {formaterHorodatage(etats[p.id].invite_le)})</div>
                  )
                )}
                <div className="ligne" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  <select
                    className="saisie"
                    style={{ width: 'auto', minHeight: 44, flex: '1 1 160px' }}
                    value={p.role}
                    disabled={moi || enCours === p.id || !p.actif}
                    onChange={(e) => changerRole(p, e.target.value)}
                    aria-label={`Rôle de ${p.nom_complet}`}
                  >
                    {Object.entries(ROLES).map(([cle, libelle]) => (
                      <option key={cle} value={cle}>{libelle}</option>
                    ))}
                  </select>
                  {!moi && (
                    <button
                      type="button"
                      className={`btn btn--petit ${p.actif ? 'btn--alerte' : 'btn--secondaire'}`}
                      disabled={enCours === p.id}
                      onClick={() => (p.actif ? setConfirmation(p) : basculerAcces(p))}
                    >
                      {p.actif ? 'Désactiver' : 'Réactiver'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--secondaire btn--petit"
                    disabled={enCours === p.id}
                    onClick={() => setEdition({ id: p.id, nom_complet: p.nom_complet || '', poste: p.poste || '', telephone: p.telephone || '', email: p.email })}
                  >
                    Modifier
                  </button>
                  {!moi && p.actif && (
                    <button type="button" className="btn btn--fantome btn--petit" disabled={enCours === p.id} onClick={() => renvoyer(p)}>
                      Renvoyer le lien
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <FeuilleBas ouvert={Boolean(edition)} titre="Modifier le membre" onFermer={() => setEdition(null)}>
        {edition && (
          <form className="pile" onSubmit={enregistrerMembre} noValidate>
            <p className="texte-doux texte-petit">{edition.email}</p>
            <div className="champ">
              <label htmlFor="mod-nom">Nom complet *</label>
              <input id="mod-nom" className="saisie" value={edition.nom_complet} onChange={(e) => setEdition({ ...edition, nom_complet: e.target.value })} autoComplete="off" />
            </div>
            <div className="champ">
              <label htmlFor="mod-poste">Poste</label>
              <input id="mod-poste" className="saisie" value={edition.poste} onChange={(e) => setEdition({ ...edition, poste: e.target.value })} />
            </div>
            <div className="champ">
              <label htmlFor="mod-tel">Téléphone</label>
              <input id="mod-tel" className="saisie" type="tel" inputMode="tel" value={edition.telephone} onChange={(e) => setEdition({ ...edition, telephone: e.target.value })} />
            </div>
            <p className="aide texte-tres-petit texte-doux">Le rôle et l'accès se changent directement dans la liste.</p>
            <button className="btn btn--primaire btn--bloc" type="submit" disabled={enCours === edition.id}>Enregistrer</button>
          </form>
        )}
      </FeuilleBas>

      <FeuilleBas ouvert={inviter} titre="Inviter un membre" onFermer={() => setInviter(false)}>
        <form className="pile" onSubmit={envoyerInvitation} noValidate>
          <div className="champ">
            <label htmlFor="inv-nom">Nom complet *</label>
            <input id="inv-nom" className="saisie" value={f.nom_complet} onChange={(e) => setF({ ...f, nom_complet: e.target.value })} autoComplete="off" autoFocus />
          </div>
          <div className="champ">
            <label htmlFor="inv-email">Email *</label>
            <input id="inv-email" className="saisie" type="email" inputMode="email" autoCapitalize="none" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
          </div>
          <div className="champ">
            <label htmlFor="inv-role">Rôle</label>
            <select id="inv-role" className="saisie" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="membre">Membre</option>
              <option value="dg">Directeur Général</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <div className="champ">
            <label htmlFor="inv-poste">Poste</label>
            <input id="inv-poste" className="saisie" value={f.poste} onChange={(e) => setF({ ...f, poste: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor="inv-tel">Téléphone</label>
            <input id="inv-tel" className="saisie" type="tel" inputMode="tel" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} />
          </div>
          <p className="aide texte-tres-petit texte-doux">La personne recevra un email pour choisir son mot de passe.</p>
          {erreur && <p className="message-erreur" role="alert">{erreur}</p>}
          <button className="btn btn--primaire btn--bloc" type="submit" disabled={envoi}>{envoi ? 'Envoi…' : "Envoyer l'invitation"}</button>
        </form>
      </FeuilleBas>

      <FeuilleBas ouvert={Boolean(confirmation)} titre="Désactiver ce compte ?" onFermer={() => setConfirmation(null)}>
        {confirmation && (
          <div className="pile">
            <p><strong>{confirmation.nom_complet}</strong> ne pourra plus se connecter. Ses tâches et commentaires sont conservés. Vous pourrez réactiver le compte à tout moment.</p>
            <button className="btn btn--accent btn--bloc" onClick={() => basculerAcces(confirmation)}>Désactiver</button>
            <button className="btn btn--secondaire btn--bloc" onClick={() => setConfirmation(null)}>Annuler</button>
          </div>
        )}
      </FeuilleBas>
    </>
  )
}
