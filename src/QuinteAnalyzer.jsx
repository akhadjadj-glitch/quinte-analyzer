import { useState, useEffect, useCallback, useMemo } from "react";

const PMU_BASE = "https://online.turfinfo.api.pmu.fr/rest/client/1";
const IS_DEV = import.meta.env.DEV;

function pmuUrl(path) {
  const url = IS_DEV ? `/api/pmu/rest/client/1${path}` : `${PMU_BASE}${path}`;
  return IS_DEV ? url : `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
}

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
}

/* ── MUSIQUE PARSER ── */
function parseMusique(m) {
  if (!m) return [];
  const r = [];
  const re = /(\d+|D|T|A|Ret|0)([a-z]?)/gi;
  let match;
  while ((match = re.exec(m)) !== null) {
    const pos = match[1];
    const type = match[2] || "";
    r.push({ pos: pos === "D" || pos === "T" || pos === "A" || pos === "Ret" ? 99 : parseInt(pos), type, raw: match[0] });
  }
  return r.slice(0, 10);
}

function renderMusique(m) {
  const runs = parseMusique(m);
  return runs.map((r, i) => {
    let color = "#666";
    if (r.pos === 1) color = "#FFD700";
    else if (r.pos === 2) color = "#C0C0C0";
    else if (r.pos === 3) color = "#CD7F32";
    else if (r.pos <= 5) color = "#5BBA6F";
    else if (r.pos <= 8) color = "#8899AA";
    return (
      <span key={i} style={{ color, fontWeight: r.pos <= 3 ? 700 : 400, marginRight: 3, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
        {r.raw}
      </span>
    );
  });
}

/* ════════════════════════════════════════════════════════════
   4 MOTEURS D'ANALYSE INDEPENDANTS
   ════════════════════════════════════════════════════════════ */

/* ── SOURCE 1 : PMU/EQUIDIA — pronostics officiels ── */
function scoreSourcePMU(p, pronoMap) {
  const pronoScore = pronoMap[p.numPmu] || 0;
  return Math.round(pronoScore * 100) / 100;
}

/* ── SOURCE 2 : STATISTIQUE — gains, victoires, régularité ── */
function scoreSourceStats(p, allParticipants) {
  let score = 0;
  const nc = p.nombreCourses || 0;
  const nv = p.nombreVictoires || 0;
  const np = p.nombrePlaces || 0;
  const gc = p.gainsCarriere || 0;
  const gv = p.gainsVictoires || 0;
  const gay = p.gainsAnneeEnCours || 0;
  const gap = p.gainsAnneePrecedente || 0;

  // Taux de victoire (max ~30pts)
  if (nc > 0) {
    const winRate = nv / nc;
    const placeRate = np / nc;
    score += winRate * 25;
    score += placeRate * 15;
  }

  // Gains carrière normalisés (max ~20pts)
  const maxGains = Math.max(...allParticipants.map(x => x.gainsCarriere || 0), 1);
  score += (gc / maxGains) * 20;

  // Gains année en cours (forme récente financière) (max ~15pts)
  const maxGainY = Math.max(...allParticipants.map(x => x.gainsAnneeEnCours || 0), 1);
  score += (gay / maxGainY) * 15;

  // Ratio gains/victoires vs gains/places — cheval régulier (max ~10pts)
  if (gc > 0 && gv > 0) {
    const placeMoney = gc - gv;
    if (placeMoney > gv * 0.5) score += 8; // Gagne souvent de l'argent même sans victoire
  }

  // Bonus forme année en cours vs précédente
  if (gap > 0 && gay > gap * 0.8) score += 5;
  if (gay > gap) score += 3;

  // Nombre de 2e et 3e places — régularité
  score += (p.nombrePlacesSecond || 0) * 1.5;
  score += (p.nombrePlacesTroisieme || 0) * 1;

  return Math.round(score * 100) / 100;
}

/* ── SOURCE 3 : FORME/MUSIQUE — analyse des dernières courses ── */
function scoreSourceForme(p) {
  const runs = parseMusique(p.musique);
  if (runs.length === 0) return 0;
  let score = 0;

  // Pondération forte sur les 3 dernières courses
  runs.forEach((r, i) => {
    const weight = Math.max(0.5, 6 - i * 0.8);
    if (r.pos === 1) score += 12 * weight;
    else if (r.pos === 2) score += 9 * weight;
    else if (r.pos === 3) score += 7 * weight;
    else if (r.pos <= 5) score += 4 * weight;
    else if (r.pos <= 8) score += 1 * weight;
    else score -= 2 * weight;
  });

  // Bonus série positive (3 dernières dans le top 5)
  const last3 = runs.slice(0, 3);
  const top5count = last3.filter(r => r.pos <= 5).length;
  if (top5count === 3) score += 15;
  else if (top5count === 2) score += 8;

  // Bonus progression (amélioration de la position)
  if (runs.length >= 3) {
    if (runs[0].pos < runs[1].pos && runs[1].pos < runs[2].pos) score += 10; // progression nette
    else if (runs[0].pos < runs[1].pos) score += 5; // dernière mieux que précédente
  }

  // Pénalité longue absence de top 5
  if (runs.length >= 5 && runs.slice(0, 5).every(r => r.pos > 5)) score -= 10;

  return Math.round(score * 100) / 100;
}

/* ── SOURCE 4 : CONDITIONS — adéquation cheval/course ── */
function scoreSourceConditions(p, raceInfo, allParticipants) {
  let score = 0;

  // Âge optimal (4-7 ans pour le plat, 5-9 pour le trot)
  const age = p.age || 0;
  const isTrot = (raceInfo?.specialite || "").toUpperCase().includes("TROT") ||
                 (raceInfo?.specialite || "").toUpperCase().includes("ATTELÉ") ||
                 (raceInfo?.specialite || "").toUpperCase().includes("MONTE");
  if (isTrot) {
    if (age >= 5 && age <= 9) score += 12;
    else if (age >= 4 && age <= 10) score += 6;
    else score -= 3;
  } else {
    if (age >= 4 && age <= 6) score += 12;
    else if (age === 3 || age === 7) score += 8;
    else if (age === 8) score += 3;
    else score -= 3;
  }

  // Ferrure — déferré = avantage aérodynamique
  if (p.deferre === "DEFERRE_4") score += 8;
  else if (p.deferre === "DEFERRE_ANTERIEURS") score += 5;
  else if (p.deferre === "DEFERRE_POSTERIEURS") score += 4;

  // Œillères — signal de concentration
  if (p.oeilleres && p.oeilleres !== "SANS_OEILLERES") {
    if (p.oeilleres === "OEILLERES_AUSTRALIENNES") score += 5;
    else score += 3;
  }

  // Poids/Handicap — plus léger = avantage
  const poids = p.poidsConditionMonte || p.handicapPoids || 0;
  if (poids > 0) {
    const avgPoids = allParticipants.reduce((s, x) => s + (x.poidsConditionMonte || x.handicapPoids || 0), 0) / allParticipants.length;
    if (poids < avgPoids - 2) score += 8;
    else if (poids < avgPoids) score += 4;
    else if (poids > avgPoids + 3) score -= 4;
  }

  // Place à la corde — avantage intérieur
  const corde = p.placeCorde || 0;
  if (corde >= 1 && corde <= 4) score += 5;
  else if (corde >= 5 && corde <= 8) score += 2;
  else if (corde > 12) score -= 3;

  // Sexe — hongres souvent plus réguliers
  if (p.sexe === "HONGRES") score += 2;
  else if (p.sexe === "FEMELLES") score += 1; // allocation poids favorable

  // Handicap favorable
  const hv = p.handicapValeur || 0;
  if (hv > 0) {
    const avgHv = allParticipants.reduce((s, x) => s + (x.handicapValeur || 0), 0) / allParticipants.length;
    if (hv > avgHv + 5) score += 6;
    else if (hv > avgHv) score += 3;
  }

  // Changement de driver = signal entraîneur
  if (p.driverChange) score += 3;

  return Math.round(score * 100) / 100;
}

/* ── SYNTHÈSE MULTI-SOURCES ── */
function computeMultiSourceScores(participants, pronoMap, raceInfo) {
  const active = participants.filter(p => !p.supplement && !p.nonPartant);

  return active.map(p => {
    const s1 = scoreSourcePMU(p, pronoMap);
    const s2 = scoreSourceStats(p, active);
    const s3 = scoreSourceForme(p);
    const s4 = scoreSourceConditions(p, raceInfo, active);

    // Normaliser chaque source sur 100
    return { ...p, s1, s2, s3, s4 };
  });
}

function normalizeScores(scored, key) {
  const vals = scored.map(s => s[key]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  return scored.map(s => ({ ...s, [`${key}n`]: Math.round(((s[key] - min) / range) * 100 * 10) / 10 }));
}

function buildSynthesis(scored) {
  let result = [...scored];
  result = normalizeScores(result, "s1");
  result = normalizeScores(result, "s2");
  result = normalizeScores(result, "s3");
  result = normalizeScores(result, "s4");

  return result.map(p => {
    // Poids de chaque source dans la note finale
    const total = p.s1n * 0.25 + p.s2n * 0.25 + p.s3n * 0.30 + p.s4n * 0.20;
    // Consensus : nombre de sources où le cheval est dans le top 5
    const consensus = [p.s1n, p.s2n, p.s3n, p.s4n].filter(v => v >= 60).length;
    return { ...p, total: Math.round(total * 10) / 10, consensus };
  }).sort((a, b) => b.total - a.total);
}

/* ════════════════════════════════════════════════════════════
   GENERATION DE SÉRIES DISTINCTES
   ════════════════════════════════════════════════════════════ */
function generateSeries(synthesized) {
  const all = synthesized;
  if (all.length < 5) return [];

  const series = [];
  const usedCombos = new Set();
  const comboKey = (horses) => horses.map(h => h.numPmu).sort((a,b) => a-b).join("-");

  const addSeries = (label, desc, sourceTag, horses) => {
    const valid = horses.filter(Boolean);
    if (valid.length !== 5) return;
    const key = comboKey(valid);
    if (usedCombos.has(key)) return;
    usedCombos.add(key);
    series.push({ label, desc, sourceTag, horses: valid });
  };

  // Classements par source
  const byTotal = [...all];
  const byS1 = [...all].sort((a, b) => b.s1n - a.s1n);
  const byS2 = [...all].sort((a, b) => b.s2n - a.s2n);
  const byS3 = [...all].sort((a, b) => b.s3n - a.s3n);
  const byS4 = [...all].sort((a, b) => b.s4n - a.s4n);

  // ═══ BLOC SYNTHÈSES (3 synthèses différentes) ═══

  // Synthèse 1 — ÉQUILIBRÉE : pondération égale des 4 sources
  addSeries("Synthèse 1 — Équilibrée", "Pondération égale des 4 sources", "🏆",
    byTotal.slice(0, 5));

  // Synthèse 2 — SÉCURITÉ : favorise PMU + Stats (sources fiables)
  if (all.length >= 5) {
    const bySafe = [...all].sort((a, b) => (b.s1n * 0.40 + b.s2n * 0.35 + b.s3n * 0.15 + b.s4n * 0.10) - (a.s1n * 0.40 + a.s2n * 0.35 + a.s3n * 0.15 + a.s4n * 0.10));
    addSeries("Synthèse 2 — Sécurité", "PMU 40% + Stats 35% — chevaux solides", "🛡️",
      bySafe.slice(0, 5));
  }

  // Synthèse 3 — OFFENSIVE : favorise Forme + Conditions (terrain du jour)
  if (all.length >= 5) {
    const byOff = [...all].sort((a, b) => (b.s3n * 0.40 + b.s4n * 0.30 + b.s1n * 0.15 + b.s2n * 0.15) - (a.s3n * 0.40 + a.s4n * 0.30 + a.s1n * 0.15 + a.s2n * 0.15));
    addSeries("Synthèse 3 — Offensive", "Forme 40% + Conditions 30% — forme du jour", "⚡",
      byOff.slice(0, 5));
  }

  // ═══ BLOC SOURCES INDIVIDUELLES ═══

  // Série 4 — EXPERTS PMU
  addSeries("Série 4 — Experts PMU", "Pronostics officiels PMU/Equidia", "🏇",
    byS1.slice(0, 5));

  // Série 5 — STATISTIQUE
  addSeries("Série 5 — Statistique", "Gains carrière + taux victoire/placé", "📊",
    byS2.slice(0, 5));

  // Série 6 — FORME
  addSeries("Série 6 — Forme récente", "Musique + progression dernières courses", "🎵",
    byS3.slice(0, 5));

  // Série 7 — CONDITIONS
  addSeries("Série 7 — Conditions", "Âge + ferrure + poids + corde + équipement", "⚙️",
    byS4.slice(0, 5));

  // ═══ BLOC STRATÉGIES SPÉCIALES ═══

  // Série 8 — CONSENSUS FORT
  if (all.length >= 8) {
    const highConsensus = all.filter(p => p.consensus >= 3).sort((a, b) => b.total - a.total);
    if (highConsensus.length >= 5) {
      addSeries("Série 8 — Consensus fort", "Top dans 3+ sources sur 4", "🎯",
        highConsensus.slice(0, 5));
    } else if (highConsensus.length >= 3) {
      const picked = [...highConsensus];
      const used = new Set(picked.map(p => p.numPmu));
      for (const h of byTotal) {
        if (picked.length >= 5) break;
        if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); }
      }
      addSeries("Série 8 — Consensus fort", `${highConsensus.length} chevaux top dans 3+ sources`, "🎯",
        picked.slice(0, 5));
    }
  }

  // Série 9 — OUTSIDERS MALINS
  if (all.length >= 10) {
    const outsiders = all
      .filter(p => p.s1n < 50)
      .sort((a, b) => (b.s2n + b.s3n) - (a.s2n + a.s3n));
    if (outsiders.length >= 3) {
      const picked = outsiders.slice(0, 3);
      const used = new Set(picked.map(p => p.numPmu));
      for (const h of byTotal) {
        if (picked.length >= 5) break;
        if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); }
      }
      addSeries("Série 9 — Outsiders malins", "Bonne forme + stats, pas favoris PMU", "💡",
        picked.slice(0, 5));
    }
  }

  // Série 10 — GROS RAPPORT
  if (all.length >= 14) {
    const picked = [byTotal[0]];
    const used = new Set([byTotal[0].numPmu]);
    const deepOuts = all.slice(6).sort((a, b) => b.s3n - a.s3n);
    for (const h of deepOuts) {
      if (picked.length >= 5) break;
      if (!used.has(h.numPmu)) { picked.push(h); used.add(h.numPmu); }
    }
    addSeries("Série 10 — Gros rapport", "1 favori + 4 outsiders en forme", "💰",
      picked.slice(0, 5));
  }

  return series;
}

/* ════════════════════════════════════════════════════════════
   COMPONENT PRINCIPAL
   ════════════════════════════════════════════════════════════ */
const TABS = ["quinté", "sources", "pronostic"];

export default function QuinteAnalyzer() {
  const [tab, setTab] = useState("quinté");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [raceInfo, setRaceInfo] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [pronostics, setPronostics] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const dateObj = useMemo(() => new Date(selectedDate + "T12:00:00"), [selectedDate]);

  const fetchQuinte = useCallback(async () => {
    setLoading(true);
    setError(null);
    setParticipants([]);
    setPronostics(null);
    setRaceInfo(null);
    try {
      const dateStr = fmtDate(dateObj);
      const progRes = await fetch(pmuUrl(`/programme/${dateStr}`));
      if (!progRes.ok) throw new Error(`Programme indisponible (${progRes.status})`);
      const prog = await progRes.json();

      let quinteRace = null, reunionNum = null, reunionData = null;
      for (const reunion of (prog.programme?.reunions || [])) {
        for (const course of (reunion.courses || [])) {
          if (course.categorieParticularite === "QUINTE" || (course.libelle || "").toUpperCase().includes("QUINTE") || course.quinte) {
            quinteRace = course;
            reunionNum = reunion.numOfficiel;
            reunionData = reunion;
            break;
          }
        }
        if (quinteRace) break;
      }

      if (!quinteRace) {
        for (const reunion of (prog.programme?.reunions || [])) {
          for (const course of (reunion.courses || [])) {
            if (course.ordreQuinte || (course.specialite && course.montantPrix > 50000)) {
              quinteRace = course;
              reunionNum = reunion.numOfficiel;
              reunionData = reunion;
              break;
            }
          }
          if (quinteRace) break;
        }
      }

      if (!quinteRace) throw new Error("Aucun Quinté+ trouvé pour cette date");

      setRaceInfo({
        ...quinteRace,
        reunionNum,
        date: dateStr,
        hippodrome: reunionData?.hippodrome?.libelleLong || reunionData?.hippodrome?.libelleCourt || quinteRace.hippodrome?.libelleLong || "Inconnu",
        meteo: reunionData?.meteo || null,
        pays: reunionData?.pays?.libelle || "France"
      });

      const partRes = await fetch(pmuUrl(`/programme/${dateStr}/R${reunionNum}/C${quinteRace.numOrdre}/participants`));
      if (!partRes.ok) throw new Error("Participants indisponibles");
      const partData = await partRes.json();
      setParticipants(partData.participants || []);

      try {
        const pronoRes = await fetch(pmuUrl(`/programme/${dateStr}/R${reunionNum}/C${quinteRace.numOrdre}/pronostics`));
        if (pronoRes.ok) {
          const pronoData = await pronoRes.json();
          setPronostics(pronoData);
        }
      } catch (e) { /* pronostics optional */ }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateObj]);

  useEffect(() => { fetchQuinte(); }, [fetchQuinte]);

  /* ── Build pronostic map from PMU data ── */
  const pronoMap = useMemo(() => {
    const map = {};
    if (!pronostics) return map;
    const sel = pronostics.selection || [];
    sel.forEach((s, idx) => {
      map[s.num_partant || s.numPartant || s.numero] = Math.max(0, 12 - idx * 1.5);
    });
    // Also handle alternate format
    const lists = pronostics.propinosPMU || pronostics.pronostics || [];
    const pronoList = Array.isArray(lists) ? lists : [lists];
    pronoList.forEach(p => {
      const nums = p?.participants || p?.numParticipants || [];
      nums.forEach((num, idx) => {
        map[num] = (map[num] || 0) + Math.max(0, 10 - idx * 1.5);
      });
    });
    return map;
  }, [pronostics]);

  /* ── Multi-source scoring ── */
  const synthesized = useMemo(() => {
    if (!participants.length) return [];
    const scored = computeMultiSourceScores(participants, pronoMap, raceInfo);
    return buildSynthesis(scored);
  }, [participants, pronoMap, raceInfo]);

  /* ── Series generation ── */
  const series = useMemo(() => generateSeries(synthesized), [synthesized]);

  /* ── Helpers ── */
  const getJockey = (p) => p.driver || p.jockey?.nom || (typeof p.jockey === "string" ? p.jockey : null) || "?";
  const getEntraineur = (p) => (typeof p.entraineur === "string" ? p.entraineur : p.entraineur?.nom) || "?";
  const getProprietaire = (p) => (typeof p.proprietaire === "string" ? p.proprietaire : p.proprietaire?.nom) || "?";
  const getEleveur = (p) => (typeof p.eleveur === "string" ? p.eleveur : p.eleveur?.nom) || null;
  const getSexLabel = (s) => ({ MALES: "♂ Mâle", FEMELLES: "♀ Femelle", HONGRES: "⚊ Hongre" }[s] || s || "?");
  const getOeilleres = (o) => o && o !== "SANS_OEILLERES" ? "✓ Oui" : "✗ Non";
  const hasOeilleres = (p) => p.oeilleres && p.oeilleres !== "SANS_OEILLERES";
  const getDeferre = (d) => {
    if (!d || d === "FERRE") return "Ferré 4 pieds";
    if (d === "DEFERRE_ANTERIEURS") return "Déferré antérieurs";
    if (d === "DEFERRE_POSTERIEURS") return "Déferré postérieurs";
    if (d === "DEFERRE_4") return "Déferré 4 pieds";
    return d.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
  };

  /* ═══════ RENDER ═══════ */
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(170deg, #0a0a0f 0%, #111118 40%, #0d0d14 100%)",
      color: "#e8e6e1",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: 0, margin: 0
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ── Header ── */}
      <div style={{
        background: "linear-gradient(135deg, rgba(212,175,55,0.08) 0%, rgba(10,10,15,0) 60%)",
        borderBottom: "1px solid rgba(212,175,55,0.15)",
        padding: "20px 24px 16px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, #D4AF37, #B8860B)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 700, color: "#0a0a0f",
            fontFamily: "Playfair Display, serif"
          }}>Q</div>
          <div>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              fontFamily: "Playfair Display, serif",
              background: "linear-gradient(135deg, #D4AF37, #F5E6A3, #D4AF37)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
            }}>Quinté+ Analyzer</h1>
            <p style={{ margin: 0, fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase" }}>
              Multi-Sources • 4 moteurs d'analyse
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: 8, color: "#e8e6e1", padding: "8px 12px", fontSize: 14,
              fontFamily: "JetBrains Mono, monospace", outline: "none", flex: 1
            }}
          />
          <button onClick={fetchQuinte} style={{
            background: "linear-gradient(135deg, #D4AF37, #B8860B)", border: "none",
            borderRadius: 8, color: "#0a0a0f", padding: "8px 16px", fontSize: 13,
            fontWeight: 600, cursor: "pointer"
          }}>Charger</button>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
              background: tab === t ? "rgba(212,175,55,0.15)" : "transparent",
              color: tab === t ? "#D4AF37" : "#777",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              textTransform: "uppercase", letterSpacing: 1.5,
              borderBottom: tab === t ? "2px solid #D4AF37" : "2px solid transparent",
              transition: "all 0.2s"
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: "16px 20px 40px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{
              width: 40, height: 40, border: "3px solid rgba(212,175,55,0.2)",
              borderTop: "3px solid #D4AF37", borderRadius: "50%",
              animation: "spin 0.8s linear infinite", margin: "0 auto 16px"
            }} />
            <p style={{ color: "#888", fontSize: 14 }}>Chargement du Quinté+...</p>
          </div>
        )}

        {error && !loading && (
          <div style={{
            background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)",
            borderRadius: 12, padding: 20, textAlign: "center"
          }}>
            <p style={{ color: "#ff6b6b", fontSize: 15, fontWeight: 600, margin: "0 0 8px" }}>Erreur</p>
            <p style={{ color: "#999", fontSize: 13, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* ═══════ TAB: QUINTÉ ═══════ */}
        {!loading && !error && raceInfo && tab === "quinté" && (
          <div>
            {/* Race Info */}
            <div style={{
              background: "linear-gradient(135deg, rgba(212,175,55,0.06), rgba(212,175,55,0.02))",
              border: "1px solid rgba(212,175,55,0.12)", borderRadius: 14, padding: 18, marginBottom: 16
            }}>
              <h2 style={{
                margin: "0 0 6px", fontSize: 17, fontWeight: 700,
                fontFamily: "Playfair Display, serif", color: "#D4AF37"
              }}>{raceInfo.libelle || `Quinté+ R${raceInfo.reunionNum}C${raceInfo.numOrdre}`}</h2>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#999" }}>
                <span>📍 {raceInfo.hippodrome}</span>
                <span>🏇 {raceInfo.specialite || "Plat"}</span>
                <span>📏 {raceInfo.distance ? `${raceInfo.distance}m` : "?"}</span>
                <span>💰 {raceInfo.montantPrix ? `${(raceInfo.montantPrix/1000).toFixed(0)}K€` : "?"}</span>
                <span>👥 {participants.filter(p => !p.nonPartant).length} partants</span>
                {raceInfo.heureDepart && <span>🕐 {new Date(raceInfo.heureDepart).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              {raceInfo.meteo && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#777" }}>
                  ☁️ Météo : {raceInfo.meteo.nebulositeLibelleCourt || "?"} • Temp: {raceInfo.meteo.temperature || "?"}°C • Vent: {raceInfo.meteo.forceVent || "?"} km/h
                </div>
              )}
            </div>

            {/* Participants */}
            {participants.filter(p => !p.nonPartant).map((p, i) => (
              <div key={p.numPmu} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: 14, marginBottom: 8,
                borderLeft: `3px solid ${i < 3 ? "#D4AF37" : i < 6 ? "#666" : "#333"}`
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{
                    background: "rgba(212,175,55,0.15)", color: "#D4AF37",
                    width: 28, height: 28, borderRadius: 7, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, fontFamily: "JetBrains Mono"
                  }}>{p.numPmu}</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{(p.nom || "?").toUpperCase()}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                      {getSexLabel(p.sexe)} • {p.age || "?"}ans • {p.race || ""}
                    </p>
                  </div>
                </div>

                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 14px",
                  fontSize: 12, color: "#999", marginBottom: 8
                }}>
                  <div><span style={{ color: "#666" }}>Jockey:</span> {getJockey(p)}</div>
                  <div><span style={{ color: "#666" }}>Entraîneur:</span> {getEntraineur(p)}</div>
                  <div><span style={{ color: "#666" }}>Propriétaire:</span> {getProprietaire(p)}</div>
                  <div><span style={{ color: "#666" }}>Poids:</span> {p.poidsConditionMonte || p.handicapPoids || "?"}kg</div>
                  <div><span style={{ color: "#666" }}>Œillères:</span> <span style={{ color: hasOeilleres(p) ? "#5BBA6F" : "#888" }}>{getOeilleres(p.oeilleres)}</span></div>
                  <div><span style={{ color: "#666" }}>Ferrure:</span> {getDeferre(p.deferre)}</div>
                  {getEleveur(p) && <div><span style={{ color: "#666" }}>Éleveur:</span> {getEleveur(p)}</div>}
                  {p.nomPere && <div><span style={{ color: "#666" }}>Père:</span> {p.nomPere}</div>}
                  {p.nomMere && <div><span style={{ color: "#666" }}>Mère:</span> {p.nomMere}</div>}
                  {p.nombreCourses != null && <div><span style={{ color: "#666" }}>Courses:</span> {p.nombreCourses} ({p.nombreVictoires}V {p.nombrePlaces}P)</div>}
                  {p.gainsCarriere > 0 && <div><span style={{ color: "#666" }}>Gains:</span> {(p.gainsCarriere/100).toLocaleString("fr-FR")}€</div>}
                  {p.gainsAnneeEnCours > 0 && <div><span style={{ color: "#666" }}>Gains 2026:</span> {(p.gainsAnneeEnCours/100).toLocaleString("fr-FR")}€</div>}
                </div>

                {p.musique && (
                  <div style={{
                    background: "rgba(0,0,0,0.3)", borderRadius: 6,
                    padding: "6px 10px", display: "flex", alignItems: "center", gap: 8
                  }}>
                    <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>MUSIQUE</span>
                    <div>{renderMusique(p.musique)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ═══════ TAB: SOURCES ═══════ */}
        {!loading && !error && tab === "sources" && synthesized.length > 0 && (
          <div>
            <div style={{
              background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.1)",
              borderRadius: 12, padding: 16, marginBottom: 16
            }}>
              <h3 style={{ margin: "0 0 8px", fontFamily: "Playfair Display", fontSize: 16, color: "#D4AF37" }}>
                4 Sources d'analyse croisées
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "#999" }}>
                <div style={{ background: "rgba(139,92,246,0.08)", padding: 8, borderRadius: 8 }}>
                  <strong style={{ color: "#a78bfa" }}>🏇 PMU/Equidia</strong><br/>
                  Pronostics officiels, cotes probables
                </div>
                <div style={{ background: "rgba(59,130,246,0.08)", padding: 8, borderRadius: 8 }}>
                  <strong style={{ color: "#60a5fa" }}>📊 Statistique</strong><br/>
                  Gains, victoires, régularité carrière
                </div>
                <div style={{ background: "rgba(16,185,129,0.08)", padding: 8, borderRadius: 8 }}>
                  <strong style={{ color: "#34d399" }}>🎵 Forme</strong><br/>
                  Musique récente, progression, série
                </div>
                <div style={{ background: "rgba(245,158,11,0.08)", padding: 8, borderRadius: 8 }}>
                  <strong style={{ color: "#fbbf24" }}>⚙️ Conditions</strong><br/>
                  Âge, ferrure, poids, corde, sexe
                </div>
              </div>
            </div>

            {/* Table ranking */}
            {synthesized.map((p, i) => (
              <div key={p.numPmu} style={{
                background: i < 5 ? "rgba(212,175,55,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${i < 5 ? "rgba(212,175,55,0.12)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 10, padding: 12, marginBottom: 6
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: i === 0 ? "linear-gradient(135deg,#D4AF37,#B8860B)" : i < 3 ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, color: i === 0 ? "#0a0a0f" : i < 3 ? "#D4AF37" : "#888",
                    fontFamily: "JetBrains Mono"
                  }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: i < 5 ? "#e8e6e1" : "#999" }}>
                      N°{p.numPmu} {(p.nom || "").toUpperCase()}
                    </span>
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#888" }}>{getJockey(p)}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{
                      fontFamily: "JetBrains Mono", fontSize: 16, fontWeight: 700,
                      color: i === 0 ? "#D4AF37" : i < 3 ? "#ccc" : "#777"
                    }}>{p.total}</span>
                    {p.consensus >= 3 && <span style={{ display: "block", fontSize: 9, color: "#5BBA6F" }}>★ Consensus {p.consensus}/4</span>}
                  </div>
                </div>

                {/* Source bars */}
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { label: "PMU", val: p.s1n, color: "#a78bfa" },
                    { label: "Stats", val: p.s2n, color: "#60a5fa" },
                    { label: "Forme", val: p.s3n, color: "#34d399" },
                    { label: "Cond.", val: p.s4n, color: "#fbbf24" },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#666", marginBottom: 2, textAlign: "center" }}>{s.label}</div>
                      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{
                          width: `${s.val}%`, height: "100%",
                          background: s.color, borderRadius: 4,
                          transition: "width 0.5s"
                        }} />
                      </div>
                      <div style={{ fontSize: 9, color: s.color, textAlign: "center", marginTop: 1 }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════ TAB: PRONOSTIC ═══════ */}
        {!loading && !error && tab === "pronostic" && (() => {
          const raceDate = raceInfo?.heureDepart ? new Date(raceInfo.heureDepart) : null;
          const dateStr = raceDate
            ? raceDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
            : selectedDate;
          const timeStr = raceDate
            ? raceDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            : null;

          return (
            <div>
              {/* Header */}
              <div style={{
                background: "linear-gradient(135deg, rgba(212,175,55,0.1), rgba(212,175,55,0.03))",
                border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16,
                padding: 20, marginBottom: 20, textAlign: "center"
              }}>
                <p style={{
                  fontSize: 11, color: "#D4AF37", textTransform: "uppercase",
                  letterSpacing: 3, margin: "0 0 10px", fontWeight: 600
                }}>Pronostic Multi-Sources</p>
                <h2 style={{ margin: "0 0 8px", fontFamily: "Playfair Display", fontSize: 20, color: "#F5E6A3" }}>
                  {raceInfo?.libelle || "Quinté+"}
                </h2>
                <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#ccc", marginBottom: 6 }}>
                  <span>📅 {dateStr}</span>
                  {timeStr && <span>🕐 Départ {timeStr}</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#888" }}>
                  <span>📍 {raceInfo?.hippodrome}</span>
                  <span>🏇 {raceInfo?.specialite || "Plat"}</span>
                  <span>📏 {raceInfo?.distance}m</span>
                  <span>💰 {raceInfo?.montantPrix ? `${(raceInfo.montantPrix/1000).toFixed(0)}K€` : "?"}</span>
                  <span>👥 {participants.filter(p => !p.nonPartant).length} partants</span>
                </div>
                <div style={{
                  marginTop: 12, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap"
                }}>
                  {["🏇 PMU", "📊 Stats", "🎵 Forme", "⚙️ Conditions"].map(s => (
                    <span key={s} style={{
                      background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.15)",
                      borderRadius: 20, padding: "3px 10px", fontSize: 10, color: "#D4AF37"
                    }}>{s}</span>
                  ))}
                </div>
              </div>

              {/* Series */}
              {series.map((s, si) => (
                <div key={si} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <p style={{
                      fontSize: 12, color: si === 0 ? "#D4AF37" : "#aaa", textTransform: "uppercase",
                      letterSpacing: 2, margin: 0, fontWeight: 700
                    }}>{s.sourceTag} {s.label}</p>
                    <span style={{ fontSize: 10, color: "#666" }}>{s.desc}</span>
                  </div>

                  <div style={{
                    background: si === 0 ? "rgba(212,175,55,0.04)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${si === 0 ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: 14, padding: 14
                  }}>
                    {/* Compact order */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 12, justifyContent: "center", flexWrap: "wrap" }}>
                      {s.horses.map((p, i) => (
                        <div key={p.numPmu} style={{
                          background: i === 0 ? "linear-gradient(135deg, #D4AF37, #B8860B)" : "rgba(255,255,255,0.08)",
                          borderRadius: 10, padding: "6px 14px",
                          display: "flex", alignItems: "center", gap: 6
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: i === 0 ? "#0a0a0f" : "#888",
                            fontFamily: "JetBrains Mono"
                          }}>{i + 1}.</span>
                          <span style={{
                            fontSize: 15, fontWeight: 800, color: i === 0 ? "#0a0a0f" : "#D4AF37",
                            fontFamily: "JetBrains Mono"
                          }}>{p.numPmu}</span>
                        </div>
                      ))}
                    </div>

                    {/* Detail rows */}
                    {s.horses.map((p, i) => (
                      <div key={p.numPmu} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                        borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none"
                      }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: 6, display: "flex",
                          alignItems: "center", justifyContent: "center", fontSize: 11,
                          fontWeight: 700, fontFamily: "JetBrains Mono",
                          background: i === 0 ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.05)",
                          color: i === 0 ? "#D4AF37" : "#888"
                        }}>{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#e8e6e1", minWidth: 30 }}>N°{p.numPmu}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#ccc", flex: 1 }}>{(p.nom || "").toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: "#888" }}>{getJockey(p)}</span>
                        <span style={{
                          fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 700,
                          color: i === 0 ? "#D4AF37" : "#777"
                        }}>{p.total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Disclaimer */}
              <div style={{
                marginTop: 10, padding: 14, background: "rgba(255,255,255,0.02)",
                borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)"
              }}>
                <p style={{ margin: 0, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
                  ⚠️ Pronostics générés par synthèse de 4 moteurs d'analyse indépendants (PMU/Equidia, Statistique, Forme, Conditions).
                  Chaque série est basée sur une stratégie différente. Ceci ne constitue pas un conseil de jeu.
                </p>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
