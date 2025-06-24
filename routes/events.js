// Importamos Express para definir rutas
import express from 'express';  

// Importamos la conexión a la base de datos
import pool from '../db.js';

// Importamos axios para enviar notificaciones por HTTP
import axios from 'axios'; 

// Importamos middleware de autenticación y control de roles
import { verifyToken, requireAdminOrOrganizer } from '../middlewares/authMiddleware.js';

// Creamos un router de Express
const router = express.Router();

// ==============================
// 📌 Crear nuevo evento
// ==============================
router.post('/', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { nombre, descripcion, fecha_inicio, fecha_fin, ubicacion, capacidad, estado } = req.body;

  try {
    // Insertamos el evento en la base de datos. Si no se especifica estado, se usa 'planificacion'
    const [result] = await pool.query(
      `INSERT INTO eventos 
        (nombre, descripcion, fecha_inicio, fecha_fin, ubicacion, capacidad, estado) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion, fecha_inicio, fecha_fin, ubicacion, capacidad, estado || 'planificacion']
    );

    // Enviamos confirmación con el ID del nuevo evento
    res.status(201).json({ message: 'Evento creado', id: result.insertId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear el evento' });
  }
});

// ==============================
// 📌 Editar evento existente
// ==============================
router.put('/:id', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, fecha_inicio, fecha_fin, ubicacion, capacidad, estado } = req.body;

  try {
    // Consultamos si el evento existe
    const [eventos] = await pool.query('SELECT * FROM eventos WHERE id = ?', [id]);
    if (eventos.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const actual = eventos[0];

    const fields = [];
    const values = [];
    let mensaje = `<p><strong>📢 Se han actualizado los datos del evento "<em>${actual.nombre}</em>":</strong></p><ul>`;
    let cambiosClave = false;

    if (nombre !== undefined) {
      fields.push('nombre = ?');
      values.push(nombre);
    }
    if (descripcion !== undefined) {
      fields.push('descripcion = ?');
      values.push(descripcion);
    }
    if (fecha_inicio !== undefined && fecha_inicio !== actual.fecha_inicio.toISOString().split('T')[0]) {
      fields.push('fecha_inicio = ?');
      values.push(fecha_inicio);
      mensaje += `<li><strong>Fecha de inicio:</strong> ${actual.fecha_inicio.toISOString().split('T')[0]} → ${fecha_inicio}</li>`;
      cambiosClave = true;
    }
    if (fecha_fin !== undefined && fecha_fin !== actual.fecha_fin.toISOString().split('T')[0]) {
      fields.push('fecha_fin = ?');
      values.push(fecha_fin);
      mensaje += `<li><strong>Fecha de fin:</strong> ${actual.fecha_fin.toISOString().split('T')[0]} → ${fecha_fin}</li>`;
      cambiosClave = true;
    }
    if (ubicacion !== undefined && ubicacion !== actual.ubicacion) {
      fields.push('ubicacion = ?');
      values.push(ubicacion);
      mensaje += `<li><strong>Ubicación:</strong> ${actual.ubicacion} → ${ubicacion}</li>`;
      cambiosClave = true;
    }
    if (capacidad !== undefined) {
      fields.push('capacidad = ?');
      values.push(capacidad);
    }
    if (estado !== undefined) {
      fields.push('estado = ?');
      values.push(estado);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }

    values.push(id);
    await pool.query(`UPDATE eventos SET ${fields.join(', ')} WHERE id = ?`, values);

    // 🔔 Se eliminó la lógica de notificación a inscriptos y expositores

    res.json({ message: 'Evento actualizado' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al editar el evento' });
  }
});

// ==============================
// 📌 Obtener todos los eventos
// ==============================
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM eventos');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

// ==============================
// 📌 Cambiar el estado del evento (cancelado, activo, finalizado)
// ==============================
router.patch('/:id/estado', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { estado } = req.body;
  const { id } = req.params;

  try {
    await pool.query('UPDATE eventos SET estado = ? WHERE id = ?', [estado, id]);

    const [eventos] = await pool.query('SELECT nombre FROM eventos WHERE id = ?', [id]);
    if (eventos.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const evento = eventos[0];
    let mensaje = '';

    // Si fue cancelado
    if (estado === 'cancelado') {
      mensaje = `
        <p>⚠️ <strong>El evento "<em>${evento.nombre}</em>" ha sido cancelado.</strong></p>
        <p>Lamentamos los inconvenientes ocasionados.</p>
      `;

      const [inscriptos] = await pool.query(
        `SELECT DISTINCT usuario_id FROM inscripciones WHERE evento_id = ?`,
        [id]
      );

      for (const inscripto of inscriptos) {
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id: inscripto.usuario_id,
          tipo: 'Cancelación de evento',
          mensaje,
          esHTML: true
        });
      }
    }

    // Si fue marcado como activo o finalizado
    if (estado === 'activo' || estado === 'finalizado') {
      const estadoCapitalizado = estado.charAt(0).toUpperCase() + estado.slice(1);
      mensaje = `
        <p>📢 El evento "<strong>${evento.nombre}</strong>" ha sido marcado como <strong>${estadoCapitalizado}</strong>.</p>
        ${estado === 'activo' ? '<p>¡Buena suerte con las actividades! 🚀</p>' : '<p>¡Gracias por participar! 🏁</p>'}
      `;

      const [expositores] = await pool.query(
        `SELECT DISTINCT expositor_id AS usuario_id
         FROM actividades
         WHERE evento_id = ? AND expositor_id IS NOT NULL`,
        [id]
      );

      for (const expositor of expositores) {
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id: expositor.usuario_id,
          tipo: `Evento ${estadoCapitalizado}`,
          mensaje,
          esHTML: true
        });
      }

      const [organizadores] = await pool.query(
        `SELECT DISTINCT usuario_id
         FROM organizadores_eventos
         WHERE evento_id = ?`,
        [id]
      );

      for (const organizador of organizadores) {
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id: organizador.usuario_id,
          tipo: `Evento ${estadoCapitalizado}`,
          mensaje,
          esHTML: true
        });
      }
    }

    res.json({ message: 'Estado actualizado y notificaciones enviadas si corresponde' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al cambiar estado del evento' });
  }
});

// ==============================
// 📌 Asignar organizador a un evento
// ==============================
router.post('/:evento_id/organizador', verifyToken, requireAdminOrOrganizer, async (req, res) => {
  const { evento_id } = req.params;
  const { usuario_id } = req.body;

  try {
    // Insertamos la relación entre el organizador y el evento (si no existe)
    await pool.query(
      'INSERT IGNORE INTO organizadores_eventos (usuario_id, evento_id) VALUES (?, ?)',
      [usuario_id, evento_id]
    );

    const [eventos] = await pool.query('SELECT nombre FROM eventos WHERE id = ?', [evento_id]);
    const evento = eventos[0];

    if (evento) {
      const mensaje = `
        <p>🎉 Has sido asignado como <strong>organizador</strong> del evento "<strong>${evento.nombre}</strong>".</p>
        <p>Ya podés gestionar su programación y actividades desde el panel de eventos.</p>
      `;

      await axios.post('http://localhost:3000/notificaciones', {
        usuario_id,
        tipo: 'Asignación como organizador',
        mensaje,
        esHTML: true
      });
    }

    res.json({ message: 'Organizador asignado al evento y notificado' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al asignar organizador' });
  }
});

// Exportamos el router para que pueda usarse en el resto de la app
export default router;
