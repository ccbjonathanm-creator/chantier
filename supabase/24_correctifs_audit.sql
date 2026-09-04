-- ClicChantier v41. Additif et rejouable. Aucune suppression métier.
-- Exécuter dans une transaction ; tester d'abord avec ROLLBACK.

create table if not exists public.pack_donnees (
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  pack text not null check (pack in ('entreprise','plombier','electricien','peintre')),
  collection text not null check (collection in ('infos','catalogue','contrats')),
  id text not null check (length(id) between 1 and 100),
  donnees jsonb not null check (jsonb_typeof(donnees) = 'object' and octet_length(donnees::text) <= 100000),
  primary key (entreprise_id, pack, collection, id),
  check (donnees ? 'id' and donnees->>'id' = id),
  check ((pack = 'entreprise' and collection = 'infos' and id = 'infos') or
         (pack <> 'entreprise' and collection = 'catalogue') or
         (pack = 'plombier' and collection = 'contrats'))
);
alter table public.pack_donnees enable row level security;
grant select, insert, update, delete on public.pack_donnees to authenticated;
revoke all on public.pack_donnees from anon;
drop policy if exists pack_lecture on public.pack_donnees;
create policy pack_lecture on public.pack_donnees for select to authenticated
  using (entreprise_id = app.mon_entreprise() and app.est_patron());
drop policy if exists pack_ecriture on public.pack_donnees;
create policy pack_ecriture on public.pack_donnees for all to authenticated
  using (entreprise_id = app.mon_entreprise() and app.est_patron() and app.abonnement_ouvert(entreprise_id))
  with check (entreprise_id = app.mon_entreprise() and app.est_patron() and app.abonnement_ouvert(entreprise_id)
    and (pack = 'entreprise' or exists (
      select 1 from public.entreprise_facturation f join public.formule_modules m on m.formule = f.formule
      where f.entreprise_id = pack_donnees.entreprise_id and m.module = pack_donnees.pack and m.actif
    )));

-- Les RPC SECURITY DEFINER contournent la RLS : le trigger protège aussi
-- leurs écritures. Les opérations administratives sans utilisateur et
-- l'initialisation d'une entreprise avant création du profil restent possibles.
create or replace function app.verifier_ecriture_abonnement()
returns trigger language plpgsql security definer set search_path = public as $$
declare ent uuid; ligne jsonb;
begin
  if auth.uid() is not null and app.mon_entreprise() is not null then
    ligne := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    ent := (case when tg_table_name = 'entreprises' then ligne->>'id' else ligne->>'entreprise_id' end)::uuid;
    if not exists (select 1 from public.entreprise_facturation where entreprise_id = ent)
       or not app.abonnement_ouvert(ent) then
      raise exception 'Abonnement fermé : vos données restent consultables en lecture seule' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['entreprises','profils','clients','catalog_categories','catalog_items','interventions','pointages','journal',
    'devis','devis_lignes','factures','facture_lignes','facture_paiements','parametres_facturation','parametres_relance','relances',
    'stock_emplacements','stock_mouvements','factures_fournisseurs','factures_fournisseurs_lignes','pack_donnees'] loop
    execute format('drop trigger if exists audit_abonnement_ecriture on public.%I', t);
    execute format('create trigger audit_abonnement_ecriture before insert or update or delete on public.%I for each row execute function app.verifier_ecriture_abonnement()', t);
  end loop;
end $$;

create or replace function app.verifier_stock_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare origine public.stock_mouvements;
begin
  if new.quantite::text in ('NaN','Infinity','-Infinity') or new.prix_unitaire::text in ('NaN','Infinity','-Infinity') or new.prix_unitaire < 0 then
    raise exception 'Quantité ou prix de stock invalide';
  end if;
  if auth.uid() is not null and not app.est_patron() then
    if new.type not in ('consommation','retour') or new.compense_id is not null or not exists (
      select 1 from public.interventions where id = new.intervention_id and entreprise_id = app.mon_entreprise() and employe_id = auth.uid()
    ) then raise exception 'Cette opération de stock est réservée au patron' using errcode = '42501'; end if;
  end if;
  if new.compense_id is not null then
    select * into origine from public.stock_mouvements where id = new.compense_id;
    if new.intervention_id is distinct from origine.intervention_id or new.prix_unitaire is distinct from origine.prix_unitaire then
      raise exception 'La compensation doit conserver le chantier et le coût du mouvement initial';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists audit_stock on public.stock_mouvements;
create trigger audit_stock before insert on public.stock_mouvements for each row execute function app.verifier_stock_audit();

-- Verrou sur le devis : une seconde création concurrente attend la première.
create or replace function app.verifier_nombres_metier()
returns trigger language plpgsql set search_path = public as $$
declare k text; ligne jsonb := to_jsonb(new);
begin
  foreach k in array array['quantite','prix_unitaire_ht','taux_tva','unit_price_excl_tax','purchase_price_excl_tax','vat_rate',
    'total_ht','total_tva','total_ttc','montant','taux_horaire_vente','cout_horaire_interne','tva_main_oeuvre'] loop
    if ligne->>k in ('NaN','Infinity','-Infinity') then raise exception 'Valeur numérique non finie interdite : %', k; end if;
  end loop;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['devis','devis_lignes','factures','facture_lignes','catalog_items','facture_paiements','parametres_facturation'] loop
    execute format('drop trigger if exists audit_nombres on public.%I',t);
    execute format('create trigger audit_nombres before insert or update on public.%I for each row execute function app.verifier_nombres_metier()',t);
  end loop;
end $$;

-- Verrou sur le devis : une seconde création concurrente attend la première.
-- Le trigger protège également les anciennes versions et les appels REST.
-- Les doublons historiques sont conservés, aucun document émis n'est réécrit.
create or replace function app.verifier_facture_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare vendeur jsonb;
begin
  if new.devis_id is not null and new.genre <> 'avoir' and new.statut <> 'annulee'
     and (tg_op = 'INSERT' or new.devis_id is distinct from old.devis_id or new.genre is distinct from old.genre
          or (new.statut is distinct from old.statut and new.statut in ('brouillon','valide','emise'))) then
    perform id from public.devis where id = new.devis_id for update;
    if exists (select 1 from public.factures f where f.devis_id = new.devis_id and f.id <> new.id
                 and f.genre <> 'avoir' and f.statut <> 'annulee') then
      raise exception 'Une facture existe déjà pour ce devis' using errcode = '23505';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.statut is distinct from old.statut) and new.genre <> 'avoir' then
    if new.statut = 'valide' then
      select vendeur_snapshot into vendeur from public.parametres_facturation where entreprise_id = new.entreprise_id;
      new.vendeur_snapshot := coalesce(vendeur, '{}'::jsonb);
    end if;
    if new.statut in ('valide','emise') then
      vendeur := new.vendeur_snapshot;
      if coalesce(btrim(vendeur->>'nom'), '') = ''
        or coalesce(regexp_replace(vendeur->>'siret', '\s', '', 'g'), '') !~ '^\d{14}$'
        or coalesce(btrim(vendeur->>'adresse'), '') = ''
        or coalesce(btrim(vendeur->>'codePostal'), '') = ''
        or coalesce(btrim(vendeur->>'ville'), '') = '' then
        raise exception 'Document incomplet : renseignez le nom, le SIRET (14 chiffres) et l''adresse complète dans les paramètres, puis validez à nouveau le brouillon';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists audit_facture on public.factures;
create trigger audit_facture before insert or update on public.factures for each row execute function app.verifier_facture_audit();

create or replace function public.creer_facture_transaction(p_devis_id uuid, p_lignes jsonb default null)
returns public.factures language plpgsql security definer set search_path = public as $$
declare d public.devis; c public.clients; p public.parametres_facturation; f public.factures;
  ent uuid := app.mon_entreprise(); lignes jsonb; l jsonb; pos integer := 0; q numeric; prix numeric; tva numeric;
begin
  if ent is null or not app.est_patron() or not app.abonnement_ouvert(ent) then
    raise exception 'Création de facture refusée : accès patron et abonnement ouvert requis' using errcode = '42501';
  end if;
  select * into d from public.devis where id = p_devis_id and entreprise_id = ent for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if d.statut <> 'accepte' then raise exception 'Seul un devis accepté peut devenir une facture'; end if;
  if exists (select 1 from public.factures where devis_id = d.id and genre <> 'avoir' and statut <> 'annulee') then
    raise exception 'Une facture existe déjà pour ce devis' using errcode = '23505';
  end if;
  select * into c from public.clients where id = d.client_id and entreprise_id = ent;
  if not found then raise exception 'Client introuvable'; end if;
  select * into p from public.parametres_facturation where entreprise_id = ent;
  if not found then raise exception 'Renseignez les paramètres de facturation'; end if;
  if p_lignes is null then
    select jsonb_agg(jsonb_build_object('catalogItemId',catalog_item_id,'libelle',libelle_snapshot,'description',description_snapshot,
      'unite',unite_snapshot,'quantite',quantite,'prixUnitaireHT',prix_unitaire_ht,'tauxTVA',taux_tva) order by position)
      into lignes from public.devis_lignes where devis_id = d.id;
  else lignes := p_lignes;
  end if;
  if lignes is null or jsonb_typeof(lignes) <> 'array' or jsonb_array_length(lignes) = 0 then
    raise exception 'Aucune ligne validée : rien à facturer';
  end if;
  insert into public.factures(entreprise_id,client_id,devis_id,genre,origine,client_snapshot,vendeur_snapshot,
      conditions_paiement,penalites_retard,indemnite_recouvrement,mention_tva)
    values(ent,c.id,d.id,'facture',case when p_lignes is null then 'devis'::public.facture_origine else 'reel'::public.facture_origine end,
      jsonb_build_object('nom',c.display_name,'kind',c.kind,'adresse',c.billing_address_line1,'codePostal',c.billing_postal_code,'ville',c.billing_city),
      p.vendeur_snapshot,p.conditions_paiement,p.penalites_retard,case when c.kind = 'company' then 40 else null end,p.mention_tva)
    returning * into f;
  for l in select value from jsonb_array_elements(lignes) loop
    q := (l->>'quantite')::numeric; prix := (l->>'prixUnitaireHT')::numeric; tva := (l->>'tauxTVA')::numeric;
    if q is null or q <= 0 or q::text in ('NaN','Infinity','-Infinity')
      or prix is null or prix < 0 or prix::text in ('NaN','Infinity','-Infinity')
      or tva is null or tva not in (0,5.5,10,20) or coalesce(btrim(l->>'libelle'),'') = '' then
      raise exception 'Ligne de facture invalide : libellé, quantité, prix ou TVA';
    end if;
    pos := pos + 1;
    insert into public.facture_lignes(entreprise_id,facture_id,catalog_item_id,position,libelle_snapshot,description_snapshot,unite_snapshot,quantite,prix_unitaire_ht,taux_tva)
      values(ent,f.id,nullif(l->>'catalogItemId','')::uuid,pos,btrim(l->>'libelle'),coalesce(l->>'description',''),coalesce(nullif(l->>'unite',''),'u'),q,prix,tva);
  end loop;
  update public.factures set total_ht = x.ht, total_tva = x.tva, total_ttc = x.ht + x.tva
    from (select coalesce(sum(round(quantite * prix_unitaire_ht,2)),0) ht,
      coalesce(sum(round(round(quantite * prix_unitaire_ht,2) * taux_tva / 100,2)),0) tva
      from public.facture_lignes where facture_id = f.id) x where id = f.id returning * into f;
  return f;
end;
$$;
revoke all on function public.creer_facture_transaction(uuid,jsonb) from public, anon;
grant execute on function public.creer_facture_transaction(uuid,jsonb) to authenticated;

create or replace function app.proteger_pointage_termine()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.fin is not null and (new.fin is distinct from old.fin or new.debut is distinct from old.debut
    or new.intervention_id is distinct from old.intervention_id or new.employe_id is distinct from old.employe_id) then
    raise exception 'Ce pointage est déjà terminé : sa durée est conservée';
  end if;
  return new;
end;
$$;
drop trigger if exists audit_pointage on public.pointages;
create trigger audit_pointage before update on public.pointages for each row execute function app.proteger_pointage_termine();
create or replace function public.terminer_pointage(p_pointage_id uuid)
returns public.pointages language plpgsql security definer set search_path = public as $$
declare p public.pointages; ent uuid := app.mon_entreprise();
begin
  select * into p from public.pointages where id = p_pointage_id and entreprise_id = ent for update;
  if not found or (not app.est_patron() and p.employe_id <> auth.uid()) then raise exception 'Pointage introuvable' using errcode = '42501'; end if;
  if p.fin is not null then return p; end if;
  if not app.abonnement_ouvert(ent) then raise exception 'Abonnement fermé : lecture seule' using errcode = '42501'; end if;
  update public.pointages set fin = now() where id = p.id returning * into p;
  update public.interventions set statut = case when coalesce(date_fin,date) > date then 'en_cours' else 'termine' end
    where id = p.intervention_id and entreprise_id = ent;
  return p;
end;
$$;
revoke all on function public.terminer_pointage(uuid) from public, anon;
grant execute on function public.terminer_pointage(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['interventions','pointages','journal','clients','catalog_categories','catalog_items','pack_donnees'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
