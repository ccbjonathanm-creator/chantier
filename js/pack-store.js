(function () {
  "use strict";
  window.Chantier = window.Chantier || {};
  const copie = (x) => JSON.parse(JSON.stringify(x));
  function creer(pack, infosDefaut, catalogueDefaut, contratsDefaut) {
    const api = () => window.Chantier.api;
    const cle = (type) => "chantier_demo_pack:" + (type === "infos" ? "entreprise" : pack) + ":" + type;
    async function liste(type) {
      if (api().estCloud) return api().listPackDonnees(type === "infos" ? "entreprise" : pack, type);
      const raw = localStorage.getItem(cle(type));
      if (raw !== null) return JSON.parse(raw);
      const defaults = type === "infos" ? [{ ...infosDefaut(), id: "infos" }]
        : type === "catalogue" ? catalogueDefaut().map((p, i) => ({ ...p, id: "modele_" + i }))
        : contratsDefaut ? contratsDefaut() : [];
      localStorage.setItem(cle(type), JSON.stringify(defaults));
      return copie(defaults);
    }
    async function sauver(type, data) {
      if (type === "catalogue" && (!String(data.libelle || "").trim() || !Number.isFinite(Number(data.prixHT)) || Number(data.prixHT) < 0)) throw new Error("Indiquez un libellé et un prix positif ou nul.");
      if (type === "contrats" && (!String(data.client || "").trim() || !Number.isInteger(Number(data.frequenceMois)) || Number(data.frequenceMois) < 1 || Number(data.frequenceMois) > 60 || !Number.isFinite(Number(data.montant)) || Number(data.montant) < 0)) throw new Error("Vérifiez le client, la fréquence (1 à 60 mois) et le tarif du contrat.");
      const row = { ...data, id: data.id || crypto.randomUUID() };
      if (api().estCloud) return api().savePackDonnee(type === "infos" ? "entreprise" : pack, type, row);
      const rows = await liste(type), index = rows.findIndex((r) => r.id === row.id);
      if (index < 0) rows.push(row); else rows[index] = row;
      localStorage.setItem(cle(type), JSON.stringify(rows));
      return copie(row);
    }
    async function supprimer(type, id) {
      if (api().estCloud) return api().deletePackDonnee(pack, type, id);
      localStorage.setItem(cle(type), JSON.stringify((await liste(type)).filter((r) => r.id !== id)));
      return true;
    }
    return {
      async infos() {
        const rows = await liste("infos");
        if (rows.length) return rows[0];
        const p = await api().getParametresFacturation(), v = p.vendeurSnapshot || {};
        return { raisonSociale: v.nom || (api().infoEntreprise() || {}).nom || "", siret: v.siret || "", adresse: [v.adresse, v.codePostal, v.ville].filter(Boolean).join(", "), tel: v.telephone || "", email: v.email || "", assureur: "", assurancePolice: "", tvaIntra: "" };
      },
      setInfos: (data) => sauver("infos", { ...data, id: "infos" }),
      contrats: () => liste("contrats"), saveContrat: (data) => sauver("contrats", data), deleteContrat: (id) => supprimer("contrats", id),
      catalogue: () => liste("catalogue"), savePresta: (data) => sauver("catalogue", data), deletePresta: (id) => supprimer("catalogue", id),
    };
  }
  window.Chantier.packStore = { creer };
})();
