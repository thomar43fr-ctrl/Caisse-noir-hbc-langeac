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
const LOGO_B64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgA
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
// Core data
const [rules, setRules] = useState(INITIAL_RULES);
const [matches, setMatches] = useState(HISTORICAL_MATCHES);
const [calendar, setCalendar] = useState(INITIAL_CALENDAR);
const [payments, setPayments] = useState(INITIAL_PAYMENTS);
// UI state
const [activeTab, setActiveTab] = useState("Dashboard");
const [selectedPlayer, setSelectedPlayer] = useState(null);
const [editingRule, setEditingRule] = useState(null);
const [newRule, setNewRule] = useState({name:"",amount:""});
const [showAddRule, setShowAddRule] = useState(false);
const [showAddInfraction, setShowAddInfraction] = useState(false);
const [showAddCalendar, setShowAddCalendar] = useState(false);
const [newInfraction, setNewInfraction] = useState({player:"",ruleId:"",customDetail:"",cus
const [newCalMatch, setNewCalMatch] = useState({date:"",opponent:"",home:true,location:"",t
const [editingPayment, setEditingPayment] = useState(null);
const [paymentInput, setPaymentInput] = useState("");
const [loading, setLoading] = useState(true);
const [toast, setToast] = useState(null);
// Auth state
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
// Auth listener
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
const msgs = {
"auth/user-not-found": "Email introuvable",
"auth/wrong-password": "Mot de passe incorrect",
"auth/email-already-in-use": "Email déjà utilisé",
"auth/weak-password": "Mot de passe trop court (6 car. min)",
"auth/invalid-email": "Email invalide",
"auth/invalid-credential": "Email ou mot de passe incorrect",
};
setAuthError(msgs[e.code] || "Erreur de connexion");
}
setAuthLoading(false);
};
// Firebase real-time listeners
useEffect(() => {
let loaded = 0;
const checkDone = () => { loaded++; if (loaded >= 4) setLoading(false); };
const unsubRules = onSnapshot(collection(db, "rules"), snap => {
if (!snap.empty) setRules(snap.docs.map(d => ({...d.data(), id: d.id})));
checkDone();
});
const unsubMatches = onSnapshot(collection(db, "matches"), snap => {
if (!snap.empty) {
const fbMatches = snap.docs.map(d => ({...d.data(), fbId: d.id}));
setMatches(fbMatches.sort((a,b) => (a.sortKey||0)-(b.sortKey||0)));
}
checkDone();
});
const unsubPayments = onSnapshot(collection(db, "payments"), snap => {
if (!snap.empty) setPayments(snap.docs.map(d => ({...d.data(), fbId: d.id})));
checkDone();
});
const unsubCal = onSnapshot(collection(db, "calendar"), snap => {
if (!snap.empty) setCalendar(snap.docs.map(d => ({...d.data(), fbId: d.id})));
checkDone();
});
return () => { unsubRules(); unsubMatches(); unsubPayments(); unsubCal(); };
}, []);
// Init Firebase if empty
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
// Computed data
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
// Sync payment totals automatically when infractions change
useEffect(() => {
if (!isAdmin || Object.keys(playerStats).length === 0 || payments.length === 0) return;
payments.forEach(async p => {
const newTotal = playerStats[p.player]?.total;
if (newTotal !== undefined && Math.abs(newTotal - p.total) > 0.01) {
try {
} catch(e) {}
await updateDoc(doc(db, "payments", p.fbId || p.player), {total: newTotal});
}
});
}, [playerStats, isAdmin]);
const players = useMemo(() => Object.keys(playerStats).sort(), [playerStats]);
const totalCaisse = useMemo(() => payments.reduce((s,p) => s+p.total, 0), [payments]);
const matchTotals = useMemo(() => matches.map(m => ({
...m, total: (m.entries||[]).reduce((s,e) => s+e.amount, 0)
})), [matches]);
const topOffenders = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].total-a[1
const topChaboula = useMemo(() => Object.entries(playerStats).sort((a,b) => b[1].chaboula-a
// Actions
const addInfraction = async () => {
if (!newInfraction.player || (!newInfraction.ruleId && !newInfraction.customDetail)) retu
const rule = rules.find(r => String(r.id) === String(newInfraction.ruleId));
const amount = newInfraction.ruleId ? (rule?.amount||0) : parseFloat(newInfraction.custom
const detail = newInfraction.ruleId ? rule?.name : newInfraction.customDetail;
const matchLabel = newInfraction.matchLabel || "Hors match";
const existing = matches.find(m => m.match === matchLabel);
if (existing) {
const fbId = existing.fbId || String(existing.id);
const newEntries = [...(existing.entries||[]), {player:newInfraction.player, amount, de
await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
} else {
const newMatch = {
id: Date.now(), match: matchLabel,
date: new Date().toLocaleDateString("fr-FR",{month:"short",year:"numeric"}),
sortKey: 999, entries: [{player:newInfraction.player, amount, detail}]
};
await setDoc(doc(db, "matches", String(newMatch.id)), newMatch);
}
// Update payment total
const player = newInfraction.player;
const p = payments.find(x => x.player === player);
if (p) {
const newTotal = (playerStats[player]?.total||0) + amount;
await updateDoc(doc(db, "payments", p.fbId||player), {total: newTotal});
}
setNewInfraction({player:"",ruleId:"",customDetail:"",customAmount:"",matchLabel:""});
setShowAddInfraction(false);
showToast("Infraction ajoutée ✓");
};
const deleteInfraction = async (matchId, entryIndex) => {
const m = matches.find(x => x.fbId === matchId || String(x.id) === String(matchId));
if (!m) return;
const entry = (m.entries||[])[entryIndex];
const newEntries = (m.entries||[]).filter((_,i) => i !== entryIndex);
const fbId = m.fbId || String(m.id);
await updateDoc(doc(db, "matches", fbId), {entries: newEntries});
// Update payment total
if (entry) {
const p = payments.find(x => x.player === entry.player);
if (p) {
const newTotal = Math.max(0, p.total - entry.amount);
await updateDoc(doc(db, "payments", p.fbId||entry.player), {total: newTotal});
}
}
showToast("Infraction supprimée");
};
const addRule = async () => {
if (!newRule.name || !newRule.amount) return;
const r = {id: Date.now(), name: newRule.name, amount: parseFloat(newRule.amount)};
await setDoc(doc(db, "rules", String(r.id)), r);
setNewRule({name:"",amount:""}); setShowAddRule(false);
showToast("Règle ajoutée ✓");
};
const saveRule = async () => {
await updateDoc(doc(db, "rules", String(editingRule.id)), editingRule);
setEditingRule(null);
showToast("Règle modifiée ✓");
};
const deleteRule = async (id) => {
await deleteDoc(doc(db, "rules", String(id)));
showToast("Règle supprimée");
};
const addCalendarMatch = async () => {
if (!newCalMatch.opponent || !newCalMatch.date) return;
const m = {...newCalMatch, id: Date.now(), sortKey: 999, home: newCalMatch.home === true
await setDoc(doc(db, "calendar", String(m.id)), m);
setNewCalMatch({date:"",opponent:"",home:true,location:"",team:"Éq1"});
setShowAddCalendar(false);
showToast("Match ajouté ✓");
};
const savePayment = async (playerName) => {
const added = parseFloat(paymentInput) || 0;
const p = payments.find(x => x.player === playerName);
if (!p) return;
const newPaid = Math.min(p.paid + added, p.total);
await updateDoc(doc(db, "payments", p.fbId||playerName), {paid: newPaid});
setEditingPayment(null); setPaymentInput("");
showToast("Paiement enregistré ✓");
};
const C = {
card: {background:"white", borderRadius:16, padding:20, boxShadow:"0 2px 12px rgba(0,0,0,
h3: {margin:"0 0 16px", color:"#0d47a1", fontFamily:"'Bebas Neue',sans-serif", fontSize:2
};
// LOADING SCREEN
if (loading) return (
<div style={{minHeight:"100vh",background:"#f0f6ff",display:"flex",alignItems:"center",ju
<img src={LOGO_B64} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover"}} a
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#0d47a1",letterSpa
</div>
);
// LOGIN SCREEN
if (!user) return (
<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1565c0,#0d47a1)",displ
<div style={{background:"white",borderRadius:20,padding:32,width:"100%",maxWidth:380,bo
<div style={{textAlign:"center",marginBottom:28}}>
<img src={LOGO_B64} style={{width:72,height:72,borderRadius:"50%",objectFit:"cover"
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",lette
<div style={{color:"#78909c",fontSize:12,fontWeight:700,textTransform:"uppercase",l
</div>
<div style={{display:"flex",background:"#f0f6ff",borderRadius:10,padding:4,marginBott
{[{k:"login",l:"Connexion"},{k:"register",l:"Créer un compte"}].map(({k,l}) => (
<button key={k} onClick={()=>{setAuthMode(k);setAuthError("");}}
style={{flex:1,padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",fo
background:authMode===k?"#1565c0":"transparent",
color:authMode===k?"white":"#78909c",transition:"all 0.2s"}}>
{l}
</button>
))}
</div>
<div style={{display:"flex",flexDirection:"column",gap:12}}>
<input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}
placeholder="Email" inputMode="email" autoCapitalize="none"
style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:1
<input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.v
placeholder="Mot de passe" onKeyDown={e=>e.key==="Enter"&&handleAuth()}
style={{padding:"12px 16px",borderRadius:10,border:"2px solid #e3f2fd",fontSize:1
{authError && <div style={{color:"#e53935",fontSize:13,fontWeight:700,textAlign:"ce
<button onClick={handleAuth} disabled={authLoading}
style={{background:"#1565c0",color:"white",border:"none",padding:"14px",borderRad
{authLoading?"...":(authMode==="login"?"Se connecter":"Créer mon compte")}
</button>
</div>
</div>
</div>
);
// MAIN APP
return (
<div style={{minHeight:"100vh",background:"#f0f6ff",fontFamily:"'Nunito',sans-serif"}}>
{toast && (
<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",backgrou
{toast}
</div>
)}
{/* HEADER */}
<div style={{background:"linear-gradient(135deg,#1565c0 0%,#0d47a1 100%)",boxShadow:"0
<div style={{maxWidth:1200,margin:"0 auto",padding:"10px 16px",display:"flex",alignIt
<div style={{display:"flex",alignItems:"center",gap:12}}>
<img src={LOGO_B64} style={{width:46,height:46,borderRadius:"50%",objectFit:"cove
<div>
<div style={{color:"white",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,let
<div style={{color:"#90caf9",fontSize:10,fontWeight:700,letterSpacing:1,textTra
</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"6px 12p
<div style={{color:"#90caf9",fontSize:9,fontWeight:700,textTransform:"uppercase
<div style={{color:"white",fontSize:22,fontFamily:"'Bebas Neue',sans-serif"}}>{
</div>
<button onClick={()=>signOut(auth)}
style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,paddi
{isAdmin?" ":" "}<br/>Déco
</button>
</div>
</div>
<div style={{borderTop:"1px solid rgba(255,255,255,0.1)",overflowX:"auto",WebkitOverf
<div style={{display:"flex",padding:"0 16px",minWidth:"max-content"}}>
{NAV_ITEMS.map(tab => (
<button key={tab} onClick={()=>setActiveTab(tab)} style={{
background:"none",border:"none",padding:"10px 14px",cursor:"pointer",
color:activeTab===tab?"white":"rgba(255,255,255,0.6)",
fontFamily:"'Nunito',sans-serif",fontWeight:800,fontSize:12,
borderBottom:activeTab===tab?"3px solid white":"3px solid transparent",
whiteSpace:"nowrap"
}}>{tab}</button>
))}
</div>
</div>
</div>
<div style={{maxWidth:1200,margin:"0 auto",padding:"16px 12px"}}>
{/* DASHBOARD */}
{activeTab==="Dashboard" && (
<div>
{[
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr
{label:"Total caisse",value:`${totalCaisse.toFixed(1)}€`,color:"#1565c0",icon
{label:"Matchs",value:matches.length,color:"#1976d2",icon:" "},
{label:"Joueurs",value:players.length,color:"#1e88e5",icon:" "},
{label:"Record",value:`${Math.max(0,...matchTotals.map(m=>m.total))}€`,color:
].map(card => (
<div key={card.label} style={{...C.card,borderTop:`4px solid ${card.color}`,p
<div style={{fontSize:24}}>{card.icon}</div>
<div style={{fontSize:22,fontFamily:"'Bebas Neue',sans-serif",color:card.co
<div style={{fontSize:11,color:"#78909c",fontWeight:700,textTransform:"uppe
</div>
))}
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr
<div style={C.card}>
<h3 style={C.h3}> Top Mauvais Élèves</h3>
{topOffenders.map(([name,stats],i) => (
<div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs
<div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d
<div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#156
</div>
))}
</div>
<div style={C.card}>
<h3 style={C.h3}> Classement Chaboulat</h3>
{topChaboula.filter(([,s])=>s.chaboula>0).map(([name,stats],i) => (
<div key={name} onClick={()=>{setSelectedPlayer(name);setActiveTab("Joueurs
<div style={{width:28,height:28,borderRadius:"50%",background:i===0?"#f4d
<div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53
</div>
))}
</div>
<div style={{...C.card,gridColumn:"1/-1"}}>
<h3 style={C.h3}> Matchs (du plus récent)</h3>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150p
{matchTotals.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
<div key={m.fbId||m.id} style={{background:"#f0f6ff",borderRadius:12,padd
<div style={{fontWeight:800,fontSize:11,color:"#0d47a1"}}>{m.match}</di
<div style={{fontSize:11,color:"#78909c",marginTop:2}}>{m.date}</div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1
</div>
))}
</div>
</div>
</div>
</div>
)}
{/* PAIEMENTS */}
{activeTab==="Paiements" && (
<div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",ma
<h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",le
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
{[
{label:"Total dû",value:`${payments.reduce((s,p)=>s+p.total,0).toFixed(1)}€
{label:"Payé",value:`${payments.reduce((s,p)=>s+p.paid,0).toFixed(1)}€`,col
{label:"Reste",value:`${payments.reduce((s,p)=>s+(p.total-p.paid),0).toFixe
].map(c => (
<div key={c.label} style={{background:"white",borderRadius:12,padding:"8px
<div style={{fontSize:9,fontWeight:700,color:"#78909c",textTransform:"upp
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c.col
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
<div key={p.player} style={{background:isPaid?"#f1f8e9":"white",borderRadiu
<div style={{display:"flex",alignItems:"center",justifyContent:"space-bet
<div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:
<div style={{width:36,height:36,borderRadius:"50%",background:isPaid?
<div style={{minWidth:0}}>
<div style={{fontWeight:800,color:"#0d47a1",fontSize:15,overflow:"h
<div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}
<div style={{width:70,height:5,background:"#e3f2fd",borderRadius:
<div style={{width:`${Math.min(pct,100)}%`,height:"100%",backgr
</div>
<span style={{fontSize:10,color:"#90a4ae",fontWeight:700}}>{pct}%
{isPaid&&<span style={{fontSize:10,color:"#2e7d32",fontWeight:800
</div>
</div>
</div>
<div style={{display:"flex",gap:10,flexShrink:0}}>
{[{l:"Dû",v:p.total,c:"#0d47a1"},{l:"Payé",v:p.paid,c:"#2e7d32"},{l:"
<div key={l} style={{textAlign:"center"}}>
<div style={{fontSize:9,color:"#90a4ae",fontWeight:700,textTransf
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,col
</div>
))}
</div>
</div>
{isAdmin && (
<div style={{display:"flex",justifyContent:"flex-end"}}>
{editingPayment===p.player ? (
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<input type="number" value={paymentInput} onChange={e=>setPayment
placeholder="Montant €" inputMode="decimal"
style={{width:100,padding:"8px 10px",borderRadius:8,border:"2px
<button onClick={()=>savePayment(p.player)} style={{background:"#
<button onClick={()=>{setEditingPayment(null);setPaymentInput("")
</div>
) : (
<button onClick={()=>{setEditingPayment(p.player);setPaymentInput("
style={{background:isPaid?"#e8f5e9":"#1565c0",color:isPaid?"#4caf
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
{/* JOUEURS */}
{activeTab==="Joueurs" && (
<div>
{selectedPlayer ? (
<div>
<button onClick={()=>setSelectedPlayer(null)} style={{background:"#1565c0",co
<div style={C.card}>
<div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
<div style={{width:54,height:54,borderRadius:"50%",background:"linear-gra
<div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#0
<div style={{color:"#78909c",fontSize:13}}>Total : <strong style={{colo
</div>
</div>
{(()=>{
const stats = getPlayerInfractionStats(playerStats[selectedPlayer]?.entri
if (!stats.length) return null;
return (
<div style={{marginBottom:16}}>
<div style={{fontSize:11,fontWeight:800,color:"#78909c",textTransform
<div style={{display:"flex",flexWrap:"wrap",gap:8}}>
{stats.map(([label,count]) => (
<div key={label} style={{background:"#e3f2fd",borderRadius:20,pad
{label} <span style={{background:"#1565c0",color:"white",border
</div>
))}
</div>
</div>
);
})()}
<h4 style={{color:"#0d47a1",fontFamily:"'Bebas Neue',sans-serif",fontSize:1
{(()=>{
const entries = (playerStats[selectedPlayer]?.entries||[]).filter(e=>e.am
const byMatch = {};
entries.forEach(e => {
if (!byMatch[e.matchLabel]) byMatch[e.matchLabel] = {date:e.matchDate,s
byMatch[e.matchLabel].entries.push(e);
});
const sorted = Object.entries(byMatch).sort((a,b)=>(b[1].sortKey||0)-(a[1
if (!sorted.length) return <div style={{color:"#90a4ae",padding:20,textAl
return sorted.map(([matchLabel,{date,entries:mE}]) => (
<div key={matchLabel} style={{marginBottom:12}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}
<div style={{fontSize:11,fontWeight:800,color:"#0d47a1",background:
<div style={{fontSize:11,color:"#90a4ae"}}>{date}</div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color
</div>
{mE.map((e,i) => (
<div key={i} style={{display:"flex",alignItems:"center",padding:"8p
<div style={{fontSize:13,color:"#546e7a",flex:1}}>{e.detail}</div
<div style={{display:"flex",alignItems:"center",gap:8,flexShrink:
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,c
{isAdmin && <button onClick={()=>deleteInfraction(e.matchId,e.e
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
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center
<h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1
{isAdmin && <button onClick={()=>setShowAddInfraction(!showAddInfraction)}
</div>
{isAdmin && showAddInfraction && (
<div style={{...C.card,marginBottom:16}}>
<h3 style={C.h3}>Ajouter une infraction</h3>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(1
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"bl
<select value={newInfraction.player} onChange={e=>setNewInfraction(p=
<option value="">Choisir</option>
{players.map(p=><option key={p}>{p}</option>)}
<option value="__new__">+ Nouveau</option>
</select>
{newInfraction.player==="__new__" && <input placeholder="Nom" onChang
</div>
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"bl
<select value={newInfraction.matchLabel} onChange={e=>setNewInfractio
<option value="">Hors match</option>
{matches.map(m=><option key={m.fbId||m.id} value={m.match}>{m.match
<option value="__new__">+ Nouveau match</option>
</select>
{newInfraction.matchLabel==="__new__" && <input placeholder="Nom du m
</div>
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"bl
<select value={newInfraction.ruleId} onChange={e=>setNewInfraction(p=
<option value="">Personnalisée</option>
{rules.map(r=><option key={r.id} value={r.id}>{r.name} ({r.amount}€
</select>
</div>
{!newInfraction.ruleId && <>
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"
<input value={newInfraction.customDetail} onChange={e=>setNewInfrac
</div>
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"
<input type="number" inputMode="decimal" value={newInfraction.custo
</div>
</>}
</div>
<div style={{display:"flex",gap:10,marginTop:14}}>
<button onClick={addInfraction} style={{background:"#1565c0",color:"whi
<button onClick={()=>setShowAddInfraction(false)} style={{background:"#
</div>
</div>
)}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150p
{players.sort((a,b)=>(playerStats[b]?.total||0)-(playerStats[a]?.total||0))
<div key={player} onClick={()=>setSelectedPlayer(player)} style={{...C.ca
onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
<div style={{width:40,height:40,borderRadius:"50%",background:"linear-g
<div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>{player}</div
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1
{playerStats[player]?.chaboula>0 && <div style={{fontSize:11,color:"#e5
</div>
))}
</div>
</div>
)}
</div>
)}
{/* RÈGLES */}
{activeTab==="Règles" && (
<div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",ma
<h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",le
{isAdmin && <button onClick={()=>setShowAddRule(!showAddRule)} style={{backgrou
</div>
{isAdmin && showAddRule && (
<div style={{...C.card,marginBottom:16}}>
<div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
<input value={newRule.name} onChange={e=>setNewRule(p=>({...p,name:e.target
<input type="number" inputMode="decimal" value={newRule.amount} onChange={e
<button onClick={addRule} style={{background:"#1565c0",color:"white",border
<button onClick={()=>setShowAddRule(false)} style={{background:"#eceff1",co
</div>
</div>
)}
{isAdmin && editingRule && (
<div style={{...C.card,marginBottom:16}}>
<div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
<input value={editingRule.name} onChange={e=>setEditingRule(p=>({...p,name:
<input type="number" inputMode="decimal" value={editingRule.amount} onChang
<button onClick={saveRule} style={{background:"#1565c0",color:"white",borde
<button onClick={()=>setEditingRule(null)} style={{background:"#eceff1",col
</div>
</div>
)}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1f
{rules.map(rule => (
<div key={rule.id} style={{background:"white",borderRadius:14,padding:"12px 1
<div style={{flex:1,fontWeight:700,color:"#1a237e",fontSize:13}}>{rule.name
<div style={{display:"flex",alignItems:"center",gap:6}}>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#156
{isAdmin && <>
<button onClick={()=>setEditingRule(rule)} style={{background:"#e3f2fd"
<button onClick={()=>deleteRule(rule.id)} style={{background:"#ffebee",
</>}
</div>
</div>
))}
</div>
</div>
)}
{/* CALENDRIER */}
{activeTab==="Calendrier" && (
<div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",ma
<h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",le
{isAdmin && <button onClick={()=>setShowAddCalendar(!showAddCalendar)} style={{
</div>
{isAdmin && showAddCalendar && (
<div style={{...C.card,marginBottom:16}}>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px
{[{label:"DATE",key:"date",placeholder:"ex: Avr 2025"},{label:"ADVERSAIRE",
<div key={f.key}>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"bloc
<input value={newCalMatch[f.key]} onChange={e=>setNewCalMatch(p=>({...p
</div>
))}
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block"
<select value={newCalMatch.home} onChange={e=>setNewCalMatch(p=>({...p,ho
<option value="true">Domicile</option><option value="false">Extérieur</
</select>
</div>
<div>
<label style={{fontSize:11,fontWeight:700,color:"#78909c",display:"block"
<select value={newCalMatch.team} onChange={e=>setNewCalMatch(p=>({...p,te
<option value="Éq1">Équipe 1</option><option value="Éq2">Équipe 2</opti
</select>
</div>
</div>
<div style={{display:"flex",gap:10,marginTop:14}}>
<button onClick={addCalendarMatch} style={{background:"#1565c0",color:"whit
<button onClick={()=>setShowAddCalendar(false)} style={{background:"#eceff1
</div>
</div>
)}
<div style={{display:"flex",flexDirection:"column",gap:10}}>
{calendar.slice().sort((a,b)=>b.sortKey-a.sortKey).map(m => (
<div key={m.fbId||m.id} style={{background:"white",borderRadius:14,padding:"1
<div style={{width:38,height:38,borderRadius:"50%",background:m.team==="Éq2
<div style={{flex:1,minWidth:0}}>
<div style={{fontWeight:800,color:"#0d47a1",fontSize:14}}>vs {m.opponent}
<div style={{fontSize:12,color:"#78909c",marginTop:2}}>{m.date} • {m.loca
</div>
</div>
))}
</div>
</div>
)}
{/* STATS */}
{activeTab==="Stats" && (
<div>
<h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#0d47a1",lett
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr
<div style={{...C.card,gridColumn:"1/-1"}}>
<h3 style={C.h3}> Total par joueur</h3>
{Object.entries(playerStats).sort((a,b)=>b[1].total-a[1].total).map(([name,st
const maxTotal = Math.max(1,...Object.values(playerStats).map(s=>s.total));
const pct = Math.round((stats.total/maxTotal)*100);
return (
<div key={name} style={{marginBottom:10,cursor:"pointer"}} onClick={()=>{
<div style={{display:"flex",justifyContent:"space-between",marginBottom
<span style={{fontWeight:700,color:"#1a237e",fontSize:14}}>{name}</sp
<span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:
</div>
<div style={{background:"#e3f2fd",borderRadius:4,height:7}}>
<div style={{width:`${pct}%`,height:"100%",background:"linear-gradien
</div>
</div>
);
})}
</div>
<div style={C.card}>
<h3 style={C.h3}> Classement Chaboulat</h3>
{Object.entries(playerStats).sort((a,b)=>b[1].chaboula-a[1].chaboula).filter(
<div key={name} style={{display:"flex",alignItems:"center",gap:10,padding:"
<div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d
<div style={{flex:1,fontWeight:700,color:"#1a237e"}}>{name}</div>
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#e53
</div>
))}
</div>
<div style={C.card}>
<h3 style={C.h3}> Matchs par montant</h3>
{matchTotals.slice().sort((a,b)=>b.total-a.total).map((m,i) => (
<div key={m.fbId||m.id} style={{display:"flex",alignItems:"center",gap:10,p
<div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#f4d
<div style={{flex:1,fontWeight:600,color:"#1a237e",fontSize:13}}>{m.match
<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"#156
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
