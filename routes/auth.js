// Importamos express para definir rutas
import express from 'express'; 

// Importamos bcrypt para hashear contraseñas
import bcrypt from 'bcrypt';

// Importamos jsonwebtoken para generar y verificar JWTs
import jwt from 'jsonwebtoken';

// Importamos speakeasy para la autenticación en dos pasos (TOTP)
import speakeasy from 'speakeasy';

// Importamos qrcode para generar imágenes QR a partir de las claves TOTP
import qrcode from 'qrcode';

// Importamos la conexión a la base de datos
import pool from '../db.js';

// Importamos qrcode-terminal para mostrar el QR en consola (útil en pruebas)
import qrterminal from 'qrcode-terminal';

// Importamos axios para enviar notificaciones HTTP
import axios from 'axios'; 

// Creamos el router de Express
const router = express.Router();

// Definimos el número de rondas de hashing para bcrypt
const saltRounds = 10;

// ==========================
// 📌 RUTA DE REGISTRO
// ==========================
router.post('/register', async (req, res) => {
  // Paso 1: extraer username y password desde encabezado Authorization (Basic Auth)
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Basic ')) {
    return res.status(400).json({ error: 'Faltan credenciales en Authorization' });
  }

  const base64Credentials = authorization.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (!username || !password) {
    return res.status(400).json({ error: 'Faltan username o password' });
  }

  // Paso 2: obtener el resto de los datos del body
  const { email, rol_id, bio, foto_url, web_personal } = req.body;

  if (!email || !rol_id) {
    return res.status(400).json({ error: 'Faltan email o rol_id en el body' });
  }

  try {
    // Verificamos que el username o email no estén ya registrados
    const [existingUser] = await pool.query(
      'SELECT id FROM usuarios WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Usuario o email ya existe' });
    }

    // Hasheamos la contraseña
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generamos clave secreta TOTP
    const secret = speakeasy.generateSecret({ length: 20 });

    // Insertamos el nuevo usuario
    const [result] = await pool.query(
      `INSERT INTO usuarios 
        (username, email, password_hash, rol_id, totp_secret, bio, foto_url, web_personal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, hashedPassword, rol_id, secret.base32, bio || null, foto_url || null, web_personal || null]
    );

    const usuario_id = result.insertId;

    // Generamos URL de configuración para Authenticator
    const otpAuthUrl = speakeasy.otpauthURL({
      secret: secret.ascii,
      label: `SistemaEventos (${username})`,
      issuer: 'SistemaEventos',
      encoding: 'ascii'
    });

    const qrBuffer = await qrcode.toBuffer(otpAuthUrl);

    const mensajeHTML = `
      <p>¡Hola <strong>${username}</strong>! 🎉</p>
      <p>Gracias por registrarte en <strong>SistemaEventos</strong>.</p>
      <p>Escaneá este código QR para configurar la autenticación en dos pasos:</p>
      <img src="cid:qrTotp" alt="Código QR" />
      <p>O ingresá manualmente: <code>${secret.base32}</code></p>
    `;

    try {
      await axios.post('http://localhost:3000/notificaciones', {
        usuario_id,
        tipo: 'Registro de Usuario',
        mensaje: mensajeHTML,
        esHTML: true,
        adjunto: {
          filename: 'qr-totp.png',
          content: qrBuffer.toString('base64'),
          encoding: 'base64',
          cid: 'qrTotp'
        }
      });
    } catch (error) {
      console.error('❌ Error enviando notificación:', error.message);
    }

    qrterminal.generate(otpAuthUrl, { small: true });

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      totpSecret: secret.base32
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ==========================
// 📌 RUTA DE LOGIN
// ==========================
router.post('/login', async (req, res) => {
  const authorization = req.headers.authorization;
  const { token } = req.body;
  if (!authorization || !authorization.startsWith('Basic ')) {
    return res.status(400).json({ error: 'Faltan credenciales en Authorization' });
  }

  const base64Credentials = authorization.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (!username || !password || !token) {
    return res.status(400).json({ error: 'Faltan datos' });
  }


  try {
    // Buscamos al usuario por nombre de usuario
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);

    // Si no se encuentra el usuario, devolvemos error
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = rows[0];

    // Verificamos la contraseña comparando con el hash
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Verificamos el código TOTP proporcionado
    const tokenValid = speakeasy.totp.verify({
      secret: user.totp_secret, // Clave secreta del usuario
      encoding: 'base32',
      token,                    // Código ingresado por el usuario
      window: 1                 // Margen de error de 1 intervalo (30 segundos antes/después)
    });

    // Si el código no es válido, devolvemos error
    if (!tokenValid) {
      return res.status(401).json({ error: 'Token TOTP inválido' });
    }

    // Creamos el payload con datos del usuario
    const payload = { id: user.id, username: user.username, rol_id: user.rol_id };

    // Generamos un access token con duración de 15 minutos
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

    // Generamos un refresh token con duración de 1 días
    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' }); 

    // (Opcional) Guardar el refresh token en base de datos para revocarlo después si es necesario

    // Respondemos con ambos tokens
    res.json({ accessToken, refreshToken });

  } catch (error) {
    // Error general del servidor
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Exportamos el router para poder usarlo en otros archivos
export default router;
