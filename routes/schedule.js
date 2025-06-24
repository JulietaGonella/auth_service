// Importamos express para manejar rutas
import express from 'express';

// Conexión a la base de datos
import pool from '../db.js';

// Librería para hacer solicitudes HTTP (para notificaciones)
import axios from 'axios';

// Middleware de autenticación y roles
import { verifyToken, requireAdminOrOrganizer } from '../middlewares/authMiddleware.js';

// Creamos un router de Express
const router = express.Router();

/* ========================
📌 Crear una nueva actividad
=========================== */
router.post('/', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  // Obtenemos los datos de la actividad desde el body
  const {
    evento_id,
    titulo,
    descripcion,
    expositor_id,
    sala,
    fecha,
    hora_inicio,
    hora_fin
  } = req.body;

  try {
    // Validamos que la hora de fin sea mayor que la de inicio
    if (hora_fin <= hora_inicio) {
      return res.status(400).json({ error: 'La hora de fin debe ser mayor a la de inicio' });
    }

    // Verificamos que no haya conflicto con otras actividades en la misma sala, fecha y horario
    const [conflictos] = await pool.query(
      `SELECT * FROM actividades
       WHERE evento_id = ? AND sala = ? AND fecha = ? AND (
         (hora_inicio < ? AND hora_fin > ?) OR
         (hora_inicio < ? AND hora_fin > ?) OR
         (hora_inicio >= ? AND hora_fin <= ?)
       )`,
      [evento_id, sala, fecha, hora_fin, hora_fin, hora_inicio, hora_inicio, hora_inicio, hora_fin]
    );

    if (conflictos.length > 0) {
      return res.status(409).json({ error: 'Conflicto de horario: la sala está ocupada en ese horario' });
    }

    // ** Validar que el expositor no esté asignado a otra actividad en el mismo horario y fecha (cualquier sala) **
    if (expositor_id) {
      const [conflictoExpositor] = await pool.query(
        `SELECT * FROM actividades
         WHERE expositor_id = ? AND fecha = ? AND (
           (hora_inicio < ? AND hora_fin > ?) OR
           (hora_inicio < ? AND hora_fin > ?) OR
           (hora_inicio >= ? AND hora_fin <= ?)
         )`,
        [expositor_id, fecha, hora_fin, hora_fin, hora_inicio, hora_inicio, hora_inicio, hora_fin]
      );

      if (conflictoExpositor.length > 0) {
        return res.status(409).json({ error: 'Conflicto de horario: el expositor ya está asignado a otra actividad en ese horario' });
      }
    }

    // Insertamos la nueva actividad
    const [result] = await pool.query(
      `INSERT INTO actividades (evento_id, titulo, descripcion, expositor_id, sala, fecha, hora_inicio, hora_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [evento_id, titulo, descripcion, expositor_id, sala, fecha, hora_inicio, hora_fin]
    );

    // Si hay expositor, lo notificamos
    if (expositor_id) {
      const [eventos] = await pool.query(`SELECT nombre FROM eventos WHERE id = ?`, [evento_id]);
      const nombreEvento = eventos.length > 0 ? eventos[0].nombre : 'un evento';

      const mensaje = `
        <p>📢 Fuiste asignado como <strong>expositor</strong> en la actividad "<strong>${titulo}</strong>"</p>
        <p>Esta actividad forma parte del evento "<strong>${nombreEvento}</strong>" y se llevará a cabo el <strong>${fecha}</strong> de <strong>${hora_inicio}</strong> a <strong>${hora_fin}</strong> en la sala <strong>${sala}</strong>.</p>
      `;

      await axios.post('http://localhost:3000/notificaciones', {
        usuario_id: expositor_id,
        tipo: 'Nueva actividad asignada',
        mensaje,
        esHTML: true
      });
    }

    res.status(201).json({ message: 'Actividad agregada y expositor notificado', id: result.insertId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al agregar actividad' });
  }
});

/* ========================
📌 Editar una actividad
=========================== */
router.put('/:id', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { id } = req.params;
  const cambios = req.body; // Campos nuevos que se desean actualizar

  try {
    // Verificamos que la actividad exista
    const [actividades] = await pool.query(`SELECT * FROM actividades WHERE id = ?`, [id]);
    if (actividades.length === 0) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    const actual = actividades[0]; // Datos actuales de la actividad

    // Campos que pueden cambiar
    const campos = {
      titulo: 'Título',
      descripcion: 'Descripción',
      expositor_id: 'Expositor',
      sala: 'Sala',
      fecha: 'Fecha',
      hora_inicio: 'Hora de inicio',
      hora_fin: 'Hora de fin'
    };

    const fields = []; // Lista de campos SQL a actualizar
    const values = []; // Nuevos valores
    let mensajeCambios = `<p>📢 <strong>La actividad "<em>${actual.titulo}</em>" ha sido actualizada:</strong></p><ul>`;

    // Detectamos cambios reales
    for (const campo in cambios) {
      if (
        cambios[campo] !== undefined &&
        cambios[campo] != actual[campo] &&
        campos[campo]
      ) {
        fields.push(`${campo} = ?`);
        values.push(cambios[campo]);
        mensajeCambios += `<li><strong>${campos[campo]}:</strong> ${actual[campo] ?? '—'} → ${cambios[campo]}</li>`;
      }
    }

    mensajeCambios += '</ul><p>Revisá los detalles actualizados en el cronograma.</p>';

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay cambios en los campos enviados' });
    }

    // Validación de horarios
    const nuevaHoraInicio = cambios.hora_inicio ?? actual.hora_inicio;
    const nuevaHoraFin = cambios.hora_fin ?? actual.hora_fin;

    if (nuevaHoraFin <= nuevaHoraInicio) {
      return res.status(400).json({ error: 'La hora de fin debe ser mayor a la de inicio' });
    }

    // Validación de solapamiento con otras actividades
    const nuevaSala = cambios.sala ?? actual.sala;
    const nuevaFecha = cambios.fecha ?? actual.fecha;

    const [conflictos] = await pool.query(
      `SELECT * FROM actividades
       WHERE id != ? AND sala = ? AND fecha = ? AND (
         (hora_inicio < ? AND hora_fin > ?) OR
         (hora_inicio < ? AND hora_fin > ?) OR
         (hora_inicio >= ? AND hora_fin <= ?)
       )`,
      [id, nuevaSala, nuevaFecha, nuevaHoraFin, nuevaHoraFin, nuevaHoraInicio, nuevaHoraInicio, nuevaHoraInicio, nuevaHoraFin]
    );

    if (conflictos.length > 0) {
      return res.status(409).json({ error: 'Conflicto de horario en la sala seleccionada' });
    }

    // Ejecutamos la actualización
    values.push(id);
    await pool.query(`UPDATE actividades SET ${fields.join(', ')} WHERE id = ?`, values);

    // Notificamos al expositor
    const expositorId = cambios.expositor_id ?? actual.expositor_id;
    if (expositorId) {
      await axios.post('http://localhost:3000/notificaciones', {
        usuario_id: expositorId,
        tipo: 'Actualización de actividad',
        mensaje: mensajeCambios,
        esHTML: true
      });
    }

    // Notificamos a los inscriptos del evento
    const [evento] = await pool.query(`SELECT evento_id FROM actividades WHERE id = ?`, [id]);
    if (evento.length > 0) {
      const eventoId = evento[0].evento_id;

      const [inscriptos] = await pool.query(`
        SELECT DISTINCT usuario_id FROM inscripciones WHERE evento_id = ?
      `, [eventoId]);

      for (const inscripto of inscriptos) {
        if (inscripto.usuario_id !== expositorId) {
          await axios.post('http://localhost:3000/notificaciones', {
            usuario_id: inscripto.usuario_id,
            tipo: 'Actualización de actividad',
            mensaje: mensajeCambios,
            esHTML: true
          });
        }
      }
    }

    res.json({ message: 'Actividad actualizada y notificaciones enviadas' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar la actividad' });
  }
});

/* ================================
📌 Obtener actividades de un evento
================================== */
router.get('/evento/:evento_id', verifyToken, async (req, res) => {
  const { evento_id } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT a.*, u.username AS expositor_nombre
       FROM actividades a
       LEFT JOIN usuarios u ON a.expositor_id = u.id
       WHERE a.evento_id = ?`,
      [evento_id]
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener actividades del evento' });
  }
});

/* ========================
📌 Cambiar estado de actividad
=========================== */
router.patch('/:id/estado', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { estado } = req.body;
  const { id } = req.params;

  try {
    // Actualizamos el estado en la base
    await pool.query('UPDATE actividades SET estado = ? WHERE id = ?', [estado, id]);

    if (estado === 'cancelado') {
      // Buscamos info para el mensaje
      const [actividades] = await pool.query(
        `SELECT a.titulo, e.nombre AS evento_nombre, a.expositor_id, a.evento_id 
         FROM actividades a
         JOIN eventos e ON a.evento_id = e.id
         WHERE a.id = ?`,
        [id]
      );

      if (actividades.length === 0) {
        return res.status(404).json({ error: 'Actividad no encontrada' });
      }

      const actividad = actividades[0];

      const mensaje = `
        <p>⚠️ <strong>La actividad "<em>${actividad.titulo}</em>" del evento "<em>${actividad.evento_nombre}</em>" ha sido cancelada.</strong></p>
        <p>Lamentamos los inconvenientes ocasionados.</p>
      `;

      // Notificamos al expositor
      if (actividad.expositor_id) {
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id: actividad.expositor_id,
          tipo: 'Cancelación de actividad',
          mensaje,
          esHTML: true
        });
      }

      // Notificamos a los inscriptos
      const [inscriptos] = await pool.query(
        `SELECT DISTINCT usuario_id FROM inscripciones WHERE evento_id = ?`,
        [actividad.evento_id]
      );

      for (const inscripto of inscriptos) {
        if (inscripto.usuario_id !== actividad.expositor_id) {
          await axios.post('http://localhost:3000/notificaciones', {
            usuario_id: inscripto.usuario_id,
            tipo: 'Cancelación de actividad',
            mensaje,
            esHTML: true
          });
        }
      }
    }

    res.json({ message: 'Estado de actividad actualizado y notificaciones enviadas si corresponde' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al cambiar estado de la actividad' });
  }
});

// Exportamos el router para usar en la app principal
export default router;
