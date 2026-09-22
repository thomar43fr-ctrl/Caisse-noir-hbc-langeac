import { useState, useMemo, useEffect } from "react";
import { db, auth } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs, getDoc
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";
import { INITIAL_RULES, INITIAL_PAYMENTS, INITIAL_CALENDAR } from "./data";
import { jsPDF } from "jspdf";
const HISTORICAL_MATCHES = [];
function parseMatchDate(str) {
  if (!str) return null;
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}
function sortCalendarEntries(list) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const withDates = list.map(m => ({ ...m, _d: parseMatchDate(m.date) }));
  const upcoming = withDates.filter(m => m._d && m._d >= today).sort((a, b) => a._d - b._d);
  const past = withDates.filter(m => !m._d || m._d < today).sort((a, b) => (b._d || 0) - (a._d || 0));
  return [...upcoming, ...past];
}
function getPlayerInfractionStats(entries) {
  const counts = {};
  entries.forEach(e => {
    if (!e.detail || e.detail === "Rien" || e.amount === 0) return;
    const d = e.detail.toLowerCase();
    [
      {key:"mitraillette",label:"Mitraillette"},
      {key:"sortie veille",label:"Sortie veille"},
      {key:"penalty raté",label:"Penalty raté"},
      {key:"contre attaque raté",label:"Contre-attaque ratée"},
      {key:"contre-attaque ratée",label:"Contre-attaque ratée"},
      {key:"relance ratée",label:"Relance ratée"},
      {key:"tir fantaisie raté",label:"Tir fantaisie raté"},
      {key:"tir fantaisie pris",label:"Tir fantaisie pris"},
      {key:"vomi",label:"Vomi en soirée"},
      {key:"retard",label:"Retard"},
      {key:"carton rouge",label:"Carton rouge"},
      {key:"défaite",label:"Défaite collective"},
      {key:"fantôme",label:"Fantôme"},
      {key:"craquage mental",label:"Craquage mental"},
      {key:"poule non officiel",label:"Poule non officiel"},
    ].forEach(({key,label}) => {
      if (d.includes(key)) counts[label] = (counts[label]||0)+1;
    });
    if (isChaboulaDetail(e.detail)) counts["Chaboulat"] = (counts["Chaboulat"]||0)+1;
  });
  return Object.entries(counts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
}
const NAV_ITEMS = ["Dashboard","Paiements","Joueurs","Règles","Calendrier","Stats"];
const HORS_MATCH_LABEL = "Hors match";
const WEIGHT_PERIODS = [
  { key: "avant", label: "Avant saison (référence)" },
  { key: "mi", label: "Mi-saison" },
  { key: "fin", label: "Fin de saison" },
];
const QTY_OPTIONS = [1,2,3,4,5];
// Une infraction ne compte comme "chaboulat" (🐐 classement, emoji 😈) que si
// son nom est EXACTEMENT "chaboula" ou "chaboulat" — pas "photo chaboula",
// "oubli chaboula", etc. qui sont des infractions différentes.
const CHABOULA_NAMES = ["chaboula", "chaboulat"];
const isChaboulaDetail = (detail) => {
  if (!detail) return false;
  const stripped = detail.replace(/\s*\(x\d+\)$/,"").trim().toLowerCase();
  return CHABOULA_NAMES.includes(stripped);
};
// Noms des règles à privilégier par défaut dans le tableau "infraction la plus
// fréquente" des Stats — elles doivent déjà exister (avec leur prix) dans tes
// règles. Si un nom ne correspond pas exactement, utilise le bouton
// "⚙️ Choisir les règles" dans Stats pour les sélectionner à la main.
const DEFAULT_STATS_RULE_NAMES = [
  "sortie veille de match","fantôme","craquage mental","poule non officiel",
  "mitraillette","vomi en soirée","contre attaque raté","penalty raté",
  "tir fantaisie raté","tir fantaisie pris"
].map(s => s.toLowerCase());

// ---------------------------------------------------------------------------
// GROUPES
// Chaque groupe (ex: "Gars 26-27", "Filles 26-27", "Vétérans") possède ses
// propres sous-collections dans Firestore :
//   groups/{groupId}/rules, /matches, /payments, /calendar, /playersList,
//   /weights, /ruleHistory, /settings
// Un admin reste admin partout (accès total à tous les groupes).
// ---------------------------------------------------------------------------
const GROUP_SUBCOLLECTIONS = ["rules","matches","payments","calendar","playersList","weights","ruleHistory"];
const LEGACY_GROUP_NAME = "Saison 25-26";
const LEGACY_GROUP_ID = "saison-25-26";
const LAST_GROUP_KEY = "hbc_last_group";

const readLastGroup = () => { try { return localStorage.getItem(LAST_GROUP_KEY); } catch(e) { return null; } };
const writeLastGroup = (id) => { try { id ? localStorage.setItem(LAST_GROUP_KEY, id) : localStorage.removeItem(LAST_GROUP_KEY); } catch(e) {} };

export default function App() {
  // --- Groupes ---
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({name:"", seedRules:true, seedCalendar:false});
  const [editingGroup, setEditingGroup] = useState(null);
  const [migrating, setMigrating] = useState(false);

  const [rules, setRules] = useState([]);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState([]);
  const [payments, setPayments] = useState([]);
  const [playersList, setPlayersList] = useState([]);
  const [weights, setWeights] = useState([]);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [newRule, setNewRule] = useState({name:"",amount:""});
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [editingPlayerName, setEditingPlayerName] = useState(null);
  const [newInfraction, setNewInfraction] = useState({
    mode: "player",
    player: "",
    calMatchId: "",
    checkedRules: {},
    checkedPlayers: {},
    selectedRuleId: "",
    useWeight: false,
    weightPeriod: "avant",
    customDetail: "",
    customAmount: "",
    weightStart: "",
    weightCurrent: "",
  });
  const [newCalMatch, setNewCalMatch] = useState({date:"",opponent:"",home:true,location:"",team:"Éq1"});
  const [editingMatchResult, setEditingMatchResult] = useState(null);
  const [editingCalMatch, setEditingCalMatch] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentInput, setPaymentInput] = useState("");
  const [viewMatchDetail, setViewMatchDetail] = useState(null);
  const [expandedPlayerInMatch, setExpandedPlayerInMatch] = useState(null);
  const [expandedPlayerMatch, setExpandedPlayerMatch] = useState(null);
  const [rib, setRib] = useState(null);
  const [editingRib, setEditingRib] = useState(null);
  const [showRibEdit, setShowRibEdit] = useState(false);
  const [statsRuleIds, setStatsRuleIds] = useState(null);
  const [showStatsRuleConfig, setShowStatsRuleConfig] = useState(false);
  const [tempStatsRuleIds, setTempStatsRuleIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [ruleHistory, setRuleHistory] = useState([]);
  const [showRuleHistory, setShowRuleHistory] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [infractionRuleSearch, setInfractionRuleSearch] = useState("");
  const [infractionPlayerSearch, setInfractionPlayerSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };
  const confirmAction = (msg) => (typeof window === "undefined" ? true : window.confirm(msg));

  // Raccourcis : toutes les lectures/écritures passent par le groupe actif
  const gcol = (name) => collection(db, "groups", activeGroupId, name);
  const gdoc = (name, id) => doc(db, "groups", activeGroupId, name, String(id));
  const activeGroup = useMemo(() => groups.find(g => g.id === activeGroupId) || null, [groups, activeGroupId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const adminDoc = await getDoc(doc(db, "admins", u.email));
          setIsAdmin(adminDoc.exists());
        } catch(e) { setIsAdmin(false); }
      } else { setIsAdmin(false); }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // --- Liste des groupes ---
  useEffect(() => {
    if (!user && !guestMode) { setGroups([]); setGroupsLoading(false); setActiveGroupId(null); return; }
    setGroupsLoading(true);
    const unsub = onSnapshot(collection(db, "groups"),
      snap => {
        const list = snap.docs.map(d => ({...d.data(), id: d.id})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        setGroups(list);
        setGroupsLoading(false);
        setActiveGroupId(prev => {
          if (prev && list.some(g => g.id === prev)) return prev;
          if (prev) return null; // le groupe a été supprimé ailleurs
          const last = readLastGroup();
          return last && list.some(g => g.id === last) ? last : null;
        });
      },
      () => { setGroupsLoading(false); }
    );
    return () => unsub();
  }, [user, guestMode]);

  useEffect(() => { writeLastGroup(activeGroupId); }, [activeGroupId]);

  // --- Migration automatique : les anciennes collections deviennent un 1er groupe ---
  const migrateLegacyData = async () => {
    setMigrating(true);
    try {
      const gRef = doc(db, "groups", LEGACY_GROUP_ID);
      await setDoc(gRef, {name: LEGACY_GROUP_NAME, createdAt: Date.now(), migrated: true});

      for (const name of GROUP_SUBCOLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.set(doc(db, "groups", LEGACY_GROUP_ID, name, d.id), d.data()));
          await batch.commit();
        } else if (name === "rules" && INITIAL_RULES.length) {
          const batch = writeBatch(db);
          INITIAL_RULES.forEach(r => batch.set(doc(db, "groups", LEGACY_GROUP_ID, "rules", String(r.id)), r));
          await batch.commit();
        } else if (name === "calendar" && INITIAL_CALENDAR.length) {
          const batch = writeBatch(db);
          INITIAL_CALENDAR.forEach(c => batch.set(doc(db, "groups", LEGACY_GROUP_ID, "calendar", String(c.id)), c));
          await batch.commit();
        } else if (name === "payments" && INITIAL_PAYMENTS.length) {
          const batch = writeBatch(db);
          INITIAL_PAYMENTS.forEach(p => batch.set(doc(db, "groups", LEGACY_GROUP_ID, "payments", p.player), p));
          await batch.commit();
        }
      }
      // réglages (sélection des règles du tableau Stats)
      try {
        const st = await getDoc(doc(db, "settings", "statsRules"));
        if (st.exists()) await setDoc(doc(db, "groups", LEGACY_GROUP_ID, "settings", "statsRules"), st.data());
      } catch(e) {}

      showToast(`Groupe "${LEGACY_GROUP_NAME}" créé avec tes données existantes ✓`);
    } catch (e) {
      showToast("Migration impossible — vérifie les règles Firestore pour 'groups'");
    }
    setMigrating(false);
  };

  useEffect(() => {
    if (!isAdmin || groupsLoading || migrating) return;
    if (groups.length > 0) return;
    migrateLegacyData();
  }, [isAdmin, groupsLoading, groups.length]);

  // --- Données du groupe actif ---
  useEffect(() => {
    if (!activeGroupId || (!user && !guestMode)) {
      setRules([]); setMatches([]); setCalendar([]); setPayments([]);
      setPlayersList([]); setWeights([]); setRuleHistory([]); setStatsRuleIds(null); setRib(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = ["groups", activeGroupId];
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 6) setLoading(false); };
    const sub = (name) => collection(db, base[0], base[1], name);
    const unsubRules = onSnapshot(sub("rules"), snap => { setRules(snap.docs.map(d => ({...d.data(), id: d.id}))); checkDone(); });
    const unsubMatches = onSnapshot(sub("matches"), snap => { const fb = snap.docs.map(d => ({...d.data(), fbId: d.id})); setMatches(fb.sort((a,b) => (a.sortKey||0)-(b.sortKey||0))); checkDone(); });
    const unsubPayments = onSnapshot(sub("payments"), snap => { setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id}))); checkDone(); });
    const unsubCal = onSnapshot(sub("calendar"), snap => { setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id}))); checkDone(); });
    const unsubPlayers = onSnapshot(sub("playersList"), snap => { setPlayersList(snap.docs.map(d => ({...d.data(), id: d.id}))); checkDone(); });
    const unsubWeights = onSnapshot(sub("weights"), snap => { setWeights(snap.docs.map(d => ({...d.data(), fbId: d.id}))); checkDone(); });
    const unsubStatsRules = onSnapshot(doc(db, base[0], base[1], "settings", "statsRules"), snap => { setStatsRuleIds(snap.exists() ? (snap.data().ruleIds || []) : null); });
    const unsubRuleHistory = onSnapshot(sub("ruleHistory"), snap => { setRuleHistory(snap.docs.map(d => ({...d.data(), fbId: d.id})).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0))); });
    const unsubRib = onSnapshot(doc(db, base[0], base[1], "settings", "rib"), snap => { setRib(snap.exists() ? snap.data() : null); });
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); unsubPlayers(); unsubWeights(); unsubStatsRules(); unsubRuleHistory(); unsubRib(); };
  }, [activeGroupId, user, guestMode]);

  // --- Création / renommage / suppression de groupe ---
  const createGroup = async () => {
    const name = newGroup.name.trim();
    if (!name) return;
    if (!confirmAction(`Créer le groupe "${name}" ?`)) return;
    const id = `${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${Date.now().toString().slice(-5)}`;
    try {
      await setDoc(doc(db, "groups", id), {name, createdAt: Date.now()});
      if (newGroup.seedRules && INITIAL_RULES.length) {
        const batch = writeBatch(db);
        INITIAL_RULES.forEach(r => batch.set(doc(db, "groups", id, "rules", String(r.id)), r));
        await batch.commit();
      }
      if (newGroup.seedCalendar && INITIAL_CALENDAR.length) {
        const batch = writeBatch(db);
        INITIAL_CALENDAR.forEach(c => batch.set(doc(db, "groups", id, "calendar", String(c.id)), c));
        await batch.commit();
      }
      setNewGroup({name:"", seedRules:true, seedCalendar:false});
      setShowCreateGroup(false);
      setActiveGroupId(id);
      showToast(`Groupe "${name}" créé ✓`);
    } catch (e) {
      showToast("Création impossible — vérifie les règles Firestore pour 'groups'");
    }
  };

  const renameGroup = async () => {
    if (!editingGroup || !editingGroup.newName.trim()) return;
    const trimmed = editingGroup.newName.trim();
    await updateDoc(doc(db, "groups", editingGroup.id), {name: trimmed});
    setEditingGroup(null);
    showToast("Groupe renommé ✓");
  };

  const deleteGroup = async (g) => {
    if (!confirmAction(`Supprimer le groupe "${g.name}" ET toutes ses données (joueurs, matchs, règles, paiements) ? Cette action est définitive.`)) return;
    if (!confirmAction(`Dernière confirmation : tout le contenu de "${g.name}" sera perdu. Continuer ?`)) return;
    try {
      for (const name of [...GROUP_SUBCOLLECTIONS, "settings"]) {
        const snap = await getDocs(collection(db, "groups", g.id, name));
        if (snap.empty) continue;
        let batch = writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
          batch.delete(doc(db, "groups", g.id, name, d.id));
          n++;
          if (n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
        }
        await batch.commit();
      }
      await deleteDoc(doc(db, "groups", g.id));
      if (activeGroupId === g.id) setActiveGroupId(null);
      showToast(`Groupe "${g.name}" supprimé`);
    } catch (e) {
      showToast("Suppression incomplète — réessaie");
    }
  };

  const leaveGroup = () => {
    setActiveGroupId(null);
    setActiveTab("Dashboard");
    setSelectedPlayer(null);
    setViewMatchDetail(null);
    setShowAddInfraction(false);
    setShowAddPlayer(false);
    setShowAddRule(false);
    setShowAddCalendar(false);
    setPlayerSearch("");
  };

  const allEntries = useMemo(() => matches.flatMap(m => (m.entries||[]).map((e,idx) => ({...e, matchLabel:m.match, matchDate:m.date, matchId: m.fbId||String(m.id), sortKey:m.sortKey||0, entryIndex:idx}))), [matches]);

  const playerStats = useMemo(() => {
    const stats = {};
    allEntries.forEach(e => {
      const p = e.player;
      if (!stats[p]) stats[p] = {total:0, count:0, chaboula:0, entries:[]};
      stats[p].total += e.amount;
      if (e.amount > 0) stats[p].count++;
      if (isChaboulaDetail(e.detail)) stats[p].chaboula += (e.qty||1);
      stats[p].entries.push(e);
    });
    return stats;
  }, [allEntries]);

  const players = useMemo(() => {
    const fromStats = Object.keys(playerStats);
    const fromList = playersList.filter(p => !p.hidden).map(p => p.name);
    return Array.from(new Set([...fromStats, ...fromList])).sort();
  }, [playerStats, playersList]);

  useEffect(() => {
    if (!isAdmin || !activeGroupId || Object.keys(playerStats).length === 0 || payments.length === 0) return;
    payments.forEach(async p => {
      const newTotal = playerStats[p.player]?.total;
      if (newTotal !== undefined && Math.abs(newTotal - p.total) > 0.01) {
        try { await updateDoc(gdoc("payments", p.fbId || p.player), {total: newTotal}); } catch(e) {}
      }
    });
  }, [playerStats, isAdmin, activeGroupId]);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);

  const goal = useMemo(() => {
    let g = 3000;
    while (totalCaisse > g) g += 500;
    return g;
  }, [totalCaisse]);
  const goalPct = goal > 0 ? Math.min(100, Math.round((totalCaisse/goal)*100)) : 0;

  const matchTotals = useMemo(() => matches
    .filter(m => m.match !== HORS_MATCH_LABEL)
    .map(m => ({...m, total: (m.entries||[]).reduce((s,e) => s+e.amount, 0)})), [matches]);
  const topOffenders = useMemo(() => Object.entries(playerStats).filter(([,s]) => s.total > 0).sort((a,b) => b[1].total-a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a[1].chaboula).slice(0,5), [playerStats]);

  // Si l'admin n'a jamais configuré la sélection manuellement, on essaie de
  // retrouver automatiquement les règles déjà existantes qui correspondent
  // aux noms demandés. Sinon, on utilise la sélection manuelle enregistrée.
  const effectiveStatsRuleIds = useMemo(() => {
    if (statsRuleIds !== null) return statsRuleIds;
    return rules.filter(r => DEFAULT_STATS_RULE_NAMES.includes((r.name||"").toLowerCase())).map(r=>r.id);
  }, [statsRuleIds, rules]);

  const saveStatsRuleConfig = async (ids) => {
    try {
      await setDoc(gdoc("settings", "statsRules"), {ruleIds: ids});
      setShowStatsRuleConfig(false);
      showToast("Sélection des règles enregistrée ✓");
    } catch (e) {
      showToast(e.code === "permission-denied" ? "Accès refusé par Firestore (règles de sécurité à ajuster pour 'groups')" : "Erreur lors de l'enregistrement");
    }
  };

  const saveRib = async () => {
    if (!editingRib) return;
    if (!confirmAction("Enregistrer ces informations RIB ?")) return;
    try {
      await setDoc(gdoc("settings", "rib"), {
        holder: (editingRib.holder||"").trim(),
        iban: (editingRib.iban||"").trim(),
        bic: (editingRib.bic||"").trim(),
      });
      setShowRibEdit(false);
      showToast("RIB enregistré ✓");
    } catch (e) {
      showToast("Erreur lors de l'enregistrement du RIB");
    }
  };

  const copyRib = async () => {
    if (!rib) return;
    const text = `Titulaire : ${rib.holder||""}\nIBAN : ${rib.iban||""}\nBIC : ${rib.bic||""}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("RIB copié dans le presse-papier ✓");
        return;
      }
      throw new Error("clipboard indisponible");
    } catch (e) {
      showToast("Impossible de copier automatiquement — copie le texte manuellement");
    }
  };

  const infractionLeaders = useMemo(() => {
    const allowedIds = effectiveStatsRuleIds.length ? new Set(effectiveStatsRuleIds.map(String)) : null;
    const allowedRules = allowedIds ? rules.filter(r => allowedIds.has(String(r.id))) : rules;
    const byType = {};
    allEntries.forEach(e => {
      if (!e.detail || !e.player) return;
      const stripped = e.detail.replace(/\s*\(x\d+\)$/,"").trim().toLowerCase();
      let matchedRule = null;
      if (e.ruleId) {
        matchedRule = allowedRules.find(r => String(r.id) === String(e.ruleId));
        if (!matchedRule) return;
      } else {
        matchedRule = allowedRules.find(r => (r.name||"").trim().toLowerCase() === stripped);
        if (!matchedRule) return;
      }
      const label = matchedRule.name;
      if (!byType[label]) byType[label] = {};
      byType[label][e.player] = (byType[label][e.player]||0) + (e.qty||1);
    });
    return Object.entries(byType).map(([label, playersMap]) => {
      const top = Object.entries(playersMap).sort((a,b)=>b[1]-a[1])[0];
      return top ? {label, player: top[0], count: top[1]} : null;
    }).filter(Boolean).sort((a,b)=>b.count-a.count);
  }, [allEntries, rules, effectiveStatsRuleIds]);

  const getMatchDoc = (calMatch) => {
    if (!calMatch) return null;
    const calId = calMatch.fbId || String(calMatch.id);
    return matches.find(m => (m.fbId || String(m.id)) === calId);
  };

  // ---- Résumé du match : texte formaté (copier-coller) + PDF téléchargeable ----
  const generateMatchSummaryText = (m, ranked, total) => {
    const lines = [];
    lines.push(`HBC LANGEAC${activeGroup ? ` — ${activeGroup.name}` : ""} — vs ${m.opponent}`);
    lines.push(m.result ? `${m.result.toUpperCase()}${m.score ? ` (${m.score})` : ""}` : "Résultat non renseigné");
    lines.push(`${m.date || ""}${m.location ? " • "+m.location : ""}${m.home !== undefined ? " • "+(m.home?"Domicile":"Extérieur") : ""}${m.team ? " • "+m.team : ""}`);
    lines.push("");
    if (!ranked.length) {
      lines.push("Aucune infraction enregistrée pour ce match.");
    } else {
      lines.push("Détail des infractions par joueur :");
      lines.push("");
      ranked.forEach(([playerName, data]) => {
        lines.push(`${playerName} — ${data.total}€`);
        data.items.forEach(item => lines.push(`   - ${item.detail} : ${item.amount}€`));
        lines.push("");
      });
      lines.push(`TOTAL AMENDES DU MATCH : ${total}€`);
    }
    return lines.join("\n");
  };

  const downloadMatchPDF = (m, ranked, total) => {
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let y = 22;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.text(`HBC LANGEAC — vs ${m.opponent || "?"}`, pageWidth / 2, y, { align: "center" });
      y += 8;

      if (activeGroup) {
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(110);
        pdf.text(activeGroup.name, pageWidth / 2, y, { align: "center" });
        pdf.setTextColor(0);
        y += 7;
      }

      pdf.setFontSize(13);
      pdf.setFont("helvetica", "normal");
      const resultLine = m.result ? `${m.result.toUpperCase()}${m.score ? ` (${m.score})` : ""}` : "Résultat non renseigné";
      pdf.text(resultLine, pageWidth / 2, y, { align: "center" });
      y += 7;

      pdf.setFontSize(10);
      pdf.setTextColor(110);
      const infoLine = `${m.date || ""}${m.location ? " • " + m.location : ""}${m.home !== undefined ? " • " + (m.home ? "Domicile" : "Extérieur") : ""}${m.team ? " • " + m.team : ""}`;
      pdf.text(infoLine, pageWidth / 2, y, { align: "center" });
      y += 8;

      pdf.setTextColor(0);
      pdf.setDrawColor(190);
      pdf.line(15, y, pageWidth - 15, y);
      y += 10;

      const ensureSpace = (needed) => {
        if (y + needed > pageHeight - 20) { pdf.addPage(); y = 20; }
      };

      if (!ranked.length) {
        pdf.setFontSize(12);
        pdf.text("Aucune infraction enregistrée pour ce match.", 15, y);
        y += 8;
      } else {
        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.text("Détail des infractions par joueur", 15, y);
        y += 8;

        ranked.forEach(([playerName, data]) => {
          ensureSpace(8);
          pdf.setFontSize(12);
          pdf.setFont("helvetica", "bold");
          pdf.text(`${playerName} — ${data.total}€`, 15, y);
          y += 6;
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10.5);
          data.items.forEach(item => {
            ensureSpace(6);
            pdf.text(`- ${item.detail} : ${item.amount}€`, 20, y);
            y += 5.5;
          });
          y += 3;
        });

        ensureSpace(14);
        pdf.setDrawColor(190);
        pdf.line(15, y, pageWidth - 15, y);
        y += 9;
        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.text(`Total amendes du match : ${total}€`, 15, y);
      }

      const safeOpp = (m.opponent || "match").replace(/[^a-z0-9]+/gi, "_");
      const safeDate = (m.date || "").replace(/[^a-z0-9]+/gi, "_");
      pdf.save(`HBC_Langeac_vs_${safeOpp}${safeDate ? "_"+safeDate : ""}.pdf`);
      showToast("PDF téléchargé ✓");
    } catch (e) {
      console.error("Erreur génération PDF:", e);
      showToast("Impossible de générer le PDF sur cet appareil");
    }
  };

  const copyMatchSummary = async (m, ranked, total) => {
    const text = generateMatchSummaryText(m, ranked, total);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("Résumé copié dans le presse-papier ✓");
        return;
      }
      throw new Error("clipboard indisponible");
    } catch (e) {
      const w = typeof window !== "undefined" ? window.open("", "_blank") : null;
      if (w) {
        const escaped = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        w.document.write(`<html><head><title>Résumé vs ${m.opponent||""}</title></head><body style="font-family:monospace;padding:24px;"><pre style="white-space:pre-wrap;">${escaped}</pre></body></html>`);
        w.document.close();
        showToast("Page ouverte — sélectionne le texte pour le copier");
      } else {
        showToast("Impossible de copier automatiquement — autorise les pop-ups puis réessaie");
      }
    }
  };

  const calcWeightAmount = (startWeight, currentWeight) => {
    if (!startWeight || !currentWeight) return 0;
    const diffG = Math.abs((parseFloat(currentWeight) - parseFloat(startWeight)) * 1000);
    return Math.floor(diffG / 100) * 0.5;
  };

  const addPlayer = async () => {
    if (!newPlayerName.trim()) return;
    const name = newPlayerName.trim();
    if (!confirmAction(`Ajouter le joueur "${name}" au groupe ${activeGroup?.name || ""} ?`)) return;
    await setDoc(gdoc("playersList", name), {name, hidden: false, createdAt: Date.now()});
    if (!payments.find(p => p.player === name)) await setDoc(gdoc("payments", name), {player: name, total: 0, paid: 0});
    setNewPlayerName(""); setShowAddPlayer(false);
    showToast(`${name} ajouté ✓`);
  };

  const hidePlayer = async (name) => {
    if (!confirmAction(`Masquer ${name} ? Il n'apparaîtra plus dans les listes mais son historique est conservé.`)) return;
    const p = playersList.find(x => x.name === name);
    if (p) await updateDoc(gdoc("playersList", name), {hidden: true});
    else await setDoc(gdoc("playersList", name), {name, hidden: true, createdAt: Date.now()});
    showToast(`${name} masqué`);
  };

  const renamePlayer = async () => {
    if (!editingPlayerName || !editingPlayerName.newName.trim()) return;
    const {old: oldName, newName} = editingPlayerName;
    const trimmed = newName.trim();
    if (oldName === trimmed) { setEditingPlayerName(null); return; }
    const batch = writeBatch(db);
    matches.forEach(m => {
      const newEntries = (m.entries||[]).map(e => e.player === oldName ? {...e, player: trimmed} : e);
      if (JSON.stringify(newEntries) !== JSON.stringify(m.entries||[])) batch.update(gdoc("matches", m.fbId||String(m.id)), {entries: newEntries});
    });
    const pay = payments.find(p => p.player === oldName);
    if (pay) {
      const {fbId, ...payData} = pay;
      batch.delete(gdoc("payments", fbId||oldName));
      batch.set(gdoc("payments", trimmed), {...payData, player: trimmed});
    }
    const wd = weights.find(w => w.player === oldName);
    if (wd) {
      const {fbId, ...wdData} = wd;
      batch.delete(gdoc("weights", fbId||oldName));
      batch.set(gdoc("weights", trimmed), {...wdData, player: trimmed});
    }
    batch.delete(gdoc("playersList", oldName));
    batch.set(gdoc("playersList", trimmed), {name: trimmed, hidden: false, createdAt: Date.now()});
    await batch.commit();
    setEditingPlayerName(null);
    showToast(`${oldName} → ${trimmed} ✓`);
  };

  const toggleRule = (id) => setNewInfraction(p => {
    const cur = p.checkedRules[id];
    const next = {...p.checkedRules};
    if (cur) delete next[id]; else next[id] = 1;
    return {...p, checkedRules: next};
  });
  const setRuleQty = (id, qty) => setNewInfraction(p => ({...p, checkedRules: {...p.checkedRules, [id]: Math.min(5,Math.max(1,qty))}}));

  const togglePlayerForRule = (name) => setNewInfraction(p => {
    const cur = p.checkedPlayers[name];
    const next = {...p.checkedPlayers};
    if (cur) delete next[name]; else next[name] = 1;
    return {...p, checkedPlayers: next};
  });
  const setPlayerQty = (name, qty) => setNewInfraction(p => ({...p, checkedPlayers: {...p.checkedPlayers, [name]: Math.min(5,Math.max(1,qty))}}));

  const applyEntriesToMatch = async (entries, calMatchId) => {
    let matchDocId, matchLabelFinal, matchDateFinal, matchSortKeyFinal;
    if (calMatchId) {
      const calMatch = calendar.find(c => (c.fbId||String(c.id)) === calMatchId);
      matchDocId = calMatchId;
      matchLabelFinal = calMatch ? `vs ${calMatch.opponent}` : "Match";
      matchDateFinal = calMatch ? calMatch.date : "";
      matchSortKeyFinal = calMatch ? (calMatch.sortKey||0) : 999;
    } else {
      matchLabelFinal = HORS_MATCH_LABEL;
      matchDateFinal = new Date().toLocaleDateString("fr-FR",{month:"short",year:"numeric"});
      matchSortKeyFinal = 999;
    }
    const existing = calMatchId
      ? matches.find(m => (m.fbId||String(m.id)) === matchDocId)
      : matches.find(m => m.match === HORS_MATCH_LABEL && !m.calMatchId);
    if (existing) {
      await updateDoc(gdoc("matches", existing.fbId||String(existing.id)), {entries: [...(existing.entries||[]), ...entries]});
    } else {
      const idToUse = matchDocId || Date.now();
      const nm = {id: idToUse, match: matchLabelFinal, date: matchDateFinal, sortKey: matchSortKeyFinal, entries, ...(calMatchId ? {calMatchId} : {})};
      await setDoc(gdoc("matches", idToUse), nm);
    }
  };

  const addInfraction = async () => {
    const { mode, player, calMatchId, checkedRules, checkedPlayers, selectedRuleId, useWeight, weightPeriod, weightStart, weightCurrent, customDetail, customAmount } = newInfraction;
    let entries = [];

    if (mode === "rule") {
      const rule = rules.find(r => String(r.id) === String(selectedRuleId));
      if (!rule) { showToast("Choisis une infraction"); return; }
      const chosen = Object.entries(checkedPlayers||{});
      if (!chosen.length) { showToast("Choisis au moins un joueur"); return; }
      chosen.forEach(([p,qty]) => {
        entries.push({player:p, amount: rule.amount*qty, detail: qty>1?`${rule.name} (x${qty})`:rule.name, ruleId: rule.id, qty});
      });
    } else {
      if (!player) { showToast("Choisis un joueur"); return; }
      Object.entries(checkedRules||{}).forEach(([rid,qty]) => {
        const r = rules.find(x=>String(x.id)===String(rid));
        if (r) entries.push({player, amount:r.amount*qty, detail: qty>1?`${r.name} (x${qty})`:r.name, ruleId:r.id, qty});
      });

      let weightHandled = false;
      if (useWeight) {
        const wd = weights.find(w => w.player === player) || {};
        const currentW = parseFloat(weightCurrent) || 0;
        if (!currentW) { showToast("Saisis un poids valide"); return; }
        if (weightPeriod === "avant") {
          await setDoc(gdoc("weights", player), {...wd, player, startWeight: currentW}, {merge: true});
          weightHandled = true;
        } else if (weightPeriod === "mi") {
          const baseW = wd.startWeight || parseFloat(weightStart) || 0;
          if (!baseW) { showToast("Renseigne d'abord un poids de début de saison"); return; }
          const amount = calcWeightAmount(baseW, currentW);
          const diffG = Math.round((currentW - baseW) * 1000);
          entries.push({player, amount, detail:`Pesée mi-saison: ${diffG >= 0 ? "+" : ""}${diffG}g (${baseW}kg → ${currentW}kg)`});
          await setDoc(gdoc("weights", player), {...wd, player, startWeight: baseW, midWeight: currentW}, {merge: true});
          weightHandled = true;
        } else if (weightPeriod === "fin") {
          const baseW = wd.midWeight || wd.startWeight || parseFloat(weightStart) || 0;
          if (!baseW) { showToast("Renseigne d'abord un poids de référence"); return; }
          const amount = calcWeightAmount(baseW, currentW);
          const diffG = Math.round((currentW - baseW) * 1000);
          entries.push({player, amount, detail:`Pesée fin de saison: ${diffG >= 0 ? "+" : ""}${diffG}g (${baseW}kg → ${currentW}kg)`});
          await setDoc(gdoc("weights", player), {...wd, player, endWeight: currentW}, {merge: true});
          weightHandled = true;
        }
      }
      if (customDetail && customAmount) entries.push({player, amount: parseFloat(customAmount)||0, detail: customDetail});

      if (!entries.length && weightHandled) {
        setNewInfraction(prev => ({...prev, player:"", checkedRules:{}, useWeight:false, weightPeriod:"avant", weightStart:"", weightCurrent:"", customDetail:"", customAmount:""}));
        showToast(`Poids de référence enregistré pour ${player} ✓`);
        return;
      }
    }

    if (!entries.length) { showToast("Ajoute au moins une infraction"); return; }

    const totalToAdd = entries.reduce((s,e)=>s+e.amount,0);
    const involvedPlayers = Array.from(new Set(entries.map(e=>e.player))).join(", ");
    if (!confirmAction(`Ajouter ${entries.length} infraction(s) pour ${involvedPlayers} (total ${totalToAdd.toFixed(2)}€) ?`)) return;

    await applyEntriesToMatch(entries, calMatchId);

    const byPlayer = {};
    entries.forEach(e => { byPlayer[e.player] = (byPlayer[e.player]||0) + e.amount; });
    for (const [pl, added] of Object.entries(byPlayer)) {
      const p = payments.find(x => x.player === pl);
      if (p) await updateDoc(gdoc("payments", p.fbId||pl), {total: (playerStats[pl]?.total||0) + added});
      else await setDoc(gdoc("payments", pl), {player: pl, total: added, paid: 0});
    }

    setNewInfraction(prev => ({...prev, player:"", checkedRules:{}, checkedPlayers:{}, useWeight:false, weightPeriod:"avant", weightStart:"", weightCurrent:"", customDetail:"", customAmount:""}));
    showToast(`${entries.length} infraction(s) ajoutée(s) (${totalToAdd.toFixed(2)}€) ✓`);
  };

  const deleteInfraction = async (matchId, entryIndex) => {
    const m = matches.find(x => x.fbId === matchId || String(x.id) === String(matchId));
    if (!m) return;
    const entry = (m.entries||[])[entryIndex];
    if (!confirmAction(entry ? `Supprimer l'infraction "${entry.detail}" (${entry.amount}€) de ${entry.player} ?` : "Supprimer cette infraction ?")) return;
    await updateDoc(gdoc("matches", m.fbId||String(m.id)), {entries: (m.entries||[]).filter((_,i) => i !== entryIndex)});
    if (entry) {
      const p = payments.find(x => x.player === entry.player);
      if (p) await updateDoc(gdoc("payments", p.fbId||entry.player), {total: Math.max(0, p.total - entry.amount)});
      const det = (entry.detail||"").toLowerCase();
      if (det.includes("pesée mi-saison")) {
        const wd = weights.find(w => w.player === entry.player);
        if (wd) await updateDoc(gdoc("weights", wd.fbId||entry.player), {midWeight: null});
      } else if (det.includes("pesée fin de saison")) {
        const wd = weights.find(w => w.player === entry.player);
        if (wd) await updateDoc(gdoc("weights", wd.fbId||entry.player), {endWeight: null});
      }
    }
    showToast("Infraction supprimée");
  };

  const logRuleHistory = async (entry) => {
    try {
      await setDoc(doc(gcol("ruleHistory")), {...entry, timestamp: Date.now(), by: user?.email || (guestMode ? "invité" : "?")});
    } catch (e) { /* l'historique ne doit jamais bloquer l'action principale */ }
  };

  const addRule = async () => {
    if (!newRule.name || !newRule.amount) return;
    if (!confirmAction(`Ajouter la règle "${newRule.name}" (${newRule.amount}€) ?`)) return;
    const r = {id: Date.now(), name: newRule.name, amount: parseFloat(newRule.amount)};
    await setDoc(gdoc("rules", r.id), r);
    await logRuleHistory({action: "ajout", ruleName: r.name, newAmount: r.amount});
    setNewRule({name:"",amount:""}); setShowAddRule(false); showToast("Règle ajoutée ✓");
  };

  const saveRule = async () => {
    if (!confirmAction(`Modifier "${editingRule.name}" à ${editingRule.amount}€ ? Toutes les infractions déjà enregistrées avec cette règle seront recalculées.`)) return;
    const oldRule = rules.find(r => String(r.id) === String(editingRule.id));
    await updateDoc(gdoc("rules", editingRule.id), editingRule);
    await logRuleHistory({action: "modification", ruleName: editingRule.name, oldName: oldRule?.name, oldAmount: oldRule?.amount, newAmount: editingRule.amount});
    const batch = writeBatch(db);
    let touched = false;
    matches.forEach(m => {
      const entries = m.entries || [];
      let changed = false;
      const newEntries = entries.map(e => {
        if (String(e.ruleId) === String(editingRule.id)) {
          changed = true;
          const qty = e.qty || 1;
          const newAmount = editingRule.amount * qty;
          const newDetail = qty > 1 ? `${editingRule.name} (x${qty})` : editingRule.name;
          return {...e, amount: newAmount, detail: newDetail};
        }
        return e;
      });
      if (changed) { batch.update(gdoc("matches", m.fbId||String(m.id)), {entries: newEntries}); touched = true; }
    });
    if (touched) await batch.commit();
    setEditingRule(null);
    showToast("Règle modifiée — infractions déjà enregistrées mises à jour ✓");
  };
  const deleteRule = async (id) => {
    const r = rules.find(x => String(x.id) === String(id));
    if (!confirmAction(`Supprimer la règle "${r ? r.name : ""}" ? Les infractions déjà enregistrées avec cette règle ne seront pas supprimées.`)) return;
    await deleteDoc(gdoc("rules", id));
    await logRuleHistory({action: "suppression", ruleName: r?.name, oldAmount: r?.amount});
    showToast("Règle supprimée");
  };

  const addCalendarMatch = async () => {
    if (!newCalMatch.opponent || !newCalMatch.date) return;
    if (!confirmAction(`Ajouter le match vs ${newCalMatch.opponent} (${newCalMatch.date}) au calendrier ?`)) return;
    const m = {...newCalMatch, id: Date.now(), sortKey: 999, home: newCalMatch.home === true || newCalMatch.home === "true"};
    await setDoc(gdoc("calendar", m.id), m);
    setNewCalMatch({date:"",opponent:"",home:true,location:"",team:"Éq1"}); setShowAddCalendar(false); showToast("Match ajouté ✓");
  };

  const saveCalendarMatch = async () => {
    if (!editingCalMatch) return;
    const { fbId, date, opponent, location, home, team } = editingCalMatch;
    if (!opponent.trim() || !date.trim()) { showToast("Renseigne au moins l'adversaire et la date"); return; }
    if (!confirmAction(`Modifier le match vs ${opponent} (${date}) ?`)) return;
    try {
      await updateDoc(gdoc("calendar", fbId), {
        date: date.trim(),
        opponent: opponent.trim(),
        location: (location||"").trim(),
        home: home === true || home === "true",
        team,
      });
      setEditingCalMatch(null);
      showToast("Match modifié ✓");
    } catch (e) {
      showToast("Erreur lors de la modification du match");
    }
  };

  const calendarEq1 = useMemo(() => sortCalendarEntries(calendar.filter(m => (m.team||"Éq1") === "Éq1")), [calendar]);
  const calendarEq2 = useMemo(() => sortCalendarEntries(calendar.filter(m => m.team === "Éq2")), [calendar]);
  const sortedCalendar = useMemo(() => sortCalendarEntries(calendar), [calendar]);
  const today0 = new Date(new Date().setHours(0,0,0,0));
  const getNextId = (list) => { const n = list.find(m => m._d && m._d >= today0); return n ? (n.fbId||String(n.id)) : null; };
  const nextMatchFbId1 = getNextId(calendarEq1);
  const nextMatchFbId2 = getNextId(calendarEq2);

  const saveMatchResult = async (m, result, score) => {
    await updateDoc(gdoc("calendar", m.fbId || String(m.id)), {result, score});
    setEditingMatchResult(null);
    showToast("Résultat enregistré ✓");
  };

  const savePayment = async (playerName) => {
    const added = parseFloat(paymentInput) || 0;
    const p = payments.find(x => x.player === playerName);
    if (!p) return;
    if (!confirmAction(`Enregistrer un paiement de ${added.toFixed(2)}€ pour ${playerName} ?`)) return;
    await updateDoc(gdoc("payments", p.fbId||playerName), {paid: Math.min(p.paid + added, p.total)});
    setEditingPayment(null); setPaymentInput(""); showToast("Paiement enregistré ✓");
  };

  const resetPayment = async (playerName) => {
    const p = payments.find(x => x.player === playerName);
    if (!p) return;
    if (typeof window !== "undefined" && !window.confirm(`Remettre à 0 le montant payé par ${playerName} ?`)) return;
    await updateDoc(gdoc("payments", p.fbId||playerName), {paid: 0});
    showToast(`Paiement de ${playerName} remis à 0`);
  };

  const handleAuth = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      if (authMode === "login") await signInWithEmailAndPassword(auth, authEmail, authPassword);
      else await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      setAuthEmail(""); setAuthPassword("");
    } catch(e) {
      const msgs = {"auth/user-not-found":"Email introuvable","auth/wrong-password":"Mot de passe incorrect","auth/email-already-in-use":"Email déjà utilisé","auth/weak-password":"Mot de passe trop court (6 car. min)","auth/invalid-email":"Email invalide","auth/invalid-credential":"Email ou mot de passe incorrect"};
      setAuthError(msgs[e.code] || "Erreur de connexion");
    }
    setAuthLoading(false);
  };

  const C = {
    card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.07)"},
    h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1},
    input: {width:"100%",padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14,boxSizing:"border-box",fontFamily:"'Nunito',sans-serif"},
    label: {fontSize:11,fontWeight:700,color:"#78909c",display:"block",marginBottom:4,textTransform:"uppercase"},
  };

  const renderCalCard = (m, nextId) => {
    const fbId = m.fbId || String(m.id);
    const isNext = fbId === nextId;
    const matchDoc = getMatchDoc(m);
    const matchTotal = matchDoc ? (matchDoc.entries||[]).reduce((s,e) => s+e.amount, 0) : 0;
    return (
      <div key={fbId} onClick={()=>{setViewMatchDetail(m); setExpandedPlayerInMatch(null);}} style={{background:"white",borderRadius:14,padding:"12px 16px",boxShadow:isNext?"0 4px 16px rgba(21,101,192,0.25)":"0 2px 8px rgba(0,0,0,0.06)",borderLeft:`4px solid ${m.home?"#1565c0":"#42a5f5"}`,outline:isNext?"2px solid #1565c0":"none",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:38,height:38,borderRadius:"50%",background:m.team==="Éq2"?"#e3f2fd":"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:m.team==="Éq2"?"#1565c0":"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:12,flexShrink:0}}>{m.team}</div>
          <div style={{flex:1,minWidth:0}}>
            {isNext && <div style={{display:"inline-block",background:"#1565c0",color:"white",fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:10,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Prochain match</div>}
            <div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>vs {m.opponent}</div>
            <div style={{fontSize:12,color:"#78909c",marginTop:2}}>{m.date} • {m.location} • {m.home?"🏠":"✈️"}</div>
            {matchTotal > 0 && <div style={{fontSize:11,color:"#1565c0",fontWeight:700,marginTop:4}}>💰 {matchTotal}€ d'amendes</div>}
          </div>
          {m.result && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,gap:2}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:9,height:9,borderRadius:"50%",background:m.result==="victoire"?"#2e7d32":m.result==="défaite"?"#c62828":"#9e9e9e",display:"inline-block",flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:800,color:m.result==="victoire"?"#2e7d32":m.result==="défaite"?"#c62828":"#616161",textTransform:"uppercase"}}>{m.result}</span>
              </div>
              {m.score && <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#0d47a1"}}>{m.score}</div>}
            </div>
          )}
        </div>
        {isAdmin && (
          <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #f0f0f0"}} onClick={e=>e.stopPropagation()}>
            {editingMatchResult===fbId ? (
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <select defaultValue={m.result||""} id={`res-${fbId}`} style={{...C.input,width:"auto",padding:"6px 10px",fontSize:12}}>
                  <option value="">À venir</option>
                  <option value="victoire">Victoire</option>
                  <option value="défaite">Défaite</option>
                  <option value="nul">Nul</option>
                </select>
                <input id={`score-${fbId}`} defaultValue={m.score||""} placeholder="Score ex: 28-25" style={{...C.input,width:120,padding:"6px 10px",fontSize:12}}/>
                <button onClick={()=>saveMatchResult(m, document.getElementById(`res-${fbId}`).value, document.getElementById(`score-${fbId}`).value)} style={{background:"#1565c0",color:"white",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>✓</button>
                <button onClick={()=>setEditingMatchResult(null)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"6px 10px",borderRadius:8,cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            ) : (
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>setEditingMatchResult(fbId)} style={{background:"#e3f2fd",color:"#1565c0",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>🏆 Résultat</button>
                <button onClick={()=>setEditingCalMatch({fbId, date:m.date||"", opponent:m.opponent||"", location:m.location||"", home:m.home!==false, team:m.team||"Éq1"})} style={{background:"#fff3e0",color:"#e65100",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>✏️ Modifier</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const Splash = ({text}) => (
    <div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:36}}>🤾</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpacing:2}}>{text}</div>
    </div>
  );

  if (!authReady) return <Splash text="Chargement..." />;

  if (!user && !guestMode) return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1565c0,#0d47a1)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"white",borderRadius:20,padding:32,width:"100%",maxWidth:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:32,marginBottom:12}}>🤾</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:2}}>HBC LANGEAC</div>
          <div style={{color:"#78909c",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Caisse Noire</div>
        </div>
        <div style={{display:"flex",background:"#f0f6ff",borderRadius:10,padding:4,marginBottom:20}}>
          {[{k:"login",l:"Connexion"},{k:"register",l:"Créer un compte"}].map(({k,l}) => (
            <button key={k} onClick={()=>{setAuthMode(k);setAuthError("");}}
              style={{flex:1,padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",fontWeight:800,fontSize:12,background:authMode===k?"#1565c0":"transparent",color:authMode===k?"white":"#78909c",transition:"all 0.2s"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email" inputMode="email" autoCapitalize="none" style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Mot de passe" onKeyDown={e=>e.key==="Enter"&&handleAuth()} style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:15,outline:"none",fontFamily:"'Nunito',sans-serif"}}/>
          {authError && <div style={{color:"#e53935",fontSize:13,fontWeight:700,textAlign:"center",padding:"8px",background:"#ffebee",borderRadius:8}}>{authError}</div>}
          <button onClick={handleAuth} disabled={authLoading} style={{background:"#1565c0",color:"white",border:"none",padding:"14px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:15,marginTop:4,fontFamily:"'Nunito',sans-serif"}}>
            {authLoading?"...":(authMode==="login"?"Se connecter":"Créer mon compte")}
          </button>
          <button onClick={()=>setGuestMode(true)} style={{background:"none",color:"#1565c0",border:"none",padding:"10px",cursor:"pointer",fontWeight:700,fontSize:13,textDecoration:"underline",marginTop:4}}>
            Continuer en invité (lecture seule)
          </button>
        </div>
      </div>
    </div>
  );

  // ============================ ÉCRAN D'ACCUEIL : CHOIX DU GROUPE ============================
  if (!activeGroupId) {
    if (groupsLoading) return <Splash text="Chargement des groupes..." />;
    if (migrating) return <Splash text="Migration de tes données..." />;
    return (
      <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
        {toast && <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1565c0",color:"white",padding:"10px 24px",borderRadius:30,fontWeight:800,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>{toast}</div>}

        {editingGroup && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"white",borderRadius:20,padding:28,width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
              <h3 style={{...C.h3,marginBottom:20}}>✏️ Renommer le groupe</h3>
              <input value={editingGroup.newName} onChange={e=>setEditingGroup(p=>({...p,newName:e.target.value}))} style={{...C.input,marginBottom:20}} placeholder="Nom du groupe" onKeyDown={e=>e.key==="Enter"&&renameGroup()}/>
              <div style={{display:"flex",gap:10}}>
                <button onClick={renameGroup} style={{flex:1,background:"#1565c0",color:"white",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Confirmer</button>
                <button onClick={()=>setEditingGroup(null)} style={{flex:1,background:"#eceff1",color:"#546e7a",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:700}}>Annuler</button>
              </div>
            </div>
          </div>
        )}

        <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)"}}>
          <div style={{maxWidth:900,margin:"0 auto",padding:"16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,flexShrink:0}}>🤾</div>
              <div>
                <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,lineHeight:1}}>HBC LANGEAC</div>
                <div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Caisse Noire</div>
              </div>
            </div>
            <button onClick={()=>{ if(user) signOut(auth); setGuestMode(false); setActiveGroupId(null); }} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 10px",color:"white",cursor:"pointer",fontSize:11,fontWeight:700,lineHeight:1.4}}>
              {isAdmin?"👑":guestMode?"👁️":"👤"}<br/>Déco
            </button>
          </div>
        </div>

        <div style={{maxWidth:900,margin:"0 auto",padding:"24px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:10}}>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#0d47a1",letterSpacing:1,margin:0}}>Choisis un groupe</h2>
            {isAdmin && <button onClick={()=>setShowCreateGroup(!showCreateGroup)} style={{background:"#2e7d32",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Nouveau groupe</button>}
          </div>
          <div style={{color:"#78909c",fontSize:13,marginBottom:20}}>Chaque groupe a ses propres joueurs, règles, matchs et paiements.</div>

          {isAdmin && showCreateGroup && (
            <div style={{...C.card,marginBottom:20}}>
              <h3 style={C.h3}>➕ Créer un groupe</h3>
              <label style={C.label}>Nom du groupe</label>
              <input value={newGroup.name} onChange={e=>setNewGroup(p=>({...p,name:e.target.value}))} placeholder="ex: Gars 26-27, Filles 26-27, Vétérans..." style={{...C.input,marginBottom:12}} onKeyDown={e=>e.key==="Enter"&&createGroup()}/>
              <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,cursor:"pointer",fontSize:13,color:"#1a237e",fontWeight:700}}>
                <input type="checkbox" checked={newGroup.seedRules} onChange={()=>setNewGroup(p=>({...p,seedRules:!p.seedRules}))}/>
                Pré-remplir avec les règles par défaut ({INITIAL_RULES.length} règles)
              </label>
              <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,cursor:"pointer",fontSize:13,color:"#1a237e",fontWeight:700}}>
                <input type="checkbox" checked={newGroup.seedCalendar} onChange={()=>setNewGroup(p=>({...p,seedCalendar:!p.seedCalendar}))}/>
                Pré-remplir avec le calendrier par défaut ({INITIAL_CALENDAR.length} matchs)
              </label>
              <div style={{display:"flex",gap:10}}>
                <button onClick={createGroup} style={{background:"#2e7d32",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Créer</button>
                <button onClick={()=>setShowCreateGroup(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Annuler</button>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <div style={{...C.card,textAlign:"center",color:"#90a4ae",padding:40}}>
              {isAdmin ? "Aucun groupe pour l'instant — crée le premier avec le bouton ci-dessus." : "Aucun groupe disponible pour l'instant."}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
              {groups.map(g => (
                <div key={g.id} style={{...C.card,borderTop:"4px solid #1565c0",padding:18,position:"relative",cursor:"pointer"}}>
                  {isAdmin && (
                    <div style={{position:"absolute",top:10,right:10,display:"flex",gap:5}}>
                      <button onClick={e=>{e.stopPropagation();setEditingGroup({id:g.id,newName:g.name});}} style={{background:"#e3f2fd",color:"#1565c0",border:"none",width:24,height:24,borderRadius:5,cursor:"pointer",fontSize:11}}>✏️</button>
                      <button onClick={e=>{e.stopPropagation();deleteGroup(g);}} style={{background:"#ffebee",color:"#e53935",border:"none",width:24,height:24,borderRadius:5,cursor:"pointer",fontSize:11}}>🗑</button>
                    </div>
                  )}
                  <div onClick={()=>{setActiveGroupId(g.id); setActiveTab("Dashboard");}}>
                    <div style={{width:44,height:44,borderRadius:14,background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,marginBottom:10}}>🏐</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#0d47a1",letterSpacing:1,lineHeight:1.1}}>{g.name}</div>
                    <div style={{fontSize:11,color:"#90a4ae",marginTop:4}}>{g.createdAt ? `Créé le ${new Date(g.createdAt).toLocaleDateString("fr-FR")}` : ""}</div>
                    <div style={{marginTop:12,display:"inline-block",background:"#e3f2fd",color:"#1565c0",fontSize:12,fontWeight:800,padding:"6px 14px",borderRadius:8}}>Ouvrir →</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================ APPLI DANS UN GROUPE ============================
  if (loading) return <Splash text="Chargement..." />;

  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      {toast && <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1565c0",color:"white",padding:"10px 24px",borderRadius:30,fontWeight:800,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>{toast}</div>}

      {editingPlayerName && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"white",borderRadius:20,padding:28,width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <h3 style={{...C.h3,marginBottom:20}}>✏️ Renommer le joueur</h3>
            <label style={C.label}>Ancien nom</label>
            <div style={{padding:"10px",background:"#f0f6ff",borderRadius:8,marginBottom:12,fontWeight:700,color:"#546e7a"}}>{editingPlayerName.old}</div>
            <label style={C.label}>Nouveau nom</label>
            <input value={editingPlayerName.newName} onChange={e=>setEditingPlayerName(p=>({...p,newName:e.target.value}))} style={{...C.input,marginBottom:20}} placeholder="Nouveau prénom" onKeyDown={e=>e.key==="Enter"&&renamePlayer()}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={renamePlayer} style={{flex:1,background:"#1565c0",color:"white",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Confirmer</button>
              <button onClick={()=>setEditingPlayerName(null)} style={{flex:1,background:"#eceff1",color:"#546e7a",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:700}}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {editingCalMatch && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setEditingCalMatch(null)}>
          <div style={{background:"white",borderRadius:20,padding:28,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
            <h3 style={{...C.h3,marginBottom:20}}>✏️ Modifier le match</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
              <div>
                <label style={C.label}>DATE</label>
                <input value={editingCalMatch.date} onChange={e=>setEditingCalMatch(p=>({...p,date:e.target.value}))} placeholder="ex: 12/09/2026" style={C.input}/>
              </div>
              <div>
                <label style={C.label}>ADVERSAIRE</label>
                <input value={editingCalMatch.opponent} onChange={e=>setEditingCalMatch(p=>({...p,opponent:e.target.value}))} placeholder="Nom" style={C.input}/>
              </div>
              <div>
                <label style={C.label}>LIEU</label>
                <input value={editingCalMatch.location} onChange={e=>setEditingCalMatch(p=>({...p,location:e.target.value}))} placeholder="Ville" style={C.input}/>
              </div>
              <div>
                <label style={C.label}>DOM / EXT</label>
                <select value={editingCalMatch.home} onChange={e=>setEditingCalMatch(p=>({...p,home:e.target.value==="true"}))} style={C.input}>
                  <option value="true">Domicile</option>
                  <option value="false">Extérieur</option>
                </select>
              </div>
              <div>
                <label style={C.label}>ÉQUIPE</label>
                <select value={editingCalMatch.team} onChange={e=>setEditingCalMatch(p=>({...p,team:e.target.value}))} style={C.input}>
                  <option value="Éq1">Équipe 1</option>
                  <option value="Éq2">Équipe 2</option>
                </select>
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={saveCalendarMatch} style={{flex:1,background:"#1565c0",color:"white",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:14}}>Enregistrer</button>
              <button onClick={()=>setEditingCalMatch(null)} style={{flex:1,background:"#eceff1",color:"#546e7a",border:"none",padding:"12px",borderRadius:10,cursor:"pointer",fontWeight:700}}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {viewMatchDetail && (() => {
        const m = viewMatchDetail;
        const matchDoc = getMatchDoc(m);
        const entries = matchDoc ? (matchDoc.entries||[]) : [];
        const total = entries.reduce((s,e)=>s+e.amount,0);
        const byPlayer = {};
        entries.forEach(e => {
          if (!byPlayer[e.player]) byPlayer[e.player] = {total:0, items:[]};
          byPlayer[e.player].total += e.amount;
          byPlayer[e.player].items.push(e);
        });
        const ranked = Object.entries(byPlayer).sort((a,b)=>b[1].total-a[1].total);
        const closeModal = () => { setViewMatchDetail(null); setExpandedPlayerInMatch(null); };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeModal}>
            <div style={{background:"white",borderRadius:20,padding:24,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:10}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"#78909c",textTransform:"uppercase"}}>{m.team === "Éq2" ? "Équipe 2" : "Équipe 1"}</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1"}}>vs {m.opponent}</div>
                  <div style={{fontSize:12,color:"#78909c",marginTop:2}}>{m.date} • {m.location} • {m.home?"🏠 Domicile":"✈️ Extérieur"}</div>
                  {m.result && <div style={{marginTop:6,fontSize:12,fontWeight:800,color:m.result==="victoire"?"#2e7d32":m.result==="défaite"?"#c62828":"#616161"}}>{m.result.toUpperCase()} {m.score?`(${m.score})`:""}</div>}
                </div>
                <button onClick={closeModal} style={{background:"#eceff1",color:"#546e7a",border:"none",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,padding:"10px 14px",background:"#f0f6ff",borderRadius:10}}>
                <span style={{fontWeight:700,color:"#1a237e",fontSize:13}}>Total amendes</span>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1565c0"}}>{total}€</span>
              </div>
              <div style={{fontSize:11,fontWeight:800,color:"#78909c",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Classement des pires payeurs — ce match</div>
              {ranked.length === 0 ? (
                <div style={{color:"#90a4ae",padding:20,textAlign:"center"}}>Aucune infraction enregistrée pour ce match</div>
              ) : ranked.map(([playerName, data], i) => {
                const isExpanded = expandedPlayerInMatch === playerName;
                return (
                  <div key={playerName} style={{marginBottom:8}}>
                    <div onClick={()=>setExpandedPlayerInMatch(isExpanded?null:playerName)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#f8fbff",borderRadius:10,cursor:"pointer",borderLeft:`4px solid ${i===0?"#e53935":"#1565c0"}`}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                      <div style={{flex:1,fontWeight:800,color:"#1a237e",fontSize:13}}>{playerName}</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#1565c0"}}>{data.total}€</div>
                      <div style={{color:"#90a4ae",fontSize:11}}>{isExpanded?"▲":"▼"}</div>
                    </div>
                    {isExpanded && (
                      <div style={{marginTop:4,paddingLeft:8}}>
                        {data.items.map((e,j) => (
                          <div key={j} style={{display:"flex",alignItems:"center",padding:"6px 10px",background:"white",borderRadius:8,marginBottom:4,border:"1px solid #f0f0f0"}}>
                            <div style={{fontSize:12,color:"#546e7a",flex:1}}>{e.detail}</div>
                            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"#1565c0"}}>{e.amount}€</div>
                              {isAdmin && matchDoc && <button onClick={()=>deleteInfraction(matchDoc.fbId||String(matchDoc.id), entries.indexOf(e))} style={{background:"#ffebee",color:"#e53935",border:"none",width:22,height:22,borderRadius:6,cursor:"pointer",fontSize:10}}>🗑</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button onClick={()=>downloadMatchPDF(m, ranked, total)} style={{flex:1,background:"#0d47a1",color:"white",border:"none",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>📄 Télécharger le PDF</button>
                <button onClick={()=>copyMatchSummary(m, ranked, total)} style={{flex:1,background:"#e3f2fd",color:"#1565c0",border:"none",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>📋 Copier le texte</button>
              </div>

              {isAdmin && (
                <button onClick={()=>{ setNewInfraction(p=>({...p, mode:"player", calMatchId: m.fbId||String(m.id)})); setActiveTab("Joueurs"); setShowAddInfraction(true); closeModal(); }} style={{marginTop:8,width:"100%",background:"#1565c0",color:"white",border:"none",padding:"10px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Ajouter une infraction pour ce match</button>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
            <button onClick={leaveGroup} title="Changer de groupe" style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,flexShrink:0,border:"none",cursor:"pointer"}}>🤾</button>
            <div style={{minWidth:0}}>
              <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,lineHeight:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeGroup?.name || "HBC LANGEAC"}</div>
              <button onClick={leaveGroup} style={{background:"none",border:"none",padding:0,color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",cursor:"pointer",textDecoration:"underline"}}>⇄ Changer de groupe</button>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12px",textAlign:"center"}}>
              <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Total</div>
              <div style={{color:"white",fontSize:22,fontFamily:"'Bebas Neue',sans-serif"}}>{totalCaisse.toFixed(1)}€</div>
            </div>
            <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12px",textAlign:"center",minWidth:92}}>
              <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Objectif {goal}€</div>
              <div style={{width:"100%",height:6,background:"rgba(255,255,255,0.25)",borderRadius:3,marginTop:4}}>
                <div style={{width:`${goalPct}%`,height:"100%",background:"#ffca28",borderRadius:3}}/>
              </div>
              <div style={{color:"white",fontSize:11,fontWeight:800,marginTop:2}}>{goalPct}%</div>
            </div>
            <button onClick={()=>{ if(user) signOut(auth); setGuestMode(false); setActiveGroupId(null); }} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 10px",color:"white",cursor:"pointer",fontSize:11,fontWeight:700,lineHeight:1.4}}>
              {isAdmin?"👑":guestMode?"👁️":"👤"}<br/>Déco
            </button>
          </div>
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          <div style={{display:"flex",padding:"0 16px",minWidth:"max-content"}}>
            {NAV_ITEMS.map(tab => (
              <button key={tab} onClick={()=>setActiveTab(tab)} style={{background:"none",border:"none",padding:"10px 14px",cursor:"pointer",color:activeTab===tab?"white":"rgba(255,255,255,0.6)",fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:12,borderBottom:activeTab===tab?"3px solid white":"3px solid transparent",whiteSpace:"nowrap"}}>{tab}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"16px 12px"}}>

        {activeTab==="Dashboard" && (
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
              {[{label:"Total caisse",value:`${totalCaisse.toFixed(1)}€`,color:"#1565c0",icon:"💰"},{label:"Matchs",value:matchTotals.filter(m=>m.total>0).length,color:"#1976d2",icon:"🏆"},{label:"Joueurs",value:players.length,color:"#1e88e5",icon:"👥"},{label:"Record",value:`${Math.max(0,...matchTotals.map(m=>m.total))}€`,color:"#2196f3",icon:"🔥"}].map(card => (
                <div key={card.label} style={{...C.card,borderTop:`4px solid ${card.color}`,padding:16}}>
                  <div style={{fontSize:24}}>{card.icon}</div>
                  <div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",color:card.color}}>{card.value}</div>
                  <div style={{fontSize:11,color:"#78909c",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{card.label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={C.card}>
                <h3 style={C.h3}>🏆 Top Mauvais Élèves</h3>
                {topOffenders.map(([name,stats],i) => (
                  <div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f0f0f0",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d03f":i===1?"#bdc3c7":i===2?"#e59866":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i<3?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0"}}>{stats.total}€</div>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>😈 Classement Chaboulat</h3>
                {topChaboula.filter(([,s])=>s.chaboula>0).map(([name,stats],i) => (
                  <div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f0f0f0",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53935"}}>{stats.chaboula}×</div>
                  </div>
                ))}
              </div>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <h3 style={C.h3}>📅 Matchs (du plus récent)</h3>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10}}>
                  {matchTotals.filter(m=>m.total>0).slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
                    <div key={m.fbId||m.id} style={{background:"#f0f6ff",borderRadius:12,padding:"12px 14px",borderLeft:"4px solid #1565c0"}}>
                      <div style={{fontWeight:800,fontSize:11,color:"#0d47a1"}}>{m.match}</div>
                      <div style={{fontSize:11,color:"#78909c",marginTop:2}}>{m.date}</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0",marginTop:4}}>{m.total}€</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab==="Paiements" && (
          <div>
            <div style={{...C.card,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom: (rib || isAdmin) ? 10 : 0,flexWrap:"wrap",gap:8}}>
                <h3 style={{...C.h3,margin:0}}>🏦 RIB de la caisse noire</h3>
                {isAdmin && (
                  <button onClick={()=>{setEditingRib(rib ? {...rib} : {holder:"",iban:"",bic:""}); setShowRibEdit(!showRibEdit);}} style={{background:"#e3f2fd",color:"#1565c0",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>✏️ {rib ? "Modifier" : "Ajouter"}</button>
                )}
              </div>
              {showRibEdit ? (
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:12}}>
                    <div><label style={C.label}>Titulaire</label><input value={editingRib?.holder||""} onChange={e=>setEditingRib(p=>({...p,holder:e.target.value}))} placeholder="Nom du titulaire" style={C.input}/></div>
                    <div><label style={C.label}>IBAN</label><input value={editingRib?.iban||""} onChange={e=>setEditingRib(p=>({...p,iban:e.target.value}))} placeholder="FR76..." style={C.input}/></div>
                    <div><label style={C.label}>BIC</label><input value={editingRib?.bic||""} onChange={e=>setEditingRib(p=>({...p,bic:e.target.value}))} placeholder="XXXXXXXX" style={C.input}/></div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={saveRib} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:13}}>Enregistrer</button>
                    <button onClick={()=>setShowRibEdit(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:13}}>Annuler</button>
                  </div>
                </div>
              ) : rib ? (
                <div>
                  <div style={{fontSize:13,color:"#1a237e",lineHeight:1.9}}>
                    <div><strong>Titulaire :</strong> {rib.holder||"—"}</div>
                    <div><strong>IBAN :</strong> {rib.iban||"—"}</div>
                    <div><strong>BIC :</strong> {rib.bic||"—"}</div>
                  </div>
                  <button onClick={copyRib} style={{marginTop:10,background:"#1565c0",color:"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:13}}>📋 Copier le RIB</button>
                </div>
              ) : (
                <div style={{color:"#90a4ae",fontSize:13}}>{isAdmin ? "Aucun RIB enregistré — clique sur \"Ajouter\" pour le renseigner." : "Aucun RIB renseigné pour l'instant."}</div>
              )}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>💳 Paiements</h2>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[{label:"Total dû",value:`${payments.reduce((s,p)=>s+p.total,0).toFixed(1)}€`,color:"#0d47a1"},{label:"Payé",value:`${payments.reduce((s,p)=>s+p.paid,0).toFixed(1)}€`,color:"#2e7d32"},{label:"Reste",value:`${payments.reduce((s,p)=>s+(p.total-p.paid),0).toFixed(1)}€`,color:"#c62828"}].map(c => (
                  <div key={c.label} style={{background:"white",borderRadius:12,padding:"8px 12px",boxShadow:"0 2px 8px rgba(0,0,0,0.07)",textAlign:"center"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#78909c",textTransform:"uppercase",letterSpacing:1}}>{c.label}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c.color}}>{c.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <input value={paymentSearch} onChange={e=>setPaymentSearch(e.target.value)} placeholder="🔍 Rechercher un joueur..." style={{...C.input,marginBottom:14,maxWidth:320}}/>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {payments.filter(p => p.player.toLowerCase().includes(paymentSearch.trim().toLowerCase())).slice().sort((a,b)=>(b.total-b.paid)-(a.total-a.paid)).map(p => {
                const reste = p.total - p.paid;
                const pct = p.total > 0 ? Math.round((p.paid/p.total)*100) : 0;
                const isPaid = reste <= 0;
                return (
                  <div key={p.player} style={{background:isPaid?"#f1f8e9":"white",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",borderLeft:`4px solid ${isPaid?"#4caf50":"#1565c0"}`}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                        <div style={{width:36,height:36,borderRadius:"50%",background:isPaid?"linear-gradient(135deg,#2e7d32,#66bb6a)":"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,flexShrink:0}}>{p.player[0]}</div>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:800,color:"#0d47a1",fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.player}</div>
                          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                            <div style={{width:70,height:5,background:"#e3f2fd",borderRadius:3,flexShrink:0}}><div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:isPaid?"#4caf50":"#1565c0",borderRadius:3}}/></div>
                            <span style={{fontSize:10,color:"#90a4ae",fontWeight:700}}>{pct}%</span>
                            {isPaid&&<span style={{fontSize:10,color:"#2e7d32",fontWeight:800}}>✓</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:10,flexShrink:0}}>
                        {[{l:"Dû",v:p.total,c:"#0d47a1"},{l:"Payé",v:p.paid,c:"#2e7d32"},{l:"Reste",v:isPaid?0:reste,c:isPaid?"#4caf50":"#c62828"}].map(({l,v,c}) => (
                          <div key={l} style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#90a4ae",fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:c}}>{v.toFixed(1)}€</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {isAdmin && (
                      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                        {editingPayment===p.player ? (
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <input type="number" value={paymentInput} onChange={e=>setPaymentInput(e.target.value)} placeholder="Montant €" inputMode="decimal" style={{width:100,padding:"8px 10px",borderRadius:8,border:"2px solid #1565c0",fontSize:14,fontFamily:"'Nunito',sans-serif"}}/>
                            <button onClick={()=>savePayment(p.player)} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:14}}>✓</button>
                            <button onClick={()=>{setEditingPayment(null);setPaymentInput("");}} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:14}}>✕</button>
                          </div>
                        ) : (
                          <button onClick={()=>{setEditingPayment(p.player);setPaymentInput("");}} disabled={isPaid} style={{background:isPaid?"#e8f5e9":"#1565c0",color:isPaid?"#4caf50":"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:isPaid?"default":"pointer",fontWeight:800,fontSize:13}}>
                            {isPaid?"✓ Soldé":"+ Enregistrer paiement"}
                          </button>
                        )}
                        {p.paid > 0 && (
                          <button onClick={()=>resetPayment(p.player)} title="Remettre le payé à 0" style={{background:"#fff3e0",color:"#e65100",border:"none",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:13}}>
                            ↺ Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab==="Joueurs" && (
          <div>
            {selectedPlayer ? (
              <div>
                <button onClick={()=>{setSelectedPlayer(null);setExpandedPlayerMatch(null);}} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontWeight:700,marginBottom:16}}>← Retour</button>
                <div style={C.card}>
                  <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
                    <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:26,flexShrink:0}}>{selectedPlayer[0]}</div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#0d47a1",letterSpacing:1}}>{selectedPlayer}</div>
                      <div style={{color:"#78909c",fontSize:13}}>Total : <strong style={{color:"#1565c0"}}>{playerStats[selectedPlayer]?.total||0}€</strong> • Chaboulats : <strong style={{color:"#e53935"}}>{playerStats[selectedPlayer]?.chaboula||0}</strong></div>
                    </div>
                    {isAdmin && <button onClick={()=>setEditingPlayerName({old:selectedPlayer,newName:selectedPlayer})} style={{background:"#e3f2fd",color:"#1565c0",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13,flexShrink:0}}>✏️ Renommer</button>}
                  </div>
                  {(()=>{ const stats = getPlayerInfractionStats(playerStats[selectedPlayer]?.entries||[]); if (!stats.length) return null; return (<div style={{marginBottom:16}}><div style={{fontSize:11,fontWeight:800,color:"#78909c",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Récurrences notables</div><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{stats.map(([label,count]) => (<div key={label} style={{background:"#e3f2fd",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:800,color:"#1565c0"}}>{label} <span style={{background:"#1565c0",color:"white",borderRadius:10,padding:"1px 7px",marginLeft:4,fontSize:11}}>{count}×</span></div>))}</div></div>); })()}
                  <h4 style={{color:"#0d47a1",fontFamily:"'Bebas Neue',sans-serif",fontSize:17,margin:"0 0 12px",letterSpacing:1}}>Historique</h4>
                  {(()=>{
                    const entries = (playerStats[selectedPlayer]?.entries||[]).filter(e=>e.amount>0);
                    const byMatch = {};
                    entries.forEach(e => { if (!byMatch[e.matchLabel]) byMatch[e.matchLabel] = {date:e.matchDate,sortKey:e.sortKey||0,entries:[]}; byMatch[e.matchLabel].entries.push(e); });
                    const sorted = Object.entries(byMatch).sort((a,b)=>(b[1].sortKey||0)-(a[1].sortKey||0));
                    if (!sorted.length) return <div style={{color:"#90a4ae",padding:20,textAlign:"center"}}>Aucune infraction</div>;
                    return sorted.map(([matchLabel,{date,entries:mE}]) => {
                      const isOpen = expandedPlayerMatch === matchLabel;
                      return (
                        <div key={matchLabel} style={{marginBottom:8}}>
                          <div onClick={()=>setExpandedPlayerMatch(isOpen?null:matchLabel)} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:"#e3f2fd",borderRadius:10,cursor:"pointer"}}>
                            <div style={{fontSize:12,fontWeight:800,color:"#0d47a1",flex:1}}>{matchLabel}</div>
                            <div style={{fontSize:11,color:"#546e7a"}}>{date}</div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#1565c0"}}>{mE.reduce((s,e)=>s+e.amount,0)}€</div>
                            <div style={{color:"#546e7a",fontSize:11}}>{isOpen?"▲":"▼"}</div>
                          </div>
                          {isOpen && (
                            <div style={{marginTop:6}}>
                              {mE.map((e,i) => (
                                <div key={i} style={{display:"flex",alignItems:"center",padding:"8px 12px",background:"#f8fbff",borderRadius:8,marginBottom:4,borderLeft:`3px solid ${e.amount>10?"#e53935":e.amount>5?"#fb8c00":"#1565c0"}`}}>
                                  <div style={{fontSize:13,color:"#546e7a",flex:1}}>{e.detail}</div>
                                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:e.amount>10?"#e53935":e.amount>5?"#fb8c00":"#1565c0"}}>{e.amount}€</div>
                                    {isAdmin && <button onClick={()=>deleteInfraction(e.matchId,e.entryIndex)} style={{background:"#ffebee",color:"#e53935",border:"none",width:26,height:26,borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:10,flexWrap:"wrap"}}>
                  <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>👥 Joueurs</h2>
                  {isAdmin && (
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>setShowAddPlayer(!showAddPlayer)} style={{background:"#2e7d32",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Joueur</button>
                      <button onClick={()=>setShowAddInfraction(!showAddInfraction)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Infraction</button>
                    </div>
                  )}
                </div>

                {isAdmin && showAddPlayer && (
                  <div style={{...C.card,marginBottom:16}}>
                    <h3 style={C.h3}>➕ Ajouter un joueur</h3>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <input value={newPlayerName} onChange={e=>setNewPlayerName(e.target.value)} placeholder="Prénom du joueur" style={{flex:1,minWidth:160,...C.input}} onKeyDown={e=>e.key==="Enter"&&addPlayer()}/>
                      <button onClick={addPlayer} style={{background:"#2e7d32",color:"white",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                      <button onClick={()=>setShowAddPlayer(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 12px",borderRadius:8,cursor:"pointer"}}>✕</button>
                    </div>
                  </div>
                )}

                {isAdmin && showAddInfraction && (
                  <div style={{...C.card,marginBottom:16}}>
                    <h3 style={C.h3}>Ajouter des infractions</h3>

                    <div style={{display:"flex",background:"#f0f6ff",borderRadius:10,padding:4,marginBottom:14,maxWidth:320}}>
                      {[{k:"player",l:"Par joueur"},{k:"rule",l:"Par infraction"}].map(({k,l}) => (
                        <button key={k} onClick={()=>setNewInfraction(p=>({...p,mode:k,checkedRules:{},checkedPlayers:{},selectedRuleId:"",player:""}))}
                          style={{flex:1,padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",fontWeight:800,fontSize:12,background:newInfraction.mode===k?"#1565c0":"transparent",color:newInfraction.mode===k?"white":"#78909c"}}>{l}</button>
                      ))}
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:14}}>
                      {newInfraction.mode === "player" && (
                        <div>
                          <label style={C.label}>Joueur</label>
                          <select value={newInfraction.player} onChange={e=>setNewInfraction(p=>({...p,player:e.target.value}))} style={C.input}>
                            <option value="">Choisir</option>
                            {players.map(p=><option key={p}>{p}</option>)}
                          </select>
                        </div>
                      )}
                      {newInfraction.mode === "rule" && (
                        <div>
                          <label style={C.label}>Infraction</label>
                          <select value={newInfraction.selectedRuleId} onChange={e=>setNewInfraction(p=>({...p,selectedRuleId:e.target.value}))} style={C.input}>
                            <option value="">Choisir</option>
                            {rules.map(r=><option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                          </select>
                        </div>
                      )}
                      <div>
                        <label style={C.label}>Match (calendrier)</label>
                        <select value={newInfraction.calMatchId} onChange={e=>setNewInfraction(p=>({...p,calMatchId:e.target.value}))} style={C.input}>
                          <option value="">Hors match</option>
                          {sortedCalendar.map(m => (
                            <option key={m.fbId||m.id} value={m.fbId||String(m.id)}>{m.team} — vs {m.opponent} ({m.date})</option>
                          ))}
                        </select>
                        {!sortedCalendar.length && <div style={{fontSize:11,color:"#90a4ae",marginTop:4}}>Aucun match au calendrier pour l'instant — ajoute-le dans l'onglet Calendrier.</div>}
                      </div>
                    </div>

                    {newInfraction.mode === "player" && (
                      <>
                        <label style={C.label}>Règles (coche + choisis le nombre de fois, 1 à 5)</label>
                        <input value={infractionRuleSearch} onChange={e=>setInfractionRuleSearch(e.target.value)} placeholder="🔍 Rechercher une règle..." style={{...C.input,marginBottom:8}}/>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:6,marginBottom:14,maxHeight:280,overflowY:"auto",padding:"8px",background:"#f8fbff",borderRadius:8}}>
                          {rules.filter(r => r.name.toLowerCase().includes(infractionRuleSearch.trim().toLowerCase())).map(r => {
                            const qty = newInfraction.checkedRules[r.id];
                            return (
                              <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:qty?"#e3f2fd":"transparent"}}>
                                <input type="checkbox" checked={!!qty} onChange={()=>toggleRule(r.id)}/>
                                <span onClick={()=>toggleRule(r.id)} style={{fontSize:13,color:"#1a237e",flex:1,cursor:"pointer"}}>{r.name}</span>
                                <span style={{fontSize:12,fontWeight:800,color:"#1565c0"}}>{r.amount}€</span>
                                {qty ? (
                                  <select value={qty} onChange={e=>setRuleQty(r.id, parseInt(e.target.value))} style={{padding:"3px 6px",borderRadius:6,border:"1px solid #90caf9",fontSize:12}}>
                                    {QTY_OPTIONS.map(n=><option key={n} value={n}>×{n}</option>)}
                                  </select>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {newInfraction.mode === "rule" && (
                      <>
                        <label style={C.label}>Joueurs concernés (coche + nombre de fois, 1 à 5)</label>
                        <input value={infractionPlayerSearch} onChange={e=>setInfractionPlayerSearch(e.target.value)} placeholder="🔍 Rechercher un joueur..." style={{...C.input,marginBottom:8}}/>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6,marginBottom:14,maxHeight:280,overflowY:"auto",padding:"8px",background:"#f8fbff",borderRadius:8}}>
                          {players.filter(p => p.toLowerCase().includes(infractionPlayerSearch.trim().toLowerCase())).map(p => {
                            const qty = newInfraction.checkedPlayers[p];
                            return (
                              <div key={p} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:qty?"#e3f2fd":"transparent"}}>
                                <input type="checkbox" checked={!!qty} onChange={()=>togglePlayerForRule(p)}/>
                                <span onClick={()=>togglePlayerForRule(p)} style={{fontSize:13,color:"#1a237e",flex:1,cursor:"pointer"}}>{p}</span>
                                {qty ? (
                                  <select value={qty} onChange={e=>setPlayerQty(p, parseInt(e.target.value))} style={{padding:"3px 6px",borderRadius:6,border:"1px solid #90caf9",fontSize:12}}>
                                    {QTY_OPTIONS.map(n=><option key={n} value={n}>×{n}</option>)}
                                  </select>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {newInfraction.mode === "player" && (
                      <>
                        <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,cursor:"pointer"}}>
                          <input type="checkbox" checked={newInfraction.useWeight} onChange={()=>setNewInfraction(p=>({...p,useWeight:!p.useWeight}))}/>
                          <span style={{fontWeight:700,color:"#1a237e",fontSize:13}}>⚖️ Règle poids (0,50€/100g)</span>
                        </label>
                        {newInfraction.useWeight && (()=> {
                          const wd = weights.find(w => w.player === newInfraction.player);
                          const period = newInfraction.weightPeriod;
                          const refWeight = period === "mi" ? wd?.startWeight : period === "fin" ? (wd?.midWeight || wd?.startWeight) : null;
                          return (
                          <div style={{marginBottom:14}}>
                            <div style={{marginBottom:12}}>
                              <label style={C.label}>Période de pesée</label>
                              <select value={period} onChange={e=>setNewInfraction(p=>({...p,weightPeriod:e.target.value,weightStart:"",weightCurrent:""}))} style={C.input}>
                                {WEIGHT_PERIODS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
                              </select>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                              {period !== "avant" && (
                                <div>
                                  <label style={C.label}>{period === "mi" ? "Poids début saison (kg)" : "Poids mi-saison (kg)"}</label>
                                  {refWeight ? (
                                    <div style={{padding:"10px",background:"#e3f2fd",borderRadius:8,fontWeight:700,color:"#1565c0",fontSize:14}}>{refWeight} kg (auto)</div>
                                  ) : (
                                    <input type="number" inputMode="decimal" value={newInfraction.weightStart||""} onChange={e=>setNewInfraction(p=>({...p,weightStart:e.target.value}))} placeholder="ex: 80.0" style={C.input}/>
                                  )}
                                </div>
                              )}
                              <div>
                                <label style={C.label}>{period === "avant" ? "Poids de référence (kg)" : period === "mi" ? "Poids mi-saison (kg)" : "Poids fin de saison (kg)"}</label>
                                <input type="number" inputMode="decimal" value={newInfraction.weightCurrent||""} onChange={e=>setNewInfraction(p=>({...p,weightCurrent:e.target.value}))} placeholder="ex: 82.5" style={C.input}/>
                              </div>
                              {period !== "avant" && newInfraction.weightCurrent && (
                                <div style={{display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",background:"#fff3e0",borderRadius:8,padding:12}}>
                                  <div style={{fontSize:11,fontWeight:700,color:"#e65100",textTransform:"uppercase"}}>Amende calculée</div>
                                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#e65100"}}>{calcWeightAmount(refWeight || parseFloat(newInfraction.weightStart), parseFloat(newInfraction.weightCurrent)).toFixed(2)}€</div>
                                </div>
                              )}
                            </div>
                            {period === "avant" && <div style={{fontSize:11,color:"#90a4ae",marginTop:6}}>💡 Ce poids sera enregistré comme référence de début de saison — aucune amende n'est appliquée.</div>}
                          </div>
                          );
                        })()}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                          <div>
                            <label style={C.label}>+ Détail personnalisé (optionnel)</label>
                            <input value={newInfraction.customDetail} onChange={e=>setNewInfraction(p=>({...p,customDetail:e.target.value}))} placeholder="Description" style={C.input}/>
                          </div>
                          <div>
                            <label style={C.label}>Montant (€)</label>
                            <input type="number" inputMode="decimal" value={newInfraction.customAmount} onChange={e=>setNewInfraction(p=>({...p,customAmount:e.target.value}))} placeholder="0" style={C.input}/>
                          </div>
                        </div>
                      </>
                    )}

                    <div style={{display:"flex",gap:10,marginTop:14}}>
                      <button onClick={addInfraction} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Valider</button>
                      <button onClick={()=>{setShowAddInfraction(false);setNewInfraction(p=>({...p,player:"",checkedRules:{},checkedPlayers:{},selectedRuleId:"",useWeight:false,weightPeriod:"avant",customDetail:"",customAmount:""}));}} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Fermer</button>
                    </div>
                    <div style={{fontSize:11,color:"#90a4ae",marginTop:8}}>
                      💡 {newInfraction.mode==="player" ? "Le match reste sélectionné : choisis simplement le joueur suivant pour enchaîner." : "Le match et l'infraction restent sélectionnés : change juste les joueurs pour enchaîner."}
                    </div>
                  </div>
                )}

                <input value={playerSearch} onChange={e=>setPlayerSearch(e.target.value)} placeholder="🔍 Rechercher un joueur..." style={{...C.input,marginBottom:14,maxWidth:320}}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                  {players.filter(p => p.toLowerCase().includes(playerSearch.trim().toLowerCase())).slice().sort((a,b)=>(playerStats[b]?.total||0)-(playerStats[a]?.total||0)).map(player => {
                    const isHidden = playersList.find(p=>p.name===player)?.hidden;
                    if (isHidden) return null;
                    return (
                      <div key={player} style={{...C.card,cursor:"pointer",borderTop:"4px solid #1565c0",padding:16,position:"relative"}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"} onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                        {isAdmin && (
                          <div style={{position:"absolute",top:8,right:8,display:"flex",gap:4}}>
                            <button onClick={e=>{e.stopPropagation();setEditingPlayerName({old:player,newName:player});}} style={{background:"#e3f2fd",color:"#1565c0",border:"none",width:22,height:22,borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
                            <button onClick={e=>{e.stopPropagation();hidePlayer(player);}} style={{background:"#ffebee",color:"#e53935",border:"none",width:22,height:22,borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
                          </div>
                        )}
                        <div onClick={()=>setSelectedPlayer(player)}>
                          <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#1565c0,#42a5f5)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,marginBottom:8}}>{player[0]}</div>
                          <div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>{player}</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1565c0"}}>{playerStats[player]?.total||0}€</div>
                          {playerStats[player]?.chaboula>0 && <div style={{fontSize:11,color:"#e53935",fontWeight:700,marginTop:4}}>😈 {playerStats[player].chaboula}×</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab==="Règles" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>📋 Règles</h2>
              {isAdmin && <button onClick={()=>setShowAddRule(!showAddRule)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Règle</button>}
            </div>
            {isAdmin && (
              <div style={{marginBottom:12}}>
                <button onClick={()=>setShowRuleHistory(!showRuleHistory)} style={{background:"#e3f2fd",color:"#1565c0",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>
                  🕘 Historique des modifications ({ruleHistory.length}) {showRuleHistory?"▲":"▼"}
                </button>
                {showRuleHistory && (
                  <div style={{background:"white",borderRadius:12,padding:12,marginTop:8,boxShadow:"0 2px 8px rgba(0,0,0,0.06)",maxHeight:260,overflowY:"auto"}}>
                    {ruleHistory.length === 0 ? (
                      <div style={{color:"#90a4ae",padding:12,textAlign:"center",fontSize:12}}>Aucune modification enregistrée pour l'instant</div>
                    ) : ruleHistory.map(h => (
                      <div key={h.fbId} style={{padding:"8px 10px",borderBottom:"1px solid #f0f0f0",fontSize:12}}>
                        <div style={{fontWeight:700,color:"#1a237e"}}>
                          {h.action === "ajout" && `➕ Règle "${h.ruleName}" ajoutée à ${h.newAmount}€`}
                          {h.action === "modification" && `✏️ Règle "${h.oldName||h.ruleName}" modifiée : ${h.oldAmount}€ → ${h.newAmount}€${h.oldName && h.oldName!==h.ruleName ? ` (renommée en "${h.ruleName}")` : ""}`}
                          {h.action === "suppression" && `🗑 Règle "${h.ruleName}" supprimée (était à ${h.oldAmount}€)`}
                        </div>
                        <div style={{color:"#90a4ae",marginTop:2}}>{h.timestamp ? new Date(h.timestamp).toLocaleString("fr-FR") : ""} {h.by ? `— ${h.by}` : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{background:"#fff3e0",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",borderLeft:"4px solid #e65100",marginBottom:12}}>
              <div style={{fontSize:22,marginRight:12}}>⚖️</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:"#bf360c",fontSize:14}}>Règle de poids — Mi-saison</div>
                <div style={{fontSize:12,color:"#e65100",marginTop:2}}>0,50€ par tranche de 100g de différence avec le poids de début de saison</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e65100",flexShrink:0}}>0,50€/100g</div>
            </div>
            <div style={{...C.card,marginBottom:16}}>
              <h3 style={C.h3}>⚖️ Pesées & amendes de poids</h3>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{background:"#e3f2fd"}}>{["Joueur","Début saison","Mi-saison","Diff. (début→mi)","Amende","Fin de saison","Diff. (mi→fin)"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"#0d47a1",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                     {weights.filter(w=>w.startWeight||w.midWeight||w.endWeight).map((w,i) => {
                      const hasStart = !!w.startWeight;
                      const hasMid = !!w.midWeight;
                      const hasEnd = !!w.endWeight;
                      const canDiffMid = hasStart && hasMid;
                      const diffG = canDiffMid ? Math.round((w.midWeight - w.startWeight) * 1000) : null;
                      const amende = canDiffMid ? calcWeightAmount(w.startWeight, w.midWeight) : 0;
                      const isUp = diffG > 0; const isZero = diffG === 0;
                      const canDiffEnd = hasMid && hasEnd;
                      const diffEndG = canDiffEnd ? Math.round((w.endWeight - w.midWeight) * 1000) : null;
                      const isEndUp = canDiffEnd && diffEndG > 0; const isEndZero = canDiffEnd && diffEndG === 0;
                      return (
                        <tr key={w.player} style={{background:i%2===0?"white":"#fafafa",borderBottom:"1px solid #f0f0f0"}}>
                          <td style={{padding:"8px 12px",fontWeight:700,color:"#1a237e"}}>{w.player}</td>
                          <td style={{padding:"8px 12px",color:hasStart?"#546e7a":"#b0bec5"}}>{hasStart ? `${w.startWeight} kg` : "—"}</td>
                          <td style={{padding:"8px 12px",color:hasMid?"#546e7a":"#b0bec5"}}>{hasMid ? `${w.midWeight} kg` : "—"}</td>
                          <td style={{padding:"8px 12px",fontWeight:700,color:!canDiffMid?"#b0bec5":isZero?"#78909c":isUp?"#e53935":"#2e7d32"}}>{!canDiffMid ? "—" : (isZero?"=":`${isUp?"+":""}${diffG}g`)}</td>
                          <td style={{padding:"8px 12px",fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:amende>0?"#e65100":"#2e7d32"}}>{!canDiffMid ? "—" : (amende > 0 ? `${amende.toFixed(2)}€` : "0€")}</td>
                          <td style={{padding:"8px 12px",color:hasEnd?"#546e7a":"#b0bec5"}}>{hasEnd ? `${w.endWeight} kg` : "—"}</td>
                          <td style={{padding:"8px 12px",fontWeight:700,color:!canDiffEnd?"#b0bec5":isEndZero?"#78909c":isEndUp?"#e53935":"#2e7d32"}}>{!canDiffEnd ? "—" : (isEndZero?"=":`${isEndUp?"+":""}${diffEndG}g`)}</td>
                        </tr>
                      );
                    })}
                    {weights.filter(w=>w.startWeight||w.midWeight||w.endWeight).length === 0 && (
                      <tr><td colSpan={7} style={{padding:"16px",textAlign:"center",color:"#90a4ae"}}>Aucune pesée enregistrée pour l'instant</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {isAdmin && showAddRule && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input value={newRule.name} onChange={e=>setNewRule(p=>({...p,name:e.target.value}))} placeholder="Nom de la règle" style={{flex:1,minWidth:160,...C.input}}/>
                  <input type="number" inputMode="decimal" value={newRule.amount} onChange={e=>setNewRule(p=>({...p,amount:e.target.value}))} placeholder="€" style={{width:70,padding:"10px",borderRadius:8,border:"2px solid #e3f2fd",fontSize:14}}/>
                  <button onClick={addRule} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                  <button onClick={()=>setShowAddRule(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 12px",borderRadius:8,cursor:"pointer"}}>✕</button>
                </div>
              </div>
            )}
            {isAdmin && editingRule && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input value={editingRule.name} onChange={e=>setEditingRule(p=>({...p,name:e.target.value}))} style={{flex:1,minWidth:160,...C.input,border:"2px solid #1565c0"}}/>
                  <input type="number" inputMode="decimal" value={editingRule.amount} onChange={e=>setEditingRule(p=>({...p,amount:parseFloat(e.target.value)}))} style={{width:70,padding:"10px",borderRadius:8,border:"2px solid #1565c0",fontSize:14}}/>
                  <button onClick={saveRule} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Sauver</button>
                  <button onClick={()=>setEditingRule(null)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 12px",borderRadius:8,cursor:"pointer"}}>✕</button>
                </div>
                <div style={{fontSize:11,color:"#90a4ae",marginTop:8}}>💡 Les infractions déjà enregistrées avec cette règle seront recalculées automatiquement.</div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
              {rules.map(rule => (
                <div key={rule.id} style={{background:"white",borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",borderLeft:"4px solid #1565c0"}}>
                  <div style={{flex:1,fontWeight:700,color:"#1a237e",fontSize:13}}>{rule.name}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1565c0"}}>{rule.amount}€</div>
                    {isAdmin && <><button onClick={()=>setEditingRule(rule)} style={{background:"#e3f2fd",color:"#1565c0",border:"none",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button><button onClick={()=>deleteRule(rule.id)} style={{background:"#ffebee",color:"#e53935",border:"none",width:28,height:28,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button></>}
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <div style={{...C.card,gridColumn:"1/-1",textAlign:"center",color:"#90a4ae"}}>Aucune règle dans ce groupe — ajoute-les avec le bouton "+ Règle".</div>
              )}
            </div>
          </div>
        )}

        {activeTab==="Calendrier" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:0}}>📅 Calendrier</h2>
              {isAdmin && <button onClick={()=>setShowAddCalendar(!showAddCalendar)} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 18px",borderRadius:10,cursor:"pointer",fontWeight:800,fontSize:13}}>+ Match</button>}
            </div>
            {isAdmin && showAddCalendar && (
              <div style={{...C.card,marginBottom:16}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                  {[{label:"DATE",key:"date",placeholder:"ex: 12/09/2026"},{label:"ADVERSAIRE",key:"opponent",placeholder:"Nom"},{label:"LIEU",key:"location",placeholder:"Ville"}].map(f=>(
                    <div key={f.key}><label style={C.label}>{f.label}</label><input value={newCalMatch[f.key]} onChange={e=>setNewCalMatch(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder} style={C.input}/></div>
                  ))}
                  <div><label style={C.label}>DOM / EXT</label><select value={newCalMatch.home} onChange={e=>setNewCalMatch(p=>({...p,home:e.target.value==="true"}))} style={C.input}><option value="true">Domicile</option><option value="false">Extérieur</option></select></div>
                  <div><label style={C.label}>ÉQUIPE</label><select value={newCalMatch.team} onChange={e=>setNewCalMatch(p=>({...p,team:e.target.value}))} style={C.input}><option value="Éq1">Équipe 1</option><option value="Éq2">Équipe 2</option></select></div>
                </div>
                <div style={{display:"flex",gap:10,marginTop:14}}>
                  <button onClick={addCalendarMatch} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                  <button onClick={()=>setShowAddCalendar(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Annuler</button>
                </div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>
              <div>
                <h3 style={{...C.h3,marginBottom:12}}>Équipe 1</h3>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {calendarEq1.length ? calendarEq1.map(m => renderCalCard(m, nextMatchFbId1)) : <div style={{color:"#90a4ae",padding:20,textAlign:"center",background:"white",borderRadius:14}}>Aucun match programmé</div>}
                </div>
              </div>
              <div>
                <h3 style={{...C.h3,marginBottom:12}}>Équipe 2</h3>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {calendarEq2.length ? calendarEq2.map(m => renderCalCard(m, nextMatchFbId2)) : <div style={{color:"#90a4ae",padding:20,textAlign:"center",background:"white",borderRadius:14}}>Aucun match programmé</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab==="Stats" && (
          <div>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:"0 0 16px"}}>📊 Stats</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <h3 style={C.h3}>💰 Total par joueur</h3>
                {Object.entries(playerStats).filter(([,s])=>s.total>0).sort((a,b)=>b[1].total-a[1].total).map(([name,stats]) => {
                  const maxTotal = Math.max(1,...Object.values(playerStats).map(s=>s.total));
                  const pct = Math.round((stats.total/maxTotal)*100);
                  return (
                    <div key={name} style={{marginBottom:10,cursor:"pointer"}} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs");}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontWeight:700,color:"#1a237e",fontSize:14}}>{name}</span>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#1565c0"}}>{stats.total}€</span>
                      </div>
                      <div style={{background:"#e3f2fd",borderRadius:4,height:7}}><div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1565c0,#42a5f5)",borderRadius:4}}/></div>
                    </div>
                  );
                })}
              </div>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
                  <h3 style={{...C.h3,margin:0}}>🎯 Infraction la plus fréquente par type</h3>
                  {isAdmin && (
                    <button onClick={()=>{setTempStatsRuleIds(effectiveStatsRuleIds); setShowStatsRuleConfig(!showStatsRuleConfig);}} style={{background:"#e3f2fd",color:"#1565c0",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12}}>⚙️ Choisir les règles</button>
                  )}
                </div>
                {showStatsRuleConfig && (
                  <div style={{background:"#f8fbff",borderRadius:10,padding:12,marginBottom:14}}>
                    <div style={{fontSize:11,color:"#78909c",marginBottom:8}}>Coche les règles à inclure dans ce classement (parmi tes règles existantes) :</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6,maxHeight:220,overflowY:"auto",marginBottom:10}}>
                      {rules.map(r => {
                        const checked = tempStatsRuleIds.map(String).includes(String(r.id));
                        return (
                          <label key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",cursor:"pointer"}}>
                            <input type="checkbox" checked={checked} onChange={()=>setTempStatsRuleIds(prev => checked ? prev.filter(id=>String(id)!==String(r.id)) : [...prev, r.id])}/>
                            <span style={{fontSize:13,color:"#1a237e"}}>{r.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>saveStatsRuleConfig(tempStatsRuleIds)} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:12}}>Enregistrer</button>
                      <button onClick={()=>setShowStatsRuleConfig(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>Annuler</button>
                    </div>
                  </div>
                )}
                {infractionLeaders.length === 0 ? (
                  <div style={{color:"#90a4ae",padding:12,textAlign:"center"}}>Pas encore assez de données</div>
                ) : infractionLeaders.map((it) => (
                  <div key={it.label} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e",fontSize:13}}>{it.label}</div>
                    <div style={{fontWeight:700,color:"#546e7a",fontSize:13}}>{it.player}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#1565c0"}}>{it.count}×</div>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>😈 Classement Chaboulat</h3>
                {Object.entries(playerStats).sort((a,b)=>b[1].chaboula-a[1].chaboula).filter(([,s])=>s.chaboula>0).map(([name,stats],i) => (
                  <div key={name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53935"}}>{stats.chaboula}×</div>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <h3 style={C.h3}>🔥 Matchs par montant</h3>
                {matchTotals.filter(m=>m.total>0).slice().sort((a,b)=>b.total-a.total).map((m,i) => (
                  <div key={m.fbId||m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d03f":"#e3f2fd",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:i===0?"#333":"#1565c0",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,fontWeight:600,color:"#1a237e",fontSize:13}}>{m.match}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"#1565c0"}}>{m.total}€</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
