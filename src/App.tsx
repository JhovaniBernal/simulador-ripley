import { useState, useMemo, useEffect } from "react";
import { addMonths, differenceInDays, format, setDate, isBefore, isSameDay, endOfMonth, subMonths } from "date-fns";

// --- UTILIDADES ---
const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

// XIRR (TIR.NO.PER)
const calculateXIRR = (values: number[], dates: Date[], guess = 0.1) => {
  const tol = 1e-6; const maxIter = 100; let xirr = guess;
  for (let i = 0; i < maxIter; i++) {
    let fValue = 0, fDerivative = 0;
    for (let j = 0; j < values.length; j++) {
      const days = differenceInDays(dates[j], dates[0]);
      const years = days / 365.0;
      const denominator = Math.pow(1 + xirr, years);
      fValue += values[j] / denominator;
      fDerivative -= (years * values[j]) / (denominator * (1 + xirr));
    }
    const newXirr = xirr - fValue / fDerivative;
    if (Math.abs(newXirr - xirr) < tol) return newXirr * 100;
    xirr = newXirr;
  }
  return 0;
};

// --- CONFIGURACIÓN ---
const SEGUROS = {
  NONE: { label: "No Contrata Seguro", rate: 0 },
  SIN_RESCATE: { label: "Sí - Sin Rescate (0.30%)", rate: 0.30 },
  CON_RESCATE: { label: "Sí - Con Rescate (0.35%)", rate: 0.35 },
};

// Interfaces
interface FilaPlan {
  numero: number;
  fechaPago: string;
  dias: number;
  diasVisual: number;
  capitalInicial: number;
  capitalVisual: number;
  amortizacion: number;
  interes: number;
  seguro: number;
  cuota: number;
  saldoFinal: number;
}

// Interface interna para el simulador real
interface DetalleSimulacion {
  amortizacion: number;
  interes: number;
  seguro: number;
  saldoReal: number;
}

function App() {

  // ======================================================================
  // 🔐 SISTEMA DE BLOQUEO Y PRUEBA (TRIAL SYSTEM)
  // ======================================================================
  const HORAS_DE_PRUEBA = 0.005; // <--- Cambia aquí las horas de prueba
  const CLAVE_SECRETA = "Jhovani2033+*"; // <--- Tu contraseña de desbloqueo

  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // Si ya está desbloqueado, no hacemos nada
    if (localStorage.getItem("ripley_unlocked") === "true") return;

    let endTimeStr = localStorage.getItem("ripley_endtime");
    if (!endTimeStr) {
      // Si es la primera vez, crea la fecha límite
      const newEndTime = Date.now() + HORAS_DE_PRUEBA * 3600 * 1000;
      localStorage.setItem("ripley_endtime", newEndTime.toString());
      endTimeStr = newEndTime.toString();
    }

    const endTime = parseInt(endTimeStr);

    const timer = setInterval(() => {
      const now = Date.now();
      const remaining = Math.floor((endTime - now) / 1000);

      if (remaining <= 0) {
        setTimeLeft(0);
        setIsLocked(true);
        clearInterval(timer);
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const unlockApp = () => {
    if (passInput === CLAVE_SECRETA) {
      localStorage.setItem("ripley_unlocked", "true");
      setIsLocked(false);
      setErrorMsg("");
    } else {
      setErrorMsg("Contraseña incorrecta ❌");
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };
  // ======================================================================


  // --- INPUTS ---
  const [monto, setMonto] = useState<number | "">("");
  const [tea, setTea] = useState<number | "">("");
  const [plazo, setPlazo] = useState<number | "">("");
  const [fechaDesembolso, setFechaDesembolso] = useState<string>("");
  const [diaPago, setDiaPago] = useState<number | "">("");
  const [tasaSeguro, setTasaSeguro] = useState<number>(0.30);

  const limpiarFormulario = () => {
    setMonto(""); setTea(""); setPlazo(""); setFechaDesembolso(""); setDiaPago(""); setTasaSeguro(0.30);
  };

  // --- LÓGICA DE NEGOCIO ---
  const { planPagos, cuotaFija, tceaCalculada, infoPeriodo0 } = useMemo(() => {
    if (!monto || !tea || !plazo || !fechaDesembolso || !diaPago) {
      return { planPagos: [], cuotaFija: 0, tceaCalculada: 0, infoPeriodo0: null };
    }

    const m = Number(monto);
    const t = Number(tea);
    const p = Number(plazo);
    const d = Number(diaPago);
    const fechaBase = new Date(fechaDesembolso + "T00:00:00");

    if (d < 1 || d > 31) return { planPagos: [], cuotaFija: 0, tceaCalculada: 0, infoPeriodo0: null };

    // 1. FECHAS
    let primerPago = setDate(fechaBase, d);
    if (isBefore(primerPago, fechaBase) || isSameDay(primerPago, fechaBase)) primerPago = addMonths(primerPago, 1);
    if (differenceInDays(primerPago, fechaBase) < 29) primerPago = addMonths(primerPago, 1);

    // 2. PERIODO 0 (Para cálculo REAL)
    const fechaCortePeriodo0 = endOfMonth(subMonths(primerPago, 1));
    let montoCapitalizado = m;
    let interesP0 = 0, seguroP0 = 0, diasP0 = 0;
    let existePeriodo0 = false;
    const ted = Math.pow(1 + t / 100, 1.0 / 360.0) - 1;

    if (isBefore(fechaBase, fechaCortePeriodo0)) {
      existePeriodo0 = true;
      diasP0 = differenceInDays(fechaCortePeriodo0, fechaBase);
      interesP0 = round2(m * (Math.pow(1 + ted, diasP0) - 1));
      seguroP0 = round2(m * (tasaSeguro / 100));
      montoCapitalizado = m + interesP0 + seguroP0;
    }

    // 3. GENERAR FECHAS
    const fechasCronograma: Date[] = [];
    let fechaActualCuota = primerPago;
    for (let i = 0; i < p; i++) {
      fechasCronograma.push(new Date(fechaActualCuota));
      fechaActualCuota = addMonths(fechaActualCuota, 1);
    }

    // 4. SIMULADOR REAL (MOTOR PURO SIN REDONDEO - RESTAURADO)
    // ESTA ES LA CLAVE: No usar round2() aquí para que el Solver encuentre la cuota exacta.
    const simularReal = (cuotaTanteo: number) => {
      let saldo = montoCapitalizado;
      let fechaAnterior = existePeriodo0 ? fechaCortePeriodo0 : fechaBase;
      const lista: DetalleSimulacion[] = [];

      fechasCronograma.forEach((fechaPago) => {
        const fPago = new Date(fechaPago); fPago.setHours(0, 0, 0, 0);
        const fAnt = new Date(fechaAnterior); fAnt.setHours(0, 0, 0, 0);
        const dias = differenceInDays(fPago, fAnt);

        // SIN REDONDEO INTERNO (Como VBA)
        const interes = saldo * (Math.pow(1 + ted, dias) - 1);
        const seguro = saldo * (tasaSeguro / 100);
        const amortizacion = cuotaTanteo - interes - seguro;

        lista.push({
          amortizacion: amortizacion,
          interes: interes,
          seguro: seguro,
          saldoReal: saldo
        });

        saldo -= amortizacion;
        fechaAnterior = fPago;
      });
      return { saldoFinal: saldo, detalle: lista };
    };

    // 5. SOLVER (Búsqueda de alta precisión)
    let min = 0, max = montoCapitalizado * 2.5, cuotaOptima = 0;
    for (let i = 0; i < 200; i++) {
      cuotaOptima = (min + max) / 2;
      const res = simularReal(cuotaOptima);
      if (res.saldoFinal > 0.0000001) min = cuotaOptima;
      else if (res.saldoFinal < -0.0000001) max = cuotaOptima;
      else break;
    }

    // Obtenemos los datos FINALES del motor (aquí si podemos redondear para mostrar)
    // PERO ojo, para la tabla "Sombra" necesitamos la cuota exacta sin redondear.
    const resultadoReal = simularReal(cuotaOptima);

    // 6. SIMULADOR SOMBRA (PARALELO - "MAQUILLAJE")
    // Usa el Monto Original + Cuota Optima (Exacta)
    const generarCapitalesSombra = () => {
      let saldoSombra = m;
      let fechaAnterior = fechaBase;
      const capitales: number[] = [];

      fechasCronograma.forEach((fechaPago, index) => {
        const fPago = new Date(fechaPago); fPago.setHours(0, 0, 0, 0);

        let fAnt = new Date(fechaAnterior); fAnt.setHours(0, 0, 0, 0);
        let diasCalc = differenceInDays(fPago, fAnt);

        if (index === 0 && existePeriodo0) {
          fAnt = new Date(fechaBase); fAnt.setHours(0, 0, 0, 0);
          diasCalc = differenceInDays(fPago, fAnt);
        } else if (index > 0) {
          fAnt = new Date(fechasCronograma[index - 1]); fAnt.setHours(0, 0, 0, 0);
          diasCalc = differenceInDays(fPago, fAnt);
        }

        // Calculamos componentes "Fantasma" solo para reducir el capital sombra
        // Aquí usamos round2 porque esto es lo que se muestra visualmente
        const intSombra = round2(saldoSombra * (Math.pow(1 + ted, diasCalc) - 1));
        const segSombra = round2(saldoSombra * (tasaSeguro / 100));
        // OJO: Usamos cuotaOptima redondeada visualmente para la resta, o exacta?
        // El Excel suele usar la cuota visual (2 decimales) para descontar saldo visual.
        const cuotaVisual = round2(cuotaOptima);
        const amortSombra = round2(cuotaVisual - intSombra - segSombra);

        capitales.push(saldoSombra);

        saldoSombra -= amortSombra;
        fechaAnterior = fPago;
      });
      return capitales;
    };

    const capitalesVisuales = generarCapitalesSombra();

    // 7. FUSIÓN (MERGE)
    const cronogramaFinal: FilaPlan[] = resultadoReal.detalle.map((filaReal, index) => {
      const fechaPago = new Date(fechasCronograma[index]);
      let diasVis = 0;

      if (index === 0) {
        const fAnt = new Date(fechaBase);
        diasVis = differenceInDays(fechaPago, fAnt);
      } else {
        diasVis = differenceInDays(fechaPago, new Date(fechasCronograma[index - 1]));
      }

      return {
        numero: index + 1,
        fechaPago: format(fechaPago, 'dd/MM/yyyy'),
        dias: 0,
        diasVisual: diasVis,

        // --- EL MAQUILLAJE ---
        capitalInicial: capitalesVisuales[index],
        capitalVisual: capitalesVisuales[index],

        // --- LA REALIDAD FINANCIERA (Redondeada para display) ---
        amortizacion: round2(filaReal.amortizacion),
        interes: round2(filaReal.interes),
        seguro: round2(filaReal.seguro),
        cuota: round2(cuotaOptima),
        saldoFinal: 0
      };
    });

    // TCEA
    const flujosXIRR = [-m];
    const fechasXIRR = [fechaBase];
    cronogramaFinal.forEach(c => {
      flujosXIRR.push(c.cuota);
      const parts = c.fechaPago.split('/');
      fechasXIRR.push(new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])));
    });

    return {
      planPagos: cronogramaFinal,
      cuotaFija: cuotaOptima,
      tceaCalculada: calculateXIRR(flujosXIRR, fechasXIRR),
      infoPeriodo0: existePeriodo0 ? {
        dias: diasP0, interes: interesP0, seguro: seguroP0, nuevoMonto: montoCapitalizado,
        fechaCorte: format(fechaCortePeriodo0, 'dd/MM/yyyy')
      } : null
    };

  }, [monto, tea, plazo, fechaDesembolso, diaPago, tasaSeguro]);

  const fmt = (n: number) => new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  // ======================================================================
  // 🛑 PANTALLA DE BLOQUEO (Se activa si isLocked es true)
  // ======================================================================
  if (isLocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute w-96 h-96 bg-[#4F2D7F] rounded-full blur-[100px] opacity-40 -top-20 -left-20 animate-pulse"></div>
        <div className="absolute w-96 h-96 bg-yellow-600 rounded-full blur-[100px] opacity-20 bottom-0 right-0"></div>

        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl shadow-2xl w-full max-w-md text-center z-10">
          <div className="text-7xl mb-4 drop-shadow-lg">🔒</div>
          <h2 className="text-2xl font-extrabold text-white mb-2">Tiempo de Prueba Expirado</h2>
          <p className="text-slate-300 mb-8 text-sm leading-relaxed">
            Ingresa la clave de autorización del desarrollador para desbloquear el sistema de forma permanente.
          </p>

          <div className="space-y-4">
            <input
              type="password"
              placeholder="Ingresa la contraseña..."
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlockApp()}
              className="w-full p-3.5 bg-slate-800/50 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-[#4F2D7F] outline-none text-center tracking-widest"
            />
            {errorMsg && <p className="text-red-400 text-xs font-semibold animate-bounce">{errorMsg}</p>}

            <button
              onClick={unlockApp}
              className="w-full bg-[#4F2D7F] hover:bg-purple-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all"
            >
              Desbloquear Sistema
            </button>
          </div>
          <p className="mt-8 text-xs text-slate-500">Desarrollado: By Jhovani 👨‍💻</p>
        </div>
      </div>
    );
  }

  // ======================================================================

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4 font-sans text-gray-800 flex justify-center items-start">
      <div className="bg-white w-full max-w-7xl rounded-2xl shadow-xl overflow-hidden border border-gray-200">

        {/* HEADER */}
        <div className="bg-[#4F2D7F] p-6 flex flex-col md:flex-row justify-between items-center border-b-4 border-yellow-400">
          <div className="flex items-center gap-5 mb-4 md:mb-0">
            <div className="h-12 w-12 bg-white rounded-full flex items-center justify-center shadow-lg">
              <span className="text-[#4F2D7F] text-3xl font-extrabold pb-1">R</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold text-white tracking-tight leading-none">
                Simulador de Crédito
                {/* ⏳ BADGE DEL CONTADOR DE TIEMPO */}
                {timeLeft !== null && timeLeft > 0 && localStorage.getItem("ripley_unlocked") !== "true" && (
                  <span className="bg-yellow-400 text-yellow-900 text-[10px] uppercase font-extrabold px-2 py-1 rounded-md shadow-sm animate-pulse">
                    ⏱️ {formatTime(timeLeft)}
                  </span>
                )}
              </h1>
              <p className="text-purple-200 text-sm font-medium mt-1">
                Banco Ripley Perú
              </p>
            </div>
          </div>
          <button onClick={limpiarFormulario} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-5 py-2.5 rounded-lg font-semibold transition-all text-sm backdrop-blur-md">
            🗑️ Limpiar Todo
          </button>
        </div>

        <div className="p-4 md:p-8">
          <div className="grid lg:grid-cols-12 gap-8">
            {/* INPUTS */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h2 className="font-bold text-lg mb-4 text-gray-700 pb-2 border-b">Configuración del Préstamo</h2>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Monto (S/.)</label>
                    <input type="number" placeholder="Ej: 50000" value={monto} onChange={e => setMonto(e.target.value === "" ? "" : Number(e.target.value))} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] focus:border-[#4F2D7F] outline-none transition bg-gray-50" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">TEA (%)</label>
                      <input type="number" placeholder="Ej: 20.84" value={tea} onChange={e => setTea(e.target.value === "" ? "" : Number(e.target.value))} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] outline-none bg-gray-50" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Día Pago</label>
                      <input type="number" min="1" max="31" placeholder="1 - 31" value={diaPago} onChange={e => setDiaPago(e.target.value === "" ? "" : Number(e.target.value))} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] outline-none bg-gray-50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Seguro Desgravamen</label>
                    <select value={tasaSeguro} onChange={e => setTasaSeguro(Number(e.target.value))} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] outline-none text-sm bg-gray-50">
                      <option value={SEGUROS.NONE.rate}>{SEGUROS.NONE.label}</option>
                      <option value={SEGUROS.SIN_RESCATE.rate}>{SEGUROS.SIN_RESCATE.label}</option>
                      <option value={SEGUROS.CON_RESCATE.rate}>{SEGUROS.CON_RESCATE.label}</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Desembolso</label>
                      <input type="date" value={fechaDesembolso} onChange={e => setFechaDesembolso(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] outline-none bg-gray-50" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Plazo</label>
                      <input type="number" placeholder="Meses" value={plazo} onChange={e => setPlazo(e.target.value === "" ? "" : Number(e.target.value))} className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#4F2D7F] outline-none bg-gray-50" />
                    </div>
                  </div>
                </div>
              </div>

              {/* RESUMEN */}
              {planPagos.length > 0 && (
                <div className="bg-[#F8F5FC] p-5 rounded-xl border border-purple-100 text-center animate-fade-in shadow-inner">
                  <span className="block text-xs uppercase tracking-widest text-gray-500 mb-1">Cuota Fija Mensual</span>
                  <span className="block text-4xl font-extrabold text-[#4F2D7F]">S/ {fmt(cuotaFija)}</span>

                  {infoPeriodo0 && (
                    <div className="mt-3 bg-yellow-50 p-2 rounded text-[10px] text-left border border-yellow-200 text-yellow-800 flex items-start gap-2">
                      <span className="text-lg">⚠️</span>
                      <div>
                        <strong>Periodo 0 (Capitalización):</strong><br />
                        Interés ({fmt(infoPeriodo0.interes)}) + Seguro ({fmt(infoPeriodo0.seguro)}) se sumaron al capital inicial.
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between mt-4 pt-3 border-t border-purple-200">
                    <div className="text-center w-1/2 border-r border-purple-200">
                      <span className="block text-xs text-gray-500">TCEA</span>
                      <span className="font-bold text-[#4F2D7F] text-sm">{fmt(tceaCalculada)}%</span>
                    </div>
                    <div className="text-center w-1/2">
                      <span className="block text-xs text-gray-500">Total Intereses</span>
                      <span className="font-bold text-gray-700 text-sm">{fmt(planPagos.reduce((a, b) => a + b.interes, 0))}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* TABLA */}
            <div className="lg:col-span-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-700">Cronograma de Pagos</h2>
                {planPagos.length > 0 && (
                  <span className="bg-[#4F2D7F] text-white text-xs font-bold px-3 py-1 rounded-full">
                    {planPagos.length} Cuotas
                  </span>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-[600px] flex flex-col shadow-sm">
                <div className="overflow-auto flex-1 custom-scrollbar">
                  {planPagos.length > 0 ? (
                    <table className="w-full text-right text-sm">
                      <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-xs sticky top-0 shadow-sm z-10">
                        <tr>
                          <th className="p-4 text-center">N°</th>
                          <th className="p-4 text-center">Fecha</th>
                          <th className="p-4">Días</th>
                          <th className="p-4">Capital</th>
                          <th className="p-4">Amortiz.</th>
                          <th className="p-4">Interés</th>
                          <th className="p-4">Seguro</th>
                          <th className="p-4 text-[#4F2D7F] bg-purple-50">Cuota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {planPagos.map((fila) => (
                          <tr key={fila.numero} className="hover:bg-purple-50 transition-colors group">
                            <td className="p-3 text-center text-gray-500 font-mono">{fila.numero}</td>
                            <td className="p-3 text-center font-medium text-gray-700">{fila.fechaPago}</td>
                            <td className={`p-3 font-bold ${fila.diasVisual > 30 ? 'text-[#4F2D7F]' : 'text-gray-400'}`}>{fila.diasVisual}</td>

                            {/* COLUMNA CAPITAL (SOMBRA) */}
                            <td className="p-3 text-gray-500">{fmt(fila.capitalVisual)}</td>

                            {/* COLUMNAS REALES (MOTOR FINANCIERO) */}
                            <td className="p-3 font-medium text-green-600">{fmt(fila.amortizacion)}</td>
                            <td className="p-3 text-gray-600">{fmt(fila.interes)}</td>
                            <td className="p-3 text-gray-500">{fmt(fila.seguro)}</td>
                            <td className="p-3 font-bold text-[#4F2D7F] bg-purple-50/50">{fmt(fila.cuota)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                      <div className="text-6xl opacity-20 grayscale">🏦</div>
                      <p className="font-medium">Ingresa los datos para simular</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 border-t border-gray-200 p-4 flex justify-between items-center">
          <p className="text-xs text-gray-400">* Referencial. Sujeto a evaluación crediticia.</p>
          <p className="text-xs text-gray-400 font-mono tracking-wider">Desarrollado: <span className="font-bold text-[#4F2D7F]">By Jhovani</span> 👨‍💻</p>
        </div>
      </div>
    </div>
  );
}

export default App;