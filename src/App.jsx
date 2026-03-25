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
import { HISTORICAL_MATCHES } from "./matches";

function getPlayerInfractionStats(entries) {
  const counts = {};
  entries.forEach(e => {
    if (!e.detail || e.detail === "Rien" || e.amount === 0) return;
    const d = e.detail.toLowerCase();
    [
      {key:"mitraillette",label:"Mitraillette"},
      {key:"sortie veille",label:"Sortie veille"},
      {key:"chaboula",label:"Chaboulat"},
      {key:"penalty raté",label:"Penalty raté"},
      {key:"contre-attaque ratée",label:"Contre-attaque ratée"},
      {key:"relance ratée",label:"Relance ratée"},
      {key:"tir fantaisie raté",label:"Tir fantaisie raté"},
      {key:"vomi",label:"Vomi en soirée"},
      {key:"retard",label:"Retard"},
      {key:"carton rouge",label:"Carton rouge"},
      {key:"défaite",label:"Défaite collective"},
      {key:"fantôme",label:"Fantôme"},
    ].forEach(({key,label}) => {
      if (d.includes(key)) counts[label] = (counts[label]||0)+1;
    });
  });
  return Object.entries(counts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
}

const NAV_ITEMS = ["Dashboard","Paiements","Joueurs","Règles","Calendrier","Stats"];

const WEIGHT_INFRACTIONS = [
  {player:"Hugo", startWeight:97.1, midWeight:96.9},
  {player:"Adrien", startWeight:101.4, midWeight:101.4},
  {player:"Yanis", startWeight:90.1, midWeight:88.2},
  {player:"Fred", startWeight:114.6, midWeight:112.2},
  {player:"Paul", startWeight:104.2, midWeight:98.6},
  {player:"Meyro", startWeight:85.1, midWeight:85.1},
  {player:"David", startWeight:80.0, midWeight:78.2},
  {player:"Lenny", startWeight:82.8, midWeight:81.8},
  {player:"Gabin", startWeight:76.0, midWeight:77.1},
  {player:"Thomas", startWeight:91.1, midWeight:96.0},
  {player:"Killian", startWeight:76.4, midWeight:77.7},
  {player:"Alexis", startWeight:70.6, midWeight:70.2},
  {player:"Simon", startWeight:75.8, midWeight:76.1},
  {player:"Rémi", startWeight:75.8, midWeight:75.8},
  {player:"Théo", startWeight:87.1, midWeight:86.0},
  {player:"Benjamin", startWeight:94.8, midWeight:93.3},
  {player:"Mathieu", startWeight:79.8, midWeight:82.1},
  {player:"Coco", startWeight:94.9, midWeight:95.4},
  {player:"Arthur", startWeight:76.2, midWeight:75.5},
  {player:"Bruno", startWeight:80.0, midWeight:79.5},
  {player:"Romain B.", startWeight:84.3, midWeight:88.0},
  {player:"Clément", startWeight:91.1, midWeight:91.8},
  {player:"Kevin", startWeight:75.4, midWeight:74.5},
];

export default function App() {
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  const [playersList, setPlayersList] = useState([]);

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
  const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:"",weightStart:"",weightCurrent:""});
  const [newCalMatch, setNewCalMatch] = useState({date:"",opponent:"",home:true,location:"",team:"Éq1"});
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentInput, setPaymentInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
        } catch(e) { setIsAdmin(false); }
      } else { setIsAdmin(false); setLoading(false); }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 5) setLoading(false); };
    const unsubRules = onSnapshot(collection(db, "rules"), snap => { if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id}))); checkDone(); });
    const unsubMatches = onSnapshot(collection(db, "matches"), snap => { if (!snap.empty) { const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id})); setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0))); } checkDone(); });
    const unsubPayments = onSnapshot(collection(db, "payments"), snap => { if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id}))); checkDone(); });
    const unsubCal = onSnapshot(collection(db, "calendar"), snap => { if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id}))); checkDone(); });
    const unsubPlayers = onSnapshot(collection(db, "playersList"), snap => { setPlayersList(snap.docs.map(d => ({...d.data(), id: d.id}))); checkDone(); });
    return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); unsubPlayers(); };
  }, [user]);

  useEffect(() => {
    const initIfEmpty = async () => {
      const rulesSnap = await getDocs(collection(db, "rules"));
      if (rulesSnap.empty) {
        const batch = writeBatch(db);
        INITIAL_RULES.forEach(r => batch.set(doc(db, "rules", String(r.id)), r));
        HISTORICAL_MATCHES.forEach(m => batch.set(doc(db, "matches", String(m.id)), m));
        INITIAL_PAYMENTS.forEach(p => batch.set(doc(db, "payments", p.player), p));
        INITIAL_CALENDAR.forEach(c => batch.set(doc(db, "calendar", String(c.id)), c));
        await batch.commit();
      }
    };
    initIfEmpty();
  }, []);

  const allEntries = useMemo(() => matches.flatMap(m => (m.entries||[]).map((e,idx) => ({...e, matchLabel:m.match, matchDate:m.date, matchId: m.fbId||String(m.id), sortKey:m.sortKey||0, entryIndex:idx}))), [matches]);

  const playerStats = useMemo(() => {
    const stats = {};
    allEntries.forEach(e => {
      const p = e.player;
      if (!stats[p]) stats[p] = {total:0, count:0, chaboula:0, entries:[]};
      stats[p].total += e.amount;
      if (e.amount > 0) stats[p].count++;
      if (e.detail && /chaboula/i.test(e.detail)) stats[p].chaboula++;
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
    if (!isAdmin || Object.keys(playerStats).length === 0 || payments.length === 0) return;
    payments.forEach(async p => {
      const newTotal = playerStats[p.player]?.total;
      if (newTotal !== undefined && Math.abs(newTotal - p.total) > 0.01) {
        try { await updateDoc(doc(db, "payments", p.fbId || p.player), {total: newTotal}); } catch(e) {}
      }
    });
  }, [playerStats, isAdmin]);

  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const matchTotals = useMemo(() => matches.map(m => ({...m, total: (m.entries||[]).reduce((s,e) => s+e.amount, 0)})), [matches]);
  const topOffenders = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total-a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a[1].chaboula).slice(0,5), [playerStats]);

  const calcWeightAmount = (startWeight, currentWeight) => {
    if (!startWeight || !currentWeight) return 0;
    const diffG = Math.abs((parseFloat(currentWeight) - parseFloat(startWeight)) * 1000);
    return Math.floor(diffG / 100) * 0.5;
  };

  const addPlayer = async () => {
    if (!newPlayerName.trim()) return;
    const name = newPlayerName.trim();
    await setDoc(doc(db, "playersList", name), {name, hidden: false, createdAt: Date.now()});
    if (!payments.find(p => p.player === name)) await setDoc(doc(db, "payments", name), {player: name, total: 0, paid: 0});
    setNewPlayerName(""); setShowAddPlayer(false);
    showToast(`${name} ajouté ✓`);
  };

  const hidePlayer = async (name) => {
    const p = playersList.find(x => x.name === name);
    if (p) await updateDoc(doc(db, "playersList", name), {hidden: true});
    else await setDoc(doc(db, "playersList", name), {name, hidden: true, createdAt: Date.now()});
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
      if (JSON.stringify(newEntries) !== JSON.stringify(m.entries||[])) batch.update(doc(db, "matches", m.fbId||String(m.id)), {entries: newEntries});
    });
    const pay = payments.find(p => p.player === oldName);
    if (pay) {
      const {fbId, ...payData} = pay;
      batch.delete(doc(db, "payments", fbId||oldName));
      batch.set(doc(db, "payments", trimmed), {...payData, player: trimmed});
    }
    batch.delete(doc(db, "playersList", oldName));
    batch.set(doc(db, "playersList", trimmed), {name: trimmed, hidden: false, createdAt: Date.now()});
    await batch.commit();
    setEditingPlayerName(null);
    showToast(`${oldName} → ${trimmed} ✓`);
  };

  const addInfraction = async () => {
    const isWeightRule = newInfraction.ruleId === "__weight__";
    if (!newInfraction.player) return;
    if (!isWeightRule && !newInfraction.ruleId && !newInfraction.customDetail) return;
    let amount, detail;
    if (isWeightRule) {
      const wd = WEIGHT_INFRACTIONS.find(w => w.player === newInfraction.player);
      const startW = wd ? wd.startWeight : parseFloat(newInfraction.weightStart)||0;
      const currentW = parseFloat(newInfraction.weightCurrent)||0;
      if (!currentW) { showToast("Entrez le poids actuel"); return; }
      amount = calcWeightAmount(startW, currentW);
      const diffG = Math.round((currentW - startW) * 1000);
      detail = `Différence poids: ${diffG >= 0 ? "+" : ""}${diffG}g (${startW}kg → ${currentW}kg)`;
    } else {
      const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
      amount = newInfraction.ruleId ? (rule?.amount||0) : parseFloat(newInfraction.customAmount)||0;
      detail = newInfraction.ruleId ? rule?.name : newInfraction.customDetail;
    }
    const matchLabel = newInfraction.matchLabel || "Hors match";
    const existing = matches.find(m => m.match === matchLabel);
    if (existing) {
      await updateDoc(doc(db, "matches", existing.fbId||String(existing.id)), {entries: [...(existing.entries||[]), {player:newInfraction.player, amount, detail}]});
    } else {
      const nm = {id: Date.now(), match: matchLabel, date: new Date().toLocaleDateString("fr-FR",{month:"short",year:"numeric"}), sortKey: 999, entries: [{player:newInfraction.player, amount, detail}]};
      await setDoc(doc(db, "matches", String(nm.id)), nm);
    }
    const player = newInfraction.player;
    const p = payments.find(x => x.player === player);
    if (p) await updateDoc(doc(db, "payments", p.fbId||player), {total: (playerStats[player]?.total||0) + amount});
    else await setDoc(doc(db, "payments", player), {player, total: amount, paid: 0});
    setNewInfraction({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:"",weightStart:"",weightCurrent:""});
    setShowAddInfraction(false);
    showToast(`Infraction ajoutée (${amount.toFixed(2)}€) ✓`);
  };

  const deleteInfraction = async (matchId, entryIndex) => {
    const m = matches.find(x => x.fbId === matchId || String(x.id) === String(matchId));
    if (!m) return;
    const entry = (m.entries||[])[entryIndex];
    await updateDoc(doc(db, "matches", m.fbId||String(m.id)), {entries: (m.entries||[]).filter((_,i) => i !== entryIndex)});
    if (entry) {
      const p = payments.find(x => x.player === entry.player);
      if (p) await updateDoc(doc(db, "payments", p.fbId||entry.player), {total: Math.max(0, p.total - entry.amount)});
    }
    showToast("Infraction supprimée");
  };

  const addRule = async () => {
    if (!newRule.name || !newRule.amount) return;
    const r = {id: Date.now(), name: newRule.name, amount: parseFloat(newRule.amount)};
    await setDoc(doc(db, "rules", String(r.id)), r);
    setNewRule({name:"",amount:""}); setShowAddRule(false); showToast("Règle ajoutée ✓");
  };

  const saveRule = async () => { await updateDoc(doc(db, "rules", String(editingRule.id)), editingRule); setEditingRule(null); showToast("Règle modifiée ✓"); };
  const deleteRule = async (id) => { await deleteDoc(doc(db, "rules", String(id))); showToast("Règle supprimée"); };

  const addCalendarMatch = async () => {
    if (!newCalMatch.opponent || !newCalMatch.date) return;
    const m = {...newCalMatch, id: Date.now(), sortKey: 999, home: newCalMatch.home === true || newCalMatch.home === "true"};
    await setDoc(doc(db, "calendar", String(m.id)), m);
    setNewCalMatch({date:"",opponent:"",home:true,location:"",team:"Éq1"}); setShowAddCalendar(false); showToast("Match ajouté ✓");
  };

  const savePayment = async (playerName) => {
    const added = parseFloat(paymentInput) || 0;
    const p = payments.find(x => x.player === playerName);
    if (!p) return;
    await updateDoc(doc(db, "payments", p.fbId||playerName), {paid: Math.min(p.paid + added, p.total)});
    setEditingPayment(null); setPaymentInput(""); showToast("Paiement enregistré ✓");
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

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:36}}>🤾</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpacing:2}}>Chargement...</div>
    </div>
  );

  if (!user) return (
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
        </div>
      </div>
    </div>
  );

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

      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0 4px 20px rgba(13,71,161,0.3)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:22,flexShrink:0}}>🤾</div>
            <div>
              <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:2,lineHeight:1}}>HBC LANGEAC</div>
              <div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Caisse Noire</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12px",textAlign:"center"}}>
              <div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Total</div>
              <div style={{color:"white",fontSize:22,fontFamily:"'Bebas Neue',sans-serif"}}>{totalCaisse.toFixed(1)}€</div>
            </div>
            <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 10px",color:"white",cursor:"pointer",fontSize:11,fontWeight:700,lineHeight:1.4}}>
              {isAdmin?"👑":"👤"}<br/>Déco
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
              {[{label:"Total caisse",value:`${totalCaisse.toFixed(1)}€`,color:"#1565c0",icon:"💰"},{label:"Matchs",value:matches.length,color:"#1976d2",icon:"🏆"},{label:"Joueurs",value:players.length,color:"#1e88e5",icon:"👥"},{label:"Record",value:`${Math.max(0,...matchTotals.map(m=>m.total))}€`,color:"#2196f3",icon:"🔥"}].map(card => (
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
                  {matchTotals.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
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
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {payments.slice().sort((a,b)=>(b.total-b.paid)-(a.total-a.paid)).map(p => {
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
                      <div style={{display:"flex",justifyContent:"flex-end"}}>
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
                <button onClick={()=>setSelectedPlayer(null)} style={{background:"#1565c0",color:"white",border:"none",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontWeight:700,marginBottom:16}}>← Retour</button>
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
                    return sorted.map(([matchLabel,{date,entries:mE}]) => (
                      <div key={matchLabel} style={{marginBottom:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                          <div style={{fontSize:11,fontWeight:800,color:"#0d47a1",background:"#e3f2fd",borderRadius:8,padding:"3px 10px"}}>{matchLabel}</div>
                          <div style={{fontSize:11,color:"#90a4ae"}}>{date}</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#1565c0",marginLeft:"auto"}}>{mE.reduce((s,e)=>s+e.amount,0)}€</div>
                        </div>
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
                    ));
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
                    <h3 style={C.h3}>Ajouter une infraction</h3>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                      <div>
                        <label style={C.label}>Joueur</label>
                        <select value={newInfraction.player} onChange={e=>setNewInfraction(p=>({...p,player:e.target.value}))} style={C.input}>
                          <option value="">Choisir</option>
                          {players.map(p=><option key={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={C.label}>Match</label>
                        <select value={newInfraction.matchLabel} onChange={e=>setNewInfraction(p=>({...p,matchLabel:e.target.value}))} style={C.input}>
                          <option value="">Hors match</option>
                          {matches.map(m=><option key={m.fbId||m.id} value={m.match}>{m.match}</option>)}
                          <option value="__new__">+ Nouveau match</option>
                        </select>
                        {newInfraction.matchLabel==="__new__" && <input placeholder="Nom du match" onChange={e=>setNewInfraction(p=>({...p,matchLabel:e.target.value}))} style={{...C.input,marginTop:8}}/>}
                      </div>
                      <div>
                        <label style={C.label}>Règle</label>
                        <select value={newInfraction.ruleId} onChange={e=>setNewInfraction(p=>({...p,ruleId:e.target.value}))} style={C.input}>
                          <option value="">Personnalisée</option>
                          <option value="__weight__">⚖️ Règle poids (0,50€/100g)</option>
                          {rules.map(r=><option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
                        </select>
                      </div>
                      {newInfraction.ruleId === "__weight__" && (
                        <>
                          <div>
                            <label style={C.label}>Poids début saison (kg)</label>
                            {(() => { const wd = WEIGHT_INFRACTIONS.find(w => w.player === newInfraction.player); return wd ? (<div style={{padding:"10px",background:"#e3f2fd",borderRadius:8,fontWeight:700,color:"#1565c0",fontSize:14}}>{wd.startWeight} kg (auto)</div>) : (<input type="number" inputMode="decimal" value={newInfraction.weightStart||""} onChange={e=>setNewInfraction(p=>({...p,weightStart:e.target.value}))} placeholder="ex: 80.0" style={C.input}/>); })()}
                          </div>
                          <div>
                            <label style={C.label}>Poids actuel (kg)</label>
                            <input type="number" inputMode="decimal" value={newInfraction.weightCurrent||""} onChange={e=>setNewInfraction(p=>({...p,weightCurrent:e.target.value}))} placeholder="ex: 82.5" style={C.input}/>
                          </div>
                          {newInfraction.weightCurrent && (
                            <div style={{display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",background:"#fff3e0",borderRadius:8,padding:12}}>
                              <div style={{fontSize:11,fontWeight:700,color:"#e65100",textTransform:"uppercase"}}>Amende calculée</div>
                              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#e65100"}}>{calcWeightAmount(WEIGHT_INFRACTIONS.find(w=>w.player===newInfraction.player)?.startWeight || parseFloat(newInfraction.weightStart), parseFloat(newInfraction.weightCurrent)).toFixed(2)}€</div>
                            </div>
                          )}
                        </>
                      )}
                      {!newInfraction.ruleId && <>
                        <div>
                          <label style={C.label}>Détail</label>
                          <input value={newInfraction.customDetail} onChange={e=>setNewInfraction(p=>({...p,customDetail:e.target.value}))} placeholder="Description" style={C.input}/>
                        </div>
                        <div>
                          <label style={C.label}>Montant (€)</label>
                          <input type="number" inputMode="decimal" value={newInfraction.customAmount} onChange={e=>setNewInfraction(p=>({...p,customAmount:e.target.value}))} placeholder="0" style={C.input}/>
                        </div>
                      </>}
                    </div>
                    <div style={{display:"flex",gap:10,marginTop:14}}>
                      <button onClick={addInfraction} style={{background:"#1565c0",color:"white",border:"none",padding:"10px 22px",borderRadius:8,cursor:"pointer",fontWeight:800}}>Ajouter</button>
                      <button onClick={()=>setShowAddInfraction(false)} style={{background:"#eceff1",color:"#546e7a",border:"none",padding:"10px 18px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Annuler</button>
                    </div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                  {players.sort((a,b)=>(playerStats[b]?.total||0)-(playerStats[a]?.total||0)).map(player => {
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
            <div style={{background:"#fff3e0",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",borderLeft:"4px solid #e65100",marginBottom:12}}>
              <div style={{fontSize:22,marginRight:12}}>⚖️</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:"#bf360c",fontSize:14}}>Règle de poids — Mi-saison</div>
                <div style={{fontSize:12,color:"#e65100",marginTop:2}}>0,50€ par tranche de 100g de différence avec le poids de début de saison</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e65100",flexShrink:0}}>0,50€/100g</div>
            </div>
            <div style={{...C.card,marginBottom:16}}>
              <h3 style={C.h3}>⚖️ Poids mi-saison — Amendes calculées</h3>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{background:"#e3f2fd"}}>{["Joueur","Début saison","Mi-saison","Différence","Amende"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"#0d47a1"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {WEIGHT_INFRACTIONS.filter(w=>w.startWeight&&w.midWeight).map((w,i) => {
                      const diffG = Math.round((w.midWeight - w.startWeight) * 1000);
                      const amende = calcWeightAmount(w.startWeight, w.midWeight);
                      const isUp = diffG > 0; const isZero = diffG === 0;
                      return (
                        <tr key={w.player} style={{background:i%2===0?"white":"#fafafa",borderBottom:"1px solid #f0f0f0"}}>
                          <td style={{padding:"8px 12px",fontWeight:700,color:"#1a237e"}}>{w.player}</td>
                          <td style={{padding:"8px 12px",color:"#546e7a"}}>{w.startWeight} kg</td>
                          <td style={{padding:"8px 12px",color:"#546e7a"}}>{w.midWeight} kg</td>
                          <td style={{padding:"8px 12px",fontWeight:700,color:isZero?"#78909c":isUp?"#e53935":"#2e7d32"}}>{isZero?"=":`${isUp?"+":""}${diffG}g`}</td>
                          <td style={{padding:"8px 12px",fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:amende>0?"#e65100":"#2e7d32"}}>{amende > 0 ? `${amende.toFixed(2)}€` : "0€"}</td>
                        </tr>
                      );
                    })}
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
                  {[{label:"DATE",key:"date",placeholder:"ex: Avr 2025"},{label:"ADVERSAIRE",key:"opponent",placeholder:"Nom"},{label:"LIEU",key:"location",placeholder:"Ville"}].map(f=>(
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
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {calendar.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
                <div key={m.fbId||m.id} style={{background:"white",borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:14,borderLeft:`4px solid ${m.home?"#1565c0":"#42a5f5"}`}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:m.team==="Éq2"?"#e3f2fd":"#1565c0",display:"flex",alignItems:"center",justifyContent:"center",color:m.team==="Éq2"?"#1565c0":"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:12,flexShrink:0}}>{m.team}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>vs {m.opponent}</div>
                    <div style={{fontSize:12,color:"#78909c",marginTop:2}}>{m.date} • {m.location} • {m.home?"🏠":"✈️"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab==="Stats" && (
          <div>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",letterSpacing:1,margin:"0 0 16px"}}>📊 Stats</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={{...C.card,gridColumn:"1/-1"}}>
                <h3 style={C.h3}>💰 Total par joueur</h3>
                {Object.entries(playerStats).sort((a,b)=>b[1].total-a[1].total).map(([name,stats]) => {
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
                {matchTotals.slice().sort((a,b)=>b.total-a.total).map((m,i) => (
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
