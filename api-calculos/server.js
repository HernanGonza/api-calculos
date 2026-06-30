require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

// ============ CONEXIÓN A BD ============

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

// ============ HOME ============

app.get("/", (req, res) => {
    res.json({
        mensaje: "API Simulador funcionando",
        endpoints: [
            "GET /tabla - Obtiene tabla completa",
            "POST /calcular/:caso - Calcula por caso"
        ]
    });
});

// ============ ENDPOINT 1: OBTENER TABLA COMPLETA ============

/**
 * GET /tabla
 * 
 * Devuelve: TODA la tabla sin filtros
 * Para: Earth Engine consume esta tabla
 */
app.get("/tabla", async (req, res) => {
    try {
        const consulta = `
            SELECT *
            FROM "Polinomica_si_final_octCorregida"
        `;

        const resultado = await pool.query(consulta);

        res.json({
            success: true,
            total: resultado.rows.length,
            registros: resultado.rows
        });

    } catch (error) {
        console.error("Error en /tabla:", error);
        res.status(500).json({
            error: "Error al obtener tabla",
            message: error.message
        });
    }
});

// ============ ENDPOINT 2: CALCULAR POR CASO ============

/**
 * POST /calcular/:caso
 * 
 * Recibe: caso (1-10)
 * Devuelve: Cálculo para todas las parcelas según ese caso
 */
app.post("/calcular/:caso", async (req, res) => {
    try {
        const { caso } = req.params;

        // Validar caso
        if (!caso || caso < 1 || caso > 10) {
            return res.status(400).json({ 
                error: "Caso debe ser entre 1 y 10" 
            });
        }

        const consulta = `
            SELECT *
            FROM "Polinomica_si_final_octCorregida"
        `;

        const resultado = await pool.query(consulta);
        const registros = resultado.rows;

        // Calcular para cada registro según el caso
        const calculados = registros.map(registro => {
            return {
                id: registro.id || registro.cca,
                calculo: calcularSegunCaso(registro, parseInt(caso))
            };
        });

        res.json({
            success: true,
            caso: parseInt(caso),
            cantidad: calculados.length,
            datos: calculados
        });

    } catch (error) {
        console.error("Error en /calcular:", error);
        res.status(500).json({
            error: "Error en cálculo",
            message: error.message
        });
    }
});

// ============ HEALTH CHECK ============

app.get("/health", (req, res) => {
    res.json({ 
        status: "OK",
        timestamp: new Date().toISOString()
    });
});

// ============ FUNCIÓN DE CÁLCULO ============

/**
 * Calcula según el caso (1-10)
 * TODO: AQUÍ VAN LAS FÓRMULAS DE LOS 10 CASOS
 */
function calcularSegunCaso(registro, caso) {
    
    // Por ahora: valores de ejemplo
    // Después reemplazar con las fórmulas reales
    
    return {
        beneficio_base: 13600000,
        beneficio_total: 20400000,
        tasa_anual: 7.5,
        cuota_mensual: 405000,
        caso: caso
    };
}

// ============ INICIAR SERVIDOR ============

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════╗
║   API de Cálculos              ║
║   🚀 Puerto ${PORT}              ║
╚════════════════════════════════╝
    `);
    console.log("Endpoints:");
    console.log("  GET    /tabla");
    console.log("  POST   /calcular/:caso");
    console.log("  GET    /health");
});