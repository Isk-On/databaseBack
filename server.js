require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = "lox";

const directories = ['data', 'data/avatars'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Папка ${dir} создана`);
    }
});

app.use(cors({
    origin: process.env.ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
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

const storagePhoto = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './data/'); // Папка для сохранения изображений
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Уникальное имя файла
    }
});

const storageAvatar = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './data/avatars/'); // Папка для сохранения изображений
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Уникальное имя файла
    }
});

const upload = multer({ storage: storagePhoto });
const uploadAvatar = multer({ storage: storageAvatar });

// Роут для регистрации
app.post('/register', uploadAvatar.single('avatar'), (req, res) => {
    const { username, password } = req.body;
    const avatarPath = req.file ? req.file.path : `data/avatars/anonymous.png`;

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

            const query = 'INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)';
            db.query(query, [username, hashedPassword, avatarPath], (err, result) => {
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

// Обработка загрузки изображения и сообщения
app.post('/postMessageWithImage', authenticate, upload.single('image'), (req, res) => {
    const { message } = req.body;
    const imagePath = req.file ? req.file.path : null;

    const query = 'INSERT INTO wall_messages (user_id, message, image) VALUES (?, ?, ?)';
    db.query(query, [req.userId, message, imagePath], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при добавлении сообщения');
        }

        sendEventToClients();
        res.send('Сообщение успешно добавлено');
    });
});

// Роут для получения сообщений с изображениями
app.get('/getMessages', (req, res) => {
    const query = `
        SELECT wall_messages.message, wall_messages.image, users.username, users.avatar, wall_messages.created_at
        FROM wall_messages
        JOIN users ON wall_messages.user_id = users.id
        ORDER BY wall_messages.created_at ASC
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при получении сообщений');
        }
        
        // Возвращаем URL для отображения изображения
        const messagesWithUrls = results.map(msg => ({
            ...msg,
            image: msg.image ? `${process.env.MY_BASE}/${msg.image}` : null,
            avatar: msg.avatar ? `${process.env.MY_BASE}/${msg.avatar}` : null // Добавляем URL для аватара
        }));
        
        res.json(messagesWithUrls);
    });
});

app.use('/data', express.static('data'));
app.use('/avatars', express.static('data/avatars'));

app.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
