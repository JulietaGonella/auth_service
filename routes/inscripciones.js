// Importamos Express para crear rutas
import express from 'express';

// Conexión a la base de datos
import pool from '../db.js';

// Módulo para generar códigos QR
import QRCode from 'qrcode';

// Axios se usa para enviar notificaciones al microservicio
import axios from 'axios';

// Middlewares: uno para validar el token y otro para asegurar que el usuario es asistente
import { verifyToken, requireAsistente, requireAdminOrOrganizer  } from '../middlewares/authMiddleware.js';

// Creamos el router
const router = express.Router();

// =====================================================
// 🔹 1. Ruta POST para inscribirse a un evento
// =====================================================
router.post('/', verifyToken, requireAsistente, async (req, res) => {
  // Extraemos los datos del cuerpo de la petición
  const { evento_id, tipo_inscripcion, tarifa } = req.body;

  // Obtenemos el ID del usuario autenticado (desde el token)
  const usuario_id = req.user.id;

  try {
    // 🔍 Verificamos que el evento exista y no esté cancelado
    const [eventos] = await pool.query('SELECT estado FROM eventos WHERE id = ?', [evento_id]);
    if (eventos.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (eventos[0].estado === 'cancelado') {
      return res.status(400).json({ error: 'No se puede inscribir a un evento cancelado' });
    }

    // 📦 Generamos los datos del QR (solo texto con IDs)
    const qrData = `Usuario:${usuario_id}-Evento:${evento_id}`;
    console.log('\n📌 QR de la inscripción al evento:');
    const qrCodeText = await QRCode.toString(qrData); // QR en forma de string de consola
    console.log(qrCodeText);

    // 🖼️ Generamos el código QR como buffer (imagen binaria)
    const qrBuffer = await QRCode.toBuffer(qrData);

    // Generamos el QR en formato DataURL (útil para mostrar en HTML)
    const qrCodeDataURL = await QRCode.toDataURL(qrData);

    // 📝 Insertamos la inscripción en la base de datos
    const [result] = await pool.query(
      `INSERT INTO inscripciones (usuario_id, evento_id, tipo_inscripcion, tarifa, codigo_qr)
       VALUES (?, ?, ?, ?, ?)`,
      [usuario_id, evento_id, tipo_inscripcion, tarifa, qrCodeDataURL]
    );

    // Obtenemos email del usuario y detalles del evento
    const [usuarioRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuario_id]);
    const [eventoRows] = await pool.query('SELECT nombre, fecha_inicio FROM eventos WHERE id = ?', [evento_id]);

    let horaPrimeraActividad = null;

    if (eventoRows.length > 0) {
      const evento = eventoRows[0];

      // 🕒 Obtenemos la primera hora de actividad del evento para esa fecha
      const [actividades] = await pool.query(
        `SELECT hora_inicio FROM actividades 
         WHERE evento_id = ? AND fecha = ? 
         ORDER BY hora_inicio ASC LIMIT 1`,
        [evento_id, evento.fecha_inicio]
      );

      if (actividades.length > 0) {
        horaPrimeraActividad = actividades[0].hora_inicio;
      }

      // 📅 Formateamos la fecha de inicio
      const fechaInicio = new Date(evento.fecha_inicio);
      const fechaFormateada = `${String(fechaInicio.getDate()).padStart(2,'0')}/${String(fechaInicio.getMonth()+1).padStart(2,'0')}/${fechaInicio.getFullYear()}`;

      const nombreEvento = evento.nombre;

      // 📋 Obtenemos el cronograma completo del evento
      const [cronograma] = await pool.query(
        `SELECT titulo, descripcion, sala, fecha, hora_inicio, hora_fin
         FROM actividades
         WHERE evento_id = ?
         ORDER BY fecha ASC, hora_inicio ASC`,
        [evento_id]
      );

      // 📄 Generamos una tabla HTML con el cronograma de actividades
      let cronogramaHTML = '<p><strong>Cronograma de Actividades:</strong></p><table border="1" cellpadding="5" cellspacing="0"><tr><th>Título</th><th>Descripción</th><th>Sala</th><th>Fecha</th><th>Inicio</th><th>Fin</th></tr>';

      for (const actividad of cronograma) {
        const fechaAct = new Date(actividad.fecha);
        const fechaFormato = `${String(fechaAct.getDate()).padStart(2, '0')}/${String(fechaAct.getMonth() + 1).padStart(2, '0')}/${fechaAct.getFullYear()}`;
        cronogramaHTML += `
          <tr>
            <td>${actividad.titulo}</td>
            <td>${actividad.descripcion || '-'}</td>
            <td>${actividad.sala || '-'}</td>
            <td>${fechaFormato}</td>
            <td>${actividad.hora_inicio}</td>
            <td>${actividad.hora_fin}</td>
          </tr>`;
      }
      cronogramaHTML += '</table>';

      // 📧 Armamos el mensaje HTML para la notificación
      const mensajeHTML = `
        <p>¡Hola! 🎉</p>
        <p>Confirmamos tu inscripción al evento "<strong>${nombreEvento}</strong>".<br>
        El evento comienza el <strong>${fechaFormateada}</strong>${horaPrimeraActividad ? ` a las <strong>${horaPrimeraActividad}</strong>` : ''}.</p>
        <p>Adjuntamos tu credencial de acceso en formato QR.</p>
        <p>Mostrá este código al ingresar al evento:</p>
        <img src="cid:qrInscripcion" alt="Código QR de inscripción" />
        ${cronogramaHTML}
        <p>¡Gracias por participar!</p>
      `;

      // 🚀 Enviamos notificación (email o sistema interno)
      try {
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id,
          tipo: 'Inscripción a evento',
          mensaje: mensajeHTML,
          esHTML: true,
          adjunto: {
            filename: 'qr-inscripcion.png',
            content: qrBuffer.toString('base64'),
            encoding: 'base64',
            cid: 'qrInscripcion'
          }
        });
      } catch (err) {
        console.error('Error al enviar notificación:', err.message);
      }
    }

    // Respondemos con éxito y el QR generado
    res.status(201).json({
      message: 'Inscripción realizada',
      id: result.insertId,
      qr: qrCodeDataURL
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al inscribirse al evento' });
  }
});


// =====================================================
// 🔹 2. Ruta GET para listar inscripciones del usuario logueado
// =====================================================
router.get('/mias', verifyToken, async (req, res) => {
  const usuario_id = req.user.id;

  try {
    // Obtenemos las inscripciones del usuario y el nombre del evento
    const [rows] = await pool.query(
      `SELECT i.id, e.nombre AS evento, i.tipo_inscripcion, i.tarifa, i.codigo_qr, i.creado_en 
       FROM inscripciones i
       JOIN eventos e ON e.id = i.evento_id
       WHERE i.usuario_id = ?`,
      [usuario_id]
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener tus inscripciones' });
  }
});

// =====================================================
// 🔹 3. Ruta POST /admin para que admin/organizador inscriba a un asistente
// =====================================================
router.post('/admin', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { usuario_id, evento_id, tipo_inscripcion, tarifa } = req.body;

  try {
    // Verificamos que el usuario exista y sea asistente
    const [usuarios] = await pool.query('SELECT rol_id FROM usuarios WHERE id = ?', [usuario_id]);
    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (usuarios[0].rol_id !== 5) {
      return res.status(400).json({ error: 'Solo se pueden inscribir usuarios con rol de asistente' });
    }

    // 🔍 Verificamos que el evento exista y no esté cancelado
    const [eventos] = await pool.query('SELECT estado, nombre, fecha_inicio FROM eventos WHERE id = ?', [evento_id]);
    if (eventos.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (eventos[0].estado === 'cancelado') {
      return res.status(400).json({ error: 'No se puede inscribir a un evento cancelado' });
    }

    const evento = eventos[0];

    // 📦 Generamos el QR
    const qrData = `Usuario:${usuario_id}-Evento:${evento_id}`;
    const qrBuffer = await QRCode.toBuffer(qrData);
    const qrCodeDataURL = await QRCode.toDataURL(qrData);

    // Insertamos la inscripción
    const [result] = await pool.query(
      `INSERT INTO inscripciones (usuario_id, evento_id, tipo_inscripcion, tarifa, codigo_qr)
       VALUES (?, ?, ?, ?, ?)`,
      [usuario_id, evento_id, tipo_inscripcion, tarifa, qrCodeDataURL]
    );

    // Obtenemos email del usuario
    const [usuarioRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuario_id]);

    // Obtenemos cronograma del evento
    const [actividades] = await pool.query(
      `SELECT titulo, descripcion, sala, fecha, hora_inicio, hora_fin
       FROM actividades
       WHERE evento_id = ?
       ORDER BY fecha ASC, hora_inicio ASC`,
      [evento_id]
    );

    let horaPrimeraActividad = actividades[0]?.hora_inicio || null;

    // Armamos HTML del cronograma
    let cronogramaHTML = '<p><strong>Cronograma de Actividades:</strong></p><table border="1" cellpadding="5" cellspacing="0"><tr><th>Título</th><th>Descripción</th><th>Sala</th><th>Fecha</th><th>Inicio</th><th>Fin</th></tr>';
    for (const act of actividades) {
      const fechaAct = new Date(act.fecha);
      const fechaFormato = `${String(fechaAct.getDate()).padStart(2, '0')}/${String(fechaAct.getMonth() + 1).padStart(2, '0')}/${fechaAct.getFullYear()}`;
      cronogramaHTML += `
        <tr>
          <td>${act.titulo}</td>
          <td>${act.descripcion || '-'}</td>
          <td>${act.sala || '-'}</td>
          <td>${fechaFormato}</td>
          <td>${act.hora_inicio}</td>
          <td>${act.hora_fin}</td>
        </tr>`;
    }
    cronogramaHTML += '</table>';

    const fechaInicio = new Date(evento.fecha_inicio);
    const fechaFormateada = `${String(fechaInicio.getDate()).padStart(2,'0')}/${String(fechaInicio.getMonth()+1).padStart(2,'0')}/${fechaInicio.getFullYear()}`;

    const mensajeHTML = `
      <p>¡Hola! 🎉</p>
      <p>Confirmamos tu inscripción al evento "<strong>${evento.nombre}</strong>".<br>
      El evento comienza el <strong>${fechaFormateada}</strong>${horaPrimeraActividad ? ` a las <strong>${horaPrimeraActividad}</strong>` : ''}.</p>
      <p>Adjuntamos tu credencial de acceso en formato QR.</p>
      <p>Mostrá este código al ingresar al evento:</p>
      <img src="cid:qrInscripcion" alt="Código QR de inscripción" />
      ${cronogramaHTML}
      <p>¡Gracias por participar!</p>
    `;

    // Enviamos notificación
    try {
      await axios.post('http://localhost:3000/notificaciones', {
        usuario_id,
        tipo: 'Inscripción a evento',
        mensaje: mensajeHTML,
        esHTML: true,
        adjunto: {
          filename: 'qr-inscripcion.png',
          content: qrBuffer.toString('base64'),
          encoding: 'base64',
          cid: 'qrInscripcion'
        }
      });
    } catch (err) {
      console.error('Error al enviar notificación:', err.message);
    }

    res.status(201).json({
      message: 'Inscripción realizada por administrador u organizador',
      id: result.insertId,
      qr: qrCodeDataURL
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al inscribir al usuario' });
  }
});

// Exportamos el router para que se pueda usar en app.js
export default router;
