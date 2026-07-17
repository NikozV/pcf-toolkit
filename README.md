# PCF Toolkit

Editor inteligente de partidas guardadas de **PC Fútbol 5.0 / 6.0** (y edición Argentina). Lee los archivos binarios de partida (`managXXX.XXX`), y a futuro va a sugerir valores seguros al editar (plata, estadio, jugadores) respetando los límites del formato.

El formato no tiene documentación oficial: todo se descubre por ingeniería inversa (comparar la partida antes/después de una operación conocida en el juego). Ver [CLAUDE.md](CLAUDE.md) para el detalle del proyecto y [data/offsets.json](data/offsets.json) para el estado del conocimiento del formato.

## Requisitos

- Node.js ≥ 20
- pnpm

## Uso

```bash
pnpm install

# Comparar dos partidas byte a byte (la herramienta central de reverse engineering)
pnpm pcf diff partidaAntes.XXX partidaDespues.XXX

# Ver la caja del club y sugerencias de edición (PCF6 Argentina).
# La caja se auto-detecta (libro de balances): no hace falta ingresar el valor.
pnpm pcf caja fixtures/manag003.000

# Editar la caja: guarda directo sobre el archivo, con backup automático previo
# (<archivo>.bak-<timestamp>). Con --salida escribe a otra ruta sin tocar el original.
pnpm pcf caja fixtures/manag003.000 --set 50000000

# Si la auto-detección falla (partida recién empezada), pasá el valor a mano:
pnpm pcf caja fixtures/manag003.000 --pesos 755149

# Tests
pnpm test
```

## Interfaz gráfica

[web/pcf-toolkit.html](web/pcf-toolkit.html) — editor visual standalone (sin dependencias ni servidor): abrilo en Edge/Chrome, cargá el `managXXX.XXX`, localizá la caja con el valor que muestra el juego y editá con las sugerencias del advisor. Guarda **directo sobre el archivo** (File System Access API) con botones de backup y restaurar. En navegadores sin esa API, descarga el archivo editado con el mismo nombre.

El hex editor manual ([web/pcf-editor.html](web/pcf-editor.html)) sigue disponible como fallback de debug.

## Estado

- **Fase 1 lista**: capa de bajo nivel — lectura/escritura de bytes, carga segura de archivos, `pcf diff`.
- **Caja del club (PCF6 Argentina) confirmada y editable**: se guarda como double LE en pesetas (el juego muestra pesos = pesetas/150) en 3 copias que se localizan por valor. Se **auto-detecta** por el libro de balances semanal (no hace falta ingresar el valor). `pcf caja` la encuentra, sugiere valores seguros y guarda directo sobre el archivo con backup automático.
- **Interfaz gráfica** ([web/pcf-toolkit.html](web/pcf-toolkit.html)): editor visual standalone.

Próximos pasos: bloque de estadio (candidatos ya anotados en `offsets.json`) y atributos de jugadores.

---

<sub>elaltillo · 1984–2026</sub>

