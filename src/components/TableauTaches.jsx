import PastilleStatut from './PastilleStatut'
import BadgesTache from './BadgesTache'
import { nomsAttribues, nomsConfieePar } from './CarteTache'
import { delai, estEchue, estTerminee } from '../lib/statuts'
import { formaterDate } from '../lib/dates'
import { peutChangerStatut } from '../lib/droits'

/** Vue tableau (ordinateur) : N° | Tâche | Date | Échéance | Attributaire | Statut | Délai */
export default function TableauTaches({ taches, profilsParId, jour, profil, onOuvrir, onMenu }) {
  return (
    <div className="carte tableau-conteneur">
      <table className="tableau">
        <thead>
          <tr>
            <th className="col-num">N°</th>
            <th>Tâche</th>
            <th>Date</th>
            <th>Échéance</th>
            <th>Attributaire</th>
            <th>Statut</th>
            <th>Délai</th>
          </tr>
        </thead>
        <tbody>
          {taches.map((t) => {
            const d = delai(t, jour)
            const par = nomsConfieePar(t, profilsParId, false)
            const classe = estTerminee(t) ? 'ligne--terminee' : estEchue(t, jour) ? 'ligne--echue' : ''
            return (
              <tr key={t.id} className={classe} onClick={() => onOuvrir(t)}>
                <td className="numero">{t.numero}</td>
                <td className="cellule-titre">
                  {t.intitule}
                  {t.priorite === 'haute' && !estTerminee(t) && <> <span className="badge-haute">Haute</span></>}
                  {par && <div className="confiee-par" style={{ fontWeight: 400 }}>Confiée par <strong>{par}</strong></div>}
                  {(() => {
                    const att = (t.attributionsDetail || []).filter((a) => a.recu_le === null && a.attribue_par && a.attribue_par !== a.profil_id)
                    return att.length > 0 && (
                      <div className="confiee-par" style={{ fontWeight: 400, color: '#8f4700' }}>
                        Réception non confirmée : {att.map((a) => profilsParId[a.profil_id]?.nom_complet).filter(Boolean).join(', ')}
                      </div>
                    )
                  })()}
                  <div className="ligne" style={{ gap: 10, flexWrap: 'wrap', fontWeight: 400 }}><BadgesTache tache={t} /></div>
                </td>
                <td>{formaterDate(t.date_creation)}</td>
                <td>{formaterDate(t.echeance)}</td>
                <td>{nomsAttribues(t, profilsParId, false)}</td>
                <td>
                  <PastilleStatut statut={t.statut} onClick={peutChangerStatut(profil, t) ? () => onMenu(t) : undefined} />
                </td>
                <td><span className={`delai ${d.classe}`}>{d.texte}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
