require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

// ============ CONFIGURACIÓN ============

const API_KEY = process.env.API_KEY || "tu-clave-super-secreta-123";
const INGRESO_TOTAL = parseFloat(process.env.INGRESO_TOTAL) || 17000000;
const PUNTUACION_GLOBAL = 1540000; // Puntuación total provincial

// ============ FACTORES DE PONDERACIÓN ============

const FACTORES = {
  categoria: {
    3: 1.50,  // Verde
    2: 1.00,  // Amarilla
    1: 0.75   // Roja
  },
  cv: {
    true: 1.25,
    false: 1.00
  },
  rp: {
    true: 2.00,
    false: 1.00
  }
};

// ============ CONEXIÓN A BD ============

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

// ============ SEGURIDAD ============

function validarApiKey(req, res, next) {
    const apiKey = req.headers["x-api-key"];
    
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ 
            success: false,
            error: "API Key inválida o faltante" 
        });
    }
    
    next();
}

// ============ FUNCIONES DE CÁLCULO ============

/**
 * Calcula el factor (fc) para una combinación
 */
function calcularFactor(categoria, tieneCV, tieneRP) {
  const catFactor = FACTORES.categoria[categoria] || 1.00;
  const cvFactor = FACTORES.cv[tieneCV] || 1.00;
  const rpFactor = FACTORES.rp[tieneRP] || 1.00;
  
  return catFactor * cvFactor * rpFactor;
}

/**
 * Retorna la puntuación global del sistema (constante)
 */
async function calcularPuntuacionGlobal() {
  return PUNTUACION_GLOBAL;
}

/**
 * Calcula el beneficio para pequeños propietarios (<= 50 ha)
 * Basado en % de bosque nativo y agrupamiento por factor
 */
async function calcularBeneficioPequenos(porcBN, superficieBN) {
  try {
    console.log(`[PEQUEÑOS] Iniciando cálculo para porcBN=${porcBN}%, supBN=${superficieBN}ha`);
    
    // Obtener todas las parcelas pequeñas (≤ 50 ha)
    const resultado = await pool.query(`
      SELECT area_m2, p_porc_bn, p_cat1, p_cat2, p_cat3, cv, rp
      FROM "Polinomica_si_final_octCorregida"
      WHERE (area_m2 / 10000) <= 50
    `);
    
    console.log(`[PEQUEÑOS] Total parcelas pequeñas encontradas: ${resultado.rows.length}`);
    
    // Agrupar por factor según % de BN
    let supFc0 = 0;  // ≤ 50% BN → factor 0
    let supFc1 = 0;  // 50-75% BN → factor 1
    let supFc125 = 0; // > 75% BN → factor 1.25
    
    resultado.rows.forEach(parcela => {
      const porcBNParcela = parseFloat(parcela.p_porc_bn) || 0;
      const cat1 = parseFloat(parcela.p_cat1) || 0;
      const cat2 = parseFloat(parcela.p_cat2) || 0;
      const cat3 = parseFloat(parcela.p_cat3) || 0;
      
      const supBN = cat1 + cat2 + cat3;
      
      if (porcBNParcela > 75) {
        supFc125 += supBN;
      } else if (porcBNParcela > 50) {
        supFc1 += supBN;
      } else {
        supFc0 += supBN;
      }
    });
    
    console.log(`[PEQUEÑOS] supFc0=${supFc0}, supFc1=${supFc1}, supFc125=${supFc125}`);
    
    // Calcular denominador ponderado
    const denominador = supFc0 * 0 + supFc1 * 1 + supFc125 * 1.25;
    
    console.log(`[PEQUEÑOS] Denominador ponderado: ${denominador}`);
    
    if (denominador <= 0) {
      console.log(`[PEQUEÑOS] Denominador es 0, retornando beneficio 0`);
      return 0;
    }
    
    // IMB pequeños
    const ingreso10 = INGRESO_TOTAL * 0.10;
    const imbPequenos = ingreso10 / denominador;
    
    console.log(`[PEQUEÑOS] Ingreso 10%: ${ingreso10}, IMB: ${imbPequenos}`);
    
    // Determinar factor de esta parcela según su % de BN
    let factorParcela = 0;
    if (porcBN > 75) {
      factorParcela = 1.25;
    } else if (porcBN > 50) {
      factorParcela = 1;
    } else {
      factorParcela = 0;
    }
    
    console.log(`[PEQUEÑOS] porcBN=${porcBN}% → factorParcela=${factorParcela}`);
    
    // Beneficio = superficie BN * IMB * factor
    const beneficio = superficieBN * imbPequenos * factorParcela;
    
    console.log(`[PEQUEÑOS] Beneficio final: ${superficieBN} * ${imbPequenos} * ${factorParcela} = ${beneficio}`);
    
    return beneficio;
    
  } catch (error) {
    console.error("Error calculando beneficio pequeños:", error);
    return 0;
  }
}

/**
 * Calcula beneficio completo para una parcela
 */
async function calcularBeneficioParcela(parcela, puntuacionGlobal) {
  
  const cca = parcela.cca || 'N/A';
  const area_m2 = parseFloat(parcela.area_m2) || 0;
  const area_ha = area_m2 / 10000;
  
  const p_cat1 = parseFloat(parcela.p_cat1) || 0;
  const p_cat2 = parseFloat(parcela.p_cat2) || 0;
  const p_cat3 = parseFloat(parcela.p_cat3) || 0;
  const cv = parcela.cv === true;
  const rp = parcela.rp === true;
  const p_porc_bn = parseFloat(parcela.p_porc_bn) || 0;
  
  const esPequeno = area_ha <= 50;
  
  // ========== DISTRIBUCIÓN ==========
  
  const ingreso80 = INGRESO_TOTAL * 0.80;
  const ingreso10 = INGRESO_TOTAL * 0.10;
  const ingreso10reserva = INGRESO_TOTAL * 0.10;
  
  // ========== PAGO POR PUNTO ==========
  
  const pagoPorPunto = ingreso80 / puntuacionGlobal;
  
  // ========== CALCULAR DETALLES POR CATEGORÍA ==========
  
  let detallesCategorias = [];
  let puntuacionParcela = 0;
  let beneficio80Total = 0;
  
  // Categoría 1
  if (p_cat1 > 0) {
    const factor1 = calcularFactor(1, cv, rp);
    const puntuacion1 = p_cat1 * factor1;
    const imb1 = pagoPorPunto * factor1;
    const beneficio1 = p_cat1 * imb1;
    
    puntuacionParcela += puntuacion1;
    beneficio80Total += beneficio1;
    
    detallesCategorias.push({
      categoria: 1,
      superficie_ha: parseFloat(p_cat1.toFixed(2)),
      factor: parseFloat(factor1.toFixed(4)),
      puntuacion: parseFloat(puntuacion1.toFixed(2)),
      imb: parseFloat(imb1.toFixed(2)),
      beneficio: parseFloat(beneficio1.toFixed(2))
    });
  }
  
  // Categoría 2
  if (p_cat2 > 0) {
    const factor2 = calcularFactor(2, cv, rp);
    const puntuacion2 = p_cat2 * factor2;
    const imb2 = pagoPorPunto * factor2;
    const beneficio2 = p_cat2 * imb2;
    
    puntuacionParcela += puntuacion2;
    beneficio80Total += beneficio2;
    
    detallesCategorias.push({
      categoria: 2,
      superficie_ha: parseFloat(p_cat2.toFixed(2)),
      factor: parseFloat(factor2.toFixed(4)),
      puntuacion: parseFloat(puntuacion2.toFixed(2)),
      imb: parseFloat(imb2.toFixed(2)),
      beneficio: parseFloat(beneficio2.toFixed(2))
    });
  }
  
  // Categoría 3
  if (p_cat3 > 0) {
    const factor3 = calcularFactor(3, cv, rp);
    const puntuacion3 = p_cat3 * factor3;
    const imb3 = pagoPorPunto * factor3;
    const beneficio3 = p_cat3 * imb3;
    
    puntuacionParcela += puntuacion3;
    beneficio80Total += beneficio3;
    
    detallesCategorias.push({
      categoria: 3,
      superficie_ha: parseFloat(p_cat3.toFixed(2)),
      factor: parseFloat(factor3.toFixed(4)),
      puntuacion: parseFloat(puntuacion3.toFixed(2)),
      imb: parseFloat(imb3.toFixed(2)),
      beneficio: parseFloat(beneficio3.toFixed(2))
    });
  }
  
  // ========== BENEFICIO CUENTA 2.2 (PEQUEÑOS) ==========
  
  let beneficio10 = 0;
  if (esPequeno) {
    // Calcular superficie total de BN
    const superficieBN = p_cat1 + p_cat2 + p_cat3;
    // Llamar a función que calcula correctamente según agrupamiento
    beneficio10 = await calcularBeneficioPequenos(p_porc_bn, superficieBN);
    console.log(`DEBUG: Parcela ${cca} - porcBN: ${p_porc_bn}%, supBN: ${superficieBN}, beneficio10: ${beneficio10}`);
  }
  
  // ========== BENEFICIO TOTAL ==========
  
  const beneficioTotal = beneficio80Total + beneficio10;
  
  return {
    nomenclaturaCatastral: cca,
    
    superficies: {
      total_ha: parseFloat(area_ha.toFixed(2)),
      total_m2: parseFloat(area_m2.toFixed(2)),
      categoria1_ha: parseFloat(p_cat1.toFixed(2)),
      categoria2_ha: parseFloat(p_cat2.toFixed(2)),
      categoria3_ha: parseFloat(p_cat3.toFixed(2))
    },
    
    atributos: {
      tieneCV: cv,
      tieneRP: rp,
      porcentajeBN: parseFloat(p_porc_bn.toFixed(2)),
      esPequenoPropietario: esPequeno
    },
    
    distribucion: {
      ingresoTotal: parseFloat(INGRESO_TOTAL.toFixed(2)),
      ingreso80Pct: parseFloat(ingreso80.toFixed(2)),
      ingreso10Pct_Pequenos: parseFloat(ingreso10.toFixed(2)),
      ingreso10Pct_Reserva: parseFloat(ingreso10reserva.toFixed(2))
    },
    
    calculos: {
      puntuacionGlobal: parseFloat(puntuacionGlobal.toFixed(2)),
      puntuacionParcela: parseFloat(puntuacionParcela.toFixed(2)),
      pagoPorPunto: parseFloat(pagoPorPunto.toFixed(4))
    },
    
    beneficio: {
      beneficioPor80Pct: parseFloat(beneficio80Total.toFixed(2)),
      beneficioPor10Pct_Pequenos: parseFloat(beneficio10.toFixed(2)),
      beneficioTotal: parseFloat(beneficioTotal.toFixed(2))
    },
    
    detallesPorCategoria: detallesCategorias
  };
}

// ============ ENDPOINTS ============

app.get("/", (req, res) => {
    res.json({
        mensaje: "API Simulador JNR - Distribución de Beneficios",
        version: "2.0",
        ingresoTotal: INGRESO_TOTAL,
        endpoints: [
            "GET /tabla - Obtiene tabla completa",
            "POST /calcular - Calcula una parcela"
        ]
    });
});

app.get("/tabla", validarApiKey, async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT cca, p_cat1, p_cat2, p_cat3, cv, rp, area_m2, p_porc_bn 
            FROM "Polinomica_si_final_octCorregida" 
            ORDER BY cca
        `);

        res.json({
            success: true,
            total: resultado.rows.length,
            registros: resultado.rows
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/calcular", validarApiKey, async (req, res) => {
    try {
        const { nomenclaturaCatastral } = req.body;

        if (!nomenclaturaCatastral) {
            return res.status(400).json({ 
                success: false,
                error: "nomenclaturaCatastral requerida" 
            });
        }

        // Buscar parcela
        const resultado = await pool.query(`
            SELECT cca, p_cat1, p_cat2, p_cat3, cv, rp, area_m2, p_porc_bn
            FROM "Polinomica_si_final_octCorregida"
            WHERE cca = $1 LIMIT 1
        `, [nomenclaturaCatastral]);

        if (resultado.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: `Parcela '${nomenclaturaCatastral}' no encontrada` 
            });
        }

        const parcela = resultado.rows[0];
        
        // Calcular puntuación global
        const puntuacionGlobal = await calcularPuntuacionGlobal();
        
        // Calcular beneficio
        const beneficio = await calcularBeneficioParcela(parcela, puntuacionGlobal);

        res.json({
            success: true,
            beneficio: beneficio,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
╔═════════════════════════════════════╗
║  API Cálculos JNR v2.0              ║
║  🚀 Puerto ${PORT}                    ║
║  💰 Ingreso: $${(INGRESO_TOTAL/1000000).toFixed(1)}M        ║
║  📊 Distribución: 80/10/10          ║
╚═════════════════════════════════════╝
    `);
});

module.exports = app;