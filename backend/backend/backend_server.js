require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./backend_database");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado.");
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Você precisa entrar na sua conta."
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Sessão inválida ou expirada."
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Acesso exclusivo para administradores."
    });
  }

  next();
}

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.json({
      status: "online",
      database: "connected"
    });
  } catch (error) {
    console.error(error);

    res.status(503).json({
      status: "offline",
      database: "disconnected"
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        error: "Informe nome, email e senha com pelo menos 8 caracteres."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        error: "Este email já está cadastrado."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name.trim(), normalizedEmail, hash]
    );

    const user = result.rows[0];

    await db.query(
      "INSERT INTO user_data (user_id) VALUES ($1)",
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({ user, token });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Não foi possível criar a conta."
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [String(email || "").trim().toLowerCase()]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({
        error: "Email ou senha incorretos."
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      token
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao entrar na conta." });
  }
});

app.get("/api/user/data", authenticate, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT data FROM user_data WHERE user_id = $1",
      [req.user.id]
    );

    res.json(result.rows[0]?.data || {});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao consultar dados." });
  }
});

app.put("/api/user/data", authenticate, async (req, res) => {
  try {
    const data = req.body;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "Dados inválidos." });
    }

    const result = await db.query(
      `INSERT INTO user_data (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING data`,
      [req.user.id, JSON.stringify(data)]
    );

    res.json(result.rows[0].data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao salvar dados." });
  }
});

app.get("/api/articles", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, description, content, created_at
       FROM articles
       WHERE published = TRUE
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar artigos." });
  }
});

app.post("/api/articles", authenticate, adminOnly, async (req, res) => {
  try {
    const { title, description, content, published } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        error: "Título e conteúdo são obrigatórios."
      });
    }

    const result = await db.query(
      `INSERT INTO articles
       (title, description, content, published, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description || "", content, published === true, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao criar artigo." });
  }
});

app.get("/api/missions", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, description, points, created_at
       FROM missions
       WHERE published = TRUE
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar missões." });
  }
});

app.post("/api/missions", authenticate, adminOnly, async (req, res) => {
  try {
    const { title, description, points, published } = req.body;

    if (!title || !Number.isInteger(points) || points < 0) {
      return res.status(400).json({
        error: "Informe título e pontuação válida."
      });
    }

    const result = await db.query(
      `INSERT INTO missions
       (title, description, points, published, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description || "", points, published === true, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao criar missão." });
  }
});

db.initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Erro ao iniciar o banco de dados:", error);
    process.exit(1);
  });
