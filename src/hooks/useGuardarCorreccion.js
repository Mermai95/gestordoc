import { useCallback } from 'react'
import { supabase } from '../lib/supabase'

function generarNota(campo, valorNuevo) {
  switch (campo) {
    case 'pct_iva':
      return `IVA habitual: ${valorNuevo}`
    case 'nif_expedidor':
      return `NIF corregido manualmente a ${valorNuevo}`
    case 'base_imponible':
    case 'cuota_iva':
    case 'deducible':
      return `Importes suelen requerir corrección manual`
    case 'fecha_expedicion':
    case 'fecha_operacion':
      return `Fechas suelen requerir corrección manual`
    case 'expedidor':
      return `Nombre expedidor corregido a "${valorNuevo}"`
    case 'num_factura':
      return `Nº factura suele requerir corrección manual`
    default:
      return `Campo ${campo} corregido manualmente`
  }
}

export function useGuardarCorreccion() {
  const registrarCorreccion = useCallback(async ({ facturaId, nifExpedidor, campo, valorOriginal, valorNuevo }) => {
    const orig = (valorOriginal ?? '').toString()
    const nuevo = (valorNuevo ?? '').toString()
    if (orig === nuevo) return

    await supabase.from('historial_correcciones').insert({
      factura_id: facturaId,
      nif_expedidor: nifExpedidor,
      campo,
      valor_haiku: valorOriginal,
      valor_corregido: valorNuevo,
    })

    if (!nifExpedidor) return

    const { data: existente } = await supabase
      .from('memoria_proveedores')
      .select('id, facturas_corregidas, notas_extraccion')
      .eq('nif_expedidor', nifExpedidor)
      .maybeSingle()

    const nota = generarNota(campo, valorNuevo)

    if (existente) {
      const notasActuales = existente.notas_extraccion || ''
      const notasNuevas = notasActuales.includes(nota)
        ? notasActuales
        : (notasActuales ? notasActuales + '\n' + nota : nota)

      await supabase.from('memoria_proveedores').update({
        facturas_corregidas: (existente.facturas_corregidas || 0) + 1,
        notas_extraccion: notasNuevas,
      }).eq('id', existente.id)
    } else {
      await supabase.from('memoria_proveedores').insert({
        nif_expedidor: nifExpedidor,
        facturas_corregidas: 1,
        notas_extraccion: nota,
      })
    }
  }, [])

  return { registrarCorreccion }
}
