# ClicChantier v41 — correctifs de l'audit du 5 septembre 2026

Application : https://clicchantier.contactweb71.workers.dev/chantier/

L'ancienne adresse GitHub Pages redirige vers Cloudflare, qui envoie une CSP
HTTP avec `frame-ancestors 'none'`, `X-Frame-Options: DENY` et `nosniff`.
Les données métier restent dans le même projet Supabase. La connexion doit
être renouvelée lors du premier passage sur la nouvelle adresse. Le code
d'accès aux essais est conservé. Aucune ouverture publique n'est effectuée.

## Vérification et publication

1. `node --test --test-isolation=none tests/*.test.js`
2. Appliquer `supabase/24_correctifs_audit.sql` dans une transaction PostgreSQL.
   Cette migration est additive et rejouable ; elle ne supprime aucun document.
3. `node hosting/build.cjs`
4. `wrangler deploy`
5. Vérifier les en-têtes, la connexion et un parcours métier sur l'adresse publiée.

Le build utilise une liste positive d'assets : les tests, migrations et outils
ne sont pas publiés sur Cloudflare. Ne jamais ajouter de secret dans les fichiers
du site. La clé Supabase présente dans le JavaScript est la clé publique prévue
pour le navigateur ; les accès sont contrôlés dans PostgreSQL.

## Authentification et mises à jour

Les e-mails de confirmation/récupération utilisent l'adresse de retour
`https://ccbjonathanm-creator.github.io/chantier/`, déjà autorisée dans Supabase.
`js/hebergement.js` conserve leur fragment lors du passage à Cloudflare.
Conserver cette passerelle tant que les paramètres de redirection Supabase et
les retours Stripe utilisent l'ancienne adresse.

Le service worker v41 ne conserve que les assets publics explicitement listés.
Les réponses Supabase et les requêtes authentifiées ne sont jamais mises en cache.
Un mode entreprise hors ligne affiche une erreur de connexion ; ses données
privées ne sont pas reprises depuis le cache d'un autre compte.

Les anciens packs locaux sans propriétaire fiable restent archivés sous
`chantier_ancien_non_attribue:*` sur l'ancien appareil/origine. Ils ne sont pas
attribués automatiquement à une entreprise. La démonstration reste locale.

## Périmètre de la validation

Les tests couvrent les régressions de l'audit, la base PostgreSQL, deux comptes
AUDIT confirmés, l'isolation, la synchronisation et la récupération du mot de passe.
Les essais métier SQL sensibles utilisent ROLLBACK ou des brouillons AUDIT nettoyés.
Aucun paiement réel, aucun appel Stripe de souscription et aucun e-mail de test
à un tiers ne sont nécessaires pour cette validation. Les factures historiques
émises ne sont pas réécrites ; un éventuel doublon doit être traité par un avoir.
