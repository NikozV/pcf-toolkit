# PCF Toolkit — Editor inteligente de partidas de PC Fútbol

## Qué es esto

Herramienta para leer y editar archivos de partida guardada de **PC Fútbol 5.0 / 6.0 (y su edición Argentina)**, un juego de manager de fútbol de fines de los 90 para DOS/Win9x. Los archivos de partida (`managXXX.XXX`, carpeta `TACTICS`) son binarios sin documentación oficial: todo lo que sabemos de su estructura viene de ingeniería inversa hecha por la comunidad (foros de PCFutbolMania y CEZ Forums) más lo que nosotros mismos descubramos.

La meta no es solo "cambiar un byte a mano", sino construir una herramienta con criterio: que lea la partida, entienda cuánta plata tiene el club, y **sugiera** valores razonables al editar (ej: "tenés 800M, el estadio da para poner hasta 1.200M sin arriesgar overflow del contador").

## Por qué existe

Es un proyecto personal/hobby de nostalgia sobre un juego de 1997-98 discontinuado hace décadas (abandonware de facto). No hay API, no hay documentación, no hay SDK. Todo el conocimiento del formato de archivo se arma por prueba y error: guardar partida, hacer un cambio en el juego, comparar el archivo antes/después, y así identificar qué bytes corresponden a qué dato.

## Stack

- **TypeScript + Node.js** (pnpm como package manager, como en el resto de mis proyectos)
- CLI primero (`commander` o similar), UI web después si hace falta — reusar el hex editor HTML standalone ya hecho como herramienta de debug/fallback, no como la interfaz principal.
- Sin dependencias pesadas. Este proyecto no necesita un framework — es lectura/escritura de buffers binarios y algo de lógica de negocio encima.
- Tests con `vitest`, usando archivos de partida de prueba (fixtures) que yo voy a proveer — nunca inventar fixtures, siempre pedir un archivo real si hace falta.

## Estructura del proyecto

```
pcf-toolkit/
  CLAUDE.md
  README.md
  package.json
  data/
    offsets.json          # mapa de offsets conocidos, versionado por edición del juego
  fixtures/                # archivos .XXX de prueba reales (gitignored, son míos)
  src/
    core/
      buffer.ts            # helpers de lectura/escritura de bytes (uint8, uint32 LE, fechas, etc.)
      save-file.ts          # clase SaveFile: load(path), campos tipados, write(path)
    reverse-engineering/
      diff.ts               # comparar dos archivos byte a byte, listar offsets que cambiaron
      annotate.ts           # marcar en offsets.json un offset como "confirmado" con nota de cómo se descubrió
    advisor/
      suggestions.ts        # lógica: dado el estado actual del club, sugerir valores seguros
    cli/
      index.ts              # comandos: info, diff, set, suggest
  web/
    pcf-editor.html          # el hex editor manual ya construido (referencia / fallback)
  tests/
```

## Estado actual del conocimiento del formato (lo que ya sabemos)

Todo esto viene de foros de la comunidad, **no está verificado contra un archivo real todavía** — tratarlo como hipótesis a confirmar con `diff.ts`, no como verdad asumida:

- **Bloque de estadio** (por equipo): espectadores sentados y de pie se guardan como `signed long` (4 bytes, little-endian). Estructura aproximada: `[sentados(4)] [de_pie(4)] [parking(4)] [equipamiento(5)] [servicios(4)] [ampliación(1)] [nº_espectadores_a_ampliar(1)] [semanas_restantes(1)]`.
- Límite conocido: los ingresos por partido/semana se guardan en un rango que se da vuelta (overflow) pasando ~2.147 millones — hay que respetar ese techo al sugerir valores.
- **Bloque de jugador**: temporada actual = velocidad, resistencia, agresividad, calidad, regate, remate, pase, tiro, entradas, portero, moral, forma, energía (1 byte cada uno) + bloque similar para "próxima temporada" + altura, peso, fecha de nacimiento (día 1 byte, mes 1 byte, año 2 bytes little-endian).
- **Plata del club**: **CONFIRMADO para PCF6 Argentina** (2026-07-16, diff entre dos saves reales verificados contra pantalla): double IEEE 754 LE **en pesetas**; el juego muestra pesos = pesetas/150 truncado. La caja actual vive en 3 copias bit a bit idénticas cuyos offsets NO son estables entre saves (el archivo crece semana a semana) → se localiza por escaneo de valor (`localizarCaja` en `src/core/caja.ts`), nunca por offset fijo. Techo seguro: 2.147.483.647 pta = 14.316.557 $ mostrados. Comando: `pcf caja <archivo> --pesos <mostrado> [--set <nuevo>]`.
- ~~El texto de mensajes (ofertas, "millones") está en ASCII plano dentro del archivo y es buscable directamente.~~ **Desmentido para PCF6** (confirmado 2026-07-16 contra `fixtures/manag003-inicial.000`): los strings están ofuscados con **XOR 0x61** byte a byte (decodificado aparecen "F.C. Barcelona", "Patrick KLUIVERT", "GUARDIOLA", etc.). Los campos numéricos (atributos, y presumiblemente la plata) parecen guardarse en binario crudo, sin XOR. Detalle en `data/offsets.json` → `pcf6.codificacion_texto`.

## Cómo trabajar en este proyecto (reglas para Claude Code)

1. **Nunca asumas un offset como definitivo si no viene de `diff.ts` corrido contra un archivo real mío.** Si necesitás confirmar algo, pedime que genere el par de archivos (antes/después) en vez de adivinar.
2. **Todo cambio en `offsets.json` va con una nota** de cómo se confirmó (qué operación se hizo en el juego, qué archivos se compararon).
3. **Nunca escribas sobre el archivo original.** Todo comando de edición trabaja sobre una copia y pide confirmación antes de sobrescribir.
4. El **advisor** (sugerencias de plata) es el corazón del proyecto: no es "poné cualquier número", es calcular un rango razonable según el techo de overflow conocido, el tipo de operación (aumentar aforo vs. clausula de jugador vs. plata en caja directa) y devolver 2-3 opciones con explicación corta de cada una (igual que el patrón de "variantes con trade-offs" que uso en otras herramientas).
5. Preferí commits chicos y funcionales por fase, no todo junto.
6. Comentarios de código y mensajes de CLI en español (uso este proyecto en español, es para mí).
7. Si hace falta un archivo de partida real para avanzar (fixture, offset a confirmar), pedímelo en vez de simular datos — un fixture inventado no sirve para reversear un formato real.

## Fases de desarrollo (orden sugerido, no rígido)

1. `core/buffer.ts` + `core/save-file.ts`: cargar un archivo `.XXX`, exponer los campos ya conocidos (jugadores, estadio) de forma tipada.
2. `reverse-engineering/diff.ts`: CLI que compara dos archivos y lista offsets distintos — la herramienta que vamos a usar constantemente para descubrir cosas nuevas (empezando por la plata del club).
3. Una vez ubicado el offset de plata del club: `advisor/suggestions.ts` con la lógica de sugerencias.
4. `cli/index.ts`: comando `pcf info archivo.XXX` (muestra plata, plantilla resumida, estadio) y `pcf suggest archivo.XXX --tipo clausula` (sugiere valores).
5. Recién ahí, si hace falta, una capa web más linda que el hex editor manual — pero el hex editor ya sirve como fallback de debug, no hay apuro en reemplazarlo.
