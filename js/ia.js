/*
 * ia.js - Couche IA (reformulation des notes vocales de chantier) + reconnaissance vocale.
 *
 * - Cle Groq de l'utilisateur (BYOK), stockee en local sur l'appareil, jamais dans le code.
 * - La reconnaissance vocale utilise le service du navigateur (Chrome, fr-FR).
 */
(function () {
  "use strict";

  const KEY_STORE = "chantier_ia_key";
  const MODELE = "llama-3.3-70b-versatile";

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    if (k) localStorage.setItem(KEY_STORE, k.trim());
    else localStorage.removeItem(KEY_STORE);
  }
  function aKey() { return !!getKey(); }

  // Transforme une note vocale brute en compte-rendu de chantier propre.
  async function reformuler(brut, contexte) {
    const key = getKey();
    if (!key) throw new Error("no-key");
    const sys = "Tu es l'assistant d'un plombier professionnel. On te donne une note vocale brute prise sur un chantier, souvent mal ponctuee. Reformule-la en un compte-rendu de chantier clair et concis en francais, a la premiere personne. Structure si pertinent : ce qui a ete fait, ce qui reste a faire, le materiel a prevoir, les points d'attention. Phrases courtes, pas de bla-bla, pas de formule de politesse. N'invente aucune information qui n'est pas dans la note.";
    const user = "Chantier concerne : " + (contexte || "non precise") + ".\nNote vocale brute : \"" + brut + "\"";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: MODELE,
        temperature: 0.3,
        messages: [ { role: "system", content: sys }, { role: "user", content: user } ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("api-" + res.status + (t ? ": " + t.slice(0, 120) : ""));
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content || "").trim();
  }

  // Assistant de planning : interprete un ordre en langage naturel du patron
  // et renvoie une action structuree A CONFIRMER (ne modifie rien lui-meme).
  async function assistantPlanning(commande, ctx) {
    const key = getKey();
    if (!key) throw new Error("no-key");
    const sys = [
      "Tu es l'assistant de planning d'une entreprise de plomberie. Le patron te donne un ordre en langage naturel pour MODIFIER un chantier existant : le deplacer a d'autres dates, et/ou le reassigner a un autre employe.",
      "Aujourd'hui nous sommes le " + ctx.today + ". Resous toute date relative (demain, apres-demain, lundi prochain, la semaine prochaine...) en date absolue au format AAAA-MM-JJ a partir d'aujourd'hui.",
      "Employes disponibles (id -> nom) : " + JSON.stringify(ctx.employes) + ".",
      "Chantiers existants : " + JSON.stringify(ctx.chantiers) + ".",
      "Identifie le chantier vise par le nom du client (approximatif tolere). Renvoie UNIQUEMENT un objet JSON, sans texte autour, avec ce format exact :",
      '{"chantierId": "<id du chantier ou null>", "changements": {"date": "AAAA-MM-JJ ou null", "dateFin": "AAAA-MM-JJ ou null", "employeId": "<id ou null>"}, "resume": "<phrase en francais decrivant clairement l action a confirmer>", "question": "<question si le chantier est introuvable ou la demande ambigue, sinon null>"}',
      "Ne mets dans 'changements' que les champs reellement modifies, les autres restent null. Si un chantier d'un seul jour est deplace a une nouvelle date, mets date ET dateFin a cette meme date. Si tu ne trouves pas le chantier ou si c'est ambigu, mets chantierId a null et pose une question courte.",
    ].join("\n");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: MODELE,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [ { role: "system", content: sys }, { role: "user", content: commande } ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("api-" + res.status + (t ? ": " + t.slice(0, 120) : ""));
    }
    const data = await res.json();
    const raw = (data.choices && data.choices[0] && data.choices[0].message.content || "").trim();
    try {
      return JSON.parse(raw);
    } catch (e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("reponse-illisible");
    }
  }

  // --- Reconnaissance vocale (dictee) ---
  function dispo() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  // Cree un dicteur. onUpdate(texteFinal, interim) est appele en direct.
  function creerDicteur(onUpdate, onFin, onErreur) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      onUpdate(final.trim(), interim);
    };
    rec.onerror = (e) => { if (onErreur) onErreur(e.error || "erreur"); };
    rec.onend = () => { if (onFin) onFin(final.trim()); };
    return {
      demarrer() { final = ""; try { rec.lang = "fr-FR"; rec.start(); } catch (e) {} },
      arreter() { try { rec.stop(); } catch (e) {} },
    };
  }

  window.Chantier = window.Chantier || {};
  window.Chantier.ia = { getKey, setKey, aKey, reformuler, assistantPlanning, dispo, creerDicteur };
})();
