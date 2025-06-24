// Importamos Express para crear el router
import express from 'express';

// Importamos la conexión a la base de datos (MySQL en este caso)
import pool from '../db.js';

// Creamos un nuevo router de Express
const router = express.Router();

// ===========================================
// 📄 Ruta: Obtener el perfil público de un expositor
// ===========================================
router.get('/:id', async (req, res) => {
  // Extraemos el parámetro `id` desde la URL
  const { id } = req.params;

  try {
    // 🔍 Buscamos el usuario con ese ID que además tenga el rol "Expositores"
    const [usuarios] = await pool.query(
      `SELECT u.id, u.username, u.email, u.bio, u.foto_url, u.web_personal
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.id = ? AND r.nombre = 'Expositores'`, // solo se permite rol "Expositores"
      [id]
    );

    // Si no se encuentra ningún usuario que cumpla con ese rol, devolvemos error 404
    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Expositor no encontrado' });
    }

    // Si se encontró el expositor, lo guardamos
    const expositor = usuarios[0];

    // ✅ Opcional: buscamos todas las actividades donde ese expositor participa
    const [actividades] = await pool.query(
      `SELECT id, titulo, descripcion, fecha, hora_inicio, hora_fin, sala
       FROM actividades
       WHERE expositor_id = ?  -- usamos el mismo ID del usuario
       ORDER BY fecha, hora_inicio`, // ordenamos por día y hora
      [id]
    );

    // Agregamos la lista de actividades al objeto expositor
    expositor.actividades = actividades;

    // Respondemos con los datos del expositor y sus actividades
    res.json(expositor);

  } catch (error) {
    // Si ocurre algún error inesperado (por ejemplo, de conexión), lo mostramos por consola
    console.error(error);
    // Y respondemos con un error 500 (servidor)
    res.status(500).json({ error: 'Error al obtener el perfil del expositor' });
  }
});

// Exportamos el router para que pueda ser usado en la aplicación principal
export default router;
