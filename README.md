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

# Ver la caja del club y sugerencias de edición (PCF6 Argentina)
pnpm pcf caja fixtures/manag003.000 --pesos 755149

# Editar la caja (escribe una copia .editada, nunca pisa el original)
pnpm pcf caja fixtures/manag003.000 --pesos 755149 --set 7000000

# Tests
pnpm test
```

## Estado

- **Fase 1 lista**: capa de bajo nivel — lectura/escritura de bytes, carga segura de archivos, `pcf diff`.
- **Caja del club (PCF6 Argentina) confirmada y editable**: se guarda como double LE en pesetas (el juego muestra pesos = pesetas/150) en 3 copias que se localizan por valor. `pcf caja` la encuentra, sugiere valores seguros bajo el techo de overflow (14.316.557 $) y edita sobre copia.

Próximos pasos: bloque de estadio (candidatos ya anotados en `offsets.json`) y atributos de jugadores.

## Herramientas auxiliares

- [web/pcf-editor.html](web/pcf-editor.html): hex editor manual standalone, útil como fallback de debug.
