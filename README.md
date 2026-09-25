# Promedio UAM

Calculadora de promedio académico para estudiantes de la Universidad Autónoma de Manizales. Proyecta tu promedio del semestre y tu acumulado en tiempo real mientras ingresas notas, te dice cuánto necesitas en lo que falta para llegar a tu meta de beca o distinción, y guarda un historial de cada semestre para que puedas volver a verlo tal como quedó.

Funciona directamente en el navegador: sin instalación, sin cuentas y sin servidor.

> **Aviso:** es una herramienta personal y no oficial, pensada para tantear cómo vas. No está afiliada a la universidad y sus resultados no reemplazan tu certificado de notas ni la información del sistema de Registro Académico.

<!-- Sugerencia: agrega una captura en docs/captura.png y descomenta la línea siguiente -->
<!-- ![Vista de la calculadora](docs/captura.png) -->

## Funcionalidades

### Calculadora
- Notas por **cortes** (30 %, 35 %, 35 %) o por **nota única**, mezclables en el mismo semestre.
- Cálculo en **tiempo real**: nota final por materia, promedio del semestre y acumulado proyectado.
- **Estado frente a la meta**: en la meta, muy cerca o por debajo, con la diferencia exacta.
- **Nota necesaria**: el promedio que te hace falta en los créditos pendientes para alcanzar tu meta, o el aviso de que ya no es posible.
- **Avance en la carrera** según tus créditos aprobados frente al plan.

### Semestres e historial
- **Asistente de nuevo semestre** en tres pasos: materias, configuración y confirmación. Al cerrar un semestre completo, prellena el siguiente con el acumulado final, los créditos cursados y los aprobados.
- **Cierre de semestre** con confirmación. Si hay notas pendientes avisa que se guardará sin resultado, y podrás completarlo después.
- **Historial** con cada semestre cerrado. Puedes abrir su calculadora exactamente como quedó, editarla o eliminarla. Cada semestre es independiente: editar uno no altera los demás.

### Respaldo
- **Exportar** todos tus semestres a un archivo JSON.
- **Importar** de dos formas:
  - **Combinar** (opción por defecto): agrega los semestres nuevos. Si el archivo trae un semestre activo, este queda en la Calculadora y el que tenías pasa a Historial.
  - **Reemplazar todo**: deja solo los datos del archivo.

## Cómo se calcula

Los cálculos siguen el Reglamento General Estudiantil de la UAM (Acuerdo 001 de 2023):

| Regla | Referencia |
|---|---|
| Notas parciales y definitivas con **un decimal**, redondeadas | Art. 38 |
| Una materia se **aprueba** con 3.0 o más en pregrado | Art. 38, par. 2 |
| El **promedio acumulado** pondera notas y créditos de las materias **cursadas**, incluidas las reprobadas | Art. 45 |
| Los promedios se expresan con **4 decimales, sin aproximación** (se truncan) | Art. 45, parágrafo |

Fórmulas usadas:

```
Nota final (cortes)  = redondeo₁( 0.30·C1 + 0.35·C2 + 0.35·C3 )

Puntos previos       = promedio anterior × créditos cursados antes

Acumulado proyectado = (puntos previos + Σ nota final × créditos)
                       ÷ (créditos cursados antes + créditos con nota final)
```

Mientras el semestre está en curso, el acumulado se proyecta solo con las materias que ya tienen nota final. Así no se asume un 0.0 en lo pendiente.

Los **créditos aprobados** se usan únicamente para la barra de avance en la carrera. No entran en el promedio.

### Periodos académicos

| Periodo | Duración |
|---|---|
| `AAAA-1` | Enero a abril |
| `AAAA-2` | Intersemestral, junio a agosto |
| `AAAA-3` | Agosto a diciembre |

## Uso

1. Clona o descarga el repositorio.
2. Abre `index.html` en tu navegador.
3. La primera vez se abre el asistente para configurar tu semestre: agrega tus materias, tu promedio anterior y tus créditos.
4. Ingresa tus notas a medida que las tengas. Al terminar el semestre usa **Cerrar semestre** (abajo a la derecha).

### Publicarla con GitHub Pages
En el repositorio, ve a **Settings → Pages**, elige desplegar desde la rama principal y la carpeta raíz. La página queda disponible en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

## Almacenamiento de datos

Todo se guarda en el `localStorage` de tu navegador. Ningún dato sale de tu equipo. Esto implica que:

- Los datos existen solo en ese navegador y en ese equipo.
- Si borras los datos de navegación o cambias de dispositivo, se pierden.
- **Exporta un respaldo de vez en cuando** desde la pestaña Historial.

Si usabas la versión anterior de un solo archivo (`calculadoraBeca.v1`), la aplicación migra tus datos automáticamente al abrirse en el mismo navegador y ubicación. Si la abres desde otra ubicación, exporta un respaldo desde la versión anterior e impórtalo en la nueva.

## Estructura del proyecto

```
.
├── index.html   # Estructura: header, vistas, asistente y modales
├── styles.css   # Estilos (tema oscuro con acentos morados)
└── app.js       # Estado, cálculos, render e interacciones
```

Está hecha con HTML, CSS y JavaScript sin frameworks ni dependencias. Las fuentes (Geist y Geist Mono) se cargan desde Google Fonts, y si no hay conexión usa las fuentes del sistema.

## Hoja de ruta

- [ ] Cuentas de usuario y sincronización de datos entre dispositivos
- [ ] Evaluación de incentivos del reglamento (Matrícula de Honor, Mención de Honor)
- [ ] Nuevas secciones en la navegación

## Autor

Andrés, estudiante de Ingeniería de Sistemas.
