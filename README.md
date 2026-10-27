# Farmacopea Local

Consulta local de información de medicamentos con datos abiertos de **openFDA** (fichas técnicas SPL, dominio público).
No es una copia de Micromedex ni usa su contenido.

## Funciones

- Login local (usuario/contraseña con hash scrypt, sesión por cookie, límite de intentos).
- Búsqueda por nombre genérico, marca o clase terapéutica.
- Índice A-Z.
- Ficha por secciones: advertencia en recuadro, indicaciones, dosis, contraindicaciones, advertencias, reacciones adversas, interacciones, poblaciones especiales, sobredosis, farmacología, presentación, información al paciente.
- Comprobador de interacciones: busca en la sección de interacciones de cada ficha menciones a los demás fármacos (por nombre, marca o clase). Es un cribado orientativo, no un análisis clínico.
- Favoritos e historial por usuario.
- Importar cualquier medicamento desde openFDA con un clic (necesita internet solo para eso).

## Uso

Requiere Node.js 22.5 o superior (usa `node:sqlite`, sin dependencias externas).

```bash
npm run seed    # descarga ~105 fármacos comunes (una vez, tarda ~1 minuto)
npm start       # http://127.0.0.1:3000
```

La primera vez que abras la página te pedirá crear tu cuenta local.
Para importar solo algunos: `npm run seed -- ibuprofen "metformin"`.

Variables opcionales: `PORT`, `HOST`, `DB_PATH`, `OPENFDA_API_KEY` (gratis en open.fda.gov; sube el límite de peticiones).

## Datos

Todo se guarda en `data/farmacopea.db` (SQLite). El servidor escucha solo en `127.0.0.1`.

## Aviso

Las fichas pueden estar desactualizadas o incompletas. No sustituye al juicio clínico ni a una referencia farmacológica con licencia.

## Traducción al español (opcional, local)

El botón **Traducir al español** de cada ficha usa Argos Translate, que se ejecuta en tu equipo
(el texto de las fichas no se envía a ningún servicio externo; solo se descarga el modelo una vez).

```bash
python -m venv .venv                      # Python 3.10-3.13
.venv\Scripts\python -m pip install argostranslate
npm run translator:install                # descarga el modelo en->es (una vez)
npm run translator                        # arranca el traductor en 127.0.0.1:5001
```

- Las traducciones se guardan en SQLite: la segunda vez son instantáneas.
- Un glosario corrige errores típicos de terminología médica ("renal impairment" -> "insuficiencia renal"), pero **es traducción automática y puede contener errores; el texto original prevalece**.
- Puedes usar otro servicio compatible con LibreTranslate con `TRANSLATE_URL` y `TRANSLATE_API_KEY`.

## Resumen de la ficha

La pestaña Resumen muestra frases **literales** de la ficha (completas, sin paráfrasis) con su sección de origen.
Los ajustes por insuficiencia renal/hepática se toman de subsecciones dedicadas cuando existen; si no,
solo de frases que mencionan la población y una acción (dosis, evitar, vigilar…). Si no hay nada fiable, lo indica.

## Versión para el teléfono (iPhone y Android)

`docs/` contiene una versión web instalable (PWA) que no necesita servidor: las fichas van incluidas como JSON
y los favoritos/historial se guardan en el propio teléfono. Para regenerarla:

```bash
npm run build:web          # genera docs/ a partir de la base local
npm run pretranslate       # (opcional) traduce de antemano el Resumen; requiere `npm run translator`
```

- **Instalar en iPhone:** abre la dirección en Safari → Compartir → *Añadir a pantalla de inicio*.
- **Instalar en Android:** abre la dirección en Chrome → menú ⋮ → *Instalar aplicación*.
- Sin login (los datos son públicos de openFDA); abre sin conexión las fichas ya visitadas.
- El botón **Traducir** traduce el Resumen (precalculado). Para secciones completas usa el traductor del navegador
  (Safari: botón *aA* → Traducir; Chrome: ⋮ → Traducir).
- *Importar desde openFDA* funciona desde el propio teléfono (necesita internet).

### Publicar en GitHub Pages

Repositorio → *Settings* → *Pages* → *Deploy from a branch* → rama `main`, carpeta `/docs`.
La app queda en `https://<usuario>.github.io/<repositorio>/`.

> Nota: un sitio de GitHub Pages es público aunque el repositorio sea privado (salvo planes Enterprise).
> Solo contiene datos públicos de openFDA y ningún dato de usuarios.
