// Importa la conexión a la base de datos desde el archivo db.js
import pool from '../db.js';  

// Importa axios para hacer solicitudes HTTP
import axios from 'axios';

// Importa node-cron para programar tareas automáticas
import cron from 'node-cron';

// Función principal que se encarga de enviar los recordatorios de eventos
async function enviarRecordatorios() {
  try {
    // 1. Buscar eventos cuya fecha de inicio sea mañana
    const [eventos] = await pool.query(`
      SELECT e.id, e.nombre, e.fecha_inicio, e.ubicacion
      FROM eventos e
      WHERE DATE(e.fecha_inicio) = CURDATE() + INTERVAL 1 DAY
    `);

    // Iterar por cada evento encontrado
    for (const evento of eventos) {
      // 2. Buscar la primera actividad del evento (la de menor hora_inicio)
      const [actividades] = await pool.query(`
        SELECT hora_inicio FROM actividades
        WHERE evento_id = ? AND fecha = ?
        ORDER BY hora_inicio ASC
        LIMIT 1
      `, [evento.id, evento.fecha_inicio]);

      // Obtener la hora de la primera actividad, si existe
      const horaPrimeraActividad = actividades.length > 0
        ? actividades[0].hora_inicio
        : null;

      // 3. Buscar los usuarios que se inscribieron al evento
      const [usuarios] = await pool.query(`
        SELECT u.id, u.username
        FROM inscripciones i
        JOIN usuarios u ON u.id = i.usuario_id
        WHERE i.evento_id = ?
      `, [evento.id]);

      // 4. Enviar un mensaje de notificación a cada usuario inscrito
      for (const usuario of usuarios) {
        // Construir el mensaje HTML del recordatorio
        const mensaje = `
          <p>🔔 <strong>Recordatorio</strong></p>
          <p>El evento <strong>"${evento.nombre}"</strong> comienza <strong>mañana</strong>${
            horaPrimeraActividad ? ` a las ${horaPrimeraActividad}` : ''
          } en <strong>${evento.ubicacion}</strong>.</p>
          <p>¡Te esperamos!</p>
        `;

        // Enviar el mensaje al sistema de notificaciones
        await axios.post('http://localhost:3000/notificaciones', {
          usuario_id: usuario.id,         // ID del usuario destinatario
          tipo: 'Recordatorio de evento', // Tipo de notificación
          mensaje,                        // Mensaje HTML
          esHTML: true                    // Indicamos que el mensaje está en formato HTML
        });
      }
    }

    // Mostrar mensaje en consola si todo salió bien
    console.log('✅ Recordatorios de eventos enviados');
  } catch (error) {
    // Mostrar mensaje de error en consola si algo falló
    console.error('❌ Error al enviar recordatorios:', error.message);
  }
}

// Ejecutar la función inmediatamente al iniciar el script
enviarRecordatorios();

// Programar la función para que se ejecute todos los días a las 8:00 AM
cron.schedule('0 8 * * *', () => {
  enviarRecordatorios();
});
