require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = "lox";

// app.use(cors({
//     origin: 'http://127.0.0.1:5500',
//     methods: ['GET', 'POST', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization'],
// }));

app.use(cors({
    origin: 'https://isk-on.github.io',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const db = mysql.createConnection({
    host: 'mysql.railway.internal',
    user: 'root',
    password: 'uuhGLTdVGbFyrlAuhTpdKTeVxSWYpSCQ',
    database: 'railway'
});

db.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.stack);
        return;
    }
    console.log('Подключение к базе данных успешно');
});

// Хранилище для подключений SSE
const clients = [];

// Функция для отправки события всем клиентам
function sendEventToClients() {
    clients.forEach(res => {
        res.write(`data: update\n\n`);
    });
}

// Роут для регистрации клиентов на получение событий через SSE
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);

    // Удаление клиента при разрыве соединения
    req.on('close', () => {
        clients.splice(clients.indexOf(res), 1);
    });
});

// Роут для регистрации
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    db.query(checkUserQuery, [username], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка сервера');
        }
        if (result.length > 0) {
            return res.status(400).send('Пользователь с таким именем уже существует');
        }

        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Ошибка сервера');
            }

            const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
            db.query(query, [username, hashedPassword], (err, result) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Ошибка при регистрации');
                }
                res.send('Пользователь зарегистрирован');
            });
        });
    });
});

// Роут для авторизации
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при авторизации');
        }

        if (result.length === 0) {
            return res.status(400).send('Пользователь не найден');
        }

        const user = result[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Ошибка при авторизации');
            }

            if (!isMatch) {
                return res.status(400).send('Неверный пароль');
            }

            const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        });
    });
});

// Мидлвар для проверки токена
function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).send('Отсутствует токен');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send('Неверный или истекший токен');
        }
        req.userId = decoded.userId;
        next();
    });
}

// Роут для отправки сообщения
app.post('/postMessage', authenticate, (req, res) => {
    const { message } = req.body;
    const query = 'INSERT INTO wall_messages (user_id, message) VALUES (?, ?)';
    db.query(query, [req.userId, message], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при добавлении сообщения');
        }

        sendEventToClients(); // Уведомить клиентов о новом сообщении
        res.send('Сообщение успешно добавлено');
    });
});

// Роут для получения сообщений
app.get('/getMessages', (req, res) => {
    const query = `
        SELECT wall_messages.message, users.username, wall_messages.created_at
        FROM wall_messages
        JOIN users ON wall_messages.user_id = users.id
        ORDER BY wall_messages.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при получении сообщений');
        }
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
