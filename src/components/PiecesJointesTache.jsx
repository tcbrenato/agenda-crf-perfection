import { useEffect, useRef, useState } from 'react'
import { IconeFichier, IconePoubelle, IconeImporter } from './Icones'
import { useAuth } from '../context/AuthContext'
import { useDonnees } from '../context/DonneesContext'
import { useToast } from '../context/ToastContext'
import { ajouterPieceJointe, chargerPiecesJointes, lienPieceJointe, messageErreur, supprimerPieceJointe } from '../lib/api'
import { formaterHorodatage } from '../lib/dates'
import { estGestionnaire, peutCommenter } from '../lib/droits'

function taille(octets) {
  if (!octets) return ''
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

/** Pièces jointes d'une tâche (PDF, images, documents — 10 Mo maximum). */
export default function PiecesJointesTache({ tache }) {
  const { profil } = useAuth()
  const { profilsParId } = useDonnees()
  const toast = useToast()
  const champ = useRef(null)
  const [pieces, setPieces] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    chargerPiecesJointes(tache.id).then(setPieces).catch(() => setPieces(null))
  }, [tache.id])

  if (pieces === null) return null
  const peutAjouter = peutCommenter(profil, tache)
  if (!pieces.length && !peutAjouter) return null

  const choisir = async (e) => {
    const fichiers = [...(e.target.files || [])]
    e.target.value = ''
    if (!fichiers.length) return
    setEnvoi(true)
    try {
      for (const f of fichiers) {
        const pj = await ajouterPieceJointe(tache.id, f)
        setPieces((l) => [...l, pj])
      }
      toast.info(fichiers.length > 1 ? `${fichiers.length} fichiers ajoutés` : 'Fichier ajouté')
    } catch (err) {
      toast.erreur(messageErreur(err))
    } finally {
      setEnvoi(false)
    }
  }

  const ouvrir = async (pj) => {
    try {
      window.open(await lienPieceJointe(pj.chemin, pj.nom), '_blank', 'noopener')
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  const retirer = async (pj) => {
    if (!window.confirm(`Supprimer « ${pj.nom} » ?`)) return
    try {
      await supprimerPieceJointe(pj)
      setPieces((l) => l.filter((x) => x.id !== pj.id))
    } catch (err) {
      toast.erreur(messageErreur(err))
    }
  }

  return (
    <section>
      <h2 className="titre-section">Pièces jointes <span className="compte">({pieces.length})</span></h2>
      <div className="carte" style={{ padding: '2px 14px' }}>
        {pieces.map((pj) => (
          <div key={pj.id} className="etape">
            <button type="button" className="piece-jointe" onClick={() => ouvrir(pj)}>
              <IconeFichier />
              <span style={{ minWidth: 0 }}>
                <span className="piece-jointe__nom">{pj.nom}</span>
                <span className="texte-tres-petit texte-doux">
                  {taille(pj.taille)} · {profilsParId[pj.ajoute_par]?.nom_complet || '—'} · {formaterHorodatage(pj.cree_le)}
                </span>
              </span>
            </button>
            {(pj.ajoute_par === profil.id || estGestionnaire(profil)) && (
              <button type="button" className="btn-icone" onClick={() => retirer(pj)} aria-label={`Supprimer ${pj.nom}`}><IconePoubelle /></button>
            )}
          </div>
        ))}
        {pieces.length === 0 && <p className="texte-doux texte-petit" style={{ padding: '12px 0' }}>Aucun fichier.</p>}
        {peutAjouter && (
          <>
            <input ref={champ} type="file" multiple hidden onChange={choisir} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*" />
            <button type="button" className="btn btn--secondaire btn--bloc" style={{ margin: '10px 0' }} disabled={envoi} onClick={() => champ.current.click()}>
              <IconeImporter /> {envoi ? 'Envoi en cours…' : 'Ajouter un fichier (10 Mo max)'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
