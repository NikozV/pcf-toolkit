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

# Tests
pnpm test
```

## Estado

**Fase 1** (actual): capa de bajo nivel — lectura/escritura de bytes, carga segura de archivos, y `pcf diff`.

Próximo paso: conseguir un par de partidas reales antes/después de una venta de jugador para ubicar el offset de la plata del club.

## Herramientas auxiliares

- [web/pcf-editor.html](web/pcf-editor.html): hex editor manual standalone, útil como fallback de debug.
