// Importamos Express para crear rutas
import express from 'express';

// Conexión con la base de datos
import pool from '../db.js';

// Nodemailer para enviar correos electrónicos
import nodemailer from 'nodemailer';

// Creamos una instancia del router de Express
const router = express.Router();

// ==============================
// 📬 Configuración de Nodemailer
// ==============================

// Creamos un transporter usando las variables de entorno
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,      // Servidor SMTP
  port: process.env.EMAIL_PORT,      // Puerto SMTP (ej: 587)
  secure: false,                     // No usamos SSL (true si es puerto 465)
  auth: {
    user: process.env.EMAIL_USER,    // Usuario de email (ej: sistema@evento.com)
    pass: process.env.EMAIL_PASS     // Contraseña o token de la cuenta
  }
});

// ===================================
// 📩 Ruta POST para enviar notificación
// ===================================
router.post('/', async (req, res) => {
  // Extraemos los datos del cuerpo de la solicitud
  const { usuario_id, tipo, mensaje, esHTML } = req.body;

  // Validamos que los campos necesarios estén presentes
  if (!usuario_id || !tipo || !mensaje) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    // Buscamos el email del usuario en la base de datos
    const [usuarios] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuario_id]);

    // Si no se encuentra el usuario, devolvemos error
    if (usuarios.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const email = usuarios[0].email;

    // ================================
    // ✉️ Preparar el contenido del mail
    // ================================

    const mailOptions = {
      from: `"Sistema de Eventos" <${process.env.EMAIL_USER}>`, // Remitente
      to: email,                                                 // Destinatario
      subject: `📢 Notificación: ${tipo}`,                        // Asunto del correo
      ...(esHTML ? { html: mensaje } : { text: mensaje }),       // HTML o texto plano

      // Adjuntos si vienen en la petición (ej: QR en base64)
      ...(req.body.adjunto
        ? {
            attachments: [
              {
                filename: req.body.adjunto.filename,
                content: Buffer.from(req.body.adjunto.content, 'base64'),
                encoding: req.body.adjunto.encoding,
                cid: req.body.adjunto.cid                    // Identificador para embebido en HTML
              }
            ]
          }
        : {})
    };

    // =============================
    // 📤 Enviamos el correo
    // =============================
    await transporter.sendMail(mailOptions);

    // =============================
    // 🗃️ Guardamos la notificación en la BD
    // =============================
    await pool.query(`
      INSERT INTO notificaciones (usuario_id, tipo, mensaje, enviado, fecha_envio)
      VALUES (?, ?, ?, true, NOW())
    `, [usuario_id, tipo, mensaje]);

    // Respondemos que todo fue exitoso
    res.status(200).json({ message: 'Notificación enviada con éxito' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la notificación' });
  }
});

// Exportamos el router para usarlo en la aplicación principal
export default router;
