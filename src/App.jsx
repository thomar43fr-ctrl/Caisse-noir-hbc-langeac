{activeTab === "Règles" && (
  <div className="rules-container">
    {/* En-tête */}
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.75rem", color: "#0d47a1", margin: 0 }}>
        📋 Règles
      </h2>
      {isAdmin && (
        <button 
          onClick={() => setShowAddRule(!showAddRule)} 
          style={styles.primaryButton}
        >
          + Règle
        </button>
      )}
    </header>

    {/* Règle spécifique de Poids */}
    <div style={styles.highlightCard}>
      <span style={{ fontSize: "1.5rem", marginRight: "1rem" }}>⚖️</span>
      <div style={{ flex: 1 }}>
        <h4 style={{ margin: 0, fontWeight: 700, color: "#bf360c", fontSize: "0.9rem" }}>
          Règle de poids — Pesées de saison
        </h4>
        <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#e65100" }}>
          0,50€ par tranche de 100g pris par rapport à la pesée précédente
        </p>
      </div>
      <strong style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", color: "#e65100" }}>
        0,50€/100g
      </strong>
    </div>

    {/* Tableau des Pesées */}
    <section style={{ ...C.card, marginBottom: "1.5rem" }}>
      <h3 style={C.h3}>⚖️ Pesées & Amendes calculées</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr style={{ backgroundColor: "#e3f2fd" }}>
              {["Joueur", "Début", "Mi-saison", "Diff. (début→mi)", "Amende Mi", "Fin de saison", "Diff. (mi→fin)", "Amende Fin"].map((header) => (
                <th key={header} style={styles.th}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEIGHT_INFRACTIONS.filter(record => record.startWeight && record.midWeight).map((record, index) => {
              // Formatage professionnel des devises
              const formatCurrency = (amount) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
              const formatDiff = (diff) => diff === 0 ? "=" : `${diff > 0 ? "+" : ""}${diff}g`;

              // Logique Mi-saison
              const diffMidG = Math.round((record.midWeight - record.startWeight) * 1000);
              const fineMid = calcWeightAmount(record.startWeight, record.midWeight);

              // Logique Fin de saison
              const hasEndWeight = record.endWeight != null;
              const diffEndG = hasEndWeight ? Math.round((record.endWeight - record.midWeight) * 1000) : null;
              const fineEnd = hasEndWeight ? calcWeightAmount(record.midWeight, record.endWeight) : 0;

              return (
                <tr key={record.player} style={{ backgroundColor: index % 2 === 0 ? "#ffffff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ ...styles.td, fontWeight: 700, color: "#1a237e" }}>{record.player}</td>
                  
                  {/* Phase 1 */}
                  <td style={{ ...styles.td, color: "#546e7a" }}>{record.startWeight} kg</td>
                  <td style={{ ...styles.td, color: "#546e7a" }}>{record.midWeight} kg</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: diffMidG > 0 ? "#e53935" : diffMidG < 0 ? "#2e7d32" : "#78909c" }}>
                    {formatDiff(diffMidG)}
                  </td>
                  <td style={{ ...styles.td, ...styles.amountText, color: fineMid > 0 ? "#e65100" : "#2e7d32" }}>
                    {formatCurrency(fineMid)}
                  </td>

                  {/* Phase 2 */}
                  <td style={{ ...styles.td, color: hasEndWeight ? "#546e7a" : "#b0bec5" }}>
                    {hasEndWeight ? `${record.endWeight} kg` : "—"}
                  </td>
                  <td style={{ ...styles.td, fontWeight: 700, color: !hasEndWeight ? "#b0bec5" : diffEndG > 0 ? "#e53935" : diffEndG < 0 ? "#2e7d32" : "#78909c" }}>
                    {hasEndWeight ? formatDiff(diffEndG) : "—"}
                  </td>
                  <td style={{ ...styles.td, ...styles.amountText, color: !hasEndWeight ? "#b0bec5" : fineEnd > 0 ? "#e65100" : "#2e7d32" }}>
                    {hasEndWeight ? formatCurrency(fineEnd) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

    {/* Gestion des Règles (Admin) */}
    {isAdmin && (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Formulaire Ajout */}
        {showAddRule && (
          <div style={C.card}>
            <div style={styles.formGroup}>
              <input 
                value={newRule.name} 
                onChange={e => setNewRule(prev => ({ ...prev, name: e.target.value }))} 
                placeholder="Nom de la règle" 
                style={styles.inputFlex}
              />
              <input 
                type="number" 
                inputMode="decimal" 
                value={newRule.amount} 
                onChange={e => setNewRule(prev => ({ ...prev, amount: e.target.value }))} 
                placeholder="€" 
                style={styles.inputAmount}
              />
              <button onClick={addRule} style={styles.primaryButton}>Ajouter</button>
              <button onClick={() => setShowAddRule(false)} style={styles.cancelButton}>✕</button>
            </div>
          </div>
        )}

        {/* Formulaire Édition */}
        {editingRule && (
          <div style={C.card}>
            <div style={styles.formGroup}>
              <input 
                value={editingRule.name} 
                onChange={e => setEditingRule(prev => ({ ...prev, name: e.target.value }))} 
                style={{ ...styles.inputFlex, borderColor: "#1565c0" }}
              />
              <input 
                type="number" 
                inputMode="decimal" 
                value={editingRule.amount} 
                onChange={e => setEditingRule(prev => ({ ...prev, amount: parseFloat(e.target.value) }))} 
                style={{ ...styles.inputAmount, borderColor: "#1565c0" }}
              />
              <button onClick={saveRule} style={styles.primaryButton}>Sauver</button>
              <button onClick={() => setEditingRule(null)} style={styles.cancelButton}>✕</button>
            </div>
          </div>
        )}
      </div>
    )}

    {/* Liste des Règles Standards */}
    <div style={styles.gridContainer}>
      {rules.map(rule => (
        <div key={rule.id} style={styles.ruleCard}>
          <span style={{ flex: 1, fontWeight: 700, color: "#1a237e", fontSize: "0.85rem" }}>
            {rule.name}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", color: "#1565c0" }}>
              {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(rule.amount)}
            </span>
            {isAdmin && (
              <div style={{ display: "flex", gap: "4px" }}>
                <button onClick={() => setEditingRule(rule)} style={styles.iconBtnBlue}>✏️</button>
                <button onClick={() => deleteRule(rule.id)} style={styles.iconBtnRed}>🗑</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
