import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'pdf-lib'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT = `Eres un experto contable español especializado en lectura de facturas para gestorías.
Tu tarea es extraer datos fiscales con máxima precisión.

INSTRUCCIONES CRÍTICAS:
1. Lee TODOS los tipos de IVA que aparezcan en la factura — nunca asumas solo 21%.
2. Los tipos válidos en España son: 0%, 4%, 5%, 10%, 21%. Léelos directamente del documento.
3. Si hay MÚLTIPLES tipos de IVA, crea una línea por cada tipo.
4. La línea principal es la de mayor base imponible. El resto van en lineas_extra.
5. Si es ABONO o RECTIFICATIVA (importes negativos, dice "abono", "nota de crédito", "rectificativa"), pon tipo "abono" e importes en negativo.
6. El campo "deducible" = igual que "cuota_iva" salvo que indique explícitamente que no es deducible.
7. Si la página está en blanco o no es una factura, responde: {"es_factura": false}
8. IMPORTANTE sobre paginación:
   - Si ves "Página X de Y" pero la factura está COMPLETA en esta página (tiene totales, base imponible, IVA), entonces NO es página múltiple — es simplemente su posición dentro de un lote de facturas. No pongas advertencia.
   - Solo marca "posible_pagina_multiple": true si hay evidencia real de que la factura CONTINÚA en otra página: falta de totales, falta de base imponible/IVA, texto cortado, "continúa en la siguiente página", mismo número de factura sin resumen final.
   - En caso de duda, marca "posible_pagina_multiple": true para que el contable lo revise.
9. Si no ves claramente una fecha, deja el campo como string vacío "", NUNCA escribas texto como "sin fecha visible", "ilegible", "no visible" o similar en campos de fecha.

FORMATOS ESPECIALES DE IVA:
- Makro usa códigos: 1=10%, 2=21%, 3=21%, 5=4% — tradúcelos al porcentaje real.
- Algunas facturas ponen "IVA Reducido", "IVA Superreducido" — tradúcelos a 10% y 4%.
- Si ves "Exento" o "Exenta" → 0%.
- Si ves "RE" o "Recargo de equivalencia" → es un tipo separado, inclúyelo en lineas_extra.

NÚMERO DE FACTURA:
- Cópialo exactamente como aparece, con guiones, barras y letras.
- Si no aparece claramente, pon lo más parecido que veas.

NIF DEL EXPEDIDOR — REGLA CRÍTICA:
- El nif_expedidor es SIEMPRE el NIF/CIF del EMISOR de la factura (el proveedor que cobra).
- Búscalo en el bloque SUPERIOR de la factura: nombre del proveedor + dirección + razón social.
- NUNCA uses el NIF que aparezca en campos como "Datos del receptor", "Cliente", "Número NIF de cliente", "Razón social del cliente", o cualquier bloque inferior.
- Si ves dos NIFs en la factura, el del EMISOR es el que está en la cabecera junto al nombre del proveedor. El otro es del receptor — ignóralo para este campo.
- Si no podés determinar con certeza cuál es el del emisor, pon confianza "baja" y explícalo en notas.

DATOS DEL RECEPTOR (CLIENTE):
- Buscá en el bloque de la DERECHA o inferior de la factura donde dice "Datos del cliente", "Receptor", "Destinatario", "Facturado a", etc.
- Extraé: receptor_nombre (razón social), receptor_email (si aparece), receptor_telefono (si aparece).
- Si no ves email o teléfono del receptor, dejá el campo como string vacío "".

RESPONDE SOLO CON ESTE JSON (sin texto, sin backticks):
{
  "num_factura": "número exacto",
  "fecha_expedicion": "DD/MM/YYYY",
  "fecha_operacion": "DD/MM/YYYY o vacío",
  "concepto": "Su fra. nº [num_factura] — [nombre expedidor corto]",
  "nif_expedidor": "NIF o CIF sin espacios",
  "expedidor": "nombre completo del emisor",
  "receptor_nombre": "nombre o razón social del receptor",
  "receptor_email": "email del receptor o vacío",
  "receptor_telefono": "teléfono del receptor o vacío",
  "tipo": "factura o abono",
  "base_imponible": 0.00,
  "pct_iva": "21,0",
  "cuota_iva": 0.00,
  "deducible": 0.00,
  "confianza": "alta|media|baja",
  "posible_pagina_multiple": false,
  "notas": "observaciones relevantes o vacío",
  "lineas_extra": [
    { "base_imponible": 0.00, "pct_iva": "10,0", "cuota_iva": 0.00, "deducible": 0.00 }
  ]
}

EJEMPLO REAL — Makro con 3 tipos de IVA:
{
  "num_factura": "2500002982",
  "fecha_expedicion": "01/01/2025",
  "concepto": "Su fra. nº 2500002982 — MAKRO",
  "nif_expedidor": "A28206493",
  "expedidor": "MAKRO AUTOSERVICIO MAYORISTA SA",
  "receptor_nombre": "MYSTYLE MYLOVE LUCKY 2022 S.L.",
  "receptor_email": "",
  "receptor_telefono": "",
  "tipo": "factura",
  "base_imponible": 214.16,
  "pct_iva": "21,0",
  "cuota_iva": 44.97,
  "deducible": 44.97,
  "confianza": "alta",
  "notas": "",
  "lineas_extra": [
    { "base_imponible": 8.24, "pct_iva": "10,0", "cuota_iva": 0.82, "deducible": 0.82 },
    { "base_imponible": 1.49, "pct_iva": "4,0",  "cuota_iva": 0.06, "deducible": 0.06 }
  ]
}

EJEMPLO — Factura abono/rectificativa:
{
  "num_factura": "AB-2025-001",
  "tipo": "abono",
  "base_imponible": -150.00,
  "pct_iva": "21,0",
  "cuota_iva": -31.50,
  "deducible": -31.50,
  "receptor_nombre": "",
  "receptor_email": "",
  "receptor_telefono": "",
  "confianza": "alta",
  "lineas_extra": []
}`

// ─── MEMORIA ACTIVA ───────────────────────────────────────────────────────────

interface MemoriaProveedor {
  nif_expedidor: string
  nombre_proveedor: string | null
  tipo_iva_habitual: string | null
  tiene_recargo_equivalencia: boolean
  notas_extraccion: string | null
  total_facturas: number
  facturas_corregidas: number
  tasa_error: number
}

// Busca en memoria_proveedores por NIF
async function consultarMemoria(
  supabaseAdmin: any,
  nifExpedidor: string
): Promise<MemoriaProveedor | null> {
  if (!nifExpedidor || nifExpedidor.length < 5) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('memoria_proveedores')
      .select('*')
      .eq('nif_expedidor', nifExpedidor.replace(/\s/g, '').toUpperCase())
      .single()

    if (error || !data) return null
    return data as MemoriaProveedor
  } catch {
    return null
  }
}

// Construye el bloque de contexto que se inyecta en el PROMPT
function buildMemoriaContext(memoria: MemoriaProveedor): string {
  const lineas: string[] = [
    '=== MEMORIA DE PROVEEDOR (aprendizaje previo) ===',
    `Este proveedor (${memoria.nif_expedidor}) fue procesado ${memoria.total_facturas} veces.`,
  ]

  if (memoria.nombre_proveedor) {
    lineas.push(`Nombre habitual confirmado: ${memoria.nombre_proveedor}`)
  }
  if (memoria.tipo_iva_habitual !== null) {
    lineas.push(`IVA habitual de este proveedor: ${memoria.tipo_iva_habitual}% — úsalo si no ves el tipo claramente`)
  }
  if (memoria.tiene_recargo_equivalencia) {
    lineas.push('ATENCIÓN: Este proveedor aplica recargo de equivalencia — buscarlo aunque no sea obvio')
  }
  if (memoria.tasa_error > 20) {
    lineas.push(
      `PRECAUCIÓN: Tasa de corrección histórica ${memoria.tasa_error}% — extremar cuidado, marcar confianza "media" como mínimo`
    )
  }
  if (memoria.notas_extraccion) {
    lineas.push(`Instrucciones específicas para este proveedor: ${memoria.notas_extraccion}`)
  }
  lineas.push('=== FIN MEMORIA ===')

  return '\n\n' + lineas.join('\n')
}

// Crea o incrementa el registro en memoria_proveedores tras procesar una factura
async function actualizarContadorMemoria(
  supabaseAdmin: any,
  nifExpedidor: string,
  nombreExpedidor: string
): Promise<void> {
  if (!nifExpedidor || nifExpedidor.length < 5) return

  try {
    const nifNorm = nifExpedidor.replace(/\s/g, '').toUpperCase()

    const { data: existente } = await supabaseAdmin
      .from('memoria_proveedores')
      .select('id, total_facturas, nombre_proveedor')
      .eq('nif_expedidor', nifNorm)
      .single()

    if (existente) {
      await supabaseAdmin
        .from('memoria_proveedores')
        .update({
          total_facturas: existente.total_facturas + 1,
          ultima_factura_at: new Date().toISOString(),
          // Actualiza nombre si antes estaba vacío
          ...(nombreExpedidor && !existente.nombre_proveedor
            ? { nombre_proveedor: nombreExpedidor }
            : {}),
        })
        .eq('nif_expedidor', nifNorm)
    } else {
      await supabaseAdmin.from('memoria_proveedores').insert({
        nif_expedidor: nifNorm,
        nombre_proveedor: nombreExpedidor || null,
        total_facturas: 1,
        ultima_factura_at: new Date().toISOString(),
      })
    }
  } catch (e) {
    // No crítico — no interrumpe el flujo principal
    console.error('Error actualizando memoria:', e)
  }
}

// ─── HAIKU ────────────────────────────────────────────────────────────────────

// Llama a Claude Haiku con una página individual
// memoriaExtra: bloque de contexto de memoria, se añade al final del PROMPT si existe
async function procesarPagina(
  base64: string,
  mediaType: string,
  anthropicKey: string,
  memoriaExtra = ''
): Promise<any> {
  const isPdf = mediaType === 'application/pdf'
  const promptFinal = memoriaExtra ? PROMPT + memoriaExtra : PROMPT

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: isPdf ? 'document' : 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: promptFinal },
        ],
      }],
    }),
  })
  const data = await response.json()
  const texto = data.content?.map((i: any) => i.text || '').join('') || ''
  const limpio = texto.replace(/```json|```/g, '').trim()
  return JSON.parse(limpio)
}

// ─── AGENTE ───────────────────────────────────────────────────────────────────

// AGENTE: valida que el NIF leído no sea el del propio cliente receptor
async function validarNifExpedidor(
  supabaseAdmin: any,
  nifLeido: string,
  clienteId: string | null
): Promise<{ valido: boolean; motivo: string }> {
  if (!nifLeido || !clienteId) return { valido: true, motivo: '' }

  const { data: cliente } = await supabaseAdmin
    .from('clientes')
    .select('nif_cif, nombre')
    .eq('id', clienteId)
    .single()

  if (!cliente) return { valido: true, motivo: '' }

  const nifCliente = cliente.nif_cif?.replace(/\s/g, '').toUpperCase()
  const nifFactura = nifLeido?.replace(/\s/g, '').toUpperCase()

  if (nifCliente && nifFactura && nifCliente === nifFactura) {
    return {
      valido: false,
      motivo: `NIF leído (${nifLeido}) coincide con el cliente receptor (${cliente.nombre}) — probable error de lectura`
    }
  }

  return { valido: true, motivo: '' }
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────

// Sube un PDF a Supabase Storage y devuelve la ruta
async function subirStorage(supabaseAdmin: any, bytes: Uint8Array, nombre: string): Promise<string | null> {
  try {
    const ruta = `email/${nombre}`
    const { error } = await supabaseAdmin.storage
      .from('facturas')
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
    if (error) { console.error('Error storage:', error); return null }
    return ruta
  } catch (e) {
    console.error('Error storage:', e)
    return null
  }
}

// ─── PROCESAR UNA PÁGINA ──────────────────────────────────────────────────────

// Procesa UNA página completa: extraer + subir a storage + IA. Nunca lanza error hacia afuera.
async function procesarUnaPagina(
  pdfDoc: any,
  indice: number,
  numPages: number,
  timestamp: number,
  supabaseAdmin: any,
  anthropicKey: string,
  clienteId: string | null = null
): Promise<any | null> {
  try {
    const paginaDoc = await PDFDocument.create()
    const [pagina] = await paginaDoc.copyPages(pdfDoc, [indice])
    paginaDoc.addPage(pagina)
    const paginaBytes = await paginaDoc.save()

    const nombreArchivo = `${timestamp}_p${indice + 1}_of_${numPages}.pdf`
    const archivoUrl = await subirStorage(supabaseAdmin, paginaBytes, nombreArchivo)

    const binary = paginaBytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64 = btoa(binary)

    // ── MEMORIA ACTIVA: primer intento sin NIF (lo necesitamos para buscar en memoria) ──
    // Hacemos una extracción inicial para obtener el NIF del expedidor,
    // luego buscamos su memoria y re-inyectamos contexto si existe.
    const parsedInicial = await procesarPagina(base64, 'application/pdf', anthropicKey)

    if (parsedInicial?.es_factura === false) return null

    // Buscar memoria del proveedor con el NIF detectado
    const nifDetectado = parsedInicial?.nif_expedidor || ''
    const memoria = await consultarMemoria(supabaseAdmin, nifDetectado)

    let parsed = parsedInicial

    // Si hay memoria con notas específicas o alta tasa de error → re-procesar con contexto
    if (memoria && (memoria.notas_extraccion || memoria.tasa_error > 15)) {
      const memoriaContext = buildMemoriaContext(memoria)
      const parsedConMemoria = await procesarPagina(base64, 'application/pdf', anthropicKey, memoriaContext)
      if (parsedConMemoria && parsedConMemoria?.es_factura !== false) {
        parsed = parsedConMemoria
        parsed.memoria_aplicada = true
      }
    } else if (memoria) {
      // Hay memoria básica (solo contador) — anotar que existía pero no se reprocessó
      parsed.memoria_aplicada = false
    }

    if (parsed.posible_pagina_multiple === undefined) {
      parsed.posible_pagina_multiple = false
    }

    if (archivoUrl) parsed.archivo_url = archivoUrl

    // AGENTE: validar NIF expedidor vs cliente receptor
    const validacionNif = await validarNifExpedidor(supabaseAdmin, parsed.nif_expedidor, clienteId)

    if (!validacionNif.valido) {
      parsed.estado = 'revisar'
      parsed.motivo_revision = validacionNif.motivo
      parsed.confianza = 'baja'
      parsed.nif_expedidor = ''

      // Actualizar contador en memoria igualmente (la factura existe)
      actualizarContadorMemoria(supabaseAdmin, nifDetectado, parsed.expedidor || '').catch(console.error)
      return parsed
    }

    // AGENTE: decidir estado según confianza
    if (parsed.confianza === 'alta') {
      parsed.estado = 'procesada'
    } else if (parsed.confianza === 'media') {
      parsed.estado = 'revisar'
      parsed.motivo_revision = 'Confianza media — revisar datos extraídos'
    } else {
      parsed.estado = 'revisar'
      parsed.motivo_revision = 'Confianza baja — ' + (parsed.notas || 'verificar manualmente')
    }

    // Actualizar contador en memoria (no bloquea el flujo)
    actualizarContadorMemoria(supabaseAdmin, parsed.nif_expedidor, parsed.expedidor || '').catch(console.error)

    return parsed

  } catch (err) {
    console.error(`Error en página ${indice + 1}:`, err)
    return null
  }
}

// ─── JUNTAR PARTES ────────────────────────────────────────────────────────────

// Junta las partes subidas a Storage y reconstruye el PDF completo
async function juntarPartes(supabaseAdmin: any, idLote: string, totalPartes: number): Promise<Uint8Array> {
  let base64Completo = ''

  for (let i = 1; i <= totalPartes; i++) {
    const ruta = `temp/${idLote}_parte${i}.txt`
    const { data, error } = await supabaseAdmin.storage
      .from('facturas')
      .download(ruta)

    if (error) throw new Error(`No se pudo descargar la parte ${i}: ${error.message}`)

    const texto = await data.text()
    base64Completo += texto
  }

  // Borrar las partes temporales una vez juntadas
  const rutasABorrar = []
  for (let i = 1; i <= totalPartes; i++) {
    rutasABorrar.push(`temp/${idLote}_parte${i}.txt`)
  }
  await supabaseAdmin.storage.from('facturas').remove(rutasABorrar)

  const binaryStr = atob(base64Completo)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

// ─── SERVE ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    const contentType = req.headers.get('content-type') || ''
    let pdfBytes: Uint8Array
    let mediaType = 'application/pdf'
    let esMultipagina = false
    let clienteIdGlobal: string | null = null

    // ── Path n8n: JSON con id_lote + total_partes (PDF ya subido en pedazos a Storage) ──
    if (contentType.includes('application/json')) {
      const body = await req.json()

      if (body.id_lote && body.total_partes) {
        pdfBytes = await juntarPartes(supabaseAdmin, body.id_lote, body.total_partes)
        esMultipagina = true
        clienteIdGlobal = body.cliente_id || null

      } else if (body.pdf_base64) {
        const binaryStr = atob(body.pdf_base64)
        pdfBytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          pdfBytes[i] = binaryStr.charCodeAt(i)
        }
        esMultipagina = true

      } else {
        return new Response(JSON.stringify({ error: 'Falta id_lote/total_partes o pdf_base64' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

    // ── Path manual frontend: multipart ──────────────────────────────────────
    } else {
      const formData = await req.formData()
      const archivo  = formData.get('archivo') as File
      if (!archivo) {
        return new Response(JSON.stringify({ error: 'No se recibió archivo' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const buffer = await archivo.arrayBuffer()
      pdfBytes  = new Uint8Array(buffer)
      mediaType = archivo.type
      esMultipagina = false
    }

    // ── Flujo MULTIPÁGINA (email): divide y procesa en lotes paralelos ────────
    if (esMultipagina) {
      const pdfDoc   = await PDFDocument.load(pdfBytes)
      const numPages = pdfDoc.getPageCount()
      const timestamp = Date.now()
      const resultados: any[] = []

      const TAMANO_LOTE = 15

      for (let inicio = 0; inicio < numPages; inicio += TAMANO_LOTE) {
        const fin = Math.min(inicio + TAMANO_LOTE, numPages)
        const indicesLote = []
        for (let i = inicio; i < fin; i++) indicesLote.push(i)

        const promesasLote = indicesLote.map((indice) =>
          procesarUnaPagina(pdfDoc, indice, numPages, timestamp, supabaseAdmin, anthropicKey, clienteIdGlobal)
        )
        const resultadosLote = await Promise.all(promesasLote)

        for (const parsed of resultadosLote) {
          if (parsed !== null) resultados.push(parsed)
        }
      }

      return new Response(JSON.stringify(resultados), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Flujo SIMPLE (frontend manual): una sola página ───────────────────────
    const binary = pdfBytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64 = btoa(binary)
    const parsed = await procesarPagina(base64, mediaType, anthropicKey)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})