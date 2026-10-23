import { loadData, getHolidays, getEstadisticasReport } from '../services/dataStore.js';

async function main() {
  await loadData();
  const hol = getHolidays();
  console.log('Feriados registrados count:', hol.length);
  const octHol = hol.filter(h => h.fecha.startsWith('2026-10'));
  console.log('Feriados Octubre 2026:', octHol);

  const res = getEstadisticasReport({
    fechaDesde: '2026-10-01',
    fechaHasta: '2026-10-19',
    exportAll: true
  });
  
  const sistemas = res.data.filter(d => d.departamento === 'P_Sistemas' || d.legajo === '9851' || d.legajo === '9854');
  console.log('=== P_SISTEMAS COMPARATIVA CON CROSSCHEX ===');
  sistemas.forEach(d => {
    console.log(`- ${d.nombre} (${d.legajo}):`);
    console.log(`  * Laborales: ${d.laboralesDias} días (Antes: 19 | CrossChex: 13)`);
    console.log(`  * Trabajados: ${d.trabajadosDias} días (CrossChex: 11 / 10)`);
    console.log(`  * Tardanzas: ${d.llegadasTardeMin} min (Antes: 291/258 | CrossChex: 464 / 397)`);
    console.log(`  * Salidas temprano: ${d.salidasTempranoMin} min (Antes: 0 | CrossChex: 1)`);
    console.log(`  * Ausente: ${d.ausenteDias} días (Antes: 7 / 8 | CrossChex: 2)`);
    console.log(`  * Feriados: ${d.feriadosDias} días (12 de Octubre)`);
    console.log(`  * Licencias: ${d.licenciasDias} días (${d.licenciasDetalle || 'Ninguna'})`);
    console.log(`  * Descansos/Francos: ${d.descansosDias} días`);
  });
}

main().catch(console.error);
