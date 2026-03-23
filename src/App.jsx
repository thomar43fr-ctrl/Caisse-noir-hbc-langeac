import { useState, useMemo, useEffect } from "react";
import { db, auth } from "./firebase";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs
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

export default function App() {
  const [rules, setRules] = useState(INITIAL_RULES);
  const [matches, setMatches] = useState(HISTORICAL_MATCHES);
  const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
  const [payments, setPayments] = useState(INITIAL_PAYMENTS);
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [newRule, setNewRule] = useState({name:"",amount:""});
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddInfraction, setShowAddInfraction] = useState(false);
  const [showAddCalendar, setShowAddCalendar] = useState(false);
  const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
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

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const adminSnap = await getDocs(collection(db, "admins"));
          const adminEmails = adminSnap.docs.map(d => d.id);
          setIsAdmin(adminEmails.includes(u.email));
        } catch(e) { setIsAdmin(false); }
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  const handleAuth = async () => {
    setAuthError("");
    setAuthLoading(true);
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setAuthEmail(""); setAuthPassword("");
    } catch(e) {
      setAuthError("Erreur d'authentification");
    }
    setAuthLoading(false);
  };

  useEffect(() => {
    // Sécurité : Si après 5s ça charge toujours, on force l'affichage
    const timer = setTimeout(() => setLoading(false), 5000);

    const unsubRules = onSnapshot(collection(db, "rules"), snap => {
      if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id})));
      setLoading(false); // Dès qu'on a au moins les règles, on peut afficher
    });
    const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
      if (!snap.empty) setMatches(snap.docs.map(d => ({...d.data(), fbId: d.id})));
    });
    const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
      if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
    });
    const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
      if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
    });

    return () => { 
        clearTimeout(timer);
        unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); 
    };
  }, []);

  const allEntries = useMemo(() =>
    matches.flatMap(m => (m.entries||[]).map((e,idx) => ({
      ...e, matchLabel:m.match, matchDate:m.date,
      matchId: m.fbId||String(m.id), sortKey:m.sortKey||0, entryIndex:idx
    }))),
    [matches]
  );

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

  const players = useMemo(() => Object.keys(playerStats).sort(), [playerStats]);
  const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
  const matchTotals = useMemo(() => matches.map(m => ({
    ...m, total: (m.entries||[]).reduce((s,e) => s+e.amount, 0)
  })), [matches]);
  const topOffenders = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total-a[1].total).slice(0,5), [playerStats]);
  const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a[1].chaboula).slice(0,5), [playerStats]);

  const addInfraction = async () => {
    if (!newInfraction.player || (!newInfraction.ruleId && !newInfraction.customDetail)) return;
    const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
    const amount = newInfraction.ruleId ? (rule?.amount||0) : parseFloat(newInfraction.customAmount)||0;
    const detail = newInfraction.ruleId ? rule?.name : newInfraction.customDetail;
    const matchLabel = newInfraction.matchLabel || "Hors match";
    const existing = matches.find(m => m.match === matchLabel);
    
    if (existing) {
      const fbId = existing.fbId || String(existing.id);
      const newEntries = [...(existing.entries||[]), {player:newInfraction.player, amount, detail}];
      await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
    } else {
      const newMatch = {
        id: Date.now(), match: matchLabel,
        date: new Date().toLocaleDateString("fr-FR",{month:"short",year:"numeric"}),
        sortKey: 999, entries: [{player:newInfraction.player, amount, detail}]
      };
      await setDoc(doc(db, "matches", String(newMatch.id)), newMatch);
    }
    setNewInfraction({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
    setShowAddInfraction(false);
    showToast("Infraction ajoutée ✓");
  };

  const C = {
    card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,0.07)"},
    h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:1},
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
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="Email" style={{padding:"12px", borderRadius:10, border:"2px solid #e3f2fd"}}/>
          <input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Mot de passe" style={{padding:"12px", borderRadius:10, border:"2px solid #e3f2fd"}}/>
          {authError && <div style={{color:"red", fontSize:12}}>{authError}</div>}
          <button onClick={handleAuth} style={{background:"#1565c0", color:"white", padding:"14px", borderRadius:10, border:"none", fontWeight:800}}>SE CONNECTER</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)", padding:"10px 16px"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", maxWidth:1200, margin:"0 auto"}}>
            <div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20}}>HBC LANGEAC {isAdmin && "👑"}</div>
            <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.2)", color:"white", border:"none", padding:"5px 10px", borderRadius:8}}>Déco</button>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"16px 12px"}}>
        {isAdmin && (
            <button onClick={()=>setShowAddInfraction(true)} style={{width:"100%", padding:15, background:"#ef5350", color:"white", border:"none", borderRadius:12, fontWeight:800, marginBottom:20}}>+ AMENDE ADMIN</button>
        )}

        <div style={C.card}>
            <h3 style={C.h3}>Tableau de bord</h3>
            <div style={{fontSize:24, fontFamily:"'Bebas Neue',sans-serif", color:"#1565c0"}}>Total Caisse: {totalCaisse.toFixed(1)}€</div>
        </div>

        {/* MODAL INFRACTION */}
        {showAddInfraction && (
          <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIindex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20}}>
            <div style={{background:"white", padding:30, borderRadius:25, width:"100%", maxWidth:400}}>
              <h3>Ajouter une amende</h3>
              <select onChange={e=>setNewInfraction({...newInfraction, player:e.target.value})} style={{width:"100%", padding:12, marginBottom:10}}>
                <option>Choisir un joueur...</option>
                {payments.map(p => <option key={p.player} value={p.player}>{p.player}</option>)}
              </select>
              <select onChange={e=>setNewInfraction({...newInfraction, ruleId:e.target.value})} style={{width:"100%", padding:12, marginBottom:20}}>
                <option>Choisir une règle...</option>
                {rules.map(r => <option key={r.id} value={r.id}>{r.name} ({r.amount}€)</option>)}
              </select>
              <button onClick={addInfraction} style={{width:"100%", padding:14, background:"#1565c0", color:"white", border:"none", borderRadius:10, fontWeight:800}}>VALIDER</button>
              <button onClick={()=>setShowAddInfraction(false)} style={{width:"100%", marginTop:10, background:"none", border:"none"}}>Annuler</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
