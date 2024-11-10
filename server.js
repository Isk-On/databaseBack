require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();
const PORT = 3000;

// Настроим CORS
app.use(cors({
    origin: '*',  // Разрешаем запросы с этого источника
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    preflightContinue: true,  // Включить поддержку preflight запросов
    optionsSuccessStatus: 200,
}));
app.options('*', cors());  // Обработка OPTIONS запросов для всех маршрутов


app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Настройки для подключения к базе данных
const db = mysql.createConnection({
    host: 'mysql.railway.internal',
    user: 'root',
    password: 'LOHGbnmcvNYlMxoRheuCZlZGGGXANkaK',
    database: 'railway'
});

db.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.stack);
        return;
    }
    console.log('Подключение к базе данных успешно');
});

// Регистрация пользователя
app.post('/register', (req, res) => {
    const { username, password } = req.body;

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

// Авторизация пользователя
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

            res.send('Авторизация успешна');
        });
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
