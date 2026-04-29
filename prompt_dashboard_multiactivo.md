# Prompt: Expansión Dashboard Multi-Activo

El dashboard actual analiza un solo ticker a la vez. Necesito expandirlo
para soportar hasta 100 activos simultáneos según el alcance definido
en el proyecto. Implementá los siguientes cambios:

---

## 1. WATCHLIST DE ACTIVOS

Reemplazá el input de ticker único por un sistema de watchlist:

- Campo de texto + botón "Agregar" para añadir tickers a la lista
- La watchlist se almacena en estado React (array de strings)
- Límite máximo: 100 activos
- Mostrar cada ticker como un chip/tag eliminable con una X
- Botón "Analizar Todo" que dispara el ciclo completo para todos
  los activos de la watchlist
- Precargá la watchlist con 5 activos por defecto:
  AAPL, MSFT, GOOGL, AMZN, NVDA

---

## 2. TABLA DE RESULTADOS MULTI-ACTIVO

Reemplazá el panel [ANLYTCS] por una tabla donde cada fila es un activo:

| TICKER | PRECIO | SEÑAL | CONFIANZA | P/E | RSI | RIESGO | PESO MAX | STOP LOSS | HORIZONTE |
|--------|--------|-------|-----------|-----|-----|--------|----------|-----------|-----------|

- Señal con color: verde (COMPRA), rojo (VENTA), amarillo (MANTENER)
- Confianza como barra de progreso horizontal
- Riesgo como badge: LOW / MODERATE / HIGH
- Click en una fila expande el detalle completo del activo
  (los 4 agentes + justificación del orquestador)
- Ordenable por cualquier columna

---

## 3. HORIZONTES MULTIPLES POR ACTIVO

Para cada activo analizá tres horizontes en paralelo:

- CORTO (menos de 3 meses): pesos técnico 60%, fundamental 20%, riesgo 20%
- MEDIANO (3-12 meses): pesos técnico 30%, fundamental 50%, riesgo 20%
- LARGO (1-3 años): pesos técnico 10%, fundamental 70%, riesgo 20%

En la tabla principal mostrar el horizonte del perfil del usuario.
En el detalle expandido mostrar los tres horizontes con sus
recomendaciones separadas.

---

## 4. VISTA DE CARTERA AGREGADA

Agregá un panel nuevo [PRT.SUM] PORTFOLIO SUMMARY con:

- Tabla de asignación recomendada: ticker + % de cartera + $ monto
- Validación: suma de pesos no supera 100%
- Alerta si concentración sectorial supera 40%
- Alerta si un activo supera el max_weight del perfil de riesgo
- Total invertido vs capital disponible (cash restante)

---

## 5. PROCESAMIENTO EN LOTES

Para no saturar las APIs con 100 activos simultáneos:

- Procesá en lotes de 5 activos en paralelo (Promise.all de 5)
- Entre lotes, esperar 1 segundo para respetar rate limits
- Mostrar barra de progreso global: "Analizando 15/100 activos..."
- Si un activo falla, marcarlo como [ERR] en la tabla y continuar
  con el siguiente sin detener el proceso

---

## 6. AUTO-REFRESH

- Mover el toggle AUTO-REFRESH fuera del panel de perfil
- Ubicarlo como control global en el header del dashboard
- Cuando está ON, re-analiza toda la watchlist cada 15 minutos
- Mostrar countdown hasta el próximo refresh: "Próximo análisis en 12:34"

---

## RESTRICCIONES

- Mantener el diseño visual actual (tema oscuro, estilo terminal)
- Sin dependencias nuevas salvo las ya existentes
- Sin localStorage ni sessionStorage
- Mantener toda la lógica de los 4 agentes exactamente igual
- El panel [SYS.CFG] y [SIG.OUT] se mantienen pero [SIG.OUT]
  ahora muestra el resumen del activo seleccionado en la tabla
