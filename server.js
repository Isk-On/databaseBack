require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = "lox"

// Настройка CORS
app.use(cors({
    origin: 'https://isk-on.github.io', // Разрешаем доступ только с этого домена
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'], // Разрешаем заголовок Authorization
    preflightContinue: false,
    optionsSuccessStatus: 200,
}));

app.options('*', (req, res) => {
    res.sendStatus(200);
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Настройки для подключения к базе данных
const db = mysql.createConnection({
    host: 'mysql.railway.internal',  // Укажите хост (или railway.internal для Railway)
    user: 'root',       // Имя пользователя
    password: 'uuhGLTdVGbFyrlAuhTpdKTeVxSWYpSCQ',  // Ваш пароль
    database: 'railway'  // Название вашей базы данных
});

db.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.stack);
        return;
    }
    console.log('Подключение к базе данных успешно');
});

// Роут для регистрации
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    // Проверка, существует ли пользователь с таким именем
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    db.query(checkUserQuery, [username], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка сервера');
        }
        if (result.length > 0) {
            return res.status(400).send('Пользователь с таким именем уже существует');
        }

        // Хеширование пароля
        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Ошибка сервера');
            }

            // Сохранение пользователя в базе данных
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

            // Создание JWT токена с использованием секрета из .env файла
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

// Роут для добавления сообщений
app.post('/postMessage', authenticate, (req, res) => {
    const { message } = req.body;

    // Вставка сообщения в таблицу wall_messages
    const query = 'INSERT INTO wall_messages (user_id, message) VALUES (?, ?)';
    db.query(query, [req.userId, message], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Ошибка при добавлении сообщения');
        }
        res.send('Сообщение успешно добавлено');
    });
});

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
        res.json(results);  // Отправляем список сообщений с именами пользователей
    });
});


// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
