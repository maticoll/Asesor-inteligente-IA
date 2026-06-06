# Criterios de Inversión por Indicador — Investigación para las Reglas de Decisión

**Propósito:** definir las reglas concretas (umbrales numéricos, señal de compra/venta/mantener, lógica y limitaciones) que usarán los agentes del sistema. Este documento es la base para codificar `runTechnicalAgent`, `runFundamentalAgent`, `runRiskAgent` y el prompt del orquestador.

**Fuente:** investigación multi-fuente con verificación. Fuentes principales: Investopedia, Fidelity, Charles Schwab, StockCharts, CFA/CMT Association, Damodaran (NYU Stern, datos sectoriales Ene-2026), Corporate Finance Institute, Vanguard, Wikipedia. Citas al final.

> **Principio rector (todas las fuentes coinciden):** ningún indicador funciona solo ni tiene un umbral universal. Los umbrales de abajo son **valores por defecto, ajustables** — los fundamentales deben compararse contra el sector y la historia de la empresa; los técnicos deben condicionarse al régimen de mercado (tendencia vs. rango). Schwab es explícito: no usar análisis técnico como único método de decisión.

---

## PARTE A — INDICADORES TÉCNICOS (Agente 1)

### A.1 RSI(14) — Relative Strength Index

Oscilador de momentum acotado 0–100, período 14 (Wilder, 1978).

| Condición | Señal | Uso |
|---|---|---|
| RSI < 30 (o < 20 en tendencia fuerte) | Sobreventa → **sesgo compra** | Disparador (mejor en rango) |
| RSI > 70 (o > 80 en tendencia fuerte) | Sobrecompra → **sesgo venta** | Disparador (mejor en rango) |
| RSI cruza arriba de 50 | Sesgo alcista | Filtro de tendencia |
| RSI cruza debajo de 50 | Sesgo bajista | Filtro de tendencia |
| En tendencia alcista, cae a ~40–50 | Comprar la corrección | Entrada ajustada a tendencia |
| En tendencia bajista, rebota a ~50–60 | Vender | Entrada ajustada a tendencia |
| Divergencia alcista (precio baja, RSI sube) | Reversión al alza | Solo confirmación |
| Divergencia bajista (precio sube, RSI baja) | Reversión a la baja | Solo confirmación |

- **70/30 vs 80/20:** usar **70/30 en mercados laterales** (rango), **80/20 en tendencias fuertes** para evitar salidas prematuras (Fidelity recomienda subir a 80 si el activo toca 70 repetidamente).
- **La línea 50 como filtro de tendencia:** por encima de 50, las ganancias promedio superan a las pérdidas → compradores al mando. Usar como filtro direccional, **no como entrada por sí sola**.
- **Limitación crítica (rangos de Constance Brown):** en tendencias fuertes el RSI puede quedarse en sobrecompra/sobreventa por períodos largos — comprar sobreventa / vender sobrecompra a ciegas **falla en mercados con tendencia**. Ajuste: en tendencia alcista el RSI opera ~40–90 (la zona 40–50 actúa como soporte de compra); en tendencia bajista opera ~10–60 (la zona 50–60 actúa como resistencia). **Regla práctica: detectar la tendencia primero (vía SMA o el filtro RSI-50), y solo entonces aplicar reglas de sobrecompra/sobreventa.**
- **Divergencias:** advertencia, no disparador. StockCharts: una tendencia fuerte puede mostrar muchas divergencias bajistas antes del techo real.

### A.2 MACD(12,26,9)

MACD = EMA(12) − EMA(26); Señal = EMA(9) del MACD; Histograma = MACD − Señal. No acotado.

| Condición | Señal | Uso |
|---|---|---|
| MACD cruza **arriba** de la línea señal | **Compra** | Disparador (mejor si MACD > 0) |
| MACD cruza **debajo** de la línea señal | **Venta** | Disparador (mejor si MACD < 0) |
| MACD cruza arriba/debajo de 0 (línea cero) | Régimen alcista/bajista | Filtro de tendencia / gate |
| Histograma > 0 y creciendo | Momentum alcista acelerando | Alerta temprana |
| Histograma > 0 y achicándose | Momentum alcista debilitándose | Alerta temprana |
| Divergencia MACD vs precio | Reversión | Solo confirmación |

- **Cruce de señal:** es la señal más usada. Pero **whipsaws (señales falsas) frecuentes en mercados laterales.**
- **Línea cero como filtro:** solo tomar cruces alcistas cuando MACD > 0, y bajistas cuando MACD < 0. Un cruce de señal por encima de cero es una compra más fuerte que uno por debajo.
- **Histograma:** su giro anticipa el cruce de señal (alerta temprana), no es disparador primario.
- **Limitaciones:** es **rezagado** (basado en EMAs → entradas tardías); **no es comparable entre activos** (el MACD de una acción de $20 no se compara con el de una de $100 — nunca usar valores absolutos entre tickers, solo cruces/signo).

### A.3 Medias Móviles SMA50 / SMA200

| Condición | Señal | Uso |
|---|---|---|
| Precio > SMA (especialmente SMA200) | Sesgo alcista | Filtro de tendencia de fondo |
| Precio < SMA | Sesgo bajista | Filtro de tendencia de fondo |
| **Golden Cross:** SMA50 cruza arriba de SMA200 | **Alcista** (comprar / aumentar) | Señal de medio/largo plazo |
| **Death Cross:** SMA50 cruza debajo de SMA200 | **Bajista** (vender / reducir) | Señal de medio/largo plazo |
| SMA larga con pendiente ascendente | Confirma tendencia alcista | Filtro de confirmación |

- **Pendiente como filtro:** ignorar un Golden Cross si la SMA200 todavía baja — la tendencia no giró de verdad.
- **Períodos estándar:** 50 = tendencia de medio plazo; 200 = tendencia de largo plazo y soporte/resistencia mayor.
- **Limitación:** los cruces son **rezagados** — el Golden/Death Cross llega bien después del piso/techo, así que se pierde buena parte del movimiento inicial. Whipsaws en mercados sin tendencia. Nota de honestidad: los win-rates altos citados (~79–93%) vienen de backtests de blogs, no de educadores primarios; su valor real es **reducir drawdown / mejorar retorno ajustado a riesgo**, no necesariamente superar al buy-and-hold. Tratar como heurística ajustable, no como verdad.

### A.4 Volatilidad (para timing y dimensionamiento)

- **Interpretación:** mayor volatilidad = mayor riesgo e incertidumbre → operar más chico y con más cautela; menor volatilidad → movimientos más predecibles, se puede dimensionar más grande.
- **Dimensionamiento inverso a la volatilidad:** `tamaño de posición ∝ 1 / volatilidad`. Mantiene el riesgo en dólares por operación aproximadamente constante. (Detalle en Parte C.)
- **Stops proporcionales a la volatilidad** (ej. múltiplo de ATR): stops más amplios en mercados volátiles, más ajustados en mercados calmos.
- **Limitación:** la volatilidad histórica es retrospectiva; un período calmo puede preceder a un salto de volatilidad.

### A.5 Soportes y Resistencias

| Condición | Señal | Limitación |
|---|---|---|
| Precio se acerca a soporte establecido | Sesgo compra (stop justo debajo) | Solo mientras el rango aguante |
| Precio se acerca a resistencia establecida | Sesgo venta / tomar ganancia | El nivel se debilita con cada test |
| **Cierre** por encima de resistencia (con volumen alto) | Breakout alcista → compra | Falsos breakouts (trampas) |
| **Cierre** por debajo de soporte (con volumen alto) | Breakdown bajista → venta | Falsos breakdowns |

- **Derivación de niveles:** máximos/mínimos previos, números redondos, y medias móviles como S/R dinámico.
- **Confirmación por volumen:** breakout válido con volumen claramente elevado (heurística citada: ≥ ~50% sobre el promedio de 20 días); volumen débil = sospechoso.
- **Role reversal:** una resistencia rota suele convertirse en soporte (y viceversa).
- **Limitación principal:** son **zonas, no líneas exactas**; los falsos breakouts son el riesgo central. Mitigación: exigir cierre confirmado más allá del nivel y/o esperar el retest.

---

## PARTE B — INDICADORES FUNDAMENTALES (Agente 2)

> **Crítico:** P/E, PEG, ROE, FCF y beta **deben compararse contra la mediana del sector**, no contra un corte absoluto. Un P/E de 79 es normal en software; uno de 30 es caro en una utility. Además, el mercado hoy está caro vs. su historia (S&P 500 P/E ~25–32 vs ~19 histórico; PEG de mercado ~1.9), así que calibrar "lo justo" al régimen actual, no al promedio de manual.

### Tabla de defaults (ajustar por mediana del sector)

| Métrica | Compra / Calidad (buena) | Neutral / Mantener | Venta / Precaución (pobre) | Ajustar por |
|---|---|---|---|---|
| **P/E (trailing)** | < 15 (vs sector) | 15–25 | > 25 (salvo crecimiento que lo justifique) | Mediana del sector + historia propia |
| **ROE** | > 15–20% (poca deuda) | 10–15% | < 10%, o ROE alto con D/E alto | Sector; chequear deuda/D/E |
| **PEG** | < 1.0 | ~1.0 | > 1.0 (esp. > 2.0) | Calidad de la estimación de crecimiento; norma de mercado (~1.9 hoy) |
| **FCF yield** | > 7–8% (sobre Tesoro 10a + 2-3 pts) | 3–7% | < 3% o negativo (si es madura) | Entorno de tasas; intensidad de capex del sector |
| **Crecimiento EPS** | 10–15%+ sostenido | ~5–10% | negativo/volátil/inflado por recompras | Ciclo; calidad de las ganancias |
| **Beta** | < 1 (conservador) | ~1 | > 1 (para aversos al riesgo) | Perfil de riesgo, horizonte, sector |

### B.1 P/E (Price-to-Earnings)
- **Bajo/barato:** < ~15. **Justo:** ~15–20 (promedio histórico S&P 500). **Caro:** > ~25.
- **Trailing vs Forward:** leer ambos. Trailing P/E > Forward P/E ⇒ se esperan ganancias en alza (crecimiento). Trailing < Forward ⇒ se esperan ganancias en baja (advertencia).
- **Matiz sectorial (Damodaran Ene-2026):** software ~79 trailing, semiconductores ~100, biotech ~64 (sectores de alto P/E); bancos ~15, homebuilding ~11, seguros de vida ~13, utilities ~20 (bajo P/E).
- **Limitación:** sin sentido si las ganancias son ~0, negativas o tienen ítems únicos. ~57% de las empresas de EE.UU. tenían pérdidas trailing (Damodaran), así que el P/E queda indefinido para gran parte del mercado.

### B.2 ROE (Return on Equity)
- **Fuerte:** > 15–20% sostenible. **Aceptable:** 12–15%. **Débil:** < 10% consistente.
- **Trampa del apalancamiento:** la deuda reduce el equity (denominador) e infla el ROE. **Siempre cruzar con deuda/D/E** — ROE alto + D/E alto = baja calidad. Complementar con ROA/ROIC.
- **Sector:** capital-intensivos (utilities, manufactura) → ROE más bajo; asset-light (tech) → puede superar 20%.

### B.3 PEG (P/E ÷ tasa de crecimiento)
- **< 1.0:** potencialmente infravalorada vs su crecimiento → sesgo compra. **~1.0:** valuación justa (Lynch: "el P/E de una empresa bien valuada iguala su tasa de crecimiento"). **> 1.0:** potencialmente sobrevalorada; **> 2.0:** poco margen de seguridad → sesgo venta.
- **Limitaciones:** depende 100% de la estimación de crecimiento (un pronóstico). **Ignora dividendos** (penaliza a las maduras que pagan dividendos — variante PEGY lo corrige). Inútil con crecimiento bajo/negativo.

### B.4 Free Cash Flow (FCF) y FCF Yield
- **FCF positivo:** genera caja sobre el capex → puede pagar dividendos, recomprar, bajar deuda. Saludable. **FCF negativo:** quema caja — aceptable en empresas jóvenes de crecimiento, **bandera roja en empresas maduras**.
- **FCF yield (FCF / market cap):** > 7–8% atractivo; 3–7% razonable; < 3% o negativo (si es madura) caro.
- **Regla consciente de tasas:** exigir que el FCF yield supere al Tesoro a 10 años por al menos 2–3 puntos.
- **Limitación:** irregular/cíclico (un año de capex grande lo distorsiona); definiciones varían (apalancado vs no).

### B.5 Crecimiento de EPS
- **Saludable:** ~10–15% anual sostenido (CAGR ~12% como referencia). **Fuerte:** consistente y > 15%. **Precaución:** swings bruscos arriba/abajo (inestable).
- **Calidad de las ganancias:** que el crecimiento venga de ingresos (no solo recorte de costos), que el flujo de caja operativo acompañe al ingreso neto, sin ítems únicos. El EPS inflado por recompras es de menor calidad.
- **Sector:** cíclicos (energía, semis, materiales) tienen swings enormes — juzgar sobre un ciclo completo.

### B.6 Beta
- **< 1:** menos volátil que el mercado → defensivo, menor riesgo. **= 1:** se mueve con el mercado. **> 1:** más volátil → mayor riesgo y potencial retorno. **< 0** (raro): se mueve opuesto (oro/coberturas).
- **Uso en riesgo:** beta escala el riesgo sistémico → mayor beta = mayor penalización al tamaño de posición / menor peso máximo, sobre todo para perfiles conservadores.
- **Limitación:** retrospectiva, inestable, depende de la ventana y el benchmark; solo captura riesgo sistémico, no el idiosincrático. Beta baja ≠ riesgo bajo en términos absolutos.

---

## PARTE C — MÉTRICAS DE RIESGO (Agente 3)

### C.1 VaR al 95% de confianza
- **Interpretación:** un VaR a 1 día al 95% de $X significa que hay un 5% de probabilidad de perder más de $X en un día (no que la pérdida esté topeada en $X). Siempre declarar confianza + horizonte juntos.
- **Método paramétrico (el que conviene implementar):** `VaR = Valor de la posición × z × σ`, con **z = 1.645 para 95%** (2.326 para 99%) y σ = volatilidad del retorno al horizonte (σ diaria para VaR a 1 día). Ejemplo: $500.000 × 1.645 × 7% = **$57.575**.
- **Método histórico (alternativa/complemento):** ordenar los retornos históricos y leer el percentil 5. No asume normalidad → captura colas gruesas. Útil porque ya se tiene `closes[]` del Agente 1.
- **Limitaciones:** la versión paramétrica **asume normalidad y subestima eventos extremos** (colas gruesas); no dice cuánto se pierde más allá del umbral; **no es coherente** (puede penalizar la diversificación). Complemento recomendado: **Expected Shortfall / CVaR** (promedio de las pérdidas en el peor 5%) — Basel III FRTB reemplazó el VaR 99% por ES 97.5%.

### C.2 Volatilidad anualizada
- **Anualización:** `σ anual = σ diaria × √252` (√252 ≈ 15.87). Inversa para VaR diario: `σ diaria = σ anual / √252`.
- **Bandas (mejor citadas, relativas al mercado):**

| Nivel | Volatilidad anualizada |
|---|---|
| **Baja** | < ~15% (en torno o debajo del mercado) |
| **Media** | ~15% – 30% (rango típico de large-caps) |
| **Alta** | > ~30% |
| **Muy alta / especulativa** | > ~50% |

- **Baseline del mercado:** S&P 500 ~15–17% anualizado (V-Lab ~16.95% para 2020–2025). Mapear: en torno al mercado = bajo, hasta ~2× = medio, por encima = alto.
- **Nota de calibración:** el borrador original del proyecto usaba bandas más laxas (media 20–35%, alta >35–40%). Las fuentes apoyan mejor el corte **15/30**. Recomendación: adoptar 15/30, o etiquetar las bandas laxas como "ajustadas a acción individual".
- **Limitación:** es simétrica (penaliza subas y bajas igual), asume normalidad y depende del régimen (se dispara en crisis). Retrospectiva.

### C.3 Ponderación máxima en cartera por perfil de riesgo

**Reglas de diversificación:**
- **Regla del 5%:** no más del 5% de la cartera en un solo activo (default seguro para un asesor automático). Techo duro razonable: 10%. (T. Rowe Price: >5% "amerita atención", >10% "riesgo a planificar ya".)
- **Riesgo por operación:** arriesgar solo 1–3% de la cuenta por trade (dimensionar para que tocar el stop no pierda más que esa fracción) — conecta con el stop-loss del Agente 4.

**Asignación global por perfil (estilo Vanguard):**

| Perfil | Acciones | Bonos/efectivo |
|---|---|---|
| Conservador | 20–40% | 60–80% |
| Moderado | 40–60% | 40–60% |
| Agresivo | 80–100% | 0–20% |

**Tope por posición sugerido para el agente:** Conservador → ~5% por activo; Moderado → ~7–10%; Agresivo → hasta ~10–15% en alta convicción. **Achicar todos los topes a medida que sube la volatilidad/beta del activo.**

- **Beta escala la exposición:** una posición de 5% en un activo de beta 2.0 aporta ~10% de riesgo equivalente al mercado → reducir el tamaño en proporción a la beta.
- **Correlación = riesgo de concentración:** activos muy correlacionados se mueven juntos; una cartera puede parecer diversificada por cantidad de nombres pero estar concentrada por beta/correlación.
- **Referencias avanzadas:** Kelly (`f* = WinRate − (1−WinRate)/(Reward:Risk)`) — usar medio o cuarto de Kelly por el drawdown; sizing fijo-fraccional (base de la regla 1–3%).

---

## PARTE D — COMBINACIÓN DE SEÑALES (Orquestador, Agente 4)

### D.1 Confirmación multi-indicador (y evitar redundancia)
- **Confirmar entre FAMILIAS distintas, no dentro de una:** las cuatro familias son **tendencia** (SMA, MACD), **momentum** (RSI), **volumen** (OBV, volumen vs su media) y **volatilidad** (ATR, Bollinger). Apilar RSI + Estocástico + CCI (todos momentum) es **falsa confirmación** — cuentan como un solo voto.
- **RSI + MACD no son redundantes:** RSI mide velocidad/momentum, MACD mide separación de medias/tendencia → se complementan.
- **Límite:** 2–4 indicadores en total, uno por familia. El volumen confirma los breakouts.

### D.2 Resolución de señales contradictorias
- **Caso A — Técnico vs Fundamental:** separación de roles — **el fundamental decide qué/si comprar; el técnico decide cuándo entrar/salir.** Un fundamental claramente negativo es un **veto** sobre poseer el activo (sobre todo a largo plazo); un técnico positivo solo gobierna el timing. El veto es un prior fuerte, no un candado absoluto (un técnico fuerte puede señalar cambios aún no reflejados en los fundamentales).
- **Caso B — Momentum vs Tendencia (dentro de lo técnico):** **priorizar la tendencia / el timeframe mayor.** (Stat citada: ~58% win-rate con alineación entre timeframes vs ~39% sin alineación.)
- **Caso C — Indicadores en conflicto en el mismo timeframe:** en orden de preferencia: (1) **esperar / HOLD** (tamaño cero hasta que se alineen — saltarse un setup mixto es control de riesgo, no oportunidad perdida); (2) reducir tamaño y confianza; (3) desempatar por la tendencia dominante; (4) exigir confirmación por cierre.

### D.3 Ponderación por horizonte temporal (valida el diseño del proyecto)
Las fuentes coinciden firmemente en la **dirección** del ajuste (no en porcentajes exactos — los de abajo son defaults ajustables):

| Horizonte | Técnico | Fundamental | Riesgo |
|---|---|---|---|
| Corto (días–semanas) | ~60% | ~15% | ~25% |
| Medio (meses) | ~40% | ~35% | ~25% |
| Largo (1 año+) | ~15% | ~60% | ~25% |

El peso de riesgo se mantiene ~constante (es una restricción/sizing, no una señal direccional).

### D.4 Sistema de scoring compuesto
- Cada agente emite un **sub-score normalizado (−1 a +1) + confianza**, no solo compra/venta.
- El orquestador computa un **compuesto ponderado por horizonte y ajustado por régimen**. Empezar con **pesos iguales/heurísticos transparentes** (documentados); evitar pesos optimizados salvo que se backtesteen across-regímenes (FactSet advierte que la optimización sobreajusta out-of-sample).
- Mapear el grado de acuerdo → `confidence_score` y `portfolio_weight`. Exigir ≥2 confirmaciones independientes para una acción distinta de HOLD.
- **HOLD es una salida de primera clase**, no un fallback: conflicto o baja confirmación → confianza baja y peso reducido, o HOLD.

### D.5 Limitaciones del enfoque por reglas
- **Sobreoptimización / curve-fitting:** el modo de falla dominante. Mantener el set de reglas chico y explicable; validar out-of-sample across regímenes; sospechar de reglas afinadas a un solo régimen.
- **Redundancia de indicadores:** no doble-contar señales de la misma familia.
- **Dependencia del régimen:** lo que funciona en tendencia falla en rango y viceversa → añadir un **clasificador de régimen** ligero (ej. estructura SMA50/200, o ancho de Bollinger/ATR) que condicione qué reglas se aplican y con qué peso. La confianza debe ser **menor** en regímenes ambiguos.

---

## PARTE E — IMPLICANCIAS DIRECTAS PARA EL CÓDIGO

1. **Detectar el régimen primero.** Antes de aplicar RSI 30/70, clasificar tendencia vs rango (vía SMA50/200 y/o pendiente). En tendencia, cambiar a los rangos de Brown (alcista 40–90, bajista 10–60) y suprimir la lógica de reversión a la media.
2. **Cada agente devuelve sub-score normalizado (−1..+1) + confianza**, además de la señal categórica. Esto permite que el orquestador pondere limpio.
3. **Filtros vs disparadores:** RSI-50 y línea-cero de MACD son **filtros de tendencia**; 30/70 (u 80/20) y cruces de señal son **disparadores solo en la dirección permitida por el filtro**. Divergencias e histograma son solo confirmación.
4. **Fundamentales siempre relativos al sector.** Cargar medianas por sector (la tabla de Damodaran sirve de ancla) y comparar contra ellas, no contra cortes absolutos. Calibrar "lo justo" al régimen de mercado actual (hoy caro).
5. **Cruzar ROE con deuda y EPS con ingresos/recompras** para no premiar calidad falsa.
6. **VaR paramétrico** con z=1.645; reportar también ES/CVaR usando `closes[]` cuando se pueda. Bandas de volatilidad 15/30. 
7. **Ponderación máxima por perfil** (5/10/15%) escalada hacia abajo por beta y volatilidad; riesgo por trade 1–3% para derivar el stop.
8. **Orquestador:** ponderar técnico/fundamental/riesgo por horizonte (tabla D.3), aplicar veto fundamental a largo plazo, exigir ≥2 confirmaciones para no-HOLD, y bajar la confianza en conflicto o régimen ambiguo. HOLD de primera clase.

---

## Fuentes

**Técnicos (RSI/MACD):**
- Fidelity — RSI guide: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI
- Charles Schwab — overbought/oversold: https://www.schwab.com/learn/story/how-to-tell-if-market-is-overbought-or-oversold
- StockCharts ChartSchool — RSI: https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi
- CMT Association — RSI / Constance Brown ranges: https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly/
- Fidelity — MACD: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/macd
- StockCharts — MACD: https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/macd-moving-average-convergence-divergence-oscillator

**Tendencia / precio (SMA, volatilidad, S/R):**
- StockCharts — Moving Averages: https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential
- Fidelity — Moving averages: https://www.fidelity.com/viewpoints/active-investor/moving-averages
- Fidelity — Support and Resistance: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance
- Schwab — Support and Resistance: https://www.schwab.com/learn/story/use-support-and-resistance-to-read-stock-charts
- StatsEdge (contrapunto Golden Cross): https://letters.statsedgetrading.com/p/the-golden-cross-has-an-86-win-rate

**Fundamentales:**
- Damodaran / NYU Stern — P/E & PEG por sector (Ene-2026): https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pedata.html
- Schwab — P/E ratio: https://www.schwab.com/learn/story/stock-analysis-using-pe-ratio
- Corporate Finance Institute — FCF yield: https://corporatefinanceinstitute.com/resources/valuation/free-cash-flow-yield/
- Corporate Finance Institute — Beta: https://corporatefinanceinstitute.com/resources/valuation/what-is-beta-guide/
- Wikipedia — PEG ratio: https://en.wikipedia.org/wiki/PEG_ratio
- Multpl — S&P 500 P/E history: https://www.multpl.com/s-p-500-pe-ratio

**Riesgo:**
- Ryan O'Connell, CFA — Value at Risk: https://ryanoconnellfinance.com/value-at-risk/
- Wikipedia — Coherent risk measure (VaR no coherente): https://en.wikipedia.org/wiki/Coherent_risk_measure
- The Motley Fool — Annualized Volatility: https://www.fool.com/investing/how-to-calculate/annualized-volatility/
- NYU Stern V-Lab — S&P 500 volatility: https://vlab.stern.nyu.edu/volatility/VOL.SPX:IND-R.GARCH
- Kiplinger — 5% diversification rule: https://www.kiplinger.com/investing/the-5-percent-diversification-rule-your-secret-weapon-for-smarter-investing
- Vanguard — Asset Allocation Models: https://investor.vanguard.com/investor-resources-education/education/model-portfolio-allocation

**Combinación de señales:**
- Schwab — Fundamentals vs Technicals: https://www.schwab.com/learn/story/how-to-pick-stocks-using-fundamental-and-technical-analysis
- Fidelity — Using Technical Analysis: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/using-technical-analysis
- FactSet — Weighting Signals: https://insight.factset.com/a-practical-approach-to-weighting-signals

> **Nota de honestidad metodológica:** los porcentajes de ponderación por horizonte (D.3) y varios win-rates (Golden Cross, alineación de timeframes, umbrales de volumen) son **heurísticas de fuentes secundarias/backtests**, no constantes autoritativas. La *dirección* de cada regla está bien respaldada; los *números exactos* deben tratarse como parámetros ajustables y, idealmente, backtestearse. Este sistema produce información, no asesoría financiera, y no ejecuta órdenes.
