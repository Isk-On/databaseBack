require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = "lox";

const directories = ["data", "data/avatars"];
directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Папка ${dir} создана`);
  }
});

app.use(
  cors({
    origin: process.env.ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const promisePool = pool.promise();

const clients = [];

function sendEventToClients() {
  clients.forEach((res) => {
    res.write(`data: update\n\n`);
  });
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.push(res);

  req.on("close", () => {
    clients.splice(clients.indexOf(res), 1);
  });
});

const storagePhoto = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./data/"); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const storageAvatar = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./data/avatars/"); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storagePhoto });
const uploadAvatar = multer({ storage: storageAvatar });

app.post("/register", uploadAvatar.single("avatar"), async (req, res) => {
  const { username, password } = req.body;
  const avatarPath = req.file ? req.file.path : null;

  try {
    const [rows] = await promisePool.query("SELECT * FROM users WHERE username = ?", [username]);
    if (rows.length > 0) {
      return res.status(400).send("Пользователь с таким именем уже существует");
    }

    bcrypt.hash(password, 10, async (err, hashedPassword) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Ошибка сервера");
      }

      const query =
        "INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)";
      const [result] = await promisePool.query(query, [username, hashedPassword, avatarPath]);

      const token = jwt.sign({ userId: result.insertId }, JWT_SECRET, {
        expiresIn: '1h',
      });

      res.json({ message: "Пользователь зарегистрирован", token });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка сервера");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [result] = await promisePool.query("SELECT * FROM users WHERE username = ?", [username]);

    if (result.length === 0) {
      return res.status(400).send("Пользователь не найден");
    }

    const user = result[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).send("Неверный пароль");
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при авторизации");
  }
});

function authenticate(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(401).send("Отсутствует токен");
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send("Неверный или истекший токен");
    }
    req.userId = decoded.userId;
    next();
  });
}

app.post(
  "/postMessageWithImage",
  authenticate,
  upload.single("image"),
  async (req, res) => {
    const { message } = req.body;
    const imagePath = req.file ? req.file.path : null;

    const query =
      "INSERT INTO wall_messages (user_id, message, image) VALUES (?, ?, ?)";
    try {
      const [result] = await promisePool.query(query, [req.userId, message, imagePath]);
      sendEventToClients(); 
      res.send("Сообщение успешно добавлено");
    } catch (err) {
      console.error(err);
      res.status(500).send("Ошибка при добавлении сообщения");
    }
  }
);

app.get("/getMessages", async (req, res) => {
  const query = `
    SELECT wall_messages.message, wall_messages.image, users.username, users.avatar, wall_messages.created_at
    FROM wall_messages
    JOIN users ON wall_messages.user_id = users.id
    ORDER BY wall_messages.created_at ASC
  `;

  try {
    const [results] = await promisePool.query(query);

    const messagesWithUrls = results.map((msg) => ({
      ...msg,
      image: msg.image ? `${process.env.MY_BASE}/${msg.image}` : null,
      avatar: msg.avatar ? `${process.env.MY_BASE}/${msg.avatar}` : null,
    }));

    res.json(messagesWithUrls);
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при получении сообщений");
  }
});

app.use("/data", express.static("data"));
app.use("/avatars", express.static("data/avatars"));

app.listen(PORT, () => {
  console.log(`Сервер работает на порту ${PORT}`);
});
